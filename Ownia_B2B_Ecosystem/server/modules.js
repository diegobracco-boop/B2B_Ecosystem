// Registro de módulos del ecosistema. `ownia: true` = se sirve desde esta app (corre el
// código GAS del módulo con los shims de gas-runtime). El resto se linkea a su landing GAS,
// que sigue siendo la productiva: la migración es progresiva y Apps Script no se toca.
//
// `validating: true` = corre en Ownia EN PARALELO a Apps Script, para comparar: la portada
// muestra los dos links y la productiva sigue siendo la de GAS. Lee los archivos de Drive
// espejados por mirror/ownia_mirror.py (ver CONTEXT.md, "Datos").
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

// Equipo B2B: los únicos que pueden abrir un módulo "en validación" (datos del P&L) mientras
// corre en paralelo a GAS. Todas las apps de Ownia comparten el dominio ownia.despegar.io
// (aceptado por el equipo, 2026-10-21); limitar a estas cuentas acota la exposición. Un módulo
// puede definir su propia lista con `allowedUsers`.
const EQUIPO_B2B = [
  'gregorio.minetti@despegar.com',
  'diego.bracco@despegar.com',
  'tiago.harari@despegar.com',
  'tomas.rombola@despegar.com',
  'antonella.difranco@despegar.com',
];

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
    title: 'P&L Dashboard',
    desc: 'Portal central del equipo: P&L, OKR, Detail By Country.',
    // En validación: corre acá en paralelo a GAS (datos del P&L → solo el equipo B2B, como Managerial y
    // Accounting). "Slides cierre de mes" (SlidesApp + Slides API) y los triggers (preComputeAll) siguen en GAS.
    ownia: true,
    validating: true,
    allowedUsers: EQUIPO_B2B,
    // Presentación propia de Ownia (public/hub-layout.js): barra fija con el selector de LoB y las
    // secciones en vez del menú hamburguesa; precarga de los otros LoB. El HTML de GAS no cambia.
    // Vista "H2 Budget vs H1" para dirección (public/hub-h2h1.js) y el deck "Slides mensuales"
    // (public/hub-slides.js, textos en /notes/hub/…), 2026-10-26.
    layout: ['filter-aliases.js', 'hub-layout.js', 'hub-h2h1.js', 'hub-slides.js'],
    gasUrl: GAS_EXEC + 'AKfycbz52txFQy-5YM2Nil_KxULzPoeZpKyA4z5LUWMGoP_8IilcwSduuwZqPF8ut_LmtceM/exec',
  },
  {
    slug: 'daily',
    dir: 'Daily_Dashboard',
    title: 'Daily Dashboard B2B2C + B2B',
    desc: 'Performance diaria de WLs y B2B (GD + RI).',
    // En validación: corre acá en paralelo a GAS. Exportar a Slides y mandar el mail del Daily
    // no están en Ownia (SlidesApp / MailApp): siguen en Apps Script, que es el productivo.
    // Sin allowedUsers: cualquier @despegar.com, igual que el webapp GAS (access DOMAIN). Se abrió
    // el 2026-10-23 para que el equipo comercial use "OKR Detail" (KRs H2 por país, sección B2B).
    ownia: true,
    validating: true,
    // Solo Ownia (2026-10-24): solapa "Industry events tracker" (public/daily-layout.js) y su función de
    // servidor getIndustryEvents (server/gas-extras/daily-industry.js). El código GAS del Daily no cambia.
    // daily-embed.js: ?embed=b2b2c-cover muestra sola la portada B2B2C del Flow (la usa "Slides mensuales" del Hub).
    // daily-flow-tier.js: tabla de las slides OKR L2 (NR y FVM) del Flow por Región → Tier → Partner con YoY.
    layout: ['daily-layout.js', 'daily-embed.js', 'daily-flow-tier.js'],
    gasExtras: ['daily-industry.js'],
    gasUrl: GAS_EXEC + 'AKfycbwMR3zk1r4uwui8vGtcmz0OwmeehC5JM8cuJRE3H-GQMfvxXWGTkYQ3R2nVjMyeAdX_1A/exec',
  },
  {
    slug: 'pnl-accounting',
    dir: 'P&L_Accounting',
    title: 'P&L Accounting',
    desc: 'Vista contable del P&L.',
    ownia: true,
    validating: true,
    // Sin la portada propia del módulo: entra directo a esta vista (goToView del dashboard) y
    // se navega con los selectores del header. Ver public/ownia-nav.js.
    startView: 'contable-combined',
    // Accesos rápidos de la tarjeta del menú: abren directo esa vista (?view=, ver public/ownia-nav.js).
    quickViews: [['contable-combined', 'B2B + B2B2C'], ['contable-b2b', 'B2B'], ['contable-b2b2c', 'B2B2C']],
    // Solo Ownia (2026-10-26): escenario "Forecast - Bridge to budget" (botón "vs Forecast BTB").
    // El código GAS del módulo no cambia.
    layout: 'pnl-accounting-layout.js',
    gasExtras: ['pnl-accounting-fbtb.js'],
    allowedUsers: EQUIPO_B2B,
    gasUrl: GAS_EXEC + 'AKfycby9WZK2HfAWx25M5pEMV3nntzJfEvsiT9feMn01zJQkQaI3t2GjTzOIjbFXWexnMuzklQ/exec',
  },
  {
    slug: 'pnl-managerial',
    dir: 'P&L_Managerial',
    title: 'P&L Managerial',
    desc: 'Vista gestional (FVM) B2B2C y B2B.',
    ownia: true,
    validating: true,
    // Sin vista consolidada B2B + B2B2C (el módulo no la tiene): el tercer acceso es Managerial vs Accounting.
    quickViews: [['b2b', 'B2B'], ['b2b2c', 'B2B2C'], ['vsacc', 'Managerial vs Accounting']],
    allowedUsers: EQUIPO_B2B,
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
    // En validación: corre acá en paralelo a GAS. Solo lee fvm_negativo.json de la carpeta del Daily.
    // Sin allowedUsers: cualquier @despegar.com, igual que el webapp GAS (access DOMAIN).
    ownia: true,
    validating: true,
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

module.exports = { MODULES, EQUIPO_B2B };
