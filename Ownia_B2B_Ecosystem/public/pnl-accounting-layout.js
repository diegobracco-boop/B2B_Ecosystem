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


/* Columnas del P&L — Baseline vs Goal (2026-10-30, Diego): período "Año" junto a Mes / Quarter / Half, y selector
 * "Columnas: Período / País / Producto". Por país o producto, cada columna es el total del período elegido (Año, o
 * los meses / quarters / halves marcados en los chips; sin marcar = el FY).
 *  - B2B + B2B2C: la tabla principal pasa a una columna por país (by_country, ya viene en la respuesta) o por producto.
 *  - B2B y B2B2C: arriba del detalle se agrega un bloque "Por país / Por producto" que respeta el país y el canal elegidos.
 * Producto y el bloque de B2B / B2B2C los calcula getEPMBreakdown (server/gas-extras/pnl-accounting-byprod.js); la base
 * contable solo viene abierta por producto en B2B. Las tablas se arman con las funciones del dashboard (buildBGScenHead /
 * buildBGQHead / fillBGBody). Solo la vista EPM. ?cols=pais|prod en la URL abre directo así.
 */
(function () {
  'use strict';
  var W = window, LS = 'pa-cols';
  var cols = 'periodo', year = false, cache = {}, busy = {};
  try { cols = { pais: 'pais', prod: 'prod' }[localStorage.getItem(LS)] || 'periodo'; } catch (e) { /* sin storage */ }
  var qCols = /[?&]cols=(periodo|pais|prod)(&|$)/.exec(location.search);
  if (qCols) cols = qCols[1];
  var MODE_LBL = { m: 'Mes', q: 'Quarter', h: 'Semestre' };
  var NO_PROD = 'La apertura por producto está disponible en <b>B2B</b> (Total, MAY o MIN): la base contable de B2B2C no viene abierta por producto.';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cap(s) { return String(s).replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); }); }
  function btn(id, txt, title) {
    var b = document.createElement('button');
    b.id = id; b.className = 'prd-btn'; b.type = 'button'; b.textContent = txt;
    if (title) b.title = title;
    return b;
  }
  function fy() { return W.FY_TAG || ''; }

  // Meses del período elegido (orden fiscal)
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
  function setTitle(txt) { var t = document.getElementById('bg-period-title'); if (t) t.textContent = txt; }
  function periodTitle() { return year ? 'Agrupado por Año · ' + fy() : 'Agrupado por ' + (MODE_LBL[W._bgPeriodMode] || 'Quarter') + ' · ' + fy(); }

  // {baseline,goal:{rr,ct}} con una "columna" por entidad = suma de los meses elegidos
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
  // Llena un thead (2 filas) y un tbody con una columna por entidad (la última, Total)
  function fill(theadScen, theadQ, tbody, ents, ms, tableId) {
    var keys = ents.map(function (e) { return e.key; }), n = keys.length, s = synth(ents, ms);
    W._bgPeriodTotalMembers = null;
    theadScen.innerHTML = W.buildBGScenHead(n);
    theadQ.innerHTML = W.buildBGQHead(keys, n);
    tbody.innerHTML = '';
    W.fillBGBody(tbody, keys, s.baseline, s.goal, tableId);
  }
  function entsFrom(items, total, prod) {
    var e = (items || []).filter(function (it) { return hasData(it.data); }).map(function (it) { return { key: prod ? cap(it.label) : it.label, g: it.data }; });
    if (total) e.push({ key: 'Total', g: total });
    return e;
  }

  // getEPMBreakdown con caché por filtros + dimensión; al llegar, se vuelve a dibujar
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

  // ── B2B + B2B2C: la tabla principal ──
  function renderMain(d) {
    var ms = months(), per = periodLabel(ms), head = document.getElementById('bg-scenario-head'), qh = document.getElementById('bg-quarters-head'), body = document.getElementById('bg-body');
    function msg(html) { head.innerHTML = ''; qh.innerHTML = ''; body.innerHTML = '<tr><td style="padding:22px 16px;color:var(--muted);font-size:13px;text-align:left">' + html + '</td></tr>'; }
    document.getElementById('bg-period-label').textContent = 'Baseline (' + W._epmBaselineLabel() + ')  |  Goal: ' + W._epmGoalLabel();
    if (cols === 'pais') {
      setTitle('Abierto por País · ' + per);
      var bc = d.by_country || {}, items = Object.keys(bc).filter(function (k) { return k !== 'Total'; }).map(function (k) { return { label: k, data: bc[k] }; });
      return fill(head, qh, body, entsFrom(items, bc.Total || d.total), ms, 'bg-table');
    }
    setTitle('Abierto por Producto · ' + per);
    var r = breakdown(W.getContableFilters(), 'prod');
    if (!r) return msg('Calculando el P&amp;L por producto…');
    if (r.error) return msg('No se pudo calcular por producto: ' + esc(r.error));
    if (!r.available) return msg(NO_PROD + ' Elegí la pestaña B2B o volvé a Columnas: Período / País.');
    fill(head, qh, body, entsFrom(r.items, d.total, true), ms, 'bg-table');
  }

  // ── B2B / B2B2C: bloque "Por país / Por producto" arriba del detalle ──
  function renderTabBlock(view, d) {
    var detail = document.getElementById(view === 'b2b' ? 'cont-b2b-detail' : 'cont-b2b2c-detail');
    if (!detail || !d) return;
    var old = document.getElementById('ow-cols-block');
    if (old) old.remove();
    var ms = months(), per = periodLabel(ms), sel = view === 'b2b' ? W._b2bCurrentSel : W._b2b2cCurrentSel;
    var canal = view === 'b2b' ? W._b2bCanalFilter : 'total';
    var f = W.getContableFilters();
    f.lobGroup = view;
    f.canal = (canal === 'may' || canal === 'min') ? [canal] : [];
    f.pais = (sel && sel.pais) || [];
    var total = canal === 'may' ? (d.may && d.may.total) : canal === 'min' ? (d.min && d.min.total) : d.total;
    var title = (cols === 'pais' ? 'Por país' : 'Por producto') + ' · ' + ((sel && sel.label) || '') + (f.canal.length ? ' · ' + canal.toUpperCase() : '') + ' · ' + per;

    var sec = document.createElement('div');
    sec.className = 'sec';
    sec.id = 'ow-cols-block';
    sec.style.marginTop = '16px';
    var t = document.createElement('div');
    t.className = 'sec-title';
    t.textContent = title;
    var card = document.createElement('div');
    card.className = 'pnl-card';
    sec.appendChild(t);
    sec.appendChild(card);
    detail.insertBefore(sec, detail.firstChild);

    var r = breakdown(f, cols);
    if (!r || r.error || !r.available) {
      card.innerHTML = '<div style="padding:18px 16px;color:var(--muted);font-size:13px">' +
        (!r ? 'Calculando…' : r.error ? 'No se pudo calcular: ' + esc(r.error) : NO_PROD) + '</div>';
      return;
    }
    var ents = entsFrom(r.items, total, cols === 'prod');
    if (ents.length <= 1) { card.innerHTML = '<div style="padding:18px 16px;color:var(--muted);font-size:13px">Sin apertura para mostrar con esta selección.</div>'; return; }
    var wrap = document.createElement('div');
    wrap.style.overflowX = 'auto';
    var tbl = document.createElement('table');
    tbl.className = 'qpnl-table';
    tbl.id = 'bg-table-ow-cols';
    var thead = document.createElement('thead'), r1 = document.createElement('tr'), r2 = document.createElement('tr'), tbody = document.createElement('tbody');
    thead.appendChild(r1); thead.appendChild(r2); tbl.appendChild(thead); tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    card.appendChild(wrap);
    fill(r1, r2, tbody, ents, ms, tbl.id);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var hBtn = document.getElementById('btn-period-h');
    var needed = ['setBGPeriod', 'getActivePeriods_', 'renderBaselineGoalTable', 'fillBGBody', 'buildBGScenHead', 'buildBGQHead', 'getContableFilters', '_refreshBGViews_'];
    if (!hBtn || needed.some(function (f) { return typeof W[f] !== 'function'; })) {
      console.warn('[pnl-accounting-layout] sin columnas por país / producto: falta alguna función del dashboard');
      return;
    }
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
      if (year) { var q = document.getElementById('btn-period-q'); if (q) q.classList.remove('prd-active'); }
      if (year && cols === 'periodo') setTitle(periodTitle());
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
      ['prod', 'Producto', 'Una columna por producto, con el total del período elegido (solo B2B)']];
    opts.forEach(function (o) {
      var b = btn('btn-cols-' + o[0], o[1], o[2]);
      b.classList.toggle('prd-active', o[0] === cols);
      b.addEventListener('click', function () {
        cols = o[0];
        try { localStorage.setItem(LS, cols); } catch (e) { /* sin storage */ }
        opts.forEach(function (x) { document.getElementById('btn-cols-' + x[0]).classList.toggle('prd-active', x[0] === cols); });
        if (cols === 'periodo') setTitle(periodTitle());
        W._refreshBGViews_();
      });
      grp.appendChild(b);
    });
    var anchor = hBtn.parentNode;
    anchor.parentNode.insertBefore(sep, anchor.nextSibling);
    sep.parentNode.insertBefore(lbl, sep.nextSibling);
    lbl.parentNode.insertBefore(grp, lbl.nextSibling);

    var origRender = W.renderBaselineGoalTable;
    W.renderBaselineGoalTable = function (d) {
      if (cols === 'periodo' || W._activeLob !== 'contable-epm' || !d) return origRender.apply(this, arguments);
      try { return renderMain(d); } catch (e) { console.warn('[pnl-accounting-layout] columnas:', e); return origRender.apply(this, arguments); }
    };
    [['renderB2BCountryDetail', 'b2b'], ['renderB2B2CCountryDetail', 'b2b2c']].forEach(function (p) {
      var orig = W[p[0]];
      if (typeof orig !== 'function') return;
      W[p[0]] = function (d) {
        var r = orig.apply(this, arguments);
        if (cols !== 'periodo' && W._activeLob === 'contable-epm') { try { renderTabBlock(p[1], d); } catch (e) { console.warn('[pnl-accounting-layout] bloque columnas:', e); } }
        return r;
      };
    });
  });
})();
