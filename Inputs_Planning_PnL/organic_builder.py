"""
organic_builder.py — versiones ORGANIC (a TC Budget) de los JSON canónicos del P&L contable (2026-10-30).

Para Toqan (agente de IA interno) y cualquier consumidor que necesite los escenarios comparables sin efecto tipo de cambio.
Misma regla que el switch "Organic YES" de P&L Accounting (P&L_Accounting/Codigo_organic.js) y del Hub:
    organic = USD × TC origen(país, mes) / TC Budget(país, mes)
  - actuals / baseline / runrate: TC origen = "Actuals" de tc_plana_flat.xlsx (en los meses proyectados ya trae el TC del RunRate).
  - forecast / forecastbtb: TC origen = "Forecast" (abr–jul del Forecast son actuals y ahí TC Forecast = TC Actuals).
  - Orders no se convierten. Países sin TC (others countries, …) quedan nominales. RG / OPS / OPS + RG usan el TC de Brasil.
    Uruguay viene dentro de "others countries" en los canónicos, así que queda nominal (Accounting lo corrige con
    data_fxsplit; acá no hay ese detalle).
  - El Budget no tiene versión organic: ya está a TC Budget.
Salida: <base>_organic.json en la carpeta de los canónicos y en la comprimida (json_builder._upload), mismo esquema que
el original + meta.organic {target, origen, convertidas, sin_tc, faltantes}.

Uso:
    python organic_builder.py                       # todas
    python organic_builder.py runrate baseline      # algunas
Se corre solo al final de json_builder.py (bases que suben) y de baseline_builder._emit (baseline).
"""
import json
import sys
from datetime import datetime

import pnl_common
import okr_builder
import okr_h2_builder as h2b

FX_FILE_ID = "1SEh9vLWCbE6PslnUntUghhInonuLdYZ5"   # tc_plana_flat.xlsx
# base -> (file id del canónico, nombre, escenario de TC con el que vienen los montos)
BASES = {
    "actuals":     ("1PABNf4XVKdj6eXApr5_yP581ZsD_N9e-", "actuals.json", "actuals"),
    "baseline":    ("1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv", "baseline_actuals+projections.json", "actuals"),
    "runrate":     ("1UGg60kE397nsGAivtFqI8NX5CVFj1gqO", "runrate.json", "actuals"),
    "forecast":    ("1crqpRTyH14fqX9XdwBTVaKN5rPbE6O84", "forecast.json", "forecast"),
    "forecastbtb": ("1anL-CsItySxuWTp4FuX69tHsAy9oz4rp", "forecastbtb.json", "forecast"),
}


def fx_table(content):
    """tc_plana_flat.xlsx -> {'actuals'|'budget'|'forecast': {(pais, 'YYYY-MM'): tc}} (mes calendario)."""
    import io
    import openpyxl
    ws = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True).worksheets[0]
    it = ws.iter_rows(values_only=True)
    hdr = {h2b._fx_norm(h): i for i, h in enumerate(next(it)) if h is not None}
    fx = {"actuals": {}, "budget": {}, "forecast": {}}
    for r in it:
        esc = h2b._fx_norm(r[hdr["escenario"]])
        mm = h2b._FX_MES.get(h2b._fx_norm(r[hdr["mes"]]))
        try:
            fy, tc = int(r[hdr["ano"]]), float(r[hdr["dato"]])
        except (TypeError, ValueError):
            continue
        pais = h2b._fx_norm(r[hdr["pais"]])
        if esc in fx and mm and tc > 0 and pais and pais != "euro":
            fx[esc][(pais, f"{fy - 1 if mm >= 4 else fy}-{mm:02d}")] = tc
    for k, v in fx.items():
        if not v:
            raise ValueError(f'tc_plana_flat.xlsx: no hay tipos de cambio de "{k}"')
    return fx


def convert(canon, fx, origen):
    cols = canon["cols"]
    iP, iF, iM, iN2 = cols.index("Pais"), cols.index("Fecha"), cols.index("Monto USD"), cols.index("P&L N2")
    src, bud = fx[origen], fx["budget"]
    paises_fx = {p for p, _ in src}
    sin_tc, faltan, n = set(), set(), 0
    rows = []
    for r in canon["rows"]:
        r = list(r)
        if str(r[iN2]).lower() != "orders" and r[iM]:
            p = h2b._fx_norm(r[iP])
            p = h2b._FX_PAIS_ALIAS.get(p, p)
            ym = str(r[iF])[:7]
            if p not in paises_fx:
                sin_tc.add(p)
            else:
                a, b = src.get((p, ym)), bud.get((p, ym))
                if a and b:
                    r[iM] = float(r[iM]) * a / b
                    n += 1
                else:
                    faltan.add(f"{p} {ym}")
        rows.append(r)
    return rows, {"convertidas": n, "sin_tc": sorted(sin_tc), "faltantes": sorted(faltan)}


def build(bases=None, upload=True, svc=None):
    import json_builder
    svc = svc or pnl_common.get_drive_service()
    fx = fx_table(okr_builder._download_bytes(svc, FX_FILE_ID))
    for base in bases or list(BASES):
        fid, name, origen = BASES[base]
        canon = okr_builder._download_json(svc, fid, name)
        rows, info = convert(canon, fx, origen)
        meta = dict(canon.get("meta") or {})
        meta["organic"] = dict(info, target="TC Budget", origen=f"TC {origen.capitalize()}", fuente_tc="tc_plana_flat.xlsx",
                               generado=datetime.now().isoformat(timespec="seconds"), original=name,
                               regla="USD × TC origen(país, mes) / TC Budget(país, mes); orders y países sin TC sin convertir; RG/OPS con TC Brasil")
        out = {"meta": meta, "cols": canon["cols"], "rows": rows}
        oname = name.replace(".json", "_organic.json")
        print(f"  [Organic] {oname}: {info['convertidas']:,} filas convertidas · sin TC (nominal): {info['sin_tc']}"
              + (f" · faltan TC: {info['faltantes'][:6]}{'…' if len(info['faltantes']) > 6 else ''}" if info["faltantes"] else ""))
        if upload:
            json_builder._upload(oname, json.dumps(out, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8"))


def refresh(bases, svc=None):
    """Hook de los pipelines: no frena la corrida si falla."""
    try:
        build(bases, True, svc)
    except Exception as e:
        print(f"  WARN [Organic] no se pudieron actualizar las versiones organic de {bases}: {e}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    bad = [a for a in args if a not in BASES]
    if bad:
        sys.exit(f"Bases válidas: {', '.join(BASES)}")
    build(args or None, upload="--no-upload" not in sys.argv)
