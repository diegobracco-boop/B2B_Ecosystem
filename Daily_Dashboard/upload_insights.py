# -*- coding: utf-8 -*-
"""
upload_insights.py
==================
Sube weekly_insights.json a Google Drive (carpeta DailyDashboard).
Correr después de que Claude genere los insights con /generar-insights.
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json
from pathlib import Path
from datetime import datetime

DRIVE_FOLDER_ID    = '1lWzfqweyV6Kz1ERkL85ikFcmzmKwGwwh'
INSIGHTS_FILE_NAME = 'weekly_insights.json'
BASE_DIR           = Path(__file__).resolve().parent
INPUT_PATH         = BASE_DIR / 'weekly_insights.json'
DRIVE_SCOPES       = ['https://www.googleapis.com/auth/drive']


def _get_drive_service():
    from daily_sync import _get_drive_service as _ds_get_drive
    return _ds_get_drive()


def upload():
    if not INPUT_PATH.exists():
        print(f'ERROR: No se encontró {INPUT_PATH}')
        print('  Correr primero /generar-insights en Claude Code.')
        sys.exit(1)

    content = INPUT_PATH.read_bytes()
    print(f'Subiendo {INSIGHTS_FILE_NAME} ({len(content)//1024} KB) a Drive...')

    from googleapiclient.http import MediaInMemoryUpload
    service = _get_drive_service()
    media   = MediaInMemoryUpload(content, mimetype='application/json', resumable=False)

    results  = service.files().list(
        q=f"name='{INSIGHTS_FILE_NAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed=false",
        fields='files(id,name)'
    ).execute()
    existing = results.get('files', [])

    if existing:
        service.files().update(fileId=existing[0]['id'], media_body=media).execute()
        print(f'  OK Drive: archivo actualizado ({INSIGHTS_FILE_NAME})')
    else:
        service.files().create(
            body={'name': INSIGHTS_FILE_NAME, 'parents': [DRIVE_FOLDER_ID]},
            media_body=media, fields='id'
        ).execute()
        print(f'  OK Drive: archivo creado ({INSIGHTS_FILE_NAME})')

    print(f'OK Completado: {datetime.now().strftime("%d-%m-%Y %H:%M")}')


if __name__ == '__main__':
    upload()
