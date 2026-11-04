/* Daily B2B Tracker en Ownia: vista "por GB" del KR "% Hoteles Directos vendidos destino Globales" (2026-11-04). Lo inyecta server/index.js en el
 * Daily (`layout` en server/modules.js). El HTML de Apps Script no se toca.
 *
 * En KR Global B2B API agrega un switch "Hoteles | GB 🔒" junto al selector de mes. Hoteles (default) es el KR de siempre: hoteles distintos con
 * contrato directo / hoteles distintos, destinos no LATAM. GB es la misma pregunta en gross bookings (gestion date, canal API, hoteles):
 *   numerador   = GB de PAM + OMB + HSI con destino no LATAM
 *   denominador = GB de TODO el inventario (directo y no directo) con destino no LATAM
 * El target es el mismo. El actual por GB lo arma el pipeline (daily_sync.py -> okr_builder.py, fila "GB · % Hoteles Directos vendidos destino
 * Globales" de okr.json) y llega en `kr.actuals_gb` (getGlobalesKRTargets). Pasar a GB pide una clave (se guarda solo su hash SHA-256; es una
 * traba de pantalla, no seguridad de datos: el dato viaja igual al navegador). Volver a Hoteles no pide nada.
 */
(function () {
  'use strict';
  var KR_ID = 'pct_hoteles_directos_globales';
  var PASS_SHA256 = '55cc319cbb2c7b9e8c280d5bd2aac72a2ea0eb87dead443f631f15893ab17f3b';
  var gbOn = false;

  function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  function kr() { return (typeof globalesData !== 'undefined' && globalesData && globalesData.krs || []).filter(function (k) { return k.id === KR_ID; })[0]; }
  function hasGb(k) { return !!(k && k.actuals_gb && Object.keys(k.actuals_gb).some(function (m) { return typeof k.actuals_gb[m] === 'number'; })); }

  function paintSwitch() {
    var sw = document.getElementById('krgb-sw');
    if (!sw) return;
    [].forEach.call(sw.querySelectorAll('button'), function (b) { b.classList.toggle('active', (b.dataset.v === 'gb') === gbOn); });
    var hint = sw.querySelector('.krgb-hint'), k = kr();
    hint.textContent = gbOn && k && !hasGb(k) ? 'Sin datos por GB todavía: falta correr "Actualizar reales"' : '';
  }
  function set(v) { gbOn = v; paintSwitch(); renderGlobales(); }

  function ensureSwitch() {
    if (document.getElementById('krgb-sw')) return;
    var anchor = document.getElementById('globMonthGroup');
    if (!anchor || !anchor.parentNode) return;
    var sw = document.createElement('span');
    sw.id = 'krgb-sw';
    sw.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:14px;font-size:0.78rem;color:#6b7280';
    sw.title = '% Hoteles Directos vendidos destino Globales: por cantidad de hoteles (default) o por gross bookings (PAM + OMB + HSI sobre todo el inventario, destinos no LATAM)';
    sw.innerHTML = '<span style="font-weight:600">KR % directos Globales</span>' +
      '<span class="tab-toggle"><button type="button" class="ttab active" data-v="hot">Hoteles</button>' +
      '<button type="button" class="ttab" data-v="gb">GB 🔒</button></span><span class="krgb-hint" style="color:#b45309"></span>';
    sw.querySelector('[data-v="hot"]').onclick = function () { if (gbOn) set(false); };
    sw.querySelector('[data-v="gb"]').onclick = function () {
      if (gbOn) return;
      var pw = window.prompt('Contraseña para ver el KR "% Hoteles Directos vendidos destino Globales" por GB');
      if (pw === null) return;
      sha256(pw).then(function (h) { if (h === PASS_SHA256) set(true); else window.alert('Contraseña incorrecta.'); });
    };
    anchor.parentNode.insertBefore(sw, anchor.nextSibling);
    paintSwitch();
  }

  window.addEventListener('load', function () {
    if (typeof window.renderGlobales !== 'function' || !document.getElementById('globalesWrap') || !window.crypto || !crypto.subtle) return;
    var orig = window.renderGlobales;
    // Con GB activo se cambia por un momento el actual (y el nombre) del KR: renderGlobales lo lee de kr.actuals y kr.name.
    window.renderGlobales = function () {
      var k = kr(), saved = null;
      if (gbOn && k) { saved = { name: k.name, actuals: k.actuals }; k.name = k.name + ' · por GB'; k.actuals = hasGb(k) ? k.actuals_gb : {}; }
      try { return orig.apply(this, arguments); }
      finally { if (saved) { k.name = saved.name; k.actuals = saved.actuals; } ensureSwitch(); paintSwitch(); }
    };
    ensureSwitch();
  });
})();
