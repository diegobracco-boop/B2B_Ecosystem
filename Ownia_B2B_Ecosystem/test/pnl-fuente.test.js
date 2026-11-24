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
// Todos los escenarios con B2C, línea y nivel 3 (consulta `cubo_hub`, para el Hub)
const COLS_HUB = ['scenario', 'year', 'mes', 'pais', 'lob', 'channel', 'product', 'linea', 'n2', 'n3', 'valor'];
const FILAS_HUB = [
  ['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'GB NAC', 'Gross Bookings', 'Gross Bookings', 100],
  ['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'Affiliates', 'Third Party Comission', 'Sales & Marketing', -4],
  ['ACT', 'FY27', 4, 'Mexico', 'B2C', 'Site', 'Hotel', 'Fees', 'Customer Fees & Charges', 'Net Revenues', 9],
  ['BGT', 'FY27', 5, 'Chile', 'B2B2C', 'ON', 'Hotel', 'Orders NAC', 'Orders', 'Orders', 7],
  ['ACT', 'FY26', 4, 'Peru', 'B2B2C', 'Site', 'Cars', 'Fees', 'Customer Fees & Charges', 'Net Revenues', 2],
];
// ACT del FY27 con la línea y el nivel 3 (consulta `cubo_mgr`, para el P&L Managerial)
const COLS_MGR = ['year', 'mes', 'pais', 'lob', 'channel', 'product', 'linea', 'n2', 'n3', 'valor'];
const FILAS_MGR = [
  ['FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'GB NAC', 'Gross Bookings', 'Gross Bookings', 100],
  ['FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'Affiliates', 'Third Party Comission', 'Sales & Marketing', -4],
  ['FY27', 11, 'Brazil', 'B2B', 'MAY', 'Air', 'GB NAC', 'Gross Bookings', 'Gross Bookings', 120],   // run rate: no entra
];

// consolidador falso: versiones + cubo, y cuántas veces se lo llamó
function falsoConso({ version = 1, publicado = '2026-11-17T14:11:29+00:00', fallar = false, sinTabla = false, conVersion, fallarMgr = false, fallarHub = false } = {}) {
  const f = { version, publicado, fallar, sinTabla, conVersion, fallarMgr, fallarHub, llamadas: [] };
  f.leer = async (cmd) => {
    f.llamadas.push(cmd);
    if (f.fallar) return { ok: false, code: 502, error: 'No se pudo leer el consolidador: permission denied' };
    if (cmd === 'versiones') return { ok: true, data: f.sinTabla ? null : { dataset: 'app_b2b_ecosystem', version: f.version, publicado_en: f.publicado } };
    if (cmd === 'cubo_hub') return f.fallarHub ? { ok: false, code: 502, error: 'No se pudo leer el consolidador: cubo_hub roto' } : { ok: true, data: { version: f.version, cols: COLS_HUB, rows: FILAS_HUB } };
    if (cmd === 'cubo_mgr') return f.fallarMgr ? { ok: false, code: 502, error: 'No se pudo leer el consolidador: cubo_mgr roto' } : { ok: true, data: { version: f.version, cols: COLS_MGR, rows: FILAS_MGR } };
    return { ok: true, data: { version: f.version, tieneColumnaVersion: f.conVersion, cols: COLS, rows: FILAS } };
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
  assert.deepEqual(conso.llamadas, ['versiones', 'cubo', 'cubo_mgr', 'cubo_hub']);
  await f.listo();   // dentro del minuto: no consulta nada
  assert.equal(conso.llamadas.length, 4);
  t += 61000;
  await f.listo();   // pasó el minuto, misma versión: solo revisa
  assert.deepEqual(conso.llamadas.slice(4), ['versiones']);
  assert.deepEqual(avisos, []);
  conso.version = 2; conso.publicado = '2026-11-18T10:00:00+00:00';
  t += 61000;
  await f.listo();   // versión nueva: rearma y avisa
  assert.deepEqual(conso.llamadas.slice(5), ['versiones', 'cubo', 'cubo_mgr', 'cubo_hub']);
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
const conso = MODULES.find((m) => m.slug === 'pnl-accounting');            // el de todos: desde 2026-11-17 lee del consolidador
const drive = MODULES.find((m) => m.slug === 'pnl-accounting-drive');      // respaldo con Drive, solo el equipo

test('el P&L Accounting de todos lee del consolidador; el respaldo con Drive usa el mismo código y es solo del equipo', () => {
  assert.equal(conso.dir, drive.dir);
  assert.equal(conso.fuente, 'consolidador');
  assert.equal(drive.fuente, undefined);
  assert.deepEqual(conso.gasExtras, [...drive.gasExtras, 'pnl-accounting-consolidador.js']);
  assert.equal(conso.allowedUsers, undefined, 'abierto a todo el dominio, como antes');
  assert.ok(Array.isArray(drive.allowedUsers) && drive.allowedUsers.length > 0, 'el respaldo es solo del equipo');
});

async function proyecto(mod, canon, fileStore = null) {
  return new GasProject(mod, { gasRoot: config.GAS_ROOT, secrets: {}, log: () => {}, fileStore, pnlCanon: canon ? () => canon : null });
}
const evalEn = (p, code) => vm.runInContext(code, p.context);

test('módulo real con fuente consolidador: _readCanonical_ y _canonicalsMaxMod_ salen de la tabla, y assembleCanonicals_ corre', async () => {
  const { canon } = buildCanonicals({ cols: COLS, rows: FILAS }, { ajustes: { cols: [], rows: [] } });
  const p = await proyecto(conso, { canon, modificado: 4242 }, almacenLrr(1));   // el LRR sale de Drive (LRR_DESDE_DRIVE_)
  assert.equal(evalEn(p, 'typeof __owniaPnlCanon_'), 'function');
  assert.equal(evalEn(p, '_canonicalsMaxMod_()'), 4242);
  assert.equal(evalEn(p, '_readCanonical_(CANONICAL_IDS_.bg).meta.concepto'), 'bg');
  assert.equal(evalEn(p, '_readCanonical_(CANONICAL_IDS_.fbtb).rows.length'), 1);   // fbtb viene de FC1
  assert.equal(evalEn(p, '_readCanonical_(CANONICAL_IDS_.ly).rows[0][5]'), '2025-04-01');
  const out = JSON.parse(evalEn(p, 'JSON.stringify(Object.keys(assembleCanonicals_().data || assembleCanonicals_()))'));
  assert.ok(out.length > 0, 'el ensamblado del módulo corre con los canónicos de la tabla');
});

test('el respaldo con Drive NO recibe la fuente del consolidador (sigue leyendo Drive)', async () => {
  const p = await proyecto(drive, null);
  assert.equal(evalEn(p, 'typeof __owniaPnlCanon_'), 'undefined');
});

test('con fuente consolidador pero sin datos en memoria: falla, no lee Drive en silencio', async () => {
  const p = new GasProject(conso, { gasRoot: config.GAS_ROOT, secrets: {}, log: () => {}, fileStore: null, pnlCanon: () => null });
  // __owniaPnlCanon_ devuelve null → el extra cae al original (Drive), que sin almacén falla: nunca devuelve datos de otra fuente
  assert.throws(() => evalEn(p, '_readCanonical_(CANONICAL_IDS_.ac)'));
});

test('estado avisa si la tabla no abre la columna version (varias versiones se sumarían), y no avisa si la abre', async () => {
  const sin = createPnlFuente({ secrets: {} }, { consolidador: falsoConso({ conVersion: false }), ajustes: SIN_AJ });
  await sin.listo();
  assert.equal(sin.estado().tieneColumnaVersion, false);
  assert.match(sin.estado().advertencia, /columna version.*se suman/);
  const con = createPnlFuente({ secrets: {} }, { consolidador: falsoConso({ conVersion: true }), ajustes: SIN_AJ });
  await con.listo();
  assert.equal(con.estado().tieneColumnaVersion, true);
  assert.equal(con.estado().advertencia, null);
  const nose = createPnlFuente({ secrets: {} }, { consolidador: falsoConso(), ajustes: SIN_AJ });
  await nose.listo();
  assert.equal(nose.estado().tieneColumnaVersion, null);   // un consolidador viejo que no lo informa: ni afirma ni advierte
  assert.equal(nose.estado().advertencia, null);
});

// ── actuals del P&L Managerial (N1 a N5) ───────────────────────────────────────────────────────────────────────────────────
test('listo: además arma el actuals del Managerial (solo hasta el último mes cerrado) y lo expone en canon() y en el estado', async () => {
  const f = createPnlFuente({ secrets: {} }, { consolidador: falsoConso(), ajustes: SIN_AJ });
  await f.listo();
  const c = f.canon();
  assert.equal(c.errorMgr, null);
  assert.equal(c.actualsMgr.rows.length, 2);   // noviembre es run rate
  assert.deepEqual(Object.keys(c.canon).sort(), ['ac', 'bg', 'bl', 'fbtb', 'fc', 'lrr', 'ly', 'rr']);   // el actuals del Managerial no se mezcla con los canónicos del Accounting
  assert.equal(f.estado().managerial.listo, true);
  assert.equal(f.estado().managerial.filas, 2);
});

test('si falla solo el actuals del Managerial: el P&L Accounting sigue, el motivo queda a la vista y se reintenta en el próximo chequeo', async () => {
  let t = 0;
  const conso = falsoConso({ fallarMgr: true });
  const f = createPnlFuente({ secrets: {} }, { consolidador: conso, now: () => t, ajustes: SIN_AJ });
  await f.listo();   // no lanza
  assert.ok(f.canon().canon.ac);
  assert.equal(f.canon().actualsMgr, null);
  assert.match(f.canon().errorMgr, /cubo_mgr roto/);
  assert.equal(f.estado().managerial.listo, false);
  conso.fallarMgr = false; t += 61000;
  await f.listo();   // misma versión, pero reintenta porque había fallado
  assert.equal(f.canon().errorMgr, null);
  assert.equal(f.canon().actualsMgr.rows.length, 2);
});

const mgrConso = MODULES.find((m) => m.slug === 'pnl-managerial');
const mgrDrive = MODULES.find((m) => m.slug === 'pnl-managerial-drive');

test('el P&L Managerial de todos lee la parte contable del consolidador; el respaldo con Drive usa el mismo código y es solo del equipo', () => {
  assert.equal(mgrConso.dir, mgrDrive.dir);
  assert.equal(mgrConso.fuente, 'consolidador');
  assert.deepEqual(mgrConso.gasExtras, ['pnl-managerial-consolidador.js']);
  assert.equal(mgrDrive.fuente, undefined);
  assert.equal(mgrDrive.gasExtras, undefined);
  assert.equal(mgrConso.allowedUsers, undefined, 'abierto a todo el dominio, como antes');
  assert.ok(Array.isArray(mgrDrive.allowedUsers) && mgrDrive.allowedUsers.length > 0, 'el respaldo es solo del equipo');
});

test('módulo real P&L Managerial con fuente consolidador: readAccActualsJSON_ y _accActualsStamp_ salen de la tabla', async () => {
  const f = createPnlFuente({ secrets: {} }, { consolidador: falsoConso(), ajustes: SIN_AJ });
  await f.listo();
  const p = await proyecto(mgrConso, f.canon());
  assert.equal(evalEn(p, '_accActualsStamp_()'), f.canon().modificado);
  assert.equal(evalEn(p, 'readAccActualsJSON_().cols.indexOf("P&L N5")'), 8);
  assert.equal(evalEn(p, 'readAccActualsJSON_().rows.length'), 2);
  const claves = JSON.parse(evalEn(p, "(function(){ var aj = readAccActualsJSON_(); var i = aj.cols.indexOf('P&L N1'); return JSON.stringify(aj.rows.map(function(r){ return r[i]; }).sort()); })()"));
  assert.deepEqual(claves, ['affiliates', 'gross bookings domestic']);
});

test('módulo real P&L Managerial sin el actuals en la fuente: falla con el motivo, no lee Drive', async () => {
  const p = await proyecto(mgrConso, { canon: {}, modificado: 1, actualsMgr: null, errorMgr: 'cubo_mgr roto' });
  assert.throws(() => evalEn(p, 'readAccActualsJSON_()'), /cubo_mgr roto/);
});

test('el respaldo del Managerial NO recibe la fuente del consolidador (sigue leyendo Drive)', async () => {
  const p = await proyecto(mgrDrive, null);
  assert.equal(evalEn(p, 'typeof __owniaPnlCanon_'), 'undefined');
});

// ── series del Hub ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('listo: además arma las 7 series del Hub y las expone en canon() y en el estado', async () => {
  const f = createPnlFuente({ secrets: {} }, { consolidador: falsoConso(), ajustes: SIN_AJ });
  await f.listo();
  const c = f.canon();
  assert.equal(c.errorHub, null);
  assert.deepEqual(Object.keys(c.hub).sort(), ['bg', 'bl', 'fbtb', 'fc', 'lrr', 'ly', 'rr']);
  assert.equal(c.hub.bl.rows.length, 3);
  assert.equal(f.estado().hub.listo, true);
  assert.equal(f.estado().hub.filas.bl, 3);
  assert.deepEqual(Object.keys(c.canon).sort(), ['ac', 'bg', 'bl', 'fbtb', 'fc', 'lrr', 'ly', 'rr']);   // no se mezcla con los canónicos del Accounting
});

test('si falla solo el cubo del Hub: Accounting y Managerial siguen, el motivo queda a la vista y se reintenta', async () => {
  let t = 0;
  const conso = falsoConso({ fallarHub: true });
  const f = createPnlFuente({ secrets: {} }, { consolidador: conso, now: () => t, ajustes: SIN_AJ });
  await f.listo();   // no lanza
  assert.ok(f.canon().canon.ac);
  assert.ok(f.canon().actualsMgr);
  assert.equal(f.canon().hub, null);
  assert.match(f.canon().errorHub, /cubo_hub roto/);
  assert.equal(f.estado().hub.listo, false);
  conso.fallarHub = false; t += 61000;
  await f.listo();
  assert.equal(f.canon().errorHub, null);
  assert.equal(f.canon().hub.bl.rows.length, 3);
});

const hubConso = MODULES.find((m) => m.slug === 'hub');
const hubDrive = MODULES.find((m) => m.slug === 'hub-drive');

test('el Hub de todos lee las series del consolidador; el respaldo con Drive es el mismo módulo, con la misma capa visual, solo para el equipo', () => {
  assert.equal(hubConso.dir, hubDrive.dir);
  assert.equal(hubConso.fuente, 'consolidador');
  assert.deepEqual(hubConso.gasExtras, ['hub-consolidador.js']);
  assert.equal(hubDrive.fuente, undefined);
  assert.equal(hubDrive.gasExtras, undefined);
  assert.deepEqual(hubDrive.layout, hubConso.layout);
  assert.equal(hubConso.allowedUsers, undefined, 'abierto a todo el dominio, como antes');
  assert.ok(Array.isArray(hubDrive.allowedUsers) && hubDrive.allowedUsers.length > 0, 'el respaldo es solo del equipo');
});

test('módulo real Hub con fuente consolidador: readJson_ devuelve las series de la tabla con el formato de Drive, y _getJsonsLastMod_ sigue la versión', async () => {
  const f = createPnlFuente({ secrets: {} }, { consolidador: falsoConso(), ajustes: SIN_AJ });
  await f.listo();
  const p = await proyecto(hubConso, f.canon());
  assert.equal(evalEn(p, 'typeof __owniaPnlCanon_'), 'function');
  const filas = JSON.parse(evalEn(p, 'JSON.stringify(readJson_(JSON_IDS.baseline).map(function(r){ return [r["lob"], r["canal"], r["p&l n1"], r["p&l n3"], r["p&l n5"], r["p&l managerial view"], r["fecha"], r["monto usd"]]; }))'));
  assert.equal(filas.length, 3);
  const fb = filas.find((r) => r[2] === 'gross bookings domestic');
  assert.equal(fb[6], Date.UTC(2026, 3, 1), 'fecha en ms UTC, como la lee el Hub');
  assert.equal(fb[7], 100);
  assert.ok(filas.some((r) => r[0] === 'b2c'), 'el Hub usa B2C');
  assert.equal(evalEn(p, 'readJson_(JSON_IDS.baseline) === readJson_(JSON_IDS.baseline)'), true, 'se memoriza en _jsonCache_ como el original');
  assert.ok(evalEn(p, '_getJsonsLastMod_()') >= f.canon().modificado);
  // las series se arman con el mismo vocabulario con que el Hub agrupa: buildMap_ corre sobre ellas
  assert.ok(evalEn(p, 'Object.keys(buildMap_(readJson_(JSON_IDS.baseline)).map).length') > 0);
});

test('módulo real Hub sin las series en la fuente: falla con el motivo, no lee Drive', async () => {
  const p = await proyecto(hubConso, { canon: {}, modificado: 1, hub: null, errorHub: 'cubo_hub roto' });
  assert.throws(() => evalEn(p, 'readJson_(JSON_IDS.ly)'), /cubo_hub roto/);
});

test('el respaldo del Hub NO recibe la fuente del consolidador (sigue leyendo Drive)', async () => {
  const p = await proyecto(hubDrive, null);
  assert.equal(evalEn(p, 'typeof __owniaPnlCanon_'), 'undefined');
});

// ── LRR desde Drive mientras conso no cargue la ronda correcta (LRR_DESDE_DRIVE_, 2026-11-24) ─────────────────────────────────
// Almacén mínimo con solo lastrunrate.json: lo demás tiene que seguir saliendo de la tabla.
const LRR_ID = '1Nk56QlEA2hKuWGhfZ1357Eds6DhU8zwC';
function almacenLrr(updatedAt) {
  const j = { meta: { concepto: 'lastrunrate' }, cols: ['LoB', 'Canal', 'Pais', 'Producto', 'P&L N2', 'Fecha', 'Monto USD'],
    rows: [['b2b2c', 'total', 'brasil', 'hotels', 'gross bookings', '2026-11-01', 777]] };
  const entry = { buf: Buffer.from(JSON.stringify(j)), meta: { id: LRR_ID, name: 'lastrunrate.json', mimeType: 'application/json', updatedAt } };
  return { get: (id) => (id === LRR_ID ? entry : null), findByName: () => [], inFolder: () => [], hasFolder: () => false, listMeta: () => [] };
}

test('P&L Accounting: el LRR sale de lastrunrate.json de Drive, el resto de la tabla, y el cache sigue también al archivo', async () => {
  const { canon } = buildCanonicals({ cols: COLS, rows: FILAS }, { ajustes: { cols: [], rows: [] } });
  const p = new GasProject(conso, { gasRoot: config.GAS_ROOT, secrets: {}, log: () => {}, fileStore: almacenLrr(9999), pnlCanon: () => ({ canon, modificado: 4242 }) });
  assert.equal(evalEn(p, 'LRR_DESDE_DRIVE_'), true);
  assert.equal(evalEn(p, '_readCanonical_(CANONICAL_IDS_.lrr).meta.concepto'), 'lastrunrate');
  assert.equal(evalEn(p, '_readCanonical_(CANONICAL_IDS_.lrr).rows[0][6]'), 777);
  assert.equal(evalEn(p, '_readCanonical_(CANONICAL_IDS_.bg).meta.concepto'), 'bg', 'el resto sigue en la tabla');
  assert.equal(evalEn(p, '_canonicalsMaxMod_()'), 9999, 'si cambia lastrunrate.json se renuevan los caches');
  evalEn(p, 'LRR_DESDE_DRIVE_ = false');
  assert.equal(evalEn(p, '_readCanonical_(CANONICAL_IDS_.lrr).meta.concepto'), 'lrr', 'apagado vuelve al LRR de la tabla');
  assert.equal(evalEn(p, '_canonicalsMaxMod_()'), 4242);
});

test('Hub: el Goal Last Run Rate sale de lastrunrate.json de Drive, el resto de la tabla', async () => {
  const f = createPnlFuente({ secrets: {} }, { consolidador: falsoConso(), ajustes: SIN_AJ });
  await f.listo();
  const p = new GasProject(hubConso, { gasRoot: config.GAS_ROOT, secrets: {}, log: () => {}, fileStore: almacenLrr(9e12), pnlCanon: f.canon });
  const filas = JSON.parse(evalEn(p, 'JSON.stringify(readJson_(JSON_IDS.lastrunrate))'));
  assert.equal(filas.length, 1);
  assert.equal(filas[0]['monto usd'], 777);
  assert.equal(filas[0]['fecha'], Date.UTC(2026, 10, 1));
  assert.ok(evalEn(p, 'readJson_(JSON_IDS.baseline).length') > 0, 'el resto sigue en la tabla');
  assert.equal(evalEn(p, '_getJsonsLastMod_()'), 9e12);
});
