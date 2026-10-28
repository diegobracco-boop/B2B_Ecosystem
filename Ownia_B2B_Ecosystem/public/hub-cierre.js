/* Hub (P&L Dashboard) en Ownia — modo "Slides cierre de mes" para el módulo Flow (2026-10-28).
 * Lo inyecta server/index.js en el Hub (`layout` en server/modules.js). El HTML de Apps Script no se toca.
 *
 *   <base>/hub?cierre=1&embedded=1
 *   → abre directo el overlay "Slides Cierre de Mes" (Consolidado · B2B · B2B2C) del Hub, sin barra del Hub ni botones (imprimir / Google Slides / cerrar),
 *     conserva el selector de mes y avisa al padre (postMessage {type:'flow-slide', section:'cierre', idx, total, title, month}) en qué slide está.
 *     Expone window.__flowExport() con las slides como imágenes para el PPTX. Lo embebe Flow_B2B/flow.html (sección Mensual).
 */
(function () {
  'use strict';
  if (!/[?&]cierre=1\b/.test(location.search)) return;
  var css = document.createElement('style');
  css.textContent = '#ownia-hubnav,.ownia-home-top{display:none!important}#cierre-toolbar .cierre-actions,#cierre-toolbar .cierre-ttl{display:none!important}' +
    '#cierre-toolbar{justify-content:flex-end}';
  (document.head || document.documentElement).appendChild(css);

  function waitFor(cond, then, n) {
    if (cond()) return then();
    if ((n || 0) > 600) return;   // ~5 min
    setTimeout(function () { waitFor(cond, then, (n || 0) + 1); }, 500);
  }
  function slides() { return Array.prototype.slice.call(document.querySelectorAll('#cierre-body .cierre-slide')); }
  function titleOf(el, i) {
    var t = el.querySelector('.cierre-slide-title, .cierre-divider-title');
    var s = t ? t.textContent.trim() : '';
    if (el.classList.contains('cierre-divider')) { var sub = el.querySelector('.cierre-divider-sub'); s = 'Carátula ' + s + (sub ? ' · ' + sub.textContent.trim() : ''); }
    return s || ('Slide ' + (i + 1));
  }
  function month() { var s = document.getElementById('cierre-mes-sel'); return s ? s.value : ''; }
  function ready() { return slides().length > 0 && !document.querySelector('#cierre-body .cierre-loading'); }

  var io = null;
  function post(i) {
    var sl = slides();
    if (window.parent === window || !sl[i]) return;
    try { window.parent.postMessage({ type: 'flow-slide', section: 'cierre', idx: i, total: sl.length, title: titleOf(sl[i], i), month: month() }, location.origin); } catch (e) { /* sin padre */ }
  }
  function watch() {
    if (typeof IntersectionObserver === 'undefined' || !ready()) return;
    if (io) io.disconnect();
    var vis = {};
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { vis[e.target.getAttribute('data-fi')] = e.isIntersecting ? e.intersectionRatio : 0; });
      var best = -1, bv = 0;
      Object.keys(vis).forEach(function (k) { if (vis[k] > bv) { bv = vis[k]; best = +k; } });
      if (best >= 0) post(best);
    }, { threshold: [0.1, 0.25, 0.5, 0.75] });
    slides().forEach(function (el, i) { el.setAttribute('data-fi', i); io.observe(el); });
    post(0);
  }

  // Captura de todas las slides: misma técnica que "Enviar a Google Slides" del Hub (html2canvas de cada .cierre-slide tal cual se ve).
  window.__flowExport = function () {
    if (!ready() || typeof window.html2canvas !== 'function') return Promise.reject(new Error('Las slides de cierre todavía se están generando.'));
    var chain = Promise.resolve([]);
    slides().forEach(function (el, i) {
      chain = chain.then(function (acc) {
        return window.html2canvas(el, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' }).then(function (c) {
          acc.push({ img: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height, title: titleOf(el, i) });
          return acc;
        });
      });
    });
    return chain;
  };

  document.addEventListener('DOMContentLoaded', function () {
    waitFor(function () { return typeof window.openCierreSlides === 'function' && window._state && window._state.filters && window._defaultPeriod; }, function () {
      window.openCierreSlides();
      var body = document.getElementById('cierre-body');
      if (body && typeof MutationObserver !== 'undefined') {
        // el cuerpo se rearma al cambiar el mes: se vuelve a observar cuando termina de generar
        new MutationObserver(function () { clearTimeout(body._t); body._t = setTimeout(watch, 400); }).observe(body, { childList: true });
      }
      var sel = document.getElementById('cierre-mes-sel');
      if (sel) sel.addEventListener('change', function () { setTimeout(function () { post(0); }, 600); });
    });
  });
})();
