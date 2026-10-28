// Proyecto GAS de prueba: ejercita los shims como lo haría una landing real.
var CACHE_KEY = 'demo';

function doGet(e) {
  if (e.parameter.format === 'json') {
    return ContentService.createTextOutput(JSON.stringify({ ok: true, path: e.pathInfo }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var t = HtmlService.createTemplateFromFile('page');
  t.saludo = '<hola>';
  return t.evaluate()
    .setTitle('Demo GAS')
    .addMetaTag('viewport', 'width=device-width,initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

var _veces = 0;
function contador() { _veces++; return _veces; }   // para probar el cache de respuestas: cada ejecución real suma uno

function sumar(a, b) {
  return a + b;
}

function esArray(x) {
  return x instanceof Array && Array.isArray(x);
}

function quienSoy() {
  return Session.getActiveUser().getEmail();
}

// Helper privado que usan las funciones propias de Ownia (server/gas-extras/daily-industry.js).
function loadFile_(name, cacheKey) {
  return { name: name, cacheKey: cacheKey };
}

function cacheIdaYVuelta(v) {
  CacheService.getScriptCache().put(CACHE_KEY, v, 60);
  return CacheService.getScriptCache().get(CACHE_KEY);
}

function urlPropia() {
  return ScriptApp.getService().getUrl();
}

function leerDrive() {
  return DriveApp.getFileById('x').getBlob().getDataAsString();
}

function mesLocal() {
  // 2026-10-01T01:00:00Z = 30/09 22:00 en Buenos Aires (como en GAS con timeZone ART).
  return new Date(Date.UTC(2026, 9, 1, 1, 0, 0)).getMonth();
}

function fecha() {
  return Utilities.formatDate(new Date(Date.UTC(2026, 9, 1, 1, 5, 9)), 'America/Argentina/Buenos_Aires', "yyyy-MM-dd'T'HH:mm:ss EEE MMM");
}

function explota() {
  throw new Error('falló a propósito');
}

function cuelga() {
  while (true) {}
}

function privada_() {
  return 'no debería poder llamarse';
}
