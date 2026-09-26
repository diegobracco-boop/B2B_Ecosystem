# Proceso_Distribucion_Diaria — distribución diaria del Run Rate B2B + B2B2C

## Qué hace

Toma las proyecciones **mensuales** del Run Rate (modelos Excel de WLs, API y HTML) y las abre a
nivel **diario** con los factores de estacionalidad. Opcionalmente (y es lo normal) **toma los
reales hasta una fecha de corte** y solo reparte el **remanente** (proyección del mes − real) en los
días que faltan. El resultado es el CSV que se carga en `raw.b2brr_gd` (base GD) y
`raw.b2brr_ri` (base RI) del Datalake.

```
Run Rate/<semana>/Inputs Python/          Estacionalidad Diaria/                    Datalake (VPN)
  WLs  - Modelo Run Rate*.xlsx  [P&L]       Factor diario GD - WLs.xlsx  [B2B2C]     reales diarios con las
  API  - Modelo Run Rate*.xlsx  [P&L Emision | P&L RI]   Factor GD|RI - B2B [MAY]    MISMAS queries del Daily
  HTML - Modelo Run Rate*.xlsx  [P&L Emision | P&L RI]   Factor GD - B2B    [MIN]    (daily_sync.py)
                    │                                                                     │
          distribucion_diaria.py --base GD|RI --reales-hasta AAAA-MM-DD|no  ◄─────────────┘
                    │
Run Rate/<semana>/Distribucion Diaria/
  base_consolidada_diaria_{GD|RI}_<ts>_reales-<corte>.csv  → carga MANUAL a raw.b2brr_gd / raw.b2brr_ri
  conciliacion_{GD|RI}_<ts>_...csv                          → modelo vs salida por negocio × mes
  reales_{GD|RI}_<ts>_...csv                                → real / remanente por negocio × mes
                    │
  consumen: Daily_Dashboard/daily_sync.py (Run Rate del Daily) · P&L_Managerial
```

Las rutas son de la biblioteca de OneDrive "Control de Gestión" (`B2B & WLs/` del año fiscal).
El script la autodetecta según cómo la tenga sincronizada cada usuario; si no la encuentra, usar
`--raiz` o la variable `B2B_WLS_DIR`.

## Cómo correrlo

Con Claude: `/distribucion-diaria` (desde la raíz del repo). A mano:

```powershell
cd Proceso_Distribucion_Diaria
python distribucion_diaria.py --base GD --reales-hasta 2026-09-25 --dry-run   # controla sin guardar
python distribucion_diaria.py --base GD --reales-hasta 2026-09-25             # guarda
python distribucion_diaria.py --base RI --reales-hasta 2026-09-25
python distribucion_diaria.py --base GD --reales-hasta no                     # solo proyección (sin VPN)
python distribucion_diaria.py --base GD --reales-hasta 2026-09-25 --semana "2026.09.14 - W37"
```

- `--reales-hasta` es **obligatorio** y lo define quien corre: el último día (incluido) que se toma
  como real. Tiene que ser ≤ al último día cargado en el Datalake (si no, corta). Con fecha necesita
  VPN + `credenciales/.env.<usuario>` (igual que `daily_sync.py`).
- Semana por defecto: la última carpeta de `Run Rate/` que tenga `Inputs Python/`.
- La primera lectura de cada Excel tarda (los de factores pesan 30-60 MB); queda cacheada en
  `.cache/` (gitignoreada) y se invalida sola si el archivo cambia.
- **La carga al Datalake sigue siendo manual** (fuera del script). El nombre del CSV lleva el corte.

## Reglas de negocio

| Negocio | lob_canal | Modelo / hoja GD | Hoja RI | Mes usado | Factor GD | Factor RI |
|---|---|---|---|---|---|---|
| B2B2C | B2B2C-* | WLs · `P&L` | `P&L` (la misma) | `mes_ri` | GD - WLs | GD - WLs (el mismo) |
| B2B-MAY | API → B2B-MAY | API · `P&L Emision` | `P&L RI` | GD `mes_venta` / RI `mes_ri` | GD - B2B | RI - B2B |
| B2B-MIN | HTML → B2B-MIN | HTML · `P&L Emision` | `P&L RI` | GD `mes_venta` / RI `mes_ri` | GD - B2B | **GD - B2B** |

- **B2B2C** tiene un único criterio de reconocimiento → sale idéntico en GD y RI (a propósito).
- **HTML** por ahora no tiene desfase GD/RI en el modelo y el archivo de factores RI no tiene hoja
  B2B-MIN → en RI usa el factor GD. Cambia cuando se modifique el modelo.
- **B2B2C** cruza por partner; si el partner no tiene factor propio usa el de partner `Todos`.
- **Paraguay y Uruguay** usan los factores de `Other Countries` y salen etiquetados así.
- **NR y FVM se recalculan** con la fórmula oficial (misma que las queries de actuals):
  NR = up_front + fees + commercial_discounts + cancellations + outsourced + back_end + other_incentives + breakage + media + revenue_tax + loyalty;
  FVM = NR + installments + CCP + white_labels_api + affiliates + customer_service + errors + frauds + intercompany + claims + other_taxes + vendor_commissions + dif_fx + hedge + financial_results + mkt.
- `loyalty_usd` y `mkt_usd` (agregadas 2026-09, al final del CSV): hoy vienen en 0 en el modelo;
  quedan mapeadas por si se prenden. **`raw.b2brr_gd/ri` tiene que tener esas 2 columnas** para la carga.
- Se descartan las filas diarias donde GB, up front, fees, NR y FVM son todos 0 (achica el CSV ~3x).

### Reales + remanente (`--reales-hasta`)

Para cada mes que arranca antes del corte:

1. **Días ≤ corte = real.** Reales diarios de las mismas queries que usa el Daily
   (`reales.py` ejecuta las de `Daily_Dashboard/daily_sync.py`, no las copia): B2B2C por fecha de
   confirmación (igual en GD y RI), B2B GD por fecha de gestión, B2B RI por fecha de reconocimiento.
   Verificado W37 con corte 25/09: los días reales de la salida = reales del Daily, día por día.
2. **Cruce real → filas de la proyección**, del nivel más fino al más grueso:
   B2B2C `país+viaje+partner+producto` → `país+viaje+partner`; B2B `canal+país+viaje+producto` →
   `canal+país+viaje` → `canal+país`. Dentro del nivel, el real se reparte entre las filas según su
   GB proyectado. Lo que no cruza (ej. partner que no está en el modelo) va como **fila propia con
   escenario `Real`** y se avisa.
3. **Remanente = proyección del mes − real**, por grupo (B2B2C país×viaje×partner; B2B
   canal×país×viaje), para órdenes, GB, NR y FVM. Se reparte entre las filas del grupo según lo que
   le falta a cada una y en los días que faltan con los factores re-normalizados sobre esos días.
   → el mes cierra = proyección.
4. **Si el real del grupo ya superó la proyección** (en su signo): días que faltan en 0 y el mes
   cierra = real (decisión de Diego, 2026-09-26). Se reporta como `grupos_topeados` / `gb_exceso`.
5. **Componentes del P&L**: los reales solo traen NR/FVM totales; cada componente (fees, up front…)
   de los días reales y del remanente se abre con el mix de la proyección de esa fila (si el mix es
   inestable, el del negocio×mes). Así, sin tope, cada componente del mes = proyección.
6. Si un mes ya terminó al corte, queda 100% real (sin remanente).

El resumen imprime `gb_dia_real` vs `gb_dia_rem`: si el ritmo que implica el remanente es muy
distinto al real, el Run Rate está desactualizado (ej. W37 corte 25/09: B2B2C real 2,2M/día y el
remanente implica 4,4M/día los últimos 5 días).

Consecuencia en el Daily: hasta el corte, real vs Run Rate da 0 (son lo mismo); la comparación
tiene sentido para los días posteriores al corte.

## Controles (bloqueantes: si falla uno, no se guarda nada)

1. Toda fila del modelo con importes encuentra factor.
2. Los factores de cada grupo (mes, año, país, viaje[, partner]) suman 1.
3. **Conservación** (meses sin reales): por negocio × mes × país, cada métrica suma igual que el modelo.
4. **Reales**: por fila, componentes = real + remanente (NR, FVM, GB).
5. Cada fecha cae en su mes/año proyectado. El corte no puede pasar el último día del Datalake.
6. **Columnas desconocidas**: si el modelo trae una columna numérica con importes que el script no
   conoce (ej. alguien renombra `media_other_revenue`), corta. Se mapea en `ALIAS_COLUMNAS`.

**Aviso (no bloquea):** si el NR/FVM recalculado difiere del `net_revenue`/`npv` del Excel en más
de USD 100 por negocio × mes → hay una fórmula inconsistente dentro del modelo.

## Factores de estacionalidad — diagnóstico (2026-09-26)

Cómo se arman hoy (Excel, `Estacionalidad Diaria/`):
`Factor combinado = 0,65 × Factor 1 + 0,35 × Factor 2`, normalizados por mes × país × viaje (× partner).
- **Factor 1 (día de semana × semana del mes):** GB histórico del mismo día de semana y misma
  "semana del mes" (1-5) sobre el promedio, en una ventana fija (hoy 31/03/2025 → 31/07/2026).
- **Factor 2 (tipo de día):** peso de feriados / eventos / pre/post (hoja `Calendario`) vs día normal,
  ventana fija (01/01/2024 → 31/01/2026).
- La historia es la hoja `Base Reales` (pegada a mano, ~420k filas) y todo se recalcula con SUMIFS.

Backtest ene–ago 2026 (share del mes mal asignado entre días, ponderado por GB; menor = mejor):

| Caso | Excel (in-sample) | Promedio día de semana 12 sem. | Python prototipo (dow + feriados, out-of-sample) |
|---|---|---|---|
| B2B2C | 11,4% | 10,4% | **10,1%** |
| B2B-MAY GD | 9,1% | 7,8% | **7,7%** |
| B2B-MIN GD | 9,7% | 8,6% | **7,9%** |
| B2B-MAY RI | 8,3% | 8,2% | **8,1%** |

- Los factores Excel **pierden contra un promedio simple por día de semana**, aun evaluados sobre
  meses que están dentro de su propia ventana de cálculo.
- **Sesgo en B2B2C días 29-31:** el factor les asigna el 59% de lo que realmente pesan (y los días
  1-28 quedan ~4% arriba) → a mitad de mes el Run Rate de B2B2C "va adelantado" ~3-4%. Probable
  causa: Factor 1 suma el GB de la "semana 5" (días 29-31, que ocurren pocas veces) en vez de
  promediarlo.
- Recomendación: migrar a Python (historia desde el Datalake con las mismas queries, ventana
  móvil, calendario de eventos como único input manual, backtest automático en cada corrida).

## Historia / bugs conocidos

- **Hasta W37 (2026-09), NR y FVM del Run Rate subestimados.** Los notebooks (`legacy/`) buscaban
  `media_revenue`, `financial_results` y `hedge`, pero el modelo trae `media_other_revenue`,
  `efecto_financiero` y `currency_hedge`/`curency_hedge` → esas líneas quedaban en 0. W37 base GD:
  NR −4,95M (≈−3,5%) y FVM −5,53M (≈−12,5%) en sep-26→mar-27; RI: NR −4,38M (≈−3%), FVM −5,11M (≈−12%). El GB estaba
  bien. Verificado: `raw.b2brr_gd/ri` = CSV de los notebooks fila por fila. El control de "suma de
  factores" de los notebooks agrupaba mal y daba siempre "84/84 con error", por eso no se detectó.
- **Modelo API `P&L RI` W37:** 21 filas Brasil / International / Hotels donde `net_revenue` del
  Excel no es la suma de sus componentes (NR recalculado +53k total; FVM sí cierra). Revisar el Excel.

## Archivos

- `distribucion_diaria.py` — el proceso.
- `reales.py` — reales diarios (ejecuta las queries de `Daily_Dashboard/daily_sync.py`).
- `legacy/` — notebooks originales (Antonella), solo referencia.
- `*.xlsx` en esta carpeta — copias de referencia de los factores/eventos (gitignoreadas; la fuente
  es `Estacionalidad Diaria/` en OneDrive). Los factores se arman en Excel, fuera de este script.

## Pendientes

- Sumar la carga a `raw.b2brr_*` al script (ver con Antonella). Agregar `loyalty_usd`/`mkt_usd` a las tablas.
- Migrar los factores a Python (ver diagnóstico).
- Cuando HTML tenga desfase GD/RI: agregar hoja `Factores B2B-MIN` al factor RI y cambiar `NEGOCIOS`.
