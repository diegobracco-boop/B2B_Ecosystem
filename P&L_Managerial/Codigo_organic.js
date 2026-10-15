// ══════════════════════════════════════════════════════════════
//  ORGANIC — switch NO/YES de P&L Managerial
// ══════════════════════════════════════════════════════════════
// Misma regla que Monthly Results del Hub (Dashboard_B2B_WLs/Codigo.js, applyOrganic_):
//   ORGANIC = USD × TC Actuals(país, mes) / TC Target(país, mes), solo sobre el BASELINE
//   (Actuals + Projections o Projection Reviews; en modo gateway, los Actuals de Hotels por
//   gateway). Budget / Forecast / LY quedan en USD tal cual.
//   Target según el Goal del front: Budget → TC Budget, Forecast → TC Forecast, Last Year → TC
//   Actuals del mismo mes del año anterior.
//   YoY ("opción B"): con Goal Budget/Forecast getData devuelve además `yoy` = las mismas
//   agregaciones del baseline a TC Actuals LY; el front calcula los YoY con eso y muestra el LY nominal.
//   Orders y países sin TC (Globales, Other Countries, Paraguay, …) no se convierten; "Euro" se
//   ignora; RG / OPS / OPS+RG usan el TC de Brasil.
// Fuente provisoria: tc_plana_flat.xlsx en Drive (mismo archivo que el Hub). Si pasa al pipeline
// (fx.json), solo cambia readFxTable_ — y en los 4 módulos que la copian (Hub, Accounting,
// Managerial, Daily).
var FX_FILE_ID = '1SEh9vLWCbE6PslnUntUghhInonuLdYZ5';
var ORGANIC_TARGETS_ = { budget: true, forecast: true, ly: true };

// Target organic del request (el front manda 'budget' | 'forecast' | 'ly'); '' = sin organic.
function organicTarget_(f) {
  var o = f && f.organic;
  return (typeof o === 'string' && ORGANIC_TARGETS_.hasOwnProperty(o)) ? o : '';
}

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

// Devuelve una copia de `json` con las filas del baseline (`keys`: bl / bl_ri / ac_gw / ac_ri_gw)
// convertidas a organic. Formatos de fila (ver Codigo.js):
//   b2b2c:           [pais, partner, produto, ym, v0..v28]
//   b2b_may/b2b_min: [pais, produto|gateway, ym, v0..v28, viaje]
// v0 = orders → no se convierte. No muta el JSON original (lo cachea readGestionalJSON_).
function organicGestionalJson_(json, keys, conv) {
  var out = Object.assign({}, json);
  [['b2b2c', 3, 4], ['b2b_may', 2, 3], ['b2b_min', 2, 3]].forEach(function(s) {
    var sec = json[s[0]];
    if (!sec) return;
    var iYm = s[1], off = s[2], ns = Object.assign({}, sec);
    // B2B2C tiene fecha única: su baseline es siempre 'bl' (aunque se pida RI)
    (s[0] === 'b2b2c' ? keys.concat(['bl']) : keys).forEach(function(k) {
      if (!sec[k] || (s[0] === 'b2b2c' && k !== 'bl')) return;
      ns[k] = sec[k].map(function(row) {
        var f = conv.f(row[0], row[iYm]);
        if (f === 1) return row;
        var r = row.slice();
        for (var i = 1; i < METRIC_COLS.length; i++) r[off + i] = (row[off + i] || 0) * f;
        return r;
      });
    });
    out[s[0]] = ns;
  });
  return out;
}
