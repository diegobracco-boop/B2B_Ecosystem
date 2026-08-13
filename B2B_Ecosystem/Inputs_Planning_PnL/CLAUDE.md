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
- **Canal**: solo **B2B** abre MAY/MIN; **B2B2C y B2C** se colapsan a `total` (en el JSON).
- **JSON agregado sobre Marca** (no se incluye).
- **Año fiscal = Abr(N-1) a Mar(N).** Proyecciones = FY27 (abr-2026 a mar-2027).
  Actuals por FY combina 2 archivos calendario (`00 - Actuals YYYY - Plana Python.xlsx`
  en `...\B2B & WLs\Proyectos IA\BITUBIA`): Abr-Dic del (fy-1) + Ene-Mar del (fy).
- Homologación con `...\BITUBIA\Glosario.xlsx` (solapas Marca/Paises/Producto/LOB/Linea P&L).

## Archivos
- `pnl_common.py` — rutas portables (resuelve OneDrive por usuario) + auth Drive scope completo.
- `plana_projections_builder.py` — planas budget/forecast/RR/LRR (genérico por base).
- `plana_actuals_builder.py` — plana actuals por año fiscal.
- `json_builder.py` — planas → JSON canónico → Drive.
- `baseline_builder.py` — arma/actualiza `baseline_actuals+projections.json` (NO lo hace json_builder).
  Es la línea de tiempo FY27 = actuals[Abr..corte] + runrate[Ago,Sep] + forecast[Oct..Mar].
  Mensual: `python baseline_builder.py --promote-month YYYY-MM-01 --actuals-xlsx <Excel con el mes cerrado>`
  (reemplaza solo ese mes, run-rate→actual, y deja el resto idéntico). `--rebuild` reconstruye entero.
- `auth_drive.py` / `run_all.bat` / `LEEME.txt`.
- Secretos (NO versionar ni compartir): `credentials_drive.json` (client OAuth, compartido) y `token_drive.json` (personal, cada uno el suyo).

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
