# P&L Managerial

Vista gerencial (gestional/FVM) del P&L para B2B2C y B2B — separada de P&L Accounting en julio 2026. **Tiene su propio pipeline de datos, independiente del "contable" que usan Inputs_Planning_PnL/P&L_Accounting/Dashboard_B2B_WLs.** No confundir los dos: acá todo sale directo del Datalake + modelos Forecast en XLSX, no de los JSONs canónicos de `Inputs_Planning_PnL`.

## Stack

- **`actuals_gestional_upload.py`** — script principal (Python, manual). Consulta el Datalake (ODBC) para actuals/LY/budget/run-rate de B2B2C + B2B GD + B2B RI, y lee los modelos Forecast XLSX (WLs→B2B2C, API→B2B-MAY, HTML→B2B-MIN) para el escenario forecast. Arma los 11 escenarios (`ac`, `ac_ri`, `ly`, `bgt`, `bgt_ri`, `rr`, `rr_ri`, `fc`, `fc_ri`, `bl`, `bl_ri`) y sube todo en un solo JSON a Drive. Requiere VPN (Datalake) + `.env` con credenciales ODBC.
- **`projections_gestional_builder.py --wip-folder <ruta>`** — herramienta aparte, NO parte del refresh regular. Genera `pnl_gestional_projections_review.json`: toma los actuals del JSON principal (meses cerrados) y les pega encima una proyección (`bl`/`bl_ri`) leída de un WIP folder de Excel, para previsualizar un forecast en borrador antes de que esté listo para el run regular. El resto de los escenarios se copian sin cambios del JSON principal.
- **`dashboard.html`** — frontend GAS: Managerial View B2B2C y B2B (FVM, waterfall, evolución, palancas, NR Bridge, PxQ). Sin vistas contables (esas quedaron en P&L Accounting).
- **`Codigo.js`** — backend GAS. Sirve dos JSON distintos según el toggle de la landing: el gestional normal (`GESTIONAL_JSON_FILE_ID`) o el Projection Review (`GESTIONAL_VR_JSON_FILE_ID`).
- **`ly_data.js`** — define `LY_DATA` con un LY estático (generado en julio 2026 por un script `ly_sync.py` que ya **no existe** en el repo). **No está en uso**: nada en `Codigo.js`/`dashboard.html` lo referencia. El LY que sí se muestra en la landing es el dinámico (`ly`/`ly_b2b2c`/`ly_may`/`ly_min`) que calcula `actuals_gestional_upload.py` en cada run. Candidato a borrar (confirmar con el equipo antes).

## Flujo de datos

```
Datalake (Treasure Data vía ODBC) ─┐
Modelos Forecast XLSX (WLs/API/HTML) ─┤
                                       ▼
                        actuals_gestional_upload.py
                                       │
                                       ▼
                    Google Drive (carpeta 1wzudbo7cN9Ibiv_2OA-V0_B_un4JcJp6)
                    _actuals_gestional.json  (fileId 1wvle0UIVZV7ocCSl8OawOfIGVz_It5kh)
                                       │
                    ┌──────────────────┼────────────────────────────┐
                    ▼                  ▼                            ▼
          P&L_Managerial/Codigo.js   Inputs_Planning_PnL/okr_builder.py   projections_gestional_builder.py
          (sirve la landing)         (solo lee last_actual_ym,           --wip-folder <ruta>
                                       para okr.json de                   (input: actuals de este JSON
                                       Dashboard_B2B_WLs)                  + proyección WIP)
                                                                           │
                                                                           ▼
                                                              pnl_gestional_projections_review.json
                                                              (fileId 1Zd1Kzn7CkatOWnzrrfBxr9mDjIVLLKIF)
```

**Nota sobre nombres**: el archivo con fileId `1wvle0UIVZV7ocCSl8OawOfIGVz_It5kh` se llamó originalmente `_pnl_gestional_data.json` — el nombre visible en Drive cambió a `_actuals_gestional.json` cuando se reescribió el script, pero el `fileId` (y por lo tanto quién lo lee) es el mismo. Hay un archivo **viejo y huérfano** con el nombre anterior y OTRO fileId (`1WP0mFepNzc5dpNThqGT5A0Xa3xypVK8I`, última modificación 2026-07-25) que quedó en la misma carpeta de Drive sin que nada lo actualice ni lo lea — no confundirlo con el vigente. Candidato a borrar de Drive (confirmar con el equipo antes).

## Escenarios (scenario model)

Espeja la lógica de P&L Accounting (baseline + goal), pero con nombres propios que NO coinciden con los de `Codigo_contable_epm.js` (`ac`/`rr`/`bg`/`fc`/`lrr`/`ly`):

| Escenario | Significado | Fuente |
|---|---|---|
| `ac` / `ac_ri` | Actuals (meses cerrados) | Datalake ODBC |
| `ly` | Last year (FY26 completo) | Datalake ODBC |
| `bgt` / `bgt_ri` | Budget FY27 completo | Datalake ODBC (`raw.b2b_budget_gd`/`raw.b2b_budget_ri`) |
| `rr` / `rr_ri` | Run rate (near-term) | Datalake ODBC (`raw.b2brr_gd`/`raw.b2brr_ri`) |
| `fc` / `fc_ri` | Forecast goal = actuals ≤ Jun + proyección Jul-Mar | Modelos XLSX (`FC_XLSX_DIR`), **no** `raw.b2bfc1_*` (desactualizado) |
| `bl` / `bl_ri` | Baseline = ac → rr → fc → bgt según el mes | Combinación de lo anterior |

El selector Goal de la landing mapea: budget→`bgt`, forecast→`fc`, lastyear→`ly`. No existe equivalente a `lrr` (lastrunrate) en este modelo.

## Credenciales y configuración manual

- **`RUTA_ENV`** (`actuals_gestional_upload.py:44`) apunta a `C:\Users\diego.bracco\Proyectos IA\envs\.env` — hardcodeado a la máquina de Diego. Si otra persona corre este script, hay que cambiar esta ruta a mano (no está cubierto por el checklist de onboarding del `CLAUDE.md` raíz, que solo menciona `Daily_Dashboard`).
- **`FC_XLSX_DIR`** (línea 54-57) apunta a la carpeta semanal vigente del Forecast/Run Rate (ej. `2026.08.18 - W33`), también hardcodeada a OneDrive de Diego. **Hay que actualizarla a mano cada vez que se publica un nuevo corte** — el script no avisa si quedó apuntando a una carpeta vieja.
- Credenciales Drive: si existe `credentials_drive.json`/`token_drive.json` en esta carpeta, se usan esas; si no, cae a las credenciales de `clasp` (`~/.clasprc.json`).

## Deploy

```powershell
cd P&L_Managerial
clasp push
clasp deploy -i AKfycbxHyP4uIh02zTQbQ7ZFbyByCVIYuREuiMJ74PnKhQbNGbWknCG2jxOtt_onafQcg5g4 -d "descripción del cambio"
```
`clasp push` solo actualiza `@HEAD`/dev — el `clasp deploy -i` es obligatorio para que el cambio llegue a la URL `/exec` que usa el equipo (ver `/clasp-push` en la raíz para más detalle y para mantener este ID actualizado si cambia).

## Gotchas

- El bug de fechas `pd.to_datetime(..., format="mixed", dayfirst=True)` (ver `CLAUDE.md` raíz) está/estuvo en `_budget_ym()` de `actuals_gestional_upload.py` — afecta el bucketeo mensual de budget y run-rate si la fecha viene en ISO con día ≤12.
- No hay ningún comando único que encadene "actualizar `FC_XLSX_DIR`" + correr el script + `clasp push` + `clasp deploy -i` — es un candidato a slash command dedicado si el flujo se vuelve más frecuente.
- Este módulo no tiene backup automático antes de sobreescribir `_actuals_gestional.json` en Drive — si una query del Datalake devuelve 0 filas a mitad de corrida (VPN caída, cambio de esquema), el script sube igual el resultado.
