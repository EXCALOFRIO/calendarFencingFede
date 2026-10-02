# Calendario de Esgrima

Calendario, inscripciones y convocatorias de esgrima en un solo sitio.

Hoy, un tirador español (o su padre o madre) tiene que mirar en cuatro sitios
distintos para saber a qué compite: el calendario de la RFEE en Skermo, los
eventos de la FIE, el circuito europeo y el calendario de su federación
autonómica. Encima, las convocatorias del seleccionador se publican como
circulares en PDF sueltas y las inscripciones pasan por la clave de club en
Skermo. El resultado son dudas constantes, plazos que se escapan y recargos.

Esta aplicación agrega todo eso, lo filtra por **tu arma, tu género y tu
categoría**, y añade el flujo interno completo: solicitud del tirador,
validación del club, aprobación federativa, convocatorias con confirmación de
asistencia y ranking calculado por el sistema en lugar de a mano.

---

## Lo que hace y lo que no

**Sí:**

- Unifica los calendarios públicos (RFEE/Skermo, FIE, circuito europeo,
  autonómicas) en una sola vista filtrada.
- Todo el flujo interno: solicitud → validación del club → lista limpia y
  validada para la RFEE.
- Convocatorias, confirmaciones, ranking interno y avisos de plazo por correo.
- Exporta la lista final en CSV listo para que secretaría lo cargue.
- Feeds iCal suscribibles para Google Calendar y el iPhone.

**No:**

- **No inventa importes de recargo ni cortes de ranking.** Esos valores no
  existen en ninguna fuente consultable: viven dentro de circulares en PDF. Van
  en tablas de configuración editables, con su documento de origen y su fecha,
  y mientras estén vacías la aplicación muestra "no publicado".
- **No muestra poules, pista ni cuadro en vivo.** Se comprobó: ni Engarde ni
  Fencing Time Live publican eso sin JavaScript, ni tienen un índice que
  permita saber qué torneo es cuál. Lo que sí hay son los horarios oficiales
  (apertura, llamada, scratch, inicio) y un enlace directo a la plataforma del
  torneo.

---

## Explorar: deportistas, ediciones y favoritos

Además del calendario, la aplicación tiene una parte de consulta deportiva
(`/explorar`): búsqueda de deportistas con ficha y temporada, ediciones y
series de torneos con sus resultados, cara a cara entre dos deportistas
(solo asaltos individuales; equipos, relevos, BYE y posiciones no generan
victorias) y una lista privada de favoritos. Los favoritos no son alertas: no
envían avisos ni piden permisos del navegador.

- **Todo dato de estas pantallas exige sesión.** Cada página, cada acción de
  servidor y el diseño común redirigen o deniegan sin sesión **antes** de leer
  datos. Las excepciones existentes son `/entrar`, los recursos estáticos, los
  feeds iCal (`/api/calendario/<token>`, con su propio token revocable).
  `/api/archivos/*`, que sirve los PDF (también borradores) y snapshots
  guardados en R2, **no es una excepción**: su handler comprueba
  `getSessionProfile` antes de leer el cubo, deniega con `401` sin sesión o con
  la cuenta revocada sin tocar R2 y responde siempre `Cache-Control: private,
  no-store`. No hay permisos por destinatario, solo sesión vigente. La guarda
  no recupera copias que se hubieran cacheado o descargado antes ni cubre un
  dominio externo en `R2_PUBLIC_BASE_URL`; no se purgó caché ni se borraron
  ficheros. La versión `3fb282b6` (primera publicación) es anterior a esta
  guarda; la versión `b0da2841-1b10-4ba7-8d7b-ee9401fbbd7b`, publicada después,
  la incluye. Volver a `3fb282b6` reabriría esa ruta. Tras publicar solo se
  comprobó, sin sesión y con una clave inexistente, que responde `401` con
  `private, no-store`; no se pidió ningún documento real.
- Los datos salen de las tablas `sport_*`, que **no son un corpus completo**:
  solo hay lo que se ha importado de forma acotada (ver «Estado real de los
  datos históricos»). Una prueba sin resultados importados se muestra como «sin
  datos», nunca como «no hay resultados».
- Una persona deportiva no es una cuenta. Un ID externo (FIE, RFEE) tiene
  ámbito y vigencia, y los homónimos no se fusionan por nombre. El
  `athlete_id` antiguo de una inscripción no basta como prueba de identidad.
- El ranking interno y su cálculo solo se ven con el rol y el arma
  autorizados; la tabla oficial se ve igual para todos los roles.

---

## Puesta en marcha

Entorno de referencia: Windows con PowerShell 7 y Node 22. Usa los shims
`npm.cmd` y `npx.cmd` si `npx` a secas falla.

```powershell
npm.cmd ci
Copy-Item .env.example .env     # y rellena las variables (ver más abajo)
npm.cmd run dev
```

**La `DATABASE_URL` de un `.env` real apunta a la base existente, no a una
rama de pruebas.** Para una base **nueva y vacía**, `npm run db:migrate` crea las
tablas y `npm run db:seed` carga la temporada y la normativa (no datos de
ejemplo). Contra la base ya existente **no** ejecutes `db:push`, `db:seed`,
`demo`, `demo:borrar`, `e2e:limpiar` ni `ingest` masivo, y no uses el migrador
general: las migraciones deportivas tienen su propio comando acotado (ver
«Migraciones deportivas»).

### Variables de entorno

| Variable | Para qué | ¿Obligatoria? |
|---|---|---|
| `DATABASE_URL` | Neon Postgres (cadena *pooled*) | Sí |
| `NEON_AUTH_URL` | Base de Neon Auth | Sí |
| `NEON_AUTH_COOKIE_SECRET` | Firma de la cookie de sesión | Sí |
| `RESEND_API_KEY`, `EMAIL_FROM` | Avisos por correo | No (sin ella no se envía nada, pero la app funciona) |
| `CRON_SECRET` | Protege los endpoints de cron | Sí en producción |
| `NEXT_PUBLIC_APP_URL` | Origen absoluto de la aplicación (feed iCal, correos). Se fija **al compilar** | Sí al compilar para publicar |
| `BLOB_READ_WRITE_TOKEN` *o* `AWS_*` | PDFs y snapshots | No (sin ella no se guardan snapshots) |
| `AI_*` | Extracción de dossieres (fase opcional) | No |
| `SKERMO_SUBMIT_*` | Envío directo a Skermo (fase opcional) | No |
| `CLOUDFLARE_API_TOKEN` | Solo desarrollo local; **nunca** viaja dentro del paquete ni se usa para publicar (se publica con el inicio de sesión OAuth de Wrangler) | No |

Nunca pegues valores de `.env` en tickets, logs ni informes: comprueba solo si
una variable existe.

El diseño busca caber en planes baratos: Neon (el tamaño facturado y el plan
de esta base **no están verificados**), Resend Free y Cloudflare Workers.
Los crons (nueve) exigen Workers de pago: el plan gratuito corta en cinco.

---

## Cómo se alimentan los datos

**Regla de oro: el usuario nunca dispara un scrape.** El scraper escribe en
Neon y la aplicación solo lee de Neon. Da igual que haya 5 usuarios o 5.000: la
carga sobre Skermo y la FIE es de **una petición al día por fuente**.

| Fuente | Cómo se lee | Estado comprobado el 25/09/2026 |
|---|---|---|
| **Skermo RFEE** | HTML renderizado en servidor, `cheerio` | 425 competiciones en una sola petición |
| **Skermo autonómicas** | Igual, 11 federaciones | Códigos verificados uno a uno |
| **FIE** | **API JSON pública** en `fie.org/api/fie` | Sin autenticación; no hace falta scraping |
| **esgrima.es** | **API REST de WordPress** | 278 circulares indexadas |
| **EFC** | — | **El dominio `eurofencing.info` está caído** (expiró el 06/08/2026). El circuito europeo entra igualmente por Skermo, porque la RFEE lo republica |

Detalles que costaron encontrarse y que conviene no perder:

- El calendario de Skermo necesita **`showExt=1`**. Sin ese parámetro devuelve
  36 competiciones; con él, 425. Hay un test que falla si alguien lo quita.
- No existe URL de detalle por competición en Skermo: todo viaja en modales
  ocultos dentro de la misma página, y se lee **por etiqueta, nunca por
  posición**, porque las columnas cambian entre federaciones y hay dos celdas
  que solo se ven en móvil.
- El huso horario que publica la FIE **no es de fiar** (para Samsun devuelve
  `Asia/Riyadh`). Se usa el derivado del país.
- Skermo **no publica cuotas, recargos ni plazos escalonados**. Solo una fecha,
  "Fin inscripciones". Se comprobó enumerando todas las etiquetas del DOM.

### Calidad del dato

- **Cero datos de ejemplo en producción.** No hay seed de demostración. Una
  pantalla sin datos se ve vacía con su explicación.
- **Si un dato no viene de la fuente, no se inventa**: se muestra "no
  publicado".
- **Validación con Zod en el borde del scraper.** Lo que no valida no entra: va
  a la tabla de cuarentena y sale en el panel de admin. (En la primera carga
  real esto ya cazó un evento de la FIE con la fecha de fin anterior a la de
  inicio.)
- **Trazabilidad en cada ficha**: de qué fuente sale, cuándo se leyó y enlace
  al original.
- **Un plazo publicado y uno estimado nunca se presentan igual.** El estimado
  lleva borde discontinuo y la palabra "estimado".
- **Si una fuente falla dos días seguidos**, correo al admin; y si los datos
  tienen más de 48 horas, aviso en la propia interfaz.

---

## Estructura

```
src/
  app/
    (app)/            Pantallas con sesión: Mi estado, Calendario, Convocatorias,
                      Ranking, Explorar (deportistas, ediciones, favoritos),
                      Perfil, Documentos, Mi club, Administración
    entrar/           Acceso con código de un solo uso
    api/              Cron, feeds iCal, autenticación
  components/         Interfaz. primitives.tsx son las piezas base
  db/schema/          Modelo de datos (Drizzle)
  lib/
    ingest/           Scrapers, normalización, validación y upsert
    entries/          Máquina de estados de las inscripciones
    ranking/          Cálculo del ranking interno
    sport/            Persona deportiva, IDs externos, Explorar y favoritos
    db/               Migración aditiva acotada (migracion-aditiva.ts)
    ai/               Extracción de dossieres (opcional)
    skermo/           Envío directo a Skermo (opcional)
tests/
  fixtures/           HTML real comprimido de las fuentes
```

### Decisiones de arquitectura

- **Drizzle + `@neondatabase/serverless`**: consultas por HTTP, sin pool de
  conexiones que agotar en serverless. Como cada consulta es un viaje de red,
  la ingestión precarga en dos consultas y compara en memoria: eso bajó una
  carga completa de 116 s a 26 s, que es la diferencia entre caber o no en el
  límite de 300 s de Vercel.
- **Neon Auth** (Better Auth gestionado). Los usuarios viven en el esquema
  `neon_auth` de la propia base, no en un tercero. `user_profile.auth_user_id`
  apunta a ese id **sin clave ajena**, a propósito: ese esquema lo migra Neon y
  encadenar nuestras migraciones a las suyas es pedir una rotura.
- **Neon en AWS Frankfurt.** La región `fra1` de `vercel.json` es de la
  plataforma anterior; el Worker de Cloudflare no la usa.

---

## Datos históricos y backfill

El backfill (`npm run backfill`) importa de forma **acotada y reanudable**
resultados históricos de FIE, Skermo/RFEE (HTML y PDF) y, como complemento,
Engarde y Fencing Worldwide. Su manual completo, con límites, códigos de salida
y estados, está en [`docs/backfill-historico.md`](docs/backfill-historico.md).

```powershell
npm.cmd run backfill                      # simulación: solo SELECT, sin red, sin escribir
npm.cmd run backfill -- --aplicar         # un lote acotado; lo decide una persona
```

Nada lo lanza solo: no hay cron ni trigger de backfill. No existe un modo «todo
el corpus» (topes de 200 tareas, 2000 peticiones, 30 minutos y 50 relecturas) y
no se lanzan dos `--aplicar` solapados sobre la misma clave. Los argumentos con
`|` (por ejemplo `'fie|2024|246'`) se pasan con
`node node_modules/tsx/dist/cli.mjs scripts/<script>.ts '<argumento>'`: los
shims `.cmd` pueden tragarse el pipe.

### Estado real de los datos históricos (02/10/2026)

- **No hay corpus histórico completo.** Solo se cargó un piloto real acotado
  en tablas `sport_*`: dos pruebas FIE de París 2024 (individual y equipos,
  una sola edición), una de Bogotá 2027, **un** PDF de la RFEE (2018-2019,
  cobertura parcial) y **un** ranking oficial FIE 2024 (903 entradas).
  Cobertura de cada fuente, temporadas pendientes y fuentes no consultadas
  siguen sin importar. «Fuente no publicada», «índice pendiente», «error» y
  «conjunto vacío publicado» son estados distintos y no se mezclan.
- Las personas de esas lecturas no se enlazan por nombre: el PDF y el ranking
  quedaron con 0 puestos/entradas ligados a persona. Es identidad conservadora,
  no un fallo.
- **Primera relectura FIE tras la migración 0018.** La 0018 añade referencias de
  inscripción y cambia la huella de cada lista de inscritos FIE: la primera
  lectura elegible fuerza una reescritura de esa lista, acotada a 60 por
  pasada, con guarda de capacidad y cadencia. No hay hidratación exhaustiva
  inmediata ni lote ilimitado; las inscripciones antiguas sin referencia se
  informan aparte.
- El pilotaje de IA sobre PDF (máximo 10 PDF y 1 € aprobados) **no se ejecutó**:
  hay limitador y estimador, pero ningún PDF se envió a un modelo y no existe
  consumo observado. No está verificado ni el acceso a inferencia, ni el
  tratamiento de datos de menores, ni la cuota de la cuenta; mientras tanto no
  se gasta nada.
- Medidas de tamaño del piloto: base completa 29,35 → 30,17 MiB y esquema
  `public` 18,64 → 19,46 MiB (+0,82 MiB). Son medidas lógicas distintas entre sí
  y de la lectura histórica de 27,71 MiB: no son consumo facturado ni prueban
  un plan.
- La contabilidad de peticiones del piloto no es exhaustiva: hay 21 peticiones
  HTTP conocidas más una invocación mal entrecomillada cuyo número de
  peticiones se desconoce. No se afirma que se cumplieran los límites de
  40 peticiones/300 s para todo el conjunto.

---

## Migraciones deportivas y recuperación

Las migraciones 0017 → 0018 → 0019 (13 tablas `sport_*`, referencias de
inscripción, categorías M10/M12) **ya están aplicadas** en Neon (PostgreSQL
18.0.6), con sus tres filas de ledger, en una sola transacción. El ledger pasó
de 16 a 19 filas. **No se reaplican.**

```powershell
node node_modules/tsx/dist/cli.mjs scripts/aplicar-migraciones-deportivas.ts   # preflight de solo lectura
```

Ese preflight sale con código 2 desde que las migraciones existen; es el
resultado esperado y no un fallo. Hay un test sobre su lógica
(`tests/migracion-aditiva.test.ts`).

**Recuperación, con sus límites:**

- Antes del commit de una migración aditiva, la transacción se revierte entera,
  ledger incluido.
- **Después del commit solo se revierte el código** (publicar la versión
  anterior del Worker). Las tablas, los enums, los datos y el ledger se quedan
  como están. No hay SQL de bajada automático (`down` borraría datos deportivos
  y no está autorizado) ni se borran enums.
- **No hay copia de seguridad ni punto de restauración de Neon acreditados.**
  Volver a una versión anterior del Worker no revierte Neon ni repara daños
  anteriores.

**Lo que no se afirma.** El 02/10/2026 un trabajador ejecutó suites de pruebas
que podían escribir en la base existente (registrado en las notas de la misión, no versionadas). Una
auditoría de solo lectura previa a la integración, los conteos legacy iguales
(`result`, `event`, `event_link`, `athlete`, `competition_registration`,
`event_competition`, `user_profile`) antes y después del piloto y la
coherencia actual **no demuestran** que el incidente no tuviera consecuencias
históricas: igualdad de conteos no es igualdad de valores. La tabla
`notification` tiene 3 filas frente a 0 en la auditoría previa, sin atribución
confirmada; no se ha investigado ni limpiado nada. Detalle del procedimiento en
[`docs/migraciones-deportivas.md`](docs/migraciones-deportivas.md).

---

## Dónde se despliega

**Solo** el Worker `calendario-fie-fede` de la cuenta Cloudflare
`52d39cf14bc17b94754729436036124d`, en
**https://calendario-fie-fede.excalofrio.workers.dev**. La cuenta tiene otros
Workers ajenos: no se tocan. La base **se queda en Neon** (el driver HTTP
`@neondatabase/serverless` funciona en Workers y el esquema usa enums, `uuid` y
`jsonb`, que D1 no tiene).

`wrangler.jsonc` manda: nombre, `main` (`worker/index.ts`, que reexporta el
`fetch` de OpenNext y añade el manejador `scheduled`), assets, los bindings
(`ASSETS`, `IMAGES`, `AI` y el bucket de archivos) y los crons. **No cambies
bindings ni crons al publicar.**

### Origen y Neon Auth

`NEXT_PUBLIC_APP_URL` se sustituye dentro del código al **compilar**: el feed
iCal y los correos construyen direcciones absolutas con ella, así que ponerla
como secreto no arregla un paquete compilado con otra. El `.env` local suele
traer `http://localhost:3000`; para publicar, el comando de compilación la
fija a mano. El origen publicado tiene que figurar en Neon Auth (panel de Neon,
Auth › Configuration › Domains, con protocolo y sin barra final); si falta, el
inicio de sesión responde `403 INVALID_ORIGIN`. Este proyecto no cambia
dominios de Neon Auth ni de Cloudflare.

### Compilar (sin `CF_ENV_EMBEBIDO`)

La receta antigua con `CF_ENV_EMBEBIDO=1` ya no se usa: incrustaba variables de
ejecución dentro del paquete como muleta. Los secretos viven en el almacén de
secretos de Cloudflare (nombres: `DATABASE_URL`, `NEON_AUTH_URL`,
`NEON_AUTH_COOKIE_SECRET`, `CRON_SECRET`) y nunca van en el paquete.
`scripts/compilar-cloudflare.mjs` retira los `.env` copiados por Next y vacía
`.open-next/cloudflare/next-env.mjs`. Hace falta **al menos 5 GiB libres** en C:.

```powershell
Set-Location -LiteralPath 'C:\Users\alejandro.c.ramirez\Documents\calendarioFedeEsgrima'
if ((Get-PSDrive C).Free -lt 5GB) { throw 'Menos de 5 GiB libres: no compilar' }
Remove-Item Env:CF_ENV_EMBEBIDO -ErrorAction SilentlyContinue
$env:NEXT_PUBLIC_APP_URL = 'https://calendario-fie-fede.excalofrio.workers.dev'
npm.cmd run cf:build          # next build + empaquetado OpenNext
```

Antes de publicar, comprueba que el paquete no lleva valores secretos sin
imprimirlos (busca los valores cargados en memoria dentro de `.open-next` y
cuenta coincidencias; no muestres nunca el valor ni la línea).

### Publicar el artefacto ya comprobado

`npm run cf:deploy` **recompila** (`cf:build`) y por eso no sirve para publicar
exactamente lo que acabas de comprobar. El comando directo de OpenNext publica
lo que hay en `.open-next` sin recompilar. Entra con el inicio de sesión OAuth
de Wrangler y desactiva la lectura de `.env` para que su token no se use como
atajo:

```powershell
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
$env:CLOUDFLARE_ACCOUNT_ID = '52d39cf14bc17b94754729436036124d'
node node_modules/@opennextjs/cloudflare/dist/cli/index.js deploy --env-file NUL
```

Antes, anota la versión que está al 100 %
(`node node_modules/wrangler/bin/wrangler.js deployments list --name calendario-fie-fede --env-file NUL`)
para poder volver a ella. Una publicación requiere autorización explícita del
propietario para ese destino; el comando es de uso humano y no se lanza solo.

**Volver atrás.** `wrangler rollback <versión-anterior> --name calendario-fie-fede --env-file NUL`
(o publicar de nuevo la versión anterior desde el panel) revierte **el
código**. No revierte Neon: tablas, datos y ledger quedan como estén. La
versión publicada y la anterior de cada publicación se registran en
[`docs/entrega-release.md`](docs/entrega-release.md). Ojo: la versión
anterior de la última publicación (`3fb282b6`) sirve `/api/archivos/*` sin
sesión; volver a ella reabre ese defecto.

### Los secretos

Están en el almacén de Cloudflare. `npm run cf:secretos` los sube leyéndolos de
`.env`, de uno en uno y por la entrada estándar, sin imprimir ningún valor; **no
se ejecuta al publicar**. Lo que **nunca** viaja dentro es el
`CLOUDFLARE_API_TOKEN` ni el `.env` completo.

### Sobre el subdominio de la URL

`excalofrio` es el subdominio de `workers.dev` **de la cuenta**, no de este
proyecto, y lo comparten todos sus Workers. Se cambia **solo desde el panel**;
cambiarlo afecta a todos a la vez y las URL antiguas dejan de responder.

### Crons

Nueve, uno por fuente o tarea y a horas distintas (UTC): si una fuente cambia,
las demás siguen funcionando. Coinciden `triggers.crons` de `wrangler.jsonc` y la
tabla `TAREAS` de `worker/index.ts`; si cambias una, cambia la otra.

| Cron (UTC) | Tarea |
|---|---|
| `0 3 * * *` | `ingest/skermo_rfee` |
| `30 3 * * *` | `ingest/fie` |
| `0 4 * * *` | `ingest/efc` |
| `30 4 * * *` | `ingest/skermo_regional` |
| `0 5 * * *` | `ingest/rfee_wp` |
| `30 5 * * *` | `ingest/skermo_ranking` |
| `0 6 * * *` | `extraer` |
| `45 6 * * *` | `ingest/fie_tiradores` |
| `0 7 * * *` | `notify` |

Los comentarios antiguos que hablan de ocho son anteriores. **Nunca invoques un
endpoint de cron como comprobación de salud**: ejecuta ingestas y envíos
reales. `vercel.json` se conserva como referencia histórica y no gobierna
nada del despliegue vivo.

### Comprobación posterior a publicar (sin sesión)

Solo lectura y sin cron: `/entrar` responde 200; las rutas privadas
(`/`, `/estado`, `/ranking`, `/perfil`, `/explorar`, `/explorar/ediciones`,
`/explorar/favoritos` y las fichas) redirigen a `/entrar`, también con la
cabecera `RSC: 1`; un token de feed iCal inexistente no devuelve datos;
`/api/archivos/<clave inexistente>` responde `401` sin tocar R2 (nunca pidas un
documento real); los recursos estáticos responden. El resultado de la última
publicación está en
[`docs/entrega-release.md`](docs/entrega-release.md).

**Qué no cubre.** Esas comprobaciones son anónimas. Inicio de sesión real, roles,
datos por arma, favoritos y los cuatro anchos son **QA privada manual del
propietario después de publicar**:
[`docs/matriz-qa-manual-responsive.md`](docs/matriz-qa-manual-responsive.md) y
[`docs/favoritos-guia-manual.md`](docs/favoritos-guia-manual.md). No se crean
cuentas temporales ni se reutilizan cookies para suplirla.

### Compilar en Windows

Next 16 deja en `.next/standalone` enlaces a paquetes externalizados que
OpenNext reproduce con `symlinkSync` sin tipo, lo que exige permisos de
administrador. `scripts/compilar-cloudflare.mjs` los retira antes de empaquetar.
En Linux basta `next build && opennextjs-cloudflare build`.

```powershell
npm.cmd run cf:preview   # el Worker entero en local, con bindings (no es una comprobación de producción)
```

- **Ningún número de la normativa vive en el código.** Importes, plazos,
  coeficientes y años de nacimiento están en tablas con su pantalla de edición
  y su historial de cambios.

---

## Verificación

Comprobaciones automáticas **seguras**, en este orden y una detrás de otra:

```powershell
npx.cmd vitest run --exclude=tests/datos.test.ts --exclude=tests/enlaces.test.ts --exclude=tests/seguridad.test.ts --maxWorkers=3
npm.cmd run typecheck -- --incremental false
git diff --check
npm.cmd run cf:build      # solo con >= 5 GiB libres; ver «Dónde se despliega»
```

**No ejecutes `npm test` ni Vitest sin esas exclusiones**, ni siquiera
aisladas o como diagnóstico: `tests/enlaces.test.ts` recalcula datos reales,
`tests/seguridad.test.ts` crea y borra fixtures de aplicación y
`tests/datos.test.ts` toca la base existente. `npm run lint` no sirve en
Next 16 y no se ejecuta. `npm run e2e` y `npm run produccion` necesitan una
sesión real y no forman parte de esta comprobación.
Lo que cubren los tests:

- **Parsers con HTML real guardado** (`tests/fixtures/*.gz`): si Skermo cambia
  su marcado, se ponen en rojo antes de que lo note nadie.
- **Idempotencia**: ejecutar el mismo scrape dos veces deja `actualizados = 0`
  la segunda vez. Comprobado también contra la base real.
- **Categorías con fechas límite**: el nacido el 31 de diciembre del año de
  corte.
- **Máquina de estados**: transiciones válidas e inválidas, y quién puede hacer
  cada una.
- **Ayudas de viaje**: diferencia horaria y aviso de cambio de hora.

Comprobaciones que hay que hacer a mano antes de dar acceso a nadie:

1. Revisar los años de nacimiento contra la circular de categorías de la RFEE.
2. Poner los importes reales de los recargos, indicando la circular de la que
   salen.
3. Suscribir un feed iCal en Google Calendar y en el iPhone, cambiar a mano la
   sede de un evento en la base y comprobar que **se actualiza en vez de
   duplicarse**.
4. Verificar en el panel de Resend que los correos salen y no caen en spam
   (SPF/DKIM del dominio propio).

---

## Fases opcionales, detrás de interruptor

**Extracción de dossieres con IA** (`AI_EXTRACTION_ENABLED`). El calendario da
fechas y sede, pero los plazos, las cuotas y los horarios están dentro del PDF.
El modelo **nunca escribe en producción**: cada campo viene con la cita literal
del documento, el código comprueba que esa frase existe de verdad en el PDF y,
si no, la descarta. Lo que queda va a una cola que aprueba una persona.
Los documentos con posibles datos personales **no se envían a un modelo de tier
gratuito**, porque ese tier entrena con lo que le mandas y aquí hay nombres de
menores.

**Envío directo a Skermo** (`SKERMO_SUBMIT_ENABLED`). No es un bot que suplanta
a nadie: es mandar la misma petición HTTP que manda el formulario de Skermo,
con las credenciales del propio club, que ya está autorizado a inscribir.
Arranca siempre en **modo simulación**, verifica releyendo el listado, es
idempotente por inscripción y **nunca envía sin que una persona lo apruebe**.
El export CSV no se retira nunca del producto.

Para activarlo hace falta algo que no se puede averiguar desde fuera: que
alguien con cuenta de club abra Skermo, pulse F12 → pestaña Red, haga una
inscripción real y copie la petición como cURL (quitando la cookie y la
contraseña).

---

## Notas legales

- **Skermo**: sus términos no prohíben el acceso automatizado y su `robots.txt`
  permite todo. Riesgo bajo.
- **FIE**: sus términos exigen permiso escrito para almacenar su contenido. Por
  eso de fie.org se guarda **lo mínimo** (identificador, fechas, arma,
  categoría, sede) y se enlaza siempre al original; no se copian descripciones,
  documentos ni textos informativos. Conviene pedirles ese permiso por escrito.
- **Datos de menores**: en España un menor de 14 años no puede consentir el
  tratamiento por sí mismo, así que la cuenta va a nombre del tutor y el
  tirador es un perfil vinculado. Se guarda el mínimo necesario y no viaja
  ningún dato personal en las direcciones de las páginas.
