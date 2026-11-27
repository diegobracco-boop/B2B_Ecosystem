// Slide "NR por trimestre según origen de la cuenta" del Flow mensual (public/daily-flow-nrq.js): trimestres del FY,
// real = actuals hasta el último día + Run Rate después, Budget y LY corrido +1 año, por segmento y cartera.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'daily-flow-nrq.js'), 'utf8'), ctx, { filename: 'daily-flow-nrq.js' });
const Q = ctx.FlowNrq;

const L = '2026-11-26';
const seg = r => r.seg;
const a = (fecha, seg, nr, pais) => ({ fecha, seg, pais: pais || 'Argentina', net_revenues: nr });
const g = (fecha, seg, nr, pais) => ({ fecha, seg, pais: pais || 'Argentina', net_revenue: nr });

test('trimestres del FY (abr = Q1) y fuera del FY = -1', () => {
  assert.equal(Q.qOf('2026-04-01', 2026), 0); assert.equal(Q.qOf('2026-09-30', 2026), 1);
  assert.equal(Q.qOf('2026-11-26', 2026), 2); assert.equal(Q.qOf('2027-03-01', 2026), 3);
  assert.equal(Q.qOf('2026-03-31', 2026), -1); assert.equal(Q.qOf('2027-04-01', 2026), -1);
});

test('real = actuals hasta L + Run Rate después; Budget y LY por trimestre y FY', () => {
  const A = Q.aggregate({
    act: [a('2026-05-10', 'f', 100), a('2026-11-26', 'f', 10), a('2026-11-27', 'f', 999)],   // el del 27 no cuenta (después de L)
    rr: [g('2026-11-26', 'f', 888), g('2026-11-27', 'f', 20), g('2027-02-01', 'f', 50)],      // el del 26 no cuenta (≤ L)
    bud: [g('2026-05-01', 'f', 90), g('2026-12-01', 'f', 40), g('2027-02-01', 'h', 30)],
    ly: [a('2025-05-10', 'f', 80), a('2025-11-01', 'f', 25)],
    lyCur: [a('2026-02-01', 'f', 45), a('2026-05-01', 'f', 7777)],   // ene–mar 2026 = LY de Q4; mayo 2026 no es LY
  }, L, seg);
  assert.equal(A.fy0, 2026); assert.equal(A.cur, 2);
  const f = A.seg.f;
  assert.deepEqual([f[0].real, f[2].real, f[3].real, f[4].real], [100, 30, 50, 180]);
  assert.equal(f[2].act, 10); assert.equal(f[2].rr, 20);
  assert.deepEqual([f[0].bud, f[2].bud, f[4].bud], [90, 40, 130]);
  assert.deepEqual([f[0].ly, f[2].ly, f[3].ly, f[4].ly], [80, 25, 45, 150]);
  assert.equal(A.seg.h[3].bud, 30);
});

test('cartera (keep) y LY a TC Budget (lyFx)', () => {
  const A = Q.aggregate({
    act: [a('2026-05-10', 'f', 100, 'Brasil'), a('2026-05-10', 'f', 50)],
    ly: [a('2025-05-10', 'f', 80, 'Brasil'), a('2025-05-10', 'f', 40)],
  }, L, seg, r => r.pais === 'Brasil', (pais, cur) => (pais === 'Brasil' && cur === '2026-05-10' ? 0.5 : 1));
  assert.equal(A.seg.f[0].real, 100); assert.equal(A.seg.f[0].ly, 40);
});

test('YoY sin base = n/a y título con los desvíos del año', () => {
  assert.equal(Q.pct(110, 100).toFixed(2), '0.10'); assert.equal(Q.pct(100, 5), null); assert.equal(Q.pct(10, 0), null);
  const mk = (f, h, t) => ({ seg: { f: [0, 0, 0, 0, f], h: [0, 0, 0, 0, h], t: [0, 0, 0, 0, t] } });
  const s = (real, bud) => ({ real, bud });
  assert.equal(Q.title(mk(s(35.81e6, 35.31e6), s(7.65e6, 8.14e6), s(0, 1.82e6))),
    'Las cuentas existentes cumplen el año (+0,50 M); el desvío está en nuevas cuentas (−0,49 M) y en hunting no logrado (−1,82 M)');
  assert.match(Q.title(mk(s(9e6, 10e6), s(2e6, 1e6), s(0, 0))), /^Las cuentas existentes quedan abajo del Budget del año \(−1,00 M\); nuevas cuentas \(\+1,00 M\) también quedan arriba$/);
});
