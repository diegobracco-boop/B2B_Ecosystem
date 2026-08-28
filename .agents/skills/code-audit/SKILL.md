---
name: code-audit
description: Auditoría completa de un módulo o de todo el repo B2B Ecosystem — calidad de código, integridad de datos en los pipelines, seguridad de credenciales y consistencia entre pipelines y landings. Usar antes de un /clasp-push, antes de /actualizar, después de cambios grandes, o cuando el usuario pida "auditar", "revisar todo", "chequear integridad".
---

# Code Audit — B2B Ecosystem

Auditoría de todo el repo o de un módulo específico, en cuatro ejes independientes. A diferencia de `code-review` (que compara un diff contra un fixed-point y un spec de PR), esta skill no necesita un punto de comparación: audita el estado actual del código tal como está.

Correr los cuatro ejes como **sub-agentes en paralelo** cuando el alcance es "todo el repo", para no mezclar contexto. Si el alcance es un módulo chico, puede correrse en un solo pase.

## 0. Definir alcance

Si el usuario no lo dijo:
- Todo el repo, o
- Un módulo puntual (`Inputs_Planning_PnL`, `Daily_Dashboard`, `Dashboard_B2B_WLs`, `P&L_Accounting`, `P&L_Managerial`, `Manual_B2B_WLs`).

Leer `CONTEXT-MAP.md` y el `CONTEXT.md`/`CLAUDE.md` del módulo en cuestión antes de auditar — ahí está el contrato de datos esperado (qué JSON produce cada pipeline, qué consume cada landing).

## Eje 1 — Calidad de código

Aplica a `.py`, `.js`/`Codigo.js` (GAS), `.html`.

- **Hardcodeos**: paths absolutos de un usuario específico (ej. `C:\Users\gregorio...`), credenciales, tokens, URLs de Drive/Sheets con ID pegado en el código en vez de config.
- **Manejo de errores**: llamadas a Drive API, ODBC/Datalake, o lectura de archivos sin try/except; fallos silenciosos que producirían un JSON vacío o parcial sin avisar.
- **Duplicación**: lógica repetida entre `plana_*_builder.py` y otros builders, o entre `Codigo.js` de distintas landings que deberían compartir una función.
- **Smell baseline de Fowler** (Mysterious Name, Feature Envy, Data Clumps, Primitive Obsession, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains) — igual criterio que la skill `code-review`: siempre juicio, nunca regla dura; lo que el repo documenta gana.
- Convenciones del repo: si hay `CLAUDE.md`/`CONTEXT.md` en el módulo con reglas explícitas, son la fuente de verdad por encima del baseline.

Reportar cada hallazgo con archivo + línea + por qué importa.

## Eje 2 — Integridad de datos

Este es el eje más específico del repo — los pipelines producen los JSONs canónicos que alimentan finance y el equipo comercial. Un error acá se propaga silenciosamente a todas las landings.

Para cada pipeline tocado (`Inputs_Planning_PnL`, `Daily_Dashboard`, `actuals_gestional_upload.py`):

- **Esquema de salida**: el JSON generado, ¿tiene las mismas claves/estructura que el JSON canónico ya en Drive (o que otro builder del mismo tipo)? Señalar cualquier drift de esquema.
- **Nulls / vacíos silenciosos**: ¿hay ramas donde una fila sin match (ej. `_diag_unmapped.py` existe justamente para esto) se descarta sin loguear, en vez de fallar o reportar?
- **Totales que no cierran**: si el builder agrega/suma columnas (budget, forecast, actuals), verificar que el total del output coincida con el total de la fuente cruda (CSV/planas) dentro de una tolerancia razonable. Si hay script de validación (`_validate_vs_sheet.py`, `validate_okr_test.js`) correrlo o señalar si no se corrió.
- **Fechas y versionado**: el pipeline auto-detecta "el forecast del mes más reciente" (ver `pnl_common.py`) — verificar que esa detección no pueda tomar silenciosamente una carpeta vieja o vacía.
- **Idempotencia**: correr el pipeline dos veces con el mismo input, ¿produce el mismo output? Si sobrescribe en Drive, ¿hay riesgo de carrera si dos usuarios lo corren a la vez (mencionado en `pnl_common.py` como caso soportado)?

Reportar como: `[dato afectado] — [qué puede corromperse] — [cómo verificarlo o reproducirlo]`.

## Eje 3 — Seguridad de credenciales

- Ningún archivo trackeado por git debe contener usuario/password/token en texto plano. Grep por patrones típicos (`PASSWORD=`, `token`, `api_key`, credenciales de Datalake `@ar.infra.d`) fuera de `credenciales/`.
- Confirmar que `credenciales/`, `credentials_drive.json`, `token_drive.json` y cualquier `.env.*` estén en `.gitignore` — no asumir, chequear el archivo.
- `git status` / `git log --all --full-history -- credenciales/` para confirmar que nunca se commiteó nada de esa carpeta.
- Scopes de Drive: `pnl_common.py` usa scope completo `drive` (no `drive.file`) a propósito para que el equipo comparta archivos — no marcarlo como hallazgo, está documentado como decisión intencional.

## Eje 4 — Consistencia entre pipelines y landings

Específico de este repo por su arquitectura de dos capas (ver `CONTEXT-MAP.md`).

- Para cada landing (`Dashboard_B2B_WLs`, `P&L_Accounting`, `P&L_Managerial`, `Manual_B2B_WLs`): ¿qué JSON(s) lee su `Codigo.js`? ¿Coinciden con lo que el pipeline correspondiente produce hoy, o la landing quedó leyendo una fuente vieja/propia?
- El repo está en migración activa (Fase 2 en `CONTEXT-MAP.md`): algunas landings "todavía leen de fuentes propias" en vez de los JSONs canónicos de `Inputs_Planning_PnL`. Señalar explícitamente cuáles siguen sin migrar — es el hallazgo de mayor valor de este eje.
- Si un builder cambia el esquema de su JSON de salida, verificar que las landings que lo consumen no rompan (buscar los nombres de clave usados en `Codigo.js` vs los que realmente emite el builder).

## Reporte final

Agregar los cuatro ejes bajo headings separados (`## Calidad de código`, `## Integridad de datos`, `## Seguridad de credenciales`, `## Consistencia pipelines↔landings`). No mezclar ni reordenar entre ejes — cada uno responde una pregunta distinta y un hallazgo grave en un eje no debe tapar los demás.

Cerrar con:
- Un resumen de una línea por eje (cantidad de hallazgos, el más grave si hay).
- Una lista aparte de **hallazgos bloqueantes** — cualquier cosa en el Eje 2 o 3 que pueda corromper datos de producción o filtrar credenciales — para que el usuario los vea antes de correr `/clasp-push` o `/actualizar`.
