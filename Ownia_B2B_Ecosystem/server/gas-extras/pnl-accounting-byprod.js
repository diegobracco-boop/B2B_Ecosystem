// Solo Ownia: P&L Accounting con las columnas abiertas por país o por producto (2026-10-30, Diego). Lo usa el
// selector "Columnas: Período / País / Producto" de public/pnl-accounting-layout.js en las pestañas B2B y B2B2C
// (respeta el país y el canal elegidos) y, para producto, también en B2B + B2B2C. Se carga después del código del
// módulo y de pnl-accounting-fbtb.js (usa su fetchEPMScenarios_, que ya trae el Forecast BTB).
//
// Mismo cálculo que getEPMBaselineGoalData (baseline, goal, organic), una vez por país o producto, y devuelve solo
// las series mensuales: el navegador suma los meses del período elegido. La base contable solo viene abierta por
// producto para B2B (data_by_prod: b2b, b2b_may, b2b_min); por producto en B2B2C / consolidado devuelve available: false.
function getEPMBreakdown(filtersJson, dim) {
  var f = filtersJson || {};
  var jData = readEPMJSON_();
  var lgKey = lgKeyFromGroup_(f.lobGroup || null, f);
  var cutoffIdx = epmCutoffIdx_(jData);
  var goalSource = f.goalSource || 'budget';
  var baselineScen = epmOrganicSetup_(jData, f.organic, goalSource, f.baselineSource || 'bl').bl;
  var userPais = (f.pais && f.pais.length) ? f.pais : null;
  function slim(g) {
    return { baseline: { rr_monthly: g.baseline.rr_monthly, ct_monthly: g.baseline.ct_monthly },
             goal: { rr_monthly: g.goal.rr_monthly, ct_monthly: g.goal.ct_monthly } };
  }
  function group(s, pais) {
    return slim(computeGroupEPM_(s.ac, s.rr, s.bg, s.fc, cutoffIdx, pais, { goal: goalSource, lrr: s.lrr, baseline: s.bl, ly: s.ly }));
  }
  var out = [];
  if (dim === 'pais') {
    var s = fetchEPMScenarios_(jData, lgKey, baselineScen, null);
    var groups = Array.isArray(userPais)
      ? userPais.map(function (p) { return { label: p, pais: [p] }; })
      : PAIS_GROUPS_BG.filter(function (g) { return g.pais !== null; });
    groups.forEach(function (g) { out.push({ label: g.label, data: group(s, g.pais) }); });
    return { available: true, lgKey: lgKey, items: out };
  }
  var byProd = (jData.data_by_prod || {})[lgKey];
  if (!byProd) return { available: false, lgKey: lgKey };
  var prods = {};
  Object.keys(byProd).forEach(function (pais) {
    if (pais === 'all') return;
    Object.keys(byProd[pais] || {}).forEach(function (pr) { if (!/^\(sin produc?to\)$/.test(pr)) prods[pr] = true; });
  });
  Object.keys(prods).sort().forEach(function (pr) {
    out.push({ label: pr, data: group(fetchEPMScenarios_(jData, lgKey, baselineScen, [pr]), userPais) });
  });
  return { available: true, lgKey: lgKey, items: out };
}
