// Portada de la app: menú de tableros B2B para que dirección (Chief, VPs) llegue a lo importante en un clic.
// Rediseño 2026-10-28 (Diego): minimalista, estilo Apple, con la paleta oficial de Despegar (lila #550fed).
// Arriba, "Lo esencial": cuatro bloques grandes con una frase clara y accesos directos; abajo, "Más tableros":
// una lista simple. Claro por defecto (el tema oscuro se elige con el botón; misma clave de localStorage que
// b2b-dashboard). Sin intro animada: el menú abre al instante.
//
// Links: los módulos en Apps Script abren su landing de Google (la productiva, en otra pestaña).
// Los "en validación" abren la versión de Ownia solo para quien puede entrar (allowedUsers);
// el resto va directo a GAS, así nadie de afuera del equipo choca con un 403.
const { escapeHtml } = require('./gas-template');

// Lo esencial para un Chief / VP, en este orden (2026-10-29: Daily, P&L Dashboard, P&L Managerial, Presentaciones). Un módulo que no esté acá ni en MORE cae en "Más tableros".
const ESSENTIAL = ['daily', 'hub', 'pnl-managerial', 'flow'];
const MORE = ['pnl-accounting', 'hub-consolidacion', 'marketing-b2b', 'rolling-projections', 'fixed-cost', 'weekly-industry', 'agentes', 'profit-sharing', 'okr-b2b2c', 'manual'];

// Accesos directos de un bloque hacia OTROS tableros (además de las vistas propias, `quickViews`). Esos tableros no se repiten en "Más tableros".
const QUICK_LINKS = { daily: ['api-one-pager', 'fvm-negativo'] };

// Textos del menú en lenguaje llano (sin jerga). Si un módulo no está acá se usa el de modules.js.
const COPY = {
  flow: { title: 'Presentaciones', desc: 'La revisión semanal y mensual del negocio, con comentarios por slide.' },
  daily: { title: 'Daily', desc: 'Cómo viene el día y la semana: B2B2C y B2B contra el budget.' },
  hub: { title: 'P&L Dashboard', desc: 'El P&L contable, los OKRs y el detalle por país.' },
  'pnl-managerial': { title: 'P&L Managerial', desc: 'El resultado gestional (FVM) de B2B y B2B2C.' },
};

// Íconos (trazos de 24x24).
const ICONS = {
  chart: '<path d="M4 20V13M10 20V8M16 20V11M22 20V4"/><path d="M2 20h20"/>',
  ledger: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  down: '<path d="M3 7l6 6 4-4 8 8"/><path d="M21 11v6h-6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>',
  api: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
  flow: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  agent: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13.5h.01M15 13.5h.01"/>',
};
const ICON_OF = {
  'pnl-managerial': 'chart', 'pnl-accounting': 'ledger', 'profit-sharing': 'bank', 'hub-consolidacion': 'bank', 'marketing-b2b': 'target', hub: 'grid', daily: 'calendar',
  'fvm-negativo': 'down', 'okr-b2b2c': 'target', manual: 'book', 'api-one-pager': 'api', flow: 'flow', 'rolling-projections': 'chart', 'fixed-cost': 'ledger', 'weekly-industry': 'globe', agentes: 'agent',
};
// Otras apps de Ownia que se linkean desde el menú (no son módulos de este repo: no corren acá).
// Los links son los mismos que usa el P&L Dashboard de Apps Script (EXTERNAL_LINKS en Dashboard_B2B_WLs/dashboard.html).
const OTHER_APPS = [
  { slug: 'marketing-b2b', title: 'Marketing B2B', desc: 'Tablero de marketing B2B (app de Toqan).',
    url: 'https://work.toqan.ai/apps/441c1613-8723-459f-bf8c-89a79b929f5d' },
  // `pills`: accesos directos propios [etiqueta, url] (abren en otra pestaña); `quickInList` los muestra también en la fila de "Más tableros".
  { slug: 'hub-consolidacion', title: 'Hub Consolidación', desc: 'El P&L consolidado y las bajadas de la base de consolidación.', quickInList: true,
    url: 'https://ownia.despegar.io/thehub/main-financials/pnl-detail',
    pills: [['P&L', 'https://ownia.despegar.io/thehub/main-financials/pnl-detail'], ['Bajadas', 'https://ownia.despegar.io/consolidador-db/exports']] },
  { slug: 'api-one-pager', title: 'API One Pager', desc: 'One pager del canal API (app b2b-dashboard de Ownia).',
    url: 'https://ownia.despegar.io/b2b-dashboard' },
  { slug: 'agentes', title: 'Agentes Toqan', desc: 'Los agentes de IA del equipo: planning, BI, comercial y optimization.', internal: 'agentes' },
  { slug: 'weekly-industry', title: 'Weekly Industry', desc: 'KPIs semanales de industria.',
    url: 'https://script.google.com/a/despegar.com/macros/s/AKfycbwL40pCC0y_jmTxLh9xxicIoMmHTwP2EZk8eE4KC9yzR68RdHlhvdi5x8C105pmsHl_/exec?page=industria' },
  { slug: 'fixed-cost', title: 'Fixed Cost', desc: 'Estructura de costos fijos.',
    url: 'https://script.google.com/a/macros/despegar.com/s/AKfycbylpy8kbuTVgiDg6xgmtrR-VemvRZlzfMMXcWnnWOjg3U0eUCmPF3XwQRuqPk-hDqRTpg/exec' },
  { slug: 'rolling-projections', title: 'Rolling Projections', desc: 'Run Rate: análisis y proyecciones.',
    url: 'https://ownia.despegar.io/runrate-html' },
];
const CHEVRON_L = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

function icon(m, size) {
  const d = ICONS[ICON_OF[m.slug]] || ICONS.grid;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

function statusOf(m) {
  if (m.ownia && m.validating) return 'val';
  return m.ownia ? 'ok' : 'gas';
}

function links(m, basePath, canOpen) {
  if (m.internal) return { main: `${basePath}/${m.internal}`, external: false, alt: null, beta: false };   // página propia de este menú
  if (m.url) return { main: m.url, external: true, alt: null, beta: false };   // OTHER_APPS
  const own = `${basePath}/${m.slug}`;
  const st = statusOf(m);
  if (st === 'gas' || (st === 'val' && !canOpen(m))) return { main: m.gasUrl, external: true, alt: null, beta: false };
  return { main: own, external: false, alt: st === 'val' && !m.hideGasLink ? m.gasUrl : null, beta: st === 'val' };
}

// Partes comunes de una entrada del menú (tarjeta grande o fila de la lista).
function parts(m, basePath, canOpen, find) {
  const l = links(m, basePath, canOpen);
  const copy = COPY[m.slug] || {};
  const alt = l.alt
    ? `<a class="alt" href="${escapeHtml(l.alt)}" target="_blank" rel="noopener">Versión Apps Script ↗</a>`
    : '';
  // Accesos rápidos a una vista (B2B, B2B2C…): solo en la versión de Ownia, que entiende ?view=.
  const quick = !l.external && m.quickViews
    ? `<div class="quick" role="group" aria-label="Ir directo a">${m.quickViews
      .map(([view, label]) => `<a href="${escapeHtml(`${l.main}?view=${encodeURIComponent(view)}`)}">${escapeHtml(label)}</a>`)
      .join('')}</div>`
    : '';
  // Pastillas hacia otros tableros: abren el link de ese tablero (propio o externo).
  const extra = (QUICK_LINKS[m.slug] || []).map(find).filter(Boolean).map((t) => {
    const tl = links(t, basePath, canOpen);
    return `<a href="${escapeHtml(tl.main)}"${tl.external ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml((COPY[t.slug] || {}).title || t.title)}</a>`;
  }).join('') + (m.pills || []).map(([label, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`).join('');
  return {
    l, alt, quick: quick || extra ? quick.replace('</div>', extra + '</div>') || `<div class="quick" role="group" aria-label="Ir directo a">${extra}</div>` : '',
    title: escapeHtml(copy.title || m.title),
    desc: escapeHtml(copy.desc || m.desc),
    href: escapeHtml(l.main),
    target: l.external ? ' target="_blank" rel="noopener"' : '',
  };
}

// Bloque grande de "Lo esencial": ícono, título, una frase, accesos directos y el link que cubre todo el bloque.
function tile(m, basePath, canOpen, find) {
  const p = parts(m, basePath, canOpen, find);
  const id = `card-${m.slug}`;
  return `<section id="${id}" class="tile" aria-labelledby="${id}-t">
          <div class="ico">${icon(m, 28)}</div>
          <h3 id="${id}-t">${p.title}</h3>
          <p>${p.desc}</p>
          ${p.quick}
          <a class="cta" href="${p.href}"${p.target}>Abrir ${CHEVRON}</a>${p.alt}
        </section>`;
}

// Fila de "Más tableros": título y frase corta, con el link cubriendo toda la fila.
function row(m, basePath, canOpen, find) {
  const p = parts(m, basePath, canOpen, find);
  const id = `card-${m.slug}`;
  return `<section id="${id}" class="row${m.quickInList ? ' showq' : ''}" aria-labelledby="${id}-t">
          <div class="ico">${icon(m, 22)}</div>
          <div class="txt"><h3 id="${id}-t">${p.title}</h3><p>${p.desc}</p>${p.quick}${p.alt}</div>
          <a class="cta" href="${p.href}"${p.target} aria-label="Abrir ${p.title}">${CHEVRON}</a>
        </section>`;
}

// "Actualizar reales" (2026-10-30, Tiago): botón de la barra de arriba, solo para el equipo B2B, que pide una contraseña y
// corre en el servidor la actualización diaria del Daily (server/reales-job.js). Reemplaza al Task Scheduler de una PC.
const REALES_BUTTON = `<button type="button" class="act-btn" id="reales-btn" aria-haspopup="dialog">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>
    <span id="reales-btn-t">Actualizar reales</span></button>`;

function realesDialog(basePath) {
  return `<dialog class="dlg" id="reales-dlg" aria-labelledby="reales-t">
  <form method="dialog" class="dlg-x"><button type="submit" aria-label="Cerrar">&times;</button></form>
  <h2 id="reales-t">Actualizar reales</h2>
  <p class="dlg-sub">Trae del Datalake los reales de ayer y los publica en el Daily, el P&amp;L Managerial y el resto de los tableros (Ownia y Apps Script). Tarda unos 10 minutos.</p>
  <dl class="dlg-meta"><dt>Datos al</dt><dd id="reales-data">…</dd><dt>Última corrida</dt><dd id="reales-last">…</dd></dl>
  <form id="reales-form" class="dlg-form" autocomplete="off">
    <label for="reales-pw">Contraseña</label>
    <div class="dlg-row"><input id="reales-pw" type="password" required autocomplete="off">
    <button type="submit" class="dlg-go" id="reales-go">Actualizar</button></div>
  </form>
  <p class="dlg-msg" id="reales-msg" role="status" aria-live="polite"></p>
  <div class="dlg-prog" id="reales-prog" hidden>
    <div class="dlg-bar" role="progressbar" aria-labelledby="reales-pct" aria-valuemin="0" aria-valuemax="100" id="reales-bar"><span></span></div>
    <div class="dlg-prog-t"><span id="reales-pct"></span><span id="reales-time"></span></div>
  </div>
  <details class="dlg-det" id="reales-det" hidden><summary>Ver detalle</summary><pre class="dlg-log" id="reales-log"></pre></details>
</dialog>
<script>
  (function () {
    var api = ${JSON.stringify(`${basePath}/reales`)};
    var dlg = document.getElementById('reales-dlg'), btn = document.getElementById('reales-btn');
    var form = document.getElementById('reales-form'), pw = document.getElementById('reales-pw'), go = document.getElementById('reales-go');
    var msg = document.getElementById('reales-msg'), logEl = document.getElementById('reales-log'), timer = 0;
    var prog = document.getElementById('reales-prog'), bar = document.getElementById('reales-bar'), det = document.getElementById('reales-det');
    var btnT = document.getElementById('reales-btn-t'), shownState = '';
    function dur(st) {
      var s = Math.max(0, Math.round(((st.finishedAt ? Date.parse(st.finishedAt) : Date.now()) - Date.parse(st.startedAt)) / 1000));
      return (s >= 60 ? Math.floor(s / 60) + ' min ' : '') + (s % 60) + ' s';
    }
    function fmt(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    function show(st) {
      document.getElementById('reales-data').textContent = fmt(st.dataUpdatedAt);
      var last = st.startedAt ? fmt(st.startedAt) + ' · ' + (st.by || '').replace(/@.*/, '') : 'ninguna desde el último deploy';
      if (st.state === 'ok') last += ' · OK';
      if (st.state === 'error') last += ' · con error';
      document.getElementById('reales-last').textContent = last;
      var running = st.state === 'running';
      go.disabled = running || !!st.blocked; pw.disabled = running || !!st.blocked;
      btn.classList.toggle('busy', running);
      if (running) msg.textContent = 'Actualizando… podés cerrar esta ventana, sigue corriendo en el servidor.';
      else if (st.state === 'ok' && st.warnings && st.warnings.length) {
        msg.textContent = 'Listo, con ' + st.warnings.length + (st.warnings.length === 1 ? ' aviso' : ' avisos') + ': ' + st.warnings.join(' · ');
      }
      else if (st.state === 'ok') msg.textContent = 'Listo: los tableros ya tienen los datos nuevos.';
      else if (st.state === 'error') msg.textContent = 'La actualización falló. Abrí "Ver detalle" para ver el error.';
      else if (!st.configured) msg.textContent = 'Falta configurar las credenciales en Ownia.';
      else if (st.blocked) msg.textContent = st.blocked;
      else msg.textContent = '';
      // Barra de avance (la calcula el servidor a partir de la salida del proceso, ver reales-job.js).
      var p = st.progress || { pct: 0, stage: '' };
      var pct = st.state === 'ok' ? 100 : p.pct;
      prog.hidden = !st.startedAt;
      prog.classList.toggle('err', st.state === 'error');
      prog.classList.toggle('ok', st.state === 'ok');
      bar.firstElementChild.style.width = pct + '%';
      bar.setAttribute('aria-valuenow', String(pct));
      document.getElementById('reales-pct').textContent = pct + '% · ' + (st.state === 'error' ? 'Falló en: ' + p.stage : p.stage);
      document.getElementById('reales-time').textContent = st.startedAt ? dur(st) : '';
      btnT.textContent = running ? 'Actualizando ' + pct + '%' : 'Actualizar reales';
      det.hidden = !(st.lines && st.lines.length);
      if (st.state === 'error' && shownState !== 'error') det.open = true;   // ante un error, el detalle a la vista
      shownState = st.state;
      logEl.textContent = (st.lines || []).join('\\n');
      logEl.scrollTop = logEl.scrollHeight;
      clearTimeout(timer);
      if (running) timer = setTimeout(poll, 4000);
    }
    function poll() {
      fetch(api, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }).then(show)
        .catch(function () { timer = setTimeout(poll, 8000); });
    }
    btn.addEventListener('click', function () { msg.textContent = ''; dlg.showModal(); poll(); pw.focus(); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      go.disabled = true; msg.textContent = 'Arrancando…';
      fetch(api, { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'google.script.run' },
        body: JSON.stringify({ password: pw.value }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          pw.value = '';
          if (!x.ok) { go.disabled = false; msg.textContent = x.j.error || 'No se pudo arrancar.'; return; }
          show(x.j);
        })
        .catch(function () { go.disabled = false; msg.textContent = 'No se pudo conectar con el servidor.'; });
    });
    poll();   // si hay una corrida en curso, el botón lo muestra girando
  })();
</script>`;
}

function shell(inner, { title = 'The B2B Ecosystem · Despegar', left = '<span class="topbar-logo">despegar</span>', actions = '', extra = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<script>
  // Estado inicial antes del primer render (sin parpadeo): oscuro por defecto, claro solo si se eligio (misma clave que b2b-dashboard)
  // e intro una vez por sesion, salvo prefers-reduced-motion.
  (function () {
    var h = document.documentElement;
    try { if (localStorage.getItem('b2b-api-theme') === 'light') h.setAttribute('data-theme', 'light'); } catch (e) {}
    var play = true;
    try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) play = false; } catch (e) {}
    try { if (sessionStorage.getItem('b2b-eco-intro-seen') === '1') play = false; } catch (e) {}
    if (play) h.className += ' intro-on';
  })();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --primary: #5626e9; --secondary: #8e5ff3; --link: #a780ff;
    --bg: #0F0F1E; --tile: #1A1A2E; --tile-hover: #222238; --line: rgba(255, 255, 255, .09);
    --text: #FFFFFF; --text-2: #B8B8D1; --text-3: #8a8aa3; --icon: #a780ff; --glow: rgba(86, 38, 233, .28);
    --ease: cubic-bezier(0.25, 0.1, 0.25, 1);
    --font: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color-scheme: dark;
  }
  :root[data-theme="light"] {
    --primary: #550fed; --secondary: #7B4FFF; --link: #550fed;
    --bg: #ffffff; --tile: #f5f5f7; --tile-hover: #ececf1; --line: rgba(0, 0, 0, .08);
    --text: #1d1d1f; --text-2: #6e6e73; --text-3: #8e8e93; --icon: #550fed; --glow: transparent;
    color-scheme: light;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--font); background: var(--bg); color: var(--text); font-size: 15px; line-height: 1.5; min-height: 100vh;
         display: flex; flex-direction: column; -webkit-font-smoothing: antialiased;
         background-image: radial-gradient(900px 480px at 8% -8%, var(--glow), transparent 70%), radial-gradient(700px 400px at 100% 0%, var(--glow), transparent 70%);
         background-repeat: no-repeat; }
  :focus-visible { outline: 2px solid var(--secondary); outline-offset: 3px; border-radius: 8px; }

  .topbar { display: flex; align-items: center; padding: 20px 32px; }
  .topbar-logo { font-size: 17px; font-weight: 600; letter-spacing: -0.02em; color: var(--text); }
  .back { display: inline-flex; align-items: center; gap: 4px; font-size: 15px; font-weight: 500; color: var(--link); text-decoration: none; }
  .back:hover { text-decoration: underline; }
  .more.grp { margin-top: 40px; }
  .act-btn { margin-left: auto; display: inline-flex; align-items: center; gap: 7px; padding: 7px 14px; border-radius: 999px; border: 0;
             background: transparent; color: var(--text-2); font: 500 13px var(--font); cursor: pointer; box-shadow: inset 0 0 0 1px var(--line);
             transition: color .2s var(--ease), box-shadow .2s var(--ease); }
  .act-btn:hover { color: var(--link); box-shadow: inset 0 0 0 1px var(--link); }
  .act-btn.busy svg { animation: spin 1.2s linear infinite; }
  .act-btn + .theme-btn { margin-left: 8px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .dlg { margin: auto; width: min(520px, calc(100vw - 32px)); padding: 28px; border: 0; border-radius: 22px; background: var(--bg); color: var(--text);
         box-shadow: 0 24px 64px rgba(0, 0, 0, .35), inset 0 0 0 1px var(--line); font-family: var(--font); }
  .dlg::backdrop { background: rgba(0, 0, 0, .45); }
  .dlg h2 { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
  .dlg-x { position: absolute; top: 14px; right: 14px; }
  .dlg-x button { width: 32px; height: 32px; border-radius: 50%; border: 0; background: transparent; color: var(--text-2); font-size: 22px; cursor: pointer; }
  .dlg-x button:hover { background: var(--tile); color: var(--text); }
  .dlg-sub { margin-top: 8px; font-size: 14px; color: var(--text-2); }
  .dlg-meta { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin-top: 18px; font-size: 13.5px; }
  .dlg-meta dt { color: var(--text-3); }
  .dlg-form { margin-top: 20px; }
  .dlg-form label { display: block; font-size: 13px; color: var(--text-2); margin-bottom: 6px; }
  .dlg-row { display: flex; gap: 10px; }
  .dlg-row input { flex: 1; min-width: 0; padding: 10px 14px; border-radius: 12px; border: 0; background: var(--tile); color: var(--text);
                   font: 15px var(--font); box-shadow: inset 0 0 0 1px var(--line); }
  .dlg-go { padding: 10px 18px; border-radius: 12px; border: 0; background: var(--primary); color: #fff; font: 500 15px var(--font); cursor: pointer; }
  .dlg-go:disabled, .dlg-row input:disabled { opacity: .5; cursor: default; }
  .dlg-msg { margin-top: 14px; font-size: 14px; color: var(--text-2); min-height: 1.5em; }
  .dlg-prog { margin-top: 6px; }
  .dlg-bar { height: 8px; border-radius: 999px; background: var(--tile); overflow: hidden; box-shadow: inset 0 0 0 1px var(--line); }
  .dlg-bar span { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--primary); transition: width .6s var(--ease); }
  .dlg-prog.err .dlg-bar span { background: #d93025; }
  .dlg-prog-t { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }
  .dlg-det { margin-top: 12px; font-size: 13px; color: var(--text-2); }
  .dlg-det summary { cursor: pointer; width: fit-content; }
  .dlg-log { margin-top: 10px; max-height: 220px; overflow: auto; padding: 12px; border-radius: 12px; background: var(--tile); color: var(--text-2);
             font: 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
  .theme-btn { margin-left: auto; width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; background: transparent;
               border: 0; color: var(--text-2); cursor: pointer; transition: background .2s var(--ease), color .2s var(--ease); }
  .theme-btn:hover { background: var(--tile); color: var(--text); }

  .wrap { width: 100%; max-width: 1040px; margin: 0 auto; padding: 0 32px; }
  main { flex: 1; padding: 40px 0 88px; }
  .hero { text-align: center; margin-bottom: 56px; }
  .hero h1 { font-size: clamp(34px, 5.4vw, 52px); font-weight: 600; line-height: 1.08; letter-spacing: -0.035em; }
  .hero p { margin-top: 14px; font-size: 18px; color: var(--text-2); }

  h2.sec { font-size: 13px; font-weight: 500; color: var(--text-3); margin: 0 4px 16px; }
  .essential { display: grid; gap: 20px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tile { position: relative; display: flex; flex-direction: column; gap: 8px; min-height: 228px; padding: 32px; border-radius: 22px;
          background: var(--tile); transition: background .2s var(--ease); }
  .tile:hover { background: var(--tile-hover); }
  .tile .ico { color: var(--icon); margin-bottom: 14px; }
  .tile h3 { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
  .tile p { font-size: 15px; color: var(--text-2); max-width: 36ch; }
  .cta { display: inline-flex; align-items: center; gap: 4px; font-size: 15px; font-weight: 500; color: var(--link); text-decoration: none; width: fit-content; }
  .tile .cta { margin-top: auto; padding-top: 14px; }
  .cta::after { content: ''; position: absolute; inset: 0; border-radius: inherit; }   /* todo el bloque es clickeable */
  .cta svg { transition: transform .2s var(--ease); }
  .tile:hover .cta svg, .row:hover .cta svg { transform: translateX(3px); }
  a.cta:focus-visible { outline: none; }
  .tile:has(a.cta:focus-visible), .row:has(a.cta:focus-visible) { outline: 2px solid var(--secondary); outline-offset: 3px; }
  /* Accesos directos y link secundario: arriba del link que cubre el bloque. */
  .quick { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .quick a { padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 500; text-decoration: none; color: var(--text);
             background: transparent; transition: color .2s var(--ease), box-shadow .2s var(--ease); box-shadow: inset 0 0 0 1px var(--line); }
  .quick a:hover { color: var(--link); box-shadow: inset 0 0 0 1px var(--link); }
  .alt { position: relative; z-index: 1; font-size: 12px; color: var(--text-3); text-decoration: none; width: fit-content; }
  .alt:hover { color: var(--text); text-decoration: underline; }

  .more { margin-top: 64px; }
  .list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 48px; }
  .row { position: relative; display: flex; align-items: center; gap: 16px; padding: 18px 4px; border-top: 1px solid var(--line); }
  .row .ico { color: var(--icon); flex: none; }
  .row .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .row h3 { font-size: 16px; font-weight: 500; letter-spacing: -0.01em; }
  .row p { font-size: 13.5px; color: var(--text-2); }
  .row .quick { display: none; }
  .row.showq .quick { display: flex; margin-top: 8px; }   /* los accesos directos van solo en los bloques de "Lo esencial" */
  .row .cta { color: var(--text-3); }
  .row:hover .cta { color: var(--link); }

  @media (max-width: 820px) {
    .topbar { padding: 16px 20px; }
    .wrap { padding: 0 20px; }
    main { padding: 24px 0 64px; }
    .hero { margin-bottom: 36px; }
    .hero p { font-size: 16px; }
    .essential, .list { grid-template-columns: 1fr; }
    .tile { min-height: 0; padding: 26px; }
  }
  /* ---------- Intro (igual que b2b-dashboard) ---------- */
  .intro { display: none; }
  .intro-on .intro { display: grid; place-items: center; position: fixed; inset: 0; z-index: 100; cursor: pointer;
                     background: var(--bg); transition: opacity .55s var(--ease); animation: failsafe 0s 6s forwards; }
  .intro.out { opacity: 0; pointer-events: none; }
  .intro canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .intro-core { position: relative; text-align: center; transition: transform .55s var(--ease); }
  .intro.out .intro-core { transform: scale(1.06); }
  .intro-word { display: block; font-weight: 800; letter-spacing: -0.045em; line-height: .98; font-size: clamp(52px, 11.5vw, 150px); white-space: nowrap; }
  .intro-word span {
    display: inline-block; opacity: 0; transform: translateY(40px);
    background: linear-gradient(110deg, var(--text) 38%, #c9b4ff 47%, var(--secondary) 54%, var(--primary) 70%, var(--secondary) 100%);
    background-size: 280% 100%; background-position: 0% 0; -webkit-background-clip: text; background-clip: text; color: transparent;
    animation: letterIn .7s var(--ease) forwards, sweep 1.1s cubic-bezier(.5, 0, .2, 1) forwards;
    animation-delay: calc(var(--d) * 1ms), calc(var(--d) * 1ms + 650ms);
  }
  .intro-sub { margin-top: 18px; font-size: clamp(12px, 2.4vw, 15px); font-weight: 500; letter-spacing: .02em; color: var(--text-2);
               opacity: 0; animation: fadeIn .6s var(--ease) 1.5s forwards; }
  .intro-skip { position: absolute; bottom: 22px; left: 0; right: 0; text-align: center; font-size: 11px; color: var(--text-3); opacity: 0; animation: fadeIn .6s ease .6s forwards; }
  @keyframes letterIn { to { opacity: 1; transform: none; } }
  @keyframes sweep { to { background-position: 100% 0; } }
  @keyframes fadeIn { to { opacity: 1; } }
  @keyframes failsafe { to { opacity: 0; visibility: hidden; pointer-events: none; } }
  /* la portada entra una sola vez, después de la intro */
  .intro-on .reveal { opacity: 0; transform: translateY(18px); animation: failsafeIn 0s 6s forwards; }
  .intro-on.landed .reveal { opacity: 1; transform: none; transition: opacity .7s var(--ease), transform .7s var(--ease); transition-delay: calc(var(--i, 0) * 110ms); }
  @keyframes failsafeIn { to { opacity: 1; transform: none; } }

  @media (prefers-reduced-motion: reduce) {
    .intro { display: none !important; }
    .reveal { animation: none !important; transition: none !important; opacity: 1 !important; transform: none !important; }
    .tile, .cta svg, .quick a, .theme-btn, .act-btn { transition: none !important; }
    .act-btn.busy svg { animation: none !important; }
    .dlg-bar span { transition: none !important; }
  }
</style>
</head>
<body>
<div class="intro" id="intro" aria-hidden="true">
  <canvas id="net"></canvas>
  <div class="intro-core">
    <span class="intro-word" id="w1"></span>
    <span class="intro-word" id="w2"></span>
    <div class="intro-sub">B2B &middot; B2B2C &middot; despegar</div>
  </div>
  <div class="intro-skip">Clic o cualquier tecla para saltar</div>
</div>
<header class="topbar">
  ${left}
  ${actions}
  <button type="button" class="theme-btn" id="theme-btn" aria-label="Cambiar tema claro u oscuro" title="Cambiar tema">
    <svg id="icon-dark" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    <svg id="icon-light" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" style="display:none" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
  </button>
</header>
<main>
  <div class="wrap">
    ${inner}
  </div>
</main>
<script>
  (function () {
    var root = document.documentElement;
    var btn = document.getElementById('theme-btn');
    function syncIcons() {
      var light = root.getAttribute('data-theme') === 'light';
      document.getElementById('icon-dark').style.display = light ? 'none' : '';
      document.getElementById('icon-light').style.display = light ? '' : 'none';
    }
    btn.addEventListener('click', function () {
      var light = root.getAttribute('data-theme') !== 'light';
      if (light) root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
      try { localStorage.setItem('b2b-api-theme', light ? 'light' : 'dark'); } catch (e) {}
      syncIcons();
    });
    syncIcons();

    /* ---- Intro ---- */
    if (!/\\bintro-on\\b/.test(root.className)) return;
    var intro = document.getElementById('intro');
    var canvas = document.getElementById('net');
    var done = false, raf = 0, endTimer = 0;

    function letters(id, text, base) {
      var el = document.getElementById(id);
      for (var i = 0; i < text.length; i++) {
        var s = document.createElement('span');
        s.textContent = text.charAt(i) === ' ' ? '\\u00a0' : text.charAt(i);
        s.style.setProperty('--d', String(base + i * 70));
        el.appendChild(s);
      }
    }
    letters('w1', 'The B2B', 150);
    letters('w2', 'Ecosystem', 560);

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(endTimer);
      try { sessionStorage.setItem('b2b-eco-intro-seen', '1'); } catch (e) {}
      intro.classList.add('out');
      root.className += ' landed';
      setTimeout(function () { cancelAnimationFrame(raf); intro.style.display = 'none'; }, 650);
      setTimeout(function () { root.className = root.className.replace(/\\s*\\b(intro-on|landed)\\b/g, ''); }, 2200);
      document.removeEventListener('keydown', finish);
    }
    intro.addEventListener('click', finish);
    document.addEventListener('keydown', finish);
    endTimer = setTimeout(finish, 2700);

    /* ---- Red de conexiones (canvas, liviana; solo mientras dura la intro) ---- */
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var nodes = [], edges = [];
    var lineCol = (getComputedStyle(root).getPropertyValue('--secondary') || '#8e5ff3').trim();
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

    function build() {
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed = 7; nodes = []; edges = [];
      var n = W < 600 ? 22 : 36;
      for (var i = 0; i < n; i++) nodes.push({ x: rnd() * W, y: rnd() * H, p: rnd() * 6.28, a: 6 + rnd() * 10 });
      var maxD = Math.min(W, H) * (W < 600 ? .5 : .36);
      for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
        var dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
        if (Math.sqrt(dx * dx + dy * dy) < maxD && edges.length < 70) edges.push({ a: i, b: j, t: rnd() * 900 + 100, o: rnd() });
      }
    }
    build();
    window.addEventListener('resize', build);

    var t0 = 0;
    function frame(now) {
      if (done && !t0) return;
      if (!t0) t0 = now;
      var t = now - t0;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = lineCol; ctx.fillStyle = lineCol;
      var pos = nodes.map(function (n) { return [n.x + Math.sin(t / 900 + n.p) * n.a, n.y + Math.cos(t / 1100 + n.p) * n.a]; });
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i], k = Math.min(1, Math.max(0, (t - e.t) / 700));
        if (k <= 0) continue;
        var A = pos[e.a], B = pos[e.b];
        ctx.globalAlpha = .42 * k; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k); ctx.stroke();
        if (k >= 1 && e.o > .55) {   // pulso de datos viajando por la conexión
          var q = ((t - e.t) / 1400 + e.o) % 1;
          ctx.globalAlpha = .9;
          ctx.beginPath(); ctx.arc(A[0] + (B[0] - A[0]) * q, A[1] + (B[1] - A[1]) * q, 2, 0, 6.283); ctx.fill();
        }
      }
      for (var i = 0; i < pos.length; i++) {
        ctx.globalAlpha = .75 * Math.min(1, t / 600);
        ctx.beginPath(); ctx.arc(pos[i][0], pos[i][1], 2.2, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  })();
</script>
${extra}
</body>
</html>`;
}

function indexPage({ modules, basePath, canOpen = () => true, reales = false }) {
  const all = [...modules, ...OTHER_APPS];
  const find = (s) => all.find((m) => m.slug === s);
  const essential = ESSENTIAL.map(find).filter(Boolean);
  const used = new Set([...ESSENTIAL, ...MORE, ...Object.values(QUICK_LINKS).flat()]);
  const more = [...MORE.map(find).filter(Boolean), ...modules.filter((m) => !used.has(m.slug))];
  return shell(`<div class="hero reveal" style="--i:0">
      <h1>B2B Ecosystem</h1>
      <p>Los resultados de B2B y B2B2C, en un solo lugar.</p>
    </div>
    <h2 class="sec reveal" style="--i:1">Lo esencial</h2>
    <div class="essential reveal" style="--i:1">
      ${essential.map((m) => tile(m, basePath, canOpen, find)).join('\n')}
    </div>
    ${more.length ? `<div class="more reveal" style="--i:2">
      <h2 class="sec">Más tableros</h2>
      <div class="list">
        ${more.map((m) => row(m, basePath, canOpen, find)).join('\n')}
      </div>
    </div>` : ''}`, reales ? { actions: REALES_BUTTON, extra: realesDialog(basePath) } : {});
}

// Agentes de IA (Toqan): mismos agentes y links que la sección "IA Agents" del P&L Dashboard de Apps Script (EXTERNAL_LINKS.agents).
const AGENT_GROUPS = [
  { title: 'AI Planning', items: [
    ['BITUBIA', 'Agente principal', 'https://work.toqan.ai/spaces/join/279206f6-0d07-47a9-9424-faa363d21b45'],
    ['BITUBICIA', 'B2B2C / White Labels', 'https://work.toqan.ai/spaces/join/3e38c85f-5349-44c3-9644-3342ff7e32ae'],
    ['BITUBEE', 'B2B', 'https://work.toqan.ai/spaces/join/ff4f36f2-9621-4f28-b5c3-edc50fcbebac'],
    ['FCA Arquitech', 'Arquitectura financiera', 'https://work.toqan.ai/spaces/join/82d3c71e-08f6-4d8e-9854-f179e39e8a85'],
  ] },
  { title: 'AI BI', items: [
    ['Guru 2.0', 'Asistente avanzado', 'https://work.toqan.ai/spaces/join/c3f8e6f3-14f3-43e1-8d90-5ecbacaf5e21'],
  ] },
  { title: 'Development AI', items: [
    ['COBU', 'Conversaciones', 'https://work.toqan.ai/conversations/d355f0de-5629-480c-aa8c-8c1a10a4de69'],
  ] },
  { title: 'Commercial B2B AI', items: [
    ['Journalist', 'Noticias de industria', 'https://work.toqan.ai/spaces/join/8b5c49f6-1d50-4bd4-9c18-4e3af018fddb'],
  ] },
  { title: 'Commercial WLs AI', items: [
    ['WL Coach', 'White Labels', 'https://work.toqan.ai/spaces/join/062f8f4b-88fc-43d0-906b-67601578859f'],
  ] },
  { title: 'Optimization', items: [
    ['Incidencias', 'Gestión de incidencias', 'https://work.toqan.ai/apps/de2e15ad-7f46-45b9-9e09-bb9bc13383dc'],
    ['Nuitee', 'Incidencias Nuitee', 'https://work.toqan.ai/apps/525bbbb8-d04c-40c3-ba73-6e15902c6ae3'],
    ['BRG HDO', 'Best Rate Guarantee', 'https://work.toqan.ai/chats/e521612a-5c91-49ab-a7a8-5429c4506eaa'],
    ['Apps status integraciones', 'Estado de integraciones', 'https://work.toqan.ai/apps/de2e15ad-7f46-45b9-9e09-bb9bc13383dc'],
    ['Dash Conectores', 'Metabase · WIP Optimization', 'https://metabase.despegar.com/dashboard/6950-conectores-wip-optimization-b2b?cadena=&conector=TRAVELGATE&fecha_%28a%25C3%25B1o_-_mes%29=2026-04&id=&periodo=&pos=MX&tab=2101-m%C3%A9tricas--x-conector'],
    ['Alta Credenciales', 'Agente de alta de credenciales', 'https://work.toqan.ai/spaces/join/11b80d95-802b-414c-8872-09f08c2b04ba'],
  ] },
];

function agentsPage({ basePath }) {
  const back = `<a class="back" href="${escapeHtml(basePath)}/">${CHEVRON_L} B2B Ecosystem</a>`;
  const rowOf = ([name, sub, url]) => `<section class="row">
          <div class="ico">${icon({ slug: 'agentes' }, 22)}</div>
          <div class="txt"><h3>${escapeHtml(name)}</h3><p>${escapeHtml(sub)}</p></div>
          <a class="cta" href="${escapeHtml(url)}" target="_blank" rel="noopener" aria-label="Abrir ${escapeHtml(name)}">${CHEVRON}</a>
        </section>`;
  return shell(`<div class="hero">
      <h1>Agentes Toqan</h1>
      <p>Los agentes de IA del equipo, cada uno con su link.</p>
    </div>
    ${AGENT_GROUPS.map((g) => `<div class="more grp">
      <h2 class="sec">${escapeHtml(g.title)}</h2>
      <div class="list">
        ${g.items.map(rowOf).join('\n')}
      </div>
    </div>`).join('\n')}`, { title: 'Agentes Toqan · B2B Ecosystem', left: back });
}

module.exports = { indexPage, agentsPage };
