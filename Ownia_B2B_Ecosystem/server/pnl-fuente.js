'use strict';
// Fuente del P&L Accounting desde el consolidador, lista para el código GAS: mantiene EN MEMORIA los 8 JSON canónicos
// armados desde la tabla compartido.app_b2b_ecosystem (pnl-consolidador.js). El código GAS es sincrónico y la lectura de la
// base no lo es, así que acá se refresca por afuera: `listo()` espera a que haya datos antes de atender un pedido y `canon()`
// se lee sin esperar desde adentro del módulo (gas-extras/pnl-accounting-consolidador.js).
//
// - Se revisa la versión publicada como mucho cada CHECK_MS (la consulta es chica); si cambió, se rearma (unos 10 s).
// - Si cambia la versión, `onChange` avisa para que se invalide el módulo y sus caches (igual que cuando cambia un archivo de Drive).
// - Sin datos o con error NO se cae a Drive en silencio: el pedido falla con 503 y el motivo.
const { buildCanonicals } = require('./pnl-consolidador');

const CHECK_MS = 60 * 1000;
const ULTIMO_CERRADO_DEFAULT = '2026-10-01';   // último mes con actuals cerrados: se mueve a mano en cada cierre (APP_SECRETS.PNL_ULTIMO_CERRADO)

function createPnlFuente(cfg, { consolidador, log = () => {}, onChange = () => {}, now = () => Date.now(), ajustes } = {}) {
  const secretos = (cfg && cfg.secrets) || {};
  const pedido = secretos.PNL_ULTIMO_CERRADO;
  const ultimoCerrado = /^\d{4}-\d{2}-01$/.test(pedido || '') ? pedido : ULTIMO_CERRADO_DEFAULT;
  const st = { tieneColumnaVersion: null, canon: null, sinMapear: null, version: null, publicadoEn: null, construidoEn: null, revisadoEn: 0, error: null, filas: {} };
  let enCurso = null;

  async function refrescar() {
    const v = await consolidador.leer('versiones');
    if (!v.ok) throw Object.assign(new Error(v.error), { status: v.code });
    if (!v.data) throw Object.assign(new Error('La tabla compartido.app_b2b_ecosystem no está publicada (o no hay permiso)'), { status: 503 });
    st.revisadoEn = now();
    if (st.canon && v.data.version === st.version && v.data.publicado_en === st.publicadoEn) return;
    const c = await consolidador.leer('cubo');
    if (!c.ok) throw Object.assign(new Error(c.error), { status: c.code });
    const { canon, sinMapear } = buildCanonicals(c.data, { ultimoCerrado, ajustes });
    const cambio = st.canon !== null;
    st.tieneColumnaVersion = c.data.tieneColumnaVersion === undefined ? null : !!c.data.tieneColumnaVersion;
    st.canon = canon; st.sinMapear = sinMapear; st.version = v.data.version; st.publicadoEn = v.data.publicado_en; st.construidoEn = now();
    st.filas = Object.fromEntries(Object.entries(canon).map(([k, j]) => [k, j.rows.length]));
    log({ level: 'info', msg: 'pnl-fuente: canónicos armados desde el consolidador', version: st.version, publicadoEn: st.publicadoEn, ultimoCerrado });
    if (cambio) onChange(st.version);
  }

  /** Espera a que haya datos frescos. Lanza (status 503) si no se pudo armar: no hay respaldo en Drive. */
  async function listo() {
    if (st.canon && now() - st.revisadoEn < CHECK_MS) return;
    if (!enCurso) {
      enCurso = refrescar().then(() => { st.error = null; }, (e) => { st.error = e.message || String(e); if (!st.canon) throw e; })
        .finally(() => { enCurso = null; });
    }
    try { await enCurso; } catch (e) {
      log({ level: 'error', msg: 'pnl-fuente: no se pudo leer el consolidador', error: e.message || String(e) });
      throw Object.assign(new Error(`P&L desde el consolidador: ${e.message || e}`), { status: 503 });
    }
  }

  return {
    ultimoCerrado,
    listo,
    /** Lo que ve el código GAS (sincrónico): null mientras no haya datos. `modificado` cambia con cada versión publicada. */
    canon: () => (st.canon ? { canon: st.canon, modificado: Date.parse(st.publicadoEn) || st.construidoEn } : null),
    estado: () => ({ tieneColumnaVersion: st.tieneColumnaVersion,
      advertencia: st.tieneColumnaVersion === false ? 'La tabla no abre la columna version: si el pedido incluye varias versiones (AS REPORTED, BIMO, PPA) sus montos se suman entre sí.' : null,
      listo: !!st.canon, ultimoCerrado, version: st.version, publicadoEn: st.publicadoEn,
      construidoEn: st.construidoEn ? new Date(st.construidoEn).toISOString() : null, error: st.error, filas: st.filas, sinMapear: st.sinMapear }),
  };
}

module.exports = { createPnlFuente, ULTIMO_CERRADO_DEFAULT };
