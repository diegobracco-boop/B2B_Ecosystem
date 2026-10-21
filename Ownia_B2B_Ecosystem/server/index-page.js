// Portada de la app: mapa de integración del ecosistema. El hub "B2B Ecosystem" en el centro y
// los módulos orbitando: anillo interno = servidos desde Ownia (migrados o en validación),
// anillo externo = los que siguen en Apps Script (abren su landing de Google, la productiva).
// Los "en validación" (corren acá en paralelo a GAS) muestran los dos links, para comparar.
// Fondo: campo de estrellas en WebGL (public/galaxy.js). En pantallas angostas el mapa se
// reemplaza por una lista.
const { escapeHtml } = require('./gas-template');

// Sigla de cada nodo (si falta, iniciales del título).
const GLYPH = {
  manual: 'MAN', hub: 'HUB', daily: 'DLY', 'pnl-accounting': 'ACC', 'pnl-managerial': 'MGR',
  'one-pager': '1PG', 'fvm-negativo': 'FVM', 'okr-b2b2c': 'OKR', 'profit-sharing': 'PS',
};

function statusOf(m) {
  if (m.ownia && m.validating) return 'val';
  return m.ownia ? 'ok' : 'gas';
}

const LABEL = { ok: 'En Ownia', val: 'En validación', gas: 'Apps Script' };

function glyph(m) {
  return GLYPH[m.slug] || m.title.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
}

function links(m, basePath) {
  const own = `${basePath}/${m.slug}`;
  const st = statusOf(m);
  if (st === 'gas') return { main: m.gasUrl, external: true, alt: null };
  return { main: own, external: false, alt: st === 'val' ? m.gasUrl : null };
}

function nodeHtml(m, basePath, angle, ring) {
  const st = statusOf(m);
  const l = links(m, basePath);
  const target = l.external ? ' target="_blank" rel="noopener"' : '';
  const alt = l.alt
    ? `<a class="alt" href="${escapeHtml(l.alt)}" target="_blank" rel="noopener" title="Abrir la versión productiva en Apps Script">Apps Script ↗</a>`
    : '';
  return `<div class="node" style="--a:${angle.toFixed(2)}deg;--rf:var(--r${ring})">
        <div class="counter c${ring}">
          <div class="body st-${st}">
            <a class="orb" href="${escapeHtml(l.main)}"${target} aria-label="${escapeHtml(`${m.title} — ${LABEL[st]}`)}">${escapeHtml(glyph(m))}</a>
            <a class="lbl" href="${escapeHtml(l.main)}"${target} tabindex="-1">${escapeHtml(m.title)}</a>
            <span class="tag">${LABEL[st]}</span>
            <span class="desc">${escapeHtml(m.desc)}</span>
            ${alt}
          </div>
        </div>
      </div>`;
}

// Líneas del hub a cada nodo, en coordenadas del mapa (viewBox -50..50 = el tamaño del mapa).
function spokes(list, rf, st) {
  return list
    .map((x) => {
      const rad = (x.angle * Math.PI) / 180;
      const r = rf * 100 - 6; // termina antes del orbe
      return `<line class="spoke sp-${st(x.m)}" x1="0" y1="0" x2="${(r * Math.cos(rad)).toFixed(2)}" y2="${(r * Math.sin(rad)).toFixed(2)}"/>`;
    })
    .join('');
}

function place(list, offset) {
  return list.map((m, i) => ({ m, angle: offset + (360 / list.length) * i }));
}

function listCard(m, basePath) {
  const st = statusOf(m);
  const l = links(m, basePath);
  const target = l.external ? ' target="_blank" rel="noopener"' : '';
  const alt = l.alt ? `<a class="alt" href="${escapeHtml(l.alt)}" target="_blank" rel="noopener">Apps Script (productivo) ↗</a>` : '';
  return `<li class="lcard st-${st}">
      <a class="lmain" href="${escapeHtml(l.main)}"${target}><span class="orb sm">${escapeHtml(glyph(m))}</span><span><strong>${escapeHtml(m.title)}</strong><span class="ldesc">${escapeHtml(m.desc)}</span></span></a>
      <span class="tag">${LABEL[st]}</span>${alt}
    </li>`;
}

function indexPage({ modules, basePath }) {
  const inner = place(modules.filter((m) => m.ownia), -90);
  const outer = place(modules.filter((m) => !m.ownia), -90 + 180 / Math.max(1, modules.filter((m) => !m.ownia).length));
  // (con 3 internos y 6 externos: internos a -90/30/150°, externos a -60/0/60/…: siempre intercalados)
  const migrated = modules.filter((m) => m.ownia && !m.validating).length;
  const validating = modules.filter((m) => m.ownia && m.validating).length;
  const RF1 = 0.27;
  const RF2 = 0.43;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>B2B Ecosystem · Despegar</title>
<style>
  :root {
    --lila: #550fed; --lila2: #7a3ff2; --lila3: #976cf6; --verde: #1fc7b4; --ambar: #ffb547;
    --ink: #f4f1ff; --ink2: #b9b0db; --space: #0a0619;
    --size: min(86vh, 92vw, 860px); --r1: ${RF1}; --r2: ${RF2};
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--ink);
         background: radial-gradient(ellipse at 50% 45%, #1d1045 0%, var(--space) 70%); overflow-x: hidden; }
  #galaxy { position: fixed; inset: 0; z-index: 0; }
  .galaxy-canvas { width: 100%; height: 100%; display: block; }
  .page { position: relative; z-index: 1; min-height: 100%; display: flex; flex-direction: column; pointer-events: none; }
  .page a, .page .body, .legend { pointer-events: auto; }

  header { padding: 22px 28px 0; }
  header h1 { margin: 0; font-size: 20px; letter-spacing: .3px; }
  header p { margin: 4px 0 0; color: var(--ink2); font-size: 13px; }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; font-size: 12px; color: var(--ink2); }
  .legend span::before { content: ''; display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
  .legend .l-ok::before { background: var(--verde); box-shadow: 0 0 8px var(--verde); }
  .legend .l-val::before { background: var(--ambar); box-shadow: 0 0 8px var(--ambar); }
  .legend .l-gas::before { background: var(--lila3); }

  /* ---------- mapa ---------- */
  .stage { flex: 1; display: grid; place-items: center; padding: 8px 0 18px; }
  .map { position: relative; width: var(--size); height: var(--size); }
  .orbit { position: absolute; left: 50%; top: 50%; border-radius: 50%; border: 1px dashed rgba(151,108,246,.28); transform: translate(-50%,-50%); }
  .orbit.o1 { width: calc(var(--size) * var(--r1) * 2); height: calc(var(--size) * var(--r1) * 2); border-style: solid; border-color: rgba(31,199,180,.22); }
  .orbit.o2 { width: calc(var(--size) * var(--r2) * 2); height: calc(var(--size) * var(--r2) * 2); }
  .ring { position: absolute; inset: 0; }
  /* Los dos anillos giran juntos, con los nodos intercalados: nunca se pisan. */
  .ring { animation: spin 200s linear infinite; }
  .ring svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  .spoke { stroke-width: .18; }
  .sp-ok, .sp-val { stroke-width: .25; stroke-dasharray: 1.2 1.6; animation: flow 3s linear infinite; }
  .sp-ok { stroke: rgba(31,199,180,.75); }
  .sp-val { stroke: rgba(255,181,71,.7); }
  .sp-gas { stroke: rgba(151,108,246,.45); stroke-dasharray: .5 1.2; }
  @keyframes flow { to { stroke-dashoffset: -5.6; } }
  @keyframes spin { to { transform: rotate(360deg); } }

  .node { position: absolute; left: 50%; top: 50%; width: 0; height: 0;
          transform: rotate(var(--a)) translate(calc(var(--size) * var(--rf))) rotate(calc(-1 * var(--a))); }
  .counter { width: 0; height: 0; }
  .counter { animation: spin 200s linear infinite reverse; }
  .body { position: absolute; left: 0; top: 0; transform: translate(-50%, -32px); width: 150px; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .orb { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; text-decoration: none;
         font-weight: 800; font-size: 14px; letter-spacing: .5px; color: #fff; transition: transform .2s, box-shadow .2s;
         background: radial-gradient(circle at 35% 30%, #8d5cf8, var(--lila) 70%); border: 2px solid rgba(255,255,255,.25); }
  .st-ok .orb { background: radial-gradient(circle at 35% 30%, #5ff0df, #0a8f80 75%); box-shadow: 0 0 22px rgba(31,199,180,.55); }
  .st-val .orb { background: radial-gradient(circle at 35% 30%, #ffd58f, #d9861a 75%); box-shadow: 0 0 22px rgba(255,181,71,.5); }
  .st-gas .orb { background: radial-gradient(circle at 35% 30%, #a98af5, #3d1c9e 75%); box-shadow: 0 0 14px rgba(151,108,246,.35); opacity: .92; }
  .lbl { margin-top: 7px; color: var(--ink); text-decoration: none; font-weight: 700; font-size: 13px; line-height: 1.2; text-shadow: 0 1px 6px #000; }
  .tag { margin-top: 4px; font-size: 10.5px; font-weight: 700; border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
  .st-ok .tag { background: rgba(31,199,180,.18); color: #7ff3e5; }
  .st-val .tag { background: rgba(255,181,71,.18); color: #ffd28a; }
  .st-gas .tag { background: rgba(151,108,246,.18); color: #cbb8ff; }
  .desc { display: none; margin-top: 6px; font-size: 11.5px; color: var(--ink2); line-height: 1.35; background: rgba(10,6,25,.85);
          border: 1px solid rgba(151,108,246,.35); border-radius: 8px; padding: 6px 8px; width: 170px; }
  .alt { margin-top: 6px; font-size: 11px; color: var(--ink2); text-decoration: none; border: 1px solid rgba(255,255,255,.22); border-radius: 6px; padding: 2px 8px; background: rgba(10,6,25,.6); }
  .alt:hover, .alt:focus { color: #fff; border-color: var(--ambar); }
  .body:hover .orb, .body:focus-within .orb { transform: scale(1.12); }
  .body:hover .desc, .body:focus-within .desc { display: block; }
  .body:hover, .body:focus-within { z-index: 5; }
  .orb:focus-visible, .alt:focus-visible, .lmain:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  /* Para poder hacer click, el sistema se frena mientras el mouse (o el foco) está sobre el mapa. */
  .map:hover .ring, .map:hover .counter, .map:focus-within .ring, .map:focus-within .counter { animation-play-state: paused; }

  .hub { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); width: calc(var(--size) * .19); height: calc(var(--size) * .19);
         min-width: 120px; min-height: 120px; border-radius: 50%; display: grid; place-items: center; text-align: center; z-index: 2;
         background: radial-gradient(circle at 38% 30%, #9b6bff, var(--lila) 55%, #2a0a85 100%);
         box-shadow: 0 0 40px rgba(85,15,237,.8), 0 0 120px rgba(85,15,237,.35), inset 0 0 20px rgba(255,255,255,.15); }
  .hub::after { content: ''; position: absolute; inset: -10px; border-radius: 50%; border: 1px solid rgba(151,108,246,.5); animation: pulse 3.2s ease-out infinite; }
  @keyframes pulse { from { transform: scale(.92); opacity: .9; } to { transform: scale(1.35); opacity: 0; } }
  .hub strong { display: block; font-size: 15px; }
  .hub small { display: block; color: #e3d9ff; font-size: 11px; margin-top: 3px; }

  footer { padding: 0 28px 18px; color: var(--ink2); font-size: 12px; text-align: center; }

  /* ---------- lista (pantallas angostas) ---------- */
  .list { display: none; list-style: none; margin: 0; padding: 14px 16px 24px; }
  .lcard { pointer-events: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; background: rgba(15,9,38,.78);
           border: 1px solid rgba(151,108,246,.3); border-radius: 12px; padding: 12px; margin-bottom: 10px; }
  .lmain { display: flex; gap: 12px; align-items: center; color: var(--ink); text-decoration: none; flex: 1 1 100%; }
  .orb.sm { width: 42px; height: 42px; font-size: 11px; flex: none; }
  .ldesc { display: block; color: var(--ink2); font-size: 12px; margin-top: 2px; }
  @media (max-width: 720px) {
    .stage { display: none; }
    .list { display: block; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ring, .counter, .spoke, .hub::after { animation: none !important; }
  }
</style>
</head>
<body>
<div id="galaxy" aria-hidden="true"></div>
<div class="page">
  <header>
    <h1>B2B Ecosystem</h1>
    <p>Migración progresiva a Ownia · ${migrated} de ${modules.length} módulos servidos desde acá${validating ? ` · ${validating} en validación` : ''}</p>
    <div class="legend"><span class="l-ok">En Ownia</span><span class="l-val">En validación (en paralelo a Apps Script)</span><span class="l-gas">Apps Script</span></div>
  </header>
  <main class="stage">
    <div class="map">
      <div class="orbit o1"></div>
      <div class="orbit o2"></div>
      <div class="ring r2">
        <svg viewBox="-50 -50 100 100" aria-hidden="true">${spokes(outer, RF2, statusOf)}</svg>
        ${outer.map((x) => nodeHtml(x.m, basePath, x.angle, 2)).join('\n        ')}
      </div>
      <div class="ring r1">
        <svg viewBox="-50 -50 100 100" aria-hidden="true">${spokes(inner, RF1, statusOf)}</svg>
        ${inner.map((x) => nodeHtml(x.m, basePath, x.angle, 1)).join('\n        ')}
      </div>
      <div class="hub"><div><strong>B2B Ecosystem</strong><small>Ownia · Despegar</small></div></div>
    </div>
  </main>
  <ul class="list">
    ${modules.map((m) => listCard(m, basePath)).join('\n    ')}
  </ul>
  <footer>Los módulos "Apps Script" abren su landing de Google, que sigue siendo la productiva. Los "En validación" corren acá en paralelo, con los mismos datos.</footer>
</div>
<script src="${basePath}/_static/galaxy.js"></script>
<script>
  window.GalaxyBackground && window.GalaxyBackground.mount(document.getElementById('galaxy'), {
    starColors: ['#976cf6', '#ffffff', '#1fc7b4', '#c9b6ff'],
    density: 1, glowIntensity: 0.35, twinkleIntensity: 0.4, rotationSpeed: 0.05, starSpeed: 0.4,
    mouseRepulsion: true, repulsionStrength: 2, transparent: true, intro: true,
  });
</script>
</body>
</html>`;
}

module.exports = { indexPage };
