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

## Puesta en marcha

```bash
npm install
cp .env.example .env     # y rellena las variables (ver más abajo)
npm run db:migrate       # crea las tablas en Neon
npm run db:seed          # temporada y tablas de normativa (NO datos de ejemplo)
npm run ingest           # primera carga desde las fuentes oficiales
npm run dev
```

### Variables de entorno

| Variable | Para qué | ¿Obligatoria? |
|---|---|---|
| `DATABASE_URL` | Neon Postgres (cadena *pooled*) | Sí |
| `NEON_AUTH_URL` | Base de Neon Auth | Sí |
| `NEON_AUTH_COOKIE_SECRET` | Firma de la cookie de sesión | Sí |
| `RESEND_API_KEY`, `EMAIL_FROM` | Avisos por correo | No (sin ella no se envía nada, pero la app funciona) |
| `CRON_SECRET` | Protege los endpoints de cron | Sí en producción |
| `BLOB_READ_WRITE_TOKEN` *o* `AWS_*` | PDFs y snapshots | No (sin ella no se guardan snapshots) |
| `AI_*` | Extracción de dossieres (fase opcional) | No |
| `SKERMO_SUBMIT_*` | Envío directo a Skermo (fase opcional) | No |

Todo el proyecto está pensado para caber en planes gratuitos: Neon Free,
Vercel Hobby y Resend Free. Con unos 20 usuarios no se roza ningún límite.

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
                      Ranking, Documentos, Mi club, Administración
    entrar/           Acceso con código de un solo uso
    api/              Cron, feeds iCal, autenticación
  components/         Interfaz. primitives.tsx son las piezas base
  db/schema/          Modelo de datos (Drizzle)
  lib/
    ingest/           Scrapers, normalización, validación y upsert
    entries/          Máquina de estados de las inscripciones
    ranking/          Cálculo del ranking interno
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
- **Región `fra1`** en Vercel y Neon en AWS Frankfurt: base de datos y servidor
  en el mismo sitio y cerca de España.

---

## Dónde se despliega

### https://calendario-fie-fede.aleramlar.workers.dev

Cloudflare Workers, cuenta `aleramlar@gmail.com`, leyendo la base de Neon de
verdad. La base **se queda en Neon**: el driver HTTP
`@neondatabase/serverless` funciona en Workers sin tocar nada, y el esquema es
Postgres con enums, `uuid` y `jsonb`, que D1 no tiene.

**Cada vez que cambia la URL hay que hacer dos cosas**, y sin ellas el
despliegue no sirve:

1. **Recompilar con la URL nueva.** `NEXT_PUBLIC_APP_URL` se sustituye dentro
   del código en tiempo de compilación —el feed iCal y los correos construyen
   direcciones absolutas con ella—, así que ponerla como secreto **no**
   arregla un paquete compilado con otra.
2. **Declararla en Neon Auth.** Panel de Neon → **Auth › Configuration ›
   Domains**, con protocolo y sin barra final. Si falta, el inicio de sesión
   responde `403 INVALID_ORIGIN`: la pantalla carga y nadie puede entrar.

```bash
set -a; source .env; set +a
export NEXT_PUBLIC_APP_URL="https://calendario-fie-fede.aleramlar.workers.dev"
export CF_ENV_EMBEBIDO=1
npm run cf:build && npx opennextjs-cloudflare deploy
npm run produccion     # entra con un navegador y comprueba que funciona
```

### Sobre el trozo `aleramlar` de la URL

Es el subdominio de `workers.dev` **de la cuenta**, no de este proyecto, y lo
comparten los quince Workers que hay. Se puede cambiar, pero **solo desde el
panel** (Workers & Pages → *Your subdomain* → *Change*): por API,
`PUT` responde `10036 Account already has an associated subdomain` y
`PATCH`/`POST`, `10405 Method not allowed for this authentication scheme`.

Cambiarlo afecta a los quince. Los ocho de `oxpea` se sirven desde dominio
propio (`oxpea.com`, `app.`, `api.`, `reservas.`, `admin.`, `demo.`, `docs.`,
`www.`), así que no dependen de `workers.dev`; lo que no se puede comprobar
desde aquí es si algún webhook o callback externo apunta a un
`*.aleramlar.workers.dev`.

La otra vía es un dominio propio: basta un registro nuevo en una zona que ya
esté en Cloudflare.

### Los secretos

Están en el almacén de Cloudflare (`npm run cf:secretos` los sube leyéndolos
de `.env`, de uno en uno y por la entrada estándar, sin imprimir ningún
valor). Pero además van **dentro del paquete** mientras se compile con
`CF_ENV_EMBEBIDO=1`, que es una muleta: la compilación lo avisa en cada
pasada. Para quitarla, compilar sin esa variable.

Lo que **nunca** viaja dentro es el `CLOUDFLARE_API_TOKEN`. Next, en modo
standalone, copia el `.env` del proyecto a la salida y OpenNext lo empaqueta;
en el primer despliegue subió el fichero entero, incluido ese token, que puede
desplegar y modificar Workers de toda la cuenta. No era accesible desde fuera
—se sirve un 404, y tampoco está entre los ficheros públicos— pero un secreto
de despliegue dentro de la cosa desplegada está mal. El paso 4 de
`scripts/compilar-cloudflare.mjs` lo borra.

### Crons

Ocho, uno por fuente y a horas distintas: si la FIE cambia su API, el resto
sigue funcionando. Están registrados y aceptados en Cloudflare, lo que solo
ocurre con Workers de pago (el plan gratuito corta en cinco).

`vercel.json` se conserva sin borrar, pero **no gobierna nada** del despliegue
vivo: es la referencia de la que salió la lista. Si cambias una franja ahí, no
pasa nada hasta que la copies a `triggers.crons` de `wrangler.jsonc` **y** a
la tabla `TAREAS` de `worker/index.ts`.

```bash
npm run cf:build     # next build + empaquetado para el Worker
npm run cf:preview   # el Worker entero en local, con bindings de verdad
npm run cf:deploy    # compila y despliega
```

Al compilar en Windows hace falta el guion propio: Next 16 deja en
`.next/standalone` enlaces a los paquetes que externaliza y OpenNext los
reproduce con `symlinkSync` sin tipo, lo que exige permisos de administrador.
`scripts/compilar-cloudflare.mjs` los retira antes de empaquetar. En Linux
basta `next build && opennextjs-cloudflare build`.

---

**Cloudflare Workers** (`@opennextjs/cloudflare`). Manda `wrangler.jsonc`.

`vercel.json` se conserva sin borrar, pero **no gobierna nada** del despliegue
vivo: es la referencia de la que salió la lista de crons. Si cambias una
franja ahí, no pasa nada hasta que la copies a `triggers.crons` de
`wrangler.jsonc` **y** a la tabla `TAREAS` de `worker/index.ts`.

La base de datos **se queda en Neon**: el driver HTTP
`@neondatabase/serverless` funciona en Workers sin tocar nada, y el esquema es
Postgres con enums, `uuid` y `jsonb`, que D1 no tiene.

```bash
npm run cf:build     # next build + empaquetado para el Worker
npm run cf:preview   # el Worker entero en local, con bindings de verdad
npm run cf:deploy    # compila y despliega
```

Al compilar hay que pasar la URL final, porque `NEXT_PUBLIC_APP_URL` se
sustituye dentro del código en tiempo de compilación y no se puede cambiar
después desde el panel:

```bash
NEXT_PUBLIC_APP_URL=https://calendario-esgrima.<subdominio>.workers.dev \
  npm run cf:build
```
- **Un cron por fuente, a horas distintas.** Si la FIE cambia su API, el resto
  sigue funcionando.
- **Ningún número de la normativa vive en el código.** Importes, plazos,
  coeficientes y años de nacimiento están en tablas con su pantalla de edición
  y su historial de cambios.

---

## Verificación

```bash
npm test          # parsers contra HTML real + lógica de dominio
npm run typecheck
npm run build
```

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
