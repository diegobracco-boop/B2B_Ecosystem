// Solo Ownia: P&L Managerial leyendo la parte contable ("Managerial vs Accounting") del consolidador en vez de actuals.json de Drive (2026-11-17).
// Se carga en el proyecto del P&L Managerial (gasExtras en server/modules.js), DESPUÉS de su código, y solo en los módulos con
// `fuente: 'consolidador'` (hoy `pnl-managerial`; `pnl-managerial-drive` es el respaldo con Drive). Lo demás del módulo (los reales
// gestionales, el semanal) sale del Datalake y no se toca.
//  - readAccActualsJSON_(): devuelve el actuals con N1 a N5 que arma server/pnl-fuente.js desde la tabla, en el formato y vocabulario de Drive;
//  - _accActualsStamp_(): la versión publicada de la tabla, así el caché de getVsAccounting se renueva solo cuando conso publica.
// Si el host todavía no tiene datos NO se cae a Drive: falla con el motivo (el servidor espera a tenerlos antes de atender, ver pnl-fuente.js).
var _mgrOrigRead_ = readAccActualsJSON_;
var _mgrOrigStamp_ = _accActualsStamp_;

function _mgrFuente_() {
  return (typeof __owniaPnlCanon_ === 'function') ? __owniaPnlCanon_() : null;
}

readAccActualsJSON_ = function () {
  var f = _mgrFuente_();
  if (!f) return _mgrOrigRead_();
  if (!f.actualsMgr) throw new Error('El consolidador no armó el actuals del Managerial' + (f.errorMgr ? ': ' + f.errorMgr : ''));
  return f.actualsMgr;
};

_accActualsStamp_ = function () {
  var f = _mgrFuente_();
  return f ? f.modificado : _mgrOrigStamp_();
};
