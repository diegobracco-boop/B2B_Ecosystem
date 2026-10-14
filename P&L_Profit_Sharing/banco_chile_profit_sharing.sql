-- ══════════════════════════════════════════════════════════════════════
-- Banco de Chile · Profit Sharing · Mayo–Agosto 2026
-- Lógica alineada al PnL Operativo:
--   ✅ LOWER(is_current) = 'true'
--   ✅ Sin JOIN a cancellations (vienen de pnl.cancellations_usd)
--   ✅ Partner como LEFT JOIN puro → filtro post-agregación en enriched
--   ✅ coup LEFT JOIN incluido (partner_benefits)
--   ✅ FVM_Base incluye channel_expenses para profit sharing correcto
-- ── Adaptaciones tipo_venta ────────────────────────────────────────────
--   ✅ ① Cotización / Carrito → purchase_type = 'Carrito' + Con agente
--   ✅ ② Agencias             → purchase_type != 'Carrito' + Con agente
--   ✅ ③ WLs                 → Sin agente (agent_code IS NULL)
-- ── punto_venta ───────────────────────────────────────────────────────
--   ✅ Presencial  → ag.agency_code = 'AG00120467'
--   ✅ Call Center → ag.agency_code = 'AG00120475'
--   ✅ ON          → sin agente (cbs.agent_code IS NULL)
--   ✅ Fuente: data.analytics.bi_common_dim_agents
-- ── product_state ─────────────────────────────────────────────────────
--   ✅ MAX(cs.product_state) → estado actual del producto
--   ✅ Fuente: bi_transactional_fact_products_current_state
-- ── Leases ────────────────────────────────────────────────────────────
--   ✅ Solo para punto_venta = 'Presencial'
--   ✅ may-26 = -2.213,67 | jun-26 = -11.577,22 | jul-26 = -11.632,91
--   ✅ ago-26 y sep-26 = -11.632,91 (idem jul)
--   ✅ mes en curso = tasa diaria jul × (DAY(CURRENT_DATE)-1) [dinámica]
--   ✅ Distribuido igualmente entre txns Presencial del mes
-- ── Comisiones vendedores ─────────────────────────────────────────────
--   ✅ comisiones_presencial  → gross_bookings × -1.7% (Presencial)
--   ✅ comisiones_call_center → gross_bookings × -1.7% (Call Center)
-- ── channel_expenses ──────────────────────────────────────────────────
--   ✅ leases + comisiones_presencial + comisiones_call_center
--   ✅ Reemplaza vendor_commission_usd
--   ✅ Detalle expuesto al final, post profit_share_a_pagar
-- ── cancellations ─────────────────────────────────────────────────────
--   ✅ Multiplicado por 0 (campo y FVM_Base)
-- ── coi_imputado (2026-10-13; 24 cuotas sacado el 2026-10-14 con el comercial) ─
--   Ventas en cuotas sin Cost of Installments en el Datalake: el COI del banco recién
--   aparece el 16/06/2026 en 6 y 12 cuotas.
--   Tasa del banco: 6 cuotas = 3% anual · 12 = 5%.
--   Costo compuesto = (1 + tasa anual)^(cuotas/12) − 1  →  6: 1,49% · 12: 5,00% del GB
--   Aplica a: 6 y 12 cuotas confirmadas antes del 16/06/2026,
--   solo si la transacción no tiene COI (|cost_of_installments| < 0,01). Entra en FVM_Base.
--   24 cuotas: no se imputa COI (definido con el comercial 2026-10-14).
-- ══════════════════════════════════════════════════════════════════════

WITH src AS (
  SELECT
    t.transaction_code,
    date_format(t.confirmation_date, '%Y-%m')        AS Mes,
    t.confirmation_date                               AS fecha_confirmacion,
    t.brand                                           AS Marca,
    t.country_code,
    t.channel,
    t.purchase_type,
    t.partner_data_id,
    p.product_type,
    p.attach_stage,
    p.trip_type,

    CASE
      WHEN t.purchase_type = 'Carrito'
           AND cbs.agent_code IS NOT NULL  THEN '① Cotización / Carrito'
      WHEN t.purchase_type != 'Carrito'
           AND cbs.agent_code IS NOT NULL  THEN '② Agencias'
      WHEN cbs.agent_code IS NULL          THEN '③ WLs'
      ELSE 'Otros'
    END AS tipo_venta,

    CASE
      WHEN ag.agency_code = 'AG00120467' THEN 'Presencial'
      WHEN ag.agency_code = 'AG00120475' THEN 'Call Center'
      ELSE 'ON'
    END AS punto_venta,

    ag.agency_code,
    ag.agent_name,

    -- ✅ NUEVO: estado actual del producto
    cs.product_state,

    -- ✅ NUEVO (2026-10-13): cuotas de la venta (0, 3, 6, …) — bi_transactional_fact_collections
    col.installments AS cuotas,

    CASE
      WHEN t.country_code IN ('MX','BR','CO','AR','EC','PE','CL') THEN
        CASE t.country_code
          WHEN 'MX' THEN 'Mexico'   WHEN 'BR' THEN 'Brasil'
          WHEN 'CO' THEN 'Colombia' WHEN 'AR' THEN 'Argentina'
          WHEN 'EC' THEN 'Ecuador'  WHEN 'PE' THEN 'Peru'
          WHEN 'CL' THEN 'Chile'
        END
      ELSE 'Other Countries'
    END AS pais,

    CASE
      WHEN t.purchase_type IN ('Vuelos','Bundles','Escapadas','Carrito')
           AND p.product_type = 'Asistencia al viajero'
           AND p.attach_stage = 'CHECKOUT'            THEN 'Insurance'
      WHEN t.purchase_type = 'Actividades'            THEN 'Dest. Serv.'
      WHEN t.purchase_type = 'Alquileres'             THEN 'Vacation Rentals'
      WHEN t.purchase_type = 'Asistencia al viajero'  THEN 'Insurance'
      WHEN t.purchase_type = 'Autos'                  THEN 'Cars'
      WHEN t.purchase_type = 'Carrito'                THEN 'Packages General'
      WHEN t.purchase_type = 'Bundles'                THEN 'Packages General'
      WHEN t.purchase_type = 'Hoteles'                THEN 'Hotels'
      WHEN t.purchase_type = 'Traslados'              THEN 'Dest. Serv.'
      WHEN t.purchase_type = 'Vuelos'                 THEN 'Flights'
      WHEN t.purchase_type = 'Circuito'               THEN 'Dest. Serv.'
      WHEN t.purchase_type = 'Servicios en Destino'   THEN 'Dest. Serv.'
      ELSE t.purchase_type
    END AS productooriginal,

    CASE
      WHEN t.channel = 'affiliate-livelo-api' AND t.purchase_type = 'Hoteles'
        THEN 'livelo-api-hoteles'
      WHEN t.partner_data_id IN ('AG00120475', 'AG00120467')
        THEN 'banco-de-chile'
      ELSE COALESCE(di.partner_homologado_2, t.partner_data_id)
    END AS partner,

    CASE
      WHEN p.trip_type = 'Nac' THEN 'Domestic'
      WHEN p.trip_type = 'Int' THEN 'International'
      ELSE p.trip_type
    END AS viaje,

    -- métricas PnL
    pnl.gb_without_distorted_taxes_usd,
    pnl.commission_net_usd,
    pnl.fee_net_usd,
    pnl.coi_interest_usd,
    pnl.discounts_net_usd,
    pnl.backend_air_usd,
    pnl.backend_non_air_usd,
    COALESCE(coup.amount_used_usd, pnl.discounts_mkt_funds_usd) AS coupon_or_mkt_funds,
    pnl.media_revenue_usd,
    pnl.mkt_fee_cost_cmr_usd,
    pnl.fee_income_mkt_cmr_usd,
    pnl.cancellations_usd,
    pnl.breakage_revenue_usd,
    pnl.revenue_taxes_usd,
    pnl.other_incentives_air_usd,
    pnl.other_incentives_non_air_usd,
    pnl.coi_usd,
    pnl.ccp_usd,
    pnl.mkt_cost_net_usd,
    pnl.errors_usd,
    pnl.ott_usd,
    pnl.customer_claims_usd,
    pnl.loyalty_usd,
    pnl.customer_service_usd,
    pnl.vendor_commission_usd,
    pnl.revenue_sharing_usd,
    pnl.dif_fx_usd,
    pnl.dif_fx_air_usd,
    pnl.currency_hedge_usd,
    pnl.currency_hedge_air_usd,
    pnl.financial_result_usd

  FROM data.analytics.bi_pnlop_fact_current_model pnl

  JOIN data.analytics.bi_transactional_fact_products p
    ON CAST(p.product_id AS VARCHAR) = CAST(pnl.product_id AS VARCHAR)

  JOIN data.analytics.bi_transactional_fact_transactions t
    ON t.transaction_code = p.transaction_code

  LEFT JOIN data.lake.channels_bo_sale cbs
    ON CAST(cbs.transaction_id AS VARCHAR) = CAST(t.transaction_code AS VARCHAR)

  LEFT JOIN data.analytics.bi_common_dim_agents ag
    ON ag.agent_code = cbs.agent_code

  -- ✅ NUEVO: estado actual del producto
  LEFT JOIN data.analytics.bi_transactional_fact_products_current_state cs
    ON CAST(cs.product_id AS VARCHAR) = CAST(pnl.product_id AS VARCHAR)

  LEFT JOIN (
    SELECT DISTINCT
      partner_id,
      FIRST_VALUE(partner_homologado_2) OVER (
        PARTITION BY partner_id
        ORDER BY partner_homologado_2
      ) AS partner_homologado_2
    FROM raw.comdev_cartera_b2b2c_historic
    WHERE partner_id IS NOT NULL
      AND LOWER(is_current) = 'true'
  ) di ON di.partner_id = t.partner_data_id

  LEFT JOIN (
    SELECT
      c.consumption_transaction,
      CAST(SUM(c.amount_used) AS DOUBLE)
        * CAST(MAX(t2.conversion_rate) AS DOUBLE) AS amount_used_usd
    FROM data.lake.coupons_consumption c
    JOIN data.lake.coupons_channels ch
      ON  ch.coupon_id = c.coupon_id
      AND ch.channel   = 'partner_benefits'
    JOIN data.analytics.bi_transactional_fact_transactions t2
      ON  CAST(t2.transaction_code AS VARCHAR) = c.consumption_transaction
      AND t2.reservation_year_month >= CAST('2023-01-01' AS DATE)
    GROUP BY c.consumption_transaction
  ) coup ON CAST(coup.consumption_transaction AS VARCHAR) = CAST(t.transaction_code AS VARCHAR)

  -- ✅ NUEVO: cuotas (1 fila por transacción; MAX por si hay más de un cobro)
  LEFT JOIN (
    SELECT
      transaction_code,
      MAX(installments) AS installments
    FROM data.analytics.bi_transactional_fact_collections
    WHERE reservation_year_month >= DATE '2023-01-01'
    GROUP BY transaction_code
  ) col ON CAST(col.transaction_code AS VARCHAR) = CAST(t.transaction_code AS VARCHAR)

  WHERE pnl.date_reservation_year_month >= '2026-05'
    AND p.reservation_year_month >= CAST('2023-01-01' AS DATE)
    AND t.reservation_year_month >= CAST('2023-01-01' AS DATE)
    AND t.confirmation_date >= DATE('2026-05-01')
    AND t.confirmation_date <= CURRENT_DATE
    AND p.is_confirmed_flg = 1
    AND t.line_of_business = 'B2B2C'
    AND t.country_code = 'CL'
),

-- ══════════════════════════════════════════════════════════════════════
-- base: agrega a nivel transacción
-- ══════════════════════════════════════════════════════════════════════
base AS (
  SELECT
    transaction_code,
    Mes,
    Marca,
    pais,
    productooriginal,
    channel,
    partner,
    viaje,
    country_code,
    tipo_venta,
    punto_venta,
    agency_code,
    agent_name,

    -- ✅ NUEVO: MAX para mantener granularidad transacción
    MAX(product_state)                                           AS product_state,
    MAX(cuotas)                                                  AS cuotas,
    MAX(fecha_confirmacion)                                      AS fecha_confirmacion,

    COUNT(DISTINCT transaction_code)                             AS orders,
    SUM(gb_without_distorted_taxes_usd)                         AS gross_bookings,
    SUM(commission_net_usd)                                      AS up_front_incentives,
    SUM(fee_net_usd + coi_interest_usd)                         AS fees,
    -SUM(discounts_net_usd)                                     AS commercial_discounts,
    SUM(backend_air_usd + backend_non_air_usd)                  AS back_end_incentives,

    SUM(
      coupon_or_mkt_funds + media_revenue_usd
      - mkt_fee_cost_cmr_usd + fee_income_mkt_cmr_usd
    )                                                           AS media_other_revenue,

    -- ✅ cancellations × 0
    -SUM(cancellations_usd) * 0                                 AS cancellations,
    SUM(breakage_revenue_usd)                                   AS breakage_revenue,
    SUM(revenue_taxes_usd)                                      AS revenue_tax,
    SUM(other_incentives_air_usd + other_incentives_non_air_usd) AS other_incentives,
    -SUM(coi_usd)                                               AS cost_of_installments,
    -SUM(ccp_usd)                                               AS credit_card_processing,
    -SUM(mkt_cost_net_usd)                                      AS mkt_usd,
    SUM(errors_usd)                                             AS errors,
    SUM(ott_usd)                                                AS other_transactional_taxes,
    SUM(customer_claims_usd)                                    AS customer_claims,
    SUM(loyalty_usd) * 0                                        AS loyalty_usd,

    SUM(
      CASE WHEN country_code = 'MX'
           THEN gb_without_distorted_taxes_usd * -0.004
           ELSE customer_service_usd
      END
    )                                                           AS customer_service,

    SUM(revenue_sharing_usd)                                    AS white_labels_api_base,

    SUM(
      CASE WHEN country_code = 'BR'
           THEN gb_without_distorted_taxes_usd * -0.0057
           ELSE gb_without_distorted_taxes_usd * -0.0054
      END
    )                                                           AS intercompany_USD,

    SUM(dif_fx_usd + dif_fx_air_usd)                           AS dif_fx,
    SUM(currency_hedge_usd + currency_hedge_air_usd)            AS currency_hedge,
    SUM(financial_result_usd)                                   AS efecto_financiero,

    -- ── NET REVENUES ──────────────────────────────────────────────────
    SUM(commission_net_usd)
    + SUM(fee_net_usd + coi_interest_usd)
    + (-SUM(discounts_net_usd))
    + SUM(backend_air_usd + backend_non_air_usd)
    + SUM(coupon_or_mkt_funds + media_revenue_usd - mkt_fee_cost_cmr_usd + fee_income_mkt_cmr_usd)
    + (-SUM(cancellations_usd)) * 0                             -- ✅ × 0
    + SUM(breakage_revenue_usd)
    + SUM(revenue_taxes_usd)
    + SUM(other_incentives_air_usd + other_incentives_non_air_usd)
    AS net_revenues,

    -- ── FVM_Base_partial ──────────────────────────────────────────────
    SUM(commission_net_usd)
    + SUM(fee_net_usd + coi_interest_usd)
    + (-SUM(discounts_net_usd))
    + SUM(backend_air_usd + backend_non_air_usd)
    + SUM(coupon_or_mkt_funds + media_revenue_usd - mkt_fee_cost_cmr_usd + fee_income_mkt_cmr_usd)
    + (-SUM(cancellations_usd)) * 0                             -- ✅ × 0
    + SUM(breakage_revenue_usd)
    + SUM(revenue_taxes_usd)
    + SUM(other_incentives_air_usd + other_incentives_non_air_usd)
    + (-SUM(coi_usd))
    + (-SUM(ccp_usd))
    + (-SUM(mkt_cost_net_usd))
    + SUM(errors_usd)
    + SUM(ott_usd)
    + SUM(customer_claims_usd)
    + SUM(loyalty_usd) * 0
    + SUM(CASE WHEN country_code = 'MX'
               THEN gb_without_distorted_taxes_usd * -0.004
               ELSE customer_service_usd END)
    + SUM(revenue_sharing_usd)
    + SUM(CASE WHEN country_code = 'BR'
               THEN gb_without_distorted_taxes_usd * -0.0057
               ELSE gb_without_distorted_taxes_usd * -0.0054 END)
    + SUM(dif_fx_usd + dif_fx_air_usd)
    + SUM(currency_hedge_usd + currency_hedge_air_usd)
    + SUM(financial_result_usd)
    AS FVM_Base_partial

  FROM src
  GROUP BY
    transaction_code, Mes, Marca, pais, productooriginal,
    channel, partner, viaje, country_code,
    tipo_venta, punto_venta, agency_code, agent_name
),

-- ══════════════════════════════════════════════════════════════════════
-- enriched: leases y comisiones sobre base filtrada
-- ══════════════════════════════════════════════════════════════════════
enriched AS (
  SELECT
    b.*,

    -- ① leases: solo punto_venta = 'Presencial', distribuido igualmente por mes
    CASE WHEN b.punto_venta = 'Presencial' THEN
      CASE b.Mes
        WHEN '2026-05' THEN -2213.67
        WHEN '2026-06' THEN -11577.22
        WHEN '2026-07' THEN -11632.91
        WHEN '2026-08' THEN -11632.91   -- idem jul (decisión de Diego 2026-10-13)
        WHEN '2026-09' THEN -11632.91   -- idem jul
        WHEN date_format(CURRENT_DATE, '%Y-%m') THEN
          (-11632.91 / 31.0) * CAST(DAY(CURRENT_DATE) - 1 AS DOUBLE)
        ELSE 0.0
      END
      / NULLIF(
          SUM(CASE WHEN b.punto_venta = 'Presencial' THEN 1 ELSE 0 END)
          OVER (PARTITION BY b.Mes),
          0
        )
    ELSE 0.0
    END AS leases,

    -- ② comisiones_presencial: gross_bookings × -1.7%
    CASE
      WHEN b.punto_venta = 'Presencial'
        THEN b.gross_bookings * -0.017
      ELSE 0.0
    END AS comisiones_presencial,

    -- ③ comisiones_call_center: gross_bookings × -1.7%
    CASE
      WHEN b.punto_venta = 'Call Center'
        THEN b.gross_bookings * -0.017
      ELSE 0.0
    END AS comisiones_call_center,

    -- ④ coi_imputado: costo compuesto del banco para ventas en cuotas sin COI (ver header)
    CASE
      WHEN ABS(b.cost_of_installments) >= 0.01 THEN 0.0
      WHEN b.cuotas = 6  AND b.fecha_confirmacion < DATE '2026-06-16'
        THEN b.gross_bookings * -(POWER(1.03, 6 / 12.0) - 1)
      WHEN b.cuotas = 12 AND b.fecha_confirmacion < DATE '2026-06-16'
        THEN b.gross_bookings * -(POWER(1.05, 12 / 12.0) - 1)
      ELSE 0.0
    END AS coi_imputado

  FROM base b
  WHERE LOWER(b.partner) LIKE '%banco%chile%'
)

-- ══════════════════════════════════════════════════════════════════════
-- SELECT final
-- ══════════════════════════════════════════════════════════════════════
SELECT
  transaction_code,
  Mes,
  Marca,
  pais,
  productooriginal,
  channel,
  partner,
  tipo_venta,
  punto_venta,
  agency_code,
  agent_name,
  product_state,
  cuotas,
  viaje,
  orders,
  gross_bookings,
  up_front_incentives,
  fees,
  commercial_discounts,
  back_end_incentives,
  media_other_revenue,
  cancellations,
  breakage_revenue,
  revenue_tax,
  other_incentives,
  cost_of_installments,
  coi_imputado,
  credit_card_processing,
  mkt_usd,
  errors,
  other_transactional_taxes,
  customer_claims,
  loyalty_usd,
  customer_service,

  -- ✅ channel_expenses = leases + comisiones_presencial + comisiones_call_center
  leases + comisiones_presencial + comisiones_call_center                     AS channel_expenses,

  white_labels_api_base
    + ((FVM_Base_partial + leases + comisiones_presencial + comisiones_call_center + coi_imputado) * -0.55)
                                                                              AS white_labels_api,
  intercompany_USD,
  dif_fx,
  currency_hedge,
  efecto_financiero,
  net_revenues,

  FVM_Base_partial + leases + comisiones_presencial + comisiones_call_center + coi_imputado  AS FVM_Base,

  (FVM_Base_partial + leases + comisiones_presencial + comisiones_call_center + coi_imputado) * 0.45
                                                                              AS FVM,
  (FVM_Base_partial + leases + comisiones_presencial + comisiones_call_center + coi_imputado) * 0.55
                                                                              AS profit_share_a_pagar,

  -- ✅ Detalle al final, post profit_share_a_pagar
  leases,
  comisiones_presencial,
  comisiones_call_center

FROM enriched
ORDER BY Mes, tipo_venta, punto_venta, agent_name
