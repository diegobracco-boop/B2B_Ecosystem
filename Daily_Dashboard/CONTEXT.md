# Daily Dashboard

Script Python que corre diariamente y publica los datos operativos de B2B2C y B2B en Google Drive para que el dashboard GAS los consuma.

## Stack

- **`daily_sync.py`** — script principal (Python). Se ejecuta automáticamente a las 9:45 via Windows Task Scheduler (desde 2026-09-25, en la máquina de Tiago Harari).
- **`dashboard.html` / `dashboard_weekly.html`** — frontend GAS que lee los JSON de Drive y los presenta al equipo.
- **`Codigo.js`** — Apps Script backend del dashboard.
- **`auth_drive.py`** — setup inicial de credenciales OAuth Drive (correr una sola vez por persona).

## Flujo de datos

```
Datalake (Treasure Data vía ODBC)
  → daily_sync.py  (queries B2B2C + B2B, actuals + LY + budget + run rate)
  → dos JSONs compactos (array-of-arrays)
  → Google Drive (carpeta DailyDashboard, ID: 1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh)
      ├── daily_b2b2c_data.json
      ├── daily_b2b_data.json
      ├── okr_h2_managerial.json
      ├── recurrencia_b2b.json ← Accelerate Recurrence (Status KRs H2 del Tracker), ver abajo
      ├── fvm_negativo.json   ← lo lee la landing FVM_Negativo/ (no este dashboard)
      ├── industry_events.json ← SOLO Ownia: solapa "Industry events tracker" (lo arma industry_events_sync.py)
      └── b2c_budget_weekly.json ← SOLO Ownia: Budget B2C por semana ISO × país (lo arma b2c_budget_sync.py)
  → dashboard GAS lee los JSON y renderiza
```

`industry_events.json` (2026-10-24, solo la app de Ownia; Apps Script no lo lee): eventos comerciales de industria
(Cyber Monday, Black Friday, El Buen Fin, Hot Sale, Travel Sale…) por LoB × país × año, armados de los calendarios
de OneDrive "Estacionalidad Diaria" (`Calendario Eventos - WL.xlsx` → B2B2C y B2C, hoja `Eventos` más las regionales
`Sudamerica`/`Brasil`/`Norteamerica`, porque a veces un evento se carga solo en la regional; `Eventos B2B 26-27.xlsx` → B2B),
más el diario de B2B2C y B2C de nov–dic del año pasado, que `daily_sync.py` todavía no publica (su LY llega hasta
fin del mes en curso). Lo arma `industry_events_sync.py`, a mano: no cambia `daily_sync.py` (ejecuta sus queries
desde ese archivo, como `reales.py`) y se vuelve a correr solo cuando cambian los calendarios. Después:
`py Ownia_B2B_Ecosystem/mirror/ownia_mirror.py --module daily`. El año en curso lo toma la solapa de los JSON del
Daily que ya carga. Verificado 2026-10-24: el GB B2B2C de nov-2025 por país coincide con `actuals_ly_fy_rest`.

`b2c_budget_weekly.json` (2026-10-27, solo Ownia): Budget de B2C por semana ISO (recortada al año calendario: la 1 de
2026 es 1–4 de enero) × país, todas las marcas / canales / productos, en USD. Sale del CSV semanal que manda Planning
(`budget_2026_b2c.csv`) con `py b2c_budget_sync.py [--csv <archivo>]`, a mano, y después
`py Ownia_B2B_Ecosystem/mirror/ownia_mirror.py --module daily`. Lo usa la sección "Weekly · vs B2C" del Benchmark y su
slide del Flow (`Ownia_B2B_Ecosystem/public/daily-ceo-weekly.js`, servidor `getB2CBudgetWeekly`). Verificado 2026-10-27:
mismo perímetro que el real B2C del Daily (semanas 30–43 entre −17% y +13% del Budget). El CSV cubre ene–dic 2026: para
ene–mar 2027 hace falta el Budget del año siguiente.

`recurrencia_b2b.json`: agencias HTML de alta frecuencia por semana comercial × país. La query es copia de la
card Metabase 171400 (`recurrencia_alta_frecuencia.sql`; si cambia en Metabase, pegar el SQL nuevo ahí). Lo arma
`recurrencia_sync.py`, que `daily_sync.py` llama en cada corrida (subida no fatal) y que también se corre solo para
actualizar únicamente este dato: `python recurrencia_sync.py` (`--no-upload` = solo ver los números). El target
por país lo lee Apps Script directo de Input_OKR (`getRecurTargets`), porque okr.json trae solo el Total.

`fvm_negativo.json`: tres queries extra (`build_b2b_fvm_neg_query`, `build_b2b2c_fvm_neg_query`) que reusan
las piezas de las queries B2B/B2B2C de arriba con `transaction_code` en la apertura. Si fallan o su FVM total no
cuadra con el del Daily, ese JSON no se sube y el resto sigue igual. Al tocar `_B2B_COMPONENTS_*`, `_B2B_JOINS_*`,
`_b2b_where_*` o `build_actuals_query`, el cambio impacta también a FVM Negativo (y a `reales.py`).

## Credenciales

El `.env` con usuario/password del Datalake vive en `../credenciales/.env` (gitignoreado). La variable `RUTA_ENV` en `daily_sync.py` apunta ahí usando `Path(__file__).parent.parent`.

Las credenciales OAuth de Drive (`credentials_drive.json` + `token_drive.json`) van dentro de esta carpeta, también gitignoreadas.

## Setup inicial (por persona)

1. Copiar credenciales del Datalake a `../credenciales/.env`:
   ```
   USER=tu_usuario
   PASSWORD=tu_password
   ```
2. Instalar dependencias: `pip install -r requirements.txt`
3. Obtener `credentials_drive.json` de Google Cloud Console (proyecto DailyDashboard, OAuth desktop)
4. Correr `python auth_drive.py` — abre el navegador, autorizás una vez, queda guardado en `token_drive.json`
5. Programar `daily_sync.py` en Windows Task Scheduler: diariamente a las 08:00

## Tier de partners (B2B2C)

Cada fila B2B2C (`actuals`/`budget`/`runrate`) trae el campo `tier` (desde `raw.comdev_cartera_b2b2c_historic.estatus_tier`; actuals por `partner_id`, budget/runrate por partner × país en `daily_sync.py:_map_tier`, con fallback a nivel partner). El tab "Flow Semanal" de `dashboard.html` lo lee directo de los datos (filtro por Tier) — no depende de ningún archivo ni script aparte.

País de partners B2B2C mal cargados en las proyecciones (budget / run rate / forecast): `pais_rules.py` (`PAIS_OVERRIDES`: CUTC → USA). Lo comparten `daily_sync.py` y `P&L_Managerial/` (actuals_gestional_upload.py, projections_gestional_builder.py); para corregir otro partner se toca solo ahí.

Actuals B2B2C: solo partners de la cartera de ComDev (`AND di.partner_id IS NOT NULL` en `build_actuals_query`, mismo filtro en `P&L_Managerial/actuals_gestional_upload.py:build_b2b2c_query`). Afuera los `partner_data_id` sin cartera (AG…/AP…, KMV, demos; ~USD 8k NR FY27): el total queda apenas por debajo del P&L operativo de Metabase.

## Gotchas

- Auth Drive usa scope completo (`drive`), no el token de clasp (`drive.file`). Si se usa el de clasp da 403 al intentar sobrescribir archivos de otros usuarios.
- `stdout` forzado a UTF-8 porque la consola Windows cp1252 crashea con acentos.
- El script incluye queries B2B (GD y RI) y B2B2C en una sola ejecución; si alguna falla, el resto continúa (bloques try/except individuales).

- **País RG / switch "COI Brasil" (2026-10-27):** `daily_sync.py` (`append_rg_rows` / `add_rg_rows_proj`) y `b2c_budget_sync.py` agregan filas `pais = "RG"` con el cost of installments + efecto financiero de Brasil con signo contrario (FVM; orders/GB/NR en 0) en actuals, LY, budget, run rate, forecast, B2B y B2C. Reemplaza a la columna `fvm_ex_coi_br` (eliminada). Brasil conserva su FVM completo. Excluir = se suman las filas RG; Incluir = RG en 0 (`applyCoiBr_` en `dashboard.html`, `_fvmOf_` en `Codigo.js`, y las capas de Ownia). El Weekly muestra RG como grupo propio solo con Excluir. **Orden de publicación:** primero los syncs, después `/clasp-push` y el redeploy de Ownia. `P&L_Managerial` usa el mismo criterio (`rg_rows.py`).
