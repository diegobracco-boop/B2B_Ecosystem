---
name: process-quality-audit
description: Auditoría de calidad de procesos (no de código) de un módulo o de todo el repo B2B Ecosystem — orden, claridad, escalabilidad, integridad y eficiencia de cómo se ejecutan los flujos de trabajo (rebuild, promote-month, sync diaria, deploy). Usar antes de cambiar un proceso manual, al sumar un módulo o usuario nuevo, o cuando el usuario pida "revisar procesos", "¿esto escala?", "¿es claro este flujo?".
---

# Process Quality Audit — B2B Ecosystem

Auditoría de todo el repo o de un proceso/módulo puntual, en cinco ejes independientes. A diferencia de `code-audit` (calidad del código, integridad de datos, credenciales, consistencia pipelines↔landings), esta skill audita el PROCESO alrededor del código: cómo alguien ejecuta, documenta y mantiene el trabajo día a día.

## 0. Definir alcance

Si el usuario no lo dijo: todo el repo, o un proceso puntual (rebuild de `Inputs_Planning_PnL`, sync diaria de `Daily_Dashboard`, ciclo `clasp push`+`clasp deploy` de una landing, onboarding de un usuario nuevo del equipo).

Leer `CLAUDE.md` (raíz y del módulo), `CONTEXT-MAP.md`, y cualquier `CONTEXT.md`/`SETUP.md`/`README` — ahí está el proceso documentado. Si no hay documentación del proceso, eso ya es un hallazgo del Eje 2 (Claridad).

## Eje 1 — Orden y estructura

- ¿Los pasos de un proceso están en un orden explícito y reproducible (script único, `.bat`, comando de skill), o dependen de que la persona recuerde la secuencia correcta (ej. "primero corré X, después acordate de Y")?
- Nombres de comandos/scripts consistentes entre módulos que hacen lo mismo (ej. todas las landings deployan con `clasp push` desde su carpeta — ¿alguna tiene un paso distinto sin razón documentada?).
- Pasos ad-hoc que solo una persona sabe hacer (buscar comentarios tipo "preguntale a fulano", rutas hardcodeadas a la máquina de una sola persona — ver `Daily_Dashboard/SETUP.md` y el Task Scheduler mencionado en `CONTEXT-MAP.md`, que hoy corre en la máquina de Gregorio).

## Eje 2 — Claridad

- ¿Una persona nueva del equipo (`CLAUDE.md` lista: gregorio.minetti, diego.bracco, tiago.harari, tomas.rombola, antonella.difranco) podría ejecutar el proceso completo leyendo solo la documentación del repo, sin preguntar?
- Procesos que existen pero no están escritos en ningún `CLAUDE.md`/`CONTEXT.md`/`README` (buscar scripts o comandos mencionados en commits/código que no tienen doc equivalente).
- Mensajes de error o de consola que no explican qué hacer (ej. un `sys.exit` con un mensaje técnico sin la acción correctiva).

## Eje 3 — Escalabilidad

- Límites hardcodeados que van a romper cuando cambie el tamaño del equipo o del negocio: lista de usuarios en `CLAUDE.md`, listas de países/meses en `config.py` (ver también `RUNRATE_MONTHS`/`FORECAST_MONTHS`), rutas a `credenciales/.env.<nombre>` por persona.
- ¿Agregar un país, un mes de corte, o una persona al equipo requiere tocar código en varios lugares, o un solo punto de configuración?
- Procesos manuales que ya son tediosos con el volumen actual (ej. correr `clasp push` a mano en 5 landings distintas) — señalar si ya existe (o debería existir) una forma de agruparlos.

## Eje 4 — Integridad del proceso

Este es el eje de mayor costo si falla — un paso manual salteado publica datos viejos o incorrectos sin que nadie lo note hasta días después (ya pasó: ver la regla de `clasp pull` en `CLAUDE.md` y los hallazgos de integridad de datos de `code-audit`).

- Pasos que dependen de que la persona "se acuerde" de hacer algo después de otra acción (ej. "`git push` no publica las landings, recordar `clasp push`" — ¿hay algo que lo garantice además de la memoria humana, como un check o un mensaje?).
- Automatización que existe pero está rota con fallback manual silencioso (ej. si un GitHub Action de deploy falla y el equipo compensa corriendo el comando a mano sin arreglar la automatización — verificar estado de `.github/workflows/*.yml` si existen, con `gh run list` o revisando el YAML).
- Doble fuente de verdad para la misma decisión de proceso (ej. `RUNRATE_MONTHS`/`FORECAST_MONTHS` en `config.py` vs. lo que realmente contienen `runrate.json`/`forecast.json` — ver si ya existe una verificación como `_check_month_config_` en `baseline_builder.py`, y si el patrón debería replicarse en otros pipelines que tengan el mismo tipo de configuración manual).

**Para CADA gap de integridad que encuentres, proponé el chequeo más barato que lo detectaría automáticamente** — un `grep` de nombres citados vs. archivos reales, un `assert` sobre el output, un `print("[WARN] ...")` antes de subir a Drive, un paso en el slash command. Ejemplos ya implementados en el repo que sirven de molde: `_check_month_config_` en `baseline_builder.py` (avisa si la config manual quedó desalineada con los JSON), `check_manual_refs.py` en `Manual_B2B_WLs` (grepea los `.py` citados en el manual y falla si alguno no existe). El valor del hallazgo está en el check concreto, no en "habría que tener más cuidado".

## Eje 5 — Eficiencia

- Pasos redundantes o repetidos manualmente entre módulos que podrían compartir un script/comando único.
- Tareas manuales frecuentes que son candidatas a un slash command (`/actualizar`, `/sincronizar`, `/clasp-push` ya existen — ¿falta alguno para un flujo que hoy se hace a mano seguido?).
- Tiempo/pasos desperdiciados por falta de caché o por regenerar algo que no cambió (ej. correr `--rebuild` completo cuando alcanzaría con `--promote-month`).

## Reporte final

Un heading por eje (`## Orden y estructura`, `## Claridad`, `## Escalabilidad`, `## Integridad del proceso`, `## Eficiencia`), sin mezclar ni reordenar. Cada hallazgo con el archivo/comando/paso concreto al que aplica — nunca "mejorar la documentación" sin decir cuál.

Cerrar con:
- Un resumen de una línea por eje.
- Una lista aparte de **hallazgos bloqueantes**: cualquier gap del Eje 4 que hoy dependa 100% de que una persona específica se acuerde de algo, sin ningún check ni fallback — para que el usuario los vea antes de sumar gente nueva al proceso o de cambiarlo.
