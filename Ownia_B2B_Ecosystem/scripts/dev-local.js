// Versión "dev" local: la app de Ownia corriendo en tu máquina con el código del repo (sin commitear
// ni redeployar) y los datos espejados de Drive, para revisar un cambio antes de publicarlo.
//
// En local no hay Cloudflare adelante que identifique al usuario: este script pone tu mail como
// identidad en cada request y escucha SOLO en 127.0.0.1 (nadie de la red puede entrar ni mandar
// otro mail). No toca nada de producción.
//
// Uso (desde Ownia_B2B_Ecosystem/):
//   py mirror/ownia_mirror.py --to-dir _store      # bajar/actualizar los datos (solo lo que cambió)
//   node scripts/dev-local.js [tu.mail@despegar.com] [puerto]
//   → http://localhost:8098/b2b-ecosystem/
// Los cambios a los .html/.js de los módulos GAS se ven reiniciando el script.

process.env.TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';   // la de los appsscript.json (ver Dockerfile)
process.env.FILE_STORE_DIR = process.env.FILE_STORE_DIR || '_store';
process.env.BASE_PATH = process.env.BASE_PATH || '/b2b-ecosystem';
const DEV_HEADER = 'x-dev-email';
process.env.TRUSTED_IDENTITY_HEADER = DEV_HEADER;

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');

function defaultEmail() {
  try {
    const e = execSync('git config user.email', { encoding: 'utf8' }).trim().toLowerCase();
    if (e.endsWith('@despegar.com')) return e;
  } catch (e) { /* sin git */ }
  return '';
}

const email = String(process.argv[2] || defaultEmail()).toLowerCase();
const port = Number(process.argv[3]) || 8098;
if (!email.endsWith('@despegar.com')) {
  console.error('Pasá tu mail @despegar.com: node scripts/dev-local.js nombre.apellido@despegar.com');
  process.exit(1);
}
const storeDir = path.resolve(__dirname, '..', process.env.FILE_STORE_DIR);
if (!fs.existsSync(storeDir)) {
  console.error(`No existe ${storeDir}: corré primero  py mirror/ownia_mirror.py --to-dir _store`);
  process.exit(1);
}

const { createApp } = require('../server/index');
const app = createApp();
app.startData().then(() => app.warmUp());
http.createServer((req, res) => {
  req.headers[DEV_HEADER] = email;   // pisa cualquier valor que mande el navegador
  app.handler(req, res);
}).listen(port, '127.0.0.1', () => {
  console.log(`dev local → http://localhost:${port}${process.env.BASE_PATH}/   (como ${email}, datos de ${storeDir})`);
});
