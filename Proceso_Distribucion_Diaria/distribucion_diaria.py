"""
distribucion_diaria.py
======================
Distribuye a nivel DIARIO las proyecciones mensuales del Run Rate de B2B2C (WLs) y
B2B (API = B2B-MAY, HTML = B2B-MIN), usando los factores de estacionalidad diaria.

La salida es el CSV que se carga (a mano) en raw.b2brr_gd / raw.b2brr_ri. De ahí lo leen
Daily_Dashboard/daily_sync.py (Run Rate del Daily) y P&L_Managerial.

Reemplaza a los notebooks "Diario FINAL GD.ipynb" / "Diario FINAL RI.ipynb" (legacy/).
Diferencias con los notebooks (ver CONTEXT.md):
  - Un solo script para GD y RI (--base).
  - Rutas resueltas por usuario (sin rutas personales hardcodeadas) y semana auto-detectada.
  - Normaliza los nombres de columna del modelo (media_other_revenue, efecto_financiero,
    currency_hedge/curency_hedge) → antes se perdían y NR/FVM salían subestimados.
  - Controles BLOQUEANTES: si algo no concilia, no se guarda nada.

Uso:
  python distribucion_diaria.py --base GD
  python distribucion_diaria.py --base RI --semana "2026.09.14 - W37"
  python distribucion_diaria.py --base GD --dry-run        # corre y controla, no guarda
"""

import argparse
import glob
import hashlib
import os
import pickle
import sys
import warnings
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# ==============================================================================
# 1) CONFIGURACIÓN
# ==============================================================================

AÑO_FISCAL = "2026-27"
AQUI = Path(__file__).resolve().parent
CACHE_DIR = AQUI / ".cache"

# Raíz "B2B & WLs" de la biblioteca "Control de Gestión" en OneDrive. Cada persona la tiene
# sincronizada en un lugar distinto; se prueba en orden. Override: --raiz o env B2B_WLS_DIR.
def _candidatas_raiz():
    home = Path.home()
    return [
        home / "OneDrive - despegar365" / f"Control de Gestión - {AÑO_FISCAL}" / "B2B & WLs",
        home / "despegar365" / "Control de Gestión - Documentos" / "Planeamiento" / AÑO_FISCAL / "B2B & WLs",
        home / "OneDrive - despegar365" / "Control de Gestión - Documentos" / "Planeamiento" / AÑO_FISCAL / "B2B & WLs",
    ]

# Negocio → modelo de Run Rate, hojas y factores. B2B2C tiene un único criterio de
# reconocimiento: usa la misma hoja (mes_ri) y el mismo factor (GD - WLs) en GD y en RI.
NEGOCIOS = {
    "B2B2C": {
        "modelo": "WLs - Modelo Run Rate*.xlsx",
        "hoja":   {"GD": "P&L", "RI": "P&L"},
        "mes":    {"GD": ["mes_ri"], "RI": ["mes_ri"]},
        "factor": {"GD": ("Factor diario GD - WLs.xlsx", "Factores B2B2C"),
                   "RI": ("Factor diario GD - WLs.xlsx", "Factores B2B2C")},
        "por_partner": True,
        # Reales → filas de la proyección: se busca del nivel más fino al más grueso. Lo que no
        # matchea (ej. partner nuevo) queda como fila propia con escenario 'Real'.
        "niveles_reales": [["pais", "viaje", "partner_n", "producto"], ["pais", "viaje", "partner_n"]],
        "lob_huerfano": "B2B2C-ON",
    },
    "B2B-MAY": {
        "modelo": "API - Modelo Run Rate*.xlsx",
        "hoja":   {"GD": "P&L Emision", "RI": "P&L RI"},
        "mes":    {"GD": ["mes_venta"], "RI": ["mes_ri"]},
        "factor": {"GD": ("Factor diario GD - B2B.xlsx", "Factores B2B-MAY"),
                   "RI": ("Factor diario RI - B2B.xlsx", "Factores B2B-MAY")},
        "por_partner": False,
        "niveles_reales": [["lob_canal", "pais", "viaje", "producto"], ["lob_canal", "pais", "viaje"],
                           ["lob_canal", "pais"]],
    },
    "B2B-MIN": {
        "modelo": "HTML - Modelo Run Rate*.xlsx",
        "hoja":   {"GD": "P&L Emision", "RI": "P&L RI"},
        "mes":    {"GD": ["mes_venta"], "RI": ["mes_ri"]},
        # HTML todavía no tiene desfase GD/RI en el modelo: en RI usa el factor GD
        # (el archivo RI no tiene hoja B2B-MIN). Cambia cuando se modifique el modelo.
        "factor": {"GD": ("Factor diario GD - B2B.xlsx", "Factores B2B-MIN"),
                   "RI": ("Factor diario GD - B2B.xlsx", "Factores B2B-MIN")},
        "por_partner": False,
        "niveles_reales": [["lob_canal", "pais", "viaje", "producto"], ["lob_canal", "pais", "viaje"],
                           ["lob_canal", "pais"]],
    },
}

# Paraguay y Uruguay usan los factores de 'Other Countries' (y salen etiquetados así).
DISCLAIMER_PAIS = {"Paraguay": "Other Countries", "Uruguay": "Other Countries"}
MAPEO_LOB_CANAL = {"API": "B2B-MAY", "HTML": "B2B-MIN"}

# Nombres del modelo → nombre en raw.b2brr_*. Ojo: sin esto media / efecto financiero /
# hedge se descartaban en silencio (bug de los notebooks hasta W37).
ALIAS_COLUMNAS = {
    "media_other_revenue": "media_revenue",
    "efecto_financiero":   "financial_results",
    "currency_hedge":      "hedge",
    "curency_hedge":       "hedge",
    "net_revenue":         "nr_modelo",
    "npv":                 "fvm_modelo",
}

NR_COMPONENTES = [
    "up_front_incentives", "fees", "commercial_discounts", "cancellations",
    "income_from_outsourced_services", "back_end_incentives", "other_incentives",
    "breakage_revenue", "media_revenue", "revenue_tax", "loyalty_usd",
]
FVM_COMPONENTES = [  # FVM = NR + estos
    "cost_of_installments", "credit_card_processing", "white_labels_api", "affiliates",
    "customer_service", "errors", "frauds", "intercompany_usd", "customer_claims",
    "other_transactional_taxes", "vendor_commissions", "dif_fx", "hedge", "financial_results",
    "mkt_usd",
]
# Se distribuyen pero no entran en NR/FVM (van igual a la tabla).
OTRAS_METRICAS = ["orders", "gross_bookings", "operations"]
METRICAS = OTRAS_METRICAS + NR_COMPONENTES + FVM_COMPONENTES + ["nr_modelo", "fvm_modelo"]

# Columnas del modelo que NO son métricas. Cualquier columna numérica que no esté acá ni en
# METRICAS y tenga valores ≠ 0 corta la corrida: es una columna nueva/renombrada a mapear.
NO_METRICAS = {
    "concatenado", "escenario", "mes_pivot", "pais", "lob_canal", "marca", "partner", "viaje",
    "producto", "numero_mes_proyectado", "mes_venta", "mes_ri", "anio", "fecha_venta", "mes_ap",
    "anio_checkin", "año_checki", "fecha_checkin", "cosecha", "mes_proyectado", "revenue_margin",
}
# Métricas del modelo que no existen en raw.b2brr_*: se toleran solo si suman 0.
DESCARTABLES_SI_CERO = {"channels"}

COLUMNAS_SALIDA = [
    "fecha", "escenario", "marca", "lob_canal", "no_mes_proyectado", "mes_proyectado", "pais",
    "producto", "viaje", "partner", "orders", "gross_bookings", "up_front_incentives", "fees",
    "commercial_discounts", "cancellations", "cost_of_installments", "credit_card_processing",
    "white_labels_api", "affiliates", "income_from_outsourced_services", "back_end_incentives",
    "other_incentives", "breakage_revenue", "media_revenue", "revenue_tax", "customer_service",
    "errors", "frauds", "customer_claims", "other_transactional_taxes", "vendor_commissions",
    "intercompany_usd", "operations", "dif_fx", "hedge", "financial_results", "net_revenue", "fvm",
    # Agregadas 2026-09 (al final, para no correr columnas en la carga): hoy en 0 en el modelo,
    # quedan mapeadas por si se prenden. loyalty entra en NR y mkt en FVM.
    "loyalty_usd", "mkt_usd",
]
DIMENSIONES = ["escenario", "marca", "lob_canal", "producto", "partner"]

MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
         "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
NOMBRE_MES = {v: k.capitalize() for k, v in MESES.items() if k != "setiembre"}

TOL_FACTOR = 1e-6       # suma de factores por grupo = 1 ± esto
TOL_CONSERVACION = 0.01  # USD por grupo negocio×mes×país×métrica (ruido de float)


class ErrorProceso(Exception):
    pass


# ==============================================================================
# 2) UTILIDADES
# ==============================================================================

def log(msg=""):
    print(msg, flush=True)


def normalizar_columna(c):
    return str(c).strip().lower().replace(" ", "_")


def leer_excel(path, hoja):
    """read_excel con cache en disco (clave = ruta + hoja + mtime + tamaño). Los Excel de
    factores pesan 30-60 MB y el modelo HTML tiene ~1M filas: la 2da lectura es instantánea."""
    st = os.stat(path)
    clave = hashlib.md5(f"{path}|{hoja}|{st.st_mtime_ns}|{st.st_size}".encode()).hexdigest()
    cache = CACHE_DIR / f"{clave}.pkl"
    if cache.exists():
        with open(cache, "rb") as fh:
            return pickle.load(fh)
    log(f"    leyendo {Path(path).name} [{hoja}] (primera vez, puede tardar)...")
    df = pd.read_excel(path, sheet_name=hoja)
    CACHE_DIR.mkdir(exist_ok=True)
    with open(cache, "wb") as fh:
        pickle.dump(df, fh)
    return df


def resolver_raiz(raiz_cli):
    if raiz_cli:
        cands = [Path(raiz_cli)]
    elif os.environ.get("B2B_WLS_DIR"):
        cands = [Path(os.environ["B2B_WLS_DIR"])]
    else:
        cands = _candidatas_raiz()
    for c in cands:
        if (c / "Run Rate").is_dir() and (c / "Estacionalidad Diaria").is_dir():
            return c
    raise ErrorProceso("No encuentro la carpeta 'B2B & WLs' de OneDrive. Probé:\n  "
                       + "\n  ".join(str(c) for c in cands)
                       + "\nPasala con --raiz o la variable de entorno B2B_WLS_DIR.")


def resolver_semana(raiz, semana_cli):
    rr = raiz / "Run Rate"
    if semana_cli:
        d = rr / semana_cli
        if not d.is_dir():
            raise ErrorProceso(f"No existe la semana '{semana_cli}' en {rr}")
        return d
    # Carpetas "AAAA.MM.DD - Wnn": ordenan por fecha. La última que tenga Inputs Python.
    semanas = sorted(p for p in rr.iterdir() if p.is_dir() and (p / "Inputs Python").is_dir())
    if not semanas:
        raise ErrorProceso(f"Ninguna carpeta de {rr} tiene 'Inputs Python'")
    return semanas[-1]


def buscar_unico(carpeta, patron):
    hits = [h for h in glob.glob(str(carpeta / patron)) if not Path(h).name.startswith("~$")]
    if len(hits) != 1:
        raise ErrorProceso(f"Esperaba 1 archivo '{patron}' en {carpeta}, encontré {len(hits)}: "
                           f"{[Path(h).name for h in hits]}")
    return Path(hits[0])


def mes_a_numero(serie):
    def conv(v):
        if pd.isna(v):
            return np.nan
        if isinstance(v, (int, float, np.integer, np.floating)):
            return int(v) if 1 <= v <= 12 else np.nan
        if isinstance(v, (datetime, pd.Timestamp)):
            return v.month
        s = str(v).strip().lower()
        if s.isdigit():
            return int(s) if 1 <= int(s) <= 12 else np.nan
        return MESES.get(s, np.nan)
    return serie.map(conv)


# ==============================================================================
# 3) CARGA
# ==============================================================================

def cargar_factores(path, hoja, por_partner):
    df = leer_excel(path, hoja).copy()
    req = ["fecha", "mes", "anio", "pais", "viaje", "Factor combinado"] + (["partner"] if por_partner else [])
    falt = [c for c in req if c not in df.columns]
    if falt:
        raise ErrorProceso(f"Factores {Path(path).name}[{hoja}]: faltan columnas {falt}")
    df = df.dropna(subset=["pais", "viaje", "Factor combinado", "fecha"])[req]
    df = df.rename(columns={"Factor combinado": "factor"})
    df["fecha"] = pd.to_datetime(df["fecha"])
    df["mes"] = df["mes"].astype(int)
    df["anio"] = df["anio"].astype(int)
    df["factor"] = pd.to_numeric(df["factor"], errors="coerce")
    return df


def cargar_proyecciones(path, hoja, cols_mes, negocio):
    raw = leer_excel(path, hoja).copy()
    raw.columns = [normalizar_columna(c) for c in raw.columns]

    # Columnas duplicadas del modelo (ej. 'vendor_commissions.1' en HTML): solo si suman 0.
    for c in [c for c in raw.columns if c.endswith(".1")]:
        if pd.to_numeric(raw[c], errors="coerce").fillna(0).abs().sum() > 0:
            raise ErrorProceso(f"{negocio}: columna duplicada '{c}' con valores ≠ 0 en {path.name}[{hoja}]")
        raw = raw.drop(columns=c)

    raw = raw.rename(columns=ALIAS_COLUMNAS)
    if "fvm_modelo" not in raw.columns and "npv" in raw.columns:
        raw = raw.rename(columns={"npv": "fvm_modelo"})

    # Columnas desconocidas con datos → cortar (así una columna renombrada no se pierde).
    for c in raw.columns:
        if c in METRICAS or c in NO_METRICAS:
            continue
        v = pd.to_numeric(raw[c], errors="coerce")
        if v.notna().any() and v.fillna(0).abs().sum() > 0:
            if c in DESCARTABLES_SI_CERO:
                raise ErrorProceso(f"{negocio}: '{c}' tiene valores ≠ 0 y no existe en raw.b2brr_*. Definir dónde va.")
            raise ErrorProceso(f"{negocio}: columna desconocida '{c}' con valores en {path.name}[{hoja}]. "
                               f"Agregarla a ALIAS_COLUMNAS / METRICAS / NO_METRICAS.")

    col_mes = next((c for c in cols_mes if c in raw.columns), None)
    if col_mes is None or "anio" not in raw.columns:
        raise ErrorProceso(f"{negocio}: no encuentro mes ({cols_mes}) o 'anio' en {path.name}[{hoja}]")

    for m in METRICAS:
        raw[m] = pd.to_numeric(raw[m], errors="coerce").fillna(0.0) if m in raw.columns else 0.0

    # Filas sin país/viaje: los notebooks las descartaban. Si traen plata, avisar.
    sin_dim = raw["pais"].isna() | raw["viaje"].isna()
    gb_desc = raw.loc[sin_dim, "gross_bookings"].abs().sum()
    avisos = []
    if gb_desc > 0:
        avisos.append(f"{negocio}: {sin_dim.sum():,} filas sin país/viaje con GB {gb_desc:,.0f} descartadas")
    df = raw[~sin_dim].copy()

    df["mes_num"] = mes_a_numero(df[col_mes])
    malos = df["mes_num"].isna()
    if malos.any():
        gb_malo = df.loc[malos, "gross_bookings"].abs().sum()
        if gb_malo > 0:
            raise ErrorProceso(f"{negocio}: {malos.sum():,} filas con mes ilegible en '{col_mes}' (GB {gb_malo:,.0f})")
        df = df[~malos]
    df["mes_num"] = df["mes_num"].astype(int)
    df["anio"] = pd.to_numeric(df["anio"], errors="coerce").astype(int)

    df["pais"] = df["pais"].replace(DISCLAIMER_PAIS)
    if "lob_canal" in df.columns:
        df["lob_canal"] = df["lob_canal"].replace(MAPEO_LOB_CANAL)
    for d in DIMENSIONES:
        if d not in df.columns:
            df[d] = ""
    df["negocio"] = negocio
    return df, avisos


# ==============================================================================
# 4) DISTRIBUCIÓN + CONTROLES
# ==============================================================================

def distribuir(df, fac, negocio, por_partner):
    """Cruza cada fila mensual con los factores diarios de su (mes, año, país, viaje[, partner])
    y multiplica todas las métricas. B2B2C: primero por partner, si no hay → partner 'Todos'."""
    errores = []
    claves = ["mes", "anio", "pais", "viaje"]
    df = df.copy()
    df["mes"] = df["mes_num"]

    # Control: los factores de cada grupo suman 1 (si no, se crea o se pierde plata).
    grp = claves + (["partner"] if por_partner else [])
    sumas = fac.groupby(grp)["factor"].sum()
    malos = sumas[(sumas - 1).abs() > TOL_FACTOR]

    fac_cols = ["fecha", "factor"]
    if por_partner:
        m1 = df.merge(fac[claves + ["partner"] + fac_cols], on=claves + ["partner"], how="inner")
        resto = df[~df["_fila"].isin(m1["_fila"])]
        todos = fac[fac["partner"] == "Todos"].drop(columns="partner")
        m2 = resto.merge(todos[claves + fac_cols], on=claves, how="inner")
        out = pd.concat([m1, m2], ignore_index=True)
        usados = set(map(tuple, m1[grp].drop_duplicates().values)) | \
                 set((*k, "Todos") for k in map(tuple, m2[claves].drop_duplicates().values))
    else:
        out = df.merge(fac[claves + fac_cols], on=claves, how="inner")
        usados = set(map(tuple, out[grp].drop_duplicates().values))

    malos_usados = [k for k in malos.index if (k if isinstance(k, tuple) else (k,)) in usados]
    if malos_usados:
        ej = "; ".join(f"{k}={malos[k]:.4f}" for k in malos_usados[:5])
        errores.append(f"{negocio}: {len(malos_usados)} grupos de factores no suman 1 (ej: {ej})")

    # Control: toda fila con plata tiene factor.
    sin = df[~df["_fila"].isin(out["_fila"])]
    con_plata = sin[METRICAS].abs().sum(axis=1) > 0
    if con_plata.any():
        s = sin[con_plata]
        combos = s.groupby(["mes", "anio", "pais", "viaje"] + (["partner"] if por_partner else []))["gross_bookings"].sum()
        errores.append(f"{negocio}: {con_plata.sum():,} filas sin factor (GB {s['gross_bookings'].sum():,.0f}). "
                       f"Combos: {list(combos.index[:5])}")

    for m in METRICAS:
        out[m] = out[m] * out["factor"]

    # Control: la fecha cae en el mes/año proyectado.
    fuera = (out["fecha"].dt.month != out["mes"]) | (out["fecha"].dt.year != out["anio"])
    if fuera.any():
        errores.append(f"{negocio}: {fuera.sum():,} filas con fecha fuera de su mes proyectado")
    return out, errores


# ------------------------------------------------------------------------------
# Reales hasta la fecha de corte + remanente en los días que faltan
# ------------------------------------------------------------------------------

DIMS_FILA = ["escenario", "marca", "lob_canal", "pais", "producto", "viaje", "partner"]
BASICAS = ["orders", "gross_bookings", "nr", "fvm"]  # lo que traen las queries de reales


def _norm(s):
    return s.astype(str).str.strip().str.lower()


def _mix(proj, comps, parte, meses_tot):
    """Peso de cada componente dentro de su total (NR, o FVM−NR) según la proyección de la fila.
    Si el total de la fila es ~0 frente a sus componentes (mix inestable), usa el mix del
    negocio×mes. Los reales solo traen NR/FVM totales: los componentes de los días reales y del
    remanente se abren con este mix, así cada componente del mes = proyección (si no hubo tope)."""
    base = proj[comps].div(proj[parte].replace(0, np.nan), axis=0)
    inestable = (proj[parte].abs() < 0.05 * proj[comps].abs().sum(axis=1)) | base.isna().any(axis=1)
    tot = meses_tot[comps].div(meses_tot[comps].sum(axis=1).replace(0, np.nan), axis=0)
    fb = proj[["anio", "mes"]].merge(tot, left_on=["anio", "mes"], right_index=True, how="left")[comps]
    fb.index = proj.index
    fb = fb.fillna(0.0)
    sin_mix = fb.abs().sum(axis=1) == 0
    fb.loc[sin_mix, comps[0]] = 1.0  # último recurso: todo al primer componente (se avisa)
    base[inestable] = fb[inestable]
    return base, int(sin_mix[inestable].sum())


def incorporar_reales(out, act, corte, negocio, niveles, lob_huerfano):
    """Para los meses que arrancan antes del corte: los días ≤ corte llevan el REAL y los días
    que faltan reparten el remanente (proyección del mes − real), con los factores
    re-normalizados sobre esos días. Si el real ya superó la proyección, los días que faltan
    van en 0 (el mes cierra = real). Devuelve (out nuevo, resumen, avisos, errores)."""
    corte = pd.Timestamp(corte)
    avisos, errores = [], []
    ini = pd.to_datetime(pd.DataFrame({"year": out["anio"], "month": out["mes"], "day": 1}))
    filas = out.loc[ini <= corte, "_fila"].unique()
    if len(filas) == 0:
        return out, pd.DataFrame(), avisos, errores
    P = out[out["_fila"].isin(filas)]
    resto = out[~out["_fila"].isin(filas)]

    agg = {c: "first" for c in DIMS_FILA + ["anio", "mes", "negocio"]}
    agg.update({m: "sum" for m in METRICAS})
    proj = P.groupby("_fila").agg(agg)
    proj["nr"] = proj[NR_COMPONENTES].sum(axis=1)
    proj["fvx"] = proj[FVM_COMPONENTES].sum(axis=1)
    proj["fvm"] = proj["nr"] + proj["fvx"]
    proj["partner_n"] = _norm(proj["partner"])

    # Reales de los meses afectados hasta el corte, agregados a las claves de cruce.
    a = act[act["fecha"] <= corte].rename(columns={"net_revenue": "nr"}).copy()
    a["anio"], a["mes"] = a["fecha"].dt.year, a["fecha"].dt.month
    a = a.merge(proj[["anio", "mes"]].drop_duplicates(), on=["anio", "mes"])
    a["partner_n"] = _norm(a["partner"])
    if not a["lob_canal"].astype(bool).any():
        a["lob_canal"] = lob_huerfano
    claves = ["fecha", "anio", "mes", "pais", "viaje", "producto", "partner", "partner_n", "lob_canal"]
    A = a.groupby(claves, as_index=False)[BASICAS].sum()
    A["_id"] = np.arange(len(A))

    asignados, pend, por_nivel = [], A, {}
    for nivel in niveles:
        k = ["anio", "mes"] + nivel
        w = proj[k + ["gross_bookings"]].reset_index()
        tot = w.groupby(k)["gross_bookings"].transform("sum")
        n = w.groupby(k)["gross_bookings"].transform("size")
        w["w"] = np.where(tot != 0, w["gross_bookings"] / tot.replace(0, np.nan), 1.0 / n)
        m = pend.merge(w[k + ["_fila", "w"]], on=k, how="inner")
        for c in BASICAS:
            m[c] = m[c] * m["w"]
        asignados.append(m[["_fila", "fecha"] + BASICAS])
        hit = pend["_id"].isin(m["_id"])
        por_nivel["+".join(nivel)] = pend.loc[hit, "gross_bookings"].sum()
        pend = pend[~hit]

    # Reales sin fila equivalente en la proyección → filas propias (escenario 'Real').
    gb_huerf = pend["gross_bookings"].sum()
    if len(pend):
        hk = ["anio", "mes", "pais", "viaje", "producto", "partner", "lob_canal"]
        pend = pend.assign(_fila=int(out["_fila"].max()) + 1 + pend.groupby(hk).ngroup())
        nuevos = pend.groupby("_fila")[hk].first()
        nuevos["escenario"], nuevos["marca"], nuevos["negocio"] = "Real", "", negocio
        for c in METRICAS + ["nr", "fvx", "fvm"]:
            nuevos[c] = 0.0
        nuevos["partner_n"] = _norm(nuevos["partner"])
        proj = pd.concat([proj, nuevos[proj.columns]])
        asignados.append(pend[["_fila", "fecha"] + BASICAS])
        top = pend.groupby(["partner", "producto"])["gross_bookings"].sum().sort_values(ascending=False).head(3)
        avisos.append(f"{negocio}: GB real {gb_huerf:,.0f} sin fila en la proyección → filas 'Real' "
                      f"(ej: {', '.join(f'{p}/{q} {v:,.0f}' for (p, q), v in top.items())})")

    R = pd.concat(asignados).groupby(["_fila", "fecha"], as_index=False)[BASICAS].sum()
    real = R.groupby("_fila")[BASICAS].sum().reindex(proj.index, fill_value=0.0)

    # Remanente con tope POR GRUPO (B2B2C: país×viaje×partner; B2B: canal×país×viaje): si el real
    # del grupo ya pasó su proyección (en su mismo signo), los días que faltan van en 0. Si no,
    # el remanente del grupo se reparte entre sus filas según lo que le falta a cada una (así un
    # producto que viene arriba compensa a otro que viene abajo y el mes cierra = proyección).
    gk = ["anio", "mes"] + niveles[min(1, len(niveles) - 1)]
    grp = proj[gk].astype(str).agg("|".join, axis=1)
    crudo = proj[BASICAS] - real
    rem = pd.DataFrame(0.0, index=proj.index, columns=BASICAS)
    for c in BASICAS:
        p_g = proj[c].groupby(grp).transform("sum")
        c_g = crudo[c].groupby(grp).transform("sum")
        r_g = np.where(p_g > 0, np.maximum(c_g, 0), np.where(p_g < 0, np.minimum(c_g, 0), 0.0))
        lugar = crudo[c].where(np.sign(crudo[c]) == np.sign(r_g), 0.0)   # lo que le falta a cada fila
        l_g = lugar.groupby(grp).transform("sum")
        share = proj[c].groupby(grp).transform(lambda x: x / x.sum() if x.sum() != 0 else 1.0 / len(x))
        rem[c] = r_g * np.where(l_g != 0, lugar / l_g.replace(0, np.nan), share)

    # Días que faltan: factor re-normalizado sobre los días > corte de cada fila.
    D = P.loc[P["fecha"] > corte, ["_fila", "fecha", "factor"]].copy()
    s = D.groupby("_fila")["factor"].transform("sum")
    n = D.groupby("_fila")["factor"].transform("size")
    D["w"] = np.where(s > 0, D["factor"] / s.replace(0, np.nan), 1.0 / n)
    D = D.merge(rem, left_on="_fila", right_index=True)
    for c in BASICAS:
        D[c] = D[c] * D["w"]
    con_dias = set(D["_fila"])
    sin_dias = [f for f in proj.index if f not in con_dias]  # meses ya cerrados al corte
    rem.loc[sin_dias] = 0.0

    X = pd.concat([R, D[["_fila", "fecha"] + BASICAS]]).groupby(["_fila", "fecha"], as_index=False)[BASICAS].sum()

    # Componentes: mix de la proyección de la fila aplicado a NR y a FVM−NR.
    meses_tot = proj.groupby(["anio", "mes"])[NR_COMPONENTES + FVM_COMPONENTES].sum()
    mix_nr, n1 = _mix(proj, NR_COMPONENTES, "nr", meses_tot)
    mix_fv, n2 = _mix(proj, FVM_COMPONENTES, "fvx", meses_tot)
    if n1 or n2:
        avisos.append(f"{negocio}: {n1 + n2} filas sin mix de componentes → NR a '{NR_COMPONENTES[0]}' "
                      f"/ FVM a '{FVM_COMPONENTES[0]}'")
    Xm = X.merge(proj[DIMS_FILA + ["anio", "mes", "negocio", "gross_bookings", "operations"]]
                 .rename(columns={"gross_bookings": "_gb_p", "operations": "_ops_p"}),
                 left_on="_fila", right_index=True)
    idx = Xm["_fila"].values
    for c in NR_COMPONENTES:
        Xm[c] = mix_nr[c].reindex(idx).values * Xm["nr"].values
    for c in FVM_COMPONENTES:
        Xm[c] = mix_fv[c].reindex(idx).values * (Xm["fvm"] - Xm["nr"]).values
    Xm["operations"] = np.where(Xm["_gb_p"] > 0, Xm["_ops_p"] * Xm["gross_bookings"] / Xm["_gb_p"].replace(0, np.nan), 0.0)
    Xm["nr_modelo"] = 0.0
    Xm["fvm_modelo"] = 0.0
    Xm["factor"] = np.nan

    # Control interno: por fila, componentes = real + remanente.
    esperado = real + rem
    g = Xm.groupby("_fila")
    comp_nr = g[NR_COMPONENTES].sum().sum(axis=1)
    comp_fvm = comp_nr + g[FVM_COMPONENTES].sum().sum(axis=1)
    dif = pd.concat([(comp_nr - esperado["nr"]).abs(), (comp_fvm - esperado["fvm"]).abs(),
                     (g["gross_bookings"].sum() - esperado["gross_bookings"]).abs()], axis=1).max(axis=1)
    if (dif > TOL_CONSERVACION).any():
        errores.append(f"{negocio}: {int((dif > TOL_CONSERVACION).sum())} filas donde real+remanente no cierra "
                       f"con los componentes (máx {dif.max():,.2f})")

    nuevo = pd.concat([resto, Xm.drop(columns=["_gb_p", "_ops_p", "nr"])], ignore_index=True)

    # Resumen por mes afectado.
    res = proj[["anio", "mes"]].copy()
    for c in ["gross_bookings", "nr", "fvm"]:
        res[f"{c}_proy"] = proj[c]
        res[f"{c}_real"] = real[c]
        res[f"{c}_rem"] = rem[c]
    resumen = res.groupby(["anio", "mes"]).agg(
        gb_proy=("gross_bookings_proy", "sum"), gb_real=("gross_bookings_real", "sum"),
        gb_rem=("gross_bookings_rem", "sum"), nr_proy=("nr_proy", "sum"), nr_real=("nr_real", "sum"),
        nr_rem=("nr_rem", "sum"), fvm_proy=("fvm_proy", "sum"), fvm_real=("fvm_real", "sum"),
        fvm_rem=("fvm_rem", "sum"),
    ).reset_index()
    # Grupos cuyo GB real ya superó la proyección del mes (días restantes en 0).
    g = pd.DataFrame({"anio": proj["anio"], "mes": proj["mes"], "g": grp, "p": proj["gross_bookings"],
                      "r": real["gross_bookings"]})[~proj.index.isin(sin_dias)]
    g = g.groupby(["anio", "mes", "g"])[["p", "r"]].sum()
    g["exceso"] = np.where(g["p"] > 0, (g["r"] - g["p"]).clip(lower=0), 0.0)
    tg = g.groupby(["anio", "mes"]).agg(grupos_topeados=("exceso", lambda x: int((x > 0).sum())),
                                        gb_exceso=("exceso", "sum")).reset_index()
    resumen = resumen.merge(tg, on=["anio", "mes"], how="left").fillna({"grupos_topeados": 0, "gb_exceso": 0})
    resumen["negocio"] = negocio
    resumen["gb_sin_fila"] = gb_huerf
    # Ritmo: GB/día real vs GB/día que implica el remanente (si difieren mucho, el RR está viejo).
    fin = pd.to_datetime(pd.DataFrame({"year": resumen["anio"], "month": resumen["mes"], "day": 1})) + pd.offsets.MonthEnd(0)
    ini_m = fin - pd.offsets.MonthBegin(1)
    dias_real = (np.minimum(fin, corte) - ini_m).dt.days + 1
    resumen["dias_rem"] = (fin - corte).dt.days.clip(lower=0)
    resumen["gb_dia_real"] = resumen["gb_real"] / dias_real
    resumen["gb_dia_rem"] = np.where(resumen["dias_rem"] > 0, resumen["gb_rem"] / resumen["dias_rem"].replace(0, np.nan), 0.0)
    resumen["cruce_por_nivel"] = "; ".join(f"{k}: {v:,.0f}" for k, v in por_nivel.items())
    return nuevo, resumen, avisos, errores


def conciliar(df_in, df_out, excluir=()):
    """Conservación: por negocio × mes × país, cada métrica distribuida suma lo mismo que el modelo.
    `excluir` = (negocio, _fila) de los meses completados con reales (se controlan aparte)."""
    k = ["negocio", "anio", "mes_num", "pais"]
    if excluir:
        ex = pd.MultiIndex.from_tuples(list(excluir))
        df_in = df_in[~pd.MultiIndex.from_frame(df_in[["negocio", "_fila"]]).isin(ex)]
        df_out = df_out[~pd.MultiIndex.from_frame(df_out[["negocio", "_fila"]]).isin(ex)]
    a = df_in.groupby(k)[METRICAS].sum()
    b = df_out.assign(mes_num=df_out["mes"]).groupby(k)[METRICAS].sum()
    a, b = a.align(b, fill_value=0)
    dif = (b - a)
    malos = dif.abs().max(axis=1) > TOL_CONSERVACION
    errores = []
    if malos.any():
        peor = dif[malos].abs().stack().sort_values(ascending=False).head(5)
        errores.append(f"Conservación: {malos.sum()} grupos negocio×mes×país no cierran vs el modelo. "
                       f"Peores: {[(i, round(v, 2)) for i, v in peor.items()]}")
    return errores


def reporte(df_in, df_out):
    """Tabla por negocio × mes: GB, NR y FVM del modelo vs los recalculados en la salida."""
    k = ["negocio", "anio", "mes_num"]
    mod = df_in.groupby(k)[["gross_bookings", "nr_modelo", "fvm_modelo"]].sum()
    o = df_out.assign(mes_num=df_out["mes"]).groupby(k)[["gross_bookings", "net_revenue", "fvm"]].sum()
    r = mod.join(o, rsuffix="_salida").rename(columns={
        "gross_bookings": "gb_modelo", "gross_bookings_salida": "gb_salida",
        "net_revenue": "nr_salida", "fvm": "fvm_salida"})
    r["dif_nr"] = r["nr_salida"] - r["nr_modelo"]
    r["dif_fvm"] = r["fvm_salida"] - r["fvm_modelo"]
    return r.reset_index()


# ==============================================================================
# 5) MAIN
# ==============================================================================

def correr(base, semana_cli=None, raiz_cli=None, dry_run=False, salida_cli=None, reales_hasta=None):
    """reales_hasta: fecha (date) hasta la que se toman reales (incluida), o None = sin reales."""
    base = base.upper()
    raiz = resolver_raiz(raiz_cli)
    semana = resolver_semana(raiz, semana_cli)
    inputs = semana / "Inputs Python"
    est = raiz / "Estacionalidad Diaria"
    log(f"DISTRIBUCIÓN DIARIA · base {base}")
    log(f"  raíz:    {raiz}")
    log(f"  semana:  {semana.name}")
    log(f"  reales:  {'hasta ' + reales_hasta.isoformat() + ' (incluido)' if reales_hasta else 'NO (solo proyección)'}")

    errores, avisos, entradas, salidas, resumenes, excluir = [], [], [], [], [], set()
    proyecciones = {}
    for negocio, cfg in NEGOCIOS.items():
        modelo = buscar_unico(inputs, cfg["modelo"])
        fac_file, fac_hoja = cfg["factor"][base]
        log(f"\n[{negocio}] {modelo.name} [{cfg['hoja'][base]}]  ×  {fac_file} [{fac_hoja}]")
        df, av = cargar_proyecciones(modelo, cfg["hoja"][base], cfg["mes"][base], negocio)
        df["_fila"] = np.arange(len(df))
        avisos += av
        fac = cargar_factores(est / fac_file, fac_hoja, cfg["por_partner"])
        proyecciones[negocio] = (df, fac, cfg)

    reales = {}
    if reales_hasta:
        from reales import cargar_reales, ErrorReales
        ini = min(datetime(int(a), int(m), 1).date() for df, _, _ in proyecciones.values()
                  for a, m in df[["anio", "mes_num"]].drop_duplicates().itertuples(index=False))
        if ini > reales_hasta:
            avisos.append(f"El corte {reales_hasta} es anterior al primer mes proyectado ({ini}): "
                          f"no hay reales para incorporar")
        else:
            log("")
            try:
                reales = cargar_reales(base, ini, reales_hasta, log=log)
            except ErrorReales as e:
                raise ErrorProceso(str(e))
            ult = max((r["fecha"].max() for r in reales.values() if len(r)), default=None)
            if ult is None or ult.date() < reales_hasta:
                errores.append(f"Pediste reales hasta {reales_hasta} pero el Datalake tiene hasta "
                               f"{ult.date() if ult is not None else '—'}. Correr con un corte ≤ al último día cargado.")

    for negocio, (df, fac, cfg) in proyecciones.items():
        out, err = distribuir(df, fac, negocio, cfg["por_partner"])
        errores += err
        if negocio in reales:
            out, resu, av, err = incorporar_reales(out, reales[negocio], reales_hasta, negocio,
                                                   cfg["niveles_reales"], cfg.get("lob_huerfano", negocio))
            avisos += av
            errores += err
            if len(resu):
                resumenes.append(resu)
                # Filas de los meses completados con reales (incluye las filas 'Real' nuevas):
                # su control es interno a incorporar_reales, no contra el modelo.
                ini_af = pd.to_datetime(pd.DataFrame({"year": out["anio"], "month": out["mes"], "day": 1}))
                excluir |= {(negocio, f) for f in out.loc[ini_af <= pd.Timestamp(reales_hasta), "_fila"]}
        entradas.append(df)
        salidas.append(out)
        log(f"  [{negocio}] {len(df):,} filas mensuales → {len(out):,} filas diarias · "
            f"GB modelo {df['gross_bookings'].sum():,.0f}")

    df_in = pd.concat(entradas, ignore_index=True)
    df_out = pd.concat(salidas, ignore_index=True)
    errores += conciliar(df_in, df_out, excluir)

    # NR / FVM con la fórmula oficial (mismos componentes que las queries de actuals).
    df_out["net_revenue"] = df_out[NR_COMPONENTES].sum(axis=1)
    df_out["fvm"] = df_out["net_revenue"] + df_out[FVM_COMPONENTES].sum(axis=1)

    rep = reporte(df_in, df_out)
    res_reales = pd.concat(resumenes, ignore_index=True) if resumenes else pd.DataFrame()
    con_reales = set(map(tuple, res_reales[["negocio", "anio", "mes"]].values)) if len(res_reales) else set()
    rep["con_reales"] = [(n, a, m) in con_reales for n, a, m in rep[["negocio", "anio", "mes_num"]].values]
    fuera_nr = rep[((rep["dif_nr"].abs() > 100) | (rep["dif_fvm"].abs() > 100)) & ~rep["con_reales"]]
    for _, r in fuera_nr.iterrows():
        avisos.append(f"{r['negocio']} {int(r['mes_num']):02d}/{int(r['anio'])}: NR/FVM recalculado ≠ modelo "
                      f"(NR {r['dif_nr']:+,.0f} · FVM {r['dif_fvm']:+,.0f}) — revisar la fórmula en el Excel del modelo")

    # Filas sin actividad (los notebooks hacían lo mismo): achica el CSV ~3x.
    cero = (df_out[["gross_bookings", "up_front_incentives", "fees", "net_revenue", "fvm"]] == 0).all(axis=1)
    df_out = df_out[~cero]

    df_out["no_mes_proyectado"] = df_out["fecha"].dt.month
    mes_origen = "mes_venta" if base == "GD" else "mes_ri"
    df_out["mes_proyectado"] = df_out["mes"].map(NOMBRE_MES)  # = mes de venta (GD) o de RI (RI)
    df_out["fecha"] = df_out["fecha"].dt.strftime("%Y-%m-%d")
    final = df_out[COLUMNAS_SALIDA].sort_values(["fecha", "lob_canal", "pais", "partner"], kind="stable")

    log("\n" + "=" * 70)
    log(f"CONCILIACIÓN (base {base}, mes = {mes_origen})")
    with pd.option_context("display.float_format", "{:,.0f}".format, "display.width", 200):
        log(rep.to_string(index=False))
    tot = rep[["gb_modelo", "gb_salida", "nr_modelo", "nr_salida", "fvm_modelo", "fvm_salida"]].sum()
    log(f"\nTOTAL  GB {tot.gb_salida:,.0f} (modelo {tot.gb_modelo:,.0f}) · NR {tot.nr_salida:,.0f} "
        f"(modelo {tot.nr_modelo:,.0f}) · FVM {tot.fvm_salida:,.0f} (modelo {tot.fvm_modelo:,.0f})")
    log(f"Filas de salida: {len(final):,} · fechas {final['fecha'].min()} → {final['fecha'].max()}")

    if len(res_reales):
        log("\n" + "=" * 70)
        log(f"REALES HASTA {reales_hasta.isoformat()} (incluido) + REMANENTE EN LOS DÍAS QUE FALTAN")
        cols = ["negocio", "anio", "mes", "gb_proy", "gb_real", "gb_rem", "nr_proy", "nr_real", "nr_rem",
                "fvm_proy", "fvm_real", "fvm_rem", "grupos_topeados", "gb_exceso", "gb_sin_fila",
                "dias_rem", "gb_dia_real", "gb_dia_rem"]
        with pd.option_context("display.float_format", "{:,.0f}".format, "display.width", 250):
            log(res_reales[cols].to_string(index=False))
        log("  gb_rem = lo que se reparte en los días que faltan · grupos_topeados = el real ya superó la")
        log("  proyección (días restantes en 0; gb_exceso = cuánto la superó) · gb_sin_fila = real sin fila")
        log("  equivalente en la proyección (va como filas 'Real')")
        for _, r in res_reales.drop_duplicates("negocio").iterrows():
            log(f"  cruce {r['negocio']}: {r['cruce_por_nivel']}")

    for a in avisos:
        log(f"  AVISO: {a}")
    if errores:
        log("\nERRORES — no se guarda nada:")
        for e in errores:
            log(f"  ✗ {e}")
        raise ErrorProceso(f"{len(errores)} controles fallaron")
    log("\n✓ Todos los controles OK")

    if dry_run:
        log("(dry-run: no se guardó nada)")
        return final, rep

    destino = Path(salida_cli) if salida_cli else semana / "Distribucion Diaria"
    destino.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    sufijo = f"_reales-{reales_hasta:%Y%m%d}" if reales_hasta else "_sin-reales"
    csv = destino / f"base_consolidada_diaria_{base}_{ts}{sufijo}.csv"
    final.to_csv(csv, index=False, encoding="utf-8-sig")
    conc = destino / f"conciliacion_{base}_{ts}{sufijo}.csv"
    rep.to_csv(conc, index=False, encoding="utf-8-sig")
    if len(res_reales):
        res_reales.to_csv(destino / f"reales_{base}_{ts}{sufijo}.csv", index=False, encoding="utf-8-sig")
    log(f"\nGuardado: {csv}")
    log(f"          {conc.name}")
    log(f"Próximo paso (manual): cargar el CSV en raw.b2brr_{base.lower()}")
    return final, rep


def main():
    ap = argparse.ArgumentParser(description="Distribución diaria del Run Rate B2B + B2B2C")
    ap.add_argument("--base", required=True, choices=["GD", "RI", "gd", "ri"])
    ap.add_argument("--semana", help="Carpeta de Run Rate, ej. '2026.09.14 - W37' (default: la última)")
    ap.add_argument("--raiz", help="Ruta a la carpeta 'B2B & WLs' de OneDrive (default: autodetecta)")
    ap.add_argument("--salida", help="Carpeta de salida (default: <semana>/Distribucion Diaria)")
    ap.add_argument("--dry-run", action="store_true", help="Corre y controla, no guarda")
    ap.add_argument("--reales-hasta", required=True, metavar="AAAA-MM-DD|no",
                    help="Último día (incluido) con reales del Datalake; el remanente del mes se reparte en "
                         "los días siguientes. 'no' = solo proyección. Con fecha requiere VPN.")
    a = ap.parse_args()
    corte = None
    if a.reales_hasta.lower() != "no":
        try:
            corte = datetime.strptime(a.reales_hasta, "%Y-%m-%d").date()
        except ValueError:
            ap.error("--reales-hasta tiene que ser AAAA-MM-DD o 'no'")
    try:
        correr(a.base, a.semana, a.raiz, a.dry_run, a.salida, corte)
    except ErrorProceso as e:
        log(f"\nABORTADO: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
