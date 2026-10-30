// Flow · B2B Ecosystem — Flow semanal (gestional) + Flow mensual (contable) en una sola entrada.
// Solo Ownia (2026-10-27): no hay landing de Apps Script de este módulo. La página (flow.html) embebe el Flow semanal del Daily
// (?flowdeck=1) y las Slides mensuales del Hub (?slides=1&embedded=1) y suma el cuadro de comentarios con envío por mail.
function doGet() {
  return HtmlService.createTemplateFromFile('flow').evaluate()
    .setTitle('Presentaciones · B2B Ecosystem · Despegar')
    .addMetaTag('viewport', 'width=device-width,initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// FCA mensual de los KRs de los OKR H2 (2026-10-30): lo arma el agente fca-specialist (FCA/ en el repo) y lo publica
// FCA/fca_publish.py en fca.json ({months: {AAAA-MM: {meta, items}}}). Lo lee la pestaña FCA (flow.html, ?fca=1).
var FCA_FILE_ID = '1OT3RdA2Llcf21fdcvRKoMdcMTZvOJB1E';
function getFca() {
  return DriveApp.getFileById(FCA_FILE_ID).getBlob().getDataAsString();
}
