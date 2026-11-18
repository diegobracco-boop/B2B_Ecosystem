// /ingest/canon/<serie>: los canónicos del P&L para los scripts Python (OKR, FCA, flow_oc, organic), desde el consolidador (pnl-fuente.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createApp } = require('../server/index');
const { createPnlFuente } = require('../server/pnl-fuente');

const BASE = '/b2b-ecosystem';
const TOKEN = 'token-de-prueba';
const DATA = { slug: 'data', dir: 'Data_Module', title: 'Data', desc: 'x', ownia: true, gasUrl: '' };
const SIN_AJ = { cols: [], rows: [] };

const COLS = ['scenario', 'year', 'mes', 'pais', 'lob', 'channel', 'product', 'n2', 'valor'];
const COLS_HUB = ['scenario', 'year', 'mes', 'pais', 'lob', 'channel', 'product', 'linea', 'n2', 'n3', 'valor'];
const FILAS_HUB = [
  ['ACT', 'FY27', 4, 'Brazil', 'B2B2C', 'ON', 'Hotel', 'Fees', 'Customer Fees & Charges', 'Net Revenues', 50],
  ['ACT', 'FY27', 11, 'Brazil', 'B2B2C', 'ON', 'Hotel', 'Fees', 'Customer Fees & Charges', 'Net Revenues', 70],   // run rate: no es 'ac'
  ['BGT', 'FY27', 4, 'Brazil', 'B2B2C', 'ON', 'Hotel', 'Fees', 'Customer Fees & Charges', 'Net Revenues', 60],
];

function falsoConso({ fallarHub = false } = {}) {
  return {
    leer: async (cmd) => {
      if (cmd === 'versiones') return { ok: true, data: { dataset: 'x', version: 1, publicado_en: '2026-11-18T10:00:00+00:00' } };
      if (cmd === 'cubo_hub') return fallarHub ? { ok: false, code: 502, error: 'cubo_hub roto' } : { ok: true, data: { cols: COLS_HUB, rows: FILAS_HUB } };
      if (cmd === 'cubo_mgr') return { ok: true, data: { cols: ['year', 'mes', 'pais', 'lob', 'channel', 'product', 'linea', 'n2', 'n3', 'valor'], rows: [] } };
      return { ok: true, data: { version: 1, cols: COLS, rows: [] } };
    },
  };
}

let server;
let app;
let storeDir;
const apps = [];

async function levantar(conso) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownia-canon-'));
  const a = createApp({
    GAS_ROOT: path.join(__dirname, 'fixtures'), BASE_PATH: BASE, modules: [DATA], secrets: {}, FILE_STORE_DIR: dir, INGEST_TOKEN: TOKEN,
    FILE_STORE_POLL_MS: 0, manifest: { modules: { data: { files: {}, folders: {} } } }, consolidador: null,
    pnlFuente: createPnlFuente({ secrets: {} }, { consolidador: conso, ajustes: SIN_AJ }),
  });
  await a.startData();
  const s = await new Promise((resolve) => { const x = http.createServer(a.handler).listen(0, '127.0.0.1', () => resolve(x)); });
  apps.push({ a, s, dir });
  return s;
}

function request(srv, method, urlPath, headers = {}) {
  const { port } = srv.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}
const auth = { Authorization: `Bearer ${TOKEN}` };
const json = (r) => JSON.parse((r.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(r.buf) : r.buf).toString('utf8'));

before(async () => { server = await levantar(falsoConso()); });
after(() => { for (const { a, s, dir } of apps) { s.close(); a.fileStore.stop(); fs.rmSync(dir, { recursive: true, force: true }); } });

test('canon: sin token o con token incorrecto → 401', async () => {
  assert.equal((await request(server, 'GET', `${BASE}/ingest/canon/bl`)).status, 401);
  assert.equal((await request(server, 'GET', `${BASE}/ingest/canon/bl`, { Authorization: 'Bearer otro' })).status, 401);
});

test('canon: devuelve la serie con el formato de los JSON de Drive (cols, rows y meta), con el vocabulario de Drive', async () => {
  const r = await request(server, 'GET', `${BASE}/ingest/canon/bg`, auth);
  assert.equal(r.status, 200);
  const j = json(r);
  assert.deepEqual(j.cols, ['LoB', 'Canal', 'Pais', 'Producto', 'P&L N1', 'P&L N2', 'P&L N3', 'P&L N5', 'P&L Managerial View', 'Fecha', 'Monto USD']);
  assert.equal(j.meta.concepto, 'bg');
  assert.deepEqual(j.rows, [['b2b2c', 'total', 'brasil', 'hotels', 'fees', 'customer fees & charges', 'net revenue', 'operating contribution', j.rows[0][8], '2026-04-01', 60]]);
});

test("canon: 'ac' son los actuals cerrados (el baseline hasta el último mes cerrado), con sus fechas en meta", async () => {
  const j = json(await request(server, 'GET', `${BASE}/ingest/canon/ac`, auth));
  assert.equal(j.rows.length, 1);
  assert.equal(j.rows[0][9], '2026-04-01');
  assert.deepEqual(j.meta.fechas, ['2026-04-01']);   // flow_oc usa meta.fechas para saber qué meses están cerrados
  const bl = json(await request(server, 'GET', `${BASE}/ingest/canon/bl`, auth));
  assert.equal(bl.rows.length, 2);                   // el baseline trae también el run rate de noviembre
});

test('canon: con gzip comprime y es el mismo JSON', async () => {
  const plano = await request(server, 'GET', `${BASE}/ingest/canon/bl`, auth);
  const gz = await request(server, 'GET', `${BASE}/ingest/canon/bl`, { ...auth, 'Accept-Encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.deepEqual(json(gz), json(plano));
});

test('canon: serie inválida → 400 y método incorrecto → 405', async () => {
  assert.equal((await request(server, 'GET', `${BASE}/ingest/canon/xx`, auth)).status, 400);
  assert.equal((await request(server, 'POST', `${BASE}/ingest/canon/bl`, auth)).status, 405);
});

test('canon: si el consolidador no armó las series del Hub → 503 con el motivo (no hay respaldo en Drive)', async () => {
  const srv = await levantar(falsoConso({ fallarHub: true }));
  const r = await request(srv, 'GET', `${BASE}/ingest/canon/bl`, auth);
  assert.equal(r.status, 503);
  assert.match(json(r).error, /cubo_hub roto/);
});
