/* "Marketing & Media Investment" del P&L Dashboard (B2B) en Ownia, rediseño 2026-11-05 (Diego). Lo inyecta server/index.js en
 * el Hub (`layout` en server/modules.js). El HTML de Apps Script no se toca: la tabla original queda oculta y vuelve sola si
 * esta capa falla.
 *
 * La sección cuenta una sola historia: con qué se financia el marketing y cómo viene contra el Goal.
 *   Fondos = Media Revenue (P&L contable) + Overs (sobrecomisión de Media Sales, query de Metabase). Son sumables: con ese 100%
 *   se paga el Marketing Cost. Cobertura = Fondos / Marketing Cost. Neto = Fondos − Marketing Cost.
 *   1. Lectura en una frase (FY real + proyección y lo que va del año).
 *   2. Cuatro cards (YTD real): Marketing Cost YTD, H1 y H2, y el Neto YTD, contra el Goal de la barra (solo ese).
 *   3. "¿Cómo viene?": por mes, barras apiladas Media Revenue + Overs y la línea de Marketing Cost (un solo eje en USD).
 *   4. Waterfall del Marketing Cost por país para el período de Filtros: Goal → Δ de cada país → Real (+ proyección), con el
 *      gasto, el Goal y el desvío % debajo de cada país. (El puente de Neto y las tablas mes a mes / por país se sacaron el
 *      2026-11-05 a pedido de Diego.)
 * Overs no tiene Budget, Run Rate ni LY: en la meta va su Forecast (se aclara en la nota). Los datos son los de getMarketingData
 * del Hub (Total B2B, sin Channels; el switch Organic aplica al Media Revenue y al Marketing, no a los Overs).
 */
(function () {
  'use strict';
  var W = window;
  // Overs en un violeta más claro que Media Revenue (2026-11-05, Diego): los dos son fondos. Marketing Cost en naranja.
  var C = { med: '#550fed', ov: '#a780ff', cost: '#eb6834' };

  var css = document.createElement('style');
  css.textContent = [
    '#hms{font-family:Poppins,-apple-system,"Segoe UI",sans-serif;color:#3d3b52}',
    '#hms .hms-lead{font-size:15px;line-height:1.55;margin:0 0 6px;max-width:1150px}#hms .hms-lead b{color:#12111e}',
    '#hms .hms-ctx{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:#8a88a0;margin:0 0 12px}',
    '#hms .hms-goal{display:inline-flex;align-items:center;gap:6px;background:#f1ecfe;color:#3d00d1;font-weight:600;border-radius:999px;padding:3px 10px}',
    '#hms .hms-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}',
    '@media (max-width:1000px){#hms .hms-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '#hms .hms-tile{background:#fff;border:1px solid #ebe8f3;border-radius:12px;padding:14px 16px}',
    '#hms .hms-tile .k{font-size:11.5px;font-weight:600;color:#6b6b85;text-transform:uppercase;letter-spacing:.4px}',
    '#hms .hms-tile .v{font-size:26px;font-weight:700;color:#12111e;margin:4px 0 2px;font-variant-numeric:tabular-nums}',
    '#hms .hms-tile .d{font-size:12.5px;font-weight:600}#hms .hms-tile .s{font-size:11.5px;color:#8a88a0;margin-top:4px;line-height:1.4}',
    '#hms .hms-sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:0}',
    '#hms .g{color:#1a7f37}#hms .a{color:#9a6700}#hms .r{color:#cf222e}#hms .n{color:#8a88a0}',
    '#hms .hms-card{background:#fff;border:1px solid #ebe8f3;border-radius:12px;padding:16px 18px;margin-top:14px}',
    '#hms .hms-card h3{font-size:14px;font-weight:700;color:#12111e;margin:0 0 2px}',
    '#hms .hms-sub{font-size:12px;color:#8a88a0;margin:0 0 10px;line-height:1.45}',
    '#hms .hms-chart{position:relative;height:350px}',
    '#hms .hms-note{font-size:11.5px;color:#8a88a0;margin:10px 0 0;line-height:1.45}',
  ].join('\n');
  document.head.appendChild(css);

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return s + '$' + Math.round(a / 1e3) + 'K';
    return s + '$' + Math.round(a);
  }
  function signed(v) { return (v > 0 ? '+' : '') + money(v); }
  function pct(a, b) { return b ? (a - b) / Math.abs(b) * 100 : null; }
  function pctTxt(p) { if (p === null || !isFinite(p)) return ''; var a = Math.abs(p); return (p >= 0 ? '+' : '−') + (a < 10 ? a.toFixed(1) : a.toFixed(0)) + '%'; }
  function covTxt(c) { return c === null || !isFinite(c) ? '—' : Math.round(c * 100) + '%'; }
  function tone(good) { return good === null ? 'n' : good ? 'g' : 'r'; }
  function monLbl(ym) { var p = ym.split('-'); return (W.MONTH_LABELS ? W.MONTH_LABELS[p[1]].slice(0, 3) : p[1]) + " '" + p[0].slice(2); }
  function lastAct() { return W._state && W._state.filters && W._state.filters.lastActuals; }

  // Serie mensual del Total (12 meses del FY). Marketing Cost en positivo (gasto).
  function series(total) {
    var c = W.withFcFilled(total), L = W.MKT_MON_LABELS, mk = W.mktGoalKey;
    var medG = c[mk('med')] || [], mktG = c[mk('mkt')] || [];
    var hasOv = !!c.oversActual;
    return L.map(function (ym, i) {
      var r = {
        ym: ym, proj: !!lastAct() && ym > lastAct(),
        med: c.medActual[i] || 0, ov: hasOv ? (c.oversActual[i] || 0) : 0, cost: -(c.mktActual[i] || 0),
        medG: medG[i] || 0, ovG: hasOv ? ((c.oversForecast || [])[i] || 0) : 0, costG: -(mktG[i] || 0), costLY: -((c.mktLY || [])[i] || 0),
      };
      r.fund = r.med + r.ov; r.fundG = r.medG + r.ovG; r.net = r.fund - r.cost; r.netG = r.fundG - r.costG;
      return r;
    });
  }
  function sumUp(rows) {
    var o = { med: 0, ov: 0, cost: 0, medG: 0, ovG: 0, costG: 0 };
    rows.forEach(function (r) { Object.keys(o).forEach(function (k) { o[k] += r[k]; }); });
    o.fund = o.med + o.ov; o.fundG = o.medG + o.ovG; o.net = o.fund - o.cost; o.netG = o.fundG - o.costG;
    o.cov = o.cost > 0 ? o.fund / o.cost : null; o.covG = o.costG > 0 ? o.fundG / o.costG : null;
    return o;
  }
  function pick(rows, per) { return per === 'ytd' ? rows.filter(function (r) { return !r.proj; }) : rows; }
  function perLabel(rows, per) {
    var fy = W.FY_TAG || 'FY';
    if (per === 'fy') return fy + ' (real + proyección)';
    var r = pick(rows, 'ytd');
    return r.length ? 'YTD ' + monLbl(r[0].ym) + ' – ' + monLbl(r[r.length - 1].ym) + ' (real)' : 'YTD';
  }

  function leadHtml(rows, goal) {
    var fy = sumUp(rows), ytd = sumUp(pick(rows, 'ytd'));
    var fyTag = W.FY_TAG || 'el año';
    var s = '<b>En ' + esc(fyTag) + ', Media Revenue y Overs suman ' + money(fy.fund) + ' y cubren el ' + covTxt(fy.cov) + ' del marketing (' + money(fy.cost) + ')';
    s += fy.net >= 0 ? ': sobran ' + money(fy.net) + '.</b>' : ': faltan ' + money(-fy.net) + '.</b>';
    var dn = fy.net - fy.netG;
    s += ' Contra ' + esc(goal) + ' (cobertura ' + covTxt(fy.covG) + '), el neto viene ' + (dn >= 0 ? 'mejor' : 'peor') + ' por ' + money(Math.abs(dn));
    // qué lo explica: el mayor de los tres efectos sobre el neto
    var eff = [['Media Revenue', fy.med - fy.medG], ['Overs', fy.ov - fy.ovG], ['el Marketing Cost', -(fy.cost - fy.costG)]];
    eff.sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); });
    if (Math.abs(eff[0][1]) >= 1000) {
      var e = eff[0];
      s += e[0] === 'el Marketing Cost'
        ? ', sobre todo por el Marketing Cost (' + (e[1] < 0 ? 'se gasta ' + money(-e[1]) + ' más' : 'se gasta ' + money(e[1]) + ' menos') + ' que ' + esc(goal) + ')'
        : ', sobre todo por ' + e[0] + ' (' + signed(e[1]) + ')';
    }
    s += '.';
    if (pick(rows, 'ytd').length) s += ' En lo que va del año (real) la cobertura es ' + covTxt(ytd.cov) + ' contra ' + covTxt(ytd.covG) + ' de ' + esc(goal) + '.';
    return '<p class="hms-lead">' + s + '</p>';
  }

  // Cards (2026-11-05, Diego): YTD real fijo. Marketing Cost del YTD, de H1 y de H2 (real + proyección) y el Neto del YTD.
  function ctxHtml(rows, goal) {
    return '<div class="hms-ctx"><span class="hms-goal">vs ' + esc(goal) + '</span><span>el Goal se cambia arriba, en la barra</span>' +
      '<span>Cards: ' + esc(perLabel(rows, 'ytd')) + ' · Total B2B · USD</span></div>';
  }

  function tilesHtml(rows, goal) {
    var y = sumUp(pick(rows, 'ytd'));
    var h1 = sumUp(rows.slice(0, 6)), h2 = sumUp(rows.slice(6, 12));
    var h2real = rows.slice(6, 12).every(function (r) { return !r.proj; }), h2any = rows.slice(6, 12).some(function (r) { return !r.proj; });
    var dl = function (a, b, moreIsGood) {
      var d = a - b, p = pct(a, b);
      if (!a && !b) return '<span class="n">—</span>';
      return '<span class="' + tone(moreIsGood ? d >= 0 : d <= 0) + '">' + signed(d) + (p === null ? '' : ' (' + pctTxt(p) + ')') + ' vs ' + esc(goal) + '</span>';
    };
    var cost = function (k, t, sub) {
      return '<div class="hms-tile"><div class="k">' + k + '</div><div class="v">' + money(t.cost) + '</div><div class="d">' + dl(t.cost, t.costG, false) + '</div>' +
        '<div class="s">' + sub + ' · ' + esc(goal) + ': ' + money(t.costG) + '</div></div>';
    };
    return '<div class="hms-tiles">' +
      cost('Marketing Cost · YTD', y, 'Real, marketing directo sin Channels') +
      cost('Marketing Cost · H1', h1, 'Abr – Sep · real') +
      cost('Marketing Cost · H2', h2, 'Oct – Mar · ' + (h2real ? 'real' : h2any ? 'real + proyección' : 'proyección (Run Rate)')) +
      '<div class="hms-tile"><div class="k">Neto · YTD</div><div class="v">' + signed(y.net) + '</div><div class="d">' + dl(y.net, y.netG, true) + '</div>' +
        '<div class="s">Media Revenue ' + money(y.med) + ' + Overs ' + money(y.ov) + ' − Marketing ' + money(y.cost) + '</div></div>' +
      '</div>';
  }

  function chartCardHtml(goal) {
    return '<div class="hms-card"><h3>¿Cómo viene evolucionando?</h3><p class="hms-sub">Por mes: los fondos (Media Revenue + Overs, barras apiladas) contra lo que se gasta en marketing (línea). ' +
      'Barras rayadas = proyección. Debajo de cada mes: el Neto (Media Revenue + Overs − Marketing Cost) y cuánto más (rojo) o menos (verde) se gasta en marketing que ' + esc(goal) + ' y que el año pasado. Pasá el mouse para ver el ' + esc(goal) + ' de cada mes.</p><div class="hms-chart"><canvas id="hms-chart" role="img" aria-label="Fondos y Marketing Cost por mes"></canvas></div></div>';
  }

  function drawChart(rows, goal) {
    var cv = document.getElementById('hms-chart');
    if (!cv || typeof W.Chart !== 'function') return;
    var labels = rows.map(function (r) { return monLbl(r.ym); });
    // Proyección: rayado del mismo color (con el violeta claro de Overs, un tono atenuado se confundía con Media Revenue)
    var pat = {};
    var hatch = function (hex) {
      if (pat[hex]) return pat[hex];
      var c = document.createElement('canvas'); c.width = c.height = 8;
      var x = c.getContext('2d');
      x.fillStyle = hex + '40'; x.fillRect(0, 0, 8, 8);
      x.strokeStyle = hex; x.lineWidth = 2;
      x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
      return (pat[hex] = cv.getContext('2d').createPattern(c, 'repeat'));
    };
    var fade = function (hex, r) { return r.proj ? hatch(hex) : hex; };
    if (typeof W.destroyChart === 'function') W.destroyChart('hms-chart');
    var ch = new W.Chart(cv, {
      type: 'bar',
      data: { labels: labels, datasets: [
        { label: 'Media Revenue', data: rows.map(function (r) { return r.med; }), stack: 'f', order: 2, backgroundColor: rows.map(function (r) { return fade(C.med, r); }), borderColor: '#fff', borderWidth: { top: 2 }, borderRadius: 0, barPercentage: 0.62 },
        { label: 'Overs', data: rows.map(function (r) { return r.ov; }), stack: 'f', order: 2, backgroundColor: rows.map(function (r) { return fade(C.ov, r); }), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: false, barPercentage: 0.62 },
        { label: 'Marketing Cost', data: rows.map(function (r) { return r.cost; }), type: 'line', order: 1, borderColor: C.cost, backgroundColor: C.cost, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: '#fff', pointBorderWidth: 2, tension: 0.25,
          segment: { borderDash: function (ctx) { return rows[ctx.p1DataIndex] && rows[ctx.p1DataIndex].proj ? [5, 4] : undefined; } } },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 16, bottom: 58, left: 52 } },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { color: '#57606a', font: { size: 11 }, boxWidth: 12 } },
          tooltip: { callbacks: {
            title: function (it) { var r = rows[it[0].dataIndex]; return it[0].label + (r.proj ? ' · proyección' : ' · real'); },
            label: function (c) { return ' ' + c.dataset.label + ': ' + money(c.raw); },
            footer: function (it) {
              var r = rows[it[0].dataIndex], cov = r.cost > 0 ? r.fund / r.cost : null, covG = r.costG > 0 ? r.fundG / r.costG : null;
              return ['Fondos: ' + money(r.fund) + ' · ' + goal + ': ' + money(r.fundG), 'Cobertura: ' + covTxt(cov) + ' · ' + goal + ': ' + covTxt(covG), 'Neto: ' + signed(r.net) + ' (' + signed(r.net - r.netG) + ' vs ' + goal + ')'];
            },
          } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: '#57606a', font: { size: 10.5 } } },
          y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(0,0,0,.05)' }, border: { display: false }, ticks: { color: '#57606a', font: { size: 10 }, callback: function (v) { return money(v); } } },
        },
      },
      plugins: [labelsPlugin(rows)],
    });
    if (W._charts) W._charts['hms-chart'] = ch;
  }

  // Etiquetas de datos: Media Revenue y Overs dentro de su tramo (si entra), el total de fondos arriba de la barra, el Marketing
  // Cost en una pastilla junto a su punto y, debajo de cada mes, el Neto (Media Revenue + Overs − Marketing Cost).
  function labelsPlugin(rows) {
    var k = function (v) { var a = Math.abs(v), sg = v < 0 ? '−' : ''; return a >= 1e6 ? sg + (a / 1e6).toFixed(1) + 'M' : sg + Math.round(a / 1e3) + 'K'; };
    return {
      id: 'hmsLabels',
      afterDatasetsDraw: function (chart) {
        var ctx = chart.ctx, mMed = chart.getDatasetMeta(0), mOv = chart.getDatasetMeta(1), mCost = chart.getDatasetMeta(2);
        ctx.save();
        ctx.textAlign = 'center';
        rows.forEach(function (r, i) {
          var bm = mMed.data[i], bo = mOv.data[i];
          ctx.font = '600 10px Poppins,-apple-system,sans-serif'; ctx.textBaseline = 'middle';
          var pt0 = mCost.data[i];
          [[bm, r.med, r.proj ? '#12111e' : '#fff'], [bo, r.ov, '#12111e']].forEach(function (x) {
            var el = x[0];
            if (!el || !x[1] || Math.abs(el.base - el.y) < 16) return;
            var top = Math.min(el.y, el.base), bot = Math.max(el.y, el.base), y = (top + bot) / 2;
            if (pt0 && r.cost && Math.abs(y - pt0.y) < 11) {   // el punto del Marketing Cost cae sobre la etiqueta: se corre a donde haya lugar
              var below = pt0.y + 12, above = pt0.y - 12;
              y = below + 6 <= bot ? below : above - 6 >= top ? above : null;
            }
            if (y === null) return;
            if (r.proj) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(k(x[1]), el.x, y); }   // halo sobre el rayado
            ctx.fillStyle = x[2];
            ctx.fillText(k(x[1]), el.x, y);
          });
          if (bo && r.fund) {   // total de fondos arriba de la barra
            ctx.font = '700 10.5px Poppins,-apple-system,sans-serif'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#12111e';
            ctx.fillText(k(r.fund), bo.x, Math.min(bo.y, bm.y) - 3);
          }
          var pt = mCost.data[i];
          if (pt && r.cost) {   // Marketing Cost: pastilla blanca con borde del color de la serie, a la derecha de la barra
            ctx.font = '600 9.5px Poppins,-apple-system,sans-serif'; ctx.textBaseline = 'middle';
            var t = k(r.cost), w = ctx.measureText(t).width + 8, x0 = pt.x + (bm && bm.width ? bm.width / 2 : 7) + 3, y0 = pt.y - 8;   // fuera de la barra: no pisa las etiquetas de adentro
            ctx.fillStyle = '#fff'; ctx.strokeStyle = C.cost; ctx.lineWidth = 1;
            ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0, y0, w, 15, 4); else ctx.rect(x0, y0, w, 15); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#3d3b52'; ctx.textAlign = 'left'; ctx.fillText(t, x0 + 4, y0 + 7.5); ctx.textAlign = 'center';
          }
        });
        // Fila "Neto" debajo de los meses
        var xs = chart.scales.x, yN = xs.bottom + 12;
        ctx.font = '700 10.5px Poppins,-apple-system,sans-serif'; ctx.textBaseline = 'middle';
        rows.forEach(function (r, i) {
          ctx.fillStyle = r.net >= 0 ? '#1a7f37' : '#cf222e';
          ctx.fillText((r.net > 0 ? '+' : '') + k(r.net), xs.getPixelForValue(i), yN);
        });
        // Δ del Marketing Cost vs el Goal y vs LY (más gasto = rojo)
        var yG = yN + 16, yL = yN + 32, goalLbl = W.mktGoalLabel();
        ctx.font = '600 10px Poppins,-apple-system,sans-serif';
        rows.forEach(function (r, i) {
          var x = xs.getPixelForValue(i);
          [[r.cost - r.costG, r.costG, yG], [r.cost - r.costLY, r.costLY, yL]].forEach(function (z) {
            if (!z[1] && !r.cost) { ctx.fillStyle = '#8a88a0'; ctx.fillText('—', x, z[2]); return; }
            ctx.fillStyle = Math.round(z[0] / 1000) === 0 ? '#8a88a0' : z[0] > 0 ? '#cf222e' : '#1a7f37';
            ctx.fillText((z[0] > 0 ? '+' : '') + k(z[0]), x, z[2]);
          });
        });
        ctx.textAlign = 'right'; ctx.fillStyle = '#6b6b85'; ctx.font = '600 10px Poppins,-apple-system,sans-serif';
        ctx.fillText('Neto', chart.chartArea.left - 6, yN);
        ctx.fillText('Δ Mkt vs ' + goalLbl, chart.chartArea.left - 6, yG);
        ctx.fillText('Δ Mkt vs LY', chart.chartArea.left - 6, yL);
        ctx.restore();
      },
    };
  }

  // Waterfall del Marketing Cost: Goal → Δ de cada país → Baseline, para el período elegido en Filtros (2026-11-05, Diego).
  // Debajo de cada país: el gasto del período, el del Goal y el desvío en %.
  function wfMonths() {
    var sel = (W._state && W._state.selectedPeriods || []).slice().sort();
    var L = W.MKT_MON_LABELS;
    sel = sel.filter(function (ym) { return L.indexOf(ym) >= 0; });
    return sel.length ? sel : L.slice();
  }
  function wfPerLabel(ms) {
    var la = lastAct(), real = !la || ms[ms.length - 1] <= la;
    var p = ms.length === 1 ? monLbl(ms[0]) : monLbl(ms[0]) + ' – ' + monLbl(ms[ms.length - 1]);
    return { txt: p, base: real ? 'Real' : 'Real + proyección' };
  }
  function costByCountry(d, ms) {
    var mk = W.mktGoalKey, L = W.MKT_MON_LABELS;
    var acc = function (c0) {
      var c = W.withFcFilled(c0), o = { cost: 0, costG: 0 };
      ms.forEach(function (ym) {
        var i = L.indexOf(ym);
        o.cost -= c.mktActual[i] || 0; o.costG -= (c[mk('mkt')] || [])[i] || 0;
      });
      return o;
    };
    var tot = null, list = [];
    d.byCountry.forEach(function (c) {
      var o = acc(c);
      if (c.id === 'total') { tot = o; return; }
      o.name = c.label === 'OPS+RG' ? 'OPS + RG' : c.label; o.d = o.cost - o.costG;
      list.push(o);
    });
    var sd = list.reduce(function (a2, o) { return a2 + o.d; }, 0);
    if (tot && Math.abs((tot.cost - tot.costG) - sd) >= 1000) list.push({ name: 'Otros', d: (tot.cost - tot.costG) - sd, cost: null, costG: null });
    list = list.filter(function (o) { return Math.abs(o.d) >= 500; }).sort(function (x, y) { return Math.abs(y.d) - Math.abs(x.d); });
    return { tot: tot, list: list };
  }
  function costWfHtml(rows, goal) {
    var pl = wfPerLabel(wfMonths());
    return '<div class="hms-card"><h3>¿Dónde se desvía el gasto? Marketing Cost por país</h3><p class="hms-sub">' + esc(pl.txt) + ' (período de Filtros)' +
      ': de ' + esc(goal) + ' a ' + esc(pl.base) + ', con el aporte de cada país al desvío. Debajo de cada país: gasto del período, el de ' + esc(goal) +
      ' y el desvío en %. Rojo = se gasta más que ' + esc(goal) + '; verde = menos.</p>' +
      '<div class="hms-chart" style="height:340px"><canvas id="hms-wf" role="img" aria-label="Waterfall de Marketing Cost por país"></canvas></div></div>';
  }
  function drawCostWf(d, goal) {
    var cv = document.getElementById('hms-wf');
    if (!cv || typeof W.Chart !== 'function') return;
    var ms = wfMonths(), pl = wfPerLabel(ms), w = costByCountry(d, ms);
    if (!w.tot) return;
    var labels = [goal], data = [[0, w.tot.costG]], col = ['#9a98b0'], vals = [w.tot.costG];
    var subs = [{ a: null, g: w.tot.costG }];
    var run = w.tot.costG;
    w.list.forEach(function (o) {
      labels.push(o.name); data.push([run, run + o.d]); vals.push(o.d);
      col.push(o.d > 0 ? '#cf222e' : '#1a7f37'); run += o.d;
      subs.push({ a: o.cost, g: o.costG });
    });
    labels.push(pl.base); data.push([0, w.tot.cost]); col.push('#550fed'); vals.push(w.tot.cost);
    subs.push({ a: w.tot.cost, g: w.tot.costG });
    var k = function (v, sg) { if (v === null || v === undefined) return '—'; var a2 = Math.abs(v), s2 = v < 0 ? '−' : sg && v > 0 ? '+' : ''; return s2 + '$' + (a2 >= 1e6 ? (a2 / 1e6).toFixed(2) + 'M' : Math.round(a2 / 1e3) + 'K'); };
    if (typeof W.destroyChart === 'function') W.destroyChart('hms-wf');
    var last = labels.length - 1;
    var ch = new W.Chart(cv, {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: 'Marketing Cost', data: data, backgroundColor: col, borderRadius: 4, borderSkipped: false, barPercentage: 0.7 }] },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22, bottom: 40 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (c) { var i = c.dataIndex; return ' ' + (i === 0 || i === last ? 'Marketing Cost: ' + k(vals[i]) : 'Δ vs ' + goal + ': ' + k(vals[i], true)); } } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#12111e', font: { size: 11, weight: '600' } } },
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.05)' }, border: { display: false }, ticks: { color: '#57606a', font: { size: 10 }, callback: function (v) { return money(v); } } },
        },
      },
      plugins: [{
        id: 'hmsWfLabels',
        afterDatasetsDraw: function (chart) {
          var ctx = chart.ctx, meta = chart.getDatasetMeta(0), xs = chart.scales.x;
          ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          meta.data.forEach(function (el, i) {
            var tot = i === 0 || i === last;
            ctx.font = (tot ? '700 11px' : '600 10.5px') + ' Poppins,-apple-system,sans-serif';
            ctx.fillStyle = tot ? '#12111e' : vals[i] > 0 ? '#cf222e' : '#1a7f37';
            ctx.fillText(tot ? k(vals[i]) : k(vals[i], true), el.x, Math.min(el.y, el.base) - 4);
          });
          // Debajo de cada país: gasto del período · Goal y el desvío en %
          var y1 = xs.bottom + 12, y2 = xs.bottom + 27;
          ctx.textBaseline = 'middle';
          subs.forEach(function (sb, i) {
            var x = xs.getPixelForValue(i);
            ctx.font = '500 10px Poppins,-apple-system,sans-serif'; ctx.fillStyle = '#6b6b85';
            ctx.fillText(i === 0 ? '' : k(sb.a) + ' · ' + goal + ' ' + k(sb.g), x, y1);
            if (i === 0) return;
            var p = sb.a === null || !sb.g ? null : (sb.a - sb.g) / Math.abs(sb.g) * 100;
            ctx.font = '700 10.5px Poppins,-apple-system,sans-serif';
            ctx.fillStyle = p === null ? '#8a88a0' : p > 0 ? '#cf222e' : '#1a7f37';
            ctx.fillText(p === null ? (sb.a ? 'sin ' + goal : '—') : pctTxt(p), x, y2);
          });
          ctx.restore();
        },
      }],
    });
    if (W._charts) W._charts['hms-wf'] = ch;
  }

  function render(d) {
    var section = document.getElementById('marketing-section');
    if (!section || !d || !d.months) return;
    var orig = section.querySelector('.evo-card'), host = document.getElementById('hms');
    if (!host) {
      host = document.createElement('div');
      host.id = 'hms';
      section.insertBefore(host, orig);
      host.addEventListener('click', function (ev) {

      });
    }
    var total = d.byCountry.filter(function (c) { return c.id === 'total'; })[0];
    if (!total) throw new Error('sin total');
    var goal = W.mktGoalLabel();
    var rows = series(total);
    d.__rows = rows;
    var t = section.querySelector('.sec-title');
    if (t) t.textContent = 'Marketing & Media Investment: ¿cómo se financia el marketing?';
    var ovNote = W._state && W._state.goal === 'forecast' ? '' : ' Overs no tiene ' + goal + ': en la meta va su Forecast.';
    host.innerHTML = leadHtml(rows, goal) + ctxHtml(rows, goal) + tilesHtml(rows, goal) + chartCardHtml(goal) + costWfHtml(rows, goal) +
      '<p class="hms-note">Fondos = Media Revenue del P&L contable + Overs (sobrecomisión de Media Sales, Metabase): los dos financian el marketing. ' +
      'Marketing Cost = marketing directo, sin Channels. Overs: meses cerrados con el real; el mes en curso y los siguientes, con su forecast; no cambia con Organic.' + esc(ovNote) +
      ' Total B2B (HTML + API).</p>';
    drawChart(rows, goal);
    drawCostWf(d, goal);
    if (orig) orig.style.display = 'none';
    host.style.display = '';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var orig = W.renderMarketing;
    if (typeof orig !== 'function') return;
    W.renderMarketing = function (d) {
      try {
        render(d);
      } catch (e) {
        console.warn('[hub-mkt-story] se usa la sección original:', e);
        var host = document.getElementById('hms'), sec = document.getElementById('marketing-section');
        if (host) host.style.display = 'none';
        var card = sec && sec.querySelector('.evo-card');
        if (card) card.style.display = '';
        orig.apply(this, arguments);
      }
    };
    // Marketing puede llegar antes que los filtros del P&L (sin "último mes real" no hay corte real / proyección):
    // cuando el Hub vuelve a dibujar y ese mes cambió, se rearma la sección.
    var drawnWith = null, rend = W.render;
    if (typeof rend === 'function') {
      W.render = function () {
        var r = rend.apply(this, arguments);
        try {
          var la = (lastAct() || '') + '|' + wfMonths().join(',');
          if (la !== drawnWith && W._mktData && document.getElementById('hms')) W.renderMarketing(W._mktData);
        } catch (e) { /* no rompe el Hub */ }
        return r;
      };
    }
    var mark = W.renderMarketing;
    W.renderMarketing = function () { drawnWith = (lastAct() || '') + '|' + wfMonths().join(','); return mark.apply(this, arguments); };
  });
})();
