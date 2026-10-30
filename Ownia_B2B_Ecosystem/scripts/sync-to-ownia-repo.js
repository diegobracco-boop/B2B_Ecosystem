#!/usr/bin/env node
// Arma lo que deploya Ownia (app b2b-ecosystem) a partir de este monorepo: la app (server/,
// public/, test/, scripts/, package.json, Dockerfile, docs) + una copia de los archivos GAS
// de los módulos migrados en gas/<Modulo>/.
//
// Destino: `main` de despegar/B2B_Ecosystem_APP, repo propio de la app (desde 2026-10-23; antes
// era la rama `b2b-ecosystem` de despegar/B2B_Ecosystem_Ownia, cuyo `main` es OTRA app,
// b2b-dashboard). Ownia solo deploya repos de la org despegar (este monorepo vive en otra
// cuenta) y deploya desde la RAÍZ del repo. El script se niega a escribir en otro repo o rama.
// La fuente de verdad sigue siendo ESTE repo; el espejo es generado: no editarlo a mano.
//
// Seguridad (auditoría 2026-10-21):
//  - el destino tiene que ser un clon cuyo origin sea despegar/B2B_Ecosystem_APP, parado
//    en la rama `main`, y estar FUERA del monorepo (comparación por realpath, sin
//    distinguir mayúsculas en Windows);
//  - solo se copian archivos versionados (git ls-files) y nunca token*/credentials*/.env*:
//    nada gitignoreado (tokens, okr_data.js, ...) puede terminar publicado en la org;
//  - se exige que lo copiado no tenga cambios sin commitear, así MANIFEST.json dice la verdad.
//
// Uso: node scripts/sync-to-ownia-repo.js <carpeta-del-clon-del-repo-ownia>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { MODULES } = require('../server/modules');

const APP = path.resolve(__dirname, '..');
const MONOREPO = path.resolve(APP, '..');
const APP_DIRNAME = path.basename(APP);
const EXPECTED_REPO = 'despegar/B2B_Ecosystem_APP';
const EXPECTED_REMOTE = /[/:]despegar\/B2B_Ecosystem_APP(\.git)?\/?$/i;
const MIRROR_BRANCH = 'main';

// Lo único que este script escribe/borra en el destino. Cualquier otra cosa se respeta.
const APP_ENTRIES = ['server', 'public', 'test', 'scripts', 'package.json', 'package-lock.json', 'CONTEXT.md', 'Dockerfile', '.dockerignore', 'requirements-pipelines.txt'];
// .gitignore se escribe aparte: el del monorepo ignora gas/, que en el espejo SÍ se versiona.
// README.md NO se toca: lo genera Ownia con datos de auditoría (quién/cuándo lo creó).
const MANAGED = [...APP_ENTRIES, 'gas', 'pipelines', 'LEEME_ESPEJO.md', '.gitignore'];

// Pipelines que corre el servidor (botón "Actualizar reales", server/reales-job.js): solo código, en
// pipelines/<misma ruta que en el monorepo> (daily_sync.py importa por ruta relativa Inputs_Planning_PnL/
// y Ownia_B2B_Ecosystem/mirror/). Nada de datos ni credenciales (SECRET_RE se aplica igual).
const PIPELINES = [
  { dir: 'Daily_Dashboard', ext: ['.py', '.sql'] },
  { dir: 'Inputs_Planning_PnL', ext: ['.py'] },
  { dir: `${APP_DIRNAME}/mirror`, ext: ['.py'] },
  { dir: `${APP_DIRNAME}/server`, ext: [], files: ['drive-manifest.json'] },   // lo lee ownia_publish.py
];

// Archivos GAS que se copian (lo mismo que sube clasp; nada de .py, .md ni datos).
const GAS_EXT = new Set(['.js', '.gs', '.html', '.json']);
const SECRET_RE = /(^|\/)(token[^/]*|credentials[^/]*|\.env(\.[^/]*)?|\.clasprc\.json|\.clasp\.json)$/i;

const MIRROR_GITIGNORE = ['node_modules/', '# Secretos: nunca en el espejo', '**/token*', '**/credentials*', '**/.env', '**/.env.*', ''].join('\n');

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

function git(cwd, args) {
  // stderr capturado: en una rama huérfana sin commits, rev-parse HEAD falla "a propósito".
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function canon(p) {
  const real = fs.realpathSync.native(p);
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

function checkTarget(target) {
  if (!fs.existsSync(path.join(target, '.git'))) fail(`${target} no es la raíz de un clon de git. Abortado.`);
  const t = canon(target);
  const mono = canon(MONOREPO);
  const rel = path.relative(mono, t);
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  const up = path.relative(t, mono);
  const ancestor = up === '' || (!up.startsWith('..') && !path.isAbsolute(up));
  if (inside || ancestor) fail('El destino no puede ser el monorepo, estar adentro ni contenerlo. Abortado.');
  let origin = '';
  try {
    origin = git(target, ['remote', 'get-url', 'origin']).trim();
  } catch (e) { /* sin origin */ }
  // La URL puede traer una credencial temporal embebida: no se imprime.
  if (!EXPECTED_REMOTE.test(origin.replace(/\/\/[^@/]*@/, '//'))) {
    fail(`El origin del destino no es ${EXPECTED_REPO}. Abortado.`);
  }
  let branch = '';
  try {
    branch = git(target, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  } catch (e) { /* rama huérfana sin commits todavía */ }
  if (!branch) {
    try { branch = git(target, ['symbolic-ref', '--short', 'HEAD']).trim(); } catch (e) { /* sin rama */ }
  }
  if (branch !== MIRROR_BRANCH) {
    fail(`El clon está en la rama "${branch}", no en "${MIRROR_BRANCH}". Abortado.`);
  }
}

// Archivos versionados bajo `rel` (relativo al monorepo), con su ruta relativa a `rel`.
function trackedFiles(rel) {
  const out = git(MONOREPO, ['ls-files', '-z', '--', rel]).split('\0').filter(Boolean);
  return out.map((f) => ({ full: path.join(MONOREPO, f), rel: path.posix.relative(rel.replace(/\\/g, '/'), f) }));
}

function main() {
  const dest = process.argv[2];
  if (!dest) fail('Uso: node scripts/sync-to-ownia-repo.js <carpeta-del-clon-del-repo-ownia>');
  const target = path.resolve(dest);
  checkTarget(target);

  const modules = MODULES.filter((x) => x.ownia);
  const sources = [APP_DIRNAME, ...modules.map((m) => m.dir), ...PIPELINES.map((x) => x.dir)];
  const dirty = git(MONOREPO, ['status', '--porcelain', '--', ...sources]).trim();
  if (dirty) fail(`Hay cambios sin commitear en lo que se sincroniza:\n${dirty}\nCommitealos primero.`);

  for (const entry of MANAGED) fs.rmSync(path.join(target, entry), { recursive: true, force: true });

  const copy = (from, to) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  };

  for (const f of trackedFiles(APP_DIRNAME)) {
    const top = f.rel.split('/')[0];
    if (!APP_ENTRIES.includes(top) || SECRET_RE.test(f.rel)) continue;
    copy(f.full, path.join(target, f.rel));
  }

  const copied = [];
  for (const m of modules) {
    for (const f of trackedFiles(m.dir)) {
      if (SECRET_RE.test(f.rel)) continue;
      if (!(GAS_EXT.has(path.extname(f.rel)) || path.basename(f.rel) === '.claspignore')) continue;
      copy(f.full, path.join(target, 'gas', m.dir, f.rel));
    }
    copied.push(m.dir);
  }

  for (const pl of PIPELINES) {
    for (const f of trackedFiles(pl.dir)) {
      if (f.rel.includes('/') || SECRET_RE.test(f.rel)) continue;   // solo el primer nivel de la carpeta
      if (!pl.ext.includes(path.extname(f.rel)) && !(pl.files || []).includes(f.rel)) continue;
      copy(f.full, path.join(target, 'pipelines', pl.dir, f.rel));
    }
  }

  const sha = git(MONOREPO, ['rev-parse', 'HEAD']).trim();
  fs.mkdirSync(path.join(target, 'gas'), { recursive: true });
  fs.writeFileSync(
    path.join(target, 'gas', 'MANIFEST.json'),
    JSON.stringify({ source: `B2B_Ecosystem/${APP_DIRNAME}`, monorepoCommit: sha, modules: copied }, null, 2) + '\n'
  );
  fs.writeFileSync(path.join(target, '.gitignore'), MIRROR_GITIGNORE);
  fs.writeFileSync(
    path.join(target, 'LEEME_ESPEJO.md'),
    [
      '# b2b-ecosystem (Ownia) — espejo generado',
      '',
      `Espejo GENERADO de \`${APP_DIRNAME}/\` del monorepo B2B_Ecosystem — no editar a mano.`,
      `Rama \`${MIRROR_BRANCH}\` de ${EXPECTED_REPO} → app de Ownia \`b2b-ecosystem\`.`,
      'Se regenera con `node scripts/sync-to-ownia-repo.js <clon>` desde el monorepo.',
      '',
      `Commit de origen: \`${sha}\` · Módulos GAS incluidos: ${copied.join(', ')}`,
      `Pipelines (pipelines/, para "Actualizar reales"): ${PIPELINES.map((x) => x.dir).join(', ')}`,
      '',
      'Documentación: ver `CONTEXT.md`.',
      '',
    ].join('\n')
  );

  console.log(`Sincronizado (commit ${sha.slice(0, 7)}; módulos: ${copied.join(', ')})`);
}

main();
