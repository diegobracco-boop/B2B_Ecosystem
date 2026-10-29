"""
okr_h2_builder.py
Arma OKR_H2_FY27.json: los KRs de H2 FY27 (octubre 2026 -> marzo 2027) con detalle por pais, para que el OKR del Hub
pueda aplicar "organic" al leer (el organic convierte cada monto por pais y mes; con los KRs ya sumados en Total no se puede).

Lo usa okr_builder.py (build()). okr.json sigue igual (Pais=Total, USD nominales) para el Daily y el Tracker.

Formato: cols = Periodo, Escenario, LoB, Pais, Producto, KR, Valor, Estado
  - KRs contables (Op. Contribution B2B2C, Net Revenues B2B, OC API / HTML, NR API Hoteles, New / Existing Account NR):
    una fila por pais, USD nominales. El Hub las suma (y con organic las convierte por pais).
  - KRs no monetarios / manuales (Unique Buyers, Deploy New Partnership, Accelerate Recurrence, Partners API, hoteles
    directos, Onboarded Properties, Price Competitiveness): Pais = Total.
  - Estado (solo Run Rate/Actuals): "Actual" = mes con cierre contable; "Proyeccion" = todavia sin cierre (hoy oct-mar, definido
    2026-10-27); "MTD" = mes en curso a la fecha (Unique Buyers); "Real" = Unique Buyers de un mes cerrado del Datalake;
    "Manual" = Input_OKR / tracker. Budget: "Budget".

Unique Buyers proyectado (2026-10-27): UB / orders B2B2C es muy estable (0,82-0,87 en 22 meses), asi que los meses futuros
= ratio (promedio ponderado de los ultimos 6 meses cerrados) x orders del Run Rate del Daily; el mes en curso es el MTD tal
como viene; un mes cerrado pisa con el real del Datalake.
"""
from collections import defaultdict

import sys
from pathlib import Path

H2_START = "2026-10-01"
COLS_H2 = ["Periodo", "Escenario", "LoB", "Pais", "Producto", "KR", "Valor", "Estado"]
RR, BUD = "Run Rate/Actuals", "Budget"

# KRs de H2 que NO salen del contable (van con Pais=Total tal como vienen de okr.json)
H2_MANUAL_KRS = {
    "deploy new partnership", "unique buyers", "accelerate recurrence", "accelerate hunting partners api",
    "hoteles directos vendidos destino latam", "% hoteles directos vendidos destino globales",
    "new onboarded properties global & regional chains", "price competitiveness ex-latam (destino gl)",
}
UB_RATIO_MONTHS = 6          # meses cerrados para el ratio UB / orders

# El contable agrupa USA y Globales en "others countries"; el Daily los abre.
_DAILY_PAIS = {"other countries": "others countries", "others countries": "others countries",
               "usa": "others countries", "globales": "others countries", "rg": "rg", "ops": "ops"}


def _daily_pais(p):
    k = str(p or "").strip().lower()
    return _DAILY_PAIS.get(k, k)


def _ym_to_periodo(ym):
    return str(ym)[:7] + "-01"


def _estado_rr(periodo, closed_until):
    return "Actual" if periodo <= closed_until else "Proyeccion"


def contable_by_pais(canon_data, scen_label, closed_until):
    """KRs contables (ver docstring) por pais desde un canonico (baseline o budget).
    Devuelve (rows, nr_b2b2c) con nr_b2b2c = {(periodo, pais): NR B2B2C} (para Existing)."""
    c = canon_data["cols"]
    iL, iC, iP, iPr, iN3, iN5, iF, iM = (c.index(x) for x in
                                         ("LoB", "Canal", "Pais", "Producto", "P&L N3", "P&L N5", "Fecha", "Monto USD"))
    acc = defaultdict(float)
    nr_b2b2c = defaultdict(float)
    for r in canon_data["rows"]:
        f = str(r[iF])[:10]
        if f < H2_START:
            continue
        lob, canal, pais, prod = (str(r[iL]).lower(), str(r[iC]).lower(), str(r[iP]).lower(), str(r[iPr]).lower())
        n3, n5, m = str(r[iN3]).lower(), str(r[iN5]).lower(), float(r[iM] or 0)
        if lob == "b2b2c" and n5 == "operating contribution":
            acc[("B2B2C", "Op. Contribution", "Total", f, pais)] += m
        if lob == "b2b2c" and n3 == "net revenue":
            nr_b2b2c[(f, pais)] += m
        if lob == "b2b" and n3 == "net revenue":
            acc[("B2B", "Net Revenues B2B", "Total", f, pais)] += m
            if canal == "may" and prod in ("hotels", "hotel"):
                acc[("Globales", "Net Revenues API Hoteles", "Hotels", f, pais)] += m
        if lob == "b2b" and n5 == "operating contribution":
            if canal == "may":
                acc[("B2B", "Operating Contribution API", "API", f, pais)] += m
            elif canal == "min":
                acc[("B2B", "Operating Contribution HTML", "HTML", f, pais)] += m
    rows = []
    for (lob, kr, prod, f, pais), v in sorted(acc.items(), key=lambda kv: (kv[0][3], kv[0][1], kv[0][4])):
        est = BUD if scen_label == BUD else _estado_rr(f, closed_until)
        rows.append([f, scen_label, lob, pais, prod, kr, round(v, 2), est])
    return rows, nr_b2b2c


def _daily_new_by_pais(block):
    """okr_budget / okr_runrate del Daily -> {(periodo, pais): NR de cuentas 'New'}. Necesita la columna pais."""
    cols, rows = block.get("cols", []), block.get("rows", [])
    if not rows or "pais" not in cols:
        return None
    iF, iP, iS, iN = cols.index("fecha"), cols.index("pais"), cols.index("stage"), cols.index("net_revenue")
    out = defaultdict(float)
    for r in rows:
        if str(r[iS]) == "New":
            out[(_ym_to_periodo(r[iF]), _daily_pais(r[iP]))] += float(r[iN] or 0)
    return out


def hunting_farming_by_pais(daily_json, nr_by_scen, last_actual_ym, closed_until):
    """Hunting (New) = NR gestional del Daily; Existing = NR contable B2B2C - Hunting (por pais y mes).
    Misma definicion que okr_builder._compute_b2b2c_hunting_farming, abierta por pais. Solo H2."""
    corte = _ym_to_periodo(last_actual_ym)
    act_new = defaultdict(float)
    for r in daily_json.get("actuals", []):
        if str(r.get("account_type", "")) == "New":
            act_new[(_ym_to_periodo(r.get("fecha", "")), _daily_pais(r.get("pais")))] += float(r.get("net_revenues") or 0)
    bud_new = _daily_new_by_pais(daily_json.get("okr_budget") or {})
    rr_new = _daily_new_by_pais(daily_json.get("okr_runrate") or {})
    if bud_new is None or rr_new is None:
        print("  [H2 Hunting] okr_budget / okr_runrate del Daily no traen 'pais' (correr daily_sync.py): sin Hunting / Existing en OKR_H2_FY27.json")
        return []
    bud_months = {k[0] for k in bud_new}
    rr_months = {k[0] for k in rr_new}

    def hunting(scen, f, pais):
        if scen == BUD:
            return bud_new.get((f, pais), 0.0)
        if f <= corte:
            return act_new.get((f, pais), 0.0)
        if f in rr_months:
            return rr_new.get((f, pais), 0.0)
        return bud_new.get((f, pais), 0.0)

    def covered(scen, f):
        return f in bud_months if scen == BUD else (f <= corte or f in rr_months or f in bud_months)

    rows = []
    for scen, nr in nr_by_scen.items():
        periodos = sorted({f for (f, _) in nr})
        for f in periodos:
            if f < H2_START or not covered(scen, f):
                continue
            paises = {p for (ff, p) in nr if ff == f} | {p for (ff, p) in (bud_new if scen == BUD else {**bud_new, **rr_new, **act_new}) if ff == f}
            est = BUD if scen == BUD else _estado_rr(f, closed_until)
            for pais in sorted(paises):
                h = hunting(scen, f, pais)
                e = nr.get((f, pais), 0.0) - h
                rows.append([f, scen, "B2B2C", pais, "Total", "New Account Net Revenues", round(h, 2), est])
                rows.append([f, scen, "B2B2C", pais, "Total", "Existing Account Net Revenues", round(e, 2), est])
    return rows


def _orders_by_month(rows, key="fecha"):
    out = defaultdict(float)
    for r in rows:
        out[str(r[key])[:7]] += float(r.get("orders") or 0)
    return out


def _orders_block(block):
    cols, rows = block.get("cols", []), block.get("rows", [])
    if not rows or "orders" not in cols:
        return {}
    iF, iO = cols.index("fecha"), cols.index("orders")
    out = defaultdict(float)
    for r in rows:
        out[str(r[iF])[:7]] += float(r[iO] or 0)
    return out


def apply_unique_buyers(rows_manual, daily_json, last_actual_ym):
    """Unique Buyers (H2, B2B2C), Run Rate/Actuals: real del Datalake si el mes cerro; MTD en el mes en curso; ratio x orders del
    Run Rate en los meses futuros. El target (Budget) sigue de Input_OKR. Devuelve (rows_manual, estado) con
    estado = {periodo: 'Real'|'MTD'|'Proyeccion'}. Si no hay datos del Datalake deja Input_OKR tal cual."""
    tot = (daily_json or {}).get("unique_buyers_total") or {}
    if not tot:
        print("  [Unique Buyers] sin unique_buyers_total en daily_b2b2c_data.json — se mantiene Input_OKR")
        return rows_manual, {}
    # orders reales (misma base que el ratio) y orders proyectadas (Run Rate; si falta el mes, Budget)
    real = defaultdict(float)
    for k in ("actuals_ly", "actuals_ly_fy_rest", "actuals_fy_rest", "actuals"):
        real.update(_orders_by_month(daily_json.get(k) or []))   # un mes no esta en dos bloques; si pasara, manda el ultimo
    rr_o, bud_o = {}, {}
    for k in ("runrate", "runrate_fy_rest"):
        rr_o.update(_orders_block(daily_json.get(k) or {}))
    for k in ("budget", "budget_fy_rest"):
        bud_o.update(_orders_block(daily_json.get(k) or {}))
    cerrados = [m for m in sorted(tot) if m <= last_actual_ym and real.get(m)][-UB_RATIO_MONTHS:]
    if not cerrados:
        print("  [Unique Buyers] sin meses cerrados con orders para el ratio — se mantiene Input_OKR")
        return rows_manual, {}
    ratio = sum(tot[m] for m in cerrados) / sum(real[m] for m in cerrados)
    print(f"  [Unique Buyers] ratio UB/orders = {ratio:.3f} (ultimos {len(cerrados)} meses cerrados {cerrados[0]}..{cerrados[-1]})")

    h2_months = sorted({str(r[0])[:7] for r in rows_manual if str(r[5]).lower() == "unique buyers"} |
                       {m for m in rr_o if m >= H2_START[:7]})
    estado, nuevos = {}, {}
    for ym in sorted(set(m for m in h2_months if m >= H2_START[:7])):
        if ym <= last_actual_ym and ym in tot:
            nuevos[ym], estado[_ym_to_periodo(ym)] = tot[ym], "Real"
        elif ym in tot:                                   # mes en curso: MTD tal como viene
            nuevos[ym], estado[_ym_to_periodo(ym)] = tot[ym], "MTD"
        else:
            o = rr_o.get(ym) or bud_o.get(ym)
            if o:
                nuevos[ym], estado[_ym_to_periodo(ym)] = round(ratio * o), "Proyeccion"
    out = [r for r in rows_manual if not (r[1] == RR and str(r[5]).lower() == "unique buyers" and str(r[0])[:7] in nuevos)]
    for ym, v in sorted(nuevos.items()):
        out.append([_ym_to_periodo(ym), RR, "B2B2C", "Total", "Total", "Unique Buyers", v])
    print(f"  [Unique Buyers] {estado}")
    return out, estado


# ── New Product Growth (B2B) estimado ──────────────────────────────────────────────────────────────────────
# KR = NR de Flights + Dest. Serv. + los componentes "new product" de Packages General. La contabilidad solo abre Flights y
# Dest. Serv.; de Packages General no sabe qué parte es Vuelos / parques / excursiones / traslados / espectáculos. Se estima:
#   NR contable de Packages General x % new product del NR de Packages General del Daily (okr_h2_managerial.json, RI).
#   - mes con cierre contable : el % real de ese mes.
#   - mes proyectado          : promedio (ponderado por NR) de los ultimos 3 meses cerrados.
#   - Budget                  : las proporciones fijas por pais del Daily (pkg_split_factors.py), como el KR gestional.
# Mismos product_type que Daily_Dashboard/tracker.html (B2B_H2_NP_PKG_TYPES).
NEW_PRODUCT_PKG_TYPES = {"Vuelos", "Disney", "Universal", "SeaWorld", "Busch Gardens", "Excursiones", "Traslados", "Espectáculos"}
NEW_PRODUCT_KR = "New Product Growth"
PCT_AVG_MONTHS = 3


def _is_np_type(pt):
    pt = str(pt or "")
    return pt in NEW_PRODUCT_PKG_TYPES or pt.startswith("Espect")


def packages_new_pct_by_month(mgr_json, key="b2b_ri"):
    """{ym: (NR new product dentro de Packages General, NR Packages General)} del Daily (okr_h2_managerial.json)."""
    blk = (mgr_json or {}).get(key) or {}
    cols, rows = blk.get("cols") or [], blk.get("rows") or []
    if not rows:
        return {}
    iF, iP, iT, iN = (cols.index(c) for c in ("fecha", "producto_original", "product_type", "net_revenue"))
    out = defaultdict(lambda: [0.0, 0.0])
    for r in rows:
        if r[iP] != "Packages General":
            continue
        m = str(r[iF])[:7]
        v = float(r[iN] or 0)
        out[m][1] += v
        if _is_np_type(r[iT]):
            out[m][0] += v
    return {m: tuple(v) for m, v in out.items()}


def _budget_np_share():
    """Proporcion new product de Packages General por pais en el budget (factores fijos del Daily). {pais lower: share}."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Daily_Dashboard"))
    from pkg_split_factors import PKG_SPLIT_FACTORS
    return {str(p).lower(): sum(v for t, v in f.items() if _is_np_type(t)) for p, f in PKG_SPLIT_FACTORS.items()}


def new_product_growth(baseline_data, budget_data, mgr_json, closed_until):
    """Filas (formato OKR_H2_FY27.json, por pais) del KR New Product Growth, Run Rate/Actuals y Budget, solo H2.
    Devuelve (rows, info) con info = {pct por mes, ...} para el log."""
    pm = packages_new_pct_by_month(mgr_json)
    cierre_ym = closed_until[:7]
    ult = [m for m in sorted(pm) if m <= cierre_ym and pm[m][1] > 0][-PCT_AVG_MONTHS:]
    if not ult:
        print("  [New Product Growth] sin apertura de Packages General en el Daily (okr_h2_managerial.json) — KR sin datos")
        return [], {}
    avg = sum(pm[m][0] for m in ult) / sum(pm[m][1] for m in ult)
    real = {m: pm[m][0] / pm[m][1] for m in pm if pm[m][1] > 0}

    def pct(ym):
        return real[ym] if (ym <= cierre_ym and ym in real) else avg

    share_b = _budget_np_share()

    def rows_for(canon, scen):
        c = canon["cols"]
        iL, iPr, iP, iN3, iF, iM = (c.index(x) for x in ("LoB", "Producto", "Pais", "P&L N3", "Fecha", "Monto USD"))
        acc = defaultdict(float)
        for r in canon["rows"]:
            f = str(r[iF])[:10]
            if f < H2_START or str(r[iL]).lower() != "b2b" or str(r[iN3]).lower() != "net revenue":
                continue
            prod, pais, v = str(r[iPr]).lower(), str(r[iP]).lower(), float(r[iM] or 0)
            if prod in ("flights", "flight", "air", "dest. serv.", "d. services"):
                acc[(f, pais)] += v
            elif prod == "packages general":
                p = share_b.get(pais, share_b.get("total", 0.0)) if scen == BUD else pct(f[:7])
                acc[(f, pais)] += v * p
        out = []
        for (f, pais), v in sorted(acc.items()):
            est = BUD if scen == BUD else _estado_rr(f, closed_until)
            out.append([f, scen, "B2B", pais, "Total", NEW_PRODUCT_KR, round(v, 2), est])
        return out

    rows = rows_for(baseline_data, RR) + rows_for(budget_data, BUD)
    print(f"  [New Product Growth] % new product de Packages General: promedio {ult[0]}..{ult[-1]} = {avg * 100:.1f}% "
          f"(meses cerrados con % real: {[m for m in sorted(real) if m <= cierre_ym][-3:]}) · budget TOTAL {share_b.get('total', 0) * 100:.1f}% · {len(rows)} filas")
    return rows, {"avg": avg, "meses": ult}


def totals_from_rows(rows, kr):
    """Filas Pais=Total (formato okr.json, 7 columnas) sumando por pais las filas de un KR de OKR_H2_FY27.json."""
    acc = defaultdict(float)
    lob = None
    for r in rows:
        if r[5] == kr:
            acc[(r[0], r[1])] += r[6]
            lob = r[2]
    return [[f, esc, lob, "Total", "Total", kr, round(v, 2)] for (f, esc), v in sorted(acc.items())]


PARTNERS_API_KR = "Accelerate Hunting Partners API"


def partners_api_rows(snap):
    """Actual de "Accelerate Hunting Partners API" desde partners_api_snapshots.json (Daily_Dashboard/partners_api_sync.py): meses
    congelados (Estado "Real", no se recalculan) y, para el mes sin congelar, el rolling de los ultimos 30 dias (Estado "Rolling30", movil).
    Devuelve (rows en formato okr.json, estado {periodo: estado}). Sin archivo: ([], {})."""
    rows, estado = [], {}
    if not snap:
        return rows, estado
    for ym, d in sorted((snap.get("meses") or {}).items()):
        if ym >= H2_START[:7]:
            f = _ym_to_periodo(ym)
            rows.append([f, RR, "Globales", "Total", "Total", PARTNERS_API_KR, round(float(d["total"]), 2)])
            estado[f] = "Real"
    roll = snap.get("rolling30") or {}
    if roll.get("hasta"):
        f = _ym_to_periodo(roll["hasta"][:7])
        if roll["hasta"][:7] >= H2_START[:7] and f not in estado:
            rows.append([f, RR, "Globales", "Total", "Total", PARTNERS_API_KR, round(float(roll["total"]), 2)])
            estado[f] = "Rolling30"
    return rows, estado


def build_h2_rows(rows_baseline_h2, rows_budget_h2, rows_hunting_h2, rows_manual, rows_partners, estado_ub, closed_until, estado_partners=None):
    """Junta todo en el formato de OKR_H2_FY27.json (ordenado)."""
    out = list(rows_baseline_h2) + list(rows_budget_h2) + list(rows_hunting_h2)
    for r in list(rows_manual) + list(rows_partners):
        f, esc, lob, pais, prod, kr, v = r[:7]
        if str(f)[:10] < H2_START or str(kr).strip().lower() not in H2_MANUAL_KRS:
            continue
        if esc == BUD:
            est = BUD
        elif str(kr).lower() == "unique buyers":
            est = estado_ub.get(str(f)[:10], "Manual")
        elif str(kr).lower() == "accelerate hunting partners api":
            est = (estado_partners or {}).get(str(f)[:10], "Manual")
        elif str(kr).lower().startswith("hoteles directos") or str(kr).lower().startswith("% hoteles directos"):
            est = "MTD" if str(f)[:10] > closed_until else "Real"
        else:
            est = "Manual"
        out.append([f, esc, lob, pais, prod, kr, v, est])
    out.sort(key=lambda r: (r[0], r[1], r[2], r[5], r[3]))
    return out


# ── Organic (OKR_H2_FY27_Organic.json) ─────────────────────────────────────────────────────────────────────
# Mismo criterio que applyOrganicOKR_ (Dashboard_B2B_WLs/Codigo_OKR.js): USD x TC Actuals(pais, mes) / TC Budget(pais, mes),
# solo KRs monetarios (NR / OC) en Run Rate/Actuals (el Budget ya esta a TC Budget). Orders, Unique Buyers, conteos y % no
# se tocan. OPS / RG toman el TC de Brasil; paises sin TC (others countries, ...) y Pais=Total quedan en USD nominales.
# TC: tc_plana_flat.xlsx (el mismo que lee readFxTable_ en el Hub).
OKR_MONETARY_KRS = {
    "op. contribution", "operating contribution", "net revenues b2b", "operating contribution api",
    "operating contribution html", "net revenues api hoteles", "new account net revenues",
    "existing account net revenues", "new product growth",
}
_FX_PAIS_ALIAS = {"ops": "brasil", "rg": "brasil", "ops + rg": "brasil"}
_FX_MES = {"abr": 4, "may": 5, "jun": 6, "jul": 7, "ago": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dic": 12,
           "ene": 1, "feb": 2, "mar": 3}


def _fx_norm(s):
    import unicodedata
    s = unicodedata.normalize("NFD", str(s or "").strip().lower())
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def fx_from_xlsx(content):
    """tc_plana_flat.xlsx (bytes) -> {'actuals': {(pais, 'YYYY-MM'): tc}, 'budget': {...}}. Columnas por header, como el Hub."""
    import io
    import openpyxl
    ws = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True).worksheets[0]
    it = ws.iter_rows(values_only=True)
    hdr = {_fx_norm(h): i for i, h in enumerate(next(it)) if h is not None}
    for h in ("escenario", "ano", "mes", "pais", "dato"):
        if h not in hdr:
            raise ValueError(f'tc_plana_flat.xlsx: falta la columna "{h}"')
    fx = {"actuals": {}, "budget": {}}
    for r in it:
        esc = _fx_norm(r[hdr["escenario"]])
        if esc not in fx:
            continue
        mm = _FX_MES.get(_fx_norm(r[hdr["mes"]]))
        try:
            fy, tc = int(r[hdr["ano"]]), float(r[hdr["dato"]])
        except (TypeError, ValueError):
            continue
        pais = _fx_norm(r[hdr["pais"]])
        if not mm or not fy or not tc > 0 or not pais or pais == "euro":
            continue
        fx[esc][(pais, f"{fy - 1 if mm >= 4 else fy}-{mm:02d}")] = tc   # FY -> mes calendario
    for k in fx:
        if not fx[k]:
            raise ValueError(f'tc_plana_flat.xlsx: no hay tipos de cambio de "{k}"')
    return fx


def apply_organic(h2_rows, fx):
    """Filas de OKR_H2_FY27.json -> mismas filas con los KRs monetarios de Run Rate/Actuals a TC Budget.
    Devuelve (rows, info) con info = {'convertidas', 'sin_tc' (paises sin TC), 'missing' (pais/mes sin TC Actuals o Budget)}."""
    act, bud = fx["actuals"], fx["budget"]
    paises_fx = {p for (p, _) in act}
    out, n, sin_tc, missing = [], 0, set(), set()
    for r in h2_rows:
        f, esc, lob, pais, prod, kr, v, est = r
        if esc != RR or str(kr).strip().lower() not in OKR_MONETARY_KRS:
            out.append(list(r))
            continue
        p = _fx_norm(pais)
        p = _FX_PAIS_ALIAS.get(p, p)
        ym = str(f)[:7]
        if not p or p == "total" or p not in paises_fx:
            sin_tc.add(p or "(vacio)")
            out.append(list(r))
            continue
        a, t = act.get((p, ym)), bud.get((p, ym))
        if not a or not t:
            missing.add(f"{p} {ym}")
            out.append(list(r))
            continue
        out.append([f, esc, lob, pais, prod, kr, round(v * a / t, 2), est])
        n += 1
    return out, {"convertidas": n, "sin_tc": sorted(sin_tc), "missing": sorted(missing)}
