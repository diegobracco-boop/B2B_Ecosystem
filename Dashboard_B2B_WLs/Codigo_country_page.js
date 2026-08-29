// ══════════════════════════════════════════════════════════════
//  Country One Page — Backend
// ══════════════════════════════════════════════════════════════

// Trimestres FY27 — espejado aquí para que preComputeAll pueda pre-warms
var CTRY_QUARTERS = [
  { desde:'2026-04', hasta:'2027-03' },  // FY
  { desde:'2026-04', hasta:'2026-09' },  // H1
  { desde:'2026-10', hasta:'2027-03' },  // H2
  { desde:'2026-04', hasta:'2026-06' },  // Q1
  { desde:'2026-07', hasta:'2026-09' },  // Q2
  { desde:'2026-10', hasta:'2026-12' },  // Q3
  { desde:'2027-01', hasta:'2027-03' }   // Q4
];
var CTRY_PAISES = ['all','Brasil','Mexico','Argentina','other countries','Colombia','Chile','Peru','Ecuador','RG'];

function _ctryPageCacheKey_(pais, desde, hasta, bl) {
  return JSON.stringify({ v:23, ctry:1, pais:pais, desde:desde, hasta:hasta, bl: bl || 'baseline' });
}

// Computa resultado country-page usando mapas ya cargados (lo llaman tanto
// getCountryPageData() como el loop de pre-warming en preComputeAll).
function _computeCountryPageResult_(pais, desde, hasta,
    baseMap, rrMap, budMap, lyMap, fcMap,
    baseManMap, rrManMap, budManMap, lyManMap,
    baseNrN2,   rrNrN2,   budNrN2,  lyNrN2) {

  var pAll   = { lob:'all',   pais:pais, canal:'all', producto:'all', desde:desde, hasta:hasta };
  var pB2b   = { lob:'b2b',   pais:pais, canal:'all', producto:'all', desde:desde, hasta:hasta };
  var pB2b2c = { lob:'b2b2c', pais:pais, canal:'all', producto:'all', desde:desde, hasta:hasta };

  return {
    allData: {
      compPnl: computeCompPnL_(pAll, baseMap, rrMap, budMap, lyMap, fcMap)
    },
    b2bData: {
      ocConceptWf: computeOcConceptWf_(pB2b,   baseManMap, rrManMap, budManMap, lyManMap),
      nrBridgeWf:  computeNRBridgeWf_ (pB2b,   baseNrN2,   rrNrN2,   budNrN2,   lyNrN2)
    },
    b2b2cData: {
      ocConceptWf: computeOcConceptWf_(pB2b2c, baseManMap, rrManMap, budManMap, lyManMap),
      nrBridgeWf:  computeNRBridgeWf_ (pB2b2c, baseNrN2,   rrNrN2,   budNrN2,   lyNrN2)
    }
  };
}

// Llamada del frontend: 1 round-trip en vez de 3 × getAllData()
function getCountryPageData(params) {
  var pais  = (params && params.pais)  || 'all';
  var desde = (params && params.desde) || LAST_ACTUALS_YM;
  var hasta = (params && params.hasta) || LAST_ACTUALS_YM;
  var baselineSource = (params && params.baselineSource) || 'baseline';

  var key    = _ctryPageCacheKey_(pais, desde, hasta, baselineSource);
  var cached = readResultCache_(key);
  if (cached) return cached;

  var baseRows = readJson_(JSON_IDS.baseline);
  var rrRows   = readJson_(JSON_IDS.runrate);
  var budRows  = readJson_(JSON_IDS.budget);
  var fcRows   = readJson_(JSON_IDS.forecast);
  var lyRows   = readJson_(JSON_IDS.ly);

  // Baseline seleccionable (ver getAllData en Codigo.js)
  var blRows = (baselineSource === 'forecast') ? fcRows : baseRows;

  var baseMap    = buildMap_(blRows);
  var rrMap      = buildMap_(rrRows);
  var budMap     = buildMap_(budRows);
  var fcMap      = buildMap_(fcRows);
  var lyMap      = buildMap_(lyRows);
  var baseManMap = buildManMap_(blRows);
  var rrManMap   = buildManMap_(rrRows);
  var budManMap  = buildManMap_(budRows);
  var lyManMap   = buildManMap_(lyRows);
  var baseNrN2   = buildNrN2Map_(blRows);
  var rrNrN2     = buildNrN2Map_(rrRows);
  var budNrN2    = buildNrN2Map_(budRows);
  var lyNrN2     = buildNrN2Map_(lyRows);

  var result = _computeCountryPageResult_(
    pais, desde, hasta,
    baseMap, rrMap, budMap, lyMap, fcMap,
    baseManMap, rrManMap, budManMap, lyManMap,
    baseNrN2,   rrNrN2,   budNrN2,  lyNrN2
  );

  writeResultCache_(key, result);
  return result;
}
