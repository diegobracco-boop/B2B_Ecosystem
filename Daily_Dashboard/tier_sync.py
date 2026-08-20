# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
"""
tier_sync.py
============
Script standalone e independiente de daily_sync.py.
Trae el mapeo partner -> tier (estatus_tier) desde el Datalake y lo sube
a Drive como partner_tiers.json, para que el Flow Semanal del Daily
Dashboard pueda filtrar/agrupar partners por tier.

No modifica ni depende de daily_sync.py ni del JSON principal
(daily_b2b2c_data.json). Se corre manualmente cuando haga falta refrescar
la clasificación de tiers.

Run manual: python tier_sync.py
"""

import os
import json
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv

# ==============================================================================
# 1) CONFIGURACIÓN
# ==============================================================================

_win_user = os.environ.get("USERNAME", "").lower()
RUTA_ENV  = Path(__file__).resolve().parent.parent / "credenciales" / f".env.{_win_user}"
DSN_NAME  = "DataLake Treasure ODBC"

DRIVE_FOLDER_ID = "1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh"
TIER_JSON_FILE_NAME = "partner_tiers.json"

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
# 2) QUERY
# ==============================================================================

TIER_QUERY = """
SELECT partner_homologado_2 AS partner, MAX(estatus_tier) AS tier
FROM raw.comdev_cartera_b2b2c_historic
WHERE partner_homologado_2 IS NOT NULL AND LOWER(is_current) = 'true'
GROUP BY partner_homologado_2
"""

print("--- Cartera: partner -> tier ---")
conn = conectar()
cur  = conn.cursor()
cur.execute(TIER_QUERY)
rows = [[str(r[0]), r[1] if r[1] is not None else "Sin clasificar"] for r in cur.fetchall()]
cur.close()
conn.close()
print(f"  {len(rows):,} partners")

payload = {
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    "rows": rows,
}
payload_bytes = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
print(f"  JSON: {len(payload_bytes)} bytes")

# ==============================================================================
# 3) SUBIR A GOOGLE DRIVE (mismo esquema de credenciales que daily_sync.py,
#    duplicado a propósito para que este script sea independiente)
# ==============================================================================

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]


def _get_drive_service():
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
    tok = json.loads(clasprc.read_text())["tokens"]["default"]

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
upload_to_drive(payload_bytes, TIER_JSON_FILE_NAME)

print(f"\nOK Completado: {datetime.now().strftime('%d-%m-%Y %H:%M')}")
