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


# ── Refresco fuera del sync del Daily ──────────────────────────────────────────────────────────────
# flow_oc se arma en daily_sync.py; si el baseline / RunRate / Budget / Actuals cambian entre dos syncs,
# la portada OC del Flow (y la slide 5 de "Slides mensuales") quedaba con el OC viejo (2026-10-29: Other
# Taxes del RunRate nuevo, 18,53 vs 17,87M de OC H2 B2B2C). Lo llaman baseline_builder.py y json_builder.py
# después de subir: reemplaza SOLO "flow_oc" en daily_b2b2c_data.json (el resto queda igual) y lo publica en
# Drive + Ownia. No crítico: si falla, avisa y el próximo daily_sync lo corrige.
DAILY_B2B2C_FILE_ID = "1Ukcx4e-dwCZ2VqesWwVN_1Jnt6r2AZdX"   # daily_b2b2c_data.json
_DAILY_MAX_BYTES = 48_000_000                              # getBlob() de Apps Script corta en 50 MB


def refresh_in_daily_json(svc) -> None:
    """svc = servicio de Drive con permiso de lectura de los canónicos y escritura del JSON del Daily."""
    import io
    import json
    import sys
    from pathlib import Path
    try:
        from googleapiclient.http import MediaInMemoryUpload, MediaIoBaseDownload

        def dl(fid):
            buf = io.BytesIO()
            d = MediaIoBaseDownload(buf, svc.files().get_media(fileId=fid), chunksize=16 * 1024 * 1024)
            done = False
            while not done:
                _, done = d.next_chunk()
            return buf.getvalue()

        raw = dl(DAILY_B2B2C_FILE_ID)
        data = json.loads(raw)
        new_oc = build_flow_oc(lambda k: json.loads(dl(CANONICAL_OC_IDS[k])))
        if new_oc == data.get("flow_oc"):
            print("  [flow_oc] daily_b2b2c_data.json ya tenia el OC al dia")
            return
        data["flow_oc"] = new_oc
        txt = json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
        if len(txt) > _DAILY_MAX_BYTES or len(txt) < len(raw) * 0.9:
            print(f"  WARN [flow_oc] no se sube: {len(txt)/1e6:.1f} MB contra {len(raw)/1e6:.1f} MB del archivo actual")
            return
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Ownia_B2B_Ecosystem" / "mirror"))
        from ownia_publish import DRIVE_FIELDS, publish_after_drive   # doble escritura Drive + Ownia
        res = svc.files().update(fileId=DAILY_B2B2C_FILE_ID, media_body=MediaInMemoryUpload(txt, mimetype="application/json", resumable=True),
                                 fields=DRIVE_FIELDS).execute()
        print("  [flow_oc] OC B2B2C actualizado en daily_b2b2c_data.json")
        publish_after_drive(res, txt)
    except Exception as e:
        print(f"  WARN [flow_oc] no se pudo actualizar el OC del Daily ({e}); lo corrige el proximo daily_sync.py")
