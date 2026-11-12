/* Daily Dashboard en Ownia — secciones B2B del Flow semanal (Presentaciones → Semanal), 2026-11-11. Lo inyecta server/index.js en el Daily
 * (`layout` en server/modules.js). El HTML de Apps Script no se toca.
 *
 * Reemplaza el bloque único "B2B (API + HTML)" por dos secciones, cada una con su carátula:
 *   - B2B API: las slides (sin la portada del Weekly, que ya tiene la carátula de la sección; 2026-11-12) del "Weekly B2B-MAY" del Daily B2B Tracker. No se rearman ni se copian: se llama al mismo generador
 *     (public/daily-tracker-weekly.js → window.__wkBuildDeck), así que cualquier cambio del Weekly se ve acá sin tocar nada.
 *   - B2B HTML: las mismas slides del Tracker que en API pero con canal HTML (Agencias afiliadas): Status KRs H2, Tablas GD (GB / NR / FVM) y
 *     Tablas RI, a pantalla completa y con "Info. updated" como las de API (window.__wkBuildHtmlDeck, mismo archivo).
 * Son imágenes 1920×1080 que se arman en segundo plano (capturan el Tracker, el Dashboard B2B API y el FVM semanal del Daily; tarda un par de
 * minutos): primero API y después HTML. Arrancan cuando el lector se acerca a la sección (o al descargar el PPTX) y mientras tanto se ve un aviso
 * con el avance. daily-flow-minto.js arma el deck con W.FLOW_B2B_DECK y dibuja estas slides con W.FLOW_B2B_HTML; daily-flowdeck.js las usa al exportar.
 */
(function () {
  'use strict';
  var W = window;
  var API_NAMES = ['Status KRs H2 (API)', 'KR Global B2B API', 'Hoteles pedidos por origen y destino', 'Separador · Top agencias API vs LY',
    'MTD Agencias vs LY · Globales', 'MTD Agencias vs LY · Brasil', 'MTD Agencias vs LY · México', 'MTD Agencias vs LY · Argentina',
    'Separador · Performance LW vs tendencia', 'FVM API · Weeks Evolution', 'LW Hoteles vs tendencia L4W', 'Tablas GD (API)', 'Tablas RI (API)'];
  var HTML_NAMES = ['Status KRs H2 (HTML)', 'Tablas GD · GB / NR / FVM (HTML)', 'Tablas RI · GB / NR / FVM (HTML)'];
  var API_DEFS = API_NAMES.map(function (n, i) { return { kind: 'wk_api', n: i, name: 'B2B API · ' + n }; });
  var HTML_DEFS = HTML_NAMES.map(function (n, i) { return { kind: 'wk_html', n: i, name: 'B2B HTML · ' + n }; });
  W.FLOW_B2B_DECK = [{ kind: 'divider', flag: 'API', title: 'B2B — API', name: '— B2B API —' }].concat(API_DEFS,
    [{ kind: 'divider', flag: 'HTML', title: 'B2B — HTML', name: '— B2B HTML —' }], HTML_DEFS);

  var css = document.createElement('style');
  css.textContent = [
    '.wkb-wait{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;color:#6e6e73;font-family:Poppins,sans-serif;padding:60px}',
    '.wkb-wait b{font-size:26px;color:#12111e;font-weight:700}.wkb-wait .wkb-msg{font-size:17px;max-width:900px;line-height:1.5}',
    '.wkb-wait button{margin-top:8px;border:0;border-radius:10px;background:#550fed;color:#fff;font:600 15px Poppins,sans-serif;padding:10px 20px;cursor:pointer}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  // Un estado por sección: idle | loading | done | error
  var SEC = {
    wk_api: { label: 'B2B API', n: API_NAMES.length, build: function () { return W.__wkBuildDeck().then(function (s) { return s.slice(1); }); }, state: 'idle', imgs: null, error: '', msg: '' },
    wk_html: { label: 'B2B HTML', n: HTML_NAMES.length, build: function () { return W.__wkBuildHtmlDeck(); }, state: 'idle', imgs: null, error: '', msg: '' },
  };
  var promise = null, active = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function waiting(def) {
    var S = SEC[def.kind], body;
    if (S.state === 'error') {
      body = '<b>No se pudieron armar las slides de ' + S.label + '</b><div class="wkb-msg">' + esc(S.error) + '</div><button type="button" onclick="window.__flowB2BRetry()">Reintentar</button>';
    } else {
      var queued = active !== def.kind;
      body = '<b>Armando las slides de ' + S.label + '…</b><div class="wkb-msg">' +
        (def.kind === 'wk_api' ? 'Son las mismas del Weekly B2B-MAY del Tracker: se capturan' : 'Son las mismas del Tracker pero con canal HTML: se capturan') +
        ' en segundo plano y tardan un par de minutos.<br><span class="wkb-prog" data-k="' + def.kind + '">' +
        esc(S.state === 'idle' && !promise ? 'Se arman al llegar a esta sección.' : queued ? 'En cola (se arma después de B2B API).' : (S.msg || 'Empezando…')) + '</span></div>';
    }
    return '<div class="flow-slide" data-wkb="' + def.kind + def.n + '"><div class="wkb-wait">' + body + '</div></div>';
  }
  W.FLOW_B2B_HTML = function (def) {
    var S = SEC[def.kind], img = S && S.state === 'done' && S.imgs && S.imgs[def.n];
    if (img) {
      return '<div class="flow-slide" data-wkb="' + def.kind + def.n + '" style="padding:0;overflow:hidden;background:#fff"><img alt="' + esc(def.name) + '" src="' + img +
        '" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;display:block"></div>';
    }
    return waiting(def);
  };

  function indexes(kind) {
    var out = [];
    (W.FLOW_DECK || []).forEach(function (d, i) { if (d.kind === kind) out.push(i); });
    return out;
  }
  function refresh(kind) {
    indexes(kind).forEach(function (i) {
      var fr = document.querySelector('.flow-frame[data-idx="' + i + '"] .flow-slide');
      if (fr) fr.outerHTML = W.FLOW_B2B_HTML(W.FLOW_DECK[i]);
    });
    if (typeof W.flowScale_ === 'function') W.flowScale_();
  }
  function progress(m) {
    if (!active) return;
    SEC[active].msg = m;
    Array.prototype.forEach.call(document.querySelectorAll('.wkb-prog[data-k="' + active + '"]'), function (e) { e.textContent = m; });
  }

  async function run(kind) {
    var S = SEC[kind];
    if (S.state === 'done') return;
    S.state = 'loading'; S.error = ''; active = kind; S.msg = 'Empezando…'; refresh(kind);
    try {
      var t0 = Date.now();
      while (typeof W.__wkBuildDeck !== 'function' || typeof W.__wkBuildHtmlDeck !== 'function' || typeof W.html2canvas !== 'function') {
        if (Date.now() - t0 > 60000) throw new Error('el generador del Weekly no terminó de cargar');
        await new Promise(function (r) { setTimeout(r, 500); });
      }
      W.__wkProgress = progress;
      var slides = await S.build();
      if (!slides || slides.length !== S.n) throw new Error('se esperaban ' + S.n + ' slides y llegaron ' + (slides ? slides.length : 0));
      S.imgs = slides.map(function (s) { return s.img; });
      S.state = 'done';
    } catch (e) {
      S.state = 'error'; S.error = (e && e.message) || String(e);
      console.warn('[daily-flow-b2b]', kind, e);
    }
    refresh(kind);
  }
  // Arma API y después HTML, una sola vez (las demás llamadas esperan la misma promesa). Una sección que falla no frena a la otra.
  function ensure() {
    if (promise) return promise;
    refresh('wk_api'); refresh('wk_html');
    promise = run('wk_api').then(function () { return run('wk_html'); }).then(function () { active = null; });
    return promise;
  }
  W.__flowB2BRetry = function () { promise = null; ['wk_api', 'wk_html'].forEach(function (k) { if (SEC[k].state === 'error') SEC[k].state = 'idle'; }); ensure(); };
  W.__flowB2BEnsure = ensure;                                  // lo espera daily-flowdeck.js antes de capturar el PPTX
  W.__flowB2BImage = function (def) { var S = def && SEC[def.kind]; return S && S.state === 'done' && S.imgs ? S.imgs[def.n] || null : null; };

  // Se arman cuando el lector llega cerca de la sección (4 slides antes): abrirlas todas al cargar sería pesado para quien no las mira.
  document.addEventListener('DOMContentLoaded', function () {
    var timer = setInterval(function () {
      if (promise) return clearInterval(timer);
      if (!W._flowBuilt) return;
      var first = indexes('wk_api')[0];
      if (first == null) return;
      if ((W._flowCurrentIdx || 0) >= first - 4) { clearInterval(timer); ensure(); }
    }, 1500);
  });
})();
