// "Embudo B2B" (2026-11-17, Diego): qué pasa con lo que vende B2B. Se vende 100, una parte se cancela, otra queda pendiente y lo
// confirmado se reconoce (RI) cuando viaja el pasajero, a veces meses después: por eso en un mismo mes el Daily muestra un GD y un
// RI muy distintos (p.ej. Argentina HTML nov-26: ~1,9 M por GD y ~1,1 M por RI). Toda la cuenta vive acá; la página
// (server/embudo-b2b-page.js) solo dibuja.
//
// Fuente: embudo_b2b.json en la carpeta del Daily (Daily_Dashboard/embudo_b2b_sync.py, con las reglas B2B GD / RI de daily_sync.py):
//   - cohortes [mes_venta, canal, pais, producto, etapa, gb_bruto, gb_gd]: lo vendido por mes de venta y su estado de HOY
//     (Cancelado / Pendiente / Reconocido / A reconocer), en bruto y × gradiente (= el GD del Daily).
//   - ri [mes_ri, canal, pais, producto, mes_venta, gb_ri]: el RI del Daily por mes de reconocimiento y mes de venta.
//   - cosecha [mes_venta, mes_ri, canal, pais, producto, gb_bruto]: lo confirmado por mes de venta y mes de reconocimiento,
//     incluidos los meses futuros (viajes ya programados).
//   - pagos [mes_venta, pais, producto, medio, estado, gb_bruto, gb_gd]: solo HTML, por medio de pago (payment_methods crudo;
//     se agrupa con MEDIOS).
//
// Vistas (GET <base>/embudo-b2b/data?pais=&canal=&producto=&desde=&hasta=&mes=):
//   - embudo (árbol en la página): lo vendido entre desde y hasta (meses de venta) por etapa, y el GD del Daily.
//   - puente: un mes: lo vendido ese mes y qué pasó con eso, el GD y el RI, y el RI abierto por cuántos meses antes se vendió.
//   - paises: por país, vendido del período con su estado, y el GD y el RI del Daily en esos mismos meses.
//   - gradiente: por mes de venta, en US$: lo que se canceló de verdad contra lo que el GD da por cancelado (vendido − GD).
//     Un mes es "maduro" cuando lo que todavía se puede cancelar (pendiente + confirmado sin viajar) es <= MADURO_PCT de lo
//     vendido; el resumen compara solo esos meses (en los recientes la cancelación real todavía sube).
//   - cosecha: aging entre la venta y el reconocimiento: por mes de venta, qué parte de lo confirmado se reconoce en el mismo
//     mes (M0), al mes siguiente (M1)... hasta M6, y después M7-12 y M13+. Las celdas posteriores al último día con datos son viajes programados.
//   - pagos: HTML por medio de pago (agrupado): vendido, % cancelado y pendiente, y el descuento del gradiente.
const DAILY_FOLDER_ID = '1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh';
const FILE_NAME = 'embudo_b2b.json';
const ETAPAS = ['Cancelado', 'Pendiente', 'Reconocido', 'A reconocer'];
const CANALES = ['HTML', 'API'];
const PRODUCTOS = ['Hoteles', 'Vuelos', 'Paquetes', 'Otros'];
// RI de un mes según cuántos meses antes se vendió
const ORIGEN = [[0, 'Vendido ese mes'], [1, 'Vendido 1 mes antes'], [2, 'Vendido 2 meses antes'], [5, 'Vendido 3 a 5 meses antes'], [Infinity, 'Vendido 6 meses antes o más']];

// Medio de pago (payment_methods de channels_bo_product) -> grupo. Lo que no está acá va a "Otros"; vacío = "Sin dato".
const MEDIOS = {
  CREDIT_CARD: 'Tarjeta de crédito', 'REMOTE,CREDIT_CARD': 'Tarjeta de crédito', 'CASH,CREDIT_CARD': 'Tarjeta de crédito',
  'ON_SITE,CREDIT_CARD': 'Tarjeta de crédito', 'DEBIT_CARD,CREDIT_CARD': 'Tarjeta de crédito',
  DEBIT_CARD: 'Tarjeta de débito', CASH: 'Efectivo', BANK_DEPOSIT: 'Transferencia / depósito', WALLET: 'Billetera',
  DEFERRED: 'Pago diferido', DEFERRED_PAYMENT: 'Pago diferido',
  NATIVE_PROMISE_PAY: 'Reservá y pagá después', REMOTE: 'Pago remoto (link)',
  CURRENT_ACCOUNT: 'Cuenta corriente', 'OTHER,CURRENT_ACCOUNT': 'Cuenta corriente', AGENCY_ACCOUNT: 'Cuenta de agencia',
};
const medio = (raw) => (!raw ? 'Sin dato' : MEDIOS[raw] || 'Otros');
const MADURO_PCT = 5;
// Columnas de la cosecha: M0..M6 mes a mes, después M7-12 y M13+ (así la tabla entra sin scroll lateral)
const COS_COLS = [[0, 0, 'M0'], [1, 1, 'M1'], [2, 2, 'M2'], [3, 3, 'M3'], [4, 4, 'M4'], [5, 5, 'M5'], [6, 6, 'M6'], [7, 12, 'M7–12'], [13, Infinity, 'M13+']];
const cosCol = (lag) => COS_COLS.findIndex(([a, b]) => lag >= a && lag <= b);

const mesN = (ym) => +ym.slice(0, 4) * 12 + +ym.slice(5, 7);
const pct = (a, b) => (b ? a / b * 100 : null);

let CACHE = { key: null, data: null };
function loadData(fileStore) {
  const f = (fileStore && fileStore.findByName ? fileStore.findByName(DAILY_FOLDER_ID, FILE_NAME)[0] : null) || null;
  if (!f) throw new Error('No está embudo_b2b.json en el almacén (lo genera Daily_Dashboard/embudo_b2b_sync.py)');
  const key = `${f.meta.updatedAt}:${f.meta.sha256 || f.buf.length}`;
  if (CACHE.key === key) return CACHE.data;
  CACHE = { key, data: parse(JSON.parse(f.buf.toString('utf8'))) };
  return CACHE.data;
}

function table(t) {
  if (!t || !Array.isArray(t.cols) || !Array.isArray(t.rows)) throw new Error('embudo_b2b.json sin cols / rows');
  return t.rows.map((r) => { const o = {}; t.cols.forEach((c, i) => { o[c] = r[i]; }); return o; });
}

function parse(json) {
  const coh = table(json.cohortes), ri = table(json.ri);
  const cos = json.cosecha ? table(json.cosecha) : [], pag = json.pagos ? table(json.pagos) : [];
  const meses = [...new Set(coh.map((r) => r.mes_venta))].sort();
  const paises = [...new Set(coh.map((r) => r.pais).concat(ri.map((r) => r.pais)))].filter(Boolean).sort();
  return { coh, ri, cos, pag, meses, paises, hasta: json.hasta || '', desde: json.desde || '', actualizado: json.actualizado || '', memo: new Map() };
}

function filtro(q) {
  return (r) => (!q.pais || r.pais === q.pais) && (!q.canal || r.canal === q.canal) && (!q.producto || r.producto === q.producto);
}

function embudo(data, q) {
  const ok = filtro(q);
  const s = { vendido: 0, gd: 0 };
  ETAPAS.forEach((e) => { s[e] = 0; });
  data.coh.forEach((r) => {
    if (r.mes_venta < q.desde || r.mes_venta > q.hasta || !ok(r)) return;
    s.vendido += r.gb_bruto; s.gd += r.gb_gd; s[r.etapa] += r.gb_bruto;
  });
  const conf = s.Reconocido + s['A reconocer'];
  const fila = (k, lbl, v) => ({ k, lbl, gb: v, pct: pct(v, s.vendido) });
  return [
    fila('vendido', 'Vendido', s.vendido),
    fila('cancelado', 'Cancelado', s.Cancelado),
    fila('pendiente', 'Pendiente de confirmar', s.Pendiente),
    fila('confirmado', 'Confirmado', conf),
    fila('reconocido', 'Ya reconocido (RI)', s.Reconocido),
    fila('a_reconocer', 'A reconocer (viaja después)', s['A reconocer']),
    fila('gd', 'GD del Daily', s.gd),
  ];
}

function puente(data, q) {
  const ok = filtro(q), mes = q.mes;
  const v = { vendido: 0, gd: 0, ri: 0 };
  ETAPAS.forEach((e) => { v[e] = 0; });
  data.coh.forEach((r) => {
    if (r.mes_venta !== mes || !ok(r)) return;
    v.vendido += r.gb_bruto; v.gd += r.gb_gd; v[r.etapa] += r.gb_bruto;
  });
  const origen = ORIGEN.map(([, lbl]) => ({ lbl, gb: 0 }));
  data.ri.forEach((r) => {
    if (r.mes_ri !== mes || !ok(r)) return;
    v.ri += r.gb_ri;
    const d = r.mes_venta ? mesN(mes) - mesN(r.mes_venta) : Infinity;
    const i = ORIGEN.findIndex(([max]) => d <= max);
    origen[i < 0 ? ORIGEN.length - 1 : i].gb += r.gb_ri;
  });
  origen.forEach((o) => { o.pct = pct(o.gb, v.ri); });
  return {
    mes, vendido: v.vendido, gd: v.gd, ri: v.ri, riVsGd: v.gd ? (v.ri / v.gd - 1) * 100 : null,
    vendidoPor: ETAPAS.map((e) => ({ lbl: e, gb: v[e], pct: pct(v[e], v.vendido) })),
    origen,
  };
}

function paises(data, q) {
  const ok = filtro({ canal: q.canal, producto: q.producto }), g = new Map();
  const get = (k) => {
    let a = g.get(k);
    if (!a) g.set(k, (a = { pais: k, vendido: 0, canc: 0, pend: 0, rec: 0, fut: 0, gd: 0, ri: 0 }));
    return a;
  };
  data.coh.forEach((r) => {
    if (r.mes_venta < q.desde || r.mes_venta > q.hasta || !ok(r)) return;
    [get(r.pais), get('Total')].forEach((a) => {
      a.vendido += r.gb_bruto; a.gd += r.gb_gd;
      if (r.etapa === 'Cancelado') a.canc += r.gb_bruto;
      else if (r.etapa === 'Pendiente') a.pend += r.gb_bruto;
      else if (r.etapa === 'Reconocido') a.rec += r.gb_bruto;
      else a.fut += r.gb_bruto;
    });
  });
  data.ri.forEach((r) => {
    if (r.mes_ri < q.desde || r.mes_ri > q.hasta || !ok(r)) return;
    get(r.pais).ri += r.gb_ri; get('Total').ri += r.gb_ri;
  });
  return [...g.values()].filter((a) => a.vendido > 0 || a.ri > 0)
    .sort((a, b) => (a.pais === 'Total') - (b.pais === 'Total') || b.vendido - a.vendido)
    .map((a) => ({
      pais: a.pais, vendido: a.vendido, canc: pct(a.canc, a.vendido), pend: pct(a.pend, a.vendido),
      rec: a.rec, fut: a.fut, gd: a.gd, ri: a.ri, riVsGd: a.gd ? (a.ri / a.gd - 1) * 100 : null,
    }));
}

function gradiente(data, q) {
  const ok = filtro(q), g = new Map();
  data.coh.forEach((r) => {
    if (!ok(r)) return;
    let a = g.get(r.mes_venta);
    if (!a) g.set(r.mes_venta, (a = { mes: r.mes_venta, vendido: 0, gd: 0, canc: 0, pend: 0, fut: 0 }));
    a.vendido += r.gb_bruto; a.gd += r.gb_gd;
    if (r.etapa === 'Cancelado') a.canc += r.gb_bruto;
    else if (r.etapa === 'Pendiente') a.pend += r.gb_bruto;
    else if (r.etapa === 'A reconocer') a.fut += r.gb_bruto;
  });
  const rows = [...g.values()].filter((a) => a.vendido > 0).sort((a, b) => a.mes.localeCompare(b.mes)).map((a) => {
    const cancGrad = a.vendido - a.gd, abierto = pct(a.pend + a.fut, a.vendido);
    return {
      mes: a.mes, vendido: a.vendido, gd: a.gd, canc: a.canc, cancGrad, dif: a.canc - cancGrad,
      pctCanc: pct(a.canc, a.vendido), pctGrad: pct(cancGrad, a.vendido), abierto, madura: abierto != null && abierto <= MADURO_PCT,
    };
  });
  const m = rows.filter((r) => r.madura);
  const sum = (k) => m.reduce((s, r) => s + r[k], 0);
  const vend = sum('vendido'), canc = sum('canc'), cg = sum('cancGrad');
  return {
    maduroPct: MADURO_PCT, rows,
    maduros: m.length ? { desde: m[0].mes, hasta: m[m.length - 1].mes, meses: m.length, vendido: vend, canc, cancGrad: cg, dif: canc - cg,
      pctCanc: pct(canc, vend), pctGrad: pct(cg, vend) } : null,
  };
}

function cosecha(data, q) {
  const ok = filtro(q), corte = mesN((data.hasta || '').slice(0, 7) || '9999-12'), g = new Map();
  data.cos.forEach((r) => {
    if (r.mes_venta < q.desde || r.mes_venta > q.hasta || !ok(r)) return;
    let a = g.get(r.mes_venta);
    if (!a) g.set(r.mes_venta, (a = { mes: r.mes_venta, total: 0, sinFecha: 0, cells: new Array(COS_COLS.length).fill(0), lagSum: 0 }));
    a.total += r.gb_bruto;
    if (!r.mes_ri) { a.sinFecha += r.gb_bruto; return; }
    const lag = Math.max(0, mesN(r.mes_ri) - mesN(r.mes_venta));
    a.cells[cosCol(lag)] += r.gb_bruto;
    a.lagSum += lag * r.gb_bruto;
  });
  const tot = { total: 0, cells: new Array(COS_COLS.length).fill(0), lagSum: 0, conFecha: 0 };
  const rows = [...g.values()].sort((a, b) => a.mes.localeCompare(b.mes)).map((a) => {
    const conFecha = a.total - a.sinFecha;
    let acum = 0;
    const cells = a.cells.map((v, i) => {
      acum += v;
      tot.cells[i] += v;
      return { gb: v, pct: pct(v, a.total), acum: pct(acum, a.total), futuro: mesN(a.mes) + COS_COLS[i][0] > corte };
    });
    tot.total += a.total; tot.lagSum += a.lagSum; tot.conFecha += conFecha;
    return { mes: a.mes, total: a.total, cells, mesesProm: conFecha ? a.lagSum / conFecha : null, sinFecha: a.sinFecha };
  });
  let acum = 0;
  const total = { total: tot.total, mesesProm: tot.conFecha ? tot.lagSum / tot.conFecha : null,
    cells: tot.cells.map((v) => { acum += v; return { gb: v, pct: pct(v, tot.total), acum: pct(acum, tot.total) }; }) };
  return { lags: COS_COLS.map((c) => c[2]), rows, total };
}

function pagos(data, q) {
  if (q.canal === 'API') return { aplica: false, rows: [] };
  const ok = (r) => (!q.pais || r.pais === q.pais) && (!q.producto || r.producto === q.producto);
  const g = new Map();
  const get = (k) => {
    let a = g.get(k);
    if (!a) g.set(k, (a = { medio: k, vendido: 0, canc: 0, pend: 0, gd: 0, codigos: new Set() }));
    return a;
  };
  data.pag.forEach((r) => {
    if (r.mes_venta < q.desde || r.mes_venta > q.hasta || !ok(r)) return;
    [get(medio(r.medio)), get('Total HTML')].forEach((a, i) => {
      a.vendido += r.gb_bruto; a.gd += r.gb_gd;
      if (r.estado === 'Cancelado') a.canc += r.gb_bruto;
      else if (r.estado === 'Pendiente') a.pend += r.gb_bruto;
      if (i === 0 && r.medio) a.codigos.add(r.medio);
    });
  });
  const tv = g.get('Total HTML'), totV = tv ? tv.vendido : 0, totC = tv ? tv.canc : 0;
  const rows = [...g.values()].filter((a) => a.vendido > 0)
    .sort((a, b) => (a.medio === 'Total HTML') - (b.medio === 'Total HTML') || b.vendido - a.vendido)
    .map((a) => {
      const pc = pct(a.canc, a.vendido), pg = pct(a.vendido - a.gd, a.vendido);
      return { medio: a.medio, codigos: [...a.codigos].sort(), vendido: a.vendido, share: pct(a.vendido, totV), canc: a.canc, pctCanc: pc,
        shareCanc: pct(a.canc, totC), pctPend: pct(a.pend, a.vendido), gd: a.gd, pctGrad: pg, difPp: pc != null && pg != null ? pc - pg : null };
    });
  return { aplica: true, rows };
}

// Período por defecto: año fiscal (abril) a la fecha; mes del puente: el último mes cerrado.
function defaults(data) {
  const last = data.meses[data.meses.length - 1] || '';
  const y = +last.slice(0, 4), m = +last.slice(5, 7);
  const fy = m >= 4 ? `${y}-04` : `${y - 1}-04`;
  const cerrado = data.hasta && data.hasta.slice(0, 7) === last && !finDeMes(data.hasta) ? data.meses[data.meses.length - 2] || last : last;
  return { desde: data.meses.includes(fy) ? fy : data.meses[0] || '', hasta: last, mes: cerrado };
}
function finDeMes(ds) {
  const d = new Date(ds + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getUTCDate() === 1;
}

function embudoApi(fileStore, params) {
  const data = loadData(fileStore);
  const def = defaults(data);
  const pick = (k, list) => { const v = params.get(k) || ''; return list.includes(v) ? v : ''; };
  const q = {
    pais: pick('pais', data.paises), canal: pick('canal', CANALES), producto: pick('producto', PRODUCTOS),
    desde: pick('desde', data.meses) || def.desde, hasta: pick('hasta', data.meses) || def.hasta, mes: pick('mes', data.meses) || def.mes,
  };
  if (q.desde > q.hasta) [q.desde, q.hasta] = [q.hasta, q.desde];
  const key = JSON.stringify(q);
  if (data.memo.has(key)) return data.memo.get(key);
  const out = {
    q, hasta: data.hasta, actualizado: data.actualizado, desdeDatos: data.desde,
    options: { paises: data.paises, canales: CANALES, productos: PRODUCTOS, meses: data.meses },
    embudo: embudo(data, q), gradiente: gradiente(data, q), cosecha: cosecha(data, q), puente: puente(data, q), paises: paises(data, q),
    pagos: pagos(data, q),
  };
  if (data.memo.size > 200) data.memo.clear();
  data.memo.set(key, out);
  return out;
}

module.exports = { embudoApi, loadData, parse, embudo, gradiente, cosecha, pagos, medio, puente, paises, defaults, DAILY_FOLDER_ID, FILE_NAME, _reset: () => { CACHE = { key: null, data: null }; } };
