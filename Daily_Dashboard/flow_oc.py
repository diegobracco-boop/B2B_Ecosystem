"""
flow_oc.py — Operating Contribution (OC) B2B2C mensual para la slide "B2B2C Monthly Performance — OC"
del Flow Semanal (dashboard.html, kind 'cover_oc').

El OC no existe en las fuentes del Daily (Datalake: actuals / raw.b2brr_gd / raw.b2b_budget_gd
llegan hasta FVM; el OC resta marketing y otros costos que esas tablas no traen). Sale del P&L
CONTABLE: los JSON canónicos de Inputs_Planning_PnL (mismo input que P&L_Accounting y que el KR
"B2B2C Op. Contribution" de okr_builder.py): LoB = b2b2c y P&L N5 = 'operating contribution'.

  ac = actuals.json                       -> qué meses están cerrados (meta.fechas)
  bl = baseline_actuals+projections.json  -> actuals cerrados + Run Rate contable del resto
  bg = budget.json · rr = runrate.json · ly = actuals_previos_fy26.json (LY)

Se publica dentro de daily_b2b2c_data.json como "flow_oc" (chico: mes x escenario x país).
"""

# IDs en Drive (carpeta 1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV) — los mismos que CANONICAL_IDS_ de
# P&L_Accounting/Codigo_contable.js. Si cambian allá, cambiarlos acá.
CANONICAL_OC_IDS = {
    "ac": "1PABNf4XVKdj6eXApr5_yP581ZsD_N9e-",   # actuals.json
    "bl": "1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv",   # baseline_actuals+projections.json
    "bg": "1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW",   # budget.json
    "rr": "1UGg60kE397nsGAivtFqI8NX5CVFj1gqO",   # runrate.json
    "ly": "1zd5gnMFztKiCSgeY-VmsfVOr0LQ6ftGI",   # actuals_previos_fy26.json
}

# País del contable (minúscula) -> nombre del Daily (getRegion_ de dashboard.html: Brasil -> BR,
# Mexico/USA -> NAM, el resto -> SAH). Globales/others/koin van a 'Other Countries', como en el Daily.
_PAIS = {
    "argentina": "Argentina", "brasil": "Brasil", "chile": "Chile", "colombia": "Colombia",
    "ecuador": "Ecuador", "mexico": "Mexico", "peru": "Peru", "usa": "USA", "rg": "RG",
}


def _pais(p) -> str:
    return _PAIS.get(str(p).strip().lower(), "Other Countries")


def oc_rows(canon: dict, escenario: str) -> dict:
    """{(fecha 'YYYY-MM-01', pais): OC} de un JSON canónico, solo B2B2C / N5 operating contribution."""
    cols = canon["cols"]
    iL, iN5, iP, iF, iM = (cols.index(c) for c in ("LoB", "P&L N5", "Pais", "Fecha", "Monto USD"))
    out = {}
    for r in canon["rows"]:
        if str(r[iL]).lower() != "b2b2c" or str(r[iN5]).lower() != "operating contribution":
            continue
        k = (str(r[iF])[:7] + "-01", _pais(r[iP]))
        out[k] = out.get(k, 0.0) + float(r[iM] or 0)
    return out


def build_flow_oc(load) -> dict:
    """load(clave) -> JSON canónico (dict). Devuelve el bloque flow_oc:
    {cols, rows: [fecha, escenario, pais, oc], actual_months: ['YYYY-MM', ...]}."""
    actual_months = sorted({f[:7] for f in (load("ac").get("meta") or {}).get("fechas", [])})
    rows = []
    for esc in ("bl", "bg", "rr", "ly"):
        for (fecha, pais), v in sorted(oc_rows(load(esc), esc).items()):
            rows.append([fecha, esc, pais, round(v, 2)])
    return {"cols": ["fecha", "escenario", "pais", "oc"], "rows": rows, "actual_months": actual_months}
