# -*- coding: utf-8 -*-
"""
canal_rules.py
==============
Definición ÚNICA del canal de venta de B2B2C: Online / Call Center / Islas / Tiendas, el mismo corte que el
lob_canal de Budget, Run Rate y Forecast (B2B2C-ON / B2B2C-CALL CENTER / B2B2C-OFF). La usan:
  - P&L_Managerial/actuals_gestional_upload.py  -> filtro Canal del P&L Managerial (2026-11-17)
  - Daily_Dashboard/daily_sync.py               -> filtro Canal del Daily B2B2C (2026-11-23)

En los reales sale de la transacción (alias `t` = bi_transactional_fact_transactions):
  Call Center      parent_channel 'White Label Call Center' (bestday-call-*, bestday-b2b2c-call: Televentas de Naranja y BCI,
                   yavas-callcenter) o agencia "... - Call Center" (Banco de Chile, AG00120475)
  Islas / Tiendas  parent_channel 'Islas WL' (islas de Liverpool y Elektra), canales "*-off" (latam-airlines-off,
                   bci-benefits-off), yavas-agencias o agencia "... - Presencial" (Banco de Chile, AG00120467): todo lo off,
                   islas, tiendas y agencias
  Online           el resto
En las proyecciones sale del lob_canal; lo que no es CALL CENTER ni OFF (incluido 'B2B2C' a secas) va a Online.
"""

import pandas as pd

CANAL_ONLINE, CANAL_CALL, CANAL_ISLAS = "Online", "Call Center", "Islas / Tiendas"
CANALES_B2B2C = (CANAL_ONLINE, CANAL_CALL, CANAL_ISLAS)

CANAL_B2B2C_SQL = f"""CASE
      WHEN t.parent_channel = 'White Label Call Center'
        OR COALESCE(t.agency_fantasy_name, '') LIKE '%Call Center%'      THEN '{CANAL_CALL}'
      WHEN t.parent_channel = 'Islas WL' OR t.channel LIKE '%-off' OR t.channel = 'yavas-agencias'
        OR COALESCE(t.agency_fantasy_name, '') LIKE '%Presencial%'       THEN '{CANAL_ISLAS}'
      ELSE '{CANAL_ONLINE}'
    END"""

# lob_canal de Budget / Run Rate / Forecast -> canal
CANAL_DE_LOB = {"B2B2C-ON": CANAL_ONLINE, "B2B2C-CALL CENTER": CANAL_CALL, "B2B2C-OFF": CANAL_ISLAS}


def canal_de_lob(s: pd.Series) -> pd.Series:
    return s.astype(str).str.strip().str.upper().map(CANAL_DE_LOB).fillna(CANAL_ONLINE)
