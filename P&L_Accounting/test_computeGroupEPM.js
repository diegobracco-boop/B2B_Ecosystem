// test_computeGroupEPM.js — tests de computeGroupEPM_/scenCT (P&L Accounting, vista EPM).
//
// Node puro, sin dependencias (no hay infra de test en el repo). Corre:
//   node test_computeGroupEPM.js
// Exit code 0 = todo OK, 1 = algún test falló (usable como gate en un futuro CI).
//
// Por qué existe: "vs Last Year" se publicó el 28-ago con un bug real (nunca
// re-alineaba los meses de LY contra los de la FY actual -> mostraba SIEMPRE
// CERO en producción, 5 días, nadie lo notó). Este archivo prueba justo eso:
// si alguien vuelve a romper el remap, este test lo dice en segundos en vez
// de que se descubra días después mirando el dashboard.
//
// Carga Codigo_contable.js + Codigo_contable_epm.js tal cual (sin tocar los
// archivos fuente) en un sandbox de Node: ninguno de los dos ejecuta llamadas
// a DriveApp/PropertiesService/etc. al cargar (solo dentro de funciones), así
// que se pueden evaluar directo y probar la lógica pura de cómputo.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DIR = __dirname;
const src1 = fs.readFileSync(path.join(DIR, 'Codigo_contable.js'), 'utf8');
const src2 = fs.readFileSync(path.join(DIR, 'Codigo_contable_epm.js'), 'utf8');

// Cualquier global de GAS que se llegue a invocar (no debería, a nivel módulo)
// tira un error claro en vez de un TypeError críptico.
function gasStub(name) {
  return new Proxy({}, { get() { throw new Error(`GAS global '${name}' invocado al cargar el modulo (no deberia)`); } });
}
const sandbox = {
  DriveApp: gasStub('DriveApp'), PropertiesService: gasStub('PropertiesService'),
  CacheService: gasStub('CacheService'), Utilities: gasStub('Utilities'),
  SpreadsheetApp: gasStub('SpreadsheetApp'), console,
  Logger: { log: () => {} },
};
const ns = {};
// fetchEPMScenarios_ es el helper de consolidación (agregado más adelante) — se expone
// solo si existe, así este archivo no se rompe mientras el helper todavía no está.
const loader = new Function(
  ...Object.keys(sandbox),
  src1 + '\n' + src2 + `
    return {
      computeGroupEPM_, ALL_MONTHS_ORD_BG, ALL_MONTHS_ORD_LY_BG, ALL_YM_BG, ALL_YM_LY_BG,
      aggregatePaisByGroup_,
      fetchEPMScenarios_: (typeof fetchEPMScenarios_ !== 'undefined') ? fetchEPMScenarios_ : null
    };`
);
Object.assign(ns, loader(...Object.values(sandbox)));

// ── Helpers de test ──────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  OK  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function mkByPais(valFn) {
  return { Brasil: { 'gross bookings': Object.fromEntries(ns.ALL_MONTHS_ORD_BG.map((m, i) => [m, valFn(i)])) } };
}
function mkLYByPais(valFn) {
  return { Brasil: { 'gross bookings': Object.fromEntries(ns.ALL_MONTHS_ORD_LY_BG.map((m, i) => [m, valFn(i)])) } };
}
const actuals  = mkByPais(i => 100 + i);
const rr       = mkByPais(i => 200 + i);
const budget   = mkByPais(i => 300 + i);
const forecast = mkByPais(i => 400 + i);
const ly       = mkLYByPais(i => 900 + i);   // valores 900..911, mismo indice fiscal que actuals/rr/bg/fc

console.log('=== computeGroupEPM_ / scenCT ===\n');

test('lastyear: re-alinea los 12 meses de LY (FY26) a las etiquetas de la FY actual', () => {
  const G = ns.computeGroupEPM_(actuals, rr, budget, forecast, -1, null, { goal: 'lastyear', ly });
  const got = G.goal.ct_monthly['gross bookings'];
  ns.ALL_MONTHS_ORD_BG.forEach((m, i) => {
    assert.strictEqual(got[m], 900 + i, `mes ${m} (idx ${i}): esperaba ${900 + i}, salio ${got[m]}`);
  });
});

test('lastyear: sin "ly" en opts no explota (devuelve 0, no undefined/crash)', () => {
  const G = ns.computeGroupEPM_(actuals, rr, budget, forecast, -1, null, { goal: 'lastyear' });
  const got = G.goal.ct_monthly['gross bookings'] || {};
  ns.ALL_MONTHS_ORD_BG.forEach(m => assert.ok(!got[m] || got[m] === 0, `mes ${m} deberia ser 0/undefined`));
});

test('budget: todo el FY viene de budget (sin blend con actuals)', () => {
  const G = ns.computeGroupEPM_(actuals, rr, budget, forecast, 5, null, { goal: 'budget' });
  const got = G.goal.ct_monthly['gross bookings'];
  ns.ALL_MONTHS_ORD_BG.forEach((m, i) => assert.strictEqual(got[m], 300 + i));
});

test('forecast: todo el FY viene de forecast (sin blend con actuals)', () => {
  const G = ns.computeGroupEPM_(actuals, rr, budget, forecast, 5, null, { goal: 'forecast' });
  const got = G.goal.ct_monthly['gross bookings'];
  ns.ALL_MONTHS_ORD_BG.forEach((m, i) => assert.strictEqual(got[m], 400 + i));
});

test('runrate: todo el FY viene de run rate continuo (sin blend con actuals)', () => {
  const G = ns.computeGroupEPM_(actuals, rr, budget, forecast, 5, null, { goal: 'runrate' });
  const got = G.goal.ct_monthly['gross bookings'];
  ns.ALL_MONTHS_ORD_BG.forEach((m, i) => assert.strictEqual(got[m], 200 + i));
});

test('lastrunrate: meses cerrados (<=cutoff) toman actuals, el rango con lrr toma lrr, y despues del ultimo mes con lrr cae a forecast', () => {
  // _epmScenMaxIdx_ mira que MESES tienen clave en el objeto (no el valor) para saber
  // hasta donde llega el run rate real -> el mock tiene que ser sparse y CONTIGUO,
  // igual que el agregado real (lastrunrate.json cubre un rango de meses seguidos;
  // un mes sin dato no aparece como clave). idx 3 y 4 tienen lrr; idx 5+ no tiene
  // clave -> cae a forecast (aunque haya "hueco" en el medio de idx<=lrrMaxIdx sin
  // dato, ese mes puntual queda en 0, no en forecast — comportamiento real, no se
  // testea acá porque lastrunrate.json siempre viene contiguo en la práctica).
  const lrrVals = { 3: 500, 4: 501 };
  const lrr = { Brasil: { 'gross bookings': Object.fromEntries(
    Object.entries(lrrVals).map(([i, v]) => [ns.ALL_MONTHS_ORD_BG[i], v])
  ) } };
  const cutoffIdx = 2;  // meses 0,1,2 = cerrados -> actuals
  const G = ns.computeGroupEPM_(actuals, rr, budget, forecast, cutoffIdx, null, { goal: 'lastrunrate', lrr });
  const got = G.goal.ct_monthly['gross bookings'];
  ns.ALL_MONTHS_ORD_BG.forEach((m, i) => {
    let esperado;
    if (i <= cutoffIdx) esperado = 100 + i;                       // actuals
    else if (i === 3 || i === 4) esperado = lrrVals[i];           // lrr disponible
    else esperado = 400 + i;                                      // fallback forecast (idx > lrrMaxIdx)
    assert.strictEqual(got[m], esperado, `mes ${m} (idx ${i})`);
  });
});

test('baseline: si no viene opts.baseline, cae a scenCT("forecast")', () => {
  const G = ns.computeGroupEPM_(actuals, rr, budget, forecast, 5, null, { goal: 'budget' });
  const got = G.baseline.ct_monthly['gross bookings'];
  ns.ALL_MONTHS_ORD_BG.forEach((m, i) => assert.strictEqual(got[m], 400 + i));
});

test('paisGroup: agrega solo el/los pais(es) pedidos, no todos', () => {
  const m0 = ns.ALL_MONTHS_ORD_BG[0];
  const dosPaises = {
    Brasil:    { 'gross bookings': { [m0]: 10 } },
    Argentina: { 'gross bookings': { [m0]: 1000 } },
  };
  const vacio = {};
  const Gbrasil = ns.computeGroupEPM_(vacio, dosPaises, vacio, vacio, -1, ['Brasil'], { goal: 'runrate' });
  const Gtodos  = ns.computeGroupEPM_(vacio, dosPaises, vacio, vacio, -1, null,       { goal: 'runrate' });
  assert.strictEqual(Gbrasil.goal.ct_monthly['gross bookings'][m0], 10, 'filtrado a Brasil deberia dar solo 10');
  assert.strictEqual(Gtodos.goal.ct_monthly['gross bookings'][m0], 1010, 'sin filtro deberia sumar los 2 paises');
});

// ── fetchEPMScenarios_ (helper que reemplaza los ~8 bloques hasProd copiados) ──
if (!ns.fetchEPMScenarios_) {
  console.log('\n(fetchEPMScenarios_ no existe todavia en este archivo — se salta esa seccion)');
} else {
  console.log();
  var ymBG0 = Object.keys(ns.ALL_YM_BG)[0], lblBG0 = ns.ALL_YM_BG[ymBG0];
  var ymLY0 = Object.keys(ns.ALL_YM_LY_BG)[0], lblLY0 = ns.ALL_YM_LY_BG[ymLY0];

  test('fetchEPMScenarios_: trae los 6 escenarios + el baseline elegido, sin filtro de producto', () => {
    var jData = { data: { b2b: { Brasil: {
      ac:  { 'gross bookings': { [ymBG0]: 1 } },
      rr:  { 'gross bookings': { [ymBG0]: 2 } },
      bg:  { 'gross bookings': { [ymBG0]: 3 } },
      fc:  { 'gross bookings': { [ymBG0]: 4 } },
      lrr: { 'gross bookings': { [ymBG0]: 5 } },
      ly:  { 'gross bookings': { [ymLY0]: 6 } },
      vr:  { 'gross bookings': { [ymBG0]: 7 } },
    } } } };
    const s = ns.fetchEPMScenarios_(jData, 'b2b', 'vr', null);
    assert.strictEqual(s.ac['Brasil']['gross bookings'][lblBG0], 1);
    assert.strictEqual(s.rr['Brasil']['gross bookings'][lblBG0], 2);
    assert.strictEqual(s.bg['Brasil']['gross bookings'][lblBG0], 3);
    assert.strictEqual(s.fc['Brasil']['gross bookings'][lblBG0], 4);
    assert.strictEqual(s.lrr['Brasil']['gross bookings'][lblBG0], 5);
    assert.strictEqual(s.ly['Brasil']['gross bookings'][lblLY0], 6);
    assert.strictEqual(s.bl['Brasil']['gross bookings'][lblBG0], 7, 'baselineScen="vr" deberia traer vr, no bl');
  });

  test('fetchEPMScenarios_: con prodArr, usa data_by_prod y filtra por producto', () => {
    var jData = { data_by_prod: { b2b: { Brasil: {
      hotels:  { ac: { 'gross bookings': { [ymBG0]: 100 } } },
      flights: { ac: { 'gross bookings': { [ymBG0]: 999 } } },
    } } } };
    const s = ns.fetchEPMScenarios_(jData, 'b2b', 'bl', ['hotels']);
    assert.strictEqual(s.ac['Brasil']['gross bookings'][lblBG0], 100, 'deberia traer solo hotels, no flights');
  });
}

console.log(`\n${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
