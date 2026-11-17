# -*- coding: utf-8 -*-
"""
embudo_b2b_sync.py
==================
Embudo B2B (2026-11-17, Diego): qué pasa con lo que vende B2B. Se vende 100, una parte se cancela, otra queda pendiente
y lo confirmado se reconoce (RI) cuando viaja el pasajero, a veces meses después. Arma embudo_b2b.json para la página
/embudo-b2b de Ownia (server/embudo-b2b.js hace las cuentas; server/embudo-b2b-page.js dibuja).

Dos tablas, con las MISMAS reglas que las queries B2B del Daily (daily_sync.py: build_b2b_gd_query / build_b2b_ri_query):
  - cohortes: lo vendido por mes de venta (fecha de gestión, lob_gestion de venta B2B) × canal × país × producto × etapa,
    en bruto (gestion_gb) y como lo muestra el Daily por GD (gestion_gb × confirmation_gradient). Etapa = estado de HOY:
      Cancelado   estado actual Cancelado (current_state, si no el de la venta)
      Pendiente   estado actual Activo (reservado, sin confirmar; casi todo HTML Hoteles)
      Reconocido  confirmado y con fecha de reconocimiento hasta `hasta`
      A reconocer confirmado con fecha de reconocimiento futura (todavía no viajó)
    Fecha de reconocimiento = la del RI del Daily: check-in para API Hoteles, recognition_date para el resto.
  - ri: el RI del Daily por mes de reconocimiento × canal × país × producto × mes de venta (gestion_gb, sin gradiente, sin
    las ventas API canceladas antes del check-in). Sirve para explicar por qué en un mismo mes GD y RI no coinciden.
  - cosecha: lo vendido y confirmado por mes de venta × mes de reconocimiento (también los meses futuros: viajes ya
    programados) × canal × país × producto. Es la tabla de aging entre la fecha de venta y la de reconocimiento.
  - pagos (solo HTML): lo vendido por mes de venta × país × producto × medio de pago × estado (Cancelado / Pendiente /
    Confirmado), en bruto y × gradiente. Medio de pago = payment_methods de data.lake.channels_bo_product, de la fila
    emitida si la hay (una venta puede tener varias: prereserva, emisión…); el agrupado lo hace server/embudo-b2b.js.
Canal: HTML = Agencias afiliadas, API = API. País: _B2B_PAIS_CASE del Daily. Ventas y RI desde DESDE.

Lo llama daily_sync.py ("Actualizar reales"): build_payload(fetch, pais_case, hasta) devuelve el payload; daily_sync lo sube
a Drive y a Ownia como el resto. Corrido solo (py embudo_b2b_sync.py [--out archivo.json] [--hasta AAAA-MM-DD]) usa las
definiciones de daily_sync.py (conexión y país) y NO sube nada.
"""
import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path

BASE = Path(__file__).resolve().parent
FILE_NAME = "embudo_b2b.json"   # en la carpeta del Daily de Drive; /ingest lo acepta por drive-manifest.json
DESDE = "2025-01-01"            # las ventas de 2025 ya terminaron de cancelarse: sirven para ver el % de cancelación maduro
MIN_ROWS = 500                  # una query que devuelve menos es sospechosa: no se pisa el archivo anterior

_FECHA_RI = ("CASE WHEN fh.parent_channel = 'API' AND fh.buy_type_code = 'Hoteles' "
             "THEN p.checkin_date ELSE fh.recognition_date END")
# Mismo filtro que _b2b_where_ri de daily_sync.py (con el mismo NOT: una fila sin estado ni fechas también queda afuera)
_EXCL_RI = ("(fh.parent_channel = 'API' AND COALESCE(cs.product_state, fh.product_status) = 'Cancelado' "
            "AND (p.product_cancel_date < p.checkin_date OR p.product_cancel_date IS NULL))")
_PRODUCTO = ("CASE fh.buy_type_code WHEN 'Hoteles' THEN 'Hoteles' WHEN 'Alquileres' THEN 'Hoteles' "
             "WHEN 'Vuelos' THEN 'Vuelos' WHEN 'Carrito' THEN 'Paquetes' ELSE 'Otros' END")
_CANAL = "CASE fh.parent_channel WHEN 'API' THEN 'API' ELSE 'HTML' END"
_JOINS = """FROM data.analytics.bi_sales_fact_sales_recognition fh
LEFT JOIN data.analytics.bi_transactional_fact_products p
  ON fh.product_id = p.product_id AND p.reservation_year_month >= CAST('2024-01-01' AS DATE)
LEFT JOIN data.analytics.bi_transactional_fact_products_current_state cs ON fh.product_id = cs.product_id
WHERE fh.partition_period > '2024-01-01' AND fh.line_of_business_code = 'B2B'"""


def _pais_expr(pais_case: str) -> str:
    return pais_case.strip().rsplit("AS pais", 1)[0]


def build_queries(pais_case: str, hasta: str):
    pais = _pais_expr(pais_case)
    q_cohortes = f"""
SELECT date_format(fh.gestion_date, '%Y-%m') AS mes_venta, {_CANAL} AS canal, {pais} AS pais, {_PRODUCTO} AS producto,
  CASE
    WHEN COALESCE(cs.product_state, fh.product_status) = 'Cancelado' THEN 'Cancelado'
    WHEN COALESCE(cs.product_state, fh.product_status) = 'Activo'    THEN 'Pendiente'
    WHEN {_FECHA_RI} <= DATE '{hasta}'                                THEN 'Reconocido'
    ELSE 'A reconocer'
  END AS etapa,
  SUM(fh.gestion_gb) AS gb_bruto,
  SUM(fh.gestion_gb * fh.confirmation_gradient) AS gb_gd
{_JOINS}
  AND fh.lob_gestion IN ('stg__sales_b2bnohoteldo', 'stg_sales__b2bhoteldo')
  AND fh.gestion_date BETWEEN DATE '{DESDE}' AND DATE '{hasta}'
GROUP BY 1, 2, 3, 4, 5"""
    q_ri = f"""
SELECT date_format({_FECHA_RI}, '%Y-%m') AS mes_ri, {_CANAL} AS canal, {pais} AS pais, {_PRODUCTO} AS producto,
  date_format(fh.gestion_date, '%Y-%m') AS mes_venta,
  SUM(fh.gestion_gb) AS gb_ri
{_JOINS}
  AND {_FECHA_RI} BETWEEN DATE '{DESDE}' AND DATE '{hasta}'
  AND NOT {_EXCL_RI}
GROUP BY 1, 2, 3, 4, 5"""
    q_cosecha = f"""
SELECT date_format(fh.gestion_date, '%Y-%m') AS mes_venta, date_format({_FECHA_RI}, '%Y-%m') AS mes_ri,
  {_CANAL} AS canal, {pais} AS pais, {_PRODUCTO} AS producto,
  SUM(fh.gestion_gb) AS gb_bruto
{_JOINS}
  AND fh.lob_gestion IN ('stg__sales_b2bnohoteldo', 'stg_sales__b2bhoteldo')
  AND fh.gestion_date BETWEEN DATE '{DESDE}' AND DATE '{hasta}'
  AND COALESCE(cs.product_state, fh.product_status) NOT IN ('Cancelado', 'Activo')
GROUP BY 1, 2, 3, 4, 5"""
    joins_pago = _JOINS.replace("WHERE", "LEFT JOIN pago ON pago.transaction_id = fh.origin_product_id\nWHERE", 1)
    q_pagos = f"""
WITH pago AS (
  SELECT transaction_id,
         max_by(payment_methods, CASE status WHEN 'EMITTED' THEN 3 WHEN 'ACTIVE' THEN 2 ELSE 1 END) AS medio
  FROM data.lake.channels_bo_product
  GROUP BY 1
)
SELECT date_format(fh.gestion_date, '%Y-%m') AS mes_venta, {pais} AS pais, {_PRODUCTO} AS producto,
  COALESCE(pago.medio, '') AS medio,
  CASE COALESCE(cs.product_state, fh.product_status) WHEN 'Cancelado' THEN 'Cancelado' WHEN 'Activo' THEN 'Pendiente'
       ELSE 'Confirmado' END AS estado,
  SUM(fh.gestion_gb) AS gb_bruto,
  SUM(fh.gestion_gb * fh.confirmation_gradient) AS gb_gd
{joins_pago}
  AND fh.lob_gestion IN ('stg__sales_b2bnohoteldo', 'stg_sales__b2bhoteldo')
  AND fh.parent_channel <> 'API'
  AND fh.gestion_date BETWEEN DATE '{DESDE}' AND DATE '{hasta}'
GROUP BY 1, 2, 3, 4, 5"""
    return q_cohortes, q_ri, q_cosecha, q_pagos


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    return 0 if math.isnan(f) else int(round(f))


def _table(df, dims, metrics):
    rows = []
    for r in df.to_dict("records"):
        vals = [_num(r.get(m)) for m in metrics]
        if not any(vals):
            continue
        rows.append([("" if r.get(d) is None or (isinstance(r.get(d), float) and math.isnan(r.get(d))) else str(r.get(d)))
                     for d in dims] + vals)
    rows.sort()
    return {"cols": dims + metrics, "rows": rows}


def build_payload(fetch, pais_case: str, hasta=None):
    """fetch(query, label) -> DataFrame (el de daily_sync.py). None si alguna query no trae lo esperado (no se pisa nada)."""
    hasta = str(hasta or (date.today() - timedelta(days=1)))
    q_coh, q_ri, q_cos, q_pag = build_queries(pais_case, hasta)
    coh = fetch(q_coh, "Embudo B2B (ventas por estado)")
    ri = fetch(q_ri, "Embudo B2B (RI por mes de venta)")
    cos = fetch(q_cos, "Embudo B2B (cosecha venta -> reconocimiento)")
    pag = fetch(q_pag, "Embudo B2B (HTML por medio de pago)")
    for nombre, df in (("ventas", coh), ("RI", ri), ("cosecha", cos), ("medios de pago", pag)):
        if df is None or len(df) < MIN_ROWS:
            print(f"  WARN Embudo B2B: {nombre} trajo {0 if df is None else len(df)} filas (mínimo {MIN_ROWS}) — queda el archivo anterior")
            return None
    return {
        "actualizado": date.today().isoformat(),
        "hasta": hasta,
        "desde": DESDE,
        "nota": "Generado por Daily_Dashboard/embudo_b2b_sync.py con las reglas B2B de daily_sync.py (GD y RI).",
        "cohortes": _table(coh, ["mes_venta", "canal", "pais", "producto", "etapa"], ["gb_bruto", "gb_gd"]),
        "ri": _table(ri, ["mes_ri", "canal", "pais", "producto", "mes_venta"], ["gb_ri"]),
        "cosecha": _table(cos, ["mes_venta", "mes_ri", "canal", "pais", "producto"], ["gb_bruto"]),
        "pagos": _table(pag, ["mes_venta", "pais", "producto", "medio", "estado"], ["gb_bruto", "gb_gd"]),
    }


if __name__ == "__main__":
    args = sys.argv[1:]   # (la salida en UTF-8 la configura industry_events_sync al importarse)
    out = args[args.index("--out") + 1] if "--out" in args else None
    hasta = args[args.index("--hasta") + 1] if "--hasta" in args else None
    sys.argv = sys.argv[:1]   # daily_sync.py lee sys.argv al cargarse
    sys.path.insert(0, str(BASE))
    import industry_events_sync as _ies   # carga las definiciones de daily_sync.py (conexión, fetch y país) sin correr la sync
    ds = _ies._defs_daily_sync()
    payload = build_payload(ds["fetch"], ds["_B2B_PAIS_CASE"], hasta or ds["YESTERDAY"])
    if payload is None:
        raise SystemExit(1)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    n = " + ".join(str(len(payload[k]["rows"])) for k in ("cohortes", "ri", "cosecha", "pagos")) + f" filas, hasta {payload['hasta']}"
    if out:
        Path(out).write_text(text, encoding="utf-8")
        print(f"  OK: {n} -> {out} ({len(text) / 1e6:.1f} MB)")
    else:
        print(f"  OK: {n} (usar --out archivo.json para guardarlo)")
