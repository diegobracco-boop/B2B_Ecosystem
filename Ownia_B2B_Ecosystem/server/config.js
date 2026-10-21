// Configuración de runtime. Todo sale de variables de entorno: Ownia inyecta BASE_PATH
// (= /<appname>) y APP_SECRETS (JSON de Secrets Manager). Nada de credenciales en el código.
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');

function parseSecrets() {
  try {
    return JSON.parse(process.env.APP_SECRETS || '{}');
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'APP_SECRETS no es JSON válido' }));
    return {};
  }
}

// Sin barra final; '' si la app corre en la raíz (desarrollo local).
function normalizeBasePath(p) {
  if (!p || p === '/') return '';
  return '/' + p.replace(/^\/+|\/+$/g, '');
}

// Dónde están los proyectos GAS:
//  - en el repo de Ownia, `scripts/sync-to-ownia-repo.js` los copia a <app>/gas/<Modulo>/
//  - en el monorepo B2B_Ecosystem son las carpetas hermanas (../<Modulo>/)
function resolveGasRoot() {
  if (process.env.GAS_ROOT) return path.resolve(process.env.GAS_ROOT);
  const bundled = path.join(APP_ROOT, 'gas');
  if (fs.existsSync(bundled)) return bundled;
  return path.resolve(APP_ROOT, '..');
}

const secrets = parseSecrets();

module.exports = {
  APP_ROOT,
  PORT: Number(process.env.PORT) || 8000,
  BASE_PATH: normalizeBasePath(process.env.BASE_PATH),
  GAS_ROOT: resolveGasRoot(),
  secrets,
  // Header que pone (y siempre pisa) el proxy de autenticación de adelante. Ver identity.js.
  TRUSTED_IDENTITY_HEADER: secrets.TRUSTED_IDENTITY_HEADER || process.env.TRUSTED_IDENTITY_HEADER || '',
  // Si es true, toda request sin identidad (salvo /health) devuelve 401. Hay que prenderlo
  // antes de migrar módulos con datos (ver CONTEXT.md, "Identidad").
  REQUIRE_IDENTITY: String(secrets.REQUIRE_IDENTITY || process.env.REQUIRE_IDENTITY || '') === 'true',
  // Zona horaria del proceso: en GAS el runtime JS usa la del proyecto (todos los
  // appsscript.json usan Buenos Aires). Sin esto, new Date().getMonth() & cía. darían
  // distinto que en GAS entre las 21 y las 24 hs (el contenedor corre en UTC).
  TIME_ZONE: process.env.GAS_TIME_ZONE || 'America/Argentina/Buenos_Aires',
  // Almacén de los archivos espejados de Drive (ver file-store.js). En local: una carpeta.
  FILE_STORE_DIR: process.env.FILE_STORE_DIR || '',
  // Cada cuánto cada instancia busca archivos nuevos en el almacén (las subidas llegan a una
  // sola instancia).
  FILE_STORE_POLL_MS: Number(process.env.FILE_STORE_POLL_MS) || 60000,
  // Token de la ruta /ingest (el script espejo lo manda como Bearer). Sin token, /ingest no existe.
  INGEST_TOKEN: secrets.INGEST_TOKEN || process.env.INGEST_TOKEN || '',
};
