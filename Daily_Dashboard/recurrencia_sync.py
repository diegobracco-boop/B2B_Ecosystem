# -*- coding: utf-8 -*-
"""
recurrencia_sync.py
===================
Accelerate Recurrence (KR H2 B2B, solo canal HTML) para "Status KRs H2" del Daily B2B Tracker.

Corre contra el Datalake la copia del SQL de la card Metabase 171400 (recurrencia_alta_frecuencia.sql)
y sube recurrencia_b2b.json a la carpeta de Drive del Daily (la lee getRawRecurrencia() en Codigo.js).
daily_sync.py lo llama en cada corrida; este script sirve para actualizar SOLO este dato a mano:

    python recurrencia_sync.py              # query + sube a Drive
    python recurrencia_sync.py --no-upload  # solo query (muestra el resumen)

Credenciales: Datalake en credenciales/.env.<usuario> (USER / PASSWORD), igual que daily_sync.py.
Drive: credentials_drive.json + token_drive.json si existen; si no, el token de clasp (~/.clasprc.json,
scope drive.file: puede crear el archivo y actualizar el que creó, no uno creado por otra persona).
"""
import io
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

BASE             = Path(__file__).resolve().parent
SQL_PATH         = BASE / "recurrencia_alta_frecuencia.sql"
DRIVE_FOLDER_ID  = "1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh"   # misma carpeta que los JSON del Daily
RECUR_FILE_NAME  = "recurrencia_b2b.json"
DESDE            = "2026-10"   # H2 FY27 en adelante (lo que muestra el Tracker)
TXT_COLS         = ["mes_comercial", "semana_desde", "semana_hasta", "fecha_foto", "estado", "pais"]
INT_COLS         = ["semana_del_mes", "semanas_del_mes", "es_cierre_mes", "mtd_frecuentes_vivas", "roll_frecuentes_vivas"]


def build_recurrencia(fetch) -> dict:
    """fetch(query, label) -> DataFrame (el de daily_sync.py o uno equivalente). Devuelve el payload del JSON."""
    df = fetch(SQL_PATH.read_text(encoding="utf-8").strip().rstrip(";"), "Alta frecuencia semanal (card 171400)")
    df = df[TXT_COLS + INT_COLS].copy()
    for c in TXT_COLS:
        df[c] = df[c].fillna("").astype(str)
    df["mes_comercial"] = df["mes_comercial"].str[:7]
    for c in INT_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).astype(int)
    df = df[df["mes_comercial"] >= DESDE]
    if df.empty:
        raise RuntimeError(f"la query no devolvio filas desde {DESDE}")
    return {
        "meta": {"generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                 "fuente": "copia de la card Metabase 171400 (recurrencia_alta_frecuencia.sql)"},
        "cols": list(df.columns),
        "rows": df.values.tolist(),
    }


def drive_service():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    creds_file, token_file = BASE / "credentials_drive.json", BASE / "token_drive.json"
    if creds_file.exists():
        from google_auth_oauthlib.flow import InstalledAppFlow
        scopes = ["https://www.googleapis.com/auth/drive"]
        creds = Credentials.from_authorized_user_file(str(token_file), scopes) if token_file.exists() else None
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                creds = InstalledAppFlow.from_client_secrets_file(str(creds_file), scopes).run_local_server(port=0)
            token_file.write_text(creds.to_json())
        return build("drive", "v3", credentials=creds)

    tok = json.loads((Path.home() / ".clasprc.json").read_text())["tokens"]["default"]
    creds = Credentials(token=tok["access_token"], refresh_token=tok["refresh_token"],
                        token_uri="https://oauth2.googleapis.com/token",
                        client_id=tok["client_id"], client_secret=tok["client_secret"])
    creds.refresh(Request())
    return build("drive", "v3", credentials=creds)


def upload(payload: dict, service=None) -> None:
    from googleapiclient.http import MediaIoBaseUpload
    import sys as _sys
    from pathlib import Path as _Path
    _sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "Ownia_B2B_Ecosystem" / "mirror"))
    from ownia_publish import DRIVE_FIELDS, publish_after_drive   # doble escritura Drive + Ownia

    service = service or drive_service()
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    media = MediaIoBaseUpload(io.BytesIO(body), mimetype="application/json", resumable=False)
    found = service.files().list(
        q=f"name='{RECUR_FILE_NAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false",
        fields="files(id)").execute().get("files", [])
    if found:
        res = service.files().update(fileId=found[0]["id"], media_body=media, fields=DRIVE_FIELDS).execute()
        print(f"  OK Drive: actualizado {RECUR_FILE_NAME}")
    else:
        res = service.files().create(body={"name": RECUR_FILE_NAME, "parents": [DRIVE_FOLDER_ID]},
                                     media_body=media, fields=DRIVE_FIELDS).execute()
        print(f"  OK Drive: creado {RECUR_FILE_NAME}")
    publish_after_drive(res, body)


def _fetch_standalone(query: str, label: str) -> pd.DataFrame:
    import warnings
    import pyodbc
    from dotenv import load_dotenv

    load_dotenv(BASE.parent / "credenciales" / f".env.{os.environ.get('USERNAME', '').lower()}")
    if not os.getenv("PASSWORD"):
        raise SystemExit("Falta PASSWORD en credenciales/.env.<usuario>")
    print(f"  > {label} ...")
    con = pyodbc.connect(f"DSN=DataLake Treasure ODBC;UID={os.getenv('USER')};PWD={os.getenv('PASSWORD')};",
                         autocommit=True)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return pd.read_sql(query, con)
    finally:
        con.close()


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    p = build_recurrencia(_fetch_standalone)
    df = pd.DataFrame(p["rows"], columns=p["cols"])
    print(f"  OK: {len(df):,} filas ({df['mes_comercial'].min()} -> {df['mes_comercial'].max()})")
    print(df.groupby(["mes_comercial", "semana_del_mes", "estado"])[["mtd_frecuentes_vivas", "roll_frecuentes_vivas"]].sum().to_string())
    if "--no-upload" not in sys.argv:
        upload(p)
