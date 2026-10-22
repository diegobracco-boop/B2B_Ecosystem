// El manifest del espejo tiene que listar exactamente los archivos de Drive que lee el código
// GAS de cada módulo con datos servido en Ownia. Si falta uno, la landing en Ownia falla con
// "No item with the given ID"; si sobra, se espeja (y se acepta en /ingest) algo que nadie lee.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const config = require('../server/config');
const { MODULES } = require('../server/modules');
const { loadManifest } = require('../server/drive-manifest');

const manifest = loadManifest();

// var XXX_FILE_ID = '...'  /  var XXX_FOLDER_ID = '...'  /  var XXX_SHEET_ID = '...'  /  valores
// de CANONICAL_IDS_ (comillas simples o dobles).
function driveRefs(dir) {
  const files = new Set();
  const folders = new Set();
  const sheets = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => /^Codigo.*\.js$/.test(x))) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of code.matchAll(/var\s+\w*_FILE_ID\s*=\s*['"]([\w-]+)['"]/g)) files.add(m[1]);
    for (const m of code.matchAll(/var\s+\w*_FOLDER_ID\s*=\s*['"]([\w-]+)['"]/g)) folders.add(m[1]);
    for (const m of code.matchAll(/var\s+\w*_SHEET_ID\s*=\s*['"]([\w-]+)['"]/g)) sheets.add(m[1]);
    const canon = /var\s+CANONICAL_IDS_\s*=\s*\{([\s\S]*?)\}/.exec(code);
    if (canon) for (const m of canon[1].matchAll(/['"]([\w-]{20,})['"]/g)) files.add(m[1]);
  }
  return { files, folders, sheets };
}

for (const m of MODULES.filter((x) => x.ownia && x.requiresIdentity !== false)) {
  test(`manifest de "${m.slug}" = los ids de Drive de ${m.dir}`, () => {
    const spec = manifest.modules[m.slug];
    assert.ok(spec, `falta "${m.slug}" en server/drive-manifest.json`);
    const refs = driveRefs(path.join(config.GAS_ROOT, m.dir));
    assert.deepEqual(new Set(Object.keys(spec.files || {})), refs.files, 'archivos (*_FILE_ID / CANONICAL_IDS_)');
    assert.deepEqual(new Set(Object.keys(spec.folders || {})), refs.folders, 'carpetas (*_FOLDER_ID)');
    assert.deepEqual(new Set(Object.keys(spec.sheets || {})), refs.sheets, 'Google Sheets (*_SHEET_ID)');
  });
}
