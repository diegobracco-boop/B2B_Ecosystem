// Solo Ownia: P&L Accounting leyendo del consolidador en vez de los JSON de Drive (2026-11-17).
// Se carga en el proyecto del P&L Accounting (gasExtras en server/modules.js), DESPUÉS de su código y de los otros extras, y
// solo en los módulos con `fuente: 'consolidador'` (la copia `pnl-accounting-conso`): reemplaza la lectura de los canónicos por
// los que arma server/pnl-fuente.js desde compartido.app_b2b_ecosystem, con el mismo formato y el vocabulario de Drive, así el
// resto del módulo (assembleCanonicals_, los cálculos, organic) corre idéntico y sin tocar su código.
//  - _readCanonical_(fileId): devuelve el canónico del escenario de ese id (CANONICAL_IDS_ incluye fbtb por pnl-accounting-fbtb.js);
//  - _canonicalsMaxMod_(): la versión publicada de la tabla, así los caches del módulo se renuevan solos cuando conso publica.
// Si el host todavía no tiene datos NO se cae a Drive: falla (el servidor espera a tenerlos antes de atender, ver pnl-fuente.js).
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
  if (!key || !f.canon[key]) throw new Error('El consolidador no arma el escenario "' + key + '"');
  return f.canon[key];
};

_canonicalsMaxMod_ = function () {
  var f = _consFuente_();
  return f ? f.modificado : _consOrigMaxMod_();
};
