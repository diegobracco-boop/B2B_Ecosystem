// Lectura del consolidador del P&L (server/consolidador.js + ruta /consolidador/<consulta>): permisos, qué se lanza,
// errores legibles y que no se filtre nada. El proceso de Python se reemplaza por una función falsa.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { createApp } = require('../server/index');
const { createConsolidador } = require('../server/consolidador');

const BASE = '/b2b-ecosystem';
const FIXTURES = path.join(__dirname, 'fixtures');
const APP_ROOT = path.resolve(__dirname, '..');
const DEMO = { slug: 'demo', dir: 'Demo_Module', title: 'Demo', desc: 'demo', ownia: true, requiresIdentity: false, gasUrl: '' };
const EQUIPO = ['ana@despegar.com'];
const SECRETS = { CONSOLIDADOR_DB_NAME: 'consolidador_db', DB_HOST: 'host.rds', DB_USER: 'ownia_b2b_ecosystem' };
const ANA = { 'x-test-email': 'Ana@despegar.com' };
const OTRO = { 'x-test-email': 'otro@despegar.com' };

const lanzados = [];
let respuesta;   // { err, stdout, stderr } lo que devuelve el Python falso
function fakeExec(cmd, args, opts, cb) {
  lanzados.push({ cmd, args, opts });
  setImmediate(() => cb(respuesta.err || null, respuesta.stdout || '', respuesta.stderr || ''));
}

let server;
const logs = [];
function makeApp(secrets = SECRETS) {
  const cfg = { secrets, APP_ROOT };
  const consolidador = createConsolidador(cfg, { execFile: fakeExec, python: 'py-falso', log: (l) => logs.push(l) });
  return createApp({ GAS_ROOT: FIXTURES, BASE_PATH: BASE, modules: [DEMO], secrets, TRUSTED_IDENTITY_HEADER: 'x-test-email', fileStore: null, reales: null, realesUsers: EQUIPO, consolidador });
}
function listen(app) {
  return new Promise((resolve) => { const s = http.createServer(app.handler).listen(0, '127.0.0.1', () => resolve(s)); });
}
function get(s, urlPath, headers = {}, method = 'GET') {
  const { port } = s.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => { server = await listen(makeApp()); });
after(() => server.close());

test('permisos: sin identidad 401, fuera del equipo 403, y no lanza nada', async () => {
  lanzados.length = 0;
  assert.equal((await get(server, `${BASE}/consolidador/versiones`)).status, 401);
  assert.equal((await get(server, `${BASE}/consolidador/versiones`, OTRO)).status, 403);
  assert.equal(lanzados.length, 0);
});

test('solo GET, y una consulta que no existe da 404 sin lanzar nada', async () => {
  lanzados.length = 0;
  assert.equal((await get(server, `${BASE}/consolidador/resumen`, ANA, 'POST')).status, 405);
  assert.equal((await get(server, `${BASE}/consolidador/otra`, ANA)).status, 404);
  assert.equal((await get(server, `${BASE}/consolidador/..%2Fetc`, ANA)).status, 404);
  assert.equal(lanzados.length, 0);
});

test('versiones y resumen: lanza consolidador_leer.py con la consulta y devuelve su JSON', async () => {
  lanzados.length = 0;
  respuesta = { stdout: JSON.stringify({ dataset: 'app_b2b_ecosystem', version: 'v1', filas: 3 }) };
  const v = await get(server, `${BASE}/consolidador/versiones`, ANA);
  assert.equal(v.status, 200, v.text);
  assert.deepEqual(JSON.parse(v.text), { dataset: 'app_b2b_ecosystem', version: 'v1', filas: 3 });
  respuesta = { stdout: JSON.stringify([{ pais: 'Argentina', mes: '2026-10', valor: 1.5 }]) };
  const r = await get(server, `${BASE}/consolidador/resumen`, ANA);
  assert.equal(r.status, 200, r.text);
  assert.equal(JSON.parse(r.text)[0].pais, 'Argentina');
  assert.equal(lanzados.length, 2);
  assert.equal(lanzados[0].cmd, 'py-falso');
  assert.equal(path.basename(lanzados[0].args[0]), 'consolidador_leer.py');
  assert.deepEqual([lanzados[0].args[1], lanzados[1].args[1]], ['versiones', 'resumen']);
  assert.ok(lanzados[0].opts.timeout > 120000, 'el corte del servidor va después del de la base (2 min)');
});

test('si el Python falla: 502 con la última línea del error, y queda en el log', async () => {
  logs.length = 0;
  respuesta = { err: new Error('exit 1'), stderr: 'Traceback...\npsycopg2.errors.InsufficientPrivilege: permission denied for table app_b2b_ecosystem\n' };
  const r = await get(server, `${BASE}/consolidador/resumen`, ANA);
  assert.equal(r.status, 502);
  assert.match(JSON.parse(r.text).error, /permission denied/);
  assert.doesNotMatch(r.text, /Traceback/);
  assert.ok(logs.some((l) => l.level === 'error' && l.comando === 'resumen'));
});

test('si el Python no devuelve JSON: 502 sin pasar el contenido', async () => {
  respuesta = { stdout: 'no soy json <html>' };
  const r = await get(server, `${BASE}/consolidador/resumen`, ANA);
  assert.equal(r.status, 502);
  assert.doesNotMatch(r.text, /html/);
});

test('sin CONSOLIDADOR_DB_NAME: 503 diciendo qué falta, sin lanzar nada', async () => {
  lanzados.length = 0;
  const s = await listen(makeApp({ DB_HOST: 'host.rds', DB_USER: 'ownia_b2b_ecosystem' }));
  try {
    const r = await get(s, `${BASE}/consolidador/versiones`, ANA);
    assert.equal(r.status, 503);
    assert.match(JSON.parse(r.text).error, /CONSOLIDADOR_DB_NAME/);
    assert.equal(lanzados.length, 0);
  } finally { s.close(); }
});

test('dimensiones: es una consulta válida y devuelve el JSON del Python', async () => {
  lanzados.length = 0;
  respuesta = { stdout: JSON.stringify({ combos: [{ scenario: 'ACT', year: 'FY27', mes: 4, filas: 10, valor: 1 }], valores: { pais: [{ valor: 'Brazil', filas: 5 }] } }) };
  const r = await get(server, `${BASE}/consolidador/dimensiones`, ANA);
  assert.equal(r.status, 200, r.text);
  assert.equal(JSON.parse(r.text).valores.pais[0].valor, 'Brazil');
  assert.equal(lanzados[0].args[1], 'dimensiones');
});

test('drive: solo el equipo, y sin almacén dice qué escenarios no están (sin lanzar Python)', async () => {
  lanzados.length = 0;
  assert.equal((await get(server, `${BASE}/consolidador/drive`)).status, 401);
  assert.equal((await get(server, `${BASE}/consolidador/drive`, OTRO)).status, 403);
  const r = await get(server, `${BASE}/consolidador/drive`, ANA);
  assert.equal(r.status, 200, r.text);
  const j = JSON.parse(r.text);
  assert.deepEqual(Object.keys(j).sort(), ['ac', 'bg', 'bl', 'fbtb', 'fc', 'lrr', 'ly', 'rr']);
  assert.match(j.ac.error, /no está en el almacén/);
  assert.equal(lanzados.length, 0);
});

test('driveDimensiones: columnas, filas, monto por mes y valores distintos de un canónico', () => {
  const { driveDimensiones, IDS } = require('../server/pnl-drive-dimensiones');
  const json = { meta: { fechas: ['2026-04-01'] }, cols: ['LoB', 'Canal', 'Pais', 'Producto', 'P&L N2', 'Fecha', 'Monto USD'], rows: [
    ['B2B', 'MAY', 'Brasil', 'Air', 'Gross Bookings', '2026-04-01', 10],
    ['B2B', 'MIN', 'Brasil', 'Hotel', 'Gross Bookings', '2026-04-01', 5],
    ['B2B2C', 'total', 'Chile', 'Air', 'Orders', '2026-05-01', 2],
  ] };
  const store = { get: (id) => (id === IDS.ac ? { meta: { updatedAt: 0 }, buf: Buffer.from(JSON.stringify(json)) } : null) };
  const out = driveDimensiones(store);
  assert.equal(out.ac.filas, 3);
  assert.deepEqual(out.ac.montoPorMes, { '2026-04': 15, '2026-05': 2 });
  assert.equal(out.ac.valores.Pais.distintos, 2);
  assert.deepEqual(out.ac.valores.Pais.top[0], { valor: 'Brasil', filas: 2 });
  assert.deepEqual(out.ac.fechasMeta, ['2026-04-01']);
  assert.match(out.bg.error, /no está/);
});

test('cubo (la tabla entera) no se puede pedir directo: solo lo usa /comparar por dentro', async () => {
  lanzados.length = 0;
  const r = await get(server, `${BASE}/consolidador/cubo`, ANA);
  assert.equal(r.status, 404);
  assert.equal(lanzados.length, 0);
});

test('detalle es una consulta válida', async () => {
  lanzados.length = 0;
  respuesta = { stdout: JSON.stringify([{ product: 'Air', n2: 'Sourcing', linea: 'Alianzas Financieras', filas: 1, valor: 2 }]) };
  const r = await get(server, `${BASE}/consolidador/detalle`, ANA);
  assert.equal(r.status, 200, r.text);
  assert.equal(lanzados[0].args[1], 'detalle');
});
