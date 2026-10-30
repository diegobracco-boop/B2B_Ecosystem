"""
fca_builder.py — datos para el FCA mensual de los KRs de los OKR H2 (2026-10-30).

Arma el insumo del agente "FCA Specialist" (.claude/agents/fca-specialist.md): por cada KR del mes, meta (Budget),
real (Run Rate / Actuals del OKR, con su Estado), brecha nominal y %, y si está desviado (|brecha| >= umbral). Para
los desviados agrega lo que el agente necesita para buscar la causa con datos (nada inventado):
  - apertura por país del mismo KR (los KRs contables del OKR H2 vienen por país);
  - en los KRs de NR / OC: el P&L contable del mes (baseline vs budget) del mismo negocio, abierto por línea (P&L N2),
    país y producto;
  - el acumulado H2 hasta el mes, y los demás KRs del mismo LoB (contexto).
Montos en USD nominales y, para los KRs monetarios, también organic (OKR_H2_FY27_Organic.json, a TC Budget).

Uso:
    python FCA/fca_builder.py [--mes 2026-10] [--umbral 5]
Salida: <OneDrive B2B & WLs>/FCA/fca_input_<mes>.json y FCA/_out/fca_input_<mes>.json (local, no versionado).
Sin --mes: el primer mes de H2 sin cierre contable (el que se está cerrando); si no hay, el último cerrado.
"""
import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "Inputs_Planning_PnL"))
import pnl_common                      # noqa: E402
import okr_builder                     # noqa: E402  (_download_json, ids de los canónicos)
import okr_h2_builder as h2b           # noqa: E402  (OKR_MONETARY_KRS)

OKR_H2_ID = "1lsMF9_d1t55boO8Wr8vziMsFT9LQioov"            # OKR_H2_FY27.json
OKR_H2_ORG_ID = "1CJBtvDb3O2zOIq6fdq_5NuHLoOupiwjc"        # OKR_H2_FY27_Organic.json
RR, BUD = "Run Rate/Actuals", "Budget"
H2_MONTHS = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]

# KR -> filtro del P&L contable para abrir la causa (lob, canal, producto, nivel: N3 'net revenue' | N5 'operating contribution')
PNL_MAP = {
    "op. contribution":            ("b2b2c", None, None, "oc"),
    "net revenues b2b":            ("b2b", None, None, "nr"),
    "operating contribution api":  ("b2b", "may", None, "oc"),
    "operating contribution html": ("b2b", "min", None, "oc"),
    "net revenues api hoteles":    ("b2b", "may", "hotels", "nr"),
    "new account net revenues":    ("b2b2c", None, None, "nr"),
    "existing account net revenues": ("b2b2c", None, None, "nr"),
    "new product growth":          ("b2b", None, None, "nr"),
}


def unit_of(kr):
    k = kr.lower()
    if k.startswith("%") or "price competitiveness" in k:
        return "pct"
    return "usd" if k in h2b.OKR_MONETARY_KRS else "count"


def load(svc, fid, label):
    return okr_builder._download_json(svc, fid, label)


def okr_index(okr):
    """{(lob, kr): {'rr': {ym: {pais: v}}, 'bud': {...}, 'estado': {ym: est}}}"""
    out = defaultdict(lambda: {"rr": defaultdict(dict), "bud": defaultdict(dict), "estado": {}})
    for f, esc, lob, pais, _prod, kr, v, est in okr["rows"]:
        ym = str(f)[:7]
        e = out[(lob, kr)]
        side = "rr" if esc == RR else "bud" if esc == BUD else None
        if not side:
            continue
        e[side][ym][str(pais)] = e[side][ym].get(str(pais), 0.0) + float(v or 0)
        if side == "rr" and est:
            e["estado"][ym] = est
    return out


def total(by_pais):
    """Total del KR: la fila 'Total' si existe (KRs manuales y %), si no la suma por país."""
    if not by_pais:
        return None
    if "Total" in by_pais:
        return by_pais["Total"]
    return sum(by_pais.values())


def gap(real, meta, unit):
    if real is None or meta is None:
        return None
    g = {"abs": real - meta}
    if unit == "pct":
        g["pp"] = real - meta
    g["pct"] = (real - meta) / abs(meta) * 100 if meta else None
    return g


def pnl_breakdown(base, bud, ym, lob, canal, prod, nivel, top=8):
    """Baseline vs budget del mes para el negocio del KR: por línea (N2), país y producto."""
    def rows(canon):
        c = canon["cols"]
        ix = {k: c.index(k) for k in ("LoB", "Canal", "Pais", "Producto", "P&L N2", "P&L N3", "P&L N5", "Fecha", "Monto USD")}
        for r in canon["rows"]:
            if str(r[ix["Fecha"]])[:7] != ym or str(r[ix["LoB"]]).lower() != lob:
                continue
            if canal and str(r[ix["Canal"]]).lower() != canal:
                continue
            if prod and str(r[ix["Producto"]]).lower() != prod:
                continue
            if nivel == "nr" and str(r[ix["P&L N3"]]).lower() != "net revenue":
                continue
            if nivel == "oc" and str(r[ix["P&L N5"]]).lower() != "operating contribution":
                continue
            yield {k: (float(r[i] or 0) if k == "Monto USD" else str(r[i]).lower()) for k, i in ix.items()}

    agg = {d: defaultdict(lambda: [0.0, 0.0]) for d in ("linea", "pais", "producto")}
    tot = [0.0, 0.0]
    for side, canon in ((0, base), (1, bud)):
        for r in rows(canon):
            v = r["Monto USD"]
            tot[side] += v
            agg["linea"][r["P&L N2"]][side] += v
            agg["pais"][r["Pais"]][side] += v
            agg["producto"][r["Producto"]][side] += v
    out = {"real": round(tot[0], 2), "meta": round(tot[1], 2), "brecha": round(tot[0] - tot[1], 2)}
    for d, m in agg.items():
        items = [{"k": k, "real": round(v[0], 2), "meta": round(v[1], 2), "brecha": round(v[0] - v[1], 2)} for k, v in m.items()]
        items = [x for x in items if abs(x["brecha"]) >= 1]
        items.sort(key=lambda x: x["brecha"])
        out[d] = items[:top] + [x for x in items[-top:] if x not in items[:top]]   # los que más restan y los que más suman
    return out


def build(mes, umbral):
    svc = pnl_common.get_drive_service()
    okr = load(svc, OKR_H2_ID, "OKR_H2_FY27.json")
    org = load(svc, OKR_H2_ORG_ID, "OKR_H2_FY27_Organic.json")
    meta = okr.get("meta", {})
    cierre = str(meta.get("cierre_contable_hasta", ""))[:7]
    if not mes:
        mes = next((m for m in H2_MONTHS if m > cierre), H2_MONTHS[-1])
    cerrado = bool(cierre) and mes <= cierre
    idx, idx_org = okr_index(okr), okr_index(org)
    base = bud = None

    items = []
    for (lob, kr), e in sorted(idx.items()):
        u = unit_of(kr)
        r_p, b_p = e["rr"].get(mes, {}), e["bud"].get(mes, {})
        real, meta_v = total(r_p), total(b_p)
        if real is None and meta_v is None:
            continue
        g = gap(real, meta_v, u)
        h2m = [m for m in H2_MONTHS if m <= mes]
        acc_r = sum(total(e["rr"].get(m, {})) or 0 for m in h2m) if u != "pct" else None
        acc_b = sum(total(e["bud"].get(m, {})) or 0 for m in h2m) if u != "pct" else None
        it = {
            "lob": lob, "kr": kr, "unidad": u, "estado": e["estado"].get(mes) or ("Actual" if cerrado else "Proyeccion"),
            "meta": None if meta_v is None else round(meta_v, 4 if u == "pct" else 2),
            "real": None if real is None else round(real, 4 if u == "pct" else 2),
            "brecha": g,
            "h2_acumulado": None if acc_r is None else {"meses": h2m, "real": round(acc_r, 2), "meta": round(acc_b, 2),
                                                        "brecha_pct": (acc_r - acc_b) / abs(acc_b) * 100 if acc_b else None},
        }
        if u == "usd":
            eo = idx_org.get((lob, kr))
            if eo:
                ro = total(eo["rr"].get(mes, {}))
                it["organic"] = {"real": None if ro is None else round(ro, 2), "brecha": gap(ro, meta_v, u)}
        p = g and (g.get("pct") if u != "pct" else (g["pp"] / abs(meta_v) * 100 if meta_v else None))
        it["desviado"] = bool(p is not None and abs(p) >= umbral)
        it["sentido"] = None if p is None else ("por debajo de la meta" if p < 0 else "por arriba de la meta")
        NOTAS = {"MTD": "Real a la fecha (MTD) contra la meta del mes completo: parte de la brecha son los días que faltan del mes.",
                 "Rolling30": "Real de los últimos 30 días (móvil), no el mes calendario.",
                 "MesMovil": "Real de los últimos N días (N = días del mes) hasta ayer: comparable con la meta mensual.",
                 "Manual": "Valor cargado a mano (Input_OKR / tracker): validar que esté actualizado antes de la mesa.",
                 "Proyeccion": "Run Rate (proyección), sin cierre contable."}
        if it["estado"] in NOTAS:
            it["nota_estado"] = NOTAS[it["estado"]]
        if it["desviado"]:
            paises = sorted(({"pais": k, "real": round(r_p.get(k, 0), 2), "meta": round(b_p.get(k, 0), 2),
                              "brecha": round(r_p.get(k, 0) - b_p.get(k, 0), 2)}
                             for k in set(r_p) | set(b_p) if k != "Total"), key=lambda x: x["brecha"])
            if paises:
                it["por_pais"] = paises
            fm = PNL_MAP.get(kr.lower())
            if fm:
                if base is None:
                    base = load(svc, okr_builder.BASELINE_FILE_ID, "baseline_actuals+projections.json")
                    bud = load(svc, okr_builder.BUDGET_FILE_ID, "budget.json")
                it["pnl_contable"] = dict(pnl_breakdown(base, bud, mes, *fm), filtro={"lob": fm[0], "canal": fm[1], "producto": fm[2], "nivel": fm[3]})
        items.append(it)

    for it in items:   # contexto: los otros KRs del mismo LoB
        it["otros_krs_lob"] = [{"kr": o["kr"], "brecha_pct": (o["brecha"] or {}).get("pct"), "desviado": o["desviado"]}
                               for o in items if o["lob"] == it["lob"] and o is not it]
    return {
        "meta": {"concepto": "fca_input", "mes": mes, "umbral_pct": umbral, "generado": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                 "cierre_contable_hasta": cierre, "cerrado": cerrado,
                 "nota": "Provisional: el mes no tiene cierre contable; los KRs contables son Run Rate" if not cerrado else "Mes con cierre contable",
                 "fuentes": ["OKR_H2_FY27.json", "OKR_H2_FY27_Organic.json", "baseline_actuals+projections.json", "budget.json"]},
        "krs": items,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mes", default=None)
    ap.add_argument("--umbral", type=float, default=5.0)
    a = ap.parse_args()
    data = build(a.mes, a.umbral)
    mes = data["meta"]["mes"]
    txt = json.dumps(data, ensure_ascii=False, indent=1)
    outs = [Path(__file__).resolve().parent / "_out" / f"fca_input_{mes}.json",
            Path(pnl_common.get_base_dir()) / "FCA" / f"fca_input_{mes}.json"]
    for p in outs:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(txt, encoding="utf-8")
    dev = [k for k in data["krs"] if k["desviado"]]
    print(f"FCA input {mes} ({data['meta']['nota']}): {len(data['krs'])} KRs, {len(dev)} desviados (umbral ±{a.umbral:g}%)")
    for k in dev:
        b = k["brecha"] or {}
        print(f"  - {k['lob']:9} {k['kr'][:45]:45} brecha {b.get('pct') if b.get('pct') is None else round(b['pct'], 1)}%  [{k['estado']}]")
    for p in outs:
        print("  ->", p)


if __name__ == "__main__":
    main()
