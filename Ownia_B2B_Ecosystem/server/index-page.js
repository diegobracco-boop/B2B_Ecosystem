// Portada de la app: lista los módulos del ecosistema. Los ya migrados abren acá; el resto
// abre su landing de Apps Script, que sigue siendo la productiva.
const { escapeHtml } = require('./gas-template');

function indexPage({ modules, basePath }) {
  const cards = modules
    .map((m) => {
      const href = m.ownia ? `${basePath}/${m.slug}` : m.gasUrl;
      const badge = m.ownia
        ? '<span class="badge ok">En Ownia</span>'
        : '<span class="badge gas">Apps Script</span>';
      const target = m.ownia ? '' : ' target="_blank" rel="noopener"';
      return `<a class="card" href="${escapeHtml(href)}"${target}>
        <div class="row"><span class="name">${escapeHtml(m.title)}</span>${badge}</div>
        <div class="desc">${escapeHtml(m.desc)}</div>
      </a>`;
    })
    .join('\n');
  const migrated = modules.filter((m) => m.ownia).length;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>B2B Ecosystem · Despegar</title>
<style>
  :root { --lila: #550fed; --lila3: #976cf6; --verde: #029687; --text: #1d1d2b; --text2: #4a4a5e; --bg: #f6f5fb; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); }
  header { background: var(--lila); color: #fff; padding: 28px 32px; }
  header h1 { margin: 0 0 6px; font-size: 22px; }
  header p { margin: 0; opacity: .9; font-size: 14px; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 32px 48px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .card { display: block; background: #fff; border-radius: 10px; padding: 16px 18px; text-decoration: none; color: inherit;
          border: 1px solid #e4e1f2; transition: border-color .15s, box-shadow .15s; }
  .card:hover, .card:focus { border-color: var(--lila3); box-shadow: 0 2px 10px rgba(85,15,237,.12); outline: none; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .name { font-weight: 700; font-size: 15px; }
  .desc { color: var(--text2); font-size: 13px; margin-top: 6px; line-height: 1.4; }
  .badge { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
  .badge.ok { background: #ccf3ee; color: #00665c; }
  .badge.gas { background: #ece6ff; color: #3d00d1; }
  .note { color: var(--text2); font-size: 13px; margin: 0 0 18px; }
</style>
</head>
<body>
<header>
  <h1>B2B Ecosystem</h1>
  <p>Migración progresiva a Ownia · ${migrated} de ${modules.length} módulos servidos desde acá</p>
</header>
<main>
  <p class="note">Los módulos marcados "Apps Script" siguen funcionando igual que siempre y abren su landing de Google.</p>
  <div class="grid">
${cards}
  </div>
</main>
</body>
</html>`;
}

module.exports = { indexPage };
