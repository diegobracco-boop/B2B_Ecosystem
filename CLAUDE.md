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
| `Dashboard_B2B_WLs/` | Implementar → `/clasp-push` |
| `P&L_Accounting/` | Implementar → `/clasp-push` |
| `P&L_Managerial/` | Implementar → `/clasp-push` |
| `Manual_B2B_WLs/` | Implementar → `python Manual_B2B_WLs/check_manual_refs.py` → `/clasp-push` |

**Al cambiar el proceso, los IDs de Drive/deployment, los nombres de script o la arquitectura de CUALQUIER módulo, actualizar también `Manual_B2B_WLs/manual.html`** — no se actualiza solo, y ya se desincronizó (scripts fantasma, IDs viejos). Correr `python Manual_B2B_WLs/check_manual_refs.py` antes de deployar el manual (chequea que los `.py` citados existan en el repo).

## Reglas que nunca romper

- **Nunca hardcodear credenciales** en el código. Todas van en `credenciales/` (gitignoreado).
- **`git push` no publica las landings GAS**. Son independientes — siempre recordar el `/clasp-push` después del commit.
- **Verificar antes de commitear** que `credenciales/` no esté staged (`git status`).
- **No correr `clasp push` desde la raíz** del repo — siempre desde la carpeta del módulo específico.
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

## Auditoría automática de código

Antes de correr `/clasp-push` o `/actualizar`, y después de cualquier cambio grande en un pipeline (`Inputs_Planning_PnL`, `Daily_Dashboard`) o en una landing GAS, invocá al subagente `auditor-de-codigo` sobre el módulo tocado. Corre la skill `code-audit` (calidad de código, integridad de datos, seguridad de credenciales, consistencia pipelines↔landings) y devuelve hallazgos antes de publicar. Si reporta hallazgos bloqueantes, avisá al usuario y esperá confirmación antes de seguir con el deploy.

El usuario también puede pedir una auditoría en cualquier momento ("auditar", "revisar integridad de datos", "chequear credenciales") — en ese caso invocá `auditor-de-codigo` directamente con el alcance que indique (repo completo o un módulo puntual).
