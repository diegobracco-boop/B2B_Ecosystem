# Inputs Planning P&L — pipeline de datos (planas + JSON canónicos)

Este proyecto **reemplaza a Toqan (IA interna)**: genera localmente las "planas"
(tablas planas homologadas) y publica un **JSON canónico por concepto** en Drive,
que es la **fuente única** para TODAS las landings (P&L Accounting, Managerial,
Dashboard B2B/WLs, etc.). Objetivo: que budget/forecast/etc. muestren **los mismos
números en todos lados** (antes cada landing leía de un lugar distinto: Sheet, JSON, otro).

## Flujo
```
CSV crudos (OneDrive\Planning-PBI - Inputs Power Bi)
  → PLANAS  (long: Marca|LoB|Canal|Pais|Producto|P&L N1..N6|Managerial|Fecha|Monto USD)
  → JSON canónico por concepto (budget/forecast/runrate/lastrunrate/actuals)
  → Drive folder 1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV
  → landings (Fase 2: cada una lee su JSON)
```

## Cómo actualizar (lo más común)
- **Todo + subir a Drive:** `run_all.bat` (o `/actualizar`).
- Setup 1 vez por persona: `pip install pandas openpyxl google-auth google-auth-oauthlib google-api-python-client` y `python auth_drive.py` (crea `token_drive.json`; `credentials_drive.json` ya está).
- Individual:
  - `python plana_projections_builder.py budget|forecast|runrate|lastrunrate`
  - `python plana_actuals_builder.py 2027`  (FY27 = mensual; 2024/2025/2026 = una vez)
  - `python json_builder.py budget|forecast|runrate|lastrunrate|actuals|all [--no-upload]`

## Reglas de negocio (NO cambiar sin confirmar)
- **SIN PPA por default** → se suma el Reverso AxI (`Planning-PBI\Actuals\Reverso AxI.xlsx`).
  Con PPA (no suma): `--con-ppa`. Proyecciones usan hoja **Budget**; Actuals por período
  (RunRate para Oct25-Mar26, Budget para Abr26-Mar27), solo sobre meses cerrados.
- **Realocaciones que tocan B2B se anulan** (2026-10-08, Tiago): filas `Origen = REALOCACIÓN` del xlsx
  de actuals. Por (mes, país, marca, línea), si alguna pata es B2B-MAY/MIN se ponen en 0 TODAS las patas
  (B2B + contrapartida B2C/B2B2C) → total compañía igual, B2B queda "sin realocar". Las que no tocan B2B
  quedan. Ver `drop_b2b_reallocations` en `plana_actuals_builder.py`. Afecta actuals, forecast (abr-jul) y
  baseline; para re-aplicar a meses ya promovidos: `--promote-month` de cada mes.
- **Payments & Fraud no se duplica con el Ajuste PYF** (2026-10-09, Tiago): en los meses donde el xlsx de actuals
  trae `Intercompany Transactions` con Origen `AJUSTES DE GESTION` (el "Ajuste PYF" de Control de Gestión), se
  pone en 0 la línea `Payments and Fraud` (Base FCCS) — si no, el Glosario mapea las dos a Intercompany y el costo
  se cuenta dos veces (jun-26: -3.76M total, -250k en B2B+B2B2C; OC H1 B2B+B2B2C quedaba 28.4 vs 28.6 de The Hub).
  Ver `drop_pyf_duplicated_by_ajuste` en `plana_actuals_builder.py`.
- **Canal**: solo **B2B** abre MAY/MIN; **B2B2C y B2C** se colapsan a `total` (en el JSON).
- **JSON agregado sobre Marca** (no se incluye).
- **Año fiscal = Abr(N-1) a Mar(N).** Proyecciones = FY27 (abr-2026 a mar-2027).
  Actuals por FY combina 2 archivos calendario en `Planning-PBI - Inputs Power Bi\Actuals\`
  (solapa **POWERBI**): Abr-Dic del (fy-1) + Ene-Mar del (fy). El nombre exacto del xlsx
  por año calendario está en `config.ACTUALS_FILENAMES` (hoy 2026 = `00 - Actuals 2026 - Plana Python - V2.xlsx`;
  los años que no figuran usan el patrón `00 - Actuals YYYY - Plana Python.xlsx`).
  **Ya NO se usa la carpeta `BITUBIA` para actuals** (Toqan discontinuado, 2026-09) — el equipo
  publica el xlsx directo en `Planning-PBI\Actuals\`.
- Homologación con `...\B2B & WLs\Proyectos IA\BITUBIA\Glosario.xlsx` (solapas Marca/Paises/Producto/LOB/Linea P&L) — el Glosario **sí** sigue en BITUBIA.
- **`forecast.json` compone ACTUALS + Forecast** (2026-09-15): meses en `config.FORECAST_ACTUALS_MONTHS`
  (hoy Abr-Jul'26, corte en `config.FORECAST_ACTUALS_CUTOFF`) salen de ACTUALS del FY en curso;
  el resto (Ago'26-Mar'27) sale del modelo Forecast crudo. Lo arma `json_builder.py` al construir
  el concepto `forecast` (no `plana_projections_builder.py`). **Requiere que existan los CSV de
  actuals del FY en curso** (`plana_actuals_builder.py <CURRENT_FY>` antes; en `run_all.bat` ya
  está en ese orden) — si no existen, `json_builder.py forecast` corta con error. Mover el corte
  un mes: editar `FORECAST_ACTUALS_CUTOFF` en `config.py` y volver a correr `/actualizar`.

- **`okr.json` se regenera solo** (2026-10-09): deriva de `baseline` + `budget`, así que `json_builder.py budget|all` y
  `baseline_builder.py` (al subir) llaman a `okr_builder.refresh_after_upload()`. Si falla, avisa y hay que correr
  `python okr_builder.py`. Además el Hub muestra un cartel "OKR desactualizado" si `okr.json` es anterior al
  último baseline/budget. Antes se corría a mano y quedó viejo (OKR Status ≠ Cuadro Resumen P&L).

- **H1 FY27 (abr-sep 2026) está congelado** (2026-10-27, decisión Diego): `okr_h1_freeze.py` guardó las filas de `okr.json`
  con Periodo <= 2026-09-01 (Run Rate/Actuals y Budget, USD nominales, **sin organic** — el organic es nuevo de H2 y no aplica al
  OKR contable) en Drive como `OKR_H1_FY27.json` (id `1wMCfuE8m8slzTN0CrWzoxJjTWOT9IMcf`). `okr_builder.py` ya NO recalcula
  esos meses: copia las filas del congelado y calcula solo H2 (si no puede leerlo, corta). El Hub lee H1 de ese archivo
  (`OKR_H1_FILE_ID` en `Codigo_OKR.js`). No volver a correr `okr_h1_freeze.py` (falla si el archivo existe; `--force` solo para
  corregir a propósito).

- **OKR H2 FY27 (oct-2026 → mar-2027)** (2026-10-27): `okr_builder.py` además de `okr.json` (Pais=Total, nominal, para el Daily y el
  Tracker) arma **`OKR_H2_FY27.json`** (`okr_h2_builder.py`, id `1lsMF9_d1t55boO8Wr8vziMsFT9LQioov`): KRs contables abiertos por país
  (Op. Contribution B2B2C, NR B2B, OC API/HTML, NR API Hoteles, New/Existing Account NR) + una columna `Estado`
  (Actual / Proyeccion / MTD / Real / Manual / Budget). El Hub lo lee para aplicar **organic al leer** (USD × TC Actuals / TC Budget por país y mes,
  solo KRs monetarios en Run Rate/Actuals; H1 nunca). Oct–mar es proyección (run rate) hasta que `actuals.json` traiga el cierre contable.
  Hunting = NR gestional del Daily (por país: `okr_budget`/`okr_runrate` ahora traen `pais`), Existing = NR contable B2B2C − Hunting.
  Regla del Hub: un KR sin dato en un mes toma el target (cursiva; en KRs acumulativos solo si no hay ningún dato real).
  **Unique Buyers** (`okr_h2_builder.apply_unique_buyers`): mes cerrado = real del Datalake; mes en curso = MTD; futuros = ratio UB/orders
  (promedio ponderado de los últimos 6 meses cerrados, hoy 0,837) × orders del Run Rate del Daily. Afecta también a `okr.json`.

## Archivos
- `pnl_common.py` — rutas portables (resuelve OneDrive por usuario) + auth Drive scope completo.
- `plana_projections_builder.py` — planas budget/forecast/RR/LRR (genérico por base).
- `plana_actuals_builder.py` — plana actuals por año fiscal.
- `json_builder.py` — planas → JSON canónico → Drive. Para `forecast`, además hace el blend
  con actuals descrito arriba (lee los CSV `actuals_fy*` ya generados, no re-corre el builder).
- `baseline_builder.py` — arma/actualiza `baseline_actuals+projections.json` (NO lo hace json_builder).
  Es la línea de tiempo FY27 = actuals[Abr..corte] + runrate[Ago,Sep] + forecast[Oct..Mar].
  Mensual: `python baseline_builder.py --promote-month YYYY-MM-01`
  (reemplaza solo ese mes, run-rate→actual, y deja el resto idéntico). Ya NO hace falta
  `--actuals-xlsx`: el default lee el V2 de `config.ACTUALS_FILENAMES`, que trae el mes cerrado.
  `--rebuild` reconstruye entero. Escribe en `_baseline_out/` **y** en la raíz del módulo
  (de la raíz lo lee `plana_to_cube.py`).
- `auth_drive.py` / `run_all.bat` / `LEEME.txt`.
- Secretos (NO versionar ni compartir): `credentials_drive.json` (client OAuth, compartido) y `token_drive.json` (personal, cada uno el suyo).

## Fuente del RunRate (cambió 2026-10-26)
- El RunRate ya no sale de `Planning-PBI\Run Rate\RR - Legal Entity ALL/NA - 27.csv`: ahora es
  `...\B2B & WLs\Base_P&L_Contable\RunRate.csv` (`config.BASES["runrate"]["flat_file"]`).
- Formato plano: `;` + coma decimal, una fila por línea × mes (`mes` = mes calendario, `year` = FY27),
  etiquetas legibles (`Brazil`, `Air`, `GB NAC`…). Lo lee `read_flat_base` en `plana_projections_builder.py`;
  las líneas/países que no matchean el Glosario tal cual se traducen en `FLAT_LINEA_MAP` / `FLAT_PAIS_MAP`
  (si aparece una línea nueva en el archivo, sumarla ahí). `Leases` / `Leases Adjustment` se descartan
  (se netean entre sí). LoB `Stays` queda afuera por `LOBS_KEEP`.
- Control: con `--con-ppa`, GB y NR de la plana cierran exacto contra el CSV crudo.
- **Limitación temporal (2026-10-26, decisión Diego):** el `runrate.json` publicado llega solo hasta
  **Operating Contribution** — la descarga no trae costos fijos (G&A, IT, D&A, Sourcing, Equity) → EBITDA y
  debajo quedan subestimados en Oct'26-Mar'27. Cubre solo Oct-Mar (antes 12 meses; Abr-Ago del RR viejo eran
  valores parciales sin uso). Se completa más tarde con otra descarga (`RunRate_2.csv` con solo las líneas de
  costos fijos; el guard de duplicados es por mes × LoB × línea). Se subió con `PNL_ALLOW_SHRINK=1`.
- **La exportación corta en 300.000 filas sin avisar** (ordenada por línea → se pierden las líneas
  alfabéticamente últimas: Up Front Incentives, Revenue Taxes, Loyalty…). Oct-Mar no entra en un archivo:
  bajarlo en partes (`RunRate.csv` + `RunRate_2.csv`…; se leen todos los `RunRate*.csv`). Se puede partir por mes, LoB o línea (cada mes × LoB × línea en un solo archivo). Un archivo con exactamente 300.000 filas hace cortar el builder.

## Escenario "Forecast - Bridge to budget" (2026-10-26)
- Base `forecastbtb` → `forecastbtb.json` (Drive id `1anL-CsItySxuWTp4FuX69tHsAy9oz4rp`). **No reemplaza al Forecast.**
- Fuente: `...\B2B & WLs\Base_P&L_Contable\Forecast_Stretch_BTB*.csv` (formato plano, igual que el RunRate).
  Igual que `forecast.json`: meses `FORECAST_ACTUALS_MONTHS` (Abr-Jul) salen de actuals; Ago-Mar del archivo.
  `json_builder.py` frena si falta algún mes del modelo (Ago-Mar) en forecast o forecastbtb.
- Por ahora **solo hasta Operating Contribution** (la descarga no trae costos fijos): vs BTB, GB y NR son iguales
  al Forecast y la diferencia está en la OC; EBITDA y debajo no son comparables hasta sumar los costos fijos.
- Lo leen solo las capas de Ownia: P&L Accounting (`server/gas-extras/pnl-accounting-fbtb.js`) y el Hub
  (`JSON_IDS.forecastbtb`, Goal "Forecast - Bridge to budget" = goal forecast con `fcSource: 'btb'`).

## Gotchas (aprendidos, para no re-descubrir)
- Los CSV de Planning-PBI vienen con **cada fila envuelta en comillas** y comillas internas duplicadas → hay parser especial (unwrap + `""`→`"`).
- Algunos `00 - Actuals` traen los headers de fecha como **datetime** (no string) → se normalizan.
- Auth de Drive usa **scope `drive` completo** (no el token de clasp `drive.file`) para poder sobrescribir archivos creados por otros del equipo (si no, error 403 appNotAuthorizedToFile).
- `stdout` se fuerza a UTF-8 (consola Windows cp1252 crasheaba con acentos/flechas).

## Pendiente
- Completar `Glosario.xlsx` con códigos sin mapear (países `c/m_*`, productos `prd_*`,
  LOB-CANAL, y líneas: `Alianzas Financieras`, y decidir `Intercompany Income` / `Leases Interest` mapear-o-excluir) → luego re-correr `run_all.bat` (debe dar 0 sin resolver).
- Actuals FY2024/2025/2026: correr 1 vez y dejar los CSV (histórico de `actuals.json`).
- Fase 2: repuntear las landings de P&L_Projections_Reviews y Dashboard_B2B_WLs a estos JSON.

## Qué hacer si el usuario pide "actualizar"
Correr las planas + `json_builder.py all` (o `run_all.bat`), verificar la salida de
validación (nulos, países, total) y confirmar que los 5 JSON subieron a Drive.
Si aparece error de auth, indicar `python auth_drive.py`.
