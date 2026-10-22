// Shim de SpreadsheetApp (server/gas-sheets.js) sobre un .xlsx como el que exporta el espejo.
// La fixture la arma openpyxl: hoja Input_OKR (fecha con formato, texto, número) y
// "Slide 1 Evolucion" con celdas sueltas en P37:S38 (texto "$1,22M", número, booleano).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeSpreadsheetApp, isDateFormat, serialToMs } = require('../server/gas-sheets');

const XLSX = fs.readFileSync(path.join(__dirname, 'fixtures', 'sheets_demo.xlsx'));
const ID = 'sheetFile0000000000001';
const TZ = 'America/Argentina/Buenos_Aires';

function app(buf = XLSX) {
  const store = { get: (id) => (id === ID ? { buf, meta: { id, name: 'Input dashboard', mimeType: 'application/vnd.google-apps.spreadsheet' } } : null) };
  return makeSpreadsheetApp(() => store, (ms) => new Date(ms), TZ);
}

test('SpreadsheetApp: getDataRange().getValues() con fecha, texto y número como en GAS', () => {
  const vals = app().openById(ID).getSheetByName('Input_OKR').getDataRange().getValues();
  assert.equal(vals.length, 3);
  assert.deepEqual(vals[0], ['Periodo', 'Escenario', 'LOB', 'Pais', 'Producto', 'KR', 'Valor']);
  assert.ok(vals[1][0] instanceof Date, 'celda con formato fecha → Date');
  // 1/10/2026 00:00 en Buenos Aires = 03:00 UTC
  assert.equal(vals[1][0].toISOString(), '2026-10-01T03:00:00.000Z');
  assert.equal(vals[1][3], '', 'vacía → ""');
  assert.equal(vals[1][6], 1250.5);
  assert.equal(vals[2][0], '01/11/2026', 'texto con pinta de fecha queda texto');
  assert.equal(vals[2][6], '1.300,25');
});

test('SpreadsheetApp: getRange por fila/col y A1, getLastRow/Column y hoja inexistente', () => {
  const sheet = app().openById(ID).getSheetByName('Slide 1 Evolucion');
  assert.equal(sheet.getLastRow(), 38);
  assert.equal(sheet.getLastColumn(), 19);
  const a = sheet.getRange(37, 16, 2, 4).getValues();
  assert.deepEqual(a, [['País', 'Actuals', '', ''], ['Total', '$1,22M', 1.5, true]]);
  assert.deepEqual(sheet.getRange('P37:S38').getValues(), a);
  assert.equal(sheet.getRange('R38').getValue(), 1.5);
  assert.equal(app().openById(ID).getSheetByName('No existe'), null);
  assert.deepEqual(app().openById(ID).getSheets().map((s) => s.getName()), ['Input_OKR', 'Slide 1 Evolucion']);
});

test('SpreadsheetApp: solo lectura, y un id fuera del espejo falla como en GAS', () => {
  const sheet = app().openById(ID).getSheetByName('Input_OKR');
  assert.throws(() => sheet.getRange(1, 1).setValue(1), /todavía no está disponible en Ownia/);
  assert.throws(() => sheet.appendRow([1]), /todavía no está disponible en Ownia/);
  assert.throws(() => app().openById('otro'), /Exception|openById/);
});

test('formatos de fecha y serial → instante en la zona de la planilla', () => {
  assert.ok(isDateFormat('dd/mm/yyyy'));
  assert.ok(isDateFormat('[$-409]mmm-yy'));
  assert.ok(!isDateFormat('#,##0.00 "M"'));
  assert.ok(!isDateFormat('0.00E+00'));
  assert.ok(!isDateFormat('General'));
  assert.equal(new Date(serialToMs(46296, TZ)).toISOString(), '2026-10-01T03:00:00.000Z');
});
