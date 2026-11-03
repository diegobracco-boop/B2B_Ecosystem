// "Enviar a Google Slides" del Daily B2B Tracker (2026-11-03). Ownia no tiene SlidesApp: las imágenes de las slides (capturadas en el
// navegador, igual que para el PDF) se mandan al web app de Apps Script del Daily, cuyo doPost (action 'exportTrackerSlides') llama a
// exportToGoogleSlides y pisa SIEMPRE la presentación fija. Apps Script no lee datos acá: solo pega las imágenes que recibe.
//
// El web app es access DOMAIN: se lo llama con un access token de Google (refresh token de APP_SECRETS, como reales-job.js):
//   DRIVE_CLIENT_ID / DRIVE_CLIENT_SECRET      cliente OAuth
//   DRIVE_READ_REFRESH_TOKEN (drive.readonly)  de preferencia; si no está, DRIVE_REFRESH_TOKEN
// Cualquier falla vuelve como Error con mensaje legible (el overlay del Tracker lo muestra tal cual).
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALL_TIMEOUT_MS = 5 * 60 * 1000;   // subir las imágenes y reemplazar el deck tarda

async function accessToken(secrets, fetchFn) {
  const refresh = secrets.DRIVE_READ_REFRESH_TOKEN || secrets.DRIVE_REFRESH_TOKEN;
  if (!secrets.DRIVE_CLIENT_ID || !secrets.DRIVE_CLIENT_SECRET || !refresh) {
    throw new Error('Falta configurar las credenciales de Google en la app (DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET y un refresh token).');
  }
  const r = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: secrets.DRIVE_CLIENT_ID, client_secret: secrets.DRIVE_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Google no dio un access token (' + (j.error_description || j.error || r.status) + ').');
  return j.access_token;
}

/**
 * @param {object} o { secrets, gasUrl, slides: [{img, w, h} | null] , fetchFn }
 * @returns {Promise<{ok:true,count:number,url:string}>}
 */
async function exportTrackerSlides({ secrets, gasUrl, slides, fetchFn = fetch }) {
  if (!Array.isArray(slides) || !slides.length) throw new Error('No se recibió ninguna slide para exportar.');
  if (!gasUrl) throw new Error('El Daily no tiene URL de Apps Script configurada.');
  const token = await accessToken(secrets || {}, fetchFn);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
  let r, text;
  try {
    // Apps Script contesta el POST con un 302 a script.googleusercontent.com; fetch lo sigue (la respuesta final se lee por GET).
    r = await fetchFn(gasUrl, {
      method: 'POST',
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ action: 'exportTrackerSlides', slides }),
    });
    text = await r.text();
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'Apps Script tardó demasiado en responder.' : 'No se pudo llamar a Apps Script: ' + (e && e.message ? e.message : e));
  } finally {
    clearTimeout(timer);
  }
  let j;
  try { j = JSON.parse(text); } catch (e) {
    // Una página HTML de Google (login, "no tenés acceso", error del script): el token no alcanza o el web app no tiene doPost publicado.
    throw new Error('Apps Script no respondió como se esperaba (HTTP ' + r.status + '). Falta publicar la nueva versión del web app del Daily, o la cuenta de las credenciales no tiene acceso.');
  }
  if (!j || !j.ok) throw new Error((j && j.error) || 'Apps Script no pudo actualizar la presentación.');
  return { ok: true, count: j.count, url: j.url };
}

module.exports = { exportTrackerSlides };
