# Manual B2B WLs

Landing GAS que sirve el **manual técnico del ecosistema B2B**: arquitectura, flujos de datos, IDs de Drive, y procedimientos de actualización/deploy de cada módulo del repo. Se embebe dentro del Ecosystem Hub (`setXFrameOptionsMode(ALLOWALL)`).

## Stack

- **`manual.html`** — todo el contenido (una sola página, ~1500 líneas, CSS + JS inline). Navegación por secciones vía `showSection(name)` que togglea la clase `.active`.
- **`Codigo.js`** — solo `doGet()` que devuelve `manual.html`. Sin `doPost`, sin formularios, sin lectura de datos. Es 100% documentación de solo lectura.
- No tiene Python, ni JSON, ni pipeline. No consume datos de Drive ni del Datalake.

## Qué NO es

No es una herramienta de "carga manual de datos" (aunque `CONTEXT-MAP.md` lo describía así hasta 2026-09-05). No hay `<form>`, `<input>`, `<select>` ni `doPost` en ningún lado.

## Cómo mantenerlo

**El contenido se mantiene a mano.** No hay generación desde una fuente estructurada. Cuando cambia el proceso, los IDs, los nombres de script o la arquitectura de cualquier módulo, hay que actualizar `manual.html` también — no se actualiza solo.

Regla en el `CLAUDE.md` raíz: al cambiar el proceso/estructura de un módulo, actualizar `Manual_B2B_WLs/manual.html`. Antes de deployar, correr el chequeo:

```
python check_manual_refs.py
```

que grepea los nombres de script (`*.py`) citados en `manual.html` y avisa si alguno no existe en el repo (el patrón de drift más común — ya pasó con `pnl_gestional_upload.py`, `pnl_contable_upload.py`, `pnl_contable_epm_upload.py`, `daily_sync_b2b2c.py`, todos corregidos el 2026-09-05).

## Deploy

```powershell
cd Manual_B2B_WLs
clasp push --force
clasp deploy -i AKfycbwq2nohZ-c3w-OqvO1H_op4yATn6yDN4qRO9mI8gs1VkO9Jn9lCcQeTsNAceCpydJiHzg -d "descripción"
```

`clasp push` solo actualiza `@HEAD`/dev — el `clasp deploy -i` es obligatorio para la URL `/exec` (ver `/clasp-push`). Existe además una copia sincronizada a mano en SharePoint (`OneDrive - despegar365\Control de Gestión - 2026-27\B2B & WLs\Proyectos IA\...`).

## Deuda conocida (auditoría 2026-09-05)

- Cada `deploymentId`/Drive ID está hardcodeado 4-5 veces dentro de `manual.html` sin fuente única — cualquier corrección exige editar N lugares.
- Agregar un módulo nuevo requiere tocar el archivo en ~6 puntos (nav, proj-grid, sección, tablas de archivos/links/comandos).
- La sección "Arquitectura global" y la genérica "Cómo Actualizar" fueron un artefacto pre-refactor (Toqan) y se reescribieron el 2026-09-05.
