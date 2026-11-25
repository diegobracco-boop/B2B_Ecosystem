/* FVM Negativo en Ownia — "¿En qué transacciones perdemos?" (2026-11-24, Diego).
 *
 * Sección debajo del drill-down con el FVM negativo abierto por atributos de la transacción:
 *   Medio de pago · Cuotas · Aerolínea (vuelos standalone) · Hotel (hoteles standalone).
 * Respeta los filtros del tablero (B2B GD / RI / B2B2C, país, producto, mes). Siempre con el criterio
 * Transacción (la reserva entera): con "Componente" activo lo aclara arriba de la tabla.
 *
 * Datos: bloque `aperturas` de cada vista en fvm_negativo.json (Daily_Dashboard/daily_sync.py,
 * build_b2b_fvm_apert_query / build_b2b2c_fvm_apert_query / fvm_apert_block). Solo Ownia: el dashboard.html de
 * Apps Script no lo lee. Si el JSON no trae aperturas (corrida vieja o no cuadró), la sección muestra el aviso.
 *
 * Se engancha sin tocar FVM_Negativo/dashboard.html: envuelve prepare() para quedarse con `aperturas` y
 * updateDashboard() para dibujar la sección después del resto. Lógica pura en window.FvmAperturas, probada en
 * test/fvm-aperturas.test.js.
 */
(function (root) {
  'use strict';

  var TABS = [
    ['medio_pago', 'Medio de pago', 'cómo pagó el cliente'],
    ['cuotas', 'Cuotas', 'en cuántas cuotas'],
    ['aerolinea', 'Aerolínea', 'vuelos standalone'],
    ['hotel', 'Hotel', 'hoteles standalone'],
  ];
  var ONLY_PRODUCT = { aerolinea: 'Flights', hotel: 'Hotels' };
  var OTROS_HOTEL = 'Otros hoteles';
  var TOP_N = 15;

  // ── Lógica pura ─────────────────────────────────────────────────
  // Códigos de prd_payment_methods_fact.payment_method_ch_ev → grupo legible. N/A en B2B = cuenta de la agencia.
  function medioGroup(code, biz) {
    var c = String(code == null ? '' : code).toUpperCase();
    if (!c || c === 'N/A') return biz === 'b2b' ? 'Cuenta de la agencia' : 'Sin dato';
    if (c === 'CURRENT_ACCOUNT' || c === 'AGENCY_ACCOUNT') return 'Cuenta de la agencia';
    if (c === 'ONE_CARD_CREDIT') return 'Tarjeta de crédito';
    if (c === 'ONE_CARD_DEBIT') return 'Tarjeta de débito';
    if (c === 'MULTIPLE_CARD' || c === 'BEST_TACTIC_CARD') return 'Varias tarjetas';
    if (c.indexOf('FINANCED') === 0) return 'Financiado';
    if (c === 'CASH_TRANSFER_PIX') return 'PIX';
    if (c.indexOf('CASH_TRANSFER') === 0) return 'Transferencia';
    if (c.indexOf('CASH_DEPOSIT') === 0) return 'Efectivo / depósito';
    if (c.indexOf('DEFERRED') === 0) return 'Pago diferido';
    if (c === 'NO_PAYMENT') return 'Sin pago a Despegar';
    if (c.indexOf('PAD') >= 0) return 'PAD';
    return c;
  }

  // dues (MAX de mkt_users_fact_payments por tx) → tramo. -1 = la tx no está en la tabla de pagos.
  var CUOTAS_ORDER = ['Sin dato', '0', '1 cuota', '2 a 3', '4 a 6', '7 a 12', '13 a 24', 'Más de 24'];
  function cuotasBucket(v) {
    var n = parseInt(v, 10);
    if (isNaN(n) || n < 0) return 'Sin dato';
    if (n === 0) return '0';
    if (n === 1) return '1 cuota';
    if (n <= 3) return '2 a 3';
    if (n <= 6) return '4 a 6';
    if (n <= 12) return '7 a 12';
    if (n <= 24) return '13 a 24';
    return 'Más de 24';
  }

  var AIRLINES = {
    LA: 'LATAM', JJ: 'LATAM Brasil', AR: 'Aerolíneas Argentinas', JA: 'JetSMART', WJ: 'JetSMART Argentina',
    Y4: 'Volaris', AD: 'Azul', G3: 'GOL', H2: 'SKY Airline', AV: 'Avianca', VB: 'Viva Aerobus', AM: 'Aeroméxico',
    CM: 'Copa', AA: 'American Airlines', UA: 'United', DL: 'Delta', IB: 'Iberia', UX: 'Air Europa',
    AF: 'Air France', KL: 'KLM', LH: 'Lufthansa', P5: 'Wingo', DM: 'Arajet', TP: 'TAP', AC: 'Air Canada',
  };
  function airlineLabel(code) {
    if (!code || code === 'N/A') return 'Sin dato';
    if (code === 'Varias') return 'Varias aerolíneas';
    return AIRLINES[code] ? code + ' · ' + AIRLINES[code] : code;
  }

  function labelOf(ap, valor, biz) {
    if (ap === 'medio_pago') return medioGroup(valor, biz);
    if (ap === 'cuotas') return cuotasBucket(valor);
    if (ap === 'aerolinea') return airlineLabel(valor);
    return valor === 'N/A' ? 'Sin dato' : valor;
  }

  // rows: [{ym, pais, producto, valor, fvm_neg, tx_neg, tx_total, fvm_total}]; f: {biz, country, product, month}.
  // Devuelve { groups: [{name, fvm_neg, tx_neg, tx_total, fvm_total, codes}], total: {...} } ordenado: cuotas por tramo,
  // el resto por FVM negativo (más negativo primero) con "Otros hoteles" / "Sin dato" al final.
  function aggregate(rows, ap, f) {
    var m = {}, total = { fvm_neg: 0, tx_neg: 0, tx_total: 0, fvm_total: 0 };
    (rows || []).forEach(function (r) {
      if (f.month !== 'all' && r.ym !== f.month) return;
      if (f.country !== 'all' && r.pais !== f.country) return;
      if (f.product !== 'all' && r.producto !== f.product) return;
      var name = labelOf(ap, r.valor, f.biz);
      var g = m[name] || (m[name] = { name: name, fvm_neg: 0, tx_neg: 0, tx_total: 0, fvm_total: 0, codes: {} });
      g.fvm_neg += r.fvm_neg || 0; g.tx_neg += r.tx_neg || 0; g.tx_total += r.tx_total || 0; g.fvm_total += r.fvm_total || 0;
      g.codes[r.valor] = 1;
      total.fvm_neg += r.fvm_neg || 0; total.tx_neg += r.tx_neg || 0; total.tx_total += r.tx_total || 0; total.fvm_total += r.fvm_total || 0;
    });
    var groups = Object.keys(m).map(function (k) { var g = m[k]; g.codes = Object.keys(g.codes).sort(); return g; });
    if (ap === 'cuotas') {
      groups.sort(function (a, b) { return CUOTAS_ORDER.indexOf(a.name) - CUOTAS_ORDER.indexOf(b.name); });
    } else {
      var last = function (g) { return g.name === OTROS_HOTEL || g.name === 'Sin dato' ? 1 : 0; };
      groups.sort(function (a, b) { return last(a) - last(b) || a.fvm_neg - b.fvm_neg; });
    }
    // solo los que pierden algo (o tienen tx, para cuotas: el tramo sin pérdidas también informa)
    groups = groups.filter(function (g) { return Math.round(g.fvm_neg) !== 0 || (ap === 'cuotas' && g.tx_total > 0); });
    return { groups: groups, total: total };
  }

  root.FvmAperturas = { medioGroup: medioGroup, cuotasBucket: cuotasBucket, airlineLabel: airlineLabel,
                        aggregate: aggregate, CUOTAS_ORDER: CUOTAS_ORDER };
  if (typeof document === 'undefined') return;

  // ── Página ──────────────────────────────────────────────────────
  var APERT = null;         // { b2b_gd: {medio_pago: [...], ...}, ... } o null si el JSON no las trae
  var tab = 'medio_pago', showAll = false;

  function expandC(c) {
    if (!c || !c.cols) return [];
    return c.rows.map(function (r) { var o = {}; for (var i = 0; i < c.cols.length; i++) o[c.cols[i]] = r[i]; return o; });
  }
  function capture(d) {
    var out = {}, any = false;
    ['b2b_gd', 'b2b_ri', 'b2b2c'].forEach(function (k) {
      var a = d && d[k] && d[k].aperturas;
      if (!a) return;
      any = true;
      out[k] = {};
      TABS.forEach(function (t) { out[k][t[0]] = expandC(a[t[0]]); });
    });
    APERT = any ? out : null;
  }

  var CSS =
    '#fvm-apert{padding:20px;margin-top:16px}' +
    '#fvm-apert .ap-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:10px}' +
    '#fvm-apert .ap-note{font-size:12px;color:var(--muted);margin:2px 0 10px}' +
    '#fvm-apert .ap-warn{font-size:12px;color:var(--text-secondary);background:var(--primary-bg);border-radius:8px;padding:8px 12px;margin-bottom:10px}' +
    '#fvm-apert table{min-width:640px}' +
    '#fvm-apert td.name{max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#fvm-apert td.muted{color:var(--muted)}' +
    '#fvm-apert .ap-more{font:inherit;font-size:13px;margin-top:10px;padding:6px 12px;border:1px solid var(--border-strong);border-radius:8px;background:var(--card);color:var(--text-secondary);cursor:pointer}' +
    '#fvm-apert .ap-more:hover{border-color:var(--primary);color:var(--primary)}';

  function S() { return root.S || {}; }
  function blockKey() { var s = S(); return s.biz === 'b2b' ? 'b2b_' + s.view : 'b2b2c'; }
  function fF(v) { return typeof root.fmtFVM === 'function' ? root.fmtFVM(v) : String(Math.round(v)); }
  function fI(v) { return typeof root.fmtInt === 'function' ? root.fmtInt(v) : String(Math.round(v)); }
  function e(s) { return typeof root.esc === 'function' ? root.esc(s) : String(s); }
  function pct(a, b) { return b ? (a / b * 100).toFixed(1) + '%' : '—'; }

  function render() {
    var main = document.getElementById('main');
    if (!main || !root.DATA) return;
    var sec = document.getElementById('fvm-apert');
    if (!sec) { sec = document.createElement('div'); sec.id = 'fvm-apert'; sec.className = 'card'; }
    main.appendChild(sec);   // updateDashboard reescribe #main: va siempre al final

    var s = S(), f = { biz: s.biz, country: s.country || 'all', product: s.product || 'all', month: s.month || 'all' };
    var tabs = '<div class="seg soft" id="ap-tabs">' + TABS.map(function (t) {
      return '<button data-ap="' + t[0] + '" class="' + (t[0] === tab ? 'active' : '') + '">' + t[1] +
             '<span class="tab-desc">' + t[2] + '</span></button>';
    }).join('') + '</div>';
    var html = '<div class="ap-head"><div><div class="chart-title">¿En qué transacciones perdemos?</div>' +
      '<div class="chart-subtitle" style="margin:0">FVM negativo abierto por medio de pago, cuotas, aerolínea y hotel · con los filtros de arriba</div></div>' +
      tabs + '</div>';
    if (s.crit === 'comp') html += '<div class="ap-warn">Esta sección usa siempre el criterio <b>Transacción</b> (la reserva entera), aunque arriba esté elegido Componente.</div>';

    var blk = APERT && APERT[blockKey()];
    var only = ONLY_PRODUCT[tab];
    if (!blk) {
      html += '<div class="state">Todavía no hay aperturas para esta vista: aparecen después de la próxima actualización de reales.</div>';
    } else if (only && f.product !== 'all' && f.product !== only) {
      html += '<div class="state">' + (tab === 'aerolinea' ? 'La aerolínea se abre solo para vuelos standalone (producto Flights).' :
        'El hotel se abre solo para hoteles standalone (producto Hotels).') + ' Cambiá el filtro de producto para verla.</div>';
    } else {
      var agg = aggregate(blk[tab], tab, f);
      if (!agg.groups.length) {
        html += '<div class="state">Sin FVM negativo para los filtros seleccionados</div>';
      } else {
        var note = { medio_pago: '', cuotas: 'Cuotas: las del pago de la reserva (si pagó con más de un medio, el de más cuotas). "0" = pagos sin cuotas (transferencia, efectivo, cuenta de la agencia).',
                     aerolinea: 'Solo vuelos standalone (producto Flights). Aerolínea validadora del ticket.',
                     hotel: 'Solo hoteles standalone (producto Hotels). Se listan los 40 hoteles que más pierden por país; el resto va a "Otros hoteles". "% de sus tx" de cada hotel cuenta los meses en que tuvo alguna pérdida.' }[tab];
        if (tab === 'medio_pago' && s.biz === 'b2b') note = '"Cuenta de la agencia": la agencia paga con su cuenta corriente con Despegar (sin medio de pago del cliente).';
        if (note) html += '<div class="ap-note">' + note + '</div>';
        var gs = agg.groups, cut = showAll || gs.length <= TOP_N + 2 ? gs : gs.slice(0, TOP_N);
        html += '<div class="table-wrap"><table><thead><tr><th>' + TABS.filter(function (t) { return t[0] === tab; })[0][1] + '</th>' +
          '<th class="right">FVM negativo</th><th class="right">% del total</th><th class="right">Tx que pierden</th>' +
          '<th class="right">% de sus tx</th><th class="right">Pérdida por tx</th><th class="right">FVM neto</th></tr></thead><tbody>';
        cut.forEach(function (g) {
          var codes = g.codes.join(', ');
          html += '<tr><td class="name" title="' + e(g.name + (codes && codes !== g.name ? ' — ' + codes : '')) + '">' + e(g.name) + '</td>' +
            '<td class="right fvm-cell">' + fF(g.fvm_neg) + '</td>' +
            '<td class="right">' + pct(g.fvm_neg, agg.total.fvm_neg) + '</td>' +
            '<td class="right">' + fI(g.tx_neg) + '</td>' +
            '<td class="right muted">' + pct(g.tx_neg, g.tx_total) + '</td>' +
            '<td class="right muted">' + (g.tx_neg ? fF(g.fvm_neg / g.tx_neg) : '—') + '</td>' +
            '<td class="right fvm-cell' + (g.fvm_total > 0 ? ' pos' : '') + '">' + fF(g.fvm_total) + '</td></tr>';
        });
        html += '<tr class="total-row"><td>TOTAL</td><td class="right">' + fF(agg.total.fvm_neg) + '</td><td class="right">100.0%</td>' +
          '<td class="right">' + fI(agg.total.tx_neg) + '</td><td class="right">' + pct(agg.total.tx_neg, agg.total.tx_total) + '</td>' +
          '<td class="right">' + (agg.total.tx_neg ? fF(agg.total.fvm_neg / agg.total.tx_neg) : '—') + '</td>' +
          '<td class="right">' + fF(agg.total.fvm_total) + '</td></tr></tbody></table></div>';
        if (cut.length < gs.length || showAll && gs.length > TOP_N + 2) {
          html += '<button class="ap-more" id="ap-more">' + (showAll ? 'Ver solo los ' + TOP_N + ' primeros' : 'Ver los ' + gs.length) + '</button>';
        }
        html += '<div class="ap-note" style="margin:10px 0 0">% de sus tx: de todas las transacciones de esa fila, cuántas pierden plata. ' +
          'FVM neto: el FVM de todas sus transacciones (las que ganan y las que pierden).</div>';
      }
    }
    sec.innerHTML = html;
  }

  function onClick(ev) {
    var b = ev.target.closest('#fvm-apert button');
    if (!b) return;
    if (b.id === 'ap-more') { showAll = !showAll; render(); return; }
    var ap = b.getAttribute('data-ap');
    if (ap && ap !== tab) { tab = ap; showAll = false; render(); }
  }

  function hook() {
    if (typeof root.prepare !== 'function' || typeof root.updateDashboard !== 'function') return false;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var origPrepare = root.prepare;
    root.prepare = function (raw) {
      // prepare() descarta las claves que no conoce: se lee el mismo objeto que parsea (sin parsear dos veces)
      var jp = JSON.parse, got;
      JSON.parse = function (t, r) { var o = jp.call(JSON, t, r); if (got === undefined) got = o; return o; };
      try { return origPrepare(raw); } finally { JSON.parse = jp; try { capture(got); } catch (ex) { APERT = null; } }
    };
    var origUpdate = root.updateDashboard;
    root.updateDashboard = function () {
      var r = origUpdate.apply(this, arguments);
      try { render(); } catch (ex) { console.warn('[fvm-aperturas]', ex); }
      return r;
    };
    document.addEventListener('click', onClick);
    return true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    try {
      if (!hook()) return;
      // Por si los datos llegaron antes de engancharse (no debería: getData es asíncrono): se piden de nuevo.
      if (root.DATA && root.google && root.google.script) {
        root.google.script.run.withSuccessHandler(function (raw) {
          try { capture(JSON.parse(raw)); render(); } catch (ex) { console.warn('[fvm-aperturas]', ex); }
        }).getData();
      }
    } catch (ex) { console.warn('[fvm-aperturas]', ex); }
  });
})(typeof window !== 'undefined' ? window : this);
