# -*- coding: utf-8 -*-
"""
Corre UNA SOLA VEZ para obtener un token de Drive con scope de lectura.
Abre el browser para autorizar, y guarda drive_token.json en el mismo directorio.

Uso: python setup_drive_token.py
"""
import os, json
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_win_user  = os.environ.get("USERNAME", "").lower()
TOKEN_PATH  = os.path.join(SCRIPT_DIR, "..", "credenciales", f"drive_token.{_win_user}.json")

# Reusar client_id/secret del clasp (mismo proyecto GCP)
clasprc = json.load(open(os.path.expanduser("~/.clasprc.json")))
tok = clasprc["tokens"]["default"]

client_config = {
    "installed": {
        "client_id":     tok["client_id"],
        "client_secret": tok["client_secret"],
        "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"],
        "auth_uri":      "https://accounts.google.com/o/oauth2/auth",
        "token_uri":     "https://oauth2.googleapis.com/token",
    }
}

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
creds = flow.run_local_server(port=0)

with open(TOKEN_PATH, "w") as f:
    f.write(creds.to_json())

print(f"OK Token guardado en: {TOKEN_PATH}")
