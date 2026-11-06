// Solo Ownia: se carga en el proyecto del Daily (gasExtras en server/modules.js), después de su código.
// "Resumen semanal" (2026-11-02, Tiago): la última semana cerrada (ISO, lunes a domingo) de B2B2C, B2B API y
// B2B HTML, por país, contra Budget, LY, Run Rate y el promedio de las 4 semanas anteriores (L4W). La página es
// server/resumen-semanal-page.js (botón de la portada, al lado de "Actualizar reales"); los textos y totales los
// arma el navegador con estos montos.
//
// Mismas filas y reglas que el Weekly del Daily (getWeeklySummaryData): fecha de gestión (GD), B2B por
// parent_channel ('API' | 'Agencias afiliadas' = HTML), LY = misma semana ISO del año anterior, COI Brasil con el
// switch del Daily (params.exCoiBr; por defecto Incluir, como abre el Daily). Sin Organic: montos nominales en USD.
// El Run Rate es el mismo que lee el Daily (b2bcRaw.runrate y b2bRaw.b2b_runrate_gd).
// Desde 2026-11-06 se puede pedir una de las últimas 8 semanas cerradas (params.year, params.week); sin eso, la última.

var RS_WEEKS_ = 13;   // semanas de la serie (la última + 12 anteriores)
var RS_PICK_ = 8;     // semanas cerradas que se pueden elegir en la página (la última + 7 anteriores), 2026-11-06
var RS_STREAK_ = 4;   // semanas por país (la elegida + 3 anteriores) de NR vs Budget, para ver si un desvío se repite

function _rsRunRate_(lob, b2bcRaw, b2bRaw) {
  if (lob === 'B2B2C') return _wsNorm_(b2bcRaw.runrate, true, 'gross_bookings', 'net_revenue');
  return _wsNorm_(b2bRaw.b2b_runrate_gd || [], false, 'gross_bookings', 'net_revenue');
}

function _rsKey_(y, w) { return y * 100 + w; }

// Semana ISO anterior a (y, w), n veces
function _rsPrev_(y, w, n) {
  var j4 = new Date(Date.UTC(y, 0, 4)), dj4 = j4.getUTCDay() || 7;
  var mon = new Date(Date.UTC(y, 0, 4 - dj4 + 1 + (w - 1) * 7 - 7 * n));
  var ymd = mon.toISOString().substring(0, 10), k = _wsIsoWeekCalc_(ymd);
  return { year: k.year, week: k.week, from: ymd };
}

function _rsSum_(byPais) {
  var t = { gb: 0, rev: 0, fvm: 0 };
  Object.keys(byPais || {}).forEach(function (p) { t.gb += byPais[p].gb; t.rev += byPais[p].rev; t.fvm += byPais[p].fvm; });
  return t;
}

function _rsRound_(o) {
  var r = {};
  Object.keys(o).forEach(function (p) {
    r[p] = { gb: Math.round(o[p].gb), rev: Math.round(o[p].rev), fvm: Math.round(o[p].fvm) };
  });
  return r;
}

function getResumenSemanal(params) {
  try {
    _wsSetExCoiBr_(params);
    var view = 'GD';
    var b2bcRaw = loadFileShared_(B2BC_JSON, B2BC_CACHE_KEY);
    var b2bRaw = loadFileShared_(B2B_JSON, B2B_CACHE_KEY);
    var BIZ = [
      { k: 'b2b2c', lob: 'B2B2C', ch: '' },
      { k: 'api', lob: 'B2B', ch: 'API' },
      { k: 'html', lob: 'B2B', ch: 'Agencias afiliadas' },
    ];

    // Último día con reales: el menor de los dos JSON (la semana tiene que estar cerrada en los dos negocios)
    var lastDay = '';
    [b2bcRaw, b2bRaw].forEach(function (raw) {
      var d = (raw.meta || {}).last_actuals_date || '';
      if (d && (!lastDay || d < lastDay)) lastDay = d;
    });
    if (!lastDay) return { success: false, error: 'El Daily no tiene fecha de reales (meta.last_actuals_date).' };
    // Última semana completa (termina en domingo) con datos hasta lastDay
    var p = lastDay.split('-'), sun = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])), dow = sun.getUTCDay();
    if (dow !== 0) sun.setUTCDate(sun.getUTCDate() - dow);
    var latest = _wsIsoWeekCalc_(sun.toISOString().substring(0, 10));
    // Semana elegida (params.year / params.week, 2026-11-06): una de las RS_PICK_ últimas cerradas; si no, la última
    var pick = [];
    for (var q = 0; q < RS_PICK_; q++) pick.push(_rsPrev_(latest.year, latest.week, q));
    var want = (params && params.week) ? _rsKey_(+params.year || latest.year, +params.week) : 0;
    var cur = pick.filter(function (w) { return _rsKey_(w.year, w.week) === want; })[0] || latest;
    var weeks = [];
    for (var i = RS_WEEKS_ - 1; i >= 0; i--) weeks.push(_rsPrev_(cur.year, cur.week, i));
    var last = weeks[weeks.length - 1];
    var to = new Date(Date.UTC(+last.from.substring(0, 4), +last.from.substring(5, 7) - 1, +last.from.substring(8, 10) + 6));

    var biz = {};
    BIZ.forEach(function (b) {
      var A = _wsAggWeekly_(_wsByChannel_(_wsGetActuals_(b.lob, view, b2bcRaw, b2bRaw), b.ch));
      var L = _wsAggWeekly_(_wsByChannel_(_wsGetLY_(b.lob, view, b2bcRaw, b2bRaw), b.ch));
      var B = _wsAggWeekly_(_wsByChannel_(_wsGetBudget_(b.lob, view, b2bcRaw, b2bRaw), b.ch));
      var R = _wsAggWeekly_(_wsByChannel_(_rsRunRate_(b.lob, b2bcRaw, b2bRaw), b.ch));
      var at = function (agg, w, dy) { return (agg[w.year - (dy || 0)] || {})[w.week] || {}; };

      // L4W: promedio por país de las 4 semanas anteriores (con su LY, para comparar el YoY de la semana con el de la tendencia)
      var l4 = {}, l4ly = {};
      for (var j = 2; j <= 5; j++) {
        var w4 = weeks[weeks.length - j];
        [[at(A, w4), l4], [at(L, w4, 1), l4ly]].forEach(function (pair) {
          Object.keys(pair[0]).forEach(function (pais) {
            var s = pair[1][pais] = pair[1][pais] || { gb: 0, rev: 0, fvm: 0 }, v = pair[0][pais];
            s.gb += v.gb / 4; s.rev += v.rev / 4; s.fvm += v.fvm / 4;
          });
        });
      }

      // NR actual y Budget por país de la semana elegida y las anteriores (de la más vieja a la elegida)
      var streak = [];
      for (var s = RS_STREAK_; s >= 1; s--) {
        var ws = weeks[weeks.length - s], ca = at(A, ws), cb = at(B, ws), st = {};
        Object.keys(ca).concat(Object.keys(cb)).forEach(function (pais) {
          st[pais] = [Math.round((ca[pais] || {}).rev || 0), Math.round((cb[pais] || {}).rev || 0)];
        });
        streak.push(st);
      }

      biz[b.k] = {
        streak: streak,
        cur: _rsRound_(at(A, last)),
        bud: _rsRound_(at(B, last)),
        ly: _rsRound_(at(L, last, 1)),
        rr: _rsRound_(at(R, last)),
        l4w: _rsRound_(l4),
        l4wLy: _rsRound_(l4ly),
        // Serie de 13 semanas, total del negocio
        trend: weeks.map(function (w) {
          var c = _rsSum_(at(A, w)), bd = _rsSum_(at(B, w)), ly = _rsSum_(at(L, w, 1));
          return { year: w.year, week: w.week, from: w.from,
            cur: { gb: Math.round(c.gb), rev: Math.round(c.rev), fvm: Math.round(c.fvm) },
            bud: { gb: Math.round(bd.gb), rev: Math.round(bd.rev), fvm: Math.round(bd.fvm) },
            ly: { gb: Math.round(ly.gb), rev: Math.round(ly.rev), fvm: Math.round(ly.fvm) } };
        }),
      };
    });

    return {
      success: true,
      week: { year: last.year, week: last.week, from: last.from, to: to.toISOString().substring(0, 10) },
      latest: { year: latest.year, week: latest.week },
      weeks: pick.map(function (w) { return { year: w.year, week: w.week, from: w.from }; }),
      lastActualsDate: lastDay,
      generatedAt: (b2bcRaw.meta || {}).generated_at || null,
      exCoiBr: _wsExCoiBr_,
      biz: biz,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
