// ============================================================
// Codigo_krs_rr.js — P&L Dashboard (Hub) · "KRs HTML · RR" (2026-11-27; se mudó del P&L Accounting el mismo día)
// Botón "Ver detalle" del OKR Status: ventana con formato slide (public/hub-krs-rr.js). Solo se usa en Ownia: el Apps Script
// del Hub está congelado desde 2026-10-23 (sin clasp push).
// ============================================================
// Replica la tabla "Status KRs H2" + los recuadros por país del Daily B2B Tracker con el filtro de canal HTML
// (Daily_Dashboard/tracker.html: renderStatusKRsH2 / renderStatusKRsH2DetailBoxes_ / recurDetailBox_), pero midiendo
// el RUN RATE VIGENTE del mes completo en vez de los actuals: RR mes (b2b_runrate_ri del JSON del Daily, que sale de
// raw.b2brr_ri) vs Budget mes (b2b_budget_ri de okr_h2_managerial.json, la misma fuente de budget que usa el Tracker).
// Solo HTML (parent_channel 'Agencias afiliadas' = lob_canal B2B-MIN) y solo Recognition Date.
//
// Datos (carpeta del Daily en Drive, mismos archivos que lee Daily_Dashboard/Codigo.js):
//   daily_b2b_data.json     → b2b_runrate_ri (RR, por día x país x canal x producto) y meta (ly_to)
//   okr_h2_managerial.json  → b2b_budget_ri (FY completo, Packages General abierto por product_type) y b2b_ri_ly (LY)
//   recurrencia_b2b.json    → Accelerate Recurrence (agencias de alta frecuencia)
//   Input_OKR (sheet)       → target de Accelerate Recurrence (copia de getRecurTargets de Daily_Dashboard/Codigo.js)
// Organic (switch de la vista, YES por default): el RR se convierte como los reales del Tracker y como el RR en las
// vistas Semanas del Daily (_wkOrgRows): × TC Actuals / TC Budget del mes; el YoY con × TC Actuals / TC Actuals LY
// (opción B). Budget y LY quedan nominales. TC de tc_plana_flat.xlsx (readFxTable_ del Hub, Codigo.js;
// krsRROrganicConv_ es la copia de organicConverter_ de P&L_Accounting/Codigo_organic.js).
//
// ⚠ MANTENER EN SINCRONÍA con Daily_Dashboard/tracker.html: las definiciones de los KRs (New Products, canal HTML,
// grupos de país, okrScore_/realScore_/cumplRatio, pesos, reglas de Peso, Accelerate Recurrence) están COPIADAS acá
// porque son proyectos Apps Script separados. Si cambia una en el Tracker, cambiarla acá (y viceversa).
// test_krsHtmlRR.js compara estas copias contra las del Tracker y falla si se desincronizan.

var KRS_RR_DAILY_FOLDER_ID    = '1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh';   // carpeta DailyDashboard (DRIVE_FOLDER_ID del Daily)
var KRS_RR_INPUT_OKR_SHEET_ID = '1RVmTXDyyugCUXJ0f6JG_croNxWNLlOLm4eAs8F52u2c';   // "Input dashboard B2B+WLs" → Input_OKR
var KRS_RR_FILES = { daily: 'daily_b2b_data.json', okr: 'okr_h2_managerial.json', recur: 'recurrencia_b2b.json' };
var KRS_RR_HTML = 'Agencias afiliadas';   // parent_channel del canal HTML (lob_canal B2B-MIN)

// ── Copias del Tracker (SYNC con Daily_Dashboard/tracker.html) ───────────────────────────────────────────
// B2B_H2_NR_PRODS_TRK / B2B_H2_NP_PKG_TYPES / isNewProductPkgType_ / isNewProductActual_ / isNewProductBudget_
var B2B_H2_NR_PRODS_TRK = { 'Air': 1, 'Flights': 1, 'Flight': 1, 'D. Services': 1, 'Dest. Serv.': 1 };
var B2B_H2_NP_PKG_TYPES = { 'Vuelos':1, 'Disney':1, 'Universal':1, 'SeaWorld':1, 'Busch Gardens':1,
                            'Excursiones':1, 'Traslados':1 };
function isNewProductPkgType_(pt) {
  pt = String(pt || '');
  return !!B2B_H2_NP_PKG_TYPES[pt] || /^Espect/.test(pt);
}
function isNewProductActual_(r) {
  return !!B2B_H2_NR_PRODS_TRK[r.producto_original] ||
         (r.producto_original === 'Packages General' && isNewProductPkgType_(r.product_type));
}
function isNewProductBudget_(r) {
  return !!B2B_H2_NR_PRODS_TRK[r.producto] ||
         (r.producto === 'Packages General' && isNewProductPkgType_(r.product_type));
}
// FVM_DETAIL (filas de los recuadros por país; RG = ajuste COI Brasil, va con Brasil)
var KRS_RR_DETAIL = [
  { name: 'Brasil',       pais: ['Brasil', 'RG'] },
  { name: 'Mexico',       pais: ['Mexico'] },
  { name: 'Globales',     pais: ['Other Countries'] },
  { name: 'Argentina',    pais: ['Argentina'] },
  { name: 'Colombia',     pais: ['Colombia'] },
  { name: 'Chile',        pais: ['Chile'] },
  { name: 'Peru',         pais: ['Peru'] },
  { name: 'Ecua/Uru/Par', pais: ['Ecuador', 'Uruguay', 'Paraguay'] }
];
// okrScore_ (piso 70% → 0, techo 130%: solo para ponderar el OVERALL) / realScore_ (lo que se muestra) / cumplRatio
function okrScore_(act, bud){
  if(act===null||act===undefined||bud===null||bud===undefined||!bud) return null;
  var r=act/bud;
  if(!isFinite(r)) return null;
  return r<0.70 ? 0 : Math.min(r,1.30);
}
function realScore_(act, bud){
  if(act===null||act===undefined||bud===null||bud===undefined||!bud) return null;
  var r=act/bud;
  if(!isFinite(r)) return null;
  return Math.min(r,1.30);
}
function cumplRatio(act, goal) {
  if (act === null || act === undefined || !goal) return null;
  return 1 + (act - goal) / Math.abs(goal);
}
// Pesos del OVERALL del Tracker: [NR, API FVM, HTML FVM, New Products, Recurrence]. Acá no hay API FVM (vista HTML).
var KRS_RR_W = { nr: 0.30, fvm: 0.20, np: 0.15, recur: 0.15 };

// Accelerate Recurrence: recurH2_ / recurTarget_ / recurCumpl_ / recurWeekLbl_ del Tracker
function normPais_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}
function recurH2_(rows, krYM) {
  rows = (rows || []).filter(function(r){ return r.mes_comercial === krYM; });
  if (!rows.length) return null;
  var cierre  = rows.filter(function(r){ return +r.es_cierre_mes === 1 && r.estado === 'CIERRE'; });
  var cerradas = rows.filter(function(r){ return r.estado === 'CIERRE'; });
  var pool = cierre.length ? cierre : (cerradas.length ? cerradas : rows);
  var sem = pool.reduce(function(m, r){ return Math.max(m, +r.semana_del_mes || 0); }, 0);
  var wk = pool.filter(function(r){ return (+r.semana_del_mes || 0) === sem; });
  var byPais = {}, tot = { mtd: 0, roll: 0 };
  wk.forEach(function(r){
    var k = normPais_(r.pais);
    byPais[k] = byPais[k] || { pais: r.pais, mtd: 0, roll: 0 };
    byPais[k].mtd  += +r.mtd_frecuentes_vivas  || 0;
    byPais[k].roll += +r.roll_frecuentes_vivas || 0;
    tot.mtd  += +r.mtd_frecuentes_vivas  || 0;
    tot.roll += +r.roll_frecuentes_vivas || 0;
  });
  var parcial = null;
  if (!cierre.length) {
    var ec = rows.filter(function(r){
      var s = +r.semana_del_mes || 0;
      return r.estado === 'EN_CURSO' && s >= 3 && s > sem;
    });
    if (ec.length) {
      parcial = { semana: +ec[0].semana_del_mes, foto: ec[0].fecha_foto, total: 0 };
      ec.forEach(function(r){
        var k = normPais_(r.pais), v = +r.mtd_frecuentes_vivas || 0;
        byPais[k] = byPais[k] || { pais: r.pais, mtd: 0, roll: 0 };
        byPais[k].pmtd = (byPais[k].pmtd || 0) + v;
        parcial.total += v;
      });
      tot.pmtd = parcial.total;
    }
  }
  var w0 = wk[0];
  return { semana: sem, semanas: +w0.semanas_del_mes || null, desde: w0.semana_desde, hasta: w0.semana_hasta,
           estado: w0.estado, cierreMes: cierre.length > 0, byPais: byPais, total: tot, parcial: parcial };
}
function recurTarget_(targets, krYM, paisNames) {
  var rp = targets && targets[krYM];
  if (!rp) return null;
  var want = (paisNames || ['Total']).map(normPais_);
  var s = 0, any = false;
  Object.keys(rp).forEach(function(k){
    if (want.indexOf(normPais_(k)) !== -1) { s += +rp[k] || 0; any = true; }
  });
  return any ? s : null;
}
function recurCumpl_(mtd, roll, target, preferRoll) {
  var cMtd  = realScore_(mtd, target);
  var cRoll = realScore_(roll, target);
  var useRoll = cRoll !== null && (cMtd === 0 || (!!preferRoll && roll > 0));
  return { mtd: cMtd, roll: cRoll, shown: useRoll ? cRoll : cMtd, useRoll: useRoll,
           score: okrScore_(useRoll ? roll : mtd, target) };
}
function recurWeekLbl_(rec) {
  function dm(s){ return s ? s.substring(8, 10) + '/' + s.substring(5, 7) : ''; }
  return 'Semana ' + rec.semana + (rec.semanas ? '/' + rec.semanas : '') + ' (' + dm(rec.desde) + '–' + dm(rec.hasta) + ')' +
         (rec.cierreMes ? ' · foto de cierre del mes' : rec.estado === 'CIERRE' ? '' : ' · en curso');
}
// ── fin de las copias del Tracker ─────────────────────────────────────────────────────────────────────

// Apertura de Packages General por product_type con las proporciones FIJAS de NR de Daily_Dashboard/pkg_split_factors.py
// (SYNC: copia; test_krsHtmlRR.js la compara con el .py). El budget ya llega abierto así (split_pkg_budget de
// daily_sync.py); el RR no (split_pkg_budget es "solo Budget"), así que se abre acá con el mismo criterio: cada fila de
// Packages General se reemplaza por una por product_type con todas sus métricas × la proporción (los totales no cambian).
var KRS_RR_PKG_SPLIT = {
  'TOTAL':     { 'Vuelos': 0.453732, 'Disney': 0.039828, 'Universal': 0.046425, 'SeaWorld': 0.001406, 'Busch Gardens': 0.000323, 'Excursiones': 0.041666, 'Traslados': 0.020818, 'Espectáculos': 0.001269, 'Otros paquetes': 0.394532 },
  'Argentina': { 'Vuelos': 0.384318, 'Disney': 0.003901, 'Universal': 0.006832, 'SeaWorld': 0.0, 'Busch Gardens': 0.0, 'Excursiones': 0.021359, 'Traslados': 0.053836, 'Espectáculos': 0.0, 'Otros paquetes': 0.529755 },
  'Brasil':    { 'Vuelos': 0.54474, 'Disney': 0.049513, 'Universal': 0.058033, 'SeaWorld': 0.001884, 'Busch Gardens': 0.000437, 'Excursiones': 0.046277, 'Traslados': 0.014366, 'Espectáculos': 0.001276, 'Otros paquetes': 0.283474 },
  'Chile':     { 'Vuelos': 0.269447, 'Disney': 0.01002, 'Universal': 0.009172, 'SeaWorld': 0.0, 'Busch Gardens': 0.0, 'Excursiones': 0.015165, 'Traslados': 0.062576, 'Espectáculos': 0.001107, 'Otros paquetes': 0.632513 },
  'Colombia':  { 'Vuelos': 0.187129, 'Disney': 0.003143, 'Universal': 0.006058, 'SeaWorld': 0.0, 'Busch Gardens': 0.0, 'Excursiones': 0.055006, 'Traslados': 0.037255, 'Espectáculos': 0.0018, 'Otros paquetes': 0.709609 },
  'Mexico':    { 'Vuelos': 0.152437, 'Disney': 0.016295, 'Universal': 0.018138, 'SeaWorld': 0.0, 'Busch Gardens': 0.0, 'Excursiones': 0.024875, 'Traslados': 0.02953, 'Espectáculos': 0.001377, 'Otros paquetes': 0.757348 },
  'Peru':      { 'Vuelos': 0.191726, 'Disney': 0.010177, 'Universal': 0.003862, 'SeaWorld': 0.001016, 'Busch Gardens': 0.0, 'Excursiones': 0.066174, 'Traslados': 0.049378, 'Espectáculos': 0.000754, 'Otros paquetes': 0.676914 }
};
var KRS_RR_MONEY = ['gross_bookings', 'net_revenue', 'fvm'];
function krsRRSplitPkg_(rows) {
  var out = [];
  rows.forEach(function(r) {
    if (r.producto !== 'Packages General' || r.product_type) { out.push(r); return; }
    var sh = KRS_RR_PKG_SPLIT[r.pais] || KRS_RR_PKG_SPLIT.TOTAL;
    Object.keys(sh).forEach(function(t) {
      if (!(sh[t] > 0)) return;
      var c = {};
      Object.keys(r).forEach(function(k) { c[k] = r[k]; });
      c.product_type = t;
      ['orders'].concat(KRS_RR_MONEY).forEach(function(F) { if (typeof r[F] === 'number') c[F] = r[F] * sh[t]; });
      out.push(c);
    });
  });
  return out;
}

function _krsYmEnd_(ym) {
  var y = +ym.substring(0, 4), m = +ym.substring(5, 7);
  return ym + '-' + ('0' + new Date(y, m, 0).getDate()).slice(-2);
}
function _krsShiftYm_(ym, dy) { return (+ym.substring(0, 4) + dy) + ym.substring(4); }

/**
 * Cálculo puro de la vista (sin Drive): testeable en Node (test_krsHtmlRR.js).
 * inp = { ym, rr, bud, ly, lyTo, recurRows, recurState, targets, targetsState, targetsErr, convB, convY }
 *   rr / bud: filas con `producto` (RR y budget); ly: filas con `producto_original` (actuals LY). Ya filtradas a HTML o no:
 *   acá se vuelve a filtrar por canal. convB / convY: (pais, ym) → factor organic (null = nominal).
 * Montos en USD tal cual (el front formatea en $M / $K).
 */
function computeKRsHtmlRR_(inp) {
  var ym = inp.ym, lyYm = _krsShiftYm_(ym, -1);
  var isH = function(r){ return r.parent_channel === KRS_RR_HTML; };
  var inYm = function(ymx){ return function(r){ return String(r.fecha || '').substring(0, 7) === ymx; }; };
  var convB = inp.convB, convY = inp.convY;
  var rr = krsRRSplitPkg_((inp.rr || []).filter(inYm(ym)).filter(isH)).map(function(r) {
    var fb = convB ? convB(r.pais, ym) : 1, fy = convY ? convY(r.pais, ym) : fb;
    var c = {};
    Object.keys(r).forEach(function(k) { c[k] = r[k]; });
    KRS_RR_MONEY.forEach(function(F) { if (typeof r[F] === 'number') { c[F] = r[F] * fb; c[F + '_y'] = r[F] * fy; } });
    return c;
  });
  var bud = (inp.bud || []).filter(inYm(ym)).filter(isH);
  // LY del mes completo: solo si el JSON lo cubre entero (meta.ly_to); si no, el YoY queda en "—".
  var lyOk = !!inp.lyTo && inp.lyTo >= _krsYmEnd_(lyYm);   // sin ly_to no se sabe si el mes LY está completo → "—"
  var ly = lyOk ? (inp.ly || []).filter(inYm(lyYm)).filter(isH) : [];
  if (lyOk && !ly.length) lyOk = false;

  function sum(rows, F, pred, paisLower) {
    var s = 0;
    rows.forEach(function(r) {
      if (pred && !pred(r)) return;
      if (paisLower && paisLower.indexOf(String(r.pais || '').toLowerCase()) === -1) return;
      s += (r[F] || 0);
    });
    return s;
  }
  function metric(F, pRR, pLY, paisList) {
    var pl = paisList ? paisList.map(function(p){ return p.toLowerCase(); }) : null;
    return { rr: sum(rr, F, pRR, pl), rrY: sum(rr, F + '_y', pRR, pl), bud: sum(bud, F, pRR, pl),
             ly: lyOk ? sum(ly, F, pLY, pl) : null };
  }

  var defs = [
    { k: 'nr',  name: 'Net Revenues $M (HTML)',       unit: '$M',    F: 'net_revenue', pRR: null,                pLY: null },
    { k: 'fvm', name: 'HTML FVM $K',                  unit: '$Kint', F: 'fvm',         pRR: null,                pLY: null },
    { k: 'np',  name: 'New Products Growth $K (HTML)', unit: '$Kint', F: 'net_revenue', pRR: isNewProductBudget_, pLY: isNewProductActual_ }
  ];
  var krs = defs.map(function(d) {
    var m = metric(d.F, d.pRR, d.pLY, null);
    return { k: d.k, name: d.name, unit: d.unit, peso: KRS_RR_W[d.k], rr: m.rr, bud: m.bud,
             cumpl: realScore_(m.rr, m.bud), score: okrScore_(m.rr, m.bud) };
  });

  // Recuadros por país (renderStatusKRsH2DetailBoxes_, vista HTML, solo Recognition)
  function rowStat(r) {
    var hasLY = r.ly !== null && r.ly !== undefined && r.ly > 0;
    return { c: cumplRatio(r.rr, r.bud),
             yoy: hasLY ? (r.rrY / r.ly - 1) : null,
             yb: (hasLY && r.bud) ? (r.bud / r.ly - 1) : null };
  }
  var boxes = defs.map(function(d) {
    var rows = KRS_RR_DETAIL.map(function(def) {
      var m = metric(d.F, d.pRR, d.pLY, def.pais);
      var x = { name: def.name, rr: m.rr, rrY: m.rrY, bud: m.bud, ly: m.ly };
      var s = rowStat(x);
      x.c = s.c; x.yoy = s.yoy; x.yb = s.yb;
      return x;
    });
    var tRR = 0, tRRY = 0, tBud = 0, tLY = 0, hLY = false;
    rows.forEach(function(r) { tRR += r.rr; tRRY += r.rrY; tBud += r.bud; if (r.ly != null) { tLY += r.ly; hLY = true; } });
    var total = { rr: tRR, bud: tBud, ly: hLY ? tLY : null,
                  c: tBud ? Math.min(cumplRatio(tRR, tBud), 1.30) : null,
                  yoy: (hLY && tLY > 0) ? (tRRY / tLY - 1) : null,
                  yb: (tBud && hLY && tLY > 0) ? (tBud / tLY - 1) : null };
    // Peso = participación del país en el RR del canal; "—" si el total <= 0 o los negativos pesan > 10% de lo positivo
    var posSum = 0, negSum = 0;
    rows.forEach(function(r){ if (r.rr > 0) posSum += r.rr; else if (r.rr < 0) negSum -= r.rr; });
    var pesoOk = total.rr > 0 && negSum <= 0.1 * posSum;
    rows.forEach(function(r) { r.peso = pesoOk ? r.rr / total.rr : null; });
    total.peso = pesoOk ? 1 : null;
    return { k: d.k, title: d.name, unit: d.unit, pesoOk: pesoOk, total: total, rows: rows };
  });

  // Conciliación: los recuadros suman solo KRS_RR_DETAIL (un país fuera de la lista haría que el TOTAL no dé el de la tabla)
  var warnings = [], detPais = {}, sinRecuadro = {};
  KRS_RR_DETAIL.forEach(function(d){ d.pais.forEach(function(p){ detPais[p.toLowerCase()] = 1; }); });
  rr.concat(bud).forEach(function(r) {
    if ((r.fvm || r.net_revenue) && !detPais[String(r.pais || '').toLowerCase()]) sinRecuadro[r.pais || '(sin país)'] = 1;
  });
  if (Object.keys(sinRecuadro).length) warnings.push('países sin recuadro (el TOTAL por país no da el de la tabla): ' + Object.keys(sinRecuadro).join(', '));
  if (!rr.length) warnings.push('el Run Rate no trae filas HTML para ' + ym);
  if (!bud.length) warnings.push('el Budget no trae filas HTML para ' + ym);
  if (inp.budFallback) warnings.push('falta okr_h2_managerial.json: Budget del JSON principal, New Products sin los componentes de Packages General');

  // Accelerate Recurrence (HTML): el mismo número que muestra el Tracker para el mes (Rolling L4W vs Target mientras el mes no cerró)
  var recur = { state: inp.recurState || 'ok', targetsState: inp.targetsState || 'ok', targetsErr: inp.targetsErr || '' };
  var rec = recur.state === 'ok' ? recurH2_(inp.recurRows, ym) : null;
  var recTgt = recur.targetsState === 'ok' ? recurTarget_(inp.targets, ym, null) : null;
  if (rec) {
    var rc = recurCumpl_(rec.total.mtd, rec.total.roll, recTgt, !rec.cierreMes);
    recur.week = recurWeekLbl_(rec);
    recur.cierreMes = rec.cierreMes;
    recur.total = rec.total;
    recur.parcial = rec.parcial;
    recur.target = recTgt;
    recur.cumpl = rc;
    // Recuadro (recurDetailBox_): País | Rolling L4W | % Cumpl. (Rolling vs Target) | Target
    var used = {}, rows = [];
    var tgtKeys = Object.keys((inp.targets && inp.targets[ym]) || {}).filter(function(k){ return normPais_(k) !== 'total'; });
    var rowFor = function(name, paisNames) {
      var d = { mtd: 0, roll: 0, pmtd: 0 }, any = false, seen = {};
      paisNames.forEach(function(p){
        var k = normPais_(p), x = rec.byPais[k];
        if (seen[k]) return;
        seen[k] = used[k] = 1;
        if (x) { d.mtd += x.mtd; d.roll += x.roll; d.pmtd += x.pmtd || 0; any = true; }
      });
      var tgt = recurTarget_(inp.targets, ym, paisNames);
      if (any || tgt !== null) {
        var dd = any ? d : { mtd: null, roll: null, pmtd: null };
        rows.push({ name: name, roll: dd.roll, target: tgt, c: recurCumpl_(dd.mtd, dd.roll, tgt).roll });
      }
    };
    KRS_RR_DETAIL.forEach(function(def){ rowFor(def.name, def.pais.concat([def.name])); });
    Object.keys(rec.byPais).forEach(function(k){ if (!used[k]) rowFor(rec.byPais[k].pais, [rec.byPais[k].pais]); });
    tgtKeys.forEach(function(k){ if (!used[normPais_(k)]) rowFor(k, [k]); });
    recur.rows = rows;
    recur.totalRow = { roll: rec.total.roll, target: recTgt, c: recurCumpl_(rec.total.mtd, rec.total.roll, recTgt).roll };
  }

  // OVERALL ponderado (okrScore_), normalizado sobre los KRs HTML con cumplimiento (sin API FVM; Recurrence si tiene dato y target)
  var parts = krs.map(function(k){ return [k.score, k.peso]; });
  var recScore = (recur.cumpl && recur.cumpl.score !== undefined) ? recur.cumpl.score : null;
  parts.push([recScore, KRS_RR_W.recur]);
  var wSum = 0, wC = 0;
  parts.forEach(function(p){ if (p[0] !== null) { wSum += p[1]; wC += p[0] * p[1]; } });
  var overall = { value: wSum > 0 ? Math.min(wC / wSum, 1.30) : null, pesoSum: wSum, exclRecur: recScore === null };

  return { ym: ym, lyYm: lyYm, lyAvailable: lyOk, krs: krs, boxes: boxes, recur: recur, overall: overall, warnings: warnings };
}

// ── Lectura (Drive) ─────────────────────────────────────────────────────────────────────────────────
function _krsRows_(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (!v.cols || !v.rows) return [];
  return v.rows.map(function(r) { var o = {}; v.cols.forEach(function(c, i) { o[c] = r[i]; }); return o; });
}
function _krsFile_(folder, name, required) {
  var it = folder.getFilesByName(name);
  if (!it.hasNext()) { if (required) throw new Error('No encontrado en Drive: ' + name + ' (carpeta del Daily)'); return null; }
  return it.next();
}
// RR / budget / LY (solo HTML), memorizados por fecha de modificación de los JSON (en Ownia el contexto vive entre requests).
var _KRS_RR_MEMO_ = null;
function krsRRLoad_() {
  var folder = DriveApp.getFolderById(KRS_RR_DAILY_FOLDER_ID);
  var fD = _krsFile_(folder, KRS_RR_FILES.daily, true), fO = _krsFile_(folder, KRS_RR_FILES.okr, false);
  var key = fD.getLastUpdated().getTime() + '_' + (fO ? fO.getLastUpdated().getTime() : 0);
  if (_KRS_RR_MEMO_ && _KRS_RR_MEMO_.key === key) return _KRS_RR_MEMO_.v;
  var isH = function(r){ return r.parent_channel === KRS_RR_HTML; };
  var d = JSON.parse(fD.getBlob().getDataAsString());
  var meta = d.meta || {};
  var rrAll = d.b2b_runrate_ri || [];
  var months = {};
  rrAll.forEach(function(r) { if (r.fecha) months[String(r.fecha).substring(0, 7)] = 1; });
  // Misma fuente que el Tracker (getKrBudget / getKrActualsLY): okr_h2_managerial.json; si no está, el JSON principal
  // (ahí New Products queda sin los componentes de Packages General).
  var v = { meta: meta, months: Object.keys(months).sort(), rr: rrAll.filter(isH), okrH2: !!fO };
  var budFb = _krsRows_(d.b2b_budget_ri).filter(isH), lyFb = _krsRows_(d.b2b_ri_ly).filter(isH);
  d = null;
  if (fO) {
    var o = JSON.parse(fO.getBlob().getDataAsString());
    v.bud = _krsRows_(o.b2b_budget_ri).filter(isH);
    v.ly = _krsRows_(o.b2b_ri_ly).filter(isH);
    v.lyTo = (o.meta && o.meta.ly_to) || meta.ly_to || '';
    if (!v.bud.length) { v.bud = budFb; v.budFallback = true; }
    if (!v.ly.length) v.ly = lyFb;
  } else { v.bud = budFb; v.ly = lyFb; v.lyTo = meta.ly_to || ''; v.budFallback = true; }
  _KRS_RR_MEMO_ = { key: key, v: v };
  return v;
}
var _KRS_REC_MEMO_ = null;
function krsRRRecur_() {
  try {
    var f = _krsFile_(DriveApp.getFolderById(KRS_RR_DAILY_FOLDER_ID), KRS_RR_FILES.recur, false);
    if (!f) return { state: 'error', rows: null };
    var key = f.getLastUpdated().getTime();
    if (_KRS_REC_MEMO_ && _KRS_REC_MEMO_.key === key) return _KRS_REC_MEMO_.v;
    var v = { state: 'ok', rows: _krsRows_(JSON.parse(f.getBlob().getDataAsString())) };
    _KRS_REC_MEMO_ = { key: key, v: v };
    return v;
  } catch (e) { return { state: 'error', rows: null }; }
}

// Target de Accelerate Recurrence: COPIA de getRecurTargets / repartirNoGestionadas_ / RECUR_NOGEST_PESOS de
// Daily_Dashboard/Codigo.js (SYNC: si cambia allá, cambiar acá).
var KRS_RR_NOGEST_PESOS = {
  '2026-10': { 'Brasil': 382, 'Mexico': 8,  'Peru': 4, 'Other Countries': 4, 'Argentina': 1, 'Chile': 1 },
  '2026-11': { 'Brasil': 380, 'Mexico': 11, 'Peru': 4, 'Other Countries': 4, 'Argentina': 1, 'Chile': 1 },
  '2026-12': { 'Brasil': 376, 'Mexico': 10, 'Peru': 4, 'Other Countries': 4, 'Argentina': 1, 'Chile': 1 },
  '2027-01': { 'Brasil': 383, 'Mexico': 11, 'Peru': 4, 'Other Countries': 4, 'Argentina': 1, 'Chile': 1 },
  '2027-02': { 'Brasil': 378, 'Mexico': 10, 'Peru': 4, 'Other Countries': 4, 'Argentina': 1, 'Chile': 1 },
  '2027-03': { 'Brasil': 383, 'Mexico': 11, 'Peru': 4, 'Other Countries': 4, 'Argentina': 1, 'Chile': 1 }
};
var KRS_RR_PAIS_ALIAS = { 'other countries': ['other countries', 'globales'] };
function krsRRRepartirNoGest_(rp, ym) {
  var ngKey = Object.keys(rp).filter(function(k) { return normPais_(k) === 'no gestionadas'; })[0];
  if (!ngKey) return;
  var total = +rp[ngKey] || 0;
  delete rp[ngKey];
  var meses = Object.keys(KRS_RR_NOGEST_PESOS).sort(), mes = meses[0];
  meses.forEach(function(m) { if (m <= ym) mes = m; });
  var pesos = KRS_RR_NOGEST_PESOS[mes], paises = Object.keys(pesos);
  var suma = paises.reduce(function(s, p) { return s + pesos[p]; }, 0);
  if (!total || !suma) return;
  var partes = paises.map(function(p) { var x = total * pesos[p] / suma; return { p: p, n: Math.floor(x), r: x - Math.floor(x) }; });
  var falta = Math.round(total) - partes.reduce(function(s, x) { return s + x.n; }, 0);
  partes.slice().sort(function(a, b) { return b.r - a.r; }).slice(0, Math.max(0, falta)).forEach(function(x) { x.n++; });
  partes.forEach(function(x) {
    var alias = KRS_RR_PAIS_ALIAS[normPais_(x.p)] || [normPais_(x.p)];
    var k = Object.keys(rp).filter(function(kk) { return alias.indexOf(normPais_(kk)) !== -1; })[0] || x.p;
    rp[k] = (+rp[k] || 0) + x.n;
  });
}
function krsRRParseTargets_(vals) {
  var h = vals[0].map(function(x) { return String(x).trim().toLowerCase(); });
  var iP = h.indexOf('periodo'), iE = h.indexOf('escenario'), iL = h.indexOf('lob'), iPa = h.indexOf('pais'),
      iPr = h.indexOf('producto'), iK = h.indexOf('kr'), iV = h.indexOf('valor');
  var out = {};
  vals.slice(1).forEach(function(r) {
    if (String(r[iK]).trim().toLowerCase() !== 'accelerate recurrence') return;
    if (String(r[iL]).trim().toLowerCase() !== 'b2b') return;
    if (String(r[iE]).toLowerCase().indexOf('budget') < 0) return;
    if (String(r[iPr]).trim().toLowerCase() !== 'total') return;
    var p = r[iP], ym;
    if (p instanceof Date || (p && typeof p.getTime === 'function')) ym = Utilities.formatDate(p, 'America/Argentina/Buenos_Aires', 'yyyy-MM');
    else { var m = String(p).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (!m) return; ym = m[3] + '-' + ('0' + m[2]).slice(-2); }
    var v = typeof r[iV] === 'number' ? r[iV] : Number(String(r[iV]).replace(/\./g, '').replace(',', '.'));
    if (r[iV] === '' || isNaN(v)) return;
    var pais = String(r[iPa]).trim() || 'Total';
    out[ym] = out[ym] || {};
    out[ym][pais] = v;
  });
  Object.keys(out).forEach(function(ym) { krsRRRepartirNoGest_(out[ym], ym); });
  return out;
}
var _KRS_TGT_MEMO_ = null;
function krsRRTargets_() {
  try {
    var key = 0;
    try { key = DriveApp.getFileById(KRS_RR_INPUT_OKR_SHEET_ID).getLastUpdated().getTime(); } catch (e) { key = 0; }
    if (key && _KRS_TGT_MEMO_ && _KRS_TGT_MEMO_.key === key) return _KRS_TGT_MEMO_.v;
    var vals = SpreadsheetApp.openById(KRS_RR_INPUT_OKR_SHEET_ID).getSheetByName('Input_OKR').getDataRange().getValues();
    var v = { state: 'ok', targets: krsRRParseTargets_(vals), err: '' };
    if (key) _KRS_TGT_MEMO_ = { key: key, v: v };
    return v;
  } catch (e) { return { state: 'error', targets: null, err: (e && e.message) || String(e) }; }
}

// Factor organic por (país, ym): copia de organicConverter_ (P&L_Accounting/Codigo_organic.js) sobre readFxTable_ / _fxNorm_
// del Hub (Codigo.js), con el alias de regiones del P&L Accounting (el del Hub no trae 'ops+rg'). target 'budget' = TC Actuals /
// TC Budget del mes; 'ly' = TC Actuals / TC Actuals del mismo mes del año anterior. País sin TC → 1; país con TC al que le
// falta uno → 1 y queda en missing.
var KRS_RR_FX_ALIAS = { 'ops': 'brasil', 'rg': 'brasil', 'ops + rg': 'brasil', 'ops+rg': 'brasil' };
function krsRROrganicConv_(target) {
  var fx = readFxTable_();
  var act = fx.actuals, tgt = (target === 'ly') ? null : fx[target];
  var paisesFx = {};
  Object.keys(act).forEach(function(k) { paisesFx[k.split('§')[0]] = true; });
  var missing = {};
  function f(pais, ym) {
    var pai = _fxNorm_(pais);
    pai = KRS_RR_FX_ALIAS[pai] || pai;
    if (!paisesFx[pai]) return 1;
    var a = act[pai + '§' + ym];
    var t = tgt ? tgt[pai + '§' + ym] : act[pai + '§' + _krsShiftYm_(ym, -1)];
    if (!a || !t) {
      missing[pai + ' ' + ym + (a ? '' : ' (actuals)') + (t ? '' : ' (' + (target === 'ly' ? 'actuals LY' : target) + ')')] = true;
      return 1;
    }
    return a / t;
  }
  return { f: f, missing: missing };
}

/**
 * Endpoint de la ventana "KRs HTML · RR" (google.script.run desde public/hub-krs-rr.js, Ownia).
 * ym: 'YYYY-MM' (vacío → mes en curso si el RR lo cubre, si no el primero que cubra). organic: bool (default true).
 */
function getKRsHtmlRR(ym, organic) {
  var t0 = Date.now();
  var src = krsRRLoad_();
  var months = src.months;
  var cur = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM');
  if (!ym || months.indexOf(ym) === -1) ym = months.indexOf(cur) !== -1 ? cur : (months[0] || cur);
  var org = { on: organic !== false, missing: [], error: '' };
  var convB = null, convY = null;
  if (org.on) {
    try {
      var cB = krsRROrganicConv_('budget'), cY = krsRROrganicConv_('ly');
      convB = cB.f; convY = cY.f;
      org._m = [cB.missing, cY.missing];
    } catch (e) { org.on = false; org.error = 'No se pudo leer el archivo de tipos de cambio: ' + ((e && e.message) || e); }
  }
  var rec = krsRRRecur_(), tg = krsRRTargets_();
  var res = computeKRsHtmlRR_({ ym: ym, rr: src.rr, bud: src.bud, ly: src.ly, lyTo: src.lyTo, budFallback: !!src.budFallback,
    recurRows: rec.rows, recurState: rec.state, targets: tg.targets, targetsState: tg.state, targetsErr: tg.err,
    convB: convB, convY: convY });
  if (org._m) {
    var miss = {};
    org._m.forEach(function(m) { Object.keys(m).forEach(function(k) { miss[k] = 1; }); });
    org.missing = Object.keys(miss).sort();
    delete org._m;
  }
  res.months = months;
  res.currentYm = cur;
  res.organic = org;
  res.meta = { generated_at: src.meta.generated_at || '', last_actuals_date: src.meta.last_actuals_date || '',
               ly_to: src.lyTo || '', budgetSource: src.okrH2 ? KRS_RR_FILES.okr : KRS_RR_FILES.daily, ms: Date.now() - t0 };
  return res;
}
