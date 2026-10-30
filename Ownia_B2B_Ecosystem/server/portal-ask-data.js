// Datos del buscador de la portada (public/portal-ask.js, 2026-10-30):
//  - partnersFrom(fileStore): los partners B2B2C con reales, sacados del JSON del Daily que ya está en el espejo.
//    Así el buscador reconoce "Nubank" o "Mercado Pago" sin una lista escrita a mano que se desactualice.
//  - createQuestionLog(notesStore, log): guarda cada pregunta (texto, a dónde fue, qué no se pudo aplicar) para
//    mejorar el intérprete con las frases reales. Usa el almacén de notas (disco en local, DynamoDB en Ownia):
//    módulo "portada", scope "preguntas-AAAA-MM", un campo por pregunta.
const crypto = require('crypto');

const DAILY_B2B2C = 'daily_b2b2c_data.json';
const KEY = Buffer.from('"partner"');

// Recorre el JSON crudo (~45 MB) buscando "partner": "<nombre>" sin parsearlo entero: no arma el objeto en memoria.
function scanPartners(buf) {
  const byKey = new Map();
  let i = buf.indexOf(KEY);
  while (i >= 0) {
    let j = i + KEY.length;
    while (buf[j] === 0x20 || buf[j] === 0x3a) j++;   // espacios y ':'
    if (buf[j] === 0x22) {
      const end = buf.indexOf(0x22, j + 1);
      if (end > j && end - j < 120) {
        let name = buf.toString('utf8', j + 1, end);
        try { name = JSON.parse(`"${name}"`); } catch (e) { /* escape raro: se usa tal cual */ }
        name = name.trim();
        const k = name.toLowerCase();
        // Mismo partner con otras mayúsculas según la fuente: gana el que tiene mayúsculas ("TurismoCity" a "turismocity").
        if (name && k !== 'tbd' && (!byKey.has(k) || (byKey.get(k) === k && name !== k))) byKey.set(k, name);
      }
      j = end > j ? end : j + 1;
    }
    i = buf.indexOf(KEY, j);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

let cache = { sha: null, list: [] };
function partnersFrom(fileStore) {
  if (!fileStore) return [];
  const meta = fileStore.listMeta().find((f) => f.name === DAILY_B2B2C);
  if (!meta) return [];
  if (cache.sha === meta.sha256) return cache.list;
  const f = fileStore.get(meta.id);
  const list = f && f.buf ? scanPartners(f.buf) : [];
  cache = { sha: meta.sha256, list };
  return list;
}

const SCOPE = (d) => `preguntas-${d.toISOString().slice(0, 7)}`;
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
const strList = (x, n, len) => (Array.isArray(x) ? x.filter((v) => typeof v === 'string').slice(0, n).map((v) => v.slice(0, len)) : []);

// Solo lo que manda la caja, acotado: el registro nunca guarda cualquier cosa que llegue.
function cleanEntry(body) {
  const params = {};
  if (body.params && typeof body.params === 'object') {
    for (const [k, v] of Object.entries(body.params).slice(0, 6)) if (/^[a-z]{1,12}$/.test(k) && typeof v === 'string') params[k] = v.slice(0, 120);
  }
  return {
    text: str(body.text, 300),
    voice: body.voice === true,
    understood: body.understood === true,
    topics: strList(body.topics, 8, 30),
    options: strList(body.options, 4, 200),
    chosen: Number.isInteger(body.chosen) && body.chosen >= -1 && body.chosen < 4 ? body.chosen : -1,
    dest: str(body.dest, 40) || null,
    params,
    notes: strList(body.notes, 4, 300),
    unknown: strList(body.unknown, 12, 40),
  };
}

function createQuestionLog(notesStore, log = () => {}) {
  return {
    async add(body, by) {
      const entry = cleanEntry(body || {});
      if (!entry.text.trim()) throw Object.assign(new Error('text vacío'), { status: 400 });
      const now = new Date();
      const id = `q${now.toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
      // Además del almacén, al log: si el almacén falla, la pregunta no se pierde.
      log({ level: 'info', msg: 'pregunta portada', id, by, ...entry });
      if (notesStore) await notesStore.put('portada', SCOPE(now), id, JSON.stringify(entry), by);
      return id;
    },
    async month(mes) {
      if (!MES_RE.test(mes)) throw Object.assign(new Error('mes inválido (AAAA-MM)'), { status: 400 });
      if (!notesStore) return [];
      const notes = await notesStore.get('portada', `preguntas-${mes}`);
      return Object.entries(notes).map(([id, n]) => {
        let e = {};
        try { e = JSON.parse(n.text); } catch (err) { /* nota rota: se muestra vacía */ }
        return { id, by: n.by, at: n.at, ...e };
      }).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    },
  };
}

module.exports = { partnersFrom, scanPartners, createQuestionLog, cleanEntry };
