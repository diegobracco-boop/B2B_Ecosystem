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
 *  - NR de la portada OC en "Slides mensuales" (&nrc=… del Hub): total contable, Hunting y TBD del Daily,
 *    Farming por diferencia. En el Flow del Daily, NR gestional como siempre.
 *  - OC (portada OC y slides de OC): con Organic YES el real + Run Rate del contable pasa a TC Budget (vs LY:
 *    TC Actuals LY), como en el P&L contable; en Apps Script el OC del Flow queda nominal.
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
    var C = mk === 'nr' && nrContable(cmp);
    if (C) {   // NR contable: Farming = Goal contable − Hunting − TBD del Daily
      var tot = 0;
      Object.keys(inH).forEach(function (m) { tot += C.G[m] || 0; });
      G.f.goal = tot - G.h.goal - G.t.goal;
    }
    return G;
  }
  // OC con Organic (2026-10-27: la portada OC no cuadraba con el P&L contable, que con Organic YES lleva
  // el OC a TC Budget). flow_oc es nominal: con Organic, el baseline del contable (real cerrado + Run Rate,
  // escenario 'bl') se multiplica por TC Actuals / TC del target, por país y mes, como el resto del Daily
  // (_orgFactor_ de dashboard.html; vs Forecast también TC Budget, vs Run Rate nominal). El Goal queda
  // nominal, igual que en el P&L contable.
  // RG (entidad de Brasil: el Budget la abre aparte, 5,2M de OC en H2 FY27; el baseline la trae dentro de
  // Brasil) va a la región Brasil, no a Sudamérica Hispana (getRegion_ la mandaba ahí).
  function ocOrg(cmp) {
    var W = window, oc = W._rawB2BC && W._rawB2BC.flow_oc;
    if (!oc || !oc.rows) return oc;
    var t = typeof W._orgTargetFor_ === 'function' ? W._orgTargetFor_(cmp === 'bg' ? 'budget' : cmp) : '';
    if (t === 'forecast') t = 'budget';
    var key = t + '|' + oc.rows.length;
    if (oc._owOrg && oc._owOrg.key === key) return oc._owOrg.oc;
    var miss = {}, f = t ? W._orgFactor_(t, miss) : function () { return 1; }, out = {};
    Object.keys(oc).forEach(function (k) { if (k !== '_owOrg') out[k] = oc[k]; });
    out.rows = oc.rows.map(function (r) {
      var p = /^rg$/i.test(r[2]) ? 'Brasil' : r[2];
      return [r[0], r[1], p, r[1] === 'bl' ? r[3] * f(r[2], r[0]) : r[3]];
    });
    oc._owOrg = { key: key, oc: out };
    return out;
  }
  // Corre fn con _rawB2BC.flow_oc convertido (las funciones del Daily lo leen de ahí)
  function withOcOrg(cmp, fn, self, args) {
    var W = window, raw = W._rawB2BC, orig = raw && raw.flow_oc, conv = ocOrg(cmp);
    if (!raw || !conv || conv === orig) return fn.apply(self, args);
    raw.flow_oc = conv;
    try { return fn.apply(self, args); } finally { raw.flow_oc = orig; }
  }
  // ── NR de la portada OC SOLO en "Slides mensuales" del Hub (2026-10-27, Diego): el total es el NR del
  // P&L CONTABLE que manda el Hub en la URL (12 meses del FY: &nrc= real cerrado + Run Rate con su Organic,
  // &nrb= Budget, &nry= YoY %, &nrcl= índice del último mes cerrado), para que cuadre con el contable;
  // Hunting y TBD siguen del gestional (Daily) y Farming = contable − Hunting − TBD, en barras y tablas,
  // real y Goal. Meses cerrados: Farming va entero como real; abiertos: el real MTD de Farming del Daily y
  // el resto como proyección. Los parámetros solo vienen en el modo embebido de esa slide (la página muestra
  // solo la portada OC); sin ellos (el Flow del Daily) no cambia nada: 100% gestional.
  var NRC = (function () {
    function arr(k) { var m = new RegExp('[?&]' + k + '=([-\\d.,]+)').exec(location.search); return m ? m[1].split(',').map(function (x) { return x === '' ? null : +x; }) : null; }
    var c = arr('nrc'), b = arr('nrb'), y = arr('nry'), cl = /[?&]nrcl=(-?\d+)/.exec(location.search);
    return c && b && c.length === 12 && b.length === 12 ? { c: c, b: b, y: y, cl: cl ? +cl[1] : -1 } : null;
  })();
  function nrContable(cmp) {
    var W = window;
    if (!NRC || cmp !== 'budget' || !W._rawB2BC) return null;
    var fy0 = +W.flFyStart_(W._rawB2BC.meta.last_actuals_date).substring(0, 4), v = { T: {}, G: {}, Y: {}, closed: {} };
    for (var i = 0; i < 12; i++) {
      var mm = (3 + i) % 12 + 1, m = (fy0 + (i >= 9 ? 1 : 0)) + '-' + (mm < 10 ? '0' : '') + mm;
      if (NRC.c[i] == null) continue;
      v.T[m] = NRC.c[i]; v.G[m] = NRC.b[i] || 0; v.Y[m] = NRC.y ? NRC.y[i] : null;
      if (i <= NRC.cl) v.closed[m] = 1;
    }
    return v;
  }
  function nrFY12(mon, cmp) {
    var C = nrContable(cmp);
    if (!C) return mon;
    var r2 = function (x) { return Math.round(x * 100) / 100; };
    return mon.map(function (mo) {
      var m = mo.date.substring(0, 7), sg = mo.seg;
      if (!sg || !(m in C.T)) return mo;
      var f = { v: sg.f.v, p: sg.f.p }, ht = sg.h.v + sg.h.p + sg.t.v + sg.t.p, T = C.T[m];
      if (C.closed[m]) { f.v = r2(T - ht); f.p = 0; } else { f.p = r2(T - ht - f.v); }
      var o = Object.assign({}, mo, { seg: { f: f, h: sg.h, t: sg.t } });
      o.v = r2(f.v + sg.h.v + sg.t.v); o.p = r2(f.p + sg.h.p + sg.t.p); o.projected = o.p > 0;
      if (mo.bud != null) o.bud = r2(C.G[m] || 0);
      o.yoy = C.Y[m] != null && isFinite(C.Y[m]) ? C.Y[m] : null;
      return o;
    });
  }
  function ocHalf(cmp, a, b) {
    var W = window, L = W._rawB2BC.meta.last_actuals_date, fy0 = +W.flFyStart_(L).substring(0, 4);
    var oc = ocOrg(cmp) || { rows: [] }, ge = cmp === 'ly' ? 'ly' : cmp === 'runrate' ? 'rr' : 'bg', hm = {}, hasG = {}, R = {};
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
    var html = wrap('NR vs ' + cmpShort, W.flMultiPeriodTbl_('Segmento', segRows, [
      { lbl: h1L, data: segHalf(sub, 'nr', cmp, 0, 6) }, { lbl: h2L, data: segHalf(sub, 'nr', cmp, 6, 12) }]));
    // OC por segmento (2026-10-27, Diego): igual que el NR. El total es el OC del P&L contable; Hunting y TBD son el FVM del
    // gestional (Datalake) y Farming = OC contable − Hunting − TBD. Sin tabla de FVM.
    return html + wrap('OC vs ' + cmpShort, W.flMultiPeriodTbl_('Segmento', segRows, [
      { lbl: h1L, data: ocSegHalf(sub, cmp, 0, 6) }, { lbl: h2L, data: ocSegHalf(sub, cmp, 6, 12) }]));
  }
  function ocSegHalf(sub, cmp, a, b) {
    var oc = ocHalf(cmp, a, b), fv = segHalf(sub, 'fvm', cmp, a, b), base = 0, goal = 0;
    Object.keys(oc).forEach(function (k) { base += oc[k].base; goal += oc[k].goal; });
    return { f: { base: base - fv.h.base - fv.t.base, goal: goal - fv.h.goal - fv.t.goal }, h: fv.h, t: fv.t };
  }

  // ── Portada OC: línea de % sobre GB arriba de las barras (como las slides Evolution del Hub) ──
  //   NR % GB: NR / GB del Daily, mes a mes (real + Run Rate), la misma fuente que las barras.
  //   OC % GB: el OC es contable y el Daily no tiene GB contable → lo manda "Slides mensuales" del Hub
  //   en la URL (&ocgb=12 valores, OC / GB del contable); sin el parámetro esa línea no va.
  var OCGB = (function () {
    var m = /[?&]ocgb=([-\d.,]+)/.exec(location.search);
    return m ? m[1].split(',').map(function (x) { return x === '' ? NaN : +x; }) : null;
  })();
  // NR % GB: con el NR contable, el % sobre GB lo manda también el Hub (&nrgb=, NR / GB contable)
  var NRGB = (function () {
    var m = /[?&]nrgb=([-\d.,]+)/.exec(location.search);
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
    // Flow semanal 100% gestional (2026-10-27, Diego): la portada "Resumen mensual (OC)" es contable (flow_oc) y vive ahora en el
    // Flow mensual (Slides mensuales, que la embebe con ?embed=…). Fuera del modo embebido se saca del deck.
    if (!/[?&]embed=/.test(location.search) && Array.isArray(W.FLOW_DECK)) {
      for (var di = W.FLOW_DECK.length - 1; di >= 0; di--) if (W.FLOW_DECK[di].kind === 'cover_oc') W.FLOW_DECK.splice(di, 1);
    }
    if (typeof W.Chart === 'function' && W.Chart.register) W.Chart.register(gbPctPlugin);
    var origBuildSlide = W.flowBuildSlide_, origChart = W.flowChart_;
    if (typeof origBuildSlide === 'function' && typeof origChart === 'function') {
      W.flowBuildSlide_ = function (def, idx) {
        var html = origBuildSlide.apply(this, arguments);
        if (def && def.kind === 'cover_oc') {
          try {
            var gb = W.flowFY12_(W.flowRegionRaw_(null), 'gb', W._flowComp);
            (W._flowSeries[idx] || []).forEach(function (spec) {
              if (/-nr$/.test(spec.id) && NRGB) spec._owGbPct = { lbl: 'NR', pct: NRGB };
              else if (/-nr$/.test(spec.id)) spec._owGbPct = { lbl: 'NR', pct: spec.series.map(function (m, i) { var g = (gb[i].v || 0) + (gb[i].p || 0); return g ? ((m.v || 0) + (m.p || 0)) / g * 100 : null; }) };
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
    var origFY12 = W.flowFY12_;
    if (typeof origFY12 === 'function') W.flowFY12_ = function (sub, mk, cmp) {
      var r = origFY12.apply(this, arguments);
      if (mk !== 'nr' || !NRC) return r;
      try { return nrFY12(r, cmp); } catch (e) { console.warn('[daily-flow-slides] NR contable:', e); return r; }
    };
    ['flowFY12OC_', 'flowOCClosedData_', 'flowOCH2Data_'].forEach(function (nm) {
      var fn = W[nm];
      if (typeof fn === 'function') W[nm] = function (cmp) { return withOcOrg(cmp, fn, this, arguments); };
    });
    var origBuild = W.flowBuild_;
    if (typeof origBuild !== 'function') return;
    W.flowBuild_ = function () {
      var ok = origBuild.apply(this, arguments);
      if (ok) { try { decorate(); } catch (e) { console.warn('[daily-flow-slides] sin marcas:', e); } }
      return ok;
    };
  });
})();
