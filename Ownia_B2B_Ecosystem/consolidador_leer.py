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


COMANDOS = {"versiones": versiones, "resumen": por_pais_y_mes}


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
