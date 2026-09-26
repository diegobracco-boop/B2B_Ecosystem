# /distribucion-diaria — Distribución diaria de proyecciones B2B + B2B2C

Abre a nivel diario una proyección mensual (Run Rate, Forecast…) de WLs, API y HTML, toma los reales
hasta la fecha de corte y reparte la diferencia del mes en curso en los días que faltan. Genera los
CSV que se cargan a mano en `raw.b2brr_gd` y `raw.b2brr_ri`. Detalle en
[Proceso_Distribucion_Diaria/CONTEXT.md](../../Proceso_Distribucion_Diaria/CONTEXT.md).

Argumentos opcionales: `$ARGUMENTS` (ej. `GD`, `RI`). Sin argumentos: GD y RI.

## Paso 0 — Definiciones de la corrida (las responde SIEMPRE el usuario)

Antes de correr nada, preguntarle al usuario estas 4 cosas (con AskUserQuestion o en texto). **No
asumir ninguna, no reutilizar las de una corrida anterior y no inventar defaults**, aunque parezcan
obvias. Si el usuario no responde alguna, no correr.

1. **¿Qué escenario de proyección se va a distribuir: budget, forecast o run rate?** Define el
   nombre del archivo final: `<escenario>_diario_<gd|ri>.csv` (ej. `budget_diario_ri.csv`) →
   `--escenario budget|forecast|runrate`.
2. **¿Hasta qué fecha se toman reales?** (día incluido; normalmente ayer). La diferencia entre la
   proyección del mes en curso y los reales se reparte en los días que faltan. `no` = solo
   proyección → `--reales-hasta AAAA-MM-DD|no`. Con fecha hace falta VPN.
3. **¿Desde qué mes debe quedar la base final diaria?** Los meses anteriores quedan afuera. En run
   rate / forecast los meses cerrados (reales) se toman directo del Datalake, así que no hace falta
   sumarlos al diario; si el usuario elige un mes anterior al del corte, el script avisa →
   `--desde-mes AAAA-MM`.
4. **¿Dónde están los P&L planos de input?** Carpeta con `WLs - Modelo*.xlsx`, `API - Modelo*.xlsx`
   y `HTML - Modelo*.xlsx` (Run Rate o Forecast) → `--inputs "<carpeta>"`
   (o `--semana "<carpeta de Run Rate>"` para usar `<semana>/Inputs Python`).

Mostrarle al usuario el resumen de las 4 respuestas y pedir confirmación antes del paso 1.

## Pasos

1. `git pull` (regla del repo: nunca correr con código viejo).

2. Verificar que en la carpeta de inputs estén los 3 modelos (uno de cada uno).

3. Correr primero en seco, para cada base pedida:
   ```powershell
   cd Proceso_Distribucion_Diaria
   python distribucion_diaria.py --base GD --escenario <1> --reales-hasta <2> --desde-mes <3> --inputs "<4>" --dry-run
   python distribucion_diaria.py --base RI --escenario <1> --reales-hasta <2> --desde-mes <3> --inputs "<4>" --dry-run
   ```
   - Si termina en `ABORTADO`, **no forzar nada**: mostrar el error y explicar qué control falló
     (ver "Controles" en CONTEXT.md). Una columna desconocida se resuelve mapeándola en
     `ALIAS_COLUMNAS`/`METRICAS`/`NO_METRICAS`, solo con confirmación del usuario. Si el corte pasa
     el último día del Datalake, proponer un corte anterior.
   - Mostrarle al usuario:
     - la tabla **REALES HASTA …**: real vs proyección del mes, remanente, `grupos_topeados` y
       `gb_exceso` (grupos que ya superaron la proyección → días restantes en 0), `gb_sin_fila`;
     - **`gb_dia_real` vs `gb_dia_rem`**: si el ritmo del remanente es muy distinto al real, avisar que
       la proyección parece desactualizada;
     - los `AVISO` (meses fuera de rango, columnas ignoradas, fórmulas inconsistentes en el Excel).

4. Si el usuario da el OK, correr sin `--dry-run`. La salida va a la carpeta de inputs (o `--salida`):
   `<escenario>_diario_<base>.csv` + `_conciliacion.csv`, `_reales.csv` y `_parametros.txt` (las 4
   definiciones + avisos). Si ya existía una corrida con el mismo nombre, se mueve a `V. Anteriores/`.
   Pasarle las rutas.

5. Recordar el paso manual: **reemplazar** (no agregar) el contenido de la tabla del escenario
   (run rate → `raw.b2brr_gd` / `raw.b2brr_ri`; budget → `raw.b2b_budget_gd` / `_ri`; forecast →
   confirmar tabla con el usuario). Las tablas necesitan las columnas `loyalty_usd` y `mkt_usd` (al final).
   Después de la carga, el Daily lo toma en la próxima corrida de `daily_sync.py` (o `/sincronizar`).
