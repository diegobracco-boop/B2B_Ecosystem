"""
plana_to_cube.py — ADAPTADOR ETAPA 1 (contable): JSON canónicos "largos" -> cubo del dashboard.

Convierte los JSON canónicos por concepto (budget/forecast/actuals/actuals_previos_fy26,
formato {meta,cols,rows}) al "cubo" pre-pivoteado que consumen los backends del
P&L Projections Review:
    data[lgKey][pais][escenario][P&L N2][YYYY-MM] = monto
    data_by_prod[lgKey][pais][producto][escenario][P&L N2][YYYY-MM] = monto

Escenarios que se reconstruyen desde el canónico:
  - ac  <- actuals.json                (FY en curso, FY27)
  - bg  <- budget.json
  - fc  <- forecast.json
  - ly  <- actuals_previos_fy26.json   (FY26 = Last Year del FY27)
  - rr  <- runrate.json                (ETAPA 2 — antes se arrastraba del cubo viejo)
  - lrr <- lastrunrate.json            (ETAPA 2 — escenario NUEVO, para goal "Last Run Rate")
Solo lo GESTIONAL (gest/gest_ri) se ARRASTRA aún del cubo viejo en Drive (feed de la
vista Managerial / blend; se migrará cuando corresponda).

Sale a los MISMOS file IDs de Drive que hoy usa el dashboard (main + EPM), así el
Apps Script no se toca. Por default NO sube: genera los cubos localmente para validar.
Subí con --upload (sobrescribe los archivos vivos que lee el dashboard).

Uso:
    python plana_to_cube.py                 # genera local (main + epm), no sube
    python plana_to_cube.py --upload        # genera y sube a Drive
    python plana_to_cube.py --only main     # solo un target
"""
import os, sys, io, json, argparse, datetime
from collections import defaultdict, OrderedDict
import pnl_common

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DIR = os.path.dirname(os.path.abspath(__file__))

# ── Targets: los dos cubos contables que hoy lee el dashboard ────────────────
TARGETS = {
    "main": {"file_id": "1KHXgPykAHTJS50wI13kcz76FtLQwRnXc", "name": "_pnl_contable_data.json"},
    "epm":  {"file_id": "1Rx6YYnFH5SA6ltDoTu659O-h08dkljZm", "name": "_pnl_contable_epm_data.json"},
}

# escenario del cubo  <-  archivo canónico
# ETAPA 2: 'rr' ya no se arrastra del cubo viejo → sale de runrate.json.
#          'lrr' (Last Run Rate) es un escenario NUEVO ← lastrunrate.json.
CANON = {
    "ac":  "actuals.json",
    "bg":  "budget.json",
    "fc":  "forecast.json",
    "ly":  "actuals_previos_fy26.json",
    "rr":  "runrate.json",
    "lrr": "lastrunrate.json",
    "bl":  "baseline_actuals+projections.json",   # baseline ÚNICO (fuente = baseline_builder.py)
}
CARRY = ["gest", "gest_ri"]             # solo gestional se arrastra del cubo viejo

# país canónico (lowercase)  ->  etiqueta del cubo
PAIS_MAP = {
    "argentina": "Argentina", "brasil": "Brasil", "chile": "Chile",
    "colombia": "Colombia", "ecuador": "Ecuador", "mexico": "Mexico",
    "peru": "Peru", "rg": "RG",
    "others countries": "Globales",
}


# ── Drive helpers ────────────────────────────────────────────────────────────
def dl_json(file_id):
    from googleapiclient.http import MediaIoBaseDownload
    svc = pnl_common.get_drive_service()
    req = svc.files().get_media(fileId=file_id)
    buf = io.BytesIO(); dl = MediaIoBaseDownload(buf, req); done = False
    while not done:
        _, done = dl.next_chunk()
    return json.loads(buf.getvalue())


def up_json(file_id, name, obj):
    from googleapiclient.http import MediaInMemoryUpload
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    svc = pnl_common.get_drive_service()
    media = MediaInMemoryUpload(data, mimetype="application/json", resumable=False)
    svc.files().update(fileId=file_id, media_body=media).execute()
    print(f"  [Drive] actualizado {name} ({len(data)/1e6:.2f} MB)")


# ── lgKeys a los que aporta una fila (LOB level y producto level) ────────────
def lgkeys_for(lob, canal):
    if lob == "b2b2c":
        return ["b2b2c", "all"]
    if lob == "b2b":
        if canal == "may": return ["b2b_may", "b2b", "all"]
        if canal == "min": return ["b2b_min", "b2b", "all"]
        return ["b2b", "all"]
    return []  # b2c excluido (el cubo viejo no lo incluye)


def prod_lgkeys_for(lob, canal):
    if lob == "b2b":
        if canal == "may": return ["b2b_may", "b2b"]
        if canal == "min": return ["b2b_min", "b2b"]
        return ["b2b"]
    return []


def _add(cube, lg, pais, sc, n2, ym, val):
    cube.setdefault(lg, {}).setdefault(pais, {}).setdefault(sc, {}).setdefault(n2, {})
    d = cube[lg][pais][sc][n2]
    d[ym] = d.get(ym, 0.0) + val


def _add_prod(cube, lg, pais, prod, sc, n2, ym, val):
    cube.setdefault(lg, {}).setdefault(pais, {}).setdefault(prod, {}) \
        .setdefault(sc, {}).setdefault(n2, {})
    d = cube[lg][pais][prod][sc][n2]
    d[ym] = d.get(ym, 0.0) + val


# ── Construye la parte contable (ct) desde los JSON canónicos ────────────────
def build_ct():
    ct_data = {}         # data[lg][pais][sc][n2][ym]
    ct_prod = {}         # data_by_prod[lg][pais][prod][sc][n2][ym]
    fc_months = set()    # meses presentes en forecast.json (para el backfill de Jul)
    unknown_pais = set()

    for sc, fname in CANON.items():
        path = os.path.join(DIR, fname)
        if not os.path.exists(path):
            sys.exit(f"Falta {fname} en {DIR}. Corré json_builder.py primero.")
        d = json.load(open(path, encoding="utf-8"))
        cols = d["cols"]; ci = {c: i for i, c in enumerate(cols)}
        iL, iC, iP, iPr = ci["LoB"], ci["Canal"], ci["Pais"], ci["Producto"]
        iN2, iF, iM = ci["P&L N2"], ci["Fecha"], ci["Monto USD"]
        for r in d["rows"]:
            lob = str(r[iL]).strip().lower()
            if lob == "b2c":
                continue
            canal = str(r[iC]).strip().lower()
            praw = str(r[iP]).strip().lower()
            pais = PAIS_MAP.get(praw)
            if pais is None:
                unknown_pais.add(praw); continue
            n2 = str(r[iN2]).strip().lower()
            ym = str(r[iF])[:7]
            monto = float(r[iM] or 0.0)
            if sc == "fc":
                fc_months.add(ym)
            for lg in lgkeys_for(lob, canal):
                _add(ct_data, lg, pais, sc, n2, ym, monto)
            prod = str(r[iPr]).strip().lower()
            for lg in prod_lgkeys_for(lob, canal):
                _add_prod(ct_prod, lg, pais, prod, sc, n2, ym, monto)

    # país rollup 'all' = suma de todos los países (por lg/sc/n2/ym)
    for lg in ct_data:
        agg = {}
        for pais, scmap in ct_data[lg].items():
            if pais == "all":
                continue
            for sc, n2map in scmap.items():
                for n2, mm in n2map.items():
                    for ym, v in mm.items():
                        agg.setdefault(sc, {}).setdefault(n2, {})
                        agg[sc][n2][ym] = agg[sc][n2].get(ym, 0.0) + v
        ct_data[lg]["all"] = agg

    if unknown_pais:
        print(f"  [warn] países canónicos sin mapear (ignorados): {sorted(unknown_pais)}")
    print(f"  ct construido: lgKeys={sorted(ct_data)}  fc_months={sorted(fc_months)}")
    return ct_data, ct_prod, fc_months


def _round_tree(node):
    """Redondea hojas float a 6 decimales (evita ruido de coma flotante)."""
    if isinstance(node, dict):
        for k in node:
            node[k] = _round_tree(node[k])
        return node
    return round(node, 6)


# ── Ensambla un cubo target: carry rr/gest + ct nuevo + backfill fc + meta ───
def assemble(base, ct_data, ct_prod, fc_months, actual_months):
    cube = OrderedDict()
    # escalares del calendario fiscal: se conservan del base
    for k in ("months_fy27", "months_fy26", "quarters", "products"):
        if k in base:
            cube_val = base[k]
        else:
            cube_val = None
        if cube_val is not None:
            cube[k] = cube_val
    cube["updated_at"] = datetime.datetime.now().isoformat(timespec="seconds")
    cube["actual_months"] = actual_months

    data = {}
    # 1) arrastrar escenarios gestionales/runrate del cubo viejo
    for lg, paises in base.get("data", {}).items():
        for pais, scmap in paises.items():
            for sc in CARRY:
                if sc in scmap:
                    data.setdefault(lg, {}).setdefault(pais, {})[sc] = scmap[sc]
    # 2) escribir la parte contable nueva
    for lg, paises in ct_data.items():
        for pais, scmap in paises.items():
            for sc, n2map in scmap.items():
                data.setdefault(lg, {}).setdefault(pais, {})[sc] = n2map
    # 3) backfill fc: meses del fc viejo que el canónico NO cubre (ej. Jul-26)
    n_bf = 0
    for lg, paises in base.get("data", {}).items():
        for pais, scmap in paises.items():
            ofc = scmap.get("fc", {})
            for n2, mm in ofc.items():
                for ym, v in mm.items():
                    if ym not in fc_months:
                        data.setdefault(lg, {}).setdefault(pais, {}).setdefault("fc", {}) \
                            .setdefault(n2, {})[ym] = v
                        n_bf += 1
    cube["data"] = data

    # data_by_prod: idéntica lógica (carry gestional + ct + backfill fc)
    dbp = {}
    base_dbp = base.get("data_by_prod", {})
    for lg, paises in base_dbp.items():
        for pais, prods in paises.items():
            for prod, scmap in prods.items():
                for sc in CARRY:
                    if sc in scmap:
                        dbp.setdefault(lg, {}).setdefault(pais, {}).setdefault(prod, {})[sc] = scmap[sc]
    for lg, paises in ct_prod.items():
        for pais, prods in paises.items():
            for prod, scmap in prods.items():
                for sc, n2map in scmap.items():
                    dbp.setdefault(lg, {}).setdefault(pais, {}).setdefault(prod, {})[sc] = n2map
    for lg, paises in base_dbp.items():
        for pais, prods in paises.items():
            for prod, scmap in prods.items():
                ofc = scmap.get("fc", {})
                for n2, mm in ofc.items():
                    for ym, v in mm.items():
                        if ym not in fc_months:
                            dbp.setdefault(lg, {}).setdefault(pais, {}).setdefault(prod, {}) \
                                .setdefault("fc", {}).setdefault(n2, {})[ym] = v
    cube["data_by_prod"] = dbp

    _round_tree(cube["data"]); _round_tree(cube["data_by_prod"])
    print(f"  ensamblado: {len(data)} lgKeys | backfill fc celdas={n_bf}")
    return cube


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--upload", action="store_true", help="subir a Drive (sobrescribe los vivos)")
    ap.add_argument("--only", choices=list(TARGETS), help="generar solo un target")
    args = ap.parse_args()

    print("=== adaptador etapa 1: canónico -> cubo contable ===")
    ct_data, ct_prod, fc_months = build_ct()

    # actual_months desde actuals.json (FY en curso)
    acts = json.load(open(os.path.join(DIR, "actuals.json"), encoding="utf-8"))
    actual_months = sorted({str(x)[:7] for x in acts["meta"]["fechas"]})
    print(f"  actual_months={actual_months}")

    targets = [args.only] if args.only else list(TARGETS)
    for t in targets:
        cfg = TARGETS[t]
        print(f"\n--- target '{t}' ({cfg['name']}) ---")
        base = dl_json(cfg["file_id"])
        cube = assemble(base, ct_data, ct_prod, fc_months, actual_months)
        out = os.path.join(DIR, f"_cube_{t}.json")
        txt = json.dumps(cube, ensure_ascii=False, separators=(",", ":"))
        open(out, "w", encoding="utf-8").write(txt)
        print(f"  escrito {out} ({len(txt.encode('utf-8'))/1e6:.2f} MB)")
        if args.upload:
            up_json(cfg["file_id"], cfg["name"], cube)

    if not args.upload:
        print("\n(NO subido — usá --upload para publicar a Drive)")


if __name__ == "__main__":
    main()
