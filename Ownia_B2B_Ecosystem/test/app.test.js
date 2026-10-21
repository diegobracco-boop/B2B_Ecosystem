const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { createApp } = require('../server/index');
const config = require('../server/config');
const { MODULES } = require('../server/modules');

const BASE = '/b2b-ecosystem';
const FIXTURES = path.join(__dirname, 'fixtures');
const DEMO = { slug: 'demo', dir: 'Demo_Module', title: 'Demo', desc: 'demo', ownia: true, requiresIdentity: false, gasUrl: '' };
// Mismo proyecto, con el default (requiere identidad), como cualquier módulo con datos.
const DEMO_PRIV = { slug: 'demo-privado', dir: 'Demo_Module', title: 'Demo privado', desc: 'demo', ownia: true, gasUrl: '' };
const RUN_HEADERS = { 'X-Requested-With': 'google.script.run' };
const PENDIENTE = { slug: 'pendiente', dir: 'No_Existe', title: 'Pendiente', desc: 'x', ownia: false, gasUrl: 'https://script.google.com/x/exec' };

let demoServer;
let realServer;

function listen(app) {
  return new Promise((resolve) => {
    const s = http.createServer(app.handler).listen(0, '127.0.0.1', () => resolve(s));
  });
}

function request(server, method, urlPath, { body, headers } = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { ...(headers || {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const run = (fn, args, headers, slug = 'demo') =>
  request(demoServer, 'POST', `${BASE}/api/${slug}/${fn}`, { body: { args: args || [] }, headers: { ...RUN_HEADERS, ...(headers || {}) } });

before(async () => {
  demoServer = await listen(createApp({ GAS_ROOT: FIXTURES, BASE_PATH: BASE, modules: [DEMO, DEMO_PRIV, PENDIENTE], secrets: {}, TRUSTED_IDENTITY_HEADER: 'x-test-email', CALL_TIMEOUT_MS: 300 }));
  realServer = await listen(createApp({ BASE_PATH: BASE }));
});

after(() => {
  demoServer.close();
  realServer.close();
});

test('health responde sin prefijo y con prefijo', async () => {
  for (const p of ['/health', `${BASE}/health`]) {
    const r = await request(demoServer, 'GET', p);
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.text).status, 'ok');
  }
});

test('portada lista módulos migrados (link interno) y pendientes (link GAS)', async () => {
  const r = await request(demoServer, 'GET', `${BASE}/`);
  assert.equal(r.status, 200);
  assert.match(r.text, new RegExp(`href="${BASE}/demo"`));
  assert.match(r.text, /href="https:\/\/script\.google\.com\/x\/exec"/);
});

test('doGet: template con scriptlets, include, título, meta y shim inyectados', async () => {
  const r = await request(demoServer, 'GET', `${BASE}/demo`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-frame-options'], undefined, 'ALLOWALL no manda X-Frame-Options');
  assert.match(r.text, /<title>Demo GAS<\/title>/);
  assert.doesNotMatch(r.text, /titulo del archivo/, 'setTitle pisa el <title> del archivo');
  assert.match(r.text, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
  assert.match(r.text, new RegExp(`<script src="${BASE}/_gas/client\\.js\\?v=\\w+" data-api="${BASE}/api/demo"></script>`));
  assert.match(r.text, /<style>body \{ color: #550fed; \}<\/style>/, '<?!= include() ?> sin escapar');
  assert.match(r.text, /<p id="esc">&lt;hola&gt;<\/p>/, '<?= ?> escapa (y tolera un // adentro)');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.match(r.text, /<li>0<\/li><li>1<\/li><li>2<\/li>/);
  // El shim va antes que cualquier otro contenido del head.
  assert.ok(r.text.indexOf('_gas/client.js') < r.text.indexOf('<style>'));
});

test('doGet: ContentService + pathInfo + parámetros', async () => {
  const r = await request(demoServer, 'GET', `${BASE}/demo/a/b?format=json`);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /application\/json/);
  assert.deepEqual(JSON.parse(r.text), { ok: true, path: 'a/b' });
});

test('google.script.run: llama funciones públicas con argumentos', async () => {
  const r = await run('sumar', [2, 3]);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), { result: 5 });
});

test('los argumentos son Arrays del realm del módulo (instanceof Array)', async () => {
  const r = await run('esArray', [[1, 2]]);
  assert.deepEqual(JSON.parse(r.text), { result: true });
});

test('solo se invocan funciones propias del proyecto (no privadas, shims ni heredadas)', async () => {
  for (const fn of ['privada_', 'doGet', 'noExiste', 'constructor', 'toString', 'hasOwnProperty', 'valueOf',
    '__proto__', 'setTimeout', 'HtmlService', 'Utilities', 'eval', 'Function', '__owniaInvoke_']) {
    assert.equal((await run(fn)).status, 404, fn);
  }
});

test('anti-CSRF: sin header custom, con Content-Type de form o cross-site → 403', async () => {
  const p = `${BASE}/api/demo/sumar`;
  const sinHeader = await request(demoServer, 'POST', p, { body: { args: [1, 2] } });
  assert.equal(sinHeader.status, 403);
  const crossSite = await run('sumar', [1, 2], { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(crossSite.status, 403);
  const { port } = demoServer.address();
  const form = await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, headers: { 'Content-Type': 'text/plain', ...RUN_HEADERS } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.end('{"args":[1,2]}');
  });
  assert.equal(form, 403);
  assert.equal((await run('sumar', [1, 2], { 'Sec-Fetch-Site': 'same-origin' })).status, 200);
});

test('JSON inválido → 400', async () => {
  const { port } = demoServer.address();
  const status = await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: `${BASE}/api/demo/sumar`, headers: { 'Content-Type': 'application/json', ...RUN_HEADERS } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.end('{no es json');
  });
  assert.equal(status, 400);
});

test('una función colgada se corta por timeout y la app sigue respondiendo', async () => {
  const r = await run('cuelga');
  assert.equal(r.status, 500);
  assert.match(JSON.parse(r.text).error, /timed out/i);
  assert.deepEqual(JSON.parse((await run('sumar', [1, 1])).text), { result: 2 });
});

test('módulo con datos (default): sin identidad → 401 en doGet y en api', async () => {
  assert.equal((await request(demoServer, 'GET', `${BASE}/demo-privado`)).status, 401);
  assert.equal((await run('sumar', [1, 2], {}, 'demo-privado')).status, 401);
  assert.equal((await request(demoServer, 'GET', `${BASE}/demo-privado`, { headers: { 'x-test-email': 'a@despegar.com' } })).status, 200);
  assert.equal((await run('sumar', [1, 2], { 'x-test-email': 'a@despegar.com' }, 'demo-privado')).status, 200);
});

test('una excepción del módulo llega como error al failure handler', async () => {
  const r = await run('explota');
  assert.equal(r.status, 500);
  assert.equal(JSON.parse(r.text).error, 'falló a propósito');
});

test('servicio no migrado tira ServicioNoMigrado (nunca inventa datos)', async () => {
  const r = await run('leerDrive');
  assert.equal(r.status, 500);
  const body = JSON.parse(r.text);
  assert.equal(body.name, 'ServicioNoMigrado');
  assert.match(body.error, /DriveApp\.getFileById/);
});

test('Session.getActiveUser: solo con el header confiable configurado', async () => {
  assert.deepEqual(JSON.parse((await run('quienSoy', [], { 'x-test-email': 'Tiago.Harari@despegar.com' })).text), { result: 'tiago.harari@despegar.com' });
  assert.deepEqual(JSON.parse((await run('quienSoy', [], { 'x-forwarded-email': 'falso@despegar.com' })).text), { result: '' });
  // Fuera del dominio no cuenta como identidad (en GAS: access DOMAIN).
  assert.deepEqual(JSON.parse((await run('quienSoy', [], { 'x-test-email': 'alguien@gmail.com' })).text), { result: '' });
  assert.equal((await request(demoServer, 'GET', `${BASE}/demo-privado`, { headers: { 'x-test-email': 'alguien@gmail.com' } })).status, 401);
});

test('CacheService y ScriptApp.getService().getUrl()', async () => {
  assert.deepEqual(JSON.parse((await run('cacheIdaYVuelta', ['v1'])).text), { result: 'v1' });
  const url = JSON.parse((await run('urlPropia')).text).result;
  assert.match(url, new RegExp(`^http://127\\.0\\.0\\.1:\\d+${BASE}/demo$`));
});

test('zona horaria del proceso = la de GAS (Buenos Aires)', async () => {
  assert.deepEqual(JSON.parse((await run('mesLocal')).text), { result: 8 }, 'septiembre, no octubre');
  assert.deepEqual(JSON.parse((await run('fecha')).text), { result: '2026-09-30T22:05:09 Wed Sep' });
});

test('rutas desconocidas, módulos no migrados y métodos inválidos', async () => {
  assert.equal((await request(demoServer, 'GET', `${BASE}/pendiente`)).status, 404);
  assert.equal((await request(demoServer, 'GET', `${BASE}/api/demo/sumar`)).status, 405);
  assert.equal((await request(demoServer, 'POST', `${BASE}/demo`)).status, 405);
  assert.equal((await request(demoServer, 'GET', `${BASE}/%E0%A4%A`)).status, 400);
});

test('REQUIRE_IDENTITY: 401 sin identidad, health sigue abierto', async () => {
  const app = createApp({ GAS_ROOT: FIXTURES, BASE_PATH: BASE, modules: [DEMO], secrets: {}, REQUIRE_IDENTITY: true, TRUSTED_IDENTITY_HEADER: 'x-test-email' });
  const s = await listen(app);
  try {
    assert.equal((await request(s, 'GET', `${BASE}/demo`)).status, 401);
    assert.equal((await request(s, 'GET', `${BASE}/health`)).status, 200);
    assert.equal((await request(s, 'GET', `${BASE}/demo`, { headers: { 'x-test-email': 'a@despegar.com' } })).status, 200);
  } finally {
    s.close();
  }
});

test('whoami informa headers de auth sin devolver tokens', async () => {
  const r = await request(demoServer, 'GET', `${BASE}/whoami`, { headers: { 'cf-access-authenticated-user-email': 'x@despegar.com', authorization: 'Bearer secreto' } });
  const body = JSON.parse(r.text);
  assert.doesNotMatch(r.text, /secreto/);
  assert.ok(body.authHeaders.some((h) => h.header === 'cf-access-authenticated-user-email' && h.email === 'x@despegar.com'));
});

// ---- Smoke test sobre los módulos reales marcados como migrados ----

for (const m of MODULES.filter((x) => x.ownia)) {
  test(`módulo real "${m.slug}" (${m.dir}) carga y su doGet responde`, async () => {
    const r = await request(realServer, 'GET', `${BASE}/${m.slug}`);
    assert.equal(r.status, 200, r.text.slice(0, 300));
    assert.match(r.text, /_gas\/client\.js/);
  });
}

test('Manual: mismo título que en GAS y embebible (ALLOWALL)', async () => {
  const r = await request(realServer, 'GET', `${BASE}/manual`);
  assert.match(r.text, /<title>Manual · B2B Ecosystem · Despegar<\/title>/);
  assert.equal(r.headers['x-frame-options'], undefined);
  assert.ok(config.GAS_ROOT, 'GAS_ROOT resuelto');
});
