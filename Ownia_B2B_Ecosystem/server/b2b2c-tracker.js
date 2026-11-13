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
const DAILY_FOLDER_ID = '1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh';
const TRAFFIC_FILE = 'b2b2c_tracker.json';
const DAILY_FILE = 'daily_b2b2c_data.json';
// Managerial (_actuals_gestional.json, el mismo archivo que el P&L Managerial, ver drive-manifest.json): perfil comercial de cada
// cuenta en la Cartera (canje, profit sharing, comisión % GB).
const MGR_FILE_ID = '1wvle0UIVZV7ocCSl8OawOfIGVz_It5kh';

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
// ruta (2026-11-12): Nacional / Internacional del tráfico (route_type). Como la plataforma, solo existe en el tráfico.
const DIMS = ['region', 'pais', 'partner', 'prod', 'plat', 'ruta'];
const T_ONLY = new Set(['plat', 'ruta']);
const RUTA_LBL = { NAC: 'Nacional', INT: 'Internacional' };
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
  const iW = ix('yw'), iA = ix('anio'), iM = ix('mes'), iP = ix('partner'), iS = ix('site'), iPl = ix('plataforma'), iPr = ix('producto'), iR = ix('ruta');
  const iV = ['usuarios', 'search', 'detail', 'pi', 'checkout', 'bookings'].map(ix);
  const out = [];
  for (const r of json.rows || []) {
    const site = (D.site || [])[r[iS]], s = SITES[site];
    if (!s) continue;
    out.push({ w: r[iW], m: r[iA] + '-' + pad(r[iM]), partner: (D.partner || [])[r[iP]] || 'Otros', pais: s[0], region: s[1],
      plat: (D.plataforma || [])[r[iPl]] || '(Sin dato)', prod: (D.producto || [])[r[iPr]] || 'Otros',
      ruta: iR >= 0 ? (D.ruta || [])[r[iR]] || '(Sin dato)' : '(Sin dato)', v: iV.map((i) => +r[i] || 0) });
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
  const mf = (fileStore && typeof fileStore.get === 'function' ? fileStore.get(MGR_FILE_ID) : null) || null;
  const ver = (f) => (f ? `${f.meta.updatedAt}:${f.meta.sha256 || f.buf.length}` : '-');
  const key = ver(tf) + '|' + ver(df) + '|' + ver(mf);
  if (CACHE.key === key) return CACHE.data;
  if (!df) throw new Error('No está daily_b2b2c_data.json en el almacén');
  const traffic = tf ? JSON.parse(tf.buf.toString('utf8')) : null;
  const daily = parseDaily(JSON.parse(df.buf.toString('utf8')));
  let mgr = null;
  try { mgr = mf ? parseMgr(JSON.parse(mf.buf.toString('utf8'))) : null; } catch (e) { mgr = null; }   // sin Managerial: la Cartera sale sin perfil comercial
  const data = { traffic: traffic ? parseTraffic(traffic) : [], trafficUpdated: traffic ? traffic.actualizado : null,
    trafficTo: traffic ? traffic.hasta : null, daily: daily.rows, last: daily.last, gap: daily.gap, director: daily.director, mgr, memo: new Map() };
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
  const rutas = ['NAC', 'INT', '(Sin dato)'].filter((v) => data.traffic.some((r) => r.ruta === v));
  // Partners por país (filtro Partner de la página de cada país): solo los que tienen orders o tráfico en ese país
  const byPais = {};
  data.daily.forEach((r) => { (byPais[r.pais] || (byPais[r.pais] = new Set())).add(r.partner); });
  data.traffic.forEach((r) => { (byPais[r.pais] || (byPais[r.pais] = new Set())).add(r.partner); });
  return { region: REGIONS.map(([v, l]) => ({ v, l })), pais: paises.map((v) => ({ v, l: v })), partner: partners.concat('Otros').map((v) => ({ v, l: v })),
    prod: PRODS.map((v) => ({ v, l: v })), plat: plats.map((v) => ({ v, l: v })), ruta: rutas.map((v) => ({ v, l: RUTA_LBL[v] || v })),
    partnerByPais: Object.fromEntries(Object.entries(byPais).map(([k, s]) => [k, partners.filter((p) => s.has(p))])) };
}

// ── Agregado ────────────────────────────────────────────────────────────────────────────────────
function cleanFilters(q) {
  const f = {};
  DIMS.forEach((d) => { const v = q && q[d]; if (typeof v === 'string' && v && v.length < 120) f[d] = v; });
  return f;
}
const matchT = (r, f) => DIMS.every((d) => !f[d] || r[d] === f[d]);
const matchR = (r, f) => DIMS.every((d) => T_ONLY.has(d) || !f[d] || r[d] === f[d]);

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
  if (!T_ONLY.has(dim)) {
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
  const lbl = dim === 'region' ? Object.fromEntries(REGIONS) : dim === 'ruta' ? RUTA_LBL : {};
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

// ── Managerial: perfil comercial de cada cuenta (partner × país) ────────────────────────────────────────────────────────────
// Del _actuals_gestional.json (meses cerrados del FY): GB, white_labels_api (comisión del partner: revenue sharing y, en los tres
// partners con acuerdo, el profit sharing) y GB pagado con millas / puntos (ac_mi, "Con millas"). Filas [pais, partner, produto, ym, v...].
const PS_PARTNERS = { 'banco de chile': 'Chile', turismocity: 'Argentina', 'viajes naranja': 'Argentina' };
const PAIS_MGR = { Globales: 'Other Countries' };
function parseMgr(json) {
  const mets = json.metrics || [], iGb = mets.indexOf('gross_bookings'), iWl = mets.indexOf('white_labels_api'), iO = mets.indexOf('orders');
  const b = (json.b2b2c || {}), out = new Map(), months = new Set();
  if (iGb < 0 || iWl < 0) return null;
  const get = (r) => {
    const pais = PAIS_MGR[r[0]] || r[0], k = String(r[1]).toLowerCase() + '|' + pais;
    let x = out.get(k);
    if (!x) out.set(k, x = { gb: 0, wl: 0, o: 0, gbMi: 0, oMi: 0 });
    return x;
  };
  (b.ac || []).forEach((r) => {
    if (r[0] === 'RG') return;   // filas regionales (agregados), no son un país
    const x = get(r); x.gb += +r[4 + iGb] || 0; x.wl += +r[4 + iWl] || 0; x.o += +r[4 + iO] || 0; months.add(r[3]);
  });
  (b.ac_mi || []).forEach((r) => {
    if (r[0] === 'RG' || r[r.length - 1] !== 'Con millas') return;
    const x = get(r); x.gbMi += +r[4 + iGb] || 0; x.oMi += +r[4 + iO] || 0;
  });
  const ms = [...months].sort();
  return { rows: out, from: ms[0] || null, to: ms[ms.length - 1] || null };
}

// ── Cartera (2026-11-12, Diego): cuadrantes y moonshot 3x desde los usuarios del tráfico ───────────────────────────────────
// Reemplaza al Moonshot con base de clientes (Excel del equipo): el dato más confiable que tenemos de cada cuenta es su tráfico.
// Por partner × país (país del partner en el Daily, de navegación en el tráfico), en los meses CERRADOS y COMPLETOS de tráfico del FY:
//   NR por usuario = NR / usuarios del tráfico (usuarios-semana sumados: misma vara para todas las cuentas).
//   Pares = cuentas del mismo país con tráfico (si hay menos de 3, de la región). Techo realista = mediana de los pares (tope 2x la
//   propia); moonshot = p75 (tope MOON_CAP). Multiplicador = techo / NR por usuario propio (mínimo 1): cuánto crecería la cuenta con
//   el mismo tráfico si lo monetizara como sus pares.
//   Palanca: el NR por usuario se abre en orders por usuario (conversión) × NR por order (valor); la que más lejos está de la
//   mediana de los pares es la palanca. Monoproducto (un producto ≥ 80% de las orders): verticales a sumar = productos que los pares
//   del país venden (mediana de share ≥ 10%) y la cuenta casi no (< 5%).
// Cuadrantes: tamaño = NR anual (grande desde BIG_NR); potencial = multiplicador moonshot (alto desde HI_MULT).
//   Estrella (grande, alto potencial): crecer exponencial · Apuesta (chica, alto): validar y escalar ·
//   Madura (grande, bajo): defender y rentabilizar · Despriorizar (chica, baja) · Sin tráfico (API o sin sitio): no se puede medir.
// Industria de cada cuenta: del Excel "B2B2C_Data Histórica" del equipo (server/b2b2c-partner-bases.json, campo industria). La de la
// cartera de Comercial (comdev_cartera_b2b2c_historic.industry) no sirve: Latam figura como "Bancos" y BBVA como "WL Hotels" (2026-11-12).
const BASES_FILE = require('path').join(__dirname, 'b2b2c-partner-bases.json');
let INDUSTRIA = null;
function industria(partner, pais) {
  if (!INDUSTRIA) {
    INDUSTRIA = { exact: new Map(), any: new Map() };
    try {
      (JSON.parse(require('fs').readFileSync(BASES_FILE, 'utf8')).rows || []).forEach((b) => {
        if (!b.partner || !b.industria) return;
        const p = String(b.partner).toLowerCase();
        INDUSTRIA.exact.set(p + '|' + b.pais, b.industria);
        if (!INDUSTRIA.any.has(p)) INDUSTRIA.any.set(p, b.industria);
      });
    } catch (e) { /* sin archivo: pares por país */ }
  }
  const p = String(partner).toLowerCase();
  return INDUSTRIA.exact.get(p + '|' + pais) || INDUSTRIA.any.get(p) || (AIRLINES.test(partner) ? 'Aerolinea' : null);
}
const BIG_NR = 1e6, HI_MULT = 2, MOON_X = 3, MOON_CAP = 5, MIN_USERS = 20000, MIN_NR = 50000;
const AIRLINES = /^(latam|sky|avianca|aerol[ií]neas|gol|azul|copa|jetsmart|flybondi|aeromexico|volaris|viva)(?![a-z])/i;
const MOON_PRODS = ['Vuelos', 'Hoteles', 'Paquetes', 'Autos', 'Servicios en destino', 'Asistencia'];
const REGION_OF = Object.fromEntries(Object.values(SITES).map(([p, r]) => [p, r]));
function quant(arr, q) {
  const a = arr.filter((v) => v != null && isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = (a.length - 1) * q, lo = Math.floor(i);
  return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo);
}
function quadrant(r) {
  if (r.npu == null) return 'sin_trafico';
  const big = r.nr >= BIG_NR, hi = r.multM >= HI_MULT;
  return big ? (hi ? 'estrella' : 'madura') : (hi ? 'apuesta' : 'despriorizar');
}
function cartera(data) {
  const frm = frame(data, 'm'), { fy, keys } = fyMonths(frm, data.last), inFY = new Set(keys);
  const tKeys = keys.filter((k) => k !== frm.partialKey && !frm.flag[k]), inT = new Set(tKeys);   // tráfico: meses cerrados y completos
  const okLy = new Set(tKeys.filter((k) => frm.keys.includes(lyKey(k)) && !frm.flag[lyKey(k)])), lyT = new Set([...okLy].map(lyKey));   // YoY de usuarios: solo meses comparables
  const fy0 = keys[0] + '-01', days = Math.round((new Date(data.last + 'T00:00:00Z') - new Date(fy0 + 'T00:00:00Z')) / 864e5) + 1, ann = 365 / days;
  const P = new Map(), key = (p, c) => p + '|' + c;
  const get = (p, c) => { const k = key(p, c); let x = P.get(k); if (!x) P.set(k, x = { partner: p, pais: c, o: 0, nr: 0, fvm: 0, u: 0, s: 0, b: 0, uC: 0, uLy: 0, oT: 0, nrT: 0, prod: {} }); return x; };
  for (const r of data.daily) {
    if (r.partner === 'Otros' || !inFY.has(r.d.m)) continue;
    const x = get(r.partner, r.pais), q = x.prod[r.prod] || (x.prod[r.prod] = 0);
    x.o += r.v[0]; x.nr += r.v[2]; x.fvm += r.v[3]; x.prod[r.prod] = q + r.v[0];
    if (inT.has(r.d.m)) { x.oT += r.v[0]; x.nrT += r.v[2]; }
  }
  for (const r of data.traffic) {
    if (r.partner === 'Otros') continue;
    if (inT.has(r.m)) { const x = P.get(key(r.partner, r.pais)); if (x) { x.u += r.v[0]; x.s += r.v[1]; x.b += r.v[5]; if (okLy.has(r.m)) x.uC += r.v[0]; } }
    else if (lyT.has(r.m)) { const x = P.get(key(r.partner, r.pais)); if (x) x.uLy += r.v[0]; }
  }
  const list = [...P.values()].filter((x) => x.nr * ann >= MIN_NR);
  list.forEach((x) => {
    const ok = x.u >= MIN_USERS && x.nrT > 0 && x.oT > 0;
    x.npu = ok ? x.nrT / x.u : null; x.opu = ok ? x.oT / x.u : null; x.nrpo = ok ? x.nrT / x.oT : null;
    // Deriva tráfico: entra directo a la compra (menos búsquedas que bookings, p.ej. un metabuscador): activación y conversión no se separan
    x.deriva = ok && x.s < x.b;
    x.spu = ok && !x.deriva ? x.s / x.u : null; x.ops = ok && !x.deriva && x.s > 0 ? x.oT / x.s : null;
    x.ind = industria(x.partner, x.pais);
  });
  const mgr = data.mgr;
  const rows = list.map((x) => {
    // Pares (2026-11-12, Diego): misma industria, del país → de la región → de todos los países; sin industria (o sin 3 pares), el país → la región
    const base = list.filter((y) => y !== x && y.npu != null);
    const steps = [
      [(y) => x.ind && y.ind === x.ind && y.pais === x.pais, 'industria · país'],
      [(y) => x.ind && y.ind === x.ind && REGION_OF[y.pais] === REGION_OF[x.pais], 'industria · región'],
      [(y) => x.ind && y.ind === x.ind, 'industria · todos los países'],
      [(y) => y.pais === x.pais, 'país (todas las industrias)'],
      [(y) => REGION_OF[y.pais] === REGION_OF[x.pais], 'región (todas las industrias)'],
    ];
    let peers = [], peerScope = null;
    for (const [f, lbl] of steps) { peers = base.filter(f); peerScope = lbl; if (peers.length >= 3) break; }
    const p50 = quant(peers.map((y) => y.npu), 0.5), p75 = quant(peers.map((y) => y.npu), 0.75);
    let multR = 1, multM = 1, lever = null;
    if (x.npu != null && p50) {
      multR = Math.min(2, Math.max(1, p50 / x.npu));
      multM = p75 ? Math.min(MOON_CAP, Math.max(1, p75 / x.npu)) : multR;
      // NR por usuario = búsquedas por usuario (activación) × orders por búsqueda (conversión) × NR por order (valor)
      const gap = (own, f) => (own > 0 ? Math.log(Math.max(1, (quant(peers.map(f), 0.5) || 0) / own)) : 0);
      const gs = x.deriva
        ? [['conversión', gap(x.opu, (y) => y.opu)], ['valor por order', gap(x.nrpo, (y) => y.nrpo)]]
        : [['activación', gap(x.spu, (y) => y.spu)], ['conversión', gap(x.ops, (y) => y.ops)], ['valor por order', gap(x.nrpo, (y) => y.nrpo)]];
      gs.sort((a, b) => b[1] - a[1]);
      lever = gs[0][1] < 0.05 ? null : gs[0][0];
    }
    // Mix: monoproducto y verticales a sumar (pares del mismo país con volumen)
    const share = (y, pr) => (y.o > 0 ? (y.prod[pr] || 0) / y.o : 0);
    const prods = MOON_PRODS.map((pr) => [pr, share(x, pr)]).sort((a, b) => b[1] - a[1]);
    const mixPeers = list.filter((y) => y !== x && y.pais === x.pais && y.o * ann >= 500);
    const addProds = MOON_PRODS.filter((pr) => share(x, pr) < 0.05 && (quant(mixPeers.map((y) => share(y, pr)), 0.5) || 0) >= 0.1
      && !(pr === 'Vuelos' && AIRLINES.test(x.partner)));   // a una aerolínea no se le sugiere sumar vuelos
    // Perfil comercial (Managerial)
    const m = mgr ? mgr.rows.get(x.partner.toLowerCase() + '|' + x.pais) : null;
    const ps = PS_PARTNERS[x.partner.toLowerCase()] === x.pais;
    const nrA = x.nr * ann, uA = x.u ? x.u * 12 / tKeys.length : null;
    const r = {
      partner: x.partner, pais: x.pais, region: REGION_OF[x.pais] || null, director: data.director[x.partner.toLowerCase()] || null, industria: x.ind,
      spu: x.spu, spuPeer: quant(peers.map((y) => y.spu), 0.5), ops: x.ops, deriva: x.deriva,
      nr: nrA, fvm: x.fvm * ann, orders: x.o * ann, users: uA, uYoY: x.uLy >= MIN_USERS ? x.uC / x.uLy - 1 : null, uYoYn: okLy.size,
      npu: x.npu, opu: x.opu, nrpo: x.nrpo, p50, p75, peers: peers.length, peerScope, multR, multM, potR: nrA * (multR - 1), potM: nrA * (multM - 1), lever,
      topProd: prods[0][1] > 0 ? prods[0][0] : null, topShare: prods[0][1], mono: prods[0][1] >= 0.8, addProds,
      gb: m ? m.gb : null, canje: m && m.gb > 0 ? m.gbMi / m.gb : null, comision: m && m.gb > 0 ? -m.wl / m.gb : null, ps,
    };
    r.quad = quadrant(r);
    r.cand = r.quad !== 'sin_trafico' && r.multM >= MOON_X;
    return r;
  }).sort((a, b) => b.nr - a.nr);
  return {
    lyMonths: okLy.size, fy, from: fy0, to: data.last, days, tFrom: tKeys[0] || null, tTo: tKeys[tKeys.length - 1] || null, tMonths: tKeys.length,
    mgrFrom: mgr ? mgr.from : null, mgrTo: mgr ? mgr.to : null, bigNr: BIG_NR, hiMult: HI_MULT, moonX: MOON_X, cap: MOON_CAP, minUsers: MIN_USERS, rows,
  };
}

// Punto de entrada del servidor: ?gran=w|m&region=&pais=&partner=&prod=&plat=&ruta=[&dim=&k=] · ?view=cartera
function trackerApi(fileStore, params) {
  const data = loadData(fileStore);
  const q = {};
  DIMS.forEach((d) => { q[d] = params.get(d) || ''; });
  const gran = params.get('gran') === 'm' ? 'm' : 'w';
  if (params.get('view') === 'cartera' || params.get('view') === 'moonshot') return memo(data, 'cartera', () => cartera(data));
  const dim = params.get('dim'), k = params.get('k'), evo = params.get('evo') === '1';
  const key = JSON.stringify([gran, q, dim, k, evo]);
  return memo(data, key, () => (evo ? evoByPartner(data, q, gran) : dim ? breakdown(data, q, gran, k, dim) : series(data, q, gran)));
}

module.exports = { trackerApi, cartera, parseMgr, loadData, series, breakdown, isoWeek, weekStart, DAILY_FOLDER_ID, TRAFFIC_FILE, DAILY_FILE, _reset: () => { CACHE = { key: null, data: null }; } };
