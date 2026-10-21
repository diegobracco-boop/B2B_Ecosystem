// Registro de módulos del ecosistema. `ownia: true` = se sirve desde esta app (corre el
// código GAS del módulo con los shims de gas-runtime). El resto se linkea a su landing GAS,
// que sigue siendo la productiva: la migración es progresiva y Apps Script no se toca.
//
// `requiresIdentity` (default true): sin usuario @despegar.com identificado → 401. Solo se
// apaga en módulos sin datos (el Manual). Ojo: varias guardas del código GAS (p.ej.
// requireOwner_ del Daily) dejan pasar si el usuario activo viene vacío — por eso la
// identidad se exige acá y no se deja en manos del módulo.
//
// Los deployment IDs de gasUrl son una copia más (también están en manual.html,
// CONTEXT-MAP.md y /clasp-push): al cambiar uno, actualizar todos.
//
// Para migrar un módulo: poner `ownia: true`, verificar que no use servicios todavía no
// shimeados (ver CONTEXT.md, "Servicios GAS soportados"), correr `npm test`, sincronizar
// el repo de Ownia y redeployar.

const GAS_EXEC = 'https://script.google.com/a/macros/despegar.com/s/';

const MODULES = [
  {
    slug: 'manual',
    dir: 'Manual_B2B_WLs',
    title: 'Manual B2B WLs',
    desc: 'Manual técnico del ecosistema (solo lectura).',
    ownia: true,
    requiresIdentity: false, // estático, sin datos
    gasUrl: GAS_EXEC + 'AKfycbwq2nohZ-c3w-OqvO1H_op4yATn6yDN4qRO9mI8gs1VkO9Jn9lCcQeTsNAceCpydJiHzg/exec',
  },
  {
    slug: 'hub',
    dir: 'Dashboard_B2B_WLs',
    title: 'B2B Ecosystem Hub',
    desc: 'Portal central del equipo: P&L, OKR, Detail By Country.',
    ownia: false,
    gasUrl: GAS_EXEC + 'AKfycbz52txFQy-5YM2Nil_KxULzPoeZpKyA4z5LUWMGoP_8IilcwSduuwZqPF8ut_LmtceM/exec',
  },
  {
    slug: 'daily',
    dir: 'Daily_Dashboard',
    title: 'Daily Dashboard B2B2C + B2B',
    desc: 'Performance diaria de WLs y B2B (GD + RI).',
    ownia: false,
    gasUrl: GAS_EXEC + 'AKfycbwMR3zk1r4uwui8vGtcmz0OwmeehC5JM8cuJRE3H-GQMfvxXWGTkYQ3R2nVjMyeAdX_1A/exec',
  },
  {
    slug: 'pnl-accounting',
    dir: 'P&L_Accounting',
    title: 'P&L Accounting',
    desc: 'Vista contable del P&L.',
    ownia: false,
    gasUrl: GAS_EXEC + 'AKfycby9WZK2HfAWx25M5pEMV3nntzJfEvsiT9feMn01zJQkQaI3t2GjTzOIjbFXWexnMuzklQ/exec',
  },
  {
    slug: 'pnl-managerial',
    dir: 'P&L_Managerial',
    title: 'P&L Managerial',
    desc: 'Vista gestional (FVM) B2B2C y B2B.',
    ownia: false,
    gasUrl: GAS_EXEC + 'AKfycbxHyP4uIh02zTQbQ7ZFbyByCVIYuREuiMJ74PnKhQbNGbWknCG2jxOtt_onafQcg5g4/exec',
  },
  {
    slug: 'one-pager',
    dir: 'lob_country_one_pager',
    title: 'Country One Pager',
    desc: 'One-pager por LoB y país para la dirección comercial.',
    ownia: false,
    gasUrl: GAS_EXEC + 'AKfycbytMGsghl1TweKpYgMV2uhjTr--a9jpWkd2G3faZrF0DixD7UNu2qAq8Tbhlv_PCo0t/exec',
  },
  {
    slug: 'fvm-negativo',
    dir: 'FVM_Negativo',
    title: 'FVM Negativo',
    desc: 'Transacciones B2B / B2B2C con FVM < 0.',
    ownia: false,
    gasUrl: GAS_EXEC + 'AKfycbzGXCpL9_p70Xx7P640YgU-zOzoLG1018HG9N_pzQvrCJPHTPsUuryD_tDH1HNO41hOIg/exec',
  },
  {
    slug: 'okr-b2b2c',
    dir: 'OKR_Producto_B2B2C',
    title: 'OKR Producto B2B2C',
    desc: 'OKRs de la tribu Producto B2B2C.',
    ownia: false,
    gasUrl: GAS_EXEC + 'AKfycbz1KVq_b2V8UBEaXvcqJmlvS8e-gd2FAwQOcBV91rABnK7Lm33fTcYMPr_f7pdqNiCI/exec',
  },
  {
    slug: 'profit-sharing',
    dir: 'P&L_Profit_Sharing',
    title: 'P&L Profit Sharing · Banco de Chile',
    desc: 'P&L de profit sharing de Banco de Chile.',
    ownia: false,
    gasUrl: GAS_EXEC + 'AKfycbyfhSHt3k0wJS39TlHYOAuRYicAy0M1pGfnarSM1RXOKECa4p1cBSlFjXU5ZXQKsYCj/exec',
  },
];

module.exports = { MODULES };
