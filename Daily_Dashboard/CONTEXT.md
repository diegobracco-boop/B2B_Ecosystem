# Daily Dashboard

Script Python que corre diariamente y publica los datos operativos de B2B2C y B2B en Google Drive para que el dashboard GAS los consuma.

## Stack

- **`daily_sync.py`** — script principal (Python). Se ejecuta automáticamente a las 08:00 hs via Windows Task Scheduler.
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
      └── fvm_negativo.json   ← lo lee la landing FVM_Negativo/ (no este dashboard)
  → dashboard GAS lee los JSON y renderiza
```

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

## Gotchas

- Auth Drive usa scope completo (`drive`), no el token de clasp (`drive.file`). Si se usa el de clasp da 403 al intentar sobrescribir archivos de otros usuarios.
- `stdout` forzado a UTF-8 porque la consola Windows cp1252 crashea con acentos.
- El script incluye queries B2B (GD y RI) y B2B2C en una sola ejecución; si alguna falla, el resto continúa (bloques try/except individuales).
