// Runtime de proyectos Apps Script: carga los .js/.gs de un módulo GAS tal como están en el
// repo dentro de un contexto vm aislado, con los servicios de GAS shimeados (gas-services.js).
// Así la lógica de negocio (agregaciones, reglas, cálculos) es literalmente el mismo código
// que corre en Apps Script — los números no pueden divergir por una reescritura.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { compileTemplate, escapeHtml } = require('./gas-template');
const svc = require('./gas-services');
const { makeDriveApp } = require('./gas-drive');
const { makeXmlService } = require('./gas-xml');
const { makeSpreadsheetApp } = require('./gas-sheets');

// Servicios que el runtime todavía no implementa. Usarlos tira ServicioNoMigrado.
// (DriveApp y SpreadsheetApp están, solo lectura, sobre el file-store: ver gas-drive.js y
// gas-sheets.js.)
const NOT_MIGRATED = [
  'Drive', 'Sheets', 'SlidesApp', 'Slides', 'DocumentApp',
  'MailApp', 'GmailApp', 'UrlFetchApp', 'CalendarApp', 'FormApp', 'Jdbc', 'BigQuery',
];

const SERVER_EXT = new Set(['.js', '.gs']);

// Tope por ejecución de doGet / google.script.run. La ejecución es sincrónica: sin tope, una
// función colgada bloquearía a todos los usuarios y al /health. Queda por debajo del idle
// timeout del ALB (60 s).
const CALL_TIMEOUT_MS = 55000;

function listFiles(dir) {
  const out = [];
  const walk = (d, prefix) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === '__pycache__') continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full, prefix + ent.name + '/');
      else out.push({ full, rel: prefix + ent.name });
    }
  };
  walk(dir, '');
  // Orden ASCII (como clasp al subir; es el orden en que GAS ejecuta los archivos). localeCompare
  // ignora la puntuación y ponía "Codigo_country_page.js" antes que "Codigo.js": en el Hub, el top-level
  // de country_page usa fyRange_ de Codigo.js y no cargaba.
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

// Respeta .claspignore (globs simples: *, **, nombre de archivo/carpeta) para cargar
// exactamente lo que clasp sube a Apps Script.
function loadClaspIgnore(dir) {
  const f = path.join(dir, '.claspignore');
  if (!fs.existsSync(f)) return () => false;
  const rules = fs.readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const negations = rules.filter((r) => r.startsWith('!')).map((r) => globToRe(r.slice(1)));
  const ignores = rules.filter((r) => !r.startsWith('!')).map(globToRe);
  return (rel) => ignores.some((re) => re.test(rel)) && !negations.some((re) => re.test(rel));
}

function globToRe(glob) {
  const g = glob.replace(/^\.?\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // Un nombre sin barra matchea en cualquier nivel; una carpeta matchea todo lo de adentro.
  const prefix = g.includes('/') ? '^' : '^(?:.*/)?';
  return new RegExp(prefix + re + '(?:/.*)?$');
}

class GasProject {
  /**
   * @param {object} mod   entrada del registro (server/modules.js)
   * @param {object} opts  { gasRoot, secrets, log, timeoutMs, fileStore }
   */
  constructor(mod, opts) {
    this.mod = mod;
    this.dir = path.join(opts.gasRoot, mod.dir);
    this.secrets = opts.secrets || {};
    this.log = opts.log || ((o) => console.log(JSON.stringify(o)));
    this.request = null; // contexto de la request en curso (las llamadas GAS son sincrónicas)
    this.timeoutMs = opts.timeoutMs || CALL_TIMEOUT_MS;
    this.fileStore = opts.fileStore || null;
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.dir)) throw new Error(`No existe la carpeta GAS ${this.dir}`);
    const manifestPath = path.join(this.dir, 'appsscript.json');
    this.manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
    this.timeZone = this.manifest.timeZone || 'America/Argentina/Buenos_Aires';

    const ignored = loadClaspIgnore(this.dir);
    const files = listFiles(this.dir).filter((f) => !ignored(f.rel));
    this.serverFiles = files.filter((f) => SERVER_EXT.has(path.extname(f.rel)));
    // En GAS los archivos HTML se referencian por nombre sin extensión (con subcarpeta si la hay).
    this.htmlFiles = new Map(
      files.filter((f) => path.extname(f.rel) === '.html').map((f) => [f.rel.replace(/\.html$/, ''), f.full])
    );

    const globals = this._globals();
    const shimNames = new Set(Object.keys(globals));
    this.context = vm.createContext(globals, { name: `gas:${this.mod.slug}` });
    // Helpers creados DENTRO del realm del contexto: los objetos que recibe el código GAS
    // tienen que ser Array/Object de su propio realm (si no, `x instanceof Array` da false).
    this._parseJson = vm.runInContext('(function (s) { return JSON.parse(s); })', this.context);
    this._makeDate = vm.runInContext('(function (t) { return new Date(t); })', this.context);

    for (const f of this.serverFiles) {
      const code = fs.readFileSync(f.full, 'utf8');
      new vm.Script(code, { filename: `${this.mod.dir}/${f.rel}` }).runInContext(this.context, { timeout: CALL_TIMEOUT_MS });
    }

    // Allowlist de lo invocable desde el cliente: SOLO funciones globales declaradas por el
    // proyecto GAS (nunca shims, heredadas de Object.prototype como `constructor`, ni privadas).
    this.callable = new Set(
      Object.keys(this.context).filter(
        (k) => !shimNames.has(k) && typeof this.context[k] === 'function' && isCallableName(k)
      )
    );
    // Invocación con timeout: vm solo corta por tiempo dentro de runInContext.
    this._invoke = new vm.Script('__owniaInvoke_()', { filename: `${this.mod.dir}/<invoke>` });
  }

  _run(fn, args) {
    let result;
    this.context.__owniaInvoke_ = () => { result = fn.apply(null, args); };
    try {
      this._invoke.runInContext(this.context, { timeout: this.timeoutMs });
    } finally {
      delete this.context.__owniaInvoke_;
    }
    return result;
  }

  _readHtml(name) {
    const file = this.htmlFiles.get(String(name).replace(/\.html$/, ''));
    if (!file) throw new Error(`No se encontró el archivo HTML "${name}" en ${this.mod.dir}`);
    return fs.readFileSync(file, 'utf8');
  }

  _template(source) {
    const project = this;
    const tpl = {};
    // Métodos no enumerables: así solo las propiedades que asigna el código (tpl.foo = ...)
    // quedan visibles como variables dentro de los scriptlets.
    const hidden = {
      evaluate() {
        const data = {};
        for (const k of Object.keys(tpl)) data[k] = tpl[k];
        const fn = vm.runInContext(compileTemplate(source), project.context, {
          filename: `${project.mod.dir}/<template>`,
        });
        return svc.makeHtmlOutput(fn(data, escapeHtml));
      },
      getRawContent: () => source,
      getCode: () => compileTemplate(source),
      getCodeWithComments: () => compileTemplate(source),
    };
    for (const [k, v] of Object.entries(hidden)) Object.defineProperty(tpl, k, { value: v, enumerable: false });
    return tpl;
  }

  _globals() {
    const project = this;
    const scriptCache = svc.makeMemoryCache();
    const userCaches = new Map();
    const userProps = new Map();
    const propsSeed = (this.secrets.GAS_PROPERTIES || {})[this.mod.slug] || {};
    const scriptProps = svc.makeProperties(propsSeed);
    const currentEmail = () => (project.request && project.request.user && project.request.user.email) || '';
    const logLine = (level, args) =>
      project.log({ level, module: project.mod.slug, msg: args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ') });

    const g = {
      console: {
        log: (...a) => logLine('info', a),
        info: (...a) => logLine('info', a),
        warn: (...a) => logLine('warn', a),
        error: (...a) => logLine('error', a),
      },
      Logger: {
        log: (fmt, ...a) => {
          let msg = String(fmt);
          a.forEach((v, i) => { msg = msg.replace('%s', typeof v === 'string' ? v : safeJson(v)).replace(`{${i}}`, String(v)); });
          logLine('info', [msg]);
        },
        clear() {},
        getLog: () => '',
      },
      HtmlService: {
        createHtmlOutput: (html) => svc.makeHtmlOutput(html && typeof html.getDataAsString === 'function' ? html.getDataAsString() : html),
        createHtmlOutputFromFile: (name) => svc.makeHtmlOutput(project._readHtml(name)),
        createTemplate: (html) => project._template(String(html && typeof html.getDataAsString === 'function' ? html.getDataAsString() : html)),
        createTemplateFromFile: (name) => project._template(project._readHtml(name)),
        XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
        SandboxMode: { IFRAME: 'IFRAME', NATIVE: 'NATIVE', EMULATED: 'EMULATED' },
        getUserAgent: () => (project.request && project.request.userAgent) || '',
      },
      ContentService: {
        createTextOutput: (c) => svc.makeTextOutput(c),
        MimeType: svc.ContentMimeType,
      },
      Session: {
        getActiveUser: () => ({ getEmail: currentEmail, toString: currentEmail }),
        // En GAS es quien deployó el script. Acá no hay equivalente: se configura en
        // APP_SECRETS.EFFECTIVE_USER_EMAIL (vacío si no está).
        getEffectiveUser: () => ({ getEmail: () => project.secrets.EFFECTIVE_USER_EMAIL || '' }),
        getScriptTimeZone: () => project.timeZone,
        getActiveUserLocale: () => 'es',
        getTemporaryActiveUserKey: () => currentEmail(),
      },
      Utilities: svc.makeUtilities(),
      CacheService: {
        getScriptCache: () => scriptCache,
        getUserCache: () => {
          const k = currentEmail();
          if (!userCaches.has(k)) userCaches.set(k, svc.makeMemoryCache());
          return userCaches.get(k);
        },
        getDocumentCache: () => null,
      },
      PropertiesService: {
        getScriptProperties: () => scriptProps,
        getUserProperties: () => {
          const k = currentEmail();
          if (!userProps.has(k)) userProps.set(k, svc.makeProperties({}));
          return userProps.get(k);
        },
        getDocumentProperties: () => null,
      },
      LockService: {
        getScriptLock: svc.makeLock,
        getUserLock: svc.makeLock,
        getDocumentLock: () => null,
      },
      ScriptApp: {
        getService: () => ({
          getUrl: () => (project.request && project.request.moduleUrl) || '',
          isEnabled: () => true,
        }),
        getScriptId: () => '',
        // Los triggers de GAS no corren en Ownia (siguen corriendo en Apps Script).
        getProjectTriggers: () => [],
        newTrigger: () => { throw new svc.ServicioNoMigrado('ScriptApp', 'newTrigger'); },
        deleteTrigger() {},
        getOAuthToken: () => { throw new svc.ServicioNoMigrado('ScriptApp', 'getOAuthToken'); },
        AuthMode: { NONE: 'NONE', CUSTOM_FUNCTION: 'CUSTOM_FUNCTION', LIMITED: 'LIMITED', FULL: 'FULL' },
      },
    };
    g.DriveApp = makeDriveApp(() => project.fileStore, (ms) => project._makeDate(ms));
    g.SpreadsheetApp = makeSpreadsheetApp(() => project.fileStore, (ms) => project._makeDate(ms), project.timeZone);
    g.XmlService = makeXmlService();
    for (const name of NOT_MIGRATED) g[name] = svc.notMigrated(name);
    return g;
  }

  _withRequest(req, fn) {
    this.request = req;
    try {
      return fn();
    } finally {
      this.request = null;
    }
  }

  /** Corre doGet(e). Devuelve el HtmlOutput / TextOutput que arma el módulo. */
  doGet(e, req) {
    if (typeof this.context.doGet !== 'function') throw new Error(`${this.mod.dir} no define doGet`);
    return this._withRequest(req, () => this._run(this.context.doGet, [e]));
  }

  /**
   * Equivalente de google.script.run.<fn>(...args): solo funciones globales públicas
   * (las que terminan en "_" son privadas en GAS y no se pueden llamar desde el cliente).
   */
  call(fnName, argsJson, req) {
    if (!this.callable.has(fnName)) {
      const err = new Error(`Script function not found: ${fnName}`);
      err.status = 404;
      throw err;
    }
    const fn = this.context[fnName];
    const args = this._parseJson(argsJson || '[]');
    return this._withRequest(req, () => this._run(fn, args));
  }
}

const RESERVED = new Set(['doGet', 'doPost', 'onOpen', 'onEdit', 'onInstall']);

function isCallableName(name) {
  return typeof name === 'string' && /^[A-Za-z$][\w$]*$/.test(name) && !name.endsWith('_') && !RESERVED.has(name);
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

module.exports = { GasProject, isCallableName, globToRe };
