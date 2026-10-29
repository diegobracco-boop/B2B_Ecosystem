"""
hunting_override.py
Parche (2026-10-29): el Hunting NR proyectado del OKR H2 sale de un export del P&L diario B2B2C
(pnl_diario_b2b2c*.csv: RunRate por día x partner, oct -> mar) en vez del okr_runrate del Daily, que
todavía traía el RunRate viejo (oct-26: 1,39M de partners "TBD" que en la base nueva recién aparecen en enero).

Guarda en <OneDrive B2B & WLs>/OKR/hunting_rr_override.json el NR por mes x país x partner (chico).
okr_builder.py lo lee si existe (okr_h2_builder.load_hunting_override): clasifica cada partner New / Existing
con el flag del Daily y usa el NR 'New' como Hunting proyectado de los meses que trae (el mes en curso sigue
siendo el MTD del Daily). Existing = NR contable − ese Hunting.
También guarda las orders por mes ("orders_mes"): okr_h2_builder.apply_unique_buyers las usa para proyectar
Unique Buyers (ratio UB/orders) en vez de las orders del runrate del Daily, infladas por los mismos "TBD".

Para dejar de usarlo: borrar el JSON (el OKR vuelve al okr_runrate del Daily).

Uso:
    python hunting_override.py "<ruta>\\pnl_diario_b2b2c (2).csv"
    python okr_builder.py
"""
import json
import os
import sys
from datetime import datetime

import pandas as pd

import pnl_common

OVERRIDE_PATH = os.path.join(pnl_common.get_base_dir(), "OKR", "hunting_rr_override.json")


def main(csv_path):
    df = pd.read_csv(csv_path, encoding="utf-8-sig", usecols=["fecha", "pais", "partner", "orders", "net_revenue"])
    df["periodo"] = df["fecha"].astype(str).str[:7] + "-01"
    g = df.groupby(["periodo", "pais", "partner"], as_index=False)["net_revenue"].sum()
    g = g[g["net_revenue"].abs() >= 0.01]
    orders_mes = {p[:7]: round(float(v)) for p, v in df.groupby("periodo")["orders"].sum().items()}
    payload = {
        "meta": {
            "concepto": "hunting_rr_override",
            "fuente": os.path.basename(csv_path),
            "generado": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "meses": sorted(g["periodo"].unique().tolist()),
            "nr_total": round(float(g["net_revenue"].sum()), 2),
            "orders_mes": orders_mes,
        },
        "cols": ["periodo", "pais", "partner", "net_revenue"],
        "rows": [[p, pa, pt, round(float(v), 2)] for p, pa, pt, v in g.itertuples(index=False)],
    }
    os.makedirs(os.path.dirname(OVERRIDE_PATH), exist_ok=True)
    with open(OVERRIDE_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK -> {OVERRIDE_PATH} ({len(payload['rows']):,} filas, meses {payload['meta']['meses']}, "
          f"NR total {payload['meta']['nr_total'] / 1e6:.2f}M)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Uso: python hunting_override.py <pnl_diario_b2b2c.csv>")
    main(sys.argv[1])
