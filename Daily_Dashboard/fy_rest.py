"""
fy_rest.py — tramos del año fiscal que faltan en el JSON del Daily.

El Daily baja actuals desde el 1-ene del año en curso (ACTUALS_FROM) y LY desde el 1-ene del
año pasado hasta fin del mes en curso del año pasado (LY_FROM..LY_TO). El gráfico de 12 meses
de la portada "B2B2C Monthly Performance" del Flow necesita el AÑO FISCAL completo (abr -> mar)
de actuals y de LY. Acá se calculan los tramos que no cubre ninguno de esos dos bloques; daily_sync.py
los baja aparte, a grano mensual, en claves propias (actuals_fy_rest / actuals_ly_fy_rest) para no
cambiar lo que leen las demás vistas.

  - En abr-dic: actuals = nada (el FY arrancó este año); LY = lo que quede del año pasado
    después de LY_TO (p.ej. nov-dic).
  - En ene-mar: actuals = abr-dic del año pasado; LY = abr-dic de hace dos años + lo que quede
    de ene-mar del año pasado después de LY_TO.
"""
from datetime import date, timedelta


def fy_bounds(today: date) -> tuple:
    """(inicio, fin) del año fiscal en curso: 1-abr -> 31-mar."""
    y0 = today.year if today.month >= 4 else today.year - 1
    return date(y0, 4, 1), date(y0 + 1, 3, 31)


def missing_ranges(want_from: date, want_to: date, covered: list) -> list:
    """Tramos de [want_from, want_to] que no caen en ninguno de los rangos `covered`
    (lista de (desde, hasta), inclusivos). Devuelve [(desde, hasta), ...] ordenados."""
    out, cur = [], want_from
    for c_from, c_to in sorted(c for c in covered if c[0] <= c[1]):
        if c_to < cur:
            continue
        if c_from > want_to:
            break
        if c_from > cur:
            out.append((cur, min(c_from - timedelta(days=1), want_to)))
        cur = max(cur, c_to + timedelta(days=1))
        if cur > want_to:
            return out
    if cur <= want_to:
        out.append((cur, want_to))
    return out


def actuals_fy_rest_ranges(today: date, actuals_from: date) -> list:
    """Meses del FY en curso anteriores a ACTUALS_FROM (solo pasa en ene-mar)."""
    fy_from, _ = fy_bounds(today)
    return missing_ranges(fy_from, actuals_from - timedelta(days=1), [])


def ly_fy_rest_ranges(today: date, ly_from: date, ly_to: date,
                      actuals_from: date, yesterday: date) -> list:
    """Tramos del FY anterior (el LY del FY en curso) que no cubren actuals_ly ni actuals."""
    fy_from, fy_to = fy_bounds(today)
    ly_fy_from, ly_fy_to = date(fy_from.year - 1, 4, 1), date(fy_to.year - 1, 3, 31)
    return missing_ranges(ly_fy_from, ly_fy_to, [(ly_from, ly_to), (actuals_from, yesterday)])
