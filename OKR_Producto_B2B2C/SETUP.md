# Setup — OKR Producto B2B2C

## Paso 1 — Credenciales del Datalake

Si ya corriste `Daily_Dashboard` en esta máquina, `../credenciales/.env.<tu.usuario>` ya existe y este módulo lo reusa — no hace falta nada más.

Si no existe, crear `../credenciales/.env.<tu.usuario>` con:

```
USER=tu_usuario@ar.infra.d
PASSWORD=tu_password
```

## Paso 2 — Instalar dependencias Python

```powershell
pip install pandas pyodbc python-dotenv requests google-auth google-auth-oauthlib
```

## Paso 3 — DSN ODBC

Verificar que exista el DSN "DataLake Treasure ODBC" en Windows (Panel de control → Orígenes de datos ODBC de 64 bits). Si ya corriste `Daily_Dashboard`, ya está configurado.

## Paso 4 — clasp

```powershell
npm install -g @google/clasp
clasp login
```

Usar la cuenta @despegar.com. Esto genera `~/.clasprc.json`, que además reusa `okr_sync.py` para autenticar contra el webapp (KR6) y `setup_drive_token.py` para el token de Drive.

## Paso 5 — Token de Drive (KR6, budget/baseline JSONs)

Correr una sola vez por persona:

```powershell
cd OKR_Producto_B2B2C
python setup_drive_token.py
```

Abre el navegador, autorizás acceso de lectura a Drive, y guarda `../credenciales/drive_token.<tu.usuario>.json`.

## Paso 6 — Primera corrida manual

```powershell
cd OKR_Producto_B2B2C
python okr_sync.py
```

Tarda ~2-4 minutos. Al finalizar: genera `okr_data.js`, hace `clasp push --force`, `clasp deploy` al deployment fijo, e invalida el cache del dashboard.

## Paso 7 — Programar con Task Scheduler (automático diario 08:00)

1. Buscar "Programador de tareas" en Windows.
2. "Crear tarea básica" → nombre: "OKR Sync".
3. Trigger: diariamente a las 08:00 hs.
4. Acción: "Iniciar un programa"
   - Programa: `python`
   - Argumentos: la ruta completa a `okr_sync.py` dentro de este módulo
   - Iniciar en: la carpeta `OKR_Producto_B2B2C`
5. La tarea debe correr como el usuario dueño de las credenciales (acceso al DSN ODBC y a `~/.clasprc.json`).

## Identificadores clave (no cambiar sin avisar)

- Apps Script Project ID: `1FOBt3E_IQhWHqQtslKaVdE07jIA3slZB3_aRJTPNUIOINNUS8MMDPl1M`
- Webapp Deployment ID (URL fija del dashboard): `AKfycbz1KVq_b2V8UBEaXvcqJmlvS8e-gd2FAwQOcBV91rABnK7Lm33fTcYMPr_f7pdqNiCI`
- Google Sheet P&L (KR6): `1RVmTXDyyugCUXJ0f6JG_croNxWNLlOLm4eAs8F52u2c`
