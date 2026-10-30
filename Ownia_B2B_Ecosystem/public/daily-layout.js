/* Layout del Daily Dashboard en Ownia. Lo inyecta server/index.js solo en ese módulo (`layout` en
 * server/modules.js), después de ownia-nav.js. El HTML de Apps Script no se toca: el equipo sigue
 * publicando el Daily con /clasp-push, y lo que vive acá no viaja a GAS.
 *
 * Solapa "Industry events tracker" (2026-10-24): performance YoY día a día de los eventos comerciales
 * de industria (Cyber Monday, Black Friday, El Buen Fin, Hot Sale, Travel Sale…) por país.
 *  - Eventos: industry_events.json (Daily_Dashboard/industry_events_sync.py, desde los calendarios de
 *    "Estacionalidad Diaria"): B2B2C y B2C usan el calendario de WLs; B2B el de B2B.
 *  - Datos: los mismos JSON que ya carga el Daily (_rawB2BC, _rawB2B; B2B en base GD). El LY de
 *    nov–dic que el Daily todavía no publica viene en industry_events.json (ly_ext); si el Daily ya
 *    tiene esa fecha, manda el del Daily.
 *  - Solo los días de evento (sin pre ni post, por pedido de Diego), alineados por día de evento: D1 de
 *    este año vs D1 del año pasado (aunque caigan en fechas distintas). Sin evento el año pasado:
 *    mismas fechas −364 días (mismo día de la semana). Si el evento dura distinto que el año pasado,
 *    el YoY compara el promedio diario (marcado con †).
 */
(function () {
  'use strict';

  var METRICS = [['gb', 'GB'], ['nr', 'Net Revenue'], ['fvm', 'FVM']];
  var LOBS = [['b2b2c', 'B2B2C'], ['b2b', 'B2B'], ['b2c', 'B2C']];
  var OTHER = { USA: 'Other Countries', Paraguay: 'Other Countries', Uruguay: 'Other Countries' };
  var TOTAL = '__total';
  var GROUP_GAP = 10;   // eventos de la misma familia que arrancan con ≤ 10 días de diferencia = mismo grupo
  var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  var st = { lob: 'b2b2c', metric: 'gb', sel: null };
  var ev = null, evState = 'idle', evError = '';
  var seriesCache = {};
  var chart = null;
  var active = false;

  // ── Fechas (strings YYYY-MM-DD, en UTC para no depender del huso) ──
  function d2s(d) { return d.toISOString().slice(0, 10); }
  function s2d(s) { return new Date(s + 'T00:00:00Z'); }
  function addDays(s, n) { var d = s2d(s); d.setUTCDate(d.getUTCDate() + n); return d2s(d); }
  function diffDays(a, b) { return Math.round((s2d(a) - s2d(b)) / 86400000); }
  function fmtDay(s) { if (!s) return '—'; var d = s2d(s); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
  function fmtRange(a, b) { return a === b ? fmtDay(a) : fmtDay(a) + ' – ' + fmtDay(b); }

  function fmtMoney(v) {
    if (v == null || isNaN(v)) return '—';
    var a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e3) return s + '$' + Math.round(a / 1e3) + 'k';
    return s + '$' + Math.round(a);
  }
  function pct(a, b) { return (a == null || b == null || !b) ? null : (a / b - 1) * 100; }
  function fmtPct(p) { return p == null || !isFinite(p) ? '—' : (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(1) + '%'; }
  function pctCls(p) { return p == null || !isFinite(p) ? '' : p >= 0 ? 'iet-pos' : 'iet-neg'; }
  function yoyHtml(s) {
    return fmtPct(s.yoy) + (s.perDay && s.yoy != null ? '<span class="iet-dim" title="El evento dura distinto que el año pasado: YoY del promedio diario"> †</span>' : '');
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ── Datos diarios por LoB: map[fecha][pais] = [gb, nr, fvm] ──
  function rowsOf(x) {
    if (Array.isArray(x)) return x;
    if (!x || !x.cols) return [];
    var cols = x.cols;
    return x.rows.map(function (r) { var o = {}; for (var i = 0; i < cols.length; i++) o[cols[i]] = r[i]; return o; });
  }
  function rawFor(lob) { return lob === 'b2b' ? window._rawB2B : window._rawB2BC; }
  function lastDate() {
    var r = window._rawB2BC || window._rawB2B;
    return r && r.meta ? r.meta.last_actuals_date : null;
  }

  function buildSeries(lob) {
    var key = lob + '|' + (window._exCoiBr ? 1 : 0) + '|' + (ev ? ev.meta.generated_at : '');
    if (seriesCache[lob] && seriesCache[lob].key === key) return seriesCache[lob];
    var raw = rawFor(lob);
    var map = {};
    function add(r, fvmExt) {
      var f = r.fecha; if (!f) return;
      if (r.pais === 'RG' && !window._exCoiBr) return;   // ajuste COI Brasil: solo con el switch en Excluir
      var p = OTHER[r.pais] || r.pais;
      var nr = r.net_revenues != null ? r.net_revenues : r.net_revenue;
      var fvm = r.fvm;
      var day = map[f] || (map[f] = {});
      var v = day[p] || (day[p] = [0, 0, 0]);
      v[0] += +r.gross_bookings || 0; v[1] += +nr || 0; v[2] += +fvm || 0;
    }
    var srcs = lob === 'b2b' ? ['b2b_gd', 'b2b_gd_ly', 'b2b_gd_ly_ext']
      : lob === 'b2c' ? ['b2c', 'b2c_ly'] : ['actuals', 'actuals_ly'];
    srcs.forEach(function (k) { rowsOf(raw && raw[k]).forEach(function (r) { add(r, false); }); });
    // LY que el Daily todavía no publica (solo fechas que no tiene).
    var ext = ev && ev.ly_ext && ev.ly_ext[lob];
    if (ext) {
      var have = {};
      Object.keys(map).forEach(function (f) { have[f] = 1; });
      rowsOf(ext).forEach(function (r) { if (!have[r.fecha]) add(r, true); });
    }
    seriesCache[lob] = { key: key, map: map };
    return seriesCache[lob];
  }

  var MI = { gb: 0, nr: 1, fvm: 2 };
  function val(lob, pais, fecha) {
    if (!fecha) return null;
    var last = lastDate();
    if (last && fecha > last) return null;
    var day = buildSeries(lob).map[fecha];
    if (!day) return null;
    var i = MI[st.metric];
    if (pais !== TOTAL) return day[pais] ? day[pais][i] : 0;
    var s = 0; for (var p in day) s += day[p][i];
    return s;
  }

  // ── Eventos ──
  function calLob(lob) { return lob === 'b2b' ? 'b2b' : 'b2b2c'; }
  function cyYear() { var l = lastDate(); return l ? +l.slice(0, 4) : new Date().getFullYear(); }

  // Par evento de este año ↔ evento del año pasado (misma familia y país; si hay varios, el más cercano
  // por día del año). Sin match: mismas fechas −364 días.
  function pairsFor(lob) {
    var cl = calLob(lob), y = cyYear();
    var all = (ev.eventos || []).filter(function (e) { return e.lob === cl; });
    return all.filter(function (e) { return e.anio === y; }).map(function (e) {
      var best = null, bestD = 1e9;
      all.forEach(function (o) {
        if (o.anio !== y - 1 || o.pais !== e.pais || o.familia !== e.familia) return;
        var d = Math.abs(diffDays(addDays(o.inicio, 364), e.inicio));
        if (d < bestD) { best = o; bestD = d; }
      });
      var ly = best ? { inicio: best.inicio, fin: best.fin, dias: best.dias, match: true }
        : { inicio: addDays(e.inicio, -364), fin: addDays(e.fin, -364), dias: e.dias, match: false };
      return { cy: e, ly: ly };
    });
  }

  function groupsFor(lob) {
    var pairs = pairsFor(lob).sort(function (a, b) { return a.cy.inicio < b.cy.inicio ? -1 : a.cy.inicio > b.cy.inicio ? 1 : a.cy.pais < b.cy.pais ? -1 : 1; });
    var groups = [];
    pairs.forEach(function (p) {
      var g = groups.filter(function (x) { return x.familia === p.cy.familia && Math.abs(diffDays(p.cy.inicio, x.inicio)) <= GROUP_GAP; })[0];
      if (!g) { g = { familia: p.cy.familia, inicio: p.cy.inicio, fin: p.cy.fin, pairs: [] }; groups.push(g); }
      g.pairs.push(p);
      if (p.cy.fin > g.fin) g.fin = p.cy.fin;
      if (p.cy.inicio < g.inicio) g.inicio = p.cy.inicio;
    });
    groups.forEach(function (g, i) { g.id = lob + ':' + i + ':' + g.familia; });
    // En curso y próximos arriba (por fecha); los terminados abajo, el más reciente primero.
    var rank = { live: 0, next: 1, done: 2 };
    return groups.sort(function (a, b) {
      var ra = rank[status(a.pairs[0]).k], rb = rank[status(b.pairs[0]).k];
      if (ra !== rb) return ra - rb;
      return ra === 2 ? (a.inicio < b.inicio ? 1 : -1) : (a.inicio < b.inicio ? -1 : 1);
    });
  }

  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function status(p) {
    var last = lastDate();
    if (!last || last < p.cy.inicio) return { k: 'next', days: Math.max(0, diffDays(p.cy.inicio, today())), done: 0 };
    if (last >= p.cy.fin) return { k: 'done', done: p.cy.dias };
    return { k: 'live', done: diffDays(last, p.cy.inicio) + 1 };
  }

  // Totales del evento de un par (o varios, para el total del grupo). En curso: este año a la fecha vs
  // los mismos días de evento del año pasado.
  function sumRange(lob, pais, a, n) { var s = 0; for (var i = 0; i < n; i++) s += val(lob, pais, addDays(a, i)) || 0; return s; }
  function pairStats(lob, p, metricLob) {
    var L = metricLob || lob;
    var s = status(p);
    var nCy = s.k === 'next' ? 0 : s.done;
    var nLy = s.k === 'done' ? p.ly.dias : Math.min(nCy, p.ly.dias);
    var cy = nCy ? sumRange(L, p.cy.pais, p.cy.inicio, nCy) : null;
    var ly = sumRange(L, p.cy.pais, p.ly.inicio, s.k === 'next' ? p.ly.dias : nLy);
    var lyFull = sumRange(L, p.cy.pais, p.ly.inicio, p.ly.dias);
    // Eventos de distinta duración (Hot Sale AR B2B: 7 días vs 3): el YoY compara el promedio diario.
    var perDay = !!nCy && nCy !== nLy;
    return {
      st: s, cy: cy, ly: ly, lyFull: lyFull, nCy: nCy, nLy: s.k === 'next' ? p.ly.dias : nLy,
      perDay: perDay, yoy: !nCy ? null : perDay ? pct(cy / nCy, nLy ? ly / nLy : null) : pct(cy, ly),
    };
  }
  function groupStats(lob, g, metricLob) {
    var t = { cy: 0, ly: 0, lyFull: 0, cyDays: 0, lyUsed: 0, any: false, perDay: false };
    g.pairs.forEach(function (p) {
      var s = pairStats(lob, p, metricLob);
      if (s.cy != null) { t.cy += s.cy; t.any = true; t.cyDays += s.nCy; }
      t.ly += s.ly; t.lyUsed += s.nLy; t.lyFull += s.lyFull;
      t.perDay = t.perDay || s.perDay;
    });
    return {
      cy: t.any ? t.cy : null, ly: t.ly, lyFull: t.lyFull, perDay: t.perDay,
      yoy: !t.any ? null : t.perDay ? pct(t.cy / t.cyDays, t.lyUsed ? t.ly / t.lyUsed : null) : pct(t.cy, t.ly),
    };
  }

  // ── Render ──
  function el(id) { return document.getElementById(id); }

  function renderAll() {
    if (!active) return;
    var body = el('iet-body');
    if (!body) return;
    if (!lastDate() || (st.lob === 'b2b' && !window._rawB2B)) {
      body.innerHTML = '<div class="iet-empty">Cargando datos del Daily…</div>';
      setTimeout(renderAll, 600);
      return;
    }
    if (evState === 'loading' || evState === 'idle') { body.innerHTML = '<div class="iet-empty">Cargando calendario de eventos…</div>'; return; }
    if (evState === 'error') { body.innerHTML = '<div class="iet-empty">No se pudo leer industry_events.json: ' + esc(evError) + '</div>'; return; }
    var groups = groupsFor(st.lob);
    if (!groups.length) { el('iet-evsel').innerHTML = ''; body.innerHTML = '<div class="iet-empty">No hay eventos de ' + cyYear() + ' en el calendario.</div>'; return; }
    if (!st.sel || !findSel(groups)) st.sel = defaultSel(groups);
    el('iet-evsel').innerHTML = selectorsHtml(groups);
    body.innerHTML = '<div id="iet-detail"></div>';
    renderDetail(groups);
    el('iet-asof').textContent = 'Datos al ' + fmtDay(lastDate()) + ' · ' + LOB_NOTE[st.lob];
  }
  var LOB_NOTE = {
    b2b2c: 'B2B2C · calendario de eventos WL',
    b2b: 'B2B en base generación (GD) · calendario de eventos B2B',
    b2c: 'B2C de referencia · calendario de eventos WL',
  };

  function defaultSel(groups) {
    var order = { live: 0, next: 1, done: 2 };
    var best = null, bestK = null;
    groups.forEach(function (g) {
      var s = status(g.pairs[0]);
      var k = [order[s.k], s.k === 'done' ? -s2d(g.fin) : s2d(g.inicio)];
      if (!bestK || k[0] < bestK[0] || (k[0] === bestK[0] && k[1] < bestK[1])) { best = g; bestK = k; }
    });
    return { g: best.id, pais: TOTAL };
  }
  function findSel(groups) {
    var g = groups.filter(function (x) { return x.id === st.sel.g; })[0];
    if (!g) return null;
    if (st.sel.pais !== TOTAL && !g.pairs.some(function (p) { return p.cy.pais === st.sel.pais; })) st.sel.pais = TOTAL;
    return g;
  }

  function statusHtml(p) {
    var s = status(p);
    if (s.k === 'next') return '<span class="iet-badge iet-b-next">' + (s.days ? 'Próximo · en ' + s.days + ' d' : 'Empieza hoy') + '</span>';
    if (s.k === 'live') return '<span class="iet-badge iet-b-live">En curso · día ' + s.done + '/' + p.cy.dias + '</span>';
    return '<span class="iet-badge iet-b-done">Terminado</span>';
  }

  // Selectores de evento y país (reemplazan a la tabla resumen: la solapa muestra un evento por vez).
  var ST_LBL = { live: 'En curso', next: 'Próximos', done: 'Terminados' };
  function selectorsHtml(groups) {
    var h = '<span class="iet-ctrl-lbl">Evento</span><select class="iet-select" data-fn="ev">';
    ['live', 'next', 'done'].forEach(function (k) {
      var gs = groups.filter(function (g) { return status(g.pairs[0]).k === k; });
      if (!gs.length) return;
      h += '<optgroup label="' + ST_LBL[k] + '">' + gs.map(function (g) {
        var who = g.pairs.length > 1 ? g.pairs.length + ' países' : g.pairs[0].cy.pais;
        return '<option value="' + esc(g.id) + '"' + (g.id === st.sel.g ? ' selected' : '') + '>' +
          esc(g.familia + ' · ' + who + ' · ' + fmtRange(g.inicio, g.fin)) + '</option>';
      }).join('') + '</optgroup>';
    });
    h += '</select>';
    var g = findSel(groups);
    if (g && g.pairs.length > 1) {
      var ps = g.pairs.slice().sort(function (a, b) { return pairStats(st.lob, b).lyFull - pairStats(st.lob, a).lyFull; });
      h += '<span class="iet-ctrl-lbl">País</span><select class="iet-select" data-fn="pais">' +
        '<option value="' + TOTAL + '">Total ' + g.pairs.length + ' países</option>' +
        ps.map(function (p) { return '<option value="' + esc(p.cy.pais) + '"' + (st.sel.pais === p.cy.pais ? ' selected' : '') + '>' + esc(p.cy.pais) + '</option>'; }).join('') +
        '</select>';
    }
    return h;
  }

  // Eje: solo días de evento, alineados al inicio (o = días desde D1), hasta el más largo de los dos
  // años. Cada país y cada año suma solo en sus propios días de evento: si un año el evento fue más
  // corto, esos días quedan sin dato de ese lado.
  function axisFor(pairs) {
    var n = 0;
    pairs.forEach(function (p) { n = Math.max(n, p.cy.dias, p.ly.dias); });
    var pos = [];
    for (var o = 0; o < n; o++) pos.push({ o: o, lbl: 'D' + (o + 1) });
    return pos;
  }
  function dateAt(side, ps) { return ps.o < side.dias ? addDays(side.inicio, ps.o) : null; }
  function seriesAt(lob, pairs, ps) {
    var cy = 0, ly = 0, anyCy = false, anyLy = false;
    pairs.forEach(function (p) {
      var vc = val(lob, p.cy.pais, dateAt(p.cy, ps)), vl = val(lob, p.cy.pais, dateAt(p.ly, ps));
      if (vc != null) { cy += vc; anyCy = true; }
      if (vl != null) { ly += vl; anyLy = true; }
    });
    return { cy: anyCy ? cy : null, ly: anyLy ? ly : null };
  }

  function renderDetail(groups) {
    var g = findSel(groups);
    var box = el('iet-detail');
    if (!g || !box) return;
    var pairs = st.sel.pais === TOTAL ? g.pairs : g.pairs.filter(function (p) { return p.cy.pais === st.sel.pais; });
    var single = pairs.length === 1 ? pairs[0] : null;
    var y = cyYear(), withB2c = st.lob !== 'b2c';
    var pos = axisFor(pairs);
    var rows = pos.map(function (ps) {
      var s = seriesAt(st.lob, pairs, ps), b = withB2c ? seriesAt('b2c', pairs, ps) : null;
      return { ps: ps, cy: s.cy, ly: s.ly, b2c: b ? pct(b.cy, b.ly) : null };
    });
    // YoY acumulado desde D1: promedio diario de cada año hasta ese día (con la misma duración, es el
    // YoY de los totales; si un año el evento ya terminó, no se infla por sumar días de un solo lado).
    var accC = 0, accL = 0, nC = 0, nL = 0;
    rows.forEach(function (r) {
      if (r.cy == null) { r.acc = null; return; }
      accC += r.cy; nC++;
      if (r.ly != null) { accL += r.ly; nL++; }
      r.acc = nL ? pct(accC / nC, accL / nL) : null;
    });
    var title = g.familia + ' · ' + (single ? single.cy.pais : 'Total ' + g.pairs.length + ' países');
    var sub = single
      ? fmtRange(single.cy.inicio, single.cy.fin) + ' ' + y + ' vs ' + fmtRange(single.ly.inicio, single.ly.fin) + ' ' + (y - 1) + (single.ly.match ? '' : ' (mismas fechas −364 d)')
      : 'Suma de los países, cada uno alineado a su propio día de evento';
    var ks = groupStats(st.lob, { pairs: pairs }), kb = withB2c ? groupStats(st.lob, { pairs: pairs }, 'b2c') : null;
    var mName = METRICS.filter(function (m) { return m[0] === st.metric; })[0][1];
    var noMatch = pairs.some(function (p) { return !p.ly.match; });
    function kpi(lbl, v, cls) { return '<div class="iet-kpi"><div class="iet-kpi-lbl">' + lbl + '</div><div class="iet-kpi-v ' + (cls || '') + '">' + v + '</div></div>'; }
    var h = '<div class="tcard iet-card"><div class="card-hdr"><span class="card-ttl">' + esc(title) + ' ' + statusHtml(pairs[0]) + '</span><span class="bench-sub">' + esc(sub) + '</span></div>' +
      '<div class="iet-kpis">' +
      kpi(esc(mName) + ' ' + y, fmtMoney(ks.cy)) + kpi(esc(mName) + ' ' + (y - 1), fmtMoney(ks.ly)) +
      kpi('YoY', yoyHtml(ks), pctCls(ks.yoy)) +
      (withB2c ? kpi('YoY B2C (referencia)', yoyHtml(kb), pctCls(kb.yoy)) : '') + '</div>' +
      '<div class="iet-chart"><canvas id="iet-canvas"></canvas></div>' +
      '<div class="iet-tbl-wrap"><table class="iet-tbl iet-days"><thead><tr><th class="l">Día</th>' +
      (single ? '<th class="l">Fecha ' + y + '</th>' : '') + '<th>' + y + '</th>' +
      (single ? '<th class="l">Fecha ' + (y - 1) + '</th>' : '') + '<th>' + (y - 1) + '</th><th>YoY</th><th>YoY acumulado</th>' +
      (withB2c ? '<th>YoY B2C</th>' : '') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var p = pct(r.cy, r.ly);
      // Total: los países con evento más corto dejan de sumar; se aclara cuántos quedan ese día.
      var nP = pairs.filter(function (q) { return r.ps.o < q.cy.dias || r.ps.o < q.ly.dias; }).length;
      var tag = !single && nP < pairs.length ? ' <span class="iet-dim">· ' + nP + (nP === 1 ? ' país' : ' países') + '</span>' : '';
      h += '<tr><td class="l">' + r.ps.lbl + tag + '</td>' +
        (single ? '<td class="l iet-dim">' + fmtDay(dateAt(single.cy, r.ps)) + '</td>' : '') +
        '<td>' + fmtMoney(r.cy) + '</td>' +
        (single ? '<td class="l iet-dim">' + fmtDay(dateAt(single.ly, r.ps)) + '</td>' : '') +
        '<td>' + fmtMoney(r.ly) + '</td><td class="' + pctCls(p) + '">' + fmtPct(p) + '</td>' +
        '<td class="' + pctCls(r.acc) + '">' + fmtPct(r.acc) + '</td>' +
        (withB2c ? '<td class="' + pctCls(r.b2c) + '">' + fmtPct(r.b2c) + '</td>' : '') + '</tr>';
    });
    h += '</tbody></table></div>';
    var foot = [];
    if (noMatch) foot.push('* Sin ese evento el año pasado' + (single ? '' : ' en algún país') + ': se compara contra las mismas fechas −364 días (mismo día de la semana).');
    if (ks.perDay) foot.push('† El evento dura distinto que el año pasado: el YoY compara el promedio diario.');
    if (status(pairs[0]).k === 'live') foot.push('En curso: ' + y + ' a la fecha vs los mismos días de evento de ' + (y - 1) + '.');
    h += (foot.length ? '<div class="iet-foot">' + foot.join(' ') + '</div>' : '') + '</div>';
    box.innerHTML = h;
    drawChart(rows);
  }

  function cssVar(n, fb) { var v = getComputedStyle(document.documentElement).getPropertyValue(n); return (v && v.trim()) || fb; }

  function drawChart(rows) {
    if (chart) { chart.destroy(); chart = null; }
    var cv = el('iet-canvas');
    if (!cv || typeof window.Chart !== 'function') return;
    var y = cyYear();
    var prim = cssVar('--primary', '#5626e9'), txt = cssVar('--text-3', '#6B6B7D'), grid = cssVar('--border', 'rgba(127,127,127,.15)');
    chart = new window.Chart(cv.getContext('2d'), {
      type: 'line',
      data: {
        labels: rows.map(function (r) { return r.ps.lbl; }),
        datasets: [
          { label: String(y), data: rows.map(function (r) { return r.cy; }), borderColor: prim, backgroundColor: prim, borderWidth: 2.5, pointRadius: 3, tension: 0.25, spanGaps: false },
          { label: String(y - 1), data: rows.map(function (r) { return r.ly; }), borderColor: txt, backgroundColor: txt, borderWidth: 2, borderDash: [6, 4], pointRadius: 2, tension: 0.25 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          datalabels: { display: false },
          legend: { labels: { color: txt, boxWidth: 18, font: { size: 11 } } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + fmtMoney(c.parsed.y); },
            footer: function (items) { var r = rows[items[0].dataIndex]; var p = pct(r.cy, r.ly); return p == null ? '' : 'YoY ' + fmtPct(p); } } },
        },
        scales: {
          x: { ticks: { color: txt, font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: txt, font: { size: 10 }, callback: function (v) { return fmtMoney(v); } }, grid: { color: grid }, beginAtZero: true },
        },
      },
    });
  }

  // ── Datos del calendario ──
  function loadEvents() {
    if (evState !== 'idle') return;
    evState = 'loading';
    google.script.run
      .withSuccessHandler(function (d) { ev = d; evState = 'ok'; seriesCache = {}; renderAll(); })
      .withFailureHandler(function (e) { evState = 'error'; evError = (e && e.message) || String(e); renderAll(); })
      .getIndustryEvents();
  }

  // ── Vista y navegación ──
  var CSS = [
    '#view-industry .iet-ctrl{display:flex;gap:12px;align-items:center;flex-wrap:wrap}',
    '#view-industry .iet-ctrl-lbl{font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.07em}',
    '.iet-card{margin-bottom:16px}',
    '.iet-empty{padding:48px 0;text-align:center;color:var(--text-3);font-size:13px}',
    '.iet-tbl-wrap{overflow-x:auto}',
    '.iet-tbl{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}',
    '.iet-tbl th{font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;text-align:right;padding:6px 10px;border-bottom:1px solid var(--border);white-space:nowrap}',
    '.iet-tbl td{padding:7px 10px;text-align:right;border-bottom:1px solid var(--border);color:var(--text-2);white-space:nowrap}',
    '.iet-tbl .l{text-align:left}',
    '#view-industry .iet-ctrl-ev{margin:-4px 0 14px;justify-content:space-between}',
    '.iet-select{font:inherit;font-size:12px;font-weight:600;color:var(--text);background:var(--elevated);border:1px solid var(--border);border-radius:8px;padding:6px 10px;max-width:100%;cursor:pointer}',
    '.iet-select:focus{outline:2px solid var(--primary);outline-offset:1px}',
    '.iet-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}',
    '.iet-kpi{background:var(--segment-bg);border-radius:10px;padding:10px 14px}',
    '.iet-kpi-lbl{font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em}',
    '.iet-kpi-v{font-size:22px;font-weight:700;color:var(--text);margin-top:2px;font-variant-numeric:tabular-nums}',
    '.iet-dim{color:var(--text-3)}',
    '.iet-pos{color:var(--success)!important}',
    '.iet-neg{color:var(--danger)!important}',
    '.iet-badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px}',
    '.iet-b-live{background:var(--success-l);color:var(--success)}',
    '.iet-b-next{background:var(--primary-d);color:var(--secondary)}',
    '.iet-b-done{background:var(--elevated);color:var(--text-3)}',
    '.iet-foot{font-size:10px;color:var(--text-3);margin-top:10px}',
    '.iet-chart{position:relative;height:300px;margin-bottom:14px}',
    '.iet-days td:first-child{font-weight:700;color:var(--text)}',
    '@media (max-width:700px){.iet-chart{height:220px}}',
  ].join('\n');

  function toggleHtml(id, items, cur, fn) {
    return '<div class="tab-toggle" id="' + id + '">' + items.map(function (it) {
      return '<button class="ttab' + (it[0] === cur ? ' active' : '') + '" data-v="' + it[0] + '" data-fn="' + fn + '">' + esc(it[1]) + '</button>';
    }).join('') + '</div>';
  }

  function buildView() {
    if (el('view-industry')) return;
    var anchor = el('view-daily');
    if (!anchor) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    var v = document.createElement('div');
    v.id = 'view-industry';
    v.style.display = 'none';
    v.innerHTML = '<div class="content">' +
      '<div class="section-hdr-row"><div class="section-hdr">Industry events tracker</div>' +
      '<div class="iet-ctrl"><span class="iet-ctrl-lbl">LoB</span>' + toggleHtml('iet-lob', LOBS, st.lob, 'lob') +
      '<span class="iet-ctrl-lbl">Métrica</span>' + toggleHtml('iet-metric', METRICS, st.metric, 'metric') +
      '</div></div>' +
      '<div class="iet-ctrl iet-ctrl-ev"><span id="iet-evsel" class="iet-ctrl"></span><span class="bench-sub" id="iet-asof"></span></div>' +
      '<div id="iet-body"></div></div>';
    anchor.parentNode.insertBefore(v, anchor.nextSibling);
    v.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-fn]');
      if (b) {
        st[b.getAttribute('data-fn')] = b.getAttribute('data-v');
        b.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
        if (b.getAttribute('data-fn') === 'lob') st.sel = null;
        renderAll();
      }
    });
    v.addEventListener('change', function (e) {
      var s = e.target.closest('select[data-fn]');
      if (!s) return;
      if (s.getAttribute('data-fn') === 'ev') st.sel = { g: s.value, pais: TOTAL };
      else st.sel.pais = s.value;
      renderAll();
    });

    var nav = document.querySelector('.view-nav');
    if (nav && !el('vnav-industry')) {
      var btn = document.createElement('button');
      btn.className = 'vnav-btn';
      btn.id = 'vnav-industry';
      btn.textContent = 'Industry events';
      btn.addEventListener('click', function () { window.switchMainView('industry'); });
      nav.appendChild(btn);
    }
  }

  function hook() {
    var orig = window.switchMainView;
    if (typeof orig !== 'function' || orig._iet) return;
    var wrapped = function (view) {
      var v = el('view-industry'), b = el('vnav-industry');
      if (view !== 'industry') {
        active = false;
        if (v) v.style.display = 'none';
        if (b) b.classList.remove('active');
        return orig.apply(this, arguments);
      }
      orig.call(this, 'daily');   // deja el estado del Daily coherente; después se oculta
      active = true;
      el('view-daily').style.display = 'none';
      document.querySelectorAll('.view-nav .vnav-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
      var lt = el('daily-lob-toggle'); if (lt) lt.style.display = 'none';
      var org = el('org-wrap'); if (org) org.style.display = 'none';
      var t = el('topbar-title'); if (t) t.textContent = 'Industry events tracker';
      if (v) v.style.display = '';
      loadEvents();
      renderAll();
    };
    wrapped._iet = true;
    window.switchMainView = wrapped;
    // Tema y FVM ex COI BR: redibujar si la solapa está abierta.
    ['toggleTheme', 'setExCoiBr'].forEach(function (fn) {
      var o = window[fn];
      if (typeof o !== 'function') return;
      window[fn] = function () { var r = o.apply(this, arguments); if (active) { seriesCache = {}; renderAll(); } return r; };
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    buildView();
    hook();
    try {
      if (new URLSearchParams(window.location.search).get('view') === 'industry') window.switchMainView('industry');
    } catch (e) { /* sin URLSearchParams */ }
  });
})();

/* Link desde el buscador de la portada (public/portal-ask.js, 2026-10-30): abre el Daily en una solapa y un LoB.
 *   ?tab=benchmark|weekly|flow|tracker|industry   solapa (sin tab: Daily)
 *   ?lob=b2b|b2b2c (en Weekly también all)        LoB
 *   ?pais=<país>&partner=<partner>                 filtros de B2B2C; se eligen cuando llegan los datos (si no existen, quedan en Todos)
 * No usa ?view=: en Apps Script ?view=tracker abre el Tracker suelto (doGet de Codigo.js).
 */
(function () {
  'use strict';
  var p;
  try { p = new URLSearchParams(window.location.search); } catch (e) { return; }
  var tab = p.get('tab'), lob = p.get('lob'), pais = p.get('pais'), partner = p.get('partner');
  if (!tab && !lob && !pais && !partner) return;

  // Elige la opción del <select> sin importar mayúsculas (los partners vienen escritos distinto según la fuente).
  function pick(id, val) {
    var sel = document.getElementById(id);
    if (!sel || !val) return;
    var want = String(val).toLowerCase();
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value.toLowerCase() === want) { sel.value = sel.options[i].value; return; }
    }
  }
  document.addEventListener('DOMContentLoaded', function () {
    // fillPartnersB2BC_ corre al llegar el B2B2C (window.onload), justo antes del primer cálculo: ahí ya están las
    // opciones de país y partner. Se envuelve acá porque esta capa carga antes que el código del Daily.
    var orig = window.fillPartnersB2BC_;
    if ((pais || partner) && typeof orig === 'function') {
      window.fillPartnersB2BC_ = function () {
        var r = orig.apply(this, arguments);
        if (pais) { pick('sel-pais', pais); pais = null; }
        if (partner) { pick('sel-partner', partner); partner = null; }
        return r;
      };
    }
    try {
      if (/^(benchmark|weekly|flow|tracker|industry)$/.test(tab || '')) window.switchMainView(tab);
      if (tab === 'weekly') {
        var ws = { all: 'B2B+B2B2C', b2b: 'B2B', b2b2c: 'B2B2C' }[lob];
        if (ws && typeof window._wsSwitchLob === 'function') window._wsSwitchLob(ws);
      } else if ((lob === 'b2b' || lob === 'b2b2c') && typeof window.switchLob === 'function') {
        window.switchLob(lob === 'b2b2c' ? 'b2bc' : 'b2b');
      }
    } catch (e) { /* la capa de Ownia nunca rompe el Daily */ }
  });
})();

/* Benchmark vs B2C en Ownia (2026-10-24, revisión UX para Chief / VPs comerciales y directores de país de
 * B2B y B2B2C). Rearma la solapa del Daily sin tocar su HTML de Apps Script: envuelve sus funciones de
 * render (renderBenchmark_, renderBenchCards_, renderBenchGrowthChart_, renderBenchMarginChart_) y
 * reemplaza la tabla por país (renderBenchPaisTable_).
 *  - Orden: barra fija de contexto (país + MTD/YTD) → titular calculado → tarjetas B2B2C / B2B / B2C →
 *    por país (abierta) → gráficos mensuales.
 *  - Tarjetas: brecha de crecimiento vs B2C en GB, NR y FVM (la diferencia de nivel de margen vs B2C
 *    es estructural en B2B; queda en la tabla y en el gráfico de margen).
 *  - Globales = Other Countries, que B2C también tiene: la brecha se calcula como en cualquier país.
 */
(function () {
  'use strict';

  var OURS = [['b2b2c', 'B2B2C', '#5626e9'], ['b2b', 'B2B', '#0891b2']];
  var MIN_SHARE = 0.03;   // mejor / peor país: solo países con ≥ 3% del GB del negocio (evita ruido)
  var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MONTHS_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var inited = false;

  function el(id) { return document.getElementById(id); }
  function gap(a, b) { return a == null || b == null ? null : a - b; }
  function ppAbs(v) { return (Math.abs(v) * 100).toFixed(1) + 'pp'; }
  function ppSigned(v) { return v == null ? '—' : (v >= 0 ? '▲ +' : '▼ −') + ppAbs(v); }
  function cls(v) { return v == null ? '' : v >= 0 ? 'bx-pos' : 'bx-neg'; }
  function pctTxt(v) { return v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(Math.round(v * 100)) + '%'; }
  function paisLbl(p) { return typeof window.b2bPaisLabel_ === 'function' ? window.b2bPaisLabel_(p) : p; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) { return typeof window.fmtShort === 'function' ? window.fmtShort(v) : String(Math.round(v)); }
  function pct1(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }
  function sp(v, txt) { return '<span class="' + cls(v) + '">' + txt + '</span>'; }
  function day(s) { return +s.slice(8, 10) + ' ' + MONTHS[+s.slice(5, 7) - 1]; }

  var CSS = [
    // Nav del Daily en una línea (con "Industry events" y "Consultar IA" se partía en dos renglones).
    '.topbar .vnav-btn,.topbar .btn-action,.topbar .org-lbl{white-space:nowrap}',
    '.topbar .vnav-btn{padding:4px 10px}',
    '.topbar .view-nav{flex-wrap:nowrap;overflow-x:auto;min-width:0;scrollbar-width:none}',
    '.topbar .topbar-title{display:none}',
    '.topbar .vnav-btn:focus-visible,#view-benchmark .ttab:focus-visible,#bench-pais-body tr:focus-visible{outline:2px solid var(--primary);outline-offset:1px}',
    // Barra fija de contexto.
    '.bx-ctx{position:sticky;top:0;z-index:20;background:var(--bg);display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;padding:10px 0;margin:-6px 0 12px;border-bottom:1px solid var(--border)}',
    '.bx-ctx-lbl{font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.6px}',
    '.bx-ctx .bench-sub{font-size:11px;color:var(--text-2)}',
    '.bx-clear{font:inherit;font-size:11px;font-weight:600;color:var(--secondary);background:var(--primary-d);border:none;border-radius:999px;padding:3px 10px;cursor:pointer}',
    // Titular.
    '.bx-headline{font-size:15px;line-height:1.55;color:var(--text);margin:0 0 14px;padding:12px 16px;border-radius:var(--r);background:var(--surface);border-left:3px solid var(--primary)}',
    '.bx-headline .bx-l2{font-size:12.5px;color:var(--text-2);margin-top:4px}',
    '.bx-pos{color:var(--success)!important}',
    '.bx-neg{color:var(--danger)!important}',
    // Tarjetas.
    '#view-benchmark .bench-cards{grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,.8fr)}',
    '@media (max-width:980px){#view-benchmark .bench-cards{grid-template-columns:1fr}}',
    '#view-benchmark .bench-ref{display:none}',
    '.bx-verdict{font-size:13px;font-weight:700;color:var(--text);margin:8px 0}',
    '.bx-chips{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
    '.bx-chip{background:var(--segment-bg);border-radius:10px;padding:8px 10px}',
    '.bx-chip-l{font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em}',
    '.bx-chip-v{font-size:19px;font-weight:700;margin-top:1px;white-space:nowrap}',
    '.bx-chip-s{font-size:10px;color:var(--text-3);white-space:nowrap}',
    '.bench-card.bx-ref .bx-chips{grid-template-columns:1fr}',
    '.bench-card.bx-ref .bx-chip{display:flex;justify-content:space-between;align-items:baseline}',
    '.bench-card.bx-ref .bx-chip-v{font-size:15px}',
    // Tabla por país.
    '#bench-pais-body tr{cursor:pointer}',
    '#bench-pais-body tr.bx-sel td{box-shadow:inset 0 0 0 9999px var(--primary-d)}',
    '#bench-pais-body tr.bx-sel td:first-child{box-shadow:inset 3px 0 0 var(--primary),inset 0 0 0 9999px var(--primary-d)}',
    '#bench-pais-tbl td:first-child,#bench-pais-tbl th:first-child{position:sticky;left:0;background:var(--surface);z-index:1}',
    '#bench-pais-tbl tr.bk-row-total td:first-child{background:var(--elevated)}',
    '#bench-pais-wrap .bench-sub{font-size:11px}',
  ].join('\n');

  // ── Armado de la página (una vez) ──
  function init() {
    if (inited) return;
    var view = el('view-benchmark'), cardsCard = el('bench-cards') && el('bench-cards').closest('.tcard');
    var paisCard = el('bench-pais-tbl') && el('bench-pais-tbl').closest('.tcard');
    if (!view || !cardsCard || !paisCard) return;
    inited = true;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    // Barra fija: país (el select original, con su onchange) + MTD/YTD + rango.
    var hdrRow = view.querySelector('.section-hdr-row');
    var ctx = document.createElement('div');
    ctx.className = 'bx-ctx'; ctx.id = 'bx-ctx';
    ctx.innerHTML = '<span class="bx-ctx-lbl">País</span>';
    ctx.appendChild(el('bench-sel-pais').closest('.fchip'));
    var clr = document.createElement('button');
    clr.className = 'bx-clear'; clr.id = 'bx-clear'; clr.textContent = '✕ Ver todos'; clr.style.display = 'none';
    clr.addEventListener('click', function () { setPais(null); });
    ctx.appendChild(clr);
    var lbl2 = document.createElement('span'); lbl2.className = 'bx-ctx-lbl'; lbl2.textContent = 'Período'; lbl2.style.marginLeft = '8px';
    var per = el('bench-per-mtd').parentNode, range = el('bench-range');
    ctx.appendChild(lbl2); ctx.appendChild(per); ctx.appendChild(range);
    hdrRow.parentNode.insertBefore(ctx, hdrRow.nextSibling);
    var fbar = el('bench-fbar'); if (fbar) fbar.style.display = 'none';
    var rest = hdrRow.children[1]; if (rest) rest.style.display = 'none';

    var hl = document.createElement('div'); hl.className = 'bx-headline'; hl.id = 'bx-headline';
    ctx.parentNode.insertBefore(hl, ctx.nextSibling);

    var ct = cardsCard.querySelector('.card-ttl'); if (ct) ct.textContent = '¿Le ganamos a B2C?';
    var cs = cardsCard.querySelector('.card-hdr .bench-sub'); if (cs) cs.textContent = 'Brecha = nuestro crecimiento YoY − el de B2C, en pp · B2B en base generación';

    // Por país: abierta y debajo de las tarjetas.
    cardsCard.parentNode.insertBefore(paisCard, cardsCard.nextSibling);
    paisCard.style.marginBottom = '16px';
    window._benchPaisOpen = true;
    el('bench-pais-wrap').style.display = '';
    var pt = paisCard.querySelector('.card-ttl');
    if (pt) pt.innerHTML = 'Por país · vs el B2C del mismo país <span class="bench-sub" style="margin-left:6px">clic en un país para filtrar toda la página</span>';
    var notes = el('bench-pais-wrap').querySelectorAll('.bench-sub');
    if (notes.length) notes[notes.length - 1].textContent = 'Globales = Other Countries más USA, Uruguay y Paraguay (en las bases también Other / Others / OT), en los tres negocios, comparado contra el mismo agrupado de B2C. Brecha en verde = le ganamos a B2C en ese país.';
    el('bench-pais-body').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-pais]'); if (!tr) return;
      var p = tr.getAttribute('data-pais');
      setPais(p === '__total' || p === window._benchPais ? null : p);
    });
    el('bench-pais-body').addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-pais]')) { e.preventDefault(); e.target.click(); }
    });

    // Crecimiento mensual: por defecto la brecha vs B2C (¿le ganamos mes a mes?).
    var gapBtn = el('bench-gr-mode-gap'), yoyBtn = el('bench-gr-mode-yoy');
    if (gapBtn && yoyBtn) { gapBtn.textContent = 'Brecha vs B2C'; yoyBtn.textContent = 'Crecimiento'; yoyBtn.parentNode.insertBefore(gapBtn, yoyBtn); }
    window._benchGrMode = 'gap';
    if (typeof window._benchSetActive_ === 'function') window._benchSetActive_('bench-gr-mode-', ['yoy', 'gap'], 'gap');
  }

  function setPais(p) {
    var s = el('bench-sel-pais'); if (!s) return;
    s.value = p || 'all';
    window.setBenchPais();
  }

  // ── Titular: la respuesta primero ──
  function headline(d) {
    var box = el('bx-headline'); if (!box) return;
    var ref = d.biz.b2c, r = d.range;
    var when = 'En lo que va ' + (window._benchPeriod === 'ytd' ? 'del año' : 'de ' + MONTHS_L[+r.to.slice(5, 7) - 1]);
    var where = window._benchPais ? ', en ' + esc(paisLbl(window._benchPais)) : '';
    var parts = OURS.map(function (b) {
      var m = d.biz[b[0]], g = gap(m.yoyGb, ref.yoyGb), f = gap(m.yoyFvm, ref.yoyFvm);
      if (g == null) return '<b>' + b[1] + '</b> sin comparable';
      return '<b>' + b[1] + '</b> crece ' + sp(g, ppAbs(g) + (g >= 0 ? ' más' : ' menos')) + ' que B2C en GB (' + pctTxt(m.yoyGb) + ' vs ' + pctTxt(ref.yoyGb) + ')' +
        (f == null ? '' : ' y ' + sp(f, ppAbs(f) + (f >= 0 ? ' más' : ' menos')) + ' en FVM');
    });
    var l2 = '';
    if (!window._benchPais) {
      l2 = OURS.map(function (b) {
        var bp = d.byPais[b[0]], tot = d.biz[b[0]].gb, best = null, worst = null;
        Object.keys(bp).forEach(function (p) {
          var rp = d.byPais.b2c[p]; if (!rp || !tot || bp[p].gbAbs / tot < MIN_SHARE) return;
          var g = gap(bp[p].yoyGb, rp.yoyGb); if (g == null) return;
          if (!best || g > best.g) best = { p: p, g: g };
          if (!worst || g < worst.g) worst = { p: p, g: g };
        });
        if (!best) return '';
        return '<b>' + b[1] + '</b>: mejor ' + esc(paisLbl(best.p)) + ' ' + sp(best.g, ppSigned(best.g)) +
          (worst && worst.p !== best.p ? ', más flojo ' + esc(paisLbl(worst.p)) + ' ' + sp(worst.g, ppSigned(worst.g)) : '');
      }).filter(Boolean).join(' · ');
      if (l2) l2 = 'Por país (brecha de crecimiento GB vs el B2C de cada país) — ' + l2;
    }
    box.innerHTML = when + where + ', ' + parts.join('; ') + '.' + (l2 ? '<div class="bx-l2">' + l2 + '</div>' : '');
  }

  // ── Tarjetas: veredicto + 3 brechas; B2C como tercera tarjeta ──
  function verdict(g, f) {
    if (g == null) return 'Sin comparable';
    if (f == null) return g >= 0 ? 'Crecemos más que B2C' : 'Crecemos menos que B2C';
    if (g >= 0 && f >= 0) return 'Crecemos más que B2C, en volumen y en FVM';
    if (g >= 0) return 'Crecemos más que B2C en volumen, pero no en FVM';
    if (f >= 0) return 'Crecemos menos que B2C en volumen, pero más en FVM';
    return 'Crecemos menos que B2C, en volumen y en FVM';
  }
  function chipHtml(l, v, s, c) {
    return '<div class="bx-chip"><div class="bx-chip-l">' + l + '</div><div class="bx-chip-v ' + (c || '') + '">' + v + '</div>' + (s ? '<div class="bx-chip-s">' + s + '</div>' : '') + '</div>';
  }
  function enhanceCards(d) {
    var box = el('bench-cards'); if (!box) return;
    var ref = d.biz.b2c, cards = box.querySelectorAll('.bench-card');
    OURS.forEach(function (b, i) {
      var c = cards[i]; if (!c) return;
      var m = d.biz[b[0]];
      var gs = [['GB', m.yoyGb, ref.yoyGb], ['NR', m.yoyNr, ref.yoyNr], ['FVM', m.yoyFvm, ref.yoyFvm]].map(function (x) { return x.concat([gap(x[1], x[2])]); });
      var hero = c.querySelector('.bench-hero'); if (!hero) return;
      var sub = hero.nextElementSibling;
      if (sub && sub.classList.contains('bench-sub')) sub.remove();
      hero.outerHTML = '<div class="bx-verdict">' + verdict(gs[0][3], gs[2][3]) + '</div><div class="bx-chips">' +
        gs.map(function (x) { return chipHtml(x[0] + ' vs B2C', ppSigned(x[3]), 'crece ' + pctTxt(x[1]) + ' vs ' + pctTxt(x[2]), cls(x[3])); }).join('') + '</div>';
      var ths = c.querySelectorAll('.bench-mini th');
      if (ths[3]) { ths[3].textContent = 'vs B2C (pp)'; ths[3].title = 'GB / NR / FVM: brecha de crecimiento. NR% / FVM%: diferencia de margen con B2C.'; }
    });
    var refCard = document.createElement('div');
    refCard.className = 'bench-card bx-ref';
    refCard.style.setProperty('--bc', 'var(--text-3)');
    refCard.innerHTML = '<div class="bench-card-hdr"><span class="bench-card-name"><i class="bench-dot"></i>B2C · la vara</span>' +
      '<span class="bench-sub">' + pct1(ref.shareGb) + ' del GB Despegar</span></div>' +
      '<div class="bx-verdict" style="font-weight:600;color:var(--text-2)">Crecimiento YoY de referencia</div><div class="bx-chips">' +
      chipHtml('GB', pctTxt(ref.yoyGb), '', cls(ref.yoyGb)) + chipHtml('NR', pctTxt(ref.yoyNr), '', cls(ref.yoyNr)) + chipHtml('FVM', pctTxt(ref.yoyFvm), '', cls(ref.yoyFvm)) +
      '</div><div class="bench-sub" style="margin-top:10px">GB ' + money(ref.gb) + ' · NR% ' + pct1(ref.nrPct) + ' · FVM% ' + pct1(ref.fvmPct) + '</div>';
    box.appendChild(refCard);
  }

  // ── Tabla por país: total arriba, mapa de calor en la brecha, fila clickeable ──
  function renderPaisTable(d) {
    var met = window._benchPaisMetric, isPct = met === 'nrPct' || met === 'fvmPct';
    var yk = { gb: 'yoyGb', nr: 'yoyNr', fvm: 'yoyFvm' }[met];
    var val = function (m) { return m ? (isPct ? m[met] : m[yk]) : null; };
    var fmt = isPct ? pct1 : pctTxt;
    var cap = isPct ? 0.05 : 0.30;   // brecha que satura el color: 5pp de margen / 30pp de crecimiento
    var ML = { gb: 'GB YoY', nr: 'NR YoY', fvm: 'FVM YoY', nrPct: 'NR%', fvmPct: 'FVM%' };
    var hb = el('bench-pt-h-b2c'); if (hb) hb.textContent = 'B2C · ' + ML[met];
    function heat(g) {
      if (g == null) return '';
      var n = Math.round(8 + 22 * Math.min(1, Math.abs(g) / cap));
      return 'background:color-mix(in srgb, var(' + (g >= 0 ? '--success' : '--danger') + ') ' + n + '%, transparent)';
    }
    function row(key, name, mB2c, cells, extra) {
      var r = val(mB2c);
      var h = '<tr data-pais="' + esc(key) + '" tabindex="0" class="' + (extra || '') + '"><td><span class="bk-name">' + esc(name) + '</span></td>' +
        '<td class="bk-val">' + (mB2c ? fmt(r) : '<span title="Sin B2C en ese país">n/d</span>') + '</td>';
      cells.forEach(function (m) {
        var x = val(m), g = gap(x, r);
        h += '<td class="bk-val">' + fmt(x) + '</td><td class="bk-yoy ' + cls(g) + '" style="' + heat(g) + '">' + ppSigned(g) + '</td>';
      });
      return h + '</tr>';
    }
    var gbBy = {};
    OURS.forEach(function (b) { var bp = d.byPais[b[0]]; Object.keys(bp).forEach(function (p) { gbBy[p] = (gbBy[p] || 0) + bp[p].gbAbs; }); });
    var html = window._benchPais ? '' : row('__total', 'Total', d.biz.b2c, OURS.map(function (b) { return d.biz[b[0]]; }), 'bk-row-total');
    Object.keys(gbBy).sort(function (x, y) { return gbBy[y] - gbBy[x]; }).forEach(function (p) {
      html += row(p, paisLbl(p), d.byPais.b2c[p], OURS.map(function (b) { return d.byPais[b[0]][p]; }), p === window._benchPais ? 'bx-sel' : '');
    });
    el('bench-pais-body').innerHTML = html;
  }

  // ── Gráficos: país en el título; barras de brecha negativas atenuadas con borde rojo ──
  function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function cssVar(n, fb) { var v = getComputedStyle(document.documentElement).getPropertyValue(n); return (v && v.trim()) || fb; }
  function suffix() { return window._benchPais ? ' · ' + paisLbl(window._benchPais) : ''; }
  function afterGrowth() {
    var t = el('bench-gr-ttl'); if (t) t.textContent += suffix();
    var ch = window._benchCharts && window._benchCharts.gr;
    if (!ch || window._benchGrMode !== 'gap') return;
    var danger = cssVar('--danger', '#F87171');
    ch.data.datasets.forEach(function (ds, i) {
      var c = OURS[i] ? OURS[i][2] : '#888888';
      ds.backgroundColor = ds.data.map(function (v) { return v != null && v < 0 ? hexA(c, 0.35) : c; });
      ds.borderColor = ds.data.map(function (v) { return v != null && v < 0 ? danger : c; });
      ds.borderWidth = 1.5;
    });
    // La leyenda toma el color de la primera barra: forzar el del negocio.
    var gen = window.Chart.defaults.plugins.legend.labels.generateLabels;
    ch.options.plugins.legend.labels.generateLabels = function (c) {
      return gen(c).map(function (l, i) { var col = OURS[i] ? OURS[i][2] : l.fillStyle; l.fillStyle = col; l.strokeStyle = col; return l; });
    };
    ch.update('none');
  }
  function afterMargin() {
    var cv = el('bench-mg-chart'), t = cv && cv.closest('.tcard').querySelector('.card-ttl');
    if (t) t.textContent = 'Margen mensual vs B2C' + suffix();
  }

  function afterAll() {
    var d = window._benchData; if (!d) return;
    headline(d);
    var r = d.range;
    var rg = el('bench-range');
    if (rg) rg.textContent = (window._benchPeriod === 'ytd' ? 'YTD' : 'MTD') + ' · ' + day(r.from) + ' – ' + day(r.to) + ' ' + r.to.slice(0, 4) +
      ' vs mismo período ' + (+r.to.slice(0, 4) - 1) + ' · gráficos: mes a mes del año';
    var clr = el('bx-clear'); if (clr) clr.style.display = window._benchPais ? '' : 'none';
  }

  // Globales para comparar contra B2C (Diego, 2026-10-25): las bases abren países que el otro negocio no
  // tiene (USA en B2B2C y B2C; Uruguay y Paraguay en B2B), así que todos van a Other Countries, igual
  // que Other / Others / OT. Se normalizan las filas que lee el Benchmark y el selector de país.
  var GLOBALES = { USA: 1, Uruguay: 1, Paraguay: 1, Other: 1, Others: 1, OT: 1 };
  function groupGlobales() {
    var cache = typeof WeakMap === 'function' ? new WeakMap() : null;
    var norm = function (rows) {
      if (!rows || !rows.length) return rows;
      var hit = cache && cache.get(rows);
      if (hit) return hit;
      var out = rows.map(function (r) { return r && GLOBALES[r.pais] ? Object.assign({}, r, { pais: 'Other Countries' }) : r; });
      if (cache) cache.set(rows, out);
      return out;
    };
    var rowsOrig = window._benchRows_;
    if (typeof rowsOrig === 'function') {
      window._benchRows_ = function () {
        var rr = rowsOrig.apply(this, arguments);
        return { cur: norm(rr.cur), ly: norm(rr.ly), nr: rr.nr };
      };
    }
    var popOrig = window._benchPopulatePais_;
    if (typeof popOrig === 'function') {
      window._benchPopulatePais_ = function () {
        popOrig.apply(this, arguments);
        var sel = el('bench-sel-pais');
        if (!sel) return;
        Array.prototype.slice.call(sel.options).forEach(function (o) { if (GLOBALES[o.value]) sel.removeChild(o); });
        if (GLOBALES[window._benchPais]) { window._benchPais = 'Other Countries'; sel.value = 'Other Countries'; }
      };
    }
  }

  function wrap(name, after, before) {
    var o = window[name];
    if (typeof o !== 'function' || o._bx) return;
    var w = function () {
      if (before) before.apply(this, arguments);
      var r = o.apply(this, arguments);
      after.apply(this, arguments);
      return r;
    };
    w._bx = true;
    window[name] = w;
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof window.renderBenchmark_ !== 'function') return;
    // Si cambia el HTML del Daily y el armado falla, el Benchmark original se sigue dibujando.
    wrap('renderBenchmark_', afterAll, function () {
      try { init(); } catch (e) { console.warn('[daily-layout] Benchmark sin capa de Ownia:', e); }
    });
    wrap('renderBenchCards_', enhanceCards);
    wrap('renderBenchGrowthChart_', afterGrowth);
    wrap('renderBenchMarginChart_', afterMargin);
    window.renderBenchPaisTable_ = renderPaisTable;
    groupGlobales();
    var t = el('vnav-tracker'); if (t) t.textContent = 'B2B Tracker';
  });
})();
