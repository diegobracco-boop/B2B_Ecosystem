"""
baseline_builder.py — Construye/actualiza baseline_actuals+projections.json en Drive.

QUÉ ES el archivo:
  Un JSON canónico (mismo formato {meta,cols,rows} que los demás) con la línea de tiempo
  del FY27 (Abr-2026 → Mar-2027) armada por concatenación de cortes mensuales:
      Abr..(mes de corte)  -> ACTUALS   (meses cerrados)
      (corte+1)..Sep       -> RUN RATE
      Oct..Mar             -> FORECAST
  (concepto="baseline"). NO lo genera json_builder.py; se arma acá.
  Drive folder: 1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV ; fileId 1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv.

DOS MODOS:
  --promote-month YYYY-MM-01   (flujo mensual recomendado)
      Toma el baseline actual en Drive y REEMPLAZA solo el bloque de ese mes por los
      ACTUALS de ese mes (generados desde el Excel de actuals). El resto queda idéntico.
      Es el flujo mensual: cuando cierra un mes, se promueve de run-rate a actual.
  --rebuild
      Reconstruye entero: actuals[Abr..corte] + runrate[corte+1..Sep] + forecast[Oct..Mar],
      restateando meses cerrados con la fuente actual. Cambia números ya publicados.

FUENTES:
  - ACTUALS: se generan con plana_actuals_builder (misma homologación/exclusiones/Reverso AxI
    que Abr-Jun) a partir del Excel '00 - Actuals 2026 - Plana Python*.xlsx'.
    Por default usa el que lee el pipeline (BITUBIA). Con --actuals-xlsx <ruta> se puede
    apuntar a otro (ej. el 'V2' en Planning-PBI\\Actuals que trae el mes recién cerrado).
  - RUNRATE / FORECAST: se toman de los JSON canónicos ya publicados en Drive (runrate.json,
    forecast.json). No se regeneran acá (usar run_all.bat si hay que actualizarlos).

USO:
    python baseline_builder.py --promote-month 2026-07-01 \
        --actuals-xlsx "<...>\\Planning-PBI - Inputs Power Bi\\Actuals\\00 - Actuals 2026 - Plana Python - V2.xlsx"
    (agregar --no-upload para solo generar local en ./_baseline_out/)

Requisitos de auth: token_drive.json + credentials_drive.json (scope drive completo).
"""
import os
import sys
import io
import json
import shutil
import argparse
import tempfile
from collections import defaultdict

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import config
import pandas as pd
import pnl_common
import plana_projections_builder as P
import plana_actuals_builder as A

DIR             = os.path.dirname(os.path.abspath(__file__))
DRIVE_FOLDER_ID = config.DRIVE_FOLDER_ID
BASELINE_NAME   = "baseline_actuals+projections.json"

COLS_OUT = ["LoB", "Canal", "Pais", "Producto",
            "P&L N1", "P&L N2", "P&L N3", "P&L N4", "P&L N5", "P&L N6", "P&L Managerial View",
            "Fecha", "Monto USD"]
GROUP = COLS_OUT[:-1]

# Composición del FY por concepto (mes -> fuente), usada en --rebuild.
RUNRATE_MONTHS  = config.RUNRATE_MONTHS
FORECAST_MONTHS = config.FORECAST_MONTHS


def _svc():
    return pnl_common.get_drive_service()


def _find(svc, name):
    q = f"name='{name}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false"
    r = svc.files().list(q=q, fields="files(id,name,size)").execute().get("files", [])
    return r[0] if r else None


def _download_json(svc, name):
    from googleapiclient.http import MediaIoBaseDownload
    f = _find(svc, name)
    if not f:
        sys.exit(f"No encontré {name} en Drive.")
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, svc.files().get_media(fileId=f["id"]), chunksize=8 * 1024 * 1024)
    done = False
    while not done:
        _, done = dl.next_chunk()
    buf.seek(0)
    return f["id"], json.load(buf)


def build_actuals_json(actuals_xlsx=None, fy=2027):
    """Corre plana_actuals_builder y canonicaliza igual que json_builder -> payload actuals."""
    bitubia_dir = None
    if actuals_xlsx:
        # copiar al nombre esperado para que read_actuals_file lo encuentre
        tmp = tempfile.mkdtemp(prefix="actuals_src_")
        dst = os.path.join(tmp, f"00 - Actuals {fy-1} - Plana Python.xlsx")
        shutil.copy(actuals_xlsx, dst)
        bitubia_dir = tmp
        print(f"  actuals source override: {actuals_xlsx}")
    try:
        plana = A.build(fy, bitubia_dir=bitubia_dir)    # SIN PPA (suma Reverso AxI)
    finally:
        if bitubia_dir:
            shutil.rmtree(bitubia_dir, ignore_errors=True)
    # limpiar el CSV que build() deja en el repo
    yy = str(fy)[-2:]
    csv = os.path.join(DIR, f"actuals_fy{yy}_abr{fy-1}_mar{fy}.csv")
    if os.path.exists(csv):
        try: os.remove(csv)
        except Exception: pass
    df = plana.copy()
    df["Canal"] = df["Canal"].where(df["LoB"].astype(str).str.lower() == "b2b", "total")
    df["Monto USD"] = pd.to_numeric(df["Monto USD"], errors="coerce").fillna(0).round(2)
    df = df.groupby(GROUP, as_index=False, dropna=False)["Monto USD"].sum()
    df = df[df["Monto USD"] != 0][COLS_OUT]
    return {"meta": {"concepto": "actuals", "filas": len(df),
                     "fechas": sorted(df["Fecha"].astype(str).unique())},
            "cols": COLS_OUT, "rows": df.values.tolist()}


def _per_fecha(rows, fi, mi):
    t = defaultdict(float); n = defaultdict(int)
    for r in rows:
        t[r[fi]] += r[mi]; n[r[fi]] += 1
    return t, n


def promote_month(month, actuals_xlsx, upload):
    svc = _svc()
    fid, old = _download_json(svc, BASELINE_NAME)
    cols = old["cols"]; FI = cols.index("Fecha"); MI = cols.index("Monto USD")
    act = build_actuals_json(actuals_xlsx)
    assert act["cols"] == cols, "cols del actuals != baseline"
    new_month_rows = [r for r in act["rows"] if r[FI] == month]
    if not new_month_rows:
        sys.exit(f"El actuals generado no tiene filas para {month}.")
    kept = [r for r in old["rows"] if r[FI] != month]
    new_rows = kept + new_month_rows

    ot, on = _per_fecha(old["rows"], FI, MI)
    nt, nn = _per_fecha(new_rows, FI, MI)
    print("\n=== PER-FECHA OLD -> NEW ===")
    for k in sorted(set(ot) | set(nt)):
        chg = "" if (k != month and abs(nt[k]-ot[k]) < 0.005 and nn[k] == on[k]) else "  <== cambia"
        print(f"  {k}: OLD n={on[k]:>5} sum={ot[k]:,.2f} | NEW n={nn[k]:>5} sum={nt[k]:,.2f}{chg}")

    payload = {"meta": {"concepto": old["meta"].get("concepto", "baseline"),
                        "filas": len(new_rows),
                        "fechas": sorted({r[FI] for r in new_rows})},
               "cols": cols, "rows": new_rows}
    _emit(svc, fid, payload, upload)


def _check_month_config_(rr, fc):
    """RUNRATE_MONTHS/FORECAST_MONTHS (config.py) son un set de meses A MANO que
    decide qué fuente usa cada mes del baseline en --rebuild. Si la composición
    real cambia (runrate.json empieza/termina en otro lado) y nadie actualiza
    config.py, el mes queda con 0 filas en el baseline SIN NINGÚN aviso — mismo
    patrón silencioso que ya rompió 3 veces en este pipeline (diciembre perdido
    del parser EPM, 'Last Year' siempre en cero, la reversión del clasp pull).
    No frena --rebuild (FORECAST_MONTHS=set() hoy es una decisión de negocio a
    propósito), pero avisa fuerte para que no pase desapercibido."""
    def _months_in(payload):
        fi = payload["cols"].index("Fecha")
        return {r[fi] for r in payload["rows"]}

    rr_real, fc_real = _months_in(rr), _months_in(fc)
    any_warn = False
    for name, configured, real, fname in [
        ("RUNRATE_MONTHS",  RUNRATE_MONTHS,  rr_real, "runrate.json"),
        ("FORECAST_MONTHS", FORECAST_MONTHS, fc_real, "forecast.json"),
    ]:
        missing = sorted(configured - real)  # config dice usar el mes, pero el archivo no lo tiene
        extra   = sorted(real - configured)  # el archivo cubre meses que el config no usa
        if missing:
            any_warn = True
            print(f"  [WARN CONFIG] {name} incluye {missing} pero {fname} no tiene esos "
                  f"meses -> quedarian con 0 filas en el baseline.")
        if extra:
            any_warn = True
            print(f"  [WARN CONFIG] {fname} tiene datos para {extra} que {name} NO usa "
                  f"-> revisar si config.py quedo desactualizado.")
    if not any_warn:
        print("  [OK] RUNRATE_MONTHS/FORECAST_MONTHS coinciden con runrate.json/forecast.json.")
    return any_warn


def rebuild(actuals_xlsx, upload):
    svc = _svc()
    fid, old = _download_json(svc, BASELINE_NAME)
    cols = old["cols"]; FI = cols.index("Fecha")
    act = build_actuals_json(actuals_xlsx)
    _, rr = _download_json(svc, "runrate.json")
    _, fc = _download_json(svc, "forecast.json")
    _check_month_config_(rr, fc)
    act_months = set(act["meta"]["fechas"])  # meses cerrados disponibles
    rows = [r for r in act["rows"] if r[FI] in act_months]
    rows += [r for r in rr["rows"] if r[FI] in RUNRATE_MONTHS]
    rows += [r for r in fc["rows"] if r[FI] in FORECAST_MONTHS]
    payload = {"meta": {"concepto": old["meta"].get("concepto", "baseline"),
                        "filas": len(rows),
                        "fechas": sorted({r[FI] for r in rows})},
               "cols": cols, "rows": rows}
    print("rebuild fechas:", payload["meta"]["fechas"], "filas:", len(rows))
    _emit(svc, fid, payload, upload)


def _emit(svc, fid, payload, upload):
    outdir = os.path.join(DIR, "_baseline_out")
    os.makedirs(outdir, exist_ok=True)
    local = os.path.join(outdir, BASELINE_NAME)
    with open(local, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"), default=str)
    print(f"\nlocal -> {local} ({os.path.getsize(local)/1e6:.2f} MB, {payload['meta']['filas']:,} filas)")
    if upload:
        from googleapiclient.http import MediaFileUpload
        media = MediaFileUpload(local, mimetype="application/json", resumable=True)
        res = svc.files().update(fileId=fid, media_body=media,
                                 fields="id,size,modifiedTime").execute()
        print(f"[Drive] actualizado {BASELINE_NAME}: {res}")
    else:
        print("(--no-upload: no se subió a Drive)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--promote-month", metavar="YYYY-MM-01")
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--actuals-xlsx")
    ap.add_argument("--no-upload", action="store_true")
    a = ap.parse_args()
    up = not a.no_upload
    if a.rebuild:
        rebuild(a.actuals_xlsx, up)
    elif a.promote_month:
        promote_month(a.promote_month, a.actuals_xlsx, up)
    else:
        sys.exit("Uso: --promote-month 2026-07-01 [--actuals-xlsx <ruta>] [--no-upload]  |  --rebuild [...]")
