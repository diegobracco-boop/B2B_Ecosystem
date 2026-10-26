/* Daily Dashboard en Ownia: una slide del Flow sola, para embeber en otro deck (2026-10-26).
 * Lo inyecta server/index.js en el Daily (`layout` en server/modules.js). Solo actúa con
 * ?embed=b2b2c-cover en la URL; sin ese parámetro no hace nada. El HTML de Apps Script no se toca.
 *
 *   <base>/daily?embed=b2b2c-cover[&organic=yes|no]
 *   → abre el Flow y muestra solo la portada "B2B2C — Resumen mensual (OC)" (cover_oc) a 1280×720.
 *     Los números son los del Daily (NR Farming / Hunting / TBD y FVM del Datalake; OC del contable).
 *
 * Cuando la slide está lista avisa al padre con postMessage({ type: 'daily-embed', ready: true, … })
 * e incluye el NR "at risk" del H2: proyección (real + Run Rate) menos Budget de los partners en
 * Onboarding y TBD (stage / account_type 'New' o partner TBD), oct–mar. Lo usa "Slides mensuales"
 * del Hub (public/hub-slides.js) para el título de esa slide.
 */
(function () {
  'use strict';
  var m = /[?&]embed=([\w-]+)/.exec(location.search);
  if (!m || m[1] !== 'b2b2c-cover') return;
  var COVER_KIND = 'cover_oc';
  var org = /[?&]organic=(yes|no)\b/.exec(location.search);

  var css = document.createElement('style');
  css.textContent = [
    'html.ow-embed,html.ow-embed body{overflow:hidden !important;background:#fff !important}',
    'html.ow-embed body *{visibility:hidden !important}',
    'html.ow-embed .ow-embed-target,html.ow-embed .ow-embed-target *{visibility:visible !important}',
    'html.ow-embed .ow-embed-target{position:fixed !important;left:0 !important;top:0 !important;width:1280px !important;height:720px !important;margin:0 !important;z-index:2147483000}',
    'html.ow-embed .ow-embed-target .flow-slide{transform:none !important}',
    'html.ow-embed .ow-embed-target .flow-frame-tag{display:none !important}',
    'html.ow-embed #ow-embed-load{visibility:visible !important;position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font:15px Poppins,sans-serif;color:#6b6b85;z-index:2147483001;background:#fff}',
  ].join('\n');
  document.documentElement.classList.add('ow-embed');
  (document.head || document.documentElement).appendChild(css);

  function post(msg) { try { if (window.parent !== window) window.parent.postMessage(Object.assign({ type: 'daily-embed' }, msg), location.origin); } catch (e) { /* sin padre */ } }

  // NR "at risk" del H2: (real + Run Rate) − Budget de los partners nuevos (Onboarding + TBD), oct–mar.
  function atRiskNR() {
    var raw = (typeof window.b2bcRaw_ === 'function' && window.b2bcRaw_()) || window._rawB2BC;
    var base = window._rawB2BC;
    if (!raw || !base || !base.meta) return null;
    var L = base.meta.last_actuals_date, y0 = +(typeof window.flFyStart_ === 'function' ? window.flFyStart_(L) : L).substring(0, 4);
    var h2From = y0 + '-10-01', h2To = (y0 + 1) + '-03-31';
    function isNew(r, typeKey) {
      if (String(r.partner || '').trim().toUpperCase() === 'TBD') return true;
      return r[typeKey] === 'New';
    }
    function inH2(f) { return f >= h2From && f <= h2To; }
    var bud = 0, proj = 0;
    (raw.budget || []).concat(raw.budget_fy_rest || []).forEach(function (r) { if (inH2(r.fecha) && isNew(r, 'stage')) bud += r.net_revenue || 0; });
    (raw.actuals || []).concat(raw.actuals_fy_rest || []).forEach(function (r) { if (inH2(r.fecha) && r.fecha <= L && isNew(r, 'account_type')) proj += r.net_revenues || 0; });
    (raw.runrate || []).concat(raw.runrate_fy_rest || []).forEach(function (r) { if (inH2(r.fecha) && r.fecha > L && isNew(r, 'stage')) proj += r.net_revenue || 0; });
    return { nrBudget: bud, nrProj: proj, nrAtRisk: bud - proj, lastActuals: L };
  }

  function waitFor(cond, then, tries) {
    if (cond()) return then();
    if ((tries || 0) > 600) { post({ ready: false, error: 'El Daily no terminó de cargar' }); return; }   // ~5 min
    setTimeout(function () { waitFor(cond, then, (tries || 0) + 1); }, 500);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var load = document.createElement('div');
    load.id = 'ow-embed-load';
    load.textContent = 'Cargando la portada B2B2C del Daily…';
    document.body.appendChild(load);
    var idx = (window.FLOW_DECK || []).map(function (d) { return d.kind; }).indexOf(COVER_KIND);
    waitFor(function () { return window._rawB2BC && window._rawB2BC.meta && typeof window.switchMainView === 'function'; }, function () {
      if (org && typeof window.setDailyOrganic === 'function') window.setDailyOrganic(org[1] === 'yes');
      window.switchMainView('flow');
      waitFor(function () { return document.querySelector('#flow-track .flow-frame[data-idx="' + idx + '"] .flow-slide'); }, function () {
        var frame = document.querySelector('#flow-track .flow-frame[data-idx="' + idx + '"]');
        frame.classList.add('ow-embed-target');
        // Los gráficos del Flow se dibujan cuando la slide entra en pantalla
        if (typeof window.flowScrollTo_ === 'function') window.flowScrollTo_(idx);
        load.remove();
        setTimeout(function () { post({ ready: true, atRisk: atRiskNR() }); }, 1500);
      });
    });
  });
})();
