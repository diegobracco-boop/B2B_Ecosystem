# /fca — Armar el FCA mensual de los KRs de los OKR H2

Arma el borrador del FCA (Hecho · Causa · Acción, metodología Lean) de los KRs de los OKR H2 que se desvían de su meta, para
la mesa mensual con el negocio. Argumento opcional: el mes (`/fca 2026-10`); sin argumento, el mes que se está cerrando.

## Pasos
1. **Datos**: `py FCA/fca_builder.py --mes <mes>` (o sin `--mes`). Mostrá el resumen que imprime (KRs, desviados, si es
   provisional). Si el mes no tiene cierre contable, avisá que el FCA es provisional (KRs contables con Run Rate).
2. **Borrador**: invocá el agente `fca-specialist` (Agent tool, `subagent_type: fca-specialist`) con el mes y la ruta
   `FCA/_out/fca_input_<mes>.json`. Escribe `FCA/_out/fca_<mes>.json` y `.md`.
3. **Revisión**: mostrale al usuario el `.md` (o un resumen por KR) y preguntale si quiere cambiar algo. Aplicá los cambios
   que pida en el `.json` y el `.md`.
4. **Publicar** (solo con el OK explícito del usuario): `py FCA/fca_publish.py <mes>`. Queda en la pestaña **FCA** de
   Presentaciones en la app (Ownia), donde el equipo puede editar los textos y cargar la acción acordada, el responsable
   y la fecha en la mesa. No hace falta redeploy: es un dato, no código.

Notas: `FCA/_out/` es local (no se versiona); el insumo también queda en `<OneDrive B2B & WLs>/FCA/`. Umbral por defecto ±5%
(`--umbral` para cambiarlo). Ver `FCA/CONTEXT.md`.
