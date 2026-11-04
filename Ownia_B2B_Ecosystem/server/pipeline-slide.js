// "Pipeline Hunting" B2B2C (2026-11-04): modelo de la slide del Flow semanal ("B2B2C — Pipeline", después de Status KRs) y de la página
// "Pipeline Hunting" del menú. Toda la cuenta vive acá; quien dibuja solo muestra textos ya formateados.
//
// Criterio de la tabla (el de la slide de Metabase, verificado contra Kapital, Visa, Air Canada, Disney, BBVA, Cencosud y Toc Toc):
//   NR Y3        = monto del deal (amount de HubSpot / partners del deal)
//   NR H2'27     = NR Y3 × (suma de la rampa de 36 meses de los meses que van del mes del ETD a mar-27, el mes del ETD cuenta como mes 1) / 12
//   FVM H2'27    = NR H2'27 × FVM/NR del deal (HubSpot; sin dato = 0)
// Los totales de NR y FVM H2'27 son fijos (`totales` del JSON, 4,1 M y 1,5 M): lo que no explican los deals va en "Otros".
// Datos: public/weekly/pipeline-h2-26.json (snapshot; la query vive en Daily_Dashboard/pipeline_b2b2c.sql).
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'public', 'weekly', 'pipeline-h2-26.json');
const RAMP = [0.042, 0.083, 0.125, 0.167, 0.208, 0.250, 0.292, 0.333, 0.375, 0.417, 0.458, 0.500, 0.525, 0.550, 0.575, 0.600, 0.625, 0.650, 0.675, 0.700,
  0.725, 0.750, 0.775, 0.800, 0.817, 0.833, 0.850, 0.867, 0.883, 0.900, 0.917, 0.933, 0.950, 0.967, 0.983, 1.000];
const H2_END = '2027-03';
const MES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LOGOS = [[/cencosud/i, 'pl-cencosud.png'], [/hsbc/i, 'pl-hsbc.png'], [/iberia/i, 'pl-iberia.png'], [/bbva/i, 'pl-bbva.png'], [/disney/i, 'pl-disney.png'],
  [/air canada/i, 'pl-aircanada.png'], [/esfera/i, 'pl-esfera.png'], [/voe livre/i, 'pl-voelivre.png'], [/cr[eé]dito de(l)? per/i, 'pl-bcp.png'],
  [/^universal/i, 'pl-universal.png'], [/toc toc/i, 'pl-toctoc.png'], [/hostech/i, 'pl-hostech.png'], [/mercado pago/i, 'pl-mercadopago.png']];

const thousands = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const k = (n) => '$' + thousands(n / 1000) + 'k';
const dec = (n) => String(n).replace('.', ',');
const mm = (n) => '+' + dec(Math.round(n / 1e5) / 10) + ' M';
const monthsBetween = (from, to) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));

// meses de rampa dentro de H2'27 para un ETD (0 si cierra después de mar-27)
function rampShare(cierre) {
  const n = monthsBetween(cierre, H2_END) + 1;
  return n > 0 ? RAMP.slice(0, Math.min(n, RAMP.length)).reduce((a, b) => a + b, 0) / 12 : 0;
}

function dealRow(d) {
  const nr = (d.amount || 0) * rampShare(d.cierre);
  const fvm = nr * (d.fvm_ratio || 0);
  return { raw: { nr, fvm, y3: d.amount || 0 }, fecha: MES[Number(d.cierre.slice(5, 7)) - 1] + '-' + d.cierre.slice(2, 4), partner: d.name, pais: d.pais,
    logo: (LOGOS.find(([re]) => re.test(d.name)) || [])[1] || null, nr: k(nr), fvm: k(fvm), y3: k(d.amount || 0) };
}

function buildPipelineModel(data, { top = 12 } = {}) {
  const all = (data.deals || []).map(dealRow).sort((a, b) => b.raw.nr - a.raw.nr || a.partner.localeCompare(b.partner));
  const sum = (rows, f) => rows.reduce((a, r) => a + r.raw[f], 0);
  const T = data.totales || {};
  const totNr = T.nr_h2 != null ? T.nr_h2 : sum(all, 'nr');
  const totFvm = T.fvm_h2 != null ? T.fvm_h2 : sum(all, 'fvm');
  const totY3 = sum(all, 'y3');
  const shown = all.slice(0, top), rest = all.slice(top);
  const ev = data.evolutivo || [];
  const [d, m, y] = (data.actualizado || '').split('-').reverse();
  return {
    title: 'B2B2C Pipeline | +' + all.length + ' deals with ' + mm(totNr).replace(' M', 'M') + ' USD Net Revenues ' + (data.periodo || "H2'27"),
    updated: data.actualizado ? [d, m, y].join('.') : '',
    kpis: [{ v: String(all.length), l: 'Deals en pipeline' }, { v: mm(totNr), l: "NR H2'27 USD" }, { v: mm(totFvm), l: "FVM H2'27 USD" }, { v: mm(totY3), l: 'NR Y3 USD' }],
    chart: { label: data.evolutivo_label || 'FVM [k USD]', months: ev.map((e) => ({ label: e.mes, v: e.k, txt: e.k >= 1000 ? dec(Math.round(e.k / 100) / 10) + 'M' : e.k + 'k', deals: e.deals })) },
    rows: shown,
    // Slide: "Otros" = deals fuera del top + lo que falta para llegar a los totales fijos. Y3: solo lo de los deals.
    otros: { label: 'Otros ' + rest.length + ' deals', nr: k(totNr - sum(shown, 'nr')), fvm: k(totFvm - sum(shown, 'fvm')), y3: k(sum(rest, 'y3')) },
    total: { label: 'Total ' + all.length + ' deals', nr: '+' + k(totNr), fvm: '+' + k(totFvm), y3: '+' + k(totY3) },
    // Página "Pipeline Hunting": todos los deals y un "+ Otros" con lo que falta para llegar a 4,1 M y 1,5 M.
    all,
    otrosAll: { label: '+ Otros', nr: k(totNr - sum(all, 'nr')), fvm: k(totFvm - sum(all, 'fvm')), nrRaw: totNr - sum(all, 'nr'), fvmRaw: totFvm - sum(all, 'fvm') },
    periodo: data.periodo || "H2'27",
  };
}

function loadPipelineModel(file = DATA_FILE, opts) {
  return buildPipelineModel(JSON.parse(fs.readFileSync(file, 'utf8')), opts);
}

// Lo que publica "Actualizar reales" (Daily_Dashboard/pipeline_b2b2c_sync.py) en la carpeta del Daily: si está, manda; si no (o viene roto),
// queda la foto del repo. El id de la carpeta es el mismo de DRIVE_FOLDER_ID de daily_sync.py y de drive-manifest.json.
const DAILY_FOLDER_ID = '1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh';
const STORE_FILE_NAME = 'pipeline_b2b2c.json';
function modelFromStore(fileStore, opts, log) {
  const f = fileStore && fileStore.findByName ? fileStore.findByName(DAILY_FOLDER_ID, STORE_FILE_NAME)[0] : null;
  if (f) {
    try {
      const data = JSON.parse(f.buf.toString('utf8'));
      if (Array.isArray(data.deals) && data.deals.length) return buildPipelineModel(data, opts);
    } catch (e) {
      if (log) log({ level: 'warn', msg: 'pipeline_b2b2c.json ilegible, se usa la foto del repo', error: e.message });
    }
  }
  return loadPipelineModel(DATA_FILE, opts);
}

module.exports = { buildPipelineModel, loadPipelineModel, modelFromStore, rampShare, DAILY_FOLDER_ID, STORE_FILE_NAME };
