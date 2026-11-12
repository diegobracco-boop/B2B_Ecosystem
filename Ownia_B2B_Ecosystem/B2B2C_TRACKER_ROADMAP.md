# B2B2C Tracker — hoja de ruta (2026-11-10)

Objetivo: que el Tracker le sirva al **director comercial** y al **ejecutivo de cuenta** para decidir, no solo para mirar.
Cada vista tiene que terminar en: **oportunidad cuantificada → acción → responsable → medición del impacto**.

Hoy (hecho): portada para el Chief, one pager por país, Lectura automática, puente de drivers (LMDI), mix de productos
(mix vs precio / mix vs conversión), ranking de partners con "qué lo mueve", funnel de tráfico, comparaciones vs LY /
tendencia / período anterior y acumulado FY.

---

## 1. Partner one pager (consolidar todo por cuenta)

La unidad de decisión del ejecutivo de cuenta es el partner. Un one pager por partner con:

| Bloque | Qué responde | Fuente | Estado |
|---|---|---|---|
| **P&L completo** (GB → NR → FVM, todas las líneas: UFI, fees, descuentos, COI, CCP, white labels, intercompany, efecto financiero…) vs Budget / RR / LY | ¿Cuánto gana la cuenta y por qué línea se va el margen? | Managerial B2B2C (`_actuals_gestional.json` → `b2b2c.ac/ly/bgt/rr/fc`, por país × partner × producto × mes, 29 métricas) | **Disponible** |
| Profit sharing (Banco de Chile, TurismoCity, Naranja) | ¿Cuánto se lleva el partner y cuánto queda? | Ya en la query del Managerial (`white_labels_api` incluye el profit sharing) + app `pnl-hispa` | Disponible (reusar lógica) |
| Funnel, conversión por producto, ticket, mix | ¿Dónde se cae la venta? | Tracker actual (filtro partner) | **Disponible** |
| Compradores únicos y recurrencia | ¿Crecemos por clientes nuevos o por los mismos? | Daily `unique_buyers` (por partner y mes) | **Disponible** |
| Canje de puntos / millas | ¿Qué parte se paga con millas y cómo rinde? | Managerial `ac_mi` (GB y orders con millas, por partner) | **Disponible** |
| Director comercial | ¿De quién es la cuenta? | Daily `director_by_partner` | **Disponible** |
| Tier, Hunting / Farming, pipeline, KRs | Contexto comercial | Daily (tier, account_type), Pipeline Hunting, OKR | Disponible |
| Cuotas y medio de pago | ¿Vendemos con las cuotas que ofrece el mercado? | `data.analytics.mkt_users_fact_payments` (`dues`) y `prd_payment_methods_fact` | **Requiere query nueva** (acceso OK) |
| Banco emisor / nivel de tarjeta | ¿Qué tarjetas usan? ¿Los clientes del banco compran con su tarjeta? | `data.analytics.mkt_users_dim_payments` (bank, tier, bin) | **Sin acceso**: pedir permiso (tabla con BIN) |

## 2. Benchmark entre cuentas (peer group)

Comparar cada partner contra sus pares (mismo país y tier, o mismo tipo: banco / aerolínea / retail / fintech) en:

- **Mix de productos y monoproducto**: share de vuelos, hoteles, paquetes, autos, asistencia, servicios en destino.
  Ejemplos FY27: ITAU 100% vuelos (64K orders), TurismoCity 99% vuelos, Livelo-API 100% vuelos, BBVA 76% vuelos, YaVas 82% paquetes.
  (Verificar si ITAU / Livelo-API son integraciones API, donde el monoproducto es por diseño.)
- **Conversión por producto** (búsqueda → booking) y **ticket por producto**.
- **Take rate (NR/GB) y margen (FVM/GB)** por producto: ¿qué cuentas venden con más descuento o más costo financiero?
- **Canje**: % del GB pagado con millas / puntos.
- **Cuotas**: distribución (1, 3, 6, 12, 18…) y costo de cuotas (COI) sobre GB.
- **Medio de pago**: crédito / débito / PIX / financiado / efectivo (oct-26: 71% de las transacciones B2B2C con tarjeta de crédito).
- **Plataforma y fuente del tráfico**: app / desktop / mobile; deeplinks, Insider, Discount Booster (`bi_web_traffic`, ya usado en OKR Producto).
- **Recurrencia** (compradores únicos / orders).

Visual: cada métrica con el partner, la mediana de pares y el mejor de pares (posición en el ranking), en verde / rojo.

## 3. Oportunidades cuantificadas (el corazón para decidir)

Cada brecha contra pares se traduce en USD con una fórmula simple y explícita:

| Oportunidad | Fórmula (por partner, período) |
|---|---|
| **Cross-sell de producto** (monoproducto o producto débil) | orders del partner × (share del producto en pares − share propio) × NR por order del producto (de pares) |
| **Conversión** | búsquedas del producto × (conversión mediana de pares − propia) × NR por booking |
| **Ticket / descuentos** | orders × (take rate de pares − propio) × GB por order |
| **Cuotas** | GB × (share de 6+ cuotas en pares − propio) × uplift de ticket observado con cuotas (validar con Comercial) |
| **Canje** | usuarios con canje × (share de pares − propio) × NR por order con canje |

Salida: **ranking de oportunidades** por cartera (director) y por cuenta, con "USD potencial por año", la palanca y la acción sugerida.
Ejemplo de texto: "BBVA: si llegara al share de hoteles de sus pares (X%), +USD Y de NR por año. Acción: activar hoteles en home y campaña con cuotas".

## 3b. Moonshot 3x: ¿con qué partner pensamos en triplicar? (2026-11-10)

Tamaño de la cuenta = **alcance × conversión × amplitud × valor**. Para cada partner, el techo de cada palanca contra sus pares,
multiplicado: si el producto de los techos llega a 3x, es candidato a moonshot, y la palanca más grande dice qué hay que hacer.

| Palanca | Techo | Dato |
|---|---|---|
| Alcance (qué parte de la base del partner busca viajes con nosotros) | penetración del mejor par | **Falta el tamaño de la base** (clientes / socios / tarjetas): carga manual de Comercial |
| Conversión por producto | p50 (conservador, tope 2x la propia) / p75 (moonshot) de pares del país | tráfico ✓ |
| Amplitud (cross-sell) | share por producto p50 / p75 de pares | Managerial ✓ |
| Valor (ticket, NR por order, recurrencia) | pares | ✓ |

Primera pasada (FY27 abr–oct, NR del Managerial; solo conversión + cross-sell, sin alcance; pares = mismo país):
- Total: NR $63,8M; techo conservador +$37,5M (+59%), moonshot +$134M (+210%).
- **Moonshot por conversión** (mucho tráfico, conversión baja vs pares): Latam (2,0x conservador / 5,8x p75), Liverpool (1,8x / 3,6x),
  Viajes Naranja (1,75x / 2,2x), Didi, Rakuten, Mastercard, Nubank. Ojo: Latam y Didi tienen audiencias distintas a bancos y programas de
  puntos; los pares por tipo de partner van a bajar ese techo.
- **Moonshot por amplitud** (monoproducto): ITAU (100% vuelos, 1,6x conservador / 2x), TurismoCity (100%, 1,7x / 2x), Livelo-API (API, 2x),
  BCI, BBVA (76% vuelos, 1,2x / 1,55x).
- **Moonshot por alcance**: bancos y programas grandes con base masiva (BBVA, Itaú, Livelo, Liverpool, Banco de Chile…): no se puede medir
  hasta tener el tamaño de la base. Probablemente la palanca más grande para llegar a 3x.

**Hecho (2026-11-10)**: pestaña "Moonshot 3x" del Tracker con las tres palancas (alcance con las bases del Excel "B2B2C_Data Histórica", provisorio). Resultado inicial: 11 cuentas con techo ≥ 3x (hoy $23,9M de NR anual; +$29M realista / +$222M moonshot); la mayor, Itaú Brasil (1,1 orders por año cada 1.000 clientes contra 11 del p75 de su industria). A validar con los equipos: bases que son tráfico web (Liverpool, Didi, YaVas, WL Hotels, WL Varios, Bonda, AVASA, Xcaret, Latam MX), Sicoob (100M vs "10 Milhões"), redes de tarjetas, duplicados y faltantes (Banco de Chile, Caixa).

**Rehecho (2026-11-12, Diego)**: el moonshot parte de los **usuarios del tráfico** (el mejor dato que tenemos de cada cuenta) en vez de las bases de clientes: techo = NR por usuario de los pares del país. Pestaña "Cartera" con cuadrantes (Estrellas / Apuestas / Maduras / Despriorizar) y perfil comercial (comisión % GB o profit sharing, canje, monoproducto y verticales a sumar). Primera corrida (FY27 abr–oct): 6 estrellas ($41M de NR anual: Latam BR / CL / PE, YaVas, Viajes Naranja, BBVA CO), 16 apuestas, 10 maduras ($52M), 13 a despriorizar y 4 sin tráfico (API). Pendiente: alcance contra la base real del partner cuando Comercial la valide.

Vista propuesta: matriz "techo vs tamaño actual" (burbuja = NR) con los candidatos a 3x arriba a la derecha, y por partner el árbol
de palancas (cuánto aporta cada una al 3x) con la acción y el dueño.

## 4. Plan de acción y medición de impacto

- **Registro de acciones** por partner: acción, palanca (tráfico / conversión / mix / ticket / cuotas / canje), responsable, fecha de inicio,
  KPI objetivo y línea de base (se toma sola del Tracker al cargar la acción). Guardado en la app (notas por módulo, como el Flow).
- **Medición del impacto**: antes / después de la fecha de inicio contra un control (pares del mismo país, o B2C del mismo país):
  diferencia en diferencias sobre el KPI de la palanca, y su traducción a USD de NR / FVM. Estado: en curso / funcionó / no funcionó.
- En la portada: "acciones en curso y su impacto acumulado" por director.

## 5. Comparación con B2C

- **Clientes compartidos** (`social_id` en `mkt_users_fact_payments`): de los compradores de una WL, cuántos también compran en B2C, y
  **qué compran en B2C que no compran en la WL** (producto, destino, ticket, cuotas). Accesible hoy.
- **Clientes del banco en B2C** (p.ej. tarjetas BBVA comprando en Despegar B2C vs en la WL BBVA): requiere banco emisor
  (`mkt_users_dim_payments`, **sin acceso**). Es la comparación más potente para el ejecutivo de cuenta: "tu base ya compra viajes con nosotros por otro canal".
- **B2C como grupo de control** de mercado (ya está el benchmark en el Daily): si B2C cae igual, es mercado; si no, es la cuenta.

## 6. Vistas por usuario

- **Mi cartera** (director comercial): portada filtrada por sus partners (`director_by_partner`), con el ranking de oportunidades y
  las acciones en curso.
- **Ejecutivo de cuenta**: entra directo al one pager de su partner.
- **Chief**: la portada actual + "top 5 oportunidades del negocio" + acciones con impacto.

## 7. Contexto de mercado

Calendario de eventos (feriados, Hot Sale / Black Friday / Cyber por país, elecciones, devaluaciones) como marcas en los evolutivos
(base: Industry events del Daily); tipo de cambio (Organic); demanda de la industria (Google Trends / ANAC) como referencia externa.

---

## Fases propuestas

| Fase | Contenido | Datos | Esfuerzo |
|---|---|---|---|
| **1** | Partner one pager: P&L completo vs Budget/RR/LY + funnel + mix + compradores únicos + canje + director. Vista "Mi cartera". Benchmark de mix y monoproducto con **oportunidad de cross-sell en USD** | Todo disponible | Medio |
| **2** | Pagos: cuotas y medio de pago por partner (query nueva a "Actualizar reales") + benchmark de conversión, take rate y margen con oportunidades en USD | Query nueva, acceso OK | Medio |
| **3** | Registro de acciones + medición del impacto (antes / después vs control) en one pager, cartera y portada | Notas de la app | Medio |
| **4** | Clientes compartidos WL ↔ B2C (`social_id`) y qué compran en B2C | Query nueva, acceso OK | Medio |
| **5** | Banco emisor y nivel de tarjeta; clientes del banco en B2C | **Pedir acceso** a `mkt_users_dim_payments` | Bajo, una vez con acceso |
| **6** | Eventos de mercado en los evolutivos; fuente del tráfico | Industry events, `bi_web_traffic` | Bajo |

## Pendientes / preguntas abiertas

- Pedir acceso a `data.analytics.mkt_users_dim_payments` (banco, tier y BIN de la tarjeta) para el usuario del Datalake del pipeline.
- Definir con Producto B2B2C los pasos del funnel (checkout > PI) y bookings vs orders.
- Peer groups: ¿país + tier, o tipo de partner (banco / aerolínea / retail / fintech)? Hay `cluster` y `type_of_white_label` en `b2b_dim_partners`.
- Supuestos de las oportunidades (p.ej. uplift por cuotas) a validar con Comercial antes de mostrarlos como USD.
- Quién carga y cierra las acciones (¿ejecutivo de cuenta?) y cada cuánto se revisan (¿Flow semanal?).
