/* OKR Producto B2B2C en Ownia — diseño de Ownia sobre el mismo dashboard (2026-10-30).
 * Lo inyecta server/index.js en el módulo okr-b2b2c (`layout` en server/modules.js). El HTML de Apps Script no se toca:
 * mismas secciones (encabezado con Trimestral / Mensual, leyenda, tabla de % con Total, fuentes de datos, tabla de
 * valores nominales) y mismos formatos (chips de cumplimiento, badge "ritmo", TBD); acá solo cambia la presentación.
 *
 *   1) Diseño: minimalista, paleta oficial de Despegar (lila), oscuro por defecto (el fondo del menú principal) o claro
 *      con el botón del encabezado (misma clave que el menú y el Manual). Se pisan las variables y las clases del
 *      dashboard; las variables viejas (--muted, --muted2…) se redefinen sobre las nuevas porque el render las usa inline.
 *   2) "🏠 Home" al menú principal (no dentro de un iframe).
 *   3) ?view=m abre en Mensual, ?view=q en Trimestral (accesos rápidos del menú).
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var home = script && script.getAttribute('data-home');

  // ───────────────────────────── 1) Diseño ─────────────────────────────
  try { if (localStorage.getItem('b2b-api-theme') === 'light') document.documentElement.setAttribute('data-theme', 'light'); } catch (e) { /* sin storage */ }
  var font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap';
  (document.head || document.documentElement).appendChild(font);

  var css = [
    ':root{--bg:#0F0F1E;--surface:#1A1A2E;--surface2:#222238;--line:rgba(255,255,255,.09);',
    '--ink:#f5f5f7;--ink2:#b8b8d1;--ink3:#8a8aa3;--acc:#8e5ff3;--acc2:#a780ff;--acc3:#c4b5fd;',
    '--acc-a06:rgba(167,128,255,.06);--acc-a18:rgba(167,128,255,.18);',
    '--ok:#4bb8aa;--ok-bg:rgba(75,184,170,.16);--warn:#fbbf24;--warn-bg:rgba(251,191,36,.14);--bad:#ff7a7a;--bad-bg:rgba(255,122,122,.14);',
    '--codebg:rgba(0,0,0,.3);--hdr:rgba(15,15,30,.78);color-scheme:dark;',
    /* variables del dashboard de GAS (el render las usa en estilos inline) */
    '--border:var(--line);--border2:var(--line);--text:var(--ink);--muted:var(--ink2);--muted2:var(--ink3);',
    '--desp-purple:var(--acc);--accent:var(--acc);--red:var(--bad);--green:var(--ok);--radius:20px;--shadow:none}',
    ':root[data-theme="light"]{--bg:#fff;--surface:#f5f5f7;--surface2:#ececf1;--line:rgba(0,0,0,.08);',
    '--ink:#1d1d1f;--ink2:#515154;--ink3:#6e6e73;--acc:#550fed;--acc2:#550fed;--acc3:#3d00d1;',
    '--acc-a06:rgba(85,15,237,.04);--acc-a18:rgba(85,15,237,.1);',
    '--ok:#02776b;--ok-bg:#e3f4f1;--warn:#8a5a00;--warn-bg:#fff4d6;--bad:#d6361f;--bad-bg:#ffe9e5;',
    '--codebg:#fff;--hdr:rgba(255,255,255,.8);color-scheme:light}',
    'body{background:var(--bg);color:var(--ink);font-family:Poppins,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14.5px;line-height:1.5;-webkit-font-smoothing:antialiased}',
    ':focus-visible{outline:2px solid var(--acc);outline-offset:3px;border-radius:8px}',

    /* encabezado: barra translúcida, sin degradé */
    'header{background:var(--hdr);-webkit-backdrop-filter:saturate(180%) blur(18px);backdrop-filter:saturate(180%) blur(18px);',
    'box-shadow:none;border-bottom:1px solid var(--line);height:auto;min-height:72px;padding:14px 32px;gap:16px;flex-wrap:wrap}',
    '.ow-brand{display:flex;align-items:center;gap:18px;min-width:0}',
    '.logo-main{color:var(--ink);font-size:17px;font-weight:600;letter-spacing:-.02em}',
    '.logo-main span{color:var(--acc2)}',
    '.logo-sub{color:var(--ink3);font-size:12.5px;font-weight:400;letter-spacing:0;text-transform:none}',
    '#h2-pending{background:var(--warn-bg)!important;color:var(--warn)!important;border:0!important;border-radius:10px!important;font-weight:500!important;padding:6px 12px!important}',
    '#last-upd{color:var(--ink3);font-size:12px}',
    '.ow-home{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:13px;font-weight:500;',
    'color:var(--ink);text-decoration:none;box-shadow:inset 0 0 0 1px var(--line);transition:color .2s,box-shadow .2s;white-space:nowrap}',
    '.ow-home:hover{color:var(--acc2);box-shadow:inset 0 0 0 1px var(--acc2)}',
    '.ow-theme{width:36px;height:36px;display:grid;place-items:center;border-radius:50%;background:transparent;border:0;color:var(--ink2);cursor:pointer;transition:background .2s,color .2s}',
    '.ow-theme:hover{background:var(--surface);color:var(--ink)}',

    /* Trimestral / Mensual: control segmentado */
    '.gran-toggle{background:var(--surface);border:0;border-radius:999px;padding:3px;gap:2px}',
    '.gran-btn{border-radius:999px;padding:6px 16px;font:500 13px Poppins,sans-serif;letter-spacing:0;color:var(--ink2)}',
    '.gran-btn.active{background:var(--acc);color:#fff;box-shadow:none}',
    '.gran-btn:hover:not(.active){background:var(--surface2);color:var(--ink)}',

    /* contenido */
    /* todo el ancho de la pantalla: en Mensual entran los 6 meses + Q1/Q2 sin scroll horizontal */
    'main{padding:40px 32px 96px;max-width:none}',
    '.sec-title{font-size:34px;font-weight:600;letter-spacing:-.035em;line-height:1.1;text-transform:none;color:var(--ink);border:0;padding:0;margin-bottom:28px}',

    /* leyenda */
    '.okr-legend{background:var(--surface);border:0;border-radius:20px;box-shadow:none;padding:22px 26px;gap:16px 32px;margin-bottom:28px}',
    '.okr-legend-group-title{font-size:12.5px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--ink3)}',
    '.okr-legend-pill{font-size:12.5px;font-weight:500;padding:5px 12px}',
    '.okr-legend-pill.ok{background:var(--ok-bg);color:var(--ok)}',
    '.okr-legend-pill.warn{background:var(--warn-bg);color:var(--warn)}',
    '.okr-legend-pill.bad{background:var(--bad-bg);color:var(--bad)}',
    '.okr-legend-divider{background:var(--line)}',
    '.okr-legend-ritmo-box p{font-size:13px;color:var(--ink2)}',
    '.okr-legend-ritmo-box strong{color:var(--ink);font-weight:600}',
    '.okr-legend-ritmo-month{background:transparent;border:0;box-shadow:inset 0 0 0 1px var(--line);border-radius:999px;padding:3px 10px;color:var(--ink2);font-weight:500}',
    '.okr-legend-ritmo-month span{color:var(--acc2);font-weight:600}',

    /* tablas */
    '.okr-wrap{gap:24px}',
    '.okr-table-wrap{background:var(--surface);border:0;border-radius:20px;box-shadow:none}',
    '.okr-lob-hdr{background:transparent;color:var(--ink);font-size:20px;font-weight:600;letter-spacing:-.02em;padding:24px 28px 10px;border-radius:0}',
    '.okr-table{font-size:15px;min-width:980px}',
    '.okr-table th{background:transparent;color:var(--ink3);font-size:12.5px;font-weight:500;padding:12px 6px;border-right:0;border-bottom:1px solid var(--line)}',
    /* columnas fijas angostas; los períodos se reparten el resto del ancho */
    '.okr-table th:nth-child(1){width:118px}.okr-table th:nth-child(2){width:64px}.okr-table th:nth-child(4){width:56px}',
    '.okr-table th:nth-child(3){padding-left:28px;width:23%}',
    '.okr-table th:nth-child(n+5){width:auto}',
    '.okr-table td:nth-child(n+5){padding:6px 4px;white-space:normal;overflow:visible;text-overflow:clip;line-height:1.35}',
    '.okr-table td:nth-child(n+5)>span[style*="font-size:13px"]{font-size:12px!important}',
    '.okr-table th.th-q{background:transparent;color:var(--ink2);border-left:1px solid var(--line)}',
    '.okr-table td{height:60px;font-size:15px;border-right:0;border-bottom:1px solid var(--line);color:var(--ink)}',
    '.okr-table td:nth-child(1),.okr-table td:nth-child(2){color:var(--ink3);font-size:13px}',
    '.okr-table td:nth-child(3){padding-left:28px;color:var(--ink);font-weight:500}',
    '.okr-table td.td-q{border-left:1px solid var(--line);font-weight:500}',
    '.okr-table tbody tr:hover{background:var(--acc-a06)}',
    '.okr-table tr.okr-total td{font-weight:600;border-top:1px solid var(--line);background:var(--acc-a06)}',

    /* chips de cumplimiento (mismo semáforo: ≥100% / ≥80% / <80%) */
    '.okr-chip{padding:5px 14px;font-size:13.5px;font-weight:600;letter-spacing:0}',
    '.okr-ok{background:var(--ok-bg);color:var(--ok)}',
    '.okr-warn{background:var(--warn-bg);color:var(--warn)}',
    '.okr-bad{background:var(--bad-bg);color:var(--bad)}',
    '.okr-tbd{background:var(--surface2);color:var(--ink3)}',
    '.okr-ritmo-badge{background:var(--acc-a18);color:var(--acc3);font-weight:500;font-size:10.5px;letter-spacing:0}',
    ':root[data-theme="light"] .okr-ritmo-badge{color:var(--acc)}',

    /* fuentes de datos */
    '.okr-sources{border-top:1px solid var(--line);color:var(--ink2)}',
    '.okr-sources summary{padding:14px 28px;font-size:13px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--ink3)}',
    '.okr-sources summary:hover,.okr-sources[open] summary{color:var(--acc2)}',
    '.okr-sources[open] summary{border-bottom:1px solid var(--line)}',
    '.okr-sources-body{padding:18px 28px 22px;gap:14px}',
    '.okr-source-label{font-size:13px;font-weight:600;color:var(--ink)}',
    '.okr-source-label .kr-num{background:transparent;border:0;box-shadow:inset 0 0 0 1px var(--line);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;color:var(--ink3)}',
    '.okr-source-desc{font-size:13px;color:var(--ink2)}',
    '.okr-source-desc pre{background:var(--codebg);border:1px solid var(--line);border-radius:12px;padding:12px}',
    '.okr-source-desc code{color:var(--ink)}',
    '.okr-source-desc a{color:var(--acc2);font-weight:500}',

    /* valores nominales */
    '.okr-nom-wrap{margin-top:0}',
    '.okr-nom-hdr{background:transparent;border:0;border-radius:0;padding:24px 28px 10px;font-size:20px;font-weight:600;letter-spacing:-.02em;text-transform:none;color:var(--ink)}',
    '.okr-nom-hdr svg{display:none}',
    '.okr-nom-hdr span{font-size:13px!important;color:var(--ink3)!important;letter-spacing:0!important}',

    /* carga / error */
    '.okr-placeholder{background:var(--surface);border:0;border-radius:20px;color:var(--ink3);font-size:14px}',
    '.spinner{border-color:var(--line);border-top-color:var(--acc)}',

    '@media (max-width:820px){header{position:static;padding:12px 20px}main{padding:28px 16px 64px}.sec-title{font-size:26px}',
    '.okr-legend-divider{display:none}.okr-lob-hdr,.okr-nom-hdr{padding:20px 20px 8px}}',
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  var MOON = '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var SUN = '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';

  document.addEventListener('DOMContentLoaded', function () {
    // Esta capa se inyecta antes que el <style> del dashboard: se mueve al final para que sus reglas ganen.
    document.head.appendChild(style);
    var root = document.documentElement;
    var header = document.querySelector('header');
    var logo = header && header.querySelector('.logo-wrap');
    var right = header && header.querySelector('.header-right');

    // ───────────────────────────── 2) Home ─────────────────────────────
    if (logo) {
      var brand = document.createElement('div');
      brand.className = 'ow-brand';
      logo.parentNode.insertBefore(brand, logo);
      if (home && window.top === window) {
        var a = document.createElement('a');
        a.className = 'ow-home';
        a.href = home;
        a.textContent = '🏠 Home';
        a.title = 'Volver al menú principal de B2B Ecosystem';
        brand.appendChild(a);
      }
      brand.appendChild(logo);
    }

    // Tema claro / oscuro (misma preferencia que el menú principal).
    if (right) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ow-theme';
      btn.setAttribute('aria-label', 'Cambiar tema claro u oscuro');
      btn.title = 'Cambiar tema';
      var sync = function () { btn.innerHTML = root.getAttribute('data-theme') === 'light' ? SUN : MOON; };
      btn.addEventListener('click', function () {
        var light = root.getAttribute('data-theme') !== 'light';
        if (light) root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
        try { localStorage.setItem('b2b-api-theme', light ? 'light' : 'dark'); } catch (e) { /* sin storage */ }
        sync();
      });
      sync();
      right.appendChild(btn);
    }

    // ───────────────────────────── 3) ?view= ─────────────────────────────
    var view = null;
    try { view = new URLSearchParams(window.location.search).get('view'); } catch (e) { /* vista por defecto */ }
    // Solo el estado y los botones: setView() renderiza, y antes de que lleguen los datos mostraría "Sin datos".
    if (view === 'm' && '_monthly' in window) {
      window._monthly = true;
      var b = document.querySelectorAll('#view-toggle .gran-btn');
      for (var i = 0; i < b.length; i++) b[i].classList.toggle('active', i === 1);
    }
  });
})();
