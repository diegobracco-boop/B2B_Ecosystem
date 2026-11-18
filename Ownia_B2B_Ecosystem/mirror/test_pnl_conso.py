"""Tests de pnl_conso.py: el cliente Python de /ingest/canon (corre con `python -m unittest` desde esta carpeta; test/pnl-conso-py.test.js lo
lanza dentro de `npm test`). Levanta un servidor HTTP local, como el que haría Ownia por loopback."""
import gzip
import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

import pnl_conso

CANON = {"meta": {"concepto": "bg"}, "cols": ["LoB", "Pais", "Fecha", "Monto USD"], "rows": [["b2b2c", "brasil", "2026-04-01", 5.0]]}
VISTO = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        VISTO.append((self.path, self.headers.get("Authorization")))
        if self.headers.get("Authorization") != "Bearer tok":
            return self._send(401, {"error": "Token inválido"})
        if self.path.endswith("/rr"):
            return self._send(503, {"error": 'El consolidador no armó la serie "rr"'})
        if self.path.endswith("/ly"):
            body = b"<html>login</html>"
            self.send_response(200)
            self.end_headers()
            return self.wfile.write(body)
        if self.path.endswith("/lrr"):
            return self._send(200, {"sin": "cols"})
        return self._send(200, CANON, gz="gzip" in (self.headers.get("Accept-Encoding") or ""))

    def _send(self, status, obj, gz=False):
        body = json.dumps(obj).encode()
        if gz:
            body = gzip.compress(body)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        if gz:
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        self.wfile.write(body)


class PnlConsoTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}/b2b-ecosystem"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def env(self, **kw):
        base = {"OWNIA_URL": self.url, "OWNIA_INGEST_TOKEN": "tok"}
        base.update(kw)
        return mock.patch.dict(os.environ, base, clear=False)

    def setUp(self):
        VISTO.clear()
        os.environ.pop("PNL_FUENTE", None)

    def test_todos_los_ids_de_drive_tienen_su_serie(self):
        self.assertEqual(sorted(pnl_conso.CANON_BY_ID.values()), ["ac", "bg", "bl", "fbtb", "fc", "lrr", "ly", "rr"])
        self.assertEqual(pnl_conso.CANON_BY_ID["1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW"], "bg")        # budget.json
        self.assertEqual(pnl_conso.CANON_BY_ID["1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv"], "bl")        # baseline_actuals+projections.json

    def test_read_canonical_pide_la_serie_con_el_token_y_acepta_gzip(self):
        with self.env():
            data = pnl_conso.read_canonical("1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW", "budget.json")
        self.assertEqual(data, CANON)
        self.assertEqual(VISTO, [("/b2b-ecosystem/ingest/canon/bg", "Bearer tok")])

    def test_un_id_que_no_es_canonico_devuelve_none_sin_tocar_ownia(self):
        with self.env():
            self.assertIsNone(pnl_conso.read_canonical("1cEidr8aoYgm4S7ugm05Wv-SMnz8GbtUj", "okr.json"))   # okr.json: sigue en Drive
        self.assertEqual(VISTO, [])

    def test_sin_config_lanza_con_el_motivo_y_no_cae_a_drive(self):
        with mock.patch("ownia_mirror.load_env", return_value={}):
            with self.assertRaisesRegex(pnl_conso.ConsoError, "OWNIA_URL / OWNIA_INGEST_TOKEN"):
                pnl_conso.read_canonical("1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW")

    def test_token_incorrecto_y_serie_sin_datos_lanzan_con_lo_que_dijo_ownia(self):
        with self.env(OWNIA_INGEST_TOKEN="malo"):
            with self.assertRaisesRegex(pnl_conso.ConsoError, "401"):
                pnl_conso.fetch("bg")
        with self.env():
            with self.assertRaisesRegex(pnl_conso.ConsoError, r'503.*rr'):
                pnl_conso.fetch("rr")

    def test_respuestas_raras_lanzan(self):
        with self.env():
            with self.assertRaisesRegex(pnl_conso.ConsoError, "no-JSON"):
                pnl_conso.fetch("ly")
            with self.assertRaisesRegex(pnl_conso.ConsoError, "sin cols/rows"):
                pnl_conso.fetch("lrr")

    def test_salida_de_emergencia_explicita(self):
        with self.env(PNL_FUENTE="drive"):
            self.assertIsNone(pnl_conso.read_canonical("1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW"))
        self.assertEqual(VISTO, [])

    def test_http_solo_por_loopback(self):
        with mock.patch("ownia_mirror.load_env", return_value={"OWNIA_URL": "http://ownia.despegar.io/b2b-ecosystem", "OWNIA_INGEST_TOKEN": "tok"}):
            with self.assertRaisesRegex(pnl_conso.ConsoError, "https"):
                pnl_conso.fetch("bg")

    def test_servidor_caido_lanza(self):
        with self.env(OWNIA_URL="http://127.0.0.1:9/b2b-ecosystem"):
            with self.assertRaisesRegex(pnl_conso.ConsoError, "No se pudo hablar con Ownia"):
                pnl_conso.fetch("bg")


if __name__ == "__main__":
    unittest.main()
