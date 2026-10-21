// Lista de archivos de Drive que lee cada módulo (drive-manifest.json). La usan:
//  - /ingest: solo acepta subir archivos de esta lista, de módulos servidos en Ownia;
//  - mirror/ownia_mirror.py: qué copiar de Drive;
//  - test/manifest.test.js: que coincida con los *_FILE_ID / *_FOLDER_ID del código GAS.
const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, 'drive-manifest.json');

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

/** { files: Set<id>, folders: Set<"folderId/nombre"> } de los módulos con ownia: true. */
function ingestAllowlist(modules, manifest = loadManifest()) {
  const files = new Set();
  const folders = new Set();
  for (const m of modules.filter((x) => x.ownia)) {
    const spec = manifest.modules[m.slug];
    if (!spec) continue;
    for (const id of Object.keys(spec.files || {})) files.add(id);
    for (const [folder, names] of Object.entries(spec.folders || {})) for (const n of names) folders.add(`${folder}/${n}`);
  }
  return { files, folders };
}

module.exports = { loadManifest, ingestAllowlist, MANIFEST_PATH };
