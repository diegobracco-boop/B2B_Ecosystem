# -*- coding: utf-8 -*-
from dotenv import load_dotenv
import os, pyodbc, pandas as pd

load_dotenv(r"C:\Users\diego.bracco\Proyectos IA\envs\.env")
con = pyodbc.connect(
    f"DSN=DataLake Treasure ODBC;UID={os.getenv('USER')};PWD={os.getenv('PASSWORD')};",
    autocommit=True
)

print("=== COLUMNAS + 3 FILAS ===")
df = pd.read_sql("SELECT * FROM raw.b2b_budget_gd LIMIT 3", con)
print("Columnas:", df.columns.tolist())
print(df.to_string())

print("\n=== VALORES DISTINTOS DE lob_canal ===")
df2 = pd.read_sql("SELECT DISTINCT lob_canal FROM raw.b2b_budget_gd", con)
print(df2.to_string())

print("\n=== CONTEO POR mes_proyectado + no_mes_proyectado ===")
df3 = pd.read_sql("""
    SELECT no_mes_proyectado, mes_proyectado, COUNT(*) as n
    FROM raw.b2b_budget_gd
    GROUP BY no_mes_proyectado, mes_proyectado
    ORDER BY no_mes_proyectado
""", con)
print(df3.to_string())

con.close()
