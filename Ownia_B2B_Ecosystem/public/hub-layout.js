/* Layout del P&L Dashboard (Hub, Dashboard_B2B_WLs) en Ownia. Lo inyecta server/index.js solo en
 * ese módulo (`layout` en server/modules.js), después de ownia-nav.js. El HTML de Apps Script no se
 * toca: desde 2026-10-23 las mejoras visuales se hacen solo acá (GAS queda congelado).
 * Pensado para su audiencia: Chief y VP Comercial (lectura rápida, reuniones, pantalla compartida).
 *  - Barra fija bajo el header (sin menú hamburguesa): negocio (Consolidado / B2B2C / B2B / HTML / API)
 *    y las pestañas de PRIMARY, armadas de los botones del menú lateral (#nav-*). Una sección nueva no
 *    aparece sola: se suma a PRIMARY. Lo demás se abre desde el menú principal de la app.
 *  - Vista de entrada para dirección (estilo simple): frase de lectura con los mayores desvíos, grilla
 *    GB / NR / OC × negocio con el formato de la presentación de dirección (valor USD $M, YoY y desvío
 *    vs Goal), "¿Cómo viene el año?" (H1 / H2 / FY vs Budget), benchmark vs B2C en una línea, waterfall
 *    de Operating Contribution y evolución con su YoY por país. Lo demás, en "Ver detalle".
 *  - Línea de contexto con período, LoB, escenario y filtros. En la barra fija, solo en las vistas del
 *    P&L, "Filtrar…" (se escribe "brasil b2b sep vs fc" y se aplica con Enter; el diccionario está en
 *    public/filter-aliases.js) y el botón "Filtros": el panel se abre como cajón desde la derecha,
 *    encima del contenido y sin correrlo (el layout no salta); se cierra con "Listo", Esc o un clic afuera.
 *  - Cambio de LoB instantáneo: apenas llegan los datos del primero se precargan los otros dos.
 *  - Teclado: 1 a 5 cambian de negocio.
 *  - P&L Contable y P&L Managerial no se embeben: el botón lleva a su sección de Ownia (pnlRedirect).
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var links = {};
  try { links = JSON.parse(script.getAttribute('data-links') || '{}'); } catch (e) { links = {}; }
  var home = script.getAttribute('data-home');

  var NAV_H = 40;   // = alto de la .lob-tabs original: el panel de filtros del Hub va a --hdr-h + 40px
  // HTML (= B2B MIN) y API (= B2B MAY) se gestionan como negocios (2026-10-31): para el Hub son LoB b2b + canal.
  var LOBS = [['all', 'Consolidado'], ['b2b2c', 'B2B2C'], ['b2b', 'B2B'], ['html', 'HTML'], ['api', 'API']];
  var BIZ_CANAL = { html: 'min', api: 'may' };
  var LOB_NAME = { all: 'Consolidado B2B + B2B2C', b2b: 'B2B', b2b2c: 'B2B2C' };
  function bizOf(st) { return st.lob !== 'b2b' ? st.lob : st.canal === 'min' ? 'html' : st.canal === 'may' ? 'api' : 'b2b'; }
  function bizName(st) { return { html: 'HTML (B2B MIN)', api: 'API (B2B MAY)' }[bizOf(st)] || LOB_NAME[st.lob] || ''; }
  // Elige un negocio de la barra: el canal se marca antes, porque switchLob ya recarga con él.
  function pickBiz(biz) {
    var st = window._state;
    if (!st) return;
    var canal = BIZ_CANAL[biz] || 'all', lob = BIZ_CANAL[biz] ? 'b2b' : biz;
    var same = st.lob === lob && st.canal === canal;
    st.canal = canal;
    Array.prototype.forEach.call(document.querySelectorAll('#canal-fg .canal-toggle button'), function (b) { b.classList.toggle('active', b.dataset.c === canal); });
    if (st.lob !== lob) return window.goToSection(lob);
    if (!same && typeof window.reload === 'function') window.reload();
  }
  // Accesos del menú principal (?view=<negocio>): se abre directo en ese negocio. Corre antes del loadAll del Hub, así la
  // primera carga ya pide ese negocio; reload queda anulado para no pedir los datos dos veces.
  function applyStartBiz() {
    var biz = new URLSearchParams(window.location.search).get('view');
    if (!biz || biz === 'all' || !LOBS.some(function (l) { return l[0] === biz; })) return;
    var reload = window.reload;
    window.reload = function () {};
    try { pickBiz(biz); } finally { window.reload = reload; }
  }
  function syncBiz() {
    var st = window._state, nav = document.getElementById('ownia-hubnav');
    if (!st || !nav) return;
    var cur = bizOf(st);
    Array.prototype.forEach.call(nav.querySelectorAll('.ohn-seg [data-lob]'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.lob === cur)); });
    var span = document.querySelector('#logo-title span');
    if (span && BIZ_CANAL[cur]) span.textContent = bizName(st);
    else if (span && st.lob === 'b2b') span.textContent = 'B2B';
    if (st.lob === 'b2b') preloadCanales();
  }
  // Cambio instantáneo también entre B2B, HTML y API: la primera vez que se entra a alguno, se precargan los otros.
  var canalesPreloaded = false;
  function preloadCanales() {
    if (canalesPreloaded || /[?&]embedded=1(&|$)/.test(location.search) || typeof window.getParams !== 'function' || !window._dataCache || !window._state.pnl) return;
    canalesPreloaded = true;
    var base = window.getParams();
    ['all', 'min', 'may'].forEach(function (c) {
      if (c === base.canal) return;
      var pp = Object.assign({}, base, { canal: c }), k = JSON.stringify(pp);
      if (window._dataCache[k]) return;
      window.google.script.run.withSuccessHandler(function (d) { window._dataCache[k] = d; }).withFailureHandler(function () {}).getAllData(pp);
    });
  }
  // Pestañas de la barra. Por país, OKR, Operativo y Herramientas salieron del P&L Dashboard (2026-10-31): Por país era el
  // Apps Script de lob_country_one_pager; lo demás se abre desde el menú principal. "Slides mensuales" vive en el módulo Flow
  // (sección Mensual, contable); el deck sigue abriéndose con <base>/hub?slides=1.
  var PRIMARY = ['h2h1', 'pnl', 'pnl_mgr'];
  // Nombres cortos (el nombre completo queda como tooltip).
  var SHORT = { h2h1: 'H2 vs H1', pnl: 'P&L Contable', pnl_mgr: 'P&L Managerial' };
  // KPIs de la franja (ids de _state.pnl.rows) y comparación según el Goal elegido.
  var KPIS = [['gb', 'Gross Bookings'], ['nr', 'Net Revenue'], ['oc', 'Operating Contribution']];
  var GOALS = {
    budget: ['varBudPct', 'Budget'], runRate: ['varRRPct', 'Run Rate'],
    forecast: ['varFcPct', 'Forecast'], lastYear: ['yoyPct', 'Last Year'],
  };
  // Goal "Forecast - Bridge to budget": en el Hub es goal 'forecast' con fcSource 'btb' (otra fuente).
  function goalOf(st) {
    if (st.goal === 'forecast' && st.fcSource === 'btb') return ['varFcPct', 'Forecast - Bridge to budget'];
    if (st.goal === 'runRate' && st.rrSource === 'lrr') return ['varRRPct', 'Last Run Rate'];   // ídem con lastrunrate.json
    return GOALS[st.goal] || GOALS.budget;
  }
  var AMBER_FROM = -5;   // semáforo (mismo criterio que _deltaState_ del Hub): verde ≥ 0%, ámbar −5% a 0%, rojo < −5%
  // Secciones embebidas que siguen el LoB elegido en la barra. Son páginas de Ownia (mismo origen):
  // se llama a su propia función de cambio de LoB, sin recargar. Con "Consolidado", las que no
  // tienen vista consolidada quedan como están.
  var FRAMES = {
    pnl: { id: 'pnl-frame', ready: function (w) { return typeof w.goToView === 'function'; },
      apply: function (w, lob) { w.goToView({ all: 'contable-combined', b2b: 'contable-b2b', b2b2c: 'contable-b2b2c' }[lob]); } },
    pnl_mgr: { id: 'pnl-mgr-frame', ready: function (w) { return typeof w.goToView === 'function'; },
      apply: function (w, lob) { if (lob !== 'all') w.goToView(lob); } },
  };
  var lastLob = 'all';   // último LoB elegido (Consolidado / B2B / B2B2C)

  var font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&display=swap';
  document.head.appendChild(font);

  // Paleta oficial Despegar: #550fed (primario), #3d00d1 (oscuro), #976cf6 / #a780ff (claros).
  var css = document.createElement('style');
  css.textContent = [
    // #active-filters: los mismos chips quedan en la línea de contexto de arriba (#ohn-top).
    // #canal-fg: HTML y API ahora se eligen en la barra, como negocios; el toggle queda oculto para que el Hub lo siga leyendo.
    '.hamburger-btn,#nav-backdrop,.filters,#filters-toggle,#ai-links,#active-filters,#canal-fg{display:none!important}',
    // OKR Status abierto por mes (2026-11-05, Diego): sigue a la derecha del Cuadro Resumen, en el espacio que queda, con scroll
    // horizontal propio; el nombre del KR y el peso quedan fijos a la izquierda mientras se corren los meses.
    '.pnl-okr-wrap:has(.okr-monthly) .okr-col{flex:1 1 0;min-width:340px}',
    '.okr-table.okr-monthly th:first-child,.okr-table.okr-monthly td:first-child{position:sticky;left:0;z-index:2;min-width:150px;max-width:190px}',
    '.okr-table.okr-monthly th:first-child{background:#5457D9}',
    '.okr-table.okr-monthly td:first-child{background:var(--surface,#fff)}',
    '.okr-table.okr-monthly tr.okr-total td:first-child{background:#f4f4fc}',
    // Country & Product Performance: las tres tarjetas se reparten el ancho (columnas más juntas) en vez de armar scroll.
    // (con !important: el CSS de la página se carga después y, a igual especificidad, gana)
    '.bkd-grid{overflow-x:visible!important;gap:10px!important}',
    '.bkd-card{flex:1 1 auto!important;min-width:0!important;padding:14px 8px 16px!important}',
    '.bkd-tbl{width:100%!important}',
    '.bkd-tbl thead th,.bkd-tbl td{padding-left:4px!important;padding-right:4px!important}',
    // Layout estable: el contenido no se corre por el panel de filtros (se abre encima).
    // 2026-11-05 (Diego): sin el tope de 1600px del Hub (en pantallas anchas dejaba un hueco a la derecha); un poco más de margen
    // a la izquierda y menos a la derecha.
    'body:not(.ohn-noheader) main{margin-left:0!important;max-width:none!important;padding-left:32px!important;padding-right:14px!important}',
    // Panel de filtros: cajón desde la derecha (al lado del botón "Filtros"), con el fondo atenuado.
    '#pnl-filters-bar{left:auto!important;right:0!important;width:300px!important;padding:0 20px 16px!important;gap:16px!important;',
    '  border-right:none!important;border-left:1px solid #ebe8f3!important;box-shadow:-12px 0 32px rgba(18,17,30,.14)!important;',
    '  z-index:320!important;background:#fff!important;font-family:Poppins,-apple-system,"Segoe UI",sans-serif}',
    '#ohn-fback{display:none;position:fixed;left:0;right:0;bottom:0;top:calc(var(--hdr-h) + ' + NAV_H + 'px);background:rgba(18,17,30,.16);z-index:315}',
    'body.ohn-fopen #ohn-fback{display:block}',
    '.ohn-fhead{position:sticky;top:0;z-index:1;background:#fff;display:flex;align-items:center;justify-content:space-between;padding:16px 0 10px;border-bottom:1px solid #f0edf7}',
    '.ohn-fhead b{font-size:16px;font-weight:600;color:#12111e}',
    '.ohn-fx{border:none;background:none;font-size:22px;line-height:1;color:#6b6b85;cursor:pointer;padding:2px 6px;border-radius:6px}',
    '.ohn-fx:hover{background:#f5f2ff;color:#12111e}',
    '.ohn-ffoot{position:sticky;bottom:-16px;margin-top:auto;background:#fff;padding:12px 0 16px;border-top:1px solid #f0edf7}',
    '.ohn-fdone{width:100%;border:none;border-radius:10px;background:#550fed;color:#fff;font:600 14px Poppins,sans-serif;padding:10px;cursor:pointer}',
    '.ohn-fdone:hover{background:#3d00d1}.ohn-fdone:focus-visible,.ohn-fx:focus-visible{outline:2px solid #a780ff;outline-offset:2px}',
    '#pnl-filters-bar #filters-body{display:flex;flex-direction:column;gap:18px;padding-top:4px}',
    '#pnl-filters-bar .fg label{text-transform:none!important;letter-spacing:0!important;font-size:12.5px!important;font-weight:600!important;color:#6b6b85!important;margin-bottom:6px}',
    '#pnl-filters-bar .pf-btn,#pnl-filters-bar select{border-radius:8px!important;min-height:36px;font-size:13px!important;text-align:left}',
    // Los desplegables de Fecha / País / Producto se abren a la izquierda del cajón, por encima.
    '#period-panel,#pais-panel,#prod-panel{z-index:330!important}',
    // Barra "Filtrar…": se escribe el filtro y se ve lo que entendió antes de aplicarlo.
    '.ohn-tools{display:flex;align-items:center;gap:6px;flex:0 100 300px;min-width:150px}',   // cede ancho antes que las pestañas
    '.ohn-tools[hidden]{display:none}',
    '.ohn-q{position:relative;flex:1 1 auto;min-width:0}',
    '.ohn-q-mic{position:absolute;right:4px;top:50%;transform:translateY(-50%);border:none;background:none;color:#6b6b85;cursor:pointer;padding:3px;border-radius:6px;display:flex}',
    '.ohn-q-mic:hover{background:#f5f2ff;color:#550fed}.ohn-q-mic.rec{color:#cf222e;background:#ffebe9}',
    '.ohn-q-mic:focus-visible{outline:2px solid #a780ff;outline-offset:1px}',
    '.ohn-q input{width:100%;box-sizing:border-box;border:1px solid transparent;border-radius:8px;padding:5px 30px 5px 32px;',
    '  font:13px Poppins,-apple-system,"Segoe UI",sans-serif;color:#12111e;background:#fff}',
    '.ohn-q input:focus{outline:none;border-color:#a780ff;box-shadow:0 0 0 3px rgba(167,128,255,.35)}',
    '.ohn-q::before{content:"";position:absolute;left:11px;top:50%;width:10px;height:10px;margin-top:-7px;border:2px solid #8a88a0;border-radius:50%}',
    '.ohn-q::after{content:"";position:absolute;left:21px;top:50%;width:6px;height:2px;margin-top:4px;background:#8a88a0;transform:rotate(45deg)}',
    '.ohn-q-pop{display:none;position:absolute;left:auto;right:0;width:380px;max-width:90vw;box-sizing:border-box;top:calc(100% + 8px);background:#fff;border:1px solid #ebe8f3;border-radius:12px;',
    '  box-shadow:0 12px 32px rgba(18,17,30,.14);padding:12px 14px;z-index:305;font-size:13px;color:#3d3b52}',
    '.ohn-q.open .ohn-q-pop{display:block}',
    '.ohn-q-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.ohn-q-chip{background:#f0ebff;border:1px solid #d9ccff;border-radius:999px;padding:3px 10px;color:#3d00d1}',
    '.ohn-q-chip i{font-style:normal;color:#6b6b85;margin-right:4px}',
    '.ohn-q-bad{margin-top:8px;color:#9a6700}',
    '.ohn-q-hint{margin-top:10px;font-size:12px;color:#8a88a0}',
    '.ohn-q-ex{cursor:pointer;color:#550fed;text-decoration:underline;margin-right:8px}',
    '#ownia-hubnav{position:sticky;top:var(--hdr-h);z-index:299;height:' + NAV_H + 'px;display:flex;align-items:center;gap:12px;',
    '  padding:0 16px;background:linear-gradient(90deg,#2a0a8f 0%,#3d00d1 100%);border-bottom:1px solid rgba(167,128,255,.35);',
    '  font-family:Poppins,-apple-system,"Segoe UI",sans-serif}',
    'body.ohn-noheader #ownia-hubnav{position:fixed;top:0;left:0;right:0}',
    // El Hub corre el contenido 28px a la derecha en las secciones embebidas (lugar del ☰).
    'body.ohn-noheader main{padding:' + NAV_H + 'px 0 0 0!important;margin-left:0!important}',
    '#ownia-hubnav button{font-family:inherit}',
    '#ownia-hubnav button:focus-visible{outline:2px solid #a780ff;outline-offset:1px}',
    '.ohn-home{flex:none;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:5px 12px;border-radius:8px;',
    '  border:1px solid rgba(255,255,255,.35)}',
    '.ohn-home:hover{background:rgba(255,255,255,.12)}',
    '.ohn-home:focus-visible{outline:2px solid #a780ff;outline-offset:1px}',
    '.ohn-seg{display:flex;background:rgba(255,255,255,.1);border:1px solid rgba(167,128,255,.35);border-radius:9px;padding:3px;flex:none}',
    '.ohn-seg button{border:none;background:transparent;color:rgba(255,255,255,.78);font-size:13px;font-weight:600;padding:5px 14px;',
    '  border-radius:6px;cursor:pointer;white-space:nowrap}',
    '.ohn-seg button:hover{color:#fff}',
    '.ohn-seg button[aria-pressed="true"]{background:#fff;color:#3d00d1;box-shadow:0 1px 4px rgba(0,0,0,.25)}',
    '.ohn-sep{width:1px;height:22px;background:rgba(167,128,255,.4);flex:none}',
    // H2 vs H1 / P&L Contable / P&L Managerial a la derecha, pegadas a "Filtrar…" (2026-11-05).
    '.ohn-tabs{display:flex;gap:2px;flex:none;margin-left:auto}',
    // Fecha · Baseline · Goal · Montos en la barra
    '.ohn-quick{display:flex;align-items:center;gap:10px;flex:0 1 auto;min-width:0}',
    '.ohn-quick[hidden]{display:none}',
    '#ownia-hubnav .ohn-quick .fg{display:flex!important;flex-direction:row!important;align-items:center;gap:5px;margin:0!important;padding:0!important;min-width:0;width:auto!important}',
    '#ownia-hubnav .ohn-quick .fg > label{color:rgba(255,255,255,.75)!important;font-size:11.5px!important;font-weight:600!important;margin:0!important;white-space:nowrap;text-transform:none!important;letter-spacing:0!important}',
    '#ownia-hubnav .ohn-quick .pf-btn,#ownia-hubnav .ohn-quick select{height:28px;min-height:0!important;border:none!important;border-radius:7px!important;background:#fff!important;color:#12111e!important;',
    '  font:600 12.5px Poppins,-apple-system,sans-serif!important;padding:2px 8px!important;cursor:pointer;max-width:170px;width:auto!important;display:flex;align-items:center;gap:6px}',
    '#ownia-hubnav .ohn-quick #f-baseline-bar{width:150px!important}#ownia-hubnav .ohn-quick #f-goal-bar{width:118px!important}',
    '#ownia-hubnav .ohn-quick .pf-btn span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#ownia-hubnav .ohn-quick .canal-toggle{display:flex;width:auto!important;background:rgba(255,255,255,.1);border:1px solid rgba(167,128,255,.35);border-radius:8px;padding:2px;gap:0}',
    '#ownia-hubnav .ohn-quick .canal-toggle button{border:none;background:transparent;color:rgba(255,255,255,.8);font:600 12px Poppins,sans-serif;padding:3px 8px;border-radius:6px;cursor:pointer}',
    '#ownia-hubnav .ohn-quick .canal-toggle button.active{background:#fff;color:#3d00d1}',
    '@media (max-width:1700px){.ohn-tabs .ohn-tab span{display:none}#ownia-hubnav .ohn-quick .fg > label{display:none}}',
    // Con "Filtrar…" y "Filtros" en la barra: en notebooks las pestañas pierden el ícono para que entren todas a la vista.
    '@media (max-width:1500px){.ohn-tabs .ohn-tab span{display:none}.ohn-seg button{padding:5px 10px}}',
    '@media (max-width:1320px){#ownia-hubnav{gap:8px;padding:0 10px}.ohn-seg button{padding:5px 9px}.ohn-tabs .ohn-tab{padding:7px 8px}.ohn-tools{min-width:170px}}',
    '.ohn-tab{border:none;background:transparent;color:rgba(255,255,255,.78);font-size:13px;font-weight:500;padding:7px 11px;',
    '  border-radius:7px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px}',
    '.ohn-tab:hover{color:#fff;background:rgba(255,255,255,.1)}',
    '.ohn-tab[aria-current="page"]{color:#fff;background:#550fed;font-weight:600}',
    // Franja de contexto + KPIs (arriba del Cuadro Resumen).
    '#ohn-top{font-family:Poppins,-apple-system,"Segoe UI",sans-serif;margin:14px 0 16px}',
    '.ohn-ctx{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;color:#3d3b52;margin-bottom:12px}',
    '.ohn-ctx b{color:#12111e;font-weight:600}',
    '.ohn-ctx .ohn-pill{background:#f0ebff;border:1px solid #d9ccff;border-radius:999px;padding:4px 11px}',
    '.ohn-ctx .ohn-period{font-size:15px;font-weight:700;color:#3d00d1;margin-right:4px}',
    '#ownia-hubnav .ohn-filters-btn{flex:none;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;font-size:13px;font-weight:600;',
    '  border-radius:8px;padding:5px 12px;cursor:pointer}',
    '#ownia-hubnav .ohn-filters-btn:hover,#ownia-hubnav .ohn-filters-btn[aria-expanded="true"]{background:#fff;color:#3d00d1}',
    // Grilla de resultados con el formato de la presentación de dirección: métricas en filas,
    // negocios en columnas; cada celda con el valor en USD $M, el YoY y el desvío vs la referencia.
    '.ohn-deck-wrap{overflow-x:auto}',
    '.ohn-deck{display:grid;gap:8px;min-width:720px;max-width:1280px}',   // 2026-11-05: más compacta (en pantallas anchas se leía muy estirada)
    '.ohn-deck .d-org{align-self:center;justify-self:start;background:#1a7f37;color:#fff;font-weight:700;font-size:13px;border-radius:8px;padding:5px 12px}',
    '.ohn-deck .d-period{background:#8a8a93;color:#fff;font-weight:700;font-size:15px;text-align:center;border-radius:999px;padding:4px 12px}',
    '.ohn-deck .d-col{border:2px solid #550fed;background:#f3eeff;color:#550fed;font-weight:700;font-size:16px;text-align:center;border-radius:999px;padding:5px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ohn-deck .d-row{background:#f4f4f7;border-radius:10px;padding:8px 12px;display:flex;flex-direction:column;justify-content:center;gap:2px}',
    '.ohn-deck .d-row b{font-size:15px;color:#3d3b52;font-weight:600}.ohn-deck .d-row span{font-size:13px;color:#6b6b85}',
    '.ohn-deck .d-cell{background:#fafafd;border:1px solid #ebe8f3;border-radius:10px;padding:7px 6px;text-align:center;display:flex;flex-direction:column;justify-content:center}',
    '.ohn-deck .d-val{font-size:26px;font-weight:700;color:#12111e;line-height:1.15;letter-spacing:-.01em}',
    '.ohn-deck .d-l{font-size:12.5px;line-height:1.4;white-space:nowrap}.ohn-deck.wide .d-l{font-size:12px}',
    '.ohn-deck .g{color:#1a7f37}.ohn-deck .a{color:#9a6700}.ohn-deck .r{color:#cf222e}.ohn-deck .n{color:#8a88a0}',
    '.k-pct{font-weight:700}.k-pct.g{color:#1a7f37}.k-pct.a{color:#9a6700}.k-pct.r{color:#cf222e}',
    '.ohn-read{font-size:15px;line-height:1.55;color:#3d3b52;margin:4px 0 16px;max-width:1100px}',
    '.ohn-read span{display:block;margin-top:4px}',
    // "¿Cómo viene el año?": H1 / H2 / FY vs Budget, debajo de la grilla del período.
    '.ohn-yr{margin-top:18px}.ohn-yr h3{font-size:14px;font-weight:700;color:#12111e;margin:0 0 8px}',
    '.ohn-yr-wrap{overflow-x:auto}.ohn-yr table{width:100%;min-width:640px;border-collapse:separate;border-spacing:0 6px}',
    '.ohn-yr th{font-size:12.5px;font-weight:600;color:#6b6b85;text-align:center;padding:0 8px 2px}.ohn-yr th small{display:block;font-size:11px;font-weight:500;color:#8a88a0}',
    '.ohn-yr td{background:#fafafd;border-top:1px solid #ebe8f3;border-bottom:1px solid #ebe8f3;text-align:center;padding:9px 8px;font-size:13px;color:#3d3b52}',
    '.ohn-yr td:first-child,.ohn-yr th:first-child{text-align:left;width:230px}',
    '.ohn-yr td:first-child{background:#f4f4f7;font-weight:600;font-size:14px;border-left:1px solid #ebe8f3;border-radius:10px 0 0 10px}',
    '.ohn-yr td:last-child{border-right:1px solid #ebe8f3;border-radius:0 10px 10px 0}',
    '.ohn-yr b{font-size:17px;color:#12111e;margin-right:8px}.ohn-yr .g{color:#1a7f37}.ohn-yr .a{color:#9a6700}.ohn-yr .r{color:#cf222e}.ohn-yr .n{color:#8a88a0}',
    '.ohn-read b{color:#12111e}',
    '.ohn-facts{margin:18px 0 4px;display:grid;gap:8px}',
    '.ohn-facts p{font-size:14px;color:#3d3b52;margin:0;padding-left:104px;text-indent:-104px}',
    '.ohn-facts p > span{display:inline-block;text-indent:0;width:104px;font-weight:600;color:#12111e}',
    '.ohn-okr-note{font-style:normal;font-size:12px;color:#8a88a0;margin-left:4px}',
    '.ohn-okr-go{font:600 12px Poppins,sans-serif;color:#550fed;background:none;border:none;padding:0 0 0 6px;cursor:pointer;text-decoration:underline}',
    '.ohn-legend{font-size:11.5px;color:#8a88a0;margin-top:8px}',
    // "Ver detalle": el bloque de análisis queda plegado al final.
    '#ohn-detail-wrap{border-top:1px solid #ebe8f3;padding-top:20px}',
    '.ohn-detail-btn{font:600 14px Poppins,sans-serif;color:#550fed;background:#f5f2ff;border:1px solid #d9ccff;border-radius:999px;padding:8px 18px;cursor:pointer}',
    '.ohn-detail-btn:hover{background:#ebe4ff}.ohn-detail-btn:focus-visible{outline:2px solid #a780ff;outline-offset:2px}',
    '.ohn-detail-btn::after{content:" ▾"}#ohn-detail-wrap.open .ohn-detail-btn::after{content:" ▴"}',
    '.ohn-detail-sub{font-size:12.5px;color:#8a88a0;margin:8px 0 0}',
    '#ohn-detail{display:none;margin-top:20px}#ohn-detail-wrap.open #ohn-detail{display:block}',
    // Comparación con B2C (drill-down del año): un gráfico por vez, con selector de métrica.
    '.ohn-ddtabs{display:inline-flex;gap:2px;background:#f4f2f9;border-radius:8px;padding:2px;margin:0 0 12px}',
    '.ohn-ddtabs button{border:none;background:none;font:600 12.5px Poppins,sans-serif;color:#6b6b85;padding:5px 12px;border-radius:6px;cursor:pointer}',
    '.ohn-ddtabs button[aria-pressed="true"]{background:#fff;color:#3d00d1;box-shadow:0 1px 3px rgba(18,17,30,.16)}',
    '.ohn-ddtabs button:focus-visible{outline:2px solid #a780ff;outline-offset:1px}',
    '#drilldown-section[data-dd="gb"] #dd-card-nr,#drilldown-section[data-dd="gb"] #dd-card-oc,',
    '#drilldown-section[data-dd="nr"] #dd-card-gb,#drilldown-section[data-dd="nr"] #dd-card-oc,',
    '#drilldown-section[data-dd="oc"] #dd-card-gb,#drilldown-section[data-dd="oc"] #dd-card-nr{display:none}',
    '.ohn-wf-note{font-size:12px;color:#8a88a0;margin:10px 4px 0}',
    '.pnl-split-btn{margin-left:10px;font:600 11.5px Poppins,sans-serif;color:#550fed;background:none;border:1px solid #d9ccff;border-radius:999px;padding:3px 10px;cursor:pointer}',
    // Secciones embebidas: el Hub les da 100vh (sin header); acá queda la barra arriba.
    '#daily-frame,#weekly-frame,#fixedcost-frame,#news-frame,#industry-frame,#pnl-frame,#pnl-mgr-frame,',
    '#detailcountry-frame,#fvmneg-frame{height:calc(100vh - ' + NAV_H + 'px)!important}',
    '#okr-frame-b2b2c,#okr-frame-b2b{height:calc(100vh - ' + (NAV_H + 42) + 'px)!important}',
  ].join('\n');
  document.head.appendChild(css);

  var current = 'all';

  function label(el) {
    return el.textContent.replace(/\s+/g, ' ').trim();
  }

  function tabFrom(it, key) {
    var t = document.createElement('button');
    t.type = 'button';
    t.className = 'ohn-tab';
    t.dataset.lob = key;
    t.title = label(it);
    var icon = it.querySelector('span');
    if (icon) t.appendChild(icon.cloneNode(true));
    t.appendChild(document.createTextNode(' ' + SHORT[key]));
    t.onclick = function () { it.click(); };
    return t;
  }

  function build() {
    var header = document.querySelector('header');
    if (!header || document.getElementById('ownia-hubnav')) return null;
    var nav = document.createElement('nav');
    nav.id = 'ownia-hubnav';
    nav.setAttribute('aria-label', 'Secciones del P&L Dashboard');

    if (home) {
      var h = document.createElement('a');
      h.className = 'ohn-home';
      h.href = home;
      h.textContent = '🏠 Home';
      h.title = 'Volver al menú principal de B2B Ecosystem';
      nav.appendChild(h);
    }

    var seg = document.createElement('div');
    seg.className = 'ohn-seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Negocio (teclas 1 a 5)');
    LOBS.forEach(function (l, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.lob = l[0];
      b.textContent = l[1];
      b.title = l[1] + ' (tecla ' + (i + 1) + ')';
      b.setAttribute('aria-pressed', 'false');
      b.onclick = function () { pickBiz(l[0]); };
      seg.appendChild(b);
    });
    nav.appendChild(seg);
    var sep = document.createElement('div');
    sep.className = 'ohn-sep';
    nav.appendChild(sep);

    // Fecha, Baseline, Goal y Montos van en la barra (2026-11-05, Diego): son los que más se tocan. Se mueven los nodos del Hub
    // (no copias), así sus handlers siguen igual. En "Filtros" quedan País, Producto y Orgánico.
    var quick = document.createElement('div');
    quick.className = 'ohn-quick';
    [document.getElementById('period-btn-bar'), document.getElementById('f-baseline-bar'), document.getElementById('f-goal-bar'),
      document.querySelector('.numfmt-btn')].forEach(function (el) {
      var fg = el && el.closest('.fg');
      if (fg) quick.appendChild(fg);
    });
    Array.prototype.forEach.call(quick.querySelectorAll('.fg'), function (fg) {   // con la barra angosta la etiqueta se oculta: queda en el tooltip
      var l = fg.querySelector('label');
      if (l) fg.title = l.textContent.trim();
    });
    if (quick.children.length) nav.appendChild(quick);

    var tabs = document.createElement('div');
    tabs.className = 'ohn-tabs';
    PRIMARY.forEach(function (k) {
      var it = document.getElementById('nav-' + k);
      if (it) tabs.appendChild(tabFrom(it, k));
    });

    nav.appendChild(tabs);
    nav.appendChild(toolsBox());
    header.parentNode.insertBefore(nav, header.nextSibling);

    document.addEventListener('keydown', function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var tag = (ev.target && ev.target.tagName) || '';
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || (ev.target && ev.target.isContentEditable)) return;
      var n = LOBS[+ev.key - 1];
      if (n) { ev.preventDefault(); pickBiz(n[0]); }
    });
    return nav;
  }

  // Lleva la sección embebida al LoB de la barra. Reintenta mientras la página carga (FVM Negativo
  // necesita sus datos); una página de Apps Script (otro origen) se deja como está.
  function syncFrame(key, tries) {
    var f = FRAMES[key];
    var el = f && document.getElementById(f.id);
    if (!el || !el.getAttribute('src') || el._ohnLob === lastLob) return;
    if (!el._ohnHooked) {
      el._ohnHooked = true;
      el.addEventListener('load', function () { el._ohnLob = null; if (current === key) syncFrame(key, 0); });
    }
    var w = null;
    try { w = el.contentWindow; if (w && !f.ready(w)) w = null; } catch (e) { return; }   // otro origen
    if (!w) {
      if ((tries || 0) < 60) setTimeout(function () { if (current === key) syncFrame(key, (tries || 0) + 1); }, 500);
      return;
    }
    try { f.apply(w, lastLob); el._ohnLob = lastLob; } catch (e) { /* la sección sigue en su LoB */ }
  }

  function setActive(lob) {
    current = lob;
    if (LOB_NAME[lob]) lastLob = lob;
    if (FRAMES[lob]) syncFrame(lob, 0);
    // Franja de KPIs: solo en las vistas del P&L. Se redibuja acá porque el render del Hub corre
    // dentro de switchLob, antes de que `current` cambie.
    if (LOB_NAME[lob]) renderTop();
    else { var top = document.getElementById('ohn-top'); if (top) top.style.display = 'none'; }
    var nav = document.getElementById('ownia-hubnav');
    if (!nav) return;
    var tools = nav.querySelector('.ohn-tools');
    if (tools) tools.hidden = !LOB_NAME[lob];   // filtran el P&L: en las secciones embebidas no aplican
    var quick = nav.querySelector('.ohn-quick');
    if (quick) quick.hidden = !LOB_NAME[lob];
    syncBiz();
    var tabs = nav.querySelectorAll('.ohn-tabs [data-lob]');
    for (var j = 0; j < tabs.length; j++) {
      if (tabs[j].dataset.lob === lob) tabs[j].setAttribute('aria-current', 'page');
      else tabs[j].removeAttribute('aria-current');
    }
  }

  // ── Franja de contexto + KPIs ──────────────────────────────────────────────────────────────
  function fmtMoney(v) {
    var a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(0) + 'K';
    return s + '$' + a.toFixed(0);
  }
  function fmtPct(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (v > 0 ? '▲ +' : v < 0 ? '▼ −' : '') + Math.abs(v).toFixed(1) + '%';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function renderTop() {
    var chips = document.getElementById('active-filters');
    var st = window._state;
    syncBiz();   // el buscador también cambia de negocio
    if (!chips || !st || !st.pnl || !st.pnl.rows) return;
    var anchor = chips.closest('.sec') || chips.parentElement;
    var top = document.getElementById('ohn-top');
    if (!top) {
      top = document.createElement('div');
      top.id = 'ohn-top';
      anchor.parentNode.insertBefore(top, anchor);
    }
    if (!LOB_NAME[current]) { top.style.display = 'none'; return; }
    top.style.display = '';
    var goal = goalOf(st);
    var periodEl = document.getElementById('period-label-bar');
    var period = periodEl ? label(periodEl) : '';
    // Solo los filtros que recortan algo (los "Todos" no suman) y sin jerga ("Baseline").
    var pills = Array.prototype.map.call(chips.querySelectorAll('.af-chip'), function (c) {
      var t = c.textContent;
      if (/:\s*Todos\s*$/.test(t) || /^Canal:/.test(t)) return '';   // el canal ya es el negocio de la barra
      if (/^Baseline:/.test(t)) {
        var sel = (st.selectedPeriods || []).slice().sort(), last = st.filters && st.filters.lastActuals;
        var closed = sel.length && last && sel[sel.length - 1] <= last;
        var base = /forecast/i.test(t) && !/Actuals/.test(t) ? 'Forecast' : closed ? 'Real' : 'Real + proyección';
        return '<span class="ohn-pill">Baseline: <b>' + esc(base) + '</b></span>';
      }
      return '<span class="ohn-pill">' + c.innerHTML + '</span>';
    }).join('');
    var fBtn = document.querySelector('#ownia-hubnav .ohn-filters-btn');
    if (fBtn) fBtn.setAttribute('aria-expanded', String(!!st.filtersExpanded));
    var html = '<div class="ohn-ctx">' +
      (period ? '<span class="ohn-period">' + esc(period) + '</span>' : '') +
      '<span class="ohn-pill"><b>' + esc(bizName(st) || LOB_NAME[current] || '') + '</b></span>' + pills +
      '</div>';
    html += readingHtml(st, goal) + deckHtml(st, goal, period) + yearHtml();
    html += '<div class="ohn-facts">' + marginHtml(st) + benchHtml(st) + okrHtml(st) + '</div>';
    top.innerHTML = html;
    var okrBtn = top.querySelector('.ohn-okr-go');
    if (okrBtn) okrBtn.onclick = function () {
      var wrap = document.getElementById('ohn-detail-wrap'), col = document.getElementById('okr-col');
      if (wrap && !wrap.classList.contains('open')) wrap.querySelector('.ohn-detail-btn').click();
      if (col) setTimeout(function () { col.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    };
  }

  // ── Barra "Filtrar…" ─────────────────────────────────────────────────────────────────────────
  // Se escribe en lenguaje libre ("bra b2b sep vs fc"); mientras se escribe se ve lo que entendió
  // y lo que no; Enter aplica todo junto (una sola recarga) y Esc vuelve atrás.
  var qBox = null;
  var Q_DIM = { pais: 'País', paisNot: 'Sin', grupo: 'Países', lob: 'Negocio', canal: 'Negocio', goal: 'Comparar', baseline: 'Base', producto: 'Producto', periodo: 'Período' };
  var HISPA = ['Argentina', 'Chile', 'Colombia', 'Peru', 'Ecuador'];
  var Q_EXAMPLES = ['como viene brasil en sep', 'mx b2b vs fc', 'sin brasil', 'hoteles q2', 'h2 vs h1', 'limpiar'];
  // Temas del intérprete de la portada (public/portal-ask.js) que abren una sección de este tablero. contable, accounting y
  // hub son el P&L que ya se está mirando; lo que no está acá se abre desde Home y el preview lo dice.
  var Q_SECTIONS = {
    h2h1: ['h2h1', 'H2 vs H1'], managerial: ['pnl_mgr', 'P&L Managerial'], vs_contable: ['pnl_mgr', 'P&L Managerial'], benchmark: ['bench', 'Benchmark vs B2C'],
  };
  var Q_HERE = { contable: 1, accounting: 1, hub: 1 };

  // "Filtrar…" y "Filtros" viven en la barra fija: siguen a mano al scrollear y un render no los toca.
  function toolsBox() {
    var box = document.createElement('div');
    box.className = 'ohn-tools';
    if (window.OwniaFilters) box.appendChild(searchBox());
    var f = document.createElement('button');
    f.type = 'button';
    f.className = 'ohn-filters-btn';
    f.textContent = 'Filtros';
    f.setAttribute('aria-expanded', 'false');
    f.setAttribute('aria-controls', 'pnl-filters-bar');
    f.onclick = function (ev) {
      ev.stopPropagation();
      if (typeof window.toggleFiltersPanel === 'function') window.toggleFiltersPanel();   // wrap → renderTop
    };
    box.appendChild(f);
    return box;
  }

  function searchBox() {
    if (qBox) return qBox;
    qBox = document.createElement('div');
    qBox.className = 'ohn-q';
    qBox.innerHTML = '<input type="search" autocomplete="off" spellcheck="false" aria-label="Filtrar escribiendo"' +
      ' placeholder="Filtrar… brasil sep vs fc"><button type="button" class="ohn-q-mic" hidden aria-label="Dictar el filtro" title="Dictar">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>' +
      '</button><div class="ohn-q-pop" role="status" aria-live="polite"></div>';
    var input = qBox.querySelector('input'), pop = qBox.querySelector('.ohn-q-pop');
    var mic = qBox.querySelector('.ohn-q-mic');
    function runInput() {
      var plan = planQuery(input.value);
      if (!plan.items.length && !plan.section) return show();
      input.value = '';
      input.blur();
      qBox.classList.remove('open');
      runPlan(plan);
    }
    var show = function () { pop.innerHTML = previewHtml(input.value); qBox.classList.add('open'); };
    input.addEventListener('focus', show);
    input.addEventListener('input', show);
    input.addEventListener('blur', function () { setTimeout(function () { qBox.classList.remove('open'); }, 150); });
    input.addEventListener('keydown', function (ev) {
      ev.stopPropagation();   // las teclas 1/2/3 y Esc del Hub no aplican mientras se escribe
      if (ev.key === 'Escape') { input.value = ''; input.blur(); qBox.classList.remove('open'); }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        runInput();
      }
    });
    // Dictado (Web Speech API, como la portada): al terminar de hablar se aplica solo si entendió algo; si no, queda el
    // texto y el preview para corregir. En Firefox el botón no aparece.
    var Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Speech && window.PortalAsk) {
      mic.hidden = false;
      var rec = null, failed = false, ph = input.placeholder;
      mic.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      mic.addEventListener('click', function () {
        if (rec) { rec.stop(); return; }
        rec = new Speech();
        rec.lang = /^pt/i.test(navigator.language || '') ? 'pt-BR' : 'es-AR';
        rec.interimResults = true;
        failed = false;
        mic.classList.add('rec');
        input.value = '';
        input.placeholder = 'Escuchando…';
        rec.onresult = function (e) {
          var t = '';
          for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
          input.value = window.PortalAsk.fixVoice(t);
          show();
        };
        rec.onerror = function (e) {
          failed = true;
          pop.innerHTML = '<div class="ohn-q-bad">' + (e.error === 'not-allowed' || e.error === 'service-not-allowed'
            ? 'El micrófono está bloqueado: habilitalo en los ajustes del navegador.'
            : e.error === 'no-speech' ? 'No te escuché. Probá de nuevo.' : 'No pude usar el micrófono.') + '</div>';
          qBox.classList.add('open');
        };
        rec.onend = function () {
          mic.classList.remove('rec');
          rec = null;
          input.placeholder = ph;
          if (!failed && input.value.trim()) runInput();
        };
        rec.start();
      });
    }
    pop.addEventListener('mousedown', function (ev) {
      var ex = ev.target.closest('.ohn-q-ex');
      if (!ex) return;
      ev.preventDefault();   // sin perder el foco del input
      input.value = ex.textContent;
      show();
    });
    return qBox;
  }

  // Link desde el buscador de la portada (public/portal-ask.js, 2026-10-30): ?q=<filtros> se aplica como si se
  // hubiera escrito en esta barra (LoB, país, período, comparación); ?sec= abre una sección (por país, H2 vs H1, OKR).
  // Una sola vez, con el primer P&L ya cargado.
  var askLink = (function () {
    try {
      var u = new URLSearchParams(window.location.search);
      return u.get('q') || u.get('sec') ? { q: u.get('q') || '', sec: u.get('sec') || '' } : null;
    } catch (e) { return null; }
  })();
  function applyAskLink() {
    var a = askLink;
    askLink = null;
    if (!a) return;
    if (a.sec === 'h2h1' && typeof window.openH2vsH1 === 'function') return window.openH2vsH1();
    if (a.q) {
      var plan = planQuery(a.q);
      if (plan.items.length || plan.section) runPlan(plan);
    }
  }

  // Traduce el texto a cambios concretos de filtro, resueltos contra el año fiscal del tablero. Lo lee el mismo intérprete
  // que el buscador de la portada: sin relleno ("como viene"), con lo que el dictado escribe mal y con los temas.
  function planQuery(text) {
    var F = window.OwniaFilters, A = window.PortalAsk;
    var a = A ? A.parse(text) : null;
    var r = F.parse(a ? a.filterText : text);
    var plan = { items: [], unknown: (a ? a.unknown : r.unknown).slice(), section: null, away: false };
    if (a) {
      // El intérprete no pasa "limpiar" en filterText: no es un filtro para mandar a otro tablero.
      F.parse(A.fixVoice(text)).matches.forEach(function (m) { if (m.dim === 'accion') r.matches.push(m); });
      a.topics.forEach(function (t) {
        if (t === 'run_rate') r.matches.push({ dim: 'goal', value: 'runRate', label: 'vs Run Rate', text: 'run rate' });
        else if (t === 'api') r.matches.push({ dim: 'canal', value: 'may', label: 'API', text: 'api' });
        else if (Q_SECTIONS[t]) plan.section = plan.section || Q_SECTIONS[t];
        else if (!Q_HERE[t]) plan.away = true;
      });
      if (a.freq) plan.away = plan.away || !a.topics.length;
    }
    var fy = window.FY_MONTHS || [], months = [];
    r.matches.forEach(function (m) {
      if (m.not) {
        (m.dim === 'grupo' ? HISPA : [m.value]).forEach(function (c) { plan.items.push({ dim: 'paisNot', value: c, label: m.label }); });
        return;
      }
      if (m.dim === 'periodo') {
        var p = m.value, got = [];
        if (p.kind === 'month') got = fy.filter(function (ym) { return ym.slice(5) === p.mm && (!p.yy || ym.slice(2, 4) === p.yy); });
        else if (p.kind === 'ym') got = fy.indexOf(p.ym) >= 0 ? [p.ym] : [];
        else if (p.kind === 'q') got = fy.slice((p.n - 1) * 3, p.n * 3);
        else if (p.kind === 'h') got = fy.slice((p.n - 1) * 6, p.n * 6);
        else if (p.kind === 'fy') got = fy.slice();
        else if (p.kind === 'ytd') {
          var last = window._state && window._state.filters && window._state.filters.lastActuals;
          got = fy.filter(function (ym) { return !last || ym <= last; });
        }
        if (got.length) months = months.concat(got);
        else plan.unknown.push(m.text + ' (fuera del año fiscal)');
        return;
      }
      if (m.dim === 'grupo') {
        HISPA.forEach(function (c) { plan.items.push({ dim: 'pais', value: c, label: m.label }); });
        return;
      }
      plan.items.push(m);
    });
    if (months.length) {
      // Varios meses o trimestres = el rango completo entre el primero y el último ("jul a sep").
      months.sort();
      var range = fy.filter(function (ym) { return ym >= months[0] && ym <= months[months.length - 1]; });
      var ys = window._ymShort_ || function (x) { return x; };
      plan.items.push({ dim: 'periodo', value: range, label: range.length === 1 ? ys(range[0]) : ys(range[0]) + ' – ' + ys(range[range.length - 1]) });
    }
    return plan;
  }

  function previewHtml(text) {
    if (!window.OwniaFilters.normalize(text)) {
      return '<div>Escribí país, LoB, producto, período o contra qué comparar.</div>' +
        '<div class="ohn-q-hint">Probá: ' + Q_EXAMPLES.map(function (e) { return '<span class="ohn-q-ex">' + esc(e) + '</span>'; }).join('') + '</div>';
    }
    var plan = planQuery(text), seen = {};
    var chips = plan.items.filter(function (it) {
      var k = it.dim + '|' + it.label;
      if (seen[k]) return false;
      return (seen[k] = true);
    }).map(function (it) {
      if (it.dim === 'accion') return '<span class="ohn-q-chip">Quitar filtros de país y producto</span>';
      return '<span class="ohn-q-chip"><i>' + esc(Q_DIM[it.dim] || it.dim) + '</i>' + esc(it.label) + '</span>';
    }).join('');
    if (plan.section) chips += '<span class="ohn-q-chip"><i>Abrir</i>' + esc(plan.section[1]) + '</span>';
    return (chips ? '<div class="ohn-q-chips">' + chips + '</div>' : plan.away ? '' : '<div>No reconocí ningún filtro.</div>') +
      (plan.away ? '<div class="ohn-q-bad">Eso no está en este tablero: buscalo desde Home.</div>' : '') +
      (plan.unknown.length ? '<div class="ohn-q-bad">No usé: ' + esc(plan.unknown.join(', ')) + '</div>' : '') +
      (chips ? '<div class="ohn-q-hint">Enter para aplicar · Esc para cancelar</div>' : '');
  }

  // Aplica los filtros y, si el texto pedía una sección, la abre.
  function runPlan(plan) {
    applyPlan(plan);
    var s = plan.section && plan.section[0];
    if (!s) return;
    if (s === 'h2h1') { if (typeof window.openH2vsH1 === 'function') window.openH2vsH1(); return; }
    if (s === 'bench') {
      window.goToSection(lastLob);
      var wrap = document.getElementById('ohn-detail-wrap'), el = document.getElementById('comp-pnl-section');
      if (wrap && !wrap.classList.contains('open')) wrap.querySelector('.ohn-detail-btn').click();
      if (el) setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
      return;
    }
    window.goToSection(s);
  }

  // Aplica el plan con los mismos estados que usan los filtros del Hub, y recarga una sola vez.
  function applyPlan(plan) {
    var st = window._state, by = {};
    plan.items.forEach(function (it) { (by[it.dim] = by[it.dim] || []).push(it.value); });
    var last = function (d) { return by[d][by[d].length - 1]; };
    var dataChanged = false;
    if (by.accion) {
      window._selectedPaises = [];
      window._selectedProducto = 'all';
      dataChanged = true;
    }
    if (by.pais || by.paisNot) {
      // "sin brasil" = todos menos Brasil; "hispa sin chile" = Hispa menos Chile.
      var order = window.PAISES_ORDER || [], not = by.paisNot || [];
      window._selectedPaises = order.filter(function (p) { return (!by.pais || by.pais.indexOf(p) >= 0) && not.indexOf(p) < 0; });
      dataChanged = true;
    }
    if (by.producto) { window._selectedProducto = last('producto'); dataChanged = true; }
    if (by.periodo) {
      st.selectedPeriods = last('periodo');
      window._okrHalfManual = false;
      if (typeof window.buildPeriodPicker === 'function') window.buildPeriodPicker();
      if (typeof window.updatePeriodLabel === 'function') window.updatePeriodLabel();
      if (typeof window._syncOKRHalf_ === 'function') window._syncOKRHalf_();
      dataChanged = true;
    }
    if (by.baseline) {
      st.baselineSource = last('baseline');
      var bs = document.getElementById('f-baseline-bar');
      if (bs) bs.value = st.baselineSource;
      dataChanged = true;
    }
    var goalChanged = false;
    if (by.goal && last('goal') !== st.goal) {
      st.goal = last('goal');
      if (st.fcSource === 'btb') { st.fcSource = ''; dataChanged = true; }   // la barra no ofrece el BTB
      if (st.rrSource === 'lrr') { st.rrSource = ''; dataChanged = true; }   // ni el Last Run Rate
      ['f-goal-bar', 'f-goal'].forEach(function (id) { var s = document.getElementById(id); if (s) s.value = st.goal; });
      if (typeof window._syncOrganicUI_ === 'function') window._syncOrganicUI_();
      goalChanged = true;
    }
    var lob = by.lob ? last('lob') : null;
    // HTML / API existen solo en B2B: el canal lleva a B2B; "b2b" a secas desde HTML o API vuelve al total de B2B.
    var canal = by.canal ? last('canal') : lob === 'b2b' && st.canal !== 'all' ? 'all' : null;
    if (canal) {
      st.canal = canal;
      lob = 'b2b';
      Array.prototype.forEach.call(document.querySelectorAll('#canal-fg .canal-toggle button'), function (b) {
        b.classList.toggle('active', b.dataset.c === st.canal);
      });
      dataChanged = true;
    }
    syncFilterLabels();
    if (lob && lob !== st.lob) return window.goToSection(lob);   // switchLob recarga con los filtros nuevos
    if (dataChanged && typeof window.reload === 'function') return window.reload();
    if (goalChanged && typeof window.render === 'function') window.render();
  }

  // Los textos de los botones del panel, como los dejan _paisApply y el selector de producto.
  function syncFilterLabels() {
    var ps = window._selectedPaises || [], disp = window.PAISES_DISPLAY || {};
    var pl = document.getElementById('pais-label-bar');
    if (pl) pl.textContent = !ps.length ? 'Todos los países' : ps.length === 1 ? (disp[ps[0]] || ps[0]) : ps.length + ' países';
    var prod = (window.PRODUCTOS_ORDER || []).filter(function (p) { return p.val === window._selectedProducto; })[0];
    var prl = document.getElementById('prod-label-bar');
    if (prl && prod) prl.textContent = prod.lbl;
  }

  // ── Cajón de filtros ─────────────────────────────────────────────────────────────────────────
  function setupDrawer() {
    var bar = document.getElementById('pnl-filters-bar');
    if (!bar || document.getElementById('ohn-fback')) return;
    var back = document.createElement('div');
    back.id = 'ohn-fback';
    back.addEventListener('click', closeDrawer);
    document.body.appendChild(back);
    var head = document.createElement('div');
    head.className = 'ohn-fhead';
    head.innerHTML = '<b>Filtros</b><button type="button" class="ohn-fx" aria-label="Cerrar filtros">×</button>';
    head.querySelector('button').onclick = closeDrawer;
    bar.insertBefore(head, bar.firstChild);
    var foot = document.createElement('div');
    foot.className = 'ohn-ffoot';
    foot.innerHTML = '<button type="button" class="ohn-fdone">Listo</button>';
    foot.querySelector('button').onclick = closeDrawer;
    bar.appendChild(foot);
    var REN = { 'Baseline': 'Baseline', 'Goal (referencia)': 'Goal', 'Nominales': 'Montos', 'Organic': 'Orgánico (tipo de cambio constante)' };
    Array.prototype.forEach.call(bar.querySelectorAll('#org-toggle button'), function (b) {
      b.textContent = b.dataset.o === 'yes' ? 'Sí' : 'No';
    });
    Array.prototype.forEach.call(bar.querySelectorAll('.fg > label'), function (l) {
      var t = l.textContent.trim();
      if (REN[t]) l.textContent = REN[t];
    });
    var ob = bar.querySelector('#f-baseline-bar option[value="baseline"]');
    if (ob) ob.textContent = 'Real + proyección (Run Rate)';
    var ol = bar.querySelector('#f-goal-bar option[value="lastYear"]');
    if (ol) ol.textContent = 'Año pasado (LY)';
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !document.body.classList.contains('ohn-fopen')) return;
      var floating = ['period-panel', 'pais-panel', 'prod-panel'].map(function (id) { return document.getElementById(id); })
        .filter(function (p) { return p && p.style.display !== 'none'; });
      if (floating.length) floating.forEach(function (p) { p.style.display = 'none'; });
      else closeDrawer();
    });
  }
  function closeDrawer() {
    if (window._state && window._state.filtersExpanded && typeof window.toggleFiltersPanel === 'function') window.toggleFiltersPanel();
  }
  function syncDrawer(focus) {
    var bar = document.getElementById('pnl-filters-bar');
    var open = !!(bar && window._state && window._state.filtersExpanded && bar.style.display !== 'none');
    document.body.classList.toggle('ohn-fopen', open);
    if (open && focus === true && !bar.contains(document.activeElement)) {
      var first = bar.querySelector('.pf-btn');
      if (first) first.focus({ preventScroll: true });
    }
  }
  // Fecha / País / Producto: el Hub los abre a la derecha del botón; con el cajón a la derecha
  // quedarían fuera de la pantalla, así que van a su izquierda.
  function placeFloating(panelId) {
    var panel = document.getElementById(panelId), bar = document.getElementById('pnl-filters-bar');
    if (!panel || !bar || panel.style.display === 'none') return;
    var left = bar.getBoundingClientRect().left - panel.offsetWidth - 8;
    panel.style.left = Math.max(8, left) + 'px';
  }

  // Grilla de resultados (formato de la presentación de dirección). Consolidado: B2B-MIN, B2B-MAY,
  // B2B2C y Total; B2B o B2B2C: el total del negocio y sus grupos de países (los que están en cero
  // en las tres métricas no se muestran). Cada celda: valor en USD $M, YoY y desvío vs la referencia
  // elegida (con "Last Year" elegido, el YoY ya está arriba y el desvío es vs Budget).
  var DECK_ALL = [['MIN', 'HTML'], ['MAY', 'API'], ["WL's", 'B2B2C'], ['Total', 'Total']];
  var ABS_KEY = { budget: 'varBudAbs', runRate: 'varRRAbs', forecast: 'varFcAbs' };
  function fmtM(v) {
    var m = (+v || 0) / 1e6, d = Math.abs(m) < 1 && m !== 0 ? 2 : 1;
    return (m < 0 ? '−' : '') + Math.abs(m).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function pctShort(v) {
    var a = Math.abs(v);
    return (v >= 0 ? '+' : '−') + (a < 1 ? a.toFixed(1) : a.toFixed(0)) + '%';
  }
  function deckCols(st) {
    var g = st.pnl.groups, ti = g.length - 1;
    if (st.lob === 'all') {
      var cols = DECK_ALL.map(function (c) { return { i: c[0] === 'Total' ? ti : g.indexOf(c[0]), name: c[1] }; });
      if (cols.every(function (c) { return c.i >= 0; })) return cols;
    }
    var rows = st.pnl.rows.filter(function (r) { return KPIS.some(function (k) { return k[0] === r.id; }); });
    var out = [{ i: ti, name: st.lob === 'all' ? 'Total' : bizName(st) }];
    g.slice(0, ti).forEach(function (name, i) {
      var used = rows.some(function (r) { var c = r.cols[i] || {}; return +c.actual || +c.budget || +c.lyVal; });
      if (used) out.push({ i: i, name: name === 'OPS+RG' ? 'OPS + RG' : name });
    });
    return out;
  }
  function deckHtml(st, goal, period) {
    var cols = deckCols(st), g2 = st.goal === 'lastYear' ? 'budget' : st.goal;
    var vsName = (g2 === st.goal ? goalOf(st) : GOALS[g2])[1], pctKey = GOALS[g2][0], absKey = ABS_KEY[g2];
    var tip = 'vs ' + vsName + ': verde ≥ 0% · ámbar entre −5% y 0% · rojo &lt; −5%';
    var html = '<div class="ohn-deck-wrap"><div class="ohn-deck' + (cols.length > 4 ? ' wide' : '') + '" style="grid-template-columns:minmax(230px,260px) repeat(' + cols.length + ',minmax(0,1fr))">' +
      (st.organic ? '<span class="d-org" title="Tipo de cambio constante">Organic</span>' : '<span></span>') +
      '<div class="d-period" style="grid-column:2 / -1">' + esc(period || '') + '</div><span></span>' +
      cols.map(function (c) { return '<div class="d-col" title="' + esc(c.name) + '">' + esc(c.name) + '</div>'; }).join('');
    KPIS.forEach(function (k) {
      var row = st.pnl.rows.filter(function (r) { return r.id === k[0]; })[0];
      if (!row) return;
      html += '<div class="d-row"><b>' + esc(k[1]) + '</b><span>USD $M</span>' +
        '</div>';
      cols.forEach(function (col) {
        var c = row.cols[col.i] || {};
        var yoy = +c.lyVal ? c.yoyPct : null, pct = c[pctKey], abs = c[absKey];
        html += '<div class="d-cell"><div class="d-val">' + fmtM(c.actual) + '</div>' +
          '<div class="d-l ' + (isFinite(yoy) && yoy !== null ? (yoy >= 0 ? 'g' : 'r') + '">' + pctShort(yoy) : 'n">—') + ' YoY</div>' +
          '<div class="d-l ' + (isFinite(pct) && pct !== null ? semaforo(pct) + '" title="' + tip + '">' + moneyDelta(abs || 0) + ' (' + pctShort(pct) + ')' : 'n">—') +
          ' vs ' + esc(vsName) + '</div></div>';
      });
    });
    return html + '</div></div>';
  }

  // Margen: NR y OC como % del GB, con la diferencia en puntos vs Budget y vs el año pasado.
  function marginHtml(st) {
    var i = st.pnl.groups.length - 1, by = {};
    st.pnl.rows.forEach(function (r) { by[r.id] = r.cols[i]; });
    if (!by.gb || !by.gb.actual) return '';
    var pp = function (v) {
      if (v === null || !isFinite(v)) return '—';
      return '<b class="k-pct ' + (v >= 0 ? 'g' : 'r') + '">' + (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + ' pp</b>';
    };
    var one = function (id, name) {
      var c = by[id];
      if (!c) return '';
      var m = c.actual / by.gb.actual * 100;
      var mb = by.gb.budget ? c.budget / by.gb.budget * 100 : null, ml = by.gb.lyVal ? c.lyVal / by.gb.lyVal * 100 : null;
      return name + ' <b>' + m.toFixed(1) + '%</b> del GB (' + pp(mb === null ? null : m - mb) + ' vs Budget · ' + pp(ml === null ? null : m - ml) + ' vs LY)';
    };
    return '<p><span>Margen</span>' + one('nr', 'Net Revenue') + ' · ' + one('oc', 'Operating Contribution') + '.</p>';
  }

  // OKR, una línea (el detalle está en "Ver detalle"). Siempre los dos semestres: H1 cerrado y H2, que es el que está en juego,
  // aunque el período elegido sea de H1. El H2 del Hub es contable: real + proyección contra Budget.
  function okrHtml(st) {
    var all = st.okrAll;
    if (!all && !st.okr) return '';
    // Por ahora HTML y API ven los dos OKR: el de B2B y KR Global B2B API (Diego, 2026-10-31).
    var keys = st.lob === 'b2b2c' ? ['b2b2c'] : st.lob === 'b2b' ? ['b2b', 'globales'] : ['b2b2c', 'b2b', 'globales'];
    var line = function (o) {
      return keys.filter(function (k) { return o && o[k] && isFinite(o[k].halfTotal) && o[k].halfTotal !== null; }).map(function (k) {
        var v = o[k].halfTotal, cls = v >= 100 ? 'g' : v >= 80 ? 'a' : 'r';
        return esc(o[k].label) + ' <b class="k-pct ' + cls + '">' + (v < 70 ? '&lt;70' : Math.min(v, 130).toFixed(0)) + '%</b>';
      }).join(' · ');
    };
    var btn = ' <button type="button" class="ohn-okr-go">Ver KRs</button>';
    if (!all) {
      var one = line(st.okr), h = window._okrHalf ? ' ' + window._okrHalf : '';
      return one ? '<p><span>OKR' + esc(h) + '</span>' + one + btn + '</p>' : '';
    }
    var h2 = line(all.H2), h1 = line(all.H1);
    return (h2 ? '<p><span>OKR H2</span>' + h2 + ' <i class="ohn-okr-note">real + proyección</i>' + btn + '</p>' : '') +
      (h1 ? '<p><span>OKR H1</span>' + h1 + ' <i class="ohn-okr-note">cerrado</i>' + (h2 ? '' : btn) + '</p>' : '');
  }

  // Semáforo único (mismo criterio que _deltaState_ del Hub): verde ≥ 0%, ámbar −5% a 0%, rojo < −5%.
  function semaforo(v) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    return v < AMBER_FROM ? 'r' : v <= -0.05 ? 'a' : 'g';
  }
  function pctTxt(v, strong) {
    if (v === null || v === undefined || !isFinite(v)) return '<b class="k-pct">—</b>';
    var a = Math.abs(v), txt = (v >= 0 ? '+' : '−') + (a < 10 ? a.toFixed(1) : a.toFixed(0)) + '%';
    return '<b class="k-pct ' + (strong ? semaforo(v) : (v >= 0 ? 'g' : 'r')) + '">' + txt + '</b>';
  }
  function moneyDelta(v) {
    return (v >= 0 ? '+' : '−') + fmtMoney(Math.abs(v)).replace(/^−/, '');
  }

  // Año a la fecha (meses con real) y cierre del año fiscal (real + proyección) contra el Budget,
  // de la evolución mensual (_state.evo: mismos filtros de país y producto que el resto).
  function fyStats(id) {
    var st = window._state, e = st && st.evo, last = st && st.filters && st.filters.lastActuals;
    var FY = window.FY_MONTHS;
    if (!e || !e.periods || !FY || !last) return null;
    var m = (e.metrics || []).filter(function (x) { return x.id === id; })[0];
    if (!m) return null;
    var s = { h1: { a: 0, b: 0 }, h2: { a: 0, b: 0 }, fy: { a: 0, b: 0 } }, n = 0;
    e.periods.forEach(function (ym, i) {
      if (ym < FY[0] || ym > FY[11]) return;
      var a = m.actuals[i], b = m.budget[i];
      if (a === null || a === undefined || b === null || b === undefined) return;
      var half = ym <= FY[5] ? s.h1 : s.h2;
      half.a += a; half.b += b; s.fy.a += a; s.fy.b += b; n++;
    });
    if (!n || !s.fy.b) return null;
    var done = function (x) { x.pct = x.b ? (x.a - x.b) / Math.abs(x.b) * 100 : null; x.delta = x.a - x.b; return x; };
    var mon = function (ym) { var L = window.MONTH_LABELS || {}; return String(L[ym.split('-')[1]] || '').slice(0, 3).toLowerCase(); };
    return {
      h1: done(s.h1), h2: done(s.h2), fy: done(s.fy),
      h1Lbl: mon(FY[0]) + '–' + mon(FY[5]), h2Lbl: mon(FY[6]) + '–' + mon(FY[11]), fyLbl: 'FY' + String(FY[11]).slice(2, 4),
      h1Open: last < FY[5], h2Started: last >= FY[6],
    };
  }

  // "¿Cómo viene el año?": H1 / H2 / año contra Budget. No depende del período elegido; sí de los filtros de país y producto.
  function yearHtml() {
    var rows = KPIS.map(function (k) { return [k[1], fyStats(k[0])]; }).filter(function (r) { return r[1]; });
    if (!rows.length) return '';
    var f = rows[0][1];
    var cell = function (x) {
      return '<td><b>' + fmtM(x.a) + '</b><span class="' + (x.pct === null ? 'n' : semaforo(x.pct)) + '">' +
        (x.pct === null ? '—' : moneyDelta(x.delta) + ' (' + pctShort(x.pct) + ')') + '</span></td>';
    };
    return '<div class="ohn-yr"><h3>¿Cómo viene el año? <span style="font-weight:500;color:#6b6b85">vs Budget · USD $M</span></h3><div class="ohn-yr-wrap"><table><thead><tr><th></th>' +
      '<th>H1 <small>' + esc(f.h1Lbl) + ' · ' + (f.h1Open ? 'real + proyección' : 'real') + '</small></th>' +
      '<th>H2 <small>' + esc(f.h2Lbl) + ' · ' + (f.h2Started ? 'real + proyección' : 'proyección (Run Rate)') + '</small></th>' +
      '<th>' + esc(f.fyLbl) + ' <small>cierre proyectado</small></th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td>' + cell(r[1].h1) + cell(r[1].h2) + cell(r[1].fy) + '</tr>'; }).join('') +
      '</tbody></table></div></div>';
  }

  // Línea de la frase de lectura: el negocio (o grupo) con peor Operating Contribution, que el total puede tapar.
  function worstLine(st, goal) {
    var g2 = st.goal === 'lastYear' ? 'budget' : st.goal, vs = (g2 === st.goal ? goal : GOALS[g2])[1];
    var pctKey = GOALS[g2][0], absKey = ABS_KEY[g2], ti = st.pnl.groups.length - 1;
    var row = function (id) { return st.pnl.rows.filter(function (r) { return r.id === id; })[0]; };
    var oc = row('oc'), nr = row('nr');
    if (!oc) return '';
    var worst = null;
    deckCols(st).forEach(function (c) {
      var x = c.i !== ti && oc.cols[c.i];
      if (x && isFinite(x[absKey]) && isFinite(x[pctKey]) && x[pctKey] < AMBER_FROM && x[absKey] < 0 && (!worst || x[absKey] < worst.x[absKey])) worst = { c: c, x: x };
    });
    if (!worst) return '';
    var part = function (name, x) { return name + ' ' + moneyDelta(x[absKey]) + ' (' + pctTxt(x[pctKey], true) + ')'; };
    var n = nr && nr.cols[worst.c.i];
    return '<span>Lo que más pesa en contra: <b>' + esc(worst.c.name) + '</b>, ' +
      (n && isFinite(n[absKey]) && n[absKey] < 0 && isFinite(n[pctKey]) ? part('Net Revenue', n) + ' y ' : '') +
      part('Operating Contribution', worst.x) + ' vs ' + esc(vs) + '.</span>';
  }

  // Línea de la frase: cómo viene el Operating Contribution en el año, para que un H1 bueno no tape un H2 flojo.
  function yearLine() {
    var f = fyStats('oc');
    if (!f || f.h1.pct === null || f.h2.pct === null) return '';
    var h2 = 'H2 ' + (f.h2Started ? 'viene' : 'proyecta') + ' ' + pctTxt(f.h2.pct, true);
    var cover = f.h1.pct >= 0 && f.h2.pct < 0 && f.fy.pct >= 0;
    return '<span><b>En el año</b>, Operating Contribution vs Budget: H1 ' + pctTxt(f.h1.pct, true) + ', ' + h2 + ' y cierre ' + esc(f.fyLbl) + ' ' + pctTxt(f.fy.pct, true) +
      (cover ? ': H2 queda abajo y lo compensa lo ganado en H1.' : '.') + '</span>';
  }

  // Frase de lectura: desvío de GB del período con los 3 grupos que más lo explican, y qué pasa con
  // la rentabilidad (NR y OC) en la misma comparación.
  function readingHtml(st, goal) {
    var totalIdx = st.pnl.groups.length - 1;
    var absKey = { budget: 'varBudAbs', runRate: 'varRRAbs', forecast: 'varFcAbs', lastYear: 'varLYAbs' }[st.goal] || 'varBudAbs';
    var tot = {};
    st.pnl.rows.forEach(function (r) { var c = r.cols[totalIdx]; if (c) tot[r.id] = c[absKey]; });
    if (!isFinite(tot.gb)) return '';
    var gbWf = st.wf && (st.wf.metrics || []).filter(function (m) { return m.id === 'gb'; })[0];
    var drivers = '';
    if (gbWf && gbWf.byGroup) {
      var neg = tot.gb < 0;
      // Contra la misma referencia que el total (g.delta es siempre vs Budget). Igual que el waterfall del Hub: sin Forecast cargado, Budget.
      var gRef = function (g) {
        return st.goal === 'forecast' ? (g.forecast || g.budget) : st.goal === 'runRate' ? g.runRate : g.budget;
      };
      var gs = gbWf.byGroup.map(function (g) {
        return { label: g.label, d: st.goal === 'lastYear' ? (g.baseYoY !== null && isFinite(g.baseYoY) ? g.baseline - g._yoyAbs : NaN) : g.baseline - (gRef(g) || 0) };
      }).filter(function (g) {
        // Solo los que pesan (≥ 10% del desvío total): "Brasil −$40K" es ruido en la frase.
        return isFinite(g.d) && (neg ? g.d < 0 : g.d > 0) && Math.abs(g.d) >= Math.abs(tot.gb) * 0.1;
      })
        .sort(function (a, b) { return neg ? a.d - b.d : b.d - a.d; }).slice(0, 3);
      if (gs.length) drivers = ': ' + gs.map(function (g) { return esc(g.label) + ' ' + moneyDelta(g.d); }).join(', ');
    }
    var vsTxt = 'vs ' + goal[1];
    var gbc = (st.pnl.rows.filter(function (r) { return r.id === 'gb'; })[0] || {}).cols;
    gbc = gbc && gbc[totalIdx];
    var extra = '';
    if (gbc && st.goal !== 'forecast' && isFinite(gbc.varFcPct)) extra = ' (' + pctTxt(gbc.varFcPct) + ' vs Forecast)';
    var s = '<b>Gross Bookings ' + moneyDelta(tot.gb) + ' ' + esc(vsTxt) + '</b>' + extra + drivers + '.';
    var nr = tot.nr, oc = tot.oc;
    if (isFinite(nr) && isFinite(oc)) {
      var both = 'En el total, Net Revenue ' + moneyDelta(nr) + ' y Operating Contribution ' + moneyDelta(oc);
      if (tot.gb < 0 && nr >= 0 && oc >= 0) s += ' ' + both + ': menos volumen que el plan, con mejor margen.';
      else if (tot.gb >= 0 && nr >= 0 && oc >= 0) s += ' ' + both + ': los tres indicadores le ganan al ' + esc(goal[1]) + '.';
      else if (tot.gb >= 0 && oc < 0) s += ' ' + both + ': crece el volumen, pero la rentabilidad queda abajo.';
      else s += ' ' + both + '.';
    }
    return '<p class="ohn-read">' + s + worstLine(st, goal) + yearLine() + '</p>';
  }

  // Benchmark vs B2C en una línea: crecimiento del GB contra B2C y peso en Despegar (de _state.compPnl).
  function benchHtml(st) {
    var cp = st.compPnl;
    if (!cp || !cp.groups || !cp.rows) return '';
    if (st.lob === 'b2b' && st.canal !== 'all') return '';   // con canal, ese cuadro filtra también B2C y el total: la comparación no da
    var me = { all: 'B2B + B2B2C', b2b: 'B2B', b2b2c: 'WLs (B2B2C)' }[st.lob];
    var iMe = cp.groups.indexOf(me), iB2c = cp.groups.indexOf('B2C'), iTot = cp.groups.indexOf('Total Portfolio');
    var row = function (id) { return cp.rows.filter(function (r) { return r.id === id; })[0]; };
    var gb = row('gb'), oc = row('oc');
    if (!gb || iMe < 0 || iB2c < 0) return '';
    var a = gb.cols[iMe], b = gb.cols[iB2c];
    if (!a || !b || !isFinite(a.yoyPct) || !isFinite(b.yoyPct)) return '';
    var share = function (r) {
      return r && iTot >= 0 && r.cols[iTot] && r.cols[iTot].actual ? r.cols[iMe].actual / r.cols[iTot].actual * 100 : null;
    };
    var sg = share(gb), so = share(oc);
    var name = { all: 'B2B + B2B2C', b2b: 'B2B', b2b2c: 'B2B2C' }[st.lob];
    return '<p><span>Contra B2C</span>El GB de ' + esc(name) + ' crece ' + pctTxt(a.yoyPct) +
      ' vs ' + pctTxt(b.yoyPct) + ' de B2C' +
      (sg !== null ? ' · somos el <b>' + sg.toFixed(0) + '%</b> del GB' + (so !== null ? ' y el <b>' + so.toFixed(0) + '%</b> del Operating Contribution' : '') + ' de Despegar' : '') +
      '.</p>';
  }

  // ── Vista de entrada y "Ver detalle" ───────────────────────────────────────────────────────
  // Arriba: KPIs, lectura, benchmark, waterfall de GB por grupo y evolución. El resto (Cuadro
  // Resumen con OKR, waterfalls de NR y OC, tablas por país, benchmark completo, drill-down) se
  // mueve a un bloque plegado al final. Se mueven nodos, no se copian: el Hub los sigue llenando.
  var DETAIL_KEY = 'ohn-hub-detail';
  function detailOpen() { try { return localStorage.getItem(DETAIL_KEY) === '1'; } catch (e) { return false; } }
  // Drill-down del año (actual, Budget y LY contra B2C): selector de métrica en vez de tres gráficos seguidos. Los tres se siguen
  // dibujando; el selector solo elige cuál se ve. Abre en Operating Contribution, como el waterfall.
  function setupDrillTabs() {
    var sec = document.getElementById('drilldown-section'), grid = sec && sec.querySelector('.drilldown-grid');
    if (!grid || sec.querySelector('.ohn-ddtabs')) return;
    var box = document.createElement('div');
    box.className = 'ohn-ddtabs';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Métrica del gráfico');
    KPIS.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.dd = k[0];
      b.textContent = k[1];
      box.appendChild(b);
    });
    var pick = function (id) {
      sec.setAttribute('data-dd', id);
      Array.prototype.forEach.call(box.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.dd === id)); });
      setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 30);   // Chart.js en nodos que estaban ocultos
    };
    box.addEventListener('click', function (ev) { if (ev.target.dataset.dd) pick(ev.target.dataset.dd); });
    sec.insertBefore(box, grid);
    pick('oc');
  }
  function foldDetail() {
    var evoSec = document.getElementById('chart-evo') && document.getElementById('chart-evo').closest('.sec');
    var main = document.querySelector('main');
    if (!evoSec || !main) return;
    var wrap = document.getElementById('ohn-detail-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'sec';   // el Hub muestra/oculta los .sec del P&L al cambiar de sección
      wrap.id = 'ohn-detail-wrap';
      wrap.innerHTML = '<button type="button" class="ohn-detail-btn" aria-expanded="false" aria-controls="ohn-detail"></button>' +
        '<p class="ohn-detail-sub">Cuadro Resumen y OKR · Gross Bookings y Net Revenue por grupo y por concepto · ' +
        'benchmark completo vs B2C · evolución comparada con B2C</p><div id="ohn-detail"></div>';
      evoSec.parentNode.insertBefore(wrap, evoSec.nextSibling);
      var det = wrap.querySelector('#ohn-detail');
      var pnlSec = document.getElementById('pnl-title') && document.getElementById('pnl-title').closest('.sec');
      var more = document.createElement('div'); more.id = 'ohn-wf-more'; more.className = 'wf-grid';
      // Las tablas de YoY quedan en su lugar del Hub, debajo del gráfico de evolución: se leen de corrido.
      [pnlSec, more, document.getElementById('comp-pnl-section'), document.getElementById('breakdown-section'),
        document.getElementById('drilldown-section')].forEach(function (el) { if (el) det.appendChild(el); });
      setupDrillTabs();
      wrap.querySelector('.ohn-detail-btn').onclick = function () {
        var on = !wrap.classList.contains('open');
        try { localStorage.setItem(DETAIL_KEY, on ? '1' : '0'); } catch (e) { /* sin storage: solo esta vista */ }
        setDetail(wrap, on);
        if (on) setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 30);   // Chart.js en nodos que estaban ocultos
      };
      setDetail(wrap, detailOpen());
    }
    // Título del waterfall sin jerga (el Hub lo reescribe en cada render).
    var wfT = document.getElementById('wf-title'), st = window._state;
    if (wfT && st) {
      var gl = goalOf(st)[1], per = document.getElementById('period-label-bar');
      var sel = (st.selectedPeriods || []).slice().sort(), last = st.filters && st.filters.lastActuals;
      var base = sel.length && last && sel[sel.length - 1] <= last ? 'Real' : 'Real + proyección';
      wfT.textContent = '¿Dónde está el desvío de Operating Contribution? ' + base + ' vs ' + gl + (per ? ' · ' + label(per) : '');
    }
    Array.prototype.forEach.call(document.querySelectorAll('#wf-grid td, #ohn-wf-more td'), function (td) {
      if (td.children.length) return;
      var t = td.textContent.trim();
      if (t === 'Baseline YoY %') td.textContent = 'vs año pasado';
      else if (t === 'Actuals + RR') td.textContent = 'Real + proyección';
    });
    // Waterfalls: el Hub vacía #wf-grid en cada render; el de Operating Contribution queda a la vista, los otros en el detalle.
    var grid = document.getElementById('wf-grid'), more2 = document.getElementById('ohn-wf-more');
    if (grid && more2) {
      more2.innerHTML = '';
      var kids = Array.prototype.slice.call(grid.children);
      var keep = kids.filter(function (c) { return c.querySelector('#wfc-oc'); })[0] || kids[0];
      kids.forEach(function (c) { if (c !== keep) more2.appendChild(c); });
      if (keep && !keep.parentNode.querySelector('.ohn-wf-note')) {
        var note = document.createElement('p');
        note.className = 'ohn-wf-note';
        note.textContent = 'Hispa = Argentina, Chile, Colombia, Perú y Ecuador · Globales = Other Countries · ' +
          'OPS+RG revierte el COI de Brasil. El Budget trae el COI y su reversión en todos los meses; el Run Rate, ninguno de los dos: ' +
          'en los meses proyectados, Brasil y OPS+RG se compensan entre sí.';
        keep.parentNode.appendChild(note);
      }
    }
  }


  function setDetail(wrap, on) {
    wrap.classList.toggle('open', on);
    var btn = wrap.querySelector('.ohn-detail-btn');
    btn.setAttribute('aria-expanded', String(on));
    btn.textContent = on ? 'Ocultar detalle' : 'Ver detalle';
  }

  // Encabezado en castellano: de dónde sale el número y de qué fecha es.
  function renderStamp() {
    var st = window._state, f = (st && st.filters) || {};
    var sub = document.getElementById('logo-sub'), upd = document.getElementById('last-upd');
    if (!sub || !upd) return;
    var ym = window._ymShort_ || function (x) { return x; };
    var parts = ['Contable'];
    if (f.lastActuals) parts.push('real cerrado a ' + ym(f.lastActuals));
    if (f.lastRunRate) parts.push('proyección (Run Rate) desde ' + ym(f.lastRunRate));
    sub.textContent = parts.join(' · ');
    var t = upd.textContent, org = /ORGANIC \([^)]*\)/.exec(t), at = /Cargado (.*)$/.exec(t);
    upd.textContent = [org ? org[0] : '', at ? 'Actualizado ' + at[1] : ''].filter(Boolean).join(' · ');
  }

  // Secciones embebidas → su versión de Ownia si el módulo ya corre acá.
  // También los OKR embebidos (EXTERNAL_LINKS.okr: el de B2B2C corre en Ownia desde 2026-10-30).
  function owniaFrames() {
    var all = window.EXTERNAL_LINKS;
    if (!all) return;
    [all.iframes, all.okr].forEach(function (ext) {
      if (!ext) return;
      Object.keys(ext).forEach(function (k) {
        var m = /\/s\/([\w-]+)\/exec/.exec(ext[k] || '');
        var dest = m && links[m[1]];
        if (dest && dest !== home) ext[k] = dest;
      });
    });
  }

  function wrap(name, after) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      var r = orig.apply(this, arguments);
      try { after.apply(this, arguments); } catch (e) { /* la capa de Ownia nunca rompe el Hub */ }
      return r;
    };
  }

  // "P&L Contable" (2026-10-29, Diego): no se embebe; lleva a P&L Accounting en la misma pestaña, con la vista del LoB elegido.
  // "P&L Managerial" (2026-11-04, Diego): igual, lleva a P&L Managerial (?view=b2b / b2b2c de ownia-nav.js; HTML y API son
  // B2B; Consolidado abre la vista de entrada del módulo).
  var PNL_VIEW = { all: 'contable-combined', b2b: 'contable-b2b', b2b2c: 'contable-b2b2c' };
  var MGR_VIEW = { b2b: 'b2b', html: 'b2b', api: 'b2b', b2b2c: 'b2b2c' };
  function pnlRedirect() {
    var orig = window.goToSection;
    if (typeof orig !== 'function') return;
    window.goToSection = function (sec) {
      var fr = window.EXTERNAL_LINKS && window.EXTERNAL_LINKS.iframes, url = fr && fr[sec];
      if ((sec !== 'pnl' && sec !== 'pnl_mgr') || !url) return orig.apply(this, arguments);
      var view = sec === 'pnl' ? (PNL_VIEW[lastLob] || PNL_VIEW.all) : MGR_VIEW[lastLob];
      window.location.href = url + (view ? (url.indexOf('?') >= 0 ? '&' : '?') + 'view=' + view : '');
    };
  }

  function hook() {
    pnlRedirect();
    // switchLob es el único punto por el que pasan todos los cambios de sección.
    wrap('switchLob', function (tab) { if (tab && tab.dataset) setActive(tab.dataset.lob); });
    // Las secciones embebidas esconden el header: la barra pasa arriba de todo.
    wrap('_updateHeader', function () {
      var h = document.querySelector('header');
      document.body.classList.toggle('ohn-noheader', !!h && h.style.display === 'none');
    });
    // Cada render del P&L: franja de KPIs y, la primera vez, precarga de los otros LoB. Embebido (Presentaciones: Mensual,
    // Cierre, Mis slides) no se precarga: nadie cambia de LoB ahí y los 2 getAllData de más saturaban el contenedor
    // junto con el Daily (2026-10-30: health check en timeout y reinicio de la app).
    var preloaded = /[?&]embedded=1(&|$)/.test(location.search);
    wrap('_renderDataStamp_', renderStamp);
    wrap('render', function () {
      renderTop();
      foldDetail();
      if (askLink && window._state && window._state.pnl) setTimeout(applyAskLink, 0);   // fuera del render: puede recargar
      if (!preloaded && window._state && window._state.pnl && typeof window._preloadOtherLobs_ === 'function' && typeof window.getParams === 'function') {
        preloaded = true;
        window._preloadOtherLobs_(window.getParams());
      }
    });
    // El Hub titula el drill-down con el LoB; con HTML o API, el negocio.
    wrap('renderDrilldown', function () {
      var t = document.getElementById('drilldown-title'), st = window._state;
      if (t && st && st.lob === 'b2b' && st.canal !== 'all') t.textContent = t.textContent.replace(/· B2B$/, '· ' + bizName(st));
    });
    wrap('toggleFiltersPanel', function () { renderTop(); syncDrawer(true); });
    wrap('renderOKR', renderTop);
    // Las tablas de OKR abren en H2, aunque el período sea de H1: es el semestre en juego y el único con KR Global B2B API. H1 queda en su botón.
    var okrH2Done = /[?&]embedded=1(&|$)/.test(location.search);
    wrap('renderOKR', function () {
      var st = window._state;
      if (okrH2Done || !st || !st.okrAll || !st.okrAll.H2 || typeof window.setOKRHalf !== 'function') return;
      okrH2Done = true;
      if (window._okrHalf !== 'H2') window.setOKRHalf('H2');
    });
    // Desplegable de país: qué incluye Globales y OPS + RG.
    wrap('_buildPaisPanel', function () {
      var tips = { 'Other Countries': 'Globales = Other Countries (Other / Others / OT en las bases)', 'RG': 'OPS + RG: imputaciones de operaciones y regionales, no es un país' };
      Object.keys(tips).forEach(function (k) {
        var l = document.querySelector('label[for="pc-p-' + k + '"]');
        if (l) { l.title = tips[k]; if (k === 'RG') l.textContent = 'OPS + RG'; }
      });
    });
    // switchLob apaga todos los .canal-toggle, también "Montos en" ($M / $K): se vuelve a marcar.
    wrap('switchLob', function () {
      var fmt = (window._state && window._state.numFmt) || 'M';
      Array.prototype.forEach.call(document.querySelectorAll('.numfmt-btn'), function (b) { b.classList.toggle('active', b.dataset.fmt === fmt); });
      syncDrawer();
    });
    [['togglePaisPanelBar', 'pais-panel'], ['toggleProdPanelBar', 'prod-panel']].forEach(function (p) {
      wrap(p[0], function () { placeFloating(p[1]); });
    });
    // Fecha está en la barra: su panel se abre abajo del botón (no al costado del cajón).
    wrap('togglePeriodPanelBar', function () {
      var panel = document.getElementById('period-panel'), btn = document.getElementById('period-btn-bar');
      if (!panel || !btn || panel.style.display === 'none') return;
      var r = btn.getBoundingClientRect();
      panel.style.top = (r.bottom + 6) + 'px';
      panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    owniaFrames();
    setupDrawer();
    hook();
    applyStartBiz();
    if (build()) {
      var cur = document.querySelector('.lob-tab.active');
      setActive(cur ? cur.dataset.lob : 'all');
    }
  });
})();
