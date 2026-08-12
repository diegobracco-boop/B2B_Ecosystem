# /actualizar — Actualizar planas + JSON canónicos y subir a Drive

Ejecuta el pipeline completo de Inputs Planning P&L: genera las planas desde los CSV
crudos de Planning-PBI y publica los JSON canónicos por concepto en Drive.

Si el usuario dice solo "proyecciones" → correr únicamente budget/forecast/runrate/lastrunrate.
Si dice "actuals" → solo el/los FY de actuals. Sin aclaración → correr TODO.

## Pasos
1. Verificar que los XLSX/CSV fuente estén cerrados (Excel) y sincronizados en OneDrive.
2. Correr desde la carpeta del proyecto (en este orden, o directamente `run_all.bat`):
   - `python plana_projections_builder.py budget`
   - `python plana_projections_builder.py forecast`
   - `python plana_projections_builder.py runrate`
   - `python plana_projections_builder.py lastrunrate`
   - `python plana_actuals_builder.py 2027`   (FY27 = mensual)
   - `python json_builder.py all`
3. En cada plana, revisar la VERIFICACIÓN (nulos=0 en Marca/LoB/Canal/Pais/Producto; países y productos con nombres reales; total razonable). Si hay muchos códigos crudos (`c/m_*`, `prd_*`) → falta completar el Glosario; avisar.
4. Confirmar que los 5 JSON (budget/forecast/runrate/lastrunrate/actuals) subieron a Drive.
5. Recordar al usuario recargar las landings (Ctrl+F5) una vez que estén repunteadas (Fase 2).

## Notas
- Default SIN PPA (suma Reverso AxI). Con PPA: agregar `--con-ppa`.
- Si falla por autenticación de Drive: `python auth_drive.py` (una vez por persona).
- Reglas y detalles completos: ver `CLAUDE.md` en esta carpeta.
