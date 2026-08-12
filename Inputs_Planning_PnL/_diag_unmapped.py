import re
from collections import defaultdict
import plana_projections_builder as b

g = b.load_glosario()
CODE = re.compile(r'^(c/m_|prd_|br_|lob_)', re.I)
DIMS = {"Marca":("marca","Marca"),"Pais":("paises","Pais"),"Producto":("producto","Producto"),
        "LOB-CANAL":("lob","LOB-CANAL"),"Linea P&L":("linea","Linea P&L")}
unmapped = {d: defaultdict(set) for d in DIMS}
for base in ["budget","forecast","runrate","lastrunrate"]:
    cfg=b.BASES[base]
    df=b.read_base(cfg["files"]); df=b.gb_orders_transform(df); df=b.apply_exclusions(df,cfg["is_forecast"])
    for dim,(gk,col) in DIMS.items():
        gm=g[gk]
        for val in df[col].dropna().astype(str).unique():
            key=val.strip().lower(); r=gm.get(key); v0=r[0] if r else None
            if r is None or v0 is None or bool(CODE.match(str(v0))):
                unmapped[dim][val].add(base)
for dim in DIMS:
    items=unmapped[dim]
    print(f"\n===== {dim}: {len(items)} sin resolver =====")
    for val in sorted(items, key=lambda s:s.lower()):
        print(f"  {val!r}   [{', '.join(sorted(items[val]))}]")
