// Cache de respuestas de /api/<modulo>/<fn> (2026-10-28).
//
// El código GAS corre sincrónico en el mismo proceso que atiende a todos: una respuesta grande (el Daily manda JSON de decenas de MB
// que se parsea, se serializa y se comprime) frena el hilo y hace esperar a los demás, incluido el chequeo de salud. Para las funciones
// que devuelven siempre lo mismo para todos los usuarios mientras no cambien los datos (los "getRaw…" del Daily, que solo leen un JSON
// del espejo), se guarda la respuesta ya serializada y comprimida: el primero la calcula, los siguientes la reciben al instante.
//
// - Qué se cachea lo decide cada módulo con `cacheFns` en modules.js (lista explícita: nada que dependa del usuario).
// - Se invalida sola cuando cambia un archivo que lee el módulo (ver el onChange del file-store en index.js) y por día.
// - Guarda solo el gzip (lo que viaja): un tope de bytes con descarte del menos usado evita que la memoria crezca.
class ApiCache {
  constructor({ maxBytes = 120 * 1024 * 1024 } = {}) {
    this.maxBytes = maxBytes;
    this.map = new Map(); // key -> { slug, promise, bytes }
    this.bytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /** Entrada existente (la promesa puede estar calculándose todavía: los pedidos simultáneos comparten el cálculo). */
  get(key) {
    const e = this.map.get(key);
    if (!e) return null;
    this.map.delete(key); // se reinserta al final: más reciente
    this.map.set(key, e);
    this.hits++;
    return e;
  }

  /** Guarda la promesa de un cálculo en curso. Si falla se descarta (los errores no se cachean). */
  set(key, slug, promise) {
    const e = { slug, promise, bytes: 0 };
    this.map.set(key, e);
    this.misses++;
    promise.then((buf) => {
      if (this.map.get(key) !== e) return; // invalidada mientras se calculaba
      e.bytes = buf.length;
      this.bytes += e.bytes;
      this._trim();
    }, () => { if (this.map.get(key) === e) this.map.delete(key); });
    return e;
  }

  _trim() {
    for (const [k, e] of this.map) {
      if (this.bytes <= this.maxBytes) break;
      this.map.delete(k);
      this.bytes -= e.bytes;
    }
  }

  /** Descarta una entrada (si sigue siendo `e`: no borra una más nueva con la misma clave). */
  delete(key, e) {
    const cur = this.map.get(key);
    if (!cur || (e && cur !== e)) return;
    this.map.delete(key);
    this.bytes -= cur.bytes;
  }

  /** Descarta todo lo de un módulo (cambió algún archivo que lee). */
  dropModule(slug) {
    for (const [k, e] of this.map) {
      if (e.slug !== slug) continue;
      this.map.delete(k);
      this.bytes -= e.bytes;
    }
  }

  stats() {
    return { entries: this.map.size, mb: Math.round(this.bytes / 1048576 * 10) / 10, hits: this.hits, misses: this.misses };
  }
}

module.exports = { ApiCache };
