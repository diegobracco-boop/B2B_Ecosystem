# ⚖️ SKILL 4 — COMPARABLES VS. MISMO TIPO (Benchmark de cuentas)

> **Rol.** Poner a un WL frente a **sus pares del mismo tipo** (cluster / tier /
> tamaño) y decir si está por encima o por debajo del pelotón, en qué métricas y
> cuánto. Responde el "¿esta cuenta está bien o mal *para lo que es*?".
> Complementa la One Page (Skill 3). Salida triple: benchmark + mail + slide.

---

## 🎯 CUÁNDO ACTIVAR
"comparables de [WL]", "cómo está [cuenta] vs. su tipo", "benchmark de [partner]",
"contra quién comparo [WL]", "cuentas parecidas a [WL]", "¿es grande o chica [WL]?".

## 📥 ENTRADAS
- JSON `por_wl[]` con `cluster` y/o `tier` por cuenta (contrato del `00_INDEX`).
- Cuenta objetivo (par país-partner) + eje de comparación (default: **cluster**; alternativos: tier, país, tamaño de GB).
- Métricas a comparar (default: GB, NR, **margen_pct**, CvR, ASP).

## 🧩 DEFINICIÓN DE "MISMO TIPO"
Prioridad de agrupamiento (usar la primera disponible en el JSON):
1. **cluster** (ej. Banco-fidelidad, OTA-afiliada, Aerolínea, Retail…)
2. **tier** (A/B/C)
3. **tamaño de GB** (bandas: <$1M / $1–5M / >$5M por semana)
Excluir del peer group: la propia cuenta, YaVas, cuentas estructurales.
Livelo/Itaú/Karisma: cada variante es una entidad; comparar la variante consultada.

---

## ⚙️ PROCESO
1. **Identificar la cuenta objetivo** (validar par país-partner; RG multi-variante).
2. **Construir el peer group** según el eje elegido (mínimo 3 pares; si <3, ampliar eje y avisar).
3. **Calcular, por métrica**: valor de la cuenta · **mediana** del peer group · **posición** (percentil / ranking) · gap vs. mediana (abs y %).
   - Usar **mediana**, no promedio, para no sesgar con outliers. Declararlo.
   - Ratios (margen, CvR, ASP) **no** se descomponen en Ev/Et.
4. **Semáforo relativo** (distinto del absoluto): 🟢 top tercil del peer · 🟡 tercil medio · 🔴 tercil inferior, por métrica.
5. **Síntesis**: en qué la cuenta gana y en qué pierde *contra su propio tipo*, y el foco.
6. **Ensamblar** las 3 salidas.

> ⚠️ El benchmark es **relativo al tipo**, no al budget. Una cuenta puede estar 🟢
> vs. budget y 🔴 vs. sus pares (o al revés). Aclararlo siempre para no confundir con el semáforo del Weekly.

---

## 🖨️ SALIDA 1 — BENCHMARK (chat)

```
ℹ️ Comparables — Livelo (Brasil) vs. Cluster "Banco-fidelidad" (n=5 pares)
   Sem 04–10 Ago | Mediana del grupo | 🔴 en margen, 🟢 en tamaño

Métrica     Livelo    Mediana grupo   Posición        Gap vs mediana
GB ($M)     3.10      1.40            1/6 (top)        +$1.70M (+121%)   🟢
NR ($M)     0.42      0.21            1/6 (top)        +$0.21M           🟢
Margen %    13.5%     16.8%           6/6 (último)     −3.3pp            🔴
CvR %       1.7%      2.1%            5/6              −0.4pp            🔴
ASP ($)     335       290             2/6             +$45              🟢

SÍNTESIS
Livelo es, de lejos, la cuenta más grande de su cluster (top en GB y NR), pero la
**menos rentable por dólar**: su margen está 3.3pp debajo de la mediana del grupo y
convierte peor. El tamaño la sostiene; la eficiencia es su brecha. Foco: cerrar el
gap de margen hacia la mediana del cluster valdría ~$0.10M de NR/semana.
```

## 📧 SALIDA 2 — MAIL PARA DIRECTORES
> **Asunto:** Comparables Livelo vs. su cluster · 🔴 margen
>
> Equipo,
> Puesta contra sus pares del cluster **Banco-fidelidad**, Livelo es la **#1 en tamaño**
> (GB +121% vs. la mediana) pero la **última en margen** (13.5% vs. 16.8% mediana, −3.3pp)
> y convierte por debajo del grupo. No es un problema de escala sino de **eficiencia**.
> Llevar su margen a la mediana del cluster liberaría ~**$0.10M NR/semana**.
> Recomiendo tratarla como caso de mejora de rentabilidad, no de volumen.

## 🖥️ SALIDA 3 — BULLETS DE SLIDE
```
TÍTULO: Livelo vs. cluster Banco-fidelidad (n=5) · 🔴 margen
• GB #1 del grupo  ▲ +121% vs mediana
• NR #1 del grupo  🟢
• Margen 13.5% vs 16.8% mediana  ▼ −3.3pp  ← última del grupo
• CvR bajo la mediana (−0.4pp)
• Upside: cerrar gap de margen ≈ +$0.10M NR/sem
PIE: Benchmark relativo al tipo · Mediana · Corte 10/08
```

---

## 🚫 REGLAS DE OUTPUT — SKILL 4
**Siempre:** declarar el eje de comparación y el n del peer group · usar mediana (no
promedio) y decirlo · aclarar que el semáforo es **relativo al tipo** (≠ vs budget) ·
excluir la propia cuenta, YaVas y estructurales del grupo · validar par país-partner ·
las 3 salidas.
**Nunca:** comparar con menos de 3 pares sin avisar · descomponer ratios en Ev/Et ·
sumar variantes Livelo/Itaú/Karisma · mezclar clusters distintos en el mismo grupo · inventar pares que no están en el JSON.
