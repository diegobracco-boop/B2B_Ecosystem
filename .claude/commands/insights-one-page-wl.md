# 📄 SKILL 3 — ONE PAGE POR WHITE LABEL (B2B / B2B2C)

> **Rol.** Ficha ejecutiva de **una carilla** para una cuenta / partner puntual:
> actuals, budget, runrate, tendencia y tráfico, con lectura y semáforo propios.
> Es el material que el jefe abre cuando un WL salta en el Weekly o en las Alertas.
> Salida triple: ficha + mail + slide.

---

## 🎯 CUÁNDO ACTIVAR
"one pager de [WL]", "ficha de [partner]", "cómo está [cuenta]", "abrí [WL]",
"pasame la carilla de [partner]".
Si el partner existe en **varios países** → preguntar cuál (RG multi-país).
Si es **Livelo / Itaú / Karisma** → aplicar RG multi-variante **antes** de filtrar
(nunca sumar variantes; preguntar cuál si no se especifica).

## 📥 ENTRADAS
- JSON `por_wl[]` del snapshot semanal, o JSON dedicado (`*onepage*wl*.json`).
- Partner + país (unidad mínima = par país-partner).
- Referencias: budget y runrate del propio JSON; tendencia = últimas N semanas si están.

## 🗺️ MAPEO
`partner · pais · cluster · tier · gb{actual,prev,budget,runrate} · nr{} · npv{} ·
margen_pct{} · orders{} · searchers{} · cvr_pct{}`. Si el JSON trae serie histórica
semanal del WL, usarla para la mini-tendencia; si no, tendencia = actual vs prev.

---

## ⚙️ PROCESO
1. **Validar el par (país, partner)** — nunca filtrar solo por partner. Si no existe, informar en qué países sí hay datos.
2. **Aplicar RG multi-variante** (Livelo/Itaú/Karisma) antes de agregar.
3. **Armar los 4 bloques** de la carilla:
   - **Actuals**: GB, NR, NPV, margen, orders, ASP (GB/orders) — semana + acumulado si está.
   - **Vs. Budget / Runrate**: desvío $ y % en GB y NR, con **Ev/Et** en NR (CHECK).
   - **Tráfico**: searchers, CvR, tendencia del embudo (si el JSON lo trae).
   - **Tendencia**: dirección de GB/NR/margen (▲▬▼) últimas semanas.
4. **Semáforo del WL** con umbrales del `00_INDEX`.
5. **Lectura** (2–3 líneas): qué está pasando con esta cuenta y dónde poner el foco.
6. **Ensamblar** las 3 salidas.

---

## 🖨️ SALIDA 1 — FICHA ONE-PAGE (chat)

```
ℹ️ One Page — Livelo (Brasil) · Cluster Banco-fidelidad · Tier A
   Sem 04–10 Ago 2026 | Corte 10/08 | Vista GD | 🔴 ROJO

ACTUALS (semana)
GB $3.1M  ·  NR $0.42M  ·  Margen 13.5%  ·  Orders 9,240  ·  ASP $335

VS. REFERENCIA
              Actual   Budget   Δ%       Runrate  Δ%
GB   ($M)     3.10     3.00     +3.3%    3.05     +1.6%
NR   ($M)     0.42     0.48     −12.5%   0.45     −6.7%
  └ Ev/Et NR vs Bgt: Ev −$0.03M | Et −$0.03M  (CHECK ✅) → cae mitad volumen, mitad tasa

TRÁFICO
Searchers 540k (▼ −11.5% WoW) · CvR 1.7% (▼ −0.2pp) → cae tope de embudo Y conversión

TENDENCIA (últimas 4 sem)  GB ▲ · NR ▼ · Margen ▼

LECTURA
Cuenta A que crece en GB pero pierde NR: el margen se comprimió 2.2pp y el embudo se
enfrió. Foco: revenue (tasa/upfronts) + comercial (reactivar searchers). Candidata a
deep dive y a pedir plan de acción al partner.
```

## 📧 SALIDA 2 — MAIL PARA DIRECTORES
> **Asunto:** One-pager Livelo (BR) · Sem 04–10 Ago · 🔴
>
> Equipo,
> **Livelo** cerró en rojo. GB sano (**+3.3% vs bgt**) pero **NR −12.5%**: mitad volumen,
> mitad tasa. El **margen cayó a 13.5% (−2.2pp)** y el **embudo se enfrió** (searchers −11.5%,
> CvR −0.2pp). Es una cuenta Tier A, así que pesa. **Propuesta:** revisar tasa/upfronts con
> revenue y pedir plan de reactivación de tráfico al partner. Ficha completa adjunta.

## 🖥️ SALIDA 3 — BULLETS DE SLIDE
```
TÍTULO: Livelo (Brasil) · Tier A · Sem 04–10 Ago · 🔴
• GB $3.1M ▲ +3.3% vs Bgt
• NR $0.42M ▼ −12.5% (Ev/Et 50/50)
• Margen 13.5% ▼ −2.2pp
• Searchers −11.5% / CvR −0.2pp  ← embudo frío
• Foco: tasa (revenue) + reactivar tráfico (comercial)
PIE: Vista GD · Corte 10/08
```

---

## 🚫 REGLAS DE OUTPUT — SKILL 3
**Siempre:** validar par país-partner · RG multi-variante antes de agregar · Ev/Et con
CHECK en NR vs referencia · semáforo del WL · lectura de negocio · las 3 salidas ·
ASP = GB/orders (N/D si orders=0).
**Nunca:** filtrar solo por partner · sumar variantes Livelo/Itaú/Karisma · mostrar desvío
vs $0 si el WL no está en budget (informarlo) · inventar tendencia si no hay serie · incluir YaVas en GB consolidado.
