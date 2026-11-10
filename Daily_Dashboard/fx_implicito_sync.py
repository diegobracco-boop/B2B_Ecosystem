# -*- coding: utf-8 -*-
"""
fx_implicito_sync.py — TC implícito del mes en curso para el Organic del Daily (2026-11-09, Diego, opción A)
=========================================================================================================
El organic del Daily usa tc_plana_flat.xlsx. Para los meses abiertos (después de LAST_CLOSED_MONTH) ese archivo trae el
TC proyectado del Run Rate, que se aleja del real (nov-26: BRL 5.17 proyectado vs 5.47 real; MXN 17.69 vs 18.66). Este
módulo calcula el TC con el que Data Lake pasó a USD las ventas B2C del mes, por país:

    TC implícito = Σ c.gross_booking_local_currency / Σ c.gross_booking      (bi_transactional_fact_charges)

Los dos montos son de la misma tabla y con la misma definición (el cociente es exactamente local_conversion_rate
ponderado por GB). NO se divide por gb_without_distorted_taxes_usd: en Argentina saca los impuestos distorsivos y el TC
daba 7% más bajo (oct-26: 1,431 vs 1,523).

Solo los meses abiertos: los cerrados y el LY siguen con el TC oficial del archivo (así el Daily cierra con el Hub y el
P&L). Validado 2026-11-09: oct-25 implícito vs oficial entre −0.9% y +1.6% por país.

Sale en fx_implicito.json (carpeta del Daily). Lo lee readFxTable_ (Daily_Dashboard/Codigo_organic.js) y pisa
fx.actuals de esos meses, así lo usan todos los organic del Daily (navegador, Weekly, resumen semanal, Industry events).
Como la recurrencia y los Overs: no va a _FAILED_BLOCKS; si falla queda el archivo anterior.

Run manual: py fx_implicito_sync.py [--no-upload]
"""
import io
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

FX_IMPL_FILE_NAME = "fx_implicito.json"
DRIVE_FOLDER_ID = "1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh"   # misma carpeta que los JSON del Daily

# ISO-2 → nombre normalizado como en tc_plana_flat (_fxNorm_: minúsculas, sin acentos). Ecuador está en USD: no aplica.
PAISES = {"AR": "argentina", "BR": "brasil", "CL": "chile", "CO": "colombia", "MX": "mexico", "PE": "peru", "UY": "uruguay"}


def last_closed_month() -> str:
    """'YYYY-MM' del último mes cerrado (LAST_CLOSED_MONTH de Inputs_Planning_PnL/config.py, sin importarlo)."""
    cfg = Path(__file__).resolve().parents[1] / "Inputs_Planning_PnL" / "config.py"
    try:
        m = re.search(r'^LAST_CLOSED_MONTH\s*=\s*"(\d{4}-\d{2})', cfg.read_text(encoding="utf-8"), re.M)
        if m:
            return m.group(1)
    except OSError:
        pass
    y = date.today() - timedelta(days=1)   # sin config: el mes anterior al de ayer
    return f"{y.year - (y.month == 1)}-{(y.month - 2) % 12 + 1:02d}"


def _next_month(ym: str) -> date:
    y, m = int(ym[:4]), int(ym[5:7])
    return date(y + (m == 12), m % 12 + 1, 1)


def build_query(desde: date, hasta: date) -> str:
    paises = ",".join(f"'{p}'" for p in PAISES)
    return f"""
SELECT
    t.country_code                                AS pais,
    date_format(t.confirmation_date, '%Y-%m')     AS ym,
    SUM(c.gross_booking_local_currency)           AS gb_local,
    SUM(c.gross_booking)                          AS gb_usd
FROM analytics.bi_transactional_fact_products p
    INNER JOIN analytics.bi_transactional_fact_transactions t
        ON t.transaction_code = p.transaction_code
    INNER JOIN analytics.bi_transactional_fact_charges c
        ON CAST(p.product_id AS VARCHAR) = CAST(c.product_id AS VARCHAR)
WHERE p.reservation_year_month_period >= '{desde.year - 1}'
    AND t.reservation_year_month_period >= '{desde.year - 1}'
    AND p.reservation_year_month >= DATE('{desde.year - 1}-01-01')
    AND t.reservation_year_month >= DATE('{desde.year - 1}-01-01')
    AND c.reservation_year_month >= DATE('{desde.year - 1}-01-01')
    AND t.confirmation_date >= DATE('{desde}')
    AND t.confirmation_date <= DATE('{hasta}')
    AND p.is_confirmed_flg = 1
    AND (t.line_of_business = 'B2C' OR t.channel = 'puntosbonus-pe')
    AND t.channel <> 'internal-travel'
    AND c.gross_booking > 0
    AND t.local_currency_code <> 'USD'
    AND t.country_code IN ({paises})
GROUP BY 1, 2
ORDER BY 1, 2
"""


def build_fx_implicito(fetch, hasta: date = None) -> dict:
    """fetch(query, label) -> DataFrame (el de daily_sync). hasta = último día con reales (ayer)."""
    hasta = hasta or (date.today() - timedelta(days=1))
    cerrado = last_closed_month()
    desde = _next_month(cerrado)
    meta = {"generated_at": datetime.now().isoformat(timespec="seconds"), "last_closed": cerrado,
            "hasta": str(hasta),
            "fuente": "B2C: sum(c.gross_booking_local_currency) / sum(c.gross_booking), bi_transactional_fact_charges",
            "uso": "pisa el TC Actuals de tc_plana_flat solo en los meses abiertos (organic del Daily)"}
    if desde > hasta:
        return {"meta": meta, "rates": {}, "detalle": []}
    df = fetch(build_query(desde, hasta), "TC implícito B2C (mes abierto)")
    df.columns = [c.lower() for c in df.columns]
    rates, detalle = {}, []
    for r in df.itertuples(index=False):
        gl, gu = float(r.gb_local or 0), float(r.gb_usd or 0)
        if gu < 50_000 or gl <= 0:   # muy poca venta: el promedio no es confiable, queda el TC del archivo
            continue
        tc = gl / gu
        rates[f"{PAISES[r.pais]}§{r.ym}"] = round(tc, 6)
        detalle.append({"pais": PAISES[r.pais], "ym": r.ym, "tc": round(tc, 6), "gb_usd": round(gu, 2)})
    return {"meta": meta, "rates": rates, "detalle": detalle}


def upload(payload: dict, service=None) -> None:
    from googleapiclient.http import MediaIoBaseUpload
    from recurrencia_sync import drive_service
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Ownia_B2B_Ecosystem" / "mirror"))
    from ownia_publish import DRIVE_FIELDS, publish_after_drive   # doble escritura Drive + Ownia

    service = service or drive_service()
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    media = MediaIoBaseUpload(io.BytesIO(body), mimetype="application/json", resumable=False)
    found = service.files().list(
        q=f"name='{FX_IMPL_FILE_NAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false",
        fields="files(id)").execute().get("files", [])
    if found:
        res = service.files().update(fileId=found[0]["id"], media_body=media, fields=DRIVE_FIELDS).execute()
        print(f"  OK Drive: actualizado {FX_IMPL_FILE_NAME}")
    else:
        res = service.files().create(body={"name": FX_IMPL_FILE_NAME, "parents": [DRIVE_FOLDER_ID]},
                                     media_body=media, fields=DRIVE_FIELDS).execute()
        print(f"  OK Drive: creado {FX_IMPL_FILE_NAME}")
    publish_after_drive(res, body)


if __name__ == "__main__":
    from recurrencia_sync import _fetch_standalone
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    p = build_fx_implicito(_fetch_standalone)
    print(json.dumps(p["meta"], ensure_ascii=False))
    for d in p["detalle"]:
        print(f"  {d['pais']:<10} {d['ym']}  TC {d['tc']:>12,.4f}  GB USD {d['gb_usd'] / 1e6:,.1f}M")
    if "--no-upload" not in sys.argv:
        upload(p)
