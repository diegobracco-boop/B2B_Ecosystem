"""Lectura de la tabla del P&L en el consolidador (compartido.<CONSOLIDADOR_DATASET>) para el servidor Node.

Lo lanza server/consolidador.js, uno por pedido, y devuelve JSON por stdout:
  python consolidador_leer.py versiones   -> estado de publicación de la tabla (o null si no está)
  python consolidador_leer.py resumen     -> valor sumado por pais y mes

Solo SELECT, con SQL fijo (nada del pedido llega al SQL). La tabla ya viene filtrada y sumada por el
consolidador: si hacen falta otros datos se edita el pedido de acceso, no esta consulta.
Solo corre dentro de Ownia (usa el token IAM de la app): en local falla siempre.
"""
import json
import os
import re
import sys

from consolidador_compartido import Consolidador


def _dataset():
    """Nombre del dataset/tabla del consolidador. Cada pedido aprobado que conso arma aparte lleva su propio nombre (el #166 salió como
    `app_b2b_ecosystem_166`), así que se elige con APP_SECRETS.CONSOLIDADOR_DATASET (por defecto, el original). Solo letras, números y _."""
    ds = str(json.loads(os.environ.get("APP_SECRETS", "{}")).get("CONSOLIDADOR_DATASET") or "app_b2b_ecosystem")
    if not re.fullmatch(r"[a-z0-9_]{1,63}", ds):
        raise RuntimeError("CONSOLIDADOR_DATASET inválido: solo minúsculas, números y _")
    return ds


DATASET = _dataset()
TABLA = f"compartido.{DATASET}"
_cdb = None


def cdb():  # creado en el primer uso; reconecta solo aunque pasen semanas
    global _cdb
    if _cdb is None:
        _cdb = Consolidador()
    return _cdb


def tiene_version():
    """La tabla solo puede separar versiones (AS REPORTED, BIMO, PPA) si el pedido abrió la columna `version`. Si no la abrió y el
    pedido incluye varias, sus montos se SUMAN entre sí sin avisar (pasó con la versión 3 del 2026-11-17)."""
    info = cdb().versiones(fresh=True).get(DATASET) or {}
    return "version" in [(x.get("name") if isinstance(x, dict) else x) for x in (info.get("columnas") or [])]


def versiones():
    info = cdb().versiones(fresh=True).get(DATASET)
    return {"dataset": DATASET, **info} if info else None


def por_pais_y_mes():
    return cdb().cacheado(
        DATASET,
        f"SELECT pais, mes, sum(valor) AS valor FROM {TABLA} GROUP BY pais, mes")


# Con la columna `version` abierta, el P&L toma solo la versión oficial (AS REPORTED); lo demás son ajustes que el pipeline de Drive
# aplica aparte (SIN PPA = Reverso AxI) o vistas que el módulo no usa.
VERSION_OFICIAL = " AND version = 'AS REPORTED'"
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
    con_version = tiene_version()
    # Drive separa "alianzas financieras" de Sourcing: en la tabla es una línea (nivel 4) dentro de nivel 2 = Sourcing.
    n2 = "CASE WHEN \"linea_p&l\" = 'Alianzas Financieras' THEN 'Alianzas Financieras' ELSE \"linea_p&l_-_nivel_2\" END"
    rows = c.consultar(
        f"SELECT scenario, year, mes, pais, lob, channel, product, {n2} AS n2, sum(valor) AS valor "
        # P&L Accounting solo usa B2B y B2B2C (descarta B2C): traer B2C triplicaría el cubo sin usarse.
        f"FROM {TABLA} WHERE lob IN ('B2B', 'B2B2C'){VERSION_OFICIAL if con_version else ''} "
        f"GROUP BY scenario, year, mes, pais, lob, channel, product, {n2}")
    return {"version": c.version(DATASET), "tieneColumnaVersion": con_version, "cols": CUBO_COLS,
            "rows": [[r[k] for k in CUBO_COLS] for r in rows]}


def detalle():
    """Para cerrar mapeos: ACT del FY27 en meses cerrados, por producto, línea nivel 2 y línea (el detalle que el nivel 2 junta).
    Lo ve el equipo en /consolidador/detalle; las sumas se comparan con los totales por línea de /consolidador/comparar."""
    return cdb().cacheado(
        DATASET,
        'SELECT product, "linea_p&l_-_nivel_2" AS n2, "linea_p&l" AS linea, count(*) AS filas, sum(valor) AS valor '
        f"FROM {TABLA} WHERE lob IN ('B2B', 'B2B2C'){VERSION_OFICIAL if tiene_version() else ''} AND scenario = 'ACT' AND year = 'FY27' AND mes BETWEEN 4 AND 10 "
        'GROUP BY product, "linea_p&l_-_nivel_2", "linea_p&l"')


def control():
    """Control de que la tabla no mezcla versiones. Gross Bookings del ACT del FY27 (meses 4 a 10) por LoB y, si la tabla abre la
    columna `version`, por versión; más filas por LoB/escenario/año. Sin la columna, un total más alto que el conocido
    (B2B + B2B2C = 1.022.814.275 con la versión 2) delata que se sumaron versiones."""
    c = cdb()
    con_version = tiene_version()
    v = ", version" if con_version else ""
    return {
        "tieneColumnaVersion": con_version,
        "gb_act_fy27_m4_10": c.consultar(
            f"SELECT lob{v}, count(*) AS filas, sum(valor) AS valor FROM {TABLA} WHERE scenario = 'ACT' AND year = 'FY27' "
            f"AND mes BETWEEN 4 AND 10 AND \"linea_p&l_-_nivel_2\" = 'Gross Bookings' GROUP BY lob{v} ORDER BY lob{v}"),
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
