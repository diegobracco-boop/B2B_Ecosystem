# -*- coding: utf-8 -*-
"""
weekly_insights.py
==================
Prepara insights_input.json con KPIs y semáforos por LOB.
Claude genera los bullets narrativos con /generar-insights.
Se llama desde daily_sync.py al final del sync diario.
No conecta al Datalake — recibe los DataFrames ya cargados.
"""

import json
from datetime import date, timedelta, datetime
from pathlib import Path

import pandas as pd


MESES_ES = {
    1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
    5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
    9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre'
}

INSIGHTS_INPUT_PATH = Path(__file__).resolve().parent / 'insights_input.json'

# Umbrales semáforo (% desviación vs budget)
THRESHOLDS    = {'verde': -2.0, 'amarillo': -8.0}
THRESHOLDS_PP = {'verde': -0.5, 'amarillo': -2.0}


# ──────────────────────────────────────────────────────────────
#  Helpers
# ──────────────────────────────────────────────────────────────

def _semaforo_pct(pct):
    if pct is None:
        return '⚪'
    if pct >= THRESHOLDS['verde']:
        return '🟢'
    if pct >= THRESHOLDS['amarillo']:
        return '🟡'
    return '🔴'


def _semaforo_pp(pp):
    if pp is None:
        return '⚪'
    if pp >= THRESHOLDS_PP['verde']:
        return '🟢'
    if pp >= THRESHOLDS_PP['amarillo']:
        return '🟡'
    return '🔴'


def _semaforo_global(semaforos: dict) -> str:
    orden = {'🔴': 0, '🟡': 1, '🟢': 2, '⚪': 3}
    vals = [v for v in semaforos.values() if v in orden]
    if not vals:
        return '⚪'
    return min(vals, key=lambda x: orden[x])


def _safe_pct(actual, ref):
    try:
        if ref and ref != 0:
            return round((actual - ref) / abs(ref) * 100, 1)
    except Exception:
        pass
    return None


def _safe_pp(actual_pct, ref_pct):
    try:
        if actual_pct is not None and ref_pct is not None:
            return round(actual_pct - ref_pct, 2)
    except Exception:
        pass
    return None


def _fmt_m(val):
    if val is None:
        return '—'
    if abs(val) >= 1_000_000:
        return f'${val/1_000_000:.1f}M'
    if abs(val) >= 1_000:
        return f'${val/1_000:.0f}K'
    return f'${val:.0f}'


def _fmt_pct(val):
    if val is None:
        return '—'
    sign = '+' if val >= 0 else ''
    return f'{sign}{val:.1f}%'


def _fmt_pp(val):
    if val is None:
        return '—'
    sign = '+' if val >= 0 else ''
    return f'{sign}{val:.1f}pp'


def _arrow(val):
    if val is None:
        return '●'
    return '▲' if val >= 0 else '▼'


def _periodo_str(inicio: date, fin: date) -> str:
    if inicio.month == fin.month:
        return f'{inicio.day}–{fin.day} {MESES_ES[inicio.month]} {inicio.year}'
    return f'{inicio.day} {MESES_ES[inicio.month]} – {fin.day} {MESES_ES[fin.month]} {fin.year}'


def _mes_str(year: int, month: int) -> str:
    return f'{MESES_ES[month]} {year}'


def _last_day(year: int, month: int) -> int:
    import calendar
    return calendar.monthrange(year, month)[1]


# ──────────────────────────────────────────────────────────────
#  Filtrado por rango de fechas
# ──────────────────────────────────────────────────────────────

def _filter_dates(df: pd.DataFrame, date_col: str, desde: date, hasta: date) -> pd.DataFrame:
    if df.empty:
        return df
    col = df[date_col].copy()
    if not pd.api.types.is_datetime64_any_dtype(col):
        col = pd.to_datetime(col, errors='coerce')
    mask = (col.dt.date >= desde) & (col.dt.date <= hasta)
    return df[mask]


def _filter_month(df: pd.DataFrame, date_col: str, year: int, month: int) -> pd.DataFrame:
    if df.empty:
        return df
    col = df[date_col].copy()
    if not pd.api.types.is_datetime64_any_dtype(col):
        col = pd.to_datetime(col, errors='coerce')
    mask = (col.dt.year == year) & (col.dt.month == month)
    return df[mask]


# ──────────────────────────────────────────────────────────────
#  Aggregate helpers
# ──────────────────────────────────────────────────────────────

def _agg_b2b2c(df: pd.DataFrame, nr_col: str = 'net_revenues') -> dict:
    if df.empty:
        return {'gb': 0, 'nr': 0, 'orders': 0, 'fvm': 0}
    return {
        'gb':     float(df['gross_bookings'].sum()),
        'nr':     float(df[nr_col].sum()),
        'orders': int(df['orders'].sum()),
        'fvm':    float(df['fvm'].sum()),
    }


def _agg_b2b(gd: pd.DataFrame, ri: pd.DataFrame) -> dict:
    frames = [f for f in [gd, ri] if not f.empty]
    if not frames:
        return {'gb': 0, 'nr': 0, 'orders': 0, 'fvm': 0}
    combined = pd.concat(frames, ignore_index=True)
    return {
        'gb':     float(combined['gross_bookings'].sum()),
        'nr':     float(combined['net_revenue'].sum()),
        'orders': int(combined['orders'].sum()),
        'fvm':    float(combined['fvm'].sum()),
    }


def _margen(gb, nr):
    try:
        if gb and gb != 0:
            return round(nr / gb * 100, 2)
    except Exception:
        pass
    return None


def _merge_agg(a: dict, b: dict) -> dict:
    return {
        'gb':     a.get('gb', 0) + b.get('gb', 0),
        'nr':     a.get('nr', 0) + b.get('nr', 0),
        'orders': a.get('orders', 0) + b.get('orders', 0),
        'fvm':    a.get('fvm', 0) + b.get('fvm', 0),
    }


def _compact_to_df(compact_or_df):
    if isinstance(compact_or_df, pd.DataFrame):
        return compact_or_df
    if isinstance(compact_or_df, dict) and 'cols' in compact_or_df:
        return pd.DataFrame(compact_or_df['rows'], columns=compact_or_df['cols'])
    return pd.DataFrame()


# ──────────────────────────────────────────────────────────────
#  Build KPIs for one LOB (no bullets — Claude generates those)
# ──────────────────────────────────────────────────────────────

def _build_kpis(actual: dict, budget: dict, ly: dict, periodo: str, corte: str) -> dict:
    gb_a   = actual.get('gb', 0)
    nr_a   = actual.get('nr', 0)
    ord_a  = actual.get('orders', 0)

    gb_b   = budget.get('gb', 0)
    nr_b   = budget.get('nr', 0)
    ord_b  = budget.get('orders', 0)

    gb_ly  = ly.get('gb', 0)
    nr_ly  = ly.get('nr', 0)
    ord_ly = ly.get('orders', 0)

    margen_a  = _margen(gb_a, nr_a)
    margen_b  = _margen(gb_b, nr_b)
    margen_ly = _margen(gb_ly, nr_ly)

    gb_vs_bgt    = _safe_pct(gb_a, gb_b)
    nr_vs_bgt    = _safe_pct(nr_a, nr_b)
    ord_vs_bgt   = _safe_pct(ord_a, ord_b)
    mg_vs_bgt_pp = _safe_pp(margen_a, margen_b)

    gb_vs_ly    = _safe_pct(gb_a, gb_ly)
    nr_vs_ly    = _safe_pct(nr_a, nr_ly)
    ord_vs_ly   = _safe_pct(ord_a, ord_ly)
    mg_vs_ly_pp = _safe_pp(margen_a, margen_ly)

    semaforos = {
        'gb':     _semaforo_pct(gb_vs_bgt),
        'nr':     _semaforo_pct(nr_vs_bgt),
        'orders': _semaforo_pct(ord_vs_bgt),
        'margen': _semaforo_pp(mg_vs_bgt_pp),
    }

    return {
        'semaforo_global': _semaforo_global(semaforos),
        'semaforos':       semaforos,
        'periodo':         periodo,
        'corte':           corte,
        'referencia':      'Budget',
        'kpis': {
            'gb_actual':            round(gb_a, 2),
            'gb_budget':            round(gb_b, 2),
            'gb_ly':                round(gb_ly, 2),
            'gb_vs_budget_pct':     gb_vs_bgt,
            'gb_vs_ly_pct':         gb_vs_ly,
            'nr_actual':            round(nr_a, 2),
            'nr_budget':            round(nr_b, 2),
            'nr_ly':                round(nr_ly, 2),
            'nr_vs_budget_pct':     nr_vs_bgt,
            'nr_vs_ly_pct':         nr_vs_ly,
            'orders_actual':        ord_a,
            'orders_budget':        ord_b,
            'orders_ly':            ord_ly,
            'orders_vs_budget_pct': ord_vs_bgt,
            'orders_vs_ly_pct':     ord_vs_ly,
            'margen_pct':           margen_a,
            'margen_budget_pct':    margen_b,
            'margen_ly_pct':        margen_ly,
            'margen_vs_budget_pp':  mg_vs_bgt_pp,
            'margen_vs_ly_pp':      mg_vs_ly_pp,
        },
        # bullets y slide_bullets los genera Claude con /generar-insights
        'bullets':       [],
        'slide_bullets': [],
    }


# ──────────────────────────────────────────────────────────────
#  Main entry point
# ──────────────────────────────────────────────────────────────

def generate_insights_input(
    df_act, df_lya, df_bud, df_b2bc_rr_agg,
    df_b2b_gd_agg, df_b2b_gd_ly_ag, df_b2b_ri_agg, df_b2b_ri_ly_ag,
    df_b2b_bud_gd, df_b2b_bud_ri, df_b2b_rr_gd_agg, df_b2b_rr_ri_agg,
    today,
):
    print('  Calculando períodos...')

    # ── Semana anterior completa (lunes–domingo) ──
    days_since_monday = today.weekday()
    this_monday       = today - timedelta(days=days_since_monday)
    sem_fin           = this_monday - timedelta(days=1)
    sem_inicio        = sem_fin - timedelta(days=6)
    periodo_str       = _periodo_str(sem_inicio, sem_fin)
    corte_str         = sem_fin.strftime('%d/%m/%Y')
    print(f'  Semana: {sem_inicio} → {sem_fin}')

    # ── Mes anterior ──
    if today.month == 1:
        mes_ant_year, mes_ant_month = today.year - 1, 12
    else:
        mes_ant_year, mes_ant_month = today.year, today.month - 1
    mes_anterior_str = _mes_str(mes_ant_year, mes_ant_month)
    print(f'  MRM: {mes_anterior_str}')

    # ══════════════════════════════════════════════
    #  B2B2C — semana
    # ══════════════════════════════════════════════
    print('  Agregando B2B2C semana...')
    act_w  = _filter_dates(df_act, 'fecha', sem_inicio, sem_fin)
    ly_w   = _filter_dates(df_lya, 'fecha', sem_inicio - timedelta(days=364), sem_fin - timedelta(days=364))
    bud_w  = _filter_dates(df_bud, 'fecha', sem_inicio, sem_fin)

    b2b2c_actual  = _agg_b2b2c(act_w, nr_col='net_revenues')
    b2b2c_ly      = _agg_b2b2c(ly_w,  nr_col='net_revenues')
    b2b2c_bud_agg = {
        'gb':     float(bud_w['gross_bookings'].sum()) if not bud_w.empty else 0,
        'nr':     float(bud_w['net_revenue'].sum())    if not bud_w.empty else 0,
        'orders': int(bud_w['orders'].sum())           if not bud_w.empty else 0,
        'fvm':    float(bud_w['fvm'].sum())            if not bud_w.empty else 0,
    }
    b2b2c_kpis = _build_kpis(b2b2c_actual, b2b2c_bud_agg, b2b2c_ly, periodo_str, corte_str)

    # ══════════════════════════════════════════════
    #  B2B — semana (GD + RI)
    # ══════════════════════════════════════════════
    print('  Agregando B2B semana...')
    gd_w     = _filter_dates(_compact_to_df(df_b2b_gd_agg),   'fecha', sem_inicio, sem_fin)
    ri_w     = _filter_dates(_compact_to_df(df_b2b_ri_agg),   'fecha', sem_inicio, sem_fin)
    gd_ly_w  = _filter_dates(_compact_to_df(df_b2b_gd_ly_ag), 'fecha', sem_inicio - timedelta(days=364), sem_fin - timedelta(days=364))
    ri_ly_w  = _filter_dates(_compact_to_df(df_b2b_ri_ly_ag), 'fecha', sem_inicio - timedelta(days=364), sem_fin - timedelta(days=364))
    bud_gd_w = _filter_dates(_compact_to_df(df_b2b_bud_gd),   'fecha', sem_inicio, sem_fin)
    bud_ri_w = _filter_dates(_compact_to_df(df_b2b_bud_ri),   'fecha', sem_inicio, sem_fin)

    b2b_actual = _agg_b2b(gd_w,     ri_w)
    b2b_ly     = _agg_b2b(gd_ly_w,  ri_ly_w)
    b2b_bud    = _agg_b2b(bud_gd_w, bud_ri_w)
    b2b_kpis   = _build_kpis(b2b_actual, b2b_bud, b2b_ly, periodo_str, corte_str)

    # ══════════════════════════════════════════════
    #  Consolidado semana
    # ══════════════════════════════════════════════
    print('  Agregando Consolidado semana...')
    consol_actual = _merge_agg(b2b2c_actual, b2b_actual)
    consol_bud    = _merge_agg(b2b2c_bud_agg, b2b_bud)
    consol_ly     = _merge_agg(b2b2c_ly, b2b_ly)
    consol_kpis   = _build_kpis(consol_actual, consol_bud, consol_ly, periodo_str, corte_str)

    # ══════════════════════════════════════════════
    #  MRM — mes anterior
    # ══════════════════════════════════════════════
    print(f'  Agregando MRM ({mes_anterior_str})...')
    mrm_periodo_str = mes_anterior_str
    mrm_corte_str   = f'01/{mes_ant_month:02d}/{mes_ant_year} – {_last_day(mes_ant_year, mes_ant_month):02d}/{mes_ant_month:02d}/{mes_ant_year}'

    act_m  = _filter_month(df_act, 'fecha', mes_ant_year, mes_ant_month)
    ly_m   = _filter_month(df_lya, 'fecha', mes_ant_year - 1, mes_ant_month)
    bud_m  = _filter_month(df_bud, 'fecha', mes_ant_year, mes_ant_month)

    mrm_b2b2c_actual = _agg_b2b2c(act_m, nr_col='net_revenues')
    mrm_b2b2c_ly     = _agg_b2b2c(ly_m,  nr_col='net_revenues')
    mrm_b2b2c_bud    = {
        'gb':     float(bud_m['gross_bookings'].sum()) if not bud_m.empty else 0,
        'nr':     float(bud_m['net_revenue'].sum())    if not bud_m.empty else 0,
        'orders': int(bud_m['orders'].sum())           if not bud_m.empty else 0,
        'fvm':    float(bud_m['fvm'].sum())            if not bud_m.empty else 0,
    }
    mrm_b2b2c_kpis = _build_kpis(mrm_b2b2c_actual, mrm_b2b2c_bud, mrm_b2b2c_ly, mrm_periodo_str, mrm_corte_str)

    gd_m     = _filter_month(_compact_to_df(df_b2b_gd_agg),   'fecha', mes_ant_year, mes_ant_month)
    ri_m     = _filter_month(_compact_to_df(df_b2b_ri_agg),   'fecha', mes_ant_year, mes_ant_month)
    gd_ly_m  = _filter_month(_compact_to_df(df_b2b_gd_ly_ag), 'fecha', mes_ant_year - 1, mes_ant_month)
    ri_ly_m  = _filter_month(_compact_to_df(df_b2b_ri_ly_ag), 'fecha', mes_ant_year - 1, mes_ant_month)
    bud_gd_m = _filter_month(_compact_to_df(df_b2b_bud_gd),   'fecha', mes_ant_year, mes_ant_month)
    bud_ri_m = _filter_month(_compact_to_df(df_b2b_bud_ri),   'fecha', mes_ant_year, mes_ant_month)

    mrm_b2b_actual = _agg_b2b(gd_m,     ri_m)
    mrm_b2b_ly     = _agg_b2b(gd_ly_m,  ri_ly_m)
    mrm_b2b_bud    = _agg_b2b(bud_gd_m, bud_ri_m)
    mrm_b2b_kpis   = _build_kpis(mrm_b2b_actual, mrm_b2b_bud, mrm_b2b_ly, mrm_periodo_str, mrm_corte_str)

    mrm_consol_actual = _merge_agg(mrm_b2b2c_actual, mrm_b2b_actual)
    mrm_consol_bud    = _merge_agg(mrm_b2b2c_bud, mrm_b2b_bud)
    mrm_consol_ly     = _merge_agg(mrm_b2b2c_ly, mrm_b2b_ly)
    mrm_consol_kpis   = _build_kpis(mrm_consol_actual, mrm_consol_bud, mrm_consol_ly, mrm_periodo_str, mrm_corte_str)

    # ══════════════════════════════════════════════
    #  Guardar insights_input.json en disco
    # ══════════════════════════════════════════════
    payload = {
        'meta': {
            'generated_at':  datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
            'semana_inicio': str(sem_inicio),
            'semana_fin':    str(sem_fin),
            'corte':         str(sem_fin),
            'mes_anterior':  mes_anterior_str,
            'nota':          'bullets y slide_bullets los genera Claude con /generar-insights',
        },
        'b2b2c':       b2b2c_kpis,
        'b2b':         b2b_kpis,
        'consolidado': consol_kpis,
        'mrm': {
            'b2b2c':       mrm_b2b2c_kpis,
            'b2b':         mrm_b2b_kpis,
            'consolidado': mrm_consol_kpis,
        },
    }

    INSIGHTS_INPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )
    print('  OK insights_input.json guardado en disco.')
