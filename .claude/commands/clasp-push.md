# /clasp-push — Deployar una landing GAS a producción

Sube el código fuente local al proyecto de Google Apps Script correspondiente.
**Importante:** `git push` y `clasp push` son independientes. Un `git push` nunca toca las landings en vivo — hay que correr este comando explícitamente para publicar cambios.

## Módulos disponibles y sus carpetas

| Landing | Carpeta | Qué hace |
|---|---|---|
| Dashboard B2B WLs | `Dashboard_B2B_WLs/` | Seguimiento comercial B2B y White Labels |
| P&L Accounting | `P&L_Accounting/` | Vista contable del P&L |
| P&L Managerial | `P&L_Managerial/` | Vista gerencial del P&L |
| Manual B2B WLs | `Manual_B2B_WLs/` | Carga manual de datos |
| Daily Dashboard | `Daily_Dashboard/` | Dashboard operativo diario |

## Pasos

1. Asegurarse de que los cambios están commiteados en git:
   ```powershell
   git status   # no debe haber cambios sin commitear
   ```

2. Verificar que no hay credenciales hardcodeadas en el código modificado.

3. Ir a la carpeta del módulo y pushear:
   ```powershell
   cd <carpeta-del-modulo>
   clasp push
   ```

4. Confirmar que el push fue exitoso (clasp muestra los archivos subidos sin errores).

5. Verificar en producción: abrir la landing en el navegador y confirmar que el cambio se ve.

## Si clasp no está instalado

```powershell
npm install -g @google/clasp
clasp login
```

## Si clasp push falla por auth

```powershell
clasp login
```
Abre el navegador, autorizás con tu cuenta @despegar.com.

## Notas

- Cada carpeta tiene su propio `.clasp.json` que apunta al script GAS correspondiente — nunca correr `clasp push` desde la raíz del repo.
- Los cambios en GAS son instantáneos en producción una vez subidos (no hay staging).
- Si el cambio es crítico o rompe algo, el rollback es manual: revertir el archivo localmente y volver a hacer `clasp push`.
