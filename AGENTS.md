# Agentes del ecosistema B2B

Los agentes viven en `.claude/agents/<nombre>.md` (el rol) y cada uno corre una skill de `.agents/skills/<skill>/SKILL.md` (el método). Reportan hallazgos y no editan nada; la excepción es `fca-specialist`, que escribe un borrador local.

## Cuándo correrlos

- **Antes de `/clasp-push` o `/actualizar`**, y después de cualquier cambio grande en un pipeline (`Inputs_Planning_PnL`, `Daily_Dashboard`) o en una landing GAS: correr `auditor-de-codigo` sobre el módulo tocado. Si reporta hallazgos bloqueantes, avisar al usuario y esperar su confirmación antes de seguir con el deploy.
- **Antes de publicar una pantalla para dirección**: correr el panel de clientes.
- **Cuando el usuario lo pide** ("auditar", "revisar integridad de datos", "chequear credenciales", "revisar UX", "revisar procesos", "cómo se conectan los datos"): correr el agente que corresponda, con el alcance que indique.

## Agentes de auditoría

| Agente | Skill | Para qué |
|---|---|---|
| `auditor-de-codigo` | `code-audit` | Calidad de código, integridad de datos, credenciales, consistencia pipelines↔landings |
| `calidad-de-procesos` | `process-quality-audit` | Orden / claridad / escalabilidad / integridad / eficiencia de CÓMO se trabaja (no del código) |
| `ux-designer` | `ux-consistency-review` | Estética, paleta oficial Despegar, consistencia visual entre dashboards, accesibilidad |
| `data-engineer` | `data-source-consistency-review` | Mapeo de fuentes, duplicidad entre pipelines, formato homogéneo, staleness de doc |

**Dirección de diseño** (Diego, 2026-10-25): minimalista y simple, estilo Apple, con la paleta oficial de Despegar. Está en el Eje 7 de `ux-consistency-review`. Se aplica de a una pantalla y solo en las capas de Ownia.

## Panel de clientes (`cliente-*`)

Agentes con la personalidad de los clientes de la app: `cliente-ceo`, `cliente-chief-comercial`, `cliente-vp-b2b`, `cliente-vp-b2b2c`, `cliente-vp-planning`, `cliente-director-pais`. Todos corren la skill `client-panel-review`: miran **capturas reales** de una pantalla y responden si es apta para su rol, qué falta, qué sobra y qué no entienden.

Las capturas las saca la sesión principal levantando la app de Ownia en local; al agente se le pasan las rutas de las capturas.

## FCA (`fca-specialist`)

Arma el borrador mensual de los FCA (Hecho · Causa · Acción) de los KRs de los OKR H2 desviados de su meta. Se corre con `/fca`, que prepara el insumo, invoca al agente, revisa el borrador con el usuario y publica solo con su OK. Ver `FCA/CONTEXT.md`.

## Cómo invocarlos

Los agentes custom de `.claude/agents/` **no son invocables por `subagent_type`** en este entorno: lanzalos como `general-purpose` con un prompt que diga: "leé completo `.claude/agents/<nombre>.md` (tu rol) y `.agents/skills/<skill>/SKILL.md` (la skill que corrés), y seguí eso al pie de la letra; alcance = <módulo>; no edites nada, solo reportá". Para el panel de clientes, sumá las rutas de las capturas.

**Si la sesión está cerca del límite de uso:** correr los agentes de a 1 o 2, no los 4 juntos (cada uno son ~100-140k tokens; correr 4 en paralelo puede cortar la sesión a mitad).
