// "Enviar a Google Slides" del Daily B2B Tracker (server/gslides-export.js): token de Google + llamada al web app de Apps Script.
// fetch se reemplaza por uno falso: no sale ninguna request.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { exportTrackerSlides } = require('../server/gslides-export');

const SECRETS = { DRIVE_CLIENT_ID: 'cid', DRIVE_CLIENT_SECRET: 'csecret', DRIVE_REFRESH_TOKEN: 'rt-main', DRIVE_READ_REFRESH_TOKEN: 'rt-read' };
const SLIDES = [{ img: 'data:image/jpeg;base64,AAAA', w: 1280, h: 720 }, null];
const GAS = 'https://script.google.com/macros/s/X/exec';
const res = (status, body) => ({ ok: status < 400, status, json: async () => JSON.parse(body), text: async () => body });

test('pide el token con el refresh de lectura y manda las slides al web app con Bearer', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('oauth2.googleapis.com')) return res(200, JSON.stringify({ access_token: 'AT' }));
    return res(200, JSON.stringify({ ok: true, count: 2, url: 'https://docs.google.com/presentation/d/Z/edit' }));
  };
  const out = await exportTrackerSlides({ secrets: SECRETS, gasUrl: GAS, slides: SLIDES, fetchFn });
  assert.deepEqual(out, { ok: true, count: 2, url: 'https://docs.google.com/presentation/d/Z/edit' });
  assert.match(String(calls[0].init.body), /refresh_token=rt-read/);
  assert.equal(calls[1].url, GAS);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer AT');
  const sent = JSON.parse(calls[1].init.body);
  assert.equal(sent.action, 'exportTrackerSlides');
  assert.equal(sent.slides.length, 2);
});

test('sin credenciales, sin slides o sin URL: error legible y no llama a nadie', async () => {
  const fetchFn = async () => { throw new Error('no debería llamar'); };
  await assert.rejects(exportTrackerSlides({ secrets: {}, gasUrl: GAS, slides: SLIDES, fetchFn }), /credenciales de Google/);
  await assert.rejects(exportTrackerSlides({ secrets: SECRETS, gasUrl: GAS, slides: [], fetchFn }), /ninguna slide/);
  await assert.rejects(exportTrackerSlides({ secrets: SECRETS, gasUrl: '', slides: SLIDES, fetchFn }), /URL de Apps Script/);
});

test('si Google rechaza el token o Apps Script contesta HTML o ok:false, el mensaje lo dice', async () => {
  const bad = async (url) => (url.includes('oauth2') ? res(400, JSON.stringify({ error: 'invalid_grant' })) : null);
  await assert.rejects(exportTrackerSlides({ secrets: SECRETS, gasUrl: GAS, slides: SLIDES, fetchFn: bad }), /invalid_grant/);

  const html = async (url) => (url.includes('oauth2') ? res(200, JSON.stringify({ access_token: 'AT' })) : { ok: true, status: 200, text: async () => '<html>login</html>' });
  await assert.rejects(exportTrackerSlides({ secrets: SECRETS, gasUrl: GAS, slides: SLIDES, fetchFn: html }), /no respondió como se esperaba/);

  const fail = async (url) => (url.includes('oauth2') ? res(200, JSON.stringify({ access_token: 'AT' })) : res(200, JSON.stringify({ ok: false, error: 'sin permiso de EDICIÓN' })));
  await assert.rejects(exportTrackerSlides({ secrets: SECRETS, gasUrl: GAS, slides: SLIDES, fetchFn: fail }), /sin permiso de EDICIÓN/);
});

test('trabajo en segundo plano: arranca, queda "running" y termina "done"; una exportación por vez y solo la ve quien la pidió', async () => {
  const { createSlidesJobs } = require('../server/gslides-export');
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetchFn = async (url) => {
    if (url.includes('oauth2')) return res(200, JSON.stringify({ access_token: 'AT' }));
    await gate;
    return res(200, JSON.stringify({ ok: true, count: 2, url: 'U' }));
  };
  const jobs = createSlidesJobs();
  const id = jobs.start({ user: 'a@despegar.com', secrets: SECRETS, gasUrl: GAS, slides: SLIDES, fetchFn });
  assert.equal(jobs.status(id, 'a@despegar.com').state, 'running');
  assert.throws(() => jobs.start({ user: 'b@despegar.com', secrets: SECRETS, gasUrl: GAS, slides: SLIDES, fetchFn }), /otra exportación en curso/);
  assert.equal(jobs.status(id, 'b@despegar.com').state, 'error');   // otro usuario no ve el trabajo
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(jobs.status(id, 'a@despegar.com'), { state: 'done', count: 2, url: 'U', error: undefined });
});

test('trabajo en segundo plano: un fallo queda como error legible', async () => {
  const { createSlidesJobs } = require('../server/gslides-export');
  const jobs = createSlidesJobs();
  const id = jobs.start({ user: 'a@despegar.com', secrets: {}, gasUrl: GAS, slides: SLIDES, fetchFn: async () => { throw new Error('x'); } });
  await new Promise((r) => setTimeout(r, 20));
  const st = jobs.status(id, 'a@despegar.com');
  assert.equal(st.state, 'error');
  assert.match(st.error, /credenciales de Google/);
});

test('el Weekly B2B-MAY usa su propia acción del web app (la del Tracker queda igual por defecto)', async () => {
  const bodies = [];
  const fetchFn = async (url, init) => {
    if (url.includes('oauth2')) return res(200, JSON.stringify({ access_token: 'AT' }));
    bodies.push(JSON.parse(init.body));
    return res(200, JSON.stringify({ ok: true, count: 2, url: 'U' }));
  };
  await exportTrackerSlides({ secrets: SECRETS, gasUrl: GAS, slides: SLIDES, fetchFn });
  await exportTrackerSlides({ secrets: SECRETS, gasUrl: GAS, slides: SLIDES, action: 'exportWeeklySlides', fetchFn });
  assert.deepEqual(bodies.map((b) => b.action), ['exportTrackerSlides', 'exportWeeklySlides']);
});
