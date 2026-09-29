// OKR Dashboard — Tribu Producto B2B2C
// Lee el JSON desde una URL pública de Drive (sin scope de Drive)

var CACHE_KEY   = "okr_tribu_v1";
var CACHE_TTL   = 21600;   // 6 h
var CACHE_CHUNK = 90000;

// ══════════════════════════════════════════════════════════════
//  Webapp
// ══════════════════════════════════════════════════════════════

function doGet(e) {
  if (e && e.parameter && e.parameter.invalidate === '1') {
    // Lo llama okr_sync.py después de cada deploy — ya no hay botón manual en el dashboard.
    return ContentService.createTextOutput(JSON.stringify(invalidateCache())).setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('dashboard')
    .setTitle('OKRs Tribu Producto · H1 FY27')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// (Se eliminó el proxy getPnlLine_ / ?pnl=1: nadie lo llamaba y devolvía sumas de cualquier
//  pestaña de la hoja "Input dashboard B2B+WLs" a cualquier usuario del dominio,
//  corriendo como quien deployó — auditoría 2026-09-25.)

// ══════════════════════════════════════════════════════════════
//  API pública
// ══════════════════════════════════════════════════════════════

function getOKRData() {
  try {
    var data = loadJSON_();
    return { success: true, okr: data.okr, meta: data.meta };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function invalidateCache() {
  try {
    var cache = CacheService.getScriptCache();
    cache.remove(CACHE_KEY + '_n');
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════
//  Fetch + Cache
// ══════════════════════════════════════════════════════════════

function loadJSON_() {
  var cached = cacheGet_(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  // OKR_PAYLOAD es generado por okr_sync.py y embebido en okr_data.js
  if (typeof OKR_PAYLOAD === 'undefined') throw new Error('Sin datos: corré okr_sync.py');
  var raw = JSON.stringify(OKR_PAYLOAD);
  cachePut_(CACHE_KEY, raw);
  return OKR_PAYLOAD;
}

function cachePut_(key, raw) {
  try {
    var cache = CacheService.getScriptCache();
    var n = Math.ceil(raw.length / CACHE_CHUNK);
    cache.put(key + '_n', String(n), CACHE_TTL);
    var BATCH = 90;
    for (var s = 0; s < n; s += BATCH) {
      var obj = {}, e = Math.min(s + BATCH, n);
      for (var i = s; i < e; i++)
        obj[key + '_' + i] = raw.substring(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK);
      cache.putAll(obj, CACHE_TTL);
    }
  } catch(ex) {}
}

function cacheGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var nStr = cache.get(key + '_n');
    if (!nStr) return null;
    var n = parseInt(nStr), parts = [];
    for (var i = 0; i < n; i++) {
      var c = cache.get(key + '_' + i);
      if (!c) return null;
      parts.push(c);
    }
    return parts.join('');
  } catch(ex) { return null; }
}
