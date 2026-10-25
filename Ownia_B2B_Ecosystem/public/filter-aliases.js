/* Diccionario de filtros por texto (Ownia). Lo usa la barra "Filtrar…" del P&L Dashboard
 * (public/hub-layout.js) y está pensado para reusarse en otros módulos (el Daily).
 *
 * Cómo sumar un sinónimo: agregalo a la lista del valor que corresponda. Se comparan sin mayúsculas,
 * sin acentos y sin puntuación ("México" = "mexico" = "MEX."), y pueden tener más de una palabra
 * ("other countries", "año pasado"). El primer elemento de cada lista es el nombre que se muestra.
 * La clave es el valor que entiende el tablero (el mismo de sus filtros).
 *
 * Expone window.OwniaFilters = { aliases, normalize, parse }. parse(texto) devuelve
 *   { matches: [{ dim, value, label, text }], unknown: ['palabra', …] }
 * con dim ∈ pais | grupo | lob | canal | goal | baseline | producto | periodo | accion. Los períodos
 * salen como { kind: 'month', mm, yy } | { kind: 'q', n } | { kind: 'h', n } | { kind: 'ytd' } |
 * { kind: 'fy' } | { kind: 'ym', ym } y los resuelve cada tablero (el año fiscal es suyo).
 */
(function () {
  'use strict';

  var A = {
    // Países: la clave es el valor de la base. Other / Others / Other Countries / OT son Globales.
    pais: {
      'Brasil': ['Brasil', 'br', 'bra', 'brazil'],
      'Mexico': ['México', 'mx', 'mex', 'mexico'],
      'Argentina': ['Argentina', 'ar', 'arg'],
      'Chile': ['Chile', 'cl', 'chi', 'chl'],
      'Colombia': ['Colombia', 'co', 'col'],
      'Peru': ['Perú', 'pe', 'per', 'peru'],
      'Ecuador': ['Ecuador', 'ec', 'ecu'],
      'Other Countries': ['Globales', 'global', 'other countries', 'other country', 'other', 'others', 'ot', 'otros paises', 'resto'],
      'RG': ['OPS + RG', 'rg', 'ops', 'ops rg', 'regional', 'regionales']
    },
    // Grupos de países (los del waterfall).
    grupo: {
      'Hispa': ['Hispa', 'hispanoamerica', 'hispano', 'hisp', 'spla']
    },
    lob: {
      'all': ['Consolidado', 'consolidado', 'total', 'b2b b2b2c', 'b2b y b2b2c', 'ambos'],
      'b2b': ['B2B', 'b2b', 'agencias', 'agencia'],
      'b2b2c': ['B2B2C', 'b2b2c', 'wl', 'wls', 'white label', 'white labels', 'marca blanca', 'partners']
    },
    canal: {
      'may': ['Mayoristas', 'may', 'mayorista', 'mayoristas', 'wholesale'],
      'min': ['Minoristas', 'min', 'minorista', 'minoristas', 'retail']
    },
    goal: {
      'budget': ['vs Budget', 'budget', 'bud', 'bgt', 'presupuesto', 'plan', 'ppto'],
      'forecast': ['vs Forecast', 'forecast', 'fc', 'fcst', 'pronostico'],
      'runRate': ['vs Run Rate', 'run rate', 'runrate', 'rr'],
      'lastYear': ['vs año pasado', 'ly', 'last year', 'año pasado', 'yoy', 'interanual', 'ano anterior', 'año anterior']
    },
    // Base de lo que se mide. "forecast" suelto es el Goal; para la base hay que decir "base forecast".
    baseline: {
      'baseline': ['Base: Real + proyección', 'base real', 'baseline real', 'base actuals'],
      'forecast': ['Base: Forecast', 'base forecast', 'baseline forecast']
    },
    producto: {
      'packages general': ['Paquetes', 'paquetes', 'paquete', 'packages', 'package', 'pkg', 'pk', 'packages general'],
      'hotels': ['Hoteles', 'hoteles', 'hotel', 'hotels', 'htl', 'ht', 'alojamiento'],
      'flights': ['Vuelos', 'vuelos', 'vuelo', 'aereo', 'aereos', 'flights', 'flight', 'air', 'aer', 'fl'],
      'dest. serv.': ['Servicios en destino', 'dest serv', 'destino', 'servicios en destino', 'actividades', 'traslados'],
      'insurance': ['Asistencia / seguros', 'insurance', 'seguro', 'seguros', 'asistencia', 'asistencias'],
      'cars': ['Autos', 'autos', 'auto', 'cars', 'car', 'alquiler de autos'],
      'vacation rentals': ['Alquileres temporarios', 'vacation rentals', 'vr', 'alquileres', 'alquiler temporario', 'alquileres temporarios'],
      'cruises': ['Cruceros', 'cruceros', 'crucero', 'cruises', 'cruise'],
      'corporate': ['Corporate', 'corporate', 'corporativo', 'corpo']
    },
    // Meses (mm). "mar" es marzo; "set" (portugués) también es septiembre.
    mes: {
      '01': ['enero', 'ene', 'jan', 'january'],
      '02': ['febrero', 'feb', 'february'],
      '03': ['marzo', 'mar', 'march'],
      '04': ['abril', 'abr', 'apr', 'april'],
      '05': ['mayo', 'may 26', 'may 27', 'may 2026', 'may 2027'],   // "may" solo es Mayoristas
      '06': ['junio', 'jun', 'june'],
      '07': ['julio', 'jul', 'july'],
      '08': ['agosto', 'ago', 'aug', 'august'],
      '09': ['septiembre', 'setiembre', 'sep', 'sept', 'set', 'september'],
      '10': ['octubre', 'oct', 'october'],
      '11': ['noviembre', 'nov', 'november'],
      '12': ['diciembre', 'dic', 'dec', 'december']
    },
    accion: {
      'limpiar': ['Todos', 'todos', 'todo', 'limpiar', 'borrar', 'reset', 'sin filtro', 'sin filtros']
    }
  };
  // Palabras de relleno que no son filtros ("brasil vs forecast en sep de 2026").
  var STOP = ['vs', 'contra', 'en', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'a', 'al', 'para', 'por', 'con', 'mes', 'periodo', 'pais', 'paises', 'producto', 'productos', 'lob', 'canal', 'goal', 'comparar', 'comparado', 'ver'];

  function normalize(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Índice: frase normalizada → [{ dim, value, label }] (una frase puede valer para más de un filtro).
  var index = {}, maxWords = 1;
  Object.keys(A).forEach(function (dim) {
    Object.keys(A[dim]).forEach(function (value) {
      var list = A[dim][value];
      list.forEach(function (alias) {
        var k = normalize(alias);
        if (!k) return;
        (index[k] = index[k] || []).push({ dim: dim, value: value, label: dim === 'mes' ? value : list[0] });
        maxWords = Math.max(maxWords, k.split(' ').length);
      });
      // El valor de la base también vale ("other countries", "packages general").
      var kv = normalize(value);
      if (kv && dim !== 'mes' && !(index[kv] || []).some(function (e) { return e.dim === dim && e.value === value; })) {
        (index[kv] = index[kv] || []).push({ dim: dim, value: value, label: list[0] });
      }
    });
  });

  function period(words, i) {
    var w = words[i], m;
    if ((m = /^(20\d\d)(0[1-9]|1[0-2])$/.exec(w))) return { len: 1, p: { kind: 'ym', ym: m[1] + '-' + m[2] } };
    if (/^20\d\d$/.test(w) && /^(0?[1-9]|1[0-2])$/.test(words[i + 1] || '')) {
      return { len: 2, p: { kind: 'ym', ym: w + '-' + ('0' + words[i + 1]).slice(-2) } };
    }
    if ((m = /^(q|t)([1-4])$/.exec(w))) return { len: 1, p: { kind: 'q', n: +m[2] } };
    if ((m = /^h([12])$/.exec(w)) || (m = /^s([12])$/.exec(w))) return { len: 1, p: { kind: 'h', n: +m[1] } };
    if (w === 'ytd' || w === 'acumulado' || (w === 'ano' && words[i + 1] === 'a' && words[i + 2] === 'la' && words[i + 3] === 'fecha')) {
      return { len: w === 'ano' ? 4 : 1, p: { kind: 'ytd' } };
    }
    if (/^fy(\d\d)?$/.test(w) || w === 'anual') return { len: 1, p: { kind: 'fy' } };
    return null;
  }

  function parse(text) {
    var words = normalize(text).split(' ').filter(Boolean);
    var matches = [], unknown = [];
    for (var i = 0; i < words.length;) {
      var pr = period(words, i);
      if (pr) { matches.push({ dim: 'periodo', value: pr.p, text: words.slice(i, i + pr.len).join(' ') }); i += pr.len; continue; }
      var hit = null;
      for (var n = Math.min(maxWords, words.length - i); n >= 1 && !hit; n--) {
        var k = words.slice(i, i + n).join(' ');
        if (index[k]) hit = { n: n, k: k, list: index[k] };
      }
      if (hit) {
        var e = hit.list[0];
        if (e.dim === 'mes') {
          // Año opcional después del mes: "sep 26", "sep 2026".
          var y = words[i + hit.n], yy = null;
          if (/^(20)?\d\d$/.test(y || '')) { yy = y.slice(-2); hit.n++; }
          matches.push({ dim: 'periodo', value: { kind: 'month', mm: e.value, yy: yy }, text: words.slice(i, i + hit.n).join(' ') });
        } else {
          matches.push({ dim: e.dim, value: e.value, label: e.label, text: hit.k });
        }
        i += hit.n;
        continue;
      }
      if (STOP.indexOf(words[i]) < 0) unknown.push(words[i]);
      i++;
    }
    return { matches: matches, unknown: unknown };
  }

  window.OwniaFilters = { aliases: A, normalize: normalize, parse: parse };
})();
