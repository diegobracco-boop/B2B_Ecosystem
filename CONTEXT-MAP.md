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
        ┌──────────────┼──────────────────┬──────────────────┐
        ▼              ▼                  ▼                  ▼
┌───────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ P&L Accounting│ │P&L Managerial│ │Dashboard B2B │ │ Manual B2B   │
│   (GAS+HTML)  │ │  (GAS+HTML)  │ │    WLs       │ │     WLs      │
│ vista contable│ │vista gerencial│ │  (GAS+HTML)  │ │  (GAS+HTML)  │
└───────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

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
- **Stack**: GAS + HTML + Python (`actuals_gestional_upload.py`)
- **Input**: JSONs canónicos de Inputs_Planning_PnL
- **Usuarios**: equipo gerencial — vista agregada para toma de decisiones
- **Deploy GAS**: `cd P&L_Managerial && clasp push`

### Manual_B2B_WLs — carga manual de datos
- **Stack**: GAS + HTML
- **Propósito**: interfaz para ingresar datos B2B WLs manualmente cuando no hay pipeline automatizado
- **Deploy**: `cd Manual_B2B_WLs && clasp push`

## Credenciales

Todas las credenciales viven en `credenciales/` (gitignoreado). Ver cada módulo para el detalle de qué archivo necesita.

## Estado actual

- **En producción**: Daily_Dashboard, Dashboard_B2B_WLs, P&L_Accounting, P&L_Managerial, Manual_B2B_WLs
- **En construcción (Fase 2)**: repuntear las landings de P&L y Dashboard_B2B_WLs a los JSONs canónicos de Inputs_Planning_PnL como fuente única (hoy algunas todavía leen de fuentes propias)

## Relación clasp ↔ GitHub

`clasp push` y `git push` son **independientes**. GitHub guarda el código fuente. Las landings en producción solo se actualizan cuando alguien corre `clasp push` manualmente desde la carpeta del módulo. Un `git push` nunca toca las landings en vivo.
