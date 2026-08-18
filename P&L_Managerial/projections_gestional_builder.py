"""
projections_gestional_builder.py
Genera pnl_gestional_projections_review.json:

  - actuals: tomados del _pnl_gestional_data.json de Drive (meses cerrados)
  - proyecciones: XLSX del WIP folder (solapa "P&L" / "P&L RI")

Mapping XLSX → sección gestional:
  WLs  "P&L"    → b2b2c   bl
  API  "P&L"    → b2b_may bl
  API  "P&L RI" → b2b_may bl_ri
  HTML "P&L"    → b2b_min bl

Todos los demás escenarios (ac, ly, bgt, fc, rr, etc.) se copian sin cambios
del gestional original.

Uso:
    python projections_gestional_builder.py --wip-folder "ruta\\W33"
    python projections_gestional_builder.py --wip-folder "..." --no-upload
"""

import sys, io, os, json, argparse
from datetime import date, timedelta
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import pandas as pd

DIR = Path(__file__).resolve().parent

GESTIONAL_FILE_ID = "1wvle0UIVZV7ocCSl8OawOfIGVz_It5kh"   # _pnl_gestional_data.json
OUTPUT_NAME       = "pnl_gestional_projections_review.json"
DRIVE_FOLDER_ID   = "1wzudbo7cN9Ibiv_2OA-V0_B_un4JcJp6"   # mismo folder que el gestional
DRIVE_SCOPES      = ["https://www.googleapis.com/auth/drive"]

METRIC_COLS = [
    "orders", "gross_bookings", "up_front_incentives", "fees", "commercial_discounts",
    "income_from_outsourced_services", "cancellations", "cost_of_installments",
    "credit_card_processing", "white_labels_api", "other_incentives", "revenue_tax",
    "back_end_incentives", "breakage_revenue", "media_revenue", "errors",
    "other_transactional_taxes", "customer_claims", "customer_service",
    "affiliates", "intercompany_usd", "operations", "vendor_commissions",
    "frauds", "efecto_financiero", "dif_fx", "currency_hedge", "net_revenue", "npv",
]

FY27_MONTHS = [
    "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
    "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03",
]

_XLSX_RENAME = {
    "intercompany":        "intercompany_usd",
    "curency_hedge":       "currency_hedge",
    "media_other_revenue": "media_revenue",
    "producto":            "produto",
}


# ── helpers de XLSX ────────────────────────────────────────────────────────────

def _proy_ym(m) -> str:
    """Mes calendario (1-12) → FY27 YYYY-MM. Abr-Dic → 2026, Ene-Mar → 2027."""
    mm = int(float(m))
    y = 2026 if mm >= 4 else 2027
    return f"{y}-{mm:02d}"


def _norm_pais(series: pd.Series) -> pd.Series:
    return series.replace({"Other Countries": "Globales"})


def _to_numeric(df: pd.DataFrame, cols) -> pd.DataFrame:
    for c in cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
    return df


def _read_pnl_xlsx(wip_folder: str, fname: str, sheet: str, month_col: str) -> pd.DataFrame:
    path = os.path.join(wip_folder, fname)
    df = pd.read_excel(path, sheet_name=sheet, dtype=str)
    df.columns = [c.strip().lower() for c in df.columns]
    df = df.rename(columns=_XLSX_RENAME)
    df["pais"] = _norm_pais(df["pais"])
    df["_m"] = pd.to_numeric(df[month_col], errors="coerce")
    df = df.dropna(subset=["_m"])
    df["ym"] = df["_m"].apply(_proy_ym)
    df = df[df["ym"].isin(set(FY27_MONTHS))]
    return df


def _b2b2c_rows(df: pd.DataFrame) -> list:
    """WLs → rows [pais, partner, produto, ym, v0..v28]."""
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


def _b2b_rows(df: pd.DataFrame) -> list:
    """API/HTML → rows [pais, produto, ym, v0..v28]."""
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


# ── Drive helpers ──────────────────────────────────────────────────────────────

def _get_drive_service():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    # Credenciales compartidas con Inputs_Planning_PnL
    creds_dir  = DIR.parent / "Inputs_Planning_PnL"
    token_file = creds_dir / "token_drive.json"
    creds_file = creds_dir / "credentials_drive.json"

    creds = None
    if token_file.exists():
        creds = Credentials.from_authorized_user_file(str(token_file), DRIVE_SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            from google_auth_oauthlib.flow import InstalledAppFlow
            flow  = InstalledAppFlow.from_client_secrets_file(str(creds_file), DRIVE_SCOPES)
            creds = flow.run_local_server(port=0)
        token_file.write_text(creds.to_json())
    return build("drive", "v3", credentials=creds)


def _download_gestional(svc) -> dict:
    import io as _io
    from googleapiclient.http import MediaIoBaseDownload
    buf = _io.BytesIO()
    dl  = MediaIoBaseDownload(buf, svc.files().get_media(fileId=GESTIONAL_FILE_ID),
                              chunksize=8 * 1024 * 1024)
    done = False
    while not done:
        _, done = dl.next_chunk()
    buf.seek(0)
    data = json.load(buf)
    print(f"  [Drive] _pnl_gestional_data.json descargado OK")
    return data


def _upload_vr(local_path: str, svc):
    from googleapiclient.http import MediaFileUpload
    # Buscar si ya existe el archivo en el folder
    res = svc.files().list(
        q=f"name='{OUTPUT_NAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false",
        fields="files(id,name)"
    ).execute()
    files = res.get("files", [])
    media = MediaFileUpload(local_path, mimetype="application/json", resumable=True)
    if files:
        fid = files[0]["id"]
        result = svc.files().update(fileId=fid, media_body=media,
                                    fields="id,size,modifiedTime").execute()
        print(f"  [Drive] actualizado {OUTPUT_NAME}: id={fid}  size={result.get('size','?')}")
    else:
        result = svc.files().create(
            body={"name": OUTPUT_NAME, "parents": [DRIVE_FOLDER_ID]},
            media_body=media, fields="id,size"
        ).execute()
        print(f"  [Drive] creado {OUTPUT_NAME}: id={result['id']}  size={result.get('size','?')}")
    return result


# ── stitch ─────────────────────────────────────────────────────────────────────

def _stitch_vr(existing_bl: list, xlsx_rows: list, actual_months: set, ym_idx: int) -> list:
    """
    Combina actuals del bl existente (meses cerrados) + rows del XLSX (solo meses de proyección).
    Los meses de proyección del bl existente se descartan.
    """
    out = [r for r in existing_bl if r[ym_idx] in actual_months]
    out.extend([r for r in xlsx_rows if r[ym_idx] not in actual_months])
    return out


# ── main ───────────────────────────────────────────────────────────────────────

def build(wip_folder: str, upload: bool = True):
    print("=== projections_gestional_builder ===")
    print(f"  WIP folder: {wip_folder}")

    svc      = _get_drive_service()
    gestional = _download_gestional(svc)

    actual_months = set(gestional.get("actual_months", []))
    print(f"  actual_months: {sorted(actual_months)}")

    print("\n--- Leyendo modelos XLSX (solapa P&L) ---")
    df_wls     = _read_pnl_xlsx(wip_folder, "WLs - Modelo Forecast.xlsx",  "P&L",    "mes_proyectado")
    df_api     = _read_pnl_xlsx(wip_folder, "API - Modelo Forecast.xlsx",  "P&L",    "mes_proyectado")
    df_html    = _read_pnl_xlsx(wip_folder, "HTML - Modelo Forecast.xlsx", "P&L",    "mes_proyectado")
    df_api_ri  = _read_pnl_xlsx(wip_folder, "API - Modelo Forecast.xlsx",  "P&L RI", "mes ri")

    rows_b2b2c   = _b2b2c_rows(df_wls)
    rows_may     = _b2b_rows(df_api)
    rows_may_ri  = _b2b_rows(df_api_ri)
    rows_min     = _b2b_rows(df_html)

    print(f"  WLs (b2b2c): {len(rows_b2b2c)}  API GD: {len(rows_may)}  API RI: {len(rows_may_ri)}  HTML: {len(rows_min)}")

    print("\n--- Armando VR baseline ---")
    b2b2c   = gestional.get("b2b2c",   {})
    b2b_may = gestional.get("b2b_may", {})
    b2b_min = gestional.get("b2b_min", {})

    vr_bl_b2b2c  = _stitch_vr(b2b2c.get("bl",    []), rows_b2b2c,  actual_months, ym_idx=3)
    vr_bl_may    = _stitch_vr(b2b_may.get("bl",   []), rows_may,    actual_months, ym_idx=2)
    vr_bl_may_ri = _stitch_vr(b2b_may.get("bl_ri",[]), rows_may_ri, actual_months, ym_idx=2)
    vr_bl_min    = _stitch_vr(b2b_min.get("bl",   []), rows_min,    actual_months, ym_idx=2)

    print(f"  b2b2c  bl: {len(vr_bl_b2b2c):,}")
    print(f"  b2b_may bl: {len(vr_bl_may):,}  bl_ri: {len(vr_bl_may_ri):,}")
    print(f"  b2b_min bl: {len(vr_bl_min):,}")

    # Construir JSON de salida: misma estructura, solo bl/bl_ri reemplazados
    vr_b2b2c   = {**b2b2c,   "bl": vr_bl_b2b2c}
    vr_b2b_may = {**b2b_may, "bl": vr_bl_may, "bl_ri": vr_bl_may_ri}
    vr_b2b_min = {**b2b_min, "bl": vr_bl_min}

    from datetime import datetime
    output = {
        **{k: v for k, v in gestional.items()
           if k not in ("b2b2c", "b2b_may", "b2b_min", "updated_at")},
        "updated_at":    datetime.now().isoformat(timespec="seconds"),
        "wip_folder":    os.path.basename(wip_folder),
        "b2b2c":   vr_b2b2c,
        "b2b_may": vr_b2b_may,
        "b2b_min": vr_b2b_min,
    }

    out_dir  = DIR / "_gestional_out"
    out_dir.mkdir(exist_ok=True)
    local    = out_dir / OUTPUT_NAME
    with open(local, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))
    size_kb = local.stat().st_size / 1e3
    print(f"\n  local -> {local}  ({size_kb:.1f} KB)")

    if upload:
        _upload_vr(str(local), svc)
    else:
        print("  (--no-upload)")

    return output


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--wip-folder", required=True,
                    help="Carpeta con los XLSX de modelos (ej. '.../2026.08.18 - W33')")
    ap.add_argument("--no-upload", action="store_true")
    a = ap.parse_args()
    build(a.wip_folder, not a.no_upload)
