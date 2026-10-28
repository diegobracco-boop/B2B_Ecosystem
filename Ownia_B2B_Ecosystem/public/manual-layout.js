/* Manual B2B WLs en Ownia — presentación Apple-style + tareas propias en el Gantt (2026-10-28).
 * Lo inyecta server/index.js en el Manual (`layout` en server/modules.js). El HTML de Apps Script no se toca: allá el manual sigue como estaba.
 *
 *   1) Diseño: minimalista, con la paleta oficial de Despegar (lila), oscuro por defecto (el mismo fondo del menú principal) o claro con el botón del
 *      costado; el índice conserva sus íconos. Se logra pisando las variables y los componentes del manual
 *      (los mismos nombres de clase), sin tocar su contenido.
 *   2) Gantt: botón "Agregar tarea" — una tarea para un día, para días de la semana (todos los lunes y jueves…) o una vez al mes — que queda guardada
 *      para todo el equipo (y el Chief) en /notes/manual/gantt (server/notes-store.js). El motor de reglas (lun/jue, último viernes, día hábil…)
 *      vive en manual.html; esta capa solo arma el formulario y suma las tareas a GANTT_ITEMS.
 *   3) <base>/manual?view=gantt abre directo el Gantt (acceso rápido del menú principal).
 */
(function () {
  'use strict';

  // ───────────────────────────── 1) Diseño ─────────────────────────────
  // Oscuro por defecto; claro si se eligió (misma clave que el menú principal, así la preferencia es una sola).
  try { if (localStorage.getItem('b2b-api-theme') === 'light') document.documentElement.setAttribute('data-theme', 'light'); } catch (e) { /* sin storage */ }
  var font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap';
  (document.head || document.documentElement).appendChild(font);

  var css = [
    ':root{--bg:#0F0F1E;--surface:#1A1A2E;--surface2:#222238;--accent:#8e5ff3;--accent2:#a780ff;--accent3:#c4b5fd;',
    '--accent-a06:rgba(167,128,255,.05);--accent-a12:rgba(167,128,255,.1);--accent-a25:rgba(167,128,255,.18);--accent-a33:rgba(167,128,255,.16);',
    '--text:#f5f5f7;--text2:#b8b8d1;--text3:#8a8aa3;--border:rgba(255,255,255,.09);',
    '--green:#4bb8aa;--blue:#38bdf8;--orange:#fb923c;--yellow:#fbbf24;--red:#ff7a7a;--pink:#e879f9;',
    '--side:#13132a;--off:#15152b;--holiday:rgba(255,84,84,.16);--warnbg:rgba(251,191,36,.1);--warntx:#fbbf24;--codebg:rgba(0,0,0,.3);color-scheme:dark}',
    ':root[data-theme="light"]{--bg:#fff;--surface:#f5f5f7;--surface2:#fff;--accent:#550fed;--accent2:#550fed;--accent3:#3d00d1;',
    '--accent-a06:rgba(85,15,237,.04);--accent-a12:rgba(85,15,237,.07);--accent-a25:rgba(85,15,237,.12);--accent-a33:rgba(85,15,237,.1);',
    '--text:#1d1d1f;--text2:#515154;--text3:#6e6e73;--border:rgba(0,0,0,.08);',
    '--green:#02776b;--blue:#0b64b3;--orange:#b4540a;--yellow:#8a5a00;--red:#d6361f;--pink:#a21caf;',
    '--side:#fbfbfd;--off:#f5f5f7;--holiday:#fff2f2;--warnbg:#fff7e0;--warntx:#6b4a00;--codebg:#fff;color-scheme:light}',
    'body{font-family:Poppins,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14.5px;line-height:1.55;-webkit-font-smoothing:antialiased}',
    /* menú lateral: aire, sin barras de color, sin íconos */
    '#sidebar{background:var(--side);border-right:1px solid var(--border);padding:28px 12px}',
    '.sidebar-logo{padding:0 12px 20px;border-bottom:0;margin-bottom:4px}',
    '.sidebar-logo-title{font-size:16px;font-weight:600;color:var(--accent);letter-spacing:-.02em}',
    '.sidebar-logo-sub{font-size:12px;color:var(--text3)}',
    '.sidebar-section{padding:14px 12px 6px;font-size:12px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--text3);margin-top:6px}',
    '.nav-item{padding:8px 12px;border-left:0;border-radius:10px;font-size:14px;color:var(--text2);transition:background .15s,color .15s}',
    '.nav-item:hover{background:var(--surface);color:var(--text)}',
    '.nav-item.active{background:var(--accent-a25);color:var(--accent3);font-weight:500;border-left:0}',
    '.nav-icon{font-size:15px;width:20px;text-align:center;opacity:.9}',
    /* el menú entra completo y, si no alcanza, se scrollea (antes crecía más que la pantalla y no dejaba bajar) */
    '@media (min-width:641px){#sidebar{height:100vh;min-height:0;overflow-y:auto;padding:20px 10px}',
    '.sidebar-logo{padding:0 10px 10px}.sidebar-section{padding:10px 10px 4px;margin-top:2px}',
    '.nav-item{padding:5px 10px;font-size:12.5px;gap:8px}.nav-icon{font-size:13px;width:18px}}',
    /* contenido */
    '#main{padding:56px 64px 96px;max-width:1120px}',
    '.page-header{margin-bottom:36px}',
    '.page-tag{font-size:13px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--text3);margin-bottom:8px}',
    '.page-title{font-size:40px;font-weight:600;letter-spacing:-.035em;line-height:1.1}',
    '.page-title span{color:var(--accent)}',
    '.page-sub{font-size:16px;color:var(--text2);line-height:1.6;max-width:70ch}',
    '.card{background:var(--surface);border:0;border-radius:20px;padding:30px 34px;margin-bottom:20px}',
    '.card-title{font-size:18px;font-weight:600;letter-spacing:-.015em;text-transform:none;color:var(--text);margin-bottom:18px}',
    '.card-title::after{display:none}',
    '.doc-table{font-size:14px}',
    '.doc-table th{font-size:12px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--text3)}',
    '.doc-table td{padding:13px 14px;border-bottom:1px solid var(--border);line-height:1.55}',
    '.doc-table td:first-child{box-shadow:none;color:var(--text);font-weight:500}',
    '.doc-table tr:hover td{background:rgba(0,0,0,.02)}',
    'a.ext-link{font-size:inherit;color:var(--accent)}',
    '.alert-box{border-radius:14px;font-size:13.5px;border:0;background:var(--warnbg);color:var(--warntx)}',
    '.alert-box strong,.alert-box code{color:var(--warntx)}',
    '.alert-box.info{background:var(--accent-a12);color:var(--text2)}',
    '.alert-box.info strong,.alert-box.info code{color:var(--accent3)}',
    '.code-block{background:var(--codebg);border:1px solid var(--border);color:var(--text);border-radius:12px}',
    '.flow-node,.eis-quad{border-radius:14px}',
    '.proj-card{background:var(--surface);border:0;border-radius:20px}',
    '.proj-card:hover{background:var(--surface2);transform:none;border:0}',
    '.proj-card-url{color:var(--accent)}',
    '.tag,.badge{font-weight:500}',
    '.step-num{background:var(--accent)}',
    '::-webkit-scrollbar-thumb{background:rgba(128,128,150,.45)}',
    ':focus-visible{outline:2px solid var(--accent)}',
    /* Gantt */
    '.gantt-cal-title{font-size:22px;font-weight:600;color:var(--text);letter-spacing:-.02em}',
    '.gantt-cal-select,.gantt-cal-nav{background:var(--surface2);border-radius:10px;color:var(--text)}',
    '.gantt-cal-head>div{font-size:12px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--text3)}',
    '.gantt-cal-cell{height:auto;min-height:112px;border:0;border-radius:12px;padding:10px 10px 12px}',
    '.gantt-cal-cell.gantt-cal-today{box-shadow:0 0 0 2px var(--accent) inset}',
    '.gantt-cal-cell.gantt-cal-off{background:var(--off)}',
    '.gantt-cal-cell.gantt-cal-holiday{background:var(--holiday)}',
    '.gantt-cal-daynum{font-size:14px;font-weight:500}',
    '.gantt-cal-tag{color:var(--text)!important;white-space:normal;font-weight:500;font-size:11.5px;border-radius:6px;padding:3px 7px}',
    '.gantt-legend{font-size:12.5px}',
    '.eis-quad{border-left-width:0}',
    '.eis-quad-action{font-size:16px;font-weight:600}',
    /* tareas propias del Gantt */
    '.gx-add{background:var(--accent);color:#fff;border:0;border-radius:999px;padding:8px 16px;font:500 13px Poppins,sans-serif;cursor:pointer}',
    '.gx-add:hover{background:var(--accent3)}',
    '#gantt-custom{margin-top:22px}',
    '#gantt-custom h4{font-size:14px;font-weight:600;margin:0 0 8px;color:var(--text)}',
    '.gx-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--border);font-size:13.5px}',
    '.gx-row .gx-dot{width:10px;height:10px;border-radius:50%;flex:none}',
    '.gx-row .gx-txt{flex:1;min-width:0}',
    '.gx-row .gx-when{display:block;color:var(--text3);font-size:12px}',
    '.gx-row button{background:transparent;border:0;color:var(--text3);cursor:pointer;font:500 12.5px Poppins,sans-serif;padding:6px 10px;border-radius:8px}',
    '.gx-row button:hover{background:var(--surface2);color:var(--red)}',
    '.gx-empty{font-size:13px;color:var(--text3)}',
    'dialog.gx{border:0;border-radius:22px;padding:28px 30px;width:min(520px,92vw);box-shadow:0 24px 70px rgba(0,0,0,.35);font-family:Poppins,sans-serif;color:var(--text);background:var(--surface2)}',
    'dialog.gx::backdrop{background:rgba(0,0,0,.35)}',
    'dialog.gx h3{font-size:20px;font-weight:600;letter-spacing:-.02em;margin:0 0 18px}',
    '.gx label{display:block;font-size:12.5px;font-weight:500;color:var(--text3);margin:14px 0 6px}',
    '.gx input[type=text],.gx input[type=date],.gx select{width:100%;border:1px solid var(--border);border-radius:10px;padding:9px 12px;font:400 14px Poppins,sans-serif;color:var(--text);background:var(--surface)}',
    '.gx input:focus,.gx select:focus{outline:2px solid var(--accent);outline-offset:0;border-color:transparent}',
    '.gx .gx-line{display:flex;gap:10px}.gx .gx-line>*{flex:1}',
    '.gx .gx-chips{display:flex;flex-wrap:wrap;gap:8px}',
    '.gx .gx-chip{border:1px solid var(--border);background:var(--surface);border-radius:999px;padding:7px 14px;font:500 13px Poppins,sans-serif;color:var(--text2);cursor:pointer}',
    '.gx .gx-chip.on{background:var(--accent);border-color:var(--accent);color:#fff}',
    '.gx .gx-sw{width:26px;height:26px;border-radius:50%;border:2px solid var(--surface2);box-shadow:0 0 0 1px var(--border);cursor:pointer;padding:0}',
    '.gx .gx-sw.on{box-shadow:0 0 0 2px var(--text)}',
    '.gx .gx-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}',
    '.gx .gx-btn{border:0;border-radius:999px;padding:10px 20px;font:500 14px Poppins,sans-serif;cursor:pointer;background:var(--surface);color:var(--text)}',
    '.gx .gx-btn.pri{color:#fff}',
    '.gx .gx-btn.pri{background:var(--accent);color:#fff}',
    '.gx .gx-btn:disabled{opacity:.45;cursor:default}',
    '.gx .gx-err{color:var(--red);font-size:12.5px;margin-top:10px;min-height:16px}',
    '.gx [hidden]{display:none!important}',
    '.gx-warn{font-size:11.5px;color:var(--orange);margin-left:6px}',
    '.gx-link{background:transparent;border:0;color:var(--accent);cursor:pointer;font:500 12.5px Poppins,sans-serif;padding:4px 8px;border-radius:8px}',
    '.gx-link:hover{background:var(--surface2)}',
    '.gx-vrow{display:grid;grid-template-columns:2fr 2fr 1fr 1.3fr;gap:12px}',
    '#sec-vistas label{display:block;font-size:12.5px;font-weight:500;color:var(--text3);margin:4px 0 6px}',
    '#sec-vistas input[type=text],#sec-vistas select,#sec-vistas textarea,.gx-search{width:100%;border:1px solid var(--border);border-radius:10px;padding:9px 12px;font:400 14px Poppins,sans-serif;color:var(--text);background:var(--surface2)}',
    '#sec-vistas textarea{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}',
    '.gx-search{margin-bottom:12px}',
    '.gx-det{margin-top:16px;font-size:13.5px}.gx-det summary{cursor:pointer;color:var(--accent);font-weight:500}',
    '#sec-vistas .gx-actions{display:flex;gap:10px;margin-top:14px}',
    '#sec-vistas .gx-btn{border:0;border-radius:999px;padding:10px 20px;font:500 14px Poppins,sans-serif;cursor:pointer;background:var(--surface2);color:var(--text)}',
    '#sec-vistas .gx-btn.pri{background:var(--accent);color:#fff}',
    '#sec-vistas .gx-btn:disabled{opacity:.45;cursor:default}',
    '#sec-vistas .gx-err{font-size:13px;margin-top:10px;min-height:18px}',
    '@media (max-width:900px){.gx-vrow{grid-template-columns:1fr}}',
    '.gx-theme{position:fixed;top:16px;right:22px;z-index:200;width:38px;height:38px;border-radius:50%;border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:grid;place-items:center;transition:color .15s,background .15s}',
    '.gx-theme:hover{color:var(--text);background:var(--surface2)}',
    '@media (max-width:900px){#main{padding:32px 22px 64px}.page-title{font-size:32px}}',
  ].join('\n');
  var st = document.createElement('style');
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  var EMOJI = /^[\p{Extended_Pictographic}️‍\s]+/u;
  function stripEmoji(el) {
    var n = el.firstChild;
    while (n && n.nodeType !== 3) n = n.nextSibling;
    if (n && EMOJI.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(EMOJI, '');
  }
  function cleanEmojis() {
    Array.prototype.forEach.call(document.querySelectorAll('.card-title,.alert-box,.page-title'), stripEmoji);
  }

  // ───────────────────────────── 2) Gantt: tareas propias ─────────────────────────────
  var COLORS = ['#550fed', '#029687', '#ff5454', '#fb923c', '#38bdf8', '#a3e635'];
  var DOW = [['Lun', 1], ['Mar', 2], ['Mié', 3], ['Jue', 4], ['Vie', 5]];
  var DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var base = location.pathname.replace(/\/manual\/?$/, '');
  var API = base + '/notes/manual/gantt';
  var custom = [];          // [{ id, label, time, color, rule, from, to, by }]
  var baseItems = null;     // GANTT_ITEMS originales (los fijos del manual)
  var canEdit = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function whoShort(e) { return String(e || '').replace(/@.*/, ''); }

  function load() {
    return fetch(API, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (j) {
      canEdit = true;
      custom = [];
      Object.keys(j.notes || {}).forEach(function (k) {
        var n = j.notes[k];
        if (k.indexOf('t_') !== 0 || !n || !n.text) return;   // texto vacío = tarea quitada
        try { var t = JSON.parse(n.text); t.id = k; t.by = n.by; custom.push(t); } catch (e) { /* tarea ilegible: se ignora */ }
      });
    }).catch(function () { canEdit = false; custom = []; });
  }
  function save(field, text) {
    return fetch(API, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'google.script.run' },
      body: JSON.stringify({ field: field, text: text }),
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }

  function whenText(t) {
    var w = typeof window.eisWhen === 'function' ? window.eisWhen(t.rule) : '';
    if (t.time) w += (w ? ' · ' : '') + t.time;
    if (t.from || t.to) w += ' · ' + (t.from ? 'desde ' + t.from : '') + (t.from && t.to ? ' ' : '') + (t.to ? 'hasta ' + t.to : '');
    return w;
  }
  function applyToGantt() {
    if (!window.GANTT_ITEMS) return;
    if (!baseItems) baseItems = window.GANTT_ITEMS.slice();
    window.GANTT_ITEMS.length = 0;
    baseItems.forEach(function (i) { window.GANTT_ITEMS.push(i); });
    custom.forEach(function (t) {
      window.GANTT_ITEMS.push({ label: t.label + (t.time ? ' · ' + t.time : ''), color: t.color, rule: t.rule, from: t.from, to: t.to, custom: true });
    });
    if (typeof window.ganttRefresh === 'function') window.ganttRefresh();
    renderList();
  }
  function renderList() {
    var box = document.getElementById('gantt-custom');
    if (!box) return;
    if (!canEdit) { box.innerHTML = ''; return; }
    box.innerHTML = '<h4>Tareas agregadas por el equipo</h4>' + (custom.length ? custom.map(function (t) {
      return '<div class="gx-row"><span class="gx-dot" style="background:' + esc(t.color) + '"></span><span class="gx-txt">' + esc(t.label) +
        '<span class="gx-when">' + esc(whenText(t)) + (t.by ? ' · ' + esc(whoShort(t.by)) : '') + '</span></span>' +
        '<button type="button" data-del="' + esc(t.id) + '">Quitar</button></div>';
    }).join('') : '<div class="gx-empty">Todavía no hay tareas agregadas. Usá "Agregar tarea" para sumar una al calendario.</div>');
  }

  var dlg = null, form = {};
  function buildDialog() {
    dlg = document.createElement('dialog');
    dlg.className = 'gx';
    dlg.innerHTML =
      '<h3>Nueva tarea en el Gantt</h3>' +
      '<label for="gx-title">Qué hay que hacer</label><input type="text" id="gx-title" maxlength="90" placeholder="Ej. Enviar el status al Chief">' +
      '<div class="gx-line"><div><label for="gx-time">Hora (opcional)</label><input type="text" id="gx-time" maxlength="20" placeholder="Ej. 11 h ARG"></div>' +
      '<div><label for="gx-rep">Cuándo</label><select id="gx-rep"><option value="once">Un solo día</option><option value="weekly">Días de la semana</option><option value="monthly">Una vez al mes</option></select></div></div>' +
      '<div id="gx-once"><label for="gx-date">Día</label><input type="date" id="gx-date"></div>' +
      '<div id="gx-weekly" hidden><label>Todos los…</label><div class="gx-chips" id="gx-days">' +
        DOW.map(function (d) { return '<button type="button" class="gx-chip" data-d="' + d[1] + '">' + d[0] + '</button>'; }).join('') + '</div></div>' +
      '<div id="gx-monthly" hidden><div class="gx-line"><div><label for="gx-mk">Qué día del mes</label><select id="gx-mk"><option value="nth">Un día de la semana (ej. 1er martes)</option><option value="day">Un número de día (ej. el 15)</option><option value="biz">Un día hábil (ej. el 3er)</option></select></div></div>' +
        '<div class="gx-line" id="gx-nth"><div><label for="gx-n">Cuál</label><select id="gx-n"><option value="1">1ro</option><option value="2">2do</option><option value="3">3ro</option><option value="4">4to</option><option value="-1">Último</option></select></div>' +
        '<div><label for="gx-wd">Día</label><select id="gx-wd">' + DOW.map(function (d) { return '<option value="' + d[1] + '">' + DAYS[d[1]] + '</option>'; }).join('') + '</select></div></div>' +
        '<div id="gx-day" hidden><label for="gx-md">Día del mes (1 a 31)</label><input type="text" id="gx-md" maxlength="2" inputmode="numeric" value="1"></div>' +
        '<div id="gx-biz" hidden><label for="gx-bn">Número de día hábil (1 a 20)</label><input type="text" id="gx-bn" maxlength="2" inputmode="numeric" value="1"></div></div>' +
      '<div id="gx-range" hidden><div class="gx-line"><div><label for="gx-from">Desde (opcional)</label><input type="date" id="gx-from"></div><div><label for="gx-to">Hasta (opcional)</label><input type="date" id="gx-to"></div></div></div>' +
      '<label>Color</label><div class="gx-chips" id="gx-colors">' + COLORS.map(function (c, i) { return '<button type="button" class="gx-sw' + (i === 0 ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="Color ' + (i + 1) + '"></button>'; }).join('') + '</div>' +
      '<div class="gx-err" id="gx-err" role="alert"></div>' +
      '<div class="gx-actions"><button type="button" class="gx-btn" id="gx-cancel">Cancelar</button><button type="button" class="gx-btn pri" id="gx-save">Guardar</button></div>';
    document.body.appendChild(dlg);
    ['title', 'time', 'rep', 'date', 'days', 'mk', 'n', 'wd', 'md', 'bn', 'from', 'to', 'colors', 'err', 'save', 'cancel', 'once', 'weekly', 'monthly', 'nth', 'day', 'biz', 'range']
      .forEach(function (k) { form[k] = dlg.querySelector('#gx-' + k); });
    function sync() {
      var r = form.rep.value, mk = form.mk.value;
      form.once.hidden = r !== 'once'; form.weekly.hidden = r !== 'weekly'; form.monthly.hidden = r !== 'monthly'; form.range.hidden = r === 'once';
      form.nth.hidden = mk !== 'nth'; form.day.hidden = mk !== 'day'; form.biz.hidden = mk !== 'biz';
    }
    form.rep.onchange = sync; form.mk.onchange = sync; sync();
    form.days.onclick = function (e) { var b = e.target.closest('.gx-chip'); if (b) b.classList.toggle('on'); };
    form.colors.onclick = function (e) {
      var b = e.target.closest('.gx-sw'); if (!b) return;
      Array.prototype.forEach.call(form.colors.children, function (x) { x.classList.toggle('on', x === b); });
    };
    form.cancel.onclick = function () { dlg.close(); };
    form.save.onclick = submit;
  }
  function openDialog() {
    if (!dlg) buildDialog();
    form.title.value = ''; form.time.value = ''; form.err.textContent = '';
    form.date.value = new Date().toISOString().slice(0, 10);
    Array.prototype.forEach.call(form.days.children, function (b) { b.classList.remove('on'); });
    dlg.showModal();
    form.title.focus();
  }
  function intIn(v, lo, hi) { var n = parseInt(String(v).trim(), 10); return n >= lo && n <= hi ? n : null; }
  function buildRule() {
    var r = form.rep.value;
    if (r === 'once') {
      var p = String(form.date.value).split('-');
      if (p.length !== 3) return { err: 'Elegí el día.' };
      return { rule: { type: 'date', y: +p[0], m: +p[1] - 1, d: +p[2] } };
    }
    if (r === 'weekly') {
      var days = Array.prototype.filter.call(form.days.children, function (b) { return b.classList.contains('on'); }).map(function (b) { return +b.dataset.d; });
      if (!days.length) return { err: 'Marcá al menos un día de la semana.' };
      return { rule: days.length === 1 ? { type: 'weekday', weekday: days[0] } : { type: 'weekdays', days: days } };
    }
    var mk = form.mk.value;
    if (mk === 'nth') return { rule: { type: 'nth-weekday', n: +form.n.value, weekday: +form.wd.value } };
    if (mk === 'day') { var d = intIn(form.md.value, 1, 31); return d ? { rule: { type: 'monthday', d: d } } : { err: 'El día del mes va de 1 a 31.' }; }
    var b = intIn(form.bn.value, 1, 20);
    return b ? { rule: { type: 'nth-bizday', n: b } } : { err: 'El día hábil va de 1 a 20.' };
  }
  function submit() {
    var title = form.title.value.trim();
    if (!title) { form.err.textContent = 'Escribí qué hay que hacer.'; return; }
    var rr = buildRule();
    if (rr.err) { form.err.textContent = rr.err; return; }
    var color = (form.colors.querySelector('.gx-sw.on') || {}).dataset && form.colors.querySelector('.gx-sw.on').dataset.c || COLORS[0];
    var t = { label: title, time: form.time.value.trim(), color: color, rule: rr.rule };
    if (form.rep.value !== 'once') { if (form.from.value) t.from = form.from.value; if (form.to.value) t.to = form.to.value; }
    var id = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    form.save.disabled = true; form.err.textContent = '';
    save(id, JSON.stringify(t)).then(function (j) {
      t.id = id; t.by = j.note && j.note.by;
      custom.push(t);
      dlg.close();
      applyToGantt();
    }).catch(function (e) { form.err.textContent = 'No se pudo guardar: ' + (e.message || e); })
      .then(function () { form.save.disabled = false; });
  }

  function mountGantt() {
    var tb = document.querySelector('.gantt-cal-toolbar');
    var legend = document.getElementById('gantt-legend');
    if (!tb || !legend || document.getElementById('gx-add')) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'gx-add'; btn.className = 'gx-add'; btn.textContent = '＋ Agregar tarea';
    btn.title = 'Suma una tarea al calendario para todo el equipo';
    btn.onclick = openDialog;
    var box = document.createElement('div');
    box.id = 'gantt-custom';
    legend.parentNode.insertBefore(box, legend.nextSibling);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-del]');
      if (!b) return;
      var id = b.getAttribute('data-del'), t = custom.filter(function (x) { return x.id === id; })[0];
      if (!t || !confirm('¿Quitar "' + t.label + '" del Gantt? Se saca para todo el equipo.')) return;
      b.disabled = true;
      save(id, '').then(function () { custom = custom.filter(function (x) { return x.id !== id; }); applyToGantt(); })
        .catch(function (e2) { b.disabled = false; alert('No se pudo quitar: ' + (e2.message || e2)); });
    });
    tb.firstElementChild.parentNode.insertBefore(btn, tb.children[1]);
    tb.style.gap = '14px';
    load().then(function () { btn.style.display = canEdit ? '' : 'none'; applyToGantt(); });
  }

  // ───────────────────────────── 3) Vista por usuario ─────────────────────────────
  // Tabla "mail → países y canal" con la que abre cada persona (filtro inicial; siempre se puede ver todo). Se guarda en /notes/manual/vistas
  // (un campo por mail: u_<mail>); escribe solo la lista `noteEditors.vistas` de server/modules.js y el servidor lo exige.
  var VAPI = base + '/notes/manual/vistas';
  var COUNTRIES = { AR: 'Argentina', BR: 'Brasil', MX: 'México', CL: 'Chile', CO: 'Colombia', PE: 'Perú', UY: 'Uruguay', EC: 'Ecuador', US: 'Estados Unidos',
    ES: 'España', PA: 'Panamá', CR: 'Costa Rica', DO: 'República Dominicana', BO: 'Bolivia', PY: 'Paraguay', VE: 'Venezuela', GLOBALES: 'Globales (Other Countries)' };
  var ALIAS = { globales: 'GLOBALES', other: 'GLOBALES', others: 'GLOBALES', ot: 'GLOBALES', 'other countries': 'GLOBALES', otros: 'GLOBALES',
    todos: 'TODOS', todo: 'TODOS', todas: 'TODOS', all: 'TODOS', '*': 'TODOS' };   // TODOS = sin filtro de país
  var vistas = [], vEdit = false, vForm = {};

  function plain(s) { return String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function parseCountry(tok) {
    var p = plain(tok), code = null;
    if (!p) return null;
    if (ALIAS[p]) return { code: ALIAS[p], ok: true };
    Object.keys(COUNTRIES).forEach(function (k) { if (plain(k) === p || plain(COUNTRIES[k]) === p) code = k; });
    return code ? { code: code, ok: true } : { code: String(tok).trim().toUpperCase(), ok: false };
  }
  function parseCountries(text) {
    var seen = {}, out = [];
    String(text || '').split(/[,;/]+/).forEach(function (t) { var c = parseCountry(t); if (c && !seen[c.code]) { seen[c.code] = 1; out.push(c); } });
    return out.some(function (c) { return c.code === 'TODOS'; }) ? [{ code: 'TODOS', ok: true }] : out;   // "todos" + otros = todos
  }
  // LOB: B2B o B2B2C; vacío / "todos" / "ambos" = los dos. Algo que no reconozco se guarda tal cual y se marca para revisar.
  function parseLob(t) {
    var p = plain(t).replace(/[\s+_-]/g, '');
    if (!p || p === 'todos' || p === 'todo' || p === 'ambos' || p === 'both' || p === 'all' || p === 'b2b+b2b2c' || p === 'b2bb2b2c') return { code: '', ok: true };
    if (p === 'b2b') return { code: 'B2B', ok: true };
    if (p === 'b2b2c' || p === 'wl' || p === 'wls' || p === 'whitelabel' || p === 'whitelabels') return { code: 'B2B2C', ok: true };
    return { code: String(t).trim().toUpperCase(), ok: false };
  }
  function vField(email) { return 'u_' + email.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 56); }
  function vSave(field, text) {
    return fetch(VAPI, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'google.script.run' },
      body: JSON.stringify({ field: field, text: text }) }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  function vLoad() {
    return fetch(VAPI, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
      vEdit = !!j.canEdit; vistas = [];
      Object.keys(j.notes || {}).forEach(function (k) {
        var n = j.notes[k];
        if (k.indexOf('u_') !== 0 || !n || !n.text) return;
        try { var v = JSON.parse(n.text); v.field = k; v.by = n.by; vistas.push(v); } catch (e) { /* fila ilegible */ }
      });
      vistas.sort(function (a, b) { return a.email < b.email ? -1 : 1; });
    });
  }
  function vRender() {
    var box = document.getElementById('vistas-table');
    if (!box) return;
    var q = plain((vForm.q && vForm.q.value) || '');
    var rows = vistas.filter(function (v) { return !q || plain(v.email + ' ' + (v.paises || []).join(' ') + ' ' + (v.canal || '')).indexOf(q) >= 0; });
    document.getElementById('vistas-count').textContent = vistas.length + (vistas.length === 1 ? ' persona' : ' personas');
    if (!rows.length) { box.innerHTML = '<div class="gx-empty">' + (vistas.length ? 'Ninguna fila coincide con la búsqueda.' : 'Todavía no hay filtros cargados.') + '</div>'; return; }
    box.innerHTML = '<table class="doc-table"><thead><tr><th>Mail</th><th>Países</th><th>Canal</th><th>LOB</th><th>Última carga</th>' + (vEdit ? '<th></th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (v) {
        var bad = (v.paises || []).filter(function (c) { return !COUNTRIES[c] && c !== 'TODOS'; });
        return '<tr><td>' + esc(v.email) + '</td><td>' + (v.paises || []).map(function (c) { return c === 'TODOS' ? 'Todos' : esc(c); }).join(', ') +
          (bad.length ? ' <span class="gx-warn" title="No reconozco: ' + esc(bad.join(', ')) + '. Revisá cómo se escribe.">⚠ revisar</span>' : '') +
          '</td><td>' + esc(v.canal || '—') + '</td><td>' + (v.lob ? esc(v.lob) + (parseLob(v.lob).ok ? '' : ' <span class="gx-warn" title="LOB no reconocido: usá B2B, B2B2C o dejalo vacío">⚠ revisar</span>') : 'Ambos') + '</td><td>' + esc(whoShort(v.by)) + '</td>' +
          (vEdit ? '<td style="white-space:nowrap"><button type="button" class="gx-link" data-ed="' + esc(v.field) + '">Editar</button><button type="button" class="gx-link" data-rm="' + esc(v.field) + '">Quitar</button></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
  }
  function vMsg(t, bad) { var m = document.getElementById('vistas-msg'); if (m) { m.textContent = t || ''; m.style.color = bad ? 'var(--red)' : 'var(--text3)'; } }
  function vUpsert(email, paisesTxt, canal, lobTxt) {
    email = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return Promise.reject(new Error('Mail inválido: ' + email));
    var cs = parseCountries(paisesTxt);
    if (!cs.length) return Promise.reject(new Error('Falta al menos un país para ' + email));
    var v = { email: email, paises: cs.map(function (c) { return c.code; }), canal: String(canal || '').trim(), lob: parseLob(lobTxt).code };
    return vSave(vField(email), JSON.stringify(v));
  }
  function mountVistas() {
    var nav = document.querySelector('.nav-item[onclick*="dia-a-dia"]'), main = document.getElementById('main');
    if (!nav || !main || document.getElementById('sec-vistas')) return;
    var a = document.createElement('a');
    a.className = 'nav-item'; a.setAttribute('onclick', "showSection('vistas')"); a.setAttribute('tabindex', '0'); a.setAttribute('role', 'link');
    a.innerHTML = '<span class="nav-icon">🎛️</span> Vista por usuario';
    a.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); a.click(); } });
    nav.parentNode.insertBefore(a, nav.nextSibling);
    var sec = document.createElement('div');
    sec.className = 'section'; sec.id = 'sec-vistas';
    sec.innerHTML =
      '<div class="page-header"><div class="page-tag">Guía del equipo</div><div class="page-title">Vista <span>por usuario</span></div>' +
      '<div class="page-sub">Con qué país (y, si hace falta, canal) abre cada persona los tableros. Es una comodidad: siempre se puede cambiar el filtro y ver todo; no restringe el acceso a nada.</div></div>' +
      '<div class="alert-box info">Hoy esta tabla solo se carga y se guarda. Los tableros todavía no la leen: se van a conectar de a uno, empezando por el Daily.</div>' +
      '<div class="card" id="vistas-form-card" style="display:none"><div class="card-title">Agregar o cambiar una persona</div>' +
        '<div class="gx-vrow"><div><label for="v-email">Mail</label><input type="text" id="v-email" placeholder="nombre.apellido@despegar.com"></div>' +
        '<div><label for="v-paises">Países (separados por coma)</label><input type="text" id="v-paises" placeholder="MX, AR, UY, CL o todos"></div>' +
        '<div><label for="v-canal">Canal (opcional)</label><input type="text" id="v-canal" placeholder="Ej. API"></div>' +
        '<div><label for="v-lob">LOB (opcional)</label><select id="v-lob"><option value="">Ambos (B2B y B2B2C)</option><option value="B2B">B2B</option><option value="B2B2C">B2B2C</option></select></div></div>' +
        '<div class="gx-actions" style="justify-content:flex-start"><button type="button" class="gx-btn pri" id="v-save">Guardar</button></div>' +
        '<details class="gx-det"><summary>Cargar varias personas de una vez (pegar desde Excel)</summary>' +
        '<div class="page-sub" style="font-size:13px;margin:8px 0">Una persona por línea, con columnas separadas por tab (o punto y coma): <code>mail</code>, <code>países</code> (con comas), <code>canal</code> (opcional) y <code>LOB</code> (B2B, B2B2C o vacío = ambos).</div>' +
        '<textarea id="v-bulk" rows="6" placeholder="ana.perez@despegar.com&#9;MX&#9;&#9;B2B&#10;luis.gomez@despegar.com&#9;AR, UY&#9;API&#9;B2B2C"></textarea>' +
        '<div class="gx-actions" style="justify-content:flex-start"><button type="button" class="gx-btn" id="v-bulk-go">Cargar</button></div></details>' +
        '<div class="gx-err" id="vistas-msg" role="status"></div></div>' +
      '<div class="card"><div class="card-title">Filtros cargados <span id="vistas-count" style="margin-left:auto;font-size:13px;font-weight:400;color:var(--text3)"></span></div>' +
        '<input type="text" id="v-q" class="gx-search" placeholder="Buscar por mail, país o canal">' +
        '<div id="vistas-table"></div><div class="gx-empty" id="vistas-ro" style="margin-top:12px;display:none">Solo diego.bracco@despegar.com puede editar esta tabla.</div></div>' +
        '<div class="card"><div class="card-title">Países que reconozco</div><div class="page-sub" style="font-size:13.5px">' +
        Object.keys(COUNTRIES).map(function (k) { return '<b>' + k + '</b> ' + COUNTRIES[k]; }).join(' · ') + '. También entiendo el nombre completo y "Other / Otros" como Globales. Para darle todos los países escribí <b>todos</b> (abre sin filtro de país).</div></div>';
    main.appendChild(sec);
    vForm.email = document.getElementById('v-email'); vForm.paises = document.getElementById('v-paises'); vForm.canal = document.getElementById('v-canal'); vForm.lob = document.getElementById('v-lob');
    vForm.save = document.getElementById('v-save'); vForm.bulk = document.getElementById('v-bulk'); vForm.bulkGo = document.getElementById('v-bulk-go'); vForm.q = document.getElementById('v-q');
    vForm.q.addEventListener('input', vRender);
    vForm.save.onclick = function () {
      vForm.save.disabled = true; vMsg('');
      vUpsert(vForm.email.value, vForm.paises.value, vForm.canal.value, vForm.lob.value).then(function () {
        vForm.email.value = ''; vForm.paises.value = ''; vForm.canal.value = ''; vForm.lob.value = ''; vMsg('Guardado.');
        return vLoad().then(vRender);
      }).catch(function (e) { vMsg(e.message || String(e), true); }).then(function () { vForm.save.disabled = false; });
    };
    vForm.bulkGo.onclick = function () {
      var lines = vForm.bulk.value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) { vMsg('Pegá al menos una línea.', true); return; }
      vForm.bulkGo.disabled = true; vMsg('Cargando…');
      var ok = 0, errs = [], chain = Promise.resolve();
      lines.forEach(function (l, i) {
        chain = chain.then(function () {
          var c = l.split(/\t|;/);
          return vUpsert(c[0], c[1], c[2], c[3]).then(function () { ok++; }).catch(function (e) { errs.push('Línea ' + (i + 1) + ': ' + (e.message || e)); });
        });
      });
      chain.then(function () { return vLoad().then(vRender); }).then(function () {
        if (!errs.length) vForm.bulk.value = '';
        vMsg('Cargadas ' + ok + ' de ' + lines.length + '.' + (errs.length ? ' ' + errs.join(' · ') : ''), errs.length > 0);
      }).catch(function (e) { vMsg(e.message || String(e), true); }).then(function () { vForm.bulkGo.disabled = false; });
    };
    document.getElementById('vistas-table').addEventListener('click', function (e) {
      var ed = e.target.closest('[data-ed]'), rm = e.target.closest('[data-rm]');
      var f = ed ? ed.getAttribute('data-ed') : rm ? rm.getAttribute('data-rm') : null;
      var v = vistas.filter(function (x) { return x.field === f; })[0];
      if (!v) return;
      if (ed) { vForm.email.value = v.email; vForm.paises.value = (v.paises || []).join(', '); vForm.canal.value = v.canal || ''; vForm.lob.value = parseLob(v.lob).ok ? parseLob(v.lob).code : ''; vForm.email.focus(); window.scrollTo(0, 0); return; }
      if (!confirm('¿Quitar el filtro de ' + v.email + '? Vuelve a abrir sin filtro.')) return;
      vSave(f, '').then(function () { return vLoad().then(vRender); }).catch(function (e2) { alert('No se pudo quitar: ' + (e2.message || e2)); });
    });
    vLoad().then(function () {
      document.getElementById('vistas-form-card').style.display = vEdit ? '' : 'none';
      document.getElementById('vistas-ro').style.display = vEdit ? 'none' : '';
      vRender();
    }).catch(function () { document.getElementById('vistas-table').innerHTML = '<div class="gx-empty">No se pudo leer la tabla.</div>'; });
  }

  function mountThemeButton() {
    var root = document.documentElement, b = document.createElement('button');
    b.type = 'button'; b.className = 'gx-theme'; b.setAttribute('aria-label', 'Cambiar tema claro u oscuro'); b.title = 'Cambiar tema';
    var MOON = '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    var SUN = '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
    function paint() { b.innerHTML = root.getAttribute('data-theme') === 'light' ? SUN : MOON; }
    b.onclick = function () {
      var light = root.getAttribute('data-theme') !== 'light';
      if (light) root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
      try { localStorage.setItem('b2b-api-theme', light ? 'light' : 'dark'); } catch (e) { /* sin storage */ }
      paint();
    };
    paint();
    document.body.appendChild(b);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.head.appendChild(st);   // al final del <head>: tiene que ir después de los estilos del manual para pisarlos
    cleanEmojis();
    mountThemeButton();
    mountGantt();
    mountVistas();
    var v = (/[?&]view=([\w-]+)/.exec(location.search) || [])[1];
    if (v && typeof window.showSection === 'function' && document.getElementById('sec-' + v)) window.showSection(v);
  });
})();
