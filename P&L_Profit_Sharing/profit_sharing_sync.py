# -*- coding: utf-8 -*-
"""
profit_sharing_sync.py
======================
P&L de Profit Sharing de Banco de Chile.

  1. Corre banco_chile_profit_sharing.sql en el Datalake (1 fila por transacción, desde may-2026).
  2. Agrega a mes × tipo_venta × punto_venta × producto × viaje × estado × cuotas × agente.
  3. Sube banco_chile_profit_sharing.json a Drive (misma carpeta que los JSON de P&L Managerial);
     la landing GAS de esta carpeta (Codigo.js + dashboard.html) lo lee por nombre.

La lógica de negocio (NR, FVM_Base, leases, comisiones, split 55/45) vive SOLO en el .sql:
este script no recalcula nada, solo agrega.

Requiere: VPN (Datalake) + credenciales/.env.<usuario de Windows> (igual que daily_sync.py).

Uso:
    py profit_sharing_sync.py              # corre + sube a Drive
    py profit_sharing_sync.py --no-upload  # corre y deja el JSON en _out/
"""
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import os, json, argparse, warnings
from datetime import datetime
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

warnings.filterwarnings("ignore")

# ── CONFIG ────────────────────────────────────────────────────────────────────
BASE            = Path(__file__).resolve().parent
_WIN_USER       = os.environ.get("USERNAME", "").lower()
RUTA_ENV        = BASE.parent / "credenciales" / f".env.{_WIN_USER}"
DSN_NAME        = "DataLake Treasure ODBC"
SQL_FILE        = BASE / "banco_chile_profit_sharing.sql"
DRIVE_FOLDER_ID = "1wzudbo7cN9Ibiv_2OA-V0_B_un4JcJp6"   # misma carpeta que _actuals_gestional.json
JSON_FILE_NAME  = "banco_chile_profit_sharing.json"
DRIVE_SCOPES    = ["https://www.googleapis.com/auth/drive"]

DIMS = ["mes", "tipo_venta", "punto_venta", "productooriginal", "viaje", "estado", "cuotas", "agent_name"]

# Métricas en orden de P&L (nombres = columnas del SELECT final del .sql, en minúscula).
METRICS = [
    "orders", "gross_bookings",
    "up_front_incentives", "fees", "commercial_discounts", "back_end_incentives",
    "media_other_revenue", "cancellations", "breakage_revenue", "revenue_tax", "other_incentives",
    "net_revenues",
    "cost_of_installments", "credit_card_processing", "mkt_usd", "errors",
    "other_transactional_taxes", "customer_claims", "loyalty_usd", "customer_service",
    "channel_expenses", "intercompany_usd", "dif_fx", "currency_hedge", "efecto_financiero",
    "white_labels_api",
    "fvm_base", "profit_share_a_pagar", "fvm",
    "leases", "comisiones_presencial", "comisiones_call_center",
]


# ── DATALAKE ──────────────────────────────────────────────────────────────────
def fetch() -> pd.DataFrame:
    if not RUTA_ENV.exists():
        sys.exit(f"No existe {RUTA_ENV} — crear credenciales/.env.<usuario> (ver CLAUDE.md).")
    # override=True: en Git Bash USER ya existe como variable de entorno y load_dotenv no la pisaría.
    load_dotenv(RUTA_ENV, override=True)
    import pyodbc
    con = pyodbc.connect(
        f"DSN={DSN_NAME};UID={os.getenv('USER')};PWD={os.getenv('PASSWORD')};", autocommit=True
    )
    print("  > query Banco de Chile ...")
    df = pd.read_sql(SQL_FILE.read_text(encoding="utf-8"), con)
    con.close()
    df.columns = [c.lower() for c in df.columns]
    print(f"  OK {len(df):,} filas (transacciones)")
    if df.empty:
        sys.exit("La query devolvió 0 filas — VPN caída o cambio de esquema. NO se sube nada.")
    faltan = [m for m in METRICS if m not in df.columns]
    if faltan:
        sys.exit(f"La query no trae {faltan} — se cambió el SELECT final del .sql. NO se sube nada.")
    return df


def aggregate(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["estado"] = df["product_state"].fillna("Activo")        # current_state sin fila = no cancelado
    df["agent_name"] = df["agent_name"].fillna("")
    # cuotas como texto ("0", "3", "6"…); sin cobro registrado en collections = "Sin dato"
    df["cuotas"] = pd.to_numeric(df["cuotas"], errors="coerce").map(lambda x: "Sin dato" if pd.isna(x) else str(int(x)))
    for c in DIMS:
        df[c] = df[c].fillna("").astype(str)
    # NULL en una métrica (ej. leases de un mes sin ventas Presencial) cuenta como 0
    df[METRICS] = df[METRICS].astype(float).fillna(0.0)
    return df.groupby(DIMS, as_index=False)[METRICS].sum()


# ── DRIVE ─────────────────────────────────────────────────────────────────────
def _get_drive_service():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    creds_file = BASE / "credentials_drive.json"
    token_file = BASE / "token_drive.json"
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

    # Sin credentials_drive.json: credenciales de clasp (~/.clasprc.json)
    from datetime import timezone
    tok = json.loads((Path.home() / ".clasprc.json").read_text())["tokens"]["default"]
    # google-auth compara contra un utcnow() naive: el expiry tiene que ser UTC sin tzinfo
    expiry = datetime.fromtimestamp(tok["expiry_date"] / 1000, tz=timezone.utc).replace(tzinfo=None)
    creds = Credentials(
        token=tok["access_token"], refresh_token=tok["refresh_token"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=tok["client_id"], client_secret=tok["client_secret"],
        expiry=expiry,
    )
    if not creds.valid:
        creds.refresh(Request())
    return build("drive", "v3", credentials=creds)


def upload_to_drive(payload: bytes):
    from googleapiclient.http import MediaInMemoryUpload
    service = _get_drive_service()
    media   = MediaInMemoryUpload(payload, mimetype="application/json", resumable=False)
    existing = service.files().list(
        q=f"name='{JSON_FILE_NAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false",
        fields="files(id,name)",
    ).execute().get("files", [])
    if len(existing) > 1:
        print(f"  [WARN] {len(existing)} archivos '{JSON_FILE_NAME}' en la carpeta — se actualiza "
              f"{existing[0]['id']}; la landing puede leer otro. Dejar uno solo.")
    if existing:
        service.files().update(fileId=existing[0]["id"], media_body=media).execute()
        print(f"  OK Drive: actualizado ({JSON_FILE_NAME})  id={existing[0]['id']}")
    else:
        r = service.files().create(
            body={"name": JSON_FILE_NAME, "parents": [DRIVE_FOLDER_ID]}, media_body=media, fields="id",
        ).execute()
        print(f"  OK Drive: creado ({JSON_FILE_NAME})  id={r['id']}")


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main(upload: bool = True):
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] profit_sharing_sync — Banco de Chile")
    raw = fetch()
    agg = aggregate(raw)

    # Cuadre: lo agregado tiene que sumar lo mismo que la query cruda
    for m in ("gross_bookings", "fvm_base", "profit_share_a_pagar"):
        a, b = float(raw[m].fillna(0).sum()), float(agg[m].sum())
        if abs(a - b) > 1:
            sys.exit(f"Cuadre roto en {m}: crudo {a:,.2f} vs agregado {b:,.2f}. NO se sube nada.")

    months = sorted(agg["mes"].unique())
    rows = [[r[d] for d in DIMS] + [round(float(r[m]), 4) for m in METRICS] for _, r in agg.iterrows()]
    out = {
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "partner":    "Banco de Chile",
        "months":     months,
        "dims":       DIMS,
        "metrics":    METRICS,
        "row_schema": DIMS + METRICS,
        "rows":       rows,
    }
    payload = json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    tot = agg.groupby("mes")[["orders", "gross_bookings", "net_revenues", "fvm_base", "profit_share_a_pagar"]].sum()
    print(f"\n  filas agregadas: {len(rows):,}   meses: {months}   JSON: {len(payload)/1024:.1f} KB")
    print(tot.round(0).to_string())

    outdir = BASE / "_out"
    outdir.mkdir(exist_ok=True)
    (outdir / JSON_FILE_NAME).write_bytes(payload)
    print(f"  local -> _out/{JSON_FILE_NAME}")

    if upload:
        print("\n--- Subiendo a Google Drive ---")
        upload_to_drive(payload)
    else:
        print("  (--no-upload)")
    print("\nOK Completado")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-upload", action="store_true")
    main(not ap.parse_args().no_upload)
