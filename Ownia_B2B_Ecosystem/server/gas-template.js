// Compilador de templates HtmlService (scriptlets de Apps Script):
//   <? código ?>     se ejecuta
//   <?= expr ?>      imprime escapado. GAS escapa según el contexto (p.ej. JS dentro de
//                    <script>); acá siempre es escape HTML. Hoy el repo solo usa <?!= ?>.
//   <?!= expr ?>     imprime sin escapar (típico: <?!= include('css') ?>)
// Devuelve el código fuente de una función `(data) => string` que se evalúa DENTRO del
// contexto vm del módulo, así los scriptlets ven las funciones globales del proyecto GAS.

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function compileTemplate(text) {
  const parts = [];
  const re = /<\?(!=|=)?([\s\S]*?)\?>/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push('__p(' + JSON.stringify(text.slice(last, m.index)) + ');');
    const kind = m[1];
    const code = m[2];
    // El salto de línea antes de cerrar evita que un comentario // dentro del scriptlet se
    // coma el ')'.
    if (kind === '=') parts.push('__p(__esc(' + code + '\n));');
    else if (kind === '!=') parts.push('__p(' + code + '\n);');
    else parts.push(code + '\n');
    last = re.lastIndex;
  }
  if (last < text.length) parts.push('__p(' + JSON.stringify(text.slice(last)) + ');');

  // `with` expone las propiedades asignadas al template (template.foo = ...) como variables,
  // igual que en GAS. El código vm corre en modo no estricto, así que `with` es válido.
  return (
    '(function (__data, __esc) {\n' +
    '  var __out = [];\n' +
    '  function __p(s) { __out.push(s == null ? "" : String(s)); }\n' +
    '  with (__data) {\n' +
    parts.join('\n') +
    '\n  }\n' +
    '  return __out.join("");\n' +
    '})'
  );
}

module.exports = { compileTemplate, escapeHtml };
