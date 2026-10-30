"""
ownia_mirror.py — Copia a Ownia los archivos de Drive que leen las landings migradas.

Mientras Apps Script y Ownia corren en paralelo, los pipelines siguen publicando SOLO en
Drive (no se tocan). Este script copia esos mismos archivos, byte a byte, al almacén de la
app b2b-ecosystem en Ownia, con el mismo id, nombre, carpeta y fecha de modificación. Así
las dos versiones de cada landing leen exactamente los mismos datos.

Solo sube lo que cambió (compara la fecha de modificación de Drive con la de Ownia).

Uso:
    py ownia_mirror.py                       # todos los módulos del manifest → Ownia
    py ownia_mirror.py --module pnl-managerial
    py ownia_mirror.py --dry-run             # muestra qué subiría, sin subir
    py ownia_mirror.py --to-dir C:/tmp/store # a una carpeta (para correr la app en local)

Config (credenciales/.env.ownia, gitignoreado; o variables de entorno):
    OWNIA_URL=https://ownia.despegar.io/b2b-ecosystem
    OWNIA_INGEST_TOKEN=...                   # = APP_SECRETS.INGEST_TOKEN de la app
    CF_ACCESS_CLIENT_ID=...                  # service token de Cloudflare Access (si aplica)
    CF_ACCESS_CLIENT_SECRET=...

Drive: usa el mismo login que los uploaders del P&L (Inputs_Planning_PnL/token_drive.json,
ver auth_drive.py).
"""
import argparse
import datetime
import gzip
import hashlib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
MANIFEST = HERE.parent / "server" / "drive-manifest.json"  # el server lo usa como allowlist de /ingest
ENV_FILE = REPO / "credenciales" / ".env.ownia"


def load_env():
    cfg = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
    for k in ("OWNIA_URL", "OWNIA_INGEST_TOKEN", "CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    return cfg


def drive_service():
    sys.path.insert(0, str(REPO / "Inputs_Planning_PnL"))
    from pnl_common import get_drive_service  # noqa: E402
    return get_drive_service()


def to_ms(rfc3339):
    return int(datetime.datetime.fromisoformat(rfc3339.replace("Z", "+00:00")).timestamp() * 1000)


# ── Qué hay que copiar ────────────────────────────────────────────────────────

FIELDS = "id,name,mimeType,modifiedTime,parents,trashed,md5Checksum"
SHEET_MIME = "application/vnd.google-apps.spreadsheet"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def wanted_files(svc, manifest, only_module):
    """[{id, name, mimeType, updatedAt, folderId, export}] de Drive para los módulos pedidos (sin repetir).

    Las Google Sheets del manifest ("sheets") se exportan a .xlsx (export=True); en Ownia las lee
    el shim de SpreadsheetApp (server/gas-sheets.js) por el mismo id.
    """
    out = {}
    for slug, spec in manifest["modules"].items():
        if only_module and slug != only_module:
            continue
        for fid in spec.get("files", {}):
            f = svc.files().get(fileId=fid, fields=FIELDS, supportsAllDrives=True).execute()
            if f.get("trashed"):
                raise SystemExit(f"[{slug}] {fid} ({f['name']}) está en la papelera de Drive")
            out[fid] = f
        for fid in spec.get("sheets", {}):
            f = svc.files().get(fileId=fid, fields=FIELDS, supportsAllDrives=True).execute()
            if f.get("trashed"):
                raise SystemExit(f"[{slug}] {fid} ({f['name']}) está en la papelera de Drive")
            if f["mimeType"] != SHEET_MIME:
                raise SystemExit(f"[{slug}] {fid} ({f['name']}) no es una Google Sheet ({f['mimeType']}): va en 'files'")
            f["_export"] = True
            info = spec["sheets"][fid]
            f["_ranges"] = info.get("ranges") if isinstance(info, dict) else None
            out[fid] = f
        for folder, names in spec.get("folders", {}).items():
            for name in names:
                q = f"'{folder}' in parents and name = '{name}' and trashed = false"
                res = svc.files().list(q=q, fields=f"files({FIELDS})", supportsAllDrives=True,
                                       includeItemsFromAllDrives=True).execute()
                if not res.get("files"):
                    raise SystemExit(f"[{slug}] no hay '{name}' en la carpeta {folder}: la landing en Ownia daría vacío")
                for f in res.get("files", []):
                    f["_folder"] = folder
                    out[f["id"]] = f
    files = []
    for f in out.values():
        if f["mimeType"].startswith("application/vnd.google-apps.") and not f.get("_export"):
            raise SystemExit(f"{f['id']} ({f['name']}) es un archivo nativo de Google ({f['mimeType']}): "
                             "si es una Sheet, va en 'sheets' del manifest")
        files.append({
            "id": f["id"],
            "name": f["name"],
            "mimeType": f["mimeType"],
            "updatedAt": to_ms(f["modifiedTime"]),
            "modifiedTime": f["modifiedTime"],
            "folderId": f.get("_folder") or (f.get("parents") or [None])[0],
            "md5": f.get("md5Checksum"),  # las Sheets no tienen: no se chequea
            "export": bool(f.get("_export")),
            "ranges": f.get("_ranges"),
        })
    return sorted(files, key=lambda x: x["name"])


# Errores de celda de la API de Sheets → el texto que devuelve getValues() en Apps Script.
SHEET_ERRORS = {"NULL_VALUE": "#NULL!", "DIVIDE_BY_ZERO": "#DIV/0!", "VALUE": "#VALUE!", "REF": "#REF!",
                "NAME": "#NAME?", "NUM": "#NUM!", "N_A": "#N/A", "ERROR": "#ERROR!", "LOADING": "#N/A"}


def sheet_ranges_xlsx(svc, fid, ranges):
    """Solo los rangos pedidos de una Google Sheet, como .xlsx con cada celda en su misma posición.

    Para planillas que Drive no deja exportar enteras (tope de 10 MB). Usa los valores calculados
    (como getValues() en GAS) y marca con formato fecha las celdas DATE/TIME, para que el shim
    (server/gas-sheets.js) las devuelva como Date.
    """
    import openpyxl
    from googleapiclient.discovery import build
    sheets = build("sheets", "v4", credentials=svc._http.credentials, cache_discovery=False)
    res = sheets.spreadsheets().get(
        spreadsheetId=fid, ranges=ranges, includeGridData=True,
        fields="sheets(properties(title),data(startRow,startColumn,"
               "rowData(values(effectiveValue,effectiveFormat(numberFormat(type))))))",
    ).execute()
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for sh in res.get("sheets", []):
        ws = wb.create_sheet(sh["properties"]["title"])
        for block in sh.get("data", []):
            r0, c0 = block.get("startRow", 0), block.get("startColumn", 0)
            for i, row in enumerate(block.get("rowData", [])):
                for j, cell in enumerate(row.get("values", [])):
                    ev = cell.get("effectiveValue")
                    if not ev:
                        continue
                    target = ws.cell(row=r0 + i + 1, column=c0 + j + 1)
                    if "numberValue" in ev:
                        target.value = ev["numberValue"]
                        kind = cell.get("effectiveFormat", {}).get("numberFormat", {}).get("type")
                        if kind in ("DATE", "TIME", "DATE_TIME"):
                            target.number_format = "yyyy-mm-dd hh:mm:ss"
                    elif "stringValue" in ev:
                        target.value = ev["stringValue"]
                    elif "boolValue" in ev:
                        target.value = ev["boolValue"]
                    elif "errorValue" in ev:
                        target.value = SHEET_ERRORS.get(ev["errorValue"].get("type"), "#ERROR!")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def download(svc, fid, export=False, ranges=None):
    if export and ranges:
        return sheet_ranges_xlsx(svc, fid, ranges)
    from googleapiclient.http import MediaIoBaseDownload
    buf = io.BytesIO()
    req = (svc.files().export_media(fileId=fid, mimeType=XLSX_MIME) if export
           else svc.files().get_media(fileId=fid, supportsAllDrives=True))
    dl = MediaIoBaseDownload(buf, req, chunksize=16 * 1024 * 1024)
    done = False
    while not done:
        _, done = dl.next_chunk()
    return buf.getvalue()


# ── Destinos ──────────────────────────────────────────────────────────────────

class OwniaTarget:
    def __init__(self, cfg):
        if not cfg.get("OWNIA_URL") or not cfg.get("OWNIA_INGEST_TOKEN"):
            raise SystemExit(f"Faltan OWNIA_URL / OWNIA_INGEST_TOKEN (en {ENV_FILE} o variables de entorno)")
        # http:// solo a la misma máquina: el botón "Actualizar reales" corre el pipeline dentro del
        # contenedor de Ownia y publica en su propio servidor (server/reales-job.js); el token no sale de ahí.
        loopback = re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?(/|$)", cfg["OWNIA_URL"])
        if not cfg["OWNIA_URL"].startswith("https://") and not loopback:
            raise SystemExit("OWNIA_URL tiene que ser https:// (el token viaja en un header)")
        self.base = cfg["OWNIA_URL"].rstrip("/") + "/ingest/files"
        self.headers = {"Authorization": f"Bearer {cfg['OWNIA_INGEST_TOKEN']}", "User-Agent": "ownia-mirror"}
        if cfg.get("CF_ACCESS_CLIENT_ID"):
            self.headers["CF-Access-Client-Id"] = cfg["CF_ACCESS_CLIENT_ID"]
            self.headers["CF-Access-Client-Secret"] = cfg.get("CF_ACCESS_CLIENT_SECRET", "")

    def _req(self, method, url, data=None, headers=None):
        req = urllib.request.Request(url, data=data, method=method, headers={**self.headers, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                body = r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            raise SystemExit(f"Ownia respondió {e.code} en {method} {url}: {e.read().decode('utf-8', 'replace')[:300]}")
        try:
            return json.loads(body)
        except ValueError:
            # Típico de Cloudflare Access: devuelve la página de login en vez de la API.
            raise SystemExit(f"Respuesta no-JSON de {url} (¿Cloudflare Access bloqueando el script?): {body[:200]}")

    def current(self):
        return {f["id"]: f for f in self._req("GET", self.base)["files"]}

    def put(self, f, content):
        headers = {
            "Content-Type": f["mimeType"],
            "Content-Encoding": "gzip",
            "X-File-Name": urllib.parse.quote(f["name"]),
            "X-Updated-At": f["modifiedTime"],
        }
        if f["folderId"]:
            headers["X-Folder-Id"] = f["folderId"]
        return self._req("PUT", f"{self.base}/{f['id']}", data=gzip.compress(content), headers=headers)["file"]


class DirTarget:
    """Mismo formato que DirBackend (server/file-store.js): <dir>/<id> + <dir>/_index.json."""

    def __init__(self, path):
        self.dir = Path(path)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.index_path = self.dir / "_index.json"

    def current(self):
        return json.loads(self.index_path.read_text(encoding="utf-8")) if self.index_path.exists() else {}

    def put(self, f, content):
        (self.dir / f["id"]).write_bytes(content)
        idx = self.current()
        meta = {"id": f["id"], "name": f["name"], "folderId": f["folderId"], "mimeType": f["mimeType"],
                "updatedAt": f["updatedAt"], "size": len(content), "sha256": hashlib.sha256(content).hexdigest()}
        idx[f["id"]] = meta
        self.index_path.write_text(json.dumps(idx, indent=1), encoding="utf-8")
        return meta


def main():
    # La consola de Windows (cp1252) no imprime ↑ y cortaba la corrida a mitad.
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--module", help="slug del manifest (default: todos)")
    ap.add_argument("--to-dir", help="escribir a esta carpeta en vez de subir a Ownia")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="subir aunque la fecha no haya cambiado")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if args.module and args.module not in manifest["modules"]:
        raise SystemExit(f"--module {args.module}: no está en el manifest ({', '.join(manifest['modules'])})")
    target = DirTarget(args.to_dir) if args.to_dir else OwniaTarget(load_env())
    svc = drive_service()

    files = wanted_files(svc, manifest, args.module)
    have = target.current()
    subidos = saltados = 0
    for f in files:
        cur = have.get(f["id"])
        # Las Sheets se bajan siempre: un valor que cambia por fórmula no mueve su modifiedTime.
        if cur and cur.get("updatedAt") == f["updatedAt"] and not args.force and not f["export"]:
            print(f"  = {f['name']:<45} sin cambios ({f['modifiedTime']})")
            continue
        if args.dry_run:
            print(f"  ~ {f['name']:<45} subiría ({f['modifiedTime']})")
            continue
        content = download(svc, f["id"], f["export"], f["ranges"])
        # Contenido y metadata tienen que ser de la misma versión: si el pipeline reescribió el
        # archivo mientras se bajaba, md5 no coincide → se saltea y lo toma la próxima corrida.
        if f["md5"] and hashlib.md5(content).hexdigest() != f["md5"]:
            print(f"  ! {f['name']:<45} cambió en Drive mientras se bajaba: se saltea (correr de nuevo)")
            saltados += 1
            continue
        meta = target.put(f, content)
        subidos += 1
        print(f"  ↑ {f['name']:<45} {meta['size'] / 1e6:6.1f} MB  ({f['modifiedTime']})")
    print(f"OK: {subidos} subido(s), {len(files) - subidos - saltados} sin cambios" + (" [dry-run]" if args.dry_run else ""))
    if saltados:
        raise SystemExit(f"{saltados} archivo(s) cambiaron mientras se bajaban: volver a correr")


if __name__ == "__main__":
    main()
