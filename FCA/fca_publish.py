"""
fca_publish.py — publica a la app el FCA revisado de un mes (2026-10-30).

Toma FCA/_out/fca_<mes>.json (lo escribe el agente fca-specialist y lo revisa el usuario) y lo guarda en fca.json de Drive
(un solo archivo, una clave por mes: {"months": {"2026-10": {...}}}) con doble escritura a Ownia (ownia_publish). La pestaña
"FCA" de Presentaciones (Flow_B2B/flow.html, ?fca=1) lo lee con getFca() de Flow_B2B/Codigo.js. Lo que se acuerda en la mesa
(acción, responsable, fecha) se carga en la app y vive en las notas (/notes/flow/fca-<mes>), no acá: republicar no lo pisa.

Uso:
    python FCA/fca_publish.py 2026-10            # publica el mes
    python FCA/fca_publish.py --crear            # una sola vez: crea fca.json en Drive y muestra su id
"""
import io
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "Inputs_Planning_PnL"))
sys.path.insert(0, str(ROOT / "Ownia_B2B_Ecosystem" / "mirror"))
import pnl_common                                   # noqa: E402

FCA_FILE_ID = "1OT3RdA2Llcf21fdcvRKoMdcMTZvOJB1E"                     # fca.json (Drive). Mismo id en Flow_B2B/Codigo.js y drive-manifest.json
OKR_H2_ID = "1lsMF9_d1t55boO8Wr8vziMsFT9LQioov"     # fca.json va en la misma carpeta que OKR_H2_FY27.json


def _download(svc, fid):
    from googleapiclient.http import MediaIoBaseDownload
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, svc.files().get_media(fileId=fid))
    done = False
    while not done:
        _, done = dl.next_chunk()
    return json.loads(buf.getvalue() or b"{}")


def crear():
    from googleapiclient.http import MediaInMemoryUpload
    svc = pnl_common.get_drive_service()
    parent = svc.files().get(fileId=OKR_H2_ID, fields="parents", supportsAllDrives=True).execute()["parents"][0]
    body = json.dumps({"meta": {"concepto": "fca", "creado": datetime.now().isoformat(timespec="seconds")}, "months": {}}).encode()
    f = svc.files().create(body={"name": "fca.json", "parents": [parent]}, media_body=MediaInMemoryUpload(body, mimetype="application/json"),
                           fields="id", supportsAllDrives=True).execute()
    print("fca.json creado:", f["id"])


def publish(mes):
    from googleapiclient.http import MediaInMemoryUpload
    from ownia_publish import DRIVE_FIELDS, publish_after_drive
    src = Path(__file__).resolve().parent / "_out" / f"fca_{mes}.json"
    if not src.exists():
        sys.exit(f"No está {src}: corré primero el agente fca-specialist para {mes}")
    data = json.loads(src.read_text(encoding="utf-8"))
    if not data.get("items"):
        sys.exit("El borrador no tiene items")
    svc = pnl_common.get_drive_service()
    cur = _download(svc, FCA_FILE_ID)
    cur.setdefault("months", {})[mes] = dict(data, publicado=datetime.now().isoformat(timespec="seconds"))
    cur.setdefault("meta", {})["actualizado"] = datetime.now().isoformat(timespec="seconds")
    txt = json.dumps(cur, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    res = svc.files().update(fileId=FCA_FILE_ID, media_body=MediaInMemoryUpload(txt, mimetype="application/json"),
                             fields=DRIVE_FIELDS, supportsAllDrives=True).execute()
    print(f"FCA {mes}: {len(data['items'])} KRs publicados en fca.json")
    publish_after_drive(res, txt)


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--crear":
        crear()
    elif len(sys.argv) == 2:
        publish(sys.argv[1])
    else:
        sys.exit("Uso: python FCA/fca_publish.py <AAAA-MM> | --crear")
