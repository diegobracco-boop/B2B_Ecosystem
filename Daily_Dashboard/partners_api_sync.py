# -*- coding: utf-8 -*-
"""
partners_api_sync.py
====================
KR "Accelerate Hunting Partners API" (H2 FY27, KR Global B2B API): cantidad de partners API que operan en el mes.

Definicion (2026-10-27, Diego):
  - Solo canal API (parent_channel = 'API'); las agencias afiliadas quedan afuera (ya no hay reparto entre canales).
  - Un partner cuenta UNA vez por mes: se agrupan sus codigos con el diccionario (Diccionario_partners_api.xlsx, hoja Partners;
    p. ej. Hotelbeds = 10 codigos) y se cuentan los partners con al menos un producto NO cancelado (Confirmado o Activo) reservado en el mes.
  - Los codigos que no estan en el diccionario cuentan como partner propio (con el codigo como nombre) y se avisan.
  - Fecha = booking_date (fecha de reserva), igual que la query del Excel de agencias (Metabase 88479).

Congelado (el estado de las ordenes muta con el tiempo: se cancelan despues):
  - El valor de un mes se congela el primer dia habil del mes siguiente y NO se vuelve a tocar (partners_api_snapshots.json en la carpeta
    de Drive del Daily; solo se agregan meses nuevos). daily_sync.py lo llama en cada corrida: congela el mes anterior la primera vez que
    corre un dia habil (lunes a viernes) de los primeros 7 dias del mes. Si no pudo (esa semana no corrio), AVISA y se congela a mano:
        python partners_api_sync.py --freeze 2026-10
  - Mientras el mes no esta congelado el KR muestra "ultimos 30 dias" (movil): partners distintos con reservas no canceladas entre hoy-30 y ayer,
    recalculado en cada corrida.
  - Solo se congelan meses desde 2026-10 (DESDE): H1 y septiembre no se tocan.

Uso suelto:
    python partners_api_sync.py --validate 2026-09     # cuenta un mes y lo imprime (sin tocar Drive)
    python partners_api_sync.py --rolling              # cuenta los ultimos 30 dias (sin tocar Drive)
    python partners_api_sync.py --freeze 2026-10       # congela un mes a mano en Drive (falla si ya esta congelado)
    python partners_api_sync.py --publish              # lo mismo que hace daily_sync.py en cada corrida (congela si toca + rolling) y sube a Drive
"""
import io
import json
import os
import sys
from calendar import monthrange
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parent / "Inputs_Planning_PnL"))
import pnl_common  # noqa: E402

SNAPSHOT_FILE_NAME = "partners_api_snapshots.json"
DICT_PATH = os.path.join(pnl_common.get_base_dir(), "OKR", "Diccionario_partners_api.xlsx")
DESDE = "2026-10"          # primer mes que se congela
FREEZE_MAX_DAY = 7         # el congelado automatico solo corre en los primeros 7 dias del mes
ROLLING_DAYS = 30

PAIS_NOMBRE = {"AR": "Argentina", "BR": "Brasil", "CL": "Chile", "CO": "Colombia", "EC": "Ecuador", "MX": "Mexico",
               "PE": "Peru", "UY": "Uruguay", "PY": "Paraguay", "OT": "Globales"}

# Misma poblacion que la query del Excel de agencias (Metabase 88479): ventas reconocidas B2B por fecha de reserva, solo API.
# Se omiten los joins a charges / pricing de la query original: no filtran, solo repiten filas y aca se cuentan partners distintos.
SQL = """
SELECT date_format(fv.booking_date, '%Y-%m')                                            AS ym,
       if(fv.country_code in ('AR','CO','EC','PE','BR','CL','MX','UY'), fv.country_code, 'OT') AS country,
       CASE WHEN length(fv.partner_id) > 0 THEN fv.partner_id ELSE fv.channel END       AS agency_code,
       fv.product_status                                                                AS product_status,
       COUNT(*)                                                                         AS n
FROM analytics.bi_sales_fact_sales_recognition fv
LEFT JOIN analytics.bi_pnlop_fact_current_model pnl
       ON fv.product_id = pnl.product_id AND pnl.date_reservation_year_month > '2021-01'
WHERE fv.booking_date >= DATE '{ini}' AND fv.booking_date < DATE '{fin_excl}'
  AND pnl.line_of_business = 'B2B'
  AND fv.partition_period > '2021-01'
  AND fv.parent_channel = 'API'
GROUP BY 1, 2, 3, 4
"""


def load_dictionary(path=DICT_PATH):
    """(nombre_final por codigo, pais forzado por codigo). Falla si el archivo no esta: no se congela con un diccionario vacio."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"no encuentro el diccionario de partners API: {path}")
    p = pd.read_excel(path, sheet_name="Partners", engine="openpyxl")
    pa = pd.read_excel(path, sheet_name="Paises", engine="openpyxl")
    nombres = dict(zip(p["partner_code"].astype(str).str.strip(), p["nombre_final"].astype(str).str.strip()))
    paises = dict(zip(pa["partner_code"].astype(str).str.strip(), pa["pais"].astype(str).str.strip()))
    return nombres, paises


def contar(df, nombres, paises):
    """df de SQL (ym, country, agency_code, product_status, n) -> {total, por_pais, partners, codigos, sin_diccionario}.
    total = partners distintos (por nombre final) con algun producto no cancelado; por_pais reparte la unidad de cada partner entre sus
    paises en proporcion a sus reservas, asi la suma por pais da el total."""
    d = df.copy()
    d["agency_code"] = d["agency_code"].astype(str).str.strip()
    d["n"] = pd.to_numeric(d["n"], errors="coerce").fillna(0)
    d = d[d["product_status"].astype(str).str.strip().str.lower() != "cancelado"]
    if d.empty:
        return {"total": 0.0, "por_pais": {}, "partners": 0, "codigos": 0, "sin_diccionario": []}
    # el nombre se normaliza (sin espacios de mas, sin distinguir mayusculas): "TripsnStay" y "Tripsnstay " son el mismo partner (como el Excel)
    d["nombre"] = d["agency_code"].map(nombres).fillna(d["agency_code"]).astype(str).str.split().str.join(" ").str.casefold()
    d["pais"] = d.apply(lambda r: paises.get(r["agency_code"], r["country"]), axis=1)
    d["pais"] = d["pais"].map(lambda c: PAIS_NOMBRE.get(c, c))
    g = d.groupby(["nombre", "pais"], as_index=False)["n"].sum()
    g["peso"] = g["n"] / g.groupby("nombre")["n"].transform("sum")
    por_pais = g.groupby("pais")["peso"].sum().round(3).sort_values(ascending=False).to_dict()
    sin = sorted(c for c in d["agency_code"].unique() if c not in nombres)
    return {"total": float(g["nombre"].nunique()), "por_pais": por_pais, "partners": int(g["nombre"].nunique()),
            "codigos": int(d["agency_code"].nunique()), "sin_diccionario": sin}


def _mes_rango(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    ini = date(y, m, 1)
    fin_excl = date(y, m, monthrange(y, m)[1]) + timedelta(days=1)
    return ini, fin_excl


def contar_mes(fetch, ym, nombres, paises):
    ini, fin = _mes_rango(ym)
    df = fetch(SQL.format(ini=ini, fin_excl=fin).strip().rstrip(";"), f"Partners API {ym}")
    return contar(df, nombres, paises)


def contar_rolling(fetch, hoy, nombres, paises):
    ini, fin = hoy - timedelta(days=ROLLING_DAYS), hoy       # ultimos 30 dias cerrados: hoy-30 .. ayer
    df = fetch(SQL.format(ini=ini, fin_excl=fin).strip().rstrip(";"), f"Partners API ultimos {ROLLING_DAYS} dias")
    r = contar(df, nombres, paises)
    r.update({"desde": str(ini), "hasta": str(fin - timedelta(days=1)), "calculado_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S")})
    return r


def _mes_anterior(hoy):
    u = hoy.replace(day=1) - timedelta(days=1)
    return f"{u.year}-{u.month:02d}"


def build_payload(fetch, prev, hoy=None):
    """Devuelve el JSON a publicar: los meses ya congelados SE CONSERVAN TAL CUAL (nunca se recalculan), se congela el mes anterior si
    corresponde y se recalcula el rolling de 30 dias. Si falta el diccionario no se hace nada (None)."""
    hoy = hoy or date.today()
    prev = prev or {}
    try:
        nombres, paises = load_dictionary()
    except Exception as e:
        print(f"  WARN [Partners API] {e} — no se congela ni se calcula el rolling")
        return None
    meses = dict(prev.get("meses") or {})
    ym = _mes_anterior(hoy)
    if ym >= DESDE and ym not in meses:
        if hoy.weekday() < 5 and hoy.day <= FREEZE_MAX_DAY:
            r = contar_mes(fetch, ym, nombres, paises)
            r.update({"congelado_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "congelado_el": str(hoy)})
            meses[ym] = r
            print(f"  [Partners API] {ym} CONGELADO el {hoy}: {r['total']:.0f} partners ({r['codigos']} codigos, "
                  f"{len(r['sin_diccionario'])} sin diccionario)")
        else:
            print(f"  AVISO [Partners API] {ym} sin congelar y hoy ({hoy}) no es dia habil de los primeros {FREEZE_MAX_DAY} del mes: "
                  f"congelarlo a mano  (python Daily_Dashboard/partners_api_sync.py --freeze {ym})")
    roll = contar_rolling(fetch, hoy, nombres, paises)
    sin = roll["sin_diccionario"]
    print(f"  [Partners API] ultimos {ROLLING_DAYS} dias ({roll['desde']} .. {roll['hasta']}): {roll['total']:.0f} partners"
          + (f" · {len(sin)} codigos sin diccionario (agruparlos en Diccionario_partners_api.xlsx): {sin[:6]}" if sin else ""))
    return {
        "meta": {"generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                 "definicion": "partners API distintos (por nombre final) con al menos un producto no cancelado reservado en el mes; congelado el primer dia habil del mes siguiente",
                 "diccionario": DICT_PATH},
        "meses": meses,
        "rolling30": roll,
    }


# ── uso suelto ─────────────────────────────────────────────────────────────────

def _fetch_standalone(query, label):
    from recurrencia_sync import _fetch_standalone as f
    return f(query, label)


DRIVE_FOLDER_ID = "1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh"   # carpeta de los JSON del Daily


def _drive_download(svc):
    from googleapiclient.http import MediaIoBaseDownload
    q = f"name='{SNAPSHOT_FILE_NAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false"
    f = svc.files().list(q=q, fields="files(id)").execute().get("files", [])
    if not f:
        return {}
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, svc.files().get_media(fileId=f[0]["id"]))
    done = False
    while not done:
        _, done = dl.next_chunk()
    return json.loads(buf.getvalue())


def _drive_upload(svc, payload):
    from googleapiclient.http import MediaInMemoryUpload
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    q = f"name='{SNAPSHOT_FILE_NAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false"
    f = svc.files().list(q=q, fields="files(id)").execute().get("files", [])
    media = MediaInMemoryUpload(data, mimetype="application/json", resumable=False)
    if f:
        svc.files().update(fileId=f[0]["id"], media_body=media).execute()
    else:
        svc.files().create(body={"name": SNAPSHOT_FILE_NAME, "parents": [DRIVE_FOLDER_ID]}, media_body=media, fields="id").execute()
    print(f"  OK Drive: {SNAPSHOT_FILE_NAME} ({len(data) / 1024:.1f} KB)")


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    args = sys.argv[1:]
    nombres, paises = load_dictionary()
    if "--validate" in args:
        ym = args[args.index("--validate") + 1]
        r = contar_mes(_fetch_standalone, ym, nombres, paises)
        print(f"\n{ym}: {r['total']:.0f} partners distintos · {r['codigos']} codigos · {len(r['sin_diccionario'])} sin diccionario")
        print("por pais:", r["por_pais"])
        print("sin diccionario:", r["sin_diccionario"][:20])
    elif "--publish" in args:
        from recurrencia_sync import drive_service
        svc = drive_service()
        payload = build_payload(_fetch_standalone, _drive_download(svc))
        if payload is not None:
            _drive_upload(svc, payload)
    elif "--rolling" in args:
        r = contar_rolling(_fetch_standalone, date.today(), nombres, paises)
        print(f"\nultimos {ROLLING_DAYS} dias ({r['desde']} .. {r['hasta']}): {r['total']:.0f} partners · por pais: {r['por_pais']}")
    elif "--freeze" in args:
        ym = args[args.index("--freeze") + 1]
        if ym < DESDE:
            sys.exit(f"Solo se congelan meses desde {DESDE}")
        from recurrencia_sync import drive_service
        svc = drive_service()
        prev = _drive_download(svc)
        if ym in (prev.get("meses") or {}):
            sys.exit(f"{ym} ya esta congelado ({prev['meses'][ym].get('congelado_el')}): no se vuelve a tocar")
        r = contar_mes(_fetch_standalone, ym, nombres, paises)
        r.update({"congelado_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "congelado_el": str(date.today()) + " (a mano)"})
        prev.setdefault("meses", {})[ym] = r
        prev.setdefault("meta", {})["generated_at"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        _drive_upload(svc, prev)
        print(f"{ym} congelado: {r['total']:.0f} partners")
    else:
        print(__doc__)
