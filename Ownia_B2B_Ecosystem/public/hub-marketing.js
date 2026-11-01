/* "Marketing & Media Investment" del P&L Dashboard (B2B) en Ownia, 2026-10-31. Mismos datos que la sección del Hub
 * (getMarketingData: marketing-direct y media & other revenue, sin Channels); cambia la lectura:
 *  - "¿Se paga el marketing?": Media Revenue, Marketing Cost, Neto y Media Revenue por $ de marketing en H1 / H2 / FY.
 *  - Un gráfico: Neto mensual contra el Goal y Marketing Cost como % del Net Revenue.
 *  - Una fila por país, del peor desvío de Neto al mejor; el detalle mensual se abre con un clic.
 * Compara contra el Goal del tablero (Budget por defecto). El Marketing Cost se muestra como gasto en positivo: más gasto
 * que el Goal es rojo. Si algo falla, se vuelve a la tabla original del Hub (queda oculta en la página).
 */
(function () {
  'use strict';
  var st = { period: 'fy', open: {} };
  var HALF = { fy: 'FY', h1: 'H1', h2: 'H2' };

  var css = document.createElement('style');
  css.textContent = [
    '#hmk{font-family:Poppins,-apple-system,"Segoe UI",sans-serif;color:#3d3b52}',
    '#hmk .hmk-read{font-size:14.5px;line-height:1.55;margin:0 0 14px;max-width:1100px}#hmk .hmk-read b{color:#12111e}',
    '#hmk .hmk-card{background:#fff;border:1px solid #ebe8f3;border-radius:12px;padding:16px 18px;margin-top:14px}',
    '#hmk .hmk-card h3{font-size:14px;font-weight:700;color:#12111e;margin:0 0 2px}',
    '#hmk .hmk-sub{font-size:12px;color:#8a88a0;margin:0 0 10px}',
    '#hmk .g{color:#1a7f37}#hmk .a{color:#9a6700}#hmk .r{color:#cf222e}#hmk .n{color:#8a88a0}',
    '#hmk .hmk-wrap{overflow-x:auto}',
    '#hmk table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}',
    '#hmk th{font-size:11.5px;font-weight:600;color:#6b6b85;text-align:right;padding:6px 10px;border-bottom:1px solid #ebe8f3;white-space:nowrap}',
    '#hmk th small{display:block;font-size:10.5px;font-weight:500;color:#8a88a0}',
    '#hmk td{text-align:right;padding:8px 10px;border-bottom:1px solid #f4f2f9;white-space:nowrap}',
    '#hmk td:first-child,#hmk th:first-child{text-align:left}',
    '#hmk .hmk-sum td:first-child{font-weight:600;color:#12111e}#hmk .hmk-sum b{font-size:16px;color:#12111e;margin-right:8px}',
    '#hmk tr.hmk-strong td{background:#f7f5fd}',
    '#hmk .hmk-chart{position:relative;height:250px}',
    '#hmk .hmk-tog{display:inline-flex;gap:2px;background:#f4f2f9;border-radius:8px;padding:2px;margin-left:10px}',
    '#hmk .hmk-tog button{border:none;background:none;font:600 12px Poppins,sans-serif;color:#6b6b85;padding:3px 10px;border-radius:6px;cursor:pointer}',
    '#hmk .hmk-tog button[aria-pressed="true"]{background:#fff;color:#3d00d1;box-shadow:0 1px 3px rgba(18,17,30,.16)}',
    '#hmk .hmk-head{display:flex;align-items:center;flex-wrap:wrap;gap:4px}',
    '#hmk tr.hmk-row{cursor:pointer}#hmk tr.hmk-row:hover td{background:#faf8ff}',
    '#hmk tr.hmk-row:focus-visible{outline:2px solid #a780ff;outline-offset:-2px}',
    '#hmk tr.hmk-row td:first-child{font-weight:600;color:#12111e}',
    '#hmk .hmk-car{display:inline-block;width:12px;color:#8a88a0;font-size:10px}',
    '#hmk tr.hmk-total td{font-weight:700;color:#12111e;background:#f7f5fd;border-top:2px solid #ebe8f3}',
    '#hmk tr.hmk-det>td{background:#fbfafe;padding:6px 10px 12px}',
    '#hmk tr.hmk-det table{font-size:12px}#hmk tr.hmk-det td,#hmk tr.hmk-det th{padding:4px 6px}',
    '#hmk .hmk-proy{font-style:italic;color:#6b6b85}',
    '#hmk .hmk-note{font-size:11.5px;color:#8a88a0;margin:10px 0 0;line-height:1.45}#hmk .hmk-warn{color:#9a6700}',
  ].join('\n');
  document.head.appendChild(css);

  function canalNow() { var s = window._state; return s && s.lob === 'b2b' && (s.canal === 'may' || s.canal === 'min') ? s.canal : 'all'; }
  function bizLabel() { return { may: 'API', min: 'HTML', all: 'B2B' }[canalNow()]; }
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
  function pctTxt(p) {
    if (p === null || !isFinite(p)) return '';
    var a = Math.abs(p);
    return (p >= 0 ? '+' : '−') + (a < 10 ? a.toFixed(1) : a.toFixed(0)) + '%';
  }
  function times(v) { return v === null || !isFinite(v) ? '—' : v.toFixed(2) + 'x'; }
  function tone(p) { return p === null || !isFinite(p) ? 'n' : p < -5 ? 'r' : p < 0 ? 'a' : 'g'; }   // mismo semáforo que el resto del Hub

  // Acumula un período: gasto en positivo y cobertura solo si hay gasto.
  function stats(c, months) {
    var mk = window.mktGoalKey, medK = mk('med'), mktK = mk('mkt');
    var m = { med: 0, medG: 0, cost: 0, costG: 0 };
    months.forEach(function (ym) {
      var i = window.MKT_MON_LABELS.indexOf(ym);
      if (i < 0) return;
      m.med += c.medActual[i] || 0; m.medG += c[medK][i] || 0;
      m.cost -= c.mktActual[i] || 0; m.costG -= c[mktK][i] || 0;
    });
    m.net = m.med - m.cost;
    m.netG = m.medG - m.costG;
    m.cov = m.cost > 0 ? m.med / m.cost : null;
    m.covG = m.costG > 0 ? m.medG / m.costG : null;
    return m;
  }
  function periods() {
    var FY = window.FY_MONTHS;
    return { fy: FY.slice(), h1: FY.slice(0, 6), h2: FY.slice(6, 12) };
  }

  function deltaCell(a, b, moreIsBad) {
    var d = a - b, p = pct(a, b), t = tone(moreIsBad && p !== null ? -p : p);
    if (!b && !a) return '<span class="n">—</span>';
    if (!b) t = (moreIsBad ? -d : d) >= 0 ? 'g' : 'r';
    return '<span class="' + t + '">' + signed(d) + (p === null ? '' : ' (' + pctTxt(p) + ')') + '</span>';
  }

  function summaryHtml(total, goal) {
    var P = periods(), last = window._state && window._state.filters && window._state.filters.lastActuals;
    var S = { h1: stats(total, P.h1), h2: stats(total, P.h2), fy: stats(total, P.fy) };
    var h2Lbl = last && last >= P.h2[0] ? 'real + proyección' : 'proyección (Run Rate)';
    var row = function (name, cell, cls) {
      return '<tr class="' + (cls || '') + '"><td>' + name + '</td>' + ['h1', 'h2', 'fy'].map(function (k) { return '<td>' + cell(S[k]) + '</td>'; }).join('') + '</tr>';
    };
    var money2 = function (a, b, bad) { return function (x) { return '<b>' + money(x[a]) + '</b>' + deltaCell(x[a], x[b], bad); }; };
    return '<div class="hmk-card"><h3>¿Se paga el marketing?</h3><p class="hmk-sub">Marketing directo contra Media Revenue · ' + esc(bizLabel()) + ' · USD · vs ' + esc(goal) + '</p>' +
      '<div class="hmk-wrap"><table class="hmk-sum"><thead><tr><th></th>' +
      '<th>H1<small>abr–sep · real</small></th><th>H2<small>oct–mar · ' + h2Lbl + '</small></th><th>' + esc(window.FY_TAG || 'FY') + '<small>cierre proyectado</small></th></tr></thead><tbody>' +
      row('Media Revenue', money2('med', 'medG', false)) +
      row('Marketing Cost', money2('cost', 'costG', true)) +
      row('Neto (Media Revenue − Marketing)', money2('net', 'netG', false), 'hmk-strong') +
      row('Media Revenue por $ de marketing', function (x) {
        return '<b>' + times(x.cov) + '</b><span class="' + (x.cov === null || x.covG === null ? 'n' : x.cov >= x.covG ? 'g' : 'r') + '">vs ' + times(x.covG) + '</span>';
      }) + '</tbody></table></div></div>';
  }

  function readHtml(total, rows, goal) {
    var f = stats(total, periods().fy);
    var verb = f.cost >= f.costG ? 'sube' : 'baja';
    var s = '<b>En ' + esc(window.FY_TAG || 'el año') + ', el neto de marketing queda en ' + signed(f.net) + ' contra ' + signed(f.netG) + ' de ' + esc(goal) +
      (f.netG ? ' (' + pctTxt(pct(f.net, f.netG)) + ')' : '') + '.</b> Media Revenue ' + pctTxt(pct(f.med, f.medG)) + ' y el gasto ' + verb + ' ' + pctTxt(Math.abs(pct(f.cost, f.costG) || 0)).replace('+', '') + '.';
    if (f.cov !== null && f.covG !== null) s += ' Por cada $1 de marketing hay $' + f.cov.toFixed(2) + ' de Media Revenue (' + esc(goal) + ': $' + f.covG.toFixed(2) + ').';
    var w = rows.filter(function (r) { return r.f.net < r.f.netG; })[0];
    if (w) s += ' El mayor desvío está en <b>' + esc(w.name) + '</b>: ' + signed(w.f.net) + ' contra ' + signed(w.f.netG) + '.';
    return '<p class="hmk-read">' + s + '</p>';
  }

  function chartCardHtml(goal) {
    return '<div class="hmk-card"><h3>Neto de marketing por mes</h3><p class="hmk-sub" id="hmk-chart-sub">Media Revenue − Marketing Cost vs ' + esc(goal) + '</p>' +
      '<div class="hmk-chart"><canvas id="hmk-chart"></canvas></div></div>';
  }

  function nrByMonth() {
    var s = window._state, e = s && s.evo;
    // El canal no cuenta: el marketing y el Net Revenue siguen al mismo negocio (B2B, HTML o API).
    var filtered = (window._selectedPaises || []).length || (window._selectedProducto && window._selectedProducto !== 'all');
    if (!e || !e.metrics || filtered || (s && s.lob !== 'b2b')) return null;
    var m = e.metrics.filter(function (x) { return x.id === 'nr'; })[0];
    if (!m) return null;
    return window.MKT_MON_LABELS.map(function (ym) { var i = e.periods.indexOf(ym); return i >= 0 ? m.actuals[i] : null; });
  }

  function drawChart(total, goal) {
    var cv = document.getElementById('hmk-chart');
    if (!cv || typeof window.Chart !== 'function') return;
    var mk = window.mktGoalKey, medK = mk('med'), mktK = mk('mkt'), L = window.MKT_MON_LABELS;
    var last = window._state && window._state.filters && window._state.filters.lastActuals;
    var net = L.map(function (ym, i) { return (total.medActual[i] || 0) + (total.mktActual[i] || 0); });
    var netG = L.map(function (ym, i) { return (total[medK][i] || 0) + (total[mktK][i] || 0); });
    var nr = nrByMonth();
    var share = nr ? L.map(function (ym, i) { return nr[i] ? -(total.mktActual[i] || 0) / nr[i] * 100 : null; }) : null;
    var sub = document.getElementById('hmk-chart-sub');
    if (sub) sub.textContent = 'Media Revenue − Marketing Cost vs ' + goal + ' · barras claras: proyección' + (share ? ' · línea: Marketing Cost como % del Net Revenue de ' + bizLabel() : ' · el % del Net Revenue se ve sin filtros de país o producto');
    var labels = window.mktGroups('M').map(function (g) { return g.label; });
    var fmt = window.fmtK || money;
    var sets = [
      { label: 'Neto', data: net, order: 2, borderRadius: 3, yAxisID: 'y', backgroundColor: L.map(function (ym) { return !last || ym <= last ? '#550fed' : '#b9a2f7'; }) },
      { label: 'Neto ' + goal, data: netG, order: 3, borderRadius: 3, yAxisID: 'y', backgroundColor: '#dcdce4' },
    ];
    if (share) sets.push({ label: 'Marketing Cost % Net Revenue', data: share, type: 'line', order: 1, yAxisID: 'y2', borderColor: '#cf222e', backgroundColor: '#cf222e', pointRadius: 3, borderWidth: 2, tension: 0.25, fill: false });
    if (typeof window.destroyChart === 'function') window.destroyChart('hmk-chart');
    var ch = new window.Chart(cv, {
      type: 'bar',
      data: { labels: labels, datasets: sets },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
        plugins: {
          legend: { labels: { color: '#57606a', font: { size: 11 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + (c.dataset.yAxisID === 'y2' ? c.raw.toFixed(1) + '%' : fmt(c.raw)); } } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#57606a', font: { size: 10 } } },
          y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { color: '#57606a', font: { size: 10 }, callback: function (v) { return fmt(v); } } },
          y2: { display: !!share, position: 'right', beginAtZero: true, grid: { display: false }, ticks: { color: '#cf222e', font: { size: 10 }, callback: function (v) { return v + '%'; } } },
        },
      },
      plugins: [{
        id: 'hmkLabels',
        afterDatasetsDraw: function (chart) {
          var meta = chart.getDatasetMeta(0), ctx = chart.ctx;
          meta.data.forEach(function (el, i) {
            ctx.save();
            ctx.font = '600 9.5px -apple-system,sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#3d3b52';
            ctx.textBaseline = net[i] >= 0 ? 'bottom' : 'top';
            ctx.fillText(money(net[i]), el.x, el.y + (net[i] >= 0 ? -3 : 3));
            ctx.restore();
          });
        },
      }],
    });
    if (window._charts) window._charts['hmk-chart'] = ch;
  }

  function detailHtml(c, goal) {
    var mk = window.mktGoalKey, medK = mk('med'), mktK = mk('mkt'), L = window.MKT_MON_LABELS;
    var last = window._state && window._state.filters && window._state.filters.lastActuals;
    var labels = window.mktGroups('M').map(function (g) { return g.label; });
    var cls = function (i) { return last && L[i] > last ? ' class="hmk-proy"' : ''; };
    var row = function (name, get, fmtCell) {
      return '<tr><td>' + name + '</td>' + L.map(function (ym, i) { return '<td' + cls(i) + '>' + (fmtCell || money)(get(i)) + '</td>'; }).join('') + '</tr>';
    };
    var net = function (i) { return (c.medActual[i] || 0) + (c.mktActual[i] || 0); };
    var netG = function (i) { return (c[medK][i] || 0) + (c[mktK][i] || 0); };
    return '<div class="hmk-wrap"><table><thead><tr><th></th>' + labels.map(function (l, i) { return '<th' + cls(i) + '>' + esc(l) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      row('Media Revenue', function (i) { return c.medActual[i] || 0; }) +
      row('Marketing Cost', function (i) { return -(c.mktActual[i] || 0); }) +
      row('Neto', net) +
      row('Neto ' + esc(goal), netG) +
      row('Δ', function (i) { return net(i) - netG(i); }, function (v) { return '<span class="' + (Math.round(v) < 0 ? 'r' : 'g') + '">' + signed(v) + '</span>'; }) +
      '</tbody></table></div>';
  }

  function tableHtml(rows, total, goal) {
    var mo = periods()[st.period];
    var line = function (id, name, f, cls, attrs) {
      return '<tr class="' + cls + '"' + (attrs || '') + '><td>' + name + '</td><td>' + money(f.med) + '</td><td>' + deltaCell(f.med, f.medG) + '</td>' +
        '<td>' + money(f.cost) + '</td><td>' + deltaCell(f.cost, f.costG, true) + '</td><td><b>' + money(f.net) + '</b></td><td>' + deltaCell(f.net, f.netG) + '</td>' +
        '<td>' + times(f.cov) + '</td><td class="n">' + times(f.covG) + '</td></tr>';
    };
    var body = rows.map(function (r) {
      var f = stats(r.c, mo), open = !!st.open[r.c.id];
      return { r: r, f: f, open: open };
    }).sort(function (a, b) { return (a.f.net - a.f.netG) - (b.f.net - b.f.netG); }).map(function (x) {
      var id = x.r.c.id;
      return line(id, '<span class="hmk-car">' + (x.open ? '▾' : '▸') + '</span>' + esc(x.r.name), x.f, 'hmk-row', ' data-c="' + esc(id) + '" tabindex="0" role="button" aria-expanded="' + x.open + '"') +
        (x.open ? '<tr class="hmk-det"><td colspan="9">' + detailHtml(x.r.c, goal) + '</td></tr>' : '');
    }).join('');
    var odd = [];
    rows.forEach(function (r) {
      var M = window.mktGroups('M');
      r.c.mktActual.forEach(function (v, i) { if ((v || 0) >= 500) odd.push(r.name + ' ' + M[i].label + ' (' + money(v) + ')'); });
    });
    return '<div class="hmk-card"><div class="hmk-head"><h3>Por país</h3><div class="hmk-tog" role="group" aria-label="Período de la tabla">' +
      ['h1', 'h2', 'fy'].map(function (k) { return '<button type="button" data-p="' + k + '" aria-pressed="' + (st.period === k) + '">' + HALF[k] + '</button>'; }).join('') +
      '</div></div><p class="hmk-sub">Del mayor desvío de Neto al menor · clic en un país para ver cada mes · vs ' + esc(goal) + '</p>' +
      '<div class="hmk-wrap"><table><thead><tr><th>País</th><th>Media Revenue</th><th>vs ' + esc(goal) + '</th><th>Marketing Cost</th><th>vs ' + esc(goal) + '</th><th>Neto</th><th>vs ' + esc(goal) + '</th><th>Por $ de marketing</th><th>' + esc(goal) + '</th></tr></thead><tbody>' +
      body + line('total', 'Total', stats(total, mo), 'hmk-total') + '</tbody></table></div>' +
      '<p class="hmk-note">Marketing Cost en positivo: más gasto que ' + esc(goal) + ' va en rojo. No incluye Channels (personal y gastos de canales).' +
      (odd.length ? ' <span class="hmk-warn">Costo con signo contrario (¿recupero o error de carga?): ' + esc(odd.join(', ')) + '.</span>' : '') + '</p></div>';
  }

  function render(d) {
    var section = document.getElementById('marketing-section');
    var host = document.getElementById('hmk');
    if (!section || !d || !d.months) return;
    var orig = section.querySelector('.evo-card');
    if (!host) {
      host = document.createElement('div');
      host.id = 'hmk';
      section.insertBefore(host, orig);
      var act = function (ev) {
        var p = ev.target.closest('[data-p]');
        if (p) { st.period = p.getAttribute('data-p'); render(window._mktData); return; }
        var tr = ev.target.closest('tr.hmk-row');
        if (tr) {
          var id = tr.getAttribute('data-c');
          st.open[id] = !st.open[id];
          render(window._mktData);
          var again = host.querySelector('tr.hmk-row[data-c="' + id + '"]');
          if (again) again.focus({ preventScroll: true });
        }
      };
      host.addEventListener('click', act);
      host.addEventListener('keydown', function (ev) {
        if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('tr.hmk-row')) { ev.preventDefault(); act(ev); }
      });
    }
    var goal = window.mktGoalLabel();
    var fill = window.withFcFilled;
    var all = d.byCountry.map(fill);
    var total = all.filter(function (c) { return c.id === 'total'; })[0];
    if (!total) throw new Error('sin total');
    var rows = all.filter(function (c) { return c.id !== 'total'; }).map(function (c) {
      return { c: c, name: c.label === 'OPS+RG' ? 'OPS + RG' : c.label, f: stats(c, periods().fy) };
    }).sort(function (a, b) { return (a.f.net - a.f.netG) - (b.f.net - b.f.netG); });
    var fy = stats(total, periods().fy);
    if (Math.abs(fy.med) < 1000 && Math.abs(fy.medG) < 1000 && Math.abs(fy.costG) < 1000) {
      // Hoy pasa en API: todo el Media Revenue y el Budget de marketing están en HTML. No hay nada para comparar.
      if (typeof window.destroyChart === 'function') window.destroyChart('hmk-chart');
      host.innerHTML = '<div class="hmk-card"><h3>Marketing de ' + esc(bizLabel()) + '</h3><p class="hmk-read" style="margin:6px 0 0">' +
        esc(bizLabel()) + ' no tiene Media Revenue ni Budget de marketing en ' + esc(window.FY_TAG || 'el año') + ': solo ' + money(fy.cost) +
        ' de marketing directo. El Media Revenue y el Budget de B2B están en HTML.</p></div>';
    } else {
      host.innerHTML = readHtml(total, rows, goal) + summaryHtml(total, goal) + chartCardHtml(goal) + tableHtml(rows, total, goal);
      drawChart(total, goal);
    }
    if (orig) orig.style.display = 'none';
    host.style.display = '';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var orig = window.renderMarketing;
    if (typeof orig !== 'function') return;
    window.renderMarketing = function (d) {
      try {
        render(d);
      } catch (e) {
        console.warn('[hub-marketing] se usa la tabla original:', e);
        var host = document.getElementById('hmk'), sec = document.getElementById('marketing-section');
        if (host) host.style.display = 'none';
        var card = sec && sec.querySelector('.evo-card');
        if (card) card.style.display = '';
        orig.apply(this, arguments);
      }
    };
    // Marketing por negocio: B2B, HTML o API. Reemplaza la carga del Hub para pedir también el canal (server/gas-extras/hub-marketing-canal.js).
    var loadedKey = null;
    window.loadMarketingData = function () {
      var org = window._organicTarget_(), canal = canalNow(), key = org + '|' + canal;
      if (loadedKey === key) return;
      loadedKey = key;
      window._mktOrgKey = org;
      window.google.script.run
        .withSuccessHandler(function (res) {
          if (loadedKey !== key) return;   // llegó tarde: ya se pidió otro negocio
          if (!res || !res.success) { loadedKey = null; return; }
          window._mktData = res;
          window.renderMarketing(res);
        })
        .withFailureHandler(function () { if (loadedKey === key) loadedKey = null; })
        .getMarketingDataCanal(org, canal);
    };
    // El % del Net Revenue sale de la evolución del P&L: si llega después, o cambian los filtros, se vuelve a dibujar.
    var rend = window.render;
    if (typeof rend === 'function') {
      window.render = function () {
        var r = rend.apply(this, arguments);
        try {
          if (window._state && window._state.lob === 'b2b') {
            var key = window._organicTarget_() + '|' + canalNow();
            if (loadedKey !== key) window.loadMarketingData();
            else if (window._mktData && document.getElementById('hmk')) window.renderMarketing(window._mktData);
          }
        } catch (e) { /* no rompe el Hub */ }
        return r;
      };
    }
  });
})();
