// Vista previa del "Resumen semanal" con datos de ejemplo (sin _store ni Drive), para revisar el diseño.
// Sirve solo la página y un getResumenSemanal falso con la misma forma que el real (server/gas-extras/daily-resumen-semanal.js),
// incluida la elección de semana (args[0].year / .week) y la racha por país.
// Uso: node scripts/preview-resumen-semanal.js [puerto]  →  http://localhost:8099/b2b-ecosystem/resumen-semanal
// Los montos son INVENTADOS: no usar para leer números.
const http = require('http');
const BASE = '/b2b-ecosystem';
const port = Number(process.argv[2]) || 8099;
const LATEST = 44, PICK = 8, SERIES = 13, STREAK = 4;

// Ruido determinístico por (negocio, país, semana, escenario): mismos números en cada recarga
function noise(...k) {
  let h = 2166136261;
  for (const c of k.join('|')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000 * 2 - 1;
}

const COUNTRIES = {
  b2b2c: { Brasil: 3.1e6, Argentina: 1.9e6, Mexico: 1.4e6, Chile: 0.9e6, Colombia: 0.7e6, Peru: 0.45e6, 'Other Countries': 0.3e6 },
  api: { Brasil: 2.2e6, Mexico: 1.3e6, Argentina: 0.8e6, Chile: 0.6e6, USA: 0.5e6, Colombia: 0.35e6, 'Other Countries': 0.25e6 },
  html: { Argentina: 0.9e6, Brasil: 0.7e6, Chile: 0.35e6, Colombia: 0.25e6, Peru: 0.2e6, Uruguay: 0.12e6 },
};
const MARGIN = { b2b2c: [0.085, 0.032], api: [0.06, 0.021], html: [0.075, 0.027] };   // NR / GB, FVM / GB
const BIAS = { b2b2c: 0.97, api: 1.03, html: 0.94 };                                     // actual vs budget de fondo
const WEAK = { 'b2b2c|Chile': 0.88, 'b2b2c|Peru': 0.9, 'html|Colombia': 0.86 };           // países flojos varias semanas

function isoMonday(y, w) { const j4 = new Date(Date.UTC(y, 0, 4)), d = j4.getUTCDay() || 7; return new Date(Date.UTC(y, 0, 4 - d + 1 + (w - 1) * 7)); }
const ymd = (d) => d.toISOString().substring(0, 10);
const wk = (w) => ({ year: 2026, week: w, from: ymd(isoMonday(2026, w)) });

function cell(k, p, w, sc) {
  const base = COUNTRIES[k][p] * (1 + 0.05 * Math.sin(w / 2.3) + (w - 30) * 0.004);
  const f = { bud: 1, cur: BIAS[k] * (WEAK[k + '|' + p] || 1) * (1 + 0.07 * noise(k, p, w, 'c')), ly: 0.88 * (1 + 0.06 * noise(k, p, w, 'l')), rr: 1 + 0.04 * noise(k, p, w, 'r') }[sc];
  const gb = base * f, tr = MARGIN[k][0] * (sc === 'cur' ? 1 + 0.06 * noise(k, p, w, 't') : 1);
  return { gb: Math.round(gb), rev: Math.round(gb * tr), fvm: Math.round(gb * MARGIN[k][1] * (sc === 'cur' ? 1 + 0.15 * noise(k, p, w, 'f') : 1)) };
}
function byPais(k, w, sc) {
  const o = {};
  Object.keys(COUNTRIES[k]).forEach((p) => { o[p] = cell(k, p, w, sc); });
  if (k === 'b2b2c' && sc === 'cur') o.RG = { gb: 0, rev: -42000, fvm: -42000 };   // ajuste COI Brasil, como en el real (entra en totales y serie)
  return o;
}
function sum(by) { const t = { gb: 0, rev: 0, fvm: 0 }; Object.values(by).forEach((v) => { t.gb += v.gb; t.rev += v.rev; t.fvm += v.fvm; }); return t; }
function avg(k, ws, sc) {
  const o = {};
  ws.forEach((w) => Object.entries(byPais(k, w, sc)).forEach(([p, v]) => { const s = o[p] = o[p] || { gb: 0, rev: 0, fvm: 0 }; s.gb += v.gb / 4; s.rev += v.rev / 4; s.fvm += v.fvm / 4; }));
  return o;
}

function mock(params) {
  const want = params && params.week ? +params.week : LATEST;
  const W = want <= LATEST && want > LATEST - PICK ? want : LATEST;
  const biz = {};
  Object.keys(COUNTRIES).forEach((k) => {
    const prev4 = [W - 1, W - 2, W - 3, W - 4];
    const o = { cur: byPais(k, W, 'cur'), bud: byPais(k, W, 'bud'), ly: byPais(k, W, 'ly'), rr: byPais(k, W, 'rr'), l4w: avg(k, prev4, 'cur'), l4wLy: avg(k, prev4, 'ly') };
    o.trend = [];
    for (let w = W - SERIES + 1; w <= W; w++) o.trend.push({ ...wk(w), cur: sum(byPais(k, w, 'cur')), bud: sum(byPais(k, w, 'bud')), ly: sum(byPais(k, w, 'ly')) });
    o.streak = [];
    for (let w = W - STREAK + 1; w <= W; w++) {
      const c = byPais(k, w, 'cur'), b = byPais(k, w, 'bud'), st = {};
      Object.keys(c).forEach((p) => { st[p] = [c[p].rev, (b[p] || { rev: 0 }).rev]; });
      o.streak.push(st);
    }
    biz[k] = o;
  });
  const from = isoMonday(2026, W), to = new Date(from.getTime() + 6 * 864e5);
  const weeks = []; for (let q = 0; q < PICK; q++) weeks.push(wk(LATEST - q));
  return { success: true, week: { year: 2026, week: W, from: ymd(from), to: ymd(to) }, latest: { year: 2026, week: LATEST }, weeks,
    lastActualsDate: '2026-11-03', generatedAt: '2026-11-04T06:12:00Z', exCoiBr: false, biz };
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === `${BASE}/api/daily/getResumenSemanal`) {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      let params = {};
      try { params = (JSON.parse(body || '{}').args || [])[0] || {}; } catch (e) { /* sin params */ }
      setTimeout(() => {   // un poco de demora, como en el servidor real
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: mock(params) }));
      }, 250);
    });
  }
  if (url === `${BASE}/resumen-semanal` || url === '/' || url === `${BASE}/`) {
    // Se recarga en cada request: los cambios al .js se ven con F5, sin reiniciar
    delete require.cache[require.resolve('../server/resumen-semanal-page')];
    const { resumenSemanalPage } = require('../server/resumen-semanal-page');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(resumenSemanalPage({ basePath: BASE }));
  }
  res.writeHead(404); res.end('no');
}).listen(port, '127.0.0.1', () => console.log(`preview → http://localhost:${port}${BASE}/resumen-semanal  (datos de ejemplo)`));
