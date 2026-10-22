// Portada de la app: menú de tableros B2B, pensado para que lo abra dirección en una notebook.
// Tarjetas fijas agrupadas por uso (no por infraestructura), con la misma estética que las
// landings (claro, Inter, violeta Despegar). El estado de la migración va en una línea al pie.
//
// Links: los módulos en Apps Script abren su landing de Google (la productiva, en otra pestaña).
// Los "en validación" abren la versión de Ownia solo para quien puede entrar (allowedUsers);
// el resto va directo a GAS, así nadie de afuera del equipo choca con un 403.
const { escapeHtml } = require('./gas-template');

// Grupos por uso, en orden de prioridad. Un módulo que no esté acá cae en el último grupo.
const GROUPS = [
  { title: 'Resultados (P&L)', slugs: ['pnl-managerial', 'pnl-accounting', 'profit-sharing'] },
  { title: 'Seguimiento y performance', slugs: ['hub', 'daily', 'one-pager', 'fvm-negativo'] },
  { title: 'Producto', slugs: ['okr-b2b2c'] },
  { title: 'Documentación', slugs: ['manual'] },
];

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

function card(m, basePath, canOpen) {
  const l = links(m, basePath, canOpen);
  const target = l.external ? ' target="_blank" rel="noopener"' : '';
  const beta = l.beta ? '<span class="beta" title="Corre en Ownia en paralelo a Apps Script; solo la ve el equipo B2B">Beta · equipo B2B</span>' : '';
  const alt = l.alt
    ? `<a class="alt" href="${escapeHtml(l.alt)}" target="_blank" rel="noopener">Versión Apps Script ↗</a>`
    : '';
  return `<li class="card">
        <a class="main" href="${escapeHtml(l.main)}"${target}>
          <span class="name">${escapeHtml(m.title)}${beta}</span>
          <span class="desc">${escapeHtml(m.desc)}</span>
          <span class="cta">Abrir${l.external ? ' ↗' : ' →'}</span>
        </a>${alt}
      </li>`;
}

function grouped(modules) {
  const used = new Set();
  const out = GROUPS.map((g) => {
    const items = g.slugs.map((s) => modules.find((m) => m.slug === s)).filter(Boolean);
    items.forEach((m) => used.add(m.slug));
    return { title: g.title, items };
  });
  const rest = modules.filter((m) => !used.has(m.slug));
  if (rest.length) out[out.length - 1].items.push(...rest);
  return out.filter((g) => g.items.length);
}

function indexPage({ modules, basePath, canOpen = () => true }) {
  const migrated = modules.filter((m) => m.ownia && !m.validating).length;
  const validating = modules.filter((m) => m.ownia && m.validating).length;
  const sections = grouped(modules)
    .map((g) => `<section>
    <h2>${escapeHtml(g.title)}</h2>
    <ul class="grid">
      ${g.items.map((m) => card(m, basePath, canOpen)).join('\n      ')}
    </ul>
  </section>`)
    .join('\n  ');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tableros B2B · Despegar</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  /* Mismos tokens que las landings (P&L Managerial / Accounting). */
  :root {
    --bg: #f7f6fb; --surface: #fff; --border: #ece8f4; --border2: #ddd6ea;
    --navy: #1b1533; --accent: #6d28d9; --accent2: #8b5cf6;
    --text: #1f1a33; --muted: #6b6584; --radius: 14px;
    --shadow: 0 1px 2px rgba(27,21,51,.05), 0 8px 24px rgba(27,21,51,.05);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 32px; height: 64px;
           display: flex; align-items: center; }
  .logo { color: var(--navy); font-size: 17px; font-weight: 800; letter-spacing: -.01em; }
  .logo span { color: var(--accent); }
  main { max-width: 1180px; margin: 0 auto; padding: 32px 32px 16px; }
  h1 { margin: 0; font-size: 28px; font-weight: 800; color: var(--navy); letter-spacing: -.02em; }
  .lead { margin: 6px 0 0; color: var(--muted); font-size: 15px; }
  section { margin-top: 30px; }
  h2 { margin: 0 0 12px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow);
          display: flex; flex-direction: column; transition: border-color .15s, box-shadow .15s, transform .15s; }
  .card:hover, .card:focus-within { border-color: var(--accent2); box-shadow: 0 10px 28px rgba(109,40,217,.12); transform: translateY(-2px); }
  .main { flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 18px 20px; color: inherit; text-decoration: none; border-radius: var(--radius); }
  .main:focus-visible, .alt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .name { font-size: 17px; font-weight: 700; color: var(--navy); line-height: 1.3; }
  .desc { font-size: 14px; color: var(--muted); line-height: 1.45; flex: 1; }
  .cta { font-size: 14px; font-weight: 700; color: var(--accent); }
  .beta { display: inline-block; margin-left: 8px; vertical-align: 2px; font-size: 11px; font-weight: 700; color: var(--accent);
          border: 1px dashed var(--accent2); border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
  .alt { margin: -6px 20px 14px; font-size: 12px; color: var(--muted); text-decoration: none; align-self: flex-start; }
  .alt:hover { color: var(--accent); text-decoration: underline; }
  footer { max-width: 1180px; margin: 0 auto; padding: 24px 32px 32px; color: var(--muted); font-size: 12px; }
  @media (max-width: 1000px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 640px) {
    header, main, footer { padding-left: 16px; padding-right: 16px; }
    .grid { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) { .card { transition: none; } .card:hover, .card:focus-within { transform: none; } }
</style>
</head>
<body>
<header><div class="logo">Despegar <span>B2B</span></div></header>
<main>
  <h1>Tableros B2B</h1>
  <p class="lead">Elegí un tablero. Los que dicen ↗ se abren en otra pestaña.</p>
  ${sections}
</main>
<footer>Migración a Ownia: ${migrated} de ${modules.length} tableros servidos desde acá${validating ? ` · ${validating} en validación (en paralelo a Apps Script, que sigue siendo el productivo)` : ''}.</footer>
</body>
</html>`;
}

module.exports = { indexPage };
