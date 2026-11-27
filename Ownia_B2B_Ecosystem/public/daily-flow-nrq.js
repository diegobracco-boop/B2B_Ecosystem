/* Flow mensual · B2B2C "Deep dive de NR por trimestre según origen de la cuenta" (2026-11-27, Diego; formato de WLs_Nr_formato).
 * Una slide por cartera: Total, Hispa, Brasil y México / US. La muestra "Slides mensuales" del Hub (public/hub-slides.js) con
 *   <base>/daily?embed=flow&slide=b2b2c_nrq[-SAH|-BR|-NAM]&organic=yes|no&coibr=excl|incl   (public/daily-embed.js)
 * Solo se suma al deck del Flow en ese modo embebido: el Flow semanal no cambia.
 *
 * Tres gráficos (Cuentas existentes / Cuentas nuevas – onboarding / TBD – hunting no logrado) con el NR por trimestre del FY:
 * barra = real (llena) o real + proyección (clara y punteada, el trimestre que tiene meses por venir), línea = Budget. Debajo,
 * por trimestre y FY: Budget, Desvío (real − Budget), YoY del Budget y YoY real (vs NR del FY anterior de las mismas cuentas;
 * "n/a" si no hay base). Título armado con los desvíos del año.
 *   - Segmentos = flSeg_ del Daily (los mismos del Flow y de la slide de YoY por segmento): Existentes = Farming; Nuevas =
 *     Hunting (New con meta en el Budget); TBD = partner TBD del Budget + cuentas New firmadas fuera del plan.
 *   - Real = actuals hasta el último día con datos + Run Rate del Daily después (runrate diario y runrate_fy_rest ene–mar).
 *   - Moneda como el "vs Budget" oficial del Flow (daily-flow-yoy-seg.js): con Organic, actuals a TC Budget (flowRegionRaw_),
 *     Budget tal cual y LY pasado a TC Budget (flGoalFxLY_). Sin Organic, nominal.
 *   - Carteras con getRegion_ del Daily: Hispa = todo lo que no es Brasil, México / USA ni RG, con Other Countries (globales) en
 *     existentes y nuevas pero sin su TBD (el TBD de Hispa es el de AR / CL / PE, como el formato de referencia). El Flow semanal
 *     de Hispa, en cambio, saca Other Countries y el TBD. Por eso Hispa + Brasil + México / US no da exacto el Total en TBD.
 *   - YoY solo en existentes: nuevas y TBD no tienen base del FY anterior que sirva ("n/a", como el formato de referencia).
 * Lógica pura en window.FlowNrq (aggregate, title), probada en test/daily-flow-nrq.test.js.
 */
(function (root) {
  'use strict';

  var SEGS = ['f', 'h', 't'];
  var REGIONS = [
    { k: '', lbl: 'Total' },
    { k: 'SAH', lbl: 'Hispa' },
    { k: 'BR', lbl: 'Brasil' },
    { k: 'NAM', lbl: 'México / US' },
  ];

  // ── Lógica pura ────────────────────────────────────────────────────────
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  // Trimestre del FY (abr = Q1) de 'AAAA-MM-…'; -1 fuera del FY que empieza en fy0
  function qOf(fecha, fy0) {
    var y = +fecha.slice(0, 4), m = +fecha.slice(5, 7);
    var i = (y - fy0) * 12 + (m - 4);
    return i >= 0 && i < 12 ? Math.floor(i / 3) : -1;
  }

  /* src = { act, rr, bud, ly, lyCur } (arreglos de filas): act = actuals (net_revenues, hasta L), rr = Run Rate (net_revenue,
   * solo después de L), bud = Budget (net_revenue), ly = actuals del año anterior (net_revenues, se corren +1 año), lyCur =
   * actuals del año calendario en curso anteriores al FY (también son LY: ene–mar del FY anterior).
   * segOf(r) → 'f' | 'h' | 't'; keep(r) → filtro de cartera; lyFx(pais, fechaCorrida) → factor a TC Budget del LY (1 = nominal).
   * Devuelve { L, fy0, cur (índice del trimestre en curso), seg: {f|h|t: [4 trimestres + FY] de {real, act, rr, bud, ly}} }. */
  function aggregate(src, L, segOf, keep, lyFx) {
    var fy0 = (+L.slice(5, 7) >= 4 ? +L.slice(0, 4) : +L.slice(0, 4) - 1);
    var seg = {};
    SEGS.forEach(function (k) { seg[k] = [0, 1, 2, 3, 4].map(function () { return { real: 0, act: 0, rr: 0, bud: 0, ly: 0 }; }); });
    keep = keep || function () { return true; };
    lyFx = lyFx || function () { return 1; };
    function put(r, fecha, field, v) {
      var q = qOf(fecha, fy0); if (q < 0 || !keep(r)) return;
      var s = seg[segOf(r)]; if (!s) return;
      s[q][field] += v; s[4][field] += v;
    }
    (src.act || []).forEach(function (r) { if (r.fecha > L) return; var v = num(r.net_revenues != null ? r.net_revenues : r.net_revenue); put(r, r.fecha, 'act', v); put(r, r.fecha, 'real', v); });
    (src.rr || []).forEach(function (r) { if (r.fecha <= L) return; var v = num(r.net_revenue); put(r, r.fecha, 'rr', v); put(r, r.fecha, 'real', v); });
    (src.bud || []).forEach(function (r) { put(r, r.fecha, 'bud', num(r.net_revenue)); });
    function addLY(r) {
      var cur = (+r.fecha.slice(0, 4) + 1) + r.fecha.slice(4);
      put(r, cur, 'ly', num(r.net_revenues != null ? r.net_revenues : r.net_revenue) * lyFx(r.pais, cur));
    }
    (src.ly || []).forEach(addLY);
    (src.lyCur || []).forEach(function (r) { if (r.fecha <= L && r.fecha < fy0 + '-04-01') addLY(r); });
    return { L: L, fy0: fy0, cur: qOf(L, fy0), seg: seg };
  }

  // % sin base que sirva (LY < 10% del valor, o 0) → null ("n/a")
  function pct(a, b) { return b > 0 && b >= Math.abs(a) * 0.1 ? (a / b - 1) : null; }

  function m2(v) { return (v / 1e6).toFixed(2).replace('.', ','); }
  function sgn(v, s) { return (v > 0.0005e6 ? '+' : v < -0.0005e6 ? '−' : '') + s; }
  function dM(v) { return sgn(v, m2(Math.abs(v))); }

  // Título: cómo cierra el año cada segmento (desvío FY real + proyección vs Budget)
  function title(A) {
    var d = {}; SEGS.forEach(function (k) { var x = A.seg[k][4]; d[k] = x.real - x.bud; });
    var hasB = function (k) { return Math.abs(A.seg[k][4].bud) > 0 || Math.abs(A.seg[k][4].real) > 0; };
    var neg = [];
    if (hasB('h') && d.h < 0) neg.push('en nuevas cuentas (' + dM(d.h) + ' M)');
    if (hasB('t') && d.t < 0) neg.push('en hunting no logrado (' + dM(d.t) + ' M)');
    var e = d.f >= 0 ? 'Las cuentas existentes cumplen el año (' + dM(d.f) + ' M)' : 'Las cuentas existentes quedan abajo del Budget del año (' + dM(d.f) + ' M)';
    if (neg.length) return e + (d.f >= 0 ? '; el desvío está ' : '; también hay desvío ') + neg.join(' y ');
    var pos = [];
    if (hasB('h')) pos.push('nuevas cuentas (' + dM(d.h) + ' M)');
    if (hasB('t')) pos.push('TBD (' + dM(d.t) + ' M)');
    return e + (pos.length ? '; ' + pos.join(' y ') + ' también ' + (d.f >= 0 ? 'cumplen' : 'quedan arriba') : '');
  }

  root.FlowNrq = { aggregate: aggregate, title: title, qOf: qOf, pct: pct, REGIONS: REGIONS };

  // ── Slide (solo en el Daily embebido) ──────────────────────────────────
  if (typeof document === 'undefined' || !root.location || !/[?&]embed=flow\b/.test(root.location.search)) return;
  var W = root, KIND = 'b2b2c_nrq';
  var SEG_UI = {
    f: { lbl: 'Cuentas existentes', sub: 'NR, M USD', c: '#243063', cp: '#c9cdd8', cpb: '#8a90a6' },
    h: { lbl: 'Cuentas nuevas / onboarding', sub: 'NR, M USD · cuentas nuevas', c: '#3b5bdb', cp: '#cdd8fb', cpb: '#6f88e6' },
    t: { lbl: 'TBD (hunting no logrado)', sub: 'NR, M USD · Budget de partners por firmar', c: '#7a7f93', cp: '#e3e5ec', cpb: '#a4a8b8' },
  };
  var QL = [['Q1', 'abr–jun'], ['Q2', 'jul–sep'], ['Q3', 'oct–dic'], ['Q4', 'ene–mar'], ['FY', 'año']];
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  var css = document.createElement('style');
  css.textContent = [
    '.nq-body{display:flex;flex-direction:column;height:calc(720px - 96px - 30px);gap:6px}',
    '.nq-sub{font-size:12.5px;color:var(--fl-ink3,#6b6b80);margin:-2px 0 2px}',
    '.nq-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;flex:1;min-height:0}',
    '.nq-col{display:flex;flex-direction:column;min-width:0}',
    '.nq-h{font-size:14px;font-weight:800;color:#1d1d2b}.nq-h small{display:block;font-size:10.5px;font-weight:500;color:#8a8a9c;margin-top:1px}',
    '.nq-col svg{display:block;width:100%;height:auto;margin-top:2px}',
    '.nq-t{width:100%;border-collapse:collapse;font-size:10.5px;font-variant-numeric:tabular-nums;margin-top:2px}',
    '.nq-t td{padding:4px 3px;text-align:right;border-top:1px solid #ececf2;white-space:nowrap;color:#4a4a5c}',
    '.nq-t td:first-child{text-align:left;color:#6b6b80}',
    '.nq-t tr.b td{font-weight:800;color:#1d1d2b}.nq-t tr.b td:first-child{color:#1d1d2b}',
    '.nq-t td.fy{border-left:1px solid #ececf2}',
    '.nq-pos{color:#1e8e3e!important}.nq-neg{color:#d93025!important}',
    '.nq-leg{display:flex;gap:22px;font-size:11px;color:#4a4a5c;align-items:center}',
    '.nq-leg i{display:inline-block;width:16px;height:10px;margin-right:6px;vertical-align:-1px}',
    '.nq-foot{font-size:9.5px;color:#8a8a9c;line-height:1.35}',
    '.nq-tag{position:absolute;right:40px;top:6px;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:#a0a0b2}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pcTxt(p) { return p == null ? 'n/a' : (p > 0.0005 ? '+' : p < -0.0005 ? '−' : '') + Math.round(Math.abs(p) * 100) + '%'; }
  function cls(v) { return v > 0.0005e6 ? 'nq-pos' : v < -0.0005e6 ? 'nq-neg' : ''; }

  function keepFor(region) {
    if (!region) return null;
    return function (r) {
      var g = W.getRegion_(r.pais);
      return g === region && !(region === 'SAH' && r.pais === 'Other Countries' && W.flSeg_(r) === 't');
    };
  }

  function data(region) {
    var sub = W.flowRegionRaw_(null);   // con Organic: actuals a TC del Goal del Flow (Budget); trae *_fy_rest
    var base = (W.b2bcRaw_ && W.b2bcRaw_()) || W._rawB2BC;   // LY de ene–mar: actuals nominales
    var fxG = W.flGoalFxLY_('budget');
    var lyFx = function (pais, cur) { if (!fxG) return 1; var f = fxG(pais, cur); return f ? 1 / f : 1; };
    return aggregate({
      act: (sub.actuals || []).concat(sub.actuals_fy_rest || []),
      rr: (sub.runrate || []).concat(sub.runrate_fy_rest || []),
      bud: (sub.budget || []).concat(sub.budget_fy_rest || []),
      ly: (sub.actuals_ly || []).concat(sub.actuals_ly_fy_rest || []),
      lyCur: base.actuals,
    }, W._rawB2BC.meta.last_actuals_date, W.flSeg_, keepFor(region), lyFx);
  }

  // Gráfico de un segmento: 4 barras (Q1–Q4) + línea de Budget; sombreado en los trimestres con proyección
  function chart(A, k) {
    var ui = SEG_UI[k], q = A.seg[k].slice(0, 4), Wd = 380, Hd = 290, l = 34, r = 8, t = 18, b = 22;
    var max = 0; q.forEach(function (x) { max = Math.max(max, x.real, x.bud); });
    var step = niceStep(max / 3), top = Math.max(step * 3, step * Math.ceil(max / step)) || 1;
    var ph = Hd - t - b, pw = Wd - l - r, cw = pw / 4, bw = cw * 0.52;
    function y(v) { return t + ph - Math.max(0, v) / top * ph; }
    var s = '<svg viewBox="0 0 ' + Wd + ' ' + Hd + '" xmlns="http://www.w3.org/2000/svg" font-family="Poppins,sans-serif">';
    if (A.cur >= 0 && A.cur < 4) {
      var x0 = l + A.cur * cw;
      s += '<rect x="' + x0 + '" y="' + (t - 4) + '" width="' + (pw - A.cur * cw) + '" height="' + (ph + 4) + '" fill="#f1f2f6"/>' +
        '<text x="' + (x0 + (pw - A.cur * cw) / 2) + '" y="' + (t - 7) + '" font-size="8.5" fill="#8a8a9c" text-anchor="middle">con proyección</text>';
    }
    for (var i = 0; i <= 3; i++) {
      var v = step * i; if (v > top + 1e-9) break;
      s += '<line x1="' + l + '" x2="' + (Wd - r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#ececf2"/>' +
        '<text x="' + (l - 5) + '" y="' + (y(v) + 3) + '" font-size="8.5" fill="#8a8a9c" text-anchor="end">' + (v / 1e6).toFixed(2).replace('.', ',') + '</text>';
    }
    var pts = [];
    q.forEach(function (x, i) {
      var cx = l + cw * i + cw / 2, proj = A.cur >= 0 && i >= A.cur, h = Math.max(0, x.real) / top * ph;
      if (h > 0) s += '<rect x="' + (cx - bw / 2) + '" y="' + y(x.real) + '" width="' + bw + '" height="' + h + '" fill="' + (proj ? ui.cp : ui.c) + '"' +
        (proj ? ' stroke="' + ui.cpb + '" stroke-dasharray="3 2"' : '') + '/>';
      var lblIn = h > 16;
      s += '<text x="' + cx + '" y="' + (lblIn ? t + ph - 6 : y(x.real) - 4) + '" font-size="9.5" font-weight="700" text-anchor="middle" fill="' + (lblIn && !proj ? '#fff' : '#1d1d2b') + '">' + (Math.abs(x.real) < 5e3 ? '0' : m2(x.real)) + '</text>';
      pts.push([cx, y(x.bud)]);
    });
    s += '<polyline points="' + pts.map(function (p) { return p.join(','); }).join(' ') + '" fill="none" stroke="#1d1d2b" stroke-width="2"/>';
    pts.forEach(function (p) { s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.6" fill="#fff" stroke="#1d1d2b" stroke-width="1.8"/>'; });
    s += '<line x1="' + l + '" x2="' + (Wd - r) + '" y1="' + (t + ph) + '" y2="' + (t + ph) + '" stroke="#b8b8c6"/>';
    return s + '</svg>';
  }
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  function table(A, k) {
    var q = A.seg[k];
    var head = '<tr><td></td>' + QL.map(function (x, i) { return '<td' + (i === 4 ? ' class="fy"' : '') + ' style="color:#1d1d2b;font-weight:800">' + x[0] + '<br><span style="font-weight:400;color:#8a8a9c;font-size:9px">' + x[1] + '</span></td>'; }).join('') + '</tr>';
    function row(lbl, f, bold) { return '<tr' + (bold ? ' class="b"' : '') + '><td>' + lbl + '</td>' + q.map(function (x, i) { var c = f(x); return '<td class="' + (i === 4 ? 'fy ' : '') + (c[1] || '') + '">' + c[0] + '</td>'; }).join('') + '</tr>'; }
    return '<table class="nq-t">' + head +
      row('Budget (M)', function (x) { return [m2(x.bud)]; }) +
      row('Desvío (M)', function (x) { var d = x.real - x.bud; return [Math.abs(x.bud) < 5e3 && Math.abs(x.real) < 5e3 ? '–' : dM(d), cls(d)]; }, true) +
      row('YoY budget', function (x) { return [k === 'f' ? pcTxt(pct(x.bud, x.ly)) : 'n/a']; }) +
      row('YoY real', function (x) { return [k === 'f' ? pcTxt(pct(x.real, x.ly)) : 'n/a']; }, true) +
      '</table>';
  }

  function dd(f) { return +f.slice(8, 10) + ' ' + MES[+f.slice(5, 7) - 1]; }

  function html(def) {
    var reg = REGIONS.filter(function (x) { return x.k === (def.region || ''); })[0] || REGIONS[0];
    var A = data(def.region || ''), L = A.L;
    var org = typeof W._orgTargetFlow_ === 'function' && W._orgTargetFlow_() === 'budget';
    var cols = SEGS.map(function (k) {
      return '<div class="nq-col"><div class="nq-h" style="color:' + (k === 'h' ? SEG_UI.h.c : '#1d1d2b') + '">' + SEG_UI[k].lbl + '<small>' + SEG_UI[k].sub + (k === 'f' ? '' : ' · sin base FY anterior, no hay YoY') + '</small></div>' + chart(A, k) + table(A, k) + '</div>';
    }).join('');
    var legend = '<div class="nq-leg"><span><i style="background:' + SEG_UI.f.c + '"></i>Real (barra llena)</span>' +
      '<span><i style="background:' + SEG_UI.f.cp + ';outline:1px dashed ' + SEG_UI.f.cpb + '"></i>Proyectado (barra punteada)</span>' +
      '<span><i style="height:2px;background:#1d1d2b"></i>Budget</span></div>';
    var foot = '<div class="nq-foot">NR en USD' + (org ? ' (Organic: real a TC Budget, LY a TC Budget)' : '') + '. Real = abr → ' + dd(L) + '; proyectado = Run Rate del Daily (' + dd(nextDay(L)) + ' → mar); ' +
      'Q' + (A.cur + 1) + ' incluye real hasta el ' + dd(L) + '. YoY vs NR real del FY anterior de las mismas cuentas ("n/a" sin base). Escala del eje Y distinta en cada gráfico. ' +
      'Existentes = cuentas de la cartera; Nuevas = cuentas nuevas con meta en el Budget; TBD = Budget sin partners asignados + cuentas nuevas firmadas fuera del plan.' +
      (def.region === 'SAH' ? ' Hispa incluye Other Countries (globales) salvo su TBD.' : '') + '</div>';
    var t = title(A);
    return '<div class="flow-slide" style="position:relative"><div class="nq-tag">cartera ' + esc(reg.lbl) + ' B2B2C</div>' +
      '<div class="fl-head"><div class="fl-title" title="' + esc(t) + '" style="font-size:22px;line-height:1.25;max-width:1080px;white-space:normal">' + esc(t) + '</div>' +
      '<div class="fl-brand">' + W.flLogo_() + '</div></div><div class="fl-rule"></div>' +
      '<div class="fl-body nq-body"><div class="nq-sub">Deep dive de NR · ' + esc(reg.lbl) + ': real / proyectado vs Budget por trimestre, según origen de la cuenta, M USD</div>' +
      '<div class="nq-cols">' + cols + '</div>' + legend + foot + '</div></div>';
  }
  function nextDay(f) { var p = f.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1)).toISOString().slice(0, 10); }

  // Las cuatro slides al final del deck (solo en este modo; daily-embed.js las busca por kind-region en su DOMContentLoaded,
  // por eso esta capa se carga antes que daily-embed.js en modules.js)
  function addSlides() {
    if (!Array.isArray(W.FLOW_DECK) || W.FLOW_DECK.some(function (d) { return d.kind === KIND; })) return;
    REGIONS.forEach(function (x) { W.FLOW_DECK.push({ kind: KIND, region: x.k || undefined, name: 'B2B2C — NR por trimestre · ' + x.lbl }); });
  }
  function hook() {
    var orig = W.flowBuildSlide_;
    if (typeof orig !== 'function' || orig._nrq) return;
    var wrapped = function (def, idx) {
      if (!def || def.kind !== KIND) return orig.apply(this, arguments);
      if (W._flowSeries) W._flowSeries[idx] = [];
      try { return html(def); } catch (e) { console.warn('[daily-flow-nrq]', e); return '<div class="flow-slide"><p style="padding:40px">No se pudo armar la slide de NR por trimestre: ' + esc(e.message) + '</p></div>'; }
    };
    wrapped._nrq = true;
    W.flowBuildSlide_ = wrapped;
  }
  document.addEventListener('DOMContentLoaded', function () { addSlides(); hook(); });
})(typeof window !== 'undefined' ? window : this);
