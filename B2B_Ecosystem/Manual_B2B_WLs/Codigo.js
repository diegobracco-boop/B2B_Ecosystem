// Manual B2B WLs · Despegar — Apps Script Backend
function doGet() {
  return HtmlService.createTemplateFromFile('manual').evaluate()
    .setTitle('Manual · B2B Ecosystem · Despegar')
    .addMetaTag('viewport', 'width=device-width,initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
