// Solo Ownia: se carga en el proyecto del Daily (gasExtras en server/modules.js), después de su código.
// Weekly: agrega el "% vs LY" del FVM por semana (w.vsLYfvm), que el Daily de Apps Script no calcula (solo
// GB y Rev). Misma regla que vsLYgb / vsLYrev de _wsSummary_: mismas filas (lob, vista GD / RI, canal B2B,
// COI Brasil) y, con Organic, el real a TC Actuals LY ("opción B") contra el LY nominal. Lo muestra la solapa
// Weekly y sus slides del Flow (public/daily-ceo-weekly.js).
var _wsFvmOrigGet_ = getWeeklySummaryData;

function _wsFvmYoY_(params, conv) {
  var view = (params && params.view) || 'GD';
  var lob = (params && params.lob) || 'B2B+B2B2C';
  var channel = (lob === 'B2B' && params && params.channel) || '';
  var b2bcRaw = loadFileShared_(B2BC_JSON, B2BC_CACHE_KEY);
  var b2bRaw = loadFileShared_(B2B_JSON, B2B_CACHE_KEY);
  return {
    act: _wsAggWeekly_(_wsOrg_(_wsByChannel_(_wsGetActuals_(lob, view, b2bcRaw, b2bRaw), channel), conv)),
    ly: _wsAggWeekly_(_wsByChannel_(_wsGetLY_(lob, view, b2bcRaw, b2bRaw), channel))
  };
}

getWeeklySummaryData = function (params) {
  var res = _wsFvmOrigGet_(params);
  if (!res || !res.success || !res.rows) return res;
  try {
    _wsSetExCoiBr_(params);
    var target = organicTarget_(params && params.organic), conv = null;
    if (target && !(res.organic && res.organic.error)) conv = organicConverter_('ly');   // YoY a TC Actuals LY
    var A = _wsFvmYoY_(params, conv);
    res.rows.forEach(function (row) {
      row.weeks.forEach(function (w) {
        var c = _wsGroupVals_(A.act, w.anio, w.semana, row.group), l = _wsGroupVals_(A.ly, w.anio - 1, w.semana, row.group);
        w.vsLYfvm = (l.fvm && l.fvm !== 0) ? (c.fvm - l.fvm) / Math.abs(l.fvm) * 100 : null;
      });
    });
  } catch (e) { Logger.log('weekly vsLYfvm: ' + e); }
  return res;
};
