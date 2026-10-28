// Solo Ownia: escenario "Forecast - Bridge to budget" (BTB) en el P&L Accounting (2026-10-26).
// Se carga en el proyecto del P&L Accounting (gasExtras en server/modules.js), DESPUÉS de su código,
// y lo extiende sin tocarlo (el equipo sigue publicando el módulo a Apps Script con /clasp-push):
//  - suma forecastbtb.json a los canónicos que ensambla assembleCanonicals_ (escenario 'fbtb');
//  - goal 'forecastbtb' (botón "vs Forecast BTB" de public/pnl-accounting-layout.js) = mismo cálculo
//    que el goal 'forecast', con el BTB en lugar del Forecast. Como el Forecast, forecastbtb.json ya
//    trae actuals en los meses de FORECAST_ACTUALS_MONTHS (lo arma Inputs_Planning_PnL/json_builder.py);
//  - organic: como el Forecast, baseline y goal a TC Budget (el BTB se convierte TC Forecast → TC Budget).
var FBTB_FILE_ID = '1anL-CsItySxuWTp4FuX69tHsAy9oz4rp';   // forecastbtb.json (carpeta de canónicos)

CANONICAL_IDS_.fbtb = FBTB_FILE_ID;
// El ensamblado cacheado sin 'fbtb' no sirve: prefijo propio para no reusarlo.
EPM_CACHE_PREFIX_ = 'epm_asm_v2_fbtb_';
ORGANIC_TARGETS_.forecastbtb = 'budget';
ORGANIC_FC_GOALS_.forecastbtb = 'fbtb';

// Los ~10 llamadores de computeGroupEPM_ arman opts = { goal, lrr, baseline, ly } a mano y no
// conocen 'fbtb': el BTB viaja colgado (no enumerable, invisible para los Object.keys del cálculo)
// del objeto lrr que sí pasan. fetchEPMScenarios_ devuelve objetos nuevos en cada llamada.
var _fbtbOrigFetch_ = fetchEPMScenarios_;
fetchEPMScenarios_ = function (jData, lgKey, baselineScen, prodArr) {
  var s = _fbtbOrigFetch_(jData, lgKey, baselineScen, prodArr);
  var sc = _ORG_GOAL_SCEN_.fbtb || 'fbtb';   // organic: BTB a TC Budget
  s.fbtb = (prodArr && prodArr.length)
    ? jsonScenarioToByPaisForProd_(jData, lgKey, sc, ALL_YM_BG, prodArr)
    : jsonScenarioToByPais_(jData, lgKey, sc, ALL_YM_BG);
  Object.defineProperty(s.lrr, '_fbtb_', { value: s.fbtb, enumerable: false, configurable: true });
  return s;
};

var _fbtbOrigCompute_ = computeGroupEPM_;
computeGroupEPM_ = function (ac, rr, bg, fc, cutoffIdx, paisGroup, opts) {
  if (!opts || opts.goal !== 'forecastbtb') return _fbtbOrigCompute_(ac, rr, bg, fc, cutoffIdx, paisGroup, opts);
  var o = {};
  Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
  o.goal = 'forecast';
  return _fbtbOrigCompute_(ac, rr, bg, (opts.lrr && opts.lrr._fbtb_) || {}, cutoffIdx, paisGroup, o);
};
