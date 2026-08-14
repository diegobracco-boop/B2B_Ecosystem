"""
json_builder.py — Genera el JSON canónico por concepto desde las planas y lo sube a Drive.
Conceptos: budget | forecast | runrate | lastrunrate | actuals | actuals_previos | all

Reglas:
- Se agrega sobre 'Marca' (no se incluye en el output).
- 'Canal': solo B2B mantiene apertura (MAY/MIN); B2B2C y B2C se colapsan a 'total'.
- Formato compacto {meta, cols, rows}.
- Se sube a la carpeta Drive DRIVE_FOLDER_ID como <concepto>.json.
- 'actuals_previos' se FRACCIONA por año fiscal: emite un JSON por FY cerrado
  (actuals_previos_fyNN.json), para lecturas más livianas desde Apps Script.

Uso:  python json_builder.py <concepto|all> [--no-upload]
"""
import os
import re
import sys
import json
import glob
from collections import OrderedDict
import pandas as pd
import config
import pnl_common

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DRIVE_FOLDER_ID = config.DRIVE_FOLDER_ID
CURRENT_FY      = config.CURRENT_FY
DIR = os.path.dirname(os.path.abspath(__file__))

COLS_OUT = ["LoB", "Canal", "Pais", "Producto",
            "P&L N1", "P&L N2", "P&L N3", "P&L N4", "P&L N5", "P&L N6", "P&L Managerial View",
            "Fecha", "Monto USD"]
GROUP = COLS_OUT[:-1]  # todo menos Monto USD

CONCEPTS = {
    "budget":          ["plana_budget.csv"],
    "forecast":        ["plana_forecast.csv"],
    "forecast_v2":     ["plana_forecast_v2.csv"],
    "runrate":         ["plana_runrate.csv"],
    "lastrunrate":     ["plana_lastrunrate.csv"],
    "actuals":         None,   # FY en curso (CURRENT_FY)
    "actuals_previos": None,   # FYs cerrados (el resto)
}


def load_concept(concept):
    if concept in ("actuals", "actuals_previos"):
        cur = f"actuals_fy{str(CURRENT_FY)[-2:]}_"
        allf = sorted(glob.glob(os.path.join(DIR, "actuals_fy*.csv")))
        if concept == "actuals":
            files = [f for f in allf if os.path.basename(f).startswith(cur)]
        else:
            files = [f for f in allf if not os.path.basename(f).startswith(cur)]
    else:
        files = [os.path.join(DIR, f) for f in CONCEPTS[concept]]
    dfs = [pd.read_csv(f) for f in files if os.path.exists(f)]
    if not dfs:
        sys.exit(f"No hay planas para '{concept}' en {DIR}. Corré primero los builders de planas.")
    print(f"  fuentes: {[os.path.basename(f) for f in files if os.path.exists(f)]}")
    return pd.concat(dfs, ignore_index=True)


def _process(df):
    """Colapsa canal, agrega sobre Marca y descarta montos en cero."""
    df = df.copy()
    # Regla de negocio: país RG + cost of sales as principal -> 0
    mask = (df["Pais"].astype(str).str.lower() == "rg") & \
           (df["P&L N1"].astype(str).str.lower() == "cost of sales as principal")
    df.loc[mask, "Monto USD"] = 0
    # Canal: solo B2B abre MAY/MIN; el resto -> 'total'
    df["Canal"] = df["Canal"].where(df["LoB"].astype(str).str.lower() == "b2b", "total")
    df["Monto USD"] = pd.to_numeric(df["Monto USD"], errors="coerce").fillna(0).round(2)
    df = df.groupby(GROUP, as_index=False, dropna=False)["Monto USD"].sum()
    # NaN en columnas de dimensión → '' (NaN no es JSON válido)
    for col in GROUP:
        if col != "Monto USD":
            df[col] = df[col].fillna("")
    return df[df["Monto USD"] != 0][COLS_OUT]


def _emit(name, concept, df, upload):
    """Serializa un df ya procesado a JSON {meta,cols,rows}, lo guarda y (opcional) sube."""
    payload = {
        "meta": {"concepto": concept, "filas": len(df),
                 "fechas": sorted(df["Fecha"].astype(str).unique())},
        "cols": COLS_OUT,
        "rows": df.values.tolist(),
    }
    txt = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)
    data = txt.encode("utf-8")
    with open(os.path.join(DIR, name), "wb") as f:
        f.write(data)
    print(f"  {name}: {len(df):,} filas, {len(data)/1e6:.2f} MB, meses={len(payload['meta']['fechas'])}")
    if upload:
        _upload(name, data)
    return payload


def build(concept, upload=True):
    print(f"=== json {concept} ===")

    # actuals_previos: un JSON por año fiscal cerrado (fracción para lectura liviana)
    if concept == "actuals_previos":
        cur = f"actuals_fy{str(CURRENT_FY)[-2:]}_"
        allf = sorted(glob.glob(os.path.join(DIR, "actuals_fy*.csv")))
        prev = [f for f in allf if not os.path.basename(f).startswith(cur)]
        if not prev:
            sys.exit(f"No hay planas de FY cerrados en {DIR}. Corré primero plana_actuals_builder.py.")
        by_fy = OrderedDict()
        for f in prev:
            m = re.match(r"actuals_(fy\d{2})_", os.path.basename(f))
            by_fy.setdefault(m.group(1) if m else "fyXX", []).append(f)
        # limpiar el monolítico viejo si quedó en Drive
        if upload:
            _delete_if_exists("actuals_previos.json")
        results = []
        for fy, files in by_fy.items():
            print(f"  -- {fy}: {[os.path.basename(x) for x in files]}")
            df = _process(pd.concat([pd.read_csv(x) for x in files], ignore_index=True))
            results.append(_emit(f"actuals_previos_{fy}.json", "actuals_previos", df, upload))
        return results

    df = _process(load_concept(concept))
    return _emit(f"{concept}.json", concept, df, upload)


def _upload(name, data):
    from googleapiclient.http import MediaInMemoryUpload
    svc = pnl_common.get_drive_service()
    media = MediaInMemoryUpload(data, mimetype="application/json", resumable=False)
    q = f"name='{name}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false"
    ex = svc.files().list(q=q, fields="files(id,name)").execute().get("files", [])
    if ex:
        svc.files().update(fileId=ex[0]["id"], media_body=media).execute()
        print(f"  [Drive] actualizado {name}")
    else:
        svc.files().create(body={"name": name, "parents": [DRIVE_FOLDER_ID]},
                           media_body=media, fields="id").execute()
        print(f"  [Drive] creado {name}")


def _delete_if_exists(name):
    """Borra de Drive un archivo por nombre (usado para limpiar el monolítico viejo)."""
    svc = pnl_common.get_drive_service()
    q = f"name='{name}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false"
    for f in svc.files().list(q=q, fields="files(id,name)").execute().get("files", []):
        svc.files().delete(fileId=f["id"]).execute()
        print(f"  [Drive] eliminado (obsoleto) {name}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    upload = "--no-upload" not in sys.argv
    if not args or (args[0] not in CONCEPTS and args[0] != "all"):
        sys.exit(f"Uso: python json_builder.py <{'|'.join(CONCEPTS)}|all> [--no-upload]")
    targets = list(CONCEPTS) if args[0] == "all" else [args[0]]
    for c in targets:
        build(c, upload=upload)
