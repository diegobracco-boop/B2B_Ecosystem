"""
pnl_conso.py — los JSON canónicos del P&L contable, desde el consolidador (2026-11-18).

Los scripts que armaban OKR (okr_builder / okr_h2_builder), organic (organic_builder), FCA (fca_builder), el OC de B2B2C del Flow
(flow_oc) y el KR de Income Services de okr_sync bajaban los canónicos de Drive por ID de archivo (budget.json, baseline_actuals+
projections.json, actuals.json, runrate.json, ...). Esos archivos los generaba Inputs_Planning_PnL; ahora el P&L sale de la tabla del
consolidador y Ownia la sirve con el MISMO formato y vocabulario ({meta, cols, rows}: LoB, Canal, Pais, Producto, P&L N1/N2/N3/N5,
P&L Managerial View, Fecha, Monto USD): GET <OWNIA_URL>/ingest/canon/<serie>, con el mismo token que el espejo (ver server/index.js).

Uso, en el punto donde el script baja un canónico de Drive:
    import pnl_conso
    data = pnl_conso.read_canonical(file_id)      # None si ese id NO es un canónico del P&L (p. ej. okr.json): seguir con Drive
    if data is None: ...bajar de Drive como antes...

Reglas:
  - NO cae a Drive en silencio. Si el consolidador no responde o no tiene datos, lanza ConsoError con el motivo (el script ve el error y
    el dato viejo no se mezcla con el nuevo sin que nadie se entere).
  - Config: `credenciales/.env.ownia` (OWNIA_URL, OWNIA_INGEST_TOKEN) o variables de entorno, igual que ownia_publish.py. Dentro del
    contenedor de Ownia (botones "Actualizar") el script habla con el propio servidor por loopback.
  - PNL_FUENTE=drive es la salida de emergencia explícita (solo si el consolidador está caído y alguien lo decide): devuelve None y el
    script baja de Drive. Sin esa variable no hay vuelta atrás automática.
"""
import gzip
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# id del archivo en Drive (carpeta 1XqQPL...) -> serie del consolidador. Son los mismos ids que CANONICAL_IDS_ de P&L_Accounting.
CANON_BY_ID = {
    "1PABNf4XVKdj6eXApr5_yP581ZsD_N9e-": "ac",      # actuals.json
    "1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv": "bl",      # baseline_actuals+projections.json
    "1f2JF8pq7gtpxfdkVzbT9wvamn_ny3RBW": "bg",      # budget.json
    "1UGg60kE397nsGAivtFqI8NX5CVFj1gqO": "rr",      # runrate.json
    "1crqpRTyH14fqX9XdwBTVaKN5rPbE6O84": "fc",      # forecast.json
    "1anL-CsItySxuWTp4FuX69tHsAy9oz4rp": "fbtb",    # forecastbtb.json
    "1Nk56QlEA2hKuWGhfZ1357Eds6DhU8zwC": "lrr",     # lastrunrate.json
    "1zd5gnMFztKiCSgeY-VmsfVOr0LQ6ftGI": "ly",      # actuals_previos_fy26.json
}
TIMEOUT_S = 300


class ConsoError(RuntimeError):
    """El consolidador no pudo dar la serie pedida."""


def _config():
    from ownia_mirror import load_env   # lee credenciales/.env.ownia y las variables de entorno
    cfg = load_env()
    if not cfg.get("OWNIA_URL") or not cfg.get("OWNIA_INGEST_TOKEN"):
        raise ConsoError("Faltan OWNIA_URL / OWNIA_INGEST_TOKEN (credenciales/.env.ownia o variables de entorno): sin eso no se puede leer el "
                         "P&L del consolidador. Salida de emergencia, solo si conso está caído: PNL_FUENTE=drive")
    loopback = re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?(/|$)", cfg["OWNIA_URL"])
    if not cfg["OWNIA_URL"].startswith("https://") and not loopback:
        raise ConsoError("OWNIA_URL tiene que ser https:// (el token viaja en un header)")
    return cfg


def fetch(key):
    """La serie `key` (ac, bl, bg, rr, fc, fbtb, lrr, ly) como dict {meta, cols, rows}."""
    if key not in CANON_BY_ID.values():
        raise ConsoError(f"Serie desconocida: {key}")
    cfg = _config()
    headers = {"Authorization": f"Bearer {cfg['OWNIA_INGEST_TOKEN']}", "Accept-Encoding": "gzip", "User-Agent": "ownia-pnl-conso"}
    if cfg.get("CF_ACCESS_CLIENT_ID"):
        headers["CF-Access-Client-Id"] = cfg["CF_ACCESS_CLIENT_ID"]
        headers["CF-Access-Client-Secret"] = cfg.get("CF_ACCESS_CLIENT_SECRET", "")
    url = cfg["OWNIA_URL"].rstrip("/") + "/ingest/canon/" + key
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            raw = r.read()
            if (r.headers.get("Content-Encoding") or "").lower() == "gzip":
                raw = gzip.decompress(raw)
    except urllib.error.HTTPError as e:
        detalle = e.read().decode("utf-8", "replace")[:300]
        raise ConsoError(f"Ownia respondió {e.code} al pedir la serie '{key}': {detalle}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ConsoError(f"No se pudo hablar con Ownia para la serie '{key}': {e}") from None
    try:
        data = json.loads(raw)
    except ValueError:
        # Típico de Cloudflare Access: devuelve la página de login en vez de la API.
        raise ConsoError(f"Respuesta no-JSON de {url} (¿Cloudflare Access bloqueando el script?): {raw[:200]!r}") from None
    if not isinstance(data, dict) or "cols" not in data or "rows" not in data:
        raise ConsoError(f"La serie '{key}' llegó sin cols/rows: {str(data)[:200]}")
    return data


def read_canonical(file_id, label=None):
    """El canónico que antes se bajaba de Drive con este `file_id`, desde el consolidador. None si ese id no es un canónico del P&L
    (p. ej. okr.json, daily_b2b2c_data.json) o si PNL_FUENTE=drive. Lanza ConsoError si el consolidador no lo puede dar."""
    key = CANON_BY_ID.get(file_id)
    if key is None or os.environ.get("PNL_FUENTE", "").strip().lower() == "drive":
        return None
    data = fetch(key)
    print(f"  [Conso] {label or key}: OK ({len(data['rows']):,} filas)")
    return data
