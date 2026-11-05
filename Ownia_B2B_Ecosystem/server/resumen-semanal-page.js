// "Resumen semanal" (2026-11-02, Tiago): botón de la portada al lado de "Actualizar reales". La última semana cerrada
// (ISO, lunes a domingo, fecha de gestión) de B2B2C, B2B API y B2B HTML: un resumen en texto (como el del P&L de B2C,
// listo para pegar en Slack), tarjetas GB / NR / FVM vs Budget, LY, L4W y Run Rate, la serie de 13 semanas y la
// apertura por país. Los montos los da getResumenSemanal del Daily (server/gas-extras/daily-resumen-semanal.js, mismas
// filas que el Weekly); acá solo se suman y se arman los textos. Mismos permisos que el Daily (cualquier @despegar.com).
//
// Rediseño 2026-11-05 (propuesta, inspirado en los bloques Stats / Analytics de React Bits Pro, sin su código): titular
// con la lectura de la semana, grilla tipo bento con un dial de cumplimiento de NR vs Budget, tarjetas con delta y
// sparkline de 13 semanas (tocar una tarjeta cambia la métrica del gráfico y de los países), gráfico de área con
// cruz y barras "bullet" por país (barra = real, marca = Budget). La tabla completa queda plegada. Vista previa con
// datos de ejemplo: node scripts/preview-resumen-semanal.js
//
// Colores del gráfico: los tres primeros slots de la paleta de referencia de dataviz (azul / naranja / aqua), validados
// todos contra todos en claro y oscuro; el Budget además va punteado. Semáforo = el del Hub (_deltaState_): verde ≥ 0%,
// ámbar −5% a 0%, rojo < −5%.
const { shell, escapeHtml, CHEVRON_L } = require('./index-page');

const CSS = `<style>
  .viz-root { --s-act: #3987e5; --s-ly: #d95926; --s-bud: #199e70; --good: #2fbf71; --warn: #f5b13d; --crit: #f0605d;
              --good-bg: rgba(47,191,113,.14); --warn-bg: rgba(245,177,61,.14); --crit-bg: rgba(240,96,93,.14); --spot: rgba(167,128,255,.13); }
  :root[data-theme="light"] .viz-root { --s-act: #2a78d6; --s-ly: #eb6834; --s-bud: #1baf7a; --good: #13803f; --warn: #a86400; --crit: #c5221f;
              --good-bg: rgba(19,128,63,.1); --warn-bg: rgba(168,100,0,.1); --crit-bg: rgba(197,34,31,.09); --spot: rgba(85,15,237,.07); }
  body .wrap { max-width: 1180px; }

  /* Entrada: suben de a uno (sin animación con prefers-reduced-motion) */
  .rs-in { animation: rsUp .6s var(--ease) both; animation-delay: var(--d, 0ms); }
  @keyframes rsUp { from { opacity: 0; transform: translateY(14px); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
  @media (prefers-reduced-motion: reduce) { .rs-in { animation: none; } .rs-ring-fg, .rs-line { transition: none !important; } }

  /* Titular */
  .rs-hero { margin-bottom: 30px; }
  .rs-eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px 5px 10px; border-radius: 999px; font-size: 12.5px; color: var(--text-2);
                box-shadow: inset 0 0 0 1px var(--line); background: color-mix(in srgb, var(--tile) 70%, transparent); }
  .rs-live { width: 7px; height: 7px; border-radius: 50%; background: var(--good); box-shadow: 0 0 0 0 var(--good); animation: rsPulse 2.4s infinite; }
  @keyframes rsPulse { 0% { box-shadow: 0 0 0 0 rgba(47,191,113,.55); } 70% { box-shadow: 0 0 0 7px rgba(47,191,113,0); } 100% { box-shadow: 0 0 0 0 rgba(47,191,113,0); } }
  .rs-hero h1 { margin-top: 16px; font-size: clamp(32px, 5vw, 54px); font-weight: 600; letter-spacing: -0.035em; line-height: 1.04; max-width: 22ch; }
  .rs-hero h1 em { font-style: normal; background: linear-gradient(92deg, var(--link), var(--secondary) 55%, #e48bff); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .rs-lead { margin-top: 14px; max-width: 64ch; font-size: 16.5px; line-height: 1.6; color: var(--text-2); }
  .rs-lead b { color: var(--text); font-weight: 600; }

  /* Barra: negocio + copiar */
  .rs-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .rs-tabs { position: relative; display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--tile); box-shadow: inset 0 0 0 1px var(--line); }
  .rs-tabs button { position: relative; z-index: 1; padding: 8px 18px; border-radius: 999px; border: 0; background: transparent; color: var(--text-2);
                    font: 500 14px var(--font); cursor: pointer; transition: color .25s var(--ease); }
  .rs-tabs button[aria-selected="true"] { color: #fff; }
  .rs-tabs .ind { position: absolute; top: 4px; bottom: 4px; left: 0; width: 0; border-radius: 999px; background: var(--primary);
                  box-shadow: 0 6px 20px var(--glow); transition: transform .35s var(--ease), width .35s var(--ease); }
  .rs-bar .sp { flex: 1; }
  .rs-btn { display: inline-flex; align-items: center; gap: 7px; padding: 8px 15px; border-radius: 999px; border: 0; background: transparent; color: var(--text-2);
            font: 500 13px var(--font); cursor: pointer; box-shadow: inset 0 0 0 1px var(--line); transition: color .2s, box-shadow .2s; }
  .rs-btn:hover { color: var(--link); box-shadow: inset 0 0 0 1px var(--link); }

  /* Bento */
  .rs-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; }
  .rs-card { position: relative; overflow: hidden; background: var(--tile); border-radius: 22px; padding: 22px 24px; box-shadow: inset 0 0 0 1px var(--line); }
  .rs-card::before { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .3s;
                     background: radial-gradient(380px circle at var(--mx, 50%) var(--my, 50%), var(--spot), transparent 60%); }
  .rs-card:hover::before { opacity: 1; }
  .rs-card > * { position: relative; }
  .rs-card h2 { font-size: 12px; font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; }
  .c-dial { grid-column: span 4; grid-row: span 2; display: flex; flex-direction: column; }
  .c-kpi { grid-column: span 4; }
  .c-chart { grid-column: span 12; }
  .c-bul { grid-column: span 7; }
  .c-sum { grid-column: span 5; display: flex; flex-direction: column; }

  /* Chips de delta */
  .chip { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .chip.g { color: var(--good); background: var(--good-bg); } .chip.a { color: var(--warn); background: var(--warn-bg); } .chip.r { color: var(--crit); background: var(--crit-bg); }
  .chip.n { color: var(--text-2); background: var(--tile-hover); }
  .chip svg { width: 11px; height: 11px; }

  /* Dial */
  .rs-ring { position: relative; width: min(230px, 100%); aspect-ratio: 1; margin: 18px auto 6px; }
  .rs-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .rs-ring-bg { stroke: var(--line); }
  .rs-ring-fg { transition: stroke-dashoffset 1.3s var(--ease); }
  .rs-ring::before { content: ''; position: absolute; inset: 18%; border-radius: 50%; background: var(--ring, transparent); opacity: .22; filter: blur(28px); }
  .rs-ring-c { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .rs-ring-c .v { font-size: 46px; font-weight: 600; letter-spacing: -0.04em; line-height: 1; font-variant-numeric: tabular-nums; }
  .rs-ring-c .v small { font-size: 20px; color: var(--text-3); margin-left: 1px; }
  .rs-ring-c .k { margin-top: 6px; font-size: 12.5px; color: var(--text-2); }
  .rs-dial-cap { text-align: center; font-size: 13.5px; color: var(--text-2); }
  .rs-dial-cap b { color: var(--text); font-weight: 600; }
  .rs-vs { margin-top: auto; padding-top: 16px; display: grid; gap: 2px; }
  .rs-vs div { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-top: 1px solid var(--line); font-size: 13.5px; color: var(--text-2); }

  /* KPI */
  .c-kpi { cursor: pointer; transition: transform .25s var(--ease), box-shadow .25s; text-align: left; font: inherit; color: inherit; border: 0; }
  .c-kpi:hover { transform: translateY(-2px); }
  .c-kpi[aria-pressed="true"] { box-shadow: inset 0 0 0 1.5px var(--link), 0 10px 34px var(--glow); }
  .c-kpi:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
  .kpi-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .kpi-top .k { font-size: 13.5px; color: var(--text-2); }
  .kpi-v { margin-top: 6px; font-size: 34px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .kpi-spark { display: block; width: 100%; height: 46px; margin-top: 10px; overflow: visible; }
  .kpi-foot { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 10px; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
  .kpi-foot span b { font-weight: 500; }

  /* Gráfico */
  .rs-chart-top { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
  .rs-chart-top .t { flex: 1; min-width: 220px; }
  .rs-chart-top .big { margin-top: 6px; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
  .rs-legend { display: flex; gap: 16px; font-size: 12.5px; color: var(--text-2); flex-wrap: wrap; }
  .rs-legend span { display: inline-flex; align-items: center; gap: 6px; }
  .rs-legend i { width: 16px; height: 0; border-top: 2px solid; display: inline-block; }
  .rs-legend i.dash { border-top-style: dashed; }
  .rs-plot { position: relative; margin-top: 10px; }
  .rs-plot svg { display: block; width: 100%; height: auto; overflow: visible; }
  .rs-plot .ax { fill: var(--text-3); font: 11px var(--font); font-variant-numeric: tabular-nums; }
  .rs-plot .grid { stroke: var(--line); stroke-dasharray: 2 4; }
  .rs-plot .dl { font: 600 11.5px var(--font); }
  .rs-line { transition: stroke-dashoffset 1.2s var(--ease); }
  .rs-tip { position: absolute; pointer-events: none; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(10px); color: var(--text);
            border-radius: 14px; padding: 10px 12px; font-size: 12.5px; box-shadow: 0 14px 36px rgba(0,0,0,.35), inset 0 0 0 1px var(--line);
            min-width: 180px; font-variant-numeric: tabular-nums; display: none; z-index: 2; }
  .rs-tip b { display: block; margin-bottom: 6px; font-weight: 600; }
  .rs-tip div { display: flex; justify-content: space-between; align-items: center; gap: 14px; color: var(--text-2); padding: 1px 0; }
  .rs-tip div span:last-child { color: var(--text); }
  .rs-tip i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }

  /* Bullet por país */
  .rs-bul-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .rs-bul-top h2 { flex: 1; }
  .rs-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line); }
  .rs-seg button { padding: 4px 12px; border-radius: 999px; border: 0; background: transparent; color: var(--text-2); font: 500 12.5px var(--font); cursor: pointer; }
  .rs-seg button[aria-pressed="true"] { background: var(--tile-hover); color: var(--text); box-shadow: inset 0 0 0 1px var(--line); }
  .rs-bul-sub { margin-top: 4px; font-size: 12.5px; color: var(--text-3); }
  .rs-bul { margin-top: 14px; display: grid; gap: 4px; }
  .rs-bul .row { display: grid; grid-template-columns: 112px 1fr 76px 62px; align-items: center; gap: 12px; padding: 7px 0; font-size: 13.5px; font-variant-numeric: tabular-nums; }
  .rs-bul .nm { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rs-bul .trk { position: relative; height: 10px; border-radius: 999px; background: var(--tile-hover); }
  .rs-bul .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; width: 0; transition: width 1s var(--ease); }
  .rs-bul .fill.g { background: linear-gradient(90deg, color-mix(in srgb, var(--good) 45%, transparent), var(--good)); }
  .rs-bul .fill.a { background: linear-gradient(90deg, color-mix(in srgb, var(--warn) 45%, transparent), var(--warn)); }
  .rs-bul .fill.r { background: linear-gradient(90deg, color-mix(in srgb, var(--crit) 45%, transparent), var(--crit)); }
  .rs-bul .tick { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; border-radius: 2px; background: var(--text); opacity: .85; }
  .rs-bul .val { text-align: right; color: var(--text); }
  .rs-bul .row .chip { justify-self: end; }
  .rs-bul .row.tot { margin-top: 4px; padding-top: 11px; border-top: 1px solid var(--line); font-weight: 600; }

  /* Resumen en texto */
  .rs-sum-t { margin-top: 14px; font-size: 15px; line-height: 1.7; color: var(--text-2); flex: 1; }
  .rs-sum-t b { color: var(--text); font-weight: 600; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin: 0 2px 0 4px; vertical-align: 1px; }
  .dot.g { background: var(--good); } .dot.a { background: var(--warn); } .dot.r { background: var(--crit); }
  .rs-sum-f { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }

  /* Tablas plegadas */
  .rs-det { margin-top: 12px; font-size: 13px; color: var(--text-2); }
  .rs-det summary { cursor: pointer; width: fit-content; }
  .rs-det summary:hover { color: var(--link); }
  .rs-tbl-wrap { overflow-x: auto; margin-top: 12px; }
  table.rs-tbl { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  .rs-tbl th { text-align: right; font-weight: 500; color: var(--text-3); font-size: 12px; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  .rs-tbl th:first-child, .rs-tbl td:first-child { text-align: left; }
  .rs-tbl th.grp { text-align: center; color: var(--text-2); border-bottom: 0; padding-bottom: 0; }
  .rs-tbl td { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  .rs-tbl tr.tot td { font-weight: 600; border-bottom: 0; }
  .rs-tbl td.sep, .rs-tbl th.sep { border-left: 1px solid var(--line); }
  .neg { color: var(--crit); } .pos { color: var(--good); }
  .rs-note { margin-top: 28px; font-size: 12.5px; color: var(--text-3); line-height: 1.6; }
  .rs-note summary { cursor: pointer; width: fit-content; }
  .rs-note p { margin-top: 8px; max-width: 90ch; }
  .rs-state { padding: 48px 0; text-align: center; color: var(--text-2); }
  .rs-skel { height: 160px; border-radius: 22px; background: linear-gradient(90deg, var(--tile) 0%, var(--tile-hover) 50%, var(--tile) 100%); background-size: 200% 100%; animation: rsSk 1.4s infinite; }
  @keyframes rsSk { to { background-position: -200% 0; } }

  @media (max-width: 960px) {
    .c-dial { grid-column: span 12; grid-row: auto; } .c-kpi { grid-column: span 6; }
    .c-bul, .c-sum { grid-column: span 12; }
  }
  @media (max-width: 560px) {
    .c-kpi { grid-column: span 12; }
    .rs-bul .row { grid-template-columns: 84px 1fr 62px; } .rs-bul .row .chip { display: none; }
  }
</style>`;

// El script de la página: pide los datos al Daily y arma todo. Sin dependencias.
const SCRIPT = String.raw`
(function () {
  'use strict';
  var root = document.getElementById('rs-root'), CFG = window.RS_CFG;
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var BIZ = [
    { k: 'all', lbl: 'Consolidado', long: 'Ecosistema B2B (B2B2C + B2B)' },
    { k: 'b2b2c', lbl: 'B2B2C', long: 'B2B2C' },
    { k: 'api', lbl: 'B2B API', long: 'B2B API' },
    { k: 'html', lbl: 'B2B HTML', long: 'B2B HTML' },
  ];
  var MET = { gb: 'Gross Bookings', rev: 'Net Revenues', fvm: 'FVM', sh: 'FVM % GB' };
  var SHORT = { gb: 'GB', rev: 'NR', fvm: 'FVM', sh: 'FVM %GB' };
  // Código de la bandera en Slack (:flag-xx:)
  var FLAG = { Argentina: 'ar', Brasil: 'br', Chile: 'cl', Colombia: 'co', Ecuador: 'ec',
    Mexico: 'mx', Peru: 'pe', Uruguay: 'uy', Paraguay: 'py', USA: 'us' };
  var NAME = { Mexico: 'México', Peru: 'Perú', 'Other Countries': 'Otros países', RG: 'Ajuste COI Brasil' };
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var D = null, sel = 'all', metric = 'rev', bulBy = 'pais';

  // ── Números ─────────────────────────────────────────────────────────────────────────────
  function z() { return { gb: 0, rev: 0, fvm: 0 }; }
  function add(a, b) { a.gb += b.gb || 0; a.rev += b.rev || 0; a.fvm += b.fvm || 0; return a; }
  function tot(byPais) { var t = z(); Object.keys(byPais || {}).forEach(function (p) { add(t, byPais[p]); }); return t; }
  function pct(a, b) { return b ? (a / b - 1) * 100 : null; }
  function share(v) { return v.gb ? v.fvm / v.gb * 100 : null; }
  function val(o, m) { return m === 'sh' ? share(o) : o[m]; }
  function dlt(a, b, m) { var x = val(a, m), y = val(b, m); return x == null || y == null ? null : m === 'sh' ? x - y : pct(x, y); }
  function money(v) {
    var a = Math.abs(v), s = v < 0 ? '-$' : '$';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return s + Math.round(a / 1e3) + 'K';
    return s + Math.round(a);
  }
  function fmtM(m, v) { return v == null || !isFinite(v) ? '—' : m === 'sh' ? v.toFixed(1) + '%' : money(v); }
  function sgnMoney(v) { return (v > 0 ? '+' : '') + money(v); }
  function fp(v, d) { if (v == null || !isFinite(v)) return '—'; d = d == null ? (Math.abs(v) < 10 ? 1 : 0) : d; return (v > 0 ? '+' : '') + v.toFixed(d) + '%'; }
  function fpp(v) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + 'pp'; }
  function fd(m, v) { return m === 'sh' ? fpp(v) : fp(v); }
  function state(v) { return v == null || !isFinite(v) ? '' : v >= 0 ? 'g' : v >= -5 ? 'a' : 'r'; }
  var SLACK_DOT = { g: ':large_green_circle:', a: ':large_yellow_circle:', r: ':red_circle:' };
  var DOT_NAME = { g: 'en línea o arriba', a: 'leve desvío', r: 'desvío fuerte' };
  function dot(v, slack) {
    var s = state(v);
    if (!s) return '';
    return slack ? ' ' + SLACK_DOT[s] : '<span class="dot ' + s + '" role="img" aria-label="' + DOT_NAME[s] + '"></span>';
  }
  var UP = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l6-6M4 3h5v5"/></svg>';
  var DN = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l6 6M9 4v5H4"/></svg>';
  // Chip de delta: con semáforo (vs Budget) o neutro (LY, L4W, RR)
  function chip(v, m, neutral) {
    if (v == null || !isFinite(v)) return '<span class="chip n">—</span>';
    var s = neutral ? 'n' : state(m === 'sh' ? v * 5 : v);   // en pp: 1pp ≈ 5%
    return '<span class="chip ' + s + '">' + (v >= 0 ? UP : DN) + fd(m, v).replace(/^\+/, '') + '</span>';
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
  function bizLbl(k) { return BIZ.filter(function (x) { return x.k === k; })[0].lbl; }

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
      return ['b2b2c', 'api', 'html'].map(function (k) { var t = parts[k].T; return fp(pct(t.cur[fld], t.bud[fld]), 0) + ' ' + bizLbl(k); })
        .join(', ').replace(/, ([^,]*)$/, ' & $1');
    };
    var worst = ['b2b2c', 'api', 'html'].map(function (k) { var t = parts[k].T; return { k: k, p: pct(t.cur.fvm, t.bud.fvm) }; })
      .sort(function (a, c) { return (a.p == null ? 0 : a.p) - (c.p == null ? 0 : c.p); });
    var yGB = pct(T.cur.gb, T.ly.gb), yNR = pct(T.cur.rev, T.ly.rev), y4 = pct(T.l4w.rev, T.l4wLy.rev);
    var trendTxt = (yNR != null && y4 != null) ? (yNR >= y4 ? ', mejorando la tendencia vs L4Ws (' : ', por debajo de la tendencia de las L4Ws (') + 'L4W: ' + fp(y4, 0) + ' YoY en NR)' : '';
    var growVerb = function (v) { return v >= 0 ? 'crece' : 'cae'; };
    var p0 = 'Net Revenues del ecosistema B2B vs Budget con desvío de ' + b(sgnMoney(devNR) + ' / ' + fp(pNR, 0)) + dot(pNR, slack) +
      ' (' + byBiz('rev') + '). FVM ' + fp(pF, 0) + dot(pF, slack) + ' vs Budget' +
      (pF < 0 ? ', desviado principalmente por ' + worst.filter(function (w) { return w.p != null && w.p < 0; }).map(function (w) { return bizLbl(w.k) + ' (' + fp(w.p, 0) + ')'; }).join(', ').replace(/, ([^,]*)$/, ' y $1') : '') +
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

  function weekRange() {
    var a = D.week.from.split('-'), c = D.week.to.split('-');
    return +a[2] + (a[1] === c[1] ? '' : ' ' + MES[+a[1] - 1]) + '–' + +c[2] + ' ' + MES[+c[1] - 1] + ' ' + c[0];
  }
  function weekTitle() { return 'Semana ' + D.week.week + ' · ' + weekRange(); }

  // Titular: la lectura de la semana en una frase
  function headline(T) {
    var p = pct(T.cur.rev, T.bud.rev), y = pct(T.cur.rev, T.ly.rev);
    if (p == null) return 'La semana ' + D.week.week + ', <em>de un vistazo</em>.';
    if (p >= 0) return 'Net Revenues <em>' + fp(p, 0) + ' arriba</em> del Budget.';
    if (p >= -5) return 'Net Revenues <em>cerca del Budget</em>' + (y != null && y > 0 ? ' y creciendo vs LY.' : '.');
    return 'Net Revenues <em>' + fp(p, 0) + '</em> vs Budget' + (y != null && y > 0 ? ', pero ' + fp(y, 0) + ' vs LY.' : '.');
  }

  // ── Render ──────────────────────────────────────────────────────────────────────────────
  function render() {
    var A = view('all').T;
    var html = '<header class="rs-hero">' +
      '<span class="rs-eyebrow rs-in"><span class="rs-live" aria-hidden="true"></span>' + esc(weekTitle()) + ' · reales al ' + esc(D.lastActualsDate.split('-').reverse().slice(0, 2).join('/')) + '</span>' +
      '<h1 class="rs-in" style="--d:60ms">' + headline(A) + '</h1>' +
      '<p class="rs-lead rs-in" style="--d:120ms">El ecosistema B2B facturó <b>' + money(A.cur.rev) + '</b> de Net Revenues sobre <b>' + money(A.cur.gb) + '</b> de Gross Bookings: ' +
      '<b>' + fp(pct(A.cur.rev, A.bud.rev)) + '</b> vs Budget y <b>' + fp(pct(A.cur.rev, A.ly.rev)) + '</b> vs el año pasado.</p></header>';
    html += '<div class="rs-bar rs-in" style="--d:180ms"><div class="rs-tabs" role="tablist" aria-label="Negocio"><span class="ind" aria-hidden="true"></span>' + BIZ.map(function (b) {
      return '<button type="button" role="tab" data-k="' + b.k + '" aria-selected="' + (b.k === sel) + '">' + esc(b.lbl) + '</button>';
    }).join('') + '</div><span class="sp"></span>' +
      '<button type="button" class="rs-btn" id="rs-copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="3"/><path d="M5 15V6a3 3 0 0 1 3-3h9"/></svg><span>Copiar para Slack</span></button></div>' +
      '<div id="rs-biz"></div>';
    html += '<details class="rs-note"><summary>Cómo se calcula</summary><p>Semana ISO (lunes a domingo), la última completa con reales. Mismos datos que el Weekly del Daily Dashboard: fecha de gestión, ' +
      'B2B separado por canal (API / HTML = agencias afiliadas), LY = misma semana ISO del año pasado, L4W = promedio de las 4 semanas anteriores, ' +
      'Run Rate y Budget semanales del Daily. FVM con COI Brasil incluido. USD nominales. Semáforo: verde ≥ 0%, ámbar entre −5% y 0%, rojo debajo de −5%.</p></details>';
    root.innerHTML = html;
    document.getElementById('rs-copy').onclick = copySlack;
    Array.prototype.forEach.call(root.querySelectorAll('.rs-tabs button'), function (bt) {
      bt.onclick = function () { setSel(bt.getAttribute('data-k')); };
      bt.onkeydown = function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var i = BIZ.findIndex(function (b) { return b.k === sel; }) + (e.key === 'ArrowRight' ? 1 : -1);
        setSel(BIZ[(i + BIZ.length) % BIZ.length].k);
        root.querySelector('.rs-tabs button[data-k="' + sel + '"]').focus();
      };
    });
    window.addEventListener('resize', syncTabs);
    syncTabs();
    renderBiz(true);
  }
  function setSel(k) { if (k === sel) return; sel = k; if (sel !== 'all') bulBy = 'pais'; syncTabs(); renderBiz(false); }
  function syncTabs() {
    var ind = root.querySelector('.rs-tabs .ind');
    Array.prototype.forEach.call(root.querySelectorAll('.rs-tabs button'), function (bt) {
      var on = bt.getAttribute('data-k') === sel;
      bt.setAttribute('aria-selected', String(on));
      if (on && ind) { ind.style.width = bt.offsetWidth + 'px'; ind.style.transform = 'translateX(' + bt.offsetLeft + 'px)'; }
    });
  }

  // ── Piezas ──────────────────────────────────────────────────────────────────────────────
  function sparkSvg(tr, m, id) {
    var W = 240, H = 46, ys = [];
    tr.forEach(function (w) { ys.push(val(w.cur, m)); ys.push(val(w.bud, m)); });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys), pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
    var x = function (i) { return i * W / (tr.length - 1); }, y = function (v) { return H - (v - lo) / (hi - lo) * H; };
    var pc = tr.map(function (w, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val(w.cur, m)).toFixed(1); }).join(' ');
    var pb = tr.map(function (w, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val(w.bud, m)).toFixed(1); }).join(' ');
    var last = tr[tr.length - 1];
    return '<svg class="kpi-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--s-act);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--s-act);stop-opacity:0"/></linearGradient></defs>' +
      '<path d="' + pc + ' L' + W + ' ' + H + ' L0 ' + H + 'Z" fill="url(#' + id + ')"/>' +
      '<path d="' + pb + '" fill="none" stroke="var(--s-bud)" stroke-width="1.4" stroke-dasharray="3 3" opacity=".8" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + pc + '" fill="none" stroke="var(--s-act)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + W + '" cy="' + y(val(last.cur, m)).toFixed(1) + '" r="3" fill="var(--s-act)"/></svg>';
  }

  function kpiCard(m, V, i) {
    var T = V.T, v = val(T.cur, m);
    return '<button type="button" class="rs-card c-kpi rs-in" style="--d:' + (80 + i * 60) + 'ms" data-m="' + m + '" aria-pressed="' + (m === metric) + '">' +
      '<div class="kpi-top"><span class="k">' + MET[m] + '</span>' + chip(dlt(T.cur, T.bud, m), m) + '</div>' +
      '<div class="kpi-v" data-count="' + (v == null ? '' : v) + '" data-fmt="' + m + '">' + fmtM(m, v) + '</div>' +
      sparkSvg(V.trend, m, 'sg-' + m) +
      '<div class="kpi-foot"><span>LY <b class="' + cls(dlt(T.cur, T.ly, m)) + '">' + fd(m, dlt(T.cur, T.ly, m)) + '</b></span>' +
      '<span>L4W <b class="' + cls(dlt(T.cur, T.l4w, m)) + '">' + fd(m, dlt(T.cur, T.l4w, m)) + '</b></span>' +
      '<span>RR <b class="' + cls(dlt(T.cur, T.rr, m)) + '">' + fd(m, dlt(T.cur, T.rr, m)) + '</b></span></div></button>';
  }

  function dialCard(V) {
    var T = V.T, att = T.bud.rev ? T.cur.rev / T.bud.rev * 100 : null, s = state(att == null ? null : att - 100) || 'g';
    var R = 52, C = 2 * Math.PI * R, fill = att == null ? 0 : Math.max(0, Math.min(att, 100)) / 100;
    var col = { g: 'var(--good)', a: 'var(--warn)', r: 'var(--crit)' }[s];
    var gap = T.cur.rev - T.bud.rev;
    return '<section class="rs-card c-dial rs-in" style="--d:60ms" aria-label="Cumplimiento de Net Revenues vs Budget"><h2>Net Revenues vs Budget</h2>' +
      '<div class="rs-ring" style="--ring:' + col + '"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="rs-ring-bg" cx="60" cy="60" r="' + R + '" fill="none" stroke-width="9"/>' +
      '<circle class="rs-ring-fg" cx="60" cy="60" r="' + R + '" fill="none" stroke-width="9" stroke-linecap="round" style="color:' + col + '" stroke="' + col + '" ' +
      'stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + C.toFixed(2) + '" data-off="' + (C * (1 - fill)).toFixed(2) + '"/></svg>' +
      '<div class="rs-ring-c"><div class="v"><span data-count="' + (att == null ? '' : att) + '" data-fmt="int">' + (att == null ? '—' : Math.round(att)) + '</span><small>%</small></div>' +
      '<div class="k">del Budget</div></div></div>' +
      '<p class="rs-dial-cap"><b>' + money(T.cur.rev) + '</b> de ' + money(T.bud.rev) + ' · <span class="' + cls(gap) + '">' + sgnMoney(gap) + '</span></p>' +
      '<div class="rs-vs"><div><span>vs Last Year</span>' + chip(pct(T.cur.rev, T.ly.rev), 'rev', true) + '</div>' +
      '<div><span>vs promedio L4W</span>' + chip(pct(T.cur.rev, T.l4w.rev), 'rev', true) + '</div>' +
      '<div><span>vs Run Rate</span>' + chip(pct(T.cur.rev, T.rr.rev), 'rev') + '</div></div></section>';
  }

  function renderBiz(first) {
    var V = view(sel), host = document.getElementById('rs-biz');
    var S = summary(false).filter(function (x) { return x.k === sel; })[0];
    var h = '<div class="rs-bento">' + dialCard(V) + ['gb', 'rev', 'fvm', 'sh'].map(function (m, i) { return kpiCard(m, V, i); }).join('');
    h += '<section class="rs-card c-chart rs-in" style="--d:300ms" aria-labelledby="rs-ch-h"><div class="rs-chart-top"><div class="t"><h2 id="rs-ch-h">Últimas 13 semanas</h2>' +
      '<div class="big" id="rs-ch-big"></div></div>' +
      '<div class="rs-legend"><span><i style="border-color:var(--s-act)"></i>Actual</span><span><i class="dash" style="border-color:var(--s-bud)"></i>Budget</span>' +
      '<span><i style="border-color:var(--s-ly)"></i>Last Year</span></div></div><div class="rs-plot" id="rs-plot"></div>' +
      '<details class="rs-det"><summary>Ver como tabla</summary><div class="rs-tbl-wrap" id="rs-trend-tbl"></div></details></section>';
    h += '<section class="rs-card c-bul rs-in" style="--d:360ms" aria-labelledby="rs-bul-h"><div class="rs-bul-top"><h2 id="rs-bul-h">Dónde se explica</h2>' +
      (sel === 'all' ? '<div class="rs-seg" role="group" aria-label="Apertura"><button type="button" data-b="pais" aria-pressed="' + (bulBy === 'pais') + '">Por país</button>' +
        '<button type="button" data-b="neg" aria-pressed="' + (bulBy === 'neg') + '">Por negocio</button></div>' : '') +
      '</div><p class="rs-bul-sub" id="rs-bul-sub"></p><div class="rs-bul" id="rs-bul"></div>' +
      '<details class="rs-det"><summary>Ver tabla completa por país</summary><div class="rs-tbl-wrap">' + countryTable(V) + '</div></details></section>';
    h += '<section class="rs-card c-sum rs-in" style="--d:420ms" aria-labelledby="rs-sum-h"><h2 id="rs-sum-h">La semana en pocas líneas · ' + esc(bizLbl(sel)) + '</h2>' +
      '<p class="rs-sum-t">' + S.t + '</p><div class="rs-sum-f"><button type="button" class="rs-btn" id="rs-copy2">Copiar resumen completo</button></div></section>';
    h += '</div>';
    host.innerHTML = h;
    if (!first) Array.prototype.forEach.call(host.querySelectorAll('.rs-in'), function (el) { el.style.setProperty('--d', '0ms'); });
    document.getElementById('rs-copy2').onclick = copySlack;
    Array.prototype.forEach.call(host.querySelectorAll('.c-kpi'), function (bt) {
      bt.onclick = function () {
        metric = bt.getAttribute('data-m');
        Array.prototype.forEach.call(host.querySelectorAll('.c-kpi'), function (x) { x.setAttribute('aria-pressed', String(x === bt)); });
        chart(V); bullets(V);
      };
    });
    Array.prototype.forEach.call(host.querySelectorAll('.rs-seg button'), function (bt) {
      bt.onclick = function () {
        bulBy = bt.getAttribute('data-b');
        Array.prototype.forEach.call(host.querySelectorAll('.rs-seg button'), function (x) { x.setAttribute('aria-pressed', String(x === bt)); });
        bullets(V);
      };
    });
    spotlight(host);
    countUp(host);
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(host.querySelectorAll('.rs-ring-fg'), function (c) { c.style.strokeDashoffset = c.getAttribute('data-off'); });
    });
    chart(V); bullets(V);
  }

  // Barras "bullet": barra = real, marca = Budget; el color es el semáforo vs Budget
  function bullets(V) {
    var m = metric === 'sh' ? 'sh' : metric, host = document.getElementById('rs-bul');
    var rows;
    if (sel === 'all' && bulBy === 'neg') {
      rows = ['b2b2c', 'api', 'html'].map(function (k) { var t = view(k).T; return { n: bizLbl(k), c: t.cur, b: t.bud }; });
    } else {
      rows = Object.keys(V.by.cur).concat(Object.keys(V.by.bud)).filter(function (p, i, a) { return a.indexOf(p) === i && p !== 'RG'; })
        .map(function (p) { return { n: cname(p), c: V.by.cur[p] || z(), b: V.by.bud[p] || z() }; });
    }
    rows.sort(function (a, b) { return (val(b.c, m) || 0) - (val(a.c, m) || 0); });
    var more = rows.length > 8 ? rows.length - 8 : 0; rows = rows.slice(0, 8);
    var mx = 0; rows.forEach(function (r) { mx = Math.max(mx, val(r.c, m) || 0, val(r.b, m) || 0); }); mx = mx * 1.04 || 1;
    function row(r, cl) {
      var c = val(r.c, m), b = val(r.b, m), d = dlt(r.c, r.b, m), s = state(m === 'sh' ? d * 5 : d) || 'g';
      return '<div class="row' + (cl ? ' ' + cl : '') + '"><span class="nm" title="' + esc(r.n) + '">' + esc(r.n) + '</span>' +
        (cl ? '<span class="rs-bul-sub" style="margin:0">' + (m === 'sh' ? 'Budget ' + fmtM(m, b) : fmtM(m, b) + ' de Budget') + '</span>' :
          '<span class="trk" role="img" aria-label="' + esc(r.n) + ': ' + fmtM(m, c) + ' contra ' + fmtM(m, b) + ' de Budget">' +
          '<span class="fill ' + s + '" data-w="' + (Math.max(0, c || 0) / mx * 100).toFixed(1) + '"></span><span class="tick" style="left:' + (Math.max(0, b || 0) / mx * 100).toFixed(1) + '%"></span></span>') +
        '<span class="val">' + fmtM(m, c) + '</span>' + chip(d, m) + '</div>';
    }
    host.innerHTML = rows.map(function (r) { return row(r); }).join('') + row({ n: 'Total', c: V.T.cur, b: V.T.bud }, 'tot');
    document.getElementById('rs-bul-sub').textContent = MET[m] + ' de la semana ' + D.week.week + ' · la marca es el Budget' + (more ? ' · ' + more + ' más en la tabla' : '');
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      Array.prototype.forEach.call(host.querySelectorAll('.fill'), function (f) { f.style.width = f.getAttribute('data-w') + '%'; });
    }); });
  }

  function countryTable(V) {
    function cmpT(v) { return '<span class="' + cls(v) + '">' + fp(v) + '</span>'; }
    function cmpPP(v) { return '<span class="' + cls(v) + '">' + fpp(v) + '</span>'; }
    var ps = Object.keys(V.by.cur).concat(Object.keys(V.by.bud)).filter(function (p, i, a) { return a.indexOf(p) === i && p !== 'RG'; });
    ps.sort(function (a, b) { return (V.by.cur[b] || z()).rev - (V.by.cur[a] || z()).rev; });
    function row(name, c, bd, ly, cl) {
      var sc = share(c), sb = share(bd);
      return '<tr' + (cl ? ' class="' + cl + '"' : '') + '><td>' + name + '</td>' +
        '<td class="sep">' + money(c.gb) + '</td><td>' + cmpT(pct(c.gb, bd.gb)) + '</td><td>' + cmpT(pct(c.gb, ly.gb)) + '</td>' +
        '<td class="sep">' + money(c.rev) + '</td><td>' + cmpT(pct(c.rev, bd.rev)) + '</td><td class="' + cls(c.rev - bd.rev) + '">' + sgnMoney(c.rev - bd.rev) + '</td><td>' + cmpT(pct(c.rev, ly.rev)) + '</td>' +
        '<td class="sep">' + money(c.fvm) + '</td><td>' + (sc == null ? '—' : sc.toFixed(1) + '%') + '</td><td>' + cmpPP(sc != null && sb != null ? sc - sb : null) + '</td></tr>';
    }
    var body = ps.map(function (p) { return row(esc(cname(p)), V.by.cur[p] || z(), V.by.bud[p] || z(), V.by.ly[p] || z()); }).join('');
    return '<table class="rs-tbl"><thead><tr><th></th><th class="grp sep" colspan="3">Gross Bookings</th><th class="grp sep" colspan="4">Net Revenues</th><th class="grp sep" colspan="3">FVM</th></tr>' +
      '<tr><th>País</th><th class="sep">Actual</th><th>vs Bud</th><th>vs LY</th><th class="sep">Actual</th><th>vs Bud</th><th>Δ$ vs Bud</th><th>vs LY</th><th class="sep">Actual</th><th>%GB</th><th>vs Bud</th></tr></thead>' +
      '<tbody>' + body + row('Total', V.T.cur, V.T.bud, V.T.ly, 'tot') + '</tbody></table>';
  }

  // ── Gráfico: 13 semanas, Actual (área) / Budget (punteado) / LY ──────────────────────────
  function chart(V) {
    var host = document.getElementById('rs-plot'), m = metric, tr = V.trend;
    var W = 1100, H = 280, L = 56, R = 70, Tp = 14, B = 30, iw = W - L - R, ih = H - Tp - B;
    var S = [{ k: 'ly', c: 'var(--s-ly)', n: 'Last Year', w: 1.6 }, { k: 'bud', c: 'var(--s-bud)', n: 'Budget', dash: '6 5', w: 1.8 }, { k: 'cur', c: 'var(--s-act)', n: 'Actual', w: 2.6 }];
    var vals = []; tr.forEach(function (w) { S.forEach(function (s) { var v = val(w[s.k], m); if (v != null) vals.push(v); }); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals) || 1; lo = Math.max(lo < 0 ? lo : 0, lo - (hi - lo) * 0.6);   // sin forzar el 0: se ven las diferencias
    var step = niceStep((hi - lo) / 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    var x = function (i) { return L + (tr.length === 1 ? iw / 2 : i * iw / (tr.length - 1)); };
    var y = function (v) { return Tp + ih - ((v == null ? lo : v) - lo) / (hi - lo) * ih; };
    var g = '<defs><linearGradient id="rs-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--s-act);stop-opacity:.32"/><stop offset="1" style="stop-color:var(--s-act);stop-opacity:0"/></linearGradient></defs>';
    for (var v = lo; v <= hi + step / 2; v += step) g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ax" x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fmtM(m, v) + '</text>';
    tr.forEach(function (w, i) { if (i % 2 === (tr.length - 1) % 2) g += '<text class="ax" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">W' + w.week + '</text>'; });
    var pathOf = function (k) { return tr.map(function (w, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val(w[k], m)).toFixed(1); }).join(' '); };
    g += '<path d="' + pathOf('cur') + ' L' + x(tr.length - 1) + ' ' + (Tp + ih) + ' L' + L + ' ' + (Tp + ih) + 'Z" fill="url(#rs-area)"/>';
    var ends = [];
    S.forEach(function (s) {
      g += '<path class="' + (s.dash ? '' : 'rs-line') + '" d="' + pathOf(s.k) + '" fill="none" stroke="' + s.c + '" stroke-width="' + s.w + '" stroke-linejoin="round" stroke-linecap="round"' +
        (s.dash ? ' stroke-dasharray="' + s.dash + '"' : ' pathLength="1" stroke-dasharray="1" stroke-dashoffset="' + (RM ? 0 : 1) + '"') + '/>';
      var lv = val(tr[tr.length - 1][s.k], m);
      ends.push({ s: s, y: y(lv), v: lv });
    });
    ends.sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    ends.forEach(function (e) {
      g += '<circle cx="' + x(tr.length - 1) + '" cy="' + y(e.v) + '" r="4" fill="' + e.s.c + '" stroke="var(--tile)" stroke-width="2"/>';
      g += '<text class="dl" x="' + (x(tr.length - 1) + 10) + '" y="' + (e.y + 4) + '" fill="' + e.s.c + '">' + fmtM(m, e.v) + '</text>';
    });
    g += '<line id="rs-cross" y1="' + Tp + '" y2="' + (Tp + ih) + '" stroke="var(--text-3)" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>';
    g += '<circle id="rs-cdot" r="5" fill="var(--s-act)" stroke="var(--tile)" stroke-width="2" visibility="hidden"/>';
    g += '<rect x="' + L + '" y="' + Tp + '" width="' + iw + '" height="' + ih + '" fill="transparent" id="rs-hit"/>';
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + MET[m] + ' semanal: Actual, Budget y Last Year de las últimas 13 semanas">' + g + '</svg><div class="rs-tip" id="rs-tip"></div>';
    var last = tr[tr.length - 1];
    document.getElementById('rs-ch-big').innerHTML = esc(MET[m]) + ' · <span class="' + cls(dlt(last.cur, last.bud, m)) + '">' + fd(m, dlt(last.cur, last.bud, m)) + '</span> <span style="font-size:14px;font-weight:500;color:var(--text-3)">vs Budget en W' + last.week + '</span>';
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      Array.prototype.forEach.call(host.querySelectorAll('.rs-line'), function (p) { p.style.strokeDashoffset = '0'; });
    }); });
    var svg = host.querySelector('svg'), tip = document.getElementById('rs-tip'), cross = document.getElementById('rs-cross'), cdot = document.getElementById('rs-cdot');
    function move(ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
      var i = Math.max(0, Math.min(tr.length - 1, Math.round((px - L) / iw * (tr.length - 1)))), w = tr[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      cdot.setAttribute('cx', x(i)); cdot.setAttribute('cy', y(val(w.cur, m))); cdot.setAttribute('visibility', 'visible');
      var a = w.from.split('-');
      tip.innerHTML = '<b>W' + w.week + ' · ' + (+a[2]) + ' ' + MES[+a[1] - 1] + '</b>' + S.slice().reverse().map(function (s) {
        return '<div><span><i style="background:' + s.c + '"></i>' + s.n + '</span><span>' + fmtM(m, val(w[s.k], m)) + '</span></div>';
      }).join('') + '<div><span>vs Budget</span><span class="' + cls(dlt(w.cur, w.bud, m)) + '">' + fd(m, dlt(w.cur, w.bud, m)) + '</span></div>' +
        '<div><span>vs LY</span><span class="' + cls(dlt(w.cur, w.ly, m)) + '">' + fd(m, dlt(w.cur, w.ly, m)) + '</span></div>';
      tip.style.display = 'block';
      var left = x(i) / W * r.width + 14;
      if (left + tip.offsetWidth > r.width) left = x(i) / W * r.width - tip.offsetWidth - 14;
      tip.style.left = left + 'px'; tip.style.top = '8px';
    }
    var hit = document.getElementById('rs-hit');
    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', function () { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); cdot.setAttribute('visibility', 'hidden'); });
    document.getElementById('rs-trend-tbl').innerHTML = '<table class="rs-tbl"><thead><tr><th>Semana</th><th>Actual</th><th>Budget</th><th>vs Bud</th><th>Last Year</th><th>vs LY</th></tr></thead><tbody>' +
      tr.map(function (w) { return '<tr><td>W' + w.week + ' (' + w.from.split('-').reverse().slice(0, 2).join('/') + ')</td><td>' + fmtM(m, val(w.cur, m)) + '</td><td>' + fmtM(m, val(w.bud, m)) + '</td><td class="' + cls(dlt(w.cur, w.bud, m)) + '">' + fd(m, dlt(w.cur, w.bud, m)) +
        '</td><td>' + fmtM(m, val(w.ly, m)) + '</td><td class="' + cls(dlt(w.cur, w.ly, m)) + '">' + fd(m, dlt(w.cur, w.ly, m)) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  // ── Efectos: luz que sigue al mouse en las tarjetas y números que cuentan ───────────────────
  function spotlight(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('.rs-card'), function (c) {
      c.addEventListener('pointermove', function (e) {
        var r = c.getBoundingClientRect();
        c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }
  function countUp(scope) {
    if (RM) return;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-count]'), function (el) {
      var to = parseFloat(el.getAttribute('data-count')), f = el.getAttribute('data-fmt');
      if (!isFinite(to)) return;
      var t0 = null, dur = 900;
      function fmt(v) { return f === 'int' ? String(Math.round(v)) : fmtM(f, v); }
      function step(t) {
        if (!t0) t0 = t;
        var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = fmt(to * e);
        if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
      }
      requestAnimationFrame(step);
    });
  }

  function copySlack() {
    var t = '*Resumen semanal · ' + weekTitle() + '*\n\n' + summary(true).map(function (x) {
      return '*' + bizLbl(x.k) + '*: ' + x.t;
    }).join('\n\n');
    var bt = this, lbl = bt.querySelector('span') || bt, orig = lbl.textContent;
    var ok = function () { lbl.textContent = 'Copiado ✓'; setTimeout(function () { lbl.textContent = orig; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { fallback(t); ok(); });
    else { fallback(t); ok(); }
  }
  function fallback(t) {
    var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nada */ }
    document.body.removeChild(ta);
  }

  // ── Datos ───────────────────────────────────────────────────────────────────────────────
  root.innerHTML = '<div class="rs-skel" style="height:120px;margin-bottom:20px"></div><div class="rs-skel"></div><p class="rs-state">Cargando la última semana…</p>';
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
