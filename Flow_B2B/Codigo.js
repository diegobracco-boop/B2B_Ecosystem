// Flow · B2B Ecosystem — Flow semanal (gestional) + Flow mensual (contable) en una sola entrada.
// Solo Ownia (2026-10-27): no hay landing de Apps Script de este módulo. La página (flow.html) embebe el Flow semanal del Daily
// (?flowdeck=1) y las Slides mensuales del Hub (?slides=1&embedded=1) y suma el cuadro de comentarios con envío por mail.
function doGet() {
  return HtmlService.createTemplateFromFile('flow').evaluate()
    .setTitle('Flow · B2B Ecosystem · Despegar')
    .addMetaTag('viewport', 'width=device-width,initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
