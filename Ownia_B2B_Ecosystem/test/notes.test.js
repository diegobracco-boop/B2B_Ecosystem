// Notas editables (/notes/<modulo>/<scope>): guardar/leer, permisos del módulo y anti-CSRF.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createApp } = require('../server/index');
const { DirNotes } = require('../server/notes-store');

const BASE = '/b2b-ecosystem';
const FIXTURES = path.join(__dirname, 'fixtures');
const EQUIPO = { slug: 'demo-equipo', dir: 'Demo_Module', title: 'Demo', desc: 'demo', ownia: true, allowedUsers: ['ana@despegar.com'], gasUrl: '' };
const JSON_RUN = { 'Content-Type': 'application/json', 'X-Requested-With': 'google.script.run' };

let server, dir;

function req(method, p, { body, headers } = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: BASE + p, headers: headers || {} }, (res) => {
      const c = [];
      res.on('data', (x) => c.push(x));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(c).toString('utf8') || 'null') }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  const app = createApp({ GAS_ROOT: FIXTURES, BASE_PATH: BASE, modules: [EQUIPO], secrets: {}, TRUSTED_IDENTITY_HEADER: 'x-test-email', fileStore: null, notesStore: new DirNotes(dir) });
  server = await new Promise((resolve) => { const s = http.createServer(app.handler).listen(0, '127.0.0.1', () => resolve(s)); });
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('notas: se guardan por campo y se leen con autor y fecha', async () => {
  const h = { ...JSON_RUN, 'x-test-email': 'ana@despegar.com' };
  let r = await req('POST', '/notes/demo-equipo/slides-2026-09', { headers: h, body: { field: 's3_challenges', text: 'Recuperar el H1' } });
  assert.equal(r.status, 200);
  await req('POST', '/notes/demo-equipo/slides-2026-09', { headers: h, body: { field: 's8_highlights', text: 'Brasil +$4.2M' } });
  r = await req('GET', '/notes/demo-equipo/slides-2026-09', { headers: { 'x-test-email': 'ana@despegar.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.notes.s3_challenges.text, 'Recuperar el H1');
  assert.equal(r.json.notes.s3_challenges.by, 'ana@despegar.com');
  assert.equal(r.json.notes.s8_highlights.text, 'Brasil +$4.2M');
  // Otro mes, otro scope: vacío
  r = await req('GET', '/notes/demo-equipo/slides-2026-10', { headers: { 'x-test-email': 'ana@despegar.com' } });
  assert.deepEqual(r.json.notes, {});
});

test('notas: mismos permisos que el módulo, anti-CSRF y validación', async () => {
  // sin usuario / usuario fuera de la lista
  assert.equal((await req('GET', '/notes/demo-equipo/slides-2026-09')).status, 401);
  assert.equal((await req('GET', '/notes/demo-equipo/slides-2026-09', { headers: { 'x-test-email': 'otro@despegar.com' } })).status, 403);
  // POST sin el header custom (form cross-site) → rechazado
  const r1 = await req('POST', '/notes/demo-equipo/slides-2026-09', { headers: { 'Content-Type': 'application/json', 'x-test-email': 'ana@despegar.com' }, body: { field: 'x', text: 'y' } });
  assert.equal(r1.status, 403);
  // scope / campo inválidos, texto que no es string
  const h = { ...JSON_RUN, 'x-test-email': 'ana@despegar.com' };
  assert.equal((await req('GET', '/notes/demo-equipo/..%2Fetc', { headers: h })).status, 404);
  assert.equal((await req('POST', '/notes/demo-equipo/slides-2026-09', { headers: h, body: { field: 'A B', text: 'x' } })).status, 400);
  assert.equal((await req('POST', '/notes/demo-equipo/slides-2026-09', { headers: h, body: { field: 'ok', text: 3 } })).status, 400);
  // módulo que no existe
  assert.equal((await req('GET', '/notes/no-existe/slides-2026-09', { headers: h })).status, 404);
});
