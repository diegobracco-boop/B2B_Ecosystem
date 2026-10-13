# -*- coding: utf-8 -*-
"""
hunting_rules.py
================
Definición ÚNICA de qué partner B2B2C cuenta como "New" (hunting) y cuál como "Existing"
(farming). La usan:
  - Daily_Dashboard/daily_sync.py        -> flag New/Existing del Daily y de los KRs
                                            New/Existing Account Net Revenues (okr_builder.py)
  - P&L_Managerial/actuals_gestional_upload.py -> mapa "b2b2c_stage" que la landing usa para
                                            el split Hunting/Farming (Codigo.js)

Regla: stage de la cartera de ComDev (raw.comdev_cartera_b2b2c_historic, is_current) y encima
los overrides de negocio de abajo. Partner que no está en la cartera -> Existing.
Para cambiar quién es hunting, se toca SOLO acá y se re-corren los dos pipelines.
"""

import pandas as pd

# Partners que el equipo cuenta como "New / onboarding" aunque la cartera de
# ComDev no los marque asi (nombre distinto, alta reciente sin actualizar, etc.).
# Xcaret se sacó el 2026-10-13 (decisión de Diego: no es hunting; la cartera ya lo marca Existing).
FORCE_NEW_PARTNERS = {"livelo-api-hoteles", "didi", "bonda"}
# Al revés: la cartera los marca New pero el equipo NO los cuenta como hunting
# (decisión de Diego 2026-10-13: New Fly).
FORCE_EXISTING_PARTNERS = {"new fly"}

CARTERA_STAGE_QUERY = """
SELECT partner_homologado_2, MAX(stage) AS stage
FROM raw.comdev_cartera_b2b2c_historic
WHERE partner_homologado_2 IS NOT NULL
  AND LOWER(is_current) = 'true'
GROUP BY partner_homologado_2
"""


def norm_partner(p) -> str:
    return str(p).strip().lower()


def apply_overrides(cartera_map: dict) -> dict:
    """Pisa el mapa {partner normalizado: stage} con los overrides de negocio (in place)."""
    for p in FORCE_NEW_PARTNERS:
        cartera_map[p] = "New"
    for p in FORCE_EXISTING_PARTNERS:
        cartera_map[p] = "Existing"
    return cartera_map


def stage_map(df_cartera: pd.DataFrame) -> dict:
    """{partner normalizado: 'New'|'Existing'} desde filas de la cartera (partner_homologado_2,
    stage). Si un partner tiene más de un stage (por país), gana MAX, igual que en el Daily."""
    d = df_cartera.assign(_p=df_cartera["partner_homologado_2"].map(norm_partner))
    m = d.groupby("_p")["stage"].max().dropna().to_dict()
    return apply_overrides(m)
