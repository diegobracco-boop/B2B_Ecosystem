"""Lectura de compartido.app_b2b_ecosystem (consolidador del P&L) para el servidor Node.

Lo lanza server/consolidador.js, uno por pedido, y devuelve JSON por stdout:
  python consolidador_leer.py versiones   -> estado de publicación de la tabla (o null si no está)
  python consolidador_leer.py resumen     -> valor sumado por pais y mes

Solo SELECT, con SQL fijo (nada del pedido llega al SQL). La tabla ya viene filtrada y sumada por el
consolidador: si hacen falta otros datos se edita el pedido de acceso, no esta consulta.
Solo corre dentro de Ownia (usa el token IAM de la app): en local falla siempre.
"""
import json
import sys

from consolidador_compartido import Consolidador

DATASET = "app_b2b_ecosystem"
TABLA = "compartido.app_b2b_ecosystem"
_cdb = None


def cdb():  # creado en el primer uso; reconecta solo aunque pasen semanas
    global _cdb
    if _cdb is None:
        _cdb = Consolidador()
    return _cdb


def versiones():
    info = cdb().versiones(fresh=True).get(DATASET)
    return {"dataset": DATASET, **info} if info else None


def por_pais_y_mes():
    return cdb().cacheado(
        DATASET,
        f"SELECT pais, mes, sum(valor) AS valor FROM {TABLA} GROUP BY pais, mes")


DIMENSIONES = ["pais", "lob", "channel", "product", "linea_p&l_-_nivel_2", "linea_p&l_-_nivel_3"]


def dimensiones():
    """Para armar y validar el mapeo contra los JSON de Drive: qué hay en la tabla, sin las filas.
    combos = filas, suma y rango de valor por escenario/año/mes; valores = distintos de cada dimensión."""
    c = cdb()
    out = {"combos": c.cacheado(
        DATASET,
        f"SELECT scenario, year, mes, count(*) AS filas, sum(valor) AS valor FROM {TABLA} "
        "GROUP BY scenario, year, mes ORDER BY scenario, year, mes"), "valores": {}}
    for d in DIMENSIONES:
        out["valores"][d] = c.cacheado(
            DATASET, f'SELECT "{d}" AS valor, count(*) AS filas FROM {TABLA} GROUP BY "{d}" ORDER BY 2 DESC')
    return out


CUBO_COLS = ["scenario", "year", "mes", "pais", "lob", "channel", "product", "n2", "valor"]


def cubo():
    """La tabla agregada por las dimensiones que usa el P&L Accounting (sin nivel 3 ni las columnas organic).
    Filas como listas (no dicts) para que el JSON pese menos. Lo arma pnl-consolidador.js al formato de los canónicos."""
    c = cdb()
    # Drive separa "alianzas financieras" de Sourcing: en la tabla es una línea (nivel 4) dentro de nivel 2 = Sourcing.
    n2 = "CASE WHEN \"linea_p&l\" = 'Alianzas Financieras' THEN 'Alianzas Financieras' ELSE \"linea_p&l_-_nivel_2\" END"
    rows = c.consultar(
        f"SELECT scenario, year, mes, pais, lob, channel, product, {n2} AS n2, sum(valor) AS valor "
        # P&L Accounting solo usa B2B y B2B2C (descarta B2C): traer B2C triplicaría el cubo sin usarse.
        f"FROM {TABLA} WHERE lob IN ('B2B', 'B2B2C') GROUP BY scenario, year, mes, pais, lob, channel, product, {n2}")
    return {"version": c.version(DATASET), "cols": CUBO_COLS, "rows": [[r[k] for k in CUBO_COLS] for r in rows]}


def detalle():
    """Para cerrar mapeos: ACT del FY27 en meses cerrados, por producto, línea nivel 2 y línea (el detalle que el nivel 2 junta).
    Lo ve el equipo en /consolidador/detalle; las sumas se comparan con los totales por línea de /consolidador/comparar."""
    return cdb().cacheado(
        DATASET,
        'SELECT product, "linea_p&l_-_nivel_2" AS n2, "linea_p&l" AS linea, count(*) AS filas, sum(valor) AS valor '
        f"FROM {TABLA} WHERE scenario = 'ACT' AND year = 'FY27' AND mes BETWEEN 4 AND 10 "
        'GROUP BY product, "linea_p&l_-_nivel_2", "linea_p&l"')


def control():
    """Control de que la tabla no mezcla versiones: la tabla no tiene columna `version`, así que si el pedido incluye más de una
    (AS REPORTED, BIMO, PPA) se SUMARÍAN entre sí sin avisar. Gross Bookings del ACT del FY27, meses 4 a 10, por LoB, más la
    cantidad de filas por LoB y escenario: se compara contra un valor conocido (B2B + B2B2C = 1.022.814.275 con la versión 2)."""
    c = cdb()
    return {
        "gb_act_fy27_m4_10_por_lob": c.consultar(
            f"SELECT lob, count(*) AS filas, sum(valor) AS valor FROM {TABLA} WHERE scenario = 'ACT' AND year = 'FY27' "
            "AND mes BETWEEN 4 AND 10 AND \"linea_p&l_-_nivel_2\" = 'Gross Bookings' GROUP BY lob ORDER BY lob"),
        "filas_por_lob_y_escenario": c.consultar(
            f"SELECT lob, scenario, year, count(*) AS filas FROM {TABLA} GROUP BY lob, scenario, year ORDER BY lob, scenario, year"),
    }


COMANDOS = {"versiones": versiones, "resumen": por_pais_y_mes, "dimensiones": dimensiones, "cubo": cubo, "detalle": detalle, "control": control}


def main(argv):
    if len(argv) != 2 or argv[1] not in COMANDOS:
        print("uso: consolidador_leer.py {%s}" % "|".join(COMANDOS), file=sys.stderr)
        return 2
    try:
        print(json.dumps(COMANDOS[argv[1]]()))
    except Exception as e:  # noqa: BLE001 -- una línea legible para el log del servidor
        print(f"{type(e).__name__}: {e}".splitlines()[0], file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
