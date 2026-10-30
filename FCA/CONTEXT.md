# FCA — Hecho · Causa · Acción de los KRs (OKR H2)

FCA mensual con metodología Lean para la mesa con el negocio (2026-10-30, Diego). Alcance: los KRs de los OKR H2 FY27 que se
desvían ±5% o más de su meta en el mes.

## Flujo (`/fca [AAAA-MM]`, ver `.claude/commands/fca.md`)
1. `fca_builder.py` — insumo con datos, nada inventado. Lee de Drive `OKR_H2_FY27.json` (+ `_Organic`), y para los KRs de
   NR / OC el P&L contable del mes (`baseline_actuals+projections.json` vs `budget.json`). Por KR: meta, real, brecha (abs, %,
   pp), estado (Actual / Proyeccion / MTD / Manual…), sentido, acumulado H2, organic; para los desviados, apertura por país y
   P&L por línea N2 / país / producto (`PNL_MAP`). Sin `--mes`: el primer mes de H2 sin cierre contable (provisional).
   Salida: `FCA/_out/fca_input_<mes>.json` y `<OneDrive B2B & WLs>/FCA/`.
2. Agente `fca-specialist` (`.claude/agents/fca-specialist.md`, el prompt de Diego adaptado): redacta Hecho, Causa raíz
   (5 porqués hasta donde den los datos, enfoque de procesos) y 1–2 líneas de discusión. Escribe `FCA/_out/fca_<mes>.json/.md`.
3. Revisión del usuario y `fca_publish.py <mes>` → `fca.json` en Drive (id `1OT3RdA2Llcf21fdcvRKoMdcMTZvOJB1E`, carpeta de los
   OKR; un mes por clave) con doble escritura a Ownia.

## En la app
Pestaña **FCA** de Presentaciones (`Flow_B2B/flow.html`, `<base>/flow?fca=1`; datos con `getFca()` de `Flow_B2B/Codigo.js`;
el id está en `server/drive-manifest.json` → módulo `flow`). Portada con el resumen y una slide por KR. Todo texto es
editable; lo editado y la acción acordada (acción, responsable, fecha) se guardan en `/notes/flow/fca-<mes>` y pisan al
borrador: republicar el mes no los borra. Exporta a PPTX con el resto de Presentaciones.
