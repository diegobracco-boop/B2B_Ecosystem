/* Daily B2B Tracker en Ownia — "Enviar a Google Slides" por pasos (2026-11-03). El Apps Script original manda todo en una sola llamada y acá
 * pasaba los ~60 s que aguanta el edge de Ownia (504). Misma captura que el original (_captureAllSlides de tracker.html), pero el servidor
 * arranca el envío en segundo plano (server/gslides-export.js) y esta página consulta el avance hasta que termina.
 * Lo inyecta server/index.js en el Daily (`layout` en server/modules.js); solo actúa en la página del Tracker. tracker.html no se toca.
 */
(function () {
  'use strict';
  var POLL_MS = 3000, MAX_MS = 10 * 60 * 1000;

  function fail(msg) { _exporting = false; _exportDone('Error al enviar a Google Slides: ' + msg); }
  function errText(e) { return e && e.message ? e.message : String(e); }

  function poll(jobId, t0) {
    var secs = Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > MAX_MS) return fail('tardó demasiado. Revisá la presentación y reintentá.');
    google.script.run
      .withSuccessHandler(function (st) {
        if (!st || st.state === 'error') return fail((st && st.error) || 'no se pudo actualizar la presentación.');
        if (st.state === 'done') { _exporting = false; return _exportDone('Listo ✓ ' + st.count + ' slides en Google Slides.', st.url); }
        updateExportOverlay('Actualizando la presentación en Google Slides… ' + secs + ' s (puede tardar un par de minutos)');
        setTimeout(function () { poll(jobId, t0); }, POLL_MS);
      })
      .withFailureHandler(function (e) {
        // Un corte de red al consultar no significa que falló el envío: se reintenta hasta el tope.
        setTimeout(function () { poll(jobId, t0); }, POLL_MS * 2);
        console.warn('[tracker-gslides] consulta de estado:', errText(e));
      })
      .exportToGoogleSlidesStatus(jobId);
  }

  async function exportSlidesToGoogleOwnia() {
    if (_exporting) return;
    _closeExportMenu();
    _exporting = true;
    try {
      showExportOverlay('Capturando slides…');
      var slides = await _captureAllSlides(function (done, total) { updateExportOverlay('Capturando slides… ' + done + ' / ' + total); }, { jpeg: true });
      updateExportOverlay('Subiendo las slides…');
      google.script.run
        .withSuccessHandler(function (r) {
          if (!r || !r.jobId) return fail('el servidor no confirmó el envío.');
          poll(r.jobId, Date.now());
        })
        .withFailureHandler(function (e) { fail(errText(e)); })
        .exportToGoogleSlides({ slides: slides });
    } catch (err) {
      _exporting = false;
      _exportDone('Error al capturar las slides: ' + errText(err));
    }
  }

  window.addEventListener('load', function () {
    if (typeof window.exportSlidesToGoogle !== 'function' || typeof window._captureAllSlides !== 'function') return;   // no es la página del Tracker
    window.exportSlidesToGoogle = exportSlidesToGoogleOwnia;
  });
})();
