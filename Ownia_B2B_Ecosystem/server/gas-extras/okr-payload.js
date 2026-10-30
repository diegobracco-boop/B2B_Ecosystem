// Solo Ownia: se carga en el proyecto de OKR Producto B2B2C (gasExtras en server/modules.js), después de su
// código, y reemplaza su loadJSON_. En Apps Script los datos viajan embebidos en okr_data.js (OKR_PAYLOAD, lo
// genera okr_sync.py y lo sube clasp; no se versiona). Acá el mismo payload llega como JSON por el espejo:
// okr_sync.py lo sube a esta carpeta de Drive y a Ownia (doble escritura, mirror/ownia_publish.py).
// Sin CacheService: el JSON pesa ~30 KB y el módulo se recarga solo cuando llega una versión nueva.
var OKR_FOLDER_ID = '1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh';
var OKR_PAYLOAD_JSON = 'okr_tribu_producto.json';

function loadJSON_() {
  var it;
  try {
    it = DriveApp.getFolderById(OKR_FOLDER_ID).getFilesByName(OKR_PAYLOAD_JSON);
  } catch (e) {
    throw new Error('Sin datos: corré okr_sync.py');
  }
  if (!it.hasNext()) throw new Error('Sin datos: corré okr_sync.py');
  return JSON.parse(it.next().getBlob().getDataAsString());
}
