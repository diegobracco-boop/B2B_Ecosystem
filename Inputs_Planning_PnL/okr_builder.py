"""
okr_builder.py
Genera okr.json combinando cinco fuentes:

  1. KRs B2B2C Op.Contribution + B2B NR Core/New Markets (mismo input contable
     que usa la landing P&L_Accounting)
       <- baseline_actuals+projections.json  → "Run Rate/Actuals"
       <- budget.json                        → "Budget"

  2. KRs B2B2C Hunting/Farming (New / Existing Account Net Revenues):
       Definición única de "hunting" = flag New/Existing de daily_b2b2c_data.json
       (account_type en actuals, stage en budget/runrate). 2026-08-30: se descartó
       la lista HUNTING_PARTNERS (coincidía ~2% con el flag para budget).
       <- daily_b2b2c_data.json .budget (stage=='New')                 → Hunting "Budget"
       <- daily_b2b2c_data.json .actuals (account_type=='New')          → Hunting "Run Rate/Actuals", meses cerrados
       <- daily_b2b2c_data.json .runrate (stage=='New'), fallback .budget → Hunting "Run Rate/Actuals", meses proyectados
       Existing = Total B2B2C NR contable (fuente 1) − Hunting.

  3. KRs manuales del GSheet "Input_OKR" (Sign New Partnership; Air Net Revenue
     from suppliers — manual hasta definir fuente, 2026-08-25).

  4. KR "Monthly Buying Agencies" (B2B): tracker en OneDrive
     (OKR/Agencies_tracker_okr.xlsx, formato ancho, fila Pais='Total') llenado a
     mano por el equipo — el estado de la orden en el datalake muta con el tiempo
     y hay que congelar el conteo del snapshot mensual.
     Vida útil hasta Sep-2026; desde Oct-2026 cambia la lógica.

  5. KR "Accelerate Recurrence" (B2B, H2): target y actual de Input_OKR, salvo el mes comercial en
     curso, cuyo actual es el Rolling L4W de recurrencia_b2b.json (Daily, card Metabase 171400).

Mismo criterio que Dashboard_B2B_WLs/Codigo_OKR.js (computeOKR_), consolidado acá para
que la landing deje de calcular todo en vivo y solo lea este JSON.

Uso:
    python okr_builder.py
    python okr_builder.py --no-upload
"""

import os, sys, io, json, re, argparse
from datetime import datetime
from collections import defaultdict

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import config
import pnl_common
import okr_h2_builder as h2b   # OKR_H2_FY27.json + Unique Buyers proyectado

DIR             = os.path.dirname(os.path.abspath(__file__))
OUTPUT_NAME     = "okr.json"
DRIVE_FOLDER_ID = config.DRIVE_FOLDER_ID

# ── IDs Drive ──────────────────────────────────────────────────────────────────
GESTIONAL_FILE_ID  = "1wvle0UIVZV7ocCSl8OawOfIGVz_It5kh"   # _pnl_gestional_data.json (solo para 'last_actual_ym' = corte de actuals)
BASELINE_FILE_ID   = "1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv"   # baseline_actuals+projections.json
BUDGET_FILE_ID     = "1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW"   # budget.json
DAILY_B2B2C_FILE_ID = "1Ukcx4e-dwCZ2VqesWwVN_1Jnt6r2AZdX"  # daily_b2b2c_data.json (transaccional)
RECUR_FILE_ID      = "1UI-azcvvJ9MIyOZOft94vhbBibuZ0aa0"   # recurrencia_b2b.json (Daily, recurrencia_sync.py)
OKR_FILE_ID        = "1cEidr8aoYgm4S7ugm05Wv-SMnz8GbtUj"   # okr.json (output)
# H1 FY27 (abr-sep 2026) está CERRADO y congelado en OKR_H1_FY27.json (ver okr_h1_freeze.py): okr_builder ya no lo
# recalcula, copia esas filas tal cual. Solo se calcula de H1_END en adelante (H2).
OKR_H1_FILE_ID     = "1wMCfuE8m8slzTN0CrWzoxJjTWOT9IMcf"   # OKR_H1_FY27.json
H1_END             = "2026-09-01"                          # último Periodo de H1 (inclusive)

SHEET_ID    = "1RVmTXDyyugCUXJ0f6JG_croNxWNLlOLm4eAs8F52u2c"
SHEET_RANGE = "Input_OKR"
SHEET_GID   = "1289400377"   # gid de la pestaña Input_OKR (para el fallback CSV de _read_sheet)

# KR "Monthly Buying Agencies" (B2B): tracker en OneDrive llenado a mano por el
# equipo. El estado de la orden en el datalake muta con el tiempo → hay que
# congelar el conteo del snapshot mensual. Formato ancho: filas escenario×pais,
# columnas = meses. Se lee solo la fila Pais='Total'.
# Indicador con vida hasta Sep-2026; desde Oct-2026 cambia la lógica.
AGENCIAS_TRACKER = os.path.join(pnl_common.get_base_dir(), "OKR", "Agencies_tracker_okr.xlsx")

COLS_OUT = ["Periodo", "Escenario", "LoB", "Pais", "Producto", "KR", "Valor"]

# ── Segmentación de mercados B2B (2026-08-30 — Diego) ──
#   Core Markets = Brasil + Mexico + Others Countries (el canónico lo emite
#                  "others countries"; se aceptan ambas grafías).
#   New Markets  = TODO lo demás, incluido OPS/RG (su NR debería tender a cero).
CORE_MARKETS = {"brasil", "mexico", "other countries", "others countries"}

# KRs que vienen del GSheet Input_OKR (manuales) — el resto se calcula.
# Air Net Revenue from suppliers: manual hasta que el equipo defina de dónde sale (2026-08-25).
# Monthly Buying Agencies: NO va acá — se lee de AGENCIAS_FLAT (ver _read_agencias_flat).
MANUAL_KRS = {
    "Sign New Partnership",
    "Air Net Revenue from suppliers",
    # H2 FY27 (oct-26 → mar-27): target Y actual salen de Input_OKR (definido 2026-09-24).
    # A futuro el actual pasará a calcularse con queries; el target seguirá en la sheet.
    "Deploy New Partnership",
    "Unique Buyers",
    "Accelerate Recurrence",
    # KR Global B2B API (H2, redefinidos 2026-10-21): target y actual en la sheet, LoB='Globales'.
    # El 6to KR (Net Revenues API Hoteles) se calcula del contable (ver _compute_from_canonical).
    "Accelerate Hunting Partners API",
    "Hoteles Directos vendidos destino LATAM",
    "% Hoteles Directos vendidos destino Globales",
    "New Onboarded Properties Global & Regional Chains",
    "Price Competitiveness ex-Latam (Destino GL)",
    # Grafías alternativas (la de la sheet vieja y la de la slide del OKR) → ver KR_CANON.
    "Hoteles Directo Vendidos destino LATAM",
    "Accelerate Hunting # Partners API",
}
MANUAL_KRS_LC = {k.lower() for k in MANUAL_KRS}   # el match es case-insensitive

# Grafías alternativas de la sheet → nombre canónico. Se normaliza ANTES del dedupe y del
# emit: si no, "Directo Vendidos" y "Directos vendidos" son claves distintas, pasan el dedupe
# y la landing (que las mapea al mismo KR) las suma → valor doble.
KR_CANON = {
    "hoteles directo vendidos destino latam": "Hoteles Directos vendidos destino LATAM",
    "accelerate hunting # partners api":      "Accelerate Hunting Partners API",
}

# Si en la sheet estos KRs vienen con LoB='B2B', el OKR igual los agrupa en 'Globales'.
GLOBALES_KRS_LC = {k.lower() for k in MANUAL_KRS if k.lower().startswith(
    ("accelerate hunting", "hoteles directo", "% hoteles directos", "new onboarded properties", "price competitiveness"))}

# KR Global B2B API "Net Revenues API Hoteles" = canal API ('may') + producto Hotels, TODOS los países
# (2026-10-23: el target es de todo API, no solo de Others Countries). Misma definición que el tab
# "KR Global B2B API" del Daily/Tracker.
GLOBALES_PRODUCTOS = {"hotels", "hotel"}


# ── Drive helpers ──────────────────────────────────────────────────────────────

def _download_json(svc, file_id, label):
    from googleapiclient.http import MediaIoBaseDownload
    buf = io.BytesIO()
    dl  = MediaIoBaseDownload(buf, svc.files().get_media(fileId=file_id),
                              chunksize=8 * 1024 * 1024)
    done = False
    while not done:
        _, done = dl.next_chunk()
    buf.seek(0)
    data = json.load(buf)
    print(f"  [Drive] {label}: OK")
    return data


def _upload(local_path, svc):
    from googleapiclient.http import MediaFileUpload
    import sys as _sys
    from pathlib import Path as _Path
    _sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "Ownia_B2B_Ecosystem" / "mirror"))
    from ownia_publish import DRIVE_FIELDS, publish_after_drive   # doble escritura Drive + Ownia
    pnl_common.guard_shrink(svc, OKR_FILE_ID, os.path.getsize(local_path), OUTPUT_NAME)
    media = MediaFileUpload(local_path, mimetype="application/json", resumable=True)
    res = svc.files().update(fileId=OKR_FILE_ID, media_body=media,
                              fields=DRIVE_FIELDS + ",size").execute()
    print(f"  [Drive] actualizado {OUTPUT_NAME}: id={res['id']}  size={res.get('size','?')}")
    with open(local_path, "rb") as _f:
        publish_after_drive(res, _f.read())


H2_OUTPUT_NAME = "OKR_H2_FY27.json"
DAILY_FOLDER_ID = "1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh"   # carpeta de los JSON del Daily (okr_h2_managerial.json, ...)


def _download_by_name(svc, folder_id, name, label):
    q = f"name='{name}' and '{folder_id}' in parents and trashed=false"
    f = svc.files().list(q=q, fields="files(id,name)").execute().get("files", [])
    if not f:
        raise FileNotFoundError(f"no hay '{name}' en la carpeta {folder_id}")
    return _download_json(svc, f[0]["id"], label)


def _upload_h2(local_path, svc):
    """Sube OKR_H2_FY27.json a la carpeta de los canonicos (lo crea la primera vez, despues lo actualiza) + Ownia."""
    from googleapiclient.http import MediaFileUpload
    import sys as _sys
    from pathlib import Path as _Path
    _sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "Ownia_B2B_Ecosystem" / "mirror"))
    from ownia_publish import DRIVE_FIELDS, publish_after_drive   # doble escritura Drive + Ownia
    q = f"name='{H2_OUTPUT_NAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false"
    ex = svc.files().list(q=q, fields="files(id,name)").execute().get("files", [])
    media = MediaFileUpload(local_path, mimetype="application/json", resumable=True)
    if ex:
        res = svc.files().update(fileId=ex[0]["id"], media_body=media, fields=DRIVE_FIELDS).execute()
        print(f"  [Drive] actualizado {H2_OUTPUT_NAME}: id={res['id']}")
    else:
        res = svc.files().create(body={"name": H2_OUTPUT_NAME, "parents": [DRIVE_FOLDER_ID]},
                                 media_body=media, fields=DRIVE_FIELDS).execute()
        print(f"  [Drive] creado {H2_OUTPUT_NAME}: id={res['id']}  >>> copiarlo a OKR_H2_FILE_ID (Codigo_OKR.js) y a drive-manifest.json")
    with open(local_path, "rb") as _f:
        publish_after_drive(res, _f.read())


def _check_h2_vs_okr(h2_rows, okr_rows):
    """Control: los KRs contables de OKR_H2_FY27.json, sumados por pais, tienen que dar el Total de okr.json (mismo KR / mes / escenario)."""
    tot = {}
    for r in okr_rows:
        tot[(r[0], r[1], r[5])] = r[6]
    s = defaultdict(float)
    for r in h2_rows:
        if r[3] not in ("Total",) and r[5] in ("Op. Contribution", "Net Revenues B2B", "Operating Contribution API",
                                                 "Operating Contribution HTML", "Net Revenues API Hoteles", "New Product Growth"):
            s[(r[0], r[1], r[5])] += r[6]
    bad = [(k, round(v), round(tot.get(k, 0))) for k, v in s.items() if abs(v - tot.get(k, 0)) > 1]
    print(f"  [Control H2] KRs contables por pais vs Total de okr.json: {'OK (' + str(len(s)) + ' claves)' if not bad else 'DIFIEREN ' + str(bad[:5])}")


# ── Sheets helper ──────────────────────────────────────────────────────────────

def _read_sheet(token_file):
    from googleapiclient.discovery import build
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    tok = json.load(open(token_file))
    creds = Credentials(
        token=tok.get("token"), refresh_token=tok.get("refresh_token"),
        token_uri=tok.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=tok.get("client_id"), client_secret=tok.get("client_secret"),
        scopes=["https://www.googleapis.com/auth/drive",
                "https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    if not creds.valid:
        creds.refresh(Request())
    try:
        sheets = build("sheets", "v4", credentials=creds)
        result = sheets.spreadsheets().values().get(
            spreadsheetId=SHEET_ID, range=SHEET_RANGE
        ).execute()
        return result.get("values", [])
    except Exception as e:
        # Con el client OAuth de clasp (credentials_drive.json armado desde ~/.clasprc.json) la Sheets
        # API no está habilitada (403 SERVICE_DISABLED): se baja la pestaña como CSV por Drive, que
        # devuelve los mismos valores formateados (fechas d/mm/aaaa, números es-AR).
        import csv
        from google.auth.transport.requests import AuthorizedSession
        print(f"  [GSheet] Sheets API no disponible ({str(e)[:80]}...) — leo {SHEET_RANGE} como CSV por Drive")
        r = AuthorizedSession(creds).get(
            f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SHEET_GID}")
        r.raise_for_status()
        return list(csv.reader(io.StringIO(r.content.decode("utf-8"))))


# ── Gestional B2B2C ───────────────────────────────────────────────────────────

def _ym_to_periodo(ym):
    """'2026-04' → '2026-04-01'"""
    return ym + "-01"


def _daily_new_by_periodo(block, nr_field="net_revenue"):
    """daily_b2b2c_data.json bloque {cols,rows} → {periodo: NR de cuentas 'New'}.
    Los bloques budget/runrate traen el flag en la columna 'stage'."""
    cols = block.get("cols", [])
    rows = block.get("rows", [])
    if not cols or not rows:
        return {}
    try:
        iF, iS, iN = cols.index("fecha"), cols.index("stage"), cols.index(nr_field)
    except ValueError:
        return {}
    out = defaultdict(float)
    for r in rows:
        if str(r[iS]) == "New":
            out[_ym_to_periodo(str(r[iF])[:7])] += float(r[iN] or 0)
    return out


def _compute_b2b2c_hunting_farming(daily_json, nr_b2b2c_by_scen, last_actual_ym):
    """
    Devuelve rows OKR para New (Hunting) / Existing (Farming) Account Net Revenues B2B2C.

    Definición única de "hunting" = flag New/Existing de daily_b2b2c_data.json
    (account_type en .actuals, stage en .budget/.runrate). 2026-08-30: se descartó
    la lista HUNTING_PARTNERS (coincidía ~2% con el flag para budget).

      · Budget           : Hunting = daily_b2b2c.budget (stage=='New')
      · Run Rate/Actuals :
          - meses <= last_actual_ym : daily_b2b2c.actuals (account_type=='New')
          - meses  > last_actual_ym : daily_b2b2c.runrate (stage=='New'),
                                      fallback daily_b2b2c.budget si el mes no está en runrate
      · Existing = Total B2B2C NR contable (nr_b2b2c_by_scen) − Hunting, por escenario/mes.
    """
    corte = _ym_to_periodo(last_actual_ym)   # 'YYYY-MM-01'

    act_new = defaultdict(float)
    for r in daily_json.get("actuals", []):
        if str(r.get("account_type", "")) != "New":
            continue
        ym = str(r.get("fecha", ""))[:7]
        if ym:
            act_new[_ym_to_periodo(ym)] += float(r.get("net_revenues") or 0)

    # okr_budget / okr_runrate: bloques del FY completo (abr -> mar) que emite daily_sync.py
    # (los .budget / .runrate del Daily se recortan al año calendario → sin ene-mar). Fallback
    # a los bloques viejos si el JSON diario todavía no los trae.
    bud_new = _daily_new_by_periodo(daily_json.get("okr_budget") or daily_json.get("budget", {}))
    rr_new  = _daily_new_by_periodo(daily_json.get("okr_runrate") or daily_json.get("runrate", {}))

    def hunting_rr(periodo):
        if periodo <= corte:
            return act_new.get(periodo, 0.0)
        if periodo in rr_new:
            return rr_new[periodo]
        return bud_new.get(periodo, 0.0)

    HUNTING_BY_SCEN = {
        "Run Rate/Actuals": hunting_rr,
        "Budget":           lambda periodo: bud_new.get(periodo, 0.0),
    }

    # Cobertura: raw.b2b_budget_gd / raw.b2brr_gd solo llegan hasta dic-2026. Sin dato del
    # flag New/Existing NO se emite el mes (hunting=0 haría que Existing = NR total).
    def covered(scen_label, periodo):
        if scen_label == "Budget":
            return periodo in bud_new
        return periodo <= corte or periodo in rr_new or periodo in bud_new

    rows = []
    for scen_label, hunting_fn in HUNTING_BY_SCEN.items():
        total_by_periodo = nr_b2b2c_by_scen.get(scen_label, {})
        for periodo in sorted(total_by_periodo):
            total = total_by_periodo.get(periodo)
            if total is None:
                continue   # sin total contable ese mes -> no calculamos Existing
            if not covered(scen_label, periodo):
                continue
            hunting = hunting_fn(periodo)
            farming = total - hunting
            rows.append([periodo, scen_label, "B2B2C", "Total", "Total",
                         "New Account Net Revenues", round(hunting, 2)])
            rows.append([periodo, scen_label, "B2B2C", "Total", "Total",
                         "Existing Account Net Revenues", round(farming, 2)])

    n_meses = len(set(r[0] for r in rows))
    print(f"  [Hunting/Farming] B2B2C NR: {len(rows)} filas ({n_meses} meses) · corte actuals = {last_actual_ym}")
    return rows


# ── Canonical JSON (baseline / budget) ────────────────────────────────────────

def _compute_from_canonical(canon_data, scen_label):
    """
    Calcula desde un JSON canónico (baseline o budget) — mismo input que usa la
    landing P&L_Accounting:
      - B2B2C Op. Contribution   (N5 = 'operating contribution', lob = b2b2c)
      - B2B NR Core Markets      (N3 = 'net revenue', lob = b2b, pais ∈ CORE_MARKETS)
      - B2B NR New Markets       (N3 = 'net revenue', lob = b2b, pais ∉ CORE_MARKETS — incluye OPS/RG)
    Air Net Revenue from suppliers NO se calcula acá: es manual (Input_OKR)
    hasta que el equipo defina la fuente (2026-08-25).
    Devuelve además (no como KR propio) el total B2B2C Net Revenue por mes,
    que usa _compute_b2b2c_hunting_farming para calcular "Existing".
    """
    cols = canon_data["cols"]
    iL   = cols.index("LoB")
    iN3  = cols.index("P&L N3")
    iN5  = cols.index("P&L N5")
    iP   = cols.index("Pais")
    iF   = cols.index("Fecha")
    iM   = cols.index("Monto USD")
    iC   = cols.index("Canal")

    op_cont    = defaultdict(float)   # B2B2C Op.Contribution
    nr_core    = defaultdict(float)   # B2B NR Core Markets
    nr_new     = defaultdict(float)   # B2B NR New Markets
    nr_b2b2c   = defaultdict(float)   # B2B2C NR total (no es KR propio)
    nr_b2b     = defaultdict(float)   # B2B NR total (H2: KR "Net Revenues B2B")
    glob_nr    = defaultdict(float)   # API Hoteles NR, todos los países (H2: KR "Net Revenues API Hoteles")
    oc_api     = defaultdict(float)   # B2B OC canal 'may' = API (H2)
    oc_html    = defaultdict(float)   # B2B OC canal 'min' = HTML (H2)

    for r in canon_data["rows"]:
        lob   = str(r[iL]).lower()
        n3    = str(r[iN3]).lower()
        n5    = str(r[iN5]).lower()
        pais  = str(r[iP]).lower()
        fecha = r[iF]
        monto = float(r[iM] or 0)

        if lob == "b2b2c" and n5 == "operating contribution":
            op_cont[fecha] += monto

        if lob == "b2b2c" and n3 == "net revenue":
            nr_b2b2c[fecha] += monto

        if (lob == "b2b" and str(r[iC]).lower() == "may"
                and str(r[cols.index("Producto")]).lower() in GLOBALES_PRODUCTOS):
            if n3 == "net revenue":
                glob_nr[fecha] += monto

        if lob == "b2b" and n5 == "operating contribution":
            canal = str(r[iC]).lower()
            if canal == "may":
                oc_api[fecha] += monto
            elif canal == "min":
                oc_html[fecha] += monto

        if lob == "b2b" and n3 == "net revenue":
            nr_b2b[fecha] += monto
            if pais in CORE_MARKETS:
                nr_core[fecha] += monto
            else:
                nr_new[fecha] += monto

    rows = []
    for fecha in sorted(set(list(op_cont) + list(nr_core) + list(nr_new)
                            + list(nr_b2b) + list(oc_api) + list(oc_html) + list(glob_nr))):
        if fecha in glob_nr:
            rows.append([fecha, scen_label, "Globales", "Total", "Hotels",
                         "Net Revenues API Hoteles", round(glob_nr[fecha], 2)])
        if fecha in nr_b2b:
            rows.append([fecha, scen_label, "B2B", "Total", "Total",
                         "Net Revenues B2B", round(nr_b2b[fecha], 2)])
        if fecha in oc_api:
            rows.append([fecha, scen_label, "B2B", "Total", "API",
                         "Operating Contribution API", round(oc_api[fecha], 2)])
        if fecha in oc_html:
            rows.append([fecha, scen_label, "B2B", "Total", "HTML",
                         "Operating Contribution HTML", round(oc_html[fecha], 2)])
        if fecha in op_cont:
            rows.append([fecha, scen_label, "B2B2C", "Total", "Total",
                         "Op. Contribution", round(op_cont[fecha], 2)])
        if fecha in nr_core:
            rows.append([fecha, scen_label, "B2B", "Core Markets", "Total",
                         "Net revenues Core Markets", round(nr_core[fecha], 2)])
        if fecha in nr_new:
            rows.append([fecha, scen_label, "B2B", "New Markets", "Total",
                         "Net revenues New Markets", round(nr_new[fecha], 2)])

    print(f"  [Canonical/{scen_label}] {len(rows)} filas ({len(set(r[0] for r in rows))} meses)")
    return rows, nr_b2b2c


# ── GSheet manuales ────────────────────────────────────────────────────────────

def _parse_date_sheet(raw):
    """'1/03/2026' → '2026-03-01'"""
    parts = str(raw).strip().split("/")
    if len(parts) != 3:
        return None
    d, m, y = parts
    try:
        return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
    except ValueError:
        return None


def _parse_valor_sheet(raw):
    """Valor de la sheet (locale es-AR: '.' miles, ',' decimales) → número, o None si no se puede leer.
    Tolera '%', '$' y espacios ('85,5%', '$ 1.000'). Un '.' seguido de 1-2 dígitos ('5.2', '12.5')
    NO puede ser separador de miles (los grupos son de 3), así que es un decimal con punto."""
    s = str(raw).strip().replace("%", "").replace("$", "").replace(" ", "")
    if not s:
        return None
    if "," not in s and re.fullmatch(r"-?\d+\.\d{1,2}", s):
        return float(s)
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
        try:
            return float(s)
        except ValueError:
            return None
    else:
        try:
            return int(s.replace(".", ""))
        except ValueError:
            try:
                return float(s)
            except ValueError:
                return None


def _norm_periodo(v):
    """datetime | '2026-04' | '2026-04-01' | '1/4/2026' → 'YYYY-MM-01'  (None si no parsea)."""
    import datetime as _dt
    if isinstance(v, (_dt.datetime, _dt.date)):
        return f"{v.year:04d}-{v.month:02d}-01"
    s = str(v).strip()
    m = re.match(r"^(\d{4})-(\d{1,2})(?:-\d{1,2})?$", s)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-01"
    parts = s.replace("-", "/").split("/")
    if len(parts) == 3:
        try:
            a, b, c = (int(x) for x in parts)
            if a > 1000:              # Y/m/d
                y, mo = a, b
            else:                     # d/m/Y
                y, mo = (c + 2000 if c < 100 else c), b
            return f"{y:04d}-{mo:02d}-01"
        except ValueError:
            pass
    return None


# escenario del tracker → escenario canónico del OKR
_AGENCIAS_ESC = {
    "actuals":          "Run Rate/Actuals",
    "run rate/actuals": "Run Rate/Actuals",
    "budget":           "Budget",
}


def _read_tracker_sheet(sheet, label, lob, kr, escenarios=("Run Rate/Actuals", "Budget")):
    """Lee una hoja del tracker en OneDrive (AGENCIAS_TRACKER), formato ancho: filas escenario×pais,
    columnas = meses; solo la fila Pais='Total'. Se abre una COPIA temporal: con el archivo abierto en
    Excel, openpyxl da PermissionError (visto 2026-10-23). Valores redondeados a entero (son conteos)."""
    if not os.path.exists(AGENCIAS_TRACKER):
        print(f"  [{label}] no encontrado: {AGENCIAS_TRACKER} — KR sin datos")
        return []
    import openpyxl, shutil, tempfile
    tmp = os.path.join(tempfile.mkdtemp(prefix="okr_tracker_"), os.path.basename(AGENCIAS_TRACKER))
    try:
        shutil.copyfile(AGENCIAS_TRACKER, tmp)
    except PermissionError:
        # Abierto en Excel: open() de Python falla, pero CopyFileW de Windows lo copia igual.
        import ctypes
        if not (os.name == "nt" and ctypes.windll.kernel32.CopyFileW(AGENCIAS_TRACKER, tmp, False)):
            print(f"  WARN [{label}] no se pudo leer {AGENCIAS_TRACKER} (¿abierto/bloqueado?) — KR sin datos")
            return []
    wb = openpyxl.load_workbook(tmp, read_only=True, data_only=True)
    try:
        if sheet not in wb.sheetnames:
            print(f"  WARN [{label}] el tracker no tiene la hoja '{sheet}' (hojas: {wb.sheetnames}) — KR sin datos")
            return []
        it = wb[sheet].iter_rows(values_only=True)
        header = next(it, None)
        if not header:
            return []
        # header: ['escenario', 'Pais', <mes1>, <mes2>, ...] → columna idx → periodo
        col_periodo = {}
        for ci in range(2, len(header)):
            p = _norm_periodo(header[ci]) if header[ci] is not None else None
            if p:
                col_periodo[ci] = p

        rows, skipped = [], 0
        for r in it:
            if not r or r[0] is None:
                continue
            esc_raw = str(r[0]).strip().lower()
            pais    = str(r[1] or "").strip().lower()
            if pais != "total":
                continue
            escenario = _AGENCIAS_ESC.get(esc_raw)
            if escenario is None:
                skipped += 1
                continue
            if escenario not in escenarios:
                continue
            for ci, periodo in col_periodo.items():
                v = r[ci] if ci < len(r) else None
                if v in (None, ""):
                    continue
                try:
                    valor = round(float(v))
                except (TypeError, ValueError):
                    continue
                rows.append([periodo, escenario, lob, "Total", "Total", kr, valor])
    finally:
        wb.close()
    print(f"  [{label}] {len(rows)} filas de {os.path.basename(AGENCIAS_TRACKER)} (hoja {sheet})"
          + (f" ({skipped} escenarios no reconocidos)" if skipped else ""))
    return rows


def _read_agencias_flat():
    """KR 'Monthly Buying Agencies' (B2B, peso 20) — hoja 'Hoja1' del tracker. El estado de la orden
    en el datalake muta con el tiempo → hay que congelar el conteo del snapshot mensual.
    Vida útil hasta Sep-2026; desde Oct-2026 cambia la lógica."""
    return _read_tracker_sheet("Hoja1", "Agencias", "B2B", "Monthly Buying Agencies")


# Target (Budget) cargado a mano mientras Input_OKR no trae las filas (pedido de antonella.difranco, 2026-10-27;
# la Sheets API está deshabilitada en el client OAuth y no se puede escribir la sheet por código). Solo completa
# meses que la sheet no tiene: si el equipo carga el target en Input_OKR, gana la sheet.
# Price Competitiveness: baseline ago-26 = 50% (no es mes del H2, se muestra en la card del tracker).
GLOBALES_TARGET_DEFAULT = {
    "Price Competitiveness ex-Latam (Destino GL)": {
        "2026-10": 48, "2026-11": 46, "2026-12": 43, "2027-01": 40, "2027-02": 37, "2027-03": 35,
    },
}


def _apply_globales_target_default(rows_manual):
    have = {(r[5].lower(), str(r[0])[:7]) for r in rows_manual if str(r[1]).strip().lower() == "budget"}
    for kr, by_ym in GLOBALES_TARGET_DEFAULT.items():
        added = []
        for ym, v in sorted(by_ym.items()):
            if (kr.lower(), ym) not in have:
                rows_manual.append([_ym_to_periodo(ym), "Budget", "Globales", "Total", "Total", kr, v])
                added.append(ym)
        if added:
            print(f"  [{kr}] target por defecto (GLOBALES_TARGET_DEFAULT; Input_OKR no lo trae): {added}")
    return rows_manual


def _read_manual_krs(token_file):
    """Lee del GSheet Input_OKR los KRs manuales de MANUAL_KRS
    (Sign New Partnership, Air Net Revenue from suppliers)."""
    raw_rows = _read_sheet(token_file)
    SKIP = {"periodo", "escenario", "lob", "kr", "", None}
    rows = []
    skipped = 0
    unparsed = []   # filas de KRs manuales con fecha o valor ilegible (antes se descartaban en silencio)
    for r in raw_rows:
        if len(r) < 7:
            skipped += 1
            continue
        periodo_raw, escenario, lob, pais, producto, kr, valor_raw = (
            r[0], r[1], r[2], r[3], r[4], r[5], r[6]
        )
        if str(periodo_raw).strip().lower() in SKIP or str(escenario).strip().lower() in SKIP:
            skipped += 1
            continue
        if str(kr).strip().lower() not in MANUAL_KRS_LC:
            continue
        if str(kr).strip().lower() in GLOBALES_KRS_LC:
            lob = "Globales"
        kr = KR_CANON.get(str(kr).strip().lower(), str(kr).strip())
        # Solo el total (Pais=Total, Producto=Total) — si alguien agrega detalle
        # por país/producto en la sheet, no lo sumamos para evitar duplicar.
        if str(pais).strip().lower() != "total" or str(producto).strip().lower() != "total":
            skipped += 1
            continue
        periodo = _parse_date_sheet(periodo_raw)
        valor   = _parse_valor_sheet(valor_raw)
        if periodo is None or valor is None:
            skipped += 1
            unparsed.append((kr, periodo_raw, escenario, valor_raw))
            continue
        rows.append([periodo, escenario, lob, pais, producto, kr, valor])

    # Filas repetidas en la sheet (mismo periodo/escenario/lob/pais/producto/kr): la landing
    # SUMA por clave, así que un duplicado dobla el valor (ej. Unique Buyers Budget cargado
    # dos veces, 2026-09-24). Se queda la última y se avisa si los valores difieren.
    dedup = {}
    for r in rows:
        key = tuple(str(x).strip().lower() for x in r[:6])
        if key in dedup and dedup[key][6] != r[6]:
            print(f"  WARN duplicado con valores distintos en Input_OKR: {r[5]} {r[0]} {r[1]}: "
                  f"{dedup[key][6]} vs {r[6]} (se usa {r[6]})")
        dedup[key] = r
    n_dup = len(rows) - len(dedup)
    rows = list(dedup.values())

    print(f"  [GSheet manual] {len(rows)} filas" + (f" ({n_dup} duplicadas descartadas)" if n_dup else ""))
    if unparsed:
        print(f"  WARN {len(unparsed)} filas de KRs manuales con fecha/valor ilegible en Input_OKR (descartadas):")
        for kr_, per_, esc_, val_ in unparsed[:8]:
            print(f"       {kr_} | {per_} | {esc_} | valor={val_!r}")
    return rows


def _apply_globales_hoteles_actual(rows_manual, daily_json):
    """KR Global B2B API "Hoteles Directos vendidos destino LATAM" y "% Hoteles Directos vendidos
    destino Globales" (H2 FY27): el actual sale del Datalake (daily_sync.py -> daily_b2b2c_data.json
    "okr_globales_hoteles", hoteles distintos por mes; el mes en curso es MTD) en vez de Input_OKR,
    donde el "actual" era el target copiado. El target (Budget) sigue de la sheet; el actual queda solo
    para los meses con dato del Datalake. Si el JSON no trae el bloque, queda la sheet."""
    gh = (daily_json or {}).get("okr_globales_hoteles") or {}
    if not gh:
        print("  [Globales hoteles] sin okr_globales_hoteles en daily_b2b2c_data.json — se mantiene Input_OKR")
        return rows_manual
    names = {"hoteles directos vendidos destino latam":      "Hoteles Directos vendidos destino LATAM",
             "% hoteles directos vendidos destino globales": "% Hoteles Directos vendidos destino Globales"}
    vals = {}
    for ym, d in gh.items():
        vals[("hoteles directos vendidos destino latam", ym)] = d["dir_latam"]
        if d.get("tot_glob"):
            vals[("% hoteles directos vendidos destino globales", ym)] = round(d["dir_glob"] / d["tot_glob"] * 100, 2)
    # TODAS las filas Run Rate/Actuals de la sheet para estos KRs se descartan (no solo las de meses con
    # dato): ahí el "actual" es el target copiado y en los meses futuros daría un 100% falso.
    out = [r for r in rows_manual if not (r[1] == "Run Rate/Actuals" and r[5].lower() in names)]
    for (kr_lc, ym), v in sorted(vals.items()):
        out.append([_ym_to_periodo(ym), "Run Rate/Actuals", "Globales", "Total", "Total", names[kr_lc], v])
    print(f"  [Globales hoteles] actual desde Datalake para: {sorted(gh)}")
    return out


def _apply_recurrence_rr(rows_manual, recur_json):
    """KR B2B "Accelerate Recurrence" (H2 FY27): en el mes comercial EN CURSO el actual es el Rolling L4W
    (roll_frecuentes_vivas de recurrencia_b2b.json, la misma query que el Status KRs H2 del Tracker: card
    Metabase 171400), Total = suma de países, de la última semana cerrada del mes (si no hay ninguna, la
    última que haya). Definido por diego.bracco 2026-10-27: cuando el mes cierra, el actual vuelve a salir
    de Input_OKR (la foto de cierre queda congelada en la sheet) y los demás meses siguen de la sheet.
    Si el JSON no está o no trae filas, queda todo como en Input_OKR."""
    cols = (recur_json or {}).get("cols") or []
    rows = [dict(zip(cols, r)) for r in (recur_json or {}).get("rows") or []]
    if not rows:
        print("  [Accelerate Recurrence] sin recurrencia_b2b.json — se mantiene Input_OKR")
        return rows_manual
    cerrados = {r["mes_comercial"] for r in rows if int(r["es_cierre_mes"]) == 1 and r["estado"] == "CIERRE"}
    abiertos = sorted({r["mes_comercial"] for r in rows} - cerrados)
    if not abiertos:
        print("  [Accelerate Recurrence] ningún mes comercial en curso — se mantiene Input_OKR")
        return rows_manual
    ym = abiertos[-1]
    del_mes = [r for r in rows if r["mes_comercial"] == ym]
    sem = [r for r in del_mes if r["estado"] == "CIERRE"] or del_mes
    k = max(int(r["semana_del_mes"]) for r in sem)
    foto = [r for r in sem if int(r["semana_del_mes"]) == k]
    v = sum(int(r["roll_frecuentes_vivas"]) for r in foto)
    out = [r for r in rows_manual if not (r[1] == "Run Rate/Actuals" and r[5].lower() == "accelerate recurrence"
                                          and str(r[0])[:7] == ym)]
    out.append([_ym_to_periodo(ym), "Run Rate/Actuals", "B2B", "Total", "Total", "Accelerate Recurrence", v])
    print(f"  [Accelerate Recurrence] {ym} en curso = Rolling L4W {v:,} (semana {k} del mes, "
          f"{foto[0]['semana_desde']} a {foto[0]['semana_hasta']}); el resto de los meses, Input_OKR")
    return out


# ── Build ──────────────────────────────────────────────────────────────────────

def build(upload=True):
    print("=== okr_builder ===")

    svc        = pnl_common.get_drive_service()
    token_file = os.path.join(DIR, "token_drive.json")

    print("\n--- Descargando fuentes de Drive ---")
    gest_json     = _download_json(svc, GESTIONAL_FILE_ID,   "_pnl_gestional_data.json")
    baseline_data = _download_json(svc, BASELINE_FILE_ID,    "baseline_actuals+projections.json")
    budget_data   = _download_json(svc, BUDGET_FILE_ID,      "budget.json")
    daily_json    = _download_json(svc, DAILY_B2B2C_FILE_ID, "daily_b2b2c_data.json")
    try:
        recur_json = _download_json(svc, RECUR_FILE_ID, "recurrencia_b2b.json")
    except Exception as e:
        print(f"  WARN [Drive] recurrencia_b2b.json: {e} — Accelerate Recurrence queda como en Input_OKR")
        recur_json = None

    last_actual_ym = gest_json.get("last_actual_ym")
    if not last_actual_ym:
        sys.exit("gestional JSON sin 'last_actual_ym' — no puedo determinar el corte de actuals.")
    print(f"  corte de actuals (gestional.last_actual_ym): {last_actual_ym}")

    print("\n--- Calculando KRs ---")
    rows_baseline, nr_b2b2c_baseline = _compute_from_canonical(baseline_data, "Run Rate/Actuals")
    rows_budget,   nr_b2b2c_budget   = _compute_from_canonical(budget_data,   "Budget")
    rows_hunting  = _compute_b2b2c_hunting_farming(
        daily_json,
        {"Run Rate/Actuals": nr_b2b2c_baseline, "Budget": nr_b2b2c_budget},
        last_actual_ym,
    )
    rows_manual   = _read_manual_krs(token_file)
    rows_manual, estado_ub = h2b.apply_unique_buyers(rows_manual, daily_json, last_actual_ym)
    rows_manual   = _apply_globales_hoteles_actual(rows_manual, daily_json)
    rows_manual   = _apply_recurrence_rr(rows_manual, recur_json)
    rows_manual   = _apply_globales_target_default(rows_manual)
    # Partners API: actual de partners_api_snapshots.json (Daily_Dashboard/partners_api_sync.py; meses congelados + rolling 30 dias).
    try:
        _snap = _download_by_name(svc, DAILY_FOLDER_ID, "partners_api_snapshots.json", "partners_api_snapshots.json (Partners API)")
    except Exception as e:
        print(f"  WARN [Partners API] sin partners_api_snapshots.json ({e}) — el KR queda sin actual")
        _snap = None
    rows_partners, estado_partners = h2b.partners_api_rows(_snap)
    if rows_partners:   # el actual del snapshot reemplaza cualquier fila Run Rate/Actuals de Input_OKR
        rows_manual = [r for r in rows_manual if not (r[1] == "Run Rate/Actuals"
                       and r[5].lower() == "accelerate hunting partners api")]
    rows_agencias = _read_agencias_flat()
    if not rows_agencias:
        # Sin el tracker en el OneDrive de esta máquina (p.ej. la sync diaria en una compu sin la carpeta
        # compartida): se conservan las filas del okr.json publicado, para no borrar el KR de H1.
        try:
            prev = _download_json(svc, OKR_FILE_ID, "okr.json (previo, para Monthly Buying Agencies)")
            iK = prev["cols"].index("KR")
            rows_agencias = [r for r in prev.get("rows", []) if r[iK] == "Monthly Buying Agencies"]
            print(f"  [Agencias] {len(rows_agencias)} filas conservadas del okr.json publicado")
        except Exception as e:
            print(f"  WARN [Agencias] no se pudieron conservar del okr.json publicado ({e})")

    all_rows = rows_baseline + rows_budget + rows_hunting + rows_manual + rows_partners + rows_agencias

    # H1 congelado: se descartan las filas calculadas de los períodos <= H1_END y se usan las del OKR_H1_FY27.json.
    # Si no se puede leer el congelado NO se sigue (cortaría H1 o lo recalcularía con datos nuevos).
    h1 = _download_json(svc, OKR_H1_FILE_ID, "OKR_H1_FY27.json (H1 congelado)")
    if h1.get("cols") != COLS_OUT:
        sys.exit(f"OKR_H1_FY27.json con columnas distintas a okr.json: {h1.get('cols')}")
    n_calc = sum(1 for r in all_rows if str(r[0])[:10] <= H1_END)
    all_rows = [r for r in all_rows if str(r[0])[:10] > H1_END] + h1["rows"]
    print(f"  [H1 congelado] {len(h1['rows'])} filas de OKR_H1_FY27.json (se descartaron {n_calc} filas calculadas de <= {H1_END})")

    # Resumen
    print(f"\n  Total filas: {len(all_rows):,}")
    by_kr = defaultdict(int)
    for r in all_rows:
        by_kr[r[5]] += 1
    for kr, n in sorted(by_kr.items()):
        print(f"    {kr}: {n}")

    # OKR_H2_FY27.json: KRs de H2 abiertos por pais (organic al leer en el Hub) + Estado. Ver okr_h2_builder.py.
    closed_until = _ym_to_periodo(last_actual_ym)
    h2_base, nr_base = h2b.contable_by_pais(baseline_data, "Run Rate/Actuals", closed_until)
    h2_bud,  nr_bud  = h2b.contable_by_pais(budget_data,   "Budget",           closed_until)
    h2_hunt = h2b.hunting_farming_by_pais(daily_json, {"Run Rate/Actuals": nr_base, "Budget": nr_bud},
                                          last_actual_ym, closed_until)
    # New Product Growth (B2B) estimado: Flights + Dest. Serv. contables + % de Packages General del Daily (okr_h2_managerial.json)
    h2_np = []
    try:
        mgr_json = _download_by_name(svc, DAILY_FOLDER_ID, "okr_h2_managerial.json", "okr_h2_managerial.json (apertura de Packages General)")
        h2_np, _ = h2b.new_product_growth(baseline_data, budget_data, mgr_json, closed_until)
    except Exception as e:
        print(f"  WARN [New Product Growth] no se pudo calcular ({e}) — el KR queda sin datos")
    all_rows = all_rows + h2b.totals_from_rows(h2_np, h2b.NEW_PRODUCT_KR)
    h2_rows = h2b.build_h2_rows(h2_base + h2_np, h2_bud, h2_hunt, rows_manual, rows_partners, estado_ub, closed_until, estado_partners)
    _check_h2_vs_okr(h2_rows, all_rows)

    payload = {
        "meta": {
            "concepto":   "okr",
            "gestional_file_id":  GESTIONAL_FILE_ID,
            "baseline_file_id":   BASELINE_FILE_ID,
            "budget_file_id":     BUDGET_FILE_ID,
            "daily_b2b2c_file_id": DAILY_B2B2C_FILE_ID,
            "recurrencia_file_id": RECUR_FILE_ID,
            "okr_h1_file_id":      OKR_H1_FILE_ID,   # H1 (<= H1_END) copiado del congelado, no recalculado
            "sheet_id":   SHEET_ID,
            "filas":      len(all_rows),
        },
        "cols": COLS_OUT,
        "rows": all_rows,
    }

    outdir = os.path.join(DIR, "_projections_out")
    os.makedirs(outdir, exist_ok=True)
    local = os.path.join(outdir, OUTPUT_NAME)
    with open(local, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n  local -> {local}  ({os.path.getsize(local)/1e3:.1f} KB)")

    payload_h2 = {
        "meta": {
            "concepto": "okr_h2_fy27",
            "descripcion": "KRs de H2 FY27 (oct-2026 a mar-2027), contables abiertos por pais (organic al leer en el Hub), con Estado",
            "generado": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "cierre_contable_hasta": closed_until,
            "filas": len(h2_rows),
        },
        "cols": h2b.COLS_H2,
        "rows": h2_rows,
    }
    local_h2 = os.path.join(outdir, H2_OUTPUT_NAME)
    with open(local_h2, "w", encoding="utf-8") as f:
        json.dump(payload_h2, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  local -> {local_h2}  ({os.path.getsize(local_h2)/1e3:.1f} KB, {len(h2_rows)} filas)")

    if upload:
        _upload(local, svc)
        _upload_h2(local_h2, svc)
    else:
        print("  (--no-upload)")

    return payload


def refresh_after_upload():
    """Regenera y sube okr.json. Lo llaman json_builder.py (budget/all) y baseline_builder.py justo
    después de subir budget.json / baseline, y Daily_Dashboard/daily_sync.py al final de cada corrida
    (los actuals del Datalake de daily_b2b2c_data.json): okr.json se arma a partir de ellos, y si no se regenera
    el OKR Status del Hub queda con números viejos distintos al Cuadro Resumen P&L (pasó en oct-2026).
    No corta el flujo que lo llama: si falla, avisa y hay que correr `python okr_builder.py` a mano."""
    print("\n=== okr.json (se regenera con los datos nuevos) ===")
    try:
        build(True)
    except Exception as e:
        print(f"\n*** AVISO: NO se pudo regenerar okr.json ({e}). El OKR Status del Hub queda DESACTUALIZADO "
              f"hasta que corras:  python okr_builder.py ***")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-upload", action="store_true")
    a = ap.parse_args()
    build(not a.no_upload)
