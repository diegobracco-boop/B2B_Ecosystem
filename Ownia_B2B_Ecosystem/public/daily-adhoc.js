/* Daily Dashboard en Ownia — solapa "Tabla adhoc" (2026-11-27, Diego). Lo inyecta server/index.js en el Daily
 * (`layout` en server/modules.js). El HTML de Apps Script no se toca.
 *
 * Foto de un día: Orders, GB, Net Revenue y FVM de B2B2C, B2B MAY (canal API) y B2B MIN (Agencias afiliadas), una
 * tabla por negocio y una Total (la suma de los tres), contra Budget, Run Rate y Last Year del mismo día.
 *  - Por default el día es el jueves 26/11/2026 y el LY el jueves de la semana 48 de 2025 (27/11/2025, mismo día de la semana), como lo pidió
 *    Diego; los dos se cambian arriba (al mover el día, el LY se corre lo mismo).
 *  - B2B2C por fecha de confirmación (actuals / actuals_ly / budget / runrate del JSON del Daily); B2B por fecha de
 *    gestión (GD: b2b_gd / b2b_gd_ly / b2b_budget_gd / b2b_runrate_gd).
 *  - Sigue los switches de la página: Organic (como el Daily: el real se convierte al TC Budget para el Δ vs Budget y al
 *    TC LY para el Δ vs LY; vs Run Rate nominal; la columna Real va en USD nominal), COI Brasil (filas RG), Partner TBD,
 *    Canal y Director (los aplican dashboard.html y daily-filtros.js sobre los mismos arreglos).
 * No pide nada al servidor: lee _rawB2BC / _rawB2B que ya cargó el Daily (B2B llega en el preload en paralelo).
 * Lógica pura en window.DailyAdhoc (sumDay, computeTables, delta, shiftDate), probada en test/daily-adhoc.test.js.
 */
(function (root) {
  'use strict';

  var DEF_FECHA = '2026-11-26';      // jueves 26/11/2026 (ayer al armarla)
  var DEF_FECHA_LY = '2025-11-27';   // jueves de la semana 48 de 2025 (mismo día de la semana)
  var METRICS = [
    { k: 'orders', lbl: 'Orders', money: false },
    { k: 'gb', lbl: 'GB', money: true },
    { k: 'nr', lbl: 'Net Revenue', money: true },
    { k: 'fvm', lbl: 'FVM', money: true },
  ];
  var BIZ = [
    { k: 'b2b2c', lbl: 'B2B2C', sub: 'fecha de confirmación' },
    { k: 'may', lbl: 'B2B MAY', sub: 'API · fecha de gestión', ch: 'API' },
    { k: 'min', lbl: 'B2B MIN', sub: 'Agencias afiliadas · fecha de gestión', ch: 'Agencias afiliadas' },
  ];
  var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  // ── Lógica pura ────────────────────────────────────────────────────────
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function zero() { return { orders: 0, gb: 0, nr: 0, fvm: 0 }; }
  // Globales (2026-11-27, Diego): Other Countries + USA + Uruguay + Paraguay, como el Benchmark del Daily (el Budget B2B no
  // abre Uruguay ni Paraguay; USA es chico). Ecuador va aparte (no tiene Budget).
  var GLOBALES = 'Globales';
  var PAIS_MAP = { 'Other Countries': GLOBALES, 'USA': GLOBALES, 'Uruguay': GLOBALES, 'Paraguay': GLOBALES };
  function paisOf(r) { return PAIS_MAP[r.pais] || r.pais; }
  // B2B2C actuals traen net_revenues; budget / run rate y todo B2B, net_revenue.
  function nrOf(r) { return r.net_revenues != null ? r.net_revenues : r.net_revenue; }

  // Suma un día de un arreglo de filas; ch = parent_channel (solo B2B); paises = { país: 1 } o null (todos).
  // null si no hay arreglo.
  function sumDay(rows, fecha, ch, paises) {
    if (!Array.isArray(rows)) return null;
    var t = zero(), n = 0;
    rows.forEach(function (r) {
      if (!r || r.fecha !== fecha) return;
      if (ch && r.parent_channel !== ch) return;
      if (paises && !paises[paisOf(r)]) return;
      n++;
      t.orders += num(r.orders); t.gb += num(r.gross_bookings); t.nr += num(nrOf(r)); t.fvm += num(r.fvm);
    });
    t.n = n;
    return t;
  }

  // Δ% contra un goal (denominador en valor absoluto: el FVM puede ser negativo). null si no hay goal.
  function delta(real, goal) {
    if (real == null || goal == null || !goal) return null;
    return (real - goal) / Math.abs(goal);
  }

  function addInto(acc, t) {
    if (!t) return acc;
    if (!acc) acc = zero(), acc.n = 0;
    METRICS.forEach(function (m) { acc[m.k] += t[m.k]; });
    acc.n += t.n || 0;
    return acc;
  }

  /* src = { b2b2c: S, b2b: S } con S = { act, actBud, actLy, bud, rr, ly } (arreglos; actBud / actLy = el real ya
   * convertido por organic, o los mismos act). B2B se filtra por canal. Devuelve { b2b2c, may, min, total }, cada uno
   * { real, realBud, realLy, bud, rr, ly } con totales por métrica (null si falta la fuente o no hay filas del goal).
   * paises = lista de países (vacía o null = todos). */
  function computeTables(src, fecha, fechaLy, paises) {
    var pset = null;
    if (paises && paises.length) { pset = {}; paises.forEach(function (p) { pset[p] = 1; }); }
    var out = {};
    BIZ.forEach(function (b) {
      var s = b.ch ? src.b2b : src.b2b2c;
      if (!s) { out[b.k] = null; return; }
      var bud = sumDay(s.bud, fecha, b.ch, pset), rr = sumDay(s.rr, fecha, b.ch, pset), ly = sumDay(s.ly, fechaLy, b.ch, pset);
      out[b.k] = {
        real: sumDay(s.act, fecha, b.ch, pset),
        realBud: sumDay(s.actBud || s.act, fecha, b.ch, pset),
        realLy: sumDay(s.actLy || s.act, fecha, b.ch, pset),
        bud: bud && bud.n ? bud : null,
        rr: rr && rr.n ? rr : null,
        ly: ly && ly.n ? ly : null,
      };
    });
    var tot = {}, parts = BIZ.map(function (b) { return out[b.k]; });
    if (!parts.every(function (p) { return p; })) { out.total = null; return out; }
    // Negocios que juegan en el Total: los que tienen algo ese día (real o algún goal). Con un país que un negocio no
    // tiene (USA en B2B, Ecuador en el Budget de B2B MIN) ese negocio no cuenta, en vez de dejar el Total sin goal.
    var act = parts.filter(function (p) { return (p.real && p.real.n) || p.bud || p.rr || p.ly; });
    ['real', 'realBud', 'realLy', 'bud', 'rr', 'ly'].forEach(function (f) {
      // un goal que falta en un negocio que sí juega deja el Total sin ese goal (si no, compararía peras con manzanas)
      if (!act.length || act.some(function (p) { return !p[f]; })) { tot[f] = null; return; }
      var acc = null;
      act.forEach(function (p) { acc = addInto(acc, p[f]); });
      tot[f] = acc;
    });
    if (!tot.real) { tot.real = zero(); tot.real.n = 0; }
    out.total = tot;
    return out;
  }

  // Países de las fuentes (actuals y goals de los dos negocios), en el orden del Daily: alfabético, Globales y RG al final.
  function countriesOf(src) {
    var s = {};
    [src.b2b2c, src.b2b].forEach(function (x) {
      if (!x) return;
      [x.act, x.bud, x.rr, x.ly].forEach(function (rows) { (rows || []).forEach(function (r) { if (r && r.pais) s[paisOf(r)] = 1; }); });
    });
    var LAST = { 'Globales': 1, 'RG': 2 };
    return Object.keys(s).sort(function (a, b) { return (LAST[a] || 0) - (LAST[b] || 0) || a.localeCompare(b); });
  }

  // Una tabla por país (para el Excel aperturado). Recorta antes las filas a los dos días, así no se barren los
  // arreglos completos una vez por país. Devuelve [{ pais, res }] solo con los países que tienen algo ese día.
  function computeByCountry(src, fecha, fechaLy, paises) {
    function cut(s) {
      if (!s) return s;
      var d = function (rows, f) { return Array.isArray(rows) ? rows.filter(function (r) { return r && r.fecha === f; }) : rows; };
      return { act: d(s.act, fecha), actBud: d(s.actBud || s.act, fecha), actLy: d(s.actLy || s.act, fecha), bud: d(s.bud, fecha), rr: d(s.rr, fecha), ly: d(s.ly, fechaLy) };
    }
    var small = { b2b2c: cut(src.b2b2c), b2b: cut(src.b2b) };
    var list = (paises && paises.length) ? paises : countriesOf(small);
    return list.map(function (p) { return { pais: p, res: computeTables(small, fecha, fechaLy, [p]) }; })
      .filter(function (x) { var t = x.res.total; return t && ((t.real && t.real.n) || t.bud || t.rr || t.ly); });
  }

  // 'AAAA-MM-DD' ± días (UTC, sin husos)
  function shiftDate(f, days) {
    var p = String(f).split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  function dateLabel(f) {
    var p = String(f || '').split('-').map(Number);
    if (p.length !== 3 || !p[0]) return f || '';
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return DIAS[d.getUTCDay()] + ' ' + String(p[2]).padStart(2, '0') + '/' + String(p[1]).padStart(2, '0') + '/' + p[0];
  }

  /* Hojas para "Descargar Excel" (las escribe DailyExcel.workbookFromSheets): "Tabla adhoc" con un bloque por tabla
   * (Total primero, como la página) y "Info". Montos en USD sin redondear (la celda los muestra con #,##0) y Δ % como
   * número con formato de porcentaje. Si no hay real del día, Real y los Δ quedan vacíos (igual que el "—" de la página).
   * S = estilos de DailyExcel; info = líneas de texto para la hoja Info; byCountry = computeByCountry(...) para la hoja
   * "Por país" (una fila por negocio × país × métrica, con autofiltro); paisLbl = el filtro de país de la página. */
  var BLOCKS = [['total', 'Total', 'B2B2C + B2B MAY + B2B MIN']].concat(BIZ.map(function (b) { return [b.k, b.lbl, b.sub]; }));
  function paisLabel(p) { return p === 'RG' ? 'RG (ajuste COI Brasil)' : p; }
  function buildSheets(res, fecha, fechaLy, S, info, byCountry, paisLbl) {
    var T = function (v, s) { return { v: v, t: 's', s: s || 0 }; };
    var N = function (v, s) { return v == null || !isFinite(v) ? null : { v: v, t: 'n', s: s }; };
    var cmpHead = ['Budget', 'Δ % vs Budget', 'Δ vs Budget', 'Run Rate', 'Δ % vs RR', 'Δ vs RR',
      'LY (' + dateLabel(fechaLy) + ')', 'Δ % vs LY', 'Δ vs LY'];
    // Real + las tres comparaciones de una métrica (sin real del día: Real y Δ vacíos)
    function cells(t, m) {
      var has = !!(t && t.real && t.real.n);
      function cmp(goal, rg) {
        var g = goal ? goal[m.k] : null, r = has && rg ? rg[m.k] : null;
        return [N(g, S.n), N(goal && r != null ? delta(r, g) : null, S.pct), N(goal && r != null ? r - g : null, S.n)];
      }
      return [N(has ? t.real[m.k] : null, S.nb)].concat(cmp(t && t.bud, t && t.realBud), cmp(t && t.rr, t && t.real), cmp(t && t.ly, t && t.realLy));
    }
    var rows = [[T('Tabla adhoc · ' + dateLabel(fecha) + ' vs LY ' + dateLabel(fechaLy) + ' · País: ' + (paisLbl || 'Todos'), S.b)], []];
    BLOCKS.forEach(function (bk) {
      var t = res[bk[0]];
      rows.push([T(bk[1] + ' · ' + bk[2], S.b)]);
      rows.push(['Métrica', 'Real'].concat(cmpHead).map(function (h) { return T(h, S.head); }));
      METRICS.forEach(function (m) { rows.push([T(m.lbl, S.b)].concat(cells(t, m))); });
      rows.push([]);
    });
    var sheets = [{ name: 'Tabla adhoc', cols: [16, 14, 14, 13, 14, 14, 13, 14, 20, 13, 14], rows: rows }];
    if (byCountry) {
      var pr = [['Negocio', 'País', 'Métrica', 'Real'].concat(cmpHead).map(function (h) { return T(h, S.head); })];
      BLOCKS.forEach(function (bk) {
        byCountry.forEach(function (x) {
          var t = x.res[bk[0]];
          if (!t || !((t.real && t.real.n) || t.bud || t.rr || t.ly)) return;   // ese negocio no está en ese país
          METRICS.forEach(function (m) { pr.push([T(bk[1]), T(paisLabel(x.pais)), T(m.lbl)].concat(cells(t, m))); });
        });
      });
      sheets.push({ name: 'Por país', cols: [12, 22, 13, 14, 14, 13, 14, 14, 13, 14, 20, 13, 14], rows: pr, freeze: true,
        filter: 'A1:M' + pr.length });
    }
    sheets.push({ name: 'Info', cols: [120], rows: (info || []).map(function (l) { return [T(l)]; }) });
    return sheets;
  }

  root.DailyAdhoc = { sumDay: sumDay, delta: delta, computeTables: computeTables, shiftDate: shiftDate, daysBetween: daysBetween, dateLabel: dateLabel, buildSheets: buildSheets,
    countriesOf: countriesOf, paisOf: paisOf, computeByCountry: computeByCountry, paisLabel: paisLabel, METRICS: METRICS, BIZ: BIZ };

  // ── Página ─────────────────────────────────────────────────────────────
  if (typeof document === 'undefined' || /[?&](flowdeck=1|embed=|weeklyembed=)/.test(root.location ? root.location.search : '')) return;
  var W = root;
  var st = { fecha: DEF_FECHA, fechaLy: DEF_FECHA_LY, paises: [] };   // paises vacío = todos
  var active = false, retry = null, last = null;   // last = lo último dibujado (lo baja "Descargar Excel")

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtMoney(v) { return typeof W.fmt === 'function' ? W.fmt(v) : '$' + Math.round(v).toLocaleString('es-AR'); }
  function fmtVal(m, v) { return v == null ? '—' : m.money ? fmtMoney(v) : Math.round(v).toLocaleString('es-AR'); }
  function fmtPct(d) {
    if (d == null) return '—';
    var p = d * 100, a = Math.abs(p);
    return (p > 0 ? '+' : p < 0 ? '−' : '') + a.toFixed(a < 10 ? 1 : 0) + '%';
  }
  // mismo semáforo que el resto de Ownia (_deltaState_ del Hub): verde ≥ 0%, ámbar −5% a 0%, rojo < −5%
  function cls(d) { return d == null ? '' : d >= 0 ? 'pos' : d >= -0.05 ? 'amb' : 'neg'; }

  var CSS = [
    '#view-adhoc .adh-ctrl{display:flex;gap:14px;align-items:center;flex-wrap:wrap}',
    '#view-adhoc .adh-ctrl label{display:flex;gap:6px;align-items:center;font-size:11px;font-weight:700;color:var(--text-3)}',
    '#view-adhoc .adh-ctrl input[type=date]{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:3px 8px;font:600 11px var(--font);color-scheme:light dark}',
    '#view-adhoc .adh-ctrl .ttab{font-size:10px}',
    '#view-adhoc .adh-xls{background:var(--primary);color:#fff;border:1px solid var(--primary);font:700 11px var(--font);padding:4px 12px;border-radius:20px;cursor:pointer;white-space:nowrap}',
    '#view-adhoc .adh-xls:hover{filter:brightness(1.12)}',
    '#view-adhoc .adh-pais{position:relative}',
    '#view-adhoc .adh-pais-btn{background:transparent;border:1px solid var(--border);color:var(--text-2);font:700 11px var(--font);padding:4px 12px;border-radius:20px;cursor:pointer;white-space:nowrap}',
    '#view-adhoc .adh-pais-btn:hover,#view-adhoc .adh-pais.open .adh-pais-btn{color:var(--text);border-color:rgba(86,38,233,.4)}',
    '#view-adhoc .adh-pais-btn.on{color:var(--text);border-color:var(--primary);background:var(--primary-d)}',
    '#view-adhoc .adh-pais-pop{display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:300;min-width:210px;max-height:360px;overflow:auto;padding:8px 10px;',
    '  border-radius:10px;background:var(--elevated,var(--surface));border:1px solid var(--border);box-shadow:0 10px 28px rgba(0,0,0,.28)}',
    '#view-adhoc .adh-pais.open .adh-pais-pop{display:block}',
    '#view-adhoc .adh-pchk{display:flex;align-items:center;gap:8px;padding:4px 2px;font:600 12px var(--font);color:var(--text-2);cursor:pointer;white-space:nowrap}',
    '#view-adhoc .adh-pchk:hover{color:var(--text)}',
    '#view-adhoc .adh-pall{border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:4px}',
    '#view-adhoc .adh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,560px),1fr));gap:12px;align-items:start}',
    '#view-adhoc .adh-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:14px 14px 10px;min-width:0;overflow-x:auto}',
    '#view-adhoc .adh-card.tot{border-color:rgba(86,38,233,.45)}',
    '#view-adhoc .adh-ttl{font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px}',
    '#view-adhoc .adh-sub{font-size:10px;color:var(--text-3);font-weight:600;margin-bottom:10px}',
    '#view-adhoc table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}',
    '#view-adhoc th{font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;text-align:right;padding:4px 8px;border-bottom:1px solid var(--border);white-space:nowrap}',
    '#view-adhoc th:first-child,#view-adhoc td:first-child{text-align:left;padding-left:0}',
    '#view-adhoc th.grp{border-left:1px solid var(--border)}',
    '#view-adhoc td{text-align:right;padding:7px 8px;border-bottom:1px solid var(--border);color:var(--text-2);white-space:nowrap}',
    '#view-adhoc tr:last-child td{border-bottom:0}',
    '#view-adhoc td.m{color:var(--text);font-weight:700}',
    '#view-adhoc td.real{color:var(--text);font-weight:700}',
    '#view-adhoc td.grp{border-left:1px solid var(--border)}',
    '#view-adhoc td.d{font-weight:700}',
    '#view-adhoc td.d small{display:block;font-size:9.5px;font-weight:600;opacity:.75}',
    '#view-adhoc td.pos{color:var(--success)}#view-adhoc td.amb{color:var(--warning)}#view-adhoc td.neg{color:var(--danger)}',
    '#view-adhoc .adh-note{font-size:10.5px;color:var(--text-3);line-height:1.45;margin-top:12px}',
    '#view-adhoc .adh-empty{font-size:12px;color:var(--text-3);padding:18px 0}',
  ].join('\n');

  function srcB2BC() {
    var raw = typeof W.b2bcRaw_ === 'function' ? W.b2bcRaw_() : W._rawB2BC;
    if (!raw) return null;
    var org = typeof W._orgRows_ === 'function' && typeof W._orgTargetFor_ === 'function';
    return {
      act: raw.actuals,
      actBud: org ? W._orgRows_(raw.actuals, W._orgTargetFor_('budget')) : raw.actuals,
      actLy: org ? W._orgRows_(raw.actuals, W._orgTargetFor_('ly')) : raw.actuals,
      bud: raw.budget, rr: raw.runrate, ly: raw.actuals_ly,
    };
  }
  function srcB2B() {
    var raw = W._rawB2B;
    if (!raw) return null;
    var org = typeof W._orgRows_ === 'function' && typeof W._orgTargetFor_ === 'function';
    return {
      act: raw.b2b_gd,
      actBud: org ? W._orgRows_(raw.b2b_gd, W._orgTargetFor_('budget')) : raw.b2b_gd,
      actLy: org ? W._orgRows_(raw.b2b_gd, W._orgTargetFor_('ly')) : raw.b2b_gd,
      bud: raw.b2b_budget_gd, rr: raw.b2b_runrate_gd, ly: raw.b2b_gd_ly,
    };
  }

  function cell(m, goal, realForGoal) {
    var g = goal ? goal[m.k] : null, r = realForGoal ? realForGoal[m.k] : null;
    var d = goal ? delta(r, g) : null;
    var diff = (goal && r != null) ? r - g : null;
    var dTxt = diff == null ? '' : '<small>' + (diff > 0 ? '+' : diff < 0 ? '−' : '') + fmtVal(m, Math.abs(diff)) + '</small>';
    return '<td class="grp">' + fmtVal(m, g) + '</td><td class="d ' + cls(d) + '">' + fmtPct(d) + dTxt + '</td>';
  }

  function tableHtml(t, title, sub, isTot) {
    var h = '<div class="adh-card' + (isTot ? ' tot' : '') + '"><div class="adh-ttl">' + esc(title) + '</div><div class="adh-sub">' + esc(sub) + '</div>';
    if (!t || !t.real) return h + '<div class="adh-empty">Cargando…</div></div>';
    if (!t.real.n && !(t.bud || t.rr || t.ly)) return h + '<div class="adh-empty">Sin datos para ' + esc(dateLabel(st.fecha)) + '.</div></div>';
    h += '<table><thead><tr><th>Métrica</th><th>Real</th><th class="grp">Budget</th><th>Δ vs Bud</th><th class="grp">Run Rate</th><th>Δ vs RR</th>' +
      '<th class="grp">LY · ' + esc(dateLabel(st.fechaLy).slice(0, 9)) + '</th><th>Δ vs LY</th></tr></thead><tbody>';
    var has = !!t.real.n;   // sin reales del día (todavía no se actualizaron): Real y Δ en "—", no −100%
    METRICS.forEach(function (m) {
      h += '<tr><td class="m">' + esc(m.lbl) + '</td><td class="real">' + (has ? fmtVal(m, t.real[m.k]) : '—') + '</td>' +
        cell(m, t.bud, has && t.realBud) + cell(m, t.rr, has && t.real) + cell(m, t.ly, has && t.realLy) + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  // Cómo leer los números según los switches de la página (nota al pie y hoja Info del Excel)
  function notes() {
    var org = typeof W._orgTargetFor_ === 'function' && W._orgTargetFor_('budget');
    var dir = Array.isArray(W._dirSel) && W._dirSel.length;
    var out = ['Real en USD nominal.',
      org ? 'Organic YES: el Δ vs Budget compara el real a TC Budget y el Δ vs LY el real a TC LY (como el Daily); vs Run Rate, nominal.' : 'Organic NO: todo en USD nominal.',
      'COI Brasil: ' + (W._exCoiBr !== false ? 'Excluir' : 'Incluir') + ' · Partner TBD: ' + (W._b2bcExclTBD ? 'Excluir' : 'Incluir') +
        (Array.isArray(W._canalSel) ? ' · Canal B2B2C: ' + W._canalSel.join(', ') : '') + (dir ? ' · Director: ' + W._dirSel.join(', ') : '') + ' (de "+ Filtros").'];
    if (dir) out.push('Con director elegido, B2B no tiene Budget ni Run Rate (no vienen por agencia).');
    return out;
  }

  function download() {
    var X = W.DailyExcel;
    if (!X || typeof X.workbookFromSheets !== 'function' || !last) return;
    var info = ['Tabla adhoc del Daily (Ownia): foto de un día de B2B2C, B2B MAY (API) y B2B MIN (Agencias afiliadas), vs Budget, Run Rate y LY.',
      'Día: ' + dateLabel(last.fecha) + ' · LY: ' + dateLabel(last.fechaLy) + (last.meta.last_actuals_date ? ' · reales al ' + dateLabel(last.meta.last_actuals_date) : '') +
        (last.meta.generated_at ? ' · generado ' + last.meta.generated_at : ''),
      'B2B2C por fecha de confirmación; B2B por fecha de gestión (GD). Total = B2B2C + B2B MAY + B2B MIN, de los negocios con datos ese día (en un país que un negocio no tiene, ese negocio no cuenta); si a uno que sí cuenta le falta un goal, el Total queda sin ese goal.',
      'Δ % = (real − goal) / |goal|. Montos en USD.'].concat(notes());
    info.push('País: ' + paisSelLabel(last.paises) + '. La hoja "Por país" abre cada tabla por país (los de la selección), una fila por negocio × país × métrica, con autofiltro. ' +
      'RG = ajuste COI Brasil (solo FVM), como entrada propia, igual que en el Daily. Globales = Other Countries + USA + Uruguay + Paraguay. Ecuador va aparte (no tiene Budget).');
    var byCountry = computeByCountry(last.src, last.fecha, last.fechaLy, last.paises);
    var bytes = X.workbookFromSheets(buildSheets(last.res, last.fecha, last.fechaLy, X.STYLE, info, byCountry, paisSelLabel(last.paises)));
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Tabla_adhoc_' + last.fecha + '_vs_LY_' + last.fechaLy +
      (last.paises.length === 1 ? '_' + last.paises[0].replace(/\s+/g, '_') : last.paises.length ? '_' + last.paises.length + '_paises' : '') + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ── Filtro de país (multiselección; vacío = todos) ──
  function paisSelLabel(ps) {
    if (!ps || !ps.length) return 'Todos';
    return ps.length <= 3 ? ps.map(paisLabel).join(', ') : ps.length + ' países';
  }
  var paisList = '';
  function fillPaises(list) {
    var key = list.join('|');
    if (key === paisList) return syncPaises();
    paisList = key;
    st.paises = st.paises.filter(function (p) { return list.indexOf(p) >= 0; });
    var pop = el('adh-pais-pop');
    if (!pop) return;
    pop.innerHTML = '<label class="adh-pchk adh-pall"><input type="checkbox" data-p="__all"> Todos</label>' +
      list.map(function (p) { return '<label class="adh-pchk"><input type="checkbox" data-p="' + esc(p) + '"> ' + esc(paisLabel(p)) + '</label>'; }).join('');
    syncPaises();
  }
  function syncPaises() {
    var pop = el('adh-pais-pop'), btn = el('adh-pais-btn');
    if (pop) Array.prototype.forEach.call(pop.querySelectorAll('input[data-p]'), function (i) {
      var p = i.getAttribute('data-p');
      i.checked = p === '__all' ? !st.paises.length : st.paises.indexOf(p) >= 0;
    });
    if (btn) { btn.textContent = 'País: ' + paisSelLabel(st.paises) + ' ▾'; btn.classList.toggle('on', !!st.paises.length); }
  }

  function render() {
    var body = el('adh-body');
    if (!body || !active) return;
    var b2bc = srcB2BC(), b2b = srcB2B();
    var meta = (W._rawB2BC && W._rawB2BC.meta) || (W._rawB2B && W._rawB2B.meta) || {};
    var src = { b2b2c: b2bc, b2b: b2b };
    if (b2bc && b2b) fillPaises(countriesOf(src));
    var res = computeTables(src, st.fecha, st.fechaLy, st.paises);
    var lab = el('adh-asof');
    if (lab) lab.textContent = 'Real del ' + dateLabel(st.fecha) + ' vs LY del ' + dateLabel(st.fechaLy) +
      ' · País: ' + paisSelLabel(st.paises) + (meta.last_actuals_date ? ' · datos al ' + dateLabel(meta.last_actuals_date) : '');
    var warn = (meta.last_actuals_date && st.fecha > meta.last_actuals_date)
      ? '<div class="adh-note" style="color:var(--warning);margin:0 0 10px">El ' + esc(dateLabel(st.fecha)) + ' todavía no está en los reales (último día: ' + esc(dateLabel(meta.last_actuals_date)) + '). Falta correr "Actualizar reales".</div>' : '';
    last = { res: res, src: src, meta: meta, fecha: st.fecha, fechaLy: st.fechaLy, paises: st.paises.slice() };
    body.innerHTML = warn + '<div class="adh-grid">' +
      tableHtml(res.total, 'Total', 'B2B2C + B2B MAY + B2B MIN', true) +
      BIZ.map(function (b) { return tableHtml(res[b.k], b.lbl, b.sub); }).join('') + '</div>' +
      '<div class="adh-note">Δ % = (real − goal) / |goal|; debajo, la diferencia en la unidad de la métrica. Colores: verde ≥ 0%, ámbar entre −5% y 0%, rojo debajo de −5%. ' +
      esc(notes().join(' ')) + '</div>';
    clearTimeout(retry);
    if (!b2bc || !b2b) retry = setTimeout(render, 1000);   // el preload de B2B (o B2B2C) todavía no llegó
  }

  function buildView() {
    if (el('view-adhoc')) return;
    var anchor = el('view-daily');
    if (!anchor) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    var v = document.createElement('div');
    v.id = 'view-adhoc';
    v.style.display = 'none';
    v.innerHTML = '<div class="content">' +
      '<div class="section-hdr-row"><div class="section-hdr">Tabla adhoc · foto del día</div>' +
      '<div class="adh-ctrl">' +
        '<label>Día <input type="date" id="adh-fecha" value="' + st.fecha + '"></label>' +
        '<label>LY <input type="date" id="adh-fecha-ly" value="' + st.fechaLy + '"></label>' +
        '<button type="button" class="ttab" id="adh-reset" title="Jueves 26/11/2026 vs jueves 27/11/2025 (semana 48)">26/11 vs jue sem. 48</button>' +
        '<div class="adh-pais"><button type="button" class="adh-pais-btn" id="adh-pais-btn" aria-haspopup="true">País: Todos ▾</button>' +
          '<div class="adh-pais-pop" id="adh-pais-pop" role="dialog" aria-label="País"></div></div>' +
        '<button type="button" class="adh-xls" id="adh-xls" title="Baja las cuatro tablas como se ven y la apertura por país (con los filtros de la página) en un .xlsx">⬇ Descargar Excel</button>' +
      '</div></div>' +
      '<div class="bench-sub" id="adh-asof" style="margin:-4px 0 12px"></div>' +
      '<div id="adh-body"></div></div>';
    anchor.parentNode.insertBefore(v, anchor.nextSibling);
    el('adh-fecha').addEventListener('change', function (e) {
      var f = e.target.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return;
      st.fechaLy = shiftDate(st.fechaLy, daysBetween(st.fecha, f));   // el LY se corre lo mismo que el día
      st.fecha = f;
      el('adh-fecha-ly').value = st.fechaLy;
      render();
    });
    el('adh-fecha-ly').addEventListener('change', function (e) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { st.fechaLy = e.target.value; render(); }
    });
    el('adh-xls').addEventListener('click', function () { try { download(); } catch (e) { console.warn('[daily-adhoc] excel', e); } });
    var pbox = v.querySelector('.adh-pais');
    el('adh-pais-btn').addEventListener('click', function (e) { e.stopPropagation(); pbox.classList.toggle('open'); });
    el('adh-pais-pop').addEventListener('click', function (e) { e.stopPropagation(); });
    el('adh-pais-pop').addEventListener('change', function (e) {
      var i = e.target.closest('input[data-p]');
      if (!i) return;
      var p = i.getAttribute('data-p');
      if (p === '__all') st.paises = [];
      else if (i.checked) { if (st.paises.indexOf(p) < 0) st.paises.push(p); }
      else st.paises = st.paises.filter(function (x) { return x !== p; });
      var order = paisList.split('|');   // en el orden de la lista
      st.paises.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
      syncPaises();
      render();
    });
    document.addEventListener('click', function () { pbox.classList.remove('open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') pbox.classList.remove('open'); });
    el('adh-reset').addEventListener('click', function () {
      st.fecha = DEF_FECHA; st.fechaLy = DEF_FECHA_LY;
      el('adh-fecha').value = st.fecha; el('adh-fecha-ly').value = st.fechaLy;
      render();
    });

    // Pill al lado de "Benchmark vs B2C" (daily-filtros.js después la mueve a la derecha con las demás, en este orden)
    var bench = el('vnav-bench');
    if (bench && !el('vnav-adhoc')) {
      var btn = document.createElement('button');
      btn.className = 'vnav-btn';
      btn.id = 'vnav-adhoc';
      btn.textContent = 'Tabla adhoc';
      btn.addEventListener('click', function () { W.switchMainView('adhoc'); });
      bench.insertAdjacentElement('afterend', btn);
    }
  }

  function hook() {
    var orig = W.switchMainView;
    if (typeof orig !== 'function' || orig._adh) return;
    var wrapped = function (view) {
      var v = el('view-adhoc'), b = el('vnav-adhoc');
      if (view !== 'adhoc') {
        active = false;
        if (v) v.style.display = 'none';
        if (b) b.classList.remove('active');
        return orig.apply(this, arguments);
      }
      orig.call(this, 'daily');   // deja el estado del Daily coherente; después se oculta
      active = true;
      el('view-daily').style.display = 'none';
      document.querySelectorAll('.vnav-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
      var lt = el('daily-lob-toggle'); if (lt) lt.style.display = 'none';
      var tc = el('b2bc-top-ctls'); if (tc) tc.style.display = 'none';
      var t = el('topbar-title'); if (t) t.textContent = 'Tabla adhoc';
      if (v) v.style.display = '';
      render();
    };
    wrapped._adh = true;
    W.switchMainView = wrapped;
    // Redibujar si la solapa está abierta cuando cambia un switch o filtro de la página
    ['toggleTheme', 'setExCoiBr', 'setDailyOrganic', '_syncOrganicUI_', 'setExclTBD', 'dirSet_', 'canalSet_', '_orgRefreshAll_'].forEach(function (fn) {
      var o = W[fn];
      if (typeof o !== 'function') return;
      W[fn] = function () { var r = o.apply(this, arguments); if (active) { try { render(); } catch (e) { console.warn('[daily-adhoc]', e); } } return r; };
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    try {
      buildView();
      hook();
      if (new URLSearchParams(W.location.search).get('tab') === 'adhoc') W.switchMainView('adhoc');
    } catch (e) { console.warn('[daily-adhoc]', e); }
  });
})(typeof window !== 'undefined' ? window : this);
