// Slide "B2B2C Pipeline" del Weekly B2B-MAY (2026-11-04): arma el modelo que dibujan el navegador (canvas, para el PDF) y Apps Script
// (objetos nativos de Slides). Toda la cuenta vive acá: título, totales y textos ya formateados; quien dibuja no calcula nada.
// Fuente: public/weekly/pipeline-h2-26.json (hoy cargado a mano; después, el export de Metabase con los mismos campos).
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'public', 'weekly', 'pipeline-h2-26.json');

const usd = (n) => '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dec = (n) => String(n).replace('.', ',');
// "+1,6 M USD" / "+600k USD": siempre para abajo (el "+" promete "al menos")
function approx(n) {
  if (n >= 1e6) return '+' + dec(Math.floor(n / 1e5) / 10) + ' M USD';
  return '+' + Math.floor(n / 1e5) * 100 + 'k USD';
}
const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

function buildPipelineModel(data) {
  const deals = (data.deals || []).slice().sort((a, b) => String(a.etd_deploy).localeCompare(String(b.etd_deploy)));
  const nr = sum(deals, 'nr_hz27'), fvm = sum(deals, 'fvm_hz27'), y3 = sum(deals, 'nr_y3');
  const periodo = data.periodo || "H2'26";
  return {
    title: 'B2B2C Pipeline | +' + deals.length + ' deals with ' + approx(nr).replace(' M USD', 'M USD') + ' Net Revenues ' + periodo,
    months: (data.evolutivo || []).map((m) => ({ label: m.mes, nr_k: m.nr_k, deals: m.deals_t1, nr_txt: '$' + m.nr_k })),
    rows: deals.map((d) => ({
      etd: d.etd_deploy.slice(0, 4) + '-' + Number(d.etd_deploy.slice(5, 7)),
      partner: d.partner, pais: d.pais, solucion: d.solucion,
      nr: usd(d.nr_hz27), fvm: usd(d.fvm_hz27), y3: usd(d.nr_y3),
    })),
    totals: { partners: deals.length + ' Partners', nr: approx(nr), fvm: approx(fvm), y3: approx(y3) },
    note: data.no_incluido ? 'Not included:\n' + data.no_incluido : '',
    periodo,
  };
}

function loadPipelineModel(file = DATA_FILE) {
  return buildPipelineModel(JSON.parse(fs.readFileSync(file, 'utf8')));
}

module.exports = { buildPipelineModel, loadPipelineModel };
