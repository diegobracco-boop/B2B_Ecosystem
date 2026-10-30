// Buscador de la portada (public/portal-ask.js): las frases reales del equipo y a dónde tienen que llevar.
// Si una frase nueva no anda, sumala acá primero (es el set de prueba de .agents/skills/caja-de-preguntas).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['filter-aliases.js', 'portal-ask.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'), ctx, { filename: f });
}
const { parse, route, fixVoice, hrefOf } = ctx.PortalAsk;

const PARTNERS = ['Nubank', 'Banco de Chile', 'Claro', 'Latam', 'ITAU', 'Itau Card', 'Mercado Pago', 'livelo-api-hoteles'];
const SLUGS = ['daily', 'hub', 'pnl-managerial', 'flow', 'pnl-accounting', 'hub-consolidacion', 'marketing-b2b', 'rolling-projections', 'fixed-cost',
  'weekly-industry', 'agentes', 'profit-sharing', 'okr-b2b2c', 'manual', 'api-one-pager', 'fvm-negativo'];
const EXTERNAL = ['hub-consolidacion', 'marketing-b2b', 'rolling-projections', 'fixed-cost', 'weekly-industry', 'profit-sharing', 'api-one-pager'];
// Equipo B2B: abre el P&L Dashboard en Ownia. Resto (p. ej. el Chief): el Hub va a Apps Script.
function dest(team = true) {
  const d = {};
  for (const s of SLUGS) {
    const ext = EXTERNAL.includes(s) || (s === 'hub' && !team);
    d[s] = { title: s, href: ext ? `https://ext/${s}` : `/b2b-ecosystem/${s}`, own: !ext, external: ext, gas: s === 'hub' && !team };
  }
  return d;
}
const go = (text, team = true) => route(parse(text, PARTNERS), dest(team));
const top = (text, team) => {
  const c = go(text, team)[0];
  if (!c) return null;
  const keys = Object.keys(c.params).sort();   // orden fijo: el test compara texto
  return keys.length ? `${c.slug} ${JSON.stringify(Object.fromEntries(keys.map((k) => [k, c.params[k]])))}` : c.slug;
};

test('frases del equipo (2026-10-30, Tiago): tablero y vista', () => {
  assert.equal(top('cierre contable b2b'), 'hub {"q":"b2b"}');
  assert.equal(top('cierre contable b2b2c'), 'hub {"q":"b2b2c"}');
  assert.equal(top('quiero ver daily b2b2c'), 'daily {"lob":"b2b2c"}');
  assert.equal(top('daily b2b'), 'daily {"lob":"b2b"}');
  assert.equal(top('daily'), 'daily');
  assert.equal(top('flow semanal'), 'flow {"view":"semanal"}');
  assert.equal(top('rolling run rate'), 'rolling-projections');
  assert.equal(top('run rate automatico'), 'rolling-projections');
  assert.equal(top('fixed cost'), 'fixed-cost');
  assert.equal(top('agentes toqan'), 'agentes');
  assert.equal(top('okr producto'), 'okr-b2b2c');
  assert.equal(top('okrs'), 'okr-b2b2c');
  assert.equal(top('p&l managerial'), 'pnl-managerial');
  assert.equal(top('P&L Managerial B2B'), 'pnl-managerial {"view":"b2b"}');
});

test('sinónimos: WLs / white labels = B2B2C, portugués, gestional, cierre de mes', () => {
  assert.equal(top('daily wls'), 'daily {"lob":"b2b2c"}');
  assert.equal(top('daily white labels'), 'daily {"lob":"b2b2c"}');
  assert.equal(top('resultado gerencial b2b'), 'pnl-managerial {"view":"b2b"}');
  assert.equal(top('fechamento contábil b2b'), 'hub {"q":"b2b"}');
  assert.equal(top('apresentação semanal'), 'flow {"view":"semanal"}');
  assert.equal(top('custos fixos'), 'fixed-cost');
  assert.equal(top('diário b2b2c'), 'daily {"lob":"b2b2c"}');
  assert.equal(top('slides cierre de mes'), 'flow {"view":"cierre"}');
  assert.equal(top('presentación mensual'), 'flow {"view":"mensual"}');
  assert.equal(top('fvm negativo'), 'fvm-negativo');
  assert.equal(top('managerial vs accounting'), 'pnl-managerial {"view":"vsacc"}');
  assert.equal(top('benchmark vs b2c'), 'daily {"tab":"benchmark"}');
  assert.equal(top('weekly b2b'), 'daily {"lob":"b2b","tab":"weekly"}');
  assert.equal(top('okr mensual'), 'okr-b2b2c {"view":"m"}');
  assert.equal(top('gantt'), 'manual {"view":"gantt"}');
  assert.equal(top('h2 vs h1'), 'hub {"sec":"h2h1"}');
  assert.equal(top('detalle por país'), 'hub {"sec":"detailcountry"}');
});

test('filtros: el P&L Dashboard recibe país / período / comparación en ?q=; el resto lo avisa', () => {
  assert.equal(top('cierre contable b2b brasil sep vs forecast'), 'hub {"q":"b2b brasil sep vs forecast"}');
  const m = go('managerial b2b brasil')[0];
  assert.equal(m.slug, 'pnl-managerial');
  assert.match(m.notes.join(' '), /País \(Brasil\)/);
  // El Daily B2B2C sí filtra país y partner desde el link.
  assert.equal(top('daily b2b2c brasil'), 'daily {"lob":"b2b2c","pais":"Brasil"}');
  assert.equal(top('nubank'), 'daily {"lob":"b2b2c","partner":"Nubank"}');
  assert.equal(top('cómo viene mercado pago'), 'daily {"lob":"b2b2c","partner":"Mercado Pago"}');
  // "run rate" junto a otro tema es la comparación, no Rolling Projections.
  const d = go('daily b2b vs run rate')[0];
  assert.equal(d.slug, 'daily');
  assert.match(d.notes.join(' '), /vs Run Rate/);
});

test('Banco de Chile: su P&L de profit sharing primero y el Daily del partner después', () => {
  const l = go('banco de chile');
  assert.equal(l.map((c) => c.slug).join(' '), 'profit-sharing daily');
  assert.equal(top('profit sharing'), 'profit-sharing');
});

test('partners que también son palabras comunes cuentan solo con mayúscula', () => {
  assert.equal(parse('claro, quiero ver el daily', PARTNERS).partner, null);
  assert.equal(parse('daily de Claro', PARTNERS).partner, 'Claro');
  assert.equal(parse('itau card', PARTNERS).partner, 'Itau Card', 'el nombre más largo gana');
});

test('fuera del equipo, "cierre contable" va a P&L Accounting (el P&L Dashboard de Ownia es solo del equipo)', () => {
  assert.equal(top('cierre contable b2b', false), 'pnl-accounting {"view":"contable-b2b"}');
  const h = go('h2 vs h1', false)[0];
  assert.equal(h.slug, 'hub');
  assert.equal(Object.keys(h.params).length, 0, 'a Apps Script no se le pasan parámetros');
  assert.match(h.notes.join(' '), /Apps Script/);
});

test('si no entiende nada, no propone nada', () => {
  assert.equal(go('asdf qwerty').length, 0);
  assert.equal(parse('asdf', PARTNERS).understood, false);
  assert.equal(go('').length, 0);
});

test('dictado: lo que escribe el reconocimiento de voz', () => {
  assert.equal(top(fixVoice('deili be dos be dos ce')), 'daily {"lob":"b2b2c"}');
  assert.equal(top(fixVoice('cierre contable bitubi')), 'hub {"q":"b2b"}');
  assert.equal(top(fixVoice('pi and el manayerial')), 'pnl-managerial');
  assert.equal(top(fixVoice('agentes tocan')), 'agentes');
  assert.equal(top(fixVoice('o ka erre producto')), 'okr-b2b2c');
  assert.equal(top(fixVoice('flou semanal')), 'flow {"view":"semanal"}');
  assert.equal(fixVoice('vs badget'), 'vs budget');
});

test('hrefOf arma el link con los parámetros', () => {
  const d = dest();
  const c = go('daily b2b2c brasil')[0];
  assert.equal(hrefOf(c, d), '/b2b-ecosystem/daily?lob=b2b2c&pais=Brasil');
});
