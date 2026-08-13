// P&L Accounting — entry point.
// Backends de datos: Codigo_contable_epm.js (vista EPM) y Codigo_contable.js (Model+Accounting).

function doGet() {
  return HtmlService.createTemplateFromFile('dashboard').evaluate()
    .setTitle('P&L Accounting · Despegar')
    .addMetaTag('viewport','width=device-width,initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
