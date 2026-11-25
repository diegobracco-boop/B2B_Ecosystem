// Bridge de OC (public/oc-bridge.js, sección B2B del Flow mensual): tiene que dar lo mismo que el waterfall del P&L Accounting
// (wfCompute_ + buildB2BRegionSplits_ de P&L_Accounting/dashboard.html). Se corren los dos sobre los mismos datos sintéticos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'oc-bridge.js'), 'utf8'), ctx, { filename: 'oc-bridge.js' });
const B = ctx.OcBridge;

// El original, sacado del HTML del P&L Accounting (si cambia allá, este test lo nota)
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'P&L_Accounting', 'dashboard.html'), 'utf8').replace(/\r\n/g, '\n');
const between = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i >= 0 && j > i, a + ' en dashboard.html'); return html.slice(i, j); };
const fnSrc = (name) => { const m = new RegExp('function ' + name + String.raw`\([^)]*\) ?\{[\s\S]*?\n\}`).exec(html); assert.ok(m, name + ' en dashboard.html'); return m[0]; };
const O = {};
vm.runInNewContext([
  "var FY_TAG = 'FY27';",
  between('var B2B_REGION_ORDER', '\n\n'),
  between('var WF_ITEM_LABELS', 'var _wfCharts'),
  fnSrc('sumProductData_'), fnSrc('buildB2BRegionSplits_'),
  'O.wfCompute_ = wfCompute_; O.buildB2BRegionSplits_ = buildB2BRegionSplits_;',
].join('\n'), { O });

// Datos sintéticos con la forma de getEPMB2BCountryDetail: { baseline, goal } con rr / ct por período
const RR = ['gross_bookings', 'up_front_incentives', '_cfc_rr', 'income_from_outsourced_services', 'cancellations', 'cost_of_installments', 'credit_card_processing', '_tpcs_rr'];
const CT = ['revenue from sales as principal', 'back end incentives', 'other incentives', 'breakage revenue', 'media & other revenue', 'loyalty revenue', 'revenue taxes',
  'cost of sales as principal', 'customer claims', 'frauds', 'errors', 'bad debt', 'fulfilment center fees', 'media & other cost', 'other transactional taxes',
  'intercompany transactions', 'marketing-direct', 'marketing-personnel/expenses', 'channels-personnel/expenses', 'loyalty program', 'other taxes'];
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const PERS = ['Q1 FY27', 'Q2 FY27', 'Q3 FY27', 'Q4 FY27', 'Total FY27'];
function block() {
  const sc = () => {
    const rr = {}, ct = {};
    RR.forEach((k) => { rr[k] = {}; PERS.forEach((p) => { rr[k][p] = Math.round((rnd() - (k === 'gross_bookings' ? 0 : 0.5)) * (k === 'gross_bookings' ? 1e8 : 2e6)); }); });
    CT.forEach((k) => { ct[k] = {}; PERS.forEach((p) => { ct[k][p] = Math.round((rnd() - 0.5) * 2e6); }); });
    return { rr, ct, rr_monthly: rr, ct_monthly: ct };   // el original con una lista de claves lee los *_monthly: mismas claves acá
  };
  return { baseline: sc(), goal: sc() };
}
const prod = (label) => ({ label, data: block() });
const region = (label, extra) => Object.assign({ label, data: block() }, extra || {});
const d = {
  quarters: PERS, total: block(),
  may: { products: [prod('Hotels'), prod('Flights'), prod('Dest. Serv.'), prod('Rest of products')],
    by_region: [region('Brasil', { products: [prod('MAY · Hotels')] }), region('Globales'), region('Mexico', { products: [prod('MAY · Hotels')] }),
      region('Hispa', { countries: [prod('Argentina'), prod('Chile')] }), region('RG - COI')] },
  min: { products: [prod('Hotels'), prod('Cruises'), prod('Rest of ONA')],
    by_region: [region('Brasil', { products: [prod('MIN · Hotels')] }), region('Mexico'), region('Hispa', { countries: [prod('Argentina'), prod('Peru')] })] },
};

const plain = (x) => JSON.parse(JSON.stringify(x));

test('igual al waterfall del P&L Accounting (B2B con palancas por región), Q3 y Q4', () => {
  for (const q of ['Q3 FY27', 'Q4 FY27']) {
    const mine = B.compute(d.total, [q], B.b2bSplits(d));
    const orig = O.wfCompute_(d.total, [q], O.buildB2BRegionSplits_(d));
    assert.equal(mine.goalOC, orig.goalOC);
    assert.equal(mine.baselineOC, orig.baselineOC);
    assert.deepEqual(plain(mine.steps).map(({ group, ...s }) => s), plain(orig.steps));
  }
});

test('los pasos suman Baseline − Goal y vienen en el orden del gráfico', () => {
  const r = B.compute(d.total, ['Q3 FY27'], B.b2bSplits(d));
  const sum = r.steps.reduce((a, s) => a + s.delta, 0);
  assert.ok(Math.abs(sum - (r.baselineOC - r.goalOC)) < 1e-6);
  assert.deepEqual(plain(r.steps.map((s) => s.label)), ['Palancas Iniciativas', 'Palancas Brasil', 'Palancas Globales', 'Palancas Mexico', 'Palancas Hispa',
    'Palancas RG - COI', 'Incentivos Regionales', 'Marketing Inv.', 'Fixed Cost', 'Resto']);
  // sin aperturas, una sola barra de palancas
  assert.equal(B.compute(d.total, ['Q3 FY27']).steps[0].label, 'Palancas de Negocio');
});

test('oc-bridge.js está en el layout del Hub antes de hub-slides.js, y el pedido del bridge se cachea', () => {
  const MODULES = require('../server/modules');
  const list = MODULES.MODULES || MODULES;
  const hub = list.find((m) => m.slug === 'hub');
  assert.ok(hub.layout.indexOf('oc-bridge.js') >= 0 && hub.layout.indexOf('oc-bridge.js') < hub.layout.indexOf('hub-slides.js'));
  assert.ok(list.find((m) => m.slug === 'pnl-accounting').cacheFns.includes('getEPMB2BCountryDetail'));
});
