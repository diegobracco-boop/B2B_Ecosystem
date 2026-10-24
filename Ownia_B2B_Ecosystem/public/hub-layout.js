/* Layout del P&L Dashboard (Hub, Dashboard_B2B_WLs) en Ownia. Lo inyecta server/index.js solo en
 * ese módulo (`layout` en server/modules.js), después de ownia-nav.js. El HTML de Apps Script no se
 * toca: desde 2026-10-23 las mejoras visuales se hacen solo acá (GAS queda congelado).
 * Pensado para su audiencia: Chief y VP Comercial (lectura rápida, reuniones, pantalla compartida).
 *  - Barra fija bajo el header (sin menú hamburguesa): selector de LoB Consolidado / B2B / B2B2C,
 *    las secciones de resultados como pestañas y lo demás en "Operativo ▾" y "Herramientas ▾".
 *    Las pestañas se arman de los botones del menú lateral (#nav-*): una sección nueva aparece sola
 *    (en "Herramientas" si no está clasificada).
 *  - Franja de KPIs arriba del Cuadro Resumen: Gross Bookings, Net Revenue y Operating Contribution
 *    (columna Total de _state.pnl) con Δ% vs el Goal elegido, YoY y semáforo.
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
    '.ohn-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}',
    '.ohn-kpi{background:#fff;border:1px solid #e6e1f5;border-left:5px solid #c9c4d8;border-radius:10px;padding:14px 18px;',
    '  box-shadow:0 1px 4px rgba(0,0,0,.05)}',
    '.ohn-kpi.g{border-left-color:#1a7f37}.ohn-kpi.a{border-left-color:#d4a72c}.ohn-kpi.r{border-left-color:#cf222e}',
    '.ohn-kpi .k-name{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b6b85}',
    '.ohn-kpi .k-val{font-size:30px;font-weight:700;color:#12111e;line-height:1.15;margin:4px 0 6px}',
    '.ohn-kpi .k-row{display:flex;gap:16px;font-size:13.5px;color:#3d3b52}',
    '.ohn-kpi .k-row span b{font-weight:700}',
    '.ohn-kpi .up{color:#1a7f37}.ohn-kpi .down{color:#cf222e}',
    '.ohn-kpi .k-flag{float:right;font-size:11.5px;font-weight:600;border-radius:999px;padding:3px 10px}',
    '.ohn-kpi.g .k-flag{background:#dafbe1;color:#1a7f37}.ohn-kpi.a .k-flag{background:#fff3c4;color:#7d5a00}',
    '.ohn-kpi.r .k-flag{background:#ffd8d3;color:#a40e26}',
    '.ohn-legend{font-size:11.5px;color:#6b6b85;margin-top:8px}',
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
    var pills = Array.prototype.map.call(chips.querySelectorAll('.af-chip'), function (c) {
      return '<span class="ohn-pill">' + c.innerHTML + '</span>';
    }).join('');
    var open = !!st.filtersExpanded;
    var html = '<div class="ohn-ctx">' +
      (period ? '<span class="ohn-period">' + esc(period) + '</span>' : '') +
      '<span class="ohn-pill"><b>' + esc(LOB_NAME[st.lob] || LOB_NAME[current] || '') + '</b></span>' + pills +
      '<button type="button" class="ohn-filters-btn" aria-expanded="' + open + '" aria-controls="pnl-filters-bar">⚙ Filtros</button>' +
      '</div><div class="ohn-kpis">';
    var totalIdx = st.pnl.groups ? st.pnl.groups.length - 1 : -1;
    KPIS.forEach(function (k) {
      var row = st.pnl.rows.filter(function (r) { return r.id === k[0]; })[0];
      var c = row && row.cols && row.cols[totalIdx];
      if (!c) return;
      var vs = c[goal[0]];
      var ds = typeof window._deltaState_ === 'function' && isFinite(vs) ? window._deltaState_(vs) : null;
      var cls = !isFinite(vs) ? '' : ds ? { good: 'g', neu: 'g', warn: 'a', bad: 'r' }[ds]
        : vs >= 0 ? 'g' : vs >= AMBER_FROM ? 'a' : 'r';
      var flag = cls === 'g' ? 'En línea' : cls === 'a' ? 'Atención' : cls === 'r' ? 'Debajo' : '';
      html += '<div class="ohn-kpi ' + cls + '">' +
        (flag ? '<span class="k-flag">' + flag + '</span>' : '') +
        '<div class="k-name">' + esc(k[1]) + '</div>' +
        '<div class="k-val">' + fmtMoney(c.actual || 0) + '</div>' +
        '<div class="k-row">' +
        '<span>vs ' + esc(goal[1]) + ' <b class="' + (vs >= 0 ? 'up' : 'down') + '">' + fmtPct(vs) + '</b></span>' +
        (st.goal === 'lastYear' ? '' : '<span>YoY <b class="' + (c.yoyPct >= 0 ? 'up' : 'down') + '">' + fmtPct(c.yoyPct) + '</b></span>') +
        '</div></div>';
    });
    html += '</div><div class="ohn-legend">Total del período y filtros elegidos. Semáforo vs ' + esc(goal[1]) +
      ': verde ≥ 0% · ámbar entre ' + AMBER_FROM + '% y 0% · rojo &lt; ' + AMBER_FROM + '%.</div>';
    top.innerHTML = html;
    top.querySelector('.ohn-filters-btn').onclick = function () {
      if (typeof window.toggleFiltersPanel === 'function') window.toggleFiltersPanel();   // wrap → renderTop
    };
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
    wrap('render', function () {
      renderTop();
      if (!preloaded && window._state && window._state.pnl && typeof window._preloadOtherLobs_ === 'function' && typeof window.getParams === 'function') {
        preloaded = true;
        window._preloadOtherLobs_(window.getParams());
      }
    });
    wrap('toggleFiltersPanel', renderTop);
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
