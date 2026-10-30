# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
"""
okr_sync.py
===========
1. Conecta al Datalake (Treasure Data vía ODBC)
2. Ejecuta la query de cada KR y computa el achievement %
3. Genera un JSON con la estructura final lista para renderizar
4. Sube el JSON a Google Drive

Run manual : python okr_sync.py
Scheduler  : Windows Task Scheduler → diario 08:00 AM
"""

import os
import html
import json
import warnings
from datetime import date, timedelta, datetime
from typing import Optional


def sql_source(query: str) -> str:
    """Fuente = la query SQL tal cual, para el panel de 'Fuentes de datos' del dashboard."""
    return f'<pre><code>{html.escape(query.strip())}</code></pre>'

import pandas as pd
from dotenv import load_dotenv

warnings.filterwarnings("ignore")

# ==============================================================================
# 1) CONFIGURACIÓN
# ==============================================================================

_win_user = os.environ.get("USERNAME", "").lower()
RUTA_ENV        = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "credenciales", f".env.{_win_user}")
DSN_NAME        = "DataLake Treasure ODBC"

TODAY     = date.today()
YESTERDAY = TODAY - timedelta(days=1)

# H1 FY27: Abril → Septiembre 2026
H1_PERIODS = ['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09']
QUARTERS   = [
    {'label': 'Q1', 'months': ['2026-04','2026-05','2026-06']},
    {'label': 'Q2', 'months': ['2026-07','2026-08','2026-09']},
]

# H2 FY26: Octubre 2025 → Marzo 2026 (baseline de comparación H vs H para KR3/KR4)
H2_FY26_PERIODS = ['2025-10','2025-11','2025-12','2026-01','2026-02','2026-03']

PARTNERS_TIER_1_2 = (
    "'latam-ar','latam-br','latam-br-canje','latam-cl','latam-cl-canje',"
    "'latam-co','latam-co-canje','latam-ec','latam-mx','latam-pe','latam-pe-canje',"
    "'YaVas','bbva-ar','bbva-co','bbva-pe','bbva-pe-loyalty','bbva-uy',"
    "'livelo-bb','livelo-ingresso','LiveloPontos','liverpool','viajes-naranja',"
    "'icbc','icbc-club-despegar','esfera-acumulo','esfera-ingresso',"
    "'mastercard-ingresso','mastercardgold-ingresso','scotiabankcl','bci-cl','Coopera'"
)

print(f"[{TODAY}]  Sincronizando OKRs Tribu Producto H1 FY27")

# ==============================================================================
# 2) CONEXIÓN
# ==============================================================================

load_dotenv(RUTA_ENV)
DB_USER     = os.getenv("USER")
DB_PASSWORD = os.getenv("PASSWORD")


_CONEXION = None  # se reutiliza entre fetch(); el driver TD falla seguido en la 1ra query de una conexión nueva


def conectar():
    global _CONEXION
    if _CONEXION is None:
        import pyodbc
        _CONEXION = pyodbc.connect(
            f"DSN={DSN_NAME};UID={DB_USER};PWD={DB_PASSWORD};",
            autocommit=True
        )
        # El driver TD falla en el primer query de una conexión nueva (cold-start);
        # un query trivial calienta la conexión antes de las queries reales.
        for _ in range(3):
            try:
                _CONEXION.cursor().execute("SELECT 1").fetchall()
                break
            except Exception:
                pass
    return _CONEXION


def reconectar():
    global _CONEXION
    if _CONEXION is not None:
        try:
            _CONEXION.close()
        except Exception:
            pass
        _CONEXION = None
    return conectar()


def fetch(query: str, label: str, retries: int = 5) -> pd.DataFrame:
    print(f"  > {label} ...")
    con = conectar()
    for attempt in range(1, retries + 1):
        try:
            df = pd.read_sql(query, con)
            print(f"  OK {len(df):,} filas")
            return df
        except Exception as e:
            if attempt == retries:
                raise
            print(f"  WARN intento {attempt}/{retries} falló ({e}), reintentando...")
            if attempt % 2 == 0:
                con = reconectar()


# ==============================================================================
# 3) HELPERS PARA COMPUTAR ACHIEVEMENT
# ==============================================================================

def achievement(actual: Optional[float], budget: Optional[float]) -> Optional[float]:
    if actual is None or budget is None or budget == 0:
        return None
    return round(actual / budget * 100, 2)


def quarterly_achievement(actuals_by_ym: dict, budget_by_ym: dict, quarter: dict, cumulative: bool) -> Optional[float]:
    if cumulative:
        available = [ym for ym in quarter['months'] if actuals_by_ym.get(ym) is not None and budget_by_ym.get(ym) is not None]
        if not available:
            return None
        last_ym = available[-1]
        return achievement(actuals_by_ym.get(last_ym), budget_by_ym.get(last_ym))
    # El target se suma solo en los meses con actual: con el trimestre en curso, Oct vs (Oct+Nov+Dic) daba ~1/3.
    sum_a = sum(actuals_by_ym[ym] for ym in quarter['months'] if ym in actuals_by_ym)
    sum_b = sum(budget_by_ym[ym]  for ym in quarter['months'] if ym in budget_by_ym and ym in actuals_by_ym)
    has_a = any(ym in actuals_by_ym for ym in quarter['months'])
    has_b = any(ym in budget_by_ym  for ym in quarter['months'])
    return achievement(sum_a if has_a else None, sum_b if has_b else None)


def h1_achievement(actuals_by_ym: dict, budget_by_ym: dict, cumulative: bool, periods: list = None) -> Optional[float]:
    """Cumplimiento del semestre (H1 por defecto; con periods, el semestre que se pase)."""
    periods = periods or H1_PERIODS
    if cumulative:
        last_ym = periods[-1]
        return achievement(actuals_by_ym.get(last_ym), budget_by_ym.get(last_ym))
    sum_a = sum(actuals_by_ym[ym] for ym in periods if ym in actuals_by_ym)
    sum_b = sum(budget_by_ym[ym]  for ym in periods if ym in budget_by_ym)
    has_a = any(ym in actuals_by_ym for ym in periods)
    has_b = any(ym in budget_by_ym  for ym in periods)
    return achievement(sum_a if has_a else None, sum_b if has_b else None)


def _quarterly_nominal(values_by_ym: dict, quarter: dict, cumulative: bool) -> Optional[float]:
    if cumulative:
        available = [ym for ym in quarter['months'] if values_by_ym.get(ym) is not None]
        if not available:
            return None
        return values_by_ym.get(available[-1])
    vals = [values_by_ym[ym] for ym in quarter['months'] if ym in values_by_ym]
    return round(sum(vals), 2) if vals else None


def _h1_nominal(values_by_ym: dict, cumulative: bool, periods: list = None) -> Optional[float]:
    periods = periods or H1_PERIODS
    if cumulative:
        return values_by_ym.get(periods[-1])
    vals = [values_by_ym[ym] for ym in periods if ym in values_by_ym]
    return round(sum(vals), 2) if vals else None


def build_kr_result(label: str, weight: int, actuals_by_ym: dict, budget_by_ym: dict, cumulative: bool = False, unit: str = '', source: str = '',
                    periods: list = None, quarters: list = None) -> dict:
    # periods / quarters: H1 por defecto; los KRs de H2 pasan H2_PERIODS / H2_QUARTERS. 'h1' = total del semestre.
    periods  = periods or H1_PERIODS
    quarters = quarters or QUARTERS
    monthly    = [achievement(actuals_by_ym.get(ym), budget_by_ym.get(ym)) for ym in periods]
    quarterly  = [quarterly_achievement(actuals_by_ym, budget_by_ym, q, cumulative) for q in quarters]
    h1         = h1_achievement(actuals_by_ym, budget_by_ym, cumulative, periods)
    return {
        'label': label, 'weight': weight, 'monthly': monthly, 'quarterly': quarterly, 'h1': h1,
        'unit': unit, 'source': source,
        # Valores nominales (actual/target crudos) detrás de cada %, para mostrar en el dashboard.
        'actualMonthly':   [actuals_by_ym.get(ym) for ym in periods],
        'budgetMonthly':   [budget_by_ym.get(ym)  for ym in periods],
        'actualQuarterly': [_quarterly_nominal(actuals_by_ym, q, cumulative) for q in quarters],
        'budgetQuarterly': [_quarterly_nominal(budget_by_ym,  q, cumulative) for q in quarters],
        'actualH1':        _h1_nominal(actuals_by_ym, cumulative, periods),
        'budgetH1':        _h1_nominal(budget_by_ym,  cumulative, periods),
    }


# ==============================================================================
# 4) KR1 — Activar 7 nuevos partners Tier I y II  (20%)
#    Budget acumulativo: 1-2-3-4-5-7  |  Actuals: igual (100% por ahora)
# ==============================================================================

def compute_kr1() -> dict:
    budget  = {'2026-04':1,'2026-05':2,'2026-06':3,'2026-07':4,'2026-08':5,'2026-09':7}
    actuals = dict(budget)   # 100% cada mes
    return build_kr_result(
        label      = 'Activar 7 nuevos partners Tier I/II',
        weight     = 20,
        actuals_by_ym = actuals,
        budget_by_ym  = budget,
        cumulative = True,
        unit       = 'partners activados',
        source     = 'Simulado — sin fuente real todavía.'
    )


# ==============================================================================
# 5) KR2 — Share usuarios Growth (2.8% → 17%)  (12%)
#    Actuals: share_tools_pct del lake  |  Budget: 17.0 constante
# ==============================================================================

KR2_QUERY = """
WITH monthly_actual AS (
    SELECT
        month(date_parse(date, '%Y-%m-%d')) AS mes,
        COUNT(DISTINCT userid)              AS total_users,
        COUNT(DISTINCT CASE WHEN
            (partner_id IN ({partners})
             AND regexp_like(url, '(?i)clt_apideeplinks=true'))
            OR
            (partner_id IN ({partners})
             AND plataforma IN ('App'))
        THEN userid END) AS tool_users
    FROM data.lake.bi_web_traffic
    WHERE date >= '2026-04-01'
      AND date <= CAST(current_date AS VARCHAR)
      AND partner_id IN ({partners})
    GROUP BY month(date_parse(date, '%Y-%m-%d'))
)
SELECT
    mes,
    ROUND(tool_users * 100.0 / NULLIF(total_users, 0), 4) AS share_tools_pct
FROM monthly_actual
ORDER BY mes
""".format(partners=PARTNERS_TIER_1_2)

MES_TO_YM = {4:'2026-04',5:'2026-05',6:'2026-06',7:'2026-07',8:'2026-08',9:'2026-09'}


def compute_kr2() -> dict:
    df = fetch(KR2_QUERY, "KR2 - Share usuarios Growth")
    actuals = {
        MES_TO_YM[int(row['mes'])]: float(row['share_tools_pct'])
        for _, row in df.iterrows() if int(row['mes']) in MES_TO_YM
    }
    budget = {ym: 17.0 for ym in H1_PERIODS}
    return build_kr_result(
        label      = 'Share usuarios Growth (2.8% → 17%)',
        weight     = 12,
        actuals_by_ym = actuals,
        budget_by_ym  = budget,
        cumulative = True,
        unit       = '% usuarios con tool Growth',
        source     = sql_source(KR2_QUERY)
    )


# ==============================================================================
# 6) KR3–KR7 — Pendientes (se agregan acá a medida que se definen las queries)
# ==============================================================================

KR3_KR4_QUERY = """
WITH partners_acumulacion AS (
    SELECT DISTINCT p.partner_name AS partner_code
    FROM data.lake.partner_feature pf
    JOIN data.lake.partner p ON p.id = pf.partner_id
    WHERE pf.code = 'WL_ACCUMULATION_FLOW'
      AND p.partner_name IN (
          'livelo-ingresso', 'esfera-acumulo', 'latam-br', 'KMV', 'Orbia',
          'Santander-shopping', 'latam-ar', 'latam-cl', 'latam-co',
          'latam-ec', 'latam-mx', 'latam-pe', 'uau-caixa'
      )
),
first_consumption AS (  -- un balance por redención (primer consumo)
    SELECT redemption_id, CAST(balance AS DOUBLE) AS balance,
           ROW_NUMBER() OVER (PARTITION BY redemption_id ORDER BY date ASC) AS rn
    FROM data.raw.specialclients_services_consumption
    WHERE partner_transaction_id IS NOT NULL
),
pnl_agg AS (
    SELECT CAST(m.transaction_code AS VARCHAR) AS transaction_code,
           SUM(m.gb_without_distorted_taxes_usd) AS gb_usd,
           SUM(m.net_revenues_usd) AS nr_usd
    FROM data.analytics.bi_pnlop_fact_current_model m
    WHERE m.date_reservation_year_month >= '2025-01'
    GROUP BY 1
),
acumulacion AS (
    SELECT ab.reservation_id, SUM(ab.accrual_points) AS puntos_acumulados
    FROM data.raw.accrual_booking ab
    JOIN data.analytics.bi_transactional_fact_transactions t ON t.transaction_code = ab.reservation_id
    JOIN partners_acumulacion pa ON pa.partner_code = t.partner_data_id
    WHERE t.reservation_year_month >= DATE '2025-01-01'
    GROUP BY 1
),
canje AS (  -- redención EMITIDA (ISSUED) -> tx real por reservation_id (modelo correcto)
    SELECT CAST(sr.reservation_id AS VARCHAR) AS transaction_code,
           SUM(fc.balance) AS puntos_canjeados
    FROM first_consumption fc
    JOIN data.raw.specialclients_services_redemption sr ON fc.redemption_id = sr.trip_id
    WHERE fc.rn = 1 AND sr.status = 'ISSUED'
      AND CAST(sr.creation_date AS DATE) >= DATE '2025-01-01'
    GROUP BY 1
)
SELECT
    YEAR(t.reservation_year_month)  AS anio,
    MONTH(t.reservation_year_month) AS mes,
    COUNT(DISTINCT CASE WHEN pa.partner_code IS NOT NULL THEN t.transaction_code END)    AS bookings_acumulacion,
    COUNT(DISTINCT CASE WHEN cj.transaction_code IS NOT NULL THEN t.transaction_code END) AS bookings_canje,
    SUM(CASE WHEN pa.partner_code IS NOT NULL THEN ac.puntos_acumulados END) AS puntos_acumulados_total,
    SUM(CASE WHEN pa.partner_code IS NOT NULL THEN pnl.gb_usd END)           AS gb_puntos_acumulados,
    SUM(CASE WHEN pa.partner_code IS NOT NULL THEN pnl.nr_usd END)           AS nr_puntos_acumulados,
    SUM(cj.puntos_canjeados)                                                 AS puntos_canjeados_total,
    SUM(CASE WHEN cj.transaction_code IS NOT NULL THEN pnl.gb_usd END)       AS gb_puntos_canjeados,
    SUM(CASE WHEN cj.transaction_code IS NOT NULL THEN pnl.nr_usd END)       AS nr_puntos_canjeados
FROM data.analytics.bi_transactional_fact_transactions t
LEFT JOIN partners_acumulacion pa ON pa.partner_code = t.partner_data_id
LEFT JOIN pnl_agg pnl             ON pnl.transaction_code = t.transaction_code
LEFT JOIN acumulacion ac          ON ac.reservation_id = t.transaction_code
LEFT JOIN canje cj                ON cj.transaction_code = t.transaction_code
WHERE t.reservation_year_month >= DATE '2025-01-01'
  AND t.line_of_business = 'B2B2C'
  AND (pa.partner_code IS NOT NULL OR cj.transaction_code IS NOT NULL)
GROUP BY 1, 2
ORDER BY 1, 2
"""


def _bookings_by_ym(metric: str) -> dict:
    """bookings_acumulacion / bookings_canje por 'YYYY-MM', desde KR3_KR4_QUERY (cacheada entre KR3 y KR4)."""
    global _KR3_KR4_DF
    if _KR3_KR4_DF is None:
        _KR3_KR4_DF = fetch(KR3_KR4_QUERY, "KR3/KR4 - Volumen canje/acumulación")
    out = {}
    for _, row in _KR3_KR4_DF.iterrows():
        ym = f"{int(row['anio'])}-{int(row['mes']):02d}"
        out[ym] = float(row[metric] or 0)
    return out


def _kr_h_vs_h(label: str, weight: int, metric: str, growth_pct: float, unit: str, source: str) -> dict:
    bookings = _bookings_by_ym(metric)
    baseline = sum(bookings.get(ym, 0) for ym in H2_FY26_PERIODS)
    target   = baseline * (1 + growth_pct / 100)

    actuals, cum = {}, 0.0
    for ym in H1_PERIODS:
        if ym not in bookings:
            break  # sin dato todavía para este mes (y los siguientes)
        cum += bookings[ym]
        actuals[ym] = cum
    budget = {ym: target for ym in H1_PERIODS}

    return build_kr_result(label, weight, actuals, budget, cumulative=True, unit=unit, source=source)


_KR3_KR4_DF = None

def compute_kr3() -> dict:
    return _kr_h_vs_h(
        'Volumen canje puntos/millas (+15%)', 20, 'bookings_canje', 15, 'bookings de canje (acum. H1)',
        sql_source(KR3_KR4_QUERY)
    )

def compute_kr4() -> dict:
    return _kr_h_vs_h(
        'Acumulación/Cashback puntos/millas (+5%)', 10, 'bookings_acumulacion', 5, 'bookings de acumulación (acum. H1)',
        sql_source(KR3_KR4_QUERY)
    )

KR5_QUERY = """
WITH target_vipas AS (
    SELECT
        vipa,
        CASE
            WHEN vipa_status = 'Done'
            THEN DATE_TRUNC('month', CAST(updated_date AS DATE))
            ELSE NULL
        END AS done_month
    FROM lake.jira_hour_reports_vipa
    WHERE vipa IN ('VIPA-235', 'VIPA-236', 'VIPA-237', 'VIPA-238')
),
months AS (
    SELECT month_start
    FROM UNNEST(SEQUENCE(
        DATE '2026-04-01',
        DATE '2026-09-01',
        INTERVAL '1' MONTH
    )) AS t(month_start)
),
cumulative AS (
    SELECT
        m.month_start,
        COUNT(v.vipa) AS vipas_done_acumulado
    FROM months m
    LEFT JOIN target_vipas v ON v.done_month <= m.month_start
    GROUP BY m.month_start
)
SELECT
    CAST(month_start AS VARCHAR) AS mes,
    ROUND(CAST(vipas_done_acumulado AS DOUBLE) / 4.0 * 100, 1) AS pct_cumplimiento
FROM cumulative
ORDER BY month_start
"""

def compute_kr5() -> dict:
    df = fetch(KR5_QUERY, "KR5 - Capacidades UI flexible")
    actuals = {}
    budget  = {}
    for _, row in df.iterrows():
        ym = str(row['mes'])[:7]
        if ym in H1_PERIODS:
            actuals[ym] = float(row['pct_cumplimiento'])
            budget[ym]  = 100.0
    return build_kr_result(
        label      = '4 capacidades UI flexible y configurable',
        weight     = 10,
        actuals_by_ym = actuals,
        budget_by_ym  = budget,
        cumulative = True,
        unit       = '% VIPAs completadas (de 4)',
        source     = sql_source(KR5_QUERY)
    )

PNL_WEBAPP_DEPLOYMENT_ID = "AKfycbz1KVq_b2V8UBEaXvcqJmlvS8e-gd2FAwQOcBV91rABnK7Lm33fTcYMPr_f7pdqNiCI"
PNL_WEBAPP_URL = f"https://script.google.com/macros/s/{PNL_WEBAPP_DEPLOYMENT_ID}/exec"

# Drive JSONs (carpeta: https://drive.google.com/drive/folders/1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV)
DRIVE_BUDGET_FILE_ID   = "1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW"   # budget.json
DRIVE_BASELINE_FILE_ID = "1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv"   # baseline_actuals+projections.json


def _clasp_access_token() -> str:
    """Reusa la sesión OAuth de clasp (~/.clasprc.json) para autenticar contra el webapp de Apps Script."""
    import requests
    clasprc_path = os.path.expanduser("~/.clasprc.json")
    with open(clasprc_path, "r", encoding="utf-8") as f:
        tok = json.load(f)["tokens"]["default"]
    r = requests.post("https://oauth2.googleapis.com/token", data={
        "client_id":     tok["client_id"],
        "client_secret": tok["client_secret"],
        "refresh_token": tok["refresh_token"],
        "grant_type":    "refresh_token",
    })
    r.raise_for_status()
    return r.json()["access_token"]


def _call_webapp(params: dict):
    """GET autenticado contra el webapp de Apps Script (doGet en Codigo.js).

    requests pierde el header Authorization al seguir el redirect de
    script.google.com -> script.googleusercontent.com (cambia de host), así
    que el redirect se sigue a mano reenviando el token.
    """
    import requests
    token = _clasp_access_token()
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(PNL_WEBAPP_URL, params=params, headers=headers, allow_redirects=False)
    while r.is_redirect or r.is_permanent_redirect:
        r = requests.get(r.headers["Location"], headers=headers, allow_redirects=False)
    r.raise_for_status()
    return r.json()


DRIVE_TOKEN_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "credenciales", f"drive_token.{_win_user}.json")

def _drive_access_token() -> str:
    """Devuelve un access token válido para Drive, leyendo/refrescando drive_token.json.

    Si drive_token.json no existe, lanzar un error claro indicando que hay que correr
    setup_drive_token.py primero.
    """
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request as GoogleRequest
    if not os.path.exists(DRIVE_TOKEN_PATH):
        raise FileNotFoundError(
            f"No se encontró {DRIVE_TOKEN_PATH}. "
            "Corré 'python setup_drive_token.py' una vez para autorizar el acceso a Drive."
        )
    creds = Credentials.from_authorized_user_file(DRIVE_TOKEN_PATH)
    if creds.expired and creds.refresh_token:
        creds.refresh(GoogleRequest())
        with open(DRIVE_TOKEN_PATH, "w") as f:
            f.write(creds.to_json())
    return creds.token


def fetch_pnl_from_drive(file_id: str, lob: str, pnl2_substr: str) -> dict:
    """Suma 'Monto USD' por mes (YYYY-MM) desde un JSON de Drive.

    Filtra por LoB (col 0) y P&L N2 contains pnl2_substr (col 5), case-insensitive.
    Usa drive_token.json (scope drive.readonly) — generado con setup_drive_token.py.
    """
    import requests
    print(f"  > Descargando Drive file {file_id} ...")
    token = _drive_access_token()
    r = requests.get(
        f"https://www.googleapis.com/drive/v3/files/{file_id}",
        params={"alt": "media"},
        headers={"Authorization": f"Bearer {token}"},
    )
    r.raise_for_status()
    data = r.json()

    cols      = data["cols"]
    lob_idx   = cols.index("LoB")
    pnl2_idx  = cols.index("P&L N2")
    fecha_idx = cols.index("Fecha")
    monto_idx = cols.index("Monto USD")

    lob_lower  = lob.lower()
    pnl2_lower = pnl2_substr.lower()
    monthly: dict = {}
    for row in data["rows"]:
        if str(row[lob_idx]).lower() != lob_lower:
            continue
        if pnl2_lower not in str(row[pnl2_idx]).lower():
            continue
        ym = str(row[fecha_idx])[:7]   # "2026-04-01" → "2026-04"
        monthly[ym] = monthly.get(ym, 0.0) + float(row[monto_idx])

    print(f"  OK {len(monthly)} meses encontrados")
    return monthly


def invalidate_dashboard_cache() -> None:
    """El dashboard cachea OKR_PAYLOAD 6h (CacheService); sin esto, la data recién publicada
    no se ve hasta que expire el cache. No hay botón manual en el dashboard, así que esto
    se llama automáticamente después de cada publish()."""
    data = _call_webapp({"invalidate": "1"})
    if not data.get("success"):
        raise RuntimeError(f"invalidateCache falló: {data.get('error')}")


DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV"

def compute_kr6() -> dict:
    actuals_raw = fetch_pnl_from_drive(DRIVE_BASELINE_FILE_ID, "b2b2c", "income from outsourced")
    budget_raw  = fetch_pnl_from_drive(DRIVE_BUDGET_FILE_ID,   "b2b2c", "income from outsourced")
    actuals = {ym: v for ym, v in actuals_raw.items() if ym in H1_PERIODS}
    budget  = {ym: v for ym, v in budget_raw.items()  if ym in H1_PERIODS}
    source  = (
        f'<a href="{DRIVE_FOLDER_URL}" target="_blank">Carpeta Drive PnL JSONs</a> — '
        f'<code>baseline_actuals+projections.json</code> (actuals + proyecciones meses futuros) '
        f'y <code>budget.json</code>, filtrando <code>LoB=b2b2c</code> · '
        f'<code>P&amp;L N2 contains "income from outsourced"</code>.'
    )
    return build_kr_result(
        label      = 'Net Revenue WL Modulares (Fcst)',
        weight     = 20,
        actuals_by_ym = actuals,
        budget_by_ym  = budget,
        cumulative = False,
        unit       = 'USD income from outsourced services',
        source     = source
    )

def compute_kr7() -> dict:
    # KR7: Capabilities de autogestión — peso 8% — TODO: query real
    mock = {ym: 100.0 for ym in H1_PERIODS}
    return build_kr_result(
        'Capabilities de autogestión', 8, mock, mock,
        unit='% (simulado, sin fuente real)',
        source='Simulado — sin fuente real todavía.'
    )


# ==============================================================================
# 6b) H2 FY27 (oct-26 → mar-27) — 4 KRs, definidos 2026-10-30
#   Strategic Partnership Activations (40%) = Deploy New Partnership del ecosistema (okr.json, Input_OKR):
#     mismo target y actual que el OKR del Hub.
#   Net Revenue Rewards Programs (20%), Acquisition, Retention, Repeat rate (20%) y Partner Retention Rate (20%):
#     sheet de la tribu "OKRs_Tribu B2B2C" (H2_SHEET_ID), una pestaña por KR.
#   Solo se muestran meses hasta el actual: Input_OKR ya trae cargados los actuals de meses futuros (= target).
# ==============================================================================

H2_PERIODS  = ['2026-10','2026-11','2026-12','2027-01','2027-02','2027-03']
H2_QUARTERS = [
    {'label': 'Q3', 'months': ['2026-10','2026-11','2026-12']},
    {'label': 'Q4', 'months': ['2027-01','2027-02','2027-03']},
]
CUR_YM = TODAY.strftime('%Y-%m')

H2_SHEET_ID  = "1x94gwcPBvxMYv3orWboEvDaQjmSS69Ab4vcoFXeHpNo"   # OKRs_Tribu B2B2C (mail de la tribu, 2026-10-30)
H2_SHEET_URL = f"https://docs.google.com/spreadsheets/d/{H2_SHEET_ID}/edit"
OKR_JSON_FILE_ID = "1cEidr8aoYgm4S7ugm05Wv-SMnz8GbtUj"            # okr.json (Inputs_Planning_PnL/okr_builder.py, desde Input_OKR)

# Partner Retention: NR de Partners_Base cargado como texto en la sheet (no suma en su fórmula). Valor corregido
# a mano: "462,678,100,00" → 4.626.781,00 (por el orden de la pestaña NR va entre viajes-naranja 5,5M y AP12934 5,0M).
# Revisar con la tribu; se usa solo si la celda no es un número.
NR_TEXT_FIX = {'latam-cl': 4626781.00}

_H2_SHEET = None


def _h2_sheet():
    """La sheet de la tribu exportada a .xlsx por Drive (drive.readonly alcanza; la API de Sheets no está habilitada)."""
    global _H2_SHEET
    if _H2_SHEET is None:
        import io as _io
        import requests
        import openpyxl
        print(f"  > Descargando sheet KRs H2 {H2_SHEET_ID} ...")
        r = requests.get(
            f"https://www.googleapis.com/drive/v3/files/{H2_SHEET_ID}/export",
            params={"mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
            headers={"Authorization": f"Bearer {_drive_access_token()}"},
        )
        r.raise_for_status()
        _H2_SHEET = openpyxl.load_workbook(_io.BytesIO(r.content), data_only=True)
    return _H2_SHEET


def _ym(v) -> Optional[str]:
    if v is None:
        return None
    if hasattr(v, 'strftime'):
        return v.strftime('%Y-%m')
    s = str(v).strip()
    return s[:7] if len(s) >= 7 and s[4] == '-' else None


def _upto_now(d: dict) -> dict:
    return {ym: v for ym, v in d.items() if ym <= CUR_YM}


def _num(v) -> Optional[float]:
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(',', '.'))
    except ValueError:
        return None


def compute_h2_partnerships() -> dict:
    import requests
    print(f"  > Descargando okr.json ({OKR_JSON_FILE_ID}) ...")
    r = requests.get(f"https://www.googleapis.com/drive/v3/files/{OKR_JSON_FILE_ID}", params={"alt": "media"},
                     headers={"Authorization": f"Bearer {_drive_access_token()}"})
    r.raise_for_status()
    js = r.json()
    cols = js["cols"]
    iP, iE, iL, iK, iV = (cols.index(c) for c in ("Periodo", "Escenario", "LoB", "KR", "Valor"))
    actuals, budget = {}, {}
    for row in js["rows"]:
        if str(row[iL]).lower() != 'b2b2c' or str(row[iK]).strip().lower() != 'deploy new partnership':
            continue
        ym = str(row[iP])[:7]
        if ym not in H2_PERIODS:
            continue
        esc = str(row[iE]).strip().lower()
        if esc == 'budget':
            budget[ym] = float(row[iV])
        elif esc == 'run rate/actuals':
            actuals[ym] = float(row[iV])
    return build_kr_result(
        'Strategic Partnership Activations (#)', 40, _upto_now(actuals), budget, cumulative=True,
        unit='partnerships activadas (acum. H2)',
        source=('Mismo KR que <strong>Deploy New Partnership</strong> del OKR del ecosistema (Hub y Daily): target y actual de la '
                'sheet <code>Input_OKR</code>, vía <code>okr.json</code> (<code>Inputs_Planning_PnL/okr_builder.py</code>), '
                '<code>LoB=B2B2C</code>. Acumulado: el trimestre toma el último mes. Se muestran solo meses hasta el actual.'),
        periods=H2_PERIODS, quarters=H2_QUARTERS)


def compute_h2_rewards() -> dict:
    ws = _h2_sheet()['Rewards Programs']
    actuals, budget = {}, {}
    for r in range(6, 20):
        ym = _ym(ws.cell(r, 1).value)
        if ym not in H2_PERIODS:
            continue
        meta = _num(ws.cell(r, 3).value)
        budget[ym] = (meta if meta is not None else 0.10) * 100
        up = _num(ws.cell(r, 2).value)
        if up is not None:
            actuals[ym] = up * 100
    return build_kr_result(
        'Net Revenue Rewards Programs', 20, _upto_now(actuals), budget, cumulative=True,
        unit='% uplift de usuarios compradores (meta ≥10% vs control)',
        source=(f'<a href="{H2_SHEET_URL}" target="_blank">Sheet OKRs_Tribu B2B2C</a>, pestaña <code>Rewards Programs</code> '
                '(carga manual de la tribu según los A/B tests: sesión dual y exploración sin login). Actual = '
                '<em>Uplift usuarios compradores</em>, target = <em>Meta</em> (10%). Acumulado: el trimestre toma el último mes cargado.'),
        periods=H2_PERIODS, quarters=H2_QUARTERS)


def compute_h2_partner_retention() -> dict:
    """% del NR de la tribu que generan los partners con ≥2 capabilities activas, recalculado desde la sheet.

    Misma regla que la sheet (capabilities_tracking + Partners_Base): una capability activada queda activada
    (máximo acumulado desde oct-26), y un partner suma su NR anualizado si tiene ≥2 activas ese mes. No se usa la
    pestaña Partner Retention Rate: sus fórmulas leen la columna de otro mes y deja afuera un NR cargado como texto.
    """
    wb = _h2_sheet()
    nr = {}
    for pid, val in wb['Partners_Base'].iter_rows(min_row=2, max_col=2, values_only=True):
        if not pid:
            continue
        v = _num(val) if isinstance(val, (int, float)) else None
        if v is None:
            if str(pid) in NR_TEXT_FIX:
                v = NR_TEXT_FIX[str(pid)]
                print(f"  WARN NR de {pid} cargado como texto ({val!r}): se usa {v:,.2f}")
            else:
                print(f"  WARN NR de {pid} no es un número ({val!r}): queda afuera")
                continue
        nr[str(pid)] = v
    raw = {}   # (partner, capability) -> {ym: 0/1}
    for pid, cap, mes, act, *_ in wb['capabilities_tracking'].iter_rows(min_row=2, max_col=5, values_only=True):
        ym = _ym(mes)
        if not pid or not cap or ym not in H2_PERIODS:
            continue
        raw.setdefault((str(pid), str(cap)), {})[ym] = 1 if (_num(act) or 0) >= 1 else 0
    total_nr = sum(nr.values())
    actuals, budget = {}, {}
    for ym in H2_PERIODS:
        budget[ym] = 50.0
        if ym > CUR_YM:
            continue
        active = {}
        for (pid, cap), by_m in raw.items():
            on = max((v for m, v in by_m.items() if m <= ym), default=0)   # una vez prendida, queda prendida
            active[pid] = active.get(pid, 0) + on
        computable = sum(nr.get(pid, 0) for pid, n in active.items() if n >= 2)
        actuals[ym] = round(computable / total_nr * 100, 2) if total_nr else None
        print(f"  Partner Retention {ym}: {computable:,.0f} / {total_nr:,.0f} = {actuals[ym]}%")
    return build_kr_result(
        'Partner Retention Rate', 20, actuals, budget, cumulative=True,
        unit='% del NR de la tribu en partners con ≥2 capabilities',
        source=(f'<a href="{H2_SHEET_URL}" target="_blank">Sheet OKRs_Tribu B2B2C</a>: <code>capabilities_tracking</code> '
                '(carga manual mensual) + <code>Partners_Base</code> (NR 2026 anualizado). Un partner cuenta si tiene ≥2 '
                'capabilities activas en el mes (una vez activada, queda activada); KR = NR de esos partners / NR total. '
                'Meta 50%. Recalculado acá: la pestaña <em>Partner Retention Rate</em> lee la columna de otro mes y deja afuera '
                'el NR de latam-cl (cargado como texto; se toma 4.626.781).'),
        periods=H2_PERIODS, quarters=H2_QUARTERS)


# Query de la tribu (pestaña Intent_Users), con baseline = promedio mensual abr-26 a sep-26 (H1 FY27, decisión
# 2026-10-30) en vez de oct-25 a mar-26. Meta: ≥8% sobre ese promedio, cada mes.
INTENT_QUERY = """
WITH partners AS (
    SELECT DISTINCT partner_id
    FROM raw.comdev_cartera_b2b2c_historic
    WHERE estatus_tier IN ('Tier-1', 'Tier-2')
      AND partner_homologado_2 NOT IN ('WL Hotels', 'Xcaret', 'livelo-api-hoteles')
      AND partner_id NOT LIKE 'AG%'
),
insider_company_partner AS (
    SELECT company_id, partner_id FROM (VALUES
        ('2842', 'viajes-naranja'),
        ('2951', 'bbva-ar'), ('2951', 'bbva-ar-premium'), ('2951', 'bbva-co'),
        ('2951', 'bbva-pe'), ('2951', 'bbva-pe-loyalty'), ('2951', 'bbva-uy'),
        ('5403', 'BNA'),
        ('5416', 'BNA-canje')
    ) AS t(company_id, partner_id)
),
insider_clicks AS (
    SELECT e.event.social_id, date(from_iso8601_timestamp(e.event.created_at)) AS click_date, cp.partner_id
    FROM data.sot.insider_email_events e
    JOIN insider_company_partner cp ON cp.company_id = CAST(e.event.company_id AS VARCHAR)
    WHERE e.event.event_type = 'email_click'
      AND e.datetime >= '2026-03-31'
      AND e.datetime <= CAST(current_date AS VARCHAR)
      AND e.event.social_id IS NOT NULL
),
capabilities AS (
    SELECT userid, date AS dt
    FROM data.lake.bi_web_traffic
    WHERE date >= '2026-04-01'
      AND date <= CAST(current_date AS VARCHAR)
      AND partner_id IN (SELECT partner_id FROM partners)
      AND flow IN ('SEARCH', 'CHECKOUT', 'DETAIL')
      AND (strpos(url, 'clt_apideeplinks=true') > 0 OR plataforma = 'App')
    UNION
    SELECT wt.userid, wt.date AS dt
    FROM insider_clicks ic
    JOIN data.lake.bi_web_traffic wt
      ON wt.despegarid = ic.social_id
     AND wt.partner_id = ic.partner_id
     AND date_parse(wt.date, '%Y-%m-%d') BETWEEN ic.click_date AND ic.click_date + INTERVAL '1' DAY
    WHERE wt.date >= '2026-04-01'
      AND wt.date <= CAST(current_date AS VARCHAR)
      AND wt.flow IN ('SEARCH', 'CHECKOUT', 'DETAIL')
      AND wt.despegarid IS NOT NULL
      AND wt.despegarid != ''
    UNION
    SELECT DISTINCT wt.userid, wt.date AS dt
    FROM data.sot.b2b2c_generic_event db
    JOIN data.lake.bi_web_traffic wt ON wt.pageview_id = db.pageview_id
    WHERE db.type = 'discount_booster'
      AND db.event = 'pageview'
      AND (db.validation_failed IS NULL OR db.validation_failed = false)
      AND db.event_date >= DATE '2026-10-13'
      AND db.event_date <= current_date
      AND wt.partner_id IN (SELECT partner_id FROM partners)
      AND wt.flow IN ('SEARCH', 'CHECKOUT', 'DETAIL')
      AND wt.date >= '2026-10-13'
      AND wt.date <= CAST(current_date AS VARCHAR)
)
SELECT
    substr(dt, 1, 7)       AS periodo,
    COUNT(DISTINCT userid) AS intent_users_caps
FROM capabilities
GROUP BY substr(dt, 1, 7)
ORDER BY 1
"""

INTENT_BASELINE = ['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09']
INTENT_GROWTH   = 8   # %


def compute_h2_intent() -> dict:
    df = fetch(INTENT_QUERY, "H2 - Intent users con growth capabilities")
    users = {str(r['periodo']): float(r['intent_users_caps']) for _, r in df.iterrows()}
    base = [users[ym] for ym in INTENT_BASELINE if ym in users]
    baseline = sum(base) / len(base) if base else None
    print(f"  Intent users baseline abr-sep 26: {baseline}")
    target = round(baseline * (1 + INTENT_GROWTH / 100), 0) if baseline else None
    budget = {ym: target for ym in H2_PERIODS} if target else {}
    actuals = {ym: v for ym, v in users.items() if ym in H2_PERIODS}
    return build_kr_result(
        'Acquisition, Retention, Repeat rate', 20, _upto_now(actuals), budget, cumulative=False,
        unit=f'intent users con growth capabilities (meta: baseline abr-sep 26 {baseline:,.0f} +{INTENT_GROWTH}%)' if baseline
             else 'intent users con growth capabilities',
        source=(f'Query de la tribu (<a href="{H2_SHEET_URL}" target="_blank">sheet OKRs_Tribu B2B2C</a>, pestaña '
                '<code>Intent_Users</code>): usuarios únicos con intent (SEARCH / CHECKOUT / DETAIL) en partners Tier 1 y 2 '
                'atribuidos a Deep Links, SDK, Insider o Discount Booster. Target mensual = promedio mensual abr-26 a sep-26 '
                f'(H1 FY27) +{INTENT_GROWTH}%. El trimestre suma los meses. El mes en curso va parcial.'
                + sql_source(INTENT_QUERY)),
        periods=H2_PERIODS, quarters=H2_QUARTERS)


def build_h2() -> dict:
    print("\n--- Computando KRs H2 ---")
    kr_list = [compute_h2_rewards(), compute_h2_partnerships(), compute_h2_intent(), compute_h2_partner_retention()]
    totals = compute_total(kr_list, H2_PERIODS, H2_QUARTERS)
    return {
        "label":          "OKRs Tribu Producto · B2B2C",
        "quarters":       [q['label'] for q in H2_QUARTERS],
        "periods":        H2_PERIODS,
        "krs":            kr_list,
        "totalMonthly":   totals['totalMonthly'],
        "totalQuarterly": totals['totalQuarterly'],
        "h1Total":        totals['h1Total'],
    }


# ==============================================================================
# 7) CONSTRUIR JSON FINAL
# ==============================================================================

def compute_total(kr_list: list, periods: list = None, quarters: list = None) -> dict:
    """Promedio ponderado mensual / trimestral / semestral sobre todos los KRs (H1 por defecto)."""
    periods  = periods or H1_PERIODS
    quarters = quarters or QUARTERS
    def weighted(values_by_kr):
        total_w = sum(kr['weight'] for kr in kr_list if values_by_kr(kr) is not None)
        if total_w == 0:
            return None
        # Promedio ponderado sobre los pesos de los KRs CON dato ese período — dividir por
        # el fijo 100 (en vez de total_w) subestima el total cuando algún KR todavía no tiene actual.
        return round(sum(values_by_kr(kr) * kr['weight'] for kr in kr_list if values_by_kr(kr) is not None) / total_w, 2)

    total_monthly   = [weighted(lambda kr, i=i: kr['monthly'][i])   for i in range(len(periods))]
    total_quarterly = [weighted(lambda kr, qi=qi: kr['quarterly'][qi]) for qi in range(len(quarters))]
    h1_total        = weighted(lambda kr: kr['h1'])
    return {'totalMonthly': total_monthly, 'totalQuarterly': total_quarterly, 'h1Total': h1_total}


# Meses sin datos confiables todavía — se pisan a "sin dato" en TODOS los KRs solo los
# meses en curso o futuros. Septiembre cerró el 2026-10-08: H1 (abr-sep) completo, nada que
# enmascarar. Tiene que ser un mes de H1_PERIODS (si no, .index() falla).
MASK_MONTHS = []
MASK_QUARTERS = []  # Q2 visible (jul-sep con dato)


def mask_unreliable_months(kr_list: list) -> None:
    for kr in kr_list:
        for ym in MASK_MONTHS:
            i = H1_PERIODS.index(ym)
            kr['monthly'][i]       = None
            kr['actualMonthly'][i] = None
            kr['budgetMonthly'][i] = None
        for qi in MASK_QUARTERS:
            kr['quarterly'][qi]       = None
            kr['actualQuarterly'][qi] = None
            kr['budgetQuarterly'][qi] = None


def build_payload() -> dict:
    print("\n--- Computando KRs ---")
    kr1 = compute_kr1(); print("  KR1 ok")
    kr2 = compute_kr2(); print("  KR2 ok")
    kr3 = compute_kr3(); print("  KR3 ok")
    kr4 = compute_kr4(); print("  KR4 ok")
    kr5 = compute_kr5(); print("  KR5 ok")
    kr6 = compute_kr6(); print("  KR6 ok")
    kr7 = compute_kr7(); print("  KR7 pendiente")

    kr_list = [kr1, kr2, kr3, kr4, kr5, kr6, kr7]
    mask_unreliable_months(kr_list)
    totals  = compute_total(kr_list)

    return {
        "meta": {
            "generated_at":      datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "last_actuals_date": str(YESTERDAY),
        },
        "okr": {
            "producto": {
                "label":          "OKRs Tribu Producto · B2B2C",
                "quarters":       [q['label'] for q in QUARTERS],
                "periods":        H1_PERIODS,
                "krs":            kr_list,
                "totalMonthly":   totals['totalMonthly'],
                "totalQuarterly": totals['totalQuarterly'],
                "h1Total":        totals['h1Total'],
            }
        },
        # H2 FY27: mismo formato que "okr"; el dashboard abre en H2 y tiene selector H1 | H2.
        "okr_h2": {
            "producto": build_h2()
        }
    }


# ==============================================================================
# 8) PUBLICAR: generar okr_data.js y pushear con clasp
# ==============================================================================

import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def _git_pull_or_abort() -> None:
    """Trae main antes de publicar: clasp push sube la copia LOCAL, así que sin pull una
    máquina atrasada pisa producción con código viejo (mismo bug que ya se corrigió en
    Daily_Dashboard/auto_update_reales.ps1). Auditoría 2026-09-25."""
    repo = os.path.dirname(SCRIPT_DIR)
    # okr_data.js se regenera en cada corrida (ya no se versiona): se descarta la copia
    # anterior para que no bloquee el pull.
    subprocess.run(['git', 'checkout', '--', 'OKR_Producto_B2B2C/okr_data.js'], cwd=repo,
                   capture_output=True, text=True)
    r = subprocess.run(['git', 'pull', '--ff-only', 'origin', 'main'], cwd=repo,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError('git pull falló — no se publica código desactualizado: ' + r.stderr)
    print('  OK git pull')


def publish(payload: dict) -> None:
    _git_pull_or_abort()
    raw      = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    data_path = os.path.join(SCRIPT_DIR, 'okr_data.js')
    with open(data_path, 'w', encoding='utf-8') as f:
        f.write('// AUTO-GENERATED por okr_sync.py — no editar manualmente\n')
        f.write('var OKR_PAYLOAD = ')
        f.write(raw)
        f.write(';\n')
    print(f"  OK okr_data.js generado ({len(raw)} bytes)")

    r = subprocess.run(['clasp.cmd', 'push', '--force'], cwd=SCRIPT_DIR,
                       capture_output=True, text=True, shell=False)
    if r.returncode != 0:
        raise RuntimeError(f'clasp push falló:\n{r.stderr}')
    print(f"  OK clasp push")

    # deploymentId fijo: "clasp deploy" sin id crea un deployment nuevo (URL nueva)
    # cada vez que hay ambigüedad, dejando huérfano el bookmark del dashboard.
    r2 = subprocess.run(['clasp.cmd', 'deploy', '--deploymentId', PNL_WEBAPP_DEPLOYMENT_ID],
                        cwd=SCRIPT_DIR, capture_output=True, text=True, shell=False)
    if r2.returncode != 0:
        raise RuntimeError(f'clasp deploy falló:\n{r2.stderr}')
    print(f"  OK clasp deploy: {r2.stdout.strip()}")

    invalidate_dashboard_cache()
    print("  OK cache invalidado")


# Ownia (2026-10-30): el dashboard corre también en Ownia (/b2b-ecosystem/okr-b2b2c) y lee el mismo payload
# como JSON de esta carpeta de Drive (Ownia_B2B_Ecosystem/server/gas-extras/okr-payload.js), que se manda en el
# mismo paso a Ownia (doble escritura, mirror/ownia_publish.py). Usa el login de Drive de los uploaders del P&L
# (Inputs_Planning_PnL/token_drive.json): el drive_token de este módulo es de solo lectura.
OWNIA_FOLDER_ID = "1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh"
OWNIA_JSON_NAME = "okr_tribu_producto.json"


def publish_drive_ownia(payload: dict) -> None:
    import sys as _sys
    from googleapiclient.http import MediaIoBaseUpload
    repo = os.path.dirname(SCRIPT_DIR)
    _sys.path.insert(0, os.path.join(repo, "Inputs_Planning_PnL"))
    _sys.path.insert(0, os.path.join(repo, "Ownia_B2B_Ecosystem", "mirror"))
    from pnl_common import get_drive_service
    from ownia_publish import DRIVE_FIELDS, publish_after_drive   # doble escritura Drive + Ownia

    content = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    svc = get_drive_service()
    q = f"name='{OWNIA_JSON_NAME}' and '{OWNIA_FOLDER_ID}' in parents and trashed=false"
    ex = svc.files().list(q=q, fields="files(id,name)").execute().get("files", [])
    media = MediaIoBaseUpload(io.BytesIO(content), mimetype="application/json", resumable=True)
    if ex:
        res = svc.files().update(fileId=ex[0]["id"], media_body=media, fields=DRIVE_FIELDS).execute()
    else:
        res = svc.files().create(body={"name": OWNIA_JSON_NAME, "parents": [OWNIA_FOLDER_ID]},
                                 media_body=media, fields=DRIVE_FIELDS).execute()
    print(f"  OK Drive: {OWNIA_JSON_NAME} ({len(content)} bytes)")
    publish_after_drive(res, content)


# ==============================================================================
# 9) MAIN
# ==============================================================================
#   python okr_sync.py                  → Drive + Ownia + Apps Script
#   python okr_sync.py --solo-ownia     → Drive + Ownia (sin clasp)
#   python okr_sync.py --json <ruta>    → solo escribe el payload a un archivo (no publica nada)

args = sys.argv[1:]
payload = build_payload()

if "--json" in args:
    out = args[args.index("--json") + 1]
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
    print(f"\nOK payload en {out} (sin publicar)")
    sys.exit(0)

print("\n--- Publicando en Drive + Ownia ---")
try:
    publish_drive_ownia(payload)
except Exception as e:   # Ownia está en validación: un error acá no frena la publicación en Apps Script
    print(f"  WARN Drive/Ownia: no se pudo publicar {OWNIA_JSON_NAME} ({e})")

if "--solo-ownia" in args:
    print(f"\nOK Completado (solo Drive + Ownia): {TODAY.strftime('%d-%m-%Y')}")
    sys.exit(0)

print("\n--- Publicando en Apps Script ---")
publish(payload)

print(f"\nOK Completado: {TODAY.strftime('%d-%m-%Y %H:%M')}")
