// ════════════════════════════════════════════════════════════════
//  B2B + B2B2C Dashboard — Apps Script Backend
// ════════════════════════════════════════════════════════════════

// Spreadsheet usado únicamente para leer la tab "Organigrama"
var SPREADSHEET_ID = '1RVmTXDyyugCUXJ0f6JG_croNxWNLlOLm4eAs8F52u2c';
// JSON files en Drive — fuente única para todos los escenarios P&L
var JSON_IDS = {
  baseline: '1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv',  // baseline_actuals+projections.json
  budget:   '1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW',  // budget.json
  runrate:  '1UGg60kE397nsGAivtFqI8NX5CVFj1gqO',  // runrate.json
  forecast: '1crqpRTyH14fqX9XdwBTVaKN5rPbE6O84',  // forecast.json
  ly:       '1zd5gnMFztKiCSgeY-VmsfVOr0LQ6ftGI'   // actuals_previos_fy26.json
};
// Actualizar cuando se regenera baseline_actuals+projections.json
var LAST_ACTUALS_YM = '2026-07';   // último mes con actuals reales
var LAST_RR_YM      = '2026-09';   // último mes de RunRate en el baseline

// ── Grupos P&L Summary por LoB ────────────────────────────────
var CANAL_GROUPS_BY_LOB = {
  'all': [
    { id:'wls',   label:"WL's",  lobFilter:'b2b2c', canalFilter:null,  paisFilter:null, paisExclude:null, lobExclude:null    },
    { id:'may',   label:'MAY',   lobFilter:'b2b',   canalFilter:'may', paisFilter:null, paisExclude:null, lobExclude:null    },
    { id:'min',   label:'MIN',   lobFilter:'b2b',   canalFilter:'min', paisFilter:null, paisExclude:null, lobExclude:null    },
    { id:'total', label:'Total', lobFilter:null,    canalFilter:null,  paisFilter:null, paisExclude:null, lobExclude:['b2c'] }
  ],
  'b2b2c': [
    { id:'brasil', label:'Brasil', lobFilter:'b2b2c', canalFilter:null, paisFilter:'brasil', paisExclude:null, lobExclude:null },
    { id:'mexico', label:'Mexico', lobFilter:'b2b2c', canalFilter:null, paisFilter:'mexico', paisExclude:null, lobExclude:null },
    { id:'hispa',  label:'Hispa',  lobFilter:'b2b2c', canalFilter:null, paisFilter:null, paisExclude:['brasil','mexico'], lobExclude:null },
    { id:'total',  label:'Total',  lobFilter:'b2b2c', canalFilter:null, paisFilter:null, paisExclude:null, lobExclude:null }
  ],
  'b2b': [
    { id:'brasil', label:'Brasil',          lobFilter:'b2b', canalFilter:null, paisFilter:'brasil',          paisExclude:null, lobExclude:null },
    { id:'mexico', label:'Mexico',          lobFilter:'b2b', canalFilter:null, paisFilter:'mexico',          paisExclude:null, lobExclude:null },
    { id:'other',  label:'Globales', lobFilter:'b2b', canalFilter:null, paisFilter:'other countries', paisExclude:null, lobExclude:null },
    { id:'hispa',  label:'Hispa',           lobFilter:'b2b', canalFilter:null, paisFilter:null, paisExclude:['brasil','mexico','other countries'], lobExclude:null },
    { id:'total',  label:'Total',           lobFilter:'b2b', canalFilter:null, paisFilter:null, paisExclude:null, lobExclude:null }
  ]
};

// ── Grupos Waterfall por LoB ──────────────────────────────────
// paisMultiFilter: array de valores de pais que se suman en un solo bar
var WF_GROUPS_BY_LOB = {
  'all': [
    { label:'Brasil',          paisFilter:'brasil',          paisExclude:null,                                                              paisMultiFilter:null },
    { label:'Mexico',          paisFilter:'mexico',          paisExclude:null,                                                              paisMultiFilter:null },
    { label:'Globales', paisFilter:'other countries', paisExclude:null,                                                              paisMultiFilter:null },
    { label:'Hispa',           paisFilter:null,              paisExclude:['brasil','mexico','other countries','ops','rg','ops + rg'],        paisMultiFilter:null },
    { label:'OPS+RG',          paisFilter:null,              paisExclude:null,                                                              paisMultiFilter:['ops','rg','ops + rg'] }
  ],
  'b2b2c': [
    { label:'Brasil',          paisFilter:'brasil',          paisExclude:null,                                                              paisMultiFilter:null },
    { label:'Mexico',          paisFilter:'mexico',          paisExclude:null,                                                              paisMultiFilter:null },
    { label:'Hispa',           paisFilter:null,              paisExclude:['brasil','mexico','ops','rg','ops + rg'],                         paisMultiFilter:null },
    { label:'OPS+RG',          paisFilter:null,              paisExclude:null,                                                              paisMultiFilter:['ops','rg','ops + rg'] }
  ],
  'b2b': [
    { label:'Brasil',          paisFilter:'brasil',          paisExclude:null,                                                              paisMultiFilter:null },
    { label:'Mexico',          paisFilter:'mexico',          paisExclude:null,                                                              paisMultiFilter:null },
    { label:'Globales', paisFilter:'other countries', paisExclude:null,                                                              paisMultiFilter:null },
    { label:'Hispa',           paisFilter:null,              paisExclude:['brasil','mexico','other countries','ops','rg','ops + rg'],        paisMultiFilter:null },
    { label:'OPS+RG',          paisFilter:null,              paisExclude:null,                                                              paisMultiFilter:['ops','rg','ops + rg'] }
  ]
};

function calcOC(agg) {
  if (!agg) return 0;
  return (agg['net revenue']||0) + (agg['cost of revenue']||0) + (agg['sales & marketing']||0);
}

// ══════════════════════════════════════════════════════════════
//  Entry points
// ══════════════════════════════════════════════════════════════
function doGet(e) {
  try {
    var page = (e && e.parameter && e.parameter.p) || 'dashboard';
    var allowed = { 'dashboard': true, 'presentacion_chief': true };
    if (!allowed[page]) page = 'dashboard';
    var title = page === 'presentacion_chief' ? 'B2B Ecosystem — Executive Overview' : 'P&L Dashboard';
    return HtmlService
      .createTemplateFromFile(page).evaluate()
      .setTitle(title)
      .addMetaTag('viewport','width=device-width,initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch(e) {
    return HtmlService.createHtmlOutput('<h1>Error</h1><p>'+e.toString()+'</p>');
  }
}

function getPresentationHtml() {
  return HtmlService.createHtmlOutputFromFile('presentacion_chief').getContent();
}

// ══════════════════════════════════════════════════════════════
//  Cache de resultados: CacheService (6 h TTL)
//  preComputeAll corre cada 5 h via trigger para mantenerlo warm
//  Auto-invalidación: si algún JSON de Drive cambió, el cache
//  se descarta automáticamente (no requiere preComputeAll manual).
// ══════════════════════════════════════════════════════════════
var RESULT_CACHE_MAX_S = 21600;  // 6 h

// Retorna el max lastUpdated (ms) de todos los JSON_IDS.
// Propio mini-cache de 5 min en CacheService para no llamar Drive en cada request.
var _MOD_CACHE_KEY_ = '_jsons_lastmod';
var _MOD_CACHE_TTL_ = 300;  // 5 min

function _getJsonsLastMod_() {
  var sc = CacheService.getScriptCache();
  var cached = sc.get(_MOD_CACHE_KEY_);
  if (cached) return parseInt(cached);
  var mx = 0;
  Object.keys(JSON_IDS).forEach(function(k) {
    try {
      var t = DriveApp.getFileById(JSON_IDS[k]).getLastUpdated().getTime();
      if (t > mx) mx = t;
    } catch(e) {}
  });
  sc.put(_MOD_CACHE_KEY_, String(mx), _MOD_CACHE_TTL_);
  return mx;
}

function makeCacheKey_(p) {
  return JSON.stringify({
    v:        23,
    lob:      p.lob      || 'all',
    pais:     p.pais     || 'all',
    producto: p.producto || 'all',
    canal:    p.canal    || 'all',
    desde:    p.desde    || '',
    hasta:    p.hasta    || ''
  });
}

// CacheService tiene límite de 100KB por valor. Resultados con waterfalls + P&L
// fácilmente superan ese límite y el put() falla silenciosamente. Usamos chunking:
// si el JSON supera CHUNK_SIZE, lo partimos en fragmentos _c0, _c1, … y guardamos
// un _meta con el count. readResultCache_ los rearma.
var CACHE_CHUNK_SIZE = 90000; // 90KB por chunk

function readResultCache_(key) {
  var sc   = CacheService.getScriptCache();
  var rKey = 'res_' + key;

  // Auto-invalidación: si algún JSON cambió en Drive desde que se escribió el cache, miss.
  var storedMod = sc.get(rKey + '_lm');
  if (storedMod && parseInt(storedMod) < _getJsonsLastMod_()) return null;

  var meta = sc.get(rKey + '_meta');
  if (meta) {
    try {
      var m = JSON.parse(meta);
      var parts = [];
      for (var i = 0; i < m.chunks; i++) {
        var c = sc.get(rKey + '_c' + i);
        if (!c) return null;   // chunk expirado → recalcular
        parts.push(c);
      }
      return JSON.parse(parts.join(''));
    } catch(e) { return null; }
  }
  var hit = sc.get(rKey);
  if (hit) { try { return JSON.parse(hit); } catch(e) {} }
  return null;
}

function writeResultCache_(key, value) {
  var json = JSON.stringify(value);
  var sc   = CacheService.getScriptCache();
  var rKey = 'res_' + key;
  try {
    // Guarda el lastMod de los JSONs al momento de escribir el cache.
    sc.put(rKey + '_lm', String(_getJsonsLastMod_()), RESULT_CACHE_MAX_S);
    if (json.length <= CACHE_CHUNK_SIZE) {
      sc.put(rKey, json, RESULT_CACHE_MAX_S);
    } else {
      var pairs = {};
      var nChunks = Math.ceil(json.length / CACHE_CHUNK_SIZE);
      pairs[rKey + '_meta'] = JSON.stringify({ chunks: nChunks });
      for (var i = 0; i < nChunks; i++) {
        pairs[rKey + '_c' + i] = json.slice(i * CACHE_CHUNK_SIZE, (i + 1) * CACHE_CHUNK_SIZE);
      }
      sc.putAll(pairs, RESULT_CACHE_MAX_S);
    }
  } catch(e) {}
}

function clearAllCache() {
  _jsonCache_ = {};   // resetea cache en memoria de esta instancia
  var sc = CacheService.getScriptCache();
  sc.removeAll(['tab_OKR', 'mkt_b2b', _MOD_CACHE_KEY_]);  // fuerza re-check de mod times
  Logger.log('Cache cleared: ' + new Date());
}

// ── ÚNICA llamada del frontend ────────────────────────────────
// Devuelve { filters, pnl, wf, evo } en un solo round-trip
function getAllData(params) {
  var p = params || {};

  // Resolver fechas vacías ANTES del cache lookup — usar LAST_ACTUALS_YM como default
  if (!p.desde || !p.hasta) {
    p = Object.assign({}, p, {
      desde: p.desde || LAST_ACTUALS_YM,
      hasta: p.hasta || LAST_ACTUALS_YM
    });
  }

  var key    = makeCacheKey_(p);
  var cached = readResultCache_(key);
  if (cached) return cached;

  // Cache miss: cargar todos los JSONs desde Drive
  var baseRows = readJson_(JSON_IDS.baseline);
  var rrRows   = readJson_(JSON_IDS.runrate);
  var budRows  = readJson_(JSON_IDS.budget);
  var fcRows   = readJson_(JSON_IDS.forecast);
  var lyRows   = readJson_(JSON_IDS.ly);

  // actMap = baseline (todo FY27 blended); blendedFromMaps_(baseMap, …) usa baseline completo
  var baseMap    = buildMap_(baseRows);
  var rrMap      = buildMap_(rrRows);
  var budMap     = buildMap_(budRows);
  var fcMap      = buildMap_(fcRows);
  var lyMap      = buildMap_(lyRows);
  var baseManMap = buildManMap_(baseRows);
  var rrManMap   = buildManMap_(rrRows);
  var budManMap  = buildManMap_(budRows);
  var lyManMap   = buildManMap_(lyRows);
  var baseNrN2   = buildNrN2Map_(baseRows);
  var rrNrN2     = buildNrN2Map_(rrRows);
  var budNrN2    = buildNrN2Map_(budRows);
  var lyNrN2     = buildNrN2Map_(lyRows);
  var basePalMap = buildPalancasMap_(baseRows);
  var rrPalMap   = buildPalancasMap_(rrRows);
  var budPalMap  = buildPalancasMap_(budRows);
  var filters    = buildFilters_(baseRows);

  var b2cP = { lob:'b2c', pais:p.pais, canal:'all', producto:p.producto };
  var result = {
    filters    : filters,
    pnl        : computePnL_(p,    baseMap, rrMap, budMap, lyMap, fcMap),
    wf         : computeWf_(p,     baseMap, rrMap, budMap, lyMap, fcMap),
    evo        : computeEvo_(p,    baseMap, rrMap, budMap, lyMap, fcMap),
    b2cEvo     : computeEvo_(b2cP, baseMap, rrMap, budMap, lyMap, fcMap),
    compPnl    : computeCompPnL_(p, baseMap, rrMap, budMap, lyMap, fcMap),
    ocConceptWf: computeOcConceptWf_(p, baseManMap, rrManMap, budManMap, lyManMap),
    nrBridgeWf : computeNRBridgeWf_(p, baseNrN2,   rrNrN2,   budNrN2,   lyNrN2),
    pxqData    : computePxQ_(p, baseMap, rrMap, budMap, basePalMap, rrPalMap, budPalMap)
  };

  writeResultCache_(key, result);
  return result;
}

// ══════════════════════════════════════════════════════════════
//  Pre-cómputo diario (llamado por trigger)
//  Calcula las combinaciones más comunes y llena la cache
// ══════════════════════════════════════════════════════════════
function preComputeAll() {
  // Cargar JSONs desde Drive una sola vez
  var baseRows = readJson_(JSON_IDS.baseline);
  var rrRows   = readJson_(JSON_IDS.runrate);
  var budRows  = readJson_(JSON_IDS.budget);
  var fcRows   = readJson_(JSON_IDS.forecast);
  var lyRows   = readJson_(JSON_IDS.ly);

  var baseMap    = buildMap_(baseRows);
  var rrMap      = buildMap_(rrRows);
  var budMap     = buildMap_(budRows);
  var fcMap      = buildMap_(fcRows);
  var lyMap      = buildMap_(lyRows);
  var baseManMap = buildManMap_(baseRows);
  var rrManMap   = buildManMap_(rrRows);
  var budManMap  = buildManMap_(budRows);
  var lyManMap   = buildManMap_(lyRows);
  var baseNrN2   = buildNrN2Map_(baseRows);
  var rrNrN2     = buildNrN2Map_(rrRows);
  var budNrN2    = buildNrN2Map_(budRows);
  var lyNrN2     = buildNrN2Map_(lyRows);
  var basePalMap = buildPalancasMap_(baseRows);
  var rrPalMap   = buildPalancasMap_(rrRows);
  var budPalMap  = buildPalancasMap_(budRows);
  var filters    = buildFilters_(baseRows);

  var lobs       = ['all', 'b2b', 'b2b2c'];
  var paisesList = ['all'].concat(filters.pais || []);
  var defaultYm  = LAST_ACTUALS_YM;
  var sc         = CacheService.getScriptCache();
  var count      = 0;

  lobs.forEach(function(lob) {
    paisesList.forEach(function(pais) {
      var isAllPais = (pais === 'all');
      var p    = { lob:lob, pais:pais, producto:'all', canal:'all', desde:defaultYm, hasta:defaultYm };
      var b2cP = { lob:'b2c', pais:pais, canal:'all', producto:'all' };
      var key  = makeCacheKey_(p);

      var result = {
        filters : filters,
        pnl     : computePnL_(p,    baseMap, rrMap, budMap, lyMap, fcMap),
        wf      : computeWf_(p,     baseMap, rrMap, budMap, lyMap, fcMap),
        evo     : computeEvo_(p,    baseMap, rrMap, budMap, lyMap, fcMap),
        b2cEvo  : computeEvo_(b2cP, baseMap, rrMap, budMap, lyMap, fcMap),
        compPnl : computeCompPnL_(p, baseMap, rrMap, budMap, lyMap, fcMap),
        ocConceptWf: isAllPais ? computeOcConceptWf_(p, baseManMap, rrManMap, budManMap, lyManMap) : null,
        nrBridgeWf : isAllPais ? computeNRBridgeWf_(p, baseNrN2,   rrNrN2,   budNrN2,   lyNrN2)   : null,
        pxqData    : isAllPais ? computePxQ_(p, baseMap, rrMap, budMap, basePalMap, rrPalMap, budPalMap) : null
      };

      writeResultCache_(key, result);
      count++;
    });
  });

  // Pre-warm quarterly ranges — pais='all' (vista más común del dashboard principal)
  // Incluye b2b × canal may/min para usuarios que filtran por canal
  var FY_QUARTERS = [
    { desde:'2026-04', hasta:'2026-06' },
    { desde:'2026-07', hasta:'2026-09' },
    { desde:'2026-10', hasta:'2026-12' },
    { desde:'2027-01', hasta:'2027-03' }
  ];

  FY_QUARTERS.forEach(function(qt) {
    lobs.forEach(function(lob) {
      // pais='all', canal='all'
      var p = { lob:lob, pais:'all', producto:'all', canal:'all', desde:qt.desde, hasta:qt.hasta };
      writeResultCache_(makeCacheKey_(p), {
        filters : filters,
        pnl     : computePnL_(p,    baseMap, rrMap, budMap, lyMap, fcMap),
        wf      : computeWf_(p,     baseMap, rrMap, budMap, lyMap, fcMap),
        evo     : computeEvo_(p,    baseMap, rrMap, budMap, lyMap, fcMap),
        b2cEvo  : computeEvo_({ lob:'b2c', pais:'all', canal:'all', producto:'all' }, baseMap, rrMap, budMap, lyMap, fcMap),
        compPnl : computeCompPnL_(p, baseMap, rrMap, budMap, lyMap, fcMap),
        ocConceptWf: computeOcConceptWf_(p, baseManMap, rrManMap, budManMap, lyManMap),
        nrBridgeWf : computeNRBridgeWf_(p, baseNrN2,   rrNrN2,   budNrN2,   lyNrN2),
        pxqData    : computePxQ_(p, baseMap, rrMap, budMap, basePalMap, rrPalMap, budPalMap)
      });
      count++;

      // b2b × may y min (usuarios que filtran canal)
      if (lob === 'b2b') {
        ['may', 'min'].forEach(function(canal) {
          var pb = { lob:'b2b', pais:'all', producto:'all', canal:canal, desde:qt.desde, hasta:qt.hasta };
          writeResultCache_(makeCacheKey_(pb), {
            filters : filters,
            pnl     : computePnL_(pb,    baseMap, rrMap, budMap, lyMap, fcMap),
            wf      : computeWf_(pb,     baseMap, rrMap, budMap, lyMap, fcMap),
            evo     : computeEvo_(pb,    baseMap, rrMap, budMap, lyMap, fcMap),
            b2cEvo  : null,
            compPnl : computeCompPnL_(pb, baseMap, rrMap, budMap, lyMap, fcMap),
            ocConceptWf: computeOcConceptWf_(pb, baseManMap, rrManMap, budManMap, lyManMap),
            nrBridgeWf : computeNRBridgeWf_(pb, baseNrN2,   rrNrN2,   budNrN2,   lyNrN2),
            pxqData    : null
          });
          count++;
        });
      }
    });
  });

  // Pre-warm Country One-Page: 4 trimestres × todos los países
  // (usa los mapas ya cargados arriba — no vuelve a leer Drive)
  CTRY_QUARTERS.forEach(function(qt) {
    CTRY_PAISES.forEach(function(pais) {
      var ctryKey = _ctryPageCacheKey_(pais, qt.desde, qt.hasta);
      var ctryResult = _computeCountryPageResult_(
        pais, qt.desde, qt.hasta,
        baseMap, rrMap, budMap, lyMap, fcMap,
        baseManMap, rrManMap, budManMap, lyManMap,
        baseNrN2,   rrNrN2,   budNrN2,  lyNrN2
      );
      writeResultCache_(ctryKey, ctryResult);
      count++;
    });
  });

  Logger.log('preComputeAll OK: ' + count + ' combinaciones — ' + new Date());
}

// Configurar trigger cada 5 h — ejecutar UNA SOLA VEZ manualmente
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'preComputeAll') ScriptApp.deleteTrigger(t);
  });
  // Cada 5 h para mantener la cache L1 (TTL=6h) siempre caliente
  ScriptApp.newTrigger('preComputeAll')
    .timeBased()
    .everyHours(5)
    .create();
  Logger.log('Trigger configurado: preComputeAll cada 5 h.');
}

// ── Keep-alive: evita cold start para usuarios ─────────────────
function keepAlive() {
  CacheService.getScriptCache().put('_ka', '1', 60);
}

function setupKeepAliveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'keepAlive') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('keepAlive')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Keep-alive trigger configurado cada 5 minutos.');
}

// Cache en memoria compartida entre requests de la misma instancia V8.
// Funciona con USER_DEPLOYING: la instancia se reutiliza y la variable persiste.
// Se invalida llamando clearAllCache() cuando se suben JSONs nuevos a Drive.
var _jsonCache_ = {};

// Lee un JSON canónico desde Drive y devuelve rows.
// Primera llamada: lee Drive (~1-3s). Siguientes: retorno inmediato desde memoria.
function readJson_(fileId) {
  if (_jsonCache_[fileId]) return _jsonCache_[fileId];

  var blob   = DriveApp.getFileById(fileId).getBlob();
  var parsed = JSON.parse(blob.getDataAsString('UTF-8'));
  var cols   = parsed.cols.map(function(c) { return String(c).trim().toLowerCase(); });

  var rows = parsed.rows.map(function(r) {
    var obj = {};
    cols.forEach(function(c, i) { obj[c] = r[i]; });
    if (obj['fecha']) {
      var fp = String(obj['fecha']).split('-');
      obj['fecha'] = Date.UTC(parseInt(fp[0]), parseInt(fp[1]) - 1, parseInt(fp[2]));
    }
    obj['monto usd'] = parseFloat(obj['monto usd']) || 0;
    return obj;
  });

  _jsonCache_[fileId] = rows;
  return rows;
}

// ══════════════════════════════════════════════════════════════
//  Pre-agregación: iterar rows 1 sola vez → mapa clave→monto
//  Clave: 'lob§canal§pais§producto§n3§ym'  (N3 map)
//         'lob§canal§pais§producto§n2§ym'  (N2 map)
// ══════════════════════════════════════════════════════════════
// Normaliza valores conocidos de la columna "pais" que vienen con typos de BITUBIA
var _PAIS_VALUE_NORM_ = {
  'others countries' : 'other countries',
  'otros países'     : 'other countries',
  'otros paises'     : 'other countries',
  'other'            : 'other countries'
};

// Canal normalization: b2b2c y b2c siempre usan 'all' (sin apertura de canal)
function _normCanal_(lob, can) {
  return (lob === 'b2b2c' || lob === 'b2c') ? 'all' : can;
}

function buildMap_(rows) {
  var map = {}, lastYm = '';
  rows.forEach(function(r) {
    if (!r['fecha']) return;
    var d   = new Date(r['fecha']);
    var ym  = d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
    var n3  = String(r['p&l n3']||'').trim().toLowerCase();
    if (!n3) return;
    var lob  = String(r['lob']     ||'').trim().toLowerCase();
    var can  = _normCanal_(lob, String(r['canal']   ||'').trim().toLowerCase());
    var pai  = String(r['pais']    ||'').trim().toLowerCase();
    pai = _PAIS_VALUE_NORM_[pai] || pai;
    var prod = String(r['producto']||'').trim().toLowerCase();
    if (ym > lastYm) lastYm = ym;
    var key = lob+'§'+can+'§'+pai+'§'+prod+'§'+n3+'§'+ym;
    map[key] = (map[key]||0) + (r['monto usd']||0);
  });
  return { map: map, lastYm: lastYm };
}

function buildN2Map_(rows) {
  var map = {}, lastYm = '';
  rows.forEach(function(r) {
    if (!r['fecha']) return;
    var d   = new Date(r['fecha']);
    var ym  = d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
    var n2  = String(r['p&l n2']||'').trim().toLowerCase();
    if (!n2) return;
    var lob  = String(r['lob']     ||'').trim().toLowerCase();
    var can  = _normCanal_(lob, String(r['canal']   ||'').trim().toLowerCase());
    var pai  = String(r['pais']    ||'').trim().toLowerCase();
    pai = _PAIS_VALUE_NORM_[pai] || pai;
    var prod = String(r['producto']||'').trim().toLowerCase();
    if (ym > lastYm) lastYm = ym;
    map[lob+'§'+can+'§'+pai+'§'+prod+'§'+n2+'§'+ym] =
      (map[lob+'§'+can+'§'+pai+'§'+prod+'§'+n2+'§'+ym]||0) + (r['monto usd']||0);
  });
  return { map: map, lastYm: lastYm };
}

var _OC_N3_ = ['net revenue', 'cost of revenue', 'sales & marketing'];

function buildNrN2Map_(rows) {
  var map = {}, lastYm = '';
  rows.forEach(function(r) {
    if (!r['fecha']) return;
    var n3 = String(r['p&l n3']||'').trim().toLowerCase();
    if (n3 !== 'net revenue') return;
    var n2 = String(r['p&l n2']||'').trim().toLowerCase();
    if (!n2) return;
    var d   = new Date(r['fecha']);
    var ym  = d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
    var lob  = String(r['lob']     ||'').trim().toLowerCase();
    var can  = _normCanal_(lob, String(r['canal']   ||'').trim().toLowerCase());
    var pai  = String(r['pais']    ||'').trim().toLowerCase();
    pai = _PAIS_VALUE_NORM_[pai] || pai;
    var prod = String(r['producto']||'').trim().toLowerCase();
    if (ym > lastYm) lastYm = ym;
    map[lob+'§'+can+'§'+pai+'§'+prod+'§'+n2+'§'+ym] =
      (map[lob+'§'+can+'§'+pai+'§'+prod+'§'+n2+'§'+ym]||0) + (r['monto usd']||0);
  });
  return { map: map, lastYm: lastYm };
}

function buildManMap_(rows) {
  var map = {}, detailMap = {}, lastYm = '';
  rows.forEach(function(r) {
    if (!r['fecha']) return;
    var n3 = String(r['p&l n3']||'').trim().toLowerCase();
    if (_OC_N3_.indexOf(n3) < 0) return;
    var n2 = String(r['p&l n2']||'').trim().toLowerCase() || n3;  // fallback a n3 si n2 vacío
    var mv = String(r['p&l managerial view']||'').trim() || 'Otros';
    var d   = new Date(r['fecha']);
    var ym  = d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
    var lob  = String(r['lob']     ||'').trim().toLowerCase();
    var can  = _normCanal_(lob, String(r['canal']   ||'').trim().toLowerCase());
    var pai  = String(r['pais']    ||'').trim().toLowerCase();
    pai = _PAIS_VALUE_NORM_[pai] || pai;
    var prod = String(r['producto']||'').trim().toLowerCase();
    if (ym > lastYm) lastYm = ym;
    var baseKey = lob+'§'+can+'§'+pai+'§'+prod+'§';
    map[baseKey+mv+'§'+ym] = (map[baseKey+mv+'§'+ym]||0) + (r['monto usd']||0);
    // detailMap: combina mv y n2 con '¶' dentro del slot del concepto,
    // así la clave mantiene 6 partes '§' y queryMap_ la parsea bien (ym queda en parts[5]).
    var dKey = baseKey + (mv+'¶'+n2) + '§' + ym;
    detailMap[dKey] = (detailMap[dKey]||0) + (r['monto usd']||0);
  });
  return { map: map, detailMap: detailMap, lastYm: lastYm };
}

// ── Consultar el mapa con filtros ─────────────────────────────
function queryMap_(mapData, globalFilter, groupFilter, ymFrom, ymTo) {
  var map    = mapData.map;
  var result = {};

  // Pre-computar filtros globales (lowercase una sola vez)
  var gl_lob  = globalFilter.lob      ? globalFilter.lob.toLowerCase()      : null;
  var gl_pai  = (globalFilter.pais    && globalFilter.pais    !== 'all') ? globalFilter.pais.toLowerCase().split('|') : null;
  var gl_can  = (globalFilter.canal   && globalFilter.canal   !== 'all') ? globalFilter.canal.toLowerCase()   : null;
  var gl_prod = (globalFilter.producto&& globalFilter.producto!== 'all') ? globalFilter.producto.toLowerCase(): null;

  // Pre-computar filtros de grupo
  var gf_lob    = groupFilter && groupFilter.lobFilter      ? groupFilter.lobFilter.toLowerCase()   : null;
  var gf_can    = groupFilter && groupFilter.canalFilter    ? groupFilter.canalFilter.toLowerCase() : null;
  var gf_pai    = groupFilter && groupFilter.paisFilter     ? groupFilter.paisFilter.toLowerCase()  : null;
  var gf_lexcl  = groupFilter && groupFilter.lobExclude     ? groupFilter.lobExclude.map(function(x){return x.toLowerCase();})    : null;
  var gf_pexcl  = groupFilter && groupFilter.paisExclude    ? groupFilter.paisExclude.map(function(x){return x.toLowerCase();})   : null;
  var gf_pmulti = groupFilter && groupFilter.paisMultiFilter? groupFilter.paisMultiFilter.map(function(x){return x.toLowerCase();}): null;

  var keys = Object.keys(map);
  for (var i = 0; i < keys.length; i++) {
    var key   = keys[i];
    var parts = key.split('§');
    var lob=parts[0], can=parts[1], pai=parts[2], prod=parts[3], n3=parts[4], ym=parts[5];

    // Filtro fecha (rápido, string compare)
    if (ymFrom && ym < ymFrom) continue;
    if (ymTo   && ym > ymTo  ) continue;

    // Filtro lob global
    if (gl_lob) {
      if (gl_lob !== 'all') { if (lob !== gl_lob) continue; }
      else { if (lob === 'b2c') continue; }  // 'all' = B2B+B2B2C, excluye B2C
    }

    // Filtros globales simples
    if (gl_pai  && gl_pai.indexOf(pai) < 0)  continue;
    if (gl_can  && can  !== gl_can)  continue;
    if (gl_prod && prod !== gl_prod) continue;

    // Filtros de grupo
    if (gf_lob   && lob !== gf_lob)  continue;
    if (gf_can   && can !== gf_can)  continue;
    if (gf_lexcl && gf_lexcl.indexOf(lob) >= 0) continue;
    if (gf_pexcl && gf_pexcl.indexOf(pai) >= 0) continue;
    // paisMultiFilter: incluir solo si pais está en la lista (OR)
    if (gf_pmulti) { if (gf_pmulti.indexOf(pai) < 0) continue; }
    else if (gf_pai && pai !== gf_pai) continue;

    result[n3] = (result[n3]||0) + map[key];
  }
  return result;
}

// ── Baseline blended usando mapas ─────────────────────────────
function blendedFromMaps_(actMap, rrMap, budMap, globalFilter, groupFilter) {
  var lastAct = actMap.lastYm;
  var lastRR  = rrMap.lastYm;
  var desde   = globalFilter.desde || '2020-01';
  var hasta   = globalFilter.hasta || '2030-12';
  var result  = {};

  function merge(agg) {
    var ks = Object.keys(agg);
    for (var i=0;i<ks.length;i++) result[ks[i]] = (result[ks[i]]||0) + agg[ks[i]];
  }

  // Actuals: desde → min(hasta, lastAct)
  if (lastAct && desde <= lastAct) {
    var actTo = lastAct < hasta ? lastAct : hasta;
    if (desde <= actTo) merge(queryMap_(actMap, globalFilter, groupFilter, desde, actTo));
  }

  // Run Rate: max(desde, nextMonth(lastAct)) → min(hasta, lastRR)
  var rrFrom = nextMonth_(lastAct);
  if (rrFrom < desde) rrFrom = desde;
  if (rrFrom && rrFrom <= hasta && lastRR && lastRR >= rrFrom) {
    var rrTo = lastRR < hasta ? lastRR : hasta;
    if (rrFrom <= rrTo) merge(queryMap_(rrMap, globalFilter, groupFilter, rrFrom, rrTo));
  }

  // Budget: max(desde, nextMonth(lastRR)) → hasta
  var budFrom = nextMonth_(lastRR);
  if (budFrom < desde) budFrom = desde;
  if (budFrom && budFrom <= hasta) {
    merge(queryMap_(budMap, globalFilter, groupFilter, budFrom, hasta));
  }

  return result;
}

// ══════════════════════════════════════════════════════════════
//  Filtros para dropdowns
// ══════════════════════════════════════════════════════════════
function buildFilters_(baselineRows) {
  var seen = { pais: {}, producto: {} };
  baselineRows.forEach(function(r) {
    var v;
    v = String(r['pais']    || '').trim(); if (v) seen.pais[v]     = true;
    v = String(r['producto']|| '').trim(); if (v) seen.producto[v] = true;
  });
  var fy27 = [];
  for (var m = 4; m <= 12; m++) fy27.push('2026-' + String(m).padStart(2, '0'));
  for (var m = 1; m <= 3;  m++) fy27.push('2027-' + String(m).padStart(2, '0'));
  return {
    pais:        Object.keys(seen.pais).sort(),
    producto:    Object.keys(seen.producto).sort(),
    periods:     fy27,
    lastActuals: LAST_ACTUALS_YM,
    lastRunRate: LAST_RR_YM
  };
}

// ══════════════════════════════════════════════════════════════
//  P&L Summary
// ══════════════════════════════════════════════════════════════
function computePnL_(p, actMap, rrMap, budMap, actPrevMap, fcMap) {
  var lobKey = (p.lob && CANAL_GROUPS_BY_LOB[p.lob]) ? p.lob : 'all';
  var GROUPS = CANAL_GROUPS_BY_LOB[lobKey];

  var METRICS = [
    { id:'orders', n3:'orders',         label:'Orders',                fmt:'K' },
    { id:'gb',     n3:'gross bookings', label:'Gross Bookings',        fmt:'M' },
    { id:'nr',     n3:'net revenue',    label:'Net Revenues',          fmt:'M' },
    { id:'oc',     n3:null,             label:'Operating Contribution',fmt:'M' }
  ];

  // YoY filter: mismo período año anterior
  var yoyFilter = Object.assign({}, p);
  if (p.desde) yoyFilter.desde = shiftYear_(p.desde,-1);
  if (p.hasta) yoyFilter.hasta = shiftYear_(p.hasta,-1);

  // Portfolio total = todos los lobs (sin filtro lob → incluye B2C)
  var portfolioFilter = { desde:p.desde, hasta:p.hasta, pais:p.pais, producto:p.producto };

  var result = { groups: GROUPS.map(function(g){return g.label;}), rows:[] };

  METRICS.forEach(function(m) {
    // Portfolio total (denominador del share) — calculado UNA vez por métrica
    var portBlended = blendedFromMaps_(actMap, rrMap, budMap, portfolioFilter, null);
    var portTotalVal = m.n3 ? (portBlended[m.n3]||0) : calcOC(portBlended);

    var cols = GROUPS.map(function(g) {
      var blended = blendedFromMaps_(actMap, rrMap, budMap, p, g);
      var bud     = queryMap_(budMap,            p, g, p.desde, p.hasta);
      var rr      = queryMap_(rrMap,             p, g, p.desde, p.hasta);
      var fc      = queryMap_(fcMap || budMap,   p, g, p.desde, p.hasta);
      var actYoY  = queryMap_(actPrevMap || actMap, yoyFilter, g, yoyFilter.desde, yoyFilter.hasta);

      var aVal  = m.n3 ? (blended[m.n3]||0) : calcOC(blended);
      var bVal  = m.n3 ? (bud[m.n3]||0)     : calcOC(bud);
      var rVal  = m.n3 ? (rr[m.n3]||0)      : calcOC(rr);
      var fcVal = m.n3 ? (fc[m.n3]||0)      : calcOC(fc);
      var yVal  = m.n3 ? (actYoY[m.n3]||0)  : calcOC(actYoY);

      return {
        actual    : aVal,
        budget    : bVal,
        runRate   : rVal,
        forecast  : fcVal,
        lyVal     : yVal,
        varBudAbs : aVal-bVal,
        varBudPct : bVal  !==0 ? (aVal-bVal) /Math.abs(bVal) *100 : null,
        varRRAbs  : aVal-rVal,
        varRRPct  : rVal  !==0 ? (aVal-rVal) /Math.abs(rVal) *100 : null,
        varFcAbs  : aVal-fcVal,
        varFcPct  : fcVal !==0 ? (aVal-fcVal)/Math.abs(fcVal)*100 : null,
        varLYAbs  : aVal-yVal,
        yoyPct    : yVal  !==0 ? (aVal-yVal) /Math.abs(yVal) *100 : null,
        sharePct  : portTotalVal!==0 ? aVal/portTotalVal*100 : null
      };
    });
    result.rows.push({ id:m.id, label:m.label, fmt:m.fmt, cols:cols });
  });
  return result;
}

// ── Comparison PnL: B2C vs WLs vs B2B vs Total Portfolio ─────
function computeCompPnL_(p, actMap, rrMap, budMap, actPrevMap, fcMap) {
  var COMP_GROUPS = [
    { id:'b2c',      label:'B2C',             lobFilter:'b2c',   canalFilter:null, paisFilter:null, paisExclude:null, lobExclude:null      },
    { id:'combined', label:'B2B + B2B2C',     lobFilter:null,    canalFilter:null, paisFilter:null, paisExclude:null, lobExclude:['b2c']   },
    { id:'wls',      label:'WLs (B2B2C)',     lobFilter:'b2b2c', canalFilter:null, paisFilter:null, paisExclude:null, lobExclude:null      },
    { id:'b2b',      label:'B2B',             lobFilter:'b2b',   canalFilter:null, paisFilter:null, paisExclude:null, lobExclude:null      },
    { id:'total',    label:'Total Portfolio', lobFilter:null,    canalFilter:null, paisFilter:null, paisExclude:null, lobExclude:null      }
  ];
  var METRICS = [
    { id:'orders', n3:'orders',         label:'Orders',                fmt:'K' },
    { id:'gb',     n3:'gross bookings', label:'Gross Bookings',        fmt:'M' },
    { id:'nr',     n3:'net revenue',    label:'Net Revenues',          fmt:'M' },
    { id:'oc',     n3:null,             label:'Operating Contribution',fmt:'M' }
  ];
  // No top-level lob filter — each group's lobFilter/lobExclude controls segmentation
  var cp = { desde:p.desde, hasta:p.hasta, pais:p.pais, canal:p.canal, producto:p.producto };
  var yoyFilter = Object.assign({}, cp);
  if (cp.desde) yoyFilter.desde = shiftYear_(cp.desde, -1);
  if (cp.hasta) yoyFilter.hasta = shiftYear_(cp.hasta, -1);

  var result = { groups: COMP_GROUPS.map(function(g){ return g.label; }), rows: [] };

  METRICS.forEach(function(m) {
    var cols = COMP_GROUPS.map(function(g) {
      var blended = blendedFromMaps_(actMap, rrMap, budMap, cp, g);
      var bud     = queryMap_(budMap,              cp, g, cp.desde, cp.hasta);
      var rr      = queryMap_(rrMap,               cp, g, cp.desde, cp.hasta);
      var fc      = queryMap_(fcMap || budMap,      cp, g, cp.desde, cp.hasta);
      var actYoY  = queryMap_(actPrevMap || actMap, yoyFilter, g, yoyFilter.desde, yoyFilter.hasta);

      var aVal  = m.n3 ? (blended[m.n3]||0) : calcOC(blended);
      var bVal  = m.n3 ? (bud[m.n3]||0)     : calcOC(bud);
      var rVal  = m.n3 ? (rr[m.n3]||0)      : calcOC(rr);
      var fcVal = m.n3 ? (fc[m.n3]||0)      : calcOC(fc);
      var yVal  = m.n3 ? (actYoY[m.n3]||0)  : calcOC(actYoY);

      return {
        actual   : aVal,
        budget   : bVal,
        lastYear : yVal,
        runRate  : rVal,
        forecast : fcVal,
        varBudPct: bVal  !==0 ? (aVal-bVal) /Math.abs(bVal) *100 : null,
        varRRPct : rVal  !==0 ? (aVal-rVal) /Math.abs(rVal) *100 : null,
        varFcPct : fcVal !==0 ? (aVal-fcVal)/Math.abs(fcVal)*100 : null,
        yoyPct   : yVal  !==0 ? (aVal-yVal) /Math.abs(yVal) *100 : null
      };
    });
    result.rows.push({ id: m.id, label: m.label, fmt: m.fmt, cols: cols });
  });

  return result;
}

// ══════════════════════════════════════════════════════════════
//  Waterfall
// ══════════════════════════════════════════════════════════════
// Ajustar keys si los valores de 'producto' en el spreadsheet difieren
var WF_PROD_DEFS = [
  { label:'Flights', key:'flights'  },
  { label:'Hotels',  key:'hotels'   },
  { label:'Packs',   key:'packages general' }
];

function computeWf_(p, actMap, rrMap, budMap, actPrevMap, fcMap) {
  var lobKey = (p.lob && WF_GROUPS_BY_LOB[p.lob]) ? p.lob : 'all';
  var GROUPS = WF_GROUPS_BY_LOB[lobKey];
  var CTRY_GROUPS = GROUPS.filter(function(g){ return !g.paisMultiFilter; });

  var METRICS = [
    { id:'gb', n3:'gross bookings', label:'Gross Bookings'    },
    { id:'nr', n3:'net revenue',    label:'Net Revenues'      },
    { id:'oc', n3:null,             label:'Op. Contribution'  }
  ];

  var yoyFilter = Object.assign({}, p);
  if (p.desde) yoyFilter.desde = shiftYear_(p.desde,-1);
  if (p.hasta) yoyFilter.hasta = shiftYear_(p.hasta,-1);

  var pWithCanal = (p.canal && p.canal !== 'all') ? Object.assign({}, p) : p;
  var lyMap = actPrevMap || actMap;

  // ── Pre-computar todas las queries UNA SOLA VEZ (independiente de métrica) ──
  var _agg_total = {
    bl:  blendedFromMaps_(actMap, rrMap, budMap, pWithCanal, null),
    bud: queryMap_(budMap,        pWithCanal, null, p.desde,        p.hasta),
    rr:  queryMap_(rrMap,         pWithCanal, null, p.desde,        p.hasta),
    fc:  queryMap_(fcMap || budMap, pWithCanal, null, p.desde,      p.hasta),
    yoy: queryMap_(lyMap,         yoyFilter,   null, yoyFilter.desde, yoyFilter.hasta)
  };

  var _agg_groups = GROUPS.map(function(g) {
    var gf = {
      paisFilter:      g.paisFilter      || null,
      paisExclude:     g.paisExclude     || null,
      paisMultiFilter: g.paisMultiFilter || null,
      canalFilter:     (p.canal && p.canal !== 'all') ? p.canal : null,
      lobFilter:       null
    };
    return {
      label: g.label,
      bl:  blendedFromMaps_(actMap, rrMap, budMap, pWithCanal, gf),
      bud: queryMap_(budMap,          pWithCanal, gf, p.desde,        p.hasta),
      rr:  queryMap_(rrMap,           pWithCanal, gf, p.desde,        p.hasta),
      fc:  queryMap_(fcMap || budMap, pWithCanal, gf, p.desde,        p.hasta),
      yoy: queryMap_(lyMap,           yoyFilter,  gf, yoyFilter.desde, yoyFilter.hasta)
    };
  });

  var _agg_ctry_prod = CTRY_GROUPS.map(function(g) {
    var gf = {
      paisFilter:      g.paisFilter  || null,
      paisExclude:     g.paisExclude || null,
      paisMultiFilter: null,
      canalFilter:     (p.canal && p.canal !== 'all') ? p.canal : null,
      lobFilter:       null
    };
    return {
      label: g.label,
      prods: WF_PROD_DEFS.map(function(pd) {
        var pf = Object.assign({}, pWithCanal, { producto: pd.key });
        var yf = Object.assign({}, yoyFilter,  { producto: pd.key });
        return {
          label: pd.label,
          bl:  blendedFromMaps_(actMap, rrMap, budMap, pf, gf),
          bud: queryMap_(budMap, pf, gf, p.desde,        p.hasta),
          yoy: queryMap_(lyMap,  yf, gf, yoyFilter.desde, yoyFilter.hasta)
        };
      })
    };
  });

  // ── Extraer valores por métrica (sin más queries al mapa) ──
  var result = { groups: GROUPS.map(function(g){return g.label;}), metrics:[] };

  METRICS.forEach(function(m) {
    function val(agg) { return m.n3 ? (agg[m.n3]||0) : calcOC(agg); }

    var blendTotal = val(_agg_total.bl);
    var budTotal   = val(_agg_total.bud);
    var rrTotal    = val(_agg_total.rr);
    var fcTotal    = val(_agg_total.fc);
    var yoyAllVal  = val(_agg_total.yoy);

    var byGroup = _agg_groups.map(function(a) {
      var blVal = val(a.bl),  buVal = val(a.bud), rrVal = val(a.rr),
          fcVal = val(a.fc),  yyVal = val(a.yoy);
      return {
        label:    a.label,
        baseline: blVal,
        budget:   buVal,
        runRate:  rrVal,
        forecast: fcVal,
        delta:    blVal - buVal,
        baseYoY:  yyVal!==0 ? (blVal-yyVal)/Math.abs(yyVal)*100 : null,
        _yoyAbs:  yyVal
      };
    });

    var byGroupMap = {};
    byGroup.forEach(function(g){ byGroupMap[g.label] = g; });

    var byCountryProd = _agg_ctry_prod.map(function(ctry) {
      var grp    = byGroupMap[ctry.label] || {};
      var ctryBl = grp.baseline || 0;
      var ctryBu = grp.budget   || 0;
      var ctryYY = grp._yoyAbs  || 0;
      var prodRows = ctry.prods.map(function(pa) {
        return {
          label: pa.label,
          bl: val(pa.bl),
          bu: val(pa.bud),
          yy: val(pa.yoy)
        };
      });
      var sBl = prodRows.reduce(function(s,r){return s+r.bl;},0);
      var sBu = prodRows.reduce(function(s,r){return s+r.bu;},0);
      var sYY = prodRows.reduce(function(s,r){return s+r.yy;},0);
      prodRows.push({ label:'ONA', bl:ctryBl-sBl, bu:ctryBu-sBu, yy:ctryYY-sYY });
      return { label:ctry.label, bl:ctryBl, bu:ctryBu, yy:ctryYY, prods:prodRows };
    });

    // Fila Total
    var totProdRows = WF_PROD_DEFS.map(function(pd, pi) {
      return {
        label: pd.label,
        bl: byCountryProd.reduce(function(s,c){return s+c.prods[pi].bl;},0),
        bu: byCountryProd.reduce(function(s,c){return s+c.prods[pi].bu;},0),
        yy: byCountryProd.reduce(function(s,c){return s+c.prods[pi].yy;},0)
      };
    });
    var sProdBl = totProdRows.reduce(function(s,r){return s+r.bl;},0);
    var sProdBu = totProdRows.reduce(function(s,r){return s+r.bu;},0);
    var sProdYY = totProdRows.reduce(function(s,r){return s+r.yy;},0);
    totProdRows.push({ label:'ONA', bl:blendTotal-sProdBl, bu:budTotal-sProdBu, yy:yoyAllVal-sProdYY });
    byCountryProd.push({ label:'Total', bl:blendTotal, bu:budTotal, yy:yoyAllVal, prods:totProdRows });

    result.metrics.push({
      id:             m.id,
      label:          m.label,
      baselineTotal:  blendTotal,
      budgetTotal:    budTotal,
      runRateTotal:   rrTotal,
      forecastTotal:  fcTotal,
      lyTotal:        yoyAllVal,
      totalYoY:       yoyAllVal!==0 ? (blendTotal-yoyAllVal)/Math.abs(yoyAllVal)*100 : null,
      byGroup:        byGroup,
      byCountryProd:  byCountryProd
    });
  });
  return result;
}

function computeOcConceptWf_(p, actManMap, rrManMap, budManMap, lyManMap) {
  var pWithCanal = (p.canal && p.canal !== 'all') ? Object.assign({}, p) : p;
  var yoyFilter  = Object.assign({}, pWithCanal);
  if (p.desde) yoyFilter.desde = shiftYear_(p.desde, -1);
  if (p.hasta)  yoyFilter.hasta  = shiftYear_(p.hasta,  -1);

  var blended = blendedFromMaps_(actManMap, rrManMap, budManMap, pWithCanal, null);
  var bud     = queryMap_(budManMap, pWithCanal, null, p.desde,        p.hasta);
  var rr      = queryMap_(rrManMap,  pWithCanal, null, p.desde,        p.hasta);
  var ly      = lyManMap ? queryMap_(lyManMap, yoyFilter, null, yoyFilter.desde, yoyFilter.hasta) : {};

  // Detail maps (concept slot = "mv¶n2")
  var actDet  = { map: actManMap.detailMap, lastYm: actManMap.lastYm };
  var rrDet   = { map: rrManMap.detailMap,  lastYm: rrManMap.lastYm };
  var budDet  = { map: budManMap.detailMap, lastYm: budManMap.lastYm };
  var lyDet   = lyManMap ? { map: lyManMap.detailMap, lastYm: lyManMap.lastYm } : null;
  var blendedDet = blendedFromMaps_(actDet, rrDet, budDet, pWithCanal, null);
  var budDetQ    = queryMap_(budDet, pWithCanal, null, p.desde,        p.hasta);
  var rrDetQ     = queryMap_(rrDet,  pWithCanal, null, p.desde,        p.hasta);
  var lyDetQ     = lyDet ? queryMap_(lyDet, yoyFilter, null, yoyFilter.desde, yoyFilter.hasta) : {};

  var conceptSet = {};
  [blended, bud, rr].forEach(function(obj) {
    Object.keys(obj).forEach(function(k) { if (k) conceptSet[k] = true; });
  });

  var baseTotal = 0, budTotal = 0, rrTotal = 0, lyTotal = 0;
  var concepts = Object.keys(conceptSet).map(function(mv) {
    var aVal = blended[mv] || 0;
    var bVal = bud[mv]     || 0;
    var rVal = rr[mv]      || 0;
    var lVal = ly[mv]      || 0;
    baseTotal += aVal;
    budTotal  += bVal;
    rrTotal   += rVal;
    lyTotal   += lVal;

    // Build components: detail keys that start with "mv¶"
    var prefix = mv + '¶';
    var compKeys = Object.keys(blendedDet).filter(function(k){ return k.indexOf(prefix) === 0; });
    var comps = compKeys.map(function(k) {
      var n3label = k.slice(prefix.length);
      var cA = blendedDet[k] || 0, cB = budDetQ[k] || 0, cR = rrDetQ[k] || 0, cL = lyDetQ[k] || 0;
      return { label: n3label.charAt(0).toUpperCase()+n3label.slice(1),
               baseline: cA, budget: cB, runRate: cR, lastYear: cL,
               deltaVsBud: cA-cB, deltaVsRR: cA-cR, deltaVsLY: cA-cL };
    });
    comps.sort(function(a,b){ return Math.abs(b.deltaVsBud)-Math.abs(a.deltaVsBud); });

    return { label: mv, baseline: aVal, budget: bVal, runRate: rVal, lastYear: lVal,
             deltaVsBud: aVal-bVal, deltaVsRR: aVal-rVal, deltaVsLY: aVal-lVal, components: comps };
  });

  return { baseTotal: baseTotal, budTotal: budTotal, rrTotal: rrTotal, lyTotal: lyTotal, concepts: concepts };
}

var _NR_BRIDGE_GROUPS_ = [
  { label: 'Up front + Cust. fees',          pats: ['up front', 'customer fee'] },
  { label: 'Back end + Other inc. + Media',  pats: ['back end', 'other incentive', 'media'] },
  { label: 'Fee SaaS',                       pats: ['outsourced'] },
  { label: 'Revenue taxes',                  pats: ['revenue tax', 'tax'] },
  { label: 'Cancellations',                  pats: ['cancellat'] }
];

function computeNRBridgeWf_(p, actNrN2Map, rrNrN2Map, budNrN2Map, lyNrN2Map) {
  var pWithCanal = (p.canal && p.canal !== 'all') ? Object.assign({}, p) : p;
  var yoyFilter  = Object.assign({}, pWithCanal);
  if (p.desde) yoyFilter.desde = shiftYear_(p.desde, -1);
  if (p.hasta)  yoyFilter.hasta  = shiftYear_(p.hasta,  -1);

  var blended = blendedFromMaps_(actNrN2Map, rrNrN2Map, budNrN2Map, pWithCanal, null);
  var bud     = queryMap_(budNrN2Map, pWithCanal, null, p.desde,        p.hasta);
  var rr      = queryMap_(rrNrN2Map,  pWithCanal, null, p.desde,        p.hasta);
  var ly      = lyNrN2Map ? queryMap_(lyNrN2Map, yoyFilter, null, yoyFilter.desde, yoyFilter.hasta) : {};

  var allKeys = {};
  [blended, bud, rr].forEach(function(obj){ Object.keys(obj).forEach(function(k){ allKeys[k]=true; }); });

  // Match the 5 defined groups
  var groupedKeys = {};
  var groups = _NR_BRIDGE_GROUPS_.map(function(g) {
    var aVal=0, bVal=0, rVal=0, lVal=0, comps=[];
    Object.keys(allKeys).forEach(function(k){
      if (g.pats.some(function(pat){ return k.indexOf(pat)>=0; })) {
        var kA=blended[k]||0, kB=bud[k]||0, kR=rr[k]||0, kL=ly[k]||0;
        aVal+=kA; bVal+=kB; rVal+=kR; lVal+=kL;
        comps.push({ label:k.charAt(0).toUpperCase()+k.slice(1),
                     baseline:kA, budget:kB, runRate:kR, lastYear:kL,
                     deltaVsBud:kA-kB, deltaVsRR:kA-kR, deltaVsLY:kA-kL });
        groupedKeys[k]=true;
      }
    });
    return { label:g.label, baseline:aVal, budget:bVal, runRate:rVal, lastYear:lVal,
             deltaVsBud:aVal-bVal, deltaVsRR:aVal-rVal, deltaVsLY:aVal-lVal, components:comps };
  });

  // Catch-all: breakage + anything unmatched → "Breakage + Otros"
  var oA=0, oB=0, oR=0, oL=0, oComps=[];
  Object.keys(allKeys).forEach(function(k){
    if (!groupedKeys[k]){
      var kA=blended[k]||0, kB=bud[k]||0, kR=rr[k]||0, kL=ly[k]||0;
      oA+=kA; oB+=kB; oR+=kR; oL+=kL;
      oComps.push({ label:k.charAt(0).toUpperCase()+k.slice(1),
                    baseline:kA, budget:kB, runRate:kR, lastYear:kL,
                    deltaVsBud:kA-kB, deltaVsRR:kA-kR, deltaVsLY:kA-kL });
    }
  });
  groups.push({ label:'Breakage + Otros', baseline:oA, budget:oB, runRate:oR, lastYear:oL,
                deltaVsBud:oA-oB, deltaVsRR:oA-oR, deltaVsLY:oA-oL, components:oComps });

  var baseTotal=Object.keys(blended).reduce(function(s,k){return s+(blended[k]||0);},0);
  var budTotal =Object.keys(bud).reduce(function(s,k){return s+(bud[k]||0);},0);
  var rrTotal  =Object.keys(rr).reduce(function(s,k){return s+(rr[k]||0);},0);
  var lyTotal  =Object.keys(ly).reduce(function(s,k){ return s+(ly[k]||0); },0);

  return { baseTotal:baseTotal, budTotal:budTotal, rrTotal:rrTotal, lyTotal:lyTotal, groups:groups };
}

// ══════════════════════════════════════════════════════════════
//  PxQ / PxQxM — Palancas analysis (B2B + B2B2C)
// ══════════════════════════════════════════════════════════════

var _PALANCAS_GROUPS_ = [
  { id:'upfront',   label:'Up front incentives',        pats:['up front'] },
  { id:'custfees',  label:'Customer fees & charges',    pats:['customer fee'] },
  { id:'instalm',   label:'Cost of installments',       pats:['installment'] },
  { id:'cc',        label:'Credit card processing',     pats:['credit card'] },
  { id:'costsales', label:'Cost of sales as principal', pats:['cost of sales','as principal'] },
  { id:'3pcomm',    label:'3rd party commissions',      pats:['commission'] }
];

var _HISPA_CHILDREN_ = [
  { label:'Argentina', paisFilter:'argentina' },
  { label:'Chile',     paisFilter:'chile'     },
  { label:'Colombia',  paisFilter:'colombia'  },
  { label:'Peru',      paisFilter:'peru'      },
  { label:'Ecuador',   paisFilter:'ecuador'   }
];

var _PALANCAS_CTRY_GROUPS_ = {
  'b2b': [
    { label:'Brasil',          paisFilter:'brasil',          paisExclude:null },
    { label:'Mexico',          paisFilter:'mexico',          paisExclude:null },
    { label:'Globales', paisFilter:'other countries', paisExclude:null },
    { label:'Hispa',           paisFilter:null, paisExclude:['brasil','mexico','other countries','ops','rg','ops + rg'], children:_HISPA_CHILDREN_ }
  ],
  'b2b2c': [
    { label:'Brasil', paisFilter:'brasil', paisExclude:null },
    { label:'Mexico', paisFilter:'mexico', paisExclude:null },
    { label:'Hispa',  paisFilter:null, paisExclude:['brasil','mexico','ops','rg','ops + rg'], children:_HISPA_CHILDREN_ }
  ]
};

// Mapeo dinámico palanca → P&L N3 dominante (escaneando las claves "n2¶n3" del mapa)
function _palancaN3_(palMapDatas) {
  var acc = _PALANCAS_GROUPS_.map(function(){ return {}; });
  palMapDatas.forEach(function(pmd){
    if (!pmd || !pmd.map) return;
    Object.keys(pmd.map).forEach(function(key){
      var parts = key.split('§');
      var concept = parts[4] || '';
      var sp = concept.split('¶'), n2 = sp[0]||'', n3 = sp[1]||'';
      _PALANCAS_GROUPS_.forEach(function(pg,i){
        if (pg.pats.some(function(pt){ return n2.indexOf(pt) >= 0; }))
          acc[i][n3] = (acc[i][n3]||0) + Math.abs(pmd.map[key]||0);
      });
    });
  });
  return acc.map(function(byn3){
    var best='', bestv=-1;
    Object.keys(byn3).forEach(function(n3){ if (byn3[n3] > bestv){ bestv=byn3[n3]; best=n3; } });
    return best;
  });
}

// Productos del PxQ — Packs filtra por "packages general" (nombre real en la base)
var _PXQ_PROD_DEFS_ = [
  { label:'Flights', key:'flights'           },
  { label:'Hotels',  key:'hotels'            },
  { label:'Packs',   key:'packages general'  }
];

function buildPalancasMap_(rows) {
  var map = {}, lastYm = '';
  rows.forEach(function(r) {
    if (!r['fecha']) return;
    var mv = String(r['p&l managerial view']||'').trim().toLowerCase();
    if (mv !== 'palancas') return;
    var n2 = String(r['p&l n2']||'').trim().toLowerCase();
    if (!n2) return;
    var n3 = String(r['p&l n3']||'').trim().toLowerCase();
    var d   = new Date(r['fecha']);
    var ym  = d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
    var lob  = String(r['lob']     ||'').trim().toLowerCase();
    var can  = _normCanal_(lob, String(r['canal']   ||'').trim().toLowerCase());
    var pai  = String(r['pais']    ||'').trim().toLowerCase();
    pai = _PAIS_VALUE_NORM_[pai] || pai;
    var prod = String(r['producto']||'').trim().toLowerCase();
    if (ym > lastYm) lastYm = ym;
    // El "concepto" combina n2 y n3 con '¶' para que queryMap_ siga viendo 6 partes '§'.
    var key  = lob+'§'+can+'§'+pai+'§'+prod+'§'+(n2+'¶'+n3)+'§'+ym;
    map[key] = (map[key]||0) + (r['monto usd']||0);
  });
  return { map: map, lastYm: lastYm };
}

// PxQ rediseñado: por país → bloques B2B, B2B2C y consolidado (B2B+B2B2C = suma de efectos).
// Cada bloque trae 2 matrices concepto×producto:
//   · profitGB (efecto VOLUMEN) = ΔGB × %GB_goal
//   · margin   (efecto PRECIO)  = Δ%GB × GB_new
// Goal = Budget (referencia). Nuevo = Actuals+RunRate (blended). profitGB + margin = Δ total exacto.
function computePxQ_(p, actMap, rrMap, budMap, actPalMap, rrPalMap, budPalMap) {
  var desde = p.desde || '2020-01';
  var hasta = p.hasta || '2030-12';
  var nc = _PALANCAS_GROUPS_.length;
  var prodLabels = _PXQ_PROD_DEFS_.map(function(d){ return d.label; }).concat(['ONA']);
  var np = prodLabels.length;
  var onaIdx = np - 1;
  var lobsToRun = (p.lob && p.lob !== 'all') ? [p.lob] : ['b2b','b2b2c'];

  function palAmts(palObj) {
    return _PALANCAS_GROUPS_.map(function(pg) {
      var tot = 0;
      Object.keys(palObj).forEach(function(k) {
        var n2 = k.split('¶')[0];  // la clave es "n2¶n3"
        if (pg.pats.some(function(pt){ return n2.indexOf(pt) >= 0; })) tot += palObj[k] || 0;
      });
      return tot;
    });
  }

  // Valores crudos por producto: gbNew/gbGoal (por producto) y palNew/palGoal (palanca×producto)
  function rawBlock(lobN, gf) {
    var lobCanal = (lobN === 'b2b2c') ? 'all' : (p.canal || 'all');
    var baseF = { lob:lobN, pais:p.pais, canal:lobCanal, producto:p.producto, desde:desde, hasta:hasta };
    var gbNew = new Array(np), gbGoal = new Array(np);
    var palNew = [], palGoal = [];
    for (var i=0;i<nc;i++){ palNew.push(new Array(np)); palGoal.push(new Array(np)); }
    var sumGbNew=0, sumGbGoal=0, sumPalNew=[], sumPalGoal=[];
    for (var i=0;i<nc;i++){ sumPalNew.push(0); sumPalGoal.push(0); }

    _PXQ_PROD_DEFS_.forEach(function(pd, pi) {
      var pf = Object.assign({}, baseF, { producto: pd.key });
      var gN = (blendedFromMaps_(actMap, rrMap, budMap, pf, gf)['gross bookings']) || 0;
      var gG = (queryMap_(budMap, pf, gf, desde, hasta)['gross bookings']) || 0;
      var pN = palAmts(blendedFromMaps_(actPalMap, rrPalMap, budPalMap, pf, gf));
      var pG = palAmts(queryMap_(budPalMap, pf, gf, desde, hasta));
      gbNew[pi]=gN; gbGoal[pi]=gG; sumGbNew+=gN; sumGbGoal+=gG;
      for (var i=0;i<nc;i++){ palNew[i][pi]=pN[i]; palGoal[i][pi]=pG[i]; sumPalNew[i]+=pN[i]; sumPalGoal[i]+=pG[i]; }
    });

    // ONA = total país/LOB − suma de productos conocidos
    var totN  = (blendedFromMaps_(actMap, rrMap, budMap, baseF, gf)['gross bookings']) || 0;
    var totG  = (queryMap_(budMap, baseF, gf, desde, hasta)['gross bookings']) || 0;
    var totPN = palAmts(blendedFromMaps_(actPalMap, rrPalMap, budPalMap, baseF, gf));
    var totPG = palAmts(queryMap_(budPalMap, baseF, gf, desde, hasta));
    gbNew[onaIdx]=totN-sumGbNew; gbGoal[onaIdx]=totG-sumGbGoal;
    for (var i=0;i<nc;i++){ palNew[i][onaIdx]=totPN[i]-sumPalNew[i]; palGoal[i][onaIdx]=totPG[i]-sumPalGoal[i]; }

    return { gbNew:gbNew, gbGoal:gbGoal, palNew:palNew, palGoal:palGoal };
  }

  // De crudo → matrices de efecto (profitGB = volumen, margin = precio)
  function effects(raw) {
    var profitGB = [], margin = [];
    var dGB = raw.gbNew.map(function(v,i){ return v - raw.gbGoal[i]; });
    for (var i=0;i<nc;i++){
      var pgRow=new Array(np), mRow=new Array(np);
      for (var pi=0;pi<np;pi++){
        var gN=raw.gbNew[pi], gG=raw.gbGoal[pi];
        var pctG = gG ? raw.palGoal[i][pi]/gG : 0;
        var pctN = gN ? raw.palNew[i][pi]/gN  : 0;
        pgRow[pi] = dGB[pi] * pctG;          // VOLUMEN: ΔGB × %GB goal
        mRow[pi]  = (pctN - pctG) * gN;      // PRECIO:  Δ%GB × GB nuevo
      }
      profitGB.push(pgRow); margin.push(mRow);
    }
    return { profitGB:profitGB, margin:margin, dGB:dGB, gbNew:raw.gbNew };
  }

  // Suma celda a celda de dos efectos (para consolidado B2B+B2B2C)
  function sumEffects(a, b) {
    if (!a) return b; if (!b) return a;
    var pg=[], mg=[], dGB=new Array(np), gbNew=new Array(np);
    for (var pi=0;pi<np;pi++){ dGB[pi]=a.dGB[pi]+b.dGB[pi]; gbNew[pi]=a.gbNew[pi]+b.gbNew[pi]; }
    for (var i=0;i<nc;i++){
      var r1=new Array(np), r2=new Array(np);
      for (var pi=0;pi<np;pi++){ r1[pi]=a.profitGB[i][pi]+b.profitGB[i][pi]; r2[pi]=a.margin[i][pi]+b.margin[i][pi]; }
      pg.push(r1); mg.push(r2);
    }
    return { profitGB:pg, margin:mg, dGB:dGB, gbNew:gbNew };
  }

  function sum(arr){ return arr.reduce(function(s,v){return s+v;},0); }

  // Mapeo palanca → N3 (dominante), de los datos
  var palN3 = _palancaN3_([budPalMap, actPalMap, rrPalMap]);
  var _N3_ORDER_ = ['net revenue','cost of revenue','sales & marketing'];
  var _N3_LBL_   = { 'net revenue':'Net Revenue', 'cost of revenue':'Cost of Revenue', 'sales & marketing':'Sales & Marketing' };

  // Resume un país: conceptos (palanca) + totales. childList opcional (sub-países).
  function packCountry(clabel, eff, childList) {
    var concepts = _PALANCAS_GROUPS_.map(function(pg,i){
      var pgT = sum(eff.profitGB[i]);
      var mgT = sum(eff.margin[i]);
      return { label:pg.label, profitGB:pgT, margin:mgT, delta:pgT+mgT };
    });
    var tP = sum(concepts.map(function(c){return c.profitGB;}));
    var tM = sum(concepts.map(function(c){return c.margin;}));
    var node = { country:clabel, gbDelta:sum(eff.dGB), concepts:concepts,
                 totProfitGB:tP, totMargin:tM, totDelta:tP+tM };
    if (childList && childList.length)
      node.children = childList.map(function(ch){ return packCountry(ch.label, ch.eff, null); });
    return node;
  }
  // Total LOB = suma de países; byN3 = palancas agrupadas por su N3
  function packLob(label, countries) {
    var tP = sum(countries.map(function(c){return c.totProfitGB;}));
    var tM = sum(countries.map(function(c){return c.totMargin;}));
    // total LOB por palanca (suma sobre países) → agrupar por N3
    var byN3map = {};
    _PALANCAS_GROUPS_.forEach(function(pg,i){
      var pgi = sum(countries.map(function(c){return c.concepts[i].profitGB;}));
      var mgi = sum(countries.map(function(c){return c.concepts[i].margin;}));
      var n3 = palN3[i] || '';
      if (!byN3map[n3]) byN3map[n3] = { profitGB:0, margin:0 };
      byN3map[n3].profitGB += pgi; byN3map[n3].margin += mgi;
    });
    var byN3 = [];
    _N3_ORDER_.forEach(function(n3){
      if (byN3map[n3]) { var o=byN3map[n3]; byN3.push({ label:_N3_LBL_[n3], profitGB:o.profitGB, margin:o.margin, delta:o.profitGB+o.margin }); delete byN3map[n3]; }
    });
    Object.keys(byN3map).forEach(function(n3){
      var o=byN3map[n3]; var lbl = n3 ? (n3.charAt(0).toUpperCase()+n3.slice(1)) : 'Otros';
      byN3.push({ label:lbl, profitGB:o.profitGB, margin:o.margin, delta:o.profitGB+o.margin });
    });
    return { lob:label, countries:countries, byN3:byN3,
             gbDelta: sum(countries.map(function(c){return c.gbDelta;})),
             totProfitGB:tP, totMargin:tM, totDelta:tP+tM };
  }
  function lobLabel(lobN){ return lobN==='b2b' ? 'B2B' : (lobN==='b2b2c' ? 'B2B2C' : lobN); }

  // Calcular efectos por (país, LOB), incluyendo sub-países (children). Guardamos el raw para PxQxM.
  var effByCountry = {}, countryOrder = [];
  lobsToRun.forEach(function(lobN){
    (_PALANCAS_CTRY_GROUPS_[lobN] || []).forEach(function(cg){
      var gf = { paisFilter:cg.paisFilter, paisExclude:cg.paisExclude, paisMultiFilter:null };
      var raw = rawBlock(lobN, gf);
      var children = null;
      if (cg.children) children = cg.children.map(function(ch){
        var cgf = { paisFilter:ch.paisFilter, paisExclude:ch.paisExclude||null, paisMultiFilter:null };
        return { label:ch.label, eff:effects(rawBlock(lobN, cgf)) };
      });
      if (!effByCountry[cg.label]) { effByCountry[cg.label] = {}; countryOrder.push(cg.label); }
      effByCountry[cg.label][lobN] = { eff:effects(raw), raw:raw, children:children };
    });
  });

  // ── PxQxM en %GB: descompone Δ%GB de cada palanca en Precio · Mix · Interacción ──
  // Segmento = país × producto. %GB = Σ(wᵢ·rᵢ); wᵢ = peso GB del segmento, rᵢ = palanca/GB del segmento.
  function rawToSegments(raw, country) {
    var segs = [];
    for (var pi=0; pi<np; pi++){
      segs.push({
        country: country, product: prodLabels[pi],
        gbGoal: raw.gbGoal[pi], gbNew: raw.gbNew[pi],
        palGoal: _PALANCAS_GROUPS_.map(function(_,k){ return raw.palGoal[k][pi]; }),
        palNew:  _PALANCAS_GROUPS_.map(function(_,k){ return raw.palNew[k][pi]; })
      });
    }
    return segs;
  }
  // Para cada palanca: total Δ%GB + P/M/I, y desglose país→producto (contribuciones aditivas)
  function pxqmForSegments(segs) {
    var sumGbGoal = sum(segs.map(function(s){return s.gbGoal;}));
    var sumGbNew  = sum(segs.map(function(s){return s.gbNew;}));
    return _PALANCAS_GROUPS_.map(function(pg, pi){
      var sumPalGoal=0, sumPalNew=0, P=0, M=0, I=0;
      segs.forEach(function(s){ sumPalGoal += s.palGoal[pi]; sumPalNew += s.palNew[pi]; });
      var pctGoal = sumGbGoal ? sumPalGoal/sumGbGoal : 0;
      var pctNew  = sumGbNew  ? sumPalNew /sumGbNew  : 0;
      var byCtry = {}, ctryOrder = [];
      segs.forEach(function(s){
        var wG = sumGbGoal ? s.gbGoal/sumGbGoal : 0;
        var wN = sumGbNew  ? s.gbNew /sumGbNew  : 0;
        var rG = s.gbGoal ? s.palGoal[pi]/s.gbGoal : 0;
        var rN = s.gbNew  ? s.palNew[pi] /s.gbNew  : 0;
        var p = wG*(rN-rG), m = rG*(wN-wG), it = (wN-wG)*(rN-rG);
        P += p; M += m; I += it;
        if (!byCtry[s.country]) { byCtry[s.country] = { price:0, mix:0, interaction:0, products:[] }; ctryOrder.push(s.country); }
        var bc = byCtry[s.country];
        bc.price += p; bc.mix += m; bc.interaction += it;
        bc.products.push({ product:s.product, price:p, mix:m, interaction:it, dPct:p+m+it });
      });
      var countries = ctryOrder.map(function(c){
        var bc = byCtry[c];
        return { country:c, price:bc.price, mix:bc.mix, interaction:bc.interaction,
                 dPct:bc.price+bc.mix+bc.interaction, products:bc.products };
      });
      return { label:pg.label, pctGoal:pctGoal, pctNew:pctNew, dPct:pctNew-pctGoal,
               price:P, mix:M, interaction:I, countries:countries };
    });
  }

  // Resumen del PxQxM: subtotales por N3 (net rev / cost of rev / S&M) y total palancas.
  // Como cada componente (Δ%GB, Precio, Mix, Interac) es aditivo, los subtotales = suma de palancas.
  function pxqmSummary(rows) {
    function blank(){ return { pctGoal:0, pctNew:0, dPct:0, price:0, mix:0, interaction:0 }; }
    function add(a, r){ a.pctGoal+=r.pctGoal; a.pctNew+=r.pctNew; a.dPct+=r.dPct; a.price+=r.price; a.mix+=r.mix; a.interaction+=r.interaction; }
    var total = blank(), n3acc = {};
    rows.forEach(function(r, i){
      add(total, r);
      var n3 = palN3[i] || '';
      if (!n3acc[n3]) n3acc[n3] = blank();
      add(n3acc[n3], r);
    });
    var byN3 = [];
    _N3_ORDER_.forEach(function(n3){ if (n3acc[n3]) { n3acc[n3].label = _N3_LBL_[n3]; byN3.push(n3acc[n3]); delete n3acc[n3]; } });
    Object.keys(n3acc).forEach(function(n3){ n3acc[n3].label = n3 ? (n3.charAt(0).toUpperCase()+n3.slice(1)) : 'Otros'; byN3.push(n3acc[n3]); });
    total.label = 'TOTAL PALANCAS';
    return { byN3:byN3, total:total };
  }

  var pxqmLobs = [];
  lobsToRun.forEach(function(lobN){
    var segs = [];
    (_PALANCAS_CTRY_GROUPS_[lobN] || []).forEach(function(cg){
      segs = segs.concat(rawToSegments(effByCountry[cg.label][lobN].raw, cg.label));
    });
    var rows = pxqmForSegments(segs), summ = pxqmSummary(rows);
    pxqmLobs.push({ lob:lobLabel(lobN), rows:rows, byN3:summ.byN3, total:summ.total });
  });
  if (lobsToRun.length > 1) {
    var segsC = [];
    lobsToRun.forEach(function(lobN){
      (_PALANCAS_CTRY_GROUPS_[lobN] || []).forEach(function(cg){
        segsC = segsC.concat(rawToSegments(effByCountry[cg.label][lobN].raw, cg.label));
      });
    });
    var rowsC = pxqmForSegments(segsC), summC = pxqmSummary(rowsC);
    pxqmLobs.push({ lob:'B2B + B2B2C', rows:rowsC, byN3:summC.byN3, total:summC.total });
  }

  // Salida organizada por LOB → países (→ sub-países) → conceptos
  var lobs = [];
  lobsToRun.forEach(function(lobN){
    var countries = (_PALANCAS_CTRY_GROUPS_[lobN] || []).map(function(cg){
      var rec = effByCountry[cg.label][lobN];
      return packCountry(cg.label, rec.eff, rec.children);
    });
    lobs.push(packLob(lobLabel(lobN), countries));
  });

  // Consolidado B2B+B2B2C = suma de efectos de cada negocio (cada uno con su %GB)
  if (lobsToRun.length > 1) {
    var countriesC = countryOrder.map(function(clabel){
      var consol = null, childMap = {}, childOrder = [];
      lobsToRun.forEach(function(lobN){
        var rec = effByCountry[clabel][lobN];
        if (!rec) return;
        consol = sumEffects(consol, rec.eff);
        if (rec.children) rec.children.forEach(function(ch){
          if (!(ch.label in childMap)) { childMap[ch.label] = null; childOrder.push(ch.label); }
          childMap[ch.label] = sumEffects(childMap[ch.label], ch.eff);
        });
      });
      var childList = childOrder.length ? childOrder.map(function(l){ return { label:l, eff:childMap[l] }; }) : null;
      return packCountry(clabel, consol, childList);
    });
    lobs.push(packLob('B2B + B2B2C', countriesC));
  }

  return { palancas: _PALANCAS_GROUPS_.map(function(g){return g.label;}), lobs: lobs,
           pxqm: { lobs: pxqmLobs } };
}

// ══════════════════════════════════════════════════════════════
//  Evolución mensual (siempre Abr 2025 → último mes disponible)
// ══════════════════════════════════════════════════════════════
function computeEvo_(p, actMap, rrMap, budMap, actPrevMap, fcMap) {
  var METRICS = [
    { id:'gb', n3:'gross bookings', label:'Gross Bookings'   },
    { id:'nr', n3:'net revenue',    label:'Net Revenues'     },
    { id:'oc', n3:null,             label:'Op. Contribution' }
  ];

  var START = '2025-04';

  // Recolectar todos los períodos disponibles desde START
  // actPrevMap cubre FY24/25/26 (meses anteriores a 2026-04); actMap cubre FY27
  var allPeriods = {};
  var mapsToScan = [actMap, rrMap, budMap];
  if (actPrevMap) mapsToScan.push(actPrevMap);
  mapsToScan.forEach(function(md) {
    Object.keys(md.map).forEach(function(key) {
      var ym = key.split('§')[5];
      if (ym >= START) allPeriods[ym] = true;
    });
  });
  var periods = Object.keys(allPeriods).sort();

  // Filtro base sin fechas (las fechas las controla el rango de períodos)
  var baseFilter = { lob: p.lob, pais: p.pais, canal: p.canal, producto: p.producto };

  var result = { periods: periods, metrics: [] };

  METRICS.forEach(function(m) {
    var actByMonth = {}, budByMonth = {}, rrByMonth = {}, fcByMonth = {};
    periods.forEach(function(ym) {
      // Para FY27 (>= 2026-04): actMap = baseline (contiene todo el FY27 blended)
      // Para períodos históricos: actPrevMap
      var actSrc = (ym >= '2026-04') ? actMap : (actPrevMap || actMap);
      var a  = queryMap_(actSrc,           baseFilter, null, ym, ym);
      var b  = queryMap_(budMap,           baseFilter, null, ym, ym);
      var r  = queryMap_(rrMap,            baseFilter, null, ym, ym);
      var fc = queryMap_(fcMap || budMap,  baseFilter, null, ym, ym);
      actByMonth[ym] = m.n3 ? (a[m.n3] ||0) : calcOC(a);
      budByMonth[ym] = m.n3 ? (b[m.n3] ||0) : calcOC(b);
      rrByMonth[ym]  = m.n3 ? (r[m.n3] ||0) : calcOC(r);
      fcByMonth[ym]  = m.n3 ? (fc[m.n3]||0) : calcOC(fc);
    });
    result.metrics.push({
      id:       m.id,
      label:    m.label,
      actuals:  periods.map(function(ym){ return actByMonth[ym]||null; }),
      budget:   periods.map(function(ym){ return budByMonth[ym]||null; }),
      runRate:  periods.map(function(ym){ return rrByMonth[ym] ||null; }),
      forecast: periods.map(function(ym){ return fcByMonth[ym] ||null; })
    });
  });

  // Per-country YoY breakdown (FY27 only, RG excluded)
  var CTRY_EVO_DEFS_ = [
    { label:'Brasil',            gf:{ paisFilter:'brasil',    paisExclude:null } },
    { label:'Mexico',            gf:{ paisFilter:'mexico',    paisExclude:null } },
    { label:'Argentina',         gf:{ paisFilter:'argentina', paisExclude:null } },
    { label:'Rest of Countries', gf:{ paisFilter:null, paisExclude:['brasil','mexico','argentina','rg','ops','ops + rg'] } },
    { label:'RG',                gf:{ paisMultiFilter:['rg','ops','ops + rg'] } }
  ];
  var ctryFilter   = { lob:p.lob, pais:'all', canal:p.canal, producto:p.producto };
  var fy27Periods_ = periods.filter(function(ym){ return ym>='2026-04'&&ym<='2027-03'; });

  result.byCountry  = CTRY_EVO_DEFS_.map(function(cdef) {
    var metData = {};
    METRICS.forEach(function(m) {
      var actArr=[], budArr=[], rrArr=[], lyArr=[];
      fy27Periods_.forEach(function(ym) {
        // Distinguir meses reales vs proyectados para el gráfico (sólido vs punteado)
        var isAct = ym <= LAST_ACTUALS_YM;
        // Para ambos tipos, el valor viene del baseline (actMap = baselineMap)
        var bl   = queryMap_(actMap,          ctryFilter, cdef.gf, ym, ym);
        var b    = queryMap_(budMap,           ctryFilter, cdef.gf, ym, ym);
        var lyYm = (parseInt(ym.split('-')[0])-1)+'-'+ym.split('-')[1];
        var lyA  = queryMap_(actPrevMap||actMap, ctryFilter, cdef.gf, lyYm, lyYm);
        var fn   = function(obj){ return m.n3 ? (obj[m.n3]||0) : calcOC(obj); };
        actArr.push(isAct  ? fn(bl) : null);   // sólido: meses con actuals reales
        rrArr.push (!isAct ? fn(bl) : null);   // punteado: meses proyectados (RR + FC)
        budArr.push(fn(b));
        lyArr.push (fn(lyA));
      });
      metData[m.id] = { actuals:actArr, budget:budArr, runRate:rrArr, lyAct:lyArr };
    });
    return { label:cdef.label, metrics:metData };
  });
  result.ctryPeriods = fy27Periods_;

  return result;
}

// ══════════════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════════════
function nextMonth_(ym) {
  if (!ym) return ym;
  var p=ym.split('-'), y=parseInt(p[0]), m=parseInt(p[1])+1;
  if (m>12){m=1;y++;}
  return y+'-'+String(m).padStart(2,'0');
}

function shiftYear_(ym, delta) {
  if (!ym) return ym;
  var p=ym.split('-');
  return (parseInt(p[0])+delta)+'-'+p[1];
}

// OKR → ver Codigo_OKR.js

// Diagnóstico: muestra lastAct / lastRR y qué fuente usa el blending para un período
function diagBlending() {
  var baseRows = readJson_(JSON_IDS.baseline);
  var rrRows   = readJson_(JSON_IDS.runrate);
  var budRows  = readJson_(JSON_IDS.budget);
  var fcRows   = readJson_(JSON_IDS.forecast);
  var baseMap  = buildMap_(baseRows);
  var rrMap    = buildMap_(rrRows);
  var budMap   = buildMap_(budRows);
  var fcMap    = buildMap_(fcRows);

  Logger.log('=== DIAG BLENDING (JSON sources) ===');
  Logger.log('LAST_ACTUALS_YM: ' + LAST_ACTUALS_YM);
  Logger.log('LAST_RR_YM:      ' + LAST_RR_YM);
  Logger.log('baseline lastYm: ' + baseMap.lastYm);
  Logger.log('runrate  lastYm: ' + rrMap.lastYm);
  Logger.log('budget   lastYm: ' + budMap.lastYm);
  Logger.log('forecast lastYm: ' + fcMap.lastYm);

  // Probar baseline Jul-Sep 2026 para B2B2C
  var tf = { desde:'2026-07', hasta:'2026-09', lob:'b2b2c', pais:'all', canal:'all', producto:'all' };
  var baseDirect = queryMap_(baseMap, tf, null, '2026-07', '2026-09');
  var rrDirect   = queryMap_(rrMap,   tf, null, '2026-07', '2026-09');
  var fcDirect   = queryMap_(fcMap,   tf, null, '2026-07', '2026-09');
  var budDirect  = queryMap_(budMap,  tf, null, '2026-07', '2026-09');
  Logger.log('Baseline Jul-Sep b2b2c: ' + JSON.stringify(baseDirect));
  Logger.log('RunRate Jul-Sep b2b2c:  ' + JSON.stringify(rrDirect));
  Logger.log('Forecast Jul-Sep b2b2c: ' + JSON.stringify(fcDirect));
  Logger.log('Budget Jul-Sep b2b2c:   ' + JSON.stringify(budDirect));
}

// diagOKR → ver Codigo_OKR.js

// (TOQAN AI y NEWS eliminados — migrado a JSON directo)

// ══════════════════════════════════════════════════════════════
//  Marketing & Media Investment (B2B)
// ══════════════════════════════════════════════════════════════

var MKT_FY27_MONTHS = (function() {
  var m = [];
  for (var i=4; i<=12; i++) m.push('2026-'+String(i).padStart(2,'0'));
  for (var i=1; i<=3;  i++) m.push('2027-'+String(i).padStart(2,'0'));
  return m;
})();

var MKT_COUNTRIES = [
  { id:'brasil', label:'Brasil',
    gf:{ lobFilter:'b2b', paisFilter:'brasil',          paisExclude:null } },
  { id:'mexico', label:'Mexico',
    gf:{ lobFilter:'b2b', paisFilter:'mexico',          paisExclude:null } },
  { id:'other',  label:'Globales',
    gf:{ lobFilter:'b2b', paisFilter:'other countries', paisExclude:null } },
  { id:'hispa',  label:'Hispa',
    gf:{ lobFilter:'b2b', paisFilter:null, paisExclude:['brasil','mexico','other countries','ops','rg','ops + rg'] } },
  { id:'total',  label:'Total',
    gf:{ lobFilter:'b2b', paisFilter:null, paisExclude:null } }
];

function computeMarketingData_(baselineN2, budN2, prevN2) {
  var b2bBase = { lob:'b2b', pais:'all', canal:'all', producto:'all' };

  var byCountry = MKT_COUNTRIES.map(function(c) {
    var medAct=[], medBud=[], medLY=[];
    var mktAct=[], mktBud=[], mktLY=[];

    MKT_FY27_MONTHS.forEach(function(ym) {
      var n2Src = baselineN2;   // baseline ya tiene la fuente correcta por mes
      var lyYm  = shiftYear_(ym, -1);

      var dA = queryMap_(n2Src,  b2bBase, c.gf, ym,   ym);
      var dB = queryMap_(budN2,  b2bBase, c.gf, ym,   ym);
      // LY viene de actuals previos (FY26, abr 2025 – mar 2026)
      var dY = queryMap_(prevN2, b2bBase, c.gf, lyYm, lyYm);

      mktAct.push(dA['marketing-direct']     || 0);
      mktBud.push(dB['marketing-direct']     || 0);
      mktLY.push( dY['marketing-direct']     || 0);
      medAct.push(dA['media & other revenue']|| 0);
      medBud.push(dB['media & other revenue']|| 0);
      medLY.push( dY['media & other revenue']|| 0);
    });

    return {
      id: c.id, label: c.label,
      medActual: medAct, medBudget: medBud, medLY: medLY,
      mktActual: mktAct, mktBudget: mktBud, mktLY: mktLY
    };
  });

  return { success:true, months:MKT_FY27_MONTHS, byCountry:byCountry };
}

function getMarketingData() {
  try {
    var sc  = CacheService.getScriptCache();
    var hit = sc.get('mkt_b2b');
    if (hit) { try { return JSON.parse(hit); } catch(e) {} }

    var baseRows = readJson_(JSON_IDS.baseline);
    var budRows  = readJson_(JSON_IDS.budget);
    var prevRows = readJson_(JSON_IDS.ly);
    var baselineN2 = buildN2Map_(baseRows);
    var budN2      = buildN2Map_(budRows);
    var prevN2     = buildN2Map_(prevRows);

    var result = computeMarketingData_(baselineN2, budN2, prevN2);
    try { sc.put('mkt_b2b', JSON.stringify(result), RESULT_CACHE_MAX_S); } catch(e) {}
    return result;
  } catch(e) {
    return { success:false, error:e.message };
  }
}

function getLastSync() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('bitubia_last_sync');
    return raw ? JSON.parse(raw) : { ts: null };
  } catch (e) {
    return { ts: null };
  }
}

// ──────────────────────────────────────────────────────────────

// Diagnóstico: devuelve todos los valores únicos de p&l n2 para LOB=b2b
function debugMktN2Keys() {
  try {
    var rows = readJson_(JSON_IDS.baseline);
    var seen = {};
    rows.forEach(function(r) {
      if (String(r['lob']||'').trim().toLowerCase() !== 'b2b') return;
      var n2 = String(r['p&l n2']||'').trim();
      if (n2) seen[n2] = (seen[n2]||0) + 1;
    });
    var list = Object.keys(seen).sort().map(function(k){ return k + ' ('+seen[k]+')'; });
    return { success:true, keys: list };
  } catch(e) {
    return { success:false, error:e.message };
  }
}

function testGetData() {
  try {
    var result = getAllData({});
    Logger.log('OK — keys: ' + JSON.stringify(Object.keys(result)));
    Logger.log('filters.lastActuals: ' + (result.filters ? result.filters.lastActuals : 'N/A'));
  } catch(e) {
    Logger.log('ERROR: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  Organigrama
// ══════════════════════════════════════════════════════════════
function getOrgData() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Organigrama');
    if (!sheet) return { success: false, error: 'Tab "Organigrama" no encontrada en el spreadsheet.' };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, rows: [] };
    var headers = data[0].map(function(h){ return String(h).trim().toLowerCase(); });
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = {};
      headers.forEach(function(h, j){ row[h] = String(data[i][j] || '').trim(); });
      if (row['n1'] || row['n2'] || row['n3'] || row['n4']) rows.push(row);
    }
    return { success: true, rows: rows };
  } catch(e) {
    return { success: false, error: e.message };
  }
}
