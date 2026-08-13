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

// Leer hoja OKR con cache 10 min
function readOKRSheet_() {
  var cache = CacheService.getScriptCache();
  var cKey  = 'tab_OKR';
  var hit   = cache.get(cKey);
  if (hit) { try { return JSON.parse(hit); } catch(e) {} }

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('OKR');
  if (!sheet) return [];
  var data    = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(function(h){ return String(h).trim().toLowerCase(); });

  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    var obj = {};
    headers.forEach(function(h, idx){ obj[h] = row[idx]; });

    // Normalizar fecha → YYYY-MM
    var fecha = obj['periodo'];
    var ym = '';
    if (fecha instanceof Date) {
      ym = fecha.getFullYear()+'-'+String(fecha.getMonth()+1).padStart(2,'0');
    } else {
      var s = String(fecha).trim(), pts = s.split('/');
      if (pts.length === 3) {
        // formato d/MM/yyyy o dd/MM/yyyy
        ym = parseInt(pts[2])+'-'+String(parseInt(pts[1])).padStart(2,'0');
      }
    }
    if (!ym) continue;

    var krRaw = String(obj['kr']||'').trim().toLowerCase();
    rows.push({
      ym:        ym,
      escenario: String(obj['escenario']||'').trim().toLowerCase(),
      lob:       String(obj['lob']     ||'').trim().toLowerCase(),
      kr:        OKR_KR_ALIASES[krRaw] || krRaw,
      valor:     parseFloat(String(obj['valor']||'0').replace(',','.')) || 0
    });
  }
  try { cache.put(cKey, JSON.stringify(rows), 600); } catch(e) {}
  return rows;
}

// Calcular achievement por KR / período
function computeOKR_() {
  var rows = readOKRSheet_();
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
function debugOKR() {
  var rows = readOKRSheet_();
  var uniqueLobs = {}, uniqueEsc = {}, uniqueKrs = {}, uniqueYms = {};
  rows.forEach(function(r) {
    uniqueLobs[r.lob] = true;
    uniqueEsc[r.escenario] = true;
    uniqueKrs[r.kr] = true;
    uniqueYms[r.ym] = true;
  });
  Logger.log('Total filas leídas: ' + rows.length);
  Logger.log('LOBs únicos: '       + JSON.stringify(Object.keys(uniqueLobs)));
  Logger.log('Escenarios únicos: ' + JSON.stringify(Object.keys(uniqueEsc)));
  Logger.log('KRs únicos: '        + JSON.stringify(Object.keys(uniqueKrs)));
  Logger.log('Períodos únicos: '   + JSON.stringify(Object.keys(uniqueYms).sort()));
  Logger.log('Primeras 5 filas: '  + JSON.stringify(rows.slice(0,5)));
}

function diagOKR() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('OKR');
  if (!sheet) { Logger.log('ERROR: tab OKR no existe en el spreadsheet'); return; }
  var data = sheet.getDataRange().getValues();
  Logger.log('Filas totales (incl. header): ' + data.length);
  if (data.length > 0) Logger.log('Headers: ' + JSON.stringify(data[0]));
  if (data.length > 1) Logger.log('Primera fila de datos: ' + JSON.stringify(data[1]));
  var rows = readOKRSheet_();
  Logger.log('Filas parseadas por readOKRSheet_: ' + rows.length);
  if (rows.length > 0) Logger.log('Ejemplo fila: ' + JSON.stringify(rows[0]));
  var okr = computeOKR_();
  Logger.log('computeOKR_ retorna null: ' + (okr === null));
  if (okr) Logger.log('LOBs en resultado: ' + JSON.stringify(Object.keys(okr)));
}
