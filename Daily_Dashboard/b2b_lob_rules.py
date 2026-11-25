# -*- coding: utf-8 -*-
"""Etiquetas de lob_canal en las tablas raw del Datalake (budget / run rate / forecast).

B2B: lo normal es 'B2B-MAY' (API, mayoristas) y 'B2B-MIN' (HTML, minoristas / agencias afiliadas). El 2026-11-02
raw.b2brr_gd/ri se cargaron con 'API' / 'HTML' y las queries que filtraban por B2B-MAY/MIN volvieron vacías
(el run rate B2B del Daily y del P&L Managerial quedaron en 0 sin que nada fallara).
Para que no vuelva a pasar: las queries filtran por las dos variantes (B2B_LOB_IN) y, al leer, se renombran
API -> B2B-MAY y HTML -> B2B-MIN avisando en el log (normalize_b2b_lob).

B2B2C (2026-11-25, Diego): el Run Rate del 20/11 trajo el partner TBD (ene-mar) con lob_canal 'B2B2C' a secas y las
queries que filtraban por B2B2C-ON / OFF / CALL CENTER lo dejaban afuera. Regla: 'B2B2C' a secas = 'B2B2C-ON'.
Las queries de Run Rate B2B2C filtran con B2B2C_LOB_IN y, al leer, se renombra avisando en el log.

Lo usan daily_sync.py y P&L_Managerial/actuals_gestional_upload.py.
"""

B2B_LOB_ALIAS = {"API": "B2B-MAY", "HTML": "B2B-MIN"}
B2B_LOB_IN = "lob_canal IN ('B2B-MAY', 'B2B-MIN', 'API', 'HTML')"

B2B2C_LOB_ALIAS = {"B2B2C": "B2B2C-ON"}
B2B2C_LOB_IN = "lob_canal IN ('B2B2C-ON', 'B2B2C-OFF', 'B2B2C-CALL CENTER', 'B2B2C')"


def _rename(df, alias, label, what, to):
    lob = df["lob_canal"].astype(str).str.strip().str.upper()
    n = int(lob.isin(alias.keys()).sum())
    if n:
        df["lob_canal"] = lob.replace(alias)
        print(f"  AVISO {label}: {n:,} filas con lob_canal {what} -> renombradas a {to}")
    return df


def normalize_b2b_lob(df, query, label=""):
    """Query de B2B (usa B2B_LOB_IN): renombra API/HTML a B2B-MAY/MIN. Query de B2B2C (usa B2B2C_LOB_IN): renombra
    'B2B2C' a secas a B2B2C-ON. Cualquier otra query: no toca nada. Devuelve el mismo df."""
    if df is None or df.empty or "lob_canal" not in df.columns:
        return df
    if B2B_LOB_IN in query:
        return _rename(df, B2B_LOB_ALIAS, label, "API/HTML", "B2B-MAY/MIN")
    if B2B2C_LOB_IN in query:
        return _rename(df, B2B2C_LOB_ALIAS, label, "'B2B2C' a secas", "B2B2C-ON")
    return df
