/* Flow semanal · "Brasil: efecto de las elecciones de octubre 2026" (2026-11-03, Diego). Solo en <base>/daily?flowdeck=1.
 *
 * ¿La venta diaria de Brasil sintió las presidenciales (1ª vuelta dom 4/10, 2ª vuelta dom 25/10)? Para WL (B2B2C) Farming
 * (account_type Existing, como el KR3; TBD cuenta como New; ITAU es New → afuera, Itau Card es Existing → adentro), B2B HTML
 * (parent_channel 'Agencias afiliadas') y B2B API, con B2C Brasil de control (no está en ramp-up: si cae lo mismo, es mercado).
 * Datos del Daily (fecha de gestión, GD) en USD Organic SIEMPRE (2026-11-03, Diego): el año actual a TC Actuals LY
 * (_orgRows_ 'ly', = YoY Organic del Daily), sin importar el switch; si falta la tabla de TC la pide (getFxTable).
 *   - YoY alineado por día de la semana: el año pasado = 364 días antes (el domingo de elección contra un domingo sin elección).
 *   - Semanas lunes–domingo (pedido de Diego): el domingo de cada vuelta cierra su semana (28/9–4/10 y 19–25/10).
 *   - Tendencia previa = las 4 semanas lunes–domingo antes de la semana de la 1ª vuelta (31/8–27/9).
 *   - Gráficos: YoY de GB móvil 7 días, del 1/9 al último día completo (hasta el 1/11), con las dos elecciones marcadas.
 *   - Tabla: YoY de GB por semana y la semana post 2ª vuelta (26/10–1/11) contra el nivel semanal previo de ESTE año (sin LY):
 *     separa la caída propia del efecto base.
 * La slide la ubica daily-flow-minto.js (W.FLOW_EXTRA): al final de la vista Ejecutiva, antes del Anexo en la Completa.
 * Es un análisis puntual de octubre: sacarla cuando deje de hacer falta (quitar el archivo del `layout` del Daily en modules.js).
 */
(function () {
  'use strict';
  if (!/[?&]flowdeck=1(&|$)/.test(location.search)) return;
  var W = window, DAY = 864e5, LAG = 364;
  var E1 = '2026-10-04', E2 = '2026-10-25', FROM = '2026-09-01', LAST = '2026-11-01';
  var BASE = ['2026-08-31', '2026-09-27'];
  // [encabezado, desde, hasta] lunes–domingo; 1 y 4 = semanas que cierran con el domingo de cada vuelta, 2 y 5 = la semana siguiente
  var WEEKS = [['31/8–27/9', BASE[0], BASE[1]], ['1ª vuelta<br>28/9–4/10', '2026-09-28', '2026-10-04'], ['5–11/10', '2026-10-05', '2026-10-11'],
    ['12–18/10', '2026-10-12', '2026-10-18'], ['2ª vuelta<br>19–25/10', '2026-10-19', '2026-10-25'], ['26/10–1/11', '2026-10-26', '2026-11-01']];
  var POST = 5;   // semana contra el nivel previo de este año
  var BIZ = [
    { k: 'farm', lbl: 'WL Farming', c: '#5b4fe0' },
    { k: 'html', lbl: 'B2B HTML', c: '#0f9d8a' },
    { k: 'api', lbl: 'B2B API', c: '#f08c1a' },
    { k: 'b2c', lbl: 'B2C (control)', c: '#8e8e93' },
  ];

  var css = document.createElement('style');
  css.textContent = [
    '.fe-body{display:flex;flex-direction:column;gap:10px}',
    '.fe-panels{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}',
    '.fe-p{border:1px solid var(--fl-line);border-radius:10px;padding:8px 10px 4px;background:#fbfaff}',
    '.fe-ph{display:flex;align-items:baseline;gap:6px;font-size:13px;font-weight:800}.fe-ph span{font-size:11px;font-weight:600;color:var(--fl-ink3)}',
    '.fe-svg{display:block;width:100%;height:auto}',
    '.fe-low{display:grid;grid-template-columns:1fr 400px;gap:16px;align-items:start}',
    '.fe-t{width:100%;border-collapse:collapse;font-size:12.5px}',
    '.fe-t th{font-size:10.5px;font-weight:700;color:var(--fl-ink3);text-align:right;padding:4px 6px;border-bottom:1px solid var(--fl-line);white-space:nowrap}',
    '.fe-t td{text-align:right;padding:6px 6px;border-bottom:1px solid var(--fl-line);white-space:nowrap}',
    '.fe-t td:first-child,.fe-t th:first-child{text-align:left}.fe-t td:first-child{font-weight:700}',
    '.fe-t .fe-e{background:#f3f0ff}.fe-t small{display:block;font-size:10px;font-weight:600;color:var(--fl-ink3)}',
    '.fe-up{color:var(--fl-green)!important}.fe-dn{color:var(--fl-red)!important}',
    '.fe-msg{font-size:12.5px;line-height:1.5;color:var(--fl-ink2);background:#f3f0ff;border-radius:8px;padding:10px 12px}',
    '.fe-msg b{color:var(--fl-ink)}.fe-msg ul{margin:4px 0 0;padding-left:16px}',
    '.fe-note{font-size:10.5px;color:var(--fl-ink3);line-height:1.4}',
    '.fe-wait{font-size:13px;color:var(--fl-ink3);font-style:italic;padding:30px}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pc(v, d) { return v == null || !isFinite(v) ? 'n/d' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d == null ? 0 : d) + '%'; }
  function fm(v) { var a = Math.abs(v), s = v < 0 ? '−' : v > 0 ? '+' : ''; return s + '$' + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : Math.round(a / 1e3) + 'K'); }
  function cl(v) { return v == null || !isFinite(v) ? '' : v >= 0 ? 'fe-up' : 'fe-dn'; }
  function t(d) { return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)); }
  function ds(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function add(d, n) { return ds(t(d) + n * DAY); }
  function ddmm(d) { return d.slice(8, 10) + '/' + d.slice(5, 7); }

  // ── Series diarias de Brasil: { cy: {fecha: [gb, nr]}, ly: {fecha: [gb, nr]} } ─────────────────
  function acc(rows, filt, nrF) {
    var o = {};
    (rows || []).forEach(function (r) {
      if (r.pais !== 'Brasil' || !filt(r)) return;
      var x = o[r.fecha] || (o[r.fecha] = [0, 0]);
      x[0] += +r.gross_bookings || 0; x[1] += +r[nrF] || 0;
    });
    return o;
  }
  function b2bReady() { return !!(W._rawB2B && W._rawB2B.b2b_gd && W._rawB2B.b2b_gd_ly); }
  // ── USD Organic: el año actual a TC Actuals LY (mismo cálculo que el YoY Organic del Daily) ──
  var fxState = W._fxTbl ? 'ok' : 'idle';
  function fxReady() { return !!(W._fxTbl && typeof W._orgRows_ === 'function'); }
  function loadFx() {
    if (fxReady()) { fxState = 'ok'; return; }
    if (fxState !== 'idle' || !(W.google && W.google.script && W.google.script.run)) return;
    fxState = 'loading';
    W.google.script.run
      .withSuccessHandler(function (res) {
        if (!res || !res.success) { fxState = 'err'; return; }
        if (!W._fxTbl) W._fxTbl = { actuals: res.actuals, budget: res.budget, forecast: res.forecast };
        fxState = 'ok';
      })
      .withFailureHandler(function () { fxState = 'err'; })
      .getFxTable();
  }
  function org(rows) { return fxReady() && rows && rows.length ? W._orgRows_(rows, 'ly') : rows; }
  function series() {
    var c = W._rawB2BC, b = W._rawB2B, ex = function (r) { return r.account_type === 'Existing'; }, all = function () { return true; };
    var s = {
      farm: { cy: acc(org(c.actuals), ex, 'net_revenues'), ly: acc(c.actuals_ly, ex, 'net_revenues') },
      b2c: { cy: acc(org(typeof W._b2cRows_ === 'function' ? W._b2cRows_(c) : []), all, 'net_revenues'), ly: acc(typeof W._b2cLyRows_ === 'function' ? W._b2cLyRows_(c) : [], all, 'net_revenues') },
    };
    if (b2bReady()) {
      var ch = function (n) { return function (r) { return r.parent_channel === n; }; }, cy = org(b.b2b_gd);
      s.html = { cy: acc(cy, ch('Agencias afiliadas'), 'net_revenue'), ly: acc(b.b2b_gd_ly, ch('Agencias afiliadas'), 'net_revenue') };
      s.api = { cy: acc(cy, ch('API'), 'net_revenue'), ly: acc(b.b2b_gd_ly, ch('API'), 'net_revenue') };
    }
    return s;
  }
  function sum(m, a, b, i) { var x = 0; for (var d = a; d <= b; d = add(d, 1)) x += (m[d] || [0, 0])[i]; return x; }
  function yoy(s, a, b, i) { var c = sum(s.cy, a, b, i), l = sum(s.ly, add(a, -LAG), add(b, -LAG), i); return { c: c, l: l, y: l ? (c / l - 1) * 100 : NaN }; }
  // último día completo: el del Daily menos uno (el último día cargado suele venir parcial), tope 31/10
  function lastDay() {
    var ld = (W._rawB2BC && W._rawB2BC.meta && W._rawB2BC.meta.last_actuals_date) || LAST;
    var d = add(ld, -1);
    return d < LAST ? d : LAST;
  }

  // ── Mini gráfico: YoY de GB móvil 7 días ─────────────────────────────────────────────────────
  function panel(b, s, end, base) {
    var Wd = 280, Hd = 190, x0 = 4, x1 = Wd - 4, y0 = 14, y1 = Hd - 18, pts = [];
    for (var d = FROM; d <= end; d = add(d, 1)) { var r = yoy(s, add(d, -6), d, 0); if (isFinite(r.y)) pts.push([d, r.y]); }
    if (!pts.length) return '<div class="fe-p"><div class="fe-ph" style="color:' + b.c + '">' + esc(b.lbl) + '</div><div class="fe-wait">Sin datos</div></div>';
    var vs = pts.map(function (p) { return p[1]; }).concat([base, 0]), mx = Math.max.apply(null, vs), mn = Math.min.apply(null, vs), pad = (mx - mn) * 0.1 || 5;
    mx += pad; mn -= pad;
    var n = (t(end) - t(FROM)) / DAY || 1;
    var X = function (d) { return x0 + (t(d) - t(FROM)) / DAY / n * (x1 - x0); }, Y = function (v) { return y0 + (mx - v) / (mx - mn) * (y1 - y0); };
    var g = '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="#d0d0d8"/>';
    g += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + Y(base).toFixed(1) + '" y2="' + Y(base).toFixed(1) + '" stroke="' + b.c + '" stroke-dasharray="3 3" opacity=".55"/>';
    [[E1, '1ª'], [E2, '2ª']].forEach(function (e) {
      if (e[0] > end) return;
      var x = X(e[0]).toFixed(1);
      g += '<line x1="' + x + '" x2="' + x + '" y1="' + y0 + '" y2="' + y1 + '" stroke="#d4373a" stroke-width="1.2" opacity=".7"/>' +
        '<text x="' + x + '" y="10" text-anchor="middle" font-size="9.5" font-weight="700" fill="#d4373a">' + e[1] + ' vuelta</text>';
    });
    g += '<polyline fill="none" stroke="' + b.c + '" stroke-width="2.2" points="' + pts.map(function (p) { return X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' ') + '"/>';
    var lp = pts[pts.length - 1];
    g += '<text x="' + (X(lp[0]) - 2).toFixed(1) + '" y="' + (Y(lp[1]) - 5).toFixed(1) + '" text-anchor="end" font-size="10.5" font-weight="700" fill="' + b.c + '">' + pc(lp[1]) + '</text>';
    g += '<text x="' + x0 + '" y="' + (Hd - 4) + '" font-size="9.5" fill="#8e8e93">' + ddmm(FROM) + '</text><text x="' + x1 + '" y="' + (Hd - 4) + '" text-anchor="end" font-size="9.5" fill="#8e8e93">' + ddmm(end) + '</text>';
    g += '<text x="' + ((x0 + x1) / 2) + '" y="' + (Hd - 4) + '" text-anchor="middle" font-size="9.5" fill="#8e8e93">- - tendencia previa ' + pc(base) + '</text>';
    return '<div class="fe-p"><div class="fe-ph" style="color:' + b.c + '">' + esc(b.lbl) + '<span>YoY GB, móvil 7 días</span></div>' +
      '<svg class="fe-svg" viewBox="0 0 ' + Wd + ' ' + Hd + '">' + g + '</svg></div>';
  }

  // ── Slide ──────────────────────────────────────────────────────────────────────────────────
  function html() {
    var S = series(), end = lastDay(), rows = '', R = {};
    BIZ.forEach(function (b) {
      var s = S[b.k];
      if (!s) { R[b.k] = null; return; }
      var w = WEEKS.map(function (x) { return x[2] <= end ? yoy(s, x[1], x[2], 0) : null; });
      // nivel semanal previo de ESTE año (4 semanas base) vs la semana post 2ª vuelta, en GB y NR
      var P = WEEKS[POST], lvl = function (i) { var bw = sum(s.cy, BASE[0], BASE[1], i) / 4, e = P[2] <= end ? sum(s.cy, P[1], P[2], i) : NaN; return { d: e - bw, p: (e / bw - 1) * 100 }; };
      R[b.k] = { w: w, gb: lvl(0), nr: lvl(1) };
    });
    var EW = { 1: 1, 2: 1, 4: 1, 5: 1 };
    BIZ.forEach(function (b) {
      var r = R[b.k];
      if (!r) { rows += '<tr><td style="color:' + b.c + '">' + esc(b.lbl) + '</td><td colspan="' + (WEEKS.length + 1) + '" class="fe-note">Cargando datos de B2B…</td></tr>'; return; }
      rows += '<tr><td style="color:' + b.c + '">' + esc(b.lbl) + '</td>' + r.w.map(function (x, i) {
        return '<td class="' + (EW[i] ? 'fe-e ' : '') + (x ? cl(x.y) : '') + '">' + (x ? pc(x.y) : '—') + '</td>';
      }).join('') + '<td class="fe-e ' + cl(r.gb.p) + '">' + pc(r.gb.p) + '<small>GB ' + fm(r.gb.d) + ' · NR ' + fm(r.nr.d) + '</small></td></tr>';
    });
    // Conclusión con los datos: qué negocios se apartan de su tendencia en cada vuelta (semana de la elección o la siguiente, −8 pp)
    var hit = function (a, z) { return BIZ.filter(function (b) { var r = R[b.k]; if (!r || !r.w[0]) return false; return [a, z].some(function (i) { return r.w[i] && r.w[i].y - r.w[0].y <= -8; }); }); };
    var h1 = hit(1, 2), h2 = hit(4, 5), names = function (l) {
      var n = l.map(function (b) { return b.lbl.replace(' (control)', '').replace('B2B ', '').replace('WL ', ''); });
      return n.length > 1 ? n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1] : n.join('');
    };
    var nb = function (l) { return l.filter(function (b) { return b.k !== 'b2c'; }); }, inL = function (l, b) { return l.indexOf(b) >= 0; };
    var b1 = nb(h1), b2 = nb(h2), ctrl = h1.concat(h2).some(function (b) { return b.k === 'b2c'; });
    var both = b1.filter(function (b) { return inL(b2, b); }), o1 = b1.filter(function (b) { return !inL(b2, b); }), o2 = b2.filter(function (b) { return !inL(b1, b); });
    var title = 'Elecciones: ' + (both.length
      ? 'ambas vueltas frenan ' + names(both) + (o1.length ? ' (' + names(o1) + ' solo en la 1ª)' : '') + (o2.length ? ' (' + names(o2) + ' solo en la 2ª)' : '')
      : (b1.length ? 'la 1ª vuelta frena ' + names(b1) : 'la 1ª vuelta no se nota') + '; ' + (b2.length ? 'la 2ª, ' + names(b2) : 'la 2ª tampoco')) +
      (ctrl ? '; B2C igual: mercado' : '');
    var f = R.farm, h = R.html;
    var msg = '<b>Cómo leerlo</b><ul>' +
      '<li>La tendencia previa es el YoY de las 4 semanas (lun–dom) antes de la semana de la 1ª vuelta' + (f ? ' (WL Farming ' + pc(f.w[0].y) + (h ? ', HTML ' + pc(h.w[0].y) : '') + ')' : '') + '.</li>' +
      '<li>Cada domingo de elección cierra su semana; la semana siguiente muestra el arrastre.</li>' +
      '<li>Semana post 2ª vuelta contra el <b>nivel semanal previo de este año</b> (sin año pasado): separa la caída propia del efecto base.</li>' +
      '<li>B2C es el control: no está en ramp-up; si cae igual, es mercado y no algo de B2B.</li></ul>';
    var isOrg = fxReady(), cur = isOrg ? 'USD Organic (TC Actuals LY)' : fxState === 'err' ? 'USD nominal (no se pudo leer la tabla de TC)' : 'USD nominal (cargando TC…)';
    var note = 'Daily (fecha de gestión, GD), Brasil, ' + cur + (isOrg ? ': el año actual a TC del año pasado, como el YoY Organic del Daily; vale para toda la slide sin importar el switch' : '') + '. ' +
      'Año pasado = 364 días antes (mismo día de la semana). WL Farming = partners Existing (TBD e ITAU son New y quedan afuera; Itau Card es Existing). ' +
      'Lun 12/10 (Aparecida) cae en día hábil del año pasado: baja ese día en HTML / API sin relación con las elecciones. Datos hasta el ' + ddmm(end) + ' (el último día cargado se excluye por venir parcial).';
    return '<div class="flow-slide"><div class="fl-head"><div class="fl-title flm-t2" title="' + esc(title) + '"><small>Brasil · ventas diarias y las presidenciales (4/10 y 25/10) · ' + (isOrg ? 'USD Organic' : 'USD nominal') + '</small>' + esc(title) + '</div>' +
      '<div class="fl-brand">' + (typeof W.flLogo_ === 'function' ? W.flLogo_() : '') + '</div></div><div class="fl-rule"></div>' +
      '<div class="fl-body fe-body"><div class="fe-panels">' + BIZ.map(function (b) {
        return S[b.k] ? panel(b, S[b.k], end, R[b.k].w[0].y) : '<div class="fe-p"><div class="fe-ph" style="color:' + b.c + '">' + esc(b.lbl) + '</div><div class="fe-wait">Cargando datos de B2B…</div></div>';
      }).join('') + '</div>' +
      '<div class="fe-low"><table class="fe-t"><tr><th>YoY GB por semana (lun–dom)</th>' + WEEKS.map(function (x, i) { return '<th>' + (i ? x[0] : 'Tendencia<br>' + x[0]) + '</th>'; }).join('') +
      '<th>' + WEEKS[POST][0] + ' vs<br>nivel previo</th></tr>' + rows + '</table>' +
      '<div class="fe-msg">' + msg + '</div></div><div class="fe-note">' + esc(note) + '</div></div></div>';
  }

  // daily-flow-minto.js la ubica en el deck y la dibuja (W.FLOW_EXTRA)
  var DEF = { kind: 'br_elecciones', name: 'Brasil · elecciones' };
  W.FLOW_EXTRA = (W.FLOW_EXTRA || []).concat([{ def: DEF, html: function () {
    try { loadFx(); if (!b2bReady() || !fxReady()) watchB2B(); return html(); } catch (e) { return '<div class="flow-slide"><p style="padding:40px">No se pudo armar la slide de elecciones: ' + esc(e.message) + '</p></div>'; }
  } }]);
  // B2B y la tabla de TC llegan después del B2B2C: cuando llegan, se redibuja la slide (como el resumen de daily-flow-minto.js)
  var timer = null;
  function watchB2B() {
    if (timer) return;
    var tries = 0;
    timer = setInterval(function () {
      if (!(b2bReady() && (fxReady() || fxState === 'err')) && tries++ < 80) return;
      clearInterval(timer); timer = null;
      var i = (W.FLOW_DECK || []).findIndex(function (d) { return d.kind === DEF.kind; });
      var fr = i >= 0 && document.querySelector('.flow-frame[data-idx="' + i + '"] .flow-slide');
      if (fr) { try { fr.outerHTML = html(); if (typeof W.flowScale_ === 'function') W.flowScale_(); } catch (e) { console.warn('[daily-flow-elecciones]', e); } }
    }, 1500);
  }
})();
