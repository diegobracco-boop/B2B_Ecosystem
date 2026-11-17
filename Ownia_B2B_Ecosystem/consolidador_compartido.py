# Cliente del consolidador (capa compartida). Copiar sin cambios.
import json
import os
import threading
import time
from contextlib import contextmanager
from datetime import date, datetime, time as dtime
from decimal import Decimal

import boto3
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor

# Limites de sesion. Si el admin del consolidador pudo fijarlos en tu usuario,
# esto los repite; si no pudo, esto es lo que los aplica.
SESSION_OPTIONS = ("-c statement_timeout=120000 -c idle_in_transaction_session_timeout=60000 "
                   "-c lock_timeout=5000")
VERSION_CHECK_SECONDS = 30


def _plain(value):
    """Decimal -> float y fechas -> texto ISO: tipos que json.dumps acepta."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date, dtime)):
        return value.isoformat()
    return value


def _plain_row(row):
    return {k: _plain(v) for k, v in row.items()}


class _IAMPool(pool.ThreadedConnectionPool):
    def __init__(self, minconn, maxconn, host, port, user, dbname, app_name):
        self._cfg = dict(host=host, port=port, user=user, dbname=dbname)
        self._app_name = app_name
        self._rds = boto3.client("rds")
        super().__init__(minconn, maxconn)

    def _connect(self, key=None):
        token = self._rds.generate_db_auth_token(
            DBHostname=self._cfg["host"], Port=self._cfg["port"], DBUsername=self._cfg["user"])
        conn = psycopg2.connect(password=token, sslmode="require", connect_timeout=10,
                                application_name=self._app_name, options=SESSION_OPTIONS,
                                **self._cfg)
        conn.autocommit = True
        if key is not None:
            self._used[key] = conn
            self._rused[id(conn)] = key
        else:
            self._pool.append(conn)
        return conn


class Consolidador:
    def __init__(self, *, host=None, port=None, user=None, dbname=None,
                 minconn=1, maxconn=5, app_name=None):
        secrets = json.loads(os.environ.get("APP_SECRETS", "{}"))
        dbname = dbname or secrets.get("CONSOLIDADOR_DB_NAME")
        if not dbname:
            raise RuntimeError("Falta CONSOLIDADOR_DB_NAME (nombre de la base del consolidador)")
        self._pool = _IAMPool(
            minconn, maxconn,
            host=host or secrets["DB_HOST"], port=int(port or secrets["DB_PORT"]),
            user=user or secrets["DB_USER"], dbname=dbname,
            app_name=(app_name or secrets.get("DB_USER") or "consumidor")[:60],
        )
        self._cache = {}
        self._versions = {"at": 0.0, "data": {}}
        self._lock = threading.Lock()

    @contextmanager
    def _conn(self):
        conn = self._pool.getconn()
        broken = False
        try:
            yield conn
        except (psycopg2.OperationalError, psycopg2.InterfaceError):
            broken = True  # failover de Aurora o conexion cortada: se descarta
            raise
        finally:
            if not broken and not conn.closed:
                if not conn.autocommit:
                    conn.rollback()
                    conn.autocommit = True
            self._pool.putconn(conn, close=broken or bool(conn.closed))

    def consultar(self, sql, params=None):
        """Una consulta, resultado como lista de dicts. Reintenta una vez si se
        corto la conexion (por ejemplo, un failover de Aurora)."""
        for attempt in (1, 2):
            try:
                with self._conn() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(sql, params)
                    return [_plain_row(r) for r in cur.fetchall()]
            except (psycopg2.OperationalError, psycopg2.InterfaceError):
                if attempt == 2:
                    raise

    def iterar(self, sql, params=None, lote=10_000):
        """Lee de a `lote` filas con un cursor del lado del servidor: sirve para
        millones de filas sin cargarlas todas en memoria."""
        with self._conn() as conn:
            conn.autocommit = False
            with conn.cursor(name="consolidador_iter", cursor_factory=RealDictCursor) as cur:
                cur.itersize = lote
                cur.execute(sql, params)
                while True:
                    rows = cur.fetchmany(lote)
                    if not rows:
                        break
                    yield [_plain_row(r) for r in rows]

    def versiones(self, *, fresh=False):
        """{dataset: {version, publicado_en, filas, columnas}} -- tabla chiquita.
        `publicado_en` llega como texto ISO 8601. Devuelve una copia."""
        with self._lock:
            if not fresh and time.monotonic() - self._versions["at"] < VERSION_CHECK_SECONDS:
                return {k: dict(v) for k, v in self._versions["data"].items()}
        rows = self.consultar("SELECT dataset, version, publicado_en, filas, columnas "
                              "FROM compartido.versiones")
        data = {r.pop("dataset"): r for r in rows}
        with self._lock:
            self._versions = {"at": time.monotonic(), "data": data}
        return {k: dict(v) for k, v in data.items()}

    def version(self, dataset):
        info = self.versiones().get(dataset)
        return info["version"] if info else None

    def cacheado(self, dataset, sql, params=None):
        """Como consultar(), pero guarda el resultado en memoria y solo vuelve a
        la base cuando `dataset` tiene una version nueva publicada.

        Devuelve copias de las filas: si el codigo que llama las modifica
        (renombra o saca una columna), el cache queda intacto para la proxima."""
        version = self.version(dataset)
        key = (dataset, sql, json.dumps(params, default=str))
        with self._lock:
            hit = self._cache.get(key)
            if hit and hit[0] == version:
                return [dict(r) for r in hit[1]]
        rows = self.consultar(sql, params)
        with self._lock:
            # Una sola version por dataset en memoria.
            for k in [k for k, v in self._cache.items() if k[0] == dataset and v[0] != version]:
                del self._cache[k]
            self._cache[key] = (version, rows)
        return [dict(r) for r in rows]
