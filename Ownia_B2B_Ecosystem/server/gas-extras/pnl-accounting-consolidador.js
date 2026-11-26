// Solo Ownia: P&L Accounting leyendo del consolidador en vez de los JSON de Drive (2026-11-17).
// Se carga en el proyecto del P&L Accounting (gasExtras en server/modules.js), DESPUÉS de su código y de los otros extras, y
// solo en los módulos con `fuente: 'consolidador'` (hoy `pnl-accounting`; `pnl-accounting-drive` es el respaldo con Drive): reemplaza la lectura de los canónicos por
// los que arma server/pnl-fuente.js desde compartido.app_b2b_ecosystem, con el mismo formato y el vocabulario de Drive, así el
// resto del módulo (assembleCanonicals_, los cálculos, organic) corre idéntico y sin tocar su código.
//  - _readCanonical_(fileId): devuelve el canónico del escenario de ese id (CANONICAL_IDS_ incluye fbtb por pnl-accounting-fbtb.js);
//  - _canonicalsMaxMod_(): la versión publicada de la tabla, así los caches del módulo se renuevan solos cuando conso publica.
// Si el host todavía no tiene datos NO se cae a Drive: falla (el servidor espera a tenerlos antes de atender, ver pnl-fuente.js).
// LRR_DESDE_DRIVE_ (2026-11-24): el escenario LRR de la tabla no es la ronda del 3/11 (sep y oct vienen proyectados), así que el
// Last Run Rate sale de lastrunrate.json de Drive (= LastRunRate_OC). Volver a false cuando conso cargue la ronda correcta.
// 2026-11-25: false. El LRR del consolidador ahora es actuals hasta el último cerrado + LRR de la tabla desde el mes siguiente
// (especificacion en pnl-consolidador.js); en nov-mar ya coincide con lastrunrate.json. Con true vuelve a leer Drive.
var LRR_DESDE_DRIVE_ = false;
var _consOrigRead_ = _readCanonical_;
var _consOrigMaxMod_ = _canonicalsMaxMod_;

function _consFuente_() {
  return (typeof __owniaPnlCanon_ === 'function') ? __owniaPnlCanon_() : null;
}

_readCanonical_ = function (fileId) {
  var f = _consFuente_();
  if (!f) return _consOrigRead_(fileId);
  var key = null;
  Object.keys(CANONICAL_IDS_).forEach(function (k) { if (CANONICAL_IDS_[k] === fileId) key = k; });
  if (key === 'lrr' && LRR_DESDE_DRIVE_) return _consOrigRead_(fileId);
  if (!key || !f.canon[key]) throw new Error('El consolidador no arma el escenario "' + key + '"');
  return f.canon[key];
};

_canonicalsMaxMod_ = function () {
  var f = _consFuente_();
  if (!f) return _consOrigMaxMod_();
  var lrr = 0;   // con el LRR desde Drive, los caches también se renuevan cuando cambia lastrunrate.json
  if (LRR_DESDE_DRIVE_) { try { lrr = DriveApp.getFileById(CANONICAL_IDS_.lrr).getLastUpdated().getTime(); } catch (e) {} }
  return Math.max(f.modificado, lrr);
};
