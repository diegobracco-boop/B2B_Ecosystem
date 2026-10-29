"""
ub_rolling.py
Unique Buyers "mes movil" (2026-10-29): compradores unicos White Label de los ultimos N dias hasta el ultimo
dia con real, con N = dias del mes de ese ultimo dia (31 en octubre, 30 en noviembre). okr_builder.py lo usa
como valor del mes en curso del KR Unique Buyers en vez del MTD, que hasta fin de mes queda corto contra un
target mensual. Validado contra meses cerrados: la ventana de N dias que termina el ultimo dia del mes da
exacto el distinct mensual (ago-26 106.241, sep-26 101.137); con 30 dias fijos un mes de 31 da ~3% menos.

daily_sync.py lo publica en daily_b2b2c_data.json ("unique_buyers_rolling"). Correr este modulo suelto
recalcula solo ese bloque en el JSON del Daily (Drive + Ownia) sin la corrida completa:
    python ub_rolling.py
"""
import calendar
from datetime import date, timedelta

DAILY_B2B2C_FILE_ID = "1Ukcx4e-dwCZ2VqesWwVN_1Jnt6r2AZdX"   # daily_b2b2c_data.json
_DAILY_MAX_BYTES = 48_000_000                              # getBlob() de Apps Script corta en 50 MB


def window(hasta: date):
    n = calendar.monthrange(hasta.year, hasta.month)[1]
    return hasta - timedelta(days=n - 1), n


def query(desde: date, hasta: date) -> str:
    # mismo universo que UB_TOTAL_QUERY de daily_sync.py; el filtro por reservation_year_month poda particiones
    return f"""
SELECT COUNT(DISTINCT u.social_id) AS clientes_unicos
FROM data.analytics.mkt_users_fact_transactions u
WHERE u.parent_channel = 'White Label'
  AND u.transaction_status = 'Confirmado'
  AND u.reservation_year_month >= '{desde:%Y-%m}'
  AND CAST(u.reservation_datetime AS DATE) BETWEEN DATE '{desde}' AND DATE '{hasta}'
"""


def build(fetch, hasta: date) -> dict:
    """fetch(query, label) -> DataFrame (el de daily_sync.py). hasta = ultimo dia con real."""
    desde, n = window(hasta)
    v = int(fetch(query(desde, hasta), f"Unique Buyers ultimos {n} dias").iloc[0, 0])
    return {"ym": f"{hasta:%Y-%m}", "desde": str(desde), "hasta": str(hasta), "dias": n, "valor": v}


def _main():
    import io
    import json
    import os
    import sys
    from pathlib import Path

    import pandas as pd
    import pyodbc
    from dotenv import load_dotenv
    from googleapiclient.http import MediaInMemoryUpload, MediaIoBaseDownload

    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / "credenciales" / f".env.{os.environ.get('USERNAME', '').lower()}")
    sys.path.insert(0, str(root / "Inputs_Planning_PnL"))
    sys.path.insert(0, str(root / "Ownia_B2B_Ecosystem" / "mirror"))
    import pnl_common
    from ownia_publish import DRIVE_FIELDS, publish_after_drive   # doble escritura Drive + Ownia

    svc = pnl_common.get_drive_service()
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, svc.files().get_media(fileId=DAILY_B2B2C_FILE_ID), chunksize=16 * 1024 * 1024)
    done = False
    while not done:
        _, done = dl.next_chunk()
    raw = buf.getvalue()
    data = json.loads(raw)
    hasta = date.fromisoformat(data["meta"]["last_actuals_date"])

    con = pyodbc.connect(f"DSN=DataLake Treasure ODBC;UID={os.getenv('USER')};PWD={os.getenv('PASSWORD')};", autocommit=True)
    ub = build(lambda q, label: pd.read_sql(q, con), hasta)
    print(f"  [UB mes movil] {ub['desde']}..{ub['hasta']} ({ub['dias']} dias): {ub['valor']:,}")
    if ub == data.get("unique_buyers_rolling"):
        print("  [UB mes movil] daily_b2b2c_data.json ya lo tenia")
        return
    data["unique_buyers_rolling"] = ub
    txt = json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    if len(txt) > _DAILY_MAX_BYTES or len(txt) < len(raw) * 0.9:
        sys.exit(f"  no se sube: {len(txt)/1e6:.1f} MB contra {len(raw)/1e6:.1f} MB del archivo actual")
    res = svc.files().update(fileId=DAILY_B2B2C_FILE_ID, media_body=MediaInMemoryUpload(txt, mimetype="application/json", resumable=True),
                             fields=DRIVE_FIELDS).execute()
    print("  [UB mes movil] actualizado en daily_b2b2c_data.json")
    publish_after_drive(res, txt)


if __name__ == "__main__":
    _main()
