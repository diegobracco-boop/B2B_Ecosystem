# -*- coding: utf-8 -*-
"""
pais_rules.py
=============
Definición ÚNICA del país de los partners B2B2C que las proyecciones (Budget, Run Rate,
Forecast) traen cargados en un país distinto al real. Se aplica SOLO a proyecciones: los
actuals ya salen con el país real de la transacción. La usan:
  - Daily_Dashboard/daily_sync.py               -> budget / run rate (clean_budget) y forecast
                                                   (_load_forecast_diario)
  - P&L_Managerial/actuals_gestional_upload.py  -> budget / run rate / forecast XLSX B2B2C
  - P&L_Managerial/projections_gestional_builder.py -> forecast XLSX WLs

Para corregir el país de otro partner, se toca SOLO acá y se re-corren los pipelines.
"""

import pandas as pd

# partner (normalizado: strip + lower) -> país correcto
PAIS_OVERRIDES = {
    "cutc":  "USA",        # el plan lo carga en otro país; vende en USA
    # Budget (marca Despegar) y Forecast (marca Best Day) la cargaron en Mexico por error;
    # vende en Argentina (canal affiliate-bonda, cartera HISPA). Decisión de Gregorio 2026-10-14.
    "bonda": "Argentina",
}


def apply_pais_overrides(df: pd.DataFrame, partner_col: str = "partner", pais_col: str = "pais") -> pd.DataFrame:
    """Pisa el país de los partners de PAIS_OVERRIDES (in place). No hace nada si faltan columnas."""
    if partner_col not in df.columns or pais_col not in df.columns:
        return df
    p = df[partner_col].astype(str).str.strip().str.lower()
    for partner, pais in PAIS_OVERRIDES.items():
        df.loc[p == partner, pais_col] = pais
    return df
