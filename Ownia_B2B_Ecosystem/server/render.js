// Convierte lo que devuelve doGet (HtmlOutput / TextOutput) en una respuesta HTTP.
// En GAS el HTML va adentro de un iframe sandbox y Google arma la página de afuera con el
// título y los meta tags; acá se sirve directo, así que se inyectan en el <head>, junto con
// el shim de google.script.run (public/gas-client.js) ANTES de cualquier otro script.
const { escapeHtml } = require('./gas-template');

function headBlock(output, clientScriptTag) {
  const tags = [clientScriptTag];
  if (output._title != null) tags.push(`<title>${escapeHtml(output._title)}</title>`);
  for (const m of output._meta) tags.push(`<meta name="${escapeHtml(m.name)}" content="${escapeHtml(m.content)}">`);
  if (output._favicon) tags.push(`<link rel="icon" href="${escapeHtml(output._favicon)}">`);
  return tags.join('\n');
}

function injectHead(html, block, hasTitle) {
  let out = html;
  // setTitle() gana sobre el <title> del archivo (igual que en GAS, donde el de adentro
  // del iframe no se ve).
  if (hasTitle) out = out.replace(/<title>[\s\S]*?<\/title>/i, '');
  const head = /<head(\s[^>]*)?>/i.exec(out);
  if (head) return out.slice(0, head.index + head[0].length) + '\n' + block + '\n' + out.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(out);
  if (doctype) return doctype[0] + '\n' + block + '\n' + out.slice(doctype[0].length);
  return block + '\n' + out;
}

function renderOutput(output, { clientScriptTag }) {
  if (!output || typeof output !== 'object' || !output._type) {
    return { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'doGet no devolvió un HtmlOutput ni un TextOutput' };
  }
  if (output._type === 'text') {
    return { status: 200, headers: { 'Content-Type': `${output._mime}; charset=utf-8`, 'Cache-Control': 'no-store' }, body: output._content };
  }
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
  // ALLOWALL = se puede embeber en cualquier iframe (lo usan el Hub y el one-pager).
  if (output._xfo !== 'ALLOWALL') headers['X-Frame-Options'] = 'SAMEORIGIN';
  const body = injectHead(output._content, headBlock(output, clientScriptTag), output._title != null);
  return { status: 200, headers, body };
}

module.exports = { renderOutput, injectHead };
