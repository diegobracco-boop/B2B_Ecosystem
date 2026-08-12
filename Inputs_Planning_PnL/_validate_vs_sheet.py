import os, sys, json
import pandas as pd
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass

DIR = os.path.dirname(os.path.abspath(__file__))
FID = "1RVmTXDyyugCUXJ0f6JG_croNxWNLlOLm4eAs8F52u2c"
ALLDIMS = ["LOB","Canal","Pais","Producto","P&L N2","P&L N3","P&L N4","P&L N5","P&L N6","P&L Managerial View","Fecha"]
KEY = ["LOB","Canal","Pais","Producto","P&L N2","Fecha"]   # clave económica (N3-N6 son roll-up)

creds = Credentials.from_authorized_user_file(os.path.join(DIR,"token_drive.json"), ["https://www.googleapis.com/auth/drive"])
if not creds.valid: creds.refresh(Request())
SH = build("sheets","v4",credentials=creds)

def num(s):
    if s is None: return None
    s=str(s).strip()
    if s=="" or s.lower()=="#missing": return None
    if s.count(",")==1 and "." in s: s=s.replace(".","").replace(",",".")
    else: s=s.replace(",",".")
    try: return float(s)
    except ValueError: return None

def fecha(s):
    s=str(s).strip()
    if "/" in s:
        p=s.split("/");  # D/M/Y
        try: return f"{int(p[2]):04d}-{int(p[1]):02d}-01"
        except Exception: return s
    return s[:10]

def read_tab(tab):
    vals = SH.spreadsheets().values().get(spreadsheetId=FID, range=f"'{tab}'!A1:L").execute().get("values",[])
    hdr = [str(h).strip() for h in vals[0]]
    rows = vals[1:]
    df = pd.DataFrame(rows, columns=hdr[:len(rows[0])] if rows else hdr)
    # normalizar
    df = df[[c for c in df.columns if c in KEY or c=="Monto USD"]].copy()
    for c in KEY:
        if c=="Fecha": df["Fecha"]=df["Fecha"].map(fecha)
        elif c in df.columns: df[c]=df[c].astype(str).str.strip().str.lower()
    df["Monto USD"]=df["Monto USD"].map(num)
    df=df.dropna(subset=["Monto USD"])
    g=df.groupby(KEY, as_index=False, dropna=False)["Monto USD"].sum()
    print(f"  [tab {tab}] filas={len(g):,}  fechas {g['Fecha'].min()}..{g['Fecha'].max()}  ({g['Fecha'].nunique()} meses)")
    return g

def load_json(name):
    p=json.load(open(os.path.join(DIR,name),encoding="utf-8"))
    df=pd.DataFrame(p["rows"], columns=p["cols"]).rename(columns={"LoB":"LOB"})
    df=df.groupby(KEY, as_index=False, dropna=False)["Monto USD"].sum()  # agrega sobre N1
    return df

def compare(label, sheet_df, json_df, restrict_json_months=True):
    print(f"\n================= {label} =================")
    if restrict_json_months:
        common=set(sheet_df["Fecha"])&set(json_df["Fecha"])
        sheet_df=sheet_df[sheet_df["Fecha"].isin(common)]
        json_df =json_df [json_df ["Fecha"].isin(common)]
        print(f"  meses comparados: {len(common)}  ({min(common) if common else '-'} .. {max(common) if common else '-'})")
    m=sheet_df.merge(json_df, on=KEY, how="outer", suffixes=("_sheet","_json"), indicator=True)
    m["_s"]=m["Monto USD_sheet"].fillna(0); m["_j"]=m["Monto USD_json"].fillna(0)
    m["dif"]=(m["_j"]-m["_s"]).round(2)
    tol=1.0
    only_s=(m["_merge"]=="left_only").sum(); only_j=(m["_merge"]=="right_only").sum()
    both=m[m["_merge"]=="both"]
    mism=both[both["dif"].abs()>tol]
    print(f"  TOTAL  sheet: {sheet_df['Monto USD'].sum():,.0f}   json: {json_df['Monto USD'].sum():,.0f}   dif: {json_df['Monto USD'].sum()-sheet_df['Monto USD'].sum():,.0f}")
    print(f"  combos  sheet: {len(sheet_df):,}  json: {len(json_df):,}  |  match-exacto: {len(both)-len(mism):,}  dif-valor: {len(mism):,}  solo-sheet: {only_s:,}  solo-json: {only_j:,}")
    if len(mism):
        top=mism.reindex(mism["dif"].abs().sort_values(ascending=False).index).head(8)
        print("  -- top diferencias de valor --")
        for _,r in top.iterrows():
            print(f"     {r['LOB']}/{r['Canal']}/{r['Pais']}/{r['Producto']}/{r['P&L N2']}/{r['Fecha']}  sheet={r['_s']:,.0f} json={r['_j']:,.0f} dif={r['dif']:,.0f}")
    # análisis de SCOPE
    slob,jlob=set(sheet_df["LOB"]),set(json_df["LOB"])
    sn2,jn2=set(sheet_df["P&L N2"]),set(json_df["P&L N2"])
    print(f"  LOBs  sheet={sorted(slob)}  |  json={sorted(jlob)}")
    cl,cn=slob&jlob, sn2&jn2
    ss=sheet_df[sheet_df["LOB"].isin(cl)&sheet_df["P&L N2"].isin(cn)]
    jj=json_df [json_df ["LOB"].isin(cl)&json_df ["P&L N2"].isin(cn)]
    print(f"  [SCOPE COMÚN {len(cl)} LOBs x {len(cn)} lineas]  sheet={ss['Monto USD'].sum():,.0f}  json={jj['Monto USD'].sum():,.0f}  dif={jj['Monto USD'].sum()-ss['Monto USD'].sum():,.0f}")
    if sn2-jn2: print(f"    N2 SOLO en sheet: {sorted(sn2-jn2)}")
    if jn2-sn2: print(f"    N2 SOLO en json:  {sorted(jn2-sn2)}")
    # diff por línea N2 (para ver si el gap es solo GB u otros conceptos)
    byn2=m.groupby("P&L N2").agg(s=("_s","sum"), j=("_j","sum")).reset_index()
    byn2["dif"]=(byn2["j"]-byn2["s"])
    byn2=byn2.reindex(byn2["dif"].abs().sort_values(ascending=False).index).head(10)
    print("  -- diff por N2 (top 10) --")
    for _,r in byn2.iterrows():
        print(f"     {str(r['P&L N2'])[:30]:<30} sheet={r['s']:>15,.0f} json={r['j']:>15,.0f} dif={r['dif']:>13,.0f}")
    # muestra de solo-sheet / solo-json
    for tag,cond in [("solo-sheet","left_only"),("solo-json","right_only")]:
        sub=m[m["_merge"]==cond]
        if len(sub):
            ex=sub.head(4)
            print(f"  -- ejemplos {tag} ({len(sub):,}) --")
            for _,r in ex.iterrows():
                print(f"     {r['LOB']}/{r['Canal']}/{r['Pais']}/{r['Producto']}/{r['P&L N2']}/{r['Fecha']}")

# ── a) actuals ──
print("Leyendo tabs del Sheet...")
act = pd.concat([read_tab("Actuals"), read_tab("ActualsPrevios")], ignore_index=True).groupby(KEY, as_index=False, dropna=False)["Monto USD"].sum()
compare("ACTUALS  (json vs Actuals+ActualsPrevios)", act, load_json("actuals.json"))
# ── b) budget ──
compare("BUDGET   (json vs Budget)", read_tab("Budget"), load_json("budget.json"))
# ── c) runrate ──
compare("RUNRATE  (json vs RunRate)", read_tab("RunRate"), load_json("runrate.json"))
