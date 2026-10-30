# OKR Producto B2B2C

Pipeline + landing GAS que calcula el avance de los Key Results (KRs) de la Tribu Producto B2B2C (H1 FY27) y publica un dashboard interactivo.

Migrado desde el proyecto standalone `okrs_tribu_producto` (fuera del ecosistema) — ver commit de migración para historial.

## Stack

- **`okr_sync.py`** — script principal (Python). Consulta el Datalake (Treasure Data vía ODBC), calcula el % de logro de cada KR, y publica.
- **`Codigo.js`** — backend Apps Script. Sirve el `dashboard.html` y actúa como proxy para leer la Google Sheet de P&L (KR6).
- **`dashboard.html`** — frontend del dashboard (tabla, toggles, semáforo de colores).
- **`okr_data.js`** — GENERADO AUTOMÁTICAMENTE por `okr_sync.py`. Contiene el JSON con todos los datos. No editar a mano.
- **`setup_drive_token.py`** — setup inicial de OAuth Drive (correr una sola vez por persona).
- **`appsscript.json`** / **`.clasp.json`** — manifest y vínculo con el proyecto GAS (`scriptId: 1FOBt3E_IQhWHqQtslKaVdE07jIA3slZB3_aRJTPNUIOINNUS8MMDPl1M`).

## Flujo de datos

```
Datalake (Treasure Data vía ODBC) + Google Sheet P&L (KR6) + JSONs de Drive (Inputs_Planning_PnL)
  → okr_sync.py (calcula achievement % por KR, mensual/trimestral/H1)
  → okr_data.js (JSON embebido)
  → clasp push --force + clasp deploy --deploymentId <fijo>
  → invalida cache del webapp (CacheService, 6hs)
  → dashboard GAS se refresca
```

Este dashboard está embebido como `<iframe>` dentro de `Dashboard_B2B_WLs/dashboard.html` (`EXTERNAL_LINKS.okr.b2b2c`), con la misma URL de deployment fija.

## Credenciales

- ODBC Datalake: `../credenciales/.env.<usuario>` (mismo archivo que usa `Daily_Dashboard`).
- OAuth Drive (lectura de JSONs budget/baseline): `../credenciales/drive_token.<usuario>.json`. Si no existe, correr `python setup_drive_token.py` una vez (reusa client_id/secret de `clasp`, requiere `clasp login` previo).
- **Nunca** commitear `.env` ni `drive_token.*.json` — viven en `credenciales/`, gitignoreado.

## KRs — fuentes de datos

| KR | Descripción | Fuente |
|---|---|---|
| KR1 | Nuevos partners Tier I/II | Simulado (hardcodeado) — pendiente conectar fuente real |
| KR2 | Share usuarios Growth | `data.lake.bi_web_traffic` |
| KR3 | Volumen canje puntos/millas (+15%) | `bi_transactional_fact_transactions` + `specialclients_services_redemption` + `bi_pnlop_fact_current_model` |
| KR4 | Acumulación/Cashback puntos/millas (+5%) | Misma query que KR3 |
| KR5 | Capacidades UI flexible (VIPAs) | `lake.jira_hour_reports_vipa` |
| KR6 | Net Revenue WL Modulares | JSONs de Drive (`budget.json` / `baseline_actuals+projections.json`), filtrando `LoB=b2b2c` |
| KR7 | Capabilities de autogestión | Simulado al 100% — pendiente conectar fuente real |

## KRs H2 FY27 (oct-26 → mar-27, desde 2026-10-30)

El dashboard abre en H2; el selector H1 | H2 deja ver el cierre de H1. En el payload van en `okr_h2` (H1 sigue en `okr`).

| KR | Peso | Fuente |
|---|---|---|
| Net Revenue Rewards Programs | 20% | Sheet de la tribu [OKRs_Tribu B2B2C](https://docs.google.com/spreadsheets/d/1x94gwcPBvxMYv3orWboEvDaQjmSS69Ab4vcoFXeHpNo/edit), pestaña `Rewards Programs` (manual): uplift de compradores vs meta 10% |
| Strategic Partnership Activations (#) | 40% | = Deploy New Partnership del ecosistema: `okr.json` (Input_OKR), target y actual, acumulado |
| Acquisition, Retention, Repeat rate | 20% | Query de la pestaña `Intent_Users` (intent users con growth capabilities); meta = promedio mensual abr-sep 26 +8% |
| Partner Retention Rate | 20% | Recalculado desde `capabilities_tracking` + `Partners_Base` (≥2 capabilities, no se apagan); meta 50%. No usa la pestaña `Partner Retention Rate` (fórmulas corridas de mes). NR de latam-cl cargado como texto → se toma 4.626.781 (`NR_TEXT_FIX`, confirmar con la tribu) |

Solo se muestran meses hasta el actual (Input_OKR trae actuals futuros = target). La sheet se baja por Drive como `.xlsx` (la API de Sheets no está habilitada en el proyecto OAuth).

## Deploy

Después de tocar `Codigo.js` o `dashboard.html`:

```
cd OKR_Producto_B2B2C
clasp push --force
clasp deploy --deploymentId AKfycbz1KVq_b2V8UBEaXvcqJmlvS8e-gd2FAwQOcBV91rABnK7Lm33fTcYMPr_f7pdqNiCI
```

`okr_sync.py` ya hace este push+deploy+invalidación de cache automáticamente al final de cada corrida — no hace falta correrlo a mano salvo que solo hayas tocado el frontend/backend sin recalcular KRs.

## Ownia (en validación desde 2026-10-30)

El mismo dashboard corre también en Ownia: `https://ownia.despegar.io/b2b-ecosystem/okr-b2b2c`, en paralelo a GAS. Corre este mismo `Codigo.js` + `dashboard.html`, con el diseño de Ownia (`Ownia_B2B_Ecosystem/public/okr-layout.js`) y las mismas secciones y formatos.

- **Datos**: `okr_sync.py` sube el payload como `okr_tribu_producto.json` a la carpeta de Drive `1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh` (la del Daily) y en el mismo paso a Ownia (`ownia_publish.py`). En Ownia, `server/gas-extras/okr-payload.js` reemplaza `loadJSON_` para leer ese JSON en vez de `okr_data.js`.
- La subida a Drive usa el login de los uploaders del P&L (`Inputs_Planning_PnL/token_drive.json`, con escritura); a Ownia, `credenciales/.env.ownia`. Si falla, avisa (`WARN`) y sigue con Apps Script.
- `python okr_sync.py --solo-ownia` publica solo en Drive + Ownia (sin clasp). `python okr_sync.py --json <ruta>` solo escribe el payload a un archivo (para probar en local).
- Si cambiás `Codigo.js` o `dashboard.html`: `/clasp-push` **y** sync + redeploy en Ownia (ver `Ownia_B2B_Ecosystem/CONTEXT.md`).

## Automatización

Corre diariamente a las 08:00 hs via Windows Task Scheduler (tarea "OKR Sync"), igual que `Daily_Dashboard`. Ver [SETUP.md](./SETUP.md).
