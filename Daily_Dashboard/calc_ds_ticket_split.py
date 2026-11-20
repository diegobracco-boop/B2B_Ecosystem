# -*- coding: utf-8 -*-
"""
calc_ds_ticket_split.py — genera ds_ticket_split_factors.py (proporción FIJA de Tickets dentro del NR de Dest. Serv.).

Por qué existe: el KR "New Products Growth" (Status KRs H2 del Tracker) tiene un switch "Dest. Serv. abierto" que separa
Dest. Serv. en Tickets y resto. Los actuals traen la marca (ds_ticket, ver _B2B_DS_TICKET_EXPR en daily_sync.py), pero
el BUDGET no: Dest. Serv. es un solo bloque. Para comparar peras con peras, el budget de Dest. Serv. se abre con la
proporción de NR de Tickets de una ventana de actuals que se fija UNA vez y queda fija "para adelante" (mismo criterio
que calc_pkg_split.py con los paquetes).

Definición acordada (antonella.difranco, 2026-11-20):
  - Tickets = entradas a parques (Disney / Universal / SeaWorld / Busch Gardens) + shows y entradas sueltas
    (activity_type TICKET). Resto = excursiones (TOUR), traslados, alquileres.
  - Ventana de referencia: abril–octubre 2026 (meses cerrados del FY27), actuals RI B2B, Dest. Serv. standalone
    (los componentes de Packages General se marcan por product_type en el budget, ver split_ds_ticket_budget).
  - Nivel: canal (API / Agencias afiliadas) x país. Combinaciones con poco NR usan el TOTAL del canal.
  - Se aplica solo al Budget del JSON de OKR H2 (no a Run Rate ni Forecast). El total no cambia.
  - Es MANUAL: este script NO corre en la sync diaria. Correrlo de nuevo solo si se decide cambiar la ventana.

Uso:   python calc_ds_ticket_split.py      (VPN + credenciales del Datalake en credenciales/.env.<usuario>)
Salida: ds_ticket_split_factors.py  (se versiona en git; daily_sync.py lo importa)
"""
import os
import sys
import warnings
from datetime import date

import pandas as pd
import pyodbc
from dotenv import load_dotenv

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, "..", "credenciales", f".env.{os.environ.get('USERNAME', '').lower()}"))

WINDOW_FROM, WINDOW_TO = date(2026, 4, 1), date(2026, 10, 31)
MIN_NR = 5_000            # USD de NR de Dest. Serv. en la ventana para que un canal x país tenga proporción propia
DS_BUY_TYPES = "('Actividades','Traslados','Circuito','Servicios en Destino')"


def _builder():
    """daily_sync.py es un script con efectos al importarse: se ejecuta solo hasta el print de "Actuals FY" (antes de
    lanzar las queries), igual que hace reales.py. Ahí ya están definidas todas las queries B2B."""
    path = os.path.join(HERE, "daily_sync.py")
    with open(path, encoding="utf8") as fh:
        src = fh.read()
    corte = 'print(f"\\n--- Actuals FY{YEAR_BUDGET} ---")'
    assert src.count(corte) == 1, "cambió el print de 'Actuals FY' en daily_sync.py: ajustar el corte del exec"
    ns = {"__file__": path, "__name__": "daily_sync_parcial"}
    sys.path.insert(0, HERE)
    exec(compile(src[:src.index(corte)], path, "exec"), ns)
    return ns["build_b2b_ri_query"]


def main():
    q = _builder()(WINDOW_FROM, WINDOW_TO)
    filtro = "AND fh.line_of_business_code = 'B2B'"
    assert q.count(filtro) == 1, "cambió el WHERE de la query RI: revisar el filtro de Dest. Serv."
    q = q.replace(filtro, filtro + f"\n        AND fh.buy_type_code IN {DS_BUY_TYPES}")
    con = pyodbc.connect(f"DSN=DataLake Treasure ODBC;UID={os.getenv('USER')};PWD={os.getenv('PASSWORD')};",
                         autocommit=True, timeout=900)
    df = pd.read_sql(q, con)
    con.close()

    df["net_revenue"] = pd.to_numeric(df["net_revenue"], errors="coerce").fillna(0)
    df["ds_ticket"] = pd.to_numeric(df["ds_ticket"], errors="coerce").fillna(0).astype(int)
    ds = df[df["producto_original"] == "Dest. Serv."]

    def share(sub):
        t = sub.loc[sub["ds_ticket"] == 1, "net_revenue"].sum()
        r = sub.loc[sub["ds_ticket"] == 0, "net_revenue"].sum()
        t, r = max(t, 0.0), max(r, 0.0)                     # NR negativo (ajustes) no reparte
        return (round(float(t / (t + r)), 6) if (t + r) > 0 else None), float(sub["net_revenue"].sum())

    factors, nr_ref = {}, {}
    sh, nr = share(ds)
    factors[("TOTAL", "TOTAL")], nr_ref[("TOTAL", "TOTAL")] = sh, nr
    for ch, sub_ch in ds.groupby("parent_channel"):
        sh, nr = share(sub_ch)
        if sh is not None:
            factors[(ch, "TOTAL")] = sh
        nr_ref[(ch, "TOTAL")] = nr
        for pais, sub in sub_ch.groupby("pais"):
            sh, nr = share(sub)
            nr_ref[(ch, pais)] = nr
            if sh is not None and nr >= MIN_NR:
                factors[(ch, pais)] = sh

    out = ['# -*- coding: utf-8 -*-',
           '# GENERADO por calc_ds_ticket_split.py — NO editar a mano. Ver ese script para el porqué y cómo regenerarlo.',
           f'# Ventana de referencia: {WINDOW_FROM} .. {WINDOW_TO} (actuals RI B2B, Dest. Serv. standalone).',
           '# Proporción del NR de Dest. Serv. que es Tickets, por (canal, país); FIJA para adelante. Solo Budget (OKR H2).',
           '# Busqueda: (canal, país) -> (canal, "TOTAL") -> ("TOTAL", "TOTAL").',
           f'DS_TICKET_WINDOW = ("{WINDOW_FROM}", "{WINDOW_TO}")',
           'DS_TICKET_NR_REF = {   # NR de Dest. Serv. en la ventana (USD)']
    out += [f'    {k!r}: {round(v)},' for k, v in sorted(nr_ref.items())]
    out += ['}', 'DS_TICKET_SHARE = {']
    out += [f'    {k!r}: {v},' for k, v in sorted(factors.items())]
    out += ['}']
    path = os.path.join(HERE, "ds_ticket_split_factors.py")
    with open(path, "w", encoding="utf8") as fh:
        fh.write("\n".join(out) + "\n")
    for k, v in sorted(factors.items()):
        print(f"  {k[0]:<20} {k[1]:<16} Tickets {v * 100:5.1f}%   (NR ventana {nr_ref.get(k, 0):,.0f})")
    print("->", path)


if __name__ == "__main__":
    main()
