// P&L RunRate Dashboard — Contable backend (datos desde JSON pre-computado en Drive)
var CONTABLE_JSON_FILE_ID = '1KHXgPykAHTJS50wI13kcz76FtLQwRnXc';

// ── Canonical JSONs — Drive folder 1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV ─────────
var CANONICAL_IDS_ = {
  ac:  '1PABNf4XVKdj6eXApr5_yP581ZsD_N9e-',  // actuals.json
  bg:  '1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW',  // budget.json
  fc:  '1crqpRTyH14fqX9XdwBTVaKN5rPbE6O84',  // forecast.json
  rr:  '1UGg60kE397nsGAivtFqI8NX5CVFj1gqO',  // runrate.json
  lrr: '1Nk56QlEA2hKuWGhfZ1357Eds6DhU8zwC',  // lastrunrate.json
  bl:  '1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv',  // baseline_actuals+projections.json
  vr:  '1ReDMnuv5MGsJACvQmkP39AlQM-RvtoYy',  // projections_validation_accounting.json
  ly:  '1zd5gnMFztKiCSgeY-VmsfVOr0LQ6ftGI'   // actuals_previos_fy26.json
};

// País canónico (lowercase) → etiqueta del cubo
var PAIS_MAP_CT_ = {
  'argentina':       'Argentina',
  'brasil':          'Brasil',
  'chile':           'Chile',
  'colombia':        'Colombia',
  'ecuador':         'Ecuador',
  'mexico':          'Mexico',
  'peru':            'Peru',
  'rg':              'RG',
  'others countries':'Globales',
  'other countries': 'Globales'
};

// LoB/Canal → array de lgKeys que agrega esa fila (mismo criterio que plana_to_cube.py)
function lgkeysForCT_(lob, canal) {
  if (lob === 'b2b2c') return ['b2b2c', 'all'];
  if (lob === 'b2b') {
    if (canal === 'may') return ['b2b_may', 'b2b', 'all'];
    if (canal === 'min') return ['b2b_min', 'b2b', 'all'];
    return ['b2b', 'all'];
  }
  return [];
}

// LoB/Canal → lgKeys para data_by_prod (sin rollup 'all'; solo B2B tiene apertura por producto)
function prodLgkeysForCT_(lob, canal) {
  if (lob === 'b2b') {
    if (canal === 'may') return ['b2b_may', 'b2b'];
    if (canal === 'min') return ['b2b_min', 'b2b'];
    return ['b2b'];
  }
  return [];
}

// ── Quarterly Baseline vs Goal ─────────────────────────────────────────────

var ALL_YM_BG = {
  '2026-04':'Abr-26','2026-05':'May-26','2026-06':'Jun-26',
  '2026-07':'Jul-26','2026-08':'Ago-26','2026-09':'Sep-26',
  '2026-10':'Oct-26','2026-11':'Nov-26','2026-12':'Dic-26',
  '2027-01':'Ene-27','2027-02':'Feb-27','2027-03':'Mar-27'
};
var ALL_MONTHS_ORD_BG = ['Abr-26','May-26','Jun-26','Jul-26','Ago-26','Sep-26','Oct-26','Nov-26','Dic-26','Ene-27','Feb-27','Mar-27'];

// FY26 (Last Year) — misma estructura fiscal, un año antes
var ALL_YM_LY_BG = {
  '2025-04':'Abr-25','2025-05':'May-25','2025-06':'Jun-25',
  '2025-07':'Jul-25','2025-08':'Ago-25','2025-09':'Sep-25',
  '2025-10':'Oct-25','2025-11':'Nov-25','2025-12':'Dic-25',
  '2026-01':'Ene-26','2026-02':'Feb-26','2026-03':'Mar-26'
};
var ALL_MONTHS_ORD_LY_BG = ['Abr-25','May-25','Jun-25','Jul-25','Ago-25','Sep-25','Oct-25','Nov-25','Dic-25','Ene-26','Feb-26','Mar-26'];

// Métricas de los gráficos mensuales (N2 en minúsculas, como los CT tabs)
var CHART_N2_BG = ['gross bookings', 'net revenue', 'operating contribution'];
var QUARTER_MONTHS_BG = {
  'Q1 FY27':    ['Abr-26','May-26','Jun-26'],
  'Q2 FY27':    ['Jul-26','Ago-26','Sep-26'],
  'Q3 FY27':    ['Oct-26','Nov-26','Dic-26'],
  'Q4 FY27':    ['Ene-27','Feb-27','Mar-27'],
  'Total FY27': ['Abr-26','May-26','Jun-26','Jul-26','Ago-26','Sep-26','Oct-26','Nov-26','Dic-26','Ene-27','Feb-27','Mar-27']
};
var QUARTER_ORDER_BG = ['Q1 FY27','Q2 FY27','Q3 FY27','Q4 FY27','Total FY27'];

// Columnas reales en pnl_runrate (para leer filas crudas)
var RR_RAW_COLS_BG = [
  'orders','gross_bookings','up_front_incentives',
  'fees','commercial_discounts',
  'income_from_outsourced_services','cancellations','cost_of_installments',
  'credit_card_processing','affiliates','white_labels_api',
  'dif_fx','currency_hedge'
];

// Mapa de clave derivada → nombre N2 en P&L Accounting (Budget/Actuals/RunRate tabs)
// _cfc_rr  = fees + commercial_discounts       (pnl_runrate) → 'customer fees & charges' (CT)
// _tpcs_rr = affiliates + white_labels_api     (pnl_runrate) → 'third party commissions' (CT)
// _cosp_rr = dif_fx + currency_hedge           (pnl_runrate) → 'cost of sales as principal' (CT)
var RR_N2_MAP_BG = {
  'orders':                          'orders',
  'gross_bookings':                  'gross bookings',
  'up_front_incentives':             'up front incentives',
  '_cfc_rr':                         'customer fees & charges',
  'income_from_outsourced_services': 'income from outsourced services',
  'cancellations':                   'cancellations',
  'cost_of_installments':            'cost of installments',
  'credit_card_processing':          'credit card processing',
  '_tpcs_rr':                        'third party commissions',
  '_cosp_rr':                        'cost of sales as principal'
};

// Grupos de pais para el desglose
var PAIS_GROUPS_BG = [
  {label:'Total',           pais:null},
  {label:'Brasil',          pais:['Brasil']},
  {label:'Mexico',          pais:['Mexico']},
  {label:'Argentina',       pais:['Argentina']},
  {label:'Colombia',        pais:['Colombia']},
  {label:'Chile',           pais:['Chile']},
  {label:'Peru + Ecuador',  pais:['Peru','Ecuador']},
  {label:'Other Countries', pais:'other'},
  {label:'RG',              pais:['RG']}
];
var EXPLICIT_PAISES_BG = ['Brasil','Mexico','Argentina','Colombia','Chile','Peru','Ecuador','RG'];

// ── Pre-computed JSON from Drive (reemplaza lectura de solapas) ───────────
// El JSON se genera con pnl_contable_upload.py y se sube a Drive.
var _contableJsonCache_   = null;
var _contableJsonCacheMs_ = 0;

// ── Delta Versiones FVM ───────────────────────────────────────────────────
var DELTA_FVM_FILE_ID = '1WjJWozMEQywxhOjhcLzzak385-_dI6ro';

function getDeltaFVM() {
  try {
    var file = DriveApp.getFileById(DELTA_FVM_FILE_ID);
    return file.getBlob().getDataAsString();
  } catch(e) {
    return JSON.stringify({error: e.toString()});
  }
}

function readContableJSON_() {
  try {
    var file    = DriveApp.getFileById(CONTABLE_JSON_FILE_ID);
    var lastMod = file.getLastUpdated().getTime();
    if (_contableJsonCache_ && lastMod <= _contableJsonCacheMs_) return _contableJsonCache_;
    _contableJsonCache_   = JSON.parse(file.getBlob().getDataAsString());
    _contableJsonCacheMs_ = lastMod;
  } catch(e) {
    Logger.log('readContableJSON_ error: ' + e);
    if (!_contableJsonCache_) _contableJsonCache_ = { data: {} };
  }
  return _contableJsonCache_;
}

// Mapea lobGroup + filtro de canal → clave lob_group en el JSON
// canal=['MAY'] → b2b_may | canal=['MIN'] → b2b_min | sin canal → b2b / all
function lgKeyFromGroup_(lobGroup, filters) {
  var canal = (filters && filters.canal && filters.canal.length === 1)
    ? filters.canal[0].toLowerCase() : null;
  if (lobGroup === 'b2b2c') return 'b2b2c';
  if (lobGroup === 'b2b') {
    if (canal === 'may') return 'b2b_may';
    if (canal === 'min') return 'b2b_min';
    return 'b2b';
  }
  // null = B2B+B2B2C combined
  if (canal === 'may') return 'b2b_may';
  if (canal === 'min') return 'b2b_min';
  return 'all';
}

// ── Lectura desde data_by_prod (con filtro de produto para B2B) ───────────────
// userProduto: array de strings seleccionados, o null para todos los productos
function jsonScenarioToByPaisForProd_(jData, lgKey, scenario, ymToLabel, userProduto) {
  var byProd = (((jData || {}).data_by_prod) || {})[lgKey] || {};
  var result = {};
  Object.keys(byProd).forEach(function(pais) {
    if (pais === 'all') return;
    var prodMap = byProd[pais] || {};
    var userProdLow = userProduto ? userProduto.map(function(p){ return p.toLowerCase(); }) : null;
    var prods = userProdLow
      ? Object.keys(prodMap).filter(function(p){ return userProdLow.indexOf(p.toLowerCase()) >= 0; })
      : Object.keys(prodMap);
    result[pais] = {};
    prods.forEach(function(prod) {
      var scen = ((prodMap[prod] || {})[scenario]) || {};
      Object.keys(scen).forEach(function(n2) {
        if (!result[pais][n2]) result[pais][n2] = {};
        Object.keys(scen[n2] || {}).forEach(function(ym) {
          var label = ymToLabel[ym];
          if (label) result[pais][n2][label] = (result[pais][n2][label] || 0) + scen[n2][ym];
        });
      });
    });
  });
  return result;
}

// Lectura de datos gestionales desde data_by_prod con filtro de produto
function jsonGestToRRDataForProd_(jData, lgKey, userProduto) {
  var byProd = (((jData || {}).data_by_prod) || {})[lgKey] || {};
  var byPais = {};
  Object.keys(byProd).forEach(function(pais) {
    if (pais === 'all') return;
    var prodMap = byProd[pais] || {};
    var userProdLow2 = userProduto ? userProduto.map(function(p){ return p.toLowerCase(); }) : null;
    var prods = userProdLow2
      ? Object.keys(prodMap).filter(function(p){ return userProdLow2.indexOf(p.toLowerCase()) >= 0; })
      : Object.keys(prodMap);
    byPais[pais] = {};
    prods.forEach(function(prod) {
      var gestData = (prodMap[prod] || {})['gest'] || {};
      RR_RAW_COLS_BG.forEach(function(col) {
        if (!byPais[pais][col]) byPais[pais][col] = {};
        var colData = gestData[col] || {};
        Object.keys(colData).forEach(function(ym) {
          var label = ALL_YM_BG[ym];
          if (label) byPais[pais][col][label] = (byPais[pais][col][label] || 0) + colData[ym];
        });
      });
    });
  });
  return { byPais: byPais };
}

// Como jsonGestToRRDataForProd_ pero lee gest_ri — para b2b_may en vista contable
function jsonGestRIToRRDataForProd_(jData, lgKey, userProduto) {
  var byProd = (((jData || {}).data_by_prod) || {})[lgKey] || {};
  var byPais = {};
  Object.keys(byProd).forEach(function(pais) {
    if (pais === 'all') return;
    var prodMap = byProd[pais] || {};
    var userProdLow2 = userProduto ? userProduto.map(function(p){ return p.toLowerCase(); }) : null;
    var prods = userProdLow2
      ? Object.keys(prodMap).filter(function(p){ return userProdLow2.indexOf(p.toLowerCase()) >= 0; })
      : Object.keys(prodMap);
    byPais[pais] = {};
    prods.forEach(function(prod) {
      var gestData = (prodMap[prod] || {})['gest_ri'] || {};
      RR_RAW_COLS_BG.forEach(function(col) {
        if (!byPais[pais][col]) byPais[pais][col] = {};
        var colData = gestData[col] || {};
        Object.keys(colData).forEach(function(ym) {
          var label = ALL_YM_BG[ym];
          if (label) byPais[pais][col][label] = (byPais[pais][col][label] || 0) + colData[ym];
        });
      });
    });
  });
  return { byPais: byPais };
}

// Convierte un escenario del JSON a { pais: { n2: { mes_label: val } } }
// ymToLabel: ALL_YM_BG (FY27) o ALL_YM_LY_BG (FY26 LY)
function jsonScenarioToByPais_(jData, lgKey, scenario, ymToLabel) {
  var lgData = (((jData || {}).data) || {})[lgKey] || {};
  var result = {};
  Object.keys(lgData).forEach(function(pais) {
    if (pais === 'all') return;   // 'all' = suma total; se deriva vía aggregatePaisByGroup_
    var scen = lgData[pais][scenario] || {};
    result[pais] = {};
    Object.keys(scen).forEach(function(n2) {
      result[pais][n2] = {};
      var monthly = scen[n2];
      Object.keys(monthly).forEach(function(ym) {
        var label = ymToLabel[ym];
        if (label) result[pais][n2][label] = (result[pais][n2][label] || 0) + monthly[ym];
      });
    });
  });
  return result;
}

// Convierte datos gest del JSON a { byPais: { pais: { col: { mes_label: val } } } }
// Incluye solo las columnas de RR_RAW_COLS_BG; los derivados (_cfc_rr etc.) los calcula aggregateRRByGroup_
function jsonGestToRRData_(jData, lgKey) {
  var lgData = (((jData || {}).data) || {})[lgKey] || {};
  var byPais = {};
  Object.keys(lgData).forEach(function(pais) {
    if (pais === 'all') return;
    var gest = lgData[pais]['gest'] || {};
    byPais[pais] = {};
    RR_RAW_COLS_BG.forEach(function(col) {
      var colData = gest[col] || {};
      byPais[pais][col] = {};
      Object.keys(colData).forEach(function(ym) {
        var label = ALL_YM_BG[ym];
        if (label) byPais[pais][col][label] = (byPais[pais][col][label] || 0) + colData[ym];
      });
    });
  });
  return { byPais: byPais };
}

// Lee gest_ri (fecha check-in) en lugar de gest (fecha reserva) — b2b_may usa RI en vista contable
function jsonGestRIToRRData_(jData, lgKey) {
  var lgData = (((jData || {}).data) || {})[lgKey] || {};
  var byPais = {};
  Object.keys(lgData).forEach(function(pais) {
    if (pais === 'all') return;
    var gest = lgData[pais]['gest_ri'] || {};
    byPais[pais] = {};
    RR_RAW_COLS_BG.forEach(function(col) {
      var colData = gest[col] || {};
      byPais[pais][col] = {};
      Object.keys(colData).forEach(function(ym) {
        var label = ALL_YM_BG[ym];
        if (label) byPais[pais][col][label] = (byPais[pais][col][label] || 0) + colData[ym];
      });
    });
  });
  return { byPais: byPais };
}

// Combina dos RRData { byPais } sumando por pais/col/label — b2b = may(RI) + min(GD)
function mergeRRData_(a, b) {
  var merged = {};
  [a, b].forEach(function(src) {
    Object.keys((src || {}).byPais || {}).forEach(function(pais) {
      if (!merged[pais]) merged[pais] = {};
      Object.keys(src.byPais[pais]).forEach(function(col) {
        if (!merged[pais][col]) merged[pais][col] = {};
        Object.keys(src.byPais[pais][col]).forEach(function(label) {
          merged[pais][col][label] = (merged[pais][col][label] || 0) + src.byPais[pais][col][label];
        });
      });
    });
  });
  return { byPais: merged };
}

// Construye opciones de filtro desde el JSON (pais de los datos; lob/canal de los lg_keys presentes)
function buildBGFiltersFromJSON_(jData, lgKey) {
  var lgData = (((jData || {}).data) || {})[lgKey] || {};
  var paises = Object.keys(lgData).filter(function(p){ return p !== 'all'; }).sort();
  var jd = (jData || {}).data || {};
  var lobs = [];
  if (jd['b2b'])   lobs.push('B2B');
  if (jd['b2b2c']) lobs.push('B2B2C');
  var canals = [];
  if (jd['b2b_may']) canals.push('MAY');
  if (jd['b2b_min']) canals.push('MIN');
  // Produtos solo disponibles para B2B (B2B2C no tiene apertura de producto)
  var products = (lgKey !== 'b2b2c') ? (((jData || {}).products || {})[lgKey] || []) : [];
  return { lob: lobs, canal: canals, pais: paises, produto: products };
}

// ── Agrega datos byPais segun grupo ───────────────────────────────────────
// paisGroup: null=total, ['Brasil',...]=lista explicita, 'other'=complemento de EXPLICIT_PAISES_BG
// Retorna { n2: { month_label: amount } }
function aggregatePaisByGroup_(byPaisData, paisGroup) {
  var allPaises = Object.keys(byPaisData);
  var selected;
  if (paisGroup === null) {
    selected = allPaises;
  } else if (paisGroup === 'other') {
    var expLow = EXPLICIT_PAISES_BG.map(function(p){ return p.toLowerCase(); });
    selected = allPaises.filter(function(p){ return expLow.indexOf(p.toLowerCase()) < 0 && p !== '_no_pais_'; });
  } else {
    var grpLow = paisGroup.map(function(p){ return p.toLowerCase(); });
    selected = allPaises.filter(function(p){ return grpLow.indexOf(p.toLowerCase()) >= 0; });
  }
  var out = {};
  selected.forEach(function(pais){
    var n2Map = byPaisData[pais] || {};
    Object.keys(n2Map).forEach(function(n2){
      if (!out[n2]) out[n2] = {};
      Object.keys(n2Map[n2]).forEach(function(m){
        out[n2][m] = (out[n2][m] || 0) + n2Map[n2][m];
      });
    });
  });
  return out;
}

function monthsToQuartersBG_(monthly) {
  var q = {};
  QUARTER_ORDER_BG.forEach(function(qt){
    var sum = 0;
    (QUARTER_MONTHS_BG[qt]||[]).forEach(function(m){ sum += (monthly[m]||0); });
    q[qt] = sum;
  });
  return q;
}

function n2ToQuartersBG_(n2Monthly) {
  var out = {};
  Object.keys(n2Monthly).forEach(function(n2){
    out[n2] = monthsToQuartersBG_(n2Monthly[n2]);
  });
  return out;
}

// ── Agrega pnl_runrate por grupo de pais, retorna { metric: { quarter: value } } ──
function aggregateRRByGroup_(rrByPais, paisGroup, asMonthly) {
  var allPaises = Object.keys(rrByPais);
  var selected;
  if (paisGroup === null) {
    selected = allPaises;
  } else if (paisGroup === 'other') {
    var expLow = EXPLICIT_PAISES_BG.map(function(p){ return p.toLowerCase(); });
    selected = allPaises.filter(function(p){ return expLow.indexOf(p.toLowerCase()) < 0; });
  } else {
    var grpLow = paisGroup.map(function(p){ return p.toLowerCase(); });
    selected = allPaises.filter(function(p){ return grpLow.indexOf(p.toLowerCase()) >= 0; });
  }

  var monthly = {};
  RR_RAW_COLS_BG.forEach(function(k){ monthly[k] = {}; });

  selected.forEach(function(pais){
    var metricMap = rrByPais[pais] || {};
    Object.keys(metricMap).forEach(function(k){
      Object.keys(metricMap[k]).forEach(function(m){
        monthly[k][m] = (monthly[k][m]||0) + metricMap[k][m];
      });
    });
  });

  // RG: cost_of_installments = |Brasil COI| (en RR, Brasil COI es negativo)
  var isRGGroup = Array.isArray(paisGroup) && paisGroup.length === 1 && paisGroup[0].toLowerCase() === 'rg';
  if (isRGGroup) {
    var brasilKeys = Object.keys(rrByPais).filter(function(p){
      var pl = p.toLowerCase(); return pl.indexOf('brasil') >= 0 || pl.indexOf('brazil') >= 0;
    });
    monthly['cost_of_installments'] = {};
    brasilKeys.forEach(function(p){
      var coiMap = rrByPais[p]['cost_of_installments'] || {};
      Object.keys(coiMap).forEach(function(m){
        monthly['cost_of_installments'][m] = (monthly['cost_of_installments'][m]||0) + Math.abs(coiMap[m]);
      });
    });
  }

  // Total (pais:null): Brasil COI es un costo gestional que RG revierte (+|Brasil COI|).
  // Como RG no existe como país real en pnl_ri, el total acumula Brasil(-X) sin el reverso.
  // Sumamos |Brasil COI| para que el neto sea 0 (solo impactan otros países si los tuvieran).
  if (!paisGroup) {
    var brasilKeysT = Object.keys(rrByPais).filter(function(p){
      var pl = p.toLowerCase(); return pl.indexOf('brasil') >= 0 || pl.indexOf('brazil') >= 0;
    });
    brasilKeysT.forEach(function(p){
      var coiMap = rrByPais[p]['cost_of_installments'] || {};
      Object.keys(coiMap).forEach(function(m){
        monthly['cost_of_installments'][m] = (monthly['cost_of_installments'][m]||0) + Math.abs(coiMap[m]);
      });
    });
  }

  // Derivados: agrupar los componentes que en CT vienen consolidados
  monthly['_cfc_rr']  = {};
  monthly['_tpcs_rr'] = {};
  monthly['_cosp_rr'] = {};
  ALL_MONTHS_ORD_BG.forEach(function(m){
    monthly['_cfc_rr'][m]  = (monthly['fees'][m]||0) + (monthly['commercial_discounts'][m]||0);
    monthly['_tpcs_rr'][m] = (monthly['affiliates'][m]||0) + (monthly['white_labels_api'][m]||0);
    monthly['_cosp_rr'][m] = (monthly['dif_fx'][m]||0) + (monthly['currency_hedge'][m]||0);
  });

  if(asMonthly){
    var mResult = {};
    Object.keys(RR_N2_MAP_BG).forEach(function(k){ mResult[k] = monthly[k] || {}; });
    return mResult;
  }
  var result = {};
  Object.keys(RR_N2_MAP_BG).forEach(function(k){ result[k] = monthsToQuartersBG_(monthly[k] || {}); });
  return result;
}

// ── Compute baseline+goal for a group given pre-aggregated data ───────────
function computeGroupWithAgg_(actualsByPais, rrContByPais, budgetByPais, forecastByPais, rrData, cutoffIdx, paisGroup, useCTForRR) {
  var actuals  = aggregatePaisByGroup_(actualsByPais,  paisGroup);
  var rrCont   = aggregatePaisByGroup_(rrContByPais,   paisGroup);
  var forecast = aggregatePaisByGroup_(forecastByPais, paisGroup);
  var budget   = aggregatePaisByGroup_(budgetByPais,   paisGroup);

  var baselineCT = {};
  ALL_MONTHS_ORD_BG.forEach(function(m){
    var idx = ALL_MONTHS_ORD_BG.indexOf(m);
    var src;
    if (idx <= cutoffIdx) src = actuals;
    else                  src = forecast;
    Object.keys(src).forEach(function(n2){
      if (!baselineCT[n2]) baselineCT[n2] = {};
      baselineCT[n2][m] = (src[n2][m] || 0);
    });
  });

  var baselineRR;
  if (useCTForRR) {
    // P&L Accounting: 100% contable_forecast_plana — todos los rows desde CT, sin blend gestional
    baselineRR = {};
    Object.keys(RR_N2_MAP_BG).forEach(function(k){
      var n2 = RR_N2_MAP_BG[k].toLowerCase();
      baselineRR[k] = monthsToQuartersBG_(baselineCT[n2] || {});
      baselineRR[k]['Total FY27'] = (baselineRR[k]['Q1 FY27']||0)+(baselineRR[k]['Q2 FY27']||0)+(baselineRR[k]['Q3 FY27']||0)+(baselineRR[k]['Q4 FY27']||0);
    });
  } else {
    // P&L Model + Accounting: blend gestional (Q2-Q4) + CT override (Q1)
    baselineRR = aggregateRRByGroup_(rrData.byPais, paisGroup);
    Object.keys(RR_N2_MAP_BG).forEach(function(k){
      var n2 = RR_N2_MAP_BG[k].toLowerCase();
      if (!baselineRR[k]) baselineRR[k] = {};
      ['Q1 FY27','Q2 FY27','Q3 FY27','Q4 FY27'].forEach(function(q){
        if (q === 'Q1 FY27') {
          var qSum = 0;
          (QUARTER_MONTHS_BG[q]||[]).forEach(function(m){
            qSum += ((baselineCT[n2] && baselineCT[n2][m]) || 0);
          });
          baselineRR[k][q] = qSum;
        }
      });
      baselineRR[k]['Total FY27'] = (baselineRR[k]['Q1 FY27'] || 0)
        + (baselineRR[k]['Q2 FY27'] || 0)
        + (baselineRR[k]['Q3 FY27'] || 0)
        + (baselineRR[k]['Q4 FY27'] || 0);
    });
  }

  var goalCT = n2ToQuartersBG_(budget);
  var goalRR = {};
  Object.keys(RR_N2_MAP_BG).forEach(function(k){
    goalRR[k] = monthsToQuartersBG_((budget[RR_N2_MAP_BG[k].toLowerCase()])||{});
  });

  // Datos mensuales para modo "Mes" en el frontend
  var baselineRR_m;
  if (useCTForRR) {
    baselineRR_m = {};
    Object.keys(RR_N2_MAP_BG).forEach(function(k){
      var n2 = RR_N2_MAP_BG[k].toLowerCase();
      baselineRR_m[k] = {};
      ALL_MONTHS_ORD_BG.forEach(function(m){
        baselineRR_m[k][m] = (baselineCT[n2] && baselineCT[n2][m]) || 0;
      });
    });
  } else {
    baselineRR_m = aggregateRRByGroup_(rrData.byPais, paisGroup, true);
    Object.keys(RR_N2_MAP_BG).forEach(function(k){
      var n2 = RR_N2_MAP_BG[k].toLowerCase();
      if(!baselineRR_m[k]) baselineRR_m[k] = {};
      ALL_MONTHS_ORD_BG.forEach(function(m){
        var isQ1 = (QUARTER_MONTHS_BG['Q1 FY27']||[]).indexOf(m) >= 0;
        if (isQ1) {
          baselineRR_m[k][m] = ((baselineCT[n2] && baselineCT[n2][m]) || 0);
        }
      });
    });
  }

  var goalRR_m = {};
  Object.keys(RR_N2_MAP_BG).forEach(function(k){
    var n2 = RR_N2_MAP_BG[k].toLowerCase();
    goalRR_m[k] = {};
    ALL_MONTHS_ORD_BG.forEach(function(m){
      goalRR_m[k][m] = ((budget[n2] && budget[n2][m]) || 0);
    });
  });

  return {
    baseline: { rr: baselineRR, ct: n2ToQuartersBG_(baselineCT),
                rr_monthly: baselineRR_m, ct_monthly: baselineCT },
    goal:     { rr: goalRR,     ct: goalCT,
                rr_monthly: goalRR_m, ct_monthly: budget }
  };
}

// ── Monthly chart series for Baseline / Budget / LY ──────────────────────
// NR = sum of all revenue line items (CT names for both ct-source and rr-equivalent rows)
var CHART_NR_KEYS = [
  'revenue from sales as principal','up front incentives','back end incentives',
  'customer fees & charges','other incentives','breakage revenue',
  'media & other revenue','income from outsourced services','loyalty revenue',
  'cancellations','revenue taxes'
];
// COR = sum of cost of revenue line items
var CHART_COR_KEYS = [
  'cost of sales as principal','cost of installments','credit card processing',
  'customer claims','errors','bad debt','fulfilment center fees',
  'media & other cost','other transactional taxes','intercompany transactions'
];
// S&M = sum of sales & marketing line items
var CHART_SM_KEYS = [
  'marketing-direct','marketing-personnel/expenses','channels-personnel/expenses',
  'third party commissions','loyalty program'
];

// CT-only subsets — usados en meses futuros para blend gestional(rr) + plana(ct)
// Complement: NR rr-sourced = up_front_incentives + fees + commercial_discounts + income_from_outsourced_services + cancellations
var CHART_NR_CT_KEYS = [
  'revenue from sales as principal','back end incentives','other incentives',
  'breakage revenue','media & other revenue','loyalty revenue','revenue taxes'
];
// Complement: COR rr-sourced = cost_of_installments + credit_card_processing
var CHART_COR_CT_KEYS = [
  'cost of sales as principal','customer claims','errors','bad debt',
  'fulfilment center fees','media & other cost','other transactional taxes',
  'intercompany transactions'
];
// Complement: S&M rr-sourced = affiliates + white_labels_api (= _tpcs_rr)
var CHART_SM_CT_KEYS = [
  'marketing-direct','marketing-personnel/expenses','channels-personnel/expenses','loyalty program'
];

function sumKeys_(agg, keys, month){
  return keys.reduce(function(s, k){ return s + ((agg[k] && agg[k][month]) || 0); }, 0);
}

// Construye series mensuales del gráfico desde rr_monthly + ct_monthly,
// usando exactamente las mismas claves que la tabla CONTABLE_PNL_STRUCTURE.
// Garantiza que gráfico y tabla coincidan.
function buildChartFromMonthly_(rrM, ctM) {
  function rr_(k, m) { return (rrM[k] && rrM[k][m]) || 0; }
  function ct_(k, m) { return (ctM[k] && ctM[k][m]) || 0; }
  return ALL_MONTHS_ORD_BG.map(function(mo) {
    var gb = rr_('gross_bookings', mo) || ct_('gross bookings', mo);
    var nr = rr_('up_front_incentives', mo)
           + rr_('_cfc_rr', mo)
           + rr_('income_from_outsourced_services', mo)
           + rr_('cancellations', mo)
           + ct_('revenue from sales as principal', mo)
           + ct_('back end incentives', mo)
           + ct_('other incentives', mo)
           + ct_('breakage revenue', mo)
           + ct_('media & other revenue', mo)
           + ct_('loyalty revenue', mo)
           + ct_('revenue taxes', mo);
    var cor = rr_('cost_of_installments', mo)
            + rr_('credit_card_processing', mo)
            + ct_('cost of sales as principal', mo)
            + ct_('customer claims', mo)
            + ct_('errors', mo)
            + ct_('bad debt', mo)
            + ct_('fulfilment center fees', mo)
            + ct_('media & other cost', mo)
            + ct_('other transactional taxes', mo)
            + ct_('intercompany transactions', mo);
    var sm = rr_('_tpcs_rr', mo)
           + ct_('marketing-direct', mo)
           + ct_('marketing-personnel/expenses', mo)
           + ct_('channels-personnel/expenses', mo)
           + ct_('loyalty program', mo);
    return {'gross bookings': gb, 'net revenue': nr, 'operating contribution': nr + cor + sm};
  });
}

function buildChartSeries_(agg, months){
  return months.map(function(mo){
    var gb = (agg['gross bookings'] && agg['gross bookings'][mo]) || 0;
    var nr = sumKeys_(agg, CHART_NR_KEYS, mo);
    var cor = sumKeys_(agg, CHART_COR_KEYS, mo);
    var sm  = sumKeys_(agg, CHART_SM_KEYS,  mo);
    return {
      'gross bookings':        gb,
      'net revenue':           nr,
      'operating contribution': nr + cor + sm
    };
  });
}

function seriesToMetric_(seriesArr, key){
  return seriesArr.map(function(s){ return s[key]; });
}

// gestRRByPais: { pais: { col: { label: val } } } — datos gestionales (gross_bookings futuro)
function computeChartFromAgg_(actualsByPais, rrContByPais, forecastByPais, budgetByPais, lyByPais, gestRRByPais, cutoffIdx, paisGroup) {
  var actuals  = aggregatePaisByGroup_(actualsByPais,  paisGroup);
  var rrCont   = aggregatePaisByGroup_(rrContByPais,   paisGroup);
  var forecast = aggregatePaisByGroup_(forecastByPais, paisGroup);
  var budget   = aggregatePaisByGroup_(budgetByPais,   paisGroup);
  var ly       = lyByPais    ? aggregatePaisByGroup_(lyByPais,    paisGroup) : {};
  var gest     = gestRRByPais ? aggregatePaisByGroup_(gestRRByPais, paisGroup) : {};

  // Baseline: misma lógica que la tabla P&L Contable
  //   meses pasados (idx <= cutoffIdx) → actuals | futuros → blend gestional(rr) + plana(ct)
  //   Gross Bookings futuro → gestional (el contable FC no siempre lo trae)
  var baselineSeries = ALL_MONTHS_ORD_BG.map(function(mo, idx){
    var isFuture = (idx > cutoffIdx);
    var src = (idx <= cutoffIdx ? actuals : forecast);
    var gbAcct = (src['gross bookings'] && src['gross bookings'][mo]) || 0;
    var gbGest = (gest['gross_bookings'] && gest['gross_bookings'][mo]) || 0;
    var gb = isFuture ? (gbGest || gbAcct) : gbAcct;
    var nr, cor, sm;
    if (isFuture) {
      // Meses futuros: rr-sourced desde gestional, ct-sourced desde plana (igual que la tabla)
      var nr_rr = ((gest['up_front_incentives'] && gest['up_front_incentives'][mo]) || 0)
                + ((gest['fees'] && gest['fees'][mo]) || 0)
                + ((gest['commercial_discounts'] && gest['commercial_discounts'][mo]) || 0)
                + ((gest['income_from_outsourced_services'] && gest['income_from_outsourced_services'][mo]) || 0)
                + ((gest['cancellations'] && gest['cancellations'][mo]) || 0);
      nr = nr_rr + sumKeys_(src, CHART_NR_CT_KEYS, mo);
      var cor_rr = ((gest['cost_of_installments'] && gest['cost_of_installments'][mo]) || 0)
                 + ((gest['credit_card_processing'] && gest['credit_card_processing'][mo]) || 0);
      cor = cor_rr + sumKeys_(src, CHART_COR_CT_KEYS, mo);
      var sm_rr = ((gest['affiliates'] && gest['affiliates'][mo]) || 0)
                + ((gest['white_labels_api'] && gest['white_labels_api'][mo]) || 0);
      sm = sm_rr + sumKeys_(src, CHART_SM_CT_KEYS, mo);
    } else {
      // Meses pasados (actuals): todo desde accounting (igual que la tabla para Q1)
      nr  = sumKeys_(src, CHART_NR_KEYS,  mo);
      cor = sumKeys_(src, CHART_COR_KEYS, mo);
      sm  = sumKeys_(src, CHART_SM_KEYS,  mo);
    }
    return {
      'gross bookings':        gb,
      'net revenue':           nr,
      'operating contribution': nr - cor - sm
    };
  });

  var budgetSeries = buildChartSeries_(budget, ALL_MONTHS_ORD_BG);
  var lySeries     = buildChartSeries_(ly,     ALL_MONTHS_ORD_LY_BG);

  var result = { baseline: {}, budget: {}, ly: {} };
  CHART_N2_BG.forEach(function(m){
    result.baseline[m] = seriesToMetric_(baselineSeries, m);
    result.budget[m]   = seriesToMetric_(budgetSeries,   m);
    result.ly[m]       = seriesToMetric_(lySeries,       m);
  });
  return result;
}

// ── getBaselineGoalData ────────────────────────────────────────────────────
function getBaselineGoalData(filtersJson) {
  var filters  = filtersJson || {};
  var userPais = (filters.pais && filters.pais.length) ? filters.pais : null;
  var lobGroup = filters.lobGroup || null; // null=B2B+B2B2C, 'b2b', 'b2b2c'
  var rawProd  = filters.produto || filters.producto || [];
  var userProduto = (Array.isArray(rawProd) ? rawProd : (rawProd ? [rawProd] : []));
  userProduto = userProduto.length ? userProduto : null;

  // Cargar JSON pre-computado desde Drive (generado por pnl_contable_upload.py)
  var jData  = readContableJSON_();
  var lgKey  = lgKeyFromGroup_(lobGroup, filters);

  // Convertir JSON a formato byPais para cada escenario
  var actualsByPais  = jsonScenarioToByPais_(jData, lgKey, 'ac', ALL_YM_BG);
  var rrContByPais   = jsonScenarioToByPais_(jData, lgKey, 'rr', ALL_YM_BG);
  var budgetByPais   = jsonScenarioToByPais_(jData, lgKey, 'bg', ALL_YM_BG);
  var forecastByPais = jsonScenarioToByPais_(jData, lgKey, 'fc', ALL_YM_BG);
  var lyByPais       = jsonScenarioToByPais_(jData, lgKey, 'ly', ALL_YM_LY_BG);

  // Regla: b2b_may usa RI (fecha check-in) en TODAS las granularidades de contable
  // b2b = may(RI) + min(GD); all = may(RI) + min(GD) + b2b2c(GD); resto = GD
  var rrData;
  if (lgKey === 'b2b_may') {
    rrData = jsonGestRIToRRData_(jData, 'b2b_may');
  } else if (lgKey === 'b2b') {
    rrData = mergeRRData_(jsonGestRIToRRData_(jData, 'b2b_may'), jsonGestToRRData_(jData, 'b2b_min'));
  } else if (lgKey === 'all') {
    // B2B+B2B2C total: may(RI) + min(GD) + b2b2c(GD)
    rrData = mergeRRData_(
      mergeRRData_(jsonGestRIToRRData_(jData, 'b2b_may'), jsonGestToRRData_(jData, 'b2b_min')),
      jsonGestToRRData_(jData, 'b2b2c')
    );
  } else {
    rrData = jsonGestToRRData_(jData, lgKey);
  }

  // Si hay filtro de produto Y el lob es B2B → sobrescribir con datos by-producto
  var isB2BLob = (lgKey !== 'b2b2c');
  if (userProduto && isB2BLob && jData.data_by_prod) {
    actualsByPais  = jsonScenarioToByPaisForProd_(jData, lgKey, 'ac', ALL_YM_BG,    userProduto);
    rrContByPais   = jsonScenarioToByPaisForProd_(jData, lgKey, 'rr', ALL_YM_BG,    userProduto);
    budgetByPais   = jsonScenarioToByPaisForProd_(jData, lgKey, 'bg', ALL_YM_BG,    userProduto);
    forecastByPais = jsonScenarioToByPaisForProd_(jData, lgKey, 'fc', ALL_YM_BG,    userProduto);
    lyByPais       = jsonScenarioToByPaisForProd_(jData, lgKey, 'ly', ALL_YM_LY_BG, userProduto);
    rrData = (lgKey === 'b2b_may')
      ? jsonGestRIToRRDataForProd_(jData, lgKey, userProduto)
      : jsonGestToRRDataForProd_(jData, lgKey, userProduto);
  }

  // Cutoff de Actuals: usar actual_months del JSON (excluye meses con datos de proyección pequeños)
  var jdActualMonths = jData.actual_months || [];
  var jdActualLabels = {};
  jdActualMonths.forEach(function(ym){ var lbl = ALL_YM_BG[ym]; if(lbl) jdActualLabels[lbl] = true; });
  var actualsCutoff = null;
  for (var i = ALL_MONTHS_ORD_BG.length - 1; i >= 0; i--) {
    if (jdActualLabels[ALL_MONTHS_ORD_BG[i]]) { actualsCutoff = ALL_MONTHS_ORD_BG[i]; break; }
  }
  var cutoffIdx = actualsCutoff ? ALL_MONTHS_ORD_BG.indexOf(actualsCutoff) : -1;

  // Total: respeta filtro de pais del usuario
  var total = computeGroupWithAgg_(actualsByPais, rrContByPais, budgetByPais, forecastByPais, rrData, cutoffIdx, userPais, true);

  // Desglose por pais: grupos fijos, ignora filtro de pais del usuario
  var byCountry = {};
  PAIS_GROUPS_BG.forEach(function(g){
    byCountry[g.label] = computeGroupWithAgg_(actualsByPais, rrContByPais, budgetByPais, forecastByPais, rrData, cutoffIdx, g.pais, true);
  });

  // by_lob: desglose B2B y B2B2C para el sub-tab "B2B+B2B2C"
  var b2bActuals  = jsonScenarioToByPais_(jData, 'b2b',   'ac', ALL_YM_BG);
  var b2bRRCont   = jsonScenarioToByPais_(jData, 'b2b',   'rr', ALL_YM_BG);
  var b2bBudget   = jsonScenarioToByPais_(jData, 'b2b',   'bg', ALL_YM_BG);
  var b2bForecast = jsonScenarioToByPais_(jData, 'b2b',   'fc', ALL_YM_BG);
  var b2bRR       = mergeRRData_(jsonGestRIToRRData_(jData, 'b2b_may'), jsonGestToRRData_(jData, 'b2b_min'));

  var b2b2cActuals  = jsonScenarioToByPais_(jData, 'b2b2c',   'ac', ALL_YM_BG);
  var b2b2cRRCont   = jsonScenarioToByPais_(jData, 'b2b2c',   'rr', ALL_YM_BG);
  var b2b2cBudget   = jsonScenarioToByPais_(jData, 'b2b2c',   'bg', ALL_YM_BG);
  var b2b2cForecast = jsonScenarioToByPais_(jData, 'b2b2c',   'fc', ALL_YM_BG);
  var b2b2cRR       = jsonGestToRRData_(jData, 'b2b2c');

  var b2bMayActuals  = jsonScenarioToByPais_(jData, 'b2b_may', 'ac', ALL_YM_BG);
  var b2bMayRRCont   = jsonScenarioToByPais_(jData, 'b2b_may', 'rr', ALL_YM_BG);
  var b2bMayBudget   = jsonScenarioToByPais_(jData, 'b2b_may', 'bg', ALL_YM_BG);
  var b2bMayForecast = jsonScenarioToByPais_(jData, 'b2b_may', 'fc', ALL_YM_BG);
  var b2bMayRR       = jsonGestRIToRRData_(jData, 'b2b_may');

  var b2bMinActuals  = jsonScenarioToByPais_(jData, 'b2b_min', 'ac', ALL_YM_BG);
  var b2bMinRRCont   = jsonScenarioToByPais_(jData, 'b2b_min', 'rr', ALL_YM_BG);
  var b2bMinBudget   = jsonScenarioToByPais_(jData, 'b2b_min', 'bg', ALL_YM_BG);
  var b2bMinForecast = jsonScenarioToByPais_(jData, 'b2b_min', 'fc', ALL_YM_BG);
  var b2bMinRR       = jsonGestToRRData_(jData, 'b2b_min');

  var byLob = {
    'B2B':     computeGroupWithAgg_(b2bActuals,    b2bRRCont,    b2bBudget,    b2bForecast,    b2bRR,    cutoffIdx, null, true),
    'B2B2C':   computeGroupWithAgg_(b2b2cActuals,  b2b2cRRCont,  b2b2cBudget,  b2b2cForecast,  b2b2cRR,  cutoffIdx, null, true),
    'B2B-MAY': computeGroupWithAgg_(b2bMayActuals, b2bMayRRCont, b2bMayBudget, b2bMayForecast, b2bMayRR, cutoffIdx, null, true),
    'B2B-MIN': computeGroupWithAgg_(b2bMinActuals, b2bMinRRCont, b2bMinBudget, b2bMinForecast, b2bMinRR, cutoffIdx, null, true)
  };

  // LY mensual para gráficos B2B / B2B2C en vista combinada
  byLob['B2B'].ly   = { rr_monthly: {}, ct_monthly: aggregatePaisByGroup_(jsonScenarioToByPais_(jData, 'b2b',   'ly', ALL_YM_LY_BG) || {}, null) };
  byLob['B2B2C'].ly = { rr_monthly: {}, ct_monthly: aggregatePaisByGroup_(jsonScenarioToByPais_(jData, 'b2b2c', 'ly', ALL_YM_LY_BG) || {}, null) };

  // Si goalSource='epm': reemplaza el goal (budget) con el baseline del JSON EPM
  var goalSource = filters.goalSource || 'budget';
  if (goalSource === 'epm') {
    var epmJD     = readEPMJSON_();
    var epmCutOff = epmCutoffIdx_(epmJD);
    function epmComp_(ek, pais) {
      return computeGroupEPM_(
        jsonScenarioToByPais_(epmJD, ek, 'ac', ALL_YM_BG),
        jsonScenarioToByPais_(epmJD, ek, 'rr', ALL_YM_BG),
        jsonScenarioToByPais_(epmJD, ek, 'bg', ALL_YM_BG),
        jsonScenarioToByPais_(epmJD, ek, 'fc', ALL_YM_BG),
        epmCutOff, pais
      );
    }
    total.goal            = epmComp_(lgKey,      userPais).baseline;
    byLob['B2B'].goal     = epmComp_('b2b',     null).baseline;
    byLob['B2B2C'].goal   = epmComp_('b2b2c',   null).baseline;
    byLob['B2B-MAY'].goal = epmComp_('b2b_may', null).baseline;
    byLob['B2B-MIN'].goal = epmComp_('b2b_min', null).baseline;
  }

  // Gráficos mensuales: construidos desde rr_monthly + ct_monthly (mismas fuentes que la tabla)
  var lyAgg  = aggregatePaisByGroup_(lyByPais || {}, userPais);
  var chartBL = buildChartFromMonthly_(total.baseline.rr_monthly, total.baseline.ct_monthly);
  var chartBG = buildChartFromMonthly_(total.goal.rr_monthly,     total.goal.ct_monthly);
  var chartLY = buildChartSeries_(lyAgg, ALL_MONTHS_ORD_LY_BG);
  var chartTotal = {baseline: {}, budget: {}, ly: {}};
  CHART_N2_BG.forEach(function(m){
    chartTotal.baseline[m] = seriesToMetric_(chartBL, m);
    chartTotal.budget[m]   = seriesToMetric_(chartBG, m);
    chartTotal.ly[m]       = seriesToMetric_(chartLY, m);
  });
  var chart = { months: ALL_MONTHS_ORD_BG, total: chartTotal };

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

function invalidateBaselineGoalCache() {
  _contableJsonCache_ = null;
  return { ok: true };
}

// ── B2B Country Detail: Total + MAY/prods + MIN/prods ─────────────────────
function getB2BCountryDetail(paisGroupJson) {
  var g = typeof paisGroupJson === 'string' ? JSON.parse(paisGroupJson) : paisGroupJson;
  var paisArr = g.pais; // e.g. ['Brasil'] or ['Peru','Ecuador']
  // "Globales" = "Other Countries" + "Otros" in contable JSON
  if (paisArr && paisArr.indexOf('Globales') >= 0 && paisArr.indexOf('Otros') < 0) {
    paisArr = paisArr.concat(['Otros']);
  }

  var jData = readContableJSON_();

  // Compute actuals cutoff
  var jdActualMonths = jData.actual_months || [];
  var jdActualLabels = {};
  jdActualMonths.forEach(function(ym){ var lbl = ALL_YM_BG[ym]; if(lbl) jdActualLabels[lbl] = true; });
  var actualsCutoff = null;
  for (var i = ALL_MONTHS_ORD_BG.length - 1; i >= 0; i--) {
    if (jdActualLabels[ALL_MONTHS_ORD_BG[i]]) { actualsCutoff = ALL_MONTHS_ORD_BG[i]; break; }
  }
  var cutoffIdx = actualsCutoff ? ALL_MONTHS_ORD_BG.indexOf(actualsCutoff) : -1;

  // Helper: compute {baseline, goal} for lgKey + paisArr + optional product list
  function comp(lgKey, prodArr) {
    var actualsByPais, rrContByPais, budgetByPais, forecastByPais, lyByPais;
    var hasProd = prodArr && prodArr.length > 0;
    if (hasProd) {
      actualsByPais  = jsonScenarioToByPaisForProd_(jData, lgKey, 'ac', ALL_YM_BG,    prodArr);
      rrContByPais   = jsonScenarioToByPaisForProd_(jData, lgKey, 'rr', ALL_YM_BG,    prodArr);
      budgetByPais   = jsonScenarioToByPaisForProd_(jData, lgKey, 'bg', ALL_YM_BG,    prodArr);
      forecastByPais = jsonScenarioToByPaisForProd_(jData, lgKey, 'fc', ALL_YM_BG,    prodArr);
      lyByPais       = jsonScenarioToByPaisForProd_(jData, lgKey, 'ly', ALL_YM_LY_BG, prodArr);
    } else {
      actualsByPais  = jsonScenarioToByPais_(jData, lgKey, 'ac', ALL_YM_BG);
      rrContByPais   = jsonScenarioToByPais_(jData, lgKey, 'rr', ALL_YM_BG);
      budgetByPais   = jsonScenarioToByPais_(jData, lgKey, 'bg', ALL_YM_BG);
      forecastByPais = jsonScenarioToByPais_(jData, lgKey, 'fc', ALL_YM_BG);
      lyByPais       = jsonScenarioToByPais_(jData, lgKey, 'ly', ALL_YM_LY_BG);
    }
    var rrDataLocal;
    if (lgKey === 'b2b_may') {
      rrDataLocal = hasProd
        ? jsonGestRIToRRDataForProd_(jData, lgKey, prodArr)
        : jsonGestRIToRRData_(jData, lgKey);
    } else if (lgKey === 'b2b' && !hasProd) {
      // Total B2B: MAY usa RI (check-in) + MIN usa GD (venta)
      rrDataLocal = mergeRRData_(jsonGestRIToRRData_(jData, 'b2b_may'), jsonGestToRRData_(jData, 'b2b_min'));
    } else {
      rrDataLocal = hasProd
        ? jsonGestToRRDataForProd_(jData, lgKey, prodArr)
        : jsonGestToRRData_(jData, lgKey);
    }
    return computeGroupWithAgg_(actualsByPais, rrContByPais, budgetByPais, forecastByPais, rrDataLocal, cutoffIdx, paisArr, true);
  }

  // Product configs
  var MAY_FEATURED    = ['hotels', 'flights', 'dest. serv.'];
  var MAY_FEAT_LABELS = {'hotels':'Hotels','flights':'Flights','dest. serv.':'Dest. Serv.'};
  var MIN_FEATURED    = ['hotels', 'flights', 'packages general', 'dest. serv.', 'cruises'];
  var MIN_FEAT_LABELS = {'hotels':'Hotels','flights':'Flights','packages general':'Packages General','dest. serv.':'Dest. Serv.','cruises':'Cruises'};
  var MIN_REST_KEYS   = ['insurance', 'cars', 'vacation rentals', 'corporate'];

  // Returns lowercase product keys that have any scenario data for lgKey + paisArr
  function getAvailProds(lgKey) {
    var byProd = (jData.data_by_prod || {})[lgKey] || {};
    var skip = {'(sin produto)': true, '(sin producto)': true};
    var prodSet = {};
    (Array.isArray(paisArr) ? paisArr : Object.keys(byProd)).forEach(function(p) {
      var prodMap = byProd[p] || {};
      Object.keys(prodMap).forEach(function(prod) {
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

  // Builds ordered [{label, data}] for a canal section
  function buildCanalProds(lgKey, featuredKeys, featuredLabels, restKeys, restLabel) {
    var avail = getAvailProds(lgKey);
    var availLow = avail.map(function(k){ return k.toLowerCase(); });
    var list = [];
    featuredKeys.forEach(function(fk) {
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
  var REGION_GROUPS_B2B = [
    {label: 'Brasil',   pais: ['Brasil'],                                              byProduct: true},
    {label: 'Globales', pais: ['Globales', 'Otros', 'Paraguay', 'Uruguay']},
    {label: 'Mexico',   pais: ['Mexico'],                                              byProduct: true},
    {label: 'Hispa',    pais: ['Argentina', 'Colombia', 'Chile', 'Peru', 'Ecuador'],   byCountry: true},
    {label: 'RG - COI', pais: ['RG', 'OPS', 'OPS+RG']}
  ];
  var PALANCA_PROD_LABELS = {};
  [MAY_FEAT_LABELS, MIN_FEAT_LABELS].forEach(function(m){ Object.keys(m).forEach(function(k){ PALANCA_PROD_LABELS[k] = m[k]; }); });

  function compForPais(lgKey, prodArr, pArr) {
    var hasProd = prodArr && prodArr.length > 0;
    var actualsByPais2, rrContByPais2, budgetByPais2, forecastByPais2;
    if (hasProd) {
      actualsByPais2  = jsonScenarioToByPaisForProd_(jData, lgKey, 'ac', ALL_YM_BG, prodArr);
      rrContByPais2   = jsonScenarioToByPaisForProd_(jData, lgKey, 'rr', ALL_YM_BG, prodArr);
      budgetByPais2   = jsonScenarioToByPaisForProd_(jData, lgKey, 'bg', ALL_YM_BG, prodArr);
      forecastByPais2 = jsonScenarioToByPaisForProd_(jData, lgKey, 'fc', ALL_YM_BG, prodArr);
    } else {
      actualsByPais2  = jsonScenarioToByPais_(jData, lgKey, 'ac', ALL_YM_BG);
      rrContByPais2   = jsonScenarioToByPais_(jData, lgKey, 'rr', ALL_YM_BG);
      budgetByPais2   = jsonScenarioToByPais_(jData, lgKey, 'bg', ALL_YM_BG);
      forecastByPais2 = jsonScenarioToByPais_(jData, lgKey, 'fc', ALL_YM_BG);
    }
    var rrDataLocal2 = (lgKey === 'b2b_may')
      ? (hasProd ? jsonGestRIToRRDataForProd_(jData, lgKey, prodArr) : jsonGestRIToRRData_(jData, lgKey))
      : (hasProd ? jsonGestToRRDataForProd_(jData, lgKey, prodArr)   : jsonGestToRRData_(jData, lgKey));
    return computeGroupWithAgg_(actualsByPais2, rrContByPais2, budgetByPais2, forecastByPais2, rrDataLocal2, cutoffIdx, pArr, false);
  }

  var mayAvailAll     = getAvailProds('b2b_may');
  var minAvailAll     = getAvailProds('b2b_min');
  var mayPalancaProds = mayAvailAll.filter(function(k){ return MAY_INIC_KEYS.indexOf(k.toLowerCase()) < 0; });
  var minPalancaProds = minAvailAll.filter(function(k){ return MIN_INIC_KEYS.indexOf(k.toLowerCase()) < 0; });

  function buildByRegion(lgKey, palancaProds) {
    if (!palancaProds || palancaProds.length === 0) return [];
    var allPais = !paisArr || !paisArr.length;
    var canal = (lgKey === 'b2b_may') ? 'MAY' : 'MIN';
    return REGION_GROUPS_B2B.map(function(rg) {
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

  // Si goalSource='epm': reemplaza el goal del total con el baseline EPM (misma lógica que getBaselineGoalData)
  var goalSource = g.goalSource || 'budget';
  if (goalSource === 'epm') {
    var epmJD2    = readEPMJSON_();
    var epmCut2   = epmCutoffIdx_(epmJD2);
    var epmTotal2 = computeGroupEPM_(
      jsonScenarioToByPais_(epmJD2, 'b2b', 'ac', ALL_YM_BG),
      jsonScenarioToByPais_(epmJD2, 'b2b', 'rr', ALL_YM_BG),
      jsonScenarioToByPais_(epmJD2, 'b2b', 'bg', ALL_YM_BG),
      jsonScenarioToByPais_(epmJD2, 'b2b', 'fc', ALL_YM_BG),
      epmCut2, paisArr
    );
    totalData.goal = epmTotal2.baseline;
  }

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

function getB2B2CCountryDetail(paisGroupJson) {
  var g = typeof paisGroupJson === 'string' ? JSON.parse(paisGroupJson) : paisGroupJson;
  var paisArr = g.pais; // null = Total B2B2C; array = selected countries

  var jData = readContableJSON_();

  var jdActualMonths = jData.actual_months || [];
  var jdActualLabels = {};
  jdActualMonths.forEach(function(ym){ var lbl = ALL_YM_BG[ym]; if(lbl) jdActualLabels[lbl] = true; });
  var actualsCutoff = null;
  for (var i = ALL_MONTHS_ORD_BG.length - 1; i >= 0; i--) {
    if (jdActualLabels[ALL_MONTHS_ORD_BG[i]]) { actualsCutoff = ALL_MONTHS_ORD_BG[i]; break; }
  }
  var cutoffIdx = actualsCutoff ? ALL_MONTHS_ORD_BG.indexOf(actualsCutoff) : -1;

  var actualsByPais  = jsonScenarioToByPais_(jData, 'b2b2c', 'ac', ALL_YM_BG);
  var rrContByPais   = jsonScenarioToByPais_(jData, 'b2b2c', 'rr', ALL_YM_BG);
  var budgetByPais   = jsonScenarioToByPais_(jData, 'b2b2c', 'bg', ALL_YM_BG);
  var forecastByPais = jsonScenarioToByPais_(jData, 'b2b2c', 'fc', ALL_YM_BG);
  var rrData         = jsonGestToRRData_(jData, 'b2b2c');

  var totalData = computeGroupWithAgg_(actualsByPais, rrContByPais, budgetByPais, forecastByPais, rrData, cutoffIdx, paisArr, true);

  return JSON.stringify({
    quarters: QUARTER_ORDER_BG,
    label:    g.label,
    total:    totalData
  });
}
