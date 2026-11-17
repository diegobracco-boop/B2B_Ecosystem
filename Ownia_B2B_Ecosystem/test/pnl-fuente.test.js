// P&L Accounting desde el consolidador: la fuente en memoria (server/pnl-fuente.js) y su conexión con el código GAS real del
// módulo (gas-extras/pnl-accounting-consolidador.js), sin tocar el código del módulo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const config = require('../server/config');
const { MODULES } = require('../server/modules');
const { GasProject } = require('../server/gas-runtime');
const { createPnlFuente } = require('../server/pnl-fuente');
const { buildCanonicals } = require('../server/pnl-consolidador');

const COLS = ['scenario', 'year', 'mes', 'pais', 'lob', 'channel', 'product', 'n2', 'valor'];
const FILAS = [
  ['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'Gross Bookings', 100],
  ['ACT', 'FY27', 11, 'Brazil', 'B2B', 'MAY', 'Air', 'Gross Bookings', 120],
  ['BGT', 'FY27', 4, 'Chile', 'B2B2C', 'ON', 'Hotel', 'Orders', 7],
  ['FC1', 'FY27', 8, 'Mexico', 'B2B', 'MIN', 'Hotel', 'Gross Bookings', 9],
  ['RR', 'FY27', 11, 'Peru', 'B2B', 'MAY', 'Cars', 'Gross Bookings', 3],
  ['LRR', 'FY27', 5, 'Peru', 'B2B', 'MAY', 'Cars', 'Gross Bookings', 4],
  ['ACT', 'FY26', 4, 'Argentina', 'B2B', 'MIN', 'Hotel', 'Gross Bookings', 8],
];

const SIN_AJ = { cols: [], rows: [] };

// consolidador falso: versiones + cubo, y cuántas veces se lo llamó
function falsoConso({ version = 1, publicado = '2026-11-17T14:11:29+00:00', fallar = false, sinTabla = false } = {}) {
  const f = { version, publicado, fallar, sinTabla, llamadas: [] };
  f.leer = async (cmd) => {
    f.llamadas.push(cmd);
    if (f.fallar) return { ok: false, code: 502, error: 'No se pudo leer el consolidador: permission denied' };
    if (cmd === 'versiones') return { ok: true, data: f.sinTabla ? null : { dataset: 'app_b2b_ecosystem', version: f.version, publicado_en: f.publicado } };
    return { ok: true, data: { version: f.version, cols: COLS, rows: FILAS } };
  };
  return f;
}

test('listo: arma los canónicos desde la tabla, y canon() los da sin esperar', async () => {
  const conso = falsoConso();
  const f = createPnlFuente({ secrets: {} }, { consolidador: conso, ajustes: SIN_AJ });
  assert.equal(f.canon(), null);
  await f.listo();
  const c = f.canon();
  assert.deepEqual(Object.keys(c.canon).sort(), ['ac', 'bg', 'bl', 'fbtb', 'fc', 'lrr', 'ly', 'rr']);
  assert.equal(c.modificado, Date.parse('2026-11-17T14:11:29+00:00'));
  const e = f.estado();
  assert.equal(e.listo, true);
  assert.equal(e.ultimoCerrado, '2026-10-01');
  assert.equal(e.filas.ac, 1);   // el actual de noviembre ya es run rate: no entra en ac
});

test('el último mes cerrado sale de APP_SECRETS.PNL_ULTIMO_CERRADO (y se ignora si no es AAAA-MM-01)', async () => {
  assert.equal(createPnlFuente({ secrets: { PNL_ULTIMO_CERRADO: '2026-11-01' } }, { consolidador: falsoConso() }).ultimoCerrado, '2026-11-01');
  assert.equal(createPnlFuente({ secrets: { PNL_ULTIMO_CERRADO: 'noviembre' } }, { consolidador: falsoConso() }).ultimoCerrado, '2026-10-01');
  const f = createPnlFuente({ secrets: { PNL_ULTIMO_CERRADO: '2026-11-01' } }, { consolidador: falsoConso(), ajustes: SIN_AJ });
  await f.listo();
  assert.equal(f.estado().filas.ac, 2);   // con noviembre cerrado, entra
});

test('revisa la versión como mucho una vez por minuto y rearma solo si cambió', async () => {
  let t = 1000;
  const conso = falsoConso();
  const avisos = [];
  const f = createPnlFuente({ secrets: {} }, { consolidador: conso, now: () => t, onChange: (v) => avisos.push(v) });
  await f.listo();
  assert.deepEqual(conso.llamadas, ['versiones', 'cubo']);
  await f.listo();   // dentro del minuto: no consulta nada
  assert.equal(conso.llamadas.length, 2);
  t += 61000;
  await f.listo();   // pasó el minuto, misma versión: solo revisa
  assert.deepEqual(conso.llamadas.slice(2), ['versiones']);
  assert.deepEqual(avisos, []);
  conso.version = 2; conso.publicado = '2026-11-18T10:00:00+00:00';
  t += 61000;
  await f.listo();   // versión nueva: rearma y avisa
  assert.deepEqual(conso.llamadas.slice(3), ['versiones', 'cubo']);
  assert.deepEqual(avisos, [2]);
  assert.equal(f.canon().modificado, Date.parse('2026-11-18T10:00:00+00:00'));
});

test('pedidos simultáneos comparten un solo armado', async () => {
  const conso = falsoConso();
  const f = createPnlFuente({ secrets: {} }, { consolidador: conso, ajustes: SIN_AJ });
  await Promise.all([f.listo(), f.listo(), f.listo()]);
  assert.equal(conso.llamadas.filter((c) => c === 'cubo').length, 1);
});

test('si no se puede leer: 503 con el motivo, sin datos, y NO se cae a Drive', async () => {
  const f = createPnlFuente({ secrets: {} }, { consolidador: falsoConso({ fallar: true }) });
  await assert.rejects(f.listo(), (e) => e.status === 503 && /permission denied/.test(e.message));
  assert.equal(f.canon(), null);
  assert.match(f.estado().error, /permission denied/);
  const g = createPnlFuente({ secrets: {} }, { consolidador: falsoConso({ sinTabla: true }) });
  await assert.rejects(g.listo(), (e) => e.status === 503 && /no está publicada/.test(e.message));
});

test('si ya había datos y el consolidador falla después, sigue sirviendo los últimos (y lo deja en el estado)', async () => {
  let t = 0;
  const conso = falsoConso();
  const f = createPnlFuente({ secrets: {} }, { consolidador: conso, now: () => t });
  await f.listo();
  conso.fallar = true; t += 61000;
  await f.listo();   // no lanza
  assert.ok(f.canon());
  assert.match(f.estado().error, /permission denied/);
});

// ── el código GAS real del módulo ──────────────────────────────────────────────────────────────────────────────────────────
const twin = MODULES.find((m) => m.slug === 'pnl-accounting-conso');
const orig = MODULES.find((m) => m.slug === 'pnl-accounting');

test('la copia usa los mismos archivos GAS que el módulo original y sumó el extra del consolidador', () => {
  assert.equal(twin.dir, orig.dir);
  assert.equal(twin.fuente, 'consolidador');
  assert.equal(orig.fuente, undefined);
  assert.deepEqual(twin.gasExtras, [...orig.gasExtras, 'pnl-accounting-consolidador.js']);
  assert.ok(Array.isArray(twin.allowedUsers) && twin.allowedUsers.length > 0, 'solo el equipo');
});

async function proyecto(mod, canon) {
  return new GasProject(mod, { gasRoot: config.GAS_ROOT, secrets: {}, log: () => {}, fileStore: null, pnlCanon: canon ? () => canon : null });
}
const evalEn = (p, code) => vm.runInContext(code, p.context);

test('módulo real con fuente consolidador: _readCanonical_ y _canonicalsMaxMod_ salen de la tabla, y assembleCanonicals_ corre', async () => {
  const { canon } = buildCanonicals({ cols: COLS, rows: FILAS }, { ajustes: { cols: [], rows: [] } });
  const p = await proyecto(twin, { canon, modificado: 4242 });
  assert.equal(evalEn(p, 'typeof __owniaPnlCanon_'), 'function');
  assert.equal(evalEn(p, '_canonicalsMaxMod_()'), 4242);
  assert.equal(evalEn(p, '_readCanonical_(CANONICAL_IDS_.bg).meta.concepto'), 'bg');
  assert.equal(evalEn(p, '_readCanonical_(CANONICAL_IDS_.fbtb).rows.length'), 1);   // fbtb viene de FC1
  assert.equal(evalEn(p, '_readCanonical_(CANONICAL_IDS_.ly).rows[0][5]'), '2025-04-01');
  const out = JSON.parse(evalEn(p, 'JSON.stringify(Object.keys(assembleCanonicals_().data || assembleCanonicals_()))'));
  assert.ok(out.length > 0, 'el ensamblado del módulo corre con los canónicos de la tabla');
});

test('el módulo original NO recibe la fuente del consolidador (sigue leyendo Drive)', async () => {
  const p = await proyecto(orig, null);
  assert.equal(evalEn(p, 'typeof __owniaPnlCanon_'), 'undefined');
});

test('con fuente consolidador pero sin datos en memoria: falla, no lee Drive en silencio', async () => {
  const p = new GasProject(twin, { gasRoot: config.GAS_ROOT, secrets: {}, log: () => {}, fileStore: null, pnlCanon: () => null });
  // __owniaPnlCanon_ devuelve null → el extra cae al original (Drive), que sin almacén falla: nunca devuelve datos de otra fuente
  assert.throws(() => evalEn(p, '_readCanonical_(CANONICAL_IDS_.ac)'));
});
