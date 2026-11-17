'use strict';
// Diagnóstico del lado Drive del P&L Accounting: qué traen los JSON canónicos que hoy lee el módulo, para poder
// mapearlos contra la tabla del consolidador (compartido.app_b2b_ecosystem). Solo lectura, sin filas: devuelve,
// por escenario, columnas, cantidad de filas, rango de fechas, suma de Monto USD por mes y los valores distintos
// de cada dimensión. Los ids son los de CANONICAL_IDS_ (P&L_Accounting/Codigo_contable.js) + fbtb (gas-extras).
const IDS = {
  ac: '1PABNf4XVKdj6eXApr5_yP581ZsD_N9e-',    // actuals.json
  bg: '1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW',    // budget.json
  fc: '1crqpRTyH14fqX9XdwBTVaKN5rPbE6O84',    // forecast.json
  rr: '1UGg60kE397nsGAivtFqI8NX5CVFj1gqO',    // runrate.json
  lrr: '1Nk56QlEA2hKuWGhfZ1357Eds6DhU8zwC',   // lastrunrate.json
  bl: '1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv',    // baseline_actuals+projections.json
  ly: '1zd5gnMFztKiCSgeY-VmsfVOr0LQ6ftGI',    // actuals_previos_fy26.json
  fbtb: '1anL-CsItySxuWTp4FuX69tHsAy9oz4rp',  // forecastbtb.json
};
const DIMS = ['LoB', 'Canal', 'Pais', 'Producto', 'P&L N2', 'P&L N3'];
const MAX_VALORES = 80;

function describir(buf) {
  const raw = JSON.parse(buf.toString('utf8'));
  const cols = raw.cols || [];
  const idx = (c) => cols.indexOf(c);
  const iF = idx('Fecha');
  const iM = idx('Monto USD');
  const dims = {};
  for (const d of DIMS) if (idx(d) >= 0) dims[d] = new Map();
  const porMes = {};
  for (const r of raw.rows || []) {
    for (const d of Object.keys(dims)) {
      const v = String(r[idx(d)]);
      dims[d].set(v, (dims[d].get(v) || 0) + 1);
    }
    const ym = String(r[iF]).substring(0, 7);
    porMes[ym] = (porMes[ym] || 0) + (Number(r[iM]) || 0);
  }
  const valores = {};
  for (const [d, m] of Object.entries(dims)) {
    const arr = Array.from(m, ([valor, filas]) => ({ valor, filas })).sort((a, b) => b.filas - a.filas);
    valores[d] = { distintos: arr.length, top: arr.slice(0, MAX_VALORES) };
  }
  return { cols, filas: (raw.rows || []).length, meta: raw.meta ? Object.keys(raw.meta) : [], fechasMeta: (raw.meta && raw.meta.fechas) || null, montoPorMes: porMes, valores };
}

/** @param {object} fileStore  el almacén (get(id) → { meta, buf }) */
function driveDimensiones(fileStore) {
  const out = {};
  for (const [sc, id] of Object.entries(IDS)) {
    const f = fileStore && fileStore.get(id);
    if (!f) { out[sc] = { error: 'no está en el almacén', id }; continue; }
    try { out[sc] = { id, actualizado: new Date(f.meta.updatedAt).toISOString(), ...describir(f.buf) }; } catch (e) { out[sc] = { error: String(e.message || e), id }; }
  }
  return out;
}

module.exports = { driveDimensiones, IDS };
