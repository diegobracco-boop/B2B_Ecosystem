/* Layout del P&L Dashboard (Hub, Dashboard_B2B_WLs) en Ownia. Lo inyecta server/index.js solo en
 * ese módulo (`layout` en server/modules.js), después de ownia-nav.js. El HTML de Apps Script no se
 * toca: desde 2026-10-23 las mejoras visuales se hacen solo acá (GAS queda congelado).
 * Pensado para su audiencia: Chief y VP Comercial (lectura rápida, reuniones, pantalla compartida).
 *  - Barra fija bajo el header (sin menú hamburguesa): selector de LoB Consolidado / B2B / B2B2C,
 *    las secciones de resultados como pestañas y lo demás en "Operativo ▾" y "Herramientas ▾".
 *    Las pestañas se arman de los botones del menú lateral (#nav-*): una sección nueva aparece sola
 *    (en "Herramientas" si no está clasificada).
 *  - Vista de entrada para dirección (estilo simple): frase de lectura con los mayores desvíos, tarjetas
 *    GB / NR / OC (mes vs Goal, vs Forecast y LY, año a la fecha y cierre FY proyectado vs Budget),
 *    benchmark vs B2C en una línea, waterfall de GB por grupo y evolución. Lo demás, en "Ver detalle".
 *  - Línea de contexto con período, LoB, escenario y filtros, y botón "Filtros" (el panel se abre
 *    encima del contenido, sin correrlo: el layout no salta al cambiar de LoB).
 *  - Los links "Consultar Bitubia/Bitubee" del header pasan a "Herramientas".
 *  - Cambio de LoB instantáneo: apenas llegan los datos del primero se precargan los otros dos.
 *  - Teclado: 1/2/3 cambian de LoB; Esc cierra los menús.
 *  - Las secciones embebidas que ya corren en Ownia (Daily, P&L, P&L Managerial, FVM Negativo)
 *    se abren desde Ownia y no desde Apps Script.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var links = {};
  try { links = JSON.parse(script.getAttribute('data-links') || '{}'); } catch (e) { links = {}; }
  var home = script.getAttribute('data-home');

  var NAV_H = 40;   // = alto de la .lob-tabs original: el panel de filtros del Hub va a --hdr-h + 40px
  var LOBS = [['all', 'Consolidado'], ['b2b', 'B2B'], ['b2b2c', 'B2B2C']];
  var LOB_NAME = { all: 'Consolidado B2B + B2B2C', b2b: 'B2B', b2b2c: 'B2B2C' };
  // Pestañas a la vista (resultados); el resto en menús. Sin clasificar → Herramientas.
  var PRIMARY = ['detailcountry', 'pnl', 'pnl_mgr', 'okr'];
  var OPERATIVO = ['fixedcost', 'fvmneg', 'daily', 'industry'];
  // Nombres cortos (el nombre completo queda como tooltip).
  var SHORT = {
    detailcountry: 'Por país', fixedcost: 'Fixed Cost', pnl: 'P&L Contable', pnl_mgr: 'P&L Managerial',
    fvmneg: 'FVM Negativo', daily: 'Daily, Weekly & MTD', industry: 'Weekly Industry', okr: 'OKR',
  };
  // KPIs de la franja (ids de _state.pnl.rows) y comparación según el Goal elegido.
  var KPIS = [['gb', 'Gross Bookings'], ['nr', 'Net Revenue'], ['oc', 'Operating Contribution']];
  var GOALS = {
    budget: ['varBudPct', 'Budget'], runRate: ['varRRPct', 'Run Rate'],
    forecast: ['varFcPct', 'Forecast'], lastYear: ['yoyPct', 'Last Year'],
  };
  var AMBER_FROM = -5;   // semáforo (mismo criterio que _deltaState_ del Hub): verde ≥ 0%, ámbar −5% a 0%, rojo < −5%
  // Secciones embebidas que siguen el LoB elegido en la barra. Son páginas de Ownia (mismo origen):
  // se llama a su propia función de cambio de LoB, sin recargar. Con "Consolidado", las que no
  // tienen vista consolidada quedan como están.
  var FRAMES = {
    pnl: { id: 'pnl-frame', ready: function (w) { return typeof w.goToView === 'function'; },
      apply: function (w, lob) { w.goToView({ all: 'contable-combined', b2b: 'contable-b2b', b2b2c: 'contable-b2b2c' }[lob]); } },
    pnl_mgr: { id: 'pnl-mgr-frame', ready: function (w) { return typeof w.goToView === 'function'; },
      apply: function (w, lob) { if (lob !== 'all') w.goToView(lob); } },
    daily: { id: 'daily-frame', ready: function (w) { return typeof w.switchLob === 'function'; },
      apply: function (w, lob) { if (lob !== 'all') w.switchLob(lob === 'b2b2c' ? 'b2bc' : 'b2b'); } },
    fvmneg: { id: 'fvmneg-frame', ready: function (w) { return typeof w.switchBiz === 'function' && !!w.DATA; },
      apply: function (w, lob) { if (lob !== 'all') w.switchBiz(lob); } },
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
    '.hamburger-btn,#nav-backdrop,.filters,#filters-toggle,#ai-links,#active-filters{display:none!important}',
    // Layout estable: el contenido no se corre por el panel de filtros (se abre encima).
    'body:not(.ohn-noheader) main{margin-left:0!important;padding-left:24px!important;padding-right:24px!important}',
    '#pnl-filters-bar{box-shadow:6px 0 24px rgba(0,0,0,.18)!important}',
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
    '.ohn-tabs{display:flex;gap:2px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:thin}',
    '.ohn-tab{border:none;background:transparent;color:rgba(255,255,255,.78);font-size:13px;font-weight:500;padding:7px 11px;',
    '  border-radius:7px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px}',
    '.ohn-tab:hover{color:#fff;background:rgba(255,255,255,.1)}',
    '.ohn-tab[aria-current="page"]{color:#fff;background:#550fed;font-weight:600}',
    '.ohn-dd{position:relative;flex:none}',
    '.ohn-dd > .ohn-tab.has-active{color:#fff;box-shadow:inset 0 -2px 0 #a780ff}',
    '.ohn-menu{display:none;position:absolute;right:0;top:calc(100% + 6px);min-width:230px;background:#1d0a5e;',
    '  border:1px solid rgba(167,128,255,.4);border-radius:10px;padding:6px;box-shadow:0 10px 28px rgba(0,0,0,.4);z-index:310}',
    '.ohn-dd.open .ohn-menu{display:block}',
    '.ohn-menu .ohn-tab{width:100%;justify-content:flex-start}',
    '.ohn-menu .ohn-label{color:rgba(196,181,253,.7);font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:8px 11px 4px}',
    // Franja de contexto + KPIs (arriba del Cuadro Resumen).
    '#ohn-top{font-family:Poppins,-apple-system,"Segoe UI",sans-serif;margin:14px 0 16px}',
    '.ohn-ctx{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;color:#3d3b52;margin-bottom:12px}',
    '.ohn-ctx b{color:#12111e;font-weight:600}',
    '.ohn-ctx .ohn-pill{background:#f0ebff;border:1px solid #d9ccff;border-radius:999px;padding:4px 11px}',
    '.ohn-ctx .ohn-period{font-size:15px;font-weight:700;color:#3d00d1;margin-right:4px}',
    '.ohn-filters-btn{margin-left:auto;border:1px solid #550fed;background:#fff;color:#550fed;font:600 13px Poppins,sans-serif;',
    '  border-radius:8px;padding:6px 14px;cursor:pointer}',
    '.ohn-filters-btn:hover,.ohn-filters-btn[aria-expanded="true"]{background:#550fed;color:#fff}',
    '.ohn-filters-btn:focus-visible{outline:2px solid #a780ff;outline-offset:2px}',
    // Tarjetas (estilo simple: aire, un número protagonista, color solo en el semáforo).
    '.ohn-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}',
    '.ohn-kpi{background:#fff;border:1px solid #ebe8f3;border-radius:14px;padding:18px 20px 16px}',
    '.ohn-kpi .k-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.ohn-kpi .k-name{font-size:13px;font-weight:600;color:#6b6b85}',
    '.ohn-kpi .k-flag{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#3d3b52}',
    '.ohn-kpi .k-flag i{width:8px;height:8px;border-radius:50%;background:#c9c4d8}',
    '.ohn-kpi.g .k-flag i{background:#1a7f37}.ohn-kpi.a .k-flag i{background:#d4a72c}.ohn-kpi.r .k-flag i{background:#cf222e}',
    '.ohn-kpi .k-val{font-size:34px;font-weight:700;color:#12111e;line-height:1.1;margin:8px 0 4px;letter-spacing:-.01em}',
    '.ohn-kpi .k-main{font-size:15px;color:#3d3b52}',
    '.ohn-kpi .k-sec{display:flex;gap:14px;font-size:12.5px;color:#6b6b85;margin-top:4px}',
    '.k-pct{font-weight:700}.k-pct.g{color:#1a7f37}.k-pct.a{color:#9a6700}.k-pct.r{color:#cf222e}',
    '.ohn-kpi .k-fy{margin-top:14px;padding-top:12px;border-top:1px solid #f0edf7;display:grid;gap:6px;font-size:13px;color:#3d3b52}',
    '.ohn-kpi .k-fy > div{display:flex;align-items:baseline;gap:8px}',
    '.ohn-kpi .k-lbl{flex:1;min-width:0}.ohn-kpi .k-lbl em{font-style:normal;color:#8a88a0;font-size:12px}',
    '.ohn-kpi .k-num{font-weight:600;color:#12111e}',
    '.ohn-kpi .k-note{font-size:11.5px;color:#8a88a0}',
    '.ohn-read{font-size:15px;line-height:1.55;color:#3d3b52;margin:4px 0 16px;max-width:1100px}',
    '.ohn-read b{color:#12111e}',
    '.ohn-kpi .k-split{font-size:12.5px;color:#6b6b85;margin-top:4px}',
    '.ohn-facts{margin:18px 0 4px;display:grid;gap:8px}',
    '.ohn-facts p{font-size:14px;color:#3d3b52;margin:0;padding-left:104px;text-indent:-104px}',
    '.ohn-facts p > span{display:inline-block;text-indent:0;width:104px;font-weight:600;color:#12111e}',
    '.ohn-okr-go{font:600 12px Poppins,sans-serif;color:#550fed;background:none;border:none;padding:0 0 0 6px;cursor:pointer;text-decoration:underline}',
    '.ohn-legend{font-size:11.5px;color:#8a88a0;margin-top:8px}',
    // "Ver detalle": el bloque de análisis queda plegado al final.
    '#ohn-detail-wrap{border-top:1px solid #ebe8f3;padding-top:20px}',
    '.ohn-detail-btn{font:600 14px Poppins,sans-serif;color:#550fed;background:#f5f2ff;border:1px solid #d9ccff;border-radius:999px;padding:8px 18px;cursor:pointer}',
    '.ohn-detail-btn:hover{background:#ebe4ff}.ohn-detail-btn:focus-visible{outline:2px solid #a780ff;outline-offset:2px}',
    '.ohn-detail-btn::after{content:" ▾"}#ohn-detail-wrap.open .ohn-detail-btn::after{content:" ▴"}',
    '.ohn-detail-sub{font-size:12.5px;color:#8a88a0;margin:8px 0 0}',
    '#ohn-detail{display:none;margin-top:20px}#ohn-detail-wrap.open #ohn-detail{display:block}',
    '.ohn-evo-tables{margin-bottom:20px}',
    '.ohn-wf-note{font-size:12px;color:#8a88a0;margin:10px 4px 0}',
    '.pnl-split-btn{margin-left:10px;font:600 11.5px Poppins,sans-serif;color:#550fed;background:none;border:1px solid #d9ccff;border-radius:999px;padding:3px 10px;cursor:pointer}',
    '@media (max-width:900px){.ohn-kpis{grid-template-columns:1fr}}',
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

  function closeMenus(except) {
    var dds = document.querySelectorAll('#ownia-hubnav .ohn-dd.open');
    for (var i = 0; i < dds.length; i++) {
      if (dds[i] === except) continue;
      dds[i].classList.remove('open');
      dds[i].firstChild.setAttribute('aria-expanded', 'false');
    }
  }

  function dropdown(title, onOpen) {
    var dd = document.createElement('div');
    dd.className = 'ohn-dd';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ohn-tab';
    btn.textContent = title + ' ▾';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    var menu = document.createElement('div');
    menu.className = 'ohn-menu';
    btn.onclick = function (ev) {
      ev.stopPropagation();
      var open = !dd.classList.contains('open');
      closeMenus(dd);
      if (open && onOpen) onOpen(menu);
      dd.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (open) { var first = menu.querySelector('button'); if (first) first.focus(); }
    };
    dd.appendChild(btn);
    dd.appendChild(menu);
    return { el: dd, menu: menu };
  }

  function tabFrom(it, key, short) {
    var t = document.createElement('button');
    t.type = 'button';
    t.className = 'ohn-tab';
    if (key) t.dataset.lob = key;
    t.title = label(it);
    var icon = it.querySelector('span');
    if (short && SHORT[key]) {
      if (icon) t.appendChild(icon.cloneNode(true));
      t.appendChild(document.createTextNode(' ' + SHORT[key]));
    } else {
      t.innerHTML = it.innerHTML;
    }
    t.onclick = function () { closeMenus(); it.click(); };
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
    seg.setAttribute('aria-label', 'Línea de negocio (teclas 1, 2, 3)');
    LOBS.forEach(function (l, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.lob = l[0];
      b.textContent = l[1];
      b.title = l[1] + ' (tecla ' + (i + 1) + ')';
      b.setAttribute('aria-pressed', 'false');
      b.onclick = function () { window.goToSection(l[0]); };
      seg.appendChild(b);
    });
    nav.appendChild(seg);
    var sep = document.createElement('div');
    sep.className = 'ohn-sep';
    nav.appendChild(sep);

    var tabs = document.createElement('div');
    tabs.className = 'ohn-tabs';
    var oper = dropdown('Operativo');
    var tools = dropdown('Herramientas', function (menu) {
      // Consultas de IA del header (dependen del LoB): se arman al abrir el menú.
      var old = menu.querySelectorAll('.ohn-ai');
      for (var i = 0; i < old.length; i++) old[i].remove();
      var box = document.getElementById('ai-links');
      if (!box || box.style.display === 'none') return;
      var as = box.querySelectorAll('a');
      for (var j = as.length - 1; j >= 0; j--) {
        if (as[j].style.display === 'none') continue;
        var t = document.createElement('button');
        t.type = 'button';
        t.className = 'ohn-tab ohn-ai';
        t.textContent = label(as[j]).replace(/^🤖\s*/, '🤖 ').replace(/CONSULTAR/i, 'Consultar');
        t.onclick = (function (a) { return function () { closeMenus(); a.click(); }; })(as[j]);
        menu.insertBefore(t, menu.firstChild);
      }
    });

    var byKey = {};
    var items = document.querySelectorAll('.filters .nav-links > .nav-item, .filters .nav-links > .nav-sublabel');
    var skip = { 'nav-all': 1, 'nav-b2b': 1, 'nav-b2b2c': 1 };
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.classList.contains('nav-sublabel')) {
        var lb = document.createElement('div');
        lb.className = 'ohn-label';
        lb.textContent = label(it);
        tools.menu.appendChild(lb);
        continue;
      }
      if (!it.id && !it.classList.contains('nav-sub')) continue;   // Home: ya está "🏠 Home" del header
      if (skip[it.id]) continue;
      var key = it.id ? it.id.replace(/^nav-/, '') : '';
      if (key) byKey[key] = it;
      if (key && (PRIMARY.indexOf(key) >= 0 || OPERATIVO.indexOf(key) >= 0)) continue;
      tools.menu.appendChild(tabFrom(it, key, false));
    }
    PRIMARY.forEach(function (k) { if (byKey[k]) tabs.appendChild(tabFrom(byKey[k], k, true)); });
    OPERATIVO.forEach(function (k) { if (byKey[k]) oper.menu.appendChild(tabFrom(byKey[k], k, true)); });

    nav.appendChild(tabs);
    if (oper.menu.children.length) nav.appendChild(oper.el);
    nav.appendChild(tools.el);
    header.parentNode.insertBefore(nav, header.nextSibling);

    document.addEventListener('click', function () { closeMenus(); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { closeMenus(); return; }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var tag = (ev.target && ev.target.tagName) || '';
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || (ev.target && ev.target.isContentEditable)) return;
      var n = { 1: 'all', 2: 'b2b', 3: 'b2b2c' }[ev.key];
      if (n) { ev.preventDefault(); window.goToSection(n); }
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
    var segBtns = nav.querySelectorAll('.ohn-seg [data-lob]');
    for (var i = 0; i < segBtns.length; i++) segBtns[i].setAttribute('aria-pressed', String(segBtns[i].dataset.lob === lob));
    var tabs = nav.querySelectorAll('.ohn-tabs [data-lob], .ohn-menu [data-lob]');
    for (var j = 0; j < tabs.length; j++) {
      if (tabs[j].dataset.lob === lob) tabs[j].setAttribute('aria-current', 'page');
      else tabs[j].removeAttribute('aria-current');
    }
    var dds = nav.querySelectorAll('.ohn-dd');
    for (var k = 0; k < dds.length; k++) dds[k].firstChild.classList.toggle('has-active', !!dds[k].querySelector('[aria-current="page"]'));
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
    var goal = GOALS[st.goal] || GOALS.budget;
    var periodEl = document.getElementById('period-label-bar');
    var period = periodEl ? label(periodEl) : '';
    // Solo los filtros que recortan algo (los "Todos" no suman) y sin jerga ("Baseline").
    var pills = Array.prototype.map.call(chips.querySelectorAll('.af-chip'), function (c) {
      var t = c.textContent;
      if (/:\s*Todos\s*$/.test(t)) return '';
      if (/^Baseline:/.test(t)) {
        var sel = (st.selectedPeriods || []).slice().sort(), last = st.filters && st.filters.lastActuals;
        var closed = sel.length && last && sel[sel.length - 1] <= last;
        var base = /forecast/i.test(t) && !/Actuals/.test(t) ? 'Forecast' : closed ? 'Real' : 'Real + proyección';
        return '<span class="ohn-pill">Base: <b>' + esc(base) + '</b></span>';
      }
      return '<span class="ohn-pill">' + c.innerHTML + '</span>';
    }).join('');
    var open = !!st.filtersExpanded;
    var html = '<div class="ohn-ctx">' +
      (period ? '<span class="ohn-period">' + esc(period) + '</span>' : '') +
      '<span class="ohn-pill"><b>' + esc(LOB_NAME[st.lob] || LOB_NAME[current] || '') + '</b></span>' + pills +
      '<button type="button" class="ohn-filters-btn" aria-expanded="' + open + '" aria-controls="pnl-filters-bar">Filtros</button>' +
      '</div>';
    html += readingHtml(st, goal) + '<div class="ohn-kpis">';
    var totalIdx = st.pnl.groups ? st.pnl.groups.length - 1 : -1;
    KPIS.forEach(function (k) {
      var row = st.pnl.rows.filter(function (r) { return r.id === k[0]; })[0];
      var c = row && row.cols && row.cols[totalIdx];
      if (!c) return;
      var vs = c[goal[0]];
      var cls = semaforo(vs);
      var flag = cls === 'g' ? 'En línea' : cls === 'a' ? 'Atención' : cls === 'r' ? 'Debajo' : '';
      // Comparaciones secundarias: las que no son el Goal elegido (Forecast y LY, o Budget y LY…).
      var sec = ['budget', 'forecast', 'lastYear'].filter(function (g) { return g !== st.goal; }).map(function (g) {
        var v = c[GOALS[g][0]];
        return isFinite(v) ? '<span>vs ' + (g === 'lastYear' ? 'LY' : GOALS[g][1]) + ' ' + pctTxt(v) + '</span>' : '';
      }).join('');
      var fy = fyStats(k[0]);
      var split = st.lob === 'all' ? lobSplit(row, goal) : '';
      html += '<div class="ohn-kpi ' + cls + '">' +
        '<div class="k-head"><span class="k-name">' + esc(k[1]) + '</span>' +
        (flag ? '<span class="k-flag" title="vs ' + esc(goal[1]) + ': verde ≥ 0% · ámbar entre −5% y 0% · rojo &lt; −5%"><i></i>' + flag + '</span>' : '') + '</div>' +
        '<div class="k-val">' + fmtMoney(c.actual || 0) + '</div>' +
        '<div class="k-main">' + pctTxt(vs, true) + ' vs ' + esc(goal[1]) + '</div>' +
        '<div class="k-sec">' + sec + '</div>' + split +
        (fy ? '<div class="k-fy">' +
          '<div><span class="k-lbl">Año a la fecha <em>' + esc(fy.ytdLbl) + '</em></span><span class="k-num">' + fmtMoney(fy.ytd) + '</span>' + pctTxt(fy.ytdPct) + '</div>' +
          '<div><span class="k-lbl">Cierre ' + esc(fy.fyLbl) + ' proyectado</span><span class="k-num">' + fmtMoney(fy.fy) + '</span>' + pctTxt(fy.fyPct) + '</div>' +
          '<div class="k-note">vs Budget del año</div></div>' : '') +
        '</div>';
    });
    html += '</div><div class="ohn-facts">' + marginHtml(st) + benchHtml(st) + okrHtml(st) + '</div>';
    top.innerHTML = html;
    top.querySelector('.ohn-filters-btn').onclick = function () {
      if (typeof window.toggleFiltersPanel === 'function') window.toggleFiltersPanel();   // wrap → renderTop
    };
    var okrBtn = top.querySelector('.ohn-okr-go');
    if (okrBtn) okrBtn.onclick = function () {
      var wrap = document.getElementById('ohn-detail-wrap'), col = document.getElementById('okr-col');
      if (wrap && !wrap.classList.contains('open')) wrap.querySelector('.ohn-detail-btn').click();
      if (col) setTimeout(function () { col.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    };
  }

  // Consolidado: el mismo indicador para B2B (Mayoristas + Minoristas) y B2B2C (WL's), vs el Goal.
  function lobSplit(row, goal) {
    var g = window._state.pnl.groups, wl = g.indexOf("WL's"), may = g.indexOf('MAY'), min = g.indexOf('MIN');
    if (wl < 0 || may < 0 || min < 0) return '';
    var ref = { varBudPct: 'budget', varRRPct: 'runRate', varFcPct: 'forecast', yoyPct: 'lyVal' }[goal[0]];
    var a = row.cols[may], b = row.cols[min], w = row.cols[wl];
    var act = (+a.actual || 0) + (+b.actual || 0), refV = (+a[ref] || 0) + (+b[ref] || 0);
    var b2b = refV ? (act - refV) / Math.abs(refV) * 100 : null;
    return '<div class="k-split">B2B ' + pctTxt(b2b, true) + ' · B2B2C ' + pctTxt(w[goal[0]], true) + '</div>';
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
    return '<p><span>Margen</span>' + one('nr', 'Net Revenue') + ' · ' + one('oc', 'OC') + '.</p>';
  }

  // OKR del semestre, una línea (el detalle está en "Ver detalle").
  function okrHtml(st) {
    var o = st.okr;
    if (!o) return '';
    var keys = st.lob === 'b2b2c' ? ['b2b2c'] : st.lob === 'b2b' ? ['b2b', 'globales'] : ['b2b2c', 'b2b', 'globales'];
    var parts = keys.filter(function (k) { return o[k] && isFinite(o[k].halfTotal); }).map(function (k) {
      var v = o[k].halfTotal, cls = v >= 100 ? 'g' : v >= 80 ? 'a' : 'r';
      return esc(o[k].label) + ' <b class="k-pct ' + cls + '">' + (v < 70 ? '&lt;70' : Math.min(v, 130).toFixed(0)) + '%</b>';
    });
    if (!parts.length) return '';
    var h = window._okrHalf ? ' ' + window._okrHalf : '';
    return '<p><span>OKR' + esc(h) + '</span>' + parts.join(' · ') +
      ' <button type="button" class="ohn-okr-go">Ver KRs</button></p>';
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
    var ytd = 0, ytdB = 0, fy = 0, fyB = 0, n = 0;
    e.periods.forEach(function (ym, i) {
      if (ym < FY[0] || ym > FY[11]) return;
      var a = m.actuals[i], b = m.budget[i];
      if (a === null || a === undefined || b === null || b === undefined) return;
      fy += a; fyB += b; n++;
      if (ym <= last) { ytd += a; ytdB += b; }
    });
    if (!n || !fyB) return null;
    var mon = function (ym) { var L = window.MONTH_LABELS || {}; return String(L[ym.split('-')[1]] || '').slice(0, 3).toLowerCase(); };
    return {
      ytd: ytd, ytdPct: ytdB ? (ytd - ytdB) / Math.abs(ytdB) * 100 : null,
      ytdLbl: last >= FY[0] ? mon(FY[0]) + '–' + mon(last) : '',
      fy: fy, fyPct: (fy - fyB) / Math.abs(fyB) * 100, fyLbl: 'FY' + String(FY[11]).slice(2, 4),
    };
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
      var gs = gbWf.byGroup.map(function (g) {
        return { label: g.label, d: st.goal === 'lastYear' ? g._yoyAbs : g.delta };
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
      var both = 'Net Revenue ' + moneyDelta(nr) + ' y Operating Contribution ' + moneyDelta(oc);
      if (tot.gb < 0 && nr >= 0 && oc >= 0) s += ' ' + both + ': vendemos menos volumen que el plan, con mejor margen.';
      else if (tot.gb >= 0 && nr >= 0 && oc >= 0) s += ' ' + both + ': los tres indicadores le ganan al ' + esc(goal[1]) + '.';
      else if (tot.gb >= 0 && oc < 0) s += ' ' + both + ': crece el volumen, pero la rentabilidad queda abajo.';
      else s += ' ' + both + '.';
    }
    return '<p class="ohn-read">' + s + '</p>';
  }

  // Benchmark vs B2C en una línea: crecimiento del GB contra B2C y peso en Despegar (de _state.compPnl).
  function benchHtml(st) {
    var cp = st.compPnl;
    if (!cp || !cp.groups || !cp.rows) return '';
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
      (sg !== null ? ' · somos el <b>' + sg.toFixed(0) + '%</b> del GB' + (so !== null ? ' y el <b>' + so.toFixed(0) + '%</b> del OC' : '') + ' de Despegar' : '') +
      '.</p>';
  }

  // ── Vista de entrada y "Ver detalle" ───────────────────────────────────────────────────────
  // Arriba: KPIs, lectura, benchmark, waterfall de GB por grupo y evolución. El resto (Cuadro
  // Resumen con OKR, waterfalls de NR y OC, tablas por país, benchmark completo, drill-down) se
  // mueve a un bloque plegado al final. Se mueven nodos, no se copian: el Hub los sigue llenando.
  var DETAIL_KEY = 'ohn-hub-detail';
  function detailOpen() { try { return localStorage.getItem(DETAIL_KEY) === '1'; } catch (e) { return false; } }
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
        '<p class="ohn-detail-sub">Cuadro Resumen y OKR · Net Revenue y Operating Contribution por grupo y por concepto · ' +
        'evolución por país · benchmark completo vs B2C · drill-down del año</p><div id="ohn-detail"></div>';
      evoSec.parentNode.insertBefore(wrap, evoSec.nextSibling);
      var det = wrap.querySelector('#ohn-detail');
      var pnlSec = document.getElementById('pnl-title') && document.getElementById('pnl-title').closest('.sec');
      var more = document.createElement('div'); more.id = 'ohn-wf-more'; more.className = 'wf-grid';
      var evoT = document.createElement('div'); evoT.className = 'evo-card ohn-evo-tables';
      ['evo-yoy-table', 'evo-ctry-table'].forEach(function (id) { var el = document.getElementById(id); if (el) evoT.appendChild(el); });
      [pnlSec, more, evoT, document.getElementById('comp-pnl-section'), document.getElementById('breakdown-section'),
        document.getElementById('drilldown-section')].forEach(function (el) { if (el) det.appendChild(el); });
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
      var gl = (GOALS[st.goal] || GOALS.budget)[1], per = document.getElementById('period-label-bar');
      var sel = (st.selectedPeriods || []).slice().sort(), last = st.filters && st.filters.lastActuals;
      var base = sel.length && last && sel[sel.length - 1] <= last ? 'Real' : 'Real + proyección';
      wfT.textContent = '¿Dónde está el desvío? ' + base + ' vs ' + gl + ' por grupo de países' + (per ? ' · ' + label(per) : '');
    }
    Array.prototype.forEach.call(document.querySelectorAll('#wf-grid td, #ohn-wf-more td'), function (td) {
      if (td.children.length) return;
      var t = td.textContent.trim();
      if (t === 'Baseline YoY %') td.textContent = 'vs año pasado';
      else if (t === 'Actuals + RR') td.textContent = 'Real + proyección';
    });
    // Waterfalls: el Hub vacía #wf-grid en cada render; el primero (GB por grupo) queda a la vista.
    var grid = document.getElementById('wf-grid'), more2 = document.getElementById('ohn-wf-more');
    if (grid && more2) {
      more2.innerHTML = '';
      Array.prototype.slice.call(grid.children, 1).forEach(function (c) { more2.appendChild(c); });
      var first = grid.children[0];
      if (first && !first.querySelector('.ohn-wf-note') && /OPS\+RG/.test(first.textContent)) {
        var note = document.createElement('p');
        note.className = 'ohn-wf-note';
        note.textContent = 'Hispa = Argentina, Chile, Colombia, Perú y Ecuador · Globales = Other Countries · ' +
          'OPS+RG no es un país: son imputaciones de operaciones y regionales, por eso puede tener resultado sin volumen.';
        first.appendChild(note);
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
  function owniaFrames() {
    var ext = window.EXTERNAL_LINKS && window.EXTERNAL_LINKS.iframes;
    if (!ext) return;
    Object.keys(ext).forEach(function (k) {
      var m = /\/s\/([\w-]+)\/exec/.exec(ext[k] || '');
      var dest = m && links[m[1]];
      if (dest && dest !== home) ext[k] = dest;
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

  function hook() {
    // switchLob es el único punto por el que pasan todos los cambios de sección.
    wrap('switchLob', function (tab) { if (tab && tab.dataset) setActive(tab.dataset.lob); });
    // Las secciones embebidas esconden el header: la barra pasa arriba de todo.
    wrap('_updateHeader', function () {
      var h = document.querySelector('header');
      document.body.classList.toggle('ohn-noheader', !!h && h.style.display === 'none');
    });
    // Cada render del P&L: franja de KPIs y, la primera vez, precarga de los otros LoB.
    var preloaded = false;
    wrap('_renderDataStamp_', renderStamp);
    wrap('render', function () {
      renderTop();
      foldDetail();
      if (!preloaded && window._state && window._state.pnl && typeof window._preloadOtherLobs_ === 'function' && typeof window.getParams === 'function') {
        preloaded = true;
        window._preloadOtherLobs_(window.getParams());
      }
    });
    wrap('toggleFiltersPanel', renderTop);
    wrap('renderOKR', renderTop);
  }

  document.addEventListener('DOMContentLoaded', function () {
    owniaFrames();
    hook();
    if (build()) {
      var cur = document.querySelector('.lob-tab.active');
      setActive(cur ? cur.dataset.lob : 'all');
    }
  });
})();
