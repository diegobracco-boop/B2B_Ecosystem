// "B2B2C Tracker" (2026-11-10, Diego): visual completa de las WLs, con funnel de tráfico y tracking gestional semanal y mensual.
// Por ahora compara contra el año pasado (YoY) y contra la tendencia: la semana contra el promedio de las 4 anteriores y el mes
// contra el promedio de los 3 anteriores. Toda la cuenta vive acá; la página (server/b2b2c-tracker-page.js) solo dibuja.
//
// Fuentes (las dos en la carpeta del Daily, las publica "Actualizar reales"):
//   - b2b2c_tracker.json  : funnel de tráfico semanal (Daily_Dashboard/b2b2c_tracker_sync.py, data.analytics.b2b_partners_agg_weekly_traffic).
//                           Semana ISO; una semana que cae en dos meses viene partida por mes, así que el mensual es la suma por mes.
//   - daily_b2b2c_data.json: resultados gestionales (orders, GB, NR, FVM) diarios, actuals + actuals_ly, nominales (sin Organic).
//
// Reglas:
//   - Semanas con tráfico incompleto: la tabla de tráfico tiene semanas con días sin cargar (p.ej. 2025-41 a 2025-47). Si en un
//     período los bookings del tráfico (total, sin filtros) quedan por debajo de MIN_RATIO de las orders del Daily, el tráfico de
//     ese período se marca incompleto y queda fuera del YoY y de la tendencia (los resultados del Daily no se tocan).
//   - Período en curso (semana o mes sin cerrar): los resultados se comparan a igualdad de días (el LY y la tendencia cortan en el
//     mismo día de la semana / del mes). El tráfico no tiene apertura diaria: en el período en curso queda sin YoY ni tendencia.
//   - Plataforma solo existe en el tráfico: filtrar por plataforma no cambia los resultados.
//   - País y región del tráfico = país de navegación; en el Daily, el país del partner. Coinciden en casi todo.
//   - Hueco del Daily: actuals_ly llega hasta meta.ly_to y actuals arranca en meta.actuals_from (hoy falta dic-25 día a día). Ese
//     tramo viene solo como total mensual en actuals_ly_fy_rest: entra en el mensual; en el semanal, las semanas que lo tocan
//     quedan sin resultados (null, no cero) y no se usan para marcar tráfico incompleto ni para tendencias.
const fs = require('fs');
const path = require('path');
const DAILY_FOLDER_ID = '1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh';
const TRAFFIC_FILE = 'b2b2c_tracker.json';
const DAILY_FILE = 'daily_b2b2c_data.json';

const SITES = {
  AR: ['Argentina', 'HISPA'], BR: ['Brasil', 'BR'], MX: ['Mexico', 'MX/US'], US: ['USA', 'MX/US'], CL: ['Chile', 'HISPA'],
  CO: ['Colombia', 'HISPA'], PE: ['Peru', 'HISPA'], UY: ['Uruguay', 'HISPA'], EC: ['Ecuador', 'HISPA'], PA: ['Panama', 'HISPA'],
};
const REGIONS = [['BR', 'Brasil'], ['MX/US', 'MX/US'], ['HISPA', 'Hispa']];
const DAILY_PROD = {
  Flights: 'Vuelos', 'Packages General': 'Paquetes', Escapadas: 'Paquetes', Hotels: 'Hoteles', 'Dest. Serv.': 'Servicios en destino',
  Cars: 'Autos', Insurance: 'Asistencia', 'Vacation Rentals': 'Alquileres',
};
const PRODS = ['Vuelos', 'Paquetes', 'Hoteles', 'Servicios en destino', 'Autos', 'Asistencia', 'Alquileres', 'Otros'];
const GRAN = { w: { trendN: 4, minRatio: 0.7, hist: 2 }, m: { trendN: 3, minRatio: 0.85, hist: 2 } };
const DIMS = ['region', 'pais', 'partner', 'prod', 'plat'];
const NT = 6, NR = 4;   // tráfico: usuarios, búsqueda, detalle, PI, checkout, bookings · resultados: orders, GB, NR, FVM
const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const pad = (n) => String(n).padStart(2, '0');

// Semana ISO (lunes a domingo) de una fecha 'YYYY-MM-DD' → 'YYYY-WW', como event_year_week de la tabla de tráfico.
function isoWeek(ds) {
  const t = new Date(ds + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);   // jueves de esa semana
  const y = t.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4));
  return y + '-' + pad(1 + Math.round(((t - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7));
}
// Lunes de una semana ISO 'YYYY-WW' → 'YYYY-MM-DD'
function weekStart(yw) {
  const y = +yw.slice(0, 4), w = +yw.slice(5, 7), jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 864e5 + (w - 1) * 7 * 864e5);
  return mon.toISOString().slice(0, 10);
}
const shiftDay = (ds, n) => { const t = new Date(ds + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const day1 = (ds) => shiftDay(ds, 1), dayBefore = (ds) => shiftDay(ds, -1);
const weekday = (ds) => (new Date(ds + 'T00:00:00Z').getUTCDay() + 6) % 7;   // 0 = lunes
const lyKey = (k) => (+k.slice(0, 4) - 1) + k.slice(4);
function label(k, gran) {
  if (gran === 'm') return MES[+k.slice(5, 7) - 1] + '-' + k.slice(2, 4);
  const d = weekStart(k);
  return 'S' + k.slice(5, 7) + ' · ' + d.slice(8, 10) + '/' + d.slice(5, 7);
}

function rowsOf(block) {
  if (!block) return [];
  if (Array.isArray(block)) return block;
  const c = block.cols || [];
  return (block.rows || []).map((r) => Object.fromEntries(c.map((n, i) => [n, r[i]])));
}

// ── Carga (se parsea una vez por versión de los archivos) ───────────────────────────────────────
function parseTraffic(json) {
  const D = json.dims || {}, C = json.cols || [], ix = (n) => C.indexOf(n);
  const iW = ix('yw'), iA = ix('anio'), iM = ix('mes'), iP = ix('partner'), iS = ix('site'), iPl = ix('plataforma'), iPr = ix('producto');
  const iV = ['usuarios', 'search', 'detail', 'pi', 'checkout', 'bookings'].map(ix);
  const out = [];
  for (const r of json.rows || []) {
    const site = (D.site || [])[r[iS]], s = SITES[site];
    if (!s) continue;
    out.push({ w: r[iW], m: r[iA] + '-' + pad(r[iM]), partner: (D.partner || [])[r[iP]] || 'Otros', pais: s[0], region: s[1],
      plat: (D.plataforma || [])[r[iPl]] || '(Sin dato)', prod: (D.producto || [])[r[iPr]] || 'Otros', v: iV.map((i) => +r[i] || 0) });
  }
  return out;
}

function parseDaily(json) {
  const meta = json.meta || {}, from = meta.actuals_from || '9999', dcache = new Map(), out = [];
  const add = (r) => {
    let d = dcache.get(r.fecha);
    if (!d) { d = { w: isoWeek(r.fecha), m: r.fecha.slice(0, 7), wd: weekday(r.fecha), dom: +r.fecha.slice(8, 10) }; dcache.set(r.fecha, d); }
    out.push({ d, partner: r.partner || 'Otros', pais: r.pais || 'Other Countries', region: r.region === 'SAM' ? 'HISPA' : (r.region || 'HISPA'),
      prod: DAILY_PROD[r.productooriginal] || 'Otros', v: [+r.orders || 0, +r.gross_bookings || 0, +r.net_revenues || 0, +r.fvm || 0] });
  };
  rowsOf(json.actuals).forEach(add);
  rowsOf(json.actuals_ly).forEach((r) => { if (r.fecha < from) add(r); });   // actuals_ly no pisa lo que ya trae actuals
  // Hueco entre actuals_ly y actuals: sin días; el mes completo viene en actuals_ly_fy_rest (fecha = día 1 del mes)
  const gapFrom = meta.ly_to ? day1(meta.ly_to) : null, gapTo = from !== '9999' ? dayBefore(from) : null;
  if (gapFrom && gapTo && gapFrom <= gapTo) {
    rowsOf(json.actuals_ly_fy_rest).forEach((r) => {
      if (!r.fecha || r.fecha < gapFrom || r.fecha > gapTo) return;
      out.push({ d: { w: null, m: r.fecha.slice(0, 7), wd: null, dom: null, monthly: true }, partner: r.partner || 'Otros', pais: r.pais || 'Other Countries',
        region: r.region === 'SAM' ? 'HISPA' : (r.region || 'HISPA'), prod: DAILY_PROD[r.productooriginal] || 'Otros',
        v: [+r.orders || 0, +r.gross_bookings || 0, +r.net_revenues || 0, +r.fvm || 0] });
    });
  }
  const dir = {};
  const db = Array.isArray(json.director_by_partner) ? json.director_by_partner[0] : json.director_by_partner;
  Object.entries(db || {}).forEach(([k, v]) => { dir[String(k).toLowerCase()] = v; });
  return { rows: out, last: meta.last_actuals_date || '', gap: gapFrom && gapTo && gapFrom <= gapTo ? [gapFrom, gapTo] : null, director: dir };
}

let CACHE = { key: null, data: null };
function loadData(fileStore) {
  const pick = (n) => (fileStore && fileStore.findByName ? fileStore.findByName(DAILY_FOLDER_ID, n)[0] : null) || null;
  const tf = pick(TRAFFIC_FILE), df = pick(DAILY_FILE);
  const ver = (f) => (f ? `${f.meta.updatedAt}:${f.meta.sha256 || f.buf.length}` : '-');
  const key = ver(tf) + '|' + ver(df);
  if (CACHE.key === key) return CACHE.data;
  if (!df) throw new Error('No está daily_b2b2c_data.json en el almacén');
  const traffic = tf ? JSON.parse(tf.buf.toString('utf8')) : null;
  const daily = parseDaily(JSON.parse(df.buf.toString('utf8')));
  const data = { traffic: traffic ? parseTraffic(traffic) : [], trafficUpdated: traffic ? traffic.actualizado : null,
    trafficTo: traffic ? traffic.hasta : null, daily: daily.rows, last: daily.last, gap: daily.gap, director: daily.director, memo: new Map() };
  data.options = buildOptions(data);
  CACHE = { key, data };
  return data;
}

function buildOptions(data) {
  const rank = (field, src) => { const o = new Map(); src.forEach((r) => o.set(r[field], (o.get(r[field]) || 0) + (r.v[0] || 0))); return o; };
  const ordP = rank('partner', data.daily), trP = rank('partner', data.traffic);
  const partners = [...new Set([...ordP.keys(), ...trP.keys()])].filter((p) => p !== 'Otros')
    .sort((a, b) => (ordP.get(b) || 0) - (ordP.get(a) || 0) || (trP.get(b) || 0) - (trP.get(a) || 0) || a.localeCompare(b));
  const ordC = rank('pais', data.daily);
  const paises = [...new Set([...ordC.keys(), ...data.traffic.map((r) => r.pais)])].sort((a, b) => (ordC.get(b) || 0) - (ordC.get(a) || 0) || a.localeCompare(b));
  const plats = [...new Set(data.traffic.map((r) => r.plat))].sort();
  return { region: REGIONS.map(([v, l]) => ({ v, l })), pais: paises.map((v) => ({ v, l: v })), partner: partners.concat('Otros').map((v) => ({ v, l: v })),
    prod: PRODS.map((v) => ({ v, l: v })), plat: plats.map((v) => ({ v, l: v })) };
}

// ── Agregado ────────────────────────────────────────────────────────────────────────────────────
function cleanFilters(q) {
  const f = {};
  DIMS.forEach((d) => { const v = q && q[d]; if (typeof v === 'string' && v && v.length < 120) f[d] = v; });
  return f;
}
const matchT = (r, f) => DIMS.every((d) => !f[d] || r[d] === f[d]);
const matchR = (r, f) => DIMS.every((d) => d === 'plat' || !f[d] || r[d] === f[d]);

// Suma por período (y opcionalmente por una dimensión). rc = resultados cortados en el día del último dato (para comparar el
// período en curso a igualdad de días). keep(k) acota los períodos que se suman.
function aggregate(data, f, gran, dim, keep) {
  const g = new Map(), cutWd = weekday(data.last), cutDom = +data.last.slice(8, 10);
  const acc = (dv, k) => {
    let byK = g.get(dv);
    if (!byK) g.set(dv, byK = new Map());
    let a = byK.get(k);
    if (!a) byK.set(k, a = { t: new Array(NT).fill(0), r: new Array(NR).fill(0), rc: new Array(NR).fill(0), hasT: false });
    return a;
  };
  for (const r of data.traffic) {
    if (!matchT(r, f)) continue;
    const k = gran === 'm' ? r.m : r.w;
    if (keep && !keep(k)) continue;
    const a = acc(dim ? r[dim] : '_', k);
    for (let i = 0; i < NT; i++) a.t[i] += r.v[i];
    a.hasT = true;
  }
  if (dim !== 'plat') {
    for (const r of data.daily) {
      if (!matchR(r, f)) continue;
      if (r.d.monthly && gran !== 'm') continue;
      const k = gran === 'm' ? r.d.m : r.d.w;
      if (keep && !keep(k)) continue;
      const a = acc(dim ? r[dim] : '_', k), cut = !r.d.monthly && (gran === 'm' ? r.d.dom <= cutDom : r.d.wd <= cutWd);
      for (let i = 0; i < NR; i++) { a.r[i] += r.v[i]; if (cut) a.rc[i] += r.v[i]; }
    }
  }
  return g;
}

// Períodos ordenados, período en curso y calidad del tráfico (sobre el total, sin filtros: los huecos de carga afectan a todo).
function frame(data, gran) {
  const memoKey = 'frame:' + gran;
  if (data.memo.has(memoKey)) return data.memo.get(memoKey);
  const tot = aggregate(data, {}, gran).get('_') || new Map();
  const curK = gran === 'm' ? data.last.slice(0, 7) : isoWeek(data.last);
  const endOfPeriod = gran === 'm'
    ? data.last.slice(8, 10) === pad(new Date(Date.UTC(+data.last.slice(0, 4), +data.last.slice(5, 7), 0)).getUTCDate())
    : weekday(data.last) === 6;
  const partialKey = endOfPeriod ? null : curK;
  const keys = [...tot.keys()].filter((k) => k <= curK).sort();
  const minRatio = GRAN[gran].minRatio, flag = {}, noR = {}, noRc = {}, gap = data.gap;
  keys.forEach((k) => {
    const from = gran === 'm' ? k + '-01' : weekStart(k), to = gran === 'm' ? dayBefore(shiftDay(k + '-01', 32).slice(0, 8) + '01') : shiftDay(weekStart(k), 6);
    const inGap = !!gap && from <= gap[1] && to >= gap[0];
    noRc[k] = inGap;
    noR[k] = inGap && (gran !== 'm' || !(tot.get(k).r[0] > 0));   // en el mensual el hueco se cubre con el total del mes
    const a = tot.get(k);
    flag[k] = k === partialKey || !a.hasT || (noR[k] ? false : (!(a.r[0] > 0) || a.t[5] / a.r[0] < minRatio));
  });
  const out = { keys, partialKey, flag, noR, noRc, ratio: Object.fromEntries(keys.map((k) => { const a = tot.get(k); return [k, a.r[0] && !noR[k] ? a.t[5] / a.r[0] : null]; })) };
  data.memo.set(memoKey, out);
  return out;
}

// Valores de un período k a partir del agregado byK: actual, LY y tendencia (promedio de los N anteriores componente a componente:
// las conversiones que arma la página quedan como cociente de promedios = cociente de sumas).
function point(byK, fr, k, gran) {
  const N = GRAN[gran].trendN, partial = k === fr.partialKey, bad = !!fr.flag[k];   // bad: incompleto o en curso
  const a = byK.get(k), ly = byK.get(lyKey(k));
  const pos = fr.keys.indexOf(k), prev = fr.keys.slice(Math.max(0, pos - N), pos);
  const avg = (arrs) => (arrs.length ? arrs[0].map((_, i) => arrs.reduce((s, x) => s + x[i], 0) / arrs.length) : null);
  const trT = prev.filter((p) => !fr.flag[p]).map((p) => (byK.get(p) || { t: new Array(NT).fill(0) }).t);
  const rOf = (key, cut) => { if (!key || fr.noR[key] || (cut && fr.noRc[key])) return null; const b = byK.get(key); return b ? (cut ? b.rc : b.r) : new Array(NR).fill(0); };
  const trR = prev.map((p) => rOf(p, partial));
  const lyIn = fr.keys.includes(lyKey(k)), lyBad = lyIn && !!fr.flag[lyKey(k)];
  const pk = pos > 0 ? fr.keys[pos - 1] : null, pb = pk ? byK.get(pk) : null;   // período anterior (semana / mes)
  return {
    k, lbl: label(k, gran), partial, flag: bad && !partial, ratio: fr.ratio[k],
    cur: { t: a && a.hasT ? a.t : null, r: a && !fr.noR[k] ? a.r : null },
    // Tráfico: sin YoY ni tendencia si este período o el del año pasado están incompletos (o el período está en curso)
    ly: { t: !bad && lyIn && !lyBad && ly && ly.hasT ? ly.t : null, r: lyIn && ly && !fr.noR[k] ? rOf(lyKey(k), partial) : null, flag: lyBad },
    tr: { t: !bad && trT.length >= Math.ceil(N / 2) ? avg(trT) : null, r: prev.length === N && !fr.noR[k] && trR.every(Boolean) ? avg(trR) : null },
    // vs período anterior; en curso, cortado al mismo día (rc)
    pv: { t: !bad && pk && !fr.flag[pk] && pb && pb.hasT ? pb.t : null, r: pb && !fr.noR[k] ? rOf(pk, partial) : null },
  };
}

// ── Acumulado del año fiscal (abril → hoy) ──────────────────────────────────────────────────────
// Resultados: del 1-abr hasta el último dato, contra el mismo tramo del año pasado (el mes en curso cortado al mismo día).
// Tráfico: solo los meses CERRADOS (no tiene apertura diaria para cortar el mes en curso); sin YoY si algún mes, de este año o
// del pasado, tiene el tráfico incompleto.
const MES_L = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fyMonths(fr, last) {
  const y = +last.slice(0, 4), m = +last.slice(5, 7), y0 = m >= 4 ? y : y - 1, fy0 = y0 + '-04', cur = last.slice(0, 7);
  return { fy: 'FY' + pad((y0 + 1) % 100), keys: fr.keys.filter((k) => k >= fy0 && k <= cur) };
}
function ytdPoint(byKm, frm, last) {
  const { fy, keys } = fyMonths(frm, last);
  const z = (n) => new Array(n).fill(0);
  const add = (a, b) => { if (b) for (let i = 0; i < a.length; i++) a[i] += b[i]; };
  const closed = keys.filter((k) => k !== frm.partialKey);
  const cur = { t: z(NT), r: z(NR) }, ly = { t: z(NT), r: z(NR) };
  let hasT = false, hasR = false, lyHasR = false;
  keys.forEach((k) => {
    const a = byKm.get(k), b = byKm.get(lyKey(k)), open = k === frm.partialKey;
    if (a) { add(cur.r, a.r); hasR = true; if (!open && a.hasT) { add(cur.t, a.t); hasT = true; } }
    if (b) { if (!(open && frm.noRc[lyKey(k)])) { add(ly.r, open ? b.rc : b.r); lyHasR = true; } if (!open) add(ly.t, b.t); }
  });
  const bad = closed.some((k) => frm.flag[k]);
  const lyBad = closed.some((k) => !frm.keys.includes(lyKey(k)) || frm.flag[lyKey(k)]);
  const first = keys[0];
  return {
    k: 'ytd', lbl: 'Acumulado ' + fy + ' (' + (first ? MES_L[+first.slice(5, 7) - 1] : 'abr') + '–hoy)', ytd: true, partial: false, flag: bad, ratio: null,
    trafficTo: closed.length ? closed[closed.length - 1] : null,
    cur: { t: hasT ? cur.t : null, r: hasR ? cur.r : null },
    ly: { t: hasT && !bad && !lyBad ? ly.t : null, r: lyHasR ? ly.r : null, flag: lyBad },
    tr: { t: null, r: null }, pv: { t: null, r: null },
  };
}

// Serie del evolutivo + opciones de filtros. gran: 'w' | 'm'.
function series(data, q, gran) {
  gran = gran === 'm' ? 'm' : 'w';
  const f = cleanFilters(q), fr = frame(data, gran);
  const y0 = +(fr.keys[fr.keys.length - 1] || '0000').slice(0, 4) - (GRAN[gran].hist - 1);
  const byK = aggregate(data, f, gran).get('_') || new Map();
  const shown = fr.keys.filter((k) => +k.slice(0, 4) >= y0);
  const closed = shown.filter((k) => k !== fr.partialKey);
  return {
    gran, filters: f, last: data.last, trafficTo: data.trafficTo, trafficUpdated: data.trafficUpdated, partialKey: fr.partialKey,
    defaultKey: closed[closed.length - 1] || shown[shown.length - 1] || null, trendN: GRAN[gran].trendN, minRatio: GRAN[gran].minRatio,
    periods: shown.map((k) => point(byK, fr, k, gran)), options: data.options,
    ytd: ytdPoint(gran === 'm' ? byK : (aggregate(data, f, 'm').get('_') || new Map()), frame(data, 'm'), data.last),
  };
}

// Apertura de un período por una dimensión (región, país, partner, producto o plataforma), con LY y tendencia por fila.
function breakdown(data, q, gran, k, dim) {
  gran = gran === 'm' ? 'm' : 'w';
  if (!DIMS.includes(dim)) dim = 'region';
  const f = cleanFilters(q), fr = frame(data, gran);
  const lbl = dim === 'region' ? Object.fromEntries(REGIONS) : {};
  const sortRows = (rows) => rows.filter((r) => (r.cur.r && r.cur.r.some((x) => x)) || (r.cur.t && r.cur.t.some((x) => x)))
    .sort((a, b) => (((b.cur.t || [])[1] || 0) - ((a.cur.t || [])[1] || 0)) || ((b.cur.r || [0])[0] - (a.cur.r || [0])[0]));
  if (k === 'ytd') {
    const frm = frame(data, 'm'), keys = fyMonths(frm, data.last).keys, need = new Set(keys.concat(keys.map(lyKey)));
    const g = aggregate(data, f, 'm', dim, (x) => need.has(x));
    const rows = sortRows([...g.entries()].map(([v, byK]) => Object.assign(ytdPoint(byK, frm, data.last), { key: v, lbl: lbl[v] || v })));
    return { gran, k, dim, lbl: ytdPoint(new Map(), frm, data.last).lbl, rows };
  }
  if (!fr.keys.includes(k)) k = fr.keys.filter((x) => x !== fr.partialKey).pop();
  const pos = fr.keys.indexOf(k), need = new Set([k, lyKey(k), ...fr.keys.slice(Math.max(0, pos - GRAN[gran].trendN), pos)]);
  const g = aggregate(data, f, gran, dim, (x) => need.has(x));
  const rows = sortRows([...g.entries()].map(([v, byK]) => ({ ...point(byK, fr, k, gran), key: v, lbl: lbl[v] || v })));
  return { gran, k, dim, lbl: label(k, gran), rows };
}

// Evolutivo por partner (sección Partners): los 7 partners con más búsquedas en la ventana + "Resto". El orden (y el color) sale
// del total de la ventana, no del período elegido, así que cambiar de período no repinta a nadie.
const TOP_EVO = 7;
function evoByPartner(data, q, gran) {
  gran = gran === 'm' ? 'm' : 'w';
  const f = cleanFilters(q), fr = frame(data, gran);
  const y0 = +(fr.keys[fr.keys.length - 1] || '0000').slice(0, 4) - (GRAN[gran].hist - 1);
  const keys = fr.keys.filter((k) => +k.slice(0, 4) >= y0), inK = new Set(keys);
  const g = aggregate(data, f, gran, 'partner', (k) => inK.has(k));
  const tot = [...g.entries()].map(([p, byK]) => {
    let s = 0, o = 0;
    byK.forEach((a) => { s += a.t[1]; o += a.r[0]; });
    return { p, s, o };
  }).filter((x) => x.p !== 'Otros' && (x.s || x.o)).sort((a, b) => b.s - a.s || b.o - a.o);
  const top = tot.slice(0, TOP_EVO).map((x) => x.p), topSet = new Set(top);
  const row = (name, list) => ({
    key: name,
    t: keys.map((k) => {
      let hit = false;
      const v = new Array(NT).fill(0);
      list.forEach((byK) => { const a = byK.get(k); if (a && a.hasT) { hit = true; for (let i = 0; i < NT; i++) v[i] += a.t[i]; } });
      return hit ? v : null;
    }),
    r: keys.map((k) => {
      if (fr.noR[k]) return null;
      const v = new Array(NR).fill(0);
      list.forEach((byK) => { const a = byK.get(k); if (a) for (let i = 0; i < NR; i++) v[i] += a.r[i]; });
      return v;
    }),
  });
  const rest = [...g.entries()].filter(([p]) => !topSet.has(p)).map(([, byK]) => byK);
  return {
    gran, keys, lbls: keys.map((k) => label(k, gran)), partialKey: fr.partialKey, flag: keys.map((k) => !!fr.flag[k] && k !== fr.partialKey),
    rows: top.map((p) => row(p, [g.get(p)])).concat(rest.length ? [row('Resto', rest)] : []),
  };
}

function memo(data, key, fn) {
  if (data.memo.has(key)) return data.memo.get(key);
  const v = fn();
  if (data.memo.size > 400) data.memo.clear();
  data.memo.set(key, v);
  return v;
}

// ── Moonshot 3x (2026-11-10, Diego: "¿con qué partner pensamos en triplicar el negocio?") ─────────────────────────────────────
// Tamaño de la cuenta = alcance × conversión × amplitud. Por partner × país (país del partner, como el Daily), en el acumulado del FY
// anualizado:
//   - Alcance: penetración = orders por año cada 1.000 clientes de la base (server/b2b2c-partner-bases.json, del Excel del equipo;
//     PROVISORIO). Realista: mediana de pares del mismo país e industria (tope 2x). Moonshot: p75 de la industria en la región
//     (tope 10x); "mejor" = el más penetrado de la industria, como referencia.
//     Las bases marcadas (tráfico, fuente distinta, redes de tarjetas) no se usan como referencia de nadie.
//   - Conversión por producto (búsqueda → booking): realista = mediana de pares del país, tope 2x la propia; moonshot = p75, tope 3x.
//   - Amplitud (cross-sell): share de orders por producto; realista = mediana de pares del país; moonshot = p75.
//   Multiplicador = alcance × (1 + (conversión + amplitud) / NR). Supuesto multiplicativo: es un techo, no un forecast.
//   Candidato a 3x: NR anual >= MOON_MIN_NR, multiplicador moonshot >= 3 y base sin marcas de calidad (si no, va "a validar").
const BASES_FILE = path.join(__dirname, 'b2b2c-partner-bases.json');
let BASES = { mtime: 0, data: null };
function loadBases() {
  try {
    const st = fs.statSync(BASES_FILE);
    if (st.mtimeMs !== BASES.mtime) BASES = { mtime: st.mtimeMs, data: JSON.parse(fs.readFileSync(BASES_FILE, 'utf8')) };
  } catch (e) { BASES = { mtime: 0, data: { rows: [] } }; }
  return BASES.data;
}
const MOON_MIN_NR = 500000, MOON_REACH_CAP = 10, MOON_CONV_CAP = 3;
const MOON_PRODS = ['Vuelos', 'Hoteles', 'Paquetes', 'Autos', 'Servicios en destino', 'Asistencia'];
const BAD_REF = new Set(['trafico', 'fuente_distinta', 'red_tarjetas']);
function quant(arr, q) {
  const a = arr.filter((v) => v != null && isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = (a.length - 1) * q, lo = Math.floor(i);
  return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo);
}
function moonshot(data) {
  const frm = frame(data, 'm'), { fy, keys } = fyMonths(frm, data.last), inFY = new Set(keys);
  const tKeys = new Set(keys.filter((k) => k !== frm.partialKey && !frm.flag[k]));   // tráfico: meses cerrados y completos
  const fy0 = keys[0] + '-01', days = Math.round((new Date(data.last + 'T00:00:00Z') - new Date(fy0 + 'T00:00:00Z')) / 864e5) + 1, ann = 365 / days;
  const P = new Map(), key = (p, c) => p + '|' + c;
  const get = (p, c) => { const k = key(p, c); let x = P.get(k); if (!x) P.set(k, x = { partner: p, pais: c, o: 0, nr: 0, fvm: 0, prod: {} }); return x; };
  const gp = (x, pr) => x.prod[pr] || (x.prod[pr] = { o: 0, nr: 0, s: 0, b: 0 });
  for (const r of data.daily) {
    if (r.partner === 'Otros' || !inFY.has(r.d.m)) continue;
    const x = get(r.partner, r.pais), q = gp(x, r.prod);
    x.o += r.v[0]; x.nr += r.v[2]; x.fvm += r.v[3]; q.o += r.v[0]; q.nr += r.v[2];
  }
  for (const r of data.traffic) {
    if (r.partner === 'Otros' || !tKeys.has(r.m)) continue;
    const x = P.get(key(r.partner, r.pais)); if (!x) continue;
    const q = gp(x, r.prod); q.s += r.v[1]; q.b += r.v[5];
  }
  const bases = new Map((loadBases().rows || []).map((b) => [key(b.partner.toLowerCase(), b.pais), b]));
  const list = [...P.values()].filter((x) => x.o * ann >= 500 && x.nr > 0).map((x) => {
    const b = bases.get(key(x.partner.toLowerCase(), x.pais)) || null;
    const pen = b && b.clientes > 0 ? x.o * ann / b.clientes * 1000 : null;
    return Object.assign(x, { base: b, pen, industria: b ? b.industria : null, ref: !!(b && pen != null && !(b.flags || []).some((f) => BAD_REF.has(f))) });
  });
  const rows = list.map((x) => {
    const peersC = list.filter((y) => y.pais === x.pais && y !== x);
    // Alcance
    let reachR = 1, reachM = 1, penPeer = null, penP75 = null, best = null;
    if (x.pen != null && x.pen > 0) {
      const refs = list.filter((y) => y !== x && y.ref && y.industria === x.industria);
      const same = refs.filter((y) => y.pais === x.pais);
      penPeer = quant((same.length >= 2 ? same : refs).map((y) => y.pen), 0.5);
      penP75 = quant(refs.map((y) => y.pen), 0.75);
      best = refs.reduce((a, y) => (!a || y.pen > a.pen ? y : a), null);
      if (penPeer) reachR = Math.min(2, Math.max(1, penPeer / x.pen));
      if (penP75) reachM = Math.min(MOON_REACH_CAP, Math.max(1, penP75 / x.pen));
    }
    // Conversión y amplitud por producto
    let convR = 0, convM = 0, xsR = 0, xsM = 0;
    MOON_PRODS.forEach((pr) => {
      const q = x.prod[pr] || { o: 0, nr: 0, s: 0, b: 0 };
      const nrpo = q.o >= 50 ? q.nr / q.o : quant(peersC.map((y) => (y.prod[pr] && y.prod[pr].o >= 50 ? y.prod[pr].nr / y.prod[pr].o : null)), 0.5);
      if (!nrpo || nrpo <= 0) return;
      const crs = peersC.map((y) => (y.prod[pr] && y.prod[pr].s >= 2000 ? y.prod[pr].b / y.prod[pr].s : null));
      if (q.s >= 2000 && q.b > 0) {
        const own = q.b / q.s, o2b = Math.min(1, q.o / q.b), c50 = quant(crs, 0.5), c75 = quant(crs, 0.75);
        if (c50) convR += q.s * Math.max(0, Math.min(c50, 2 * own) - own) * o2b * nrpo;
        if (c75) convM += q.s * Math.max(0, Math.min(c75, MOON_CONV_CAP * own) - own) * o2b * nrpo;
      }
      const shs = peersC.map((y) => (y.prod[pr] || { o: 0 }).o / y.o), sh = q.o / x.o;
      const s50 = quant(shs, 0.5), s75 = quant(shs, 0.75);
      if (s50) xsR += x.o * Math.max(0, s50 - sh) * nrpo;
      if (s75) xsM += x.o * Math.max(0, s75 - sh) * nrpo;
    });
    const nrA = x.nr * ann, multR = reachR * (1 + (convR + xsR) / x.nr), multM = reachM * (1 + (convM + xsM) / x.nr);
    const lev = [['alcance', Math.log(reachM)], ['conversión', Math.log(1 + convM / x.nr)], ['amplitud', Math.log(1 + xsM / x.nr)]].sort((a, b2) => b2[1] - a[1]);
    const prods = Object.entries(x.prod).filter(([k]) => k !== 'Otros').sort((a, b2) => b2[1].o - a[1].o);
    return {
      partner: x.partner, pais: x.pais, industria: x.industria || 'Sin base', director: data.director[x.partner.toLowerCase()] || null,
      nr: nrA, fvm: x.fvm * ann, orders: x.o * ann, clientes: x.base ? x.base.clientes : null, fuente: x.base ? x.base.fuente : null,
      flags: x.base ? x.base.flags || [] : ['sin_base'], pen: x.pen, penPeer, penP75, penBest: best ? best.pen : null, bestRef: best ? best.partner + ' ' + best.pais : null,
      reachR, reachM, convR: convR * ann, convM: convM * ann, xsR: xsR * ann, xsM: xsM * ann, multR, multM,
      potR: nrA * (multR - 1), potM: nrA * (multM - 1), lever: lev[0][1] > 0.01 ? lev[0][0] : null,
      topProd: prods.length ? prods[0][0] : null, topShare: prods.length ? prods[0][1].o / x.o : null,
    };
  }).map((r) => Object.assign(r, {
    validar: r.flags.some((f) => BAD_REF.has(f) || f === 'sin_base'),
    cand: r.nr >= MOON_MIN_NR && r.multM >= 3 && !r.flags.some((f) => BAD_REF.has(f) || f === 'sin_base'),
  })).sort((a, b) => b.potM - a.potM);
  const bd = loadBases();
  return { fy, from: fy0, to: data.last, days, rows, minNr: MOON_MIN_NR, reachCap: MOON_REACH_CAP, convCap: MOON_CONV_CAP, bases: { actualizado: bd.actualizado, fuente: bd.fuente, nota: bd.nota, n: (bd.rows || []).length } };
}

// Punto de entrada del servidor: ?gran=w|m&region=&pais=&partner=&prod=&plat=[&dim=&k=]
function trackerApi(fileStore, params) {
  const data = loadData(fileStore);
  const q = {};
  DIMS.forEach((d) => { q[d] = params.get(d) || ''; });
  const gran = params.get('gran') === 'm' ? 'm' : 'w';
  if (params.get('view') === 'moonshot') return memo(data, 'moonshot:' + BASES.mtime, () => moonshot(data));
  const dim = params.get('dim'), k = params.get('k'), evo = params.get('evo') === '1';
  const key = JSON.stringify([gran, q, dim, k, evo]);
  return memo(data, key, () => (evo ? evoByPartner(data, q, gran) : dim ? breakdown(data, q, gran, k, dim) : series(data, q, gran)));
}

module.exports = { trackerApi, moonshot, loadData, series, breakdown, isoWeek, weekStart, DAILY_FOLDER_ID, TRAFFIC_FILE, DAILY_FILE, _reset: () => { CACHE = { key: null, data: null }; } };
