# -*- coding: utf-8 -*-
"""
altas_directas_sync.py
======================
KR "+6k New Direct Properties" del set NUEVO del KR Global B2B API (propuesta "B2B PoS Global API Hotels", 2026-11-25,
definido por el equipo de Sourcing via antonella.difranco).

Fuente: lake.bi_sourcing_reporte_altas_resultados_cumplimientos_oct26mar27 (reporte semanal de altas de Sourcing), segmento
'NO Latam', tipo_hotel 'cadena'. Trae un valor por semana (anio_semana_reporte) con su process_date, que es domingo: la semana
cubre de process_date - 7 a process_date - 1 (domingo a sabado). Ej.: semana 44 = 25/10 a 31/10 (process_date 01/11).

Valor de cada mes (regla del equipo):
  - Mes cerrado (ya termino): el de la ULTIMA SEMANA COMPLETA dentro del mes (los 7 dias en el mes). Oct-26 = semana 44;
    nov-26 = semana 48 (la 49 tiene dias de noviembre y de diciembre, no cuenta para noviembre).
  - Mes en curso (lo que se reporta al mapa como RR): la ULTIMA semana que haya del mes (la que termina en el mes), aunque el mes
    no haya cerrado. Ej.: el 25/11 es la semana 47.
  - Meses futuros: sin valor.

Lo llama daily_sync.py en cada corrida ("Actualizar reales" de Ownia) y publica altas_directas_okr.json en la carpeta de Drive del
Daily (+ Ownia). Lo leen el Daily / Tracker (Daily_Dashboard/Codigo.js) y el Hub (Dashboard_B2B_WLs/Codigo_OKR.js).

Uso suelto (no toca Drive):
    python altas_directas_sync.py
"""
import io
import sys
from calendar import monthrange
from datetime import date, datetime, timedelta

FILE_NAME = "altas_directas_okr.json"
TABLA = "lake.bi_sourcing_reporte_altas_resultados_cumplimientos_oct26mar27"
MESES_H2 = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]

SQL = f"""
SELECT anio_semana_reporte, CAST(process_date AS VARCHAR) AS process_date, SUM(altas) AS altas
FROM {TABLA}
WHERE segmento = 'NO Latam' AND tipo_hotel = 'cadena'
GROUP BY 1, 2
ORDER BY 1
"""


def _ym(d):
    return f"{d.year}-{d.month:02d}"


def semanas_desde_df(df):
    """df (anio_semana_reporte, process_date, altas) -> [{semana, process_date, desde, hasta, altas}] ordenadas por hasta."""
    por_semana = {}   # si el reporte de una semana se recargo con otro process_date, queda el ultimo
    for r in df.itertuples():
        if r.altas is None or r.altas != r.altas:   # NULL / NaN
            continue
        pdate = datetime.strptime(str(r.process_date)[:10], "%Y-%m-%d").date()
        prev = por_semana.get(str(r.anio_semana_reporte))
        if prev is None or pdate > prev[0]:
            por_semana[str(r.anio_semana_reporte)] = (pdate, r)
    out = []
    for pdate, r in por_semana.values():
        out.append({"semana": str(r.anio_semana_reporte), "process_date": pdate.isoformat(),
                    "desde": (pdate - timedelta(days=7)).isoformat(), "hasta": (pdate - timedelta(days=1)).isoformat(),
                    "altas": int(r.altas)})
    return sorted(out, key=lambda s: s["hasta"])


def valores_por_mes(semanas, hoy):
    """{ym: {valor, semana, estado}} con la regla del docstring. estado: 'Cierre' (mes terminado, ultima semana completa) o
    'Proyeccion' (mes en curso, ultima semana del mes)."""
    cur = _ym(hoy)
    meses = {}
    for ym in MESES_H2:
        if ym > cur:
            continue
        y, m = int(ym[:4]), int(ym[5:])
        fin_mes = date(y, m, monthrange(y, m)[1])
        if fin_mes < hoy:   # mes terminado: ultima semana con los 7 dias dentro del mes
            cand = [s for s in semanas if s["desde"][:7] == ym and s["hasta"][:7] == ym]
            estado = "Cierre"
        else:               # mes en curso: ultima semana que termina en el mes
            cand = [s for s in semanas if s["hasta"][:7] == ym]
            estado = "Proyeccion"
        if cand:
            s = cand[-1]
            meses[ym] = {"valor": s["altas"], "semana": s["semana"], "hasta": s["hasta"], "estado": estado}
    return meses


def build_payload(fetch, hoy=None):
    hoy = hoy or date.today()
    df = fetch(SQL.strip(), "Altas directas cadenas NO Latam (KR +6k New Direct Properties)")
    semanas = semanas_desde_df(df)
    if not semanas:   # tabla vacia o filtro sin filas: no se sube nada (queda el altas_directas_okr.json anterior)
        print("  WARN [Altas directas] la query no trajo semanas: no se actualiza el archivo")
        return None
    meses = valores_por_mes(semanas, hoy)
    print(f"  [Altas directas] semanas: {[(s['semana'], s['altas']) for s in semanas]}")
    # Sin f-strings anidados con las mismas comillas: el servidor de Ownia corre un Python < 3.12 y no los acepta.
    resumen = ", ".join("%s: %s (sem %s, %s)" % (k, v["valor"], v["semana"], v["estado"]) for k, v in meses.items())
    print("  [Altas directas] por mes: {" + resumen + "}")
    return {
        "meta": {"generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "fuente": TABLA,
                 "filtro": "segmento = 'NO Latam' AND tipo_hotel = 'cadena'",
                 "regla": "mes cerrado = ultima semana completa del mes; mes en curso = ultima semana del mes (RR); semana = process_date-7 .. process_date-1"},
        "semanas": semanas,
        "meses": meses,
    }


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Inputs_Planning_PnL"))
    from recurrencia_sync import _fetch_standalone
    build_payload(_fetch_standalone)
