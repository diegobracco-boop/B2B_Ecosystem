/* Daily Dashboard en Ownia — formato de los números en "+ Filtros" (2026-11-24, Diego).
 *
 * Una fila "Números" en el desplegable "+ Filtros" (daily-filtros.js) para elegir:
 *   - Unidad: Auto (como siempre: millones arriba de 1 M, miles arriba de 1 K) · Millones · Miles · Enteros;
 *   - Decimales: Auto (como siempre: 2 en las tarjetas y tablas, 1 en las etiquetas de los gráficos, miles sin decimales) · 1 · 2.
 *     En Enteros no hay decimales.
 * Reemplaza los dos formateadores de montos del Daily (fmt y fmtShort de Daily_Dashboard/dashboard.html), así cambian las
 * tarjetas, tablas, KRs, Benchmark y etiquetas de los gráficos de Daily B2B2C y B2B. No toca los porcentajes, el Weekly (sus
 * montos ya vienen en millones), Industry events (tiene su propio selector) ni Presentaciones (?flowdeck=1, su propio formato).
 * Con Auto + Auto devuelve lo mismo que los originales. La elección queda en este navegador (localStorage).
 * Lógica pura en window.DailyNumFmt.make, probada en test/daily-numfmt.test.js.
 */
(function (root) {
  'use strict';

  var UNITS = [['auto', 'Auto'], ['m', 'Millones'], ['k', 'Miles'], ['u', 'Enteros']];
  var DECS = [['auto', 'Auto'], ['1', '1'], ['2', '2']];
  var LS = 'daily-numfmt';

  // opts = { unit: 'auto'|'m'|'k'|'u', dec: 'auto'|'1'|'2' }; orig = { fmt, fmtShort } (los del Daily).
  // Devuelve { fmt, fmtShort } nuevos; con auto + auto, los originales.
  function make(opts, orig) {
    var unit = opts && opts.unit || 'auto', dec = opts && opts.dec || 'auto';
    if (unit === 'auto' && dec === 'auto') return { fmt: orig.fmt, fmtShort: orig.fmtShort };
    function build(cur, decM, decK) {
      return function (v) {
        if (v === null || v === undefined || isNaN(v)) return cur ? '—' : orig.fmtShort(v);
        var s = v < 0 ? '-' : '', a = Math.abs(v), d;
        var u = unit === 'auto' ? (a >= 1e6 ? 'm' : a >= 1e3 ? 'k' : 'u') : unit;
        if (u === 'm') { d = dec === 'auto' ? decM : +dec; return s + cur + (a / 1e6).toFixed(d) + 'M'; }
        if (u === 'k') { d = dec === 'auto' ? decK : +dec; return s + cur + (a / 1e3).toFixed(d) + 'K'; }
        return s + cur + Math.round(a).toLocaleString('en-US');
      };
    }
    // mismos decimales que los originales en Auto: fmt 2 / 0, fmtShort 1 / 0
    return { fmt: build('$', 2, 0), fmtShort: build('', 1, 0) };
  }

  function read() {
    var o = { unit: 'auto', dec: 'auto' };
    try {
      var j = JSON.parse(root.localStorage.getItem(LS) || '{}');
      if (UNITS.some(function (u) { return u[0] === j.unit; })) o.unit = j.unit;
      if (DECS.some(function (d) { return d[0] === j.dec; })) o.dec = j.dec;
    } catch (e) { /* sin storage */ }
    return o;
  }

  root.DailyNumFmt = { make: make, UNITS: UNITS, DECS: DECS };

  // ── UI (solo en la página del Daily) ─────────────────────────────────────
  if (typeof document === 'undefined' || !root.location) return;
  if (/[?&](flowdeck=1|embed=|weeklyembed=)/.test(root.location.search)) return;

  var st = read(), orig = null;

  function apply(refresh) {
    if (!orig) {
      if (typeof root.fmt !== 'function' || typeof root.fmtShort !== 'function') return;
      orig = { fmt: root.fmt, fmtShort: root.fmtShort };
    }
    var f = make(st, orig);
    root.fmt = f.fmt; root.fmtShort = f.fmtShort;
    sync();
    if (refresh && typeof root._orgRefreshAll_ === 'function') {
      try { root._orgRefreshAll_(); } catch (e) { console.warn('[daily-numfmt]', e); }
    }
  }

  function group(kind, list) {
    return '<div class="dm-toggle">' + list.map(function (x) {
      return '<button type="button" class="dm-btn" data-numfmt-' + kind + '="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div>';
  }

  function sync() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-numfmt-unit],[data-numfmt-dec]'), function (b) {
      var u = b.getAttribute('data-numfmt-unit'), d = b.getAttribute('data-numfmt-dec');
      b.classList.toggle('active', u != null ? u === st.unit : d === st.dec);
      if (d != null) b.disabled = st.unit === 'u';   // en Enteros no hay decimales
    });
    // el punto y el tooltip de "+ Filtros" los arma daily-filtros.js (mark): acá solo se le pasa la nota
    root._numFmtNote_ = (st.unit === 'auto' && st.dec === 'auto') ? '' :
      'Números: ' + UNITS.filter(function (u) { return u[0] === st.unit; })[0][1] + (st.unit === 'u' ? '' : ', decimales ' + (st.dec === 'auto' ? 'Auto' : st.dec));
    if (typeof root._owFltMark_ === 'function') root._owFltMark_();
  }

  function mount() {
    var pop = document.getElementById('ow-flt-pop');
    if (!pop || document.getElementById('ow-flt-num')) return;
    var row = document.createElement('div');
    row.className = 'ow-flt-row'; row.id = 'ow-flt-num';
    row.title = 'Cómo se muestran los montos en tarjetas, tablas y gráficos del Daily (no cambia los porcentajes)';
    row.innerHTML = '<div><div class="org-lbl">Números</div><div class="ow-flt-help">Montos en $</div></div>' +
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">' + group('unit', UNITS) +
      '<div style="display:flex;align-items:center;gap:6px"><span class="ow-flt-help" style="margin:0">Decimales</span>' + group('dec', DECS) + '</div></div>';
    var help = pop.querySelector(':scope > .ow-flt-help');
    pop.insertBefore(row, help || null);
    row.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || b.disabled) return;
      var u = b.getAttribute('data-numfmt-unit'), d = b.getAttribute('data-numfmt-dec');
      if (u != null) st.unit = u; if (d != null) st.dec = d;
      try { root.localStorage.setItem(LS, JSON.stringify(st)); } catch (e2) { /* sin storage */ }
      apply(true);
    });
    if (help) help.textContent = 'Por default: Organic YES, COI Brasil Excluir, Partner TBD Incluir, Director Todos y Números en Auto.';
  }

  document.addEventListener('DOMContentLoaded', function () {
    try { apply(false); mount(); sync(); } catch (e) { console.warn('[daily-numfmt]', e); }
  });
})(typeof window !== 'undefined' ? window : this);
