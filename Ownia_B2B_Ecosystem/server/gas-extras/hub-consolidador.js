// Solo Ownia: el Hub (P&L Dashboard) leyendo del consolidador en vez de los JSON de Drive (2026-11-17).
// Se carga en el proyecto del Hub (gasExtras en server/modules.js), DESPUÉS de su código, y solo en los módulos con
// `fuente: 'consolidador'` (hoy `hub`; `hub-drive` es el respaldo con Drive). Lo demás del Hub (OKR, los archivos de insights, el FX) sigue igual.
//  - readJson_(fileId): para los 7 JSON de JSON_IDS (baseline, budget, runrate, forecast, forecastbtb, lastrunrate, ly) devuelve las filas
//    que arma server/pnl-fuente.js desde la tabla, con el mismo formato y vocabulario de Drive (columnas en minúscula, `fecha` en ms UTC,
//    `monto usd` numérico). Cualquier otro id va al original;
//  - _getJsonsLastMod_(): la versión publicada de la tabla (y el xlsx de TC, que sigue en Drive), así los caches del Hub se renuevan solos.
// Si el host todavía no tiene las series NO se cae a Drive: falla con el motivo (el servidor espera a tenerlas antes de atender, ver pnl-fuente.js).
// LRR_DESDE_DRIVE_ (2026-11-24): igual que en pnl-accounting-consolidador.js, el Goal "Last Run Rate" sale de lastrunrate.json de Drive
// (= LastRunRate_OC) y no del escenario LRR de la tabla, que no es la ronda del 3/11. Volver a false cuando conso cargue la ronda correcta.
var LRR_DESDE_DRIVE_ = true;
var _hubOrigReadJson_ = readJson_;
var _hubOrigLastMod_ = _getJsonsLastMod_;

function _hubFuente_() {
  return (typeof __owniaPnlCanon_ === 'function') ? __owniaPnlCanon_() : null;
}

// id de Drive -> serie del consolidador
var _HUB_SERIES_ = { baseline: 'bl', budget: 'bg', runrate: 'rr', forecast: 'fc', forecastbtb: 'fbtb', lastrunrate: 'lrr', ly: 'ly' };

readJson_ = function (fileId) {
  var f = _hubFuente_();
  if (!f) return _hubOrigReadJson_(fileId);
  var clave = null;
  Object.keys(_HUB_SERIES_).forEach(function (k) { if (JSON_IDS[k] === fileId) clave = _HUB_SERIES_[k]; });
  if (!clave || (clave === 'lrr' && LRR_DESDE_DRIVE_)) return _hubOrigReadJson_(fileId);
  if (_jsonCache_[fileId]) return _jsonCache_[fileId];
  if (!f.hub || !f.hub[clave]) throw new Error('El consolidador no armó la serie "' + clave + '" del Hub' + (f.errorHub ? ': ' + f.errorHub : ''));
  var src = f.hub[clave];
  var cols = src.cols.map(function (c) { return String(c).trim().toLowerCase(); });
  var iFecha = cols.indexOf('fecha'), iMonto = cols.indexOf('monto usd');
  var rows = src.rows.map(function (r) {
    var obj = {};
    cols.forEach(function (c, i) { obj[c] = r[i]; });
    var fp = String(obj['fecha']).split('-');
    obj['fecha'] = Date.UTC(parseInt(fp[0], 10), parseInt(fp[1], 10) - 1, parseInt(fp[2], 10));
    obj['monto usd'] = parseFloat(obj['monto usd']) || 0;
    return obj;
  });
  _jsonCache_[fileId] = rows;
  return rows;
};

_getJsonsLastMod_ = function () {
  var f = _hubFuente_();
  if (!f) return _hubOrigLastMod_();
  var fx = 0;
  try { fx = DriveApp.getFileById(FX_FILE_ID).getLastUpdated().getTime(); } catch (e) {}
  if (LRR_DESDE_DRIVE_) { try { fx = Math.max(fx, DriveApp.getFileById(JSON_IDS.lastrunrate).getLastUpdated().getTime()); } catch (e) {} }
  return Math.max(f.modificado, fx);
};
