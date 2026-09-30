"""
managerial_drive.py — parte los JSON de P&L Managerial (GD / RI) en archivos chicos para Drive.

Los lee un agente de Toqan con el MCP de Google Workspace, que solo abre archivos de hasta 5 MB.
Por eso cada dataset se sube como:

  <base>_<YYYY-MM>_<canal>.json          un archivo por mes x parent_channel (API / Agencias),
                                         comprimido bz2 nivel 9 + base64 (text/plain)
  <base>_<YYYY-MM>_<canal>_p1.json ...   solo si ese mes x canal supera MAX_BYTES: se parte por
                                         rango de fechas (y por filas si un solo día no entra)
  <base>_index.json                      JSON plano: qué archivos hay, período, filas, cómo leerlos

Contenido de cada archivo (ya descomprimido): {"meta": {...}, "data": {"cols": [...], "rows": [[...]]}}
— el mismo formato "cols + rows" de siempre, con TODAS las filas y columnas; solo van ordenadas
(mejora la compresión ~10%).

Para leer un archivo:
    obj = json.loads(bz2.decompress(base64.b64decode(texto)))
"""

import base64
import bz2
import json
import re
from datetime import datetime

import pandas as pd

MAX_BYTES   = 4_950_000          # límite por archivo (el MCP de Toqan lee hasta 5 MB)
COMPRESSION = "bz2+base64"
CANAL_SLUG  = {"API": "API", "Agencias afiliadas": "Agencias"}


def _slug(canal) -> str:
    if canal is None or (isinstance(canal, float) and pd.isna(canal)):
        return "SinCanal"
    return CANAL_SLUG.get(canal, re.sub(r"[^A-Za-z0-9]+", "", str(canal)) or "SinCanal")


def _encode(df: pd.DataFrame, meta: dict) -> bytes:
    rows = df.astype(object).where(df.notna(), None).values.tolist()
    raw  = json.dumps({"meta": meta, "data": {"cols": list(df.columns), "rows": rows}},
                      ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(bz2.compress(raw, 9))


def _sort(df: pd.DataFrame) -> pd.DataFrame:
    dims = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    return df.sort_values(dims, na_position="first", kind="stable").reset_index(drop=True)


def _fit(df: pd.DataFrame, date_col: str, meta: dict) -> list:
    """Devuelve [(df_parte, bytes)] con cada parte <= MAX_BYTES. Parte por fechas; si un
    solo día no entra, parte por filas."""
    data = _encode(df, meta)
    # margen de 1 KB: si después hay que re-codificar la parte con parte/partes en el meta,
    # esos bytes extra no pueden dejarla por encima del límite
    if len(data) <= MAX_BYTES - 1_000 or len(df) <= 1:
        return [(df, data)]
    fechas = sorted(df[date_col].dropna().unique())
    if len(fechas) > 1:
        corte = fechas[len(fechas) // 2]
        a, b = df[df[date_col] < corte], df[~(df[date_col] < corte)]
    else:
        mid = len(df) // 2
        a, b = df.iloc[:mid], df.iloc[mid:]
    return _fit(a, date_col, meta) + _fit(b, date_col, meta)


def build_files(df: pd.DataFrame, base_name: str, date_col: str, meta: dict):
    """Arma los archivos partidos + el índice. No sube nada.
    Devuelve (files, index_name, index_bytes); files = [(nombre, bytes, info)]."""
    base_name = base_name[:-5] if base_name.endswith(".json") else base_name
    files = []
    if not df.empty:
        df = df.copy()
        for c in df.columns:                       # -0.0 -> 0.0 (mismo valor, JSON más corto)
            if pd.api.types.is_float_dtype(df[c]):
                df[c] = df[c] + 0.0
        # filas sin fecha (to_datetime coerce falló) van a "0000-00" en vez de perderse en el groupby
        mes   = df[date_col].str[:7].fillna("0000-00")
        canal = df["parent_channel"] if "parent_channel" in df.columns else pd.Series(None, index=df.index)
        for (m, ch), g in df.groupby([mes, canal.fillna("")], sort=True):
            ch = ch or None
            g = _sort(g.reset_index(drop=True))
            parte_meta = dict(meta, mes=m, canal=ch)
            partes = _fit(g, date_col, parte_meta)
            for i, (p, data) in enumerate(partes, 1):
                suf  = f"_p{i}" if len(partes) > 1 else ""
                name = f"{base_name}_{m}_{_slug(ch)}{suf}.json"
                if len(partes) > 1:            # re-encode con la parte en el meta
                    data = _encode(p, dict(parte_meta, parte=i, partes=len(partes)))
                files.append((name, data, {
                    "archivo": name, "mes": m, "canal": ch,
                    "parte": i, "partes": len(partes),
                    "fecha_desde": p[date_col].min(), "fecha_hasta": p[date_col].max(),
                    "filas": len(p), "bytes": len(data),
                }))
    over = [f for f in files if len(f[1]) > MAX_BYTES]
    if over:
        raise ValueError(f"archivos por encima de {MAX_BYTES:,} bytes: {[f[0] for f in over]}")
    nombres = [f[0] for f in files]
    if len(nombres) != len(set(nombres)):
        raise ValueError(f"nombres de archivo repetidos (dos canales con el mismo slug): {nombres}")
    filas = sum(f[2]["filas"] for f in files)
    if filas != len(df):
        raise ValueError(f"se perdieron filas al partir: {len(df):,} -> {filas:,}")

    index = {
        "meta": dict(meta, generated_at=meta.get("generated_at") or datetime.now().strftime("%Y-%m-%dT%H:%M:%S")),
        "compresion": COMPRESSION,
        "como_leer": "obj = json.loads(bz2.decompress(base64.b64decode(texto))); "
                     "df = pd.DataFrame(obj['data']['rows'], columns=obj['data']['cols']). "
                     "Leer todos los archivos de 'archivos' que hagan falta y concatenarlos.",
        "particion": f"un archivo por mes ({date_col}) x parent_channel; si pasa {MAX_BYTES:,} bytes se parte en _p1, _p2...",
        "filas_total": int(sum(f[2]["filas"] for f in files)),
        "archivos": [f[2] for f in files],
    }
    index_name  = f"{base_name}_index.json"
    index_bytes = json.dumps(index, ensure_ascii=False, indent=1).encode("utf-8")
    return files, index_name, index_bytes


def _upsert(service, folder_id: str, name: str, data: bytes, mimetype: str):
    from googleapiclient.http import MediaInMemoryUpload
    media = MediaInMemoryUpload(data, mimetype=mimetype, resumable=False)
    found = service.files().list(
        q=f"name='{name}' and '{folder_id}' in parents and trashed=false",
        fields="files(id)").execute().get("files", [])
    if found:
        service.files().update(fileId=found[0]["id"], media_body=media).execute()
    else:
        service.files().create(body={"name": name, "parents": [folder_id]},
                               media_body=media, fields="id").execute()


def upload(service, folder_id: str, files, index_name: str, index_bytes: bytes):
    """Sube las partes (text/plain) y después el índice (application/json). Manda a la
    papelera las partes viejas de este mismo dataset que ya no están en el índice (p. ej. un
    _p2 de un mes que ahora entra en un solo archivo). No toca ningún otro archivo."""
    base = index_name[: -len("_index.json")]
    if not files:
        print(f"  WARN {base}: 0 filas — no se sube nada (quedan los archivos de la corrida anterior)")
        return
    for name, data, _ in files:
        _upsert(service, folder_id, name, data, "text/plain")
        print(f"  OK Drive: {name}  ({len(data)/1e6:.2f} MB)")
    _upsert(service, folder_id, index_name, index_bytes, "application/json")
    print(f"  OK Drive: {index_name}")

    vigentes = {f[0] for f in files}
    patron = re.compile(re.escape(base) + r"_\d{4}-\d{2}_[A-Za-z0-9]+(_p\d+)?\.json$")
    existentes = service.files().list(
        q=f"name contains '{base}_' and '{folder_id}' in parents and trashed=false",
        fields="files(id,name)", pageSize=1000).execute().get("files", [])
    for f in existentes:
        if patron.match(f["name"]) and f["name"] not in vigentes:
            service.files().update(fileId=f["id"], body={"trashed": True}).execute()
            print(f"  Papelera (parte vieja): {f['name']}")
