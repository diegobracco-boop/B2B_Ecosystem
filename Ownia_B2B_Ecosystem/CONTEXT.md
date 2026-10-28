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
| `Daily_Dashboard` | `/b2b-ecosystem/daily` | 🔁 en validación (paralelo a GAS). Sin exportar a Slides ni mandar el mail (SlidesApp / MailApp): siguen en GAS. **Solo en Ownia (2026-10-24):** solapa "Industry events tracker" (`public/daily-layout.js`, `layout` en `modules.js`): YoY de los días de evento (sin pre ni post), un evento por vez con selector de evento y país, alineado por día de evento, con B2C de referencia; la lee de `industry_events.json` con `getIndustryEvents` (`server/gas-extras/daily-industry.js`, `gasExtras` en `modules.js`: funciones de servidor propias de Ownia que se cargan en el contexto del módulo, después de su código). En la misma capa, "Benchmark vs B2C" rearmada para Chief / VPs y directores de país (titular calculado, tarjetas con brecha GB/NR/FVM y B2C como tercera tarjeta, tabla por país abierta con mapa de calor y clic para filtrar, barra fija de país y período, brecha mensual por defecto; Globales = Other Countries + USA + Uruguay + Paraguay en los tres negocios, normalizado en `_benchRows_` y el selector de país, 2026-10-25): envuelve `renderBenchmark_` y compañía y reemplaza `renderBenchPaisTable_`; si se cambian esas funciones en `dashboard.html`, revisar la capa. El código GAS del Daily no cambia: el equipo lo sigue publicando con `/clasp-push` sin arrastrar esto |
| `Dashboard_B2B_WLs` (Hub, "P&L Dashboard") | `/b2b-ecosystem/hub` | 🔁 en validación desde 2026-10-23 (paralelo a GAS, solo equipo B2B). **La versión de GAS queda congelada (2026-10-23): las mejoras van solo acá, sin `/clasp-push`.** Capa propia de Ownia en `public/hub-layout.js` (`layout` en `modules.js`): barra fija con Home + Consolidado/B2B/B2B2C (teclas 1/2/3) + pestañas (Operativo ▾ / Herramientas ▾), vista de entrada para dirección (2026-10-25, validada con el panel de clientes CEO/Chief): encabezado "Contable · real cerrado a … · proyección desde …", frase de lectura con los mayores desvíos de GB por grupo y lo que pasa con NR/OC, grilla GB/NR/OC × negocio con el formato de la presentación de dirección (2026-10-25, `deckHtml`: Consolidado = B2B-MIN, B2B-MAY, B2B2C y Total; B2B o B2B2C = total del negocio y sus grupos de países; cada celda con valor en USD $M, YoY y desvío $ y % vs Goal —vs Budget si el Goal es LY—; año a la fecha y cierre FY proyectado vs Budget en la etiqueta de la fila, de `_state.evo`; badge Organic si está activo), benchmark vs B2C en una línea (`_state.compPnl`), waterfall de GB por grupo y evolución; el resto (Cuadro Resumen con OKR, waterfalls de NR/OC, tablas, drill-down) se mueve a "Ver detalle" plegado (`foldDetail`, mueve nodos del Hub), línea de contexto con la barra "Filtrar…" (2026-10-25: se escribe "brasil b2b sep vs fc", muestra lo que entendió y lo que no, Enter aplica todo con una sola recarga; diccionario de sinónimos en `public/filter-aliases.js`, sin mayúsculas ni acentos, reutilizable en otros módulos; `layout` en `modules.js` acepta una lista de archivos que se cargan en orden) y botón Filtros (el panel se abre como cajón desde la derecha con el fondo atenuado; cierra con "Listo", Esc o clic afuera), precarga de los otros LoB y LoB sincronizado con las secciones embebidas de Ownia (P&L Contable, P&L Managerial, Daily, FVM Negativo). En `dashboard.html` (solo Ownia): Δ $ y Δ % en una fila, columna Total resaltada, leyenda de colores y OKR con el detalle de KRs desplegado ("Ocultar KRs" lo pliega al Total). También solo Ownia (2026-10-25): un solo semáforo (`_deltaState_`: verde ≥ 0%, ámbar −5% a 0%, rojo < −5%; antes las tablas tenían un gris 0–1%), un decimal debajo de 10%, Cuadro Resumen de Consolidado con columna B2B = MAY + MIN (`_pnlWithB2B_`, botón para abrirla), MAY/MIN como Mayoristas/Minoristas, y en la evolución los meses posteriores al último real rayados como proyección (antes la serie del baseline los pintaba como reales) con badge del cierre FY. "Slides cierre de mes" (SlidesApp + Slides API) y los triggers (`preComputeAll`, `keepAlive`) siguen en GAS; `getLastSync` da `null` (lo escribe un proceso de GAS en ScriptProperties). Primera carga ~4 s (sin trigger que precaliente el cache). Hasta el 2026-10-23 tardaba 40–70 s y en Ownia se cortaba a los 55 s: `queryMap_` partía con `split` todas las claves del mapa en cada una de sus cientos de llamadas; ahora usa un índice parseado una vez (`queryIndex_`, mismo resultado byte a byte) |
| `FVM_Negativo` | `/b2b-ecosystem/fvm-negativo` | 🔁 en validación desde 2026-10-23 (paralelo a GAS, cualquier @despegar.com como el webapp GAS). Solo lee `fvm_negativo.json` de la carpeta del Daily |
| Resto (One Pager, OKR, Profit Sharing) | — | ⏳ en GAS. La portada linkea a su landing GAS |

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
| HtmlService, ContentService, Session, Utilities (con `unzip`, sin `zip`), CacheService, PropertiesService, LockService, ScriptApp.getService, Logger, **DriveApp (solo lectura, sobre el almacén espejado)**, **SpreadsheetApp (solo lectura, sobre la Sheet exportada a .xlsx por el espejo: `openById`, `getSheetByName`, `getRange`, `getDataRange`, `getValues`, `getLastRow/Column`)**, **XmlService (solo parse/lectura)** | Drive (avanzado), escribir en SpreadsheetApp, **SlidesApp**, MailApp, GmailApp, UrlFetchApp, `Utilities.zip`, `ScriptApp.newTrigger`, Libraries, escribir en DriveApp |

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

- **Doble escritura (2026-10-27)** — `mirror/ownia_publish.py` (`publish_after_drive`): los pipelines que suben a Drive
  (`daily_sync.py`, `recurrencia_sync.py`, `actuals_gestional_upload.py`, `revenue_gd_builder.py`,
  `profit_sharing_sync.py`, `json_builder.py`, `baseline_builder.py`, `okr_builder.py`, `plana_to_cube.py`) mandan en el
  mismo paso el MISMO contenido a `/ingest/files/<id>`, con la fecha de modificación que devolvió Drive (se pide con
  `DRIVE_FIELDS` en el `update()`/`create()`), así que el mirror posterior ve "sin cambios". Drive sigue siendo la
  fuente de verdad (también alimenta a los toqans). Nunca corta el pipeline: si Ownia falla avisa (`WARN Ownia`), no
  insiste con el resto de esa corrida y se repara con `py mirror/ownia_mirror.py`. Solo publica lo que está en el
  manifest (por id o carpeta + nombre). Hace falta `credenciales/.env.ownia` en cada PC que corre pipelines
  (`OWNIA_URL`, `OWNIA_INGEST_TOKEN`); sin eso, o con `OWNIA_PUBLISH=off`, no hace nada. El mirror sigue haciendo falta
  para lo que no genera un pipeline (Sheets, `tc_plana_flat.xlsx`) y como reconciliación.
- `server/drive-manifest.json` — qué ids de Drive (y qué archivos por carpeta + nombre) lee cada módulo. **Al agregar un
  `*_FILE_ID` en el código GAS de un módulo migrado, sumarlo acá** (`test/manifest.test.js` falla si no coincide con
  el código GAS). Es también la allowlist de `/ingest`: un archivo fuera de la lista se rechaza (403) aunque el token
  sea válido.
- **Google Sheets** (`*_SHEET_ID`, clave `sheets` del manifest): el espejo las exporta a `.xlsx` con su mismo id y
  `server/gas-sheets.js` las lee como `SpreadsheetApp` (valores calculados; celdas con formato fecha → `Date` en la zona
  del proyecto). Si Drive no deja exportar la planilla entera (tope de 10 MB, p.ej. la de KR Agencias del Daily), el
  manifest lista solo los `ranges` que lee el módulo y el espejo arma el `.xlsx` con la API de Sheets, cada celda en su
  misma posición. Las Sheets se re-bajan en cada corrida: un valor que cambia por fórmula no mueve su `modifiedTime`.
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
  (`_gestionalJsonCache_`, `_fxCache_`…). Sin la recarga servirían datos viejos. Solo se recargan los módulos que
  leen el archivo que cambió (según `drive-manifest.json`): recargar pierde su caché en memoria, y el mirror sube
  archivos del Daily varias veces por día que el Hub no lee.
- **Respuestas con gzip**: las de `google.script.run` y las páginas de más de 32 KB viajan comprimidas si el
  navegador lo acepta (el Daily manda ~65 MB de JSON → ~11 MB).
- **Todo corre en un solo hilo**: mientras una función GAS calcula, las demás requests esperan. Una función lenta en
  frío frena a todos los módulos (y pasados 55 s se corta con "Script execution timed out"). Al migrar un módulo,
  medir su carga en frío (`npm run dev` + los tiempos `ms` del log) — ver el caso del Hub en "Estado".
- `/ingest/files` (GET lista, PUT sube) se protege con `Authorization: Bearer <INGEST_TOKEN>`. Sin
  `INGEST_TOKEN` configurado la ruta no existe (404).

**Corrida diaria (2026-10-27):** `Daily_Dashboard/auto_update_reales.ps1` (Task Scheduler en la PC de Tiago) corre el
espejo completo después de `daily_sync.py` (paso 1b). No corta la corrida si falla: Apps Script se publica igual y queda un
AVISO en el log. Esa PC necesita `credenciales/.env.ownia` y el login de Drive de `Inputs_Planning_PnL/token_drive.json`;
sin `.env.ownia` el paso se saltea con aviso. Las demás corridas (P&L, `/actualizar`, uploads a mano) siguen necesitando
`py mirror/ownia_mirror.py` a mano.

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
  P&L Accounting; el Daily NO desde el 2026-10-23: lo abre cualquier @despegar.com, igual que su webapp GAS, para
  que el equipo comercial use "OKR Detail") solo los abren las 5 cuentas del equipo B2B (`EQUIPO_B2B`); el resto recibe 403, en la landing y en
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
- **`main` de `despegar/B2B_Ecosystem_APP`**: espejo GENERADO que deploya la app `b2b-ecosystem`, en un repo
  propio desde 2026-10-23. Antes vivía en la rama huérfana `b2b-ecosystem` de `despegar/B2B_Ecosystem_Ownia`, cuyo
  `main` es OTRA app (`b2b-dashboard`, Dashboard B2B API + Tablero Hoteles, de Tomás y Antonella): esa rama quedó
  en desuso y no hay que volver a sincronizar ahí.
- El espejo lo arma `node scripts/sync-to-ownia-repo.js <clon>`: copia la app y, en `gas/<Modulo>/`, los
  `.js/.html/.json` de los módulos migrados (sin `.clasp.json`), más `gas/MANIFEST.json` con el commit de origen y
  `LEEME_ESPEJO.md`. **No editarlo a mano.** Solo copia archivos **versionados** (`git ls-files`), nunca
  `token*`/`credentials*`/`.env*`, exige que lo sincronizado no tenga cambios sin commitear, y aborta si el destino
  no es un clon con origin `despegar/B2B_Ecosystem_APP` **parado en `main`**, o si es (o
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
   git clone https://github.com/despegar/B2B_Ecosystem_APP.git <clon>   # una sola vez
   node scripts/sync-to-ownia-repo.js <clon>
   cd <clon> && git add -A && git commit -m "Sync desde B2B_Ecosystem <sha>" && git push
   ```
4. Redeploy desde el MCP de Ownia (skill `ownia-deploy`): `deploy_app(action="redeploy", app_name="b2b-ecosystem")`
   — la app ya tiene guardados el repo y la rama. Llega un mail cuando termina.

ℹ️ `manage_infra(action="apply")` deploya la rama por defecto del repo, no la guardada en la app. Con el repo
compartido eso publicó el dashboard de API en `/b2b-ecosystem` (2026-10-21); con el repo propio la rama por
defecto (`main`) ya es la correcta.

⚠️ Igual que con clasp: **un `git push` al monorepo no publica nada en Ownia** — hace falta el paso 3 y 4. Y un
cambio en un módulo GAS migrado (p.ej. `Manual_B2B_WLs/manual.html`) necesita **las dos** publicaciones:
`/clasp-push` para GAS y sync + redeploy para Ownia.

## Correr en local

**Versión "dev" para revisar un cambio antes de redeployar** (la forma corta, con datos):

```bash
cd Ownia_B2B_Ecosystem
py mirror/ownia_mirror.py --to-dir _store     # datos de Drive (solo lo que cambió)
npm run dev -- nombre.apellido@despegar.com   # → http://localhost:8098/b2b-ecosystem/
```

`scripts/dev-local.js` levanta la app con el código del repo tal como está en disco (sin commit ni sync) y pone tu
mail como identidad en cada request, escuchando solo en `127.0.0.1`. Para ver un cambio en un `.html`/`.js` de un
módulo, reiniciar el script. Es lo mismo que el bloque de abajo, sin tener que mandar el header a mano.

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


## Flow (módulo `flow`, 2026-10-27)

Entrada propia del menú principal que junta, con la misma regla de fuentes, los dos Flow del ecosistema:
- **Semanal = 100% gestional**: el Flow del Daily (`<base>/daily?flowdeck=1`, `public/daily-flowdeck.js`: abre el Flow sin la navegación del Daily). La portada
  contable "B2B2C — Resumen mensual (OC)" se saca de ese deck (`public/daily-flow-slides.js`); el target de NR API Hoteles ya no cae al contable.
- **Mensual = contable**: las Slides mensuales del Hub (`<base>/hub?slides=1&embedded=1`, `public/hub-slides.js` modo `EMB`: sin barra del Hub). Su slide 4 (portada
  B2B2C) muestra NR y **OC por segmento**: total OC del P&L contable; Hunting y TBD = FVM gestional (Datalake); Farming = OC contable − Hunting − TBD. Sin tabla de FVM.
- `Flow_B2B/flow.html` es el cascarón: pestañas Semanal | Mensual, iframes (mismo origen) que avisan por `postMessage({type:'flow-slide'})` en qué slide están, y un
  cuadro de **comentarios por slide** con botón "Enviar por mail" (`mailto:` a diego.bracco@ y matias.m.sanchez@despegar.com; los borradores quedan en el navegador).
  El mail lo manda el usuario desde su casilla: Ownia no tiene servicio de correo.
- En Ownia se ocultan la pestaña "Slides mensuales" del Hub y la pestaña "Flow Semanal" del Daily (siguen accesibles por esos links).
- **Acceso**: el módulo `flow` está abierto a cualquier @despegar.com, pero el Flow mensual lee los datos del Hub (`allowedUsers: EQUIPO_B2B`): quien no esté en esa lista ve el
  semanal y un aviso en el mensual. Sumar al Chief u otras personas = agregarlos a `allowedUsers` del Hub (o abrirlo a todo el dominio, decisión sobre datos contables).
