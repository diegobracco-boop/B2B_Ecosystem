# -*- coding: utf-8 -*-
"""
cruceros_sync.py — Reales de Cruceros B2B Brasil para el Daily (2026-11-19, pedido de antonella.difranco)
=========================================================================================================
Cruceros no está en el Datalake: sale del export de la plataforma de cruceros ("booking-report-*.csv", separador ;,
decimales con coma, latin-1). daily_sync.py lo suma como filas extra de los reales B2B (GD y RI) con:

    pais = Brasil · parent_channel = Agencias afiliadas · producto_original = Cruises
    orders = reservas · gross_bookings = Total en USD · net_revenue = fvm = 0 (el CSV no trae el ingreso de Despegar)

Filtro: Status = Confirmado y Reserva Teste != Sim (las canceladas, en error, aguardando y presupuestos quedan afuera).
Fecha: GD = Data Confirmacao; RI = Data Embarque (solo embarques hasta ayer).
Moneda: Cotacao = 1 → Total en BRL, se pasa a USD con el TC implícito B2C de Brasil del mes de confirmación
(misma query que fx_implicito_sync.py). Cotacao != 1 (Princess, Holland America) → el Total ya viene en USD.

El CSV vive en la carpeta de Drive del Daily como CRUCEROS_CSV_NAME. Para cambiarlo:
    py cruceros_sync.py <ruta_csv> --upload     (sube/pisa el archivo en Drive)
    py cruceros_sync.py <ruta_csv>              (solo muestra el resumen, sin Datalake: TC fijo de referencia)
Para probar daily_sync con un CSV local sin tocar Drive: CRUCEROS_CSV=<ruta> en el entorno.
Si el archivo no está o falla la lectura, el Daily sigue sin cruceros (WARN, no va a _FAILED_BLOCKS).
"""
import io
import os
import sys
from datetime import date
from pathlib import Path

import pandas as pd

CRUCEROS_CSV_NAME = "cruceros_booking_report.csv"
DRIVE_FOLDER_ID = "1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh"   # misma carpeta que los JSON del Daily

PAIS = "Brasil"
CANAL = "Agencias afiliadas"
PRODUCTO = "Cruises"


def _num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s.astype(str).str.strip().str.replace(".", "", regex=False).str.replace(",", "."),
                         errors="coerce")


def _fecha(s: pd.Series) -> pd.Series:
    # Formato fijo dd/mm/aaaa hh:mm:ss: nunca dejar que pandas adivine (ver CLAUDE.md, fechas ISO invertidas)
    return pd.to_datetime(s.astype(str).str.strip().str[:10], format="%d/%m/%Y", errors="coerce")


def parse_csv(raw: bytes) -> pd.DataFrame:
    """Reservas confirmadas (sin prueba) con fecha_gd, fecha_ri, total, en_usd."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    df = pd.read_csv(io.StringIO(text), sep=";", dtype=str)
    df.columns = [c.strip() for c in df.columns]
    falta = {"Status", "Reserva Teste", "Data Confirmacao", "Data Embarque", "Total", "Cotacao"} - set(df.columns)
    if falta:
        raise ValueError(f"al CSV de cruceros le faltan columnas: {sorted(falta)}")
    ok = (df["Status"].str.strip() == "Confirmado") & ~df["Reserva Teste"].str.strip().str.lower().isin(["sim", "si", "yes"])
    df = df[ok]
    out = pd.DataFrame({
        "fecha_gd": _fecha(df["Data Confirmacao"]),
        "fecha_ri": _fecha(df["Data Embarque"]),
        "total":    _num(df["Total"]).fillna(0.0),
        # Cotacao nunca trae miles: solo coma o punto decimal ("1,000000000", "5,5", "1.0")
        "en_usd":   (pd.to_numeric(df["Cotacao"].astype(str).str.strip().str.replace(",", "."), errors="coerce")
                     .fillna(1.0) - 1.0).abs() > 1e-9,
    })
    return out[out["fecha_gd"].notna()].reset_index(drop=True)


def tc_brasil(fetch, desde: date, hasta: date) -> dict:
    """{'YYYY-MM': BRL por USD} con el TC implícito B2C de Brasil (fx_implicito_sync.build_query)."""
    from fx_implicito_sync import build_query
    df = fetch(build_query(desde, hasta), "TC Brasil (cruceros)")
    df.columns = [c.lower() for c in df.columns]
    df = df[df["pais"] == "BR"]
    return {r.ym: float(r.gb_local) / float(r.gb_usd) for r in df.itertuples(index=False)
            if float(r.gb_usd or 0) > 0 and float(r.gb_local or 0) > 0}


def _tc_de(ym: str, rates: dict) -> float:
    if ym in rates:
        return rates[ym]
    previos = sorted(k for k in rates if k <= ym) or sorted(rates)   # mes sin TC: el más cercano anterior
    return rates[previos[-1]]


def to_b2b_rows(res: pd.DataFrame, rates: dict, vista: str, desde: date, hasta: date) -> pd.DataFrame:
    """Filas con COLS_B2B + director para concatenar a df_b2b_gd / df_b2b_ri. vista = 'gd' | 'ri'."""
    cols = ["fecha", "pais", "producto_original", "parent_channel", "viaje", "product_type",
            "orders", "gross_bookings", "net_revenue", "fvm", "director"]
    f = res["fecha_gd" if vista == "gd" else "fecha_ri"]
    d = res[f.notna() & (f.dt.date >= desde) & (f.dt.date <= hasta)].copy()
    if d.empty:
        return pd.DataFrame(columns=cols)
    d["fecha"] = f.loc[d.index].dt.strftime("%Y-%m-%d")
    ym_conf = d["fecha_gd"].dt.strftime("%Y-%m")   # el TC es el del mes de venta (confirmación), también en RI
    tc = ym_conf.map(lambda ym: _tc_de(ym, rates))
    d["gross_bookings"] = d["total"].where(d["en_usd"], d["total"] / tc)
    g = d.groupby("fecha", as_index=False).agg(orders=("total", "size"), gross_bookings=("gross_bookings", "sum"))
    g["gross_bookings"] = g["gross_bookings"].round(0).astype(int)
    g = g.assign(pais=PAIS, producto_original=PRODUCTO, parent_channel=CANAL, viaje="N/A", product_type="N/A",
                 net_revenue=0, fvm=0, director="Sin director")
    return g[cols]


def load_csv_bytes(drive_service=None) -> bytes:
    """CRUCEROS_CSV (ruta local) si está seteada; si no, el archivo de la carpeta del Daily en Drive."""
    local = os.getenv("CRUCEROS_CSV", "")
    if local:
        return Path(local).read_bytes()
    service = drive_service
    found = service.files().list(
        q=f"name='{CRUCEROS_CSV_NAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false",
        fields="files(id)").execute().get("files", [])
    if not found:
        raise FileNotFoundError(f"no está {CRUCEROS_CSV_NAME} en la carpeta del Daily")
    return service.files().get_media(fileId=found[0]["id"]).execute()


def build(fetch, drive_service, desde: date, hasta: date) -> tuple:
    """(df_gd, df_ri) listos para concatenar a los reales B2B del Daily."""
    res = parse_csv(load_csv_bytes(drive_service))
    rates = tc_brasil(fetch, min(desde, res["fecha_gd"].min().date()), hasta) if not res.empty else {}
    if not res.empty and not rates and not res["en_usd"].all():
        raise RuntimeError("sin TC de Brasil para pasar los BRL a USD")
    gd = to_b2b_rows(res, rates, "gd", desde, hasta)
    ri = to_b2b_rows(res, rates, "ri", desde, hasta)
    print(f"  Cruceros: {len(res):,} reservas confirmadas | GD {gd['orders'].sum():,} órd. USD {gd['gross_bookings'].sum():,.0f}"
          f" | RI {ri['orders'].sum():,} órd. USD {ri['gross_bookings'].sum():,.0f}")
    return gd, ri


def upload(path: str) -> None:
    from googleapiclient.http import MediaIoBaseUpload
    from recurrencia_sync import drive_service
    service = drive_service()
    media = MediaIoBaseUpload(io.BytesIO(Path(path).read_bytes()), mimetype="text/csv", resumable=False)
    found = service.files().list(
        q=f"name='{CRUCEROS_CSV_NAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false",
        fields="files(id)").execute().get("files", [])
    if found:
        service.files().update(fileId=found[0]["id"], media_body=media).execute()
        print(f"  OK Drive: actualizado {CRUCEROS_CSV_NAME}")
    else:
        service.files().create(body={"name": CRUCEROS_CSV_NAME, "parents": [DRIVE_FOLDER_ID]},
                               media_body=media).execute()
        print(f"  OK Drive: creado {CRUCEROS_CSV_NAME}")


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit("uso: py cruceros_sync.py <ruta_csv> [--upload]")
    res = parse_csv(Path(args[0]).read_bytes())
    ref = {"2026-01": 5.40}   # TC de referencia SOLO para este resumen; el Daily usa el implícito del Datalake
    gd = to_b2b_rows(res, ref, "gd", date(2000, 1, 1), date.today())
    gd["mes"] = gd["fecha"].str[:7]
    print(f"{len(res):,} reservas confirmadas (sin prueba). GD por mes (TC ref. 5.40):")
    print(gd.groupby("mes")[["orders", "gross_bookings"]].sum().to_string())
    if "--upload" in sys.argv:
        upload(args[0])
