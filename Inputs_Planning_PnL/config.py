"""
config.py — Configuración del proyecto. Actualizar al inicio de cada año fiscal.

Solo hay que cambiar los tres valores de la sección "Editar cada FY".
Todo lo demás se deriva automáticamente.
"""

# ── Editar cada FY ────────────────────────────────────────────────────────────
CURRENT_FY = 2027
FORECAST_VERSION = "2026.07.14"   # actualizar cuando el equipo confirme un nuevo modelo
DRIVE_FOLDER_ID = "1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV"

# ── Derivados del FY (no editar) ──────────────────────────────────────────────
_FY_PREV = CURRENT_FY - 1
_FY_SHORT = str(CURRENT_FY)[-2:]

GESTION_FOLDER = f"Control de Gestión - {_FY_PREV}-{_FY_SHORT}"

# Meses del año fiscal: Abr(FY-1) → Mar(FY)
FISCAL_DATES = (
    [f"{_FY_PREV}-{m:02d}-01" for m in range(4, 13)] +
    [f"{CURRENT_FY}-{m:02d}-01" for m in range(1, 4)]
)

# Forecast: los primeros 4 meses del FY aún no están proyectados → se excluyen
FORECAST_DROP_DATES = set(FISCAL_DATES[:4])

# Composición del baseline FY
# RunRate cubre desde Ago(FY-1) hasta el cierre del FY (Mar) -> Forecast no se usa
# en el baseline (2026-08-24: RunRate es la fuente más actualizada, Forecast desactualizado).
RUNRATE_MONTHS  = (
    {f"{_FY_PREV}-{m:02d}-01" for m in range(8, 13)} |
    {f"{CURRENT_FY}-{m:02d}-01" for m in range(1, 4)}
)
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
    "forecast_v2": {
        "files": ["Forecast/FQ1 - Legal Entity ALL V2.csv",
                  "Forecast/FQ1 - Legal Entity NA V2.csv"],
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
