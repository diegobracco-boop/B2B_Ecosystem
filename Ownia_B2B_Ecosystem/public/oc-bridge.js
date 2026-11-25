/* Bridge del Operating Contribution (Goal → Baseline) del P&L Accounting, como lógica pura para reusarlo fuera de ese módulo
 * (2026-11-25, Diego: sección B2B del Flow mensual, slides "OC Bridge Q3 / Q4"). Es copia fiel de wfCompute_, sumProductData_ y
 * buildB2BRegionSplits_ de P&L_Accounting/dashboard.html (mismos grupos, mismos ítems, mismo signo): si cambian allá, cambiar acá.
 *   Palancas de Negocio (abiertas en Iniciativas + regiones para B2B) · Incentivos Regionales · Marketing Inv. · Fixed Cost · Resto.
 * Entrada: la respuesta de getEPMB2BCountryDetail del P&L Accounting ({ total, may, min }, cada bloque { baseline, goal } con rr / ct
 * por período: 'Q3 FY27', 'Total FY27', …). Probado en test/oc-bridge.test.js.
 */
(function (root) {
  'use strict';

  var ITEM_LABELS = {
    '_upfront_fees_rr': 'Up front + Fees + Desc.', 'cost_of_installments': 'Cost of Installments', 'credit_card_processing': 'CC Processing',
    '_tpcs_rr': 'TPCs', 'cost of sales as principal': 'Cost of Sales', 'back end incentives': 'Back-End Incentivos', 'other incentives': 'Other Incentivos',
    'media & other revenue': 'Media & Other Rev.', 'marketing-direct': 'Marketing Direct', 'media & other cost': 'Media & Other Cost',
    'channels-personnel/expenses': 'Channels P&E', 'marketing-personnel/expenses': 'Marketing P&E', 'fulfilment center fees': 'Fulfilment Center',
    'revenue from sales as principal': 'Net Revenue (Sales)', 'breakage revenue': 'Breakage', 'income_from_outsourced_services': 'Outsourced Services',
    'loyalty revenue': 'Loyalty Revenue', 'cancellations': 'Cancelaciones', 'revenue taxes': 'Revenue Taxes', 'customer claims': 'Customer Claims',
    'frauds': 'Frauds', 'errors': 'Errors', 'bad debt': 'Bad Debt', 'other transactional taxes': 'Other Tax', 'intercompany transactions': 'Intercompany',
    'loyalty program': 'Loyalty Program', 'other taxes': 'Other Taxes',
  };
  var GROUPS = [
    { label: 'Palancas de Negocio', items: [{ source: 'rr', key: '_upfront_fees_rr' }, { source: 'rr', key: 'cost_of_installments' },
      { source: 'rr', key: 'credit_card_processing' }, { source: 'rr', key: '_tpcs_rr' }, { source: 'ct', key: 'cost of sales as principal' }] },
    { label: 'Incentivos Regionales', items: [{ source: 'ct', key: 'back end incentives' }, { source: 'ct', key: 'other incentives' }, { source: 'ct', key: 'media & other revenue' }] },
    { label: 'Marketing Inv.', items: [{ source: 'ct', key: 'marketing-direct' }, { source: 'ct', key: 'media & other cost' }] },
    { label: 'Fixed Cost', items: [{ source: 'ct', key: 'channels-personnel/expenses' }, { source: 'ct', key: 'marketing-personnel/expenses' }, { source: 'ct', key: 'fulfilment center fees' }] },
  ];
  var OC_ITEMS = [
    ['ct', 'revenue from sales as principal'], ['rr', '_upfront_fees_rr'], ['ct', 'back end incentives'], ['ct', 'other incentives'], ['ct', 'breakage revenue'],
    ['ct', 'media & other revenue'], ['rr', 'income_from_outsourced_services'], ['ct', 'loyalty revenue'], ['rr', 'cancellations'], ['ct', 'revenue taxes'],
    ['ct', 'cost of sales as principal'], ['rr', 'cost_of_installments'], ['rr', 'credit_card_processing'], ['ct', 'customer claims'], ['ct', 'frauds'],
    ['ct', 'errors'], ['ct', 'bad debt'], ['ct', 'fulfilment center fees'], ['ct', 'media & other cost'], ['ct', 'other transactional taxes'],
    ['ct', 'intercompany transactions'], ['ct', 'marketing-direct'], ['ct', 'marketing-personnel/expenses'], ['ct', 'channels-personnel/expenses'],
    ['rr', '_tpcs_rr'], ['ct', 'loyalty program'], ['ct', 'other taxes'],
  ].map(function (x) { return { source: x[0], key: x[1] }; });
  var REGION_ORDER = ['Brasil', 'Globales', 'Mexico', 'Hispa', 'RG - COI'];
  var HISPA = ['Argentina', 'Colombia', 'Chile', 'Peru', 'Ecuador'];
  function itemVal(item, keys, rr, ct) {
    function s(map, k) { var mm = map && map[k]; if (!mm) return 0; var v = 0; for (var i = 0; i < keys.length; i++) v += (mm[keys[i]] || 0); return v; }
    if (item.source === 'rr') {
      if (item.key === '_upfront_fees_rr') return s(rr, 'up_front_incentives') + s(rr, '_cfc_rr');
      return s(rr, item.key);
    }
    return s(ct, item.key);
  }
  function sumItems(items, keys, rr, ct) { var v = 0; items.forEach(function (it) { v += itemVal(it, keys, rr, ct); }); return v; }

  function sumData(items) {
    var res = { baseline: { rr: {}, ct: {}, rr_monthly: {}, ct_monthly: {} }, goal: { rr: {}, ct: {}, rr_monthly: {}, ct_monthly: {} } };
    (items || []).forEach(function (p) {
      if (!p || !p.data) return;
      ['baseline', 'goal'].forEach(function (sc) {
        ['rr', 'ct', 'rr_monthly', 'ct_monthly'].forEach(function (type) {
          var src = p.data[sc] && p.data[sc][type]; if (!src) return;
          Object.keys(src).forEach(function (metric) {
            if (!res[sc][type][metric]) res[sc][type][metric] = {};
            var m = src[metric];
            if (m && typeof m === 'object') Object.keys(m).forEach(function (per) { res[sc][type][metric][per] = (res[sc][type][metric][per] || 0) + (m[per] || 0); });
          });
        });
      });
    });
    return res;
  }

  // Palancas de B2B abiertas en Iniciativas (MAY flights / dest. serv., MIN cruceros) + una por región (como el P&L Accounting en "Total B2B")
  function b2bSplits(d) {
    var mayP = (d.may && d.may.products) || [], minP = (d.min && d.min.products) || [];
    var iniMay = function (p) { var l = (p.label || '').toLowerCase(); return l.indexOf('flight') >= 0 || l.indexOf('dest') >= 0; };
    var iniMin = function (p) { var l = (p.label || '').toLowerCase(); return l.indexOf('cruis') >= 0 || l.indexOf('cruc') >= 0; };
    var iM = mayP.filter(iniMay), iN = minP.filter(iniMin);
    var out = [{ label: 'Iniciativas', data: sumData(iM.concat(iN)),
      customDetails: iM.map(function (p) { return { label: 'MAY · ' + p.label, data: p.data }; }).concat(iN.map(function (p) { return { label: 'MIN · ' + p.label, data: p.data }; })) }];
    var mr = {}, nr = {};
    ((d.may && d.may.by_region) || []).forEach(function (r) { mr[r.label] = r; });
    ((d.min && d.min.by_region) || []).forEach(function (r) { nr[r.label] = r; });
    REGION_ORDER.forEach(function (lbl) {
      var a = mr[lbl], b = nr[lbl]; if (!a && !b) return;
      var parts = []; if (a) parts.push({ data: a.data }); if (b) parts.push({ data: b.data });
      var cd;
      if (lbl === 'Brasil' || lbl === 'Mexico') cd = [].concat((a && a.products) || [], (b && b.products) || []);
      else if (lbl === 'Hispa') {
        var ac = {}, bc = {};
        ((a && a.countries) || []).forEach(function (c) { ac[c.label] = c.data; });
        ((b && b.countries) || []).forEach(function (c) { bc[c.label] = c.data; });
        cd = [];
        HISPA.forEach(function (c) {
          var p = []; if (ac[c]) p.push({ data: ac[c] }); if (bc[c]) p.push({ data: bc[c] });
          if (p.length) cd.push({ label: c, data: sumData(p) });
        });
      }
      var sp = { label: lbl, data: sumData(parts) };
      if (cd && cd.length) sp.customDetails = cd;
      out.push(sp);
    });
    return out;
  }

  // data = { baseline, goal } del total; keys = períodos a sumar (p.ej. ['Q3 FY27']); splits = opcional, abre "Palancas de Negocio".
  // Devuelve { goalOC, baselineOC, steps: [{ label, delta, group, details: [{ label, delta, pxq? }] }] } (pasos en el orden del gráfico).
  function compute(data, keys, splits) {
    var bRR = data.baseline.rr || {}, bCT = data.baseline.ct || {}, gRR = data.goal.rr || {}, gCT = data.goal.ct || {};
    function gb(rr) { var r = (rr && rr.gross_bookings) || {}, v = 0; keys.forEach(function (k) { v += r[k] || 0; }); return v; }
    function pxq(items, b1, b2, g1, g2) {
      var bP = sumItems(items, keys, b1, b2), gP = sumItems(items, keys, g1, g2), bG = gb(b1), gG = gb(g1);
      var vol = gG !== 0 ? (bG - gG) * (gP / gG) : 0;
      return [{ label: '▸ Efecto Vol. (GB)', delta: vol, pxq: true }, { label: '▸ Efecto Margen %GB', delta: (bP - gP) - vol, pxq: true }];
    }
    function det(items, b1, b2, g1, g2) {
      return items.map(function (it) { return { label: ITEM_LABELS[it.key] || it.key, delta: itemVal(it, keys, b1, b2) - itemVal(it, keys, g1, g2) }; })
        .filter(function (x) { return x.delta !== 0; });
    }
    var goalOC = sumItems(OC_ITEMS, keys, gRR, gCT), baselineOC = sumItems(OC_ITEMS, keys, bRR, bCT), sum = 0, steps = [];
    GROUPS.forEach(function (g) {
      if (g.label === 'Palancas de Negocio' && splits && splits.length) {
        splits.forEach(function (sp) {
          var sb = sp.data.baseline, sg = sp.data.goal;
          var dl = sumItems(g.items, keys, sb.rr, sb.ct) - sumItems(g.items, keys, sg.rr, sg.ct);
          sum += dl;
          var ds = sp.customDetails && sp.customDetails.length
            ? sp.customDetails.map(function (c) { return { label: c.label, delta: sumItems(g.items, keys, c.data.baseline.rr, c.data.baseline.ct) - sumItems(g.items, keys, c.data.goal.rr, c.data.goal.ct) }; })
              .filter(function (x) { return x.delta !== 0; })
            : det(g.items, sb.rr, sb.ct, sg.rr, sg.ct);
          steps.push({ label: 'Palancas ' + sp.label, group: g.label, delta: dl, details: pxq(g.items, sb.rr, sb.ct, sg.rr, sg.ct).concat(ds) });
        });
      } else {
        var dl = sumItems(g.items, keys, bRR, bCT) - sumItems(g.items, keys, gRR, gCT);
        sum += dl;
        steps.push({ label: g.label, group: g.label, delta: dl, details: pxq(g.items, bRR, bCT, gRR, gCT).concat(det(g.items, bRR, bCT, gRR, gCT)) });
      }
    });
    var inG = {};
    GROUPS.forEach(function (g) { g.items.forEach(function (it) { inG[it.source + '|' + it.key] = true; }); });
    var resto = OC_ITEMS.filter(function (it) { return !inG[it.source + '|' + it.key]; });
    steps.push({ label: 'Resto', group: 'Resto', delta: baselineOC - goalOC - sum, details: det(resto, bRR, bCT, gRR, gCT) });
    return { goalOC: goalOC, baselineOC: baselineOC, steps: steps };
  }

  root.OcBridge = { compute: compute, b2bSplits: b2bSplits, sumData: sumData };
})(typeof window !== 'undefined' ? window : this);
