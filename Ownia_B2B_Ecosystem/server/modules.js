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
// corre en paralelo a GAS, y los únicos que ven el botón "Actualizar reales" de la portada. Todas las apps de Ownia comparten el dominio ownia.despegar.io
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
    // Solo Ownia (2026-10-28): diseño Apple-style y tareas propias del Gantt (public/manual-layout.js). El manual de Apps Script no cambia.
    layout: 'manual-layout.js',
    // Sección "Vista por usuario" (filtros de país y canal con los que abre cada persona): la edita solo esta lista; sumar mails acá cuando Diego dé permisos.
    noteEditors: { vistas: ['diego.bracco@despegar.com'] },
    quickViews: [['gantt', 'Gantt']],
    quickInList: true,   // el acceso rápido se ve también en la lista "Más tableros" del menú
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
    hideGasLink: true,   // 2026-10-28: sin el link "Versión Apps Script" en la tarjeta del menú (Diego)
    allowedUsers: EQUIPO_B2B,
    // Presentación propia de Ownia (public/hub-layout.js): barra fija con el selector de LoB y las
    // secciones en vez del menú hamburguesa; precarga de los otros LoB. El HTML de GAS no cambia.
    // Vista "H2 Budget vs H1" para dirección (public/hub-h2h1.js) y el deck "Slides mensuales"
    // (public/hub-slides.js, textos en /notes/hub/…), 2026-10-26. "Mis slides" (public/hub-builder.js, ?builder=1, 2026-10-29):
    // armador de slides propias con los datos del P&L; las recetas en /notes/hub/builder. Lo embebe Presentaciones.
    layout: ['filter-aliases.js', 'hub-layout.js', 'hub-h2h1.js', 'hub-slides.js', 'hub-cierre.js', 'hub-builder.js'],
    // getSlidesEvo (Slides mensuales y Mis slides) depende solo de sus parámetros y de los JSON del espejo: se calcula una vez por
    // combinación y día y se reparte comprimida (server/api-cache.js; se invalida cuando cambia un archivo que lee el Hub). 2026-10-30.
    cacheFns: ['getSlidesEvo'],
    gasUrl: GAS_EXEC + 'AKfycbz52txFQy-5YM2Nil_KxULzPoeZpKyA4z5LUWMGoP_8IilcwSduuwZqPF8ut_LmtceM/exec',
  },
  {
    slug: 'flow',
    dir: 'Flow_B2B',
    title: 'Presentaciones',
    desc: 'Presentación semanal (gestional) y mensual (contable) para revisar y comentar.',
    // Solo Ownia (2026-10-27): junta el Flow semanal del Daily (gestional) y las Slides mensuales del Hub (contable) en una entrada
    // propia del menú principal, con cuadro de comentarios por slide y envío por mail. Sin allowedUsers: cualquier @despegar.com
    // (Diego, 2026-10-27). OJO: el Flow mensual lee los datos del Hub, que está restringido a EQUIPO_B2B: quien no esté en esa
    // lista ve el semanal y un aviso en el mensual. Para sumar gente (p. ej. el Chief) agregarla a allowedUsers del Hub.
    ownia: true,
    // Accesos directos del menú: abren esa pestaña del Flow (?view=, lo lee Flow_B2B/flow.html).
    quickViews: [['semanal', 'Semanal'], ['mensual', 'Mensual'], ['cierre', 'Cierre de mes'], ['builder', 'Mis slides']],
    gasUrl: '',
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
    hideGasLink: true,   // 2026-10-28: sin el link "Versión Apps Script" en la tarjeta del menú (Diego)
    // Solo Ownia (2026-10-24): solapa "Industry events tracker" (public/daily-layout.js) y su función de
    // servidor getIndustryEvents (server/gas-extras/daily-industry.js). El código GAS del Daily no cambia.
    // daily-embed.js: ?embed=b2b2c-cover muestra sola la portada B2B2C del Flow (la usa "Slides mensuales" del Hub).
    // daily-flow-tier.js: tabla de las slides OKR L2 (NR y FVM) del Flow por Región → Tier → Partner con YoY.
    // daily-flow-slides.js: recuadro Organic y nota COI Brasil en cada slide del Flow; portada OC con tablas H1 / H2.
    // daily-ceo-weekly.js: "Weekly · vs B2C" (vista CEO) arriba del Benchmark y como slide del Flow; va antes de daily-embed.js (agrega la slide al deck).
    // daily-flow-minto.js (va última: toma el deck ya armado): en Presentaciones, resumen "La semana en 3 líneas", vista Ejecutiva /
    // Completa y títulos con la conclusión (Barbara Minto, 2026-10-30).
    layout: ['daily-layout.js', 'daily-ceo-weekly.js', 'daily-embed.js', 'daily-flow-tier.js', 'daily-flow-slides.js', 'daily-flowdeck.js', 'daily-flow-minto.js'],
    gasExtras: ['daily-industry.js', 'daily-b2c-budget.js', 'daily-weekly-fvm.js'],
    // Funciones que solo leen un JSON del espejo y devuelven lo mismo para todos: se cachea la respuesta ya comprimida (server/api-cache.js).
    // Agregar acá solo funciones que NO dependan del usuario ni de parámetros ocultos.
    cacheFns: ['getRawB2BC', 'getRawB2B', 'getB2BData', 'getRawOKRH2', 'getRawRecurrencia', 'getRecurTargets'],
    gasUrl: GAS_EXEC + 'AKfycbwMR3zk1r4uwui8vGtcmz0OwmeehC5JM8cuJRE3H-GQMfvxXWGTkYQ3R2nVjMyeAdX_1A/exec',
  },
  {
    slug: 'pnl-accounting',
    dir: 'P&L_Accounting',
    title: 'P&L Accounting',
    desc: 'Vista contable del P&L.',
    // Productivo en Ownia desde 2026-10-30 (Tiago): la landing de Apps Script solo muestra el aviso "se mudó" con el
    // link acá (doGet de Codigo.js). Sin allowedUsers: cualquier @despegar.com, igual que tenía el webapp GAS (access DOMAIN).
    ownia: true,
    // Sin la portada propia del módulo: entra directo a esta vista (goToView del dashboard) y
    // se navega con los selectores del header. Ver public/ownia-nav.js.
    startView: 'contable-combined',
    // Accesos rápidos de la tarjeta del menú: abren directo esa vista (?view=, ver public/ownia-nav.js).
    quickViews: [['contable-combined', 'B2B + B2B2C'], ['contable-b2b', 'B2B'], ['contable-b2b2c', 'B2B2C']],
    // Solo Ownia (2026-10-26): escenario "Forecast - Bridge to budget" (botón "vs Forecast BTB").
    // El código GAS del módulo no cambia.
    layout: 'pnl-accounting-layout.js',
    // pnl-accounting-byprod.js: getEPMBreakdown, columnas por país / producto de la tabla Baseline vs Goal (2026-10-30). Va después de fbtb.
    gasExtras: ['pnl-accounting-fbtb.js', 'pnl-accounting-byprod.js'],
    // getEPMBaselineGoalData: la carga principal (en frío ~13 s en producción); depende solo de los filtros y de los canónicos, igual que getEPMBreakdown
    cacheFns: ['getEPMBaselineGoalData', 'getEPMBreakdown'],   // (se invalidan cuando cambia un archivo que lee el módulo)
    gasUrl: GAS_EXEC + 'AKfycby9WZK2HfAWx25M5pEMV3nntzJfEvsiT9feMn01zJQkQaI3t2GjTzOIjbFXWexnMuzklQ/exec',
  },
  {
    slug: 'pnl-managerial',
    dir: 'P&L_Managerial',
    title: 'P&L Managerial',
    desc: 'Vista gestional (FVM) B2B2C y B2B.',
    // Productivo en Ownia desde 2026-10-30 (Tiago), como P&L Accounting: Apps Script solo muestra el aviso con el link.
    // Sin allowedUsers: cualquier @despegar.com (el webapp GAS era access DOMAIN).
    ownia: true,
    // Sin vista consolidada B2B + B2B2C (el módulo no la tiene): el tercer acceso es Managerial vs Accounting.
    quickViews: [['b2b', 'B2B'], ['b2b2c', 'B2B2C'], ['vsacc', 'Managerial vs Accounting']],
    gasUrl: GAS_EXEC + 'AKfycbxHyP4uIh02zTQbQ7ZFbyByCVIYuREuiMJ74PnKhQbNGbWknCG2jxOtt_onafQcg5g4/exec',
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
    hideGasLink: true,   // 2026-10-28: sin el link "Versión Apps Script" en la tarjeta del menú (Diego)
    gasUrl: GAS_EXEC + 'AKfycbzGXCpL9_p70Xx7P640YgU-zOzoLG1018HG9N_pzQvrCJPHTPsUuryD_tDH1HNO41hOIg/exec',
  },
  {
    slug: 'okr-b2b2c',
    dir: 'OKR_Producto_B2B2C',
    title: 'OKR Producto B2B2C',
    desc: 'OKRs de la tribu Producto B2B2C.',
    // En validación (2026-10-30): corre acá en paralelo a GAS. Sin allowedUsers: cualquier @despegar.com, igual que
    // el webapp GAS (access DOMAIN). Los datos: okr_tribu_producto.json, que okr_sync.py sube a Drive y a Ownia
    // (server/gas-extras/okr-payload.js reemplaza la lectura de okr_data.js). Mismas secciones y formatos que en
    // GAS, con el diseño de Ownia (public/okr-layout.js). El código GAS del módulo no cambia.
    ownia: true,
    validating: true,
    hideGasLink: true,
    layout: 'okr-layout.js',
    gasExtras: ['okr-payload.js'],
    quickViews: [['q', 'Trimestral'], ['m', 'Mensual']],
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
