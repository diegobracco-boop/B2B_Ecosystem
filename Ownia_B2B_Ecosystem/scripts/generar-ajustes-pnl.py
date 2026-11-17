#!/usr/bin/env python
"""Regenera los ajustes propios que se suman a la tabla del consolidador (compartido.app_b2b_ecosystem) en el P&L Accounting.

Corre en una PC con OneDrive (no en Ownia). Lee las dos fuentes que hoy usa el pipeline Inputs_Planning_PnL y escribe, en
server/, un JSON por ajuste, con el vocabulario de la tabla (país, producto, LoB, canal, línea nivel 2):

  1. pnl-ajustes-actuals.json  <- Control de Gestión - 2026-27/B2B & WLs/Base_P&L_Contable/Actuals_GB_Ajustes_OC.csv
     Reclasificación de Gross Bookings y Orders de API B2B-MAY (abril-junio). Conso NO la incorpora.
  2. pnl-ajustes-axi.json      <- Planning-PBI - Inputs Power Bi/Actuals/Reverso AxI.xlsx (hojas Budget y RunRate)
     "Reverso AxI" (SIN PPA): conso trae AS REPORTED, el pipeline saca el efecto PPA sumando esto. Hoy solo toca "Other Incentives"
     de B2B y B2B2C: Budget = FY27 (abril 2026 a marzo 2027), RunRate = FY26 (abril 2025 a marzo 2026, lo usa el año anterior).

Uso:  python scripts/generar-ajustes-pnl.py [--onedrive <carpeta raíz de OneDrive>]
Después: npm test, commit, y sincronizar al espejo como siempre.
"""
import argparse
import csv
import collections
import io
import json
import os
import sys

MMM = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
PAIS = {"Brasil": "Brazil", "Brazil": "Brazil"}
# Línea del Reverso AxI -> línea nivel 2 de la tabla. Si aparece una que no está acá, se corta: no se pierde en silencio.
N2_AXI = {"Other Incentives": "O. Incentives"}
COLS = ["year", "mes", "pais", "lob", "channel", "product", "n2", "valor"]
SERVER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server")


def onedrive(arg):
    for c in (arg, os.environ.get("OneDriveCommercial"), os.path.join(os.path.expanduser("~"), "despegar365")):
        if c and os.path.isdir(c):
            return c
    sys.exit("No encuentro la carpeta de OneDrive: pasala con --onedrive")


def escribir(nombre, meta, rows, cols=COLS):
    out = {"meta": meta, "cols": cols, "rows": rows}
    ruta = os.path.join(SERVER, nombre)
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{nombre}: {len(rows)} filas")


def ajustes_api(od):
    src = os.path.join(od, "Control de Gestión - 2026-27", "B2B & WLs", "Base_P&L_Contable", "Actuals_GB_Ajustes_OC.csv")
    raw = open(src, "rb").read()
    txt = next(t for t in (raw.decode(e, errors="strict") if e == "utf-8-sig" else raw.decode(e) for e in ("utf-8-sig", "cp1252")))
    rows = list(csv.reader(io.StringIO(txt), delimiter=";"))
    hdr = rows[0]
    agg = collections.OrderedDict()
    for r in rows[1:]:
        if not r:
            continue
        d = dict(zip(hdr, r))
        # La línea (GB NAC / GB INT / Orders NAC / Orders INT) se conserva: el P&L Accounting suma por nivel 2 y el Managerial abre domestic / internacional.
        key = (d["year"], int(d["mes"]), PAIS.get(d["pais"], d["pais"]), d["lob"], d["channel"], d["product"], d["nivel_2"], d["linea"])
        agg[key] = agg.get(key, 0.0) + float(d["total"].replace(",", "."))
    meta = {
        "fuente": "Control de Gestión - 2026-27/B2B & WLs/Base_P&L_Contable/Actuals_GB_Ajustes_OC.csv",
        "que_es": "Reclasificación de Gross Bookings y Orders de API B2B-MAY entre abril y junio de 2026. Neto ~0. Conso NO la incorpora (confirmado 2026-11-17).",
        "como_actualizar": "python scripts/generar-ajustes-pnl.py (una fila por línea: GB NAC, GB INT, Orders NAC y Orders INT).",
        "escenarios_por_anio": {"FY27": ["ACT", "FC1"]},   # el lastrunrate.json de Drive no lo trae (medido el 2026-11-17)
        "hasta_ultimo_cerrado": True,
    }
    escribir("pnl-ajustes-actuals.json", meta, [[*k, round(v, 6)] for k, v in agg.items() if abs(v) > 1e-9], COLS[:-1] + ["linea", "valor"])   # la clave termina en la línea: va antes del valor


def hoja_axi(wb, hoja, anio):
    ws = wb[hoja]
    filas = list(ws.iter_rows(values_only=True))
    hdr = [str(h).strip() if h is not None else "" for h in filas[0]]
    low = [h.lower() for h in hdr]
    ic = {k: low.index(k) for k in ("product", "country", "lob", "linea p&l")}
    meses = [(j, MMM[h[:3].lower()]) for j, h in enumerate(hdr) if len(h) == 6 and h[3] == "-" and h[:3].lower() in MMM]
    agg = collections.OrderedDict()
    for r in filas[1:]:
        if r is None or not r[ic["linea p&l"]]:
            continue
        lob = str(r[ic["lob"]])
        if not lob.upper().startswith("B2B"):
            continue   # el pipeline solo conserva B2B y B2B2C (LOBS_KEEP)
        linea = str(r[ic["linea p&l"]]).strip()
        if linea not in N2_AXI:
            sys.exit(f"Reverso AxI ({hoja}): la línea '{linea}' de {lob} no está mapeada a la tabla (N2_AXI). Agregala acá.")
        l, _, canal = lob.partition("-")
        for j, mes in meses:
            v = r[j]
            if isinstance(v, (int, float)) and v:
                pais = PAIS.get(str(r[ic["country"]]).strip(), str(r[ic["country"]]).strip())
                key = (anio, mes, pais, l.upper(), canal, str(r[ic["product"]]).strip(), N2_AXI[linea])
                agg[key] = agg.get(key, 0.0) + float(v)
    return agg


def ajustes_axi(od):
    import openpyxl
    src = os.path.join(od, "Planning-PBI - Inputs Power Bi", "Actuals", "Reverso AxI.xlsx")
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    agg = hoja_axi(wb, "Budget", "FY27")
    agg.update(hoja_axi(wb, "RunRate", "FY26"))
    meta = {
        "fuente": "Planning-PBI - Inputs Power Bi/Actuals/Reverso AxI.xlsx (hojas Budget -> FY27 y RunRate -> FY26)",
        "que_es": "Reverso AxI (SIN PPA): conso trae AS REPORTED y el pipeline saca el efecto PPA sumando esto. Hoy solo 'Other Incentives' de B2B y B2B2C. "
                  "Verificado 2026-11-17: la hoja Budget suma 1.500.322 (diferencia medida contra Drive: -1.500.321) y la hoja RunRate 748.004 (LY: -748.004).",
        "como_actualizar": "python scripts/generar-ajustes-pnl.py cuando cambie el Excel.",
        "escenarios_por_anio": {"FY27": ["ACT", "BGT", "FC1", "LRR", "RR"], "FY26": ["ACT"]},
        "hasta_ultimo_cerrado": False,
    }
    escribir("pnl-ajustes-axi.json", meta, [[*k, round(v, 6)] for k, v in agg.items() if abs(v) > 1e-9])
    tot = collections.defaultdict(float)
    for k, v in agg.items():
        tot[k[0]] += v
    print("totales:", {a: round(v) for a, v in tot.items()})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--onedrive")
    a = ap.parse_args()
    od = onedrive(a.onedrive)
    ajustes_api(od)
    ajustes_axi(od)
