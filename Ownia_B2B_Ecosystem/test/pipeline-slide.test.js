// Modelo de la slide "B2B2C Pipeline" del Weekly (server/pipeline-slide.js): título, totales y formato salen de las filas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPipelineModel, loadPipelineModel } = require('../server/pipeline-slide');

test('con los datos cargados: 17 deals, +1,6M de NR y filas ordenadas por ETD', () => {
  const m = loadPipelineModel();
  assert.equal(m.title, "B2B2C Pipeline | +17 deals with +1,6M USD Net Revenues H2'26");
  assert.equal(m.rows.length, 17);
  assert.equal(m.rows[0].partner, 'Kapital Bank');
  assert.equal(m.rows[0].etd, '2026-10');
  assert.equal(m.rows[16].etd, '2027-1');
  assert.equal(m.rows[2].nr, '$328.125');
  assert.deepEqual(m.totals, { partners: '17 Partners', nr: '+1,6 M USD', fvm: '+600k USD', y3: '+39,6 M USD' });
  assert.equal(m.months.length, 6);
  assert.equal(m.months[5].nr_txt, '$603');
  assert.match(m.note, /^Not included:\n\+20 Tier 2/);
});

test('totales y título se recalculan si cambian las filas', () => {
  const m = buildPipelineModel({ deals: [
    { etd_deploy: '2026-12', partner: 'B', pais: 'x', solucion: 'y', nr_hz27: 250000, fvm_hz27: 90000, nr_y3: 2000000 },
    { etd_deploy: '2026-10', partner: 'A', pais: 'x', solucion: 'y', nr_hz27: 40000, fvm_hz27: 10000, nr_y3: 300000 },
  ] });
  assert.equal(m.rows[0].partner, 'A');
  assert.match(m.title, /\+2 deals with \+200k USD Net Revenues/);
  assert.equal(m.totals.nr, '+200k USD');
  assert.equal(m.note, '');
});
