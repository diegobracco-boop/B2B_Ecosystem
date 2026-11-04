"""
Pipeline B2B2C (Pipeline Hunting, 2026-11-04): corre la query de deals del pipeline y arma pipeline_b2b2c.json, que lee el servidor de
Ownia para la slide "B2B2C — Pipeline Hunting" del Flow y para la página /pipeline-hunting (server/pipeline-slide.js hace las cuentas).

Lo llama daily_sync.py ("Actualizar reales"): build_payload(fetch) devuelve el payload; daily_sync lo sube a Drive y Ownia como el resto.
Corrido solo (python pipeline_b2b2c_sync.py [--out archivo.json]) usa el DSN del Datalake y NO sube nada: sirve para revisar el resultado.

De HubSpot salen los deals (query: pipeline_b2b2c.sql). Lo MANUAL va acá abajo y no cambia hasta que alguien lo edite (Gregorio, 2026-11-04):
  - MANUAL_DEALS : deals que no están en la query (Mercado Pago, WL Cashback, del escenario neutro).
  - TOTALES      : NR y FVM H2'27 que muestra la slide; lo que no explican los deals va en "Otros".
  - EVOLUTIVO    : columnas del gráfico (FVM por mes en k USD, y # de deals con NR). Enero a marzo salen del P&L.
"""
import json
import math
import os
import re
import sys
from datetime import date
from pathlib import Path

import pandas as pd

BASE = Path(__file__).resolve().parent
SQL_FILE = BASE / "pipeline_b2b2c.sql"
FILE_NAME = "pipeline_b2b2c.json"          # en la carpeta del Daily de Drive; /ingest lo acepta por drive-manifest.json
PERIODO = "H2'26"

MANUAL_DEALS = [
    # amount = NR Y3 del escenario neutro; fvm_ratio = FVM Y3 / NR Y3 (693.194 / 2.626.594)
    {"name": "Mercado Pago", "cierre": "2026-12", "pais": "Brasil", "amount": 2626594, "fvm_ratio": 0.2639,
     "src": "Escenario neutro (manual)"},
]
TOTALES = {"nr_h2": 4100000, "fvm_h2": 1500000}
EVOLUTIVO_LABEL = "FVM [k USD]"
EVOLUTIVO = [
    {"mes": "Oct", "k": 0, "deals": 0}, {"mes": "Nov", "k": 13, "deals": 5}, {"mes": "Dec", "k": 37, "deals": 10},
    {"mes": "Jan", "k": 601, "deals": 22}, {"mes": "Feb", "k": 478, "deals": 26}, {"mes": "Mar", "k": 532, "deals": 35},
]

MIN_DEALS = 5   # una query que devuelve menos es sospechosa: no se pisa el archivo anterior


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def _name(s):
    return re.split(r"\s+-\s+", str(s).strip())[0].strip(" -")


def _pais(paises):
    items = [p for p in str(paises or "").split(";") if p.strip() and p.strip().lower() != "nan"]
    return items[0].strip() if len(items) == 1 else ("Multi-país" if items else "-")


def _cierre(v):
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m")
    return str(v)[:7]


def deals_from_df(df: pd.DataFrame) -> list:
    out = []
    for r in df.to_dict("records"):
        amount, nr, fvm = _num(r.get("amount")), _num(r.get("nr_hubspot")), _num(r.get("fvm_hubspot"))
        np_ = _num(r.get("num_partners")) or 1
        out.append({
            "name": _name(r.get("deal")),
            "cierre": _cierre(r.get("cierre")),
            "pais": _pais(r.get("paises")),
            "amount": round((amount or 0) / np_),
            "fvm_ratio": round(fvm / nr, 4) if nr and fvm is not None else None,
            "src": "HubSpot",
        })
    return out


def build_payload(fetch):
    """fetch(query, label) -> DataFrame (el de daily_sync.py). None si la query no trae lo esperado (no se pisa nada)."""
    df = fetch(SQL_FILE.read_text(encoding="utf-8"), "Pipeline B2B2C (Pipeline Hunting)")
    if df is None or len(df) < MIN_DEALS:
        print(f"  WARN Pipeline B2B2C: la query trajo {0 if df is None else len(df)} deals (mínimo {MIN_DEALS}) — queda el archivo anterior")
        return None
    deals = deals_from_df(df) + [dict(d) for d in MANUAL_DEALS]
    return {
        "periodo": PERIODO,
        "actualizado": date.today().isoformat(),
        "nota": "Generado por pipeline_b2b2c_sync.py (deals de HubSpot en etapa Pipeline, cierre oct-26 a mar-27). Totales y evolutivo: manuales.",
        "totales": TOTALES,
        "evolutivo_label": EVOLUTIVO_LABEL,
        "evolutivo": EVOLUTIVO,
        "deals": deals,
    }


def _fetch_standalone(query: str, label: str) -> pd.DataFrame:
    import warnings
    import pyodbc
    from dotenv import load_dotenv

    load_dotenv(BASE.parent / "credenciales" / f".env.{os.environ.get('USERNAME', '').lower()}")
    if not os.getenv("PASSWORD"):
        raise SystemExit("Falta PASSWORD en credenciales/.env.<usuario>")
    print(f"  > {label} ...")
    con = pyodbc.connect(f"DSN=DataLake Treasure ODBC;UID={os.getenv('USER')};PWD={os.getenv('PASSWORD')};", autocommit=True)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return pd.read_sql(query, con)
    finally:
        con.close()


if __name__ == "__main__":
    sys.stdout = __import__("io").TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    payload = build_payload(_fetch_standalone)
    if payload is None:
        raise SystemExit(1)
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    if out:
        Path(out).write_text(text, encoding="utf-8")
        print(f"  OK: {len(payload['deals'])} deals -> {out}")
    else:
        print(f"  OK: {len(payload['deals'])} deals (usar --out archivo.json para guardarlo)")
