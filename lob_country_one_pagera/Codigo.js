// ════════════════════════════════════════════════════════════════
//  LoB × Country One Pager — Backend
//  Resumen para VP comercial / director comercial de una sola
//  combinación LoB+País (ej: director B2B2C Brasil, director B2B México).
//
//  No tiene pipeline propio: combina, vía Apps Script Libraries, las
//  funciones ya públicas de los tableros existentes (misma fuente de
//  datos que ellos, para que los números coincidan siempre):
//    - DashboardB2BWLs.getCountryPageData()  → evolución mensual GB/NR/OC
//    - PnLManagerial.getData()               → partners + hunting/farming
//    - DailyDashboard.getWeeklySummaryData() → pulso semanal
//  Ver CONTEXT-MAP.md para el detalle de cada librería y su scriptId.
// ════════════════════════════════════════════════════════════════

var PAISES = ['Brasil', 'Mexico', 'Argentina', 'Colombia', 'Chile', 'Peru', 'Ecuador'];
var LOBS   = [
  { id: 'b2b2c', label: 'B2B2C' },
  { id: 'b2b',   label: 'B2B'   }
];
var FY_START = '2026-04';
var FY_END   = '2027-03';

function doGet(e) {
  try {
    return HtmlService
      .createTemplateFromFile('dashboard').evaluate()
      .setTitle('LoB · Country One Pager')
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
function getOnePagerData(params) {
  var p    = params || {};
  var pais = PAISES.indexOf(p.pais) >= 0 ? p.pais : 'Brasil';
  var lob  = (p.lob === 'b2b') ? 'b2b' : 'b2b2c';

  // Un solo round-trip a Dashboard_B2B_WLs para evo + los 2 waterfalls
  var cp      = DashboardB2BWLs.getCountryPageData({ pais: pais, desde: FY_START, hasta: FY_END });
  var lobData = (lob === 'b2b') ? cp.b2bData : cp.b2b2cData;

  return {
    pais:       pais,
    lob:        lob,
    evolucion:  lobData ? lobData.evo : null,
    waterfalls: lobData ? { oc: lobData.ocConceptWf, nr: lobData.nrBridgeWf } : null,
    partners:   _getPartners_(pais, lob),
    semanal:    _getSemanal_(pais, lob)
  };
}

// ── Partners + Hunting/Farming (P&L_Managerial gestional) ───────
function _getPartners_(pais, lob) {
  var lobTipo = (lob === 'b2b2c') ? 'B2B2C' : ['B2B-MAY', 'B2B-MIN'];
  var data = PnLManagerial.getData({ pais: [pais], lob_tipo: lobTipo });

  var months     = data.months || [];
  var lastMonth  = months.length ? months[months.length - 1] : null;

  function totalsFor(aggByMonth) {
    if (!lastMonth || !aggByMonth || !aggByMonth[lastMonth]) return null;
    var a = aggByMonth[lastMonth];
    return { gb: a.gross_bookings || 0, nr: a.net_revenue || 0, npv: a.npv || 0 };
  }

  return {
    lastMonth:  lastMonth,
    actual:     totalsFor(data.agg),
    budget:     totalsFor(data.budget),
    lastYear:   totalsFor(data.ly),
    hunting:    (lob === 'b2b2c') ? totalsFor(data.agg_hunting) : null,
    farming:    (lob === 'b2b2c') ? totalsFor(data.agg_farming) : null,
    topPartners: (data.partners || []).slice(0, 10)
  };
}

// ── Pulso semanal (Daily_Dashboard) ─────────────────────────────
function _getSemanal_(pais, lob) {
  var lobParam = (lob === 'b2b2c') ? 'B2B2C' : 'B2B';
  var ws = DailyDashboard.getWeeklySummaryData({ view: 'GD', lob: lobParam });
  if (!ws || !ws.success) return null;

  var row = null;
  (ws.rows || []).some(function (r) {
    if (r.group === pais) { row = r; return true; }
    return false;
  });

  return { weekLabels: ws.weekLabels || [], row: row };
}
