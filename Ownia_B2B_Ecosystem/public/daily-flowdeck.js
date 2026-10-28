/* Daily Dashboard en Ownia — modo "Flow semanal" para el módulo Flow (2026-10-27).
 * Lo inyecta server/index.js en el Daily (`layout` en server/modules.js). El HTML de Apps Script no se toca.
 *
 *   <base>/daily?flowdeck=1
 *   → abre directo el Flow (todas las slides, con su barra de mes / comparación / Organic / COI) sin la navegación del Daily, y avisa al
 *     padre (postMessage {type:'flow-slide', section:'semanal', idx, total, title}) en qué slide está, para ligar los comentarios.
 *     Lo embebe public de Flow_B2B/flow.html.
 *
 * Fuera de ese modo, la pestaña "Flow Semanal" del Daily se oculta: el Flow tiene su propia entrada en el menú principal (módulo Flow).
 * Sigue accesible con <base>/daily?flowdeck=1.
 */
(function () {
  'use strict';
  var on = /[?&]flowdeck=1\b/.test(location.search);
  var css = document.createElement('style');
  css.textContent = on
    ? '.view-nav,#daily-lob-toggle,#btn-toqan-bicia,#btn-toqan-bee,#btn-email,.ownia-home-top{display:none!important}'
    : '#vnav-flow{display:none!important}';
  (document.head || document.documentElement).appendChild(css);
  if (!on) return;

  function post() {
    if (window.parent === window) return;
    var i = window._flowCurrentIdx || 0, deck = window.FLOW_DECK || [], d = deck[i] || {};
    try {
      window.parent.postMessage({ type: 'flow-slide', section: 'semanal', idx: i, total: deck.length,
        title: String(d.name || ('Slide ' + (i + 1))).replace(/^—\s*|\s*—$/g, '') }, location.origin);
    } catch (e) { /* sin padre */ }
  }
  function waitFor(cond, then, n) {
    if (cond()) return then();
    if ((n || 0) > 600) return;   // ~5 min
    setTimeout(function () { waitFor(cond, then, (n || 0) + 1); }, 500);
  }

  document.addEventListener('DOMContentLoaded', function () {
    waitFor(function () { return window._rawB2BC && window._rawB2BC.meta && typeof window.switchMainView === 'function'; }, function () {
      window.switchMainView('flow');
      var orig = window.flowUpdateCounter_;
      if (typeof orig === 'function') window.flowUpdateCounter_ = function () { var r = orig.apply(this, arguments); post(); return r; };
      var t = document.getElementById('topbar-title');
      if (t) t.textContent = 'Flow Semanal · gestional';
      waitFor(function () { return document.querySelector('#flow-track .flow-frame'); }, function () { setTimeout(post, 800); });
    });
  });
})();
