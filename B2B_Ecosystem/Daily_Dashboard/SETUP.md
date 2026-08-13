# Setup — Daily Dashboard B2B2C

## Paso 1 — Crear el archivo .env (credenciales del Datalake)

Abrí PowerShell y ejecutá (reemplazando con tus credenciales reales):

```powershell
$env_content = "USER=tu_usuario_datalake`nPASSWORD=tu_password_datalake"
New-Item -ItemType Directory -Force "C:\Users\diego.bracco\Proyectos IA\envs" | Out-Null
Set-Content -Path "C:\Users\diego.bracco\Proyectos IA\envs\.env" -Value $env_content -Encoding UTF8
```

El usuario y password son los mismos que usás para conectarte al Datalake
(los mismos que tiene el equipo de Mariano Bujia en su .env).

---

## Paso 2 — Instalar librerías Python

```powershell
pip install -r "C:\Users\diego.bracco\Proyectos IA\Daily_Dashboard\requirements.txt"
```

---

## Paso 3 — Configurar Google Drive API (una sola vez)

1. Ir a: https://console.cloud.google.com/
2. Crear proyecto nuevo (ej. "DailyDashboard")
3. Menú izquierdo → "APIs y servicios" → "Biblioteca"
4. Buscar "Google Drive API" → Habilitar
5. Menú izquierdo → "APIs y servicios" → "Credenciales"
6. "+ Crear credenciales" → "ID de cliente OAuth 2.0"
7. Tipo de aplicación: "Aplicación de escritorio" → Nombre: "DailySync"
8. Descargar el JSON que genera → renombrarlo a `credentials_drive.json`
9. Copiarlo a: `C:\Users\diego.bracco\Proyectos IA\Daily_Dashboard\`

---

## Paso 4 — Primera ejecución (autenticación)

```powershell
cd "C:\Users\diego.bracco\Proyectos IA\Daily_Dashboard"
python daily_sync_b2b2c.py
```

La primera vez abre el navegador para autorizar el acceso a Drive con tu cuenta
@despegar.com. Aceptás una sola vez y queda guardado en `token_drive.pkl`.
Las siguientes ejecuciones son silenciosas.

---

## Paso 5 — Programar con Task Scheduler (opcional)

1. Buscar "Programador de tareas" en Windows
2. "Crear tarea básica"
3. Nombre: "Daily Dashboard Sync"
4. Trigger: Diariamente a las 08:00
5. Acción: "Iniciar un programa"
   - Programa: `python`
   - Argumentos: `"C:\Users\diego.bracco\Proyectos IA\Daily_Dashboard\daily_sync_b2b2c.py"`
6. Finalizar

---

## Estructura de archivos

```
Daily_Dashboard/
├── daily_sync_b2b2c.py       ← script principal
├── credentials_drive.json    ← bajar de Cloud Console (paso 3)
├── token_drive.pkl            ← se crea automáticamente al primera login
├── requirements.txt
└── SETUP.md                   ← este archivo
```
