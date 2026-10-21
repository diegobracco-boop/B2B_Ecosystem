// Servidor HTTP de la app b2b-ecosystem en Ownia (sin dependencias externas).
//
//   GET  <base>/                     portada con los módulos
//   GET  <base>/health               health check (lo usa el ALB vía Caddy)
//   GET  <base>/whoami               diagnóstico de identidad (qué headers de auth llegan)
//   GET  <base>/<modulo>[/...]       doGet(e) del módulo GAS
//   POST <base>/api/<modulo>/<fn>    google.script.run.<fn>(...args)
//   GET  <base>/_gas/client.js       shim de google.script.run
const config = require('./config');

// Antes de cualquier Date: el proceso corre en la zona de los proyectos GAS (ver config.js).
process.env.TZ = config.TIME_ZONE;

const fs = require('fs');
const http = require('http');
const path = require('path');
const { MODULES } = require('./modules');
const { GasProject } = require('./gas-runtime');
const { renderOutput } = require('./render');
const { indexPage } = require('./index-page');
const { resolveIdentity, describeAuthHeaders } = require('./identity');

const MAX_BODY = 5 * 1024 * 1024; // google.script.run acepta payloads grandes (p.ej. capturas)

function log(obj) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
}

function createApp(opts = {}) {
  const cfg = { ...config, ...opts };
  const modules = opts.modules || MODULES;
  const findModule = (slug) => modules.find((m) => m.slug === slug && m.ownia) || null;
  const projects = new Map(); // slug -> GasProject | Error
  const clientJs = fs.readFileSync(path.join(cfg.APP_ROOT, 'public', 'gas-client.js'), 'utf8');
  const clientVersion = require('crypto').createHash('sha1').update(clientJs).digest('hex').slice(0, 10);
  const startedAt = new Date().toISOString();

  function getProject(mod) {
    if (!projects.has(mod.slug)) {
      try {
        projects.set(mod.slug, new GasProject(mod, { gasRoot: cfg.GAS_ROOT, secrets: cfg.secrets, log, timeoutMs: cfg.CALL_TIMEOUT_MS }));
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

  function sendJson(res, status, obj) {
    send(res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify(obj));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          req.removeAllListeners('data');
          req.resume(); // descarta el resto sin acumularlo; el 413 sale por el catch
          reject(Object.assign(new Error('payload demasiado grande'), { status: 413, name: 'PayloadTooLarge' }));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
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

  async function handle(req, res) {
    const t0 = Date.now();
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
      log({ level: 'info', method: req.method, path: route, status: res.statusCode, ms: Date.now() - t0, user: identity.email || null });
    });

    if (route === '/health' || route === '/healthz') {
      return sendJson(res, 200, { status: 'ok', startedAt });
    }
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
      return send(res, 200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }, clientJs);
    }
    if (route === '/' || route === '') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido' });
      return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, indexPage({ modules, basePath: cfg.BASE_PATH }));
    }

    const parts = route.split('/').filter(Boolean);

    // POST /api/<modulo>/<fn>  — google.script.run
    if (parts[0] === 'api') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });
      const mod = findModule(parts[1]);
      if (!mod || parts.length !== 3) return sendJson(res, 404, { error: 'Módulo no encontrado' });
      if (needsIdentity(mod) && !identity.email) return unauthorized(res);
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
        const result = project.call(parts[2], JSON.stringify(args), reqCtx);
        // Como en GAS: undefined viaja como null.
        return sendJson(res, 200, { result: result === undefined ? null : result });
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
    try {
      const project = getProject(mod);
      const reqCtx = { user: identity, userAgent: req.headers['user-agent'] || '', moduleUrl: `${publicOrigin(req)}${cfg.BASE_PATH}/${mod.slug}` };
      const output = project.doGet(gasEvent(url, parts.slice(1).join('/')), reqCtx);
      const clientScriptTag = `<script src="${cfg.BASE_PATH}/_gas/client.js?v=${clientVersion}" data-api="${cfg.BASE_PATH}/api/${mod.slug}"></script>`;
      const out = renderOutput(output, { clientScriptTag });
      return send(res, out.status, out.headers, req.method === 'HEAD' ? '' : out.body);
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
  return { handler, warmUp };
}

if (require.main === module) {
  const app = createApp();
  app.warmUp();
  http.createServer(app.handler).listen(config.PORT, () => {
    log({ level: 'info', msg: 'b2b-ecosystem escuchando', port: config.PORT, basePath: config.BASE_PATH, gasRoot: config.GAS_ROOT, tz: process.env.TZ, tzOffsetMin: new Date().getTimezoneOffset() });
  });
}

module.exports = { createApp };
