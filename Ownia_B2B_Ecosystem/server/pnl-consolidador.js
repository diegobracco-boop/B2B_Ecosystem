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
const fs = require('fs');
const path = require('path');
const { IDS } = require('./pnl-drive-dimensiones');

// Ajustes propios que se suman a la tabla (la tabla es AS REPORTED y estas partidas las pone el pipeline de Drive):
//   - pnl-ajustes-actuals.json: reclasificación de GB y Orders de API B2B-MAY, abril-junio (conso no la incorpora).
//   - pnl-ajustes-axi.json: "Reverso AxI" (SIN PPA), hoy solo Other Incentives de B2B y B2B2C: hoja Budget -> FY27, hoja RunRate -> FY26.
// Cada archivo dice en su `meta` a qué escenarios del año aplica (`escenarios_por_anio`) y si solo hasta el último mes cerrado
// (`hasta_ultimo_cerrado`, por defecto sí). Se regeneran con scripts/generar-ajustes-pnl.py cuando cambian sus fuentes.
const AJUSTES_ARCHIVOS = ['pnl-ajustes-actuals.json', 'pnl-ajustes-axi.json'];
const AJUSTE_DEFAULT = { escenarios_por_anio: { FY27: ['ACT', 'FC1'] }, hasta_ultimo_cerrado: true };
function cargarAjustes() {
  return AJUSTES_ARCHIVOS.map((n) => {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, n), 'utf8')); } catch (e) { return { meta: {}, cols: [], rows: [] }; }
  });
}

/** Los ajustes propios ya abiertos por escenario (una fila por escenario al que aplican), con las reglas de su `meta`.
 *  @param {object|object[]} [ajustes] los archivos (por defecto, los de disco); en los tests se pasan a mano
 *  @returns {{scenario:string,year:string,mes:number,pais:string,lob:string,channel:string,product:string,n2:string,valor:number}[]} */
function ajustesComoFilas(ajustes, ultimoCerrado) {
  const archivos = ajustes === undefined ? cargarAjustes() : (Array.isArray(ajustes) ? ajustes : [ajustes]);
  const filas = [];
  for (const aj of archivos) {
    const meta = { ...AJUSTE_DEFAULT, ...(aj.meta || {}) };
    const ai = Object.fromEntries((aj.cols || []).map((c, i) => [c, i]));
    for (const a of aj.rows || []) {
      if (meta.hasta_ultimo_cerrado !== false && fechaFiscal(a[ai.year], a[ai.mes]) > ultimoCerrado) continue;
      for (const sc of meta.escenarios_por_anio[a[ai.year]] || []) {
        filas.push({ scenario: sc, year: a[ai.year], mes: a[ai.mes], pais: a[ai.pais], lob: a[ai.lob], channel: a[ai.channel], product: a[ai.product], n2: a[ai.n2], linea: ai.linea === undefined ? null : a[ai.linea], valor: a[ai.valor] });
      }
    }
  }
  return filas;
}

const COLS = ['LoB', 'Canal', 'Pais', 'Producto', 'P&L N2', 'Fecha', 'Monto USD'];

const PAIS = {
  Argentina: 'argentina', Brazil: 'brasil', Chile: 'chile', Colombia: 'colombia', Ecuador: 'ecuador',
  Mexico: 'mexico', Peru: 'peru', Others: 'others countries', 'OPS + RG': 'rg',
};
// Confirmado con montos (comparación del 17/11): 'General' de la tabla suma exacto lo que Drive llama 'corporate' (306.714 de GB) y
// 'Packages' suma exacto 'packages general'.
const PRODUCTO = {
  Air: 'flights', Hotel: 'hotels', Cars: 'cars', Insurance: 'insurance', 'D. Services': 'dest. serv.',
  'Vacation Rentals': 'vacation rentals', Cruise: 'cruises', Buses: 'buses', Packages: 'packages general', General: 'corporate',
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
  'Marketing - Direct': 'marketing-direct', 'Alianzas Financieras': 'alianzas financieras', 'Cost of Sales as Principal': 'cost of sales as principal',
  'Media & Other Cost - Media Solutions': 'media & other cost', 'Loyalty Program': 'loyalty program', 'Fair value': 'fair value - stock based compensation',
  'Customer Claims': 'customer claims', Frauds: 'frauds', 'Other Tax': 'other taxes', 'Income from outsourced services': 'income from outsourced services', 'Income Services': 'income from outsourced services',
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
  const filas = ajustesComoFilas(opts.ajustes, ultimoCerrado).map((a) => {
    const r = new Array(cubo.cols.length).fill(null);
    r[ix.scenario] = a.scenario; r[ix.year] = a.year; r[ix.mes] = a.mes; r[ix.pais] = a.pais; r[ix.lob] = a.lob;
    r[ix.channel] = a.channel; r[ix.product] = a.product; r[ix.n2] = a.n2; r[ix.valor] = a.valor;
    return r;
  });
  for (const row of cubo.rows.concat(filas)) {
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

// ── Actuals para el P&L Managerial ("Managerial vs Accounting") ─────────────────────────────────────────────────────────────
// Ese módulo lee actuals.json con los niveles N1 a N5 de Drive. La tabla trae la línea más fina (`linea_p&l` = N1), el nivel 2 y el
// nivel 3; N4 y N5 no existen en la tabla y se derivan del nivel 3 con la regla del Glosario (solapa "Linea P&L"):
//   Net Revenue + Cost of Revenue = Gross Profit;  Gross Profit + Sales & Marketing = Operating Contribution.
// El tablero solo mira `n1|…`, `n3|net revenue`, `n4|gross profit` y N5 = 'operating contribution', pero se arman todos para que sea el mismo formato.
const COLS_MGR = ['LoB', 'Canal', 'Pais', 'Producto', 'P&L N1', 'P&L N2', 'P&L N3', 'P&L N4', 'P&L N5', 'Fecha', 'Monto USD'];
// Líneas de la tabla que Drive llama distinto (el resto coincide en minúsculas).
const N1_LINEA = {
  'GB NAC': 'gross bookings domestic', 'GB INT': 'gross bookings international',
  'Orders NAC': 'orders domestic', 'Orders INT': 'orders international',
  'Customer claims': 'customer claims', 'Income Services': 'income from outsourced services',
  'Loyalty Personnel': 'loyalty - personnel/expenses', 'Sourcing Air': 'sourcing', 'Marketing Personnel': 'marketing-personnel/expenses',
  Channels: 'channels-personnel/expenses', 'IT Personnel': 'it - personnel/expenses', 'Other Tax': 'other taxes',
};
// Nivel 3 de la tabla → el de Drive. 'tecnhology' es la errata del Glosario de Drive: se copia para que ambos lados coincidan.
const N3 = {
  'Net Revenues': 'net revenue', 'Cost of Revenue': 'cost of revenue', 'Sales & Marketing': 'sales & marketing',
  'Technology and Content': 'tecnhology and content', 'General & Administrative': 'general and administrative',
  'Gross Bookings': 'gross bookings', Orders: 'orders', 'D&A': 'd&a', Equity: 'equity income / loss', OOI: 'other operating income',
  'Adjustments EBIT': 'adjustments ebit', 'Leases Adjustment': 'leases adjustment',
};
// Los ajustes propios traen solo el nivel 2: se les pone la línea y el nivel 3 que tendrían en la tabla.
// La línea sale del propio ajuste si la trae (GB NAC / GB INT / Orders NAC / Orders INT, como pnl-ajustes-actuals.json); si no, esta de acá.
const AJUSTE_LINEA = {
  'Gross Bookings': ['GB NAC', 'Gross Bookings'], Orders: ['Orders NAC', 'Orders'], 'O. Incentives': ['Other Incentives', 'Net Revenues'],
};

/** [n1..n5] de Drive (minúsculas) para una fila de la tabla. */
function nivelesMgr(linea, n2, n3) {
  const alianzas = linea === 'Alianzas Financieras';
  const n1 = alianzas ? 'alianzas financieras' : (N1_LINEA[linea] || String(linea).toLowerCase());
  const n2d = alianzas ? 'alianzas financieras' : (N2[n2] || String(n2).toLowerCase());
  // 'Other Tax' cuenta como Sales & Marketing en el Glosario (entra en la OC); en la tabla no se sabe en qué nivel 3 cae.
  const n3d = alianzas ? 'alianzas financieras' : (n2 === 'Other Tax' ? 'sales & marketing' : (N3[n3] || String(n3).toLowerCase()));
  const n4 = (n3d === 'net revenue' || n3d === 'cost of revenue') ? 'gross profit' : n3d;
  const n5 = (n4 === 'gross profit' || n3d === 'sales & marketing') ? 'operating contribution'
    : (n3d === 'tecnhology and content' || n3d === 'general and administrative') ? 'fixed cost' : n3d;
  return [n1, n2d, n3d, n4, n5];
}

/**
 * @param {{cols:string[], rows:any[][]}} cubo  salida de `consolidador_leer.py cubo_mgr` (solo ACT del FY27)
 * @param {{ultimoCerrado?:string, ajustes?:object|object[]}} opts
 * @returns {{canon:{meta:object, cols:string[], rows:any[][]}, sinMapear:object}}  `canon` es el actuals.json de Drive (ac) con N1 a N5
 */
function buildManagerialActuals(cubo, opts = {}) {
  const ultimoCerrado = opts.ultimoCerrado || '2026-10-01';
  const ix = Object.fromEntries(cubo.cols.map((c, i) => [c, i]));
  const sinMapear = { pais: new Set(), producto: new Set(), n2: new Set(), n3: new Set() };
  const filas = cubo.rows.map((r) => ({ year: r[ix.year], mes: r[ix.mes], pais: r[ix.pais], lob: r[ix.lob], channel: r[ix.channel], product: r[ix.product], linea: r[ix.linea], n2: r[ix.n2], n3: r[ix.n3], valor: r[ix.valor] }));
  for (const a of ajustesComoFilas(opts.ajustes, ultimoCerrado)) {
    if (a.scenario !== 'ACT' || a.year !== 'FY27') continue;
    const [lineaPorDefecto, n3] = AJUSTE_LINEA[a.n2] || [a.n2, ''];
    const linea = a.linea || lineaPorDefecto;
    filas.push({ year: a.year, mes: a.mes, pais: a.pais, lob: a.lob, channel: a.channel, product: a.product, linea, n2: a.n2, n3, valor: a.valor });
  }
  const m = new Map();
  for (const f of filas) {
    const fecha = fechaFiscal(f.year, f.mes);
    if (fecha > ultimoCerrado) continue;   // el resto del ACT es run rate, no actual cerrado
    const pais = PAIS[f.pais] || (sinMapear.pais.add(f.pais), String(f.pais).toLowerCase());
    const prod = PRODUCTO[f.product] || (sinMapear.producto.add(f.product), String(f.product).toLowerCase());
    if (f.linea !== 'Alianzas Financieras' && !N2[f.n2]) sinMapear.n2.add(f.n2);
    if (f.linea !== 'Alianzas Financieras' && f.n2 !== 'Other Tax' && !N3[f.n3]) sinMapear.n3.add(f.n3);
    const [n1, n2, n3, n4, n5] = nivelesMgr(f.linea, f.n2, f.n3);
    const key = [f.lob.toLowerCase(), canalDe(f.lob, f.channel), pais, prod, n1, n2, n3, n4, n5, fecha].join('\u0001');
    m.set(key, (m.get(key) || 0) + (Number(f.valor) || 0));
  }
  const rows = [];
  const fechas = new Set();
  for (const [key, v] of m) {
    if (!v) continue;
    const p = key.split('\u0001');
    rows.push([...p, v]);
    fechas.add(p[9]);
  }
  return {
    canon: { meta: { concepto: 'ac_mgr', fuente: 'compartido.app_b2b_ecosystem ACT FY27', fechas: [...fechas].sort(), filas: rows.length }, cols: COLS_MGR, rows },
    sinMapear: Object.fromEntries(Object.entries(sinMapear).map(([k, s]) => [k, [...s].sort()])),
  };
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
  const orders = {};
  const porLineaTot = {};
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
    porLineaTot[n2] = (porLineaTot[n2] || 0) + v;
    if (n2 === 'orders') orders[ym] = (orders[ym] || 0) + v;
    if (n2 === 'gross bookings') {
      gb[ym] = (gb[ym] || 0) + v;
      const p = String(r[i.Producto]).trim().toLowerCase();
      prodGb[p] = (prodGb[p] || 0) + v;
    }
  }
  return { fino, porMes, gb, prodGb, orders, porLineaTot, meses: Object.keys(porMes).sort(), extra };
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
    // Por línea (nivel 2): cuántas claves son iguales, distintas o de un solo lado, y cuánta plata mueve cada una.
    const porN2 = {};
    const n2De = (k) => k.split('|')[3];
    const fila = (n) => (porN2[n] = porN2[n] || { distintas: 0, soloDrive: 0, soloTabla: 0, difAbs: 0, difNeta: 0 });
    for (const d of distintas) {
      const x = fila(n2De(d.k));
      if (d.drive === null) x.soloTabla++; else if (d.tabla === null) x.soloDrive++; else x.distintas++;
      x.difAbs += Math.abs(d.dif); x.difNeta += d.dif;
    }
    const meses = Array.from(new Set([...D.meses, ...T.meses])).sort();
    out[sc] = {
      mesesDrive: D.meses, mesesTabla: T.meses,
      claves: { drive: D.fino.size, tabla: T.fino.size, iguales, distintas: distintas.length - soloDrive - soloTabla, soloDrive, soloTabla },
      grossBookingsPorMes: Object.fromEntries(meses.map((m) => [m, { drive: redondeo(D.gb[m] || 0), tabla: redondeo(T.gb[m] || 0) }])),
      grossBookingsPorProducto: Object.fromEntries(Array.from(new Set([...Object.keys(D.prodGb), ...Object.keys(T.prodGb)])).sort().map((p) => [p, { drive: redondeo(D.prodGb[p] || 0), tabla: redondeo(T.prodGb[p] || 0) }])),
      totalPorLinea: Object.fromEntries(Array.from(new Set([...Object.keys(D.porLineaTot), ...Object.keys(T.porLineaTot)])).sort()
        .map((n) => [n, { drive: redondeo(D.porLineaTot[n] || 0), tabla: redondeo(T.porLineaTot[n] || 0) }])),
      ordersPorMes: Object.fromEntries(meses.map((m) => [m, { drive: redondeo(D.orders[m] || 0), tabla: redondeo(T.orders[m] || 0) }])),
      porLinea: Object.fromEntries(Object.entries(porN2).sort((a, b) => b[1].difAbs - a[1].difAbs).slice(0, opts.topLineas || 12)
        .map(([n, x]) => [n, { ...x, difAbs: redondeo(x.difAbs), difNeta: redondeo(x.difNeta) }])),
      mayoresDiferencias: distintas.slice(0, top).map((d) => ({ clave: d.k, drive: d.drive === null ? null : redondeo(d.drive), tabla: d.tabla === null ? null : redondeo(d.tabla), dif: redondeo(d.dif) })),
    };
  }
  return out;
}

module.exports = { cargarAjustes, buildCanonicals, buildManagerialActuals, nivelesMgr, comparar, fechaFiscal, canalDe, mesSiguiente, PAIS, PRODUCTO, N2, COLS };
