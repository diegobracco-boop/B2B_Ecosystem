// ══════════════════════════════════════════════════════════════
//  OKR — Configuración y cómputo
// ══════════════════════════════════════════════════════════════

// Definición de KRs y pesos por LoB, por semestre.
//   cumulative: true → el trimestre/semestre toma el punto final (no la suma mensual).
//   inverse: true    → menos es mejor (cumplimiento = target / actual).
//   El label de un KR sin lógica definida lleva "(WIP)": no tiene datos y queda en "—".
var OKR_CONFIG_H1 = {
  'b2b2c': {
    label: 'White Labels',
    krs: [
      { kr: 'sign new partnership',          label: 'Sign New Partnership',          weight: 20, cumulative: true },
      { kr: 'new account net revenues',       label: 'New Account Net Revenues',       weight: 15 },
      { kr: 'existing account net revenues',  label: 'Existing Account Net Revenues',  weight: 50 },
      { kr: 'operating contribution',           label: 'Operating Contribution',         weight: 15 }
    ]
  },
  'b2b': {
    label: 'B2B',
    krs: [
      { kr: 'monthly buying agencies',         label: 'Buyer Agencies',                  weight: 20 },
      { kr: 'net revenues core markets',       label: 'Net Revenue Core Markets',        weight: 40 },
      { kr: 'net revenues new markets',        label: 'Net Revenue New Markets',         weight: 20 },
      { kr: 'air net revenue from suppliers',  label: 'Air Net Revenue from suppliers',  weight: 20 }
    ]
  }
};

// H2 FY27 (oct-26 → mar-27). Definido 2026-09-24. Targets: Budget contable, salvo
// Deploy New Partnership / Unique Buyers / Accelerate Recurrence (target y actual desde
// la sheet Input_OKR; el actual pasará a queries más adelante).
// Hunting/Existing Account NR: sin datos ene-mar 2027 hasta que el Datalake tenga ese budget.
var OKR_CONFIG_H2 = {
  'b2b2c': {
    label: 'White Labels',
    krs: [
      { kr: 'deploy new partnership',         label: 'Deploy New Partnership',         weight: 20, cumulative: true },
      { kr: 'unique buyers',                  label: 'Unique Buyers',                  weight: 15 },
      { kr: 'existing account net revenues',  label: 'Existing Account Net Revenues',  weight: 15 },
      { kr: 'new account net revenues',       label: 'Hunting Net Revenue',            weight: 10 },
      { kr: 'operating contribution',         label: 'Operating Contribution',         weight: 40 }
    ]
  },
  'b2b': {
    label: 'B2B',
    krs: [
      { kr: 'net revenues b2b',               label: 'Net Revenue',                          weight: 30 },
      { kr: 'operating contribution api',     label: 'Operating Contribution API (MAY)',     weight: 20 },
      { kr: 'operating contribution html',    label: 'Operating Contribution HTML (MIN)',    weight: 20 },
      { kr: 'new product growth',             label: 'New Product Growth (estimado)',        weight: 15 },
      { kr: 'accelerate recurrence',          label: 'Accelerate Recurrence',                weight: 15 }
    ]
  },
  // Solo para la vista de KRs de HTML (canal MIN) del Hub: NPG estimado de HTML (okr_h2_builder.py, LoB "B2B HTML"). No se dibuja como bloque propio.
  'b2b html': {
    label: 'B2B HTML',
    krs: [
      { kr: 'new product growth html', label: 'New Product Growth HTML (estimado)', weight: 15 },
      { kr: 'accelerate recurrence html', label: 'Accelerate Recurrence', weight: 15 }   // mismo criterio que el Status KRs H2 del Tracker (okr_builder.recurrence_html_rows)
    ]
  },
  // KR Global B2B API (canal API · Hoteles), redefinidos 2026-10-21. Desde 2026-10-23 todo API, salvo Hoteles Directos LATAM (solo Others Countries; % Hoteles Directos Globales: todos los países desde 2026-10-30).
  // Conteos y % son stocks / fotos del mes → cumulative (último mes). NR API Hoteles es flujo
  // (suma, target = Budget contable). Price Competitiveness = adversidad → inverse.
  'globales': {
    label: 'KR Global B2B API',
    krs: [
      { kr: 'accelerate hunting partners api',                    label: 'Accelerate Hunting # Partners API',                  weight: 20, cumulative: true },
      { kr: 'hoteles directos vendidos destino latam',            label: 'Hoteles Directos vendidos destino LATAM',            weight: 15, cumulative: true },
      { kr: '% hoteles directos vendidos destino globales',       label: '% Hoteles Directos vendidos destino Globales',       weight: 15, cumulative: true, pct: true },
      { kr: 'net revenues api hoteles',                           label: 'Net Revenues API Hoteles',                           weight: 15 },
      { kr: 'new onboarded properties global & regional chains',  label: 'New Onboarded Properties Global & Regional Chains',  weight: 15, cumulative: true },
      { kr: 'price competitiveness ex-latam (destino gl)',        label: 'Price Competitiveness ex-Latam (Destino GL)',        weight: 20, cumulative: true, pct: true, inverse: true }
    ]
  },
  // KR Global B2B API — set NUEVO en propuesta (slide "B2B PoS Global API Hotels · Become a Global Bedbank", owner JP Martorell,
  // 2026-11-25, pedido de antonella.difranco). La landing muestra 'globales' o 'globales_nuevos' según el switch "KRs vigentes |
  // KRs nuevos" (localStorage 'okr_glob_set'); el vigente no se toca. PLACEHOLDER: no está en okr.json, las filas las arma
  // globalesNuevosRows_ (targets de GLOBALES_NUEVOS_TARGETS; actual provisorio del KR vigente equivalente donde hay uno).
  // Mismos KRs y targets que GLOBALES_KRS_NUEVOS_DEF del Daily (Daily_Dashboard/Codigo.js): si cambian, cambiar los dos.
  'globales_nuevos': {
    label: 'KR Global B2B API · nuevos (propuesta)',
    krs: [
      { kr: 'grow +44% api global clients portfolio',  label: 'Grow +44% API Global Clients Portfolio',  weight: 20, cumulative: true },
      { kr: '+6k new direct properties',               label: '+6k New Direct Properties',               weight: 20, cumulative: true },
      { kr: 'price competitiveness destino globales',  label: 'Price Competitiveness Destino Globales',  weight: 20, cumulative: true, pct: true, inverse: true },
      { kr: 'sales density on top 100 hotels',         label: 'Sales Density on Top 100 Hotels',         weight: 20, cumulative: true, pct: true },
      { kr: 'oc - costos atribuibles',                 label: 'OC - Costos atribuibles (por ahora solo OC)', weight: 20 }
    ]
  }
};

// Targets (Budget) del set nuevo, de la slide. OC - Costos atribuibles: TBD (sin filas). actual_de: KR vigente (lob 'globales') del
// que se copia el actual mientras no haya fuente propia (mismos targets en la slide).
var GLOBALES_NUEVOS_TARGETS = {
  'grow +44% api global clients portfolio': { t: { '2026-10':150, '2026-11':160, '2026-12':170, '2027-01':180, '2027-02':190, '2027-03':200 } },
  '+6k new direct properties':              { t: { '2026-10':250, '2026-11':1250, '2026-12':2000, '2027-01':3000, '2027-02':4000, '2027-03':6000 },
                                              actual_de: 'new onboarded properties global & regional chains' },
  'price competitiveness destino globales': { t: { '2026-10':52.2, '2026-11':50.1, '2026-12':46.7, '2027-01':42.8, '2027-02':40.2, '2027-03':39.2 },
                                              actual_de: 'price competitiveness ex-latam (destino gl)' },
  'sales density on top 100 hotels':        { t: { '2026-10':16, '2026-11':17, '2026-12':18, '2027-01':18.5, '2027-02':19.5, '2027-03':20 } }
};

// KRs del set nuevo con fuente propia (2026-11-25, "solo globales"):
//   - OC - Costos atribuibles = por ahora solo OC: Operating Contribution API (lob b2b) con país Others Countries, de OKR_H2_FY27.json
//     (Budget = target; actual = cierre contable o Run Rate, como el contable). Sin OKR_H2_FY27.json (fallback a okr.json, sin país) queda sin dato.
//   - Grow +44% API Global Clients Portfolio: partners_api_snapshots.json (Daily_Dashboard/partners_api_sync.py, campo hoteles_global):
//     mes congelado = Real; mes sin congelar = últimos 30 días (Rolling30), igual que el KR vigente Accelerate Hunting # Partners API.
// Mismas fuentes que el Daily (globalesNuevosFuentes_ en Daily_Dashboard/Codigo.js).
var PARTNERS_API_FOLDER_ID = '1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh';   // carpeta de los JSON del Daily (misma que WEEKLY_INSIGHTS_FOLDER_ID)
var PARTNERS_API_FILENAME  = 'partners_api_snapshots.json';
function globalesNuevosPartnersRows_() {
  var out = [];
  try {
    var files = DriveApp.getFolderById(PARTNERS_API_FOLDER_ID).getFilesByName(PARTNERS_API_FILENAME);
    if (!files.hasNext()) return out;
    var j = JSON.parse(files.next().getBlob().getDataAsString()), meses = j.meses || {}, seen = {};
    Object.keys(meses).forEach(function(ym) {
      if (typeof meses[ym].hoteles_global !== 'number') return;
      seen[ym] = true;
      out.push({ ym: ym, escenario: 'run rate/actuals', lob: 'globales_nuevos', kr: 'grow +44% api global clients portfolio',
                 valor: meses[ym].hoteles_global, estado: 'Real' });
    });
    var r = j.rolling30;
    if (r && typeof r.hoteles_global === 'number' && r.hasta && !seen[r.hasta.substring(0, 7)])
      out.push({ ym: r.hasta.substring(0, 7), escenario: 'run rate/actuals', lob: 'globales_nuevos', kr: 'grow +44% api global clients portfolio',
                 valor: r.hoteles_global, estado: 'Rolling30' });
  } catch (e) { Logger.log('globalesNuevosPartnersRows_: ' + e.message); }
  return out;
}

// Filas del set nuevo (lob 'globales_nuevos') para computeOKR_: Budget = targets de la slide; Run Rate/Actuals = copia de las filas
// del KR vigente de actual_de (las mismas que ve el bloque vigente). Los KRs sin fuente quedan sin actual (OKR_NOFILL_: no toman el target).
function globalesNuevosRows_(rows) {
  var out = globalesNuevosPartnersRows_();
  // OC - Costos atribuibles = por ahora solo OC (sin costos atribuibles): OC API · Others Countries (solo OKR_H2_FY27.json trae el país),
  // tomado IGUAL que el contable: Budget = target; Run Rate/Actuals = cierre contable (Estado "Actual") o Run Rate (Estado "Proyeccion").
  (rows || []).forEach(function(r) {
    if (r.lob === 'b2b' && r.kr === 'operating contribution api' && /^others? countries$/.test(String(r.pais || '').toLowerCase()))
      out.push(Object.assign({}, r, { lob: 'globales_nuevos', kr: 'oc - costos atribuibles' }));
  });
  Object.keys(GLOBALES_NUEVOS_TARGETS).forEach(function(kr) {
    var d = GLOBALES_NUEVOS_TARGETS[kr];
    Object.keys(d.t).forEach(function(ym) { out.push({ ym: ym, escenario: 'budget', lob: 'globales_nuevos', kr: kr, valor: d.t[ym] }); });
    if (!d.actual_de) return;
    (rows || []).forEach(function(r) {
      if (r.lob === 'globales' && r.kr === d.actual_de && r.escenario === 'run rate/actuals')
        out.push(Object.assign({}, r, { lob: 'globales_nuevos', kr: kr }));
    });
  });
  return out;
}

// Semestres del FY (arranca en abril). Q1 abr-jun · Q2 jul-sep · Q3 oct-dic · Q4 ene-mar.
// Los meses salen de fyMonths_() (Codigo.js); OKR_CONFIG_H1/H2 son los KRs de cada semestre.
var OKR_HALVES = {
  'H1': {
    label: 'H1',
    config: OKR_CONFIG_H1,
    quarters: [
      { label:'Q1', months: fyMonths_().slice(0, 3) },
      { label:'Q2', months: fyMonths_().slice(3, 6) }
    ],
    periods: fyMonths_().slice(0, 6)
  },
  'H2': {
    label: 'H2',
    config: OKR_CONFIG_H2,
    quarters: [
      { label:'Q3', months: fyMonths_().slice(6, 9) },
      { label:'Q4', months: fyMonths_().slice(9, 12) }
    ],
    periods: fyMonths_().slice(6, 12)
  }
};

// Semestre que abre por defecto: H2 desde el 1-oct-2026.
// Price Competitiveness ex-Latam: cumplimiento NO lineal. Por mes, 70% = target + ventana, 100% = target,
// 130% = target - ventana (pp de adversidad; tabla del OKR). Misma regla que pcRatio_ del Daily. Techo 130%.
var PC_WINDOWS_ = { '2026-10':[5.6,5.6], '2026-11':[5.4,5.4], '2026-12':[5.0,5.0],
                    '2027-01':[4.6,4.6], '2027-02':[4.3,4.3], '2027-03':[4.2,4.2] };
function pcRatio_(ym, t, a) {
  var w = PC_WINDOWS_[ym];
  if (!w || typeof t !== 'number' || typeof a !== 'number' || !isFinite(t) || !isFinite(a)) return null;
  var d = t - a;
  var x = d >= 0 ? 1 + 0.30 * d / w[1] : 1 + 0.30 * d / w[0];
  return Math.max(0, Math.min(x, 1.30));
}

function okrDefaultHalf_() {
  return (new Date() >= new Date(2026, 9, 1)) ? 'H2' : 'H1';
}

// Aliases para normalizar variantes de KR al nombre canónico del OKR_CONFIG
var OKR_KR_ALIASES = {
  'op. contribution':    'operating contribution',
  'op contribution':     'operating contribution',
  'operating contrib':   'operating contribution',
  'oc':                  'operating contribution',
  // Grafía que puede traer un okr.json viejo (cargada en la sheet) → nombre canónico de OKR_CONFIG_H2.
  // okr_builder.py ya normaliza estos nombres; el alias cubre archivos generados antes.
  'hoteles directo vendidos destino latam':    'hoteles directos vendidos destino latam',
  'accelerate hunting # partners api':         'accelerate hunting partners api'
};

// okr.json canónico (Inputs_Planning_PnL/okr_builder.py) — fuente única, ya trae
// todos los KRs calculados (automáticos + manuales de Sign New Partnership /
// Monthly Buying Agencies). Reemplaza los reads directos de actuals/runrate/
// budget/daily_b2b2c/gestional + la lectura en vivo de la sheet OKR.
var OKR_FILE_ID = '1cEidr8aoYgm4S7ugm05Wv-SMnz8GbtUj';

// H1 FY27 (abr-sep 2026) está cerrado y congelado en OKR_H1_FY27.json (Inputs_Planning_PnL/okr_h1_freeze.py):
// el OKR de H1 se arma SIEMPRE de ese archivo, no de okr.json. Valores en USD nominales, sin organic.
var OKR_H1_FILE_ID = '1wMCfuE8m8slzTN0CrWzoxJjTWOT9IMcf';

// H2 FY27 (oct-2026 -> mar-2027): OKR_H2_FY27.json (Inputs_Planning_PnL/okr_h2_builder.py). Mismo formato que okr.json + Pais
// abierto en los KRs contables y una columna Estado (Actual / Proyeccion / MTD / Real / Manual / Budget). El Hub lo usa para aplicar
// organic (conversion por pais y mes) al leer. Si no se puede leer, H2 sale de okr.json (Pais = Total, sin organic).
var OKR_H2_FILE_ID = '1lsMF9_d1t55boO8Wr8vziMsFT9LQioov';

// KRs monetarios del contable: los unicos que se convierten con organic (el resto son conteos / %).
var OKR_MONETARY_KRS_ = {
  'operating contribution': true, 'net revenues b2b': true, 'operating contribution api': true,
  'operating contribution html': true, 'net revenues api hoteles': true,
  'new account net revenues': true, 'existing account net revenues': true, 'new product growth': true, 'new product growth html': true
};

// KRs que NO toman el target cuando no hay actual (Diego 2026-10-27): Deploy New Partnership = lo que diga Input_OKR, estricto.
// Onboarded Properties NO va acá: hasta definir la fuente del actual, el actual = budget (100%, en cursiva). Price Competitiveness tampoco:
// su actual sale del Datalake (última semana cerrada del mes, desde 2026-11-02); el mes sin semana cerrada todavía toma el target (cursiva).
var OKR_NOFILL_ = {
  'deploy new partnership': true,
  // Set nuevo del KR Global B2B API (placeholder): sin fuente todavía; sin actual se ve "— / target", no un 100% falso.
  // Los dos con actual provisorio tampoco: un mes sin dato del KR vigente queda "—", igual que en el Daily y el Tracker.
  'grow +44% api global clients portfolio': true,
  '+6k new direct properties': true,
  'price competitiveness destino globales': true,
  'sales density on top 100 hotels': true,
  'oc - costos atribuibles': true   // cierre contable o Run Rate todos los meses; igual, un mes sin dato no toma el target
};

function readOKRH2Json_() {
  var cache = CacheService.getScriptCache();
  var file  = DriveApp.getFileById(OKR_H2_FILE_ID);
  var cKey  = 'okr_h2_v1_' + file.getLastUpdated().getTime();
  var hit   = cache.get(cKey);
  if (hit) { try { return JSON.parse(hit); } catch(e) {} }
  var json = JSON.parse(file.getBlob().getDataAsString());
  var cols = json.cols;
  var iP = cols.indexOf('Periodo'), iE = cols.indexOf('Escenario'), iL = cols.indexOf('LoB'), iPa = cols.indexOf('Pais'),
      iK = cols.indexOf('KR'), iV = cols.indexOf('Valor'), iS = cols.indexOf('Estado');
  var rows = json.rows.map(function(r) {
    var krRaw = String(r[iK]||'').trim().toLowerCase();
    return {
      ym:        String(r[iP]||'').substring(0, 7),
      escenario: String(r[iE]||'').trim().toLowerCase(),
      lob:       String(r[iL]||'').trim().toLowerCase(),
      pais:      String(r[iPa]||'').trim(),
      kr:        OKR_KR_ALIASES[krRaw] || krRaw,
      valor:     Number(r[iV]) || 0,
      estado:    iS >= 0 ? String(r[iS]||'') : ''
    };
  });
  try { cache.put(cKey, JSON.stringify(rows), 21600); } catch(e) {}
  return rows;
}

// ORGANIC del OKR (H2): USD x TC Actuals(pais, mes) / TC Budget(pais, mes), solo para los KRs monetarios en "Run Rate/Actuals"
// (el Budget ya esta a TC Budget). Mismo motor y TC que Monthly Results (readFxTable_, Codigo.js): OPS+RG usa el TC de Brasil;
// paises sin TC (Globales, ...) quedan sin convertir. Devuelve filas nuevas (no muta las del cache) + missing.
function applyOrganicOKR_(rows) {
  var fx = readFxTable_();
  var act = fx.actuals, tgt = fx.budget;
  var paisesFx = {};
  Object.keys(act).forEach(function(k) { paisesFx[k.split('§')[0]] = true; });
  var missing = {};
  var out = rows.map(function(r) {
    if (r.escenario !== 'run rate/actuals' || !OKR_MONETARY_KRS_[r.kr]) return r;
    var pai = _fxNorm_(r.pais);
    pai = _FX_PAIS_ALIAS_[pai] || pai;
    if (!pai || pai === 'total' || !paisesFx[pai]) return r;
    var a = act[pai + '§' + r.ym], t = tgt[pai + '§' + r.ym];
    if (!a || !t) { missing[pai + ' ' + r.ym] = true; return r; }
    var c = Object.assign({}, r);
    c.valor = r.valor * a / t;
    return c;
  });
  return { rows: out, missing: Object.keys(missing).sort() };
}

// Lee okr.json de Drive (o, con fileId, otro archivo con el mismo formato) y devuelve rows {ym, escenario, lob, kr, valor}
// Cache key incluye el lastUpdated del archivo → cuando okr_builder.py sube una
// versión nueva, la landing la toma en el próximo request (no hay que esperar TTL).
function readOKRJson_(fileId, cachePrefix) {
  var cache = CacheService.getScriptCache();
  var file  = DriveApp.getFileById(fileId || OKR_FILE_ID);
  var cKey  = (cachePrefix || 'okr_json_v5_') + file.getLastUpdated().getTime();   // v5: % directos Globales vuelve a hoteles (sin el reemplazo por GB de v4)
  var hit   = cache.get(cKey);
  if (hit) { try { return JSON.parse(hit); } catch(e) {} }

  var json = JSON.parse(file.getBlob().getDataAsString());
  var cols = json.cols;
  var iP = cols.indexOf('Periodo'), iE = cols.indexOf('Escenario'),
      iL = cols.indexOf('LoB'), iK = cols.indexOf('KR'), iV = cols.indexOf('Valor');

  var rows = json.rows.map(function(r) {
    var krRaw = String(r[iK]||'').trim().toLowerCase();
    return {
      ym:        String(r[iP]||'').substring(0, 7),
      escenario: String(r[iE]||'').trim().toLowerCase(),
      lob:       String(r[iL]||'').trim().toLowerCase(),
      kr:        OKR_KR_ALIASES[krRaw] || krRaw,
      valor:     Number(r[iV]) || 0
    };
  });

  try { cache.put(cKey, JSON.stringify(rows), 21600); } catch(e) {}  // 6h; el key se invalida solo por ts
  return rows;
}

// Calcular achievement por KR / período
// opts.fillTarget: un mes SIN actual pero con target toma el target como actual (cumplimiento neutro, definido por Diego
// 2026-10-27 para H2); esos meses se marcan en monthlyImputed. Las filas pueden traer `estado` (OKR_H2_FY27.json).
function computeOKR_(halfKey, rows, opts) {
  opts = opts || {};
  var half     = OKR_HALVES[halfKey];
  var cfgAll   = half.config;
  var periods  = half.periods;
  var quarters = half.quarters;
  if (!rows || !rows.length) return null;

  // Agregar por lob§kr§escenario§ym
  var agg = {}, estAgg = {};
  rows.forEach(function(r) {
    var k = r.lob+'§'+r.kr+'§'+r.escenario+'§'+r.ym;
    agg[k] = (agg[k]||0) + r.valor;
    if (r.estado && (!estAgg[k] || r.estado === 'Proyeccion')) estAgg[k] = r.estado;
  });

  function getVal(lob, kr, esc, ym) {
    var v = agg[lob+'§'+kr+'§'+esc+'§'+ym];
    return v !== undefined ? v : null;
  }
  // Actual con la regla "sin dato = target" (solo si opts.fillTarget y el mes tiene target)
  function getAct(lob, kr, ym, imputed) {
    var v = getVal(lob, kr, 'run rate/actuals', ym);
    if (v === null && opts.fillTarget && !OKR_NOFILL_[kr]) {
      var b = getVal(lob, kr, 'budget', ym);
      if (b !== null) { if (imputed) imputed[ym] = true; return b; }
    }
    return v;
  }

  var ESC_ACT = 'run rate/actuals';   // tal como figura en el sheet
  var ESC_BUD = 'budget';

  var result = {};

  Object.keys(cfgAll).forEach(function(lobKey) {
    var cfg = cfgAll[lobKey];

    var krRows = cfg.krs.map(function(krDef) {
      // Valores crudos mensuales
      var imputedMonths = {};
      var mAct = periods.map(function(ym){ return getAct(lobKey, krDef.kr, ym, imputedMonths); });
      var mEstado = periods.map(function(ym){ return estAgg[lobKey+'§'+krDef.kr+'§'+ESC_ACT+'§'+ym] || null; });
      var mBud = periods.map(function(ym){ return getVal(lobKey, krDef.kr, ESC_BUD, ym); });

      // Achievement mensual (%)
      var monthly = mAct.map(function(a, i) { return pctOf_({ a: a, b: mBud[i] }, periods[i]); });

      // Agregación de un conjunto de meses (trimestre o semestre). Actual y Budget se comparan
      // sobre los MISMOS meses: los que tienen actual (y budget) cargado. Así un período en curso
      // mide lo transcurrido y no actual parcial vs budget completo (auditoría 2026-09-25).
      //   cumulative → último mes CON actual del período, y el budget de ese mismo mes
      //                (stock: partners, hoteles, deploys). Antes tomaba el último mes del
      //                período y quedaba en null hasta cargar diciembre/marzo.
      //   avg        → promedio de los meses con dato (ratios, ej. NR %GB)
      //   default    → suma de los meses con dato
      function aggPair_(months) {
        var both = months.filter(function(ym) {
          return getAct(lobKey, krDef.kr, ym) !== null && getVal(lobKey, krDef.kr, ESC_BUD, ym) !== null;
        });
        if (!both.length) {
          // H2: KR sin actual (a la espera de la fuente) pero con target -> se muestra el target ("— / target"), sin cumplimiento.
          if (opts.fillTarget) {
            var bm = months.filter(function(ym) { return getVal(lobKey, krDef.kr, ESC_BUD, ym) !== null; });
            if (bm.length) {
              if (krDef.cumulative) return { a: null, b: getVal(lobKey, krDef.kr, ESC_BUD, bm[bm.length - 1]) };
              var sb0 = 0;
              bm.forEach(function(ym) { sb0 += getVal(lobKey, krDef.kr, ESC_BUD, ym); });
              return { a: null, b: krDef.avg ? sb0 / bm.length : sb0 };
            }
          }
          return { a: null, b: null };
        }
        if (krDef.cumulative) {
          // Stock: el último mes con actual REAL (y su budget). Solo si no hay ninguno se usa el último mes con target
          // y el actual imputado (sin dato = target); si no, un mes futuro imputado taparía el dato real del mes en curso.
          var realBoth = months.filter(function(ym) {
            return getVal(lobKey, krDef.kr, ESC_ACT, ym) !== null && getVal(lobKey, krDef.kr, ESC_BUD, ym) !== null;
          });
          var last = (realBoth.length ? realBoth : both)[(realBoth.length ? realBoth : both).length - 1];
          return { a: getAct(lobKey, krDef.kr, last), b: getVal(lobKey, krDef.kr, ESC_BUD, last), ym: last };
        }
        var sa = 0, sb = 0;
        both.forEach(function(ym) { sa += getAct(lobKey, krDef.kr, ym); sb += getVal(lobKey, krDef.kr, ESC_BUD, ym); });
        return krDef.avg ? { a: sa / both.length, b: sb / both.length } : { a: sa, b: sb };
      }
      function pctOf_(p, ym) {
        if (p.a === null || p.b === null) return null;
        // Price Competitiveness: cumplimiento por ventana entre puntos de adversidad (no lineal), ver pcRatio_
        if (krDef.inverse && (ym || p.ym) && pcRatio_(ym || p.ym, p.b, p.a) !== null) return pcRatio_(ym || p.ym, p.b, p.a) * 100;
        if (krDef.inverse) return p.a !== 0 ? p.b / p.a * 100 : null;
        return p.b !== 0 ? p.a / p.b * 100 : null;
      }

      // Valores crudos trimestrales + achievement %
      var qPairs = quarters.map(function(q) { return aggPair_(q.months); });
      var quarterlyAct = qPairs.map(function(p) { return p.a; });
      var quarterlyBud = qPairs.map(function(p) { return p.b; });
      var quarterly = qPairs.map(function(p) { return pctOf_(p); });

      // Valores crudos del semestre + achievement %
      var hPair = aggPair_(periods);
      var halfActVal = hPair.a, halfBudVal = hPair.b;
      var halfPct = pctOf_(hPair);

      return { label: krDef.label, weight: krDef.weight, pct: !!krDef.pct,
               monthly: monthly, quarterly: quarterly, half: halfPct,
               monthlyAct: mAct, monthlyBud: mBud,
               monthlyEstado: mEstado,
               monthlyImputed: periods.map(function(ym){ return !!imputedMonths[ym]; }),
               quarterlyAct: quarterlyAct, quarterlyBud: quarterlyBud,
               halfAct: halfActVal, halfBud: halfBudVal };
    });

    // Total ponderado = Σ(score_i × peso_i) / Σ(peso_i de los KRs CON dato), donde score_i es el
    // cumplimiento capeado a 130% y 0 si queda debajo de 70%. Los KRs sin dato (WIP o sin cargar)
    // no entran al denominador — decisión de Diego 2026-09-25, mismo criterio que el Flow del Daily.
    // cov = % del peso total que tiene dato (se muestra como tooltip en la fila Total).
    function weighted_(getPct) {
      var wS = 0, wUsed = 0, wAll = 0;
      krRows.forEach(function(kr) {
        wAll += kr.weight;
        var p = getPct(kr);
        if (p !== null) { wS += (p < 70 ? 0 : Math.min(p, 130)) * kr.weight; wUsed += kr.weight; }
      });
      return { total: wUsed ? wS / wUsed : null, cov: wAll ? wUsed / wAll * 100 : 0 };
    }
    var tM = periods.map(function(ym, i) { return weighted_(function(kr) { return kr.monthly[i]; }); });
    var tQ = quarters.map(function(q, qi) { return weighted_(function(kr) { return kr.quarterly[qi]; }); });
    var tH = weighted_(function(kr) { return kr.half; });
    var totalMonthly   = tM.map(function(t) { return t.total; });
    var totalQuarterly = tQ.map(function(t) { return t.total; });
    var halfTotal      = tH.total;

    result[lobKey] = {
      label:          cfg.label,
      half:           half.label,
      quarters:       quarters.map(function(q){ return q.label; }),
      periods:        periods,
      krs:            krRows,
      totalMonthly:   totalMonthly,
      totalQuarterly: totalQuarterly,
      halfTotal:      halfTotal,
      covMonthly:     tM.map(function(t) { return t.cov; }),
      covQuarterly:   tQ.map(function(t) { return t.cov; }),
      halfCov:        tH.cov
    };
  });

  return result;
}

// Punto de entrada público. Devuelve ambos semestres: H1 del JSON congelado (OKR_H1_FY27.json) y H2 de okr.json,
// y el que abre por defecto. `okr` = el semestre por defecto (compatibilidad).
function getOKRData(params) {
  try {
    var orgOn = !!(params && params.organic === 'budget');
    var rows = readOKRJson_();
    var rowsH1;
    try { rowsH1 = readOKRJson_(OKR_H1_FILE_ID, 'okr_h1_v1_'); }
    catch (e) {
      // okr_builder.py copia el H1 congelado a okr.json, así que es el mismo dato: respaldo si el archivo no se puede leer.
      Logger.log('getOKRData: no se pudo leer OKR_H1_FY27.json (' + e.message + ') — H1 de okr.json');
      rowsH1 = rows;
    }
    // H2: OKR_H2_FY27.json (detalle por pais, Estado, organic); si no se puede leer, okr.json (sin organic)
    var rowsH2 = rows, h2Source = 'okr.json', organic = null;
    try { rowsH2 = readOKRH2Json_(); h2Source = 'OKR_H2_FY27.json'; }
    catch (e) { Logger.log('getOKRData: no se pudo leer OKR_H2_FY27.json (' + e.message + ') — H2 de okr.json'); }
    if (orgOn && h2Source === 'OKR_H2_FY27.json') {
      try {
        var o = applyOrganicOKR_(rowsH2);
        rowsH2 = o.rows;
        organic = { target: 'budget', missing: o.missing };
      } catch (e) {
        organic = { target: 'budget', error: 'No se pudo leer el archivo de tipos de cambio: ' + e.message };
      }
    }
    rowsH2 = rowsH2.concat(globalesNuevosRows_(rowsH2));   // set nuevo del KR Global B2B API (switch de la landing)
    var byHalf = {};
    Object.keys(OKR_HALVES).forEach(function(h){
      byHalf[h] = h === 'H1' ? computeOKR_(h, rowsH1) : computeOKR_(h, rowsH2, { fillTarget: true });
    });
    var def = okrDefaultHalf_();
    return { success: true, okr: byHalf[def], okrByHalf: byHalf, defaultHalf: def, h2Source: h2Source, organic: organic };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ── Debug: ejecutar manualmente desde el editor para diagnosticar ──
function diagOKR() {
  var rows = readOKRJson_();
  var uniqueLobs = {}, uniqueEsc = {}, uniqueKrs = {}, uniqueYms = {};
  rows.forEach(function(r) {
    uniqueLobs[r.lob] = true;
    uniqueEsc[r.escenario] = true;
    uniqueKrs[r.kr] = true;
    uniqueYms[r.ym] = true;
  });
  Logger.log('Total filas leidas de okr.json: ' + rows.length);
  Logger.log('LOBs unicos: '       + JSON.stringify(Object.keys(uniqueLobs)));
  Logger.log('Escenarios unicos: ' + JSON.stringify(Object.keys(uniqueEsc)));
  Logger.log('KRs unicos: '        + JSON.stringify(Object.keys(uniqueKrs)));
  Logger.log('Periodos unicos: '   + JSON.stringify(Object.keys(uniqueYms).sort()));
  Logger.log('Primeras 5 filas: '  + JSON.stringify(rows.slice(0,5)));

  Object.keys(OKR_HALVES).forEach(function(h) {
    var okr = computeOKR_(h, rows);
    Logger.log(h + ' → computeOKR_ retorna null: ' + (okr === null));
    if (okr) Logger.log(h + ' → LOBs en resultado: ' + JSON.stringify(Object.keys(okr)));
  });
}
