"""Filas del país RG del P&L Managerial (switch "COI Brasil").

RG = el cost of installments y el efecto financiero de Brasil con signo contrario. Brasil conserva su FVM
completo; el P&L ex COI Brasil es sumar las filas RG (el switch de la landing: Excluir = con RG, Incluir = sin
RG). Mismo criterio que Daily_Dashboard/daily_sync.py (append_rg_rows), pero acá cada fila trae el P&L
abierto en líneas: RG solo lleva cost_of_installments, efecto_financiero y npv (= FVM); el resto va en 0.
"""

RG_PAIS = "RG"


def append_rg_rows(rows: list, v0: int, metric_cols: list) -> list:
    """rows: filas posicionales [pais, ..., v0..vN, ...extras]; v0 = índice de la primera métrica
    (4 en B2B2C: pais, partner, produto, ym; 3 en B2B: pais, produto, ym). Devuelve rows + una fila RG por cada
    fila de Brasil con cost_of_installments / efecto_financiero; la fila RG copia el resto de la apertura
    (partner, producto, ym, viaje, tipo, millas...)."""
    i_coi = v0 + metric_cols.index("cost_of_installments")
    i_ef = v0 + metric_cols.index("efecto_financiero")
    i_npv = v0 + metric_cols.index("npv")
    out = list(rows)
    for r in rows:
        if r[0] != "Brasil":
            continue
        coi, ef = r[i_coi] or 0.0, r[i_ef] or 0.0
        if not coi and not ef:
            continue
        n = list(r)
        n[0] = RG_PAIS
        for j in range(len(metric_cols)):
            n[v0 + j] = 0.0
        n[i_coi], n[i_ef], n[i_npv] = round(-coi, 4), round(-ef, 4), round(-(coi + ef), 4)
        out.append(n)
    return out
