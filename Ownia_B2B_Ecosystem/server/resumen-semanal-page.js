// "Resumen semanal" (2026-11-02, Tiago): botón de la portada al lado de "Actualizar reales". La última semana cerrada
// (ISO, lunes a domingo, fecha de gestión) de B2B2C, B2B API y B2B HTML: un resumen en texto (como el del P&L de B2C,
// listo para pegar en Slack), tarjetas GB / NR / FVM vs Budget, LY, L4W y Run Rate, la serie de 13 semanas y la
// apertura por país. Los montos los da getResumenSemanal del Daily (server/gas-extras/daily-resumen-semanal.js, mismas
// filas que el Weekly); acá solo se suman y se arman los textos. Mismos permisos que el Daily (cualquier @despegar.com).
//
// Colores del gráfico: los tres primeros slots de la paleta de referencia de dataviz (azul / naranja / aqua), validados
// todos contra todos en claro y oscuro; el Budget además va punteado. Semáforo = el del Hub (_deltaState_): verde ≥ 0%,
// ámbar −5% a 0%, rojo < −5%.
const { shell, escapeHtml, CHEVRON_L } = require('./index-page');

const CSS = `<style>
  .viz-root { --s-act: #3987e5; --s-ly: #d95926; --s-bud: #199e70; --good: #0ca30c; --warn: #fab219; --crit: #d03b3b; }
  :root[data-theme="light"] .viz-root { --s-act: #2a78d6; --s-ly: #eb6834; --s-bud: #1baf7a; }
  .rs-hero { text-align: left; margin-bottom: 28px; }
  .rs-hero h1 { font-size: clamp(30px, 4.6vw, 44px); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
  .rs-hero p { margin-top: 8px; color: var(--text-2); font-size: 15px; }
  .rs-card { background: var(--tile); border-radius: 20px; padding: 24px 26px; box-shadow: inset 0 0 0 1px var(--line); }
  .rs-card + .rs-card, .rs-sec { margin-top: 20px; }
  .rs-card h2 { font-size: 13px; font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: .06em; }
  .rs-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .rs-head h2 { flex: 1; }
  .rs-copy { padding: 6px 14px; border-radius: 999px; border: 0; background: transparent; color: var(--text-2); font: 500 13px var(--font);
             cursor: pointer; box-shadow: inset 0 0 0 1px var(--line); }
  .rs-copy:hover { color: var(--link); box-shadow: inset 0 0 0 1px var(--link); }
  .rs-sum p { margin-top: 14px; font-size: 15.5px; line-height: 1.65; color: var(--text); }
  .rs-sum p b { font-weight: 600; }
  .rs-sum .lbl { display: inline-block; min-width: 86px; font-size: 12px; font-weight: 600; color: var(--text-2); text-transform: uppercase; letter-spacing: .05em; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin: 0 2px 0 4px; vertical-align: 1px; }
  .dot.g { background: var(--good); } .dot.a { background: var(--warn); } .dot.r { background: var(--crit); }
  .rs-tabs { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--tile); box-shadow: inset 0 0 0 1px var(--line); flex-wrap: wrap; }
  .rs-tabs button { padding: 7px 16px; border-radius: 999px; border: 0; background: transparent; color: var(--text-2); font: 500 14px var(--font); cursor: pointer; }
  .rs-tabs button[aria-selected="true"] { background: var(--primary); color: #fff; }
  .rs-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 32px; }
  .rs-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 16px; }
  .rs-kpi { background: var(--tile); border-radius: 18px; padding: 18px 18px 14px; box-shadow: inset 0 0 0 1px var(--line); }
  .rs-kpi .k { font-size: 13px; color: var(--text-2); }
  .rs-kpi .v { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .rs-kpi dl { display: grid; grid-template-columns: 1fr auto; gap: 3px 10px; margin-top: 10px; font-size: 13px; font-variant-numeric: tabular-nums; }
  .rs-kpi dt { color: var(--text-3); } .rs-kpi dd { text-align: right; color: var(--text); }
  .rs-chart-top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .rs-chart-top h2 { flex: 1; }
  .rs-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line); }
  .rs-seg button { padding: 4px 12px; border-radius: 999px; border: 0; background: transparent; color: var(--text-2); font: 500 12.5px var(--font); cursor: pointer; }
  .rs-seg button[aria-pressed="true"] { background: var(--tile-hover); color: var(--text); box-shadow: inset 0 0 0 1px var(--line); }
  .rs-legend { display: flex; gap: 16px; margin-top: 12px; font-size: 13px; color: var(--text-2); flex-wrap: wrap; }
  .rs-legend span { display: inline-flex; align-items: center; gap: 6px; }
  .rs-legend i { width: 18px; height: 0; border-top: 2px solid; display: inline-block; }
  .rs-legend i.dash { border-top-style: dashed; }
  .rs-plot { position: relative; margin-top: 8px; }
  .rs-plot svg { display: block; width: 100%; height: auto; overflow: visible; }
  .rs-plot .ax { fill: var(--text-3); font: 11px var(--font); font-variant-numeric: tabular-nums; }
  .rs-plot .grid { stroke: var(--line); }
  .rs-plot .dl { font: 600 11.5px var(--font); fill: var(--text-2); }
  .rs-tip { position: absolute; pointer-events: none; background: var(--bg); color: var(--text); border-radius: 12px; padding: 10px 12px; font-size: 12.5px;
            box-shadow: 0 10px 30px rgba(0,0,0,.3), inset 0 0 0 1px var(--line); min-width: 170px; font-variant-numeric: tabular-nums; display: none; z-index: 2; }
  .rs-tip b { display: block; margin-bottom: 4px; font-weight: 600; }
  .rs-tip div { display: flex; justify-content: space-between; gap: 14px; color: var(--text-2); }
  .rs-tip div span:last-child { color: var(--text); }
  .rs-tbl-wrap { overflow-x: auto; margin-top: 14px; }
  table.rs-tbl { width: 100%; border-collapse: collapse; font-size: 13.5px; font-variant-numeric: tabular-nums; }
  .rs-tbl th { text-align: right; font-weight: 500; color: var(--text-3); font-size: 12px; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  .rs-tbl th:first-child, .rs-tbl td:first-child { text-align: left; }
  .rs-tbl th.grp { text-align: center; color: var(--text-2); border-bottom: 0; padding-bottom: 0; }
  .rs-tbl td { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  .rs-tbl tr.tot td { font-weight: 600; border-bottom: 0; }
  .rs-tbl td.sep, .rs-tbl th.sep { border-left: 1px solid var(--line); }
  .neg { color: #ff6b6b; } .pos { color: #34c759; }
  :root[data-theme="light"] .neg { color: #c5221f; } :root[data-theme="light"] .pos { color: #137333; }
  .rs-det { margin-top: 12px; font-size: 13px; color: var(--text-2); }
  .rs-det summary { cursor: pointer; width: fit-content; }
  .rs-note { margin-top: 28px; font-size: 12.5px; color: var(--text-3); line-height: 1.6; }
  .rs-state { padding: 48px 0; text-align: center; color: var(--text-2); }
  @media (max-width: 820px) { .rs-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>`;

// El script de la página: pide los datos al Daily y arma todo. Sin dependencias.
const SCRIPT = String.raw`
(function () {
  'use strict';
  var root = document.getElementById('rs-root'), CFG = window.RS_CFG;
  var BIZ = [
    { k: 'all', lbl: 'Consolidado', long: 'Ecosistema B2B (B2B2C + B2B)' },
    { k: 'b2b2c', lbl: 'B2B2C', long: 'B2B2C' },
    { k: 'api', lbl: 'B2B API', long: 'B2B API' },
    { k: 'html', lbl: 'B2B HTML', long: 'B2B HTML' },
  ];
  var MET = { gb: 'Gross Bookings', rev: 'Net Revenues', fvm: 'FVM' };
  // Código de la bandera en Slack (:flag-xx:)
  var FLAG = { Argentina: 'ar', Brasil: 'br', Chile: 'cl', Colombia: 'co', Ecuador: 'ec',
    Mexico: 'mx', Peru: 'pe', Uruguay: 'uy', Paraguay: 'py', USA: 'us' };
  var NAME = { Mexico: 'México', Peru: 'Perú', 'Other Countries': 'Otros países', RG: 'Ajuste COI Brasil' };
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var D = null, sel = 'all', metric = 'rev';

  // ── Números ─────────────────────────────────────────────────────────────────────────────
  function z() { return { gb: 0, rev: 0, fvm: 0 }; }
  function add(a, b) { a.gb += b.gb || 0; a.rev += b.rev || 0; a.fvm += b.fvm || 0; return a; }
  function tot(byPais) { var t = z(); Object.keys(byPais || {}).forEach(function (p) { add(t, byPais[p]); }); return t; }
  function pct(a, b) { return b ? (a / b - 1) * 100 : null; }
  function share(v) { return v.gb ? v.fvm / v.gb * 100 : null; }
  function money(v) {
    var a = Math.abs(v), s = v < 0 ? '-$' : '$';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return s + Math.round(a / 1e3) + 'K';
    return s + Math.round(a);
  }
  function sgnMoney(v) { return (v > 0 ? '+' : '') + money(v); }
  function fp(v, d) { if (v == null || !isFinite(v)) return '—'; d = d == null ? (Math.abs(v) < 10 ? 1 : 0) : d; return (v > 0 ? '+' : '') + v.toFixed(d) + '%'; }
  function fpp(v) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + 'pp'; }
  function state(v) { return v == null || !isFinite(v) ? '' : v >= 0 ? 'g' : v >= -5 ? 'a' : 'r'; }
  var SLACK_DOT = { g: ':large_green_circle:', a: ':large_yellow_circle:', r: ':red_circle:' };
  var DOT_NAME = { g: 'en línea o arriba', a: 'leve desvío', r: 'desvío fuerte' };
  function dot(v, slack) {
    var s = state(v);
    if (!s) return '';
    return slack ? ' ' + SLACK_DOT[s] : '<span class="dot ' + s + '" role="img" aria-label="' + DOT_NAME[s] + '"></span>';
  }
  function cls(v) { return v == null || !isFinite(v) ? '' : v < 0 ? 'neg' : 'pos'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cname(p) { return NAME[p] || p; }
  function flag(p, slack) {
    var f = FLAG[p];
    // En la página sin bandera: Windows no dibuja los emoji de banderas (muestra "BR"). En Slack, el código del emoji.
    if (!slack) return '';
    return f ? ':flag-' + f + ': ' : (p === 'Other Countries' ? ':earth_americas: ' : '');
  }

  // Un negocio (o el consolidado): totales y por país, de cada escenario
  function view(k) {
    var keys = k === 'all' ? ['b2b2c', 'api', 'html'] : [k];
    var o = { cur: {}, bud: {}, ly: {}, rr: {}, l4w: {}, l4wLy: {} };
    keys.forEach(function (bk) {
      var b = D.biz[bk];
      Object.keys(o).forEach(function (sc) {
        Object.keys(b[sc] || {}).forEach(function (p) { o[sc][p] = add(o[sc][p] || z(), b[sc][p]); });
      });
    });
    var T = {};
    Object.keys(o).forEach(function (sc) { T[sc] = tot(o[sc]); });
    var trend = D.biz[keys[0]].trend.map(function (w, i) {
      var r = { year: w.year, week: w.week, from: w.from, cur: z(), bud: z(), ly: z() };
      keys.forEach(function (bk) { var x = D.biz[bk].trend[i]; add(r.cur, x.cur); add(r.bud, x.bud); add(r.ly, x.ly); });
      return r;
    });
    return { by: o, T: T, trend: trend };
  }

  // Países que explican el desvío de NR vs Budget: los dos que más restan (o suman) y el que más compensa
  function drivers(V, slack) {
    var dev = V.T.cur.rev - V.T.bud.rev, sign = dev < 0 ? -1 : 1;
    var rows = Object.keys(V.by.cur).concat(Object.keys(V.by.bud)).filter(function (p, i, a) { return a.indexOf(p) === i && p !== 'RG'; })
      .map(function (p) { var c = (V.by.cur[p] || z()).rev, b = (V.by.bud[p] || z()).rev; return { p: p, d: c - b, pc: pct(c, b) }; });
    var thr = Math.abs(dev) * 0.1;
    var main = rows.filter(function (r) { return r.d * sign > 0 && Math.abs(r.d) >= thr; }).sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); }).slice(0, 2);
    var comp = rows.filter(function (r) { return r.d * sign < 0 && Math.abs(r.d) >= thr; }).sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); }).slice(0, 1);
    function lst(a) {
      var b = slack ? function (s) { return s; } : function (s) { return '<b>' + esc(s) + '</b>'; };
      return a.map(function (r) { return flag(r.p, slack) + b(cname(r.p)) + ' (' + fp(r.pc) + ')'; }).join(', ').replace(/, ([^,]*)$/, ' y $1');
    }
    if (!main.length) return '';
    var s = (dev < 0 ? 'El desvío viene principalmente de ' : 'El resultado lo impulsan principalmente ') + lst(main);
    if (comp.length) s += (dev < 0 ? ', parcialmente compensado por ' : ', parcialmente compensado por la caída de ') + lst(comp);
    return s + '.';
  }

  // ── Texto del resumen (HTML para la página y texto para Slack) ─────────────────────────────
  function summary(slack) {
    var b = slack ? function (s) { return '*' + s + '*'; } : function (s) { return '<b>' + s + '</b>'; };
    var A = view('all'), parts = {};
    ['b2b2c', 'api', 'html'].forEach(function (k) { parts[k] = view(k); });
    var T = A.T, devNR = T.cur.rev - T.bud.rev, pNR = pct(T.cur.rev, T.bud.rev), pF = pct(T.cur.fvm, T.bud.fvm);
    var byBiz = function (fld) {
      return ['b2b2c', 'api', 'html'].map(function (k) { var t = parts[k].T; return fp(pct(t.cur[fld], t.bud[fld]), 0) + ' ' + BIZ.filter(function (x) { return x.k === k; })[0].lbl; })
        .join(', ').replace(/, ([^,]*)$/, ' & $1');
    };
    var worst = ['b2b2c', 'api', 'html'].map(function (k) { var t = parts[k].T; return { k: k, p: pct(t.cur.fvm, t.bud.fvm) }; })
      .sort(function (a, c) { return (a.p == null ? 0 : a.p) - (c.p == null ? 0 : c.p); });
    var lbl = function (k) { return BIZ.filter(function (x) { return x.k === k; })[0].lbl; };
    var yGB = pct(T.cur.gb, T.ly.gb), yNR = pct(T.cur.rev, T.ly.rev), y4 = pct(T.l4w.rev, T.l4wLy.rev);
    var trendTxt = (yNR != null && y4 != null) ? (yNR >= y4 ? ', mejorando la tendencia vs L4Ws (' : ', por debajo de la tendencia de las L4Ws (') + 'L4W: ' + fp(y4, 0) + ' YoY en NR)' : '';
    var growVerb = function (v) { return v >= 0 ? 'crece' : 'cae'; };
    var p0 = 'Net Revenues del ecosistema B2B vs Budget con desvío de ' + b(sgnMoney(devNR) + ' / ' + fp(pNR, 0)) + dot(pNR, slack) +
      ' (' + byBiz('rev') + '). FVM ' + fp(pF, 0) + dot(pF, slack) + ' vs Budget' +
      (pF < 0 ? ', desviado principalmente por ' + worst.filter(function (w) { return w.p != null && w.p < 0; }).map(function (w) { return lbl(w.k) + ' (' + fp(w.p, 0) + ')'; }).join(', ').replace(/, ([^,]*)$/, ' y $1') : '') +
      '. Vs Last Year el negocio ' + growVerb(yGB) + ' ' + fp(yGB, 0) + ' en GB y ' + fp(yNR, 0) + ' en Net Revenues' + trendTxt + '.';
    var out = [{ k: 'all', t: p0 }];
    ['b2b2c', 'api', 'html'].forEach(function (k) {
      var V = parts[k], t = V.T, d = t.cur.rev - t.bud.rev, pn = pct(t.cur.rev, t.bud.rev);
      var shC = share(t.cur), shB = share(t.bud), rN = pct(t.cur.rev, t.rr.rev), rF = pct(t.cur.fvm, t.rr.fvm);
      var s = 'Net Revenues de ' + b(money(t.cur.rev)) + ', con un desvío de ' + b(fp(pn)) + ' vs Budget' + dot(pn, slack) + ' (' + sgnMoney(d) + '). ' +
        drivers(V, slack) + ' FVM cerró en ' + (shC == null ? '—' : shC.toFixed(1) + '%/GB') + ', ' + fpp(shC != null && shB != null ? shC - shB : null) + ' vs Budget.';
      if (t.rr.rev) s += ' Vs Run Rate: NR ' + fp(rN) + dot(rN, slack) + ', FVM ' + fp(rF) + dot(rF, slack) + '.';
      out.push({ k: k, t: s });
    });
    return out;
  }

  function weekTitle() {
    var a = D.week.from.split('-'), c = D.week.to.split('-');
    var r = +a[2] + (a[1] === c[1] ? '' : ' ' + MES[+a[1] - 1]) + '–' + +c[2] + ' ' + MES[+c[1] - 1] + ' ' + c[0];
    return 'Semana ' + D.week.week + ' · ' + r;
  }

  // ── Render ──────────────────────────────────────────────────────────────────────────────
  function render() {
    var S = summary(false);
    var html = '<div class="rs-hero"><h1>Resumen semanal</h1><p>' + esc(weekTitle()) + ' · fecha de gestión · reales al ' +
      esc(D.lastActualsDate.split('-').reverse().join('/')) + ' · USD nominales</p></div>';
    html += '<section class="rs-card rs-sum" aria-labelledby="rs-sum-h"><div class="rs-head"><h2 id="rs-sum-h">La semana en pocas líneas</h2>' +
      '<button type="button" class="rs-copy" id="rs-copy">Copiar para Slack</button></div>' +
      S.map(function (x) { var bz = BIZ.filter(function (b) { return b.k === x.k; })[0]; return '<p><span class="lbl">' + esc(bz.lbl) + '</span> ' + x.t + '</p>'; }).join('') + '</section>';
    html += '<div class="rs-bar"><div class="rs-tabs" role="tablist" aria-label="Negocio">' + BIZ.map(function (b) {
      return '<button type="button" role="tab" data-k="' + b.k + '" aria-selected="' + (b.k === sel) + '">' + esc(b.lbl) + '</button>';
    }).join('') + '</div></div><div id="rs-biz"></div>';
    html += '<p class="rs-note">Semana ISO (lunes a domingo), la última completa con reales. Mismos datos que el Weekly del Daily Dashboard: fecha de gestión, ' +
      'B2B separado por canal (API / HTML = agencias afiliadas), LY = misma semana ISO del año pasado, L4W = promedio de las 4 semanas anteriores, ' +
      'Run Rate y Budget semanales del Daily. FVM con COI Brasil incluido. Semáforo: verde ≥ 0%, ámbar entre −5% y 0%, rojo debajo de −5%.</p>';
    root.innerHTML = html;
    document.getElementById('rs-copy').onclick = copySlack;
    Array.prototype.forEach.call(root.querySelectorAll('.rs-tabs button'), function (bt) {
      bt.onclick = function () { sel = bt.getAttribute('data-k'); syncTabs(); renderBiz(); };
      bt.onkeydown = function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var i = BIZ.findIndex(function (b) { return b.k === sel; }) + (e.key === 'ArrowRight' ? 1 : -1);
        sel = BIZ[(i + BIZ.length) % BIZ.length].k; syncTabs(); renderBiz();
        root.querySelector('.rs-tabs button[data-k="' + sel + '"]').focus();
      };
    });
    renderBiz();
  }
  function syncTabs() {
    Array.prototype.forEach.call(root.querySelectorAll('.rs-tabs button'), function (bt) { bt.setAttribute('aria-selected', String(bt.getAttribute('data-k') === sel)); });
  }

  function kpi(name, cur, rows) {
    return '<div class="rs-kpi"><div class="k">' + name + '</div><div class="v">' + cur + '</div><dl>' +
      rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl></div>';
  }
  function cmp(v) { return '<span class="' + cls(v) + '">' + fp(v) + '</span>' + dot(v); }
  function cmpT(v) { return '<span class="' + cls(v) + '">' + fp(v) + '</span>'; }   // en tablas: sin semáforo (color y signo alcanzan)
  function cmpPP(v) { return '<span class="' + cls(v) + '">' + fpp(v) + '</span>'; }

  function renderBiz() {
    var V = view(sel), T = V.T, host = document.getElementById('rs-biz');
    var cards = ['gb', 'rev', 'fvm'].map(function (m) {
      return kpi(MET[m], money(T.cur[m]), [['vs Budget', cmp(pct(T.cur[m], T.bud[m]))], ['vs LY', cmp(pct(T.cur[m], T.ly[m]))],
        ['vs L4W', cmp(pct(T.cur[m], T.l4w[m]))], ['vs Run Rate', cmp(pct(T.cur[m], T.rr[m]))]]);
    });
    var sC = share(T.cur), d = function (o) { var s = share(o); return sC != null && s != null ? sC - s : null; };
    cards.push(kpi('FVM % GB', sC == null ? '—' : sC.toFixed(1) + '%', [['vs Budget', cmpPP(d(T.bud))], ['vs LY', cmpPP(d(T.ly))], ['vs L4W', cmpPP(d(T.l4w))], ['vs Run Rate', cmpPP(d(T.rr))]]));
    var h = '<div class="rs-kpis">' + cards.join('') + '</div>';
    h += '<section class="rs-card rs-sec" aria-labelledby="rs-ch-h"><div class="rs-chart-top"><h2 id="rs-ch-h">Últimas 13 semanas · USD</h2>' +
      '<div class="rs-seg" role="group" aria-label="Métrica">' + ['gb', 'rev', 'fvm'].map(function (m) {
        return '<button type="button" data-m="' + m + '" aria-pressed="' + (m === metric) + '">' + (m === 'rev' ? 'NR' : m === 'gb' ? 'GB' : 'FVM') + '</button>';
      }).join('') + '</div></div>' +
      '<div class="rs-legend"><span><i style="border-color:var(--s-act)"></i>Actual</span><span><i class="dash" style="border-color:var(--s-bud)"></i>Budget</span>' +
      '<span><i style="border-color:var(--s-ly)"></i>Last Year</span></div><div class="rs-plot viz-root" id="rs-plot"></div>' +
      '<details class="rs-det"><summary>Ver como tabla</summary><div class="rs-tbl-wrap" id="rs-trend-tbl"></div></details></section>';
    h += '<section class="rs-card rs-sec" aria-labelledby="rs-pais-h"><h2 id="rs-pais-h">Por país · semana ' + D.week.week + '</h2><div class="rs-tbl-wrap">' + countryTable(V) + '</div></section>';
    host.innerHTML = h;
    Array.prototype.forEach.call(host.querySelectorAll('.rs-seg button'), function (bt) {
      bt.onclick = function () {
        metric = bt.getAttribute('data-m');
        Array.prototype.forEach.call(host.querySelectorAll('.rs-seg button'), function (x) { x.setAttribute('aria-pressed', String(x === bt)); });
        chart(V);
      };
    });
    chart(V);
  }

  function countryTable(V) {
    var ps = Object.keys(V.by.cur).concat(Object.keys(V.by.bud)).filter(function (p, i, a) { return a.indexOf(p) === i && p !== 'RG'; });
    ps.sort(function (a, b) { return (V.by.cur[b] || z()).rev - (V.by.cur[a] || z()).rev; });
    function row(name, c, bd, ly, cl) {
      var sc = share(c), sb = share(bd);
      return '<tr' + (cl ? ' class="' + cl + '"' : '') + '><td>' + name + '</td>' +
        '<td class="sep">' + money(c.gb) + '</td><td>' + cmpT(pct(c.gb, bd.gb)) + '</td><td>' + cmpT(pct(c.gb, ly.gb)) + '</td>' +
        '<td class="sep">' + money(c.rev) + '</td><td>' + cmpT(pct(c.rev, bd.rev)) + '</td><td class="' + cls(c.rev - bd.rev) + '">' + sgnMoney(c.rev - bd.rev) + '</td><td>' + cmpT(pct(c.rev, ly.rev)) + '</td>' +
        '<td class="sep">' + money(c.fvm) + '</td><td>' + (sc == null ? '—' : sc.toFixed(1) + '%') + '</td><td>' + cmpPP(sc != null && sb != null ? sc - sb : null) + '</td></tr>';
    }
    var body = ps.map(function (p) { return row(flag(p) + esc(cname(p)), V.by.cur[p] || z(), V.by.bud[p] || z(), V.by.ly[p] || z()); }).join('');
    return '<table class="rs-tbl"><thead><tr><th></th><th class="grp sep" colspan="3">Gross Bookings</th><th class="grp sep" colspan="4">Net Revenues</th><th class="grp sep" colspan="3">FVM</th></tr>' +
      '<tr><th>País</th><th class="sep">Actual</th><th>vs Bud</th><th>vs LY</th><th class="sep">Actual</th><th>vs Bud</th><th>Δ$ vs Bud</th><th>vs LY</th><th class="sep">Actual</th><th>%GB</th><th>vs Bud</th></tr></thead>' +
      '<tbody>' + body + row('Total', V.T.cur, V.T.bud, V.T.ly, 'tot') + '</tbody></table>';
  }

  // ── Gráfico: 13 semanas, Actual / Budget / LY, un solo eje ────────────────────────────────
  function chart(V) {
    var host = document.getElementById('rs-plot'), m = metric, tr = V.trend;
    var W = 960, H = 300, L = 56, R = 64, Tp = 14, B = 30, iw = W - L - R, ih = H - Tp - B;
    var S = [{ k: 'cur', c: 'var(--s-act)', n: 'Actual' }, { k: 'bud', c: 'var(--s-bud)', n: 'Budget', dash: '6 5' }, { k: 'ly', c: 'var(--s-ly)', n: 'Last Year' }];
    var vals = []; tr.forEach(function (w) { S.forEach(function (s) { vals.push(w[s.k][m]); }); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max.apply(null, vals) || 1;
    var step = niceStep((hi - lo) / 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    var x = function (i) { return L + (tr.length === 1 ? iw / 2 : i * iw / (tr.length - 1)); };
    var y = function (v) { return Tp + ih - (v - lo) / (hi - lo) * ih; };
    var g = '';
    for (var v = lo; v <= hi + step / 2; v += step) g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ax" x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + money(v) + '</text>';
    tr.forEach(function (w, i) { if (i % 2 === (tr.length - 1) % 2) g += '<text class="ax" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">W' + w.week + '</text>'; });
    var ends = [];
    S.forEach(function (s) {
      var d = tr.map(function (w, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(w[s.k][m]).toFixed(1); }).join(' ');
      g += '<path d="' + d + '" fill="none" stroke="' + s.c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') + '/>';
      var lv = tr[tr.length - 1][s.k][m];
      ends.push({ s: s, y: y(lv), v: lv });
    });
    // Etiquetas directas al final de cada línea, sin pisarse
    ends.sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    ends.forEach(function (e) {
      g += '<circle cx="' + x(tr.length - 1) + '" cy="' + y(e.v) + '" r="4" fill="' + e.s.c + '" stroke="var(--tile)" stroke-width="2"/>';
      g += '<text class="dl" x="' + (x(tr.length - 1) + 10) + '" y="' + (e.y + 4) + '">' + money(e.v) + '</text>';
    });
    g += '<line id="rs-cross" y1="' + Tp + '" y2="' + (Tp + ih) + '" stroke="var(--text-3)" stroke-width="1" visibility="hidden"/>';
    g += '<rect x="' + L + '" y="' + Tp + '" width="' + iw + '" height="' + ih + '" fill="transparent" id="rs-hit"/>';
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + MET[m] + ' semanal: Actual, Budget y Last Year de las últimas 13 semanas">' + g + '</svg><div class="rs-tip" id="rs-tip"></div>';
    var svg = host.querySelector('svg'), tip = document.getElementById('rs-tip'), cross = document.getElementById('rs-cross');
    function move(ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
      var i = Math.max(0, Math.min(tr.length - 1, Math.round((px - L) / iw * (tr.length - 1)))), w = tr[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      var a = w.from.split('-');
      tip.innerHTML = '<b>W' + w.week + ' · ' + (+a[2]) + ' ' + MES[+a[1] - 1] + '</b>' + S.map(function (s) {
        return '<div><span>' + s.n + '</span><span>' + money(w[s.k][m]) + '</span></div>';
      }).join('') + '<div><span>vs Budget</span><span>' + fp(pct(w.cur[m], w.bud[m])) + '</span></div><div><span>vs LY</span><span>' + fp(pct(w.cur[m], w.ly[m])) + '</span></div>';
      tip.style.display = 'block';
      var left = x(i) / W * r.width + 14;
      if (left + tip.offsetWidth > r.width) left = x(i) / W * r.width - tip.offsetWidth - 14;
      tip.style.left = left + 'px'; tip.style.top = '8px';
    }
    var hit = document.getElementById('rs-hit');
    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', function () { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); });
    document.getElementById('rs-trend-tbl').innerHTML = '<table class="rs-tbl"><thead><tr><th>Semana</th><th>Actual</th><th>Budget</th><th>vs Bud</th><th>Last Year</th><th>vs LY</th></tr></thead><tbody>' +
      tr.map(function (w) { return '<tr><td>W' + w.week + ' (' + w.from.split('-').reverse().slice(0, 2).join('/') + ')</td><td>' + money(w.cur[m]) + '</td><td>' + money(w.bud[m]) + '</td><td>' + cmpT(pct(w.cur[m], w.bud[m])) +
        '</td><td>' + money(w.ly[m]) + '</td><td>' + cmpT(pct(w.cur[m], w.ly[m])) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  function copySlack() {
    var t = '*Resumen semanal · ' + weekTitle() + '*\n\n' + summary(true).map(function (x) {
      return '*' + BIZ.filter(function (b) { return b.k === x.k; })[0].lbl + '*: ' + x.t;
    }).join('\n\n');
    var bt = document.getElementById('rs-copy');
    var ok = function () { bt.textContent = 'Copiado ✓'; setTimeout(function () { bt.textContent = 'Copiar para Slack'; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { fallback(t); ok(); });
    else { fallback(t); ok(); }
  }
  function fallback(t) {
    var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nada */ }
    document.body.removeChild(ta);
  }

  // ── Datos ───────────────────────────────────────────────────────────────────────────────
  root.innerHTML = '<p class="rs-state">Cargando la última semana…</p>';
  fetch(CFG.api, { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'google.script.run' }, body: JSON.stringify({ args: [{}] }) })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j.result; }); })
    .then(function (res) {
      if (!res || !res.success) throw new Error((res && res.error) || 'Sin datos');
      D = res; render();
    })
    .catch(function (e) { root.innerHTML = '<p class="rs-state">No se pudo cargar el resumen: ' + esc(e.message) + '</p>'; });
})();
`;

function resumenSemanalPage({ basePath }) {
  const back = `<a class="back" href="${escapeHtml(basePath)}/">${CHEVRON_L} B2B Ecosystem</a>`;
  const cfg = JSON.stringify({ api: `${basePath}/api/daily/getResumenSemanal` }).replace(/</g, '\\u003c');
  return shell(`${CSS}<div id="rs-root" class="viz-root"></div>
    <script>window.RS_CFG = ${cfg};</script>
    <script>${SCRIPT}</script>`, { title: 'Resumen semanal · B2B Ecosystem', left: back });
}

module.exports = { resumenSemanalPage };
