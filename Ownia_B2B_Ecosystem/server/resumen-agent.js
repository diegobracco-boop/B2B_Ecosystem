// Agente del Resumen semanal (2026-11-19, pedido de Tiago): botón "Preguntale a Claude" que abre una consola a la derecha
// y contesta en lenguaje natural (preguntas tipo CFO: "¿cuánto se viene cerrando la brecha de FVM vs Budget en B2B2C?")
// con los mismos números que muestra la página.
//
// Cómo: Claude (API de Anthropic, clave en APP_SECRETS.ANTHROPIC_API_KEY) recibe una herramienta, `consultar_resumen`, que
// ejecuta getResumenSemanal del Daily —la función que arma la página— y devuelve un extracto compacto. Claude no ve el
// repo ni Drive ni puede escribir nada: solo lee lo que esa función ya entrega, así no puede divergir de la página.
//
// Límites: 4 vueltas de herramienta por pregunta, 10 mensajes de historial, 20 preguntas cada 10 min por usuario, 50 s de tope.
const API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_ROUNDS = 4;
const MAX_HISTORY = 10;
const MAX_MSG_CHARS = 2000;
const RATE_N = 20;
const RATE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 50000;

const BIZ_LABEL = { b2b2c: 'B2B2C', api: 'B2B API', html: 'B2B HTML (agencias afiliadas)' };

const SYSTEM = `Sos el analista del "Resumen semanal" del Ecosistema B2B de Despegar (B2B2C, B2B API y B2B HTML). Contestás en español rioplatense, a gente de dirección (CEO, CFO, Chiefs): directo, con números y la conclusión primero.

Reglas:
- Todo número sale de la herramienta consultar_resumen. Si no está en lo que devolvió, decilo; nunca inventes ni estimes cifras. Si hace falta otra semana o mes, volvé a llamar a la herramienta.
- Los montos son USD nominales. GB = gross bookings, NR = net revenue, FVM = fee / valor marginal. "Brecha vs Budget" = actual − Budget (en USD) y en % sobre el Budget en valor absoluto. YoY = vs LY (misma semana ISO del año anterior). RR = Run Rate. L4W = promedio de las 4 semanas anteriores; L3M = de los 3 meses anteriores.
- Los actuals vienen a tipo de cambio Budget (organic) salvo que el extracto diga lo contrario; mencioná si hay un aviso de datos (organic.error, monedas sin mapear).
- Para "cómo se viene cerrando la brecha" usá la serie semanal (trend: 13 semanas con actual, Budget y LY): contá la brecha semana a semana, decí si se achica o se agranda, la tendencia y el promedio reciente. Mostrá la serie en una tabla corta.
- Formato: Markdown simple (negritas, listas, tablas chicas). Montos en USD K o M con 1 decimal. Sin preámbulo ni cierre de cortesía. Cerrá con 1 línea de qué mirar si hay un desvío relevante.
- Si la pregunta no se puede contestar con estos datos (otro negocio, P&L contable, causas comerciales que no están), decilo en una línea y proponé qué sí podés mostrar.`;

const TOOLS = [{
  name: 'consultar_resumen',
  description: 'Trae el extracto del Resumen semanal para B2B2C, B2B API y B2B HTML: serie semanal de 13 semanas (actual, Budget, LY de GB / NR / FVM), la semana elegida por país contra Budget, LY, Run Rate y L4W, el MTD del mes y la vista mensual (serie del año, mes elegido por país, L3M). Sin parámetros: última semana cerrada.',
  input_schema: {
    type: 'object',
    properties: {
      semana: { type: 'string', description: "Semana ISO 'AAAA-Www' (una de las últimas 8 cerradas). La serie de 13 semanas termina en esta." },
      mes_mtd: { type: 'string', description: "Mes del MTD 'AAAA-MM' (uno de los últimos 4)." },
      mes_cerrado: { type: 'string', description: "Mes de la vista mensual 'AAAA-MM' (uno de los últimos 6 cerrados)." },
    },
  },
}];

const k = (n) => Math.round((n || 0) / 1000);   // USD → miles: el extracto va en USD K para gastar menos tokens
const trio = (o) => ({ gb: k(o && o.gb), nr: k(o && o.rev), fvm: k(o && o.fvm) });
const byPais = (m) => { const o = {}; Object.keys(m || {}).forEach((p) => { o[p] = trio(m[p]); }); return o; };

// Del payload de getResumenSemanal (grande: unidades, días, rachas) deja lo que sirve para contestar, en USD K.
function digest(res) {
  const biz = {};
  Object.keys(res.biz || {}).forEach((key) => {
    const b = res.biz[key];
    const m = b.monthly || {}, d = b.mtd || {};
    biz[BIZ_LABEL[key] || key] = {
      serie_semanal_total: (b.trend || []).map((w) => ({ sem: `${w.year}-W${String(w.week).padStart(2, '0')}`, lunes: w.from, actual: trio(w.cur), budget: trio(w.bud), ly: trio(w.ly) })),
      semana_por_pais: { actual: byPais(b.cur), budget: byPais(b.bud), ly: byPais(b.ly), run_rate: byPais(b.rr), l4w: byPais(b.l4w) },
      mtd_por_pais: { actual: byPais(d.cur), budget_a_la_fecha: byPais(d.bud), ly: byPais(d.ly), run_rate: byPais(d.rr), budget_mes_completo: trio(d.budMonth) },
      mensual: {
        serie_total: (m.trend || []).map((x) => ({ mes: x.ym, actual: trio(x.cur), budget: trio(x.bud), ly: trio(x.ly) })),
        mes_por_pais: { actual: byPais(m.cur), budget: byPais(m.bud), ly: byPais(m.ly), run_rate: byPais(m.rr), l3m: byPais(m.l3m) },
      },
      coi_brasil_fvm: b.coi ? { semana: { actual: k(b.coi.w.cur), budget: k(b.coi.w.bud) }, mtd: { actual: k(b.coi.m.cur), budget: k(b.coi.m.bud) }, mes: { actual: k(b.coi.mo.cur), budget: k(b.coi.mo.bud) } } : undefined,
    };
  });
  return {
    unidades: 'USD miles (K)',
    semana_elegida: `${res.week.year}-W${String(res.week.week).padStart(2, '0')} (${res.week.from} a ${res.week.to})`,
    semanas_disponibles: (res.weeks || []).map((w) => `${w.year}-W${String(w.week).padStart(2, '0')}`),
    mtd: { mes: res.month.ym, hasta: res.month.to, meses_disponibles: res.months },
    mensual: { mes: res.monthly.ym, meses_cerrados_disponibles: res.cmonths },
    ultimo_dia_con_reales: res.lastActualsDate,
    datos_generados: res.generatedAt,
    coi_brasil_excluido: !!res.exCoiBr,
    organic: res.organic && res.organic.target ? { actuals_a_tc: res.organic.target, aviso: res.organic.error, paises_sin_mapear: res.organic.missing } : { aviso: res.organic && res.organic.error },
    negocios: biz,
  };
}

function paramsFrom(input) {
  const p = {};
  const w = /^(\d{4})-W(\d{1,2})$/.exec(String(input.semana || ''));
  if (w) { p.year = +w[1]; p.week = +w[2]; }
  if (/^\d{4}-\d{2}$/.test(String(input.mes_mtd || ''))) p.month = input.mes_mtd;
  if (/^\d{4}-\d{2}$/.test(String(input.mes_cerrado || ''))) p.mo = input.mes_cerrado;
  return p;
}

function cleanMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = raw.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }));
  while (out.length && out[0].role !== 'user') out.shift();   // la API exige que arranque el usuario
  return out;
}

function createResumenAgent({ secrets, fetchData, fetchFn, log = () => {} }) {
  const doFetch = fetchFn || ((...a) => fetch(...a));
  const hits = new Map();   // usuario -> marcas de tiempo
  const cfg = () => (typeof secrets === 'function' ? secrets() : secrets) || {};
  const enabled = () => !!cfg().ANTHROPIC_API_KEY;

  function allow(user) {
    const now = Date.now(), arr = (hits.get(user) || []).filter((t) => now - t < RATE_MS);
    if (arr.length >= RATE_N) { hits.set(user, arr); return false; }
    arr.push(now); hits.set(user, arr);
    return true;
  }

  async function call(body, signal) {
    const r = await doFetch(API, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-api-key': cfg().ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || `Anthropic HTTP ${r.status}`), { status: r.status === 429 ? 429 : 502 });
    return j;
  }

  // context: { view, week, month, mo, lob } = lo que la persona tiene abierto en la página (solo orienta; los datos salen de la herramienta)
  async function ask({ messages, context, user }) {
    if (!enabled()) throw Object.assign(new Error('El agente no está configurado (falta ANTHROPIC_API_KEY en los secrets de la app).'), { status: 503 });
    const msgs = cleanMessages(messages);
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw Object.assign(new Error('Falta la pregunta.'), { status: 400 });
    if (!allow(user || '?')) throw Object.assign(new Error('Demasiadas preguntas seguidas: probá de nuevo en unos minutos.'), { status: 429 });

    const ctx = context && typeof context === 'object' ? context : {};
    const system = SYSTEM + `\n\nLa persona tiene abierta la página en: ${['vista', 'semana', 'mes', 'mensual', 'negocio'].map((n, i) => { const v = ctx[['view', 'week', 'month', 'mo', 'lob'][i]]; return v ? `${n} ${String(v).slice(0, 20)}` : ''; }).filter(Boolean).join(', ') || 'la última semana cerrada'}. Hoy es ${new Date().toISOString().slice(0, 10)}.`;
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const convo = msgs.map((m) => ({ role: m.role, content: m.content }));
    const used = [];
    try {
      for (let round = 0; round <= MAX_ROUNDS; round++) {
        const j = await call({ model: cfg().ANTHROPIC_MODEL || DEFAULT_MODEL, max_tokens: 1800, system, tools: round < MAX_ROUNDS ? TOOLS : undefined, messages: convo }, ac.signal);
        const uses = (j.content || []).filter((b) => b.type === 'tool_use');
        if (j.stop_reason !== 'tool_use' || !uses.length) {
          const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
          log({ level: 'info', msg: 'resumen-agent', user, rounds: round, tools: used.length });
          return { answer: text || 'No pude armar una respuesta.', consultas: used };
        }
        convo.push({ role: 'assistant', content: j.content });
        const results = [];
        for (const u of uses) {
          const p = paramsFrom(u.input || {});
          used.push(p);
          let out;
          try {
            const res = await fetchData(p);
            out = res && res.success ? { content: JSON.stringify(digest(res)) } : { content: `Error: ${(res && res.error) || 'sin datos'}`, is_error: true };
          } catch (e) { out = { content: `Error: ${e.message}`, is_error: true }; }
          results.push({ type: 'tool_result', tool_use_id: u.id, ...out });
        }
        convo.push({ role: 'user', content: results });
      }
      throw Object.assign(new Error('La consulta se hizo muy larga: probá una pregunta más puntual.'), { status: 502 });
    } catch (e) {
      if (e.name === 'AbortError') throw Object.assign(new Error('Tardó demasiado: probá de nuevo o con una pregunta más puntual.'), { status: 504 });
      throw e;
    } finally { clearTimeout(timer); }
  }

  return { ask, enabled };
}

module.exports = { createResumenAgent, digest, paramsFrom, cleanMessages };
