// "Descargar Excel" del Daily (public/daily-excel.js): el .xlsx tiene que traer exactamente los GB, NR y FVM
// de lo que eligió el usuario (mes, país, partner). Se abre el archivo generado (zip + XML) y se compara contra
// sumas hechas acá, por separado, sobre las filas crudas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { TextEncoder };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'daily-excel.js'), 'utf8'), ctx, { filename: 'daily-excel.js' });
const X = ctx.DailyExcel;

// ── Lector mínimo de .xlsx (zip "stored" + XML de las hojas) ──
function unzip(buf) {
  buf = Buffer.from(buf);
  const files = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8), crc = buf.readUInt32LE(p + 14), size = buf.readUInt32LE(p + 18);
    const nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 30, p + 30 + nlen);
    const data = buf.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    assert.equal(method, 0, `${name}: sin compresión`);
    assert.equal(X.crc32(data), crc, `${name}: CRC`);
    files[name] = data.toString('utf8');
    p += 30 + nlen + xlen + size;
  }
  assert.equal(buf.readUInt32LE(p), 0x02014b50, 'directorio central después de los archivos');
  return files;
}
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const serialToDate = (n) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
// Devuelve { hoja: [[valor por columna]] } (texto, número o fecha AAAA-MM-DD según el estilo 4).
function readXlsx(bytes) {
  const f = unzip(bytes);
  const names = [...f['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map((m) => unesc(m[1]));
  const out = {};
  names.forEach((n, i) => {
    const xml = f[`xl/worksheets/sheet${i + 1}.xml`];
    assert.ok(xml, `hoja ${n}`);
    out[n] = [...xml.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)].map((rm) => {
      const row = [];
      for (const c of rm[2].matchAll(/<c r="([A-Z]+)\d+"(?: s="(\d+)")?( t="inlineStr")?>(.*?)<\/c>/g)) {
        const col = c[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        if (c[3]) row[col] = unesc(/<t[^>]*>(.*?)<\/t>/.exec(c[4])[1]);
        else {
          const v = Number(/<v>(.*?)<\/v>/.exec(c[4])[1]);
          row[col] = c[2] === '4' ? serialToDate(v) : v;
        }
      }
      return row;
    });
  });
  return out;
}

// ── Datos de prueba: dos meses, varios países y partners, un partner con caracteres XML y filas RG ──
const R = (fecha, pais, partner, gb, nr, fvm, extra = {}) => ({
  fecha, pais, partner, productooriginal: extra.prod || 'Hotels', channel: 'API', viaje: 'N/A', account_type: 'Existing',
  region: pais === 'Brasil' ? 'BR' : 'HISPA', tier: 'Tier-1', orders: extra.orders ?? 1, gross_bookings: gb, net_revenues: nr, fvm,
});
const ROWS = [
  R('2026-09-01', 'Brasil', 'Livelo', 1000, 80, 30),
  R('2026-09-01', 'Brasil', 'Livelo', 500, 40, -5, { prod: 'Flights' }),
  R('2026-09-01', 'Brasil', 'Nubank', 700, 50, 20),
  R('2026-09-01', 'RG', 'Livelo', 0, 0, -7, { orders: 0 }),
  R('2026-09-02', 'Argentina', 'Banco & Co <AR>', 300, 25, 9),
  R('2026-09-15', 'Brasil', 'Livelo', 1200, 90, 33),
  R('2026-09-15', 'Mexico', 'Livelo', 400, 35, 10),
  R('2026-09-30', 'Brasil', 'Nubank', 10, 1, 0),
  R('2026-09-30', 'Brasil', 'Nubank', 0, 0, 0, { orders: 0 }),   // todo en 0: no aporta, no se baja
  R('2026-10-01', 'Brasil', 'Livelo', 9999, 999, 99),
  R('2026-10-03', 'Argentina', 'Banco & Co <AR>', 111, 11, 1),
];
const META = { last_actuals_date: '2026-10-03', generated_at: '2026-10-04T08:00:00' };

function expected(rows, sel) {
  const f = rows.filter((r) => r.fecha.startsWith(sel.mes)
    && (sel.pais === 'all' || r.pais === sel.pais) && (sel.partner === 'all' || r.partner === sel.partner)
    && (r.orders || r.gross_bookings || r.net_revenues || r.fvm));
  const byDay = {};
  for (const r of f) {
    const d = (byDay[r.fecha] ||= { gb: 0, nr: 0, fvm: 0, orders: 0 });
    d.gb += r.gross_bookings; d.nr += r.net_revenues; d.fvm += r.fvm; d.orders += r.orders;
  }
  const tot = f.reduce((a, r) => ({ gb: a.gb + r.gross_bookings, nr: a.nr + r.net_revenues, fvm: a.fvm + r.fvm, orders: a.orders + r.orders }), { gb: 0, nr: 0, fvm: 0, orders: 0 });
  return { n: f.length, byDay, tot };
}

function check(rows, sel, meta = META) {
  const book = readXlsx(X.buildWorkbook({ rows, sel, meta, coiExcl: true }));
  const exp = expected(rows, sel);
  assert.deepEqual(Object.keys(book), ['Resumen diario', 'Detalle', 'Info']);

  // Detalle: mismas filas y mismos montos
  const [head, ...det] = book.Detalle;
  const ix = (h) => head.indexOf(h);
  assert.equal(det.length, exp.n, 'filas de detalle');
  for (const r of det) {
    assert.ok(r[ix('Fecha')].startsWith(sel.mes), `fecha ${r[ix('Fecha')]} en ${sel.mes}`);
    if (sel.pais !== 'all') assert.equal(r[ix('País')], sel.pais === 'RG' ? 'RG (ajuste COI Brasil)' : sel.pais);
    if (sel.partner !== 'all') assert.equal(r[ix('Partner')], sel.partner);
  }
  const sum = (k) => det.reduce((a, r) => a + r[ix(k)], 0);
  assert.equal(sum('GB (USD)'), exp.tot.gb, 'GB detalle');
  assert.equal(sum('NR (USD)'), exp.tot.nr, 'NR detalle');
  assert.equal(sum('FVM (USD)'), exp.tot.fvm, 'FVM detalle');
  assert.equal(sum('Bookings'), exp.tot.orders, 'órdenes detalle');

  // Resumen diario: un renglón por día, cada día con su suma, y el Total
  const [rh, ...res] = book['Resumen diario'];
  assert.deepEqual(rh, ['Fecha', 'Bookings', 'GB (USD)', 'NR (USD)', 'FVM (USD)']);
  const total = res.pop();
  assert.equal(total[0], 'Total');
  assert.deepEqual(total.slice(1), [exp.tot.orders, exp.tot.gb, exp.tot.nr, exp.tot.fvm], 'Total del resumen');
  for (const [fecha, o, gb, nr, fvm] of res) {
    const d = exp.byDay[fecha] || { gb: 0, nr: 0, fvm: 0, orders: 0 };
    assert.deepEqual([o, gb, nr, fvm], [d.orders, d.gb, d.nr, d.fvm], `día ${fecha}`);
  }
  for (const f of Object.keys(exp.byDay)) assert.ok(res.some((r) => r[0] === f), `día ${f} en el resumen`);
  return book;
}

test('Brasil + Livelo en septiembre: solo esas filas, GB/NR/FVM exactos', () => {
  const book = check(ROWS, { mes: '2026-09', pais: 'Brasil', partner: 'Livelo' });
  const exp = expected(ROWS, { mes: '2026-09', pais: 'Brasil', partner: 'Livelo' });
  assert.deepEqual(exp.tot, { gb: 2700, nr: 210, fvm: 58, orders: 3 });   // a mano: 1000+500+1200, 80+40+90, 30-5+33
  assert.equal(book['Resumen diario'].length, 1 + 30 + 1, 'encabezado + 30 días de septiembre + Total');
});

test('todos los países y partners: incluye RG (ajuste COI) y no mezcla meses', () => {
  check(ROWS, { mes: '2026-09', pais: 'all', partner: 'all' });
  const e = expected(ROWS, { mes: '2026-09', pais: 'all', partner: 'all' });
  assert.deepEqual(e.tot, { gb: 4110, nr: 321, fvm: 90, orders: 7 });
});

test('un partner en todos los países y un país con todos los partners', () => {
  check(ROWS, { mes: '2026-09', pais: 'all', partner: 'Livelo' });
  check(ROWS, { mes: '2026-09', pais: 'Brasil', partner: 'all' });
  check(ROWS, { mes: '2026-09', pais: 'RG', partner: 'all' });
});

test('mes en curso: el resumen corta en el último día con datos', () => {
  const book = check(ROWS, { mes: '2026-10', pais: 'all', partner: 'all' });
  assert.deepEqual(book['Resumen diario'].slice(1, -1).map((r) => r[0]), ['2026-10-01', '2026-10-02', '2026-10-03']);
});

test('partner con & y < > se escribe y se lee igual (XML escapado)', () => {
  const book = check(ROWS, { mes: '2026-09', pais: 'Argentina', partner: 'Banco & Co <AR>' });
  assert.equal(book.Detalle[1][3], 'Banco & Co <AR>');
});

test('selección sin datos: archivo válido con totales en 0', () => {
  const book = check(ROWS, { mes: '2026-09', pais: 'Mexico', partner: 'Nubank' });
  assert.equal(book.Detalle.length, 1);
});

test('selectores: meses, países y partners acotados al país / mes', () => {
  assert.deepEqual([...X.monthsOf(ROWS)], ['2026-10', '2026-09']);
  assert.deepEqual([...X.countriesOf(ROWS, '2026-10')], ['Argentina', 'Brasil']);
  assert.deepEqual([...X.partnersOf(ROWS, '2026-09', 'Brasil')], ['Livelo', 'Nubank']);
  assert.deepEqual([...X.partnersOf(ROWS, '2026-09', 'Mexico')], ['Livelo']);
  assert.equal(X.fileName({ mes: '2026-09', pais: 'México', partner: 'Banco & Co' }), 'daily_b2b2c_2026-09_Mexico_Banco_Co.xlsx');
});

test('Info: deja escrita la selección', () => {
  const book = readXlsx(X.buildWorkbook({ rows: ROWS, sel: { mes: '2026-09', pais: 'Brasil', partner: 'all' }, meta: META, coiExcl: true }));
  const info = Object.fromEntries(book.Info.filter((r) => r.length === 2).map((r) => [r[0], r[1]]));
  assert.equal(info.Mes, 'septiembre 2026');
  assert.equal(info['País'], 'Brasil');
  assert.equal(info.Partner, 'Todos los partners');
  assert.equal(info['Datos al'], '2026-10-03');
});

// Con la copia local del espejo (py mirror/ownia_mirror.py --to-dir _store; no se versiona), el mismo control
// sobre el daily_b2b2c_data.json real: todos los meses, cada país y el partner más grande de cada país.
const STORE = path.join(__dirname, '..', '_store');
function realActuals() {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(STORE, '_index.json'), 'utf8'));
    const list = Array.isArray(idx) ? idx : idx.files || Object.values(idx);
    const m = list.find((f) => f && f.name === 'daily_b2b2c_data.json');
    if (!m) return null;
    const raw = JSON.parse(fs.readFileSync(path.join(STORE, m.id), 'utf8'));
    let a = raw.actuals;
    if (a && a.cols) a = a.rows.map((row) => Object.fromEntries(a.cols.map((c, i) => [c, row[i]])));
    return { rows: a, meta: raw.meta };
  } catch (e) { return null; }
}
const real = realActuals();
test('datos reales del Daily (si está el espejo local)', { skip: !real && 'sin _store local' }, () => {
  const { rows, meta } = real;
  for (const mes of X.monthsOf(rows)) {
    check(rows, { mes, pais: 'all', partner: 'all' }, meta);
    for (const pais of X.countriesOf(rows, mes)) {
      check(rows, { mes, pais, partner: 'all' }, meta);
      const gbBy = {};
      rows.filter((r) => r.fecha.startsWith(mes) && r.pais === pais).forEach((r) => { gbBy[r.partner] = (gbBy[r.partner] || 0) + r.gross_bookings; });
      const top = Object.entries(gbBy).sort((a, b) => b[1] - a[1])[0];
      if (top) check(rows, { mes, pais, partner: top[0] }, meta);
    }
  }
});

// Organic (2026-11-04: Tiago bajó Argentina noviembre y el Excel daba GB 2,83M contra $2,63M en la tarjeta, porque la
// página estaba en Organic YES y el Excel bajaba nominal). Se corre el código de Organic del propio dashboard.html
// (_orgFactor_, _orgRows_, b2bcRawOrg_…) con una tabla de TC de prueba, y el Excel con moneda "como la página" tiene que
// dar lo mismo que suma la página; con "nominal", los montos crudos.
const { GAS_ROOT } = require('../server/config');
const DASH = path.join(GAS_ROOT, 'Daily_Dashboard', 'dashboard.html');
test('moneda como la página (Organic YES): mismos GB / NR / FVM que la página', () => {
  const html = fs.readFileSync(DASH, 'utf8');
  const a = html.indexOf('var _dlOrganic = false;'), b = html.indexOf('function setDailyOrganic(');
  assert.ok(a > 0 && b > a, 'bloque Organic en dashboard.html');
  const page = { Object, WeakMap, String, TextEncoder };
  page.window = page;
  vm.createContext(page);
  vm.runInContext(html.slice(a, b), page, { filename: 'dashboard.html#organic' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'daily-excel.js'), 'utf8'), page, { filename: 'daily-excel.js' });
  // TC (moneda local por USD): Argentina se devaluó contra el Budget → factor actuals/budget = 0,93
  vm.runInContext(`
    _rawB2BC = { actuals: ${JSON.stringify(ROWS)}, meta: ${JSON.stringify(META)} };
    function b2bcRaw_() { return _rawB2BC; }
    var _b2bcComparison = 'budget';
    _dlOrganic = true;
    _fxTbl = {
      actuals:  { 'argentina§2026-09': 930, 'argentina§2026-10': 1000, 'brasil§2026-09': 5.5, 'brasil§2026-10': 5.5,
                  'argentina§2025-09': 800, 'argentina§2025-10': 850, 'brasil§2025-09': 5, 'brasil§2025-10': 5 },
      budget:   { 'argentina§2026-09': 1000, 'argentina§2026-10': 1000, 'brasil§2026-09': 5, 'brasil§2026-10': 5 },
      forecast: {}
    };`, page);
  const X2 = page.DailyExcel;
  const pick = X2.pageRows(page, 'page');
  assert.equal(pick.organic, true);
  assert.match(pick.currency, /Organic YES.*TC Budget/);
  const close = (x, y, msg) => assert.ok(Math.abs(x - y) < 1e-6, `${msg}: ${x} vs ${y}`);
  for (const sel of [{ mes: '2026-09', pais: 'Argentina', partner: 'all' }, { mes: '2026-09', pais: 'Brasil', partner: 'Livelo' },
    { mes: '2026-09', pais: 'all', partner: 'all' }]) {
    // Lo que suma la página: filas organic de b2bcRawOrg_ (las de las tarjetas MTD), mismo filtro de mes/país/partner
    const org = page.b2bcRawOrg_(page._orgTargetB2BC_()).actuals.filter((r) => r.fecha.startsWith(sel.mes)
      && (sel.pais === 'all' || r.pais === sel.pais) && (sel.partner === 'all' || r.partner === sel.partner));
    const want = { gb: 0, nr: 0, fvm: 0 };
    org.forEach((r) => { want.gb += r.gross_bookings; want.nr += r.net_revenues; want.fvm += r.fvm; });
    const book = readXlsx(X2.buildWorkbook({ rows: pick.rows, sel, meta: META, currency: pick.currency }));
    const tot = book['Resumen diario'].at(-1);
    close(tot[2], want.gb, `GB ${sel.pais}`); close(tot[3], want.nr, `NR ${sel.pais}`); close(tot[4], want.fvm, `FVM ${sel.pais}`);
    const info = Object.fromEntries(book.Info.filter((r) => r.length === 2));
    assert.match(info.Moneda, /Organic YES/);
  }
  // Argentina sep: 300 / 25 / 9 nominal × 0,93
  const ar = readXlsx(X2.buildWorkbook({ rows: pick.rows, sel: { mes: '2026-09', pais: 'Argentina', partner: 'all' }, meta: META }));
  close(ar['Resumen diario'].at(-1)[2], 279, 'GB AR organic'); close(ar['Resumen diario'].at(-1)[3], 23.25, 'NR AR organic');
  // Nominal: los montos crudos
  const nom = X2.pageRows(page, 'nominal');
  assert.equal(nom.organic, false);
  const arN = readXlsx(X2.buildWorkbook({ rows: nom.rows, sel: { mes: '2026-09', pais: 'Argentina', partner: 'all' }, meta: META }));
  assert.equal(arN['Resumen diario'].at(-1)[2], 300);
  // Organic NO en la página: "como la página" = nominal
  vm.runInContext('_dlOrganic = false;', page);
  assert.equal(X2.pageRows(page, 'page').organic, false);
});
