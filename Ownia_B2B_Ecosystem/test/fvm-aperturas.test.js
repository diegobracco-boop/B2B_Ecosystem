// FVM Negativo en Ownia — aperturas por medio de pago / cuotas / aerolínea / hotel (public/fvm-aperturas.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'fvm-aperturas.js'), 'utf8'), ctx, { filename: 'fvm-aperturas.js' });
const A = ctx.FvmAperturas;
const ALL = { biz: 'b2b2c', country: 'all', product: 'all', month: 'all' };

test('medio de pago: códigos agrupados; sin dato en B2B = cuenta de la agencia', () => {
  assert.equal(A.medioGroup('ONE_CARD_CREDIT', 'b2b2c'), 'Tarjeta de crédito');
  assert.equal(A.medioGroup('FINANCED_2', 'b2b'), 'Financiado');
  assert.equal(A.medioGroup('CASH_TRANSFER_PIX', 'b2b'), 'PIX');
  assert.equal(A.medioGroup('CASH_TRANSFER_SPEI', 'b2b'), 'Transferencia');
  assert.equal(A.medioGroup('CASH_DEPOSIT_RAPIPAGO', 'b2b2c'), 'Efectivo / depósito');
  assert.equal(A.medioGroup('N/A', 'b2b'), 'Cuenta de la agencia');
  assert.equal(A.medioGroup('N/A', 'b2b2c'), 'Sin dato');
  assert.equal(A.medioGroup('CURRENT_ACCOUNT', 'b2b'), 'Cuenta de la agencia');
  assert.equal(A.medioGroup('ALGO_NUEVO', 'b2b2c'), 'ALGO_NUEVO');   // lo desconocido se muestra tal cual
});

test('cuotas: tramos', () => {
  assert.deepEqual(['-1', '0', '1', '3', '6', '12', '18', '36', 'x'].map(A.cuotasBucket),
    ['Sin dato', '0', '1 cuota', '2 a 3', '4 a 6', '7 a 12', '13 a 24', 'Más de 24', 'Sin dato']);
});

test('aerolínea: código + nombre', () => {
  assert.equal(A.airlineLabel('LA'), 'LA · LATAM');
  assert.equal(A.airlineLabel('ZZ'), 'ZZ');
  assert.equal(A.airlineLabel('Varias'), 'Varias aerolíneas');
  assert.equal(A.airlineLabel('N/A'), 'Sin dato');
});

const R = (ym, pais, producto, valor, fvm_neg, tx_neg, tx_total, fvm_total) => ({ ym, pais, producto, valor, fvm_neg, tx_neg, tx_total, fvm_total });
const ROWS = [
  R('2026-10', 'Argentina', 'Flights', 'ONE_CARD_CREDIT', -100, 5, 50, 900),
  R('2026-10', 'Argentina', 'Hotels', 'ONE_CARD_CREDIT', -50, 2, 20, 300),
  R('2026-10', 'Brasil', 'Flights', 'CASH_TRANSFER_PIX', -300, 9, 40, -100),
  R('2026-11', 'Argentina', 'Flights', 'ONE_CARD_DEBIT', -10, 1, 10, 50),
  R('2026-11', 'Argentina', 'Flights', 'CASH_TRANSFER_SPEI', -20, 1, 5, 10),
  R('2026-11', 'Argentina', 'Flights', 'CASH_TRANSFER_DEC', -5, 1, 5, 10),
];

test('agregación: suma por grupo, ordena por FVM negativo y respeta filtros', () => {
  const a = A.aggregate(ROWS, 'medio_pago', ALL);
  assert.deepEqual(Array.from(a.groups, (g) => g.name), ['PIX', 'Tarjeta de crédito', 'Transferencia', 'Tarjeta de débito']);
  const tc = a.groups[1];
  assert.equal(tc.fvm_neg, -150); assert.equal(tc.tx_neg, 7); assert.equal(tc.tx_total, 70); assert.equal(tc.fvm_total, 1200);
  assert.deepEqual(Array.from(a.groups[2].codes), ['CASH_TRANSFER_DEC', 'CASH_TRANSFER_SPEI']);
  assert.equal(a.total.fvm_neg, -485); assert.equal(a.total.tx_total, 130);

  const f = A.aggregate(ROWS, 'medio_pago', { ...ALL, country: 'Argentina', product: 'Flights', month: '2026-10' });
  assert.equal(f.groups.length, 1); assert.equal(f.total.fvm_neg, -100);
});

test('cuotas en orden de tramo; hotel: "Otros hoteles" al final aunque pierda más', () => {
  const c = A.aggregate([R('2026-10', 'AR', 'Flights', '12', -1, 1, 2, 0), R('2026-10', 'AR', 'Flights', '1', -500, 9, 9, 0),
                         R('2026-10', 'AR', 'Flights', '0', 0, 0, 30, 100)], 'cuotas', ALL);
  assert.deepEqual(Array.from(c.groups, (g) => g.name), ['0', '1 cuota', '7 a 12']);   // el tramo sin pérdida también se ve
  const h = A.aggregate([R('2026-10', 'AR', 'Hotels', 'Otros hoteles', -900, 9, 99, 0), R('2026-10', 'AR', 'Hotels', 'Hotel A', -10, 1, 3, 0)], 'hotel', ALL);
  assert.deepEqual(Array.from(h.groups, (g) => g.name), ['Hotel A', 'Otros hoteles']);
});

test('modules.js: FVM Negativo carga la capa', () => {
  const M = require('../server/modules.js');
  const mod = (M.MODULES || M).find((m) => m.slug === 'fvm-negativo');
  assert.ok([].concat(mod.layout).includes('fvm-aperturas.js'));
});
