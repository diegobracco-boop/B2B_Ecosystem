"""
reales.py — reales diarios B2B2C / B2B para completar el Run Rate hasta la fecha de corte.

Usa EXACTAMENTE las mismas queries que Daily_Dashboard/daily_sync.py (las ejecuta desde ese
archivo, no las copia): así lo que el Daily compara contra el Run Rate es el mismo real que se
cargó en el Run Rate. Si daily_sync.py cambia una query, este proceso la toma sola.

Requiere VPN + credenciales del Datalake (credenciales/.env.<usuario>, igual que daily_sync).
"""

from pathlib import Path

import pandas as pd

DAILY_SYNC = Path(__file__).resolve().parent.parent / "Daily_Dashboard" / "daily_sync.py"
# daily_sync.py no tiene guard de __main__: se ejecutan solo sus definiciones (config, conexión,
# queries, fetch), cortando justo antes de la primera descarga. Si se renombra este marcador,
# el proceso avisa en vez de correr el sync entero.
_INICIO = "\nimport os"
_FIN = '\nprint(f"\\n--- Actuals FY'

PAIS_REAL = {"Paraguay": "Other Countries", "Uruguay": "Other Countries", "USA": "Other Countries"}
CANAL_B2B = {"API": "B2B-MAY", "Agencias afiliadas": "B2B-MIN"}


class ErrorReales(Exception):
    pass


def _defs_daily_sync():
    src = DAILY_SYNC.read_text(encoding="utf-8")
    i, j = src.find(_INICIO), src.find(_FIN)
    if i < 0 or j < 0 or j < i:
        raise ErrorReales(f"No encuentro los marcadores de inicio/fin en {DAILY_SYNC.name}; "
                          f"revisar _INICIO/_FIN en reales.py")
    ns = {"__file__": str(DAILY_SYNC), "__name__": "daily_sync_defs"}
    exec(compile(src[i:j], str(DAILY_SYNC), "exec"), ns)
    return ns


def cargar_reales(base, desde, hasta, log=print):
    """Devuelve {negocio: DataFrame[fecha, pais, viaje, producto, partner, lob_canal,
    orders, gross_bookings, net_revenue, fvm]} con los reales diarios de [desde, hasta].
    B2B2C tiene un único criterio (fecha de confirmación) → mismo real en GD y RI."""
    ds = _defs_daily_sync()
    log(f"  reales {desde} → {hasta} (queries de daily_sync.py)")

    a = ds["fetch"](ds["build_actuals_query"](desde, hasta), "Reales B2B2C")
    b2b2c = pd.DataFrame({
        "fecha": pd.to_datetime(a["fecha"]),
        "pais": a["pais"].replace(PAIS_REAL),
        "viaje": a["viaje"],
        "producto": a["productooriginal"],
        "partner": a["partner"].astype(str).str.strip(),
        "lob_canal": "",
        "orders": pd.to_numeric(a["orders"], errors="coerce").fillna(0),
        "gross_bookings": pd.to_numeric(a["gross_bookings"], errors="coerce").fillna(0),
        "net_revenue": pd.to_numeric(a["net_revenues"], errors="coerce").fillna(0),
        "fvm": pd.to_numeric(a["fvm"], errors="coerce").fillna(0),
    })

    q = ds["build_b2b_gd_query"] if base == "GD" else ds["build_b2b_ri_query"]
    b = ds["fetch"](q(desde, hasta), f"Reales B2B {base}")
    canal_raro = set(b["parent_channel"].dropna()) - set(CANAL_B2B)
    if canal_raro:
        raise ErrorReales(f"Canales B2B sin mapear a lob_canal: {canal_raro}")
    b2b = pd.DataFrame({
        "fecha": pd.to_datetime(b["fecha"]),
        "pais": b["pais"].replace(PAIS_REAL),
        "viaje": b["viaje"],
        "producto": b["producto_original"],
        "partner": "",
        "lob_canal": b["parent_channel"].map(CANAL_B2B),
        "orders": pd.to_numeric(b["orders"], errors="coerce").fillna(0),
        "gross_bookings": pd.to_numeric(b["gross_bookings"], errors="coerce").fillna(0),
        "net_revenue": pd.to_numeric(b["net_revenue"], errors="coerce").fillna(0),
        "fvm": pd.to_numeric(b["fvm"], errors="coerce").fillna(0),
    })
    return {
        "B2B2C": b2b2c,
        "B2B-MAY": b2b[b2b["lob_canal"] == "B2B-MAY"].copy(),
        "B2B-MIN": b2b[b2b["lob_canal"] == "B2B-MIN"].copy(),
    }
