/* Daily Dashboard en Ownia — secciones B2B del Flow semanal (Presentaciones → Semanal), 2026-11-11. Lo inyecta server/index.js en el Daily
 * (`layout` en server/modules.js). El HTML de Apps Script no se toca.
 *
 * Reemplaza el bloque único "B2B (API + HTML)" por dos secciones, cada una con su carátula:
 *   - B2B API: EXACTAMENTE las 14 slides del "Weekly B2B-MAY" del Daily B2B Tracker. No se rearman ni se copian: se llama al mismo generador
 *     (public/daily-tracker-weekly.js → window.__wkBuildDeck), así que cualquier cambio del Weekly se ve acá sin tocar nada.
 *     Son imágenes 1920×1080 que se arman en segundo plano (capturan el Tracker, el Dashboard B2B API y el FVM semanal del Daily; tarda un
 *     par de minutos): arrancan cuando el lector se acerca a la sección (o al descargar el PPTX) y mientras tanto se ve un aviso con el avance.
 *   - B2B HTML: una slide "Pendiente de revisión".
 * daily-flow-minto.js arma el deck con W.FLOW_B2B_DECK y dibuja estas slides con W.FLOW_B2B_HTML; daily-flowdeck.js las usa al exportar.
 */
(function () {
  'use strict';
  var W = window;
  var NAMES = ['Portada', 'Status KRs H2 (API)', 'KR Global B2B API', 'Hoteles pedidos por origen y destino', 'Separador · Top agencias API vs LY',
    'MTD Agencias vs LY · Globales', 'MTD Agencias vs LY · Brasil', 'MTD Agencias vs LY · México', 'MTD Agencias vs LY · Argentina',
    'Separador · Performance LW vs tendencia', 'FVM API · Weeks Evolution', 'LW Hoteles vs tendencia L4W', 'Tablas GD (API)', 'Tablas RI (API)'];
  var API_DEFS = NAMES.map(function (n, i) { return { kind: 'wk_api', n: i, name: 'B2B API · ' + n }; });
  var HTML_DEF = { kind: 'wk_html', name: 'B2B HTML · pendiente de revisión' };
  W.FLOW_B2B_DECK = [{ kind: 'divider', flag: 'API', title: 'B2B — API', name: '— B2B API —' }].concat(API_DEFS,
    [{ kind: 'divider', flag: 'HTML', title: 'B2B — HTML', name: '— B2B HTML —' }, HTML_DEF]);

  var css = document.createElement('style');
  css.textContent = [
    '.wkb-wait{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;color:#6e6e73;font-family:Poppins,sans-serif;padding:60px}',
    '.wkb-wait b{font-size:26px;color:#12111e;font-weight:700}.wkb-wait .wkb-msg{font-size:17px;max-width:900px;line-height:1.5}',
    '.wkb-wait button{margin-top:8px;border:0;border-radius:10px;background:#550fed;color:#fff;font:600 15px Poppins,sans-serif;padding:10px 20px;cursor:pointer}',
    '.wkb-pend{display:flex;align-items:center;justify-content:center;height:100%;font:700 34px Poppins,sans-serif;color:#8a88a0}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  var st = { state: 'idle', msg: '', imgs: null, promise: null, error: '' };   // idle | loading | done | error

  function logo() { return typeof W.flLogo_ === 'function' ? W.flLogo_() : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function waiting(def) {
    var body = st.state === 'error'
      ? '<b>No se pudieron armar las slides de B2B API</b><div class="wkb-msg">' + esc(st.error) + '</div><button type="button" onclick="window.__flowB2BRetry()">Reintentar</button>'
      : '<b>Armando las slides de B2B API…</b><div class="wkb-msg">Son las mismas del Weekly B2B-MAY del Tracker: se capturan en segundo plano y tardan un par de minutos.<br><span class="wkb-prog">' +
        esc(st.msg || (st.state === 'idle' ? 'Se arman al llegar a esta sección.' : 'Empezando…')) + '</span></div>';
    return '<div class="flow-slide" data-wkb="' + def.n + '"><div class="wkb-wait">' + body + '</div></div>';
  }
  W.FLOW_B2B_HTML = function (def) {
    if (def.kind === 'wk_html') {
      return '<div class="flow-slide"><div class="fl-head"><div class="fl-title"><small>B2B HTML</small>Pendiente de revisión</div><div class="fl-brand">' + logo() + '</div></div>' +
        '<div class="fl-rule"></div><div class="fl-body"><div class="wkb-pend">Esta sección está pendiente de revisión</div></div></div>';
    }
    var img = st.imgs && st.imgs[def.n];
    if (st.state === 'done' && img) {
      return '<div class="flow-slide" data-wkb="' + def.n + '" style="padding:0;overflow:hidden;background:#fff"><img alt="' + esc(def.name) + '" src="' + img +
        '" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;display:block"></div>';
    }
    return waiting(def);
  };

  function indexes() {
    var out = [];
    (W.FLOW_DECK || []).forEach(function (d, i) { if (d.kind === 'wk_api') out.push(i); });
    return out;
  }
  function refresh() {
    indexes().forEach(function (i) {
      var fr = document.querySelector('.flow-frame[data-idx="' + i + '"] .flow-slide');
      if (fr) fr.outerHTML = W.FLOW_B2B_HTML(W.FLOW_DECK[i]);
    });
    if (typeof W.flowScale_ === 'function') W.flowScale_();
  }
  function progress(m) {
    st.msg = m;
    Array.prototype.forEach.call(document.querySelectorAll('.wkb-prog'), function (e) { e.textContent = m; });
  }

  // Arma las 14 slides una sola vez (las demás llamadas esperan la misma promesa). Devuelve las imágenes (data URL JPEG 1920×1080).
  function ensure() {
    if (st.promise) return st.promise;
    st.state = 'loading'; st.error = ''; progress('Empezando…');
    st.promise = (async function () {
      var t0 = Date.now();
      while (typeof W.__wkBuildDeck !== 'function' || typeof W.html2canvas !== 'function') {
        if (Date.now() - t0 > 60000) throw new Error('el generador del Weekly no terminó de cargar');
        await new Promise(function (r) { setTimeout(r, 500); });
      }
      W.__wkProgress = progress;
      var slides = await W.__wkBuildDeck();
      if (!slides || slides.length !== NAMES.length) throw new Error('el Weekly devolvió ' + (slides ? slides.length : 0) + ' slides en vez de ' + NAMES.length);
      st.imgs = slides.map(function (s) { return s.img; });
      st.state = 'done';
      refresh();
      return st.imgs;
    })().catch(function (e) {
      st.state = 'error'; st.error = (e && e.message) || String(e); st.promise = null;
      console.warn('[daily-flow-b2b]', e);
      refresh();
      throw e;
    });
    st.promise.catch(function () { /* el estado ya quedó en error */ });
    return st.promise;
  }
  W.__flowB2BRetry = function () { st.promise = null; st.state = 'idle'; refresh(); ensure(); };
  W.__flowB2BEnsure = ensure;                                  // lo espera daily-flowdeck.js antes de capturar el PPTX
  W.__flowB2BImage = function (n) { return st.state === 'done' && st.imgs ? st.imgs[n] || null : null; };

  // Se arman cuando el lector llega cerca de la sección (4 slides antes): abrirlas todas al cargar sería pesado para quien no las mira.
  document.addEventListener('DOMContentLoaded', function () {
    var timer = setInterval(function () {
      if (st.promise || st.state !== 'idle') return clearInterval(timer);
      if (!W._flowBuilt) return;
      var first = indexes()[0];
      if (first == null) return;
      if ((W._flowCurrentIdx || 0) >= first - 4) { clearInterval(timer); ensure(); }
    }, 1500);
  });
})();
