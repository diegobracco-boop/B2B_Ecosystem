# -*- coding: utf-8 -*-
"""
overs_sync.py
=============
Overs (sobrecomision) de Media Sales para la tabla "Marketing & Media Investment" del P&L Dashboard (B2B).

Corre contra el Datalake la copia del modelo Metabase 94359 (overs_media_sales.sql) con el filtro y la suma de la card 115835
"Historico + Forecast || Negociaciones Media Sales - Variable: Overs" (flg_overcomission = 1; media_real y media_forecast por
anio_mes_negociado y tipo de negociacion) y sube overs_media_sales.json a la carpeta de Drive del Daily (lo lee getOversData_()
en Dashboard_B2B_WLs/Codigo.js). daily_sync.py lo llama en cada corrida; este script sirve para actualizar SOLO este dato a mano:

    python overs_sync.py              # query + sube a Drive
    python overs_sync.py --no-upload  # solo query (muestra el resumen)

Credenciales: Datalake en credenciales/.env.<usuario> (USER / PASSWORD), igual que daily_sync.py.
Drive: igual que recurrencia_sync.py (credentials_drive.json + token_drive.json, o el token de clasp).
"""
import io
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

BASE            = Path(__file__).resolve().parent
SQL_PATH        = BASE / "overs_media_sales.sql"
DRIVE_FOLDER_ID = "1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh"   # misma carpeta que los JSON del Daily
OVERS_FILE_NAME = "overs_media_sales.json"
DESDE           = "2025-04"   # FY26 (el Last Year de la tabla) en adelante; la card muestra desde 2024
COLS            = ["ym", "tipo", "real", "forecast", "hoteles"]


def build_overs(fetch) -> dict:
    """fetch(query, label) -> DataFrame (el de daily_sync.py o uno equivalente). Devuelve el payload del JSON.

    Misma cuenta que la card: SUM(media_real), SUM(media_forecast) y COUNT(DISTINCT id_proveedor) de las filas con
    flg_overcomission = 1, por anio_mes_negociado y tipo_negociacion. USD (media_real / media_forecast de la tabla)."""
    base = SQL_PATH.read_text(encoding="utf-8").strip().rstrip(";")
    query = (
        "SELECT anio_mes_negociado AS ym, tipo_negociacion AS tipo, "
        "SUM(media_real) AS real, SUM(media_forecast) AS forecast, COUNT(DISTINCT id_proveedor) AS hoteles "
        f"FROM (\n{base}\n) overs_base "
        f"WHERE flg_overcomission = 1 AND anio_mes_negociado >= '{DESDE}' "
        "GROUP BY anio_mes_negociado, tipo_negociacion ORDER BY 1, 2"
    )
    df = fetch(query, "Overs Media Sales (card 115835)")
    df = df[COLS].copy()
    df["ym"] = df["ym"].astype(str).str[:7]
    df["tipo"] = df["tipo"].fillna("Sin dato").astype(str)
    for c in ("real", "forecast"):
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).round(2)
    df["hoteles"] = pd.to_numeric(df["hoteles"], errors="coerce").fillna(0).astype(int)
    df = df[df["ym"] >= DESDE]
    if df.empty:
        raise RuntimeError(f"la query no devolvio filas desde {DESDE}")
    return {
        "meta": {"generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                 "fuente": "copia del modelo Metabase 94359 con el filtro de la card 115835 (overs_media_sales.sql)",
                 "moneda": "USD"},
        "cols": list(df.columns),
        "rows": df.values.tolist(),
    }


def upload(payload: dict, service=None) -> None:
    from googleapiclient.http import MediaIoBaseUpload
    from recurrencia_sync import drive_service
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Ownia_B2B_Ecosystem" / "mirror"))
    from ownia_publish import DRIVE_FIELDS, publish_after_drive   # doble escritura Drive + Ownia

    service = service or drive_service()
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    media = MediaIoBaseUpload(io.BytesIO(body), mimetype="application/json", resumable=False)
    found = service.files().list(
        q=f"name='{OVERS_FILE_NAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false",
        fields="files(id)").execute().get("files", [])
    if found:
        res = service.files().update(fileId=found[0]["id"], media_body=media, fields=DRIVE_FIELDS).execute()
        print(f"  OK Drive: actualizado {OVERS_FILE_NAME}")
    else:
        res = service.files().create(body={"name": OVERS_FILE_NAME, "parents": [DRIVE_FOLDER_ID]},
                                     media_body=media, fields=DRIVE_FIELDS).execute()
        print(f"  OK Drive: creado {OVERS_FILE_NAME}")
    publish_after_drive(res, body)


if __name__ == "__main__":
    from recurrencia_sync import _fetch_standalone
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    p = build_overs(_fetch_standalone)
    df = pd.DataFrame(p["rows"], columns=p["cols"])
    print(f"  OK: {len(df):,} filas ({df['ym'].min()} -> {df['ym'].max()})")
    print(df.to_string(index=False))
    if "--no-upload" not in sys.argv:
        upload(p)
