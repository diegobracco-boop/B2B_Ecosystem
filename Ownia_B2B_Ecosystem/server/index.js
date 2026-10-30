// Servidor HTTP de la app b2b-ecosystem en Ownia (sin dependencias externas).
//
//   GET  <base>/                     portada con los módulos
//   GET  <base>/health               health check (lo usa el ALB vía Caddy)
//   GET  <base>/whoami               diagnóstico de identidad (qué headers de auth llegan)
//   GET  <base>/<modulo>[/...]       doGet(e) del módulo GAS
//   POST <base>/api/<modulo>/<fn>    google.script.run.<fn>(...args)
//   GET  <base>/_gas/client.js       shim de google.script.run
//   GET  <base>/_gas/nav.js          navegación de Ownia en las landings (Home, sin portada propia)
//   GET  <base>/ingest/files         metadata de los archivos espejados (Bearer INGEST_TOKEN)
//   PUT  <base>/ingest/files/<id>    sube/reemplaza un archivo espejado de Drive (ídem)
//   GET  <base>/notes/<modulo>/<scope>  notas editables de una landing (solo Ownia, ver notes-store.js)
//   POST <base>/notes/<modulo>/<scope>  guarda una nota: { field, text }
//   GET  <base>/reales               estado de "Actualizar reales" (solo el equipo B2B, ver reales-job.js)
//   POST <base>/reales               lanza la actualización de reales: { password }
//   GET  <base>/_portal/ask.js       buscador de la portada (filter-aliases.js + portal-ask.js)
//   POST <base>/preguntas            registra una pregunta del buscador (ver portal-ask-data.js)
//   GET  <base>/preguntas[?mes=AAAA-MM][&formato=json]  las preguntas del mes (solo el equipo B2B)
const config = require('./config');

// Antes de cualquier Date: el proceso corre en la zona de los proyectos GAS (ver config.js).
process.env.TZ = config.TIME_ZONE;

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { promisify } = require('util');
const zlib = require('zlib');

const gunzip = promisify(zlib.gunzip);
const gzip = promisify(zlib.gzip);

// Respuestas grandes (el Daily manda ~65 MB de JSON) viajan con gzip si el navegador lo acepta.
// La compresión corre en el threadpool de libuv: no frena a las otras requests.
const GZIP_MIN_BYTES = 4 * 1024;   // comprimir 30 KB lleva ~1 ms; con 32 KB quedaban afuera FVM y OKR (2026-10-30)
const { MODULES, EQUIPO_B2B } = require('./modules');
const { GasProject } = require('./gas-runtime');
const { renderOutput } = require('./render');
const { escapeHtml } = require('./gas-template');
const { indexPage, agentsPage, questionsPage } = require('./index-page');
const { resolveIdentity, describeAuthHeaders } = require('./identity');
const { createFileStore, isValidId } = require('./file-store');
const { ingestAllowlist, loadManifest } = require('./drive-manifest');
const { createNotesStore } = require('./notes-store');
const { ApiCache } = require('./api-cache');
const { createRealesJob } = require('./reales-job');
const { partnersFrom, createQuestionLog } = require('./portal-ask-data');

const MAX_BODY = 5 * 1024 * 1024; // google.script.run acepta payloads grandes (p.ej. capturas)
const MAX_INGEST = 100 * 1024 * 1024; // los JSON canónicos pesan hasta ~15 MB

function log(obj) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
}

function createApp(opts = {}) {
  const cfg = { ...config, ...opts };
  const modules = opts.modules || MODULES;
  const findModule = (slug) => modules.find((m) => m.slug === slug && m.ownia) || null;
  const projects = new Map(); // slug -> GasProject | Error
  const apiCache = opts.apiCache !== undefined ? opts.apiCache : new ApiCache();   // respuestas de las funciones `cacheFns` (ver api-cache.js)
  const fileStore = opts.fileStore !== undefined ? opts.fileStore : createFileStore(cfg, log);
  const notesStore = opts.notesStore !== undefined ? opts.notesStore : createNotesStore(cfg);
  // "Actualizar reales" de la portada: solo el equipo B2B (y con contraseña). Ver reales-job.js.
  const reales = opts.reales !== undefined ? opts.reales : createRealesJob(cfg, { log });
  const realesUsers = (opts.realesUsers || EQUIPO_B2B).map((x) => x.toLowerCase());
  const mayRunReales = (identity) => !!reales && !!identity.email && realesUsers.includes(String(identity.email).toLowerCase());
  // Preguntas del buscador de la portada: las registra cualquiera; las lee solo el equipo B2B (misma lista que "Actualizar reales").
  const questionLog = opts.questionLog !== undefined ? opts.questionLog : createQuestionLog(notesStore, log);
  const isTeam = (identity) => !!identity.email && realesUsers.includes(String(identity.email).toLowerCase());
  // Datos nuevos → se recargan los módulos. En GAS cada ejecución arranca con los globales
  // limpios; acá el contexto vive entre requests, y varios módulos memorizan el JSON en una
  // variable global (p.ej. _gestionalJsonCache_): sin esto seguirían sirviendo la versión vieja.
  // Solo se recargan los módulos que leen algún archivo cambiado: recargar pierde su caché en
  // memoria, y el mirror sube archivos del Daily varias veces por día que el Hub no lee.
  const manifest = opts.manifest || loadManifest();
  const readsFile = (slug, id) => {
    const spec = manifest.modules[slug];
    if (!spec) return true; // sin entrada en el manifest: conservador
    if ((spec.files && id in spec.files) || (spec.sheets && id in spec.sheets)) return true;
    const f = fileStore.get(id);
    if (!f) return true; // borrado: sin metadata para saber de qué carpeta era
    const names = (spec.folders || {})[f.meta.folderId];
    return !!names && names.includes(f.meta.name);
  };
  if (fileStore) {
    fileStore.onChange((ids) => {
      for (const slug of [...projects.keys()]) {
        if (ids.some((id) => readsFile(slug, id))) { projects.delete(slug); if (apiCache) apiCache.dropModule(slug); }
      }
    });
  }
  // Qué se puede subir por /ingest: solo los archivos del manifest de los módulos servidos acá.
  const allowed = ingestAllowlist(modules, manifest);
  const clientJs = fs.readFileSync(path.join(cfg.APP_ROOT, 'public', 'gas-client.js'), 'utf8');
  const clientVersion = crypto.createHash('sha1').update(clientJs).digest('hex').slice(0, 10);
  const navJs = fs.readFileSync(path.join(cfg.APP_ROOT, 'public', 'ownia-nav.js'), 'utf8');
  const navVersion = crypto.createHash('sha1').update(navJs).digest('hex').slice(0, 10);
  // Buscador de la portada: usa el mismo diccionario de filtros que la barra "Filtrar…" del P&L Dashboard.
  const askJs = ['filter-aliases.js', 'portal-ask.js'].map((f) => fs.readFileSync(path.join(cfg.APP_ROOT, 'public', f), 'utf8')).join('\n');
  const askVersion = crypto.createHash('sha1').update(askJs).digest('hex').slice(0, 10);
  // Layout propio de Ownia para un módulo (`layout` en modules.js: un archivo de public/ o una lista,
  // que se cargan en ese orden): cambia la presentación sin tocar el HTML de GAS. Se sirve en
  // /_gas/layout/<archivo>.
  const layouts = new Map();
  const layoutFiles = (m) => (m.ownia && m.layout ? [].concat(m.layout) : []);
  for (const m of modules) {
    for (const file of layoutFiles(m)) {
      if (!/^[\w-]+\.js$/.test(file)) throw new Error(`layout inválido en ${m.slug}: ${file}`);
      const js = fs.readFileSync(path.join(cfg.APP_ROOT, 'public', file), 'utf8');
      layouts.set(file, { js, version: crypto.createHash('sha1').update(js).digest('hex').slice(0, 10) });
    }
  }
  // Links del header a otra landing (por deployment ID de GAS): el Hub → menú de Ownia; los
  // módulos ya servidos acá → su versión de Ownia (ver public/ownia-nav.js).
  const homeUrl = `${cfg.BASE_PATH}/`;
  const navLinks = {};
  for (const m of modules) {
    const id = /\/s\/([\w-]+)\/exec/.exec(m.gasUrl || '');
    if (!id) continue;
    if (m.slug === 'hub') navLinks[id[1]] = homeUrl;
    else if (m.ownia) navLinks[id[1]] = `${cfg.BASE_PATH}/${m.slug}`;
  }
  const navLinksAttr = escapeHtml(JSON.stringify(navLinks));
  const startedAt = new Date().toISOString();

  function getProject(mod) {
    if (!projects.has(mod.slug)) {
      try {
        projects.set(mod.slug, new GasProject(mod, { gasRoot: cfg.GAS_ROOT, secrets: cfg.secrets, log, timeoutMs: cfg.CALL_TIMEOUT_MS, fileStore }));
        log({ level: 'info', msg: 'módulo cargado', module: mod.slug });
      } catch (e) {
        log({ level: 'error', msg: 'no se pudo cargar el módulo', module: mod.slug, error: e.stack || String(e) });
        projects.set(mod.slug, e);
      }
    }
    const p = projects.get(mod.slug);
    if (p instanceof Error) throw p;
    return p;
  }

  // Precarga de los módulos migrados: un error de carga se ve en los logs al arrancar.
  function warmUp() {
    for (const m of modules.filter((x) => x.ownia)) {
      try { getProject(m); } catch (e) { /* ya logueado */ }
    }
  }

  function send(res, status, headers, body) {
    res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(body);
  }

  function unauthorized(res) {
    return sendJson(res, 401, { error: 'Se requiere un usuario @despegar.com identificado', name: 'NoAutorizado' });
  }

  // Un módulo con datos sin identidad confiable no se sirve (ver modules.js).
  const needsIdentity = (mod) => mod.requiresIdentity !== false;

  // allowedUsers: lista cerrada de cuentas (p.ej. módulos en validación). Sin lista, alcanza
  // con cualquier @despegar.com identificado.
  function mayOpen(mod, identity) {
    if (needsIdentity(mod) && !identity.email) return false;
    if (!Array.isArray(mod.allowedUsers)) return true;
    return mod.allowedUsers.map((x) => x.toLowerCase()).includes(String(identity.email).toLowerCase());
  }

  function forbidden(res) {
    return sendJson(res, 403, { error: 'Este módulo está en validación y solo lo puede abrir el equipo B2B', name: 'Forbidden' });
  }

  function sendJson(res, status, obj) {
    send(res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify(obj));
  }

  // JS propios (cliente, nav, buscador, layouts): siempre se piden con ?v=<hash del contenido>, así que con el hash
  // correcto son inmutables (un deploy que los cambia cambia la URL). Se comprimen una vez y se guardan.
  const assetGz = new Map();
  function sendAsset(req, res, url, version, js) {
    const cc = url.searchParams.get('v') === version ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
    const headers = { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': cc, Vary: 'Accept-Encoding' };
    if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return send(res, 200, headers, js);
    if (!assetGz.has(js)) assetGz.set(js, zlib.gzipSync(Buffer.from(js, 'utf8'), { level: 9 }));
    return send(res, 200, { ...headers, 'Content-Encoding': 'gzip' }, assetGz.get(js));
  }

  async function sendCompressible(req, res, status, headers, body) {
    const accepts = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
    if (!accepts || typeof body !== 'string' || body.length < GZIP_MIN_BYTES) return send(res, status, headers, body);
    const zipped = await gzip(Buffer.from(body, 'utf8'), { level: 4 });
    return send(res, status, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }, zipped);
  }

  function readBody(req, max = MAX_BODY, raw = false) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > max) {
          req.removeAllListeners('data');
          req.resume(); // descarta el resto sin acumularlo; el 413 sale por el catch
          reject(Object.assign(new Error('payload demasiado grande'), { status: 413, name: 'PayloadTooLarge' }));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve(raw ? buf : buf.toString('utf8'));
      });
      req.on('error', reject);
    });
  }

  function publicOrigin(req) {
    let host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
    if (!/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) host = 'localhost'; // nada raro en ScriptApp.getUrl()
    // Detrás de Ownia siempre es https (Caddy/ALB); en local, http.
    const proto = req.headers['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https');
    return `${String(proto).split(',')[0] === 'http' ? 'http' : 'https'}://${host}`;
  }

  // Caddy puede reenviar la ruta con o sin el prefijo /<appname>: se aceptan las dos.
  function stripBase(pathname) {
    const base = cfg.BASE_PATH;
    if (base && (pathname === base || pathname.startsWith(base + '/'))) return pathname.slice(base.length) || '/';
    return pathname;
  }

  function gasEvent(url, pathInfo) {
    const parameter = {};
    const parameters = {};
    for (const [k, v] of url.searchParams) {
      if (!(k in parameter)) parameter[k] = v;
      (parameters[k] = parameters[k] || []).push(v);
    }
    return { parameter, parameters, queryString: url.search.replace(/^\?/, ''), pathInfo, contextPath: '', contentLength: -1 };
  }

  // Comparación en tiempo constante (sobre hashes, así el largo tampoco se filtra).
  function tokenOk(req) {
    if (!cfg.INGEST_TOKEN) return false;
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    if (!m) return false;
    const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
    return crypto.timingSafeEqual(h(m[1].trim()), h(cfg.INGEST_TOKEN));
  }

  // Ruta del espejo de Drive. Metadata en headers: X-File-Name, X-Folder-Id (opcional),
  // X-Updated-At (modifiedTime de Drive, ISO) y Content-Type; cuerpo = contenido, opcionalmente
  // con Content-Encoding: gzip.
  async function handleIngest(req, res, route) {
    // Sin token configurado o sin almacén, la ruta no existe.
    if (!cfg.INGEST_TOKEN || !fileStore) return sendJson(res, 404, { error: 'No encontrado' });
    if (!tokenOk(req)) return sendJson(res, 401, { error: 'Token inválido', name: 'NoAutorizado' });
    if (route === '/ingest/files') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido' });
      return sendJson(res, 200, { files: fileStore.listMeta(), lastRefresh: fileStore.lastRefresh });
    }
    const id = route.slice('/ingest/files/'.length);
    if (!isValidId(id)) return sendJson(res, 400, { error: 'id inválido' });
    if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Método no permitido' });
    let name;
    try {
      name = decodeURIComponent(String(req.headers['x-file-name'] || id));
    } catch (e) {
      return sendJson(res, 400, { error: 'X-File-Name mal codificado' });
    }
    const folderId = req.headers['x-folder-id'] || null;
    // Con el token no alcanza: el archivo tiene que estar en el manifest (un token filtrado no
    // puede pisar otro id ni inventar uno).
    if (!allowed.files.has(id) && !(folderId && allowed.folders.has(`${folderId}/${name}`))) {
      return sendJson(res, 403, { error: `El archivo ${id} (${name}) no está en server/drive-manifest.json para un módulo servido en Ownia` });
    }
    const updatedAt = Date.parse(String(req.headers['x-updated-at'] || ''));
    if (updatedAt > Date.now() + 86400000) return sendJson(res, 400, { error: 'X-Updated-At en el futuro' });
    try {
      let body = await readBody(req, MAX_INGEST, true);
      const enc = String(req.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') body = await gunzip(body, { maxOutputLength: MAX_INGEST * 4 });
      else if (enc && enc !== 'identity') return sendJson(res, 415, { error: `Content-Encoding ${enc} no soportado` });
      const meta = await fileStore.put({
        id,
        name,
        folderId,
        mimeType: String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim(),
        updatedAt,
      }, body);
      const by = resolveIdentity(req.headers, cfg.TRUSTED_IDENTITY_HEADER).email || null;
      log({ level: 'info', msg: 'archivo espejado', id, name: meta.name, size: meta.size, updatedAt: new Date(meta.updatedAt).toISOString(), by });
      return sendJson(res, 200, { file: meta });
    } catch (e) {
      const status = e.status || (e.code === 'Z_DATA_ERROR' ? 400 : 500);
      if (status >= 500) log({ level: 'error', msg: 'ingest falló', id, error: e.stack || String(e) });
      return sendJson(res, status, { error: e.message || String(e) });
    }
  }

  async function handle(req, res) {
    const t0 = Date.now();
    let cacheState;   // 'hit' | 'miss' en las funciones cacheadas de /api
    const url = new URL(req.url, 'http://local');
    let route;
    try {
      route = stripBase(decodeURIComponent(url.pathname));
    } catch (e) {
      return sendJson(res, 400, { error: 'URL inválida' });
    }
    const identity = resolveIdentity(req.headers, cfg.TRUSTED_IDENTITY_HEADER);
    res.on('finish', () => {
      if (route === '/health') return; // el ALB pega cada pocos segundos
      log({ level: 'info', method: req.method, path: route, status: res.statusCode, ms: Date.now() - t0, user: identity.email || null, ...(cacheState ? { cache: cacheState } : {}) });
    });

    if (route === '/health' || route === '/healthz') {
      // Siempre 200 (si no, el ALB mataría la instancia por un problema de datos), pero informa
      // si el almacén cargó: una instancia sin datos se ve acá.
      const data = fileStore
        ? { files: fileStore.files.size, lastRefresh: fileStore.lastRefresh, error: fileStore.lastError }
        : null;
      return sendJson(res, 200, { status: 'ok', startedAt, data });
    }
    // Antes del chequeo de identidad: lo usa un script (el espejo), no una persona.
    if (route === '/ingest/files' || route.startsWith('/ingest/files/')) return handleIngest(req, res, route);
    if (cfg.REQUIRE_IDENTITY && !identity.email) return unauthorized(res);
    if (route === '/whoami') {
      return sendJson(res, 200, {
        email: identity.email || null,
        source: identity.source,
        trustedHeader: cfg.TRUSTED_IDENTITY_HEADER || null,
        authHeaders: describeAuthHeaders(req.headers),
      });
    }
    if (route === '/_gas/client.js') {
      return sendAsset(req, res, url, clientVersion, clientJs);
    }
    if (route === '/_gas/nav.js') {
      return sendAsset(req, res, url, navVersion, navJs);
    }
    if (route === '/_portal/ask.js') {
      return sendAsset(req, res, url, askVersion, askJs);
    }
    if (route.startsWith('/_gas/layout/')) {
      const l = layouts.get(route.slice('/_gas/layout/'.length));
      if (!l) return sendJson(res, 404, { error: 'No encontrado' });
      return sendAsset(req, res, url, l.version, l.js);
    }
    if (route === '/' || route === '') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido' });
      const ask = {
        js: `${cfg.BASE_PATH}/_portal/ask.js?v=${askVersion}`,
        partners: partnersFrom(fileStore),
        logUrl: `${cfg.BASE_PATH}/preguntas`,
        questionsUrl: isTeam(identity) ? `${cfg.BASE_PATH}/preguntas` : null,
      };
      return sendCompressible(req, res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, indexPage({ modules, basePath: cfg.BASE_PATH, canOpen: (m) => mayOpen(m, identity), reales: mayRunReales(identity), ask }));
    }

    if (route === '/preguntas') {
      if (!identity.email) return unauthorized(res);
      if (req.method === 'GET') {
        if (!isTeam(identity)) return sendJson(res, 403, { error: 'Solo el equipo B2B puede ver las preguntas', name: 'Forbidden' });
        const mes = url.searchParams.get('mes') || new Date().toISOString().slice(0, 7);
        try {
          const rows = await questionLog.month(mes);
          if (url.searchParams.get('formato') === 'json') return sendJson(res, 200, { mes, preguntas: rows });
          return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, questionsPage({ basePath: cfg.BASE_PATH, mes, rows }));
        } catch (e) {
          const status = e.status || 500;
          if (status >= 500) log({ level: 'error', msg: 'preguntas: lectura falló', error: e.stack || String(e) });
          return sendJson(res, status, { error: e.message || String(e) });
        }
      }
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });
      // Mismo anti-CSRF que /api y /notes: JSON + header custom + same-origin.
      const ctype = String(req.headers['content-type'] || '');
      const site = req.headers['sec-fetch-site'];
      if (!/^application\/json\s*(;|$)/i.test(ctype) || req.headers['x-requested-with'] !== 'google.script.run' || (site && site !== 'same-origin')) {
        return sendJson(res, 403, { error: 'Llamada rechazada', name: 'Forbidden' });
      }
      try {
        const body = JSON.parse(await readBody(req, 16 * 1024));
        return sendJson(res, 200, { id: await questionLog.add(body, identity.email) });
      } catch (e) {
        const status = e.status || (e instanceof SyntaxError ? 400 : 500);
        if (status >= 500) log({ level: 'error', msg: 'preguntas: registro falló', error: e.stack || String(e) });
        return sendJson(res, status, { error: e.message || String(e) });
      }
    }

    if (route === '/reales') {
      if (!identity.email) return unauthorized(res);
      if (!mayRunReales(identity)) return sendJson(res, 403, { error: 'Solo el equipo B2B puede actualizar los reales', name: 'Forbidden' });
      // Fecha de los datos que ve Ownia: la del JSON principal del Daily en el almacén.
      const daily = fileStore ? fileStore.listMeta().find((f) => f.name === 'daily_b2b2c_data.json') : null;
      const dataUpdatedAt = daily ? new Date(daily.updatedAt).toISOString() : null;
      if (req.method === 'GET') return sendJson(res, 200, { ...reales.status(), dataUpdatedAt });
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });
      // Mismo anti-CSRF que /api y /notes: JSON + header custom + same-origin.
      const ctype = String(req.headers['content-type'] || '');
      const site = req.headers['sec-fetch-site'];
      if (!/^application\/json\s*(;|$)/i.test(ctype) || req.headers['x-requested-with'] !== 'google.script.run' || (site && site !== 'same-origin')) {
        return sendJson(res, 403, { error: 'Llamada rechazada', name: 'Forbidden' });
      }
      let body;
      try { body = JSON.parse(await readBody(req, 4 * 1024)); } catch (e) {
        if (e.status) return sendJson(res, e.status, { error: e.message });
        return sendJson(res, 400, { error: 'JSON inválido' });
      }
      const r = reales.start(identity.email, typeof body.password === 'string' ? body.password : '');
      if (!r.ok) return sendJson(res, r.code, { error: r.error });
      return sendJson(res, 202, { ...r.status, dataUpdatedAt });
    }

    if (route === '/agentes') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido' });
      return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, agentsPage({ basePath: cfg.BASE_PATH }));
    }

    const parts = route.split('/').filter(Boolean);

    // GET|POST /notes/<modulo>/<scope> — notas editables (mismos permisos que el módulo).
    if (parts[0] === 'notes') {
      const mod = findModule(parts[1]);
      if (!notesStore || !mod || parts.length !== 3) return sendJson(res, 404, { error: 'No encontrado' });
      if (!identity.email) return unauthorized(res);
      if (!mayOpen(mod, identity)) return forbidden(res);
      try {
        // Scopes con editores propios (`noteEditors` en modules.js): lo puede leer el que abre el módulo, pero escribir solo esa lista.
        const editors = mod.noteEditors && mod.noteEditors[parts[2]];
        const canEdit = !editors || editors.map((x) => x.toLowerCase()).includes(String(identity.email).toLowerCase());
        if (req.method === 'GET') return sendJson(res, 200, { notes: await notesStore.get(mod.slug, parts[2]), canEdit });
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });
        if (!canEdit) return sendJson(res, 403, { error: 'No tenés permiso para editar esto' });
        // Mismo anti-CSRF que /api: JSON + header custom + same-origin.
        const ctype = String(req.headers['content-type'] || '');
        const site = req.headers['sec-fetch-site'];
        if (!/^application\/json\s*(;|$)/i.test(ctype) || req.headers['x-requested-with'] !== 'google.script.run' || (site && site !== 'same-origin')) {
          return sendJson(res, 403, { error: 'Llamada rechazada', name: 'Forbidden' });
        }
        let body;
        try { body = JSON.parse(await readBody(req, 64 * 1024)); } catch (e) {
          if (e.status) throw e;
          return sendJson(res, 400, { error: 'JSON inválido' });
        }
        const note = await notesStore.put(mod.slug, parts[2], String(body.field || ''), body.text, identity.email);
        log({ level: 'info', msg: 'nota guardada', module: mod.slug, scope: parts[2], field: body.field, by: identity.email });
        return sendJson(res, 200, { note });
      } catch (e) {
        const status = e.status || 500;
        if (status >= 500) log({ level: 'error', msg: 'notas falló', module: parts[1], error: e.stack || String(e) });
        return sendJson(res, status, { error: e.message || String(e) });
      }
    }

    // POST /api/<modulo>/<fn>  — google.script.run
    if (parts[0] === 'api') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });
      const mod = findModule(parts[1]);
      if (!mod || parts.length !== 3) return sendJson(res, 404, { error: 'Módulo no encontrado' });
      if (needsIdentity(mod) && !identity.email) return unauthorized(res);
      if (!mayOpen(mod, identity)) return forbidden(res);
      // Anti-CSRF: un <form> cross-site no puede mandar headers custom ni Content-Type JSON
      // sin preflight; el navegador marca Sec-Fetch-Site. (Otras apps de Ownia comparten el
      // origen ownia.despegar.io: eso no lo cubre — ver CONTEXT.md.)
      const ctype = String(req.headers['content-type'] || '');
      const site = req.headers['sec-fetch-site'];
      if (!/^application\/json\s*(;|$)/i.test(ctype) || req.headers['x-requested-with'] !== 'google.script.run' || (site && site !== 'same-origin')) {
        return sendJson(res, 403, { error: 'Llamada rechazada', name: 'Forbidden' });
      }
      let project;
      try { project = getProject(mod); } catch (e) { return sendJson(res, 500, { error: 'El módulo no pudo cargarse', name: 'LoadError' }); }
      try {
        const raw = await readBody(req);
        let body;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch (e) {
          return sendJson(res, 400, { error: 'JSON inválido', name: 'BadRequest' });
        }
        const args = Array.isArray(body.args) ? body.args : [];
        const reqCtx = { user: identity, userAgent: req.headers['user-agent'] || '', moduleUrl: `${publicOrigin(req)}${cfg.BASE_PATH}/${mod.slug}` };
        // Funciones que devuelven lo mismo para todos mientras no cambien los datos (`cacheFns` del módulo): se calcula una vez y se reparte
        // el gzip ya armado. La clave lleva el día para que no dependan de un cambio de fecha sin datos nuevos.
        if (apiCache && Array.isArray(mod.cacheFns) && mod.cacheFns.includes(parts[2])) {
          const key = `${mod.slug}|${parts[2]}|${JSON.stringify(args)}|${new Date().toISOString().slice(0, 10)}`;
          let ent = apiCache.get(key);
          cacheState = ent ? 'hit' : 'miss';
          if (!ent) {
            // Varias funciones GAS devuelven el error como { success: false } en vez de tirarlo: eso no se guarda (se reintenta).
            const flags = { noStore: false };
            ent = apiCache.set(key, mod.slug, (async () => {
              const result = project.call(parts[2], JSON.stringify(args), reqCtx);
              if (result && result.success === false) flags.noStore = true;
              return gzip(Buffer.from(JSON.stringify({ result: result === undefined ? null : result }), 'utf8'), { level: 4 });
            })());
            ent.flags = flags;
          }
          const gz = await ent.promise;
          if (ent.flags && ent.flags.noStore) apiCache.delete(key, ent);
          const hdrs = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
          if (/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return send(res, 200, { ...hdrs, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }, gz);
          return send(res, 200, hdrs, (await gunzip(gz)).toString('utf8'));
        }
        const result = project.call(parts[2], JSON.stringify(args), reqCtx);
        // Como en GAS: undefined viaja como null.
        return await sendCompressible(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
          JSON.stringify({ result: result === undefined ? null : result }));
      } catch (e) {
        const status = e.status || 500;
        if (status >= 500) log({ level: 'error', module: mod.slug, fn: parts[2], error: e.stack || String(e) });
        return sendJson(res, status, { error: e.message || String(e), name: e.name || 'Error' });
      }
    }

    // GET /<modulo>[/pathInfo]  — doGet(e)
    const mod = findModule(parts[0]);
    if (!mod) return sendJson(res, 404, { error: 'No encontrado' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Método no permitido' });
    if (needsIdentity(mod) && !identity.email) return unauthorized(res);
    if (!mayOpen(mod, identity)) return forbidden(res);
    try {
      const project = getProject(mod);
      const reqCtx = { user: identity, userAgent: req.headers['user-agent'] || '', moduleUrl: `${publicOrigin(req)}${cfg.BASE_PATH}/${mod.slug}` };
      const output = project.doGet(gasEvent(url, parts.slice(1).join('/')), reqCtx);
      const clientScriptTag = `<script src="${cfg.BASE_PATH}/_gas/client.js?v=${clientVersion}" data-api="${cfg.BASE_PATH}/api/${mod.slug}"></script>\n` +
        `<script src="${cfg.BASE_PATH}/_gas/nav.js?v=${navVersion}" data-home="${escapeHtml(homeUrl)}" data-links="${navLinksAttr}"` +
        (mod.startView ? ` data-start-view="${escapeHtml(mod.startView)}"` : '') + '></script>' +
        layoutFiles(mod).map((file) =>
          `\n<script src="${cfg.BASE_PATH}/_gas/layout/${file}?v=${layouts.get(file).version}" data-home="${escapeHtml(homeUrl)}" data-links="${navLinksAttr}"></script>`
        ).join('');
      const out = renderOutput(output, { clientScriptTag });
      if (req.method === 'HEAD') return send(res, out.status, out.headers, '');
      return await sendCompressible(req, res, out.status, out.headers, out.body);
    } catch (e) {
      log({ level: 'error', module: mod.slug, msg: 'doGet falló', error: e.stack || String(e) });
      return send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, `Error al abrir ${mod.title}: ${e.message}`);
    }
  }

  const handler = (req, res) => {
    handle(req, res).catch((e) => {
      log({ level: 'error', msg: 'error no controlado', error: e.stack || String(e) });
      if (!res.headersSent) sendJson(res, 500, { error: 'Error interno' });
      else res.end();
    });
  };
  // Carga inicial del almacén + polling (las subidas llegan a una sola instancia).
  async function startData() {
    if (!fileStore) return;
    try {
      await fileStore.refresh();
    } catch (e) {
      log({ level: 'error', msg: 'file-store: carga inicial falló', error: e.stack || String(e) });
    }
    fileStore.startPolling(cfg.FILE_STORE_POLL_MS);
  }

  return { handler, warmUp, startData, fileStore };
}

if (require.main === module) {
  const app = createApp();
  app.startData().then(() => app.warmUp());
  http.createServer(app.handler).listen(config.PORT, () => {
    log({ level: 'info', msg: 'b2b-ecosystem escuchando', port: config.PORT, basePath: config.BASE_PATH, gasRoot: config.GAS_ROOT, tz: process.env.TZ, tzOffsetMin: new Date().getTimezoneOffset() });
  });
}

module.exports = { createApp };
