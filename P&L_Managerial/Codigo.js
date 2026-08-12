// P&L Gestional Dashboard — Apps Script Backend v2
// Data source: _pnl_gestional_data.json (generado por pnl_gestional_upload.py)
var GESTIONAL_JSON_FILE_ID = '1wvle0UIVZV7ocCSl8OawOfIGVz_It5kh';
var _gestionalJsonCache_   = null;

// ── Carga y cachea el JSON gestional desde Drive ──────────────────────────
function readGestionalJSON_() {
  if (_gestionalJsonCache_) return _gestionalJsonCache_;
  try {
    var blob = DriveApp.getFileById(GESTIONAL_JSON_FILE_ID).getBlob();
    _gestionalJsonCache_ = JSON.parse(blob.getDataAsString());
  } catch(e) {
    Logger.log('readGestionalJSON_ error: ' + e);
    _gestionalJsonCache_ = {
      b2b2c:   { ac:[], ly:[], bgt:[], rr:[], fc:[], bl:[] },
      b2b_may: { ac:[], ac_ri:[], ly:[], bgt:[], bgt_ri:[], rr:[], rr_ri:[], fc:[], fc_ri:[], bl:[], bl_ri:[] },
      b2b_min: { ac:[], ly:[], bgt:[], rr:[], fc:[], bl:[] },
      actual_months: [],
      months: []
    };
  }
  return _gestionalJsonCache_;
}

// ── FY27: Abr-26 … Mar-27 ────────────────────────────────────────────────
var YM_LABEL = {
  '2026-04':'Abr-26','2026-05':'May-26','2026-06':'Jun-26',
  '2026-07':'Jul-26','2026-08':'Ago-26','2026-09':'Sep-26',
  '2026-10':'Oct-26','2026-11':'Nov-26','2026-12':'Dic-26',
  '2027-01':'Ene-27','2027-02':'Feb-27','2027-03':'Mar-27'
};
var YM_ORDER = [
  '2026-04','2026-05','2026-06','2026-07','2026-08','2026-09',
  '2026-10','2026-11','2026-12','2027-01','2027-02','2027-03'
];

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

// Hunting partner list (lowercase; compared against .toLowerCase() of normalized partner name)
var _B2B2C_HUNTING_LOWER = ['caixa','csu','ypf','cocos','tuplus','vibe','cacau lovers','turismocity','claro','livelo-api-hoteles','invex','bna','banco de chile','itau','tbd','cutc','sams','dotz'];
function isB2B2CHunting_(partner){
  return _B2B2C_HUNTING_LOWER.indexOf(String(partner||'').trim().toLowerCase()) >= 0;
}

// Normaliza aliases de "otros/other/..." → "Globales" para B2B
var _B2B_OTHER_ALIASES = ['other','others','otros','otro','other countries'];
function normB2BPais_(p){
  return _B2B_OTHER_ALIASES.indexOf(String(p||'').trim().toLowerCase()) >= 0 ? 'Globales' : p;
}

function queryB2B_(section, scenarioKey, fPais, fProduto,
                   outAgg, outAllPaises, outAllProdutos) {
  var rows = (section && section[scenarioKey]) || [];
  rows.forEach(function(row) {
    var pais = normB2BPais_(row[0]), produto = row[1], ym = row[2];
    if (!matchFilter_(pais,    fPais))    return;
    if (!matchFilter_(produto, fProduto)) return;
    var mes = YM_LABEL[ym];
    if (!mes) return;
    if (outAllPaises)   outAllPaises[pais]       = true;
    if (outAllProdutos && produto) outAllProdutos[produto] = true;
    addMetrics_(outAgg, mes, row, 3);
  });
}

// Lightweight per-canal, per-country, per-product monthly data (only GB, NR, NPV)
function queryB2BCanalDetail_(json, fcKey, bgtKey, fPais, fProduto) {
  var result = { 'B2B-MIN':{ fc:{}, bgt:{}, ly:{} }, 'B2B-MAY':{ fc:{}, bgt:{}, ly:{} } };
  function procRows(rows, target) {
    (rows||[]).forEach(function(row) {
      var pais=normB2BPais_(row[0]), produto=row[1], ym=row[2];
      if(!matchFilter_(pais,fPais)||!matchFilter_(produto,fProduto)) return;
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
  var min=json.b2b_min||{}, may=json.b2b_may||{};
  procRows(min['fc'],   result['B2B-MIN'].fc);
  procRows(min['bgt'],  result['B2B-MIN'].bgt);
  procRows(min['ly'],   result['B2B-MIN'].ly);
  procRows(may[fcKey],  result['B2B-MAY'].fc);
  procRows(may[bgtKey], result['B2B-MAY'].bgt);
  procRows(may['ly'],   result['B2B-MAY'].ly);
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
// }
function getData(filters) {
  var f        = filters || {};
  var dateType = (f['date_type'] === 'ri') ? 'ri' : 'gd';
  var json     = readGestionalJSON_();

  // LOBs a consultar
  var lobTipo = f['lob_tipo'];
  var lobArr  = (!lobTipo || lobTipo === 'all' || (Array.isArray(lobTipo) && lobTipo.length === 0))
    ? ['B2B2C', 'B2B-MAY', 'B2B-MIN']
    : (Array.isArray(lobTipo) ? lobTipo : [lobTipo]);

  var useB2B2C = lobArr.indexOf('B2B2C')   >= 0;
  var useMay   = lobArr.indexOf('B2B-MAY') >= 0;
  var useMin   = lobArr.indexOf('B2B-MIN') >= 0;

  // Escenarios (RI solo existe para b2b_may):
  //   primaria  = baseline (bl)  → se devuelve como `agg`
  //   goals     = budget (bgt) / forecast (fc) / last year (ly)
  var blKey  = dateType === 'ri' ? 'bl_ri'  : 'bl';
  var bgtKey = dateType === 'ri' ? 'bgt_ri' : 'bgt';
  var fcKey  = dateType === 'ri' ? 'fc_ri'  : 'fc';

  // Filtros normalizados
  var fPais    = normFilter_(f['pais']);
  var fPartner = normFilter_(f['partner']);
  var fProduto = normFilter_(f['produto']);

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
    // Goal — Forecast (stub vacío hasta que exista la query)
    queryB2B2C_(json.b2b2c, 'fc', fPais, fPartner, fProduto,
                fcstAgg, null, null, null,
                {}, {}, {},
                fcstAgg_farming, fcstAgg_hunting);
  }

  if (useMay) {
    lobsInData['B2B-MAY'] = true;
    queryB2B_(json.b2b_may, blKey,  fPais, fProduto, fcAgg_may,   allPaises, allProdutos);
    queryB2B_(json.b2b_may, bgtKey, fPais, fProduto, bgtAgg_may,  {}, {});
    queryB2B_(json.b2b_may, 'ly',   fPais, fProduto, lyAgg_may,   {}, {});
    queryB2B_(json.b2b_may, fcKey,  fPais, fProduto, fcstAgg_may, {}, {});
    mergeAgg_(fcAgg_may,   fcAgg);
    mergeAgg_(bgtAgg_may,  bgtAgg);
    mergeAgg_(lyAgg_may,   lyAgg);
    mergeAgg_(fcstAgg_may, fcstAgg);
  }

  if (useMin) {
    lobsInData['B2B-MIN'] = true;
    queryB2B_(json.b2b_min, 'bl',  fPais, fProduto, fcAgg_min,   allPaises, allProdutos);
    queryB2B_(json.b2b_min, 'bgt', fPais, fProduto, bgtAgg_min,  {}, {});
    queryB2B_(json.b2b_min, 'ly',  fPais, fProduto, lyAgg_min,   {}, {});
    queryB2B_(json.b2b_min, 'fc',  fPais, fProduto, fcstAgg_min, {}, {});
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
    produto:  Object.keys(allProdutos).sort(),
  };

  var b2bCanalDetail = (useMay || useMin)
    ? queryB2BCanalDetail_(json, blKey, bgtKey, fPais, fProduto)
    : null;

  return {
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
    actual_months:        json.actual_months || [],
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
    agg_hunting:          fcAgg_hunting,
    budget_hunting:       bgtAgg_hunting,
    ly_hunting:           lyAgg_hunting,
    forecast_hunting:     fcstAgg_hunting,
  };
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

function invalidateCache() {
  _gestionalJsonCache_ = null;
  return { ok: true };
}
