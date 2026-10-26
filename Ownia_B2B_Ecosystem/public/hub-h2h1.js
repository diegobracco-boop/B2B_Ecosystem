/* Vista "H2 Budget vs H1" del P&L Dashboard (Hub) en Ownia (2026-10-26, para dirección). La inyecta
 * server/index.js en el Hub (`layout` en server/modules.js); se abre desde la pestaña "H2 vs H1"
 * (botón #nav-h2h1 de Dashboard_B2B_WLs/dashboard.html, clasificado en PRIMARY de hub-layout.js).
 *
 * Pregunta que contesta (una pantalla, para contarle al CEO): ¿qué challenge asumía el Budget entre un
 * semestre y otro? Para Net Revenue y Operating Contribution, Total / B2B2C / B2B MIN / B2B MAY:
 *  - cuánto crece el H2 Budget sobre el H1 real (H2/H1 Budget), contra
 *  - cuánto creció el H2 sobre el H1 el año pasado (H2/H1 FY anterior = la estacionalidad normal).
 * La diferencia en puntos es el esfuerzo extra que asume el Budget (= la aceleración del YoY del H2
 * contra el del H1), y se parte en dos causas: lo que planeó el Budget (H2 vs H1 dentro del Budget
 * contra el año pasado) y el efecto H1 (cómo salió el H1 real contra su Budget).
 * Pantalla pensada para el CEO: por negocio, "crece X%, un H2 normal crece Y%", un veredicto en palabras
 * (muy exigente / exigente / normal / holgado) y el porqué en una frase. El detalle para Planning
 * (Planeado, plan / efecto H1, gráfico) queda plegado en "Ver detalle".
 *
 * Datos: getAllData del Hub (los mismos números que el resto del dashboard), dos llamadas — H1 y H2 —
 * con LoB Consolidado, que trae los grupos WL's (= B2B2C), MAY, MIN y Total. Respeta el switch Organic
 * del Hub: con YES el H1 real va a TC Budget (comparable con el H2 Budget); el año pasado, a sus TC reales.
 */
(function () {
  'use strict';

  var UP = '#1a9e5a', DOWN = '#d4373a', BAR = '#550fed', LYC = '#1d1d1f';
  var SEGS = [['total', 'Total B2B + B2B2C'], ['b2b2c', 'B2B2C'], ['min', 'B2B MIN'], ['may', 'B2B MAY']];
  var METRICS = [['nr', 'Net Revenue'], ['oc', 'Operating Contribution']];
  // OC del año pasado ajustado como en la presentación de dirección: el FY26 incluye un pago
  // extraordinario LATAM de USD 5.6M (jun-25, B2B2C) que deprime el OC del H1 FY26 y, con él, infla la
  // estacionalidad H2/H1 del año pasado. Se suma al LY del H1 (B2B2C y Total) solo para esa
  // estacionalidad; los montos no cambian. Solo FY27: sacarlo cuando no aplique.
  var LY_ADJ_FY = 2027, LY_ADJ_OC_B2B2C_H1 = 5.6e6;
  var cache = {};       // clave de params → result de getAllData
  var panel = null;

  function fy() { return typeof window.fyEndYear_ === 'function' ? window.fyEndYear_() : 2027; }
  function halves() {
    var y = fy();
    return { h1: [(y - 1) + '-04', (y - 1) + '-09'], h2: [(y - 1) + '-10', y + '-03'] };
  }
  function organicOn() { var st = window._state; return !!(st && st.organic); }

  function params(range) {
    return { lob: 'all', pais: 'all', producto: 'all', canal: 'all', desde: range[0], hasta: range[1],
      baselineSource: 'baseline', fcSource: '', organic: organicOn() ? 'budget' : '' };
  }

  function fetchData(range) {
    var p = params(range), key = JSON.stringify(p);
    if (cache[key]) return Promise.resolve(cache[key]);
    return new Promise(function (resolve, reject) {
      window.google.script.run
        .withSuccessHandler(function (r) { cache[key] = r; resolve(r); })
        .withFailureHandler(reject)
        .getAllData(p);
    });
  }

  // {nr|oc: {total|b2b2c|min|may: {act, bud, ly}}} desde result.pnl (grupos Total / WL's / MIN / MAY)
  function pick(result) {
    var pnl = result && result.pnl, out = {};
    if (!pnl || !pnl.rows) return out;
    var g = pnl.groups || [];
    var idx = { total: g.indexOf('Total'), b2b2c: g.indexOf("WL's"), min: g.indexOf('MIN'), may: g.indexOf('MAY') };
    pnl.rows.forEach(function (r) {
      if (r.id !== 'gb' && !METRICS.some(function (m) { return m[0] === r.id; })) return;
      out[r.id] = {};
      SEGS.forEach(function (s) {
        var c = r.cols[idx[s[0]]] || {};
        out[r.id][s[0]] = { act: c.actual || 0, bud: c.budget || 0, ly: c.lyVal || 0, yoy: isFinite(c.yoyPct) ? c.yoyPct : NaN };
      });
    });
    return out;
  }

  function pct(a, b) { return b > 0 ? (a / b - 1) * 100 : NaN; }
  function fmtM(v) { var m = v / 1e6, a = Math.abs(m); return (m < 0 ? '−' : '') + (a >= 100 ? a.toFixed(0) : a.toFixed(1)) + 'M'; }
  function fmtP(v) { return isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(0) + '%' : '—'; }
  function fmtPP(v) { return isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(0) + ' pp' : '—'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Una fila por segmento: H1 real, H2 Budget, H2/H1 del Budget, H2/H1 del año pasado y el gap en pp.
  function rows(h1, h2) {
    var out = {};
    METRICS.forEach(function (m) {
      out[m[0]] = SEGS.map(function (s) {
        var a = h1[m[0]][s[0]], b = h2[m[0]][s[0]];
        var lyH1 = a.ly + (m[0] === 'oc' && fy() === LY_ADJ_FY && (s[0] === 'b2b2c' || s[0] === 'total') ? LY_ADJ_OC_B2B2C_H1 : 0);
        var bud = pct(b.bud, a.act), ly = pct(b.ly, lyH1), inBud = pct(b.bud, a.bud);
        // gap = plan (lo que el Budget ya planeaba sobre la estacionalidad) + h1eff (rebase por el H1 real)
        return { seg: s[0], name: s[1], metric: m[1], h1: a.act, h1VsBud: pct(a.act, a.bud), h2: b.bud,
          h1Bud: a.bud, lyH1: lyH1, lyH2: b.ly,
          h1yoy: isFinite(a.yoy) ? pct(a.ly * (1 + a.yoy / 100), lyH1) : NaN, h2yoy: pct(b.bud, b.ly),
          bud: bud, ly: ly, inBud: inBud, gap: bud - ly, plan: inBud - ly, h1eff: bud - inBud, proj: pct(b.act, b.bud) };
      });
    });
    return out;
  }

  // Challenge partido en sus dos causas: lo que planeó el Budget y el efecto del H1 real vs su Budget.
  function split(r) {
    if (!isFinite(r.plan) || !isFinite(r.h1eff)) return '';
    var tot = Math.abs(r.plan) + Math.abs(r.h1eff) || 1;
    var seg = function (v, c) { return '<i class="' + c + (v < 0 ? ' h21-neg' : '') + '" style="width:' + (Math.abs(v) / tot * 100).toFixed(0) + '%"></i>'; };
    return '<span class="h21-stack">' + seg(r.plan, 'h21-sp') + seg(r.h1eff, 'h21-sh') + '</span>' +
      '<span class="h21-stxt">' + fmtPP(r.plan).replace(' pp', '') + ' · ' + fmtPP(r.h1eff).replace(' pp', '') + '</span>';
  }

  // Tabla: cada % en su columna, con el encabezado diciendo qué compara contra qué; el gráfico de la
  // última columna repite los tres crecimientos (barra = pide el Budget, círculo = planeado, línea = año pasado).
  function block(title, list) {
    var vals = [];
    list.forEach(function (r) { [r.bud, r.ly, r.inBud].forEach(function (v) { if (isFinite(v)) vals.push(v); }); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(1, Math.max.apply(null, vals));
    var span = hi - lo, x = function (v) { return ((v - lo) / span * 100).toFixed(1) + '%'; };
    function calc(num, den, a, b) { return esc(fmtM(num) + ' ' + a + ' / ' + fmtM(den) + ' ' + b + ' − 1'); }
    var body = list.map(function (r) {
      var from = Math.min(0, r.bud), to = Math.max(0, r.bud);
      var bar = isFinite(r.bud) ? '<span class="h21-bar" style="left:' + x(from) + ';width:calc(' + x(to) + ' - ' + x(from) + ')"></span>' : '';
      var tick = isFinite(r.ly) ? '<span class="h21-tick" style="left:' + x(r.ly) + '"></span>' : '';
      var plan = isFinite(r.inBud) ? '<span class="h21-plan" style="left:' + x(r.inBud) + '"></span>' : '';
      var zero = lo < 0 ? '<span class="h21-zero" style="left:' + x(0) + '"></span>' : '';
      var gc = !isFinite(r.gap) ? '' : r.gap > 5 ? 'h21-hard' : r.gap < -5 ? 'h21-soft' : 'h21-even';
      return '<div class="h21-row' + (r.seg === 'total' ? ' h21-tot' : '') + '">' +
        '<div class="h21-seg">' + esc(r.name) + '</div>' +
        '<div class="h21-num" title="H1 Budget: ' + esc(fmtM(r.h1Bud)) + '">' + fmtM(r.h1) +
          '<small class="' + (r.h1VsBud >= 0 ? 'h21-up' : 'h21-dn') + '">' + fmtP(r.h1VsBud) + ' vs H1 Bud</small></div>' +
        '<div class="h21-num">' + fmtM(r.h2) + '</div>' +
        '<div class="h21-num h21-pc h21-c1" title="' + calc(r.h2, r.h1, 'H2 Bud', 'H1 real') + '">' + fmtP(r.bud) + '</div>' +
        '<div class="h21-num h21-pc h21-c2" title="' + calc(r.h2, r.h1Bud, 'H2 Bud', 'H1 Bud') + '">' + fmtP(r.inBud) + '</div>' +
        '<div class="h21-num h21-pc h21-c3" title="' + calc(r.lyH2, r.lyH1, 'H2 LY', 'H1 LY') + '">' + fmtP(r.ly) + '</div>' +
        '<div class="h21-gapc" title="' + esc('Pide el Budget ' + fmtP(r.bud) + ' − año pasado ' + fmtP(r.ly) + ' = ' + fmtPP(r.gap) +
          ' (plan ' + fmtPP(r.plan) + ' + efecto H1 ' + fmtPP(r.h1eff) + ')') + '"><div class="h21-gap ' + gc + '">' + fmtPP(r.gap) + '</div>' +
          '<div class="h21-split">' + split(r) + '</div></div>' +
        '<div class="h21-viz">' + zero + bar + plan + tick + '</div>' +
        '</div>';
    }).join('');
    function hd(a, b, c) { return '<div class="h21-h' + (c || '') + '"><b>' + a + '</b><span>' + b + '</span></div>'; }
    return '<section class="h21-block"><h3>' + title + ' <span class="h21-muted">· crecimiento del H2 sobre el H1</span></h3>' +
      '<div class="h21-row h21-hdr"><div></div>' +
      hd('H1 real', 'USD · vs su Budget') + hd('H2 Budget', 'USD') +
      hd('Pide el Budget', 'H2 Bud vs H1 real', ' h21-c1') + hd('Planeado', 'H2 Bud vs H1 Bud', ' h21-c2') + hd('Año pasado', 'H2 vs H1 FY' + String(fy() - 1).slice(-2), ' h21-c3') +
      hd('Challenge', 'Pide − Año pasado') +
      '<div class="h21-hv"><span><i class="h21-kbar"></i>pide</span><span><i class="h21-kplan"></i>planeado</span><span><i class="h21-ktick"></i>año pasado</span></div>' +
      '</div>' + body + '</section>';
  }

  // Cómo leer la tabla, en una línea (va arriba de las dos tablas).
  function howTo() {
    return '<div class="h21-how"><b>Cómo leer:</b> tres crecimientos del H2 sobre el H1 — ' +
      '<span class="h21-c1">Pide el Budget</span> = H2 Budget / H1 real · ' +
      '<span class="h21-c2">Planeado</span> = H2 Budget / H1 Budget · ' +
      '<span class="h21-c3">Año pasado</span> = H2 / H1 del FY' + String(fy() - 1).slice(-2) + '. ' +
      '<b>Challenge</b> = Pide − Año pasado, en pp = <b>plan</b> (Planeado − Año pasado) + <b>efecto H1</b> (Pide − Planeado: el H1 real arriba o abajo de su Budget).</div>';
  }

  // ── Veredicto: cuántos pp pide el Budget por encima de un H2 normal ──────────────────────────
  var VERDICTS = [
    [25, 'Muy exigente', 'h21-v4'], [8, 'Exigente', 'h21-v3'], [-8, 'Normal', 'h21-v2'], [-Infinity, 'Holgado', 'h21-v1'],
  ];
  function verdict(gap) {
    if (!isFinite(gap)) return ['—', 'h21-v2'];
    for (var i = 0; i < VERDICTS.length; i++) if (gap > VERDICTS[i][0]) return [VERDICTS[i][1], VERDICTS[i][2]];
    return ['Holgado', 'h21-v1'];
  }
  function metricShort(r) { return r.metric === 'Net Revenue' ? 'NR' : 'OC'; }

  // ── Slide (formato de la presentación de dirección, 16:9, en inglés como el deck) ─────────────
  var SEG_COLORS = { b2b2c: '#550fed', min: '#ffaa44', may: '#e08a00' };
  var SEG_EN = { total: 'Total', b2b2c: 'B2B2C', min: 'B2B MIN', may: 'B2B MAY' };
  function pc(v, cls0) { return '<b class="' + (cls0 || (v >= 0 ? 'h21-up' : 'h21-dn')) + '">' + fmtP(v) + '</b>'; }
  function segLine(list, get) {
    return list.slice(1).map(function (r) { return SEG_EN[r.seg] + ' ' + pc(get(r)); }).join(' · ');
  }
  function sCard(title, list, half, gb) {
    var t = list[0], h1 = half === 1;
    var val = h1 ? t.h1 : t.h2;
    var marg = gb ? '<span class="h21-smarg">' + (val / gb * 100).toFixed(1) + '%</span>' : '';
    return '<div class="h21-scard"><div class="h21-spill">' + title + (h1 ? ' H1 Actual' : ' H2 Budget') + '</div>' +
      '<div class="h21-sval' + (h1 ? '' : ' h21-sval2') + '">USD ' + fmtM(val) + marg + '</div>' +
      (h1 ? '<div class="h21-sl">' + pc(t.h1VsBud) + ' vs Budget | ' + segLine(list, function (r) { return r.h1VsBud; }) + '</div>' +
            '<div class="h21-sl h21-sly">YoY: Total ' + pc(t.h1yoy) + ' | ' + segLine(list, function (r) { return r.h1yoy; }) + '</div>'
          : '<div class="h21-sl">' + pc(t.bud) + ' vs H1 Act | ' + segLine(list, function (r) { return r.bud; }) + '</div>' +
            '<div class="h21-sl h21-sly">YoY: Total ' + pc(t.h2yoy) + ' | ' + segLine(list, function (r) { return r.h2yoy; }) + '</div>') +
      '</div>';
  }
  // Barras H1 real / H2 Budget × B2B2C / MIN / MAY, YoY arriba de cada barra (SVG)
  function sChart(title, list, adjNote) {
    var segs = list.slice(1), W = 520, H = 210, base = 172, top = 30, bw = 46, gap = 6;
    var bars = [];
    segs.forEach(function (r, i) { bars.push({ x: 40 + i * (bw + gap), v: r.h1, yoy: r.h1yoy, c: SEG_COLORS[r.seg], star: adjNote && r.seg === 'b2b2c' }); });
    segs.forEach(function (r, i) { bars.push({ x: 300 + i * (bw + gap), v: r.h2, yoy: r.h2yoy, c: SEG_COLORS[r.seg] }); });
    var max = Math.max.apply(null, bars.map(function (b) { return Math.max(b.v, 0); })) || 1;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + '">';
    bars.forEach(function (b) {
      var h = Math.max(b.v, 0) / max * (base - top), y = base - h;
      svg += '<rect x="' + b.x + '" y="' + y.toFixed(1) + '" width="' + bw + '" height="' + h.toFixed(1) + '" rx="2" fill="' + b.c + '"/>';
      svg += '<text x="' + (b.x + bw / 2) + '" y="' + (h > 22 ? (y + h / 2 + 5) : (y - 20)).toFixed(1) + '" class="' + (h > 22 ? 'h21-sbv' : 'h21-sbv h21-sbvo') + '">' + fmtM(b.v).replace('M', '') + '</text>';
      svg += '<text x="' + (b.x + bw / 2) + '" y="' + (y - 6).toFixed(1) + '" class="h21-sby" fill="' + (b.yoy >= 0 ? '#34a853' : '#d4373a') + '">' + fmtP(b.yoy) + (b.star ? '*' : '') + '</text>';
    });
    svg += '<line x1="20" x2="' + (W - 20) + '" y1="' + base + '" y2="' + base + '" stroke="#d0d0d8"/>';
    var c1 = 40 + (segs.length * (bw + gap) - gap) / 2, c2 = 300 + (segs.length * (bw + gap) - gap) / 2;
    svg += '<text x="' + c1 + '" y="' + (base + 24) + '" class="h21-sbx">H1</text><text x="' + c2 + '" y="' + (base + 24) + '" class="h21-sbx">H2</text></svg>';
    return '<div class="h21-schart"><div class="h21-sct">' + title + ' (USD M)</div>' + svg + '</div>';
  }
  // Main challenges: veredicto + porqué (en inglés), los negocios ordenados por exigencia
  var VERD_EN = { 'Muy exigente': 'Very demanding', 'Exigente': 'Demanding', 'Normal': 'In line', 'Holgado': 'Comfortable' };
  function whyEn(r) {
    var h1 = 'H1 ' + metricShort(r) + ' ' + fmtP(r.h1VsBud) + ' vs Budget';
    if (r.gap > 8) {
      return Math.abs(r.h1eff) > Math.abs(r.plan) && r.h1eff > 0
        ? 'must recover a weak H1 (' + h1 + '); the Budget itself planned a normal H2'
        : 'the Budget already planned a strong H2 (' + fmtP(r.inBud) + ' over H1)' + (r.h1eff < -5 ? ', partly covered by ' + h1 : '');
    }
    if (r.gap < -8) return 'asks less than a normal H2' + (r.h1VsBud > 5 ? ' after ' + h1 : '');
    return 'in line with a normal H2';
  }
  function sChallenges(all) {
    var items = SEGS.slice(1).map(function (s, i) {
      var nr = all.nr[i + 1], oc = all.oc[i + 1], main = (isFinite(oc.gap) && oc.gap > nr.gap) ? oc : nr;
      return { s: s, nr: nr, oc: oc, main: main };
    }).sort(function (a, b) { return b.main.gap - a.main.gap; });
    var li = items.map(function (it) {
      var v = verdict(it.main.gap), m = it.main;
      return '<li><span class="h21-vtag ' + v[1] + '">' + VERD_EN[v[0]] + '</span> <b>' + SEG_EN[it.s[0]] + '</b>: ' +
        'H2 Budget ' + metricShort(m) + ' ' + pc(m.bud, 'h21-strong') + ' over H1 (normal H2 ' + fmtP(m.ly) + ') — ' + esc(whyEn(m)) + '</li>';
    }).join('');
    return '<div class="h21-schal"><div class="h21-scht">H2 Budget Main Challenges <span>(growth H2 vs H1 vs a normal H2 = last year\'s H2 vs H1)</span></div><ul>' + li + '</ul></div>';
  }
  function sTitle(all) {
    var nr = all.nr[0], oc = all.oc[0], tot = Math.max(nr.gap, oc.gap);
    var level = tot > 25 ? 'well above' : tot > 8 ? 'above' : tot < -8 ? 'below' : 'in line with';
    var hard = [];
    SEGS.slice(1).forEach(function (s, i) {
      var ms = METRICS.filter(function (m) { return all[m[0]][i + 1].gap > 8; }).map(function (m) { return m[0] === 'nr' ? 'NR' : 'OC'; });
      if (ms.length) hard.push(SEG_EN[s[0]] + (ms.length < 2 ? ' ' + ms[0] : ''));
    });
    return 'B2B &amp; B2B2C: H2 Budget asks ' + fmtP(nr.bud) + ' NR / ' + fmtP(oc.bud) + ' OC over H1 — ' + level + ' a normal H2' +
      (hard.length ? '; the effort sits in ' + hard.join(' and ') : '');
  }
  function slide(all, h1, h2) {
    var adj = fy() === LY_ADJ_FY;
    return '<div class="h21-slide">' +
      '<div class="h21-stitle">' + sTitle(all) + '</div>' +
      '<div class="h21-sgrid">' +
        '<div class="h21-scol"><div class="h21-shalf">H1</div>' + sCard('Net Revenue', all.nr, 1) + sCard('Op. Contribution', all.oc, 1, h1.gb.total.act) + '</div>' +
        '<div class="h21-scol"><div class="h21-shalf">H2</div>' + sCard('Net Revenue', all.nr, 2) + sCard('Op. Contribution', all.oc, 2, h2.gb.total.bud) + '</div>' +
        '<div class="h21-scharts"><div class="h21-scap">H1 actuals vs H2 Budget | YoY vs FY' + String(fy() - 1).slice(-2) + ' above each bar ' +
          '<span class="h21-sleg"><i style="background:' + SEG_COLORS.b2b2c + '"></i>B2B2C <i style="background:' + SEG_COLORS.min + '"></i>B2B MIN <i style="background:' + SEG_COLORS.may + '"></i>B2B MAY</span></div>' +
          sChart('Net Revenue', all.nr) + sChart('Op. Contribution', all.oc, adj) + '</div>' +
        sChallenges(all) +
      '</div>' +
      '<div class="h21-sfoot">' + (adj ? '* H1 OC YoY adj. excl. LATAM extraordinary payment USD 5.6M (Jun-25). ' : '') +
        (organicOn() ? 'Organic: H1 actuals at Budget FX. ' : '') + 'OC margin over Gross Bookings.<span>FY' + String(fy()).slice(-2) + ' | Despegar</span></div>' +
      '</div>';
  }

  function render(h1r, h2r) {
    var h1 = pick(h1r), h2 = pick(h2r);
    if (!h1.nr || !h2.nr || !h1.oc || !h2.oc) {
      body().innerHTML = '<p class="h21-err">No llegaron los datos del P&amp;L para armar la vista.</p>';
      return;
    }
    var all = rows(h1, h2), yr = fy(), org = organicOn(), ly = 'FY' + String(yr - 1).slice(-2);
    var p = all.nr[0].proj, q = all.oc[0].proj;
    var open = panel.querySelector('.h21-det') && panel.querySelector('.h21-det').open;
    body().innerHTML =
      '<div class="h21-sub">Formato de la presentación de dirección · ' +
        '<span class="h21-mode">' + (org ? 'Organic: H1 real a tipo de cambio Budget' : 'USD nominales') + '</span></div>' +
      slide(all, h1, h2) +
      '<p class="h21-today">Hoy, con el real de octubre y el Run Rate, el H2 se proyecta <b class="' + (p >= 0 ? 'h21-up' : 'h21-dn') + '">' + fmtP(p) + '</b> en Net Revenue y ' +
        '<b class="' + (q >= 0 ? 'h21-up' : 'h21-dn') + '">' + fmtP(q) + '</b> en Operating Contribution contra el Budget.</p>' +
      '<details class="h21-det"' + (open ? ' open' : '') + '><summary>Ver detalle: de dónde sale el esfuerzo (plan del Budget vs efecto H1)</summary>' +
        howTo() + block('Net Revenue', all.nr) + block('Operating Contribution', all.oc) + '</details>' +
      '<p class="h21-foot"><b>Un H2 normal</b> = cuánto creció el H2 sobre el H1 en el ' + ly + ' (la estacionalidad). ' +
        '<b>Veredicto</b> según cuántos puntos pide el Budget por encima de eso: más de 25 muy exigente, 8 a 25 exigente, ±8 normal, menos de −8 holgado. ' +
        (org ? 'Con Organic, el H1 real va a tipo de cambio Budget para compararlo con el H2 Budget. ' : '') +
        (yr === LY_ADJ_FY ? 'OC ' + ly + ' H1 sin el pago extraordinario LATAM de USD 5.6M (jun-25, B2B2C). ' : '') +
        'Fuente: P&amp;L contable.</p>';
  }

  function body() { return panel.querySelector('.h21-body'); }

  function ensurePanel() {
    if (panel) return panel;
    var css = document.createElement('style');
    css.textContent = [
      '#h21{position:fixed;left:0;right:0;bottom:0;z-index:40;background:#f5f5f7;overflow:auto;font-family:Poppins,-apple-system,"Segoe UI",sans-serif;color:#1d1d1f}',
      '#h21 .h21-wrap{max-width:1280px;margin:0 auto;padding:18px 24px 32px}',
      '#h21 .h21-top{display:flex;align-items:center;gap:14px}',
      '#h21 h2{font-size:20px;font-weight:600;margin:0}',
      '#h21 .h21-org{margin-left:auto;display:flex;align-items:center;gap:0;font-size:12px;color:#6e6e73}',
      '#h21 .h21-org span{margin-right:8px}',
      '#h21 .h21-org button{border:1px solid #d0d0d8;background:#fff;padding:5px 12px;cursor:pointer;font:inherit;font-size:12px;font-weight:600;color:#3a3a3c}',
      '#h21 .h21-org button:first-of-type{border-radius:8px 0 0 8px}#h21 .h21-org button:last-of-type{border-radius:0 8px 8px 0;border-left:none}',
      '#h21 .h21-org button[aria-pressed="true"]{background:#550fed;border-color:#550fed;color:#fff}',
      '#h21 .h21-close{margin-left:10px;border:1px solid #d0d0d8;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit;font-size:13px}',
      '#h21 .h21-sub{color:#6e6e73;font-size:12.5px;margin:0 0 14px}',
      '#h21 .h21-mode{background:#ece7fd;color:#3d0bb0;border-radius:6px;padding:1px 7px;font-weight:600}',
      '#h21 .h21-slide{background:#fff;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.08);aspect-ratio:16/9;max-width:1240px;margin:0 auto;padding:22px 28px 14px;display:flex;flex-direction:column;box-sizing:border-box}',
      '#h21 .h21-stitle{color:#4300d2;font-size:21px;font-weight:600;line-height:1.3;margin-bottom:14px}',
      '#h21 .h21-sgrid{flex:1;display:grid;grid-template-columns:1fr 1fr 1.45fr;grid-template-rows:auto 1fr;gap:12px 16px;min-height:0}',
      '#h21 .h21-scol{display:flex;flex-direction:column;gap:12px}',
      '#h21 .h21-shalf{align-self:center;background:#550fed;color:#fff;font-weight:600;font-size:13px;border-radius:4px;padding:2px 22px}',
      '#h21 .h21-scard{border:1px solid #d8d8d8;border-radius:8px;padding:16px 12px 10px;position:relative;text-align:center}',
      '#h21 .h21-spill{position:absolute;top:-10px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#550fed;color:#fff;font-size:12px;font-weight:600;border-radius:4px;padding:2px 12px}',
      '#h21 .h21-sval{color:#4300d2;font-size:24px;font-weight:700;margin:2px 0 4px}',
      '#h21 .h21-sval2{color:#e08a00}',
      '#h21 .h21-smarg{font-size:15px;font-weight:600;color:#4300d2;margin-left:8px}',
      '#h21 .h21-sl{font-size:11.5px;color:#757575;line-height:1.5}',
      '#h21 .h21-sly{margin-top:2px}',
      '#h21 .h21-strong{color:#1d1d1f}',
      '#h21 .h21-scharts{grid-row:1 / span 2;grid-column:3;display:flex;flex-direction:column;gap:4px;min-height:0}',
      '#h21 .h21-scap{font-size:12px;color:#444;text-align:center}',
      '#h21 .h21-sleg{display:block;margin-top:3px;font-size:11px;color:#6e6e73}',
      '#h21 .h21-sleg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin:0 4px 0 10px}',
      '#h21 .h21-schart{flex:1;min-height:0;display:flex;flex-direction:column}',
      '#h21 .h21-sct{color:#550fed;font-size:13px;font-weight:600;text-align:center}',
      '#h21 .h21-schart svg{flex:1;min-height:0;width:100%;height:auto}',
      '#h21 .h21-sbv{fill:#fff;font-size:12px;font-weight:700;text-anchor:middle}#h21 .h21-sbvo{fill:#3a3a3c}',
      '#h21 .h21-sby{font-size:11.5px;font-weight:700;text-anchor:middle}',
      '#h21 .h21-sbx{fill:#444;font-size:14px;font-weight:700;text-anchor:middle}',
      '#h21 .h21-schal{grid-column:1 / span 2;background:#f1ecfd;border-radius:8px;padding:10px 14px;font-size:12.5px;color:#3a3a3c;align-self:stretch}',
      '#h21 .h21-scht{font-weight:700;color:#1d1d1f;margin-bottom:5px}#h21 .h21-scht span{font-weight:400;color:#757575;font-size:11px}',
      '#h21 .h21-schal ul{margin:0;padding-left:0;list-style:none}#h21 .h21-schal li{margin:5px 0;line-height:1.4}',
      '#h21 .h21-schal .h21-vtag{font-size:10.5px;padding:1px 8px;margin-right:2px}',
      '#h21 .h21-sfoot{display:flex;justify-content:space-between;font-size:10.5px;color:#9b9b9b;margin-top:8px}',
      '@media (max-width:1000px){#h21 .h21-slide{aspect-ratio:auto}#h21 .h21-sgrid{grid-template-columns:1fr 1fr}#h21 .h21-scharts{grid-row:auto;grid-column:1 / -1}}',
      '#h21 .h21-vtag{font-size:12.5px;font-weight:700;border-radius:999px;padding:3px 11px}',
      '#h21 .h21-v4{color:#b3261e}#h21 .h21-v3{color:#b35c00}#h21 .h21-v2{color:#3a3a3c}#h21 .h21-v1{color:#146c43}',
      '#h21 .h21-vtag.h21-v4{background:#fdecea}#h21 .h21-vtag.h21-v3{background:#fff1e0}#h21 .h21-vtag.h21-v2{background:#f0f0f3}#h21 .h21-vtag.h21-v1{background:#e6f4ec}',
      '#h21 .h21-today{font-size:14px;margin:14px 2px}',
      '#h21 .h21-det{margin-top:6px}',
      '#h21 .h21-det summary{cursor:pointer;font-size:13px;color:#550fed;font-weight:600;padding:6px 2px;list-style-position:inside}',
      '#h21 .h21-det[open] summary{margin-bottom:10px}',
      '#h21 .h21-det section{margin-top:12px}',
      '#h21 section{background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}',
      '#h21 h3{font-size:15px;font-weight:600;margin:0 0 8px}',
      '#h21 h4{font-size:13px;font-weight:600;margin:12px 0 6px;color:#6e6e73}',
      '#h21 .h21-row{display:grid;grid-template-columns:118px 92px 70px 82px 82px 82px 96px minmax(110px,1fr);gap:8px;align-items:center;padding:7px 0;border-top:1px solid #f0f0f3;font-size:13.5px}',
      '#h21 .h21-hdr{align-items:end}',
      '#h21 .h21-hdr > div{text-align:right}',
      '#h21 .h21-hdr b{display:block;font-size:11.5px;color:#1d1d1f;text-transform:none;letter-spacing:0}',
      '#h21 .h21-hdr span{display:block;font-size:10.5px;color:#6e6e73;text-transform:none;letter-spacing:0}',
      '#h21 .h21-hv{display:flex;flex-wrap:wrap;gap:4px 10px;justify-content:flex-start !important;text-align:left !important}',
      '#h21 .h21-hv span{display:inline-flex !important;align-items:center;font-size:10.5px}',
      '#h21 .h21-pc{font-weight:600}',
      '#h21 .h21-c1{color:' + BAR + '}#h21 .h21-c2{color:#7b5bd6}#h21 .h21-c3{color:#3a3a3c}',
      '#h21 .h21-hdr .h21-c1 b{color:' + BAR + '}#h21 .h21-hdr .h21-c2 b{color:#7b5bd6}',
      '#h21 .h21-how{background:#fff;border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:12.5px;line-height:1.55;color:#3a3a3c;box-shadow:0 1px 3px rgba(0,0,0,.06)}',
      '#h21 .h21-how .h21-c1,#h21 .h21-how .h21-c2,#h21 .h21-how .h21-c3{font-weight:600}',
      '#h21 .h21-plan{position:absolute;top:5px;width:10px;height:10px;margin-left:-5px;border-radius:50%;border:2px solid ' + BAR + ';background:#fff;box-sizing:border-box}',
      '#h21 .h21-kplan{display:inline-block;width:9px;height:9px;border-radius:50%;border:2px solid ' + BAR + ';margin:0 3px -1px 8px;box-sizing:border-box}',
      '#h21 .h21-gapc{display:flex;flex-direction:column;align-items:flex-end;gap:3px}',
      '#h21 .h21-split{display:flex;align-items:center;gap:5px;font-size:10.5px;color:#6e6e73;font-variant-numeric:tabular-nums}',
      '#h21 .h21-stack{display:flex;width:38px;height:6px;border-radius:3px;overflow:hidden;background:#f0f0f3}',
      '#h21 .h21-stack i{display:block;height:6px}',
      '#h21 .h21-sp{background:' + BAR + '}#h21 .h21-sh{background:#ff9f0a}#h21 .h21-neg{opacity:.35}',
      '#h21 .h21-hdr{border-top:none;font-size:11px;color:#6e6e73;text-transform:uppercase;letter-spacing:.04em;padding-top:0}',
      '#h21 .h21-tot{font-weight:600}',
      '#h21 .h21-num{text-align:right;font-variant-numeric:tabular-nums}',
      '#h21 .h21-num small{display:block;font-size:11px;font-weight:500}',
      '#h21 .h21-lyv{color:#3a3a3c}',
      '#h21 .h21-viz{position:relative;height:22px}',
      '#h21 .h21-bar{position:absolute;top:4px;height:14px;border-radius:3px;background:' + BAR + ';opacity:.85}',
      '#h21 .h21-tot .h21-bar{opacity:1}',
      '#h21 .h21-tick{position:absolute;top:0;width:3px;height:22px;margin-left:-1.5px;border-radius:1px;background:' + LYC + '}',
      '#h21 .h21-zero{position:absolute;top:0;width:1px;height:22px;background:#c7c7cc}',
      '#h21 .h21-kbar{display:inline-block;width:14px;height:8px;background:' + BAR + ';border-radius:2px;margin:0 3px 0 4px}',
      '#h21 .h21-ktick{display:inline-block;width:3px;height:11px;background:' + LYC + ';margin:0 3px -1px 8px}',
      '#h21 .h21-gap{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;border-radius:6px;padding:3px 6px}',
      '#h21 .h21-hard{color:#b3261e;background:#fdecea}#h21 .h21-soft{color:#146c43;background:#e6f4ec}#h21 .h21-even{color:#3a3a3c;background:#f2f2f5}',
      '#h21 .h21-up{color:' + UP + '}#h21 .h21-dn{color:' + DOWN + '}',
      '#h21 .h21-muted{color:#6e6e73;font-weight:400}',
      '#h21 .h21-foot{color:#8e8e93;font-size:11.5px;margin-top:12px;line-height:1.5}',
      '#h21 .h21-err,#h21 .h21-load{color:#6e6e73;font-size:14px}',
    ].join('\n');
    document.head.appendChild(css);
    panel = document.createElement('div');
    panel.id = 'h21';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'H2 Budget vs H1');
    panel.style.display = 'none';
    panel.innerHTML = '<div class="h21-wrap"><div class="h21-top"><h2>H2 Budget vs H1 real · ¿qué tan exigente es el H2?</h2>' +
      '<div class="h21-org" role="group" aria-label="Organic"><span>Organic</span>' +
      '<button type="button" data-o="yes">YES</button><button type="button" data-o="no">NO</button></div>' +
      '<button type="button" class="h21-close">← Volver al P&amp;L</button></div><div class="h21-body"></div></div>';
    panel.querySelector('.h21-close').onclick = close;
    Array.prototype.forEach.call(panel.querySelectorAll('.h21-org button'), function (b) {
      b.onclick = function () { setOrganic(b.dataset.o === 'yes'); };
    });
    document.body.appendChild(panel);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && panel.style.display !== 'none') close(); });
    return panel;
  }

  function place() {
    var nav = document.getElementById('ownia-hubnav');
    var top = nav ? nav.getBoundingClientRect().bottom : 0;
    panel.style.top = Math.max(0, Math.round(top)) + 'px';
  }

  function close() { if (panel) panel.style.display = 'none'; }

  function syncOrg() {
    var on = organicOn();
    Array.prototype.forEach.call(panel.querySelectorAll('.h21-org button'), function (b) {
      b.setAttribute('aria-pressed', String((b.dataset.o === 'yes') === on));
    });
  }

  // Mismo switch que el del Hub (setOrganic recarga el P&L de atrás); la vista se recalcula con el nuevo modo.
  function setOrganic(on) {
    if (on === organicOn()) return;
    if (typeof window.setOrganic === 'function') window.setOrganic(on);
    else if (window._state) window._state.organic = on;
    load();
  }

  function load() {
    syncOrg();
    var h = halves();
    body().innerHTML = '<p class="h21-load">Cargando H1 y H2…</p>';
    Promise.all([fetchData(h.h1), fetchData(h.h2)])
      .then(function (r) { render(r[0], r[1]); })
      .catch(function (e) { body().innerHTML = '<p class="h21-err">No se pudieron leer los datos: ' + esc((e && e.message) || e) + '</p>'; });
  }

  window.openH2vsH1 = function () {
    ensurePanel();
    place();
    panel.style.display = '';
    panel.scrollTop = 0;
    if (typeof window._closeNav === 'function') window._closeNav();
    load();
  };
  // Cualquier otra pestaña o cambio de LoB cierra la vista.
  document.addEventListener('DOMContentLoaded', function () {
    var orig = window.switchLob;
    if (typeof orig === 'function') window.switchLob = function () { close(); return orig.apply(this, arguments); };
    window.addEventListener('resize', function () { if (panel && panel.style.display !== 'none') place(); });
  });
})();
