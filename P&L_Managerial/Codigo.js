// P&L Gestional Dashboard — Apps Script Backend v2
// Data source: _actuals_gestional.json (generado por actuals_gestional_upload.py; mismo fileId que el _pnl_gestional_data.json original, solo cambió el nombre)
var GESTIONAL_JSON_FILE_ID    = '1wvle0UIVZV7ocCSl8OawOfIGVz_It5kh';
var GESTIONAL_VR_JSON_FILE_ID = '1Zd1Kzn7CkatOWnzrrfBxr9mDjIVLLKIF'; // pnl_gestional_projections_review.json
var _gestionalJsonCache_      = null;
var _gestionalVRJsonCache_    = null;

var _EMPTY_GESTIONAL_ = {
  b2b2c:   { ac:[], ly:[], bgt:[], rr:[], fc:[], bl:[] },
  b2b_may: { ac:[], ac_ri:[], ly:[], bgt:[], bgt_ri:[], rr:[], rr_ri:[], fc:[], fc_ri:[], bl:[], bl_ri:[] },
  b2b_min: { ac:[], ac_ri:[], ly:[], bgt:[], bgt_ri:[], rr:[], rr_ri:[], fc:[], fc_ri:[], bl:[], bl_ri:[] },
  actual_months: [],
  months: []
};

// ── Carga y cachea el JSON gestional desde Drive ──────────────────────────
// baselineSource: 'bl' → gestional normal | 'vr' → Projection Reviews
function readGestionalJSON_(baselineSource) {
  if (baselineSource === 'vr') {
    if (_gestionalVRJsonCache_) return _gestionalVRJsonCache_;
    try {
      var blob = DriveApp.getFileById(GESTIONAL_VR_JSON_FILE_ID).getBlob();
      _gestionalVRJsonCache_ = JSON.parse(blob.getDataAsString());
    } catch(e) {
      // Antes devolvía _EMPTY_GESTIONAL_ y ese resultado vacío quedaba cacheado 6 h con la clave
      // del mtime (pantalla en cero). Ahora el error llega al cliente (auditoría 2026-09-25).
      Logger.log('readGestionalJSON_ VR error: ' + e);
      throw new Error('No se pudo leer el JSON de Projection Reviews de Drive: ' + e.message);
    }
    return _gestionalVRJsonCache_;
  }
  if (_gestionalJsonCache_) return _gestionalJsonCache_;
  try {
    var blob = DriveApp.getFileById(GESTIONAL_JSON_FILE_ID).getBlob();
    _gestionalJsonCache_ = JSON.parse(blob.getDataAsString());
  } catch(e) {
    Logger.log('readGestionalJSON_ error: ' + e);
    throw new Error('No se pudo leer el JSON gestional de Drive: ' + e.message);
  }
  return _gestionalJsonCache_;
}

// ── Año fiscal ─────────────────────────────────────────────────────────────
// ÚNICO valor a cambiar al pasar de FY (abril). FY_END_YEAR = 2027 → FY27 = Abr-26 … Mar-27.
// Todo lo demás (meses, labels, Q/H, "FY27" en pantalla) se deriva de acá; dashboard.html lo
// recibe por el template (auditoría ola 4, 2026-09-25). Igual que CURRENT_FY de config.py.
var FY_END_YEAR = 2027;
var FY_MES_ES_ = ['Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic','Ene','Feb','Mar'];
var YM_ORDER = FY_MES_ES_.map(function(m, i) {
  var y = i < 9 ? FY_END_YEAR - 1 : FY_END_YEAR, mm = ((i + 3) % 12) + 1;
  return y + '-' + (mm < 10 ? '0' : '') + mm;
});
var YM_LABEL = {};
YM_ORDER.forEach(function(ym, i) { YM_LABEL[ym] = FY_MES_ES_[i] + '-' + ym.slice(2, 4); });

// Métricas en el mismo orden que METRICS del JSON (Python pnl_gestional_upload.py)
var METRIC_COLS = [
  'orders','gross_bookings',                                                    // 0,1
  'up_front_incentives','fees','commercial_discounts',                          // 2,3,4
  'income_from_outsourced_services','cancellations',                            // 5,6
  'cost_of_installments','credit_card_processing','white_labels_api',           // 7,8,9
  'other_incentives','revenue_tax','back_end_incentives',                       // 10,11,12
  'breakage_revenue','media_revenue','errors','other_transactional_taxes',      // 13,14,15,16
  'customer_claims','customer_service','affiliates',                            // 17,18,19
  'intercompany_usd','operations','vendor_commissions','frauds',                // 20,21,22,23
  'efecto_financiero','dif_fx','currency_hedge',                               // 24,25,26
  'net_revenue','npv'                                                           // 27,28
];
// Índices frecuentes para partner breakdown
var _I_GB  = 1;   // gross_bookings
var _I_NR  = 27;  // net_revenue
var _I_NPV = 28;  // npv
// Filas B2B (b2b_may/b2b_min, incluidas las *_gw): [pais, produto|gateway, ym, v0..v28, viaje].
// El viaje (Domestic/International) va AL FINAL para no correr los índices de lo que ya leía por posición.
var _I_VJ_B2B = 3 + METRIC_COLS.length;

// ── Helpers de filtrado y agregación ─────────────────────────────────────

// Normaliza un valor de filtro a array lowercase ([] = sin filtro)
function normFilter_(v) {
  if (!v || v === 'all' || (Array.isArray(v) && v.length === 0)) return [];
  return (Array.isArray(v) ? v : [v]).map(function(s){ return String(s||'').trim().toLowerCase(); });
}

function matchFilter_(val, fArr) {
  if (!fArr.length) return true;
  return fArr.indexOf(String(val || '').trim().toLowerCase()) >= 0;
}

// Suma las N_MET métricas de una fila (a partir de offset) en outAgg[mes]
function addMetrics_(outAgg, mes, row, offset) {
  if (!outAgg[mes]) {
    outAgg[mes] = {};
    METRIC_COLS.forEach(function(m){ outAgg[mes][m] = 0; });
  }
  METRIC_COLS.forEach(function(m, i){ outAgg[mes][m] += (row[offset + i] || 0); });
}

// Suma métricas en outContainer[key][mes]
function addMetricsNested_(outContainer, key, mes, row, offset) {
  if (!outContainer[key]) outContainer[key] = {};
  addMetrics_(outContainer[key], mes, row, offset);
}

// ── Procesamiento de secciones del JSON ──────────────────────────────────

// B2B2C rows: [pais, partner, produto, ym,  v0..v28]
//   offsets:    0      1       2       3    4..32
function queryB2B2C_(section, scenarioKey, fPais, fPartner, fProduto,
                     outAgg,
                     outPartnerAgg,          // {partner:{gb,nr,npv}} — null para omitir
                     outPartnerMonthly,      // {partner:{mes:{all metrics}}} — null para omitir
                     outPartnerCM,           // {pais:{partner:{mes:{gb,nr,npv}}}} — null para omitir
                     outAllPaises, outAllPartners, outAllProdutos,
                     outFarmingAgg, outHuntingAgg) {
  var _YAVAS_SAAS_PRODS = ['flights','packages general','hotels'];
  var rows = (section && section[scenarioKey]) || [];
  rows.forEach(function(row) {
    var pais = normB2B2CPais_(row[0]), partner = normB2B2CPartner_(row[1]), produto = row[2], ym = row[3];
    // Excluir NewFly en todas sus variantes (new fly, NewFly, new-fly, etc.)
    if (String(partner||'').toLowerCase().replace(/[\s\-_]/g,'') === 'newfly') return;
    if (!matchFilter_(pais,    fPais))    return;
    if (!matchFilter_(partner, fPartner)) return;
    if (!matchFilter_(produto, fProduto)) return;
    var mes = YM_LABEL[ym];
    if (!mes) return;

    if (outAllPaises)   outAllPaises[pais]       = true;
    if (outAllPartners && partner) outAllPartners[partner] = true;
    if (outAllProdutos && produto) outAllProdutos[produto] = true;

    // YaVas SaaS: en la vista consolidada (sin filtro de partner) restamos orders y gross_bookings.
    // Cuando el usuario filtra por YaVas como partner, fPartner tiene items → NO restamos,
    // así ve sus valores reales de orders/GB.
    var isYaVasSaaS = (String(partner||'').toLowerCase() === 'yavas') &&
      (_YAVAS_SAAS_PRODS.indexOf(String(produto||'').toLowerCase()) >= 0);

    addMetrics_(outAgg, mes, row, 4);
    if (isYaVasSaaS && fPartner.length === 0 && outAgg[mes]) {
      outAgg[mes]['orders']         -= (row[4]   || 0);
      outAgg[mes]['gross_bookings'] -= (row[4+1] || 0);
    }

    if (outFarmingAgg || outHuntingAgg) {
      var _hunting = isB2B2CHunting_(partner);
      if (_hunting && outHuntingAgg) {
        addMetrics_(outHuntingAgg, mes, row, 4);
      } else if (!_hunting && outFarmingAgg) {
        addMetrics_(outFarmingAgg, mes, row, 4);
        if (isYaVasSaaS && fPartner.length === 0 && outFarmingAgg[mes]) {
          outFarmingAgg[mes]['orders']         -= (row[4]   || 0);
          outFarmingAgg[mes]['gross_bookings'] -= (row[4+1] || 0);
        }
      }
    }

    var p = partner || '(Sin partner)';

    if (outPartnerAgg) {
      if (!outPartnerAgg[p]) outPartnerAgg[p] = { gross_bookings:0, net_revenue:0, npv:0 };
      outPartnerAgg[p].gross_bookings += (row[4 + _I_GB]  || 0);
      outPartnerAgg[p].net_revenue    += (row[4 + _I_NR]  || 0);
      outPartnerAgg[p].npv            += (row[4 + _I_NPV] || 0);
    }
    if (outPartnerMonthly) {
      addMetricsNested_(outPartnerMonthly, p, mes, row, 4);
    }
    if (outPartnerCM && pais) {
      if (!outPartnerCM[pais]) outPartnerCM[pais] = {};
      if (!outPartnerCM[pais][p]) outPartnerCM[pais][p] = {};
      if (!outPartnerCM[pais][p][mes]) outPartnerCM[pais][p][mes] = { gross_bookings:0, net_revenue:0, npv:0 };
      outPartnerCM[pais][p][mes].gross_bookings += (row[4 + _I_GB]  || 0);
      outPartnerCM[pais][p][mes].net_revenue    += (row[4 + _I_NR]  || 0);
      outPartnerCM[pais][p][mes].npv            += (row[4 + _I_NPV] || 0);
    }
  });
}

// B2B rows: [pais, produto, ym,  v0..v28]
//  offsets:   0      1      2    3..31

// Normaliza aliases de "otros/other/..." → "Other Countries" para B2B2C
var _B2B2C_OTHER_ALIASES = ['other','others','otros','otro','other countries'];
function normB2B2CPais_(p){
  return _B2B2C_OTHER_ALIASES.indexOf(String(p||'').trim().toLowerCase()) >= 0 ? 'Other Countries' : p;
}

// Normaliza variantes de nombre de partner B2B2C (case/typo differences)
var _B2B2C_PARTNER_ALIASES = {
  'livelo-api-hoteles': 'Livelo-API-Hoteles'
};
function normB2B2CPartner_(p){
  var key = String(p||'').trim().toLowerCase();
  if (_B2B2C_PARTNER_ALIASES.hasOwnProperty(key)) return _B2B2C_PARTNER_ALIASES[key];
  // Title case genérico: capitalizar primera letra de cada palabra separada por espacio o guion
  return key.replace(/(^|[\s\-])(\S)/g, function(m, sep, c){ return sep + c.toUpperCase(); });
}

// Hunting = stage 'New' del mapa b2b2c_stage que publica actuals_gestional_upload.py: cartera de
// ComDev + overrides de Daily_Dashboard/hunting_rules.py → mismo criterio que el Daily y los OKR
// (alineado 2026-10-13; antes era una lista fija que se había desincronizado).
// Partner fuera del mapa = Existing. La lista fija queda solo como respaldo si el JSON no trae el mapa.
var _B2B2C_HUNTING_FALLBACK = ['caixa','csu','ypf','cocos','tuplus','vibe','cacau lovers','turismocity','claro','livelo-api-hoteles','invex','bna','banco de chile','itau','tbd','cutc','sams','dotz'];
var _b2b2cStageMap_ = null;   // {partner lowercase: 'New'|'Existing'} | false si el JSON no lo trae
function _getB2B2CStageMap_(){
  if (_b2b2cStageMap_ === null) {
    // Siempre del JSON gestional principal (el de Projection Reviews no lo trae).
    try { _b2b2cStageMap_ = readGestionalJSON_('bl').b2b2c_stage || false; }
    catch (e) { Logger.log('b2b2c_stage: ' + e); _b2b2cStageMap_ = false; }
  }
  return _b2b2cStageMap_;
}
function isB2B2CHunting_(partner){
  var key = String(partner||'').trim().toLowerCase();
  var m = _getB2B2CStageMap_();
  if (m) return m[key] === 'New';
  return _B2B2C_HUNTING_FALLBACK.indexOf(key) >= 0;
}

// Normaliza aliases de "otros/other/..." → "Globales" para B2B
var _B2B_OTHER_ALIASES = ['other','others','otros','otro','other countries'];
function normB2BPais_(p){
  return _B2B_OTHER_ALIASES.indexOf(String(p||'').trim().toLowerCase()) >= 0 ? 'Globales' : p;
}

// También sirve para las secciones de Hotels por gateway (ac_gw/ac_ri_gw/ly_gw): mismas filas
// con el gateway en row[1] → fProduto pasa a ser el filtro de gateway.
// ymOk: {ym:true} para quedarse solo con esos meses (null = todos).
// fViaje: filtro de tipo de viaje (row[_I_VJ_B2B]); [] = sin filtro.
function queryB2B_(section, scenarioKey, fPais, fProduto,
                   outAgg, outAllPaises, outAllProdutos, ymOk, fViaje) {
  var rows = (section && section[scenarioKey]) || [];
  rows.forEach(function(row) {
    var pais = normB2BPais_(row[0]), produto = row[1], ym = row[2];
    if (!matchFilter_(pais,    fPais))    return;
    if (!matchFilter_(produto, fProduto)) return;
    if (ymOk && !ymOk[ym]) return;
    if (fViaje && !matchFilter_(row[_I_VJ_B2B], fViaje)) return;
    var mes = YM_LABEL[ym];
    if (!mes) return;
    if (outAllPaises)   outAllPaises[pais]       = true;
    if (outAllProdutos && produto) outAllProdutos[produto] = true;
    addMetrics_(outAgg, mes, row, 3);
  });
}

// Lightweight per-canal, per-country, per-product monthly data (only GB, NR, NPV)
// blKey/fcstKey: 'bl'|'bl_ri' y 'fc'|'fc_ri' según el toggle GD/RI (aplica a MAY y MIN;
// B2B2C tiene fecha única). Nombres *May heredados; los valores son las claves generales.
// gw (opcional): {json, acKey, fGateway, ymOk} → modo gateway: baseline = Actuals de Hotels
// filtrados por gateway (ac_gw/ac_ri_gw), LY = ly_gw (solo meses cerrados), Budget/Forecast
// vacíos. Todo queda bajo el producto 'Hotels' para que Detalle y Trend view lo dibujen como siempre.
function queryB2BCanalDetail_(json, blKeyMay, bgtKey, fcstKeyMay, fPais, fProduto, gw, fViaje) {
  var result = { 'B2B-MIN':{ fc:{}, bgt:{}, ly:{}, fcst:{} }, 'B2B-MAY':{ fc:{}, bgt:{}, ly:{}, fcst:{} } };
  // Filas gateway: row[1] es el gateway → se filtra por gateway y se agrupa como 'Hotels'
  function procRows(rows, target) {
    (rows||[]).forEach(function(row) {
      var pais=normB2BPais_(row[0]), produto=row[1], ym=row[2];
      if(!matchFilter_(pais,fPais)) return;
      if(fViaje && !matchFilter_(row[_I_VJ_B2B],fViaje)) return;
      if(gw){
        if(!matchFilter_(produto,gw.fGateway) || !gw.ymOk[ym]) return;
        produto='Hotels';
      } else if(!matchFilter_(produto,fProduto)) return;
      var mes=YM_LABEL[ym]; if(!mes) return;
      if(!target[pais])          target[pais]={};
      if(!target[pais][produto]) target[pais][produto]={};
      var mp=target[pais][produto];
      if(!mp[mes]) mp[mes]={gross_bookings:0,net_revenue:0,npv:0};
      mp[mes].gross_bookings+=(row[3+_I_GB]||0);
      mp[mes].net_revenue   +=(row[3+_I_NR]||0);
      mp[mes].npv           +=(row[3+_I_NPV]||0);
    });
  }
  if (gw) {
    var gmin = gw.json.b2b_min || {}, gmay = gw.json.b2b_may || {};
    procRows(gmin[gw.acKey], result['B2B-MIN'].fc);
    procRows(gmin['ly_gw'],  result['B2B-MIN'].ly);
    procRows(gmay[gw.acKey], result['B2B-MAY'].fc);
    procRows(gmay['ly_gw'],  result['B2B-MAY'].ly);
    return result;
  }
  var min=json.b2b_min||{}, may=json.b2b_may||{};
  // "fc" = BASELINE (bl), no forecast — nombre heredado por consistencia con el resto del dashboard.
  procRows(min[blKeyMay],   result['B2B-MIN'].fc);
  procRows(min[bgtKey],     result['B2B-MIN'].bgt);
  procRows(min['ly'],       result['B2B-MIN'].ly);
  procRows(min[fcstKeyMay], result['B2B-MIN'].fcst);
  procRows(may[blKeyMay],    result['B2B-MAY'].fc);
  procRows(may[bgtKey],      result['B2B-MAY'].bgt);
  procRows(may['ly'],        result['B2B-MAY'].ly);
  procRows(may[fcstKeyMay],  result['B2B-MAY'].fcst);
  return result;
}

// Fusiona src en dest (suma métricas mes a mes)
function mergeAgg_(src, dest) {
  Object.keys(src).forEach(function(m) {
    if (!dest[m]) { dest[m] = {}; METRIC_COLS.forEach(function(k){ dest[m][k] = 0; }); }
    METRIC_COLS.forEach(function(k){ dest[m][k] = (dest[m][k] || 0) + (src[m][k] || 0); });
  });
}

// ── Entry point ───────────────────────────────────────────────────────────
function doGet() {
  return HtmlService.createTemplateFromFile('dashboard').evaluate()
    .setTitle('P&L Projections Review · Despegar')
    .addMetaTag('viewport','width=device-width,initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── Public API ────────────────────────────────────────────────────────────
// filters: {
//   lob_tipo:  'B2B2C'|'B2B-MAY'|'B2B-MIN'|array (null = todos)
//   date_type: 'gd'|'ri'  (default 'gd'; RI solo aplica a B2B-MAY)
//   pais:      string|array
//   partner:   string|array  (solo B2B2C)
//   produto:   string|array
//   gateway:   string|array  (solo B2B y solo con producto = Hotels; modo gateway: Actuals + LY, sin Budget/Forecast)
//   viaje:     string|array  (solo B2B: 'Domestic' | 'International'; todos los escenarios, combinable con gateway)
// }
// CacheService (6h) — 2026-09-23. getData() alimenta las 3 pestañas (Managerial View,
// Gráficos, Detalle) y no tenía NADA de cache: cada llamada releía+reparseaba el JSON
// gestional (~7MB) de Drive y corría hasta 12 pasadas de agregación (queryB2B2C_/
// queryB2B_ × hasta 4 escenarios × hasta 3 LoBs) desde cero. _gestionalJsonCache_ no
// ayuda acá — solo vive dentro de una misma ejecución de Apps Script, y cada
// google.script.run es una ejecución nueva. Mismo patrón que getVsAccounting/
// getRevenueGDVsGestional (invalidación por mtime del JSON), con chunking (como
// writeResultCache_ en Dashboard_B2B_WLs) porque el breakdown completo por
// partner×país×mes puede superar el límite de 100KB por valor de CacheService.
var GETDATA_CACHE_CHUNK_SIZE = 90000; // 90KB por chunk

function _readGetDataCache_(key) {
  var sc = CacheService.getScriptCache();
  var meta = sc.get(key + '_meta');
  if (meta) {
    try {
      var m = JSON.parse(meta);
      var parts = [];
      for (var i = 0; i < m.chunks; i++) {
        var c = sc.get(key + '_c' + i);
        if (!c) return null;   // chunk expirado → recalcular
        parts.push(c);
      }
      return JSON.parse(parts.join(''));
    } catch (e) { return null; }
  }
  var hit = sc.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  return null;
}

function _writeGetDataCache_(key, value) {
  var json = JSON.stringify(value);
  var sc = CacheService.getScriptCache();
  try {
    if (json.length <= GETDATA_CACHE_CHUNK_SIZE) {
      sc.put(key, json, 21600);
    } else {
      var pairs = {};
      var nChunks = Math.ceil(json.length / GETDATA_CACHE_CHUNK_SIZE);
      pairs[key + '_meta'] = JSON.stringify({ chunks: nChunks });
      for (var i = 0; i < nChunks; i++) {
        pairs[key + '_c' + i] = json.slice(i * GETDATA_CACHE_CHUNK_SIZE, (i + 1) * GETDATA_CACHE_CHUNK_SIZE);
      }
      sc.putAll(pairs, 21600);
    }
  } catch (e) {}
}

function getData(filters) {
  var f = (filters && typeof filters === 'object') ? filters : {};
  var sig = JSON.stringify({
    pais:           (f.pais    || []).slice().sort(),
    partner:        (f.partner || []).slice().sort(),
    produto:        (f.produto || []).slice().sort(),
    gateway:        (f.gateway || []).slice().sort(),
    viaje:          (f.viaje   || []).slice().sort(),
    lob_tipo:       (Array.isArray(f.lob_tipo) ? f.lob_tipo.slice().sort() : f.lob_tipo) || null,
    date_type:      f.date_type      || 'gd',
    baselineSource: f.baselineSource || 'bl',
    organic:        organicTarget_(f)
  });
  var orgTarget = organicTarget_(f);
  var ck = null;
  var tStart = Date.now();
  try {
    var t1 = DriveApp.getFileById(GESTIONAL_JSON_FILE_ID).getLastUpdated().getTime();
    var t2 = DriveApp.getFileById(GESTIONAL_VR_JSON_FILE_ID).getLastUpdated().getTime();
    var t3 = orgTarget ? DriveApp.getFileById(FX_FILE_ID).getLastUpdated().getTime() : 0;   // xlsx de TC (organic)
    ck = 'getdata_v5_' + t1 + '_' + t2 + '_' + t3 + '_' + Utilities.base64EncodeWebSafe(sig);
    var hit = _readGetDataCache_(ck);
    if (hit) { Logger.log('getData HIT ' + (Date.now() - tStart) + ' ms'); return hit; }
  } catch (e) { Logger.log('getData cache probe: ' + e); }
  var tMiss = Date.now();

  var out = _computeGetData_(f);
  // ORGANIC opción B: con Goal Budget/Forecast, las agregaciones del baseline a TC Actuals LY van en
  // `yoy` (el front calcula los YoY con eso; los montos que muestra siguen a TC del Goal).
  if (orgTarget && orgTarget !== 'ly' && out.organic && !out.organic.error) {
    var outY = _computeGetData_(Object.assign({}, f, { organic: 'ly' }));
    var det = outY.b2bCanalDetail;
    out.yoy = {
      agg: outY.agg, agg_may: outY.agg_may, agg_min: outY.agg_min,
      agg_farming: outY.agg_farming, agg_hunting: outY.agg_hunting,
      partnerMonthly: outY.partnerMonthly, partnerCountryMonthly: outY.partnerCountryMonthly,
      b2bCanalDetail: det ? { 'B2B-MIN': { fc: det['B2B-MIN'].fc }, 'B2B-MAY': { fc: det['B2B-MAY'].fc } } : null
    };
    if (outY.organic && outY.organic.error) out.organic.error = outY.organic.error;
    ((outY.organic && outY.organic.missing) || []).forEach(function(k) {
      if (out.organic.missing.indexOf(k) < 0) out.organic.missing.push(k);
    });
    out.organic.missing.sort();
  }
  var tComp = Date.now();
  // Si falló la lectura del TC no se cachea: el próximo intento vuelve a probar
  if (ck && !(out.organic && out.organic.error)) _writeGetDataCache_(ck, out);
  Logger.log('getData MISS probe=' + (tMiss - tStart) + ' ms, compute=' + (tComp - tMiss) + ' ms, write=' + (Date.now() - tComp) + ' ms');
  return out;
}

function _computeGetData_(filters) {
  var f              = filters || {};
  var dateType       = (f['date_type'] === 'ri') ? 'ri' : 'gd';
  var baselineSrc    = (f['baselineSource'] === 'vr') ? 'vr' : 'bl';
  var json           = readGestionalJSON_(baselineSrc);

  // LOBs a consultar
  var lobTipo = f['lob_tipo'];
  var lobArr  = (!lobTipo || lobTipo === 'all' || (Array.isArray(lobTipo) && lobTipo.length === 0))
    ? ['B2B2C', 'B2B-MAY', 'B2B-MIN']
    : (Array.isArray(lobTipo) ? lobTipo : [lobTipo]);

  var useB2B2C = lobArr.indexOf('B2B2C')   >= 0;
  var useMay   = lobArr.indexOf('B2B-MAY') >= 0;
  var useMin   = lobArr.indexOf('B2B-MIN') >= 0;

  // Escenarios (RI existe para b2b_may y b2b_min; b2b2c tiene fecha única):
  //   primaria  = baseline (bl)  → se devuelve como `agg`
  //   goals     = budget (bgt) / forecast (fc) / last year (ly)
  var blKey  = dateType === 'ri' ? 'bl_ri'  : 'bl';
  var bgtKey = dateType === 'ri' ? 'bgt_ri' : 'bgt';
  var fcKey  = dateType === 'ri' ? 'fc_ri'  : 'fc';

  // Filtros normalizados
  var fPais    = normFilter_(f['pais']);
  var fPartner = normFilter_(f['partner']);
  var fProduto = normFilter_(f['produto']);
  var fGateway = normFilter_(f['gateway']);
  var fViaje   = normFilter_(f['viaje']);

  // Modo gateway (B2B, Hotels): baseline = Actuals de Hotels del gateway (ac_gw / ac_ri_gw),
  // LY = ly_gw recortado a los mismos meses cerrados, Budget/Forecast vacíos (no abren por
  // gateway — la landing los muestra como n/d). Projection Reviews solo cambia la proyección
  // (copia las *_gw del normal); si es un VR viejo sin esas secciones, se leen del JSON normal.
  var gwMode  = fGateway.length > 0 && (useMay || useMin);
  var gwJson  = !(useMay || useMin) ? null
              : (json.b2b_may && json.b2b_may.ac_gw) ? json : readGestionalJSON_('bl');
  var acGwKey = dateType === 'ri' ? 'ac_ri_gw' : 'ac_gw';

  // ORGANIC: se convierte SOLO el baseline (bl/bl_ri y, en modo gateway, ac_gw/ac_ri_gw). Ver Codigo_organic.js.
  var organicInfo = null, orgTarget = organicTarget_(f);
  if (orgTarget) {
    try {
      var conv = organicConverter_(orgTarget);
      var jsonOrg = organicGestionalJson_(json, [blKey, acGwKey], conv);
      gwJson = !gwJson ? null : (gwJson === json) ? jsonOrg : organicGestionalJson_(gwJson, [acGwKey], conv);
      json = jsonOrg;
      organicInfo = { target: orgTarget, missing: Object.keys(conv.missing).sort() };
    } catch (e) {
      organicInfo = { target: orgTarget, error: 'No se pudo leer el archivo de tipos de cambio: ' + e.message };
    }
  }

  var gwYmOk  = {};
  ((gwJson && gwJson.actual_months) || []).forEach(function(ym){ gwYmOk[ym] = true; });

  // Viaje: opciones del baseline en uso; si el JSON no trae la columna, el filtro se ignora.
  var viajeOpts = (useMay || useMin) ? listViajes_(json, useMay, useMin, [blKey, bgtKey, fcKey, 'ly']) : [];
  if (!viajeOpts.length) fViaje = [];

  // Acumuladores  (fcAgg* = BASELINE primaria; fcstAgg* = forecast goal)
  var fcAgg  = {}, bgtAgg = {}, lyAgg = {}, fcstAgg = {};
  var fcAgg_may = {}, bgtAgg_may = {}, lyAgg_may = {}, fcstAgg_may = {};
  var fcAgg_min = {}, bgtAgg_min = {}, lyAgg_min = {}, fcstAgg_min = {};
  var partnerAgg           = {};  // {partner:{gb,nr,npv}}
  var partnerMonthlyAgg    = {};  // {partner:{mes:{all metrics}}}
  var partnerCountryMonthly = {}; // {pais:{partner:{mes:{gb,nr,npv}}}}
  var bgtPartnerMonthly    = {};  // {partner:{mes:{all metrics}}}
  var lyPartnerMonthly     = {};  // {partner:{mes:{all metrics}}}
  var bgtPartnerCM         = {};  // {pais:{partner:{mes:{gb,nr,npv}}}}
  var lyPartnerCM          = {};  // {pais:{partner:{mes:{gb,nr,npv}}}}
  var fcstPartnerMonthly   = {};  // {partner:{mes:{all metrics}}}
  var fcstPartnerCM        = {};  // {pais:{partner:{mes:{gb,nr,npv}}}}
  var allPaises = {}, allPartners = {}, allProdutos = {};
  var lobsInData = {};
  var fcAgg_farming = {}, bgtAgg_farming = {}, lyAgg_farming = {}, fcstAgg_farming = {};
  var fcAgg_hunting = {}, bgtAgg_hunting = {}, lyAgg_hunting = {}, fcstAgg_hunting = {};

  if (useB2B2C) {
    lobsInData['B2B2C'] = true;
    // BASELINE (primaria): breakdowns completos
    queryB2B2C_(json.b2b2c, 'bl', fPais, fPartner, fProduto,
                fcAgg, partnerAgg, partnerMonthlyAgg, partnerCountryMonthly,
                allPaises, allPartners, allProdutos,
                fcAgg_farming, fcAgg_hunting);
    // Goal — Budget
    queryB2B2C_(json.b2b2c, 'bgt', fPais, fPartner, fProduto,
                bgtAgg, null, bgtPartnerMonthly, bgtPartnerCM,
                {}, {}, {},
                bgtAgg_farming, bgtAgg_hunting);
    // Goal — Last Year
    queryB2B2C_(json.b2b2c, 'ly', fPais, fPartner, fProduto,
                lyAgg, null, lyPartnerMonthly, lyPartnerCM,
                {}, {}, {},
                lyAgg_farming, lyAgg_hunting);
    // Goal — Forecast
    queryB2B2C_(json.b2b2c, 'fc', fPais, fPartner, fProduto,
                fcstAgg, null, fcstPartnerMonthly, fcstPartnerCM,
                {}, {}, {},
                fcstAgg_farming, fcstAgg_hunting);
  }

  if (useMay) {
    lobsInData['B2B-MAY'] = true;
    if (gwMode) {
      queryB2B_(gwJson.b2b_may, acGwKey, fPais, fGateway, fcAgg_may, allPaises, {}, gwYmOk, fViaje);
      queryB2B_(gwJson.b2b_may, 'ly_gw', fPais, fGateway, lyAgg_may, {},        {}, gwYmOk, fViaje);
    } else {
      queryB2B_(json.b2b_may, blKey,  fPais, fProduto, fcAgg_may,   allPaises, allProdutos, null, fViaje);
      queryB2B_(json.b2b_may, bgtKey, fPais, fProduto, bgtAgg_may,  {}, {}, null, fViaje);
      queryB2B_(json.b2b_may, 'ly',   fPais, fProduto, lyAgg_may,   {}, {}, null, fViaje);
      queryB2B_(json.b2b_may, fcKey,  fPais, fProduto, fcstAgg_may, {}, {}, null, fViaje);
    }
    mergeAgg_(fcAgg_may,   fcAgg);
    mergeAgg_(bgtAgg_may,  bgtAgg);
    mergeAgg_(lyAgg_may,   lyAgg);
    mergeAgg_(fcstAgg_may, fcstAgg);
  }

  if (useMin) {
    lobsInData['B2B-MIN'] = true;
    if (gwMode) {
      queryB2B_(gwJson.b2b_min, acGwKey, fPais, fGateway, fcAgg_min, allPaises, {}, gwYmOk, fViaje);
      queryB2B_(gwJson.b2b_min, 'ly_gw', fPais, fGateway, lyAgg_min, {},        {}, gwYmOk, fViaje);
    } else {
      queryB2B_(json.b2b_min, blKey,  fPais, fProduto, fcAgg_min,   allPaises, allProdutos, null, fViaje);
      queryB2B_(json.b2b_min, bgtKey, fPais, fProduto, bgtAgg_min,  {}, {}, null, fViaje);
      queryB2B_(json.b2b_min, 'ly',   fPais, fProduto, lyAgg_min,   {}, {}, null, fViaje);
      queryB2B_(json.b2b_min, fcKey,  fPais, fProduto, fcstAgg_min, {}, {}, null, fViaje);
    }
    mergeAgg_(fcAgg_min,   fcAgg);
    mergeAgg_(bgtAgg_min,  bgtAgg);
    mergeAgg_(lyAgg_min,   lyAgg);
    mergeAgg_(fcstAgg_min, fcstAgg);
  }

  // Meses con datos, en orden fiscal
  var months = YM_ORDER
    .map(function(ym){ return YM_LABEL[ym]; })
    .filter(function(m){ return !!fcAgg[m]; });

  // Revenue margin
  months.forEach(function(mes) {
    var gb = fcAgg[mes]['gross_bookings'] || 0;
    var nr = fcAgg[mes]['net_revenue']    || 0;
    fcAgg[mes]['revenue_margin'] = gb ? (nr / gb) * 100 : 0;
  });

  // Lista de partners ordenada por net_revenue desc
  var partners = Object.keys(partnerAgg).map(function(p) {
    return {
      partner:        p,
      gross_bookings: partnerAgg[p].gross_bookings,
      net_revenue:    partnerAgg[p].net_revenue,
      npv:            partnerAgg[p].npv
    };
  }).sort(function(a, b){ return (b.net_revenue || 0) - (a.net_revenue || 0); });

  // Opciones de filtro disponibles en los datos resultantes
  var filters_out = {
    lob_tipo: ['B2B2C','B2B-MAY','B2B-MIN'].filter(function(t){ return lobsInData[t]; }),
    pais:     Object.keys(allPaises).sort(),
    partner:  Object.keys(allPartners).sort(),
    produto:  gwMode ? ['Hotels'] : Object.keys(allProdutos).sort(),
    gateway:  gwJson ? listGateways_(gwJson, useMay, useMin) : [],
    viaje:    viajeOpts,
  };

  var b2bCanalDetail = (useMay || useMin)
    ? queryB2BCanalDetail_(json, blKey, bgtKey, fcKey, fPais, fProduto,
        gwMode ? { json: gwJson, acKey: acGwKey, fGateway: fGateway, ymOk: gwYmOk } : null, fViaje)
    : null;

  return {
    organic:              organicInfo,
    months:               months,
    agg:                  fcAgg,
    filters:              filters_out,
    partners:             partners,
    budget:               bgtAgg,
    ly:                   lyAgg,
    partnerMonthly:       partnerMonthlyAgg,
    partnerCountryMonthly: partnerCountryMonthly,
    budgetPartnerMonthly: bgtPartnerMonthly,
    lyPartnerMonthly:     lyPartnerMonthly,
    budgetPartnerCM:      bgtPartnerCM,
    lyPartnerCM:          lyPartnerCM,
    forecastPartnerCM:    fcstPartnerCM,
    forecastPartnerMonthly: fcstPartnerMonthly,
    actual_months:        json.actual_months || [],
    gateway_mode:         gwMode,
    gateway_sel:          gwMode ? (Array.isArray(f.gateway) ? f.gateway : [f.gateway]) : [],
    viaje_sel:            fViaje.length && (useMay || useMin) ? (Array.isArray(f.viaje) ? f.viaje : [f.viaje]) : [],
    b2bCanalDetail:       b2bCanalDetail,
    forecast:             fcstAgg,
    agg_may:              fcAgg_may,
    budget_may:           bgtAgg_may,
    ly_may:               lyAgg_may,
    forecast_may:         fcstAgg_may,
    agg_min:              fcAgg_min,
    budget_min:           bgtAgg_min,
    ly_min:               lyAgg_min,
    forecast_min:         fcstAgg_min,
    agg_farming:          fcAgg_farming,
    budget_farming:       bgtAgg_farming,
    ly_farming:           lyAgg_farming,
    forecast_farming:     fcstAgg_farming,
    b2b2c_stage:          _getB2B2CStageMap_() || null,   // el frontend clasifica Hunting con esto (partnerIsHunting)
    agg_hunting:          fcAgg_hunting,
    budget_hunting:       bgtAgg_hunting,
    ly_hunting:           lyAgg_hunting,
    forecast_hunting:     fcstAgg_hunting,
  };
}

// Gateways de Hotels presentes en el JSON (Actuals GD/RI + LY), ordenados por GB desc
// de Actuals GD — los grandes arriba en el selector.
function listGateways_(json, useMay, useMin) {
  var gb = {};
  var secs = [];
  if (useMay) secs.push(json.b2b_may || {});
  if (useMin) secs.push(json.b2b_min || {});
  secs.forEach(function(sec) {
    ['ac_gw', 'ac_ri_gw', 'ly_gw'].forEach(function(k) {
      (sec[k] || []).forEach(function(row) {
        var g = row[1];
        if (!g) return;
        if (!(g in gb)) gb[g] = 0;
        if (k === 'ac_gw') gb[g] += (row[3 + _I_GB] || 0);
      });
    });
  });
  return Object.keys(gb).sort(function(a, b) { return (gb[b] - gb[a]) || a.localeCompare(b); });
}

// Tipos de viaje presentes en los escenarios B2B que se filtran. Si alguna fila no trae la columna (JSON de antes
// del 2026-10-13, o un Projection Review armado antes) devuelve [] → la landing oculta el filtro
// en vez de filtrar a medias (esas filas quedarían afuera).
function listViajes_(json, useMay, useMin, scenarioKeys) {
  var vals = {}, incomplete = false;
  var secs = [];
  if (useMay) secs.push(json.b2b_may || {});
  if (useMin) secs.push(json.b2b_min || {});
  secs.forEach(function(sec) {
    scenarioKeys.forEach(function(k) {
      (sec[k] || []).forEach(function(row) {
        if (row.length <= _I_VJ_B2B) { incomplete = true; return; }
        vals[row[_I_VJ_B2B]] = true;
      });
    });
  });
  if (incomplete) return [];
  var ORDER = ['Domestic', 'International'];
  return Object.keys(vals).sort(function(a, b) {
    var ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

// Opciones de filtro disponibles en el JSON (sin aplicar filtros)
function getFilterOptions() {
  var json = readGestionalJSON_();
  var paises = {}, partners = {}, produtos = {};

  function scanB2B2C(rows) {
    (rows || []).forEach(function(r){ if(r[0]) paises[normB2B2CPais_(r[0])]=true; if(r[1]) partners[normB2B2CPartner_(r[1])]=true; if(r[2]) produtos[r[2]]=true; });
  }
  function scanB2B(rows) {
    (rows || []).forEach(function(r){ if(r[0]) paises[r[0]]=true; if(r[1]) produtos[r[1]]=true; });
  }

  var b2b2c   = json.b2b2c   || {};
  var b2b_may = json.b2b_may || {};
  var b2b_min = json.b2b_min || {};

  scanB2B2C(b2b2c.bl);
  scanB2B(b2b_may.bl);
  scanB2B(b2b_min.bl);

  return {
    lob_tipo: ['B2B2C','B2B-MAY','B2B-MIN'],
    pais:     Object.keys(paises).sort(),
    partner:  Object.keys(partners).sort(),
    produto:  Object.keys(produtos).sort(),
  };
}

// ══════════════════════════════════════════════════════════════════════════
//  Managerial vs Accounting — comparación de REALES, meses cerrados
// ──────────────────────────────────────────────────────────────────────────
//  Accounting = actuals.json canónico de Inputs_Planning_PnL
//  (Drive folder 1XqQPL..., mismo archivo que alimenta el cubo de P&L Accounting).
//  Managerial  = escenario 'ac' (+ 'ac_ri' para b2b_may) de _actuals_gestional.json.
//  Solo Total B2B + B2B2C (v1, sin filtro país/producto). GD basis (ac, no ac_ri).
// ══════════════════════════════════════════════════════════════════════════
var ACC_ACTUALS_FILE_ID = '1PABNf4XVKdj6eXApr5_yP581ZsD_N9e-'; // actuals.json
var _accActualsCache_   = null;

function readAccActualsJSON_() {
  if (_accActualsCache_) return _accActualsCache_;
  try {
    var blob = DriveApp.getFileById(ACC_ACTUALS_FILE_ID).getBlob();
    _accActualsCache_ = JSON.parse(blob.getDataAsString());
  } catch (e) {
    Logger.log('readAccActualsJSON_ error: ' + e);
    _accActualsCache_ = { cols: [], rows: [], meta: {} };
  }
  return _accActualsCache_;
}

// 'YYYY-MM-01' (o 'YYYY-MM-...') → 'Abr-26'
function _accMes_(fecha) {
  return YM_LABEL[String(fecha || '').slice(0, 7)] || null;
}

// País canónico para conciliar (Managerial y Accounting usan strings distintos)
var _VSA_PAIS_CANON = {
  'argentina':'Argentina','brasil':'Brasil','brazil':'Brasil','chile':'Chile','colombia':'Colombia',
  'ecuador':'Ecuador','mexico':'Mexico','méxico':'Mexico','peru':'Peru','perú':'Peru',
  'other countries':'Otros','others countries':'Otros','globales':'Otros','other':'Otros',
  'otros':'Otros','otro':'Otros','rg':'Otros','paraguay':'Otros','uruguay':'Otros','n/d':'Otros'
};
function _vsaPaisCanon_(p){
  var k = String(p || '').trim().toLowerCase();
  return _VSA_PAIS_CANON[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Otros');
}
// canónico → strings crudos que ven las queries Managerial (para el filtro fPais)
var _VSA_PAIS_RAW = {
  'Argentina':['argentina'], 'Brasil':['brasil'], 'Chile':['chile'], 'Colombia':['colombia'],
  'Ecuador':['ecuador'], 'Mexico':['mexico'], 'Peru':['peru'],
  'Otros':['other countries','others countries','globales','otros','otro','uruguay','paraguay','rg','n/d']
};

function getVsAccounting(filtersJson) {
  var f = (filtersJson && typeof filtersJson === 'object') ? filtersJson : {};
  var sig = JSON.stringify([(f.pais||[]).slice().sort(), (f.produto||[]).slice().sort()]);
  var cache = CacheService.getScriptCache();
  var ck = null;
  var tStart = Date.now();
  try {
    var t1 = DriveApp.getFileById(GESTIONAL_JSON_FILE_ID).getLastUpdated().getTime();
    var t2 = DriveApp.getFileById(ACC_ACTUALS_FILE_ID).getLastUpdated().getTime();
    ck = 'vsacc_v6_' + t1 + '_' + t2 + '_' + Utilities.base64EncodeWebSafe(sig);
    var hit = cache.get(ck);
    if (hit) return JSON.parse(hit);
  } catch (e) { Logger.log('getVsAccounting cache probe: ' + e); }

  var out = _computeVsAccounting_(f);
  if (ck) { try { cache.put(ck, JSON.stringify(out), 21600); } catch (e) {} }  // 6 h
  return out;
}

function _computeVsAccounting_(f) {
  f = f || {};
  var json = readGestionalJSON_('bl');
  var FY = YM_ORDER.map(function(y){ return YM_LABEL[y]; });

  // ── Filtros: país canónico + producto (lowercase) ──
  var selPais = (f.pais || []).map(function(s){ return String(s); });           // ['Argentina', 'Otros', ...]
  var selProd = (f.produto || []).map(function(s){ return String(s).toLowerCase(); });
  var fPaisMgr = [];
  selPais.forEach(function(cp){ (_VSA_PAIS_RAW[cp] || [cp.toLowerCase()]).forEach(function(r){ fPaisMgr.push(r); }); });

  // ── Managerial actuals por LOB — {metric:{mes}} + set de meses ──
  function mgrFor(lob, scen) {
    var raw = {};
    if (lob === 'b2b2c') {
      queryB2B2C_(json.b2b2c, scen, fPaisMgr, [], selProd, raw, null,null,null,null,null,null,null,null);
    } else {
      queryB2B_(json['b2b_' + lob], scen, fPaisMgr, selProd, raw, null, null);
    }
    var t = {}, mm = {};
    Object.keys(raw).forEach(function(mes){
      mm[mes] = true;
      Object.keys(raw[mes]).forEach(function(k){
        if (!t[k]) t[k] = {};
        t[k][mes] = (t[k][mes] || 0) + raw[mes][k];
      });
    });
    return { data: t, months: mm };
  }
  // RI donde exista (B2B-MAY check-in API, B2B-MIN recognition_date); B2B2C tiene
  // una sola fecha (GD = RI), así que va 'ac'.
  var M = {
    b2b2c: mgrFor('b2b2c', 'ac'),
    may:   mgrFor('may',   'ac_ri'),
    min:   mgrFor('min',   'ac_ri')
  };

  // ── Accounting por LOB — actuals.json, P&L N1 + N3/N4, split por LoB×Canal ──
  var A = { b2b2c: {}, may: {}, min: {} };
  var accMonths = {};
  var paisOpts = {}, prodOpts = {};
  var aj  = readAccActualsJSON_();
  var cix = {};
  (aj.cols || []).forEach(function(c, i){ cix[c] = i; });
  var iLob = cix['LoB'], iCanal = cix['Canal'], iPais = cix['Pais'], iProd = cix['Producto'],
      iN1 = cix['P&L N1'], iN3 = cix['P&L N3'], iN4 = cix['P&L N4'], iFecha = cix['Fecha'], iMonto = cix['Monto USD'];
  (aj.rows || []).forEach(function(r){
    var lob = String(r[iLob] || '').toLowerCase(), canal = String(r[iCanal] || '').toLowerCase();
    var bucket = (lob === 'b2b2c') ? 'b2b2c'
               : (lob === 'b2b' && canal === 'may') ? 'may'
               : (lob === 'b2b' && canal === 'min') ? 'min' : null;
    if (!bucket) return;
    var cp = _vsaPaisCanon_(r[iPais]);
    var prd = String(r[iProd] || '').toLowerCase();
    paisOpts[cp] = true; if (prd) prodOpts[prd] = true;
    if (selPais.length && selPais.indexOf(cp) < 0) return;
    if (selProd.length && selProd.indexOf(prd) < 0) return;
    var mes = _accMes_(r[iFecha]); if (!mes) return;
    var val = (+r[iMonto] || 0), dst = A[bucket];
    [['n1', r[iN1]], ['n3', r[iN3]], ['n4', r[iN4]]].forEach(function(p){
      var k = p[0] + '|' + String(p[1] || '(sin ' + p[0] + ')').toLowerCase();
      if (!dst[k]) dst[k] = {};
      dst[k][mes] = (dst[k][mes] || 0) + val;
    });
    accMonths[mes] = true;
  });

  function isect(mm){ return FY.filter(function(m){ return mm[m] && accMonths[m]; }); }
  return {
    accMeta:  aj.meta || {},
    paisOpts: ['Argentina','Brasil','Mexico','Colombia','Chile','Peru','Ecuador','Otros'].filter(function(p){ return paisOpts[p]; }),
    prodOpts: Object.keys(prodOpts).sort(),
    selPais:  selPais,
    selProd:  selProd,
    lobs: {
      b2b2c: { label: 'B2B2C',     mgrLabel: 'ac (fecha única)', months: isect(M.b2b2c.months), mgr: M.b2b2c.data, acc: A.b2b2c },
      may:   { label: 'B2B · MAY', mgrLabel: 'ac_ri (RI)',      months: isect(M.may.months),   mgr: M.may.data,   acc: A.may },
      min:   { label: 'B2B · MIN', mgrLabel: 'ac_ri (RI)',      months: isect(M.min.months),   mgr: M.min.data,   acc: A.min }
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════
//  Sub-sección: B2B actuals GD (gestional) vs Revenue por GD
// ──────────────────────────────────────────────────────────────────────────
//  Izquierda  = escenario 'ac' de b2b_may + b2b_min de _actuals_gestional.json
//               (basis gestion_date = GD; NO 'ac_ri').
//  Derecha    = revenue_gd.json (revenue_gd_builder.py): modelo de revenue B2B
//               (bi_transactional_fact_* + b2b_rev_pnl_sales_detail), basis GD.
//  Total B2B, meses cerrados, con filtro país (canónico) + producto.
// ══════════════════════════════════════════════════════════════════════════
var REVENUE_GD_FOLDER_ID = '1wzudbo7cN9Ibiv_2OA-V0_B_un4JcJp6'; // misma carpeta que _actuals_gestional.json
var REVENUE_GD_JSON_NAME  = 'revenue_gd.json';
var _revGdCache_ = null;

function _revGdFile_() {
  var it = DriveApp.getFolderById(REVENUE_GD_FOLDER_ID).getFilesByName(REVENUE_GD_JSON_NAME);
  return it.hasNext() ? it.next() : null;
}

function readRevenueGdJSON_() {
  if (_revGdCache_) return _revGdCache_;
  var empty = { rows: [], metrics: METRIC_COLS, metrics_extra: [], zero_metrics: [], updated_at: null };
  try {
    var f = _revGdFile_();
    _revGdCache_ = f ? JSON.parse(f.getBlob().getDataAsString()) : empty;
  } catch (e) {
    Logger.log('readRevenueGdJSON_ error: ' + e);
    _revGdCache_ = empty;
  }
  return _revGdCache_;
}

function getRevenueGDVsGestional(filtersJson) {
  var f = (filtersJson && typeof filtersJson === 'object') ? filtersJson : {};
  var sig = JSON.stringify([(f.pais || []).slice().sort(), (f.produto || []).slice().sort()]);
  var cache = CacheService.getScriptCache();
  var ck = null;
  var tStart = Date.now();
  try {
    var t1 = DriveApp.getFileById(GESTIONAL_JSON_FILE_ID).getLastUpdated().getTime();
    var rf = _revGdFile_();
    var t2 = rf ? rf.getLastUpdated().getTime() : 0;
    ck = 'revgd_v3_' + t1 + '_' + t2 + '_' + Utilities.base64EncodeWebSafe(sig);
    var hit = cache.get(ck);
    if (hit) return JSON.parse(hit);
  } catch (e) { Logger.log('getRevenueGDVsGestional cache probe: ' + e); }

  var out = _computeRevenueGD_(f);
  if (ck) { try { cache.put(ck, JSON.stringify(out), 21600); } catch (e) {} }  // 6 h
  return out;
}

// Suma NR (idx 27) y FVM (idx 28) del escenario 'ac' de una sección B2B gestional,
// por país canónico y mes, para un canal fijo ('MAY'|'MIN'). Filtro país + producto.
// Los 8 países del cuadro resumen; cualquier otro cae en 'Otros' para que el
// TOTAL del resumen cuadre con la fila Net Revenue del detalle.
var _REVGD_PAIS8 = ['Argentina','Brasil','Mexico','Colombia','Chile','Peru','Ecuador','Otros'];
function _revGdPais8_(cp){ return _REVGD_PAIS8.indexOf(cp) >= 0 ? cp : 'Otros'; }

function _gestB2BByPaisNRFVM_(section, canal, fPaisRaw, selProd, out) {
  var rows = (section && section.ac) || [];
  var iNR = 3 + METRIC_COLS.indexOf('net_revenue');
  var iFV = 3 + METRIC_COLS.indexOf('npv');
  rows.forEach(function(row) {
    var pais = normB2BPais_(row[0]), produto = row[1], ym = row[2];
    if (!matchFilter_(pais, fPaisRaw) || !matchFilter_(produto, selProd)) return;
    var mes = YM_LABEL[ym]; if (!mes) return;
    var cp = _revGdPais8_(_vsaPaisCanon_(pais));
    if (!out[cp])        out[cp] = {};
    if (!out[cp][canal]) out[cp][canal] = { net_revenue: {}, npv: {} };
    var o = out[cp][canal];
    o.net_revenue[mes] = (o.net_revenue[mes] || 0) + (row[iNR] || 0);
    o.npv[mes]         = (o.npv[mes]         || 0) + (row[iFV] || 0);
  });
}

function _computeRevenueGD_(f) {
  f = f || {};
  var selPais = (f.pais || []).map(function(s){ return String(s); });               // canónico: ['Argentina','Otros',...]
  var selProd = (f.produto || []).map(function(s){ return String(s).toLowerCase(); });

  // ── Izquierda: gestional B2B 'ac' (GD), por canal ──
  var json = readGestionalJSON_('bl');
  var fPaisMgr = [];
  selPais.forEach(function(cp){ (_VSA_PAIS_RAW[cp] || [cp.toLowerCase()]).forEach(function(r){ fPaisMgr.push(r); }); });
  var mgrMonths = {};
  // aggAgg {mes:{metric}} → {metric:{mes}}
  function _transposeAgg_(agg) {
    var out = {};
    Object.keys(agg).forEach(function(mes){
      mgrMonths[mes] = true;
      METRIC_COLS.forEach(function(m){ if (!out[m]) out[m] = {}; out[m][mes] = (out[m][mes] || 0) + (agg[mes][m] || 0); });
    });
    return out;
  }
  var mgrMayAgg = {}, mgrMinAgg = {};
  queryB2B_(json.b2b_may, 'ac', fPaisMgr, selProd, mgrMayAgg, null, null);
  queryB2B_(json.b2b_min, 'ac', fPaisMgr, selProd, mgrMinAgg, null, null);
  var mgrMay = _transposeAgg_(mgrMayAgg), mgrMin = _transposeAgg_(mgrMinAgg);
  var mgr = {};
  [mgrMay, mgrMin].forEach(function(src){
    Object.keys(src).forEach(function(m){ if (!mgr[m]) mgr[m] = {}; Object.keys(src[m]).forEach(function(mes){ mgr[m][mes] = (mgr[m][mes] || 0) + src[m][mes]; }); });
  });
  // breakdown país × canal (solo NR + FVM) — lado gestional
  var pcMgr = {};
  _gestB2BByPaisNRFVM_(json.b2b_may, 'MAY', fPaisMgr, selProd, pcMgr);
  _gestB2BByPaisNRFVM_(json.b2b_min, 'MIN', fPaisMgr, selProd, pcMgr);

  // ── Derecha: revenue_gd.json ──  rows = [pais, canal, produto, ym, ...metrics]
  var rj = readRevenueGdJSON_();
  var metrics = (rj.metrics && rj.metrics.length) ? rj.metrics : METRIC_COLS;
  var extra   = rj.metrics_extra || [];
  var allM    = metrics.concat(extra);
  var OFF     = 4;                                   // pais, canal, produto, ym
  var _iNR = metrics.indexOf('net_revenue'), _iFV = metrics.indexOf('npv');
  var iNRrev  = _iNR >= 0 ? OFF + _iNR : OFF + METRIC_COLS.indexOf('net_revenue');
  var iFVrev  = _iFV >= 0 ? OFF + _iFV : OFF + METRIC_COLS.indexOf('npv');
  var paisOpts = {}, prodOpts = {}, canalOpts = {};
  var rev = {}, revMay = {}, revMin = {}, revMonths = {}, pcRev = {};
  (rj.rows || []).forEach(function(r){
    var cp  = _revGdPais8_(String(r[0]));            // ya canónico (revenue_gd_builder.py); clamp a los 8
    var cn  = String(r[1] || 'MAY');
    var prd = String(r[2] || '');
    var ym  = String(r[3] || '');
    paisOpts[cp] = true; canalOpts[cn] = true; if (prd) prodOpts[prd.toLowerCase()] = true;
    if (selPais.length && selPais.indexOf(cp) < 0) return;
    if (selProd.length && selProd.indexOf(prd.toLowerCase()) < 0) return;
    var mes = YM_LABEL[ym]; if (!mes) return;
    revMonths[mes] = true;
    var dstC = cn === 'MIN' ? revMin : revMay;
    allM.forEach(function(m, i){
      if (!rev[m])  rev[m]  = {};
      if (!dstC[m]) dstC[m] = {};
      var val = (r[OFF + i] || 0);
      rev[m][mes]  = (rev[m][mes]  || 0) + val;
      dstC[m][mes] = (dstC[m][mes] || 0) + val;
    });
    if (!pcRev[cp])     pcRev[cp] = {};
    if (!pcRev[cp][cn]) pcRev[cp][cn] = { net_revenue: {}, npv: {} };
    pcRev[cp][cn].net_revenue[mes] = (pcRev[cp][cn].net_revenue[mes] || 0) + (r[iNRrev] || 0);
    pcRev[cp][cn].npv[mes]         = (pcRev[cp][cn].npv[mes]         || 0) + (r[iFVrev] || 0);
  });

  var FY = YM_ORDER.map(function(y){ return YM_LABEL[y]; });
  var months = FY.filter(function(m){ return mgrMonths[m] && revMonths[m]; });

  // ── Cuadro resumen país × canal: NR + FVM por mes (el frontend elige mes o acumulado) ──
  var PAIS_ORDER = _REVGD_PAIS8;
  var CANAL_ORDER = ['MAY','MIN'];
  var summary = [];
  PAIS_ORDER.forEach(function(p){
    CANAL_ORDER.forEach(function(cn){
      var g = (pcMgr[p] || {})[cn], v = (pcRev[p] || {})[cn];
      if (!g && !v) return;
      summary.push({
        pais: p, canal: cn,
        nrGest:  (g && g.net_revenue) || {}, nrRev:  (v && v.net_revenue) || {},
        fvmGest: (g && g.npv)         || {}, fvmRev: (v && v.npv)         || {}
      });
    });
  });

  return {
    updatedAt:    rj.updated_at || null,
    metrics:      metrics,
    metricsExtra: extra,
    zeroMetrics:  rj.zero_metrics || [],
    months:       months,
    mgr:          mgr,
    rev:          rev,
    detail:       [                        // detalle P&L: Total + por canal
      { label: 'Total B2B',    mgr: mgr,    rev: rev    },
      { label: 'B2B · MAY (API)', mgr: mgrMay, rev: revMay },
      { label: 'B2B · MIN (AFF)', mgr: mgrMin, rev: revMin }
    ],
    summary:      summary,                 // [{pais,canal, nrGest:{mes},nrRev:{mes}, fvmGest:{mes},fvmRev:{mes}}]
    paisOpts:     PAIS_ORDER.filter(function(p){ return paisOpts[p]; }),
    canalOpts:    CANAL_ORDER.filter(function(c){ return canalOpts[c]; }),
    prodOpts:     Object.keys(prodOpts).sort(),
    selPais:      selPais,
    selProd:      selProd
  };
}

function invalidateCache() {
  _gestionalJsonCache_   = null;
  _gestionalVRJsonCache_ = null;
  _accActualsCache_      = null;
  _revGdCache_           = null;
  _b2b2cStageMap_        = null;
  return { ok: true };
}
