// "B2B2C Tracker" (2026-11-10, Diego): página de las WLs con el funnel de tráfico y los resultados gestionales, semanal y mensual,
// vs año pasado, vs tendencia y vs el período anterior, más el acumulado del año fiscal. Los números los arma server/b2b2c-tracker.js
// (GET <base>/b2b2c-tracker/data); acá solo se dibuja. Estado en la URL (?gran=&region=&pais=&partner=&prod=&plat=&k=&met=&dim=&cmp=&pm=)
// para poder compartir una vista.
// Sección Partners (2026-11-10, a partir del tablero de tráfico del equipo de Brasil): ranking con share de búsquedas y conversión,
// eficiencia (búsquedas vs conversión), evolutivo apilado por partner y conversión por partner. Colores: paleta categórica validada
// (skill dataviz, 7 slots + "Resto" en gris), asignada por el orden de búsquedas de la ventana, así que cambiar de período no repinta.
// Lectura y puente (2026-11-10): arriba, tres líneas con la conclusión (qué pasó y qué lo explica, dónde se movió el funnel, qué
// partners suman y restan) y un puente que descompone la variación de NR / FVM / GB / orders en drivers multiplicativos
// (búsquedas × conversión × bookings→orders × ticket × take rate × margen) con LMDI: reparte la variación exacta, sin residuo.
// Sin tráfico comparable (período en curso, tráfico incompleto, partners por API) el puente arranca en orders.
// Vistas (2026-11-10, Diego): "Portada" (consolidado para el Chief: Lectura y KPIs del total, puente por país y una fila por país con
// qué lo explica, el mix y el partner que más lo mueve), un one pager por país (Lectura, KPIs, puente, embudo, top partners y mix en
// una pantalla, imprimible en A4 apaisado) y "Detalle" (la página completa con todos los filtros). ?view=portada|pais|detalle|moonshot.
// Moonshot (2026-11-10): ¿con qué partner pensamos en triplicar? Matriz NR actual vs multiplicador potencial y ranking de candidatos con
// las tres palancas (alcance con la base de clientes del Excel del equipo, PROVISORIO; conversión; amplitud). Ver moonshot() del modelo.
// Mix de productos (2026-11-10, Diego: "¿mantenemos CvR pero con productos de menor ASP?"): ticket = Σ share de orders × ticket del
// producto y conversión = Σ share de búsquedas × conversión del producto; cada variación se separa en mix y "dentro de cada producto"
// (descomposición simétrica: suman exacto). En el puente, ticket y conversión se abren en esas dos partes.
const { shell, escapeHtml, CHEVRON_L } = require('./index-page');

const CSS = `<style>
  .wrap { max-width: 1280px; }
  :root { --up: #1db37a; --dn: #f0616d; --ly: #8a8aa3; --tr: #f5a524; --flag: rgba(240, 97, 109, .14);
    --c1: #3987e5; --c2: #d95926; --c3: #199e70; --c4: #c98500; --c5: #d55181; --c6: #008300; --c7: #9085e9; --c0: #6b6b80; }
  :root[data-theme="light"] { --up: #0f8a5f; --dn: #d93a46; --ly: #8e8e93; --tr: #d98a00; --flag: rgba(217, 58, 70, .1);
    --c1: #2a78d6; --c2: #eb6834; --c3: #1baf7a; --c4: #eda100; --c5: #e87ba4; --c6: #008300; --c7: #6250d6; --c0: #b4b4bd; }
  .tk-hero h1 { font-size: clamp(30px, 4.6vw, 44px); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
  .tk-hero p { margin-top: 8px; color: var(--text-2); font-size: 15px; }
  .tk-bar { position: sticky; top: 0; z-index: 4; display: flex; flex-wrap: wrap; gap: 10px; align-items: end; padding: 14px 0; margin: 18px 0 8px;
    background: var(--bg); border-bottom: 1px solid var(--line); }
  .tk-seg { display: inline-flex; background: var(--tile); border-radius: 10px; padding: 3px; box-shadow: inset 0 0 0 1px var(--line); }
  .tk-seg button { border: 0; background: transparent; color: var(--text-2); font: inherit; font-size: 13.5px; font-weight: 500; padding: 6px 14px; border-radius: 8px; cursor: pointer; }
  .tk-seg button.on { background: var(--primary); color: #fff; }
  .tk-f { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .tk-f label { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: .06em; }
  .tk-f select { font: inherit; font-size: 13.5px; color: var(--text); background: var(--tile); border: 1px solid var(--line); border-radius: 9px; padding: 6px 8px; max-width: 220px; }
  .tk-clear { border: 0; background: none; color: var(--link); font: inherit; font-size: 13px; cursor: pointer; padding: 6px 4px; }
  .tk-sec { margin-top: 30px; }
  .tk-sec > h2 { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 4px; }
  .tk-sec > .sub { font-size: 13.5px; color: var(--text-2); margin-bottom: 14px; }
  .tk-card { background: var(--tile); border-radius: 18px; padding: 16px 18px; box-shadow: inset 0 0 0 1px var(--line); min-width: 0; }
  .tk-card h3 { font-size: 14.5px; font-weight: 600; margin-bottom: 2px; }
  .tk-card .sub { font-size: 12.5px; color: var(--text-2); margin-bottom: 10px; }
  .tk-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(175px, 1fr)); gap: 12px; }
  .tk-kpi .l { font-size: 12.5px; color: var(--text-2); }
  .tk-kpi .v { font-size: clamp(20px, 2.4vw, 26px); font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; margin: 2px 0 6px; white-space: nowrap; }
  .tk-d { display: grid; gap: 1px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .tk-d span { white-space: nowrap; }
  .tk-d i { font-style: normal; color: var(--text-3); display: inline-block; min-width: 72px; }
  .up { color: var(--up); } .dn { color: var(--dn); } .na { color: var(--text-3); }
  .tk-emb svg { display: block; width: 100%; height: auto; }
  .tk-emb .st { cursor: default; }
  .tk-emb .sl { fill: #fff; font-size: 14px; font-weight: 600; text-anchor: middle; }
  .tk-emb .sv { fill: #fff; font-size: 13px; text-anchor: middle; opacity: .92; }
  .tk-emb .hd { fill: var(--text-3); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; text-anchor: end; }
  .tk-emb .cv { fill: var(--text); font-size: 15px; font-weight: 600; text-anchor: end; }
  .tk-emb .dv { font-size: 13px; text-anchor: end; }
  .tk-emb .dv.up { fill: var(--up); } .tk-emb .dv.dn { fill: var(--dn); } .tk-emb .dv.na { fill: var(--text-3); }
  .tk-emb .gl { stroke: var(--line); }
  .tk-cr { margin-top: 10px; font-size: 14px; color: var(--text-2); }
  .tk-cr b { color: var(--text); font-weight: 600; }
  .tk-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; align-items: center; }
  .tk-chips button { border: 1px solid var(--line); background: transparent; color: var(--text-2); font: inherit; font-size: 12.5px; padding: 4px 11px; border-radius: 999px; cursor: pointer; }
  .tk-chips button.on { background: var(--primary); border-color: var(--primary); color: #fff; }
  .tk-chips .sep { width: 1px; align-self: stretch; background: var(--line); margin: 2px 4px; }
  .tk-chips .lb { font-size: 12px; color: var(--text-3); margin-right: 2px; }
  .tk-lg { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; color: var(--text-2); margin-bottom: 6px; align-items: center; }
  .tk-lg i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  .tk-lg .win { margin-left: auto; }
  .tk-lg .win select { font: inherit; font-size: 12.5px; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 7px; padding: 2px 6px; }
  .tk-chart svg { display: block; width: 100%; height: auto; overflow: visible; }
  .tk-chart .bar { fill: var(--primary); cursor: pointer; }
  .tk-chart .bar.sel { fill: var(--secondary); }
  .tk-chart .bar.part { fill-opacity: .45; }
  .tk-chart .bar.flag { fill: url(#tk-hatch); }
  .tk-chart .seg { stroke: var(--tile); stroke-width: 2; }
  .tk-chart .ax { fill: var(--text-3); font-size: 10.5px; }
  .tk-chart .axt { fill: var(--text-3); font-size: 11px; }
  .tk-chart .gl { stroke: var(--line); }
  .tk-chart .ly { fill: none; stroke: var(--ly); stroke-width: 2; stroke-dasharray: 4 3; }
  .tk-chart .tr { fill: none; stroke: var(--tr); stroke-width: 2; }
  .tk-chart .ln { fill: none; stroke-width: 2; }
  .tk-chart .bub { fill: var(--primary); fill-opacity: .55; stroke: var(--tile); stroke-width: 2; }
  .tk-chart .bub:hover { fill-opacity: .85; }
  .tk-chart .bl { fill: var(--text-2); font-size: 11px; }
  .tk-chart .pct { font-size: 10px; text-anchor: middle; }
  .tk-chart .pct.up { fill: var(--up); } .tk-chart .pct.dn { fill: var(--dn); } .tk-chart .pct.na { fill: var(--text-3); }
  .tk-chart .rowl { fill: var(--text-3); font-size: 10px; }
  .tk-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
  .tk-tw { overflow-x: auto; }
  .tk-t { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  .tk-t th { text-align: right; padding: 8px 10px; font-size: 11px; font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
  .tk-t th.l, .tk-t td.l { text-align: left; }
  .tk-t td { padding: 8px 10px; border-top: 1px solid var(--line); text-align: right; white-space: nowrap; vertical-align: top; }
  .tk-t td .s { display: block; font-size: 11.5px; margin-top: 1px; }
  .tk-t td .s i { font-style: normal; color: var(--text-3); }
  .tk-t tr.click { cursor: pointer; }
  .tk-t tr.click:hover td { background: var(--tile-hover); }
  .tk-t td.k { font-weight: 500; }
  .tk-rk { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--bg); font-size: 11px; color: var(--text-2); }
  .tk-dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 7px; vertical-align: 0; }
  .tk-ef { display: inline-block; height: 6px; border-radius: 3px; background: var(--primary); vertical-align: middle; margin-right: 6px; }
  .tk-more { margin-top: 8px; border: 0; background: none; color: var(--link); font: inherit; font-size: 13px; cursor: pointer; }
  .tk-warn { margin-top: 10px; font-size: 12.5px; color: var(--dn); }
  .tk-notes { margin-top: 34px; font-size: 12.5px; color: var(--text-3); line-height: 1.6; }
  .tk-notes li { margin-left: 18px; }
  .tk-load { color: var(--text-3); font-size: 14px; padding: 30px 0; }
  .tk-err { color: var(--dn); font-size: 14px; padding: 20px 0; }
  .tk-vt { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 6px; }
  .tk-vt button { border: 1px solid var(--line); background: transparent; color: var(--text-2); font: inherit; font-size: 14px; font-weight: 500; padding: 6px 14px; border-radius: 999px; cursor: pointer; }
  .tk-vt button.on { background: var(--primary); border-color: var(--primary); color: #fff; }
  .tk-vt .sep { width: 1px; align-self: stretch; background: var(--line); margin: 2px 4px; }
  .op-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin: 18px 0 2px; }
  .op-head h2 { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
  .op-head .sub { color: var(--text-2); font-size: 14px; }
  .op-head .pr { margin-left: auto; border: 1px solid var(--line); background: transparent; color: var(--link); font: inherit; font-size: 13px; padding: 5px 12px; border-radius: 8px; cursor: pointer; }
  .op-row { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; margin-top: 14px; }
  .op-row.one { grid-template-columns: 1fr; }
  .op-row.even { grid-template-columns: 1fr 1fr; }
  .op-row > * { min-width: 0; }
  .op .tk-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .op .tk-d i { min-width: 0; margin-right: 6px; }
  .op .tk-kpi { padding: 12px 14px; }
  .op .tk-kpi .v { font-size: 22px; margin: 0 0 4px; }
  .op .tk-sum ol { font-size: 14.5px; gap: 6px; }
  .op .tk-wf .lv { font-size: 17px; } .op .tk-wf .lx { font-size: 16px; } .op .tk-wf .ls { font-size: 14px; }
  .op .tk-emb .sl { font-size: 17px; } .op .tk-emb .sv { font-size: 15px; } .op .tk-emb .hd { font-size: 13px; }
  .op .tk-emb .cv { font-size: 18px; } .op .tk-emb .dv { font-size: 16px; }
  .op .tk-t { font-size: 12.5px; } .op .tk-t td, .op .tk-t th { padding: 6px 8px; }
  .op .tk-cr { font-size: 13.5px; }
  .tk-cty td.k { font-weight: 600; }
  .tk-cty td.l { white-space: normal; min-width: 150px; }
  .tk-sum { border-left: 4px solid var(--primary); }
  .ms-f { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin: 6px 0 4px; }
  .ms-badge { display: inline-block; font-size: 10.5px; padding: 1px 6px; border-radius: 6px; margin-left: 4px; vertical-align: 1px; }
  .ms-badge.inf { background: var(--tile-hover); color: var(--text-3); }
  .ms-badge.bad { background: var(--flag); color: var(--dn); }
  .ms-m { font-weight: 600; }
  .ms-m.hi { color: var(--primary); }
  .ms-t td.l { white-space: normal; }
  .ms-t td:nth-child(2) { white-space: nowrap; }
  .ms-t td .s { white-space: nowrap; }
  .tk-chart .ms-c { fill: var(--primary); fill-opacity: .6; stroke: var(--tile); stroke-width: 2; }
  .tk-chart .ms-o { fill: var(--ly); fill-opacity: .35; stroke: var(--tile); stroke-width: 2; }
  .tk-chart .ms-v { fill: none; stroke: var(--dn); stroke-width: 1.5; stroke-dasharray: 3 2; }
  .tk-chart .ms-3x { stroke: var(--tr); stroke-width: 1.5; stroke-dasharray: 5 4; }
  .tk-chart .ms-3t { fill: var(--tr); font-size: 11px; }
  .tk-sum ol { margin: 4px 0 0 20px; display: grid; gap: 8px; font-size: 15.5px; line-height: 1.5; }
  .tk-sum b { font-weight: 600; }
  .tk-sum .na { font-size: 14px; }
  .tk-wf .lv { fill: var(--text); font-size: 12.5px; font-weight: 600; text-anchor: middle; }
  .tk-wf .lx { fill: var(--text-2); font-size: 12px; text-anchor: middle; }
  .tk-wf .ls { fill: var(--text-3); font-size: 11px; text-anchor: middle; }
  .tk-wf .cn { stroke: var(--text-3); stroke-dasharray: 3 3; }
  .tk-drv { color: var(--text-2); }
  @media (max-width: 860px) { .tk-grid2 { grid-template-columns: 1fr; } }
  @media (max-width: 960px) { .op-row { grid-template-columns: 1fr; } }
  @media print {
    @page { size: A4 landscape; margin: 8mm; }
    :root, :root[data-theme] { --bg: #fff; --tile: #f6f6f8; --tile-hover: #f6f6f8; --line: rgba(0,0,0,.12); --text: #1d1d1f; --text-2: #55555c; --text-3: #7a7a82;
      --primary: #550fed; --secondary: #7b4fff; --link: #550fed; --up: #0f8a5f; --dn: #d93a46; --ly: #8e8e93; --tr: #d98a00; color-scheme: light; }
    body { background: #fff !important; }
    header.topbar, .tk-bar, .tk-hero, .tk-notes, .op-head .pr, .tk-chips, .tk-more { display: none !important; }
    main { padding: 0 !important; } .wrap { max-width: none !important; padding: 0 !important; }
    .tk-card { box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
    .op { zoom: .56; }   /* entra en una hoja A4 apaisada */
    .op .tk-chart svg, .op .tk-emb svg { max-height: 300px; width: auto; max-width: 100%; margin: 0 auto; }
    .tk-tw { overflow: visible !important; }
    .op-row { grid-template-columns: 1.4fr 1fr !important; gap: 8px; margin-top: 8px; }
    .op-row.one { grid-template-columns: 1fr !important; }
    .op-row.even { grid-template-columns: 1fr 1fr !important; }
  }
  @media (max-width: 720px) { .tk-f select { max-width: 150px; } }
</style>`;

const SCRIPT = String.raw`(function () {
  'use strict';
  var CFG = window.TK_CFG, root = document.getElementById('tk-root');
  var Q = new URLSearchParams(location.search);
  var FD = ['region', 'pais', 'partner', 'prod', 'plat'];
  var FL = { region: 'Región', pais: 'País', partner: 'Partner', prod: 'Producto', plat: 'Plataforma' };
  var S = { gran: Q.get('gran') === 'm' ? 'm' : 'w', f: {}, k: Q.get('k') || '', met: Q.get('met') || 'o', dim: Q.get('dim') || 'region',
    win: +(Q.get('win') || 0), cmp: Q.get('cmp') || 'tr', pm: Q.get('pm') || 's', bm: Q.get('bm') || 'nr', all: false };
  FD.forEach(function (d) { if (Q.get(d)) S.f[d] = Q.get(d); });
  var COUNTRIES = [['Brasil', 'Brasil'], ['Argentina', 'Argentina'], ['Mexico', 'México'], ['Chile', 'Chile'], ['Colombia', 'Colombia'], ['Peru', 'Perú']];
  function cLbl(v) { var x = COUNTRIES.filter(function (c) { return c[0] === v; })[0]; return x ? x[1] : v; }
  S.view = ['portada', 'pais', 'detalle', 'moonshot'].indexOf(Q.get('view')) >= 0 ? Q.get('view') : 'portada';
  var MOON = null, MS = { dir: Q.get('dir') || '', ind: Q.get('ind') || '', pais: Q.get('mpais') || '' };
  if (S.view === 'pais' && !S.f.pais) S.view = 'portada';
  if (S.view !== 'detalle') S.f = S.view === 'pais' ? { pais: S.f.pais } : {};
  var CT = null;   // portada: { rows: apertura por país, det: { país: { prod, part } } }
  var DATA = null, BD = null, PART = null, EVO = null, PROD = null, seq = 0;

  // ── Métricas: t = tráfico [usuarios, búsqueda, detalle, PI, checkout, bookings], r = resultados [orders, GB, NR, FVM] ──
  function rat(a, b) { return a != null && b ? a / b : null; }
  var M = {
    u:   { l: 'Usuarios', s: 't', f: function (t) { return t[0]; }, u: 'n' },
    s:   { l: 'Búsquedas', s: 't', f: function (t) { return t[1]; }, u: 'n' },
    d:   { l: 'Detalle', s: 't', f: function (t) { return t[2]; }, u: 'n' },
    pi:  { l: 'PI', s: 't', f: function (t) { return t[3]; }, u: 'n' },
    c:   { l: 'Checkout', s: 't', f: function (t) { return t[4]; }, u: 'n' },
    b:   { l: 'Bookings', s: 't', f: function (t) { return t[5]; }, u: 'n' },
    cr:  { l: 'Conv. búsqueda → booking', s: 't', f: function (t) { return rat(t[5], t[1]); }, u: '%' },
    o:   { l: 'Orders', s: 'r', f: function (r) { return r[0]; }, u: 'n' },
    gb:  { l: 'Gross Bookings', s: 'r', f: function (r) { return r[1]; }, u: '$' },
    nr:  { l: 'Net Revenues', s: 'r', f: function (r) { return r[2]; }, u: '$' },
    fvm: { l: 'FVM', s: 'r', f: function (r) { return r[3]; }, u: '$' },
    tk:  { l: 'Ticket (GB / order)', s: 'r', f: function (r) { return rat(r[1], r[0]); }, u: '$1' },
    tr:  { l: 'NR / GB', s: 'r', f: function (r) { return rat(r[2], r[1]); }, u: '%' },
    fg:  { l: 'FVM / GB', s: 'r', f: function (r) { return rat(r[3], r[1]); }, u: '%' },
  };
  function val(m, part) { var x = part && part[M[m].s]; return x ? M[m].f(x) : null; }
  function delta(m, a, b) {   // % para montos y cantidades; puntos porcentuales para tasas
    if (a == null || b == null || !isFinite(a) || !isFinite(b)) return null;
    if (M[m].u === '%') return { v: (a - b) * 100, pp: true };
    return b ? { v: (a / b - 1) * 100, pp: false } : null;
  }
  function cmps() { return [['ly', 'vs LY'], ['tr', 'vs tend.'], ['pv', S.gran === 'm' ? 'vs mes ant.' : 'vs sem. ant.']]; }
  function cmpShort(c) { return { ly: 'LY', tr: 'T', pv: 'A' }[c]; }
  function ec() { return S.k === 'ytd' ? 'ly' : S.cmp; }   // comparación en uso (el acumulado solo tiene LY)
  function ecLbl() { var c = ec(); return c === 'ly' ? 'vs año pasado' : c === 'tr' ? 'vs tendencia' : (S.gran === 'm' ? 'vs mes anterior' : 'vs semana anterior'); }
  function ecBase() { var c = ec(); return c === 'ly' ? 'Año pasado' : c === 'tr' ? 'Tendencia' : (S.gran === 'm' ? 'Mes ant.' : 'Sem. ant.'); }

  // ── Puente de drivers (LMDI) ──
  // V = búsquedas × (bookings/búsquedas) × (orders/bookings) × (GB/order) × (NR/GB) [× (FVM/NR)]. Contribución de cada driver =
  // L(V1, V0) × ln(x1 / x0), con L la media logarítmica: las contribuciones suman exacto V1 − V0.
  var BM = { nr: { l: 'Net Revenues', v: function (r) { return r[2]; }, d: ['tk', 'take'] }, fvm: { l: 'FVM', v: function (r) { return r[3]; }, d: ['tk', 'take', 'mg'] },
    gb: { l: 'Gross Bookings', v: function (r) { return r[1]; }, d: ['tk'] }, o: { l: 'Orders', v: function (r) { return r[0]; }, d: [] } };
  var DRV = {
    s:    { l: 'Tráfico', ll: 'búsquedas', f: function (t, r) { return t[1]; }, u: '%' },
    cv:   { l: 'Conversión', ll: 'bookings / búsquedas', f: function (t, r) { return t[5] / t[1]; }, u: 'pp' },
    ob:   { l: 'Bookings → orders', ll: 'orders / bookings', f: function (t, r) { return r[0] / t[5]; }, u: '%' },
    o:    { l: 'Orders', ll: 'orders', f: function (t, r) { return r[0]; }, u: '%' },
    tk:   { l: 'Ticket', ll: 'GB / order', f: function (t, r) { return r[1] / r[0]; }, u: '%' },
    take: { l: 'Take rate', ll: 'NR / GB', f: function (t, r) { return r[2] / r[1]; }, u: 'pp' },
    mg:   { l: 'Margen', ll: 'FVM / NR', f: function (t, r) { return r[3] / r[2]; }, u: 'pp' },
  };
  function bridge(cur, base, met) {
    if (!cur || !base || !cur.r || !base.r) return null;
    var useT = !!(cur.t && base.t && cur.t[1] > 0 && base.t[1] > 0 && cur.t[5] > 0 && base.t[5] > 0);
    var ds = (useT ? ['s', 'cv', 'ob'] : ['o']).concat(BM[met].d);
    var v0 = BM[met].v(base.r), v1 = BM[met].v(cur.r);
    if (!(v0 > 0) || !(v1 > 0)) return null;
    var L = Math.abs(v1 - v0) < 1e-9 ? v1 : (v1 - v0) / (Math.log(v1) - Math.log(v0)), items = [];
    for (var i = 0; i < ds.length; i++) {
      var D = DRV[ds[i]], x0 = D.f(base.t, base.r), x1 = D.f(cur.t, cur.r);
      if (!(x0 > 0) || !(x1 > 0) || !isFinite(x0) || !isFinite(x1)) return null;
      items.push({ k: ds[i], l: D.l, ll: D.ll, c: L * Math.log(x1 / x0), x0: x0, x1: x1, d: D.u === 'pp' ? { v: (x1 - x0) * 100, pp: true } : { v: (x1 / x0 - 1) * 100, pp: false } });
    }
    return { v0: v0, v1: v1, items: items, traffic: useT };
  }
  function fmtMet(met, v) { return met === 'o' ? big(v) : '$' + big(v); }
  function sMet(met, v) { var r = fmtMet(met, Math.abs(v)); return (v > 0 ? '+' : v < 0 ? '−' : '') + r; }
  function mainDriver(cur, base, met) {
    var b = bridge(cur, base, met);
    if (!b || !b.items.length) return null;
    var top = b.items.slice().sort(function (x, y) { return Math.abs(y.c) - Math.abs(x.c); })[0];
    return { l: top.l.toLowerCase(), c: top.c, d: top.d };
  }

  // ── Formato ──
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, d) { return v.toLocaleString('es-AR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function big(v) { var a = Math.abs(v); return a >= 1e6 ? num(v / 1e6, 1) + 'M' : a >= 1e4 ? num(v / 1e3, 0) + 'K' : num(v, 0); }
  function fmt(m, v) {
    if (v == null || !isFinite(v)) return '—';
    var u = M[m].u;
    if (u === '%') return num(v * 100, 2) + '%';
    if (u === '$') return '$' + big(v);
    if (u === '$1') return '$' + num(v, 0);
    return big(v);
  }
  function sgn(v, d) { var r = num(Math.abs(v), d); return (/[1-9]/.test(r) ? (v > 0 ? '+' : '−') : '') + r; }
  function dcls(d) { return !d ? 'na' : d.v > 0.05 ? 'up' : d.v < -0.05 ? 'dn' : 'na'; }
  function dtxt(d) { if (!d) return '<span class="na">n/d</span>'; return '<span class="' + dcls(d) + '">' + sgn(d.v, 1) + (d.pp ? ' pp' : '%') + '</span>'; }
  function dplain(d) { return d ? sgn(d.v, 1) + (d.pp ? ' pp' : '%') : 'n/d'; }
  function tendLbl() { return S.gran === 'm' ? 'prom. 3 meses ant.' : 'prom. 4 semanas ant.'; }
  function per() { return S.gran === 'm' ? 'mes' : 'semana'; }
  function mismo() { return S.gran === 'm' ? 'el mismo mes' : 'la misma semana'; }
  function este() { return S.gran === 'm' ? 'este mes' : 'esta semana'; }
  function color(key) { var i = EVO ? EVO.rows.map(function (r) { return r.key; }).indexOf(key) : -1; return i < 0 ? null : key === 'Resto' ? 'var(--c0)' : 'var(--c' + (i + 1) + ')'; }
  function tick(i, n, every) { return i === n - 1 || (i % every === 0 && n - 1 - i >= Math.ceil(every / 2)); }
  function nice(x) { var e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; }

  // ── Datos ──
  function qs(extra) {
    var p = new URLSearchParams(); p.set('gran', S.gran);
    FD.forEach(function (d) { if (S.f[d]) p.set(d, S.f[d]); });
    Object.keys(extra || {}).forEach(function (k) { p.set(k, extra[k]); });
    return p.toString();
  }
  function getJson(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
    });
  }
  function syncUrl() {
    var p = new URLSearchParams(qs());
    if (S.k) p.set('k', S.k); if (S.met !== 'o') p.set('met', S.met); if (S.dim !== 'region') p.set('dim', S.dim); if (S.win) p.set('win', S.win);
    if (S.cmp !== 'tr') p.set('cmp', S.cmp); if (S.pm !== 's') p.set('pm', S.pm); if (S.bm !== 'nr') p.set('bm', S.bm);
    if (S.view !== 'portada') p.set('view', S.view);
    if (S.view === 'moonshot') { ['gran', 'region', 'pais', 'partner', 'prod', 'plat'].forEach(function (k) { p.delete(k); });
      if (MS.dir) p.set('dir', MS.dir); if (MS.ind) p.set('ind', MS.ind); if (MS.pais) p.set('mpais', MS.pais); }
    history.replaceState(null, '', location.pathname + '?' + p.toString());
  }
  function load() {
    var my = ++seq;
    document.getElementById('tk-body').innerHTML = '<div class="tk-load">Cargando…</div>';
    if (S.view === 'moonshot') {
      renderBar();
      getJson(CFG.api + '?view=moonshot').then(function (j) { if (my !== seq) return; MOON = j; renderMoon(); syncUrl(); })
        .catch(function (e) { document.getElementById('tk-body').innerHTML = '<div class="tk-err">No se pudo armar el Moonshot: ' + esc(e.message) + '</div>'; });
      return;
    }
    Promise.all([getJson(CFG.api + '?' + qs()), getJson(CFG.api + '?' + qs({ evo: '1' }))]).then(function (res) {
      if (my !== seq) return;
      DATA = res[0]; EVO = res[1];
      if (!S.k || (S.k !== 'ytd' && !DATA.periods.some(function (p) { return p.k === S.k; }))) S.k = DATA.defaultKey;
      renderAll(); loadPeriod();
    }).catch(function (e) { document.getElementById('tk-body').innerHTML = '<div class="tk-err">No se pudieron cargar los datos: ' + esc(e.message) + '</div>'; });
  }
  // Lo que depende del período elegido: apertura y ranking de partners
  function loadPeriod() {
    var my = seq;
    ['tk-bd', 'tk-rank'].forEach(function (id) { var b = document.getElementById(id); if (b) b.innerHTML = '<div class="tk-load">Cargando…</div>'; });
    if (S.view === 'detalle') getJson(CFG.api + '?' + qs({ dim: S.dim, k: S.k })).then(function (j) { if (my !== seq) return; BD = j; renderBd(); })
      .catch(function (e) { var b = document.getElementById('tk-bd'); if (b) b.innerHTML = '<div class="tk-err">' + esc(e.message) + '</div>'; });
    if (S.view === 'portada') loadCountries(my);
    PROD = null;
    if (!S.f.prod) getJson(CFG.api + '?' + qs({ dim: 'prod', k: S.k })).then(function (j) { if (my !== seq) return; PROD = j; renderMix(); renderBridge(); renderSummary(); })
      .catch(function (e) { var b = document.getElementById('tk-mix'); if (b) b.innerHTML = '<div class="tk-err">' + esc(e.message) + '</div>'; });
    getJson(CFG.api + '?' + qs({ dim: 'partner', k: S.k })).then(function (j) { if (my !== seq) return; PART = j; renderPartners(); })
      .catch(function (e) { var b = document.getElementById('tk-rank'); if (b) b.innerHTML = '<div class="tk-err">' + esc(e.message) + '</div>'; });
    syncUrl();
  }
  // Portada: apertura por país (1 pedido) + producto y partner de cada país (para el mix y el partner que más mueve)
  function loadCountries(my) {
    CT = null;
    var base = function (extra) { var p = new URLSearchParams(); p.set('gran', S.gran); Object.keys(extra).forEach(function (k) { p.set(k, extra[k]); }); return CFG.api + '?' + p.toString(); };
    var reqs = [getJson(base({ dim: 'pais', k: S.k }))];
    COUNTRIES.forEach(function (c) { reqs.push(getJson(base({ pais: c[0], dim: 'prod', k: S.k }))); reqs.push(getJson(base({ pais: c[0], dim: 'partner', k: S.k }))); });
    Promise.all(reqs).then(function (res) {
      if (my !== seq) return;
      var det = {};
      COUNTRIES.forEach(function (c, i) { det[c[0]] = { prod: res[1 + 2 * i], part: res[2 + 2 * i] }; });
      CT = { rows: res[0].rows, det: det };
      renderPortada();
    }).catch(function (e) { var b = document.getElementById('tk-cty'); if (b) b.innerHTML = '<div class="tk-err">' + esc(e.message) + '</div>'; });
  }
  function selP() {
    if (S.k === 'ytd') return DATA.ytd;
    return (DATA.periods.filter(function (p) { return p.k === S.k; })[0]) || DATA.periods[DATA.periods.length - 1];
  }

  // ── Barra de controles ──
  function renderBar() {
    if (S.view === 'moonshot') {
      document.getElementById('tk-bar').innerHTML = '<div class="tk-vt" role="tablist"><button type="button" data-view="portada">Portada</button><button type="button" data-view="moonshot" class="on">Moonshot 3x</button><span class="sep"></span>' +
        COUNTRIES.map(function (c) { return '<button type="button" data-view="pais" data-c="' + esc(c[0]) + '">' + esc(c[1]) + '</button>'; }).join('') +
        '<span class="sep"></span><button type="button" data-view="detalle">Detalle</button></div>';
      return;
    }
    var o = (DATA && DATA.options) || {};
    var seg = '<div class="tk-seg" role="group" aria-label="Granularidad">' +
      [['w', 'Semanal'], ['m', 'Mensual']].map(function (g) { return '<button type="button" data-gran="' + g[0] + '" class="' + (S.gran === g[0] ? 'on' : '') + '">' + g[1] + '</button>'; }).join('') + '</div>';
    var sels = FD.map(function (d) {
      var opts = (o[d] || []).map(function (x) { return '<option value="' + esc(x.v) + '"' + (S.f[d] === x.v ? ' selected' : '') + '>' + esc(x.l) + '</option>'; }).join('');
      return '<div class="tk-f"><label for="tk-f-' + d + '">' + FL[d] + '</label><select id="tk-f-' + d + '" data-f="' + d + '"><option value="">Todos</option>' + opts + '</select></div>';
    }).join('');
    var ps = DATA ? '<option value="ytd"' + (S.k === 'ytd' ? ' selected' : '') + '>' + esc(DATA.ytd.lbl) + '</option>' + DATA.periods.slice().reverse().map(function (p) {
      var tag = p.partial ? ' (en curso)' : p.flag ? ' · tráfico incompleto' : '';
      return '<option value="' + esc(p.k) + '"' + (p.k === S.k ? ' selected' : '') + '>' + esc(p.lbl + tag) + '</option>';
    }).join('') : '';
    var any = FD.some(function (d) { return S.f[d]; });
    var cc = S.k === 'ytd' ? [['ly', 'vs LY']] : cmps();
    var cseg = '<div class="tk-f"><label>Comparar contra</label><div class="tk-seg" role="group" aria-label="Comparar contra">' +
      cc.map(function (c) { return '<button type="button" data-cmp="' + c[0] + '" class="' + (ec() === c[0] ? 'on' : '') + '">' + c[1] + '</button>'; }).join('') + '</div></div>';
    var vt = '<div class="tk-vt" role="tablist">' + '<button type="button" data-view="portada" class="' + (S.view === 'portada' ? 'on' : '') + '">Portada</button>' +
      '<button type="button" data-view="moonshot" class="' + (S.view === 'moonshot' ? 'on' : '') + '">Moonshot 3x</button><span class="sep"></span>' +
      COUNTRIES.map(function (c) { return '<button type="button" data-view="pais" data-c="' + esc(c[0]) + '" class="' + (S.view === 'pais' && S.f.pais === c[0] ? 'on' : '') + '">' + esc(c[1]) + '</button>'; }).join('') +
      '<span class="sep"></span><button type="button" data-view="detalle" class="' + (S.view === 'detalle' ? 'on' : '') + '">Detalle</button></div>';
    if (S.view !== 'detalle') { sels = ''; any = false; }
    document.getElementById('tk-bar').innerHTML = vt + seg + sels +
      '<div class="tk-f"><label for="tk-k">Período</label><select id="tk-k">' + ps + '</select></div>' + cseg +
      (any ? '<button type="button" class="tk-clear" id="tk-clear">Limpiar filtros</button>' : '');
  }

  // ── Resultados (Daily) ──
  function kpis(p) {
    var ms = ['o', 'gb', 'nr', 'fvm', 'tk', 'fg'];
    return '<div class="tk-kpis">' + ms.map(function (m) {
      var a = val(m, p.cur);
      return '<div class="tk-card tk-kpi"><div class="l">' + M[m].l + '</div><div class="v">' + fmt(m, a) + '</div><div class="tk-d">' +
        cmps().filter(function (c) { return S.view === 'detalle' || c[0] === ec() || c[0] === 'ly'; })
          .map(function (c) { return p.ytd && c[0] !== 'ly' ? '' : '<span><i>' + c[1] + '</i>' + dtxt(delta(m, a, val(m, p[c[0]]))) + '</span>'; }).join('') + '</div></div>';
    }).join('') + '</div>';
  }

  // ── Embudo de tráfico ──
  // Ancho de cada escalón en escala logarítmica (de usuarios a bookings hay ~100x: en escala lineal los últimos pasos no se verían);
  // los números van escritos. A la derecha, la conversión desde el paso anterior y sus Δ en puntos porcentuales.
  function funnel(p, compact) {
    var steps = ['u', 's', 'd', 'pi', 'c', 'b'], t = p.cur.t;
    if (!t) return '<div class="tk-card"><div class="na">Sin datos de tráfico para este filtro y período (p.ej. partners por API, que no pasan por el sitio).</div></div>';
    var cs = p.ytd ? [['ly', 'vs LY']] : compact ? cmps().filter(function (c) { return c[0] === ec(); }) : cmps();
    var W = compact ? 640 : 1000, top = 30, rowH = 64, FW = compact ? 330 : 470, cx = FW / 2 + 10, colX = (compact ? [520, 630] : [640, 750, 860, 970]).slice(0, 1 + cs.length);
    var H = top + rowH * steps.length + 4;
    var pos = t.filter(function (v) { return v > 0; }), lmax = Math.log(Math.max.apply(null, pos)), lmin = Math.log(Math.min.apply(null, pos));
    var mw = compact ? 0.3 : 0.16;   // ancho mínimo del escalón: que entre el nombre del paso
    var wOf = function (v) { if (!(v > 0)) return FW * mw; return FW * (lmax === lmin ? 1 : mw + (1 - mw) * (Math.log(v) - lmin) / (lmax - lmin)); };
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Embudo de tráfico">';
    g += '<text class="hd" x="' + colX[0] + '" y="16">Conv. paso ant.</text>';
    cs.forEach(function (c, j) { g += '<text class="hd" x="' + colX[j + 1] + '" y="16">' + c[1] + '</text>'; });
    steps.forEach(function (m, i) {
      var y0 = top + i * rowH, y1 = y0 + rowH - 4, w0 = wOf(t[i]), w1 = i < steps.length - 1 ? wOf(t[i + 1]) : w0 * 0.86;
      var op = (1 - i * 0.09).toFixed(2), conv = i ? rat(t[i], t[i - 1]) : null;
      var tip = M[m].l + ': ' + num(t[i], 0) + (conv != null ? '\nConversión desde ' + M[steps[i - 1]].l.toLowerCase() + ': ' + num(conv * 100, 1) + '%' : '');
      cs.forEach(function (c) { var b = p[c[0]].t; tip += '\n' + c[1] + ': ' + (b ? num(b[i], 0) + ' (' + dplain(delta(m, t[i], b[i])) + ')' : 'n/d'); });
      g += '<g class="st"><title>' + esc(tip) + '</title><path d="M' + (cx - w0 / 2).toFixed(1) + ' ' + y0 + 'L' + (cx + w0 / 2).toFixed(1) + ' ' + y0 + 'L' + (cx + w1 / 2).toFixed(1) + ' ' + y1 + 'L' + (cx - w1 / 2).toFixed(1) + ' ' + y1 + 'Z" fill="var(--primary)" fill-opacity="' + op + '"/>' +
        '<text class="sl" x="' + cx + '" y="' + (y0 + rowH / 2 - 4) + '">' + esc(M[m].l) + '</text><text class="sv" x="' + cx + '" y="' + (y0 + rowH / 2 + 14) + '">' + esc(fmt(m, t[i])) + '</text></g>';
      g += '<line class="gl" x1="' + (FW + 40) + '" x2="' + W + '" y1="' + (y1 + 2) + '" y2="' + (y1 + 2) + '"/>';
      if (i) {
        var ym = y0 + rowH / 2 + 5;
        g += '<text class="cv" x="' + colX[0] + '" y="' + ym + '">' + num(conv * 100, 1) + '%</text>';
        cs.forEach(function (c, j) {
          var b = p[c[0]].t, cb = b ? rat(b[i], b[i - 1]) : null, d = conv != null && cb != null ? { v: (conv - cb) * 100, pp: true } : null;
          g += '<text class="dv ' + dcls(d) + '" x="' + colX[j + 1] + '" y="' + ym + '">' + dplain(d) + '</text>';
        });
      }
    });
    g += '</svg>';
    var cr = val('cr', p.cur);
    var h = '<div class="tk-card tk-emb">' + (compact ? '<h3>Funnel de tráfico</h3>' : '') + g + '<div class="tk-cr">Conversión búsqueda → booking: <b>' + fmt('cr', cr) + '</b>' +
      cs.map(function (c) { return ' · ' + c[1] + ' ' + dtxt(delta('cr', cr, val('cr', p[c[0]]))); }).join('') + '</div>';
    var warn = [];
    if (p.ytd) warn.push('Acumulado: el tráfico va hasta el último mes cerrado' + (p.flag || p.ly.flag ? '; hay meses con tráfico incompleto, así que el funnel no se compara contra el año pasado.' : '.'));
    else if (p.partial) warn.push((S.gran === 'm' ? 'El mes' : 'La semana') + ' está en curso: el tráfico no tiene apertura diaria, así que no se compara.');
    else if (p.flag) warn.push('Tráfico incompleto en ' + este() + ' (días sin cargar en la tabla de tráfico): no se compara.');
    else if (p.ly.flag) warn.push('El tráfico ' + (S.gran === 'm' ? 'del mismo mes' : 'de la misma semana') + ' del año pasado está incompleto: el YoY del funnel queda sin dato.');
    return h + (warn.length ? '<div class="tk-warn">' + warn.join(' ') + '</div>' : '') + '</div>';
  }

  // ── Evolutivo (total) ──
  var CHIPS = [['o', 'gb', 'nr', 'fvm', 'tk', 'fg'], ['u', 's', 'c', 'b', 'cr']];
  function winN() { return S.gran === 'm' ? 9999 : (S.win || 26); }
  function winSel() {
    if (S.gran !== 'w') return '';
    var w = winN();
    return '<span class="win"><select class="tk-win">' + [[13, '13 semanas'], [26, '26 semanas'], [52, '52 semanas'], [9999, 'Todo']].map(function (x) {
      return '<option value="' + x[0] + '"' + (x[0] === w ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></span>';
  }
  function yScale(vals, H, padT, padB) {
    var ok = vals.filter(function (v) { return v != null && isFinite(v); });
    var mx = Math.max.apply(null, ok.concat([0])), mn = Math.min.apply(null, ok.concat([0]));
    var step = nice(((mx || 1) - mn) / 4); mx = Math.ceil((mx || 1) / step) * step; mn = Math.floor(mn / step) * step;
    return { mn: mn, mx: mx, step: step, y: function (v) { return padT + (H - padT - padB) * (1 - (v - mn) / (mx - mn || 1)); } };
  }
  function grid(sc, m, padL, W) {
    var g = '';
    for (var v = sc.mn; v <= sc.mx + sc.step / 2; v += sc.step) { var y = sc.y(v); g += '<line class="gl" x1="' + padL + '" x2="' + W + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end">' + esc(fmt(m, v)) + '</text>'; }
    return g;
  }
  function chart() {
    var m = S.met, ps = DATA.periods.slice(-winN());
    var W = 1000, H = 300, padL = 56, padR = 10, padT = 12, padB = 26, strip = ps.length <= 30 ? 34 : 0;
    // El período en curso (pocos días) va como barra clara, pero sin LY ni tendencia en las líneas: si no, las hunde.
    var vals = ps.map(function (p) { return val(m, p.cur); }), lys = ps.map(function (p) { return p.partial ? null : val(m, p.ly); }), trs = ps.map(function (p) { return p.partial ? null : val(m, p.tr); });
    var sc = yScale(vals.concat(lys, trs), H, padT, padB), n = ps.length, bw = (W - padL - padR) / n, flagT = M[m].s === 't';
    var g = '<svg viewBox="0 0 ' + W + ' ' + (H + strip) + '" role="img" aria-label="Evolutivo de ' + esc(M[m].l) + '"><defs><pattern id="tk-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--flag)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--dn)" stroke-width="1.5" stroke-opacity=".5"/></pattern></defs>';
    g += grid(sc, m, padL, W - padR);
    var every = Math.ceil(n / 14);
    ps.forEach(function (p, i) {
      var v = vals[i], x = padL + i * bw + bw * 0.14, w = bw * 0.72;
      var cls = 'bar' + (p.k === S.k ? ' sel' : '') + (p.partial ? ' part' : '') + (flagT && p.flag ? ' flag' : '');
      if (v != null && isFinite(v)) {
        var y0 = sc.y(Math.max(0, sc.mn)), y1 = sc.y(v);
        g += '<rect class="' + cls + '" data-k="' + esc(p.k) + '" x="' + x.toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, Math.abs(y0 - y1)).toFixed(1) + '" rx="3">' +
          '<title>' + esc(p.lbl + (p.partial ? ' (en curso)' : '') + (flagT && p.flag ? ' · tráfico incompleto' : '') + '\n' + M[m].l + ': ' + fmt(m, v) + '\nAño pasado: ' + fmt(m, val(m, p.ly)) + '\nTendencia: ' + fmt(m, val(m, p.tr)) + '\nPeríodo anterior: ' + fmt(m, val(m, p.pv))) + '</title></rect>';
      }
      if (tick(i, n, every)) g += '<text class="ax" x="' + (padL + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(S.gran === 'm' ? p.lbl : p.lbl.split(' · ')[0]) + '</text>';
    });
    function line(arr, cls) {
      var d = '', pen = false;
      arr.forEach(function (v, i) { if (v == null || !isFinite(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + (padL + i * bw + bw / 2).toFixed(1) + ' ' + sc.y(v).toFixed(1); pen = true; });
      return d ? '<path class="' + cls + '" d="' + d + '"/>' : '';
    }
    g += line(lys, 'ly') + line(trs, 'tr');
    if (strip) {
      g += '<text class="rowl" x="' + (padL - 6) + '" y="' + (H + 12) + '" text-anchor="end">vs LY</text><text class="rowl" x="' + (padL - 6) + '" y="' + (H + 28) + '" text-anchor="end">vs tend.</text>';
      ps.forEach(function (p, i) {
        var x = (padL + i * bw + bw / 2).toFixed(1);
        [[lys[i], H + 12], [trs[i], H + 28]].forEach(function (z) {
          var d = delta(m, vals[i], z[0]);
          g += '<text class="pct ' + dcls(d) + '" x="' + x + '" y="' + z[1] + '">' + (d ? sgn(d.v, d.pp ? 1 : 0) : '·') + '</text>';
        });
      });
    }
    g += '</svg>';
    var chips = CHIPS.map(function (grp) { return grp.map(function (k) { return '<button type="button" data-met="' + k + '" class="' + (k === m ? 'on' : '') + '">' + esc(M[k].l) + '</button>'; }).join(''); }).join('<span class="sep"></span>');
    return '<div class="tk-card"><div class="tk-chips">' + chips + '</div>' +
      '<div class="tk-lg"><span><i style="background:var(--primary)"></i>' + (S.gran === 'm' ? 'Mes' : 'Semana') + '</span><span><i style="background:none;border-top:2px dashed var(--ly);height:0;border-radius:0"></i>Año pasado</span>' +
      '<span><i style="background:var(--tr);height:2px;border-radius:0"></i>Tendencia (' + tendLbl() + ')</span>' +
      (flagT ? '<span><i style="background:var(--flag);box-shadow:inset 0 0 0 1px var(--dn)"></i>Tráfico incompleto</span>' : '') + winSel() + '</div>' +
      '<div class="tk-chart">' + g + '</div></div>';
  }

  // ── Partners ──
  var PM = ['s', 'b', 'o', 'nr', 'fvm'];
  function partnersShell() {
    var pchips = PM.map(function (k) { return '<button type="button" data-pm="' + k + '" class="' + (S.pm === k ? 'on' : '') + '">' + esc(M[k].l) + '</button>'; }).join('');
    return '<div class="tk-card"><h3>Ranking</h3><div class="sub">Ordenado por búsquedas. Share = parte de las búsquedas del filtro. Eficiencia = conversión búsqueda → booking relativa a la mejor. "Qué lo mueve" = el driver que más explica la variación de NR ' + esc(ecLbl()) + '. Clic en una fila para filtrar.</div>' +
      '<div id="tk-rank"></div></div>' +
      '<div class="tk-grid2"><div class="tk-card"><h3>Eficiencia: volumen vs conversión</h3><div class="sub">Cada burbuja es un partner: búsquedas (escala logarítmica) contra conversión; el tamaño son los bookings.</div><div class="tk-chart" id="tk-bub"></div></div>' +
      '<div class="tk-card"><h3>Conversión por partner</h3><div class="sub">Búsqueda → booking, ' + (S.gran === 'm' ? 'mes a mes' : 'semana a semana') + '. Sin dato en los períodos con tráfico incompleto.</div><div class="tk-chart" id="tk-crl"></div></div></div>' +
      '<div class="tk-card" style="margin-top:14px"><h3>Evolutivo por partner</h3><div class="sub">Los 7 partners con más búsquedas en la ventana; el resto suma en "Resto".</div>' +
      '<div class="tk-chips">' + pchips + '</div><div id="tk-stk"></div></div>';
  }
  function renderPartners() { renderRank(); renderBubbles(); renderCrLines(); renderStack(); renderSummary(); }
  function renderRank() {
    var box = document.getElementById('tk-rank'); if (!box || !PART) return;
    var c = PART.k === 'ytd' ? 'ly' : S.cmp, cl = cmpShort(c);
    var rows = PART.rows.filter(function (r) { return r.key !== 'Otros'; });
    var totS = rows.reduce(function (a, r) { return a + ((r.cur.t || [])[1] || 0); }, 0);
    var maxCr = Math.max.apply(null, rows.map(function (r) { return val('cr', r.cur) || 0; }).concat([0.0001]));
    if (S.view === 'pais') {
      var top = rows.slice(0, 8);
      box.innerHTML = top.length ? '<div class="tk-tw"><table class="tk-t"><thead><tr><th class="l">Partner</th><th>Búsquedas</th><th>Conversión</th><th>Orders</th><th>NR</th><th class="l">Qué lo mueve</th></tr></thead><tbody>' +
        top.map(function (r) {
          var cl2 = function (m) { var a = val(m, r.cur); return '<td>' + fmt(m, a) + '<span class="s">' + dtxt(delta(m, a, val(m, r[c]))) + '</span></td>'; };
          return '<tr><td class="l k">' + esc(r.lbl) + '</td>' + cl2('s') + cl2('cr') + cl2('o') + cl2('nr') + '<td class="l tk-drv">' + drvTxt(r[c] ? mainDriver(r.cur, r[c], 'nr') : null) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="na">Sin partners para este país.</div>';
      return;
    }
    var shown = S.all ? rows : rows.slice(0, 15);
    var head = '<tr><th class="l">#</th><th class="l">Partner</th><th>Búsquedas</th><th>Share</th><th>Bookings</th><th>Conversión</th><th>Orders</th><th>NR</th><th>FVM</th><th class="l">Eficiencia</th><th class="l">Qué lo mueve</th></tr>';
    var cell = function (m, r) { var a = val(m, r.cur); return '<td>' + fmt(m, a) + '<span class="s"><i>' + cl + '</i> ' + dtxt(delta(m, a, val(m, r[c]))) + '</span></td>'; };
    var body = shown.map(function (r, i) {
      var s = (r.cur.t || [])[1], cr = val('cr', r.cur), col = color(r.key);
      return '<tr class="click" data-pk="' + esc(r.key) + '"><td class="l"><span class="tk-rk">' + (i + 1) + '</span></td><td class="l k">' + (col ? '<span class="tk-dot" style="background:' + col + '"></span>' : '<span class="tk-dot"></span>') + esc(r.lbl) + '</td>' +
        cell('s', r) + '<td>' + (s && totS ? num(s / totS * 100, 1) + '%' : '—') + '</td>' + cell('b', r) + cell('cr', r) + cell('o', r) + cell('nr', r) + cell('fvm', r) +
        '<td class="l">' + (cr != null ? '<span class="tk-ef" style="width:' + Math.max(2, cr / maxCr * 70).toFixed(0) + 'px"></span><span class="na">' + num(cr * 100, 1) + '%</span>' : '<span class="na">sin tráfico</span>') + '</td>' +
        '<td class="l tk-drv">' + drvTxt(r[c] ? mainDriver(r.cur, r[c], 'nr') : null) + '</td></tr>';
    }).join('');
    box.innerHTML = rows.length ? '<div class="tk-tw"><table class="tk-t"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      (rows.length > 15 ? '<button type="button" class="tk-more" id="tk-more">' + (S.all ? 'Ver menos' : 'Ver todos (' + rows.length + ')') + '</button>' : '') : '<div class="na">Sin partners para este filtro.</div>';
  }
  function drvTxt(md) {
    if (!md) return '<span class="na">—</span>';
    return esc(md.l) + ' <span class="' + (md.c > 0 ? 'up' : md.c < 0 ? 'dn' : 'na') + '">' + sMet('nr', md.c) + '</span>';
  }
  function renderBubbles() {
    var box = document.getElementById('tk-bub'); if (!box || !PART) return;
    var pts = PART.rows.filter(function (r) { return r.key !== 'Otros' && r.cur.t && r.cur.t[1] >= 300 && r.cur.t[5] > 0; })
      .map(function (r) { return { k: r.lbl, s: r.cur.t[1], b: r.cur.t[5], cr: r.cur.t[5] / r.cur.t[1] }; });
    if (!pts.length) { box.innerHTML = '<div class="na">Sin tráfico para este filtro.</div>'; return; }
    var W = 560, H = 360, padL = 48, padR = 16, padT = 14, padB = 34;
    var lx0 = Math.floor(Math.log10(Math.min.apply(null, pts.map(function (p) { return p.s; })))), lx1 = Math.ceil(Math.log10(Math.max.apply(null, pts.map(function (p) { return p.s; }))));
    if (lx1 === lx0) lx1++;
    var x = function (v) { return padL + (W - padL - padR) * (Math.log10(v) - lx0) / (lx1 - lx0); };
    var sc = yScale(pts.map(function (p) { return p.cr; }), H, padT, padB), bmax = Math.max.apply(null, pts.map(function (p) { return p.b; }));
    var r = function (b) { return 5 + 22 * Math.sqrt(b / bmax); };
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Búsquedas contra conversión por partner">' + grid(sc, 'cr', padL, W - padR);
    for (var e = lx0; e <= lx1; e++) { var xx = x(Math.pow(10, e)); g += '<line class="gl" x1="' + xx + '" x2="' + xx + '" y1="' + padT + '" y2="' + (H - padB) + '"/><text class="ax" x="' + xx + '" y="' + (H - padB + 14) + '" text-anchor="middle">' + big(Math.pow(10, e)) + '</text>'; }
    g += '<text class="axt" x="' + (W - padR) + '" y="' + (H - 4) + '" text-anchor="end">Búsquedas →</text>';
    var lbl = pts.slice().sort(function (a, b) { return b.s - a.s; }).slice(0, 12).map(function (p) { return p.k; });
    pts.slice().sort(function (a, b) { return b.b - a.b; }).forEach(function (p) {
      g += '<circle class="bub" cx="' + x(p.s).toFixed(1) + '" cy="' + sc.y(p.cr).toFixed(1) + '" r="' + r(p.b).toFixed(1) + '"><title>' + esc(p.k + '\nBúsquedas: ' + num(p.s, 0) + '\nBookings: ' + num(p.b, 0) + '\nConversión: ' + num(p.cr * 100, 2) + '%') + '</title></circle>';
    });
    var placed = [];
    pts.filter(function (p) { return lbl.indexOf(p.k) >= 0; }).sort(function (a, b) { return sc.y(a.cr) - sc.y(b.cr); }).forEach(function (p) {
      var w = p.k.length * 6.3, cx = x(p.s), rr = r(p.b), right = cx + rr + 3 + w <= W - padR;
      var x0 = right ? cx + rr + 3 : cx - rr - 3 - w, yy = sc.y(p.cr) + 4;
      for (var t = 0; t < 6; t++) {
        var hit = placed.some(function (q) { return x0 < q.x1 && x0 + w > q.x0 && Math.abs(yy - q.y) < 12; });
        if (!hit) break;
        yy += 12;
      }
      placed.push({ x0: x0, x1: x0 + w, y: yy });
      g += '<text class="bl" x="' + (right ? x0 : x0 + w).toFixed(1) + '" y="' + yy.toFixed(1) + '"' + (right ? '' : ' text-anchor="end"') + '>' + esc(p.k) + '</text>';
    });
    box.innerHTML = g + '</svg>';
  }
  function evoWin() { var n = Math.min(winN(), EVO.keys.length); return EVO.keys.length - n; }
  function renderCrLines() {
    var box = document.getElementById('tk-crl'); if (!box || !EVO) return;
    var from = evoWin(), keys = EVO.keys.slice(from), rows = EVO.rows.filter(function (r) { return r.key !== 'Resto'; });
    var W = 560, H = 360, padL = 52, padR = 10, padT = 14, padB = 34, n = keys.length;
    var series = rows.map(function (r) { return r.t.slice(from).map(function (t, i) { var j = from + i; return t && !EVO.flag[j] && EVO.keys[j] !== EVO.partialKey && t[1] ? t[5] / t[1] : null; }); });
    var all = [].concat.apply([], series);
    if (!all.some(function (v) { return v != null; })) { box.innerHTML = '<div class="na">Sin tráfico para este filtro.</div>'; return; }
    var sc = yScale(all, H, padT, padB), bw = (W - padL - padR) / n;
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Conversión por partner">' + grid(sc, 'cr', padL, W - padR);
    var every = Math.ceil(n / 7);
    keys.forEach(function (k, i) { if (tick(i, n, every)) g += '<text class="ax" x="' + (padL + i * bw + bw / 2).toFixed(1) + '" y="' + (H - padB + 14) + '" text-anchor="middle">' + esc(S.gran === 'm' ? EVO.lbls[from + i] : EVO.lbls[from + i].split(' · ')[0]) + '</text>'; });
    rows.forEach(function (r, ri) {
      var d = '', pen = false;
      series[ri].forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + (padL + i * bw + bw / 2).toFixed(1) + ' ' + sc.y(v).toFixed(1); pen = true; });
      if (d) g += '<path class="ln" stroke="' + color(r.key) + '" d="' + d + '"><title>' + esc(r.key) + '</title></path>';
    });
    box.innerHTML = '<div class="tk-lg">' + rows.map(function (r) { return '<span><i style="background:' + color(r.key) + '"></i>' + esc(r.key) + '</span>'; }).join('') + '</div>' + g + '</svg>';
  }
  function renderStack() {
    var box = document.getElementById('tk-stk'); if (!box || !EVO) return;
    var m = S.pm, from = evoWin(), keys = EVO.keys.slice(from), n = keys.length;
    var v = function (r, i) { var part = { t: r.t[from + i], r: r.r[from + i] }; var x = val(m, part); return x != null && isFinite(x) && x > 0 ? x : 0; };
    var tot = keys.map(function (_, i) { return EVO.rows.reduce(function (a, r) { return a + v(r, i); }, 0); });
    var W = 1000, H = 300, padL = 56, padR = 10, padT = 12, padB = 26, sc = yScale(tot, H, padT, padB), bw = (W - padL - padR) / n;
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(M[m].l) + ' por partner">' + grid(sc, m, padL, W - padR);
    var every = Math.ceil(n / 14), flagT = M[m].s === 't';
    keys.forEach(function (k, i) {
      var x = padL + i * bw + bw * 0.14, w = bw * 0.72, acc = 0, j = from + i, part = k === EVO.partialKey, bad = flagT && EVO.flag[j];
      EVO.rows.forEach(function (r) {
        var val0 = v(r, i); if (!val0) return;
        var y1 = sc.y(acc), y2 = sc.y(acc + val0); acc += val0;
        g += '<rect class="seg" x="' + x.toFixed(1) + '" y="' + y2.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(0.5, y1 - y2).toFixed(1) + '" fill="' + color(r.key) + '"' + (part ? ' fill-opacity=".45"' : bad ? ' fill-opacity=".35"' : '') + '>' +
          '<title>' + esc(EVO.lbls[j] + (part ? ' (en curso)' : '') + (bad ? ' · tráfico incompleto' : '') + '\n' + r.key + ': ' + fmt(m, val0) + ' (' + num(val0 / (tot[i] || 1) * 100, 1) + '%)') + '</title></rect>';
      });
      if (tick(i, n, every)) g += '<text class="ax" x="' + (padL + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(S.gran === 'm' ? EVO.lbls[j] : EVO.lbls[j].split(' · ')[0]) + '</text>';
    });
    box.innerHTML = '<div class="tk-lg">' + EVO.rows.map(function (r) { return '<span><i style="background:' + color(r.key) + '"></i>' + esc(r.key) + '</span>'; }).join('') +
      (flagT ? '<span class="na">tono claro = tráfico incompleto o en curso</span>' : '') + winSel() + '</div><div class="tk-chart">' + g + '</svg></div>';
  }

  // ── Mix de productos ──
  // Descomposición simétrica de un promedio ponderado V = Σ w_p × a_p: mix = Σ Δw × (a0 + a1) / 2, dentro = Σ Δa × (w0 + w1) / 2.
  // Un producto sin dato de un lado toma el valor del otro (solo aporta por mix).
  function split(items) {
    var mix = 0, within = 0;
    items.forEach(function (x) {
      var a0 = x.a0 != null ? x.a0 : x.a1, a1 = x.a1 != null ? x.a1 : x.a0;
      if (a0 == null) return;
      mix += (x.w1 - x.w0) * (a0 + a1) / 2; within += (a1 - a0) * (x.w0 + x.w1) / 2;
    });
    return { mix: mix, within: within };
  }
  function mixAnalysis() {
    if (!PROD || PROD.k !== S.k || S.f.prod) return null;
    return mixCalc(PROD.rows, selP());
  }
  function mixCalc(prodRows, p) {
    var c = ec(), rows = prodRows.filter(function (r) { return r[c]; });
    var O1 = 0, O0 = 0, G1 = 0, G0 = 0, S1 = 0, S0 = 0, B1 = 0, B0 = 0, tOk = true;
    rows.forEach(function (r) {
      var cr = r.cur.r, br = r[c].r, ct = r.cur.t, bt = r[c].t;
      if (cr) { O1 += cr[0]; G1 += cr[1]; } if (br) { O0 += br[0]; G0 += br[1]; }
      if (ct) { S1 += ct[1]; B1 += ct[5]; } if (bt) { S0 += bt[1]; B0 += bt[5]; }
      if ((ct && ct[1] > 0) !== (bt && bt[1] > 0) && ((ct && ct[1] > 1000) || (bt && bt[1] > 1000))) tOk = tOk && !!(ct && bt);
    });
    if (!(O1 > 0) || !(O0 > 0)) return null;
    var base = p[c], hasT = !!(p.cur.t && base && base.t && S1 > 0 && S0 > 0);
    var items = rows.map(function (r) {
      var cr = r.cur.r || [0, 0], br = r[c].r || [0, 0], ct = r.cur.t, bt = r[c].t;
      return { k: r.lbl, o1: cr[0], o0: br[0], w1: cr[0] / O1, w0: br[0] / O0, a1: cr[0] > 0 ? cr[1] / cr[0] : null, a0: br[0] > 0 ? br[1] / br[0] : null,
        s1: ct ? ct[1] : 0, s0: bt ? bt[1] : 0, cv1: ct && ct[1] > 0 ? ct[5] / ct[1] : null, cv0: bt && bt[1] > 0 ? bt[5] / bt[1] : null };
    });
    var tk1 = G1 / O1, tk0 = G0 / O0, tk = split(items);
    var out = { items: items, tk1: tk1, tk0: tk0, tkMix: tk.mix, tkPrice: tk.within, hasT: hasT };
    if (hasT) {
      var ci = items.map(function (x) { return { w1: x.s1 / S1, w0: x.s0 / S0, a1: x.cv1, a0: x.cv0 }; });
      var cv = split(ci), cr1 = p.cur.t[5] / p.cur.t[1], cr0 = base.t[5] / base.t[1];
      out.cr1 = cr1; out.cr0 = cr0; out.cvMix = cv.mix; out.cvWithin = cv.within; out.cvOther = (cr1 - cr0) - cv.mix - cv.within;   // bookings sin búsqueda de producto
    }
    return out;
  }
  function mixVerdict(mx) {
    if (!mx) return null;
    var tkD = (mx.tk1 / mx.tk0 - 1) * 100, mixPct = mx.tkMix / mx.tk0 * 100;
    var byW = mx.items.filter(function (x) { return x.o1 + x.o0 > 0; }).map(function (x) { return { k: x.k, dw: (x.w1 - x.w0) * 100, a: x.a1 != null ? x.a1 : x.a0 }; }).sort(function (a, b) { return b.dw - a.dw; });
    var gana = byW[0], pierde = byW[byW.length - 1];
    var mov = gana && pierde && gana.dw > 0.5 ? ' Gana peso <b>' + esc(gana.k.toLowerCase()) + '</b> (' + sgn(gana.dw, 1) + ' pp de las orders, ticket $' + num(gana.a, 0) + ') y pierde <b>' + esc(pierde.k.toLowerCase()) + '</b> (' + sgn(pierde.dw, 1) + ' pp, ticket $' + num(pierde.a, 0) + ').' : '';
    var cvTxt = mx.hasT ? 'la conversión ' + (Math.abs((mx.cr1 - mx.cr0) * 100) < 0.05 ? 'se sostiene' : (mx.cr1 > mx.cr0 ? 'sube' : 'baja')) + ' (' + dtxt({ v: (mx.cr1 - mx.cr0) * 100, pp: true }) + '; dentro de cada producto ' + dtxt({ v: mx.cvWithin * 100, pp: true }) + ', por mix de búsquedas ' + dtxt({ v: mx.cvMix * 100, pp: true }) + ')' : 'la conversión no se puede comparar en este período';
    var tkTxt = 'el ticket ' + dtxt({ v: tkD, pp: false }) + ' (mix ' + (mx.tkMix >= 0 ? '+$' : '−$') + num(Math.abs(mx.tkMix), 0) + ' por order, precio dentro de cada producto ' + (mx.tkPrice >= 0 ? '+$' : '−$') + num(Math.abs(mx.tkPrice), 0) + ')';
    var head;
    var held = mx.hasT && (mx.cr1 - mx.cr0) * 100 > -0.05, mixDown = mixPct <= -1, mixUp = mixPct >= 1;
    if (held && mixDown) head = '<b>Sí: mantenemos la conversión pero con productos de menor ticket.</b> ';
    else if (mixDown) head = '<b>El mix se corre a productos de menor ticket.</b> ';
    else if (mixUp) head = '<b>El mix se corre a productos de mayor ticket.</b> ';
    else head = '<b>El mix de productos casi no mueve el ticket.</b> ';
    return head + 'Mix: ' + cvTxt + '; ' + tkTxt + '.' + mov;
  }
  function renderMix() {
    var box = document.getElementById('tk-mix'); if (!box) return;
    if (S.f.prod) { box.innerHTML = '<div class="na">Con un producto filtrado no hay mix: sacá el filtro de producto para verlo.</div>'; return; }
    var mx = mixAnalysis();
    if (!mx) { box.innerHTML = PROD ? '<div class="na">Sin base para comparar el mix ' + esc(ecLbl()) + '.</div>' : '<div class="tk-load">Cargando…</div>'; return; }
    var c = ec(), rows = mx.items.filter(function (x) { return x.o1 + x.o0 + x.s1 + x.s0 > 0; }).sort(function (a, b) { return b.o1 - a.o1; }), cmpct = S.view === 'pais';
    if (cmpct) rows = rows.slice(0, 6);
    var S1 = rows.reduce(function (a, x) { return a + x.s1; }, 0), S0 = rows.reduce(function (a, x) { return a + x.s0; }, 0);
    var pp = function (v) { return dtxt({ v: v, pp: true }); };
    var head = '<tr><th class="l">Producto</th>' + (cmpct ? '' : '<th>Share búsquedas</th>') + '<th>Conversión</th><th>Share orders</th><th>Ticket</th><th>Ticket: mix</th><th>… precio</th></tr>';
    var body = rows.map(function (x) {
      var a0 = x.a0 != null ? x.a0 : x.a1, a1 = x.a1 != null ? x.a1 : x.a0;
      var mixC = a0 != null ? (x.w1 - x.w0) * (a0 + a1) / 2 : 0, priceC = a0 != null ? (a1 - a0) * (x.w0 + x.w1) / 2 : 0;
      var sh1 = S1 ? x.s1 / S1 : null, sh0 = S0 ? x.s0 / S0 : null;
      return '<tr><td class="l k">' + esc(x.k) + '</td>' +
        (cmpct ? '' : '<td>' + (sh1 != null && x.s1 ? num(sh1 * 100, 1) + '%' : '—') + '<span class="s">' + (sh1 != null && sh0 != null && mx.hasT ? pp((sh1 - sh0) * 100) : '<span class="na">n/d</span>') + '</span></td>') +
        '<td>' + (x.cv1 != null ? num(x.cv1 * 100, 2) + '%' : '—') + '<span class="s">' + (x.cv1 != null && x.cv0 != null && mx.hasT ? pp((x.cv1 - x.cv0) * 100) : '<span class="na">n/d</span>') + '</span></td>' +
        '<td>' + num(x.w1 * 100, 1) + '%<span class="s">' + pp((x.w1 - x.w0) * 100) + '</span></td>' +
        '<td>' + (x.a1 != null ? '$' + num(x.a1, 0) : '—') + '<span class="s">' + dtxt(x.a1 != null && x.a0 ? { v: (x.a1 / x.a0 - 1) * 100, pp: false } : null) + '</span></td>' +
        '<td class="' + (mixC > 0.5 ? 'up' : mixC < -0.5 ? 'dn' : 'na') + '">' + (mixC >= 0 ? '+$' : '−$') + num(Math.abs(mixC), 0) + '</td>' +
        '<td class="' + (priceC > 0.5 ? 'up' : priceC < -0.5 ? 'dn' : 'na') + '">' + (priceC >= 0 ? '+$' : '−$') + num(Math.abs(priceC), 0) + '</td></tr>';
    }).join('');
    var tot = '<tr><td class="l k">Total</td>' + (cmpct ? '' : '<td></td>') + '<td>' + (mx.hasT ? num(mx.cr1 * 100, 2) + '%<span class="s">' + pp((mx.cr1 - mx.cr0) * 100) + '</span>' : '—') + '</td><td></td>' +
      '<td>$' + num(mx.tk1, 0) + '<span class="s">' + dtxt({ v: (mx.tk1 / mx.tk0 - 1) * 100, pp: false }) + '</span></td>' +
      '<td class="' + (mx.tkMix >= 0 ? 'up' : 'dn') + '">' + (mx.tkMix >= 0 ? '+$' : '−$') + num(Math.abs(mx.tkMix), 0) + '</td><td class="' + (mx.tkPrice >= 0 ? 'up' : 'dn') + '">' + (mx.tkPrice >= 0 ? '+$' : '−$') + num(Math.abs(mx.tkPrice), 0) + '</td></tr>';
    box.innerHTML = (cmpct ? '' : '<div class="tk-cr" style="margin:0 0 10px">' + mixVerdict(mx) + '</div>') + '<div class="tk-tw"><table class="tk-t"><thead>' + head + '</thead><tbody>' + body + tot + '</tbody></table></div>' +
      (cmpct ? '' : '<div class="sub" style="margin:8px 0 0">Δ ' + esc(ecLbl()) + '. Ticket total = Σ share de orders × ticket del producto: "mix" es lo que cambia por la composición y "precio" lo que cambia dentro de cada producto (suman exacto la variación del ticket). Lo mismo con la conversión y el share de búsquedas.' +
      (mx.hasT && Math.abs(mx.cvOther * 100) >= 0.01 ? ' Bookings sin búsqueda de producto (p.ej. "Otros"): ' + dplain({ v: mx.cvOther * 100, pp: true }) + ' de la conversión.' : '') + '</div>');
  }

  // ── Lectura: tres líneas con la conclusión ──
  var STEPS = ['Usuarios', 'Búsquedas', 'Detalle', 'PI', 'Checkout', 'Bookings'];
  function renderSummary() {
    var box = document.getElementById('tk-sum'); if (!box || !DATA) return;
    var p = selP(), c = ec(), base = p[c], met = S.bm, out = [];
    // 1) Resultado y qué lo explica
    var b = bridge(p.cur, base, met);
    if (b) {
      var d = (b.v1 / b.v0 - 1) * 100, srt = b.items.slice().sort(function (x, y) { return Math.abs(y.c) - Math.abs(x.c); });
      var pos = srt.filter(function (i) { return i.c > 0; }), neg = srt.filter(function (i) { return i.c < 0; });
      var main = d >= 0 ? pos[0] : neg[0], against = d >= 0 ? neg[0] : pos[0];
      var t = '<b>' + esc(BM[met].l) + ' ' + fmtMet(met, b.v1) + '</b>, <b class="' + (d >= 0 ? 'up' : 'dn') + '">' + sgn(d, 1) + '%</b> ' + esc(ecLbl()) + ' (' + sMet(met, b.v1 - b.v0) + ').';
      if (main) t += ' Lo explica sobre todo <b>' + esc(main.l.toLowerCase()) + '</b> (' + sMet(met, main.c) + '; ' + esc(main.ll) + ' ' + dplain(main.d) + ')';
      if (against && Math.abs(against.c) >= Math.abs(b.v1 - b.v0) * 0.15) t += ', con <b>' + esc(against.l.toLowerCase()) + '</b> en contra (' + sMet(met, against.c) + ')';
      out.push(t + '.');
    } else out.push('<span class="na">Sin base para comparar ' + esc(BM[met].l) + ' ' + esc(ecLbl()) + ' en este período.</span>');
    // 2) Funnel: el paso cuya conversión más se movió
    if (p.cur.t && base && base.t) {
      var best = null;
      for (var i = 2; i < 6; i++) {
        var c1 = rat(p.cur.t[i], p.cur.t[i - 1]), c0 = rat(base.t[i], base.t[i - 1]);
        if (c1 == null || c0 == null) continue;
        var dv = (c1 - c0) * 100;
        if (!best || Math.abs(dv) > Math.abs(best.dv)) best = { i: i, c1: c1, dv: dv };
      }
      var cr1 = rat(p.cur.t[5], p.cur.t[1]), cr0 = rat(base.t[5], base.t[1]);
      out.push('Funnel: conversión búsqueda → booking <b>' + num(cr1 * 100, 2) + '%</b> (' + dtxt({ v: (cr1 - cr0) * 100, pp: true }) + ')' +
        (best ? '; el paso que más se movió es <b>' + STEPS[best.i - 1].toLowerCase() + ' → ' + STEPS[best.i].toLowerCase() + '</b>: ' + num(best.c1 * 100, 1) + '% (' + dtxt({ v: best.dv, pp: true }) + ').' : '.'));
    } else out.push('<span class="na">Funnel: el tráfico no se puede comparar ' + esc(ecLbl()) + ' en este período (en curso, incompleto o sin base).</span>');
    // 3) Partners que suman y restan
    if (PART && PART.k === S.k) {
      var mv = PART.rows.filter(function (r) { return r.key !== 'Otros' && r.cur.r && r[c] && r[c].r; }).map(function (r) {
        return { r: r, d: BM[met].v(r.cur.r) - BM[met].v(r[c].r) };
      }).filter(function (x) { return isFinite(x.d) && Math.abs(x.d) > 0; });
      if (mv.length > 1) {
        var desc = function (x) { var md = mainDriver(x.r.cur, x.r[c], met); return '<b>' + esc(x.r.lbl) + '</b> (' + sMet(met, x.d) + (md ? ', por ' + esc(md.l) : '') + ')'; };
        var up = mv.filter(function (x) { return x.d > 0; }).sort(function (a, b2) { return b2.d - a.d; }).slice(0, 3);
        var dn = mv.filter(function (x) { return x.d < 0; }).sort(function (a, b2) { return a.d - b2.d; }).slice(0, 3);
        out.push('Partners: ' + (up.length ? 'suman ' + up.map(desc).join(', ') : 'ninguno suma') + (dn.length ? '; restan ' + dn.map(desc).join(', ') : '; ninguno resta') + '.');
      }
    } else out.push('<span class="na">Partners: calculando…</span>');
    if (!S.f.prod) { var mv2 = mixVerdict(mixAnalysis()); out.push(mv2 || (PROD ? '<span class="na">Mix de productos: sin base para comparar.</span>' : '<span class="na">Mix de productos: calculando…</span>')); }
    box.innerHTML = '<ol>' + out.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>';
  }

  // ── Puente (waterfall) ──
  function renderBridge() {
    var box = document.getElementById('tk-wf'); if (!box || !DATA) return;
    var p = selP(), met = S.bm, b = bridge(p.cur, p[ec()], met);
    var chips = ['nr', 'fvm', 'gb', 'o'].map(function (k) { return '<button type="button" data-bm="' + k + '" class="' + (S.bm === k ? 'on' : '') + '">' + esc(BM[k].l) + '</button>'; }).join('');
    if (!b) { box.innerHTML = '<div class="tk-chips">' + chips + '</div><div class="na">Sin base para armar el puente ' + esc(ecLbl()) + '.</div>'; return; }
    var mx = mixAnalysis(), its = [];
    b.items.forEach(function (i) {
      // Ticket y conversión se abren en mix / dentro de cada producto, en proporción a su descomposición (si la variación no es ~0)
      var parts = null;
      if (mx && i.k === 'tk' && Math.abs(mx.tk1 - mx.tk0) > 0.005 * mx.tk0) parts = [['Ticket · mix', mx.tkMix], ['Ticket · precio', mx.tkPrice]].map(function (q) { return [q[0], q[1] / (mx.tk1 - mx.tk0)]; });
      if (mx && mx.hasT && i.k === 'cv' && Math.abs(mx.cr1 - mx.cr0) > 0.0002) parts = [['Conversión · mix', mx.cvMix], ['Conversión · producto', mx.cvWithin + mx.cvOther]].map(function (q) { return [q[0], q[1] / (mx.cr1 - mx.cr0)]; });
      if (parts) parts.forEach(function (q) { var ab = q[0].split(' · '); its.push({ l: ab[0], s: ab[1], tip: q[0] + ' (' + i.ll + ' ' + dplain(i.d) + ' en total)', c: i.c * q[1], kind: 'd' }); });
      else its.push({ l: i.l, s: dplain(i.d), tip: i.ll + ' ' + dplain(i.d), c: i.c, kind: 'd' });
    });
    var cols = [{ l: ecBase(), v: b.v0, kind: 'base' }].concat(its).concat([{ l: S.k === 'ytd' ? 'Acumulado' : (S.gran === 'm' ? 'Este mes' : 'Esta semana'), v: b.v1, kind: 'end' }]);
    box.innerHTML = '<div class="tk-chips">' + chips + '</div><div class="tk-chart tk-wf">' + drawWF(cols, met) + '</div>' +
      '<div class="sub" style="margin:6px 0 0">' + (b.traffic ? 'Tráfico × conversión × bookings que llegan a orders × ticket' + (met === 'nr' || met === 'fvm' ? ' × take rate' : '') + (met === 'fvm' ? ' × margen' : '') :
        'Sin tráfico comparable: el puente arranca en orders.') + ' Eje cortado para que se vean los drivers. Las contribuciones suman exacto la variación (descomposición logarítmica).</div>';
  }
  // Waterfall: cols = [{ l, v, kind: 'base' }, { l, s, tip, c, kind: 'd' }…, { l, v, kind: 'end' }]
  function drawWF(cols, met) {
    var its = cols.filter(function (c) { return c.kind === 'd'; }), b = { v0: cols[0].v };
    var lv = [b.v0], acc = b.v0; its.forEach(function (i) { acc += i.c; lv.push(acc); });
    var lo = Math.min.apply(null, lv), hi = Math.max.apply(null, lv), span = (hi - lo) || hi * 0.05;
    var mn = Math.max(0, lo - span * 1.2), mx = hi + span * 0.35;   // eje cortado: si arranca en 0 los drivers no se ven
    var W = 1000, H = 300, padL = 10, padR = 10, padT = 26, padB = 52, n = cols.length, bw = (W - padL - padR) / n;
    var y = function (v) { return padT + (H - padT - padB) * (1 - (v - mn) / (mx - mn)); };
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Puente de ' + esc(BM[met].l) + '">';
    var run = b.v0;
    cols.forEach(function (col, i) {
      var x = padL + i * bw + bw * 0.18, w = bw * 0.64, cx = padL + i * bw + bw / 2, top, bot, fill, lab;
      if (col.kind !== 'd') { top = y(col.v); bot = y(mn); fill = col.kind === 'base' ? 'var(--ly)' : 'var(--primary)'; lab = fmtMet(met, col.v); }
      else { var a = run, z = run + col.c; top = y(Math.max(a, z)); bot = y(Math.min(a, z)); fill = col.c >= 0 ? 'var(--up)' : 'var(--dn)'; lab = sMet(met, col.c); run = z; }
      g += '<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1.5, bot - top).toFixed(1) + '" rx="3" fill="' + fill + '"><title>' + esc(col.l + ': ' + lab + (col.tip ? ' (' + col.tip + ')' : '')) + '</title></rect>';
      if (i < n - 1) { var yy = y(col.kind === 'd' ? run : col.v); g += '<line class="cn" x1="' + (x + w).toFixed(1) + '" x2="' + (x + bw).toFixed(1) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/>'; }
      g += '<text class="lv" x="' + cx.toFixed(1) + '" y="' + (top - 7).toFixed(1) + '">' + esc(lab) + '</text>';
      g += '<text class="lx" x="' + cx.toFixed(1) + '" y="' + (H - padB + 18) + '">' + esc(col.l === 'Bookings → orders' ? 'Book. → orders' : col.l) + '</text>';
      if (col.s) g += '<text class="ls" x="' + cx.toFixed(1) + '" y="' + (H - padB + 34) + '">' + esc(col.s) + '</text>';
    });
    return g + '</svg>';
  }

  // ── Moonshot 3x ──
  var FLAG_LBL = { trafico: 'base = tráfico web', fuente_distinta: 'base ≠ su fuente', red_tarjetas: 'red de tarjetas', sin_base: 'sin base', inferido: 'inferida' };
  function msMoney(v) { return v == null ? '—' : '$' + big(v); }
  function msX(v, hi) { return '<span class="ms-m' + (hi ? ' hi' : '') + '">' + (v >= 10 ? num(v, 0) : num(v, 1)) + 'x</span>'; }
  function msBadges(r) {
    return (r.flags || []).map(function (f) { return '<span class="ms-badge ' + (f === 'inferido' ? 'inf' : 'bad') + '">' + esc(FLAG_LBL[f] || f) + '</span>'; }).join('');
  }
  function msRows() {
    return MOON.rows.filter(function (r) { return (!MS.dir || r.director === MS.dir) && (!MS.ind || r.industria === MS.ind) && (!MS.pais || r.pais === MS.pais); });
  }
  function msTable(rows, full) {
    if (!rows.length) return '<div class="na">Sin cuentas para este filtro.</div>';
    var head = '<tr><th class="l">Partner</th><th class="l">Director</th><th>NR anual</th><th>Base</th><th>Penetración<br><span class="na" style="text-transform:none">propia · pares · p75 ind.</span></th>' +
      '<th>Alcance</th><th>Conversión</th><th>Amplitud</th><th>Realista</th><th>Moonshot</th><th>NR potencial</th><th class="l">Palanca</th></tr>';
    var body = rows.map(function (r) {
      var pen = function (v) { return v == null ? '—' : num(v, v < 10 ? 1 : 0); };
      return '<tr class="click" data-ms="' + esc(r.partner) + '" data-mp="' + esc(r.pais) + '"><td class="l k">' + esc(r.partner) + ' <span class="na">· ' + esc(cLbl(r.pais)) + '</span><span class="s na">' + esc(r.industria) + (r.topProd ? ' · ' + Math.round(r.topShare * 100) + '% ' + esc(r.topProd.toLowerCase()) : '') + '</span></td>' +
        '<td class="l">' + esc(r.director || '—') + '</td>' +
        '<td>' + msMoney(r.nr) + '</td>' +
        '<td>' + (r.clientes ? big(r.clientes) : '—') + '<span class="s">' + msBadges(r) + '</span></td>' +
        '<td>' + pen(r.pen) + '<span class="s na">' + pen(r.penPeer) + ' · ' + pen(r.penP75) + '</span></td>' +
        '<td>' + num(r.reachR, 1) + 'x<span class="s na">' + num(r.reachM, 1) + 'x</span></td>' +
        '<td>+' + msMoney(r.convR) + '<span class="s na">+' + msMoney(r.convM) + '</span></td>' +
        '<td>+' + msMoney(r.xsR) + '<span class="s na">+' + msMoney(r.xsM) + '</span></td>' +
        '<td>' + msX(r.multR, r.multR >= 3) + '</td><td>' + msX(r.multM, r.multM >= 3) + '</td>' +
        '<td>+' + msMoney(r.potR) + '<span class="s na">+' + msMoney(r.potM) + '</span></td>' +
        '<td class="l">' + esc(r.lever || '—') + '</td></tr>';
    }).join('');
    return '<div class="tk-tw"><table class="tk-t ms-t"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      (full ? '<div class="sub" style="margin:8px 0 0">Arriba el escenario realista, abajo (gris) el moonshot. Clic en una fila para abrir esa cuenta en Detalle.</div>' : '');
  }
  function msChart(rows) {
    var pts = rows.filter(function (r) { return r.nr > 0 && r.multM >= 1; });
    if (!pts.length) return '<div class="na">Sin cuentas.</div>';
    var W = 1000, H = 420, padL = 56, padR = 20, padT = 16, padB = 40;
    var xs = pts.map(function (r) { return Math.log10(r.nr); }), x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var yMax = Math.max(4, Math.min(100, Math.max.apply(null, pts.map(function (r) { return r.multM; })))), ly1 = Math.log10(yMax * 1.15);
    var x = function (v) { return padL + (W - padL - padR) * (Math.log10(v) - x0) / ((x1 - x0) || 1); };
    var y = function (v) { return padT + (H - padT - padB) * (1 - Math.log10(Math.min(v, yMax)) / ly1); };
    var cmax = Math.max.apply(null, pts.map(function (r) { return r.clientes || 0; })) || 1, rad = function (c) { return 5 + 24 * Math.sqrt((c || 0) / cmax); };
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="NR actual contra multiplicador potencial">';
    [1, 2, 3, 5, 10, 20, 50, 100].filter(function (v) { return v <= yMax * 1.15; }).forEach(function (v) {
      g += '<line class="gl" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ax" x="' + (padL - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + v + 'x</text>';
    });
    for (var e = x0; e <= x1; e++) { var xx = x(Math.pow(10, e)); g += '<line class="gl" x1="' + xx + '" x2="' + xx + '" y1="' + padT + '" y2="' + (H - padB) + '"/><text class="ax" x="' + xx + '" y="' + (H - padB + 14) + '" text-anchor="middle">$' + big(Math.pow(10, e)) + '</text>'; }
    g += '<line class="ms-3x" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(3) + '" y2="' + y(3) + '"/><text class="ms-3t" x="' + (W - padR) + '" y="' + (y(3) - 5) + '" text-anchor="end">3x</text>';
    g += '<text class="axt" x="' + (W - padR) + '" y="' + (H - 6) + '" text-anchor="end">NR anual actual →</text><text class="axt" x="' + padL + '" y="' + (padT - 4) + '">Multiplicador moonshot (tamaño = base de clientes)</text>';
    pts.slice().sort(function (a, b) { return (b.clientes || 0) - (a.clientes || 0); }).forEach(function (r) {
      var cls = r.cand ? 'ms-c' : 'ms-o', cx = x(r.nr), cy = y(r.multM), rr = rad(r.clientes);
      g += '<circle class="' + cls + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + rr.toFixed(1) + '"><title>' + esc(r.partner + ' · ' + cLbl(r.pais) + '\nNR anual: $' + big(r.nr) + '\nMultiplicador realista ' + num(r.multR, 1) + 'x · moonshot ' + num(r.multM, 1) + 'x\nPalanca: ' + (r.lever || '—') + (r.clientes ? '\nBase: ' + big(r.clientes) : '') + (r.validar ? '\nA validar: ' + r.flags.join(', ') : '')) + '</title></circle>';
      if (r.validar) g += '<circle class="ms-v" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (rr + 3).toFixed(1) + '"/>';
    });
    var placed = [];
    pts.filter(function (r) { return r.cand || r.nr >= 3e6; }).sort(function (a, b) { return y(a.multM) - y(b.multM); }).forEach(function (r) {
      var t = r.partner + (COUNTRIES.some(function (c) { return c[0] === r.pais; }) ? ' ' + cLbl(r.pais).slice(0, 2).toUpperCase() : ''), w = t.length * 6.3;
      var cx = x(r.nr), rr = rad(r.clientes), right = cx + rr + 3 + w <= W - padR, x0b = right ? cx + rr + 3 : cx - rr - 3 - w, yy = y(r.multM) + 4;
      for (var k = 0; k < 6 && placed.some(function (q) { return x0b < q.x1 && x0b + w > q.x0 && Math.abs(yy - q.y) < 12; }); k++) yy += 12;
      placed.push({ x0: x0b, x1: x0b + w, y: yy });
      g += '<text class="bl" x="' + (right ? x0b : x0b + w).toFixed(1) + '" y="' + yy.toFixed(1) + '"' + (right ? '' : ' text-anchor="end"') + '>' + esc(t) + '</text>';
    });
    return '<div class="tk-lg"><span><i style="background:var(--primary);opacity:.6"></i>Candidato a 3x</span><span><i style="background:var(--ly);opacity:.5"></i>Resto</span><span><i style="background:none;box-shadow:inset 0 0 0 1.5px var(--dn)"></i>Base a validar</span></div><div class="tk-chart">' + g + '</svg></div>';
  }
  function renderMoon() {
    var body = document.getElementById('tk-body'); if (!MOON) return;
    var rows = msRows(), big5 = rows.filter(function (r) { return r.nr >= MOON.minNr; });
    var cand = big5.filter(function (r) { return r.cand; }), rest = big5.filter(function (r) { return !r.cand && !r.validar; }), val = rows.filter(function (r) { return r.validar && r.nr >= 100000; });
    var opts = function (vals, cur, lbl) { return '<option value="">' + lbl + '</option>' + vals.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(cLbl(v)) + '</option>'; }).join(''); };
    var uniq = function (f) { var o = {}; MOON.rows.forEach(function (r) { if (r[f]) o[r[f]] = 1; }); return Object.keys(o).sort(); };
    var potC = cand.reduce(function (a, r) { return a + r.potR; }, 0), potCM = cand.reduce(function (a, r) { return a + r.potM; }, 0), nrC = cand.reduce(function (a, r) { return a + r.nr; }, 0);
    body.innerHTML = '<div class="op"><div class="op-head"><h2>Moonshot 3x</h2><span class="sub">¿Con qué partner pensamos en triplicar? · ' + esc(MOON.fy) + ' (' + esc(MOON.from.slice(8, 10) + '/' + MOON.from.slice(5, 7)) + ' a ' + esc(MOON.to.slice(8, 10) + '/' + MOON.to.slice(5, 7)) + ') anualizado</span><button type="button" class="pr" id="tk-print">Imprimir / PDF</button></div>' +
      '<div class="ms-f"><div class="tk-f"><label>Director</label><select id="ms-dir">' + opts(uniq('director'), MS.dir, 'Todos') + '</select></div>' +
      '<div class="tk-f"><label>Industria</label><select id="ms-ind">' + opts(uniq('industria'), MS.ind, 'Todas') + '</select></div>' +
      '<div class="tk-f"><label>País</label><select id="ms-pais">' + opts(uniq('pais'), MS.pais, 'Todos') + '</select></div></div>' +
      '<div class="op-row"><div class="tk-card tk-sum"><ol>' +
      '<li><b>' + cand.length + ' cuentas</b> con techo de 3x o más (NR anual ≥ $' + big(MOON.minNr) + ', base sin marcas): hoy <b>$' + big(nrC) + '</b> de NR anual; potencial <b>+$' + big(potC) + '</b> realista y <b>+$' + big(potCM) + '</b> moonshot.</li>' +
      (cand[0] ? '<li>La más grande: <b>' + esc(cand[0].partner + ' ' + cLbl(cand[0].pais)) + '</b> — ' + num(cand[0].pen || 0, 1) + ' orders por año cada 1.000 clientes contra ' + num(cand[0].penP75 || 0, 1) + ' del p75 de su industria; palanca: <b>' + esc(cand[0].lever || '—') + '</b>.</li>' : '') +
      '<li>Alcance = penetración de la base (orders por año cada 1.000 clientes); conversión y amplitud contra pares del país. Realista: medianas con topes; moonshot: p75 (alcance hasta ' + MOON.reachCap + 'x, conversión hasta ' + MOON.convCap + 'x la propia).</li>' +
      '<li><span class="dn">Bases de clientes provisorias</span> (' + esc(MOON.bases.fuente || '') + ', ' + MOON.bases.n + ' bases): ' + esc(MOON.bases.nota || '') + '</li></ol></div>' +
      '<div class="tk-card"><h3>Cómo leerlo</h3><div class="sub" style="font-size:13.5px;line-height:1.6">Cada burbuja es una cuenta (partner × país). Arriba de la línea naranja, el techo combinado de las tres palancas triplica o más el NR de hoy. ' +
      'El tamaño es la base de clientes del partner. Es un techo, no un forecast: sirve para elegir dónde pensar en grande y con qué palanca (alcance = llegar a más clientes de la base; conversión = que compren los que buscan; amplitud = venderles más productos).</div></div></div>' +
      '<div class="op-row one"><div class="tk-card"><h3>NR actual vs multiplicador potencial</h3>' + msChart(big5.concat(val.filter(function (r) { return r.nr < MOON.minNr; }))) + '</div></div>' +
      '<div class="op-row one"><div class="tk-card"><h3>Candidatos a 3x</h3>' + msTable(cand, true) + '</div></div>' +
      '<div class="op-row one"><div class="tk-card"><h3>Resto de las cuentas grandes</h3>' + msTable(rest, false) + '</div></div>' +
      '<div class="op-row one"><div class="tk-card"><h3>A validar</h3><div class="sub">Cuentas cuya base de clientes no se puede usar todavía (es tráfico web, no coincide con su fuente, es una red de tarjetas o falta). Su multiplicador no es confiable hasta corregir la base.</div>' + msTable(val, false) + '</div></div></div>';
  }

  // ── Portada (consolidado) ──
  function shortMix(mx) {
    if (!mx) return '<span class="na">—</span>';
    var pct = mx.tkMix / mx.tk0 * 100, txt = pct <= -1 ? 'a menor ticket' : pct >= 1 ? 'a mayor ticket' : 'estable';
    return esc(txt) + ' <span class="' + (pct <= -1 ? 'dn' : pct >= 1 ? 'up' : 'na') + '">' + (mx.tkMix >= 0 ? '+$' : '−$') + num(Math.abs(mx.tkMix), 0) + '/order</span>';
  }
  function topMover(part, met, c) {
    if (!part) return null;
    var mv = part.rows.filter(function (r) { return r.key !== 'Otros' && r.cur.r && r[c] && r[c].r; })
      .map(function (r) { return { r: r, d: BM[met].v(r.cur.r) - BM[met].v(r[c].r) }; }).filter(function (x) { return isFinite(x.d); })
      .sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    return mv[0] || null;
  }
  function renderPortada() {
    var wf = document.getElementById('tk-cwf'), tb = document.getElementById('tk-cty');
    if (!wf || !tb) return;
    if (!CT) { wf.innerHTML = tb.innerHTML = '<div class="tk-load">Cargando países…</div>'; return; }
    var c = ec(), met = S.bm, p = selP(), main = COUNTRIES.map(function (x) { return x[0]; });
    var byK = {}; CT.rows.forEach(function (r) { byK[r.key] = r; });
    var dv = function (r) { return r && r.cur.r && r[c] && r[c].r ? BM[met].v(r.cur.r) - BM[met].v(r[c].r) : null; };
    // Puente por país: base → aporte de cada país → actual (el resto de los países, junto)
    if (p.cur.r && p[c] && p[c].r) {
      var v0 = BM[met].v(p[c].r), v1 = BM[met].v(p.cur.r), sum = 0, cols = [{ l: ecBase(), v: v0, kind: 'base' }];
      main.forEach(function (k) { var d = dv(byK[k]); if (d == null) return; sum += d; cols.push({ l: cLbl(k), s: dplain(delta(met === 'o' ? 'o' : met, BM[met].v(byK[k].cur.r), BM[met].v(byK[k][c].r))), c: d, kind: 'd' }); });
      cols.push({ l: 'Resto', s: 'otros países', c: (v1 - v0) - sum, kind: 'd' });
      cols.push({ l: S.k === 'ytd' ? 'Acumulado' : (S.gran === 'm' ? 'Este mes' : 'Esta semana'), v: v1, kind: 'end' });
      var chips = ['nr', 'fvm', 'gb', 'o'].map(function (k) { return '<button type="button" data-bm="' + k + '" class="' + (S.bm === k ? 'on' : '') + '">' + esc(BM[k].l) + '</button>'; }).join('');
      wf.innerHTML = '<div class="tk-chips">' + chips + '</div><div class="tk-chart tk-wf">' + drawWF(cols, met) + '</div>';
    } else wf.innerHTML = '<div class="na">Sin base para comparar ' + esc(ecLbl()) + '.</div>';
    // Una fila por país
    var head = '<tr><th class="l">País</th><th>NR</th><th>FVM</th><th>Orders</th><th>Conversión</th><th>Ticket</th><th class="l">Qué lo explica</th><th class="l">Mix de productos</th><th class="l">Partner que más mueve</th></tr>';
    var cell = function (m, r) { var a = val(m, r.cur); return '<td>' + fmt(m, a) + '<span class="s">' + dtxt(delta(m, a, val(m, r[c]))) + '</span></td>'; };
    var body = main.filter(function (k) { return byK[k]; }).map(function (k) {
      var r = byK[k], det = CT.det[k] || {}, md = r[c] ? mainDriver(r.cur, r[c], met) : null;
      var mx = det.prod ? mixCalc(det.prod.rows, r) : null, tm = topMover(det.part, met, c);
      return '<tr class="click" data-cty="' + esc(k) + '"><td class="l k">' + esc(cLbl(k)) + ' →</td>' + cell('nr', r) + cell('fvm', r) + cell('o', r) + cell('cr', r) + cell('tk', r) +
        '<td class="l tk-drv">' + (md ? esc(md.l) + ' <span class="' + (md.c >= 0 ? 'up' : 'dn') + '">' + sMet(met, md.c) + '</span>' : '<span class="na">—</span>') + '</td>' +
        '<td class="l tk-drv">' + shortMix(mx) + '</td>' +
        '<td class="l tk-drv">' + (tm ? esc(tm.r.lbl) + ' <span class="' + (tm.d >= 0 ? 'up' : 'dn') + '">' + sMet(met, tm.d) + '</span>' : '<span class="na">—</span>') + '</td></tr>';
    }).join('');
    var tot = '<tr><td class="l k">Total B2B2C</td>' + cell('nr', p) + cell('fvm', p) + cell('o', p) + cell('cr', p) + cell('tk', p) + '<td colspan="3"></td></tr>';
    tb.innerHTML = '<div class="tk-tw"><table class="tk-t tk-cty"><thead>' + head + '</thead><tbody>' + body + tot + '</tbody></table></div>' +
      '<div class="sub" style="margin:8px 0 0">Δ ' + esc(ecLbl()) + '. "Qué lo explica" y "Partner que más mueve" sobre ' + esc(BM[met].l) + '. Clic en un país para abrir su one pager.</div>';
  }

  // ── Apertura ──
  var BDM = ['s', 'cr', 'o', 'gb', 'nr', 'fvm'];
  function renderBd() {
    var box = document.getElementById('tk-bd'); if (!box || !BD) return;
    var noRes = BD.dim === 'plat', ms = noRes ? ['u', 's', 'c', 'b', 'cr'] : BDM, cs = BD.k === 'ytd' ? ['ly'] : ['ly', 'tr', 'pv'];
    var head = '<tr><th class="l">' + FL[BD.dim] + '</th>' + ms.map(function (m) { return '<th>' + esc(M[m].l) + '</th>'; }).join('') + '</tr>';
    var body = BD.rows.map(function (r) {
      return '<tr class="click" data-v="' + esc(r.key) + '"><td class="l k">' + esc(r.lbl) + '</td>' + ms.map(function (m) {
        var a = val(m, r.cur);
        return '<td>' + fmt(m, a) + '<span class="s">' + cs.map(function (c) { return '<i>' + cmpShort(c) + '</i> ' + dtxt(delta(m, a, val(m, r[c]))); }).join(' ') + '</span></td>';
      }).join('') + '</tr>';
    }).join('');
    box.innerHTML = BD.rows.length ? '<div class="tk-tw"><table class="tk-t"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' : '<div class="na">Sin filas para este filtro.</div>';
  }

  function renderAll() {
    renderBar();
    var p = selP(), body = document.getElementById('tk-body');
    if (!p) { body.innerHTML = '<div class="tk-err">Sin datos.</div>'; return; }
    if (S.view !== 'detalle') {
      var ptxt = esc(p.lbl) + (p.partial ? ' (en curso)' : '');
      var headOp = function (title) { return '<div class="op-head"><h2>' + title + '</h2><span class="sub">' + ptxt + ' · ' + esc(ecLbl()) + ' · gestional del Daily y tráfico de las WLs</span><button type="button" class="pr" id="tk-print">Imprimir / PDF</button></div>'; };
      var kp = '<div class="tk-card"><h3>Resultados</h3>' + kpis(p) + '</div>';
      if (S.view === 'pais') {
        body.innerHTML = '<div class="op">' + headOp('B2B2C ' + esc(cLbl(S.f.pais))) +
          '<div class="op-row"><div class="tk-card tk-sum" id="tk-sum"></div>' + kp + '</div>' +
          '<div class="op-row"><div class="tk-card"><h3>Puente ' + esc(ecLbl()) + '</h3><div id="tk-wf"></div></div>' + funnel(p, true) + '</div>' +
          '<div class="op-row even"><div class="tk-card"><h3>Top partners</h3><div id="tk-rank"></div></div><div class="tk-card"><h3>Mix de productos</h3><div id="tk-mix"></div></div></div></div>';
        renderSummary(); renderBridge(); renderRank(); renderMix();
      } else {
        body.innerHTML = '<div class="op">' + headOp('B2B2C · Portada') +
          '<div class="op-row"><div class="tk-card tk-sum" id="tk-sum"></div>' + kp + '</div>' +
          '<div class="op-row one"><div class="tk-card"><h3>Puente por país ' + esc(ecLbl()) + '</h3><div class="sub">Cuánto aporta cada país a la variación del total.</div><div id="tk-cwf"></div></div></div>' +
          '<div class="op-row one"><div class="tk-card"><h3>Países</h3><div id="tk-cty"></div></div></div></div>';
        renderSummary(); renderPortada();
      }
      return;
    }
    var tabs = FD.map(function (d) { return '<button type="button" data-dim="' + d + '" class="' + (S.dim === d ? 'on' : '') + '">' + FL[d] + '</button>'; }).join('');
    var periodTxt = esc(p.lbl) + (p.partial ? ' (en curso, comparado a igualdad de días)' : '');
    var cmpTxt = p.ytd ? 'vs LY = mismo tramo del año pasado (el mes en curso cortado al mismo día).'
      : 'vs LY = ' + mismo() + ' del año pasado · vs tend. = ' + tendLbl() + ' · vs ant. = ' + (S.gran === 'm' ? 'mes anterior' : 'semana anterior') + '.';
    body.innerHTML =
      '<section class="tk-sec"><h2>Lectura · ' + periodTxt + ' ' + esc(ecLbl()) + '</h2><div class="sub">Qué pasó, qué lo explica y quién lo mueve. Cambiá "Comparar contra" arriba para leerlo contra otra base.</div>' +
      '<div class="tk-card tk-sum" id="tk-sum"></div>' +
      '<div class="tk-card" style="margin-top:14px"><h3>Puente ' + esc(ecLbl()) + '</h3><div class="sub">Cuánto aporta cada driver a la variación.</div><div id="tk-wf"></div></div>' +
      '<div class="tk-card" style="margin-top:14px"><h3>Mix de productos ' + esc(ecLbl()) + '</h3><div class="sub">¿La conversión y el ticket se mueven por lo que vendemos (mix) o por cómo le va a cada producto?</div><div id="tk-mix"></div></div></section>' +
      '<section class="tk-sec"><h2>Resultados · ' + periodTxt + '</h2><div class="sub">Gestional del Daily (nominal). ' + cmpTxt + '</div>' + kpis(p) + '</section>' +
      '<section class="tk-sec"><h2>Funnel de tráfico · ' + periodTxt + '</h2><div class="sub">Usuarios únicos por ' + per() + ' en cada paso (usuarios-semana). Las conversiones se comparan en puntos porcentuales.</div>' + funnel(p) + '</section>' +
      '<section class="tk-sec"><h2>Evolutivo</h2><div class="sub">Clic en una barra para ver ' + (S.gran === 'm' ? 'ese mes' : 'esa semana') + ' en el resto de la página.</div>' + chart() + '</section>' +
      '<section class="tk-sec"><h2>Partners · ' + periodTxt + '</h2><div class="sub">Quién trae el volumen y quién convierte.</div>' + partnersShell() + '</section>' +
      '<section class="tk-sec"><h2>Apertura · ' + periodTxt + '</h2><div class="sub">LY = año pasado · T = tendencia · A = período anterior. Clic en una fila para filtrar por ella.</div><div class="tk-chips">' + tabs + '</div><div class="tk-card" id="tk-bd"></div></section>';
    renderBd(); renderPartners(); renderBridge(); renderMix();
  }

  // ── Eventos ──
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.f) { if (t.value) S.f[t.dataset.f] = t.value; else delete S.f[t.dataset.f]; load(); }
    else if (t.id === 'tk-k') { S.k = t.value; renderAll(); loadPeriod(); }
    else if (t.id === 'ms-dir' || t.id === 'ms-ind' || t.id === 'ms-pais') { MS[t.id.slice(3)] = t.value; renderMoon(); syncUrl(); }
    else if (t.classList.contains('tk-win')) { S.win = +t.value === 26 ? 0 : +t.value; renderAll(); syncUrl(); }
  });
  root.addEventListener('click', function (e) {
    var b = e.target.closest('button, rect.bar, tr.click');
    if (!b) return;
    if (b.dataset.view) {
      S.view = b.dataset.view;
      if (S.view === 'pais') S.f = { pais: b.dataset.c }; else if (S.view === 'portada') S.f = {};
      load();
    }
    else if (b.id === 'tk-print') { window.print(); }
    else if (b.tagName === 'TR' && b.dataset.ms) { S.view = 'detalle'; S.f = { partner: b.dataset.ms, pais: b.dataset.mp }; load(); window.scrollTo(0, 0); }
    else if (b.tagName === 'TR' && b.dataset.cty) { S.view = 'pais'; S.f = { pais: b.dataset.cty }; load(); window.scrollTo(0, 0); }
    else if (b.dataset.gran) { if (b.dataset.gran !== S.gran) { S.gran = b.dataset.gran; S.k = ''; S.win = 0; load(); } }
    else if (b.id === 'tk-clear') { S.f = {}; load(); }
    else if (b.id === 'tk-more') { S.all = !S.all; renderRank(); }
    else if (b.dataset.met) { S.met = b.dataset.met; renderAll(); syncUrl(); }
    else if (b.dataset.cmp) { S.cmp = b.dataset.cmp; renderAll(); syncUrl(); }
    else if (b.dataset.pm) { S.pm = b.dataset.pm; renderAll(); syncUrl(); }
    else if (b.dataset.bm) { S.bm = b.dataset.bm; renderAll(); syncUrl(); }
    else if (b.dataset.dim) { S.dim = b.dataset.dim; renderAll(); loadPeriod(); }
    else if (b.tagName === 'rect' && b.dataset.k) { S.k = b.dataset.k; renderAll(); loadPeriod(); }
    else if (b.tagName === 'TR' && b.dataset.pk) { S.f.partner = b.dataset.pk; load(); }
    else if (b.tagName === 'TR' && BD) { S.f[BD.dim] = b.dataset.v; if (S.dim === BD.dim) S.dim = BD.dim === 'region' ? 'pais' : BD.dim === 'pais' ? 'partner' : 'prod'; load(); }
  });
  load();
})();`;

function trackerPage({ basePath }) {
  const back = `<a class="back" href="${escapeHtml(basePath)}/">${CHEVRON_L} B2B Ecosystem</a>`;
  const cfg = JSON.stringify({ api: `${basePath}/b2b2c-tracker/data` }).replace(/</g, '\\u003c');
  return shell(`${CSS}<div id="tk-root">
    <div class="tk-hero">
      <h1>B2B2C Tracker</h1>
      <p>Las WLs semana a semana y mes a mes: funnel de tráfico, partners y resultados gestionales, contra el año pasado, la tendencia y el período anterior.</p>
    </div>
    <div class="tk-bar" id="tk-bar"></div>
    <div id="tk-body"><div class="tk-load">Cargando…</div></div>
    <ul class="tk-notes">
      <li><b>Tráfico</b>: data.analytics.b2b_partners_agg_weekly_traffic (semana ISO, lunes a domingo; la misma fuente que el tablero de tráfico de Brasil, card 142410). Usuarios únicos por semana en cada paso: al sumar productos, plataformas o semanas un usuario puede contarse más de una vez ("usuarios-semana"); las conversiones sí se comparan bien. El embudo usa escala logarítmica para que se vean todos los pasos: los números van escritos.</li>
      <li><b>Bookings vs orders</b>: los bookings del tráfico son transacciones (no compradores únicos) y quedan por encima de las orders del Daily (15% a 40% según el partner). La conversión del funnel usa bookings; los resultados, orders.</li>
      <li><b>Resultados</b>: el Daily B2B2C (orders, GB, NR y FVM gestionales, nominales, sin Organic). La plataforma solo existe en el tráfico: filtrarla no cambia los resultados.</li>
      <li><b>Tráfico incompleto</b>: la tabla de tráfico tiene semanas con días sin cargar (p.ej. oct–nov 2025). Si los bookings del tráfico quedan muy por debajo de las orders del Daily, ese período se marca (rayado) y queda fuera de las comparaciones del funnel.</li>
      <li><b>Comparaciones</b>: tendencia semanal = promedio de las 4 semanas anteriores; mensual = de los 3 meses anteriores. El período en curso se compara a igualdad de días (LY, tendencia y período anterior cortados en el mismo día). Acumulado = año fiscal desde abril; su tráfico, hasta el último mes cerrado.</li>
      <li><b>Pasos del funnel</b>: vienen tal cual de la tabla. Checkout puede superar a PI (la tabla cuenta usuarios en cada paso por separado): a revisar con Producto B2B2C.</li>
      <li><b>País</b>: en el tráfico es el país de navegación; en el Daily, el del partner. Los partners que venden por API (p.ej. Livelo-API) tienen resultados pero no tráfico.</li>
    </ul>
  </div>
  <script>window.TK_CFG = ${cfg};</script>
  <script>${SCRIPT}</script>`, { title: 'B2B2C Tracker · B2B Ecosystem', left: back });
}

module.exports = { trackerPage };
