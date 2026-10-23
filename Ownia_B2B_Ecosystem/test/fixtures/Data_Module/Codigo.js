// Proyecto GAS de prueba que lee datos de Drive como las landings reales (P&L_Managerial):
// JSON memorizado en un global, búsqueda por carpeta + nombre, y el xlsx de TC vía unzip +
// XmlService (mismo patrón que readFxTable_).
var JSON_FILE_ID = 'jsonFile000000000001';
var FOLDER_ID = 'folder00000000000001';
var FX_FILE_ID = 'fxFile00000000000001';

function doGet() {
  return HtmlService.createHtmlOutput('<p>data</p>');
}

var _jsonCache_ = null;
function leerJson() {
  if (!_jsonCache_) _jsonCache_ = JSON.parse(DriveApp.getFileById(JSON_FILE_ID).getBlob().getDataAsString());
  return _jsonCache_;
}

// Distinto en cada carga del módulo: para ver si un cambio de datos lo recargó.
var _CARGA_ = Math.random();
function idCarga() {
  return _CARGA_;
}

function fechaJson() {
  var d = DriveApp.getFileById(JSON_FILE_ID).getLastUpdated();
  return { t: d.getTime(), esDate: d instanceof Date };
}

function porNombre(nombre) {
  var it = DriveApp.getFolderById(FOLDER_ID).getFilesByName(nombre);
  return it.hasNext() ? JSON.parse(it.next().getBlob().getDataAsString()) : null;
}

function inexistente() {
  try {
    DriveApp.getFileById('noExiste0000000000001');
    return 'encontrado';
  } catch (e) {
    return String(e.message);
  }
}

function escribir() {
  return DriveApp.getFileById(JSON_FILE_ID).setContent('x');
}

function leerXlsx() {
  var blob = DriveApp.getFileById(FX_FILE_ID).getBlob().setContentType('application/zip');
  var parts = {};
  Utilities.unzip(blob).forEach(function(b) { parts[b.getName()] = b; });
  var sroot = XmlService.parse(parts['xl/sharedStrings.xml'].getDataAsString('UTF-8')).getRootElement();
  var sns = sroot.getNamespace();
  var shared = sroot.getChildren('si', sns).map(function(si) { return si.getChild('t', sns).getText(); });
  var root = XmlService.parse(parts['xl/worksheets/sheet1.xml'].getDataAsString('UTF-8')).getRootElement();
  var ns = root.getNamespace();
  return root.getChild('sheetData', ns).getChildren('row', ns).map(function(row) {
    var out = {};
    row.getChildren('c', ns).forEach(function(c) {
      var col = String(c.getAttribute('r').getValue()).replace(/\d+/g, '');
      var t = c.getAttribute('t') ? c.getAttribute('t').getValue() : '';
      var v = c.getChild('v', ns) ? c.getChild('v', ns).getText() : '';
      out[col] = t === 's' ? shared[parseInt(v, 10)] : v;
    });
    return out;
  });
}
