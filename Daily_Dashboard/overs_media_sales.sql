-- COPIA del modelo Metabase 94359 "Historico + Forecast || Negociaciones Media Sales" (2026-11-05), la base de la card 115835
-- "Historico + Forecast || Negociaciones Media Sales - Variable: Overs" (la card suma media_real / media_forecast de las filas con
-- flg_overcomission = 1, por anio_mes_negociado). overs_sync.py le pone encima ese filtro y esa suma.
-- Si cambia la definicion en Metabase, pegar aca el SQL nuevo tal cual (sin ';' final).
WITH

cartera_aloja AS (
    SELECT DISTINCT
         hotel_id          AS id_proveedor
        ,nombre_hotel       AS nombre_proveedor
        ,eecc
        ,eecc_chains
        -- ,market_chains
        -- ,area_chains
        ,area
        ,market
        ,tipo_de_cuenta
        -- ,categoria_de_cuenta_geo
        -- ,categoria_de_cuenta_chains
        ,geo_ggcc
        ,market_objetivo
    FROM  lake.bi_sourcing_cartera_alojamiento
    WHERE anio_semana = (SELECT MAX(anio_semana) FROM lake.bi_sourcing_cartera_alojamiento WHERE anio_semana IS NOT NULL )
    AND   anio_semana IS NOT NULL
),

-- ============================================================
-- NUEVA CTE: hubspot (solo 4 columnas que se usan, sin categoria_eecc_map)
-- Referenciada 1 sola vez en el SELECT final para no sumar stages
-- ============================================================
hubspot AS (
    SELECT DISTINCT
         numero_casocross
        ,area_eecc
        ,mercado_eecc
        ,eecc
    FROM lake.bi_sourcing_reporte_media_sales_negociaciones
    WHERE (area_eecc IS NOT NULL OR mercado_eecc IS NOT NULL OR eecc IS NOT NULL)
),

cartera_ds AS (
    SELECT DISTINCT
         id_proveedor
        ,nombre_proveedor
        ,eecc
        ,'-' AS eecc_chains
        ,area
        ,market
        ,tipo_de_cuenta
        ,geo_ggcc
    FROM lake.bi_sourcing_cartera_ds
    WHERE anio_semana = (SELECT MAX(anio_semana) FROM lake.bi_sourcing_cartera_ds WHERE anio_semana IS NOT NULL)
    AND   anio_semana IS NOT NULL
),

cartera_autos AS (
    SELECT DISTINCT
         id_rentadora AS id_proveedor
        ,nombre_rentadora AS nombre_proveedor
        ,eecc
        ,'-' AS eecc_chains
        ,area
        ,market
        ,tipo_de_cuenta
        ,geo_ggcc
    FROM lake.bi_sourcing_cartera_autos
    WHERE anio_semana = (SELECT MAX(anio_semana) FROM lake.bi_sourcing_cartera_autos WHERE anio_semana IS NOT NULL)
    AND   anio_semana IS NOT NULL
),

final_alojamientos AS (
    SELECT DISTINCT
         tipo_reserva
        ,tipo_negociacion
        ,tipo_de_cambio_a_dolar
        ,site_forecast
        ,site
        ,producto
        ,porc_sobre_produccion
        ,porc_cobro_sobre
        ,orden_insercion_oi
        ,oid_madre
        ,numero_casocross
        ,num_de_alojamientos
        ,negocio_nuevo
        ,negocio_forecast
        ,negocio
        ,monto_fijo_usd
        ,monto_fijo_negociado
        ,moneda_de_negociacion
        ,marca_nueva
        ,marca_cadena
        ,marca
        ,media.id_proveedor
        ,flg_tope
        ,flg_sponsor_listing
        ,flg_signing_bonus
        ,flg_overcomission
        ,flg_cooperado
        ,flg_capitana
        ,fecha_prendido
        ,fecha_cierre_tmp
        ,fecha_apertura_tmp
        ,fecha_apagado
        ,dias_vigencia
        ,codigo_pais
        ,cantidad_sites
        ,cantidad_negocios
        ,cantidad_marcas
        ,cantidad_canal
        ,canal_planning
        ,media.cadena
        ,assistant_ownner
        ,anio_mes_negociado
        ,anio_mes_inicio
        ,anio_mes_fin
        ,anio_inicio
        ,anio_apagado
        ,particion
        ,media_real
        ,media_forecast

        ,CASE WHEN cartera.eecc_chains NOT IN ('admin') THEN cartera.eecc_chains
              ELSE cartera.eecc END AS eecc
        ,CASE
            WHEN    cartera.geo_ggcc = 'GGCC' AND area_mercado.flag_latam = 1 THEN 'Sourcing GGPP Latam'
            WHEN    cartera.geo_ggcc = 'GGCC' AND area_mercado.flag_latam = 0 THEN 'Sourcing GGPP NO Latam'
            WHEN cartera.eecc_chains NOT IN ('admin') THEN cartera.market_objetivo
            ELSE    coalesce(market_objetivo, area_mercado.market)
            END AS mercado
        ,CASE
            WHEN    cartera.geo_ggcc = 'GGCC' AND area_mercado.flag_latam = 1 THEN 'GGPP'
            WHEN    cartera.geo_ggcc = 'GGCC' AND area_mercado.flag_latam = 0 THEN 'GGPP'
            WHEN cartera.eecc_chains NOT IN ('admin') THEN cartera.area
            ELSE    area_mercado.area
            END AS area

        ,area_mercado.flag_latam
        ,cartera.nombre_proveedor

        -- 🔰EQUIPO
        ,CASE
            WHEN cartera.geo_ggcc = 'GGCC' AND area_mercado.flag_latam = 1 THEN 'Sourcing GGPP Latam'
            WHEN cartera.geo_ggcc = 'GGCC' AND area_mercado.flag_latam = 0 THEN 'Sourcing GGPP NO Latam'
            WHEN area_mercado.area IN ('Andinos', 'Brasil') THEN area_mercado.market
            WHEN area_mercado.area IN ('Ar, Uy, Bo & Py') THEN '-'
            WHEN area_mercado.area IN ('México & Caribe') THEN
                 CASE WHEN area_mercado.market IN ('MX - Chains') THEN cartera.market_objetivo
                      WHEN area_mercado.market IN ('MX - Centro & Pacífico') AND cartera.market_objetivo IN ('Local Professional','Independent Hotels') THEN cartera.market_objetivo||' - '||'Centro & Pacífico'
                      WHEN area_mercado.market IN ('MX - Quintana Roo & Caribe') AND cartera.market_objetivo IN ('Local Professional','Independent Hotels') THEN cartera.market_objetivo||' - '||'Quintana Roo & Caribe'
                 ELSE 'SIN_EQUIPO' END
        ELSE 'SIN_EQUIPO'
        END AS equipo_target

    FROM lake.bi_pl_reporte_media_sales_anio_mes_negociado_emitido_forecast_test3 media
    LEFT JOIN cartera_aloja cartera ON cartera.id_proveedor = media.id_proveedor
    LEFT JOIN lake.bi_sou_reportesupplierrevenue_aloja_objetivo_abr26sep26_stg_maestro_hotel area_mercado ON lower(cast(area_mercado.hotel_id as varchar)) = lower(media.id_proveedor)
    WHERE producto = 'Alojamientos'
    AND particion IS NOT NULL
),

final_autos AS (
    SELECT DISTINCT
         tipo_reserva
        ,tipo_negociacion
        ,tipo_de_cambio_a_dolar
        ,site_forecast
        ,site
        ,producto
        ,porc_sobre_produccion
        ,porc_cobro_sobre
        ,orden_insercion_oi
        ,oid_madre
        ,numero_casocross
        ,num_de_alojamientos
        ,negocio_nuevo
        ,negocio_forecast
        ,negocio
        ,monto_fijo_usd
        ,monto_fijo_negociado
        ,moneda_de_negociacion
        ,marca_nueva
        ,marca_cadena
        ,marca
        ,media.id_proveedor
        ,flg_tope
        ,flg_sponsor_listing
        ,flg_signing_bonus
        ,flg_overcomission
        ,flg_cooperado
        ,flg_capitana
        ,fecha_prendido
        ,fecha_cierre_tmp
        ,fecha_apertura_tmp
        ,fecha_apagado
        ,dias_vigencia
        ,codigo_pais
        ,cantidad_sites
        ,cantidad_negocios
        ,cantidad_marcas
        ,cantidad_canal
        ,canal_planning
        ,media.cadena
        ,assistant_ownner
        ,anio_mes_negociado
        ,anio_mes_inicio
        ,anio_mes_fin
        ,anio_inicio
        ,anio_apagado
        ,particion
        ,media_real
        ,media_forecast

        ,cartera.eecc
        ,CASE
            WHEN    cartera.geo_ggcc = 'GGCC' THEN 'Sourcing GGPP ONA'
            ELSE    cartera.market
            END AS mercado
        ,CASE
            WHEN    cartera.geo_ggcc = 'GGCC'  THEN 'GGPP'
            ELSE    cartera.area
            END AS area
        ,0 AS flag_latam
        ,cartera.nombre_proveedor

        -- 🔰EQUIPO
        ,CASE
            WHEN cartera.geo_ggcc = 'GGCC' THEN 'Sourcing GGPP ONA'
            WHEN cartera.area IN ('Andinos', 'Brasil') THEN cartera.market
            WHEN cartera.area IN ('Ar, Uy, Bo & Py') THEN '-'
            WHEN cartera.area IN ('México & Caribe') THEN 'Local Professional - Quintana Roo & Caribe'
        ELSE 'SIN_EQUIPO'
        END AS equipo_target

    FROM lake.bi_pl_reporte_media_sales_anio_mes_negociado_emitido_forecast_test3 media
    LEFT JOIN cartera_autos cartera ON lower(cartera.id_proveedor) = lower(media.id_proveedor)
    WHERE producto = 'Autos'
    AND particion IS NOT NULL
),

final_secretarias AS (
    SELECT DISTINCT
         tipo_reserva
        ,tipo_negociacion
        ,tipo_de_cambio_a_dolar
        ,site_forecast
        ,site
        ,producto
        ,porc_sobre_produccion
        ,porc_cobro_sobre
        ,orden_insercion_oi
        ,oid_madre
        ,media.numero_casocross
        ,num_de_alojamientos
        ,negocio_nuevo
        ,negocio_forecast
        ,negocio
        ,monto_fijo_usd
        ,monto_fijo_negociado
        ,moneda_de_negociacion
        ,marca_nueva
        ,'-' AS marca_cadena
        ,marca
        ,media.id_proveedor
        ,flg_tope
        ,flg_sponsor_listing
        ,flg_signing_bonus
        ,flg_overcomission
        ,flg_cooperado
        ,flg_capitana
        ,fecha_prendido
        ,fecha_cierre_tmp
        ,fecha_apertura_tmp
        ,fecha_apagado
        ,dias_vigencia
        ,codigo_pais
        ,cantidad_sites
        ,cantidad_negocios
        ,cantidad_marcas
        ,cantidad_canal
        ,canal_planning
        ,'-' AS cadena
        ,assistant_ownner
        ,anio_mes_negociado
        ,anio_mes_inicio
        ,anio_mes_fin
        ,anio_inicio
        ,anio_apagado
        ,particion
        ,media_real
        ,media_forecast

        ,mercados.cadena            AS eecc
        ,mercados.marca_cadena      AS mercado
        ,CASE
            WHEN    mercados.marca_cadena = 'Andina' OR mercados.marca_cadena = 'Colombia & CEAM'   THEN 'Andinos'
            WHEN    mercados.marca_cadena = 'ARG - GEO' OR mercados.marca_cadena = 'ARG - No GEO'   THEN 'Ar, Uy, Bo & Py'
            WHEN    mercados.marca_cadena LIKE 'BR -%'    THEN 'Brasil'
            WHEN    mercados.marca_cadena LIKE 'MX - %'    THEN 'México & Caribe'
            WHEN    mercados.marca_cadena LIKE '%GGPP%'    THEN 'GGPP'
            ELSE '-' END AS area
        ,0 AS flag_latam
        ,media.id_proveedor AS nombre_proveedor

        -- 🔰EQUIPO
        ,CASE
            WHEN cartera.area IN ('Andinos', 'Brasil') THEN cartera.market
            WHEN cartera.area IN ('Ar, Uy, Bo & Py') THEN '-'
            WHEN cartera.area IN ('México & Caribe') THEN 'Secretarias  - Centro & Pacífico'
        ELSE 'SIN_EQUIPO'
        END AS equipo_target

    FROM lake.bi_pl_reporte_media_sales_anio_mes_negociado_emitido_forecast_test3 media
    LEFT JOIN cartera_ds cartera ON lower(cartera.id_proveedor) = lower(media.id_proveedor)
    LEFT JOIN (
        SELECT DISTINCT
        numero_casocross
        ,cadena
        ,marca_cadena
        FROM raw.bi_sourcing_reporte_media_sales_negociaciones_gdoc
        WHERE producto = 'Secretarias'
        ) mercados ON mercados.numero_casocross = media.numero_casocross
    WHERE producto IN ('Secretarias')
    AND particion IS NOT NULL
),

final_resto AS (
    SELECT DISTINCT
         tipo_reserva
        ,tipo_negociacion
        ,tipo_de_cambio_a_dolar
        ,site_forecast
        ,site
        ,producto
        ,porc_sobre_produccion
        ,porc_cobro_sobre
        ,orden_insercion_oi
        ,oid_madre
        ,numero_casocross
        ,num_de_alojamientos
        ,negocio_nuevo
        ,negocio_forecast
        ,negocio
        ,monto_fijo_usd
        ,monto_fijo_negociado
        ,moneda_de_negociacion
        ,marca_nueva
        ,CASE WHEN producto = 'Asistencias'  THEN '-' ELSE media.marca_cadena END AS marca_cadena
        ,marca
        ,media.id_proveedor
        ,flg_tope
        ,flg_sponsor_listing
        ,flg_signing_bonus
        ,flg_overcomission
        ,flg_cooperado
        ,flg_capitana
        ,fecha_prendido
        ,fecha_cierre_tmp
        ,fecha_apertura_tmp
        ,fecha_apagado
        ,dias_vigencia
        ,codigo_pais
        ,cantidad_sites
        ,cantidad_negocios
        ,cantidad_marcas
        ,cantidad_canal
        ,canal_planning
        ,CASE WHEN producto = 'Asistencias'  THEN '-' ELSE media.cadena END AS cadena
        ,assistant_ownner
        ,anio_mes_negociado
        ,anio_mes_inicio
        ,anio_mes_fin
        ,anio_inicio
        ,anio_apagado
        ,particion
        ,media_real
        ,media_forecast

        ,CASE WHEN producto = 'Asistencias' THEN media.cadena ELSE cartera.eecc END AS eecc
        ,CASE
            WHEN    cartera.eecc IN ('mcanche@despegar.com', 'yesica.moo@despegar.com' ) THEN 'MX - Caribe'
            WHEN    cartera.geo_ggcc = 'GGCC'   THEN 'Sourcing GGPP ONA'
            WHEN    producto = 'Asistencias'    THEN 'Sourcing GGPP ONA'
            WHEN    producto = 'Parques'        THEN 'Sourcing GGPP ONA'
            ELSE    cartera.market
            END AS mercado
        ,CASE
            WHEN    cartera.geo_ggcc = 'GGCC'   THEN 'GGPP'
            WHEN    producto = 'Asistencias'    THEN 'GGPP'
            WHEN    producto = 'Parques'        THEN 'GGPP'
            ELSE    cartera.area
            END AS area
        ,0 AS flag_latam
        ,cartera.nombre_proveedor

        -- 🔰EQUIPO
        ,CASE
            WHEN cartera.geo_ggcc = 'GGCC'   OR media.producto IN ( 'Asistencias', 'Parques')       THEN 'Sourcing GGPP ONA'
            WHEN cartera.area IN ('Andinos', 'Brasil') THEN cartera.market
            WHEN cartera.area IN ('Ar, Uy, Bo & Py') THEN '-'
            WHEN cartera.area IN ('México & Caribe') THEN 'Local Professional - Quintana Roo & Caribe'
        ELSE 'SIN_EQUIPO'
        END AS equipo_target

    FROM lake.bi_pl_reporte_media_sales_anio_mes_negociado_emitido_forecast_test3 media
    LEFT JOIN cartera_ds cartera ON lower(cartera.id_proveedor) = lower(media.id_proveedor)
    WHERE producto NOT IN ('Autos','Alojamientos','Secretarias')
    AND particion IS NOT NULL
),

-- ✅ UNION ALL (productos mutuamente excluyentes por WHERE)
all_finals AS (
    SELECT * FROM final_resto
    UNION ALL
    SELECT * FROM final_autos
    UNION ALL
    SELECT * FROM final_alojamientos
    UNION ALL
    SELECT * FROM final_secretarias
)

-- Excepciones + HubSpot override en el SELECT final
SELECT
 a.tipo_reserva
,a.tipo_negociacion
,a.tipo_de_cambio_a_dolar
,a.site_forecast
,a.site
,a.producto
,a.porc_sobre_produccion
,a.porc_cobro_sobre
,a.orden_insercion_oi
,a.oid_madre
,a.numero_casocross
,a.num_de_alojamientos
,a.negocio_nuevo
,a.negocio_forecast
,a.negocio
,a.monto_fijo_usd
,a.monto_fijo_negociado
,a.moneda_de_negociacion
,a.marca_nueva
,a.marca_cadena
,a.marca
,a.id_proveedor
,a.flg_tope
,a.flg_sponsor_listing
,a.flg_signing_bonus
,a.flg_overcomission
,a.flg_cooperado
,a.flg_capitana
,a.fecha_prendido
,a.fecha_cierre_tmp
,a.fecha_apertura_tmp
,a.fecha_apagado
,a.dias_vigencia
,a.codigo_pais
,a.cantidad_sites
,a.cantidad_negocios
,a.cantidad_marcas
,a.cantidad_canal
,a.canal_planning
,a.cadena
,a.assistant_ownner
,a.anio_mes_negociado
,a.anio_mes_inicio
,a.anio_mes_fin
,a.anio_inicio
,a.anio_apagado
,a.media_real
,a.media_forecast
,a.particion
,a.flag_latam
,a.nombre_proveedor

-- Prioridad: Excepciones > HubSpot > Cartera
,coalesce(exc.eecc, hubspot.eecc, a.eecc)                      AS eecc
,coalesce(exc.market, hubspot.mercado_eecc, a.mercado)        AS mercado
,coalesce(exc.area, hubspot.area_eecc, a.area)                AS area
,COALESCE(exc.equipo_target, a.equipo_target)                 AS equipo_target



,CASE
    WHEN LENGTH(a.numero_casocross) = 22 THEN SUBSTR(a.numero_casocross, 1, 11)
    ELSE '-'
END AS deal_id

FROM all_finals a
LEFT JOIN raw.bi_pl_reporte_media_sales_stg_xlsx_excepciones_abr26sep26 exc ON exc.key_target_excepciones_media = concat('','-',a.numero_casocross)
LEFT JOIN hubspot ON hubspot.numero_casocross = a.numero_casocross
