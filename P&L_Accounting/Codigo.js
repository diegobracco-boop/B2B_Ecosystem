// P&L Accounting — entry point.
// Backends de datos: Codigo_contable_epm.js (vista EPM) y Codigo_contable.js (Model+Accounting).

// Desde 2026-10-30 el productivo es Ownia: acá (Apps Script) solo queda el aviso con el link. Ownia corre este
// mismo código, pero ahí getUrl() devuelve su propia URL y sigue abriendo el dashboard.
var OWNIA_URL_ = 'https://ownia.despegar.io/b2b-ecosystem/pnl-accounting';

function doGet() {
  if (/^https:\/\/script\.google\.com\//.test(ScriptApp.getService().getUrl() || '')) {
    return movedToOwnia_('P&L Accounting', OWNIA_URL_);
  }
  return HtmlService.createTemplateFromFile('dashboard').evaluate()
    .setTitle('P&L Accounting · Despegar')
    .addMetaTag('viewport','width=device-width,initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function movedToOwnia_(title, url) {
  var html = '<!DOCTYPE html><html lang="es-AR"><head><meta charset="utf-8"><base target="_top">' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#1d1d1f;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Poppins,sans-serif}main{text-align:center;padding:24px;max-width:480px}' +
    'h1{font-size:28px;font-weight:600;letter-spacing:-.02em;margin:0 0 10px}p{color:#6e6e73;font-size:16px;line-height:1.5;margin:0 0 24px}' +
    'a{display:inline-block;padding:12px 22px;border-radius:999px;background:#550fed;color:#fff;text-decoration:none;font-weight:500}</style></head>' +
    '<body><main><h1>' + title + ' se mudó a Ownia</h1>' +
    '<p>Esta versión de Apps Script ya no se actualiza. El tablero sigue en Ownia, con los mismos datos.</p>' +
    '<a href="' + url + '">Abrir en Ownia</a></main></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title + ' · Despegar')
    .addMetaTag('viewport', 'width=device-width,initial-scale=1');
}
