/* "Mis slides" (2026-10-29): armador de slides propias con los datos del P&L contable. Lo inyecta server/index.js
 * en el Hub (`layout` en server/modules.js) y se abre con <base>/hub?builder=1 (el módulo Presentaciones lo
 * embebe con &embedded=1 en su pestaña "Mis slides").
 *
 * Una slide es una receta, no una imagen: qué negocio / país / producto, qué métricas (GB, NR, OC), qué período,
 * contra qué (Budget, Forecast BTB, LY), nominal u Organic, y cómo se ve (KPIs, tabla, evolución mensual o
 * apertura por país / producto), más título y comentario. Se recalcula sola cuando se actualizan los datos.
 * Datos: getSlidesEvo del Hub (las mismas series que las Slides mensuales: real cerrado + Run Rate, Budget,
 * Forecast BTB y LY por mes). Guardado: /notes/hub/builder (server/notes-store.js), un campo por slide con la
 * receta en JSON; el dueño la edita y puede compartirla con el equipo. Texto vacío = borrada.
 */
(function () {
  'use strict';
  if (!/[?&]builder=1\b/.test(location.search)) return;

  var W = 1280, H = 720;
  var EMB = /[?&]embedded=1\b/.test(location.search);
  var NUEVA = /[?&]nueva=1(&|$)/.test(location.search);   // link directo al armador (se lee al cargar, antes de que el Hub toque la URL)
  var MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  var SEGS = [['total', 'B2B + B2B2C', { lob: 'all' }], ['b2b2c', 'B2B2C', { lob: 'b2b2c' }], ['b2b', 'B2B', { lob: 'b2b' }],
    ['min', 'B2B-MIN (HTML)', { lob: 'b2b', canal: 'min' }], ['may', 'B2B-MAY (API)', { lob: 'b2b', canal: 'may' }]];
  var METRICS = [['gb', 'Gross Bookings'], ['nr', 'Net Revenue'], ['oc', 'Operating Contribution']];
  var VS = [['bud', 'Budget'], ['fc', 'Forecast BTB'], ['ly', 'Last Year']];
  var VISUALS = [['kpi', 'KPIs'], ['table', 'Tabla'], ['evo', 'Evolución mensual'], ['split', 'Apertura']];
  var SCOPE = 'builder';
  // Países como los normaliza el Hub (_PAIS_VALUE_NORM_ de Codigo.js) y cómo se muestran (mismos nombres que el Cuadro Resumen)
  var PAIS_NORM = { 'others countries': 'other countries', others: 'other countries', ot: 'other countries', ops: 'rg', 'ops + rg': 'rg' };
  var LABEL = { 'other countries': 'Globales', rg: 'OPS + RG', 'dest. serv.': 'Dest. Serv.', 'packages general': 'Packages General' };
  var state = { me: null, notes: {}, specs: [], team: false, cur: 0 };
  try { state.team = localStorage.getItem('hb-team') === '1'; } catch (e) { /* sin storage */ }
  var cache = {};
  var panel = null, modal = null;

  // ── Utilidades ─────────────────────────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function basePath() { return location.pathname.replace(/\/hub(\/.*)?$/, ''); }
  function lastClosed() { var st = window._state; return (st && st.filters && st.filters.lastActuals) || null; }
  function fyPeriods() {
    var st = window._state, p = st && st.filters && st.filters.periods;
    if (p && p.length) return p.slice(0, 12);
    var y = typeof window.fyEndYear_ === 'function' ? window.fyEndYear_() : 2027, out = [];
    for (var i = 0; i < 12; i++) { var m = ((i + 3) % 12) + 1; out.push((i < 9 ? y - 1 : y) + '-' + (m < 10 ? '0' : '') + m); }
    return out;
  }
  function listOf(k) {
    var st = window._state, l = (st && st.filters && st.filters[k]) || [];
    var seen = {};
    return l.map(function (x) { var v = String(x).trim().toLowerCase(); return k === 'pais' ? PAIS_NORM[v] || v : v; }).filter(function (x) {
      if (!x || seen[x] || x === 'all') return false;
      seen[x] = true; return true;
    });
  }
  function monthLabel(ym) { var p = ym.split('-'); return MES[+p[1] - 1] + " '" + p[0].slice(2); }
  function fyTag() { return "FY'" + fyPeriods()[11].slice(2, 4); }
  function nameOf(list, k) { for (var i = 0; i < list.length; i++) if (list[i][0] === k) return list[i][1]; return k; }
  function cap(s) { var k = String(s).toLowerCase(); return LABEL[k] || String(s).replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); }); }
  function uid() { return 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function fm(v, money) {
    if (v == null || !isFinite(v)) return 'n/d';
    var a = Math.abs(v), s = v < 0 ? '−' : '';
    var t = a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(0);
    return s + (money ? '$' : '') + t;
  }
  function fd(v) { return (v > 0 ? '+' : '') + fm(v, true); }
  function pc(v) { return isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%' : 'n/d'; }
  function cls(v) { return !isFinite(v) ? '' : v >= 0 ? 'hb-up' : 'hb-dn'; }

  // ── Período ────────────────────────────────────────────────────────────────────────────────
  function periodOptions() {
    var p = fyPeriods(), tag = fyTag(), out = [['ytd', 'YTD (hasta el último cierre)'], ['fy', tag + ' completo'], ['h1', 'H1 ' + tag], ['h2', 'H2 ' + tag]];
    ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function (q, i) { out.push([q.toLowerCase(), q + ' ' + tag + ' (' + MES[+p[i * 3].slice(5) - 1] + '–' + MES[+p[i * 3 + 2].slice(5) - 1] + ')']); });
    p.forEach(function (ym) { out.push(['m:' + ym, monthLabel(ym)]); });
    return out;
  }
  function periodIdx(per) {
    var p = fyPeriods(), last = lastClosed(), ci = last ? p.indexOf(last) : -1, r = function (a, b) { var o = []; for (var i = a; i <= b; i++) o.push(i); return o; };
    if (per === 'fy') return r(0, 11);
    if (per === 'h1') return r(0, 5);
    if (per === 'h2') return r(6, 11);
    if (/^q[1-4]$/.test(per)) { var q = +per[1] - 1; return r(q * 3, q * 3 + 2); }
    if (per && per.indexOf('m:') === 0) { var i = p.indexOf(per.slice(2)); return i >= 0 ? [i] : [Math.max(ci, 0)]; }
    return r(0, Math.max(ci, 0));   // ytd
  }
  function periodLabel(per) {
    var p = fyPeriods(), idx = periodIdx(per);
    if (per === 'ytd') return 'YTD ' + MES[+p[0].slice(5) - 1] + '–' + monthLabel(p[idx[idx.length - 1]]);
    return nameOf(periodOptions(), per).replace(/ \(hasta.*\)$/, '');
  }
  function hasProjection(idx) { var p = fyPeriods(), last = lastClosed(); return idx.some(function (i) { return !last || p[i] > last; }); }

  // ── Datos ──────────────────────────────────────────────────────────────────────────────────
  function segParams(spec) { for (var i = 0; i < SEGS.length; i++) if (SEGS[i][0] === spec.seg) return SEGS[i][2]; return SEGS[0][2]; }
  function query(spec, pais, prod) {
    var s = segParams(spec), last = lastClosed() || fyPeriods()[0];
    return { lob: s.lob, canal: s.canal || 'all', pais: pais || 'all', producto: prod || 'all', desde: last, hasta: last,
      baselineSource: 'baseline', fcSource: 'btb', organic: spec.organic ? 'forecast' : '' };
  }
  function basePais(spec) { return (spec.pais || []).length ? spec.pais.map(function (x) { return x.toLowerCase(); }).join('|') : 'all'; }
  // abierta por producto, el total es de todos los productos (el filtro de producto toma uno solo)
  function baseProd(spec) { return spec.prod && !(spec.visual === 'split' && spec.split === 'prod') ? spec.prod.toLowerCase() : 'all'; }
  // por país: los elegidos (ninguno = todos); por producto: todos
  function splitItems(spec) {
    if (spec.visual !== 'split') return [];
    if (spec.split === 'prod') return listOf('producto');
    return (spec.pais || []).length ? spec.pais : listOf('pais');
  }
  // [{key, p, item}] que necesita una slide: el total y, en "Apertura", uno por país / producto
  function queriesOf(spec) {
    var out = [{ item: null, p: query(spec, basePais(spec), baseProd(spec)) }];
    splitItems(spec).forEach(function (it) {
      out.push({ item: it, p: spec.split === 'prod' ? query(spec, basePais(spec), it.toLowerCase()) : query(spec, it.toLowerCase(), baseProd(spec)) });
    });
    out.forEach(function (q) { q.key = JSON.stringify(q.p); });
    return out;
  }
  // De a un pedido por vez (getSlidesEvo es pesado: varios en paralelo saturan el contenedor); lo que ya está en caché no se pide.
  var queue = Promise.resolve();
  function fetchEvo(qs) {
    var run = function () {
      var need = [], seen = {};
      qs.forEach(function (q) { if (!cache[q.key] && !seen[q.key]) { seen[q.key] = 1; need.push(q); } });
      if (!need.length) return Promise.resolve();
      return new Promise(function (resolve, reject) {
        window.google.script.run.withSuccessHandler(function (res) {
          need.forEach(function (q, i) { cache[q.key] = series(res[i]); });
          resolve();
        }).withFailureHandler(reject).getSlidesEvo(need.map(function (q) { return q.p; }));
      });
    };
    var p = queue.then(run, run);
    queue = p.catch(function () {});
    return p;
  }
  // {gb|nr|oc: [{act,bud,fc,ly,yoyN}] alineado a fyPeriods()}
  function series(result) {
    var out = {}, evo = result && result.evo, per = (evo && evo.periods) || [], p = fyPeriods();
    ((evo && evo.metrics) || []).forEach(function (m) {
      out[m.id] = p.map(function (ym) {
        var i = per.indexOf(ym);
        if (i < 0) return { act: 0, bud: 0, fc: 0, ly: 0, yoyN: 0 };
        var a = (m.actuals || [])[i] || 0;
        return { act: a, bud: (m.budget || [])[i] || 0, fc: (m.forecast || [])[i] || 0, ly: (m.lastYear || [])[i] || 0, yoyN: m.actualsYoY ? m.actualsYoY[i] : a };
      });
    });
    return out;
  }
  function agg(arr, idx) {
    var o = { act: 0, bud: 0, fc: 0, ly: 0, yoyN: 0, yoyOk: true };
    idx.forEach(function (i) {
      var x = arr && arr[i]; if (!x) return;
      o.act += x.act; o.bud += x.bud; o.fc += x.fc; o.ly += x.ly;
      if (x.yoyN == null || !isFinite(x.yoyN)) o.yoyOk = false; else o.yoyN += x.yoyN;
    });
    return o;
  }
  // Δ contra una referencia: bud / fc = proyección − referencia; ly = YoY (organic: real a TC LY vs LY)
  function delta(o, vs) {
    if (vs === 'ly') {
      var base = o.yoyOk ? o.yoyN : o.act;
      return { ref: o.ly, d: base - o.ly, p: o.ly > 0 ? (base / o.ly - 1) * 100 : NaN };
    }
    var ref = o[vs];
    return { ref: ref, d: o.act - ref, p: ref ? (o.act - ref) / Math.abs(ref) * 100 : NaN };
  }

  // ── Render de una slide ────────────────────────────────────────────────────────────────────
  function filtersLine(spec) {
    var parts = [nameOf(SEGS, spec.seg)];
    var split = spec.visual === 'split';
    if ((spec.pais || []).length && !(split && spec.split === 'pais')) parts.push(spec.pais.map(cap).join(', '));
    if (spec.prod && !(split && spec.split === 'prod')) parts.push(cap(spec.prod));
    return parts.join(' · ');
  }
  function autoTitle(spec) {
    var m = (spec.metrics || []).map(function (k) { return k.toUpperCase(); }).join(' / ') || 'P&L';
    var v = spec.visual === 'split' ? ' por ' + (spec.split === 'prod' ? 'producto' : 'país') : spec.visual === 'evo' ? ' · evolución' : '';
    var vs = (spec.vs || [])[0] ? ' vs ' + nameOf(VS, spec.vs[0]) : '';
    return filtersLine(spec) + ' · ' + m + v + vs;
  }
  function slideHtml(spec) {
    var idx = periodIdx(spec.period), qs = queriesOf(spec), tot = cache[qs[0].key];
    var title = spec.title || autoTitle(spec);
    var proj = hasProjection(idx);
    var tags = '<span class="hb-tag' + (spec.organic ? '' : ' hb-nom') + '">' + (spec.organic ? 'Organic' : 'USD nominal') + '</span>' +
      '<span class="hb-per">' + esc(periodLabel(spec.period)) + (proj ? ' · real + Run Rate' : '') + ' · ' + esc(filtersLine(spec)) + '</span>';
    var body;
    if (!tot) body = '<p class="hb-msg">Cargando datos…</p>';
    else if (!(spec.metrics || []).length) body = '<p class="hb-msg">Elegí al menos una métrica.</p>';
    else body = spec.visual === 'table' ? vTable(spec, tot, idx) : spec.visual === 'evo' ? vEvo(spec, tot, idx) : spec.visual === 'split' ? vSplit(spec, qs, idx) : vKpi(spec, tot, idx);
    var note = spec.note ? '<div class="hb-note"><b>Comentario</b><div>' + esc(spec.note).replace(/\n/g, '<br>') + '</div></div>' : '';
    return '<div class="hb-head"><div class="hb-title">' + esc(title) + '</div><div class="hb-logo">despegar</div></div>' +
      '<div class="hb-tags">' + tags + '</div><div class="hb-body' + (note ? ' hb-withnote' : '') + '">' + body + '</div>' + note +
      '<div class="hb-foot">' + fyTag() + ' | Despegar · P&amp;L contable' + (lastClosed() ? ' · cierre ' + monthLabel(lastClosed()) : '') + '</div>';
  }
  function vKpi(spec, tot, idx) {
    var proj = hasProjection(idx);
    return '<div class="hb-kpis hb-n' + spec.metrics.length + '">' + spec.metrics.map(function (k) {
      var o = agg(tot[k], idx);
      var lines = (spec.vs || []).map(function (vs) {
        var d = delta(o, vs);
        return '<div class="hb-kl"><span>' + (vs === 'ly' ? 'YoY' : 'vs ' + nameOf(VS, vs)) + '</span><b class="' + cls(d.d) + '">' +
          (vs === 'ly' ? pc(d.p) : fd(d.d) + ' (' + pc(d.p) + ')') + '</b><i>' + (vs === 'ly' ? 'LY ' : '') + fm(d.ref, true) + '</i></div>';
      }).join('');
      return '<div class="hb-kpi"><div class="hb-kn">' + nameOf(METRICS, k) + '</div><div class="hb-kv">' + fm(o.act, true) + '</div>' +
        '<div class="hb-ks">' + (proj ? 'Real + Run Rate' : 'Real') + '</div>' + lines + '</div>';
    }).join('') + '</div>';
  }
  function vTable(spec, tot, idx) {
    var vs = spec.vs || [], proj = hasProjection(idx);
    var h1 = '<tr><th rowspan="2"></th><th rowspan="2">' + (proj ? 'Real + RR' : 'Real') + '</th>' + vs.map(function (v) { return '<th colspan="3">' + nameOf(VS, v) + '</th>'; }).join('') + '</tr>';
    var h2 = '<tr>' + vs.map(function (v) { return '<th>' + (v === 'ly' ? 'LY' : 'Valor') + '</th><th>Δ</th><th>' + (v === 'ly' ? 'YoY' : 'Δ %') + '</th>'; }).join('') + '</tr>';
    var rows = spec.metrics.map(function (k) {
      var o = agg(tot[k], idx);
      return '<tr><td class="hb-tl">' + nameOf(METRICS, k) + '</td><td class="hb-tv">' + fm(o.act, true) + '</td>' + vs.map(function (v) {
        var d = delta(o, v);
        return '<td>' + fm(d.ref, true) + '</td><td class="' + cls(d.d) + '">' + fd(d.d) + '</td><td class="' + cls(d.p) + '">' + pc(d.p) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<table class="hb-t hb-tbig"><thead>' + h1 + h2 + '</thead><tbody>' + rows + '</tbody></table>';
  }
  function vSplit(spec, qs, idx) {
    var vs = (spec.vs || [])[0], items = qs.slice(1).map(function (q) { return { name: q.item, s: cache[q.key] }; }).filter(function (x) { return x.s; });
    var k0 = spec.metrics[0];
    items.forEach(function (x) { x.o = {}; spec.metrics.forEach(function (k) { x.o[k] = agg(x.s[k], idx); }); });
    items = items.filter(function (x) { return spec.metrics.some(function (k) { var o = x.o[k]; return Math.abs(o.act) + Math.abs(o.bud) + Math.abs(o.ly) > 500; }); });
    items.sort(function (a, b) { return Math.abs(b.o[k0].act) - Math.abs(a.o[k0].act); });
    var maxA = Math.max.apply(null, items.map(function (x) { return Math.abs(x.o[k0].act); }).concat([1]));
    var tot = cache[qs[0].key];
    var head = '<tr><th class="hb-tl">' + (spec.split === 'prod' ? 'Producto' : 'País') + '</th>' + spec.metrics.map(function (k) {
      return '<th>' + k.toUpperCase() + '</th>' + (vs ? '<th>Δ ' + (vs === 'ly' ? 'YoY' : nameOf(VS, vs)) + '</th><th>%</th>' : '');
    }).join('') + '<th class="hb-bar">' + k0.toUpperCase() + '</th></tr>';
    function cells(o) {
      return spec.metrics.map(function (k) {
        var a = o[k], d = vs ? delta(a, vs) : null;
        return '<td class="hb-tv">' + fm(a.act, true) + '</td>' + (d ? '<td class="' + cls(d.d) + '">' + fd(d.d) + '</td><td class="' + cls(d.p) + '">' + pc(d.p) + '</td>' : '');
      }).join('');
    }
    var body = items.map(function (x) {
      var w = Math.round(Math.abs(x.o[k0].act) / maxA * 100);
      return '<tr><td class="hb-tl">' + esc(cap(x.name)) + '</td>' + cells(x.o) + '<td class="hb-bar"><i style="width:' + w + '%"' + (x.o[k0].act < 0 ? ' class="hb-neg"' : '') + '></i></td></tr>';
    }).join('');
    var to = {}; spec.metrics.forEach(function (k) { to[k] = agg(tot[k], idx); });
    var total = '<tr class="hb-tt"><td class="hb-tl">Total</td>' + cells(to) + '<td></td></tr>';
    var small = items.length > 9 ? ' hb-tsm' : '';
    return items.length ? '<table class="hb-t' + small + '"><thead>' + head + '</thead><tbody>' + body + total + '</tbody></table>' : '<p class="hb-msg">Sin datos para esta apertura.</p>';
  }
  function vEvo(spec, tot, idx) {
    var p = fyPeriods(), months = idx.length > 1 ? idx : p.map(function (_, i) { return i; }), hi = idx.length === 1 ? idx[0] : -1;
    var last = lastClosed(), n = spec.metrics.length, ch = n === 1 ? 470 : n === 2 ? 232 : 152;
    var vs = spec.vs || [];
    var legend = '<div class="hb-leg"><span><i class="hb-lr"></i>Real</span><span><i class="hb-lp"></i>Run Rate</span>' +
      (vs.indexOf('bud') >= 0 ? '<span><i class="hb-lb"></i>Budget</span>' : '') + (vs.indexOf('fc') >= 0 ? '<span><i class="hb-lf"></i>Forecast BTB</span>' : '') +
      (vs.indexOf('ly') >= 0 ? '<span><i class="hb-ll"></i>Last Year</span>' : '') + '</div>';
    return legend + spec.metrics.map(function (k) {
      var arr = tot[k] || [], cw = 1180, padL = 8, padT = 22, padB = 36, plotH = ch - padT - padB;
      var vals = [];
      months.forEach(function (i) { var x = arr[i] || {}; vals.push(x.act); if (vs.indexOf('bud') >= 0) vals.push(x.bud); if (vs.indexOf('fc') >= 0) vals.push(x.fc); if (vs.indexOf('ly') >= 0) vals.push(x.ly); });
      var mx = Math.max.apply(null, vals.concat([0])), mn = Math.min.apply(null, vals.concat([0])), span = (mx - mn) || 1;
      var y = function (v) { return padT + (mx - v) / span * plotH; };
      var slot = (cw - padL) / months.length, bw = Math.min(56, slot * 0.5);
      var g = '<line x1="0" x2="' + cw + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="#d9d9e0"/>';
      months.forEach(function (i, j) {
        var x = arr[i] || { act: 0, bud: 0, fc: 0, ly: 0 }, cx = padL + slot * j + slot / 2, real = last && p[i] <= last;
        if (vs.indexOf('bud') >= 0) g += '<rect x="' + (cx - bw / 2 - 5) + '" y="' + Math.min(y(x.bud), y(0)) + '" width="' + (bw + 10) + '" height="' + Math.abs(y(x.bud) - y(0)) + '" fill="#e6e6ec" rx="2"/>';
        g += '<rect x="' + (cx - bw / 2) + '" y="' + Math.min(y(x.act), y(0)) + '" width="' + bw + '" height="' + Math.max(1, Math.abs(y(x.act) - y(0))) + '" fill="' + (real ? '#550fed' : '#a99ff2') + '" rx="2"' + (i === hi ? ' stroke="#ff7a00" stroke-width="3"' : '') + '/>';
        if (vs.indexOf('fc') >= 0) g += '<line x1="' + (cx - bw / 2 - 6) + '" x2="' + (cx + bw / 2 + 6) + '" y1="' + y(x.fc) + '" y2="' + y(x.fc) + '" stroke="#f08c1a" stroke-width="3"/>';
        if (vs.indexOf('ly') >= 0) g += '<circle cx="' + cx + '" cy="' + y(x.ly) + '" r="4.5" fill="#0f9d8a"/>';
        var top = Math.min(y(x.act), y(0));
        g += '<text class="hb-ev" x="' + cx + '" y="' + (x.act < 0 ? Math.max(y(x.act), y(0)) + 13 : top - 5) + '">' + fm(x.act) + '</text>';
        g += '<text class="hb-em" x="' + cx + '" y="' + (ch - 20) + '">' + monthLabel(p[i]) + '</text>';
        if (vs[0]) {
          var d = delta(agg(arr, [i]), vs[0]);
          g += '<text class="hb-ec ' + cls(d.p) + '" x="' + cx + '" y="' + (ch - 5) + '">' + (isFinite(d.p) && Math.abs(d.p) < 1000 ? pc(d.p) : '') + '</text>';
        }
      });
      return '<div class="hb-evt">' + nameOf(METRICS, k) + (vs[0] ? '<span>% = vs ' + (vs[0] === 'ly' ? 'LY (YoY)' : nameOf(VS, vs[0])) + '</span>' : '') + '</div>' +
        '<svg class="hb-svg" viewBox="0 0 ' + cw + ' ' + ch + '" width="' + cw + '" height="' + ch + '">' + g + '</svg>';
    }).join('');
  }

  // ── Guardado (/notes/hub/builder) ──────────────────────────────────────────────────────────
  function loadSpecs() {
    return fetch(basePath() + '/notes/hub/' + SCOPE, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { notes: {} }; })
      .then(function (j) {
        state.notes = j.notes || {};
        state.specs = Object.keys(state.notes).map(function (f) {
          var t = state.notes[f] && state.notes[f].text;
          if (!t) return null;
          try { var s = JSON.parse(t); s.id = f; return s; } catch (e) { return null; }
        }).filter(Boolean).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      });
  }
  function saveSpec(spec) {
    var copy = Object.assign({}, spec); delete copy.id;
    return post(spec.id, JSON.stringify(copy));
  }
  function post(field, text) {
    return fetch(basePath() + '/notes/hub/' + SCOPE, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'google.script.run' },
      body: JSON.stringify({ field: field, text: text }),
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j.note; }); });
  }
  function mine(s) { return state.me && String(s.owner || '').toLowerCase() === state.me; }
  function visible() { return state.specs.filter(function (s) { return mine(s) || (state.team && s.shared); }); }

  // ── Visor ──────────────────────────────────────────────────────────────────────────────────
  function fitAll(root) {
    var present = panel.classList.contains('hb-present');
    Array.prototype.forEach.call((root || panel.querySelector('.hb-deck')).querySelectorAll('.hb-frame'), function (f) {
      var s = present && f.classList.contains('hb-on') ? Math.min(window.innerWidth / W, window.innerHeight / H) : f.clientWidth / W;
      f.querySelector('.hb-slide').style.transform = 'scale(' + s + ')';
      f.style.height = present ? '' : Math.round(H * s) + 'px';
    });
  }
  function render() {
    var deck = panel.querySelector('.hb-deck'), list = visible();
    panel.querySelector('.hb-teamb').setAttribute('aria-pressed', String(state.team));
    if (!list.length) {
      deck.innerHTML = '<div class="hb-empty"><h3>Todavía no armaste ninguna slide</h3><p>Elegí qué dato mostrar (negocio, país, producto, período), contra qué compararlo y cómo verlo. ' +
        'La slide se guarda como receta: se actualiza sola cuando cambian los datos.</p><div class="hb-tpls">' +
        TEMPLATES.map(function (t, i) { return '<button type="button" class="hb-tpl" data-t="' + i + '"><b>' + esc(t[0]) + '</b><span>' + esc(t[1]) + '</span></button>'; }).join('') +
        '</div><button type="button" class="hb-btn hb-pri hb-new2">+ Slide en blanco</button></div>';
      postSlide(-1);
      return;
    }
    deck.innerHTML = '<p class="hb-msg">Cargando datos…</p>';
    var qs = []; list.forEach(function (s) { qs = qs.concat(queriesOf(s)); });
    fetchEvo(qs).then(function () {
      deck.innerHTML = list.map(function (s, i) {
        var own = mine(s);
        var tools = own
          ? '<button type="button" data-a="edit">✎ Editar</button><button type="button" data-a="dup">⧉ Duplicar</button>' +
            '<button type="button" data-a="up" title="Subir"' + (i === 0 ? ' disabled' : '') + '>↑</button><button type="button" data-a="down" title="Bajar"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
            '<button type="button" data-a="share" aria-pressed="' + !!s.shared + '" title="Las slides compartidas las ve todo el equipo en «Ver las del equipo»">' + (s.shared ? '👥 Compartida' : '🔒 Solo yo') + '</button>' +
            '<button type="button" data-a="del" class="hb-danger">🗑</button>'
          : '<span class="hb-by">de ' + esc(String(s.owner || '').replace(/@.*/, '')) + '</span><button type="button" data-a="dup">⧉ Copiar a mis slides</button>';
        return '<div class="hb-item" data-id="' + esc(s.id) + '" data-title="' + esc(s.title || autoTitle(s)) + '"><div class="hb-cap"><b>' + (i + 1) + '</b> · ' + esc(s.title || autoTitle(s)) + '<span class="hb-sp"></span>' + tools + '</div>' +
          '<div class="hb-frame" data-i="' + i + '"><div class="hb-slide">' + slideHtml(s) + '</div></div></div>';
      }).join('');
      fitAll();
      watchSlides();
    }).catch(function (e) { deck.innerHTML = '<p class="hb-msg hb-err">No se pudieron leer los datos: ' + esc((e && e.message) || e) + '</p>'; });
  }
  function byId(id) { for (var i = 0; i < state.specs.length; i++) if (state.specs[i].id === id) return state.specs[i]; return null; }
  function onDeckClick(ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.classList.contains('hb-tpl')) return openEditor(Object.assign(newSpec(), TEMPLATES[+b.dataset.t][2]));
    if (b.classList.contains('hb-new2')) return openEditor(newSpec());
    var item = b.closest('.hb-item'), s = item && byId(item.getAttribute('data-id')); if (!s) return;
    var a = b.dataset.a, list = visible().filter(mine), i = list.indexOf(s);
    if (a === 'edit') openEditor(Object.assign({}, s));
    else if (a === 'dup') {
      var c = Object.assign({}, s, { id: uid(), owner: state.me, shared: false, order: Date.now(), created: new Date().toISOString() });
      if (!mine(s)) c.title = s.title || autoTitle(s);
      else c.title = (s.title || autoTitle(s)) + ' (copia)';
      saveSpec(c).then(reload, fail);
    } else if (a === 'del') {
      if (!confirm('¿Borrar la slide «' + (s.title || autoTitle(s)) + '»?')) return;
      post(s.id, '').then(reload, fail);
    } else if (a === 'share') {
      s.shared = !s.shared; saveSpec(s).then(reload, fail);
    } else if ((a === 'up' && i > 0) || (a === 'down' && i >= 0 && i < list.length - 1)) {
      var o = list[a === 'up' ? i - 1 : i + 1], t = s.order; s.order = o.order; o.order = t;
      if (s.order === o.order) s.order += a === 'up' ? -1 : 1;
      Promise.all([saveSpec(s), saveSpec(o)]).then(reload, fail);
    }
  }
  function fail(e) { alert('No se pudo guardar: ' + ((e && e.message) || e)); }
  function reload() { return loadSpecs().then(render); }

  // ── Editor ─────────────────────────────────────────────────────────────────────────────────
  var TEMPLATES = [
    ['KPIs del mes vs Budget', 'GB, NR y OC del último cierre, B2B + B2B2C', { seg: 'total', metrics: ['gb', 'nr', 'oc'], period: 'm:last', vs: ['bud', 'ly'], visual: 'kpi' }],
    ['OC por país vs Budget', 'Operating Contribution B2B por país, H2 proyectado', { seg: 'b2b', metrics: ['oc'], period: 'h2', vs: ['bud'], visual: 'split', split: 'pais' }],
    ['Evolución NR B2B2C', 'Net Revenue mes a mes, real + Run Rate vs Budget', { seg: 'b2b2c', metrics: ['nr'], period: 'fy', vs: ['bud', 'ly'], visual: 'evo' }],
    ['NR por producto B2B-MIN', 'Net Revenue de HTML por producto, YTD vs Budget', { seg: 'min', metrics: ['nr'], period: 'ytd', vs: ['bud'], visual: 'split', split: 'prod' }],
  ];
  function newSpec() {
    return { id: uid(), owner: state.me, shared: false, order: Date.now(), created: new Date().toISOString(), title: '', note: '',
      seg: 'total', pais: [], prod: '', metrics: ['gb', 'nr', 'oc'], period: 'ytd', vs: ['bud'], organic: !!(window._state && window._state.organic), visual: 'kpi', split: 'pais' };
  }
  function opts(list, cur) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function checks(name, list, cur) {
    return list.map(function (o) { return '<label class="hb-ck"><input type="checkbox" name="' + name + '" value="' + esc(o[0]) + '"' + (cur.indexOf(o[0]) >= 0 ? ' checked' : '') + '> ' + esc(o[1]) + '</label>'; }).join('');
  }
  function openEditor(spec) {
    if (spec.period === 'm:last') spec.period = 'm:' + (lastClosed() || fyPeriods()[0]);
    ensureModal();
    var paises = listOf('pais').map(function (x) { return [x, cap(x)]; }), prods = [['', 'Todos']].concat(listOf('producto').map(function (x) { return [x, cap(x)]; }));
    var f = modal.querySelector('.hb-form');
    f.innerHTML =
      '<label class="hb-f">Título<input name="title" maxlength="120" placeholder="(automático)" value="' + esc(spec.title) + '"></label>' +
      '<div class="hb-fs"><div class="hb-fl">Negocio</div><select name="seg">' + opts(SEGS, spec.seg) + '</select></div>' +
      '<div class="hb-fs"><div class="hb-fl">Métricas</div>' + checks('metrics', METRICS, spec.metrics || []) + '</div>' +
      '<div class="hb-fs"><div class="hb-fl">Período</div><select name="period">' + opts(periodOptions(), spec.period) + '</select></div>' +
      '<div class="hb-fs"><div class="hb-fl">Comparar contra</div>' + checks('vs', VS, spec.vs || []) + '</div>' +
      '<div class="hb-fs"><div class="hb-fl">Cómo se ve</div><div class="hb-seg">' + VISUALS.map(function (v) {
        return '<label><input type="radio" name="visual" value="' + v[0] + '"' + (spec.visual === v[0] ? ' checked' : '') + '><span>' + v[1] + '</span></label>';
      }).join('') + '</div>' +
        '<div class="hb-splitby"' + (spec.visual === 'split' ? '' : ' hidden') + '>Abrir por <select name="split">' + opts([['pais', 'País'], ['prod', 'Producto']], spec.split || 'pais') + '</select></div></div>' +
      '<div class="hb-fs"><div class="hb-fl">País <small>(ninguno = todos)</small></div><div class="hb-chips">' + checks('pais', paises, spec.pais || []) + '</div></div>' +
      '<div class="hb-fs"><div class="hb-fl">Producto</div><select name="prod">' + opts(prods, spec.prod || '') + '</select></div>' +
      '<label class="hb-ck hb-org"><input type="checkbox" name="organic"' + (spec.organic ? ' checked' : '') + '> Organic (todo a TC Budget)</label>' +
      '<label class="hb-f">Comentario en la slide<textarea name="note" maxlength="1200" rows="4" placeholder="Opcional: qué querés destacar">' + esc(spec.note) + '</textarea></label>';
    modal._spec = spec;
    modal.style.display = '';
    preview();
  }
  function readForm() {
    var f = modal.querySelector('.hb-form'), s = Object.assign({}, modal._spec);
    var val = function (n) { var e = f.querySelector('[name="' + n + '"]'); return e ? e.value : ''; };
    var all = function (n) { return Array.prototype.map.call(f.querySelectorAll('[name="' + n + '"]:checked'), function (e) { return e.value; }); };
    s.title = val('title').trim(); s.seg = val('seg'); s.metrics = all('metrics'); s.period = val('period'); s.vs = all('vs');
    s.visual = (f.querySelector('[name="visual"]:checked') || {}).value || 'kpi'; s.split = val('split') || 'pais';
    s.pais = all('pais'); s.prod = val('prod'); s.organic = !!f.querySelector('[name="organic"]').checked; s.note = val('note').trim();
    f.querySelector('.hb-splitby').hidden = s.visual !== 'split';
    return s;
  }
  var pvTimer = null, pvFetch = null, pvSeq = 0;
  // Dibuja ya con lo que hay en caché y pide los datos que falten recién cuando se deja de tocar el formulario (0,7 s).
  function preview() {
    var s = readForm(), box = modal.querySelector('.hb-pv .hb-slide'), seq = ++pvSeq;
    var draw = function () { if (seq === pvSeq) { box.innerHTML = slideHtml(s); fitPreview(); } };
    draw();
    clearTimeout(pvFetch);
    pvFetch = setTimeout(function () {
      if (seq !== pvSeq) return;
      fetchEvo(queriesOf(s)).then(draw, function (e) { if (seq === pvSeq) box.innerHTML = '<p class="hb-msg hb-err">No se pudieron leer los datos: ' + esc((e && e.message) || e) + '</p>'; });
    }, 700);
  }
  function fitPreview() {
    var fr = modal.querySelector('.hb-pv'), s = fr.clientWidth / W;
    fr.querySelector('.hb-slide').style.transform = 'scale(' + s + ')';
    fr.style.height = Math.round(H * s) + 'px';
  }
  function closeEditor() { if (modal) modal.style.display = 'none'; }
  function ensureModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'hb-modal';
    modal.innerHTML = '<div class="hb-dlg" role="dialog" aria-label="Armar slide"><div class="hb-dh"><b>Armar slide</b><span class="hb-sp"></span>' +
      '<button type="button" class="hb-btn hb-cancel">Cancelar</button><button type="button" class="hb-btn hb-pri hb-save">Guardar</button></div>' +
      '<div class="hb-dbody"><div class="hb-form"></div><div class="hb-pvw"><div class="hb-pvl">Vista previa</div><div class="hb-frame hb-pv"><div class="hb-slide"></div></div>' +
      '<p class="hb-hint">Los datos son los del P&amp;L contable (real cerrado + Run Rate). La slide se recalcula sola cuando se actualizan.</p></div></div></div>';
    panel.appendChild(modal);
    var f = modal.querySelector('.hb-form');
    f.addEventListener('change', preview);
    f.addEventListener('input', function (ev) { if (ev.target.name === 'title' || ev.target.name === 'note') { clearTimeout(pvTimer); pvTimer = setTimeout(preview, 250); } });
    modal.querySelector('.hb-cancel').onclick = closeEditor;
    modal.querySelector('.hb-save').onclick = function () {
      var s = readForm();
      if (!s.metrics.length) { alert('Elegí al menos una métrica.'); return; }
      s.updated = new Date().toISOString();
      var b = this; b.disabled = true; b.textContent = 'Guardando…';
      saveSpec(s).then(function () { closeEditor(); return reload(); }, fail).then(function () { b.disabled = false; b.textContent = 'Guardar'; });
    };
    window.addEventListener('resize', function () { if (modal.style.display !== 'none') fitPreview(); });
  }

  // ── Presentar / exportar ───────────────────────────────────────────────────────────────────
  function showOnly(i) {
    var fr = panel.querySelectorAll('.hb-deck .hb-frame');
    state.cur = Math.max(0, Math.min(fr.length - 1, i));
    Array.prototype.forEach.call(fr, function (f, j) { f.classList.toggle('hb-on', j === state.cur); });
    fitAll();
  }
  function present() {
    if (!panel.querySelector('.hb-deck .hb-frame')) return;
    panel.classList.add('hb-present'); showOnly(0);
    if (panel.requestFullscreen) panel.requestFullscreen().catch(function () {});
  }
  function unpresent() {
    panel.classList.remove('hb-present');
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    fitAll();
  }
  // Embebido: el módulo Presentaciones pide las slides como imágenes para el PPTX
  if (EMB) window.__flowExport = function () {
    var fr = panel && panel.querySelectorAll('.hb-deck .hb-frame');
    if (!fr || !fr.length) return Promise.reject(new Error('No hay slides armadas.'));
    if (typeof window.html2canvas !== 'function') return Promise.reject(new Error('Las slides todavía están cargando.'));
    var items = Array.prototype.map.call(fr, function (f) {
      return { el: f.querySelector('.hb-slide'), title: f.parentNode.getAttribute('data-title') || '' };
    });
    items.forEach(function (it) { it.el.style.transform = 'none'; });
    var chain = Promise.resolve([]);
    items.forEach(function (it, i) {
      chain = chain.then(function (acc) {
        return window.html2canvas(it.el, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' }).then(function (c) {
          acc.push({ img: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height, title: it.title || ('Slide ' + (i + 1)) });
          return acc;
        });
      });
    });
    return chain.then(function (a) { fitAll(); return a; }, function (e) { fitAll(); throw e; });
  };
  var io = null;
  function postSlide(i) {
    if (!EMB || window.parent === window) return;
    var it = panel.querySelectorAll('.hb-deck .hb-item');
    try {
      window.parent.postMessage({ type: 'flow-slide', section: 'builder', idx: i < 0 ? null : i, total: it.length,
        title: (it[i] && it[i].getAttribute('data-title')) || 'Mis slides' }, location.origin);
    } catch (e) { /* sin padre */ }
  }
  function watchSlides() {
    if (!EMB || typeof IntersectionObserver === 'undefined') return;
    if (io) io.disconnect();
    var vis = {};
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { vis[e.target.getAttribute('data-i')] = e.isIntersecting ? e.intersectionRatio : 0; });
      var best = -1, bv = 0;
      Object.keys(vis).forEach(function (k) { if (vis[k] > bv) { bv = vis[k]; best = +k; } });
      if (best >= 0) postSlide(best);
    }, { threshold: [0.1, 0.25, 0.5, 0.75] });
    Array.prototype.forEach.call(panel.querySelectorAll('.hb-deck .hb-frame'), function (f) { io.observe(f); });
    postSlide(0);
  }

  // ── Panel ──────────────────────────────────────────────────────────────────────────────────
  function ensurePanel() {
    if (panel) return;
    var css = document.createElement('style');
    css.textContent = [
      '#hb{position:fixed;inset:0;z-index:2000;background:#eceef2;overflow:auto;font-family:Poppins,-apple-system,"Segoe UI",sans-serif;color:#1d1d1f}',
      '#hb .hb-tool{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 24px;background:#fff;border-bottom:1px solid #e3e3ea}',
      '#hb .hb-tool h2{font-size:17px;margin:0 8px 0 0}',
      '#hb button{font:inherit;font-size:12.5px;border:1px solid #d0d0d8;background:#fff;border-radius:8px;padding:5px 11px;cursor:pointer;color:#1d1d1f}',
      '#hb button:disabled{opacity:.4;cursor:default}',
      '#hb .hb-pri,#hb .hb-teamb[aria-pressed="true"]{background:#550fed;border-color:#550fed;color:#fff;font-weight:600}',
      '#hb .hb-sp{flex:1}#hb .hb-danger:hover{border-color:#d4373a;color:#d4373a}',
      '#hb .hb-deck{max-width:1180px;margin:18px auto 40px;padding:0 24px}',
      '#hb .hb-item{margin-bottom:26px}',
      '#hb .hb-cap{display:flex;align-items:center;gap:6px;font-size:12.5px;color:#55555c;margin-bottom:6px}#hb .hb-cap button{padding:3px 9px;font-size:12px}',
      '#hb .hb-by{font-style:italic;color:#8e8e93}',
      '#hb .hb-cap button[data-a="share"][aria-pressed="true"]{border-color:#550fed;color:#550fed}',
      '#hb .hb-frame{position:relative;width:100%}',
      '#hb .hb-slide{position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;transform-origin:0 0;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.1);overflow:hidden;padding:26px 36px 30px;box-sizing:border-box;display:flex;flex-direction:column}',
      '#hb.hb-present{background:#000}#hb.hb-present .hb-tool,#hb.hb-present .hb-cap{display:none}',
      '#hb.hb-present .hb-deck{max-width:none;margin:0;padding:0}#hb.hb-present .hb-item{margin:0}#hb.hb-present .hb-frame{display:none}',
      '#hb.hb-present .hb-frame.hb-on{display:flex;position:fixed;inset:0;align-items:center;justify-content:center}',
      '#hb.hb-present .hb-on .hb-slide{position:relative;transform-origin:center center;flex:none}',
      '#hb .hb-msg{color:#6e6e73;font-size:14px;padding:20px 0}#hb .hb-err{color:#d4373a}',
      '#hb .hb-empty{background:#fff;border-radius:16px;padding:36px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.06)}',
      '#hb .hb-empty h3{margin:0 0 8px;font-size:20px}#hb .hb-empty p{color:#6e6e73;font-size:14px;max-width:640px;margin:0 auto 20px;line-height:1.5}',
      '#hb .hb-tpls{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:18px;text-align:left}',
      '#hb .hb-tpl{display:flex;flex-direction:column;gap:4px;padding:14px;border-radius:12px;border:1px solid #e1dcf7;background:#fbfaff}',
      '#hb .hb-tpl:hover{border-color:#550fed}#hb .hb-tpl b{color:#4300d2;font-size:14px}#hb .hb-tpl span{font-size:12px;color:#6e6e73}',
      // contenido de la slide
      '#hb .hb-head{display:flex;align-items:center;border-bottom:3px solid #550fed;padding-bottom:8px}',
      '#hb .hb-title{font-size:28px;font-weight:700;color:#4300d2;flex:1;line-height:1.2}',
      '#hb .hb-logo{font-size:22px;font-weight:700;color:#550fed;letter-spacing:-.5px}',
      '#hb .hb-tags{display:flex;gap:10px;align-items:center;margin:10px 0 14px}',
      '#hb .hb-tag{background:#550fed;color:#fff;font-size:13px;font-weight:600;border-radius:5px;padding:3px 12px}#hb .hb-nom{background:#8e8e93}',
      '#hb .hb-per{font-size:14px;color:#6e6e73}',
      '#hb .hb-body{flex:1;min-height:0;overflow:hidden}',
      '#hb .hb-note{margin-top:10px;background:#f6f4fe;border-left:4px solid #550fed;border-radius:6px;padding:8px 14px;font-size:14px;line-height:1.45;max-height:120px;overflow:hidden}',
      '#hb .hb-note b{display:block;font-size:12px;color:#4300d2;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px}',
      '#hb .hb-foot{position:absolute;right:36px;bottom:9px;font-size:11px;color:#9b9b9b}',
      '#hb .hb-up{color:#1a9e5a}#hb .hb-dn{color:#d4373a}',
      '#hb .hb-kpis{display:grid;gap:18px;height:100%;align-content:center}#hb .hb-n1{grid-template-columns:minmax(0,520px);justify-content:center}',
      '#hb .hb-n2{grid-template-columns:1fr 1fr}#hb .hb-n3{grid-template-columns:1fr 1fr 1fr}',
      '#hb .hb-kpi{border:1px solid #e1dcf7;border-radius:14px;background:#fbfaff;padding:22px 22px 16px;text-align:center}',
      '#hb .hb-kn{font-size:18px;font-weight:600;color:#55555c}#hb .hb-kv{font-size:54px;font-weight:700;color:#4300d2;line-height:1.15;margin-top:6px}',
      '#hb .hb-ks{font-size:12px;color:#8e8e93;margin-bottom:12px}',
      '#hb .hb-kl{display:grid;grid-template-columns:1fr auto;gap:0 10px;align-items:baseline;border-top:1px dashed #e1dcf7;padding:8px 4px 4px;text-align:left}',
      '#hb .hb-kl span{font-size:14px;color:#55555c}#hb .hb-kl b{font-size:18px;text-align:right}#hb .hb-kl i{grid-column:1/3;font-style:normal;font-size:11.5px;color:#8e8e93}',
      '#hb .hb-t{width:100%;border-collapse:collapse;font-size:14px}',
      '#hb .hb-t th{background:#550fed;color:#fff;font-weight:600;padding:6px 8px;text-align:right;border-left:1px solid #fff}#hb .hb-t thead tr:first-child th{text-align:center}',
      '#hb .hb-t td{padding:7px 8px;text-align:right;border-bottom:1px solid #eeecf6;white-space:nowrap}',
      '#hb .hb-t .hb-tl{text-align:left;font-weight:600}#hb .hb-t th.hb-tl{text-align:left}#hb .hb-t td.hb-tv{font-weight:700;color:#4300d2}',
      '#hb .hb-tbig{font-size:19px;margin-top:30px}#hb .hb-tbig td{padding:16px 10px}#hb .hb-tsm{font-size:12.5px}#hb .hb-tsm td{padding:4px 8px}',
      '#hb .hb-t .hb-tt td{font-weight:700;border-top:2px solid #550fed;background:#f6f4fe}',
      '#hb .hb-t th.hb-bar{width:180px}#hb .hb-t td.hb-bar{padding-left:10px}#hb .hb-bar i{display:block;height:12px;border-radius:3px;background:#a99ff2}#hb .hb-bar i.hb-neg{background:#f2a3a4}',
      '#hb .hb-leg{display:flex;gap:16px;font-size:12px;color:#55555c;margin-bottom:4px}#hb .hb-leg i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:5px;vertical-align:-1px}',
      '#hb .hb-lr{background:#550fed}#hb .hb-lp{background:#a99ff2}#hb .hb-lb{background:#e6e6ec;border:1px solid #c9c9d2}#hb .hb-lf{background:#f08c1a;height:4px!important;vertical-align:3px!important}#hb .hb-ll{background:#0f9d8a;border-radius:50%!important}',
      '#hb .hb-evt{font-size:15px;font-weight:700;margin-top:4px}#hb .hb-evt span{font-size:11px;font-weight:400;color:#6e6e73;margin-left:8px}',
      '#hb .hb-svg{display:block;width:100%;height:auto}',
      '#hb .hb-ev{font-size:12px;font-weight:700;text-anchor:middle;fill:#1d1d1f}#hb .hb-em{font-size:12px;text-anchor:middle;fill:#6e6e73}',
      '#hb .hb-ec{font-size:11.5px;font-weight:700;text-anchor:middle}#hb .hb-ec.hb-up{fill:#1a9e5a}#hb .hb-ec.hb-dn{fill:#d4373a}',
      // editor
      '#hb .hb-modal{position:fixed;inset:0;z-index:5;background:rgba(20,16,40,.45);display:flex;align-items:center;justify-content:center;padding:20px}',
      '#hb .hb-dlg{background:#fff;border-radius:16px;width:min(1320px,100%);max-height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)}',
      '#hb .hb-dh{display:flex;align-items:center;gap:8px;padding:12px 18px;border-bottom:1px solid #e5e5ea;font-size:16px}',
      '#hb .hb-dbody{display:grid;grid-template-columns:360px 1fr;min-height:0;flex:1}',
      '#hb .hb-form{overflow-y:auto;padding:14px 18px;border-right:1px solid #e5e5ea;display:flex;flex-direction:column;gap:12px;font-size:13px}',
      '#hb .hb-f{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:12.5px}',
      '#hb .hb-form input[type=text],#hb .hb-form input:not([type]),#hb .hb-form select,#hb .hb-form textarea{font:inherit;font-weight:400;font-size:13px;border:1px solid #d2d2d7;border-radius:8px;padding:6px 9px;width:100%;box-sizing:border-box}',
      '#hb .hb-fs{display:flex;flex-direction:column;gap:5px}#hb .hb-fl{font-weight:600;font-size:12.5px}#hb .hb-fl small{font-weight:400;color:#8e8e93}',
      '#hb .hb-ck{display:inline-flex;align-items:center;gap:6px;font-size:13px;margin-right:12px;cursor:pointer}',
      '#hb .hb-chips{display:flex;flex-wrap:wrap;gap:2px 0}#hb .hb-chips .hb-ck{width:50%;margin:0}',
      '#hb .hb-seg{display:flex;flex-wrap:wrap;gap:6px}#hb .hb-seg input{display:none}',
      '#hb .hb-seg span{display:inline-block;border:1px solid #d2d2d7;border-radius:999px;padding:5px 12px;cursor:pointer;font-size:12.5px}',
      '#hb .hb-seg input:checked+span{background:#550fed;border-color:#550fed;color:#fff}',
      '#hb .hb-splitby{margin-top:6px;font-size:12.5px}#hb .hb-splitby select{width:auto!important;margin-left:6px}',
      '#hb .hb-org{margin-top:2px}',
      '#hb .hb-pvw{padding:14px 18px;overflow:auto;background:#f5f5f7}#hb .hb-pvl{font-size:12px;color:#6e6e73;margin-bottom:6px}',
      '#hb .hb-hint{font-size:11.5px;color:#8e8e93;margin-top:10px}',
      '@media (max-width:900px){#hb .hb-dbody{grid-template-columns:1fr}#hb .hb-form{border-right:0;max-height:45vh}}',
      '@media print{@page{size:' + W + 'px ' + H + 'px;margin:0}body > *:not(#hb){display:none !important}' +
        '#hb{position:static;background:#fff;overflow:visible}#hb .hb-tool,#hb .hb-cap,#hb .hb-modal{display:none!important}#hb .hb-deck{max-width:none;margin:0;padding:0}' +
        '#hb .hb-item{margin:0}#hb .hb-frame{height:' + H + 'px !important;width:' + W + 'px;page-break-after:always;break-after:page}' +
        '#hb .hb-slide{transform:none !important;box-shadow:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}',
    ].join('\n');
    document.head.appendChild(css);
    panel = document.createElement('div');
    panel.id = 'hb';
    panel.innerHTML = '<div class="hb-tool"><h2>Mis slides</h2>' +
      '<button type="button" class="hb-pri hb-new">+ Nueva slide</button>' +
      '<button type="button" class="hb-teamb" aria-pressed="false" title="Suma las slides que otros compartieron con el equipo">👥 Ver las del equipo</button>' +
      '<span class="hb-sp"></span><button type="button" class="hb-pres">▶ Presentar</button><button type="button" class="hb-pdf">Exportar PDF</button>' +
      (EMB ? '' : '<button type="button" class="hb-close">← Volver al P&amp;L</button>') + '</div><div class="hb-deck"><p class="hb-msg">Cargando…</p></div>';
    document.body.appendChild(panel);
    panel.querySelector('.hb-new').onclick = function () { openEditor(newSpec()); };
    panel.querySelector('.hb-teamb').onclick = function () {
      state.team = !state.team;
      try { localStorage.setItem('hb-team', state.team ? '1' : '0'); } catch (e) { /* sin storage */ }
      render();
    };
    panel.querySelector('.hb-pres').onclick = present;
    panel.querySelector('.hb-pdf').onclick = function () { unpresent(); setTimeout(function () { window.print(); }, 50); };
    var cl = panel.querySelector('.hb-close');
    if (cl) cl.onclick = function () { location.href = location.pathname; };
    panel.querySelector('.hb-deck').addEventListener('click', onDeckClick);
    document.addEventListener('keydown', function (ev) {
      if (modal && modal.style.display !== 'none') { if (ev.key === 'Escape') closeEditor(); return; }
      if (!panel.classList.contains('hb-present')) return;
      if (ev.key === 'ArrowRight' || ev.key === 'PageDown' || ev.key === ' ') { ev.preventDefault(); showOnly(state.cur + 1); }
      else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); showOnly(state.cur - 1); }
      else if (ev.key === 'Escape') unpresent();
    });
    document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && panel.classList.contains('hb-present')) unpresent(); });
    window.addEventListener('resize', function () { fitAll(); });
  }

  function start() {
    ensurePanel();
    var who = fetch(basePath() + '/whoami', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { state.me = String(j.email || '').toLowerCase() || null; }).catch(function () { state.me = null; });
    Promise.all([who, loadSpecs()]).then(function () {
      render();
      if (NUEVA) openEditor(newSpec());
    }, function (e) {
      panel.querySelector('.hb-deck').innerHTML = '<p class="hb-msg hb-err">No se pudieron leer tus slides: ' + esc((e && e.message) || e) + '</p>';
    });
  }
  // Espera a que el Hub tenga los filtros (períodos, países, productos y último cierre)
  document.addEventListener('DOMContentLoaded', function () {
    var tries = 0;
    (function go() {
      if (window._state && window._state.filters && window._state.filters.lastActuals) start();
      else if (tries++ < 240) setTimeout(go, 500);
    })();
  });
})();
