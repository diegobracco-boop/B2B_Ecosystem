// Portada de la app: menú de tableros B2B, pensado para que lo abra dirección en una notebook.
// Estilo copiado de la portada de b2b-dashboard (rama main de despegar/B2B_Ecosystem_Ownia):
// oscuro por defecto con toggle claro (misma clave de localStorage, así la preferencia se
// comparte), Poppins, topbar con línea violeta, hero con degradé y tarjetas con ícono. El primer
// grupo arma un bento con la tarjeta destacada. Intro "The B2B Ecosystem" igual a la de
// b2b-dashboard: una vez por sesión, se saltea con clic/tecla, nunca con prefers-reduced-motion.
//
// Links: los módulos en Apps Script abren su landing de Google (la productiva, en otra pestaña).
// Los "en validación" abren la versión de Ownia solo para quien puede entrar (allowedUsers);
// el resto va directo a GAS, así nadie de afuera del equipo choca con un 403.
const { escapeHtml } = require('./gas-template');

// Grupos por uso, en orden de prioridad. El primero de `featured` va destacado. Un módulo que
// no esté acá cae en el último grupo.
const GROUPS = [
  { title: 'Resultados (P&L)', slugs: ['pnl-managerial', 'pnl-accounting', 'profit-sharing'], featured: true },
  { title: 'Seguimiento y performance', slugs: ['hub', 'daily', 'one-pager', 'fvm-negativo'] },
  { title: 'Producto', slugs: ['okr-b2b2c'] },
  { title: 'Documentación', slugs: ['manual'] },
];

// Íconos (trazos de 24x24, mismo estilo que b2b-dashboard).
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
};
const ICON_OF = {
  'pnl-managerial': 'chart', 'pnl-accounting': 'ledger', 'profit-sharing': 'bank', hub: 'grid', daily: 'calendar',
  'one-pager': 'globe', 'fvm-negativo': 'down', 'okr-b2b2c': 'target', manual: 'book',
};
const ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const EXTERNAL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';

function icon(m, size) {
  const d = ICONS[ICON_OF[m.slug]] || ICONS.grid;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

function statusOf(m) {
  if (m.ownia && m.validating) return 'val';
  return m.ownia ? 'ok' : 'gas';
}

function links(m, basePath, canOpen) {
  const own = `${basePath}/${m.slug}`;
  const st = statusOf(m);
  if (st === 'gas' || (st === 'val' && !canOpen(m))) return { main: m.gasUrl, external: true, alt: null, beta: false };
  return { main: own, external: false, alt: st === 'val' ? m.gasUrl : null, beta: st === 'val' };
}

function card(m, basePath, canOpen, { featured = false, area = '' } = {}) {
  const l = links(m, basePath, canOpen);
  const target = l.external ? ' target="_blank" rel="noopener"' : '';
  const id = `card-${m.slug}`;
  const beta = l.beta ? ' <span class="beta" title="Corre en Ownia en paralelo a Apps Script; solo la ve el equipo B2B">Beta · equipo B2B</span>' : '';
  const alt = l.alt
    ? `<a class="alt" href="${escapeHtml(l.alt)}" target="_blank" rel="noopener">Versión Apps Script ↗</a>`
    : '';
  const cta = `<a class="cta${featured ? ' solid' : ''}" href="${escapeHtml(l.main)}"${target}>Abrir el tablero ${l.external ? EXTERNAL : ARROW}</a>`;
  const viz = featured
    ? `<svg class="viz" viewBox="0 0 120 72" aria-hidden="true">
            <rect class="bar" x="6" y="44" width="14" height="22" rx="2"/><rect class="bar" x="28" y="34" width="14" height="32" rx="2"/>
            <rect class="bar" x="50" y="38" width="14" height="28" rx="2"/><rect class="bar" x="72" y="22" width="14" height="44" rx="2"/>
            <rect class="bar hi" x="94" y="10" width="14" height="56" rx="2"/><path class="ln" d="M6 40 L35 32 L57 30 L79 20 L101 12"/>
          </svg>`
    : '';
  return `<section id="${id}" class="card${featured ? ' featured' : ''}"${area ? ` style="grid-area:${area}"` : ''} aria-labelledby="${id}-t">
          ${viz}<div class="ico">${icon(m, featured ? 26 : 22)}</div>
          <h3 id="${id}-t">${escapeHtml(m.title)}${beta}</h3>
          <p>${escapeHtml(m.desc)}</p>
          ${featured ? `<div class="cta-row">${cta}${alt}</div>` : `${cta}${alt}`}
        </section>`;
}

function grouped(modules) {
  const used = new Set();
  const out = GROUPS.map((g) => {
    const items = g.slugs.map((s) => modules.find((m) => m.slug === s)).filter(Boolean);
    items.forEach((m) => used.add(m.slug));
    return { ...g, items };
  });
  const rest = modules.filter((m) => !used.has(m.slug));
  if (rest.length) out[out.length - 1].items.push(...rest);
  return out.filter((g) => g.items.length);
}

function groupHtml(g, basePath, canOpen) {
  // Bento como b2b-dashboard: destacada a la izquierda ocupando dos filas, las otras dos a la derecha.
  if (g.featured && g.items.length === 3) {
    const [a, b, c] = g.items;
    return `<div class="grid bento">
        ${card(a, basePath, canOpen, { featured: true, area: 'f' })}
        ${card(b, basePath, canOpen, { area: 'b' })}
        ${card(c, basePath, canOpen, { area: 'c' })}
      </div>`;
  }
  return `<div class="grid">
        ${g.items.map((m) => card(m, basePath, canOpen)).join('\n        ')}
      </div>`;
}

function indexPage({ modules, basePath, canOpen = () => true }) {
  const migrated = modules.filter((m) => m.ownia && !m.validating).length;
  const validating = modules.filter((m) => m.ownia && m.validating).length;
  const sections = grouped(modules)
    .map((g, i) => `<div class="group reveal" style="--i:${i + 1}">
      <h2>${escapeHtml(g.title)}</h2>
      ${groupHtml(g, basePath, canOpen)}
    </div>`)
    .join('\n    ');

  return `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The B2B Ecosystem · Despegar</title>
<script>
  // Estado inicial antes del primer render (sin parpadeo): tema guardado (misma clave que
  // b2b-dashboard: oscuro por defecto) e intro una vez por sesión, salvo prefers-reduced-motion.
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
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root {
    --primary: #5626e9; --primary-d: rgba(86, 38, 233, .16); --secondary: #8e5ff3;
    --bg: #0F0F1E; --surface: #1A1A2E; --segment-bg: #222238;
    --border: rgba(255, 255, 255, .07); --border-2: rgba(255, 255, 255, .13);
    --text: #FFFFFF; --text-2: #B8B8D1; --text-3: #8a8aa3;
    --hover-bd: rgba(142, 95, 243, .55); --glow: rgba(86, 38, 233, .28);
    --shadow: 0 18px 50px rgba(0, 0, 0, .5);
    --r: 12px; --ease: cubic-bezier(0.23, 1, 0.32, 1);
    --font: 'Poppins', -apple-system, 'Segoe UI', sans-serif;
    --mono: 'JetBrains Mono', 'Courier New', monospace;
    color-scheme: dark;
  }
  :root[data-theme="light"] {
    --primary-d: rgba(86, 38, 233, .10); --secondary: #7B4FFF;
    --bg: #F4F4F8; --surface: #FFFFFF; --segment-bg: #F0F0F6;
    --border: rgba(0, 0, 0, .08); --border-2: rgba(0, 0, 0, .14);
    --text: #12111E; --text-2: #3D3B52; --text-3: #6B6B85;
    --hover-bd: rgba(86, 38, 233, .5); --glow: rgba(86, 38, 233, .12);
    --shadow: 0 18px 50px rgba(18, 17, 30, .16);
    color-scheme: light;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font); background: var(--bg); color: var(--text); font-size: 14px;
    min-height: 100vh; display: flex; flex-direction: column;
    background-image:
      radial-gradient(900px 480px at 8% -8%, var(--glow), transparent 70%),
      radial-gradient(700px 400px at 100% 0%, rgba(142, 95, 243, .10), transparent 70%);
    background-repeat: no-repeat;
  }
  :focus-visible { outline: 2px solid var(--secondary); outline-offset: 3px; border-radius: 6px; }

  .topbar { background: var(--surface); min-height: 52px; position: relative; display: flex; align-items: center; gap: 12px; padding: 6px 20px; }
  .topbar::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: linear-gradient(90deg, var(--primary) 0%, transparent 55%); }
  .topbar-logo { font-size: 16px; font-weight: 800; letter-spacing: -0.5px; }
  .topbar-divider { width: 1px; height: 18px; background: var(--border); }
  .topbar-title { font-size: 11px; font-weight: 500; color: var(--text-3); letter-spacing: .3px; white-space: nowrap; }
  .topbar-right { margin-left: auto; display: flex; align-items: center; }
  .theme-btn { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; background: transparent;
               border: 1px solid var(--border-2); color: var(--text-2); cursor: pointer; transition: border-color .2s var(--ease), color .2s var(--ease); }
  .theme-btn:hover { border-color: var(--hover-bd); color: var(--text); }

  .wrap { width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 24px; }
  main { flex: 1; padding: 56px 0 48px; }
  .hero { max-width: 640px; margin-bottom: 36px; }
  .hero h1 { font-size: clamp(34px, 6vw, 56px); font-weight: 800; line-height: 1.04; letter-spacing: -0.035em; }
  .hero h1 .g { background: linear-gradient(100deg, var(--secondary), var(--primary) 70%); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .hero p { margin-top: 16px; font-size: 16px; line-height: 1.6; color: var(--text-2); max-width: 50ch; }

  .group + .group { margin-top: 36px; }
  .group h2 { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); margin-bottom: 14px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .grid.bento { grid-template-columns: 1.55fr 1fr; grid-template-areas: "f b" "f c"; }

  .card { position: relative; display: flex; flex-direction: column; gap: 10px; background: var(--surface);
          border: 1px solid var(--border); border-radius: var(--r); padding: 24px; overflow: hidden;
          transition: border-color .25s var(--ease), transform .25s var(--ease), box-shadow .25s var(--ease); }
  .card .ico { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 10px; background: var(--primary-d); color: var(--secondary); margin-bottom: 6px; }
  .card h3 { font-size: 18px; font-weight: 700; letter-spacing: -0.015em; }
  .card p { color: var(--text-2); line-height: 1.6; font-size: 14px; max-width: 52ch; }
  .cta { margin-top: auto; padding-top: 14px; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px;
         color: var(--secondary); text-decoration: none; width: fit-content; }
  .cta::after { content: ''; position: absolute; inset: 0; }   /* toda la tarjeta es clickeable */
  .cta svg { transition: transform .25s var(--ease); }
  a.cta:focus-visible { outline: none; }
  .card:has(a.cta:focus-visible) { outline: 2px solid var(--secondary); outline-offset: 3px; }
  .card:hover { border-color: var(--hover-bd); transform: translateY(-3px); box-shadow: var(--shadow); }
  .card:hover .cta svg { transform: translateX(4px); }
  /* El link secundario queda arriba del link que cubre la tarjeta. */
  .alt { position: relative; z-index: 1; font-size: 12px; color: var(--text-3); text-decoration: none; width: fit-content; }
  .alt:hover { color: var(--text); text-decoration: underline; }
  .beta { display: inline-block; vertical-align: 3px; margin-left: 6px; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600;
          color: var(--text-2); background: var(--segment-bg); border: 1px dashed var(--hover-bd); white-space: nowrap; }

  .card.featured { padding: 32px; gap: 12px; border-color: rgba(142, 95, 243, .35);
                   background: radial-gradient(520px 260px at 100% 0%, rgba(142, 95, 243, .20), transparent 70%), var(--surface); }
  .card.featured .ico { width: 52px; height: 52px; background: linear-gradient(135deg, var(--primary), var(--secondary)); color: #fff; }
  .card.featured h3 { font-size: 26px; font-weight: 800; letter-spacing: -0.025em; }
  .card.featured p { font-size: 15px; }
  .card.featured .cta-row { margin-top: auto; padding-top: 22px; display: flex; flex-direction: column; gap: 12px; }
  .cta.solid { margin-top: 0; padding: 11px 18px; color: #fff; border-radius: 8px; background: linear-gradient(135deg, var(--primary), var(--secondary)); }
  .viz { position: absolute; right: 32px; bottom: 32px; width: 230px; height: 138px; color: var(--secondary); opacity: .9; }
  .viz .bar { fill: currentColor; opacity: .35; }
  .viz .bar.hi { opacity: 1; }
  .viz .ln { fill: none; stroke: var(--text-2); stroke-width: 1.5; stroke-dasharray: 3 3; opacity: .7; }

  footer { padding: 0 0 28px; }
  footer .wrap { border-top: 1px solid var(--border); padding-top: 18px; font-size: 12px; color: var(--text-3); font-family: var(--mono); }

  @media (max-width: 1000px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 820px) {
    main { padding: 40px 0; }
    .grid, .grid.bento { grid-template-columns: 1fr; grid-template-areas: none; }
    .grid.bento .card { grid-area: auto !important; }
    .viz { display: none; }
  }
  @media (max-width: 480px) {
    .wrap { padding: 0 16px; }
    .topbar { padding: 6px 16px; }
    .card, .card.featured { padding: 20px; }
    .card.featured h3 { font-size: 22px; }
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
    .card, .cta svg { transition: none !important; }
    .card:hover { transform: none; }
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
  <span class="topbar-logo">despegar</span>
  <div class="topbar-divider"></div>
  <span class="topbar-title">B2B &middot; Ecosystem</span>
  <div class="topbar-right">
    <button type="button" class="theme-btn" id="theme-btn" aria-label="Cambiar tema claro u oscuro" title="Cambiar tema">
      <svg id="icon-dark" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      <svg id="icon-light" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="display:none" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
    </button>
  </div>
</header>
<main>
  <div class="wrap">
    <div class="hero reveal" style="--i:0">
      <h1>The <span class="g">B2B</span> Ecosystem</h1>
      <p>Financial results and metrics<br>at the speed of your business</p>
    </div>
    ${sections}
  </div>
</main>
<footer class="reveal" style="--i:5">
  <div class="wrap">Migración a Ownia: ${migrated} de ${modules.length} tableros servidos desde acá${validating ? ` · ${validating} en validación (en paralelo a Apps Script, que sigue siendo el productivo)` : ''}</div>
</footer>
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
</body>
</html>`;
}

module.exports = { indexPage };
