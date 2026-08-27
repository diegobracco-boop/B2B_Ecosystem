"""
okr_builder.py
Genera okr.json combinando tres fuentes:

  1. KRs B2B2C Op.Contribution + B2B NR Core/New Markets (mismo input contable
     que usa la landing P&L_Accounting)
       <- baseline_actuals+projections.json  → "Run Rate/Actuals"
       <- budget.json                        → "Budget"

  2. KRs B2B2C Hunting/Farming (New / Existing Account Net Revenues) — híbrido:
       <- daily_b2b2c_data.json (transaccional, account_type=='New') → Hunting "Run Rate/Actuals"
       <- _pnl_gestional_data.json (bgt, filtrado HUNTING_PARTNERS)  → Hunting "Budget"
       Existing = Total B2B2C NR contable (fuente 1) − Hunting.

  3. KRs manuales (Sign New Partnership, Monthly Buying Agencies, Air Net Revenue
     from suppliers — este último manual hasta definir fuente, 2026-08-25)
       <- GSheet "Input_OKR"  (se conservan tal como están)

Mismo criterio que Dashboard_B2B_WLs/Codigo_OKR.js (computeOKR_), consolidado acá para
que la landing deje de calcular todo en vivo y solo lea este JSON.

Uso:
    python okr_builder.py
    python okr_builder.py --no-upload
"""

import os, sys, io, json, argparse
from collections import defaultdict

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import config
import pnl_common

DIR             = os.path.dirname(os.path.abspath(__file__))
OUTPUT_NAME     = "okr.json"
DRIVE_FOLDER_ID = config.DRIVE_FOLDER_ID

# ── IDs Drive ──────────────────────────────────────────────────────────────────
GESTIONAL_FILE_ID  = "1wvle0UIVZV7ocCSl8OawOfIGVz_It5kh"   # _pnl_gestional_data.json
BASELINE_FILE_ID   = "1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv"   # baseline_actuals+projections.json
BUDGET_FILE_ID     = "1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW"   # budget.json
DAILY_B2B2C_FILE_ID = "1Ukcx4e-dwCZ2VqesWwVN_1Jnt6r2AZdX"  # daily_b2b2c_data.json (transaccional)
OKR_FILE_ID        = "1cEidr8aoYgm4S7ugm05Wv-SMnz8GbtUj"   # okr.json (output)

SHEET_ID    = "1RVmTXDyyugCUXJ0f6JG_croNxWNLlOLm4eAs8F52u2c"
SHEET_RANGE = "Input_OKR"

COLS_OUT = ["Periodo", "Escenario", "LoB", "Pais", "Producto", "KR", "Valor"]

# ── Hunting partners (mismo criterio que P&L Managerial Codigo.js) ─────────────
HUNTING_PARTNERS = {
    "caixa", "csu", "ypf", "cocos", "tuplus", "vibe", "cacau lovers",
    "turismocity", "claro", "livelo-api-hoteles", "invex", "bna",
    "banco de chile", "itau", "tbd", "cutc", "sams", "dotz",
}

# ── Segmentación de mercados B2B (idéntico a Dashboard_B2B_WLs/Codigo_OKR.js) ──
# New Markets = cualquier país que no sea Core ni NON_GEO (no es lista fija:
# así, p.ej., "globales"/"others countries" caen en New, "rg" queda excluido).
CORE_MARKETS    = {"brasil", "mexico", "other countries"}
NON_GEO_MARKETS = {"ops", "rg", "ops + rg"}

# ── Gestional: METRIC_COLS idéntico a actuals_gestional_upload.py ─────────────
_GESTIONAL_METRICS = [
    "orders", "gross_bookings", "up_front_incentives", "fees",
    "commercial_discounts", "income_from_outsourced_services", "cancellations",
    "cost_of_installments", "credit_card_processing", "white_labels_api",
    "other_incentives", "revenue_tax", "back_end_incentives", "breakage_revenue",
    "media_revenue", "errors", "other_transactional_taxes", "customer_claims",
    "customer_service", "affiliates", "intercompany_usd", "operations",
    "vendor_commissions", "frauds", "efecto_financiero", "dif_fx",
    "currency_hedge", "net_revenue", "npv",
]
_NR_IDX = 4 + _GESTIONAL_METRICS.index("net_revenue")   # = 31

# KRs que vienen del GSheet (manuales) — el resto se calcula
# Air Net Revenue from suppliers: manual hasta que el equipo defina de dónde sale
# (2026-08-25). Monthly Buying Agencies: manual hoy, pasa a Metabase cuando se
# defina carpeta/formato del export.
MANUAL_KRS = {
    "Sign New Partnership",
    "Monthly Buying Agencies",
    "Air Net Revenue from suppliers",
}


# ── Drive helpers ──────────────────────────────────────────────────────────────

def _download_json(svc, file_id, label):
    from googleapiclient.http import MediaIoBaseDownload
    buf = io.BytesIO()
    dl  = MediaIoBaseDownload(buf, svc.files().get_media(fileId=file_id),
                              chunksize=8 * 1024 * 1024)
    done = False
    while not done:
        _, done = dl.next_chunk()
    buf.seek(0)
    data = json.load(buf)
    print(f"  [Drive] {label}: OK")
    return data


def _upload(local_path, svc):
    from googleapiclient.http import MediaFileUpload
    media = MediaFileUpload(local_path, mimetype="application/json", resumable=True)
    res = svc.files().update(fileId=OKR_FILE_ID, media_body=media,
                              fields="id,size,modifiedTime").execute()
    print(f"  [Drive] actualizado {OUTPUT_NAME}: id={res['id']}  size={res.get('size','?')}")


# ── Sheets helper ──────────────────────────────────────────────────────────────

def _read_sheet(token_file):
    from googleapiclient.discovery import build
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    tok = json.load(open(token_file))
    creds = Credentials(
        token=tok.get("token"), refresh_token=tok.get("refresh_token"),
        token_uri=tok.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=tok.get("client_id"), client_secret=tok.get("client_secret"),
        scopes=["https://www.googleapis.com/auth/drive",
                "https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    if not creds.valid:
        creds.refresh(Request())
    sheets = build("sheets", "v4", credentials=creds)
    result = sheets.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=SHEET_RANGE
    ).execute()
    return result.get("values", [])


# ── Gestional B2B2C ───────────────────────────────────────────────────────────

def _ym_to_periodo(ym):
    """'2026-04' → '2026-04-01'"""
    return ym + "-01"


def _compute_b2b2c_hunting_farming(gest_json, daily_json, nr_b2b2c_by_scen):
    """
    Devuelve rows OKR para New (Hunting) / Existing (Farming) Account Net Revenues.
    Híbrido, mismo criterio que Dashboard_B2B_WLs/Codigo_OKR.js:
      - Run Rate/Actuals: Hunting = daily_b2b2c_data.json (transaccional, account_type=='New').
      - Budget: Hunting = _pnl_gestional_data.json (bgt), filtrado por HUNTING_PARTNERS.
      - Existing = Total B2B2C NR contable (nr_b2b2c_by_scen) − Hunting, por escenario/mes.
    """
    hunting_act = defaultdict(float)
    for r in daily_json.get("actuals", []):
        if str(r.get("account_type", "")) != "New":
            continue
        ym = str(r.get("fecha", ""))[:7]
        if not ym:
            continue
        hunting_act[_ym_to_periodo(ym)] += float(r.get("net_revenues") or 0)

    hunting_bud = defaultdict(float)
    for row in gest_json.get("b2b2c", {}).get("bgt", []):
        if len(row) <= _NR_IDX:
            continue
        partner = str(row[1] or "").strip().lower()
        if partner not in HUNTING_PARTNERS:
            continue
        ym = str(row[3] or "").strip()
        hunting_bud[_ym_to_periodo(ym)] += float(row[_NR_IDX] or 0)

    HUNTING_BY_SCEN = {"Run Rate/Actuals": hunting_act, "Budget": hunting_bud}

    rows = []
    for scen_label, hunting_by_periodo in HUNTING_BY_SCEN.items():
        total_by_periodo = nr_b2b2c_by_scen.get(scen_label, {})
        for periodo in sorted(set(total_by_periodo) | set(hunting_by_periodo)):
            total = total_by_periodo.get(periodo)
            if total is None:
                continue   # sin total contable ese mes -> no calculamos Existing
            hunting = hunting_by_periodo.get(periodo, 0.0)
            farming = total - hunting
            rows.append([periodo, scen_label, "B2B2C", "Total", "Total",
                         "New Account Net Revenues", round(hunting, 2)])
            rows.append([periodo, scen_label, "B2B2C", "Total", "Total",
                         "Existing Account Net Revenues", round(farming, 2)])

    print(f"  [Hunting/Farming] B2B2C NR: {len(rows)} filas ({len(set(r[0] for r in rows))} meses)")
    return rows


# ── Canonical JSON (baseline / budget) ────────────────────────────────────────

def _compute_from_canonical(canon_data, scen_label):
    """
    Calcula desde un JSON canónico (baseline o budget) — mismo input que usa la
    landing P&L_Accounting:
      - B2B2C Op. Contribution   (N5 = 'operating contribution', lob = b2b2c)
      - B2B NR Core Markets      (N3 = 'net revenue', lob = b2b, pais ∈ CORE)
      - B2B NR New Markets       (N3 = 'net revenue', lob = b2b, pais ∈ NEW)
    Air Net Revenue from suppliers NO se calcula acá: es manual (Input_OKR)
    hasta que el equipo defina la fuente (2026-08-25).
    Devuelve además (no como KR propio) el total B2B2C Net Revenue por mes,
    que usa _compute_b2b2c_hunting_farming para calcular "Existing".
    """
    cols = canon_data["cols"]
    iL   = cols.index("LoB")
    iN3  = cols.index("P&L N3")
    iN5  = cols.index("P&L N5")
    iP   = cols.index("Pais")
    iF   = cols.index("Fecha")
    iM   = cols.index("Monto USD")

    op_cont    = defaultdict(float)   # B2B2C Op.Contribution
    nr_core    = defaultdict(float)   # B2B NR Core Markets
    nr_new     = defaultdict(float)   # B2B NR New Markets
    nr_b2b2c   = defaultdict(float)   # B2B2C NR total (no es KR propio)

    for r in canon_data["rows"]:
        lob   = str(r[iL]).lower()
        n3    = str(r[iN3]).lower()
        n5    = str(r[iN5]).lower()
        pais  = str(r[iP]).lower()
        fecha = r[iF]
        monto = float(r[iM] or 0)

        if lob == "b2b2c" and n5 == "operating contribution":
            op_cont[fecha] += monto

        if lob == "b2b2c" and n3 == "net revenue":
            nr_b2b2c[fecha] += monto

        if lob == "b2b" and n3 == "net revenue":
            if pais in CORE_MARKETS:
                nr_core[fecha] += monto
            elif pais not in NON_GEO_MARKETS:
                nr_new[fecha] += monto

    rows = []
    for fecha in sorted(set(list(op_cont) + list(nr_core) + list(nr_new))):
        if fecha in op_cont:
            rows.append([fecha, scen_label, "B2B2C", "Total", "Total",
                         "Op. Contribution", round(op_cont[fecha], 2)])
        if fecha in nr_core:
            rows.append([fecha, scen_label, "B2B", "Core Markets", "Total",
                         "Net revenues Core Markets", round(nr_core[fecha], 2)])
        if fecha in nr_new:
            rows.append([fecha, scen_label, "B2B", "New Markets", "Total",
                         "Net revenues New Markets", round(nr_new[fecha], 2)])

    print(f"  [Canonical/{scen_label}] {len(rows)} filas ({len(set(r[0] for r in rows))} meses)")
    return rows, nr_b2b2c


# ── GSheet manuales ────────────────────────────────────────────────────────────

def _parse_date_sheet(raw):
    """'1/03/2026' → '2026-03-01'"""
    parts = str(raw).strip().split("/")
    if len(parts) != 3:
        return None
    d, m, y = parts
    try:
        return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
    except ValueError:
        return None


def _parse_valor_sheet(raw):
    s = str(raw).strip()
    if not s:
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
        try:
            return float(s)
        except ValueError:
            return None
    else:
        try:
            return int(s.replace(".", ""))
        except ValueError:
            try:
                return float(s)
            except ValueError:
                return None


def _read_manual_krs(token_file):
    """Lee del GSheet Input_OKR solo los KRs manuales (Sign New Partnership,
    Monthly Buying Agencies, Air Net Revenue from suppliers)."""
    raw_rows = _read_sheet(token_file)
    SKIP = {"periodo", "escenario", "lob", "kr", "", None}
    rows = []
    skipped = 0
    for r in raw_rows:
        if len(r) < 7:
            skipped += 1
            continue
        periodo_raw, escenario, lob, pais, producto, kr, valor_raw = (
            r[0], r[1], r[2], r[3], r[4], r[5], r[6]
        )
        if str(periodo_raw).strip().lower() in SKIP or str(escenario).strip().lower() in SKIP:
            skipped += 1
            continue
        if kr not in MANUAL_KRS:
            continue
        # Solo el total (Pais=Total, Producto=Total) — si alguien agrega detalle
        # por país/producto en la sheet, no lo sumamos para evitar duplicar.
        if str(pais).strip().lower() != "total" or str(producto).strip().lower() != "total":
            skipped += 1
            continue
        periodo = _parse_date_sheet(periodo_raw)
        valor   = _parse_valor_sheet(valor_raw)
        if periodo is None or valor is None:
            skipped += 1
            continue
        rows.append([periodo, escenario, lob, pais, producto, kr, valor])

    print(f"  [GSheet manual] {len(rows)} filas")
    return rows


# ── Build ──────────────────────────────────────────────────────────────────────

def build(upload=True):
    print("=== okr_builder ===")

    svc        = pnl_common.get_drive_service()
    token_file = os.path.join(DIR, "token_drive.json")

    print("\n--- Descargando fuentes de Drive ---")
    gest_json     = _download_json(svc, GESTIONAL_FILE_ID,   "_pnl_gestional_data.json")
    baseline_data = _download_json(svc, BASELINE_FILE_ID,    "baseline_actuals+projections.json")
    budget_data   = _download_json(svc, BUDGET_FILE_ID,      "budget.json")
    daily_json    = _download_json(svc, DAILY_B2B2C_FILE_ID, "daily_b2b2c_data.json")

    print("\n--- Calculando KRs ---")
    rows_baseline, nr_b2b2c_baseline = _compute_from_canonical(baseline_data, "Run Rate/Actuals")
    rows_budget,   nr_b2b2c_budget   = _compute_from_canonical(budget_data,   "Budget")
    rows_hunting  = _compute_b2b2c_hunting_farming(
        gest_json, daily_json,
        {"Run Rate/Actuals": nr_b2b2c_baseline, "Budget": nr_b2b2c_budget},
    )
    rows_manual   = _read_manual_krs(token_file)

    all_rows = rows_baseline + rows_budget + rows_hunting + rows_manual

    # Resumen
    print(f"\n  Total filas: {len(all_rows):,}")
    by_kr = defaultdict(int)
    for r in all_rows:
        by_kr[r[5]] += 1
    for kr, n in sorted(by_kr.items()):
        print(f"    {kr}: {n}")

    payload = {
        "meta": {
            "concepto":   "okr",
            "gestional_file_id":  GESTIONAL_FILE_ID,
            "baseline_file_id":   BASELINE_FILE_ID,
            "budget_file_id":     BUDGET_FILE_ID,
            "daily_b2b2c_file_id": DAILY_B2B2C_FILE_ID,
            "sheet_id":   SHEET_ID,
            "filas":      len(all_rows),
        },
        "cols": COLS_OUT,
        "rows": all_rows,
    }

    outdir = os.path.join(DIR, "_projections_out")
    os.makedirs(outdir, exist_ok=True)
    local = os.path.join(outdir, OUTPUT_NAME)
    with open(local, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n  local -> {local}  ({os.path.getsize(local)/1e3:.1f} KB)")

    if upload:
        _upload(local, svc)
    else:
        print("  (--no-upload)")

    return payload


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-upload", action="store_true")
    a = ap.parse_args()
    build(not a.no_upload)
