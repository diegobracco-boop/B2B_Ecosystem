# -*- coding: utf-8 -*-
"""
weekly_gestional_builder.py
===========================
Apertura semanal de P&L Managerial: arma _actuals_gestional_weekly.json con Actuals, Budget y LY por semana
(lunes a domingo). Solo semanas completas: del inicio del FY al último domingo con datos.

Por qué un archivo aparte: el JSON mensual lo leen Managerial vs Accounting, los OKR y Forecast goal, y con
semanas pesaría unas 5 veces más. Acá no se escribe SQL ni reglas de negocio: las queries y los armadores de
filas se extraen de actuals_gestional_upload.py por AST (nunca se ejecuta el resto de ese script), y solo se
agrega la columna de la semana a las queries. Si esas queries cambian, esto las sigue; si cambian tanto que el
agregado no aplica, corta con error.

Filas: mismas que el JSON mensual con ym = "<lunes>|<ym>" (ej. "2026-10-26|2026-10"). La semana que cruza dos
meses queda en dos filas: el organic usa el TC del mes de cada parte, y la suma por ym se puede conciliar
contra el mensual.
  b2b2c:           [pais, partner, produto, ym, v0..v28]        secciones bl, bgt, ly
  b2b_may/b2b_min: [pais, produto, ym, v0..v28, viaje]          secciones bl, bl_ri, bgt, bgt_ri, ly
Forecast no está: los modelos XLSX son mensuales. Tipo de producto, millas y gateway tampoco.

LY = misma semana del año anterior: 364 días antes (lunes contra lunes).

Antes de escribir concilia contra _actuals_gestional.json (--monthly <archivo>, por default el de _store de
Ownia): GB, NR y FVM por LoB y mes cerrado. Corta si algo difiere más de 0,5 %.

Uso:
  python weekly_gestional_builder.py            arma _gestional_out/_actuals_gestional_weekly.json
  python weekly_gestional_builder.py --upload   además lo sube a Drive y a Ownia
"""
import ast
import io
import json
import os
import sys
import warnings
from datetime import date, datetime, timedelta
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
warnings.filterwarnings("ignore")

import pandas as pd

HERE = Path(__file__).resolve().parent
UPLOAD_PY = HERE / "actuals_gestional_upload.py"
JSON_NAME = "_actuals_gestional_weekly.json"
OUT_FILE = HERE / "_gestional_out" / JSON_NAME
TOLERANCIA = 0.005
LY_DIAS = 364

sys.path.insert(0, str(HERE.parent / "Inputs_Planning_PnL"))
sys.path.insert(0, str(HERE.parent / "Daily_Dashboard"))
sys.path.insert(0, str(HERE))
import config as _planning_cfg
import hunting_rules
from pais_rules import apply_pais_overrides
from rg_rows import append_rg_rows
from b2b_lob_rules import B2B_LOB_IN, normalize_b2b_lob   # fetch() y las queries B2B de actuals_gestional_upload.py
from dotenv import load_dotenv

ROOTS = ["fetch", "build_b2b2c_query", "build_b2b_gd_query", "build_b2b_ri_query", "_build_b2b2c_rows", "_build_b2b_rows",
         "_build_b2b2c_budget_rows", "_build_b2b_budget_rows", "upload_to_drive", "_parse_fecha_budget",
         "B2B2C_BUDGET_QUERY", "B2B_BUDGET_GD_QUERY", "B2B_BUDGET_RI_QUERY", "METRIC_COLS", "DRIVE_FOLDER_ID"]


def _load_pipeline():
    """Ejecuta solo los nodos top-level (funciones y asignaciones) que necesitan ROOTS, en el orden del archivo.
    Mismo criterio que check_b2b_query_drift.py: ninguna query, ningún upload."""
    load_dotenv(HERE.parent / "credenciales" / f".env.{os.environ.get('USERNAME', '').lower()}")   # conectar() lee USER / PASSWORD
    src = UPLOAD_PY.read_text(encoding="utf-8")
    tree = ast.parse(src)
    # Nada de la sección MAIN: ahí están las queries reales y el upload. Una variable local con el mismo nombre
    # que una asignación de esa sección no tiene que arrastrarla.
    main_line = next((i for i, l in enumerate(src.splitlines(), 1) if "# 6) MAIN" in l), None)
    if main_line is None:
        sys.exit(f"No encontré la sección MAIN en {UPLOAD_PY.name}: revisar la extracción antes de correr.")
    top = {}
    for node in tree.body:
        if node.lineno >= main_line:
            break
        if isinstance(node, ast.FunctionDef):
            top[node.name] = node
        elif isinstance(node, ast.Assign):
            for tg in node.targets:
                for n in (tg.elts if isinstance(tg, ast.Tuple) else [tg]):
                    if isinstance(n, ast.Name):
                        top.setdefault(n.id, node)
    missing = [r for r in ROOTS if r not in top]
    if missing:
        sys.exit(f"No se encontraron en {UPLOAD_PY.name}: {missing}")
    needed, stack = set(), list(ROOTS)
    while stack:
        name = stack.pop()
        if name in needed or name not in top:
            continue
        needed.add(name)
        stack.extend(n.id for n in ast.walk(top[name]) if isinstance(n, ast.Name))
    nodes = {id(top[n]): top[n] for n in needed}
    body = sorted(nodes.values(), key=lambda n: n.lineno)
    env = {"__file__": str(UPLOAD_PY), "pd": pd, "date": date, "datetime": datetime, "timedelta": timedelta, "os": os, "sys": sys, "Path": Path,
           "_planning_cfg": _planning_cfg, "hunting_rules": hunting_rules, "apply_pais_overrides": apply_pais_overrides,
           "append_rg_rows": append_rg_rows, "load_dotenv": load_dotenv,
           "B2B_LOB_IN": B2B_LOB_IN, "normalize_b2b_lob": normalize_b2b_lob}
    exec(compile(ast.Module(body=body, type_ignores=[]), str(UPLOAD_PY), "exec"), env)
    return env


P = _load_pipeline()
METRIC_COLS = P["METRIC_COLS"]
fetch = P["fetch"]


def _replace_once(sql: str, old: str, new: str, label: str) -> str:
    if sql.count(old) != 1:
        sys.exit(f"{label}: se esperaba 1 vez «{old[:70]}» y hay {sql.count(old)}. Cambió la query de actuals_gestional_upload.py: revisar el agregado de la semana.")
    return sql.replace(old, new)


def _week(expr: str) -> str:
    return f"CAST(date_trunc('week', {expr}) AS VARCHAR) AS semana,"


def q_b2b2c(d0, d1):
    q = P["build_b2b2c_query"](d0, d1)
    q = _replace_once(q, "date_format(t.confirmation_date, '%Y-%m') AS Mes,",
                      "date_format(t.confirmation_date, '%Y-%m') AS Mes,\n    " + _week("t.confirmation_date"), "B2B2C")
    q = _replace_once(q, "GROUP BY 1,2,3,4,5,6,7\n", "GROUP BY 1,2,3,4,5,6,7,8\n", "B2B2C")
    return _replace_once(q, "  Mes, pais, productooriginal,", "  Mes, semana, pais, productooriginal,", "B2B2C")


def q_b2b_gd(d0, d1):
    q = P["build_b2b_gd_query"](d0, d1)
    q = _replace_once(q, "CAST(YEAR(fh.gestion_date) AS VARCHAR) AS anio_gd,", _week("fh.gestion_date") + "\n        CAST(YEAR(fh.gestion_date) AS VARCHAR) AS anio_gd,", "B2B GD")
    return _replace_once(q, "    anio_gd, mes_gd, pais,", "    semana, anio_gd, mes_gd, pais,", "B2B GD")


def q_b2b_ri(d0, d1):
    fecha = "CASE WHEN fh.parent_channel = 'API' AND fh.buy_type_code = 'Hoteles' THEN p.checkin_date ELSE fh.recognition_date END"
    q = P["build_b2b_ri_query"](d0, d1)
    q = _replace_once(q, "        CAST(\n            CASE WHEN fh.parent_channel = 'API' AND fh.buy_type_code = 'Hoteles'\n                 THEN YEAR(p.checkin_date)",
                      "        " + _week(fecha) + "\n        CAST(\n            CASE WHEN fh.parent_channel = 'API' AND fh.buy_type_code = 'Hoteles'\n                 THEN YEAR(p.checkin_date)", "B2B RI")
    return _replace_once(q, "    anio_ri, mes_ri, pais,", "    semana, anio_ri, mes_ri, pais,", "B2B RI")


def _lunes(x) -> str:
    return str(x)[:10]


def _tag(rows, i_ym, wk):
    for r in rows:
        r[i_ym] = f"{wk}|{r[i_ym]}"
    return rows


def _by_week(df, build, i_ym, shift=0, weeks=None):
    """Arma las filas semana por semana con el armador mensual: el grano de la semana lo pone este loop."""
    col = next(c for c in df.columns if c.lower() == "semana")
    out = []
    for wk, g in df.groupby(df[col].map(_lunes)):
        key = str(date.fromisoformat(wk) + timedelta(days=shift))
        if weeks is not None and key not in weeks:
            continue
        out.extend(_tag(build(g), i_ym, key))
    return out


def _budget_by_week(df, build, i_ym, d0, d1, weeks):
    df = df.copy()
    col = next(c for c in df.columns if c.lower() == "fecha")
    f = P["_parse_fecha_budget"](df[col])
    df = df[(f >= pd.Timestamp(d0)) & (f <= pd.Timestamp(d1))]
    f = f.loc[df.index]
    df["semana"] = (f - pd.to_timedelta(f.dt.weekday, unit="D")).dt.strftime("%Y-%m-%d")
    return _by_week(df, build, i_ym, weeks=weeks)


# ── Fechas ────────────────────────────────────────────────────────────────────
TODAY = date.today()
_FY = _planning_cfg.CURRENT_FY
FROM = date(_FY - 1, 4, 1)
_ayer = TODAY - timedelta(days=1)
TO = _ayer - timedelta(days=(_ayer.weekday() + 1) % 7)     # último domingo con datos
LY_FROM, LY_TO = FROM - timedelta(days=LY_DIAS), TO - timedelta(days=LY_DIAS)
if TO < FROM:
    sys.exit("Todavía no hay semanas completas en este FY.")
_first_monday = FROM - timedelta(days=FROM.weekday())
WEEKS = [str(_first_monday + timedelta(days=7 * i)) for i in range((TO - _first_monday).days // 7 + 1)]
WEEK_SET = set(WEEKS)
ALL_YM = {f"{y}-{m:02d}" for y in (_FY - 2, _FY - 1, _FY) for m in range(1, 13)}
print(f"[{TODAY}] Semanas {WEEKS[0]} a {WEEKS[-1]} ({len(WEEKS)})  |  Actuals {FROM} a {TO}  |  LY {LY_FROM} a {LY_TO}")

# ── Datos ─────────────────────────────────────────────────────────────────────
df_c = fetch(q_b2b2c(FROM, TO), "B2B2C actuals")
df_c_ly = fetch(q_b2b2c(LY_FROM, LY_TO), "B2B2C LY")
stage = hunting_rules.stage_map(fetch(hunting_rules.CARTERA_STAGE_QUERY, "Cartera stage"))
df_gd = fetch(q_b2b_gd(FROM, TO), "B2B GD actuals")
df_gd_ly = fetch(q_b2b_gd(LY_FROM, LY_TO), "B2B GD LY")
df_ri = fetch(q_b2b_ri(FROM, TO), "B2B RI actuals")
df_bg_c = fetch(P["B2B2C_BUDGET_QUERY"], "B2B2C budget")
df_bg_gd = fetch(P["B2B_BUDGET_GD_QUERY"], "B2B Budget GD")
df_bg_ri = fetch(P["B2B_BUDGET_RI_QUERY"], "B2B Budget RI")

# ── Filas ─────────────────────────────────────────────────────────────────────
print("Armando filas…")
c_rows = lambda g: P["_build_b2b2c_rows"](g, filter_set=ALL_YM)
def b_rows(canal, y, m):
    return lambda g: P["_build_b2b_rows"](g, y, m, channel_filter=canal, filter_set=ALL_YM)
def _section(canal, lob):
    return {
        "bl": _by_week(df_gd, b_rows(canal, "anio_gd", "mes_gd"), 2),
        "bl_ri": _by_week(df_ri, b_rows(canal, "anio_ri", "mes_ri"), 2),
        "bgt": _budget_by_week(df_bg_gd, lambda g: P["_build_b2b_budget_rows"](g, lob_filter=lob), 2, FROM, TO, WEEK_SET),
        "bgt_ri": _budget_by_week(df_bg_ri, lambda g: P["_build_b2b_budget_rows"](g, lob_filter=lob), 2, FROM, TO, WEEK_SET),
        "ly": _by_week(df_gd_ly, b_rows(canal, "anio_gd", "mes_gd"), 2, shift=LY_DIAS, weeks=WEEK_SET),
    }
out = {
    "generated_at": datetime.now().isoformat(timespec="seconds"),
    "weeks": WEEKS, "desde": str(FROM), "hasta": str(TO), "ly_dias": LY_DIAS,
    "metrics": METRIC_COLS, "b2b2c_stage": stage,
    "b2b2c": {
        "bl": _by_week(df_c, c_rows, 3),
        "bgt": _budget_by_week(df_bg_c, P["_build_b2b2c_budget_rows"], 3, FROM, TO, WEEK_SET),
        "ly": _by_week(df_c_ly, c_rows, 3, shift=LY_DIAS, weeks=WEEK_SET),
    },
    "b2b_may": _section("API", "B2B-MAY"),
    "b2b_min": _section("Agencias afiliadas", "B2B-MIN"),
}
for s in ("b2b2c", "b2b_may", "b2b_min"):
    print(f"  {s}: " + ", ".join(f"{k} {len(v):,}" for k, v in out[s].items()))

# ── Conciliación contra el mensual ────────────────────────────────────────────
monthly_path = None
if "--monthly" in sys.argv:
    monthly_path = Path(sys.argv[sys.argv.index("--monthly") + 1])
else:
    store = HERE.parent / "Ownia_B2B_Ecosystem" / "_store"
    idx = json.loads((store / "_index.json").read_text(encoding="utf-8")) if (store / "_index.json").exists() else {}
    for fid in ("1wvle0UIVZV7ocCSl8OawOfIGVz_It5kh",):
        cands = list(store.rglob(f"*{fid}*")) if store.exists() else []
        cands = [c for c in cands if c.is_file()]
        if cands:
            monthly_path = cands[0]
if not monthly_path or not monthly_path.exists():
    sys.exit("No encontré el JSON mensual para conciliar (--monthly <archivo>). NO se escribe nada.")
print(f"Conciliando contra {monthly_path}")
M = json.loads(monthly_path.read_text(encoding="utf-8"))
closed = [ym for ym in M.get("actual_months", []) if str(FROM)[:7] <= ym and ym <= str(TO)[:7] and date(int(ym[:4]) + (ym[5:] == "12"), int(ym[5:]) % 12 + 1, 1) - timedelta(days=1) <= TO]
I = {m: METRIC_COLS.index(m) for m in ("gross_bookings", "net_revenue", "npv")}


def _sum(rows, off, iym, composite):
    t = {}
    for r in rows:
        if r[0] == "RG":
            continue
        ym = r[iym].split("|")[1] if composite else r[iym]
        d = t.setdefault(ym, dict.fromkeys(I, 0.0))
        for m, i in I.items():
            d[m] += r[off + i] or 0
    return t


fallas, filas = [], []
for sec, key_w, key_m, off, iym in [("b2b2c", "bl", "ac", 4, 3), ("b2b_may", "bl", "ac", 3, 2), ("b2b_min", "bl", "ac", 3, 2),
                                    ("b2b_may", "bl_ri", "ac_ri", 3, 2), ("b2b_min", "bl_ri", "ac_ri", 3, 2),
                                    ("b2b2c", "bgt", "bgt", 4, 3), ("b2b_may", "bgt", "bgt", 3, 2), ("b2b_min", "bgt", "bgt", 3, 2),
                                    ("b2b_may", "bgt_ri", "bgt_ri", 3, 2), ("b2b_min", "bgt_ri", "bgt_ri", 3, 2)]:
    w = _sum(out[sec][key_w], off, iym, True)
    m = _sum(M[sec].get(key_m, []), off, iym, False)
    for ym in closed:
        for met in I:
            a, b = w.get(ym, {}).get(met, 0.0), m.get(ym, {}).get(met, 0.0)
            dif = abs(a - b) / abs(b) if abs(b) > 1 else abs(a - b)
            filas.append((sec, key_w, ym, met, a, b, dif))
            if dif > TOLERANCIA and abs(a - b) > 1000:
                fallas.append((sec, key_w, ym, met, round(a), round(b), f"{dif:.2%}"))
print(f"  {len(filas)} comparaciones en {len(closed)} meses cerrados ({closed[0]} a {closed[-1]}); desvío máximo {max(f[6] for f in filas):.3%}; fuera de tolerancia: {len(fallas)}")
for f in fallas[:40]:
    print("  DIFIERE", f)

OUT_FILE.parent.mkdir(exist_ok=True)
payload = json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
OUT_FILE.with_suffix(".check.json" if fallas else ".json").write_bytes(payload)
print(f"{len(payload) / 1e6:.1f} MB en {OUT_FILE.with_suffix('.check.json' if fallas else '.json')}")
if fallas:
    sys.exit("La conciliación no cierra: el archivo quedó como .check.json y NO se publica.")
if "--upload" in sys.argv:
    P["JSON_FILE_NAME"] = JSON_NAME
    P["upload_to_drive"](payload)
print("OK")
