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
  // "Enviar a Google Slides" (Flow y Tracker) no va en Ownia (2026-10-28): se reemplaza por "Descargar PPTX" del módulo Flow. En Apps Script sigue igual.
  var NO_GSLIDES = '#flow-export-btn,#slidesExportLink,button[onclick*="exportSlidesToGoogle"]{display:none!important}';
  css.textContent = NO_GSLIDES + (on
    ? '.view-nav,#daily-lob-toggle,#btn-toqan-bicia,#btn-toqan-bee,#btn-email,.ownia-home-top{display:none!important}'
    : '#vnav-flow{display:none!important}');
  (document.head || document.documentElement).appendChild(css);
  if (!on) return;

  // Captura de todas las slides para el PPTX del módulo Flow (lo llama flow.html, mismo origen): misma técnica que "Enviar a Google Slides"
  // (html2canvas de cada .flow-slide a 1280x720, abriendo hasta nivel país sin estirar el alto) pero devuelve las imágenes en vez de subirlas.
  window.__flowExport = function () {
    if (!window._flowBuilt || typeof window._flowCaptureSlideImages_ !== 'function' || typeof window.html2canvas !== 'function')
      return Promise.reject(new Error('El Flow semanal todavía está cargando.'));
    var deck = window.FLOW_DECK || [];
    window._flowSlidesExporting = true;
    window.flowRebuild_();
    var raf = function () { return new Promise(function (r) { requestAnimationFrame(r); }); };
    var done = function () { window._flowSlidesExporting = false; window.flowRebuild_(); };
    return raf().then(raf).then(raf).then(function () { return window._flowCaptureSlideImages_({ jpeg: true }); }).then(function (imgs) {
      done();
      return imgs.map(function (im, i) {
        return im && { img: im.img, w: im.w, h: im.h, title: String((deck[i] && deck[i].name) || ('Slide ' + (i + 1))).replace(/^—\s*|\s*—$/g, '') };
      }).filter(Boolean);
    }).catch(function (e) { done(); throw e; });
  };

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
      if (t) t.textContent = 'Presentación semanal · gestional';
      waitFor(function () { return document.querySelector('#flow-track .flow-frame'); }, function () { setTimeout(post, 800); });
    });
  });
})();
