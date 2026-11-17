// Armado de los JSON canónicos desde la tabla del consolidador y comparación contra los de Drive (server/pnl-consolidador.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCanonicals, comparar, fechaFiscal, canalDe, mesSiguiente, cargarAjustes } = require('../server/pnl-consolidador');
const { IDS } = require('../server/pnl-drive-dimensiones');

const COLS = ['scenario', 'year', 'mes', 'pais', 'lob', 'channel', 'product', 'n2', 'valor'];
const SIN_AJ = { cols: [], rows: [] };
const cubo = (rows) => ({ version: 1, cols: COLS, rows });

test('fechaFiscal: el mes es calendario y el año es fiscal (abril a marzo)', () => {
  assert.equal(fechaFiscal('FY27', 4), '2026-04-01');
  assert.equal(fechaFiscal('FY27', 12), '2026-12-01');
  assert.equal(fechaFiscal('FY27', 1), '2027-01-01');
  assert.equal(fechaFiscal('FY26', 4), '2025-04-01');
  assert.equal(fechaFiscal('FY26', 3), '2026-03-01');
});

test('canalDe: solo B2B abre MAY/MIN; lo demás va a total', () => {
  assert.equal(canalDe('B2B', 'MAY'), 'may');
  assert.equal(canalDe('B2B', 'MIN'), 'min');
  assert.equal(canalDe('B2B2C', 'MIN'), 'total');
  assert.equal(canalDe('B2B2C', 'ON'), 'total');
  assert.equal(canalDe('B2B', 'Site'), 'total');
});

const FILAS = [
  ['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'Gross Bookings', 100],
  ['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'Gross Bookings', 50],     // se suma con la anterior
  ['ACT', 'FY27', 12, 'Brazil', 'B2B', 'MAY', 'Air', 'Gross Bookings', 70],    // run rate dentro del ACT: no es actual cerrado
  ['BGT', 'FY27', 4, 'OPS + RG', 'B2B2C', 'ON', 'Hotel', 'Third Party Comission', -5],
  ['FC1', 'FY27', 8, 'Others', 'B2B', 'MIN', 'General', 'Orders', 9],
  ['RR', 'FY27', 11, 'Chile', 'B2B2C', 'Site', 'Cars', 'Orders', 3],
  ['LRR', 'FY27', 5, 'Peru', 'B2B2C', 'Call Center', 'Buses', 'Orders', 4],
  ['ACT', 'FY26', 1, 'Mexico', 'B2B', 'MIN', 'D. Services', 'Orders', 8],
];

test('buildCanonicals: cada escenario sale del escenario y año de la tabla, con el vocabulario de Drive', () => {
  const { canon, sinMapear } = buildCanonicals(cubo(FILAS), { ultimoCerrado: '2026-10-01', ajustes: SIN_AJ });
  assert.deepEqual(Object.keys(canon).sort(), ['ac', 'bg', 'bl', 'fbtb', 'fc', 'lrr', 'ly', 'rr']);
  // ac: solo hasta el último mes cerrado; bl: el ACT completo
  assert.deepEqual(canon.ac.rows, [['b2b', 'may', 'brasil', 'flights', 'gross bookings', '2026-04-01', 150]]);
  assert.equal(canon.bl.rows.length, 2);
  assert.deepEqual(canon.bl.meta.fechas, ['2026-04-01', '2026-12-01']);
  assert.deepEqual(canon.bg.rows, [['b2b2c', 'total', 'rg', 'hotels', 'third party commissions', '2026-04-01', -5]]);
  // el FC1 de conso es el Bridge to Budget: alimenta fc y fbtb por igual
  assert.deepEqual(canon.fc.rows, canon.fbtb.rows);
  assert.deepEqual(canon.fc.rows, [['b2b', 'min', 'others countries', 'corporate', 'orders', '2026-08-01', 9]]);
  assert.equal(canon.rr.rows[0][1], 'total');
  assert.equal(canon.lrr.rows[0][3], 'buses');
  assert.deepEqual(canon.ly.rows, [['b2b', 'min', 'mexico', 'dest. serv.', 'orders', '2026-01-01', 8]]);
  assert.deepEqual(sinMapear, { pais: [], producto: [], n2: [] });
  assert.deepEqual(canon.ac.cols, ['LoB', 'Canal', 'Pais', 'Producto', 'P&L N2', 'Fecha', 'Monto USD']);
});

test('buildCanonicals: lo que no se puede traducir queda en sinMapear y no se pierde', () => {
  const { canon, sinMapear } = buildCanonicals(cubo([['ACT', 'FY27', 4, 'Atlantis', 'B2B', 'MAY', 'Drones', 'Risk', 7]]), { ajustes: SIN_AJ });
  assert.deepEqual(sinMapear, { pais: ['Atlantis'], producto: ['Drones'], n2: ['Risk'] });
  assert.deepEqual(canon.ac.rows, [['b2b', 'may', 'atlantis', 'drones', 'risk', '2026-04-01', 7]]);
});

test('buildCanonicals: rrDesde recorta el run rate', () => {
  const rows = [['RR', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Orders', 1], ['RR', 'FY27', 11, 'Chile', 'B2B', 'MAY', 'Air', 'Orders', 2]];
  const { canon } = buildCanonicals(cubo(rows), { rrDesde: '2026-10-01' });
  assert.deepEqual(canon.rr.rows.map((r) => r[5]), ['2026-11-01']);
});

const drive = (rows) => ({ meta: {}, cols: ['LoB', 'Canal', 'Pais', 'Producto', 'P&L N1', 'P&L N2', 'Fecha', 'Monto USD'], rows });
const storeCon = (obj) => ({ get: (id) => (obj[id] ? { meta: { updatedAt: 0 }, buf: Buffer.from(JSON.stringify(obj[id])) } : null) });

test('comparar: iguales, distintas, solo de un lado, y descarta B2C', () => {
  const { canon } = buildCanonicals(cubo([
    ['BGT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'Gross Bookings', 100],
    ['BGT', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Gross Bookings', 50],
    ['BGT', 'FY27', 5, 'Peru', 'B2B2C', 'ON', 'Hotel', 'Orders', 7],
  ]));
  const store = storeCon({
    [IDS.bg]: drive([
      ['b2b', 'may', 'brasil', 'flights', 'x', 'gross bookings', '2026-04-01', 100],        // igual
      ['b2b', 'may', 'chile', 'flights', 'x', 'gross bookings', '2026-04-01', 40],           // distinta (dif +10)
      ['b2b2c', 'total', 'mexico', 'hotels', 'x', 'orders', '2026-06-01', 1],                // solo Drive
      ['b2c', 'total', 'brasil', 'hotels', 'x', 'orders', '2026-04-01', 999],                // B2C: no cuenta
    ]),
  });
  const r = comparar(canon, store).bg;
  assert.deepEqual(r.claves, { drive: 3, tabla: 3, iguales: 1, distintas: 1, soloDrive: 1, soloTabla: 1 });
  assert.equal(r.mayoresDiferencias[0].dif, 10);
  assert.deepEqual(r.grossBookingsPorMes['2026-04'], { drive: 140, tabla: 150 });
  assert.deepEqual(r.mesesDrive, ['2026-04', '2026-06']);
  assert.match(comparar(canon, store).ac.error, /tabla no arma|no está en el almacén/);
});

test('comparar: tolerancia de 1 USD y relativa', () => {
  const { canon } = buildCanonicals(cubo([['BGT', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Gross Bookings', 1000000.4]]));
  const store = storeCon({ [IDS.bg]: drive([['b2b', 'may', 'chile', 'flights', 'x', 'gross bookings', '2026-04-01', 1000000]]) });
  assert.equal(comparar(canon, store).bg.claves.iguales, 1);
});

test('mesSiguiente y el run rate por defecto arranca el mes después del último cerrado', () => {
  assert.equal(mesSiguiente('2026-10-01'), '2026-11-01');
  assert.equal(mesSiguiente('2026-12-01'), '2027-01-01');
  const rows = [['RR', 'FY27', 10, 'Chile', 'B2B', 'MAY', 'Air', 'Orders', 1], ['RR', 'FY27', 11, 'Chile', 'B2B', 'MAY', 'Air', 'Orders', 2]];
  assert.deepEqual(buildCanonicals(cubo(rows)).canon.rr.rows.map((r) => r[5]), ['2026-11-01']);
  assert.deepEqual(buildCanonicals(cubo(rows), { ultimoCerrado: '2026-09-01' }).canon.rr.rows.map((r) => r[5]), ['2026-10-01', '2026-11-01']);
});

test('Income Services es el mismo concepto que income from outsourced services', () => {
  const { canon, sinMapear } = buildCanonicals(cubo([['ACT', 'FY27', 4, 'Mexico', 'B2B2C', 'ON', 'Hotel', 'Income Services', 5]]));
  assert.equal(canon.ac.rows[0][4], 'income from outsourced services');
  assert.deepEqual(sinMapear.n2, []);
});

test('comparar: desglose por línea y orders por mes', () => {
  const { canon } = buildCanonicals(cubo([
    ['BGT', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Gross Bookings', 100],
    ['BGT', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Orders', 10],
    ['BGT', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Risk', 3],
  ]));
  const store = storeCon({ [IDS.bg]: drive([
    ['b2b', 'may', 'chile', 'flights', 'x', 'gross bookings', '2026-04-01', 90],
    ['b2b', 'may', 'chile', 'flights', 'x', 'orders', '2026-04-01', 10],
  ]) });
  const r = comparar(canon, store).bg;
  assert.deepEqual(r.porLinea['gross bookings'], { distintas: 1, soloDrive: 0, soloTabla: 0, difAbs: 10, difNeta: 10 });
  assert.equal(r.porLinea.risk.soloTabla, 1);
  assert.equal(r.porLinea.orders, undefined);
  assert.deepEqual(r.ordersPorMes['2026-04'], { drive: 10, tabla: 10 });
});

const AJ = { cols: ['year', 'mes', 'pais', 'lob', 'channel', 'product', 'n2', 'valor'], rows: [
  ['FY27', 4, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', -100],
  ['FY27', 12, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', -999],   // posterior al último cerrado: no se aplica
] };

test('ajuste propio: se suma a ACT y FC1 del FY27 hasta el último cerrado, y no toca BGT, RR, LRR ni el año anterior', () => {
  const base = [
    ['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', 1000],
    ['FC1', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', 1000],
    ['LRR', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', 1000],
    ['BGT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', 1000],
    ['RR', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', 1000],
    ['ACT', 'FY26', 4, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', 1000],
  ];
  const { canon } = buildCanonicals(cubo(base), { ultimoCerrado: '2026-10-01', rrDesde: '2026-04-01', ajustes: AJ });
  const v = (sc) => canon[sc].rows.map((r) => r[6]);
  for (const sc of ['ac', 'bl', 'fc', 'fbtb']) assert.deepEqual(v(sc), [900], sc);
  for (const sc of ['bg', 'rr', 'ly', 'lrr']) assert.deepEqual(v(sc), [1000], sc);   // el LRR de Drive no trae el ajuste
});

test('ajuste propio: sin ajustes (o con archivo ausente) no cambia nada, y el archivo real carga', () => {
  const base = [['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', 1000]];
  assert.deepEqual(buildCanonicals(cubo(base), { ajustes: { cols: [], rows: [] } }).canon.ac.rows[0][6], 1000);
  const real = cargarAjustes();
  assert.ok(real.rows.length > 0 && real.cols.includes('n2'));
  assert.ok(real.rows.every((r) => r[real.cols.indexOf('mes')] >= 4 && r[real.cols.indexOf('mes')] <= 6));
  assert.ok(real.rows.every((r) => ['Gross Bookings', 'Orders'].includes(r[real.cols.indexOf('n2')])));
});

test('comparar: totalPorLinea dice cuánto suma cada línea de cada lado', () => {
  const { canon } = buildCanonicals(cubo([['BGT', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Gross Bookings', 100]]));
  const store = storeCon({ [IDS.bg]: drive([['b2b', 'may', 'chile', 'flights', 'x', 'gross bookings', '2026-04-01', 90]]) });
  assert.deepEqual(comparar(canon, store).bg.totalPorLinea['gross bookings'], { drive: 90, tabla: 100 });
});

test('General es corporate, Packages es packages general, y Alianzas Financieras es línea propia', () => {
  const { canon, sinMapear } = buildCanonicals(cubo([
    ['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'General', 'Gross Bookings', 3],
    ['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Packages', 'Gross Bookings', 4],
    ['ACT', 'FY27', 4, 'Brazil', 'B2B2C', 'ON', 'Air', 'Alianzas Financieras', 5],
  ]), { ajustes: SIN_AJ });
  assert.deepEqual(canon.ac.rows.map((r) => r[3] + ':' + r[4]).sort(), ['corporate:gross bookings', 'flights:alianzas financieras', 'packages general:gross bookings']);
  assert.deepEqual(sinMapear, { pais: [], producto: [], n2: [] });
});
