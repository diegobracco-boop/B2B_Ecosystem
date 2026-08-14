# Config Pattern Research — Inputs Planning P&L

**Date:** 2026-08-14  
**Scope:** Hardcoded values audit + stdlib-only config recommendation for the five pipeline scripts.

---

## 1. Hardcoded Values Audit

### 1.1 Drive / Project IDs — change when project is cloned or migrated

| Value | File | Line | Category |
|---|---|---|---|
| `"1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV"` | `json_builder.py` | 29 | Drive folder ID |
| `"1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV"` | `baseline_builder.py` | 57 | Drive folder ID (duplicated) |
| `"1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv"` | `baseline_builder.py` | docstring | Baseline file ID (mentioned in comment, not used in code directly) |

The Drive folder ID appears in **two separate files** with the same literal string — a maintenance hazard: changing one without the other will silently break uploads.

### 1.2 Fiscal-Year-Specific Values — must update each new FY

| Value | File | Line | Notes |
|---|---|---|---|
| `FORECAST_VERSION = "2026.07.14"` | `pnl_common.py` | 64 | Current forecast model stamp; comment says "update by hand" |
| `"Control de Gestión - 2026-27"` | `pnl_common.py` | 37 | Shared OneDrive folder name contains FY label |
| `FISCAL_DATES` list (`2026-04-01` … `2027-03-01`) | `plana_projections_builder.py` | 34–37 | FY27 months |
| `FORECAST_DROP_DATES` (`2026-04-01` … `2026-07-01`) | `plana_projections_builder.py` | 38 | Actuals lock-out window for Forecast |
| CSV filenames in `BASES` dict (e.g. `"Budget 2027 - Legal Entity ALL.csv"`) | `plana_projections_builder.py` | 43–52 | Contain the FY year in the filename |
| `AXI_RR_DATES` (`2025-10` … `2026-03`) | `plana_actuals_builder.py` | 46 | RunRate coverage window |
| `CURRENT_FY = 2027` | `json_builder.py` | 37 | Current fiscal year for actuals split |
| `RUNRATE_MONTHS` (`2026-08-01`, `2026-09-01`) | `baseline_builder.py` | 66 | Months assigned to RunRate in baseline |
| `FORECAST_MONTHS` (`2026-10-01` … `2027-03-01`) | `baseline_builder.py` | 67–68 | Months assigned to Forecast in baseline |

### 1.3 User-Specific / Environment Paths — vary per machine or company

| Value | File | Line | Notes |
|---|---|---|---|
| `"despegar365"`, `"OneDrive - despegar365"`, `"OneDrive - Despegar365"` | `pnl_common.py` | 25–27 | OneDrive root candidates; company-branded names |
| `"Planning-PBI - Inputs Power Bi"` | `pnl_common.py` | 42 | Shared OneDrive folder name |
| `"Proyectos IA"`, `"BITUBIA"` | `pnl_common.py` | 46, 54, 58 | Sub-path segments under `B2B & WLs` |
| `"Glosario.xlsx"`, `"Reverso AxI.xlsx"` | `pnl_common.py` | 46, 50 | Specific filenames (stable, but surfacing them helps) |
| `"Forecast"` (subfolder of models dir) | `pnl_common.py` | 68 | Used in `get_models_dir()` |

### 1.4 Business-Logic Constants (stable but worth surfacing)

These are not likely to change year-to-year but are opaque when buried in code:

- `LOBS_KEEP = ["b2b", "b2b2c", "b2c"]` — `pnl_common.py:127`
- `EXCL_AXI_MARCA`, `EXCL_MARCA`, `EXCL_LOBCANAL`, `EXCL_LINEA`, `EXCL_FUTURO`, `EXCL_LINEA_ACT` — exclusion sets across multiple files
- `PAIS_AXI_MAP` — country-name normalization map — `pnl_common.py:130–135`

These are best kept in code (they are business rules, not deployment config), but they should live in one place (`pnl_common.py`) rather than being scattered.

---

## 2. Stdlib-Only Config Patterns

Three viable approaches using nothing but Python's standard library:

### Option A — `config.py` (plain Python module)

```python
# config.py
DRIVE_FOLDER_ID = "1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV"
CURRENT_FY      = 2027
FORECAST_VERSION = "2026.07.14"

FISCAL_YEAR_START = "2026-04-01"
FISCAL_YEAR_END   = "2027-03-01"
# … etc.
```

```python
# consumer
import config
print(config.DRIVE_FOLDER_ID)
```

**Pros:** Zero boilerplate. Full Python expressiveness (can derive values, add comments, use `datetime`). Works in every IDE. Trivial to import anywhere.  
**Cons:** Config "file" is Python — a teammate editing it could accidentally introduce a bug. Not suitable if you want non-programmers to edit it safely.  
**Docs:** No stdlib module needed — it is just a module import.

---

### Option B — `configparser` (INI-style file)

```ini
# config.ini
[drive]
folder_id = 1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV

[fiscal]
current_fy       = 2027
forecast_version = 2026.07.14
fiscal_start     = 2026-04-01
fiscal_end       = 2027-03-01

[onedrive]
shared_folder = Control de Gestión - 2026-27
pbi_folder    = Planning-PBI - Inputs Power Bi
```

```python
import configparser, os
_cfg = configparser.ConfigParser()
_cfg.read(os.path.join(os.path.dirname(__file__), "config.ini"), encoding="utf-8")

DRIVE_FOLDER_ID  = _cfg["drive"]["folder_id"]
CURRENT_FY       = _cfg["fiscal"].getint("current_fy")
FORECAST_VERSION = _cfg["fiscal"]["forecast_version"]
```

**Pros:** Non-Python teammates can safely edit the `.ini` without touching code. Key-value format is familiar (like `.env`). `configparser` supports `getint`, `getboolean`, `getfloat` for typed reads.  
**Cons:** All values are strings by default (must cast manually for ints/dates). No lists or nested structures without workarounds. Slightly more boilerplate to read.  
**Docs:** https://docs.python.org/3/library/configparser.html

---

### Option C — `json` (JSON file)

```json
{
  "drive_folder_id": "1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV",
  "current_fy": 2027,
  "forecast_version": "2026.07.14",
  "fiscal_dates": [
    "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01",
    "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01",
    "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"
  ],
  "onedrive_shared_folder": "Control de Gestión - 2026-27"
}
```

```python
import json, os
with open(os.path.join(os.path.dirname(__file__), "config.json"), encoding="utf-8") as f:
    _cfg = json.load(f)

DRIVE_FOLDER_ID = _cfg["drive_folder_id"]
CURRENT_FY      = _cfg["current_fy"]          # already int — JSON preserves types
FISCAL_DATES    = _cfg["fiscal_dates"]        # already list
```

**Pros:** Native list and int support — no manual casting. JSON is universally editable. Easiest to parse programmatically (e.g. from an Apps Script or another language).  
**Cons:** No comments allowed in standard JSON (use `//` workaround via `json5` lib, but that breaks stdlib-only constraint). Slightly more verbose for simple scalar values.  
**Docs:** https://docs.python.org/3/library/json.html

---

## 3. Recommendation

**Use Option A (`config.py`)** for this project.

**Rationale:**

1. **All editors are Python developers.** The team already reads and edits `.py` files. There is no audience for a non-Python config format.
2. **This project already has a shared module** (`pnl_common.py`). The pattern is: move the mutable constants out of `pnl_common.py` into a `config.py` that sits next to it, and import from there. `pnl_common.py` becomes pure logic.
3. **Python lets you derive values.** `FISCAL_DATES` can be computed from `CURRENT_FY` instead of being a hardcoded list — reducing the number of things to update each year.
4. **Zero friction.** No `open()`, no `getint()`, no casting. Import and use.

### Suggested `config.py` layout

```python
# config.py — team-configurable values for the P&L pipeline.
# Edit this file (not pnl_common.py) when starting a new fiscal year.

# ── Drive ─────────────────────────────────────────────────────────────────────
DRIVE_FOLDER_ID  = "1XqQPL_rlS0NRIPUnPfj5nALBTn7kAOQV"  # Drive folder for JSON outputs
BASELINE_FILE_ID = "1Su36jhCMdNgC6nixxX5TyvtCI4ESG2Tv"  # baseline_actuals+projections.json

# ── Fiscal year ───────────────────────────────────────────────────────────────
CURRENT_FY       = 2027          # FY in progress (Apr CURRENT_FY-1 → Mar CURRENT_FY)
FORECAST_VERSION = "2026.07.14"  # Forecast model stamp — update when team confirms a new one

# ── Derived fiscal dates (do not edit; change CURRENT_FY above) ──────────────
_fy = CURRENT_FY
FISCAL_DATES = (
    [f"{_fy-1}-{m:02d}-01" for m in range(4, 13)] +  # Apr–Dec (FY-1)
    [f"{_fy}-{m:02d}-01"   for m in range(1, 4)]      # Jan–Mar (FY)
)
FORECAST_DROP_DATES = {f"{_fy-1}-{m:02d}-01" for m in range(4, 8)}   # Apr–Jul locked
AXI_RR_DATES        = {f"{_fy-2}-{m:02d}-01" for m in range(10, 13)} \
                    | {f"{_fy-1}-{m:02d}-01" for m in range(1, 4)}   # Oct(FY-2)–Mar(FY-1)
RUNRATE_MONTHS      = {f"{_fy-1}-{m:02d}-01" for m in (8, 9)}        # Aug–Sep (FY-1)
FORECAST_MONTHS     = {f"{_fy-1}-{m:02d}-01" for m in range(10, 13)} \
                    | {f"{_fy}-{m:02d}-01"   for m in range(1, 4)}   # Oct(FY-1)–Mar(FY)

# ── OneDrive folder names (change only if IT renames the shared folders) ──────
ONEDRIVE_TEAM_FOLDER = f"Control de Gestión - {_fy-1}-{str(_fy)[-2:]}"
ONEDRIVE_PBI_FOLDER  = "Planning-PBI - Inputs Power Bi"
ONEDRIVE_CANDIDATES  = ("despegar365", "OneDrive - despegar365", "OneDrive - Despegar365")

# ── Sub-path segments under the team folder ───────────────────────────────────
PATH_BITUBIA   = ("Proyectos IA", "BITUBIA")
PATH_REVISION  = ("Proyectos IA", "Codigo - revision P&L")
FILE_GLOSARIO  = "Glosario.xlsx"
FILE_REVERSO   = "Reverso AxI.xlsx"

# ── Forecast model subfolder ──────────────────────────────────────────────────
FORECAST_SUBFOLDER = "Forecast"
```

### Migration steps

1. Create `config.py` next to `pnl_common.py`.
2. In `pnl_common.py`, replace each hardcoded constant with `from config import ...`.
3. In `json_builder.py` and `baseline_builder.py`, replace the duplicated `DRIVE_FOLDER_ID` literal with `from config import DRIVE_FOLDER_ID`.
4. In `plana_projections_builder.py` and `plana_actuals_builder.py`, replace `FISCAL_DATES`, `FORECAST_DROP_DATES`, `AXI_RR_DATES` with imports from `config`.
5. Add `config.py` to version control. Add `token_drive.json` and `credentials_drive.json` to `.gitignore` (they already should be).

### Each new fiscal year

Change **only** `CURRENT_FY` and `FORECAST_VERSION` in `config.py`. All date lists, folder names, and month sets derive automatically.

---

## Sources

- Python `configparser`: https://docs.python.org/3/library/configparser.html
- Python `json`: https://docs.python.org/3/library/json.html
- Python modules as config (PEP 328, importlib): https://docs.python.org/3/reference/import.html
- "Twelve-Factor App — Config" (general best practice, language-agnostic): https://12factor.net/config
