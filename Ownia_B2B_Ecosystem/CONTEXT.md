# Ownia_B2B_Ecosystem — el ecosistema B2B en Ownia (migración progresiva)

App Node.js que sirve las landings del ecosistema desde **Ownia** (`https://ownia.despegar.io/b2b-ecosystem`),
**sin reescribir su lógica**: carga los `.js`/`.html` de cada proyecto Apps Script del repo, tal cual, en un contexto
`vm` propio por módulo con los servicios de GAS reemplazados por shims. (`vm` separa los globals de cada módulo,
pero **no es un límite de seguridad**: el código cargado es del repo y se confía en él. Nunca pasarle input del
usuario a `HtmlService.createTemplate(...)` ni a `eval`.) Las agregaciones, reglas y cálculos son literalmente el
mismo código que corre en Apps Script, así los números no pueden divergir por una reescritura.

**Apps Script no se toca.** Las landings GAS siguen siendo las productivas; los pipelines Python, las queries al
Datalake y los JSON de Drive siguen igual. Cada módulo pasa a Ownia recién cuando está validado.

## Estado

| Módulo | Ruta en Ownia | Estado |
|---|---|---|
| `Manual_B2B_WLs` | `/b2b-ecosystem/manual` | ✅ migrado (piloto: estático, sin datos) |
| Resto (Hub, Daily, P&L Accounting/Managerial, One Pager, FVM Negativo, OKR, Profit Sharing) | — | ⏳ en GAS. La portada linkea a su landing GAS |

El registro vive en `server/modules.js` (`ownia: true` = se sirve desde Ownia).

## Cómo funciona

```
navegador ──GET /b2b-ecosystem/<modulo>──▶ doGet(e) del proyecto GAS (vm) ──▶ HTML + shim google.script.run
navegador ──POST /b2b-ecosystem/api/<modulo>/<fn>──▶ <fn>(...args) del proyecto GAS (vm) ──▶ { result }
```

- `server/gas-runtime.js` — carga el proyecto GAS (respeta `.claspignore`), arma el contexto `vm` y expone `doGet` y
  las funciones públicas. Desde `/api` solo se puede llamar a funciones globales **declaradas por el proyecto**
  (allowlist armada al cargar: nunca shims, ni heredadas tipo `constructor`, ni las que terminan en `_`). Cada
  ejecución tiene un tope de 55 s (por debajo del idle timeout del ALB) para que una función colgada no bloquee la app.
- `server/gas-services.js` — shims: `HtmlService` (templates con scriptlets `<? ?>`/`<?= ?>`/`<?!= ?>`),
  `ContentService`, `Session`, `Utilities` (formatDate con patrones Java, blobs, digest, gzip), `CacheService` y
  `PropertiesService` (en memoria), `LockService`, `ScriptApp.getService().getUrl()`, `Logger`/`console` → logs JSON.
- `public/gas-client.js` — reemplaza `google.script.run` (con `withSuccessHandler`/`withFailureHandler`/
  `withUserObject`), `google.script.url` y `google.script.history` en el navegador. Se inyecta en el `<head>`
  antes que cualquier otro script, así el HTML de la landing no cambia.
- **Zona horaria**: el proceso corre con `TZ=America/Argentina/Buenos_Aires` (la de todos los `appsscript.json`).
  En GAS `new Date().getMonth()` usa la zona del proyecto; sin esto, entre las 21 y las 24 hs daría otro mes/día.

### Servicios GAS soportados

| Soportado | Todavía NO (tiran `ServicioNoMigrado`) |
|---|---|
| HtmlService, ContentService, Session, Utilities (salvo zip/unzip), CacheService, PropertiesService, LockService, ScriptApp.getService, Logger | **DriveApp / Drive**, SpreadsheetApp, **SlidesApp**, MailApp, GmailApp, UrlFetchApp, `Utilities.unzip`, `ScriptApp.newTrigger`, Libraries |

Un servicio no soportado **no se simula**: falla con un error explícito, así nunca se sirve un número inventado.
Por eso hoy solo puede migrarse un módulo que no lea datos (el Manual). El siguiente paso es el shim de `DriveApp`.

## Identidad y acceso

En GAS cada landing es `access: DOMAIN` (solo cuentas despegar.com) y `Session.getActiveUser()` da el mail del
usuario. **En Ownia hay Cloudflare Access adelante** (verificado el 2026-10-21 con `/whoami`): sin login corporativo no
se llega a la app, y Cloudflare manda `cf-access-authenticated-user-email` (más el JWT `cf-access-jwt-assertion`).
Probado: un `cf-access-authenticated-user-email` falsificado por el cliente lo pisa Cloudflare, y el dominio interno
del ALB no es alcanzable desde la red de usuarios. Por eso `TRUSTED_IDENTITY_HEADER` =
`cf-access-authenticated-user-email`. **Pendiente antes de migrar módulos con datos sensibles:** verificar además la
firma del JWT `cf-access-jwt-assertion` (certs del team de Cloudflare Access), por si algo llegara al ALB sin pasar
por Cloudflare.

- `GET /b2b-ecosystem/whoami` muestra qué headers de autenticación llegan (nombre + mail, sin tokens).
- `APP_SECRETS.TRUSTED_IDENTITY_HEADER` = header que pone (y siempre pisa) el proxy de adelante. Sin esa config,
  `Session.getActiveUser()` devuelve `''`: un header que el cliente puede mandar a mano nunca se toma como identidad.
  Solo cuentan mails `@despegar.com`. `x-amzn-oidc-data` (JWT del ALB) no se acepta hasta implementar la
  verificación de la firma.
- **Identidad obligatoria por módulo** (`requiresIdentity` en `server/modules.js`, default `true`): sin usuario
  identificado, el módulo responde 401. Se exige acá y no en el código GAS porque varias guardas de GAS dejan pasar
  cuando el usuario activo viene vacío (p.ej. `requireOwner_` del Daily lo toma como un trigger). Solo el Manual
  (estático) lo tiene apagado. **Ningún módulo con datos se migra hasta confirmar el SSO** (P&L, Profit Sharing
  Banco de Chile, etc.).
- `APP_SECRETS.REQUIRE_IDENTITY = "true"` → 401 a TODA la app (portada y Manual incluidos), salvo `/health`.
- **Anti-CSRF en `/api`**: exige `Content-Type: application/json` + `X-Requested-With: google.script.run` (los manda
  `gas-client.js`) y rechaza `Sec-Fetch-Site` distinto de `same-origin`. **Ojo:** todas las apps de Ownia comparten el
  origen `ownia.despegar.io`, así que otra app de la plataforma sí podría llamar a `/b2b-ecosystem/api/*`. Antes de
  migrar módulos con datos sensibles, consultar a Ownia si hay subdominio por app (`<appname>.…`).

## Configuración (APP_SECRETS, vía Ownia)

| Clave | Para qué |
|---|---|
| `TRUSTED_IDENTITY_HEADER` | ver "Identidad" |
| `REQUIRE_IDENTITY` | ver "Identidad" |
| `EFFECTIVE_USER_EMAIL` | lo que devuelve `Session.getEffectiveUser()` (en GAS: quien deployó) |
| `GAS_PROPERTIES` | `{ "<slug>": { "CLAVE": "valor" } }` → Propiedades del script de cada módulo |

`BASE_PATH` y `PORT` los inyecta Ownia. Nada de credenciales en el código.

## Repos: de dónde deploya Ownia

Ownia solo deploya repos de la org GitHub `despegar`, y desde la **raíz** del repo; este monorepo vive en
`diegobracco-boop/B2B_Ecosystem`. Entonces:

- **Fuente de verdad: esta carpeta** del monorepo. Acá se edita y se testea.
- **Rama `b2b-ecosystem` de `despegar/B2B_Ecosystem_Ownia`**: espejo GENERADO que deploya la app `b2b-ecosystem`.
  Es una rama **huérfana** (sin historia común con `main`). **`main` de ese repo es OTRA app**, `b2b-dashboard`
  (Dashboard B2B API + Tablero Hoteles, de Tomás y Antonella), que Ownia tiene que seguir detectando como HTML
  estático: nunca mergear esta rama a `main` ni poner nuestro `Dockerfile`/`package.json` ahí.
- El espejo lo arma `node scripts/sync-to-ownia-repo.js <clon>`: copia la app y, en `gas/<Modulo>/`, los
  `.js/.html/.json` de los módulos migrados (sin `.clasp.json`), más `gas/MANIFEST.json` con el commit de origen y
  `LEEME_ESPEJO.md`. **No editarlo a mano.** Solo copia archivos **versionados** (`git ls-files`), nunca
  `token*`/`credentials*`/`.env*`, exige que lo sincronizado no tenga cambios sin commitear, y aborta si el destino
  no es un clon con origin `despegar/B2B_Ecosystem_Ownia` **parado en la rama `b2b-ecosystem`**, o si es (o
  contiene, o está dentro de) el monorepo.
- (`despegar/ownia-b2b-ecosystem`, el primer espejo del 2026-10-21, quedó en desuso: lo puede archivar un admin de
  Ownia.)

En el monorepo la app lee los proyectos GAS de las carpetas hermanas (`../<Modulo>/`); en el espejo, de `gas/`.

## Flujo para publicar un cambio

1. Editar acá (o el módulo GAS que corresponda) → `npm test` (incluye smoke test de cada módulo migrado).
2. Commit + push al monorepo.
3. Sincronizar el espejo:
   ```bash
   git clone -b b2b-ecosystem https://github.com/despegar/B2B_Ecosystem_Ownia.git <clon>   # una sola vez
   node scripts/sync-to-ownia-repo.js <clon>
   cd <clon> && git add -A && git commit -m "Sync desde B2B_Ecosystem <sha>" && git push
   ```
4. Redeploy desde el MCP de Ownia (skill `ownia-deploy`): `deploy_app(action="redeploy", app_name="b2b-ecosystem")`
   — la app ya tiene guardados el repo y la rama. Llega un mail cuando termina.

⚠️ Igual que con clasp: **un `git push` al monorepo no publica nada en Ownia** — hace falta el paso 3 y 4. Y un
cambio en un módulo GAS migrado (p.ej. `Manual_B2B_WLs/manual.html`) necesita **las dos** publicaciones:
`/clasp-push` para GAS y sync + redeploy para Ownia.

## Correr en local

```bash
cd Ownia_B2B_Ecosystem
npm test
BASE_PATH=/b2b-ecosystem PORT=8099 node server/index.js   # → http://localhost:8099/b2b-ecosystem/
```

En Git Bash, anteponer `MSYS_NO_PATHCONV=1` (si no, convierte `/b2b-ecosystem` en una ruta de Windows).

## Limitaciones conocidas

- `CacheService`/`PropertiesService` viven en memoria de cada instancia: se pierden en un redeploy y no se comparten
  entre instancias. Sirve para caches; no para estado que haya que persistir.
- `LockService` no bloquea entre instancias (dentro de una instancia las llamadas son secuenciales).
- Los triggers de GAS (`preComputeAll`, `keepAlive`, mail diario) **no** corren acá: siguen en Apps Script.
- `google.script.run` serializa con JSON: un `Date` devuelto llega como string ISO (en GAS, las fechas de retorno no
  están permitidas igual).
