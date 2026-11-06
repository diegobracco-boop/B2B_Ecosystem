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
// Desde 2026-11-06 (pedido del CEO): aperturas para explicar el desvío vs Budget. units = B2B2C por partner × país
// (actuals, LY, Budget y Run Rate traen partner; mismos alias que PARTNER_ALIAS_ del Daily) y B2B API / HTML por país
// (el Budget B2B no trae agencia); ustreak = NR y Budget de cada unidad en las 4 semanas. Y el MTD: el mes de
// params.month ('YYYY-MM', uno de los últimos RS_MONTHS_; por defecto el del último día con reales) hasta ese día (o
// completo si ya cerró), con LY de las mismas fechas del año anterior, la serie diaria y el Budget del mes completo.

var RS_WEEKS_ = 13;   // semanas de la serie (la última + 12 anteriores)
var RS_PICK_ = 8;     // semanas cerradas que se pueden elegir en la página (la última + 7 anteriores), 2026-11-06
var RS_STREAK_ = 4;   // semanas por país (la elegida + 3 anteriores) de NR vs Budget, para ver si un desvío se repite
var RS_MONTHS_ = 4;
// Organic (2026-11-06, pedido de Tiago): misma regla que el Weekly del Daily con el switch ORGANIC en Budget
// (getWeeklySummaryData, Codigo_organic.js). Los actuals van a TC Budget (cur: todo lo que se compara contra Budget, L4W y
// la serie); para los vs LY, los actuals a TC Actuals del año anterior (curL, l4wL, cl en las unidades; "opción B"); el
// LY, el Budget y el Run Rate quedan en USD tal cual, y contra el Run Rate se usan los actuals nominales (curN): al Run
// Rate no se le aplica organic. Si no se puede leer el archivo de TC, todo queda nominal y organic.error lo dice.
// Filas con fecha ≥ desde, convertidas con conv (organicConverter_); conserva partner (u, n) y canal
function _rsOrg_(rows, conv, desde) {
  return (rows || []).filter(function (r) { return r.fecha && String(r.fecha).substring(0, 10) >= desde; }).map(function (r) {
    var f = conv ? conv.f(r.pais, String(r.fecha).substring(0, 7)) : 1;
    if (f === 1) return r;
    return { fecha: r.fecha, pais: r.pais, canal: r.canal, u: r.u, n: r.n, gb: r.gb * f, rev: r.rev * f, fvm: r.fvm * f };
  });
}   // meses que se pueden elegir en la vista MTD (el actual + 3 anteriores)

// Mismo partner escrito distinto según la fuente: copia de PARTNER_ALIAS_ (Daily_Dashboard/dashboard.html). Además se
// compara sin mayúsculas, así que solo hace falta para los casos que cambian algo más que mayúsculas / minúsculas.
var RS_ALIAS_ = { 'livelo-api-hoteles': 'Livelo-API-Hoteles', 'Turismocity': 'TurismoCity', 'ELO': 'Elo', 'VISA': 'Visa', 'Itau card': 'Itau Card' };
function _rsPartner_(p) { var s = String(p == null ? '' : p).trim(); return RS_ALIAS_[s] || s || 'Sin asignar'; }

// Filas B2B2C con partner {fecha, pais, u (clave), n (nombre), gb, rev, fvm}. Memo por objeto de origen, como _wsNorm_.
var _rsPartMemo_ = typeof WeakMap === 'function' ? new WeakMap() : null;
function _rsPartRows_(src, expand, revCol) {
  var calc = function () {
    return (expand ? _wsExpandCompact_(src) : (src || [])).map(function (r) {
      var n = _rsPartner_(r.partner);
      return { fecha: String(r.fecha || ''), pais: String(r.pais || ''), u: n.toLowerCase(), n: n,
        gb: parseFloat(r.gross_bookings || 0) || 0, rev: parseFloat(r[revCol] || 0) || 0, fvm: _fvmOf_(r) };
    });
  };
  if (!_rsPartMemo_ || !src || typeof src !== 'object') return calc();
  var m = _rsPartMemo_.get(src);
  if (!m) { m = {}; _rsPartMemo_.set(src, m); }
  var k = (expand ? 'x' : '') + revCol + '|' + _wsExCoiBr_;
  return m[k] || (m[k] = calc());
}

function _rsYmd_(d) { return d.toISOString().substring(0, 10); }
function _rsAddDays_(ymd, n) { var p = ymd.split('-'); return _rsYmd_(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n))); }
function _rsIsoMonday_(y, w) { var j4 = new Date(Date.UTC(y, 0, 4)), d = j4.getUTCDay() || 7; return _rsYmd_(new Date(Date.UTC(y, 0, 4 - d + 1 + (w - 1) * 7))); }
function _rsShiftYear_(ymd, n) { return (+ymd.substring(0, 4) + n) + ymd.substring(4); }   // LY = mismas fechas del año anterior
// Clave de unidad: partner|país en B2B2C, país en B2B; el ajuste COI Brasil (RG) va solo
function _rsUnitKey_(r) { return r.pais === 'RG' ? 'RG' : (r.u ? r.u + '|' + r.pais : r.pais); }
function _rsZ_() { return { gb: 0, rev: 0, fvm: 0 }; }
function _rsAdd_(t, r) { t.gb += r.gb; t.rev += r.rev; t.fvm += r.fvm; }
function _rsRd_(t) { return { gb: Math.round(t.gb), rev: Math.round(t.rev), fvm: Math.round(t.fvm) }; }

// Recorre las filas una vez y suma en cada rango que contiene la fecha (specs: [{from, to, fn(r, fecha)}], 'YYYY-MM-DD')
function _rsScan_(rows, specs) {
  (rows || []).forEach(function (r) {
    if (!r.pais || !r.fecha) return;
    var f = String(r.fecha).substring(0, 10);
    for (var i = 0; i < specs.length; i++) if (f >= specs[i].from && f <= specs[i].to) specs[i].fn(r, f);
  });
}
function _rsUnitAcc_(units, sc) {
  return function (r) {
    var k = _rsUnitKey_(r), u = units[k];
    if (!u) u = units[k] = { n: r.n || '', p: r.pais, cur: _rsZ_(), bud: _rsZ_(), ly: _rsZ_(), cl: _rsZ_() };
    else if (!u.n && r.n) u.n = r.n;
    _rsAdd_(u[sc], r);
  };
}
function _rsPaisAcc_(by) { return function (r) { _rsAdd_(by[r.pais] = by[r.pais] || _rsZ_(), r); }; }
function _rsRoundUnits_(units) {
  var o = {};
  Object.keys(units).forEach(function (k) {
    var u = units[k];
    u.cur = _rsRd_(u.cur); u.bud = _rsRd_(u.bud); u.ly = _rsRd_(u.ly); u.cl = _rsRd_(u.cl);
    if (u.cur.gb || u.cur.rev || u.cur.fvm || u.bud.gb || u.bud.rev || u.bud.fvm || u.ly.rev) o[k] = u;
  });
  return o;
}

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
    var wFrom = last.from, wTo = _rsYmd_(to);
    var lyFrom = _rsIsoMonday_(last.year - 1, last.week), lyTo = _rsAddDays_(lyFrom, 6);   // LY = misma semana ISO del año anterior

    // Mes de la vista MTD (params.month): uno de los RS_MONTHS_ últimos; el del último día con reales llega hasta ese día
    var months = [], y0 = +lastDay.substring(0, 4), m0 = +lastDay.substring(5, 7);
    for (var mq = 0; mq < RS_MONTHS_; mq++) months.push(_rsYmd_(new Date(Date.UTC(y0, m0 - 1 - mq, 1))).substring(0, 7));
    var ym = months.indexOf(String((params && params.month) || '')) >= 0 ? String(params.month) : months[0];
    var mFrom = ym + '-01', mEnd = _rsYmd_(new Date(Date.UTC(+ym.substring(0, 4), +ym.substring(5, 7), 0)));
    var mTo = ym === months[0] ? lastDay : mEnd;
    var mLyFrom = _rsShiftYear_(mFrom, -1), mLyTo = _rsShiftYear_(mTo, -1);

    // Organic: conversores a TC Budget y a TC Actuals LY. Solo se convierten los actuals desde la fecha más vieja que se usa.
    var convB = null, convL = null, orgErr = '';
    try { convB = organicConverter_('budget'); convL = organicConverter_('ly'); } catch (eo) { convB = convL = null; orgErr = 'No se pudo leer el archivo de tipos de cambio: ' + eo.message; }
    var desde = weeks[0].from < months[months.length - 1] + '-01' ? weeks[0].from : months[months.length - 1] + '-01';

    var biz = {};
    BIZ.forEach(function (b) {
      var A0 = _wsByChannel_(_wsGetActuals_(b.lob, view, b2bcRaw, b2bRaw), b.ch);
      var A = _wsAggWeekly_(_rsOrg_(A0, convB, desde)), AL = _wsAggWeekly_(_rsOrg_(A0, convL, desde)), AN = _wsAggWeekly_(_rsOrg_(A0, null, desde));
      var L = _wsAggWeekly_(_wsByChannel_(_wsGetLY_(b.lob, view, b2bcRaw, b2bRaw), b.ch));
      var B = _wsAggWeekly_(_wsByChannel_(_wsGetBudget_(b.lob, view, b2bcRaw, b2bRaw), b.ch));
      var R = _wsAggWeekly_(_wsByChannel_(_rsRunRate_(b.lob, b2bcRaw, b2bRaw), b.ch));
      var at = function (agg, w, dy) { return (agg[w.year - (dy || 0)] || {})[w.week] || {}; };

      // L4W: promedio por país de las 4 semanas anteriores (con su LY, para comparar el YoY de la semana con el de la tendencia)
      var l4 = {}, l4ly = {}, l4L = {};
      for (var j = 2; j <= 5; j++) {
        var w4 = weeks[weeks.length - j];
        [[at(A, w4), l4], [at(L, w4, 1), l4ly], [at(AL, w4), l4L]].forEach(function (pair) {
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

      // Unidades (partner × país en B2B2C, país en B2B) de la semana, su racha y el MTD
      var src = b.k === 'b2b2c'
        ? { A: _rsPartRows_(b2bcRaw.actuals, false, 'net_revenues'), L: _rsPartRows_(b2bcRaw.actuals_ly, false, 'net_revenues'),
            B: _rsPartRows_(b2bcRaw.budget, true, 'net_revenue'), R: _rsPartRows_(b2bcRaw.runrate, true, 'net_revenue') }
        : { A: A0, L: _wsByChannel_(_wsGetLY_(b.lob, view, b2bcRaw, b2bRaw), b.ch),
            B: _wsByChannel_(_wsGetBudget_(b.lob, view, b2bcRaw, b2bRaw), b.ch), R: _wsByChannel_(_rsRunRate_(b.lob, b2bcRaw, b2bRaw), b.ch) };
      var srcN = src.A;
      src.A = _rsOrg_(srcN, convB, desde);
      var srcAL = _rsOrg_(srcN, convL, desde), srcAN = _rsOrg_(srcN, null, desde);
      var units = {}, mUnits = {}, mBy = { cur: {}, bud: {}, ly: {}, rr: {}, curL: {}, curN: {} }, budMonth = _rsZ_(), days = {};
      var ust = [];
      for (var s2 = RS_STREAK_; s2 >= 1; s2--) { var wsx = weeks[weeks.length - s2]; ust.push({ from: wsx.from, to: _rsAddDays_(wsx.from, 6), u: {} }); }
      var dayAcc = function (sc, shift) {
        return function (r, f) {
          var d = shift ? _rsShiftYear_(f, shift) : f, o = days[d] = days[d] || { cur: _rsZ_(), bud: _rsZ_(), ly: _rsZ_(), curL: _rsZ_() };
          _rsAdd_(o[sc], r);
        };
      };
      var stAcc = function (w, ix) { return function (r) { var k = _rsUnitKey_(r), o = w.u[k] = w.u[k] || [0, 0]; o[ix] += r.rev; }; };
      var specsFor = function (sc) {
        if (sc === 'rr') return [{ from: mFrom, to: mTo, fn: _rsPaisAcc_(mBy.rr) }];
        if (sc === 'cn') return [{ from: mFrom, to: mTo, fn: _rsPaisAcc_(mBy.curN) }];
        if (sc === 'cl') return [
          { from: wFrom, to: wTo, fn: _rsUnitAcc_(units, 'cl') },
          { from: mFrom, to: mTo, fn: _rsPaisAcc_(mBy.curL) },
          { from: mFrom, to: mTo, fn: _rsUnitAcc_(mUnits, 'cl') },
          { from: mFrom, to: mTo, fn: dayAcc('curL', 0) }];
        if (sc === 'ly') return [
          { from: lyFrom, to: lyTo, fn: _rsUnitAcc_(units, 'ly') },
          { from: mLyFrom, to: mLyTo, fn: _rsPaisAcc_(mBy.ly) },
          { from: mLyFrom, to: mLyTo, fn: _rsUnitAcc_(mUnits, 'ly') },
          { from: mLyFrom, to: mLyTo, fn: dayAcc('ly', 1) }];
        var sp = [{ from: wFrom, to: wTo, fn: _rsUnitAcc_(units, sc) }];
        ust.forEach(function (w) { sp.push({ from: w.from, to: w.to, fn: stAcc(w, sc === 'cur' ? 0 : 1) }); });
        sp.push({ from: mFrom, to: mTo, fn: _rsPaisAcc_(mBy[sc]) });
        sp.push({ from: mFrom, to: mTo, fn: _rsUnitAcc_(mUnits, sc) });
        sp.push({ from: mFrom, to: mTo, fn: dayAcc(sc, 0) });
        if (sc === 'bud') sp.push({ from: mFrom, to: mEnd, fn: function (r) { _rsAdd_(budMonth, r); } });
        return sp;
      };
      _rsScan_(src.A, specsFor('cur'));
      _rsScan_(src.B, specsFor('bud'));
      _rsScan_(src.L, specsFor('ly'));
      _rsScan_(src.R, specsFor('rr'));
      _rsScan_(srcAL, specsFor('cl'));
      _rsScan_(srcAN, specsFor('cn'));

      biz[b.k] = {
        units: _rsRoundUnits_(units),
        ustreak: ust.map(function (w) { var o = {}; Object.keys(w.u).forEach(function (k) { o[k] = [Math.round(w.u[k][0]), Math.round(w.u[k][1])]; }); return o; }),
        mtd: {
          cur: _rsRound_(mBy.cur), bud: _rsRound_(mBy.bud), ly: _rsRound_(mBy.ly), rr: _rsRound_(mBy.rr), curL: _rsRound_(mBy.curL), curN: _rsRound_(mBy.curN),
          units: _rsRoundUnits_(mUnits), budMonth: _rsRd_(budMonth),
          days: Object.keys(days).filter(function (d) { return d >= mFrom && d <= mTo; }).sort()
            .map(function (d) { return { d: d, cur: _rsRd_(days[d].cur), bud: _rsRd_(days[d].bud), ly: _rsRd_(days[d].ly), curL: _rsRd_(days[d].curL) }; }),
        },
        streak: streak,
        cur: _rsRound_(at(A, last)),
        curL: _rsRound_(at(AL, last)),
        curN: _rsRound_(at(AN, last)),
        l4wL: _rsRound_(l4L),
        bud: _rsRound_(at(B, last)),
        ly: _rsRound_(at(L, last, 1)),
        rr: _rsRound_(at(R, last)),
        l4w: _rsRound_(l4),
        l4wLy: _rsRound_(l4ly),
        // Serie de 13 semanas, total del negocio
        trend: weeks.map(function (w) {
          var c = _rsSum_(at(A, w)), bd = _rsSum_(at(B, w)), ly = _rsSum_(at(L, w, 1));
          return { year: w.year, week: w.week, from: w.from,
            cur: { gb: Math.round(c.gb), rev: Math.round(c.rev), fvm: Math.round(c.fvm) }, curL: _rsRd_(_rsSum_(at(AL, w))),
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
      month: { ym: ym, from: mFrom, to: mTo, end: mEnd, days: +mTo.substring(8, 10), daysInMonth: +mEnd.substring(8, 10) },
      months: months,
      lastActualsDate: lastDay,
      generatedAt: (b2bcRaw.meta || {}).generated_at || null,
      exCoiBr: _wsExCoiBr_,
      organic: { target: convB ? 'budget' : '', error: orgErr || undefined,
        missing: convB ? Object.keys(convB.missing).concat(Object.keys(convL.missing)).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort() : [] },
      biz: biz,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
