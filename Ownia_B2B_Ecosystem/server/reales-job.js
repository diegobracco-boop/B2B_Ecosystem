// "Actualizar reales" (botón de la portada, 2026-10-30, Tiago): corre en el servidor de Ownia el mismo
// Daily_Dashboard/daily_sync.py que antes lanzaba el Task Scheduler de una PC (auto_update_reales.ps1):
// Datalake → JSON → Drive (lo siguen leyendo las landings de Apps Script) + Ownia (doble escritura de
// ownia_publish.py, que publica en este mismo servidor por /ingest). Así la actualización no depende de
// ninguna PC prendida.
//
// - Una corrida por vez; el estado y las últimas líneas de la salida quedan en memoria para la portada
//   (y cada línea va al log de la app). Un redeploy en medio corta la corrida: se vuelve a tocar el botón.
// - Credenciales, todas de APP_SECRETS (manage_app_secrets de Ownia, nunca en el repo):
//     DATALAKE_USER / DATALAKE_PASSWORD   usuario del Datalake (Trino por HTTPS, sin ODBC)
//     DRIVE_CLIENT_ID / DRIVE_CLIENT_SECRET   cliente OAuth de clasp (el mismo en los dos tokens de abajo)
//     DRIVE_REFRESH_TOKEN                 refresh_token de ~/.clasprc.json (sube a Drive, como en la PC)
//     DRIVE_READ_REFRESH_TOKEN            refresh_token de credenciales/drive_token.<usuario>.json (drive.readonly:
//                                         lee los canónicos para flow_oc; opcional)
//     REALES_PASSWORD                     la contraseña que pide el botón
//   Van sueltos y no como un JSON entero: manage_app_secrets convierte en objeto un valor que parece JSON y lo
//   rechaza. Con ellos se arman ~/.clasprc.json y el token de lectura en una carpeta temporal propia de la
//   corrida (HOME del proceso), que se borra al terminar; el pipeline renueva el access token solo (vence en 1970).
// - Los .py los copia scripts/sync-to-ownia-repo.js a pipelines/ (mismas rutas que en el monorepo).
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_LINES = 300;
const TIMEOUT_MS = 45 * 60 * 1000;   // en la PC tarda ~7 min
const REQUIRED = ['DATALAKE_USER', 'DATALAKE_PASSWORD', 'DRIVE_CLIENT_ID', 'DRIVE_CLIENT_SECRET', 'DRIVE_REFRESH_TOKEN', 'REALES_PASSWORD'];
const SECRET_KEYS = ['DATALAKE_PASSWORD', 'DRIVE_CLIENT_SECRET', 'DRIVE_REFRESH_TOKEN', 'DRIVE_READ_REFRESH_TOKEN', 'REALES_PASSWORD'];
// Contraseña equivocada: hasta 5 intentos cada 15 minutos por usuario.
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
// Consultas al Datalake de una corrida completa (líneas "OK <consulta>: N filas" de daily_sync.py; 32 el
// 2026-10-30). Solo sirve para la barra de avance: si cambia, la barra se queda en 80 % un rato o salta.
const EXPECTED_QUERIES = 32;
// Memoria mínima del contenedor para lanzar la corrida: daily_sync.py llega a ~2,7 GB (medido el 2026-10-30) y corre al
// lado de la app. Con menos, el sistema lo mata a mitad de camino (o peor, a Node). El tamaño por defecto de una app
// JavaScript en Ownia es 1 GB: hace falta que un admin de Ownia la agrande (manage_app resize, p.ej. 1024 / 4096).
// Se puede pisar con el secreto REALES_MIN_MEMORY_MB (0 = no chequear).
const MIN_MEMORY_MB = 3584;

// Barra de avance a partir de la salida de daily_sync.py: las consultas llevan hasta el 80 %; después,
// las etapas fijas del script. Nunca retrocede.
const STAGES = [
  [/^--- Agregando ---/, 82, 'Armando los archivos'],
  [/^--- OC B2B2C/, 85, 'Armando los archivos'],
  [/^--- Subiendo a Google Drive ---/, 88, 'Publicando en Drive y Ownia'],
  [/^--- Partners API/, 96, 'Últimos ajustes (Partners API y OKR)'],
  [/^OK Completado/, 100, 'Listo'],
];
function newProgress() {
  return { pct: 0, stage: 'Arrancando', queries: 0, expected: EXPECTED_QUERIES, uploads: 0, floor: 0, waiting: false, warnings: [] };
}
// Avisos de daily_sync.py que no cortan la corrida (p.ej. "WARN Ownia: no se pudo publicar…", "AVISO: NO se sube…"):
// se muestran aunque termine bien. Los reintentos de una consulta ("WARN <consulta> intento N") no cuentan.
const WARN_RE = /^\s*(\*\*\*\s*)?(WARN|AVISO)\b/;
const RETRY_RE = /^\s*WARN .+ intento \d+ fallo/;
function advance(p, line) {
  if (WARN_RE.test(line) && !RETRY_RE.test(line) && p.warnings.length < 20) p.warnings.push(line.trim());
  if (/^\s+> .+ \.\.\.$/.test(line) && p.floor === 0) p.stage = 'Consultando el Datalake';
  if (/^\s+OK .+: [\d.,]+ filas en /.test(line)) { p.queries += 1; p.waiting = false; }
  if (/^\s+WAIT .*cola del Datalake llena/.test(line)) p.waiting = true;
  if (/^\s+(OK Drive:|DRY RUN:)/.test(line)) p.uploads += 1;
  for (const [re, floor, stage] of STAGES) if (re.test(line) && floor > p.floor) { p.floor = floor; p.stage = stage; }
  const q = 2 + 78 * Math.min(p.queries, p.expected) / p.expected;
  const f = p.floor + (p.floor === 88 ? Math.min(p.uploads, 5) * 1.6 : 0);
  p.pct = Math.max(p.pct, Math.round(Math.max(p.floor === 0 ? q : Math.max(q, f), f)));
  if (p.floor === 0 && p.queries) p.stage = `Consultando el Datalake (${Math.min(p.queries, p.expected)} de ${p.expected})`;
  if (p.waiting && p.floor === 0) p.stage = 'Datalake ocupado: esperando turno';
  return p;
}

// Límite de memoria del contenedor (cgroup v2 o v1), para el log de la corrida. null si no se sabe.
function containerMemoryMb() {
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const v = fs.readFileSync(f, 'utf8').trim();
      if (/^\d+$/.test(v) && Number(v) < 2 ** 50) return Math.round(Number(v) / 2 ** 20);
    } catch (e) { /* no existe en este sistema */ }
  }
  return null;
}

function resolvePipelinesDir(appRoot) {
  if (process.env.PIPELINES_DIR) return path.resolve(process.env.PIPELINES_DIR);
  const bundled = path.join(appRoot, 'pipelines');   // repo de Ownia
  if (fs.existsSync(bundled)) return bundled;
  return path.resolve(appRoot, '..');                // monorepo
}

const secrets_ = (cfg) => cfg.secrets || {};

function sameSecret(a, b) {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

/**
 * @param {object} cfg  config de la app (secrets, PORT, INGEST_TOKEN, APP_ROOT, TIME_ZONE)
 * @param {object} opts { log, spawn, python, pipelinesDir } — spawn/python/pipelinesDir se pisan en los tests
 */
function createRealesJob(cfg, opts = {}) {
  const log = opts.log || (() => {});
  const spawnFn = opts.spawn || spawn;
  const python = opts.python || process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const pipelinesDir = opts.pipelinesDir || resolvePipelinesDir(cfg.APP_ROOT);
  const memoryMb = opts.memoryMb !== undefined ? opts.memoryMb : containerMemoryMb();   // null = no se sabe (p.ej. en local)
  const minMemoryMb = secrets_(cfg).REALES_MIN_MEMORY_MB !== undefined ? Number(secrets_(cfg).REALES_MIN_MEMORY_MB) : MIN_MEMORY_MB;
  const script = path.join(pipelinesDir, 'Daily_Dashboard', 'daily_sync.py');
  const secrets = cfg.secrets || {};
  const run = { state: 'idle', startedAt: null, finishedAt: null, by: null, exitCode: null, lines: [], progress: newProgress() };
  const fails = new Map();   // email -> [timestamps]
  // Un traceback puede traer una credencial: los valores de los secretos (y lo que siga a Bearer / password= /
  // refresh_token) se tachan antes de guardar la línea o mandarla al log.
  const secretValues = SECRET_KEYS.map((k) => secrets[k]).concat(cfg.INGEST_TOKEN)
    .filter((v) => typeof v === 'string' && v.length >= 6);
  const redact = (line) => secretValues.reduce((s, v) => s.split(v).join('***'), line)
    .replace(/(Bearer\s+|(?:password|pwd|refresh_token|access_token|client_secret)["']?\s*[=:]\s*["']?)[^\s"',;&]+/gi, '$1***');

  // Carpetas de corridas que quedaron de un proceso anterior que murió sin limpiar (tienen tokens).
  try {
    for (const d of fs.readdirSync(os.tmpdir())) if (/^reales-/.test(d)) fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
  } catch (e) { /* sin permisos sobre tmp: nada que barrer */ }

  function missing() {
    const out = REQUIRED.filter((k) => !secrets[k]);
    if (!cfg.INGEST_TOKEN) out.push('INGEST_TOKEN');
    if (!fs.existsSync(script)) out.push('pipelines/Daily_Dashboard/daily_sync.py');
    return out;
  }

  // null si alcanza la memoria (o no se puede saber); si no, el texto del motivo.
  function memoryProblem() {
    if (!minMemoryMb || memoryMb === null || memoryMb >= minMemoryMb) return null;
    return `El servidor de Ownia tiene ${memoryMb.toLocaleString('es-AR')} MB de memoria y la actualización necesita unos ` +
      `${minMemoryMb.toLocaleString('es-AR')} MB. Hay que pedirle a un admin de Ownia que agrande la app b2b-ecosystem ` +
      '(1 vCPU / 4 GB). Mientras tanto, se sigue corriendo desde una PC.';
  }

  function push(text) {
    for (const raw of String(text).split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const line = redact(raw);
      run.lines.push(line);
      advance(run.progress, line);
      log({ level: 'info', msg: 'reales', line });
    }
    if (run.lines.length > MAX_LINES) run.lines.splice(0, run.lines.length - MAX_LINES);
  }

  // Un 'data' de stdout puede cortar una línea a la mitad: se junta hasta el salto de línea.
  function lineReader() {
    let rest = '';
    return {
      data(chunk) {
        const parts = (rest + chunk).split(/\r?\n/);
        rest = parts.pop();
        if (parts.length) push(parts.join('\n'));
      },
      end() { if (rest) push(rest); rest = ''; },
    };
  }

  function status() {
    const { pct, stage, warnings } = run.progress;
    return {
      state: run.state, startedAt: run.startedAt, finishedAt: run.finishedAt, by: run.by, exitCode: run.exitCode,
      progress: { pct, stage }, warnings: warnings.slice(), lines: run.lines.slice(-40), configured: missing().length === 0,
      blocked: memoryProblem(),
    };
  }

  function tooManyFails(email) {
    const now = Date.now();
    const recent = (fails.get(email) || []).filter((t) => now - t < FAIL_WINDOW_MS);
    fails.set(email, recent);
    return recent.length >= MAX_FAILS;
  }

  /** Arranca una corrida. Devuelve { ok, status } o { ok: false, code, error }. */
  function start(email, password) {
    if (tooManyFails(email)) return { ok: false, code: 429, error: 'Demasiados intentos con la contraseña equivocada. Probá de nuevo en 15 minutos.' };
    if (!secrets.REALES_PASSWORD || !sameSecret(password || '', secrets.REALES_PASSWORD)) {
      if (secrets.REALES_PASSWORD) fails.get(email).push(Date.now());
      log({ level: 'warn', msg: 'reales: contraseña equivocada', by: email });
      return { ok: false, code: 403, error: 'Contraseña incorrecta.' };
    }
    const faltan = missing();
    if (faltan.length) return { ok: false, code: 503, error: `Falta configurar en Ownia: ${faltan.join(', ')}` };
    if (run.state === 'running') return { ok: false, code: 409, error: `Ya hay una actualización corriendo (la lanzó ${run.by}).` };
    const memo = memoryProblem();
    if (memo) {
      log({ level: 'warn', msg: 'reales: no arranca por memoria', memoryMb, minMemoryMb, by: email });
      return { ok: false, code: 503, error: memo };
    }

    // HOME propio de la corrida: ahí van los tokens de Drive (el pipeline busca ~/.clasprc.json).
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'reales-'));
    const client = { client_id: secrets.DRIVE_CLIENT_ID, client_secret: secrets.DRIVE_CLIENT_SECRET };
    const clasp = { tokens: { default: { access_token: '', refresh_token: secrets.DRIVE_REFRESH_TOKEN, ...client, expiry_date: 0, token_type: 'Bearer' } } };
    fs.writeFileSync(path.join(home, '.clasprc.json'), JSON.stringify(clasp), { mode: 0o600 });
    const env = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: home,
      LANG: 'C.UTF-8',
      TZ: cfg.TIME_ZONE || process.env.TZ || 'America/Argentina/Buenos_Aires',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONDONTWRITEBYTECODE: '1',
      // daily_sync.py lee USER / PASSWORD (las mismas variables de credenciales/.env.<usuario>).
      USER: secrets.DATALAKE_USER,
      PASSWORD: secrets.DATALAKE_PASSWORD,
      USERNAME: 'ownia',
      DATALAKE_HOST: secrets.DATALAKE_HOST || 'datalake.despegar.com',
      // Doble escritura: ownia_publish.py sube a este mismo servidor (http solo a 127.0.0.1).
      OWNIA_URL: `http://127.0.0.1:${cfg.PORT}`,
      OWNIA_INGEST_TOKEN: cfg.INGEST_TOKEN,
      // 4 consultas a la vez y no 6 como en la PC: la cola de Trino del usuario es chica (QUERY_QUEUE_FULL en la primera
      // corrida desde Ownia, 2026-10-30). daily_sync.py además espera y reintenta si la cola se llena igual.
      DAILY_FETCH_WORKERS: secrets.DAILY_FETCH_WORKERS || '4',
    };
    if (secrets.DRIVE_READ_REFRESH_TOKEN) {
      env.DRIVE_READ_TOKEN_FILE = path.join(home, 'drive_read_token.json');
      const read = { refresh_token: secrets.DRIVE_READ_REFRESH_TOKEN, ...client, token_uri: 'https://oauth2.googleapis.com/token',
        scopes: ['https://www.googleapis.com/auth/drive.readonly'] };
      fs.writeFileSync(env.DRIVE_READ_TOKEN_FILE, JSON.stringify(read), { mode: 0o600 });
    }

    Object.assign(run, { state: 'running', startedAt: new Date().toISOString(), finishedAt: null, by: email, exitCode: null, lines: [], progress: newProgress() });
    log({ level: 'info', msg: 'reales: arranca la actualización', by: email });
    if (memoryMb) push(`Memoria del contenedor: ${memoryMb.toLocaleString('es-AR')} MB`);
    let done = false;
    let timer = null;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fs.rmSync(home, { recursive: true, force: true });
      Object.assign(run, { state: code === 0 ? 'ok' : 'error', finishedAt: new Date().toISOString(), exitCode: code });
      log({ level: code === 0 ? 'info' : 'error', msg: 'reales: terminó la actualización', exitCode: code, by: email });
    };
    let child;
    try {
      child = spawnFn(python, [script], { cwd: path.dirname(script), env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      push(`No se pudo lanzar ${python}: ${e.message}`);
      finish(-1);
      return { ok: true, status: status() };
    }
    timer = setTimeout(() => { push(`Cortado: pasaron ${TIMEOUT_MS / 60000} minutos sin terminar.`); child.kill('SIGKILL'); }, TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();   // el corte no mantiene vivo el proceso (tests, apagado)
    const out = lineReader();
    const err = lineReader();
    // utf8 en el stream: un carácter de varios bytes cortado entre dos 'data' no se rompe.
    for (const s of [child.stdout, child.stderr]) if (typeof s.setEncoding === 'function') s.setEncoding('utf8');
    child.stdout.on('data', (d) => out.data(d));
    child.stderr.on('data', (d) => err.data(d));
    child.on('error', (e) => { push(`No se pudo lanzar ${python}: ${e.message}`); finish(-1); });
    child.on('close', (code, signal) => {
      out.end();
      err.end();
      // SIGKILL sin que lo pidamos = casi siempre el contenedor se quedó sin memoria.
      if (code === null) push(`El proceso se cortó (señal ${signal || 'desconocida'})${signal === 'SIGKILL' ? ': posible falta de memoria del contenedor' : ''}.`);
      finish(code === null ? -1 : code);
    });
    return { ok: true, status: status() };
  }

  return { start, status, missing };
}

module.exports = { createRealesJob, resolvePipelinesDir, newProgress, advance, EXPECTED_QUERIES };
