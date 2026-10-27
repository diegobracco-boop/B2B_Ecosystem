# -*- coding: utf-8 -*-
"""
b2c_budget_sync.py
==================
Arma b2c_budget_weekly.json (Budget de B2C por semana × país) para la vista "Weekly · vs B2C" del
Benchmark del Daily y su slide del Flow (SOLO en la app de Ownia: public/daily-ceo-weekly.js;
Apps Script no lo usa).

Fuente: el CSV de Budget B2C semanal que manda Planning (budget_2026_b2c.csv: Marca × AnioLunes ×
Semana × Mes × Pais × Canal × Producto × Viaje, con GB / Net_Revenues / FVM y la apertura del P&L).
Semana = semana ISO (lunes a domingo) recortada al año calendario: la 1 de 2026 es 1–4 de enero y
la 53 es 28–31 de diciembre. Mismo criterio de semana que el Weekly del Daily (_wsIsoWeek_), así
que se cruza por (año, semana) directo.

Se agrega a año × semana × país (todas las marcas, canales y productos) y se sube a la carpeta del
Daily en Drive. Después: py Ownia_B2B_Ecosystem/mirror/ownia_mirror.py

Run: py b2c_budget_sync.py [--csv <archivo>] [--no-upload] [--out archivo]
Correrlo de nuevo cuando Planning mande otra versión del Budget (o el del año siguiente).
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import argparse
import ast
import json
from datetime import date, datetime
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
DAILY_SYNC = HERE / "daily_sync.py"
FILE_NAME = "b2c_budget_weekly.json"
CSV_DEFAULT = Path.home() / "Downloads" / "budget_2026_b2c.csv"

# Países del Budget (ISO-2) → nombres del Daily (mismo mapa que B2C_PAIS_MAP de daily_sync.py).
# El Budget no abre USA: va dentro de OT, que en el Daily es "Other Countries" (Globales).
PAIS_MAP = {"AR": "Argentina", "BR": "Brasil", "CO": "Colombia", "EC": "Ecuador", "PE": "Peru",
            "CL": "Chile", "MX": "Mexico", "US": "USA", "OT": "Other Countries"}

# Subida a Drive: las mismas definiciones de daily_sync.py (se extraen por nombre, sin ejecutar
# el resto del script, como industry_events_sync.py).
_DEFS_DRIVE = ("DRIVE_FOLDER_ID", "DRIVE_SCOPES", "_get_drive_service", "upload_to_drive")


def _defs_drive():
    src = DAILY_SYNC.read_text(encoding="utf-8")
    tree = ast.parse(src)
    extra = [n for n in tree.body
             if (isinstance(n, ast.FunctionDef) and n.name in _DEFS_DRIVE)
             or (isinstance(n, ast.Assign) and any(getattr(t, "id", None) in _DEFS_DRIVE for t in n.targets))]
    faltan = set(_DEFS_DRIVE) - {getattr(n, "name", None) or n.targets[0].id for n in extra}
    if faltan:
        raise SystemExit(f"No encuentro en {DAILY_SYNC.name}: {', '.join(sorted(faltan))}")
    ns = {"__file__": str(DAILY_SYNC), "__name__": "daily_sync_defs"}
    exec(compile(ast.Module(body=extra, type_ignores=[]), str(DAILY_SYNC), "exec"), ns)
    return ns


def _semana(anio, semana):
    """(desde, hasta) de la semana ISO, recortada al año calendario."""
    d0 = max(date.fromisocalendar(anio, semana, 1), date(anio, 1, 1))
    d1 = min(date.fromisocalendar(anio, semana, 7), date(anio, 12, 31))
    return d0.isoformat(), d1.isoformat()


def build(csv_path):
    df = pd.read_csv(csv_path, usecols=["AnioLunes", "Semana", "Pais", "Tipo", "GB", "Net_Revenues", "FVM", "COI", "Financial_Result"], low_memory=False)
    tipos = sorted(df["Tipo"].dropna().unique())
    if tipos != ["BGT"]:
        raise SystemExit(f"Esperaba solo Tipo=BGT en el CSV y vino {tipos}")
    sin_mapa = sorted(set(df["Pais"].dropna()) - set(PAIS_MAP))
    if sin_mapa:
        raise SystemExit(f"Países del CSV sin mapear: {sin_mapa} (agregarlos a PAIS_MAP)")
    for c in ("GB", "Net_Revenues", "FVM", "COI", "Financial_Result"):
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
    # Switch "COI Brasil" = Excluir: FVM de Brasil sin COI ni Financial Result, como fvm_ex_coi_br del real
    # (daily_sync.py: fvm − (financial_result − coi_usd)). En el Budget el COI viene con signo de costo (negativo).
    df["FVM_ex_COI_BR"] = df["FVM"] - (df["COI"] + df["Financial_Result"]) * (df["Pais"] == "BR")
    g = df.groupby(["AnioLunes", "Semana", "Pais"], as_index=False)[["GB", "Net_Revenues", "FVM", "FVM_ex_COI_BR"]].sum()
    rows = []
    for r in g.itertuples(index=False):
        d0, d1 = _semana(int(r.AnioLunes), int(r.Semana))
        rows.append([int(r.AnioLunes), int(r.Semana), d0, d1, PAIS_MAP[r.Pais],
                     round(float(r.GB), 2), round(float(r.Net_Revenues), 2), round(float(r.FVM), 2), round(float(r.FVM_ex_COI_BR), 2)])
    rows.sort(key=lambda x: (x[0], x[1], x[4]))
    # Cuadre: el agregado tiene que sumar lo mismo que el CSV
    for i, c in ((5, "GB"), (6, "Net_Revenues"), (7, "FVM")):
        a, b = sum(x[i] for x in rows), float(df[c].sum())
        if abs(a - b) > max(10.0, abs(b) * 1e-6):
            raise SystemExit(f"Cuadre {c}: JSON {a:,.0f} vs CSV {b:,.0f}")
    anios = sorted({x[0] for x in rows})
    payload = {
        "meta": {"fuente": Path(csv_path).name, "generado": datetime.now().isoformat(timespec="seconds"),
                 "anios": anios, "semanas": len({(x[0], x[1]) for x in rows}),
                 "desde": rows[0][2], "hasta": max(x[3] for x in rows),
                 "nota": "Budget B2C por semana ISO (recortada al año calendario) × país; todas las marcas, canales y productos. USD."},
        "cols": ["anio", "semana", "desde", "hasta", "pais", "gross_bookings", "net_revenues", "fvm", "fvm_ex_coi_br"],
        "rows": rows,
    }
    tot = {c: sum(x[i] for x in rows) / 1e6 for i, c in ((5, "GB"), (6, "NR"), (7, "FVM"))}
    print(f"Budget B2C: {len(rows):,} filas · {payload['meta']['semanas']} semanas ({payload['meta']['desde']} a {payload['meta']['hasta']}) · "
          f"GB {tot['GB']:,.1f}M · NR {tot['NR']:,.1f}M · FVM {tot['FVM']:,.1f}M")
    return payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(CSV_DEFAULT))
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args()
    if not Path(a.csv).exists():
        raise SystemExit(f"No existe {a.csv} (pasalo con --csv)")
    payload = build(a.csv)
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if a.out:
        Path(a.out).write_bytes(data)
        print(f"  escrito {a.out} ({len(data) // 1024} KB)")
    if not a.no_upload:
        ns = _defs_drive()
        ns["upload_to_drive"](data, FILE_NAME, ns["DRIVE_FOLDER_ID"])
        print("Listo. Ahora: py Ownia_B2B_Ecosystem/mirror/ownia_mirror.py")


if __name__ == "__main__":
    main()
