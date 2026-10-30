/* Layout del P&L Accounting en Ownia. Lo inyecta server/index.js solo en ese módulo (`layout` en
 * server/modules.js). El HTML de Apps Script no se toca: el equipo sigue publicando el módulo con
 * /clasp-push, y lo que vive acá no viaja a GAS.
 *
 * Escenario "Forecast - Bridge to budget" (2026-10-26): botón "vs Forecast BTB" en el selector de
 * comparación de la vista EPM, al lado de "vs Last RR". El cálculo lo hace el servidor con el goal
 * 'forecastbtb' (server/gas-extras/pnl-accounting-fbtb.js).
 */
(function () {
  'use strict';

  var GOAL = 'forecastbtb';
  var LABEL = 'Forecast - Bridge to budget';

  // (Organic YES por default vive en el propio dashboard.html desde 2026-10-26: GAS y Ownia.)

  document.addEventListener('DOMContentLoaded', function () {
    var after = document.getElementById('btn-egoal-lastrunrate');
    if (!after || typeof window.setEpmGoalSource !== 'function' || typeof window._epmGoalLabel !== 'function') {
      console.warn('[pnl-accounting-layout] no se encontró el selector de comparación: sin Forecast BTB');
      return;
    }
    var btn = document.createElement('button');
    btn.id = 'btn-egoal-' + GOAL;
    btn.className = 'prd-btn';
    btn.type = 'button';
    btn.textContent = 'vs Forecast BTB';
    btn.title = LABEL;
    btn.addEventListener('click', function () { window.setEpmGoalSource(GOAL); });
    after.parentNode.insertBefore(btn, after.nextSibling);

    var origSet = window.setEpmGoalSource;
    window.setEpmGoalSource = function (src) {
      btn.classList.toggle('prd-active', src === GOAL);
      return origSet.apply(this, arguments);
    };
    var origLabel = window._epmGoalLabel;
    window._epmGoalLabel = function () {
      return window._epmGoalSource === GOAL ? LABEL : origLabel.apply(this, arguments);
    };
    // Organic: como el Forecast, todo a TC Budget (ORGANIC_TARGETS_ del servidor).
    if (window.ORG_GOALS_) window.ORG_GOALS_[GOAL] = 'Budget';
  });
})();


/* P&L Accounting simplificado (2026-10-30, Diego): en Ownia el P&L carga rápido, así que en vez de muchas tablas hay
 * una por sección y se elige con filtros.
 *  - Secciones (arriba): B2B + B2B2C · B2B · B2B2C · API · HTML (Countries YoY sale). Todas usan la vista consolidada
 *    del dashboard (gráficos de evolución + tabla Baseline vs Goal); la sección fija lobGroup / canal en
 *    getContableFilters (API = canal MAY, HTML = canal MIN). El Bridge de OC queda solo en B2B + B2B2C (se arma con el
 *    consolidado). Fuera: los bloques repetidos por LoB / país / producto.
 *  - Filtros: la fila País (y Producto en B2B / API / HTML: la base contable de B2B2C no viene por producto).
 *  - Período "Año" junto a Mes / Quarter / Half, y "Columnas: Período / País / Producto": por país o producto cada columna
 *    es el total del período elegido (Año o los chips; sin marcar = el FY), solo los países / productos filtrados.
 *    País sale de by_country (ya viene en la respuesta); producto, de getEPMBreakdown
 *    (server/gas-extras/pnl-accounting-byprod.js, cacheado). Las tablas usan buildBGScenHead / buildBGQHead / fillBGBody.
 * Se recuerdan en el navegador (pa-sec, pa-cols); ?sec=api y ?cols=pais|prod en la URL abren directo así.
 */
(function () {
  'use strict';
  var W = window;
  var SECS = [
    { k: 'combined', lbl: 'B2B + B2B2C', lob: null, canal: [] },
    { k: 'b2b', lbl: 'B2B', lob: 'b2b', canal: [] },
    { k: 'b2b2c', lbl: 'B2B2C', lob: 'b2b2c', canal: [] },
    { k: 'api', lbl: 'API', lob: 'b2b', canal: ['may'], title: 'B2B MAY (API)' },
    { k: 'html', lbl: 'HTML', lob: 'b2b', canal: ['min'], title: 'B2B MIN (HTML)' },
  ];
  function ls(k, ok) { try { var v = localStorage.getItem(k); return ok.indexOf(v) >= 0 ? v : null; } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin storage */ } }
  function q(name, ok) { var m = new RegExp('[?&]' + name + '=([a-z0-9]+)(&|$)').exec(location.search); return m && ok.indexOf(m[1]) >= 0 ? m[1] : null; }
  var SEC_KEYS = SECS.map(function (s) { return s.k; }), COL_KEYS = ['periodo', 'pais', 'prod'];
  var qView = /[?&]view=contable-(combined|b2b2c|b2b)(&|$)/.exec(location.search);   // accesos directos del menú / P&L Dashboard
  var sec = q('sec', SEC_KEYS) || (qView && qView[1]) || ls('pa-sec', SEC_KEYS) || 'combined';
  var cols = q('cols', COL_KEYS) || ls('pa-cols', COL_KEYS) || 'periodo';
  var year = false, cache = {}, busy = {}, refill = true;
  var MODE_LBL = { m: 'Mes', q: 'Quarter', h: 'Semestre' };
  var EXPLICIT = ['brasil', 'mexico', 'argentina', 'colombia', 'chile', 'peru', 'ecuador', 'rg'];

  function S() { for (var i = 0; i < SECS.length; i++) if (SECS[i].k === sec) return SECS[i]; return SECS[0]; }
  function hasProd() { return S().lob === 'b2b'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cap(s) { return String(s).replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); }); }
  function btn(id, txt, title, cls) {
    var b = document.createElement('button');
    b.id = id; b.className = cls || 'prd-btn'; b.type = 'button'; b.textContent = txt;
    if (title) b.title = title;
    return b;
  }
  function fy() { return W.FY_TAG || ''; }

  // ── Período ──
  function months() {
    var M = W.ALL_MONTHS_ORD_BG || [];
    var sel = (!year && W._bgPeriodSel && W._bgPeriodSel.length) ? W._bgPeriodSel : null;
    if (!sel) return M.slice();
    if (W._bgPeriodMode === 'm') return M.filter(function (m) { return sel.indexOf(m) >= 0; });
    var span = W._bgPeriodMode === 'h' ? { H1: [0, 6], H2: [6, 12] } : { Q1: [0, 3], Q2: [3, 6], Q3: [6, 9], Q4: [9, 12] };
    var pick = {};
    sel.forEach(function (p) { var r = span[String(p).split(' ')[0]]; if (r) M.slice(r[0], r[1]).forEach(function (m) { pick[m] = 1; }); });
    return M.filter(function (m) { return pick[m]; });
  }
  function periodLabel(ms) {
    if (ms.length === (W.ALL_MONTHS_ORD_BG || []).length) return fy();
    if (ms.length === 1) return ms[0];
    return ms[0] + ' a ' + ms[ms.length - 1] + ' · ' + fy();
  }
  function setTitle(txt) { var t = document.getElementById('bg-period-title'); if (t) t.textContent = (S().title || S().lbl) + ' · ' + txt; }
  function periodTitle() { return year ? 'Agrupado por Año · ' + fy() : 'Agrupado por ' + (MODE_LBL[W._bgPeriodMode] || 'Quarter') + ' · ' + fy(); }

  // ── Columnas por entidad (país / producto) ──
  function synth(ents, ms) {
    var out = { baseline: { rr: {}, ct: {} }, goal: { rr: {}, ct: {} } };
    ents.forEach(function (e) {
      ['baseline', 'goal'].forEach(function (sc) {
        [['rr', 'rr_monthly'], ['ct', 'ct_monthly']].forEach(function (p) {
          var mm = ((e.g || {})[sc] || {})[p[1]] || {};
          Object.keys(mm).forEach(function (k) {
            var s = 0;
            ms.forEach(function (m) { s += (mm[k] && mm[k][m]) || 0; });
            (out[sc][p[0]][k] || (out[sc][p[0]][k] = {}))[e.key] = s;
          });
        });
      });
    });
    return out;
  }
  function hasData(g) {
    return ['baseline', 'goal'].some(function (sc) {
      var m = ((g || {})[sc] || {}).ct_monthly || {};
      return Object.keys(m).some(function (k) { return Object.keys(m[k] || {}).some(function (x) { return Math.abs(m[k][x] || 0) > 0.5; }); });
    });
  }
  // País de la columna (grupo del dashboard: "Peru + Ecuador", "Other Countries") contra el filtro de países
  function paisMatch(label, sel) {
    if (!sel.length) return true;
    var l = label.toLowerCase();
    if (l === 'other countries') return sel.some(function (p) { return EXPLICIT.indexOf(p) < 0; });
    return l.split(' + ').some(function (p) { return sel.indexOf(p) >= 0; });
  }
  function breakdown(f, dim) {
    var k = dim + '|' + JSON.stringify(f);
    if (cache[k]) return cache[k];
    if (!busy[k]) {
      busy[k] = true;
      W.google.script.run
        .withSuccessHandler(function (r) { cache[k] = r || { available: false }; delete busy[k]; if (cols !== 'periodo') W._refreshBGViews_(); })
        .withFailureHandler(function (e) { cache[k] = { available: false, error: (e && e.message) || String(e) }; delete busy[k]; if (cols !== 'periodo') W._refreshBGViews_(); })
        .getEPMBreakdown(f, dim);
    }
    return null;
  }
  function renderMain(d) {
    var ms = months(), per = periodLabel(ms), head = document.getElementById('bg-scenario-head'), qh = document.getElementById('bg-quarters-head'), body = document.getElementById('bg-body');
    function msg(html) { head.innerHTML = ''; qh.innerHTML = ''; body.innerHTML = '<tr><td style="padding:22px 16px;color:var(--muted);font-size:13px;text-align:left">' + html + '</td></tr>'; }
    function draw(ents) {
      var keys = ents.map(function (e) { return e.key; }), n = keys.length, s = synth(ents, ms);
      W._bgPeriodTotalMembers = null;
      head.innerHTML = W.buildBGScenHead(n);
      qh.innerHTML = W.buildBGQHead(keys, n);
      body.innerHTML = '';
      W.fillBGBody(body, keys, s.baseline, s.goal, 'bg-table');
    }
    var f = W.getContableFilters(), selPais = (f.pais || []).map(function (p) { return String(p).toLowerCase(); });
    document.getElementById('bg-period-label').textContent = 'Baseline (' + W._epmBaselineLabel() + ')  |  Goal: ' + W._epmGoalLabel();
    if (cols === 'pais') {
      setTitle('Abierto por País · ' + per);
      var bc = d.by_country || {}, ents = [];
      Object.keys(bc).forEach(function (k) { if (k !== 'Total' && hasData(bc[k]) && paisMatch(k, selPais)) ents.push({ key: k, g: bc[k] }); });
      ents.push({ key: 'Total', g: d.total });
      return draw(ents);
    }
    setTitle('Abierto por Producto · ' + per);
    if (!hasProd()) return msg('La apertura por producto está disponible en <b>B2B</b>, <b>API</b> y <b>HTML</b>: la base contable de B2B2C no viene abierta por producto.');
    var r = breakdown(f, 'prod');
    if (!r) return msg('Calculando el P&amp;L por producto…');
    if (r.error) return msg('No se pudo calcular por producto: ' + esc(r.error));
    if (!r.available) return msg('Sin apertura por producto para esta selección.');
    var selProd = (f.producto || []).map(function (p) { return String(p).toLowerCase(); });
    var pe = (r.items || []).filter(function (it) { return hasData(it.data) && (!selProd.length || selProd.indexOf(String(it.label).toLowerCase()) >= 0); })
      .map(function (it) { return { key: cap(it.label), g: it.data }; });
    pe.push({ key: 'Total', g: d.total });
    draw(pe);
  }

  // ── Secciones: estado de la página según la sección ──
  function layoutSection() {
    var fr = document.getElementById('cont-filters-row'), fgP = document.getElementById('fg-cont-producto');
    if (fr) fr.style.display = '';
    if (fgP) fgP.style.display = hasProd() ? '' : 'none';
    var wf = document.getElementById('cont-waterfall-section');
    if (wf) wf.style.display = sec === 'combined' ? '' : 'none';
    var disc = document.getElementById('cont-disclaimer');
    if (disc) disc.style.display = S().lob === 'b2b2c' ? 'none' : '';
    SECS.forEach(function (s) { var b = document.getElementById('pa-sec-' + s.k); if (b) b.classList.toggle('cont-stab-active', s.k === sec); });
  }
  function goSection(k) {
    sec = k;
    save('pa-sec', k);
    refill = true;
    ['ms-cont-pais', 'ms-cont-producto'].forEach(function (id) {
      var w = document.getElementById(id);
      if (w) w.querySelectorAll('.ms-option input').forEach(function (c) { c.checked = false; });
      if (typeof W.updateMsLabel === 'function') W.updateMsLabel(id);
    });
    if (W._bgContableView !== 'combined') W.setContableView('combined');
    else { layoutSection(); W.debouncedFetchBG(); }
  }

  var css = document.createElement('style');
  css.textContent = '#bg-country-blocks,#cont-b2b-nav,#cont-b2b2c-nav,#cont-b2b-detail,#cont-b2b2c-detail{display:none!important}#fg-cont-lob,#cont-filters-row .fg:has(#ms-cont-canal){display:none!important}' +
    '#header-subtabs > .header-tab:not(.pa-sec){display:none!important}';
  (document.head || document.documentElement).appendChild(css);

  document.addEventListener('DOMContentLoaded', function () {
    var hBtn = document.getElementById('btn-period-h');
    var needed = ['setBGPeriod', 'getActivePeriods_', 'renderBaselineGoalTable', 'fillBGBody', 'buildBGScenHead', 'buildBGQHead', 'getContableFilters',
      '_refreshBGViews_', 'setContableView', 'debouncedFetchBG', 'fillMs'];
    if (!hBtn || needed.some(function (f) { return typeof W[f] !== 'function'; })) {
      console.warn('[pnl-accounting-layout] sin secciones / columnas: falta alguna función del dashboard');
      return;
    }
    // Secciones arriba (reemplazan B2B + B2B2C / B2B / B2B2C / Countries YoY)
    var tabs = document.getElementById('header-subtabs');
    if (tabs) SECS.forEach(function (s) {
      var b = btn('pa-sec-' + s.k, s.lbl, s.title || s.lbl, 'header-tab pa-sec');
      b.addEventListener('click', function () { goSection(s.k); });
      tabs.appendChild(b);
    });
    var origFilters = W.getContableFilters;
    W.getContableFilters = function () {
      var f = origFilters.apply(this, arguments), s = S();
      f.lobGroup = s.lob;
      f.canal = s.canal.slice();
      if (!hasProd()) f.producto = [];
      return f;
    };
    var origView = W.setContableView;
    W.setContableView = function (view) {
      // Accesos directos (?view=contable-b2b / contable-b2b2c, redirección desde el P&L Dashboard): eligen la sección
      if ((view === 'b2b' || view === 'b2b2c') && sec !== view) { sec = view; save('pa-sec', sec); refill = true; }
      var r = origView.call(this, 'combined');   // todas las secciones usan la vista consolidada
      layoutSection();
      return r;
    };
    // Al cambiar de sección, las opciones de País / Producto son las de esa sección (vienen en la respuesta)
    var origRender = W.renderBaselineGoalTable;
    W.renderBaselineGoalTable = function (d) {
      if (refill && d && d.filters) {
        refill = false;
        W.fillMs('ms-cont-pais', d.filters.pais || []);
        W.fillMs('ms-cont-producto', hasProd() ? (d.filters.produto || []) : []);
      }
      layoutSection();
      if (cols === 'periodo' || W._activeLob !== 'contable-epm' || !d) {
        var r = origRender.apply(this, arguments);
        if (cols === 'periodo') setTitle(periodTitle());
        return r;
      }
      try { return renderMain(d); } catch (e) { console.warn('[pnl-accounting-layout] columnas:', e); return origRender.apply(this, arguments); }
    };

    // Período "Año": una sola columna con el FY (internamente sigue en modo Quarter: la columna es "Total FYxx")
    var yBtn = btn('btn-period-y', 'Año', 'Una sola columna con el año fiscal completo');
    hBtn.parentNode.insertBefore(yBtn, hBtn.nextSibling);
    yBtn.addEventListener('click', function () { W.setBGPeriod('y'); });
    var chips = document.getElementById('bg-period-chips');
    var origSet = W.setBGPeriod;
    W.setBGPeriod = function (mode) {
      year = mode === 'y';
      if (chips) chips.style.visibility = year ? 'hidden' : '';   // con Año no hay chips que elegir
      var r = origSet.call(this, year ? 'q' : mode);
      yBtn.classList.toggle('prd-active', year);
      if (year) { var qb = document.getElementById('btn-period-q'); if (qb) qb.classList.remove('prd-active'); }
      if (cols === 'periodo') setTitle(periodTitle());
      return r;
    };
    var origAP = W.getActivePeriods_;
    W.getActivePeriods_ = function (dq) {
      if (year && dq && dq.length) { W._bgPeriodTotalMembers = null; return [dq[dq.length - 1]]; }
      return origAP.apply(this, arguments);
    };

    // Selector "Columnas"
    var sep = document.createElement('span');
    sep.style.cssText = 'width:1px;height:18px;background:rgba(0,0,0,.15);margin:0 2px';
    var lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:11px;color:#3a4048;font-weight:700';
    lbl.textContent = 'Columnas:';
    var grp = document.createElement('div');
    grp.className = 'prd-toggle';
    var opts = [['periodo', 'Período', 'Columnas por mes / quarter / half / año'], ['pais', 'País', 'Una columna por país, con el total del período elegido'],
      ['prod', 'Producto', 'Una columna por producto, con el total del período elegido (B2B, API y HTML)']];
    opts.forEach(function (o) {
      var b = btn('btn-cols-' + o[0], o[1], o[2]);
      b.classList.toggle('prd-active', o[0] === cols);
      b.addEventListener('click', function () {
        cols = o[0];
        save('pa-cols', cols);
        opts.forEach(function (x) { document.getElementById('btn-cols-' + x[0]).classList.toggle('prd-active', x[0] === cols); });
        W._refreshBGViews_();
      });
      grp.appendChild(b);
    });
    var anchor = hBtn.parentNode;
    anchor.parentNode.insertBefore(sep, anchor.nextSibling);
    sep.parentNode.insertBefore(lbl, sep.nextSibling);
    lbl.parentNode.insertBefore(grp, lbl.nextSibling);
    // La navegación inicial (?view=…, ownia-nav.js) pudo abrir la vista B2B / B2B2C vieja antes de esta capa: se vuelve a la consolidada
    if (W._bgContableView && W._bgContableView !== 'combined') W.setContableView('combined');
    else { layoutSection(); if (sec !== 'combined') W.debouncedFetchBG(); }   // la primera carga pudo salir antes que estos filtros
  });
})();
