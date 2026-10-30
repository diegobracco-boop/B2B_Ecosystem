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
| `P&L_Accounting/` | Implementar → sync y redeploy en Ownia. **Productivo en Ownia desde 2026-10-30** (Tiago): la landing de Apps Script solo muestra el aviso "se mudó" con el link (`doGet` de `Codigo.js`); `/clasp-push` solo si se toca ese aviso |
| `P&L_Managerial/` | Implementar → sync y redeploy en Ownia. **Productivo en Ownia desde 2026-10-30**, igual que P&L Accounting (Apps Script solo muestra el aviso con el link). Los pipelines publican solos a Drive **y** a Ownia (doble escritura, `ownia_publish.py`); `ownia_mirror.py` queda para reparar un fallo y para las Sheets / xlsx |
| `Manual_B2B_WLs/` | Implementar → `python Manual_B2B_WLs/check_manual_refs.py` → `/clasp-push` |
| `lob_country_one_pager/` | Implementar → `/clasp-push` (combina JSONs de Inputs_Planning_PnL + Daily_Dashboard + P&L_Managerial, sin pipeline propio) |
| `P&L_Profit_Sharing/` | SQL/Python → `py profit_sharing_sync.py` (sube el JSON) · GAS/HTML → `/clasp-push` |
| `P&L_Profit_Sharing/` | SQL/Python → `py profit_sharing_sync.py` (sube el JSON) · GAS/HTML → `/clasp-push` |
| `Proceso_Distribucion_Diaria/` | Implementar → `/distribucion-diaria` con `--dry-run` (los controles de conciliación deben dar OK) |
| `Flow_B2B/` (módulo Flow, solo Ownia) | Implementar → `npm test` en `Ownia_B2B_Ecosystem/` → revisar en local (`npm run dev`) → sync y redeploy en Ownia cuando Diego lo pida. Sin GAS: no hay `/clasp-push`. Ver `Ownia_B2B_Ecosystem/CONTEXT.md`, "Flow" |
| `OKR_Producto_B2B2C/` (Python) | Implementar → correr `okr_sync.py` manualmente (hace push+deploy+invalidación de cache solo, y sube `okr_tribu_producto.json` a Drive + Ownia) |
| `OKR_Producto_B2B2C/` (GAS/HTML) | Implementar → `/clasp-push` desde `OKR_Producto_B2B2C/` + sync y redeploy en Ownia (en validación ahí desde 2026-10-30) |
| `FVM_Negativo/` | Implementar → `/clasp-push` + sync y redeploy en Ownia (en validación ahí; sin pipeline propio: el JSON lo genera `Daily_Dashboard/daily_sync.py`; si se tocan esas queries, `/sincronizar`) |
| `Ownia_B2B_Ecosystem/` | Implementar → `npm test` → sync a `main` de `despegar/B2B_Ecosystem_APP` (repo propio de la app desde 2026-10-23) → redeploy con la skill `ownia-deploy` (ver su `CONTEXT.md`, "Flujo para publicar") |

**Migración progresiva a Ownia** (`Ownia_B2B_Ecosystem/`): corre el código GAS de los módulos marcados `ownia: true` en `server/modules.js` sin reescribirlo. Apps Script sigue siendo productivo y no se toca. Si cambiás un módulo GAS ya migrado o en validación (hoy `Manual_B2B_WLs`, `Daily_Dashboard`, `FVM_Negativo`, `OKR_Producto_B2B2C`), hay que publicar en los dos lados: `/clasp-push` **y** sync + redeploy en Ownia. Excepciones, solo Ownia: `Dashboard_B2B_WLs` (congelado en GAS) y `P&L_Managerial` / `P&L_Accounting` (productivos en Ownia desde 2026-10-30; en GAS solo queda el aviso). Los módulos con datos leen una copia espejada de Drive: si agregás un `*_FILE_ID` / `*_FOLDER_ID` / `*_SHEET_ID` en su código GAS, sumalo a `Ownia_B2B_Ecosystem/server/drive-manifest.json`, y después de cada corrida de pipeline corré `py Ownia_B2B_Ecosystem/mirror/ownia_mirror.py`.

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

**Actualizar reales** (desde 2026-10-30): botón de la portada de Ownia, solo el equipo B2B y con contraseña (secreto `REALES_PASSWORD` de la app). Corre `Daily_Dashboard/daily_sync.py` en el servidor de Ownia (`Ownia_B2B_Ecosystem/server/reales-job.js`: Trino por HTTPS con `DATALAKE_HOST`, credenciales en `APP_SECRETS`) y publica en Drive y Ownia. Reemplaza al Task Scheduler de la PC de Tiago (`auto_update_reales.ps1`). Si se cambian los imports de `daily_sync.py`, revisar `requirements-pipelines.txt` y `PIPELINES` en `scripts/sync-to-ownia-repo.js`.

## Comandos disponibles

- `/actualizar` — regenerar planas + JSONs canónicos (Inputs_Planning_PnL)
- `/sincronizar` — forzar sync manual del Daily Dashboard
- `/clasp-push` — deployar cualquier landing GAS a producción
- `/distribucion-diaria` — abrir a diario el Run Rate B2B + B2B2C (CSV para `raw.b2brr_gd/ri`, carga manual)

## Agentes (auditoría, panel de clientes, FCA)

Antes de correr `/clasp-push` o `/actualizar`, corré `auditor-de-codigo` sobre el módulo tocado; si reporta hallazgos bloqueantes, esperá la confirmación del usuario antes de deployar. Para cuándo correr cada agente, cómo invocarlos y el límite de uso, leé [AGENTS.md](./AGENTS.md) antes de lanzar cualquiera.
