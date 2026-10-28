"""
ownia_publish.py — Doble escritura: después de subir un archivo a Drive, lo manda también a Ownia.

Los pipelines siguen publicando en Drive (que además alimenta a los toqans). Con esto, el mismo
momento en que un pipeline sube a Drive también deja el archivo en el almacén de Ownia, sin
esperar a que alguien corra `ownia_mirror.py`. Se manda el MISMO contenido con la fecha de
modificación que devolvió Drive, así `getLastUpdated()` da igual en los dos lados y el mirror, si
se corre después, ve "sin cambios".

Uso, en el punto de subida de cada pipeline (res = respuesta de Drive pedida con DRIVE_FIELDS):
    from ownia_publish import DRIVE_FIELDS, publish_after_drive
    res = service.files().update(fileId=..., media_body=media, fields=DRIVE_FIELDS).execute()
    publish_after_drive(res, json_bytes)

Reglas:
  - Nunca corta el pipeline: Drive ya quedó bien. Si Ownia falla, avisa por pantalla; el mirror
    (`py Ownia_B2B_Ecosystem/mirror/ownia_mirror.py`) lo repara después. Tras el primer error no
    insiste con el resto de los archivos de esa corrida (evita esperas por cada uno).
  - Solo publica lo que está en `server/drive-manifest.json` (por id, o por carpeta + nombre): lo
    demás (p. ej. las copias comprimidas) se ignora sin ruido, igual que /ingest lo rechazaría.
  - Config: `credenciales/.env.ownia` (OWNIA_URL, OWNIA_INGEST_TOKEN) o variables de entorno. Sin
    config, o con OWNIA_PUBLISH=off, no hace nada.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE.parent / "server" / "drive-manifest.json"

# Campos que hay que pedirle a Drive en update()/create() para poder publicar en Ownia.
DRIVE_FIELDS = "id,name,mimeType,modifiedTime,parents"

_state = {"off": False, "target": None, "allow": None}


def _allowlist():
    if _state["allow"] is None:
        m = json.loads(MANIFEST.read_text(encoding="utf-8"))
        ids, by_folder = set(), set()
        for spec in m["modules"].values():
            ids.update(spec.get("files", {}))
            for folder, names in spec.get("folders", {}).items():
                by_folder.update((folder, n) for n in names)
        _state["allow"] = (ids, by_folder)
    return _state["allow"]


def _target():
    if _state["target"] is None:
        sys.path.insert(0, str(HERE))
        from ownia_mirror import OwniaTarget, load_env  # noqa: E402
        _state["target"] = OwniaTarget(load_env())
    return _state["target"]


def publish_after_drive(res: dict, content: bytes, name: str = None) -> bool:
    """Publica en Ownia el archivo que se acaba de subir a Drive. True si lo subió."""
    if _state["off"] or os.environ.get("OWNIA_PUBLISH", "").lower() == "off":
        return False
    try:
        fname = name or res.get("name")
        folder = (res.get("parents") or [None])[0]
        ids, by_folder = _allowlist()
        if res.get("id") not in ids and (folder, fname) not in by_folder:
            return False   # no es un archivo que lea Ownia
        from datetime import datetime  # noqa: E402
        modified = res["modifiedTime"]
        f = {
            "id": res["id"],
            "name": fname,
            "folderId": folder,
            "mimeType": res.get("mimeType") or "application/json",
            "modifiedTime": modified,
            "updatedAt": int(datetime.fromisoformat(modified.replace("Z", "+00:00")).timestamp() * 1000),
        }
        _target().put(f, content)
        print(f"  OK Ownia: {fname} ({len(content) / 1e6:.1f} MB)")
        return True
    except (Exception, SystemExit) as e:   # SystemExit: el cliente del mirror aborta así ante un error HTTP
        _state["off"] = True
        print(f"  WARN Ownia: no se pudo publicar {res.get('name') or name} ({e}) — quedó en Drive; "
              f"correr ownia_mirror.py para repararlo. No se intenta con el resto de esta corrida.")
        return False
