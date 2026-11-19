// Acciones comerciales de B2B2C para el "Resumen semanal" (2026-11-19, pedido de Tiago para el CEO): si un partner
// importante se desvía contra Budget, "Para mirar" muestra qué acción comercial tuvo en el período.
//
// Fuente: el Google Sheet "Calendario Estratégico | MKT B2B2C" de Marketing (SHEET_ID). Se baja como .xlsx con la API de
// Drive (files.export, alcance drive.readonly: el mismo refresh token que usa la app para Drive) y se lee con el parser
// propio (gas-sheets.js). Se guarda en memoria CACHE_MS; si Drive falla, se devuelve lo último que se pudo leer.
//
// Formato de la planilla (hojas "Resumen" = 2026 y "WIP 2027"): columna A con "Semana PROPIA" (fila de semanas W21…),
// la fila "Evento Industria" con el lunes de cada semana ISO; desde ahí, una fila por país (AR, BR…) y White Label con
// su Tier, y en cada semana el nombre de la campaña (las de dos semanas, en una celda combinada). Las demás hojas son
// el detalle de una campaña ("Sudamerica W35 y W36", "EUROPA  W42 y W43"…): su "Brief" (o el "LLAMADO:" de la fila 1)
// es el mini resumen que se muestra.
const { parseWorkbook } = require('./gas-sheets');
const { accessToken } = require('./gslides-export');

const SHEET_ID = '1-txAVd8KMGHPyRI5ZQgUAmTqfPRexstKO9fyWHUh6ek';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CACHE_MS = 15 * 60 * 1000;
const PAIS = { AR: 'Argentina', BR: 'Brasil', CL: 'Chile', CO: 'Colombia', MX: 'Mexico', PE: 'Peru', UY: 'Uruguay', EC: 'Ecuador', PY: 'Paraguay' };

function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function clean(s) { return String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim(); }
// Serial de Excel → 'YYYY-MM-DD' (las fechas del calendario son días, sin hora)
function serialYmd(n) { return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10); }
function isoWeek(ymd) {
  const d = new Date(ymd + 'T00:00:00Z'), day = d.getUTCDay() || 7, thu = new Date(d.getTime() + (4 - day) * 864e5);
  return { year: thu.getUTCFullYear(), week: Math.ceil(((thu - Date.UTC(thu.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7) };
}

// Valor de una celda, mirando la celda combinada que la cubre (el valor queda en la de arriba a la izquierda)
function cellAt(sh, r, c) {
  const x = sh.cells.get(`${r},${c}`);
  if (x) return x;
  const m = sh.merges.find((g) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2);
  return m ? sh.cells.get(`${m.r1},${m.c1}`) || null : null;
}
function mergeOf(sh, r, c) { return sh.merges.find((g) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) || null; }

// Hojas de detalle de campaña → { tokens, weeks, text }
function briefsOf(wb) {
  const out = [];
  wb.sheets.forEach((sh) => {
    const weeks = (sh.name.match(/W\s?(\d{1,2})/gi) || []).map((w) => +w.replace(/\D/g, ''));
    if (!weeks.length) return;
    let text = '';
    const a1 = sh.cells.get('1,1');
    if (a1 && /^llamado/i.test(String(a1.v))) text = String(a1.v).replace(/^llamado:?\s*/i, '');
    for (let r = 1; r <= Math.min(sh.lastRow, 6) && !text; r++) {
      const a = sh.cells.get(`${r},1`);
      if (a && norm(a.v) === 'brief') { const b = cellAt(sh, r, 2); if (b) text = String(b.v); }
    }
    if (!text) return;
    const tokens = norm(sh.name).split(/[^a-z0-9]+/).filter((t) => t && !/^(w\d+|\d+|semana|especial|y|de)$/.test(t)).map((t) => t.slice(0, 5));
    if (tokens.length) out.push({ tokens, weeks, text: clean(text) });
  });
  return out;
}

/** xlsx del calendario → { items: [{pais, code, partner, tier, year, week, name, weeks:[…], brief}] } */
function parseCalendar(buf) {
  const wb = parseWorkbook(buf), briefs = briefsOf(wb), items = [], seen = new Set();
  wb.sheets.forEach((sh) => {
    let rWeeks = 0, rDates = 0;
    for (let r = 1; r <= Math.min(sh.lastRow, 10); r++) {
      const a = norm((sh.cells.get(`${r},1`) || {}).v);
      if (a === 'semana propia') rWeeks = r;
      if (a === 'evento industria') rDates = r;
    }
    if (!rWeeks || !rDates) return;
    const cols = [];   // columnas de semana: {c, year, week}
    for (let c = 1; c <= sh.lastCol; c++) {
      const d = sh.cells.get(`${rDates},${c}`);
      if (d && typeof d.v === 'number' && d.date) cols.push(Object.assign({ c }, isoWeek(serialYmd(d.v))));
    }
    for (let r = Math.max(rWeeks, rDates) + 1; r <= sh.lastRow; r++) {
      const code = String((sh.cells.get(`${r},2`) || {}).v || '').trim().toUpperCase(), partner = clean((sh.cells.get(`${r},3`) || {}).v);
      if (!PAIS[code] || !partner) continue;
      const tier = clean((sh.cells.get(`${r},4`) || {}).v);
      // Nombre por semana (mirando celdas combinadas); una campaña = semanas seguidas con el mismo nombre (BUEN FIN W46–W47)
      const names = cols.map((k) => { const x = cellAt(sh, r, k.c); return x && x.v !== '' && x.v != null ? clean(x.v) : ''; });
      cols.forEach((k, ix) => {
        if (!names[ix]) return;
        const name = names[ix];
        let a = ix, z = ix;
        while (a > 0 && norm(names[a - 1]) === norm(name)) a--;
        while (z < cols.length - 1 && norm(names[z + 1]) === norm(name)) z++;
        const span = cols.slice(a, z + 1).map((q) => q.week);
        const key = `${code}|${norm(partner)}|${k.year}|${k.week}`;
        if (seen.has(key)) return;
        seen.add(key);
        const n = norm(name), b = briefs.find((g) => g.weeks.indexOf(k.week) >= 0 && g.tokens.some((t) => n.indexOf(t) >= 0));
        items.push({ pais: PAIS[code], code, partner, tier, year: k.year, week: k.week, name, weeks: span, brief: b ? b.text : '' });
      });
    }
  });
  return { items };
}

function createAcciones({ secrets, fetchFn = fetch, now = Date.now } = {}) {
  let cache = null, inflight = null;
  async function fetchFresh() {
    const token = await accessToken((typeof secrets === 'function' ? secrets() : secrets) || {}, fetchFn);
    const r = await fetchFn(`https://www.googleapis.com/drive/v3/files/${SHEET_ID}/export?mimeType=${encodeURIComponent(XLSX)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Drive devolvió ${r.status} al bajar el calendario de acciones comerciales.`);
    const buf = Buffer.from(await r.arrayBuffer());
    return Object.assign({ ok: true, updatedAt: new Date(now()).toISOString() }, parseCalendar(buf));
  }
  return {
    async get() {
      if (cache && now() - cache.at < CACHE_MS) return cache.data;
      if (!inflight) {
        inflight = fetchFresh().then((data) => { cache = { at: now(), data }; return data; })
          .catch((e) => (cache ? Object.assign({}, cache.data, { stale: true, error: e.message }) : { ok: false, error: e.message, items: [] }))
          .finally(() => { inflight = null; });
      }
      return inflight;
    },
  };
}

module.exports = { createAcciones, parseCalendar, SHEET_ID };
