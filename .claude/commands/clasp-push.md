# /clasp-push — Deployar una landing GAS a producción

Sube el código fuente local al proyecto de Google Apps Script correspondiente.
**Importante:** `git push` y `clasp push` son independientes. Un `git push` nunca toca las landings en vivo — hay que correr este comando explícitamente para publicar cambios.

**Más importante todavía:** `clasp push` por sí solo **NO actualiza lo que ve el negocio**. Solo sube el código al deployment `@HEAD` (la versión `/dev`, para probar). La URL `/exec` que usa el equipo queda **congelada** en la versión del último `clasp deploy -i <deploymentId>` hasta que se vuelva a correr ese comando explícitamente. Saltearse este paso es el error de proceso más común y más caro del repo — deja pensando que se publicó cuando en realidad no cambió nada para el usuario final.

## Módulos disponibles y sus deploymentId de producción

| Landing | Carpeta | Qué hace | `deploymentId` de producción (`/exec` en vivo) |
|---|---|---|---|
| Dashboard B2B WLs (Ecosystem Hub) | `Dashboard_B2B_WLs/` | Seguimiento comercial B2B y White Labels | `AKfycbz52txFQy-5YM2Nil_KxULzPoeZpKyA4z5LUWMGoP_8IilcwSduuwZqPF8ut_LmtceM` |
| P&L Accounting | `P&L_Accounting/` | Vista contable del P&L | `AKfycby9WZK2HfAWx25M5pEMV3nntzJfEvsiT9feMn01zJQkQaI3t2GjTzOIjbFXWexnMuzklQ` |
| P&L Managerial | `P&L_Managerial/` | Vista gerencial del P&L | `AKfycbxHyP4uIh02zTQbQ7ZFbyByCVIYuREuiMJ74PnKhQbNGbWknCG2jxOtt_onafQcg5g4` |
| Manual B2B WLs | `Manual_B2B_WLs/` | Manual técnico del ecosistema (landing de solo lectura) | `AKfycbwq2nohZ-c3w-OqvO1H_op4yATn6yDN4qRO9mI8gs1VkO9Jn9lCcQeTsNAceCpydJiHzg` |
| Daily Dashboard | `Daily_Dashboard/` | Dashboard operativo diario | `AKfycbwMR3zk1r4uwui8vGtcmz0OwmeehC5JM8cuJRE3H-GQMfvxXWGTkYQ3R2nVjMyeAdX_1A` |

Estos IDs se confirmaron corriendo `clasp deployments` en cada carpeta (2026-09-04) — son la fuente de verdad, no un valor copiado de otro doc. Si cambia (alguien crea un deployment nuevo en vez de redeployar el existente con `-i`), correr `clasp deployments` de nuevo en esa carpeta y actualizar esta tabla.

## Pasos

1. Asegurarse de que los cambios están commiteados en git:
   ```powershell
   git status   # no debe haber cambios sin commitear
   ```

2. Verificar que no hay credenciales hardcodeadas en el código modificado.

3. Ir a la carpeta del módulo y pushear a `@HEAD`/dev:
   ```powershell
   cd <carpeta-del-modulo>
   clasp push
   ```
   `Daily_Dashboard` y `Dashboard_B2B_WLs` suelen necesitar `clasp push --force` (archivos fuera del `rootDir` de clasp).

4. Confirmar que el push fue exitoso (clasp muestra los archivos subidos sin errores).

5. **Redeployar a producción** (el paso que NO es opcional) — usar el `deploymentId` de la tabla de arriba:
   ```powershell
   clasp deploy -i <deploymentId> -d "descripción corta del cambio"
   ```

6. Verificar en producción: abrir la URL `/exec` de la landing (no la de `/dev`) y confirmar que el cambio se ve.

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
- `clasp push` actualiza @HEAD (dev) al instante; el deployment publicado (`/exec`, lo que ve el negocio) queda **congelado** hasta el `clasp deploy -i` del paso 5. No hay staging automático — pero tampoco hay publicación automática.
- Si el cambio es crítico o rompe algo, el rollback es: revertir el archivo localmente, `clasp push`, y `clasp deploy -i <deploymentId>` de nuevo con la versión revertida.
