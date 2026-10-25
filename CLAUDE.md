# B2B Ecosystem — instrucciones para Claude

Este repo contiene pipelines de datos y landings de Google Apps Script para el equipo B2B de Despegar. Antes de hacer cualquier cambio, identificá el módulo afectado y seguí el flujo correspondiente.

**Onboarding de una persona nueva del equipo:** mandarla a la capa "Guía del equipo" del manual (`Manual_B2B_WLs` → Empezá por acá / Glosario / ¿Qué landing uso? / Recetas por tarea / Quién hace qué). Para dirección: la capa "Para dirección" (Panorama + Arquitectura global).

## Al iniciar una sesión — identificar al usuario

**Al comienzo de cada conversación, preguntá quién es el usuario** (si no se presentó). Los usuarios del equipo son:

- `gregorio.minetti`
- `diego.bracco`
- `tiago.harari`
- `tomas.rombola`
- `antonella.difranco`

Una vez identificado, verificá si existen sus credenciales en `credenciales/`:

```
credenciales/
├── .env.gregorio.minetti       ← ya existe
├── .env.diego.bracco
├── .env.tiago.harari
├── .env.tomas.rombola
└── .env.antonella.difranco
```

**Si las credenciales del usuario YA existen** → avanzar normalmente usando su archivo `.env.<nombre>`.

**Si NO existen** → pedirle al usuario su usuario y password del Datalake y crear el archivo:
```
credenciales/.env.<nombre.apellido>
```
Con el formato:
```
USER=nombre.apellido@ar.infra.d
PASSWORD=su_password
```
Recordarle que este archivo es local y gitignoreado — nunca se sube al repo.

Una vez creadas las credenciales, actualizar `RUTA_ENV` en `Daily_Dashboard/daily_sync.py` si el usuario va a correr el pipeline diario.

## Cuando el usuario quiere hacer un cambio

**Siempre preguntá qué módulo va a tocar** si no está claro, y derivá al flujo correcto:

| Si el cambio es en... | Flujo a seguir |
|---|---|
| `Inputs_Planning_PnL/` | Implementar → correr `/actualizar` para validar y publicar |
| `Daily_Dashboard/` (Python) | Implementar → correr `/sincronizar` para verificar que funciona |
| `Daily_Dashboard/` (GAS/HTML) | Implementar → `/clasp-push` para publicar a producción |
| `Dashboard_B2B_WLs/` | Implementar → sync y redeploy en Ownia. **Sin `/clasp-push`**: desde 2026-10-23 la versión de Apps Script queda congelada y las mejoras (visuales y de performance) van solo a la app de Ownia (P&L Dashboard), por decisión de Diego. La capa visual propia de Ownia vive en `Ownia_B2B_Ecosystem/public/hub-layout.js` |
| `P&L_Accounting/` | Implementar → `/clasp-push` + sync y redeploy en Ownia (en validación ahí) |
| `P&L_Managerial/` | Implementar → `/clasp-push` + sync y redeploy en Ownia (en validación ahí). Después de correr sus pipelines: `py Ownia_B2B_Ecosystem/mirror/ownia_mirror.py` |
| `Manual_B2B_WLs/` | Implementar → `python Manual_B2B_WLs/check_manual_refs.py` → `/clasp-push` |
| `lob_country_one_pager/` | Implementar → `/clasp-push` (combina JSONs de Inputs_Planning_PnL + Daily_Dashboard + P&L_Managerial, sin pipeline propio) |
| `P&L_Profit_Sharing/` | SQL/Python → `py profit_sharing_sync.py` (sube el JSON) · GAS/HTML → `/clasp-push` |
| `P&L_Profit_Sharing/` | SQL/Python → `py profit_sharing_sync.py` (sube el JSON) · GAS/HTML → `/clasp-push` |
| `Proceso_Distribucion_Diaria/` | Implementar → `/distribucion-diaria` con `--dry-run` (los controles de conciliación deben dar OK) |
| `OKR_Producto_B2B2C/` (Python) | Implementar → correr `okr_sync.py` manualmente (hace push+deploy+invalidación de cache solo) |
| `OKR_Producto_B2B2C/` (GAS/HTML) | Implementar → `/clasp-push` desde `OKR_Producto_B2B2C/` |
| `FVM_Negativo/` | Implementar → `/clasp-push` + sync y redeploy en Ownia (en validación ahí; sin pipeline propio: el JSON lo genera `Daily_Dashboard/daily_sync.py`; si se tocan esas queries, `/sincronizar`) |
| `Ownia_B2B_Ecosystem/` | Implementar → `npm test` → sync a `main` de `despegar/B2B_Ecosystem_APP` (repo propio de la app desde 2026-10-23) → redeploy con la skill `ownia-deploy` (ver su `CONTEXT.md`, "Flujo para publicar") |

**Migración progresiva a Ownia** (`Ownia_B2B_Ecosystem/`): corre el código GAS de los módulos marcados `ownia: true` en `server/modules.js` sin reescribirlo. Apps Script sigue siendo productivo y no se toca. Si cambiás un módulo GAS ya migrado o en validación (hoy `Manual_B2B_WLs`, `P&L_Managerial`, `P&L_Accounting`, `Daily_Dashboard`, `Dashboard_B2B_WLs`, `FVM_Negativo`), hay que publicar en los dos lados: `/clasp-push` **y** sync + redeploy en Ownia (excepción: `Dashboard_B2B_WLs`, congelado en GAS, va solo a Ownia). Los módulos con datos leen una copia espejada de Drive: si agregás un `*_FILE_ID` / `*_FOLDER_ID` / `*_SHEET_ID` en su código GAS, sumalo a `Ownia_B2B_Ecosystem/server/drive-manifest.json`, y después de cada corrida de pipeline corré `py Ownia_B2B_Ecosystem/mirror/ownia_mirror.py`.

**Al cambiar el proceso, los IDs de Drive/deployment, los nombres de script o la arquitectura de CUALQUIER módulo, actualizar también `Manual_B2B_WLs/manual.html`** (y, si cambia un deployment ID, `Ownia_B2B_Ecosystem/server/modules.js`) — no se actualiza solo, y ya se desincronizó (scripts fantasma, IDs viejos). Correr `python Manual_B2B_WLs/check_manual_refs.py` antes de deployar el manual (chequea que los `.py` citados existan en el repo).

## Reglas que nunca romper

- **Nunca hardcodear credenciales** en el código. Todas van en `credenciales/` (gitignoreado).
- **`git push` no publica las landings GAS**. Son independientes — siempre recordar el `/clasp-push` después del commit.
- **Verificar antes de commitear** que `credenciales/` no esté staged (`git status`).
- **No correr `clasp push` desde la raíz** del repo — siempre desde la carpeta del módulo específico.
- **Hacer `git pull` antes de empezar a trabajar y revisar `git diff` antes de commitear.** Commitear sobre una copia vieja del repo pisa trabajo ya mergeado sin que el commit lo diga: pasó el 2026-09-24 (`96e6644`, al agregar el módulo OKR se revirtieron `P&L_Managerial/actuals_gestional_upload.py`, `CLAUDE.md` y `CONTEXT-MAP.md` a versiones viejas). Si el diff borra cosas que no tocaste, frená y consultá.
- **Nunca usar `pd.to_datetime(serie, format="mixed", dayfirst=True)` para parsear fechas.** Ese combo invierte silenciosamente día/mes en fechas ISO (`YYYY-MM-DD`) cuando el día es ≤12 — ya rompió dos veces en este repo: `Daily_Dashboard/daily_sync.py` (fix: `_parse_fecha_budget`) y `P&L_Managerial/actuals_gestional_upload.py:1009` (fix: `_parse_fecha_budget`, mismo patrón). Si una fecha puede venir en más de un formato, separar explícitamente el caso ISO (`format="%Y-%m-%d"`) del resto (`dayfirst=True`) en vez de dejar que pandas adivine.
- **Un `clasp pull` puede traer código VIEJO de Apps Script y pisar commits ya mergeados a `main`.** Antes de commitear después de un `clasp pull`, correr `git diff` y revisar que no borre nada inesperado — nunca commitearlo junto con otro cambio no relacionado sin mirar el diff completo. Ya pasó una vez (2026-09-02): un `clasp pull` en `P&L_Accounting` mezclado con un chore de "eliminar insights" trajo una versión de `Codigo_contable_epm.js` anterior a un feature ya publicado (`a3068c1`, "vs Last Year") y lo borró sin que el commit lo mencionara — nadie lo notó hasta días después.

## Arquitectura resumida

Ver [CONTEXT-MAP.md](./CONTEXT-MAP.md) para el diagrama completo. En resumen:

- `Inputs_Planning_PnL` y `Daily_Dashboard` son los **pipelines** — generan los datos y los publican en Drive.
- El resto son **landings** GAS — consumen los datos de Drive y los presentan al usuario.
- Los pipelines alimentan las landings. Cambiar un pipeline puede afectar todas las landings.

## Comandos disponibles

- `/actualizar` — regenerar planas + JSONs canónicos (Inputs_Planning_PnL)
- `/sincronizar` — forzar sync manual del Daily Dashboard
- `/clasp-push` — deployar cualquier landing GAS a producción
- `/distribucion-diaria` — abrir a diario el Run Rate B2B + B2B2C (CSV para `raw.b2brr_gd/ri`, carga manual)

## Auditoría automática de código

Antes de correr `/clasp-push` o `/actualizar`, y después de cualquier cambio grande en un pipeline (`Inputs_Planning_PnL`, `Daily_Dashboard`) o en una landing GAS, corré la auditoría del agente `auditor-de-codigo` sobre el módulo tocado. Corre la skill `code-audit` (calidad de código, integridad de datos, seguridad de credenciales, consistencia pipelines↔landings) y devuelve hallazgos antes de publicar. Si reporta hallazgos bloqueantes, avisá al usuario y esperá confirmación antes de seguir con el deploy.

El usuario también puede pedir una auditoría en cualquier momento ("auditar", "revisar integridad de datos", "chequear credenciales", "revisar UX", "revisar procesos", "cómo se conectan los datos") — en ese caso corré el agente que corresponda con el alcance que indique.

### Agentes de auditoría del repo (`.claude/agents/`)

| Agente | Skill | Para qué |
|---|---|---|
| `auditor-de-codigo` | `code-audit` | Calidad de código, integridad de datos, credenciales, consistencia pipelines↔landings |
| `calidad-de-procesos` | `process-quality-audit` | Orden / claridad / escalabilidad / integridad / eficiencia de CÓMO se trabaja (no del código) |
| `ux-designer` | `ux-consistency-review` | Estética, paleta oficial Despegar, consistencia visual entre dashboards, accesibilidad |
| `data-engineer` | `data-source-consistency-review` | Mapeo de fuentes, duplicidad entre pipelines, formato homogéneo, staleness de doc |

### Panel de clientes (`.claude/agents/cliente-*.md`)

Agentes con la personalidad de los clientes de la app: `cliente-ceo`, `cliente-chief-comercial`, `cliente-vp-b2b`, `cliente-vp-b2b2c`, `cliente-vp-planning`, `cliente-director-pais`. Todos corren la skill `client-panel-review`: miran **capturas reales** de una pantalla (las saca la sesión principal levantando la app de Ownia en local) y responden si es apta para su rol, qué falta, qué sobra y qué no entienden. Usarlos antes de publicar una pantalla para dirección. Se invocan igual que los de auditoría (como `general-purpose`, leyendo su `.md` y la skill), pasándoles las rutas de las capturas.

**Dirección de diseño** (Diego, 2026-10-25): minimalista y simple, estilo Apple, con la paleta oficial de Despegar. Está en el Eje 7 de `ux-consistency-review`. Se aplica de a una pantalla y solo en las capas de Ownia.

**Cómo invocarlos en este entorno:** los agentes custom de `.claude/agents/` **NO son invocables por `subagent_type`** acá — lanzalos como `general-purpose` con un prompt que diga: "leé completo `.claude/agents/<nombre>.md` (tu rol) y `.agents/skills/<skill>/SKILL.md` (la skill que corrés), y seguí eso al pie de la letra; alcance = <módulo>; no edites nada, solo reportá".

**Si la sesión está cerca del límite de uso:** correr los agentes de a 1 o 2, no los 4 juntos (cada uno son ~100-140k tokens; correr 4 en paralelo puede cortar la sesión a mitad).
