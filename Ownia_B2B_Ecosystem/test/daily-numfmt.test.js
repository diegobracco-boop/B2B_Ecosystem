// Formato de los números del Daily (public/daily-numfmt.js): con Auto + Auto tiene que dar exactamente lo mismo que los
// fmt / fmtShort originales de Daily_Dashboard/dashboard.html, y con las otras opciones la unidad y los decimales elegidos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'daily-numfmt.js'), 'utf8'), ctx, { filename: 'daily-numfmt.js' });
const N = ctx.DailyNumFmt;

// Los originales, sacados del HTML del Daily (si cambian allá, este test lo nota)
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'Daily_Dashboard', 'dashboard.html'), 'utf8');
const src = (name) => { const m = new RegExp('function ' + name + String.raw`\(v\) \{[\s\S]*?\r?\n\}`).exec(html); assert.ok(m, name + ' en dashboard.html'); return m[0]; };
const O = {};
vm.runInNewContext(src('fmt') + '\n' + src('fmtShort') + '\nO.fmt = fmt; O.fmtShort = fmtShort;', { O });

const VALS = [null, undefined, NaN, 0, 12, 999, 1000, 1499, 15430, -15430, 999999, 1000000, 1234567, -9876543, 123456789];

test('Auto + Auto: idéntico a los originales del Daily', () => {
  const f = N.make({ unit: 'auto', dec: 'auto' }, O);
  for (const v of VALS) { assert.equal(f.fmt(v), O.fmt(v), 'fmt ' + v); assert.equal(f.fmtShort(v), O.fmtShort(v), 'fmtShort ' + v); }
});

test('Millones, Miles y Enteros con 1 y 2 decimales', () => {
  const m1 = N.make({ unit: 'm', dec: '1' }, O), m2 = N.make({ unit: 'm', dec: '2' }, O);
  assert.equal(m1.fmt(1234567), '$1.2M'); assert.equal(m2.fmt(1234567), '$1.23M'); assert.equal(m2.fmt(15430), '$0.02M');
  assert.equal(m1.fmtShort(-9876543), '-9.9M');
  const k1 = N.make({ unit: 'k', dec: '1' }, O), kA = N.make({ unit: 'k', dec: 'auto' }, O);
  assert.equal(k1.fmt(1234567), '$1234.6K'); assert.equal(kA.fmt(15430), '$15K'); assert.equal(N.make({ unit: 'k', dec: '2' }, O).fmt(999), '$1.00K');
  const u = N.make({ unit: 'u', dec: '2' }, O);   // en Enteros no hay decimales
  assert.equal(u.fmt(1234567.6), '$1,234,568'); assert.equal(u.fmt(-15430), '-$15,430'); assert.equal(u.fmtShort(1234567), '1,234,567');
});

test('Auto con decimales elegidos: la escala de siempre, con esos decimales', () => {
  const a1 = N.make({ unit: 'auto', dec: '1' }, O);
  assert.equal(a1.fmt(1234567), '$1.2M'); assert.equal(a1.fmt(15430), '$15.4K'); assert.equal(a1.fmt(12), '$12');
  assert.equal(N.make({ unit: 'auto', dec: '2' }, O).fmtShort(1234567), '1.23M');
});

test('vacíos: "—" en fmt como el original; fmtShort se comporta como el original', () => {
  const f = N.make({ unit: 'm', dec: '2' }, O);
  for (const v of [null, undefined, NaN]) { assert.equal(f.fmt(v), '—'); assert.equal(f.fmtShort(v), O.fmtShort(v)); }
});

test('la capa está en el layout del Daily, después de daily-filtros.js', () => {
  const MODULES = require('../server/modules');
  const daily = (MODULES.MODULES || MODULES).find((m) => Array.isArray(m.layout) && m.layout.includes('daily-filtros.js'));
  assert.ok(daily.layout.indexOf('daily-numfmt.js') > daily.layout.indexOf('daily-filtros.js'));
});
