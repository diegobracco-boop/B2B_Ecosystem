/* Layout del P&L Accounting en Ownia. Lo inyecta server/index.js solo en ese módulo (`layout` en
 * server/modules.js). El HTML de Apps Script no se toca: el equipo sigue publicando el módulo con
 * /clasp-push, y lo que vive acá no viaja a GAS.
 *
 * Escenario "Forecast - Bridge to budget" (2026-10-26): botón "vs Forecast BTB" en el selector de
 * comparación de la vista EPM, al lado de "vs Last RR". El cálculo lo hace el servidor con el goal
 * 'forecastbtb' (server/gas-extras/pnl-accounting-fbtb.js).
 */
(function () {
  'use strict';

  var GOAL = 'forecastbtb';
  var LABEL = 'Forecast - Bridge to budget';

  document.addEventListener('DOMContentLoaded', function () {
    var after = document.getElementById('btn-egoal-lastrunrate');
    if (!after || typeof window.setEpmGoalSource !== 'function' || typeof window._epmGoalLabel !== 'function') {
      console.warn('[pnl-accounting-layout] no se encontró el selector de comparación: sin Forecast BTB');
      return;
    }
    var btn = document.createElement('button');
    btn.id = 'btn-egoal-' + GOAL;
    btn.className = 'prd-btn';
    btn.type = 'button';
    btn.textContent = 'vs Forecast BTB';
    btn.title = LABEL;
    btn.addEventListener('click', function () { window.setEpmGoalSource(GOAL); });
    after.parentNode.insertBefore(btn, after.nextSibling);

    var origSet = window.setEpmGoalSource;
    window.setEpmGoalSource = function (src) {
      btn.classList.toggle('prd-active', src === GOAL);
      return origSet.apply(this, arguments);
    };
    var origLabel = window._epmGoalLabel;
    window._epmGoalLabel = function () {
      return window._epmGoalSource === GOAL ? LABEL : origLabel.apply(this, arguments);
    };
    // Organic: el BTB usa el TC Forecast (ORGANIC_TARGETS_ del servidor).
    if (window.ORG_GOALS_) window.ORG_GOALS_[GOAL] = 'Forecast';
  });
})();
