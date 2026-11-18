#!/usr/bin/env python
"""Regenera server/pnl-vista-gestional.json: lo que el Hub necesita del Glosario y la tabla del consolidador no trae.

El Hub (Dashboard_B2B_WLs) agrupa el Operating Contribution por la "P&L Managerial View" (Palancas, Variables Regionales, Fixed Cost…) y por la
línea N1. Ninguna de las dos está en la tabla; salen del Glosario (solapa "Linea P&L": "P&L" = nombre crudo de la línea, "P&L N1", "P&L N2" y
"P&L Managerial View"). Se guardan como mapas estáticos, en minúsculas y con el vocabulario de Drive:

  vista          N1 -> vista gestional                       (una por línea N1)
  n1_por_linea   nombre crudo de la línea -> N1               (IOF, Banking Tax, IVA no recuperable ARG… -> other transactional taxes)
  vista_por_n2   N2 -> vista, solo si todas las líneas de esa N2 coinciden (respaldo para una línea que el Glosario no conoce)

Corre en una PC con OneDrive (no en Ownia). Si el Glosario da dos vistas a una misma línea N1, o dos N1 a un mismo nombre crudo, corta: no se elige
una en silencio.

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
    iraw, i1, i2, iv = hdr.index("P&L"), hdr.index("P&L N1"), hdr.index("P&L N2"), hdr.index("P&L Managerial View")
    vista, n1_por_linea, vistas_n2, conflictos = {}, {}, {}, []
    for r in filas[1:]:
        if r is None or not r[iraw] or not r[i1]:
            continue
        raw, n1 = str(r[iraw]).strip().lower(), str(r[i1]).strip().lower()
        if n1_por_linea.setdefault(raw, n1) != n1:
            conflictos.append(f"línea '{raw}': N1 {n1_por_linea[raw]} / {n1}")
        if not r[iv]:
            continue
        v = str(r[iv]).strip().lower()
        if vista.setdefault(n1, v) != v:
            conflictos.append(f"N1 '{n1}': vista {vista[n1]} / {v}")
        if r[i2]:
            vistas_n2.setdefault(str(r[i2]).strip().lower(), set()).add(v)
    if conflictos:
        sys.exit("El Glosario es contradictorio: " + "; ".join(conflictos))
    out = {
        "meta": {"fuente": RUTA.replace(os.sep, "/") + " (solapa Linea P&L)", "como_actualizar": "python scripts/generar-vista-gestional.py"},
        "vista": dict(sorted(vista.items())),
        "n1_por_linea": dict(sorted((k, v) for k, v in n1_por_linea.items() if k != v)),   # solo los que cambian de nombre
        "vista_por_n2": dict(sorted((n2, next(iter(vs))) for n2, vs in vistas_n2.items() if len(vs) == 1)),
    }
    with open(os.path.join(SERVER, "pnl-vista-gestional.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"pnl-vista-gestional.json: {len(vista)} N1 con vista · {len(out['n1_por_linea'])} nombres crudos que cambian de N1 · "
          f"{len(out['vista_por_n2'])} N2 con vista única (de {len(vistas_n2)})")


if __name__ == "__main__":
    main()
