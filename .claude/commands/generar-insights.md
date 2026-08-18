# /generar-insights — Generar insights semanales con Claude

Lee `insights_input.json` (generado por `daily_sync.py`) y produce `weekly_insights.json` con análisis narrativo completo. Luego sube el resultado a Drive.

## Pasos

1. **Leer** `Daily_Dashboard/insights_input.json` con Read.

2. **Analizar** los datos por cada LOB y período. Para cada uno (b2b2c, b2b, consolidado, mrm.b2b2c, mrm.b2b, mrm.consolidado):
   - Interpretar los semáforos y KPIs
   - Aplicar lógica Ev/Et en NR si hay desvío: Ev = (margen_ly_pct/100) × (gb_actual − gb_budget); Et = ((margen_pct − margen_budget_pct)/100) × gb_actual
   - Identificar el hallazgo más importante (positivo o negativo)
   - Formular causas solo si hay soporte en los números; si no, plantear como pregunta al equipo

3. **Generar** para cada LOB:
   - `bullets`: lista de 4-5 strings con formato "Métrica $X.XM, +X.X% vs Budget / +X.X% vs LY — interpretación. [Foco]"
   - `slide_bullets`: lista de 4 strings telegráficos para el deck
   - Mantener todos los campos numéricos (semaforo_global, semaforos, periodo, corte, referencia, kpis) exactamente como vienen del input

4. **Escribir** el resultado en `Daily_Dashboard/weekly_insights.json` con Write. El JSON debe tener exactamente esta estructura:
   ```json
   {
     "meta": { "generated_at": "...", "semana_inicio": "...", "semana_fin": "...", "corte": "...", "mes_anterior": "..." },
     "b2b2c":       { "semaforo_global": "...", "semaforos": {...}, "periodo": "...", "corte": "...", "referencia": "Budget", "kpis": {...}, "bullets": [...], "slide_bullets": [...] },
     "b2b":         { ... },
     "consolidado": { ... },
     "mrm": {
       "b2b2c":       { ... },
       "b2b":         { ... },
       "consolidado": { ... }
     }
   }
   ```

5. **Subir a Drive** corriendo con Bash:
   ```
   cd "C:\Users\gregorio.minetti\claude files\b2b_ecosystem_github\Daily_Dashboard" && python upload_insights.py
   ```

## Reglas de análisis

- **Formato numérico**: $X.XM para millones, X.X% para porcentajes, ±X.Xpp para puntos porcentuales
- **Semáforo global**: el peor de los 4 semáforos individuales (🔴 > 🟡 > 🟢). Mantener el valor del input — no recalcular.
- **Ev/Et**: siempre separar en NR si hay desvío vs budget. Usar los campos `gb_actual`, `gb_budget`, `margen_pct`, `margen_budget_pct`, `margen_ly_pct` del JSON.
- **80/20**: en consolidado, mencionar qué LOB explica el mayor desvío
- **Nunca inventar datos** — si falta un número, escribir "N/D"
- **Foco al final** de cada bullet: [Revenue] / [Comercial] / [Producto] / [Costos]
- **MRM**: bullets orientados a cierre mensual, mencionar si el mes está por encima o debajo del plan al cierre

## Ejemplo de bullet bien formado

`▼ NR $1.85M, −5.1% vs Budget / +2.3% vs LY — compresión de margen (14.9%, −1.4pp vs Bgt): Et = −$0.06M por caída de tasa, Ev = +$0.02M por volumen saludable. [Revenue]`

## Ejemplo de slide bullet

`NR $1.85M  ▼ −5.1% vs Bgt | Et −$0.06M / Ev +$0.02M`
