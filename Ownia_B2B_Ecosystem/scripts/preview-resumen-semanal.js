// Vista previa del "Resumen semanal" con datos de ejemplo (sin _store ni Drive), para revisar el diseño.
// Sirve solo la página y un getResumenSemanal falso con la misma forma que el real (server/gas-extras/daily-resumen-semanal.js):
// elección de semana (args[0].year / .week) y de mes MTD (args[0].month), racha por país, unidades partner × país (B2B2C)
// o país (B2B) y su racha, y el MTD con la serie diaria.
// Uso: node scripts/preview-resumen-semanal.js [puerto]  →  http://localhost:8099/b2b-ecosystem/resumen-semanal
// Los montos y los partners son INVENTADOS: no usar para leer números.
const http = require('http');
const BASE = '/b2b-ecosystem';
const port = Number(process.argv[2]) || 8099;
const LATEST = 44, PICK = 8, SERIES = 13, STREAK = 4, LAST_DAY = '2026-11-03';

// Ruido determinístico por clave: mismos números en cada recarga
function noise(...k) {
  let h = 2166136261;
  for (const c of k.join('|')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000 * 2 - 1;
}

// GB semanal de Budget por unidad. B2B2C: partner × país; B2B: país.
const UNITS = {
  b2b2c: {
    Brasil: { Livelo: 1.3e6, 'Itau Card': 0.8e6, Smiles: 0.6e6, Sicoob: 0.4e6 },
    Argentina: { BBVA: 0.8e6, Galicia: 0.6e6, 'Viajes Naranja': 0.5e6 },
    Mexico: { 'BBVA MX': 0.8e6, Banorte: 0.6e6 },
    Chile: { 'Viajes Falabella': 0.55e6, 'Banco de Chile': 0.35e6 },
    Colombia: { 'Viajes Falabella': 0.4e6, Bancolombia: 0.3e6 },
    Peru: { 'Viajes Falabella': 0.28e6, Interbank: 0.17e6 },
    'Other Countries': { Visa: 0.3e6, TBD: 0.08e6 },
  },
  api: { Brasil: 2.2e6, Mexico: 1.3e6, Argentina: 0.8e6, Chile: 0.6e6, USA: 0.5e6, Colombia: 0.35e6, 'Other Countries': 0.25e6 },
  html: { Argentina: 0.9e6, Brasil: 0.7e6, Chile: 0.35e6, Colombia: 0.25e6, Peru: 0.2e6, Uruguay: 0.12e6 },
};
const MARGIN = { b2b2c: [0.085, 0.032], api: [0.06, 0.021], html: [0.075, 0.027] };   // NR / GB, FVM / GB
const BIAS = { b2b2c: 0.99, api: 1.03, html: 0.95 };                                    // actual vs budget de fondo
// Desvíos que se repiten: Falabella flojo en los tres países (se suma como partner), Livelo con take rate bajo,
// México B2B API arriba, HTML Colombia flojo. Desde W42 Falabella cae más (cambia la explicación semana a semana).
function weak(k, p, u, w) {
  if (k === 'b2b2c' && u === 'Viajes Falabella') return w >= 42 ? 0.78 : 0.92;
  if (k === 'b2b2c' && u === 'Galicia' && w === 43) return 0.75;
  if (k === 'api' && p === 'Mexico') return 1.09;
  if (k === 'html' && p === 'Colombia') return 0.84;
  return 1;
}
function rateOf(k, u, sc) { return MARGIN[k][0] * (sc === 'cur' && u === 'Livelo' ? 0.86 : 1); }

function isoMonday(y, w) { const j4 = new Date(Date.UTC(y, 0, 4)), d = j4.getUTCDay() || 7; return new Date(Date.UTC(y, 0, 4 - d + 1 + (w - 1) * 7)); }
const ymd = (d) => d.toISOString().substring(0, 10);
const wk = (w) => ({ year: 2026, week: w, from: ymd(isoMonday(2026, w)) });
const isoWeekOf = (s) => { const d = new Date(s + 'T00:00:00Z'), day = d.getUTCDay() || 7, thu = new Date(d.getTime() + (4 - day) * 864e5);
  return Math.ceil(((thu - Date.UTC(thu.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };

// Lista de unidades de un negocio: { key, n (partner o ''), p (país), g (GB semanal de Budget) }
function unitList(k) {
  const out = [];
  if (k === 'b2b2c') Object.entries(UNITS.b2b2c).forEach(([p, ps]) => Object.entries(ps).forEach(([n, g]) => out.push({ key: n.toLowerCase() + '|' + p, n, p, g })));
  else Object.entries(UNITS[k]).forEach(([p, g]) => out.push({ key: p, n: '', p, g }));
  return out;
}
// Una unidad en una semana (w) y escenario; f = fracción de la semana (para días)
function cell(k, u, w, sc, f = 1) {
  const base = u.g * (1 + 0.05 * Math.sin(w / 2.3) + (w - 30) * 0.004) * f;
  const m = { bud: 1, cur: BIAS[k] * weak(k, u.p, u.n, w) * (1 + 0.06 * noise(k, u.key, w, 'c')), ly: 0.88 * (1 + 0.06 * noise(k, u.key, w, 'l')), rr: 1 + 0.04 * noise(k, u.key, w, 'r') }[sc];
  const gb = base * m;
  return { gb, rev: gb * rateOf(k, u.n, sc) * (sc === 'cur' ? 1 + 0.03 * noise(k, u.key, w, 't') : 1), fvm: gb * MARGIN[k][1] * (sc === 'cur' ? 1 + 0.12 * noise(k, u.key, w, 'f') : 1) };
}
// Sin filas RG (ajuste COI Brasil): en el real tienen NR 0 y FVM solo con el switch en Excluir (exCoiBr: false acá)
const rd = (t) => ({ gb: Math.round(t.gb), rev: Math.round(t.rev), fvm: Math.round(t.fvm) });
const z = () => ({ gb: 0, rev: 0, fvm: 0 });
const add = (a, b) => { a.gb += b.gb; a.rev += b.rev; a.fvm += b.fvm; return a; };

// Unidades de un rango de semanas (frac por semana) → { key: {n, p, cur, bud, ly} } y por país
function unitsFor(k, parts) {
  const U = {};
  unitList(k).forEach((u) => {
    const o = U[u.key] = { n: u.n, p: u.p, cur: z(), bud: z(), ly: z(), rr: z() };
    parts.forEach(([w, f]) => ['cur', 'bud', 'ly', 'rr'].forEach((sc) => add(o[sc], cell(k, u, w, sc, f))));
  });
  return U;
}
function byPais(U, sc) { const o = {}; Object.values(U).forEach((u) => { o[u.p] = add(o[u.p] || z(), u[sc]); }); Object.keys(o).forEach((p) => { o[p] = rd(o[p]); }); return o; }
function cleanUnits(U) { const o = {}; Object.entries(U).forEach(([key, u]) => { o[key] = { n: u.n, p: u.p, cur: rd(u.cur), bud: rd(u.bud), ly: rd(u.ly), cl: sc1(u.cur, 0.985) }; }); return o; }
// Organic en el mock: actuals a TC LY = 98,5% de los de TC Budget, nominales = 102%
const scale = (by, f) => { const o = {}; Object.entries(by).forEach(([p, v]) => { o[p] = rd({ gb: v.gb * f, rev: v.rev * f, fvm: v.fvm * f }); }); return o; };
const sc1 = (v, f) => rd({ gb: v.gb * f, rev: v.rev * f, fvm: v.fvm * f });
function sum(by) { const t = z(); Object.values(by).forEach((v) => add(t, v)); return rd(t); }

function mock(params) {
  const want = params && params.week ? +params.week : LATEST;
  const W = want <= LATEST && want > LATEST - PICK ? want : LATEST;
  const months = ['2026-11', '2026-10', '2026-09', '2026-08'];
  const ym = months.includes(params && params.month) ? params.month : months[0];
  const mFrom = ym + '-01', mEnd = ymd(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)));
  const mTo = ym === months[0] ? LAST_DAY : mEnd;
  const dayList = []; for (let d = new Date(mFrom + 'T00:00:00Z'); ymd(d) <= mTo; d = new Date(d.getTime() + 864e5)) dayList.push(ymd(d));
  const allDays = []; for (let d = new Date(mFrom + 'T00:00:00Z'); ymd(d) <= mEnd; d = new Date(d.getTime() + 864e5)) allDays.push(ymd(d));
  const biz = {};
  Object.keys(UNITS).forEach((k) => {
    const U = unitsFor(k, [[W, 1]]);
    const o = { cur: byPais(U, 'cur'), bud: byPais(U, 'bud'), ly: byPais(U, 'ly'), rr: byPais(U, 'rr'), units: cleanUnits(U) };
    const prev = [1, 2, 3, 4].map((i) => unitsFor(k, [[W - i, 1]]));
    const avg = (sc) => { const a = {}; prev.forEach((P) => Object.entries(byPais(P, sc)).forEach(([p, v]) => { const s = a[p] = a[p] || z(); s.gb += v.gb / 4; s.rev += v.rev / 4; s.fvm += v.fvm / 4; })); return a; };
    o.l4w = avg('cur'); o.l4wLy = avg('ly'); o.l4wL = scale(o.l4w, 0.985); o.curL = scale(o.cur, 0.985); o.curN = scale(o.cur, 1.02);
    o.trend = [];
    for (let w = W - SERIES + 1; w <= W; w++) { const T = unitsFor(k, [[w, 1]]); o.trend.push({ ...wk(w), curL: sc1(sum(byPais(T, 'cur')), 0.985), cur: sum(byPais(T, 'cur')), bud: sum(byPais(T, 'bud')), ly: sum(byPais(T, 'ly')) }); }
    o.streak = []; o.ustreak = [];
    for (let w = W - STREAK + 1; w <= W; w++) {
      const T = unitsFor(k, [[w, 1]]), st = {}, us = {};
      const c = byPais(T, 'cur'), b = byPais(T, 'bud');
      Object.keys(c).forEach((p) => { st[p] = [c[p].rev, (b[p] || z()).rev]; });
      Object.entries(T).forEach(([key, u]) => { us[key] = [Math.round(u.cur.rev), Math.round(u.bud.rev)]; });
      o.streak.push(st); o.ustreak.push(us);
    }
    // MTD: cada día = 1/7 de su semana ISO
    const MU = unitsFor(k, dayList.map((d) => [isoWeekOf(d), 1 / 7]));
    const days = dayList.map((d) => { const T = unitsFor(k, [[isoWeekOf(d), 1 / 7]]); return { d, curL: sc1(sum(byPais(T, 'cur')), 0.985), cur: sum(byPais(T, 'cur')), bud: sum(byPais(T, 'bud')), ly: sum(byPais(T, 'ly')) }; });
    o.mtd = { curL: scale(byPais(MU, 'cur'), 0.985), curN: scale(byPais(MU, 'cur'), 1.02), cur: byPais(MU, 'cur'), bud: byPais(MU, 'bud'), ly: byPais(MU, 'ly'), rr: byPais(MU, 'rr'), units: cleanUnits(MU),
      budMonth: sum(byPais(unitsFor(k, allDays.map((d) => [isoWeekOf(d), 1 / 7])), 'bud')), days };
    biz[k] = o;
  });
  const from = isoMonday(2026, W), to = new Date(from.getTime() + 6 * 864e5);
  const weeks = []; for (let q = 0; q < PICK; q++) weeks.push(wk(LATEST - q));
  return { success: true, week: { year: 2026, week: W, from: ymd(from), to: ymd(to) }, latest: { year: 2026, week: LATEST }, weeks,
    month: { ym, from: mFrom, to: mTo, end: mEnd, days: +mTo.slice(8, 10), daysInMonth: +mEnd.slice(8, 10) }, months,
    lastActualsDate: LAST_DAY, generatedAt: '2026-11-04T06:12:00Z', exCoiBr: false, organic: { target: 'budget', missing: [] }, biz };
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === `${BASE}/api/daily/getResumenSemanal`) {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      let params = {};
      try { params = (JSON.parse(body || '{}').args || [])[0] || {}; } catch (e) { /* sin params */ }
      setTimeout(() => {   // un poco de demora, como en el servidor real
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: mock(params) }));
      }, 250);
    });
  }
  if (url === `${BASE}/resumen-semanal` || url === '/' || url === `${BASE}/`) {
    // Se recarga en cada request: los cambios al .js se ven con F5, sin reiniciar
    delete require.cache[require.resolve('../server/resumen-semanal-page')];
    const { resumenSemanalPage } = require('../server/resumen-semanal-page');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(resumenSemanalPage({ basePath: BASE }));
  }
  res.writeHead(404); res.end('no');
}).listen(port, '127.0.0.1', () => console.log(`preview → http://localhost:${port}${BASE}/resumen-semanal  (datos de ejemplo)`));
