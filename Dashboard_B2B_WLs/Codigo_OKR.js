// ══════════════════════════════════════════════════════════════
//  OKR — Configuración y cómputo
// ══════════════════════════════════════════════════════════════

// Definición de KRs y pesos por LoB
var OKR_CONFIG = {
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

// OKRs aplican solo H1 FY27: Abril → Septiembre 2026
var OKR_QUARTERS = [
  { label:'Q1', months:['2026-04','2026-05','2026-06'] },
  { label:'Q2', months:['2026-07','2026-08','2026-09'] }
];

var OKR_FY_PERIODS = ['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'];

// Aliases para normalizar variantes de KR al nombre canónico del OKR_CONFIG
var OKR_KR_ALIASES = {
  'op. contribution':    'operating contribution',
  'op contribution':     'operating contribution',
  'operating contrib':   'operating contribution',
  'oc':                  'operating contribution'
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
function computeOKR_() {
  var rows = readOKRJson_();
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

  Object.keys(OKR_CONFIG).forEach(function(lobKey) {
    var cfg = OKR_CONFIG[lobKey];

    var krRows = cfg.krs.map(function(krDef) {
      // Valores crudos mensuales
      var mAct = OKR_FY_PERIODS.map(function(ym){ return getVal(lobKey, krDef.kr, ESC_ACT, ym); });
      var mBud = OKR_FY_PERIODS.map(function(ym){ return getVal(lobKey, krDef.kr, ESC_BUD, ym); });

      // Achievement mensual (%)
      var monthly = mAct.map(function(a, i) {
        var b = mBud[i];
        if (a===null || b===null || b===0) return null;
        return a / b * 100;
      });

      // Valores crudos trimestrales + achievement %
      // cumulative=true → punto final del trimestre; default → suma mensual
      var quarterlyAct = OKR_QUARTERS.map(function(q) {
        if (krDef.cumulative) return getVal(lobKey, krDef.kr, ESC_ACT, q.months[q.months.length-1]);
        var sum=0, ok=false;
        q.months.forEach(function(ym){var v=getVal(lobKey,krDef.kr,ESC_ACT,ym); if(v!==null){sum+=v;ok=true;}});
        return ok ? sum : null;
      });
      var quarterlyBud = OKR_QUARTERS.map(function(q) {
        if (krDef.cumulative) return getVal(lobKey, krDef.kr, ESC_BUD, q.months[q.months.length-1]);
        var sum=0, ok=false;
        q.months.forEach(function(ym){var v=getVal(lobKey,krDef.kr,ESC_BUD,ym); if(v!==null){sum+=v;ok=true;}});
        return ok ? sum : null;
      });
      var quarterly = quarterlyAct.map(function(a, i) {
        var b = quarterlyBud[i];
        return (a!==null && b!==null && b!==0) ? a/b*100 : null;
      });

      // Valores crudos H1 + achievement %
      // cumulative=true → último mes del H1 (septiembre); default → suma H1
      var h1ActVal = (function() {
        if (krDef.cumulative) return getVal(lobKey, krDef.kr, ESC_ACT, OKR_FY_PERIODS[OKR_FY_PERIODS.length-1]);
        var sum=0, ok=false;
        OKR_FY_PERIODS.forEach(function(ym){var v=getVal(lobKey,krDef.kr,ESC_ACT,ym); if(v!==null){sum+=v;ok=true;}});
        return ok ? sum : null;
      })();
      var h1BudVal = (function() {
        if (krDef.cumulative) return getVal(lobKey, krDef.kr, ESC_BUD, OKR_FY_PERIODS[OKR_FY_PERIODS.length-1]);
        var sum=0, ok=false;
        OKR_FY_PERIODS.forEach(function(ym){var v=getVal(lobKey,krDef.kr,ESC_BUD,ym); if(v!==null){sum+=v;ok=true;}});
        return ok ? sum : null;
      })();
      var h1 = (h1ActVal!==null && h1BudVal!==null && h1BudVal!==0) ? h1ActVal/h1BudVal*100 : null;

      return { label: krDef.label, weight: krDef.weight,
               monthly: monthly, quarterly: quarterly, h1: h1,
               monthlyAct: mAct, monthlyBud: mBud,
               quarterlyAct: quarterlyAct, quarterlyBud: quarterlyBud,
               h1Act: h1ActVal, h1Bud: h1BudVal };
    });

    // Total ponderado mensual = Σ(min(achievement_i,130) × weight_i) / 100
    // Cada KR capeado al 130% de cumplimiento
    var totalMonthly = OKR_FY_PERIODS.map(function(ym, i) {
      var wS = 0, hasAny = false;
      krRows.forEach(function(kr) {
        if (kr.monthly[i] !== null) { wS += (kr.monthly[i] < 70 ? 0 : Math.min(kr.monthly[i], 130)) * kr.weight; hasAny = true; }
      });
      return hasAny ? wS / 100 : null;
    });

    // Total ponderado trimestral = Σ(min(achievement_i,130) × weight_i) / 100
    var totalQuarterly = OKR_QUARTERS.map(function(q, qi) {
      var wS = 0, hasAny = false;
      krRows.forEach(function(kr) {
        if (kr.quarterly[qi] !== null) { wS += (kr.quarterly[qi] < 70 ? 0 : Math.min(kr.quarterly[qi], 130)) * kr.weight; hasAny = true; }
      });
      return hasAny ? wS / 100 : null;
    });

    // Total ponderado H1 = Σ(min(h1_i,130) × weight_i) / 100
    var h1Total = (function() {
      var wS=0, hasAny=false;
      krRows.forEach(function(kr) {
        if (kr.h1 !== null) { wS += (kr.h1 < 70 ? 0 : Math.min(kr.h1, 130)) * kr.weight; hasAny = true; }
      });
      return hasAny ? wS / 100 : null;
    })();

    result[lobKey] = {
      label:          cfg.label,
      quarters:       OKR_QUARTERS.map(function(q){ return q.label; }),
      periods:        OKR_FY_PERIODS,
      krs:            krRows,
      totalMonthly:   totalMonthly,
      totalQuarterly: totalQuarterly,
      h1Total:        h1Total
    };
  });

  return result;
}

// Punto de entrada público
function getOKRData() {
  try {
    return { success: true, okr: computeOKR_() };
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

  var okr = computeOKR_();
  Logger.log('computeOKR_ retorna null: ' + (okr === null));
  if (okr) Logger.log('LOBs en resultado: ' + JSON.stringify(Object.keys(okr)));
}
