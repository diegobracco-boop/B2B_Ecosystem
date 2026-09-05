// P&L RunRate Dashboard — Contable EPM backend
// Vista "Contable - EPM": proyecciones 100% desde contable_forecast_plana (sin blend gestional).
// Actuals Q1 = contables reales. Q2-Q4 = todo desde fc (EPM/plana).
// Comparte helpers y constantes de Codigo_contable.js (mismo namespace GAS).

// ── Diagnóstico temporal — borrar después de confirmar datos ─────────────────
function diagJulyEPM_() {
  invalidateEPMCache();
  var jData = readEPMJSON_();
  var bl = aggregatePaisByGroup_(jsonScenarioToByPais_(jData, 'all', 'bl', ALL_YM_BG), null);
  var ac = aggregatePaisByGroup_(jsonScenarioToByPais_(jData, 'all', 'ac', ALL_YM_BG), null);
  var rr = aggregatePaisByGroup_(jsonScenarioToByPais_(jData, 'all', 'rr', ALL_YM_BG), null);
  function nr(agg) {
    var keys = ['revenue from sales as principal','up front incentives','customer fees & charges',
      'back end incentives','other incentives','breakage revenue','media & other revenue',
      'income from outsourced services','loyalty revenue','cancellations','revenue taxes'];
    return keys.reduce(function(s,k){ return s + ((agg[k]&&agg[k]['Jul-26'])||0); }, 0);
  }
  return {
    actual_months: jData.actual_months,
    cutoffIdx: epmCutoffIdx_(jData),
    bl: { gb: ((bl['gross bookings']||{})['Jul-26']||0)/1e6, nr: nr(bl)/1e6 },
    ac: { gb: ((ac['gross bookings']||{})['Jul-26']||0)/1e6, nr: nr(ac)/1e6 },
    rr: { gb: ((rr['gross bookings']||{})['Jul-26']||0)/1e6, nr: nr(rr)/1e6 },
    bl_file_id: CANONICAL_IDS_['bl']
  };
}

var _epmJsonCache_   = null;
var _epmJsonCacheMs_ = 0;  // max lastMod de todos los canónicos al momento del último assembly

// Devuelve el máximo lastMod (ms) de todos los JSON canónicos — 7 llamadas de metadata.
function _canonicalsMaxMod_() {
  var mx = 0;
  Object.keys(CANONICAL_IDS_).forEach(function(sc) {
    try {
      var t = DriveApp.getFileById(CANONICAL_IDS_[sc]).getLastUpdated().getTime();
      if (t > mx) mx = t;
    } catch(e) { Logger.log('_canonicalsMaxMod_ err ' + sc + ': ' + e); }
  });
  return mx;
}

// Lee un canónico de Drive y lo parsea. Descarta el blob inmediatamente para liberar memoria.
function _readCanonical_(fileId) {
  return JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
}

// Ensambla los 7 JSON canónicos en la estructura data[lgKey][pais][sc][n2][ym]=monto
// que espera el resto del backend (jsonScenarioToByPais_, computeGroupEPM_, etc.).
function assembleCanonicals_() {
  var data = {}, dbp = {}, actualMonths = [];

  Object.keys(CANONICAL_IDS_).forEach(function(sc) {
    var raw  = _readCanonical_(CANONICAL_IDS_[sc]);
    var cols = raw.cols;
    var iL   = cols.indexOf('LoB'),      iC  = cols.indexOf('Canal');
    var iP   = cols.indexOf('Pais'),     iPr = cols.indexOf('Producto');
    var iN2  = cols.indexOf('P&L N2'),   iF  = cols.indexOf('Fecha');
    var iM   = cols.indexOf('Monto USD');

    if (sc === 'ac') {
      var seen = {};
      (raw.meta.fechas || []).forEach(function(d) {
        var ym = String(d).substring(0, 7);
        if (!seen[ym]) { seen[ym] = 1; actualMonths.push(ym); }
      });
      actualMonths.sort();
    }

    raw.rows.forEach(function(r) {
      var lob  = String(r[iL]).trim().toLowerCase();
      if (lob === 'b2c') return;
      var canal = String(r[iC]).trim().toLowerCase();
      var pais  = PAIS_MAP_CT_[String(r[iP]).trim().toLowerCase()];
      if (!pais) return;
      var n2   = String(r[iN2]).trim().toLowerCase();
      var ym   = String(r[iF]).substring(0, 7);
      var v    = Number(r[iM]) || 0;
      if (!v) return;
      var prod = String(r[iPr]).trim().toLowerCase();

      lgkeysForCT_(lob, canal).forEach(function(lg) {
        if (!data[lg])               data[lg] = {};
        if (!data[lg][pais])         data[lg][pais] = {};
        if (!data[lg][pais][sc])     data[lg][pais][sc] = {};
        if (!data[lg][pais][sc][n2]) data[lg][pais][sc][n2] = {};
        data[lg][pais][sc][n2][ym]  = (data[lg][pais][sc][n2][ym] || 0) + v;
      });

      prodLgkeysForCT_(lob, canal).forEach(function(lg) {
        if (!dbp[lg])                       dbp[lg] = {};
        if (!dbp[lg][pais])                 dbp[lg][pais] = {};
        if (!dbp[lg][pais][prod])           dbp[lg][pais][prod] = {};
        if (!dbp[lg][pais][prod][sc])       dbp[lg][pais][prod][sc] = {};
        if (!dbp[lg][pais][prod][sc][n2])   dbp[lg][pais][prod][sc][n2] = {};
        dbp[lg][pais][prod][sc][n2][ym]     = (dbp[lg][pais][prod][sc][n2][ym] || 0) + v;
      });
    });
  });

  // Rollup pais='all' para cada lgKey (suma de todos los países)
  Object.keys(data).forEach(function(lg) {
    var agg = {};
    Object.keys(data[lg]).forEach(function(pais) {
      Object.keys(data[lg][pais]).forEach(function(sc) {
        if (!agg[sc]) agg[sc] = {};
        Object.keys(data[lg][pais][sc]).forEach(function(n2) {
          if (!agg[sc][n2]) agg[sc][n2] = {};
          Object.keys(data[lg][pais][sc][n2]).forEach(function(ym) {
            agg[sc][n2][ym] = (agg[sc][n2][ym] || 0) + data[lg][pais][sc][n2][ym];
          });
        });
      });
    });
    data[lg]['all'] = agg;
  });

  // jData.products: productos disponibles por lgKey (para el filtro de producto en el UI)
  var products = {};
  Object.keys(dbp).forEach(function(lg) {
    var ps = {};
    Object.keys(dbp[lg]).forEach(function(pais) {
      Object.keys(dbp[lg][pais]).forEach(function(prod) { ps[prod] = 1; });
    });
    products[lg] = Object.keys(ps).sort();
  });

  Logger.log('assembleCanonicals_ OK: lgKeys=' + Object.keys(data) + ' actual_months=' + actualMonths);
  return { data: data, data_by_prod: dbp, products: products, actual_months: actualMonths };
}

function readEPMJSON_() {
  var mod = _canonicalsMaxMod_();
  if (_epmJsonCache_ && mod <= _epmJsonCacheMs_) return _epmJsonCache_;
  try {
    _epmJsonCache_   = assembleCanonicals_();
    _epmJsonCacheMs_ = mod;
  } catch(e) {
    Logger.log('readEPMJSON_ error: ' + e);
    if (!_epmJsonCache_) _epmJsonCache_ = { data: {} };
  }
  return _epmJsonCache_;
}

function invalidateEPMCache() {
  _epmJsonCache_   = null;
  _epmJsonCacheMs_ = 0;
  return { ok: true };
}

// ── Máximo índice de mes (ALL_MONTHS_ORD_BG) con datos en un agregado {n2:{mes:v}} ──
function _epmScenMaxIdx_(agg) {
  var mx = -1;
  Object.keys(agg || {}).forEach(function(n2){
    Object.keys(agg[n2] || {}).forEach(function(m){
      var i = ALL_MONTHS_ORD_BG.indexOf(m);
      if (i > mx) mx = i;
    });
  });
  return mx;
}

// ── Compute EPM group: no gestional — todo desde CT ─────────────────────────────
// Baseline = escenario 'bl' pre-computado (baseline_actuals+projections.json =
//            Actuals + RunRate + Forecast + Budget). Fuente ÚNICA del baseline.
// Goal (opts.goal): 'budget' (default) | 'forecast' (actuals+fc) | 'lastrunrate' (actuals+lrr+fc)
//                   | 'lastyear' (Actuals FY26, mismo mes fiscal un año antes).
// opts = { goal, lrr: lrrByPais, baseline: blByPais, ly: lyByPais }.
// Mismo contrato de retorno que computeGroupWithAgg_ para reutilizar el render.
function computeGroupEPM_(actualsByPais, rrContByPais, budgetByPais, forecastByPais, cutoffIdx, paisGroup, opts) {
  opts = opts || {};
  var goalScen = opts.goal || 'budget';

  var actuals  = aggregatePaisByGroup_(actualsByPais,  paisGroup);
  var rrCont   = aggregatePaisByGroup_(rrContByPais,   paisGroup);
  var forecast = aggregatePaisByGroup_(forecastByPais, paisGroup);
  var budget   = aggregatePaisByGroup_(budgetByPais,   paisGroup);
  var lrr      = opts.lrr      ? aggregatePaisByGroup_(opts.lrr, paisGroup)      : {};
  var baseline = opts.baseline ? aggregatePaisByGroup_(opts.baseline, paisGroup) : null;
  var lyRaw    = opts.ly       ? aggregatePaisByGroup_(opts.ly, paisGroup)       : {};

  // LY viene con sus propias etiquetas de mes (ALL_MONTHS_ORD_LY_BG, FY26 — un año
  // antes). Se realinea posicionalmente a las etiquetas de la FY actual
  // (ALL_MONTHS_ORD_BG) para poder tratarlo como un escenario de Goal más en scenCT().
  var lastyear = {};
  Object.keys(lyRaw).forEach(function(n2){
    lastyear[n2] = {};
    ALL_MONTHS_ORD_BG.forEach(function(m, idx){
      lastyear[n2][m] = lyRaw[n2][ALL_MONTHS_ORD_LY_BG[idx]] || 0;
    });
  });

  var lrrMaxIdx = _epmScenMaxIdx_(lrr);

  // Construye un CT {n2:{mes:v}} eligiendo la fuente por mes según el escenario (GOAL).
  function scenCT(scen) {
    var out = {};
    ALL_MONTHS_ORD_BG.forEach(function(m, idx){
      var src;
      if (scen === 'budget')            src = budget;                              // budget = todo el FY
      else if (scen === 'runrate')      src = rrCont;                             // runrate = todo el FY
      else if (scen === 'forecast')     src = forecast;                           // forecast = todo el FY (forecast.json tiene actuals Apr-Jun + fc Jul-Mar)
      else if (scen === 'lastyear')     src = lastyear;                           // FY26 completo, mismo mes fiscal
      else if (idx <= cutoffIdx)        src = actuals;                             // meses cerrados (lastrunrate)
      else if (scen === 'lastrunrate')  src = (idx <= lrrMaxIdx) ? lrr : forecast; // LRR y luego forecast
      else                              src = forecast;                           // fallback
      Object.keys(src).forEach(function(n2){
        if (!out[n2]) out[n2] = {};
        out[n2][m] = (src[n2][m] || 0);
      });
    });
    return out;
  }

  // Baseline = escenario 'bl' (fuente única). Fallback: actuals+forecast si no viniera.
  var baselineCT = baseline || scenCT('forecast');
  var goalCTm    = scenCT(goalScen);

  // RR "monthly/quarters" derivado del CT (EPM no tiene gestional)
  function ctToRR(ctm) {
    var q = {}, mo = {};
    Object.keys(RR_N2_MAP_BG).forEach(function(k){
      var n2      = RR_N2_MAP_BG[k].toLowerCase();
      var monthly = ctm[n2] || {};
      q[k] = monthsToQuartersBG_(monthly);
      q[k]['Total FY27'] = (q[k]['Q1 FY27'] || 0) + (q[k]['Q2 FY27'] || 0)
                         + (q[k]['Q3 FY27'] || 0) + (q[k]['Q4 FY27'] || 0);
      mo[k] = {};
      ALL_MONTHS_ORD_BG.forEach(function(m){ mo[k][m] = monthly[m] || 0; });
    });
    return { q: q, mo: mo };
  }
  var bRR = ctToRR(baselineCT);
  var gRR = ctToRR(goalCTm);

  return {
    baseline: { rr: bRR.q, ct: n2ToQuartersBG_(baselineCT),
                rr_monthly: bRR.mo, ct_monthly: baselineCT },
    goal:     { rr: gRR.q, ct: n2ToQuartersBG_(goalCTm),
                rr_monthly: gRR.mo, ct_monthly: goalCTm }
  };
}

// ── fetchEPMScenarios_: trae los 6 escenarios (ac/rr/bg/fc/lrr/ly) + el baseline
// elegido, para un lgKey y opcionalmente filtrado por producto. Antes este bloque
// (con su branch hasProd ? ...ForProd_ : ...) estaba copiado a mano en 6-8 lugares
// distintos (getEPMBaselineGoalData, _epmLob, _pxqGroup_, getEPMCountriesYoY,
// getEPMB2BCountryDetail.comp/compForPais, getEPMB2B2CCountryDetail) — agregar o
// sacar un escenario significaba acordarse de tocar todos esos lugares a mano
// (así quedó "Last Year" a medio cablear la primera vez). Ahora es un solo lugar.
function fetchEPMScenarios_(jData, lgKey, baselineScen, prodArr) {
  var hasProd = prodArr && prodArr.length > 0;
  var get = hasProd
    ? function(sc, ymMap) { return jsonScenarioToByPaisForProd_(jData, lgKey, sc, ymMap, prodArr); }
    : function(sc, ymMap) { return jsonScenarioToByPais_(jData, lgKey, sc, ymMap); };
  return {
    ac:  get('ac',  ALL_YM_BG),
    rr:  get('rr',  ALL_YM_BG),
    bg:  get('bg',  ALL_YM_BG),
    fc:  get('fc',  ALL_YM_BG),
    lrr: get('lrr', ALL_YM_BG),
    ly:  get('ly',  ALL_YM_LY_BG),
    bl:  get(baselineScen || 'bl', ALL_YM_BG)
  };
}

// ── Helper: cutoff index desde JSON EPM ──────────────────────────────────────
function epmCutoffIdx_(jData) {
  var labels = {};
  (jData.actual_months || []).forEach(function(ym){ var l = ALL_YM_BG[ym]; if(l) labels[l] = true; });
  var cutoff = null;
  for (var i = ALL_MONTHS_ORD_BG.length - 1; i >= 0; i--) {
    if (labels[ALL_MONTHS_ORD_BG[i]]) { cutoff = ALL_MONTHS_ORD_BG[i]; break; }
  }
  return cutoff ? ALL_MONTHS_ORD_BG.indexOf(cutoff) : -1;
}

// ── getEPMBaselineGoalData ────────────────────────────────────────────────────
function getEPMBaselineGoalData(filtersJson) {
  var filters     = filtersJson || {};
  var lobGroup    = filters.lobGroup || null;
  var rawProd     = filters.produto || filters.producto || [];
  var userProduto = (Array.isArray(rawProd) ? rawProd : (rawProd ? [rawProd] : []));
  userProduto     = userProduto.length ? userProduto : null;
  var userPais    = (filters.pais && filters.pais.length) ? filters.pais : null;

  var jData    = readEPMJSON_();
  var lgKey    = lgKeyFromGroup_(lobGroup, filters);
  var cutoffIdx = epmCutoffIdx_(jData);
  var goalSource     = filters.goalSource     || 'budget';   // 'budget' | 'forecast' | 'lastrunrate'
  var baselineScen   = filters.baselineSource || 'bl';       // 'bl' (Actuals+Proj) | 'vr' (Proj Reviews) | 'fc' (Forecast entero)

  var prodFilter = (userProduto && (lgKey !== 'b2b2c') && jData.data_by_prod) ? userProduto : null;
  var s = fetchEPMScenarios_(jData, lgKey, baselineScen, prodFilter);

  var _epmOpts = { goal: goalSource, lrr: s.lrr, baseline: s.bl, ly: s.ly };
  var total = computeGroupEPM_(s.ac, s.rr, s.bg, s.fc, cutoffIdx, userPais, _epmOpts);

  var byCountry = {};
  PAIS_GROUPS_BG.forEach(function(g){
    byCountry[g.label] = computeGroupEPM_(s.ac, s.rr, s.bg, s.fc, cutoffIdx, g.pais, _epmOpts);
  });

  // by_lob: desglose B2B y B2B2C para el sub-tab "B2B+B2B2C"
  function _epmLob(lg) {
    var sl = fetchEPMScenarios_(jData, lg, baselineScen, null);
    return computeGroupEPM_(sl.ac, sl.rr, sl.bg, sl.fc, cutoffIdx, null,
      { goal: goalSource, lrr: sl.lrr, baseline: sl.bl, ly: sl.ly });
  }
  var byLob = {
    'B2B':     _epmLob('b2b'),
    'B2B2C':   _epmLob('b2b2c'),
    'B2B-MAY': _epmLob('b2b_may'),
    'B2B-MIN': _epmLob('b2b_min')
  };

  // Gráfico: construido desde rr_monthly + ct_monthly (mismas fuentes que la tabla EPM)
  var lyAggE  = aggregatePaisByGroup_(s.ly || {}, userPais);
  var chartBLE = buildChartFromMonthly_(total.baseline.rr_monthly, total.baseline.ct_monthly);
  var chartBGE = buildChartFromMonthly_(total.goal.rr_monthly,     total.goal.ct_monthly);
  var chartLYE = buildChartSeries_(lyAggE, ALL_MONTHS_ORD_LY_BG);
  var chartTotalE = {baseline: {}, budget: {}, ly: {}};
  CHART_N2_BG.forEach(function(m){
    chartTotalE.baseline[m] = seriesToMetric_(chartBLE, m);
    chartTotalE.budget[m]   = seriesToMetric_(chartBGE, m);
    chartTotalE.ly[m]       = seriesToMetric_(chartLYE, m);
  });
  var chart = { months: ALL_MONTHS_ORD_BG, total: chartTotalE };

  // LY por LOB para los gráficos evolutivos en la sub-vista "B2B + B2B2C"
  var lobLY = {
    'B2B':   aggregatePaisByGroup_(jsonScenarioToByPais_(jData, 'b2b',   'ly', ALL_YM_LY_BG) || {}, null),
    'B2B2C': aggregatePaisByGroup_(jsonScenarioToByPais_(jData, 'b2b2c', 'ly', ALL_YM_LY_BG) || {}, null)
  };

  return {
    quarters:   QUARTER_ORDER_BG,
    countries:  PAIS_GROUPS_BG.map(function(g){ return g.label; }),
    total:      total,
    by_country: byCountry,
    by_lob:     byLob,
    lob_ly:     lobLY,
    chart:      chart,
    filters:    buildBGFiltersFromJSON_(jData, lgKeyFromGroup_(lobGroup, {}))
  };
}

// ── getEPMPxQAnalysis: descomposición OC/GB baseline vs goal (Análisis PxQ) ──────
// Devuelve GB + OC + NR (baseline y goal, FY27) por segmento en 4 dimensiones.
// OC = suma de las 27 líneas N2 que componen la tabla del P&L (native sign),
// leídas de baseline.ct_monthly (actuals+forecast) y goal.ct_monthly (budget),
// para atar exacto con CONTABLE_PNL_STRUCTURE.
var PXQ_NR_KEYS_ = [
  'revenue from sales as principal','up front incentives','customer fees & charges',
  'back end incentives','other incentives','breakage revenue','media & other revenue',
  'income from outsourced services','loyalty revenue','cancellations','revenue taxes'
];
var PXQ_COR_SM_KEYS_ = [
  'cost of sales as principal','cost of installments','credit card processing',
  'customer claims','frauds','errors','bad debt','fulfilment center fees',
  'media & other cost','other transactional taxes','intercompany transactions',
  'marketing-direct','marketing-personnel/expenses','channels-personnel/expenses',
  'third party commissions','loyalty program'
];
var PXQ_OC_KEYS_ = PXQ_NR_KEYS_.concat(PXQ_COR_SM_KEYS_);

function _pxqSumKeysM_(ctm, keys, months) {
  var t = 0;
  for (var i = 0; i < keys.length; i++) {
    var mm = ctm[keys[i]];
    if (!mm) continue;
    for (var j = 0; j < months.length; j++) t += (mm[months[j]] || 0);
  }
  return t;
}
function _pxqSumKeys_(ctm, keys) { return _pxqSumKeysM_(ctm, keys, ALL_MONTHS_ORD_BG); }
function _pxqSeg_(G) {
  var b = G.baseline.ct_monthly, g = G.goal.ct_monthly;
  return {
    gb_base: _pxqSumKeys_(b, ['gross bookings']),
    gb_goal: _pxqSumKeys_(g, ['gross bookings']),
    nr_base: _pxqSumKeys_(b, PXQ_NR_KEYS_),
    nr_goal: _pxqSumKeys_(g, PXQ_NR_KEYS_),
    oc_base: _pxqSumKeys_(b, PXQ_OC_KEYS_),
    oc_goal: _pxqSumKeys_(g, PXQ_OC_KEYS_)
  };
}
function _pxqGroup_(jData, lgKey, paisGroup, cutoffIdx, prodArr, goalSource, baselineScen) {
  var s = fetchEPMScenarios_(jData, lgKey, baselineScen || 'bl', prodArr);
  return _pxqSeg_(computeGroupEPM_(s.ac, s.rr, s.bg, s.fc, cutoffIdx, paisGroup,
    { goal: goalSource || 'budget', lrr: s.lrr, baseline: s.bl, ly: s.ly }));
}

function getEPMPxQAnalysis(filtersJson) {
  var filters   = filtersJson || {};
  var goalSource = filters.goalSource || 'budget';
  var baselineScen = filters.baselineSource || 'bl';
  var jData = readEPMJSON_();
  var cutoffIdx = epmCutoffIdx_(jData);

  function seg(lgKey, paisGroup, prodArr) { return _pxqGroup_(jData, lgKey, paisGroup, cutoffIdx, prodArr, goalSource, baselineScen); }

  var total = seg('all', null, null);

  var byLob = [
    { name: 'B2B2C', seg: seg('b2b2c', null, null) },
    { name: 'B2B',   seg: seg('b2b',   null, null) }
  ];

  var byChannel = [
    { name: 'B2B2C',           seg: seg('b2b2c',   null, null) },
    { name: 'B2B · API (MAY)', seg: seg('b2b_may', null, null) },
    { name: 'B2B · HTML (MIN)',seg: seg('b2b_min', null, null) }
  ];

  var byCountry = PAIS_GROUPS_BG.map(function (g) {
    return { name: g.label, seg: seg('all', g.pais, null) };
  });

  // Producto: B2B por producto (MAY+MIN) + B2B2C entero
  var prodSet = {};
  ['b2b_may', 'b2b_min'].forEach(function (ch) {
    var byProd = (jData.data_by_prod || {})[ch] || {};
    Object.keys(byProd).forEach(function (pais) {
      Object.keys(byProd[pais] || {}).forEach(function (prod) {
        var pl = String(prod).toLowerCase();
        if (pl === '(sin produto)' || pl === '(sin producto)') return;
        prodSet[prod] = true;
      });
    });
  });
  var byProduct = Object.keys(prodSet).map(function (prod) {
    var may = _pxqGroup_(jData, 'b2b_may', null, cutoffIdx, [prod], goalSource);
    var min = _pxqGroup_(jData, 'b2b_min', null, cutoffIdx, [prod], goalSource);
    var lbl = prod.charAt(0).toUpperCase() + prod.slice(1);
    return { name: 'B2B · ' + lbl, seg: {
      gb_base: may.gb_base + min.gb_base, gb_goal: may.gb_goal + min.gb_goal,
      nr_base: may.nr_base + min.nr_base, nr_goal: may.nr_goal + min.nr_goal,
      oc_base: may.oc_base + min.oc_base, oc_goal: may.oc_goal + min.oc_goal
    }};
  });
  byProduct.push({ name: 'B2B2C', seg: seg('b2b2c', null, null) });

  return {
    updated_at: jData.updated_at || null,
    total:      total,
    by_lob:     byLob,
    by_channel: byChannel,
    by_country: byCountry,
    by_product: byProduct
  };
}

// ── getEPMCountriesYoY: crecimiento YoY por país (Baseline FY27 vs LY FY26) ──────
// Métricas GB / NR / OC, current = baseline (actuals+forecast), ly = last year.
function getEPMCountriesYoY(lobGroup, goalSourceArg, baselineSourceArg) {
  var jData = readEPMJSON_();
  var cutoffIdx = epmCutoffIdx_(jData);
  var goalSource = goalSourceArg || 'budget';
  var baselineScen = baselineSourceArg || 'bl';
  var lg = (lobGroup === 'b2b' || lobGroup === 'b2b2c') ? lobGroup : 'all';

  var s = fetchEPMScenarios_(jData, lg, baselineScen, null);

  // FY fiscal Abr–Mar → H1 = Abr–Sep (primeros 6), H2 = Oct–Mar (últimos 6)
  var H1c = ALL_MONTHS_ORD_BG.slice(0, 6),     H2c = ALL_MONTHS_ORD_BG.slice(6, 12);
  var H1l = ALL_MONTHS_ORD_LY_BG.slice(0, 6),  H2l = ALL_MONTHS_ORD_LY_BG.slice(6, 12);

  function yoy3(cur, lyAgg, bud, keys) {
    return {
      h1: { cur: _pxqSumKeysM_(cur, keys, H1c), ly: _pxqSumKeysM_(lyAgg, keys, H1l), bud: _pxqSumKeysM_(bud, keys, H1c) },
      h2: { cur: _pxqSumKeysM_(cur, keys, H2c), ly: _pxqSumKeysM_(lyAgg, keys, H2l), bud: _pxqSumKeysM_(bud, keys, H2c) },
      fy: { cur: _pxqSumKeysM_(cur, keys, ALL_MONTHS_ORD_BG), ly: _pxqSumKeysM_(lyAgg, keys, ALL_MONTHS_ORD_LY_BG), bud: _pxqSumKeysM_(bud, keys, ALL_MONTHS_ORD_BG) }
    };
  }
  function metrics(paisGroup, name) {
    var G     = computeGroupEPM_(s.ac, s.rr, s.bg, s.fc, cutoffIdx, paisGroup, { goal: goalSource, lrr: s.lrr, baseline: s.bl, ly: s.ly });
    var cur   = G.baseline.ct_monthly;
    var bud   = G.goal.ct_monthly;
    var lyAgg = aggregatePaisByGroup_(s.ly, paisGroup);
    return {
      name: name,
      gb: yoy3(cur, lyAgg, bud, ['gross bookings']),
      nr: yoy3(cur, lyAgg, bud, PXQ_NR_KEYS_),
      oc: yoy3(cur, lyAgg, bud, PXQ_OC_KEYS_)
    };
  }

  var rows  = PAIS_GROUPS_BG.map(function (g) { return metrics(g.pais, g.label); });
  var tname = 'Total ' + (lg === 'b2b' ? 'B2B' : lg === 'b2b2c' ? 'B2B2C' : 'B2B + B2B2C');
  var total = metrics(null, tname);
  return { updated_at: jData.updated_at || null, lob: lg, total: total, rows: rows };
}

// ── getEPMB2BCountryDetail ───────────────────────────────────────────────────
function getEPMB2BCountryDetail(paisGroupJson) {
  var g = typeof paisGroupJson === 'string' ? JSON.parse(paisGroupJson) : paisGroupJson;
  var paisArr = g.pais;
  if (paisArr && paisArr.indexOf('Globales') >= 0 && paisArr.indexOf('Otros') < 0) {
    paisArr = paisArr.concat(['Otros']);
  }

  var jData     = readEPMJSON_();
  var cutoffIdx = epmCutoffIdx_(jData);
  var goalSource   = g.goalSource     || 'budget';
  var baselineScen = g.baselineSource || 'bl';

  function comp(lgKey, prodArr) {
    var s = fetchEPMScenarios_(jData, lgKey, baselineScen, prodArr);
    return computeGroupEPM_(s.ac, s.rr, s.bg, s.fc, cutoffIdx, paisArr,
      { goal: goalSource, lrr: s.lrr, baseline: s.bl, ly: s.ly });
  }

  var MAY_FEATURED    = ['hotels', 'flights', 'dest. serv.'];
  var MAY_FEAT_LABELS = {'hotels':'Hotels','flights':'Flights','dest. serv.':'Dest. Serv.'};
  var MIN_FEATURED    = ['hotels', 'flights', 'packages general', 'dest. serv.', 'cruises'];
  var MIN_FEAT_LABELS = {'hotels':'Hotels','flights':'Flights','packages general':'Packages General','dest. serv.':'Dest. Serv.','cruises':'Cruises'};
  var MIN_REST_KEYS   = ['insurance', 'cars', 'vacation rentals', 'corporate'];

  function getAvailProds(lgKey) {
    var byProd = (jData.data_by_prod || {})[lgKey] || {};
    var skip   = {'(sin produto)': true, '(sin producto)': true};
    var prodSet = {};
    (Array.isArray(paisArr) ? paisArr : Object.keys(byProd)).forEach(function(p){
      var prodMap = byProd[p] || {};
      Object.keys(prodMap).forEach(function(prod){
        if (skip[prod]) return;
        var hasAny = ['ac','rr','bg','fc','ly'].some(function(sc){
          var scen = (prodMap[prod] || {})[sc] || {};
          return Object.keys(scen).some(function(n2){ return Object.keys(scen[n2]||{}).length > 0; });
        });
        if (hasAny) prodSet[prod] = true;
      });
    });
    return Object.keys(prodSet);
  }

  function buildCanalProds(lgKey, featuredKeys, featuredLabels, restKeys, restLabel) {
    var avail    = getAvailProds(lgKey);
    var availLow = avail.map(function(k){ return k.toLowerCase(); });
    var list = [];
    featuredKeys.forEach(function(fk){
      var idx = availLow.indexOf(fk.toLowerCase());
      if (idx < 0) return;
      list.push({label: featuredLabels[fk], data: comp(lgKey, [avail[idx]])});
    });
    var restProds;
    if (restKeys) {
      restProds = avail.filter(function(k){ return restKeys.indexOf(k.toLowerCase()) >= 0; });
    } else {
      var featLow = featuredKeys.map(function(k){ return k.toLowerCase(); });
      restProds = avail.filter(function(k){ return featLow.indexOf(k.toLowerCase()) < 0; });
    }
    if (restProds.length > 0) {
      list.push({label: restLabel, data: comp(lgKey, restProds)});
    }
    return list;
  }

  var mayProds = buildCanalProds('b2b_may', MAY_FEATURED, MAY_FEAT_LABELS, null,         'Rest of products');
  var minProds = buildCanalProds('b2b_min', MIN_FEATURED, MIN_FEAT_LABELS, MIN_REST_KEYS, 'Rest of ONA');

  // Regional breakdown for Palancas MAY / MIN (excluding iniciativas products)
  var MAY_INIC_KEYS = ['flights', 'dest. serv.'];
  var MIN_INIC_KEYS = ['cruises'];
  var REGION_GROUPS_EPM = [
    {label: 'Brasil',   pais: ['Brasil'],                                              byProduct: true},
    {label: 'Globales', pais: ['Globales', 'Otros', 'Paraguay', 'Uruguay']},
    {label: 'Mexico',   pais: ['Mexico'],                                              byProduct: true},
    {label: 'Hispa',    pais: ['Argentina', 'Colombia', 'Chile', 'Peru', 'Ecuador'],   byCountry: true},
    {label: 'RG - COI', pais: ['RG', 'OPS', 'OPS+RG']}
  ];
  var PALANCA_PROD_LABELS = {};
  [MAY_FEAT_LABELS, MIN_FEAT_LABELS].forEach(function(m){ Object.keys(m).forEach(function(k){ PALANCA_PROD_LABELS[k] = m[k]; }); });

  function compForPais(lgKey, prodArr, pArr) {
    var s = fetchEPMScenarios_(jData, lgKey, baselineScen, prodArr);
    return computeGroupEPM_(s.ac, s.rr, s.bg, s.fc, cutoffIdx, pArr,
      { goal: goalSource, lrr: s.lrr, baseline: s.bl, ly: s.ly });
  }

  var mayAvailAll     = getAvailProds('b2b_may');
  var minAvailAll     = getAvailProds('b2b_min');
  var mayPalancaProds = mayAvailAll.filter(function(k){ return MAY_INIC_KEYS.indexOf(k.toLowerCase()) < 0; });
  var minPalancaProds = minAvailAll.filter(function(k){ return MIN_INIC_KEYS.indexOf(k.toLowerCase()) < 0; });

  function buildByRegion(lgKey, palancaProds) {
    if (!palancaProds || palancaProds.length === 0) return [];
    var allPais = !paisArr || !paisArr.length;
    var canal = (lgKey === 'b2b_may') ? 'MAY' : 'MIN';
    return REGION_GROUPS_EPM.map(function(rg) {
      var subPais = allPais ? rg.pais : rg.pais.filter(function(p){ return paisArr.indexOf(p) >= 0; });
      if (subPais.length === 0) return null;
      var result = {label: rg.label, data: compForPais(lgKey, palancaProds, subPais)};
      if (rg.byProduct) {
        result.products = palancaProds.map(function(prod) {
          var lbl = PALANCA_PROD_LABELS[prod.toLowerCase()] || (prod.charAt(0).toUpperCase() + prod.slice(1));
          return {label: canal + ' · ' + lbl, data: compForPais(lgKey, [prod], subPais)};
        });
      }
      if (rg.byCountry) {
        result.countries = subPais.map(function(p) {
          return {label: p, data: compForPais(lgKey, palancaProds, [p])};
        });
      }
      return result;
    }).filter(function(x){ return x !== null; });
  }

  var mayByRegion = buildByRegion('b2b_may', mayPalancaProds);
  var minByRegion = buildByRegion('b2b_min', minPalancaProds);

  var totalData = comp('b2b', null);

  var chartBL = buildChartFromMonthly_(totalData.baseline.rr_monthly, totalData.baseline.ct_monthly);
  var chartBG = buildChartFromMonthly_(totalData.goal.rr_monthly,     totalData.goal.ct_monthly);
  var lyByPaisB2B = jsonScenarioToByPais_(jData, 'b2b', 'ly', ALL_YM_LY_BG);
  var lyAgg       = aggregatePaisByGroup_(lyByPaisB2B || {}, paisArr);
  var chartLY     = buildChartSeries_(lyAgg, ALL_MONTHS_ORD_LY_BG);
  var chartTotal  = {baseline: {}, budget: {}, ly: {}};
  CHART_N2_BG.forEach(function(m){
    chartTotal.baseline[m] = seriesToMetric_(chartBL, m);
    chartTotal.budget[m]   = seriesToMetric_(chartBG, m);
    chartTotal.ly[m]       = seriesToMetric_(chartLY, m);
  });

  return JSON.stringify({
    quarters: QUARTER_ORDER_BG,
    label:    g.label,
    total:    totalData,
    may:      {total: comp('b2b_may', null), products: mayProds, by_region: mayByRegion},
    min:      {total: comp('b2b_min', null), products: minProds, by_region: minByRegion},
    chart:    { months: ALL_MONTHS_ORD_BG, total: chartTotal }
  });
}

function getEPMB2B2CCountryDetail(paisGroupJson) {
  var g = typeof paisGroupJson === 'string' ? JSON.parse(paisGroupJson) : paisGroupJson;
  var paisArr = g.pais;
  var goalSource   = g.goalSource     || 'budget';
  var baselineScen = g.baselineSource || 'bl';

  var jData     = readEPMJSON_();
  var cutoffIdx = epmCutoffIdx_(jData);

  var s = fetchEPMScenarios_(jData, 'b2b2c', baselineScen, null);
  var totalData = computeGroupEPM_(s.ac, s.rr, s.bg, s.fc, cutoffIdx, paisArr,
    { goal: goalSource, lrr: s.lrr, baseline: s.bl, ly: s.ly });

  return JSON.stringify({
    quarters: QUARTER_ORDER_BG,
    label:    g.label,
    total:    totalData
  });
}
