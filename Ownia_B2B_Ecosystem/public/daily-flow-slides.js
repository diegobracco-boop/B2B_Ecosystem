/* Daily Dashboard en Ownia — Flow Semanal: marcas y tablas de las slides (pedido de Diego, 2026-10-26).
 * Lo inyecta server/index.js en el Daily (`layout` en server/modules.js). El HTML de Apps Script no se
 * toca: el Flow de GAS queda como está.
 *
 *  - Recuadro "Organic" en el encabezado de cada slide (menos los separadores) cuando el switch Organic
 *    está en YES, con el TC al que quedan los números de esa slide: el Goal del Flow (Budget → TC Budget,
 *    Last Year → TC Actuals LY, Run Rate → sin TC: USD nominal), y siempre TC Budget en las KRs y el
 *    Weekly; las slides B2B siguen la Meta del tracker (Budget o Run Rate).
 *  - Nota al pie "Brasil: FVM excluye COI / Financial Result" cuando "COI Brasil" = Excluir.
 *  - Portada OC ("B2B2C Monthly Performance vs … · OC"): tablas NR / FVM / OC por H1 y H2 (en vez de
 *    YTD y H2), como la slide 4 de "Slides mensuales". El modo embebido (public/daily-embed.js) usa
 *    las mismas tablas. Arriba de las barras, la línea de NR % GB y OC % GB (el OC % GB lo manda
 *    "Slides mensuales" en la URL, &ocgb=).
 */
(function () {
  'use strict';

  var css = document.createElement('style');
  css.textContent = [
    '.ow-fl-org{display:inline-flex;align-items:center;font-size:12px;font-weight:700;color:#fff;background:#550fed;border-radius:6px;padding:4px 11px;letter-spacing:.3px;white-space:nowrap}',
    '.ow-fl-org.nom{background:#8e8e93}',
    // Nota en el encabezado (arriba de la línea), a la derecha: abajo tapaba ejes y tablas
    '.ow-fl-fn{position:absolute;right:40px;top:63px;z-index:3;font-size:10.5px;font-style:italic;color:#6e6e73;pointer-events:none;white-space:nowrap}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  // TC de los números de una slide con Organic YES ('' = sin TC: USD nominal)
  function orgTarget(def) {
    var W = window;
    if (/^b2b_/.test(def.kind)) return W._flowB2BGoalType === 'rr' ? '' : 'budget';
    if (def.kind === 'weekly' || def.kind === 'b2b2c_krs' || def.kind === 'ceo_weekly') return 'budget';
    var t = typeof W._orgTargetFlow_ === 'function' ? W._orgTargetFlow_() : '';
    return t === 'forecast' ? 'budget' : t;
  }
  function decorate() {
    var W = window;
    var org = !!(W._dlOrganic && W._fxTbl), coi = !!W._exCoiBr;
    (W.FLOW_DECK || []).forEach(function (def, i) {
      if (def.kind === 'divider') return;
      var sl = document.querySelector('#flow-track .flow-frame[data-idx="' + i + '"] .flow-slide');
      if (!sl) return;
      Array.prototype.forEach.call(sl.querySelectorAll('.ow-fl-org,.ow-fl-fn'), function (e) { e.remove(); });
      if (org) {
        var brand = sl.querySelector('.fl-brand'), t = orgTarget(def), b = document.createElement('span');
        b.className = 'ow-fl-org' + (t ? '' : ' nom');
        b.textContent = t ? 'Organic · TC ' + (t === 'ly' ? 'Actuals LY' : 'Budget') : 'Organic n/a · USD nominal';
        b.title = t ? 'Actuals × TC Actuals / TC ' + (t === 'ly' ? 'Actuals LY' : 'Budget') : 'Contra Run Rate no hay TC: los números quedan en USD nominal';
        if (brand) brand.insertBefore(b, brand.firstChild);
      }
      if (coi) {
        var fn = document.createElement('div');
        fn.className = 'ow-fl-fn';
        fn.textContent = '* Brasil: FVM excluye COI / Financial Result (COI Brasil = Excluir)';
        sl.appendChild(fn);
      }
    });
  }

  // ── Portada OC: H1 / H2 por segmento y región (mismo criterio que flowH2SegData_ / flowOCH2Data_) ──
  function segHalf(sub, mk, cmp, a, b) {
    var W = window, L = W._rawB2BC.meta.last_actuals_date, fy0 = +W.flFyStart_(L).substring(0, 4);
    var MF = W._FLMF[mk], BF = W._FLBMF[mk], months = W.flowFY12_(sub, mk, cmp).slice(a, b), inH = {};
    var G = { f: { base: 0, goal: 0 }, h: { base: 0, goal: 0 }, t: { base: 0, goal: 0 } };
    months.forEach(function (m) {
      if (m.bud == null) return;
      inH[m.date.substring(0, 7)] = 1;
      ['f', 'h', 't'].forEach(function (k) { G[k].base += m.seg[k].v + m.seg[k].p; });
    });
    var rows, gF;
    if (cmp === 'ly') {
      var base = W.b2bcRaw_() || W._rawB2BC; gF = MF;
      rows = (sub.actuals_ly || []).concat(sub.actuals_ly_fy_rest || [], (base.actuals || []).filter(function (r) { return r.fecha <= L && r.fecha < fy0 + '-04-01'; }));
    } else {
      gF = BF; rows = (cmp === 'runrate') ? (sub.runrate || []).concat(sub.runrate_fy_rest || []) : (sub.budget || []).concat(sub.budget_fy_rest || []);
    }
    rows.forEach(function (r) {
      var m = (cmp === 'ly') ? (+r.fecha.substring(0, 4) + 1) + r.fecha.substring(4, 7) : r.fecha.substring(0, 7);
      if (inH[m]) G[W.flSeg_(r)].goal += (r[gF] || 0);
    });
    return G;
  }
  function ocHalf(cmp, a, b) {
    var W = window, L = W._rawB2BC.meta.last_actuals_date, fy0 = +W.flFyStart_(L).substring(0, 4);
    var oc = W._rawB2BC.flow_oc || { rows: [] }, ge = cmp === 'ly' ? 'ly' : cmp === 'runrate' ? 'rr' : 'bg', hm = {}, hasG = {}, R = {};
    for (var i = a; i < b; i++) { var mm = (3 + i) % 12 + 1; hm[(fy0 + (i >= 9 ? 1 : 0)) + '-' + (mm < 10 ? '0' : '') + mm] = 1; }
    function mOf(r) { return r[1] === 'ly' ? (+r[0].substring(0, 4) + 1) + r[0].substring(4, 7) : r[0].substring(0, 7); }
    (oc.rows || []).forEach(function (r) { if (r[1] === ge && hm[mOf(r)]) hasG[mOf(r)] = 1; });
    (oc.rows || []).forEach(function (r) {
      var m = mOf(r); if (!hasG[m]) return;
      var k = W.getRegion_(r[2]), x = R[k] = R[k] || { base: 0, goal: 0 };
      if (r[1] === 'bl') x.base += r[3]; else if (r[1] === ge) x.goal += r[3];
    });
    return R;
  }
  function ocCoverTables(sub, cmp, cmpShort) {
    var W = window, L = W._rawB2BC.meta.last_actuals_date, fyL = W.flFyLbl_(L), y0 = +W.flFyStart_(L).substring(0, 4);
    var h1Closed = L >= y0 + '-09-30', h1L = 'H1 ' + fyL + (h1Closed ? '' : ' (Act+Proy)'), h2L = 'H2 ' + fyL + ' (Act+Proy)';
    var segRows = W.FL_SEG_.map(function (sg) { return { k: sg.k, lbl: '<i style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:' + sg.c + '"></i>' + sg.lbl }; });
    function wrap(tag, html) { return '<div class="fl-scroll-tbl" style="flex:1;min-width:0;min-height:0;overflow-y:auto"><div class="fl-tag">' + tag + '</div>' + html + '</div>'; }
    var html = [['nr', 'NR'], ['fvm', 'FVM']].map(function (t) {
      return wrap(t[1] + ' vs ' + cmpShort, W.flMultiPeriodTbl_('Segmento', segRows, [
        { lbl: h1L, data: segHalf(sub, t[0], cmp, 0, 6) }, { lbl: h2L, data: segHalf(sub, t[0], cmp, 6, 12) }]));
    }).join('');
    var regRows = ['BR', 'SAH', 'NAM'].map(function (k) { return { k: k, lbl: (W.REGION_LABEL_ || {})[k] || k }; });
    return html + wrap('OC vs ' + cmpShort, W.flMultiPeriodTbl_('Región', regRows, [
      { lbl: h1L, data: ocHalf(cmp, 0, 6) }, { lbl: h2L, data: ocHalf(cmp, 6, 12) }]));
  }

  // ── Portada OC: línea de % sobre GB arriba de las barras (como las slides Evolution del Hub) ──
  //   NR % GB: NR / GB del Daily, mes a mes (real + Run Rate), la misma fuente que las barras.
  //   OC % GB: el OC es contable y el Daily no tiene GB contable → lo manda "Slides mensuales" del Hub
  //   en la URL (&ocgb=12 valores, OC / GB del contable); sin el parámetro esa línea no va.
  var OCGB = (function () {
    var m = /[?&]ocgb=([-\d.,]+)/.exec(location.search);
    return m ? m[1].split(',').map(function (x) { return x === '' ? NaN : +x; }) : null;
  })();
  var gbPctPlugin = {
    id: 'owGbPct',
    afterDatasetsDraw: function (chart) {
      if (!chart._owGbPct) return;
      var di = chart.data.datasets.findIndex(function (d) { return d._owGbPct; });
      if (di < 0) return;
      var meta = chart.getDatasetMeta(di), ctx = chart.ctx, vals = chart.data.datasets[di].data;
      ctx.save();
      ctx.font = 'bold 9.5px Poppins, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#5b4fe0';
      meta.data.forEach(function (el, i) { if (el && vals[i] != null) ctx.fillText(vals[i].toFixed(1) + '%', el.x, el.y - 5); });
      ctx.restore();
    },
  };
  function addGbLine(ch, pct, lbl) {
    var fin = pct.filter(function (v) { return v != null && isFinite(v); });
    if (!fin.length) return;
    var lo = Math.min.apply(null, fin), hi = Math.max.apply(null, fin), span = (hi - lo) || Math.abs(hi) * 0.1 || 1;
    ch.data.datasets.push({ type: 'line', label: lbl + ' % GB', data: pct.map(function (v) { return v != null && isFinite(v) ? v : null; }), yAxisID: 'owgb',
      borderColor: '#8b80f0', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#fff', pointBorderColor: '#5b4fe0', pointBorderWidth: 2, order: 0, _owGbPct: true });
    // la línea ocupa la franja de arriba: el eje oculto va de muy abajo a apenas arriba del máximo
    // barras hasta ~57% del alto (grace 75%), línea en la franja ~70–90%
    ch.options.scales.owgb = { display: false, min: lo - span * 3.2, max: hi + span * 0.5 };
    ch.options.scales.y.grace = '75%';
    ch._owGbPct = lbl;
    ch.update('none');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var W = window;
    if (typeof W.Chart === 'function' && W.Chart.register) W.Chart.register(gbPctPlugin);
    var origBuildSlide = W.flowBuildSlide_, origChart = W.flowChart_;
    if (typeof origBuildSlide === 'function' && typeof origChart === 'function') {
      W.flowBuildSlide_ = function (def, idx) {
        var html = origBuildSlide.apply(this, arguments);
        if (def && def.kind === 'cover_oc') {
          try {
            var gb = W.flowFY12_(W.flowRegionRaw_(null), 'gb', W._flowComp);
            (W._flowSeries[idx] || []).forEach(function (spec) {
              if (/-nr$/.test(spec.id)) spec._owGbPct = { lbl: 'NR', pct: spec.series.map(function (m, i) { var g = (gb[i].v || 0) + (gb[i].p || 0); return g ? ((m.v || 0) + (m.p || 0)) / g * 100 : null; }) };
              else if (/-oc$/.test(spec.id) && OCGB) spec._owGbPct = { lbl: 'OC', pct: OCGB };
            });
            // la línea va en la leyenda de cada gráfico que la tiene (NR siempre; OC con &ocgb=)
            var n = 0;
            html = html.replace(/<div class="fl-legend">/g, function (m0) {
              var lbl = n++ === 0 ? 'NR' : (OCGB ? 'OC' : null);
              return lbl ? m0 + '<span style="white-space:nowrap"><i style="background:#8b80f0;height:3px;align-self:center"></i>' + lbl + ' %GB</span>' : m0;
            });
          } catch (e) { console.warn('[daily-flow-slides] sin línea % GB:', e); }
        }
        return html;
      };
      W.flowChart_ = function (spec) {
        var r = origChart.apply(this, arguments);
        if (spec && spec._owGbPct && W._flowCharts[spec.id]) { try { addGbLine(W._flowCharts[spec.id], spec._owGbPct.pct, spec._owGbPct.lbl); } catch (e) { console.warn('[daily-flow-slides] línea % GB:', e); } }
        return r;
      };
    }
    if (typeof W.flowOCCoverTables_ === 'function' && typeof W.flMultiPeriodTbl_ === 'function') W.flowOCCoverTables_ = ocCoverTables;
    var origBuild = W.flowBuild_;
    if (typeof origBuild !== 'function') return;
    W.flowBuild_ = function () {
      var ok = origBuild.apply(this, arguments);
      if (ok) { try { decorate(); } catch (e) { console.warn('[daily-flow-slides] sin marcas:', e); } }
      return ok;
    };
  });
})();
