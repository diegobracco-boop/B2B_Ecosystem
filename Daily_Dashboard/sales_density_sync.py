# -*- coding: utf-8 -*-
"""
sales_density_sync.py
=====================
KR "Sales Density on Top 100 Hotels" del set NUEVO del KR Global B2B API (propuesta "B2B PoS Global API Hotels", 2026-11-25,
tabla pasada por Diego).

Fuente: raw.b2b_kpi_sales_density, filas type = 'monthly' (periodo 'YYYY-MM'). sales_density = n_duplas_vendidas_top /
(x_top_hoteles * y_top_clientes): duplas (cliente, hotel) vendidas entre los top 50 clientes PoS Global y los top 100 hoteles,
sobre las 5.000 posibles. También trae filas 'weekly' (periodo 'YYYY-WW'), que acá no se usan.

Valor de cada mes (Diego, 2026-11-25), en %:
  - Mes terminado: sales_density del mes ('Cierre').
  - Mes en curso: MTD proyectado al mes = duplas MTD x días del mes / días con dato ('Proyeccion'). Días con dato = hasta ayer
    (la tabla llega hasta el día anterior, como el resto del Daily). Las duplas se acumulan en el mes: sin proyectar, el parcial
    queda siempre abajo del target. El 1° del mes (sin días con dato) el mes en curso queda sin valor.
  - Meses futuros: sin valor.

Lo llama daily_sync.py en cada corrida ("Actualizar reales" de Ownia) y publica sales_density_okr.json en la carpeta de Drive del
Daily (+ Ownia). Lo leen el Daily / Tracker (Daily_Dashboard/Codigo.js) y el Hub (Dashboard_B2B_WLs/Codigo_OKR.js).

Uso suelto (no toca Drive):
    python sales_density_sync.py
"""
import io
import sys
from calendar import monthrange
from datetime import date, datetime, timedelta
from pathlib import Path

FILE_NAME = "sales_density_okr.json"
TABLA = "raw.b2b_kpi_sales_density"
MESES_H2 = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]

SQL = f"""
SELECT periodo, x_top_hoteles, y_top_clientes, n_duplas_vendidas_top, sales_density
FROM {TABLA}
WHERE type = 'monthly'
"""


def _num(v):
    try:
        f = float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None
    return None if f != f else f   # NaN -> None


def valores_por_mes(df, hoy):
    """df (periodo, x_top_hoteles, y_top_clientes, n_duplas_vendidas_top, sales_density) -> {ym: {pct, duplas, posibles, estado,
    duplas_mtd?, dias?, dias_mes?}} para los meses del H2 hasta el mes en curso."""
    cur = "%d-%02d" % (hoy.year, hoy.month)
    por_ym = {str(r.periodo).strip()[:7]: r for r in df.itertuples()}
    meses = {}
    for ym in MESES_H2:
        r = por_ym.get(ym)
        if ym > cur or r is None:
            continue
        duplas, x, y = _num(r.n_duplas_vendidas_top), _num(r.x_top_hoteles), _num(r.y_top_clientes)
        if duplas is None or not x or not y:
            continue
        posibles = x * y
        yy, mm = int(ym[:4]), int(ym[5:])
        dias_mes = monthrange(yy, mm)[1]
        if date(yy, mm, dias_mes) < hoy:   # mes terminado: el valor de la tabla
            sd = _num(r.sales_density)
            pct = sd * 100 if sd is not None else duplas / posibles * 100
            meses[ym] = {"pct": round(pct, 2), "duplas": int(duplas), "posibles": int(posibles), "estado": "Cierre"}
            continue
        dias = (hoy - timedelta(days=1)).day if (hoy - timedelta(days=1)).month == mm else 0   # con dato hasta ayer
        if dias <= 0:
            continue
        proy = min(duplas * dias_mes / dias, posibles)
        meses[ym] = {"pct": round(proy / posibles * 100, 2), "duplas": int(round(proy)), "posibles": int(posibles),
                     "estado": "Proyeccion", "duplas_mtd": int(duplas), "dias": dias, "dias_mes": dias_mes}
    return meses


def build_payload(fetch, hoy=None):
    hoy = hoy or date.today()
    df = fetch(SQL, "Sales Density top 100 hoteles x top 50 clientes (KR Sales Density nuevo)")
    meses = valores_por_mes(df, hoy)
    if not meses:   # sin filas del H2: no se sube nada (queda el sales_density_okr.json anterior)
        print("  WARN [Sales Density] la tabla no trajo meses del H2: no se actualiza el archivo")
        return None
    partes = []
    for k, v in meses.items():
        extra = " = %s MTD x %s/%s" % (v["duplas_mtd"], v["dias_mes"], v["dias"]) if v["estado"] == "Proyeccion" else ""
        partes.append("%s: %s%% (%s duplas%s, %s)" % (k, v["pct"], v["duplas"], extra, v["estado"]))
    print("  [Sales Density] " + ", ".join(partes))
    return {
        "meta": {"generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "fuente": TABLA + " (type = 'monthly')",
                 "regla": "% duplas vendidas / posibles; mes terminado = cierre, mes en curso = MTD proyectado al mes (x dias del mes / dias con dato)"},
        "meses": meses,
    }


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Inputs_Planning_PnL"))
    from recurrencia_sync import _fetch_standalone
    build_payload(_fetch_standalone)
