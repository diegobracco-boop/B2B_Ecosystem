// "B2B2C Tracker" (server/b2b2c-tracker.js + página): semana ISO, YoY, tendencia, tráfico incompleto, período en curso a igualdad
// de días y permisos de la ruta (por ahora solo B2B2C_TRACKER.allowedUsers).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const T = require('../server/b2b2c-tracker');
const { createApp } = require('../server/index');
const { B2B2C_TRACKER } = require('../server/modules');

const LAST = '2026-11-04';   // miércoles de la semana 2026-45: la semana en curso va de lunes a miércoles
const day = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// Daily: A (Brasil, Vuelos) 10 orders por día y B (Argentina, Hoteles) 5 por día, del 2025-08-01 al LAST.
function dailyJson() {
  const cols = ['fecha', 'pais', 'productooriginal', 'partner', 'account_type', 'region', 'tier', 'orders', 'gross_bookings', 'net_revenues', 'fvm'];
  const act = [], ly = [];
  for (let d = '2025-08-01'; d <= LAST; d = day(d, 1)) {
    const rows = [[d, 'Brasil', 'Flights', 'A', 'Existing', 'BR', 'Tier-1', 10, 1000, 100, 40], [d, 'Argentina', 'Hotels', 'B', 'Existing', 'HISPA', 'Tier-1', 5, 500, 50, 20]];
    (d < '2026-01-01' ? ly : act).push(...rows);
  }
  return { meta: { last_actuals_date: LAST, actuals_from: '2026-01-01' }, actuals: { cols, rows: act }, actuals_ly: { cols, rows: ly } };
}

// Tráfico: por semana, App y Site, con bookings que cierran con las orders (105 por semana completa). 2025-40 y 2026-38 incompletas.
function trafficJson() {
  const dims = { partner: ['A'], site: ['BR'], plataforma: ['App', 'Site-Mobile'], producto: ['Vuelos'] };
  const rows = [];
  const weeks = [];
  for (let w = 32; w <= 52; w++) weeks.push('2025-' + w);
  for (let w = 1; w <= 45; w++) weeks.push('2026-' + String(w).padStart(2, '0'));
  for (const yw of weeks) {
    const mon = T.weekStart(yw), mes = +mon.slice(5, 7), anio = +mon.slice(0, 4);
    const low = yw === '2025-40' || yw === '2026-38';
    rows.push([yw, anio, mes, 0, 0, 0, 0, low ? 1 : 400, 80, 40, 20, 18, low ? 1 : 40]);
    rows.push([yw, anio, mes, 0, 0, 1, 0, low ? 1 : 600, 120, 60, 30, 27, low ? 1 : 65]);
  }
  return { actualizado: '2026-11-05', hasta: '2026-45', dims, cols: ['yw', 'anio', 'mes', 'partner', 'site', 'plataforma', 'producto', 'usuarios', 'search', 'detail', 'pi', 'checkout', 'bookings'], rows };
}

function fakeStore() {
  const files = {
    [T.TRAFFIC_FILE]: { buf: Buffer.from(JSON.stringify(trafficJson())), meta: { updatedAt: 1, sha256: 't1' } },
    [T.DAILY_FILE]: { buf: Buffer.from(JSON.stringify(dailyJson())), meta: { updatedAt: 1, sha256: 'd1' } },
  };
  return { findByName: (folder, name) => (folder === T.DAILY_FOLDER_ID && files[name] ? [files[name]] : []), listMeta: () => [], inFolder: () => [], hasFolder: () => false, get: () => null,
    onChange: () => {}, refresh: async () => {}, startPolling: () => {}, stop: () => {} };
}
const api = (store, qs) => T.trackerApi(store, new URLSearchParams(qs));

test('semana ISO: lunes a domingo, con el cambio de año como la tabla de tráfico', () => {
  assert.equal(T.isoWeek('2026-11-09'), '2026-46');
  assert.equal(T.isoWeek('2026-11-08'), '2026-45');
  assert.equal(T.isoWeek('2025-12-29'), '2026-01');
  assert.equal(T.isoWeek('2027-01-03'), '2026-53');
  assert.equal(T.weekStart('2026-46'), '2026-11-09');
  assert.equal(T.weekStart('2026-01'), '2025-12-29');
});

test('semanal: última semana cerrada por default, YoY contra la misma semana y tendencia = promedio de las 4 anteriores', () => {
  T._reset();
  const s = api(fakeStore(), 'gran=w');
  assert.equal(s.partialKey, '2026-45');
  assert.equal(s.defaultKey, '2026-44');
  const p = s.periods.find((x) => x.k === '2026-44');
  assert.deepEqual(p.cur.r, [105, 10500, 1050, 420]);
  assert.deepEqual(p.ly.r, [105, 10500, 1050, 420]);
  assert.deepEqual(p.tr.r, [105, 10500, 1050, 420]);
  assert.deepEqual(p.cur.t, [1000, 200, 100, 50, 45, 105]);
  assert.deepEqual(p.ly.t, [1000, 200, 100, 50, 45, 105]);
});

test('tráfico incompleto: se marca y queda fuera del YoY y de la tendencia (los resultados no se tocan)', () => {
  T._reset();
  const s = api(fakeStore(), 'gran=w');
  const by = (k) => s.periods.find((x) => x.k === k);
  assert.equal(by('2025-40').flag, true);
  assert.equal(by('2026-38').flag, true);
  assert.equal(by('2026-40').ly.t, null, 'LY incompleto → sin YoY de tráfico');
  assert.equal(by('2026-40').ly.flag, true);
  assert.deepEqual(by('2026-40').ly.r, [105, 10500, 1050, 420], 'los resultados sí tienen YoY');
  assert.deepEqual(by('2026-42').tr.t, [1000, 200, 100, 50, 45, 105], 'la tendencia promedia las semanas completas (sin la 38)');
  assert.equal(by('2026-38').ly.t, null, 'una semana incompleta no se compara');
});

test('semana en curso: resultados a igualdad de días (LY y tendencia hasta el mismo día); tráfico sin comparar', () => {
  T._reset();
  const p = api(fakeStore(), 'gran=w').periods.find((x) => x.k === '2026-45');
  assert.equal(p.partial, true);
  assert.equal(p.cur.r[0], 45);    // lunes a miércoles
  assert.equal(p.ly.r[0], 45);     // lunes a miércoles de la semana 45 de 2025
  assert.equal(p.tr.r[0], 45);     // promedio de lunes a miércoles de las 4 anteriores
  assert.equal(p.ly.t, null);
  assert.equal(p.tr.t, null);
});

test('mensual: suma por mes, mes en curso cortado al mismo día; plataforma solo filtra el tráfico', () => {
  T._reset();
  const m = api(fakeStore(), 'gran=m');
  assert.equal(m.partialKey, '2026-11');
  assert.equal(m.defaultKey, '2026-10');
  const oct = m.periods.find((x) => x.k === '2026-10');
  assert.equal(oct.cur.r[0], 31 * 15);
  const nov = m.periods.find((x) => x.k === '2026-11');
  assert.equal(nov.cur.r[0], 4 * 15);
  assert.equal(nov.ly.r[0], 4 * 15);
  const app = api(fakeStore(), 'gran=w&plat=App').periods.find((x) => x.k === '2026-44');
  assert.deepEqual(app.cur.r, [105, 10500, 1050, 420], 'plataforma no cambia los resultados');
  assert.equal(app.cur.t[5], 40);
});

test('apertura por partner: una fila por partner con sus resultados; filtro por región', () => {
  T._reset();
  const b = api(fakeStore(), 'gran=w&dim=partner&k=2026-44');
  assert.deepEqual(b.rows.map((r) => [r.lbl, r.cur.r[0]]), [['A', 70], ['B', 35]]);
  assert.equal(b.rows[0].cur.t[5], 105);
  assert.equal(b.rows[1].cur.t, null, 'B no tiene tráfico (como un partner por API)');
  const br = api(fakeStore(), 'gran=w&region=BR').periods.find((x) => x.k === '2026-44');
  assert.equal(br.cur.r[0], 70);
});

// ── Ruta y menú ──
let server;
function get(p, email) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    http.get({ host: '127.0.0.1', port, path: '/b2b-ecosystem' + p, headers: email ? { 'x-test-email': email } : {} }, (res) => {
      const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString('utf8') }));
    }).on('error', reject);
  });
}
before(async () => {
  T._reset();
  const app = createApp({ BASE_PATH: '/b2b-ecosystem', TRUSTED_IDENTITY_HEADER: 'x-test-email', fileStore: fakeStore(), modules: [] });
  server = await new Promise((r) => { const s = http.createServer(app.handler).listen(0, '127.0.0.1', () => r(s)); });
});
after(() => server.close());

test('ruta: sin identidad 401, fuera de allowedUsers 403, Diego 200 (página y datos)', async () => {
  const ok = B2B2C_TRACKER.allowedUsers[0];
  assert.equal((await get('/b2b2c-tracker')).status, 401);
  assert.equal((await get('/b2b2c-tracker', 'otra.persona@despegar.com')).status, 403);
  assert.equal((await get('/b2b2c-tracker/data?gran=w', 'otra.persona@despegar.com')).status, 403);
  const page = await get('/b2b2c-tracker', ok);
  assert.equal(page.status, 200);
  assert.match(page.text, /B2B2C Tracker/);
  const data = await get('/b2b2c-tracker/data?gran=w', ok);
  assert.equal(data.status, 200);
  assert.equal(JSON.parse(data.text).defaultKey, '2026-44');
});

test('menú: "B2B2C Tracker" en Más tableros solo para quien lo puede abrir', async () => {
  const ok = B2B2C_TRACKER.allowedUsers[0];
  assert.match((await get('/', ok)).text, /card-b2b2c-tracker/);
  assert.doesNotMatch((await get('/', 'otra.persona@despegar.com')).text, /b2b2c-tracker/);
});

test('hueco del Daily (dic sin días, solo el total mensual): el mensual lo usa; las semanas quedan sin resultados y sin marcar', () => {
  T._reset();
  const d = dailyJson(), cols = d.actuals_ly.cols;
  d.meta.ly_to = '2025-11-30';
  d.actuals_ly.rows = d.actuals_ly.rows.filter((r) => r[0] <= '2025-11-30');
  d.actuals_ly_fy_rest = { cols, rows: [['2025-12-01', 'Brasil', 'Flights', 'A', 'Existing', 'BR', 'Tier-1', 310, 31000, 3100, 1240]] };
  const store = fakeStore(), files = { [T.DAILY_FILE]: { buf: Buffer.from(JSON.stringify(d)), meta: { updatedAt: 2, sha256: 'gap' } } };
  const base = store.findByName;
  store.findByName = (folder, name) => files[name] ? [files[name]] : base(folder, name);
  const m = api(store, 'gran=m');
  assert.equal(m.periods.find((x) => x.k === '2025-12').cur.r[0], 310);
  const w = api(store, 'gran=w'), by = (k) => w.periods.find((x) => x.k === k);
  assert.equal(by('2025-50').cur.r, null);
  assert.equal(by('2025-50').flag, false, 'sin resultados no se puede juzgar el tráfico: no se marca');
  assert.equal(by('2026-01').cur.r, null, 'la semana 1 toca dic-25');
  assert.equal(by('2026-02').tr.r, null, 'la tendencia no promedia semanas sin resultados');
  assert.deepEqual(by('2026-44').cur.r, [105, 10500, 1050, 420]);
});

test('moonshot: arma una fila por partner × país, sin base queda "a validar" y nunca es candidato', () => {
  T._reset();
  const m = T.moonshot(T.loadData(fakeStore()));
  assert.ok(m.rows.length >= 1);
  const a = m.rows.find((r) => r.partner === 'A' && r.pais === 'Brasil');
  assert.ok(a, 'A Brasil');
  assert.deepEqual(a.flags, ['sin_base']);
  assert.equal(a.validar, true);
  assert.equal(a.cand, false);
  assert.ok(a.multR >= 1 && a.multM >= a.multR);
});
