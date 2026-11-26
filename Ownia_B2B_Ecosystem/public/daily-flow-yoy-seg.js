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
 *   - Tablas: YTD (abril al último día con datos vs los mismos días del LY, sin proyección) y H2 (Act+Proy). Todo Organic a
 *     TC Budget (2026-11-26: antes iba a TC Actuals LY y el Budget convertido inflaba el gap, NR H2 −10,2M vs −7,0M oficial):
 *     Real = actuals del Flow + Run Rate, Budget tal cual, LY / flGoalFxLY_. Gap = Real − Budget = el oficial del Flow (check()
 *     lo controla contra flowSegData_ / flowH2SegData_). Crecimiento Budget = Budget − LY. Meses sin LY entero quedan afuera.
 *   - TBD = partner TBD del Budget (lugar para partners por firmar: no tiene actuals) + cuentas New firmadas sin meta. Su real
 *     a la fecha es chico por construcción; lo que suma en H2 Act+Proy es el TBD que el Run Rate proyecta.
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
    '.ys-notes{font-size:11px;line-height:1.35;color:var(--fl-ink2);border-top:1px solid var(--fl-line);padding-top:6px}',
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
  // Organic: TODO a la misma moneda que el "vs Budget" oficial del Flow (con Organic YES y Goal Budget, actuals a TC Budget).
  // Real = actuals del Flow (flowRegionRaw_, ya convertidos) + Run Rate; Budget tal cual; LY (nominal en el JSON) pasado a TC
  // Budget del mes equivalente: LY × TC Actuals LY / TC Budget = LY / flGoalFxLY_. Así Real − Budget da el gap oficial y el
  // YoY es a moneda constante (TC Budget en los dos años). Sin Organic (fxG null) todo queda nominal.
  function lyFx(fxG, pais, fechaCur) { if (!fxG) return 1; var f = fxG(pais, fechaCur); return f ? 1 / f : 1; }
  function build(mk) {
    var sub = W.flowRegionRaw_(null), L = W._rawB2BC.meta.last_actuals_date, fy0 = +W.flFyStart_(L).slice(0, 4);
    var MF = W._FLMF[mk], BF = W._FLBMF[mk], fy = W.flowFY12_(sub, mk, 'ly'), fxG = W.flGoalFxLY_('budget');
    var ok = {}; fy.forEach(function (d) { if (d.bud != null) ok[d.date.slice(0, 7)] = 1; });   // meses con LY entero
    var R = {}, RA = {}, LY = {}, B = {}, BA = {}, PR = {};   // R/LY/B[seg][mes]; RA / BA: real y Budget hasta el último día con datos; PR[partner Onboarding][mes] = {r, b}
    SEGS.forEach(function (k) { R[k] = {}; RA[k] = {}; LY[k] = {}; B[k] = {}; BA[k] = {}; });
    function add(o, m, v) { if (ok[m]) o[m] = (o[m] || 0) + (v || 0); }
    function addP(r, m, f, v) { if (!ok[m] || W.flSeg_(r) !== 'h') return; var p = r.partner, x = PR[p] = PR[p] || {}; x[m] = x[m] || { r: 0, b: 0 }; x[m][f] += v || 0; }
    (sub.actuals || []).concat(sub.actuals_fy_rest || []).forEach(function (r) {
      if (r.fecha > L) return; var m = r.fecha.slice(0, 7), v = r[MF] || 0; add(R[W.flSeg_(r)], m, v); add(RA[W.flSeg_(r)], m, v); addP(r, m, 'r', v);
    });
    (sub.runrate || []).concat(sub.runrate_fy_rest || []).forEach(function (r) {
      if (r.fecha <= L) return; var m = r.fecha.slice(0, 7); add(R[W.flSeg_(r)], m, r[BF]); addP(r, m, 'r', r[BF]);
    });
    // LY como flowFY12_: actuals_ly + actuals_ly_fy_rest + ene–mar del año calendario en curso, corridos +1 año, a TC Budget
    function addLY(r) { var cur = (+r.fecha.slice(0, 4) + 1) + r.fecha.slice(4); add(LY[W.flSeg_(r)], cur.slice(0, 7), (r[MF] || 0) * lyFx(fxG, r.pais, cur)); }
    (sub.actuals_ly || []).concat(sub.actuals_ly_fy_rest || []).forEach(addLY);
    ((W.b2bcRaw_ && W.b2bcRaw_()) || W._rawB2BC).actuals.forEach(function (r) { if (r.fecha <= L && r.fecha < fy0 + '-04-01') addLY(r); });
    (sub.budget || []).concat(sub.budget_fy_rest || []).forEach(function (r) {
      var m = r.fecha.slice(0, 7), g = r[BF] || 0; add(B[W.flSeg_(r)], m, g); if (r.fecha <= L) add(BA[W.flSeg_(r)], m, g); addP(r, m, 'b', g);
    });
    // Gráfico en la misma moneda que las tablas: barra gris = LY a TC Budget, YoY y YoY Existentes contra ese LY
    fy.forEach(function (d) {
      var m = d.date.slice(0, 7); if (!ok[m]) { d.yoy = null; d.yoyF = null; return; }
      var ly = 0, re = 0; SEGS.forEach(function (k) { ly += LY[k][m] || 0; re += R[k][m] || 0; });
      d.bud = Math.round(ly * 100) / 100;
      d.yoy = ly ? re / ly * 100 - 100 : null;
      d.yoyF = LY.f[m] ? (R.f[m] || 0) / LY.f[m] * 100 - 100 : null;
    });
    var cur = L.slice(0, 7);
    function period(ms) {
      var o = {}, n = 0, proj = false;
      SEGS.forEach(function (k) { o[k] = { real: 0, act: 0, ly: 0, bud: 0, budAct: 0 }; });
      ms.forEach(function (m) { if (!ok[m]) return; n++; if (m >= cur) proj = true;
        SEGS.forEach(function (k) { o[k].real += R[k][m] || 0; o[k].act += RA[k][m] || 0; o[k].budAct += BA[k][m] || 0; o[k].ly += LY[k][m] || 0; o[k].bud += B[k][m] || 0; }); });
      var parts = Object.keys(PR).map(function (p) { var x = { p: p, r: 0, b: 0 }; ms.forEach(function (m) { var y = PR[p][m]; if (y) { x.r += y.r; x.b += y.b; } }); x.gap = x.r - x.b; return x; });
      return { seg: o, n: n, proj: proj, parts: parts };
    }
    var ms = fy.map(function (d) { return d.date.slice(0, 7); });
    return { fy: fy, ytd: ytd(sub, mk, L, fxG), h2: period(ms.slice(6)) };
  }

  // YTD: abril → último día con actuals, contra los MISMOS días del LY (actuals_ly diario) y el Budget de esos días.
  // A diferencia de H2 no lleva proyección: es lo que ya pasó. lyOk = false si el LY diario no llega a cubrir el período.
  function ytd(sub, mk, L, fxG) {
    var MF = W._FLMF[mk], BF = W._FLBMF[mk], from = W.flFyStart_(L), lyFrom = W._flLY_(from), lyTo = W._flLY_(L), lyMax = '';
    var o = {}, PR = {};
    SEGS.forEach(function (k) { o[k] = { real: 0, ly: 0, bud: 0 }; });
    function addP(r, f, v) { if (W.flSeg_(r) !== 'h') return; var x = PR[r.partner] = PR[r.partner] || { p: r.partner, r: 0, b: 0 }; x[f] += v || 0; }
    (sub.actuals || []).forEach(function (r) { if (r.fecha < from || r.fecha > L) return; var v = r[MF] || 0; o[W.flSeg_(r)].real += v; addP(r, 'r', v); });
    (sub.actuals_ly || []).forEach(function (r) { if (r.fecha > lyMax) lyMax = r.fecha; if (r.fecha < lyFrom || r.fecha > lyTo) return;
      o[W.flSeg_(r)].ly += (r[MF] || 0) * lyFx(fxG, r.pais, (+r.fecha.slice(0, 4) + 1) + r.fecha.slice(4)); });
    (sub.budget || []).concat(sub.budget_fy_rest || []).forEach(function (r) {
      if (r.fecha < from || r.fecha > L) return; var g = r[BF] || 0; o[W.flSeg_(r)].bud += g; addP(r, 'b', g);
    });
    var parts = Object.keys(PR).map(function (p) { var x = PR[p]; x.gap = x.r - x.b; return x; });
    return { seg: o, n: 1, proj: false, parts: parts, lyOk: lyMax >= lyTo, to: L };
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

  function dLbl(d) { return +d.slice(8, 10) + ' ' + MES[+d.slice(5, 7) - 1]; }
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function yy(x) { return pct(x.real, x.ly); }
  function mg(f, n) { return n ? f / n * 100 : null; }   // margen FVM / NR
  function pp(v) { return v == null ? '—' : v.toFixed(1).replace('.', ',') + '%'; }
  // NR: "en línea" si el YoY de H2 se mueve hasta 10pp contra el YTD (el mismo criterio en título y lectura)
  function nrRitmo(a, b) { var r = ritmo(a, b, 10); return r === 'sostiene' ? 'creciendo en línea' : r === 'acelera' ? 'acelerando' : 'desacelerando'; }
  function ritmo(a, b, dif) { return b - a > dif ? 'acelera' : a - b > dif ? 'desacelera' : 'sostiene'; }

  // Lectura en tres bloques: FVM de Existentes (por qué acelera: margen FVM/NR), NR de Existentes (en línea), y dónde está el gap vs Budget
  function notes(S, fyL, ytdLbl) {
    var nY = S.nr.ytd.seg, nH = S.nr.h2.seg, fY = S.fvm.ytd.seg, fH = S.fvm.h2.seg, out = [];
    var mY = mg(fY.f.real, nY.f.real), mH = mg(fH.f.real, nH.f.real), mL = mg(fH.f.ly, nH.f.ly);
    out.push('<p><b>FVM de Existentes ' + ritmo(yy(fY.f), yy(fH.f), 5) + ':</b> ' + pc(yy(fY.f)) + ' YoY ' + ytdLbl + ' (' + money(fY.f.real - fY.f.ly) + ') → ' + pc(yy(fH.f)) +
      ' en H2 Act+Proy (' + money(fH.f.real - fH.f.ly) + '). Crece más que el NR porque mejora el margen: FVM / NR de Existentes ' + pp(mY) + ' ' + ytdLbl + ' y ' + pp(mH) +
      ' en H2, contra ' + pp(mL) + ' en el H2 del LY.</p>');
    out.push('<p><b>NR de Existentes ' + nrRitmo(yy(nY.f), yy(nH.f)) + ':</b> ' + pc(yy(nY.f)) + ' ' + ytdLbl + ' → ' + pc(yy(nH.f)) + ' en H2, ' + money(nH.f.real - nH.f.bud) + ' vs el crecimiento del Budget en H2 (' +
      pc(yy(nH.f)) + ' real vs ' + pc(pct(nH.f.bud, nH.f.ly)) + ' Budget).</p>');
    var tH = sum(S.nr.h2), gT = nH.t.real - nH.t.bud, gH = nH.h.real - nH.h.bud;
    out.push('<p><b>El gap de NR vs Budget en H2 (' + money(tH.real - tH.bud) + ') está en las cuentas nuevas:</b> TBD ' + money(gT) + ' (Budget de partners por firmar ' + W.fmtShort(nH.t.bud) + '; real a la fecha ' + W.fmtShort(nH.t.act) +
      ' y ' + W.fmtShort(nH.t.real - nH.t.act) + ' proyectado por el Run Rate) y Onboarding ' + money(gH) + ' (crece ' + money(nH.h.real - nH.h.ly) + ' vs ' + money(nH.h.bud - nH.h.ly) + ' esperado).</p>');
    // Cómo se arma el gap de H2: lo que ya pasó (oct → último día) vs lo que pone la proyección Run Rate (resto del H2)
    function split(per) { var a = 0, ba = 0, r = 0, b = 0; SEGS.forEach(function (k) { var x = per.seg[k]; a += x.act; ba += x.budAct; r += x.real; b += x.bud; });
      return { tot: r - b, act: a - ba, proj: (r - a) - (b - ba) }; }
    var gN = split(S.nr.h2), gF = split(S.fvm.h2), Lm = dLbl(W._rawB2BC.meta.last_actuals_date);
    out.push('<p><b>De dónde sale el gap de H2 vs Budget:</b> NR ' + money(gN.tot) + ' = ' + money(gN.act) + ' real de oct a ' + Lm + ' ' + money(gN.proj) + ' de la proyección Run Rate; FVM ' +
      money(gF.tot) + ' = ' + money(gF.act) + ' real ' + money(gF.proj) + ' de la proyección' + (gF.act < 0 && gF.tot > 0 ? ' (lo que ya pasó viene abajo del Budget: el positivo depende del Run Rate de lo que falta)' : '') + '.</p>');
    var lag = S.nr.h2.parts.filter(function (x) { return x.gap < 0; }).sort(function (a, b) { return a.gap - b.gap; }).slice(0, 5);
    if (lag.length) out.push('<p><b>Onboarding más atrasado en H2</b> (NR real vs Budget): ' + lag.map(function (x) { return esc(x.p) + ' ' + money(x.gap); }).join(', ') + '.</p>');
    out.push('<p style="color:var(--fl-ink3);font-size:10px">YTD = abr → último día vs mismos días del LY. H2 = actual + Run Rate. ' +
      'Δ YoY Bud = Budget − LY · Gap = Real − Budget. Existentes = mismas cuentas los dos años. ' + (W._orgTargetFlow_() === 'budget' ? 'Organic: todo a TC Budget (gap = oficial del Flow).' : 'Montos sin Organic a TC Budget.') + (S.nr.ytd.lyOk ? '' : ' ⚠ El LY diario no cubre todo el YTD.') + '</p>');
    return '<div class="ys-notes">' + out.join('') + '</div>';
  }

  // Control: Real y Budget por segmento tienen que dar lo mismo que los números oficiales del Flow vs Budget
  // (flowSegData_ YTD y flowH2SegData_ H2). Si no, avisa en consola; W._ysCheck queda con el detalle.
  function check(S) {
    var sub = W.flowRegionRaw_(null), bad = [];
    MK.forEach(function (mk) {
      [['ytd', W.flowSegData_(sub, mk, 'budget', 'ytd')], ['h2', W.flowH2SegData_(sub, mk, 'budget')]].forEach(function (x) {
        SEGS.forEach(function (k) { var a = S[mk][x[0]].seg[k], o = x[1][k];
          if (Math.abs(a.real - o.base) > 1000 || Math.abs(a.bud - o.goal) > 1000) bad.push(mk + ' ' + x[0] + ' ' + k + ': slide ' + Math.round(a.real) + '/' + Math.round(a.bud) + ' vs Flow ' + Math.round(o.base) + '/' + Math.round(o.goal)); });
      });
    });
    W._ysCheck = bad; if (bad.length) console.warn('[daily-flow-yoy-seg] no concilia con el Flow:', bad);
  }

  function html(idx) {
    var S = {}; MK.forEach(function (mk) { S[mk] = build(mk); });
    check(S);
    var fyL = W.flFyLbl_(W._rawB2BC.meta.last_actuals_date), n2 = S.nr.h2.seg;
    var L = W._rawB2BC.meta.last_actuals_date, ytdLbl = 'YTD a ' + dLbl(L);
    // Título con el formato del equipo: "FY 27 WLs | Farming acelera el FVM en H2 al +79% vs un YTD al +19% con un NR creciendo en línea"
    var fyT = fyL.replace(/^FY/, 'FY '), fv = [yy(S.fvm.ytd.seg.f), yy(S.fvm.h2.seg.f)], nv = [yy(S.nr.ytd.seg.f), yy(n2.f)];
    var nrTxt = nrRitmo(nv[0], nv[1]);
    var title = fyT + ' WLs | Farming ' + ritmo(fv[0], fv[1], 5) + ' el FVM en H2 al ' + pc(fv[1]) + ' vs un YTD al ' + pc(fv[0]) + ' con un NR ' + nrTxt + ' (' + pc(nv[0]) + ' → ' + pc(nv[1]) + ')';
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
      return table(mk === 'nr' ? 'NR' : 'FVM', [{ lbl: 'YTD ' + fyL + ' (abr → ' + dLbl(L) + ')', d: S[mk].ytd }, { lbl: 'H2 ' + fyL + ' (Act+Proy)', d: S[mk].h2 }]);
    }).join('');
    return '<div class="flow-slide"><div class="fl-head"><div class="fl-title flm-t2" title="' + esc(title) + '"><small>' + esc(kick) + '</small>' + esc(title) + '</div>' +
      '<div class="fl-brand">' + W.flLogo_() + '</div></div><div class="fl-rule"></div>' +
      '<div class="fl-body ys-body"><div class="ys-left">' + charts + '</div><div class="ys-right">' + tables + notes(S, fyL, ytdLbl) + '</div></div></div>';
  }

  var def = { kind: 'b2b2c_yoy_seg', name: 'B2B2C — Crecimiento YoY por segmento' };
  W.FLOW_EXTRA = (W.FLOW_EXTRA || []).concat([{ def: def, at: 'cover', html: function (idx) {
    try { return html(idx); } catch (e) { console.warn('[daily-flow-yoy-seg]', e); return '<div class="flow-slide"><p style="padding:40px">No se pudo armar la slide de YoY por segmento: ' + esc(e.message) + '</p></div>'; }
  } }]);
})();
