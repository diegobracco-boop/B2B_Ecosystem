"""
okr_builder.py
Genera okr.json combinando cuatro fuentes:

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

Mismo criterio que Dashboard_B2B_WLs/Codigo_OKR.js (computeOKR_), consolidado acá para
que la landing deje de calcular todo en vivo y solo lea este JSON.

Uso:
    python okr_builder.py
    python okr_builder.py --no-upload
"""

import os, sys, io, json, re, argparse
from collections import defaultdict

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import config
import pnl_common

DIR             = os.path.dirname(os.path.abspath(__file__))
OUTPUT_NAME     = "okr.json"
DRIVE_FOLDER_ID = config.DRIVE_FOLDER_ID

# ── IDs Drive ──────────────────────────────────────────────────────────────────
GESTIONAL_FILE_ID  = "1wvle0UIVZV7ocCSl8OawOfIGVz_It5kh"   # _pnl_gestional_data.json (solo para 'last_actual_ym' = corte de actuals)
BASELINE_FILE_ID   = "1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv"   # baseline_actuals+projections.json
BUDGET_FILE_ID     = "1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW"   # budget.json
DAILY_B2B2C_FILE_ID = "1Ukcx4e-dwCZ2VqesWwVN_1Jnt6r2AZdX"  # daily_b2b2c_data.json (transaccional)
OKR_FILE_ID        = "1cEidr8aoYgm4S7ugm05Wv-SMnz8GbtUj"   # okr.json (output)

SHEET_ID    = "1RVmTXDyyugCUXJ0f6JG_croNxWNLlOLm4eAs8F52u2c"
SHEET_RANGE = "Input_OKR"

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
    # Globales B2B API (H2): conteos, LoB='Globales' en la sheet (target y actual).
    # Los KRs "GB B2B API Hoteles - destino LATAM / NO LATAM" son WIP (sin fuente definida).
    "Accelerate Hunting Partners API",
    "Hoteles Directos vendidos destino LATAM",
    "Hoteles Directos vendidos destino NO LATAM",
    # Grafía tal cual quedó cargada en la sheet (singular, "Vendidos" con V mayúscula).
    "Hoteles Directo Vendidos destino LATAM",
    "Hoteles Directo Vendidos destino NO LATAM",
}
MANUAL_KRS_LC = {k.lower() for k in MANUAL_KRS}   # el match es case-insensitive

# En la sheet estos KRs vienen con LoB='B2B'; el OKR los agrupa en 'Globales'.
GLOBALES_KRS_LC = {k.lower() for k in MANUAL_KRS if k.lower().startswith(("accelerate hunting", "hoteles directo"))}

# Globales B2B API Hoteles = país Others Countries + canal API ('may') + producto Hotels
# (misma definición que el tab "KRs Globales" del Daily).
GLOBALES_PAISES    = {"others countries", "other countries"}
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
    media = MediaFileUpload(local_path, mimetype="application/json", resumable=True)
    res = svc.files().update(fileId=OKR_FILE_ID, media_body=media,
                              fields="id,size,modifiedTime").execute()
    print(f"  [Drive] actualizado {OUTPUT_NAME}: id={res['id']}  size={res.get('size','?')}")


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
    sheets = build("sheets", "v4", credentials=creds)
    result = sheets.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=SHEET_RANGE
    ).execute()
    return result.get("values", [])


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
    glob_nr    = defaultdict(float)   # Globales API Hoteles NR  (H2: KR "Net Revenue API Hoteles %GB")
    glob_gb    = defaultdict(float)   # Globales API Hoteles GB
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

        if (lob == "b2b" and str(r[iC]).lower() == "may" and pais in GLOBALES_PAISES
                and str(r[cols.index("Producto")]).lower() in GLOBALES_PRODUCTOS):
            if n3 == "net revenue":
                glob_nr[fecha] += monto
            elif n3 == "gross bookings":
                glob_gb[fecha] += monto

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
                            + list(nr_b2b) + list(oc_api) + list(oc_html) + list(glob_gb))):
        if glob_gb.get(fecha):
            rows.append([fecha, scen_label, "Globales", "Others Countries", "Hotels",
                         "Net Revenue API Hoteles %GB",
                         round(glob_nr.get(fecha, 0.0) / glob_gb[fecha] * 100, 4)])
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
    s = str(raw).strip()
    if not s:
        return None
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


def _read_agencias_flat():
    """KR 'Monthly Buying Agencies' (B2B, peso 20) — del tracker en OneDrive
    (AGENCIAS_TRACKER), formato ancho: filas escenario×pais, columnas = meses.
    Se toma solo la fila Pais='Total'. El estado de la orden en el datalake muta
    con el tiempo → hay que congelar el conteo del snapshot mensual.
    Vida útil hasta Sep-2026; desde Oct-2026 cambia la lógica."""
    if not os.path.exists(AGENCIAS_TRACKER):
        print(f"  [Agencias] no encontrado: {AGENCIAS_TRACKER} — KR sin datos")
        return []
    import openpyxl
    wb = openpyxl.load_workbook(AGENCIAS_TRACKER, read_only=True, data_only=True)
    ws = wb.active
    it = ws.iter_rows(values_only=True)
    header = next(it, None)
    if not header:
        wb.close(); return []
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
        for ci, periodo in col_periodo.items():
            v = r[ci] if ci < len(r) else None
            if v in (None, ""):
                continue
            try:
                valor = round(float(v))
            except (TypeError, ValueError):
                continue
            rows.append([periodo, escenario, "B2B", "Total", "Total",
                         "Monthly Buying Agencies", valor])
    wb.close()
    print(f"  [Agencias] {len(rows)} filas de {os.path.basename(AGENCIAS_TRACKER)}"
          + (f" ({skipped} escenarios no reconocidos)" if skipped else ""))
    return rows


def _read_manual_krs(token_file):
    """Lee del GSheet Input_OKR los KRs manuales de MANUAL_KRS
    (Sign New Partnership, Air Net Revenue from suppliers)."""
    raw_rows = _read_sheet(token_file)
    SKIP = {"periodo", "escenario", "lob", "kr", "", None}
    rows = []
    skipped = 0
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
        # Solo el total (Pais=Total, Producto=Total) — si alguien agrega detalle
        # por país/producto en la sheet, no lo sumamos para evitar duplicar.
        if str(pais).strip().lower() != "total" or str(producto).strip().lower() != "total":
            skipped += 1
            continue
        periodo = _parse_date_sheet(periodo_raw)
        valor   = _parse_valor_sheet(valor_raw)
        if periodo is None or valor is None:
            skipped += 1
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
    return rows


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
    rows_agencias = _read_agencias_flat()

    all_rows = rows_baseline + rows_budget + rows_hunting + rows_manual + rows_agencias

    # Resumen
    print(f"\n  Total filas: {len(all_rows):,}")
    by_kr = defaultdict(int)
    for r in all_rows:
        by_kr[r[5]] += 1
    for kr, n in sorted(by_kr.items()):
        print(f"    {kr}: {n}")

    payload = {
        "meta": {
            "concepto":   "okr",
            "gestional_file_id":  GESTIONAL_FILE_ID,
            "baseline_file_id":   BASELINE_FILE_ID,
            "budget_file_id":     BUDGET_FILE_ID,
            "daily_b2b2c_file_id": DAILY_B2B2C_FILE_ID,
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

    if upload:
        _upload(local, svc)
    else:
        print("  (--no-upload)")

    return payload


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-upload", action="store_true")
    a = ap.parse_args()
    build(not a.no_upload)
