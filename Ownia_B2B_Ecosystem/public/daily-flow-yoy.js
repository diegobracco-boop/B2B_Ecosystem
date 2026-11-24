/* Flow semanal · B2B2C "NR y FVM: evolutivo mensual y crecimiento YoY" (2026-11-23, Diego). Solo en <base>/daily?flowdeck=1.
 *
 * Una slide en la sección B2B2C, después de la portada "B2B2C Monthly Performance": dos gráficos (NR arriba, FVM abajo) con
 * los 12 meses del FY y, debajo de cada mes, el YoY total y el YoY de Farming.
 *   - Mismas cuentas que la portada (flowFY12_ de Daily_Dashboard/dashboard.html): actual hasta el último día con datos +
 *     proyección Run Rate del resto (barra clara); YoY = (actual + proyección) vs LY del mes completo, con Organic como el
 *     resto del deck (_yv_: actual a TC Actuals LY). "—" si el LY del mes no está entero.
 *   - Farming = flSeg_ 'f' (Existing según la cartera vigente, fuera Hunting y TBD), en los dos años: compara las mismas
 *     cuentas, sin el efecto de las nuevas (como la fila "Farming" de las slides de región).
 *   - Cajitas a la derecha: FYTD de los meses cerrados (abril al último mes completo) vs el mismo período del LY.
 * La ubica daily-flow-minto.js (W.FLOW_EXTRA con at:'cover'). No pide datos: usa lo que ya cargó el Daily.
 */
(function () {
  'use strict';
  if (!/[?&]flowdeck=1(&|$)/.test(location.search)) return;
  var W = window, MK = ['nr', 'fvm'];

  var css = document.createElement('style');
  css.textContent = [
    // .fl-body mide 624 px + 14 de padding arriba: sin tope, el segundo gráfico se cortaba abajo
    '.fl-body.fy-body{display:flex;flex-direction:column;gap:8px;height:calc(720px - 96px - 30px)}',
    '.fy-row{flex:1;min-height:0;display:flex;flex-direction:column}',
    '.fy-h{display:flex;align-items:baseline;justify-content:center;gap:16px}.fy-h .fl-chart-title,.fy-h .fl-legend{margin:0}',
    '.fy-in{display:flex;gap:12px;align-items:center;flex:1;min-height:0}',
    '.fy-boxes{display:flex;flex-direction:column;gap:6px;width:170px}',
    '.fy-box{border:1px solid var(--fl-line);border-radius:10px;padding:6px 10px;background:#fbfaff}',
    '.fy-box .l{font-size:11px;font-weight:700;color:var(--fl-ink3)}',
    '.fy-box .v{font-size:20px;font-weight:800}',
    '.fy-box .s{font-size:10.5px;color:var(--fl-ink3)}',
    '.fy-up{color:var(--fl-green)}.fy-dn{color:var(--fl-red)}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pc(v) { return v == null || !isFinite(v) ? 'n/d' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + '%'; }
  function cl(v) { return v == null || !isFinite(v) ? '' : v >= 0 ? 'fy-up' : 'fy-dn'; }
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function mLbl(m) { return MES[+m.slice(5, 7) - 1]; }
  function cap(x) { return x.charAt(0).toUpperCase() + x.slice(1); }

  // Serie de 12 meses: la de la portada (flowFY12_) + yoyF (YoY Farming) por mes, y los FYTD de meses cerrados
  function series(mk) {
    var sub = W.flowRegionRaw_(null), cmp = W._flowComp, fy = W.flowFY12_(sub, mk, cmp);
    var L = W._rawB2BC.meta.last_actuals_date, fy0 = +W.flFyStart_(L).slice(0, 4), MF = W._FLMF[mk], BF = W._FLBMF[mk];
    var inFY = {}; fy.forEach(function (d) { inFY[d.date.slice(0, 7)] = 1; });
    function add(o, m, v) { if (inFY[m]) o[m] = (o[m] || 0) + (v || 0); }
    var far = function (r) { return W.flSeg_(r) === 'f'; };
    var YA = {}, YF = {}, PF = {}, LT = {}, LF = {};
    (sub.actuals || []).concat(sub.actuals_fy_rest || []).forEach(function (r) {
      if (r.fecha > L) return; var m = r.fecha.slice(0, 7), y = W._yv_(r, MF);
      add(YA, m, y); if (far(r)) add(YF, m, y);
    });
    (sub.runrate || []).concat(sub.runrate_fy_rest || []).forEach(function (r) { if (r.fecha > L && far(r)) add(PF, r.fecha.slice(0, 7), r[BF]); });
    // LY como flowFY12_: actuals_ly + actuals_ly_fy_rest + ene–mar del año calendario en curso, corridos +1 año (nominal)
    function addLY(r) { var m = (+r.fecha.slice(0, 4) + 1) + r.fecha.slice(4, 7); add(LT, m, r[MF]); if (far(r)) add(LF, m, r[MF]); }
    (sub.actuals_ly || []).forEach(addLY);
    (sub.actuals_ly_fy_rest || []).forEach(addLY);
    ((W.b2bcRaw_ && W.b2bcRaw_()) || W._rawB2BC).actuals.forEach(function (r) { if (r.fecha <= L && r.fecha < fy0 + '-04-01') addLY(r); });
    var cur = L.slice(0, 7), ytd = { a: 0, l: 0, af: 0, lf: 0, n: 0 };
    fy.forEach(function (d) {
      var m = d.date.slice(0, 7);
      // misma condición que la fila YoY total: sin LY entero del mes (yoy null), tampoco Farming
      d.yoyF = d.yoy != null && LF[m] ? ((YF[m] || 0) + (PF[m] || 0)) / LF[m] * 100 - 100 : null;
      d.bud = null;   // sin barra de Goal: la slide es de crecimiento
      if (m < cur && d.yoy != null) { ytd.a += YA[m] || 0; ytd.l += LT[m] || 0; ytd.af += YF[m] || 0; ytd.lf += LF[m] || 0; ytd.n++; ytd.to = m; }
    });
    ytd.y = ytd.l ? (ytd.a / ytd.l - 1) * 100 : null;
    ytd.yf = ytd.lf ? (ytd.af / ytd.lf - 1) * 100 : null;
    var last = fy.filter(function (d) { return d.date.slice(0, 7) < cur && d.yoy != null; }).pop() || null;
    return { fy: fy, ytd: ytd, last: last };
  }

  function box(lbl, v, sub) {
    return '<div class="fy-box"><div class="l">' + esc(lbl) + '</div><div class="v ' + cl(v) + '">' + pc(v) + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
  }

  function html(idx) {
    var S = {};
    MK.forEach(function (mk) { S[mk] = series(mk); });
    var ytdLbl = S.nr.ytd.n ? 'FYTD abr–' + mLbl(S.nr.ytd.to) : 'FYTD';
    var t = S.nr.last, tf = S.fvm.last;
    var title = t ? cap(mLbl(t.date)) +': NR YoY ' + pc(t.yoy) + ' (Farming ' + pc(t.yoyF) + ') · FVM ' + pc(tf && tf.yoy) + ' (Farming ' + pc(tf && tf.yoyF) + ')'
      : 'B2B2C · NR y FVM: crecimiento YoY';
    var kick = 'B2B2C — Evolutivo mensual de NR y FVM · YoY total y Farming';
    var rows = MK.map(function (mk) {
      var cid = 'flc' + idx + '-yoy-' + mk, s = S[mk];
      W._flowSeries[idx].push({ id: cid, series: s.fy, gran: 'monthly',
        opts: { labels: true, yoy: true, stackProj: true, yoyRows: [{ lbl: 'Farming', key: 'yoyF', colored: true }] } });
      return '<div class="fy-row"><div class="fy-h"><div class="fl-chart-title">' + W.FLOW_MET[mk].label + ', en $</div>' +
        '<div class="fl-legend"><span><i style="background:#5626e9"></i>Actual</span><span><i style="background:rgba(86,38,233,.35)"></i>Proyección (Run Rate)</span>' +
        '<span>Debajo: YoY total y YoY Farming (mismas cuentas los dos años)</span></div></div>' +
        '<div class="fy-in"><div class="fl-canvas-wrap" style="flex:1;min-width:0;height:100%"><canvas id="' + cid + '"></canvas></div>' +
        '<div class="fy-boxes">' + box(ytdLbl + ' · YoY', s.ytd.y, 'meses cerrados') + box(ytdLbl + ' · Farming', s.ytd.yf, 'meses cerrados') + '</div></div></div>';
    }).join('');
    return '<div class="flow-slide"><div class="fl-head"><div class="fl-title flm-t2" title="' + esc(title) + '"><small>' + esc(kick) + '</small>' + esc(title) + '</div>' +
      '<div class="fl-brand">' + W.flLogo_() + '</div></div><div class="fl-rule"></div><div class="fl-body fy-body">' + rows + '</div></div>';
  }

  var def = { kind: 'b2b2c_yoy', name: 'B2B2C — NR y FVM: evolutivo y YoY' };
  W.FLOW_EXTRA = (W.FLOW_EXTRA || []).concat([{ def: def, at: 'cover', html: function (idx) {
    try { return html(idx); } catch (e) { console.warn('[daily-flow-yoy]', e); return '<div class="flow-slide"><p style="padding:40px">No se pudo armar la slide de YoY: ' + esc(e.message) + '</p></div>'; }
  } }]);
})();
