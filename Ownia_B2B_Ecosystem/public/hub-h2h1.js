/* Vista "H2 vs H1" del P&L Dashboard (Hub) en Ownia (2026-10-26, para dirección). La inyecta
 * server/index.js en el Hub (`layout` en server/modules.js); se abre desde la pestaña "H2 vs H1"
 * (botón #nav-h2h1 de Dashboard_B2B_WLs/dashboard.html, clasificado en PRIMARY de hub-layout.js).
 *
 * Mismo formato que la slide de dirección "H1 actual vs H2 Budget": H1 real (abr–sep) contra H2 Budget
 * (oct–mar), Net Revenue y Operating Contribution, B2B2C y B2B. Suma la proyección de hoy del H2
 * (real + Run Rate, el baseline del Hub) contra el Budget, y los "desafíos" del H2 (dónde el Budget
 * pide acelerar el crecimiento interanual respecto del H1).
 *
 * Datos: getAllData del Hub (los mismos números que el resto del dashboard), dos llamadas — H1 y H2 —
 * con LoB Consolidado, que trae los grupos WL's (= B2B2C), MAY y MIN (MAY + MIN = B2B) y Total.
 * Respeta el switch Organic del Hub (Goal Budget → H1 real a TC Budget; YoY del H1 a TC Actuals LY,
 * como el resto del Hub). El YoY del H2 es Budget vs real FY26 en USD.
 */
(function () {
  'use strict';

  var C_B2B2C = '#550fed', C_B2B = '#ffaa44', OK = '#1a9e5a', BAD = '#d4373a';
  // YoY del OC H1 ajustado como en la presentación de dirección: el FY26 incluye un pago extraordinario
  // LATAM de USD 5.6M (jun-25) que deprime el OC del año anterior (cae en B2B2C). Se suma al LY del OC
  // B2B2C del H1 solo para el YoY (los montos no cambian). Solo FY27; sacarlo cuando no aplique.
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

  // {nr|oc|gb: {b2b2c|b2b|total: {act, bud, ly, yoy}}} desde result.pnl (grupos WL's / MAY / MIN / Total)
  function pick(result) {
    var pnl = result && result.pnl, out = {};
    if (!pnl || !pnl.rows) return out;
    var g = pnl.groups || [];
    var iW = g.indexOf("WL's"), iMay = g.indexOf('MAY'), iMin = g.indexOf('MIN'), iT = g.indexOf('Total');
    pnl.rows.forEach(function (r) {
      if (['gb', 'nr', 'oc'].indexOf(r.id) < 0) return;
      function one(c) {
        c = c || {};
        var ly = c.lyVal || 0;
        // Valor "organic" del año: el YoY del Hub ya viene a TC Actuals LY con Organic YES.
        return { act: c.actual || 0, bud: c.budget || 0, ly: ly, ly1: isFinite(c.yoyPct) ? ly * (1 + c.yoyPct / 100) : (c.actual || 0) };
      }
      var w = one(r.cols[iW]), a = one(r.cols[iMay]), b = one(r.cols[iMin]), t = one(r.cols[iT]);
      var b2b = { act: a.act + b.act, bud: a.bud + b.bud, ly: a.ly + b.ly, ly1: a.ly1 + b.ly1 };
      out[r.id] = { b2b2c: w, b2b: b2b, total: t };
    });
    return out;
  }

  function pct(a, b) { return b ? (a / b - 1) * 100 : NaN; }
  function fmtM(v) {
    var m = v / 1e6, a = Math.abs(m);
    return (m < 0 ? '−' : '') + 'USD ' + (a >= 100 ? a.toFixed(0) : a.toFixed(1)) + 'M';
  }
  function fmtShortM(v) { var m = v / 1e6, a = Math.abs(m); return (m < 0 ? '−' : '') + (a >= 100 ? a.toFixed(0) : a.toFixed(1)) + 'M'; }
  function fmtP(v, dec) {
    if (!isFinite(v)) return '—';
    var d = dec == null ? 0 : dec;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
  }
  function cls(v) { return !isFinite(v) ? '' : v >= 0 ? 'h21-up' : 'h21-dn'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ── Armado ────────────────────────────────────────────────────────────────────────────────
  function card(title, k, h1, h2) {
    var a = h1[k], b = h2[k], gb1 = h1.gb.total.act, gb2 = h2.gb.total.bud;
    var yoy1 = pct(a.total.ly1, a.total.ly), yoy2 = pct(b.total.bud, b.total.ly);
    var vsBud1 = pct(a.total.act, a.total.bud), vsH1 = pct(b.total.bud, a.total.act);
    var proj = b.total.act, gap = pct(proj, b.total.bud);
    var star = (k === 'oc' && fy() === LY_ADJ_FY) ? '*' : '';
    var marg = function (v, gb) { return k === 'oc' && gb ? ' <span class="h21-marg">' + (v / gb * 100).toFixed(1) + '% s/GB</span>' : ''; };
    function lobs(get) {
      return '<div class="h21-lobs"><span><i style="background:' + C_B2B2C + '"></i>B2B2C <b class="' + cls(get('b2b2c')) + '">' + fmtP(get('b2b2c')) + '</b></span>' +
        '<span><i style="background:' + C_B2B + '"></i>B2B <b class="' + cls(get('b2b')) + '">' + fmtP(get('b2b')) + '</b></span></div>';
    }
    return '<section class="h21-card"><h3>' + title + '</h3><div class="h21-cols">' +
      '<div class="h21-col"><div class="h21-tag">H1 real</div>' +
        '<div class="h21-big">' + fmtM(a.total.act) + marg(a.total.act, gb1) + '</div>' +
        '<div class="h21-line"><b class="' + cls(vsBud1) + '">' + fmtP(vsBud1) + '</b> vs Budget H1</div>' +
        lobs(function (l) { return pct(a[l].act, a[l].bud); }) +
        '<div class="h21-line h21-muted">YoY <b class="' + cls(yoy1) + '">' + fmtP(yoy1) + star + '</b> · B2B2C ' + fmtP(pct(a.b2b2c.ly1, a.b2b2c.ly)) + star + ' · B2B ' + fmtP(pct(a.b2b.ly1, a.b2b.ly)) + '</div>' +
      '</div>' +
      '<div class="h21-col h21-col2"><div class="h21-tag">H2 Budget</div>' +
        '<div class="h21-big">' + fmtM(b.total.bud) + marg(b.total.bud, gb2) + '</div>' +
        '<div class="h21-line"><b class="' + cls(vsH1) + '">' + fmtP(vsH1) + '</b> vs H1 real</div>' +
        lobs(function (l) { return pct(b[l].bud, a[l].act); }) +
        '<div class="h21-line h21-muted">YoY <b class="' + cls(yoy2) + '">' + fmtP(yoy2) + '</b> · B2B2C ' + fmtP(pct(b.b2b2c.bud, b.b2b2c.ly)) + ' · B2B ' + fmtP(pct(b.b2b.bud, b.b2b.ly)) + '</div>' +
      '</div></div>' +
      '<div class="h21-proj">Proyección H2 hoy (real + Run Rate): <b>' + fmtM(proj) + '</b> · <b class="' + cls(gap) + '">' + fmtP(gap, 1) + '</b> vs H2 Budget' +
        ' <span class="h21-muted">(B2B2C ' + fmtP(pct(b.b2b2c.act, b.b2b2c.bud), 1) + ' · B2B ' + fmtP(pct(b.b2b.act, b.b2b.bud), 1) + ')</span></div>' +
      '</section>';
  }

  // Barras agrupadas H1 / H2 × B2B2C / B2B con el YoY arriba (SVG, sin librerías)
  function chart(title, k, h1, h2) {
    var bars = [
      { h: 'H1', lob: 'b2b2c', v: h1[k].b2b2c.act, yoy: pct(h1[k].b2b2c.ly1, h1[k].b2b2c.ly) },
      { h: 'H1', lob: 'b2b', v: h1[k].b2b.act, yoy: pct(h1[k].b2b.ly1, h1[k].b2b.ly) },
      { h: 'H2', lob: 'b2b2c', v: h2[k].b2b2c.bud, yoy: pct(h2[k].b2b2c.bud, h2[k].b2b2c.ly) },
      { h: 'H2', lob: 'b2b', v: h2[k].b2b.bud, yoy: pct(h2[k].b2b.bud, h2[k].b2b.ly) },
    ];
    var W = 460, H = 250, base = 210, top = 40, bw = 78;
    var max = Math.max.apply(null, bars.map(function (b) { return Math.max(b.v, 0); })) || 1;
    var xs = [40, 40 + bw, 262, 262 + bw];
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + '">';
    bars.forEach(function (b, i) {
      var h = Math.max(b.v, 0) / max * (base - top), y = base - h;
      svg += '<rect x="' + xs[i] + '" y="' + y.toFixed(1) + '" width="' + bw + '" height="' + h.toFixed(1) + '" rx="3" fill="' + (b.lob === 'b2b2c' ? C_B2B2C : C_B2B) + '"/>';
      svg += '<text x="' + (xs[i] + bw / 2) + '" y="' + (y + h / 2 + 6).toFixed(1) + '" class="h21-bv">' + fmtShortM(b.v) + '</text>';
      var star = (k === 'oc' && b.h === 'H1' && b.lob === 'b2b2c' && fy() === LY_ADJ_FY) ? '*' : '';
      svg += '<text x="' + (xs[i] + bw / 2) + '" y="' + (y - 8).toFixed(1) + '" class="h21-by" fill="' + (b.yoy >= 0 ? OK : BAD) + '">' + fmtP(b.yoy) + star + '</text>';
    });
    svg += '<line x1="20" x2="' + (W - 20) + '" y1="' + base + '" y2="' + base + '" stroke="#d0d0d8"/>';
    svg += '<text x="' + (40 + bw) + '" y="' + (base + 26) + '" class="h21-bx">H1 real</text>';
    svg += '<text x="' + (262 + bw) + '" y="' + (base + 26) + '" class="h21-bx">H2 Budget</text>';
    svg += '</svg>';
    return '<section class="h21-chart"><h3>' + title + ' <span class="h21-muted">(USD M · YoY arriba de cada barra)</span></h3>' + svg + '</section>';
  }

  // "Lo que exige el H2": el YoY del Budget H2 vs el YoY real del H1, por LoB y métrica
  function challenges(h1, h2) {
    var items = [];
    [['nr', 'Net Revenue'], ['oc', 'Operating Contribution']].forEach(function (m) {
      [['b2b2c', 'B2B2C'], ['b2b', 'B2B']].forEach(function (l) {
        var y1 = pct(h1[m[0]][l[0]].ly1, h1[m[0]][l[0]].ly), y2 = pct(h2[m[0]][l[0]].bud, h2[m[0]][l[0]].ly);
        var proj = pct(h2[m[0]][l[0]].act, h2[m[0]][l[0]].bud);
        if (isFinite(y1) && isFinite(y2)) items.push({ d: y2 - y1, txt: '<b>' + l[1] + ' ' + m[1] + '</b>: el Budget pide crecer <b>' + fmtP(y2) + '</b> YoY en H2 (H1 real: ' + fmtP(y1) + ')' +
          (isFinite(proj) ? ' · hoy se proyecta <b class="' + cls(proj) + '">' + fmtP(proj, 1) + '</b> vs Budget' : '') });
      });
    });
    items.sort(function (a, b) { return b.d - a.d; });
    var acel = items.filter(function (x) { return x.d > 5; });
    var list = (acel.length ? acel : items.slice(0, 2)).map(function (x) { return '<li>' + x.txt + '</li>'; }).join('');
    return '<section class="h21-chal"><h3>Lo que exige el H2 Budget</h3><ul>' + list + '</ul></section>';
  }

  function render(h1r, h2r) {
    var h1 = pick(h1r), h2 = pick(h2r);
    if (!h1.nr || !h2.nr || !h1.oc || !h2.oc || !h1.gb || !h2.gb) {
      body().innerHTML = '<p class="h21-err">No llegaron los datos del P&amp;L para armar la vista.</p>';
      return;
    }
    var yr = fy(), org = organicOn(), adj = yr === LY_ADJ_FY;
    if (adj) { h1.oc.b2b2c.ly += LY_ADJ_OC_B2B2C_H1; h1.oc.total.ly += LY_ADJ_OC_B2B2C_H1; }
    body().innerHTML =
      '<div class="h21-sub">H1 real (abr–sep ' + (yr - 1) + ') vs H2 Budget (oct ' + (yr - 1) + '–mar ' + yr + ') · B2B + B2B2C · ' +
        (org ? 'Organic: real a TC Budget' : 'USD nominales') + '</div>' +
      '<div class="h21-grid">' + card('Net Revenue', 'nr', h1, h2) + card('Operating Contribution', 'oc', h1, h2) + '</div>' +
      '<div class="h21-legend"><span><i style="background:' + C_B2B2C + '"></i>B2B2C</span><span><i style="background:' + C_B2B + '"></i>B2B</span></div>' +
      '<div class="h21-grid">' + chart('Net Revenue', 'nr', h1, h2) + chart('Operating Contribution', 'oc', h1, h2) + '</div>' +
      challenges(h1, h2) +
      '<p class="h21-foot">Fuente: P&amp;L contable del Hub (H1 = actuals; proyección H2 = real de los meses cerrados + Run Rate). ' +
        'YoY H1 = real vs FY' + String(yr - 1).slice(-2) + (org ? ' (Organic a TC Actuals LY, como el resto del Hub)' : '') +
        '; YoY H2 = Budget vs real FY' + String(yr - 1).slice(-2) + ' en USD. Margen de OC sobre Gross Bookings.' +
        (adj ? ' <b>*</b> YoY del OC H1 ajustado: excluye del FY26 el pago extraordinario LATAM de USD 5.6M (jun-25, B2B2C).' : '') + '</p>';
  }

  function body() { return panel.querySelector('.h21-body'); }

  function ensurePanel() {
    if (panel) return panel;
    var css = document.createElement('style');
    css.textContent = [
      '#h21{position:fixed;left:0;right:0;bottom:0;z-index:40;background:#f5f5f7;overflow:auto;font-family:Poppins,-apple-system,"Segoe UI",sans-serif;color:#1d1d1f}',
      '#h21 .h21-wrap{max-width:1180px;margin:0 auto;padding:22px 24px 40px}',
      '#h21 .h21-head{display:flex;align-items:center;gap:14px;margin-bottom:4px}',
      '#h21 h2{font-size:22px;font-weight:600;margin:0}',
      '#h21 .h21-close{margin-left:auto;border:1px solid #d0d0d8;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit;font-size:13px}',
      '#h21 .h21-sub{color:#6e6e73;font-size:13px;margin:0 0 16px}',
      '#h21 .h21-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}',
      '@media (max-width:900px){#h21 .h21-grid{grid-template-columns:1fr}}',
      '#h21 section{background:#fff;border-radius:14px;padding:16px 18px;box-shadow:0 1px 3px rgba(0,0,0,.06)}',
      '#h21 h3{font-size:15px;font-weight:600;margin:0 0 10px}',
      '#h21 .h21-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
      '#h21 .h21-col2{border-left:1px solid #ececf0;padding-left:14px}',
      '#h21 .h21-tag{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6e6e73;margin-bottom:2px}',
      '#h21 .h21-big{font-size:26px;font-weight:600;margin-bottom:6px}',
      '#h21 .h21-marg{font-size:13px;font-weight:500;color:#6e6e73;margin-left:4px}',
      '#h21 .h21-line{font-size:13px;margin:3px 0}',
      '#h21 .h21-lobs{display:flex;gap:12px;font-size:13px;margin:4px 0}',
      '#h21 .h21-lobs i,#h21 .h21-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}',
      '#h21 .h21-legend{display:flex;gap:16px;font-size:13px;margin:0 0 8px 4px}',
      '#h21 .h21-muted{color:#6e6e73;font-weight:400}',
      '#h21 .h21-up{color:' + OK + '}#h21 .h21-dn{color:' + BAD + '}',
      '#h21 .h21-proj{margin-top:12px;padding-top:10px;border-top:1px solid #ececf0;font-size:13px}',
      '#h21 svg{width:100%;height:auto;display:block}',
      '#h21 .h21-bv{fill:#fff;font-size:15px;font-weight:600;text-anchor:middle}',
      '#h21 .h21-by{font-size:13px;font-weight:600;text-anchor:middle}',
      '#h21 .h21-bx{fill:#3a3a3c;font-size:14px;font-weight:600;text-anchor:middle}',
      '#h21 .h21-chal ul{margin:0;padding-left:18px;font-size:14px;line-height:1.7}',
      '#h21 .h21-foot{color:#8e8e93;font-size:11.5px;margin-top:14px}',
      '#h21 .h21-err,#h21 .h21-load{color:#6e6e73;font-size:14px}',
    ].join('\n');
    document.head.appendChild(css);
    panel = document.createElement('div');
    panel.id = 'h21';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'H2 Budget vs H1');
    panel.style.display = 'none';
    panel.innerHTML = '<div class="h21-wrap"><div class="h21-head"><h2>H2 Budget vs H1</h2>' +
      '<button type="button" class="h21-close">← Volver al P&amp;L</button></div><div class="h21-body"></div></div>';
    panel.querySelector('.h21-close').onclick = close;
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

  window.openH2vsH1 = function () {
    ensurePanel();
    place();
    panel.style.display = '';
    panel.scrollTop = 0;
    if (typeof window._closeNav === 'function') window._closeNav();
    var h = halves();
    body().innerHTML = '<p class="h21-load">Cargando H1 y H2…</p>';
    Promise.all([fetchData(h.h1), fetchData(h.h2)])
      .then(function (r) { render(r[0], r[1]); })
      .catch(function (e) { body().innerHTML = '<p class="h21-err">No se pudieron leer los datos: ' + esc((e && e.message) || e) + '</p>'; });
  };
  // Cualquier otra pestaña o cambio de LoB cierra la vista.
  document.addEventListener('DOMContentLoaded', function () {
    var orig = window.switchLob;
    if (typeof orig === 'function') window.switchLob = function () { close(); return orig.apply(this, arguments); };
    window.addEventListener('resize', function () { if (panel && panel.style.display !== 'none') place(); });
  });
})();
