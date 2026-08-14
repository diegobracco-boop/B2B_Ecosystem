# /sincronizar — Forzar sync manual del Daily Dashboard

Ejecuta `daily_sync.py` manualmente fuera del horario del Task Scheduler.
Útil cuando los datos del día están desactualizados o hubo un error en la ejecución automática.

## Pasos

1. Verificar que el Datalake sea accesible (VPN activa si es necesario).
2. Correr desde la carpeta del proyecto:
   ```powershell
   cd "C:\Users\gregorio.minetti\claude files\b2b_ecosystem_github\Daily_Dashboard"
   python daily_sync.py
   ```
3. Confirmar en el output que los dos JSON subieron a Drive:
   - `OK Drive: archivo actualizado (daily_b2b2c_data.json)`
   - `OK Drive: archivo actualizado (daily_b2b_data.json)`
4. Recargar el dashboard en el navegador (Ctrl+F5) para ver los datos frescos.

## Si falla por autenticación de Drive

```powershell
python auth_drive.py
```
Abre el navegador, autorizás con tu cuenta @despegar.com, queda guardado en `token_drive.json`. Después volvé a correr `daily_sync.py`.

## Si falla la conexión al Datalake

- Verificar que el DSN `DataLake Treasure ODBC` esté configurado en ODBC Data Sources (Windows).
- Verificar que `.env` en `../credenciales/` tenga las credenciales correctas.
- Si el error es de password, las credenciales del Datalake pueden haber expirado — consultá con el equipo de Mariano Bujia.

## Notas

- El Task Scheduler corre esto automáticamente a las 08:00 hs todos los días. Solo usar este comando para re-ejecuciones manuales.
- Los JSON en Drive siempre se sobreescriben (no se acumulan versiones).
