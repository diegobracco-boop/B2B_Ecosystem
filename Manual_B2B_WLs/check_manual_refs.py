"""
check_manual_refs.py — chequeo barato de staleness de manual.html.

El manual documenta procesos/scripts/JSON de TODOS los módulos del repo a mano,
sin ninguna fuente estructurada. El patrón de drift más común y más caro es que
cite un script .py que ya no existe (pasó con pnl_gestional_upload.py,
pnl_contable_upload.py, pnl_contable_epm_upload.py, daily_sync_b2b2c.py).

Este script:
  - extrae todos los nombres `algo.py` mencionados en manual.html
  - verifica que cada uno exista en algún lado del repo
  - reporta los que no existen

No frena nada; imprime WARN y sale con código 1 si hay huérfanos (usable como
gate en /clasp-push del módulo).

Uso:  python check_manual_refs.py
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
MANUAL = os.path.join(HERE, "manual.html")

# .py conocidos que NO son scripts del repo (falsos positivos a ignorar)
IGNORE = {"check_manual_refs.py"}


def repo_py_files():
    found = set()
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".claude", "_backups")]
        for f in files:
            if f.endswith(".py"):
                found.add(f)
    return found


def cited_py_files(html):
    # nombres tipo foo_bar.py. Deben empezar con letra (así se descartan globs
    # como plana_*_builder.py, que el regex vería como "_builder.py").
    return sorted(set(re.findall(r"(?<![\w*])([A-Za-z][A-Za-z0-9_]*\.py)", html)))


def main():
    if not os.path.exists(MANUAL):
        sys.exit(f"No encontré {MANUAL}")
    html = open(MANUAL, encoding="utf-8").read()
    real = repo_py_files()
    cited = [c for c in cited_py_files(html) if c not in IGNORE]

    orphans = [c for c in cited if c not in real]
    if orphans:
        print("  [WARN] manual.html cita scripts .py que NO existen en el repo:")
        for o in orphans:
            print(f"    - {o}")
        print("  Revisá si el nombre cambió (ej. refactor) y actualizá el manual.")
        return 1
    print(f"  [OK] los {len(cited)} scripts .py citados en manual.html existen en el repo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
