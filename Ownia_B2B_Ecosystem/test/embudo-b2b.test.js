// Embudo B2B (server/embudo-b2b.js): etapas, GD vs RI de un mes y tabla por país, con un embudo_b2b.json chico armado a mano.
const test = require('node:test');
const assert = require('node:assert');
const { embudoApi, _reset, DAILY_FOLDER_ID, FILE_NAME } = require('../server/embudo-b2b');

const JSON_ = {
  hasta: '2026-11-16', desde: '2025-01-01', actualizado: '2026-11-17',
  cohortes: {
    cols: ['mes_venta', 'canal', 'pais', 'producto', 'etapa', 'gb_bruto', 'gb_gd'],
    rows: [
      ['2026-10', 'API', 'Argentina', 'Hoteles', 'Cancelado', 50, 29],
      ['2026-10', 'API', 'Argentina', 'Hoteles', 'Reconocido', 30, 17],
      ['2026-10', 'API', 'Argentina', 'Hoteles', 'A reconocer', 20, 12],
      ['2026-10', 'HTML', 'Brasil', 'Vuelos', 'Cancelado', 10, 7],
      ['2026-10', 'HTML', 'Brasil', 'Vuelos', 'Pendiente', 5, 4],
      ['2026-10', 'HTML', 'Brasil', 'Vuelos', 'Reconocido', 85, 64],
      ['2026-11', 'HTML', 'Brasil', 'Vuelos', 'Reconocido', 40, 30],
    ],
  },
  ri: {
    cols: ['mes_ri', 'canal', 'pais', 'producto', 'mes_venta', 'gb_ri'],
    rows: [
      ['2026-10', 'API', 'Argentina', 'Hoteles', '2026-10', 10],
      ['2026-10', 'API', 'Argentina', 'Hoteles', '2026-08', 30],
      ['2026-10', 'API', 'Argentina', 'Hoteles', '2026-01', 20],
      ['2026-10', 'HTML', 'Brasil', 'Vuelos', '2026-10', 80],
      ['2026-10', 'HTML', 'Brasil', 'Vuelos', '2026-09', 20],
    ],
  },
  cosecha: {
    cols: ['mes_venta', 'mes_ri', 'canal', 'pais', 'producto', 'gb_bruto'],
    rows: [
      ['2026-10', '2026-10', 'API', 'Argentina', 'Hoteles', 10],
      ['2026-10', '2026-11', 'API', 'Argentina', 'Hoteles', 20],
      ['2026-10', '2027-01', 'API', 'Argentina', 'Hoteles', 20],
      ['2026-10', '2028-02', 'API', 'Argentina', 'Hoteles', 0],
      ['2026-10', '2026-10', 'HTML', 'Brasil', 'Vuelos', 85],
    ],
  },
  pagos: {
    cols: ['mes_venta', 'pais', 'producto', 'medio', 'estado', 'gb_bruto', 'gb_gd'],
    rows: [
      ['2026-10', 'Brasil', 'Vuelos', 'CREDIT_CARD', 'Confirmado', 80, 64],
      ['2026-10', 'Brasil', 'Vuelos', 'REMOTE,CREDIT_CARD', 'Cancelado', 2, 1],
      ['2026-10', 'Brasil', 'Vuelos', 'NATIVE_PROMISE_PAY', 'Cancelado', 8, 5],
      ['2026-10', 'Brasil', 'Vuelos', 'CURRENT_ACCOUNT', 'Pendiente', 5, 4],
      ['2026-10', 'Brasil', 'Vuelos', 'CURRENT_ACCOUNT', 'Confirmado', 5, 4],
    ],
  },
};

function store(json) {
  const buf = Buffer.from(JSON.stringify(json));
  return { findByName: (folder, name) => (folder === DAILY_FOLDER_ID && name === FILE_NAME ? [{ buf, meta: { updatedAt: 1, sha256: 'x' } }] : []) };
}
const api = (qs) => { _reset(); return embudoApi(store(JSON_), new URLSearchParams(qs)); };

test('embudo: etapas suman lo vendido y el GD es vendido × gradiente', () => {
  const r = api('desde=2026-10&hasta=2026-10');
  const e = Object.fromEntries(r.embudo.map((x) => [x.k, x]));
  assert.strictEqual(e.vendido.gb, 200);
  assert.strictEqual(e.cancelado.gb + e.pendiente.gb + e.reconocido.gb + e.a_reconocer.gb, 200);
  assert.strictEqual(e.confirmado.gb, 135);
  assert.strictEqual(e.gd.gb, 133);
  assert.strictEqual(e.cancelado.pct, 30);
});

test('filtros por canal y país', () => {
  const r = api('desde=2026-10&hasta=2026-10&canal=API');
  assert.strictEqual(r.embudo[0].gb, 100);
  assert.strictEqual(r.q.canal, 'API');
  const b = api('desde=2026-10&hasta=2026-11&pais=Brasil');
  assert.strictEqual(b.embudo[0].gb, 140);
  assert.strictEqual(api('pais=Narnia').q.pais, '');   // un valor que no está en los datos se ignora
});

test('puente: GD y RI del mes, y el RI abierto por mes de venta', () => {
  const p = api('mes=2026-10').puente;
  assert.strictEqual(p.vendido, 200);
  assert.strictEqual(p.gd, 133);
  assert.strictEqual(p.ri, 160);
  const o = Object.fromEntries(p.origen.map((x) => [x.lbl, x.gb]));
  assert.strictEqual(o['Vendido ese mes'], 90);
  assert.strictEqual(o['Vendido 1 mes antes'], 20);
  assert.strictEqual(o['Vendido 2 meses antes'], 30);
  assert.strictEqual(o['Vendido 6 meses antes o más'], 20);
  assert.strictEqual(p.origen.reduce((a, x) => a + x.gb, 0), p.ri);
});

test('paises: total al final y suma de los países', () => {
  const rows = api('desde=2026-10&hasta=2026-10').paises;
  assert.strictEqual(rows[rows.length - 1].pais, 'Total');
  const tot = rows.pop();
  assert.strictEqual(rows.reduce((a, x) => a + x.vendido, 0), tot.vendido);
  assert.strictEqual(tot.ri, 160);
  assert.strictEqual(rows[0].pais, 'Argentina');   // ordenado por vendido (empate: el primero que aparece)
});

test('defaults: FY desde abril y el último mes cerrado para el puente', () => {
  const r = api('');
  assert.strictEqual(r.q.hasta, '2026-11');
  assert.strictEqual(r.q.mes, '2026-10');   // nov-26 viene hasta el 16: no está cerrado
  assert.strictEqual(r.q.desde, '2026-10'); // abr-26 no está en este archivo de prueba: cae al primer mes con datos
});

test('sin archivo: error claro', () => {
  _reset();
  assert.throws(() => embudoApi({ findByName: () => [] }, new URLSearchParams()), /embudo_b2b\.json/);
});

test('gradiente: cancelado real vs lo que descuenta el gradiente, en US$, y meses maduros', () => {
  const g = api('').gradiente;
  const oct = g.rows.find((r) => r.mes === '2026-10');
  assert.strictEqual(oct.canc, 60);           // 50 API + 10 HTML
  assert.strictEqual(oct.cancGrad, 200 - 133);
  assert.strictEqual(oct.dif, 60 - 67);
  assert.strictEqual(oct.madura, false);      // 20 a reconocer + 5 pendiente = 12,5% abierto
  const nov = g.rows.find((r) => r.mes === '2026-11');
  assert.strictEqual(nov.madura, true);       // todo reconocido
  assert.strictEqual(g.maduros.meses, 1);
  assert.strictEqual(g.maduros.canc, 0);
});

test('cosecha: lag entre venta y reconocimiento, acumulado y meses futuros', () => {
  const c = api('desde=2026-10&hasta=2026-10&canal=API').cosecha;
  assert.strictEqual(c.lags[0], 'M0');
  assert.strictEqual(c.lags[c.lags.length - 1], 'M13+');
  assert.strictEqual(c.lags.length, 9);   // M0..M6, M7–12, M13+
  const r = c.rows[0];
  assert.strictEqual(r.total, 50);
  assert.strictEqual(r.cells[0].gb, 10);
  assert.strictEqual(r.cells[1].gb, 20);
  assert.strictEqual(r.cells[3].gb, 20);
  assert.strictEqual(r.cells[3].acum, 100);
  assert.strictEqual(r.cells[1].futuro, false);   // nov-26 ya empezó
  assert.strictEqual(r.cells[3].futuro, true);    // ene-27 todavía no
  assert.strictEqual(Math.round(r.mesesProm * 100) / 100, (0 * 10 + 1 * 20 + 3 * 20) / 50);
});

test('pagos: agrupa medios de pago y calcula la cancelación por medio (solo HTML)', () => {
  const p = api('desde=2026-10&hasta=2026-10').pagos;
  const by = Object.fromEntries(p.rows.map((r) => [r.medio, r]));
  assert.strictEqual(by['Tarjeta de crédito'].vendido, 82);   // CREDIT_CARD + REMOTE,CREDIT_CARD
  assert.strictEqual(by['Reservá y pagá después'].pctCanc, 100);
  assert.strictEqual(by['Cuenta corriente'].pctPend, 50);
  assert.strictEqual(by['Total HTML'].vendido, 100);
  assert.strictEqual(by['Total HTML'].canc, 10);
  assert.strictEqual(api('canal=API').pagos.aplica, false);
});

test('conciliacion: de GD a RI del mes cierra exacto', () => {
  const c = api('mes=2026-10').conciliacion;
  const p = Object.fromEntries(c.mes.pasos.map((x) => [x.k, x.v]));
  assert.strictEqual(p.gd, 133);
  assert.strictEqual(p.vendido, 200);
  assert.strictEqual(p.canc, -60);
  assert.strictEqual(p.pend, -5);
  assert.strictEqual(p.despues, -(135 - 95));      // confirmado 135, reconocido en oct 95 (cosecha)
  assert.strictEqual(p.previas, 70);              // RI de oct de ventas anteriores (30 + 20 + 20)
  assert.strictEqual(p.ri, 160);
  assert.strictEqual(c.mes.cierre, 0);
  assert.ok(c.serie.length >= 1);
});
