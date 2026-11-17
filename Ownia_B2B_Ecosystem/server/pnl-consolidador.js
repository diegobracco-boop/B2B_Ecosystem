'use strict';
// P&L Accounting desde el consolidador: arma, a partir de la tabla compartido.app_b2b_ecosystem, los mismos JSON
// canónicos ({ meta, cols, rows }) que hoy publica Inputs_Planning_PnL en Drive, para que el módulo los lea sin cambios,
// y los compara contra los de Drive. Todo el vocabulario de la tabla (países, canales, productos, líneas) se traduce
// al de los JSON. Lo que no se pueda traducir queda en `sinMapear`, nunca se descarta en silencio.
//
// Cómo se arman los escenarios (a confirmar con la comparación contra Drive):
//   ac   = ACT del FY27 hasta el último mes cerrado            ly  = ACT del FY26
//   bl   = ACT del FY27 completo (en la tabla trae actuals cerrados + run rate del resto, igual que el baseline)
//   bg   = BGT del FY27       rr = RR del FY27       lrr = LRR del FY27
//   fc y fbtb = FC1 del FY27 (el FC1 de conso ES el Bridge to Budget: ya no hay otro forecast)
const { IDS } = require('./pnl-drive-dimensiones');

const COLS = ['LoB', 'Canal', 'Pais', 'Producto', 'P&L N2', 'Fecha', 'Monto USD'];

const PAIS = {
  Argentina: 'argentina', Brazil: 'brasil', Chile: 'chile', Colombia: 'colombia', Ecuador: 'ecuador',
  Mexico: 'mexico', Peru: 'peru', Others: 'others countries', 'OPS + RG': 'rg',
};
// Hipótesis a confirmar con la comparación: 'General' y 'Packages' van al mismo producto de los JSON.
const PRODUCTO = {
  Air: 'flights', Hotel: 'hotels', Cars: 'cars', Insurance: 'insurance', 'D. Services': 'dest. serv.',
  'Vacation Rentals': 'vacation rentals', Cruise: 'cruises', Buses: 'buses', Packages: 'packages general', General: 'packages general',
};
const N2 = {
  'Fulfillment Center Fees': 'fulfilment center fees', Sourcing: 'sourcing', Orders: 'orders', 'Gross Bookings': 'gross bookings',
  Channels: 'channels-personnel/expenses', 'Marketing Personnel': 'marketing-personnel/expenses', 'O. Incentives': 'other incentives',
  'Finance & Admin.': 'finance & admin.', 'General Management': 'general management', 'IT Personnel': 'it - personnel/expenses',
  'Customer Fees & Charges': 'customer fees & charges', 'D&A': 'd&a', 'Up Front Incentives': 'up front incentives',
  'Credit Card Processing': 'credit card processing', Cancellations: 'cancellations', 'Intercomp. Transactions': 'intercompany transactions',
  'Capitalized IT': 'capitalized it', 'Bad Debt': 'bad debt', 'Third Party Comission': 'third party commissions',
  'Back End Incentives': 'back end incentives', 'Cost of Installments': 'cost of installments', 'Media & Other revenue': 'media & other revenue',
  'Breakage Revenue': 'breakage revenue', 'Rev. Taxes': 'revenue taxes', Errors: 'errors', 'O. Transactional Taxes': 'other transactional taxes',
  'Marketing - Direct': 'marketing-direct', 'Cost of Sales as Principal': 'cost of sales as principal',
  'Media & Other Cost - Media Solutions': 'media & other cost', 'Loyalty Program': 'loyalty program', 'Fair value': 'fair value - stock based compensation',
  'Customer Claims': 'customer claims', Frauds: 'frauds', 'Other Tax': 'other taxes', 'Income from outsourced services': 'income from outsourced services',
  'Loyalty Revenue': 'loyalty revenue', Equity: 'equity income / loss', 'Revenue from Sales as Principal': 'revenue from sales as principal',
};

/** FY27 + mes calendario 4 → 2026-04-01; mes 1 → 2027-01-01. */
function fechaFiscal(year, mes) {
  const fy = 2000 + Number(String(year).replace(/\D/g, ''));
  const y = Number(mes) >= 4 ? fy - 1 : fy;
  return `${y}-${String(mes).padStart(2, '0')}-01`;
}

/** '2026-10-01' → '2026-11-01'. */
function mesSiguiente(fecha) {
  const [y, m] = fecha.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Los JSON solo abren MAY/MIN en B2B; B2B2C (y cualquier otro canal) va a 'total'. */
function canalDe(lob, channel) {
  if (lob === 'B2B' && channel === 'MAY') return 'may';
  if (lob === 'B2B' && channel === 'MIN') return 'min';
  return 'total';
}

/**
 * @param {{cols:string[], rows:any[][]}} cubo  salida de `consolidador_leer.py cubo`
 * @param {{ultimoCerrado?:string, rrDesde?:string}} opts  último mes con actuals cerrados (AAAA-MM-01) y desde qué mes se
 *        toma el run rate (por defecto el mes siguiente al último cerrado, como el runrate.json de Drive)
 * @returns {{canon:object, sinMapear:object}}
 */
function buildCanonicals(cubo, opts = {}) {
  const ultimoCerrado = opts.ultimoCerrado || '2026-10-01';
  const rrDesde = opts.rrDesde || mesSiguiente(ultimoCerrado);
  const ix = Object.fromEntries(cubo.cols.map((c, i) => [c, i]));
  const sinMapear = { pais: new Set(), producto: new Set(), n2: new Set() };
  const SPEC = [   // [clave canónica, escenario de la tabla, año, filtro de mes (fecha)]
    ['ac', 'ACT', 'FY27', (f) => f <= ultimoCerrado],
    ['bl', 'ACT', 'FY27', () => true],
    ['bg', 'BGT', 'FY27', () => true],
    ['fc', 'FC1', 'FY27', () => true],
    ['fbtb', 'FC1', 'FY27', () => true],
    ['rr', 'RR', 'FY27', (f) => f >= rrDesde],
    ['lrr', 'LRR', 'FY27', () => true],
    ['ly', 'ACT', 'FY26', () => true],
  ];
  const bySc = {};   // 'ACT|FY27' -> filas ya traducidas (agregadas)
  for (const row of cubo.rows) {
    const k = `${row[ix.scenario]}|${row[ix.year]}`;
    const lob = row[ix.lob];
    const pais = PAIS[row[ix.pais]] || (sinMapear.pais.add(row[ix.pais]), String(row[ix.pais]).toLowerCase());
    const prod = PRODUCTO[row[ix.product]] || (sinMapear.producto.add(row[ix.product]), String(row[ix.product]).toLowerCase());
    const n2 = N2[row[ix.n2]] || (sinMapear.n2.add(row[ix.n2]), String(row[ix.n2]).toLowerCase());
    const fecha = fechaFiscal(row[ix.year], row[ix.mes]);
    const key = [lob, canalDe(lob, row[ix.channel]), pais, prod, n2, fecha].join('\u0001');
    const m = (bySc[k] = bySc[k] || new Map());
    m.set(key, (m.get(key) || 0) + (Number(row[ix.valor]) || 0));
  }
  const canon = {};
  for (const [clave, sc, year, filtroMes] of SPEC) {
    const rows = [];
    const fechas = new Set();
    for (const [key, v] of bySc[`${sc}|${year}`] || []) {
      const [lob, canal, pais, prod, n2, fecha] = key.split('\u0001');
      if (!filtroMes(fecha) || !v) continue;
      rows.push([lob.toLowerCase(), canal, pais, prod, n2, fecha, v]);
      fechas.add(fecha);
    }
    canon[clave] = { meta: { concepto: clave, fuente: `compartido.app_b2b_ecosystem ${sc} ${year}`, fechas: [...fechas].sort(), filas: rows.length }, cols: COLS, rows };
  }
  return { canon, sinMapear: Object.fromEntries(Object.entries(sinMapear).map(([k, s]) => [k, [...s].sort()])) };
}

const TOL_ABS = 1;       // USD
const TOL_REL = 1e-6;

function agregar(json, extra) {
  const c = json.cols;
  const i = Object.fromEntries(COLS.map((n) => [n, c.indexOf(n)]));
  const fino = new Map();
  const porMes = {};
  const gb = {};
  const prodGb = {};
  for (const r of json.rows) {
    const lob = String(r[i.LoB]).toLowerCase();
    if (lob === 'b2c') continue;   // el módulo descarta B2C: no se compara
    const fecha = String(r[i.Fecha]).substring(0, 10);
    const ym = fecha.substring(0, 7);
    const n2 = String(r[i['P&L N2']]).trim().toLowerCase();
    const v = Number(r[i['Monto USD']]) || 0;
    const key = [lob, String(r[i.Canal]).trim().toLowerCase(), String(r[i.Pais]).trim().toLowerCase(), n2, ym].join('|');
    fino.set(key, (fino.get(key) || 0) + v);
    porMes[ym] = (porMes[ym] || 0) + v;
    if (n2 === 'gross bookings') {
      gb[ym] = (gb[ym] || 0) + v;
      const p = String(r[i.Producto]).trim().toLowerCase();
      prodGb[p] = (prodGb[p] || 0) + v;
    }
  }
  return { fino, porMes, gb, prodGb, meses: Object.keys(porMes).sort(), extra };
}

const redondeo = (n) => Math.round(n * 100) / 100;

/**
 * Compara, escenario por escenario, lo armado desde la tabla contra el JSON de Drive del almacén.
 * @param {object} canon  salida de buildCanonicals().canon
 * @param {object} fileStore  el almacén (get(id) → { buf })
 */
function comparar(canon, fileStore, opts = {}) {
  const top = opts.top || 15;
  const out = {};
  for (const [sc, id] of Object.entries(IDS)) {
    const f = fileStore && fileStore.get(id);
    const t = canon[sc];
    if (!f) { out[sc] = { error: 'el JSON de Drive no está en el almacén' }; continue; }
    if (!t) { out[sc] = { error: 'la tabla no arma este escenario' }; continue; }
    const D = agregar(JSON.parse(f.buf.toString('utf8')));
    const T = agregar(t);
    let iguales = 0; const distintas = []; let soloDrive = 0; let soloTabla = 0;
    for (const [k, vd] of D.fino) {
      if (!T.fino.has(k)) { soloDrive++; distintas.push({ k, drive: vd, tabla: null, dif: -vd }); continue; }
      const vt = T.fino.get(k);
      const dif = vt - vd;
      if (Math.abs(dif) > TOL_ABS && Math.abs(dif) > TOL_REL * Math.max(Math.abs(vd), Math.abs(vt))) distintas.push({ k, drive: vd, tabla: vt, dif }); else iguales++;
    }
    for (const [k, vt] of T.fino) if (!D.fino.has(k)) { soloTabla++; distintas.push({ k, drive: null, tabla: vt, dif: vt }); }
    distintas.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
    const meses = Array.from(new Set([...D.meses, ...T.meses])).sort();
    out[sc] = {
      mesesDrive: D.meses, mesesTabla: T.meses,
      claves: { drive: D.fino.size, tabla: T.fino.size, iguales, distintas: distintas.length - soloDrive - soloTabla, soloDrive, soloTabla },
      grossBookingsPorMes: Object.fromEntries(meses.map((m) => [m, { drive: redondeo(D.gb[m] || 0), tabla: redondeo(T.gb[m] || 0) }])),
      grossBookingsPorProducto: Object.fromEntries(Array.from(new Set([...Object.keys(D.prodGb), ...Object.keys(T.prodGb)])).sort().map((p) => [p, { drive: redondeo(D.prodGb[p] || 0), tabla: redondeo(T.prodGb[p] || 0) }])),
      mayoresDiferencias: distintas.slice(0, top).map((d) => ({ clave: d.k, drive: d.drive === null ? null : redondeo(d.drive), tabla: d.tabla === null ? null : redondeo(d.tabla), dif: redondeo(d.dif) })),
    };
  }
  return out;
}

module.exports = { buildCanonicals, comparar, fechaFiscal, canalDe, mesSiguiente, PAIS, PRODUCTO, N2, COLS };
