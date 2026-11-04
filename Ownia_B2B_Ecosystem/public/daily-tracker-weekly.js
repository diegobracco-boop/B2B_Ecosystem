/* Daily B2B Tracker en Ownia: flow "Weekly B2B-MAY" (2026-11-04). Lo inyecta server/index.js en el Daily (`layout` en server/modules.js). El HTML de
 * Apps Script no se toca.
 *
 * Arma las 14 slides del deck "Commercial B2B-MAY Performance", todas con Organic YES y canal API, y las deja como PDF o las manda a una Google Slides fija:
 *   1 portada · 2 Status KRs H2 (API) · 3 KR Global B2B API · 4 Hoteles pedidos por origen y destino · 5 separador
 *   6-9 MTD por país y grupo de agencias (Globales, Brasil, México, Argentina) · 10 separador
 *   11 FVM API semanas (GD y RI) · 12 Hoteles semana a semana (vs últimas 4 semanas) · 13 Tablas GD (API) · 14 Tablas RI (API)
 * De dónde sale cada una:
 *   - 2, 3, 13, 14: del propio Tracker (la misma captura del modo Slides, con el canal fijado por slide).
 *   - 4, 6-9, 12: del Dashboard B2B API (/b2b-dashboard/b2b-api), en un iframe oculto del mismo origen, en tema claro.
 *   - 11: del Daily (vista B2B, canal API, semanal), en un iframe oculto con ?weeklyembed=fvm&date=gd|ri (este mismo archivo maneja ese modo).
 * Todas las slides salen como imagen 1920×1080 (la portada y los separadores se dibujan acá con los recursos de /_gas/weekly/).
 * Una slide que no se puede capturar sale como placeholder y no aborta el resto.
 */
(function () {
  'use strict';
  var BASE = window.__wkBase || (document.currentScript && document.currentScript.src || '').replace(/\/_gas\/layout\/.*$/, '');   // __wkBase: solo para probar en local
  var DASH = '/b2b-dashboard/b2b-api/';
  var W = 1920, H = 1080;                          // slide 16:9 (el pptx es de 960×540 px: acá todo va x2)

  // ── Modo embebido en el Daily: solo el gráfico de FVM semanal de la vista B2B (canal API) ─────────────────────────────
  var emb = /[?&]weeklyembed=fvm\b/.test(location.search);
  if (emb) { runDailyEmbed(); return; }

  function runDailyEmbed() {
    var dm = /[?&]date=(gd|ri)\b/.exec(location.search), date = dm ? dm[1] : 'gd';
    function post(msg) { try { window.parent.postMessage(Object.assign({ type: 'weekly-embed' }, msg), location.origin); } catch (e) { /* sin padre */ } }
    var step = 0, tries = 0;
    function tick() {
      tries++;
      try {
        if (window.Chart && window.Chart.defaults) window.Chart.defaults.animation = false;
        document.documentElement.setAttribute('data-theme', 'light');   // tema claro como el pptx; no se guarda en localStorage (no toca la preferencia de nadie)
        if (tries > 400) return post({ ready: false, error: 'el Daily no terminó de cargar' });
        if (typeof window.switchLob !== 'function' || typeof window.switchDateModel !== 'function') return setTimeout(tick, 500);
        if (step === 0) { window.switchLob('b2b'); step = 1; return setTimeout(tick, 800); }
        if (step === 1) {
          if (!window._rawB2B || !window.state_b2b || !window.state_b2b.viewDate) return setTimeout(tick, 500);
          var ch = document.getElementById('b2b-sel-channel'), gr = document.getElementById('b2b-sel-gran');
          if (!ch || !gr) return setTimeout(tick, 500);
          ch.value = 'API'; window.reloadAllB2B();
          gr.value = 'weekly'; window.reloadB2BMetrics();
          window.switchDateModel(date);
          step = 2; return setTimeout(tick, 1500);
        }
        var cv = document.getElementById('b2b-mc-chart-fvm'), chart = cv && window.Chart && window.Chart.getChart(cv);
        var lb = chart && chart.data.labels && chart.data.labels[0];
        if (!chart || !chart.data.datasets.length || !/^W\d+/.test(String(Array.isArray(lb) ? lb[0] : lb))) return setTimeout(tick, 500);
        try { window._themeCache = null; window.renderB2BMetrics(window.state_b2b.allMetrics); } catch (e) { /* queda como está */ }   // vuelve a dibujar con el tema claro
        setTimeout(function () { post({ ready: true, date: date }); }, 1500);
      } catch (e) { post({ ready: false, error: String(e && e.message || e) }); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 1500); }); else setTimeout(tick, 1500);
  }

  // ── Tracker ──────────────────────────────────────────────────────────────────────────────────────────────────────
  var MES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function until(cond, ms, what) {
    var t0 = Date.now();
    return new Promise(function (res, rej) {
      (function chk() {
        var v; try { v = cond(); } catch (e) { v = null; }
        if (v) return res(v);
        if (Date.now() - t0 > ms) return rej(new Error('tiempo agotado esperando ' + what));
        setTimeout(chk, 300);
      })();
    });
  }
  function errText(e) { return e && e.message ? e.message : String(e); }

  // Fecha de los datos del Tracker ("Actuals al 2026-11-02 • Generado: …")
  function dataDate() {
    var m = /(\d{4})-(\d{2})-(\d{2})/.exec((document.getElementById('metaInfo') || {}).textContent || '');
    return m ? { y: m[1], m: +m[2], d: m[3], dmy: m[3] + '.' + m[2] + '.' + m[1] } : { y: '', m: new Date().getMonth() + 1, d: '', dmy: '' };
  }

  // Fuentes del deck (Rubik de los títulos y Montserrat de la portada, como en el pptx)
  function loadFonts() {
    if (!document.getElementById('wk-fonts')) {
      var l = document.createElement('link');
      l.id = 'wk-fonts'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,400;0,700;1,400;1,700&family=Montserrat:wght@700&display=swap';
      document.head.appendChild(l);
    }
    return Promise.all(['700 48px Rubik', 'italic 400 48px Rubik', '700 76px Montserrat'].map(function (f) { return document.fonts.load(f).catch(function () {}); }));
  }
  var imgCache = {};
  function loadImg(src) {
    if (!imgCache[src]) imgCache[src] = new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('no se pudo cargar ' + src)); }; i.src = src; });
    return imgCache[src];
  }
  function asset(name) { return BASE + '/_gas/weekly/' + name; }

  // ── Dibujo de las slides ──
  function newCanvas() { var c = document.createElement('canvas'); c.width = W; c.height = H; return c; }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function fit(ctx, img, x, y, w, h, top) {
    var r = Math.min(w / img.width, h / img.height), dw = img.width * r, dh = img.height * r;
    ctx.drawImage(img, x + (w - dw) / 2, top ? y : y + (h - dh) / 2, dw, dh);
  }
  function jpeg(c) { return c.toDataURL('image/jpeg', 0.9); }
  function pill(ctx, x, y, w, h, text, color, border) {
    ctx.save(); rr(ctx, x, y, w, h, 8); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = border; ctx.stroke();
    ctx.fillStyle = color; ctx.font = '700 17px Rubik, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + w / 2, y + h / 2 + 1); ctx.restore();
  }
  function infoPill(ctx, dd, y) { if (dd.dmy) pill(ctx, 797 * 2, y * 2, 156 * 2, 20 * 2, 'Info. updated to ' + dd.dmy, '#595959', '#c9c9d4'); }

  function drawCover() {
    var c = newCanvas(), ctx = c.getContext('2d');
    return Promise.all([loadImg(asset('cover.jpg')), loadImg(asset('logo-white.png')), loadImg(asset('partners.png'))]).then(function (a) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      var ph = a[0], bx = 231 * 2, bw = 728 * 2, r = Math.max(bw / ph.width, H / ph.height), sw = bw / r, sh = H / r;
      ctx.drawImage(ph, (ph.width - sw) / 2, (ph.height - sh) / 2, sw, sh, bx, 0, bw, H);
      ctx.fillStyle = '#550FED';                                   // panel en D (flowChartDelay): rectángulo + semicírculo a la derecha
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(540, 0); ctx.arc(540, 540, 540, -Math.PI / 2, Math.PI / 2); ctx.lineTo(0, 1080); ctx.closePath(); ctx.fill();
      ctx.drawImage(a[1], 38 * 2, 50 * 2, 230 * 2, 81 * 2);
      ctx.fillStyle = '#fff'; ctx.font = '700 76px Montserrat, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      wrap(ctx, 'Commercial B2B-MAY Performance', 40 * 2, 166 * 2, 430 * 2, 92);
      ctx.save(); rr(ctx, 52 * 2, 428 * 2, 797 * 2, 61 * 2, 61); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();   // franja blanca con los logos de las marcas
      fit(ctx, a[2], 94 * 2, 447 * 2, 710 * 2, 28 * 2);
      return jpeg(c);
    });
  }
  function wrap(ctx, text, x, y, maxW, lh) {
    var words = text.split(' '), line = '', yy = y;
    words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lh; } else line = t; });
    if (line) ctx.fillText(line, x, yy);
  }
  function drawSeparator(l1, l2) {
    var c = newCanvas(), ctx = c.getContext('2d');
    ctx.fillStyle = '#EEEEEE'; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 6; ctx.strokeStyle = '#6306F1'; rr(ctx, 147 * 2, 160 * 2, 664 * 2, 135 * 2, 28); ctx.stroke();
    ctx.strokeStyle = '#595959'; rr(ctx, 147 * 2, 296 * 2, 664 * 2, 114 * 2, 28); ctx.stroke();
    ctx.fillStyle = '#4300D2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 120px Montserrat, sans-serif';
    ctx.fillText(l1, 479 * 2, 227 * 2); ctx.font = '700 90px Montserrat, sans-serif'; ctx.fillText(l2, 479 * 2, 353 * 2);
    return Promise.resolve(jpeg(c));
  }
  // Slide de contenido: título + logo + "Info. updated" y la captura (img) dentro de la región (x, y, w, h en px del pptx de 960×540)
  function drawContent(title, sub, imgs, dd) {
    var c = newCanvas(), ctx = c.getContext('2d');
    return loadImg(asset('logo.png')).catch(function () { return null; }).then(function (logo) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = '#6E00E7';
      ctx.font = '700 48px Rubik, sans-serif'; ctx.fillText(title, 20, 73);
      if (sub) { var tw = ctx.measureText(title).width; ctx.font = 'italic 400 48px Rubik, sans-serif'; ctx.fillText(sub, 20 + tw, 73); }
      if (logo) ctx.drawImage(logo, 896 * 2, 2 * 2, 62 * 2, 64 * 2);
      infoPill(ctx, dd, 64);
      imgs.forEach(function (it) {
        if (it.tag) pill(ctx, it.tag.x * 2, it.tag.y * 2, 117 * 2, 18 * 2, it.tag.t, '#550FED', '#3D00D1');
        if (it.img) fit(ctx, it.img, it.x * 2, it.y * 2, it.w * 2, it.h * 2, true);
        else { ctx.fillStyle = '#C0392B'; ctx.font = '400 28px Rubik, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('No se pudo capturar esta slide', (it.x + it.w / 2) * 2, (it.y + it.h / 2) * 2); ctx.textAlign = 'left'; }
      });
      return jpeg(c);
    });
  }
  // Slide que es una captura del Tracker entera (ya trae su propio título): a pantalla completa + "Info. updated"
  function drawFull(img, dd) {
    var c = newCanvas(), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    if (img) { fit(ctx, img, 0, 0, W, H, true); infoPill(ctx, dd, 516); }
    else { ctx.fillStyle = '#C0392B'; ctx.font = '400 28px Rubik, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('No se pudo capturar esta slide', W / 2, H / 2); }
    return Promise.resolve(jpeg(c));
  }
  function canvasImg(cv) { return loadImg(cv.toDataURL('image/png')); }

  // ── Capturas ──
  // Slides del propio Tracker. Se capturan en una copia limpia del Tracker (iframe oculto): en la página principal, con el export en curso, las
  // slides de KRs (zoom + foreignObject) salían cortadas; en una página recién abierta salen bien. Dentro de la copia se reemplaza por un momento el
  // contenido de SLIDE_ORDER por las slides que hacen falta (es const: se muta, no se reasigna) y se usa la misma captura del modo Slides.
  var TRACKER_CAPTURE = '(async function () {' +
    ' var orig = SLIDE_ORDER.slice(), f = function (g) { return orig.filter(g)[0]; };' +
    ' var want = [f(function (s) { return s.tab === "agencias_h2" && s.krChannel === "api"; }), f(function (s) { return s.tab === "globales"; }),' +
    '   f(function (s) { return s.tab === "tables_gd" && s.channel === "API"; }), f(function (s) { return s.tab === "tables_ri" && s.channel === "API"; })];' +
    ' if (want.some(function (x) { return !x; })) throw new Error("el Tracker no tiene alguna de las slides necesarias");' +
    ' SLIDE_ORDER.splice(0, SLIDE_ORDER.length, want[0], want[1], want[2], want[3]);' +
    ' try { return await _captureAllSlides(null, { jpeg: true }); } finally { SLIDE_ORDER.splice(0, SLIDE_ORDER.length, ...orig); }' +
    '})()';
  async function captureTracker() {
    var f = await hiddenFrame('/b2b-ecosystem/daily?view=tracker&organic=1&coibr=excl'), w = f.contentWindow;
    try {
      await until(function () { return typeof w._captureAllSlides === 'function' && w.eval('typeof rawData !== "undefined" && !!rawData'); }, 120000, 'el Tracker');
      await sleep(1500);
      var caps = await w.eval(TRACKER_CAPTURE);
      return await Promise.all(caps.map(function (c) { return c && c.img ? loadImg(c.img) : null; }));
    } finally { f.remove(); }
  }

  function hiddenFrame(src) {
    var f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1400px;height:900px;border:0;visibility:hidden';
    f.setAttribute('aria-hidden', 'true'); f.src = src; document.body.appendChild(f);
    return new Promise(function (res, rej) { f.onload = function () { res(f); }; f.onerror = function () { rej(new Error('no se pudo abrir ' + src)); }; });
  }
  async function snap(el, fix) {
    var cv = await html2canvas(el, { scale: 1.5, backgroundColor: '#ffffff', useCORS: true, logging: false });
    if (fix) fix(cv, el, 1.5);
    return canvasImg(cv);
  }
  // html2canvas dibuja mal el texto vertical (writing-mode) de "POS LATAM / POS NO-LATAM": se tapa y se vuelve a escribir rotado
  function fixVertical(cv, root, k) {
    var ctx = cv.getContext('2d'), rb = root.getBoundingClientRect();
    [].forEach.call(root.querySelectorAll('.qd-row span'), function (sp) {
      var r = sp.getBoundingClientRect(), x = (r.left - rb.left) * k, y = (r.top - rb.top) * k, w = r.width * k, h = r.height * k;
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
      ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = '#6b6b85'; ctx.font = '700 ' + Math.round(10 * k) + 'px Poppins, Rubik, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(sp.textContent.trim().toUpperCase(), 0, 0); ctx.restore();
    });
  }
  function light(f) {                              // tablero en tema claro (como las capturas del pptx)
    var d = f.contentDocument; d.documentElement.setAttribute('data-theme', 'light'); d.dispatchEvent(new f.contentWindow.Event('themechange'));
  }

  // Dashboard B2B API: todas con Organic YES y COI Brasil Excluir (los defaults del tablero, fijados igual)
  async function captureDash() {
    var out = { demanda: null, venta: {}, producto: null };
    var f = await hiddenFrame(DASH + '#venta'), w = f.contentWindow, d = f.contentDocument;
    // cada parte va aparte: si una falla (queda como placeholder) no se pierden las demás
    async function part(what, fn) { try { return await fn(); } catch (e) { console.warn('[weekly] ' + what + ':', e); return null; } }
    try {
      await until(function () { return w.B2B && w.B2B.tabs && w.B2B.tabs.venta && w.B2B.state; }, 60000, 'el Dashboard B2B API');
      light(f);
      var B = w.B2B;
      // Demanda: las cuatro tarjetas de "Hoteles pedidos por origen y destino · MTD"
      upd('Capturando Demanda…');
      out.demanda = await part('Demanda', async function () {
        B.showTab('demanda', false); light(f);
        var card = await until(function () {
          var h = [].filter.call(d.querySelectorAll('h3'), function (e) { return /Hoteles pedidos por origen y destino/.test(e.textContent); })[0];
          return h && h.closest('.card') && h.closest('.card').querySelector('.qd-grid');
        }, 60000, 'Demanda');
        await sleep(800); return await snap(card, fixVertical);
      });
      // Venta: MTD por país y grupo de agencias (Abrir por Agencia · Ver Grupo · Comparar vs año pasado), un país por slide
      try {
        B.showTab('venta', false); light(f);
        await until(function () { return d.querySelector('.tcard'); }, 60000, 'Venta');
        [['vista', 'gd'], ['comp', 'budget'], ['org', 'yes'], ['coi', 'excl'], ['apertura', 'ag'], ['agrp', 'grp'], ['vshare', 'ly'], ['gran', 'd'], ['prod', 'all']].forEach(function (kv) { B.set(kv[0], kv[1]); });
        B.state.mDesde = ''; B.state.mHasta = '';
      } catch (e) { console.warn('[weekly] Venta:', e); }
      for (var i = 0; i < PAISES.length; i++) {
        upd('Capturando Venta · ' + PAISES[i].label + '…');
        out.venta[PAISES[i].label] = await part('Venta ' + PAISES[i].label, async function () {
          var lbl = PAISES[i].label;
          var opt = [].filter.call(d.querySelectorAll('select[data-key="dpais"] option'), function (o) { return o.textContent.trim() === lbl; })[0];
          if (!opt) throw new Error('no hay país ' + lbl);
          B.set('dpais', opt.value); light(f);
          await until(function () { return d.querySelector('.mt-grid'); }, 30000, 'la tabla de ' + lbl);
          await sleep(1200);
          var row = d.querySelector('.mt-col tr.bk-row-group');   // abre el país (no "Expandir todo": eso abre cada grupo y la tabla no entra)
          if (row && !row.classList.contains('open')) { row.click(); await sleep(900); }
          return await snap(d.querySelector('.mt-grid'));
        });
      }
      try { B.set('dpais', 'all'); } catch (e) { /* sigue */ }
      // Producto: Hoteles · Gross Bookings semana a semana · Gestión, vs últimas 4 semanas (las tres columnas solo se arman con esa opción)
      upd('Capturando Producto…');
      out.producto = await part('Producto', async function () {
        B.set('vista', 'gd'); B.set('metric', 'gb'); B.set('pshare', 'l4w'); B.showTab('producto', false); light(f);
        await until(function () { return d.querySelector('.wk-cols'); }, 60000, 'Producto');
        await sleep(1500); return await snap(d.querySelector('.wk-cols'));
      });
    } finally { f.remove(); }
    return out;
  }

  // Daily: gráfico de FVM semanal de la vista B2B (canal API) en GD y en RI
  async function captureDailyFvm(date) {
    var f = await hiddenFrame('/b2b-ecosystem/daily?weeklyembed=fvm&date=' + date);
    try {
      if (window.__wkBase) { var sc = f.contentDocument.createElement('script'); sc.src = window.__wkBase + '/daily-tracker-weekly.js'; f.contentDocument.head.appendChild(sc); }   // prueba local: el Daily publicado todavía no trae este archivo
      var r = await new Promise(function (res, rej) {
        var timer = setTimeout(function () { rej(new Error('el Daily tardó demasiado en cargar')); }, 180000);
        window.addEventListener('message', function on(ev) {
          if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'weekly-embed' || ev.source !== f.contentWindow) return;
          window.removeEventListener('message', on); clearTimeout(timer); res(ev.data);
        });
      });
      if (!r.ready) throw new Error(r.error || 'el Daily no armó el gráfico');
      var card = f.contentDocument.getElementById('b2b-mc-chart-fvm').closest('.mc-card');
      return await snap(card);
    } finally { f.remove(); }
  }
  var PAISES = [{ label: 'Globales' }, { label: 'Brasil' }, { label: 'Mexico', show: 'México' }, { label: 'Argentina' }];

  function safe(p, what) { return p.catch(function (e) { console.warn('[weekly] ' + what + ':', e); return null; }); }

  // Todas las slides del deck, en orden, como imágenes JPEG 1920×1080
  async function buildDeck() {
    var dd = dataDate(), mes = MES[dd.m - 1] || '';
    await loadFonts();
    upd('Capturando el Tracker…');
    var trk = await safe(captureTracker(), 'Tracker') || [null, null, null, null];
    upd('Capturando el Dashboard B2B API…');
    var dash = await safe(captureDash(), 'Dashboard B2B API') || { demanda: null, venta: {}, producto: null };
    upd('Capturando el gráfico de FVM del Daily (GD)…');
    var fvmGd = await safe(captureDailyFvm('gd'), 'FVM GD');
    upd('Capturando el gráfico de FVM del Daily (RI)…');
    var fvmRi = await safe(captureDailyFvm('ri'), 'FVM RI');
    upd('Armando las slides…');
    var R = { x: 5, y: 86, w: 950, h: 440 };
    function body(img) { return [{ img: img, x: R.x, y: R.y, w: R.w, h: R.h }]; }
    var slides = [
      function () { return drawCover(); },
      function () { return drawFull(trk[0], dd); },
      function () { return drawFull(trk[1], dd); },
      function () { return drawContent('Hoteles pedidos por origen y destino | ' + mes + ' MTD', '', [{ img: dash.demanda, x: 27, y: 112, w: 904, h: 323 }], dd); },
      function () { return drawSeparator('TOP AGENCIAS', 'API vs LY'); }
    ];
    PAISES.forEach(function (p) {
      slides.push(function () { return drawContent(mes + ' MTD Agencias vs LY ' + (p.show || p.label), '', body(dash.venta[p.label]), dd); });
    });
    slides.push(function () { return drawSeparator('Performance LW', 'vs Tendencia'); });
    slides.push(function () {
      return drawContent('FVM API - Weeks Evolution', '', [
        { img: fvmGd, x: 14, y: 92, w: 930, h: 211, tag: { x: 18, y: 76, t: 'by Gestion Date' } },
        { img: fvmRi, x: 24, y: 328, w: 910, h: 211, tag: { x: 18, y: 309, t: 'by Recognition Date' } }], dd);
    });
    slides.push(function () { return drawContent('LW Hoteles vs Tendencia L4W', '', body(dash.producto), dd); });
    slides.push(function () { return drawFull(trk[2], dd); });
    slides.push(function () { return drawFull(trk[3], dd); });
    var out = [];
    for (var i = 0; i < slides.length; i++) out.push({ img: await slides[i](), w: W, h: H });
    return out;
  }

  // ── Exportar ──
  function upd(m) { try { updateExportOverlay(m); } catch (e) { /* sin overlay */ } }
  async function exportPDF() {
    if (_exporting) return;
    _exporting = true;
    try {
      showExportOverlay('Armando el Weekly B2B-MAY…');
      var slides = await buildDeck();
      if (/[?&]wkdebug=1\b/.test(location.search)) window.__wkDeck = slides;   // para revisar las imágenes
      upd('Armando el PDF…');
      var ctor = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : window.jsPDF, PW = 1280, PH = 720;
      var pdf = new ctor({ orientation: 'landscape', unit: 'pt', format: [PW, PH] });
      slides.forEach(function (s, i) { if (i) pdf.addPage([PW, PH], 'landscape'); pdf.addImage(s.img, 'JPEG', 0, 0, PW, PH); });
      pdf.save('Weekly_B2B-MAY_' + new Date().toISOString().slice(0, 10) + '.pdf');
      _exportDone('PDF descargado ✓');
    } catch (e) { _exportDone('Error al generar el PDF: ' + errText(e)); }
    finally { _exporting = false; }
  }
  function fail(msg) { _exporting = false; _exportDone('Error al enviar a Google Slides: ' + msg); }
  function poll(jobId, t0) {
    var secs = Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > 10 * 60 * 1000) return fail('tardó demasiado. Revisá la presentación y reintentá.');
    google.script.run
      .withSuccessHandler(function (st) {
        if (!st || st.state === 'error') return fail((st && st.error) || 'no se pudo actualizar la presentación.');
        if (st.state === 'done') { _exporting = false; return _exportDone('Listo ✓ ' + st.count + ' slides en Google Slides.', st.url); }
        upd('Actualizando la presentación en Google Slides… ' + secs + ' s (puede tardar un par de minutos)');
        setTimeout(function () { poll(jobId, t0); }, 3000);
      })
      .withFailureHandler(function () { setTimeout(function () { poll(jobId, t0); }, 6000); })
      .exportToGoogleSlidesStatus(jobId);
  }
  async function exportGoogle() {
    if (_exporting) return;
    _exporting = true;
    try {
      showExportOverlay('Armando el Weekly B2B-MAY…');
      var slides = await buildDeck();
      upd('Subiendo las slides…');
      google.script.run
        .withSuccessHandler(function (r) { if (!r || !r.jobId) return fail('el servidor no confirmó el envío.'); poll(r.jobId, Date.now()); })
        .withFailureHandler(function (e) { fail(errText(e)); })
        .exportWeeklyToGoogleSlides({ slides: slides });
    } catch (e) { _exporting = false; _exportDone('Error al armar las slides: ' + errText(e)); }
  }

  // ── Botón en el encabezado del Tracker ──
  function init() {
    var btn = document.getElementById('slidesModeBtn');
    if (!btn || typeof window._captureAllSlides !== 'function' || typeof SLIDE_ORDER === 'undefined' || document.getElementById('weeklyBtn')) return;
    var wrap = document.createElement('span');
    wrap.className = 'slides-export-wrap'; wrap.style.cssText = 'position:relative;display:inline-block;margin-left:8px';
    var b = document.createElement('button');
    b.className = 'slides-mode-btn'; b.id = 'weeklyBtn'; b.type = 'button'; b.textContent = '📋 Weekly B2B-MAY';
    var menu = document.createElement('div');
    menu.className = 'slides-export-menu'; menu.id = 'weeklyMenu';
    [['📄 Descargar PDF', exportPDF], ['🖼️ Enviar a Google Slides', exportGoogle]].forEach(function (o) {
      var x = document.createElement('button'); x.type = 'button'; x.textContent = o[0];
      x.onclick = function () { menu.classList.remove('open'); o[1](); }; menu.appendChild(x);
    });
    b.onclick = function (e) { e.stopPropagation(); menu.classList.toggle('open'); };
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) menu.classList.remove('open'); });
    wrap.appendChild(b); wrap.appendChild(menu);
    btn.parentNode.insertBefore(wrap, btn.nextSibling);
  }
  if (document.readyState === 'complete') init(); else window.addEventListener('load', init);
  if (window.__wkBase) window.__wkTest = { buildDeck: buildDeck };   // solo para probar en local
})();
