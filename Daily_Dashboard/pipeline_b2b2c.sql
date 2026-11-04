-- Pipeline B2B2C (fuente de la tabla de Pipeline Hunting, Metabase). Snapshot de sus resultados: Ownia_B2B_Ecosystem/public/weekly/pipeline-h2-26.json
-- Criterio de NR H2'27 de la slide: server/pipeline-slide.js (la rampa arranca en el mes del ETD; esta query la arranca el mes siguiente).
WITH
pnl_base AS (
  SELECT
    t.confirmation_date AS Mes,
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
        AND p.attach_stage = 'CHECKOUT'                               THEN 'Insurance'
      WHEN t.purchase_type = 'Actividades'                            THEN 'Dest. Serv.'
      WHEN t.purchase_type = 'Alquileres'                             THEN 'Vacation Rentals'
      WHEN t.purchase_type = 'Asistencia al viajero'                  THEN 'Insurance'
      WHEN t.purchase_type = 'Autos'                                  THEN 'Cars'
      WHEN t.purchase_type = 'Carrito'                                THEN 'Packages General'
      WHEN t.purchase_type = 'Bundles'                                THEN 'Packages General'
      WHEN t.purchase_type = 'Hoteles'                                THEN 'Hotels'
      WHEN t.purchase_type = 'Traslados'                              THEN 'Dest. Serv.'
      WHEN t.purchase_type = 'Vuelos'                                 THEN 'Flights'
      WHEN t.purchase_type = 'Circuito'                               THEN 'Dest. Serv.'
      WHEN t.purchase_type = 'Servicios en Destino'                   THEN 'Dest. Serv.'
      ELSE t.purchase_type
    END AS productooriginal,
    t.channel,
    CASE
      WHEN t.channel = 'affiliate-livelo-api' AND t.purchase_type = 'Hoteles'
        THEN 'livelo-api-hoteles'
      ELSE COALESCE(di.partner_homologado_2, t.partner_data_id)
    END AS partner,
    CASE
      WHEN p.trip_type = 'Nac' THEN 'Domestic'
      WHEN p.trip_type = 'Int' THEN 'International'
      ELSE p.trip_type
    END AS viaje,
    COUNT(DISTINCT t.transaction_code) AS Orders,
    sum(pnl.gb_without_distorted_taxes_usd) AS gross_bookings,
    sum(pnl.commission_net_usd)
    + SUM(pnl.fee_net_usd + pnl.coi_interest_usd
        - CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
               THEN pnl.fee_net_usd + pnl.coi_interest_usd ELSE 0 END)
    + (-SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                  AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
                 THEN 0 ELSE pnl.discounts_net_usd END))
    + sum(pnl.backend_air_usd + pnl.backend_non_air_usd)
    + sum(pnl.discounts_mkt_funds_usd + pnl.media_revenue_usd
          - pnl.mkt_fee_cost_cmr_usd + pnl.fee_income_mkt_cmr_usd)
    + (-sum(pnl.cancellations_usd))
    + sum(pnl.breakage_revenue_usd)
    + SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
               THEN CASE WHEN t.confirmation_date < date('2026-06-01')
                         THEN pnl.gb_without_distorted_taxes_usd * 0.0695
                         ELSE pnl.gb_without_distorted_taxes_usd * 0.0635 END
               ELSE 0 END)
    + sum(pnl.revenue_taxes_usd)
    + sum(pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd)
    AS net_revenues,
    sum(pnl.commission_net_usd)
    + SUM(pnl.fee_net_usd + pnl.coi_interest_usd
        - CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
               THEN pnl.fee_net_usd + pnl.coi_interest_usd ELSE 0 END)
    + (-SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                  AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
                 THEN 0 ELSE pnl.discounts_net_usd END))
    + sum(pnl.backend_air_usd + pnl.backend_non_air_usd)
    + sum(pnl.discounts_mkt_funds_usd + pnl.media_revenue_usd
          - pnl.mkt_fee_cost_cmr_usd + pnl.fee_income_mkt_cmr_usd)
    + (-sum(pnl.cancellations_usd))
    + sum(pnl.breakage_revenue_usd)
    + SUM(CASE WHEN t.channel IN ('yavas-callcenter','yavas-wl','yavas-agencias')
                AND t.purchase_type IN ('Carrito','Hoteles','Alquileres','Vuelos')
               THEN CASE WHEN t.confirmation_date < date('2026-06-01')
                         THEN pnl.gb_without_distorted_taxes_usd * 0.0695
                         ELSE pnl.gb_without_distorted_taxes_usd * 0.0635 END
               ELSE 0 END)
    + sum(pnl.revenue_taxes_usd)
    + sum(pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd)
    + (-sum(pnl.coi_usd))
    + (-sum(pnl.ccp_usd))
    + (-sum(pnl.mkt_cost_net_usd))
    + sum(pnl.errors_usd)
    + sum(ott_usd)
    + sum(pnl.customer_claims_usd)
    + sum(pnl.loyalty_usd) * 0
    + sum(CASE WHEN t.country_code = 'MX'
               THEN pnl.gb_without_distorted_taxes_usd * -0.004
               ELSE pnl.Customer_service_usd END)
    + sum(pnl.vendor_commission_usd)
    + sum(pnl.revenue_sharing_usd)
    + sum(CASE WHEN t.country_code = 'BR'
               THEN pnl.gb_without_distorted_taxes_usd * -0.0057
               ELSE pnl.gb_without_distorted_taxes_usd * -0.0054 END)
    + sum(pnl.dif_fx_usd + pnl.dif_fx_air_usd)
    + sum(pnl.currency_hedge_usd + pnl.currency_hedge_air_usd)
    + sum(pnl.financial_result_usd)
    AS FVM_Base,
    sum(pnl.breakage_revenue_usd)                                         AS breakage_revenue,
    sum(pnl.other_incentives_air_usd + pnl.other_incentives_non_air_usd) AS other_incentives,
    sum(pnl.backend_air_usd + pnl.backend_non_air_usd)                   AS back_end_incentives,
    sum(pnl.financial_result_usd)                                         AS efecto_financiero,
    sum(pnl.dif_fx_usd + pnl.dif_fx_air_usd)                            AS dif_fx,
    sum(pnl.currency_hedge_usd + pnl.currency_hedge_air_usd)             AS currency_hedge,
    sum(pnl.vendor_commission_usd)                                        AS channel_expenses
  FROM data.analytics.bi_pnlop_fact_current_model pnl
  JOIN data.analytics.bi_transactional_fact_products p
    ON CAST(p.product_id AS varchar) = CAST(pnl.product_id AS varchar)
  JOIN data.analytics.bi_transactional_fact_transactions t
    ON t.transaction_code = p.transaction_code
  LEFT JOIN (
    SELECT DISTINCT partner_id,
      FIRST_VALUE(partner_homologado_2) OVER (
        PARTITION BY partner_id ORDER BY partner_homologado_2
      ) AS partner_homologado_2
    FROM raw.comdev_cartera_b2b2c_historic
    WHERE partner_id IS NOT NULL AND LOWER(is_current) = 'true'
  ) di ON di.partner_id = t.partner_data_id
  WHERE pnl.date_reservation_year_month >= '2026-01'
    AND p.reservation_year_month  >= CAST('2026-01-01' AS date)
    AND t.reservation_year_month  >= CAST('2026-01-01' AS date)
    AND t.confirmation_date       >= date('2026-01-01')
    AND p.is_confirmed_flg = 1
    AND t.line_of_business = 'B2B2C'
  GROUP BY 1,2,3,4,5,6
),

pnl_with_ps AS (
  SELECT *,
    CASE WHEN LOWER(partner) LIKE '%banco%chile%'
         THEN FVM_Base * -0.55 ELSE 0 END AS profit_sharing_banco_chile,
    CASE WHEN LOWER(partner) LIKE '%turismocity%' AND pais = 'Argentina'
         THEN CASE
                WHEN productooriginal IN ('Flights','Hotels')
                  THEN -FVM_Base + gross_bookings * 0.015
                WHEN productooriginal = 'Packages General' AND viaje = 'International'
                  THEN FVM_Base * -0.55
                WHEN productooriginal = 'Packages General' AND viaje = 'Domestic'
                  THEN FVM_Base * -0.50
                ELSE 0
              END
         ELSE 0 END AS profit_sharing_turismocity,
    CASE WHEN LOWER(partner) LIKE '%viajes%naranja%'
         THEN (FVM_Base - breakage_revenue - other_incentives - back_end_incentives
               - efecto_financiero - dif_fx - currency_hedge
               - (gross_bookings * 0.022)) * -0.50
         ELSE 0 END AS profit_sharing_naranja,
    CASE WHEN LOWER(partner) LIKE '%viajes%naranja%'
         THEN CASE WHEN viaje = 'Domestic'
                   THEN gross_bookings * -0.055 ELSE 0 END
              + gross_bookings * 0.00452
         ELSE 0 END AS efecto_fin_naranja,
    CASE WHEN LOWER(partner) LIKE '%banco%chile%'
         THEN (gross_bookings * 0.005) - channel_expenses
         ELSE 0 END AS channel_expenses_delta
  FROM pnl_base
),

pnl_aggregated AS (
  SELECT
    DATE_FORMAT(Mes, '%Y-%m')            AS fecha,
    LOWER(CONCAT(pais, partner))         AS paispartner_key,
    SUM(Orders)                          AS Orders,
    SUM(net_revenues)                    AS pnl_net_revenues,
    SUM(
      FVM_Base
      + profit_sharing_banco_chile
      + profit_sharing_turismocity
      + profit_sharing_naranja
      + efecto_fin_naranja
      + channel_expenses_delta
    )                                    AS pnl_FVM
  FROM pnl_with_ps
  GROUP BY 1, 2
),

pnl_acum AS (
  SELECT
    paispartner_key,
    fecha,
    SUM(pnl_net_revenues) OVER (
      PARTITION BY paispartner_key ORDER BY fecha
    ) AS net_rev_acum
  FROM pnl_aggregated
),

pnl_primer_2000 AS (
  SELECT
    paispartner_key,
    MIN(CAST(DATE_PARSE(fecha, '%Y-%m') AS DATE)) AS fecha_primer_2000
  FROM pnl_acum
  WHERE net_rev_acum >= 2000
  GROUP BY paispartner_key
),

raw_deals AS (
  SELECT
    id, dealname, dealstage,
    CAST(amount AS DOUBLE)  AS amount,
    TRY_CAST(nr  AS DOUBLE) AS nr,
    TRY_CAST(fvm AS DOUBLE) AS fvm,
    closedate, hubspot_owner_id,
    hs_v2_date_entered_current_stage,
    paises_a_implementar, tipo_de_solucion,
    clientes_qty, industria__b2b2c,
    bz_case_development_solicitud__status
  FROM data.lake.media_sales_hubspot_deals
  WHERE pipeline = '806420524'
),

stage_map (stage_id, stage_label) AS (
  VALUES
    ('1186125205','Interesado'),        ('1186125206','NDA'),
    ('1186125207','Meet & Understand'), ('1186125208','Validation'),
    ('1186125209','Meet & Confirm'),    ('1186125210','Contract'),
    ('1211615860','Closed Won'),        ('1186125211','Closed Lost'),
    ('1186144623','Integrations'),      ('1186144624','Deploy'),
    ('1284876903','Close Deferred'),    ('1389463358','Change Management'),
    ('1389463359','Backlog'),           ('1389463360','Campanas'),
    ('1389463361','conciliacion'),      ('1389463362','Post-venta'),
    ('1389463363','Aguardando Retorno'),('1389477186','Blocked'),
	('1452894284','Prospect')
),

owner_map (owner_id, owner_label) AS (
  VALUES
    ('84372806','Felipe Zotelli'),    ('84730493','Felipe Kataoka'),
    ('83548033','Jose Ignacio Saenz'),('85274676','Suleyma Rodriguez'),
    ('86473434','Arturo Martinez'),   ('85274675','Daniel Alvarez'),
    ('101116757','Axel Suffern')
),

pais_partner_map (record_id, paispartner) AS (
  VALUES
    ('49218123947','BrasilSicredi'),        ('49217263508','BrasilSicoob Acumulo'),
    ('49237848880','BrasilCacau Lovers'),   ('49220151462','BrasilCaixa'),
    ('49241359528','BrasilITAU'),           ('49236012289','BrasilLivelo-API'),
    ('49238091788','BrasilDotz'),           ('49225814683','BrasilClaro'),
    ('49236023097','BrasilBradesco'),       ('49236197207','MexicoBonda'),
    ('49238091789','ArgentinaYPF'),         ('49241400322','MexicoSams'),
    ('53500174250','BrasilVibe'),           ('53946448899','ChileBanco de Chile'),
    ('54352854609','MexicoViva'),           ('55113400211','BrasilBanco Pan'),
    ('55113585780','BrasilElo'),            ('56889333853','BrasilCSU'),
    ('57021729388','BrasilPrivalia'),       ('57030589567','BrasilCaixa'),
    ('59418479105','BrasilCSU'),            ('59728233120','BrasilCSU'),
    ('59728107892','MexicoAVASA'),          ('60353344155','ColombiaBancolombia'),
    ('60708363828','BrasilDotz'),           ('62121496166','BrasilKoin'),
    ('62115620612','ChileTurismoCity'),     ('62115620612','ColombiaTurismoCity'),
    ('62115620612','BrasilTurismoCity'),    ('63027739984','ColombiaTuplus'),
    ('63436819532','Brasillivelo-api-hoteles'),('63929569611','MexicoLiverpool'),
    ('64338307169','BrasilNomad'),          ('49236215089','MexicoUp Si Vale'),
    ('49208928546','MexicoBanco Plata'),    ('49220644665','Other CountriesCUTC'),
    ('','ArgentinaBNA'),                    ('49236197207','ArgentinaBonda'),
    ('','ArgentinaCocos'),                  ('','ArgentinaNew Fly'),
    ('','ArgentinaTiendaclic'),             ('','ArgentinaTurismoCity'),
    ('55117179038','BrasilLocaliza'),       ('55116992651','BrasilMercado Pago'),
    ('55117180005','BrasilSantander'),      ('','BrasilVivo'),
    ('','MexicoInvex')
),

partner_count AS (
  SELECT record_id, COUNT(*) AS num_partners
  FROM pais_partner_map
  GROUP BY record_id
),

crm_enriched AS (
  SELECT
    r.id                                                                  AS record_id,
    r.dealname                                                            AS deal_name,
    COALESCE(sm.stage_label, r.dealstage)                                 AS deal_stage,
    r.amount, r.nr, r.fvm,
    TRY_CAST(from_iso8601_timestamp(r.closedate) AS DATE)                 AS close_date,
    COALESCE(om.owner_label, r.hubspot_owner_id)                          AS deal_owner,
    TRY_CAST(from_iso8601_timestamp(r.hs_v2_date_entered_current_stage) AS DATE)
                                                                          AS date_entered_stage,
    r.paises_a_implementar AS paises, r.tipo_de_solucion AS tipo_solucion,
    r.clientes_qty, r.bz_case_development_solicitud__status AS bz_case_status,
    r.industria__b2b2c AS industria,
    ppm.paispartner,
    COALESCE(pc.num_partners, 1) AS num_partners
  FROM raw_deals r
  LEFT JOIN stage_map sm         ON r.dealstage        = sm.stage_id
  LEFT JOIN owner_map om         ON r.hubspot_owner_id = om.owner_id
  LEFT JOIN pais_partner_map ppm ON r.id               = ppm.record_id
  LEFT JOIN partner_count pc     ON r.id               = pc.record_id
),

crm_filtered AS (
  SELECT *,
    DATE_DIFF('day', date_entered_stage, CURRENT_DATE - INTERVAL '1' DAY) AS days_in_stage
  FROM crm_enriched
  WHERE deal_stage NOT IN ('Close Deferred','Closed Lost','Prospect')
    AND NOT REGEXP_LIKE(LOWER(COALESCE(deal_name, '')), '(^|[^a-z0-9])(test |pruebas?([^a-z0-9]|$))')
),

crm_deals AS (
  SELECT *,
    CASE
      WHEN deal_stage = 'Deploy' AND paispartner IS NOT NULL THEN 'Deployed'
      ELSE 'Pipeline'
    END AS Pipeline_Status,
    CASE
      WHEN ((CASE WHEN paises LIKE '%Brasil%' THEN 1 ELSE 0 END)
           +(CASE WHEN paises LIKE '%M_xico%' OR paises LIKE '%Mexico%'
                       OR paises LIKE '%Estados Unidos%' THEN 1 ELSE 0 END)
           +(CASE WHEN paises LIKE '%Argentina%' OR paises LIKE '%Chile%'
                       OR paises LIKE '%Colombia%' OR paises LIKE '%Ecuador%'
                       OR paises LIKE '%Per_%' OR paises LIKE '%Uruguay%'
                       OR paises LIKE '%Paraguay%' OR paises LIKE '%Bolivia%' THEN 1 ELSE 0 END)
           ) > 1                                                              THEN 'Multi-Region'
      WHEN paises LIKE '%Brasil%'                                             THEN 'BR'
      WHEN paises LIKE '%M_xico%' OR paises LIKE '%Mexico%'
            OR paises LIKE '%Estados Unidos%'                                 THEN 'MX/US'
      WHEN paises LIKE '%Argentina%' OR paises LIKE '%Chile%'
            OR paises LIKE '%Colombia%' OR paises LIKE '%Ecuador%'
            OR paises LIKE '%Per_%' OR paises LIKE '%Uruguay%'
            OR paises LIKE '%Paraguay%' OR paises LIKE '%Bolivia%'           THEN 'HISPA'
      ELSE NULL
    END AS Region
  FROM crm_filtered
),

deployed AS (
  SELECT record_id, deal_name, amount, nr, fvm, close_date,
         Pipeline_Status AS status_crm, deal_stage, Region, paises, tipo_solucion,
         paispartner, num_partners, clientes_qty, bz_case_status
  FROM crm_deals
  WHERE Pipeline_Status = 'Deployed'
     OR paispartner IS NULL
),

partners_agrupados AS (
  SELECT
    CONCAT(cart.country, cart.partner_homologado_2)    AS pais_partnerhomologado,
    MAX(cart.stage)                                    AS stage_cartera,
    MAX(cart.estatus_tier)                             AS estatus_tier,
    MAX(cart.region)                                   AS region_cartera
  FROM data.raw.comdev_cartera_b2b2c_historic cart
  WHERE UPPER(cart.is_current) = 'TRUE'
    AND cart.partner_homologado_2 IS NOT NULL
  GROUP BY cart.country, cart.partner_homologado_2
),

with_partner AS (
  SELECT d.*,
    CASE
      WHEN pp.fecha_primer_2000 IS NOT NULL THEN 'Prendido'
      WHEN d.status_crm = 'Deployed'        THEN 'Deployed'
      ELSE 'Pipeline'
    END                                          AS Pipeline_Status,
    pp.fecha_primer_2000                         AS FechaPrimer2000,
    COALESCE(pp.fecha_primer_2000, d.close_date) AS FechaBase,
    pa.stage_cartera,
    pa.estatus_tier,
    pa.region_cartera
  FROM deployed d
  LEFT JOIN partners_agrupados pa ON d.paispartner = pa.pais_partnerhomologado
  LEFT JOIN pnl_primer_2000 pp    ON LOWER(d.paispartner) = pp.paispartner_key
),

ramp_curve (month_ID, percentage) AS (
  VALUES
    (1,0.042),(2,0.083),(3,0.125),(4,0.167),(5,0.208),(6,0.250),
    (7,0.292),(8,0.333),(9,0.375),(10,0.417),(11,0.458),(12,0.500),
    (13,0.525),(14,0.550),(15,0.575),(16,0.600),(17,0.625),(18,0.650),
    (19,0.675),(20,0.700),(21,0.725),(22,0.750),(23,0.775),(24,0.800),
    (25,0.817),(26,0.833),(27,0.850),(28,0.867),(29,0.883),(30,0.900),
    (31,0.917),(32,0.933),(33,0.950),(34,0.967),(35,0.983),(36,1.000)
),

with_ramp AS (
  SELECT wp.*, mes.Mes_ID
  FROM with_partner wp
  CROSS JOIN (SELECT t.Mes_ID FROM UNNEST(SEQUENCE(1, 36)) AS t(Mes_ID)) mes
  WHERE wp.FechaBase IS NOT NULL
),

with_ramp_curve AS (
  SELECT
    wr.record_id,
    wr.deal_name,
    wr.amount,
    wr.nr,
    wr.fvm,
    wr.close_date,
    wr.Pipeline_Status,
    wr.deal_stage,
    wr.Region,
    wr.paises,
    wr.tipo_solucion,
    COALESCE(LOWER(wr.paispartner),
             CONCAT('sin_mapeo_', wr.record_id))       AS paispartner_lower,
    wr.num_partners,
    wr.clientes_qty,
    wr.bz_case_status,
    wr.FechaPrimer2000,
    wr.FechaBase,
    wr.stage_cartera,
    wr.estatus_tier,
    wr.region_cartera,
    CAST(wr.Mes_ID AS BIGINT)                          AS Mes_ID,
    CAST(rc.percentage AS DOUBLE)                      AS percentage,
    DATE_FORMAT(
      DATE_TRUNC('month',
        DATE_ADD('month', wr.Mes_ID,
          DATE_TRUNC('month', CAST(wr.FechaBase AS DATE))
        )
      ), '%Y-%m'
    )                                                  AS mes_anio_str,
    CASE WHEN wr.amount IS NULL OR rc.percentage IS NULL THEN NULL
         ELSE ROUND((wr.amount / CAST(wr.num_partners AS DOUBLE))
                    * rc.percentage / 12.0, 2)
    END                                                AS Amount_by_month,
    CASE WHEN wr.nr IS NULL OR wr.nr = 0 OR wr.fvm IS NULL THEN NULL
         ELSE ROUND((wr.amount / CAST(wr.num_partners AS DOUBLE))
                    * wr.fvm / wr.nr, 2)
    END                                                AS amount_fvm,
    CASE WHEN wr.nr IS NULL OR wr.nr = 0
              OR wr.fvm IS NULL OR rc.percentage IS NULL THEN NULL
         ELSE ROUND((wr.amount / CAST(wr.num_partners AS DOUBLE))
                    * wr.fvm / wr.nr * rc.percentage / 12.0, 2)
    END                                                AS amount_by_month_fvm
  FROM with_ramp wr
  LEFT JOIN ramp_curve rc ON wr.Mes_ID = rc.month_ID
),

crm_por_mes_agg AS (
  SELECT
    paispartner_lower,
    mes_anio_str                   AS fecha,
    MAX(record_id)                 AS record_id,
    MAX(deal_name)                 AS deal_name,
    MAX(amount)                    AS amount,
    MAX(nr)                        AS nr_hubspot,
    MAX(fvm)                       AS fvm_hubspot,
    MAX(close_date)                AS close_date,
    MAX(Pipeline_Status)           AS Pipeline_Status,
    MAX(deal_stage)                AS deal_stage,
    MAX(Region)                    AS Region,
    MAX(paises)                    AS paises,
    MAX(tipo_solucion)             AS tipo_solucion,
    MAX(num_partners)              AS num_partners,
    MAX(clientes_qty)              AS clientes_qty,
    MAX(bz_case_status)            AS bz_case_status,
    MAX(FechaPrimer2000)           AS FechaPrimer2000,
    MAX(FechaBase)                 AS FechaBase,
    MAX(Mes_ID)                    AS Mes_ID,
    MAX(percentage)                AS percentage,
    SUM(Amount_by_month)           AS Amount_by_month,
    SUM(amount_fvm)                AS amount_fvm,
    SUM(amount_by_month_fvm)       AS amount_by_month_fvm,
    MAX(stage_cartera)             AS stage_cartera,
    MAX(estatus_tier)              AS estatus_tier,
    MAX(region_cartera)            AS region_cartera
  FROM with_ramp_curve
  GROUP BY paispartner_lower, mes_anio_str
),

final AS (
  SELECT
    r.fecha,
    r.paispartner_lower AS paispartner,
    r.record_id,
    r.deal_name,
    r.amount,
    r.nr_hubspot,
    r.fvm_hubspot,
    r.close_date,
    r.Pipeline_Status,
    r.deal_stage,
    r.Region,
    r.paises,
    r.tipo_solucion,
    r.num_partners,
    r.clientes_qty,
    r.bz_case_status,
    r.FechaPrimer2000,
    r.FechaBase,
    r.Mes_ID,
    r.percentage,
    r.Amount_by_month,
    r.amount_fvm,
    r.amount_by_month_fvm,
    r.stage_cartera,
    r.estatus_tier,
    r.region_cartera,
    p.Orders,
    p.pnl_net_revenues,
    p.pnl_FVM
  FROM crm_por_mes_agg r
  LEFT JOIN pnl_aggregated p
    ON  p.fecha           = r.fecha
    AND p.paispartner_key = r.paispartner_lower
)

SELECT
  MAX(deal_name)                                  AS deal,
  record_id,
  MAX(deal_stage)                                 AS etapa,
  MAX(close_date)                                 AS cierre,
  MAX(Region)                                     AS region,
  MAX(paises)                                     AS paises,
  MAX(tipo_solucion)                              AS solucion,
  MAX(amount)                                     AS amount,
  MAX(num_partners)                               AS num_partners,
  MAX(nr_hubspot)                                 AS nr_hubspot,
  MAX(fvm_hubspot)                                AS fvm_hubspot
FROM final
WHERE Pipeline_Status = 'Pipeline'
  AND DATE_FORMAT(close_date, '%Y-%m') BETWEEN '2026-10' AND '2027-03'
GROUP BY record_id
ORDER BY amount DESC NULLS LAST
