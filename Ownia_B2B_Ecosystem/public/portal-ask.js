/* Buscador de la portada: "¿Qué querés ver?" (2026-10-30, Tiago). La persona escribe o dicta lo que quiere
 * hacer ("cierre contable b2b", "daily b2b2c", "flow semanal") y la portada la lleva al tablero y a la vista.
 * Receta y reglas: .agents/skills/caja-de-preguntas/SKILL.md. No llama a ningún modelo: es determinista y
 * corre en el navegador; si no entiende, lo dice y no manda a ningún lado.
 *
 * Tres piezas, separadas a propósito:
 *  - fixVoice(texto): corrige lo que el dictado escribe "como suena" (bitubi → B2B, badget → budget).
 *  - parse(texto, partners) → intención neutra r: temas (daily, contable, okr…), frecuencia, LoB, países,
 *    período, comparación, producto, canal y partner. Países / LoB / períodos / comparación salen del
 *    diccionario compartido con el P&L Dashboard (public/filter-aliases.js, window.OwniaFilters).
 *    No sabe qué tableros existen.
 *  - route(r, dest) → destinos [{ slug, params, title, sub, notes }], el mejor primero. Acá vive lo que
 *    cada tablero puede abrir por link (?view=, ?lob=, ?tab=, ?q=…) y lo que NO puede (va a `notes`).
 *  - mount(opt): la caja (campo, micrófono, panel de destinos, registro de la pregunta).
 *
 * parse / route no tocan el DOM: los prueba test/portal-ask.test.js en Node.
 * Para sumar un sinónimo: agregalo al tema que corresponda en TOPICS (regex sobre el texto normalizado:
 * minúsculas, sin acentos, sin puntuación — "P&L" llega como "p l").
 */
(function (root) {
  'use strict';
  var F = root.OwniaFilters;

  // ── 1. Dictado: lo que el reconocimiento de voz escribe para la jerga del equipo ──────────────────
  // Lo más largo primero (si no, B2B2C se come como B2B). Español y portugués.
  var V_A = '(^|[^a-z0-9])', V_Z = '(?![a-z0-9])';
  var V_B = '(?:b|v)(?:e|ee|ê|é|i|í)?';
  var V_2 = '(?:2|dos|dois|two|too|tou|to|tu|ti|du)';
  var V_C = '(?:c|ce|cee|cê|ci|s|se|see|si|sí|sea)';
  function B2() { return new RegExp(V_A + [].slice.call(arguments).join('\\s*-?\\s*') + V_Z, 'gi'); }
  var VOICE_FIXES = [
    [B2(V_B, V_2, V_B, V_2, V_C), '$1B2B2C'],
    [B2(V_B, V_2, V_C), '$1B2C'],
    [B2(V_B, V_2, V_B), '$1B2B'],
    [/\bbitubi(?:ci|si)\b/gi, 'B2B2C'],
    [/\bbitubi\b/gi, 'B2B'],
    [/\b(?:bad|ba|bud|bo)\s?-?\s?(?:get|yet|jet|guet|yet)\b|\bbadget\b|\bbayet\b/gi, 'budget'],
    [/\b(?:ran|ram|run)\s?-?\s?(?:reit|rei|rate|reid|reyt)\b/gi, 'run rate'],
    [/\befe\s?-?\s?(?:ve|uve|be)\s?-?\s?eme\b/gi, 'FVM'],
    [/\b(?:pi|pe)\s+(?:and|en|an|y|e)\s+(?:el|ele|l)\b|\bpianel\b|\bpe\s?-?\s?ele\b/gi, 'P&L'],
    [/\bo\s?-?\s?(?:ka|ca|k|kei|quei)\s?-?\s?(?:erre|r|ere)s?\b|\bokeis\b|\bokerre\b/gi, 'OKR'],
    [/\b(?:tocan|tokan|toucan|tukan)\b/gi, 'Toqan'],
    [/\b(?:deili|deily|deli|dei li|deilly)\b/gi, 'daily'],
    [/\b(?:uikli|wikli|guikli|uicli)\b/gi, 'weekly'],
    [/\b(?:flou|flo)\b/gi, 'flow'],
    [/\b(?:manayerial|manageria|menagerial|manager ial|manayer)\b/gi, 'managerial'],
    [/\b(?:fix|fics|fixe|fixt)\s?-?\s?(?:cost|cos|costo)\b|\bfixcost\b/gi, 'fixed cost'],
    [/\b(?:guait|uait|wait|uaite|guaite)\s+(?:leibel|label|leibol|leivel)s?\b/gi, 'white label'],
    [/\b(?:traker|traquer|tracke)\b/gi, 'tracker'],
    [/\bbench\s+mark\b|\bbenchmarc\b|\bbenchmar\b/gi, 'benchmark'],
    [/\b(?:rouling|roling|rouli)\b/gi, 'rolling'],
  ];
  function fixVoice(t) {
    return VOICE_FIXES.reduce(function (x, f) { return x.replace(f[0], f[1]); }, String(t || ''));
  }

  // ── 2. Intérprete ──────────────────────────────────────────────────────────────────────────────────
  function norm(s) { return F.normalize(s); }

  // Temas: qué quiere ver. El orden importa: lo más específico primero, y lo que matchea se saca del
  // texto (así "fvm negativo" no deja suelto "fvm", y "h2 vs h1" no queda como período).
  var TOPICS = [
    ['fvm_negativo', /\b(fvm|margen|margem|transacciones|transacoes)\s+(negativ[oa]s?|menor a cero|bajo cero)\b|\bfvm\s*0\b|\bnegativ[oa]s?\b/],
    ['profit_sharing', /\bprofit\s*sharing\b|\bbanco de chile\b|\bbch\b/],
    ['consolidacion', /\bhub\s+(de\s+)?consolidaci(on|ao)\b|\bconsolidaci(on|ao)\b|\bconsolidador\b|\bbajadas?\b|\bbase de consolidacion\b/],
    ['industry_events', /\bindustry\s+events?(\s+tracker)?\b|\beventos?\s+(de\s+)?industria\b/],
    ['weekly_industry', /\bweekly\s+industr(y|ia)\b|\bkpis?\s+de\s+industria\b|\bindustria\b|\bindustry\b/],
    ['h2h1', /\bh2\s*(vs|contra|x)?\s*h1\b|\bh2\s+budget\s+vs\s+h1\b/],
    ['por_pais', /\bdetail\s+by\s+country\b|\b(detalle|apertura|abertura)\s+(por|x)\s+pais(es)?\b|\bpor\s+pais(es)?\b/],
    ['mis_slides', /\bmis\s+slides\b|\bminhas\s+slides\b|\barmar\s+(slides|presentacion|deck)\b|\bbuilder\b|\bslides propias\b/],
    ['cierre_slides', /\b(slides?|presentacion|apresentacao|deck)\s+(de\s+)?(cierre|fechamento)(\s+de\s+mes)?\b|\bcierre\s+de\s+mes\b|\bfechamento\s+(do\s+)?mes\b/],
    ['rolling', /\brolling(\s+projections?)?(\s+run\s*rate)?\b|\brun\s*rate\s+automatico\b|\bproyecciones\b|\bprojecoes\b|\bprojections?\b/],
    ['run_rate', /\brun\s*rate\b|\brunrate\b/],
    ['fixed_cost', /\bfixed\s*cost(s)?\b|\bcostos?\s+fijos?\b|\bcustos?\s+fixos?\b|\bestructura\s+de\s+costos\b/],
    ['agentes', /\bagentes?\b|\btoqan\b|\bagents?\b|\bia\b|\bai\b|\bbitubia\b|\bbitubicia\b|\bbitubee\b|\bguru\b|\bcobu\b|\bjournalist\b|\bwl\s+coach\b|\bnuitee\b|\bincidencias\b|\bbrg\b|\balta\s+(de\s+)?credenciales\b|\bdash\s+conectores\b/],
    ['okr', /\bokrs?(\s+(de\s+)?producto)?\b|\bkrs?\b|\bkey\s+results?\b|\bobjetivos\b|\btribu\b/],
    ['api', /\bapi(\s+one\s*pager)?\b|\bone\s*pager\b|\bonepager\b/],
    ['marketing', /\bmarketing\b|\bmkt\b/],
    ['gantt', /\bgantt\b|\broadmap\b|\bcronograma\b/],
    ['manual', /\bmanual\b|\bdocumentaci(on|ao)\b|\bcomo\s+funciona\b|\bayuda\b|\bajuda\b/],
    ['managerial', /\b(p\s?l\s+|pnl\s+|p\s?y\s?l\s+)?(managerial|gestional|gerencial|de\s+gestion)\b|\bfvm\b/],
    ['vs_contable', /\b(vs|contra|versus)\s+(accounting|contable|contabil)\b/],
    ['accounting', /\b(p\s?l\s+|pnl\s+)accounting\b|\baccounting\b/],
    ['contable', /\b(cierre|fechamento|resultado)\s+contab(le|il)\b|\b(p\s?l\s+|pnl\s+)?contab(le|il)\b|\bepm\b|\bcierre\b|\bfechamento\b/],
    ['benchmark', /\bbenchmark\b|\b(vs|contra)\s+b2c\b|\bb2c\b/],
    ['tracker', /\btracker\b/],
    ['weekly', /\bweekly(\s+summary)?\b|\bresumen\s+semanal\b/],
    ['presentacion', /\bflow\b|\bpresentaci(on|ones)\b|\bapresentac(ao|oes)\b|\bslides?\b|\bdeck\b|\breview\b|\brevision\b/],
    ['daily', /\bdaily\b|\bdiari[oa]s?\b|\bhoy\b|\bhoje\b|\bayer\b|\bontem\b|\bmtd\b|\bdel\s+dia\b|\bdo\s+dia\b/],
    ['hub', /\b(p\s?l|pnl)\s+dashboard\b|\bhub\b|\b(p\s?l|pnl)\b|\bresultados?\b/],
  ];
  // Frecuencia: semanal / mensual / trimestral (elige la vista de Presentaciones y de OKR).
  var FREQ = [
    ['semanal', /\bsemanal(es)?\b|\bsemana\b|\bweekly\b|\bwow\b/],
    ['mensual', /\bmensual(es)?\b|\bmes\b|\bmonthly\b/],
    ['trimestral', /\btrimestral(es)?\b|\btrimestre\b|\bquarterly\b/],
  ];
  // Palabras de relleno: no cuentan como "no entendí".
  var FILLER = ('quiero quisiera queria ver mirar mostrame mostrar muestra dame abrir abri abre ir ir a llevame lleva necesito busco buscar ' +
    'como viene vienen venimos esta estamos va van dato datos numero numeros el la los las un una de del al a en y o e por para con que ' +
    'mi mis me se ya hacer revisar consultar sobre tablero tableros modulo vista pantalla solapa seccion app ' +
    'eu quero queria mostra mostre abrir ver o os as um uma do da dos das no na nos nas em para pelo pela como esta vamos ' +
    'please show me open go to the of and vs contra').split(' ');

  function cut(s, re) {
    var m = re.exec(s);
    if (!m) return null;
    return { text: m[0].trim(), rest: s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length) };
  }

  // Partners (vienen del Daily, ver server/portal-ask-data.js). Los que son también palabras comunes
  // ("Claro", "Latam", "Macro"…) cuentan solo escritos con mayúscula.
  var COMMON = { claro: 1, latam: 1, macro: 1, viva: 1, vivo: 1, visa: 1, sky: 1, elo: 1, nomad: 1, cocos: 1, koin: 1, esfera: 1, passaporte: 1, vibe: 1 };
  function findPartner(raw, s, partners) {
    var list = (partners || []).map(function (p) { return { p: p, k: norm(p) }; })
      .filter(function (x) { return x.k.length >= 3; })
      .sort(function (a, b) { return b.k.length - a.k.length; });
    for (var i = 0; i < list.length; i++) {
      var re = new RegExp('(^| )' + list[i].k.replace(/ /g, '\\s+') + '(?= |$)');
      if (!re.test(s)) continue;
      if (COMMON[list[i].k]) {
        var w = new RegExp('(^|[^a-z])(' + list[i].k + ')(?![a-z])', 'i').exec(raw);
        if (!w || w[2].charAt(0) === w[2].charAt(0).toLowerCase()) continue;
      }
      return { name: list[i].p, rest: s.replace(re, ' ') };
    }
    return null;
  }

  /** Texto → intención neutra. `partners`: nombres reales de partners (opcional). */
  function parse(text, partners) {
    var raw = fixVoice(text);
    var s = ' ' + norm(raw) + ' ';
    var r = { text: String(text || ''), topics: [], freq: null, lob: null, paises: [], grupo: null, periodo: [], goal: null,
      producto: null, canal: null, partner: null, filterText: '', unknown: [], understood: false };
    if (!s.trim()) return r;

    var pa = findPartner(raw, s, partners);
    if (pa) { r.partner = pa.name; s = pa.rest; }
    if (pa && norm(pa.name) === 'banco de chile') r.topics.push('profit_sharing');   // tiene su propio P&L
    TOPICS.forEach(function (t) {
      var c;
      while ((c = cut(s, t[1]))) {
        if (r.topics.indexOf(t[0]) < 0) r.topics.push(t[0]);
        s = c.rest;
      }
    });
    FREQ.forEach(function (f) {
      var c = cut(s, f[1]);
      if (c && !r.freq) { r.freq = f[0]; s = c.rest; }
    });

    var p = F.parse(s), keep = [];
    p.matches.forEach(function (m) {
      if (m.dim === 'lob') r.lob = m.value;
      else if (m.dim === 'pais') { if (r.paises.indexOf(m.value) < 0) r.paises.push(m.value); }
      else if (m.dim === 'grupo') r.grupo = m.value;
      else if (m.dim === 'periodo') r.periodo.push(m.text);
      else if (m.dim === 'goal') r.goal = m.value;
      else if (m.dim === 'producto') r.producto = m.value;
      else if (m.dim === 'canal') r.canal = m.value;
      else if (m.dim !== 'baseline') return;   // "base forecast": solo lo entiende el P&L Dashboard (va en filterText)
      keep.push(m.text);
    });
    if (r.canal && !r.lob) r.lob = 'b2b';   // mayoristas / minoristas existen solo en B2B
    r.filterText = keep.join(' ');
    r.unknown = p.unknown.filter(function (w) { return FILLER.indexOf(w) < 0 && !/^\d+$/.test(w); });
    r.understood = !!(r.topics.length || r.freq || r.lob || r.paises.length || r.grupo || r.partner || r.periodo.length || r.goal || r.producto || r.canal);
    return r;
  }

  // ── 3. Ruteo: intención → tablero + vista ──────────────────────────────────────────────────────────
  var LOB_TXT = { all: 'B2B + B2B2C', b2b: 'B2B', b2b2c: 'B2B2C' };
  var GOAL_TXT = { budget: 'Budget', forecast: 'Forecast', runRate: 'Run Rate', lastYear: 'Last Year' };
  var PAIS_TXT = { Mexico: 'México', Peru: 'Perú', 'Other Countries': 'Globales', RG: 'OPS + RG' };

  /**
   * `dest`: { slug: { title, href, own } } — lo arma el servidor según quién mira (own = versión de
   * Ownia, que entiende los parámetros; si no, se abre el link tal cual y los filtros van a `notes`).
   * Devuelve los destinos posibles, el mejor primero (máximo 4).
   */
  function route(r, dest) {
    var out = [], seen = {};
    // Sin tema pero con frecuencia: "semanal" / "mensual" → Presentaciones; "trimestral" → OKR.
    var T = r.topics;
    if (!T.length && r.freq && !r.partner) T = [r.freq === 'trimestral' ? 'okr' : 'presentacion'];
    var has = function (t) { return T.indexOf(t) >= 0; };
    var own = function (slug) { return !!(dest[slug] && dest[slug].own); };

    // Lo que un destino no puede aplicar desde el link se dice (nunca se descarta en silencio).
    function pending(r, can) {
      var n = [];
      if (r.paises.length && !can.pais) n.push('País (' + r.paises.map(function (x) { return PAIS_TXT[x] || x; }).join(', ') + ')');
      if (r.grupo && !can.pais) n.push('Países (' + r.grupo + ')');
      if (r.partner && !can.partner) n.push('Partner (' + r.partner + ')');
      if (r.periodo.length && !can.periodo) n.push('Período (' + r.periodo.join(', ') + ')');
      if (r.goal && !can.goal) n.push('Comparación (vs ' + GOAL_TXT[r.goal] + ')');
      if (r.producto && !can.producto) n.push('Producto');
      if (r.canal && !can.canal) n.push('Canal');
      return n.length ? ['Elegí en el tablero: ' + n.join(' · ') + '.'] : [];
    }
    function add(slug, params, sub, can, extraNotes) {
      if (!dest[slug]) return;
      var p = own(slug) ? (params || {}) : {};
      var key = slug + JSON.stringify(p);
      if (seen[key]) return;
      seen[key] = 1;
      var notes = (extraNotes || []).slice();
      if (!own(slug) && params && Object.keys(params).length && dest[slug].gas) {
        notes.push('Abre la versión de Apps Script: la vista se elige ahí.');
        notes = notes.concat(pending(r, {}));
      } else notes = notes.concat(pending(r, can || {}));
      out.push({ slug: slug, params: p, title: dest[slug].title, sub: sub || '', notes: notes });
    }

    var lob = r.lob;
    var lobSub = lob ? LOB_TXT[lob] : '';
    var hubCan = { pais: true, periodo: true, goal: true, producto: true, canal: true };

    // P&L contable (cierre). Con el P&L Dashboard abierto para esta persona: ahí, con el LoB y los filtros;
    // si no, P&L Accounting (abierto a todo @despegar.com) en la vista del LoB.
    function contable(sub) {
      var accView = { all: 'contable-combined', b2b: 'contable-b2b', b2b2c: 'contable-b2b2c' }[lob || 'all'];
      if (own('hub')) add('hub', clean({ q: r.filterText }), sub || ('P&L contable · ' + LOB_TXT[lob || 'all']), hubCan);
      add('pnl-accounting', { view: accView }, LOB_TXT[lob || 'all']);
    }
    function daily(tab, sub) {
      var p = { tab: tab === 'daily' ? '' : tab };
      var notes = [];
      var can = {};
      if (tab === 'daily' || tab === 'weekly') {
        if (lob === 'b2b' || lob === 'b2b2c') p.lob = lob;
        else if (lob === 'all' && tab === 'daily') notes.push('El Daily no tiene vista B2B + B2B2C: abre en B2B2C.');
        else if (lob === 'all') p.lob = 'all';
        if (r.partner && tab === 'daily') { p.lob = 'b2b2c'; p.partner = r.partner; can.partner = true; }
        if (tab === 'daily' && p.lob !== 'b2b' && r.paises.length === 1) { p.pais = r.paises[0]; can.pais = true; }
      }
      add('daily', clean(p), sub || [{ daily: 'Daily', weekly: 'Weekly', benchmark: 'Benchmark vs B2C', tracker: 'Daily B2B Tracker', industry: 'Industry events', flow: 'Flow semanal' }[tab],
        p.lob ? LOB_TXT[p.lob] : '', p.partner || ''].filter(Boolean).join(' · '), can, notes);
    }
    function managerial() {
      var v = has('vs_contable') ? 'vsacc' : lob === 'b2b' || lob === 'b2b2c' ? lob : '';
      add('pnl-managerial', clean({ view: v }), v === 'vsacc' ? 'Managerial vs Accounting' : lobSub,
        {}, lob === 'all' && v !== 'vsacc' ? ['El P&L Managerial no tiene vista B2B + B2B2C: elegí B2B o B2B2C.'] : []);
    }
    function flow(view) {
      add('flow', clean({ view: view }), { semanal: 'Semanal', mensual: 'Mensual', cierre: 'Cierre de mes', builder: 'Mis slides' }[view] || '');
    }

    var strong = T.filter(function (t) { return t !== 'run_rate' && t !== 'vs_contable'; });
    // "run rate" solo, o con "rolling"/"automático": Rolling Projections. Junto a otro tema es la comparación ("daily vs run rate").
    if (has('run_rate')) {
      if (!strong.length) strong = ['rolling'];
      else if (!r.goal) r.goal = 'runRate';
    }
    if (has('vs_contable') && strong.indexOf('managerial') < 0) strong.unshift('managerial');

    strong.forEach(function (t) {
      switch (t) {
        case 'fvm_negativo': add('fvm-negativo', {}, '', {}); break;
        case 'profit_sharing': add('profit-sharing', {}, 'Banco de Chile', { partner: true }); if (r.partner) daily('daily'); break;
        case 'consolidacion': add('hub-consolidacion', {}, ''); break;
        case 'weekly_industry': add('weekly-industry', {}, ''); daily('industry'); break;
        case 'industry_events': daily('industry'); add('weekly-industry', {}, ''); break;
        case 'h2h1': add('hub', { sec: 'h2h1' }, 'H2 Budget vs H1'); break;
        case 'por_pais': add('hub', { sec: 'detailcountry' }, 'Detalle por país'); break;
        case 'mis_slides': flow('builder'); break;
        case 'cierre_slides': flow('cierre'); break;
        case 'rolling': add('rolling-projections', {}, 'Run Rate'); break;
        case 'fixed_cost': add('fixed-cost', {}, ''); break;
        case 'agentes': add('agentes', {}, ''); break;
        case 'okr': add('okr-b2b2c', clean({ view: r.freq === 'mensual' ? 'm' : r.freq === 'trimestral' ? 'q' : '' }), r.freq === 'mensual' ? 'Mensual' : r.freq === 'trimestral' ? 'Trimestral' : ''); break;
        case 'api': add('api-one-pager', {}, ''); break;
        case 'marketing': add('marketing-b2b', {}, ''); break;
        case 'gantt': add('manual', { view: 'gantt' }, 'Gantt'); break;
        case 'manual': add('manual', {}, ''); break;
        case 'managerial': managerial(); break;
        case 'accounting': add('pnl-accounting', { view: { all: 'contable-combined', b2b: 'contable-b2b', b2b2c: 'contable-b2b2c' }[lob || 'all'] }, LOB_TXT[lob || 'all']); break;
        case 'contable':
          contable();
          if (has('presentacion') || r.freq === 'mensual') flow('cierre');
          break;
        case 'benchmark': daily('benchmark'); break;
        case 'tracker': daily('tracker'); break;
        case 'weekly': daily('weekly'); break;
        case 'presentacion':
          if (has('contable')) break;
          flow(r.freq === 'mensual' ? 'mensual' : 'semanal');
          if (!r.freq) flow('mensual');
          break;
        case 'daily': daily('daily'); break;
        case 'hub':
          if (T.length === 1 && !r.filterText) {   // "p&l" a secas: los tres P&L
            contable('P&L contable');
            managerial();
          } else contable();
          break;
      }
    });

    // Sin tema: lo que haya (partner, LoB, país, período) define el destino.
    if (!strong.length && r.understood) {
      if (r.partner) daily('daily');
      if (own('hub')) add('hub', clean({ q: r.filterText }), 'P&L contable' + (lob ? ' · ' + LOB_TXT[lob] : ''), hubCan);
      daily('daily');
      if (lob === 'b2b' || lob === 'b2b2c') managerial();
    }
    // "Semanal" en Presentaciones: el weekly del Daily también existe.
    if (r.freq === 'semanal' && has('presentacion') && !has('weekly')) daily('weekly');
    return out.slice(0, 4);
  }

  function clean(p) {
    var o = {};
    Object.keys(p).forEach(function (k) { if (p[k]) o[k] = p[k]; });
    return o;
  }

  function hrefOf(c, dest) {
    var d = dest[c.slug];
    var qs = Object.keys(c.params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(c.params[k]); }).join('&');
    return d.href + (qs ? (d.href.indexOf('?') >= 0 ? '&' : '?') + qs : '');
  }

  // Chips de lo que se entendió (además del tema), para que se vea qué va a aplicar.
  function chipsOf(r) {
    var c = [];
    if (r.lob) c.push(LOB_TXT[r.lob]);
    r.paises.forEach(function (p) { c.push(PAIS_TXT[p] || p); });
    if (r.grupo) c.push(r.grupo);
    if (r.partner) c.push(r.partner);
    r.periodo.forEach(function (p) { c.push(p); });
    if (r.goal) c.push('vs ' + GOAL_TXT[r.goal]);
    return c;
  }

  // ── 4. La caja ─────────────────────────────────────────────────────────────────────────────────────
  /**
   * opt: { host, dest, partners, logUrl, examples, suggestions }
   * Registro (opcional, logUrl): cada pregunta que se manda — a dónde fue, o "ninguna de estas" — se guarda
   * en segundo plano; si falla, no pasa nada.
   */
  function mount(opt) {
    var host = opt.host, dest = opt.dest, partners = opt.partners || [];
    var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    host.innerHTML =
      '<form class="ask-box" role="search" autocomplete="off">' +
      '<svg class="ask-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input type="search" class="ask-in" spellcheck="false" aria-label="¿Qué querés ver?" aria-controls="ask-pop" aria-autocomplete="list" placeholder="¿Qué querés ver?">' +
      '<button type="button" class="ask-mic" hidden aria-label="Dictar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>' +
      '</form><div class="ask-pop" id="ask-pop" role="listbox" hidden></div>';
    var form = host.querySelector('form'), input = host.querySelector('input'), pop = host.querySelector('.ask-pop'), mic = host.querySelector('.ask-mic');
    var state = { r: null, list: [], sel: 0, voice: false };

    function render() {
      var text = input.value;
      if (!text.trim()) {
        state.r = null; state.list = [];
        pop.innerHTML = '<div class="ask-hint">Escribí o dictá qué querés ver. Probá:</div><div class="ask-sugg">' +
          opt.suggestions.map(function (s) { return '<button type="button" class="ask-ex">' + esc(s) + '</button>'; }).join('') + '</div>';
        pop.hidden = false;
        return;
      }
      var r = state.r = parse(text, partners);
      var list = state.list = r.understood ? route(r, dest) : [];
      if (state.sel >= list.length) state.sel = 0;
      if (!list.length) {
        pop.innerHTML = '<div class="ask-bad">No entendí qué tablero buscás.</div><div class="ask-hint">Probá con el nombre de un tablero o una vista: ' +
          opt.suggestions.slice(0, 4).map(function (s) { return '<button type="button" class="ask-ex">' + esc(s) + '</button>'; }).join('') + '</div>';
        pop.hidden = false;
        return;
      }
      var chips = chipsOf(r);
      pop.innerHTML = (chips.length ? '<div class="ask-chips">' + chips.map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
        list.map(function (c, i) {
          return '<a class="ask-opt' + (i === state.sel ? ' on' : '') + '" role="option" aria-selected="' + (i === state.sel) + '" data-i="' + i + '" href="' + esc(hrefOf(c, dest)) + '"' +
            (dest[c.slug].external ? ' target="_blank" rel="noopener"' : '') + '>' +
            '<span class="ask-t">' + esc(c.title) + (c.sub ? ' <i>· ' + esc(c.sub) + '</i>' : '') + '</span>' +
            (c.notes.length ? '<span class="ask-n">' + esc(c.notes.join(' ')) + '</span>' : '') +
            (i === state.sel ? '<kbd>Enter</kbd>' : '') + '</a>';
        }).join('') +
        (r.unknown.length ? '<div class="ask-bad">No usé: ' + esc(r.unknown.join(', ')) + '</div>' : '') +
        '<button type="button" class="ask-none">Ninguna de estas</button>';
      pop.hidden = false;
    }

    function logIt(chosen) {
      if (!opt.logUrl || !state.r) return;
      var c = chosen >= 0 ? state.list[chosen] : null;
      var body = {
        text: state.r.text.slice(0, 300), voice: state.voice, understood: state.r.understood,
        topics: state.r.topics, chosen: chosen, options: state.list.map(function (x) { return x.slug + (Object.keys(x.params).length ? '?' + JSON.stringify(x.params) : ''); }),
        dest: c ? c.slug : null, params: c ? c.params : null, notes: c ? c.notes : [], unknown: state.r.unknown,
      };
      try {
        fetch(opt.logUrl, { method: 'POST', credentials: 'same-origin', keepalive: true,
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'google.script.run' }, body: JSON.stringify(body) }).catch(function () {});
      } catch (e) { /* el registro nunca molesta */ }
    }

    function go(i) {
      var c = state.list[i];
      if (!c) { logIt(-1); return; }
      logIt(i);
      var d = dest[c.slug], href = hrefOf(c, dest);
      if (d.external) window.open(href, '_blank', 'noopener');
      else window.location.href = href;
    }

    input.addEventListener('focus', render);
    input.addEventListener('input', function () { state.sel = 0; state.voice = false; render(); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!state.list.length) return;
        ev.preventDefault();
        state.sel = (state.sel + (ev.key === 'ArrowDown' ? 1 : state.list.length - 1)) % state.list.length;
        render();
      } else if (ev.key === 'Escape') { input.value = ''; pop.hidden = true; input.blur(); }
    });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!input.value.trim()) return;
      render();
      go(state.list.length ? state.sel : -1);
    });
    pop.addEventListener('mousedown', function (ev) { if (ev.target.closest('button')) ev.preventDefault(); });   // sin perder el foco
    pop.addEventListener('click', function (ev) {
      var ex = ev.target.closest('.ask-ex');
      if (ex) { input.value = ex.textContent; state.sel = 0; state.voice = false; input.focus(); render(); return; }
      if (ev.target.closest('.ask-none')) {
        logIt(-1);
        pop.innerHTML = '<div class="ask-hint">Gracias: queda anotado para sumarlo. Mientras tanto, los tableros están abajo.</div>';
        return;
      }
      var a = ev.target.closest('.ask-opt');
      if (a) logIt(+a.dataset.i);   // el link navega solo
    });
    document.addEventListener('click', function (ev) { if (!host.contains(ev.target)) pop.hidden = true; });

    // Placeholder que se "tipea" solo, para que se note que existe.
    var exIdx = 0, typing = 0;
    function typeNext() {
      if (document.activeElement === input || input.value) { typing = setTimeout(typeNext, 2500); return; }
      var ex = opt.examples[exIdx++ % opt.examples.length], k = 0;
      (function step() {
        if (document.activeElement === input || input.value) { input.placeholder = '¿Qué querés ver?'; typing = setTimeout(typeNext, 2500); return; }
        input.placeholder = '¿Qué querés ver? ' + ex.slice(0, ++k);
        typing = setTimeout(k < ex.length ? step : typeNext, k < ex.length ? 55 : 2600);
      })();
    }
    try { if (!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) typing = setTimeout(typeNext, 1200); } catch (e) { /* sin animación */ }

    // Dictado (Web Speech API: Chrome / Edge / Safari; en Firefox el botón no aparece).
    var Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Speech) {
      mic.hidden = false;
      var rec = null, failed = false;
      mic.addEventListener('click', function () {
        if (rec) { rec.stop(); return; }
        rec = new Speech();
        rec.lang = /^pt/i.test(navigator.language || '') ? 'pt-BR' : 'es-AR';
        rec.interimResults = true;
        failed = false;
        mic.classList.add('rec');
        input.value = ''; input.placeholder = 'Escuchando…';
        rec.onresult = function (e) {
          var t = '';
          for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
          input.value = fixVoice(t);
          state.voice = true; state.sel = 0;
          render();
        };
        rec.onerror = function (e) {
          failed = true;
          pop.innerHTML = '<div class="ask-bad">' + (e.error === 'not-allowed' || e.error === 'service-not-allowed'
            ? 'El micrófono está bloqueado: habilitalo en los ajustes del navegador.'
            : e.error === 'no-speech' ? 'No te escuché. Probá de nuevo.' : 'No pude usar el micrófono. Probá con el dictado del teclado.') + '</div>';
          pop.hidden = false;
        };
        rec.onend = function () {
          mic.classList.remove('rec'); rec = null; input.placeholder = '¿Qué querés ver?';
          if (failed || !input.value.trim()) return;
          state.voice = true;
          render();
          go(state.list.length ? state.sel : -1);   // al terminar de hablar se manda solo; el texto queda para corregir
        };
        rec.start();
      });
    }
  }

  root.PortalAsk = { fixVoice: fixVoice, parse: parse, route: route, hrefOf: hrefOf, mount: mount, TOPICS: TOPICS };
})(typeof window !== 'undefined' ? window : globalThis);
