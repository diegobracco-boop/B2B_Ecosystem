// Shims de los servicios de Apps Script. Cada proyecto GAS corre en su propio contexto vm
// con estos objetos como globales, así el código del módulo se ejecuta SIN cambios.
//
// Regla: un servicio que todavía no está migrado no se "simula" — tira ServicioNoMigrado
// apenas se lo usa, para que nunca se sirva un número inventado. Ver CONTEXT.md.
const crypto = require('crypto');
const zlib = require('zlib');

class ServicioNoMigrado extends Error {
  constructor(service, member) {
    super(
      `${service}${member ? '.' + member : ''} todavía no está disponible en Ownia ` +
        '(el módulo sigue productivo en Apps Script).'
    );
    this.name = 'ServicioNoMigrado';
  }
}

function notMigrated(service) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        // Inspecciones inocuas (console.log, util.inspect, coerciones) no deben romper.
        if (typeof prop === 'symbol' || prop === 'toJSON' || prop === 'then') return undefined;
        throw new ServicioNoMigrado(service, prop);
      },
    }
  );
}

// ---------- Utilities.formatDate (patrones SimpleDateFormat de Java) ----------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
  });
  const p = {};
  for (const { type, value } of fmt.formatToParts(date)) p[type] = value;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  const parts = {
    y: Number(p.year), M: Number(p.month), d: Number(p.day),
    H: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second),
    S: date.getUTCMilliseconds(), E: wd,
  };
  // Offset de la zona en minutos (hora local "de pared" − UTC).
  const asUtc = Date.UTC(parts.y, parts.M - 1, parts.d, parts.H, parts.m, parts.s, parts.S);
  parts.offsetMin = Math.round((asUtc - date.getTime()) / 60000);
  return parts;
}

function pad(n, len) {
  return String(n).padStart(len, '0');
}

function formatOffset(min, withColon) {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return sign + pad(Math.floor(a / 60), 2) + (withColon ? ':' : '') + pad(a % 60, 2);
}

function formatDate(date, timeZone, pattern) {
  if (!(date instanceof Date) && !(date && typeof date.getTime === 'function')) {
    throw new Error('Utilities.formatDate: el primer parámetro tiene que ser una fecha');
  }
  const d = new Date(date.getTime());
  const p = zonedParts(d, timeZone || 'UTC');
  let out = '';
  for (let i = 0; i < pattern.length; ) {
    const ch = pattern[i];
    if (ch === "'") {
      // Literal entre comillas simples; '' = comilla.
      const end = pattern.indexOf("'", i + 1);
      if (end === i + 1) { out += "'"; i += 2; continue; }
      out += pattern.slice(i + 1, end === -1 ? pattern.length : end);
      i = end === -1 ? pattern.length : end + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(ch)) { out += ch; i++; continue; }
    let n = 1;
    while (pattern[i + n] === ch) n++;
    i += n;
    switch (ch) {
      case 'y': out += n === 2 ? pad(p.y % 100, 2) : pad(p.y, n); break;
      case 'M':
        if (n >= 4) out += MONTHS[p.M - 1];
        else if (n === 3) out += MONTHS[p.M - 1].slice(0, 3);
        else out += pad(p.M, n);
        break;
      case 'd': out += pad(p.d, n); break;
      case 'H': out += pad(p.H, n); break;
      case 'h': out += pad(p.H % 12 === 0 ? 12 : p.H % 12, n); break;
      case 'm': out += pad(p.m, n); break;
      case 's': out += pad(p.s, n); break;
      case 'S': out += pad(p.S, 3).slice(0, Math.max(n, 3)); break;
      case 'E': out += n >= 4 ? DAYS[p.E] : DAYS[p.E].slice(0, 3); break;
      case 'u': out += String(p.E === 0 ? 7 : p.E); break;
      case 'a': out += p.H < 12 ? 'AM' : 'PM'; break;
      case 'Z': out += formatOffset(p.offsetMin, false); break;
      case 'X': out += p.offsetMin === 0 ? 'Z' : formatOffset(p.offsetMin, n >= 3); break;
      default:
        throw new Error(`Utilities.formatDate: patrón '${ch}' no soportado en Ownia`);
    }
  }
  return out;
}

// ---------- Blob ----------

function makeBlob(data, contentType, name) {
  let buf;
  if (Buffer.isBuffer(data)) buf = data;
  else if (Array.isArray(data)) buf = Buffer.from(data.map((b) => b & 0xff));
  else buf = Buffer.from(String(data == null ? '' : data), 'utf8');
  let type = contentType || null;
  let fileName = name || null;
  const blob = {
    getBytes: () => Array.from(buf, (b) => (b > 127 ? b - 256 : b)), // GAS usa bytes con signo
    getDataAsString: (charset) => buf.toString(charset && /latin|8859/i.test(charset) ? 'latin1' : 'utf8'),
    getContentType: () => type,
    setContentType: (t) => { type = t; return blob; },
    getName: () => fileName,
    setName: (n) => { fileName = n; return blob; },
    copyBlob: () => makeBlob(Buffer.from(buf), type, fileName),
    getBlob: () => blob,
    isGoogleType: () => false,
    _buffer: () => buf,
  };
  return blob;
}

function toBuffer(x) {
  if (x && typeof x._buffer === 'function') return x._buffer();
  if (Array.isArray(x)) return Buffer.from(x.map((b) => b & 0xff));
  return Buffer.from(String(x == null ? '' : x), 'utf8');
}

// ---------- zip (lectura) ----------

// Lee un .zip (p.ej. un xlsx) desde el directorio central. Soporta "stored" y "deflate", que
// es lo que generan Excel/openpyxl; zip64 y cifrado no.
const MAX_UNZIPPED = 200 * 1024 * 1024;

function unzipEntries(buf) {
  const fail = (msg) => Object.assign(new Error(`Utilities.unzip: ${msg}`), { name: 'Exception' });
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw fail('el archivo no es un zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw fail('directorio central corrupto');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (compSize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw fail('zip64 no soportado');
    if (flags & 0x1) throw fail('zip cifrado no soportado');
    if (name.endsWith('/')) continue; // carpeta
    if (buf.readUInt32LE(local) !== 0x04034b50) throw fail('entrada corrupta');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    // El tope se cuenta con lo descomprimido de verdad (el tamaño declarado puede mentir).
    let data;
    try {
      if (method === 0) data = Buffer.from(raw);
      else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED - total + 1 });
      else throw fail(`método de compresión ${method} no soportado`);
    } catch (e) {
      if (e.code === 'ERR_BUFFER_TOO_LARGE') throw fail('contenido descomprimido demasiado grande');
      throw e;
    }
    total += data.length;
    if (total > MAX_UNZIPPED) throw fail('contenido descomprimido demasiado grande');
    out.push({ name, data });
  }
  return out;
}

function makeUtilities() {
  const DigestAlgorithm = { MD2: 'md2', MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256', SHA_384: 'sha384', SHA_512: 'sha512' };
  const Charset = { US_ASCII: 'ascii', UTF_8: 'utf8' };
  return {
    DigestAlgorithm,
    Charset,
    formatDate,
    getUuid: () => crypto.randomUUID(),
    // Congela el proceso entero (todas las requests): tope de 2 s. Ningún módulo lo usa hoy.
    sleep: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(Number(ms) || 0, 2000)); },
    base64Encode: (x) => toBuffer(x).toString('base64'),
    base64EncodeWebSafe: (x) => toBuffer(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64Decode: (s) => Array.from(Buffer.from(String(s), 'base64'), (b) => (b > 127 ? b - 256 : b)),
    base64DecodeWebSafe: (s) =>
      Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'), (b) => (b > 127 ? b - 256 : b)),
    newBlob: (data, contentType, name) => makeBlob(data, contentType, name),
    computeDigest: (alg, value) =>
      Array.from(crypto.createHash(alg).update(toBuffer(value)).digest(), (b) => (b > 127 ? b - 256 : b)),
    gzip: (blob, name) => makeBlob(zlib.gzipSync(toBuffer(blob)), 'application/x-gzip', name || null),
    ungzip: (blob) => makeBlob(zlib.gunzipSync(toBuffer(blob)), null, null),
    unzip: (blob) => unzipEntries(toBuffer(blob)).map((e) => makeBlob(e.data, null, e.name)),
    zip: () => { throw new ServicioNoMigrado('Utilities', 'zip'); },
  };
}

// ---------- CacheService (memoria del proceso) ----------

const MAX_TTL_S = 21600; // mismo tope que GAS (6 h)

const MAX_ENTRIES = 5000;

function makeMemoryCache() {
  const store = new Map();
  // Saca vencidos; si sigue lleno, los más viejos (Map conserva orden de inserción).
  const purge = () => {
    const now = Date.now();
    for (const [k, e] of store) if (e.exp <= now) store.delete(k);
    for (const k of store.keys()) { if (store.size < MAX_ENTRIES) break; store.delete(k); }
  };
  const live = (k) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.exp <= Date.now()) { store.delete(k); return null; }
    return e.v;
  };
  return {
    get: (k) => live(String(k)),
    getAll: (keys) => {
      const out = {};
      for (const k of keys || []) { const v = live(String(k)); if (v !== null) out[k] = v; }
      return out;
    },
    put: (k, v, ttl) => {
      const s = Math.min(Number(ttl) || 600, MAX_TTL_S);
      if (store.size >= MAX_ENTRIES) purge();
      store.set(String(k), { v: String(v), exp: Date.now() + s * 1000 });
    },
    putAll: (obj, ttl) => {
      const s = Math.min(Number(ttl) || 600, MAX_TTL_S);
      for (const k of Object.keys(obj || {})) store.set(k, { v: String(obj[k]), exp: Date.now() + s * 1000 });
    },
    remove: (k) => { store.delete(String(k)); },
    removeAll: (keys) => { for (const k of keys || []) store.delete(String(k)); },
  };
}

// ---------- PropertiesService (memoria, sembrado desde APP_SECRETS) ----------

function makeProperties(seed) {
  const map = new Map(Object.entries(seed || {}).map(([k, v]) => [k, String(v)]));
  const api = {
    getProperty: (k) => (map.has(k) ? map.get(k) : null),
    getProperties: () => Object.fromEntries(map),
    getKeys: () => Array.from(map.keys()),
    setProperty: (k, v) => { map.set(String(k), String(v)); return api; },
    setProperties: (obj, deleteAllOthers) => {
      if (deleteAllOthers) map.clear();
      for (const k of Object.keys(obj || {})) map.set(k, String(obj[k]));
      return api;
    },
    deleteProperty: (k) => { map.delete(k); return api; },
    deleteAllProperties: () => { map.clear(); return api; },
  };
  return api;
}

function makeLock() {
  // Cada llamada GAS corre sincrónica en un único hilo: no hay concurrencia dentro de una
  // instancia, así que el lock es trivial. (Entre instancias no hay lock: ver CONTEXT.md.)
  return { waitLock() {}, tryLock: () => true, releaseLock() {}, hasLock: () => true };
}

// ---------- HtmlService / ContentService ----------

function makeHtmlOutput(content) {
  const out = {
    _type: 'html',
    _content: content == null ? '' : String(content),
    _title: null,
    _meta: [],
    _xfo: 'DEFAULT',
    _favicon: null,
    getContent: () => out._content,
    setContent: (c) => { out._content = String(c); return out; },
    append: (c) => { out._content += String(c); return out; },
    appendUntrusted: (c) => { out._content += String(c).replace(/</g, '&lt;'); return out; },
    clear: () => { out._content = ''; return out; },
    setTitle: (t) => { out._title = String(t); return out; },
    getTitle: () => out._title,
    addMetaTag: (name, content) => { out._meta.push({ name: String(name), content: String(content) }); return out; },
    getMetaTags: () => out._meta.map((m) => ({ getName: () => m.name, getContent: () => m.content })),
    setXFrameOptionsMode: (mode) => { out._xfo = mode; return out; },
    setSandboxMode: () => out,
    setFaviconUrl: (u) => { out._favicon = String(u); return out; },
    getFaviconUrl: () => out._favicon,
    setWidth: () => out,
    setHeight: () => out,
    getWidth: () => null,
    getHeight: () => null,
    getBlob: () => makeBlob(out._content, 'text/html', null),
    getAs: () => makeBlob(out._content, 'text/html', null),
  };
  return out;
}

function makeTextOutput(content) {
  const out = {
    _type: 'text',
    _content: content == null ? '' : String(content),
    _mime: 'text/plain',
    getContent: () => out._content,
    setContent: (c) => { out._content = String(c); return out; },
    append: (c) => { out._content += String(c); return out; },
    clear: () => { out._content = ''; return out; },
    setMimeType: (m) => { out._mime = m; return out; },
    getMimeType: () => out._mime,
    downloadAsFile: () => out,
    getFileName: () => null,
  };
  return out;
}

const ContentMimeType = {
  ATOM: 'application/atom+xml', CSV: 'text/csv', ICAL: 'text/calendar',
  JAVASCRIPT: 'application/javascript', JSON: 'application/json', RSS: 'application/rss+xml',
  TEXT: 'text/plain', VCARD: 'text/vcard', XML: 'application/xml',
};

module.exports = {
  ServicioNoMigrado,
  notMigrated,
  formatDate,
  makeUtilities,
  makeMemoryCache,
  makeProperties,
  makeLock,
  makeHtmlOutput,
  makeTextOutput,
  makeBlob,
  unzipEntries,
  ContentMimeType,
};
