"""
config.py — Configuración del proyecto. Actualizar al inicio de cada año fiscal.

Solo hay que cambiar los tres valores de la sección "Editar cada FY".
Todo lo demás se deriva automáticamente.
"""

# ── Editar cada FY ────────────────────────────────────────────────────────────
CURRENT_FY = 2027
FORECAST_VERSION = "2026.07.14"   # actualizar cuando el equipo confirme un nuevo modelo
DRIVE_FOLDER_ID = "1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV"

# ── Actuals: fuente de los reales contables ───────────────────────────────────
# El equipo dejó de usar la carpeta BITUBIA para actuals (Toqan discontinuado,
# 2026-09). Ahora los xlsx viven en <OneDrive>\Planning-PBI - Inputs Power Bi\Actuals\.
# Nombre exacto del xlsx por AÑO CALENDARIO; si un año no figura acá se usa el
# patrón default. Solapa siempre "POWERBI".
# El equipo SOBRESCRIBE este mismo archivo cada mes — el nombre no cambia
# ("- V2" es fijo, no hay V3/V4). El pipeline imprime nombre + mtime del xlsx
# que abrió: si el mtime quedó viejo, es que OneDrive no sincronizó (no un
# cambio de nombre).
ACTUALS_FILENAMES = {
    2026: "00 - Actuals 2026 - Plana Python - V2.xlsx",
}
ACTUALS_FILENAME_DEFAULT = "00 - Actuals {year} - Plana Python.xlsx"

# ── Derivados del FY (no editar) ──────────────────────────────────────────────
_FY_PREV = CURRENT_FY - 1
_FY_SHORT = str(CURRENT_FY)[-2:]

GESTION_FOLDER = f"Control de Gestión - {_FY_PREV}-{_FY_SHORT}"

# Meses del año fiscal: Abr(FY-1) → Mar(FY)
FISCAL_DATES = (
    [f"{_FY_PREV}-{m:02d}-01" for m in range(4, 13)] +
    [f"{CURRENT_FY}-{m:02d}-01" for m in range(1, 4)]
)

# ── Dos cortes DISTINTOS (no confundir) ───────────────────────────────────────
# LAST_CLOSED_MONTH: último mes con actuals cerrados. Se mueve cada vez que cierra un mes y
#   define desde dónde arranca el RunRate del baseline (RUNRATE_MONTHS, abajo).
#   Agosto cerró el 2026-09-16.
LAST_CLOSED_MONTH = "2026-08-01"

# FORECAST_ACTUALS_CUTOFF: base de la ronda de Forecast vigente. El Forecast es una foto:
#   actuals hasta este mes + proyección del modelo Forecast después (hoy: actuals abr-jul,
#   Forecast ago-mar). NO se mueve cuando cierra un mes — solo cuando se publica una ronda
#   nueva de Forecast. Lo usan forecast.json (json_builder), la plana del Forecast
#   (plana_projections_builder, FORECAST_DROP_DATES) y el goal Forecast de P&L_Managerial
#   (actuals_gestional_upload.py lo importa de acá). Diego, 2026-09-26.
FORECAST_ACTUALS_CUTOFF = "2026-07-01"
FORECAST_ACTUALS_MONTHS = set(FISCAL_DATES[:FISCAL_DATES.index(FORECAST_ACTUALS_CUTOFF) + 1])

# Meses que se excluyen del modelo Forecast crudo porque forecast.json los reemplaza
# por ACTUALS (mismo set que FORECAST_ACTUALS_MONTHS).
FORECAST_DROP_DATES = FORECAST_ACTUALS_MONTHS

# Composición del baseline FY
# RunRate cubre desde el mes siguiente al último actual cerrado hasta el cierre del FY
# (Mar) -> Forecast no se usa en el baseline (2026-08-24: RunRate es la fuente más
# actualizada, Forecast desactualizado). Mover el arranque cuando cierre un nuevo mes
# (agosto cerró 2026-09-16: arrancaba en Ago, dejaba Ago duplicado con los actuals del
# propio baseline — rebuild() no dedupea, solo concatena actuals+runrate+forecast).
RUNRATE_MONTHS  = {d for d in FISCAL_DATES if d > LAST_CLOSED_MONTH}   # derivado del corte
FORECAST_MONTHS = set()

# AXI actuals: RunRate cubre Oct(FY-2)..Mar(FY-1)
AXI_RR_DATES = (
    {f"{CURRENT_FY - 2}-{m:02d}-01" for m in range(10, 13)} |
    {f"{_FY_PREV}-{m:02d}-01" for m in range(1, 4)}
)

# Archivos CSV de entrada por escenario
BASES = {
    "budget": {
        "files": [f"Budget/Budget {CURRENT_FY} - Legal Entity ALL.csv",
                  f"Budget/Budget {CURRENT_FY} - Legal Entity NA.csv"],
        "is_forecast": False,
    },
    "forecast": {
        "files": ["Forecast/FQ1 - Legal Entity ALL.csv",
                  "Forecast/FQ1 - Legal Entity NA.csv"],
        "is_forecast": True,
    },
    "runrate": {
        "files": [f"Run Rate/RR - Legal Entity ALL - {_FY_SHORT}.csv",
                  f"Run Rate/RR - Legal Entity NA - {_FY_SHORT}.csv"],
        "is_forecast": False,
    },
    "lastrunrate": {
        "files": ["Run Rate/LRR - Legal Entity ALL.csv",
                  "Run Rate/LRR - Legal Entity NA.csv"],
        "is_forecast": False,
    },
}
