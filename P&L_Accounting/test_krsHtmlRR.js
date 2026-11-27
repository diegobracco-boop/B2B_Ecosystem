// test_krsHtmlRR.js — tests de computeKRsHtmlRR_ (P&L Accounting, vista "KRs HTML · RR", Codigo_krs_rr.js).
//
// Node puro, sin dependencias. Corre:
//   node test_krsHtmlRR.js
// Exit code 0 = todo OK, 1 = algún test falló.
//
// Además del cálculo, controla que las COPIAS de la lógica de KRs del Daily B2B Tracker sigan iguales a las
// originales (Daily_Dashboard/tracker.html, Daily_Dashboard/Codigo.js, Daily_Dashboard/pkg_split_factors.py):
// si alguien cambia una definición de un lado y no del otro, este test lo dice.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DIR = __dirname;
const SRC = fs.readFileSync(path.join(DIR, 'Codigo_krs_rr.js'), 'utf8');
const TRACKER = fs.readFileSync(path.join(DIR, '..', 'Daily_Dashboard', 'tracker.html'), 'utf8');
const DAILY_GS = fs.readFileSync(path.join(DIR, '..', 'Daily_Dashboard', 'Codigo.js'), 'utf8');
const PKG_PY = fs.readFileSync(path.join(DIR, '..', 'Daily_Dashboard', 'pkg_split_factors.py'), 'utf8');

function gasStub(name) {
  return new Proxy({}, { get() { throw new Error(`GAS global '${name}' invocado al cargar el modulo (no deberia)`); } });
}
const sandbox = {
  DriveApp: gasStub('DriveApp'), SpreadsheetApp: gasStub('SpreadsheetApp'), CacheService: gasStub('CacheService'),
  Utilities: { formatDate: (d) => d.toISOString().substring(0, 7) }, console,
};
const ns = new Function(...Object.keys(sandbox), SRC + `
  return { computeKRsHtmlRR_, krsRRSplitPkg_, krsRRParseTargets_, okrScore_, realScore_, cumplRatio, recurH2_, recurCumpl_,
           isNewProductBudget_, isNewProductActual_, KRS_RR_DETAIL, KRS_RR_PKG_SPLIT, KRS_RR_NOGEST_PESOS,
           B2B_H2_NR_PRODS_TRK, B2B_H2_NP_PKG_TYPES };`)(...Object.values(sandbox));

let fails = 0, passes = 0;
function test(name, fn) {
  try { fn(); passes++; console.log('  ok   ' + name); }
  catch (e) { fails++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ` esperado ${b}, vino ${a}`);

// ── Extracción de código del Tracker (función por nombre, con llaves balanceadas) ──
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'no está ' + name + ' en el original');
  let j = src.indexOf('{', i), depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.substring(i, k + 1);
  }
  throw new Error('llaves sin cerrar en ' + name);
}
function extractVar(src, name) {
  const m = new RegExp('var\\s+' + name + '\\s*=\\s*').exec(src);
  assert.ok(m, 'no está var ' + name + ' en el original');
  let i = m.index + m[0].length, open = src[i], close = open === '{' ? '}' : ']', depth = 0;
  for (let k = i; k < src.length; k++) {
    if (src[k] === open) depth++;
    else if (src[k] === close && --depth === 0) return new Function('return ' + src.substring(i, k + 1))();
  }
  throw new Error('sin cerrar: ' + name);
}
const trk = new Function(['okrScore_', 'realScore_', 'cumplRatio', 'isNewProductPkgType_', 'isNewProductActual_', 'isNewProductBudget_', 'normPais_']
  .map((n) => extractFn(TRACKER, n)).join('\n') +
  '\nvar B2B_H2_NR_PRODS_TRK = ' + JSON.stringify(extractVar(TRACKER, 'B2B_H2_NR_PRODS_TRK')) +
  ';\nvar B2B_H2_NP_PKG_TYPES = ' + JSON.stringify(extractVar(TRACKER, 'B2B_H2_NP_PKG_TYPES')) +
  ';\nreturn { okrScore_, realScore_, cumplRatio, isNewProductActual_, isNewProductBudget_ };')();

console.log('Sincronía con el Tracker / Daily');
test('B2B_H2_NR_PRODS_TRK y B2B_H2_NP_PKG_TYPES iguales al Tracker', () => {
  assert.deepStrictEqual({ ...ns.B2B_H2_NR_PRODS_TRK }, extractVar(TRACKER, 'B2B_H2_NR_PRODS_TRK'));
  assert.deepStrictEqual({ ...ns.B2B_H2_NP_PKG_TYPES }, extractVar(TRACKER, 'B2B_H2_NP_PKG_TYPES'));
});
test('grupos de país = FVM_DETAIL del Tracker', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ns.KRS_RR_DETAIL)), extractVar(TRACKER, 'FVM_DETAIL'));
});
test('okrScore_ / realScore_ / cumplRatio dan lo mismo que en el Tracker', () => {
  const cases = [[0, 100], [69, 100], [70, 100], [95, 100], [150, 100], [-5, -10], [5, -10], [10, 0], [null, 10], [10, null]];
  cases.forEach(([a, b]) => {
    assert.strictEqual(ns.okrScore_(a, b), trk.okrScore_(a, b), `okrScore_(${a},${b})`);
    assert.strictEqual(ns.realScore_(a, b), trk.realScore_(a, b), `realScore_(${a},${b})`);
    assert.strictEqual(ns.cumplRatio(a, b), trk.cumplRatio(a, b), `cumplRatio(${a},${b})`);
  });
});
test('New Products (actual y budget) da lo mismo que en el Tracker', () => {
  const prods = ['Flights', 'Air', 'Dest. Serv.', 'D. Services', 'Hotels', 'Packages General', 'Cars'];
  const pts = ['', 'Vuelos', 'Disney', 'Espectáculos', 'Espect?culos', 'Otros paquetes', 'Traslados', 'Hoteles'];
  prods.forEach((p) => pts.forEach((t) => {
    assert.strictEqual(ns.isNewProductBudget_({ producto: p, product_type: t }), trk.isNewProductBudget_({ producto: p, product_type: t }), p + '/' + t);
    assert.strictEqual(ns.isNewProductActual_({ producto_original: p, product_type: t }), trk.isNewProductActual_({ producto_original: p, product_type: t }), p + '/' + t);
  }));
});
// Compara código sin comentarios de línea ni diferencias de espacios
const norm = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
test('recurH2_ / recurTarget_ / recurCumpl_ con el mismo cuerpo que el Tracker (salvo la fuente de filas / targets)', () => {
  // recurCumpl_ es idéntica; recurH2_ y recurTarget_ reciben las filas / targets por parámetro en vez de leer globales
  assert.strictEqual(norm(extractFn(SRC, 'recurCumpl_')), norm(extractFn(TRACKER, 'recurCumpl_')));
  assert.strictEqual(norm(extractFn(SRC, 'recurWeekLbl_')), norm(extractFn(TRACKER, 'recurWeekLbl_')));
  const body = (s) => norm(s.substring(s.indexOf('var cierre')));
  assert.strictEqual(body(extractFn(SRC, 'recurH2_')), body(extractFn(TRACKER, 'recurH2_')));
  const tb = (s) => norm(s.substring(s.indexOf('if (!rp)')));
  assert.strictEqual(tb(extractFn(SRC, 'recurTarget_')), tb(extractFn(TRACKER, 'recurTarget_')));
});
test('RECUR_NOGEST_PESOS y la lectura de Input_OKR iguales a Daily_Dashboard/Codigo.js', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ns.KRS_RR_NOGEST_PESOS)), extractVar(DAILY_GS, 'RECUR_NOGEST_PESOS'));
  const loop = (s) => norm(s.substring(s.indexOf("vals.slice(1)"), s.indexOf('Object.keys(out)')));
  assert.strictEqual(loop(extractFn(SRC, 'krsRRParseTargets_')).replace(/p instanceof Date \|\| \(p && typeof p\.getTime === 'function'\)/, 'p instanceof Date'),
                     loop(extractFn(DAILY_GS, 'getRecurTargets')));
});
test('proporciones de Packages General = pkg_split_factors.py', () => {
  const m = /PKG_SPLIT_FACTORS\s*=\s*\{/.exec(PKG_PY);
  let i = m.index + m[0].length - 1, depth = 0, end = -1;
  for (let k = i; k < PKG_PY.length; k++) { if (PKG_PY[k] === '{') depth++; else if (PKG_PY[k] === '}' && --depth === 0) { end = k; break; } }
  const py = new Function('return ' + PKG_PY.substring(i, end + 1))();   // dict de Python con comillas simples = objeto JS
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ns.KRS_RR_PKG_SPLIT)), py);
});

// ── Cálculo ──
const H = 'Agencias afiliadas';
function rr(pais, producto, nr, fvm, extra) { return Object.assign({ fecha: '2026-11-01', pais, parent_channel: H, producto, gross_bookings: 0, net_revenue: nr, fvm }, extra || {}); }
function bud(pais, producto, nr, fvm, extra) { return Object.assign({ fecha: '2026-11-01', pais, parent_channel: H, producto, product_type: '', net_revenue: nr, fvm }, extra || {}); }
function ly(pais, producto, nr, fvm, extra) { return Object.assign({ fecha: '2025-11-10', pais, parent_channel: H, producto_original: producto, product_type: '', net_revenue: nr, fvm }, extra || {}); }
const base = () => ({
  ym: '2026-11', lyTo: '2025-11-30',
  rr: [rr('Brasil', 'Hotels', 600, 200), rr('Mexico', 'Flights', 300, 100), rr('Brasil', 'Packages General', 1000, 100),
       rr('Brasil', 'Hotels', 999, 999, { parent_channel: 'API' }), rr('Brasil', 'Hotels', 777, 777, { fecha: '2026-12-01' })],
  bud: [bud('Brasil', 'Hotels', 500, 150), bud('Mexico', 'Flights', 400, 100), bud('Brasil', 'Packages General', 800, 50, { product_type: 'Vuelos' }),
        bud('Brasil', 'Packages General', 200, 50, { product_type: 'Otros paquetes' })],
  ly: [ly('Brasil', 'Hotels', 400, 100), ly('Mexico', 'Flights', 200, 80), ly('Brasil', 'Packages General', 500, 50, { product_type: 'Vuelos' })],
  recurState: 'error', targetsState: 'error',
});

console.log('Cálculo');
test('NR y FVM HTML del mes: solo HTML y solo el mes; Cumpl. = realScore_', () => {
  const r = ns.computeKRsHtmlRR_(base());
  const nr = r.krs.find((k) => k.k === 'nr'), fvm = r.krs.find((k) => k.k === 'fvm');
  near(nr.rr, 1900); near(nr.bud, 1900); near(nr.cumpl, 1);
  near(fvm.rr, 400); near(fvm.bud, 350); near(fvm.cumpl, 400 / 350);
  near(fvm.score, 400 / 350);
});
test('Packages General del RR se abre con las proporciones fijas (los totales no cambian)', () => {
  const rows = ns.krsRRSplitPkg_([rr('Brasil', 'Packages General', 1000, 100), rr('Uruguay', 'Packages General', 10, 1)]);
  near(rows.filter((x) => x.pais === 'Brasil').reduce((s, x) => s + x.net_revenue, 0), 1000);
  near(rows.find((x) => x.pais === 'Brasil' && x.product_type === 'Vuelos').net_revenue, 544.74);
  near(rows.find((x) => x.pais === 'Uruguay' && x.product_type === 'Vuelos').net_revenue, 4.53732);   // país sin muestra → TOTAL
  assert.ok(!rows.some((x) => x.product_type === 'SeaWorld' && x.pais === 'Argentina'));
});
test('New Products: Flights + Dest. Serv. + componentes Vuelos / Dest. Serv. de los paquetes', () => {
  const r = ns.computeKRsHtmlRR_(base());
  const np = r.krs.find((k) => k.k === 'np');
  const npShare = 1 - ns.KRS_RR_PKG_SPLIT.Brasil['Otros paquetes'];
  near(np.rr, 300 + 1000 * npShare);
  near(np.bud, 400 + 800);
});
test('Recuadros: Peso = país / total del RR; TOTAL con techo 130%; YoY vs LY y YoY Bud.', () => {
  const r = ns.computeKRsHtmlRR_(base());
  const box = r.boxes.find((b) => b.k === 'nr');
  const br = box.rows.find((x) => x.name === 'Brasil'), mx = box.rows.find((x) => x.name === 'Mexico');
  near(br.peso, 1600 / 1900); near(mx.peso, 300 / 1900);
  near(br.c, ns.cumplRatio(1600, 1500)); near(mx.c, 0.75);
  near(br.yoy, 1600 / 900 - 1); near(br.yb, 1500 / 900 - 1);
  near(box.total.rr, 1900); near(box.total.c, 1); near(box.total.yoy, 1900 / 1100 - 1);
  assert.strictEqual(box.rows.find((x) => x.name === 'Chile').c, null);   // sin budget → —
  const f = ns.computeKRsHtmlRR_(Object.assign(base(), { bud: [bud('Brasil', 'Hotels', 10, 1)] })).boxes[0];
  near(f.total.c, 1.30);   // TOTAL con techo
  assert.ok(f.rows.find((x) => x.name === 'Brasil').c > 1.30);   // las filas, sin techo (cumplRatio)
});
test('Peso en "—" si hay negativos que pesan más del 10% de lo positivo', () => {
  const inp = base();
  inp.rr = [rr('Brasil', 'Hotels', 100, 100), rr('Mexico', 'Hotels', -20, -20)];
  const b = ns.computeKRsHtmlRR_(inp).boxes.find((x) => x.k === 'nr');
  assert.strictEqual(b.pesoOk, false);
  assert.strictEqual(b.rows[0].peso, null);
});
test('Organic: RR × TC Actuals / TC Budget; YoY con el RR a TC Actuals LY; budget y LY nominales', () => {
  const inp = base();
  inp.convB = (p) => (p === 'Brasil' ? 2 : 1);
  inp.convY = (p) => (p === 'Brasil' ? 3 : 1);
  const r = ns.computeKRsHtmlRR_(inp);
  near(r.krs[0].rr, 1600 * 2 + 300); near(r.krs[0].bud, 1900);
  const br = r.boxes[0].rows.find((x) => x.name === 'Brasil');
  near(br.yoy, 1600 * 3 / 900 - 1); near(br.yb, 1500 / 900 - 1);
});
test('Sin LY del mes completo (ly_to antes de fin de mes) → YoY en —', () => {
  const r = ns.computeKRsHtmlRR_(Object.assign(base(), { lyTo: '2025-11-20' }));
  assert.strictEqual(r.lyAvailable, false);
  assert.ok(r.boxes.every((b) => b.total.yoy === null && b.rows.every((x) => x.yoy === null && x.yb === null)));
  const d = ns.computeKRsHtmlRR_(Object.assign(base(), { ym: '2026-12' }));   // diciembre: el LY no trae 2025-12
  assert.strictEqual(d.lyAvailable, false);
  near(d.krs[0].rr, 777);
});
test('Accelerate Recurrence: semana cerrada + parcial; mes abierto → Rolling L4W vs Target; OVERALL normalizado', () => {
  const cols = ['mes_comercial', 'semana_desde', 'semana_hasta', 'fecha_foto', 'estado', 'pais', 'semana_del_mes', 'semanas_del_mes', 'es_cierre_mes', 'mtd_frecuentes_vivas', 'roll_frecuentes_vivas'];
  const rows = [
    ['2026-11', '2026-11-09', '2026-11-15', '2026-11-16', 'CIERRE', 'Brasil', 2, 4, 0, 0, 900],
    ['2026-11', '2026-11-16', '2026-11-22', '2026-11-23', 'CIERRE', 'Brasil', 3, 4, 0, 500, 1000],
    ['2026-11', '2026-11-16', '2026-11-22', '2026-11-23', 'CIERRE', 'Mexico', 3, 4, 0, 100, 200],
    ['2026-11', '2026-11-23', '2026-11-29', '2026-11-27', 'EN_CURSO', 'Brasil', 4, 4, 1, 1600, 1600],
  ].map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  const inp = Object.assign(base(), { recurRows: rows, recurState: 'ok', targetsState: 'ok',
    targets: { '2026-11': { Total: 1500, Brasil: 1300, Mexico: 200 } } });
  const r = ns.computeKRsHtmlRR_(inp);
  assert.strictEqual(r.recur.cierreMes, false);
  near(r.recur.total.roll, 1200); near(r.recur.total.mtd, 600); near(r.recur.parcial.total, 1600);
  assert.strictEqual(r.recur.cumpl.useRoll, true); near(r.recur.cumpl.shown, 0.8); near(r.recur.cumpl.score, 0.8);
  near(r.recur.rows.find((x) => x.name === 'Brasil').c, 1000 / 1300);
  assert.ok(/^Semana 3\/4 \(16\/11–22\/11\)$/.test(r.recur.week), r.recur.week);
  const exp = (1 * 0.30 + (400 / 350) * 0.20 + ns.okrScore_(r.krs[2].rr, r.krs[2].bud) * 0.15 + 0.8 * 0.15) / 0.80;
  near(r.overall.value, Math.min(exp, 1.3)); near(r.overall.pesoSum, 0.80); assert.strictEqual(r.overall.exclRecur, false);
  const sinRec = ns.computeKRsHtmlRR_(base());
  near(sinRec.overall.pesoSum, 0.65); assert.strictEqual(sinRec.overall.exclRecur, true);
});
test('Input_OKR: No Gestionadas se reparte entre países (suma exacta) y la fila Total queda', () => {
  const vals = [['Periodo', 'Escenario', 'LoB', 'Pais', 'Producto', 'KR', 'Valor'],
    ['1/11/2026', 'Budget', 'B2B', 'Total', 'Total', 'Accelerate Recurrence', 5000],
    ['1/11/2026', 'Budget', 'B2B', 'Brasil', 'Total', 'Accelerate Recurrence', 3000],
    ['1/11/2026', 'Budget', 'B2B', 'No Gestionadas', 'Total', 'Accelerate Recurrence', 401],
    ['1/11/2026', 'Budget', 'B2B', 'Brasil', 'Total', 'Net Revenues', 99]];
  const t = ns.krsRRParseTargets_(vals)['2026-11'];
  assert.strictEqual(t.Total, 5000);
  assert.strictEqual(Object.keys(t).filter((k) => k !== 'Total').reduce((s, k) => s + t[k], 0), 3401);
  assert.ok(!('No Gestionadas' in t));
});

console.log(`\n${passes} ok, ${fails} fallaron`);
process.exit(fails ? 1 : 0);
