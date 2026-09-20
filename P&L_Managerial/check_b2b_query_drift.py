# -*- coding: utf-8 -*-
"""
check_b2b_query_drift.py
=========================
Compara los totales (GB/NR/FVM por país, un mes) que devuelven las queries
B2B GD/RI de `Daily_Dashboard/daily_sync.py` (versión oficial) contra las de
`P&L_Managerial/actuals_gestional_upload.py` (copia independiente, mismo
patrón, sin código compartido — ver CONTEXT.md, gotcha "Fórmulas B2B GD/RI
alineadas al Daily").

Por qué existe: las dos queries ya divergieron en producción dos veces
(2026-09-07, country_factors/checkin_date) sin que nada lo detectara hasta
que alguien notó un número raro en la landing. Este script no unifica el
código (ver discusión en sesión 2026-09-20 — se eligió NO refactorizar,
demasiado riesgo tocando dos pipelines de producción a la vez) — solo avisa
si las dos versiones dejan de coincidir, para pescarlo antes que un usuario.

Uso: `python check_b2b_query_drift.py [YYYY-MM]` (default: último mes cerrado
del corriente, mismo criterio que actuals_gestional_upload.py — día 1 al
último día del mes anterior al actual).

Extrae las funciones build_b2b_gd_query/build_b2b_ri_query de cada script
via AST (solo los nodos con esos nombres — nunca ejecuta el resto del
archivo, así que no dispara ninguna query real ni sube nada a Drive).
"""
import ast
import io
import os
import sys
from datetime import date, timedelta

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import pandas as pd
import pyodbc
from dotenv import load_dotenv

HERE          = os.path.dirname(os.path.abspath(__file__))
DAILY_SYNC_PY = os.path.join(HERE, "..", "Daily_Dashboard", "daily_sync.py")
PNL_SCRIPT_PY = os.path.join(HERE, "actuals_gestional_upload.py")
RUTA_ENV      = r"C:\Users\diego.bracco\Proyectos IA\envs\.env"
DSN_NAME      = "DataLake Treasure ODBC"

# Nombres a extraer de daily_sync.py (constantes _B2B* que arman las CTEs +
# las 2 funciones) — de actuals_gestional_upload.py alcanza con las 2
# funciones, ahí las CTEs están inline dentro de cada una (sin constantes
# compartidas, ver auditoría de código 2026-09-20).
DAILY_NAMES = [
    "_COUNTRY_FACTORS_RI", "_COUNTRY_FACTORS_GD",
    "_B2B_CONECTORES_CTE", "_B2B_PNL_FILTERED_CTE", "_B2B_CTEs_RI", "_B2B_CTEs_GD",
    "_B2B_PAIS_CASE", "_B2B_PROD_CASE", "_B2B_COMPONENTS_RI", "_B2B_COMPONENTS_GD",
    "_B2B_JOINS_RI", "_B2B_JOINS_GD", "_B2B_GROUP_DIMS",
    "_B2B_OUTER_SELECT_NR", "_B2B_OUTER_SELECT_FVM",
    "build_b2b_ri_query", "build_b2b_gd_query",
]
PNL_NAMES = ["build_b2b_gd_query", "build_b2b_ri_query"]


def _extract(path, names):
    """Ejecuta SOLO los nodos top-level (FunctionDef/Assign) cuyo nombre está
    en `names`, en el orden en que aparecen en el archivo — nunca ejecuta
    ningún otro statement del script (ninguna query real, ningún upload)."""
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src, filename=path)
    wanted = set(names)
    found = set()
    ns = {"date": date, "timedelta": timedelta}
    for node in tree.body:
        target_name = None
        if isinstance(node, ast.FunctionDef):
            target_name = node.name
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            target_name = node.targets[0].id
        if target_name in wanted:
            code = ast.Module(body=[node], type_ignores=[])
            exec(compile(code, path, "exec"), ns)
            found.add(target_name)
    missing = wanted - found
    if missing:
        sys.exit(f"No se encontraron en {path}: {sorted(missing)} — revisar si cambiaron de nombre.")
    return ns


def _conectar():
    load_dotenv(RUTA_ENV)
    return pyodbc.connect(
        f"DSN={DSN_NAME};UID={os.getenv('USER')};PWD={os.getenv('PASSWORD')};", autocommit=True
    )


def _totales_por_pais(con, query, label):
    wrapped = f"SELECT pais, SUM(gross_bookings) AS gb, SUM(net_revenue) AS nr, SUM(fvm) AS fvm FROM ({query}) t GROUP BY pais ORDER BY pais"
    print(f"  > {label} ...")
    df = pd.read_sql(wrapped, con)
    print(f"    OK {len(df)} países")
    return df.set_index("pais")


def _compare(daily_df, pnl_df, label, tol_pct=0.5):
    all_countries = sorted(set(daily_df.index) | set(pnl_df.index))
    rows = []
    for pais in all_countries:
        d = daily_df.loc[pais] if pais in daily_df.index else pd.Series({"gb": 0, "nr": 0, "fvm": 0})
        p = pnl_df.loc[pais] if pais in pnl_df.index else pd.Series({"gb": 0, "nr": 0, "fvm": 0})
        for metric in ["gb", "nr", "fvm"]:
            dv, pv = float(d[metric] or 0), float(p[metric] or 0)
            base = max(abs(dv), abs(pv), 1.0)
            delta_pct = abs(dv - pv) / base * 100
            if delta_pct > tol_pct:
                rows.append((pais, metric, dv, pv, delta_pct))
    if rows:
        print(f"\n  [DRIFT] {label} — {len(rows)} celdas divergen más de {tol_pct}%:")
        for pais, metric, dv, pv, delta_pct in rows:
            print(f"    {pais:15s} {metric:4s}  daily_sync={dv:,.0f}  pnl_managerial={pv:,.0f}  Δ={delta_pct:.1f}%")
    else:
        print(f"\n  [OK] {label} — todos los países coinciden dentro de {tol_pct}%.")
    return rows


def main():
    if len(sys.argv) > 1:
        ym = sys.argv[1]
        year, month = int(ym[:4]), int(ym[5:7])
    else:
        today = date.today()
        first_of_this_month = date(today.year, today.month, 1)
        last_closed = first_of_this_month - timedelta(days=1)
        year, month = last_closed.year, last_closed.month
    date_from = date(year, month, 1)
    date_to = date(year + 1, 1, 1) - timedelta(days=1) if month == 12 else date(year, month + 1, 1) - timedelta(days=1)
    print(f"Comparando B2B GD/RI para {year}-{month:02d} ({date_from} -> {date_to})\n")

    print("Extrayendo funciones (sin ejecutar el resto de cada script)...")
    daily_ns = _extract(DAILY_SYNC_PY, DAILY_NAMES)
    pnl_ns   = _extract(PNL_SCRIPT_PY, PNL_NAMES)

    con = _conectar()
    try:
        print("\n--- Gestion Date ---")
        daily_gd = _totales_por_pais(con, daily_ns["build_b2b_gd_query"](date_from, date_to), "daily_sync.py (GD)")
        pnl_gd   = _totales_por_pais(con, pnl_ns["build_b2b_gd_query"](date_from, date_to),   "actuals_gestional_upload.py (GD)")
        drift_gd = _compare(daily_gd, pnl_gd, "GD")

        print("\n--- Recognition Date ---")
        daily_ri = _totales_por_pais(con, daily_ns["build_b2b_ri_query"](date_from, date_to), "daily_sync.py (RI)")
        pnl_ri   = _totales_por_pais(con, pnl_ns["build_b2b_ri_query"](date_from, date_to),   "actuals_gestional_upload.py (RI)")
        drift_ri = _compare(daily_ri, pnl_ri, "RI")
    finally:
        con.close()

    if drift_gd or drift_ri:
        sys.exit(f"\nDRIFT ENCONTRADO — daily_sync.py y actuals_gestional_upload.py ya no coinciden. Revisar cuál se actualizó sin replicar el cambio en el otro (ver CONTEXT.md, gotcha 'Fórmulas B2B GD/RI alineadas al Daily').")
    print("\nOK — sin drift para este mes.")


if __name__ == "__main__":
    main()
