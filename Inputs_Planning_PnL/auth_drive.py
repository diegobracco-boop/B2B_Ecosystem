"""
Autorización única de Google Drive (scope completo) para los uploaders del P&L.
Correr UNA sola vez por persona:   python auth_drive.py
Abre el navegador, autorizás con tu cuenta @despegar.com y guarda token_drive.json.
Después, run_all corre silencioso.
"""
import os
from google_auth_oauthlib.flow import InstalledAppFlow

_DIR = os.path.dirname(os.path.abspath(__file__))
SCOPES = ["https://www.googleapis.com/auth/drive"]
creds_file = os.path.join(_DIR, "credentials_drive.json")

if not os.path.exists(creds_file):
    raise SystemExit("Falta credentials_drive.json en esta carpeta. Pedíselo al owner del proyecto.")

flow  = InstalledAppFlow.from_client_secrets_file(creds_file, SCOPES)
creds = flow.run_local_server(port=0, prompt="select_account consent")
with open(os.path.join(_DIR, "token_drive.json"), "w", encoding="utf-8") as f:
    f.write(creds.to_json())
print("OK -> token_drive.json guardado. Ya podes correr run_all.")
