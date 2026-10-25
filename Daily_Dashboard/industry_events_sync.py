# -*- coding: utf-8 -*-
"""
industry_events_sync.py
=======================
Arma industry_events.json para la solapa "Industry events tracker" del Daily (SOLO en la app de
Ownia: la solapa la agrega Ownia_B2B_Ecosystem/public/daily-layout.js; Apps Script no lo usa).

1. Lee los calendarios de eventos comerciales (OneDrive "Estacionalidad Diaria"):
     - "Calendario Eventos - WL.xlsx"  (hoja Eventos)    → B2B2C y B2C de referencia
     - "Eventos B2B 26-27.xlsx"        (hoja Calendario) → B2B
   y los resume en eventos: días de evento contiguos por LoB × país × año, con su pre/post.
2. Baja del Datalake el diario de B2B2C y B2C que daily_sync.py todavía no publica del año
   pasado (nov–dic: su LY llega hasta fin del mes en curso), con LAS MISMAS queries que
   daily_sync.py (las ejecuta desde ese archivo, igual que Proceso_Distribucion_Diaria/reales.py).
   El año en curso y el resto del LY los toma la solapa de los JSON del Daily que ya carga.
3. Sube el JSON a la carpeta del Daily en Drive. Después: py Ownia_B2B_Ecosystem/mirror/ownia_mirror.py

No toca daily_sync.py ni los JSON que leen las landings de Apps Script.

Run: py industry_events_sync.py [--calendarios <carpeta>] [--ly-year 2025] [--no-upload] [--out archivo]
Correrlo de nuevo cuando cambien los calendarios (el LY no cambia).
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import argparse
import ast
import json
import re
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
DAILY_SYNC = HERE / "daily_sync.py"
FILE_NAME = "industry_events.json"

# Mismo recorte que Proceso_Distribucion_Diaria/reales.py: se ejecutan solo las definiciones de
# daily_sync.py (config, conexión, queries, fetch), cortando antes de la primera descarga.
_INICIO = "\nimport os"
_FIN = '\nprint(f"\\n--- Actuals FY'
# Definiciones que están DESPUÉS del corte (subida a Drive): se extraen por nombre.
_DEFS_DRIVE = ("DRIVE_SCOPES", "_get_drive_service", "upload_to_drive")

CALENDARIOS = {
    # lob → (archivo, hojas). B2C de referencia usa el calendario de WLs (mismos eventos de retail).
    # WL: "Eventos" es la unión a mano de las hojas regionales; se leen todas porque a veces se carga
    # un evento solo en la regional (Cyber Chile y Outlet Viaja y Vuela MX, 2026-10-24).
    "b2b2c": ("Calendario Eventos - WL.xlsx", ("Eventos", "Sudamerica", "Brasil", "Norteamerica")),
    "b2b":   ("Eventos B2B 26-27.xlsx", ("Calendario",)),
}
PAIS_REAL = {"Paraguay": "Other Countries", "Uruguay": "Other Countries", "USA": "Other Countries"}
# Días sin evento que cortan un bloque: hasta 1 día de hueco se considera el mismo evento.
GAP_MAX = 1
MERGE_MAX = 10
PRE_POST_DEFAULT = 3   # si el calendario no marca pre/post pegado al evento


def _defs_daily_sync():
    src = DAILY_SYNC.read_text(encoding="utf-8")
    i, j = src.find(_INICIO), src.find(_FIN)
    if i < 0 or j < 0 or j < i:
        raise SystemExit(f"No encuentro los marcadores de inicio/fin en {DAILY_SYNC.name}; revisar _INICIO/_FIN")
    ns = {"__file__": str(DAILY_SYNC), "__name__": "daily_sync_defs", "sys": sys}
    exec(compile(src[i:j], str(DAILY_SYNC), "exec"), ns)
    tree = ast.parse(src)
    extra = [n for n in tree.body
             if (isinstance(n, ast.FunctionDef) and n.name in _DEFS_DRIVE)
             or (isinstance(n, ast.Assign) and any(getattr(t, "id", None) in _DEFS_DRIVE for t in n.targets))]
    faltan = set(_DEFS_DRIVE) - {getattr(n, "name", None) or n.targets[0].id for n in extra}
    if faltan:
        raise SystemExit(f"No encuentro en {DAILY_SYNC.name}: {', '.join(sorted(faltan))}")
    exec(compile(ast.Module(body=extra, type_ignores=[]), str(DAILY_SYNC), "exec"), ns)
    return ns


# ── Calendarios ────────────────────────────────────────────────────────────────

def _carpeta_calendarios(arg):
    if arg:
        return Path(arg)
    home = Path.home()
    hoy = date.today()
    fy = f"{hoy.year}-{(hoy.year + 1) % 100:02d}" if hoy.month >= 4 else f"{hoy.year - 1}-{hoy.year % 100:02d}"
    candidatas = [
        home / "OneDrive - despegar365" / f"Control de Gestión - {fy}" / "B2B & WLs" / "Estacionalidad Diaria",
        home / "despegar365" / f"Control de Gestión - {fy}" / "B2B & WLs" / "Estacionalidad Diaria",
        HERE.parent / "Proceso_Distribucion_Diaria",   # copias locales (gitignoreadas) del proceso de distribución
    ]
    for c in candidatas:
        if all((c / f).exists() for f, _ in CALENDARIOS.values()):
            return c
    raise SystemExit("No encuentro los calendarios de eventos. Probé:\n  " + "\n  ".join(map(str, candidatas))
                     + "\nPasá la carpeta con --calendarios")


def _sin_acentos(s):
    return "".join(c for c in unicodedata.normalize("NFKD", str(s)) if not unicodedata.combining(c))


def _familia(desc, pais=None):
    """'Cyber Monday - Inicio' / 'CYBER MONDAY' / 'Cyber' → 'Cyber Monday'; 'El Buen Fin + Feriado' → 'El Buen Fin'.
    En Chile 'Cyber' es el CyberDay de octubre (su Cyber Monday figura como tal)."""
    d = re.sub(r"\s*[-+]\s*(inicio|final|feriado)\s*$", "", str(desc).strip(), flags=re.I)
    d = re.sub(r"\s+", " ", d).strip()
    t = d.lower()
    if t == "cyber" and pais == "Chile":
        return "CyberDay"
    if t in ("cyber", "cyber monday"):
        return "Cyber Monday"
    return d.title() if d.isupper() else d


def leer_calendario(path, hoja):
    df = pd.read_excel(path, sheet_name=hoja)
    df = df.rename(columns=lambda c: _sin_acentos(c).strip().lower())
    # Fecha: datetime (Eventos) o serial de Excel (hojas regionales); acá siempre datetime o número.
    def _fecha(v):
        if isinstance(v, (int, float)) and not pd.isna(v):
            return pd.Timestamp("1899-12-30") + pd.Timedelta(days=int(v))
        return pd.to_datetime(v, errors="coerce")
    df["fecha"] = pd.to_datetime(df["fecha"].map(_fecha), errors="coerce")
    df = df.dropna(subset=["fecha", "pais"])
    df["pais"] = df["pais"].map(lambda p: _sin_acentos(p).strip()).replace(PAIS_REAL)
    df["tipo"] = df["tipo dia"].astype(str).str.strip().str.lower()
    df["descripcion"] = df["descripcion"].astype(str).str.strip()
    # Promociones de un solo partner (BBVA, Latam: "Mega Promo", "Semana Mundialista") no son eventos de industria.
    if "partner" in df.columns:
        partner = df["partner"].fillna("").astype(str).str.strip().str.upper()
        df = df[partner.isin(["", "N/A", "NAN"])]
    return df[["fecha", "pais", "descripcion", "tipo"]]


def _es_evento(r):
    # 'Evento', 'Evento 1'..'Evento 9'. Los 'PRE/POST BLACK FRIDAY' de Other Countries son pre/post.
    return r.tipo.startswith("evento") and not re.match(r"^(pre|post)\b", r.descripcion, re.I)


def _es_pre(r):
    return r.tipo.startswith("pre evento") or bool(re.match(r"^pre\b", r.descripcion, re.I))


def _es_post(r):
    return r.tipo.startswith("post evento") or bool(re.match(r"^post\b", r.descripcion, re.I))


def armar_eventos(cal, lob):
    """Bloques de días de evento contiguos (hueco ≤ GAP_MAX) por país; cada bloque con su pre/post."""
    out = []
    for pais, g in cal.groupby("pais"):
        g = g.sort_values("fecha")
        ev = g[g.apply(_es_evento, axis=1)].drop_duplicates("fecha")
        pre = set(g[g.apply(_es_pre, axis=1)].fecha)
        post = set(g[g.apply(_es_post, axis=1)].fecha)
        bloques, cur = [], []
        for r in ev.itertuples():
            if cur and (r.fecha - cur[-1].fecha).days > GAP_MAX + 1:
                bloques.append(cur); cur = []
            cur.append(r)
        if cur:
            bloques.append(cur)
        # Eventos marcados solo con su día "- Inicio" y su día "- Final" (Hot Fashion MX): mismo
        # evento si el bloque siguiente es de la misma familia y arranca dentro de MERGE_MAX días.
        unidos = []
        for b in bloques:
            prev = unidos[-1] if unidos else None
            if (prev and _familia(prev[-1].descripcion, pais) == _familia(b[0].descripcion, pais)
                    and (b[0].fecha - prev[-1].fecha).days <= MERGE_MAX):
                prev.extend(b)
            else:
                unidos.append(b)
        for b in unidos:
            ini, fin = b[0].fecha, b[-1].fecha
            familias = []
            for r in b:
                fam = _familia(r.descripcion, pais)
                if fam not in familias:
                    familias.append(fam)
            # pre/post pegados al bloque según el calendario (hasta 7 días); si no hay, PRE_POST_DEFAULT.
            n_pre = 0
            while n_pre < 7 and (ini - timedelta(days=n_pre + 1)) in pre:
                n_pre += 1
            n_post = 0
            while n_post < 7 and (fin + timedelta(days=n_post + 1)) in post:
                n_post += 1
            out.append({
                "lob": lob,
                "pais": pais,
                "familia": familias[0],
                "nombre": " + ".join(familias),
                "anio": int(ini.year),
                "inicio": ini.strftime("%Y-%m-%d"),
                "fin": fin.strftime("%Y-%m-%d"),
                "dias": (fin - ini).days + 1,
                "pre": n_pre or PRE_POST_DEFAULT,
                "post": n_post or PRE_POST_DEFAULT,
                "pre_cal": bool(n_pre),
                "post_cal": bool(n_post),
            })
    return out


# ── LY que falta (B2B2C y B2C, nov–dic) ───────────────────────────────────────

def _agg_dia_pais(df, cols):
    df = df.copy()
    df["pais"] = df["pais"].replace(PAIS_REAL)
    g = df.groupby(["fecha", "pais"], as_index=False)[cols].sum().round(2)
    g = g.sort_values(["fecha", "pais"])
    return {"cols": ["fecha", "pais"] + cols, "rows": g[["fecha", "pais"] + cols].values.tolist()}


def bajar_ly(ds, desde, hasta):
    print(f"  LY {desde} → {hasta} (queries de daily_sync.py)")
    a = ds["clean_actuals"](ds["fetch"](ds["build_actuals_query"](desde, hasta), "B2B2C LY nov-dic"))
    b2b2c = _agg_dia_pais(a, ["gross_bookings", "net_revenues", "fvm", "fvm_ex_coi_br"])
    c = ds["agg_b2c"](ds["fetch"](ds["build_b2c_query"](desde, hasta), "B2C LY nov-dic"))
    b2c = _agg_dia_pais(c, ["gross_bookings", "net_revenues", "fvm"])
    return {"b2b2c": b2b2c, "b2c": b2c}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--calendarios", help="carpeta con los dos Excel de calendario (default: OneDrive 'Estacionalidad Diaria')")
    ap.add_argument("--ly-year", type=int, default=date.today().year - 1, help="año del LY a completar (default: año pasado)")
    ap.add_argument("--no-upload", action="store_true", help="no sube a Drive (solo escribe --out)")
    ap.add_argument("--out", help="además guarda el JSON en este archivo")
    args = ap.parse_args()

    carpeta = _carpeta_calendarios(args.calendarios)
    print(f"Calendarios: {carpeta}")
    eventos = []
    for lob, (archivo, hojas) in CALENDARIOS.items():
        cal = pd.concat([leer_calendario(carpeta / archivo, h) for h in hojas], ignore_index=True)
        ev = armar_eventos(cal, lob)
        print(f"  {lob}: {len(ev)} eventos ({archivo})")
        eventos += ev
    eventos.sort(key=lambda e: (e["lob"], e["inicio"], e["pais"]))

    ds = _defs_daily_sync()
    desde, hasta = date(args.ly_year, 11, 1), date(args.ly_year, 12, 31)
    ly = bajar_ly(ds, desde, hasta)

    payload = {
        "meta": {
            "generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "calendarios": {lob: archivo for lob, (archivo, _) in CALENDARIOS.items()},
            "ly_ext_from": str(desde),
            "ly_ext_to": str(hasta),
        },
        "eventos": eventos,
        # Diario fecha × país del LY que daily_sync.py todavía no publica. La solapa lo usa solo para
        # las fechas posteriores al ly_to de los JSON del Daily (si ya están ahí, manda el del Daily).
        "ly_ext": ly,
    }
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    print(f"  {FILE_NAME}: {len(raw) / 1024:.0f} KB, {len(eventos)} eventos, "
          f"B2B2C {len(ly['b2b2c']['rows'])} filas, B2C {len(ly['b2c']['rows'])} filas")
    if args.out:
        Path(args.out).write_bytes(raw)
        print(f"  OK guardado en {args.out}")
    if not args.no_upload:
        ds["upload_to_drive"](raw, FILE_NAME)
        print("  Ahora: py Ownia_B2B_Ecosystem/mirror/ownia_mirror.py --module daily")


if __name__ == "__main__":
    main()
