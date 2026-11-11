"""
Bases de clientes por partner (vista Moonshot del B2B2C Tracker, 2026-11-10).

Lee el Excel "B2B2C_Data Histórica" que armó el equipo (hoja B2B2C_farm_clients = tamaño de la base por partner y país; hoja
"# Data-Histórica" = industria del partner; hoja "Data Andre Lezcama - MX" = tráfico web 2025 de México) y escribe
server/b2b2c-partner-bases.json, que lee server/b2b2c-tracker.js.

Los valores se toman TAL CUAL (decisión de Diego, 2026-11-10: se validan con los equipos). El script solo marca lo dudoso:
  - "trafico": el valor coincide exacto con un total de tráfico web 2025 de la hoja de México (no es una base de clientes).
  - "fuente_distinta": el texto de la fuente dice otro orden de magnitud (p.ej. Sicoob: "10 Milhões" y el valor es 100M).
  - "red_tarjetas": Mastercard / Visa / Elo (redes: su base no se alcanza como la de un banco).
  - "inferido": tipo_fuente = Inferido Benchmark.
Duplicados (mismo partner y país): queda la primera fila.

Uso: py scripts/import-partner-bases.py "<ruta al xlsx>"
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parent.parent / "server" / "b2b2c-partner-bases.json"
CARD_NETWORKS = {"mastercard", "visa", "elo"}


def millones(txt):
    """'100 Milhões' / '10 millones' -> 1e8 / 1e7; None si no se entiende."""
    m = re.search(r"([\d.,]+)\s*(mil(h|l)?(õ|o)es|millones|mm|m\b)", str(txt or ""), re.I)
    if not m:
        return None
    try:
        return float(m.group(1).replace(".", "").replace(",", ".")) * 1e6
    except ValueError:
        return None


def main(xlsx):
    fc = pd.read_excel(xlsx, sheet_name="B2B2C_farm_clients")
    dh = pd.read_excel(xlsx, sheet_name="# Data-Histórica")
    try:
        mx = pd.read_excel(xlsx, sheet_name="Data Andre Lezcama - MX")
        trafico = {int(v) for v in mx["TOTAL"].dropna() if float(v) > 0}
    except Exception:
        trafico = set()
    ind = dh.dropna(subset=["Industria"]).groupby("f38")["Industria"].agg(lambda s: s.mode().iat[0]).to_dict()
    PAIS = {"BR": "Brasil", "AR": "Argentina", "MX": "Mexico", "CL": "Chile", "CO": "Colombia", "PE": "Peru", "EC": "Ecuador", "OT": "Other Countries", "UY": "Uruguay"}
    dh["pais_n"] = dh["pais"].map(PAIS).fillna(dh["pais"])
    texto = dh.groupby(["f38", "pais_n"])["Cantidad de clientes FARM "].agg(lambda s: next((x for x in s if isinstance(x, str) and millones(x)), None)).to_dict()
    rows, seen = [], set()
    for r in fc.to_dict("records"):
        partner, pais, base = str(r["partner_name"]).strip(), str(r["country"]).strip(), r["farm_clients"]
        if (partner, pais) in seen or pd.isna(base):
            continue
        seen.add((partner, pais))
        base = float(base)
        flags = []
        if int(base) in trafico:
            flags.append("trafico")
        t = millones(texto.get((partner, pais)))
        if t and (base / t >= 5 or t / base >= 5):
            flags.append("fuente_distinta")
        if partner.lower() in CARD_NETWORKS:
            flags.append("red_tarjetas")
        if str(r.get("tipo_fuente", "")).lower().startswith("inferido"):
            flags.append("inferido")
        rows.append({"partner": partner, "pais": pais, "clientes": base, "fuente": r.get("tipo_fuente"),
                     "industria": ind.get(partner) or "Otro", "flags": flags})
    out = {"actualizado": date.today().isoformat(), "fuente": Path(xlsx).name,
           "nota": "Provisorio: valores tal cual del Excel, a validar con los equipos. Ver flags.", "rows": rows}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK: {len(rows)} bases -> {OUT}")
    for x in rows:
        if set(x["flags"]) - {"inferido"}:
            print(f"  ⚠ {x['partner']} ({x['pais']}): {x['clientes']:,.0f} · {', '.join(x['flags'])}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1])
