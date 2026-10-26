/* "Slides mensuales" del P&L Dashboard (Hub) en Ownia (2026-10-26). La inyecta server/index.js en el
 * Hub (`layout` en server/modules.js); se abre desde la pestaña "Slides mensuales" (botón #nav-slides
 * de Dashboard_B2B_WLs/dashboard.html, en PRIMARY de hub-layout.js).
 *
 * El mismo deck todos los meses, con el formato de "Business Performance B2B/B2B2C vs Budget":
 * detalle del mes que cerró y las comparaciones. Se elige el mes cerrado arriba; las slides de
 * resultados muestran el acumulado del FY (YTD; con septiembre cerrado = H1) y el mes.
 *   1 Portada · 2 H2 vs H1 (public/hub-h2h1.js) · 3 Evolución B2B MAY · 4 B2B2C mensual vs Budget ·
 *   5 Evolución B2B MIN · 6 Resultados por negocio · 7 B2B2C + highlights · 8 B2B ·
 *   9 B2B + business levers · 10 B2B MIN por región · 11 B2B MAY por región.
 *   La 4 es la portada "B2B2C — Resumen mensual (OC)" del Flow del Daily a pantalla completa
 *   (<base>/daily?embed=b2b2c-cover, public/daily-embed.js): NR Farming / Hunting / TBD y FVM del
 *   Datalake, OC del contable, tablas H1 / H2. El "at risk" del título lo calcula esa página (NR) y
 *   el OC se estima con el margen OC/NR del Budget H2 de B2B2C del contable (&ocm=).
 *   (Pendiente: Status OKRs.)
 *
 * Datos: getAllData del Hub (los mismos números que el resto del dashboard) — `evo` trae los 12
 * meses de real (cerrado + Run Rate), Budget, año pasado y el YoY (organic si corresponde). Un pedido
 * por negocio y, para las regiones, uno por negocio × región (filtro de país). Respeta Organic.
 * Textos (desafíos, highlights, business levers): borrador automático con los datos, editable en
 * pantalla y guardado para todo el equipo por mes (/notes/hub/slides-AAAA-MM, server/notes-store.js).
 * Presentar: pantalla completa con flechas. PDF: imprimir (una slide por página).
 */
(function () {
  'use strict';

  var W = 1280, H = 720;
  var MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  var MES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var SEG = {
    total: { lob: 'all', name: 'TOTAL' }, b2b2c: { lob: 'b2b2c', name: 'B2B2C' }, b2b: { lob: 'b2b', name: 'B2B' },
    min: { lob: 'b2b', canal: 'min', name: 'B2B-MIN' }, may: { lob: 'b2b', canal: 'may', name: 'B2B-MAY' },
  };
  var REG = [['glob', 'Globales', 'other countries'], ['bra', 'Brasil', 'brasil'], ['mex', 'Mexico', 'mexico'],
    ['hisp', 'Hispa', 'argentina|chile|colombia|peru|ecuador']];
  var cache = {};
  var panel = null, state = { month: null, data: null, notes: {}, cur: 0 };

  // ── Datos ──────────────────────────────────────────────────────────────────────────────────
  function organicOn() { var st = window._state; return !!(st && st.organic); }
  function lastClosed() { var st = window._state; return (st && st.filters && st.filters.lastActuals) || null; }
  function fyPeriods() {
    var st = window._state, p = st && st.filters && st.filters.periods;
    if (p && p.length) return p.slice(0, 12);
    var y = typeof window.fyEndYear_ === 'function' ? window.fyEndYear_() : 2027, out = [];
    for (var i = 0; i < 12; i++) { var m = ((i + 3) % 12) + 1; out.push((i < 9 ? y - 1 : y) + '-' + (m < 10 ? '0' : '') + m); }
    return out;
  }
  function call(extra) {
    var m = state.month;
    var p = { lob: extra.lob, pais: extra.pais || 'all', producto: 'all', canal: extra.canal || 'all', desde: m, hasta: m,
      baselineSource: 'baseline', fcSource: '', organic: organicOn() ? 'budget' : '' };
    var key = JSON.stringify(p);
    if (cache[key]) return Promise.resolve(cache[key]);
    return new Promise(function (resolve, reject) {
      window.google.script.run.withSuccessHandler(function (r) { cache[key] = r; resolve(r); }).withFailureHandler(reject).getAllData(p);
    });
  }
  // {gb|nr|oc: {act, bud, ly, yoyN}[12]} desde result.evo (12 meses del FY)
  function series(result) {
    var out = {}, evo = result && result.evo;
    ((evo && evo.metrics) || []).forEach(function (m) {
      out[m.id] = (m.actuals || []).map(function (a, i) {
        return { act: a || 0, bud: (m.budget || [])[i] || 0, ly: (m.lastYear || [])[i] || 0, yoyN: (m.actualsYoY || [])[i] };
      });
    });
    return out;
  }
  function agg(arr, idx) {
    var o = { act: 0, bud: 0, ly: 0, yoyN: 0, yoyOk: true };
    idx.forEach(function (i) {
      var x = arr && arr[i]; if (!x) return;
      o.act += x.act; o.bud += x.bud; o.ly += x.ly;
      if (x.yoyN == null || !isFinite(x.yoyN)) o.yoyOk = false; else o.yoyN += x.yoyN;
    });
    o.yoy = o.ly > 0 && o.yoyOk ? (o.yoyN / o.ly - 1) * 100 : NaN;
    o.vsAbs = o.act - o.bud;
    o.vsPct = o.bud ? (o.act / o.bud - 1) * 100 : NaN;
    return o;
  }
  function range(a, b) { var o = []; for (var i = a; i <= b; i++) o.push(i); return o; }

  function loadAll() {
    var jobs = {};
    Object.keys(SEG).forEach(function (k) { jobs[k] = call(SEG[k]); });
    ['min', 'may'].forEach(function (c) {
      REG.forEach(function (r) { jobs[c + '_' + r[0]] = call({ lob: 'b2b', canal: c, pais: r[2] }); });
    });
    var keys = Object.keys(jobs);
    return Promise.all(keys.map(function (k) { return jobs[k]; })).then(function (res) {
      var d = {};
      keys.forEach(function (k, i) { d[k] = { s: series(res[i]), raw: res[i] }; });
      return d;
    });
  }

  // ── Formato ────────────────────────────────────────────────────────────────────────────────
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function m1(v) { var m = v / 1e6; return (m < 0 ? '−' : '') + Math.abs(m).toFixed(1); }
  function money(v) { var m = v / 1e6; return (m < 0 ? '−' : '+') + '$' + Math.abs(m).toFixed(1) + 'M'; }
  function pc(v, d) { return isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d == null ? 0 : d) + '%' : 'n/d'; }
  function cls(v) { return !isFinite(v) ? '' : v >= 0 ? 'hs-up' : 'hs-dn'; }
  function monthLabel(ym) { var p = ym.split('-'); return MES[+p[1] - 1] + " '" + p[0].slice(2); }
  function fyTag() { var p = fyPeriods(); return "FY'" + p[11].slice(2, 4); }
  function closedIdx() { return fyPeriods().indexOf(state.month); }
  function ytdLabel() {
    var ci = closedIdx(), p = fyPeriods();
    if (ci === 5) return "H1'" + p[11].slice(2, 4);
    if (ci === 11) return fyTag();
    return 'YTD ' + MES[+p[0].slice(5) - 1] + '–' + monthLabel(state.month);
  }

  // Celda de resultados: YTD grande + línea del mes
  function kcell(arr) {
    var ci = closedIdx(), y = agg(arr, range(0, ci)), m = agg(arr, [ci]);
    return '<div class="hs-k"><div class="hs-kv">' + m1(y.act) + '</div>' +
      '<div class="hs-ky ' + cls(y.yoy) + '">' + pc(y.yoy) + ' YoY</div>' +
      '<div class="hs-kb ' + cls(y.vsAbs) + '">' + money(y.vsAbs) + ' (' + pc(y.vsPct) + ') vs Budget</div>' +
      '<div class="hs-km">' + MES[+state.month.slice(5) - 1] + ': ' + m1(m.act) + ' · <span class="' + cls(m.yoy) + '">' + pc(m.yoy) + ' YoY</span> · ' +
        '<span class="' + cls(m.vsAbs) + '">' + money(m.vsAbs) + '</span> vs Bud</div></div>';
  }
  var ROWS = [['gb', 'Gross Bookings', 'USD $M'], ['nr', 'Net Revenues', 'USD $M'], ['oc', 'Operating Contribution', 'USD $M']];
  function grid(cols) {
    var head = '<div class="hs-g" style="grid-template-columns:170px repeat(' + cols.length + ',1fr)"><div></div>' +
      cols.map(function (c) { return '<div class="hs-gh">' + esc(c.name) + '</div>'; }).join('');
    var body = ROWS.map(function (r) {
      return '<div class="hs-gl"><b>' + r[1] + '</b><span>' + r[2] + '</span></div>' +
        cols.map(function (c) { return kcell(c.s[r[0]]); }).join('');
    }).join('');
    return head + body + '</div>';
  }
  function head(title, sub) {
    return '<div class="hs-head"><div class="hs-title">' + title + '</div><div class="hs-logo">despegar</div></div>' +
      '<div class="hs-tags">' + (organicOn() ? '<span class="hs-org">Organic</span>' : '<span class="hs-org hs-nom">USD nominal</span>') +
      (sub ? '<span class="hs-per">' + sub + '</span>' : '') + '</div>';
  }
  function foot() { return '<div class="hs-foot">' + fyTag() + ' | Despegar · cierre ' + monthLabel(state.month) + '</div>'; }

  // ── Notas (borrador automático + editable y guardado) ───────────────────────────────────────
  function noteBox(field, title, draft) {
    var n = state.notes[field], text = n ? n.text : draft;
    var meta = n ? 'Editado por ' + esc(String(n.by || '').replace(/@.*/, '')) + ' · ' + new Date(n.at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : 'Borrador automático · hacé clic para editar';
    return '<div class="hs-note"><div class="hs-nt">' + title + '</div>' +
      '<div class="hs-nx' + (n ? '' : ' hs-draft') + '" contenteditable="true" spellcheck="false" data-field="' + field + '">' + esc(text).replace(/\n/g, '<br>') + '</div>' +
      '<div class="hs-nm">' + meta + '</div></div>';
  }
  function basePath() { return location.pathname.replace(/\/hub(\/.*)?$/, ''); }
  function scope() { return 'slides-' + state.month; }
  function loadNotes() {
    return fetch(basePath() + '/notes/hub/' + scope(), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { notes: {} }; })
      .then(function (j) { state.notes = j.notes || {}; })
      .catch(function () { state.notes = {}; });
  }
  function saveNote(el) {
    var field = el.getAttribute('data-field'), text = el.innerText.replace(/ /g, ' ').trim();
    var meta = el.parentNode.querySelector('.hs-nm');
    meta.textContent = 'Guardando…';
    fetch(basePath() + '/notes/hub/' + scope(), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'google.script.run' },
      body: JSON.stringify({ field: field, text: text }),
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j.note; }); })
      .then(function (n) { state.notes[field] = n; el.classList.remove('hs-draft'); meta.textContent = 'Guardado · ' + String(n.by || '').replace(/@.*/, ''); })
      .catch(function (e) { meta.textContent = 'No se pudo guardar: ' + (e.message || e); });
  }

  // Borradores con los datos
  function drivers(list) {
    return list.map(function (x) { return { name: x.name, o: agg(x.s.oc, range(0, closedIdx())), n: agg(x.s.nr, range(0, closedIdx())) }; })
      .sort(function (a, b) { return Math.abs(b.o.vsAbs) - Math.abs(a.o.vsAbs); })
      .map(function (x) { return x.name + ': ' + money(x.o.vsAbs) + ' OC' + pcIf(x.o) + ' y ' + money(x.n.vsAbs) + ' NR' + pcIf(x.n) + ' vs Budget.'; });
  }
  // % vs Budget solo si se puede leer: Budget positivo y desvío razonable (si no, "−743%" confunde).
  function pcIf(o) { return o.bud > 0 && Math.abs(o.vsPct) < 200 ? ' (' + pc(o.vsPct) + ')' : ''; }
  function regions(c) { return REG.map(function (r) { return { name: r[1], s: state.data[c + '_' + r[0]].s }; }); }
  function h2Draft(c) {
    var s = state.data[c].s, h2 = range(6, 11), n = agg(s.nr, h2), o = agg(s.oc, h2), n1 = agg(s.nr, range(0, 5)), nb1 = n1.bud;
    return 'H2: el Run Rate da NR ' + money(n.vsAbs) + ' (' + pc(n.vsPct) + ') y OC ' + money(o.vsAbs) + ' (' + pc(o.vsPct) + ') vs Budget.\n' +
      'El Budget pide un H2 ' + pc((n.bud / n1.act - 1) * 100) + ' de NR sobre el H1 real (H1 ' + pc((n1.act / nb1 - 1) * 100) + ' vs su Budget).\n' +
      drivers(regions(c)).slice(0, 2).join('\n');
  }

  // ── Slides ─────────────────────────────────────────────────────────────────────────────────
  function sCover() {
    var p = state.month.split('-');
    return '<div class="hs-cover"><div class="hs-cv1">Business Performance</div><div class="hs-cv2">B2B / B2B2C vs Budget</div>' +
      '<div class="hs-cv3">' + MES_EN[+p[1] - 1] + ' ' + p[0] + ' close · ' + ytdLabel() + '</div><div class="hs-cvlogo">despegar</div></div>';
  }

  // Gráfico mensual: real (cerrado oscuro / Run Rate claro) vs Budget, % GB arriba, YoY y Δ pp abajo
  function evoChart(title, s, metric) {
    var a = s[metric], g = s.gb, ci = closedIdx(), cw = 64, x0 = 70, Wc = x0 + 12 * cw + 10;
    var top = 70, base = 220, lineY0 = 18, lineY1 = 52;
    var max = Math.max.apply(null, a.map(function (x) { return Math.max(x.act, x.bud, 0); })) || 1;
    var ratio = a.map(function (x, i) { return g[i] && g[i].act ? x.act / g[i].act * 100 : NaN; });
    var rlo = Math.min.apply(null, ratio.filter(isFinite)), rhi = Math.max.apply(null, ratio.filter(isFinite));
    var ry = function (v) { return rhi === rlo ? (lineY0 + lineY1) / 2 : lineY1 - (v - rlo) / (rhi - rlo) * (lineY1 - lineY0); };
    var svg = '<svg viewBox="0 0 ' + Wc + ' 290" class="hs-ev">';
    var pts = [];
    a.forEach(function (x, i) {
      var cx = x0 + i * cw, ha = Math.max(x.act, 0) / max * (base - top), hb = Math.max(x.bud, 0) / max * (base - top);
      svg += '<rect x="' + (cx + 8) + '" y="' + (base - ha).toFixed(1) + '" width="22" height="' + ha.toFixed(1) + '" rx="2" fill="' + (i <= ci ? '#5b4fe0' : '#a99ff2') + '"/>';
      svg += '<rect x="' + (cx + 32) + '" y="' + (base - hb).toFixed(1) + '" width="22" height="' + hb.toFixed(1) + '" rx="2" fill="#d9dbe0"/>';
      svg += '<text x="' + (cx + 19) + '" y="' + (base - ha - 4).toFixed(1) + '" class="hs-evv">' + m1(x.act) + '</text>';
      svg += '<text x="' + (cx + 43) + '" y="' + (base - hb - 4).toFixed(1) + '" class="hs-evb">' + m1(x.bud) + '</text>';
      svg += '<text x="' + (cx + 31) + '" y="' + (base + 15) + '" class="hs-evm">' + monthLabel(fyPeriods()[i]).replace(" '", "'") + '</text>';
      var yoy = x.ly > 0 && x.yoyN != null ? (x.yoyN / x.ly - 1) * 100 : NaN;
      var lyr = g[i] && g[i].ly ? x.ly / g[i].ly * 100 : NaN, dpp = ratio[i] - lyr;
      svg += '<text x="' + (cx + 31) + '" y="' + (base + 36) + '" class="hs-evc ' + cls(yoy) + '">' + pc(yoy) + '</text>';
      svg += '<text x="' + (cx + 31) + '" y="' + (base + 56) + '" class="hs-evc ' + cls(dpp) + '">' + (isFinite(dpp) ? (dpp >= 0 ? '+' : '−') + Math.abs(dpp).toFixed(1) + 'pp' : 'n/d') + '</text>';
      if (isFinite(ratio[i])) pts.push([cx + 31, ry(ratio[i]), ratio[i]]);
    });
    svg += '<polyline fill="none" stroke="#8b80f0" stroke-width="2" points="' + pts.map(function (p) { return p[0] + ',' + p[1].toFixed(1); }).join(' ') + '"/>';
    pts.forEach(function (p) {
      svg += '<circle cx="' + p[0] + '" cy="' + p[1].toFixed(1) + '" r="3.5" fill="#fff" stroke="#5b4fe0" stroke-width="2"/>' +
        '<text x="' + p[0] + '" y="' + (p[1] - 7).toFixed(1) + '" class="hs-evp">' + p[2].toFixed(1) + '%</text>';
    });
    svg += '<line x1="' + x0 + '" x2="' + (Wc - 10) + '" y1="' + base + '" y2="' + base + '" stroke="#d0d0d8"/>';
    svg += '<text x="4" y="' + (base + 36) + '" class="hs-evl">YoY</text><text x="4" y="' + (base + 56) + '" class="hs-evl">Δ % GB</text>' +
      '<text x="4" y="' + ((lineY0 + lineY1) / 2 + 4) + '" class="hs-evl">' + (metric === 'nr' ? 'NR' : 'OC') + ' % GB</text></svg>';
    return '<div class="hs-evbox"><div class="hs-evt">' + title + ' <span>real cerrado · <i class="hs-lrr"></i>Run Rate · <i class="hs-lbud"></i>Budget</span></div>' + svg + '</div>';
  }
  function evoCards(label, arr) {
    function one(tag, idx, big) {
      var o = agg(arr, idx);
      return '<div class="hs-ec' + (big ? ' hs-ecbig' : '') + '"><span class="hs-ectag">' + tag + '</span><div class="hs-ecv">' + m1(o.act) + '</div>' +
        '<div class="' + cls(o.yoy) + '">' + pc(o.yoy) + ' YoY</div><div class="' + cls(o.vsAbs) + '">' + money(o.vsAbs) + ' (' + pc(o.vsPct) + ')<br>vs Budget</div></div>';
    }
    return '<div class="hs-ecs"><div class="hs-ecl">' + label + ' ' + fyTag() + '</div>' + one('FY', range(0, 11), true) +
      '<div class="hs-ecrow">' + one('H1', range(0, 5)) + one('H2', range(6, 11)) + '</div></div>';
  }
  function sEvolution(c, noteTitle, field) {
    var s = state.data[c].s;
    return head(fyTag().replace("FY'", 'FY ') + ' | ' + SEG[c].name + ' Evolution', 'FY = real + Run Rate · H2 = Run Rate desde ' + monthLabel(fyPeriods()[closedIdx() + 1] || state.month)) +
      '<div class="hs-evo"><div class="hs-evleft">' + evoCards('Net Revenues', s.nr) + evoCards('Operating Contribution', s.oc) + '</div>' +
      '<div class="hs-evmid">' + evoChart('Net Revenue', s, 'nr') + evoChart('Operating Contribution', s, 'oc') + '</div>' +
      '<div class="hs-evright">' + noteBox(field, noteTitle, h2Draft(c)) + '</div></div>' + foot();
  }
  function sResults(title, cols) { return head(title, ytdLabel() + ' · y el mes de ' + monthLabel(state.month)) + '<div class="hs-res">' + grid(cols) + '</div>' + foot(); }
  function col(k) { return { name: SEG[k].name, s: state.data[k].s }; }
  function sB2B2C() {
    var o = agg(state.data.b2b2c.s.oc, range(0, closedIdx()));
    var ctry = ((state.data.b2b2c.raw.evo || {}).byCountry || []).map(function (c) {
      var mk = function (m) { var x = c.metrics[m] || {}; return (x.actuals || []).map(function (a, i) { return { act: a || 0, bud: (x.budget || [])[i] || 0, ly: (x.lyAct || [])[i] || 0, yoyN: (x.actualsYoY || [])[i] }; }); };
      return { name: c.label, s: { oc: mk('oc'), nr: mk('nr') } };
    });
    return head(ytdLabel() + ' | B2B2C Results', 'y el mes de ' + monthLabel(state.month)) +
      '<div class="hs-split"><div class="hs-res hs-res1">' + grid([col('b2b2c')]) + '</div>' +
      '<div class="hs-side"><div class="hs-sideh">B2B2C <b class="' + cls(o.vsAbs) + '">' + money(o.vsAbs) + '</b> Op. Contribution vs Budget</div>' +
      noteBox('b2b2c_highlights', 'Highlights', drivers(ctry).slice(0, 3).join('\n')) + '</div></div>' + foot();
  }
  function sB2BLevers() {
    var ci = closedIdx(), om = agg(state.data.min.s.oc, range(0, ci)), oy = agg(state.data.may.s.oc, range(0, ci));
    return head(ytdLabel() + ' | B2B Results', 'y el mes de ' + monthLabel(state.month)) +
      '<div class="hs-split"><div class="hs-res hs-res1">' + grid([col('b2b')]) + '</div><div class="hs-side">' +
      '<div class="hs-sideh">B2B-MIN <b class="' + cls(om.vsAbs) + '">' + money(om.vsAbs) + '</b> Operating Contribution vs Budget</div>' +
      noteBox('min_levers', 'Business levers', drivers(regions('min')).slice(0, 2).join('\n')) +
      '<div class="hs-sideh">B2B-MAY <b class="' + cls(oy.vsAbs) + '">' + money(oy.vsAbs) + '</b> Operating Contribution vs Budget</div>' +
      noteBox('may_levers', 'Business levers', drivers(regions('may')).slice(0, 2).join('\n')) + '</div></div>' + foot();
  }
  function sRegions(c) {
    return sResults(ytdLabel() + ' | ' + SEG[c].name + ' Results', regions(c));
  }

  // B2B2C mensual: la portada del Flow del Daily a pantalla completa (un solo encabezado: el título
  // y el "at risk" los pone public/daily-embed.js). ocm = margen OC/NR del Budget H2 de B2B2C del
  // contable, para estimar el OC at risk.
  function sB2B2CMonthly() {
    var b = state.data.b2b2c.s, h2 = range(6, 11), nb = agg(b.nr, h2).bud, ocm = nb ? agg(b.oc, h2).bud / nb : NaN;
    var src = basePath() + '/daily?embed=b2b2c-cover&organic=' + (organicOn() ? 'yes' : 'no') + (isFinite(ocm) ? '&ocm=' + ocm.toFixed(4) : '');
    return '<iframe class="hs-ifr" src="' + esc(src) + '" title="B2B2C mensual vs Budget (Daily)"></iframe>';
  }

  function slidesHtml(h2h1) {
    var list = [
      ['Portada', sCover()],
      ['H2 vs H1', h2h1 || '<div class="hs-err">No se pudo armar H2 vs H1.</div>', true],
      ['B2B-MAY Evolution', sEvolution('may', 'Principales desafíos H2', 'may_challenges')],
      ['B2B2C mensual vs Budget', sB2B2CMonthly(), true],
      ['B2B-MIN Evolution', sEvolution('min', 'Principales oportunidades H2', 'min_opportunities')],
      ['Resultados', sResults(ytdLabel() + ' | B2B Results', [col('min'), col('may'), col('b2b2c'), col('total')])],
      ['B2B2C', sB2B2C()],
      ['B2B', sResults(ytdLabel() + ' | B2B Results', [col('b2b'), col('min'), col('may')])],
      ['B2B levers', sB2BLevers()],
      ['B2B-MIN por región', sRegions('min')],
      ['B2B-MAY por región', sRegions('may')],
    ];
    return list.map(function (x, i) {
      return '<div class="hs-frame" data-i="' + i + '"><div class="hs-slide' + (i === 0 ? ' hs-s-cover' : '') + (x[2] ? ' hs-s-raw' : '') + '">' + x[1] + '</div>' +
        '<div class="hs-cap">' + (i + 1) + ' · ' + esc(x[0]) + '</div></div>';
    }).join('');
  }

  // ── Visor ──────────────────────────────────────────────────────────────────────────────────
  function fit() {
    if (!panel) return;
    var present = panel.classList.contains('hs-present');
    Array.prototype.forEach.call(panel.querySelectorAll('.hs-frame'), function (f) {
      var s = present ? Math.min(window.innerWidth / W, (window.innerHeight - 40) / H) : f.clientWidth / W;
      var sl = f.querySelector('.hs-slide');
      sl.style.transform = 'scale(' + s + ')';
      if (!present) f.style.height = Math.round(H * s + 26) + 'px'; else f.style.height = '';
    });
  }
  function showOnly(i) {
    var fr = panel.querySelectorAll('.hs-frame');
    state.cur = Math.max(0, Math.min(fr.length - 1, i));
    Array.prototype.forEach.call(fr, function (f, j) { f.classList.toggle('hs-on', j === state.cur); });
    fit();
  }
  function present() {
    panel.classList.add('hs-present');
    showOnly(state.cur);
    if (panel.requestFullscreen) panel.requestFullscreen().catch(function () {});
  }
  function unpresent() {
    panel.classList.remove('hs-present');
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    fit();
  }

  function render() {
    var deck = panel.querySelector('.hs-deck');
    deck.innerHTML = '<p class="hs-load">Armando el deck de ' + monthLabel(state.month) + '… (la primera vez tarda unos segundos)</p>';
    syncToolbar();
    var h2 = window.OwniaH2H1 ? window.OwniaH2H1.slideHtml().catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([loadAll(), loadNotes(), h2]).then(function (r) {
      state.data = r[0];
      deck.innerHTML = slidesHtml(r[2]);
      fit();
    }).catch(function (e) {
      deck.innerHTML = '<p class="hs-err">No se pudieron leer los datos: ' + esc((e && e.message) || e) + '</p>';
    });
  }

  function syncToolbar() {
    var sel = panel.querySelector('.hs-month'), p = fyPeriods(), last = lastClosed();
    sel.innerHTML = p.filter(function (ym) { return !last || ym <= last; }).map(function (ym) {
      return '<option value="' + ym + '"' + (ym === state.month ? ' selected' : '') + '>' + monthLabel(ym) + '</option>';
    }).join('');
    Array.prototype.forEach.call(panel.querySelectorAll('.hs-orgb'), function (b) { b.setAttribute('aria-pressed', String((b.dataset.o === 'yes') === organicOn())); });
  }

  function ensurePanel() {
    if (panel) return panel;
    var css = document.createElement('style');
    css.textContent = [
      '#hs{position:fixed;left:0;right:0;bottom:0;z-index:41;background:#eceef2;overflow:auto;font-family:Poppins,-apple-system,"Segoe UI",sans-serif;color:#1d1d1f}',
      '#hs .hs-tool{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 24px;background:#fff;border-bottom:1px solid #e3e3ea}',
      '#hs .hs-tool h2{font-size:17px;margin:0 8px 0 0}',
      '#hs .hs-tool select,#hs .hs-tool button{font:inherit;font-size:12.5px;border:1px solid #d0d0d8;background:#fff;border-radius:8px;padding:5px 11px;cursor:pointer}',
      '#hs .hs-orgw{display:flex;align-items:center;font-size:12px;color:#6e6e73}#hs .hs-orgw span{margin-right:6px}',
      '#hs .hs-orgb[aria-pressed="true"]{background:#550fed;border-color:#550fed;color:#fff}',
      '#hs .hs-orgb:first-of-type{border-radius:8px 0 0 8px}#hs .hs-orgb:last-of-type{border-radius:0 8px 8px 0;margin-left:-1px}',
      '#hs .hs-go{background:#550fed !important;border-color:#550fed !important;color:#fff;font-weight:600}',
      '#hs .hs-sp{flex:1}',
      '#hs .hs-deck{max-width:1180px;margin:18px auto 40px;padding:0 24px}',
      '#hs .hs-frame{position:relative;width:100%;margin-bottom:22px}',
      '#hs .hs-slide{position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;transform-origin:0 0;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.1);overflow:hidden;padding:26px 36px 30px;box-sizing:border-box}',
      '#hs .hs-s-raw{padding:0}#hs .hs-s-raw .h21-slide{max-width:none;width:' + W + 'px;height:' + H + 'px;aspect-ratio:auto;border-radius:0;box-shadow:none;margin:0}',
      '#hs .hs-cap{position:absolute;left:0;bottom:0;font-size:11.5px;color:#6e6e73}',
      '#hs.hs-present{background:#000}#hs.hs-present .hs-tool,#hs.hs-present .hs-cap{display:none}',
      '#hs.hs-present .hs-deck{max-width:none;margin:0;padding:0}#hs.hs-present .hs-frame{display:none;margin:0}',
      '#hs.hs-present .hs-frame.hs-on{display:block;position:fixed;inset:0;display:flex;align-items:center;justify-content:center}',
      '#hs.hs-present .hs-on .hs-slide{position:relative;transform-origin:center center;flex:none}',
      '#hs .hs-load,#hs .hs-err{color:#6e6e73;font-size:14px;padding:20px 0}',
      // contenido
      '#hs .hs-head{display:flex;align-items:center;border-bottom:3px solid #550fed;padding-bottom:8px}',
      '#hs .hs-title{font-size:30px;font-weight:700;color:#4300d2;flex:1}',
      '#hs .hs-logo{font-size:22px;font-weight:700;color:#550fed;letter-spacing:-.5px}',
      '#hs .hs-tags{display:flex;gap:10px;align-items:center;margin:10px 0 12px}',
      '#hs .hs-org{background:#550fed;color:#fff;font-size:13px;font-weight:600;border-radius:5px;padding:3px 12px}#hs .hs-nom{background:#8e8e93}',
      '#hs .hs-per{font-size:14px;color:#6e6e73}',
      '#hs .hs-foot{position:absolute;right:36px;bottom:10px;font-size:11px;color:#9b9b9b}',
      '#hs .hs-up{color:#1a9e5a}#hs .hs-dn{color:#d4373a}',
      '#hs .hs-g{display:grid;gap:10px 14px;align-items:stretch}',
      '#hs .hs-gh{background:#550fed;color:#fff;font-weight:700;font-size:17px;text-align:center;border-radius:8px;padding:9px}',
      '#hs .hs-gl{display:flex;flex-direction:column;justify-content:center;font-size:17px}#hs .hs-gl span{font-size:13px;color:#6e6e73}',
      '#hs .hs-k{border:1px solid #e1dcf7;border-radius:10px;padding:10px 10px 8px;text-align:center;background:#fbfaff}',
      '#hs .hs-kv{font-size:30px;font-weight:700;color:#4300d2;line-height:1.15}',
      '#hs .hs-ky,#hs .hs-kb{font-size:14.5px;font-weight:600}',
      '#hs .hs-km{font-size:11.5px;color:#6e6e73;margin-top:5px;border-top:1px dashed #e1dcf7;padding-top:4px}',
      '#hs .hs-res{margin-top:6px}',
      '#hs .hs-split{display:grid;grid-template-columns:400px 1fr;gap:26px;margin-top:6px}',
      '#hs .hs-res1 .hs-g{grid-template-columns:150px 1fr !important}',
      '#hs .hs-side{display:flex;flex-direction:column;gap:8px}',
      '#hs .hs-sideh{font-size:17px;font-weight:600;border-bottom:2px solid #ece7fd;padding-bottom:4px}',
      '#hs .hs-note{display:flex;flex-direction:column;flex:1;min-height:0}',
      '#hs .hs-nt{font-size:15px;font-weight:700;color:#4300d2;margin-bottom:4px}',
      '#hs .hs-nx{flex:1;background:#f6f4fe;border-radius:8px;padding:10px 12px;font-size:14.5px;line-height:1.5;outline:none;overflow:hidden;white-space:normal}',
      '#hs .hs-nx:focus{background:#fff;box-shadow:0 0 0 2px #550fed}',
      '#hs .hs-draft{color:#55555c;font-style:italic}',
      '#hs .hs-nm{font-size:10.5px;color:#8e8e93;margin-top:3px}',
      '#hs .hs-evo{display:grid;grid-template-columns:230px 1fr 230px;gap:16px;height:575px}',
      '#hs .hs-evleft{display:flex;flex-direction:column;gap:14px}',
      '#hs .hs-ecl{font-size:14px;font-weight:700;color:#4300d2;margin-bottom:4px}',
      '#hs .hs-ec{position:relative;border:1px solid #e1dcf7;border-radius:8px;padding:8px 6px 6px 30px;font-size:11.5px;text-align:center;background:#fbfaff}',
      '#hs .hs-ecv{font-size:19px;font-weight:700;color:#4300d2}#hs .hs-ecbig .hs-ecv{font-size:26px}',
      '#hs .hs-ectag{position:absolute;left:6px;top:8px;font-size:11px;font-weight:700;color:#550fed}',
      '#hs .hs-ecrow{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}#hs .hs-ecrow .hs-ec{padding-left:6px;padding-top:18px}',
      '#hs .hs-ecrow .hs-ectag{left:50%;transform:translateX(-50%);top:3px}',
      '#hs .hs-evmid{display:flex;flex-direction:column;gap:6px}',
      '#hs .hs-evt{font-size:15px;font-weight:700}#hs .hs-evt span{font-size:11px;font-weight:400;color:#6e6e73;margin-left:6px}',
      '#hs .hs-lrr,#hs .hs-lbud{display:inline-block;width:9px;height:9px;border-radius:2px;margin:0 3px 0 6px;background:#a99ff2}#hs .hs-lbud{background:#d9dbe0}',
      '#hs .hs-ev{width:100%;height:auto}',
      '#hs .hs-evv{font-size:10.5px;font-weight:700;text-anchor:middle;fill:#1d1d1f}#hs .hs-evb{font-size:9.5px;text-anchor:middle;fill:#8e8e93}',
      '#hs .hs-evm{font-size:11px;text-anchor:middle;fill:#6e6e73}#hs .hs-evc{font-size:11px;font-weight:700;text-anchor:middle}',
      '#hs .hs-evc.hs-up{fill:#1a9e5a}#hs .hs-evc.hs-dn{fill:#d4373a}',
      '#hs .hs-evp{font-size:10.5px;font-weight:700;text-anchor:middle;fill:#5b4fe0}#hs .hs-evl{font-size:11px;font-weight:600;fill:#6e6e73}',
      '#hs .hs-evright{display:flex;flex-direction:column}',
      '#hs .hs-ifr{border:0;display:block;width:' + W + 'px;height:' + H + 'px}',
      '#hs .hs-cover{position:absolute;inset:0;background:linear-gradient(120deg,#4300d2,#550fed 60%,#7b3ff5);color:#fff;padding:180px 90px}',
      '#hs .hs-cv1{font-size:56px;font-weight:700}#hs .hs-cv2{font-size:40px;font-weight:500;opacity:.92}',
      '#hs .hs-cv3{font-size:20px;margin-top:30px;opacity:.85}#hs .hs-cvlogo{position:absolute;right:60px;bottom:40px;font-size:32px;font-weight:700}',
      // PDF: una slide por página, sin el resto del Hub
      '@media print{@page{size:' + W + 'px ' + H + 'px;margin:0}body > *:not(#hs){display:none !important}' +
        '#hs{position:static;background:#fff;overflow:visible}#hs .hs-tool,#hs .hs-cap,#hs .hs-nm{display:none}#hs .hs-deck{max-width:none;margin:0;padding:0}' +
        '#hs .hs-frame{height:' + H + 'px !important;width:' + W + 'px;margin:0;page-break-after:always;break-after:page}' +
        '#hs .hs-slide{transform:none !important;box-shadow:none}#hs .hs-draft{font-style:normal;color:#1d1d1f}' +
        '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}',
    ].join('\n');
    document.head.appendChild(css);
    panel = document.createElement('div');
    panel.id = 'hs';
    panel.style.display = 'none';
    panel.innerHTML = '<div class="hs-tool"><h2>Slides mensuales</h2>' +
      '<label>Cierre <select class="hs-month" aria-label="Mes cerrado"></select></label>' +
      '<div class="hs-orgw" role="group" aria-label="Organic"><span>Organic</span><button type="button" class="hs-orgb" data-o="yes">YES</button><button type="button" class="hs-orgb" data-o="no">NO</button></div>' +
      '<span class="hs-sp"></span><button type="button" class="hs-go hs-pres">▶ Presentar</button>' +
      '<button type="button" class="hs-pdf">Exportar PDF</button><button type="button" class="hs-close">← Volver al P&amp;L</button></div>' +
      '<div class="hs-deck"></div>';
    document.body.appendChild(panel);
    panel.querySelector('.hs-month').onchange = function () { state.month = this.value; render(); };
    Array.prototype.forEach.call(panel.querySelectorAll('.hs-orgb'), function (b) {
      b.onclick = function () {
        var on = b.dataset.o === 'yes';
        if (on === organicOn()) return;
        if (typeof window.setOrganic === 'function') window.setOrganic(on); else if (window._state) window._state.organic = on;
        render();
      };
    });
    panel.querySelector('.hs-pres').onclick = present;
    panel.querySelector('.hs-pdf').onclick = function () { unpresent(); setTimeout(function () { window.print(); }, 50); };
    panel.querySelector('.hs-close').onclick = close;
    // Notas: se guardan al salir del cuadro (solo si cambió)
    panel.addEventListener('focusout', function (ev) {
      var el = ev.target;
      if (!el.classList || !el.classList.contains('hs-nx')) return;
      var f = el.getAttribute('data-field'), prev = state.notes[f] ? state.notes[f].text : null;
      var now = el.innerText.replace(/ /g, ' ').trim();
      if (prev === now || (prev === null && el.classList.contains('hs-draft') && el._draft === now)) return;
      saveNote(el);
    });
    panel.addEventListener('focusin', function (ev) {
      var el = ev.target;
      if (el.classList && el.classList.contains('hs-nx') && el._draft === undefined) el._draft = el.innerText.replace(/ /g, ' ').trim();
    });
    document.addEventListener('keydown', function (ev) {
      if (!panel || panel.style.display === 'none') return;
      var t = ev.target && ev.target.isContentEditable;
      if (panel.classList.contains('hs-present') && !t) {
        if (ev.key === 'ArrowRight' || ev.key === 'PageDown' || ev.key === ' ') { ev.preventDefault(); showOnly(state.cur + 1); }
        else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); showOnly(state.cur - 1); }
        else if (ev.key === 'Escape') unpresent();
      } else if (ev.key === 'Escape' && !t) close();
    });
    document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && panel.classList.contains('hs-present')) unpresent(); });
    window.addEventListener('resize', function () { if (panel.style.display !== 'none') { place(); fit(); } });
    return panel;
  }

  function place() {
    var nav = document.getElementById('ownia-hubnav');
    panel.style.top = (nav ? Math.max(0, Math.round(nav.getBoundingClientRect().bottom)) : 0) + 'px';
  }
  function close() { if (panel) { unpresent(); panel.style.display = 'none'; } }

  window.openSlidesMensuales = function () {
    ensurePanel();
    place();
    panel.style.display = '';
    if (typeof window._closeNav === 'function') window._closeNav();
    if (!state.month) state.month = lastClosed() || fyPeriods()[5];
    render();
  };
  // Cualquier otra pestaña o cambio de LoB cierra el deck.
  document.addEventListener('DOMContentLoaded', function () {
    var orig = window.switchLob;
    if (typeof orig === 'function') window.switchLob = function () { close(); return orig.apply(this, arguments); };
  });
})();
