"""
partners_api_dict_extract.py
Arma el diccionario chico de partners API (Diccionario_partners_api.xlsx) a partir del Excel grande de agencias
(OKR/Agencias AAAA.MM.DD.xlsx), para que el KR "Accelerate Hunting Partners API" (partners_api_sync.py) ya no dependa de ese
Excel de 20 MB. Se corre una vez; despues el equipo mantiene el archivo chico a mano.

Hojas del archivo que genera (en OKR/ de OneDrive):
  Partners : partner_code | nombre_final | tipo | estado   <- agrupa los codigos de una misma empresa (Hotelbeds = 10 codigos)
             Fuente: hoja "Agencias LUV" (type = API); completa con la hoja "Agencias" los codigos de canales hoteldo-api* que falten.
  Paises   : partner_code | pais                          <- partners cuyo pais se fuerza (hoja "Diccionario" del Excel: Paraguay)
  Leeme    : como mantenerlo

Uso:
    python partners_api_dict_extract.py "<ruta a Agencias AAAA.MM.DD.xlsx>" [--out "<ruta del xlsx a crear>"]
Falla si el archivo de salida ya existe (para no pisar lo que el equipo editó); --force lo pisa.
"""
import argparse
import os
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Inputs_Planning_PnL"))
import pnl_common  # noqa: E402

DEFAULT_OUT = os.path.join(pnl_common.get_base_dir(), "OKR", "Diccionario_partners_api.xlsx")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("excel", help="Agencias AAAA.MM.DD.xlsx (con las hojas 'Agencias LUV', 'Agencias' y 'Diccionario')")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if os.path.exists(a.out) and not a.force:
        sys.exit(f"ERROR: {a.out} ya existe (usar --force para pisarlo)")

    luv = pd.read_excel(a.excel, sheet_name="Agencias LUV", engine="openpyxl")
    ag = pd.read_excel(a.excel, sheet_name="Agencias", engine="openpyxl")
    pais = pd.read_excel(a.excel, sheet_name="Diccionario", engine="openpyxl", header=None, names=["partner_code", "pais"])

    p = luv[luv["type"] == "API"][["partner_code", "Nombre final OK", "status"]].rename(
        columns={"Nombre final OK": "nombre_final", "status": "estado"})
    p["tipo"] = "API"
    p = p.dropna(subset=["partner_code", "nombre_final"]).drop_duplicates("partner_code")
    # codigos que operan por el canal API segun la consulta del Excel pero estan registrados con otro tipo (p. ej. AGENCY): se toman de LUV
    # (cualquier tipo) y de la hoja "Agencias"; asi un mismo partner con varios codigos queda agrupado igual que en el Excel
    try:
        rc = pd.read_excel(a.excel, sheet_name="Resultado consulta", engine="openpyxl", usecols=["parent_channel", "agency_code"])
        cods_api = set(rc.loc[rc["parent_channel"] == "API", "agency_code"].astype(str))
    except Exception:
        cods_api = set()
    falta = cods_api - set(p["partner_code"])
    ex_luv = luv[luv["partner_code"].isin(falta)][["partner_code", "Nombre final OK", "status", "type"]].rename(
        columns={"Nombre final OK": "nombre_final", "status": "estado", "type": "tipo"}).dropna(subset=["nombre_final"]).drop_duplicates("partner_code")
    falta2 = falta - set(ex_luv["partner_code"])
    ex_ag = ag[ag["partner_code"].isin(falta2) | (ag["channel_name"].astype(str).str.contains("api", case=False, na=False) & ~ag["partner_code"].isin(set(p["partner_code"]) | set(ex_luv["partner_code"])))]
    ex_ag = ex_ag[["partner_code", "NOMBRE FINAL OK"]].rename(columns={"NOMBRE FINAL OK": "nombre_final"}).dropna().drop_duplicates("partner_code")
    ex_ag["estado"], ex_ag["tipo"] = "", "API (agencias)"
    p = pd.concat([p, ex_luv[p.columns], ex_ag[p.columns]], ignore_index=True).drop_duplicates("partner_code")
    p = p.sort_values(["nombre_final", "partner_code"]).reset_index(drop=True)
    pais = pais.dropna().drop_duplicates("partner_code")
    leeme = pd.DataFrame({"Como mantenerlo": [
        "Un partner API nuevo no necesita estar en este archivo: si no aparece se cuenta como un partner propio (con su codigo como nombre) y el script avisa.",
        "Para que dos codigos cuenten como UNA sola empresa, ponerles el mismo nombre_final en la hoja Partners.",
        "La hoja Paises fuerza el pais de un partner (la query manda a 'Globales' los paises que no son AR/BR/CL/CO/EC/MX/PE/UY).",
        "Lo lee partners_api_sync.py (se corre solo desde daily_sync.py). Cambios en este archivo valen para los proximos meses que se congelen; los meses ya congelados no se recalculan.",
    ]})
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with pd.ExcelWriter(a.out, engine="openpyxl") as w:
        p.to_excel(w, sheet_name="Partners", index=False)
        pais.to_excel(w, sheet_name="Paises", index=False)
        leeme.to_excel(w, sheet_name="Leeme", index=False)
    print(f"OK {a.out}: {len(p):,} partners ({p['nombre_final'].nunique():,} nombres) · {len(pais)} paises forzados")


if __name__ == "__main__":
    main()
