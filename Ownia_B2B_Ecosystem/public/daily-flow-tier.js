/* Daily Dashboard en Ownia — Flow Semanal: tabla de las slides "OKR L2" de Net Revenues y FVM abierta
 * por Región → (País) → Tier → Partner, con YoY (pedido de Diego, 2026-10-26). Lo inyecta
 * server/index.js en el Daily (`layout` en server/modules.js). El HTML de Apps Script no se toca: el
 * Daily de GAS sigue con su tabla Región / País.
 *
 * Mismos datos y switches que el resto del Flow: el sub-raw que arma el Daily (flowRegionRaw_) ya trae
 * Organic (actuals a TC del Goal y el valor para el YoY en <campo>_y), "Excluir COI Brasil" (pisa fvm)
 * y "Partner TBD". El Tier es el de la cartera vigente por país × partner, con la misma regla que
 * flowGroupTable_ (budget/runrate, después actuals; sin tier → Low Value).
 *   - Brasil e Hispa: Región → Tier (n partners) → Partner (en Hispa el partner lleva su país).
 *   - Norteamérica: Región → País → Tier → Partner (el país más grande abierto).
 *   - Columnas: Baseline · Delta [$] · Delta [%] · YoY (real vs mismo período del año pasado).
 * Los partners arrancan plegados; el acordeón es el del Flow (flAccToggle_).
 */
(function () {
  'use strict';

  var METRICS = { nr: 1, fvm: 1 };
  var COUNTRY_SHORT = { Argentina: 'AR', Chile: 'CL', Colombia: 'CO', Peru: 'PE', Ecuador: 'EC', Uruguay: 'UY', Paraguay: 'PY', Mexico: 'MX', USA: 'US', Brasil: 'BR', 'Other Countries': 'OT' };
  var uid = 0;

  function tierRank(t) { var m = /^tier[\s_-]*(\d+)/i.exec(t || ''); return m ? +m[1] : (/low/i.test(t || '') ? 900 : 1000); }

  function table(sub, mk, comp) {
    var W = window;
    var vDate = W.flowVDate_(), mStart = vDate.substring(0, 7) + '-01';
    var lyMode = comp === 'ly', lyMS = W._flLY_(mStart), lyVD = W._flLY_(vDate);
    var MF = W._FLMF[mk], cmpArr = W._flCompArr_(sub, comp), cmpF = W._flCompField_(mk, comp);

    // Tier por país × partner (misma regla que flowGroupTable_)
    var tPP = {}, tP = {}, tPPa = {}, tPa = {};
    function addTier(byPP, byP, r) {
      if (!r.partner || !r.tier || r.tier === 'Unknown') return;
      var pl = String(r.partner).toLowerCase(), kp = (r.pais || 'Other') + '|' + pl;
      if (!byPP[kp]) byPP[kp] = r.tier;
      if (!byP[pl]) byP[pl] = r.tier;
    }
    [(sub.budget || []), (sub.runrate || [])].forEach(function (a) { a.forEach(function (r) { addTier(tPP, tP, r); }); });
    (sub.actuals || []).forEach(function (r) { addTier(tPPa, tPa, r); });
    function tierOf(pais, partner) {
      var pl = String(partner || '').toLowerCase(), kp = (pais || 'Other') + '|' + pl;
      return tPP[kp] || tP[pl] || tPPa[kp] || tPa[pl] || 'Low Value';
    }

    // Árbol región → país → tier → partner
    var root = { b: 0, g: 0, y: 0, ly: 0, ch: {} };
    function node(parent, k) { return parent.ch[k] = parent.ch[k] || { b: 0, g: 0, y: 0, ly: 0, ch: {} }; }
    function add(r, f, v) {
      var pais = r.pais || 'Other', path = [W.getRegion_(pais), pais, tierOf(pais, r.partner), (r.partner || 'Other')];
      var n = root; n[f] += v;
      path.forEach(function (k) { n = node(n, k); n[f] += v; });
    }
    (sub.actuals || []).forEach(function (r) {
      if (r.fecha < mStart || r.fecha > vDate) return;
      add(r, 'b', r[MF] || 0); add(r, 'y', W._yv_(r, MF));
    });
    cmpArr.forEach(function (r) {
      if (lyMode) { if (r.fecha < lyMS || r.fecha > lyVD) return; } else if (r.fecha < mStart || r.fecha > vDate) return;
      add(r, 'g', r[cmpF] || 0);
    });
    (sub.actuals_ly || []).forEach(function (r) { if (r.fecha >= lyMS && r.fecha <= lyVD) add(r, 'ly', r[MF] || 0); });

    // Celdas
    function cell(d) { return '<td class="' + (d >= 0 ? 'fl-pos' : 'fl-neg') + '">' + (d >= 0 ? '+' : '') + W.fmtShort(d) + '</td>'; }
    function pct(n) {
      var p = n.g !== 0 ? (n.b / n.g - 1) * 100 : null;
      return '<td class="' + ((n.b - n.g) >= 0 ? 'fl-pos' : 'fl-neg') + '">' + (p == null ? '—' : (p >= 0 ? '+' : '') + Math.round(p) + '%') + '</td>';
    }
    function yoy(n) {
      var p = n.ly > 0 ? (n.y / n.ly - 1) * 100 : null;
      return '<td class="' + (p == null ? '' : p >= 0 ? 'fl-pos' : 'fl-neg') + '">' + (p == null ? '—' : (p >= 0 ? '+' : '') + Math.round(p) + '%') + '</td>';
    }
    function cols(n) { return '<td>' + W.fmtShort(n.b) + '</td>' + cell(n.b - n.g) + pct(n) + yoy(n); }
    var t = 'fq' + (uid++), body = '', k = 0;
    function row(lbl, n, opts) {
      var key = opts.key ? ' data-key="' + opts.key + '" data-open="' + (opts.open ? '1' : '0') + '" onclick="event.stopPropagation();flAccToggle_(this)"' : '';
      var par = opts.parent ? ' data-parent="' + opts.parent + '"' : '';
      var caret = opts.key ? '<span class="fl-acc-caret">' + (opts.open ? '▾' : '▸') + '</span> ' : '';
      var style = 'display:' + (opts.hidden ? 'none' : 'table-row') + (opts.key ? ';cursor:pointer' : '') + (opts.bold ? ';font-weight:700' : '');
      body += '<tr' + (opts.cls ? ' class="' + opts.cls + '"' : '') + key + par + ' style="' + style + '"><td>' + '&nbsp;&nbsp;'.repeat(opts.ind || 0) + caret + lbl + '</td>' + cols(n) + '</tr>';
    }
    function bySize(o) { return Object.keys(o.ch).sort(function (a, b) { return o.ch[b].b - o.ch[a].b; }); }
    // Tiers de un conjunto de países, juntos (partners con su país si hay más de uno)
    function tiersOf(paisNodes, withPais) {
      var T = {};
      paisNodes.forEach(function (pn) {
        Object.keys(pn.n.ch).forEach(function (tn) {
          var tg = T[tn] = T[tn] || { b: 0, g: 0, y: 0, ly: 0, ch: {} }, src = pn.n.ch[tn];
          ['b', 'g', 'y', 'ly'].forEach(function (f) { tg[f] += src[f]; });
          Object.keys(src.ch).forEach(function (p) {
            var lbl = withPais ? p + ' (' + (COUNTRY_SHORT[pn.k] || pn.k.substring(0, 2).toUpperCase()) + ')' : p;
            tg.ch[lbl] = src.ch[p];
          });
        });
      });
      return T;
    }
    function tierRows(T, parentKey, ind, hidden) {
      Object.keys(T).sort(function (a, b) { return tierRank(a) - tierRank(b) || T[b].b - T[a].b; }).forEach(function (tn) {
        var tk = t + 'k' + (k++), n = T[tn], parts = Object.keys(n.ch).sort(function (a, b) { return n.ch[b].b - n.ch[a].b; });
        row(tn + ' <span style="font-weight:400;color:var(--fl-ink3)">(' + parts.length + ')</span>', n, { key: tk, open: false, parent: parentKey, ind: ind, hidden: hidden, bold: true });
        parts.forEach(function (p) { row(p, n.ch[p], { parent: tk, ind: ind + 2, hidden: true }); });
      });
    }
    ['BR', 'SAH', 'NAM'].forEach(function (rk) {
      var rn = root.ch[rk]; if (!rn) return;
      var rkey = t + 'r' + rk, paises = bySize(rn);
      row((W.REGION_LABEL_ || {})[rk] || rk, rn, { key: rkey, open: true, cls: 'grp' });
      if (rk === 'NAM' && paises.length > 1) {
        paises.forEach(function (pk, i) {
          var pn = rn.ch[pk], pkey = t + 'p' + (k++), open = i === 0 && pn.b >= rn.b * 0.5;
          row(pk, pn, { key: pkey, open: open, parent: rkey, ind: 1 });
          tierRows(pn.ch, pkey, 2, !open);
        });
      } else {
        tierRows(tiersOf(paises.map(function (pk) { return { k: pk, n: rn.ch[pk] }; }), paises.length > 1), rkey, 1, false);
      }
    });
    body += '<tr class="tot"><td>Total</td>' + cols(root) + '</tr>';
    return '<table class="fl-tbl"><thead><tr><th>Región / País / Tier / Partner</th><th>Baseline</th><th>Delta [$]</th><th>Delta [%]</th><th>YoY</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var orig = window.flowGroupTable_;
    if (typeof orig !== 'function') return;
    // Solo la tabla de las slides OKR L2 (Región / País, agrupada por región) de NR y FVM.
    window.flowGroupTable_ = function (subRaw, metricKey, comp, col1, groupByRegion) {
      if (groupByRegion === true && col1 === 'Región / País' && METRICS[metricKey]) {
        try { return table(subRaw, metricKey, comp); } catch (e) { console.warn('[daily-flow-tier] tabla por Tier sin armar:', e); }
      }
      return orig.apply(this, arguments);
    };
  });
})();
