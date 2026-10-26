"""
plana_projections_builder.py
Genera las PLANAS de proyecciones (Budget / Forecast / Run Rate / Last Run Rate)
desde los CSV de Planning-PBI, replicando el proceso del agente interno (Partes 3-6).

Uso:
    python plana_projections_builder.py <base> [--con-ppa]
    <base> ∈ budget | forecast | runrate | lastrunrate

Default = SIN PPA  -> suma el efecto de 'Reverso AxI.xlsx' (hoja Budget).
--con-ppa           -> NO suma el reverso (procesa normal).

Output: plana_<base>.csv  (long: Marca|LoB|Canal|Pais|Producto|P&L N1..N6|P&L Managerial View|Fecha|Monto USD)
"""
import os
import glob
import sys
import pandas as pd
import pnl_common

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import config
from pnl_common import (
    DIM_COLS, OUT_COLS, LOBS_KEEP,
    homolog, to_num, lower_all,
    load_glosario, add_axi, load_axi_sheet,
)

FISCAL_DATES       = config.FISCAL_DATES
FORECAST_DROP_DATES = config.FORECAST_DROP_DATES
BASES              = config.BASES
PBI                = pnl_common.get_pbi_inputs_dir()

# ── Filtros de exclusión (Parte 3.6) ─────────────────────────────────────────
EXCL_MARCA   = {"br_4001", "interco"}
EXCL_LOBCANAL = {"financial services business", "lob_00"}
EXCL_LINEA = {
    "3rd parties fx", "cash & equivalents fx", "factoring expense", "financial expense",
    "financial income", "income tax", "other adjustments non-fx", "other fx", "withholdings tax",
    "intercompany fx", "ndf fixing", "bank charges", "tax penalties", "guarantee charges",
    "neteo fx", "other income/expense non-fx", "other interest expense", "other interest income",
}


# ── Parser especial de los CSV (Parte 3.2) ───────────────────────────────────
def parse_line(contenido):
    partes, dentro, actual = [], False, ""
    for ch in contenido:
        if ch == '"':
            dentro = not dentro
        elif ch == ',' and not dentro:
            partes.append(actual.strip()); actual = ""
        else:
            actual += ch
    if actual:
        partes.append(actual.strip())
    if len(partes) < 14:
        return None
    cuenta = partes[0]
    meses  = partes[1:13]
    meta   = partes[13].strip('"').split(',')
    return cuenta, meses, meta


# ── Lectura + parseo de una base (ALL + NA) ──────────────────────────────────
def read_base(files, only_from_all=()):
    recs = []
    for rel in files:
        is_all = "legal entity all" in rel.lower()
        path = os.path.join(PBI, rel)
        with open(path, encoding="utf-8-sig") as f:
            next(f, None)  # header
            for line in f:
                line = line.rstrip("\n").rstrip("\r")
                if not line:
                    continue
                # Las filas vienen envueltas en comillas (toda la fila = 1 campo, con "" internas):
                # desenvolver y desescapar antes de aplicar el parser del POV.
                if len(line) >= 2 and line[0] == '"' and line[-1] == '"':
                    line = line[1:-1].replace('""', '"')
                p = parse_line(line)
                if p is None:
                    continue
                cuenta, meses, meta = p
                if len(meta) < 8:
                    continue
                rec = {
                    "Linea P&L":  cuenta,
                    "Escenario":  meta[1] if len(meta) > 1 else None,
                    "Marca":      meta[3] if len(meta) > 3 else None,
                    "Viaje":      meta[4] if len(meta) > 4 else None,
                    "Pais":       meta[5] if len(meta) > 5 else None,
                    "Producto":   meta[6] if len(meta) > 6 else None,
                    "LOB-CANAL":  meta[7] if len(meta) > 7 else None,
                }
                if not is_all and cuenta.strip().lower() in only_from_all:
                    continue
                for i, d in enumerate(FISCAL_DATES):
                    rec[d] = to_num(meses[i]) if i < len(meses) else None
                recs.append(rec)
    return pd.DataFrame(recs)


# ── Lectura de una base en formato PLANO (RunRate desde 2026-10-26) ──────────
# Columnas: linea;nivel_2..nivel_8;year;mes;scenario;pais;pais_organic;product;lob;
# channel;brand;version;total. Se lleva al mismo shape que read_base (Linea P&L,
# Marca, Pais, Producto, LOB-CANAL + una columna por FISCAL_DATE) para que el resto
# (exclusiones, Glosario, AxI) no cambie. Los niveles del archivo se ignoran: la
# jerarquía sale del Glosario, igual que en las demás bases.
# 'linea' del archivo nuevo -> clave de la hoja "Linea P&L" del Glosario (solo las que
# no matchean tal cual).
FLAT_LINEA_MAP = {
    "gb nac":                     "gross bookings domestic",
    "gb int":                     "gross bookings international",
    "orders nac":                 "orders domestic",
    "orders int":                 "orders international",
    "channels":                   "channels-personnel/expenses",
    "it personnel":               "it - personnel/expenses",
    "marketing personnel":        "marketing-personnel/expenses",
    "loyalty personnel":          "loyalty - personnel/expenses",
    "loyalty - partners revenue": "loyalty - partner revenue",
    "income services":            "income from outsourced services",
    "other tax":                  "other taxes.",
    "equity":                     "equity income / loss",
    "d&a":                        "d&a - fixed assets",
    "d&a other":                  "d&a - fixed assets",
    "bono lec":                   "other transactional taxes",
}
# La herramienta de descarga corta la exportación en 300.000 filas SIN avisar (2026-10-26:
# un RunRate Oct-Mar llegó cortado a mitad de 'IT Personnel', sin NR de Up Front Incentives,
# Revenue Taxes, Loyalty, etc.). Un archivo con exactamente este tamaño se rechaza.
FLAT_EXPORT_ROW_LIMIT = 300_000
# Leases / Leases Adjustment: ajustes EBIT que se netean entre sí (no existían en el RR
# viejo ni tienen fila en el Glosario) -> se descartan.
FLAT_LINEA_DROP = {"leases", "leases adjustment"}
# 'pais' del archivo nuevo -> nombre de país del pipeline (el resto ya coincide o
# lo resuelve el Glosario, ej. "OPS + RG" -> RG).
FLAT_PAIS_MAP = {"brazil": "Brasil", "others": "Others Countries"}


def read_flat_base(pattern):
    """pattern es un glob relativo a get_base_dir(): como la exportación corta en
    FLAT_EXPORT_ROW_LIMIT filas, el RunRate se puede bajar en partes (RunRate.csv,
    RunRate_2.csv, ...) y acá se juntan. Se puede partir por mes, LoB o línea (ej. hasta OC
    en uno y costos fijos en otro); dos partes con el mismo (mes, LoB, línea) = error (se
    sumaría dos veces)."""
    paths = sorted(glob.glob(os.path.join(pnl_common.get_base_dir(), pattern)))
    if not paths:
        sys.exit(f"No hay archivos {pattern} en {pnl_common.get_base_dir()}")
    parts, vistos = [], {}
    for path in paths:
        name = os.path.basename(path)
        part = pd.read_csv(path, sep=";", dtype=str, encoding="utf-8-sig")
        if len(part) == FLAT_EXPORT_ROW_LIMIT:
            sys.exit(f"{name} tiene exactamente {FLAT_EXPORT_ROW_LIMIT:,} filas = tope de la exportación "
                     f"-> la descarga vino CORTADA (última línea: '{part['linea'].iloc[-1]}'). "
                     f"Volver a descargar en partes (ej. Oct-Dic y Ene-Mar, o por LoB) como {pattern}.")
        for k in part[["mes", "lob", "linea"]].drop_duplicates().itertuples(index=False):
            if k in vistos:
                sys.exit(f"Mes {k.mes} / LoB {k.lob} / línea {k.linea} está en {vistos[k]} y en {name} "
                         f"-> se sumaría dos veces. Cada mes x LoB x línea tiene que estar en un solo archivo.")
            vistos[k] = name
        print(f"  fuente: {path} ({len(part):,} filas, meses {sorted(part['mes'].unique(), key=int)}, "
              f"LoB {sorted(part['lob'].unique())})")
        parts.append(part)
    raw = pd.concat(parts, ignore_index=True)
    fy = config.CURRENT_FY
    fy_tag = f"FY{str(fy)[-2:]}"
    otros = raw.loc[raw["year"] != fy_tag, "year"].unique()
    if len(otros):
        print(f"  [WARN] se descartan {int((raw['year'] != fy_tag).sum()):,} filas de year={list(otros)} (no es {fy_tag})")
    raw = raw[raw["year"] == fy_tag].copy()
    if raw.empty:
        sys.exit(f"Ninguna fila con year={fy_tag} en {pattern} -> ¿cambió el formato de 'year'?")
    mes = raw["mes"].astype(int)
    # mes = mes calendario; el FY arranca en abril (Abr..Dic = año anterior)
    raw["Fecha"] = [f"{fy - 1 if m >= 4 else fy}-{m:02d}-01" for m in mes]
    raw["total"] = pd.to_numeric(raw["total"].str.replace(".", "", regex=False)
                                              .str.replace(",", ".", regex=False), errors="coerce")
    # pivot_table descarta en silencio filas con NaN en claves o monto -> frenar antes
    ilegibles = raw["total"].isna()
    if ilegibles.any():
        sys.exit(f"{int(ilegibles.sum()):,} filas con 'total' vacío o ilegible "
                 f"-> ¿cambió el formato de número (se espera '.' de miles y ',' decimal)?")
    vacias = raw[["linea", "brand", "pais", "product", "lob", "channel"]].isna().any(axis=1)
    if vacias.any():
        sys.exit(f"{int(vacias.sum()):,} filas con linea/brand/pais/product/lob/channel vacío "
                 f"-> se perderían en el pivot. Revisar el CSV.")
    linea = raw["linea"].str.strip().str.lower()
    keep = ~linea.isin(FLAT_LINEA_DROP)
    raw, linea = raw[keep].copy(), linea[keep]
    raw["Linea P&L"] = linea.map(FLAT_LINEA_MAP).fillna(raw["linea"])
    raw["Pais"]      = raw["pais"].str.strip().str.lower().map(FLAT_PAIS_MAP).fillna(raw["pais"])
    raw["Marca"]     = raw["brand"]
    raw["Producto"]  = raw["product"]
    raw["LOB-CANAL"] = raw["lob"].str.strip() + "-" + raw["channel"].str.strip()
    keys = ["Linea P&L", "Marca", "Pais", "Producto", "LOB-CANAL"]
    wide = raw.pivot_table(index=keys, columns="Fecha", values="total",
                           aggfunc="sum").reset_index()
    for d in FISCAL_DATES:
        if d not in wide.columns:
            wide[d] = None
    print(f"  meses con datos: {sorted(raw['Fecha'].unique())}")
    return wide[keys + FISCAL_DATES]


# ── Transform GB/Orders (Parte 3.5) ──────────────────────────────────────────
def gb_orders_transform(df):
    v = df["Viaje"].astype(str).str.strip().str.lower()
    l = df["Linea P&L"].astype(str).str.strip().str.lower()
    df.loc[(v == "d_0001") & (l == "gb"),       "Linea P&L"] = "gross bookings domestic"
    df.loc[(v == "d_0001") & (l == "orders_s"), "Linea P&L"] = "orders domestic"
    df.loc[(v == "d_0002") & (l == "gb"),       "Linea P&L"] = "gross bookings international"
    df.loc[(v == "d_0002") & (l == "orders_s"), "Linea P&L"] = "orders international"
    return df


def apply_exclusions(df, is_forecast):
    df = df[~df["Marca"].astype(str).str.strip().str.lower().isin(EXCL_MARCA)]
    df = df[~df["LOB-CANAL"].astype(str).str.strip().str.lower().isin(EXCL_LOBCANAL)]
    df = df[~df["Linea P&L"].astype(str).str.strip().str.lower().isin(EXCL_LINEA)]
    return df


def homologate(df, g):
    df = df.copy()
    df["Marca"]    = df["Marca"].apply(lambda x: homolog(g["marca"], x, 0, x))
    df["Pais"]     = df["Pais"].apply(lambda x: homolog(g["paises"], x, 0, x))
    df["Producto"] = df["Producto"].apply(lambda x: homolog(g["producto"], x, 0, x))
    df["LoB"]      = df["LOB-CANAL"].apply(lambda x: homolog(g["lob"], x, 0, None))
    df["Canal"]    = df["LOB-CANAL"].apply(lambda x: homolog(g["lob"], x, 1, None))
    miss = df["LoB"].isna()
    if miss.any():
        split = df.loc[miss, "LOB-CANAL"].astype(str).str.split("-", n=1, expand=True)
        df.loc[miss, "LoB"]   = split[0]
        df.loc[miss, "Canal"] = split[1] if split.shape[1] > 1 else "Sin Canal"
    for i, col in enumerate(["P&L N1", "P&L N2", "P&L N3", "P&L N4", "P&L N5", "P&L N6", "P&L Managerial View"]):
        df[col] = df["Linea P&L"].apply(lambda x, i=i: homolog(g["linea"], x, i, x))
    return df


def melt_and_group(df):
    id_vars = ["Marca", "LoB", "Canal", "Pais", "Producto",
               "P&L N1", "P&L N2", "P&L N3", "P&L N4", "P&L N5", "P&L N6", "P&L Managerial View"]
    long = df.melt(id_vars=id_vars, value_vars=FISCAL_DATES, var_name="Fecha", value_name="Monto USD")
    long = long.dropna(subset=["Monto USD"])
    long["Monto USD"] = pd.to_numeric(long["Monto USD"], errors="coerce")
    long = long.dropna(subset=["Monto USD"])
    long = long[long["Monto USD"] != 0]
    grouped = long.groupby(id_vars + ["Fecha"], as_index=False, dropna=False)["Monto USD"].sum()
    return grouped


# ── Verificación (Parte 5) ───────────────────────────────────────────────────
def verify(df):
    print("\n--- VERIFICACIÓN ---")
    print(f"filas: {len(df):,}")
    print("nulos ->", {c: int(df[c].isna().sum()) for c in ["Marca", "LoB", "Canal", "Pais", "Producto"]})
    print("únicos ->", {c: int(df[c].nunique()) for c in ["Marca", "Pais", "Producto", "LoB"]})
    print("Pais:", sorted(df["Pais"].dropna().unique())[:15])
    print("Producto:", sorted(df["Producto"].dropna().unique())[:15])
    print("P&L N2:", sorted(df["P&L N2"].dropna().unique())[:20])
    print("Fecha rango:", df["Fecha"].min(), "->", df["Fecha"].max())
    print("Monto USD total:", round(df["Monto USD"].sum(), 1))


# ── Main ─────────────────────────────────────────────────────────────────────
def build(base, con_ppa=False):
    cfg = BASES[base]
    print(f"=== plana {base} ({'CON' if con_ppa else 'SIN'} PPA) ===")
    if "flat_file" in cfg:
        df = read_flat_base(cfg["flat_file"])
        print(f"  leídas {len(df):,} filas (formato plano)")
    else:
        df = read_base(cfg["files"], cfg.get("only_from_all", ()))
        print(f"  leídas {len(df):,} filas (ALL+NA)")
        df = gb_orders_transform(df)  # el formato plano ya trae GB/Orders NAC/INT
    df = apply_exclusions(df, cfg["is_forecast"])
    if cfg["is_forecast"]:
        for d in FORECAST_DROP_DATES:
            df[d] = None  # Forecast: excluir Abr-Jul (aún no proyectados)
    g = load_glosario()
    df = homologate(df, g)
    plana = melt_and_group(df)
    plana = lower_all(plana)[OUT_COLS]
    plana = plana[plana["LoB"].isin(LOBS_KEEP)]
    if not con_ppa:
        axi = load_axi_sheet(g, "Budget")
        if axi is not None and not axi.empty:
            axi = axi[axi["LoB"].isin(LOBS_KEEP)]
            axi = axi[axi["Fecha"].isin(set(plana["Fecha"].unique()))]
        print(f"  reverso AxI (Budget): {0 if axi is None else len(axi):,} filas a sumar")
        plana = add_axi(plana, axi)[OUT_COLS]
    verify(plana)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"plana_{base}.csv")
    plana.to_csv(out, index=False, encoding="utf-8")
    print(f"\nOK -> {out}")
    return plana


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    con_ppa = "--con-ppa" in sys.argv
    if not args or args[0] not in BASES:
        sys.exit(f"Uso: python plana_projections_builder.py <{'|'.join(BASES)}> [--con-ppa]")
    build(args[0], con_ppa)
