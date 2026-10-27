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
  ac_ri   actuals on RI basis            (B2B-MAY: check-in para API; B2B-MIN: recognition_date)
  ly      last year (real prior period, ym shifted +1y)
  bgt     budget GD  (full FY27, datalake raw.b2b_budget_gd)
  bgt_ri  budget RI  (full FY27, datalake raw.b2b_budget_ri; B2B-MAY y B2B-MIN)
  rr      run rate   (near-term, raw.b2brr_gd; Aug-Oct)  — raw rows for stitch
  rr_ri   run rate RI (raw.b2brr_ri; B2B-MAY y B2B-MIN)
  fc      forecast GOAL = actuals ≤ Jun + forecast projection Jul-Mar
  fc_ri   forecast goal on RI basis (B2B-MAY del modelo "P&L RI"; B2B-MIN reusa la proyección GD)
  bl      baseline   = ac (closed) then rr → fc → bgt per future month
  bl_ri   baseline on RI basis            (B2B-MAY y B2B-MIN)

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
from pathlib import Path
from dotenv import load_dotenv

warnings.filterwarnings("ignore")

# ==============================================================================
# 1) CONFIG
# ==============================================================================

# Credenciales del Datalake por usuario (mismo esquema que Daily_Dashboard/daily_sync.py):
# <repo>/credenciales/.env.<usuario de Windows>. Restaurado 2026-09-25: el commit 96e6644
# había pisado este archivo con una versión vieja y rutas fijas a otra máquina.
_WIN_USER       = os.environ.get("USERNAME", "").lower()
RUTA_ENV        = str(Path(__file__).resolve().parent.parent / "credenciales" / f".env.{_WIN_USER}")
DSN_NAME        = "DataLake Treasure ODBC"
DRIVE_FOLDER_ID = "1wzudbo7cN9Ibiv_2OA-V0_B_un4JcJp6"
JSON_FILE_NAME  = "_actuals_gestional.json"
DRIVE_SCOPES    = ["https://www.googleapis.com/auth/drive"]

# Forecast comes from the XLSX models (datalake raw.b2bfc1_* is not kept up to
# date). Update this folder when a newer forecast round is published.
# La raíz de OneDrive cambia según la máquina ("OneDrive - despegar365" o "despegar365").
# Año fiscal: sale de Inputs_Planning_PnL/config.py (CURRENT_FY). Para pasar a otro FY se cambia
# solo ahí — acá no hay meses escritos a mano (auditoría ola 4, 2026-09-25).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "Inputs_Planning_PnL"))
import config as _planning_cfg
# Definición única de hunting (New/Existing por partner B2B2C), compartida con Daily_Dashboard/daily_sync.py
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "Daily_Dashboard"))
import hunting_rules
# País correcto de partners B2B2C mal cargados en las proyecciones (CUTC), compartido con el Daily
from pais_rules import apply_pais_overrides
from rg_rows import append_rg_rows   # país RG: COI + efecto financiero de Brasil con signo contrario
_FY = _planning_cfg.CURRENT_FY                                  # 2027 = FY27 (abr-2026 → mar-2027)
FY_MONTHS = [d[:7] for d in _planning_cfg.FISCAL_DATES]         # 'YYYY-MM', abr → mar

# Carpeta de la ronda de Forecast: FY y versión salen de config.py (GESTION_FOLDER / FORECAST_VERSION).
# Dos estructuras de OneDrive, igual que pnl_common.get_base_dir(): la nueva
# (Control de Gestión - Documentos\Planeamiento\2026-27) y el acceso directo viejo (Control de Gestión - 2026-27).
_FY_TAG = _planning_cfg.GESTION_FOLDER.replace("Control de Gestión - ", "")   # "2026-27"
_FC_REL = rf"B2B & WLs\Forecast\{_planning_cfg.FORECAST_VERSION}"
_FC_SUBPATHS = [rf"Control de Gestión - Documentos\Planeamiento\{_FY_TAG}\{_FC_REL}",
                rf"{_planning_cfg.GESTION_FOLDER}\{_FC_REL}"]
_ONEDRIVE_ROOTS = [Path.home() / "OneDrive - despegar365", Path.home() / "despegar365"]
FC_XLSX_DIR = next((str(r / sp) for sp in _FC_SUBPATHS for r in _ONEDRIVE_ROOTS if (r / sp).is_dir()),
                   str(_ONEDRIVE_ROOTS[0] / _FC_SUBPATHS[-1]))

TODAY        = date.today()
CURRENT_YM   = TODAY.strftime('%Y-%m')
ACTUALS_FROM = date(_FY - 1, 4, 1)   # inicio del FY (abril)
_first_of_current = date(TODAY.year, TODAY.month, 1)
ACTUALS_TO   = _first_of_current - timedelta(days=1)  # last day of last closed month

# LY = FULL prior fiscal year (FY26: Apr-2025 … Mar-2026), all real/closed.
# The whole prior FY is in the past, so Last Year carries all 12 months (not
# just the mirror of currently-closed months) to compare against the full FY27.
LY_FROM = date(ACTUALS_FROM.year - 1, ACTUALS_FROM.month, ACTUALS_FROM.day)  # 2025-04-01
LY_TO   = ACTUALS_FROM - timedelta(days=1)                                    # 2026-03-31

# Meses PREVIOS al FY que la landing muestra sueltos antes de Abr (2026-10-19): Ene–Mar del año en
# que arranca el FY (= Q4 del FY anterior). Solo Actuals + su LY (Ene–Mar del año anterior); no hay
# Budget/RR/Forecast. NO entran en `ac` (Forecast goal, Managerial vs Accounting, Revenue GD y los
# OKR leen `ac` como el FY en curso): se agregan a bl/bl_ri, ly y a las secciones *_gw / *_tp.
PRE_MONTHS    = [f"{ACTUALS_FROM.year}-{m:02d}" for m in (1, 2, 3)]          # 2026-01..03
PRE_SET       = set(PRE_MONTHS)
PRE_LY_SET    = {f"{int(ym[:4]) - 1}-{ym[5:]}" for ym in PRE_MONTHS}        # 2025-01..03
PRE_FROM      = date(ACTUALS_FROM.year, 1, 1)                               # 2026-01-01
LY_FETCH_FROM = date(LY_FROM.year, 1, 1)   # las queries LY arrancan en ene → traen el LY de PRE_MONTHS

FY_SET   = set(FY_MONTHS)
CLOSED_SET    = {ym for ym in FY_SET if ym < CURRENT_YM}
# Full prior FY (FY26) months, shifted back 1 year from FY27.
LY_FULL_SET   = {f"{int(ym[:4])-1}-{ym[5:]}" for ym in FY_SET}
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
print(f"Closed FY{str(_FY)[-2:]} months: {sorted(CLOSED_SET)}")

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
    try:
        df = pd.read_sql(query, con)
    finally:
        con.close()
    print(f"  OK {len(df):,} filas")
    # Mismo guardrail que ya usa revenue_gd_builder.py (script hermano de este
    # módulo): sin esto, una query que vuelve vacía a mitad de corrida (VPN
    # caída, tabla renombrada) no rompía nada — el pipeline seguía y subía el
    # JSON con esa sección en 0, pisando el archivo bueno de producción. Cortar
    # acá, antes de armar nada, es más seguro que validar recién al final.
    if df.empty:
        sys.exit(f"'{label}' devolvió 0 filas — VPN caída o cambio de esquema. NO se sube nada.")
    return df


# ==============================================================================
# 3) QUERIES
# ==============================================================================

def build_b2b2c_query(date_from: date, date_to: date, by_tipo: bool = False) -> str:
    """by_tipo: agrega `tipo_producto` (product_type crudo de bi_transactional_fact_products: Vuelos,
    Hoteles, Disney, Universal, Excursiones...) al grano. Es una query APARTE (secciones ac_tp/ly_tp)
    y no una columna más de la normal: un paquete tiene componentes de varios tipos y el
    count(distinct transaction_code) de `orders` se duplicaría al sumar las aperturas."""
    tipo_sel = "COALESCE(p.product_type, '(Sin dato)') AS tipo_producto," if by_tipo else ""
    group_by = "1,2,3,4,5,6,7,8" if by_tipo else "1,2,3,4,5,6,7"
    tipo_out = "tipo_producto," if by_tipo else ""
    return f"""
-- Canje (pago con millas/puntos, 2026-10-20): por transacción, la porción del GB pagada con millas
-- (`share`, 0..1). USD canjeados = consumption.amount (moneda local de la transacción, estado OK)
-- × conversion_rate de la transacción, con tope en el GB (≈2% canjea algo más que el GB sin impuestos).
WITH millas_tx AS (
  SELECT cj.tc,
         GREATEST(0.0, LEAST(1.0, COALESCE(
           cj.miles_usd / NULLIF(SUM(m.gb_without_distorted_taxes_usd), 0), 1.0))) AS share
  FROM (
    SELECT CAST(sr.reservation_id AS varchar) AS tc,
           SUM(CAST(c.amount AS DOUBLE) * CAST(t2.conversion_rate AS DOUBLE)) AS miles_usd
    FROM data.raw.specialclients_services_redemption sr
    JOIN data.raw.specialclients_services_consumption c
      ON c.redemption_id = sr.trip_id AND c.current_operation_status = 'OK'
    JOIN data.analytics.bi_transactional_fact_transactions t2
      ON CAST(t2.transaction_code AS varchar) = CAST(sr.reservation_id AS varchar)
     AND t2.reservation_year_month >= CAST('2023-01-01' AS date)
     AND t2.line_of_business = 'B2B2C'
     AND t2.confirmation_date >= date('{date_from}')
     AND t2.confirmation_date <= date('{date_to}')
    WHERE sr.status = 'ISSUED'
    GROUP BY 1
  ) cj
  JOIN data.analytics.bi_pnlop_fact_current_model m
    ON CAST(m.transaction_code AS varchar) = cj.tc AND m.date_reservation_year_month >= '2023-01'
  JOIN data.analytics.bi_transactional_fact_products pm     -- mismo universo que base: productos confirmados
    ON CAST(pm.product_id AS varchar) = CAST(m.product_id AS varchar)
   AND pm.reservation_year_month >= CAST('2023-01-01' AS date) AND pm.is_confirmed_flg = 1
  GROUP BY cj.tc, cj.miles_usd
),

base AS (
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
    {tipo_sel}

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
    AS FVM_Base,

    -- Canje: GB pagado con millas (exacto por transacción) y transacciones con canje
    sum(pnl.gb_without_distorted_taxes_usd * COALESCE(mt.share, 0)) AS gb_millas,
    count(distinct CASE WHEN mt.share > 0 THEN t.transaction_code END) AS orders_millas

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
  LEFT JOIN millas_tx mt ON mt.tc = CAST(t.transaction_code AS varchar)
  WHERE pnl.date_reservation_year_month >= '2023-01'
    AND p.reservation_year_month >= CAST('2023-01-01' AS date)
    AND t.reservation_year_month >= CAST('2023-01-01' AS date)
    AND t.confirmation_date >= date('{date_from}')
    AND t.confirmation_date <= date('{date_to}')
    AND p.is_confirmed_flg = 1
    AND t.line_of_business = 'B2B2C'
    -- Solo partners de la cartera de ComDev (mismo filtro que Daily_Dashboard/daily_sync.py:
    -- build_actuals_query): afuera los partner_data_id sin cartera (AG.../AP..., KMV, demos).
    AND di.partner_id IS NOT NULL
  GROUP BY {group_by}
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
  Mes, pais, productooriginal, partner, {tipo_out}
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
    + efecto_fin_naranja AS FVM,
  gb_millas, orders_millas
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
        ('O','Agencias afiliadas','Hoteles',0.735475),('AR','Agencias afiliadas','Hoteles',0.900000),
        ('CO','Agencias afiliadas','Hoteles',0.768379),('CL','Agencias afiliadas','Hoteles',0.877266),
        ('PE','Agencias afiliadas','Hoteles',0.894839),('EC','Agencias afiliadas','Hoteles',0.911666),
        ('BR','Agencias afiliadas','Carrito',0.992196),('MX','Agencias afiliadas','Carrito',0.898147),
        ('O','Agencias afiliadas','Carrito',1.000000),('AR','Agencias afiliadas','Carrito',0.964833),
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
        -- Gateway (proveedor) solo para Hoteles: el resto de los productos queda en NULL
        -- para no abrir filas de más. Alimenta las secciones *_gw del JSON (filtro de la landing).
        CASE WHEN fh.buy_type_code = 'Hoteles' THEN p.gateway END AS gateway,
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
        -SUM(CASE WHEN pr.installments IN (0, 1, null) THEN 0 ELSE pnl.coi_usd END) AS cost_of_installments,
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
        SUM(CASE
                WHEN fh.parent_channel = 'API' THEN 0
                WHEN t.country_code = 'BR'     THEN fh.gestion_gb * fh.confirmation_gradient * -0.0056
                ELSE                                fh.gestion_gb * fh.confirmation_gradient * -0.0053
            END) AS frauds,
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
        CASE WHEN fh.buy_type_code = 'Hoteles' THEN p.gateway END,
        CASE WHEN fh.trip_type_code = 'Nac' THEN 'Domestic'
             WHEN fh.trip_type_code = 'Int' THEN 'International'
             ELSE fh.trip_type_code END
)

SELECT
    anio_gd, mes_gd, pais, producto_original, parent_channel, viaje, gateway,
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
        ('BR','API','Hoteles',1.00000),('MX','API','Hoteles',1.00000),
        ('O','API','Hoteles',1.11000),('AR','API','Hoteles',0.76244),
        ('CO','API','Hoteles',0.73907),('CL','API','Hoteles',0.22390),
        ('PE','API','Hoteles',1.00000),('EC','API','Hoteles',1.00000),
        ('BR','Agencias afiliadas','Hoteles',0.95877),('MX','Agencias afiliadas','Hoteles',0.87797),
        ('O','Agencias afiliadas','Hoteles',0.73548),('AR','Agencias afiliadas','Hoteles',0.90000),
        ('CO','Agencias afiliadas','Hoteles',0.76838),('CL','Agencias afiliadas','Hoteles',0.87727),
        ('PE','Agencias afiliadas','Hoteles',0.89484),('EC','Agencias afiliadas','Hoteles',0.91167),
        ('BR','Agencias afiliadas','Carrito',0.99220),('MX','Agencias afiliadas','Carrito',0.89815),
        ('O','Agencias afiliadas','Carrito',1.00000),('AR','Agencias afiliadas','Carrito',0.96483),
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

pnl_filtered AS (
    SELECT * FROM data.analytics.bi_pnlop_fact_current_model
    WHERE line_of_business = 'B2B' AND date_reservation_year_month > '2024-01'
),

base_metrics AS (
    SELECT
        CAST(
            CASE WHEN fh.parent_channel = 'API' AND fh.buy_type_code = 'Hoteles'
                 THEN YEAR(p.checkin_date) ELSE YEAR(fh.recognition_date) END
        AS VARCHAR) AS anio_ri,
        CASE WHEN fh.parent_channel = 'API' AND fh.buy_type_code = 'Hoteles'
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
        -- Gateway (proveedor) solo para Hoteles: el resto de los productos queda en NULL
        -- para no abrir filas de más. Alimenta las secciones *_gw del JSON (filtro de la landing).
        CASE WHEN fh.buy_type_code = 'Hoteles' THEN p.gateway END AS gateway,
        CASE WHEN fh.trip_type_code = 'Nac' THEN 'Domestic'
             WHEN fh.trip_type_code = 'Int' THEN 'International'
             ELSE fh.trip_type_code END AS viaje,

        SUM(fh.gestion_gb) AS gross_bookings,
        COUNT(DISTINCT t.transaction_code) AS orders,
        SUM((pnl.commission_net_usd / NULLIF(fh.confirmation_gradient, 0))
            * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                   ELSE COALESCE(cf.country_factor, 1.0) END) AS up_front_incentives,
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
                   ELSE COALESCE(cf.country_factor, 1.0) END) AS fees,
        -SUM((pnl.discounts_net_usd / NULLIF(fh.confirmation_gradient, 0))
             * CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0.25
                    ELSE COALESCE(cf.country_factor, 1.0) END) AS commercial_discounts,
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
        -SUM(CASE WHEN pr.installments IN (0, 1, null) THEN 0
                  ELSE pnl.coi_usd / NULLIF(fh.confirmation_gradient, 0) END) AS cost_of_installments,
        -SUM(CASE WHEN fh.parent_channel = 'API' THEN 0
                  ELSE pnl.ccp_usd / NULLIF(fh.confirmation_gradient, 0) END) AS credit_card_processing,
        SUM(CASE
                WHEN fh.parent_channel = 'API' THEN NULL
                WHEN fh.country_code = 'BR' AND fh.buy_type_code IN ('Carrito','Vuelos')
                     AND p.product_type = 'Vuelos'
                THEN -(pr.net_commission_partner * pr.conversion_rate)
                WHEN fh.country_code = 'BR' AND fh.buy_type_code = 'Carrito' THEN 0
                ELSE -(pnl.affiliates_usd / NULLIF(fh.confirmation_gradient, 0))
                     + CASE WHEN fh.country_code = 'BR' AND fh.buy_type_code != 'Vuelos'
                            THEN pnl.affiliates_usd / NULLIF(fh.confirmation_gradient, 0) ELSE 0 END
            END
            * CASE WHEN fh.country_code = 'MX' AND fh.parent_channel = 'Agencias afiliadas'
                        AND fh.buy_type_code = 'Carrito' THEN 0.75 ELSE 1.0 END
        ) AS affiliates,
        SUM(CASE
                WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0
                WHEN fh.parent_channel = 'API'
                THEN fh.gestion_gb * CASE fh.country_code
                        WHEN 'BR' THEN -0.0042 WHEN 'MX' THEN -0.0050
                        WHEN 'AR' THEN -0.0120 WHEN 'CO' THEN -0.0100
                        WHEN 'CL' THEN -0.03405 WHEN 'PE' THEN -0.0160
                        WHEN 'EC' THEN  0.0000
                        ELSE -0.0070 END
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
        -SUM(pnl.mkt_cost_net_usd / NULLIF(fh.confirmation_gradient, 0)) AS mkt_usd,
        SUM(pnl.errors_usd / NULLIF(fh.confirmation_gradient, 0)) AS errors,
        SUM(pnl.ott_usd / NULLIF(fh.confirmation_gradient, 0)) AS other_transactional_taxes,
        SUM(pnl.customer_claims_usd / NULLIF(fh.confirmation_gradient, 0)) AS customer_claims,
        SUM(pnl.customer_service_usd / NULLIF(fh.confirmation_gradient, 0)) AS customer_service,
        SUM(CASE
                WHEN fh.parent_channel = 'API' THEN 0
                WHEN t.country_code = 'BR'     THEN fh.gestion_gb * -0.0056
                ELSE                                fh.gestion_gb * -0.0053
            END) AS frauds,
        SUM(pnl.financial_result_usd / NULLIF(fh.confirmation_gradient, 0)) AS efecto_financiero,
        SUM((pnl.dif_fx_usd + pnl.dif_fx_air_usd) / NULLIF(fh.confirmation_gradient, 0)) AS dif_fx,
        SUM((pnl.currency_hedge_usd + pnl.currency_hedge_air_usd)
            / NULLIF(fh.confirmation_gradient, 0)) AS currency_hedge

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
    LEFT JOIN data.analytics.bi_transactional_fact_products_current_state cs
        ON fh.product_id = cs.product_id
    LEFT JOIN conectores con ON fh.partner_id = con.ap_code
    WHERE
        CASE WHEN fh.parent_channel = 'API' AND fh.buy_type_code = 'Hoteles'
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
        CASE WHEN fh.parent_channel = 'API' AND fh.buy_type_code = 'Hoteles'
             THEN YEAR(p.checkin_date) ELSE YEAR(fh.recognition_date) END,
        CASE WHEN fh.parent_channel = 'API' AND fh.buy_type_code = 'Hoteles'
             THEN MONTH(p.checkin_date) ELSE MONTH(fh.recognition_date) END,
        fh.gestion_date,
        CASE WHEN fh.parent_channel = 'API' AND fh.buy_type_code = 'Hoteles'
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
        CASE WHEN fh.buy_type_code = 'Hoteles' THEN p.gateway END,
        CASE WHEN fh.trip_type_code = 'Nac' THEN 'Domestic'
             WHEN fh.trip_type_code = 'Int' THEN 'International'
             ELSE fh.trip_type_code END,
        fh.product_status
)

SELECT
    anio_ri, mes_ri, pais, producto_original, parent_channel, viaje, gateway,
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


TIPO_SIN_DATO = "(Sin dato)"
MILLAS_CON, MILLAS_SIN = "Con millas", "Sin millas"


def _split_millas(df: pd.DataFrame) -> pd.DataFrame:
    """Abre cada fila en Con millas / Sin millas (columna `millas`). GB exacto (gb_millas de la query,
    prorrateado por transacción); el resto de las métricas se reparte con la misma proporción de GB
    de la fila. Orders: las transacciones con canje van enteras a Con millas (las dos suman el total)."""
    gb  = df["gross_bookings"]
    gbm = pd.to_numeric(df["gb_millas"], errors="coerce").fillna(0.0)
    om  = pd.to_numeric(df["orders_millas"], errors="coerce").fillna(0.0)
    r = (gbm / gb.where(gb != 0)).fillna((om > 0).astype(float)).clip(0, 1)
    con, sin = df.copy(), df.copy()
    for c in METRIC_COLS:
        if c in df.columns and c not in ("orders", "gross_bookings"):
            con[c] = df[c] * r
            sin[c] = df[c] * (1 - r)
    # GB exacto (aunque la fila mezcle signos y r quede clipeado)
    con["gross_bookings"], sin["gross_bookings"] = gbm, gb - gbm
    con["orders"], sin["orders"] = om, df["orders"] - om
    con["millas"], sin["millas"] = MILLAS_CON, MILLAS_SIN
    return pd.concat([con[(r > 0) | (om > 0) | (gbm != 0)],
                      sin[(r < 1) | (sin["orders"] > 0) | (sin["gross_bookings"] != 0)]], ignore_index=True)


def _build_b2b2c_rows(df: pd.DataFrame, filter_set: set = None, ym_shift_years: int = 0,
                      by_tipo: bool = False, by_millas: bool = False) -> list:
    """Actuals/LY df → rows [pais, partner, produto, ym, v0..v28].
    filter_set: set of YYYY-MM to keep; defaults to CLOSED_SET.
    ym_shift_years: shift ym by N years (use 1 for LY so '2025-04' → '2026-04').
    by_tipo: df de build_b2b2c_query(by_tipo=True) → rows [pais, partner, produto, ym, v0..v28, tipo]
      (tipo de producto al FINAL, igual que el viaje en B2B: los offsets de siempre no se mueven).
      Son las secciones ac_tp / ly_tp (filtro "Tipo de producto" de B2B2C en la landing).
    by_millas: abre cada fila en Con/Sin millas (canje, ver _split_millas) → `millas` como última columna
      (después del tipo si by_tipo). Secciones ac_mi / ly_mi y, junto con el tipo, ac_tp / ly_tp.
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
    keys = ["pais", "partner", "produto", "ym"]
    if by_tipo:
        # El driver ODBC rompe el acento de "Espectáculos" (mismo arreglo que Daily_Dashboard/daily_sync.py)
        df["tipo_producto"] = (df["tipo_producto"].fillna(TIPO_SIN_DATO).astype(str).str.strip()
                               .replace("", TIPO_SIN_DATO)
                               .str.replace(r"^Espect.*$", "Espectáculos", regex=True))
        keys.append("tipo_producto")
    df = _to_numeric(df, [c for c in METRIC_COLS if c in df.columns])
    if by_millas:
        df = _split_millas(df)
        keys.append("millas")
    df = df.groupby(keys, as_index=False).agg(
        {c: "sum" for c in METRIC_COLS if c in df.columns}
    )
    rows = []
    for _, row in df.iterrows():
        vals = [round(float(row.get(c, 0) or 0), 4) for c in METRIC_COLS]
        rows.append([row["pais"], row["partner"], row["produto"], row["ym"]] + vals
                    + ([row["tipo_producto"]] if by_tipo else [])
                    + ([row["millas"]] if by_millas else []))
    return append_rg_rows(rows, 4, METRIC_COLS)


VIAJE_SIN_DATO = "(Sin dato)"


def _viaje_col(df: pd.DataFrame) -> pd.Series:
    """Tipo de viaje (Domestic / International) normalizado; vacío o ausente → '(Sin dato)'.
    Va como ÚLTIMA columna de cada fila B2B ([pais, produto, ym, v0..v28, viaje]): así todo lo
    que lee las filas por posición (Codigo.js, Managerial vs Accounting) sigue
    igual y simplemente suma las dos aperturas. Lo usa el filtro "Viaje" de la landing (2026-10-13)."""
    if "viaje" not in df.columns:
        return pd.Series(VIAJE_SIN_DATO, index=df.index)
    return df["viaje"].fillna(VIAJE_SIN_DATO).astype(str).str.strip().replace("", VIAJE_SIN_DATO)


GW_SIN_DATO = "(Sin gateway)"


def _build_b2b_rows(df: pd.DataFrame, year_col: str, month_col: str,
                    channel_filter: str = None, filter_set: set = None,
                    ym_shift_years: int = 0, by_gateway: bool = False) -> list:
    """B2B GD/RI actuals/LY df → rows [pais, produto, ym, v0..v28, viaje].
    channel_filter: 'API' for MAY (Mayoristas) or 'Agencias afiliadas' for MIN (Minoristas).
    filter_set: set of YYYY-MM to keep; defaults to CLOSED_SET.
    ym_shift_years: shift ym by N years (use 1 for LY so '2025-04' → '2026-04').
    by_gateway: solo Hotels, agrupado por gateway → rows [pais, gateway, ym, v0..v28]
      (misma forma que las filas normales, con el gateway en la posición del producto).
      Son las secciones ac_gw / ac_ri_gw / ly_gw del JSON. Budget/RR/FC no tienen
      apertura por gateway, así que con el filtro activo la landing muestra solo Actuals y LY.
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
    if by_gateway:
        df = df[df["produto"] == "Hotels"].copy()
        df["produto"] = df["gateway"].fillna(GW_SIN_DATO).astype(str).str.strip().replace("", GW_SIN_DATO)
    fs = filter_set if filter_set is not None else CLOSED_SET
    df = df[df["ym"].isin(fs)]
    if ym_shift_years:
        df["ym"] = df["ym"].apply(lambda y: f"{int(y[:4])+ym_shift_years}-{y[5:]}")
    for c in ["income_from_outsourced_services", "intercompany_usd", "operations", "vendor_commissions"]:
        if c not in df.columns:
            df[c] = 0.0
    df["viaje"] = _viaje_col(df)
    df = _to_numeric(df, [c for c in METRIC_COLS if c in df.columns])
    df = df.groupby(["pais", "produto", "ym", "viaje"], as_index=False).agg(
        {c: "sum" for c in METRIC_COLS if c in df.columns}
    )
    rows = []
    for _, row in df.iterrows():
        vals = [round(float(row.get(c, 0) or 0), 4) for c in METRIC_COLS]
        rows.append([row["pais"], row["produto"], row["ym"]] + vals + [row["viaje"]])
    return append_rg_rows(rows, 3, METRIC_COLS)


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
    """no_mes_proyectado (calendar month 1-12) → 'YYYY-MM' del FY en curso (Abr-Dic→FY-1, Ene-Mar→FY)."""
    mm = int(float(m))
    y = _FY - 1 if mm >= 4 else _FY
    return f"{y}-{mm:02d}"


def _parse_fecha_budget(s: pd.Series) -> pd.Series:
    """Parsea 'fecha' sin el bug de pd.to_datetime(format='mixed', dayfirst=True):
    ese combo invierte silenciosamente día/mes en fechas ISO (YYYY-MM-DD) cuando
    el día es <=12. Mismo bug confirmado y corregido en Daily_Dashboard/daily_sync.py
    (ver CLAUDE.md, regla de fechas) — separa el caso ISO explícito del resto."""
    s = s.astype(str).str.strip()
    iso = s.str.match(r"^\d{4}-\d{1,2}-\d{1,2}$")
    out = pd.Series(pd.NaT, index=s.index, dtype="datetime64[ns]")
    out.loc[iso]  = pd.to_datetime(s[iso],  format="%Y-%m-%d", errors="coerce")
    out.loc[~iso] = pd.to_datetime(s[~iso], dayfirst=True,     errors="coerce")
    return out


def _budget_ym(df: pd.DataFrame, ym_from_proyectado: bool) -> pd.DataFrame:
    """Add a 'ym' column: from `no_mes_proyectado` (forecast) or `fecha` (budget/RR)."""
    if ym_from_proyectado:
        df["ym"] = pd.to_numeric(df["no_mes_proyectado"], errors="coerce")
        df = df.dropna(subset=["ym"])
        df["ym"] = df["ym"].apply(_proy_ym)
    else:
        df["ym"] = _parse_fecha_budget(df["fecha"]).dt.strftime("%Y-%m")
    return df


def _build_b2b2c_budget_rows(df: pd.DataFrame, ym_from_proyectado: bool = False) -> list:
    """B2B2C budget/RR/FC → rows [pais, partner, produto, ym, v0..v28] (full waterfall)."""
    df = df.copy()
    df.columns = [c.lower().strip() for c in df.columns]
    df = df.rename(columns=_BUDGET_RENAME)
    apply_pais_overrides(df)
    df = _budget_ym(df, ym_from_proyectado)
    df["pais"] = _norm_pais(df["pais"])
    df = df[df["ym"].isin(FY_SET)]
    df = _to_numeric(df, [c for c in METRIC_COLS if c in df.columns])
    df = df.groupby(["pais", "partner", "produto", "ym"], as_index=False).agg(
        {c: "sum" for c in METRIC_COLS if c in df.columns}
    )
    rows = []
    for _, row in df.iterrows():
        vals = [round(float(row.get(c, 0) or 0), 4) for c in METRIC_COLS]
        rows.append([row["pais"], row["partner"], row["produto"], row["ym"]] + vals)
    return append_rg_rows(rows, 4, METRIC_COLS)


def _build_b2b_budget_rows(df: pd.DataFrame, lob_filter: str = None,
                           ym_from_proyectado: bool = False) -> list:
    """B2B GD/RI budget/RR/FC → rows [pais, produto, ym, v0..v28, viaje] (full waterfall).
    lob_filter: 'B2B-MAY' or 'B2B-MIN'.
    """
    df = df.copy()
    df.columns = [c.lower().strip() for c in df.columns]
    df = df.rename(columns=_BUDGET_RENAME)
    df = _budget_ym(df, ym_from_proyectado)
    df["pais"] = _norm_pais(df["pais"])
    if lob_filter:
        df = df[df["lob_canal"] == lob_filter]
    df = df[df["ym"].isin(FY_SET)]
    if "produto" not in df.columns:
        df["produto"] = "Total"
    df["viaje"] = _viaje_col(df)
    df = _to_numeric(df, [c for c in METRIC_COLS if c in df.columns])
    df = df.groupby(["pais", "produto", "ym", "viaje"], as_index=False).agg(
        {c: "sum" for c in METRIC_COLS if c in df.columns}
    )
    rows = []
    for _, row in df.iterrows():
        vals = [round(float(row.get(c, 0) or 0), 4) for c in METRIC_COLS]
        rows.append([row["pais"], row["produto"], row["ym"]] + vals + [row["viaje"]])
    return append_rg_rows(rows, 3, METRIC_COLS)


# ==============================================================================
# 4b) SCENARIO STITCHES
# ==============================================================================

# Forecast goal = actuals hasta la base de la ronda de Forecast + la proyección después.
# Mismo corte que Accounting: Inputs_Planning_PnL/config.py FORECAST_ACTUALS_CUTOFF (julio:
# actuals abr-jul, Forecast ago-mar). Antes estaba fijo en junio acá y en julio en Accounting.
FC_ACTUAL_CUTOFF = _planning_cfg.FORECAST_ACTUALS_CUTOFF[:7]   # 'YYYY-MM'


def _stitch_forecast(ac_rows, fcraw_rows, ym_idx):
    """Forecast goal = actuals ≤ corte + forecast projection > corte."""
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
    for ym in FY_MONTHS:
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
    df = df[df["ym"].isin(FY_SET)]
    return df


def _fc_xlsx_b2b2c_rows(df: pd.DataFrame) -> list:
    """WLs model → rows [pais, partner, produto, ym, v0..v28]."""
    for c in METRIC_COLS:
        if c not in df.columns:
            df[c] = 0.0
    df = _to_numeric(df, METRIC_COLS)
    apply_pais_overrides(df)
    df = df.groupby(["pais", "partner", "produto", "ym"], as_index=False).agg(
        {c: "sum" for c in METRIC_COLS}
    )
    rows = []
    for _, row in df.iterrows():
        vals = [round(float(row.get(c, 0) or 0), 4) for c in METRIC_COLS]
        rows.append([row["pais"], row["partner"], row["produto"], row["ym"]] + vals)
    return append_rg_rows(rows, 4, METRIC_COLS)


def _fc_xlsx_b2b_rows(df: pd.DataFrame) -> list:
    """API / HTML model → rows [pais, produto, ym, v0..v28, viaje] (file is already per-channel)."""
    for c in METRIC_COLS:
        if c not in df.columns:
            df[c] = 0.0
    df["viaje"] = _viaje_col(df)
    df = _to_numeric(df, METRIC_COLS)
    df = df.groupby(["pais", "produto", "ym", "viaje"], as_index=False).agg(
        {c: "sum" for c in METRIC_COLS}
    )
    rows = []
    for _, row in df.iterrows():
        vals = [round(float(row.get(c, 0) or 0), 4) for c in METRIC_COLS]
        rows.append([row["pais"], row["produto"], row["ym"]] + vals + [row["viaje"]])
    return append_rg_rows(rows, 3, METRIC_COLS)


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
df_b2b2c_ly = fetch(build_b2b2c_query(LY_FETCH_FROM, LY_TO),    "B2B2C LY")   # + Ene–Mar (PRE_MONTHS y su LY)
# Apertura por tipo de producto (product_type): solo Actuals + LY de meses cerrados y PRE_MONTHS.
df_b2b2c_tp    = fetch(build_b2b2c_query(ACTUALS_FROM, ACTUALS_TO, by_tipo=True), "B2B2C actuals por tipo")
df_b2b2c_tp_ly = fetch(build_b2b2c_query(LY_FETCH_FROM, LY_TO, by_tipo=True),    "B2B2C LY por tipo")
# Split Hunting/Farming de la landing: mismo criterio que el Daily y los OKR (hunting_rules.py).
b2b2c_stage = hunting_rules.stage_map(fetch(hunting_rules.CARTERA_STAGE_QUERY, "Cartera stage"))
print(f"  hunting (New): {sorted(p for p, s in b2b2c_stage.items() if s == 'New')}")

print("\n--- B2B GD ---")
df_b2b_gd    = fetch(build_b2b_gd_query(ACTUALS_FROM, ACTUALS_TO), "B2B GD actuals")
df_b2b_gd_ly = fetch(build_b2b_gd_query(LY_FETCH_FROM, LY_TO),     "B2B GD LY")   # + Ene–Mar (PRE_MONTHS y su LY)

print("\n--- B2B RI ---")
df_b2b_ri = fetch(build_b2b_ri_query(ACTUALS_FROM, ACTUALS_TO), "B2B RI actuals")
# (RI LY not fetched: Last Year is GD-basis only)
df_b2b_ri_pre = fetch(build_b2b_ri_query(PRE_FROM, LY_TO), "B2B RI pre-FY (Ene–Mar)")

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
print(f"  Carpeta: {FC_XLSX_DIR}")
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
rr_min_ri = _build_b2b_budget_rows(df_rr_ri, lob_filter="B2B-MIN")

# B2B2C
ac_b2b2c  = _build_b2b2c_rows(df_b2b2c)                                             # actuals (closed)
ly_b2b2c  = _build_b2b2c_rows(df_b2b2c_ly, filter_set=LY_FULL_SET | PRE_LY_SET, ym_shift_years=1)
bgt_b2b2c = _build_b2b2c_budget_rows(df_b2b2c_budget)                               # budget (full FY)
bl_b2b2c  = _stitch_baseline(ac_b2b2c, rr_b2b2c, fcraw_b2b2c, bgt_b2b2c, ym_idx=3)  # actuals→RR→FC→bgt
fc_b2b2c  = _stitch_forecast(ac_b2b2c, fcraw_b2b2c, ym_idx=3)                       # goal: actuals≤Jun + FC

# B2B MAY (GD + RI basis)
ac_may     = _build_b2b_rows(df_b2b_gd, "anio_gd", "mes_gd", channel_filter="API")
ac_may_ri  = _build_b2b_rows(df_b2b_ri, "anio_ri", "mes_ri", channel_filter="API")
ly_may     = _build_b2b_rows(df_b2b_gd_ly, "anio_gd", "mes_gd", channel_filter="API",
                             filter_set=LY_FULL_SET | PRE_LY_SET, ym_shift_years=1)
bgt_may    = _build_b2b_budget_rows(df_b2b_budget_gd, lob_filter="B2B-MAY")
bgt_may_ri = _build_b2b_budget_rows(df_b2b_budget_ri, lob_filter="B2B-MAY")
bl_may     = _stitch_baseline(ac_may,    rr_may,    fcraw_may,    bgt_may,    ym_idx=2)
bl_may_ri  = _stitch_baseline(ac_may_ri, rr_may_ri, fcraw_may_ri, bgt_may_ri, ym_idx=2)
fc_may     = _stitch_forecast(ac_may,    fcraw_may,    ym_idx=2)
fc_may_ri  = _stitch_forecast(ac_may_ri, fcraw_may_ri, ym_idx=2)

# B2B MIN (GD + RI basis; RI de Agencias afiliadas = recognition_date, no check-in)
ac_min     = _build_b2b_rows(df_b2b_gd, "anio_gd", "mes_gd", channel_filter="Agencias afiliadas")
ac_min_ri  = _build_b2b_rows(df_b2b_ri, "anio_ri", "mes_ri", channel_filter="Agencias afiliadas")
ly_min  = _build_b2b_rows(df_b2b_gd_ly, "anio_gd", "mes_gd", channel_filter="Agencias afiliadas",
                          filter_set=LY_FULL_SET | PRE_LY_SET, ym_shift_years=1)
bgt_min    = _build_b2b_budget_rows(df_b2b_budget_gd, lob_filter="B2B-MIN")
bgt_min_ri = _build_b2b_budget_rows(df_b2b_budget_ri, lob_filter="B2B-MIN")
# El modelo HTML no tiene solapa "P&L RI" → para el forecast del baseline RI se
# reusa la proyección GD (es proyección; no hay variante RI del forecast de MIN).
fcraw_min_ri = fcraw_min
bl_min     = _stitch_baseline(ac_min,    rr_min,    fcraw_min,    bgt_min,    ym_idx=2)
bl_min_ri  = _stitch_baseline(ac_min_ri, rr_min_ri, fcraw_min_ri, bgt_min_ri, ym_idx=2)
fc_min     = _stitch_forecast(ac_min,    fcraw_min,    ym_idx=2)
fc_min_ri  = _stitch_forecast(ac_min_ri, fcraw_min_ri, ym_idx=2)

# Hotels por gateway (filtro de la landing): solo Actuals y LY — Budget/RR/FC no abren por gateway.
# LY es base GD también en RI (igual que `ly`), y solo de los meses cerrados (la landing lo compara
# contra Actuals, no hay proyección por gateway) → JSON más liviano.
LY_CLOSED_SET = {f"{int(ym[:4]) - 1}-{ym[5:]}" for ym in CLOSED_SET}
gw = {}
for _sec, _canal in (("may", "API"), ("min", "Agencias afiliadas")):
    gw[_sec] = {
        "ac_gw":    _build_b2b_rows(df_b2b_gd, "anio_gd", "mes_gd", channel_filter=_canal, by_gateway=True)
                  + _build_b2b_rows(df_b2b_gd_ly, "anio_gd", "mes_gd", channel_filter=_canal,
                                    filter_set=PRE_SET, by_gateway=True),
        "ac_ri_gw": _build_b2b_rows(df_b2b_ri, "anio_ri", "mes_ri", channel_filter=_canal, by_gateway=True)
                  + _build_b2b_rows(df_b2b_ri_pre, "anio_ri", "mes_ri", channel_filter=_canal,
                                    filter_set=PRE_SET, by_gateway=True),
        "ly_gw":    _build_b2b_rows(df_b2b_gd_ly, "anio_gd", "mes_gd", channel_filter=_canal,
                                    filter_set=LY_CLOSED_SET | PRE_LY_SET, ym_shift_years=1, by_gateway=True),
    }

# B2B2C por tipo de producto y por millas (filtros de la landing): igual que gateway, solo Actuals y LY.
# ac_tp/ly_tp abren tipo × millas; ac_mi/ly_mi solo millas (de la query normal: Orders exactas).
tp_b2b2c = {
    "ac_tp": _build_b2b2c_rows(df_b2b2c_tp, by_tipo=True, by_millas=True)
           + _build_b2b2c_rows(df_b2b2c_tp_ly, filter_set=PRE_SET, by_tipo=True, by_millas=True),
    "ly_tp": _build_b2b2c_rows(df_b2b2c_tp_ly, filter_set=LY_CLOSED_SET | PRE_LY_SET,
                               ym_shift_years=1, by_tipo=True, by_millas=True),
    "ac_mi": _build_b2b2c_rows(df_b2b2c, by_millas=True)
           + _build_b2b2c_rows(df_b2b2c_ly, filter_set=PRE_SET, by_millas=True),
    "ly_mi": _build_b2b2c_rows(df_b2b2c_ly, filter_set=LY_CLOSED_SET | PRE_LY_SET,
                               ym_shift_years=1, by_millas=True),
}

# Meses previos al FY (PRE_MONTHS): Actuals al baseline (no a `ac`, ver definición de PRE_MONTHS).
pre = {
    "b2b2c":  _build_b2b2c_rows(df_b2b2c_ly, filter_set=PRE_SET),
    "may":    _build_b2b_rows(df_b2b_gd_ly,  "anio_gd", "mes_gd", channel_filter="API", filter_set=PRE_SET),
    "may_ri": _build_b2b_rows(df_b2b_ri_pre, "anio_ri", "mes_ri", channel_filter="API", filter_set=PRE_SET),
    "min":    _build_b2b_rows(df_b2b_gd_ly,  "anio_gd", "mes_gd", channel_filter="Agencias afiliadas", filter_set=PRE_SET),
    "min_ri": _build_b2b_rows(df_b2b_ri_pre, "anio_ri", "mes_ri", channel_filter="Agencias afiliadas", filter_set=PRE_SET),
}
bl_b2b2c  = pre["b2b2c"]  + bl_b2b2c
bl_may    = pre["may"]    + bl_may
bl_may_ri = pre["may_ri"] + bl_may_ri
bl_min    = pre["min"]    + bl_min
bl_min_ri = pre["min_ri"] + bl_min_ri

actual_months = sorted(CLOSED_SET)
print(f"  actual_months: {actual_months}  (last actual = {LAST_ACTUAL_YM})")
print(f"  b2b2c:   ac={len(ac_b2b2c):,}  rr={len(rr_b2b2c):,}  fc={len(fc_b2b2c):,}  bl={len(bl_b2b2c):,}  bgt={len(bgt_b2b2c):,}  ly={len(ly_b2b2c):,}")
print(f"  b2b_may: ac={len(ac_may):,}  ac_ri={len(ac_may_ri):,}  rr={len(rr_may):,}  fc={len(fc_may):,}  bl={len(bl_may):,}  bl_ri={len(bl_may_ri):,}  bgt={len(bgt_may):,}  bgt_ri={len(bgt_may_ri):,}  ly={len(ly_may):,}")
print(f"  b2b_min: ac={len(ac_min):,}  ac_ri={len(ac_min_ri):,}  rr={len(rr_min):,}  rr_ri={len(rr_min_ri):,}  fc={len(fc_min):,}  fc_ri={len(fc_min_ri):,}  bl={len(bl_min):,}  bl_ri={len(bl_min_ri):,}  bgt={len(bgt_min):,}  bgt_ri={len(bgt_min_ri):,}  ly={len(ly_min):,}")
for _sec in ("may", "min"):
    print(f"  b2b_{_sec} gateway (Hotels): " + "  ".join(f"{k}={len(v):,}" for k, v in gw[_sec].items()))
print("  b2b2c tipo de producto / millas: " + "  ".join(f"{k}={len(v):,}" for k, v in tp_b2b2c.items()))
print(f"  pre-FY {PRE_MONTHS}: " + "  ".join(f"{k}={len(v):,}" for k, v in pre.items()))

# El fetch() vacío ya corta la corrida, pero una query puede volver con FILAS y
# aun así faltarle un mes completo (ej. un join que no matcheó nada para ese
# mes puntual) — eso no lo detecta el guardrail de fetch(). Chequeo liviano,
# no bloqueante (WARN, no aborta): capaz de haber meses legítimamente en cero
# para algún escenario puntual, así que no vale la pena arriesgar un falso
# positivo que corte una corrida buena.
def _check_months_present(rows, ym_idx, label):
    present = {r[ym_idx] for r in rows}
    missing = [m for m in actual_months if m not in present]
    if missing:
        print(f"  [WARN] '{label}' no tiene ninguna fila para {missing} — revisar antes de confiar en la subida.")

_check_months_present(ac_b2b2c, 3, "ac_b2b2c")
_check_months_present(ac_may,   2, "ac_may")
_check_months_present(ac_min,   2, "ac_min")
# ac_tp / ly_tp salen de otra query: GB tiene que cerrar con ac + pre-FY / ly (aviso, no aborta)
def _gb(rows, ym_idx, yms):
    return sum(r[ym_idx + 2] for r in rows if r[ym_idx] in yms)   # gross_bookings = 2da métrica
for _lbl, _tp, _ref, _yms in (
        ("ac_tp", tp_b2b2c["ac_tp"], ac_b2b2c + pre["b2b2c"], CLOSED_SET | PRE_SET),
        ("ly_tp", tp_b2b2c["ly_tp"], ly_b2b2c, {f"{int(y[:4]) + 1}-{y[5:]}" for y in LY_CLOSED_SET | PRE_LY_SET}),
        ("ac_mi", tp_b2b2c["ac_mi"], ac_b2b2c + pre["b2b2c"], CLOSED_SET | PRE_SET),
        ("ly_mi", tp_b2b2c["ly_mi"], ly_b2b2c, {f"{int(y[:4]) + 1}-{y[5:]}" for y in LY_CLOSED_SET | PRE_LY_SET})):
    _a, _b = _gb(_tp, 3, _yms), _gb(_ref, 3, _yms)
    _ok = abs(_a - _b) <= 0.001 * max(abs(_b), 1)
    print(f"  {'OK' if _ok else '[WARN]'} {_lbl}: GB {_a:,.0f} vs {_b:,.0f}" + ("" if _ok else " — no cierra con la query normal"))
# El cierre de arriba no prueba el canje (Con + Sin suman el GB siempre): se controla el GB "Con millas"
# contra el gb_millas que devolvió la query, y se imprime el % por partner para revisarlo a ojo.
def _gb_millas_raw(df, yms):
    d = df.copy(); d.columns = [c.lower() for c in d.columns]
    return pd.to_numeric(d.loc[d["mes"].isin(yms), "gb_millas"], errors="coerce").fillna(0).sum()
_con = sum(r[5] for r in tp_b2b2c["ac_mi"] if r[33] == MILLAS_CON)
_raw = _gb_millas_raw(df_b2b2c, CLOSED_SET) + _gb_millas_raw(df_b2b2c_ly, PRE_SET)
print(f"  {'OK' if abs(_con - _raw) <= 1 else '[WARN]'} GB con millas (ac_mi): {_con:,.0f} vs query {_raw:,.0f}")
_pp = {}
for r in tp_b2b2c["ac_mi"]:
    _pp.setdefault(r[1], [0.0, 0.0])
    _pp[r[1]][0] += r[5]
    if r[33] == MILLAS_CON: _pp[r[1]][1] += r[5]
print("  % GB con millas por partner (top 8): " + ", ".join(
    f"{k} {v[1] / v[0]:.0%}" for k, v in sorted(_pp.items(), key=lambda kv: -kv[1][1])[:8] if v[0]))
for _k, _rows in pre.items():
    _missing = sorted(PRE_SET - {r[3 if _k == "b2b2c" else 2] for r in _rows})
    if _missing:
        print(f"  [WARN] pre-FY '{_k}' no tiene ninguna fila para {_missing}.")

output = {
    "updated_at":    datetime.now().isoformat(timespec="seconds"),
    "actuals_from":  str(ACTUALS_FROM),
    "actuals_to":    str(ACTUALS_TO),
    "actual_months": actual_months,
    "last_actual_ym": LAST_ACTUAL_YM,
    "months":        FY_MONTHS,
    "pre_months":    PRE_MONTHS,    # Ene–Mar previos al FY: solo en bl/bl_ri, ly, *_gw y *_tp (no en ac)
    "metrics":       METRIC_COLS,
    "b2b2c_stage":   b2b2c_stage,   # {partner lowercase: 'New'|'Existing'} — split Hunting/Farming (Codigo.js)
    "b2b2c": {
        "ac": ac_b2b2c, "ly": ly_b2b2c, "bgt": bgt_b2b2c,
        "rr": rr_b2b2c, "fc": fc_b2b2c, "bl": bl_b2b2c,
        **tp_b2b2c,
    },
    "b2b_may": {
        "ac": ac_may, "ac_ri": ac_may_ri, "ly": ly_may,
        "bgt": bgt_may, "bgt_ri": bgt_may_ri,
        "rr": rr_may, "rr_ri": rr_may_ri, "fc": fc_may, "fc_ri": fc_may_ri,
        "bl": bl_may, "bl_ri": bl_may_ri,
        **gw["may"],
    },
    "b2b_min": {
        "ac": ac_min, "ac_ri": ac_min_ri, "ly": ly_min,
        "bgt": bgt_min, "bgt_ri": bgt_min_ri,
        "rr": rr_min, "rr_ri": rr_min_ri, "fc": fc_min, "fc_ri": fc_min_ri,
        "bl": bl_min, "bl_ri": bl_min_ri,
        **gw["min"],
    },
}

json_bytes = json.dumps(output, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
size_kb    = len(json_bytes) / 1024
print(f"\n  JSON: {size_kb:.1f} KB")

print("\n--- Subiendo a Google Drive ---")
upload_to_drive(json_bytes)

print(f"\nOK Completado: {TODAY.strftime('%d-%m-%Y')}")
