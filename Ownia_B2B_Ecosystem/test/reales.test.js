// Botón "Actualizar reales" de la portada (server/reales-job.js): permisos, contraseña, una corrida por vez y
// el entorno con el que se lanza daily_sync.py. El proceso de Python se reemplaza por uno falso.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createApp } = require('../server/index');
const { createRealesJob, resolvePipelinesDir } = require('../server/reales-job');

const BASE = '/b2b-ecosystem';
const FIXTURES = path.join(__dirname, 'fixtures');
const APP_ROOT = path.resolve(__dirname, '..');
const DEMO = { slug: 'demo', dir: 'Demo_Module', title: 'Demo', desc: 'demo', ownia: true, requiresIdentity: false, gasUrl: '' };
const EQUIPO = ['ana@despegar.com'];
const SECRETS = {
  DATALAKE_USER: 'ana.dl', DATALAKE_PASSWORD: 'pw-datalake', REALES_PASSWORD: 'clave',
  DRIVE_CLIENT_ID: 'cliente.apps', DRIVE_CLIENT_SECRET: 'secreto-cliente', DRIVE_REFRESH_TOKEN: 'refresh-clasp', DRIVE_READ_REFRESH_TOKEN: 'refresh-lectura',
};
const POST_HEADERS = { 'X-Requested-With': 'google.script.run', 'Content-Type': 'application/json' };
const ANA = { 'x-test-email': 'Ana@despegar.com' };

// Proceso falso: queda "corriendo" hasta que el test lo cierra.
const spawned = [];
function fakeSpawn(cmd, args, opts) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit('close', null);
  // Lo que ve el proceso al arrancar (los tokens se borran al terminar).
  const home = opts.env.HOME;
  child.seen = { clasp: JSON.parse(fs.readFileSync(path.join(home, '.clasprc.json'), 'utf8')), read: JSON.parse(fs.readFileSync(opts.env.DRIVE_READ_TOKEN_FILE, 'utf8')) };
  spawned.push({ cmd, args, opts, child });
  return child;
}

let server;
function listen(app) {
  return new Promise((resolve) => { const s = http.createServer(app.handler).listen(0, '127.0.0.1', () => resolve(s)); });
}
function request(s, method, urlPath, { body, headers } = {}) {
  const { port } = s.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
const post = (password, who = 'ana@despegar.com', extra = {}) =>
  request(server, 'POST', `${BASE}/reales`, { body: { password }, headers: { ...POST_HEADERS, 'x-test-email': who, ...extra } });

function makeApp(secrets, memoryMb = 4096) {
  const cfg = { secrets, PORT: 8123, INGEST_TOKEN: 'tok', APP_ROOT, TIME_ZONE: 'America/Argentina/Buenos_Aires' };
  const reales = createRealesJob(cfg, { spawn: fakeSpawn, python: 'py-falso', pipelinesDir: resolvePipelinesDir(APP_ROOT), memoryMb });
  return createApp({ GAS_ROOT: FIXTURES, BASE_PATH: BASE, modules: [DEMO], secrets, TRUSTED_IDENTITY_HEADER: 'x-test-email', fileStore: null, reales, realesUsers: EQUIPO });
}

before(async () => { server = await listen(makeApp(SECRETS)); });
after(() => server.close());

test('portada: el botón solo aparece para el equipo', async () => {
  const equipo = await request(server, 'GET', `${BASE}/`, { headers: ANA });
  assert.match(equipo.text, /id="reales-btn"/);
  assert.match(equipo.text, new RegExp(`var api = "${BASE}/reales"`));
  const otro = await request(server, 'GET', `${BASE}/`, { headers: { 'x-test-email': 'otro@despegar.com' } });
  assert.doesNotMatch(otro.text, /reales-btn/);
  assert.doesNotMatch((await request(server, 'GET', `${BASE}/`)).text, /reales-btn/);
});

test('estado: sin identidad 401, fuera del equipo 403, equipo 200 (sin secretos en la respuesta)', async () => {
  assert.equal((await request(server, 'GET', `${BASE}/reales`)).status, 401);
  assert.equal((await request(server, 'GET', `${BASE}/reales`, { headers: { 'x-test-email': 'otro@despegar.com' } })).status, 403);
  const r = await request(server, 'GET', `${BASE}/reales`, { headers: ANA });
  assert.equal(r.status, 200);
  const st = JSON.parse(r.text);
  assert.equal(st.state, 'idle');
  assert.equal(st.configured, true);
  assert.doesNotMatch(r.text, /pw-datalake|clave|refresh-clasp|secreto-cliente/);
});

test('lanzar: anti-CSRF, fuera del equipo y contraseña equivocada no arrancan nada', async () => {
  const sinHeader = await request(server, 'POST', `${BASE}/reales`, { body: { password: 'clave' }, headers: { 'Content-Type': 'application/json', ...ANA } });
  assert.equal(sinHeader.status, 403);
  assert.equal((await post('clave', 'ana@despegar.com', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('clave', 'otro@despegar.com')).status, 403);
  const mal = await post('Clave');
  assert.equal(mal.status, 403);
  assert.match(JSON.parse(mal.text).error, /Contraseña incorrecta/);
  assert.equal(spawned.length, 0);
});

test('lanzar: corre daily_sync.py con las credenciales de APP_SECRETS, una corrida por vez, y limpia los tokens', async () => {
  const r = await post('clave');
  assert.equal(r.status, 202, r.text);
  assert.equal(JSON.parse(r.text).state, 'running');
  assert.equal(spawned.length, 1);
  const { cmd, args, opts, child } = spawned[0];
  assert.equal(cmd, 'py-falso');
  assert.match(args[0].replace(/\\/g, '/'), /Daily_Dashboard\/daily_sync\.py$/);
  assert.equal(opts.env.USER, 'ana.dl');
  assert.equal(opts.env.PASSWORD, 'pw-datalake');
  assert.equal(opts.env.DATALAKE_HOST, 'datalake.despegar.com');
  assert.equal(opts.env.OWNIA_URL, 'http://127.0.0.1:8123');
  assert.equal(opts.env.OWNIA_INGEST_TOKEN, 'tok');
  assert.equal(opts.env.DAILY_FETCH_WORKERS, '4', 'menos consultas a la vez que en la PC (cola de Trino chica)');
  assert.equal(opts.env.REALES_PASSWORD, undefined, 'la contraseña del botón no llega al proceso');
  // ~/.clasprc.json como lo espera el pipeline (tokens.default), con el access token vencido para que lo renueve.
  assert.deepEqual(child.seen.clasp.tokens.default, { access_token: '', refresh_token: 'refresh-clasp', client_id: 'cliente.apps',
    client_secret: 'secreto-cliente', expiry_date: 0, token_type: 'Bearer' });
  assert.equal(child.seen.read.refresh_token, 'refresh-lectura');
  assert.equal(child.seen.read.client_id, 'cliente.apps');
  assert.deepEqual(child.seen.read.scopes, ['https://www.googleapis.com/auth/drive.readonly']);

  const otra = await post('clave');
  assert.equal(otra.status, 409, 'una corrida por vez');

  child.stdout.emit('data', Buffer.from('  OK Drive: archivo actualizado (daily_b2b2c_data.json)\n'));
  let st = JSON.parse((await request(server, 'GET', `${BASE}/reales`, { headers: ANA })).text);
  assert.equal(st.state, 'running');
  assert.deepEqual(st.lines, ['Memoria del contenedor: 4.096 MB', '  OK Drive: archivo actualizado (daily_b2b2c_data.json)']);
  assert.equal(st.by, 'ana@despegar.com');

  // Un traceback con credenciales no llega ni al estado ni al log.
  child.stderr.emit('data', Buffer.from('requests: auth failed for pw-datalake · Authorization: Bearer abcdef123 · refresh_token=r-largo-123 · refresh-clasp\n'));
  st = JSON.parse((await request(server, 'GET', `${BASE}/reales`, { headers: ANA })).text);
  assert.equal(st.lines[st.lines.length - 1], 'requests: auth failed for *** · Authorization: Bearer *** · refresh_token=*** · ***');

  child.emit('close', 0);
  st = JSON.parse((await request(server, 'GET', `${BASE}/reales`, { headers: ANA })).text);
  assert.equal(st.state, 'ok');
  assert.equal(st.exitCode, 0);
  assert.equal(fs.existsSync(opts.env.HOME), false, 'la carpeta con los tokens se borra al terminar');
});

test('barra de avance: consultas hasta 80 %, después las etapas del script; nunca retrocede', () => {
  const { newProgress, advance, EXPECTED_QUERIES } = require('../server/reales-job');
  const p = newProgress();
  advance(p, '  > Actuals ...');
  assert.equal(p.stage, 'Consultando el Datalake');
  advance(p, '  WAIT LY: cola del Datalake llena, reintento en 15s (1/12)');
  assert.equal(p.stage, 'Datalake ocupado: esperando turno');
  for (let i = 0; i < EXPECTED_QUERIES / 2; i++) advance(p, `  OK Q${i}: 1,234 filas en 5s`);
  assert.equal(p.pct, 41);
  assert.equal(p.stage, `Consultando el Datalake (${EXPECTED_QUERIES / 2} de ${EXPECTED_QUERIES})`);
  for (let i = 0; i < EXPECTED_QUERIES + 5; i++) advance(p, `  OK Q${i}: 10 filas en 1s`);
  assert.equal(p.pct, 80, 'más consultas de las esperadas no pasan del 80 %');
  advance(p, '--- Agregando ---');
  assert.deepEqual([p.pct, p.stage], [82, 'Armando los archivos']);
  advance(p, '--- Subiendo a Google Drive ---');
  advance(p, '  OK Drive: archivo actualizado (daily_b2b2c_data.json)');
  advance(p, '  OK Drive: archivo actualizado (daily_b2b_data.json)');
  assert.deepEqual([p.pct, p.stage], [91, 'Publicando en Drive y Ownia']);
  advance(p, '  OK flow_oc: 366 filas · meses cerrados');
  assert.equal(p.pct, 91, 'una línea que no es de consulta no mueve la barra');
  advance(p, '  WARN B2B GD intento 1 fallo (timeout); reintentando...');
  advance(p, '  WARN Ownia: no se pudo publicar daily_b2b_data.json (HTTP 500)');
  advance(p, '*** AVISO: NO se pudo regenerar okr.json (timeout). ***');
  advance(p, 'OK Completado: 30-10-2026 00:00');
  assert.deepEqual([p.pct, p.stage], [100, 'Listo']);
  assert.deepEqual(p.warnings, ['WARN Ownia: no se pudo publicar daily_b2b_data.json (HTTP 500)', '*** AVISO: NO se pudo regenerar okr.json (timeout). ***'],
    'los reintentos de una consulta no son avisos');
});

test('salida cortada en pedazos: las líneas se arman enteras antes de contarlas', async () => {
  assert.equal((await post('clave')).status, 202);
  const { child } = spawned[spawned.length - 1];
  child.stdout.emit('data', '  OK Actuals: 95,0');
  child.stdout.emit('data', '39 filas en 40s\n  > L');
  let st = JSON.parse((await request(server, 'GET', `${BASE}/reales`, { headers: ANA })).text);
  assert.deepEqual(st.lines.filter((l) => !/^Memoria/.test(l)), ['  OK Actuals: 95,039 filas en 40s']);
  assert.match(st.progress.stage, /Consultando el Datalake \(1 de \d+\)/);
  child.stdout.emit('data', 'Y ...');
  child.emit('close', 0);
  st = JSON.parse((await request(server, 'GET', `${BASE}/reales`, { headers: ANA })).text);
  assert.equal(st.lines[st.lines.length - 1], '  > LY ...', 'lo que quedó sin salto de línea se agrega al cerrar');
});

test('proceso cortado por el sistema (SIGKILL): error con el motivo probable', async () => {
  assert.equal((await post('clave')).status, 202);
  spawned[spawned.length - 1].child.emit('close', null, 'SIGKILL');
  const st = JSON.parse((await request(server, 'GET', `${BASE}/reales`, { headers: ANA })).text);
  assert.equal(st.state, 'error');
  assert.match(st.lines[st.lines.length - 1], /SIGKILL.*falta de memoria/);
});

test('una corrida que sale con error queda como error', async () => {
  assert.equal((await post('clave')).status, 202);
  spawned[spawned.length - 1].child.emit('close', 1);
  const st = JSON.parse((await request(server, 'GET', `${BASE}/reales`, { headers: ANA })).text);
  assert.equal(st.state, 'error');
  assert.equal(st.exitCode, 1);
});

test('contraseña equivocada: después de 5 intentos, 429', async () => {
  const who = 'ana@despegar.com';
  const s = await listen(makeApp(SECRETS));
  try {
    const p = (pw) => request(s, 'POST', `${BASE}/reales`, { body: { password: pw }, headers: { ...POST_HEADERS, 'x-test-email': who } });
    for (let i = 0; i < 5; i++) assert.equal((await p('mal')).status, 403);
    assert.equal((await p('clave')).status, 429, 'ni con la correcta mientras dura el bloqueo');
  } finally {
    s.close();
  }
});

test('contenedor con poca memoria: no arranca, avisa por qué; se puede desactivar con REALES_MIN_MEMORY_MB=0', async () => {
  const s = await listen(makeApp(SECRETS, 1024));
  const s0 = await listen(makeApp({ ...SECRETS, REALES_MIN_MEMORY_MB: '0' }, 1024));
  try {
    const before = spawned.length;
    const st = JSON.parse((await request(s, 'GET', `${BASE}/reales`, { headers: ANA })).text);
    assert.match(st.blocked, /1\.024 MB de memoria.*admin de Ownia/);
    const r = await request(s, 'POST', `${BASE}/reales`, { body: { password: 'clave' }, headers: { ...POST_HEADERS, ...ANA } });
    assert.equal(r.status, 503);
    assert.equal(spawned.length, before);
    assert.equal(JSON.parse((await request(s0, 'GET', `${BASE}/reales`, { headers: ANA })).text).blocked, null);
    assert.equal((await request(s0, 'POST', `${BASE}/reales`, { body: { password: 'clave' }, headers: { ...POST_HEADERS, ...ANA } })).status, 202);
    spawned[spawned.length - 1].child.emit('close', 0);
  } finally {
    s.close();
    s0.close();
  }
});

test('sin credenciales configuradas: 503 y no arranca', async () => {
  const s = await listen(makeApp({ REALES_PASSWORD: 'clave' }));
  try {
    const before = spawned.length;
    const r = await request(s, 'POST', `${BASE}/reales`, { body: { password: 'clave' }, headers: { ...POST_HEADERS, ...ANA } });
    assert.equal(r.status, 503);
    assert.match(JSON.parse(r.text).error, /DATALAKE_USER/);
    assert.equal(spawned.length, before);
  } finally {
    s.close();
  }
});
