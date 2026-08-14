# 📊 SKILL 1 — WEEKLY EXECUTIVE SUMMARY (B2B / B2B2C)

> **Rol.** Convertir el snapshot semanal en un resumen ejecutivo de **una carilla**
> con diagnóstico de semáforo, insights accionables y deep dive de lo negativo.
> Audiencia: Chiefs, VPs y Directores. Salida triple: análisis + **mail** + **slide**.

---

## 🎯 CUÁNDO ACTIVAR
"reporte semanal", "weekly", "resumen de la semana", "cómo venimos esta semana",
"executive summary semanal", "armá el weekly de B2B / B2B2C".
Si no se especifica LOB → preguntar: **¿B2B, B2B2C o consolidado?**

## 📥 ENTRADAS
- **Obligatoria:** JSON snapshot semanal (patrón `*weekly*b2b*.json` / `*weekly*wls*.json`).
- **Opcional:** salida de la **Skill 2 (Alertas)** ya corrida (para no recalcular los "por qué").
- **Parámetros:** LOB / negocio · semana (default: la del JSON más reciente) · referencia (budget → si no, semana previa).

## 🗺️ MAPEO DE CAMPOS
Usar el contrato del archivo `00_INDEX`. Si el JSON real difiere, mapear aquí una sola vez.
`gb.actual, gb.prev, gb.budget, gb.runrate · nr.* · npv.* · margen_pct.* · orders.* · searchers.* · cvr_pct.* · por_lob{} · por_wl[]`

---

## ⚙️ PROCESO

1. **Cargar** el JSON más reciente (RG-detección por nombre). Leer `metadata` → declarar semana, corte, vista, moneda.
2. **Elegir referencia**: `budget` si existe en el JSON; si no, `prev` (semana previa). Declararlo.
3. **Diagnóstico de semáforo** (umbrales del `00_INDEX`) a tres niveles:
   - **Global** (totales) · **por LOB** · **top WL** (los del `por_wl`).
4. **Descomposición obligatoria** en NR y NPV: aplicar **Ev/Et** con CHECK. Nunca reportar un desvío de NR sin separar volumen vs. tasa.
5. **80/20**: identificar los ≤5 WL / LOB que explican ~80% del desvío de GB y de NR. Agrupar resto.
6. **Excepciones estructurales**: excluir YaVas del GB consolidado; Livelo/Itaú/Karisma sin sumar variantes.
7. **Insights**: por cada hallazgo, escribir **dato → interpretación → foco** (Revenue / Comercial / Producto / Costos). Máx. 5.
8. **Deep dive negativo**: tomar el peor driver rojo/amarillo y abrir una explicación de 2–4 líneas (qué métrica, cuánto, probable palanca según diccionario P&L). Si viene de la Skill 2, citar su "por qué".
9. **Ensamblar** las 3 salidas (abajo).

> **Regla anti-alucinación:** las "causas" solo se afirman si están soportadas por
> Ev/Et, por mix, o por la Skill 2. Si no hay soporte, se formula como **pregunta al
> equipo comercial/revenue**, no como conclusión.

---

## 🖨️ SALIDA 1 — ANÁLISIS EJECUTIVO (chat)

```
ℹ️ Weekly B2B — Vista GD | Sem 04–10 Ago 2026 | Corte 10/08 | Ref: Budget | Fuente: Bitubee

🟡 SEMÁFORO GLOBAL: AMARILLO
   GB 🟢 · NR 🟡 · Margen 🔴 · Orders 🟢

RESUMEN (máx. 5 bullets — dato → interpretación → foco)
▲ GB $12.4M, +3.3% vs budget → tracción sana, empujada por Brasil. [Producto/Comercial]
▼ NR $1.85M, −5.1% vs budget → Ev −$0.09M | Et −$0.06M: cae por tasa, no por volumen. [Revenue]
▼ Margen 14.9% (−1.4pp WoW, −1.4pp vs budget) → compresión concentrada en API. [Revenue/Costos]
● 80/20 del desvío NR: Livelo −$38k · Itaú −$22k · [WL3] −$15k · Resto −$9k.
● Searchers −5.3% WoW con CvR estable → menos tope de embudo, mirar pauta. [Comercial]

DEEP DIVE — lo negativo
Margen (🔴): la caída de 1.4pp se explica por Et negativo en NR; upfronts por debajo
de budget en Hotels-API. Volumen OK. Pregunta al equipo: ¿over de comisión renegociado
a la baja o mix hacia partners de menor tasa?
```

## 📧 SALIDA 2 — MAIL PARA DIRECTORES
Generar con la herramienta de composición de mensajes (asunto + cuerpo). Tono directo,
sin jerga técnica cruda, 6–10 líneas, el número primero. Plantilla:

> **Asunto:** Weekly B2B · Sem 04–10 Ago · 🟡 — margen bajo lupa
>
> Equipo,
> La semana cerró en **amarillo**. GB **+3.3% vs budget** ($12.4M), pero **NR −5.1%**
> por compresión de **margen (14.9%, −1.4pp)**, no por volumen. El 80% del desvío de NR
> se concentra en **Livelo, Itaú y [WL3]**. Searchers cayó 5% con conversión estable.
> **Foco de la semana:** revisar tasa/upfronts en Hotels-API y traccionar tope de embudo.
> Detalle y one-pagers en el anexo. Quedo para el deep dive en la reunión.

## 🖥️ SALIDA 3 — BULLETS DE SLIDE
Formato para pegar en el deck (título + 4–5 bullets telegráficos + pie de semáforo):

```
TÍTULO: Weekly B2B · Sem 04–10 Ago 2026 · 🟡 Amarillo
• GB $12.4M  ▲ +3.3% vs Bgt
• NR $1.85M  ▼ −5.1% (Et −$0.06M | Ev −$0.09M)
• Margen 14.9%  ▼ −1.4pp  ← foco
• 80/20 desvío NR: Livelo · Itaú · [WL3]
• Searchers −5% / CvR estable
PIE: Ref Budget · Corte 10/08 · Fuente Bitubee
```

---

## 🚫 REGLAS DE OUTPUT — SKILL 1
**Siempre:** declarar vista + semana + corte + referencia · semáforo global y por LOB ·
Ev/Et con CHECK en NR/NPV · 80/20 en desvíos · máx. 5 bullets · las 3 salidas ·
dato→interpretación en cada bullet.
**Nunca:** afirmar causas sin soporte (Ev/Et, mix o Skill 2) · sumar variantes Livelo/Itaú/Karisma ·
incluir YaVas en GB consolidado · inventar datos · reportar desvío sin referencia · mezclar B2B con B2B2C en el mismo bloque.
