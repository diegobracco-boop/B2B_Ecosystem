/* Daily Dashboard en Ownia — botón "+ Filtros" (2026-11-05, Diego). Lo inyecta server/index.js en el Daily (`layout` en
 * server/modules.js). El HTML de Apps Script no se toca.
 *
 * Organic y COI Brasil pasan a un desplegable "+ Filtros" de la barra de arriba: casi nadie los cambia y los defaults son los que
 * hay que mirar (Organic YES, COI Brasil Excluir, los mismos que ya traía el Daily). Así la barra queda más limpia.
 *   - Organic: se mueve el mismo bloque del Daily (#org-wrap, con su nota de TC y la "i"), no una copia.
 *   - COI Brasil: un switch nuevo con data-coibr, que setExCoiBr ya sincroniza; se ocultan los otros del Daily (barra de
 *     B2B2C arriba, barra de filtros de B2B y la sección "Weekly · vs B2C" del Benchmark).
 *   - Si alguno no está en su default, el botón lo marca con un punto y lo dice en el tooltip.
 * Además ordena la barra: el switch B2B2C / B2B al lado de "Daily", Benchmark vs B2C / B2B Tracker / Industry events a la derecha,
 * y Partner TBD pasa a ser un filtro más de B2B2C (al lado de "Todos los partners").
 * No corre en Presentaciones (?flowdeck=1) ni en los modos embebidos: el Flow tiene sus propios selectores de Organic y COI.
 */
(function () {
  'use strict';
  if (/[?&](flowdeck=1|embed=|weeklyembed=)/.test(location.search)) return;
  var W = window;

  var css = document.createElement('style');
  css.textContent = [
    '#ow-flt{position:relative;margin-left:10px;flex-shrink:0}',
    '#ow-flt-btn{display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid var(--border);color:var(--text-2);',
    '  font:700 11px var(--font);padding:4px 12px;border-radius:20px;cursor:pointer;white-space:nowrap}',
    '#ow-flt-btn:hover,#ow-flt.open #ow-flt-btn{color:var(--text);border-color:rgba(86,38,233,.4)}',
    '#ow-flt-dot{display:none;width:7px;height:7px;border-radius:50%;background:var(--warning,#f5b13d)}',
    '#ow-flt.mod #ow-flt-dot{display:inline-block}',
    '#ow-flt-pop{display:none;position:fixed;z-index:400;min-width:290px;max-width:min(380px,calc(100vw - 24px));padding:12px 14px;border-radius:10px;',
    '  background:var(--elevated,var(--surface));border:1px solid var(--border);box-shadow:0 10px 28px rgba(0,0,0,.28)}',
    '#ow-flt.open #ow-flt-pop{display:block}',
    '#ow-flt-pop .ow-flt-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0}',
    '#ow-flt-pop .ow-flt-row + .ow-flt-row{border-top:1px solid var(--border)}',
    '#ow-flt-pop .ow-flt-help{font:400 10.5px/1.35 var(--font);color:var(--text-3);margin-top:2px}',
    '#ow-flt-pop .org-wrap{margin-left:0;flex-wrap:wrap}',
    '#ow-flt-pop .org-note{max-width:none;white-space:normal}',
    // los otros COI Brasil del Daily (quedan en el DOM: setExCoiBr los sigue sincronizando)
    '.ow-flt-hidden{display:none!important}',
    // Barra: [Daily][B2B2C | B2B] [+ Filtros] … a la derecha [Benchmark vs B2C][B2B Tracker][Industry events] [tema]
    '#ow-nav-right{display:flex;align-items:center;gap:4px;margin-left:auto;flex-shrink:0}',
    '#ow-nav-right ~ .theme-btn{margin-left:8px}',
    '.topbar .view-nav #daily-lob-toggle{margin-left:4px!important}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  function el(id) { return document.getElementById(id); }

  function build() {
    var org = el('org-wrap'), theme = el('theme-btn');
    if (!org || el('ow-flt')) return;
    var box = document.createElement('div');
    box.id = 'ow-flt';
    box.innerHTML =
      '<button type="button" id="ow-flt-btn" aria-haspopup="true" aria-expanded="false">+ Filtros<span id="ow-flt-dot"></span></button>' +
      '<div id="ow-flt-pop" role="dialog" aria-label="Filtros">' +
        '<div class="ow-flt-row" id="ow-flt-org"></div>' +
        '<div class="ow-flt-row" title="COI Brasil: Excluir saca el cost of installments y el efecto financiero de Brasil del FVM en toda la página (métricas, tablas, KRs, Benchmark, Weekly y Flow).">' +
          '<div><div class="org-lbl">COI Brasil</div><div class="ow-flt-help">Excluir saca el COI y el efecto financiero de Brasil del FVM</div></div>' +
          '<div class="dm-toggle">' +
            '<button class="dm-btn" data-coibr="incl" onclick="setExCoiBr(false)">Incluir</button>' +
            '<button class="dm-btn" data-coibr="excl" onclick="setExCoiBr(true)">Excluir</button>' +
          '</div></div>' +
        '<div class="ow-flt-help" style="margin-top:6px">Por default: Organic YES y COI Brasil Excluir.</div>' +
      '</div>';
    // va donde estaba el Organic (después del switch B2B2C / B2B)
    org.parentNode.insertBefore(box, org);
    el('ow-flt-org').appendChild(org);
    syncCoi();

    var btn = el('ow-flt-btn'), pop = el('ow-flt-pop');
    function place() {
      var r = btn.getBoundingClientRect(), w = pop.offsetWidth || 300;
      pop.style.top = Math.round(r.bottom + 6) + 'px';
      pop.style.left = Math.round(Math.max(12, Math.min(r.left, W.innerWidth - w - 12))) + 'px';
    }
    function setOpen(on) {
      box.classList.toggle('open', on);
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) place();
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!box.classList.contains('open')); });
    pop.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    W.addEventListener('resize', function () { if (box.classList.contains('open')) place(); });
    W.addEventListener('scroll', function () { if (box.classList.contains('open')) place(); }, true);
  }

  // Oculta los otros switches de COI Brasil del Daily (no los del desplegable ni los del Flow, que es su propia barra)
  function hideOtherCoi() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-coibr]'), function (b) {
      if (b.closest('#ow-flt') || b.closest('#view-flow')) return;
      var g = b.closest('.dm-group');
      if (g) g.classList.add('ow-flt-hidden');
    });
  }

  function syncCoi() {
    Array.prototype.forEach.call(document.querySelectorAll('#ow-flt [data-coibr]'), function (b) {
      b.classList.toggle('active', (b.getAttribute('data-coibr') === 'excl') === !!W._exCoiBr);
    });
  }

  // Punto en el botón cuando algo no está en el default
  function mark() {
    var box = el('ow-flt');
    if (!box) return;
    var notes = [];
    if (!W._dlOrganic) notes.push('Organic en NO');
    if (!W._exCoiBr) notes.push('COI Brasil en Incluir');
    box.classList.toggle('mod', notes.length > 0);
    el('ow-flt-btn').title = notes.length ? 'Fuera del default: ' + notes.join(' · ') : 'Organic YES · COI Brasil Excluir (default)';
  }

  // Barra de arriba (2026-11-05, Diego): el switch B2B2C / B2B pegado a "Daily" y el resto de las solapas a la derecha.
  // Los botones son los mismos (switchMainView los sigue prendiendo por id); solo cambian de lugar.
  function arrangeNav() {
    var nav = document.querySelector('.topbar .view-nav'), daily = el('vnav-daily'), lob = el('daily-lob-toggle'), theme = el('theme-btn');
    if (!nav || !daily || el('ow-nav-right')) return;
    if (lob) daily.insertAdjacentElement('afterend', lob);
    if (!theme) return;
    var right = document.createElement('div');
    right.id = 'ow-nav-right';
    right.className = 'view-nav';
    Array.prototype.slice.call(nav.querySelectorAll('.vnav-btn')).forEach(function (b) { if (b !== daily) right.appendChild(b); });
    theme.parentNode.insertBefore(right, theme);
  }

  // Partner TBD: de switch en la barra de arriba a un filtro más de B2B2C, al lado de "Todos los partners"
  function tbdFilter() {
    var bi = el('btn-tbd-incl'), part = el('sel-partner');
    var chip = part && part.closest('.fchip');
    if (!bi || !chip || el('ow-sel-tbd')) return;
    var grp = bi.closest('.dm-group');
    if (grp) grp.classList.add('ow-flt-hidden');
    var box = document.createElement('div');
    box.className = 'fchip';
    box.title = 'Partner TBD = New partners / Hunting. Excluir lo saca de KRs, métricas, tablas, Benchmark y slides B2B2C del Flow.';
    box.innerHTML = '<svg class="fchip-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg>' +
      '<select id="ow-sel-tbd"><option value="incl">Partner TBD: Incluir</option><option value="excl">Partner TBD: Excluir</option></select>';
    chip.insertAdjacentElement('afterend', box);
    var sel = el('ow-sel-tbd');
    sel.value = W._b2bcExclTBD ? 'excl' : 'incl';
    sel.addEventListener('change', function () { if (typeof W.setExclTBD === 'function') W.setExclTBD(sel.value === 'excl'); });
  }
  function syncTbd() { var s = el('ow-sel-tbd'); if (s) s.value = W._b2bcExclTBD ? 'excl' : 'incl'; }

  function wrap(fn, after) {
    var o = W[fn];
    if (typeof o !== 'function') return;
    W[fn] = function () { var r = o.apply(this, arguments); try { after(); } catch (e) { /* la capa nunca rompe el Daily */ } return r; };
  }

  document.addEventListener('DOMContentLoaded', function () {
    try {
      build();
      arrangeNav();
      tbdFilter();
      wrap('setExclTBD', syncTbd);
      hideOtherCoi();
      mark();
      wrap('setExCoiBr', function () { syncCoi(); hideOtherCoi(); mark(); });
      wrap('setDailyOrganic', mark);
      wrap('_syncOrganicUI_', mark);   // el Organic puede volver a NO solo (si falla la tabla de TC)
      // La sección "Weekly · vs B2C" del Benchmark arma su propio COI Brasil cada vez que se dibuja
      wrap('renderBenchmark_', hideOtherCoi);
    } catch (e) { console.warn('[daily-filtros]', e); }
  });
})();
