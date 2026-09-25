// ══════════════════════════════════════════════════════════════
//  OKR — Configuración y cómputo
// ══════════════════════════════════════════════════════════════

// Definición de KRs y pesos por LoB, por semestre.
//   cumulative: true → el trimestre/semestre toma el punto final (no la suma mensual).
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
      { kr: 'existing account net revenues',  label: 'Existing Account Net Revenues',  weight: 25 },
      { kr: 'new account net revenues',       label: 'Hunting Net Revenue',            weight: 15 },
      { kr: 'operating contribution',         label: 'Operating Contribution',         weight: 25 }
    ]
  },
  'b2b': {
    label: 'B2B',
    krs: [
      { kr: 'net revenues b2b',               label: 'Net Revenue',                          weight: 30 },
      { kr: 'operating contribution api',     label: 'Operating Contribution API (MAY)',     weight: 20 },
      { kr: 'operating contribution html',    label: 'Operating Contribution HTML (MIN)',    weight: 20 },
      { kr: 'new product growth',             label: 'New Product Growth (WIP)',             weight: 15 },
      { kr: 'accelerate recurrence',          label: 'Accelerate Recurrence',                weight: 15 }
    ]
  },
  // Globales B2B API (Others Countries · canal API · Hoteles). Los conteos son stocks →
  // cumulative (último mes). NR %GB es un ratio → avg + pct. Los dos de GB son WIP.
  'globales': {
    label: 'Globales B2B API',
    krs: [
      { kr: 'accelerate hunting partners api',             label: 'Accelerate Hunting Partners API',                    weight: 30, cumulative: true },
      { kr: 'hoteles directos vendidos destino latam',     label: 'Hoteles Directos vendidos destino LATAM',            weight: 20, cumulative: true },
      { kr: 'gb b2b api hoteles - destino latam',          label: 'GB B2B API Hoteles - destino LATAM (WIP)',           weight: 10 },
      { kr: 'hoteles directos vendidos destino no latam',  label: 'Hoteles Directos vendidos destino NO LATAM',         weight: 20, cumulative: true },
      { kr: 'gb b2b api hoteles - destino no latam',       label: 'GB B2B API Hoteles - destino NO LATAM (WIP)',        weight: 5 },
      { kr: 'net revenue api hoteles %gb',                 label: 'Net Revenue API Hoteles %GB',                        weight: 15, avg: true, pct: true }
    ]
  }
};

// Semestres FY27 (el FY arranca en abril). Q1 abr-jun · Q2 jul-sep · Q3 oct-dic · Q4 ene-mar.
var OKR_HALVES = {
  'H1': {
    label: 'H1',
    config: OKR_CONFIG_H1,
    quarters: [
      { label:'Q1', months:['2026-04','2026-05','2026-06'] },
      { label:'Q2', months:['2026-07','2026-08','2026-09'] }
    ],
    periods: ['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09']
  },
  'H2': {
    label: 'H2',
    config: OKR_CONFIG_H2,
    quarters: [
      { label:'Q3', months:['2026-10','2026-11','2026-12'] },
      { label:'Q4', months:['2027-01','2027-02','2027-03'] }
    ],
    periods: ['2026-10','2026-11','2026-12','2027-01','2027-02','2027-03']
  }
};

// Semestre que abre por defecto: H2 desde el 1-oct-2026.
function okrDefaultHalf_() {
  return (new Date() >= new Date(2026, 9, 1)) ? 'H2' : 'H1';
}

// Aliases para normalizar variantes de KR al nombre canónico del OKR_CONFIG
var OKR_KR_ALIASES = {
  'op. contribution':    'operating contribution',
  'op contribution':     'operating contribution',
  'operating contrib':   'operating contribution',
  'oc':                  'operating contribution',
  // Grafía cargada en la sheet Input_OKR → nombre canónico de OKR_CONFIG_H2
  'hoteles directo vendidos destino latam':    'hoteles directos vendidos destino latam',
  'hoteles directo vendidos destino no latam': 'hoteles directos vendidos destino no latam'
};

// okr.json canónico (Inputs_Planning_PnL/okr_builder.py) — fuente única, ya trae
// todos los KRs calculados (automáticos + manuales de Sign New Partnership /
// Monthly Buying Agencies). Reemplaza los reads directos de actuals/runrate/
// budget/daily_b2b2c/gestional + la lectura en vivo de la sheet OKR.
var OKR_FILE_ID = '1cEidr8aoYgm4S7ugm05Wv-SMnz8GbtUj';

// Lee okr.json de Drive y devuelve rows {ym, escenario, lob, kr, valor}
// Cache key incluye el lastUpdated del archivo → cuando okr_builder.py sube una
// versión nueva, la landing la toma en el próximo request (no hay que esperar TTL).
function readOKRJson_() {
  var cache = CacheService.getScriptCache();
  var file  = DriveApp.getFileById(OKR_FILE_ID);
  var cKey  = 'okr_json_v2_' + file.getLastUpdated().getTime();
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
function computeOKR_(halfKey, rows) {
  var half     = OKR_HALVES[halfKey];
  var cfgAll   = half.config;
  var periods  = half.periods;
  var quarters = half.quarters;
  if (!rows || !rows.length) return null;

  // Agregar por lob§kr§escenario§ym
  var agg = {};
  rows.forEach(function(r) {
    var k = r.lob+'§'+r.kr+'§'+r.escenario+'§'+r.ym;
    agg[k] = (agg[k]||0) + r.valor;
  });

  function getVal(lob, kr, esc, ym) {
    var v = agg[lob+'§'+kr+'§'+esc+'§'+ym];
    return v !== undefined ? v : null;
  }

  var ESC_ACT = 'run rate/actuals';   // tal como figura en el sheet
  var ESC_BUD = 'budget';

  var result = {};

  Object.keys(cfgAll).forEach(function(lobKey) {
    var cfg = cfgAll[lobKey];

    var krRows = cfg.krs.map(function(krDef) {
      // Valores crudos mensuales
      var mAct = periods.map(function(ym){ return getVal(lobKey, krDef.kr, ESC_ACT, ym); });
      var mBud = periods.map(function(ym){ return getVal(lobKey, krDef.kr, ESC_BUD, ym); });

      // Achievement mensual (%)
      var monthly = mAct.map(function(a, i) {
        var b = mBud[i];
        if (a===null || b===null || b===0) return null;
        return a / b * 100;
      });

      // Agregación de un conjunto de meses (trimestre o semestre):
      //   cumulative → punto final (stock: partners, hoteles, deploys)
      //   avg        → promedio de los meses con dato (ratios, ej. NR %GB)
      //   default    → suma mensual
      function aggMonths_(esc, months) {
        if (krDef.cumulative) return getVal(lobKey, krDef.kr, esc, months[months.length-1]);
        var sum=0, n=0;
        months.forEach(function(ym){ var v=getVal(lobKey, krDef.kr, esc, ym); if (v!==null) { sum+=v; n++; } });
        if (!n) return null;
        return krDef.avg ? sum / n : sum;
      }

      // Valores crudos trimestrales + achievement %
      var quarterlyAct = quarters.map(function(q) { return aggMonths_(ESC_ACT, q.months); });
      var quarterlyBud = quarters.map(function(q) { return aggMonths_(ESC_BUD, q.months); });
      var quarterly = quarterlyAct.map(function(a, i) {
        var b = quarterlyBud[i];
        return (a!==null && b!==null && b!==0) ? a/b*100 : null;
      });

      // Valores crudos del semestre + achievement %
      var halfActVal = aggMonths_(ESC_ACT, periods);
      var halfBudVal = aggMonths_(ESC_BUD, periods);
      var halfPct = (halfActVal!==null && halfBudVal!==null && halfBudVal!==0) ? halfActVal/halfBudVal*100 : null;

      return { label: krDef.label, weight: krDef.weight, pct: !!krDef.pct,
               monthly: monthly, quarterly: quarterly, half: halfPct,
               monthlyAct: mAct, monthlyBud: mBud,
               quarterlyAct: quarterlyAct, quarterlyBud: quarterlyBud,
               halfAct: halfActVal, halfBud: halfBudVal };
    });

    // Total ponderado mensual = Σ(min(achievement_i,130) × weight_i) / 100
    // Cada KR capeado al 130% de cumplimiento
    var totalMonthly = periods.map(function(ym, i) {
      var wS = 0, hasAny = false;
      krRows.forEach(function(kr) {
        if (kr.monthly[i] !== null) { wS += (kr.monthly[i] < 70 ? 0 : Math.min(kr.monthly[i], 130)) * kr.weight; hasAny = true; }
      });
      return hasAny ? wS / 100 : null;
    });

    // Total ponderado trimestral = Σ(min(achievement_i,130) × weight_i) / 100
    var totalQuarterly = quarters.map(function(q, qi) {
      var wS = 0, hasAny = false;
      krRows.forEach(function(kr) {
        if (kr.quarterly[qi] !== null) { wS += (kr.quarterly[qi] < 70 ? 0 : Math.min(kr.quarterly[qi], 130)) * kr.weight; hasAny = true; }
      });
      return hasAny ? wS / 100 : null;
    });

    // Total ponderado del semestre = Σ(min(half_i,130) × weight_i) / 100
    var halfTotal = (function() {
      var wS=0, hasAny=false;
      krRows.forEach(function(kr) {
        if (kr.half !== null) { wS += (kr.half < 70 ? 0 : Math.min(kr.half, 130)) * kr.weight; hasAny = true; }
      });
      return hasAny ? wS / 100 : null;
    })();

    result[lobKey] = {
      label:          cfg.label,
      half:           half.label,
      quarters:       quarters.map(function(q){ return q.label; }),
      periods:        periods,
      krs:            krRows,
      totalMonthly:   totalMonthly,
      totalQuarterly: totalQuarterly,
      halfTotal:        halfTotal
    };
  });

  return result;
}

// Punto de entrada público. Devuelve ambos semestres (una sola lectura de okr.json)
// y el que abre por defecto. `okr` = el semestre por defecto (compatibilidad).
function getOKRData() {
  try {
    var rows = readOKRJson_();
    var byHalf = {};
    Object.keys(OKR_HALVES).forEach(function(h){ byHalf[h] = computeOKR_(h, rows); });
    var def = okrDefaultHalf_();
    return { success: true, okr: byHalf[def], okrByHalf: byHalf, defaultHalf: def };
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
