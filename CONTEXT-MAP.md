# Context Map — B2B Ecosystem

## Visión general

El ecosistema tiene dos capas: **pipelines** (Python, generan los datos) y **landings** (GAS + HTML, presentan los datos al equipo de negocio). Los pipelines escriben a Google Drive; las landings leen desde Drive.

```
┌─────────────────────────────────────────────────────────────┐
│                        PIPELINES                            │
│                                                             │
│  Inputs_Planning_PnL        Daily_Dashboard                 │
│  (Python, manual)           (Python, automático 08:00 hs)   │
│  planas CSV → JSONs         Datalake → JSONs operativos     │
│  por escenario              B2B2C + B2B                     │
└──────────────────────┬──────────────────┬───────────────────┘
                       │                  │
                       ▼                  ▼
              Google Drive (fuente única de verdad)
                       │
        ┌──────────────┼──────────────────┬──────────────────┬──────────────────┐
        ▼              ▼                  ▼                  ▼                  ▼
┌───────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────────┐
│ P&L Accounting│ │P&L Managerial│ │Dashboard B2B │ │ Manual B2B   │ │ LoB_Country_One│
│   (GAS+HTML)  │ │  (GAS+HTML)  │ │    WLs       │ │     WLs      │ │ Pager (GAS+HTML)│
│ vista contable│ │vista gerencial│ │  (GAS+HTML)  │ │  (GAS+HTML)  │ │ contable+gerenc.│
└───────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ │ +daily/weekly   │
                                                                       └────────────────┘
```

⚠️ Este diagrama simplifica de más: **P&L_Managerial no lee del pool común de Drive que alimentan `Inputs_Planning_PnL`/`Daily_Dashboard`** — tiene su propio pipeline Python (`actuals_gestional_upload.py`), un tercer pipeline no dibujado arriba, que consulta el Datalake y los modelos Forecast XLSX directamente y publica su propio JSON. Ver el módulo más abajo para el detalle. **`lob_country_one_pagera` es el único landing que lee de los tres orígenes a la vez** (Inputs_Planning_PnL, Daily_Dashboard y el JSON gestional de P&L_Managerial) — no tiene pipeline propio, solo agrega/combina lo que ya publican los otros tres.

## Módulos

### Inputs_Planning_PnL — pipeline de planning
- **Stack**: Python
- **Trigger**: manual (`run_all.bat` o `/actualizar`)
- **Input**: CSVs crudos de OneDrive (carpeta `Planning-PBI - Inputs Power Bi`) + `Glosario.xlsx`
- **Output**: 5 JSONs canónicos en Drive (budget, forecast, runrate, lastrunrate, actuals) + baseline
- **Deploy**: no aplica (script local)
- **Doc detallada**: [CONTEXT.md](./Inputs_Planning_PnL/CONTEXT.md) · [CLAUDE.md](./Inputs_Planning_PnL/CLAUDE.md)

### Daily_Dashboard — sync diaria operativa
- **Stack**: Python + GAS + HTML
- **Trigger**: automático, Windows Task Scheduler, 08:00 hs
- **Input**: Datalake Treasure Data (ODBC) — actuals B2B2C, actuals B2B (GD y RI), LY, budget, run rate
- **Output**: `daily_b2b2c_data.json` + `daily_b2b_data.json` en Drive (carpeta DailyDashboard)
- **Deploy Python**: Task Scheduler ya configurado en la máquina de Gregorio. Para reconfigurar ver [SETUP.md](./Daily_Dashboard/SETUP.md)
- **Deploy GAS**: `cd Daily_Dashboard && clasp push`
- **Doc detallada**: [CONTEXT.md](./Daily_Dashboard/CONTEXT.md)

### Dashboard_B2B_WLs — dashboard comercial B2B y White Labels
- **Stack**: GAS + HTML
- **Input**: JSONs de Drive (Inputs_Planning_PnL + Daily_Dashboard)
- **Usuarios**: equipo comercial B2B — seguimiento de KRs, OKRs, performance por partner
- **Deploy**: `cd Dashboard_B2B_WLs && clasp push`

### P&L_Accounting — vista contable del P&L
- **Stack**: GAS + HTML
- **Input**: JSONs canónicos de Inputs_Planning_PnL
- **Usuarios**: equipo de finance — vista contable con líneas P&L estándar
- **Deploy**: `cd P&L_Accounting && clasp push`

### P&L_Managerial — vista gerencial del P&L
- **Stack**: GAS + HTML + Python (`actuals_gestional_upload.py`, `projections_gestional_builder.py`)
- **Input**: **NO** son los JSONs canónicos de Inputs_Planning_PnL — tiene su propio pipeline "gestional", independiente y paralelo al "contable": `actuals_gestional_upload.py` consulta el Datalake (ODBC) directo para actuals/LY/budget/run-rate, y lee los modelos Forecast XLSX (WLs/API/HTML) para el forecast. Sube todo a `_actuals_gestional.json` en Drive. `projections_gestional_builder.py --wip-folder <ruta>` es una herramienta aparte que arma una vista de preview (`pnl_gestional_projections_review.json`) con números de un WIP sin publicar.
- **Dependencia cruzada (poco obvia)**: `Inputs_Planning_PnL/okr_builder.py` LEE el JSON gestional de este módulo (mismo fileId que `_actuals_gestional.json`) — pero solo el campo `last_actual_ym`, para saber el corte de mes cerrado al construir `okr.json` de `Dashboard_B2B_WLs`. Es la única conexión real entre este módulo y `Inputs_Planning_PnL`, y va en sentido contrario al que sugiere el diagrama de arriba.
- **Usuarios**: equipo gerencial — vista agregada para toma de decisiones
- **Deploy GAS**: `cd P&L_Managerial && clasp push` + `clasp deploy -i <deploymentId>` (ver `/clasp-push` para el ID vigente — el deploy NO es automático)
- **Doc detallada**: [CONTEXT.md](./P&L_Managerial/CONTEXT.md)

### Manual_B2B_WLs — manual técnico del ecosistema
- **Stack**: GAS + HTML
- **Propósito**: landing GAS de **solo lectura** (`doGet` sirve `manual.html` estático — sin formularios, sin `doPost`, no ingresa ni carga datos). Documenta arquitectura, flujos de datos y procedimientos de actualización/deploy de todos los módulos del repo. Hoy se abre como link externo desde el Hub; a futuro embebido via iframe (falta el `manual-frame` en `Dashboard_B2B_WLs/dashboard.html`). El `setXFrameOptionsMode(ALLOWALL)` de su `Codigo.js` ya lo deja listo para embeber.
- **Input**: ninguno en runtime. Su contenido se mantiene a mano — al cambiar el proceso de cualquier módulo, actualizar también `Manual_B2B_WLs/manual.html` (ver regla en `CLAUDE.md`).
- **Deploy**: `cd Manual_B2B_WLs && clasp push --force` + `clasp deploy -i <deploymentId>` (ver `/clasp-push`)
- **Doc detallada**: [CONTEXT.md](./Manual_B2B_WLs/CONTEXT.md)

### lob_country_one_pagera — one-pager combinado por LoB+País
- **Stack**: GAS + HTML
- **Input**: sin pipeline propio y **sin leer JSONs de Drive directamente** — consume las
  otras 3 landings como **Apps Script Libraries** (`dependencies.libraries` en `appsscript.json`,
  pineado a una versión numérica de cada una, mismo patrón que `clasp deploy -i <id>`):
  - `DashboardB2BWLs.getCountryPageData()` → evolución mensual GB/NR/OC por LoB+país (FY27)
  - `PnLManagerial.getData()` → partners, hunting/farming (gestional)
  - `DailyDashboard.getWeeklySummaryData()` → pulso semanal por país
  Se eligió reusar funciones públicas (sin `_` final) en vez de duplicar la lógica de
  agregación, para que los números coincidan siempre con los de esas 3 landings. Al
  actualizar el código de alguna de ellas, hay que correr `clasp version` ahí y bumpear el
  número en `lob_country_one_pagera/appsscript.json`, si no el one-pager sigue sirviendo
  la versión vieja.
- **`executeAs: USER_DEPLOYING`** (a diferencia de `Dashboard_B2B_WLs`, que es
  `USER_ACCESSING`): necesario porque las libraries corren con la identidad de quien
  ejecuta el script TOP-LEVEL (no con la del dueño de cada proyecto-library), y
  `P&L_Managerial`/`Daily_Dashboard` asumen `USER_DEPLOYING` porque sus JSONs de Drive no
  están compartidos con todo el equipo — con `USER_ACCESSING` cualquier director sin
  acceso directo a esos Drive files vería errores de permisos.
- **Propósito**: vista tipo "country one pager" para el VP comercial / director comercial
  de una sola combinación LoB+País (un director tiene B2B2C Brasil, otro B2B Brasil —
  nunca ambas LoB del mismo país). Combina en una pantalla lo contable-gerencial mensual,
  partners/hunting-farming, y el pulso semanal — hoy repartido entre `P&L_Accounting`,
  `P&L_Managerial`, `Dashboard_B2B_WLs` y `Daily_Dashboard`.
  **v1 (piloto B2B2C Brasil, 2026-09-14)**: sin sección de OKR (el `okr.json` de
  `Inputs_Planning_PnL` solo filtra por LoB, no por país — pendiente si se necesita).
- **Usuarios**: directores comerciales por LoB+país (piloto: B2B2C Brasil)
- **Deploy**: `cd lob_country_one_pagera && clasp push --force` (el manifest tiene
  `dependencies.libraries`, clasp pide `--force` para pushearlo) + `clasp deploy -i <id>`
- **Script ID**: `1jApagpx41_eeLc3T51J_t3KUp7JqzA595rvV3mH3cEtDyTDkLT2gK9rp`
- **Deployment id (prod)**: `AKfycbytMGsghl1TweKpYgMV2uhjTr--a9jpWkd2G3faZrF0DixD7UNu2qAq8Tbhlv_PCo0t`

## Credenciales

Todas las credenciales viven en `credenciales/` (gitignoreado). Ver cada módulo para el detalle de qué archivo necesita.

## Estado actual

- **En producción**: Daily_Dashboard, Dashboard_B2B_WLs, P&L_Accounting, P&L_Managerial, Manual_B2B_WLs
- **En construcción**: `lob_country_one_pagera` (scaffold creado 2026-09-14, sin lógica de negocio todavía)
- **En construcción (Fase 2)**: repuntear las landings de P&L y Dashboard_B2B_WLs a los JSONs canónicos de Inputs_Planning_PnL como fuente única (hoy algunas todavía leen de fuentes propias)

## Relación clasp ↔ GitHub

`clasp push` y `git push` son **independientes**. GitHub guarda el código fuente. Las landings en producción solo se actualizan cuando alguien corre `clasp push` manualmente desde la carpeta del módulo. Un `git push` nunca toca las landings en vivo.
