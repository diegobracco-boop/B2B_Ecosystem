// ════════════════════════════════════════════════════════════════
//  LoB × Country One Pager — Backend
//  Resumen ejecutivo para la dirección comercial de un país puntual.
//  Objetivo: paneo general rápido con las 3 métricas núcleo de cada
//  vista, y desde ahí dirigir al detalle (otros tableros / agentes IA).
//
//    Sección 1 · GESTIONAL MTD  → GB / NR / FVM  (como el Daily)
//    Sección 2 · CONTABLE       → GB / NR / OC   (último mes cerrado)
//
//  Por ahora SOLO B2B. B2B2C queda como pestaña "próximamente".
//
//  No tiene pipeline propio: combina, vía Apps Script Libraries, las
//  funciones ya públicas de los tableros existentes (misma fuente de
//  datos que ellos, para que los números coincidan siempre):
//    - DashboardB2BWLs.getCountryPageData()  → evo mensual GB/NR/OC (contable)
//    - DailyDashboard.getCountryMTD()         → MTD gestional GB/NR/FVM por país
//  Ver CONTEXT-MAP.md para el detalle de cada librería y su scriptId.
// ════════════════════════════════════════════════════════════════

var PAISES = ['Globales', 'Brasil', 'Mexico', 'Argentina', 'Colombia', 'Chile', 'Peru', 'Ecuador'];

// "Globales" = el bucket discreto de "otros países" (NO incluye OPS/RG ni
// Uruguay/Paraguay, que van a Hispa). Cada fuente lo nombra distinto y hay
// que apuntar al bucket discreto en ambas para que midan lo mismo:
//   - Daily (gestional):         país 'Other Countries'  (NO el grupo residual)
//   - Dashboard_B2B_WLs (cont.): país 'other countries'  (contable y mix)
var GESTIONAL_PAIS = { 'Globales': 'Other Countries' };
var CONTABLE_PAIS  = { 'Globales': 'other countries' };
var LOBS   = [
  { id: 'b2b',   label: 'B2B',   enabled: true  },
  { id: 'b2b2c', label: 'B2B2C', enabled: false }   // próximamente
];
var FY_START = '2026-04';
var FY_END   = '2027-03';

function doGet(e) {
  try {
    return HtmlService
      .createTemplateFromFile('dashboard').evaluate()
      .setTitle('Country One Pager · B2B')
      .addMetaTag('viewport', 'width=device-width,initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return HtmlService.createHtmlOutput('<h1>Error</h1><p>' + err + '</p>');
  }
}

function getFilters() {
  return { paises: PAISES, lobs: LOBS };
}

// ── ÚNICA llamada del frontend ──────────────────────────────────
// Toda la página habla sobre UN mismo mes (params.ym). Default: último
// mes real cerrado. Gestional muestra GD y RI del mes; contable muestra
// actuals si el mes está cerrado, o Run Rate si todavía no cerró.
function getOnePagerData(params) {
  var p    = params || {};
  var pais = PAISES.indexOf(p.pais) >= 0 ? p.pais : 'Globales';
  var lob  = 'b2b';   // B2B2C llega en otra iteración

  // Base contable (1 sola llamada) → meses seleccionables, corte real, waterfalls.
  var base   = _getContableBase_(pais);
  var months = base ? base.months : [];
  var lastAc = base ? base.lastActualsYm : null;
  var ym = (p.ym && months.indexOf(p.ym) >= 0) ? p.ym
         : (lastAc || (months.length ? months[months.length - 1] : null));

  return {
    pais:          pais,
    lob:           lob,
    ym:            ym,
    lastActualsYm: lastAc,
    months:        months,
    gestional: {
      gd: _getGestionalMTD_(pais, 'GD', ym),
      ri: _getGestionalMTD_(pais, 'RI', ym)
    },
    contable: _buildContableCards_(base, ym),
    evo:      _buildEvo_(base),
    mix:      _getMix_(pais)
  };
}

// Evolución mensual GB/NR/OC: Actual (contable cerrado + RR en meses sin
// cierre), Budget, Last Year y crecimiento YoY. Para el gráfico evolutivo.
function _buildEvo_(base) {
  if (!base || !base.metrics) return null;
  var last    = base.lastActualsYm;
  var periods = base.periods || [];

  function series(m) {
    var actual = [], budget = [], lastYear = [], yoy = [];
    periods.forEach(function (ym, i) {
      var closed = last && ym <= last;
      var val = closed ? (m.actuals ? m.actuals[i] : null)
                       : (m.runRate && m.runRate[i] != null ? m.runRate[i] : null);
      var b  = m.budget   ? m.budget[i]   : null;
      var ly = m.lastYear ? m.lastYear[i] : null;
      actual.push(val); budget.push(b); lastYear.push(ly);
      yoy.push((val != null && ly) ? (val - ly) / Math.abs(ly) * 100 : null);
    });
    return { label: m.label, actual: actual, budget: budget, lastYear: lastYear, yoy: yoy };
  }

  var out = { periods: periods, lastActualsYm: last };
  base.metrics.forEach(function (m) {
    if (m.id === 'gb' || m.id === 'nr' || m.id === 'oc') out[m.id] = series(m);
  });
  return out;
}

// ── Sección 1 · GESTIONAL (Daily_Dashboard) ─────────────────────
// GB / NR / FVM del mes `ym` para el país (fila propia, sin agregado
// "Hispa"). Para un mes cerrado = mes completo; para el mes en curso = MTD.
function _getGestionalMTD_(pais, view, ym) {
  var paisGd = GESTIONAL_PAIS[pais] || pais;   // Globales → país discreto 'Other Countries'
  var res = DailyDashboard.getCountryMTD({ view: (view === 'RI' ? 'RI' : 'GD'), lob: 'B2B', pais: paisGd, ym: ym });
  if (!res || !res.success || !res.mtd) return null;
  var mtd = res.mtd;

  // actual/budget ya vienen en millones; vsLY / achievement son %.
  function metric(id, label, cell) {
    if (!cell) return { id: id, label: label, actual: null, budget: null, vsLY: null, vsBudget: null };
    var vsB = (cell.achievement != null) ? (cell.achievement - 100)
            : (cell.budget ? (cell.actual - cell.budget) / Math.abs(cell.budget) * 100 : null);
    return { id: id, label: label, actual: cell.actual, budget: cell.budget, vsLY: cell.vsLY, vsBudget: vsB };
  }

  return {
    month:     mtd.month,
    daysCount: mtd.daysCount,
    hasBudget: mtd.hasBudget,
    unit:      'M',                  // valores en millones
    metrics: [
      metric('gb',  'Gross Bookings', mtd.gb),
      metric('nr',  'Net Revenue',    mtd.rev),
      metric('fvm', 'FVM',            mtd.fvm)
    ]
  };
}

// ── Sección 3 · MIX Canal × Producto (contable, Pareto + márgenes) ─
// FY27 acumulado (hasta último mes real) por combinación canal (MAY/MIN) ×
// producto, con GB / NR / OC. OC es un concepto CONTABLE (calcOC de
// Dashboard_B2B_WLs), por eso el mix se saca del contable — así los ratios
// OC/GB y NR/GB coinciden con la sección B2B. (No depende de GD/RI.)
function _titleCase_(s) {
  return String(s || '').replace(/\b\w/g, function (m) { return m.toUpperCase(); });
}

function _getMix_(pais) {
  var paisCt = CONTABLE_PAIS[pais] || pais;   // Globales → 'other countries'
  var data = DashboardB2BWLs.getB2BCanalProductoMix({ pais: paisCt, desde: FY_START });
  if (!data || !data.items || !data.items.length) return null;

  var items = [], total = 0, totNr = 0, totOc = 0;
  data.items.forEach(function (it) {
    if (!(it.gb > 0)) return;
    total += it.gb; totNr += it.nr; totOc += it.oc;
    items.push({
      canal:    it.canal,
      producto: _titleCase_(it.producto),
      label:    it.canal + ' · ' + _titleCase_(it.producto),
      gb: it.gb, nr: it.nr, oc: it.oc,
      nrGb: it.gb ? it.nr / it.gb * 100 : null,
      ocGb: it.gb ? it.oc / it.gb * 100 : null
    });
  });
  if (!items.length) return null;

  items.sort(function (a, b) { return b.gb - a.gb; });

  return {
    metric:    'gb',
    total:     total,
    totalNrGb: total ? totNr / total * 100 : null,
    totalOcGb: total ? totOc / total * 100 : null,
    items:     items
  };
}

// ── Sección 2 · CONTABLE (Dashboard_B2B_WLs) ────────────────────
// Base: evo mensual GB/NR/OC + waterfalls + meses seleccionables.
function _getContableBase_(pais) {
  var paisCt = CONTABLE_PAIS[pais] || pais;   // Globales → 'other countries'
  var cp  = DashboardB2BWLs.getCountryPageData({ pais: paisCt, desde: FY_START, hasta: FY_END });
  var b2b = cp && cp.b2bData;
  var evo = b2b ? b2b.evo : null;
  if (!evo || !evo.metrics) return null;

  var lastActualsYm = _lastActualsYm_(evo);

  // Meses seleccionables: cerrados (<= corte real) o con Run Rate disponible.
  var gbM = null;
  evo.metrics.forEach(function (m) { if (m.id === 'gb') gbM = m; });
  var months = [];
  (evo.periods || []).forEach(function (ym, i) {
    var closed = lastActualsYm && ym <= lastActualsYm;
    var hasRR  = gbM && gbM.runRate && gbM.runRate[i] != null;
    if (closed || hasRR) months.push(ym);
  });

  return {
    periods:       evo.periods,
    metrics:       evo.metrics,
    lastActualsYm: lastActualsYm,
    months:        months,
    // Mismos waterfalls que la sección B2B de Dashboard_B2B_WLs (misma función
    // fuente → coinciden siempre). Baseline = actuals cerrados + RR en meses futuros.
    waterfalls:    b2b ? { oc: b2b.ocConceptWf, nr: b2b.nrBridgeWf } : null
  };
}

// Tarjetas del mes `ym`: si el mes está cerrado → actuals contables; si aún
// no cerró → Run Rate. Así toda la página habla del mismo mes.
function _buildContableCards_(base, ym) {
  if (!base || !ym) return null;
  var idx = base.periods.indexOf(ym);
  if (idx < 0) return null;

  var closed = base.lastActualsYm && ym <= base.lastActualsYm;
  var basis  = closed ? 'actual' : 'RR';

  var order   = { gb: 0, nr: 1, oc: 2 };
  var metrics = base.metrics.slice().sort(function (a, b) {
    return (order[a.id] == null ? 9 : order[a.id]) - (order[b.id] == null ? 9 : order[b.id]);
  });

  var cards = metrics.map(function (m) {
    var val = closed ? (m.actuals ? m.actuals[idx] : null)
                     : (m.runRate ? m.runRate[idx] : null);
    var b   = m.budget   ? m.budget[idx]   : null;
    var ly  = m.lastYear ? m.lastYear[idx] : null;
    var vsB  = (val != null && b)  ? (val - b)  / Math.abs(b)  * 100 : null;
    var vsLY = (val != null && ly) ? (val - ly) / Math.abs(ly) * 100 : null;
    return { id: m.id, label: m.label, value: val, vsBudget: vsB, vsLY: vsLY };
  });

  return { ym: ym, basis: basis, metrics: cards, waterfalls: base.waterfalls };
}

// evo.metrics[].actuals viene BLENDED (actuals+RR+forecast) para todo el FY27,
// así que su último valor no-nulo sería un mes PROYECTADO. En cambio evo.byCountry
// sí nulea los meses proyectados (isAct = ym <= LAST_ACTUALS_YM en Dashboard_B2B_WLs),
// de ahí derivamos el último mes con actuals REALES.
function _lastActualsYm_(evo) {
  var cps  = evo.ctryPeriods || [];
  var last = null;
  (evo.byCountry || []).forEach(function (c) {
    var arr = (c.metrics && c.metrics.gb) ? c.metrics.gb.actuals : [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] != null && cps[i] && (!last || cps[i] > last)) last = cps[i];
    }
  });
  return last;
}
