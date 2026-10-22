# Ownia_B2B_Ecosystem — el ecosistema B2B en Ownia (migración progresiva)

App Node.js que sirve las landings del ecosistema desde **Ownia** (`https://ownia.despegar.io/b2b-ecosystem`),
**sin reescribir su lógica**: carga los `.js`/`.html` de cada proyecto Apps Script del repo, tal cual, en un contexto
`vm` propio por módulo con los servicios de GAS reemplazados por shims. (`vm` separa los globals de cada módulo,
pero **no es un límite de seguridad**: el código cargado es del repo y se confía en él. Nunca pasarle input del
usuario a `HtmlService.createTemplate(...)` ni a `eval`.) Las agregaciones, reglas y cálculos son literalmente el
mismo código que corre en Apps Script, así los números no pueden divergir por una reescritura.

**Apps Script no se toca.** Las landings GAS siguen siendo las productivas; los pipelines Python, las queries al
Datalake y los JSON de Drive siguen igual. Los módulos con datos se **duplican** en Ownia y corren en paralelo
("en validación"), leyendo una copia espejada de los mismos archivos de Drive. Apps Script se apaga recién cuando
se valida que Ownia da lo mismo (decisión del equipo, módulo por módulo).

## Estado

| Módulo | Ruta en Ownia | Estado |
|---|---|---|
| `Manual_B2B_WLs` | `/b2b-ecosystem/manual` | ✅ migrado (piloto: estático, sin datos) |
| `P&L_Managerial` | `/b2b-ecosystem/pnl-managerial` | 🔁 en validación (paralelo a GAS, datos espejados) |
| `P&L_Accounting` | `/b2b-ecosystem/pnl-accounting` | 🔁 en validación (paralelo a GAS, datos espejados) |
| `Dashboard_B2B_WLs` (Hub) | — | ⏳ próximo. Bloqueo: el deck de cierre usa SlidesApp + triggers (no portable sin reescribir) |
| Resto (Daily, One Pager, FVM Negativo, OKR, Profit Sharing) | — | ⏳ en GAS. La portada linkea a su landing GAS |

El registro vive en `server/modules.js` (`ownia: true` = se sirve desde Ownia; `validating: true` = en paralelo a
GAS, la portada muestra los dos links).

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
- `public/ownia-nav.js` — navegación en Ownia, inyectada después del shim: el link al Hub GAS del header pasa a
  "🏠 Home" (menú de Ownia, misma pestaña), los links a módulos ya migrados van a su versión de Ownia, la portada
  propia del módulo (`#home-overlay` + "⌂ Inicio") se oculta y se entra directo a `startView` (modules.js); en el
  Manual (sin header) agrega "🏠 Home" arriba del sidebar. GAS no cambia.
- **Zona horaria**: el proceso corre con `TZ=America/Argentina/Buenos_Aires` (la de todos los `appsscript.json`).
  En GAS `new Date().getMonth()` usa la zona del proyecto; sin esto, entre las 21 y las 24 hs daría otro mes/día.

### Servicios GAS soportados

| Soportado | Todavía NO (tiran `ServicioNoMigrado`) |
|---|---|
| HtmlService, ContentService, Session, Utilities (con `unzip`, sin `zip`), CacheService, PropertiesService, LockService, ScriptApp.getService, Logger, **DriveApp (solo lectura, sobre el almacén espejado)**, **XmlService (solo parse/lectura)** | Drive (avanzado), SpreadsheetApp, **SlidesApp**, MailApp, GmailApp, UrlFetchApp, `Utilities.zip`, `ScriptApp.newTrigger`, Libraries, escribir en DriveApp |

Un servicio no soportado **no se simula**: falla con un error explícito, así nunca se sirve un número inventado.
Un `getFileById` de un id que el espejo no tiene da el mismo error que GAS ("No item with the given ID could be
found…"): si aparece, falta ese id en `server/drive-manifest.json` (`test/manifest.test.js` lo detecta antes).

## Datos: espejo de Drive

Los módulos leen los mismos archivos de Drive que en GAS, por el mismo id. En Ownia esos archivos viven en una
copia espejada:

```
pipelines (sin cambios) ──▶ Drive ──▶ mirror/ownia_mirror.py ──PUT /ingest/files/<id>──▶ almacén (DynamoDB)
                                                                                          │ (memoria de cada instancia)
                                                     landing en Ownia ──DriveApp.getFileById(id)──┘
```

- `server/drive-manifest.json` — qué ids de Drive (y qué archivos por carpeta + nombre) lee cada módulo. **Al agregar un
  `*_FILE_ID` en el código GAS de un módulo migrado, sumarlo acá** (`test/manifest.test.js` falla si no coincide con
  el código GAS). Es también la allowlist de `/ingest`: un archivo fuera de la lista se rechaza (403) aunque el token
  sea válido.
- `mirror/ownia_mirror.py` — baja de Drive (mismo login que los uploaders del P&L, `Inputs_Planning_PnL/token_drive.json`)
  y sube a Ownia solo lo que cambió (compara la fecha de modificación; verifica el md5 de Drive, así contenido y fecha
  son de la misma versión). Guarda id, nombre, carpeta y **la fecha de
  modificación de Drive**: las claves de caché de los módulos (`getLastUpdated()`) dan igual que en GAS.
  Config en `credenciales/.env.ownia`: `OWNIA_URL`, `OWNIA_INGEST_TOKEN` (= `APP_SECRETS.INGEST_TOKEN`).
  Desde una PC del equipo el script pasa Cloudflare Access con la identidad del usuario (verificado 2026-10-21), no
  hace falta service token. `--to-dir <carpeta>` escribe a una carpeta para correr la app en local.
- `server/file-store.js` — el almacén. En Ownia, DynamoDB (`DynamoBackend`, tabla de `APP_SECRETS.DYNAMODB_TABLE`, la
  inyecta Ownia; permisos por el rol de la tarea), con el mismo patrón que `runrate-html` (`RR_AI/HTML-RR/backend/
  reales_store.py`): contenido gzip en pedazos de 350 KB (`pk=mirror_blob#<id>#<sha256>`) y un puntero por archivo
  (`pk=mirror`, `sk=file#<id>`) que se escribe al final — cambiar el puntero es el "commit", nadie lee un archivo a
  medio subir. En local, una carpeta (`FILE_STORE_DIR`). El código GAS es sincrónico, así que lee de una copia en memoria: cada instancia recarga del
  backend al arrancar y cada `FILE_STORE_POLL_MS` (60 s). La recarga es atómica: si falla una lectura no se aplica
  nada y se reintenta en el próximo poll. `/health` informa `data.files`, `lastRefresh` y `error` del almacén.
- **Cuando llega una versión nueva de un archivo se recargan los módulos**: en GAS cada ejecución arranca con los
  globales limpios, acá el contexto vive entre requests y varios módulos memorizan el JSON en un global
  (`_gestionalJsonCache_`, `_fxCache_`…). Sin la recarga servirían datos viejos.
- `/ingest/files` (GET lista, PUT sube) se protege con `Authorization: Bearer <INGEST_TOKEN>`. Sin
  `INGEST_TOKEN` configurado la ruta no existe (404).

**Pendiente:** hoy el espejo se corre a mano (`py mirror/ownia_mirror.py`) después de los pipelines. Para el paralelo
diario hay que engancharlo al final de las corridas automáticas (ver CONTEXT-MAP, scheduler del Daily).

## Identidad y acceso

En GAS cada landing es `access: DOMAIN` (solo cuentas despegar.com) y `Session.getActiveUser()` da el mail del
usuario. **En Ownia hay Cloudflare Access adelante** (verificado el 2026-10-21 con `/whoami`): sin login corporativo no
se llega a la app, y Cloudflare manda `cf-access-authenticated-user-email` (más el JWT `cf-access-jwt-assertion`).
Probado: un `cf-access-authenticated-user-email` falsificado por el cliente lo pisa Cloudflare, y el dominio interno
del ALB no es alcanzable desde la red de usuarios. Por eso `TRUSTED_IDENTITY_HEADER` =
`cf-access-authenticated-user-email`. **Pendiente (recomendado):** verificar además la firma del JWT
`cf-access-jwt-assertion` (certs del team de Cloudflare Access), por si algo llegara al ALB sin pasar por Cloudflare.

- `GET /b2b-ecosystem/whoami` muestra qué headers de autenticación llegan (nombre + mail, sin tokens).
- `APP_SECRETS.TRUSTED_IDENTITY_HEADER` = header que pone (y siempre pisa) el proxy de adelante. Sin esa config,
  `Session.getActiveUser()` devuelve `''`: un header que el cliente puede mandar a mano nunca se toma como identidad.
  Solo cuentan mails `@despegar.com`. `x-amzn-oidc-data` (JWT del ALB) no se acepta hasta implementar la
  verificación de la firma.
- **Identidad obligatoria por módulo** (`requiresIdentity` en `server/modules.js`, default `true`): sin usuario
  identificado, el módulo responde 401. Se exige acá y no en el código GAS porque varias guardas de GAS dejan pasar
  cuando el usuario activo viene vacío (p.ej. `requireOwner_` del Daily lo toma como un trigger). Solo el Manual
  (estático) lo tiene apagado. SSO confirmado el 2026-10-21 (Cloudflare Access).
- **Lista cerrada de usuarios** (`allowedUsers` en `server/modules.js`): los módulos en validación (P&L Managerial y
  P&L Accounting) solo los abren las 5 cuentas del equipo B2B (`EQUIPO_B2B`); el resto recibe 403, en la landing y en
  `/api`. Decisión del equipo (2026-10-21) mientras corren en paralelo a GAS.
- `APP_SECRETS.REQUIRE_IDENTITY = "true"` → 401 a TODA la app (portada y Manual incluidos), salvo `/health`.
- **Anti-CSRF en `/api`**: exige `Content-Type: application/json` + `X-Requested-With: google.script.run` (los manda
  `gas-client.js`) y rechaza `Sec-Fetch-Site` distinto de `same-origin`. **Ojo:** todas las apps de Ownia comparten el
  origen `ownia.despegar.io`, así que otra app de la plataforma sí podría llamar a `/b2b-ecosystem/api/*` con la sesión
  de un usuario. **Aceptado por el equipo (2026-10-21):** todas las apps de Ownia comparten ese dominio; la exposición
  se acota con la lista cerrada de usuarios de arriba.

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

(Los módulos en validación además necesitan datos: después del redeploy, `py mirror/ownia_mirror.py`.)

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

⚠️ **`manage_infra(action="apply")` deploya la rama por defecto del repo (`main` = `b2b-dashboard`), no la guardada
en la app.** Pasó el 2026-10-21 al agregar DynamoDB: `/b2b-ecosystem` quedó sirviendo el dashboard de API. Después
de cualquier `apply`, redeployar con `deploy_app(action="redeploy", branch="b2b-ecosystem")`.

⚠️ Igual que con clasp: **un `git push` al monorepo no publica nada en Ownia** — hace falta el paso 3 y 4. Y un
cambio en un módulo GAS migrado (p.ej. `Manual_B2B_WLs/manual.html`) necesita **las dos** publicaciones:
`/clasp-push` para GAS y sync + redeploy para Ownia.

## Correr en local

```bash
cd Ownia_B2B_Ecosystem
npm install                                   # SDK de DynamoDB (solo lo usa el backend de producción)
npm test
BASE_PATH=/b2b-ecosystem PORT=8099 node server/index.js   # → http://localhost:8099/b2b-ecosystem/
```

Con datos (módulos en validación): espejar a una carpeta y levantar con esa carpeta + un header de identidad de
prueba (en local no hay Cloudflare adelante):

```bash
py mirror/ownia_mirror.py --to-dir _store               # baja de Drive solo lo que cambió (gitignoreado)
FILE_STORE_DIR=_store TRUSTED_IDENTITY_HEADER=x-test-email BASE_PATH=/b2b-ecosystem PORT=8099 node server/index.js
# y en el navegador, una extensión que mande x-test-email: <tu mail>@despegar.com
```

En Git Bash, anteponer `MSYS_NO_PATHCONV=1` (si no, convierte `/b2b-ecosystem` en una ruta de Windows).

## Limitaciones conocidas

- `CacheService`/`PropertiesService` viven en memoria de cada instancia: se pierden en un redeploy y no se comparten
  entre instancias. Sirve para caches; no para estado que haya que persistir.
- `LockService` no bloquea entre instancias (dentro de una instancia las llamadas son secuenciales).
- Los triggers de GAS (`preComputeAll`, `keepAlive`, mail diario) **no** corren acá: siguen en Apps Script.
- El almacén guarda cada archivo en memoria en cada instancia (hoy ~150 MB con Managerial + Accounting). Al sumar el
  Hub y el Daily, revisar la memoria de la tarea en Ownia.
- `google.script.run` serializa con JSON: un `Date` devuelto llega como string ISO (en GAS, las fechas de retorno no
  están permitidas igual).
