"""
B2B2C Tracker (2026-11-10, Diego): funnel de tráfico semanal de las WLs para la página /b2b2c-tracker de Ownia.

Fuente: data.analytics.b2b_partners_agg_weekly_traffic (la query que pasó Diego, de producto B2B2C), ya agregada por semana ISO
(event_year_week; una semana que cae en dos meses viene partida en dos filas por event_month, así que con la misma query sale el
mensual). Los resultados (orders, GB, NR, FVM) NO salen de acá: el servidor los toma de daily_b2b2c_data.json (actuals + actuals_ly).

Lo llama daily_sync.py ("Actualizar reales"): build_payload(fetch) devuelve el payload; daily_sync lo sube a Drive y Ownia como el resto.
Corrido solo (python b2b2c_tracker_sync.py [--out archivo.json]) usa el DSN del Datalake y NO sube nada.

Criterios:
  - Partner = partner_homologado_2 de la cartera (el mismo nombre que usa el Daily); sin homologar -> 'Otros' (~0,2% de los bookings).
  - País = país de navegación (country). Solo los países reales de SITES: el campo trae basura de escaneos de seguridad.
  - Producto agrupado como el Daily (Carrito/Bundles/Escapadas = Paquetes, Actividades/Traslados = Servicios en destino...).
    Home y Promociones son páginas, no productos: van a 'Otros' (suman usuarios, 0 bookings).
  - Usuarios = usuarios únicos por semana y por fila: al sumar productos, plataformas o semanas un usuario se cuenta más de una
    vez ("usuarios-semana"). Las conversiones entre pasos sí son comparables entre períodos.
  - Ojo: la tabla tiene semanas con días sin cargar (p.ej. 2025-41 a 2025-47). El servidor las detecta comparando los bookings del
    tráfico contra las orders del Daily y las saca del YoY y de la tendencia (server/b2b2c-tracker.js).
"""
import json
import math
import os
import sys
from datetime import date
from pathlib import Path

import pandas as pd

BASE = Path(__file__).resolve().parent
FILE_NAME = "b2b2c_tracker.json"           # en la carpeta del Daily de Drive; /ingest lo acepta por drive-manifest.json
DESDE_ANIO = 2025                          # el YoY de 2026 necesita 2025 completo
SITES = ("AR", "BR", "MX", "US", "CL", "CO", "PE", "UY", "EC", "PA")
MIN_ROWS = 1000                            # una query que devuelve menos es sospechosa: no se pisa el archivo anterior

DIMS = ["partner", "site", "plataforma", "producto"]
METRICS = ["usuarios", "search", "detail", "pi", "checkout", "bookings"]


def build_query(hasta_anio: int) -> str:
    sites = ", ".join(f"'{s}'" for s in SITES)
    return f"""
SELECT
    bwt.event_year_week                                        AS yw,
    bwt.event_year                                             AS anio,
    bwt.event_month                                            AS mes,
    COALESCE(dp.partner_homologado_2, 'Otros')                 AS partner,
    bwt.country                                                AS site,
    bwt.platform                                               AS plataforma,
    CASE
        WHEN bwt.product_type = 'Vuelos'                                  THEN 'Vuelos'
        WHEN bwt.product_type IN ('Carrito', 'Bundles', 'Escapadas')      THEN 'Paquetes'
        WHEN bwt.product_type = 'Hoteles'                                 THEN 'Hoteles'
        WHEN bwt.product_type IN ('Actividades', 'Traslados')             THEN 'Servicios en destino'
        WHEN bwt.product_type = 'Autos'                                   THEN 'Autos'
        WHEN bwt.product_type IN ('Asistencia al viajero', 'Seguros')     THEN 'Asistencia'
        WHEN bwt.product_type = 'Alquileres'                              THEN 'Alquileres'
        ELSE 'Otros'
    END                                                        AS producto,
    SUM(bwt.user_count)                                        AS usuarios,
    SUM(bwt.flow_search_count)                                 AS search,
    SUM(bwt.flow_detail_count)                                 AS detail,
    SUM(bwt.flow_pi_count)                                     AS pi,
    SUM(bwt.flow_checkout_count)                               AS checkout,
    SUM(bwt.booking)                                           AS bookings
FROM data.analytics.b2b_partners_agg_weekly_traffic bwt
LEFT JOIN data.raw.comdev_cartera_b2b2c_historic dp
    ON dp.partner_id = bwt.partner_code
    AND dp.is_current <> 'false'
WHERE bwt.event_year_week BETWEEN '{DESDE_ANIO}-01' AND '{hasta_anio}-53'
  AND bwt.partner_code IS NOT NULL
  AND bwt.line_of_business = 'B2B2C'
  AND bwt.channel <> 'puntosbonus-pe'
  AND bwt.country IN ({sites})
GROUP BY 1, 2, 3, 4, 5, 6, 7
"""


def _int(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    return 0 if math.isnan(f) else int(round(f))


def payload_from_df(df: pd.DataFrame) -> dict:
    """Filas con las dimensiones codificadas por índice (dims) para que el JSON quede chico (~100K filas)."""
    dims = {d: [] for d in DIMS}
    idx = {d: {} for d in DIMS}

    def code(d, v):
        v = str(v) if v is not None and not (isinstance(v, float) and math.isnan(v)) else "(Sin dato)"
        if v not in idx[d]:
            idx[d][v] = len(dims[d])
            dims[d].append(v)
        return idx[d][v]

    rows = []
    for r in df.to_dict("records"):
        vals = [_int(r.get(m)) for m in METRICS]
        if not any(vals):
            continue
        rows.append([str(r["yw"]), _int(r["anio"]), _int(r["mes"])] + [code(d, r.get(d)) for d in DIMS] + vals)
    rows.sort(key=lambda x: (x[0], x[1], x[2]))
    return {
        "actualizado": date.today().isoformat(),
        "nota": "Generado por Daily_Dashboard/b2b2c_tracker_sync.py desde data.analytics.b2b_partners_agg_weekly_traffic (semanas ISO).",
        "desde": rows[0][0] if rows else None,
        "hasta": rows[-1][0] if rows else None,
        "dims": dims,
        "cols": ["yw", "anio", "mes"] + DIMS + METRICS,
        "rows": rows,
    }


def build_payload(fetch):
    """fetch(query, label) -> DataFrame (el de daily_sync.py). None si la query no trae lo esperado (no se pisa nada)."""
    df = fetch(build_query(date.today().year), "B2B2C Tracker (tráfico semanal)")
    if df is None or len(df) < MIN_ROWS:
        print(f"  WARN B2B2C Tracker: la query trajo {0 if df is None else len(df)} filas (mínimo {MIN_ROWS}) — queda el archivo anterior")
        return None
    return payload_from_df(df)


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
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if out:
        Path(out).write_text(text, encoding="utf-8")
        print(f"  OK: {len(payload['rows'])} filas ({payload['desde']} a {payload['hasta']}) -> {out} ({len(text) / 1e6:.1f} MB)")
    else:
        print(f"  OK: {len(payload['rows'])} filas ({payload['desde']} a {payload['hasta']}) (usar --out archivo.json para guardarlo)")
