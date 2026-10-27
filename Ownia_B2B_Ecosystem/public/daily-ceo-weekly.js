/* Daily Dashboard en Ownia — "Weekly · vs B2C": la última semana y el momentum de B2B2C y B2B contra
 * B2C, para el CEO, el Chief y el VP Comercial (pedido de Diego, 2026-10-26/27). Lo inyecta
 * server/index.js en el Daily (`layout` en server/modules.js). El HTML de Apps Script no se toca.
 *
 * Cuatro slides (1280×720) que se ven en dos lugares:
 *  - arriba de la solapa "Benchmark vs B2C", escaladas al ancho (selector GB / NR / FVM y COI Brasil);
 *  - en el Flow Semanal, después del separador "Weekly Summary" (se exportan con el deck).
 * Slide 1 — Total (semana ISO lunes–domingo, la última completa con datos):
 *  - titular de la semana y diagnóstico de momentum (¿desaceleramos vs la tendencia, y B2C?);
 *  - momentum: YoY de las últimas 4 semanas vs las 4 anteriores, por negocio, y la brecha vs B2C;
 *  - tabla B2B2C · B2B · B2C: semana, vs L4W (promedio de las 4 anteriores), YoY (misma semana ISO
 *    del año pasado) y vs Budget, en GB / NR / FVM, y la brecha vs B2C en pp;
 *  - 13 semanas: YoY (punto semanal + tendencia móvil de 4 semanas), brecha vs B2C (tendencia 4 sem)
 *    y % vs Budget, con las semanas de eventos de industria marcadas (este año y el pasado).
 * Slide 2 — Momentum por región (Brasil · México · Hispa · Globales, como el Weekly): YoY 4 semanas
 *  vs las 4 anteriores de los tres negocios, brecha vs B2C ahora y antes, y la tendencia por región.
 * Slide 3 — B2B2C: aporte de cada partner al cambio del YoY de su región (detractores y triunfadores).
 * Slide 4 — B2B: API vs HTML, peso, YoY y aporte de cada canal al cambio del YoY de B2B, por región.
 * Fuentes (las mismas del Benchmark): B2B2C actuals / LY / Budget del JSON del Daily (respeta Partner
 * TBD), B2B en fecha de gestión (b2b_gd), B2C real del Daily y su Budget semanal
 * (b2c_budget_weekly.json, Daily_Dashboard/b2c_budget_sync.py, vía getB2CBudgetWeekly). Eventos:
 * industry_events.json (getIndustryEvents, el del "Industry events tracker").
 * Organic YES: los reales de los TRES negocios a TC Budget (vs Budget) y el YoY a TC Actuals LY
 * (_orgRows_, opción B) — B2C también, para comparar en la misma moneda. COI Brasil = Excluir: el FVM
 * sin COI / Financial Result de Brasil en los tres negocios: real, LY y Budget de B2C incluidos (también en el
 * Benchmark clásico de abajo: applyB2CCoi).
 */
(function () {
  'use strict';

  var W = window;
  var BIZ = [
    { k: 'b2b2c', lbl: 'B2B2C', c: '#5626e9' },
    { k: 'b2b', lbl: 'B2B', c: '#0891b2' },
    { k: 'b2c', lbl: 'B2C', c: '#8e8e93', ref: true },
  ];
  var OURS = BIZ.slice(0, 2);
  var MET = { gb: 'Gross Bookings', nr: 'Net Revenues', fvm: 'FVM' };
  var REG = [['TOT', 'Total'], ['Brasil', 'Brasil'], ['Mexico', 'México'], ['Hispa', 'Hispa'], ['Globales', 'Globales']];
  var HISPA = { Argentina: 1, Colombia: 1, Chile: 1, Peru: 1, Ecuador: 1 };
  var NWEEKS = 13;
  var state = { metric: 'nr', bud: null, budState: 'idle', b2bState: 'idle', ev: null, evState: 'idle' };

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
  function lastN(key, n) { var o = []; for (var i = n - 1; i >= 0; i--) o.push(prevKey(key, i)); return o; }
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
  function regionOf(pais) { return pais === 'Brasil' ? 'Brasil' : (pais === 'Mexico' ? 'Mexico' : (HISPA[pais] ? 'Hispa' : 'Globales')); }
  // Filas diarias → {region: {semana: {gb, nr, fvm, gbY, nrY, fvmY}}} (región 'TOT' = todo); shift = años a sumar (LY)
  function byWeek(rows, shift) {
    var o = {};
    function acc(reg, k, r, nrF) {
      var R = o[reg] = o[reg] || {}, x = R[k] = R[k] || { gb: 0, nr: 0, fvm: 0, gbY: 0, nrY: 0, fvmY: 0 };
      x.gb += +r.gross_bookings || 0; x.nr += +r[nrF] || 0; x.fvm += +r.fvm || 0;
      x.gbY += +W._yv_(r, 'gross_bookings') || 0; x.nrY += +W._yv_(r, nrF) || 0; x.fvmY += +W._yv_(r, 'fvm') || 0;
    }
    (rows || []).forEach(function (r) {
      if (!r || !r.fecha) return;
      var k = iso(String(r.fecha).substring(0, 10)) + (shift || 0) * 100, nrF = r.net_revenues != null ? 'net_revenues' : 'net_revenue';
      acc('TOT', k, r, nrF); acc(regionOf(r.pais), k, r, nrF);
    });
    return o;
  }
  function b2cBudWeeks() {
    var o = {}, b = state.bud;
    if (!b || !b.rows) return o;
    // COI Brasil = Excluir: el FVM del Budget sin COI / Financial Result de Brasil (b2c_budget_sync.py)
    var c = b.cols, ia = c.indexOf('anio'), iw = c.indexOf('semana'), ip = c.indexOf('pais'), ig = c.indexOf('gross_bookings'), inr = c.indexOf('net_revenues'),
      iv = (W._exCoiBr && c.indexOf('fvm_ex_coi_br') >= 0) ? c.indexOf('fvm_ex_coi_br') : c.indexOf('fvm');
    b.rows.forEach(function (r) {
      var k = r[ia] * 100 + r[iw];
      ['TOT', regionOf(r[ip])].forEach(function (reg) {
        var R = o[reg] = o[reg] || {}, x = R[k] = R[k] || { gb: 0, nr: 0, fvm: 0 };
        x.gb += r[ig]; x.nr += r[inr]; x.fvm += r[iv];
      });
    });
    return o;
  }
  // B2C con el switch COI Brasil: el JSON trae fvm_ex_coi_br (daily_sync.py desde 2026-10-27) y se pisa
  // fvm EN LAS FILAS de _b2cRows_ / _b2cLyRows_, igual que applyCoiBr_ con B2B2C / B2B (el total queda en
  // _fvmTot). Así lo sigue todo lo que lee esas filas: esta vista y el Benchmark clásico.
  function applyB2CCoi() {
    if (!W._rawB2BC || typeof W._b2cRows_ !== 'function') return;
    [W._b2cRows_(W._rawB2BC), W._b2cLyRows_(W._rawB2BC)].forEach(function (arr) {
      (arr || []).forEach(function (r) {
        if (r.fvm_ex_coi_br == null) return;
        if (r._fvmTot === undefined) r._fvmTot = r.fvm;
        r.fvm = W._exCoiBr ? r.fvm_ex_coi_br : r._fvmTot;
      });
    });
  }
  function b2cRows(rows) { return rows; }
  function orgT() { return (W._dlOrganic && W._fxTbl) ? 'budget' : ''; }
  function series() {
    applyB2CCoi();
    var t = orgT(), rb = W.b2bcRaw_() || W._rawB2BC, B = W._rawB2B;
    return {
      b2b2c: { cur: byWeek(W._orgRows_(rb.actuals || [], t)), ly: byWeek(rb.actuals_ly, 1), bud: byWeek(rb.budget) },
      b2b: B ? { cur: byWeek(W._orgRows_(B.b2b_gd || [], t)), ly: byWeek(B.b2b_gd_ly, 1), bud: byWeek(B.b2b_budget_gd) } : null,
      b2c: { cur: byWeek(W._orgRows_(b2cRows(W._b2cRows_(W._rawB2BC)), t)), ly: byWeek(b2cRows(W._b2cLyRows_(W._rawB2BC)), 1), bud: b2cBudWeeks() },
    };
  }
  function pct(a, b) { return isFinite(a) && isFinite(b) && b > 0 ? (a / b - 1) * 100 : NaN; }
  function get(s, reg, part, key) { return s && s[part] && s[part][reg] ? s[part][reg][key] : null; }
  // Una semana: valor, vs L4W, YoY y vs Budget
  function stats(s, key, mk, reg) {
    if (!s) return null;
    reg = reg || 'TOT';
    var c = get(s, reg, 'cur', key), v = c ? c[mk] : NaN, ly = get(s, reg, 'ly', key), bd = get(s, reg, 'bud', key), l4 = 0, n4 = 0;
    for (var i = 1; i <= 4; i++) { var p = get(s, reg, 'cur', prevKey(key, i)); if (p) { l4 += p[mk]; n4++; } }
    return { v: v, l4: pct(v, n4 ? l4 / n4 : NaN), yoy: pct(c ? c[mk + 'Y'] : NaN, ly ? ly[mk] : NaN), bud: pct(v, bd ? bd[mk] : NaN) };
  }
  // YoY de un conjunto de semanas (suma real a TC LY / suma LY)
  function yoyOf(s, keys, mk, reg) {
    if (!s) return NaN;
    var a = 0, b = 0, n = 0;
    keys.forEach(function (k) { var c = get(s, reg || 'TOT', 'cur', k), l = get(s, reg || 'TOT', 'ly', k); if (c && l) { a += c[mk + 'Y']; b += l[mk]; n++; } });
    return n === keys.length ? pct(a, b) : NaN;
  }
  // Momentum: YoY de las últimas 4 semanas (incluida la última) vs las 4 anteriores
  function momentum(S, key, mk, reg) {
    var now = lastN(key, 4), before = lastN(prevKey(key, 4), 4), o = {};
    BIZ.forEach(function (z) { var a = yoyOf(S[z.k], now, mk, reg), b = yoyOf(S[z.k], before, mk, reg); o[z.k] = { now: a, before: b, d: a - b }; });
    OURS.forEach(function (z) { o[z.k].gapNow = o[z.k].now - o.b2c.now; o[z.k].gapBefore = o[z.k].before - o.b2c.before; });
    return o;
  }

  // ── Eventos de industria (este año y la misma semana del año pasado) ────────────────────────
  var PAIS_CORTO = { Argentina: 'AR', Brasil: 'BR', Chile: 'CL', Colombia: 'CO', Mexico: 'MX', Peru: 'PE', Ecuador: 'EC', 'Other Countries': 'OT', USA: 'US' };
  function eventsByWeek() {
    var o = {}, ev = state.ev && state.ev.eventos;
    (ev || []).forEach(function (e) {
      if (e.lob !== 'b2b2c' && e.lob !== 'b2b') return;
      var a = new Date(e.inicio + 'T00:00:00Z'), b = new Date(e.fin + 'T00:00:00Z');
      for (var d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
        var k = iso(ymd(d)), lbl = e.familia + ' ' + (PAIS_CORTO[e.pais] || e.pais);
        [[k, ''], [k + 100, 'LY ']].forEach(function (x) {
          var L = o[x[0]] = o[x[0]] || [];
          if (L.indexOf(x[1] + lbl) < 0) L.push(x[1] + lbl);
        });
      }
    });
    return o;
  }

  // ── Formato ────────────────────────────────────────────────────────────────────────────────
  function money(v) { if (!isFinite(v)) return '—'; var a = Math.abs(v), s = v < 0 ? '−' : ''; return s + '$' + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : Math.round(a / 1e3) + 'K'); }
  function pc(v) { return isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(0) + '%' : '—'; }
  function pp(v) { return isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(0) + 'pp' : '—'; }
  function cl(v) { return !isFinite(v) ? '' : v >= 0 ? 'ow-up' : 'ow-dn'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ── Lecturas ───────────────────────────────────────────────────────────────────────────────
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
  // Diagnóstico de momentum en una frase: quién acelera / desacelera y si la brecha vs B2C se abre o se cierra
  var UMBRAL = 3;   // pp: menos que esto es "estable"
  // Cambio relativo del YoY (cuánto desacelera en proporción): de +64% a +28% = −56%. Solo con un YoY de
  // antes > 2%: con un antes chico o negativo el % no significa nada y queda solo el pp.
  function rel(m) { return isFinite(m.now) && isFinite(m.before) && m.before > 2 ? (m.now - m.before) / m.before * 100 : NaN; }
  function dTxt(m) { var r = rel(m); return '<span class="' + cl(m.d) + '">' + pp(m.d) + (isFinite(r) ? ' · ' + pc(r) : '') + '</span>'; }
  function verb(d) { return !isFinite(d) ? 'sin dato' : d <= -UMBRAL ? 'desacelera' : d >= UMBRAL ? 'acelera' : 'estable'; }
  function diagnosis(M, regLbl) {
    var parts = OURS.map(function (z) {
      var m = M[z.k]; if (!m || !isFinite(m.now)) return '';
      var g = m.gapNow - m.gapBefore;
      return '<b>' + z.lbl + '</b> ' + verb(m.d) + ' (' + pc(m.before) + ' → ' + pc(m.now) + ', ' + dTxt(m) + '); ' +
        'brecha vs B2C ' + pp(m.gapNow) + ' (antes ' + pp(m.gapBefore) + ': ' +
        (Math.abs(g) < UMBRAL ? 'se mantiene' : '<span class="' + cl(g) + '">' + (g > 0 ? 'le ganamos terreno' : 'perdemos terreno') + '</span>') + ')';
    }).filter(Boolean);
    var c = M.b2c;
    return (regLbl ? '<b>' + regLbl + '</b> · ' : '') + 'Últimas 4 semanas vs las 4 anteriores, YoY: ' + parts.join(' · ') +
      ' · <b>B2C</b> ' + verb(c.d) + ' (' + pc(c.before) + ' → ' + pc(c.now) + ', ' + dTxt(c) + ').';
  }

  // ── Piezas de la slide 1 ───────────────────────────────────────────────────────────────────
  function momentumCards(M) {
    return '<div class="ow-mom">' + BIZ.map(function (z) {
      var m = M[z.k], gap = z.ref ? '<div class="ow-mom-g">referencia</div>' :
        '<div class="ow-mom-g">brecha vs B2C <b class="' + cl(m.gapNow) + '">' + pp(m.gapNow) + '</b> <span>(antes ' + pp(m.gapBefore) + ')</span></div>';
      return '<div class="ow-mom-c" style="border-top-color:' + z.c + '"><div class="ow-mom-h"><i style="background:' + z.c + '"></i>' + z.lbl +
        ' <span>YoY 4 sem</span></div><div class="ow-mom-v">' + pc(m.now) + ' <span class="ow-mom-d">' + dTxt(m) + '</span></div>' +
        '<div class="ow-mom-s">antes ' + pc(m.before) + ' · ' + verb(m.d) + '</div>' + gap + '</div>';
    }).join('') + '</div>';
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
    body += OURS.map(function (z) {
      return '<tr class="ow-gap"><td class="ow-l">' + z.lbl + ' − B2C</td>' + mks.map(function (m) {
        var x = C[z.k] && C[z.k][m], r = C.b2c && C.b2c[m];
        if (!x || !r) return '<td colspan="4"></td>';
        return '<td></td><td class="' + cl(x.l4 - r.l4) + '">' + pp(x.l4 - r.l4) + '</td><td class="' + cl(x.yoy - r.yoy) + '">' + pp(x.yoy - r.yoy) + '</td><td class="' + cl(x.bud - r.bud) + '">' + pp(x.bud - r.bud) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<table class="ow-ceo-t"><thead>' + h1 + h2 + '</thead><tbody>' + body + '</tbody></table>';
  }
  // Gráfico de líneas por semana. lines = [{c, ref, pts, dots?, thin?}]; fmt = pc | pp. ev = {semana: [eventos]}
  function lineChart(title, keys, lines, fmt, ev, opt) {
    opt = opt || {};
    var Wc = opt.w || 400, Hc = opt.h || 230, x0 = 36, x1 = Wc - 40, y0 = ev ? 26 : 12, y1 = Hc - 22, all = [];
    lines.forEach(function (l) { all = all.concat(l.pts.filter(isFinite)); if (l.dots) all = all.concat(l.dots.filter(isFinite)); });
    if (!all.length) return '<div class="ow-ceo-c"><div class="ow-ceo-ct">' + title + '</div><p class="ow-na">sin datos</p></div>';
    var lo = Math.min(0, Math.min.apply(null, all)), hi = Math.max(0, Math.max.apply(null, all)), pad = (hi - lo) * 0.08 || 5;
    lo -= pad; hi += pad;
    function X(i) { return x0 + i * (x1 - x0) / (keys.length - 1); }
    function Y(v) { return y1 - (v - lo) / (hi - lo) * (y1 - y0); }
    var svg = '<svg viewBox="0 0 ' + Wc + ' ' + Hc + '" class="ow-ceo-svg">';
    // semanas con evento: franja y etiqueta (este año en violeta, LY en gris)
    // la etiqueta va solo si no pisa la anterior (el detalle completo queda en el tooltip de la franja)
    var lastLblX = -1e9, lblGap = 58;
    if (ev) keys.forEach(function (k, i) {
      var L = ev[k]; if (!L || !L.length) return;
      var cur = L.filter(function (s) { return s.indexOf('LY ') !== 0; }), txt = (cur.length ? cur : L)[0] + (L.length > 1 ? ' +' + (L.length - 1) : '');
      svg += '<rect x="' + (X(i) - 8).toFixed(1) + '" y="' + y0 + '" width="16" height="' + (y1 - y0) + '" fill="' + (cur.length ? '#efeaff' : '#f2f2f5') + '"><title>' + esc(L.join(' · ')) + '</title></rect>';
      if (X(i) - lastLblX < lblGap) return;
      lastLblX = X(i);
      svg += '<text x="' + X(i).toFixed(1) + '" y="' + (y0 - 4) + '" class="ow-ev' + (cur.length ? '' : ' ly') + '" text-anchor="middle">' + esc(txt.length > 13 ? txt.substring(0, 12) + '…' : txt) + '</text>';
    });
    [lo + pad, 0, hi - pad].filter(function (g) { return g === 0 || Math.abs(Y(g) - Y(0)) > 14; }).forEach(function (g) {
      svg += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + Y(g).toFixed(1) + '" y2="' + Y(g).toFixed(1) + '" stroke="' + (g === 0 ? '#b8b8c4' : '#eeeef3') + '"' + (g === 0 ? '' : ' stroke-dasharray="3 3"') + '/>' +
        '<text x="' + (x0 - 4) + '" y="' + (Y(g) + 3).toFixed(1) + '" class="ow-ax" text-anchor="end">' + fmt(g) + '</text>';
    });
    var every = Math.max(1, Math.ceil(keys.length * 34 / (x1 - x0)));   // ~34px por etiqueta de semana
    keys.forEach(function (k, i) { if ((keys.length - 1 - i) % every === 0) svg += '<text x="' + X(i).toFixed(1) + '" y="' + (Hc - 8) + '" class="ow-ax" text-anchor="middle">' + wkLbl(k) + '</text>'; });
    var lastY = [];
    lines.forEach(function (l) {
      if (l.dots) l.dots.forEach(function (v, i) { if (isFinite(v)) svg += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="2.2" fill="' + l.c + '" opacity=".35"/>'; });
      var p = l.pts.map(function (v, i) { return isFinite(v) ? X(i).toFixed(1) + ',' + Y(v).toFixed(1) : null; }).filter(Boolean);
      if (!p.length) return;
      svg += '<polyline fill="none" stroke="' + l.c + '" stroke-width="' + (l.ref ? 2 : 2.6) + '"' + (l.ref ? ' stroke-dasharray="5 4"' : '') + ' points="' + p.join(' ') + '"/>';
      var li = l.pts.length - 1; while (li >= 0 && !isFinite(l.pts[li])) li--;
      if (li >= 0) {
        var yy = Y(l.pts[li]);
        lastY.forEach(function (o) { if (Math.abs(o - yy) < 12) yy = o + (yy >= o ? 12 : -12); });
        lastY.push(yy);
        svg += '<text x="' + (X(li) + 5).toFixed(1) + '" y="' + (yy + 4).toFixed(1) + '" class="ow-lv" fill="' + l.c + '">' + fmt(l.pts[li]) + '</text>';
      }
    });
    svg += '</svg>';
    return '<div class="ow-ceo-c"><div class="ow-ceo-ct">' + title + '</div>' + svg + '</div>';
  }
  // Tendencia: YoY móvil de 4 semanas en cada semana
  function rolling(s, keys, mk, reg) { return keys.map(function (k) { return yoyOf(s, lastN(k, 4), mk, reg); }); }
  function weekly(s, keys, mk, reg) { return keys.map(function (k) { var x = stats(s, k, mk, reg); return x ? x.yoy : NaN; }); }

  // ── Slides ─────────────────────────────────────────────────────────────────────────────────
  function ready() { return W._rawB2BC && W._rawB2BC.meta; }
  function upTo() {
    var L = W._rawB2BC.meta.last_actuals_date;
    var v = (typeof W.flowVDate_ === 'function' && W._activeView === 'flow') ? W.flowVDate_() : L;
    return v < L ? v : L;
  }
  function notes(key) {
    var n = [];
    if (state.budState === 'error') n.push('No se pudo leer el Budget B2C semanal');
    if (!W._rawB2B) n.push('B2B cargando');
    var org = orgT() ? 'Organic: reales de los tres negocios a TC Budget; YoY a TC Actuals LY. ' : '';
    var coi = W._exCoiBr ? 'COI Brasil = Excluir: FVM sin COI / Financial Result de Brasil. ' : '';
    return 'Semana ISO (lun–dom) · ' + wkLbl(key) + ' = ' + wkRange(key) + ' · L4W = promedio de las 4 semanas anteriores · YoY vs la misma semana del año pasado · ' +
      'tendencia = YoY de las últimas 4 semanas · momentum: Δ pp y Δ % del YoY (de +64% a +28% = −36pp · −56%) · B2B en fecha de gestión · franjas = semanas con eventos de industria (B2B / B2B2C; LY = el año pasado). ' + org + coi + n.join(' · ');
  }
  function body1(S, key) {
    var mk = state.metric, keys = lastN(key, NWEEKS), M = momentum(S, key, mk), ev = eventsByWeek();
    var yoyLines = BIZ.map(function (z) { return { c: z.c, ref: z.ref, pts: rolling(S[z.k], keys, mk), dots: weekly(S[z.k], keys, mk) }; });
    var gapLines = OURS.map(function (z) {
      var a = rolling(S[z.k], keys, mk), b = rolling(S.b2c, keys, mk);
      return { c: z.c, pts: a.map(function (v, i) { return v - b[i]; }) };
    });
    var budLines = BIZ.map(function (z) { return { c: z.c, ref: z.ref, pts: keys.map(function (k) { var x = stats(S[z.k], k, mk); return x ? x.bud : NaN; }) }; });
    return '<div class="ow-ceo-hl">' + headline(S, key) + '<div class="ow-ceo-dx">' + diagnosis(M) + '</div></div>' +
      '<div class="ow-ceo-row">' + momentumCards(M) + table(S, key) + '</div>' +
      '<div class="ow-ceo-cs">' +
      lineChart(MET[mk] + ' · YoY (línea = tendencia 4 sem)', keys, yoyLines, pc, ev) +
      lineChart('Brecha de crecimiento vs B2C (pp, 4 sem)', keys, gapLines, pp, ev) +
      lineChart(MET[mk] + ' · % vs Budget por semana', keys, budLines, pc, ev) + '</div>' +
      '<div class="ow-ceo-leg">' + BIZ.map(function (z) { return '<span><i style="background:' + z.c + '"></i>' + z.lbl + (z.ref ? ' (referencia)' : '') + '</span>'; }).join('') +
      '<span class="ow-ceo-legn">puntos = semana · línea = tendencia</span></div>' +
      '<div class="ow-ceo-n">' + notes(key) + '</div>';
  }
  function body2(S, key) {
    var mk = state.metric, keys = lastN(key, NWEEKS), ev = eventsByWeek(), rows = '', worst = null;
    REG.forEach(function (rg) {
      var M = momentum(S, key, mk, rg[0]);
      function cellB(z) { var m = M[z.k], r = rel(m); return '<td class="ow-v">' + pc(m.now) + '</td><td>' + pc(m.before) + '</td><td class="' + cl(m.d) + '">' + pp(m.d) + '</td><td class="ow-rel ' + cl(r) + '">' + (isFinite(r) ? pc(r) : '—') + '</td>'; }
      function cellG(z) { var m = M[z.k], g = m.gapNow - m.gapBefore; return '<td class="ow-v ' + cl(m.gapNow) + '">' + pp(m.gapNow) + '</td><td class="' + cl(g) + '">' + pp(g) + '</td>'; }
      rows += '<tr class="' + (rg[0] === 'TOT' ? 'ow-tot' : '') + '"><td class="ow-l">' + rg[1] + '</td>' + BIZ.map(cellB).join('') + OURS.map(cellG).join('') + '</tr>';
      if (rg[0] !== 'TOT') OURS.forEach(function (z) { var g = M[z.k].gapNow - M[z.k].gapBefore; if (isFinite(g) && (!worst || g < worst.g)) worst = { g: g, z: z, rg: rg, m: M[z.k] }; });
    });
    var th = '<tr><th rowspan="2" class="ow-l">YoY ' + MET[mk] + '</th>' + BIZ.map(function (z) { return '<th colspan="4">' + z.lbl + '</th>'; }).join('') +
      OURS.map(function (z) { return '<th colspan="2" class="ow-sel">Brecha ' + z.lbl + ' vs B2C</th>'; }).join('') + '</tr><tr>' +
      BIZ.map(function () { return '<th>4 sem</th><th>antes</th><th>Δ pp</th><th>Δ %</th>'; }).join('') + OURS.map(function () { return '<th>ahora</th><th>Δ</th>'; }).join('') + '</tr>';
    var tot = momentum(S, key, mk);
    var dx = diagnosis(tot) + (worst && worst.g <= -UMBRAL ? ' Donde más terreno perdemos vs B2C: <b>' + worst.z.lbl + ' ' + worst.rg[1] + '</b> (brecha ' + pp(worst.m.gapBefore) + ' → ' + pp(worst.m.gapNow) + ').' : '');
    var small = REG.slice(1).map(function (rg) {
      return lineChart(rg[1] + ' · YoY tendencia 4 sem', keys, BIZ.map(function (z) { return { c: z.c, ref: z.ref, pts: rolling(S[z.k], keys, mk, rg[0]) }; }), pc, null, { w: 300, h: 190 });
    }).join('');
    return '<div class="ow-ceo-hl"><div class="ow-ceo-dx" style="margin:0">' + dx + '</div></div>' +
      '<table class="ow-ceo-t ow-reg"><thead>' + th + '</thead><tbody>' + rows + '</tbody></table>' +
      '<div class="ow-ceo-cs4">' + small + '</div>' +
      '<div class="ow-ceo-leg">' + BIZ.map(function (z) { return '<span><i style="background:' + z.c + '"></i>' + z.lbl + (z.ref ? ' (referencia)' : '') + '</span>'; }).join('') + '</div>' +
      '<div class="ow-ceo-n">4 sem = YoY de las últimas 4 semanas (' + wkLbl(prevKey(key, 3)) + '–' + wkLbl(key) + ') · antes = las 4 anteriores (' + wkLbl(prevKey(key, 7)) + '–' + wkLbl(prevKey(key, 4)) +
      ') · Δ pp = diferencia de YoY; Δ % = cuánto cambia el YoY en proporción (de +64% a +28% = −56%; sin dato si antes era ≤2%) · Brecha = YoY del negocio − YoY de B2C en la misma región · Regiones como el Weekly (Hispa = AR, CO, CL, PE, EC; Globales = el resto). ' + notes(key).split(' · tendencia')[0] + '</div>';
  }

  // ── Drivers del momentum: aporte en pp de cada partner (B2B2C) o canal (B2B) ────────────────
  // ΔYoY = YoY(4 sem) − YoY(4 anteriores), y YoY = Σ(real a TC LY − LY) / Σ LY. El aporte de cada
  // partner / canal d es (real_d − LY_d) / LY_total en las 4 semanas menos lo mismo en las 4 anteriores:
  // los aportes suman exactamente el ΔYoY del negocio (en la región).
  function dimSums(rows, shift, dimFn, nowSet, befSet) {
    var o = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.fecha) return;
      var k = iso(String(r.fecha).substring(0, 10)) + (shift || 0) * 100, per = nowSet[k] ? 'n' : (befSet[k] ? 'b' : null);
      if (!per) return;
      var nrF = r.net_revenues != null ? 'net_revenues' : 'net_revenue', dm = dimFn(r);
      ['TOT', regionOf(r.pais)].forEach(function (reg) {
        var R = o[reg] = o[reg] || {}, D = R[dm.k] = R[dm.k] || { lbl: dm.lbl, n: { gb: 0, nr: 0, fvm: 0, gbY: 0, nrY: 0, fvmY: 0 }, b: { gb: 0, nr: 0, fvm: 0, gbY: 0, nrY: 0, fvmY: 0 } };
        var x = D[per];
        x.gb += +r.gross_bookings || 0; x.nr += +r[nrF] || 0; x.fvm += +r.fvm || 0;
        x.gbY += +W._yv_(r, 'gross_bookings') || 0; x.nrY += +W._yv_(r, nrF) || 0; x.fvmY += +W._yv_(r, 'fvm') || 0;
      });
    });
    return o;
  }
  function drivers(cur, ly, reg, mk) {
    var C = cur[reg] || {}, L = ly[reg] || {}, keys = {}, LTn = 0, LTb = 0;
    Object.keys(C).concat(Object.keys(L)).forEach(function (k) { keys[k] = 1; });
    Object.keys(L).forEach(function (k) { LTn += L[k].n[mk]; LTb += L[k].b[mk]; });
    var list = Object.keys(keys).map(function (k) {
      var c = C[k], l = L[k], cn = c ? c.n[mk + 'Y'] : 0, cb = c ? c.b[mk + 'Y'] : 0, ln = l ? l.n[mk] : 0, lb = l ? l.b[mk] : 0;
      return { lbl: (c || l).lbl, c: (LTn ? (cn - ln) / LTn * 100 : 0) - (LTb ? (cb - lb) / LTb * 100 : 0), yNow: pct(cn, ln), yBef: pct(cb, lb), cn: c ? c.n[mk] : 0, ln: ln, lb: lb };
    });
    return list;
  }
  function partnerDim(r) {
    var p = String(r.partner || 'Sin asignar').trim(), pa = r.pais || 'Other';
    return { k: p.toLowerCase() + '|' + pa, lbl: p + ' (' + (PAIS_CORTO[pa] || pa.substring(0, 2).toUpperCase()) + ')' };
  }
  function channelDim(r) { var api = r.parent_channel === 'API'; return { k: api ? 'API' : 'HTML', lbl: api ? 'API' : 'HTML' }; }
  function periodSets(key) {
    var n = {}, b = {};
    lastN(key, 4).forEach(function (k) { n[k] = 1; });
    lastN(prevKey(key, 4), 4).forEach(function (k) { b[k] = 1; });
    return { n: n, b: b };
  }
  function yTxt(x) {
    if (!(x.ln > 0) && !(x.lb > 0)) return 'nuevo (sin LY)';
    // con un LY muy chico el YoY del partner da miles de %: se muestra acotado
    function y(v) { return !isFinite(v) ? '—' : v > 999 ? '>+999%' : pc(v); }
    return y(x.yBef) + ' → ' + y(x.yNow);
  }
  function pp1(v) { return isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + 'pp' : '—'; }

  // Slide 3: B2B2C — triunfadores y detractores por región
  function body3(S, key) {
    var mk = state.metric, P = periodSets(key), rb = W.b2bcRaw_() || W._rawB2BC, t = orgT();
    var cur = dimSums(W._orgRows_(rb.actuals || [], t), 0, partnerDim, P.n, P.b), ly = dimSums(rb.actuals_ly, 1, partnerDim, P.n, P.b);
    var all = drivers(cur, ly, 'TOT', mk).sort(function (a, b) { return a.c - b.c; });
    var Mt = momentum(S, key, mk).b2b2c;
    function item(x) {
      return '<div class="ow-drv-i"><span class="ow-drv-n" title="' + esc(x.lbl) + '">' + esc(x.lbl.length > 26 ? x.lbl.substring(0, 25) + '…' : x.lbl) + '</span>' +
        '<b class="' + cl(x.c) + '">' + pp1(x.c) + '</b><span class="ow-drv-y">' + yTxt(x) + '</span></div>';
    }
    var cols = REG.slice(1).map(function (rg) {
      var L = drivers(cur, ly, rg[0], mk), M = momentum(S, key, mk, rg[0]).b2b2c;
      var neg = L.filter(function (x) { return x.c <= -0.05; }).sort(function (a, b) { return a.c - b.c; }).slice(0, 5);
      var pos = L.filter(function (x) { return x.c >= 0.05; }).sort(function (a, b) { return b.c - a.c; }).slice(0, 5);
      return '<div class="ow-drv-col"><div class="ow-drv-h">' + rg[1] + ' <span class="' + cl(M.d) + '">' + dTxt(M) + '</span><small>' + pc(M.before) + ' → ' + pc(M.now) + '</small></div>' +
        '<div class="ow-drv-st ow-dn">▼ Detractores</div>' + (neg.length ? neg.map(item).join('') : '<div class="ow-na">—</div>') +
        '<div class="ow-drv-st ow-up">▲ Triunfadores</div>' + (pos.length ? pos.map(item).join('') : '<div class="ow-na">—</div>') + '</div>';
    }).join('');
    var top = function (L) { return L.map(function (x) { return '<b>' + esc(x.lbl) + '</b> ' + pp1(x.c); }).join(', '); };
    var dx = '<b>B2B2C</b> ' + verb(Mt.d) + ' (' + pc(Mt.before) + ' → ' + pc(Mt.now) + ', ' + dTxt(Mt) + '). Más le restan: ' + top(all.slice(0, 3)) +
      '. Más le suman: ' + top(all.slice().reverse().slice(0, 3).filter(function (x) { return x.c > 0; })) + '.';
    return '<div class="ow-ceo-hl"><div class="ow-ceo-dx" style="margin:0">' + dx + '</div></div><div class="ow-drv">' + cols + '</div>' +
      '<div class="ow-ceo-n">Aporte de cada partner al cambio del YoY de ' + MET[mk] + ' de B2B2C en su región (pp), últimas 4 semanas (' + wkLbl(prevKey(key, 3)) + '–' + wkLbl(key) + ') vs las 4 anteriores (' +
        wkLbl(prevKey(key, 7)) + '–' + wkLbl(prevKey(key, 4)) + '): (real − LY) del partner sobre el LY total de la región, ahora menos antes; los aportes suman el Δ de la región. ' +
        'Al lado, el YoY del propio partner antes → ahora. Respeta Partner TBD, Organic y COI Brasil. ' + notes(key).split(' · L4W')[0] + '</div>';
  }

  // Slide 4: B2B — API vs HTML
  function body4(S, key) {
    var mk = state.metric, P = periodSets(key), B = W._rawB2B, t = orgT();
    if (!B) return '<p class="ow-na">B2B cargando…</p>';
    var cur = dimSums(W._orgRows_(B.b2b_gd || [], t), 0, channelDim, P.n, P.b), ly = dimSums(B.b2b_gd_ly, 1, channelDim, P.n, P.b);
    var CH = [{ k: 'API', lbl: 'API (MAY)', c: '#0b6e8f' }, { k: 'HTML', lbl: 'HTML · Agencias (MIN)', c: '#38bdf8' }];
    var rows = REG.map(function (rg) {
      var M = momentum(S, key, mk, rg[0]).b2b, L = drivers(cur, ly, rg[0], mk), by = {};
      L.forEach(function (x) { by[x.lbl] = x; });
      var nowTot = CH.reduce(function (a, c) { return a + (by[c.k] ? by[c.k].cn : 0); }, 0);
      return '<tr class="' + (rg[0] === 'TOT' ? 'ow-tot' : '') + '"><td class="ow-l">' + rg[1] + '</td><td class="ow-v">' + pc(M.before) + ' → ' + pc(M.now) + '</td><td class="' + cl(M.d) + '">' + dTxt(M) + '</td>' +
        CH.map(function (c) {
          var x = by[c.k];
          if (!x) return '<td>—</td><td>—</td><td>—</td>';
          return '<td>' + (nowTot ? Math.round(x.cn / nowTot * 100) + '%' : '—') + '</td><td>' + yTxt(x) + '</td><td class="ow-v ' + cl(x.c) + '">' + pp1(x.c) + '</td>';
        }).join('') + '</tr>';
    }).join('');
    var th = '<tr><th rowspan="2" class="ow-l">' + MET[mk] + '</th><th colspan="2">B2B (YoY)</th>' + CH.map(function (c) { return '<th colspan="3">' + c.lbl + '</th>'; }).join('') + '</tr>' +
      '<tr><th>antes → ahora</th><th>Δ</th>' + CH.map(function () { return '<th>peso</th><th>YoY antes → ahora</th><th>aporte al Δ</th>'; }).join('') + '</tr>';
    // Tendencia 4 sem: YoY de cada canal y su aporte al YoY de B2B (suman el YoY de B2B)
    var keys = lastN(key, NWEEKS);
    var chS = {};
    CH.forEach(function (c) {
      var f = function (r) { return (r.parent_channel === 'API') === (c.k === 'API'); };
      chS[c.k] = { cur: byWeek(W._orgRows_((B.b2b_gd || []).filter(f), t)), ly: byWeek((B.b2b_gd_ly || []).filter(f), 1) };
    });
    function sumW(s, part, ks, f) { return ks.reduce(function (a, k) { var x = get(s, 'TOT', part, k); return a + (x ? x[f] : 0); }, 0); }
    var yoyL = CH.map(function (c) { return { c: c.c, pts: rolling(chS[c.k], keys, mk) }; }).concat([{ c: '#8e8e93', ref: true, pts: rolling(S.b2c, keys, mk) }]);
    var conL = CH.map(function (c) {
      return { c: c.c, pts: keys.map(function (k) {
        var ks = lastN(k, 4), lyT = sumW(S.b2b, 'ly', ks, mk);
        return lyT ? (sumW(chS[c.k], 'cur', ks, mk + 'Y') - sumW(chS[c.k], 'ly', ks, mk)) / lyT * 100 : NaN;
      }) };
    });
    var tot = drivers(cur, ly, 'TOT', mk), byT = {}; tot.forEach(function (x) { byT[x.lbl] = x; });
    var Mb = momentum(S, key, mk).b2b;
    var dx = '<b>B2B</b> ' + verb(Mb.d) + ' (' + pc(Mb.before) + ' → ' + pc(Mb.now) + ', ' + dTxt(Mb) + '): ' +
      CH.map(function (c) { var x = byT[c.k]; return x ? '<b>' + c.lbl + '</b> aporta <span class="' + cl(x.c) + '">' + pp1(x.c) + '</span> (su YoY ' + yTxt(x) + ')' : ''; }).filter(Boolean).join(' · ') + '.';
    return '<div class="ow-ceo-hl"><div class="ow-ceo-dx" style="margin:0">' + dx + '</div></div>' +
      '<table class="ow-ceo-t ow-reg"><thead>' + th + '</thead><tbody>' + rows + '</tbody></table>' +
      '<div class="ow-ceo-cs" style="grid-template-columns:1fr 1fr">' +
      lineChart(MET[mk] + ' · YoY por canal (tendencia 4 sem)', keys, yoyL, pc, eventsByWeek(), { w: 560, h: 220 }) +
      lineChart('Aporte de cada canal al YoY de B2B (pp, 4 sem)', keys, conL, pp, eventsByWeek(), { w: 560, h: 220 }) + '</div>' +
      '<div class="ow-ceo-leg">' + CH.map(function (c) { return '<span><i style="background:' + c.c + '"></i>' + c.lbl + '</span>'; }).join('') + '<span><i style="background:#8e8e93"></i>B2C (referencia)</span></div>' +
      '<div class="ow-ceo-n">B2B en fecha de gestión · API = canal API (B2B-MAY); HTML = Agencias afiliadas (B2B-MIN) · peso = participación en ' + MET[mk] + ' de las últimas 4 semanas · aporte al Δ = (real − LY) del canal sobre el LY total de B2B, ' +
        'últimas 4 semanas menos las 4 anteriores (los dos aportes suman el Δ de B2B). ' + notes(key).split(' · L4W')[0] + '</div>';
  }
  function titleOf(n) {
    var key = ready() ? lastWeek(upTo()) : null, w = key ? ' · ' + MET[state.metric] + ' · ' + wkLbl(key) : '';
    if (n === 2) return 'Momentum por región vs B2C' + w;
    if (n === 3) return 'B2B2C · quién explica el momentum (partners)' + w;
    if (n === 4) return 'B2B · API vs HTML en el momentum' + w;
    return 'Weekly Performance vs B2C' + (key ? ' · ' + wkLbl(key) + ' (' + wkRange(key) + ')' : '');
  }
  function bodyHtml(n, S) {
    if (!ready()) return '<p class="ow-na">Cargando datos del Daily…</p>';
    S = S || series();
    var key = lastWeek(upTo());
    return n === 2 ? body2(S, key) : n === 3 ? body3(S, key) : n === 4 ? body4(S, key) : body1(S, key);
  }
  function slideHtml(n, S) {
    var t = titleOf(n), head = typeof W.flHead_ === 'function' ? W.flHead_(t) : '<div class="fl-head"><div class="fl-title">' + t + '</div></div>';
    return '<div class="flow-slide ow-ceo-slide" data-ceo="' + n + '">' + head + '<div class="ow-ceo-body">' + bodyHtml(n, S) + '</div></div>';
  }

  // ── Carga (Budget B2C, eventos y B2B) ──────────────────────────────────────────────────────
  function refreshAll() {
    if (!ready()) return;
    var S = null;
    function ser() { return S || (S = series()); }
    var b = document.getElementById('ow-ceo-bench');
    if (b && W._activeView === 'benchmark') {
      [1, 2, 3, 4].forEach(function (n) { var h = document.getElementById('ow-ceo-bench-s' + n); if (h) h.innerHTML = slideHtml(n, ser()); });
      fitBench();
    }
    Array.prototype.forEach.call(document.querySelectorAll('#flow-track .ow-ceo-slide'), function (sl) {
      var n = +sl.getAttribute('data-ceo'), nb = sl.querySelector('.ow-ceo-body'); if (nb) nb.innerHTML = bodyHtml(n, ser());
      var tt = sl.querySelector('.fl-title'); if (tt) tt.textContent = titleOf(n);
    });
  }
  function ensureData() {
    var run = W.google && W.google.script && W.google.script.run;
    if (!run) return;
    if (state.budState === 'idle') {
      state.budState = 'loading';
      W.google.script.run.withSuccessHandler(function (r) { state.bud = r; state.budState = 'ok'; refreshAll(); })
        .withFailureHandler(function () { state.budState = 'error'; refreshAll(); }).getB2CBudgetWeekly();
    }
    if (state.evState === 'idle' && typeof W.google.script.run.getIndustryEvents === 'function') {
      state.evState = 'loading';
      W.google.script.run.withSuccessHandler(function (r) { state.ev = r; state.evState = 'ok'; refreshAll(); })
        .withFailureHandler(function () { state.evState = 'error'; }).getIndustryEvents();
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
    [1, 2, 3, 4].forEach(function (n) {
      var wrap = document.getElementById('ow-ceo-bench-w' + n), sl = document.querySelector('#ow-ceo-bench-s' + n + ' .flow-slide');
      if (!wrap || !sl) return;
      var s = Math.min(1, wrap.clientWidth / 1280);
      sl.style.transform = 'scale(' + s + ')'; sl.style.transformOrigin = '0 0';
      wrap.style.height = Math.round(720 * s) + 'px';
    });
  }
  function ensureBench() {
    var host = document.querySelector('#view-benchmark .content');
    if (!host || document.getElementById('ow-ceo-bench')) return;
    var box = document.createElement('div');
    box.id = 'ow-ceo-bench';
    box.innerHTML = '<div class="ow-ceo-bar"><div class="section-hdr" style="margin:0">Weekly · vs B2C <span style="font-weight:400;text-transform:none;letter-spacing:0">(vista para CEO / Chief / VP · también en el Flow Semanal)</span></div>' +
      '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
      // COI Brasil: el mismo switch global del Daily (setExCoiBr sincroniza todos los [data-coibr] y
      // rearma el Benchmark entero, esta sección incluida)
      '<div class="dm-group" title="COI Brasil: Excluir saca el cost of installments y el efecto financiero de Brasil del FVM en toda la página (también en el Daily, Weekly y Flow).">' +
      '<span class="dm-group-lbl">COI Brasil</span><div class="dm-toggle">' +
      '<button class="dm-btn' + (W._exCoiBr ? '' : ' active') + '" data-coibr="incl" onclick="setExCoiBr(false)">Incluir</button>' +
      '<button class="dm-btn' + (W._exCoiBr ? ' active' : '') + '" data-coibr="excl" onclick="setExCoiBr(true)">Excluir</button></div></div>' +
      '<div class="tab-toggle">' + Object.keys(MET).map(function (m) { return '<button class="ttab" data-owm="' + m + '">' + (m === 'fvm' ? 'FVM' : m.toUpperCase()) + '</button>'; }).join('') + '</div></div></div>' +
      '<div id="ow-ceo-bench-w1" class="ow-ceo-wrap"><div id="ow-ceo-bench-s1"></div></div>' +
      '<div id="ow-ceo-bench-w2" class="ow-ceo-wrap"><div id="ow-ceo-bench-s2"></div></div>' +
      '<div id="ow-ceo-bench-w3" class="ow-ceo-wrap"><div id="ow-ceo-bench-s3"></div></div>' +
      '<div id="ow-ceo-bench-w4" class="ow-ceo-wrap"><div id="ow-ceo-bench-s4"></div></div>';
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
    '#ow-ceo-bench .ow-ceo-wrap{position:relative;overflow:hidden;border-radius:8px;margin-bottom:14px}',
    '#ow-ceo-bench .ow-ceo-wrap .flow-slide{position:absolute;left:0;top:0}',
    // fuera del Flow no están sus variables (título, logo): las mismas de #view-flow
    '#ow-ceo-bench{--fl-purple:#5626e9;--fl-purple2:#8e5ff3;--fl-green:#15803d;--fl-red:#dc2626;--fl-amber:#b45309;--fl-ink:#1a1a2e;--fl-ink2:#4a4a63;--fl-ink3:#6b6b85;--fl-gray:#c9c9d6;--fl-line:#e6e6ee}',
    '.ow-ceo-slide .ow-ceo-body{padding:8px 40px 0;height:calc(720px - 96px);display:flex;flex-direction:column;gap:7px;font-family:Poppins,sans-serif;color:#1d1d1f}',
    '.ow-ceo-hl{font-size:13px;line-height:1.4;background:#f6f4fe;border-left:4px solid #550fed;border-radius:6px;padding:6px 12px}',
    '.ow-ceo-dx{font-size:12.5px;color:#3a3a46;margin-top:3px}',
    '.ow-ceo-slide .ow-up{color:#1a9e5a}.ow-ceo-slide .ow-dn{color:#d4373a}',
    '.ow-ceo-row{display:grid;grid-template-columns:330px 1fr;gap:14px;align-items:start}',
    '.ow-mom{display:flex;flex-direction:column;gap:5px}',
    '.ow-mom-c{border:1px solid #ebe8f7;border-top:3px solid;border-radius:8px;padding:4px 10px;background:#fcfbff;display:grid;grid-template-columns:1fr auto;column-gap:8px;align-items:center}',
    '.ow-mom-h{font-size:12px;font-weight:700;grid-column:1/3}.ow-mom-h i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}.ow-mom-h span{font-weight:400;color:#8e8e93;margin-left:4px}',
    '.ow-mom-v{font-size:20px;font-weight:800;line-height:1.15}.ow-mom-d{font-size:12.5px;font-weight:700;margin-left:4px}',
    '.ow-ceo-t td.ow-rel{font-size:11.5px}',
    '.ow-mom-s{font-size:11px;color:#6e6e73;text-align:right}.ow-mom-g{font-size:11.5px;grid-column:1/3;color:#4a4a63}.ow-mom-g span{color:#8e8e93}',
    '.ow-ceo-t{width:100%;border-collapse:collapse;font-size:12px}',
    '.ow-ceo-t th{background:#550fed;color:#fff;font-weight:600;padding:3px 5px;text-align:right;border-left:1px solid #fff}',
    '.ow-ceo-t thead tr:first-child th{text-align:center;font-size:12.5px}.ow-ceo-t th.ow-sel{background:#3d00b8}',
    '.ow-ceo-t td{padding:4px 5px;text-align:right;border-bottom:1px solid #eeecf6;white-space:nowrap}',
    '.ow-ceo-t .ow-l{text-align:left;font-weight:700;min-width:96px}.ow-ceo-t .ow-l i,.ow-ceo-leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}',
    '.ow-ceo-t .ow-l small{font-weight:400;color:#8e8e93}.ow-ceo-t td.ow-v{font-weight:700}',
    '.ow-ceo-t tr.ow-ref td{background:#f7f7f9;color:#55555c}',
    '.ow-ceo-t tr.ow-gap td{font-size:11.5px;background:#fbfaff}.ow-ceo-t tr.ow-gap td.ow-l{font-weight:600;color:#4300d2}',
    '.ow-ceo-t.ow-reg{font-size:13px}.ow-ceo-t.ow-reg td{padding:6px 7px}.ow-ceo-t tr.ow-tot td{background:#f6f4fe;font-weight:700;border-bottom:2px solid #550fed}',
    '.ow-ceo-cs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;flex:1;min-height:0}',
    '.ow-ceo-cs4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;flex:1;min-height:0}',
    '.ow-ceo-ct{font-size:12.5px;font-weight:700;color:#4300d2;text-align:center}',
    '.ow-ceo-svg{width:100%;height:auto;display:block}.ow-ceo-svg .ow-ax{font-size:10px;fill:#8e8e93}.ow-ceo-svg .ow-lv{font-size:11px;font-weight:700}',
    '.ow-ceo-svg .ow-ev{font-size:8.5px;fill:#5626e9;font-weight:600}.ow-ceo-svg .ow-ev.ly{fill:#8e8e93;font-weight:400}',
    '.ow-ceo-leg{display:flex;gap:16px;justify-content:center;font-size:11px;color:#55555c}.ow-ceo-legn{font-style:italic;color:#8e8e93}',
    '.ow-ceo-n{font-size:10px;color:#8e8e93;line-height:1.3}',
    '.ow-ceo-slide .ow-na{color:#8e8e93;font-size:13px;text-align:center}',
    '.ow-drv{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;flex:1;min-height:0}',
    '.ow-drv-col{border:1px solid #ebe8f7;border-radius:8px;padding:8px 10px;background:#fcfbff;overflow:hidden}',
    '.ow-drv-h{font-size:15px;font-weight:800;color:#1d1d1f;border-bottom:2px solid #550fed;padding-bottom:4px;margin-bottom:4px}',
    '.ow-drv-h span{font-size:12.5px;font-weight:700;margin-left:4px}.ow-drv-h small{display:block;font-size:11px;font-weight:400;color:#6e6e73}',
    '.ow-drv-st{font-size:11.5px;font-weight:700;margin:6px 0 2px}',
    '.ow-drv-i{display:grid;grid-template-columns:1fr auto;column-gap:6px;font-size:12px;padding:2px 0;border-bottom:1px dashed #ece9f6}',
    '.ow-drv-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ow-drv-i b{text-align:right}',
    '.ow-drv-y{grid-column:1/3;font-size:10.5px;color:#8e8e93}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  document.addEventListener('DOMContentLoaded', function () {
    // Benchmark: la sección va arriba y se rearma con cada render del Benchmark (switches incluidos)
    var origBench = W.renderBenchmark_;
    if (typeof origBench === 'function') {
      W.renderBenchmark_ = function () {
        try { applyB2CCoi(); } catch (e) { /* sin B2C */ }
        var r = origBench.apply(this, arguments);
        try { ensureBench(); ensureData(); refreshAll(); } catch (e) { console.warn('[daily-ceo-weekly] benchmark:', e); }
        return r;
      };
    }
    // Flow: las dos slides después del separador "Weekly Summary"
    if (Array.isArray(W.FLOW_DECK) && !W.FLOW_DECK.some(function (d) { return d.kind === 'ceo_weekly'; })) {
      var at = W.FLOW_DECK.findIndex(function (d) { return d.kind === 'divider' && d.flag === 'WK'; });
      W.FLOW_DECK.splice(at < 0 ? W.FLOW_DECK.length : at + 1, 0,
        { kind: 'ceo_weekly', n: 1, name: 'Weekly — vs B2C (CEO)' }, { kind: 'ceo_weekly', n: 2, name: 'Weekly — momentum por región vs B2C' },
        { kind: 'ceo_weekly', n: 3, name: 'Weekly — B2B2C: partners del momentum' }, { kind: 'ceo_weekly', n: 4, name: 'Weekly — B2B: API vs HTML' });
    }
    // El switch global: primero B2C (las filas) y después el recálculo del Daily
    var origCoi = W.setExCoiBr;
    if (typeof origCoi === 'function') W.setExCoiBr = function (on) { W._exCoiBr = !!on; try { applyB2CCoi(); } catch (e) { /* sin B2C */ } return origCoi.apply(this, arguments); };
    var origSlide = W.flowBuildSlide_;
    if (typeof origSlide === 'function') {
      W.flowBuildSlide_ = function (def, idx) {
        if (def && def.kind === 'ceo_weekly') { W._flowSeries[idx] = []; try { ensureData(); return slideHtml(def.n || 1); } catch (e) { return '<div class="flow-slide"><p>' + esc(e.message) + '</p></div>'; } }
        return origSlide.apply(this, arguments);
      };
    }
  });
  W.OwniaCeoWeekly = { slideHtml: slideHtml, refresh: refreshAll };
})();
