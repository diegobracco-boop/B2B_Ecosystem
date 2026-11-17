// "Embudo B2B" (2026-11-17, Diego): página para seguir semana a semana / mes a mes qué pasa con lo que vende B2B (vendido →
// cancelado / pendiente / confirmado → reconocido / a reconocer) y por qué el GD y el RI del Daily no coinciden en un mismo mes.
// Los números los arma server/embudo-b2b.js (GET <base>/embudo-b2b/data); acá solo se dibuja. Estado en la URL
// (?pais=&canal=&producto=&desde=&hasta=&mes=) para poder compartir una vista.
const { shell, escapeHtml } = require('./index-page');

const CSS = `<style>
  .wrap { max-width: 1360px; }
  .eb-home { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 8px; border: 1px solid currentColor; font-size: 12px; font-weight: 600; text-decoration: none; color: var(--text); opacity: .8; }
  .eb-home:hover { opacity: 1; }
  :root { --up: #1db37a; --dn: #f0616d; --warn: #f5a524; --muted: #6b6b80; --ref: #8a8aa3;
    --c1: #3987e5; --c2: #d95926; --c3: #199e70; --c4: #c98500; --c5: #d55181; --c6: #9085e9; }
  :root[data-theme="light"] { --up: #0f8a5f; --dn: #d93a46; --warn: #d98a00; --muted: #b4b4bd; --ref: #8e8e93;
    --c1: #2a78d6; --c2: #eb6834; --c3: #1baf7a; --c4: #eda100; --c5: #e87ba4; --c6: #6250d6; }
  .eb-hero h1 { font-size: clamp(30px, 4.6vw, 44px); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; text-wrap: balance; }
  .eb-hero p { margin-top: 8px; color: var(--text-2); font-size: 15px; max-width: 80ch; }
  .eb-wip { display: inline-block; vertical-align: middle; margin-left: 12px; padding: 3px 10px; border-radius: 999px; font-size: 13px; font-weight: 700;
    letter-spacing: .08em; color: #8a5a00; background: #ffe7a8; box-shadow: inset 0 0 0 1px #f0c040; }
  .eb-bar { position: sticky; top: 0; z-index: 4; display: flex; flex-wrap: wrap; gap: 10px; align-items: end; padding: 14px 0; margin: 18px 0 8px;
    background: var(--bg); border-bottom: 1px solid var(--line); }
  .eb-f { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .eb-f label { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: .06em; }
  .eb-f select { font: inherit; font-size: 13.5px; color: var(--text); background: var(--tile); border: 1px solid var(--line); border-radius: 9px; padding: 6px 8px; max-width: 220px; }
  .eb-clear { border: 0; background: none; color: var(--link); font: inherit; font-size: 13px; cursor: pointer; padding: 6px 4px; }
  .eb-lead { margin-top: 14px; font-size: 16px; line-height: 1.6; max-width: 90ch; }
  .eb-lead b { font-variant-numeric: tabular-nums; }
  .eb-sec { margin-top: 32px; }
  .eb-sec > h2 { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 4px; text-wrap: balance; }
  .eb-sec > .sub { font-size: 13.5px; color: var(--text-2); margin-bottom: 14px; max-width: 90ch; }
  .eb-card { background: var(--tile); border-radius: 18px; padding: 16px clamp(12px, 2vw, 20px); box-shadow: inset 0 0 0 1px var(--line); min-width: 0; }
  .eb-note { font-size: 12.5px; color: var(--text-3); margin-top: 12px; max-width: 100ch; }
  .eb-tr { position: relative; height: 24px; }
  .eb-b { position: absolute; top: 0; bottom: 0; border-radius: 4px; min-width: 2px; }
  .eb-b.ol { background: transparent !important; border: 1.5px dashed var(--ref); }
  .eb-lg { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12.5px; color: var(--text-2); margin-bottom: 8px; align-items: center; }
  .eb-lg i { display: inline-block; width: 18px; height: 0; border-top: 2.5px solid; vertical-align: middle; margin-right: 6px; }
  .eb-lg i.d { border-top-style: dashed; }
  .eb-ch { position: relative; }
  .eb-ch svg { display: block; width: 100%; height: auto; overflow: visible; }
  .eb-ch .ax { fill: var(--text-3); font-size: 11px; }
  .eb-ch .gl { stroke: var(--line); }
  .eb-ch .ln { fill: none; stroke-width: 2.2; }
  .eb-ch .gd { stroke: var(--ref); }
  .eb-tip { position: absolute; pointer-events: none; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px;
    font-size: 12.5px; font-variant-numeric: tabular-nums; box-shadow: 0 6px 24px rgba(0,0,0,.25); z-index: 3; min-width: 200px; }
  .eb-tip b { display: block; margin-bottom: 4px; }
  .eb-tip div { display: flex; justify-content: space-between; gap: 14px; color: var(--text-2); }
  .eb-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin-bottom: 18px; }
  .eb-kpi .l { font-size: 12.5px; color: var(--text-2); }
  .eb-kpi .n { font-size: clamp(22px, 2.6vw, 28px); font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .eb-st { display: grid; grid-template-columns: minmax(130px, 170px) 1fr; gap: 10px 16px; align-items: center; }
  .eb-st .tr { display: flex; height: 28px; border-radius: 5px; overflow: hidden; }
  .eb-st .tr > div { height: 100%; }
  .eb-sl { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 6px 26px; margin-top: 14px; font-size: 13px; font-variant-numeric: tabular-nums; }
  .eb-sl div { display: flex; justify-content: space-between; gap: 10px; }
  .eb-sl i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 7px; vertical-align: -1px; }
  .eb-sl span.p { color: var(--text-3); margin-left: 6px; }
  .eb-tw { overflow-x: auto; }
  .eb-t { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  .eb-t th { text-align: right; padding: 6px 8px; font-size: 10.5px; font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: .04em; line-height: 1.25; vertical-align: bottom; }
  .eb-t th.l, .eb-t td.l { text-align: left; }
  .eb-t td { padding: 7px 8px; border-top: 1px solid var(--line); text-align: right; white-space: nowrap; }
  .eb-t td.l small { white-space: normal; max-width: 220px; }
  .eb-t tr.click { cursor: pointer; }
  .eb-t tr.click:hover td { background: var(--tile-hover); }
  .eb-t tr.tot td { font-weight: 600; border-top: 2px solid var(--line); }
  .up { color: var(--up); } .dn { color: var(--dn); }
  .eb-notes { margin-top: 34px; font-size: 12.5px; color: var(--text-3); line-height: 1.6; }
  .eb-notes li { margin-left: 18px; }
  .eb-load { color: var(--text-3); font-size: 14px; padding: 30px 0; }
  .eb-err { color: var(--dn); font-size: 14px; padding: 20px 0; }
  /* Árbol: cada columna es un nivel; el alto de cada caja es proporcional a su GB (con un mínimo para que se lea) */
  .eb-tree { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 14px; min-height: 400px; }
  .eb-tree .root { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .eb-tree .root .eb-node:first-child { flex: 1; }
  .eb-tree .brs { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .eb-tree .br { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; min-height: 62px; }
  .eb-tree .br > .eb-node { height: 100%; }
  .eb-tree .kids { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .eb-tree .kids .eb-node { flex: 1; }
  .eb-node { position: relative; border-radius: 12px; padding: 10px 12px; min-height: 62px; display: flex; flex-direction: column; justify-content: center;
    background: var(--bg); box-shadow: inset 0 0 0 1px var(--line), inset 4px 0 0 var(--nc, var(--primary)); font-variant-numeric: tabular-nums; min-width: 0; }
  .eb-node .t { font-size: 13px; color: var(--text-2); }
  .eb-node .n { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
  .eb-node .p { font-size: 12.5px; color: var(--text-3); }
  .eb-node .p b { color: var(--text); font-weight: 600; }
  .eb-node.ghost { background: transparent; box-shadow: none; min-height: 0; padding: 0; }
  .eb-node.gd { box-shadow: inset 0 0 0 1.5px var(--ref); border: 0; background: transparent; }
  .eb-node.gd::before { content: ''; position: absolute; inset: 0; border-radius: 12px; border: 1.5px dashed var(--ref); }
  .eb-tree .lbl { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
  /* Gradiente vs real */
  .eb-sum { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 16px; }
  .eb-t td.inm { color: var(--text-3); }
  .eb-t tr.inm td { background: repeating-linear-gradient(135deg, transparent 0 6px, var(--line) 6px 7px); }
  .eb-ch .bc { fill: var(--dn); }
  .eb-ch .bc.inm { fill-opacity: .4; }
  .eb-ch .bg { fill: none; stroke: var(--text); stroke-width: 2; }
  /* Cosecha */
  .eb-cos td.h { color: var(--text); }
  .eb-cos td.fut { color: var(--text-3); font-style: italic; }
  .eb-cos th, .eb-cos td { padding: 6px 6px; font-size: 12.5px; }
  .eb-seg2 { display: inline-flex; background: var(--bg); border-radius: 10px; padding: 3px; box-shadow: inset 0 0 0 1px var(--line); margin-bottom: 12px; }
  .eb-seg2 button { border: 0; background: transparent; color: var(--text-2); font: inherit; font-size: 13px; padding: 5px 12px; border-radius: 8px; cursor: pointer; }
  .eb-seg2 button.on { background: var(--primary); color: #fff; }
  .eb-pbar { display: inline-block; height: 8px; border-radius: 4px; background: var(--dn); vertical-align: middle; margin-right: 8px; }
  .eb-t td small { display: block; color: var(--text-3); font-size: 11px; }
  @media (max-width: 640px) {
    .eb-st { grid-template-columns: 1fr; }
    .eb-tree { grid-template-columns: 1fr; gap: 10px; min-height: 0; }
    .eb-tree .br { grid-template-columns: 1fr; flex: none !important; }
    .eb-tree .kids { padding-left: 16px; }
    .eb-node { flex: none !important; }
  }
</style>`;

const SCRIPT = `(function () {
  var CFG = window.EB_CFG, S = { f: {} }, D = null, seq = 0;
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var KEYS = ['pais', 'canal', 'producto', 'desde', 'hasta', 'mes'];
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mes(ym) {
    if (!ym) return '—';
    var s = MESES[+ym.slice(5, 7) - 1] + '-' + ym.slice(2, 4);
    return D && D.hasta && D.hasta.slice(0, 7) === ym && !finMes(D.hasta) ? s + ' (al ' + +D.hasta.slice(8, 10) + ')' : s;
  }
  function finMes(ds) { var d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.getUTCDate() === 1; }
  function usd(v) {
    if (v == null || isNaN(v)) return '—';
    var a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e6) return s + 'US$ ' + (a / 1e6).toFixed(1).replace('.', ',') + ' M';
    if (a >= 1e3) return s + 'US$ ' + Math.round(a / 1e3).toLocaleString('es-AR') + ' k';
    return s + 'US$ ' + Math.round(a);
  }
  function pc(v, signed) {
    if (v == null || !isFinite(v)) return '—';
    var t = Math.abs(v).toFixed(1).replace('.', ',') + '%';
    return (v < 0 ? '−' : signed && v > 0 ? '+' : '') + t;
  }

  // Estado desde la URL
  var u = new URLSearchParams(location.search);
  KEYS.forEach(function (k) { if (u.get(k)) S.f[k] = u.get(k); });
  function syncUrl() {
    var p = new URLSearchParams();
    KEYS.forEach(function (k) { if (S.f[k]) p.set(k, S.f[k]); });
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
  }

  function load() {
    var my = ++seq, p = new URLSearchParams();
    KEYS.forEach(function (k) { if (S.f[k]) p.set(k, S.f[k]); });
    fetch(CFG.api + '?' + p, { credentials: 'same-origin' }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
    }).then(function (j) {
      if (my !== seq) return;
      D = j; KEYS.forEach(function (k) { if (j.q[k]) S.f[k] = j.q[k]; else delete S.f[k]; });
      syncUrl(); render();
    }).catch(function (e) { if (my === seq) $('eb-body').innerHTML = '<div class="eb-err">No se pudo cargar el embudo: ' + esc(e.message) + '</div>'; });
  }

  function sel(id, lbl, opts, cur) {
    return '<div class="eb-f"><label for="' + id + '">' + lbl + '</label><select id="' + id + '">' +
      opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === (cur || '') ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>';
  }
  function renderBar() {
    var o = D.options, q = D.q, m = o.meses.map(function (x) { return [x, mes(x)]; });
    $('eb-bar').innerHTML =
      sel('f-pais', 'País', [['', 'Todos']].concat(o.paises.map(function (x) { return [x, x]; })), q.pais) +
      sel('f-canal', 'Canal', [['', 'HTML + API'], ['HTML', 'HTML'], ['API', 'API']], q.canal) +
      sel('f-producto', 'Producto', [['', 'Todos']].concat(o.productos.map(function (x) { return [x, x]; })), q.producto) +
      sel('f-desde', 'Vendido desde', m, q.desde) + sel('f-hasta', 'hasta', m, q.hasta) +
      ((q.pais || q.canal || q.producto) ? '<button class="eb-clear" id="eb-clear" type="button">Limpiar filtros</button>' : '');
  }

  var COL = { vendido: '--muted', cancelado: '--dn', pendiente: '--warn', confirmado: '--primary', reconocido: '--up', a_reconocer: '--c1', gd: '--ref' };
  function renderLead() {
    var e = {}; D.embudo.forEach(function (r) { e[r.k] = r; });
    var q = D.q, per = q.desde === q.hasta ? 'en ' + mes(q.desde) : 'entre ' + mes(q.desde) + ' y ' + mes(q.hasta);
    var scope = [q.pais || null, q.canal || null, q.producto || null].filter(Boolean).join(' · ');
    return '<p class="eb-lead">De lo que vendió B2B' + (scope ? ' (' + esc(scope) + ')' : '') + ' ' + per + ' (<b>' + usd(e.vendido.gb) + '</b>), ' +
      '<b class="dn">' + pc(e.cancelado.pct) + '</b> ya se canceló, <b>' + pc(e.pendiente.pct) + '</b> sigue pendiente de confirmar, ' +
      '<b class="up">' + pc(e.reconocido.pct) + '</b> ya se reconoció como ingreso (RI) y <b>' + pc(e.a_reconocer.pct) + '</b> se va a reconocer cuando viaje el pasajero. ' +
      'El Daily lo muestra por GD como <b>' + usd(e.gd.gb) + '</b> (' + pc(e.gd.pct) + ' de lo vendido).</p>';
  }
  // Árbol: lo vendido se reparte en cancelado / pendiente / confirmado, y lo confirmado en reconocido / a reconocer.
  // Alto de cada rama proporcional a su GB (con un mínimo para que se lea); cada caja con % del padre y % del total.
  function renderTree() {
    var e = {}; D.embudo.forEach(function (r) { e[r.k] = r; });
    var V = e.vendido.gb || 1;
    function node(k, t, gb, parent, cls) {
      var p = !parent ? '' : '<b>' + pc(gb / parent * 100) + '</b> de ' + (parent === V ? 'lo vendido' : 'lo confirmado') +
        (parent !== V ? ' · ' + pc(gb / V * 100) + ' del total' : '');
      return '<div class="eb-node' + (cls ? ' ' + cls : '') + '" style="--nc:var(' + COL[k] + ')"><div class="t">' + esc(t) + '</div><div class="n">' + usd(gb) + '</div>' +
        (p ? '<div class="p">' + p + '</div>' : '') + '</div>';
    }
    var w = function (gb) { return 'flex:' + Math.max(gb / V, 0.0001).toFixed(4) + ' 1 0'; };
    return '<div class="eb-tree">' +
      '<div class="root">' + node('vendido', 'Vendido (bruto)', e.vendido.gb, null) +
      '<div class="eb-node gd" style="--nc:var(--ref)"><div class="t">GD del Daily (vendido × gradiente)</div><div class="n">' + usd(e.gd.gb) + '</div><div class="p"><b>' + pc(e.gd.pct) +
      '</b> de lo vendido. Lo confirmado real hoy: <b>' + pc(e.confirmado.pct) + '</b>' + (e.pendiente.gb > 0 ? ' (+' + pc(e.pendiente.pct) + ' pendiente)' : '') + '</div></div></div>' +
      '<div class="brs">' +
      '<div class="br" style="' + w(e.cancelado.gb) + '">' + node('cancelado', 'Cancelado', e.cancelado.gb, V) + '<div></div></div>' +
      '<div class="br" style="' + w(e.pendiente.gb) + '">' + node('pendiente', 'Pendiente de confirmar', e.pendiente.gb, V) + '<div></div></div>' +
      '<div class="br" style="' + w(e.confirmado.gb) + ';min-height:132px">' + node('confirmado', 'Confirmado', e.confirmado.gb, V) +
      '<div class="kids"><div style="display:flex;flex-direction:column;gap:8px;height:100%">' +
      '<div style="display:flex;' + w(e.reconocido.gb) + ';min-height:62px">' + node('reconocido', 'Ya reconocido (RI)', e.reconocido.gb, e.confirmado.gb || 1) + '</div>' +
      '<div style="display:flex;' + w(e.a_reconocer.gb) + ';min-height:62px">' + node('a_reconocer', 'A reconocer (viaja después)', e.a_reconocer.gb, e.confirmado.gb || 1) + '</div>' +
      '</div></div></div></div></div>';
  }

  // Gradiente vs cancelación real, en US$: barras = cancelado real; marca = lo que el gradiente da por cancelado (vendido − GD).
  function renderGrad() {
    var g = D.gradiente, m = g.maduros;
    var sum = !m ? '<p class="eb-note">Todavía no hay meses maduros con estos filtros.</p>' :
      '<div class="eb-sum">' +
      '<div class="eb-kpi"><div class="l">Vendido en meses maduros (' + esc(mes(m.desde)) + ' a ' + esc(mes(m.hasta)) + ')</div><div class="n">' + usd(m.vendido) + '</div></div>' +
      '<div class="eb-kpi"><div class="l">Cancelado real</div><div class="n dn">' + usd(m.canc) + '</div><div class="eb-note" style="margin:0">' + pc(m.pctCanc) + ' de lo vendido</div></div>' +
      '<div class="eb-kpi"><div class="l">Lo que descuenta el gradiente</div><div class="n">' + usd(m.cancGrad) + '</div><div class="eb-note" style="margin:0">' + pc(m.pctGrad) + ' de lo vendido</div></div>' +
      '<div class="eb-kpi"><div class="l">Diferencia (real − gradiente)</div><div class="n ' + (m.dif > 0 ? 'dn' : 'up') + '">' + (m.dif > 0 ? '+' : '') + usd(m.dif) + '</div><div class="eb-note" style="margin:0">' +
      (m.dif > 0 ? 'el GD queda por encima de lo que se confirma' : 'el GD queda por debajo de lo que se confirma') + '</div></div></div>';
    var rows = g.rows.slice().reverse();
    return sum + '<div class="eb-lg"><span><i style="border-color:var(--dn);border-top-width:8px"></i>Cancelado real</span><span><i style="border-color:var(--text)"></i>Lo que descuenta el gradiente</span>' +
      '<span>Rayado / más claro: mes que todavía se puede cancelar (más de ' + g.maduroPct + '% abierto)</span></div>' +
      '<div class="eb-ch" id="eb-grad"></div>' +
      '<details style="margin-top:12px"><summary style="cursor:pointer;color:var(--link);font-size:13.5px">Ver la tabla por mes</summary><div class="eb-tw" style="margin-top:10px"><table class="eb-t"><thead><tr>' +
      '<th class="l">Mes de venta</th><th>Vendido</th><th>Cancelado real</th><th>% real</th><th>Descuenta el gradiente</th><th>% gradiente</th><th>Diferencia</th><th>Todavía abierto</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr class="' + (r.madura ? '' : 'inm') + '"><td class="l">' + esc(mes(r.mes)) + '</td><td>' + usd(r.vendido) + '</td><td>' + usd(r.canc) + '</td><td>' + pc(r.pctCanc) + '</td><td>' + usd(r.cancGrad) +
          '</td><td>' + pc(r.pctGrad) + '</td><td class="' + (r.madura ? (r.dif > 0 ? 'dn' : 'up') : 'inm') + '">' + (r.dif > 0 ? '+' : '') + usd(r.dif) + '</td><td>' + pc(r.abierto) + '</td></tr>';
      }).join('') + '</tbody></table></div></details>' +
      '<p class="eb-note">Todo en US$ de GB. "Descuenta el gradiente" = vendido − GD del Daily. "Todavía abierto" = pendiente + confirmado que todavía no viajó: puede cancelarse. ' +
      'En los meses abiertos la diferencia no es final (el cancelado real todavía sube). El resumen de arriba usa solo los meses maduros (abierto ≤ ' + g.maduroPct + '%).</p>';
  }
  function drawGrad() {
    var box = $('eb-grad'); if (!box) return;
    var rows = D.gradiente.rows, W = Math.max(320, box.clientWidth || 700), H = 300, m = { t: 14, r: 14, b: 30, l: 64 };
    if (!rows.length) { box.innerHTML = '<div class="eb-load">Sin ventas con estos filtros.</div>'; return; }
    var max = 0; rows.forEach(function (r) { max = Math.max(max, r.canc, r.cancGrad); });
    var exp = Math.pow(10, Math.floor(Math.log10(max || 1))), nice = Math.ceil((max || 1) / exp / 2) * 2 * exp;
    var bw = (W - m.l - m.r) / rows.length, X = function (i) { return m.l + i * bw; }, Y = function (v) { return m.t + (1 - v / nice) * (H - m.t - m.b); };
    var s = '<defs><pattern id="eb-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" style="fill:var(--dn);fill-opacity:.45"/></pattern></defs>';
    for (var k = 0; k <= 4; k++) { var v = nice * k / 4; s += '<line class="gl" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (m.l - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + usd(v).replace('US$ ', '') + '</text>'; }
    var every = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor((W - m.l - m.r) / 56))));
    rows.forEach(function (r, i) {
      var x = X(i) + bw * 0.18, w = bw * 0.64;
      s += '<rect x="' + x + '" y="' + Y(r.canc) + '" width="' + w + '" height="' + (Y(0) - Y(r.canc)) + '" rx="2" style="fill:' + (r.madura ? 'var(--dn)' : 'url(#eb-hatch)') + '"/>';
      s += '<line x1="' + (x - 3) + '" x2="' + (x + w + 3) + '" y1="' + Y(r.cancGrad) + '" y2="' + Y(r.cancGrad) + '" style="stroke:var(--text);stroke-width:2.5"/>';
      if (i % every === 0 || i === rows.length - 1) s += '<text class="ax" x="' + (X(i) + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + mes(r.mes).replace(/ \\(al \\d+\\)/, '*') + '</text>';
    });
    s += '<rect id="eb-ghit" x="' + m.l + '" y="' + m.t + '" width="' + (W - m.l - m.r) + '" height="' + (H - m.t - m.b) + '" fill="transparent"/>';
    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cancelado real contra lo que descuenta el gradiente, en US$, por mes de venta">' + s + '</svg><div class="eb-tip" id="eb-gtip" hidden></div>';
    var svg = box.querySelector('svg'), tip = $('eb-gtip');
    $('eb-ghit').addEventListener('pointermove', function (ev) {
      var b = svg.getBoundingClientRect(), px = (ev.clientX - b.left) / b.width * W, i = Math.max(0, Math.min(rows.length - 1, Math.floor((px - m.l) / bw))), r = rows[i];
      tip.innerHTML = '<b>Vendido en ' + esc(mes(r.mes)) + (r.madura ? '' : ' · todavía abierto') + '</b>' +
        '<div><span>Vendido</span><span>' + usd(r.vendido) + '</span></div><div><span>Cancelado real</span><span>' + usd(r.canc) + ' (' + pc(r.pctCanc) + ')</span></div>' +
        '<div><span>Descuenta el gradiente</span><span>' + usd(r.cancGrad) + ' (' + pc(r.pctGrad) + ')</span></div><div><span>Diferencia</span><span>' + (r.dif > 0 ? '+' : '') + usd(r.dif) + '</span></div>' +
        '<div><span>Todavía abierto</span><span>' + pc(r.abierto) + '</span></div>';
      tip.hidden = false;
      tip.style.left = Math.min(Math.max(0, (X(i) + bw) / W * b.width + 8), b.width - 240) + 'px'; tip.style.top = '6px';
    });
    $('eb-ghit').addEventListener('pointerleave', function () { tip.hidden = true; });
  }

  // Cosecha: aging venta → reconocimiento. Vista % acumulado (por defecto), % del mes o US$.
  var COS = 'acum';
  function renderCosecha() {
    var c = D.cosecha;
    if (!c.rows.length) return '<div class="eb-card"><p class="eb-note">Sin ventas confirmadas con estos filtros.</p></div>';
    var val = function (cell) { return COS === 'usd' ? usd(cell.gb).replace('US$ ', '') : pc(COS === 'acum' ? cell.acum : cell.pct); };
    var heat = function (cell) {
      var v = COS === 'acum' ? cell.acum : cell.pct; if (v == null) return '';
      var a = COS === 'acum' ? v / 100 * 0.55 : Math.min(1, v / 60) * 0.6;
      return 'background:color-mix(in srgb, var(--primary) ' + Math.round(a * 100) + '%, transparent)';
    };
    var head = '<tr><th class="l">Mes de venta</th><th>Confirmado</th><th>Meses prom.</th>' + c.lags.map(function (l) { return '<th>' + l + '</th>'; }).join('') + '</tr>';
    var body = c.rows.slice().reverse().map(function (r) {
      return '<tr><td class="l">' + esc(mes(r.mes)) + '</td><td>' + usd(r.total) + '</td><td>' + (r.mesesProm == null ? '—' : r.mesesProm.toFixed(1).replace('.', ',')) + '</td>' +
        r.cells.map(function (cell) {
          var empty = cell.gb === 0 && (COS !== 'acum');
          return '<td class="' + (cell.futuro ? 'fut' : 'h') + '" style="' + (cell.futuro ? '' : heat(cell)) + '" title="' + esc(usd(cell.gb) + ' · ' + pc(cell.pct) + ' del mes · ' + pc(cell.acum) + ' acumulado' + (cell.futuro ? ' · programado (todavía no viajó)' : '')) + '">' +
            (empty ? '' : val(cell)) + '</td>';
        }).join('') + '</tr>';
    }).join('');
    var t = c.total;
    var foot = '<tr class="tot"><td class="l">Total período</td><td>' + usd(t.total) + '</td><td>' + (t.mesesProm == null ? '—' : t.mesesProm.toFixed(1).replace('.', ',')) + '</td>' +
      t.cells.map(function (cell) { return '<td>' + val(cell) + '</td>'; }).join('') + '</tr>';
    return '<div class="eb-card"><div class="eb-seg2" role="group" aria-label="Valores de la cosecha">' +
      [['acum', '% acumulado'], ['mes', '% en cada mes'], ['usd', 'US$']].map(function (o) { return '<button type="button" data-cos="' + o[0] + '" class="' + (COS === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') +
      '</div><div class="eb-tw"><table class="eb-t eb-cos"><thead>' + head + '</thead><tbody>' + body + foot + '</tbody></table></div>' +
      '<p class="eb-note">Base: lo vendido en el mes que hoy está confirmado (sin cancelado ni pendiente). M0 = se reconoce el mismo mes de la venta, M1 = al mes siguiente… M7–12 y M13+ agrupan lo que tarda más. En cursiva, viajes ya programados que todavía no ocurrieron. ' +
      'Meses prom. = demora promedio entre venta y reconocimiento, ponderada por GB. En US$ los valores van en miles o millones (k / M).</p></div>';
  }

  // HTML por medio de pago
  function renderPagos() {
    var p = D.pagos;
    if (!p.aplica) return '<div class="eb-card"><p class="eb-note">Solo para HTML: elegí "HTML" o "HTML + API" en Canal.</p></div>';
    if (!p.rows.length) return '<div class="eb-card"><p class="eb-note">Sin ventas HTML con estos filtros.</p></div>';
    var maxC = 0; p.rows.forEach(function (r) { if (r.medio !== 'Total HTML') maxC = Math.max(maxC, r.pctCanc || 0); });
    return '<div class="eb-card"><div class="eb-tw"><table class="eb-t"><thead><tr><th class="l">Medio de pago</th><th>Vendido</th><th>Share</th><th class="l">% cancelado</th><th>Cancelado</th><th>Share del<br>cancelado</th><th>% pendiente</th><th>% gradiente</th><th>Real −<br>gradiente</th></tr></thead><tbody>' +
      p.rows.map(function (r) {
        var tot = r.medio === 'Total HTML';
        return '<tr class="' + (tot ? 'tot' : '') + '"><td class="l" title="' + esc(r.codigos.join(', ')) + '">' + esc(r.medio) + (r.codigos.length ? '<small>' + esc(r.codigos.join(' · ')) + '</small>' : '') + '</td><td>' + usd(r.vendido) + '</td><td>' + pc(r.share) + '</td>' +
          '<td class="l"><span class="eb-pbar" style="width:' + (tot ? 0 : Math.round((r.pctCanc || 0) / (maxC || 1) * 60)) + 'px"></span>' + pc(r.pctCanc) + '</td><td>' + usd(r.canc) + '</td><td>' + pc(r.shareCanc) + '</td><td>' + pc(r.pctPend) + '</td><td>' + pc(r.pctGrad) +
          '</td><td class="' + (r.difPp == null ? '' : r.difPp > 0 ? 'dn' : 'up') + '">' + (r.difPp == null ? '—' : (r.difPp > 0 ? '+' : r.difPp < 0 ? '−' : '') + Math.abs(r.difPp).toFixed(1).replace('.', ',') + ' pp') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="eb-note">Ventas HTML del período elegido, por medio de pago (payment_methods de la venta en el back office; si tiene varias filas, la emitida). % gradiente = lo que descuenta el GD (1 − GD / vendido). ' +
      'Real − gradiente en puntos: positivo = se cancela más de lo que el GD descuenta. En el período elegido puede haber ventas que todavía se cancelen.</p></div>';
  }

  var ORIG_COL = ['--primary', '--c3', '--c4', '--c5', '--c6'];
  var ETAPA_COL = { 'Cancelado': '--dn', 'Pendiente': '--warn', 'Reconocido': '--up', 'A reconocer': '--c1' };
  function renderPuente() {
    var p = D.puente, q = D.q, max = Math.max(p.vendido, p.gd, p.ri) || 1;
    var meses = D.options.meses.map(function (x) { return [x, mes(x)]; });
    var mismo = p.origen[0] ? p.origen[0].pct : null;
    var bar = function (lbl, segs) {
      return '<div>' + esc(lbl) + '</div><div class="tr">' + segs.filter(function (s) { return s.gb > 0; }).map(function (s) {
        return '<div title="' + esc(s.lbl + ': ' + usd(s.gb)) + '" style="width:' + (s.gb / max * 100) + '%;background:var(' + s.col + ')"></div>';
      }).join('') + '</div>';
    };
    var item = function (lbl, gb, pct, col) { return '<div><span><i style="background:var(' + col + ')"></i>' + esc(lbl) + '</span><span>' + usd(gb) + '<span class="p">' + pc(pct) + '</span></span></div>'; };
    return '<div class="eb-bar" style="position:static;border:0;margin:0 0 10px;padding:0">' + sel('f-mes', 'Mes', meses, q.mes) + '</div>' +
      '<p class="sub" style="font-size:14px;color:var(--text-2);margin-bottom:14px">En <b>' + esc(mes(p.mes)) + '</b> el Daily muestra <b>' + usd(p.gd) + '</b> por GD y <b>' + usd(p.ri) +
      '</b> por RI. El GD mira lo que se vendió en el mes; el RI, lo que viajó en el mes, que en buena parte se vendió antes. Solo <b>' + pc(mismo) + '</b> del RI del mes viene de ventas de ese mismo mes.</p>' +
      '<div class="eb-card"><div class="eb-kpis">' +
      '<div class="eb-kpi"><div class="l">Vendido en el mes (bruto)</div><div class="n">' + usd(p.vendido) + '</div></div>' +
      '<div class="eb-kpi"><div class="l">GD del Daily (× gradiente)</div><div class="n">' + usd(p.gd) + '</div></div>' +
      '<div class="eb-kpi"><div class="l">RI del Daily</div><div class="n">' + usd(p.ri) + '</div></div>' +
      '<div class="eb-kpi"><div class="l">RI contra GD</div><div class="n ' + (p.riVsGd == null ? '' : p.riVsGd < 0 ? 'dn' : 'up') + '">' + pc(p.riVsGd, true) + '</div></div></div>' +
      '<div class="eb-st">' +
      bar('Vendido en el mes', p.vendidoPor.map(function (s) { return { lbl: s.lbl, gb: s.gb, col: ETAPA_COL[s.lbl] }; })) +
      bar('GD del Daily', [{ lbl: 'GD', gb: p.gd, col: '--ref' }]) +
      bar('RI del Daily', p.origen.map(function (s, i) { return { lbl: s.lbl, gb: s.gb, col: ORIG_COL[i] }; })) +
      '</div><div class="eb-sl">' +
      p.vendidoPor.map(function (s) { return item('Vendido · ' + s.lbl.toLowerCase(), s.gb, s.pct, ETAPA_COL[s.lbl]); }).join('') +
      p.origen.map(function (s, i) { return item('RI · ' + s.lbl.toLowerCase(), s.gb, s.pct, ORIG_COL[i]); }).join('') +
      '</div><p class="eb-note">"Vendido · reconocido" es lo que ya se reconoció hasta hoy, en ese mes o después. El RI del mes suma ventas de cualquier mes que se reconocieron en ese mes.</p></div>';
  }

  function renderPaises() {
    var rows = D.paises;
    return '<div class="eb-card"><div class="eb-tw"><table class="eb-t"><thead><tr><th class="l">País</th><th>Vendido</th><th>% cancelado</th><th>% pendiente</th><th>Reconocido</th><th>A reconocer</th><th>GD del Daily</th><th>RI del Daily</th><th>RI vs GD</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var tot = r.pais === 'Total', on = D.q.pais === r.pais;
        return '<tr class="' + (tot ? 'tot' : 'click') + '"' + (tot ? '' : ' data-pais="' + esc(r.pais) + '" title="' + (on ? 'Quitar filtro' : 'Filtrar por ' + esc(r.pais)) + '"') + '>' +
          '<td class="l">' + esc(r.pais) + (on ? ' ●' : '') + '</td><td>' + usd(r.vendido) + '</td><td>' + pc(r.canc) + '</td><td>' + pc(r.pend) + '</td><td>' + usd(r.rec) + '</td><td>' + usd(r.fut) +
          '</td><td>' + usd(r.gd) + '</td><td>' + usd(r.ri) + '</td><td class="' + (r.riVsGd == null ? '' : r.riVsGd < 0 ? 'dn' : 'up') + '">' + pc(r.riVsGd, true) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="eb-note">Ventas del período elegido con su estado de hoy, y el GD y el RI que muestra el Daily en esos mismos meses (el RI suma ventas de cualquier mes reconocidas en el período). Un RI vs GD negativo no es caída de ventas: es venta que todavía no viajó o que se canceló. Clic en un país para filtrar.</p></div>';
  }

  function render() {
    renderBar();
    $('eb-body').innerHTML =
      renderLead() +
      '<section class="eb-sec" id="arbol"><h2>Qué pasó con lo vendido</h2><p class="sub">Estado de hoy de cada venta del período, según su fecha de venta. El alto de cada caja es proporcional a su GB.</p><div class="eb-card">' + renderTree() +
      '<p class="eb-note">"GD del Daily" es lo vendido multiplicado por el gradiente de confirmación: una estimación, hecha al vender, de cuánto va a quedar después de cancelaciones.</p></div></section>' +
      '<section class="eb-sec" id="gradiente"><h2>Gradiente contra cancelación real, en GB</h2>' +
      '<p class="sub">Por mes de venta: cuánto se canceló de verdad contra cuánto da por cancelado el GD del Daily. Con los filtros de país, canal y producto; todos los meses desde ' + esc(mes((D.desdeDatos || '').slice(0, 7))) + '.</p>' +
      '<div class="eb-card">' + renderGrad() + '</div></section>' +
      '<section class="eb-sec" id="cosecha"><h2>Cosecha: cuánto tarda en reconocerse lo vendido</h2>' +
      '<p class="sub">Aging entre la fecha de venta (booking) y la de reconocimiento, para lo confirmado de cada mes de venta del período.</p>' + renderCosecha() + '</section>' +
      '<section class="eb-sec" id="gd-vs-ri"><h2>Por qué en un mismo mes el GD y el RI no coinciden</h2>' + renderPuente() + '</section>' +
      '<section class="eb-sec" id="pagos"><h2>HTML: cancelación por medio de pago</h2>' +
      '<p class="sub">Qué medios de pago se cancelan más, y si el gradiente lo anticipa.</p>' + renderPagos() + '</section>' +
      '<section class="eb-sec" id="paises"><h2>Por país</h2>' + renderPaises() + '</section>';
    drawGrad();
    $('eb-upd').textContent = 'Datos hasta el ' + D.hasta.split('-').reverse().join('/') + ' · ventas desde ' + mes((D.desdeDatos || '').slice(0, 7));
  }

  document.addEventListener('change', function (ev) {
    var t = ev.target; if (!t || !t.id || t.id.indexOf('f-') !== 0) return;
    var k = t.id.slice(2); if (KEYS.indexOf(k) < 0) return;
    if (t.value) S.f[k] = t.value; else delete S.f[k];
    load();
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button, tr[data-pais]'); if (!b) return;
    if (b.id === 'eb-clear') { delete S.f.pais; delete S.f.canal; delete S.f.producto; load(); }
    else if (b.dataset.cos) {
      COS = b.dataset.cos;
      var sec = $('cosecha'); if (sec && D) { var card = sec.querySelector('.eb-card'); if (card) card.outerHTML = renderCosecha(); }
    }
    else if (b.dataset.pais) { if (S.f.pais === b.dataset.pais) delete S.f.pais; else S.f.pais = b.dataset.pais; load(); }
  });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (D) drawGrad(); }, 150); });
  load();
})();`;

function embudoPage({ basePath }) {
  const back = `<a class="eb-home" href="${escapeHtml(basePath)}/" title="Volver al menú principal de B2B Ecosystem">🏠 Home</a>`;
  const cfg = JSON.stringify({ api: `${basePath}/embudo-b2b/data` }).replace(/</g, '\\u003c');
  return shell(`${CSS}<div id="eb-root">
    <div class="eb-hero">
      <h1>Embudo B2B <span class="eb-wip" title="Work in progress">WIP</span></h1>
      <p>Qué pasa con lo que vende B2B: cuánto se vende, cuánto se cancela, cuánto queda pendiente y cuándo se reconoce como ingreso. Y por qué en un mismo mes el Daily muestra un GD y un RI tan distintos.</p>
      <p class="eb-note" id="eb-upd"></p>
    </div>
    <div class="eb-bar" id="eb-bar"></div>
    <div id="eb-body"><div class="eb-load">Cargando…</div></div>
    <ul class="eb-notes">
      <li><b>Vendido</b>: Gross Bookings B2B por fecha de gestión, en bruto (sin gradiente): todo lo que se vendió, aunque después se cancele. Mismas reglas de país y canal que el Daily (HTML = agencias afiliadas, API = mayoristas).</li>
      <li><b>Estado de hoy</b>: Cancelado y Pendiente (Activo: reservado, sin confirmar; casi todo HTML Hoteles) salen del estado actual del producto. Lo confirmado se separa en <b>Reconocido</b> (fecha de reconocimiento hasta el último día con datos) y <b>A reconocer</b> (fecha futura: todavía no viajó).</li>
      <li><b>Fecha de reconocimiento</b>: la del RI del Daily: el check-in para API Hoteles y la fecha de reconocimiento de la venta para el resto.</li>
      <li><b>GD del Daily</b>: vendido × gradiente de confirmación (confirmation_gradient), por fecha de gestión. <b>RI del Daily</b>: Gross Bookings por fecha de reconocimiento, sin gradiente y sin las ventas API canceladas antes del check-in; incluye las ventas HTML canceladas después de reconocerse.</li>
      <li><b>Fuente</b>: Datalake (bi_sales_fact_sales_recognition con el estado actual del producto), vía Daily_Dashboard/embudo_b2b_sync.py.</li>
    </ul>
  </div>
  <script>window.EB_CFG = ${cfg};</script>
  <script>${SCRIPT}</script>`, { title: 'Embudo B2B · B2B Ecosystem', left: back });
}

module.exports = { embudoPage };
