# B2B Ecosystem — instrucciones para Claude

Este repo contiene pipelines de datos y landings de Google Apps Script para el equipo B2B de Despegar. Antes de hacer cualquier cambio, identificá el módulo afectado y seguí el flujo correspondiente.

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
├── .env                        ← gregorio.minetti (ya existe)
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
| `Manual_B2B_WLs/` | Implementar → `/clasp-push` |

## Reglas que nunca romper

- **Nunca hardcodear credenciales** en el código. Todas van en `credenciales/` (gitignoreado).
- **`git push` no publica las landings GAS**. Son independientes — siempre recordar el `/clasp-push` después del commit.
- **Verificar antes de commitear** que `credenciales/` no esté staged (`git status`).
- **No correr `clasp push` desde la raíz** del repo — siempre desde la carpeta del módulo específico.

## Arquitectura resumida

Ver [CONTEXT-MAP.md](./CONTEXT-MAP.md) para el diagrama completo. En resumen:

- `Inputs_Planning_PnL` y `Daily_Dashboard` son los **pipelines** — generan los datos y los publican en Drive.
- El resto son **landings** GAS — consumen los datos de Drive y los presentan al usuario.
- Los pipelines alimentan las landings. Cambiar un pipeline puede afectar todas las landings.

## Comandos disponibles

- `/actualizar` — regenerar planas + JSONs canónicos (Inputs_Planning_PnL)
- `/sincronizar` — forzar sync manual del Daily Dashboard
- `/clasp-push` — deployar cualquier landing GAS a producción
