# 🧩 SKILLS DE GESTIÓN OPERATIVA — B2B / B2B2C
### Índice maestro + contrato de datos común

Estas 4 skills se apoyan en los agentes existentes como **capa de razonamiento**
(`Bitubee` = B2B, `Bitubicia` = B2B2C) y leen la **capa de datos técnica**:
los **JSON centralizados en Drive** que decidió el equipo en la reunión del 14/08.
No recalculan P&L desde cero: consumen métricas ya cerradas y las convierten en
**entregables ejecutivos listos para reportar, mandar a directores y usar en reuniones.**

| # | Skill | Qué produce | Trigger típico |
|---|-------|-------------|----------------|
| 1 | **Weekly Executive Summary** | Resumen semanal con semáforo + insights + deep dive | "reporte semanal", "cómo venimos", "weekly" |
| 2 | **Alertas Semanales (Weekly Analyzer)** | Alertas proactivas de desvíos por LOB + los "por qué" | "corré las alertas", "qué se rompió", automático lunes |
| 3 | **One Page por WL** | Una carilla por white label: actuals, budget, runrate, tráfico, tendencia | "one pager de [WL]", "ficha de [partner]" |
| 4 | **Comparables vs. mismo tipo** | Benchmark de una cuenta contra su cluster/tier | "comparables de [WL]", "cómo está vs. su tipo" |

Cada skill entrega **3 capas de salida**:
1. **Análisis ejecutivo** (bullets, dato → interpretación accionable)
2. **📧 Mail para directores** (asunto + cuerpo listo para enviar)
3. **🖥️ Bullets de slide** (para pegar en la reunión / deck)

---

## 📥 CONTRATO DE DATOS — JSON centralizado en Drive

Todas las skills leen del mismo pool de JSON. Detectar por nombre indicativo
(patrón `glob`) y usar siempre **el más reciente**. Si falta el JSON de un LOB,
informarlo — **nunca inventar el dato**.

| Contenido | Patrón de archivo |
|-----------|-------------------|
| Snapshot semanal B2B | `*weekly*b2b*.json` / `*b2b*weekly*.json` |
| Snapshot semanal B2B2C (WLS) | `*weekly*wls*.json` / `*wls*weekly*.json` |
| Snapshot por WL (una carilla) | `*onepage*wl*.json` / `*wl*snapshot*.json` |
| Proyección de cierre (mes corriente) | `*proyeccion*output*.json` |

### Esquema esperado (`snapshot semanal`)

```jsonc
{
  "metadata": {
    "generado_en": "2026-08-11",          // fecha de corrida
    "semana": "2026-W32",                  // ISO week
    "semana_label": "Sem 04–10 Ago 2026",
    "corte_datos": "2026-08-10",           // última fecha real
    "vista": "GD",                         // GD o RI (B2B); WLS siempre GD
    "moneda": "USD",
    "fuente_agente": "Bitubee|Bitubicia"
  },
  "totales": {
    "gb":    { "actual": 12.4, "prev": 11.9, "budget": 12.0, "runrate": 12.2 },   // en M USD
    "nr":    { "actual": 1.85, "prev": 1.91, "budget": 1.95, "runrate": 1.90 },
    "npv":   { "actual": 0.62, "prev": 0.66, "budget": 0.70, "runrate": 0.64 },
    "orders":{ "actual": 41200,"prev": 40100,"budget": 42000,"runrate": 41500 },
    "margen_pct": { "actual": 14.9, "prev": 16.1, "budget": 16.3 },               // NR/GB
    "searchers":  { "actual": 2140000, "prev": 2260000 },                          // solo si aplica
    "cvr_pct":    { "actual": 1.92, "prev": 2.03 }                                 // solo si aplica
  },
  "por_lob": {                              // B2B: B2B-MAY / B2B-MIN ; B2B2C: ON/CALL/OFF
    "B2B-MAY": { "gb": {...}, "nr": {...}, "margen_pct": {...} },
    "B2B-MIN": { "...": "..." }
  },
  "por_wl": [                               // ranking de cuentas / partners
    {
      "partner": "Livelo", "pais": "Brasil", "cluster": "Banco-fidelidad", "tier": "A",
      "gb": {"actual": 3.1, "prev": 2.8, "budget": 3.0, "runrate": 3.05},
      "nr": {"actual": 0.42,"prev": 0.44},
      "margen_pct": {"actual": 13.5, "prev": 15.7},
      "searchers": {"actual": 540000, "prev": 610000},
      "cvr_pct": {"actual": 1.7, "prev": 1.9}
    }
  ]
}
```

> ⚠️ Los nombres de campo son la **convención sugerida**. Si el JSON real de Drive
> usa otras claves, ajustar el mapeo en cada skill (sección *Mapeo de campos*) —
> pero **no cambiar la lógica ni los umbrales**.

---

## 🌐 REGLAS GLOBALES HEREDADAS (aplican a las 4 skills)

Se reutilizan las reglas ya vigentes en Bitubee / Bitubicia. **No redefinir, heredar:**

- **RG-Formato numérico**: Millones `$X.XM` (1 dec) · Miles `$XXk` · % `X.X%` · pp `±X.Xpp` · órdenes `X,XXX`.
- **RG-Ev/Et (Efecto Volumen / Efecto Tasa)**: obligatorio en toda comparación de NR/NPV.
  `Ev = Ratio_B·(GB_A−GB_B)` · `Et = (Ratio_A−Ratio_B)·GB_A` · CHECK `|Ev+Et−Δ|<0.01`.
- **RG-80/20**: a nivel total/país listar máx. 5 drivers que explican ~80% del desvío + "Resto".
- **RG-Multi-variante**: Livelo (3), Itaú (2), Karisma (1) — **nunca sumar variantes entre sí**.
- **RG-Exclusiones estructurales**: YaVas fuera del GB consolidado (SaaS); New Fly / Wooba / demo-0010 no cuentan como cuentas.
- **RG-Vista**: B2B declarar siempre GD vs RI; B2B2C (WLS) siempre GD.
- **RG-Nunca solo datos**: cada número va con su interpretación de negocio.
- **RG-No inventar**: si falta un dato, decir "N/D" y seguir; no derivar NR desde componentes.

---

## 🎛️ UMBRALES DE SEMÁFORO (configurables — únicos y compartidos)

Diagnóstico de la semana por métrica, contra la referencia (budget → si no hay, semana previa):

| Color | Regla (peor caso entre GB, NR, margen) |
|-------|----------------------------------------|
| 🟢 **Verde** | Desvío GB y NR ≥ −5% **y** margen ≥ −0.5pp vs. referencia |
| 🟡 **Amarillo** | Desvío GB o NR entre −5% y −10% **o** margen entre −0.5pp y −2pp |
| 🔴 **Rojo** | Desvío GB o NR < −10% **o** caída de margen > 2pp **o** searchers < −15% |

El **semáforo global** de la semana = el peor color entre las métricas núcleo.
Cada LOB / WL tiene su propio semáforo con la misma regla.

---

## 🔗 Cómo se encadenan

```
JSON Drive ──► [2] Alertas Semanales ──► detecta desvíos + "por qué"
                     │
                     ▼
             [1] Weekly Exec Summary ──► narra la semana + semáforo (mail + slide)
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
 [3] One Page por WL       [4] Comparables vs. tipo
 (cuenta bajo la lupa)     (esa cuenta vs. su cluster)
```

Uso recomendado del jefe: **lunes** corre [2]+[1] para el weekly; cuando un WL
salta en rojo, abre [3] y [4] para el deep dive y arma el mail/slide directo.
