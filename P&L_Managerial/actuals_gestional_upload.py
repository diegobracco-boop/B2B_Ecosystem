# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
"""
actuals_gestional_upload.py
============================
Queries Treasure Data for full P&L metrics (B2B2C, B2B GD, B2B RI) and
uploads _actuals_gestional.json to Google Drive.

Scenario model (per LOB group) — mirrors P&L Accounting (baseline + goal):
  ac      actuals (real, closed FY27 months only)
  ac_ri   actuals on RI basis            (B2B-MAY only)
  ly      last year (real prior period, ym shifted +1y)
  bgt     budget GD  (full FY27, datalake raw.b2b_budget_gd)
  bgt_ri  budget RI  (full FY27, datalake raw.b2b_budget_ri; B2B-MAY only)
  rr      run rate   (near-term, raw.b2brr_gd; Aug-Oct)  — raw rows for stitch
  rr_ri   run rate RI (raw.b2brr_ri; B2B-MAY only)
  fc      forecast GOAL = actuals ≤ Jun + forecast projection Jul-Mar
  fc_ri   forecast goal on RI basis (B2B-MAY only)
  bl      baseline   = ac (closed) then rr → fc → bgt per future month
  bl_ri   baseline on RI basis            (B2B-MAY only)

The dashboard "goal" selector maps to: budget→bgt, forecast→fc, lastyear→ly.
Forecast comes from the XLSX models in FC_XLSX_DIR (API→MAY, HTML→MIN, WLs→B2B2C),
NOT from datalake raw.b2bfc1_* (that table is outdated / projects too low).
ym from `mes_proyectado` (GD) or `mes ri` (RI); Apr-Dec→2026, Jan-Mar→2027.

Drive folder : 1wzudbo7cN9Ibiv_2OA-V0_B_un4JcJp6
Run manually : python actuals_gestional_upload.py
"""

import os, json, warnings
from datetime import date, timedelta, datetime

import pandas as pd
from dotenv import load_dotenv

warnings.filterwarnings("ignore")

# ==============================================================================
# 1) CONFIG
# ==============================================================================

RUTA_ENV        = r"C:\Users\diego.bracco\Proyectos IA\envs\.env"
DSN_NAME        = "DataLake Treasure ODBC"
DRIVE_FOLDER_ID = "1wzudbo7cN9Ibiv_2OA-V0_B_un4JcJp6"
JSON_FILE_NAME  = "_actuals_gestional.json"
DRIVE_SCOPES    = ["https://www.googleapis.com/auth/drive"]

# Forecast comes from the XLSX models (datalake raw.b2bfc1_* is not kept up to
# date). Update this folder when a newer forecast round is published.
FC_XLSX_DIR = (
    r"C:\Users\diego.bracco\OneDrive - despegar365"
    r"\Control de Gestión - 2026-27\B2B & WLs\Forecast\2026.07.14"
)

TODAY        = date.today()
CURRENT_YM   = TODAY.strftime('%Y-%m')
ACTUALS_FROM = date(2026, 4, 1)   # FY27 start
_first_of_current = date(TODAY.year, TODAY.month, 1)
ACTUALS_TO   = _first_of_current - timedelta(days=1)  # last day of last closed month

# LY = FULL prior fiscal year (FY26: Apr-2025 … Mar-2026), all real/closed.
# The whole prior FY is in the past, so Last Year carries all 12 months (not
# just the mirror of currently-closed months) to compare against the full FY27.
LY_FROM = date(ACTUALS_FROM.year - 1, ACTUALS_FROM.month, ACTUALS_FROM.day)  # 2025-04-01
LY_TO   = ACTUALS_FROM - timedelta(days=1)                                    # 2026-03-31

FY27_MONTHS = [
    "2026-04","2026-05","2026-06","2026-07","2026-08","2026-09",
    "2026-10","2026-11","2026-12","2027-01","2027-02","2027-03",
]
FY27_SET   = set(FY27_MONTHS)
CLOSED_SET    = {ym for ym in FY27_SET if ym < CURRENT_YM}
# Full prior FY (FY26) months, shifted back 1 year from FY27.
LY_FULL_SET   = {f"{int(ym[:4])-1}-{ym[5:]}" for ym in FY27_SET}
LAST_ACTUAL_YM = max(CLOSED_SET) if CLOSED_SET else "0000-00"  # e.g. '2026-07'

METRIC_COLS = [
    "orders","gross_bookings","up_front_incentives","fees","commercial_discounts",
    "income_from_outsourced_services","cancellations","cost_of_installments",
    "credit_card_processing","white_labels_api","other_incentives","revenue_tax",
    "back_end_incentives","breakage_revenue","media_revenue","errors",
    "other_transactional_taxes","customer_claims","customer_service",
    "affiliates","intercompany_usd","operations","vendor_commissions",
    "frauds","efecto_financiero","dif_fx","currency_hedge","net_revenue","npv",
]
N_MET = len(METRIC_COLS)  # 29

print(f"[{TODAY}]  Actuals: {ACTUALS_FROM} → {ACTUALS_TO}  |  LY: {LY_FROM} → {LY_TO}")
print(f"Closed FY27 months: {sorted(CLOSED_SET)}")

# ==============================================================================
# 2) CONEXIÓN
# ==============================================================================

load_dotenv(RUTA_ENV)
DB_USER     = os.getenv("USER")
DB_PASSWORD = os.getenv("PASSWORD")


def conectar():
    import pyodbc
    return pyodbc.connect(
        f"DSN={DSN_NAME};UID={DB_USER};PWD={DB_PASSWORD};",
        autocommit=True,
    )


def fetch(query: str, label: str) -> pd.DataFrame:
    print(f"  > {label} ...")
    con = conectar()
    df  = pd.read_sql(query, con)
    con.close()
    print(f"  OK {len(df):,} filas")
    return df


# ==============================================================================
# 3) QUERIES
# ==============================================================================

def build_b2b2c_query(date_from: date, date_to: date) -> str:
    return f"""
WITH base AS (
  SELECT
    date_format(t.confirmation_date, '%Y-%m') AS Mes,
    t.brand AS Marca,
    CASE
      WHEN t.country_code IN ('MX','BR','CO','AR','EC','PE','CL') THEN
        CASE t.country_code
          WHEN 'MX' THEN 'Mexico'  WHEN 'BR' THEN 'Brasil'
          WHEN 'CO' THEN 'Colombia' WHEN 'AR' THEN 'Argentina'
          WHEN 'EC' THEN 'Ecuador' WHEN 'PE' THEN 'Peru'
          WHEN 'CL' THEN 'Chile'
        END
      ELSE 'Other Countries'
    END AS pais,
    CASE
      WHEN t.purchase_type IN ('Vuelos','Bundles','Escapadas','Carrito')
        AND p.product_type = 'Asistencia al viajero'
        AND p.attach_stage = 'CHECKOUT'            THEN 'Insurance'
      WHEN t.purchase_type = 'Actividades'          THEN 'Dest. Serv.'
      WHEN t.purchase_type = 'Alquileres'           THEN 'Vacation Rentals'
      WHEN t.purchase_type = 'Asistencia al viajero' THEN 'Insurance'
      WHEN t.purchase_type = 'Autos'                THEN 'Cars'
      WHEN t.purchase_type IN ('Carrito','Bundles') THEN 'Packages General'
      WHEN t.purchase_type = 'Hoteles'              THEN 'Hotels'
      WHEN t.purchase_type = 'Traslados'            THEN 'Dest. Serv.'
      WHEN t.purchase_type = 'Vuelos'               THEN 'Flights'
      WHEN t.purchase_type = 'Circuito'             THEN 'Dest. Serv.'
      WHEN t.purchase_type = 'Servicios en Destino' THEN 'Dest. Serv.'
      ELSE t.purchase_type
    END AS productooriginal,
    t.channel AS channel,
    CASE
      WHEN t.channel = 'affiliate-livelo-api' AND t.purchase_type = 'Hoteles'
        THEN 'livelo-api-hoteles'
      ELSE COALESCE(di.partner_homologado_2, t.partner_data_id)
    END AS partner,
    CASE
      WHEN p.trip_type = 'Nac' THEN 'Domestic'
      WHEN p.trip_type = 'Int' THEN 'International'
      ELSE p.trip_type
    END AS viaje,

    count(distinct t.transaction_code)                  AS orders,
    sum(pnl.gb_without_distorted_taxes_usd)             AS gross_bookings,
    sum(pnl.commission_net_usd)                         AS up_front_incentives,
    SUM(
      pnl.fee_net_usd + pnl.coi_interest_usd
      - CASE
          WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
            AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
          THEN pnl.fee_net_usd + pnl.coi_interest_usd ELSE 0 END
    ) AS fees,
    -SUM(
      CASE
        WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
          AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
        THEN 0 ELSE pnl.discounts_net_usd END
    ) AS commercial_discounts,
    sum(pnl.backend_air_usd + pnl.backend_non_air_usd) AS back_end_incentives,
    sum(
      COALESCE(coup.amount_used_usd, pnl.discounts_mkt_funds_usd)
      + pnl.media_revenue_usd - pnl.mkt_fee_cost_cmr_usd + pnl.fee_income_mkt_cmr_usd
    ) AS media_other_revenue,
    -sum(pnl.cancellations_usd)   AS cancellations,
    sum(pnl.breakage_revenue_usd) AS breakage_revenue,
    SUM(
      CASE
        WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
          AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
        THEN
          CASE WHEN t.confirmation_date < date('2026-06-01')
               THEN pnl.gb_without_distorted_taxes_usd * 0.0695
               ELSE pnl.gb_without_distorted_taxes_usd * 0.0635 END
        ELSE 0 END
    ) AS income_from_outsourced_services,
    sum(pnl.revenue_taxes_usd)                                            AS revenue_tax,
    sum(pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd) AS other_incentives,
    -sum(pnl.coi_usd)             AS cost_of_installments,
    -sum(pnl.ccp_usd)             AS credit_card_processing,
    -sum(pnl.mkt_cost_net_usd)    AS mkt_usd,
    sum(pnl.errors_usd)           AS errors,
    sum(ott_usd)                  AS other_transactional_taxes,
    sum(pnl.customer_claims_usd)  AS customer_claims,
    sum(pnl.loyalty_usd) * 0      AS loyalty_usd,
    sum(
      CASE WHEN t.country_code = 'MX'
           THEN pnl.gb_without_distorted_taxes_usd * -0.004
           ELSE pnl.Customer_service_usd END
    ) AS customer_service,
    sum(pnl.vendor_commission_usd) AS channel_expenses,
    sum(pnl.revenue_sharing_usd)   AS white_labels_api_raw,
    sum(
      CASE WHEN t.country_code = 'BR'
           THEN pnl.gb_without_distorted_taxes_usd * -0.0057
           ELSE pnl.gb_without_distorted_taxes_usd * -0.0054 END
    ) AS intercompany_USD,
    sum(pnl.dif_fx_usd + pnl.dif_fx_air_usd)                AS dif_fx,
    sum(pnl.currency_hedge_usd + pnl.currency_hedge_air_usd) AS currency_hedge,
    sum(pnl.financial_result_usd)                            AS efecto_financiero,
    sum(pnl.commission_net_usd)
    + SUM(pnl.fee_net_usd + pnl.coi_interest_usd
          - CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                  AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
                 THEN pnl.fee_net_usd + pnl.coi_interest_usd ELSE 0 END)
    + (-SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                  AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
                 THEN 0 ELSE pnl.discounts_net_usd END))
    + sum(pnl.backend_air_usd + pnl.backend_non_air_usd)
    + sum(COALESCE(coup.amount_used_usd, pnl.discounts_mkt_funds_usd)
          + pnl.media_revenue_usd - pnl.mkt_fee_cost_cmr_usd + pnl.fee_income_mkt_cmr_usd)
    + (-sum(pnl.cancellations_usd))
    + sum(pnl.breakage_revenue_usd)
    + SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
               THEN CASE WHEN t.confirmation_date < date('2026-06-01')
                         THEN pnl.gb_without_distorted_taxes_usd * 0.0695
                         ELSE pnl.gb_without_distorted_taxes_usd * 0.0635 END
               ELSE 0 END)
    + sum(pnl.revenue_taxes_usd)
    + sum(pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd)
    AS net_revenues,
    sum(pnl.commission_net_usd)
    + SUM(pnl.fee_net_usd + pnl.coi_interest_usd
          - CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                  AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
                 THEN pnl.fee_net_usd + pnl.coi_interest_usd ELSE 0 END)
    + (-SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                  AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
                 THEN 0 ELSE pnl.discounts_net_usd END))
    + sum(pnl.backend_air_usd + pnl.backend_non_air_usd)
    + sum(COALESCE(coup.amount_used_usd, pnl.discounts_mkt_funds_usd)
          + pnl.media_revenue_usd - pnl.mkt_fee_cost_cmr_usd + pnl.fee_income_mkt_cmr_usd)
    + (-sum(pnl.cancellations_usd))
    + sum(pnl.breakage_revenue_usd)
    + SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
               THEN CASE WHEN t.confirmation_date < date('2026-06-01')
                         THEN pnl.gb_without_distorted_taxes_usd * 0.0695
                         ELSE pnl.gb_without_distorted_taxes_usd * 0.0635 END
               ELSE 0 END)
    + sum(pnl.revenue_taxes_usd)
    + sum(pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd)
    + (-sum(pnl.coi_usd))
    + (-sum(pnl.ccp_usd))
    + (-sum(pnl.mkt_cost_net_usd))
    + sum(pnl.errors_usd)
    + sum(ott_usd)
    + sum(pnl.customer_claims_usd)
    + sum(pnl.loyalty_usd) * 0
    + sum(CASE WHEN t.country_code = 'MX'
               THEN pnl.gb_without_distorted_taxes_usd * -0.004
               ELSE pnl.Customer_service_usd END)
    + sum(pnl.vendor_commission_usd)
    + sum(pnl.revenue_sharing_usd)
    + sum(CASE WHEN t.country_code = 'BR'
               THEN pnl.gb_without_distorted_taxes_usd * -0.0057
               ELSE pnl.gb_without_distorted_taxes_usd * -0.0054 END)
    + sum(pnl.dif_fx_usd + pnl.dif_fx_air_usd)
    + sum(pnl.currency_hedge_usd + pnl.currency_hedge_air_usd)
    + sum(pnl.financial_result_usd)
    AS FVM_Base

  FROM data.analytics.bi_pnlop_fact_current_model pnl
  JOIN data.analytics.bi_transactional_fact_products p
    ON CAST(p.product_id AS varchar) = CAST(pnl.product_id AS varchar)
  JOIN data.analytics.bi_transactional_fact_transactions t
    ON t.transaction_code = p.transaction_code
  LEFT JOIN (
    SELECT DISTINCT partner_id,
      FIRST_VALUE(partner_homologado_2) OVER (
        PARTITION BY partner_id ORDER BY partner_homologado_2
      ) AS partner_homologado_2
    FROM raw.comdev_cartera_b2b2c_historic
    WHERE partner_id IS NOT NULL AND LOWER(is_current) = 'true'
  ) di ON di.partner_id = t.partner_data_id
  LEFT JOIN (
    SELECT c.consumption_transaction,
      CAST(SUM(c.amount_used) AS DOUBLE)
        * CAST(MAX(t2.conversion_rate) AS DOUBLE) AS amount_used_usd
    FROM data.lake.coupons_consumption c
    JOIN data.lake.coupons_channels ch ON ch.coupon_id = c.coupon_id AND ch.channel = 'partner_benefits'
    JOIN data.analytics.bi_transactional_fact_transactions t2
      ON CAST(t2.transaction_code AS varchar) = c.consumption_transaction
      AND t2.reservation_year_month >= CAST('2023-01-01' AS DATE)
    GROUP BY c.consumption_transaction
  ) coup ON CAST(coup.consumption_transaction AS varchar) = CAST(t.transaction_code AS varchar)
  WHERE pnl.date_reservation_year_month >= '2023-01'
    AND p.reservation_year_month >= CAST('2023-01-01' AS date)
    AND t.reservation_year_month >= CAST('2023-01-01' AS date)
    AND t.confirmation_date >= date('{date_from}')
    AND t.confirmation_date <= date('{date_to}')
    AND p.is_confirmed_flg = 1
    AND t.line_of_business = 'B2B2C'
  GROUP BY 1,2,3,4,5,6,7
),

with_ps AS (
  SELECT *,
    CASE WHEN LOWER(partner) LIKE '%viajes%naranja%'
         THEN FVM_Base - breakage_revenue - other_incentives - back_end_incentives
              - efecto_financiero - dif_fx - currency_hedge - (gross_bookings * 0.022)
         ELSE FVM_Base END AS FVM_EBITDASharing,
    CASE WHEN LOWER(partner) LIKE '%banco%chile%'
         THEN FVM_Base * -0.55 ELSE 0 END AS profit_sharing_banco_chile,
    CASE WHEN LOWER(partner) LIKE '%turismocity%' AND pais = 'Argentina'
         THEN CASE
           WHEN productooriginal IN ('Flights','Hotels')
             THEN -FVM_Base + gross_bookings * 0.015
           WHEN productooriginal = 'Packages General' AND viaje = 'International'
             THEN FVM_Base * -0.55
           WHEN productooriginal = 'Packages General' AND viaje = 'Domestic'
             THEN FVM_Base * -0.50
           ELSE 0 END
         ELSE 0 END AS profit_sharing_turismocity,
    CASE WHEN LOWER(partner) LIKE '%viajes%naranja%'
         THEN (FVM_Base - breakage_revenue - other_incentives - back_end_incentives
               - efecto_financiero - dif_fx - currency_hedge - (gross_bookings * 0.022)) * -0.50
         ELSE 0 END AS profit_sharing_naranja,
    CASE WHEN LOWER(partner) LIKE '%viajes%naranja%'
         THEN CASE WHEN viaje = 'Domestic' THEN gross_bookings * -0.055 ELSE 0 END
              + gross_bookings * 0.00452
         ELSE 0 END AS efecto_fin_naranja,
    CASE WHEN LOWER(partner) LIKE '%viajes%naranja%'
         THEN efecto_financiero
              + CASE WHEN viaje = 'Domestic' THEN gross_bookings * -0.055 ELSE 0 END
              + gross_bookings * 0.00452
         ELSE efecto_financiero END AS efecto_financiero_display
  FROM base
)

SELECT
  Mes, pais, productooriginal, partner,
  orders, gross_bookings, up_front_incentives, fees, commercial_discounts,
  back_end_incentives, media_other_revenue, cancellations, breakage_revenue,
  income_from_outsourced_services, revenue_tax, other_incentives,
  cost_of_installments, credit_card_processing, errors,
  other_transactional_taxes, customer_claims, customer_service,
  channel_expenses,
  white_labels_api_raw + profit_sharing_banco_chile
    + profit_sharing_turismocity + profit_sharing_naranja AS white_labels_api,
  intercompany_USD,
  dif_fx, currency_hedge,
  efecto_financiero_display AS efecto_financiero,
  net_revenues,
  FVM_Base + profit_sharing_banco_chile
    + profit_sharing_turismocity + profit_sharing_naranja
    + efecto_fin_naranja AS FVM
FROM with_ps
"""


def build_b2b_gd_query(date_from: date, date_to: date) -> str:
    return f"""
WITH conectores AS (
    SELECT agencias.ap_code,
        MAX(agencias.conector)                        AS conector,
        MAX(COALESCE(pay_type, 'NA'))                 AS pay_type,
        MAX(COALESCE(CAST(mulltiplier AS DOUBLE), 0)) AS mulltiplier
    FROM data.raw.b2b_dim_ap_by_conector agencias
    LEFT JOIN data.raw.b2b_dim_api_conectors conectores
        ON agencias.conector = conectores.conector
    GROUP BY 1
),

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

pnl_filtered AS (
    SELECT * FROM data.analytics.bi_pnlop_fact_current_model
    WHERE line_of_business = 'B2B' AND date_reservation_year_month > '2024-01'
),

base_metrics AS (
    SELECT
        CAST(YEAR(fh.gestion_date) AS VARCHAR) AS anio_gd,
        MONTH(fh.gestion_date) AS mes_gd,
        fh.line_of_business_code AS lob,
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
        END AS pais,
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
        END AS producto_original,
        CASE WHEN fh.trip_type_code = 'Nac' THEN 'Domestic'
             WHEN fh.trip_type_code = 'Int' THEN 'International'
             ELSE fh.trip_type_code END AS viaje,

        SUM(fh.gestion_gb * fh.confirmation_gradient) AS gross_bookings,
        COUNT(DISTINCT t.transaction_code) AS orders,
        SUM(pnl.commission_net_usd
            * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                   ELSE COALESCE(cf.country_factor, 1.0) END) AS up_front_incentives,
        SUM(((pnl.fee_net_usd + pnl.coi_interest_usd)
             - CASE
                 WHEN fh.parent_channel = 'Agencias afiliadas' AND fh.country_code = 'BR'
                      AND fh.buy_type_code = 'Carrito' AND p.product_type != 'Vuelos'
                 THEN pr.net_commission_partner * pr.conversion_rate
                 WHEN fh.parent_channel = 'Agencias afiliadas' AND fh.country_code = 'BR'
                      AND fh.buy_type_code != 'Vuelos' AND fh.buy_type_code != 'Carrito'
                 THEN pnl.affiliates_usd ELSE 0 END)
            * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                   ELSE COALESCE(cf.country_factor, 1.0) END) AS fees,
        -SUM(pnl.discounts_net_usd
             * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                    ELSE COALESCE(cf.country_factor, 1.0) END) AS commercial_discounts,
        SUM(pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd) AS other_incentives,
        SUM(pnl.revenue_taxes_usd) AS revenue_tax,
        SUM(pnl.backend_air_usd + pnl.backend_non_air_usd) AS back_end_incentives,
        -SUM(pnl.cancellations_usd) AS cancellations,
        SUM(pnl.breakage_revenue_usd) AS breakage_revenue,
        -SUM(pnl.loyalty_usd) AS loyalty_usd,
        SUM(pnl.discounts_mkt_funds_usd + pnl.media_revenue_usd
            - pnl.mkt_fee_cost_cmr_usd + pnl.fee_income_mkt_cmr_usd) AS media_other_revenue,
        -SUM(CASE WHEN pr.installments = 1 THEN 0 ELSE pnl.coi_usd END) AS cost_of_installments,
        -SUM(CASE WHEN fh.parent_channel = 'API' THEN 0 ELSE pnl.ccp_usd END) AS credit_card_processing,
        SUM(CASE
                WHEN fh.parent_channel = 'API' THEN NULL
                WHEN fh.country_code = 'BR' AND fh.buy_type_code IN ('Carrito','Vuelos') AND p.product_type = 'Vuelos'
                THEN -(pr.net_commission_partner * pr.conversion_rate)
                WHEN fh.country_code = 'BR' AND fh.buy_type_code = 'Carrito' THEN 0
                ELSE -pnl.affiliates_usd
                     + CASE WHEN fh.country_code = 'BR' AND fh.buy_type_code != 'Vuelos'
                            THEN pnl.affiliates_usd ELSE 0 END
            END
            * CASE WHEN fh.country_code = 'MX' AND fh.parent_channel = 'Agencias afiliadas'
                        AND fh.buy_type_code = 'Carrito' THEN 0.75 ELSE 1.0 END
        ) AS affiliates,
        SUM(CASE
                WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0
                WHEN fh.parent_channel = 'API'
                THEN fh.gestion_gb * fh.confirmation_gradient
                     * CASE fh.country_code
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
                WHEN fh.parent_channel = 'API' AND con.pay_type = 'TX'
                    THEN COALESCE(con.mulltiplier, 0)
                         * COALESCE(TRY_CAST(fh.confirmation_gradient AS DECIMAL(5,5)), 1)
                WHEN fh.parent_channel = 'API' AND con.pay_type = 'GB'
                    THEN COALESCE(con.mulltiplier * fh.gestion_gb, 0)
                         * COALESCE(TRY_CAST(fh.confirmation_gradient AS DECIMAL(5,5)), 1)
                ELSE 0
            END
        ) AS white_labels_api,
        -SUM(pnl.mkt_cost_net_usd) AS mkt_usd,
        SUM(pnl.errors_usd) AS errors,
        SUM(pnl.ott_usd) AS other_transactional_taxes,
        SUM(pnl.customer_claims_usd) AS customer_claims,
        SUM(pnl.customer_service_usd) AS customer_service,
        SUM(pnl.frauds_usd) AS frauds,
        SUM(pnl.financial_result_usd) AS efecto_financiero,
        SUM(pnl.dif_fx_usd + pnl.dif_fx_air_usd) AS dif_fx,
        SUM(pnl.currency_hedge_usd + pnl.currency_hedge_air_usd) AS currency_hedge

    FROM data.analytics.bi_sales_fact_sales_recognition fh
    LEFT JOIN country_factors cf
        ON CASE WHEN fh.country_code IN ('BR','MX','AR','CO','CL','PE','EC')
                THEN fh.country_code ELSE 'O' END = cf.pais_key
        AND fh.parent_channel = cf.channel_key
        AND CASE
               WHEN fh.buy_type_code = 'Alquileres' THEN 'Hoteles'
               WHEN fh.buy_type_code IN ('Traslados','Circuito','Servicios en Destino') THEN 'Actividades'
               WHEN fh.buy_type_code IN ('Hoteles','Carrito','Vuelos','Actividades',
                                          'Asistencia al viajero','Autos') THEN fh.buy_type_code
               ELSE NULL
           END = cf.producto_key
    LEFT JOIN pnl_filtered pnl ON fh.product_id = pnl.product_id
    LEFT JOIN data.analytics.bi_transactional_fact_products p
        ON fh.product_id = p.product_id AND p.reservation_year_month >= CAST('2024-01-01' AS DATE)
    LEFT JOIN data.analytics.bi_transactional_fact_transactions t
        ON CAST(pnl.transaction_code AS VARCHAR) = t.transaction_code
        AND t.reservation_year_month >= CAST('2024-01-01' AS DATE)
    LEFT JOIN data.lake.channels_bo_product pr
        ON pr.transaction_id = fh.origin_product_id AND pr.status = 'EMITTED'
        AND pr.payment_methods NOT IN ('AGENCY_ACCOUNT','CURRENT_ACCOUNT')
    LEFT JOIN data.lake.chewie_reservation cr
        ON CAST(fh.transaction_code AS VARCHAR) = cr.id AND cr.last_version = true
    LEFT JOIN conectores con ON fh.partner_id = con.ap_code
    WHERE fh.gestion_date >= CAST('{date_from}' AS DATE)
        AND fh.gestion_date <= CAST('{date_to}' AS DATE)
        AND fh.partition_period > '2024-01-01'
        AND fh.line_of_business_code = 'B2B'
        AND fh.lob_gestion IN ('stg__sales_b2bnohoteldo','stg_sales__b2bhoteldo')
    GROUP BY
        YEAR(fh.gestion_date), MONTH(fh.gestion_date), fh.gestion_date,
        fh.line_of_business_code, fh.parent_channel,
        CASE WHEN fh.partner_id IN ('AP12142','AP12961','AP12767','AP12539','AP12792',
                'AP12149','AP12148','AG00015606','AP13029','AP13030',
                'AP13091','AP13104','AG00015611') THEN 'Paraguay'
             WHEN fh.partner_id = 'AP13248' OR fh.country_code = 'CL' THEN 'Chile'
             WHEN fh.country_code IN ('MX','BR','CO','AR','EC','PE','UY') THEN
                 CASE fh.country_code WHEN 'MX' THEN 'Mexico' WHEN 'BR' THEN 'Brasil'
                     WHEN 'CO' THEN 'Colombia' WHEN 'AR' THEN 'Argentina'
                     WHEN 'EC' THEN 'Ecuador' WHEN 'PE' THEN 'Peru'
                     WHEN 'UY' THEN 'Uruguay' END
             ELSE 'Other Countries' END,
        CASE WHEN fh.buy_type_code = 'Actividades' THEN 'Dest. Serv.'
             WHEN fh.buy_type_code = 'Alquileres' THEN 'Vacation Rentals'
             WHEN fh.buy_type_code = 'Asistencia al viajero' THEN 'Insurance'
             WHEN fh.buy_type_code = 'Autos' THEN 'Cars'
             WHEN fh.buy_type_code = 'Carrito' THEN 'Packages General'
             WHEN fh.buy_type_code = 'Hoteles' THEN 'Hotels'
             WHEN fh.buy_type_code = 'Traslados' THEN 'Dest. Serv.'
             WHEN fh.buy_type_code = 'Vuelos' THEN 'Flights'
             WHEN fh.buy_type_code = 'Circuito' THEN 'Dest. Serv.'
             WHEN fh.buy_type_code = 'Servicios en Destino' THEN 'Dest. Serv.'
             ELSE fh.buy_type_code END,
        p.product_type, cr.shopping_flow_source,
        CASE WHEN fh.trip_type_code = 'Nac' THEN 'Domestic'
             WHEN fh.trip_type_code = 'Int' THEN 'International'
             ELSE fh.trip_type_code END
)

SELECT
    anio_gd, mes_gd, pais, producto_original, parent_channel, viaje,
    gross_bookings, orders,
    up_front_incentives, fees, commercial_discounts,
    cancellations, other_incentives, back_end_incentives, media_other_revenue,
    breakage_revenue, revenue_tax, loyalty_usd,
    cost_of_installments, credit_card_processing,
    white_labels_api, affiliates, mkt_usd, frauds, errors,
    other_transactional_taxes, customer_claims, customer_service,
    efecto_financiero, dif_fx, currency_hedge,
    (COALESCE(up_front_incentives,0) + COALESCE(fees,0) + COALESCE(commercial_discounts,0)
     + COALESCE(other_incentives,0) + COALESCE(revenue_tax,0) + COALESCE(back_end_incentives,0)
     + COALESCE(cancellations,0) + COALESCE(breakage_revenue,0)
     + COALESCE(loyalty_usd,0) + COALESCE(media_other_revenue,0)) AS net_revenue,
    (COALESCE(up_front_incentives,0) + COALESCE(fees,0) + COALESCE(commercial_discounts,0)
     + COALESCE(other_incentives,0) + COALESCE(revenue_tax,0) + COALESCE(back_end_incentives,0)
     + COALESCE(cancellations,0) + COALESCE(breakage_revenue,0)
     + COALESCE(loyalty_usd,0) + COALESCE(media_other_revenue,0)
     + COALESCE(cost_of_installments,0) + COALESCE(credit_card_processing,0)
     + COALESCE(affiliates,0) + COALESCE(white_labels_api,0)
     + COALESCE(mkt_usd,0) + COALESCE(errors,0) + COALESCE(other_transactional_taxes,0)
     + COALESCE(customer_claims,0) + COALESCE(customer_service,0) + COALESCE(frauds,0)
     + COALESCE(efecto_financiero,0) + COALESCE(dif_fx,0) + COALESCE(currency_hedge,0)) AS fvm
FROM base_metrics
"""


def build_b2b_ri_query(date_from: date, date_to: date) -> str:
    return f"""
WITH country_factors AS (
    SELECT DISTINCT country_code,
        CASE country_code
            WHEN 'BR' THEN 1 WHEN 'MX' THEN 1 WHEN 'CO' THEN 1
            WHEN 'CL' THEN 1 WHEN 'US' THEN 1 WHEN 'PA' THEN 1
            ELSE 1
        END AS country_factor
    FROM data.analytics.bi_sales_fact_sales_recognition
    WHERE partition_period > '2024-01-01'
),

pnl_filtered AS (
    SELECT * FROM data.analytics.bi_pnlop_fact_current_model
    WHERE line_of_business = 'B2B' AND date_reservation_year_month > '2024-01'
),

base_metrics AS (
    SELECT
        CAST(
            CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284')
                 THEN YEAR(p.checkin_date) ELSE YEAR(fh.recognition_date) END
        AS VARCHAR) AS anio_ri,
        CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284')
             THEN MONTH(p.checkin_date) ELSE MONTH(fh.recognition_date) END AS mes_ri,
        fh.line_of_business_code AS lob,
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
        END AS pais,
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
        END AS producto_original,
        CASE WHEN fh.trip_type_code = 'Nac' THEN 'Domestic'
             WHEN fh.trip_type_code = 'Int' THEN 'International'
             ELSE fh.trip_type_code END AS viaje,

        SUM(fh.gestion_gb) AS gross_bookings,
        COUNT(DISTINCT t.transaction_code) AS orders,
        SUM((pnl.commission_net_usd / NULLIF(fh.confirmation_gradient, 0))
            * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                   ELSE cf.country_factor END) AS up_front_incentives,
        SUM(((pnl.fee_net_usd + pnl.coi_interest_usd) / NULLIF(fh.confirmation_gradient, 0)
             - CASE
                 WHEN fh.parent_channel = 'Agencias afiliadas' AND fh.country_code = 'BR'
                      AND fh.buy_type_code = 'Carrito' AND p.product_type != 'Vuelos'
                 THEN pr.net_commission_partner * pr.conversion_rate
                 WHEN fh.parent_channel = 'Agencias afiliadas' AND fh.country_code = 'BR'
                      AND fh.buy_type_code != 'Vuelos' AND fh.buy_type_code != 'Carrito'
                 THEN pnl.affiliates_usd / NULLIF(fh.confirmation_gradient, 0)
                 ELSE 0 END)
            * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                   ELSE cf.country_factor END) AS fees,
        -SUM((pnl.discounts_net_usd / NULLIF(fh.confirmation_gradient, 0))
             * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                    ELSE cf.country_factor END) AS commercial_discounts,
        SUM((pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd)
            / NULLIF(fh.confirmation_gradient, 0)) AS other_incentives,
        SUM(pnl.revenue_taxes_usd / NULLIF(fh.confirmation_gradient, 0)) AS revenue_tax,
        SUM((pnl.backend_air_usd + pnl.backend_non_air_usd)
            / NULLIF(fh.confirmation_gradient, 0)) AS back_end_incentives,
        -SUM(pnl.cancellations_usd / NULLIF(fh.confirmation_gradient, 0)) AS cancellations,
        SUM(pnl.breakage_revenue_usd / NULLIF(fh.confirmation_gradient, 0)) AS breakage_revenue,
        -SUM(pnl.loyalty_usd / NULLIF(fh.confirmation_gradient, 0)) AS loyalty_usd,
        SUM((pnl.discounts_mkt_funds_usd + pnl.media_revenue_usd
             - pnl.mkt_fee_cost_cmr_usd + pnl.fee_income_mkt_cmr_usd)
            / NULLIF(fh.confirmation_gradient, 0)) AS media_other_revenue,
        -SUM(CASE WHEN pr.installments = 1 THEN 0
                  ELSE pnl.coi_usd / NULLIF(fh.confirmation_gradient, 0) END) AS cost_of_installments,
        -SUM(CASE WHEN fh.parent_channel = 'API' THEN 0
                  ELSE pnl.ccp_usd / NULLIF(fh.confirmation_gradient, 0) END) AS credit_card_processing,
        SUM(CASE
                WHEN fh.parent_channel = 'API' THEN NULL
                WHEN fh.country_code = 'BR' AND fh.buy_type_code = 'Carrito'
                     AND p.product_type = 'Vuelos'
                THEN -(pr.net_commission_partner * pr.conversion_rate)
                WHEN fh.country_code = 'BR' AND fh.buy_type_code = 'Carrito' THEN 0
                ELSE -(pnl.affiliates_usd / NULLIF(fh.confirmation_gradient, 0))
                     + CASE WHEN fh.country_code = 'BR' AND fh.buy_type_code != 'Vuelos'
                            THEN pnl.affiliates_usd / NULLIF(fh.confirmation_gradient, 0) ELSE 0 END
            END) AS affiliates,
        SUM(CASE
                WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0
                WHEN fh.parent_channel = 'API'
                THEN -pnl.affiliates_usd / NULLIF(fh.confirmation_gradient, 0)
                ELSE NULL
            END) AS white_labels_api,
        -SUM(pnl.mkt_cost_net_usd / NULLIF(fh.confirmation_gradient, 0)) AS mkt_usd,
        SUM(pnl.errors_usd / NULLIF(fh.confirmation_gradient, 0)) AS errors,
        SUM(pnl.ott_usd / NULLIF(fh.confirmation_gradient, 0)) AS other_transactional_taxes,
        SUM(pnl.customer_claims_usd / NULLIF(fh.confirmation_gradient, 0)) AS customer_claims,
        SUM(pnl.customer_service_usd / NULLIF(fh.confirmation_gradient, 0)) AS customer_service,
        SUM(pnl.frauds_usd / NULLIF(fh.confirmation_gradient, 0)) AS frauds,
        SUM(pnl.financial_result_usd / NULLIF(fh.confirmation_gradient, 0)) AS efecto_financiero,
        SUM((pnl.dif_fx_usd + pnl.dif_fx_air_usd) / NULLIF(fh.confirmation_gradient, 0)) AS dif_fx,
        SUM((pnl.currency_hedge_usd + pnl.currency_hedge_air_usd)
            / NULLIF(fh.confirmation_gradient, 0)) AS currency_hedge

    FROM data.analytics.bi_sales_fact_sales_recognition fh
    INNER JOIN country_factors cf ON fh.country_code = cf.country_code
    LEFT JOIN pnl_filtered pnl ON fh.product_id = pnl.product_id
    LEFT JOIN data.analytics.bi_transactional_fact_products p
        ON fh.product_id = p.product_id AND p.reservation_year_month >= CAST('2024-01-01' AS DATE)
    LEFT JOIN data.analytics.bi_transactional_fact_transactions t
        ON CAST(pnl.transaction_code AS VARCHAR) = t.transaction_code
        AND t.reservation_year_month >= CAST('2024-01-01' AS DATE)
    LEFT JOIN data.lake.channels_bo_product pr
        ON pr.transaction_id = fh.origin_product_id AND pr.status = 'EMITTED'
        AND pr.payment_methods NOT IN ('AGENCY_ACCOUNT','CURRENT_ACCOUNT')
    LEFT JOIN data.lake.chewie_reservation cr
        ON CAST(fh.transaction_code AS VARCHAR) = cr.id AND cr.last_version = true
    LEFT JOIN data.analytics.bi_transactional_fact_products_current_state cs
        ON fh.product_id = cs.product_id
    WHERE
        CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284')
             THEN p.checkin_date ELSE fh.recognition_date END
             BETWEEN CAST('{date_from}' AS DATE) AND CAST('{date_to}' AS DATE)
        AND fh.partition_period > '2024-01-01'
        AND fh.line_of_business_code = 'B2B'
        AND fh.lob_gestion IN ('stg__sales_b2bnohoteldo','stg_sales__b2bhoteldo')
        AND NOT (
            fh.parent_channel = 'API'
            AND COALESCE(cs.product_state, fh.product_status) = 'Cancelado'
            AND (p.product_cancel_date < p.checkin_date OR p.product_cancel_date IS NULL)
        )
    GROUP BY
        CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284')
             THEN YEAR(p.checkin_date) ELSE YEAR(fh.recognition_date) END,
        CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284')
             THEN MONTH(p.checkin_date) ELSE MONTH(fh.recognition_date) END,
        fh.gestion_date,
        CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284')
             THEN p.checkin_date ELSE fh.recognition_date END,
        fh.line_of_business_code, fh.parent_channel,
        CASE WHEN fh.partner_id IN ('AP12142','AP12961','AP12767','AP12539','AP12792',
                'AP12149','AP12148','AG00015606','AP13029','AP13030',
                'AP13091','AP13104','AG00015611') THEN 'Paraguay'
             WHEN fh.partner_id = 'AP13248' OR fh.country_code = 'CL' THEN 'Chile'
             WHEN fh.country_code IN ('MX','BR','CO','AR','EC','PE','UY') THEN
                 CASE fh.country_code WHEN 'MX' THEN 'Mexico' WHEN 'BR' THEN 'Brasil'
                     WHEN 'CO' THEN 'Colombia' WHEN 'AR' THEN 'Argentina'
                     WHEN 'EC' THEN 'Ecuador' WHEN 'PE' THEN 'Peru'
                     WHEN 'UY' THEN 'Uruguay' END
             ELSE 'Other Countries' END,
        CASE WHEN fh.buy_type_code = 'Actividades' THEN 'Dest. Serv.'
             WHEN fh.buy_type_code = 'Alquileres' THEN 'Vacation Rentals'
             WHEN fh.buy_type_code = 'Asistencia al viajero' THEN 'Insurance'
             WHEN fh.buy_type_code = 'Autos' THEN 'Cars'
             WHEN fh.buy_type_code = 'Carrito' THEN 'Packages General'
             WHEN fh.buy_type_code = 'Hoteles' THEN 'Hotels'
             WHEN fh.buy_type_code = 'Traslados' THEN 'Dest. Serv.'
             WHEN fh.buy_type_code = 'Vuelos' THEN 'Flights'
             WHEN fh.buy_type_code = 'Circuito' THEN 'Dest. Serv.'
             WHEN fh.buy_type_code = 'Servicios en Destino' THEN 'Dest. Serv.'
             ELSE fh.buy_type_code END,
        p.product_type, cr.shopping_flow_source,
        CASE WHEN fh.trip_type_code = 'Nac' THEN 'Domestic'
             WHEN fh.trip_type_code = 'Int' THEN 'International'
             ELSE fh.trip_type_code END,
        fh.product_status
)

SELECT
    anio_ri, mes_ri, pais, producto_original, parent_channel, viaje,
    gross_bookings, orders,
    up_front_incentives, fees, commercial_discounts,
    other_incentives, revenue_tax, back_end_incentives,
    cancellations, breakage_revenue, loyalty_usd, media_other_revenue,
    cost_of_installments, credit_card_processing,
    affiliates, white_labels_api, mkt_usd, errors,
    other_transactional_taxes, customer_claims, customer_service, frauds,
    efecto_financiero, dif_fx, currency_hedge,
    (COALESCE(up_front_incentives,0) + COALESCE(fees,0) + COALESCE(commercial_discounts,0)
     + COALESCE(other_incentives,0) + COALESCE(revenue_tax,0) + COALESCE(back_end_incentives,0)
     + COALESCE(cancellations,0) + COALESCE(breakage_revenue,0)
     + COALESCE(loyalty_usd,0) + COALESCE(media_other_revenue,0)) AS net_revenue,
    (COALESCE(up_front_incentives,0) + COALESCE(fees,0) + COALESCE(commercial_discounts,0)
     + COALESCE(other_incentives,0) + COALESCE(revenue_tax,0) + COALESCE(back_end_incentives,0)
     + COALESCE(cancellations,0) + COALESCE(breakage_revenue,0)
     + COALESCE(loyalty_usd,0) + COALESCE(media_other_revenue,0)
     + COALESCE(cost_of_installments,0) + COALESCE(credit_card_processing,0)
     + COALESCE(affiliates,0) + COALESCE(white_labels_api,0)
     + COALESCE(mkt_usd,0) + COALESCE(errors,0) + COALESCE(other_transactional_taxes,0)
     + COALESCE(customer_claims,0) + COALESCE(customer_service,0) + COALESCE(frauds,0)
     + COALESCE(efecto_financiero,0) + COALESCE(dif_fx,0) + COALESCE(currency_hedge,0)) AS fvm
FROM base_metrics
"""


# Budget tables carry the FULL P&L waterfall (all 29 metrics) with signs already
# applied — no need to recompute. escenario partitions cleanly by lob_canal
# (B2B2C-* → 'BAU'; B2B-MAY/MIN → NULL), so the lob_canal filter already isolates
# the right rows and no escenario filter is required.
B2B2C_BUDGET_QUERY = """
SELECT * FROM raw.b2b_budget_gd
WHERE lob_canal IN ('B2B2C-ON', 'B2B2C-OFF', 'B2B2C-CALL CENTER')
"""

B2B_BUDGET_GD_QUERY = """
SELECT * FROM raw.b2b_budget_gd
WHERE lob_canal IN ('B2B-MAY', 'B2B-MIN')
"""

B2B_BUDGET_RI_QUERY = """
SELECT * FROM raw.b2b_budget_ri
WHERE lob_canal IN ('B2B-MAY', 'B2B-MIN')
"""

# ── Run Rate (near-term projection) ───────────────────────────────────────────
# Same layout as budget; ym from `fecha` (already FY27). escenario partitions by
# lob_canal (B2B2C-* → 'BAU'; B2B-MAY/MIN → NULL), so lob_canal filter isolates.
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

# ── Forecast (FC1 datalake) — CURRENTLY UNUSED ────────────────────────────────
# raw.b2bfc1_* is NOT kept up to date (projects too low), so forecast is read
# from the XLSX models instead (see section 4c / FC_XLSX_DIR). These queries are
# kept for when the datalake forecast table is refreshed. Quirks if reused:
#   `fecha` is one year behind → ym from `no_mes_proyectado`; B2B2C lob_canal is
#   the literal 'B2B2C' (not split); tables lack intercompany_usd/operations.
B2B2C_FC_QUERY = """
SELECT * FROM raw.b2bfc1_gd
WHERE lob_canal = 'B2B2C'
"""
B2B_FC_GD_QUERY = """
SELECT * FROM raw.b2bfc1_gd
WHERE lob_canal IN ('B2B-MAY', 'B2B-MIN')
"""
B2B_FC_RI_QUERY = """
SELECT * FROM raw.b2bfc1_ri
WHERE lob_canal IN ('B2B-MAY', 'B2B-MIN')
"""


# ==============================================================================
# 4) POST-PROCESSING
# ==============================================================================

def _to_numeric(df: pd.DataFrame, cols) -> pd.DataFrame:
    for c in cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
    return df


def _norm_pais(series: pd.Series) -> pd.Series:
    return series.replace({"Other Countries": "Globales"})


def _build_b2b2c_rows(df: pd.DataFrame, filter_set: set = None, ym_shift_years: int = 0) -> list:
    """Actuals/LY df → rows [pais, partner, produto, ym, v0..v28].
    filter_set: set of YYYY-MM to keep; defaults to CLOSED_SET.
    ym_shift_years: shift ym by N years (use 1 for LY so '2025-04' → '2026-04').
    """
    df = df.copy()
    df.columns = [c.lower() for c in df.columns]
    df = df.rename(columns={
        "mes":                 "ym",
        "productooriginal":    "produto",
        "media_other_revenue": "media_revenue",
        "channel_expenses":    "vendor_commissions",
        "net_revenues":        "net_revenue",
        "fvm":                 "npv",
    })
    df["pais"] = _norm_pais(df["pais"])
    fs = filter_set if filter_set is not None else CLOSED_SET
    df = df[df["ym"].isin(fs)]
    if ym_shift_years:
        df["ym"] = df["ym"].apply(lambda y: f"{int(y[:4])+ym_shift_years}-{y[5:]}")
    for c in ["affiliates", "operations", "frauds"]:
        if c not in df.columns:
            df[c] = 0.0
    df = _to_numeric(df, [c for c in METRIC_COLS if c in df.columns])
    df = df.groupby(["pais", "partner", "produto", "ym"], as_index=False).agg(
        {c: "sum" for c in METRIC_COLS if c in df.columns}
    )
    rows = []
    for _, row in df.iterrows():
        vals = [round(float(row.get(c, 0) or 0), 4) for c in METRIC_COLS]
        rows.append([row["pais"], row["partner"], row["produto"], row["ym"]] + vals)
    return rows


def _build_b2b_rows(df: pd.DataFrame, year_col: str, month_col: str,
                    channel_filter: str = None, filter_set: set = None,
                    ym_shift_years: int = 0) -> list:
    """B2B GD/RI actuals/LY df → rows [pais, produto, ym, v0..v28].
    channel_filter: 'API' for MAY (Mayoristas) or 'Agencias afiliadas' for MIN (Minoristas).
    filter_set: set of YYYY-MM to keep; defaults to CLOSED_SET.
    ym_shift_years: shift ym by N years (use 1 for LY so '2025-04' → '2026-04').
    """
    df = df.copy()
    df.columns = [c.lower() for c in df.columns]
    yc, mc = year_col.lower(), month_col.lower()
    df["ym"] = df[yc].astype(str) + "-" + df[mc].astype(int).apply(lambda m: f"{m:02d}")
    df["pais"] = _norm_pais(df["pais"])
    df = df.rename(columns={
        "producto_original":   "produto",
        "media_other_revenue": "media_revenue",
        "fvm":                 "npv",
    })
    if channel_filter:
        df = df[df["parent_channel"] == channel_filter]
    fs = filter_set if filter_set is not None else CLOSED_SET
    df = df[df["ym"].isin(fs)]
    if ym_shift_years:
        df["ym"] = df["ym"].apply(lambda y: f"{int(y[:4])+ym_shift_years}-{y[5:]}")
    for c in ["income_from_outsourced_services", "intercompany_usd", "operations", "vendor_commissions"]:
        if c not in df.columns:
            df[c] = 0.0
    df = _to_numeric(df, [c for c in METRIC_COLS if c in df.columns])
    df = df.groupby(["pais", "produto", "ym"], as_index=False).agg(
        {c: "sum" for c in METRIC_COLS if c in df.columns}
    )
    rows = []
    for _, row in df.iterrows():
        vals = [round(float(row.get(c, 0) or 0), 4) for c in METRIC_COLS]
        rows.append([row["pais"], row["produto"], row["ym"]] + vals)
    return rows


# Budget tables (raw.b2b_budget_gd / raw.b2b_budget_ri) carry the full P&L
# waterfall with signs already applied. Column names map 1:1 to METRIC_COLS
# except for these three aliases:
_BUDGET_RENAME = {
    "producto":          "produto",
    "financial_results": "efecto_financiero",
    "hedge":             "currency_hedge",
    "fvm":               "npv",
}


def _proy_ym(m) -> str:
    """no_mes_proyectado (calendar month 1-12) → FY27 'YYYY-MM' (Apr-Dec→2026, Jan-Mar→2027)."""
    mm = int(float(m))
    y = 2026 if mm >= 4 else 2027
    return f"{y}-{mm:02d}"


def _budget_ym(df: pd.DataFrame, ym_from_proyectado: bool) -> pd.DataFrame:
    """Add a 'ym' column: from `no_mes_proyectado` (forecast) or `fecha` (budget/RR)."""
    if ym_from_proyectado:
        df["ym"] = pd.to_numeric(df["no_mes_proyectado"], errors="coerce")
        df = df.dropna(subset=["ym"])
        df["ym"] = df["ym"].apply(_proy_ym)
    else:
        df["ym"] = pd.to_datetime(df["fecha"], format="mixed", dayfirst=True).dt.strftime("%Y-%m")
    return df


def _build_b2b2c_budget_rows(df: pd.DataFrame, ym_from_proyectado: bool = False) -> list:
    """B2B2C budget/RR/FC → rows [pais, partner, produto, ym, v0..v28] (full waterfall)."""
    df = df.copy()
    df.columns = [c.lower().strip() for c in df.columns]
    df = df.rename(columns=_BUDGET_RENAME)
    if "partner" in df.columns and "pais" in df.columns:
        df.loc[df["partner"] == "CUTC", "pais"] = "USA"
    df = _budget_ym(df, ym_from_proyectado)
    df["pais"] = _norm_pais(df["pais"])
    df = df[df["ym"].isin(FY27_SET)]
    df = _to_numeric(df, [c for c in METRIC_COLS if c in df.columns])
    df = df.groupby(["pais", "partner", "produto", "ym"], as_index=False).agg(
        {c: "sum" for c in METRIC_COLS if c in df.columns}
    )
    rows = []
    for _, row in df.iterrows():
        vals = [round(float(row.get(c, 0) or 0), 4) for c in METRIC_COLS]
        rows.append([row["pais"], row["partner"], row["produto"], row["ym"]] + vals)
    return rows


def _build_b2b_budget_rows(df: pd.DataFrame, lob_filter: str = None,
                           ym_from_proyectado: bool = False) -> list:
    """B2B GD/RI budget/RR/FC → rows [pais, produto, ym, v0..v28] (full waterfall).
    lob_filter: 'B2B-MAY' or 'B2B-MIN'.
    """
    df = df.copy()
    df.columns = [c.lower().strip() for c in df.columns]
    df = df.rename(columns=_BUDGET_RENAME)
    df = _budget_ym(df, ym_from_proyectado)
    df["pais"] = _norm_pais(df["pais"])
    if lob_filter:
        df = df[df["lob_canal"] == lob_filter]
    df = df[df["ym"].isin(FY27_SET)]
    if "produto" not in df.columns:
        df["produto"] = "Total"
    df = _to_numeric(df, [c for c in METRIC_COLS if c in df.columns])
    df = df.groupby(["pais", "produto", "ym"], as_index=False).agg(
        {c: "sum" for c in METRIC_COLS if c in df.columns}
    )
    rows = []
    for _, row in df.iterrows():
        vals = [round(float(row.get(c, 0) or 0), 4) for c in METRIC_COLS]
        rows.append([row["pais"], row["produto"], row["ym"]] + vals)
    return rows


# ==============================================================================
# 4b) SCENARIO STITCHES
# ==============================================================================

# Forecast goal = actuals through Q1 close (Jun) then the forecast projection.
FC_ACTUAL_CUTOFF = "2026-06"


def _stitch_forecast(ac_rows, fcraw_rows, ym_idx):
    """Forecast goal = actuals ≤ Jun (FQ1) + forecast projection > Jun (Jul…Mar)."""
    out = [r for r in ac_rows    if r[ym_idx] <= FC_ACTUAL_CUTOFF]
    out += [r for r in fcraw_rows if r[ym_idx] >  FC_ACTUAL_CUTOFF]
    return out


def _stitch_baseline(ac_rows, rr_rows, fc_rows, bgt_rows, ym_idx):
    """Baseline = actuals for closed months, then the first available projection
    source (run rate → forecast → budget) for each remaining FY27 month.

    ym_idx: index of the ym value inside each row (3 for b2b2c, 2 for b2b).
    All input row lists must share the same shape/key layout.
    """
    # Closed months come straight from actuals.
    out = [r for r in ac_rows if r[ym_idx] <= LAST_ACTUAL_YM]
    # Future months: pick the first source that has data for that month.
    for ym in FY27_MONTHS:
        if ym <= LAST_ACTUAL_YM:
            continue
        for src in (rr_rows, fc_rows, bgt_rows):
            src_ym = [r for r in src if r[ym_idx] == ym]
            if src_ym:
                out.extend(src_ym)
                break
    return out


# ==============================================================================
# 4c) FORECAST from XLSX models  (API→MAY, HTML→MIN, WLs→B2B2C)
# ==============================================================================

# XLSX column names → METRIC_COLS. Most match already; only these differ.
_FC_XLSX_RENAME = {
    "intercompany":        "intercompany_usd",
    "curency_hedge":       "currency_hedge",   # typo in the API "P&L RI" sheet
    "media_other_revenue": "media_revenue",
    "producto":            "produto",
    "fvm":                 "npv",
}


def _read_fc_xlsx(fname: str, sheet: str, month_col: str) -> pd.DataFrame:
    """Read a Forecast model sheet → df with a FY27 'ym' column and normalised metrics.
    month_col: 'mes_proyectado' (GD/emisión) or 'mes ri' (recognition, RI sheet).
    """
    df = pd.read_excel(os.path.join(FC_XLSX_DIR, fname), sheet_name=sheet, dtype=str)
    df.columns = [c.strip().lower() for c in df.columns]
    df = df.rename(columns=_FC_XLSX_RENAME)
    df["pais"] = _norm_pais(df["pais"])
    df["_m"] = pd.to_numeric(df[month_col], errors="coerce")
    df = df.dropna(subset=["_m"])
    df["ym"] = df["_m"].apply(_proy_ym)
    df = df[df["ym"].isin(FY27_SET)]
    return df


def _fc_xlsx_b2b2c_rows(df: pd.DataFrame) -> list:
    """WLs model → rows [pais, partner, produto, ym, v0..v28]."""
    for c in METRIC_COLS:
        if c not in df.columns:
            df[c] = 0.0
    df = _to_numeric(df, METRIC_COLS)
    df = df.groupby(["pais", "partner", "produto", "ym"], as_index=False).agg(
        {c: "sum" for c in METRIC_COLS}
    )
    rows = []
    for _, row in df.iterrows():
        vals = [round(float(row.get(c, 0) or 0), 4) for c in METRIC_COLS]
        rows.append([row["pais"], row["partner"], row["produto"], row["ym"]] + vals)
    return rows


def _fc_xlsx_b2b_rows(df: pd.DataFrame) -> list:
    """API / HTML model → rows [pais, produto, ym, v0..v28] (file is already per-channel)."""
    for c in METRIC_COLS:
        if c not in df.columns:
            df[c] = 0.0
    df = _to_numeric(df, METRIC_COLS)
    df = df.groupby(["pais", "produto", "ym"], as_index=False).agg(
        {c: "sum" for c in METRIC_COLS}
    )
    rows = []
    for _, row in df.iterrows():
        vals = [round(float(row.get(c, 0) or 0), 4) for c in METRIC_COLS]
        rows.append([row["pais"], row["produto"], row["ym"]] + vals)
    return rows


# ==============================================================================
# 5) DRIVE UPLOAD
# ==============================================================================

def _get_drive_service():
    import json as _json
    from pathlib import Path
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    base       = Path(__file__).resolve().parent
    creds_file = base / "credentials_drive.json"
    token_file = base / "token_drive.json"

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

    clasprc = Path.home() / ".clasprc.json"
    tok = _json.loads(clasprc.read_text())["tokens"]["default"]
    expiry = datetime.utcfromtimestamp(tok["expiry_date"] / 1000)
    creds  = Credentials(
        token=tok["access_token"], refresh_token=tok["refresh_token"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=tok["client_id"], client_secret=tok["client_secret"],
        expiry=expiry,
    )
    if not creds.valid:
        creds.refresh(Request())
    return build("drive", "v3", credentials=creds)


def upload_to_drive(json_bytes: bytes):
    from googleapiclient.http import MediaInMemoryUpload
    service = _get_drive_service()
    media   = MediaInMemoryUpload(json_bytes, mimetype="application/json", resumable=False)
    results = service.files().list(
        q=f"name='{JSON_FILE_NAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false",
        fields="files(id,name)",
    ).execute()
    existing = results.get("files", [])
    if existing:
        service.files().update(fileId=existing[0]["id"], media_body=media).execute()
        print(f"  OK Drive: actualizado ({JSON_FILE_NAME})")
    else:
        service.files().create(
            body={"name": JSON_FILE_NAME, "parents": [DRIVE_FOLDER_ID]},
            media_body=media, fields="id",
        ).execute()
        print(f"  OK Drive: creado ({JSON_FILE_NAME})")


# ==============================================================================
# 6) MAIN
# ==============================================================================

# ── Actuals ───────────────────────────────────────────────────────────────────
print("\n--- B2B2C ---")
df_b2b2c    = fetch(build_b2b2c_query(ACTUALS_FROM, ACTUALS_TO), "B2B2C actuals")
df_b2b2c_ly = fetch(build_b2b2c_query(LY_FROM, LY_TO),          "B2B2C LY")

print("\n--- B2B GD ---")
df_b2b_gd    = fetch(build_b2b_gd_query(ACTUALS_FROM, ACTUALS_TO), "B2B GD actuals")
df_b2b_gd_ly = fetch(build_b2b_gd_query(LY_FROM, LY_TO),           "B2B GD LY")

print("\n--- B2B RI ---")
df_b2b_ri = fetch(build_b2b_ri_query(ACTUALS_FROM, ACTUALS_TO), "B2B RI actuals")
# (RI LY not fetched: Last Year is GD-basis only)

# ── Budgets ───────────────────────────────────────────────────────────────────
print("\n--- Budgets ---")
df_b2b2c_budget  = fetch(B2B2C_BUDGET_QUERY,  "B2B2C budget")
df_b2b_budget_gd = fetch(B2B_BUDGET_GD_QUERY, "B2B Budget GD")
df_b2b_budget_ri = fetch(B2B_BUDGET_RI_QUERY, "B2B Budget RI")

# ── Run Rate ──────────────────────────────────────────────────────────────────
print("\n--- Run Rate ---")
df_rr_b2b2c = fetch(B2B2C_RR_QUERY,  "B2B2C run rate")
df_rr_gd    = fetch(B2B_RR_GD_QUERY, "B2B run rate GD")
df_rr_ri    = fetch(B2B_RR_RI_QUERY, "B2B run rate RI")

# ── Forecast (XLSX models; datalake raw.b2bfc1_* is outdated) ─────────────────
print("\n--- Forecast (XLSX models) ---")
fcraw_b2b2c  = _fc_xlsx_b2b2c_rows(_read_fc_xlsx("WLs - Modelo Forecast.xlsx",  "P&L",    "mes_proyectado"))
fcraw_may    = _fc_xlsx_b2b_rows(  _read_fc_xlsx("API - Modelo Forecast.xlsx",  "P&L",    "mes_proyectado"))
fcraw_may_ri = _fc_xlsx_b2b_rows(  _read_fc_xlsx("API - Modelo Forecast.xlsx",  "P&L RI", "mes ri"))
fcraw_min    = _fc_xlsx_b2b_rows(  _read_fc_xlsx("HTML - Modelo Forecast.xlsx", "P&L",    "mes_proyectado"))
print(f"  WLs (b2b2c): {len(fcraw_b2b2c)}  API GD: {len(fcraw_may)}  API RI: {len(fcraw_may_ri)}  HTML GD: {len(fcraw_min)}")

# ── Post-procesando ───────────────────────────────────────────────────────────
print("\n--- Post-procesando ---")

# Run rate rows (ym from `fecha`, already FY27)
rr_b2b2c  = _build_b2b2c_budget_rows(df_rr_b2b2c)
rr_may    = _build_b2b_budget_rows(df_rr_gd, lob_filter="B2B-MAY")
rr_may_ri = _build_b2b_budget_rows(df_rr_ri, lob_filter="B2B-MAY")
rr_min    = _build_b2b_budget_rows(df_rr_gd, lob_filter="B2B-MIN")

# B2B2C
ac_b2b2c  = _build_b2b2c_rows(df_b2b2c)                                             # actuals (closed)
ly_b2b2c  = _build_b2b2c_rows(df_b2b2c_ly, filter_set=LY_FULL_SET, ym_shift_years=1)
bgt_b2b2c = _build_b2b2c_budget_rows(df_b2b2c_budget)                               # budget (full FY)
bl_b2b2c  = _stitch_baseline(ac_b2b2c, rr_b2b2c, fcraw_b2b2c, bgt_b2b2c, ym_idx=3)  # actuals→RR→FC→bgt
fc_b2b2c  = _stitch_forecast(ac_b2b2c, fcraw_b2b2c, ym_idx=3)                       # goal: actuals≤Jun + FC

# B2B MAY (GD + RI basis)
ac_may     = _build_b2b_rows(df_b2b_gd, "anio_gd", "mes_gd", channel_filter="API")
ac_may_ri  = _build_b2b_rows(df_b2b_ri, "anio_ri", "mes_ri", channel_filter="API")
ly_may     = _build_b2b_rows(df_b2b_gd_ly, "anio_gd", "mes_gd", channel_filter="API",
                             filter_set=LY_FULL_SET, ym_shift_years=1)
bgt_may    = _build_b2b_budget_rows(df_b2b_budget_gd, lob_filter="B2B-MAY")
bgt_may_ri = _build_b2b_budget_rows(df_b2b_budget_ri, lob_filter="B2B-MAY")
bl_may     = _stitch_baseline(ac_may,    rr_may,    fcraw_may,    bgt_may,    ym_idx=2)
bl_may_ri  = _stitch_baseline(ac_may_ri, rr_may_ri, fcraw_may_ri, bgt_may_ri, ym_idx=2)
fc_may     = _stitch_forecast(ac_may,    fcraw_may,    ym_idx=2)
fc_may_ri  = _stitch_forecast(ac_may_ri, fcraw_may_ri, ym_idx=2)

# B2B MIN (GD basis only)
ac_min  = _build_b2b_rows(df_b2b_gd, "anio_gd", "mes_gd", channel_filter="Agencias afiliadas")
ly_min  = _build_b2b_rows(df_b2b_gd_ly, "anio_gd", "mes_gd", channel_filter="Agencias afiliadas",
                          filter_set=LY_FULL_SET, ym_shift_years=1)
bgt_min = _build_b2b_budget_rows(df_b2b_budget_gd, lob_filter="B2B-MIN")
bl_min  = _stitch_baseline(ac_min, rr_min, fcraw_min, bgt_min, ym_idx=2)
fc_min  = _stitch_forecast(ac_min, fcraw_min, ym_idx=2)

actual_months = sorted(CLOSED_SET)
print(f"  actual_months: {actual_months}  (last actual = {LAST_ACTUAL_YM})")
print(f"  b2b2c:   ac={len(ac_b2b2c):,}  rr={len(rr_b2b2c):,}  fc={len(fc_b2b2c):,}  bl={len(bl_b2b2c):,}  bgt={len(bgt_b2b2c):,}  ly={len(ly_b2b2c):,}")
print(f"  b2b_may: ac={len(ac_may):,}  ac_ri={len(ac_may_ri):,}  rr={len(rr_may):,}  fc={len(fc_may):,}  bl={len(bl_may):,}  bl_ri={len(bl_may_ri):,}  bgt={len(bgt_may):,}  bgt_ri={len(bgt_may_ri):,}  ly={len(ly_may):,}")
print(f"  b2b_min: ac={len(ac_min):,}  rr={len(rr_min):,}  fc={len(fc_min):,}  bl={len(bl_min):,}  bgt={len(bgt_min):,}  ly={len(ly_min):,}")

output = {
    "updated_at":    datetime.now().isoformat(timespec="seconds"),
    "actuals_from":  str(ACTUALS_FROM),
    "actuals_to":    str(ACTUALS_TO),
    "actual_months": actual_months,
    "last_actual_ym": LAST_ACTUAL_YM,
    "months":        FY27_MONTHS,
    "metrics":       METRIC_COLS,
    "b2b2c": {
        "ac": ac_b2b2c, "ly": ly_b2b2c, "bgt": bgt_b2b2c,
        "rr": rr_b2b2c, "fc": fc_b2b2c, "bl": bl_b2b2c,
    },
    "b2b_may": {
        "ac": ac_may, "ac_ri": ac_may_ri, "ly": ly_may,
        "bgt": bgt_may, "bgt_ri": bgt_may_ri,
        "rr": rr_may, "rr_ri": rr_may_ri, "fc": fc_may, "fc_ri": fc_may_ri,
        "bl": bl_may, "bl_ri": bl_may_ri,
    },
    "b2b_min": {
        "ac": ac_min, "ly": ly_min, "bgt": bgt_min,
        "rr": rr_min, "fc": fc_min, "bl": bl_min,
    },
}

json_bytes = json.dumps(output, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
size_kb    = len(json_bytes) / 1024
print(f"\n  JSON: {size_kb:.1f} KB")

print("\n--- Subiendo a Google Drive ---")
upload_to_drive(json_bytes)

print(f"\nOK Completado: {TODAY.strftime('%d-%m-%Y')}")
