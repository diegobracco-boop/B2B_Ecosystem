# 🚨 SKILL 2 — ALERTAS SEMANALES / WEEKLY ANALYZER (B2B / B2B2C)

> **Rol.** Monitoreo **proactivo**: escanear el snapshot semanal, detectar desvíos
> significativos **por LOB y por WL**, clasificarlos por severidad (semáforo) y adjuntar
> el **"por qué"** cuantitativo. Es la skill que alimenta al Weekly (Skill 1).
> Pensada para correr **automática los lunes** o a pedido. Salida triple: alertas + mail + slide.

---

## 🎯 CUÁNDO ACTIVAR
"corré las alertas", "qué se rompió esta semana", "hay algún desvío", "alertas por LOB",
o **ejecución programada** (lunes AM). También como sub-rutina del Weekly.

## 📥 ENTRADAS
- JSON snapshot semanal (`*weekly*b2b*.json` / `*weekly*wls*.json`).
- Umbrales de semáforo del `00_INDEX` (configurables).
- Opcional: umbrales custom por LOB si el negocio lo pide (declararlos).

---

## ⚙️ PROCESO — MOTOR DE ALERTAS

1. **Cargar** JSON más reciente. Declarar semana, corte, vista, referencia (budget → si no, prev).
2. **Barrido de métricas núcleo** en cada nivel (global · por LOB · por WL): `gb, nr, npv, margen_pct, orders, searchers, cvr_pct`.
3. **Evaluar severidad** con los umbrales del `00_INDEX`:
   - 🔴 GB/NR < −10% · margen > 2pp de caída · searchers < −15%
   - 🟡 GB/NR entre −5% y −10% · margen −0.5 a −2pp
   - 🟢 dentro de tolerancia (no genera alerta).
4. **Adjuntar el "por qué"** a cada alerta 🔴/🟡:
   - NR/NPV → **Ev/Et** (¿volumen o tasa?) con CHECK.
   - Margen → señalar la palanca P&L probable (upfronts, descuentos, COI, CCP, TPC, mix).
   - Tráfico → searchers vs. CvR (¿tope de embudo o conversión?).
   - Si el "por qué" no es cuantificable con el JSON → marcar **"requiere confirmación comercial/revenue"**.
5. **80/20 de la alerta**: cuando una alerta es a nivel LOB/total, listar los ≤5 WL que la explican.
6. **Deduplicar y priorizar**: ordenar por impacto absoluto en NR ($). Máx. 8 alertas activas; el resto se resume en una línea.
7. **Excepciones estructurales** antes de alertar (YaVas, variantes Livelo/Itaú/Karisma, cuentas excluidas).
8. **Si no hay ninguna alerta** → emitir explícitamente: "🟢 Semana sin desvíos materiales. Todo dentro de tolerancia."

---

## 🖨️ SALIDA 1 — TABLERO DE ALERTAS (chat)

```
ℹ️ Alertas Semanales B2B — Vista GD | Sem 04–10 Ago | Corte 10/08 | Ref: Budget

🔴 2 críticas · 🟡 3 de atención · 🟢 resto OK

# Sev  Scope                 Métrica   Desvío           Por qué (soporte)
1 🔴   Margen · API (B2B-MAY) margen    −2.3pp vs bgt    Et −$0.11M en NR: upfronts Hotels bajo bgt
2 🔴   Livelo · Brasil        NR        −14% vs bgt      Ev −$28k | Et −$10k → cae por volumen (searchers −18%)
3 🟡   Searchers · Total      searchers −5.3% WoW        CvR estable → tope de embudo, mirar pauta
4 🟡   Itaú-card · Brasil     margen    −1.6pp WoW       mix hacia producto de menor tasa (requiere confirmación)
5 🟡   NPV · Total            npv       −8.6% vs bgt      Et negativo; arrastre del margen API

80/20 del desvío NR total: Livelo −$38k · Itaú −$22k · [WL3] −$15k · Resto −$9k
```

## 📧 SALIDA 2 — MAIL DE ALERTA A DIRECTORES
Usar la herramienta de composición. Corto, escaneable, lo rojo primero:

> **Asunto:** 🚨 Alertas B2B · Sem 04–10 Ago · 2 críticas
>
> Equipo,
> Dos alertas críticas esta semana:
> 1) **Margen API −2.3pp** vs budget — cae por **tasa** (upfronts Hotels), no volumen.
> 2) **Livelo NR −14%** — cae por **volumen** (searchers −18%).
> De atención: searchers total −5% (tope de embudo), Itaú-card y NPV total.
> El 80% del desvío de NR se concentra en Livelo, Itaú y [WL3].
> Sugiero abrir one-pager de Livelo en la reunión. Detalle abajo.

## 🖥️ SALIDA 3 — BULLETS DE SLIDE
```
TÍTULO: Alertas B2B · Sem 04–10 Ago · 🔴 2 · 🟡 3
• 🔴 Margen API −2.3pp  ← tasa (upfronts Hotels)
• 🔴 Livelo NR −14%  ← volumen (searchers −18%)
• 🟡 Searchers total −5%  ← tope embudo
• 🟡 Itaú-card margen −1.6pp / NPV total −8.6%
• 80/20 NR: Livelo · Itaú · [WL3]
PIE: Ref Budget · Corte 10/08
```

---

## 🚫 REGLAS DE OUTPUT — SKILL 2
**Siempre:** clasificar severidad con los umbrales del `00_INDEX` · adjuntar "por qué"
con Ev/Et o palanca P&L · marcar lo no cuantificable como "requiere confirmación" ·
ordenar por impacto $ en NR · 80/20 en alertas de nivel total/LOB · declarar "sin
desvíos" cuando corresponda · las 3 salidas.
**Nunca:** afirmar una causa sin soporte · sumar variantes Livelo/Itaú/Karisma ·
incluir YaVas en GB consolidado · disparar alerta sin referencia clara · inventar umbrales no declarados.
