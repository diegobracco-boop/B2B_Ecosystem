// Registro de uso de la app (2026-11-26, Diego): qué páginas y funciones usa cada persona, cuántas veces, cuánto
// tardan y cuántas fallan, para pensar mejoras con datos. Solo Ownia; no hay nada de esto en Apps Script.
//
// Se agrega en memoria por (día, usuario, clave) y se escribe cada FLUSH_MS (y al apagar) en el almacén de notas
// (disco en local, DynamoDB en Ownia): módulo "uso", scope "dia-AAAA-MM-DD", un campo por usuario y proceso.
// Cada proceso escribe sus propios totales acumulados (campo = hash del mail + id del arranque), así no hace falta
// leer antes de escribir y dos instancias o un reinicio no se pisan; al leer se suman.
//
// Claves: "page:/hub" (abrir una página), "api:pnl-accounting/getEPMBreakdown" (una función), "notes:hub", etc.
// Filtros (2026-11-26): de cada función se guarda la combinación de filtros cortos que recibió (p. ej.
// "goalSource=lastrunrate · lobGroup=b2b · pais=Brasil") y cuántas veces, para ver qué mira cada uno y pre-filtrar.
// Solo valores cortos (texto ≤ 40, números, sí/no, listas de hasta 8 textos); nunca contraseñas, textos libres,
// mails ni datos. Afuera: /health, archivos estáticos y el polling de getLastSync.
// Los datos de uso quedan en la app; nunca en el repo (el monorepo es público).
const crypto = require('crypto');

const MOD = 'uso';
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CLAVES = 80;          // por usuario y día: el resto se junta en "otros"
const MAX_TEXT = 7800;          // el almacén de notas acepta hasta 8000
const TZ_OFFSET_MS = -3 * 3600 * 1000;   // el día se corta a la medianoche de Buenos Aires
const IGNORAR_API = new Set(['getLastSync']);
const MAX_COMBOS = 25;          // combinaciones de filtros por función, usuario y día (el resto en "otros")
const CLAVE_SENSIBLE = /pass|token|secret|clave|pwd|text|question|messages|pptx|slides|html|img|png|base64|body|data/i;

const diaDe = (ms) => new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
const limpia = (s) => String(s).replace(/[^A-Za-z0-9_/.-]/g, '').slice(0, 80);

/** Clave de uso de un pedido, o null si no cuenta (salud, estáticos, polling). */
function claveDe(method, route) {
  const r = String(route || '/');
  if (r === '/health' || r === '/healthz' || r.startsWith('/_')) return null;
  const parts = r.split('/').filter(Boolean);
  if (parts[0] === 'api') {
    if (parts.length < 3 || IGNORAR_API.has(parts[2])) return null;
    return `api:${limpia(parts[1])}/${limpia(parts[2])}`;
  }
  if (parts[0] === 'notes') return `notes:${limpia(parts[1] || '')}`;
  if (parts[0] === 'uso') return null;
  if (method !== 'GET') return `otro:${method}/${limpia(parts[0] || '')}`;
  if (/\.[a-z0-9]{1,5}$/i.test(r)) return null;   // favicon, imágenes, etc.
  return `page:/${parts.slice(0, 2).map(limpia).join('/')}`;
}

// Un valor corto y "de filtro", o undefined si no lo es.
function valorFiltro(v) {
  if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return String(v);
  if (typeof v === 'string') return v.length && v.length <= 40 && !v.includes('@') && !/[\n\r<>{}]/.test(v) ? v : undefined;
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.length > 8) return undefined;
    const xs = v.map(valorFiltro);
    return xs.every((x) => x !== undefined && !x.startsWith('[')) ? '[' + xs.join(',') + ']' : undefined;
  }
  if (v === null) return 'null';
  return undefined;
}

/** Combinación de filtros de una llamada ("k=v · k=v", claves ordenadas), o null si no hay ninguno. */
function resumenFiltros(args) {
  if (!Array.isArray(args) || !args.length) return null;
  const par = {};
  args.slice(0, 4).forEach((a, i) => {
    if (typeof a === 'string' && a.length <= 2000 && /^\s*\{/.test(a)) { try { a = JSON.parse(a); } catch (e) { /* texto: se trata como valor */ } }
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      for (const [k, v] of Object.entries(a).slice(0, 30)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,29}$/.test(k) || CLAVE_SENSIBLE.test(k)) continue;
        const x = valorFiltro(v);
        if (x !== undefined) par[k] = x;
      }
    } else {
      const x = valorFiltro(a);
      if (x !== undefined) par['arg' + (i + 1)] = x;
    }
  });
  const ks = Object.keys(par).sort().slice(0, 12);
  if (!ks.length) return null;
  const out = ks.map((k) => k + '=' + par[k]).join(' · ');
  return out.length <= 400 ? out : out.slice(0, 400);
}

// Acota los filtros guardados: hasta MAX_COMBOS combinaciones por función (las más usadas) y que entre en una nota.
function acotarFiltros(filtros) {
  const out = {};
  for (const [clave, combos] of Object.entries(filtros)) {
    const ks = Object.keys(combos).sort((a, b) => combos[b] - combos[a]);
    out[clave] = {};
    ks.forEach((c, i) => { if (i < MAX_COMBOS) out[clave][c] = combos[c]; else out[clave].otros = (out[clave].otros || 0) + combos[c]; });
  }
  // Si no entra, se sacan las combinaciones menos usadas (de todas las funciones) y se suman a "otros"
  for (;;) {
    if (JSON.stringify(out).length <= MAX_TEXT) return out;
    let peor = null;
    for (const [clave, combos] of Object.entries(out)) for (const [c, n] of Object.entries(combos)) if (c !== 'otros' && (!peor || n < peor[2])) peor = [clave, c, n];
    if (!peor) { for (const k of Object.keys(out)) out[k] = { otros: Object.values(out[k]).reduce((a, b) => a + b, 0) }; return out; }
    delete out[peor[0]][peor[1]];
    out[peor[0]].otros = (out[peor[0]].otros || 0) + peor[2];
  }
}

function sumar(dst, src) {
  dst.n += src.n || 0; dst.err += src.err || 0; dst.ms += src.ms || 0; dst.max = Math.max(dst.max, src.max || 0);
  return dst;
}
const vacio = () => ({ n: 0, err: 0, ms: 0, max: 0 });

// Acota lo que se escribe: hasta MAX_CLAVES claves (las más usadas) y el resto en "otros"; y que entre en una nota.
function acotar(rutas) {
  let ks = Object.keys(rutas).sort((a, b) => rutas[b].n - rutas[a].n);
  const out = {};
  const otros = vacio();
  ks.forEach((k, i) => { if (i < MAX_CLAVES) out[k] = rutas[k]; else sumar(otros, rutas[k]); });
  if (otros.n) out.otros = otros;
  while (JSON.stringify(out).length > MAX_TEXT && (ks = Object.keys(out).filter((k) => k !== 'otros')).length) {
    const k = ks.sort((a, b) => out[a].n - out[b].n)[0];
    out.otros = sumar(out.otros || vacio(), out[k]);
    delete out[k];
  }
  return out;
}

function createUsageLog(notesStore, { log = () => {}, flushMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const boot = crypto.randomBytes(3).toString('hex');
  const dias = new Map();     // dia -> Map(email -> { rutas })
  const sucios = new Set();   // `${dia}\n${email}`
  let timer = null;

  function registrar({ method, route, status, ms, user, args }) {
    if (!user) return;
    const clave = claveDe(method, route);
    if (!clave) return;
    const email = String(user).toLowerCase().slice(0, 120);
    const dia = diaDe(now());
    if (!dias.has(dia)) dias.set(dia, new Map());
    const porUser = dias.get(dia);
    if (!porUser.has(email)) porUser.set(email, { rutas: {}, filtros: {} });
    const rutas = porUser.get(email).rutas;
    const combo = clave.startsWith('api:') ? resumenFiltros(args) : null;
    if (combo) { const fx = porUser.get(email).filtros; const m = fx[clave] || (fx[clave] = {}); m[combo] = (m[combo] || 0) + 1; }
    const r = rutas[clave] || (rutas[clave] = vacio());
    const t = Math.max(0, Math.round(Number(ms) || 0));
    sumar(r, { n: 1, err: status >= 400 ? 1 : 0, ms: t, max: t });
    sucios.add(`${dia}\n${email}`);
    if (!timer && notesStore && flushMs > 0) {
      timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, flushMs);
      if (timer.unref) timer.unref();
    }
  }

  async function flush() {
    if (!notesStore || !sucios.size) return 0;
    const pend = [...sucios];
    sucios.clear();
    let n = 0;
    for (const k of pend) {
      const [dia, email] = k.split('\n');
      const u = (dias.get(dia) || new Map()).get(email);
      if (!u) continue;
      const field = crypto.createHash('sha256').update(email).digest('hex').slice(0, 16) + '-' + boot;
      try {
        await notesStore.put(MOD, `dia-${dia}`, field, JSON.stringify({ user: email, rutas: acotar(u.rutas) }), null);
        if (Object.keys(u.filtros).length) await notesStore.put(MOD, `dia-${dia}`, field + '-f', JSON.stringify({ user: email, filtros: acotarFiltros(u.filtros) }), null);
        n++;
      } catch (e) {
        sucios.add(k);   // se reintenta en el próximo flush
        log({ level: 'error', msg: 'uso: no se pudo guardar', dia, error: e.message || String(e) });
      }
    }
    // En memoria quedan solo hoy y ayer (lo viejo ya está escrito con sus totales finales)
    const hoy = diaDe(now()), ayer = diaDe(now() - 86400000);
    for (const d of dias.keys()) if (d !== hoy && d !== ayer && ![...sucios].some((k) => k.startsWith(d + '\n'))) dias.delete(d);
    return n;
  }

  /** Uso de un día: [{ user, rutas: { clave: { n, err, ms, max } }, filtros: { clave: { combinación: n } } }], sumando procesos. */
  async function leerDia(dia) {
    if (!DIA_RE.test(dia)) throw Object.assign(new Error('día inválido (AAAA-MM-DD)'), { status: 400 });
    const porUser = new Map();
    const add = (email, rutas, filtros) => {
      if (!email) return;
      if (!porUser.has(email)) porUser.set(email, { rutas: {}, filtros: {} });
      const acc = porUser.get(email);
      for (const [k, v] of Object.entries(rutas || {})) sumar(acc.rutas[k] || (acc.rutas[k] = vacio()), v);
      for (const [k, combos] of Object.entries(filtros || {})) {
        const m = acc.filtros[k] || (acc.filtros[k] = {});
        for (const [c, n] of Object.entries(combos || {})) m[c] = (m[c] || 0) + (Number(n) || 0);
      }
    };
    if (notesStore) {
      const notes = await notesStore.get(MOD, `dia-${dia}`);
      for (const [field, n] of Object.entries(notes)) {
        if (field.endsWith('-' + boot) || field.endsWith('-' + boot + '-f')) continue;   // lo de este proceso se toma de memoria (más fresco)
        try { const e = JSON.parse(n.text); add(e.user, e.rutas, e.filtros); } catch (err) { /* nota rota: se ignora */ }
      }
    }
    for (const [email, u] of (dias.get(dia) || new Map())) add(email, u.rutas, u.filtros);
    return [...porUser].map(([user, u]) => ({ user, rutas: u.rutas, filtros: u.filtros }));
  }

  /** Rango de días (inclusive, hasta 62): { dias: [{ dia, usuarios }] }. */
  async function leerRango(desde, hasta) {
    if (!DIA_RE.test(desde) || !DIA_RE.test(hasta)) throw Object.assign(new Error('día inválido (AAAA-MM-DD)'), { status: 400 });
    const out = [];
    for (let t = Date.parse(desde + 'T12:00:00Z'), fin = Date.parse(hasta + 'T12:00:00Z'); t <= fin; t += 86400000) {
      if (out.length >= 62) throw Object.assign(new Error('rango de hasta 62 días'), { status: 400 });
      const dia = new Date(t).toISOString().slice(0, 10);
      out.push({ dia, usuarios: await leerDia(dia) });
    }
    return { dias: out };
  }

  return { registrar, flush, leerDia, leerRango, hoy: () => diaDe(now()) };
}

module.exports = { createUsageLog, claveDe, acotar, resumenFiltros, acotarFiltros };
