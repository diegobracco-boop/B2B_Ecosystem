// ============================================================
// Codigo.js — Daily Dashboard  v23
// GAS serves raw JSON only. All compute runs in the browser.
// ============================================================

var DRIVE_FOLDER_ID  = "1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh";
var B2BC_JSON        = "daily_b2b2c_data.json";
var B2B_JSON         = "daily_b2b_data.json";
var B2BC_CACHE_KEY   = "daily_b2bc_v36";
var B2B_CACHE_KEY    = "daily_b2b_v36";
var TIER_JSON        = "partner_tiers.json";
var TIER_CACHE_KEY   = "partner_tiers_v1";
var CACHE_TTL        = 21600;   // 6 h
var CACHE_CHUNK      = 90000;

// ---- Entry point ----

var EMAIL_SECRET = 'despe2026';

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'sendDailyEmail' && e.parameter.secret === EMAIL_SECRET) {
    try {
      sendDailyEmail_();
      return ContentService.createTextOutput('OK');
    } catch(ex) {
      return ContentService.createTextOutput('ERROR: ' + ex.message);
    }
  }
  return HtmlService.createHtmlOutputFromFile('dashboard')
    .setTitle('Dashboard — Despegar')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---- Public API (called from browser via google.script.run) ----

function getRawB2BC() { return loadFile_(B2BC_JSON, B2BC_CACHE_KEY); }
function getRawB2B()  { return loadFile_(B2B_JSON,  B2B_CACHE_KEY);  }
function getPartnerTiers() { return loadFile_(TIER_JSON, TIER_CACHE_KEY); }

// ---- Internal helpers ----

function loadFile_(filename, cacheKey) {
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var files  = folder.getFilesByName(filename);
  if (!files.hasNext()) throw new Error('No encontrado en Drive: ' + filename);
  var file   = files.next();
  // La clave de cache incluye el lastUpdated del archivo: al subir un JSON nuevo
  // cambia el timestamp -> clave nueva -> se lee fresco (sin esperar el TTL de 6 h).
  var key    = cacheKey + '_' + file.getLastUpdated().getTime();
  var cached = cacheGet_(key);
  if (cached) return JSON.parse(cached);
  var raw = file.getBlob().getDataAsString();
  cachePut_(key, raw);
  return JSON.parse(raw);
}

function cachePut_(key, raw) {
  try {
    var cache = CacheService.getScriptCache();
    var n = Math.ceil(raw.length / CACHE_CHUNK);
    cache.put(key + '_n', String(n), CACHE_TTL);
    var BATCH = 90;
    for (var s = 0; s < n; s += BATCH) {
      var obj = {}, e = Math.min(s + BATCH, n);
      for (var i = s; i < e; i++)
        obj[key + '_' + i] = raw.substring(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK);
      cache.putAll(obj, CACHE_TTL);
    }
  } catch(ex) {}
}

function cacheGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var nStr = cache.get(key + '_n');
    if (!nStr) return null;
    var n = parseInt(nStr), parts = [];
    for (var i = 0; i < n; i++) {
      var c = cache.get(key + '_' + i);
      if (!c) return null;
      parts.push(c);
    }
    return parts.join('');
  } catch(ex) { return null; }
}

// ============================================================
// Weekly Summary — data + AI endpoints
// ============================================================

var TOQAN_BASE    = 'https://api.coco.prod.toqan.ai/api';
var BITUBEE_KEY   = 'sk_1c310a2cc99bcedf5a11ef6af31c16a72459ac77c0939fe1f7e0abe2a4d5f9dfc3a7e34384af4724d92a81078e3faeb3f74ecf7aa767d53345df2e0d6e9a';
var BITUBICIA_KEY = 'sk_2cb8e619437f5932978b4714bd544497d9e8f988e793ff415769ea4d101c6c4e627d61bf81c754fd7ffd3883808ab29a3cda253bfb311f670212e1837b5b';

var WS_HISPA  = ['Argentina','Colombia','Chile','Peru','Ecuador'];
var WS_GROUPS = ['TOTAL','Brasil','Mexico','Hispa','Globales'];
var WS_FLAGS  = { 'TOTAL':null,'Brasil':'br','Mexico':'mx','Hispa':'hispa','Globales':'globe' };

// ---- Compact-format expander ----

function _wsExpandCompact_(c) {
  if (!c || !c.cols) return [];
  var cols = c.cols;
  return c.rows.map(function(r) {
    var o = {};
    for (var i = 0; i < cols.length; i++) o[cols[i]] = r[i];
    return o;
  });
}

// ---- ISO week ----

function _wsIsoWeek_(ymd) {
  var p   = ymd.split('-');
  var d   = new Date(Date.UTC(+p[0], +p[1]-1, +p[2]));
  var day = d.getUTCDay() || 7;
  var thu = new Date(Date.UTC(+p[0], +p[1]-1, +p[2]+4-day));
  var jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  return { week: Math.ceil((((thu-jan1)/86400000)+1)/7), year: thu.getUTCFullYear() };
}

// ---- Row normalizer → {fecha, pais, gb, rev, fvm} ----

function _wsNormRows_(arr, gbCol, revCol) {
  return (arr || []).map(function(r) {
    return {
      fecha: String(r.fecha || ''),
      pais:  String(r.pais  || ''),
      gb:  parseFloat(r[gbCol]  || r.gross_bookings || 0) || 0,
      rev: parseFloat(r[revCol] || r.net_revenues   || 0) || 0,
      fvm: parseFloat(r.fvm    || 0) || 0
    };
  });
}

// ---- Row extractors per LOB/view ----

function _wsGetActuals_(lob, view, b2bcRaw, b2bRaw) {
  var rows = [];
  if (lob === 'B2B2C' || lob === 'B2B+B2B2C')
    rows = rows.concat(_wsNormRows_(b2bcRaw.actuals, 'gross_bookings', 'net_revenues'));
  if (lob === 'B2B' || lob === 'B2B+B2B2C')
    rows = rows.concat(_wsNormRows_(_wsExpandCompact_((view==='RI') ? b2bRaw.b2b_ri : b2bRaw.b2b_gd), 'gross_bookings', 'net_revenue'));
  return rows;
}

function _wsGetLY_(lob, view, b2bcRaw, b2bRaw) {
  var rows = [];
  if (lob === 'B2B2C' || lob === 'B2B+B2B2C')
    rows = rows.concat(_wsNormRows_(b2bcRaw.actuals_ly, 'gross_bookings', 'net_revenues'));
  if (lob === 'B2B' || lob === 'B2B+B2B2C')
    rows = rows.concat(_wsNormRows_(_wsExpandCompact_((view==='RI') ? b2bRaw.b2b_ri_ly : b2bRaw.b2b_gd_ly), 'gross_bookings', 'net_revenue'));
  return rows;
}

function _wsGetBudget_(lob, view, b2bcRaw, b2bRaw) {
  var rows = [];
  if (lob === 'B2B2C' || lob === 'B2B+B2B2C')
    rows = rows.concat(_wsNormRows_(_wsExpandCompact_(b2bcRaw.budget), 'gross_bookings', 'net_revenue'));
  if (lob === 'B2B' || lob === 'B2B+B2B2C') {
    var b2bBudKey = (view === 'RI') ? (b2bRaw.b2b_budget_ri || []) : (b2bRaw.b2b_budget_gd || []);
    rows = rows.concat(_wsNormRows_(b2bBudKey, 'gross_bookings', 'net_revenue'));
  }
  return rows;
}

// ---- Aggregations ----

function _wsAggWeekly_(rows) {
  var agg = {};
  rows.forEach(function(r) {
    if (!r.pais || !r.fecha) return;
    var wk = _wsIsoWeek_(r.fecha);
    var y = wk.year, w = wk.week;
    if (!agg[y])          agg[y]          = {};
    if (!agg[y][w])       agg[y][w]       = {};
    if (!agg[y][w][r.pais]) agg[y][w][r.pais] = { gb:0, rev:0, fvm:0 };
    agg[y][w][r.pais].gb  += r.gb;
    agg[y][w][r.pais].rev += r.rev;
    agg[y][w][r.pais].fvm += r.fvm;
  });
  return agg;
}

function _wsAggMonthly_(rows) {
  var agg = {};
  rows.forEach(function(r) {
    if (!r.pais || !r.fecha || r.fecha.length < 7) return;
    var ym = r.fecha.substring(0, 7);
    if (!agg[ym])          agg[ym]          = {};
    if (!agg[ym][r.pais])  agg[ym][r.pais]  = { gb:0, rev:0, fvm:0 };
    agg[ym][r.pais].gb  += r.gb;
    agg[ym][r.pais].rev += r.rev;
    agg[ym][r.pais].fvm += r.fvm;
  });
  return agg;
}

function _wsSumPaises_(data, paises) {
  var t = { gb:0, rev:0, fvm:0 };
  paises.forEach(function(p) { var v = data[p]; if (v) { t.gb+=v.gb; t.rev+=v.rev; t.fvm+=v.fvm; } });
  return t;
}

function _wsGroupVals_(agg, year, week, group) {
  var zero = { gb:0, rev:0, fvm:0 };
  if (!agg[year] || !agg[year][week]) return zero;
  var wd = agg[year][week];
  if (group === 'TOTAL') {
    var t = { gb:0, rev:0, fvm:0 };
    Object.keys(wd).forEach(function(p) { t.gb+=wd[p].gb; t.rev+=wd[p].rev; t.fvm+=wd[p].fvm; });
    return t;
  }
  if (group === 'Brasil') return wd['Brasil'] || zero;
  if (group === 'Mexico') return wd['Mexico'] || zero;
  if (group === 'Hispa')  return _wsSumPaises_(wd, WS_HISPA);
  if (group === 'Globales') {
    var excl = ['Brasil','Mexico'].concat(WS_HISPA);
    var g = { gb:0, rev:0, fvm:0 };
    Object.keys(wd).forEach(function(p) { if (excl.indexOf(p)===-1) { g.gb+=wd[p].gb; g.rev+=wd[p].rev; g.fvm+=wd[p].fvm; } });
    return g;
  }
  return zero;
}

function _wsMonthGroupVals_(agg, ym, group) {
  var zero = { gb:0, rev:0, fvm:0 };
  if (!agg[ym]) return zero;
  var md = agg[ym];
  if (group === 'TOTAL') {
    var t = { gb:0, rev:0, fvm:0 };
    Object.keys(md).forEach(function(p) { t.gb+=md[p].gb; t.rev+=md[p].rev; t.fvm+=md[p].fvm; });
    return t;
  }
  if (group === 'Brasil') return md['Brasil'] || zero;
  if (group === 'Mexico') return md['Mexico'] || zero;
  if (group === 'Hispa')  return _wsSumPaises_(md, WS_HISPA);
  if (group === 'Globales') {
    var excl2 = ['Brasil','Mexico'].concat(WS_HISPA);
    var g2 = { gb:0, rev:0, fvm:0 };
    Object.keys(md).forEach(function(p) { if (excl2.indexOf(p)===-1) { g2.gb+=md[p].gb; g2.rev+=md[p].rev; g2.fvm+=md[p].fvm; } });
    return g2;
  }
  return zero;
}

// ---- Main weekly endpoint ----

function getWeeklySummaryData(params) {
  try {
    var view = (params && params.view) || 'GD';
    var lob  = (params && params.lob)  || 'B2B+B2B2C';

    var b2bcRaw = loadFile_(B2BC_JSON, B2BC_CACHE_KEY);
    var b2bRaw  = loadFile_(B2B_JSON,  B2B_CACHE_KEY);

    var actRows = _wsGetActuals_(lob, view, b2bcRaw, b2bRaw);
    var lyRows  = _wsGetLY_(lob, view, b2bcRaw, b2bRaw);
    var budRows = _wsGetBudget_(lob, view, b2bcRaw, b2bRaw);

    var weekAgg   = _wsAggWeekly_(actRows);
    var lyWeekAgg = _wsAggWeekly_(lyRows);

    var weekKeys = [];
    Object.keys(weekAgg).forEach(function(yr) {
      Object.keys(weekAgg[yr]).forEach(function(wk) { weekKeys.push({ year:+yr, week:+wk }); });
    });
    weekKeys.sort(function(a,b) { return (b.year*100+b.week)-(a.year*100+a.week); });

    // Exclude current (open) week — only show fully closed weeks (Sunday already passed)
    var todayUtc = new Date();
    var todayYmd = todayUtc.getUTCFullYear() + '-' +
      String(todayUtc.getUTCMonth()+1).padStart(2,'0') + '-' +
      String(todayUtc.getUTCDate()).padStart(2,'0');
    var todayIso = _wsIsoWeek_(todayYmd);
    weekKeys = weekKeys.filter(function(w) {
      return w.year < todayIso.year || (w.year === todayIso.year && w.week < todayIso.week);
    });

    var curYear      = weekKeys.length > 0 ? weekKeys[0].year : new Date().getUTCFullYear();
    var curYearWeeks = weekKeys.filter(function(w) { return w.year === curYear; });
    var last5   = curYearWeeks.slice(0, 5).reverse();
    var prevWks = curYearWeeks.slice(1, 5);

    function vsLY_(c, l, f) { return (l[f] && l[f] !== 0) ? (c[f]-l[f])/Math.abs(l[f])*100 : null; }
    function avg_(arr, fn) {
      var vals = arr.map(fn).filter(function(x) { return x !== null; });
      return vals.length ? vals.reduce(function(s,x){return s+x;},0)/vals.length : null;
    }
    function pctL4W_(c, l) { return (l && l !== 0) ? (c-l)/Math.abs(l)*100 : null; }

    var rows = WS_GROUPS.map(function(group) {
      var weeks = last5.map(function(w) {
        var curr = _wsGroupVals_(weekAgg,   w.year,     w.week, group);
        var ly   = _wsGroupVals_(lyWeekAgg, w.year - 1, w.week, group);
        return {
          semana:w.week, anio:w.year,
          gb:  curr.gb/1e6, rev:curr.rev/1e6, fvm:curr.fvm/1e6,
          pctGb: curr.gb ? curr.fvm/curr.gb*100 : 0,
          vsLYgb: vsLY_(curr,ly,'gb'), vsLYrev: vsLY_(curr,ly,'rev')
        };
      });
      var l4wData = prevWks.map(function(w) {
        var v  = _wsGroupVals_(weekAgg,   w.year,     w.week, group);
        var ly = _wsGroupVals_(lyWeekAgg, w.year - 1, w.week, group);
        return { gb:v.gb/1e6, rev:v.rev/1e6, fvm:v.fvm/1e6,
                 pctGb:v.gb?v.fvm/v.gb*100:0, vsLYgb:vsLY_(v,ly,'gb'), vsLYrev:vsLY_(v,ly,'rev') };
      });
      var l4w = {
        gb:    avg_(l4wData, function(d){return d.gb;}),
        rev:   avg_(l4wData, function(d){return d.rev;}),
        fvm:   avg_(l4wData, function(d){return d.fvm;}),
        pctGb: avg_(l4wData, function(d){return d.pctGb;})
      };
      var curr = weeks.length ? weeks[weeks.length-1] : {};
      var vsL4W = {
        gb:    pctL4W_(curr.gb,    l4w.gb),
        rev:   pctL4W_(curr.rev,   l4w.rev),
        fvm:   pctL4W_(curr.fvm,   l4w.fvm),
        pctGb: (l4w.pctGb !== null && curr.pctGb !== null) ? curr.pctGb - l4w.pctGb : null
      };
      return { group:group, flag:WS_FLAGS[group]||'', weeks:weeks, vsL4W:vsL4W };
    });

    var mtdData;
    if (lob === 'B2B+B2B2C') {
      var b2bAct  = _wsNormRows_(_wsExpandCompact_((view==='RI')?b2bRaw.b2b_ri:b2bRaw.b2b_gd),     'gross_bookings','net_revenue');
      var b2bcAct = _wsNormRows_(b2bcRaw.actuals,                                                    'gross_bookings','net_revenues');
      var b2bLY   = _wsNormRows_(_wsExpandCompact_((view==='RI')?b2bRaw.b2b_ri_ly:b2bRaw.b2b_gd_ly),'gross_bookings','net_revenue');
      var b2bcLY  = _wsNormRows_(b2bcRaw.actuals_ly,                                                 'gross_bookings','net_revenues');
      var b2bBud  = _wsNormRows_((view==='RI' ? b2bRaw.b2b_budget_ri : b2bRaw.b2b_budget_gd)||[],        'gross_bookings','net_revenue');
      var b2bcBud = _wsNormRows_(_wsExpandCompact_(b2bcRaw.budget),                                  'gross_bookings','net_revenue');
      mtdData = { split:true,
        b2b2c: _wsComputeMTD_(b2bcAct, b2bcBud, b2bcLY),
        b2b:   _wsComputeMTD_(b2bAct,  b2bBud,  b2bLY) };
    } else {
      mtdData = _wsComputeMTD_(actRows, budRows, lyRows);
    }

    return {
      success:    true,
      view:       view,
      lob:        lob,
      weekLabels: last5.map(function(w) { return String(w.week); }),
      rows:       rows,
      mtd:        mtdData,
      lastSync:   { ts: (b2bcRaw.meta || {}).generated_at || null }
    };
  } catch(e) {
    return { success:false, error:e.message };
  }
}

// ---- MTD computation ----

function _wsComputeMTD_(actRows, budRows, lyRows) {
  var lastYM = '';
  actRows.forEach(function(r) { var ym=r.fecha.substring(0,7); if(ym>lastYM) lastYM=ym; });
  if (!lastYM) return null;

  var lyYM = (parseInt(lastYM.split('-')[0])-1) + '-' + lastYM.split('-')[1];

  var lastActDate = '';
  actRows.forEach(function(r) {
    if (r.fecha.substring(0,7)===lastYM && r.fecha>lastActDate) lastActDate=r.fecha;
  });

  var actAgg   = _wsAggMonthly_(actRows);
  var lastLYDate = lastActDate ? lyYM+'-'+lastActDate.split('-')[2] : '';
  var lyActAgg = _wsAggMonthly_((lyRows||[]).filter(function(r) {
    if (r.fecha.substring(0,7)!==lyYM) return true;
    return lastLYDate ? r.fecha<=lastLYDate : true;
  }));

  var actDays = {};
  actRows.filter(function(r){return r.fecha.substring(0,7)===lastYM;})
         .forEach(function(r){actDays[r.fecha]=true;});

  var budByPais = {};
  (budRows||[]).forEach(function(r) {
    if (!r.pais||r.fecha.substring(0,7)!==lastYM||r.fecha>lastActDate) return;
    if (!budByPais[r.pais]) budByPais[r.pais]={gb:0,rev:0,fvm:0};
    budByPais[r.pais].gb  += r.gb;
    budByPais[r.pais].rev += r.rev;
    budByPais[r.pais].fvm += r.fvm;
  });
  var hasBudget = Object.keys(budByPais).length > 0;

  function getBudGroup_(group) {
    if (!hasBudget) return null;
    var zero = {gb:0,rev:0,fvm:0};
    if (group==='TOTAL') {
      var t={gb:0,rev:0,fvm:0};
      Object.keys(budByPais).forEach(function(p){t.gb+=budByPais[p].gb;t.rev+=budByPais[p].rev;t.fvm+=budByPais[p].fvm;});
      return t;
    }
    if (group==='Brasil') return budByPais['Brasil']||zero;
    if (group==='Mexico') return budByPais['Mexico']||zero;
    if (group==='Hispa') { var h={gb:0,rev:0,fvm:0}; WS_HISPA.forEach(function(p){var v=budByPais[p]||zero;h.gb+=v.gb;h.rev+=v.rev;h.fvm+=v.fvm;}); return h; }
    if (group==='Globales') {
      var excl=['Brasil','Mexico'].concat(WS_HISPA), g={gb:0,rev:0,fvm:0};
      Object.keys(budByPais).forEach(function(p){if(excl.indexOf(p)===-1){g.gb+=budByPais[p].gb;g.rev+=budByPais[p].rev;g.fvm+=budByPais[p].fvm;}});
      return g;
    }
    return null;
  }

  var rows = WS_GROUPS.map(function(group) {
    var act = _wsMonthGroupVals_(actAgg,   lastYM, group);
    var ly  = _wsMonthGroupVals_(lyActAgg, lyYM,   group);
    var bud = getBudGroup_(group);
    function pct_(a,b) { return (b&&b!==0)?(a-b)/Math.abs(b)*100:null; }
    function ach_(a,b) { return (b&&b!==0)?a/b*100:null; }
    return {
      group:group, flag:WS_FLAGS[group]||'',
      gb:  {actual:act.gb/1e6,  budget:bud?bud.gb/1e6:null,  vsLY:pct_(act.gb, ly.gb),  achievement:bud?ach_(act.gb, bud.gb):null},
      rev: {actual:act.rev/1e6, budget:bud?bud.rev/1e6:null, vsLY:pct_(act.rev,ly.rev), achievement:bud?ach_(act.rev,bud.rev):null},
      fvm: {actual:act.fvm/1e6, budget:bud?bud.fvm/1e6:null, vsLY:pct_(act.fvm,ly.fvm), achievement:bud?ach_(act.fvm,bud.fvm):null},
      pctGb:{actual:act.gb?act.fvm/act.gb*100:0, budget:(bud&&bud.gb)?bud.fvm/bud.gb*100:null, vsLY:null, achievement:null}
    };
  });
  return { month:lastYM, daysCount:Object.keys(actDays).length, hasBudget:hasBudget, rows:rows };
}

// ---- Toqan proxy (server-side UrlFetchApp avoids CORS) ----

function _toqanFetch_(endpoint, method, body, agent) {
  var apiKey = (agent === 'bitubicia') ? BITUBICIA_KEY : BITUBEE_KEY;
  var opts = { method: method, headers: { 'X-Api-Key': apiKey }, muteHttpExceptions: true };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  var resp = UrlFetchApp.fetch(TOQAN_BASE + endpoint, opts);
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  if (code < 200 || code >= 300) throw new Error('HTTP ' + code + ': ' + text.slice(0, 200));
  return JSON.parse(text);
}

function wsToqanCreate(params) {
  try {
    var data = _toqanFetch_('/create_conversation', 'post', { user_message: params.user_message }, params.agent);
    if (!data.conversation_id) throw new Error('Sin conversation_id');
    return { success: true, conversation_id: data.conversation_id, request_id: data.request_id };
  } catch(e) { return { success: false, error: e.message }; }
}

function wsToqanContinue(params) {
  try {
    var data = _toqanFetch_('/continue_conversation', 'post',
      { user_message: params.user_message, conversation_id: params.conversation_id }, params.agent);
    if (!data.conversation_id) throw new Error('Sin conversation_id');
    return { success: true, conversation_id: data.conversation_id, request_id: data.request_id };
  } catch(e) { return { success: false, error: e.message }; }
}

function wsToqanPoll(params) {
  try {
    var qs = 'conversation_id=' + encodeURIComponent(params.conversation_id) +
             '&request_id='     + encodeURIComponent(params.request_id);
    var data = _toqanFetch_('/get_answer?' + qs, 'get', null, params.agent);
    return { success: true, status: data.status, answer: data.answer };
  } catch(e) { return { success: false, error: e.message }; }
}

// ---- AI Chat context endpoint ----

function wsGetChatContext(params) {
  try {
    var p  = params || {};
    var dp = p.dashboardParams || {};
    var ctx = (dp.source === 'daily') ? _buildDailyContext_(dp) : _buildWSContext_(dp);
    return {
      success: true,
      context: ctx,
      config: { base: TOQAN_BASE, bitubeeKey: BITUBEE_KEY, bitubiciaKey: BITUBICIA_KEY }
    };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ---- Context builders ----

function _buildWSContext_(params) {
  try {
    var data = getWeeklySummaryData(params);
    if (!data || !data.success) return null;
    return {
      fuente:'weekly', lob:data.lob, view:data.view, semanas:data.weekLabels,
      resumen: data.rows.map(function(r) {
        var last = r.weeks.length ? r.weeks[r.weeks.length-1] : {};
        return { grupo:r.group, ult_sem:{sem:last.semana,gb:last.gb,rev:last.rev,fvm:last.fvm},
                 vs_l4w:r.vsL4W, vs_ly_gb:last.vsLYgb, vs_ly_rev:last.vsLYrev };
      }),
      mtd: data.mtd ? {
        mes:data.mtd.month, dias:data.mtd.daysCount,
        grupos: (data.mtd.rows||[]).map(function(r){return{grupo:r.group,gb:r.gb,rev:r.rev,fvm:r.fvm};})
      } : null
    };
  } catch(e) { return null; }
}

function _buildDailyContext_(dp) {
  try {
    var lob      = dp.lob      || 'b2bc';
    var viewDate = dp.viewDate || null;
    var dm       = dp.dateModel || 'gd';
    if (!viewDate) return null;

    var mStart = viewDate.substring(0,7)+'-01';
    var lyY    = String(parseInt(viewDate.substring(0,4))-1);
    var lyVD   = lyY+viewDate.substring(4);
    var lyMS   = lyY+'-'+viewDate.substring(5,7)+'-01';

    function sumRange_(arr, from, to, gbF, revF) {
      var t={gb:0,rev:0,fvm:0};
      arr.forEach(function(r) {
        if (r.fecha<from||r.fecha>to) return;
        t.gb  += parseFloat(r[gbF]  || r.gross_bookings || 0)||0;
        t.rev += parseFloat(r[revF] || r.net_revenues   || 0)||0;
        t.fvm += parseFloat(r.fvm   || 0)||0;
      });
      return t;
    }

    if (lob === 'b2bc') {
      var raw  = loadFile_(B2BC_JSON, B2BC_CACHE_KEY);
      var bud  = _wsExpandCompact_(raw.budget);
      var act  = sumRange_(raw.actuals,    mStart,viewDate,'gross_bookings','net_revenues');
      var ly   = sumRange_(raw.actuals_ly, lyMS,  lyVD,   'gross_bookings','net_revenues');
      var bdg  = sumRange_(bud,            mStart,viewDate,'gross_bookings','net_revenue');
      var pm={};
      raw.actuals.forEach(function(r){if(r.fecha<mStart||r.fecha>viewDate)return;pm[r.pais]=(pm[r.pais]||0)+(r.net_revenues||0);});
      var topP=Object.keys(pm).sort(function(a,b){return pm[b]-pm[a];}).slice(0,5).map(function(p){return{pais:p,nr:pm[p]};});
      return { fuente:'daily', lob:'B2B2C', fecha:viewDate,
               mtd_gb:{actual:act.gb,ly:ly.gb,budget:bdg.gb}, mtd_rev:{actual:act.rev,ly:ly.rev,budget:bdg.rev},
               mtd_fvm:{actual:act.fvm,ly:ly.fvm,budget:bdg.fvm}, top_paises:topP,
               generado:raw.meta.generated_at, datos_al:raw.meta.last_actuals_date };
    } else {
      var rawB  = loadFile_(B2B_JSON, B2B_CACHE_KEY);
      var src   = _wsExpandCompact_((dm==='ri') ? rawB.b2b_ri    : rawB.b2b_gd);
      var srcLY = _wsExpandCompact_((dm==='ri') ? rawB.b2b_ri_ly : rawB.b2b_gd_ly);
      var bud2  = (dm==='ri' ? rawB.b2b_budget_ri : rawB.b2b_budget_gd) || [];
      var act2  = sumRange_(src,   mStart,viewDate,'gross_bookings','net_revenue');
      var ly2   = sumRange_(srcLY, lyMS,  lyVD,   'gross_bookings','net_revenue');
      var bdg2  = sumRange_(bud2,  mStart,viewDate,'gross_bookings','net_revenue');
      var pm2={};
      src.forEach(function(r){if(r.fecha<mStart||r.fecha>viewDate)return;pm2[r.pais]=(pm2[r.pais]||0)+(r.net_revenue||0);});
      var topP2=Object.keys(pm2).sort(function(a,b){return pm2[b]-pm2[a];}).slice(0,5).map(function(p){return{pais:p,nr:pm2[p]};});
      return { fuente:'daily', lob:'B2B', fecha:viewDate, date_model:dm,
               mtd_gb:{actual:act2.gb,ly:ly2.gb,budget:bdg2.gb}, mtd_rev:{actual:act2.rev,ly:ly2.rev,budget:bdg2.rev},
               mtd_fvm:{actual:act2.fvm,ly:ly2.fvm,budget:bdg2.fvm}, top_paises:topP2,
               generado:rawB.meta.generated_at, datos_al:rawB.meta.last_actuals_date };
    }
  } catch(e) { return null; }
}

// ============================================================
// Daily Email
// ============================================================

var EMAIL_TO = ['gregorio.minetti@despegar.com', 'diego.bracco@despegar.com', 'tiago.harari@despegar.com', 'matias.m.sanchez@despegar.com'];

function sendDailyEmail()          { sendDailyEmail_(); }
function sendDailyEmailTo(emails)  { sendDailyEmail_(emails); }
function sendDailyEmail_(customRecipients) {
  var dow = new Date().getDay(); // 0=Dom, 6=Sab
  if (dow === 0 || dow === 6) return;

  var b2bcRaw = loadFile_(B2BC_JSON, B2BC_CACHE_KEY);
  var b2bRaw  = loadFile_(B2B_JSON,  B2B_CACHE_KEY);

  // budget viene en formato compacto — expandir
  b2bcRaw.budget = _wsExpandCompact_(b2bcRaw.budget);

  var vDate = (b2bcRaw.meta || {}).last_actuals_date;
  if (!vDate) return;

  var pp     = vDate.split('-');
  var mStart = pp[0] + '-' + pp[1] + '-01';
  var lyY    = String(+pp[0] - 1);
  var lyVD   = lyY + '-' + pp[1] + '-' + pp[2];
  var lyMS   = lyY + '-' + pp[1] + '-01';

  var krsB2BC = _emailKRsB2BC_(b2bcRaw, mStart, vDate);
  var mtdB2BC = _emailMTDB2BC_(b2bcRaw, mStart, vDate, lyMS, lyVD);
  var krsB2B  = _emailKRsB2B_(b2bRaw,  mStart, vDate);
  var mtdB2B  = _emailMTDB2B_(b2bRaw,  mStart, vDate, lyMS, lyVD);

  var html    = _emailHtml_(vDate, krsB2BC, mtdB2BC, krsB2B, mtdB2B);
  var subject = 'Planning B2B & B2B2C Daily Dashboard · ' + _eFmtDate_(vDate);
  var to = (customRecipients && customRecipients.length) ? customRecipients : EMAIL_TO;

  MailApp.sendEmail({ to: to.join(','), subject: subject, htmlBody: html });
}

// ── Helpers numéricos ────────────────────────────────────────────

function _eIsCore_(p) { return p==='Brasil'||p==='Mexico'||p==='Other Countries'; }
function _eRegion_(p) { if(p==='Brasil')return 'BR'; if(p==='Mexico')return 'NAM'; return 'SAH'; }

function _eSum_(arr, from, to, field) {
  var t = 0;
  arr.forEach(function(r) { if(r.fecha>=from&&r.fecha<=to) t+=(+r[field]||0); });
  return t;
}

function _eFmtDate_(d) {
  if (!d) return '';
  var p = d.split('-');
  var m = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return p[2]+' '+m[+p[1]-1]+' '+p[0];
}

function _eFmtM_(v) {
  if (v===null||v===undefined) return '—';
  var s=v<0?'-':'', a=Math.abs(v);
  if (a>=1e6) return s+'$'+(a/1e6).toFixed(1)+'M';
  if (a>=1e3) return s+'$'+Math.round(a/1e3)+'K';
  return s+'$'+Math.round(a);
}

function _eFmtPct_(v, ref) {
  if (!ref || ref===0) return '—';
  var p=(v-ref)/Math.abs(ref)*100;
  return (p>=0?'+':'')+p.toFixed(1)+'%';
}

function _eAch_(act, bud) {
  if (!bud||bud===0) return '—';
  return Math.round(act/bud*100)+'%';
}

function _eAchColor_(act, bud) {
  if (!bud||bud===0) return '#6b7280';
  var p=act/bud*100;
  if (p>=100) return '#16a34a';
  if (p>=80)  return '#d97706';
  return '#dc2626';
}

function _eVsLYColor_(v, ref) {
  if (!ref||ref===0) return '#6b7280';
  return (v>=ref) ? '#16a34a' : '#dc2626';
}

// ── Cómputos ─────────────────────────────────────────────────────

function _emailKRsB2BC_(raw, mStart, vDate) {
  var REGS=['BR','SAH','NAM'];
  function mk(){var o={};REGS.forEach(function(r){o[r]={act:0,bud:0};});return o;}
  var kr2={act:0,bud:0,r:mk()},kr3={act:0,bud:0,r:mk()},kr4={act:0,bud:0,r:mk()};
  raw.actuals.forEach(function(r){
    if(r.fecha<mStart||r.fecha>vDate)return;
    var at=r.partner==='livelo-api-hoteles'?'New':r.account_type;
    var rg=_eRegion_(r.pais), nr=+r.net_revenues||0, fv=+r.fvm||0;
    if(at==='New')     {kr2.act+=nr;kr2.r[rg].act+=nr;}
    else if(at==='Existing'){kr3.act+=nr;kr3.r[rg].act+=nr;}
    kr4.act+=fv;kr4.r[rg].act+=fv;
  });
  raw.budget.forEach(function(r){
    if(r.fecha<mStart||r.fecha>vDate)return;
    var st=r.stage||'Existing', rg=_eRegion_(r.pais);
    var nr=+r.net_revenue||0, fv=+r.fvm||0;
    if(st==='New')  {kr2.bud+=nr;kr2.r[rg].bud+=nr;}
    else            {kr3.bud+=nr;kr3.r[rg].bud+=nr;}
    kr4.bud+=fv;kr4.r[rg].bud+=fv;
  });
  return {kr2:kr2,kr3:kr3,kr4:kr4};
}

function _emailMTDB2BC_(raw, mStart, vDate, lyMS, lyVD) {
  var act=raw.actuals, ly=raw.actuals_ly, bud=raw.budget;
  return {
    gb:  {mtd:_eSum_(act,mStart,vDate,'gross_bookings'), ly:_eSum_(ly,lyMS,lyVD,'gross_bookings'), bud:_eSum_(bud,mStart,vDate,'gross_bookings')},
    nr:  {mtd:_eSum_(act,mStart,vDate,'net_revenues'),   ly:_eSum_(ly,lyMS,lyVD,'net_revenues'),   bud:_eSum_(bud,mStart,vDate,'net_revenue')},
    fvm: {mtd:_eSum_(act,mStart,vDate,'fvm'),            ly:_eSum_(ly,lyMS,lyVD,'fvm'),            bud:_eSum_(bud,mStart,vDate,'fvm')}
  };
}

function _emailKRsB2B_(raw, mStart, vDate) {
  var src=_wsExpandCompact_(raw.b2b_ri), bud=raw.b2b_budget_ri||[];
  var kr2={act:0,bud:0},kr3={act:0,bud:0};
  src.forEach(function(r){
    if(r.fecha<mStart||r.fecha>vDate)return;
    if(_eIsCore_(r.pais))kr2.act+=(+r.net_revenue||0);
    else                  kr3.act+=(+r.net_revenue||0);
  });
  bud.forEach(function(r){
    if(r.fecha<mStart||r.fecha>vDate)return;
    if(_eIsCore_(r.pais))kr2.bud+=(+r.net_revenue||0);
    else                  kr3.bud+=(+r.net_revenue||0);
  });
  return {kr2:kr2,kr3:kr3};
}

function _emailMTDB2B_(raw, mStart, vDate, lyMS, lyVD) {
  var src=_wsExpandCompact_(raw.b2b_ri), srcLY=_wsExpandCompact_(raw.b2b_ri_ly), bud=raw.b2b_budget_ri||[];
  return {
    gb:  {mtd:_eSum_(src,mStart,vDate,'gross_bookings'), ly:_eSum_(srcLY,lyMS,lyVD,'gross_bookings'), bud:_eSum_(bud,mStart,vDate,'gross_bookings')},
    nr:  {mtd:_eSum_(src,mStart,vDate,'net_revenue'),    ly:_eSum_(srcLY,lyMS,lyVD,'net_revenue'),    bud:_eSum_(bud,mStart,vDate,'net_revenue')},
    fvm: {mtd:_eSum_(src,mStart,vDate,'fvm'),            ly:_eSum_(srcLY,lyMS,lyVD,'fvm'),            bud:_eSum_(bud,mStart,vDate,'fvm')}
  };
}

// ── HTML ─────────────────────────────────────────────────────────

function _emailHtml_(vDate, kb, mb, k2, m2) {
  var DASHBOARD_URL = 'https://script.google.com/macros/s/AKfycbwUC8oHHFuFQA8ZnVsLS8zwxgwJavQMpWWg_QJeo-Dg19jLtlZn5teQj8gSHrVn2CVOvw/exec';

  function ach(act, bud) { return bud>0 ? Math.round(act/bud*100)+'%' : '—'; }
  function col(act, bud) {
    if (!bud||bud===0) return '#6b7280';
    var p=act/bud*100; return p>=100?'#16a34a':p>=80?'#d97706':'#dc2626';
  }

  // Una fila de cards con % achievement — admite 2 o 3 cards
  function krRow(cards) {
    var w = Math.floor(100/cards.length);
    var html = '<table width="100%" cellpadding="0" cellspacing="8" style="border-collapse:separate;margin-bottom:16px;"><tr>';
    cards.forEach(function(c) {
      var p = ach(c.kr.act, c.kr.bud);
      var cl = col(c.kr.act, c.kr.bud);
      html += '<td width="'+w+'%" style="background:#f8fafc;border:1px solid #e2e8f0;'
        +'border-top:3px solid '+c.color+';border-radius:8px;padding:14px 12px;text-align:center;">'
        +'<div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;'
        +'letter-spacing:.4px;margin-bottom:6px;">'+c.lbl+'</div>'
        +'<div style="font-size:30px;font-weight:800;color:'+cl+';">'+p+'</div>'
        +'</td>';
    });
    return html + '</tr></table>';
  }

  // Fila compacta NR / FVM / GB — nominal grande + vs Bdg % + vs LY %
  function mtdRow(mtd) {
    var items=[{lbl:'NR',m:mtd.nr},{lbl:'FVM',m:mtd.fvm},{lbl:'GB',m:mtd.gb}];
    var html='<table width="100%" cellpadding="0" cellspacing="8" style="border-collapse:separate;margin-bottom:24px;"><tr>';
    items.forEach(function(it){
      var pBdg=ach(it.m.mtd,it.m.bud), clBdg=col(it.m.mtd,it.m.bud);
      var pLY=_eFmtPct_(it.m.mtd,it.m.ly);
      var clLY=_eVsLYColor_(it.m.mtd,it.m.ly);
      html+='<td width="33%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;'
        +'padding:12px;text-align:center;">'
        +'<div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;'
        +'letter-spacing:.4px;margin-bottom:6px;">'+it.lbl+'</div>'
        +'<div style="font-size:22px;font-weight:800;color:#1e293b;margin-bottom:8px;">'+_eFmtM_(it.m.mtd)+'</div>'
        +'<table width="100%" cellpadding="0" cellspacing="0"><tr>'
        +'<td width="50%" style="text-align:center;border-right:1px solid #e2e8f0;padding:0 4px;">'
        +'<div style="font-size:9px;color:#94a3b8;margin-bottom:2px;">vs Bdg</div>'
        +'<div style="font-size:13px;font-weight:700;color:'+clBdg+';">'+pBdg+'</div>'
        +'</td>'
        +'<td width="50%" style="text-align:center;padding:0 4px;">'
        +'<div style="font-size:9px;color:#94a3b8;margin-bottom:2px;">vs LY</div>'
        +'<div style="font-size:13px;font-weight:700;color:'+clLY+';">'+pLY+'</div>'
        +'</td>'
        +'</tr></table>'
        +'</td>';
    });
    return html+'</tr></table>';
  }

  function sectionTitle(txt) {
    return '<div style="font-size:11px;font-weight:800;color:#5626e9;text-transform:uppercase;'
      +'letter-spacing:.7px;border-bottom:2px solid #5626e9;padding-bottom:5px;margin:20px 0 12px;">'+txt+'</div>';
  }

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
    +'<body style="margin:0;padding:16px;background:#f1f5f9;">'
    +'<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;margin:0 auto;">'

    // ── Header ──
    +'<tr><td style="background:#1e293b;border-radius:10px 10px 0 0;padding:22px 28px;">'
    +'<div style="font-size:16px;font-weight:800;color:#fff;">Planning B2B &amp; B2B2C Daily Dashboard</div>'
    +'<div style="font-size:12px;color:#94a3b8;margin-top:3px;">'+_eFmtDate_(vDate)+'</div>'
    +'</td></tr>'

    // ── Body ──
    +'<tr><td style="background:#fff;border-radius:0 0 10px 10px;padding:20px 28px 24px;">'

    // B2B2C
    +sectionTitle('B2B2C')
    +krRow([
      {lbl:'KR2 · Hunting NR', kr:kb.kr2, color:'#5626e9'},
      {lbl:'KR3 · Farming NR', kr:kb.kr3, color:'#2563eb'},
      {lbl:'KR4 · FVM Total',  kr:kb.kr4, color:'#0891b2'}
    ])
    +mtdRow(mb)

    // B2B
    +sectionTitle('B2B · RI')
    +krRow([
      {lbl:'KR2 · Core Markets NR', kr:k2.kr2, color:'#059669'},
      {lbl:'KR3 · New Markets NR',  kr:k2.kr3, color:'#d97706'}
    ])
    +mtdRow(m2)

    // Link
    +'<div style="text-align:center;margin-top:8px;">'
    +'<a href="'+DASHBOARD_URL+'" style="display:inline-block;background:#5626e9;color:#fff;'
    +'font-size:13px;font-weight:700;padding:10px 28px;border-radius:8px;text-decoration:none;">'
    +'Ver tablero completo</a>'
    +'</div>'

    +'<div style="margin-top:20px;font-size:10px;color:#94a3b8;text-align:center;">'
    +'Generado automáticamente · Despegar Planning</div>'

    +'</td></tr></table></body></html>';

  return html;
}

// ── Scheduled trigger (corre desde GAS, lunes a viernes ~9am BsAs) ──────────

function scheduledEmailSend() {
  // Verificar que sea día laboral
  var dow = new Date().getDay();
  if (dow === 0 || dow === 6) return;

  // Verificar que los datos sean de ayer
  try {
    var meta = loadFile_(B2BC_JSON, B2BC_CACHE_KEY).meta || {};
    var lastDate = meta.last_actuals_date || '';
    var tz = Session.getScriptTimeZone();
    var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var yesterday = Utilities.formatDate(new Date(new Date().getTime() - 86400000), tz, 'yyyy-MM-dd');
    if (lastDate !== yesterday) {
      Logger.log('scheduledEmailSend: datos no actualizados aún (last=' + lastDate + ', yesterday=' + yesterday + '). No se envía.');
      return;
    }
  } catch(e) {
    Logger.log('scheduledEmailSend: error verificando fecha — ' + e.message);
    return;
  }

  sendDailyEmail_();
  Logger.log('scheduledEmailSend: email enviado.');
}

// Correr esta función UNA VEZ desde el editor de GAS para crear el trigger diario.
function setupEmailTrigger() {
  // Eliminar triggers previos de scheduledEmailSend para evitar duplicados
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'scheduledEmailSend') ScriptApp.deleteTrigger(t);
  });
  // Crear trigger: lunes a viernes a las 9:00-10:00am hora Argentina
  ScriptApp.newTrigger('scheduledEmailSend')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .inTimezone('America/Argentina/Buenos_Aires')
    .create();
  Logger.log('Trigger creado: scheduledEmailSend corre diariamente a las 9am BsAs.');
}

// ============================================================
// OKR Weekly B2B2C
// ============================================================

var _OKR_HISPA_PAISES_ = ['Argentina','Colombia','Chile','Peru','Ecuador'];
var _OKR_MES_LABELS_   = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
var _OKR_REGIONS_      = ['BR','MX/US','HISPA'];

function _okrPaisToRegion_(pais) {
  if (pais === 'Brasil') return 'BR';
  if (pais === 'Mexico') return 'MX/US';
  if (_OKR_HISPA_PAISES_.indexOf(pais) !== -1) return 'HISPA';
  return 'Globales';
}

function _okrWeekMonday_(year, week) {
  var jan4    = new Date(Date.UTC(year, 0, 4));
  var jan4Day = jan4.getUTCDay() || 7;
  var w1Mon   = new Date(jan4.getTime() - (jan4Day - 1) * 86400000);
  return new Date(w1Mon.getTime() + (week - 1) * 7 * 86400000);
}

function _okrDateRange_(mon, sun) {
  return mon.getUTCDate() + '/' + _OKR_MES_LABELS_[mon.getUTCMonth()]
       + '–' + sun.getUTCDate() + '/' + _OKR_MES_LABELS_[sun.getUTCMonth()];
}

function _okrInitSlot_() {
  var slot = { existing:{nr:0,fvm:0}, new:{nr:0,fvm:0}, total:{nr:0,fvm:0}, regions:{} };
  _OKR_REGIONS_.forEach(function(r) {
    slot.regions[r] = { existing:{nr:0,fvm:0}, new:{nr:0,fvm:0}, total:{nr:0,fvm:0} };
  });
  return slot;
}

function _okrDivSlot_(slot, divisor) {
  var d = divisor || 1;
  ['existing','new','total'].forEach(function(k) { slot[k].nr/=d; slot[k].fvm/=d; });
  _OKR_REGIONS_.forEach(function(r) {
    ['existing','new','total'].forEach(function(k) {
      slot.regions[r][k].nr/=d; slot.regions[r][k].fvm/=d;
    });
  });
}

function getOKRWeeklyB2B2C() {
  try {
    var raw = loadFile_(B2BC_JSON, B2BC_CACHE_KEY);

    var now      = new Date();
    var todayYmd = now.getUTCFullYear() + '-' +
      String(now.getUTCMonth()+1).padStart(2,'0') + '-' +
      String(now.getUTCDate()).padStart(2,'0');
    var todayIso = _wsIsoWeek_(todayYmd);
    var currMon  = _okrWeekMonday_(todayIso.year, todayIso.week);

    // Last 3 closed weeks (i=3,2,1 → oldest→newest)
    var actualWeeks = [];
    for (var i = 3; i >= 1; i--) {
      var mon = new Date(currMon.getTime() - i * 7 * 86400000);
      var sun = new Date(mon.getTime() + 6 * 86400000);
      var monYmd = mon.getUTCFullYear() + '-' +
        String(mon.getUTCMonth()+1).padStart(2,'0') + '-' +
        String(mon.getUTCDate()).padStart(2,'0');
      var iso = _wsIsoWeek_(monYmd);
      actualWeeks.push({ year:iso.year, week:iso.week, label:'W'+iso.week,
                         dateRange:_okrDateRange_(mon,sun) });
    }

    // Current + next 2 projected weeks
    var projWeeks = [];
    for (var j = 0; j <= 2; j++) {
      var pMon = new Date(currMon.getTime() + j * 7 * 86400000);
      var pSun = new Date(pMon.getTime() + 6 * 86400000);
      var pMonYmd = pMon.getUTCFullYear() + '-' +
        String(pMon.getUTCMonth()+1).padStart(2,'0') + '-' +
        String(pMon.getUTCDate()).padStart(2,'0');
      var pIso = _wsIsoWeek_(pMonYmd);
      var pYm  = pMon.getUTCFullYear() + '-' + String(pMon.getUTCMonth()+1).padStart(2,'0');
      projWeeks.push({ year:pIso.year, week:pIso.week, label:'W'+pIso.week+'★',
                       dateRange:_okrDateRange_(pMon,pSun), ym:pYm });
    }

    // Aggregate actuals by ISO week × account_type × region
    var actualWeekData = {};
    raw.actuals.forEach(function(r) {
      if (!r.fecha || !r.account_type || r.account_type === 'Unknown') return;
      var iso  = _wsIsoWeek_(r.fecha);
      var key  = iso.year + '-' + iso.week;
      if (!actualWeekData[key]) actualWeekData[key] = _okrInitSlot_();
      var slot  = actualWeekData[key];
      var nr    = parseFloat(r.net_revenues) || 0;
      var fv    = parseFloat(r.fvm) || 0;
      var atKey = r.account_type === 'Existing' ? 'existing' : 'new';
      var reg   = r.region;
      slot[atKey].nr += nr;  slot[atKey].fvm += fv;
      slot.total.nr  += nr;  slot.total.fvm  += fv;
      if (_OKR_REGIONS_.indexOf(reg) !== -1) {
        slot.regions[reg][atKey].nr  += nr;  slot.regions[reg][atKey].fvm  += fv;
        slot.regions[reg].total.nr   += nr;  slot.regions[reg].total.fvm   += fv;
      }
    });
    Object.keys(actualWeekData).forEach(function(k) { _okrDivSlot_(actualWeekData[k], 1e6); });

    // Aggregate runrate by month × stage × region
    var rrRows      = _wsExpandCompact_(raw.runrate);
    var rrMonthData = {};
    rrRows.forEach(function(r) {
      if (!r.fecha || r.fecha.length < 7) return;
      var ym = r.fecha.substring(0,7);
      if (!rrMonthData[ym]) rrMonthData[ym] = _okrInitSlot_();
      var slot  = rrMonthData[ym];
      var nr    = parseFloat(r.net_revenue) || 0;
      var fv    = parseFloat(r.fvm) || 0;
      var stKey = (r.stage === 'Existing') ? 'existing' : 'new';
      var reg   = _okrPaisToRegion_(r.pais);
      slot[stKey].nr += nr;  slot[stKey].fvm += fv;
      slot.total.nr  += nr;  slot.total.fvm  += fv;
      if (_OKR_REGIONS_.indexOf(reg) !== -1) {
        slot.regions[reg][stKey].nr  += nr;  slot.regions[reg][stKey].fvm  += fv;
        slot.regions[reg].total.nr   += nr;  slot.regions[reg].total.fvm   += fv;
      }
    });
    Object.keys(rrMonthData).forEach(function(ym) { _okrDivSlot_(rrMonthData[ym], 1e6); });

    // MTD
    var lastActDate = '';
    raw.actuals.forEach(function(r) { if (r.fecha > lastActDate) lastActDate = r.fecha; });
    var mtdYm = lastActDate ? lastActDate.substring(0,7) : '';

    var mtdActuals = _okrInitSlot_();
    raw.actuals.forEach(function(r) {
      if (!r.fecha || r.fecha.substring(0,7) !== mtdYm) return;
      if (!r.account_type || r.account_type === 'Unknown') return;
      var nr    = parseFloat(r.net_revenues) || 0;
      var fv    = parseFloat(r.fvm) || 0;
      var atKey = r.account_type === 'Existing' ? 'existing' : 'new';
      var reg   = r.region;
      mtdActuals[atKey].nr += nr;  mtdActuals[atKey].fvm += fv;
      mtdActuals.total.nr  += nr;  mtdActuals.total.fvm  += fv;
      if (_OKR_REGIONS_.indexOf(reg) !== -1) {
        mtdActuals.regions[reg][atKey].nr  += nr;  mtdActuals.regions[reg][atKey].fvm  += fv;
        mtdActuals.regions[reg].total.nr   += nr;  mtdActuals.regions[reg].total.fvm   += fv;
      }
    });
    _okrDivSlot_(mtdActuals, 1e6);

    var budRows   = _wsExpandCompact_(raw.budget);
    var mtdBudget = _okrInitSlot_();
    budRows.forEach(function(r) {
      if (!r.fecha || r.fecha.substring(0,7) !== mtdYm || r.fecha > lastActDate) return;
      var nr    = parseFloat(r.net_revenue) || 0;
      var fv    = parseFloat(r.fvm) || 0;
      var stKey = (r.stage === 'Existing') ? 'existing' : 'new';
      var reg   = _okrPaisToRegion_(r.pais);
      mtdBudget[stKey].nr += nr;  mtdBudget[stKey].fvm += fv;
      mtdBudget.total.nr  += nr;  mtdBudget.total.fvm  += fv;
      if (_OKR_REGIONS_.indexOf(reg) !== -1) {
        mtdBudget.regions[reg][stKey].nr  += nr;  mtdBudget.regions[reg][stKey].fvm  += fv;
        mtdBudget.regions[reg].total.nr   += nr;  mtdBudget.regions[reg].total.fvm   += fv;
      }
    });
    _okrDivSlot_(mtdBudget, 1e6);

    return {
      success:             true,
      actualWeeks:         actualWeeks,
      projWeeks:           projWeeks,
      actualWeekData:      actualWeekData,
      rrMonthData:         rrMonthData,
      mtd:                 { ym:mtdYm, actuals:mtdActuals, budget:mtdBudget },
      signNewPartnerships: { actuals:5, budget:7 }
    };
  } catch(e) {
    return { success:false, error:e.message };
  }
}
 