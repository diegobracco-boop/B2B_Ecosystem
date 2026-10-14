// P&L Profit Sharing · Banco de Chile — backend
// Data source: banco_chile_profit_sharing.json (lo genera profit_sharing_sync.py desde
// banco_chile_profit_sharing.sql). Toda la lógica de negocio vive en el .sql; acá solo se lee.
var PS_FOLDER_ID = '1dwIAlZLG5C5EOWGMm_rEFFKMgGQMRWIR';   // carpeta propia de Profit Sharing (movido 2026-10-14)
var PS_JSON_NAME = 'banco_chile_profit_sharing.json';

function doGet() {
  return HtmlService.createTemplateFromFile('dashboard').evaluate()
    .setTitle('P&L Profit Sharing · Banco de Chile')
    .addMetaTag('viewport', 'width=device-width,initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Devuelve el JSON crudo como string (el frontend agrega y filtra: son ~600 filas).
// Sin CacheService: el JSON pasa los 100 KB que admite una entrada de cache.
function getData() {
  var it = DriveApp.getFolderById(PS_FOLDER_ID).getFilesByName(PS_JSON_NAME);
  if (!it.hasNext()) throw new Error('No está ' + PS_JSON_NAME + ' en Drive: correr profit_sharing_sync.py');
  var f = it.next();
  if (it.hasNext()) Logger.log('WARN: hay más de un ' + PS_JSON_NAME + ' en la carpeta; se lee ' + f.getId());
  return f.getBlob().getDataAsString();
}
