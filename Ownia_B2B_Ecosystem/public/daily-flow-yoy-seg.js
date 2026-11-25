/* Flow semanal · B2B2C "Crecimiento YoY por segmento: Existentes vs Onboarding vs TBD" (2026-11-25). Solo en <base>/daily?flowdeck=1.
 *
 * Mismo formato que la portada OC (cover_oc de Daily_Dashboard/dashboard.html: barras abiertas en Farming / Hunting / TBD +
 * tablas por segmento con dos períodos lado a lado), pero contra LY y con NR y FVM (gestional, sin OC). La idea de la slide:
 * las cuentas existentes crecen YoY y el déficit de crecimiento está en Onboarding y TBD.
 *   - Segmentos = flSeg_ (Existentes = Farming: Existing según la cartera vigente; Onboarding = Hunting: New con meta en el
 *     Budget; TBD = partner TBD del Budget + cuentas New firmadas fuera del plan). El mismo partner cae en el mismo segmento
 *     los dos años, así Existentes compara las mismas cuentas.
 *   - Gráficos: flowFY12_ con Goal = LY (barra gris = LY del mes; tono claro = proyección Run Rate). Debajo: YoY total y YoY
 *     Existentes.
 *   - Tablas: H1 y H2 (Act+Proy) del FY. Real = actual (Organic: _yv_, a TC Actuals LY, como el YoY del resto del deck) +
 *     proyección Run Rate. Crecimiento Budget = Budget − LY (Organic: Budget a TC Actuals LY, flGoalFxLY_, como "YoY Bud" de
 *     las slides de región). Gap = crecimiento real − crecimiento Budget (= Real − Budget). Meses sin LY entero quedan afuera.
 *   - Lectura armada con los números: crecimiento de Existentes y cuánto del gap explican Onboarding y TBD, con los partners
 *     Onboarding más atrasados en H2.
 * La ubica daily-flow-minto.js (W.FLOW_EXTRA con at:'cover', después de daily-flow-yoy.js). No pide datos.
 */
(function () {
  'use strict';
  if (!/[?&]flowdeck=1(&|$)/.test(location.search)) return;
  var W = window, MK = ['nr', 'fvm'], SEGS = ['f', 'h', 't'];
  var LBL = { f: 'Existentes (Farming)', h: 'Onboarding (Hunting)', t: 'TBD' };

  var css = document.createElement('style');
  css.textContent = [
    '.fl-body.ys-body{display:flex;gap:16px;height:calc(720px - 96px - 30px)}',
    '.ys-left{flex:1.25;min-width:0;display:flex;flex-direction:column;gap:6px;min-height:0}',
    '.ys-right{flex:2;min-width:0;display:flex;flex-direction:column;gap:6px;min-height:0}',
    '.ys-row{flex:1;min-height:0;display:flex;flex-direction:column}',
    '.ys-tbl{width:100%;border-collapse:collapse;font-size:10.5px}',
    '.ys-tbl th{background:#550fed;color:#fff;font-weight:700;padding:3px 5px;text-align:right;white-space:nowrap}',
    '.ys-tbl th:first-child,.ys-tbl td:first-child{text-align:left}',
    '.ys-tbl td{padding:3px 5px;text-align:right;border-bottom:1px solid var(--fl-line);white-space:nowrap}',
    '.ys-tbl .ys-sep{border-left:2px solid #d9d2fb}',
    '.ys-tbl tr.tot td{font-weight:800;border-top:1.5px solid #550fed;background:#f6f3ff}',
    '.ys-tbl .ys-sub th{background:#ece6ff;color:#3d2a8a;font-size:9.5px}',
    '.ys-pos{color:var(--fl-green);font-weight:700}.ys-neg{color:var(--fl-red);font-weight:700}',
    '.ys-sw{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}',
    '.ys-notes{font-size:11.5px;line-height:1.4;color:var(--fl-ink2);border-top:1px solid var(--fl-line);padding-top:6px}',
    '.ys-notes p{margin:0 0 5px}.ys-notes b{color:#3d2a8a}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // Sin base LY que sirva (cuentas nuevas: LY < 10% del real) el % no dice nada → "nuevo"
  function pct(a, b) { return b > 0 && b >= Math.abs(a) * 0.1 ? (a / b - 1) * 100 : null; }
  function pcN(a, b) { var p = pct(a, b); return p == null && a ? 'nuevo' : pc(p); }
  function pc(v) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0).replace('.', ',') + '%'; }
  function money(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + W.fmtShort(Math.abs(v)); }
  function cls(v) { return v == null || !isFinite(v) ? '' : v >= 0 ? 'ys-pos' : 'ys-neg'; }
  function segColor(k) { var g = W.FL_SEG_.filter(function (x) { return x.k === k; })[0]; return g ? g.c : '#999'; }

  // Por métrica: serie del gráfico (flowFY12_ vs LY + yoyF) y, por período, {seg: {real, ly, bud}} y Onboarding por partner
  function build(mk) {
    var sub = W.flowRegionRaw_(null), L = W._rawB2BC.meta.last_actuals_date, fy0 = +W.flFyStart_(L).slice(0, 4);
    var MF = W._FLMF[mk], BF = W._FLBMF[mk], fy = W.flowFY12_(sub, mk, 'ly'), fxG = W.flGoalFxLY_('budget');
    var ok = {}; fy.forEach(function (d) { if (d.bud != null) ok[d.date.slice(0, 7)] = 1; });   // meses con LY entero
    var R = {}, LY = {}, B = {}, PR = {};   // R/LY/B[seg][mes]; PR[partner Onboarding][mes] = {r, b}
    SEGS.forEach(function (k) { R[k] = {}; LY[k] = {}; B[k] = {}; });
    function add(o, m, v) { if (ok[m]) o[m] = (o[m] || 0) + (v || 0); }
    function addP(r, m, f, v) { if (!ok[m] || W.flSeg_(r) !== 'h') return; var p = r.partner, x = PR[p] = PR[p] || {}; x[m] = x[m] || { r: 0, b: 0 }; x[m][f] += v || 0; }
    (sub.actuals || []).concat(sub.actuals_fy_rest || []).forEach(function (r) {
      if (r.fecha > L) return; var m = r.fecha.slice(0, 7), v = W._yv_(r, MF); add(R[W.flSeg_(r)], m, v); addP(r, m, 'r', v);
    });
    (sub.runrate || []).concat(sub.runrate_fy_rest || []).forEach(function (r) {
      if (r.fecha <= L) return; var m = r.fecha.slice(0, 7); add(R[W.flSeg_(r)], m, r[BF]); addP(r, m, 'r', r[BF]);
    });
    // LY como flowFY12_: actuals_ly + actuals_ly_fy_rest + ene–mar del año calendario en curso, corridos +1 año (nominal)
    function addLY(r) { add(LY[W.flSeg_(r)], (+r.fecha.slice(0, 4) + 1) + r.fecha.slice(4, 7), r[MF]); }
    (sub.actuals_ly || []).concat(sub.actuals_ly_fy_rest || []).forEach(addLY);
    ((W.b2bcRaw_ && W.b2bcRaw_()) || W._rawB2BC).actuals.forEach(function (r) { if (r.fecha <= L && r.fecha < fy0 + '-04-01') addLY(r); });
    (sub.budget || []).concat(sub.budget_fy_rest || []).forEach(function (r) {
      var m = r.fecha.slice(0, 7), g = (r[BF] || 0) * (fxG ? fxG(r.pais, r.fecha) : 1); add(B[W.flSeg_(r)], m, g); addP(r, m, 'b', g);
    });
    fy.forEach(function (d) {
      var m = d.date.slice(0, 7);
      d.yoyF = d.yoy != null && LY.f[m] ? (R.f[m] || 0) / LY.f[m] * 100 - 100 : null;
    });
    var cur = L.slice(0, 7);
    function period(ms) {
      var o = {}, n = 0, proj = false;
      SEGS.forEach(function (k) { o[k] = { real: 0, ly: 0, bud: 0 }; });
      ms.forEach(function (m) { if (!ok[m]) return; n++; if (m >= cur) proj = true;
        SEGS.forEach(function (k) { o[k].real += R[k][m] || 0; o[k].ly += LY[k][m] || 0; o[k].bud += B[k][m] || 0; }); });
      var parts = Object.keys(PR).map(function (p) { var x = { p: p, r: 0, b: 0 }; ms.forEach(function (m) { var y = PR[p][m]; if (y) { x.r += y.r; x.b += y.b; } }); x.gap = x.r - x.b; return x; });
      return { seg: o, n: n, proj: proj, parts: parts };
    }
    var ms = fy.map(function (d) { return d.date.slice(0, 7); });
    return { fy: fy, h1: period(ms.slice(0, 6)), h2: period(ms.slice(6)) };
  }

  function sum(per) { var t = { real: 0, ly: 0, bud: 0 }; SEGS.forEach(function (k) { var x = per.seg[k]; t.real += x.real; t.ly += x.ly; t.bud += x.bud; }); return t; }

  // Por período: Real | Δ YoY $ | YoY % | Δ Bud $ (crecimiento que asumía el Budget) | Gap $
  function table(tag, pers) {
    var head = '<tr><th rowspan="2" style="vertical-align:bottom">' + esc(tag) + '</th>' + pers.map(function (p) {
      return '<th colspan="5" class="ys-sep" style="text-align:center">' + esc(p.lbl) + '</th>'; }).join('') + '</tr>' +
      '<tr class="ys-sub">' + pers.map(function () { return '<th class="ys-sep">Real</th><th>Δ YoY</th><th>YoY %</th><th>Δ YoY Bud</th><th>Gap</th>'; }).join('') + '</tr>';
    function cells(x) {
      var d = x.real - x.ly, db = x.bud - x.ly, g = x.real - x.bud;
      return '<td class="ys-sep">' + W.fmtShort(x.real) + '</td><td class="' + cls(d) + '">' + money(d) + '</td><td class="' + cls(pct(x.real, x.ly)) + '">' + pcN(x.real, x.ly) + '</td>' +
        '<td>' + money(db) + '</td><td class="' + cls(g) + '">' + money(g) + '</td>';
    }
    var body = SEGS.map(function (k) {
      return '<tr><td><i class="ys-sw" style="background:' + segColor(k) + '"></i>' + LBL[k] + '</td>' + pers.map(function (p) { return cells(p.d.seg[k]); }).join('') + '</tr>';
    }).join('') + '<tr class="tot"><td>Total</td>' + pers.map(function (p) { return cells(sum(p.d)); }).join('') + '</tr>';
    return '<div><div class="fl-tag">' + esc(tag) + ' · crecimiento YoY vs el que asumía el Budget</div><table class="ys-tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function notes(S, fyL) {
    var n = S.nr, h1 = n.h1.seg, h2 = n.h2.seg, f1 = h1.f, f2 = h2.f;
    var gapHT = (h2.h.real - h2.h.bud) + (h2.t.real - h2.t.bud), gapF = f2.real - f2.bud, tot2 = sum(n.h2);
    var out = [];
    out.push('<p><b>Existentes crecen:</b> NR ' + pc(pct(f1.real, f1.ly)) + ' YoY en H1 (' + money(f1.real - f1.ly) + ') y ' + pc(pct(f2.real, f2.ly)) +
      ' en H2 Act+Proy (' + money(f2.real - f2.ly) + '); ' + (gapF >= 0 ? 'por encima' : 'por debajo') + ' del crecimiento que asumía el Budget (' + money(gapF) + ' en H2). ' +
      'FVM Existentes ' + pc(pct(S.fvm.h2.seg.f.real, S.fvm.h2.seg.f.ly)) + ' YoY en H2.</p>');
    out.push('<p><b>El déficit está en Onboarding y TBD:</b> en H2 aportan ' + money((h2.h.real - h2.h.ly) + (h2.t.real - h2.t.ly)) + ' de crecimiento contra ' +
      money((h2.h.bud - h2.h.ly) + (h2.t.bud - h2.t.ly)) + ' que asumía el Budget: gap ' + money(gapHT) + ' (Onboarding ' + money(h2.h.real - h2.h.bud) + ', TBD ' + money(h2.t.real - h2.t.bud) +
      '), que Existentes compensan en parte (' + money(gapF) + '). Total H2 ' + money(tot2.real - tot2.bud) + ' vs Budget.</p>');
    var lag = n.h2.parts.filter(function (x) { return x.gap < 0; }).sort(function (a, b) { return a.gap - b.gap; }).slice(0, 5);
    if (lag.length) out.push('<p><b>Onboarding más atrasado en H2</b> (NR real vs Budget): ' + lag.map(function (x) { return esc(x.p) + ' ' + money(x.gap); }).join(', ') + '.</p>');
    out.push('<p style="color:var(--fl-ink3);font-size:10px">Real = actual + proyección Run Rate. Δ YoY Bud = Budget − LY. Gap = Real − Budget. Existentes = mismas cuentas los dos años (cartera vigente). ' + fyL + ', meses con LY completo.</p>');
    return '<div class="ys-notes">' + out.join('') + '</div>';
  }

  function html(idx) {
    var S = {}; MK.forEach(function (mk) { S[mk] = build(mk); });
    var fyL = W.flFyLbl_(W._rawB2BC.meta.last_actuals_date), n2 = S.nr.h2.seg;
    var hLbl = function (h, d) { return h + ' ' + fyL + (d.proj ? ' (Act+Proy)' : ''); };
    var title = fyL + ' WLs | Existentes crecen ' + pc(pct(n2.f.real, n2.f.ly)) + ' YoY en H2; el déficit de crecimiento está en Onboarding y TBD';
    var kick = 'B2B2C — NR y FVM: crecimiento YoY por segmento (Existentes / Onboarding / TBD)';
    var legend = '<div class="fl-legend">' + W.FL_SEG_.map(function (g) { return '<span><i style="background:' + g.c + '"></i>' + LBL[g.k].replace(/ \(.*/, '') + '</span>'; }).join('') +
      '<span><i style="background:#c9c9d6"></i>LY</span><span style="font-style:italic">tono claro = proyección (Run Rate)</span></div>';
    var charts = MK.map(function (mk) {
      var cid = 'flc' + idx + '-yseg-' + mk;
      W._flowSeries[idx].push({ id: cid, series: S[mk].fy, gran: 'monthly',
        opts: { labels: true, yoy: true, stackProj: true, split: true, yoyRows: [{ lbl: 'Exist.', key: 'yoyF', colored: true }] } });
      return '<div class="ys-row"><div class="fl-chart-title">' + W.FLOW_MET[mk].label + ', en $</div>' + legend +
        '<div class="fl-canvas-wrap" style="flex:1;min-width:0;min-height:0"><canvas id="' + cid + '"></canvas></div></div>';
    }).join('');
    var tables = MK.map(function (mk) {
      return table(mk === 'nr' ? 'NR' : 'FVM', [{ lbl: hLbl('H1', S[mk].h1), d: S[mk].h1 }, { lbl: hLbl('H2', S[mk].h2), d: S[mk].h2 }]);
    }).join('');
    return '<div class="flow-slide"><div class="fl-head"><div class="fl-title flm-t2" title="' + esc(title) + '"><small>' + esc(kick) + '</small>' + esc(title) + '</div>' +
      '<div class="fl-brand">' + W.flLogo_() + '</div></div><div class="fl-rule"></div>' +
      '<div class="fl-body ys-body"><div class="ys-left">' + charts + '</div><div class="ys-right">' + tables + notes(S, fyL) + '</div></div></div>';
  }

  var def = { kind: 'b2b2c_yoy_seg', name: 'B2B2C — Crecimiento YoY por segmento' };
  W.FLOW_EXTRA = (W.FLOW_EXTRA || []).concat([{ def: def, at: 'cover', html: function (idx) {
    try { return html(idx); } catch (e) { console.warn('[daily-flow-yoy-seg]', e); return '<div class="flow-slide"><p style="padding:40px">No se pudo armar la slide de YoY por segmento: ' + esc(e.message) + '</p></div>'; }
  } }]);
})();
