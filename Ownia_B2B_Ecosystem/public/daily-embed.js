/* Daily Dashboard en Ownia: una slide del Flow sola, para embeber en otro deck (2026-10-26).
 * Lo inyecta server/index.js en el Daily (`layout` en server/modules.js). Solo actúa con
 * ?embed=b2b2c-cover en la URL; sin ese parámetro no hace nada. El HTML de Apps Script no se toca.
 *
 *   <base>/daily?embed=b2b2c-cover[&organic=yes|no]
 *   → abre el Flow y muestra solo la portada "B2B2C — Resumen mensual (OC)" (cover_oc) a 1280×720.
 *     Los números son los del Daily (NR Farming / Hunting / TBD y FVM del Datalake; OC del contable).
 *   <base>/daily?embed=flow&slide=<kind>[-<metric>][-<region>]   (p.ej. slide=okr-nr, monthly-BR)
 *   → cualquier otra slide del Flow (FLOW_DECK), tal cual la arma el Daily.
 *
 * En modo embebido la portada cambia (solo acá, el Daily normal queda igual):
 *  - título "B2B2C Monthly Performance vs Budget" y, debajo, el "at risk" del H2: NR = Budget menos
 *    proyección (real + Run Rate) de los partners en Onboarding y TBD (stage / account_type 'New' o
 *    partner TBD), oct–mar; OC estimado con el margen OC/NR que manda el deck (&ocm=, del contable);
 *  (las tablas NR / FVM / OC por H1 y H2 las pone public/daily-flow-slides.js, también fuera del embed).
 *   &coibr=excl|incl fija el switch "COI Brasil" (default del Daily: Excluir).
 * Avisa al padre con postMessage({ type: 'daily-embed', ready }) cuando la slide está lista.
 * Lo usa "Slides mensuales" del Hub (public/hub-slides.js).
 */
(function () {
  'use strict';
  var m = /[?&]embed=([\w-]+)/.exec(location.search);
  if (!m || (m[1] !== 'b2b2c-cover' && m[1] !== 'flow')) return;
  var COVER_KIND = 'cover_oc';
  var sl = /[?&]slide=([\w-]+)/.exec(location.search);
  // Slide pedida: kind[-metric][-region] de FLOW_DECK (la portada OC por default)
  var WANT = m[1] === 'flow' && sl ? sl[1].split('-') : [COVER_KIND];
  function slideIdx() {
    return (window.FLOW_DECK || []).findIndex(function (d) {
      return d.kind === WANT[0] && (!WANT[1] || d.metric === WANT[1] || d.region === WANT[1]) && (!WANT[2] || d.region === WANT[2]);
    });
  }
  var org = /[?&]organic=(yes|no)\b/.exec(location.search);
  var coibr = /[?&]coibr=(excl|incl)\b/.exec(location.search);
  var ocm = /[?&]ocm=(-?[\d.]+)/.exec(location.search);
  var OC_MARGIN = ocm ? parseFloat(ocm[1]) : NaN;

  var css = document.createElement('style');
  css.textContent = [
    'html.ow-embed,html.ow-embed body{overflow:hidden !important;background:#fff !important}',
    'html.ow-embed body *{visibility:hidden !important}',
    'html.ow-embed .ow-embed-target,html.ow-embed .ow-embed-target *{visibility:visible !important}',
    'html.ow-embed .ow-embed-target{position:fixed !important;left:0 !important;top:0 !important;width:1280px !important;height:720px !important;margin:0 !important;z-index:2147483000}',
    'html.ow-embed .ow-embed-target .flow-slide{transform:none !important}',
    'html.ow-embed .ow-embed-target .flow-frame-tag{display:none !important}',
    // La línea del "at risk" no tiene que empujar el cuerpo fuera de los 720px: se achica el encabezado.
    'html.ow-embed .ow-embed-target .fl-head{padding-top:12px !important}',
    'html.ow-embed .ow-embed-target .fl-title{font-size:25px !important}',
    'html.ow-embed .ow-risk{font-size:14px;font-weight:600;color:#1d1d1f;padding:0 40px;letter-spacing:0}',
    'html.ow-embed .ow-risk small{font-size:11.5px;font-weight:400;color:#8e8e93;margin-left:6px}',
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

  function installOverrides() {
    // Título del deck + "at risk" en el encabezado de la propia slide (un solo header)
    var origBuild = window.flowBuildSlide_;
    window.flowBuildSlide_ = function (def, idx) {
      var html = origBuild.apply(this, arguments);
      if (!def || def.kind !== COVER_KIND) return html;
      var r = atRiskNR(), risk = '';
      if (r) {
        var oc = isFinite(OC_MARGIN) ? r.nrAtRisk * OC_MARGIN : NaN;
        risk = '<div class="ow-risk">H2 includes “TBD” NR $' + (r.nrAtRisk / 1e6).toFixed(1) + 'M' +
          (isFinite(oc) ? ' y OC ~$' + (oc / 1e6).toFixed(1) + 'M' : '') + ' at Risk' +
          '<small>proyección vs Budget de Onboarding + TBD' + (isFinite(oc) ? '; OC estimado con el margen OC/NR del Budget H2 (' + Math.round(OC_MARGIN * 100) + '%)' : '') + '</small></div>';
      }
      return html.replace(/<div class="fl-title">[\s\S]*?<\/div>/, '<div class="fl-title">B2B2C Monthly Performance vs Budget</div>')
        .replace('<div class="fl-rule"></div>', risk + '<div class="fl-rule"></div>');
    };
  }

  function waitFor(cond, then, tries) {
    if (cond()) return then();
    if ((tries || 0) > 600) { post({ ready: false, error: 'El Daily no terminó de cargar' }); return; }   // ~5 min
    setTimeout(function () { waitFor(cond, then, (tries || 0) + 1); }, 500);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var load = document.createElement('div');
    load.id = 'ow-embed-load';
    load.textContent = 'Cargando la slide del Daily…';
    document.body.appendChild(load);
    var idx = slideIdx();
    if (idx < 0) { load.textContent = 'No existe esa slide del Flow: ' + WANT.join('-'); post({ ready: false, error: load.textContent }); return; }
    waitFor(function () { return window._rawB2BC && window._rawB2BC.meta && typeof window.switchMainView === 'function'; }, function () {
      installOverrides();
      if (org && typeof window.setDailyOrganic === 'function') window.setDailyOrganic(org[1] === 'yes');
      if (coibr && typeof window.setExCoiBr === 'function' && (coibr[1] === 'excl') !== !!window._exCoiBr) window.setExCoiBr(coibr[1] === 'excl');
      window.switchMainView('flow');
      waitFor(function () { return document.querySelector('#flow-track .flow-frame[data-idx="' + idx + '"] .flow-slide'); }, function () {
        var frame = document.querySelector('#flow-track .flow-frame[data-idx="' + idx + '"]');
        frame.classList.add('ow-embed-target');
        // Los gráficos del Flow se dibujan cuando la slide entra en pantalla
        if (typeof window.flowScrollTo_ === 'function') window.flowScrollTo_(idx);
        load.remove();
        setTimeout(function () { post({ ready: true }); }, 1500);
      });
    });
  });
})();
