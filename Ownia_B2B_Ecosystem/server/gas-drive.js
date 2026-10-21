// Shim de DriveApp (solo lectura) sobre el file-store: los módulos piden archivos por el
// mismo id de Drive que usan en Apps Script y reciben la copia espejada en Ownia, con el
// mismo nombre, carpeta y fecha de modificación.
//
// Escribir (createFile, setContent, setTrashed, …) tira ServicioNoMigrado: en Ownia los
// archivos solo los actualiza el espejo, nunca una landing.
const { ServicioNoMigrado, makeBlob } = require('./gas-services');

// Mismo mensaje que da Apps Script, así los try/catch de los módulos se comportan igual.
function notFound() {
  const e = new Error(
    'No item with the given ID could be found. Possibly because you have not edited this item or you do not have permission to access it.'
  );
  e.name = 'Exception';
  return e;
}

function iterator(items) {
  let i = 0;
  return {
    hasNext: () => i < items.length,
    next: () => {
      if (i >= items.length) {
        const e = new Error('Cannot retrieve the next object: iterator has reached the end.');
        e.name = 'Exception';
        throw e;
      }
      return items[i++];
    },
    getContinuationToken: () => null,
  };
}

const WRITE_METHODS = ['setContent', 'setName', 'setTrashed', 'setDescription', 'setSharing', 'moveTo', 'makeCopy',
  'addEditor', 'addViewer', 'removeEditor', 'removeViewer', 'createFile', 'createFolder', 'addFile', 'removeFile'];

function withWriteGuards(obj, kind) {
  for (const m of WRITE_METHODS) obj[m] = () => { throw new ServicioNoMigrado(kind, m); };
  return obj;
}

/**
 * @param {() => FileStore|null} getStore
 * @param {(ms:number) => Date} makeDate  crea el Date en el realm del módulo
 */
function makeDriveApp(getStore, makeDate) {
  // Sin almacén configurado (p.ej. tests, o la app sin datos) DriveApp se comporta como
  // un servicio no migrado: falla explícito, nunca devuelve vacío.
  const store = (member) => {
    const s = getStore();
    if (!s) throw new ServicioNoMigrado('DriveApp', member);
    return s;
  };

  function fileObj(entry) {
    const { meta } = entry;
    // El contenido se lee del store en cada getBlob(): si el espejo subió una versión nueva,
    // un File viejo no devuelve datos viejos.
    const current = () => store().get(meta.id) || entry;
    return withWriteGuards({
      getId: () => meta.id,
      getName: () => meta.name,
      getMimeType: () => meta.mimeType,
      getSize: () => current().buf.length,
      getLastUpdated: () => makeDate(current().meta.updatedAt),
      getDateCreated: () => makeDate(current().meta.updatedAt),
      getBlob: () => {
        const f = current();
        return makeBlob(f.buf, f.meta.mimeType, f.meta.name);
      },
      getAs: () => { throw new ServicioNoMigrado('File', 'getAs'); },
      getParents: () => iterator(meta.folderId ? [folderObj(meta.folderId)] : []),
      getUrl: () => `https://drive.google.com/file/d/${meta.id}/view`,
      isTrashed: () => false,
      toString: () => meta.name,
    }, 'File');
  }

  function folderObj(folderId) {
    return withWriteGuards({
      getId: () => folderId,
      getName: () => folderId, // el espejo no guarda el nombre de la carpeta (ningún módulo lo usa)
      getFilesByName: (name) => iterator(store().findByName(folderId, String(name)).map(fileObj)),
      getFiles: () => iterator(store().inFolder(folderId).map(fileObj)),
      getFolders: () => iterator([]),
      getUrl: () => `https://drive.google.com/drive/folders/${folderId}`,
      isTrashed: () => false,
    }, 'Folder');
  }

  const drive = {
    getFileById: (id) => {
      const entry = store('getFileById').get(String(id));
      if (!entry) throw notFound();
      return fileObj(entry);
    },
    // Una carpeta "existe" si el espejo tiene al menos un archivo en ella.
    getFolderById: (id) => {
      if (!store('getFolderById').hasFolder(String(id))) throw notFound();
      return folderObj(String(id));
    },
    MimeType: {
      GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet', PLAIN_TEXT: 'text/plain', JSON: 'application/json',
      CSV: 'text/csv', MICROSOFT_EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  };
  for (const m of ['createFile', 'createFolder', 'getRootFolder', 'searchFiles', 'searchFolders', 'getFilesByName', 'getFiles', 'getFolders', 'getFoldersByName', 'getStorageUsed']) {
    drive[m] = () => { throw new ServicioNoMigrado('DriveApp', m); };
  }
  return drive;
}

module.exports = { makeDriveApp };
