// Solo Ownia: se carga en el proyecto del Daily (gasExtras en server/modules.js), después de su
// código, y usa su loadFile_ (misma carpeta de Drive y caché). Apps Script no tiene esta función.
// El JSON (Budget B2C por semana ISO × país) lo genera Daily_Dashboard/b2c_budget_sync.py; lo usa la
// sección "Weekly · vs B2C" del Benchmark y su slide del Flow (public/daily-ceo-weekly.js).
var B2C_BUDGET_JSON = 'b2c_budget_weekly.json';

function getB2CBudgetWeekly() {
  return loadFile_(B2C_BUDGET_JSON, 'b2c_budget_weekly');
}
