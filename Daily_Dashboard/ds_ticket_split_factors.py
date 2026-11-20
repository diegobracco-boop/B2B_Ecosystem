# -*- coding: utf-8 -*-
# GENERADO por calc_ds_ticket_split.py — NO editar a mano. Ver ese script para el porqué y cómo regenerarlo.
# Ventana de referencia: 2026-04-01 .. 2026-10-31 (actuals RI B2B, Dest. Serv. standalone).
# Proporción del NR de Dest. Serv. que es Tickets, por (canal, país); FIJA para adelante. Solo Budget (OKR H2).
# Busqueda: (canal, país) -> (canal, "TOTAL") -> ("TOTAL", "TOTAL").
DS_TICKET_WINDOW = ("2026-04-01", "2026-10-31")
DS_TICKET_NR_REF = {   # NR de Dest. Serv. en la ventana (USD)
    ('API', 'Brasil'): 40783,
    ('API', 'Colombia'): 158,
    ('API', 'Mexico'): 78,
    ('API', 'TOTAL'): 41019,
    ('Agencias afiliadas', 'Argentina'): 104037,
    ('Agencias afiliadas', 'Brasil'): 924805,
    ('Agencias afiliadas', 'Chile'): 54574,
    ('Agencias afiliadas', 'Colombia'): 146260,
    ('Agencias afiliadas', 'Mexico'): 263143,
    ('Agencias afiliadas', 'Other Countries'): 1908,
    ('Agencias afiliadas', 'Peru'): 21425,
    ('Agencias afiliadas', 'TOTAL'): 1516151,
    ('TOTAL', 'TOTAL'): 1557170,
}
DS_TICKET_SHARE = {
    ('API', 'Brasil'): 0.996168,
    ('API', 'TOTAL'): 0.990959,
    ('Agencias afiliadas', 'Argentina'): 0.153456,
    ('Agencias afiliadas', 'Brasil'): 0.763489,
    ('Agencias afiliadas', 'Chile'): 0.590009,
    ('Agencias afiliadas', 'Colombia'): 0.106675,
    ('Agencias afiliadas', 'Mexico'): 0.336818,
    ('Agencias afiliadas', 'Peru'): 0.270089,
    ('Agencias afiliadas', 'TOTAL'): 0.570779,
    ('TOTAL', 'TOTAL'): 0.581848,
}
