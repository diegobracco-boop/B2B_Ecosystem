#!/usr/bin/env python
"""Regenera server/pnl-vista-gestional.json: la "P&L Managerial View" de cada línea N1 (Palancas, Variables Regionales, Fixed Cost…).

El Hub (Dashboard_B2B_WLs) agrupa el Operating Contribution por esa vista, que NO está en la tabla del consolidador: sale del Glosario
(solapa "Linea P&L": columna "P&L N1" -> "P&L Managerial View"), así que es una función de la línea. Se guarda como mapa estático,
en minúsculas y con el N1 en el vocabulario de Drive (el que arma server/pnl-consolidador.js).

Corre en una PC con OneDrive (no en Ownia). Si una línea tiene dos vistas distintas en el Glosario, corta: no se elige una en silencio.

Uso:  python scripts/generar-vista-gestional.py [--onedrive <carpeta raíz de OneDrive>]
Después: npm test, y commit / sync al espejo como siempre.
"""
import argparse
import json
import os
import sys

RUTA = os.path.join("Control de Gestión - 2026-27", "B2B & WLs", "Forecast", "Proyectos IA", "BITUBIA", "Glosario.xlsx")
SERVER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server")


def onedrive(arg):
    for c in (arg, os.environ.get("OneDriveCommercial"), os.path.join(os.path.expanduser("~"), "despegar365")):
        if c and os.path.isdir(c):
            return c
    sys.exit("No encuentro la carpeta de OneDrive: pasala con --onedrive")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onedrive")
    import openpyxl
    od = onedrive(ap.parse_args().onedrive)
    wb = openpyxl.load_workbook(os.path.join(od, RUTA), read_only=True, data_only=True)
    filas = list(wb["Linea P&L"].iter_rows(values_only=True))
    hdr = [str(h).strip() for h in filas[0]]
    i1, iv = hdr.index("P&L N1"), hdr.index("P&L Managerial View")
    mapa, conflictos = {}, []
    for r in filas[1:]:
        if r is None or not r[i1] or not r[iv]:
            continue
        n1, vista = str(r[i1]).strip().lower(), str(r[iv]).strip().lower()
        if mapa.setdefault(n1, vista) != vista:
            conflictos.append((n1, mapa[n1], vista))
    if conflictos:
        sys.exit("El Glosario da dos vistas distintas a la misma línea N1: " + "; ".join(f"{a}: {b} / {c}" for a, b, c in conflictos))
    out = {
        "meta": {"fuente": RUTA.replace(os.sep, "/") + " (solapa Linea P&L: P&L N1 -> P&L Managerial View)",
                 "como_actualizar": "python scripts/generar-vista-gestional.py"},
        "vista": dict(sorted(mapa.items())),
    }
    with open(os.path.join(SERVER, "pnl-vista-gestional.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"pnl-vista-gestional.json: {len(mapa)} líneas, vistas: {sorted(set(mapa.values()))}")


if __name__ == "__main__":
    main()
