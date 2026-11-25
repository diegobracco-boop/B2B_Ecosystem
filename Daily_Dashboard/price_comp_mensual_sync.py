# -*- coding: utf-8 -*-
"""
price_comp_mensual_sync.py
==========================
KR "Price Competitiveness Destino Globales" del set NUEVO del KR Global B2B API (propuesta "B2B PoS Global API Hotels",
2026-11-25, pedido de antonella.difranco).

Fuente: la pregunta Metabase 180311 "Query evolutivo Adversidad B2B No Latam" = card 178823 "Adversidad B2B No Latam" (copiada en
adversidad_b2b_no_latam_mensual.sql) con los filtros market_target IN ('Latam','No Latam','ONA'), flag_top_21_destino_gb = 1 e
is_hotel = 1, y % de adversidad = SUM(peso_adverso_no_latam_b2b) / SUM(peso_total_no_latam_b2b) por mes de requestdate_date.
Validado el 2026-11-25 contra la pregunta: oct-26 51,8% (386 hoteles), nov-26 51,1%, sep-26 41,8%.

Valor de cada mes: el % del mes. Mes terminado = cierre ('Cierre'); mes en curso = el RR que se reporta al mapa ('Proyeccion');
meses futuros sin valor. Menos es mejor (es adversidad).

Lo llama daily_sync.py en cada corrida ("Actualizar reales" de Ownia) y publica price_comp_globales_okr.json en la carpeta de Drive del
Daily (+ Ownia). Lo leen el Daily / Tracker (Daily_Dashboard/Codigo.js) y el Hub (Dashboard_B2B_WLs/Codigo_OKR.js).

Uso suelto (no toca Drive):
    python price_comp_mensual_sync.py
"""
import io
import sys
from calendar import monthrange
from datetime import date, datetime
from pathlib import Path

FILE_NAME = "price_comp_globales_okr.json"
SQL_FILE = Path(__file__).resolve().parent / "adversidad_b2b_no_latam_mensual.sql"
MARCADOR = "===== SQL de la card 178823 ====="
MESES_H2 = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]


def query():
    base = SQL_FILE.read_text(encoding="utf-8").split(MARCADOR, 1)[1].strip().rstrip(";")
    # El SQL de la card termina con comentarios de linea: el salto de linea antes del ")" es necesario.
    return ("SELECT date_format(CAST(requestdate_date AS DATE), '%Y-%m') AS ym,\n"
            "  SUM(peso_adverso_no_latam_b2b) AS adverso, SUM(peso_total_no_latam_b2b) AS total, COUNT(DISTINCT oidhotel) AS hoteles\n"
            "FROM (\n" + base + "\n) adv\n"
            "WHERE market_target IN ('Latam', 'No Latam', 'ONA') AND flag_top_21_destino_gb = 1 AND is_hotel = 1\n"
            "GROUP BY 1\nORDER BY 1")


def valores_por_mes(df, hoy):
    """df (ym, adverso, total, hoteles) -> {ym: {pct, hoteles, estado}} para los meses del H2 hasta el mes en curso."""
    cur = "%d-%02d" % (hoy.year, hoy.month)
    por_ym = {str(r.ym): r for r in df.itertuples()}
    meses = {}
    for ym in MESES_H2:
        r = por_ym.get(ym)
        if ym > cur or r is None or not r.total or r.total != r.total or r.adverso != r.adverso:
            continue
        y, m = int(ym[:4]), int(ym[5:])
        estado = "Cierre" if date(y, m, monthrange(y, m)[1]) < hoy else "Proyeccion"
        meses[ym] = {"pct": round(float(r.adverso) / float(r.total) * 100, 2), "hoteles": int(r.hoteles), "estado": estado}
    return meses


def build_payload(fetch, hoy=None):
    hoy = hoy or date.today()
    df = fetch(query(), "Adversidad B2B No Latam mensual (Metabase 180311, KR Price Competitiveness nuevo)")
    meses = valores_por_mes(df, hoy)
    if not meses:   # sin filas del H2: no se sube nada (queda el price_comp_globales_okr.json anterior)
        print("  WARN [Price Comp mensual] la query no trajo meses del H2: no se actualiza el archivo")
        return None
    resumen = ", ".join("%s: %s%% (%s hoteles, %s)" % (k, v["pct"], v["hoteles"], v["estado"]) for k, v in meses.items())
    print("  [Price Comp mensual] " + resumen)
    return {
        "meta": {"generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                 "fuente": "Metabase 180311 sobre la card 178823 (adversidad_b2b_no_latam_mensual.sql)",
                 "regla": "% adversidad del mes; mes terminado = cierre, mes en curso = RR; menos es mejor"},
        "meses": meses,
    }


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Inputs_Planning_PnL"))
    from recurrencia_sync import _fetch_standalone
    build_payload(_fetch_standalone)
