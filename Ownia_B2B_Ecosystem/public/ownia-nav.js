/* Navegación de las landings GAS servidas desde Ownia. Lo inyecta server/index.js después del
 * shim de google.script.run. El HTML de cada landing no se toca (GAS sigue siendo el productivo);
 * en Ownia:
 *  - El link al Hub de Apps Script del header pasa a ser "🏠 Home" → menú principal de Ownia, en
 *    la misma pestaña. Los links del header a otra landing ya migrada van a su versión de Ownia.
 *  - La portada propia del módulo (#home-overlay, con su botón "⌂ Inicio") no se muestra: se entra
 *    directo a la vista `data-start-view` (goToView) y se navega con los selectores del header.
 *  - Si la landing no tiene header (el Manual), se agrega el botón "🏠 Home" arriba del sidebar.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var home = script.getAttribute('data-home');
  var startView = script.getAttribute('data-start-view');
  var links = {};
  try { links = JSON.parse(script.getAttribute('data-links') || '{}'); } catch (e) { links = {}; }

  var css = document.createElement('style');
  css.textContent = '#home-overlay{display:none!important}' +
    '.ownia-home-side{display:inline-flex;align-items:center;gap:6px;margin:0 20px 14px;padding:6px 12px;' +
    'border-radius:8px;border:1px solid currentColor;font-size:12px;font-weight:700;text-decoration:none;opacity:.85}' +
    '.ownia-home-side:hover{opacity:1}';
  document.head.appendChild(css);

  function asHome(a) {
    a.href = home;
    a.removeAttribute('target');
    a.textContent = '🏠 Home';
    a.title = 'Volver al menú principal de B2B Ecosystem';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var buttons = document.querySelectorAll('button[onclick^="showLanding"]');
    for (var i = 0; i < buttons.length; i++) buttons[i].remove();

    var hasHome = false;
    var anchors = document.querySelectorAll('header a[href*="script.google.com"]');
    for (var j = 0; j < anchors.length; j++) {
      var m = /\/s\/([\w-]+)\/exec/.exec(anchors[j].href);
      var dest = m && links[m[1]];
      if (!dest) continue;
      if (dest === home) { asHome(anchors[j]); hasHome = true; } else { anchors[j].href = dest; anchors[j].removeAttribute('target'); }
    }

    var side = !hasHome && document.querySelector('#sidebar .sidebar-logo');
    if (side) {
      var a = document.createElement('a');
      a.className = 'ownia-home-side';
      asHome(a);
      side.parentNode.insertBefore(a, side.nextSibling);
    }

    if (startView && typeof window.goToView === 'function') window.goToView(startView);
  });
})();
