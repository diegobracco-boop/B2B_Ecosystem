// Armado de los JSON canónicos desde la tabla del consolidador y comparación contra los de Drive (server/pnl-consolidador.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCanonicals, buildManagerialActuals, buildHubCanonicals, nivelesMgr, comparar, fechaFiscal, canalDe, mesSiguiente, cargarAjustes } = require('../server/pnl-consolidador');
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
  const { canon } = buildCanonicals(cubo(rows), { rrDesde: '2026-10-01', ajustes: SIN_AJ });
  assert.deepEqual(canon.rr.rows.map((r) => r[5]), ['2026-11-01']);
});

const drive = (rows) => ({ meta: {}, cols: ['LoB', 'Canal', 'Pais', 'Producto', 'P&L N1', 'P&L N2', 'Fecha', 'Monto USD'], rows });
const storeCon = (obj) => ({ get: (id) => (obj[id] ? { meta: { updatedAt: 0 }, buf: Buffer.from(JSON.stringify(obj[id])) } : null) });

test('comparar: iguales, distintas, solo de un lado, y descarta B2C', () => {
  const { canon } = buildCanonicals(cubo([
    ['BGT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'Gross Bookings', 100],
    ['BGT', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Gross Bookings', 50],
    ['BGT', 'FY27', 5, 'Peru', 'B2B2C', 'ON', 'Hotel', 'Orders', 7],
  ]), { ajustes: SIN_AJ });
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
  const { canon } = buildCanonicals(cubo([['BGT', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Gross Bookings', 1000000.4]]), { ajustes: SIN_AJ });
  const store = storeCon({ [IDS.bg]: drive([['b2b', 'may', 'chile', 'flights', 'x', 'gross bookings', '2026-04-01', 1000000]]) });
  assert.equal(comparar(canon, store).bg.claves.iguales, 1);
});

test('mesSiguiente y el run rate por defecto arranca el mes después del último cerrado', () => {
  assert.equal(mesSiguiente('2026-10-01'), '2026-11-01');
  assert.equal(mesSiguiente('2026-12-01'), '2027-01-01');
  const rows = [['RR', 'FY27', 10, 'Chile', 'B2B', 'MAY', 'Air', 'Orders', 1], ['RR', 'FY27', 11, 'Chile', 'B2B', 'MAY', 'Air', 'Orders', 2]];
  assert.deepEqual(buildCanonicals(cubo(rows), { ajustes: SIN_AJ }).canon.rr.rows.map((r) => r[5]), ['2026-11-01']);
  assert.deepEqual(buildCanonicals(cubo(rows), { ultimoCerrado: '2026-09-01', ajustes: SIN_AJ }).canon.rr.rows.map((r) => r[5]), ['2026-10-01', '2026-11-01']);
});

test('Income Services es el mismo concepto que income from outsourced services', () => {
  const { canon, sinMapear } = buildCanonicals(cubo([['ACT', 'FY27', 4, 'Mexico', 'B2B2C', 'ON', 'Hotel', 'Income Services', 5]]), { ajustes: SIN_AJ });
  assert.equal(canon.ac.rows[0][4], 'income from outsourced services');
  assert.deepEqual(sinMapear.n2, []);
});

test('comparar: desglose por línea y orders por mes', () => {
  const { canon } = buildCanonicals(cubo([
    ['BGT', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Gross Bookings', 100],
    ['BGT', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Orders', 10],
    ['BGT', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Risk', 3],
  ]), { ajustes: SIN_AJ });
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

test('ajuste propio: sin ajustes (o con archivo ausente) no cambia nada', () => {
  const base = [['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', 1000]];
  assert.deepEqual(buildCanonicals(cubo(base), { ajustes: { cols: [], rows: [] } }).canon.ac.rows[0][6], 1000);
  assert.deepEqual(buildCanonicals(cubo(base), { ajustes: [] }).canon.ac.rows[0][6], 1000);
});

test('los archivos reales de ajustes cargan y dicen a qué se aplican', () => {
  const [api, axi] = cargarAjustes();
  assert.ok(api.rows.length > 0 && api.cols.includes('n2'));
  assert.ok(api.rows.every((r) => r[api.cols.indexOf('mes')] >= 4 && r[api.cols.indexOf('mes')] <= 6));
  assert.ok(api.rows.every((r) => ['Gross Bookings', 'Orders'].includes(r[api.cols.indexOf('n2')])));
  assert.deepEqual(api.meta.escenarios_por_anio, { FY27: ['ACT', 'FC1'] });
  // Reverso AxI: solo Other Incentives de B2B/B2B2C; FY27 desde la hoja Budget (1.500.322) y FY26 desde RunRate (748.004)
  assert.ok(axi.rows.every((r) => r[axi.cols.indexOf('n2')] === 'O. Incentives' && ['B2B', 'B2B2C'].includes(r[axi.cols.indexOf('lob')])));
  const tot = {};
  for (const r of axi.rows) tot[r[0]] = (tot[r[0]] || 0) + r[axi.cols.indexOf('valor')];
  assert.equal(Math.round(tot.FY27), 1500322);
  assert.equal(Math.round(tot.FY26), 748004);
  assert.deepEqual(axi.meta.escenarios_por_anio, { FY27: ['ACT', 'BGT', 'FC1', 'LRR', 'RR'], FY26: ['ACT'] });
  assert.equal(axi.meta.hasta_ultimo_cerrado, false);
});

test('Reverso AxI: se suma a todos los escenarios del FY27 (todos los meses) y al año anterior, no solo a los meses cerrados', () => {
  const AXI = { meta: { escenarios_por_anio: { FY27: ['ACT', 'BGT', 'FC1', 'LRR', 'RR'], FY26: ['ACT'] }, hasta_ultimo_cerrado: false },
    cols: ['year', 'mes', 'pais', 'lob', 'channel', 'product', 'n2', 'valor'],
    rows: [['FY27', 12, 'Brazil', 'B2B', 'MAY', 'Hotel', 'O. Incentives', 10], ['FY26', 5, 'Brazil', 'B2B', 'MAY', 'Hotel', 'O. Incentives', 7]] };
  const base = [
    ['ACT', 'FY27', 12, 'Brazil', 'B2B', 'MAY', 'Hotel', 'O. Incentives', 100],
    ['BGT', 'FY27', 12, 'Brazil', 'B2B', 'MAY', 'Hotel', 'O. Incentives', 100],
    ['RR', 'FY27', 12, 'Brazil', 'B2B', 'MAY', 'Hotel', 'O. Incentives', 100],
    ['ACT', 'FY26', 5, 'Brazil', 'B2B', 'MAY', 'Hotel', 'O. Incentives', 100],
  ];
  const { canon } = buildCanonicals(cubo(base), { ultimoCerrado: '2026-10-01', ajustes: [AXI] });
  const v = (sc) => canon[sc].rows.map((r) => r[6]);
  assert.deepEqual(v('bl'), [110]);   // diciembre es run rate dentro del ACT, y el ajuste va igual
  assert.deepEqual(v('ac'), []);      // pero ac solo tiene meses cerrados
  assert.deepEqual(v('bg'), [110]);
  assert.deepEqual(v('rr'), [110]);
  assert.deepEqual(v('fc'), [10]);    // el ajuste crea la fila aunque el FC1 no la traiga
  assert.deepEqual(v('ly'), [107]);
});

test('comparar: totalPorLinea dice cuánto suma cada línea de cada lado', () => {
  const { canon } = buildCanonicals(cubo([['BGT', 'FY27', 4, 'Chile', 'B2B', 'MAY', 'Air', 'Gross Bookings', 100]]), { ajustes: SIN_AJ });
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

// ── actuals del P&L Managerial: N1 a N5 desde la línea y el nivel 3 de la tabla ────────────────────────────────────────────────
const COLS_MGR = ['year', 'mes', 'pais', 'lob', 'channel', 'product', 'linea', 'n2', 'n3', 'valor'];
const cuboMgr = (rows) => ({ version: 1, cols: COLS_MGR, rows });

test('nivelesMgr: N1 es la línea (con el vocabulario de Drive) y N4/N5 se derivan del nivel 3', () => {
  assert.deepEqual(nivelesMgr('GB NAC', 'Gross Bookings', 'Gross Bookings'), ['gross bookings domestic', 'gross bookings', 'gross bookings', 'gross bookings', 'gross bookings']);
  assert.deepEqual(nivelesMgr('Orders INT', 'Orders', 'Orders'), ['orders international', 'orders', 'orders', 'orders', 'orders']);
  assert.deepEqual(nivelesMgr('Fees', 'Customer Fees & Charges', 'Net Revenues'), ['fees', 'customer fees & charges', 'net revenue', 'gross profit', 'operating contribution']);
  assert.deepEqual(nivelesMgr('Credit Card Processing', 'Credit Card Processing', 'Cost of Revenue'), ['credit card processing', 'credit card processing', 'cost of revenue', 'gross profit', 'operating contribution']);
  assert.deepEqual(nivelesMgr('Affiliates', 'Third Party Comission', 'Sales & Marketing'), ['affiliates', 'third party commissions', 'sales & marketing', 'sales & marketing', 'operating contribution']);
  assert.deepEqual(nivelesMgr('IT Personnel', 'IT Personnel', 'Technology and Content'), ['it - personnel/expenses', 'it - personnel/expenses', 'tecnhology and content', 'tecnhology and content', 'fixed cost']);
  assert.equal(nivelesMgr('Sourcing Air', 'Sourcing', 'Technology and Content')[0], 'sourcing');
  // Alianzas Financieras: línea propia en todos los niveles (la tabla la deja dentro de Sourcing)
  assert.deepEqual(nivelesMgr('Alianzas Financieras', 'Sourcing', 'Technology and Content'), ['alianzas financieras', 'alianzas financieras', 'alianzas financieras', 'alianzas financieras', 'alianzas financieras']);
  // Other Tax entra en la OC aunque la tabla no diga en qué nivel 3 cae
  assert.deepEqual(nivelesMgr('Other Tax', 'Other Tax', 'Adjustments EBIT').slice(2), ['sales & marketing', 'sales & marketing', 'operating contribution']);
});

test('buildManagerialActuals: mismo formato de actuals.json con N1 a N5, solo hasta el último mes cerrado, sumado por clave', () => {
  const { canon, sinMapear } = buildManagerialActuals(cuboMgr([
    ['FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'GB NAC', 'Gross Bookings', 'Gross Bookings', 100],
    ['FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'GB NAC', 'Gross Bookings', 'Gross Bookings', 50],     // misma clave: se suma
    ['FY27', 4, 'Chile', 'B2B2C', 'ON', 'Hotel', 'Fees', 'Customer Fees & Charges', 'Net Revenues', 7],
    ['FY27', 11, 'Brazil', 'B2B', 'MAY', 'Air', 'GB NAC', 'Gross Bookings', 'Gross Bookings', 999],  // run rate
  ]), { ultimoCerrado: '2026-10-01', ajustes: SIN_AJ });
  assert.deepEqual(canon.cols, ['LoB', 'Canal', 'Pais', 'Producto', 'P&L N1', 'P&L N2', 'P&L N3', 'P&L N4', 'P&L N5', 'Fecha', 'Monto USD']);
  assert.deepEqual(canon.rows, [
    ['b2b', 'may', 'brasil', 'flights', 'gross bookings domestic', 'gross bookings', 'gross bookings', 'gross bookings', 'gross bookings', '2026-04-01', 150],
    ['b2b2c', 'total', 'chile', 'hotels', 'fees', 'customer fees & charges', 'net revenue', 'gross profit', 'operating contribution', '2026-04-01', 7],
  ]);
  assert.deepEqual(canon.meta.fechas, ['2026-04-01']);
  assert.deepEqual(sinMapear, { pais: [], producto: [], n2: [], n3: [] });
});

test('buildManagerialActuals: lo que no se puede traducir queda en sinMapear', () => {
  const { sinMapear } = buildManagerialActuals(cuboMgr([['FY27', 4, 'Atlantis', 'B2B', 'MAY', 'Drones', 'Rayos', 'Rayos N2', 'Rayos N3', 1]]), { ajustes: SIN_AJ });
  assert.deepEqual(sinMapear, { pais: ['Atlantis'], producto: ['Drones'], n2: ['Rayos N2'], n3: ['Rayos N3'] });
});

test('buildManagerialActuals: los ajustes propios entran con línea y nivel 3 (solo ACT del FY27, hasta el último cerrado)', () => {
  const aj = (meta, rows) => ({ meta, cols: ['year', 'mes', 'pais', 'lob', 'channel', 'product', 'n2', 'valor'], rows });
  const ajustes = [
    aj({ escenarios_por_anio: { FY27: ['ACT', 'FC1'] } }, [['FY27', 4, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', -30], ['FY27', 12, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', -1]]),
    aj({ escenarios_por_anio: { FY27: ['ACT', 'BGT'], FY26: ['ACT'] }, hasta_ultimo_cerrado: false }, [['FY27', 5, 'Argentina', 'B2B2C', 'ON', 'Hotel', 'O. Incentives', 5], ['FY26', 5, 'Argentina', 'B2B2C', 'ON', 'Hotel', 'O. Incentives', 99]]),
  ];
  const { canon } = buildManagerialActuals(cuboMgr([['FY27', 4, 'Brazil', 'B2B', 'MAY', 'Hotel', 'GB NAC', 'Gross Bookings', 'Gross Bookings', 100]]), { ultimoCerrado: '2026-10-01', ajustes });
  const porN1 = Object.fromEntries(canon.rows.map((r) => [r[4], r[10]]));
  assert.equal(porN1['gross bookings domestic'], 70);        // 100 de la tabla - 30 del ajuste; el de diciembre no es cerrado
  assert.equal(porN1['other incentives'], 5);                // el FY26 no entra en el actuals del FY27
  const oi = canon.rows.find((r) => r[4] === 'other incentives');
  assert.deepEqual(oi.slice(5, 9), ['other incentives', 'net revenue', 'gross profit', 'operating contribution']);
});

test('buildManagerialActuals: si el ajuste trae la línea (GB NAC / GB INT), se respeta; el Accounting sigue sumando por nivel 2', () => {
  const ajustes = { meta: { escenarios_por_anio: { FY27: ['ACT'] } }, cols: ['year', 'mes', 'pais', 'lob', 'channel', 'product', 'n2', 'linea', 'valor'],
    rows: [['FY27', 6, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', 'GB NAC', 10], ['FY27', 6, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', 'GB INT', -4]] };
  const { canon } = buildManagerialActuals(cuboMgr([]), { ultimoCerrado: '2026-10-01', ajustes });
  assert.deepEqual(Object.fromEntries(canon.rows.map((r) => [r[4], r[10]])), { 'gross bookings domestic': 10, 'gross bookings international': -4 });
  const ac = buildCanonicals({ cols: COLS, rows: [] }, { ultimoCerrado: '2026-10-01', ajustes }).canon.ac;
  assert.deepEqual(ac.rows.map((r) => r[6]), [6]);   // nivel 2 'gross bookings': 10 - 4
});

// ── series del Hub: N1, N2, N3, N5, vista gestional y B2C ──────────────────────────────────────────────────────────────────
const COLS_HUB_IN = ['scenario', 'year', 'mes', 'pais', 'lob', 'channel', 'product', 'linea', 'n2', 'n3', 'valor'];
const cuboHub = (rows) => ({ version: 1, cols: COLS_HUB_IN, rows });
const VISTA = { affiliates: 'palancas', fees: 'palancas', 'gross bookings domestic': 'gross bookings', 'orders domestic': 'orders' };

test('buildHubCanonicals: una serie por JSON del Hub, con las columnas y el vocabulario de Drive, B2C incluido', () => {
  const { canon, sinMapear } = buildHubCanonicals(cuboHub([
    ['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'GB NAC', 'Gross Bookings', 'Gross Bookings', 100],
    ['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'Affiliates', 'Third Party Comission', 'Sales & Marketing', -4],
    ['ACT', 'FY27', 4, 'Mexico', 'B2C', 'Site', 'Hotel', 'Fees', 'Customer Fees & Charges', 'Net Revenues', 9],
    ['ACT', 'FY27', 4, 'Mexico', 'B2C', 'App', 'Hotel', 'Fees', 'Customer Fees & Charges', 'Net Revenues', 1],   // el canal de B2C no se abre
    ['BGT', 'FY27', 5, 'Chile', 'B2B2C', 'ON', 'Hotel', 'Orders NAC', 'Orders', 'Orders', 7],
    ['ACT', 'FY26', 4, 'Peru', 'B2B2C', 'Site', 'Cars', 'Fees', 'Customer Fees & Charges', 'Net Revenues', 2],
    ['ACT', 'FY27', 12, 'Peru', 'B2B2C', 'Site', 'Cars', 'Fees', 'Customer Fees & Charges', 'Net Revenues', 3],
  ]), { ultimoCerrado: '2026-10-01', ajustes: SIN_AJ, vista: VISTA });
  assert.deepEqual(Object.keys(canon).sort(), ['bg', 'bl', 'fbtb', 'fc', 'lrr', 'ly', 'rr']);
  assert.deepEqual(canon.bl.cols, ['LoB', 'Canal', 'Pais', 'Producto', 'P&L N1', 'P&L N2', 'P&L N3', 'P&L N5', 'P&L Managerial View', 'Fecha', 'Monto USD']);
  // baseline = ACT del FY27 completo (el actual de diciembre es run rate dentro del mismo escenario)
  assert.equal(canon.bl.rows.length, 4);
  assert.deepEqual(canon.bl.rows.find((r) => r[4] === 'affiliates'), ['b2b', 'may', 'brasil', 'flights', 'affiliates', 'third party commissions', 'sales & marketing', 'operating contribution', 'palancas', '2026-04-01', -4]);
  assert.deepEqual(canon.bl.rows.find((r) => r[0] === 'b2c'), ['b2c', 'total', 'mexico', 'hotels', 'fees', 'customer fees & charges', 'net revenue', 'operating contribution', 'palancas', '2026-04-01', 10]);   // 9 + 1: Site y App juntos
  assert.deepEqual(canon.bg.rows, [['b2b2c', 'total', 'chile', 'hotels', 'orders domestic', 'orders', 'orders', 'orders', 'orders', '2026-05-01', 7]]);
  assert.equal(canon.ly.rows.length, 1);
  assert.deepEqual(sinMapear, { pais: [], producto: [], n2: [], n3: [] });
});

test('buildHubCanonicals: una línea sin vista en el Glosario queda con la vista vacía (el Hub la junta en "Otros") y lo que no se traduce va a sinMapear', () => {
  const { canon, sinMapear } = buildHubCanonicals(cuboHub([
    ['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'Rayos', 'Rayos N2', 'Rayos N3', 1],
  ]), { ajustes: SIN_AJ, vista: VISTA });
  assert.equal(canon.bl.rows[0][8], '');
  assert.deepEqual(sinMapear.n2, ['Rayos N2']);
  assert.deepEqual(sinMapear.n3, ['Rayos N3']);
});

test('buildHubCanonicals: la vista gestional sale de pnl-vista-gestional.json (una por línea N1 del Glosario, sin líneas contradictorias)', () => {
  const { vista } = require('../server/pnl-vista-gestional.json');
  assert.equal(vista.affiliates, 'palancas');
  assert.equal(vista['marketing-personnel/expenses'], 'fixed cost');
  assert.equal(vista.branding, 'marketing');
  assert.equal(vista['up front incentives'], 'palancas');
  assert.equal(vista['back end incentives'], 'variables regionales');
  const { canon } = buildHubCanonicals(cuboHub([['ACT', 'FY27', 4, 'Brazil', 'B2B', 'MAY', 'Air', 'Affiliates', 'Third Party Comission', 'Sales & Marketing', 1]]), { ajustes: SIN_AJ });
  assert.equal(canon.bl.rows[0][8], 'palancas');   // sin pasar `vista`: usa el archivo
});

test('buildHubCanonicals: los ajustes propios entran en las series que dicen (el AxI también en el año anterior) con línea y nivel 3', () => {
  const aj = (meta, rows) => ({ meta, cols: ['year', 'mes', 'pais', 'lob', 'channel', 'product', 'n2', 'linea', 'valor'], rows });
  const ajustes = [
    aj({ escenarios_por_anio: { FY27: ['ACT', 'FC1'] } }, [['FY27', 4, 'Brazil', 'B2B', 'MAY', 'Hotel', 'Gross Bookings', 'GB INT', -30]]),
    aj({ escenarios_por_anio: { FY27: ['BGT'], FY26: ['ACT'] }, hasta_ultimo_cerrado: false }, [['FY27', 5, 'Argentina', 'B2B2C', 'ON', 'Hotel', 'O. Incentives', null, 5], ['FY26', 5, 'Argentina', 'B2B2C', 'ON', 'Hotel', 'O. Incentives', null, 9]]),
  ];
  const { canon } = buildHubCanonicals(cuboHub([]), { ultimoCerrado: '2026-10-01', ajustes, vista: {} });
  assert.deepEqual(canon.bl.rows.map((r) => [r[4], r[10]]), [['gross bookings international', -30]]);
  assert.deepEqual(canon.fc.rows.map((r) => [r[4], r[10]]), [['gross bookings international', -30]]);   // FC1 -> fc y fbtb
  assert.deepEqual(canon.bg.rows.map((r) => [r[4], r[6], r[10]]), [['other incentives', 'net revenue', 5]]);
  assert.deepEqual(canon.ly.rows.map((r) => [r[4], r[10]]), [['other incentives', 9]]);
});
