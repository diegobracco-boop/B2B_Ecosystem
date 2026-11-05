// Vista previa del "Resumen semanal" con datos de ejemplo (sin _store ni Drive), para revisar el diseño.
// Sirve solo la página y un getResumenSemanal falso con la misma forma que el real (server/gas-extras/daily-resumen-semanal.js).
// Uso: node scripts/preview-resumen-semanal.js [puerto]  →  http://localhost:8099/b2b-ecosystem/resumen-semanal
// Los montos son INVENTADOS: no usar para leer números.
const http = require('http');
const BASE = '/b2b-ecosystem';
const port = Number(process.argv[2]) || 8099;

// Generador determinístico (mismos números en cada recarga)
let seed = 44;
function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
function jit(a) { return 1 + (rnd() * 2 - 1) * a; }

const COUNTRIES = {
  b2b2c: { Brasil: 3.1e6, Argentina: 1.9e6, Mexico: 1.4e6, Chile: 0.9e6, Colombia: 0.7e6, Peru: 0.45e6, 'Other Countries': 0.3e6 },
  api: { Brasil: 2.2e6, Mexico: 1.3e6, Argentina: 0.8e6, Chile: 0.6e6, USA: 0.5e6, Colombia: 0.35e6, 'Other Countries': 0.25e6 },
  html: { Argentina: 0.9e6, Brasil: 0.7e6, Chile: 0.35e6, Colombia: 0.25e6, Peru: 0.2e6, Uruguay: 0.12e6 },
};
const MARGIN = { b2b2c: [0.085, 0.032], api: [0.06, 0.021], html: [0.075, 0.027] };   // NR / GB, FVM / GB
const BIAS = { b2b2c: 0.97, api: 1.04, html: 0.93 };                                     // actual vs budget de fondo

function isoMonday(y, w) {
  const j4 = new Date(Date.UTC(y, 0, 4)), d = j4.getUTCDay() || 7;
  return new Date(Date.UTC(y, 0, 4 - d + 1 + (w - 1) * 7));
}
const ymd = (d) => d.toISOString().substring(0, 10);
const WEEKS = [];
for (let w = 32; w <= 44; w++) WEEKS.push({ year: 2026, week: w, from: ymd(isoMonday(2026, w)) });

function row(gb, k) { return { gb: Math.round(gb), rev: Math.round(gb * MARGIN[k][0] * jit(0.08)), fvm: Math.round(gb * MARGIN[k][1] * jit(0.15)) }; }

function mock() {
  const biz = {};
  Object.keys(COUNTRIES).forEach((k) => {
    const C = COUNTRIES[k], o = { cur: {}, bud: {}, ly: {}, rr: {}, l4w: {}, l4wLy: {} };
    Object.keys(C).forEach((p) => {
      const base = C[p] * jit(0.05), drift = BIAS[k] * jit(0.09);
      o.bud[p] = row(base, k);
      o.cur[p] = row(base * drift, k);
      o.ly[p] = row(base * 0.88 * jit(0.08), k);
      o.rr[p] = row(base * jit(0.04), k);
      o.l4w[p] = row(base * 0.98 * jit(0.05), k);
      o.l4wLy[p] = row(base * 0.89 * jit(0.05), k);
    });
    if (k === 'b2b2c') { o.cur.RG = { gb: 0, rev: -42000, fvm: -42000 }; }
    const total = Object.values(C).reduce((a, b) => a + b, 0);
    o.trend = WEEKS.map((w, i) => {
      const season = 1 + 0.06 * Math.sin(i / 2) + i * 0.006, b = total * season;
      const cur = i === WEEKS.length - 1 ? sum(o.cur) : row(b * BIAS[k] * jit(0.05), k);
      const bud = i === WEEKS.length - 1 ? sum(o.bud) : row(b, k);
      const ly = i === WEEKS.length - 1 ? sum(o.ly) : row(b * 0.88 * jit(0.05), k);
      return { year: w.year, week: w.week, from: w.from, cur, bud, ly };
    });
    biz[k] = o;
  });
  return { success: true, week: { year: 2026, week: 44, from: '2026-10-26', to: '2026-11-01' }, lastActualsDate: '2026-11-03',
    generatedAt: '2026-11-04T06:12:00Z', exCoiBr: false, biz };
}
function sum(by) { const t = { gb: 0, rev: 0, fvm: 0 }; Object.values(by).forEach((v) => { t.gb += v.gb; t.rev += v.rev; t.fvm += v.fvm; }); return t; }

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === `${BASE}/api/daily/getResumenSemanal`) {
    seed = 44;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ result: mock() }));
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
