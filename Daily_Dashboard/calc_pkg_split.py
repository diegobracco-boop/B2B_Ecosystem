# -*- coding: utf-8 -*-
"""
calc_pkg_split.py — genera pkg_split_factors.py (proporciones FIJAS de apertura del NR de Packages General).

Por qué existe: el KR "New Products Growth" del track managerial (Daily / Tracker, MTD) cuenta Flights +
Dest. Serv. y, dentro de Packages General, los componentes Vuelos y Dest. Serv. (product_type de
bi_transactional_fact_products). Los actuals traen product_type, pero el BUDGET no (Packages General es un
solo bloque). Para comparar peras con peras, el budget de Packages General se abre por product_type con
las proporciones de NR de una ventana de actuals que se fija UNA vez y queda fija "para adelante".

Definición acordada (Diego, 2026-09-29):
  - Ventana de referencia: abril–junio 2026 (actuals RI, líneas B2B).
  - Nivel: por país. Países con poco NR de paquetes en la ventana usan las proporciones TOTAL.
  - Se aplica solo al Budget (no a Run Rate ni Forecast).
  - Es MANUAL: este script NO corre en la sync diaria. Correrlo de nuevo solo si se decide cambiar la ventana.

Uso:   python calc_pkg_split.py            (necesita VPN + credenciales del Datalake en envs/.env)
Salida: pkg_split_factors.py  (se versiona en git; daily_sync.py lo importa)
"""
import os
import warnings
from datetime import date

import pandas as pd
import pyodbc
from dotenv import load_dotenv

warnings.filterwarnings("ignore")
load_dotenv(r"C:\Users\diego.bracco\Proyectos IA\envs\.env")

HERE = os.path.dirname(os.path.abspath(__file__))
WINDOW_FROM, WINDOW_TO = date(2026, 4, 1), date(2026, 6, 30)
MIN_NR_COUNTRY = 50_000        # USD de NR de paquetes en la ventana para tener factores propios
# product_type que se abren por separado; el resto se junta en OTROS_KEY
KEEP_TYPES = ["Vuelos", "Disney", "Universal", "SeaWorld", "Busch Gardens", "Excursiones", "Traslados", "Espectáculos"]
OTROS_KEY = "Otros paquetes"


def _builder():
    """daily_sync.py es un script con efectos al importarse (abre logs, corre el pipeline): se extrae solo
    el tramo de definiciones de queries B2B, igual que hacen las validaciones ad-hoc."""
    src = open(os.path.join(HERE, "daily_sync.py"), encoding="utf8").read()
    ns = {"date": date, "__name__": "x"}
    exec(src[src.index("_B2B_CONECTORES_CTE"):src.index("def build_b2c_query")], ns)
    return ns["build_b2b_ri_query"]


def main():
    con = pyodbc.connect(f"DSN=DataLake Treasure ODBC;UID={os.getenv('USER')};PWD={os.getenv('PASSWORD')};",
                         autocommit=True, timeout=900)
    df = pd.read_sql(_builder()(WINDOW_FROM, WINDOW_TO), con)
    con.close()

    df["net_revenue"] = pd.to_numeric(df["net_revenue"], errors="coerce").fillna(0)
    df["product_type"] = df["product_type"].astype(str).str.strip().str.replace(r"^Espect.*$", "Espectáculos", regex=True)
    pk = df[df["producto_original"] == "Packages General"].copy()
    pk["bucket"] = pk["product_type"].where(pk["product_type"].isin(KEEP_TYPES), OTROS_KEY)

    def shares(sub):
        s = sub.groupby("bucket")["net_revenue"].sum().clip(lower=0)      # NR negativo (ajustes) no reparte
        tot = s.sum()
        return {k: round(float(s.get(k, 0.0) / tot), 6) for k in KEEP_TYPES + [OTROS_KEY]}, float(sub["net_revenue"].sum())

    factors, nr_by_pais = {}, {}
    total_sh, total_nr = shares(pk)
    factors["TOTAL"], nr_by_pais["TOTAL"] = total_sh, total_nr
    for pais, sub in pk.groupby("pais"):
        sh, nr = shares(sub)
        nr_by_pais[pais] = nr
        if nr >= MIN_NR_COUNTRY:
            factors[pais] = sh

    out = ['# -*- coding: utf-8 -*-',
           '# GENERADO por calc_pkg_split.py — NO editar a mano. Ver ese script para el porqué y cómo regenerarlo.',
           f'# Ventana de referencia: {WINDOW_FROM} .. {WINDOW_TO} (actuals RI B2B, Packages General).',
           '# Proporciones del NR de Packages General por product_type, FIJAS para adelante. Solo Budget.',
           f'PKG_SPLIT_WINDOW = ("{WINDOW_FROM}", "{WINDOW_TO}")',
           f'PKG_SPLIT_OTROS = "{OTROS_KEY}"',
           f'PKG_SPLIT_NR_REF = {{{", ".join(f"{k!r}: {round(v)}" for k, v in nr_by_pais.items())}}}   # NR de paquetes en la ventana (USD)',
           'PKG_SPLIT_FACTORS = {']
    for k, sh in factors.items():
        out.append(f'    {k!r}: {{')
        for t, v in sh.items():
            out.append(f'        {t!r}: {v},')
        out.append('    },')
    out.append('}')
    path = os.path.join(HERE, "pkg_split_factors.py")
    open(path, "w", encoding="utf8").write("\n".join(out) + "\n")

    pd.set_option("display.width", 220)
    print("NR paquetes en la ventana por país:", {k: round(v) for k, v in nr_by_pais.items()})
    print("Países con factores propios:", [k for k in factors if k != "TOTAL"])
    print((pd.DataFrame(factors) * 100).round(1).to_string())
    print("->", path)


if __name__ == "__main__":
    main()
