---
name: data-source-consistency-review
description: Revisión de fuentes de datos, duplicidad y homogeneidad de formato entre los pipelines del ecosistema B2B (Inputs_Planning_PnL, Daily_Dashboard, P&L_Managerial). Usar antes de sumar una fuente nueva (query, Excel, Sheet) o un JSON canónico nuevo, o cuando el usuario pida revisar duplicidad de datos, formato homogéneo, o cómo se conectan las fuentes.
---

# Data Source Consistency Review — B2B Ecosystem

Revisión de todo el repo o de un pipeline puntual, en cinco ejes. A diferencia del Eje 2 de `code-audit` (integridad de un pipeline individual: nulls, totales que cierran, idempotencia), esta skill mira ENTRE pipelines: qué fuente cruda alimenta qué, si hay solapamiento no intencional, y si el formato de salida es consistente para que cualquier landing pueda consumir cualquier JSON canónico de la misma forma.

## 0. Definir alcance

Si el usuario no lo dijo: todo el repo, o un pipeline puntual (`Inputs_Planning_PnL`, `Daily_Dashboard`, `P&L_Managerial/actuals_gestional_upload.py`).

Leer `CONTEXT-MAP.md` y el `CONTEXT.md`/`CLAUDE.md` de cada pipeline en alcance antes de revisar.

**Si el módulo en alcance NO tiene pipeline propio** (ej. `Manual_B2B_WLs` — una landing de documentación, o una landing que solo consume): no hay fuentes crudas que mapear. Adaptá el foco a **verificar la exactitud de lo que ese módulo documenta o asume sobre las fuentes de OTROS módulos** — Drive fileIds, nombres de script `.py`, nombres de JSON, tablas del Datalake — comparando cada afirmación contra el código real del módulo referenciado (leerlo, no asumir). Los ejes 2-5 aplican igual sobre esas afirmaciones.

**Chequeo transversal de staleness de documentación** (aplica a cualquier alcance): la doc del módulo (`CONTEXT.md`, docstrings, comentarios, el manual) ¿describe el estado ACTUAL? Buscar: bugs marcados como "pendiente / sin corregir" que ya se arreglaron, scripts renombrados que la doc todavía llama por el nombre viejo, IDs de Drive/deployment cambiados, "TODO" ya hechos. Un dato que induce a error operativo es tan grave como un bug de datos.

## Eje 1 — Mapeo de fuentes

Para cada pipeline en alcance, documentar (leyendo el código, no asumiendo):
- **Fuente cruda**: tabla/query del Datalake (ODBC), path de Excel/CSV, ID+tab de Google Sheet.
- **Salida**: nombre del JSON canónico y su `fileId`/carpeta en Drive.
- **Transformación clave**: homologación, exclusiones, agregaciones que aplica antes de publicar.

Este repo tiene dos familias de pipeline con fuentes distintas — no asumir que comparten dato crudo:
- **Contable**: `Inputs_Planning_PnL` — planas CSV de OneDrive + Excel de actuals → JSONs canónicos (budget/forecast/runrate/lastrunrate/actuals/baseline).
- **Gestional**: `Daily_Dashboard` y `P&L_Managerial/actuals_gestional_upload.py` — queries directas al Datalake Treasure Data (ODBC).

## Eje 2 — Duplicidad de datos

- ¿Hay dos pipelines calculando el MISMO concepto (ej. actuals de un mes, gross bookings de un país) de fuentes o lógicas distintas, en vez de que uno consuma el output canónico del otro? Esto es esperable entre contable/gestional (son vistas distintas a propósito), pero señalar si dentro de la MISMA familia hay recálculo redundante.
- ¿Dos builders leen la misma tabla del Datalake con queries casi idénticas que podrían ser una sola función compartida (riesgo: si un día hay que agregar un filtro, alguien actualiza una copia y se olvida de la otra)?
- JSONs canónicos que quedaron duplicados o con nombres muy similares (ej. una versión vieja no borrada de Drive que alguna landing todavía podría estar leyendo por error).

## Eje 3 — Formato homogéneo

- Todos los JSON canónicos de la familia "contable" deben respetar el mismo esquema `{meta:{concepto,filas,fechas}, cols:[...], rows:[[...]]}` (ver `COLS_OUT`/`GROUP` en `baseline_builder.py` como referencia). Señalar cualquier builder que se desvíe (columnas de más/menos, orden distinto, nombres distintos para el mismo concepto — ej. "Pais" vs "País", "Monto USD" vs "USD").
- Tipos de dato consistentes por columna entre builders (ej. `Fecha` siempre como string `YYYY-MM-DD`, `Monto USD` siempre `float` redondeado a 2 decimales — ver `round(2)` en `build_actuals_json`).
- Convenciones de nombres de escenario consistentes entre `Codigo_contable_epm.js` (`ac`/`rr`/`bg`/`fc`/`lrr`/`ly`) y como se llaman esos mismos conceptos en los builders Python — señalar si divergen.

## Eje 4 — Fechas (eje de alto riesgo — ya rompió producción)

Bug ya confirmado en este repo: `pd.to_datetime(serie, format="mixed", dayfirst=True)` cambia silenciosamente día/mes cuando la fecha viene en formato ISO (`YYYY-MM-DD`) y el día es ≤12 — corrompió `Daily_Dashboard/daily_sync.py` (ya corregido con `_parse_fecha_budget`) y sigue presente sin corregir en `P&L_Managerial/actuals_gestional_upload.py:1009` (el usuario decidió posponer ese fix — no lo reabras salvo que el usuario lo pida).

- Grepear `format="mixed"` combinado con `dayfirst=True` (o cualquier parseo de fecha ambiguo) en TODO el repo, no solo el módulo en alcance — es el patrón de bug de mayor costo confirmado acá.
- Verificar que cualquier builder nuevo o tocado que parsee fechas de Excel/CSV maneje explícitamente el caso ISO vs. `DD/MM/YYYY` en vez de confiar en autodetección.
- Confirmar que `Inputs_Planning_PnL` sigue sin el patrón (verificado limpio en una auditoría anterior) — no asumir que sigue así, re-grepear.

## Eje 5 — Trazabilidad (lineage)

- Para cada JSON canónico, ¿está claro en `CONTEXT-MAP.md` o el `CLAUDE.md`/`CONTEXT.md` del módulo qué pipeline lo produce y qué landing(s) lo consumen? Señalar JSONs "huérfanos" (nada los lee) o landings que leen un JSON sin que quede documentado de dónde sale.
- El diagrama de `CONTEXT-MAP.md` muestra ambos pipelines alimentando "Google Drive" de forma simétrica — verificar si sigue reflejando la realidad (ej. si `P&L_Managerial` de hecho combina JSONs canónicos de `Inputs_Planning_PnL` con actuals gestionales propios, eso es una fuente MIXTA que el diagrama actual no distingue — señalarlo si el código lo confirma).
- Fase 2 mencionada en `CONTEXT-MAP.md` ("repuntear las landings a los JSONs canónicos como fuente única"): verificar cuánto de esa migración sigue pendiente, con evidencia de código (qué `Codigo.js` todavía lee de una fuente propia en vez del canónico).

## Reporte final

Un heading por eje (`## Mapeo de fuentes`, `## Duplicidad de datos`, `## Formato homogéneo`, `## Fechas`, `## Trazabilidad`). Hallazgos con archivo+línea; para duplicidad, señalar los dos pipelines/queries involucrados explícitamente.

Cerrar con:
- Un resumen de una línea por eje.
- Una lista aparte de **hallazgos bloqueantes**: cualquier duplicidad que pueda hacer divergir números entre landings, o cualquier riesgo de corrupción de fecha/formato — para que el usuario los vea antes de sumar una fuente nueva o publicar un JSON canónico nuevo.
