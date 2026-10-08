// ════════════════════════════════════════════════════════════════
//  FVM Negativo — Backend
//  Transacciones B2B / B2B2C con FVM < 0 (reemplaza la app de Toqan).
//
//  Sin pipeline propio: lee fvm_negativo.json, que genera cada día
//  Daily_Dashboard/daily_sync.py (build_b2b_fvm_neg_query / build_b2b2c_fvm_neg_query)
//  en la carpeta de Drive del Daily. Mismo FVM que el Daily: el pipeline no sube el
//  JSON si el FVM total no cuadra contra el del Daily (queda el del día anterior).
//
//  Dos criterios (selector en el dashboard):
//    tx   → transacción con FVM < 0 (suma de sus productos en el mes)
//    comp → componente (ej. el vuelo dentro de un paquete) con FVM < 0 aunque la
//           transacción entera gane — lo que medía Toqan.
// ════════════════════════════════════════════════════════════════

var DRIVE_FOLDER_ID = '1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh';   // carpeta DailyDashboard (= daily_sync.DRIVE_FOLDER_ID)
var JSON_FILE       = 'fvm_negativo.json';
var CACHE_KEY       = 'fvm_neg';
var CACHE_TTL       = 21600;   // 6 h (máximo de CacheService)
var CACHE_CHUNK     = 90000;   // CacheService admite hasta 100 KB por valor

function doGet() {
  return HtmlService.createHtmlOutputFromFile('dashboard')
    .setTitle('FVM Negativo')
    .addMetaTag('viewport', 'width=device-width,initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Devuelve el JSON como texto: el cliente lo parsea (más rápido que serializar el objeto).
function getData() {
  var files = DriveApp.getFolderById(DRIVE_FOLDER_ID).getFilesByName(JSON_FILE);
  if (!files.hasNext()) throw new Error('No encontrado en Drive: ' + JSON_FILE);
  var file = files.next();
  // La clave incluye el lastUpdated: al subir un JSON nuevo se lee fresco sin esperar el TTL.
  var key    = CACHE_KEY + '_' + file.getLastUpdated().getTime();
  var cached = cacheGet_(key);
  if (cached) return cached;
  var raw = file.getBlob().getDataAsString();
  cachePut_(key, raw);
  return raw;
}

function cachePut_(key, raw) {
  try {
    var cache = CacheService.getScriptCache();
    var n = Math.ceil(raw.length / CACHE_CHUNK), obj = {};
    obj[key + '_n'] = String(n);
    for (var i = 0; i < n; i++) obj[key + '_' + i] = raw.substring(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK);
    cache.putAll(obj, CACHE_TTL);
  } catch (ex) {}
}

function cacheGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var nStr = cache.get(key + '_n');
    if (!nStr) return null;
    var n = parseInt(nStr, 10), keys = [];
    for (var i = 0; i < n; i++) keys.push(key + '_' + i);
    var got = cache.getAll(keys), parts = [];
    for (var j = 0; j < n; j++) {
      if (!got[keys[j]]) return null;
      parts.push(got[keys[j]]);
    }
    return parts.join('');
  } catch (ex) { return null; }
}
