// Solo Ownia: se carga en el proyecto del Hub (gasExtras en server/modules.js), después de su código. Apps Script no tiene esta
// función. Marketing & Media abierto por negocio: HTML (canal min) o API (canal may), para public/hub-marketing.js.
// Misma cuenta que getMarketingData; computeMarketingData_ lee MKT_COUNTRIES, así que se lo llama con cada grupo filtrado por canal.
function getMarketingDataCanal(organic, canal) {
  if (canal !== 'may' && canal !== 'min') return getMarketingData(organic);
  try {
    var orgTarget = organicTargetOf_({ lob: 'b2b', organic: organic });
    var sc = CacheService.getScriptCache();
    var ck = 'mkt_b2b_canal_v1_' + canal + (orgTarget ? '_org3_' + organic : '');
    var hit = sc.get(ck);
    if (hit) { try { return JSON.parse(hit); } catch (e) { /* se recalcula */ } }

    var baseRows = readJson_(JSON_IDS.baseline);
    if (orgTarget) baseRows = applyOrganic_(baseRows, orgTarget).rows;
    var fcRows = readJson_(JSON_IDS.forecast);
    if (orgTarget && organic === 'forecast') fcRows = convertGoalOrganic_(fcRows).rows;

    var all = MKT_COUNTRIES, result;
    MKT_COUNTRIES = all.map(function (c) {
      return Object.assign({}, c, { gf: Object.assign({}, c.gf, { canalFilter: canal }) });
    });
    try {
      result = computeMarketingData_(buildN2Map_(baseRows), buildN2Map_(readJson_(JSON_IDS.budget)), buildN2Map_(readJson_(JSON_IDS.runrate)),
        buildN2Map_(fcRows), buildN2Map_(readJson_(JSON_IDS.ly)));
    } finally {
      MKT_COUNTRIES = all;
    }
    if (orgTarget) result.organic = { target: orgTarget };
    result.canal = canal;
    try { sc.put(ck, JSON.stringify(result), RESULT_CACHE_MAX_S); } catch (e) { /* sin caché: se recalcula */ }
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
}
