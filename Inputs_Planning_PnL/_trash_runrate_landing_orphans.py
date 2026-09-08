"""
One-shot: manda a la PAPELERA de Drive (reversible 30 dias, NO hard-delete) los 3
JSON huerfanos de la carpeta "RunRate_Landing" (1R9cdzWi7...).

Verificado 2026-09-07: ninguna landing viva de B2B_Ecosystem los consume.
  - 1Rx6YY  _pnl_contable_epm_data.json   -> EPM migro a canonicos (1XqQPL); nadie lo lee
  - 1WjJWoz _delta_versiones_fvm.json      -> getDeltaFVM() sin caller en el front
  - 14Kb-y2 _pnl_gestional_data.json       -> orphan de una corrida legacy accidental (2026-08-20)

NO toca 1KHXgPy (_pnl_contable_data.json): lo leeria la vista oculta "P&L Model +
Accounting" si se reactivara. Decidir eso por separado.

Correr:  python _trash_runrate_landing_orphans.py
"""
import pnl_common

TARGETS = {
    "1Rx6YYnFH5SA6ltDoTu659O-h08dkljZm": "_pnl_contable_epm_data.json",
    "1WjJWozMEQywxhOjhcLzzak385-_dI6ro": "_delta_versiones_fvm.json",
    "14Kb-y2HEdxk-z8EBALgFQFkcAdnHfh7t": "_pnl_gestional_data.json (orphan)",
}
FOLDER = "1R9cdzWi7fdmzc2tclR52gkANG4W78cmb"

svc = pnl_common.get_drive_service()

for fid, name in TARGETS.items():
    try:
        m = svc.files().get(fileId=fid, fields="id,name,trashed,size").execute()
        sz = int(m.get("size", 0)) / 1e6
        print(f"{name:42} trashed={m.get('trashed')} size={sz:.2f}MB", end="")
        if m.get("trashed"):
            print("  (ya estaba en papelera, skip)")
            continue
        svc.files().update(fileId=fid, body={"trashed": True}).execute()
        print("  -> movido a PAPELERA  OK")
    except Exception as e:
        print(f"\n  ERROR {name}: {e}")

print("\nContenido restante de RunRate_Landing:")
res = svc.files().list(
    q=f"'{FOLDER}' in parents and trashed=false",
    fields="files(id,name,size,modifiedTime)",
).execute()
for f in res.get("files", []):
    print(f"  {f['id']}  {f['name']}  {int(f.get('size',0))/1e6:.2f}MB  mod={f['modifiedTime'][:10]}")
