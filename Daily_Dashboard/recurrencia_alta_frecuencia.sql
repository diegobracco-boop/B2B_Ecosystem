-- =============================================================================
-- COPIA de la card Metabase 171400 "Alta_frecuencia_Semanal" (2026-10-16).
-- La corre daily_sync.py contra el Datalake (KR Accelerate Recurrence, Status KRs H2 del Tracker).
-- Si cambia la definicion en Metabase, pegar aca el SQL nuevo tal cual (sin ';' final).
-- =============================================================================
-- KPI SEMANAL · FOTO DEL MES + ROLLING 4 SEMANAS · pais x semana comercial · agencias HTML
--
-- Una fila por (pais, semana comercial). Cada semana se mira a su FOTO = lunes siguiente a su domingo
-- (para la semana en curso se usa hoy y estado = 'EN_CURSO'). En cada fila hay tres bloques:
--   MTD  (mes a la fecha):  semanas 1..k del mes comercial, a la foto de la semana k.
--                           En la ultima semana del mes (es_cierre_mes = 1) es LA FOTO OFICIAL DEL MES.
--                           mtd_frecuentes = 3 o mas semanas; mtd_todas = compro en las k semanas transcurridas.
--   ROLL (rolling 4 sem.):  las 4 semanas comerciales que terminan en esa semana, a la misma foto.
--                           Siempre 4 semanas -> comparable entre meses de 4 y 5 semanas.
--                           roll_frecuentes = 3 o mas de las 4; roll_4de4 = las 4.
--   LY:  los mismos bloques para la semana equivalente del anio anterior (mismo mes comercial, misma
--        semana del mes), a SU foto. Sirve para el YoY semana a semana sin madurez distinta.
-- Lecturas: *_conf = confirmadas a la foto (confirmation_date <= foto y no cancelada);
--           *_vivas = activas + confirmadas a la foto (no cancelada: cancelation_date IS NULL o > foto).
-- OBJETIVO: no esta en el lake; se joinea afuera por (mes_comercial, pais) desde la proyeccion vigente
--           (_proyeccion_pais_com*.csv / Objetivos_Pais_Comercial*.xlsx). La foto del mes se compara con el
--           objetivo del mes; el rolling es seguimiento, no se compara con objetivo.
-- anio_iso / semana_iso = semana ISO-8601 del lunes de la semana comercial (lun-dom = semana ISO).
-- Semana = semana comercial de la FECHA DE RESERVA. Agencia = partner_data_id (WLAG -> AG). Pais = pais con
-- mas ordenes de la agencia. Calendario Calendario.xlsx embebido (agregar filas para extender).
-- roll_completo = 0 en las 3 primeras semanas de la base (mar-25), donde la ventana de 4 no esta completa.
-- Fuente: data.analytics.bi_transactional_fact_transactions. Sin ';' final. ~3 min.
-- =============================================================================
WITH cal AS (
    SELECT periodo, desde, hasta, n_sem
    FROM (VALUES
        ('2025-03', DATE '2025-03-03', DATE '2025-03-30', 4),
        ('2025-04', DATE '2025-03-31', DATE '2025-04-27', 4),
        ('2025-05', DATE '2025-04-28', DATE '2025-06-01', 5),
        ('2025-06', DATE '2025-06-02', DATE '2025-06-29', 4),
        ('2025-07', DATE '2025-06-30', DATE '2025-08-03', 5),
        ('2025-08', DATE '2025-08-04', DATE '2025-08-31', 4),
        ('2025-09', DATE '2025-09-01', DATE '2025-10-05', 5),
        ('2025-10', DATE '2025-10-06', DATE '2025-11-02', 4),
        ('2025-11', DATE '2025-11-03', DATE '2025-11-30', 4),
        ('2025-12', DATE '2025-12-01', DATE '2026-01-04', 5),
        ('2026-01', DATE '2026-01-05', DATE '2026-02-01', 4),
        ('2026-02', DATE '2026-02-02', DATE '2026-03-01', 4),
        ('2026-03', DATE '2026-03-02', DATE '2026-03-29', 4),
        ('2026-04', DATE '2026-03-30', DATE '2026-04-26', 4),
        ('2026-05', DATE '2026-04-27', DATE '2026-05-31', 5),
        ('2026-06', DATE '2026-06-01', DATE '2026-06-28', 4),
        ('2026-07', DATE '2026-06-29', DATE '2026-08-02', 5),
        ('2026-08', DATE '2026-08-03', DATE '2026-08-30', 4),
        ('2026-09', DATE '2026-08-31', DATE '2026-10-04', 5),
        ('2026-10', DATE '2026-10-05', DATE '2026-11-01', 4),
        ('2026-11', DATE '2026-11-02', DATE '2026-11-29', 4),
        ('2026-12', DATE '2026-11-30', DATE '2027-01-03', 5),
        ('2027-01', DATE '2027-01-04', DATE '2027-01-31', 4),
        ('2027-02', DATE '2027-02-01', DATE '2027-02-28', 4),
        ('2027-03', DATE '2027-03-01', DATE '2027-03-28', 4)
    ) AS v (periodo, desde, hasta, n_sem)
),
-- una fila por semana comercial, con su foto y su ventana rolling
sem AS (
    SELECT c.periodo, c.n_sem, c.desde AS m_desde, k AS semana,
           date_add('day', 7 * (k - 1), c.desde)       AS s_desde,
           date_add('day', 7 * (k - 1) + 6, c.desde)   AS s_hasta,
           LEAST(date_add('day', 7 * k, c.desde), current_date) AS foto,
           CASE WHEN date_add('day', 7 * k, c.desde) <= current_date THEN 'CIERRE' ELSE 'EN_CURSO' END AS estado,
           date_add('day', 7 * (k - 1) - 21, c.desde)  AS r_desde,
           CASE WHEN date_add('day', 7 * (k - 1) - 21, c.desde) >= DATE '2025-03-03' THEN 1 ELSE 0 END AS roll_completo
    FROM cal c
    CROSS JOIN UNNEST(sequence(1, c.n_sem)) AS t (k)
    WHERE date_add('day', 7 * (k - 1), c.desde) <= current_date
),
ord AS (
    SELECT CASE WHEN partner_data_id LIKE 'WLAG%' THEN substr(partner_data_id, 3) ELSE partner_data_id END AS agencia_id,
           country_code, transaction_code,
           CAST(reservation_date AS DATE)  AS rd,
           CAST(confirmation_date AS DATE) AS cd,
           CAST(cancelation_date AS DATE)  AS xd
    FROM data.analytics.bi_transactional_fact_transactions
    WHERE reservation_year_month >= DATE '2025-03-01'   -- particion: literal (con subquery el driver falla)
      AND reservation_date >= DATE '2025-03-03'
      AND parent_channel = 'Agencias afiliadas'
      AND line_of_business = 'B2B'
),
pais AS (
    SELECT agencia_id, country_code
    FROM (SELECT agencia_id, country_code,
                 ROW_NUMBER() OVER (PARTITION BY agencia_id ORDER BY COUNT(*) DESC, country_code) AS rn
          FROM ord GROUP BY agencia_id, country_code) x
    WHERE rn = 1
),
-- cada orden entra en el MTD de su mes (semanas >= la suya) y en los 4 rolling que la contienen
det AS (
    SELECT s.periodo, s.semana, 'MTD' AS tipo, o.agencia_id,
           date_diff('day', s.m_desde, o.rd) / 7 + 1 AS w,
           CASE WHEN o.cd IS NOT NULL AND o.cd <= s.foto AND (o.xd IS NULL OR o.xd > s.foto) THEN 1 ELSE 0 END AS conf,
           CASE WHEN o.xd IS NULL OR o.xd > s.foto THEN 1 ELSE 0 END                                        AS viva
    FROM sem s JOIN ord o ON o.rd BETWEEN s.m_desde AND s.s_hasta
    UNION ALL
    SELECT s.periodo, s.semana, 'ROLL', o.agencia_id,
           date_diff('day', s.r_desde, o.rd) / 7 + 1,
           CASE WHEN o.cd IS NOT NULL AND o.cd <= s.foto AND (o.xd IS NULL OR o.xd > s.foto) THEN 1 ELSE 0 END,
           CASE WHEN o.xd IS NULL OR o.xd > s.foto THEN 1 ELSE 0 END
    FROM sem s JOIN ord o ON o.rd BETWEEN s.r_desde AND s.s_hasta
),
ag AS (
    SELECT periodo, semana, tipo, agencia_id,
           COUNT(DISTINCT CASE WHEN conf = 1 THEN w END) AS sc,
           COUNT(DISTINCT CASE WHEN viva = 1 THEN w END) AS sv
    FROM det
    GROUP BY 1, 2, 3, 4
),
m AS (
    SELECT a.periodo, a.semana,
           CASE p.country_code
                WHEN 'BR' THEN 'Brasil'    WHEN 'MX' THEN 'Mexico' WHEN 'CO' THEN 'Colombia'
                WHEN 'AR' THEN 'Argentina' WHEN 'CL' THEN 'Chile'  WHEN 'PE' THEN 'Peru'
                ELSE 'Other Countries' END AS pais,
           -- MTD confirmadas
           COUNT(DISTINCT CASE WHEN a.tipo = 'MTD' AND a.sc >= 1 THEN a.agencia_id END)        AS mtd_compradoras_conf,
           COUNT(DISTINCT CASE WHEN a.tipo = 'MTD' AND a.sc >= 3 THEN a.agencia_id END)        AS mtd_frecuentes_conf,
           COUNT(DISTINCT CASE WHEN a.tipo = 'MTD' AND a.sc = a.semana THEN a.agencia_id END)  AS mtd_todas_conf,
           -- MTD vivas
           COUNT(DISTINCT CASE WHEN a.tipo = 'MTD' AND a.sv >= 1 THEN a.agencia_id END)        AS mtd_compradoras_vivas,
           COUNT(DISTINCT CASE WHEN a.tipo = 'MTD' AND a.sv >= 3 THEN a.agencia_id END)        AS mtd_frecuentes_vivas,
           COUNT(DISTINCT CASE WHEN a.tipo = 'MTD' AND a.sv = a.semana THEN a.agencia_id END)  AS mtd_todas_vivas,
           -- ROLL confirmadas
           COUNT(DISTINCT CASE WHEN a.tipo = 'ROLL' AND a.sc >= 1 THEN a.agencia_id END)       AS roll_compradoras_conf,
           COUNT(DISTINCT CASE WHEN a.tipo = 'ROLL' AND a.sc >= 3 THEN a.agencia_id END)       AS roll_frecuentes_conf,
           COUNT(DISTINCT CASE WHEN a.tipo = 'ROLL' AND a.sc = 4 THEN a.agencia_id END)        AS roll_4de4_conf,
           -- ROLL vivas
           COUNT(DISTINCT CASE WHEN a.tipo = 'ROLL' AND a.sv >= 1 THEN a.agencia_id END)       AS roll_compradoras_vivas,
           COUNT(DISTINCT CASE WHEN a.tipo = 'ROLL' AND a.sv >= 3 THEN a.agencia_id END)       AS roll_frecuentes_vivas,
           COUNT(DISTINCT CASE WHEN a.tipo = 'ROLL' AND a.sv = 4 THEN a.agencia_id END)        AS roll_4de4_vivas
    FROM ag a
    LEFT JOIN pais p ON p.agencia_id = a.agencia_id
    GROUP BY 1, 2, 3
)
SELECT s.periodo                                   AS mes_comercial,
       s.n_sem                                     AS semanas_del_mes,
       s.semana                                    AS semana_del_mes,
       CAST(s.s_desde AS VARCHAR)                  AS semana_desde,
       CAST(s.s_hasta AS VARCHAR)                  AS semana_hasta,
       year_of_week(s.s_desde)                     AS anio_iso,
       week(s.s_desde)                             AS semana_iso,
       CAST(year_of_week(s.s_desde) AS VARCHAR) || '-W' || lpad(CAST(week(s.s_desde) AS VARCHAR), 2, '0') AS semana_iso_label,
       CAST(s.foto AS VARCHAR)                     AS fecha_foto,
       s.estado,
       CASE WHEN s.semana = s.n_sem THEN 1 ELSE 0 END AS es_cierre_mes,
       s.roll_completo,
       m.pais,
       m.mtd_compradoras_conf,  m.mtd_frecuentes_conf,  m.mtd_todas_conf,
       m.mtd_compradoras_vivas, m.mtd_frecuentes_vivas, m.mtd_todas_vivas,
       m.roll_compradoras_conf,  m.roll_frecuentes_conf,  m.roll_4de4_conf,
       m.roll_compradoras_vivas, m.roll_frecuentes_vivas, m.roll_4de4_vivas,
       -- mismo bloque, semana equivalente del anio anterior (a su propia foto)
       ly.mtd_compradoras_conf   AS ly_mtd_compradoras_conf,  ly.mtd_frecuentes_conf  AS ly_mtd_frecuentes_conf,  ly.mtd_todas_conf  AS ly_mtd_todas_conf,
       ly.mtd_compradoras_vivas  AS ly_mtd_compradoras_vivas, ly.mtd_frecuentes_vivas AS ly_mtd_frecuentes_vivas, ly.mtd_todas_vivas AS ly_mtd_todas_vivas,
       ly.roll_compradoras_conf  AS ly_roll_compradoras_conf, ly.roll_frecuentes_conf AS ly_roll_frecuentes_conf, ly.roll_4de4_conf  AS ly_roll_4de4_conf,
       ly.roll_compradoras_vivas AS ly_roll_compradoras_vivas, ly.roll_frecuentes_vivas AS ly_roll_frecuentes_vivas, ly.roll_4de4_vivas AS ly_roll_4de4_vivas
FROM sem s
JOIN m ON m.periodo = s.periodo AND m.semana = s.semana
LEFT JOIN m ly ON ly.periodo = CAST(CAST(substr(s.periodo, 1, 4) AS INTEGER) - 1 AS VARCHAR) || substr(s.periodo, 5)
              AND ly.semana = s.semana AND ly.pais = m.pais
ORDER BY 1, 3, 13
