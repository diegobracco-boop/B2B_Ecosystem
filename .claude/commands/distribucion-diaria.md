# /distribucion-diaria — Distribuir a diario el Run Rate B2B + B2B2C

Abre a nivel diario las proyecciones mensuales del Run Rate (WLs, API, HTML), toma los reales hasta
la fecha de corte que defina el usuario y reparte el remanente del mes en los días que faltan.
Genera los CSV que se cargan a mano en `raw.b2brr_gd` y `raw.b2brr_ri`. Detalle en
[Proceso_Distribucion_Diaria/CONTEXT.md](../../Proceso_Distribucion_Diaria/CONTEXT.md).

Argumentos opcionales: `$ARGUMENTS` (ej. `GD`, `RI`, una semana `"2026.09.14 - W37"`, un corte `2026-09-25`).
Sin argumentos: GD y RI sobre la última semana.

## Pasos

1. `git pull` (regla del repo: nunca correr con código viejo).

2. Confirmar con el usuario:
   - **La semana**: listar las carpetas de `Run Rate/` y mostrar cuál toma por defecto (la última
     con `Inputs Python/`). Verificar que en `Inputs Python/` estén los 3 modelos (WLs, API, HTML).
   - **Hasta qué fecha se toman reales** (`--reales-hasta`, incluida). Nunca asumirla: preguntarla
     siempre. Sugerir ayer. `no` = solo proyección. Con fecha hace falta VPN.

3. Correr primero en seco, para cada base pedida:
   ```powershell
   cd Proceso_Distribucion_Diaria
   python distribucion_diaria.py --base GD --reales-hasta <AAAA-MM-DD> --dry-run [--semana "<semana>"]
   python distribucion_diaria.py --base RI --reales-hasta <AAAA-MM-DD> --dry-run [--semana "<semana>"]
   ```
   - Si termina en `ABORTADO`, **no forzar nada**: mostrar el error y explicar qué control falló
     (ver "Controles" en CONTEXT.md). Una columna desconocida se resuelve mapeándola en
     `ALIAS_COLUMNAS`/`METRICAS`/`NO_METRICAS`, solo con confirmación del usuario. Si el corte pasa
     el último día del Datalake, proponer un corte anterior.
   - Mostrarle al usuario:
     - la tabla **REALES HASTA …**: real vs proyección del mes, remanente, `grupos_topeados` y
       `gb_exceso` (grupos que ya superaron el Run Rate → días restantes en 0), `gb_sin_fila`;
     - **`gb_dia_real` vs `gb_dia_rem`**: si el ritmo del remanente es muy distinto al real, avisar que
       el Run Rate parece desactualizado;
     - los `AVISO` (fórmulas inconsistentes en el Excel del modelo, reales sin fila en el modelo).

4. Si el usuario da el OK, correr sin `--dry-run` y pasarle la ruta del CSV (el nombre lleva el corte),
   de la conciliación y del resumen de reales.

5. Recordar el paso manual: cargar `base_consolidada_diaria_GD_*.csv` en `raw.b2brr_gd` y
   `..._RI_*.csv` en `raw.b2brr_ri` (las tablas necesitan las columnas `loyalty_usd` y `mkt_usd`).
   Después de la carga, el Daily lo toma en la próxima corrida de `daily_sync.py` (o forzar con
   `/sincronizar`).
