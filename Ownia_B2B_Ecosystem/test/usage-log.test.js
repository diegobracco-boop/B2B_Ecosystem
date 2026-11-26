const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createUsageLog, claveDe, acotar, resumenFiltros, acotarFiltros } = require('../server/usage-log');
const { DirNotes } = require('../server/notes-store');

test('claveDe: páginas y funciones cuentan; salud, estáticos, polling y /uso no', () => {
  assert.equal(claveDe('GET', '/'), 'page:/');
  assert.equal(claveDe('GET', '/pnl-accounting'), 'page:/pnl-accounting');
  assert.equal(claveDe('GET', '/hub/algo/mas'), 'page:/hub/algo');
  assert.equal(claveDe('POST', '/api/pnl-accounting/getEPMBreakdown'), 'api:pnl-accounting/getEPMBreakdown');
  assert.equal(claveDe('POST', '/notes/hub/slides-2026-11'), 'notes:hub');
  assert.equal(claveDe('POST', '/reales'), 'otro:POST/reales');
  for (const [m, r] of [['GET', '/health'], ['GET', '/healthz'], ['GET', '/_gas/client.js'], ['GET', '/_portal/ask.js'],
    ['POST', '/api/hub/getLastSync'], ['GET', '/favicon.ico'], ['GET', '/uso'], ['POST', '/api/hub']]) assert.equal(claveDe(m, r), null, r);
});

test('registra por día y usuario; sin usuario no cuenta; errores y tiempos', async () => {
  const t = Date.parse('2026-11-26T15:00:00Z');
  const u = createUsageLog(null, { now: () => t, flushMs: 0 });
  u.registrar({ method: 'GET', route: '/hub', status: 200, ms: 30, user: 'Ana@despegar.com' });
  u.registrar({ method: 'POST', route: '/api/hub/getAllData', status: 200, ms: 400, user: 'ana@despegar.com' });
  u.registrar({ method: 'POST', route: '/api/hub/getAllData', status: 500, ms: 1200, user: 'ana@despegar.com' });
  u.registrar({ method: 'GET', route: '/hub', status: 200, ms: 10, user: null });
  assert.equal(u.hoy(), '2026-11-26');
  const dia = await u.leerDia('2026-11-26');
  assert.equal(dia.length, 1);
  assert.equal(dia[0].user, 'ana@despegar.com');
  assert.deepEqual(dia[0].rutas['page:/hub'], { n: 1, err: 0, ms: 30, max: 30 });
  assert.deepEqual(dia[0].rutas['api:hub/getAllData'], { n: 2, err: 1, ms: 1600, max: 1200 });
  await assert.rejects(() => u.leerDia('26/11'), /día inválido/);
});

test('el día se corta a la medianoche de Buenos Aires', () => {
  const u = createUsageLog(null, { now: () => Date.parse('2026-11-27T02:30:00Z') });
  assert.equal(u.hoy(), '2026-11-26');
});

test('flush al almacén: dos procesos (o un reinicio) no se pisan y al leer se suman', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uso-'));
  try {
    const store = new DirNotes(dir);
    const now = () => Date.parse('2026-11-26T15:00:00Z');
    const a = createUsageLog(store, { now, flushMs: 0 });
    const b = createUsageLog(store, { now, flushMs: 0 });
    a.registrar({ method: 'GET', route: '/daily', status: 200, ms: 5, user: 'ana@despegar.com' });
    b.registrar({ method: 'GET', route: '/daily', status: 200, ms: 7, user: 'ana@despegar.com' });
    b.registrar({ method: 'GET', route: '/hub', status: 200, ms: 7, user: 'beto@despegar.com' });
    assert.equal(await a.flush(), 1);
    assert.equal(await b.flush(), 2);
    assert.equal(await b.flush(), 0, 'sin cambios no escribe');
    const c = createUsageLog(store, { now });   // proceso nuevo: lee lo guardado
    const dia = await c.leerDia('2026-11-26');
    const ana = dia.find((x) => x.user === 'ana@despegar.com');
    assert.deepEqual(ana.rutas['page:/daily'], { n: 2, err: 0, ms: 12, max: 7 });
    assert.ok(dia.find((x) => x.user === 'beto@despegar.com'));
    const notas = JSON.stringify(await store.get('uso', 'dia-2026-11-26'));
    assert.doesNotMatch(Object.keys(await store.get('uso', 'dia-2026-11-26')).join(','), /@/, 'el campo es un hash, no el mail');
    assert.match(notas, /ana@despegar\.com/);
    const r = await c.leerRango('2026-11-25', '2026-11-26');
    assert.deepEqual(r.dias.map((d) => d.dia), ['2026-11-25', '2026-11-26']);
    assert.equal(r.dias[0].usuarios.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('flush que falla: se reintenta la próxima vez', async () => {
  let falla = true;
  const guardado = [];
  const store = { put: async (...a) => { if (falla) throw new Error('dynamo caído'); guardado.push(a); }, get: async () => ({}) };
  const logs = [];
  const u = createUsageLog(store, { now: () => Date.parse('2026-11-26T15:00:00Z'), flushMs: 0, log: (x) => logs.push(x) });
  u.registrar({ method: 'GET', route: '/hub', status: 200, ms: 1, user: 'ana@despegar.com' });
  assert.equal(await u.flush(), 0);
  assert.equal(logs[0].level, 'error');
  falla = false;
  assert.equal(await u.flush(), 1);
  assert.equal(guardado[0][0], 'uso');
});

test('acotar: hasta 80 claves por usuario y día, el resto en "otros", y entra en una nota', () => {
  const rutas = {};
  for (let i = 0; i < 120; i++) rutas['api:modulo/' + 'f'.repeat(60) + i] = { n: i + 1, err: 0, ms: 1, max: 1 };
  const out = acotar(rutas);
  assert.ok(JSON.stringify(out).length <= 7800);
  assert.ok(out.otros && out.otros.n > 0);
  const total = Object.values(out).reduce((s, v) => s + v.n, 0);
  assert.equal(total, (120 * 121) / 2, 'no se pierde ningún conteo');
});

test('resumenFiltros: solo filtros cortos, claves ordenadas; nada sensible ni datos', () => {
  const f = { lobGroup: 'b2b', goalSource: 'lastrunrate', organic: true, pais: ['Brasil', 'Mexico'], producto: [] };
  assert.equal(resumenFiltros([f, 'lob']), 'arg2=lob · goalSource=lastrunrate · lobGroup=b2b · organic=true · pais=[Brasil,Mexico] · producto=[]');
  assert.equal(resumenFiltros([JSON.stringify({ mes: '2026-11' })]), 'mes=2026-11', 'filtros mandados como JSON');
  assert.equal(resumenFiltros([{ password: 'x', token: 'y', text: 'hola', slides: [1], email: 'ana@despegar.com', html: 'x' }]), null);
  assert.equal(resumenFiltros([{ largo: 'x'.repeat(41), lista: Array(9).fill('a'), obj: { a: 1 }, multi: 'a\nb' }]), null);
  assert.equal(resumenFiltros([]), null);
  assert.equal(resumenFiltros(null), null);
});

test('filtros: se cuentan por función y usuario, se guardan aparte y se suman al leer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uso-f-'));
  try {
    const store = new DirNotes(dir);
    const now = () => Date.parse('2026-11-26T15:00:00Z');
    const a = createUsageLog(store, { now, flushMs: 0 });
    const call = (args) => a.registrar({ method: 'POST', route: '/api/pnl-accounting/getEPMBreakdown', status: 200, ms: 5, user: 'ana@despegar.com', args });
    call([{ goalSource: 'lastrunrate' }, 'lob']);
    call([{ goalSource: 'lastrunrate' }, 'lob']);
    call([{ goalSource: 'budget' }, 'prod']);
    a.registrar({ method: 'GET', route: '/hub', status: 200, ms: 1, user: 'ana@despegar.com', args: [{ x: 'no cuenta' }] });
    await a.flush();
    const c = createUsageLog(store, { now });
    const [ana] = await c.leerDia('2026-11-26');
    assert.deepEqual(ana.filtros, { 'api:pnl-accounting/getEPMBreakdown': { 'arg2=lob · goalSource=lastrunrate': 2, 'arg2=prod · goalSource=budget': 1 } });
    assert.equal(ana.rutas['api:pnl-accounting/getEPMBreakdown'].n, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('acotarFiltros: hasta 25 combinaciones por función, el resto en "otros", y entra en una nota', () => {
  const combos = {};
  for (let i = 0; i < 300; i++) combos['pais=' + 'p'.repeat(30) + i] = i + 1;
  const out = acotarFiltros({ 'api:m/f': combos });
  assert.ok(JSON.stringify(out).length <= 7800);
  assert.ok(Object.keys(out['api:m/f']).length <= 26);
  assert.equal(Object.values(out['api:m/f']).reduce((s, n) => s + n, 0), (300 * 301) / 2, 'no se pierde ningún conteo');
});
