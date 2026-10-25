// Solo Ownia: se carga en el proyecto del Daily (gasExtras en server/modules.js), después de su
// código, y usa su loadFile_ (misma carpeta de Drive y caché). Apps Script no tiene esta función.
// El JSON lo genera Daily_Dashboard/industry_events_sync.py; lo usa la solapa "Industry events
// tracker" (public/daily-layout.js).
var INDUSTRY_EVENTS_JSON = 'industry_events.json';

function getIndustryEvents() {
  return loadFile_(INDUSTRY_EVENTS_JSON, 'industry_events');
}
