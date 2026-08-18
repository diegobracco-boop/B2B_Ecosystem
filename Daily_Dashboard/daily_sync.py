# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
"""
daily_sync.py
=============
1. Conecta al Datalake (Treasure Data vía ODBC)
2. Baja actuals B2B2C + LY + Budget
3. Genera un JSON compacto
4. Lo sube a Google Drive (carpeta DailyDashboard)

Run manual : python daily_sync.py
Scheduler  : Windows Task Scheduler → daily 08:00 AM
"""

import os
import json
from pathlib import Path
import warnings
from datetime import date, timedelta, datetime

import pandas as pd
from dotenv import load_dotenv

warnings.filterwarnings("ignore")

# ==============================================================================
# 1) CONFIGURACIÓN
# ==============================================================================

_win_user  = os.environ.get("USERNAME", "").lower()
RUTA_ENV   = Path(__file__).resolve().parent.parent / "credenciales" / f".env.{_win_user}"
DSN_NAME   = "DataLake Treasure ODBC"

DRIVE_FOLDER_ID   = "1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh"
JSON_FILE_NAME    = "daily_b2b2c_data.json"
B2B_JSON_FILE_NAME = "daily_b2b_data.json"

# Fechas — historial desde ene del año en curso
TODAY            = date.today()
YESTERDAY        = TODAY - timedelta(days=1)
MONTH_START      = date(TODAY.year, TODAY.month, 1)

ACTUALS_FROM = date(TODAY.year, 1, 1)
LY_FROM      = date(TODAY.year - 1, 1, 1)
LY_TO        = YESTERDAY.replace(year=YESTERDAY.year - 1)

# Nombres de mes en español — budget incluye todos los meses ene->actual
MESES_ES = {
    1:'Enero', 2:'Febrero', 3:'Marzo', 4:'Abril',
    5:'Mayo', 6:'Junio', 7:'Julio', 8:'Agosto',
    9:'Septiembre', 10:'Octubre', 11:'Noviembre', 12:'Diciembre'
}
YEAR_BUDGET      = TODAY.strftime("%y")                          # '26'
YEAR_BUDGET_NEXT = str((TODAY.year + 1) % 100).zfill(2)         # '27'

print(f"[{TODAY}]  Actuals: {ACTUALS_FROM}->{YESTERDAY}  |  LY: {LY_FROM}->{LY_TO}  |  Budget FY: {YEAR_BUDGET}/{YEAR_BUDGET_NEXT}")

# ==============================================================================
# 2) CONEXIÓN AL DATALAKE
# ==============================================================================

load_dotenv(RUTA_ENV)
DB_USER     = os.getenv("USER")
DB_PASSWORD = os.getenv("PASSWORD")


def conectar():
    import pyodbc
    return pyodbc.connect(
        f"DSN={DSN_NAME};UID={DB_USER};PWD={DB_PASSWORD};",
        autocommit=True
    )


# ==============================================================================
# 3) QUERIES
# ==============================================================================

COLS_ACTUALS = [
    "fecha", "pais", "productooriginal", "channel", "partner", "viaje",
    "account_type", "region",
    "orders", "gross_bookings", "net_revenues", "fvm"
]


def build_actuals_query(date_from: date, date_to: date) -> str:
    return f"""
WITH base AS (
SELECT
    t.confirmation_date AS fecha,
    CASE
        WHEN t.country_code IN ('MX','BR','CO','AR','EC','PE','CL','US') THEN
            CASE t.country_code
                WHEN 'MX' THEN 'Mexico'    WHEN 'BR' THEN 'Brasil'
                WHEN 'CO' THEN 'Colombia'  WHEN 'AR' THEN 'Argentina'
                WHEN 'EC' THEN 'Ecuador'   WHEN 'PE' THEN 'Peru'
                WHEN 'CL' THEN 'Chile'     WHEN 'US' THEN 'USA'
            END
        ELSE 'Other Countries'
    END AS pais,
    CASE
        WHEN t.purchase_type IN ('Vuelos','Bundles','Escapadas','Carrito')
          AND p.product_type = 'Asistencia al viajero'
          AND p.attach_stage = 'CHECKOUT'                     THEN 'Insurance'
        WHEN t.purchase_type = 'Actividades'                 THEN 'Dest. Serv.'
        WHEN t.purchase_type = 'Alquileres'                  THEN 'Vacation Rentals'
        WHEN t.purchase_type = 'Asistencia al viajero'       THEN 'Insurance'
        WHEN t.purchase_type = 'Autos'                       THEN 'Cars'
        WHEN t.purchase_type IN ('Carrito','Bundles')        THEN 'Packages General'
        WHEN t.purchase_type = 'Hoteles'                     THEN 'Hotels'
        WHEN t.purchase_type IN (
            'Traslados','Circuito','Servicios en Destino')   THEN 'Dest. Serv.'
        WHEN t.purchase_type = 'Vuelos'                      THEN 'Flights'
        ELSE t.purchase_type
    END AS productooriginal,
    t.channel AS channel,
    CASE
        WHEN t.channel = 'affiliate-livelo-api'
          AND t.purchase_type = 'Hoteles' THEN 'livelo-api-hoteles'
        ELSE COALESCE(di.partner_homologado_2, t.partner_data_id)
    END AS partner,
    CASE
        WHEN p.trip_type = 'Nac' THEN 'Domestic'
        WHEN p.trip_type = 'Int' THEN 'International'
        ELSE p.trip_type
    END AS viaje,
    COALESCE(di.stage, 'Unknown') AS account_type,
    COALESCE(di.region, 'Unknown') AS region,
    COUNT(DISTINCT t.transaction_code) AS orders,
    SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
              AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
             THEN 0 ELSE pnl.gb_without_distorted_taxes_usd END) AS gross_bookings,

    /* ── Net Revenues ─────────────────────────────────────── */
    SUM(pnl.commission_net_usd)
    + SUM(pnl.fee_net_usd + pnl.coi_interest_usd
          - CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                  AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
                 THEN pnl.fee_net_usd + pnl.coi_interest_usd ELSE 0 END)
    - SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
               THEN 0 ELSE pnl.discounts_net_usd END)
    + SUM(pnl.backend_air_usd + pnl.backend_non_air_usd)
    + SUM(COALESCE(coup.amount_used_usd, pnl.discounts_mkt_funds_usd) + pnl.media_revenue_usd
          - pnl.mkt_fee_cost_cmr_usd + pnl.fee_income_mkt_cmr_usd)
    - SUM(pnl.cancellations_usd)
    + SUM(pnl.breakage_revenue_usd)
    + SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
               THEN CASE WHEN t.confirmation_date < DATE('2026-06-01')
                         THEN pnl.gb_without_distorted_taxes_usd * 0.0695
                         ELSE pnl.gb_without_distorted_taxes_usd * 0.0635 END
               ELSE 0 END)
    + SUM(pnl.revenue_taxes_usd)
    + SUM(pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd)
    AS net_revenues,

    /* ── FVM ──────────────────────────────────────────────── */
    SUM(pnl.commission_net_usd)
    + SUM(pnl.fee_net_usd + pnl.coi_interest_usd
          - CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                  AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
                 THEN pnl.fee_net_usd + pnl.coi_interest_usd ELSE 0 END)
    - SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
               THEN 0 ELSE pnl.discounts_net_usd END)
    + SUM(pnl.backend_air_usd + pnl.backend_non_air_usd)
    + SUM(COALESCE(coup.amount_used_usd, pnl.discounts_mkt_funds_usd) + pnl.media_revenue_usd
          - pnl.mkt_fee_cost_cmr_usd + pnl.fee_income_mkt_cmr_usd)
    - SUM(pnl.cancellations_usd)
    + SUM(pnl.breakage_revenue_usd)
    + SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
               THEN CASE WHEN t.confirmation_date < DATE('2026-06-01')
                         THEN pnl.gb_without_distorted_taxes_usd * 0.0695
                         ELSE pnl.gb_without_distorted_taxes_usd * 0.0635 END
               ELSE 0 END)
    + SUM(pnl.revenue_taxes_usd)
    + SUM(pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd)
    - SUM(pnl.coi_usd)
    - SUM(pnl.ccp_usd)
    - SUM(pnl.mkt_cost_net_usd)
    + SUM(pnl.errors_usd)
    + SUM(ott_usd)
    + SUM(pnl.customer_claims_usd)
    + SUM(pnl.loyalty_usd) * 0
    + SUM(CASE WHEN t.country_code = 'MX'
               THEN pnl.gb_without_distorted_taxes_usd * -0.004
               ELSE pnl.Customer_service_usd END)
    + SUM(pnl.vendor_commission_usd)
    + SUM(pnl.revenue_sharing_usd)
    + SUM(CASE WHEN t.country_code = 'BR'
               THEN pnl.gb_without_distorted_taxes_usd * -0.0057
               ELSE pnl.gb_without_distorted_taxes_usd * -0.0054 END)
    + SUM(pnl.dif_fx_usd    + pnl.dif_fx_air_usd)
    + SUM(pnl.currency_hedge_usd + pnl.currency_hedge_air_usd)
    + SUM(pnl.financial_result_usd)
    AS FVM_Base,

    /* ── componentes para profit sharing (capa with_ps) ───── */
    SUM(pnl.breakage_revenue_usd)                                        AS breakage_revenue,
    SUM(pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd) AS other_incentives,
    SUM(pnl.backend_air_usd + pnl.backend_non_air_usd)                   AS back_end_incentives,
    SUM(pnl.financial_result_usd)                                        AS efecto_financiero,
    SUM(pnl.dif_fx_usd + pnl.dif_fx_air_usd)                             AS dif_fx,
    SUM(pnl.currency_hedge_usd + pnl.currency_hedge_air_usd)             AS currency_hedge

FROM data.analytics.bi_pnlop_fact_current_model pnl
JOIN data.analytics.bi_transactional_fact_products p
    ON CAST(p.product_id AS varchar) = CAST(pnl.product_id AS varchar)
JOIN data.analytics.bi_transactional_fact_transactions t
    ON t.transaction_code = p.transaction_code
LEFT JOIN (
    SELECT
        partner_id,
        MAX(partner_homologado_2) AS partner_homologado_2,
        MAX(stage)                AS stage,
        MAX(region)               AS region
    FROM raw.comdev_cartera_b2b2c_historic
    WHERE partner_id IS NOT NULL AND LOWER(is_current) = 'true'
    GROUP BY partner_id
) di ON di.partner_id = t.partner_data_id
LEFT JOIN (
    SELECT
      c.consumption_transaction,
      CAST(SUM(c.amount_used) AS DOUBLE)
        * CAST(MAX(t2.conversion_rate) AS DOUBLE) AS amount_used_usd
    FROM data.lake.coupons_consumption c
    JOIN data.lake.coupons_channels ch
      ON  ch.coupon_id = c.coupon_id
      AND ch.channel   = 'partner_benefits'
    JOIN data.analytics.bi_transactional_fact_transactions t2
      ON  CAST(t2.transaction_code AS varchar) = c.consumption_transaction
      AND t2.reservation_year_month >= CAST('2023-01-01' AS DATE)
    GROUP BY c.consumption_transaction
) coup ON CAST(coup.consumption_transaction AS varchar) = CAST(t.transaction_code AS varchar)

WHERE pnl.date_reservation_year_month >= '2023-01'
  AND p.reservation_year_month >= CAST('2023-01-01' AS DATE)
  AND t.reservation_year_month >= CAST('2023-01-01' AS DATE)
  AND t.confirmation_date >= DATE('{date_from}')
  AND t.confirmation_date <= DATE('{date_to}')
  AND p.is_confirmed_flg = 1
  AND t.line_of_business = 'B2B2C'
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
),

with_ps AS (
  SELECT
    *,
    CASE WHEN LOWER(partner) LIKE '%banco%chile%'
         THEN FVM_Base * -0.55 ELSE 0 END AS profit_sharing_banco_chile,
    CASE
      WHEN LOWER(partner) LIKE '%turismocity%' AND pais = 'Argentina'
        THEN CASE
          WHEN productooriginal IN ('Flights','Hotels')
            THEN -FVM_Base + gross_bookings * 0.015
          WHEN productooriginal = 'Packages General' AND viaje = 'International'
            THEN FVM_Base * -0.55
          WHEN productooriginal = 'Packages General' AND viaje = 'Domestic'
            THEN FVM_Base * -0.50
          ELSE 0
        END
      ELSE 0
    END AS profit_sharing_turismocity,
    CASE WHEN LOWER(partner) LIKE '%viajes%naranja%'
         THEN (FVM_Base - breakage_revenue - other_incentives - back_end_incentives
               - efecto_financiero - dif_fx - currency_hedge - (gross_bookings * 0.022)) * -0.50
         ELSE 0 END AS profit_sharing_naranja,
    CASE WHEN LOWER(partner) LIKE '%viajes%naranja%'
         THEN CASE WHEN viaje = 'Domestic' THEN gross_bookings * -0.055 ELSE 0 END
              + gross_bookings * 0.00452
         ELSE 0 END AS efecto_fin_naranja
  FROM base
)

SELECT
    fecha, pais, productooriginal, channel, partner, viaje, account_type, region,
    orders,
    gross_bookings,
    net_revenues,
    FVM_Base
      + profit_sharing_banco_chile
      + profit_sharing_turismocity
      + profit_sharing_naranja
      + efecto_fin_naranja        AS fvm
FROM with_ps
"""


BUDGET_QUERY = """
SELECT * FROM raw.b2b_budget_gd
WHERE lob_canal IN ('B2B2C-ON', 'B2B2C-OFF', 'B2B2C-CALL CENTER')
"""

# Stage para budget: join por partner_homologado_2 (igual que la query de KRs)
CARTERA_QUERY = """
SELECT partner_homologado_2, MAX(stage) AS stage
FROM raw.comdev_cartera_b2b2c_historic
WHERE partner_homologado_2 IS NOT NULL
  AND LOWER(is_current) = 'true'
GROUP BY partner_homologado_2
"""

B2B_BUDGET_GD_QUERY = """
SELECT * FROM raw.b2b_budget_gd
WHERE lob_canal IN ('B2B-MAY', 'B2B-MIN')
"""

B2B_BUDGET_RI_QUERY = """
SELECT * FROM raw.b2b_budget_ri
WHERE lob_canal IN ('B2B-MAY', 'B2B-MIN')
"""

B2B2C_RR_QUERY = """
SELECT * FROM raw.b2brr_gd
WHERE lob_canal IN ('B2B2C-ON', 'B2B2C-OFF', 'B2B2C-CALL CENTER')
"""
B2B_RR_GD_QUERY = """
SELECT * FROM raw.b2brr_gd
WHERE lob_canal IN ('B2B-MAY', 'B2B-MIN')
"""
B2B_RR_RI_QUERY = """
SELECT * FROM raw.b2brr_ri
WHERE lob_canal IN ('B2B-MAY', 'B2B-MIN')
"""

LOB_CANAL_DIAG_QUERY = f"""
SELECT lob_canal, COUNT(*) AS n,
       SUM(CAST(net_revenue AS DOUBLE)) AS nr_sum,
       SUM(CAST(gross_bookings AS DOUBLE)) AS gb_sum
FROM raw.b2b_budget_gd
WHERE SUBSTR(fecha, 7, 2) IN ('{YEAR_BUDGET}', '{YEAR_BUDGET_NEXT}')
GROUP BY lob_canal ORDER BY lob_canal
"""

# ── B2B ───────────────────────────────────────────────────────────────────────
CORE_PAISES = {'Brasil', 'Mexico', 'Other Countries'}
COLS_B2B    = ["fecha", "pais", "producto_original", "parent_channel", "viaje",
               "orders", "gross_bookings", "net_revenue", "fvm"]

_B2B_CONECTORES_CTE = """
WITH conectores AS (
    SELECT
        agencias.ap_code,
        MAX(agencias.conector)                        AS conector,
        MAX(COALESCE(pay_type, 'NA'))                 AS pay_type,
        MAX(COALESCE(CAST(mulltiplier AS DOUBLE), 0)) AS mulltiplier
    FROM data.raw.b2b_dim_ap_by_conector agencias
    LEFT JOIN data.raw.b2b_dim_api_conectors conectores
        ON agencias.conector = conectores.conector
    GROUP BY 1
),
"""

_B2B_PNL_FILTERED_CTE = """
pnl_filtered AS (
    SELECT * FROM data.analytics.bi_pnlop_fact_current_model
    WHERE line_of_business = 'B2B'
      AND date_reservation_year_month > '2024-01'
),
"""

# Factores de 5 decimales, usados por la query RI (divide todo por confirmation_gradient)
_COUNTRY_FACTORS_RI = """
country_factors AS (
    SELECT pais_key, channel_key, producto_key, country_factor
    FROM (VALUES
        ('BR','API','Hoteles',1.00000),('MX','API','Hoteles',1.00000),
        ('O','API','Hoteles',1.11000),('AR','API','Hoteles',0.76244),
        ('CO','API','Hoteles',0.73907),('CL','API','Hoteles',0.22390),
        ('PE','API','Hoteles',1.00000),('EC','API','Hoteles',1.00000),
        ('BR','Agencias afiliadas','Hoteles',0.95877),('MX','Agencias afiliadas','Hoteles',0.87797),
        ('O','Agencias afiliadas','Hoteles',0.73548),('AR','Agencias afiliadas','Hoteles',0.62866),
        ('CO','Agencias afiliadas','Hoteles',0.76838),('CL','Agencias afiliadas','Hoteles',0.87727),
        ('PE','Agencias afiliadas','Hoteles',0.89484),('EC','Agencias afiliadas','Hoteles',0.91167),
        ('BR','Agencias afiliadas','Carrito',0.99220),('MX','Agencias afiliadas','Carrito',0.89815),
        ('O','Agencias afiliadas','Carrito',1.00000),('AR','Agencias afiliadas','Carrito',0.91483),
        ('CO','Agencias afiliadas','Carrito',0.95359),('CL','Agencias afiliadas','Carrito',0.98558),
        ('PE','Agencias afiliadas','Carrito',0.99501),('EC','Agencias afiliadas','Carrito',0.79376),
        ('BR','Agencias afiliadas','Vuelos',1.00000),('MX','Agencias afiliadas','Vuelos',0.94733),
        ('O','Agencias afiliadas','Vuelos',1.00000),('AR','Agencias afiliadas','Vuelos',0.96537),
        ('CO','Agencias afiliadas','Vuelos',0.99966),('CL','Agencias afiliadas','Vuelos',1.00000),
        ('PE','Agencias afiliadas','Vuelos',1.00000),('EC','Agencias afiliadas','Vuelos',1.00000),
        ('BR','Agencias afiliadas','Actividades',0.91233),('MX','Agencias afiliadas','Actividades',0.95807),
        ('O','Agencias afiliadas','Actividades',1.00000),('AR','Agencias afiliadas','Actividades',0.96810),
        ('CO','Agencias afiliadas','Actividades',0.96395),('CL','Agencias afiliadas','Actividades',1.00000),
        ('PE','Agencias afiliadas','Actividades',1.00000),('EC','Agencias afiliadas','Actividades',1.00000),
        ('BR','Agencias afiliadas','Asistencia al viajero',1.00000),
        ('MX','Agencias afiliadas','Asistencia al viajero',1.00000),
        ('O','Agencias afiliadas','Asistencia al viajero',1.00000),
        ('AR','Agencias afiliadas','Asistencia al viajero',0.90533),
        ('CO','Agencias afiliadas','Asistencia al viajero',1.00000),
        ('CL','Agencias afiliadas','Asistencia al viajero',1.00000),
        ('PE','Agencias afiliadas','Asistencia al viajero',1.00000),
        ('EC','Agencias afiliadas','Asistencia al viajero',1.00000),
        ('BR','Agencias afiliadas','Autos',0.81590),('MX','Agencias afiliadas','Autos',0.83090),
        ('O','Agencias afiliadas','Autos',1.00000),('AR','Agencias afiliadas','Autos',0.91091),
        ('CO','Agencias afiliadas','Autos',0.88923),('CL','Agencias afiliadas','Autos',0.55251),
        ('PE','Agencias afiliadas','Autos',0.93104),('EC','Agencias afiliadas','Autos',1.00000)
    ) AS t(pais_key, channel_key, producto_key, country_factor)
),
"""

# Factores de 6 decimales, usados por la query GD (NO divide por confirmation_gradient)
_COUNTRY_FACTORS_GD = """
country_factors AS (
    SELECT pais_key, channel_key, producto_key, country_factor
    FROM (VALUES
        ('BR','API','Hoteles',1.000000),('MX','API','Hoteles',1.000000),
        ('O','API','Hoteles',1.110000),('AR','API','Hoteles',0.761148),
        ('CO','API','Hoteles',0.688685),('CL','API','Hoteles',0.217122),
        ('PE','API','Hoteles',1.000000),('EC','API','Hoteles',1.000000),
        ('BR','Agencias afiliadas','Hoteles',0.958768),('MX','Agencias afiliadas','Hoteles',0.877965),
        ('O','Agencias afiliadas','Hoteles',0.735475),('AR','Agencias afiliadas','Hoteles',0.628661),
        ('CO','Agencias afiliadas','Hoteles',0.768379),('CL','Agencias afiliadas','Hoteles',0.877266),
        ('PE','Agencias afiliadas','Hoteles',0.894839),('EC','Agencias afiliadas','Hoteles',0.911666),
        ('BR','Agencias afiliadas','Carrito',0.992196),('MX','Agencias afiliadas','Carrito',0.898147),
        ('O','Agencias afiliadas','Carrito',1.000000),('AR','Agencias afiliadas','Carrito',0.914833),
        ('CO','Agencias afiliadas','Carrito',0.953590),('CL','Agencias afiliadas','Carrito',0.985575),
        ('PE','Agencias afiliadas','Carrito',0.995007),('EC','Agencias afiliadas','Carrito',0.793758),
        ('BR','Agencias afiliadas','Vuelos',1.000000),('MX','Agencias afiliadas','Vuelos',0.947329),
        ('O','Agencias afiliadas','Vuelos',1.000000),('AR','Agencias afiliadas','Vuelos',0.965374),
        ('CO','Agencias afiliadas','Vuelos',0.999665),('CL','Agencias afiliadas','Vuelos',1.000000),
        ('PE','Agencias afiliadas','Vuelos',1.000000),('EC','Agencias afiliadas','Vuelos',1.000000),
        ('BR','Agencias afiliadas','Actividades',0.912335),('MX','Agencias afiliadas','Actividades',0.958075),
        ('O','Agencias afiliadas','Actividades',1.000000),('AR','Agencias afiliadas','Actividades',0.968103),
        ('CO','Agencias afiliadas','Actividades',0.963957),('CL','Agencias afiliadas','Actividades',1.000000),
        ('PE','Agencias afiliadas','Actividades',1.000000),('EC','Agencias afiliadas','Actividades',1.000000),
        ('BR','Agencias afiliadas','Asistencia al viajero',1.000000),
        ('MX','Agencias afiliadas','Asistencia al viajero',1.000000),
        ('O','Agencias afiliadas','Asistencia al viajero',1.000000),
        ('AR','Agencias afiliadas','Asistencia al viajero',0.905338),
        ('CO','Agencias afiliadas','Asistencia al viajero',1.000000),
        ('CL','Agencias afiliadas','Asistencia al viajero',1.000000),
        ('PE','Agencias afiliadas','Asistencia al viajero',1.000000),
        ('EC','Agencias afiliadas','Asistencia al viajero',1.000000),
        ('BR','Agencias afiliadas','Autos',0.815906),('MX','Agencias afiliadas','Autos',0.830909),
        ('O','Agencias afiliadas','Autos',1.000000),('AR','Agencias afiliadas','Autos',0.910915),
        ('CO','Agencias afiliadas','Autos',0.889231),('CL','Agencias afiliadas','Autos',0.552513),
        ('PE','Agencias afiliadas','Autos',0.931042),('EC','Agencias afiliadas','Autos',1.000000)
    ) AS t(pais_key, channel_key, producto_key, country_factor)
),
"""

_B2B_CTEs_RI = _B2B_CONECTORES_CTE + _COUNTRY_FACTORS_RI + _B2B_PNL_FILTERED_CTE
_B2B_CTEs_GD = _B2B_CONECTORES_CTE + _COUNTRY_FACTORS_GD + _B2B_PNL_FILTERED_CTE

_B2B_PAIS_CASE = """
        CASE
            WHEN fh.partner_id IN ('AP12142','AP12961','AP12767','AP12539','AP12792',
                'AP12149','AP12148','AG00015606','AP13029','AP13030',
                'AP13091','AP13104','AG00015611') THEN 'Paraguay'
            WHEN fh.partner_id = 'AP13248' OR fh.country_code = 'CL' THEN 'Chile'
            WHEN fh.country_code IN ('MX','BR','CO','AR','EC','PE','UY') THEN
                CASE fh.country_code
                    WHEN 'MX' THEN 'Mexico' WHEN 'BR' THEN 'Brasil'
                    WHEN 'CO' THEN 'Colombia' WHEN 'AR' THEN 'Argentina'
                    WHEN 'EC' THEN 'Ecuador' WHEN 'PE' THEN 'Peru'
                    WHEN 'UY' THEN 'Uruguay'
                END
            ELSE 'Other Countries'
        END AS pais,"""

_B2B_PROD_CASE = """
        CASE
            WHEN fh.buy_type_code = 'Actividades'           THEN 'Dest. Serv.'
            WHEN fh.buy_type_code = 'Alquileres'            THEN 'Vacation Rentals'
            WHEN fh.buy_type_code = 'Asistencia al viajero' THEN 'Insurance'
            WHEN fh.buy_type_code = 'Autos'                 THEN 'Cars'
            WHEN fh.buy_type_code = 'Carrito'               THEN 'Packages General'
            WHEN fh.buy_type_code = 'Hoteles'               THEN 'Hotels'
            WHEN fh.buy_type_code = 'Traslados'             THEN 'Dest. Serv.'
            WHEN fh.buy_type_code = 'Vuelos'                THEN 'Flights'
            WHEN fh.buy_type_code = 'Circuito'              THEN 'Dest. Serv.'
            WHEN fh.buy_type_code = 'Servicios en Destino'  THEN 'Dest. Serv.'
            ELSE fh.buy_type_code
        END AS producto_original,"""

_B2B_COMPONENTS_RI = """
        SUM(fh.gestion_gb) AS gross_bookings,
        COUNT(DISTINCT t.transaction_code) AS orders,
        SUM((pnl.commission_net_usd / NULLIF(fh.confirmation_gradient,0))
            * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                   ELSE COALESCE(cf.country_factor,1.0) END) AS up_front_incentives,
        SUM(((pnl.fee_net_usd + pnl.coi_interest_usd) / NULLIF(fh.confirmation_gradient,0)
             - CASE
                 WHEN fh.parent_channel='Agencias afiliadas' AND fh.country_code='BR'
                      AND fh.buy_type_code='Carrito' AND p.product_type!='Vuelos'
                 THEN pr.net_commission_partner * pr.conversion_rate
                 WHEN fh.parent_channel='Agencias afiliadas' AND fh.country_code='BR'
                      AND fh.buy_type_code!='Vuelos' AND fh.buy_type_code!='Carrito'
                 THEN pnl.affiliates_usd / NULLIF(fh.confirmation_gradient,0)
                 ELSE 0 END)
            * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                   ELSE COALESCE(cf.country_factor,1.0) END) AS fees,
        -SUM((pnl.discounts_net_usd / NULLIF(fh.confirmation_gradient,0))
             * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                    ELSE COALESCE(cf.country_factor,1.0) END) AS commercial_discounts,
        SUM((pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd)
            / NULLIF(fh.confirmation_gradient,0)) AS other_incentives,
        SUM(pnl.revenue_taxes_usd / NULLIF(fh.confirmation_gradient,0)) AS revenue_tax,
        SUM((pnl.backend_air_usd + pnl.backend_non_air_usd) / NULLIF(fh.confirmation_gradient,0)) AS back_end_incentives,
        -SUM(pnl.cancellations_usd / NULLIF(fh.confirmation_gradient,0)) AS cancellations,
        SUM(pnl.breakage_revenue_usd / NULLIF(fh.confirmation_gradient,0)) AS breakage_revenue,
        -SUM(pnl.loyalty_usd / NULLIF(fh.confirmation_gradient,0)) AS loyalty_usd,
        SUM((pnl.discounts_mkt_funds_usd + pnl.media_revenue_usd
             - pnl.mkt_fee_cost_cmr_usd + pnl.fee_income_mkt_cmr_usd)
            / NULLIF(fh.confirmation_gradient,0)) AS media_other_revenue,
        -SUM(CASE WHEN pr.installments=1 THEN 0
                  ELSE pnl.coi_usd / NULLIF(fh.confirmation_gradient,0) END) AS cost_of_installments,
        -SUM(CASE WHEN fh.parent_channel='API' THEN 0
                  ELSE pnl.ccp_usd / NULLIF(fh.confirmation_gradient,0) END) AS credit_card_processing,
        SUM(CASE
                WHEN fh.parent_channel='API' THEN NULL
                WHEN fh.country_code='BR' AND fh.buy_type_code IN ('Carrito','Vuelos') AND p.product_type='Vuelos'
                THEN -(pr.net_commission_partner * pr.conversion_rate)
                WHEN fh.country_code='BR' AND fh.buy_type_code='Carrito' THEN 0
                ELSE -(pnl.affiliates_usd / NULLIF(fh.confirmation_gradient,0)) +
                     CASE WHEN fh.country_code='BR' AND fh.buy_type_code!='Vuelos'
                          THEN pnl.affiliates_usd / NULLIF(fh.confirmation_gradient,0) ELSE 0 END
            END
            * CASE WHEN fh.country_code='MX' AND fh.parent_channel='Agencias afiliadas'
                        AND fh.buy_type_code='Carrito' THEN 0.75 ELSE 1.0 END
        ) AS affiliates,
        SUM(CASE
                WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0
                WHEN fh.parent_channel='API'
                THEN fh.gestion_gb * CASE fh.country_code
                        WHEN 'BR' THEN -0.0042 WHEN 'MX' THEN -0.0050
                        WHEN 'AR' THEN -0.0120 WHEN 'CO' THEN -0.0100
                        WHEN 'CL' THEN -0.03405 WHEN 'PE' THEN -0.0160
                        WHEN 'EC' THEN  0.0000
                        ELSE -0.0070 END
                ELSE NULL
            END
            - CASE
                WHEN fh.parent_channel='API' AND con.pay_type='TX'
                    THEN COALESCE(con.mulltiplier,0) * COALESCE(TRY_CAST(fh.confirmation_gradient AS DECIMAL(5,5)),1)
                WHEN fh.parent_channel='API' AND con.pay_type='GB'
                    THEN COALESCE(con.mulltiplier * fh.gestion_gb,0) * COALESCE(TRY_CAST(fh.confirmation_gradient AS DECIMAL(5,5)),1)
                ELSE 0 END
        ) AS white_labels_api,
        -SUM(pnl.mkt_cost_net_usd / NULLIF(fh.confirmation_gradient,0)) AS mkt_usd,
        SUM(pnl.errors_usd / NULLIF(fh.confirmation_gradient,0)) AS errors,
        SUM(pnl.ott_usd / NULLIF(fh.confirmation_gradient,0)) AS other_transactional_taxes,
        SUM(pnl.customer_claims_usd / NULLIF(fh.confirmation_gradient,0)) AS customer_claims,
        SUM(pnl.customer_service_usd / NULLIF(fh.confirmation_gradient,0)) AS customer_service,
        SUM(pnl.frauds_usd / NULLIF(fh.confirmation_gradient,0)) AS frauds,
        SUM(pnl.financial_result_usd / NULLIF(fh.confirmation_gradient,0)) AS efecto_financiero,
        SUM((pnl.dif_fx_usd + pnl.dif_fx_air_usd) / NULLIF(fh.confirmation_gradient,0)) AS dif_fx,
        SUM((pnl.currency_hedge_usd + pnl.currency_hedge_air_usd) / NULLIF(fh.confirmation_gradient,0)) AS currency_hedge"""

# GD: NO divide por confirmation_gradient (usa fh.gestion_gb * fh.confirmation_gradient para GB),
# tasas de white_labels_api propias y sin el ajuste por cancelados (no hay join a current_state).
_B2B_COMPONENTS_GD = """
        SUM(fh.gestion_gb * fh.confirmation_gradient) AS gross_bookings,
        COUNT(DISTINCT t.transaction_code) AS orders,
        SUM(pnl.commission_net_usd
            * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                   ELSE COALESCE(cf.country_factor,1.0) END) AS up_front_incentives,
        SUM(((pnl.fee_net_usd + pnl.coi_interest_usd)
             - CASE
                 WHEN fh.parent_channel='Agencias afiliadas' AND fh.country_code='BR'
                      AND fh.buy_type_code='Carrito' AND p.product_type!='Vuelos'
                 THEN pr.net_commission_partner * pr.conversion_rate
                 WHEN fh.parent_channel='Agencias afiliadas' AND fh.country_code='BR'
                      AND fh.buy_type_code!='Vuelos' AND fh.buy_type_code!='Carrito'
                 THEN pnl.affiliates_usd
                 ELSE 0 END)
            * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                   ELSE COALESCE(cf.country_factor,1.0) END) AS fees,
        -SUM(pnl.discounts_net_usd
             * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                    ELSE COALESCE(cf.country_factor,1.0) END) AS commercial_discounts,
        SUM(pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd) AS other_incentives,
        SUM(pnl.revenue_taxes_usd) AS revenue_tax,
        SUM(pnl.backend_air_usd + pnl.backend_non_air_usd) AS back_end_incentives,
        -SUM(pnl.cancellations_usd) AS cancellations,
        SUM(pnl.breakage_revenue_usd) AS breakage_revenue,
        -SUM(pnl.loyalty_usd) AS loyalty_usd,
        SUM(pnl.discounts_mkt_funds_usd + pnl.media_revenue_usd
            - pnl.mkt_fee_cost_cmr_usd + pnl.fee_income_mkt_cmr_usd) AS media_other_revenue,
        -SUM(CASE WHEN pr.installments=1 THEN 0 ELSE pnl.coi_usd END) AS cost_of_installments,
        -SUM(CASE WHEN fh.parent_channel='API' THEN 0 ELSE pnl.ccp_usd END) AS credit_card_processing,
        SUM(CASE
                WHEN fh.parent_channel='API' THEN NULL
                WHEN fh.country_code='BR' AND fh.buy_type_code IN ('Carrito','Vuelos') AND p.product_type='Vuelos'
                THEN -(pr.net_commission_partner * pr.conversion_rate)
                WHEN fh.country_code='BR' AND fh.buy_type_code='Carrito' THEN 0
                ELSE -pnl.affiliates_usd +
                     CASE WHEN fh.country_code='BR' AND fh.buy_type_code!='Vuelos'
                          THEN pnl.affiliates_usd ELSE 0 END
            END
            * CASE WHEN fh.country_code='MX' AND fh.parent_channel='Agencias afiliadas'
                        AND fh.buy_type_code='Carrito' THEN 0.75 ELSE 1.0 END
        ) AS affiliates,
        SUM(CASE
                WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0
                WHEN fh.parent_channel='API'
                THEN fh.gestion_gb * fh.confirmation_gradient * CASE fh.country_code
                        WHEN 'BR' THEN -0.0048 WHEN 'MX' THEN -0.0055
                        WHEN 'AR' THEN -0.0120 WHEN 'CO' THEN -0.0100
                        WHEN 'CL' THEN -0.034048 WHEN 'PE' THEN -0.0160
                        WHEN 'EC' THEN  0.0000
                        ELSE CASE WHEN fh.country_code IN ('US','PA','UY') THEN -0.0075
                                  ELSE -0.0070 END
                     END
                ELSE NULL
            END
            - CASE
                WHEN fh.parent_channel='API' AND con.pay_type='TX'
                    THEN COALESCE(con.mulltiplier,0) * COALESCE(TRY_CAST(fh.confirmation_gradient AS DECIMAL(5,5)),1)
                WHEN fh.parent_channel='API' AND con.pay_type='GB'
                    THEN COALESCE(con.mulltiplier * fh.gestion_gb,0) * COALESCE(TRY_CAST(fh.confirmation_gradient AS DECIMAL(5,5)),1)
                ELSE 0 END
        ) AS white_labels_api,
        -SUM(pnl.mkt_cost_net_usd) AS mkt_usd,
        SUM(pnl.errors_usd) AS errors,
        SUM(pnl.ott_usd) AS other_transactional_taxes,
        SUM(pnl.customer_claims_usd) AS customer_claims,
        SUM(pnl.customer_service_usd) AS customer_service,
        SUM(pnl.frauds_usd) AS frauds,
        SUM(pnl.financial_result_usd) AS efecto_financiero,
        SUM(pnl.dif_fx_usd + pnl.dif_fx_air_usd) AS dif_fx,
        SUM(pnl.currency_hedge_usd + pnl.currency_hedge_air_usd) AS currency_hedge"""

_B2B_JOINS_RI = """
    FROM data.analytics.bi_sales_fact_sales_recognition fh
    LEFT JOIN country_factors cf
        ON CASE WHEN fh.country_code IN ('BR','MX','AR','CO','CL','PE','EC')
                THEN fh.country_code ELSE 'O' END = cf.pais_key
        AND fh.parent_channel = cf.channel_key
        AND CASE
               WHEN fh.buy_type_code='Alquileres' THEN 'Hoteles'
               WHEN fh.buy_type_code IN ('Traslados','Circuito','Servicios en Destino') THEN 'Actividades'
               WHEN fh.buy_type_code IN ('Hoteles','Carrito','Vuelos','Actividades',
                                          'Asistencia al viajero','Autos') THEN fh.buy_type_code
               ELSE NULL
           END = cf.producto_key
    LEFT JOIN pnl_filtered pnl ON fh.product_id = pnl.product_id
    LEFT JOIN data.analytics.bi_transactional_fact_products p
        ON fh.product_id = p.product_id
        AND p.reservation_year_month >= CAST('2024-01-01' AS DATE)
    LEFT JOIN data.analytics.bi_transactional_fact_transactions t
        ON CAST(pnl.transaction_code AS VARCHAR) = t.transaction_code
        AND t.reservation_year_month >= CAST('2024-01-01' AS DATE)
    LEFT JOIN data.lake.channels_bo_product pr
        ON pr.transaction_id = fh.origin_product_id
        AND pr.status = 'EMITTED'
        AND pr.payment_methods NOT IN ('AGENCY_ACCOUNT','CURRENT_ACCOUNT')
    LEFT JOIN data.lake.chewie_reservation cr
        ON CAST(fh.transaction_code AS VARCHAR) = cr.id
        AND cr.last_version = true
    LEFT JOIN data.analytics.bi_transactional_fact_products_current_state cs
        ON fh.product_id = cs.product_id
    LEFT JOIN conectores con ON fh.partner_id = con.ap_code"""

# GD: sin join a current_state (la query GD no filtra cancelados)
_B2B_JOINS_GD = """
    FROM data.analytics.bi_sales_fact_sales_recognition fh
    LEFT JOIN country_factors cf
        ON CASE WHEN fh.country_code IN ('BR','MX','AR','CO','CL','PE','EC')
                THEN fh.country_code ELSE 'O' END = cf.pais_key
        AND fh.parent_channel = cf.channel_key
        AND CASE
               WHEN fh.buy_type_code='Alquileres' THEN 'Hoteles'
               WHEN fh.buy_type_code IN ('Traslados','Circuito','Servicios en Destino') THEN 'Actividades'
               WHEN fh.buy_type_code IN ('Hoteles','Carrito','Vuelos','Actividades',
                                          'Asistencia al viajero','Autos') THEN fh.buy_type_code
               ELSE NULL
           END = cf.producto_key
    LEFT JOIN pnl_filtered pnl ON fh.product_id = pnl.product_id
    LEFT JOIN data.analytics.bi_transactional_fact_products p
        ON fh.product_id = p.product_id
        AND p.reservation_year_month >= CAST('2024-01-01' AS DATE)
    LEFT JOIN data.analytics.bi_transactional_fact_transactions t
        ON CAST(pnl.transaction_code AS VARCHAR) = t.transaction_code
        AND t.reservation_year_month >= CAST('2024-01-01' AS DATE)
    LEFT JOIN data.lake.channels_bo_product pr
        ON pr.transaction_id = fh.origin_product_id
        AND pr.status = 'EMITTED'
        AND pr.payment_methods NOT IN ('AGENCY_ACCOUNT','CURRENT_ACCOUNT')
    LEFT JOIN data.lake.chewie_reservation cr
        ON CAST(fh.transaction_code AS VARCHAR) = cr.id
        AND cr.last_version = true
    LEFT JOIN conectores con ON fh.partner_id = con.ap_code"""

_B2B_GROUP_DIMS = """
        fh.parent_channel,
        CASE
            WHEN fh.partner_id IN ('AP12142','AP12961','AP12767','AP12539','AP12792',
                'AP12149','AP12148','AG00015606','AP13029','AP13030',
                'AP13091','AP13104','AG00015611') THEN 'Paraguay'
            WHEN fh.partner_id = 'AP13248' OR fh.country_code = 'CL' THEN 'Chile'
            WHEN fh.country_code IN ('MX','BR','CO','AR','EC','PE','UY') THEN
                CASE fh.country_code
                    WHEN 'MX' THEN 'Mexico' WHEN 'BR' THEN 'Brasil'
                    WHEN 'CO' THEN 'Colombia' WHEN 'AR' THEN 'Argentina'
                    WHEN 'EC' THEN 'Ecuador' WHEN 'PE' THEN 'Peru'
                    WHEN 'UY' THEN 'Uruguay'
                END
            ELSE 'Other Countries'
        END,
        CASE
            WHEN fh.buy_type_code='Actividades' THEN 'Dest. Serv.'
            WHEN fh.buy_type_code='Alquileres' THEN 'Vacation Rentals'
            WHEN fh.buy_type_code='Asistencia al viajero' THEN 'Insurance'
            WHEN fh.buy_type_code='Autos' THEN 'Cars'
            WHEN fh.buy_type_code='Carrito' THEN 'Packages General'
            WHEN fh.buy_type_code='Hoteles' THEN 'Hotels'
            WHEN fh.buy_type_code='Traslados' THEN 'Dest. Serv.'
            WHEN fh.buy_type_code='Vuelos' THEN 'Flights'
            WHEN fh.buy_type_code='Circuito' THEN 'Dest. Serv.'
            WHEN fh.buy_type_code='Servicios en Destino' THEN 'Dest. Serv.'
            ELSE fh.buy_type_code
        END,
        CASE WHEN fh.trip_type_code='Nac' THEN 'Domestic'
             WHEN fh.trip_type_code='Int' THEN 'International'
             ELSE fh.trip_type_code END"""

_B2B_OUTER_SELECT_NR = """
    SUM(
        COALESCE(up_front_incentives,0) + COALESCE(fees,0) + COALESCE(commercial_discounts,0)
        + COALESCE(other_incentives,0) + COALESCE(revenue_tax,0) + COALESCE(back_end_incentives,0)
        + COALESCE(cancellations,0) + COALESCE(breakage_revenue,0)
        + COALESCE(loyalty_usd,0) + COALESCE(media_other_revenue,0)
    ) AS net_revenue"""

_B2B_OUTER_SELECT_FVM = """
    SUM(
        COALESCE(up_front_incentives,0) + COALESCE(fees,0) + COALESCE(commercial_discounts,0)
        + COALESCE(other_incentives,0) + COALESCE(revenue_tax,0) + COALESCE(back_end_incentives,0)
        + COALESCE(cancellations,0) + COALESCE(breakage_revenue,0)
        + COALESCE(loyalty_usd,0) + COALESCE(media_other_revenue,0)
        + COALESCE(cost_of_installments,0) + COALESCE(credit_card_processing,0)
        + COALESCE(affiliates,0) + COALESCE(white_labels_api,0)
        + COALESCE(mkt_usd,0) + COALESCE(errors,0) + COALESCE(other_transactional_taxes,0)
        + COALESCE(customer_claims,0) + COALESCE(customer_service,0) + COALESCE(frauds,0)
        + COALESCE(efecto_financiero,0) + COALESCE(dif_fx,0) + COALESCE(currency_hedge,0)
    ) AS fvm"""


def build_b2b_ri_query(date_from: date, date_to: date) -> str:
    return (_B2B_CTEs_RI + """
base_metrics AS (
    SELECT
        CASE WHEN fh.parent_channel = 'API'
             THEN p.checkin_date ELSE fh.recognition_date END AS fecha_reconocimiento,
        fh.parent_channel,"""
        + _B2B_PAIS_CASE
        + _B2B_PROD_CASE + """
        CASE WHEN fh.trip_type_code='Nac' THEN 'Domestic'
             WHEN fh.trip_type_code='Int' THEN 'International'
             ELSE fh.trip_type_code END AS viaje,"""
        + _B2B_COMPONENTS_RI
        + _B2B_JOINS_RI + f"""
    WHERE
        CASE WHEN fh.parent_channel = 'API'
             THEN p.checkin_date ELSE fh.recognition_date END
             BETWEEN CAST('{date_from}' AS DATE) AND CAST('{date_to}' AS DATE)
        AND fh.partition_period > '2024-01-01'
        AND fh.line_of_business_code = 'B2B'
        AND NOT (
            fh.parent_channel = 'API'
            AND COALESCE(cs.product_state, fh.product_status) = 'Cancelado'
            AND (p.product_cancel_date < p.checkin_date OR p.product_cancel_date IS NULL)
        )
    GROUP BY
        CASE WHEN fh.parent_channel = 'API'
             THEN p.checkin_date ELSE fh.recognition_date END,"""
        + _B2B_GROUP_DIMS + """
)
SELECT
    CAST(fecha_reconocimiento AS VARCHAR) AS fecha,
    pais, producto_original, parent_channel, viaje,
    SUM(orders) AS orders,
    SUM(gross_bookings) AS gross_bookings,"""
        + _B2B_OUTER_SELECT_NR + ","
        + _B2B_OUTER_SELECT_FVM + """
FROM base_metrics
GROUP BY 1, 2, 3, 4, 5
""")


def build_b2b_gd_query(date_from: date, date_to: date) -> str:
    return (_B2B_CTEs_GD + """
base_metrics AS (
    SELECT
        fh.gestion_date AS fecha_gestion,
        fh.parent_channel,"""
        + _B2B_PAIS_CASE
        + _B2B_PROD_CASE + """
        CASE WHEN fh.trip_type_code='Nac' THEN 'Domestic'
             WHEN fh.trip_type_code='Int' THEN 'International'
             ELSE fh.trip_type_code END AS viaje,"""
        + _B2B_COMPONENTS_GD
        + _B2B_JOINS_GD + f"""
    WHERE
        fh.gestion_date >= CAST('{date_from}' AS DATE)
        AND fh.gestion_date <= CAST('{date_to}' AS DATE)
        AND fh.partition_period > '2024-01-01'
        AND fh.line_of_business_code = 'B2B'
        AND fh.lob_gestion IN ('stg__sales_b2bnohoteldo','stg_sales__b2bhoteldo')
    GROUP BY
        fh.gestion_date,"""
        + _B2B_GROUP_DIMS + """
)
SELECT
    CAST(fecha_gestion AS VARCHAR) AS fecha,
    pais, producto_original, parent_channel, viaje,
    SUM(orders) AS orders,
    SUM(gross_bookings) AS gross_bookings,"""
        + _B2B_OUTER_SELECT_NR + ","
        + _B2B_OUTER_SELECT_FVM + """
FROM base_metrics
GROUP BY 1, 2, 3, 4, 5
""")


# ==============================================================================
# 4) FETCH & CLEAN
# ==============================================================================

def fetch(query: str, label: str) -> pd.DataFrame:
    print(f"  > {label} ...")
    con = conectar()
    df  = pd.read_sql(query, con)
    con.close()
    print(f"  OK {len(df):,} filas")
    return df


def clean_actuals(df: pd.DataFrame) -> pd.DataFrame:
    df["fecha"] = pd.to_datetime(df["fecha"]).dt.strftime("%Y-%m-%d")
    for col in ["gross_bookings", "net_revenues", "fvm"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).round(0).astype(int)
    df["orders"]  = pd.to_numeric(df["orders"], errors="coerce").fillna(0).astype(int)
    df["partner"] = df["partner"].fillna("Sin asignar").str.strip()
    df["viaje"]   = df["viaje"].fillna("N/A")
    return df[COLS_ACTUALS]


def clean_budget(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [c.lower().strip() for c in df.columns]
    if 'partner' in df.columns and 'pais' in df.columns:
        df.loc[df['partner'] == 'CUTC', 'pais'] = 'USA'
    numeric_cols = ["orders", "gross_bookings", "net_revenue", "fvm"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df


def agg_actuals(df: pd.DataFrame) -> pd.DataFrame:
    return df.groupby(
        ["fecha", "pais", "productooriginal", "partner", "account_type", "region"], as_index=False
    ).agg(
        orders        =("orders",        "sum"),
        gross_bookings=("gross_bookings", "sum"),
        net_revenues  =("net_revenues",   "sum"),
        fvm           =("fvm",            "sum"),
    ).round({"gross_bookings": 2, "net_revenues": 2, "fvm": 2})


def agg_budget(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["fecha"] = pd.to_datetime(
        df["fecha"], format="mixed", dayfirst=True
    ).dt.strftime("%Y-%m-%d")
    df = df[df["fecha"].str[:4] == str(TODAY.year)]  # keep current FY only
    # YaVas: GB=0 en los mismos productos que en actuals (revenue queda normal)
    _yavas_gb0 = (
        df["partner"].str.lower().str.contains("yavas", na=False)
        & df["producto"].isin(["Packages General", "Flights", "Hotels", "Vacation Rentals"])
    )
    df.loc[_yavas_gb0, "gross_bookings"] = 0
    group_cols = ["fecha", "pais", "producto", "partner"]
    if "stage" in df.columns:
        group_cols.append("stage")
    return df.groupby(group_cols, as_index=False).agg(
        orders        =("orders",         "sum"),
        gross_bookings=("gross_bookings",  "sum"),
        net_revenue   =("net_revenue",     "sum"),
        fvm           =("fvm",             "sum"),
    ).round({"gross_bookings": 2, "net_revenue": 2, "fvm": 2})


def clean_b2b(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["fecha"] = pd.to_datetime(df["fecha"]).dt.strftime("%Y-%m-%d")
    for col in ["gross_bookings", "net_revenue", "fvm"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).round(0).astype(int)
    df["orders"] = pd.to_numeric(df["orders"], errors="coerce").fillna(0).astype(int)
    df["viaje"]  = df["viaje"].fillna("N/A")
    return df[COLS_B2B]


def agg_b2b(df: pd.DataFrame) -> pd.DataFrame:
    return df.groupby(
        ["fecha", "pais", "producto_original", "parent_channel", "viaje"],
        as_index=False
    ).agg(
        orders        =("orders",         "sum"),
        gross_bookings=("gross_bookings",  "sum"),
        net_revenue   =("net_revenue",     "sum"),
        fvm           =("fvm",             "sum"),
    )


def to_compact(df: pd.DataFrame) -> dict:
    """Array-of-arrays format: reduces JSON size ~75% by eliminating repeated key names."""
    return {"cols": list(df.columns), "rows": df.values.tolist()}


def agg_b2b_budget(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["fecha"] = pd.to_datetime(
        df["fecha"], format="mixed", dayfirst=True
    ).dt.strftime("%Y-%m-%d")
    df = df[df["fecha"].str[:4] == str(TODAY.year)]  # keep current FY only
    # Map lob_canal → parent_channel so the dashboard channel filter works on budget
    if "lob_canal" in df.columns:
        df["parent_channel"] = df["lob_canal"].map({
            "B2B-MAY": "API",
            "B2B-MIN": "Agencias afiliadas",
        })
    group_cols = ["fecha", "pais"]
    if "parent_channel" in df.columns:
        group_cols.append("parent_channel")
    if "producto" in df.columns:
        group_cols.append("producto")
    return df.groupby(group_cols, as_index=False).agg(
        orders        =("orders",         "sum"),
        gross_bookings=("gross_bookings",  "sum"),
        net_revenue   =("net_revenue",     "sum"),
        fvm           =("fvm",             "sum"),
    ).round({"gross_bookings": 2, "net_revenue": 2, "fvm": 2})


print(f"\n--- Actuals FY{YEAR_BUDGET} ---")
df_actuals = clean_actuals(fetch(build_actuals_query(ACTUALS_FROM, YESTERDAY), "Actuals"))

print(f"\n--- Actuals LY (FY{str((TODAY.year - 1) % 100).zfill(2)}) ---")
df_ly = clean_actuals(fetch(build_actuals_query(LY_FROM, LY_TO), "LY"))

print("\n--- Budget ---")
df_budget = clean_budget(fetch(BUDGET_QUERY, "Budget"))

print("\n--- Cartera (stage para budget) ---")
try:
    df_cartera = fetch(CARTERA_QUERY, "Cartera")
    cartera_map = dict(zip(df_cartera["partner_homologado_2"], df_cartera["stage"]))
    cartera_map["Livelo-API-Hoteles"] = "New"
    cartera_map["livelo-api-hoteles"] = "New"
    cartera_map["Xcaret"] = "New"
    df_budget["stage"] = df_budget["partner"].map(cartera_map).fillna("Existing")
    print(f"  Hunting: {(df_budget['stage']=='Existing').sum():,} filas | Farming: {(df_budget['stage']=='New').sum():,} filas")
except Exception as e:
    print(f"  WARN cartera query failed: {e}")
    df_budget["stage"] = "Existing"

print("\n--- B2B GD ---")
df_b2b_gd    = clean_b2b(fetch(build_b2b_gd_query(ACTUALS_FROM, YESTERDAY), "B2B GD actuals"))
df_b2b_gd_ly = clean_b2b(fetch(build_b2b_gd_query(LY_FROM, LY_TO),          "B2B GD LY"))

print("\n--- B2B RI ---")
df_b2b_ri    = clean_b2b(fetch(build_b2b_ri_query(ACTUALS_FROM, YESTERDAY), "B2B RI actuals"))
df_b2b_ri_ly = clean_b2b(fetch(build_b2b_ri_query(LY_FROM, LY_TO),          "B2B RI LY"))

print("\n--- Budget LOB diagnostic ---")
try:
    df_lob_diag = fetch(LOB_CANAL_DIAG_QUERY, "lob_canal values")
    for _, row in df_lob_diag.iterrows():
        print(f"  lob_canal='{row['lob_canal']}': {int(row['n']):,} rows | NR={row['nr_sum']:,.0f} | GB={row['gb_sum']:,.0f}")
except Exception as e:
    print(f"  WARN diag failed: {e}")

print("\n--- B2B Budget GD ---")
try:
    df_b2b_budget_gd = clean_budget(fetch(B2B_BUDGET_GD_QUERY, "B2B Budget GD"))
except Exception as e:
    print(f"  WARN B2B budget GD query failed: {e}")
    df_b2b_budget_gd = pd.DataFrame()

print("\n--- B2B Budget RI ---")
try:
    df_b2b_budget_ri = clean_budget(fetch(B2B_BUDGET_RI_QUERY, "B2B Budget RI"))
except Exception as e:
    print(f"  WARN B2B budget RI query failed: {e}")
    df_b2b_budget_ri = pd.DataFrame()

print("\n--- Run Rate B2B2C ---")
try:
    df_b2bc_rr = clean_budget(fetch(B2B2C_RR_QUERY, "B2B2C Run Rate"))
    if not df_b2bc_rr.empty and 'partner' in df_b2bc_rr.columns:
        df_b2bc_rr["stage"] = df_b2bc_rr["partner"].map(cartera_map).fillna("Existing")
except Exception as e:
    print(f"  WARN B2B2C RR query failed: {e}")
    df_b2bc_rr = pd.DataFrame()

print("\n--- Run Rate B2B GD ---")
try:
    df_b2b_rr_gd = clean_budget(fetch(B2B_RR_GD_QUERY, "B2B Run Rate GD"))
except Exception as e:
    print(f"  WARN B2B RR GD query failed: {e}")
    df_b2b_rr_gd = pd.DataFrame()

print("\n--- Run Rate B2B RI ---")
try:
    df_b2b_rr_ri = clean_budget(fetch(B2B_RR_RI_QUERY, "B2B Run Rate RI"))
except Exception as e:
    print(f"  WARN B2B RR RI query failed: {e}")
    df_b2b_rr_ri = pd.DataFrame()

# ==============================================================================
# 5) AGREGAR Y CONSTRUIR JSON
# ==============================================================================

print("\n--- Agregando ---")
df_act          = agg_actuals(df_actuals)
df_lya          = agg_actuals(df_ly)
df_bud          = agg_budget(df_budget)
df_b2b_gd_agg   = agg_b2b(df_b2b_gd)
df_b2b_gd_ly_ag = agg_b2b(df_b2b_gd_ly)
df_b2b_ri_agg   = agg_b2b(df_b2b_ri)
df_b2b_ri_ly_ag = agg_b2b(df_b2b_ri_ly)
df_b2b_bud_gd   = agg_b2b_budget(df_b2b_budget_gd) if not df_b2b_budget_gd.empty else pd.DataFrame()
df_b2b_bud_ri   = agg_b2b_budget(df_b2b_budget_ri) if not df_b2b_budget_ri.empty else pd.DataFrame()
df_b2bc_rr_agg  = agg_budget(df_b2bc_rr)           if not df_b2bc_rr.empty          else pd.DataFrame()
df_b2b_rr_gd_agg = agg_b2b_budget(df_b2b_rr_gd)   if not df_b2b_rr_gd.empty        else pd.DataFrame()
df_b2b_rr_ri_agg = agg_b2b_budget(df_b2b_rr_ri)   if not df_b2b_rr_ri.empty        else pd.DataFrame()
print(f"  Actuals:    {len(df_actuals):,} -> {len(df_act):,} filas")
print(f"  LY:         {len(df_ly):,} -> {len(df_lya):,} filas")
print(f"  Budget:     {len(df_budget):,} -> {len(df_bud):,} filas")
print(f"  B2B GD:     {len(df_b2b_gd):,} -> {len(df_b2b_gd_agg):,} filas")
print(f"  B2B GD LY:  {len(df_b2b_gd_ly):,} -> {len(df_b2b_gd_ly_ag):,} filas")
print(f"  B2B RI:     {len(df_b2b_ri):,} -> {len(df_b2b_ri_agg):,} filas")
print(f"  B2B RI LY:  {len(df_b2b_ri_ly):,} -> {len(df_b2b_ri_ly_ag):,} filas")
print(f"  B2B Budget GD: {len(df_b2b_budget_gd):,} -> {len(df_b2b_bud_gd):,} filas")
print(f"  B2B Budget RI: {len(df_b2b_budget_ri):,} -> {len(df_b2b_bud_ri):,} filas")

META = {
    "generated_at":      datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
    "last_actuals_date": str(YESTERDAY),
    "actuals_from":      str(ACTUALS_FROM),
    "ly_from":           str(LY_FROM),
    "ly_to":             str(LY_TO),
}

b2bc_payload = {
    "meta":       META,
    "actuals":    df_act.to_dict(orient="records"),
    "actuals_ly": df_lya.to_dict(orient="records"),
    "budget":     to_compact(df_bud),
    "runrate":    to_compact(df_b2bc_rr_agg) if not df_b2bc_rr_agg.empty else {"cols": [], "rows": []},
}

b2b_payload = {
    "meta":       META,
    "b2b_gd":     to_compact(df_b2b_gd_agg),
    "b2b_gd_ly":  to_compact(df_b2b_gd_ly_ag),
    "b2b_ri":     to_compact(df_b2b_ri_agg),
    "b2b_ri_ly":  to_compact(df_b2b_ri_ly_ag),
    "b2b_budget_gd":  df_b2b_bud_gd.to_dict(orient="records")    if not df_b2b_bud_gd.empty    else [],
    "b2b_budget_ri":  df_b2b_bud_ri.to_dict(orient="records")    if not df_b2b_bud_ri.empty    else [],
    "b2b_runrate_gd": df_b2b_rr_gd_agg.to_dict(orient="records") if not df_b2b_rr_gd_agg.empty else [],
    "b2b_runrate_ri": df_b2b_rr_ri_agg.to_dict(orient="records") if not df_b2b_rr_ri_agg.empty else [],
}

b2bc_str   = json.dumps(b2bc_payload, ensure_ascii=False, separators=(",", ":"))
b2bc_bytes = b2bc_str.encode("utf-8")
b2b_str    = json.dumps(b2b_payload, ensure_ascii=False, separators=(",", ":"))
b2b_bytes  = b2b_str.encode("utf-8")
print(f"\nB2B2C JSON: {len(b2bc_bytes)//1024:.0f} KB  "
      f"(actuals={len(df_act):,} | ly={len(df_lya):,} | budget={len(df_bud):,})")
print(f"B2B JSON:   {len(b2b_bytes)//1024:.0f} KB  "
      f"(gd={len(df_b2b_gd_agg):,} | gd_ly={len(df_b2b_gd_ly_ag):,} | ri={len(df_b2b_ri_agg):,} | ri_ly={len(df_b2b_ri_ly_ag):,})")

# ==============================================================================
# 6) SUBIR A GOOGLE DRIVE (usando credenciales OAuth de clasp)
# ==============================================================================

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]

def _get_drive_service():
    import json as _json
    from pathlib import Path
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    base       = Path(__file__).resolve().parent
    creds_file = base / "credentials_drive.json"
    token_file = base / "token_drive.json"

    # Método preferido: credencial OAuth propia con scope 'drive' completo.
    # Permite SOBRESCRIBIR archivos creados por otros usuarios (p.ej. los JSON de
    # Gregorio) siempre que tengas permiso de edición sobre la carpeta/archivo.
    if creds_file.exists():
        from google_auth_oauthlib.flow import InstalledAppFlow
        creds = None
        if token_file.exists():
            creds = Credentials.from_authorized_user_file(str(token_file), DRIVE_SCOPES)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow  = InstalledAppFlow.from_client_secrets_file(str(creds_file), DRIVE_SCOPES)
                creds = flow.run_local_server(port=0)
            token_file.write_text(creds.to_json())
        return build("drive", "v3", credentials=creds)

    # Fallback: token de clasp (scope drive.file — SOLO archivos creados por esta app;
    # no puede sobrescribir archivos de otros usuarios -> HttpError 403 appNotAuthorizedToFile).
    clasprc = Path.home() / ".clasprc.json"
    tok = _json.loads(clasprc.read_text())["tokens"]["default"]

    expiry = datetime.utcfromtimestamp(tok["expiry_date"] / 1000)
    creds  = Credentials(
        token         = tok["access_token"],
        refresh_token = tok["refresh_token"],
        token_uri     = "https://oauth2.googleapis.com/token",
        client_id     = tok["client_id"],
        client_secret = tok["client_secret"],
        expiry        = expiry,
    )
    if not creds.valid:
        creds.refresh(Request())

    return build("drive", "v3", credentials=creds)


def upload_to_drive(json_bytes: bytes, filename: str):
    from googleapiclient.http import MediaInMemoryUpload

    service = _get_drive_service()
    media   = MediaInMemoryUpload(json_bytes, mimetype="application/json", resumable=False)

    results  = service.files().list(
        q=f"name='{filename}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false",
        fields="files(id,name)"
    ).execute()
    existing = results.get("files", [])

    if existing:
        service.files().update(fileId=existing[0]["id"], media_body=media).execute()
        print(f"  OK Drive: archivo actualizado ({filename})")
    else:
        service.files().create(
            body={"name": filename, "parents": [DRIVE_FOLDER_ID]},
            media_body=media, fields="id"
        ).execute()
        print(f"  OK Drive: archivo creado ({filename})")


print("\n--- Subiendo a Google Drive ---")
upload_to_drive(b2bc_bytes, JSON_FILE_NAME)
upload_to_drive(b2b_bytes,  B2B_JSON_FILE_NAME)

# ==============================================================================
# 7) GENERAR INSIGHTS SEMANALES
# ==============================================================================
print("\n--- Generando insights semanales ---")
try:
    from weekly_insights import generate_and_upload_insights
    generate_and_upload_insights(
        df_act=df_act,
        df_lya=df_lya,
        df_bud=df_bud,
        df_b2bc_rr_agg=df_b2bc_rr_agg,
        df_b2b_gd_agg=df_b2b_gd_agg,
        df_b2b_gd_ly_ag=df_b2b_gd_ly_ag,
        df_b2b_ri_agg=df_b2b_ri_agg,
        df_b2b_ri_ly_ag=df_b2b_ri_ly_ag,
        df_b2b_bud_gd=df_b2b_bud_gd,
        df_b2b_bud_ri=df_b2b_bud_ri,
        df_b2b_rr_gd_agg=df_b2b_rr_gd_agg,
        df_b2b_rr_ri_agg=df_b2b_rr_ri_agg,
        drive_folder_id=DRIVE_FOLDER_ID,
        get_drive_service=_get_drive_service,
        today=TODAY,
    )
except Exception as e:
    print(f"  WARN insights: {e}")

# El email diario lo envía automáticamente el trigger de GAS (scheduledEmailSend).
# Para configurar el trigger por primera vez: abrir el editor de GAS y correr setupEmailTrigger().

print(f"\nOK Completado: {TODAY.strftime('%d-%m-%Y %H:%M')}")

