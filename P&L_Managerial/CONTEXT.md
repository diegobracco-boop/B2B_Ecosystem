# P&L Managerial

Vista gerencial (gestional/FVM) del P&L para B2B2C y B2B — separada de P&L Accounting en julio 2026. **Tiene su propio pipeline de datos, independiente del "contable" que usan Inputs_Planning_PnL/P&L_Accounting/Dashboard_B2B_WLs.** No confundir los dos: acá todo sale directo del Datalake + modelos Forecast en XLSX, no de los JSONs canónicos de `Inputs_Planning_PnL`.

## Stack

- **`actuals_gestional_upload.py`** — script principal (Python, manual). Consulta el Datalake (ODBC) para actuals/LY/budget/run-rate de B2B2C + B2B GD + B2B RI, y lee los modelos Forecast XLSX (WLs→B2B2C, API→B2B-MAY, HTML→B2B-MIN) para el escenario forecast. Arma los 11 escenarios (`ac`, `ac_ri`, `ly`, `bgt`, `bgt_ri`, `rr`, `rr_ri`, `fc`, `fc_ri`, `bl`, `bl_ri`) y sube todo en un solo JSON a Drive. Requiere VPN (Datalake) + `.env` con credenciales ODBC.
- **`projections_gestional_builder.py --wip-folder <ruta>`** — herramienta aparte, NO parte del refresh regular. Genera `pnl_gestional_projections_review.json`: toma los actuals del JSON principal (meses cerrados) y les pega encima una proyección (`bl`/`bl_ri`) leída de un WIP folder de Excel, para previsualizar un forecast en borrador antes de que esté listo para el run regular. El resto de los escenarios se copian sin cambios del JSON principal.
- **`revenue_gd_builder.py`** — herramienta aparte, NO parte del refresh regular. Corre la query "revenue por GD" (modelo de revenue B2B: `bi_transactional_fact_*` + `lake.b2b_rev_pnl_sales_detail` + `lake.b2b_b2b2c_revenue_pnl_model`, basis `gestion_date`) para los meses cerrados de FY27, la mapea a `METRIC_COLS` y sube **`revenue_gd.json`** (fileId `1gLerphm9YJZ_-aKW7J566a9QcNbIQOCz`, misma carpeta de Drive) — lo consume la landing para la subsección "Planning vs Revenue" de Managerial vs Accounting. **El mapeo de las ~30 líneas P&L y los signos de las líneas de costo están en BORRADOR** (el header del script tiene la tabla). 6 métricas no tienen fuente en la query y salen 0 (`income_from_outsourced_services`, `white_labels_api`, `back_end_incentives`, `intercompany_usd`, `operations`, `vendor_commissions`). Métricas extra que sí trae la query y no están en `METRIC_COLS`: `rev_gb`, `revenue_margin`, `agency_fee`, `bad_debt`. Verificado Abr-Ago 2026 (Total B2B): GB reconcilia ~0.1% con el `ac` gestional, NR ~1-2%, FVM ~5% (Abr-Jun) / OK (Jul-Ago); el split up_front/fees/discounts difiere estructuralmente entre los dos modelos.
- **`dashboard.html`** — frontend GAS: Managerial View B2B2C y B2B (FVM, waterfall, evolución, palancas, NR Bridge, PxQ) + vista **Managerial vs Accounting**. Sin vistas contables (esas quedaron en P&L Accounting). La vista Managerial vs Accounting tiene un selector de modo (`_vsAccMode`): **"Managerial vs Accounting"** (3 tablas B2B2C/MAY/MIN, gestional `ac`/`ac_ri` vs `actuals.json` canónico, mapeo `VSACC_MAP`) y **"Planning vs Revenue"** (una tabla Total B2B: gestional `ac` GD vs `revenue_gd.json`). Ambos modos comparten los chips país/producto.
- **`Codigo.js`** — backend GAS. Sirve dos JSON distintos según el toggle de la landing: el gestional normal (`GESTIONAL_JSON_FILE_ID`) o el Projection Review (`GESTIONAL_VR_JSON_FILE_ID`). Endpoints de la vista comparativa: `getVsAccounting` (Managerial vs Accounting) y `getRevenueGDVsGestional` (Planning vs Revenue — lee `revenue_gd.json` por nombre en la carpeta, no por fileId hardcodeado).
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

- **Fórmulas B2B GD/RI alineadas al Daily (2026-09-07):** `daily_sync.py` es la versión oficial de las queries B2B (recibió los ajustes `c73d864` + 2026-07-26); `actuals_gestional_upload.py` había quedado atrás. GB ya cerraba pero NR/FVM no. Alineado: (GD) `country_factors` AR/Ag.afil, `cost_of_installments` `IN (0,1,null)`, `frauds` calculado. (RI) `country_factors` pasó de stub all-1.0 a la tabla real de 5 dec + CTE `conectores` + join multi-key + `white_labels_api`/`affiliates`/`frauds`/`cost_of_installments` de la versión oficial. Post-fix: MAY RI, MIN RI, MIN GD coinciden con el Daily al centavo (GB/NR/FVM). **Si tocás las queries B2B, comparar contra `daily_sync.py` `_B2B_COMPONENTS_*` / `_COUNTRY_FACTORS_*`.**
- **Fecha de reconocimiento RI (fix 2026-09-07):** `build_b2b_ri_query` usaba `checkin_date` solo para `partner_id IN ('AG72472','expedia','AG00044461','AG00101284')` (los 4 partners Expedia). El Daily (`daily_sync.py`) se alineó a la versión oficial el 2026-07-26 → `checkin_date` para **todo `parent_channel = 'API'`**; `actuals_gestional_upload.py` había quedado con la condición vieja. Efecto: `ac_ri` de B2B-MAY con buckets mensuales mal (ej. Jul-26 GB $29M vs $38M real). Se cambiaron las 6 apariciones de esa condición (SELECT anio_ri/mes_ri, WHERE, GROUP BY ×3) a `parent_channel = 'API'`. **Ojo:** NO tocar las apariciones de ese mismo `partner_id IN (...)` con `THEN 0.25`/`THEN 0` — ésas son un factor de comisión Expedia, cosa distinta. **Verificado 2026-09-08:** se corrió `actuals_gestional_upload.py` con VPN y se comparó `b2b_may.ac_ri` (GB/NR/FVM) contra `b2b_ri` (parent_channel `API`) del Daily para los meses cerrados Abr–Ago 2026 → coinciden al centavo (Δ máx ~$15 sobre bases de $1M–$38M, redondeo). Jul-26 GB pasó a $38.42M en ambos (antes $29M).
- El bug de fechas `pd.to_datetime(..., format="mixed", dayfirst=True)` (ver `CLAUDE.md` raíz) estuvo en `_budget_ym()` de `actuals_gestional_upload.py` y **se corrigió el 2026-09-04** con el helper `_parse_fecha_budget()` (separa el caso ISO explícito del resto). Afectaba el bucketeo mensual de budget y run-rate cuando la fecha venía en ISO con día ≤12. Si tocás el parseo de fechas de este script, no volver al patrón `format="mixed"`.
- No hay ningún comando único que encadene "actualizar `FC_XLSX_DIR`" + correr el script + `clasp push` + `clasp deploy -i` — es un candidato a slash command dedicado si el flujo se vuelve más frecuente.
- Este módulo no tiene backup automático antes de sobreescribir `_actuals_gestional.json` en Drive — si una query del Datalake devuelve 0 filas a mitad de corrida (VPN caída, cambio de esquema), el script sube igual el resultado.
