"""
pnl_common.py — Rutas y autenticación compartidas para los uploaders del P&L.
Portable multi-usuario: resuelve la carpeta OneDrive sin importar el usuario,
auto-detecta el forecast del mes más reciente, y autentica a Drive con scope
COMPLETO (credentials_drive.json + token_drive.json) para que cualquiera del
equipo pueda sobrescribir los JSON en Drive.
"""
import os
import re
import json
import datetime
from pathlib import Path

_DIR = os.path.dirname(os.path.abspath(__file__))
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]


# ── Rutas portables ──────────────────────────────────────────────────────────
def _onedrive_root():
    """Raíz de OneDrive del usuario (no hardcodeada)."""
    od = os.environ.get("OneDriveCommercial") or os.environ.get("OneDrive")
    if not od:
        od = os.path.join(os.path.expanduser("~"), "OneDrive - despegar365")
    return od


def get_base_dir():
    """Carpeta OneDrive compartida del equipo, resuelta por usuario (no hardcodeada)."""
    return os.path.join(_onedrive_root(), "Control de Gestión - 2026-27", "B2B & WLs")


def get_pbi_inputs_dir():
    """Carpeta 'Planning-PBI - Inputs Power Bi' (bases raw de proyecciones/actuals)."""
    return os.path.join(_onedrive_root(), "Planning-PBI - Inputs Power Bi")


def get_glosario_path():
    return os.path.join(get_base_dir(), "Proyectos IA", "BITUBIA", "Glosario.xlsx")


def get_reverso_axi_path():
    return os.path.join(get_pbi_inputs_dir(), "Actuals", "Reverso AxI.xlsx")


def get_toqan_dir():
    return os.path.join(get_base_dir(), "Proyectos IA", "BITUBIA", "Output Toqan")


def get_revision_dir():
    return os.path.join(get_base_dir(), "Proyectos IA", "Codigo - revision P&L")


# Versión del modelo Forecast vigente. ACTUALIZAR A MANO cuando el equipo confirme
# uno nuevo. NO auto-detectar la carpeta más reciente: puede haber borradores/olvidados
# (ej. 2026.07.21 quedó sin usar). El vigente es el 2026.07.14.
FORECAST_VERSION = "2026.07.14"

def get_models_dir():
    """Subcarpeta Forecast del modelo VIGENTE (fija, ver FORECAST_VERSION)."""
    return os.path.join(get_base_dir(), "Forecast", FORECAST_VERSION)


# ── Auth Drive (scope completo, compartible por el equipo) ────────────────────
def get_drive_service():
    """
    Cliente de Drive con scope 'drive' completo desde credentials_drive.json +
    token_drive.json (junto a este archivo). Permite sobrescribir archivos creados
    por otros usuarios (necesario para que corra todo el equipo).
    Fallback: token de clasp (~/.clasprc.json, scope drive.file — solo archivos propios).
    """
    from googleapiclient.discovery import build
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    creds_file = os.path.join(_DIR, "credentials_drive.json")
    token_file = os.path.join(_DIR, "token_drive.json")

    if os.path.exists(creds_file):
        from google_auth_oauthlib.flow import InstalledAppFlow
        creds = None
        if os.path.exists(token_file):
            creds = Credentials.from_authorized_user_file(token_file, DRIVE_SCOPES)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(creds_file, DRIVE_SCOPES)
                creds = flow.run_local_server(port=0)
            with open(token_file, "w", encoding="utf-8") as f:
                f.write(creds.to_json())
        return build("drive", "v3", credentials=creds)

    # Fallback: clasp token (scope drive.file)
    clasprc = Path.home() / ".clasprc.json"
    if not clasprc.exists():
        raise FileNotFoundError(
            "Falta credentials_drive.json (recomendado) o ~/.clasprc.json. "
            "Correr auth_drive.py una vez, o 'clasp login'."
        )
    tok = json.loads(clasprc.read_text())["tokens"]["default"]
    creds = Credentials(
        token=tok["access_token"], refresh_token=tok["refresh_token"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=tok["client_id"], client_secret=tok["client_secret"],
        expiry=datetime.datetime.utcfromtimestamp(tok["expiry_date"] / 1000),
    )
    if not creds.valid:
        creds.refresh(Request())
    return build("drive", "v3", credentials=creds)
