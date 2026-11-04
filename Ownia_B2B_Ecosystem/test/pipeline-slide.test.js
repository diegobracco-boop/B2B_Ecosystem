// Modelo de "Pipeline Hunting" (server/pipeline-slide.js): criterio de la tabla de Metabase (rampa desde el mes del ETD), totales fijos y "Otros".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPipelineModel, loadPipelineModel, rampShare } = require('../server/pipeline-slide');

test('rampa: el mes del ETD cuenta como mes 1 (coincide con la tabla de Metabase)', () => {
  const nr = (amount, cierre) => Math.round(amount * rampShare(cierre));
  assert.equal(nr(1000000, '2026-10'), 72917);    // Kapital Bank
  assert.equal(nr(6300000, '2026-11'), 328125);   // Visa
  assert.equal(nr(4500000, '2026-12'), 156375);   // Air Canada
  assert.equal(nr(400000, '2027-01'), 8333);      // Disney
  assert.equal(nr(5003238, '2026-11'), 260585);   // Cencosud
  assert.equal(nr(1000000, '2027-04'), 0);        // cierra después de H2'27
});

test('con los datos cargados: 36 deals, totales fijos 4,1 M / 1,5 M y Mercado Pago en el top', () => {
  const m = loadPipelineModel();
  assert.equal(m.all.length, 36);
  assert.equal(m.title, "B2B2C Pipeline | +36 deals with +4,1M USD Net Revenues H2'26");
  assert.deepEqual(m.kpis.map((x) => x.v).slice(0, 3), ['36', '+4,1 M', '+1,5 M']);
  assert.equal(m.rows.length, 12);
  assert.equal(m.rows[0].partner, 'Cencosud');
  assert.equal(m.rows[0].nr, '$261k');
  assert.ok(m.rows.some((r) => r.partner === 'Mercado Pago' && r.logo === 'pl-mercadopago.png'));
  assert.ok(m.rows.every((r) => r.logo), 'los 12 del top tienen logo');
  assert.equal(m.total.nr, '+$4.100k');
  assert.equal(m.total.fvm, '+$1.500k');
  assert.equal(m.updated, '04.11.2026');
  assert.equal(m.chart.months.length, 6);
  assert.equal(m.chart.months[3].txt, '601k');
});

test('"+ Otros" de la página es lo que falta para llegar a los totales fijos', () => {
  const m = loadPipelineModel();
  const nr = m.all.reduce((a, r) => a + r.raw.nr, 0), fvm = m.all.reduce((a, r) => a + r.raw.fvm, 0);
  assert.ok(Math.abs(nr + m.otrosAll.nrRaw - 4100000) < 1);
  assert.ok(Math.abs(fvm + m.otrosAll.fvmRaw - 1500000) < 1);
});

test('sin totales fijos, los totales salen de los deals y "Otros" de la slide es el resto', () => {
  const m = buildPipelineModel({ deals: [
    { name: 'A', cierre: '2026-10', pais: 'x', amount: 1200000, fvm_ratio: 0.5 },
    { name: 'B', cierre: '2026-10', pais: 'x', amount: 600000, fvm_ratio: 0.25 },
    { name: 'C', cierre: '2026-12', pais: 'x', amount: 1200000, fvm_ratio: null },
  ] }, { top: 2 });
  assert.equal(m.rows.length, 2);
  assert.equal(m.rows[0].partner, 'A');
  assert.equal(m.otros.label, 'Otros 1 deals');
  assert.equal(m.otrosAll.nrRaw, 0);
});
