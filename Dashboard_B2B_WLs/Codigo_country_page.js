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
  return JSON.stringify({ v:27, ctry:1, pais:pais, desde:desde, hasta:hasta, bl: bl || 'baseline' });
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
      compPnl: computeCompPnL_(pAll, baseMap, rrMap, budMap, lyMap, fcMap),
      evo:     computeEvo_(pAll, baseMap, rrMap, budMap, lyMap, fcMap)
    },
    b2bData: {
      ocConceptWf: computeOcConceptWf_(pB2b,   baseManMap, rrManMap, budManMap, lyManMap),
      nrBridgeWf:  computeNRBridgeWf_ (pB2b,   baseNrN2,   rrNrN2,   budNrN2,   lyNrN2),
      evo:         computeEvo_(pB2b,   baseMap, rrMap, budMap, lyMap, fcMap)
    },
    b2b2cData: {
      ocConceptWf: computeOcConceptWf_(pB2b2c, baseManMap, rrManMap, budManMap, lyManMap),
      nrBridgeWf:  computeNRBridgeWf_ (pB2b2c, baseNrN2,   rrNrN2,   budNrN2,   lyNrN2),
      evo:         computeEvo_(pB2b2c, baseMap, rrMap, budMap, lyMap, fcMap)
    }
  };
}

// ── Mix B2B canal × producto (contable) ─────────────────────────
// Devuelve GB / NR / OC por combinación canal (may/min) × producto para
// B2B, acumulado en [desde, hasta] (default: FY27 hasta el último mes real).
// Misma fuente/criterio que el resto del contable (calcOC = NR + cost of
// revenue + S&M) para que los ratios coincidan con la sección B2B.
// Pensado para lob_country_one_pager (ratios OC/GB y NR/GB por producto).
function getB2BCanalProductoMix(params) {
  var pais  = (params && params.pais)  || 'all';
  var desde = (params && params.desde) || '2026-04';
  var hasta = (params && params.hasta) || LAST_ACTUALS_YM;

  var key    = JSON.stringify({ v:1, cpMix:1, pais:pais, desde:desde, hasta:hasta });
  var cached = readResultCache_(key);
  if (cached) return cached;

  var baseMap = buildMap_(readJson_(JSON_IDS.baseline));
  var rrMap   = buildMap_(readJson_(JSON_IDS.runrate));
  var budMap  = buildMap_(readJson_(JSON_IDS.budget));

  // Enumerar productos B2B presentes en la data (evita hardcodear la taxonomía)
  var prodSet = {};
  Object.keys(baseMap.map).forEach(function(k) {
    var p = k.split('§');            // lob§canal§pais§producto§n3§ym
    if (p[0] === 'b2b' && p[3] && p[3] !== 'all') prodSet[p[3]] = true;
  });
  var productos = Object.keys(prodSet).sort();

  var CANALS = [{ key:'may', label:'MAY' }, { key:'min', label:'MIN' }];
  var items  = [];
  CANALS.forEach(function(c) {
    productos.forEach(function(prod) {
      var gf  = { lob:'b2b', pais:pais, canal:c.key, producto:prod, desde:desde, hasta:hasta };
      var agg = blendedFromMaps_(baseMap, rrMap, budMap, gf, null);
      var gb  = agg['gross bookings'] || 0;
      var nr  = agg['net revenue']    || 0;
      var oc  = calcOC(agg);
      if (gb || nr || oc) items.push({ canal:c.label, producto:prod, gb:gb, nr:nr, oc:oc });
    });
  });

  var result = { pais:pais, desde:desde, hasta:hasta, lastActuals:LAST_ACTUALS_YM, items:items };
  writeResultCache_(key, result);
  return result;
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
