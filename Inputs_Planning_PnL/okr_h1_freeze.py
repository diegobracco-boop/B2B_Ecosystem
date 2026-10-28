"""
okr_h1_freeze.py
Congela el OKR H1 FY27 (abril -> septiembre 2026) en un JSON propio: OKR_H1_FY27.json.

H1 es un período cerrado: no se recalcula más. Este script toma las filas de okr.json (el publicado
en Drive hoy, tal cual) con Periodo <= 2026-09-01 — Run Rate/Actuals y Budget de todos los KRs, más los
meses previos que usan los KRs de agencias — y las guarda en Drive como OKR_H1_FY27.json. Desde ahí:
  - okr_builder.py ya no calcula esos meses: los toma de este archivo (okr.json queda igual en H1).
  - el OKR del Hub lee H1 de este archivo (Codigo_OKR.js, OKR_H1_FILE_ID).
Los valores son USD nominales, sin organic (el organic es nuevo de H2 y no aplica al OKR contable).

Uso (una sola vez; falla si el archivo ya existe, para no pisar un H1 ya congelado):
    python okr_h1_freeze.py              # sube a Drive (y a Ownia, doble escritura)
    python okr_h1_freeze.py --dry-run    # solo cuenta filas, no sube nada
    python okr_h1_freeze.py --force      # pisa el archivo existente (solo si hay que corregir el congelado)
Después de crearlo: copiar el fileId que imprime a OKR_H1_FILE_ID en okr_builder.py y Codigo_OKR.js, y sumarlo al
manifest de Ownia (server/drive-manifest.json, módulo hub).
"""
import io
import json
import os
import sys
import argparse
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import config
import pnl_common

OKR_FILE_ID = "1cEidr8aoYgm4S7ugm05Wv-SMnz8GbtUj"   # okr.json (fuente a congelar)
OUTPUT_NAME = "OKR_H1_FY27.json"
H1_END      = "2026-09-01"                          # último Periodo de H1 (inclusive)


def _download(svc, file_id):
    from googleapiclient.http import MediaIoBaseDownload
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, svc.files().get_media(fileId=file_id), chunksize=8 * 1024 * 1024)
    done = False
    while not done:
        _, done = dl.next_chunk()
    return json.loads(buf.getvalue())


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="pisar el OKR_H1_FY27.json existente")
    args = ap.parse_args()

    svc = pnl_common.get_drive_service()
    src = _download(svc, OKR_FILE_ID)
    cols = src["cols"]
    iP = cols.index("Periodo")
    rows = [r for r in src["rows"] if str(r[iP])[:10] <= H1_END]
    periodos = sorted({str(r[iP])[:10] for r in rows})
    print(f"okr.json: {len(src['rows'])} filas -> H1 congelado: {len(rows)} filas, "
          f"{len(periodos)} períodos ({periodos[0]} .. {periodos[-1]})")
    if not rows or periodos[-1] > H1_END:
        sys.exit("ERROR: no hay filas de H1 o hay períodos posteriores a " + H1_END)

    payload = {
        "meta": {
            "concepto": "okr_h1_fy27",
            "descripcion": "OKR H1 FY27 (abr-sep 2026) congelado: Run Rate/Actuals y Budget, USD nominales, sin organic",
            "congelado_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "fuente": "okr.json (file " + OKR_FILE_ID + ")",
            "h1_end": H1_END,
            "filas": len(rows),
        },
        "cols": cols,
        "rows": rows,
    }
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_projections_out", OUTPUT_NAME)
    os.makedirs(os.path.dirname(local), exist_ok=True)
    with open(local, "wb") as f:
        f.write(data)
    print(f"local -> {local} ({len(data) / 1024:.1f} KB)")
    if args.dry_run:
        print("(--dry-run: no se sube nada)")
        return

    from googleapiclient.http import MediaInMemoryUpload
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Ownia_B2B_Ecosystem", "mirror"))
    from ownia_publish import DRIVE_FIELDS, publish_after_drive   # doble escritura Drive + Ownia

    q = f"name='{OUTPUT_NAME}' and '{config.DRIVE_FOLDER_ID}' in parents and trashed=false"
    ex = svc.files().list(q=q, fields="files(id,name)").execute().get("files", [])
    media = MediaInMemoryUpload(data, mimetype="application/json", resumable=False)
    if ex and not args.force:
        sys.exit(f"ERROR: {OUTPUT_NAME} ya existe en Drive (id={ex[0]['id']}): H1 ya está congelado. "
                 "Usar --force solo si hay que corregirlo a propósito.")
    if ex:
        res = svc.files().update(fileId=ex[0]["id"], media_body=media, fields=DRIVE_FIELDS).execute()
        print(f"  [Drive] actualizado {OUTPUT_NAME}: id={res['id']}")
    else:
        res = svc.files().create(body={"name": OUTPUT_NAME, "parents": [config.DRIVE_FOLDER_ID]},
                                 media_body=media, fields=DRIVE_FIELDS).execute()
        print(f"  [Drive] creado {OUTPUT_NAME}: id={res['id']}")
    print(f"\n>>> OKR_H1_FILE_ID = \"{res['id']}\"   (copiarlo a okr_builder.py, Codigo_OKR.js y drive-manifest.json)")
    publish_after_drive(res, data)


if __name__ == "__main__":
    main()
