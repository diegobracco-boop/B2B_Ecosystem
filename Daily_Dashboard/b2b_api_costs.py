"""
Costos de B2B API que el Datalake no trae bien cargados: criterio del modelo de Revenue (definido por Diego el 2026-11-12).
Lo usan las queries B2B GD y RI del Daily (daily_sync.py) y del Managerial (P&L_Managerial/actuals_gestional_upload.py),
para que las cuatro tengan la misma lógica.

Comisiones de terceros de API (columna white_labels_api, un solo renglón: "Third Party Commissions"):
  1. Comisión contractual por partner (% del GB). AP13248 / AP13422 según hotel o destino del hotel.
  2. Overcommission: 0,5% del GB para la lista de agencias de Revenue.
  3. Comisión real del partner en channels_bo (net_commission_partner x conversion_rate), salvo channel 'expedia'
     (su 75% ya está en el up front x 0,25). Hoy es ~0 en API; queda para canales que la carguen.
  4. Costo de conector (tabla de agencias por conector de Revenue: CONECTORES_TABLE).
Reemplaza la tasa genérica por país del canal API. Affiliates de API sigue en NULL (todo va en esta línea).

Efecto financiero de API = costo de cobranza: van_collection_usd - collection_amount_usd (valor actual del cobro menos el
nominal; siempre <= 0). En API el financial_result_usd del Datalake no lo trae (FY27 abr-oct GD: -24k vs -410k); en
Agencias afiliadas sí (-4,6M vs -4,8M), así que el resto de B2B sigue con financial_result_usd.
Desde cuándo (2026-11-12, Diego: el LY no se ajusta): el criterio nuevo aplica a la fecha de la fila >= DESDE (inicio de
FY27). Lo anterior (LY, Ene-Mar 2026) queda con la lógica vieja: tasa por país + conector de b2b_dim_ap_by_conector,
cancelaciones y financial_result_usd del Datalake. Las queries piden el LY con los mismos builders, por eso el corte va en SQL.
"""

DESDE = "2026-04-01"

# Agencias por conector: desde FY27 la tabla de Revenue (más completa); antes, la que se usaba.
CONECTORES_TABLE = "data.raw.b2b_rev_api_conectores_ap"
CONECTORES_TABLE_OLD = "data.raw.b2b_dim_ap_by_conector"


def _con_sub(table, old=False):
    # La tabla vieja conserva su agregación original (MAX(COALESCE(...)), distinta con varios conectores por agencia).
    pay = "MAX(COALESCE(conectores.pay_type, 'NA'))" if old else "COALESCE(MAX(conectores.pay_type), 'NA')"
    return f"""SELECT agencias.ap_code,
            {pay}                  AS pay_type,
            MAX(COALESCE(CAST(conectores.mulltiplier AS DOUBLE), 0))  AS mulltiplier
        FROM {table} agencias
        LEFT JOIN data.raw.b2b_dim_api_conectors conectores ON agencias.conector = conectores.conector
        GROUP BY 1"""


# CTE "conectores": una fila por agencia con el conector de cada tabla (n = nueva, o = vieja).
CONECTORES_CTE_BODY = f"""
    SELECT COALESCE(n.ap_code, o.ap_code) AS ap_code,
        n.pay_type, n.mulltiplier, o.pay_type AS pay_type_old, o.mulltiplier AS mulltiplier_old
    FROM ({_con_sub(CONECTORES_TABLE)}) n
    FULL OUTER JOIN ({_con_sub(CONECTORES_TABLE_OLD, old=True)}) o ON n.ap_code = o.ap_code"""


def _fecha(vista):
    return ("fh.gestion_date" if vista == "GD" else
            "(CASE WHEN fh.parent_channel = 'API' AND fh.buy_type_code = 'Hoteles' THEN p.checkin_date ELSE fh.recognition_date END)")


def api_nuevo(vista: str) -> str:
    """Condición SQL: fila de API con fecha desde FY27 (aplica el criterio de Revenue)."""
    return f"(fh.parent_channel = 'API' AND {_fecha(vista)} >= DATE '{DESDE}')"


_PARTNERS_115 = ("AP12700", "AP12587", "AP12586", "AP12766", "AP12698", "AP13112", "AP13110", "AP13095",
                 "AP13106", "AP13105", "AP13131", "AP13171", "AP13179", "AP13205")
_HOTELES_115 = ("4541139", "596055", "526945", "526608", "208647", "206168", "584234", "584238", "2353896", "365647",
                "365645", "208143", "365654", "322237", "208713", "206101", "581312", "584301", "4425124", "483225")
_HOTELES_0654 = ("322254", "469657", "826423", "996658", "1816527", "1817094", "2371281", "4277812", "5886306",
                 "6044995", "6580077")
_DEST_LATAM = ("PR", "BB", "JM", "SX", "MX", "DO", "CU", "BS", "BQ", "MF", "NI", "PA", "CW", "AW", "SV", "HN", "EC",
               "PE", "GT", "CL", "HT", "CR", "CO", "AR", "UY", "BO", "PY", "BR")
_OVERCOMMISSION = (
    "AP13187", "AP13055", "AP13170", "AP12800", "AP12801", "AP13092", "AP12959", "AP13054",
    "AP13123", "AP12880", "AP13053", "AP13211", "AP13093", "AP12860", "AP12954", "AP13135",
    "AP13206", "AP13219", "AP12813", "AP13119", "AP12917", "AP12798", "AP12799", "AP13240",
    "AP12816", "AP13222", "AP13243", "AP12792", "AP12288", "AP12520", "AP12789", "AP12519",
    "AP11700", "AP12537", "AP12279", "AP11714", "AP11639", "AP11640", "AP12541", "AP12465",
    "AP11647", "AP12463", "AP12464", "AP11973", "AP12304", "AP11943", "AP11944", "AP12913",
    "AP11954", "AP12450", "AP11945", "AP11948", "AP11953", "AP11946", "AP12905", "AP11950",
    "AP12736", "AP11947", "AP13024", "AP11955", "AP12348", "AP13160", "AP11976", "AP11982",
    "AP12611", "AP12001", "AP12024", "AP12425", "AP12849", "AP11929", "AP11930", "AP12915",
    "AP12686", "AP12256", "AP11910", "AP13120", "AG00089738", "AP13076", "AP12402", "AP12535",
    "AP12016", "AP13082", "AP12674", "AP12432", "AP11907", "AP12984", "AP13069", "AP12442",
    "AP12426", "AP13072", "AP12011", "AP12262", "AG00022275", "AG00015203", "AG00008165",
    "AG00009607", "AG00051566", "AG00021822", "AG00008146", "AG00022185",
)


def _in(vals):
    return "(" + ",".join(f"'{v}'" for v in vals) + ")"


# % del GB: comisión contractual por partner + overcommission
_RATE_SQL = f"""(
                CASE
                    WHEN fh.partner_id IN {_in(_PARTNERS_115)} THEN 0.115
                    WHEN fh.partner_id IN ('AP13248','AP13422') THEN CASE
                        WHEN p.hotel_despegar_id IN {_in(_HOTELES_115)} THEN 0.115
                        WHEN p.hotel_despegar_id IN {_in(_HOTELES_0654)} THEN 0.0654
                        WHEN p.destination_country_code IN {_in(_DEST_LATAM)} THEN 0.138
                        WHEN p.destination_country_code NOT IN {_in(_DEST_LATAM)} THEN 0.115
                        ELSE 0 END
                    WHEN fh.partner_id = 'AP12573' THEN 0.091
                    WHEN fh.partner_id = 'AP13207' THEN 0.107
                    WHEN fh.partner_id = 'AP13241' THEN 0.13
                    WHEN fh.partner_id = 'AP12288' THEN 0.025
                    ELSE 0
                END
                + CASE WHEN fh.partner_id IN {_in(_OVERCOMMISSION)} THEN 0.005 ELSE 0 END
            )"""


def _conector(sufijo=""):
    pt, m = f"con.pay_type{sufijo}", f"con.mulltiplier{sufijo}"
    return f"""CASE
                    WHEN {pt} = 'TX' THEN COALESCE({m}, 0) * COALESCE(TRY_CAST(fh.confirmation_gradient AS DECIMAL(5,5)), 1)
                    WHEN {pt} = 'GB' THEN COALESCE({m} * fh.gestion_gb, 0) * COALESCE(TRY_CAST(fh.confirmation_gradient AS DECIMAL(5,5)), 1)
                    ELSE 0 END"""


# Lógica vieja (hasta FY26): tasa por país sobre el GB (Expedia y otros 3 partners en 0) + conector de la tabla vieja.
def _tasa_pais_old(vista):
    if vista == "GD":
        return """fh.gestion_gb * fh.confirmation_gradient * CASE fh.country_code
                        WHEN 'BR' THEN -0.0048 WHEN 'MX' THEN -0.0055 WHEN 'AR' THEN -0.0120 WHEN 'CO' THEN -0.0100
                        WHEN 'CL' THEN -0.034048 WHEN 'PE' THEN -0.0160 WHEN 'EC' THEN 0.0000
                        ELSE CASE WHEN fh.country_code IN ('US','PA','UY') THEN -0.0075 ELSE -0.0070 END END"""
    return """fh.gestion_gb * CASE fh.country_code
                        WHEN 'BR' THEN -0.0042 WHEN 'MX' THEN -0.0050 WHEN 'AR' THEN -0.0120 WHEN 'CO' THEN -0.0100
                        WHEN 'CL' THEN -0.03405 WHEN 'PE' THEN -0.0160 WHEN 'EC' THEN 0.0000
                        ELSE -0.0070 END"""


def third_party_api_sql(vista: str) -> str:
    """SUM(...) AS white_labels_api. vista 'GD' (montos x confirmation_gradient) o 'RI' (montos enteros).
    Necesita los alias fh (sales_recognition), p (products), pr (channels_bo_product) y con (conectores)."""
    gb = "fh.gestion_gb * fh.confirmation_gradient" if vista == "GD" else "fh.gestion_gb"
    grad = " * fh.confirmation_gradient" if vista == "GD" else ""
    return f"""
        SUM(CASE
            WHEN {api_nuevo(vista)} THEN
                -{_RATE_SQL} * {gb}
                - CASE WHEN fh.channel = 'expedia' THEN 0
                       ELSE COALESCE(pr.net_commission_partner * pr.conversion_rate, 0){grad} END
                - {_conector()}
            WHEN fh.parent_channel = 'API' THEN
                CASE WHEN fh.partner_id IN ('AG72472','expedia','AG00044461','AG00101284') THEN 0
                     ELSE {_tasa_pais_old(vista)} END
                - {_conector("_old")}
            ELSE NULL END
        ) AS white_labels_api"""


def cancelaciones_sql(vista: str) -> str:
    """-SUM(...) AS cancellations: API en 0 desde FY27; el resto como viene del Datalake."""
    div = " / NULLIF(fh.confirmation_gradient, 0)" if vista == "RI" else ""
    return f"""
        -SUM(CASE WHEN {api_nuevo(vista)} THEN 0 ELSE pnl.cancellations_usd{div} END) AS cancellations"""


def efecto_financiero_sql(vista: str) -> str:
    """SUM(...) AS efecto_financiero. vista 'GD' (montos del P&L tal cual) o 'RI' (divididos por confirmation_gradient)."""
    div = " / NULLIF(fh.confirmation_gradient, 0)" if vista == "RI" else ""
    return f"""
        SUM(CASE WHEN {api_nuevo(vista)}
                 THEN (pnl.van_collection_usd - pnl.collection_amount_usd){div}
                 ELSE pnl.financial_result_usd{div} END) AS efecto_financiero"""
