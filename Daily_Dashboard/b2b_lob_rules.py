# -*- coding: utf-8 -*-
"""Etiquetas de lob_canal de B2B en las tablas raw del Datalake (budget / run rate / forecast).

Lo normal es 'B2B-MAY' (API, mayoristas) y 'B2B-MIN' (HTML, minoristas / agencias afiliadas). El 2026-11-02
raw.b2brr_gd/ri se cargaron con 'API' / 'HTML' y las queries que filtraban por B2B-MAY/MIN volvieron vacías
(el run rate B2B del Daily y del P&L Managerial quedaron en 0 sin que nada fallara).
Para que no vuelva a pasar: las queries filtran por las dos variantes (B2B_LOB_IN) y, al leer, se renombran
API -> B2B-MAY y HTML -> B2B-MIN avisando en el log (normalize_b2b_lob). Lo usan daily_sync.py y
P&L_Managerial/actuals_gestional_upload.py.
"""

B2B_LOB_ALIAS = {"API": "B2B-MAY", "HTML": "B2B-MIN"}
B2B_LOB_IN = "lob_canal IN ('B2B-MAY', 'B2B-MIN', 'API', 'HTML')"


def normalize_b2b_lob(df, query, label=""):
    """Si la query es de B2B (usa B2B_LOB_IN), renombra API/HTML a B2B-MAY/MIN. Devuelve el mismo df."""
    if B2B_LOB_IN not in query or df is None or df.empty or "lob_canal" not in df.columns:
        return df
    lob = df["lob_canal"].astype(str).str.strip().str.upper()
    n = int(lob.isin(B2B_LOB_ALIAS.keys()).sum())
    if n:
        df["lob_canal"] = lob.replace(B2B_LOB_ALIAS)
        print(f"  AVISO {label}: {n:,} filas con lob_canal API/HTML -> renombradas a B2B-MAY/MIN")
    return df
