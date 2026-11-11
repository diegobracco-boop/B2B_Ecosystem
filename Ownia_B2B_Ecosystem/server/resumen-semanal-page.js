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
// 2026-11-06, pedido del CEO: "La semana en pocas líneas" arriba ("Dónde" y "Para mirar" suman un partner de B2B2C en
// todos sus países si pesa); tarjetas fijas (sin botones), gráfico de FVM y "Dónde se explica" por país con, debajo de
// Brasil / Argentina / México / Chile, hasta 2 partners que explican su desvío; tablas abiertas. Arriba, Semanal / MTD
// (mes al último día con reales, o meses cerrados).
// Organic (2026-11-06): montos con el switch ORGANIC en Budget del Weekly del Daily (actuals a TC Budget; vs LY con
// los actuals a TC del año anterior = curL; vs Run Rate con los nominales = curN). El dial es de FVM. Abajo de
// Semanal / MTD: "Exportar a Slides" (deck .pptx para el comité ejecutivo, armado en el navegador con PptxGenJS) y
// "Copiar link" (link a la vista que se está mirando, para mandar por Slack).
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
  #rs-root.calm .rs-in { animation: rsFade .25s ease both; animation-delay: 0ms; }   /* al cambiar de semana o negocio: sin la entrada completa */
  @keyframes rsFade { from { opacity: .4; } to { opacity: 1; } }
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
                    font: 500 14px var(--font); cursor: pointer; transition: color .25s var(--ease); white-space: nowrap; }
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
  .c-chart { grid-column: span 7; }
  .c-bul { grid-column: span 5; }

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

  /* Vista Semanal / MTD (arriba, al lado de la fecha) */
  .rs-top { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; justify-content: space-between; }
  .rs-ctl { display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
  .rs-ctl .rs-btn { justify-content: center; background: var(--tile); }
  .rs-mode { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--tile); box-shadow: inset 0 0 0 1px var(--line); }
  .rs-mode button { padding: 7px 18px; border-radius: 999px; border: 0; background: transparent; color: var(--text-2); font: 600 13.5px var(--font); cursor: pointer; transition: background .2s, color .2s; }
  .rs-mode button[aria-pressed="true"] { background: var(--primary); color: #fff; box-shadow: 0 6px 20px var(--glow); }

  /* Dónde se explica: barras por país (real vs marca de Budget) y, abajo de BR / AR / MX / CL, los partners que lo explican */
  .rs-bul-sub { margin-top: 4px; font-size: 12.5px; color: var(--text-3); }
  .rs-bul { margin-top: 14px; display: grid; gap: 2px; }
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
  .rs-bul .row.sub { padding: 0 0 6px; font-size: 12.5px; color: var(--text-2); }
  .rs-bul .row.sub .nm { padding-left: 14px; color: var(--text-2); }
  .rs-bul .row.sub .nm::before { content: '↳ '; color: var(--text-3); }
  .rs-bul .row.sub .why { color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rs-bul .row.sub .chip { font-size: 11px; padding: 1px 7px; }
  .rs-bul .row.tot { margin-top: 4px; padding-top: 11px; border-top: 1px solid var(--line); font-weight: 600; }

  /* Selector de semana */
  .rs-weeks { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line); overflow-x: auto; max-width: 100%; scrollbar-width: none; }
  .rs-weeks button { flex: none; padding: 6px 12px; border-radius: 999px; border: 0; background: transparent; color: var(--text-2); font: 500 13px var(--font);
                     cursor: pointer; font-variant-numeric: tabular-nums; transition: background .2s, color .2s; }
  .rs-weeks button:hover { color: var(--text); }
  .rs-weeks button[aria-pressed="true"] { background: var(--tile-hover); color: var(--text); box-shadow: inset 0 0 0 1px var(--link); }
  .rs-weeks button small { margin-left: 5px; font-size: 10.5px; color: var(--link); text-transform: uppercase; letter-spacing: .05em; }
  #rs-root.busy #rs-biz { opacity: .45; pointer-events: none; transition: opacity .2s; }
  .rs-live.off { background: var(--text-3); animation: none; }

  /* Resumen en texto (arriba de las tarjetas) */
  .c-sum { grid-column: span 12; }
  .rs-sum-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .rs-sum-head h2 { flex: 1; }
  .rs-ins { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 28px; margin-top: 10px; }
  .rs-ins > div { display: grid; grid-template-columns: 22px 1fr; gap: 10px; padding: 11px 0; border-top: 1px solid var(--line); font-size: 14.5px; line-height: 1.6; color: var(--text-2); }
  .rs-ins > div:nth-child(-n+2) { border-top: 0; }
  .rs-ins b { color: var(--text); font-weight: 600; }
  .rs-ins .ic { width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; background: var(--tile-hover); color: var(--link); margin-top: 2px; }
  .rs-ins .ic svg { width: 13px; height: 13px; }
  .rs-ins .lb { display: block; font-size: 11.5px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: .07em; }
  .rs-ins .watch .ic { color: var(--warn); background: var(--warn-bg); }
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
  .rs-note { margin-top: 28px; font-size: 12.5px; color: var(--text-3); line-height: 1.6; max-width: 110ch; }
  .rs-state { padding: 48px 0; text-align: center; color: var(--text-2); }
  .rs-skel { height: 160px; border-radius: 22px; background: linear-gradient(90deg, var(--tile) 0%, var(--tile-hover) 50%, var(--tile) 100%); background-size: 200% 100%; animation: rsSk 1.4s infinite; }
  @keyframes rsSk { to { background-position: -200% 0; } }

  @media (max-width: 960px) {
    .c-dial { grid-column: span 12; grid-row: auto; } .c-kpi { grid-column: span 6; }
    .c-bul, .c-chart { grid-column: span 12; }
    .rs-ins { grid-template-columns: minmax(0, 1fr); } .rs-ins > div:nth-child(2) { border-top: 1px solid var(--line); }
  }
  @media (max-width: 560px) {
    .c-kpi { grid-column: span 12; }
    .rs-bul .row { grid-template-columns: 84px 1fr 62px; } .rs-bul .row .chip { display: none; }
    .rs-mode button { padding: 6px 14px; }
    .rs-tabs button { padding: 7px 11px; font-size: 13px; }
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
  // Código de la bandera en Slack (:flag-xx:)
  var FLAG = { Argentina: 'ar', Brasil: 'br', Chile: 'cl', Colombia: 'co', Ecuador: 'ec',
    Mexico: 'mx', Peru: 'pe', Uruguay: 'uy', Paraguay: 'py', USA: 'us' };
  var NAME = { Mexico: 'México', Peru: 'Perú', 'Other Countries': 'Otros países', RG: 'Ajuste COI Brasil' };
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  // mode: 'w' = semana, 'm' = MTD. req: lo pedido al servidor (semana y mes; null = el último)
  var D = null, sel = 'all', mode = 'w', req = { week: null, month: null };

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
  function joinY(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]; }
  function byAbs(a, b) { return Math.abs(b.d) - Math.abs(a.d); }
  function ddmm(s) { return s.split('-').reverse().slice(0, 2).join('/'); }

  // ── Datos de la vista (semana o MTD) ─────────────────────────────────────────────────────
  // Un negocio (o el consolidado): totales y por país de cada escenario, unidades (partner × país en B2B2C, país en B2B)
  // y la serie del gráfico (13 semanas, o los días del mes acumulados).
  function view(k) {
    var keys = k === 'all' ? ['b2b2c', 'api', 'html'] : [k], M = mode === 'm';
    var SC = M ? ['cur', 'bud', 'ly', 'rr', 'curL', 'curN'] : ['cur', 'bud', 'ly', 'rr', 'l4w', 'l4wLy', 'curL', 'curN', 'l4wL'];
    var FB = { curL: 'cur', curN: 'cur', l4wL: 'l4w' };   // sin organic (o datos viejos): los nominales
    var o = {}, units = [], budMonth = z();
    SC.forEach(function (sc) { o[sc] = {}; });
    keys.forEach(function (bk) {
      var b = D.biz[bk], src = M ? b.mtd : b;
      SC.forEach(function (sc) { var x = src[sc] || src[FB[sc]] || {}; Object.keys(x).forEach(function (p) { o[sc][p] = add(o[sc][p] || z(), x[p]); }); });
      var U = src.units || {};
      Object.keys(U).forEach(function (key) {
        var u = U[key];
        units.push({ key: key, biz: bk, part: partName(u.n), pk: u.n ? u.n.toLowerCase() : '', pais: u.p, cur: u.cur, bud: u.bud, ly: u.ly, cl: u.cl || u.cur });
      });
      if (M) add(budMonth, b.mtd.budMonth || z());
    });
    var T = {};
    SC.forEach(function (sc) { T[sc] = tot(o[sc]); });
    var series;
    if (M) {
      var acc = { cur: z(), bud: z(), ly: z(), curL: z() };
      series = D.biz[keys[0]].mtd.days.map(function (d0, i) {
        keys.forEach(function (bk) { var x = D.biz[bk].mtd.days[i]; add(acc.cur, x.cur); add(acc.bud, x.bud); add(acc.ly, x.ly); add(acc.curL, x.curL || x.cur); });
        var a = d0.d.split('-');
        return { lbl: String(+a[2]), tip: (+a[2]) + ' ' + MES[+a[1] - 1] + ' (acumulado)', cur: add(z(), acc.cur), bud: add(z(), acc.bud), ly: add(z(), acc.ly), curL: add(z(), acc.curL) };
      });
    } else {
      series = D.biz[keys[0]].trend.map(function (w, i) {
        var r = { lbl: 'W' + w.week, tip: 'W' + w.week + ' · ' + (+w.from.split('-')[2]) + ' ' + MES[+w.from.split('-')[1] - 1], cur: z(), bud: z(), ly: z(), curL: z() };
        keys.forEach(function (bk) { var x = D.biz[bk].trend[i]; add(r.cur, x.cur); add(r.bud, x.bud); add(r.ly, x.ly); add(r.curL, x.curL || x.cur); });
        return r;
      });
    }
    return { by: o, T: T, series: series, units: units, keys: keys, budMonth: budMonth };
  }

  // ── Qué explica el desvío de NR vs Budget ────────────────────────────────────────────────
  // Primero los partners (solo B2B2C trae partner) cuyo desvío, sumando todos sus países, pesa: ≥12% del desvío total o
  // ≥0,8% del Budget. Después los países con lo que queda (sin esos partners). Lo que no llega al umbral va a "Resto".
  // Así, si una semana el desvío lo explica un partner en varios países aparece como una sola línea, y si otra semana
  // lo explica un país (repartido en varios partners, o B2B), aparece el país.
  function grp(t, n, key) { return { t: t, n: n, key: key, d: 0, cur: z(), bud: z(), ly: z(), cl: z(), units: [] }; }
  function push(g, u) { add(g.cur, u.cur); add(g.bud, u.bud); add(g.ly, u.ly); add(g.cl, u.cl); g.d = g.cur.rev - g.bud.rev; g.units.push(u); }
  // "TBD" es el Budget de partners nuevos todavía sin firmar (Hunting): no es un partner con ventas
  function partName(n) { return !n ? '' : /^tbd$/i.test(String(n).trim()) ? 'Partners nuevos (TBD)' : n; }
  function drivers(V) {
    var U = V.units, dev = V.T.cur.rev - V.T.bud.rev, thr = Math.max(Math.abs(dev) * 0.12, Math.abs(V.T.bud.rev) * 0.008, 1);
    var P = {};
    U.forEach(function (u) { if (u.pk) push(P[u.pk] = P[u.pk] || grp('p', u.part, 'p:' + u.pk), u); });
    var picked = Object.keys(P).map(function (k) { return P[k]; }).filter(function (g) { return Math.abs(g.d) >= thr; }).sort(byAbs).slice(0, 4);
    var used = {};
    picked.forEach(function (g) { g.units.forEach(function (u) { used[u.biz + '|' + u.key] = 1; }); });
    var C = {};
    U.forEach(function (u) { if (!used[u.biz + '|' + u.key]) push(C[u.pais] = C[u.pais] || grp('c', cname(u.pais), 'c:' + u.pais), u); });
    var cs = Object.keys(C).map(function (k) { return C[k]; }).filter(function (g) { return Math.abs(g.d) >= thr; }).sort(byAbs).slice(0, Math.max(2, 6 - picked.length));
    cs.forEach(function (g) {   // qué partners elegidos arriba también venden en este país (el país se muestra sin ellos)
      g.excl = picked.filter(function (pg) { return pg.units.some(function (u) { return u.pais === g.key.substring(2); }); }).map(function (pg) { return pg.n; });
    });
    var list = picked.concat(cs).sort(byAbs), inList = 0;
    list.forEach(function (g) { inList += g.d; });
    return { dev: dev, list: list, rest: dev - inList };
  }
  // Semanas seguidas (de la elegida hacia atrás) del mismo lado del Budget que el desvío del grupo; solo en la vista semanal
  function streakOf(g) {
    if (mode === 'm') return 0;
    var sign = g.d < 0 ? -1 : 1, n = 0, len = (D.biz[g.units[0].biz].ustreak || []).length;
    for (var s = len - 1; s >= 0; s--) {
      var a = 0, b = 0;
      g.units.forEach(function (u) { var v = ((D.biz[u.biz].ustreak || [])[s] || {})[u.key]; if (v) { a += v[0]; b += v[1]; } });
      if (b && (a - b) * sign > 0) n++; else break;
    }
    return n;
  }
  // Volumen (GB a take rate de Budget) o take rate (sobre el GB real): qué pesa más en el desvío del grupo
  function causeOf(g) {
    if (!g.bud.gb && !g.bud.rev) return { k: 'new', t: 'sin Budget' };
    if (!g.cur.gb && !g.cur.rev) return { k: 'none', t: 'sin ventas' };
    var trA = g.cur.gb ? g.cur.rev / g.cur.gb : 0, trB = g.bud.gb ? g.bud.rev / g.bud.gb : 0, vol = (g.cur.gb - g.bud.gb) * trB, rate = g.d - vol;
    return Math.abs(vol) >= Math.abs(rate)
      ? { k: 'vol', t: 'por volumen (GB ' + fp(pct(g.cur.gb, g.bud.gb)) + ' vs Budget)' }
      : { k: 'rate', t: 'por take rate (' + (trA * 100).toFixed(1) + '% vs ' + (trB * 100).toFixed(1) + '% de Budget)' };
  }
  function tagOf(g) {
    if (g.t === 'p') return 'Partner · ' + joinY(g.units.map(function (u) { return cname(u.pais); }).filter(function (x, i, a) { return a.indexOf(x) === i; }));
    return g.key === 'c:RG' ? 'Ajuste' : 'País' + (g.excl && g.excl.length ? ' · sin ' + joinY(g.excl) : '');
  }
  // ── Resumen en texto (HTML para la página y texto para Slack) ────────────────────────────
  // Estructura de un comentario de desvíos (skill variance-analysis del plugin Finance): resultado con $ y % vs Budget,
  // puente (volumen de GB × take rate), dónde se explica, si se repite o es puntual, rentabilidad y qué mirar.
  var IC = {
    res: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    bridge: '<path d="M3 17h4V9h4v4h4V7h4v10h2"/>',
    where: '<circle cx="12" cy="10" r="3"/><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    margin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9.5c0-1 1.3-1.8 3-1.8s3 .8 3 1.8-1.3 1.6-3 2-3 1-3 2 1.3 1.8 3 1.8 3-.8 3-1.8"/>',
    watch: '<path d="M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  };
  function ord(n) { return n + 'ª'; }
  function periodo() { return mode === 'm' ? (isCurMonth() ? 'del mes' : 'de ' + MESL[+D.month.ym.substring(5, 7) - 1]) : 'de la semana'; }
  function gName(g, slack) { return slack ? (g.t === 'c' ? flag(g.key.substring(2), true) : '') + g.n : esc(g.n); }
  function insights(k, slack) {
    var b = slack ? function (x) { return '*' + x + '*'; } : function (x) { return '<b>' + x + '</b>'; };
    var V = view(k), T = V.T, out = [], keys = V.keys, M = mode === 'm';
    var dev = T.cur.rev - T.bud.rev, pN = pct(T.cur.rev, T.bud.rev), yN = pct(T.curL.rev, T.ly.rev);

    out.push({ k: 'res', lbl: 'Resultado', t: 'Net Revenues ' + (k === 'all' ? 'del ecosistema ' : '') + periodo() + ': ' + b(money(T.cur.rev)) + ', ' +
      b(sgnMoney(dev) + ' / ' + fp(pN)) + ' vs Budget' + dot(pN, slack) + ' y ' + b(fp(yN)) + ' vs LY, sobre ' + money(T.cur.gb) + ' de GB (' + fp(pct(T.cur.gb, T.bud.gb)) + ' vs Budget).' });

    // Puente NR vs Budget = volumen (GB a take rate de Budget) + take rate (sobre el GB real). Suma exacto el desvío.
    var trA = T.cur.gb ? T.cur.rev / T.cur.gb : 0, trB = T.bud.gb ? T.bud.rev / T.bud.gb : 0;
    var vol = (T.cur.gb - T.bud.gb) * trB, rate = dev - vol;
    var bt = 'El desvío es más de ' + b(Math.abs(vol) >= Math.abs(rate) ? 'volumen' : 'take rate') + ': ' + sgnMoney(vol) + ' por volumen (GB ' + fp(pct(T.cur.gb, T.bud.gb)) + ') y ' + sgnMoney(rate) +
      ' por take rate (' + (trA * 100).toFixed(1) + '% de NR/GB vs ' + (trB * 100).toFixed(1) + '% de Budget).';
    if (k === 'all') bt += ' Por negocio: ' + keys.map(function (x) { var t = view(x).T; return bizLbl(x) + ' ' + sgnMoney(t.cur.rev - t.bud.rev); }).join(', ') + '.';
    out.push({ k: 'bridge', lbl: 'Puente vs Budget', t: bt });

    // Dónde: los que empujan para el lado del desvío y el que más compensa
    var DR = drivers(V), sg = dev < 0 ? -1 : 1;
    var mainD = DR.list.filter(function (g) { return g.d * sg > 0; }).slice(0, 3), comp = DR.list.filter(function (g) { return g.d * sg < 0; }).slice(0, 1);
    var lst = function (a) { return joinY(a.map(function (g) { return b(gName(g, slack)) + ' (' + (g.t === 'p' && g.units.length > 1 ? tagOf(g).replace('Partner · ', '') + ', ' : '') + sgnMoney(g.d) + ')'; })); };
    var wt = mainD.length ? (dev < 0 ? 'Lo explican ' : 'Lo empujan ') + lst(mainD) + (comp.length ? '; compensa ' + lst(comp) : '') + '.' : 'Ningún partner ni país explica por sí solo el desvío: está repartido.';
    out.push({ k: 'where', lbl: 'Dónde', t: wt });

    if (M) {
      // Ritmo del mes: NR por día × días del mes, contra el Budget del mes completo
      var dd = D.month.days, dm = D.month.daysInMonth;
      if (dd < dm) {
        var proj = T.cur.rev / dd * dm;
        out.push({ k: 'trend', lbl: 'Ritmo del mes', t: 'Van ' + dd + ' de ' + dm + ' días. Al ritmo actual el mes cerraría en ' + b(money(proj)) + ' de NR, ' +
          b(fp(pct(proj, V.budMonth.rev))) + ' vs el Budget del mes (' + money(V.budMonth.rev) + '). Es una proyección lineal: no tiene en cuenta la estacionalidad dentro del mes.' });
      } else {
        out.push({ k: 'trend', lbl: 'Mes cerrado', t: MESL[+D.month.ym.substring(5, 7) - 1].replace(/^./, function (c) { return c.toUpperCase(); }) + ' cerró ' + b(fp(pN)) + ' vs Budget y ' + b(fp(yN)) + ' vs LY.' });
      }
    } else {
      // Tendencia: semanas seguidas del mismo lado del Budget y YoY de la semana vs el de las 4 anteriores
      var tr = V.series, side = function (w) { return w.cur.rev >= w.bud.rev ? 1 : -1; }, last = side(tr[tr.length - 1]), n = 0, m = 0, i;
      for (i = tr.length - 1; i >= 0 && side(tr[i]) === last; i--) n++;
      for (; i >= 0 && side(tr[i]) === -last; i--) m++;
      var where = last < 0 ? 'debajo' : 'arriba', y4 = pct(T.l4wL.rev, T.l4wLy.rev);
      var tt = n >= 2 ? b(ord(n) + ' semana seguida ' + where) + ' del Budget' + (n >= tr.length ? ' (todas las de la serie)' : '') + '.'
        : (m ? b('Cambio de tendencia') + ': primera semana ' + where + ' del Budget después de ' + m + (m === 1 ? ' semana' : ' semanas') + ' ' + (last < 0 ? 'arriba' : 'debajo') + '.' : 'Semana ' + where + ' del Budget.');
      if (yN != null && y4 != null) tt += ' El YoY de NR (' + fp(yN) + ') ' + (yN >= y4 ? 'acelera' : 'se frena') + ' contra el de las 4 semanas anteriores (' + fp(y4) + ').';
      out.push({ k: 'trend', lbl: 'Tendencia', t: tt });
    }

    var shC = share(T.cur), shB = share(T.bud), pF = pct(T.cur.fvm, T.bud.fvm), rN = pct(T.curN.rev, T.rr.rev), rF = pct(T.curN.fvm, T.rr.fvm);
    var mt = 'FVM de ' + b(money(T.cur.fvm)) + ', ' + fp(pF) + ' vs Budget' + dot(pF, slack) + ': ' + (shC == null ? '—' : shC.toFixed(1) + '% del GB') + ', ' +
      fpp(shC != null && shB != null ? shC - shB : null) + ' vs Budget.';
    if (T.rr.rev) mt += ' Contra Run Rate: NR ' + fp(rN) + ', FVM ' + fp(rF) + '.';
    out.push({ k: 'margin', lbl: 'Rentabilidad', t: mt });

    // Para mirar: las líneas que restan (partner o país), con la causa y si se repite; el detalle está abajo
    var bad = DR.list.filter(function (g) { var p = pct(g.cur.rev, g.bud.rev); return g.d < 0 && (p == null || p <= -3); }).sort(function (a, c) { return a.d - c.d; }).slice(0, 3);
    var wl = bad.length ? joinY(bad.map(function (g) {
      var st = streakOf(g);
      return b(gName(g, slack)) + ' (' + fp(pct(g.cur.rev, g.bud.rev)) + ', ' + sgnMoney(g.d) + ', ' + causeOf(g).t.replace(/ \(.*\)$/, '') + (st >= 2 ? ' · ' + ord(st) + ' semana debajo' : '') + ')';
    })) + '.' : 'Ningún partner ni país con un desvío material contra Budget.';
    out.push({ k: 'watch', lbl: 'Para mirar', t: wl });
    return out;
  }
  function insightsHtml(k) {
    return '<div class="rs-ins">' + insights(k, false).map(function (x) {
      return '<div class="' + x.k + '"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        IC[x.k] + '</svg></span><p><span class="lb">' + x.lbl + '</span>' + x.t + '</p></div>';
    }).join('') + '</div>';
  }

  function weekRange() {
    var a = D.week.from.split('-'), c = D.week.to.split('-');
    return +a[2] + (a[1] === c[1] ? '' : ' ' + MES[+a[1] - 1]) + '–' + +c[2] + ' ' + MES[+c[1] - 1] + ' ' + c[0];
  }
  function isCurMonth() { return D.months && D.month.ym === D.months[0]; }
  function monthName() { var m = D.month.ym.split('-'); return MESL[+m[1] - 1].replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + m[0]; }
  function title() {
    if (mode === 'm') return monthName() + (D.month.days < D.month.daysInMonth ? ' · MTD al ' + ddmm(D.month.to) + ' (' + D.month.days + ' de ' + D.month.daysInMonth + ' días)' : ' · mes cerrado');
    return 'Semana ' + D.week.week + ' · ' + weekRange();
  }

  // Titular: la lectura del período en una frase
  function headline(T) {
    var p = pct(T.cur.rev, T.bud.rev), y = pct(T.curL.rev, T.ly.rev), pre = mode === 'm' ? 'En el mes, Net Revenues ' : 'Net Revenues ';
    if (p == null) return mode === 'm' ? monthName() + ', <em>de un vistazo</em>.' : 'La semana ' + D.week.week + ', <em>de un vistazo</em>.';
    if (p >= 0) return pre + '<em>' + fp(p, 0) + ' arriba</em> del Budget.';
    if (p >= -5) return pre + '<em>cerca del Budget</em>' + (y != null && y > 0 ? ' y creciendo vs LY.' : '.');
    return pre + '<em>' + fp(p, 0) + '</em> vs Budget' + (y != null && y > 0 ? ', pero ' + fp(y, 0) + ' vs LY.' : '.');
  }

  // ── Render ──────────────────────────────────────────────────────────────────────────────
  function render() {
    var A = view('all').T, live = mode === 'm' ? isCurMonth() : isLatest();
    var html = '<header class="rs-hero"><div class="rs-top rs-in">' +
      '<span class="rs-eyebrow"><span class="rs-live' + (live ? '' : ' off') + '" aria-hidden="true"></span>' + esc(title()) +
      (mode === 'w' ? (isLatest() ? ' · reales al ' + esc(ddmm(D.lastActualsDate)) : ' · semana cerrada') : '') + '</span>' +
      '<div class="rs-ctl"><div class="rs-mode" role="group" aria-label="Vista"><button type="button" data-v="w" aria-pressed="' + (mode === 'w') + '">Semanal</button>' +
      '<button type="button" data-v="m" aria-pressed="' + (mode === 'm') + '">MTD</button></div>' +
      '<button type="button" class="rs-btn" id="rs-deck" title="Arma un deck .pptx con el resumen y las tarjetas (se abre en Google Slides o PowerPoint)">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg><span>Exportar a Slides</span></button>' +
      '<button type="button" class="rs-btn" id="rs-link" title="Copia el link a esta vista para mandarlo por Slack">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1"/></svg><span>Copiar link resumen semanal</span></button></div></div>' +
      '<h1 class="rs-in" style="--d:60ms">' + headline(A) + '</h1>' +
      '<p class="rs-lead rs-in" style="--d:120ms">' + (mode === 'm' ? 'En lo que va del mes, el' : 'El') + ' ecosistema B2B facturó <b>' + money(A.cur.rev) + '</b> de Net Revenues sobre <b>' + money(A.cur.gb) + '</b> de Gross Bookings: ' +
      '<b>' + fp(pct(A.cur.rev, A.bud.rev)) + '</b> vs Budget y <b>' + fp(pct(A.curL.rev, A.ly.rev)) + '</b> vs el año pasado.</p></header>';
    var chips = mode === 'm'
      ? (D.months || []).map(function (ym, i) {
        var m = ym.split('-');
        return '<button type="button" data-m="' + ym + '" aria-pressed="' + (ym === D.month.ym) + '">' + MES[+m[1] - 1].replace(/^./, function (c) { return c.toUpperCase(); }) + (i === 0 ? '<small>MTD</small>' : '') + '</button>';
      }).join('')
      : (D.weeks || []).map(function (w, i) {
        var a = w.from.split('-');
        return '<button type="button" data-y="' + w.year + '" data-w="' + w.week + '" aria-pressed="' + (w.week === D.week.week && w.year === D.week.year) + '" title="Semana del ' + (+a[2]) + ' ' + MES[+a[1] - 1] + '">W' + w.week + (i === 0 ? '<small>actual</small>' : '') + '</button>';
      }).join('');
    html += '<div class="rs-bar rs-in" style="--d:180ms"><div class="rs-tabs" role="tablist" aria-label="Negocio"><span class="ind" aria-hidden="true"></span>' + BIZ.map(function (b) {
      return '<button type="button" role="tab" data-k="' + b.k + '" aria-selected="' + (b.k === sel) + '">' + esc(b.lbl) + '</button>';
    }).join('') + '</div><span class="sp"></span>' +
      '<div class="rs-weeks" role="group" aria-label="' + (mode === 'm' ? 'Mes' : 'Semana') + '">' + chips + '</div>' +
      '<button type="button" class="rs-btn" id="rs-copy" title="Copia el resumen para pegar en Slack"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="3"/><path d="M5 15V6a3 3 0 0 1 3-3h9"/></svg><span>Copiar para Slack</span></button></div>' +
      '<div id="rs-biz"></div>';
    html += '<p class="rs-note">' + (mode === 'm'
      ? 'MTD: del 1 al último día con reales del mes elegido (o el mes completo si ya cerró). LY = mismas fechas del año anterior. Budget y Run Rate de las mismas fechas. '
      : 'Semana ISO (lunes a domingo), la última completa con reales. LY = misma semana ISO del año pasado, L4W = promedio de las 4 semanas anteriores. ') +
      'Mismos datos que el Weekly del Daily Dashboard: fecha de gestión, B2B separado por canal (API / HTML = agencias afiliadas). ' +
      'Las aperturas por partner son de B2B2C (el Budget de B2B no trae agencia: B2B se abre por país). FVM con COI Brasil incluido. ' +
      (D.organic && D.organic.target ? 'Organic, como el switch ORGANIC en Budget del Daily: actuals a TC Budget; los vs LY con los actuals a TC del año anterior; contra el Run Rate, actuals nominales. '
        : 'USD nominales' + (D.organic && D.organic.error ? ' (no se pudo aplicar organic: ' + esc(D.organic.error) + ')' : '') + '. ') +
      'Semáforo: verde ≥ 0%, ámbar entre −5% y 0%, rojo debajo de −5%.</p>';
    root.innerHTML = html;
    Array.prototype.forEach.call(root.querySelectorAll('.rs-weeks button'), function (bt) {
      bt.onclick = function () {
        if (bt.getAttribute('aria-pressed') === 'true') return;
        if (mode === 'm') { var ym = bt.getAttribute('data-m'); load({ week: req.week, month: ym === D.months[0] ? null : ym }); return; }
        var y = +bt.getAttribute('data-y'), w = +bt.getAttribute('data-w');
        load({ week: D.weeks[0].week === w && D.weeks[0].year === y ? null : { year: y, week: w }, month: req.month });
      };
    });
    Array.prototype.forEach.call(root.querySelectorAll('.rs-mode button'), function (bt) {
      bt.onclick = function () { var v = bt.getAttribute('data-v'); if (v === mode) return; mode = v; root.classList.add('calm'); render(); syncUrl(); };
    });
    document.getElementById('rs-copy').onclick = copySlack;
    document.getElementById('rs-link').onclick = copyLink;
    document.getElementById('rs-deck').onclick = exportDeck;
    var on = root.querySelector('.rs-weeks button[aria-pressed="true"]');
    if (on) on.parentNode.scrollLeft = Math.max(0, on.offsetLeft - 40);
    Array.prototype.forEach.call(root.querySelectorAll('.rs-tabs button'), function (bt) {
      bt.onclick = function () { setSel(bt.getAttribute('data-k')); };
      bt.onkeydown = function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var i = BIZ.findIndex(function (b) { return b.k === sel; }) + (e.key === 'ArrowRight' ? 1 : -1);
        setSel(BIZ[(i + BIZ.length) % BIZ.length].k);
        root.querySelector('.rs-tabs button[data-k="' + sel + '"]').focus();
      };
    });
    if (!render.bound) { window.addEventListener('resize', syncTabs); render.bound = true; }
    syncTabs();
    renderBiz(true);
  }
  function isLatest() { return !D.latest || (D.latest.week === D.week.week && D.latest.year === D.week.year); }
  function setSel(k) { if (k === sel) return; sel = k; root.classList.add('calm'); syncTabs(); renderBiz(false); }
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
    var x = function (i) { return tr.length === 1 ? W / 2 : i * W / (tr.length - 1); }, y = function (v) { return H - (v - lo) / (hi - lo) * H; };
    var pc = tr.map(function (w, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val(w.cur, m)).toFixed(1); }).join(' ');
    var pb = tr.map(function (w, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val(w.bud, m)).toFixed(1); }).join(' ');
    var last = tr[tr.length - 1];
    return '<svg class="kpi-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--s-act);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--s-act);stop-opacity:0"/></linearGradient></defs>' +
      '<path d="' + pc + ' L' + x(tr.length - 1) + ' ' + H + ' L' + x(0) + ' ' + H + 'Z" fill="url(#' + id + ')"/>' +
      '<path d="' + pb + '" fill="none" stroke="var(--s-bud)" stroke-width="1.4" stroke-dasharray="3 3" opacity=".8" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + pc + '" fill="none" stroke="var(--s-act)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + x(tr.length - 1) + '" cy="' + y(val(last.cur, m)).toFixed(1) + '" r="3" fill="var(--s-act)"/></svg>';
  }

  function kpiCard(m, V, i) {
    var T = V.T, v = val(T.cur, m);
    return '<section class="rs-card c-kpi rs-in" style="--d:' + (80 + i * 60) + 'ms" aria-label="' + MET[m] + '">' +
      '<div class="kpi-top"><span class="k">' + MET[m] + '</span>' + chip(dlt(T.cur, T.bud, m), m) + '</div>' +
      '<div class="kpi-v" data-count="' + (v == null ? '' : v) + '" data-fmt="' + m + '">' + fmtM(m, v) + '</div>' +
      sparkSvg(V.series, m, 'sg-' + m) +
      '<div class="kpi-foot"><span>LY <b class="' + cls(dlt(T.curL, T.ly, m)) + '">' + fd(m, dlt(T.curL, T.ly, m)) + '</b></span>' +
      (mode === 'w' ? '<span>L4W <b class="' + cls(dlt(T.cur, T.l4w, m)) + '">' + fd(m, dlt(T.cur, T.l4w, m)) + '</b></span>' : '') +
      '<span>RR <b class="' + cls(dlt(T.curN, T.rr, m)) + '">' + fd(m, dlt(T.curN, T.rr, m)) + '</b></span></div></section>';
  }

  // Dial: FVM vs Budget (pedido 2026-11-06); vs LY con actuals a TC LY, vs Run Rate con nominales
  function dialCard(V) {
    var T = V.T, att = T.bud.fvm ? T.cur.fvm / T.bud.fvm * 100 : null, s = state(att == null ? null : att - 100) || 'g';
    var R = 52, C = 2 * Math.PI * R, fill = att == null ? 0 : Math.max(0, Math.min(att, 100)) / 100;
    var col = { g: 'var(--good)', a: 'var(--warn)', r: 'var(--crit)' }[s];
    var gap = T.cur.fvm - T.bud.fvm, row3;
    if (mode === 'm') {
      var dd = D.month.days, dm = D.month.daysInMonth, proj = dd ? T.cur.fvm / dd * dm : null;
      row3 = dd < dm ? '<div><span>Proyección vs Budget del mes</span>' + chip(pct(proj, V.budMonth.fvm), 'fvm') + '</div>' : '';
    } else row3 = '<div><span>vs promedio L4W</span>' + chip(pct(T.cur.fvm, T.l4w.fvm), 'fvm', true) + '</div>';
    return '<section class="rs-card c-dial rs-in" style="--d:60ms" aria-label="Cumplimiento de FVM vs Budget"><h2>FVM vs Budget</h2>' +
      '<div class="rs-ring" style="--ring:' + col + '"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="rs-ring-bg" cx="60" cy="60" r="' + R + '" fill="none" stroke-width="9"/>' +
      '<circle class="rs-ring-fg" cx="60" cy="60" r="' + R + '" fill="none" stroke-width="9" stroke-linecap="round" stroke="' + col + '" ' +
      'stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + C.toFixed(2) + '" data-off="' + (C * (1 - fill)).toFixed(2) + '"/></svg>' +
      '<div class="rs-ring-c"><div class="v"><span data-count="' + (att == null ? '' : att) + '" data-fmt="int">' + (att == null ? '—' : Math.round(att)) + '</span><small>%</small></div>' +
      '<div class="k">del Budget' + (mode === 'm' ? ' MTD' : '') + '</div></div></div>' +
      '<p class="rs-dial-cap"><b>' + money(T.cur.fvm) + '</b> de ' + money(T.bud.fvm) + ' · <span class="' + cls(gap) + '">' + sgnMoney(gap) + '</span></p>' +
      '<div class="rs-vs"><div><span>vs Last Year</span>' + chip(pct(T.curL.fvm, T.ly.fvm), 'fvm', true) + '</div>' + row3 +
      '<div><span>vs Run Rate</span>' + chip(pct(T.curN.fvm, T.rr.fvm), 'fvm') + '</div></div></section>';
  }

  function renderBiz(first) {
    var V = view(sel), host = document.getElementById('rs-biz'), M = mode === 'm';
    var h = '<div class="rs-bento"><section class="rs-card c-sum rs-in" style="--d:40ms" aria-labelledby="rs-sum-h">' +
      '<h2 id="rs-sum-h">' + (M ? 'El mes' : 'La semana') + ' en pocas líneas · ' + esc(bizLbl(sel)) + '</h2>' +
      insightsHtml(sel) + '</section>' + dialCard(V) + ['gb', 'rev', 'fvm', 'sh'].map(function (m, i) { return kpiCard(m, V, i); }).join('');
    h += '<section class="rs-card c-chart rs-in" style="--d:300ms" aria-labelledby="rs-ch-h"><div class="rs-chart-top"><div class="t"><h2 id="rs-ch-h">' +
      (M ? 'FVM acumulado del mes' : 'Últimas 13 semanas') + '</h2><div class="big" id="rs-ch-big"></div></div>' +
      '<div class="rs-legend"><span><i style="border-color:var(--s-act)"></i>Actual</span><span><i class="dash" style="border-color:var(--s-bud)"></i>Budget</span>' +
      '<span><i style="border-color:var(--s-ly)"></i>Last Year</span></div></div><div class="rs-plot" id="rs-plot"></div>' +
      '<details class="rs-det" open><summary>Ver como tabla</summary><div class="rs-tbl-wrap" id="rs-trend-tbl"></div></details></section>';
    h += bulCard(V);
    h += '</div>';
    host.innerHTML = h;
    if (!first) Array.prototype.forEach.call(host.querySelectorAll('.rs-in'), function (el) { el.style.setProperty('--d', '0ms'); });
    spotlight(host);
    countUp(host);
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(host.querySelectorAll('.rs-ring-fg'), function (c) { c.style.strokeDashoffset = c.getAttribute('data-off'); });
      requestAnimationFrame(function () { Array.prototype.forEach.call(host.querySelectorAll('.rs-bul .fill'), function (f) { f.style.width = f.getAttribute('data-w') + '%'; }); });
    });
    chart(V);
  }

  // ── Dónde se explica: NR por país (barra = real, marca = Budget; color = semáforo vs Budget). Abajo de Brasil,
  // Argentina, México y Chile, hasta 2 partners de B2B2C que explican el desvío del país (mismo signo y ≥25% del desvío
  // del país, solo si el país se desvía ≥5%, en rojo). Sin botones: la tabla completa por país queda abierta.
  var PARTNER_PAISES = ['Brasil', 'Argentina', 'Mexico', 'Chile'];
  function partnersOf(V, p, cd) {
    var P = {};
    V.units.forEach(function (u) { if (u.pk && u.pais === p) push(P[u.pk] = P[u.pk] || grp('p', u.part, 'p:' + u.pk), u); });
    return Object.keys(P).map(function (k) { return P[k]; })
      .filter(function (g) { return g.d * cd > 0 && Math.abs(g.d) >= Math.abs(cd) * 0.25; }).sort(byAbs).slice(0, 2);
  }
  // Países (los 8 con más NR) y, abajo de BR / AR / MX / CL en rojo, sus partners que explican el desvío
  function bulRows(V) {
    var rows = Object.keys(V.by.cur).concat(Object.keys(V.by.bud)).filter(function (p, i, a) { return a.indexOf(p) === i && p !== 'RG'; })
      .map(function (p) { return { p: p, n: cname(p), c: V.by.cur[p] || z(), b: V.by.bud[p] || z() }; });
    rows.sort(function (a, b) { return (b.c.rev || 0) - (a.c.rev || 0); });
    var more = rows.length > 8 ? rows.length - 8 : 0;
    rows = rows.slice(0, 8);
    rows.forEach(function (r) {
      var dp = pct(r.c.rev, r.b.rev);
      r.subs = PARTNER_PAISES.indexOf(r.p) >= 0 && dp != null && Math.abs(dp) >= 5 ? partnersOf(V, r.p, r.c.rev - r.b.rev) : [];
    });
    return { rows: rows, more: more };
  }
  function bulCard(V) {
    var m = 'rev', BR = bulRows(V), rows = BR.rows, more = BR.more;
    var mx = 0; rows.forEach(function (r) { mx = Math.max(mx, r.c.rev || 0, r.b.rev || 0); }); mx = mx * 1.04 || 1;
    function row(r, cl) {
      var c = r.c.rev, b = r.b.rev, d = pct(c, b), s = state(d) || 'g';
      return '<div class="row' + (cl ? ' ' + cl : '') + '"><span class="nm" title="' + esc(r.n) + '">' + esc(r.n) + '</span>' +
        (cl ? '<span class="rs-bul-sub" style="margin:0">' + money(b) + ' de Budget</span>' :
          '<span class="trk" role="img" aria-label="' + esc(r.n) + ': ' + money(c) + ' contra ' + money(b) + ' de Budget">' +
          '<span class="fill ' + s + '" data-w="' + (Math.max(0, c || 0) / mx * 100).toFixed(1) + '"></span><span class="tick" style="left:' + (Math.max(0, b || 0) / mx * 100).toFixed(1) + '%"></span></span>') +
        '<span class="val">' + money(c) + '</span>' + chip(d, m) + '</div>';
    }
    function sub(g) {
      var p = pct(g.cur.rev, g.bud.rev);
      return '<div class="row sub"><span class="nm" title="' + esc(g.n) + '">' + esc(g.n) + '</span><span class="why">' + esc(causeOf(g).t.replace(/ \(.*\)$/, '')) + '</span>' +
        '<span class="val ' + cls(g.d) + '">' + sgnMoney(g.d) + '</span>' + chip(p, m) + '</div>';
    }
    var body = rows.map(function (r) { return row(r) + r.subs.map(sub).join(''); }).join('') + row({ n: 'Total', c: V.T.cur, b: V.T.bud }, 'tot');
    var subTxt = 'Net Revenues ' + (mode === 'm' ? periodo() : 'de la semana ' + D.week.week) + ' · la marca es el Budget' +
      (V.units.some(function (u) { return u.part; }) ? ' · debajo, los partners que explican el desvío' : '') + (more ? ' · ' + more + ' más en la tabla' : '');
    return '<section class="rs-card c-bul rs-in" style="--d:360ms" aria-labelledby="rs-bul-h"><h2 id="rs-bul-h">Dónde se explica</h2>' +
      '<p class="rs-bul-sub">' + esc(subTxt) + '</p><div class="rs-bul">' + body + '</div>' +
      '<details class="rs-det" open><summary>Ver tabla completa por país</summary><div class="rs-tbl-wrap">' + countryTable(V) + '</div></details></section>';
  }

  function countryTable(V) {
    function cmpT(v) { return '<span class="' + cls(v) + '">' + fp(v) + '</span>'; }
    function cmpPP(v) { return '<span class="' + cls(v) + '">' + fpp(v) + '</span>'; }
    var ps = Object.keys(V.by.cur).concat(Object.keys(V.by.bud)).filter(function (p, i, a) { return a.indexOf(p) === i; });
    ps.sort(function (a, b) { return (V.by.cur[b] || z()).rev - (V.by.cur[a] || z()).rev; });
    function row(name, c, bd, ly, cl, cL) {
      var sc = share(c), sb = share(bd);
      cL = cL || c;
      return '<tr' + (cl ? ' class="' + cl + '"' : '') + '><td>' + name + '</td>' +
        '<td class="sep">' + money(c.gb) + '</td><td>' + cmpT(pct(c.gb, bd.gb)) + '</td><td>' + cmpT(pct(cL.gb, ly.gb)) + '</td>' +
        '<td class="sep">' + money(c.rev) + '</td><td>' + cmpT(pct(c.rev, bd.rev)) + '</td><td class="' + cls(c.rev - bd.rev) + '">' + sgnMoney(c.rev - bd.rev) + '</td><td>' + cmpT(pct(cL.rev, ly.rev)) + '</td>' +
        '<td class="sep">' + money(c.fvm) + '</td><td>' + cmpT(pct(c.fvm, bd.fvm)) + '</td><td>' + (sc == null ? '—' : sc.toFixed(1) + '%') + '</td><td>' + cmpPP(sc != null && sb != null ? sc - sb : null) + '</td></tr>';
    }
    var body = ps.map(function (p) { return row(esc(cname(p)), V.by.cur[p] || z(), V.by.bud[p] || z(), V.by.ly[p] || z(), '', V.by.curL[p] || z()); }).join('');
    return '<table class="rs-tbl"><thead><tr><th></th><th class="grp sep" colspan="3">Gross Bookings</th><th class="grp sep" colspan="4">Net Revenues</th><th class="grp sep" colspan="4">FVM</th></tr>' +
      '<tr><th>País</th><th class="sep">Actual</th><th>vs Bud</th><th>vs LY</th><th class="sep">Actual</th><th>vs Bud</th><th>Δ$ vs Bud</th><th>vs LY</th><th class="sep">Actual</th><th>vs Bud</th><th>%GB</th><th>vs Bud</th></tr></thead>' +
      '<tbody>' + body + row('Total', V.T.cur, V.T.bud, V.T.ly, 'tot', V.T.curL) + '</tbody></table>';
  }

  // ── Gráfico de FVM: 13 semanas (o el mes acumulado por día), Actual (área) / Budget (punteado) / LY ─────────
  function chart(V) {
    var host = document.getElementById('rs-plot'), m = 'fvm', tr = V.series, M = mode === 'm';
    var W = 720, H = 300, L = 52, R = 62, Tp = 14, B = 30, iw = W - L - R, ih = H - Tp - B;
    var S = [{ k: 'ly', c: 'var(--s-ly)', n: 'Last Year', w: 1.6 }, { k: 'bud', c: 'var(--s-bud)', n: 'Budget', dash: '6 5', w: 1.8 }, { k: 'cur', c: 'var(--s-act)', n: 'Actual', w: 2.6 }];
    var vals = []; tr.forEach(function (w) { S.forEach(function (s) { var v = val(w[s.k], m); if (v != null) vals.push(v); }); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals) || 1;
    lo = M ? Math.min(0, lo) : Math.max(lo < 0 ? lo : 0, lo - (hi - lo) * 0.6);   // semanas: sin forzar el 0, se ven las diferencias; el acumulado arranca en 0
    var step = niceStep((hi - lo) / 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    var x = function (i) { return L + (tr.length === 1 ? iw / 2 : i * iw / (tr.length - 1)); };
    var y = function (v) { return Tp + ih - ((v == null ? lo : v) - lo) / (hi - lo) * ih; };
    var g = '<defs><linearGradient id="rs-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--s-act);stop-opacity:.32"/><stop offset="1" style="stop-color:var(--s-act);stop-opacity:0"/></linearGradient></defs>';
    for (var v = lo; v <= hi + step / 2; v += step) g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ax" x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fmtM(m, v) + '</text>';
    var every = Math.max(1, Math.ceil(tr.length / 8));
    tr.forEach(function (w, i) { if ((tr.length - 1 - i) % every === 0) g += '<text class="ax" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + w.lbl + '</text>'; });
    var pathOf = function (k) { return tr.map(function (w, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val(w[k], m)).toFixed(1); }).join(' '); };
    g += '<path d="' + pathOf('cur') + ' L' + x(tr.length - 1) + ' ' + (Tp + ih) + ' L' + x(0) + ' ' + (Tp + ih) + 'Z" fill="url(#rs-area)"/>';
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
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="FVM ' + (M ? 'acumulado del mes por día' : 'semanal de las últimas 13 semanas') + ': Actual, Budget y Last Year">' + g + '</svg><div class="rs-tip" id="rs-tip"></div>';
    var last = tr[tr.length - 1];
    document.getElementById('rs-ch-big').innerHTML = 'FVM' + (M ? (isCurMonth() ? ' MTD' : ' del mes') : '') + ' · <span class="' + cls(dlt(last.cur, last.bud, m)) + '">' + fd(m, dlt(last.cur, last.bud, m)) + '</span> <span style="font-size:14px;font-weight:500;color:var(--text-3)">vs Budget' + (M ? ' al ' + last.lbl + ' ' + MES[+D.month.ym.substring(5, 7) - 1] : ' en ' + last.lbl) + '</span>';
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      Array.prototype.forEach.call(host.querySelectorAll('.rs-line'), function (p) { p.style.strokeDashoffset = '0'; });
    }); });
    var svg = host.querySelector('svg'), tip = document.getElementById('rs-tip'), cross = document.getElementById('rs-cross'), cdot = document.getElementById('rs-cdot');
    function move(ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
      var i = Math.max(0, Math.min(tr.length - 1, Math.round((px - L) / iw * (tr.length - 1)))), w = tr[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      cdot.setAttribute('cx', x(i)); cdot.setAttribute('cy', y(val(w.cur, m))); cdot.setAttribute('visibility', 'visible');
      tip.innerHTML = '<b>' + esc(w.tip) + '</b>' + S.slice().reverse().map(function (s) {
        return '<div><span><i style="background:' + s.c + '"></i>' + s.n + '</span><span>' + fmtM(m, val(w[s.k], m)) + '</span></div>';
      }).join('') + '<div><span>vs Budget</span><span class="' + cls(dlt(w.cur, w.bud, m)) + '">' + fd(m, dlt(w.cur, w.bud, m)) + '</span></div>' +
        '<div><span>vs LY</span><span class="' + cls(dlt(w.curL, w.ly, m)) + '">' + fd(m, dlt(w.curL, w.ly, m)) + '</span></div>';
      tip.style.display = 'block';
      var left = x(i) / W * r.width + 14;
      if (left + tip.offsetWidth > r.width) left = x(i) / W * r.width - tip.offsetWidth - 14;
      tip.style.left = left + 'px'; tip.style.top = '8px';
    }
    var hit = document.getElementById('rs-hit');
    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', function () { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); cdot.setAttribute('visibility', 'hidden'); });
    document.getElementById('rs-trend-tbl').innerHTML = '<table class="rs-tbl"><thead><tr><th>' + (M ? 'Día (acum.)' : 'Semana') + '</th><th>FVM</th><th>Budget</th><th>vs Bud</th><th>LY</th><th>vs LY</th></tr></thead><tbody>' +
      tr.map(function (w) { return '<tr><td>' + esc(w.lbl) + '</td><td>' + fmtM(m, val(w.cur, m)) + '</td><td>' + fmtM(m, val(w.bud, m)) + '</td><td class="' + cls(dlt(w.cur, w.bud, m)) + '">' + fd(m, dlt(w.cur, w.bud, m)) +
        '</td><td>' + fmtM(m, val(w.ly, m)) + '</td><td class="' + cls(dlt(w.curL, w.ly, m)) + '">' + fd(m, dlt(w.curL, w.ly, m)) + '</td></tr>'; }).join('') + '</tbody></table>';
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

  // Slack: el consolidado completo y de cada negocio lo esencial (resultado, dónde y qué mirar), de la vista elegida
  function copySlack() {
    var t = '*Resumen ' + (mode === 'm' ? 'MTD' : 'semanal') + ' · ' + title() + '*\n\n' + BIZ.map(function (bz) {
      var L = insights(bz.k, true).filter(function (x) { return bz.k === 'all' || x.k === 'res' || x.k === 'where' || x.k === 'watch'; });
      return '*' + bz.lbl + '*\n' + L.map(function (x) { return '• _' + x.lbl + ':_ ' + x.t; }).join('\n');
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

  // Link a la vista que se está mirando (semana o mes, Semanal / MTD): con un click abre esto mismo
  function copyLink() {
    var url = location.origin + location.pathname + location.search;
    var lbl = this.querySelector('span'), orig = lbl.textContent;
    var ok = function () { lbl.textContent = 'Link copiado ✓'; setTimeout(function () { lbl.textContent = orig; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, function () { fallback(url); ok(); });
    else { fallback(url); ok(); }
  }

  // ── Deck para el comité ejecutivo (.pptx, PptxGenJS en el navegador; se baja al primer uso) ─────────────────────
  // Portada con el titular y las tarjetas del consolidado, "en pocas líneas", FVM de la serie y una slide por negocio
  // (tarjetas, Dónde se explica con sus partners y lo esencial). Texto y tablas editables, gráfico nativo.
  var PPTX_URL = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js', pptxP = null;
  function loadPptx() {
    if (window.PptxGenJS) return Promise.resolve();
    return pptxP = pptxP || new Promise(function (ok, ko) {
      var sc = document.createElement('script'); sc.src = PPTX_URL; sc.onload = ok;
      sc.onerror = function () { pptxP = null; ko(new Error('No se pudo cargar el generador de slides (sin internet o bloqueado).')); };
      document.head.appendChild(sc);
    });
  }
  var HX = { ink: '1B1B24', ink2: '55576A', ink3: '8A8C9E', line: 'E3E3EA', tile: 'F5F5F8', pri: '550FED', g: '13803F', a: 'A86400', r: 'C5221F', act: '2A78D6', bud: '1BAF7A', ly: 'EB6834' };
  function hxState(v) { var s = state(v); return s ? HX[s] : HX.ink2; }
  // <b>…</b> → runs en negrita; el resto de las etiquetas se saca
  function runs(html, o) {
    return String(html).split(/(<b>[\s\S]*?<\/b>)/).filter(Boolean).map(function (t) {
      var b = /^<b>/.test(t), tx = t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      return { text: tx, options: Object.assign({}, o || {}, b ? { bold: true, color: HX.ink } : {}) };
    });
  }
  function plain(html) { return runs(html).map(function (r) { return r.text; }).join(''); }
  function exportDeck() {
    var bt = this, lbl = bt.querySelector('span'), orig = lbl.textContent;
    lbl.textContent = 'Armando el deck…'; bt.disabled = true;
    loadPptx().then(function () {
      buildDeck();
      lbl.textContent = 'Deck descargado ✓';
    }).catch(function (e) { alert('No se pudo armar el deck: ' + e.message); lbl.textContent = orig; })
      .then(function () { setTimeout(function () { lbl.textContent = orig; bt.disabled = false; }, 2000); });
  }
  function buildDeck() {
    var keep = sel, P = new window.PptxGenJS(), F = 'Calibri';
    P.layout = 'LAYOUT_WIDE'; P.title = 'Resumen ' + (mode === 'm' ? 'MTD' : 'semanal') + ' · ' + title();
    var per = mode === 'm' ? title() : title();
    function head(sl, kicker, ttl) {
      sl.background = { color: 'FFFFFF' };
      sl.addShape(P.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: HX.pri }, line: { color: HX.pri } });
      sl.addText(kicker.toUpperCase(), { x: 0.5, y: 0.3, w: 9, h: 0.3, fontFace: F, fontSize: 11, color: HX.ink3, bold: true, charSpacing: 1 });
      sl.addText(runs(ttl), { x: 0.5, y: 0.58, w: 12.3, h: 0.7, fontFace: F, fontSize: 26, color: HX.ink, bold: true });
      sl.addText('Ecosistema B2B · ' + per + ' · Organic (TC Budget) · fuente: Daily Dashboard', { x: 0.5, y: 7.05, w: 12.3, h: 0.3, fontFace: F, fontSize: 9, color: HX.ink3 });
    }
    function card(sl, x, y, w, h, lbl, v, items) {
      sl.addShape(P.ShapeType.roundRect, { x: x, y: y, w: w, h: h, fill: { color: HX.tile }, line: { color: HX.line, width: 0.75 }, rectRadius: 0.12 });
      sl.addText(lbl, { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: 0.3, fontFace: F, fontSize: 11, color: HX.ink2 });
      sl.addText(v, { x: x + 0.2, y: y + 0.42, w: w - 0.4, h: 0.6, fontFace: F, fontSize: 26, bold: true, color: HX.ink });
      sl.addText(items.map(function (it, i) {
        return { text: it[0] + ' ' + it[1] + (i < items.length - 1 ? '   ' : ''), options: { color: it[2] || HX.ink2, bold: !!it[2] } };
      }), { x: x + 0.2, y: y + h - 0.42, w: w - 0.4, h: 0.3, fontFace: F, fontSize: 10.5 });
    }
    function kpis(sl, V, y) {
      var T = V.T, W = 2.95, G = 0.17;
      ['gb', 'rev', 'fvm', 'sh'].forEach(function (m, i) {
        var dB = dlt(T.cur, T.bud, m), dL = dlt(T.curL, T.ly, m);
        card(sl, 0.5 + i * (W + G), y, W, 1.45, MET[m], fmtM(m, val(T.cur, m)),
          [['vs Bud', fd(m, dB), hxState(m === 'sh' ? dB * 5 : dB)], ['vs LY', fd(m, dL)], ['vs RR', fd(m, dlt(T.curN, T.rr, m))]]);
      });
    }
    // 1. Portada
    sel = 'all';
    var VA = view('all'), s1 = P.addSlide();
    head(s1, 'Comité ejecutivo · resumen ' + (mode === 'm' ? 'MTD' : 'semanal'), headline(VA.T).replace(/<\/?em>/g, ''));
    s1.addText(runs(document.querySelector('.rs-lead') ? document.querySelector('.rs-lead').innerHTML : ''), { x: 0.5, y: 1.35, w: 12.3, h: 0.6, fontFace: F, fontSize: 15, color: HX.ink2 });
    kpis(s1, VA, 2.15);
    var dB = pct(VA.T.cur.fvm, VA.T.bud.fvm);
    s1.addText([{ text: 'Por negocio (NR vs Budget · FVM vs Budget)', options: { bold: true, color: HX.ink, breakLine: true } }].concat(['b2b2c', 'api', 'html'].map(function (k, i) {
      var t = view(k).T, pN = pct(t.cur.rev, t.bud.rev), pF = pct(t.cur.fvm, t.bud.fvm);
      return { text: bizLbl(k) + ':  NR ' + money(t.cur.rev) + ' (' + fp(pN) + ')  ·  FVM ' + money(t.cur.fvm) + ' (' + fp(pF) + ')', options: { color: hxState(pN), breakLine: i < 2 } };
    })), { x: 0.5, y: 3.9, w: 7.6, h: 1.4, fontFace: F, fontSize: 14, valign: 'top', paraSpaceAfter: 6 });
    card(s1, 8.45, 3.9, 4.38, 1.45, 'FVM vs Budget', Math.round(VA.T.bud.fvm ? VA.T.cur.fvm / VA.T.bud.fvm * 100 : 0) + '% del Budget',
      [['Real', money(VA.T.cur.fvm)], ['Budget', money(VA.T.bud.fvm)], ['Δ', sgnMoney(VA.T.cur.fvm - VA.T.bud.fvm), hxState(dB)]]);
    // 2. En pocas líneas (consolidado)
    var s2 = P.addSlide();
    head(s2, (mode === 'm' ? 'El mes' : 'La semana') + ' en pocas líneas · Consolidado', 'Qué pasó y de dónde viene el delta');
    insights('all', false).forEach(function (x, i) {
      var col = i % 2, rowi = Math.floor(i / 2), X = 0.5 + col * 6.25, Y = 1.45 + rowi * 1.8;
      s2.addShape(P.ShapeType.roundRect, { x: X, y: Y, w: 6.05, h: 1.65, fill: { color: x.k === 'watch' ? 'FFF6E5' : HX.tile }, line: { color: HX.line, width: 0.75 }, rectRadius: 0.1 });
      s2.addText([{ text: x.lbl.toUpperCase(), options: { bold: true, color: x.k === 'watch' ? HX.a : HX.ink3, fontSize: 10, breakLine: true } }].concat(runs(x.t, { color: HX.ink2, fontSize: 12.5 })),
        { x: X + 0.18, y: Y + 0.1, w: 5.7, h: 1.45, fontFace: F, valign: 'top' });
    });
    // 3. FVM: serie y por negocio
    var s3 = P.addSlide(), sr = VA.series;
    head(s3, mode === 'm' ? 'FVM acumulado del mes' : 'FVM · últimas 13 semanas', 'FVM ' + fp(pct(sr[sr.length - 1].cur.fvm, sr[sr.length - 1].bud.fvm)) + ' vs Budget' + (mode === 'm' ? ' en el mes' : ' en ' + sr[sr.length - 1].lbl));
    s3.addChart(P.ChartType.line, [
      { name: 'Actual', labels: sr.map(function (w) { return w.lbl; }), values: sr.map(function (w) { return Math.round(w.cur.fvm); }) },
      { name: 'Budget', labels: sr.map(function (w) { return w.lbl; }), values: sr.map(function (w) { return Math.round(w.bud.fvm); }) },
      { name: 'Last Year', labels: sr.map(function (w) { return w.lbl; }), values: sr.map(function (w) { return Math.round(w.ly.fvm); }) },
    ], { x: 0.4, y: 1.4, w: 7.9, h: 5.4, chartColors: [HX.act, HX.bud, HX.ly], lineSize: 2, lineDataSymbol: 'none', lineDash: ['solid', 'dash', 'solid'],
      showLegend: true, legendPos: 'b', legendFontSize: 11, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, valAxisLabelFormatCode: '$#,##0,"K"',
      valGridLine: { color: 'EEEEF3', size: 0.5 }, catGridLine: { style: 'none' } });
    var trow = [['Negocio', 'FVM', 'vs Bud', 'vs LY', 'FVM %GB'].map(function (h) { return { text: h, options: { bold: true, color: HX.ink3, fontSize: 11 } }; })];
    ['b2b2c', 'api', 'html', 'all'].forEach(function (k) {
      var t = view(k).T, pB = pct(t.cur.fvm, t.bud.fvm), sh = share(t.cur);
      trow.push([{ text: k === 'all' ? 'Total' : bizLbl(k), options: { bold: k === 'all' } }, { text: money(t.cur.fvm), options: { bold: k === 'all' } },
        { text: fp(pB), options: { color: hxState(pB), bold: true } }, { text: fp(pct(t.curL.fvm, t.ly.fvm)) }, { text: sh == null ? '—' : sh.toFixed(1) + '%' }]);
    });
    s3.addTable(trow, { x: 8.6, y: 1.6, w: 4.25, colW: [1.25, 0.8, 0.75, 0.75, 0.7], fontFace: F, fontSize: 12, color: HX.ink, border: { type: 'solid', color: HX.line, pt: 0.5 }, rowH: 0.42, align: 'right', valign: 'middle' });
    // 4-6. Un negocio por slide
    ['b2b2c', 'api', 'html'].forEach(function (k) {
      sel = k;
      var V = view(k), T = V.T, sl = P.addSlide(), pN = pct(T.cur.rev, T.bud.rev);
      head(sl, bizLbl(k) + ' · ' + per, bizLbl(k) + ': NR <b>' + fp(pN) + '</b> vs Budget (' + sgnMoney(T.cur.rev - T.bud.rev) + '), FVM <b>' + fp(pct(T.cur.fvm, T.bud.fvm)) + '</b>');
      kpis(sl, V, 1.4);
      var BR = bulRows(V), rowsT = [['Dónde se explica (NR)', 'Real', 'Budget', 'Δ vs Bud', '%'].map(function (h, i) { return { text: h, options: { bold: true, color: HX.ink3, fontSize: 10.5, align: i ? 'right' : 'left' } }; })];
      BR.rows.forEach(function (r) {
        var d = pct(r.c.rev, r.b.rev);
        rowsT.push([{ text: r.n, options: { bold: true, align: 'left' } }, { text: money(r.c.rev) }, { text: money(r.b.rev), options: { color: HX.ink3 } },
          { text: sgnMoney(r.c.rev - r.b.rev), options: { color: hxState(d) } }, { text: fp(d), options: { color: hxState(d), bold: true } }]);
        r.subs.forEach(function (g) {
          var pg = pct(g.cur.rev, g.bud.rev);
          rowsT.push([{ text: '   ↳ ' + g.n + ' · ' + causeOf(g).t.replace(/ \(.*\)$/, ''), options: { color: HX.ink2, fontSize: 10, align: 'left' } }, { text: money(g.cur.rev), options: { fontSize: 10, color: HX.ink2 } },
            { text: money(g.bud.rev), options: { fontSize: 10, color: HX.ink3 } }, { text: sgnMoney(g.d), options: { fontSize: 10, color: hxState(pg) } }, { text: fp(pg), options: { fontSize: 10, color: hxState(pg) } }]);
        });
      });
      rowsT.push([{ text: 'Total', options: { bold: true, align: 'left' } }, { text: money(T.cur.rev), options: { bold: true } }, { text: money(T.bud.rev), options: { color: HX.ink3 } },
        { text: sgnMoney(T.cur.rev - T.bud.rev), options: { bold: true, color: hxState(pN) } }, { text: fp(pN), options: { bold: true, color: hxState(pN) } }]);
      sl.addTable(rowsT, { x: 0.5, y: 3.05, w: 6.9, colW: [3.0, 0.95, 0.95, 1.0, 1.0], fontFace: F, fontSize: 11, color: HX.ink, align: 'right', valign: 'middle',
        border: { type: 'solid', color: HX.line, pt: 0.5 }, rowH: 0.27, autoPage: false });
      var ins = insights(k, false).filter(function (x) { return x.k === 'bridge' || x.k === 'where' || x.k === 'trend' || x.k === 'watch'; });
      sl.addText([].concat.apply([], ins.map(function (x, i) {
        return [{ text: x.lbl.toUpperCase(), options: { bold: true, color: x.k === 'watch' ? HX.a : HX.ink3, fontSize: 10, breakLine: true } }]
          .concat(runs(x.t, { color: HX.ink2, fontSize: 12 })).concat(i < ins.length - 1 ? [{ text: ' ', options: { breakLine: true, fontSize: 6 } }] : []);
      })), { x: 7.7, y: 3.05, w: 5.15, h: 3.85, fontFace: F, valign: 'top', paraSpaceAfter: 4 });
    });
    sel = keep;
    var fn = 'Resumen ' + (mode === 'm' ? 'MTD ' + D.month.ym : 'semanal W' + D.week.week + ' ' + D.week.year) + ' - Ecosistema B2B.pptx';
    return P.writeFile({ fileName: fn });
  }

  // ── Datos ───────────────────────────────────────────────────────────────────────────────
  // ?semana=2026-W43, ?mes=2026-10 y ?vista=mtd abren eso (el link se puede compartir)
  function syncUrl() {
    var q = [];
    if (req.week) q.push('semana=' + req.week.year + '-W' + req.week.week);
    if (req.month) q.push('mes=' + req.month);
    if (mode === 'm') q.push('vista=mtd');
    try { history.replaceState(null, '', q.length ? '?' + q.join('&') : location.pathname); } catch (e) { /* nada */ }
  }
  function load(r) {
    var first = !D;
    if (first) root.innerHTML = '<div class="rs-skel" style="height:120px;margin-bottom:20px"></div><div class="rs-skel"></div><p class="rs-state">Cargando…</p>';
    else root.classList.add('busy');
    var args = {};
    if (r.week) { args.year = r.week.year; args.week = r.week.week; }
    if (r.month) args.month = r.month;
    fetch(CFG.api, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'google.script.run' }, body: JSON.stringify({ args: [args] }) })
      .then(function (x) { return x.json().then(function (j) { if (!x.ok) throw new Error(j.error || ('HTTP ' + x.status)); return j.result; }); })
      .then(function (res) {
        if (!res || !res.success) throw new Error((res && res.error) || 'Sin datos');
        if (!first) root.classList.add('calm');
        D = res; req = r; root.classList.remove('busy'); render(); syncUrl();
      })
      .catch(function (e) {
        root.classList.remove('busy');
        if (first) root.innerHTML = '<p class="rs-state">No se pudo cargar el resumen: ' + esc(e.message) + '</p>';
        else alert('No se pudo cargar: ' + e.message);
      });
  }
  var qs = location.search, qw = /[?&]semana=(\d{4})-W(\d{1,2})/.exec(qs), qm = /[?&]mes=(\d{4}-\d{2})/.exec(qs);
  if (/[?&]vista=mtd/.test(qs)) mode = 'm';
  load({ week: qw ? { year: +qw[1], week: +qw[2] } : null, month: qm ? qm[1] : null });
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
