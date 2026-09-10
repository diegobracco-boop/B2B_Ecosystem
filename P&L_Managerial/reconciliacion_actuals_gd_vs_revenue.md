# Reconciliación — Actuals GD (gestional) vs Revenue por GD

Análisis de por qué las dos formas de calcular el revenue B2B por GD
(`gestion_date`) dan resultados distintos. Alimenta el modo **"Actuals GD vs
Revenue"** de la vista *Managerial vs Accounting* (`P&L_Managerial/dashboard.html`).

- **Lado izquierdo (Gestional `ac`)** — `build_b2b_gd_query()` en `actuals_gestional_upload.py`.
- **Lado derecho (Revenue por GD)** — `build_query()` en `revenue_gd_builder.py`.

> Estado: **BORRADOR**. Los subtotales (GB, Net Revenue, FVM) reconcilian razonable;
> el desglose línea por línea todavía no es interpretable (ver §3 y §5).

---

## 1. Las dos queries de un vistazo

| | Gestional `ac` (izq) | Revenue por GD (der) |
|---|---|---|
| **Tabla spine** | `bi_sales_fact_sales_recognition` (`fh`) — 1 fila por producto reconocido | `bi_transactional_fact_charges` × `_products` × `_transactions` (`tx`), luego `LEFT JOIN bi_sales_fact_sales_recognition` (`fv`) |
| **Modelo de revenue** | Construido en la query: `bi_pnlop_fact_current_model` (`pnl`) + fórmulas + `country_factors` (tabla de 5 decimales por país·canal·producto) + CTE `conectores` | `lake.b2b_rev_pnl_sales_detail` (`dev`) como fuente primaria, con `COALESCE(dev.X, pnl.X_usd)` de fallback. `lake.b2b_b2b2c_revenue_pnl_model` (`rev`) para GB e históricos 2025 |
| **Net Revenue** | Suma de las ~10 líneas de revenue margin (cada una con su `country_factor`) | `dev.nr_rev` directo (FY27) / `rev.fix_net_revenues` (2025) — número **pre-calculado** por el modelo de revenue |
| **FVM / NPV** | NR + las ~14 líneas de costo transaccional | `dev.fvm_rev` directo (FY27) — pre-calculado |
| **Signos de costos** | `-SUM(...)` explícito en discounts, cancellations, COI, CCP, etc. | `SUM(...)` puro — **no niega** las líneas de costo (el signo lo trae `dev.*` donde exista) |
| **Grain país** | `partner_id` → carve-out Paraguay (13 AP codes), CL especial, resto por `country_code` | `tr.site` directo (8 países + "Other Countries") |
| **Grain producto** | Granular: Hotels / Flights / Packages General / Vacation Rentals / Insurance / Cars / Dest. Serv. | Agrupado: Carrito / Hoteles / Vuelos / Dest. Serv. / **ONA** (todo lo demás) |
| **Canal** | `parent_channel` API / Agencias afiliadas (MAY / MIN) | `fv.parent_channel` API / Agencias afiliadas → `B2B-API` / `B2B-AFF`; NULL si no matchea → cae a MAY |

---

## 2. Por qué difieren — diferencias estructurales

### 2.1 Fuente de verdad del Net Revenue / FVM
- **Gestional** arma NR/FVM **línea por línea** desde `pnl.*_usd` crudo, aplicando
  a mano el `country_factor` (ej. `commission_net_usd * 0.688685` para CO·API·Hoteles),
  el factor Expedia (`0.25` para 4 partners), el efecto financiero Naranja, etc.
- **Revenue por GD** toma `dev.nr_rev` / `dev.fvm_rev` **ya calculados** por el
  modelo `b2b_rev_pnl_sales_detail`. Ese modelo puede tener supuestos distintos
  (fecha de corte, tratamiento de PPA, agrupación de líneas).

→ **Consecuencia**: los totales NR/FVM pueden diferir 1-5% por metodología, y las
**líneas individuales no son comparables 1:1** porque el modelo de revenue las
agrupa de otra forma (todo el revenue margin en `dev.rm_rev` / `revenue_margin`,
vs. el split up front / fees / commercial discounts del gestional).

### 2.2 Signos de las líneas de costo
La query de Revenue por GD hace `sum(coalesce(dev.discount, discounts_net_usd))`
**sin `-1`**. El gestional hace `-SUM(pnl.discounts_net_usd * country_factor)`.
Donde `dev.*` ya viene firmado, coincide; donde cae al fallback `pnl.*_usd`, sale
con signo invertido. **Por eso el Δ de commercial_discounts, cancellations, COI,
CCP en el detalle línea-por-línea está roto hasta reconciliar signos.**

### 2.3 `country_factor` (5 decimales, por país·canal·producto)
El gestional escala commission / fee / discount por un factor de ajuste
(0.21–1.11) que corrige por confirmación, cancelaciones y mix. Revenue por GD
**no aplica ese factor** salvo lo que ya venga incorporado en `dev.*`.
En países con factor lejos de 1 (Chile API Hoteles = 0.217, CO API Hoteles = 0.689,
"Other" API Hoteles = 1.11) la diferencia por línea es grande.

### 2.4 Spine / doble conteo
- Gestional: 1 fila por `product_id` reconocido en `sales_recognition`.
- Revenue por GD: parte de `transactional_fact_charges` (1 fila por **cargo**),
  agrupa a `product_id` en `fact_sales`, y luego joinea `sales_recognition` (`fv`).
  El `WHERE` de `tx_sales` tiene una condición de `reservation_date` compleja
  (ventana móvil de 1 año + corte 2026-01) que puede incluir/excluir productos
  distintos que el gestional.

→ Esto explica el **Δ de Gross Bookings ~0.1%** (casi cuadra) y parte del Δ de orders.

### 2.5 Mapeo país / canal
- **Chile MAY** aparece casi vacío en Revenue por GD (ver preview): el gestional
  mueve a "Chile" ciertos `partner_id` (`AP13248`) y todo `country_code='CL'`,
  mientras que Revenue por GD usa `tr.site` — si esos productos tienen `tr.site`
  distinto de "Chile", caen en otro país. **Hallazgo abierto #1.**
- `lob_channel = NULL` en Revenue por GD (cuando `fv.parent_channel` no es API ni
  AFF) cae a MAY por default — arrastra GB/NR/FVM de canal desconocido. **Hallazgo abierto #2.**

### 2.6 Líneas sin fuente en Revenue por GD
La query no trae `income_from_outsourced_services`, `white_labels_api`,
`back_end_incentives`, `intercompany_usd`, `operations`, `vendor_commissions`
→ salen 0. `white_labels_api` (revenue WL/API) y `vendor_commissions`
(≈ el extra `agency_fee`) sí tienen contenido económico, así que **la suma de
líneas del detalle Revenue-GD no cierra contra su propio Net Revenue.**

---

## 3. Qué reconcilia y qué no (Abr–Ago 2026, Total B2B)

| Métrica | Δ (Gest − RevGD) | Lectura |
|---|---|---|
| Gross Bookings | ~0.1% | ✅ cuadra — misma base `gestion_gb * confirmation_gradient` |
| Net Revenue | ~1–2% | ✅ razonable — metodología distinta, magnitud esperable |
| FVM / NPV | ~5% Abr–Jun, OK Jul–Ago | ⚠️ revisar el corte del modelo `dev.fvm_rev` en meses viejos |
| up_front / fees / commercial_discounts | 2–14× por línea | ❌ **no comparable** — split distinto (§2.1) + signos (§2.2) + `country_factor` (§2.3). Sí cierran **sumados** contra el revenue margin |
| frauds, affiliates, COI, CCP | ~1–3% | ✅ cuadran — `dev.*` los trae bien firmados |
| Chile MAY | RevGD ≈ 0 | ❌ **hallazgo abierto #1** (mapeo país/canal) |

---

## 4. Cómo usar la vista

- **Cuadro resumen país × canal (NR + FVM)** → confiable. Sirve para detectar en
  qué país/canal hay una brecha material entre las dos metodologías.
- **Detalle P&L (Total / MAY / MIN)** → mirar **solo los subtotales** (Net Revenue,
  FVM) hasta cerrar §5. El Δ/Δ% por línea de costo no es interpretable.

---

## 5. Hallazgos abiertos (para sacar el "BORRADOR")

1. **Chile MAY vacío** — verificar contra el datalake por qué los productos B2B-API
   de Chile no aparecen del lado Revenue por GD (¿`tr.site` distinto? ¿el join
   `fv` los pierde?).
2. **`lob_channel = NULL` → MAY** — cuantificar el volumen (ahora `revenue_gd_builder.py`
   loguea `[WARN] N filas con lob_channel NULL`). Si es material, mapear explícito
   o descartar.
3. **Signos de las líneas de costo** — decidir: (a) negar en el builder las líneas
   que caen al fallback `pnl.*_usd`, o (b) ocultar el Δ/Δ% por línea y dejar solo
   los subtotales.
4. **`white_labels_api` / `vendor_commissions`** — traerlas de la query de Revenue
   por GD (`dev.*` las tiene) para que el detalle cierre contra su NR.
5. **FVM Abr–Jun** — el Δ de ~5% en los primeros meses sugiere que `dev.fvm_rev`
   tiene un corte / recálculo que no cubre bien el arranque de FY27.

---

*Última actualización: 2026-09-10 · junto con el commit que agrega el detalle por canal.*
