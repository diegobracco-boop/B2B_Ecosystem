/* Navegación de las landings GAS servidas desde Ownia. Lo inyecta server/index.js después del
 * shim de google.script.run. El HTML de cada landing no se toca (GAS sigue siendo el productivo);
 * en Ownia:
 *  - El link al Hub de Apps Script del header pasa a ser "🏠 Home" → menú principal de Ownia, en
 *    la misma pestaña. Los links del header a otra landing ya migrada van a su versión de Ownia.
 *  - La portada propia del módulo (#home-overlay, con su botón "⌂ Inicio") no se muestra: se entra
 *    directo a la vista `data-start-view` (goToView) y se navega con los selectores del header.
 *  - Si la landing no tiene ese link, se agrega "🏠 Home": arriba del sidebar (el Manual) o al
 *    principio de la .topbar (el Daily). Dentro de un iframe (Tracker embebido) no se agrega.
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
    '.ownia-home-side:hover{opacity:1}' +
    '.ownia-home-top{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;margin-right:4px;border-radius:8px;' +
    'border:1px solid currentColor;font-size:12px;font-weight:600;text-decoration:none;color:inherit;opacity:.8}' +
    '.ownia-home-top:hover{opacity:1}';
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

    var embedded = window.top !== window;
    var side = !hasHome && !embedded && document.querySelector('#sidebar .sidebar-logo');
    var top = !hasHome && !embedded && !side && document.querySelector('.topbar');
    if (side || top) {
      var a = document.createElement('a');
      a.className = side ? 'ownia-home-side' : 'ownia-home-top';
      asHome(a);
      if (side) side.parentNode.insertBefore(a, side.nextSibling);
      else top.insertBefore(a, top.firstChild);
    }

    if (startView && typeof window.goToView === 'function') window.goToView(startView);
  });
})();
