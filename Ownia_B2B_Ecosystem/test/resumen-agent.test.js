const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createResumenAgent, digest, paramsFrom, cleanMessages } = require('../server/resumen-agent');
const { createApp } = require('../server/index');

const BASE = '/b2b-ecosystem';
const z = (gb, rev, fvm) => ({ gb, rev, fvm });
const PAYLOAD = {
  success: true,
  week: { year: 2026, week: 45, from: '2026-11-02', to: '2026-11-08' },
  weeks: [{ year: 2026, week: 45, from: '2026-11-02' }],
  month: { ym: '2026-11', to: '2026-11-08' }, months: ['2026-11'], monthly: { ym: '2026-10' }, cmonths: ['2026-10'],
  lastActualsDate: '2026-11-08', organic: { target: 'budget', missing: [] },
  biz: { b2b2c: {
    trend: [{ year: 2026, week: 44, from: '2026-10-26', cur: z(1000000, 100000, 50000), bud: z(1200000, 120000, 60000), ly: z(900000, 90000, 40000) }],
    cur: { AR: z(500000, 50000, 20000) }, bud: { AR: z(600000, 60000, 25000) }, ly: {}, rr: {}, l4w: {},
    mtd: { cur: {}, bud: {}, ly: {}, rr: {}, budMonth: z(0, 0, 0) }, monthly: { trend: [], cur: {}, bud: {}, ly: {}, rr: {}, l3m: {} },
  } },
};

// Anthropic de mentira: primero pide la herramienta, después contesta con lo que la herramienta devolvió.
function fakeAnthropic(calls) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const last = body.messages[body.messages.length - 1];
    const tr = Array.isArray(last.content) && last.content.find((b) => b.type === 'tool_result');
    const out = tr
      ? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Brecha FVM: ' + JSON.parse(tr.content).negocios['B2B2C'].serie_semanal_total[0].budget.fvm }] }
      : { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'consultar_resumen', input: { semana: '2026-W44' } }] };
    return { ok: true, status: 200, json: async () => out };
  };
}

test('digest: en USD K, por negocio, con la serie semanal', () => {
  const d = digest(PAYLOAD);
  const b = d.negocios['B2B2C'];
  assert.equal(d.unidades, 'USD miles (K)');
  assert.equal(d.semana_elegida, '2026-W45 (2026-11-02 a 2026-11-08)');
  assert.deepEqual(b.serie_semanal_total[0], { sem: '2026-W44', lunes: '2026-10-26', actual: { gb: 1000, nr: 100, fvm: 50 }, budget: { gb: 1200, nr: 120, fvm: 60 }, ly: { gb: 900, nr: 90, fvm: 40 } });
  assert.deepEqual(b.semana_por_pais.actual.AR, { gb: 500, nr: 50, fvm: 20 });
});

test('paramsFrom: solo acepta formatos válidos', () => {
  assert.deepEqual(paramsFrom({ semana: '2026-W44', mes_mtd: '2026-11', mes_cerrado: '2026-10' }), { year: 2026, week: 44, month: '2026-11', mo: '2026-10' });
  assert.deepEqual(paramsFrom({ semana: 'x', mes_mtd: '11', mes_cerrado: {} }), {});
});

test('cleanMessages: arranca por el usuario, recorta y descarta roles raros', () => {
  const m = cleanMessages([{ role: 'assistant', content: 'hola' }, { role: 'system', content: 'x' }, { role: 'user', content: 'a'.repeat(5000) }, { role: 'user', content: '  ' }]);
  assert.equal(m.length, 1);
  assert.equal(m[0].role, 'user');
  assert.equal(m[0].content.length, 2000);
});

test('ask: sin clave devuelve 503; con clave hace la vuelta con la herramienta', async () => {
  const sin = createResumenAgent({ secrets: {}, fetchData: async () => PAYLOAD });
  await assert.rejects(sin.ask({ messages: [{ role: 'user', content: 'hola' }], user: 'a@despegar.com' }), (e) => e.status === 503);

  const calls = [], asked = [];
  const ag = createResumenAgent({ secrets: { ANTHROPIC_API_KEY: 'sk-test' }, fetchFn: fakeAnthropic(calls), fetchData: async (p) => { asked.push(p); return PAYLOAD; } });
  const r = await ag.ask({ messages: [{ role: 'user', content: '¿brecha FVM?' }], context: { view: 'semanal', week: '2026-W45' }, user: 'a@despegar.com' });
  assert.equal(r.answer, 'Brecha FVM: 60');
  assert.deepEqual(asked, [{ year: 2026, week: 44 }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers['x-api-key'], 'sk-test');
  assert.match(calls[0].body.system, /semana 2026-W45/);
  assert.equal(calls[0].body.tools[0].name, 'consultar_resumen');
});

test('ask: tope de preguntas por usuario', async () => {
  const ag = createResumenAgent({ secrets: { ANTHROPIC_API_KEY: 'k' }, fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }) }), fetchData: async () => PAYLOAD });
  for (let i = 0; i < 20; i++) await ag.ask({ messages: [{ role: 'user', content: 'q' }], user: 'rate@despegar.com' });
  await assert.rejects(ag.ask({ messages: [{ role: 'user', content: 'q' }], user: 'rate@despegar.com' }), (e) => e.status === 429);
  await ag.ask({ messages: [{ role: 'user', content: 'q' }], user: 'otro@despegar.com' });
});

test('ruta /api/resumen-semanal/ask: permisos, anti-CSRF y respuesta', async () => {
  const agent = { enabled: () => true, ask: async ({ messages, user }) => ({ answer: `eco:${messages[0].content}:${user}` }) };
  const s = await new Promise((res) => { const srv = http.createServer(createApp({ BASE_PATH: BASE, TRUSTED_IDENTITY_HEADER: 'x-test-email', fileStore: null, resumenAgent: agent }).handler).listen(0, '127.0.0.1', () => res(srv)); });
  const req = (method, headers, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: s.address().port, method, path: `${BASE}/api/resumen-semanal/ask`, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (x) => {
      const c = []; x.on('data', (d) => c.push(d)); x.on('end', () => resolve({ status: x.statusCode, json: JSON.parse(Buffer.concat(c).toString('utf8') || '{}') }));
    });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
  try {
    const me = { 'x-test-email': 'chief@despegar.com' };
    assert.equal((await req('POST', {}, { messages: [] })).status, 401);
    assert.equal((await req('POST', me, { messages: [] })).status, 403);   // sin X-Requested-With
    assert.deepEqual((await req('GET', me)).json, { enabled: true });
    const ok = await req('POST', { ...me, 'X-Requested-With': 'resumen-semanal' }, { messages: [{ role: 'user', content: 'hola' }] });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.answer, 'eco:hola:chief@despegar.com');
    assert.equal((await req('PUT', me)).status, 405);
  } finally { s.close(); }
});

test('Toqan: start manda el extracto en la primera pregunta, continúa sin él y poll devuelve la respuesta', async () => {
  const calls = [];
  let polls = 0;
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (url.endsWith('/create_conversation')) return ok({ conversation_id: 'c1', request_id: 'r1' });
    if (url.endsWith('/continue_conversation')) return ok({ conversation_id: 'c1', request_id: 'r2' });
    return ok(++polls === 1 ? { status: 'in_progress' } : { status: 'finished', answer: 'hola' });
  };
  const ag = createResumenAgent({ secrets: { TOQAN_API_KEY: 'sk_t' }, fetchFn, fetchData: async () => PAYLOAD });
  assert.equal(ag.provider(), 'toqan');
  const a = await ag.start({ question: '¿brecha FVM?', context: { week: '2026-W44' }, user: 't@despegar.com' });
  assert.deepEqual(a, { conversationId: 'c1', requestId: 'r1', pending: true });
  assert.equal(calls[0].url, 'https://api.toqan.ai/api/create_conversation');
  assert.equal(calls[0].init.headers['X-Api-Key'], 'sk_t');
  const msg = JSON.parse(calls[0].init.body).user_message;
  assert.match(msg, /EXTRACTO DEL RESUMEN SEMANAL/);
  assert.match(msg, /PREGUNTA: ¿brecha FVM\?/);
  const b = await ag.start({ question: 'y en NR?', conversationId: 'c1', refresh: false, user: 't@despegar.com' });
  assert.equal(b.requestId, 'r2');
  assert.equal(JSON.parse(calls[1].init.body).user_message, 'y en NR?');
  assert.deepEqual(await ag.poll({ conversationId: 'c1', requestId: 'r1' }), { pending: true });
  assert.deepEqual(await ag.poll({ conversationId: 'c1', requestId: 'r1' }), { answer: 'hola', conversationId: 'c1' });
  await assert.rejects(ag.poll({ conversationId: '../x', requestId: 'r1' }), (e) => e.status === 400);
  await assert.rejects(ag.start({ question: 'x', conversationId: 'a b', user: 'u' }), (e) => e.status === 400);
});
