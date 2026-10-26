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
 * contra el año pasado) y el efecto H1 (cómo salió el H1 real contra su Budget). A la derecha, los
 * challenges ordenados de mayor a menor, contados según su causa.
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

  // Barra = H2/H1 que asume el Budget; marca negra = H2/H1 del año pasado. La distancia es el challenge.
  function block(title, list) {
    var vals = [];
    list.forEach(function (r) { [r.bud, r.ly, r.inBud].forEach(function (v) { if (isFinite(v)) vals.push(v); }); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(1, Math.max.apply(null, vals));
    var span = hi - lo, x = function (v) { return ((v - lo) / span * 100).toFixed(1) + '%'; };
    var body = list.map(function (r) {
      var from = Math.min(0, r.bud), to = Math.max(0, r.bud);
      var bar = isFinite(r.bud) ? '<span class="h21-bar" style="left:' + x(from) + ';width:calc(' + x(to) + ' - ' + x(from) + ')"></span>' : '';
      var tick = isFinite(r.ly) ? '<span class="h21-tick" style="left:' + x(r.ly) + '" title="Año pasado: ' + fmtP(r.ly) + '"></span>' : '';
      var plan = isFinite(r.inBud) ? '<span class="h21-plan" style="left:' + x(r.inBud) + '" title="Dentro del Budget: ' + fmtP(r.inBud) + '"></span>' : '';
      var zero = lo < 0 ? '<span class="h21-zero" style="left:' + x(0) + '"></span>' : '';
      var gc = !isFinite(r.gap) ? '' : r.gap > 5 ? 'h21-hard' : r.gap < -5 ? 'h21-soft' : 'h21-even';
      return '<div class="h21-row' + (r.seg === 'total' ? ' h21-tot' : '') + '">' +
        '<div class="h21-seg">' + esc(r.name) + '</div>' +
        '<div class="h21-num">' + fmtM(r.h1) + '<small class="' + (r.h1VsBud >= 0 ? 'h21-up' : 'h21-dn') + '">' + fmtP(r.h1VsBud) + ' vs Bud</small></div>' +
        '<div class="h21-num">' + fmtM(r.h2) + '</div>' +
        '<div class="h21-viz">' + zero + bar + plan + tick + '<span class="h21-vlab" style="left:calc(' + x(Math.max(0, r.bud)) + ' + 6px)">' + fmtP(r.bud) + '</span></div>' +
        '<div class="h21-num h21-lyv">' + fmtP(r.inBud) + '</div>' +
        '<div class="h21-num h21-lyv">' + fmtP(r.ly) + '</div>' +
        '<div class="h21-gapc"><div class="h21-gap ' + gc + '">' + fmtPP(r.gap) + '</div>' +
          '<div class="h21-split">' + split(r) + '</div></div>' +
        '</div>';
    }).join('');
    return '<section class="h21-block"><h3>' + title + '</h3>' +
      '<div class="h21-row h21-hdr"><div></div><div>H1 real</div><div>H2 Budget</div>' +
      '<div>H2 Budget vs H1 real <span class="h21-key"><i class="h21-kbar"></i>vs H1 real <i class="h21-kplan"></i>en el Budget <i class="h21-ktick"></i>año pasado</span></div>' +
      '<div>En el Budget</div><div>Año pasado</div><div>Challenge<br><span class="h21-hsub">plan · efecto H1</span></div></div>' + body + '</section>';
  }

  // Challenges ordenados de mayor a menor (los segmentos, no el total), con la frase para contar.
  function challenges(all) {
    var list = [];
    METRICS.forEach(function (m) { all[m[0]].forEach(function (r) { if (r.seg !== 'total' && isFinite(r.gap)) list.push(r); }); });
    list.sort(function (a, b) { return b.gap - a.gap; });
    var hard = list.filter(function (r) { return r.gap > 5; });
    var soft = list.filter(function (r) { return r.gap < -5; });
    // Por qué: lo que planeó el Budget sobre la estacionalidad vs el rebase por el H1 real.
    function why(r) {
      var h1 = 'el H1 real quedó ' + fmtP(r.h1VsBud) + ' vs su Budget';
      if (Math.abs(r.h1eff) > Math.abs(r.plan)) {
        return r.h1eff > 0
          ? 'El Budget planeaba un H2 ' + fmtP(r.inBud) + ' sobre el H1 (≈ estacionalidad); el esfuerzo viene de recuperar el H1: ' + h1 + '.'
          : 'El Budget planeaba un H2 ' + fmtP(r.inBud) + ' sobre el H1; ' + h1 + ', y eso deja un H2 más alcanzable.';
      }
      return 'Ya en el Budget el H2 crecía ' + fmtP(r.inBud) + ' sobre el H1 (año pasado ' + fmtP(r.ly) + ')' +
        (r.h1eff < -5 ? '; ' + h1 + ' y absorbe ' + fmtPP(-r.h1eff) + '.' : r.h1eff > 5 ? ', y ' + h1 + ' (suma ' + fmtPP(r.h1eff) + ').' : '.');
    }
    function li(r) {
      return '<li><b>' + esc(r.name) + ' · ' + esc(r.metric) + '</b> <b class="' + (r.gap > 0 ? 'h21-dn' : 'h21-up') + '">' + fmtPP(r.gap) + '</b><br>' +
        'H2 Budget ' + fmtP(r.bud) + ' sobre el H1 real (año pasado: ' + fmtP(r.ly) + ').<br><span class="h21-muted">' + why(r) + '</span></li>';
    }
    return '<section class="h21-chal"><h3>Los challenges del Budget H2</h3>' +
      (hard.length ? '<ol>' + hard.map(li).join('') + '</ol>' : '<p class="h21-muted">Ningún segmento pide más de 5 pp sobre la estacionalidad del año pasado.</p>') +
      (soft.length ? '<h4>Por debajo de la estacionalidad</h4><ul>' + soft.map(li).join('') + '</ul>' : '') +
      '</section>';
  }

  function headline(all) {
    var nr = all.nr[0], oc = all.oc[0];
    return 'El Budget asume un H2 <b>' + fmtP(nr.bud) + '</b> en Net Revenue y <b>' + fmtP(oc.bud) + '</b> en Operating Contribution sobre el H1 real; ' +
      'el año pasado el H2 creció ' + fmtP(nr.ly) + ' y ' + fmtP(oc.ly) + ' sobre su H1 (' + fmtPP(nr.gap) + ' / ' + fmtPP(oc.gap) + '). ' +
      '<span class="h21-muted">Dentro del Budget el plan era ' + fmtP(nr.inBud) + ' / ' + fmtP(oc.inBud) + ' (' + fmtPP(nr.plan) + ' / ' + fmtPP(oc.plan) + '); ' +
      'el H1 real ' + (nr.h1eff + oc.h1eff < 0 ? 'por encima de su Budget lo bajó' : 'por debajo de su Budget lo subió') + ' ' +
      fmtPP(nr.h1eff) + ' / ' + fmtPP(oc.h1eff) + '.</span>';
  }

  function render(h1r, h2r) {
    var h1 = pick(h1r), h2 = pick(h2r);
    if (!h1.nr || !h2.nr || !h1.oc || !h2.oc) {
      body().innerHTML = '<p class="h21-err">No llegaron los datos del P&amp;L para armar la vista.</p>';
      return;
    }
    var all = rows(h1, h2), yr = fy(), org = organicOn(), ly = 'FY' + String(yr - 1).slice(-2);
    var p = all.nr[0].proj, q = all.oc[0].proj;
    body().innerHTML =
      '<p class="h21-head1">' + headline(all) + '</p>' +
      '<div class="h21-sub">H1 real abr–sep ' + (yr - 1) + ' · H2 Budget oct ' + (yr - 1) + '–mar ' + yr + ' · USD · ' +
        '<span class="h21-mode">' + (org ? 'Organic YES: H1 real a TC Budget' : 'Organic NO: USD nominales') + '</span></div>' +
      '<div class="h21-layout"><div class="h21-left">' + block('Net Revenue', all.nr) + block('Operating Contribution', all.oc) + '</div>' +
        challenges(all) + '</div>' +
      '<p class="h21-foot"><b>Challenge</b> = crecimiento H2 Budget vs H1 real menos el H2 vs H1 que tuvo el ' + ly + ' (estacionalidad normal); ' +
        'en verde lo que pide menos que el año pasado. Se parte en <b>plan</b> (H2 vs H1 dentro del Budget menos el año pasado) y ' +
        '<b>efecto H1</b> (lo que agrega o resta que el H1 real haya quedado debajo o encima de su Budget). Hoy se proyecta un H2 (real + Run Rate) ' + fmtP(p) + ' en NR y ' + fmtP(q) + ' en OC vs Budget. ' +
        (yr === LY_ADJ_FY ? 'OC ' + ly + ' H1 sin el pago extraordinario LATAM de USD 5.6M (jun-25, B2B2C), como en la presentación de dirección. ' : '') +
        'Fuente: P&amp;L contable del Hub.</p>';
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
      '#h21 .h21-head1{font-size:17px;line-height:1.45;margin:10px 0 4px}',
      '#h21 .h21-sub{color:#6e6e73;font-size:12.5px;margin:0 0 14px}',
      '#h21 .h21-mode{background:#ece7fd;color:#3d0bb0;border-radius:6px;padding:1px 7px;font-weight:600}',
      '#h21 .h21-layout{display:grid;grid-template-columns:minmax(0,2.1fr) minmax(0,1fr);gap:16px;align-items:start}',
      '@media (max-width:1000px){#h21 .h21-layout{grid-template-columns:1fr}}',
      '#h21 section{background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}',
      '#h21 .h21-left section+section{margin-top:14px}',
      '#h21 h3{font-size:15px;font-weight:600;margin:0 0 8px}',
      '#h21 h4{font-size:13px;font-weight:600;margin:12px 0 6px;color:#6e6e73}',
      '#h21 .h21-row{display:grid;grid-template-columns:112px 88px 66px minmax(150px,1fr) 66px 62px 104px;gap:9px;align-items:center;padding:7px 0;border-top:1px solid #f0f0f3;font-size:13.5px}',
      '#h21 .h21-hsub{text-transform:none;letter-spacing:0}',
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
      '#h21 .h21-vlab{position:absolute;top:2px;font-size:12px;font-weight:600;white-space:nowrap}',
      '#h21 .h21-key{text-transform:none;letter-spacing:0;margin-left:6px}',
      '#h21 .h21-kbar{display:inline-block;width:14px;height:8px;background:' + BAR + ';border-radius:2px;margin:0 3px 0 4px}',
      '#h21 .h21-ktick{display:inline-block;width:3px;height:11px;background:' + LYC + ';margin:0 3px -1px 8px}',
      '#h21 .h21-gap{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;border-radius:6px;padding:3px 6px}',
      '#h21 .h21-hard{color:#b3261e;background:#fdecea}#h21 .h21-soft{color:#146c43;background:#e6f4ec}#h21 .h21-even{color:#3a3a3c;background:#f2f2f5}',
      '#h21 .h21-up{color:' + UP + '}#h21 .h21-dn{color:' + DOWN + '}',
      '#h21 .h21-muted{color:#6e6e73;font-weight:400}',
      '#h21 .h21-chal ol,#h21 .h21-chal ul{margin:0;padding-left:20px;font-size:13.5px;line-height:1.5}',
      '#h21 .h21-chal li{margin-bottom:9px}',
      '#h21 .h21-foot{color:#8e8e93;font-size:11.5px;margin-top:12px;line-height:1.5}',
      '#h21 .h21-err,#h21 .h21-load{color:#6e6e73;font-size:14px}',
    ].join('\n');
    document.head.appendChild(css);
    panel = document.createElement('div');
    panel.id = 'h21';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'H2 Budget vs H1');
    panel.style.display = 'none';
    panel.innerHTML = '<div class="h21-wrap"><div class="h21-top"><h2>H2 Budget vs H1 · el challenge que asume el Budget</h2>' +
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
