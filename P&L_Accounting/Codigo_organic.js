// ══════════════════════════════════════════════════════════════
//  ORGANIC — switch NO/YES de la vista P&L Accounting (EPM)
// ══════════════════════════════════════════════════════════════
// Misma regla que Monthly Results del Hub (Dashboard_B2B_WLs/Codigo.js, applyOrganic_):
//   ORGANIC = USD × TC Actuals(país, mes) / TC Target(país, mes), solo sobre el BASELINE (todos
//   sus meses, reales y proyectados). Goals (Budget/Forecast/RR/LRR) y el LY quedan en USD tal cual.
//   Target según el Goal: Budget → TC Budget, Forecast → TC Forecast, Last Year → TC Actuals del
//   mismo mes del año anterior. Run Rate / Last RR: no aplica (organic deshabilitado).
//   YoY ("opción B"): con Goal Budget/Forecast los YoY salen de una 2ª versión del baseline a
//   TC Actuals LY (claves *YoY / curY de las respuestas); el LY se muestra nominal.
//   Orders y países sin TC (Globales, Paraguay, …) no se convierten; "Euro" se ignora;
//   RG / OPS / OPS+RG usan el TC de Brasil.
// Fuente provisoria: tc_plana_flat.xlsx en Drive (mismo archivo que el Hub). Si pasa al pipeline
// (fx.json), solo cambia readFxTable_ — y en los 4 módulos que la copian (Hub, Accounting,
// Managerial, Daily).
var FX_FILE_ID = '1SEh9vLWCbE6PslnUntUghhInonuLdYZ5';
var ORGANIC_TARGETS_ = { budget: 'budget', forecast: 'forecast', lastyear: 'ly' };

// Target organic efectivo: '' = sin organic (switch en NO o Goal sin TC).
function organicTargetOf_(organic, goalSource) {
  if (!organic) return '';
  var g = goalSource || 'budget';
  return Object.prototype.hasOwnProperty.call(ORGANIC_TARGETS_, g) ? ORGANIC_TARGETS_[g] : '';
}

// true si en esta ejecución falló la lectura del TC → _timed_ no cachea el resultado
var _ORG_ERR_ = false;

function _fxNorm_(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Regiones sin TC propio que toman el de otro país
var _FX_PAIS_ALIAS_ = { 'ops': 'brasil', 'rg': 'brasil', 'ops + rg': 'brasil', 'ops+rg': 'brasil' };

var _FX_MES_ = { abr:4, may:5, jun:6, jul:7, ago:8, sep:9, sept:9, oct:10, nov:11, dic:12, ene:1, feb:2, mar:3 };

// Fecha de modificación del xlsx de TC, cacheada 60 s (entra en la clave del caché de resultados).
function _fxMod_() {
  try {
    var hit = CacheService.getScriptCache().get('fx_mod_v1');
    if (hit) return Number(hit);
    var t = DriveApp.getFileById(FX_FILE_ID).getLastUpdated().getTime();
    CacheService.getScriptCache().put('fx_mod_v1', String(t), 60);
    return t;
  } catch (e) { return 0; }
}

// Lee tc_plana_flat.xlsx (xlsx = zip de XMLs) → { actuals:{'pais§ym':tc}, budget:{…}, forecast:{…} }.
// Copia de readFxTable_ de Dashboard_B2B_WLs/Codigo.js.
var _fxCache_ = null;
function readFxTable_() {
  if (_fxCache_) return _fxCache_;
  var blob  = DriveApp.getFileById(FX_FILE_ID).getBlob().setContentType('application/zip');
  var parts = {};
  Utilities.unzip(blob).forEach(function(b) { parts[b.getName()] = b; });
  var sheetName = Object.keys(parts).filter(function(n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); }).sort()[0];
  if (!sheetName) throw new Error('el xlsx no tiene hojas');

  var shared = [];
  if (parts['xl/sharedStrings.xml']) {
    var sroot = XmlService.parse(parts['xl/sharedStrings.xml'].getDataAsString('UTF-8')).getRootElement();
    var sns   = sroot.getNamespace();
    sroot.getChildren('si', sns).forEach(function(si) {
      var t = si.getChild('t', sns);
      shared.push(t ? t.getText() : si.getChildren('r', sns).map(function(r) {
        var rt = r.getChild('t', sns); return rt ? rt.getText() : '';
      }).join(''));
    });
  }

  var root = XmlService.parse(parts[sheetName].getDataAsString('UTF-8')).getRootElement();
  var ns   = root.getNamespace();
  var rows = root.getChild('sheetData', ns).getChildren('row', ns).map(function(row) {
    var out = {};
    row.getChildren('c', ns).forEach(function(c) {
      var col = String(c.getAttribute('r').getValue()).replace(/\d+/g, '');
      var t   = c.getAttribute('t') ? c.getAttribute('t').getValue() : '';
      var v;
      if (t === 'inlineStr') { var is = c.getChild('is', ns); v = is && is.getChild('t', ns) ? is.getChild('t', ns).getText() : ''; }
      else { var ve = c.getChild('v', ns); v = ve ? ve.getText() : ''; if (t === 's') v = shared[parseInt(v, 10)]; }
      out[col] = v;
    });
    return out;
  });
  if (!rows.length) throw new Error('el xlsx está vacío');

  var hdr = {};
  Object.keys(rows[0]).forEach(function(col) { hdr[_fxNorm_(rows[0][col])] = col; });
  ['escenario', 'ano', 'mes', 'pais', 'dato'].forEach(function(h) {
    if (!hdr[h]) throw new Error('falta la columna "' + h + '"');
  });

  var fx = { actuals: {}, budget: {}, forecast: {} };
  rows.slice(1).forEach(function(r) {
    var esc = _fxNorm_(r[hdr['escenario']]);
    if (!fx[esc]) return;
    var mm  = _FX_MES_[_fxNorm_(r[hdr['mes']])];
    var fy  = parseInt(r[hdr['ano']], 10);
    var tc  = parseFloat(r[hdr['dato']]);
    var pai = _fxNorm_(r[hdr['pais']]);
    if (!mm || !fy || !(tc > 0) || !pai || pai === 'euro') return;
    var ym = (mm >= 4 ? fy - 1 : fy) + '-' + (mm < 10 ? '0' : '') + mm;   // FY → mes calendario
    fx[esc][pai + '§' + ym] = tc;
  });
  ['actuals', 'budget', 'forecast'].forEach(function(k) {
    if (!Object.keys(fx[k]).length) throw new Error('no hay tipos de cambio de "' + k + '" (revisar escenario / mes / dato)');
  });
  _fxCache_ = fx;
  return fx;
}

function _fxShiftYm_(ym, dy) { return (parseInt(ym.slice(0, 4), 10) + dy) + ym.slice(4); }

// Factor organic por (país, ym) para un target. País sin TC → 1 (no se convierte); país con TC
// al que le falta el TC Actuals o el del target → 1 y queda en missing (se avisa en pantalla).
function organicConverter_(target) {
  var fx = readFxTable_();
  var act = fx.actuals, tgt = (target === 'ly') ? null : fx[target];
  var paisesFx = {};
  Object.keys(act).forEach(function(k) { paisesFx[k.split('§')[0]] = true; });
  var missing = {};
  function f(pais, ym) {
    var pai = _fxNorm_(pais);
    pai = _FX_PAIS_ALIAS_[pai] || pai;
    if (!paisesFx[pai]) return 1;
    var a = act[pai + '§' + ym];
    var t = tgt ? tgt[pai + '§' + ym] : act[pai + '§' + _fxShiftYm_(ym, -1)];
    if (!a || !t) {
      missing[pai + ' ' + ym + (a ? '' : ' (actuals)') + (t ? '' : ' (' + (target === 'ly' ? 'actuals LY' : target) + ')')] = true;
      return 1;
    }
    return a / t;
  }
  return { f: f, missing: missing };
}

// Agrega a jData (claves nuevas, no toca los escenarios originales) el escenario `src` convertido
// a organic: data[lg][pais]['org:<target>:<src>'] y lo mismo en data_by_prod. Las filas de países con
// TC propio que el cubo agrupa bajo otro label (Uruguay → Globales) vienen en data_fxsplit y se
// corrigen con su propio TC. Devuelve el nombre del escenario nuevo (usable en fetchEPMScenarios_).
function epmOrganicScen_(jData, src, target, conv) {
  var key = 'org:' + target + ':' + src;
  jData._org = jData._org || {};
  if (jData._org[key]) return key;

  function convScen(scen, paisLbl, splits) {
    var out = {};
    Object.keys(scen || {}).forEach(function(n2) {
      var o = out[n2] = {}, m = scen[n2], isOrd = (n2 === 'orders');
      Object.keys(m).forEach(function(ym) { o[ym] = isOrd ? m[ym] : m[ym] * conv.f(paisLbl, ym); });
    });
    Object.keys(splits || {}).forEach(function(raw) {
      var ss = (splits[raw] || {})[src] || {};
      Object.keys(ss).forEach(function(n2) {
        if (n2 === 'orders') return;
        if (!out[n2]) out[n2] = {};
        Object.keys(ss[n2]).forEach(function(ym) {
          out[n2][ym] = (out[n2][ym] || 0) + ss[n2][ym] * (conv.f(raw, ym) - conv.f(paisLbl, ym));
        });
      });
    });
    return out;
  }

  var data = jData.data || {}, split = jData.data_fxsplit || {};
  Object.keys(data).forEach(function(lg) {
    Object.keys(data[lg]).forEach(function(pais) {
      if (pais === 'all') return;
      data[lg][pais][key] = convScen(data[lg][pais][src], pais, (split[lg] || {})[pais]);
    });
  });
  var dbp = jData.data_by_prod || {}, splitP = jData.data_by_prod_fxsplit || {};
  Object.keys(dbp).forEach(function(lg) {
    Object.keys(dbp[lg]).forEach(function(pais) {
      Object.keys(dbp[lg][pais]).forEach(function(prod) {
        dbp[lg][pais][prod][key] = convScen(dbp[lg][pais][prod][src], pais, ((splitP[lg] || {})[pais] || {})[prod]);
      });
    });
  });
  jData._org[key] = true;
  return key;
}

// Organic de un request. Devuelve:
//   bl   = escenario a usar como baseline (el original si no hay organic)
//   yoy  = escenario para los YoY (opción B), o null si los YoY salen del mismo baseline
//   info = { target, missing } | { target, error } | null → va al front en `organic`
function epmOrganicSetup_(jData, organic, goalSource, baselineScen) {
  var target = organicTargetOf_(organic, goalSource);
  if (!target) return { bl: baselineScen, yoy: null, info: null };
  try {
    var conv = organicConverter_(target);
    var bl = epmOrganicScen_(jData, baselineScen, target, conv);
    var yoy = null, missing = conv.missing;
    if (target !== 'ly') {
      var convY = organicConverter_('ly');
      yoy = epmOrganicScen_(jData, baselineScen, 'ly', convY);
      Object.keys(convY.missing).forEach(function(k) { missing[k] = true; });
    }
    return { bl: bl, yoy: yoy, info: { target: target, missing: Object.keys(missing).sort() } };
  } catch (e) {
    _ORG_ERR_ = true;
    return { bl: baselineScen, yoy: null, info: { target: target, error: 'No se pudo leer el archivo de tipos de cambio: ' + e.message } };
  }
}
