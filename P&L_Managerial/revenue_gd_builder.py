"""
revenue_gd_builder.py  —  P&L Managerial

Herramienta APARTE del refresh regular (`actuals_gestional_upload.py`).
Corre la query "revenue por GD" (modelo de revenue B2B: bi_transactional_fact_*
+ b2b_rev_pnl_sales_detail + b2b_b2b2c_revenue_pnl_model, basis gestion_date)
para los meses CERRADOS de FY27, la mapea al vocabulario del P&L gestional
(METRIC_COLS) y sube `revenue_gd.json` a la carpeta de P&L_Managerial en Drive.

Lo consume `Codigo.js` -> `getRevenueGDVsGestional()` para la subsección
"B2B: actuals GD (gestional) vs Revenue por GD" dentro de Managerial vs Accounting.

Uso:  python revenue_gd_builder.py [--no-upload]
Requiere: VPN (Datalake) + `.env` con credenciales ODBC (RUTA_ENV).

────────────────────────────────────────────────────────────────────────────────
MAPEO revenue-GD query  ->  METRIC_COLS  (BORRADOR — revisar con números reales)
────────────────────────────────────────────────────────────────────────────────
  METRIC_COLS (29)                 <- columna de la query        nota
  0  orders                        <- orders
  1  gross_bookings                <- gestion_gb                 = sum(gestion_gb*confirmation_gradient)
  2  up_front_incentives           <- upfront_incentives
  3  fees                          <- fees
  4  commercial_discounts          <- commercial_discounts       (sin negar; la query NO aplica el signo que sí aplica el gestional)
  5  income_from_outsourced_services  <- (no está)               -> 0
  6  cancellations                 <- cancellations              (sin negar)
  7  cost_of_installments          <- cost_of_installments       (sin negar)
  8  credit_card_processing        <- credit_card_processing     (sin negar)
  9  white_labels_api              <- (no está)                  -> 0
  10 other_incentives              <- other_incentives
  11 revenue_tax                   <- revenue_tax
  12 back_end_incentives           <- (no está)                  -> 0
  13 breakage_revenue              <- breakage_revenue
  14 media_revenue                 <- media_revenue
  15 errors                        <- errors
  16 other_transactional_taxes     <- other_transactional_taxes
  17 customer_claims               <- customer_claims
  18 customer_service              <- customer_service
  19 affiliates                    <- affiliates
  20 intercompany_usd              <- (no está)                  -> 0
  21 operations                    <- (no está)                  -> 0
  22 vendor_commissions            <- (no está)                  -> 0   (agency_fee va como métrica extra)
  23 frauds                        <- frauds
  24 efecto_financiero             <- efecto_financiero
  25 dif_fx                        <- dif_fx
  26 currency_hedge                <- hedge
  27 net_revenue                   <- fix_net_revenues           (año-dependiente, la calcula la DB)
  28 npv                           <- fix_fvm                    (año-dependiente, la calcula la DB)

  métricas EXTRA (no están en METRIC_COLS, se guardan igual):
    rev_gb, revenue_margin, agency_fee, bad_debt
────────────────────────────────────────────────────────────────────────────────
"""

import os, sys, json, argparse
from datetime import date, datetime, timedelta, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import pandas as pd
from dotenv import load_dotenv

# ── CONFIG ────────────────────────────────────────────────────────────────────
RUTA_ENV        = r"C:\Users\diego.bracco\Proyectos IA\envs\.env"
DSN_NAME        = "DataLake Treasure ODBC"
DRIVE_FOLDER_ID = "1wzudbo7cN9Ibiv_2OA-V0_B_un4JcJp6"
JSON_FILE_NAME  = "revenue_gd.json"
DRIVE_SCOPES    = ["https://www.googleapis.com/auth/drive"]

TODAY        = date.today()
CURRENT_YM   = TODAY.strftime("%Y-%m")
ACTUALS_FROM = date(2026, 4, 1)                                   # FY27 start
ACTUALS_TO   = date(TODAY.year, TODAY.month, 1) - timedelta(days=1)  # último día del último mes cerrado

FY27_MONTHS = [
    "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
    "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03",
]
CLOSED_SET = {ym for ym in FY27_MONTHS if ym < CURRENT_YM}

# METRIC_COLS: mismo orden que actuals_gestional_upload.py / Codigo.js
METRIC_COLS = [
    "orders", "gross_bookings", "up_front_incentives", "fees", "commercial_discounts",
    "income_from_outsourced_services", "cancellations", "cost_of_installments",
    "credit_card_processing", "white_labels_api", "other_incentives", "revenue_tax",
    "back_end_incentives", "breakage_revenue", "media_revenue", "errors",
    "other_transactional_taxes", "customer_claims", "customer_service",
    "affiliates", "intercompany_usd", "operations", "vendor_commissions",
    "frauds", "efecto_financiero", "dif_fx", "currency_hedge", "net_revenue", "npv",
]
METRICS_EXTRA = ["rev_gb", "revenue_margin", "agency_fee", "bad_debt"]

# columna de la query  ->  nombre METRIC_COLS  (1:1, sin tocar signos)
QUERY_TO_METRIC = {
    "orders": "orders",
    "gestion_gb": "gross_bookings",
    "upfront_incentives": "up_front_incentives",
    "fees": "fees",
    "commercial_discounts": "commercial_discounts",
    "cancellations": "cancellations",
    "cost_of_installments": "cost_of_installments",
    "credit_card_processing": "credit_card_processing",
    "other_incentives": "other_incentives",
    "revenue_tax": "revenue_tax",
    "breakage_revenue": "breakage_revenue",
    "media_revenue": "media_revenue",
    "errors": "errors",
    "other_transactional_taxes": "other_transactional_taxes",
    "customer_claims": "customer_claims",
    "customer_service": "customer_service",
    "affiliates": "affiliates",
    "frauds": "frauds",
    "efecto_financiero": "efecto_financiero",
    "dif_fx": "dif_fx",
    "hedge": "currency_hedge",
    "fix_net_revenues": "net_revenue",
    "fix_fvm": "npv",
}

# original_product de la query  ->  taxonomía de producto del P&L gestional
PROD_MAP = {
    "carrito": "Packages General",
    "hoteles": "Hotels",
    "vuelos": "Flights",
    "dest. serv.": "Dest. Serv.",
    "ona": "ONA",
}

# país de la query  ->  canónico de la vista vsAccounting (_vsaPaisCanon_ de Codigo.js)
PAIS_MAP = {
    "argentina": "Argentina", "brasil": "Brasil", "brazil": "Brasil",
    "mexico": "Mexico", "méxico": "Mexico", "colombia": "Colombia",
    "chile": "Chile", "peru": "Peru", "perú": "Peru", "ecuador": "Ecuador",
    "uruguay": "Otros", "other countries": "Otros", "others countries": "Otros",
}


def _canon_pais(p):
    k = str(p or "").strip().lower()
    return PAIS_MAP.get(k, (k[:1].upper() + k[1:]) if k else "Otros")


def _canon_prod(p):
    return PROD_MAP.get(str(p or "").strip().lower(), str(p or "").strip() or "ONA")


# lob_channel de la query -> canal del P&L gestional (MAY = Mayoristas/API, MIN = Minoristas/Agencias afiliadas)
CANAL_MAP = {"b2b-api": "MAY", "b2b-aff": "MIN"}


def _canon_canal(c):
    return CANAL_MAP.get(str(c or "").strip().lower(), "MAY")


# ── QUERY ─────────────────────────────────────────────────────────────────────
def build_query(fecha_desde: date, fecha_hasta: date) -> str:
    return f"""
with params as (
    select date'{fecha_desde}' as fecha_desde, date'{fecha_hasta}' as fecha_hasta
)
,tx_sales as (
    select  tr.transaction_code, pr.product_id
        ,cast(tr.reservation_date as date) as reservation_date
        ,tr.parent_channel
        ,case when tr.site in ('Argentina','Brasil','Mexico','Colombia','Peru','Chile','Uruguay','Ecuador')
              then tr.site else 'Other Countries' end as pais
        ,case when coalesce(cr.shopping_flow_source,tr.purchase_type) in ('CART','Carrito') then 'Carrito'
              when tr.purchase_type in ('Traslados','Actividades') then 'Dest. Serv.'
              when tr.purchase_type in ('Bundles','Circuito','Autos','Alquileres') then 'ONA'
              when tr.purchase_type in ('Asistencia al viajero','Ancillaries') then 'ONA'
              when tr.purchase_type in ('Carrito','Hoteles','Vuelos') then tr.purchase_type
              else 'ONA' end as original_product
        ,pr.product_type as product
        ,pr.hotel_name
        ,pr.destination_city as destination
        ,pr.trip_type as viaje
        ,pr.is_confirmed_flg
        ,pr.status
        ,total as gb_bruto
    from analytics.bi_transactional_fact_charges cargos
    join analytics.bi_transactional_fact_products pr on cargos.product_id = pr.product_id
    join analytics.bi_transactional_fact_transactions tr on tr.transaction_code = cargos.transaction_code
    left join (
        select cast(id as varchar) as tx_code, max(shopping_flow_source) as shopping_flow_source
        from lake.chewie_reservation
        where cast(date as date) >= date'2025-01-02' and shopping_flow_source = 'CART'
        group by 1
    ) cr on cr.tx_code = cast(tr.transaction_code as varchar)
    where tr.reservation_year_month  >= date('2025-01-01')
      and cargos.reservation_year_month >= date('2024-12-01')
      and pr.reservation_year_month    >= date('2024-12-01')
      and ((tr.reservation_date >= date'2025-01-01' AND tr.reservation_date <= date_add('year',-1,date_add('day',1,current_date)))
           OR tr.reservation_date >= date'2026-01-01')
      and tr.line_of_business in ('B2B')
)
,fact_sales as (
    select
         tx.product_id
        ,tx.transaction_code
        ,fv.gestion_date
        ,case when fv.parent_channel = 'API'              then 'B2B-API'
              when fv.parent_channel = 'Agencias afiliadas' then 'B2B-AFF' end as lob_channel
        ,dev.sub_lob
        ,tx.pais
        ,tx.original_product
        ,tx.product
        ,tx.hotel_name as product_detail
        ,tx.destination
        ,tx.viaje
        ,case when length(fv.partner_id) > 0 then fv.partner_id else fv.channel end as partner_id
        ,count(distinct tx.transaction_code) as orders
        ,sum(fv.gestion_gb * fv.confirmation_gradient) as gestion_gb
        ,sum(tx.gb_bruto) as gb_bruto
        ,sum(coalesce(dev.gb, rev.gb_con_gradiente)) as rev_gb
        ,sum(dev.rm_rev) as rm_rev
        ,sum(coalesce(
            case when dev.sub_lob = 'MAY' and dev.partner_id in ('expedia','AG72472') then dev.commission * 0.25
                 when dev.sub_lob = 'MAY' then 0
                 else dev.commission end, pnl.commission_net_usd)) as upfront_incentives
        ,sum(coalesce(dev.fee, fee_net_usd)) as fees
        ,sum(coalesce(
            case when dev.sub_lob = 'MAY' then 0 else dev.discount end,
            discounts_net_usd)) as commercial_discounts
        ,sum(case when dev.sub_lob = 'MIN' and (dev.country_code <> 'BR' or dev.product = 'Vuelos')
                  then dev.agency_fee else 0 end) as agency_fee
        ,sum(coalesce(dev.oi,(pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd))) as other_incentives
        ,sum(coalesce(dev.breakage, pnl.breakage_revenue_usd)) as breakage_revenue
        ,sum(coalesce(dev.media, pnl.media_revenue_usd)) as media_revenue
        ,sum(coalesce(dev.cancels, pnl.cancellations_usd)) as cancellations
        ,sum(coalesce(dev.revtax, pnl.revenue_taxes_usd)) as revenue_tax
        ,sum(coalesce(dev.affiliates, affiliates_usd)) as affiliates
        ,sum(coalesce((dev.coi + dev.coi_int),(pnl.coi_usd + pnl.coi_interest_usd))) as cost_of_installments
        ,sum(coalesce(dev.ccp, pnl.ccp_usd)) as credit_card_processing
        ,sum(coalesce(dev.service, pnl.customer_service_usd)) as customer_service
        ,sum(coalesce(dev.claims, pnl.customer_claims_usd)) as customer_claims
        ,sum(coalesce(dev.ott, pnl.ott_usd)) as ott
        ,sum(coalesce(dev.frauds, pnl.frauds_usd)) as frauds
        ,sum(coalesce(dev.errors, pnl.errors_usd)) as errors
        ,sum(dev.baddebt) as bad_debt
        ,sum(coalesce(dev.fr, pnl.financial_result_usd)) as efecto_financiero
        ,sum(coalesce(dev.fx, pnl.dif_fx_usd + pnl.dif_fx_air_usd)) as dif_fx
        ,sum(coalesce(dev.hedge,(pnl.currency_hedge_usd + pnl.currency_hedge_air_usd))) as hedge
        ,sum(case when year(fv.gestion_date) = 2025  then rev.fix_net_revenues
                  when year(fv.gestion_date) >= 2026 then dev.nr_rev
                  else pnl.net_revenues_usd end) as fix_net_revenues
        ,sum(dev.nr_rev) as net_revenues
        ,sum(pnl.npv_net_usd) as npv
        ,sum(case when year(fv.gestion_date) = 2025  then rev.fix_fvm
                  when year(fv.gestion_date) >= 2026 then dev.fvm_rev
                  else pnl.npv_net_usd end) as fix_npv
    from tx_sales tx
    left join analytics.bi_sales_fact_sales_recognition fv
           on fv.product_id = tx.product_id and fv.partition_period >= '2024-11'
    left join analytics.bi_pnlop_fact_current_model pnl
           on fv.product_id = pnl.product_id and pnl.date_reservation_year_month >= '2025-01'
    left join lake.b2b_rev_pnl_sales_detail dev
           on dev.product_id = tx.product_id and dev.booking_date >= date'2026-01-01'
    left join lake.b2b_b2b2c_revenue_pnl_model rev
           on rev.product_id = fv.product_id and rev.gestion_date >= date'2025-01-01'
    cross join params
    where fv.gestion_date >= (select fecha_desde from params)
      and fv.gestion_date <  (select fecha_hasta from params)
    group by 1,2,3,4,5,6,7,8,9,10,11,12
)
select
     tx.gestion_date
    ,tx.lob_channel
    ,tx.pais
    ,tx.original_product
    ,tx.viaje
    ,sum(tx.orders)                                                                    as orders
    ,sum(tx.gestion_gb)                                                                as gestion_gb
    ,sum(tx.rev_gb)                                                                    as rev_gb
    ,sum(coalesce(rm_rev,(tx.upfront_incentives + tx.fees + tx.commercial_discounts))) as revenue_margin
    ,sum(tx.upfront_incentives)                                                        as upfront_incentives
    ,sum(tx.fees)                                                                      as fees
    ,sum(tx.commercial_discounts)                                                      as commercial_discounts
    ,sum(tx.agency_fee)                                                                as agency_fee
    ,sum(tx.other_incentives)                                                          as other_incentives
    ,sum(tx.revenue_tax)                                                               as revenue_tax
    ,sum(tx.cancellations)                                                             as cancellations
    ,sum(tx.breakage_revenue)                                                          as breakage_revenue
    ,sum(tx.media_revenue)                                                             as media_revenue
    ,sum(tx.cost_of_installments)                                                      as cost_of_installments
    ,sum(tx.credit_card_processing)                                                    as credit_card_processing
    ,sum(tx.errors)                                                                    as errors
    ,sum(tx.frauds)                                                                    as frauds
    ,sum(tx.bad_debt)                                                                  as bad_debt
    ,sum(tx.ott)                                                                       as other_transactional_taxes
    ,sum(tx.customer_claims)                                                           as customer_claims
    ,sum(tx.customer_service)                                                          as customer_service
    ,sum(tx.affiliates)                                                                as affiliates
    ,sum(tx.efecto_financiero)                                                         as efecto_financiero
    ,sum(tx.dif_fx)                                                                    as dif_fx
    ,sum(tx.hedge)                                                                     as hedge
    ,sum(tx.fix_net_revenues)                                                          as fix_net_revenues
    ,sum(tx.fix_npv)                                                                   as fix_fvm
from fact_sales tx
cross join params
where tx.gestion_date >= (select fecha_desde from params)
  and tx.gestion_date <  (select fecha_hasta from params)
group by 1,2,3,4,5
"""


# ── DRIVE ─────────────────────────────────────────────────────────────────────
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
    expiry = datetime.fromtimestamp(tok["expiry_date"] / 1000, tz=timezone.utc)
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
    if len(existing) > 1:
        print(f"  [WARN] {len(existing)} archivos '{JSON_FILE_NAME}' en la carpeta — se actualiza {existing[0]['id']}; "
              f"la landing puede leer otro. Dejar uno solo.")
    if existing:
        service.files().update(fileId=existing[0]["id"], media_body=media).execute()
        print(f"  OK Drive: actualizado ({JSON_FILE_NAME})  id={existing[0]['id']}")
    else:
        r = service.files().create(
            body={"name": JSON_FILE_NAME, "parents": [DRIVE_FOLDER_ID]},
            media_body=media, fields="id",
        ).execute()
        print(f"  OK Drive: creado ({JSON_FILE_NAME})  id={r['id']}")


# ── BUILD ─────────────────────────────────────────────────────────────────────
def main(upload: bool = True):
    print(f"[{TODAY}] revenue_gd_builder  —  {ACTUALS_FROM} → {ACTUALS_TO}")
    print(f"  meses cerrados FY27: {sorted(CLOSED_SET)}")

    load_dotenv(RUTA_ENV)
    import pyodbc
    con = pyodbc.connect(
        f"DSN={DSN_NAME};UID={os.getenv('USER')};PWD={os.getenv('PASSWORD')};", autocommit=True
    )
    q = build_query(ACTUALS_FROM, date(TODAY.year, TODAY.month, 1))
    print("  > revenue por GD ...")
    df = pd.read_sql(q, con)
    con.close()
    df.columns = [c.lower() for c in df.columns]
    print(f"  OK {len(df):,} filas crudas")
    if df.empty:
        sys.exit("La query devolvió 0 filas — VPN caída o cambio de esquema. NO se sube nada.")

    # ── normalizar ──
    _dt = pd.to_datetime(df["gestion_date"], format="%Y-%m-%d", errors="coerce")
    if _dt.isna().any():
        sys.exit(f"{_dt.isna().sum()} filas con gestion_date no parseable — abortando.")
    df["ym"] = _dt.dt.strftime("%Y-%m")
    df = df[df["ym"].isin(CLOSED_SET)]
    _n_canal_nan = df["lob_channel"].isna().sum()
    if _n_canal_nan:
        print(f"  [WARN] {_n_canal_nan:,} filas con lob_channel NULL (parent_channel != API/AFF) → contadas como MAY")
    df["pais_c"]   = df["pais"].map(_canon_pais)
    df["canal_c"]  = df["lob_channel"].map(_canon_canal)
    df["produto_c"] = df["original_product"].map(_canon_prod)

    all_cols = list(QUERY_TO_METRIC.keys()) + METRICS_EXTRA
    for c in all_cols:
        if c not in df.columns:
            df[c] = 0.0
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)

    g = df.groupby(["pais_c", "canal_c", "produto_c", "ym"], as_index=False)[all_cols].sum()

    zero_metrics = [m for m in METRIC_COLS if m not in QUERY_TO_METRIC.values()]
    rows = []
    for _, r in g.iterrows():
        vals = []
        for m in METRIC_COLS:
            src = next((qc for qc, mm in QUERY_TO_METRIC.items() if mm == m), None)
            vals.append(round(float(r[src]) if src else 0.0, 4))
        vals += [round(float(r[c]), 4) for c in METRICS_EXTRA]
        rows.append([r["pais_c"], r["canal_c"], r["produto_c"], r["ym"]] + vals)

    if not rows:
        sys.exit("0 filas tras filtrar meses cerrados — NO se sube nada.")

    actual_months = sorted({r[3] for r in rows})
    out = {
        "updated_at":    datetime.now().isoformat(timespec="seconds"),
        "actuals_from":  str(ACTUALS_FROM),
        "actuals_to":    str(ACTUALS_TO),
        "actual_months": actual_months,
        "months":        FY27_MONTHS,
        "metrics":       METRIC_COLS,
        "metrics_extra": METRICS_EXTRA,
        "zero_metrics":  zero_metrics,   # métricas sin fuente en la query (siempre 0)
        "row_schema":    ["pais", "canal", "produto", "ym"] + METRIC_COLS + METRICS_EXTRA,
        "rows":          rows,           # [pais_canon, canal(MAY|MIN), produto_gest, ym, ...29 METRIC_COLS, ...4 extra]
    }
    payload = json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    print(f"\n  filas agregadas: {len(rows):,}  (pais x canal x producto x mes)   meses: {actual_months}")
    print(f"  canales: {sorted({r[1] for r in rows})}   países: {sorted({r[0] for r in rows})}")
    print(f"  métricas sin fuente (0): {zero_metrics}")
    print(f"  JSON: {len(payload)/1024:.1f} KB")

    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_gestional_out")
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, JSON_FILE_NAME), "wb") as f:
        f.write(payload)
    print(f"  local -> _gestional_out/{JSON_FILE_NAME}")

    if upload:
        print("\n--- Subiendo a Google Drive ---")
        upload_to_drive(payload)
    else:
        print("  (--no-upload)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-upload", action="store_true")
    a = ap.parse_args()
    main(not a.no_upload)
