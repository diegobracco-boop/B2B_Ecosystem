# Context Map

## Contextos

- [Inputs Planning PnL](./Inputs_Planning_PnL/CONTEXT.md) — pipeline Python que genera planas homologadas y publica JSONs canónicos en Drive
- [Daily Dashboard](./Daily_Dashboard/) — sincronización diaria de datos para el dashboard operativo
- [Dashboard B2B WLs](./Dashboard_B2B_WLs/) — dashboard de B2B y White Labels para seguimiento comercial
- [P&L Accounting](./P&L_Accounting/) — vista contable del P&L
- [P&L Managerial](./P&L_Managerial/) — vista gerencial del P&L
- [Manual B2B WLs](./Manual_B2B_WLs/) — carga manual de datos B2B WLs

## Relaciones

- **Inputs Planning PnL → todas las landings**: Inputs Planning PnL genera los JSONs canónicos por escenario; cada landing los consume como fuente única de verdad
- **Landings → usuario final**: cada landing es una aplicación HTML/Apps Script que presenta los datos al equipo de negocio
