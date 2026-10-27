/* Daily Dashboard en Ownia — "Weekly · vs B2C": la última semana de B2B2C y B2B contra B2C, para el
 * CEO (pedido de Diego, 2026-10-26). Lo inyecta server/index.js en el Daily (`layout` en
 * server/modules.js). El HTML de Apps Script no se toca.
 *
 * Una sola slide (1280×720) que se ve en dos lugares:
 *  - arriba de la solapa "Benchmark vs B2C", escalada al ancho (con selector GB / NR / FVM);
 *  - en el Flow Semanal, después del separador "Weekly Summary" (se exporta con el deck).
 * Contenido (semana ISO lunes–domingo, la última completa con datos):
 *  - titular automático;
 *  - tabla B2B2C · B2B · B2C con la semana, vs L4W (promedio de las 4 anteriores), YoY (misma semana
 *    ISO del año pasado) y vs Budget, en GB / NR / FVM, y la brecha de B2B2C y B2B contra B2C en pp;
 *  - 13 semanas: YoY y % vs Budget de los tres negocios.
 * Fuentes (las mismas del Benchmark): B2B2C actuals / LY / Budget del JSON del Daily (respeta Partner
 * TBD), B2B en fecha de gestión (b2b_gd), B2C real del Daily y su Budget semanal
 * (b2c_budget_weekly.json, Daily_Dashboard/b2c_budget_sync.py, vía getB2CBudgetWeekly).
 * Organic YES: los reales de los TRES negocios a TC Budget (vs Budget) y el YoY a TC Actuals LY
 * (_orgRows_, opción B) — B2C también, para comparar en la misma moneda. COI Brasil = Excluir: el FVM
 * de B2B2C y B2B sin COI de Brasil; el de B2C (real y Budget) lo incluye.
 */
(function () {
  'use strict';

  var W = window;
  var BIZ = [
    { k: 'b2b2c', lbl: 'B2B2C', c: '#5626e9' },
    { k: 'b2b', lbl: 'B2B', c: '#0891b2' },
    { k: 'b2c', lbl: 'B2C', c: '#8e8e93', ref: true },
  ];
  var MET = { gb: 'Gross Bookings', nr: 'Net Revenues', fvm: 'FVM' };
  var NWEEKS = 13;
  var state = { metric: 'nr', bud: null, budState: 'idle', b2bState: 'idle' };

  // ── Semanas ISO ────────────────────────────────────────────────────────────────────────────
  function iso(ymd) {
    var p = ymd.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])), day = d.getUTCDay() || 7;
    var thu = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 4 - day)), j1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
    return thu.getUTCFullYear() * 100 + Math.ceil(((thu - j1) / 864e5 + 1) / 7);
  }
  function monday(key) {
    var y = Math.floor(key / 100), w = key % 100, j4 = new Date(Date.UTC(y, 0, 4)), dj4 = j4.getUTCDay() || 7;
    return new Date(Date.UTC(y, 0, 4 - dj4 + 1 + (w - 1) * 7));
  }
  function ymd(d) { return d.toISOString().substring(0, 10); }
  function prevKey(key, n) { var m = monday(key); m.setUTCDate(m.getUTCDate() - 7 * n); return iso(ymd(m)); }
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function wkRange(key) {
    var a = monday(key), b = new Date(a); b.setUTCDate(b.getUTCDate() + 6);
    return a.getUTCDate() + (a.getUTCMonth() === b.getUTCMonth() ? '' : ' ' + MES[a.getUTCMonth()]) + '–' + b.getUTCDate() + ' ' + MES[b.getUTCMonth()];
  }
  function wkLbl(key) { return 'W' + (key % 100); }
  // Última semana completa (termina en domingo) con datos hasta `upTo`
  function lastWeek(upTo) {
    var p = upTo.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])), dow = d.getUTCDay();
    if (dow !== 0) d.setUTCDate(d.getUTCDate() - dow);
    return iso(ymd(d));
  }

  // ── Datos ──────────────────────────────────────────────────────────────────────────────────
  function nrOf(r) { return r.net_revenues != null ? r.net_revenues : r.net_revenue; }
  // Agrega filas diarias por semana ISO: {key: {gb, nr, fvm, gbY, nrY, fvmY}}; shift = años a sumar (LY)
  function byWeek(rows, shift) {
    var o = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.fecha) return;
      var k = iso(String(r.fecha).substring(0, 10)) + (shift || 0) * 100, x = o[k] = o[k] || { gb: 0, nr: 0, fvm: 0, gbY: 0, nrY: 0, fvmY: 0 };
      var nrF = r.net_revenues != null ? 'net_revenues' : 'net_revenue';
      x.gb += +r.gross_bookings || 0; x.nr += +nrOf(r) || 0; x.fvm += +r.fvm || 0;
      x.gbY += +W._yv_(r, 'gross_bookings') || 0; x.nrY += +W._yv_(r, nrF) || 0; x.fvmY += +W._yv_(r, 'fvm') || 0;
    });
    return o;
  }
  function b2cBudWeeks() {
    var o = {}, b = state.bud;
    if (!b || !b.rows) return o;
    var c = b.cols, ia = c.indexOf('anio'), iw = c.indexOf('semana'), ig = c.indexOf('gross_bookings'), inr = c.indexOf('net_revenues'), iv = c.indexOf('fvm');
    b.rows.forEach(function (r) {
      var k = r[ia] * 100 + r[iw], x = o[k] = o[k] || { gb: 0, nr: 0, fvm: 0 };
      x.gb += r[ig]; x.nr += r[inr]; x.fvm += r[iv];
    });
    return o;
  }
  function orgT() { return (W._dlOrganic && W._fxTbl) ? 'budget' : ''; }
  function series() {
    var t = orgT(), rb = W.b2bcRaw_() || W._rawB2BC, B = W._rawB2B;
    var S = {
      b2b2c: { cur: byWeek(W._orgRows_(rb.actuals || [], t)), ly: byWeek(rb.actuals_ly, 1), bud: byWeek(rb.budget) },
      b2b: B ? { cur: byWeek(W._orgRows_(B.b2b_gd || [], t)), ly: byWeek(B.b2b_gd_ly, 1), bud: byWeek(B.b2b_budget_gd) } : null,
      b2c: { cur: byWeek(W._orgRows_(W._b2cRows_(W._rawB2BC), t)), ly: byWeek(W._b2cLyRows_(W._rawB2BC), 1), bud: b2cBudWeeks() },
    };
    return S;
  }
  // Métricas de una semana para un negocio y una métrica
  function stats(s, key, mk) {
    if (!s) return null;
    var c = s.cur[key] || null, v = c ? c[mk] : NaN, vy = c ? c[mk + 'Y'] : NaN;
    var ly = s.ly[key] ? s.ly[key][mk] : NaN, bd = s.bud[key] ? s.bud[key][mk] : NaN, l4 = 0, n4 = 0;
    for (var i = 1; i <= 4; i++) { var p = s.cur[prevKey(key, i)]; if (p) { l4 += p[mk]; n4++; } }
    var avg = n4 ? l4 / n4 : NaN;
    function pct(a, b) { return isFinite(a) && isFinite(b) && b > 0 ? (a / b - 1) * 100 : NaN; }
    return { v: v, l4: pct(v, avg), yoy: pct(vy, ly), bud: pct(v, bd), budV: bd };
  }

  // ── Formato ────────────────────────────────────────────────────────────────────────────────
  function money(v) { if (!isFinite(v)) return '—'; var a = Math.abs(v), s = v < 0 ? '−' : ''; return s + '$' + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : Math.round(a / 1e3) + 'K'); }
  function pc(v) { return isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(0) + '%' : '—'; }
  function pp(v) { return isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(0) + 'pp' : '—'; }
  function cl(v) { return !isFinite(v) ? '' : v >= 0 ? 'ow-up' : 'ow-dn'; }

  // ── Slide ──────────────────────────────────────────────────────────────────────────────────
  function upTo() {
    var L = W._rawB2BC.meta.last_actuals_date;
    var v = (typeof W.flowVDate_ === 'function' && W._activeView === 'flow') ? W.flowVDate_() : L;
    return v < L ? v : L;
  }
  function headline(S, key) {
    var mk = state.metric, a = stats(S.b2b2c, key, mk), b = stats(S.b2b, key, mk), c = stats(S.b2c, key, mk), out = [];
    function one(lbl, x) {
      if (!x) return '';
      return '<b>' + lbl + '</b> ' + money(x.v) + ' · <span class="' + cl(x.yoy) + '">' + pc(x.yoy) + ' YoY</span> (' +
        '<span class="' + cl(x.yoy - c.yoy) + '">' + pp(x.yoy - c.yoy) + ' vs B2C</span>) · ' +
        '<span class="' + cl(x.bud) + '">' + pc(x.bud) + ' vs Budget</span> (B2C ' + pc(c.bud) + ')';
    }
    out.push(one('B2B2C', a)); if (b) out.push(one('B2B', b));
    return MET[mk] + ' ' + wkLbl(key) + ': ' + out.filter(Boolean).join(' &nbsp;|&nbsp; ');
  }
  function table(S, key) {
    var mks = ['gb', 'nr', 'fvm'];
    var h1 = '<tr><th rowspan="2" class="ow-l"></th>' + mks.map(function (m) { return '<th colspan="4" class="' + (m === state.metric ? 'ow-sel' : '') + '">' + MET[m] + '</th>'; }).join('') + '</tr>';
    var h2 = '<tr>' + mks.map(function () { return '<th>' + wkLbl(key) + '</th><th>vs L4W</th><th>YoY</th><th>vs Bdg</th>'; }).join('') + '</tr>';
    var C = {};
    var body = BIZ.map(function (z) {
      return '<tr class="' + (z.ref ? 'ow-ref' : '') + '"><td class="ow-l"><i style="background:' + z.c + '"></i>' + z.lbl + (z.ref ? ' <small>referencia</small>' : '') + '</td>' +
        mks.map(function (m) {
          var x = stats(S[z.k], key, m); (C[z.k] = C[z.k] || {})[m] = x;
          if (!x) return '<td colspan="4" class="ow-na">cargando…</td>';
          return '<td class="ow-v">' + money(x.v) + '</td><td class="' + cl(x.l4) + '">' + pc(x.l4) + '</td><td class="' + cl(x.yoy) + '">' + pc(x.yoy) + '</td><td class="' + cl(x.bud) + '">' + pc(x.bud) + '</td>';
        }).join('') + '</tr>';
    }).join('');
    // Brechas vs B2C (pp): vs L4W, YoY y vs Budget
    body += BIZ.filter(function (z) { return !z.ref; }).map(function (z) {
      return '<tr class="ow-gap"><td class="ow-l">' + z.lbl + ' − B2C</td>' + mks.map(function (m) {
        var x = C[z.k] && C[z.k][m], r = C.b2c && C.b2c[m];
        if (!x || !r) return '<td colspan="4"></td>';
        return '<td></td><td class="' + cl(x.l4 - r.l4) + '">' + pp(x.l4 - r.l4) + '</td><td class="' + cl(x.yoy - r.yoy) + '">' + pp(x.yoy - r.yoy) + '</td><td class="' + cl(x.bud - r.bud) + '">' + pp(x.bud - r.bud) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<table class="ow-ceo-t"><thead>' + h1 + h2 + '</thead><tbody>' + body + '</tbody></table>';
  }
  // Líneas de 13 semanas: f(stats) → % ; etiqueta en el último punto de cada negocio
  function chart(title, S, keys, f) {
    var Wc = 570, Hc = 250, x0 = 40, x1 = Wc - 46, y0 = 18, y1 = Hc - 30, mk = state.metric, all = [];
    var L = BIZ.map(function (z) { var pts = keys.map(function (k) { var x = stats(S[z.k], k, mk); return x ? f(x) : NaN; }); all = all.concat(pts.filter(isFinite)); return { z: z, pts: pts }; });
    if (!all.length) return '<div class="ow-ceo-c"><div class="ow-ceo-ct">' + title + '</div><p class="ow-na">sin datos</p></div>';
    var lo = Math.min(0, Math.min.apply(null, all)), hi = Math.max(0, Math.max.apply(null, all)), pad = (hi - lo) * 0.08 || 5;
    lo -= pad; hi += pad;
    function X(i) { return x0 + i * (x1 - x0) / (keys.length - 1); }
    function Y(v) { return y1 - (v - lo) / (hi - lo) * (y1 - y0); }
    var svg = '<svg viewBox="0 0 ' + Wc + ' ' + Hc + '" class="ow-ceo-svg">';
    // grilla: 0 y dos referencias
    // sin las referencias que caen pegadas al 0 (se pisaban las etiquetas)
    [lo + pad, 0, hi - pad].filter(function (g) { return g === 0 || Math.abs(Y(g) - Y(0)) > 14; }).forEach(function (g) {
      svg += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + Y(g).toFixed(1) + '" y2="' + Y(g).toFixed(1) + '" stroke="' + (g === 0 ? '#b8b8c4' : '#eeeef3') + '"' + (g === 0 ? '' : ' stroke-dasharray="3 3"') + '/>' +
        '<text x="' + (x0 - 4) + '" y="' + (Y(g) + 3).toFixed(1) + '" class="ow-ax" text-anchor="end">' + pc(g) + '</text>';
    });
    keys.forEach(function (k, i) { svg += '<text x="' + X(i).toFixed(1) + '" y="' + (Hc - 12) + '" class="ow-ax" text-anchor="middle">' + wkLbl(k) + '</text>'; });
    var lastY = [];
    L.forEach(function (l) {
      var p = l.pts.map(function (v, i) { return isFinite(v) ? X(i).toFixed(1) + ',' + Y(v).toFixed(1) : null; }).filter(Boolean);
      if (!p.length) return;
      svg += '<polyline fill="none" stroke="' + l.z.c + '" stroke-width="' + (l.z.ref ? 2 : 2.6) + '"' + (l.z.ref ? ' stroke-dasharray="5 4"' : '') + ' points="' + p.join(' ') + '"/>';
      l.pts.forEach(function (v, i) { if (isFinite(v) && !l.z.ref) svg += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="2.6" fill="' + l.z.c + '"/>'; });
      var li = l.pts.length - 1; while (li >= 0 && !isFinite(l.pts[li])) li--;
      if (li >= 0) {
        var yy = Y(l.pts[li]);
        lastY.forEach(function (o) { if (Math.abs(o - yy) < 12) yy = o + (yy >= o ? 12 : -12); });
        lastY.push(yy);
        svg += '<text x="' + (X(li) + 6).toFixed(1) + '" y="' + (yy + 4).toFixed(1) + '" class="ow-lv" fill="' + l.z.c + '">' + pc(l.pts[li]) + '</text>';
      }
    });
    svg += '</svg>';
    return '<div class="ow-ceo-c"><div class="ow-ceo-ct">' + title + '</div>' + svg + '</div>';
  }
  function bodyHtml() {
    if (!W._rawB2BC || !W._rawB2BC.meta) return '<p class="ow-na">Cargando datos del Daily…</p>';
    var S = series(), key = lastWeek(upTo()), keys = [];
    for (var i = NWEEKS - 1; i >= 0; i--) keys.push(prevKey(key, i));
    var notes = [];
    if (state.budState === 'error') notes.push('No se pudo leer el Budget B2C semanal');
    if (!S.b2b) notes.push('B2B cargando');
    var org = orgT() ? 'Organic: reales de los tres negocios a TC Budget; YoY a TC Actuals LY. ' : '';
    var coi = W._exCoiBr ? 'FVM de B2B2C / B2B sin COI de Brasil (B2C lo incluye). ' : '';
    return '<div class="ow-ceo-hl">' + headline(S, key) + '</div>' + table(S, key) +
      '<div class="ow-ceo-cs">' + chart(MET[state.metric] + ' · YoY por semana', S, keys, function (x) { return x.yoy; }) +
      chart(MET[state.metric] + ' · % vs Budget por semana', S, keys, function (x) { return x.bud; }) + '</div>' +
      '<div class="ow-ceo-leg">' + BIZ.map(function (z) { return '<span><i style="background:' + z.c + '"></i>' + z.lbl + (z.ref ? ' (referencia)' : '') + '</span>'; }).join('') + '</div>' +
      '<div class="ow-ceo-n">Semana ISO (lun–dom) · ' + wkLbl(key) + ' = ' + wkRange(key) + ' · L4W = promedio de las 4 semanas anteriores · YoY vs la misma semana del año pasado · B2B en fecha de gestión. ' +
      org + coi + notes.join(' · ') + '</div>';
  }
  function title() {
    if (!W._rawB2BC || !W._rawB2BC.meta) return 'Weekly Performance vs B2C';
    var key = lastWeek(upTo());
    return 'Weekly Performance vs B2C · ' + wkLbl(key) + ' (' + wkRange(key) + ')';
  }
  function slideHtml() {
    var head = typeof W.flHead_ === 'function' ? W.flHead_(title()) : '<div class="fl-head"><div class="fl-title">' + title() + '</div></div>';
    return '<div class="flow-slide ow-ceo-slide">' + head + '<div class="ow-ceo-body">' + bodyHtml() + '</div></div>';
  }

  // ── Carga (Budget B2C y B2B) ───────────────────────────────────────────────────────────────
  function refreshAll() {
    var b = document.getElementById('ow-ceo-bench-slide');
    if (b && W._activeView === 'benchmark') { b.innerHTML = slideHtml(); fitBench(); }
    Array.prototype.forEach.call(document.querySelectorAll('#flow-track .ow-ceo-slide'), function (sl) {
      var nb = sl.querySelector('.ow-ceo-body'); if (nb) nb.innerHTML = bodyHtml();
      var tt = sl.querySelector('.fl-title'); if (tt) tt.textContent = title();
    });
  }
  function ensureData() {
    if (state.budState === 'idle') {
      state.budState = 'loading';
      W.google.script.run.withSuccessHandler(function (r) { state.bud = r; state.budState = 'ok'; refreshAll(); })
        .withFailureHandler(function () { state.budState = 'error'; refreshAll(); }).getB2CBudgetWeekly();
    }
    if (!W._rawB2B && state.b2bState === 'idle' && W._rawB2BC) {
      state.b2bState = 'loading';
      W.google.script.run.withSuccessHandler(function (raw) {
        if (!W._rawB2B) {
          raw.b2b_gd = W.expandCompact_(raw.b2b_gd); raw.b2b_gd_ly = W.expandCompact_(raw.b2b_gd_ly);
          raw.b2b_ri = W.expandCompact_(raw.b2b_ri); raw.b2b_ri_ly = W.expandCompact_(raw.b2b_ri_ly);
          W._rawB2B = W.applyCoiBr_(raw, W._COIBR_KEYS_.b2b);
        }
        state.b2bState = 'ok'; refreshAll();
      }).withFailureHandler(function () { state.b2bState = 'error'; refreshAll(); }).getRawB2B();
    }
  }

  // ── Benchmark: sección arriba de todo ──────────────────────────────────────────────────────
  function fitBench() {
    var wrap = document.getElementById('ow-ceo-bench-wrap'), sl = document.querySelector('#ow-ceo-bench-slide .flow-slide');
    if (!wrap || !sl) return;
    var s = Math.min(1, wrap.clientWidth / 1280);
    sl.style.transform = 'scale(' + s + ')'; sl.style.transformOrigin = '0 0';
    wrap.style.height = Math.round(720 * s) + 'px';
  }
  function ensureBench() {
    var host = document.querySelector('#view-benchmark .content');
    if (!host || document.getElementById('ow-ceo-bench')) return;
    var box = document.createElement('div');
    box.id = 'ow-ceo-bench';
    box.innerHTML = '<div class="ow-ceo-bar"><div class="section-hdr" style="margin:0">Weekly · vs B2C <span style="font-weight:400;text-transform:none;letter-spacing:0">(vista para el CEO · también en el Flow Semanal)</span></div>' +
      '<div class="tab-toggle">' + Object.keys(MET).map(function (m) { return '<button class="ttab" data-owm="' + m + '">' + (m === 'fvm' ? 'FVM' : m.toUpperCase()) + '</button>'; }).join('') + '</div></div>' +
      '<div id="ow-ceo-bench-wrap"><div id="ow-ceo-bench-slide"></div></div>';
    var hdr = host.querySelector('.section-hdr-row');
    host.insertBefore(box, hdr ? hdr : host.firstChild);
    Array.prototype.forEach.call(box.querySelectorAll('[data-owm]'), function (b) {
      b.onclick = function () { state.metric = b.getAttribute('data-owm'); syncBtns(); refreshAll(); };
    });
    syncBtns();
    W.addEventListener('resize', fitBench);
  }
  function syncBtns() {
    Array.prototype.forEach.call(document.querySelectorAll('#ow-ceo-bench [data-owm]'), function (b) { b.classList.toggle('active', b.getAttribute('data-owm') === state.metric); });
  }

  var css = document.createElement('style');
  css.textContent = [
    '#ow-ceo-bench{margin-bottom:22px}',
    '#ow-ceo-bench .ow-ceo-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px}',
    '#ow-ceo-bench-wrap{position:relative;overflow:hidden;border-radius:8px}',
    '#ow-ceo-bench-slide .flow-slide{position:absolute;left:0;top:0}',
    // fuera del Flow no están sus variables (título, logo): las mismas de #view-flow
    '#ow-ceo-bench{--fl-purple:#5626e9;--fl-purple2:#8e5ff3;--fl-green:#15803d;--fl-red:#dc2626;--fl-amber:#b45309;--fl-ink:#1a1a2e;--fl-ink2:#4a4a63;--fl-ink3:#6b6b85;--fl-gray:#c9c9d6;--fl-line:#e6e6ee}',
    '.ow-ceo-slide .ow-ceo-body{padding:10px 40px 0;height:calc(720px - 96px);display:flex;flex-direction:column;gap:8px;font-family:Poppins,sans-serif;color:#1d1d1f}',
    '.ow-ceo-hl{font-size:14px;line-height:1.45;background:#f6f4fe;border-left:4px solid #550fed;border-radius:6px;padding:8px 12px}',
    '.ow-ceo-slide .ow-up{color:#1a9e5a}.ow-ceo-slide .ow-dn{color:#d4373a}',
    '.ow-ceo-t{width:100%;border-collapse:collapse;font-size:12.5px}',
    '.ow-ceo-t th{background:#550fed;color:#fff;font-weight:600;padding:4px 6px;text-align:right;border-left:1px solid #fff}',
    '.ow-ceo-t thead tr:first-child th{text-align:center;font-size:13px}.ow-ceo-t th.ow-sel{background:#3d00b8}',
    '.ow-ceo-t td{padding:5px 6px;text-align:right;border-bottom:1px solid #eeecf6;white-space:nowrap}',
    '.ow-ceo-t .ow-l{text-align:left;font-weight:700;min-width:120px}.ow-ceo-t .ow-l i,.ow-ceo-leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}',
    '.ow-ceo-t .ow-l small{font-weight:400;color:#8e8e93}.ow-ceo-t td.ow-v{font-weight:700}',
    '.ow-ceo-t tr.ow-ref td{background:#f7f7f9;color:#55555c}.ow-ceo-t tr.ow-ref td.ow-up,.ow-ceo-t tr.ow-ref td.ow-dn{opacity:.9}',
    '.ow-ceo-t tr.ow-gap td{font-size:12px;background:#fbfaff}.ow-ceo-t tr.ow-gap td.ow-l{font-weight:600;color:#4300d2}',
    '.ow-ceo-cs{display:grid;grid-template-columns:1fr 1fr;gap:20px;flex:1;min-height:0}',
    '.ow-ceo-ct{font-size:14px;font-weight:700;color:#4300d2;text-align:center}',
    '.ow-ceo-svg{width:100%;height:auto;display:block}.ow-ceo-svg .ow-ax{font-size:10px;fill:#8e8e93}.ow-ceo-svg .ow-lv{font-size:11px;font-weight:700}',
    '.ow-ceo-leg{display:flex;gap:16px;justify-content:center;font-size:11.5px;color:#55555c;margin-top:-4px}',
    '.ow-ceo-n{font-size:10.5px;color:#8e8e93;line-height:1.35}',
    '.ow-ceo-slide .ow-na{color:#8e8e93;font-size:13px;text-align:center}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  document.addEventListener('DOMContentLoaded', function () {
    // Benchmark: la sección va arriba y se rearma con cada render del Benchmark (switches incluidos)
    var origBench = W.renderBenchmark_;
    if (typeof origBench === 'function') {
      W.renderBenchmark_ = function () {
        var r = origBench.apply(this, arguments);
        try { ensureBench(); ensureData(); refreshAll(); } catch (e) { console.warn('[daily-ceo-weekly] benchmark:', e); }
        return r;
      };
    }
    // Flow: slide después del separador "Weekly Summary"
    if (Array.isArray(W.FLOW_DECK) && !W.FLOW_DECK.some(function (d) { return d.kind === 'ceo_weekly'; })) {
      var at = W.FLOW_DECK.findIndex(function (d) { return d.kind === 'divider' && d.flag === 'WK'; });
      W.FLOW_DECK.splice(at < 0 ? W.FLOW_DECK.length : at + 1, 0, { kind: 'ceo_weekly', name: 'Weekly — vs B2C (CEO)' });
    }
    var origSlide = W.flowBuildSlide_;
    if (typeof origSlide === 'function') {
      W.flowBuildSlide_ = function (def, idx) {
        if (def && def.kind === 'ceo_weekly') { W._flowSeries[idx] = []; try { ensureData(); return slideHtml(); } catch (e) { return '<div class="flow-slide"><p>' + e.message + '</p></div>'; } }
        return origSlide.apply(this, arguments);
      };
    }
  });
  W.OwniaCeoWeekly = { slideHtml: slideHtml, refresh: refreshAll };
})();
