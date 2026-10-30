/* Flow semanal "estilo Minto" (2026-10-30, Diego). Solo en el modo Presentaciones (<base>/daily?flowdeck=1); el HTML de Apps
 * Script no cambia. Va después de las otras capas del Flow (daily-flow-slides.js, daily-ceo-weekly.js, daily-flowdeck.js): toma
 * el deck que dejaron armado.
 *
 *  1. "La semana en 3 líneas": slide de resumen al principio con la respuesta (cómo viene el mes) y los tres argumentos
 *     (B2B2C, B2B API, B2B HTML): NR y FVM MTD vs el Goal, últimos 7 días y dónde está el desvío.
 *  2. Vista Ejecutiva / Completa (switch "Vista" de la barra, se recuerda en el navegador). Ejecutiva = resumen + portada +
 *     OKR NR / FVM + KRs + solo las regiones que se desvían ±5% o más en NR (con un separador-pregunta) + Weekly RI + B2B (RI).
 *     Completa = lo mismo y, detrás de un separador "Anexo", el resto del deck en el orden de siempre.
 *  3. Títulos con la conclusión: en la portada, las slides OKR y las de cada región el título dice qué pasa (Δ vs Goal, quién
 *     lo explica y la tendencia de los últimos 7 días); el título descriptivo de antes queda chico arriba.
 * B2B2C usa el Goal elegido en la barra (Budget / Run Rate / LY); B2B, como el Tracker, Recognition Date vs Budget.
 */
(function () {
  'use strict';
  if (!/[?&]flowdeck=1(&|$)/.test(location.search)) return;
  var W = window, LS = 'flm-mode', THR = 5;   // THR: % de desvío de NR MTD desde el que una región entra en la vista Ejecutiva
  var mode = 'exec';
  try { mode = localStorage.getItem(LS) === 'full' ? 'full' : 'exec'; } catch (e) { /* sin storage */ }
  var ORIG = null, REGS = ['BR', 'NAM', 'SAH'];
  var B2B_CH = [['API', 'B2B API (MAY)'], ['Agencias afiliadas', 'B2B HTML (MIN)']];

  var css = document.createElement('style');
  css.textContent = [
    '.fl-title.flm-t2{font-size:21px;line-height:1.25;max-width:1060px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.fl-title.flm-t2 small{display:block;font-size:12px;font-weight:600;color:var(--fl-ink3);letter-spacing:0;margin-bottom:1px}',
    '.flm-sum{display:flex;flex-direction:column;gap:12px}',
    '.flm-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;flex:1;min-height:0}',
    '.flm-card{border:1px solid var(--fl-line);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:9px;background:#fbfaff}',
    '.flm-h{font-size:15px;font-weight:800;color:var(--fl-purple);letter-spacing:.2px}',
    '.flm-msg{font-size:16px;font-weight:700;line-height:1.35;color:var(--fl-ink)}',
    '.flm-t{width:100%;border-collapse:collapse;font-size:12.5px}',
    '.flm-t th{font-size:10.5px;font-weight:700;color:var(--fl-ink3);text-align:right;padding:3px 4px;border-bottom:1px solid var(--fl-line)}',
    '.flm-t td{text-align:right;padding:5px 4px;border-bottom:1px solid var(--fl-line);white-space:nowrap}',
    '.flm-t td:first-child,.flm-t th:first-child{text-align:left}.flm-t td:first-child{font-weight:700;color:var(--fl-ink2)}',
    '.flm-up{color:var(--fl-green)!important}.flm-dn{color:var(--fl-red)!important}',
    '.flm-dr{font-size:12px;line-height:1.5;color:var(--fl-ink2)}.flm-dr b{color:var(--fl-ink)}',
    '.flm-dr ul{margin:2px 0 0;padding-left:16px}',
    '.flm-next{font-size:12.5px;color:var(--fl-ink2);background:#f3f0ff;border-radius:8px;padding:8px 12px}',
    '.flm-next b{color:var(--fl-purple)}',
    '.flm-wait{font-size:13px;color:var(--fl-ink3);font-style:italic}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  // ── Formato ────────────────────────────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fm(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v), s = v < 0 ? '−' : '';
    return s + '$' + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'K' : Math.round(a));
  }
  function fd(v) { return (v > 0 ? '+' : '') + fm(v); }
  function pc(v) { return v == null || !isFinite(v) ? 'n/d' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + '%'; }
  function cl(v) { return v == null || !isFinite(v) ? '' : v >= 0 ? 'flm-up' : 'flm-dn'; }
  function addDays(d, n) { var t = new Date(d + 'T12:00:00'); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); }
  function dlt(e) { return e ? { a: e.a, g: e.g, d: e.a - e.g, p: e.g ? (e.a - e.g) / Math.abs(e.g) * 100 : null } : { a: 0, g: 0, d: 0, p: null }; }
  function compLbl() { return (W.FLOW_COMP[W._flowComp] || {}).label || 'Budget'; }
  function ddmm(d) { return d.slice(8, 10) + '/' + d.slice(5, 7); }

  // ── B2B2C: actual vs Goal entre dos fechas, abierto por una clave (partner, región…) ─────────
  function win() {
    var vd = W.flowVDate_(), ms = vd.slice(0, 8) + '01', f7 = addDays(vd, -6);
    return { vd: vd, ms: ms, f7: f7 < ms ? ms : f7 };
  }
  function sums(sub, mk, cmp, from, to, keyFn) {
    var MF = W._FLMF[mk], arr = W._flCompArr_(sub, cmp), CF = W._flCompField_(mk, cmp), ly = cmp === 'ly', lf = W._flLY_(from), lt = W._flLY_(to), o = {};
    function e(r) { var k = keyFn ? keyFn(r) : '_'; return o[k] || (o[k] = { a: 0, g: 0 }); }
    (sub.actuals || []).forEach(function (r) { if (r.fecha >= from && r.fecha <= to) e(r).a += r[MF] || 0; });
    arr.forEach(function (r) {
      if (ly ? (r.fecha < lf || r.fecha > lt) : (r.fecha < from || r.fecha > to)) return;
      e(r).g += r[CF] || 0;
    });
    return o;
  }
  function drivers(o, sign) {
    return Object.keys(o).map(function (k) { var x = dlt(o[k]); x.k = k; return x; })
      .filter(function (x) { return Math.abs(x.d) >= 1; })
      .sort(function (a, b) { return sign < 0 ? a.d - b.d : b.d - a.d; });
  }
  function regLbl(r) { return (W.FLOW_RG[r] || {}).label || r; }
  function b2b2c(region, mk) {
    var w = win(), cmp = W._flowComp, sub = W.flowRegionRaw_(region || null);
    var t = dlt(sums(sub, mk, cmp, w.ms, w.vd)._), l7 = dlt(sums(sub, mk, cmp, w.f7, w.vd)._);
    var by = region ? function (r) { return r.partner || '—'; } : function (r) { return regLbl(W.getRegion_(r.pais)); };
    var dr = drivers(sums(sub, mk, cmp, w.ms, w.vd, by), t.d < 0 ? -1 : 1);
    return { t: t, l7: l7, dr: dr, w: w };
  }
  // Frase de conclusión: "NR MTD −6,2% vs Budget (−$0.4M); lo explica X (−$0.3M) · últimos 7 días −9,1%, empeora"
  function sentence(lbl, x, cmpL) {
    var s = lbl + ' ' + pc(x.t.p) + ' vs ' + cmpL + ' (' + fd(x.t.d) + ')';
    var top = x.dr[0];
    if (top && Math.sign(top.d) === Math.sign(x.t.d)) s += '; ' + (x.t.d < 0 ? 'resta' : 'suma') + ' más ' + top.k + ' (' + fd(top.d) + ')';
    if (x.l7.p != null && x.w.f7 > x.w.ms) {
      var tr = x.l7.p - (x.t.p || 0);
      s += ' · últ. 7 días ' + pc(x.l7.p) + (tr > 2 ? ', mejora' : tr < -2 ? ', empeora' : '');
    }
    return s;
  }

  // ── B2B (Tracker: Recognition Date vs Budget) por canal ──────────────────────────────────────
  function b2bReady() { return !!(W._rawB2B && W._rawB2B.meta && typeof W.trkGetPeriodBounds_ === 'function'); }
  function b2b(channel, mf) {
    var ym = W._flowMonth || W._rawB2B.meta.last_actuals_date.slice(0, 7), b = W.trkGetPeriodBounds_(ym);
    var acts = W.trkGetActualsOrg_('ri', 'budget'), goal = W.trkGetGoal_('ri', 'budget'), f7 = addDays(b.cutoff, -6);
    if (f7 < b.from) f7 = b.from;
    function agg(from, keyFn) {
      var o = {};
      function e(r) { var k = keyFn ? keyFn(r) : '_'; return o[k] || (o[k] = { a: 0, g: 0 }); }
      acts.forEach(function (r) { if (r.parent_channel === channel && r.fecha >= from && r.fecha <= b.cutoff) e(r).a += r[mf] || 0; });
      goal.forEach(function (r) { if (r.parent_channel === channel && r.fecha >= from && r.fecha <= b.cutoff) e(r).g += r[mf] || 0; });
      return o;
    }
    var t = dlt(agg(b.from)._), l7 = dlt(agg(f7)._);
    return { t: t, l7: l7, dr: drivers(agg(b.from, function (r) { return r.pais || '—'; }), t.d < 0 ? -1 : 1), w: { ms: b.from, f7: f7, vd: b.cutoff } };
  }

  // ── Slide "La semana en 3 líneas" ────────────────────────────────────────────────────────────
  function card(title, nr, fvm, cmpL, unit) {
    if (!nr) return '<div class="flm-card"><div class="flm-h">' + title + '</div><div class="flm-wait">Cargando datos de B2B…</div></div>';
    var row = function (lbl, x) {
      return '<tr><td>' + lbl + '</td><td>' + fm(x.t.a) + '</td><td>' + fm(x.t.g) + '</td><td class="' + cl(x.t.d) + '">' + fd(x.t.d) + '</td>' +
        '<td class="' + cl(x.t.p) + '">' + pc(x.t.p) + '</td><td class="' + cl(x.l7.p) + '">' + pc(x.l7.p) + '</td></tr>';
    };
    // solo lo material: al menos $1K y 3% del desvío total
    var min = Math.max(1000, Math.abs(nr.t.d) * 0.03), big = nr.dr.filter(function (d) { return Math.abs(d.d) >= min; });
    var dn = big.filter(function (d) { return d.d < 0; }).sort(function (x, y) { return x.d - y.d; }).slice(0, 2);
    var up = big.filter(function (d) { return d.d > 0; }).sort(function (x, y) { return y.d - x.d; }).slice(0, 2);
    if (nr.t.d >= 0) { var tmp = dn; dn = up; up = tmp; }
    var li = function (l) { return l.map(function (d) { return '<li>' + esc(d.k) + ' <span class="' + cl(d.d) + '">' + fd(d.d) + '</span></li>'; }).join(''); };
    return '<div class="flm-card"><div class="flm-h">' + title + '</div>' +
      '<div class="flm-msg">' + esc(sentence('NR MTD', nr, cmpL)) + '</div>' +
      '<table class="flm-t"><tr><th></th><th>MTD</th><th>' + esc(cmpL) + '</th><th>Δ</th><th>Δ %</th><th>Últ. 7 d</th></tr>' + row('NR', nr) + row('FVM', fvm) + '</table>' +
      '<div class="flm-dr"><b>' + (nr.t.d < 0 ? 'Explican el desvío' : 'Explican la mejora') + ' (NR, por ' + unit + '):</b><ul>' + (li(dn) || '<li>—</li>') + '</ul>' +
      (up.length ? '<b>Compensan:</b><ul>' + li(up) + '</ul>' : '') + '</div></div>';
  }
  function summaryHtml() {
    var cmpL = compLbl(), x = b2b2c(null, 'nr'), xf = b2b2c(null, 'fvm'), w = x.w, flagged = flaggedRegions();
    var ready = b2bReady(), api = ready ? b2b('API', 'net_revenue') : null, html = ready ? b2b('Agencias afiliadas', 'net_revenue') : null;
    var title = 'NR MTD: B2B2C ' + pc(x.t.p) + ' vs ' + cmpL + (ready ? ' · API ' + pc(api.t.p) + ' · HTML ' + pc(html.t.p) + ' vs Budget' : '');
    var kick = 'La semana en 3 líneas · ' + W.flowMonthName_(w.vd) + ' MTD al ' + ddmm(w.vd);
    var next = flagged.length
      ? 'Siguen en el deck las regiones que se desvían ±' + THR + '% o más en NR: <b>' + flagged.map(function (f) { return regLbl(f.r) + ' ' + pc(f.p); }).join(' · ') + '</b>.'
      : 'Ninguna región de B2B2C se desvía ±' + THR + '% o más en NR: no hay slides de región en la vista Ejecutiva.';
    if (mode === 'exec') next += ' El detalle completo está en la vista <b>Completa</b>.';
    return '<div class="flow-slide"><div class="fl-head"><div class="fl-title flm-t2" title="' + esc(title) + '"><small>' + esc(kick) + '</small>' + esc(title) + '</div>' +
      '<div class="fl-brand">' + W.flLogo_() + '</div></div><div class="fl-rule"></div>' +
      '<div class="fl-body flm-sum"><div class="flm-cards">' +
      card('B2B2C · White Labels <small style="font-weight:600;color:var(--fl-ink3)">vs ' + esc(cmpL) + '</small>', x, xf, cmpL, 'región') +
      card('B2B API (MAY) <small style="font-weight:600;color:var(--fl-ink3)">RI vs Budget</small>', api, ready ? b2b('API', 'fvm') : null, 'Budget', 'país') +
      card('B2B HTML (MIN) <small style="font-weight:600;color:var(--fl-ink3)">RI vs Budget</small>', html, ready ? b2b('Agencias afiliadas', 'fvm') : null, 'Budget', 'país') +
      '</div><div class="flm-next">' + next + '</div></div></div>';
  }

  // ── Deck Ejecutivo / Completo ────────────────────────────────────────────────────────────────
  function flaggedRegions() {
    return REGS.map(function (r) { var x = b2b2c(r, 'nr'); return { r: r, p: x.t.p }; })
      .filter(function (f) { return f.p != null && Math.abs(f.p) >= THR; })
      .sort(function (a, b) { return Math.abs(b.p) - Math.abs(a.p); });
  }
  function deckFor(m) {
    var pick = function (fn) { return ORIG.filter(fn); };
    var body = [{ kind: 'minto_summary', name: 'La semana en 3 líneas' }]
      .concat(pick(function (d) { return d.kind === 'cover'; }))
      .concat(pick(function (d) { return d.kind === 'okr' && !d.open && (d.metric === 'nr' || d.metric === 'fvm'); }))
      .concat(pick(function (d) { return d.kind === 'b2b2c_krs'; }));
    var cmpL = compLbl();
    flaggedRegions().forEach(function (f) {
      body.push({ kind: 'divider', region: f.r, title: '¿Por qué ' + regLbl(f.r) + ' viene ' + pc(f.p) + ' vs ' + cmpL + '?', name: '— ' + regLbl(f.r) + ' ' + pc(f.p) + ' —' });
      body = body.concat(pick(function (d) { return d.region === f.r && (d.kind === 'monthly' || (d.kind === 'daily' && d.metric === 'nr')); }));
    });
    // Weekly: en el Flow quedó solo la vista GD (daily-ceo-weekly.js saca las RI)
    body = body.concat(pick(function (d) { return (d.kind === 'weekly' && d.lob === 'B2B+B2B2C') || (d.kind === 'ceo_weekly' && d.n === 1); }));
    body.push({ kind: 'divider', flag: 'B2B', title: 'B2B: ¿cómo vienen API y HTML?', name: '— B2B —' });
    body = body.concat(pick(function (d) {
      return d.kind === 'b2b_krs' || (d.kind === 'b2b_chart' && !d.channel && (d.tab === 'nr_ri' || d.tab === 'fvm_ri')) ||
        (d.kind === 'b2b_tables' && d.dateType === 'ri' && !!d.channel);
    }));
    if (m === 'exec') return body;
    return body.concat([{ kind: 'divider', flag: '+', title: 'Anexo · detalle completo', name: '— Anexo —' }])
      .concat(ORIG.filter(function (d) { return body.indexOf(d) < 0; }));
  }

  // ── Títulos con conclusión ───────────────────────────────────────────────────────────────────
  function conclusion(def) {
    var cmpL = compLbl();
    if (def.kind === 'cover') return sentence('B2B2C: NR MTD', b2b2c(null, 'nr'), cmpL);
    if (def.kind === 'okr') return sentence(W.FLOW_MET[def.metric].short + ' MTD', b2b2c(null, def.metric), cmpL);
    if (def.kind === 'monthly') return sentence(regLbl(def.region) + ': NR MTD', b2b2c(def.region, 'nr'), cmpL);
    if (def.kind === 'daily') return sentence(regLbl(def.region) + ': ' + W.FLOW_MET[def.metric].short + ' MTD', b2b2c(def.region, def.metric), cmpL);
    return null;
  }
  // El título va en una línea: si no entra, primero se saca la tendencia y después el driver
  function fit(txt) {
    if (txt.length > 90) txt = txt.replace(/ · últ\. 7 días.*$/, '');
    if (txt.length > 90) txt = txt.replace(/; (resta|suma) más .*$/, '');
    return txt;
  }
  function retitle(html, txt) {
    txt = fit(txt);
    return html.replace(/<div class="fl-title">([\s\S]*?)<\/div>/, function (m0, old) {
      return '<div class="fl-title flm-t2" title="' + esc(txt) + '"><small>' + old + '</small>' + esc(txt) + '</div>';
    });
  }

  function toolbar() {
    var after = document.getElementById('flow-coibr');
    if (!after || document.getElementById('flm-mode')) return;
    var lbl = document.createElement('label');
    lbl.className = 'flow-ctl-lbl';
    lbl.textContent = 'Vista';
    lbl.title = 'Ejecutiva: resumen, portada, OKR, KRs, solo las regiones que se desvían y B2B (RI). Completa: además, todo el detalle como anexo.';
    var sel = document.createElement('select');
    sel.className = 'flow-jump';
    sel.id = 'flm-mode';
    sel.innerHTML = '<option value="exec">Ejecutiva</option><option value="full">Completa</option>';
    sel.value = mode;
    sel.onchange = function () {
      mode = sel.value === 'full' ? 'full' : 'exec';
      try { localStorage.setItem(LS, mode); } catch (e) { /* sin storage */ }
      if (typeof W.flowRebuild_ === 'function') W.flowRebuild_();
    };
    after.parentNode.insertBefore(lbl, after.nextSibling);
    lbl.parentNode.insertBefore(sel, lbl.nextSibling);
  }

  // B2B llega aparte del B2B2C: si al armar no estaba, el resumen se rearma cuando llega
  var b2bTimer = null;
  function refreshSummaryWhenB2B() {
    clearInterval(b2bTimer);
    if (b2bReady()) return;
    var tries = 0;
    b2bTimer = setInterval(function () {
      if (!b2bReady() && tries++ < 80) return;
      clearInterval(b2bTimer);
      var i = (W.FLOW_DECK || []).findIndex(function (d) { return d.kind === 'minto_summary'; });
      var fr = i >= 0 && document.querySelector('.flow-frame[data-idx="' + i + '"] .flow-slide');
      if (fr && b2bReady()) { try { fr.outerHTML = summaryHtml(); if (typeof W.flowScale_ === 'function') W.flowScale_(); } catch (e) { console.warn('[daily-flow-minto] resumen:', e); } }
    }, 1500);
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!Array.isArray(W.FLOW_DECK) || typeof W.flowBuild_ !== 'function' || typeof W.flowBuildSlide_ !== 'function') return;
    toolbar();
    var origBuild = W.flowBuild_;
    W.flowBuild_ = function () {
      if (!W._flowBuilt && W._rawB2BC && W._rawB2BC.meta) {
        if (!ORIG) ORIG = W.FLOW_DECK.slice();   // el deck como lo dejaron las otras capas (alguna lo toca después de DOMContentLoaded)
        try { W.FLOW_DECK = deckFor(mode); } catch (e) { console.warn('[daily-flow-minto] deck:', e); W.FLOW_DECK = ORIG.slice(); }
      }
      var ok = origBuild.apply(this, arguments);
      if (ok) refreshSummaryWhenB2B();
      return ok;
    };
    var origSlide = W.flowBuildSlide_;
    W.flowBuildSlide_ = function (def, idx) {
      if (def && def.kind === 'minto_summary') {
        W._flowSeries[idx] = [];
        try { return summaryHtml(); } catch (e) { return '<div class="flow-slide"><p style="padding:40px">No se pudo armar el resumen: ' + esc(e.message) + '</p></div>'; }
      }
      var html = origSlide.apply(this, arguments);
      try { var t = def && conclusion(def); if (t) html = retitle(html, t); } catch (e) { console.warn('[daily-flow-minto] título:', e); }
      return html;
    };
  });
})();
