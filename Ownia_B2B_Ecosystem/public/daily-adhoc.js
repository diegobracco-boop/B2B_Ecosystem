/* Daily Dashboard en Ownia — solapa "Tabla adhoc" (2026-11-27, Diego). Lo inyecta server/index.js en el Daily
 * (`layout` en server/modules.js). El HTML de Apps Script no se toca.
 *
 * Foto de uno o varios días: Orders, GB, Net Revenue y FVM de B2B2C, B2B MAY (canal API) y B2B MIN (Agencias
 * afiliadas), una tabla por negocio y una Total (la suma de los tres), contra Budget, Run Rate y Last Year de los
 * mismos días, y la participación vs B2C (negocio / (negocio + B2C), con su Δ pp vs LY).
 *  - Días (2026-11-28): selector desplegable con calendario, se eligen varios días (clic, shift+clic = rango, clic en
 *    la semana = la semana entera, atajos). Real / Budget / Run Rate suman los días elegidos; el LY suma los mismos días
 *    del año anterior: por default el mismo día de la semana (−364 días: jue 26/11/2026 → jue 27/11/2025, semana 48),
 *    o la misma fecha calendario.
 *  - Part. vs B2C (2026-11-28, como Industry events): negocio / (negocio + B2C) en los mismos días y países, y su cambio
 *    en pp contra la del LY de esos días (raw.b2c / raw.b2c_ly del JSON del Daily, como el Benchmark vs B2C). Primero
 *    fue la resta de YoY (negocio − B2C), que con B2C cayendo daba brechas de +50 pp difíciles de leer. B2C no trae
 *    Orders: esa fila va en "—".
 *  - "Summary Comité Ejecutivo" (2026-11-28): otra hoja con una sola tabla, filas TOTAL / BRASIL / RESTO (Brasil = Brasil
 *    + RG, el ajuste COI Brasil; Resto = todos los demás países) × métrica, filtro de LoB (Total / MIN / MAY / B2B2C) y el
 *    mismo selector de días (compartido con la Tabla adhoc). `?tab=comite` la abre directo.
 *  - B2B2C por fecha de confirmación (actuals / actuals_ly / budget / runrate del JSON del Daily); B2B por fecha de
 *    gestión (GD: b2b_gd / b2b_gd_ly / b2b_budget_gd / b2b_runrate_gd).
 *  - Sigue los switches de la página: Organic (como el Daily: el real se convierte al TC Budget para el Δ vs Budget y al
 *    TC LY para el Δ vs LY y la participación vs B2C —B2C también a TC LY—; vs Run Rate nominal; la columna Real va en USD nominal),
 *    COI Brasil (filas RG), Partner TBD, Canal y Director (los aplican dashboard.html y daily-filtros.js sobre los mismos
 *    arreglos).
 * No pide nada al servidor: lee _rawB2BC / _rawB2B que ya cargó el Daily (B2B llega en el preload en paralelo).
 * Lógica pura en window.DailyAdhoc, probada en test/daily-adhoc.test.js.
 */
(function (root) {
  'use strict';

  var DEF_FECHA = '2026-11-26';      // jueves 26/11/2026 (ayer al armarla)
  var LY_DOW = -364;                 // mismo día de la semana del año anterior (26/11/2026 → 27/11/2025)
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
  // Summary Comité Ejecutivo: filas y LoB
  var BRASIL = ['Brasil', 'RG'];   // RG = ajuste COI Brasil
  var SEGS = [
    { k: 'total', lbl: 'TOTAL', paises: null },
    { k: 'brasil', lbl: 'BRASIL', paises: BRASIL },
    { k: 'resto', lbl: 'RESTO', paises: { excl: BRASIL } },
  ];
  var LOBS = [
    { k: 'total', lbl: 'Total', sub: 'B2B2C + B2B MAY + B2B MIN' },
    { k: 'min', lbl: 'MIN', sub: 'B2B MIN · Agencias afiliadas · fecha de gestión' },
    { k: 'may', lbl: 'MAY', sub: 'B2B MAY · API · fecha de gestión' },
    { k: 'b2b2c', lbl: 'B2B2C', sub: 'B2B2C · fecha de confirmación' },
  ];
  var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // ── Lógica pura ────────────────────────────────────────────────────────
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function zero() { return { orders: 0, gb: 0, nr: 0, fvm: 0 }; }
  // Globales (2026-11-27, Diego): Other Countries + USA + Uruguay + Paraguay, como el Benchmark del Daily (el Budget B2B no
  // abre Uruguay ni Paraguay; USA es chico). Ecuador va aparte (no tiene Budget).
  var GLOBALES = 'Globales';
  var PAIS_MAP = { 'Other Countries': GLOBALES, 'USA': GLOBALES, 'Uruguay': GLOBALES, 'Paraguay': GLOBALES };
  function paisOf(r) { return PAIS_MAP[r.pais] || r.pais; }
  // B2B2C actuals y B2C traen net_revenues; budget / run rate y todo B2B, net_revenue.
  function nrOf(r) { return r.net_revenues != null ? r.net_revenues : r.net_revenue; }

  // 'AAAA-MM-DD' o lista → lista ordenada sin repetidos
  function toList(f) {
    var l = Array.isArray(f) ? f : f ? [f] : [], s = {};
    return l.filter(function (x) { if (!x || s[x]) return false; s[x] = 1; return true; }).sort();
  }
  function setOf(l) { var s = {}; l.forEach(function (x) { s[x] = 1; }); return s; }
  // paises: null / [] = todos; ['A', 'B'] = esos; { excl: [...] } = todos menos esos. Devuelve un predicado o null.
  function paisFilter(paises) {
    if (!paises) return null;
    if (Array.isArray(paises)) { if (!paises.length) return null; var s = setOf(paises); return function (p) { return !!s[p]; }; }
    if (paises.excl) { var x = setOf(paises.excl); return function (p) { return !x[p]; }; }
    return null;
  }

  // Suma los días pedidos (fecha o lista) de un arreglo de filas; ch = parent_channel (solo B2B); paises = como
  // paisFilter o ya un predicado. null si no hay arreglo.
  function sumDay(rows, fechas, ch, paises) {
    if (!Array.isArray(rows)) return null;
    var fs = setOf(toList(fechas)), pf = typeof paises === 'function' ? paises : paisFilter(paises);
    var t = zero(), n = 0;
    rows.forEach(function (r) {
      if (!r || !fs[r.fecha]) return;
      if (ch && r.parent_channel !== ch) return;
      if (pf && !pf(paisOf(r))) return;
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

  /* src = { b2b2c: S, b2b: S, b2c: { cur, ly } } con S = { act, actBud, actLy, bud, rr, ly } (arreglos; actBud / actLy =
   * el real ya convertido por organic, o los mismos act). B2B se filtra por canal. fechas / fechasLy = un día o una
   * lista. Devuelve { b2b2c, may, min, total, b2c }; cada negocio { real, realBud, realLy, bud, rr, ly } con totales
   * por métrica (null si falta la fuente o no hay filas del goal); b2c = { cur, ly } (null sin la fuente).
   * paises = como paisFilter (vacío o null = todos). */
  function computeTables(src, fechas, fechasLy, paises) {
    var F = toList(fechas), FL = toList(fechasLy), pf = paisFilter(paises);
    var out = {};
    BIZ.forEach(function (b) {
      var s = b.ch ? src.b2b : src.b2b2c;
      if (!s) { out[b.k] = null; return; }
      var bud = sumDay(s.bud, F, b.ch, pf), rr = sumDay(s.rr, F, b.ch, pf), ly = sumDay(s.ly, FL, b.ch, pf);
      out[b.k] = {
        real: sumDay(s.act, F, b.ch, pf),
        realBud: sumDay(s.actBud || s.act, F, b.ch, pf),
        realLy: sumDay(s.actLy || s.act, F, b.ch, pf),
        bud: bud && bud.n ? bud : null,
        rr: rr && rr.n ? rr : null,
        ly: ly && ly.n ? ly : null,
      };
    });
    out.b2c = src.b2c ? { cur: sumDay(src.b2c.cur, F, null, pf), ly: sumDay(src.b2c.ly, FL, null, pf) } : null;
    var tot = {}, parts = BIZ.map(function (b) { return out[b.k]; });
    if (!parts.every(function (p) { return p; })) { out.total = null; return out; }
    // Negocios que juegan en el Total: los que tienen algo esos días (real o algún goal). Con un país que un negocio no
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

  /* Participación vs B2C de una métrica (como Industry events): negocio / (negocio + B2C) en los días elegidos (real a
   * TC LY, B2C también) y en los mismos días del LY; d = cur − ly. En fracción (0.179 = 17.9%; d 0.097 = +9.7 pp).
   * null sin real o sin B2C, o en Orders (B2C no las trae); ly / d null si falta el LY. */
  function partOf(a, b) { return a == null || b == null || a + b <= 0 ? null : a / (a + b); }
  function partB2C(t, b2c, k) {
    if (k === 'orders' || !t || !t.real || !t.real.n || !b2c || !b2c.cur || !b2c.cur.n) return null;
    var cur = partOf((t.realLy || t.real)[k], b2c.cur[k]);
    if (cur == null) return null;
    var ly = t.ly && b2c.ly && b2c.ly.n ? partOf(t.ly[k], b2c.ly[k]) : null;
    return { cur: cur, ly: ly, d: ly == null ? null : cur - ly };
  }

  // Recorta las fuentes a los días pedidos, así varias tablas (por país, Comité) no barren los arreglos completos.
  function cutSrc(src, fechas, fechasLy) {
    var F = setOf(toList(fechas)), FL = setOf(toList(fechasLy));
    function d(rows, fs) { return Array.isArray(rows) ? rows.filter(function (r) { return r && fs[r.fecha]; }) : rows; }
    function cut(s) {
      if (!s) return s;
      return { act: d(s.act, F), actBud: d(s.actBud || s.act, F), actLy: d(s.actLy || s.act, F), bud: d(s.bud, F), rr: d(s.rr, F), ly: d(s.ly, FL) };
    }
    return { b2b2c: cut(src.b2b2c), b2b: cut(src.b2b), b2c: src.b2c ? { cur: d(src.b2c.cur, F), ly: d(src.b2c.ly, FL) } : src.b2c };
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
  function hasAny(t) { return !!(t && ((t.real && t.real.n) || t.bud || t.rr || t.ly)); }

  // Una tabla por país (para el Excel aperturado). Devuelve [{ pais, res }] solo con los países que tienen algo esos días.
  function computeByCountry(src, fechas, fechasLy, paises) {
    var small = cutSrc(src, fechas, fechasLy);
    var list = (Array.isArray(paises) && paises.length) ? paises : countriesOf(small);
    return list.map(function (p) { return { pais: p, res: computeTables(small, fechas, fechasLy, [p]) }; })
      .filter(function (x) { return hasAny(x.res.total); });
  }

  // Summary Comité Ejecutivo: [{ k, lbl, res }] para TOTAL / BRASIL / RESTO (res = computeTables de ese segmento)
  function computeComite(src, fechas, fechasLy) {
    var small = cutSrc(src, fechas, fechasLy);
    return SEGS.map(function (s) { return { k: s.k, lbl: s.lbl, res: computeTables(small, fechas, fechasLy, s.paises) }; });
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
  function dow(f) { var p = String(f).split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
  // LY de un día: 'dow' = mismo día de la semana (−364); 'cal' = misma fecha del año anterior (29/02 → 28/02)
  function lyDate(f, mode) {
    if (mode !== 'cal') return shiftDate(f, LY_DOW);
    var p = String(f).split('-');
    var y = Number(p[0]) - 1, md = p[1] + '-' + p[2];
    if (md === '02-29') md = '02-28';
    return y + '-' + md;
  }
  function lyDates(fechas, mode) { return toList(toList(fechas).map(function (f) { return lyDate(f, mode); })); }
  function mondayOf(f) { return shiftDate(f, -((dow(f) + 6) % 7)); }
  // Semana ISO (la del Daily: semana 48 de 2026 = 23/11 – 29/11)
  function isoWeek(f) {
    var th = shiftDate(mondayOf(f), 3), y = Number(th.slice(0, 4));
    return 1 + Math.floor(daysBetween(mondayOf(y + '-01-04'), th) / 7);
  }
  function dateLabel(f) {
    var p = String(f || '').split('-').map(Number);
    if (p.length !== 3 || !p[0]) return f || '';
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return DIAS[d.getUTCDay()] + ' ' + String(p[2]).padStart(2, '0') + '/' + String(p[1]).padStart(2, '0') + '/' + p[0];
  }
  function shortLabel(f) { return dateLabel(f).slice(0, 9); }   // 'jue 26/11'
  // Varios días: un día → 'jue 26/11/2026'; corrido → 'lun 23/11 – dom 29/11/2026 (7 días)'; sueltos → '3 días: 02/11, 05/11, 09/11/2026'
  function fechasLabel(fechas) {
    var l = toList(fechas);
    if (!l.length) return '';
    if (l.length === 1) return dateLabel(l[0]);
    var a = l[0], b = l[l.length - 1];
    if (daysBetween(a, b) === l.length - 1) return shortLabel(a) + (a.slice(0, 4) !== b.slice(0, 4) ? '/' + a.slice(0, 4) : '') + ' – ' + dateLabel(b) + ' (' + l.length + ' días)';
    var dm = function (f) { return f.slice(8, 10) + '/' + f.slice(5, 7); };
    var shown = l.length <= 4 ? l.map(dm).join(', ') : l.slice(0, 3).map(dm).join(', ') + '… ' + dm(b);
    return l.length + ' días: ' + shown + '/' + b.slice(0, 4);
  }
  function fileTag(fechas) {
    var l = toList(fechas);
    return l.length === 1 ? l[0] : l[0] + '_a_' + l[l.length - 1] + '_' + l.length + 'd';
  }

  /* Hojas para "Descargar Excel" (las escribe DailyExcel.workbookFromSheets): "Tabla adhoc" con un bloque por tabla
   * (Total primero, como la página) y "Info". Montos en USD sin redondear (la celda los muestra con #,##0) y Δ % como
   * número con formato de porcentaje. Si no hay real, Real y los Δ quedan vacíos (igual que el "—" de la página).
   * S = estilos de DailyExcel; info = líneas de texto para la hoja Info; byCountry = computeByCountry(...) para la hoja
   * "Por país" (una fila por negocio × país × métrica, con autofiltro); paisLbl = el filtro de país de la página. */
  var BLOCKS = [['total', 'Total', 'B2B2C + B2B MAY + B2B MIN']].concat(BIZ.map(function (b) { return [b.k, b.lbl, b.sub]; }));
  function paisLabel(p) { return p === 'RG' ? 'RG (ajuste COI Brasil)' : p; }
  function lyHead(fechasLy) { var l = toList(fechasLy); return 'LY (' + (l.length === 1 ? dateLabel(l[0]) : fechasLabel(l)) + ')'; }
  function cmpHead(fechasLy) {
    return ['Budget', 'Δ % vs Budget', 'Δ vs Budget', 'Run Rate', 'Δ % vs RR', 'Δ vs RR', lyHead(fechasLy), 'Δ % vs LY', 'Δ vs LY',
      'Part. vs B2C', 'Part. vs B2C LY', 'Δ pp part. vs LY'];
  }
  // Real + las tres comparaciones + participación vs B2C de una métrica (sin real: Real y Δ vacíos)
  function xlsCells(S, t, m, b2c) {
    var T = function (v, s) { return v == null || !isFinite(v) ? null : { v: v, t: 'n', s: s }; };
    var has = !!(t && t.real && t.real.n);
    function cmp(goal, rg) {
      var g = goal ? goal[m.k] : null, r = has && rg ? rg[m.k] : null;
      return [T(g, S.n), T(goal && r != null ? delta(r, g) : null, S.pct), T(goal && r != null ? r - g : null, S.n)];
    }
    var pb = partB2C(t, b2c, m.k);
    return [T(has ? t.real[m.k] : null, S.nb)].concat(cmp(t && t.bud, t && t.realBud), cmp(t && t.rr, t && t.real), cmp(t && t.ly, t && t.realLy),
      [T(pb ? pb.cur : null, S.pct), T(pb ? pb.ly : null, S.pct), T(pb ? pb.d : null, S.pct)]);
  }
  var XLS_COLS = [14, 14, 13, 14, 14, 13, 14, 22, 13, 14, 13, 14, 15];   // Real + 12 columnas de cmpHead
  function buildSheets(res, fechas, fechasLy, S, info, byCountry, paisLbl) {
    var T = function (v, s) { return { v: v, t: 's', s: s || 0 }; };
    var head = cmpHead(fechasLy);
    var rows = [[T('Tabla adhoc · ' + fechasLabel(fechas) + ' vs LY ' + fechasLabel(fechasLy) + ' · País: ' + (paisLbl || 'Todos'), S.b)], []];
    BLOCKS.forEach(function (bk) {
      var t = res[bk[0]];
      rows.push([T(bk[1] + ' · ' + bk[2], S.b)]);
      rows.push(['Métrica', 'Real'].concat(head).map(function (h) { return T(h, S.head); }));
      METRICS.forEach(function (m) { rows.push([T(m.lbl, S.b)].concat(xlsCells(S, t, m, res.b2c))); });
      rows.push([]);
    });
    var sheets = [{ name: 'Tabla adhoc', cols: [16].concat(XLS_COLS), rows: rows }];
    if (byCountry) {
      var pr = [['Negocio', 'País', 'Métrica', 'Real'].concat(head).map(function (h) { return T(h, S.head); })];
      BLOCKS.forEach(function (bk) {
        byCountry.forEach(function (x) {
          var t = x.res[bk[0]];
          if (!hasAny(t)) return;   // ese negocio no está en ese país
          METRICS.forEach(function (m) { pr.push([T(bk[1]), T(paisLabel(x.pais)), T(m.lbl)].concat(xlsCells(S, t, m, x.res.b2c))); });
        });
      });
      sheets.push({ name: 'Por país', cols: [12, 22, 13].concat(XLS_COLS), rows: pr, freeze: true,
        filter: 'A1:P' + pr.length });
    }
    sheets.push({ name: 'Info', cols: [120], rows: (info || []).map(function (l) { return [T(l)]; }) });
    return sheets;
  }
  // Excel del Summary Comité Ejecutivo: un bloque por LoB (la elegida primero), filas Segmento × Métrica.
  function buildComiteSheets(segs, lob, fechas, fechasLy, S, info) {
    var T = function (v, s) { return { v: v, t: 's', s: s || 0 }; };
    var head = cmpHead(fechasLy);
    var order = LOBS.filter(function (l) { return l.k === lob; }).concat(LOBS.filter(function (l) { return l.k !== lob; }));
    var rows = [[T('Summary Comité Ejecutivo · ' + fechasLabel(fechas) + ' vs LY ' + fechasLabel(fechasLy), S.b)], []];
    order.forEach(function (l) {
      rows.push([T('LoB ' + l.lbl + ' · ' + l.sub, S.b)]);
      rows.push(['Segmento', 'Métrica', 'Real'].concat(head).map(function (h) { return T(h, S.head); }));
      segs.forEach(function (sg) {
        METRICS.forEach(function (m) { rows.push([T(sg.lbl, S.b), T(m.lbl)].concat(xlsCells(S, sg.res[l.k], m, sg.res.b2c))); });
      });
      rows.push([]);
    });
    return [{ name: 'Summary Comité', cols: [12, 14].concat(XLS_COLS), rows: rows },
      { name: 'Info', cols: [120], rows: (info || []).map(function (x) { return [T(x)]; }) }];
  }

  root.DailyAdhoc = { sumDay: sumDay, delta: delta, computeTables: computeTables, partB2C: partB2C, shiftDate: shiftDate, daysBetween: daysBetween,
    dateLabel: dateLabel, fechasLabel: fechasLabel, lyDate: lyDate, lyDates: lyDates, isoWeek: isoWeek, buildSheets: buildSheets,
    buildComiteSheets: buildComiteSheets, computeComite: computeComite, countriesOf: countriesOf, paisOf: paisOf,
    computeByCountry: computeByCountry, paisLabel: paisLabel, METRICS: METRICS, BIZ: BIZ, SEGS: SEGS, LOBS: LOBS };

  // ── Página ─────────────────────────────────────────────────────────────
  if (typeof document === 'undefined' || /[?&](flowdeck=1|embed=|weeklyembed=)/.test(root.location ? root.location.search : '')) return;
  var W = root;
  var st = { fechas: [DEF_FECHA], lyMode: 'dow', paises: [], lob: 'total', calM: DEF_FECHA.slice(0, 7), anchor: null };   // paises vacío = todos
  var active = null, retry = null, last = null, lastCom = null;   // active = 'adhoc' | 'comite' | null; last* = lo último dibujado (Excel)
  function fechasLy() { return lyDates(st.fechas, st.lyMode); }

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtMoney(v) { return typeof W.fmt === 'function' ? W.fmt(v) : '$' + Math.round(v).toLocaleString('es-AR'); }
  function fmtVal(m, v) { return v == null ? '—' : m.money ? fmtMoney(v) : Math.round(v).toLocaleString('es-AR'); }
  function fmtPct(d) {
    if (d == null) return '—';
    var p = d * 100, a = Math.abs(p);
    return (p > 0 ? '+' : p < 0 ? '−' : '') + a.toFixed(a < 10 ? 1 : 0) + '%';
  }
  function fmtPp(d) {
    if (d == null) return '—';
    var p = d * 100, a = Math.abs(p);
    return (p > 0 ? '+' : p < 0 ? '−' : '') + a.toFixed(1) + ' pp';
  }
  // mismo semáforo que el resto de Ownia (_deltaState_ del Hub): verde ≥ 0%, ámbar −5% a 0%, rojo < −5% (en la participación, Δ pp)
  function cls(d) { return d == null ? '' : d >= 0 ? 'pos' : d >= -0.05 ? 'amb' : 'neg'; }

  var R = '.adh-root ';
  var CSS = [
    R + '.adh-ctrl{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
    R + '.adh-ctrl .ttab{font-size:10px}',
    R + '.adh-xls{background:var(--primary);color:#fff;border:1px solid var(--primary);font:700 11px var(--font);padding:4px 12px;border-radius:20px;cursor:pointer;white-space:nowrap}',
    R + '.adh-xls:hover{filter:brightness(1.12)}',
    R + '.adh-com{background:transparent;color:var(--primary);border:1px solid var(--primary);font:700 11px var(--font);padding:4px 12px;border-radius:20px;cursor:pointer;white-space:nowrap}',
    R + '.adh-com:hover{background:var(--primary-d)}',
    R + '.adh-pais,' + R + '.adh-dp{position:relative}',
    R + '.adh-pais-btn{background:transparent;border:1px solid var(--border);color:var(--text-2);font:700 11px var(--font);padding:4px 12px;border-radius:20px;cursor:pointer;white-space:nowrap}',
    R + '.adh-pais-btn:hover,' + R + '.adh-pais.open .adh-pais-btn,' + R + '.adh-dp.open .adh-pais-btn{color:var(--text);border-color:rgba(86,38,233,.4)}',
    R + '.adh-pais-btn.on{color:var(--text);border-color:var(--primary);background:var(--primary-d)}',
    R + '.adh-pais-pop,' + R + '.adh-dp-pop{display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:300;min-width:210px;max-height:360px;overflow:auto;padding:8px 10px;',
    '  border-radius:10px;background:var(--elevated,var(--surface));border:1px solid var(--border);box-shadow:0 10px 28px rgba(0,0,0,.28)}',
    R + '.adh-dp-pop{max-height:none;width:300px;padding:10px 12px}',
    R + '.adh-pais.open .adh-pais-pop,' + R + '.adh-dp.open .adh-dp-pop{display:block}',
    R + '.adh-pchk{display:flex;align-items:center;gap:8px;padding:4px 2px;font:600 12px var(--font);color:var(--text-2);cursor:pointer;white-space:nowrap}',
    R + '.adh-pchk:hover{color:var(--text)}',
    R + '.adh-pall{border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:4px}',
    // selector de días
    R + '.adh-dp-q{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}',
    R + '.adh-dp-q button,' + R + '.adh-dp-ly button{background:transparent;border:1px solid var(--border);color:var(--text-2);font:700 10px var(--font);padding:3px 8px;border-radius:12px;cursor:pointer}',
    R + '.adh-dp-q button:hover,' + R + '.adh-dp-ly button:hover{color:var(--text);border-color:rgba(86,38,233,.4)}',
    R + '.adh-dp-ly button.on{color:var(--text);border-color:var(--primary);background:var(--primary-d)}',
    R + '.adh-dp-hd{display:flex;align-items:center;justify-content:space-between;font:700 12px var(--font);color:var(--text);margin:2px 0 4px;text-transform:capitalize}',
    R + '.adh-dp-hd button{background:transparent;border:0;color:var(--text-2);font:700 15px var(--font);cursor:pointer;padding:0 8px}',
    R + 'table.adh-cal{width:100%;border-collapse:collapse;font-size:11px}',
    R + 'table.adh-cal th{font-size:9.5px;text-align:center;padding:2px 0;border:0;color:var(--text-3)}',
    R + 'table.adh-cal td{padding:1px;border:0;text-align:center}',
    R + 'table.adh-cal button{width:100%;min-width:28px;height:26px;border:0;border-radius:6px;background:transparent;color:var(--text-2);font:600 11px var(--font);cursor:pointer}',
    R + 'table.adh-cal button:hover{background:var(--primary-d);color:var(--text)}',
    R + 'table.adh-cal button.out{opacity:.45}',
    R + 'table.adh-cal button.nod{text-decoration:line-through;opacity:.4}',
    R + 'table.adh-cal button.on{background:var(--primary);color:#fff;opacity:1}',
    R + 'table.adh-cal button.wk{font-size:9px;color:var(--text-3);min-width:30px}',
    R + '.adh-dp-ly{display:flex;align-items:center;gap:4px;flex-wrap:wrap;font:700 10px var(--font);color:var(--text-3);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}',
    R + '.adh-dp-sum{font-size:10.5px;color:var(--text-3);margin-top:6px;line-height:1.4}',
    R + '.adh-dp-ft{display:flex;justify-content:flex-end;margin-top:8px}',
    R + '.adh-dp-ft button{background:var(--primary);color:#fff;border:0;font:700 11px var(--font);padding:4px 14px;border-radius:14px;cursor:pointer}',
    // tablas
    R + '.adh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,640px),1fr));gap:12px;align-items:start}',
    R + '.adh-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:14px 14px 10px;min-width:0;overflow-x:auto}',
    R + '.adh-card.tot{border-color:rgba(86,38,233,.45)}',
    R + '.adh-ttl{font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px}',
    R + '.adh-sub{font-size:10px;color:var(--text-3);font-weight:600;margin-bottom:10px}',
    R + 'table.adh-t{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}',
    R + 'table.adh-t th{font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;text-align:right;padding:4px 8px;border-bottom:1px solid var(--border);white-space:nowrap}',
    R + 'table.adh-t th:first-child,' + R + 'table.adh-t td:first-child{text-align:left;padding-left:0}',
    R + 'table.adh-t th.grp{border-left:1px solid var(--border)}',
    R + 'table.adh-t td{text-align:right;padding:7px 8px;border-bottom:1px solid var(--border);color:var(--text-2);white-space:nowrap}',
    R + 'table.adh-t tr:last-child td{border-bottom:0}',
    R + 'table.adh-t td.m{color:var(--text);font-weight:700;text-align:left}',
    R + 'table.adh-t td.real{color:var(--text);font-weight:700}',
    R + 'table.adh-t td.grp{border-left:1px solid var(--border)}',
    R + 'table.adh-t td.d{font-weight:700}',
    R + 'table.adh-t td.d small{display:block;font-size:9.5px;font-weight:600;opacity:.75}',
    R + 'table.adh-t td.pos{color:var(--success)}' + R + 'table.adh-t td.amb{color:var(--warning)}' + R + 'table.adh-t td.neg{color:var(--danger)}',
    R + 'table.adh-t th.b2c,' + R + 'table.adh-t td.b2c{border-left:2px solid rgba(86,38,233,.35)}',
    // Comité
    R + 'table.adh-t.com{font-size:13px}',
    R + 'table.adh-t.com td.seg{font:800 12px var(--font);color:var(--text);letter-spacing:.06em;vertical-align:middle;border-right:1px solid var(--border);padding-right:12px}',
    R + 'table.adh-t.com tr.sg-end td{border-bottom:2px solid var(--border)}',
    R + 'table.adh-t.com tr.sg-total td{background:rgba(86,38,233,.05)}',
    R + 'table.adh-t.com td.m{padding-left:12px}',
    R + '.adh-lob{display:flex;gap:2px}',
    R + '.adh-note{font-size:10.5px;color:var(--text-3);line-height:1.45;margin-top:12px}',
    R + '.adh-empty{font-size:12px;color:var(--text-3);padding:18px 0}',
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
  // B2C de referencia (mismas filas que el Benchmark vs B2C: raw.b2c / raw.b2c_ly, con las filas RG del switch COI
  // Brasil). Organic: a TC LY, como el real que entra en el YoY del negocio.
  function srcB2C() {
    var raw = W._rawB2BC;
    if (!raw || typeof W._b2cRows_ !== 'function' || typeof W._b2cLyRows_ !== 'function') return null;
    var cur = W._b2cRows_(raw), ly = W._b2cLyRows_(raw);
    if (!cur.length && !ly.length) return null;
    var org = typeof W._orgRows_ === 'function' && typeof W._orgTargetFor_ === 'function';
    return { cur: org ? W._orgRows_(cur, W._orgTargetFor_('ly')) : cur, ly: ly };
  }
  function sources() { return { b2b2c: srcB2BC(), b2b: srcB2B(), b2c: srcB2C() }; }
  function metaOf() { return (W._rawB2BC && W._rawB2BC.meta) || (W._rawB2B && W._rawB2B.meta) || {}; }
  function maxDate() { return metaOf().last_actuals_date || DEF_FECHA; }

  function cell(m, goal, realForGoal) {
    var g = goal ? goal[m.k] : null, r = realForGoal ? realForGoal[m.k] : null;
    var d = goal ? delta(r, g) : null;
    var diff = (goal && r != null) ? r - g : null;
    var dTxt = diff == null ? '' : '<small>' + (diff > 0 ? '+' : diff < 0 ? '−' : '') + fmtVal(m, Math.abs(diff)) + '</small>';
    return '<td class="grp">' + fmtVal(m, g) + '</td><td class="d ' + cls(d) + '">' + fmtPct(d) + dTxt + '</td>';
  }
  function pct1(v) { return (v * 100).toFixed(1) + '%'; }
  function b2cCell(t, b2c, m) {
    var pb = partB2C(t, b2c, m.k);
    if (!pb) return '<td class="b2c d" title="' + (m.k === 'orders' ? 'B2C no trae Orders' : 'Sin real o B2C para esos días') + '">—</td>';
    return '<td class="b2c d ' + cls(pb.d) + '" title="' + esc(m.lbl) + ' / (' + esc(m.lbl) + ' + ' + esc(m.lbl) + ' B2C)">' + pct1(pb.cur) +
      '<small>' + (pb.d == null ? 'sin LY' : fmtPp(pb.d) + ' vs LY (' + pct1(pb.ly) + ')') + '</small></td>';
  }
  // Real + Budget / RR / LY + vs B2C de una métrica (sin reales de esos días: Real y Δ en "—", no −100%)
  function rowCells(t, b2c, m) {
    var has = !!(t && t.real && t.real.n);
    return '<td class="real">' + (has ? fmtVal(m, t.real[m.k]) : '—') + '</td>' +
      cell(m, t && t.bud, has && t.realBud) + cell(m, t && t.rr, has && t.real) + cell(m, t && t.ly, has && t.realLy) + b2cCell(t, b2c, m);
  }
  function headCells() {
    var ly = toList(fechasLy());
    return '<th>Real</th><th class="grp">Budget</th><th>Δ vs Bud</th><th class="grp">Run Rate</th><th>Δ vs RR</th>' +
      '<th class="grp">LY' + (ly.length === 1 ? ' · ' + esc(shortLabel(ly[0])) : '') + '</th><th>Δ vs LY</th>' +
      '<th class="b2c" title="Negocio / (negocio + B2C) en los mismos días y países, y su cambio vs los mismos días del LY (como Industry events)">Part. vs B2C</th>';
  }

  function tableHtml(t, b2c, title, sub, isTot) {
    var h = '<div class="adh-card' + (isTot ? ' tot' : '') + '"><div class="adh-ttl">' + esc(title) + '</div><div class="adh-sub">' + esc(sub) + '</div>';
    if (!t || !t.real) return h + '<div class="adh-empty">Cargando…</div></div>';
    if (!hasAny(t)) return h + '<div class="adh-empty">Sin datos para ' + esc(fechasLabel(st.fechas)) + '.</div></div>';
    h += '<table class="adh-t"><thead><tr><th>Métrica</th>' + headCells() + '</tr></thead><tbody>';
    METRICS.forEach(function (m) { h += '<tr><td class="m">' + esc(m.lbl) + '</td>' + rowCells(t, b2c, m) + '</tr>'; });
    return h + '</tbody></table></div>';
  }

  // Cómo leer los números según los switches de la página (nota al pie y hoja Info del Excel)
  function notes() {
    var org = typeof W._orgTargetFor_ === 'function' && W._orgTargetFor_('budget');
    var dir = Array.isArray(W._dirSel) && W._dirSel.length;
    var out = ['Real en USD nominal.',
      org ? 'Organic YES: el Δ vs Budget compara el real a TC Budget y el Δ vs LY y la participación vs B2C el real a TC LY (B2C también a TC LY), como el Daily; vs Run Rate, nominal.' : 'Organic NO: todo en USD nominal.',
      'COI Brasil: ' + (W._exCoiBr !== false ? 'Excluir' : 'Incluir') + ' · Partner TBD: ' + (W._b2bcExclTBD ? 'Excluir' : 'Incluir') +
        (Array.isArray(W._canalSel) ? ' · Canal B2B2C: ' + W._canalSel.join(', ') : '') + (dir ? ' · Director: ' + W._dirSel.join(', ') : '') + ' (de "+ Filtros").',
      'Part. vs B2C = negocio / (negocio + B2C) en los mismos días y países, como en Industry events; debajo, su cambio en pp vs los mismos días del LY (y la del LY). B2C es el total macro (no sigue los filtros de partner / canal / director) y no trae Orders.',
      'LY: ' + (st.lyMode === 'cal' ? 'misma fecha calendario del año anterior.' : 'mismo día de la semana del año anterior (−364 días).')];
    if (dir) out.push('Con director elegido, B2B no tiene Budget ni Run Rate (no vienen por agencia).');
    return out;
  }
  function missingNote(fechas) {
    var md = metaOf().last_actuals_date;
    if (!md) return '';
    var miss = toList(fechas).filter(function (f) { return f > md; });
    if (!miss.length) return '';
    return '<div class="adh-note" style="color:var(--warning);margin:0 0 10px">' + (miss.length === 1 ? 'El ' + esc(dateLabel(miss[0])) + ' todavía no está' : esc(miss.length + ' de los días elegidos todavía no están')) +
      ' en los reales (último día: ' + esc(dateLabel(md)) + '). Falta correr "Actualizar reales".</div>';
  }

  function saveXlsx(bytes, name) {
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function infoHead(l, what) {
    return [what,
      'Días: ' + fechasLabel(l.fechas) + ' · LY: ' + fechasLabel(l.fechasLy) + (l.meta.last_actuals_date ? ' · reales al ' + dateLabel(l.meta.last_actuals_date) : '') +
        (l.meta.generated_at ? ' · generado ' + l.meta.generated_at : ''),
      'B2B2C por fecha de confirmación; B2B por fecha de gestión (GD). Real, Budget y Run Rate suman los días elegidos; LY suma los mismos días del año anterior. Total = B2B2C + B2B MAY + B2B MIN, de los negocios con datos esos días (en un país que un negocio no tiene, ese negocio no cuenta); si a uno que sí cuenta le falta un goal, el Total queda sin ese goal.',
      'Δ % = (real − goal) / |goal|. Montos en USD.'].concat(notes());
  }
  function download() {
    var X = W.DailyExcel;
    if (!X || typeof X.workbookFromSheets !== 'function' || !last) return;
    var info = infoHead(last, 'Tabla adhoc del Daily (Ownia): B2B2C, B2B MAY (API) y B2B MIN (Agencias afiliadas) de los días elegidos, vs Budget, Run Rate, LY y B2C.');
    info.push('País: ' + paisSelLabel(last.paises) + '. La hoja "Por país" abre cada tabla por país (los de la selección), una fila por negocio × país × métrica, con autofiltro. ' +
      'RG = ajuste COI Brasil (solo FVM), como entrada propia, igual que en el Daily. Globales = Other Countries + USA + Uruguay + Paraguay. Ecuador va aparte (no tiene Budget).');
    var byCountry = computeByCountry(last.src, last.fechas, last.fechasLy, last.paises);
    saveXlsx(X.workbookFromSheets(buildSheets(last.res, last.fechas, last.fechasLy, X.STYLE, info, byCountry, paisSelLabel(last.paises))),
      'Tabla_adhoc_' + fileTag(last.fechas) + '_vs_LY_' + fileTag(last.fechasLy) +
      (last.paises.length === 1 ? '_' + last.paises[0].replace(/\s+/g, '_') : last.paises.length ? '_' + last.paises.length + '_paises' : '') + '.xlsx');
  }
  function downloadComite() {
    var X = W.DailyExcel;
    if (!X || typeof X.workbookFromSheets !== 'function' || !lastCom) return;
    var info = infoHead(lastCom, 'Summary Comité Ejecutivo del Daily (Ownia): TOTAL / BRASIL / RESTO por LoB (Total, MIN, MAY, B2B2C) de los días elegidos, vs Budget, Run Rate, LY y B2C.');
    info.push('BRASIL = Brasil + RG (ajuste COI Brasil, solo FVM). RESTO = todos los demás países. Un bloque por LoB, la elegida en la página primero.');
    saveXlsx(X.workbookFromSheets(buildComiteSheets(lastCom.segs, lastCom.lob, lastCom.fechas, lastCom.fechasLy, X.STYLE, info)),
      'Summary_Comite_' + fileTag(lastCom.fechas) + '_vs_LY_' + fileTag(lastCom.fechasLy) + '.xlsx');
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

  // ── Selector de días (uno por hoja, comparten st.fechas) ──
  function pickerHtml() {
    return '<div class="adh-dp"><button type="button" class="adh-pais-btn adh-dp-btn" aria-haspopup="true">Días ▾</button>' +
      '<div class="adh-dp-pop" role="dialog" aria-label="Días"></div></div>';
  }
  function calHtml() {
    var md = maxDate(), sel = setOf(st.fechas);
    var y = Number(st.calM.slice(0, 4)), mo = Number(st.calM.slice(5, 7));
    var first = st.calM + '-01', start = mondayOf(first);
    var h = '<div class="adh-dp-q">' +
      '<button type="button" data-q="ayer" title="Último día con reales">Último día</button>' +
      '<button type="button" data-q="7d">Últimos 7 días</button>' +
      '<button type="button" data-q="sem" title="Última semana lun–dom completa con reales">Semana ant.</button>' +
      '<button type="button" data-q="mtd">Mes a la fecha</button>' +
      '<button type="button" data-q="def" title="Jueves 26/11/2026 vs jueves 27/11/2025 (semana 48)">26/11</button></div>' +
      '<div class="adh-dp-hd"><button type="button" data-nav="-1" aria-label="Mes anterior">‹</button><span>' + MESES[mo - 1] + ' ' + y + '</span>' +
      '<button type="button" data-nav="1" aria-label="Mes siguiente">›</button></div>' +
      '<table class="adh-cal"><thead><tr><th></th><th>L</th><th>M</th><th>M</th><th>J</th><th>V</th><th>S</th><th>D</th></tr></thead><tbody>';
    for (var w = 0; w < 6; w++) {
      var mon = shiftDate(start, w * 7);
      if (w > 0 && mon.slice(0, 7) !== st.calM) break;
      h += '<tr><td><button type="button" class="wk" data-wk="' + mon + '" title="Toda la semana">S' + isoWeek(mon) + '</button></td>';
      for (var i = 0; i < 7; i++) {
        var f = shiftDate(mon, i);
        var c = (f.slice(0, 7) !== st.calM ? ' out' : '') + (f > md ? ' nod' : '') + (sel[f] ? ' on' : '');
        h += '<td><button type="button" class="' + c.trim() + '" data-d="' + f + '" title="' + esc(dateLabel(f)) + ' · LY ' + esc(dateLabel(lyDate(f, st.lyMode))) + '">' + Number(f.slice(8)) + '</button></td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table>' +
      '<div class="adh-dp-ly">LY: <button type="button" data-ly="dow" class="' + (st.lyMode !== 'cal' ? 'on' : '') + '">mismo día de la semana</button>' +
      '<button type="button" data-ly="cal" class="' + (st.lyMode === 'cal' ? 'on' : '') + '">misma fecha</button></div>' +
      '<div class="adh-dp-sum"><b>' + esc(fechasLabel(st.fechas)) + '</b><br>vs LY ' + esc(fechasLabel(fechasLy())) + '<br>Clic = agrega / saca un día · Shift+clic = rango · S = semana entera.</div>' +
      '<div class="adh-dp-ft"><button type="button" data-done="1">Listo</button></div>';
    return h;
  }
  function syncPickers() {
    Array.prototype.forEach.call(document.querySelectorAll('.adh-dp'), function (dp) {
      var b = dp.querySelector('.adh-dp-btn');
      if (b) { b.textContent = 'Días: ' + fechasLabel(st.fechas) + ' ▾'; b.classList.toggle('on', st.fechas.length > 1); }
      if (dp.classList.contains('open')) dp.querySelector('.adh-dp-pop').innerHTML = calHtml();
    });
  }
  function setFechas(list) {
    list = toList(list);
    if (!list.length) return;
    st.fechas = list;
    syncPickers();
    render();
  }
  function quick(q) {
    var md = maxDate();
    if (q === 'ayer') return [md];
    if (q === '7d') return [0, 1, 2, 3, 4, 5, 6].map(function (i) { return shiftDate(md, -i); });
    if (q === 'sem') {
      var mon = mondayOf(md), sun = shiftDate(mon, 6);
      if (sun > md) mon = shiftDate(mon, -7);
      return [0, 1, 2, 3, 4, 5, 6].map(function (i) { return shiftDate(mon, i); });
    }
    if (q === 'mtd') { var n = daysBetween(md.slice(0, 7) + '-01', md), o = []; for (var i = 0; i <= n; i++) o.push(shiftDate(md, -i)); return o; }
    return [DEF_FECHA];
  }
  function bindPicker(dp) {
    var pop = dp.querySelector('.adh-dp-pop');
    dp.querySelector('.adh-dp-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !dp.classList.contains('open');
      closePops();
      if (open) { st.calM = st.fechas[st.fechas.length - 1].slice(0, 7); dp.classList.add('open'); pop.innerHTML = calHtml(); }
    });
    pop.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest('button');
      if (!b) return;
      var d = b.getAttribute('data-d'), wk = b.getAttribute('data-wk'), q = b.getAttribute('data-q'), nav = b.getAttribute('data-nav'), ly = b.getAttribute('data-ly');
      if (b.getAttribute('data-done')) { dp.classList.remove('open'); return; }
      if (nav) {
        var y = Number(st.calM.slice(0, 4)), m = Number(st.calM.slice(5, 7)) - 1 + Number(nav);
        y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
        st.calM = y + '-' + String(m + 1).padStart(2, '0');
        pop.innerHTML = calHtml();
        return;
      }
      if (ly) { st.lyMode = ly; syncPickers(); render(); return; }
      if (q) { var l = quick(q); st.anchor = null; st.calM = l[0].slice(0, 7); setFechas(l); return; }
      if (wk) {
        var days = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return shiftDate(wk, i); }), cur = setOf(st.fechas);
        var all = days.every(function (x) { return cur[x]; });
        var next = all ? st.fechas.filter(function (x) { return days.indexOf(x) < 0; }) : st.fechas.concat(days);
        if (next.length) setFechas(next);
        return;
      }
      if (d) {
        var next2;
        if (e.shiftKey && st.anchor) {
          var a = st.anchor < d ? st.anchor : d, z = st.anchor < d ? d : st.anchor, rng = [];
          for (var i = 0; i <= daysBetween(a, z); i++) rng.push(shiftDate(a, i));
          next2 = st.fechas.concat(rng);
        } else if (st.fechas.indexOf(d) >= 0) next2 = st.fechas.filter(function (x) { return x !== d; });
        else next2 = st.fechas.concat([d]);
        st.anchor = d;
        if (next2.length) setFechas(next2);   // siempre queda al menos un día
      }
    });
  }
  function closePops() {
    Array.prototype.forEach.call(document.querySelectorAll('.adh-root .adh-pais.open, .adh-root .adh-dp.open'), function (x) { x.classList.remove('open'); });
  }

  // ── Render ──
  function render() {
    clearTimeout(retry);
    if (active === 'adhoc') renderAdhoc();
    else if (active === 'comite') renderComite();
  }
  function scheduleRetry(src) { if (!src.b2b2c || !src.b2b) retry = setTimeout(render, 1000); }   // el preload de B2B (o B2B2C) todavía no llegó

  function renderAdhoc() {
    var body = el('adh-body');
    if (!body) return;
    var src = sources(), meta = metaOf(), FL = fechasLy();
    if (src.b2b2c && src.b2b) fillPaises(countriesOf(src));
    var res = computeTables(src, st.fechas, FL, st.paises);
    var lab = el('adh-asof');
    if (lab) lab.textContent = 'Real de ' + fechasLabel(st.fechas) + ' vs LY de ' + fechasLabel(FL) +
      ' · País: ' + paisSelLabel(st.paises) + (meta.last_actuals_date ? ' · datos al ' + dateLabel(meta.last_actuals_date) : '');
    last = { res: res, src: src, meta: meta, fechas: st.fechas.slice(), fechasLy: FL, paises: st.paises.slice() };
    body.innerHTML = missingNote(st.fechas) + '<div class="adh-grid">' +
      tableHtml(res.total, res.b2c, 'Total', 'B2B2C + B2B MAY + B2B MIN', true) +
      BIZ.map(function (b) { return tableHtml(res[b.k], res.b2c, b.lbl, b.sub); }).join('') + '</div>' +
      '<div class="adh-note">Δ % = (real − goal) / |goal|; debajo, la diferencia en la unidad de la métrica. Colores: verde ≥ 0%, ámbar entre −5% y 0%, rojo debajo de −5% (en la participación vs B2C, el Δ pp). ' +
      esc(notes().join(' ')) + '</div>';
    scheduleRetry(src);
  }

  function renderComite() {
    var body = el('com-body');
    if (!body) return;
    var src = sources(), meta = metaOf(), FL = fechasLy();
    var lob = LOBS.filter(function (l) { return l.k === st.lob; })[0] || LOBS[0];
    Array.prototype.forEach.call(document.querySelectorAll('#com-lob [data-lob]'), function (b) { b.classList.toggle('active', b.getAttribute('data-lob') === lob.k); });
    var lab = el('com-asof');
    if (lab) lab.textContent = 'LoB ' + lob.lbl + ' · Real de ' + fechasLabel(st.fechas) + ' vs LY de ' + fechasLabel(FL) +
      (meta.last_actuals_date ? ' · datos al ' + dateLabel(meta.last_actuals_date) : '');
    var ready = src.b2b2c && src.b2b;
    var segs = ready ? computeComite(src, st.fechas, FL) : null;
    lastCom = segs ? { segs: segs, lob: lob.k, meta: meta, fechas: st.fechas.slice(), fechasLy: FL } : null;
    var h = missingNote(st.fechas) + '<div class="adh-card tot"><div class="adh-ttl">Summary Comité Ejecutivo · ' + esc(lob.lbl) + '</div>' +
      '<div class="adh-sub">' + esc(lob.sub) + ' · BRASIL = Brasil + RG (ajuste COI Brasil) · RESTO = todos los demás países</div>';
    if (!segs) h += '<div class="adh-empty">Cargando…</div>';
    else {
      h += '<table class="adh-t com"><thead><tr><th>Segmento</th><th>Métrica</th>' + headCells() + '</tr></thead><tbody>';
      segs.forEach(function (sg) {
        var t = sg.res[lob.k];
        METRICS.forEach(function (m, i) {
          h += '<tr class="' + (sg.k === 'total' ? 'sg-total' : '') + (i === METRICS.length - 1 ? ' sg-end' : '') + '">' +
            (i === 0 ? '<td class="seg" rowspan="' + METRICS.length + '">' + esc(sg.lbl) + '</td>' : '') +
            '<td class="m">' + esc(m.lbl) + '</td>' + (hasAny(t) ? rowCells(t, sg.res.b2c, m) : '<td colspan="8" class="adh-empty" style="text-align:center">Sin datos</td>') + '</tr>';
        });
      });
      h += '</tbody></table>';
    }
    body.innerHTML = h + '</div><div class="adh-note">Δ % = (real − goal) / |goal|; debajo, la diferencia en la unidad de la métrica. Colores: verde ≥ 0%, ámbar entre −5% y 0%, rojo debajo de −5% (en la participación vs B2C, el Δ pp). ' +
      esc(notes().join(' ')) + '</div>';
    scheduleRetry(src);
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
    v.className = 'adh-root';
    v.style.display = 'none';
    v.innerHTML = '<div class="content">' +
      '<div class="section-hdr-row"><div class="section-hdr">Tabla adhoc · foto de los días</div>' +
      '<div class="adh-ctrl">' + pickerHtml() +
        '<div class="adh-pais"><button type="button" class="adh-pais-btn" id="adh-pais-btn" aria-haspopup="true">País: Todos ▾</button>' +
          '<div class="adh-pais-pop" id="adh-pais-pop" role="dialog" aria-label="País"></div></div>' +
        '<button type="button" class="adh-com" id="adh-com" title="Una sola tabla TOTAL / BRASIL / RESTO con filtro de LoB">📋 Summary Comité Ejecutivo</button>' +
        '<button type="button" class="adh-xls" id="adh-xls" title="Baja las cuatro tablas como se ven y la apertura por país (con los filtros de la página) en un .xlsx">⬇ Descargar Excel</button>' +
      '</div></div>' +
      '<div class="bench-sub" id="adh-asof" style="margin:-4px 0 12px"></div>' +
      '<div id="adh-body"></div></div>';
    anchor.parentNode.insertBefore(v, anchor.nextSibling);

    var c = document.createElement('div');
    c.id = 'view-comite';
    c.className = 'adh-root';
    c.style.display = 'none';
    c.innerHTML = '<div class="content">' +
      '<div class="section-hdr-row"><div class="section-hdr">Summary Comité Ejecutivo</div>' +
      '<div class="adh-ctrl">' +
        '<button type="button" class="adh-pais-btn" id="com-back" title="Volver a la Tabla adhoc">← Tabla adhoc</button>' +
        '<div class="adh-lob tab-toggle" id="com-lob" role="group" aria-label="LoB">' +
          LOBS.map(function (l) { return '<button type="button" class="ttab" data-lob="' + l.k + '">' + esc(l.lbl) + '</button>'; }).join('') + '</div>' +
        pickerHtml() +
        '<button type="button" class="adh-xls" id="com-xls" title="Baja la tabla de las cuatro LoB (la elegida primero) en un .xlsx">⬇ Descargar Excel</button>' +
      '</div></div>' +
      '<div class="bench-sub" id="com-asof" style="margin:-4px 0 12px"></div>' +
      '<div id="com-body"></div></div>';
    v.parentNode.insertBefore(c, v.nextSibling);

    Array.prototype.forEach.call(document.querySelectorAll('.adh-root .adh-dp'), bindPicker);
    syncPickers();
    el('adh-xls').addEventListener('click', function () { try { download(); } catch (e) { console.warn('[daily-adhoc] excel', e); } });
    el('com-xls').addEventListener('click', function () { try { downloadComite(); } catch (e) { console.warn('[daily-adhoc] excel comité', e); } });
    el('adh-com').addEventListener('click', function () { W.switchMainView('comite'); });
    el('com-back').addEventListener('click', function () { W.switchMainView('adhoc'); });
    el('com-lob').addEventListener('click', function (e) {
      var b = e.target.closest('[data-lob]');
      if (b) { st.lob = b.getAttribute('data-lob'); render(); }
    });
    var pbox = v.querySelector('.adh-pais');
    el('adh-pais-btn').addEventListener('click', function (e) { e.stopPropagation(); var o = !pbox.classList.contains('open'); closePops(); if (o) pbox.classList.add('open'); });
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
    document.addEventListener('click', closePops);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePops(); });

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

  var VIEWS = { adhoc: { id: 'view-adhoc', title: 'Tabla adhoc' }, comite: { id: 'view-comite', title: 'Summary Comité Ejecutivo' } };
  function hook() {
    var orig = W.switchMainView;
    if (typeof orig !== 'function' || orig._adh) return;
    var wrapped = function (view) {
      var b = el('vnav-adhoc');
      Object.keys(VIEWS).forEach(function (k) { var x = el(VIEWS[k].id); if (x) x.style.display = 'none'; });
      if (!VIEWS[view]) {
        active = null;
        if (b) b.classList.remove('active');
        return orig.apply(this, arguments);
      }
      orig.call(this, 'daily');   // deja el estado del Daily coherente; después se oculta
      active = view;
      el('view-daily').style.display = 'none';
      document.querySelectorAll('.vnav-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
      var lt = el('daily-lob-toggle'); if (lt) lt.style.display = 'none';
      var tc = el('b2bc-top-ctls'); if (tc) tc.style.display = 'none';
      var t = el('topbar-title'); if (t) t.textContent = VIEWS[view].title;
      var v = el(VIEWS[view].id); if (v) v.style.display = '';
      closePops();
      syncPickers();
      W.scrollTo && W.scrollTo(0, 0);
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
      var tab = new URLSearchParams(W.location.search).get('tab');
      if (tab === 'adhoc' || tab === 'comite') W.switchMainView(tab);
    } catch (e) { console.warn('[daily-adhoc]', e); }
  });
})(typeof window !== 'undefined' ? window : this);
