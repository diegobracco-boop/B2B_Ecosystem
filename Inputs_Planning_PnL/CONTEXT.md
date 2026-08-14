# Inputs Planning PnL

Pipeline de datos que reemplaza a Toqan: lee CSVs crudos de OneDrive, genera planas homologadas y publica un JSON canónico por escenario en Drive. Es la fuente única de verdad para todas las landings del ecosistema B2B.

## Language

**Plana**:
Tabla larga con columnas fijas (Marca, LoB, Canal, País, Producto, Líneas P&L N1–N6, Managerial, Fecha, Monto USD). Puede estar cruda (sin homologar) o homologada.
_Evitar_: tabla, dataset, flat table

**Plana homologada**:
Plana cuyas dimensiones fueron mapeadas usando el Glosario, reemplazando códigos crudos de los CSV por nombres canónicos.
_Evitar_: plana procesada, plana limpia

**Homologar**:
Mapear códigos crudos de los CSV a nombres canónicos usando el Glosario (Marca, Países, Producto, LOB, Línea P&L).
_Evitar_: normalizar, limpiar, transformar

**Glosario**:
Archivo Excel (`Glosario.xlsx`) con solapas por dimensión (Marca, Países, Producto, LOB, Línea P&L) que define la correspondencia entre códigos crudos y nombres canónicos.
_Evitar_: diccionario, catálogo, lookup

**Escenario**:
Una de las cinco versiones del dato financiero: budget, forecast, runrate, lastrunrate, actuals. Cada escenario produce su propio JSON canónico.
_Evitar_: concepto, versión, base

**JSON canónico**:
Archivo JSON publicado en Drive, uno por escenario, que es la fuente única de verdad para todas las landings. Generado por `json_builder.py`.
_Evitar_: JSON de salida, archivo Drive

**Baseline**:
Proyección compuesta que se toma como referencia: combina actuals hasta el corte, runrate para meses intermedios, y forecast para el resto del año fiscal. No es un escenario más — es una composición de varios.
_Evitar_: proyección base, escenario base

**Landing**:
Aplicación HTML/Apps Script que consume los JSONs canónicos y los presenta al usuario final (ej: P&L Accounting, Dashboard B2B WLs).
_Evitar_: dashboard, herramienta, reporte

**Año fiscal**:
Período de abril (año N-1) a marzo (año N). FY27 = abril 2026 a marzo 2027.
_Evitar_: año calendar, año natural

**PPA**:
Modo de cálculo que excluye el Reverso AxI. El modo default (sin PPA) sí suma el Reverso AxI.
_Evitar_: (sigla propia del dominio, no sustituir)

**Reverso AxI**:
Ajuste que se suma en el modo default (sin PPA). Proviene de `Reverso AxI.xlsx`.
_Evitar_: ajuste, corrección
