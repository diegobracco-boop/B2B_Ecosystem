---
name: caja-de-preguntas
description: Receta para una caja donde el usuario escribe o dicta lo que quiere ver, en su idioma, y la app lo lleva al tablero y a la vista (o acomoda los filtros de la pantalla). Determinista, sin LLM. Usar al sumar frases o destinos al buscador de la portada de Ownia ("¿Qué querés ver?"), al agregar una caja de este tipo en otra pantalla, o al revisar las preguntas registradas para mejorar el intérprete.
---

# Caja de preguntas: escribir o dictar lo que se quiere ver

Adaptada el 2026-10-30 de una guía externa (Flask + JS) al ecosistema B2B. Acá hay **dos** cajas con el mismo patrón:

| Caja | Qué hace | Archivo |
|---|---|---|
| Buscador de la portada, "¿Qué querés ver?" | **Rutea**: lleva al tablero y a la vista | `Ownia_B2B_Ecosystem/public/portal-ask.js` |
| Barra "Filtrar…" del P&L Dashboard | **Filtra** la pantalla | `Ownia_B2B_Ecosystem/public/hub-layout.js` (`planQuery` / `applyPlan`) |

Las dos usan el mismo diccionario de filtros: `public/filter-aliases.js` (`window.OwniaFilters`: países, LoB, períodos, comparación, producto y canal). **Un sinónimo de país o de LoB se suma ahí, una sola vez.**

## 1. Qué es y qué NO es

No es un chatbot y no llama a ningún modelo. Es un intérprete determinista que corre en el navegador:

- responde al instante y no cuesta nada por pregunta;
- no inventa nada: si no entiende, lo dice y no manda a ningún lado;
- nunca muestra un número: solo lleva a la pantalla que ya lo muestra bien.

## 2. Las piezas (portada)

```
texto o dictado → fixVoice → parse(texto, partners) → r (intención neutra) → route(r, dest) → destinos → caja
```

1. **`fixVoice`** corrige lo que el dictado escribe como suena: "bitubi" → B2B, "be dos be dos ce" → B2B2C, "badget" → budget, "pi and el" → P&L, "o ka erre" → OKR, "tocan" → Toqan, "deili" → daily. Los patrones más largos van primero.
2. **`parse`** devuelve una intención neutra y **no sabe qué tableros existen**. Tiene estos campos:
   - `topics`: daily, contable, managerial, okr, presentacion, rolling…
   - `freq`: semanal, mensual o trimestral.
   - Los filtros que saca `OwniaFilters`: `lob`, `paises`, `periodo`, `goal`, `producto`, `canal`.
   - `partner`: el nombre de un partner real.
   - `unknown`: las palabras que no usó.
3. **`route`** es el adaptador: decide a qué tablero y vista va, con qué parámetros, y qué no puede aplicar (eso va a `notes`). Es el único lugar que sabe qué link entiende cada tablero:

| Tablero | Parámetros |
|---|---|
| Daily | `?tab=benchmark\|weekly\|flow\|tracker\|industry`, `?lob=b2b\|b2b2c`, `?pais=`, `?partner=` |
| P&L Dashboard (Hub) | `?q=<filtros>` (se aplica como la barra "Filtrar…") y `?sec=detailcountry\|h2h1\|okr` |
| P&L Accounting | `?view=contable-combined\|contable-b2b\|contable-b2b2c` |
| P&L Managerial | `?view=b2b\|b2b2c\|vsacc` |
| Presentaciones | `?view=semanal\|mensual\|cierre\|builder` |
| OKR | `?view=q\|m` |
| Manual | `?view=gantt` |

4. **`dest`** lo arma el servidor según quién mira (`server/index-page.js`, `askDest`). `own: true` quiere decir que es la versión de Ownia y entiende los parámetros. Si no, se abre el link tal cual (Apps Script u otra app) y los filtros se avisan. Ejemplo: el P&L Dashboard de Ownia es solo de `EQUIPO_B2B`. Al resto, "cierre contable" lo lleva a P&L Accounting, que está abierto a cualquier @despegar.com.

5. **Partners:** se sacan de los datos reales (`daily_b2b2c_data.json` del espejo, `server/portal-ask-data.js`), no de una lista escrita a mano. Los que también son palabras comunes (Claro, Latam, Macro, Visa…) cuentan solo si están escritos con mayúscula.

## 3. Reglas que no se negocian

1. **Lo que no se puede aplicar, se dice.** Cada destino lleva en `notes` lo que la persona pidió y ese tablero no toma desde el link ("Elegí en el tablero: País (Brasil)"). Nunca se descarta en silencio.
2. **Si no entendió nada, no propone nada.** Muestra la pista y las sugerencias.
3. **Entender ≠ poder aplicar.** `understood` (el intérprete sacó algo) y el destino elegido se registran por separado.
4. **El orden de los temas importa.** Lo más específico va primero, y lo que matchea se saca del texto: "fvm negativo" antes que "fvm", "cierre de mes" antes que "cierre", "industry events" antes que "industry", "h2 vs h1" antes de que "h2" se lea como período.
5. **Nombrar algo al pasar no es pedirlo.** "Run rate" solo, o con "rolling" o "automático", lleva a Rolling Projections. Junto a otro tema ("daily b2b vs run rate") es la comparación.
6. **Ambigüedad = opciones, no adivinanza.** Se muestran hasta 4 destinos, el mejor primero, y Enter va al primero. Por ejemplo, "semanal" ofrece Presentaciones semanal y el Weekly del Daily.
7. **No esconder los tableros de siempre.** La caja los complementa: el menú sigue igual abajo.

## 4. Registro de preguntas (obligatorio)

Cada pregunta enviada se guarda en segundo plano (`fetch` con `keepalive`; si falla, no pasa nada). El servidor también la escribe en el log de la app. Se guarda:

- el texto y si fue dictado;
- `understood` y `topics`;
- las opciones que se ofrecieron;
- `chosen`: el índice elegido, o −1 si no entendió o si apretó "Ninguna de estas";
- `dest` y `params`;
- `notes` y `unknown`.

Va al almacén de notas: módulo `portada`, scope `preguntas-AAAA-MM`.

**En vez del 👍/👎** de la guía original (acá la página se va al elegir), la señal es cuál opción eligió:

| `chosen` | Qué significa |
|---|---|
| 0 | Acertó |
| > 0 | El orden está mal |
| −1 | Falta un sinónimo o un destino |

## 5. Cómo mejorar el intérprete con las preguntas reales

1. Abrí `https://ownia.despegar.io/b2b-ecosystem/preguntas` (solo el equipo B2B; `?mes=AAAA-MM`, `&formato=json`).
2. Mirá primero las filas en rojo (sin destino) y las de "opción 2+".
3. Por cada frase que falló: **primero** agregala a `Ownia_B2B_Ecosystem/test/portal-ask.test.js` con el destino esperado, después tocá el tema en `TOPICS` (o el sinónimo en `filter-aliases.js`) hasta que pase `npm test`.
4. Si piden algo que no existe, anotalo como pedido de feature, no lo fuerces a un tablero parecido.
5. Publicar: commit → sync al repo de Ownia → redeploy (ver `Ownia_B2B_Ecosystem/CONTEXT.md`, "Flujo para publicar").

## 6. Sumar un destino nuevo

1. Que el tablero abra la vista por link (en su `layout` de Ownia, leyendo `URLSearchParams` **una vez**, sin romper si falta algo).
2. Agregar el tema en `TOPICS`, con español y portugués en la misma regex.
3. Agregar el `case` en `route`, con `notes` para lo que no aplique.
4. Agregar las frases a `portal-ask.test.js`.
5. Si el tablero es nuevo en el menú, ya aparece en `dest` solo (sale de `modules.js` / `OTHER_APPS`).

## 7. Dictado

Usa la Web Speech API: anda en Chrome, Edge y Safari, y en Firefox el botón no aparece. El idioma sale del navegador (`pt-BR` si es portugués; si no, `es-AR`). Se ve el texto mientras se habla, se manda solo al terminar, y el texto queda en el campo para corregirlo. Si hubo un error, no se manda nada. Los mensajes de error son distintos según el caso: permiso bloqueado, no se escuchó, u otro.

**Antes de prometerlo, probalo en un teléfono real.** Cuando aparezca una sigla mal dictada en el registro (las preguntas con 🎤), sumala a `VOICE_FIXES`.

## 8. Lo que no hay que hacer

- Mandar la pregunta a un LLM como primera versión. Si en un par de meses el registro muestra frases que las regex no agarran, recién ahí evaluarlo: el contrato `parse → route` no cambia.
- Poner lógica de un tablero en `parse` (`if (slug === …)` va en `route`).
- Pasar parámetros a una landing de Apps Script: no los entiende.
- Abrir un tablero restringido a quien no puede verlo: respetar `canOpen` (por eso `dest` lo arma el servidor).
