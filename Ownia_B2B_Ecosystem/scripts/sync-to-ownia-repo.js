#!/usr/bin/env node
// Arma el contenido del repo que deploya Ownia (despegar/ownia-b2b-ecosystem) a partir de
// este monorepo: la app (server/, public/, test/, scripts/, package.json, docs) + una copia
// de los archivos GAS de los módulos migrados en gas/<Modulo>/.
//
// Ownia solo deploya repos de la org despegar, y este monorepo vive en otra cuenta: por eso
// la fuente de verdad sigue siendo ESTE repo y el de Ownia es un espejo generado. No editar
// el repo de Ownia a mano.
//
// Seguridad (auditoría 2026-10-21):
//  - el destino tiene que ser un clon cuyo origin sea despegar/ownia-b2b-ecosystem y estar
//    FUERA del monorepo (comparación por realpath, sin distinguir mayúsculas en Windows);
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
const EXPECTED_REMOTE = /[/:]despegar\/ownia-b2b-ecosystem(\.git)?\/?$/i;

// Lo único que este script escribe/borra en el destino. Cualquier otra cosa se respeta.
const APP_ENTRIES = ['server', 'public', 'test', 'scripts', 'package.json', 'CONTEXT.md', 'Dockerfile', '.dockerignore'];
// .gitignore se escribe aparte: el del monorepo ignora gas/, que en el espejo SÍ se versiona.
const MANAGED = [...APP_ENTRIES, 'gas', 'README.md', '.gitignore'];

// Archivos GAS que se copian (lo mismo que sube clasp; nada de .py, .md ni datos).
const GAS_EXT = new Set(['.js', '.gs', '.html', '.json']);
const SECRET_RE = /(^|\/)(token[^/]*|credentials[^/]*|\.env(\.[^/]*)?|\.clasprc\.json|\.clasp\.json)$/i;

const MIRROR_GITIGNORE = ['node_modules/', '# Secretos: nunca en el espejo', '**/token*', '**/credentials*', '**/.env', '**/.env.*', ''].join('\n');

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
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
    fail('El origin del destino no es despegar/ownia-b2b-ecosystem. Abortado.');
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
  const sources = [APP_DIRNAME, ...modules.map((m) => m.dir)];
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

  const sha = git(MONOREPO, ['rev-parse', 'HEAD']).trim();
  fs.mkdirSync(path.join(target, 'gas'), { recursive: true });
  fs.writeFileSync(
    path.join(target, 'gas', 'MANIFEST.json'),
    JSON.stringify({ source: `B2B_Ecosystem/${APP_DIRNAME}`, monorepoCommit: sha, modules: copied }, null, 2) + '\n'
  );
  fs.writeFileSync(path.join(target, '.gitignore'), MIRROR_GITIGNORE);
  fs.writeFileSync(
    path.join(target, 'README.md'),
    [
      '# b2b-ecosystem (Ownia)',
      '',
      `Espejo GENERADO de \`${APP_DIRNAME}/\` del monorepo B2B_Ecosystem — no editar a mano.`,
      'Se regenera con `node scripts/sync-to-ownia-repo.js <clon>` desde el monorepo.',
      '',
      `Commit de origen: \`${sha}\` · Módulos GAS incluidos: ${copied.join(', ')}`,
      '',
      'Documentación: ver `CONTEXT.md`.',
      '',
    ].join('\n')
  );

  console.log(`Sincronizado (commit ${sha.slice(0, 7)}; módulos: ${copied.join(', ')})`);
}

main();
