// Solapa "Tabla adhoc" del Daily (public/daily-adhoc.js): foto de un día de B2B2C / B2B MAY / B2B MIN vs Budget,
// Run Rate y LY. Suma solo el día pedido, separa B2B por canal y el Total es la suma de los tres negocios.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {};
ctx.window = ctx;
ctx.TextEncoder = TextEncoder;   // el .xlsx de daily-excel.js lo usa
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'daily-adhoc.js'), 'utf8'), ctx, { filename: 'daily-adhoc.js' });
const A = ctx.DailyAdhoc;

const D = '2026-11-26', LY = '2025-11-28';
const b2bc = (fecha, o, gb, nr, fvm, nrKey) => ({ fecha, pais: 'Argentina', orders: o, gross_bookings: gb, [nrKey || 'net_revenues']: nr, fvm });
const b2b = (fecha, ch, o, gb, nr, fvm) => ({ fecha, pais: 'Brasil', parent_channel: ch, orders: o, gross_bookings: gb, net_revenue: nr, fvm });

function fixture() {
  return {
    b2b2c: {
      act: [b2bc(D, 10, 1000, 100, 50), b2bc(D, 5, 500, 50, -10), b2bc('2026-11-25', 99, 9999, 999, 999)],
      bud: [b2bc(D, 20, 2000, 200, 80, 'net_revenue')],
      rr: [b2bc(D, 12, 1200, 120, 40, 'net_revenue')],
      ly: [b2bc(LY, 10, 1000, 100, 20), b2bc('2025-11-27', 77, 7777, 777, 777)],
    },
    b2b: {
      act: [b2b(D, 'API', 3, 300, 30, 10), b2b(D, 'Agencias afiliadas', 7, 700, 70, 35)],
      bud: [b2b(D, 'API', 4, 400, 40, 20), b2b(D, 'Agencias afiliadas', 7, 700, 70, 35)],
      rr: [b2b(D, 'API', 3, 300, 30, 10)],   // MIN sin Run Rate ese día
      ly: [b2b(LY, 'API', 2, 200, 20, -5), b2b(LY, 'Agencias afiliadas', 6, 600, 60, 30)],
    },
  };
}

test('suma solo el día pedido y lee net_revenues o net_revenue', () => {
  const r = A.computeTables(fixture(), D, LY);
  assert.deepEqual([r.b2b2c.real.orders, r.b2b2c.real.gb, r.b2b2c.real.nr, r.b2b2c.real.fvm], [15, 1500, 150, 40]);
  assert.equal(r.b2b2c.bud.nr, 200);
  assert.equal(r.b2b2c.ly.gb, 1000);   // el LY es el del día LY elegido, no el mismo día calendario
});

test('B2B separado en MAY (API) y MIN (Agencias afiliadas)', () => {
  const r = A.computeTables(fixture(), D, LY);
  assert.equal(r.may.real.gb, 300); assert.equal(r.min.real.gb, 700);
  assert.equal(r.may.bud.gb, 400); assert.equal(r.min.ly.fvm, 30);
  assert.equal(r.min.rr, null);   // sin filas de goal: null, no 0 (no inventa un −100%)
});

test('Total = suma de los tres; un goal que falta en un negocio queda sin total', () => {
  const r = A.computeTables(fixture(), D, LY);
  assert.deepEqual([r.total.real.orders, r.total.real.gb, r.total.real.nr, r.total.real.fvm], [25, 2500, 250, 85]);
  assert.equal(r.total.bud.gb, 3100);
  assert.equal(r.total.ly.fvm, 45);
  assert.equal(r.total.rr, null);
});

test('organic: el Δ vs Budget usa el real convertido (actBud) y la columna Real queda nominal', () => {
  const f = fixture();
  f.b2b2c.actBud = f.b2b2c.act.map(x => Object.assign({}, x, { gross_bookings: x.gross_bookings * 2 }));
  const r = A.computeTables(f, D, LY);
  assert.equal(r.b2b2c.real.gb, 1500); assert.equal(r.b2b2c.realBud.gb, 3000); assert.equal(r.b2b2c.realLy.gb, 1500);
});

test('sin B2B cargado: su tabla y el Total quedan en null (la página muestra "Cargando…")', () => {
  const f = fixture(); delete f.b2b;
  const r = A.computeTables(f, D, LY);
  assert.equal(r.may, null); assert.equal(r.total, null); assert.ok(r.b2b2c.real);
});

test('Δ % con goal negativo y fechas', () => {
  assert.equal(A.delta(-50, -100), 0.5);    // FVM menos negativo que el goal = mejor
  assert.equal(A.delta(110, 100).toFixed(2), '0.10');
  assert.equal(A.delta(10, 0), null); assert.equal(A.delta(10, null), null);
  assert.equal(A.dateLabel(D), 'jue 26/11/2026'); assert.equal(A.dateLabel(LY), 'vie 28/11/2025');
  assert.equal(A.shiftDate(LY, A.daysBetween(D, '2026-12-01')), '2025-12-03');
});

test('Excel: un bloque por tabla (Total primero), Δ % como número y sin real → celdas vacías', () => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'daily-excel.js'), 'utf8'), ctx, { filename: 'daily-excel.js' });
  const X = ctx.DailyExcel;
  const r = A.computeTables(fixture(), D, LY);
  const sh = A.buildSheets(r, D, LY, X.STYLE, ['nota']);
  assert.equal(sh.map(s => s.name).join('|'), 'Tabla adhoc|Info');
  const rows = sh[0].rows;
  const titles = rows.filter(x => x.length === 1).map(x => x[0].v);
  assert.match(titles[1], /^Total/); assert.match(titles[2], /^B2B2C/); assert.match(titles[4], /^B2B MIN/);
  const iTot = rows.findIndex(x => x[0] && /^Total/.test(x[0].v));
  const gb = rows[iTot + 3];
  assert.equal(gb[0].v, 'GB'); assert.equal(gb[1].v, 2500); assert.equal(gb[2].v, 3100);
  assert.equal(gb[3].v.toFixed(4), ((2500 - 3100) / 3100).toFixed(4)); assert.equal(gb[3].s, X.STYLE.pct);
  assert.equal(gb[5], null);   // Total sin Run Rate (MIN no tiene) → vacío
  const bytes = X.workbookFromSheets(sh);
  assert.ok(bytes.length > 1000);
  assert.ok(Buffer.from(bytes).toString('latin1').includes('numFmtId="165"'));
  // día sin reales: Real y Δ vacíos, goals presentes
  const r2 = A.computeTables(fixture(), '2026-11-30', LY);
  const rows2 = A.buildSheets(r2, '2026-11-30', LY, X.STYLE, []).filter(Boolean)[0].rows;
  const gb2 = rows2[rows2.findIndex(x => x[0] && /^Total/.test(x[0].v)) + 3];
  assert.equal(gb2[1], null); assert.equal(gb2[3], null);
});

test('filtro de país: suma solo esos países; un negocio sin ese país no deja el Total sin goal', () => {
  const f = fixture();
  f.b2b2c.act.push(b2bc(D, 1, 100, 10, 5)); f.b2b2c.act[3].pais = 'Ecuador';
  f.b2b2c.bud.push(Object.assign(b2bc(D, 2, 200, 20, 8, 'net_revenue'), { pais: 'Ecuador' }));
  const ar = A.computeTables(f, D, LY, ['Argentina']);
  assert.equal(ar.b2b2c.real.gb, 1500); assert.equal(ar.may.real.n, 0);
  assert.equal(ar.total.real.gb, 1500);
  assert.equal(ar.total.bud.gb, 2000);   // B2B no tiene Argentina ese día: el Total es el de B2B2C, no queda vacío
  const ecu = A.computeTables(f, D, LY, ['Ecuador']);
  assert.equal(ecu.total.real.gb, 100); assert.equal(ecu.total.bud.gb, 200); assert.equal(ecu.total.ly, null);
  const both = A.computeTables(f, D, LY, ['Argentina', 'Brasil']);
  assert.equal(both.total.real.gb, 2500);
  assert.equal(A.computeTables(f, D, LY, []).total.real.gb, 2600);   // vacío = todos
});

test('apertura por país: lista ordenada (Globales y RG al final; Other Countries / USA / Uruguay / Paraguay = Globales) y la suma de los países da el total', () => {
  const f = fixture();
  f.b2b.act.push(b2b(D, 'API', 1, 50, 5, 2)); f.b2b.act[2].pais = 'Other Countries';
  f.b2b.act.push(b2b(D, 'Agencias afiliadas', 2, 30, 3, 1)); f.b2b.act[3].pais = 'Uruguay';
  f.b2b.bud.push(b2b(D, 'API', 1, 40, 4, 2)); f.b2b.bud[2].pais = 'Other Countries';
  f.b2b.act.push(b2b(D, 'API', 0, 0, 0, -7)); f.b2b.act[4].pais = 'RG';
  f.b2b2c.act.push(b2bc('2026-11-01', 1, 1, 1, 1)); f.b2b2c.act[3].pais = 'Zimbabue';   // otro día: no aparece en la apertura
  assert.equal(A.countriesOf(f).join('|'), 'Argentina|Brasil|Zimbabue|Globales|RG');
  const by = A.computeByCountry(f, D, LY);
  assert.equal(by.map(x => x.pais).join('|'), 'Argentina|Brasil|Globales|RG');
  const tot = A.computeTables(f, D, LY).total.real;
  for (const k of ['orders', 'gb', 'nr', 'fvm']) assert.equal(by.reduce((s, x) => s + x.res.total.real[k], 0), tot[k], k);
  assert.equal(A.computeByCountry(f, D, LY, ['Brasil']).length, 1);
  const glo = A.computeTables(f, D, LY, ['Globales']);
  assert.equal(glo.may.real.gb, 50); assert.equal(glo.min.real.gb, 30); assert.equal(glo.may.bud.gb, 40);
  assert.equal(A.computeTables(f, D, LY, ['Uruguay']).total.real.gb, 0);   // Uruguay ya no existe suelto
  assert.equal(A.paisOf({ pais: 'USA' }), 'Globales'); assert.equal(A.paisOf({ pais: 'Ecuador' }), 'Ecuador');
  assert.equal(A.paisLabel('RG'), 'RG (ajuste COI Brasil)');
});

test('Excel: hoja "Por país" con una fila por negocio × país × métrica y autofiltro', () => {
  const X = ctx.DailyExcel;
  const f = fixture();
  const sh = A.buildSheets(A.computeTables(f, D, LY), D, LY, X.STYLE, [], A.computeByCountry(f, D, LY), 'Todos');
  assert.equal(sh.map(s => s.name).join('|'), 'Tabla adhoc|Por país|Info');
  const pr = sh[1].rows;
  assert.equal(pr[0][0].v, 'Negocio'); assert.equal(pr[0][1].v, 'País');
  // Total × (Argentina, Brasil) + B2B2C × Argentina + MAY × Brasil + MIN × Brasil = 5 bloques × 4 métricas
  assert.equal(pr.length - 1, 5 * 4);
  const gbAr = pr.find(r => r[0].v === 'B2B2C' && r[1].v === 'Argentina' && r[2].v === 'GB');
  assert.equal(gbAr[3].v, 1500); assert.equal(gbAr[4].v, 2000);
  assert.equal(sh[1].filter, 'A1:M' + pr.length);
  assert.ok(X.workbookFromSheets(sh).length > 1000);
});
