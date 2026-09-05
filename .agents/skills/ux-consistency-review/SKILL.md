---
name: ux-consistency-review
description: Revisión de estética y consistencia visual entre los dashboards del ecosistema B2B — uso de la paleta oficial Despegar, tipografía, espaciado, jerarquía visual, y consistencia de un mismo componente (selector, badge, waterfall) entre proyectos distintos. Usar antes de publicar una landing/componente nuevo o cuando el usuario pida revisar estética o proponer mejoras de UI.
---

# UX Consistency Review — B2B Ecosystem

Revisión de todos los dashboards o de uno puntual, en cuatro ejes. Esta skill no corrige HTML/CSS — devuelve hallazgos y una lista de mejoras propuestas concretas para que el usuario decida cuáles aplicar.

## Paleta oficial Despegar (referencia — no inventar otros tonos)

Códigos de Google Sheets, confirmados por Diego (2026-08-22):

**LILA** — `#550fed` (1, más oscuro) · `#3d00d1` (2) · `#976cf6` (3) · `#a780ff` (4) · `#a780ff` @44% opacity (5)
**VERDE** — `#029687` (1) · `#009999` (2) · `#a3e6dd` @38% (3) · `#ccf3ee` @33% (4) · `#adeddd` (5) · `#4bb8aa` (6)
**ROJO** — `#ff5454` (1) · `#fa503f` (2, sin alpha) · `#fbbdbd` (3) · `#fff2f2` (4)

Excepción documentada e intencional: los waterfalls de `P&L_Accounting`/`Dashboard_B2B_WLs` (`renderWaterfallChart_`) usan un verde/rojo puntual fuera de esta paleta para positivo/negativo (`#10b132`/`#e06666`) — decisión de Diego, NO marcarlo como hallazgo. Baseline/Goal de esos mismos waterfalls sí usan la paleta lila (`#550fed` Baseline, `#976cf6` Goal).

Estado conocido al momento de escribir esto (verificar si sigue así, no asumir): la paleta solo se aplicó a los waterfalls de `P&L_Accounting`/`Dashboard_B2B_WLs` y al fondo del selector de `P&L_Managerial` (`.lob-switcher` → `#D8C7FF`). El resto de la UI (tablas P&L, otros charts, badges) puede seguir usando colores genéricos previos — no hay un archivo CSS/JS compartido con la paleta como constantes, cada `dashboard.html` la define (o no) de forma independiente.

## Eje 1 — Paleta de color

- Grep por hex codes (`#[0-9a-fA-F]{6}`) y `rgba(...)` en cada `dashboard.html`/`.html` del repo. Cualquier color con función de marca (positivo/negativo, marca lila, fondo de selector) que NO esté en la paleta de arriba (ni sea la excepción documentada del waterfall) es un hallazgo.
- Uso inconsistente de significado: verde=positivo/rojo=negativo debe ser igual en todos los proyectos que muestren deltas — señalar si alguno lo invierte o usa un tercer color para lo mismo.
- Valores de color repetidos como literales en vez de variable/constante (CSS var, JS const) — si el mismo hex aparece hardcodeado en 5+ lugares del mismo archivo, es candidato a centralizar.

## Eje 2 — Consistencia entre proyectos

Para cada tipo de componente que aparece en más de un dashboard, compará implementación:

- Selector de período/escenario (Baseline/Goal, LoB switcher) — `P&L_Accounting`, `P&L_Managerial`, `Dashboard_B2B_WLs`.
- Badges de estado (OKR bueno/malo, `.okr-bad`, `.pxq-pos`/`.pxq-neg`).
- Waterfalls (`renderWaterfallChart_`, `_wfTotalDeltaPlugin_`) — ya hay 4+ implementaciones inline distintas en `Dashboard_B2B_WLs/dashboard.html` según la memoria del proyecto; verificar si convergieron o siguen divergiendo.
- Headers, tabs, tipografía de títulos.

Señalar explícitamente cuándo el mismo componente visual se ve o se comporta distinto sin que haya una razón de audiencia documentada (finance vs. comercial vs. gerencial).

## Eje 3 — Tipografía y espaciado

- Familias de fuente, tamaños de título/cuerpo, y unidades de padding/margin usadas en cada dashboard — señalar si divergen sin razón entre proyectos que deberían sentirse parte del mismo ecosistema.
- Uso de `!important`, estilos inline vs. clases — no es un hallazgo de código (eso es `auditor-de-codigo`), pero sí de mantenibilidad del diseño si dificulta aplicar la paleta de forma consistente después.

## Eje 4 — Jerarquía visual y legibilidad

- Contraste texto/fondo suficiente, especialmente con los tonos claros de la paleta (`#fff2f2`, `#ccf3ee` @33%, `#a780ff` @44%) usados como fondo — verificar que el texto encima siga siendo legible.
- Tamaños de fuente demasiado chicos para datos críticos (montos, deltas).
- Uso del color como único indicador (sin ícono/texto de apoyo) donde afecte accesibilidad (daltonismo rojo/verde es el caso típico en dashboards financieros).

## Eje 5 — Elección de gráfico y diseño de tablas

- **Tipo de gráfico correcto para el dato**: línea para series temporales (tendencia día/mes), barras para comparaciones entre categorías (países, LoB, productos), torta/dona SOLO si la composición tiene menos de 3 categorías (con más, preferir barras apiladas). Señalar cualquier chart que use el tipo equivocado para lo que muestra (ej. una torta con 6+ países, o barras para una tendencia continua donde una línea se leería mejor).
- **Diseño de tablas**: texto alineado a la izquierda, números alineados a la derecha (chequear `text-align` en celdas de dato numérico — un monto centrado o a la izquierda es más difícil de comparar entre filas). Celdas concisas — sin párrafos largos dentro de una celda.
- **Carga cognitiva**: dato o texto redundante que no aporta (el mismo número repetido en dos widgets sin razón, tooltips o leyendas que reformulan lo que el título ya dice). El criterio de referencia: alguien debería poder entender el estado de esa sección del dashboard en menos de 10 segundos — si hace falta leer varios párrafos o escanear una tabla densa para entender el KPI principal, es un hallazgo.

## Eje 6 — Plantillas de email

Alcance específico: `Daily_Dashboard/Codigo.js` (`_emailHtml_`, enviado vía `MailApp.sendEmail` con `htmlBody`) y cualquier otro reporte que se envíe por correo desde Apps Script. Las reglas de este eje son DISTINTAS a las de un dashboard web — un cliente de email no es un navegador completo.

- **Nada de flex/grid/CSS externo**: el layout tiene que ser 100% tablas HTML (`<table><tr><td>`) con estilos inline en cada elemento — Gmail y otros clientes ignoran `<link>`/`<style>` externo y muchos no soportan `display:flex`/`grid`. Si aparece cualquiera de esos dos, es un hallazgo de alto impacto (el email se puede ver roto para el destinatario).
- **Ancho fijo y fuentes web-safe**: contenedor principal con `max-width` razonable (~560-600px, el estándar de email) y fuente de la familia sans-serif del sistema (Arial/Helvetica/system-ui) — nunca una fuente custom vía `@font-face` o Google Fonts (no carga en la mayoría de los clientes).
- **Paleta usada vs. paleta oficial**: comparar los hex del email contra la paleta oficial de la sección de arriba. Si difieren (ej. un verde/rojo/lila "de semáforo" propio del email, distinto al de los waterfalls), no asumir que es un error — puede ser una decisión intencional de semántica de achievement (como ya pasó con el verde/rojo del waterfall). Señalarlo como pregunta para el usuario, no como hallazgo a corregir de una.
- **Imágenes de gráficos** (si el email embebe charts como imagen, ej. desde Drive): deben tener `max-width:100%; height:auto; display:block;` para no romper en pantallas chicas ni desbordar el ancho fijo del contenedor.

## Reporte final

Un heading por eje (`## Paleta de color`, `## Consistencia entre proyectos`, `## Tipografía y espaciado`, `## Jerarquía visual y legibilidad`, `## Elección de gráfico y diseño de tablas`, `## Plantillas de email`). Hallazgos con archivo+línea+valor concreto (no "revisar los colores").

Cerrar con una lista aparte de **mejoras propuestas**, priorizada:
- **Alto impacto**: rompe la identidad de marca o la legibilidad (color fuera de paleta en un elemento visible, contraste insuficiente).
- **Medio**: inconsistencia entre proyectos que un usuario que usa varios dashboards notaría.
- **Bajo**: pulido (espaciado, detalles tipográficos).

Cada mejora propuesta: qué cambiar, dónde (archivo+línea/selector), y a qué valor de la paleta oficial mapea (si aplica). No aplicar los cambios — son propuestas para que el usuario decida.
