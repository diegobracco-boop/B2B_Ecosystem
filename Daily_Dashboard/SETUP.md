# Setup — Daily Dashboard B2B2C

## Paso 1 — Crear el archivo de credenciales del Datalake

```
credenciales/.env.<nombre.apellido>
```

Con el formato:
```
USER=nombre.apellido@ar.infra.d
PASSWORD=tu_password
```

Es local y está gitignoreado — nunca se sube al repo. Actualizar `RUTA_ENV` en
`daily_sync.py` si hace falta apuntarlo a un usuario nuevo.

---

## Paso 2 — Instalar librerías Python

```powershell
pip install -r "Daily_Dashboard\requirements.txt"
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
9. Copiarlo a `Daily_Dashboard/` (gitignoreado, no se sube)

---

## Paso 4 — Primera ejecución (autenticación)

```powershell
cd Daily_Dashboard
python daily_sync.py
```

La primera vez abre el navegador para autorizar el acceso a Drive con tu cuenta
@despegar.com. Aceptás una sola vez y queda guardado en `token_drive.json`.
Las siguientes ejecuciones son silenciosas.

---

## Paso 5 — Actualizar reales

Gregorio y Tiago tienen Task Scheduler configurado en sus máquinas (trigger
diario 08:00 hs) para correr `auto_update_reales.ps1` solos. **En esta máquina
no hay tarea programada** (verificado 2026-09-22) — acá es proceso manual.
Cuando haga falta refrescar los datos desde esta máquina:

```powershell
cd Daily_Dashboard
.\auto_update_reales.ps1
```

Este script encadena `daily_sync.py` → git commit/push (solo si hay cambios
de código en `Daily_Dashboard/`) → `clasp push` → `clasp deploy -i` al
deployment de producción. Cada paso corta la cadena si el anterior falla, así
que nunca publica datos rotos. El log queda en `Daily_Dashboard/logs/`.

Si no hay logs nuevos en varios días (revisar `Daily_Dashboard/logs/` y
`git log --grep="auto-update"`), puede ser que las tareas de Gregorio/Tiago
se hayan trabado (VPN, credenciales vencidas, laptop apagada) — confirmarlo
con ellos antes de asumir que el dato en Drive está al día.

Para configurar Task Scheduler en una máquina nueva: `schtasks /create` con
trigger diario y acción `powershell.exe -File auto_update_reales.ps1`
(pedirle a Claude Code que arme el comando exacto).

---

## Estructura de archivos

```
Daily_Dashboard/
├── daily_sync.py              ← script principal (Datalake → JSON → Drive)
├── auto_update_reales.ps1     ← encadena daily_sync + git + clasp (manual, ver Paso 5)
├── credentials_drive.json     ← bajar de Cloud Console (paso 3), gitignoreado
├── token_drive.json           ← se crea automáticamente en la primera autenticación
├── requirements.txt
└── SETUP.md                   ← este archivo
```
