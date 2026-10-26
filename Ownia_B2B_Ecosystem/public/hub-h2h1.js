/* Vista "H2 Budget vs H1" del P&L Dashboard (Hub) en Ownia (2026-10-26, para dirección). La inyecta
 * server/index.js en el Hub (`layout` en server/modules.js); se abre desde la pestaña "H2 vs H1"
 * (botón #nav-h2h1 de Dashboard_B2B_WLs/dashboard.html, clasificado en PRIMARY de hub-layout.js).
 *
 * Pregunta que contesta (una pantalla, para contarle al CEO): ¿qué challenge asumía el Budget entre un
 * semestre y otro? Para Net Revenue y Operating Contribution, Total / B2B2C / B2B MIN / B2B MAY:
 *  - cuánto crece el H2 Budget sobre el H1 real (H2/H1 Budget), contra
 *  - cuánto creció el H2 sobre el H1 el año pasado (H2/H1 FY anterior = la estacionalidad normal).
 * La diferencia en puntos es el esfuerzo extra que asume el Budget (= la aceleración del YoY del H2
 * contra el del H1), y se parte en dos causas: lo que planeó el Budget (H2 vs H1 dentro del Budget
 * contra el año pasado) y el efecto H1 (cómo salió el H1 real contra su Budget).
 * Pantalla pensada para el CEO: por negocio, "crece X%, un H2 normal crece Y%", un veredicto en palabras
 * (muy exigente / exigente / normal / holgado) y el porqué en una frase. El detalle para Planning
 * (Planeado, plan / efecto H1, gráfico) queda plegado en "Ver detalle".
 *
 * Datos: getAllData del Hub (los mismos números que el resto del dashboard), dos llamadas — H1 y H2 —
 * con LoB Consolidado, que trae los grupos WL's (= B2B2C), MAY, MIN y Total. Respeta el switch Organic
 * del Hub: con YES el H1 real va a TC Budget (comparable con el H2 Budget); el año pasado, a sus TC reales.
 */
(function () {
  'use strict';

  var UP = '#1a9e5a', DOWN = '#d4373a', BAR = '#550fed', LYC = '#1d1d1f';
  var SEGS = [['total', 'Total B2B + B2B2C'], ['b2b2c', 'B2B2C'], ['min', 'B2B MIN'], ['may', 'B2B MAY']];
  var METRICS = [['nr', 'Net Revenue'], ['oc', 'Operating Contribution']];
  // OC del año pasado ajustado como en la presentación de dirección: el FY26 incluye un pago
  // extraordinario LATAM de USD 5.6M (jun-25, B2B2C) que deprime el OC del H1 FY26 y, con él, infla la
  // estacionalidad H2/H1 del año pasado. Se suma al LY del H1 (B2B2C y Total) solo para esa
  // estacionalidad; los montos no cambian. Solo FY27: sacarlo cuando no aplique.
  var LY_ADJ_FY = 2027, LY_ADJ_OC_B2B2C_H1 = 5.6e6;
  var cache = {};       // clave de params → result de getAllData
  var panel = null;

  function fy() { return typeof window.fyEndYear_ === 'function' ? window.fyEndYear_() : 2027; }
  function halves() {
    var y = fy();
    return { h1: [(y - 1) + '-04', (y - 1) + '-09'], h2: [(y - 1) + '-10', y + '-03'] };
  }
  function organicOn() { var st = window._state; return !!(st && st.organic); }

  function params(range) {
    return { lob: 'all', pais: 'all', producto: 'all', canal: 'all', desde: range[0], hasta: range[1],
      baselineSource: 'baseline', fcSource: '', organic: organicOn() ? 'budget' : '' };
  }

  function fetchData(range) {
    var p = params(range), key = JSON.stringify(p);
    if (cache[key]) return Promise.resolve(cache[key]);
    return new Promise(function (resolve, reject) {
      window.google.script.run
        .withSuccessHandler(function (r) { cache[key] = r; resolve(r); })
        .withFailureHandler(reject)
        .getAllData(p);
    });
  }

  // {nr|oc: {total|b2b2c|min|may: {act, bud, ly}}} desde result.pnl (grupos Total / WL's / MIN / MAY)
  function pick(result) {
    var pnl = result && result.pnl, out = {};
    if (!pnl || !pnl.rows) return out;
    var g = pnl.groups || [];
    var idx = { total: g.indexOf('Total'), b2b2c: g.indexOf("WL's"), min: g.indexOf('MIN'), may: g.indexOf('MAY') };
    pnl.rows.forEach(function (r) {
      if (!METRICS.some(function (m) { return m[0] === r.id; })) return;
      out[r.id] = {};
      SEGS.forEach(function (s) {
        var c = r.cols[idx[s[0]]] || {};
        out[r.id][s[0]] = { act: c.actual || 0, bud: c.budget || 0, ly: c.lyVal || 0 };
      });
    });
    return out;
  }

  function pct(a, b) { return b > 0 ? (a / b - 1) * 100 : NaN; }
  function fmtM(v) { var m = v / 1e6, a = Math.abs(m); return (m < 0 ? '−' : '') + (a >= 100 ? a.toFixed(0) : a.toFixed(1)) + 'M'; }
  function fmtP(v) { return isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(0) + '%' : '—'; }
  function fmtPP(v) { return isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(0) + ' pp' : '—'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Una fila por segmento: H1 real, H2 Budget, H2/H1 del Budget, H2/H1 del año pasado y el gap en pp.
  function rows(h1, h2) {
    var out = {};
    METRICS.forEach(function (m) {
      out[m[0]] = SEGS.map(function (s) {
        var a = h1[m[0]][s[0]], b = h2[m[0]][s[0]];
        var lyH1 = a.ly + (m[0] === 'oc' && fy() === LY_ADJ_FY && (s[0] === 'b2b2c' || s[0] === 'total') ? LY_ADJ_OC_B2B2C_H1 : 0);
        var bud = pct(b.bud, a.act), ly = pct(b.ly, lyH1), inBud = pct(b.bud, a.bud);
        // gap = plan (lo que el Budget ya planeaba sobre la estacionalidad) + h1eff (rebase por el H1 real)
        return { seg: s[0], name: s[1], metric: m[1], h1: a.act, h1VsBud: pct(a.act, a.bud), h2: b.bud,
          h1Bud: a.bud, lyH1: lyH1, lyH2: b.ly,
          bud: bud, ly: ly, inBud: inBud, gap: bud - ly, plan: inBud - ly, h1eff: bud - inBud, proj: pct(b.act, b.bud) };
      });
    });
    return out;
  }

  // Challenge partido en sus dos causas: lo que planeó el Budget y el efecto del H1 real vs su Budget.
  function split(r) {
    if (!isFinite(r.plan) || !isFinite(r.h1eff)) return '';
    var tot = Math.abs(r.plan) + Math.abs(r.h1eff) || 1;
    var seg = function (v, c) { return '<i class="' + c + (v < 0 ? ' h21-neg' : '') + '" style="width:' + (Math.abs(v) / tot * 100).toFixed(0) + '%"></i>'; };
    return '<span class="h21-stack">' + seg(r.plan, 'h21-sp') + seg(r.h1eff, 'h21-sh') + '</span>' +
      '<span class="h21-stxt">' + fmtPP(r.plan).replace(' pp', '') + ' · ' + fmtPP(r.h1eff).replace(' pp', '') + '</span>';
  }

  // Tabla: cada % en su columna, con el encabezado diciendo qué compara contra qué; el gráfico de la
  // última columna repite los tres crecimientos (barra = pide el Budget, círculo = planeado, línea = año pasado).
  function block(title, list) {
    var vals = [];
    list.forEach(function (r) { [r.bud, r.ly, r.inBud].forEach(function (v) { if (isFinite(v)) vals.push(v); }); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(1, Math.max.apply(null, vals));
    var span = hi - lo, x = function (v) { return ((v - lo) / span * 100).toFixed(1) + '%'; };
    function calc(num, den, a, b) { return esc(fmtM(num) + ' ' + a + ' / ' + fmtM(den) + ' ' + b + ' − 1'); }
    var body = list.map(function (r) {
      var from = Math.min(0, r.bud), to = Math.max(0, r.bud);
      var bar = isFinite(r.bud) ? '<span class="h21-bar" style="left:' + x(from) + ';width:calc(' + x(to) + ' - ' + x(from) + ')"></span>' : '';
      var tick = isFinite(r.ly) ? '<span class="h21-tick" style="left:' + x(r.ly) + '"></span>' : '';
      var plan = isFinite(r.inBud) ? '<span class="h21-plan" style="left:' + x(r.inBud) + '"></span>' : '';
      var zero = lo < 0 ? '<span class="h21-zero" style="left:' + x(0) + '"></span>' : '';
      var gc = !isFinite(r.gap) ? '' : r.gap > 5 ? 'h21-hard' : r.gap < -5 ? 'h21-soft' : 'h21-even';
      return '<div class="h21-row' + (r.seg === 'total' ? ' h21-tot' : '') + '">' +
        '<div class="h21-seg">' + esc(r.name) + '</div>' +
        '<div class="h21-num" title="H1 Budget: ' + esc(fmtM(r.h1Bud)) + '">' + fmtM(r.h1) +
          '<small class="' + (r.h1VsBud >= 0 ? 'h21-up' : 'h21-dn') + '">' + fmtP(r.h1VsBud) + ' vs H1 Bud</small></div>' +
        '<div class="h21-num">' + fmtM(r.h2) + '</div>' +
        '<div class="h21-num h21-pc h21-c1" title="' + calc(r.h2, r.h1, 'H2 Bud', 'H1 real') + '">' + fmtP(r.bud) + '</div>' +
        '<div class="h21-num h21-pc h21-c2" title="' + calc(r.h2, r.h1Bud, 'H2 Bud', 'H1 Bud') + '">' + fmtP(r.inBud) + '</div>' +
        '<div class="h21-num h21-pc h21-c3" title="' + calc(r.lyH2, r.lyH1, 'H2 LY', 'H1 LY') + '">' + fmtP(r.ly) + '</div>' +
        '<div class="h21-gapc" title="' + esc('Pide el Budget ' + fmtP(r.bud) + ' − año pasado ' + fmtP(r.ly) + ' = ' + fmtPP(r.gap) +
          ' (plan ' + fmtPP(r.plan) + ' + efecto H1 ' + fmtPP(r.h1eff) + ')') + '"><div class="h21-gap ' + gc + '">' + fmtPP(r.gap) + '</div>' +
          '<div class="h21-split">' + split(r) + '</div></div>' +
        '<div class="h21-viz">' + zero + bar + plan + tick + '</div>' +
        '</div>';
    }).join('');
    function hd(a, b, c) { return '<div class="h21-h' + (c || '') + '"><b>' + a + '</b><span>' + b + '</span></div>'; }
    return '<section class="h21-block"><h3>' + title + ' <span class="h21-muted">· crecimiento del H2 sobre el H1</span></h3>' +
      '<div class="h21-row h21-hdr"><div></div>' +
      hd('H1 real', 'USD · vs su Budget') + hd('H2 Budget', 'USD') +
      hd('Pide el Budget', 'H2 Bud vs H1 real', ' h21-c1') + hd('Planeado', 'H2 Bud vs H1 Bud', ' h21-c2') + hd('Año pasado', 'H2 vs H1 FY' + String(fy() - 1).slice(-2), ' h21-c3') +
      hd('Challenge', 'Pide − Año pasado') +
      '<div class="h21-hv"><span><i class="h21-kbar"></i>pide</span><span><i class="h21-kplan"></i>planeado</span><span><i class="h21-ktick"></i>año pasado</span></div>' +
      '</div>' + body + '</section>';
  }

  // Cómo leer la tabla, en una línea (va arriba de las dos tablas).
  function howTo() {
    return '<div class="h21-how"><b>Cómo leer:</b> tres crecimientos del H2 sobre el H1 — ' +
      '<span class="h21-c1">Pide el Budget</span> = H2 Budget / H1 real · ' +
      '<span class="h21-c2">Planeado</span> = H2 Budget / H1 Budget · ' +
      '<span class="h21-c3">Año pasado</span> = H2 / H1 del FY' + String(fy() - 1).slice(-2) + '. ' +
      '<b>Challenge</b> = Pide − Año pasado, en pp = <b>plan</b> (Planeado − Año pasado) + <b>efecto H1</b> (Pide − Planeado: el H1 real arriba o abajo de su Budget).</div>';
  }

  // ── Vista para el CEO ─────────────────────────────────────────────────────────────────────
  // Un solo porcentaje contra una sola referencia ("crece X%, un H2 normal crece Y%"), un veredicto
  // en palabras y el porqué en una frase. El detalle (Planeado, plan / efecto H1) queda plegado.
  var VERDICTS = [
    [25, 'Muy exigente', 'h21-v4'], [8, 'Exigente', 'h21-v3'], [-8, 'Normal', 'h21-v2'], [-Infinity, 'Holgado', 'h21-v1'],
  ];
  function verdict(gap) {
    if (!isFinite(gap)) return ['—', 'h21-v2'];
    for (var i = 0; i < VERDICTS.length; i++) if (gap > VERDICTS[i][0]) return [VERDICTS[i][1], VERDICTS[i][2]];
    return ['Holgado', 'h21-v1'];
  }
  function metricShort(r) { return r.metric === 'Net Revenue' ? 'NR' : 'OC'; }

  // Por qué, en una frase: lo que planeó el Budget vs lo que dejó el H1 real contra su Budget.
  function why(r) {
    var h1 = 'el H1 de ' + metricShort(r) + ' quedó ' + fmtP(r.h1VsBud) + ' vs Budget';
    if (r.gap > 8) {
      return Math.abs(r.h1eff) > Math.abs(r.plan) && r.h1eff > 0
        ? 'Hay que recuperar el H1: ' + h1 + '; el Budget planeaba un H2 normal.'
        : 'El Budget ya planeaba un H2 fuerte (' + fmtP(r.inBud) + ' sobre el H1)' + (r.h1eff < -5 ? '; ' + h1 + ' y lo compensa en parte.' : '.');
    }
    if (r.gap < -8) return 'El Budget pide menos que un H2 normal' + (r.h1VsBud > 5 ? ', y ' + h1 + '.' : '.');
    return 'En línea con un H2 normal' + (Math.abs(r.h1VsBud) >= 10 ? '; ' + h1 + '.' : '.');
  }

  // Lectura de la fila: la métrica más exigente del segmento (la que hay que contar).
  function segReading(nr, oc) {
    var main = (isFinite(oc.gap) && oc.gap > nr.gap) ? oc : nr;
    var v = verdict(main.gap);
    var both = verdict(nr.gap)[0] === verdict(oc.gap)[0];
    return '<span class="h21-vtag ' + v[1] + '">' + v[0] + (both ? '' : ' en ' + metricShort(main)) + '</span>' +
      '<span class="h21-why">' + esc(why(main)) + '</span>';
  }

  function cell(r) {
    var v = verdict(r.gap);
    return '<div class="h21-cell">' +
      '<div class="h21-flow">' + fmtM(r.h1) + ' <span class="h21-arrow">→</span> ' + fmtM(r.h2) + '</div>' +
      '<div class="h21-grow"><b class="h21-g ' + v[1] + '">' + fmtP(r.bud) + '</b><span class="h21-vs">un H2 normal: ' + fmtP(r.ly) + '</span></div>' +
      '</div>';
  }

  function ceoTable(all) {
    var body = SEGS.map(function (s, i) {
      var nr = all.nr[i], oc = all.oc[i];
      return '<div class="h21-crow' + (s[0] === 'total' ? ' h21-ctot' : '') + '">' +
        '<div class="h21-cseg">' + esc(s[1]) + '</div>' + cell(nr) + cell(oc) +
        '<div class="h21-read">' + segReading(nr, oc) + '</div></div>';
    }).join('');
    return '<section class="h21-ceo">' +
      '<div class="h21-crow h21-chdr"><div></div>' +
      '<div><b>Net Revenue</b><span>H1 real → H2 Budget · crece</span></div>' +
      '<div><b>Operating Contribution</b><span>H1 real → H2 Budget · crece</span></div>' +
      '<div><b>¿Qué tan exigente es el H2?</b><span>vs el crecimiento de un H2 normal (H2 vs H1 del año pasado)</span></div></div>' +
      body + '</section>';
  }

  function headline(all) {
    var nr = all.nr[0], oc = all.oc[0], tot = Math.max(nr.gap, oc.gap);
    var level = tot > 25 ? 'muy por encima de' : tot > 8 ? 'por encima de' : tot < -8 ? 'por debajo de' : 'en línea con';
    var hard = {};
    METRICS.forEach(function (m) {
      all[m[0]].forEach(function (r) { if (r.seg !== 'total' && r.gap > 8) (hard[r.name] = hard[r.name] || []).push(metricShort(r)); });
    });
    var names = Object.keys(hard).sort(function (a, b) { return hard[b].length - hard[a].length; })
      .map(function (n) { return '<b>' + esc(n) + '</b>' + (hard[n].length < 2 ? ' (' + hard[n][0] + ')' : ''); });
    var where = !names.length ? 'Ningún negocio pide un esfuerzo extra relevante.'
      : 'El esfuerzo está concentrado en ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' y ' + names[names.length - 1] : names[0]) + '.';
    return 'En total, el Budget pide un H2 <b>' + level + '</b> lo normal: Net Revenue <b>' + fmtP(nr.bud) + '</b> sobre el H1 (un H2 normal: ' + fmtP(nr.ly) + ') ' +
      'y Operating Contribution <b>' + fmtP(oc.bud) + '</b> (normal: ' + fmtP(oc.ly) + '). ' + where;
  }

  function render(h1r, h2r) {
    var h1 = pick(h1r), h2 = pick(h2r);
    if (!h1.nr || !h2.nr || !h1.oc || !h2.oc) {
      body().innerHTML = '<p class="h21-err">No llegaron los datos del P&amp;L para armar la vista.</p>';
      return;
    }
    var all = rows(h1, h2), yr = fy(), org = organicOn(), ly = 'FY' + String(yr - 1).slice(-2);
    var p = all.nr[0].proj, q = all.oc[0].proj;
    var open = panel.querySelector('.h21-det') && panel.querySelector('.h21-det').open;
    body().innerHTML =
      '<p class="h21-head1">' + headline(all) + '</p>' +
      '<div class="h21-sub">H1 real abr–sep ' + (yr - 1) + ' · H2 Budget oct ' + (yr - 1) + '–mar ' + yr + ' · USD · ' +
        '<span class="h21-mode">' + (org ? 'Organic: H1 real a tipo de cambio Budget' : 'USD nominales') + '</span></div>' +
      ceoTable(all) +
      '<p class="h21-today">Hoy, con el real de octubre y el Run Rate, el H2 se proyecta <b class="' + (p >= 0 ? 'h21-up' : 'h21-dn') + '">' + fmtP(p) + '</b> en Net Revenue y ' +
        '<b class="' + (q >= 0 ? 'h21-up' : 'h21-dn') + '">' + fmtP(q) + '</b> en Operating Contribution contra el Budget.</p>' +
      '<details class="h21-det"' + (open ? ' open' : '') + '><summary>Ver detalle: de dónde sale el esfuerzo (plan del Budget vs efecto H1)</summary>' +
        howTo() + block('Net Revenue', all.nr) + block('Operating Contribution', all.oc) + '</details>' +
      '<p class="h21-foot"><b>Un H2 normal</b> = cuánto creció el H2 sobre el H1 en el ' + ly + ' (la estacionalidad). ' +
        '<b>Veredicto</b> según cuántos puntos pide el Budget por encima de eso: más de 25 muy exigente, 8 a 25 exigente, ±8 normal, menos de −8 holgado. ' +
        (org ? 'Con Organic, el H1 real va a tipo de cambio Budget para compararlo con el H2 Budget. ' : '') +
        (yr === LY_ADJ_FY ? 'OC ' + ly + ' H1 sin el pago extraordinario LATAM de USD 5.6M (jun-25, B2B2C). ' : '') +
        'Fuente: P&amp;L contable.</p>';
  }

  function body() { return panel.querySelector('.h21-body'); }

  function ensurePanel() {
    if (panel) return panel;
    var css = document.createElement('style');
    css.textContent = [
      '#h21{position:fixed;left:0;right:0;bottom:0;z-index:40;background:#f5f5f7;overflow:auto;font-family:Poppins,-apple-system,"Segoe UI",sans-serif;color:#1d1d1f}',
      '#h21 .h21-wrap{max-width:1280px;margin:0 auto;padding:18px 24px 32px}',
      '#h21 .h21-top{display:flex;align-items:center;gap:14px}',
      '#h21 h2{font-size:20px;font-weight:600;margin:0}',
      '#h21 .h21-org{margin-left:auto;display:flex;align-items:center;gap:0;font-size:12px;color:#6e6e73}',
      '#h21 .h21-org span{margin-right:8px}',
      '#h21 .h21-org button{border:1px solid #d0d0d8;background:#fff;padding:5px 12px;cursor:pointer;font:inherit;font-size:12px;font-weight:600;color:#3a3a3c}',
      '#h21 .h21-org button:first-of-type{border-radius:8px 0 0 8px}#h21 .h21-org button:last-of-type{border-radius:0 8px 8px 0;border-left:none}',
      '#h21 .h21-org button[aria-pressed="true"]{background:#550fed;border-color:#550fed;color:#fff}',
      '#h21 .h21-close{margin-left:10px;border:1px solid #d0d0d8;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit;font-size:13px}',
      '#h21 .h21-head1{font-size:19px;line-height:1.45;margin:12px 0 6px;max-width:1050px}',
      '#h21 .h21-sub{color:#6e6e73;font-size:12.5px;margin:0 0 14px}',
      '#h21 .h21-mode{background:#ece7fd;color:#3d0bb0;border-radius:6px;padding:1px 7px;font-weight:600}',
      '#h21 .h21-ceo{padding:6px 20px}',
      '#h21 .h21-crow{display:grid;grid-template-columns:150px minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr);gap:18px;align-items:center;padding:14px 0;border-top:1px solid #ececf0}',
      '#h21 .h21-chdr{border-top:none;padding:10px 0 6px;align-items:end}',
      '#h21 .h21-chdr b{display:block;font-size:13px}',
      '#h21 .h21-chdr span{display:block;font-size:11.5px;color:#6e6e73}',
      '#h21 .h21-cseg{font-size:15px;font-weight:600}',
      '#h21 .h21-ctot{background:#f8f7fd;margin:0 -20px;padding:14px 20px}',
      '#h21 .h21-flow{font-size:13px;color:#6e6e73;font-variant-numeric:tabular-nums}',
      '#h21 .h21-arrow{color:#c7c7cc}',
      '#h21 .h21-grow{display:flex;align-items:baseline;gap:10px;margin-top:2px}',
      '#h21 .h21-g{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}',
      '#h21 .h21-vs{font-size:12.5px;color:#6e6e73}',
      '#h21 .h21-read{display:flex;flex-direction:column;align-items:flex-start;gap:5px}',
      '#h21 .h21-vtag{font-size:12.5px;font-weight:700;border-radius:999px;padding:3px 11px}',
      '#h21 .h21-why{font-size:13px;line-height:1.4;color:#3a3a3c}',
      '#h21 .h21-v4{color:#b3261e}#h21 .h21-v3{color:#b35c00}#h21 .h21-v2{color:#3a3a3c}#h21 .h21-v1{color:#146c43}',
      '#h21 .h21-vtag.h21-v4{background:#fdecea}#h21 .h21-vtag.h21-v3{background:#fff1e0}#h21 .h21-vtag.h21-v2{background:#f0f0f3}#h21 .h21-vtag.h21-v1{background:#e6f4ec}',
      '#h21 .h21-today{font-size:14px;margin:14px 2px}',
      '#h21 .h21-det{margin-top:6px}',
      '#h21 .h21-det summary{cursor:pointer;font-size:13px;color:#550fed;font-weight:600;padding:6px 2px;list-style-position:inside}',
      '#h21 .h21-det[open] summary{margin-bottom:10px}',
      '#h21 .h21-det section{margin-top:12px}',
      '@media (max-width:900px){#h21 .h21-crow{grid-template-columns:1fr 1fr}#h21 .h21-cseg,#h21 .h21-read{grid-column:1 / -1}}',
      '#h21 section{background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}',
      '#h21 h3{font-size:15px;font-weight:600;margin:0 0 8px}',
      '#h21 h4{font-size:13px;font-weight:600;margin:12px 0 6px;color:#6e6e73}',
      '#h21 .h21-row{display:grid;grid-template-columns:118px 92px 70px 82px 82px 82px 96px minmax(110px,1fr);gap:8px;align-items:center;padding:7px 0;border-top:1px solid #f0f0f3;font-size:13.5px}',
      '#h21 .h21-hdr{align-items:end}',
      '#h21 .h21-hdr > div{text-align:right}',
      '#h21 .h21-hdr b{display:block;font-size:11.5px;color:#1d1d1f;text-transform:none;letter-spacing:0}',
      '#h21 .h21-hdr span{display:block;font-size:10.5px;color:#6e6e73;text-transform:none;letter-spacing:0}',
      '#h21 .h21-hv{display:flex;flex-wrap:wrap;gap:4px 10px;justify-content:flex-start !important;text-align:left !important}',
      '#h21 .h21-hv span{display:inline-flex !important;align-items:center;font-size:10.5px}',
      '#h21 .h21-pc{font-weight:600}',
      '#h21 .h21-c1{color:' + BAR + '}#h21 .h21-c2{color:#7b5bd6}#h21 .h21-c3{color:#3a3a3c}',
      '#h21 .h21-hdr .h21-c1 b{color:' + BAR + '}#h21 .h21-hdr .h21-c2 b{color:#7b5bd6}',
      '#h21 .h21-how{background:#fff;border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:12.5px;line-height:1.55;color:#3a3a3c;box-shadow:0 1px 3px rgba(0,0,0,.06)}',
      '#h21 .h21-how .h21-c1,#h21 .h21-how .h21-c2,#h21 .h21-how .h21-c3{font-weight:600}',
      '#h21 .h21-plan{position:absolute;top:5px;width:10px;height:10px;margin-left:-5px;border-radius:50%;border:2px solid ' + BAR + ';background:#fff;box-sizing:border-box}',
      '#h21 .h21-kplan{display:inline-block;width:9px;height:9px;border-radius:50%;border:2px solid ' + BAR + ';margin:0 3px -1px 8px;box-sizing:border-box}',
      '#h21 .h21-gapc{display:flex;flex-direction:column;align-items:flex-end;gap:3px}',
      '#h21 .h21-split{display:flex;align-items:center;gap:5px;font-size:10.5px;color:#6e6e73;font-variant-numeric:tabular-nums}',
      '#h21 .h21-stack{display:flex;width:38px;height:6px;border-radius:3px;overflow:hidden;background:#f0f0f3}',
      '#h21 .h21-stack i{display:block;height:6px}',
      '#h21 .h21-sp{background:' + BAR + '}#h21 .h21-sh{background:#ff9f0a}#h21 .h21-neg{opacity:.35}',
      '#h21 .h21-hdr{border-top:none;font-size:11px;color:#6e6e73;text-transform:uppercase;letter-spacing:.04em;padding-top:0}',
      '#h21 .h21-tot{font-weight:600}',
      '#h21 .h21-num{text-align:right;font-variant-numeric:tabular-nums}',
      '#h21 .h21-num small{display:block;font-size:11px;font-weight:500}',
      '#h21 .h21-lyv{color:#3a3a3c}',
      '#h21 .h21-viz{position:relative;height:22px}',
      '#h21 .h21-bar{position:absolute;top:4px;height:14px;border-radius:3px;background:' + BAR + ';opacity:.85}',
      '#h21 .h21-tot .h21-bar{opacity:1}',
      '#h21 .h21-tick{position:absolute;top:0;width:3px;height:22px;margin-left:-1.5px;border-radius:1px;background:' + LYC + '}',
      '#h21 .h21-zero{position:absolute;top:0;width:1px;height:22px;background:#c7c7cc}',
      '#h21 .h21-kbar{display:inline-block;width:14px;height:8px;background:' + BAR + ';border-radius:2px;margin:0 3px 0 4px}',
      '#h21 .h21-ktick{display:inline-block;width:3px;height:11px;background:' + LYC + ';margin:0 3px -1px 8px}',
      '#h21 .h21-gap{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;border-radius:6px;padding:3px 6px}',
      '#h21 .h21-hard{color:#b3261e;background:#fdecea}#h21 .h21-soft{color:#146c43;background:#e6f4ec}#h21 .h21-even{color:#3a3a3c;background:#f2f2f5}',
      '#h21 .h21-up{color:' + UP + '}#h21 .h21-dn{color:' + DOWN + '}',
      '#h21 .h21-muted{color:#6e6e73;font-weight:400}',
      '#h21 .h21-foot{color:#8e8e93;font-size:11.5px;margin-top:12px;line-height:1.5}',
      '#h21 .h21-err,#h21 .h21-load{color:#6e6e73;font-size:14px}',
    ].join('\n');
    document.head.appendChild(css);
    panel = document.createElement('div');
    panel.id = 'h21';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'H2 Budget vs H1');
    panel.style.display = 'none';
    panel.innerHTML = '<div class="h21-wrap"><div class="h21-top"><h2>H2 Budget vs H1 real · ¿qué tan exigente es el H2?</h2>' +
      '<div class="h21-org" role="group" aria-label="Organic"><span>Organic</span>' +
      '<button type="button" data-o="yes">YES</button><button type="button" data-o="no">NO</button></div>' +
      '<button type="button" class="h21-close">← Volver al P&amp;L</button></div><div class="h21-body"></div></div>';
    panel.querySelector('.h21-close').onclick = close;
    Array.prototype.forEach.call(panel.querySelectorAll('.h21-org button'), function (b) {
      b.onclick = function () { setOrganic(b.dataset.o === 'yes'); };
    });
    document.body.appendChild(panel);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && panel.style.display !== 'none') close(); });
    return panel;
  }

  function place() {
    var nav = document.getElementById('ownia-hubnav');
    var top = nav ? nav.getBoundingClientRect().bottom : 0;
    panel.style.top = Math.max(0, Math.round(top)) + 'px';
  }

  function close() { if (panel) panel.style.display = 'none'; }

  function syncOrg() {
    var on = organicOn();
    Array.prototype.forEach.call(panel.querySelectorAll('.h21-org button'), function (b) {
      b.setAttribute('aria-pressed', String((b.dataset.o === 'yes') === on));
    });
  }

  // Mismo switch que el del Hub (setOrganic recarga el P&L de atrás); la vista se recalcula con el nuevo modo.
  function setOrganic(on) {
    if (on === organicOn()) return;
    if (typeof window.setOrganic === 'function') window.setOrganic(on);
    else if (window._state) window._state.organic = on;
    load();
  }

  function load() {
    syncOrg();
    var h = halves();
    body().innerHTML = '<p class="h21-load">Cargando H1 y H2…</p>';
    Promise.all([fetchData(h.h1), fetchData(h.h2)])
      .then(function (r) { render(r[0], r[1]); })
      .catch(function (e) { body().innerHTML = '<p class="h21-err">No se pudieron leer los datos: ' + esc((e && e.message) || e) + '</p>'; });
  }

  window.openH2vsH1 = function () {
    ensurePanel();
    place();
    panel.style.display = '';
    panel.scrollTop = 0;
    if (typeof window._closeNav === 'function') window._closeNav();
    load();
  };
  // Cualquier otra pestaña o cambio de LoB cierra la vista.
  document.addEventListener('DOMContentLoaded', function () {
    var orig = window.switchLob;
    if (typeof orig === 'function') window.switchLob = function () { close(); return orig.apply(this, arguments); };
    window.addEventListener('resize', function () { if (panel && panel.style.display !== 'none') place(); });
  });
})();
