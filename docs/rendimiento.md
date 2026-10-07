# Rendimiento y escala (fase 1: auditoría, infraestructura y medidas)

Objetivo: miles de usuarios, D1 sin colapsar, consumo mínimo y pantallas que
pintan completas a la primera, sin esqueletos. Dato de partida: D1 leyó
31,5 millones de filas en 24 h con muy poco uso real. Con las medidas de abajo
cuadra: una sola vista de perfil leía 130.000-173.000 filas, así que bastan
unas 200 vistas de perfil al día para llegar a esa cifra.

Este documento recoge las medidas, las decisiones y la lista de cambios por
pantalla. Lo transversal ya está hecho (arnés, índices, caché y `src/db`). Los
cambios en pantallas que hoy están tocando otras sesiones quedan descritos en
el apartado 8 para aplicarlos después.

## 1. Cómo se mide (arnés reutilizable)

`tests/perf/`:

| Fichero | Para qué |
|---|---|
| `preparar-copia.mts` | Deja una copia de trabajo con el esquema de producción de hoy: aplica 0004 y construye el índice, 0006, 0008, 0009, 0010 y 0012, más los SQL de relevos y de rankings internacionales que se cargaron después de exportar `nuevo9`. Sin ellos, las consultas de relevos y de ranking histórico parecen baratas porque no tienen filas. |
| `d1-local.mts` | D1 local real (workerd, con `getPlatformProxy` de Wrangler). Da el mismo `meta.rows_read` que factura Cloudflare. La copia se mueve dentro del estado de Miniflare, así que en disco solo hay una. |
| `medidor.mts` | Envuelve un binding D1 y apunta cada sentencia: SQL, parámetros, inicio y fin, filas devueltas, `rows_read`, `rows_written` y `meta.duration`. También calcula las idas en serie, es decir, la cadena de consultas que se esperan unas a otras. |
| `rutas.mts` | Para cada pantalla, las mismas lecturas que hace su `page.tsx`, con cuentas reales de la copia y 20 personas seguidas. Mide consultas, filas leídas y devueltas, idas en serie, ms, ms de motor y KB de datos (el JSON que la página pasa a sus componentes). Muestra también las 5 sentencias que más leen, con su plan, y marca los barridos y los índices automáticos. Además: `--comparar a.json b.json`, `--aplicar fichero.sql` (solo D1 local) y `--http` (HTML y RSC reales contra un servidor). |

```powershell
$W = "$env:USERPROFILE\calendario-datos\calendario-trabajo"
# Una sola copia (≈2 GB; hace falta ≥6 GB libres), preparada y movida al estado local:
Copy-Item "$W\nuevo9.sqlite" "$W\perf\rutas\base.sqlite"
npx tsx tests/perf/preparar-copia.mts "$W\perf\rutas\base.sqlite" "$W\relevos-sql-lote8" "$W\rankings-internacionales-sql-lote8"
$env:PERF_ESTADO = "$W\perf\rutas\estado"; $env:PERF_COPIA = "$W\perf\rutas\base.sqlite"
npx tsx tests/perf/rutas.mts "$W\perf\rutas\antes.json"            # instala la copia y mide
Remove-Item Env:PERF_COPIA
npx tsx tests/perf/rutas.mts --aplicar drizzle-d1/0015_indices_rendimiento.sql
npx tsx tests/perf/rutas.mts "$W\perf\rutas\despues.json"
npx tsx tests/perf/rutas.mts --comparar "$W\perf\rutas\antes.json" "$W\perf\rutas\despues.json"
# Todas las sentencias de cada ruta, con el SQL entero:  $env:PERF_VOLCAR = "<dir>"
# Solo unas rutas:  npx tsx tests/perf/rutas.mts salida.json "perfil|edición"
# HTML y RSC reales (cf:preview o producción, con la cookie de una sesión):
#   $env:PERF_URL = "https://…"; $env:PERF_COOKIE = "neon-auth.session_token=…"; npx tsx tests/perf/rutas.mts --http
# Al acabar: Remove-Item -Recurse "$W\perf\rutas\estado"
```

Cómo leer los tiempos: el tiempo local («ms») está dominado por la ida y vuelta
al proxy de workerd (≈40-80 ms por sentencia en serie). Representa bien lo que
pesan las **idas en serie**, que en producción son la latencia del Worker al
primario de D1, pero no es el tiempo de producción. El tiempo del motor
(«motor ms») es el de SQLite.

## 2. Medidas por ruta (copia de producción `nuevo9` + relevos y rankings)

Cuentas reales de la copia: tirador Llavador (`4e1f6cfc…`) y seleccionador de
florete (`089ce449…`). Antes y después de `0015_indices_rendimiento.sql`:

| Ruta | Consultas | Filas leídas antes | después | Δ | Idas en serie | Motor ms | KB datos |
|---|---:|---:|---:|---:|---:|---:|---:|
| Armazón: sesión + layout (cada página) | 7 | 1.011 | 24 | −98 % | 4 | 1 | 3,4 |
| Calendario, mes actual | 26 | 9.137 | 8.154 | −11 % | 6 | 10 | 470 |
| Calendario, marzo 2019 | 17 | 7.535 | 6.552 | −13 % | 5 | 17 | 653 |
| Buscar vacío (propuestas) | 12 | 63.595 | 11.618 | −82 % | 8 | 80 | 1 |
| Buscar «zabala» | 3 | 873 | 873 | 0 % | 2 | 8 | 2 |
| Sugerencias en vivo «zabal» (por tecla) | 2 | 1.058 | 1.058 | 0 % | 2 | 6 | 1,7 |
| Feed (sigue a 20) | 1 | 5.112 | 5.112 | 0 % | 1 | 2 | 12 |
| Perfil Llavador | 54 | 172.742 | 120.765 | −30 % | 11 | 415 | 406 |
| Perfil Zabala | 55 | 138.909 | 86.932 | −37 % | 11 | 218 | 263 |
| Perfil Ranvier | 54 | 129.623 | 77.646 | −40 % | 11 | 257 | 301 |
| Edición Mundial 2026 (FIE, 12 pruebas) | 8 | 51.969 | 11.108 | −79 % | 7 | 40 | 137 |
| Edición TNR 3-10-2026 (Skermo) | 8 | 44.024 | 3.174 | −93 % | 7 | 25 | 62 |
| Cara a cara Llavador, elegir rival | 6 | 23.698 | 23.698 | 0 % | 3 | 160 | 3,4 |
| Cara a cara Llavador vs. rival | 18 | 4.770 | 4.770 | 0 % | 4 | 31 | 97 |
| /ranking vigente, tirador (nacional + mundial) | 17 | 49.648 | 37.589 | −24 % | 7 | 73 | 680 |
| /ranking vigente, seleccionador | 15 | 35.378 | 35.378 | 0 % | 9 | 49 | 680 |
| /ranking nacional 2019-2020 | 8 | 8.081 | 8.081 | 0 % | 4 | 7 | 38 |
| Ranking mundial: cambiar de tabla (acción) | 5 | 5.003 | 5.003 | 0 % | 5 | 20 | 385 |

«KB datos» es el JSON de lo que la página pasa a sus componentes: es el suelo
del RSC, al que el RSC real suma el marcado. Para el HTML y el RSC reales hay
que usar `--http` contra un servidor; no se ha podido aquí porque `next build`
y `next dev` estaban prohibidos.

**Lo que es de la cuenta y lo que es común.** Con el volcado de sentencias, la
parte que depende de quién mira es mínima. En el perfil son 6 consultas y unas
30 filas de 54 y 120.000. En la edición, en el cara a cara y en el ranking
nacional pasado no hay ninguna. En /ranking son 18 filas. En el feed y las
sugerencias, todo (lo que se sigue). Por eso la caché compartida
(apartado 5) es la palanca grande: **con la caché caliente, una vista de perfil
pasa de ~120.000 filas a ~30**.

Las tablas de `0015` cuestan poco de construir en remoto: unas 170.000 filas
leídas y 64.000 escritas, una sola vez. D1 sí cobra como escritas las filas de
un `CREATE INDEX`; lo que no hace es pasar por los triggers ni por el ledger.

## 3. Los 10 peores problemas y su arreglo

| # | Problema (medido) | Arreglo | Estado |
|---|---|---|---|
| 1 | **Perfil: 54 consultas y 130-173 k filas por vista, con 11 idas en serie.** Cinco consultas `orientados` vuelven a leer los mismos asaltos de la persona (11-26 k filas cada una, con índices automáticos sobre el CTE). `mias` lee 16 k. La persona se resuelve 5 veces (10 consultas `grupo`/`cadena`). | Caché compartida del perfil público por persona (dependencia `deporte`): ~30 filas por vista con la caché caliente. Memorizar `resolverPersona` por petición (apartado 7). A medio plazo, un solo `orientados` por petición o un precálculo por persona al ingerir. | Índices hechos (−30/−40 %). La caché está lista; falta envolver la pantalla (apartado 8). |
| 2 | **`sport_external_id` barrida entera (51.985 filas) para devolver 5**, en el perfil y en Buscar (`depsEvidenciaDb.externos`: `value IN (…)` sin `scheme`). | Índice `sport_external_id_value_idx`: 52 k → 8. Alternativa sin coste de escritura: añadir `scheme IN ('rfee_license','fie_addr_id')` a la consulta (el CHECK no admite otros) y quitar el índice. | Hecho (0015). |
| 3 | **Edición: índice automático sobre `sport_import_coverage` entera (40.951 filas) en cada carga**, por el cruce de enlaces (`fact_kind='link'`, season, competition_key) cuando el único índice útil empieza por `source LIKE`. | Índice parcial `sport_import_coverage_enlace_idx … WHERE fact_kind = 'link'`, casi vacío (cuesta casi nada de escritura): 41 k → 0. | Hecho (0015). |
| 4 | **Resumen mundial del perfil: 11.719 filas para 1.** El CTE `g` hace `DISTINCT` sobre toda la clasificación FIE de la temporada para nada. Está en `leerResumenMundial` de `src/lib/sport/explorar/ranking-nacional.ts`. | Quitar `g`, porque es redundante, y cruzar por `fie_id` con el índice nuevo. Medido: **11.719 → 18 filas, el mismo resultado**. SQL en el apartado 7. | Índice hecho; falta reescribir la consulta. |
| 5 | **/ranking: 35-50 k filas y 680 KB por carga.** `personasOficiales`: 14 k (subconsultas correlacionadas por fila). `listGruposClasificacionFie`: 11,7 k. `gruposDeMisTiradoresFie`: 12 k → índice. Además viajan al navegador todas las tablas RFEE (1.350 filas), la tabla FIE inicial entera (907 filas) y el mapa de personas. | Caché compartida por tabla (`ranking`, `ranking-fie`). Marcar «mis tiradores» después de leer de la caché. Mandar solo el grupo inicial y precargar los demás al pasar por el selector. | Índice hecho (−24 % para el tirador); el resto, en el apartado 8. |
| 6 | **Buscar vacío: las propuestas leen 11,5 k filas en cada carga** (los mejores españoles del ranking FIE), y son las mismas para todos. | Caché compartida de los destacados (`deporte`). Quitar en la petición los que la cuenta ya sigue. | Apartado 8. |
| 7 | **Cara a cara, elegir rival: 23,7 k filas y 160 ms de motor por persona.** | Caché compartida por persona (`deporte`). | Apartado 8. |
| 8 | **Armazón en CADA página:** `getDataFreshness` barría `event` (984 filas), y la sesión busca por `lower(trim(email))` sin índice (crecería con cada cuenta nueva). Además, `get-session` va a Neon Auth por Internet en cada petición (`disableCookieCache=true`): es la mayor latencia fija. | Índices `event_last_seen_idx` y `user_profile_email_norm_idx`: 1.011 → 24 filas. Neon: apartado 6. | Índices hechos; Neon, propuesta. |
| 9 | **Calendario: 26 consultas, 8-9 k filas y 470-650 KB de datos por carga.** Viaja la temporada entera, con plazos y documentos. | Caché compartida (`calendario`) de los eventos y del tramo pasado. Las inscripciones y los tiradores de la cuenta van aparte. Recortar los campos que la vista no pinta. | Apartado 8. |
| 10 | **CPU: Drizzle reconstruía la configuración relacional del esquema (115 KB) en cada consulta**, unos 0,4 ms × 54 consultas por perfil. Y el detector de pruebas conjuntas no se memoriza (256 filas de `sqlite_master` por edición). | `createLazyD1Database` memoriza la instancia por binding. El detector: apartado 7. | Runtime hecho; el detector, propuesto. |

Otros, menores: el feed lee 5,1 k filas por carga (es personal, aceptable). Las
sugerencias en vivo leen ~1 k filas por tecla: conviene esperar 150-200 ms
desde la última tecla en el cliente. La edición cuenta resultados y asaltos con
subconsultas (5 k filas en el Mundial): eso es cacheable.

## 4. Índices: `drizzle-d1/0015_indices_rendimiento.sql`

Solo índices, idempotente y aditiva. Un `CREATE INDEX` no dispara los triggers
de guarda ni de cargo de `sport_*` (no hace falta lease y no toca el ledger).
Lo que cuesta es mantenerlos: cada fila que se escriba con la columna indexada
escribe además una fila de índice, que D1 cobra y el ledger no ve.

| Índice | Ruta que arregla | Filas leídas | Coste de escritura |
|---|---|---|---|
| `event_last_seen_idx (last_seen_at)` | layout (todas) | 984 → 1 | ~500 filas de índice por pasada del scraper |
| `user_profile_email_norm_idx (lower(trim(email)))` | sesión (todas) | N cuentas → 0-1 | una por alta o cambio de correo |
| `sport_import_coverage_enlace_idx (season, competition_key) WHERE fact_kind='link'` | edición | 40.951 → 0 | solo filas `link` (hoy, ninguna) |
| `fie_clasificacion_fie_idx (fie_id, season)` | /ranking, perfil | 12.062 → pocas | ~11.700 por relectura completa de la FIE (diaria) |
| `sport_external_id_value_idx (value)` | perfil, Buscar | 51.985 → 8 | una por identificador externo nuevo (miles por lote) |
| `sport_competition_event_competition_idx` (el de 0006, `IF NOT EXISTS`) | calendario pasado | — | la exportación del lote 8 no lo traía |

Se descartaron, porque la caché es mejor solución que un índice que habría
que mantener:

- Un índice sobre `official_ranking_entry (… category_raw)`: son 1.350 filas y
  cambian a diario.
- Índices sobre `event_competition`: es una tabla pequeña, y el coste real es
  enviar la temporada entera.

`PRAGMA optimize` (ANALYZE) no se ha incluido: cambia los planes de todas las
consultas a la vez, y habría que medirlo antes.

## 5. Caché compartida: `src/lib/cache/*`

Es para datos que no dependen de quién mira: el perfil deportivo de una
persona, las tablas de ranking, las pruebas o ediciones, el cara a cara entre
dos personas y el calendario pasado.

- **API** (`index.ts`):
  `cacheCompartida.definir({ espacio, depende, frescoMs, caducaMs, cargar })`
  devuelve una función `(…partes escalares) => Promise<T>`. Además se exportan
  `invalidarCache(deps)` e `invalidarTrasIngesta(fuente)`.
- **Claves versionadas** (`claves.ts`, `versiones.ts`): las claves tienen la
  forma `espacio/e1/<versión>/<partes>`, y la versión sale de las épocas de
  datos. Funciona así:
  - `deporte`: lo cambia sola **cualquier** escritura en `sport_*`, porque los
    triggers suben `sport_capacity_ledger.accounted_bytes`, que nunca baja. A
    eso se suma la época explícita.
  - `calendario`, `ranking` y `ranking-fie`: solo tienen la época explícita de
    `cache_epoch` (migración `0016_cache_epoca.sql`).
  - La versión se lee como mucho una vez cada 30 s por isolate (2-5 filas), no
    en cada petición.
  - Sin la tabla 0016 todo sigue funcionando con el ledger, y lo demás caduca
    por tiempo.
  - Cambiar la versión invalida a la vez en todos los centros de datos, sin
    borrar nada (la Cache API solo borra en el centro de datos donde se llama).
- **Stale-while-revalidate** (`cache.ts`):
  - Dentro de `frescoMs`, la entrada se sirve tal cual.
  - Entre `frescoMs` y `caducaMs`, se sirve y se recalcula en segundo plano con
    `ctx.waitUntil`.
  - Tras una invalidación, se sirve la última versión conocida (alias
    `ultima`) mientras se recalcula. Así **una pantalla cacheada solo espera a
    D1 la primera vez**. Se puede desactivar por espacio con
    `anteriorMientrasRevalida: false`.
  - Hay una sola carga en vuelo por clave e isolate, así que no hay estampidas.
- **Robusta**:
  - No guarda `null` ni `undefined`, que es lo que devuelven los cargadores
    cuando fallan.
  - Un error del cargador se propaga y no se guarda.
  - Si falla la versión o el almacén, se lee directamente de D1.
  - Cada lectura deserializa de nuevo, así que dos peticiones nunca comparten
    objeto.
  - Conserva `Map`, `Set` y `Date`.
- **Nunca datos de cuenta** (`privacidad.ts`):
  - El cargador recibe solo las partes de la clave, nunca la sesión.
  - Lo personal (favorito, «siguiendo», «mis tiradores», inscripciones) se lee
    aparte y se añade después.
  - Red de seguridad: si el valor contiene claves de cuenta (`profileId`,
    `email`, `seguida`, `siguiendo`, `favorito`, `athleteIdsPropios`,
    `inscripciones`…), no se guarda y queda un aviso en el registro.
    `mios` no está en la lista porque en cara a cara son los tocados de la
    persona de la ficha.
  - «Mis tiradores» y «siguiendo» nunca pasan por aquí.
- **Almacenes** (`almacenes.ts`), en cascada:
  1. Memoria del isolate (LRU de 16 MB): siempre.
  2. Cache API: solo con la variable `CACHE_API_COMPARTIDA=true`.
     **En `*.workers.dev` la Cache API no guarda nada**: solo funciona con un
     dominio propio.
  3. KV, si existe el binding `CACHE_DATOS`: global, con ~60 s de
     propagación. Cuesta 0,50 $ por millón de lecturas y 5 $ por millón de
     escrituras; las escrituras solo ocurren en un fallo de caché.

  Hoy, en `workers.dev` y sin KV, solo funciona la memoria, que ya sirve bajo
  carga (los isolates calientes reciben muchas peticiones). Con KV la caché es
  global.
- **Invalidación desde la ingesta**: hay que añadir una línea en
  `src/app/api/cron/ingest/[source]/route.ts`, justo después de `runIngest`:

  ```ts
  import { invalidarTrasIngesta } from '@/lib/cache';
  // …
  const resultado = await runIngest(source, { … });
  await invalidarTrasIngesta(source); // nunca lanza
  ```

  `DEPENDENCIAS_POR_FUENTE` dice qué invalida cada fuente; una fuente
  desconocida lo invalida todo. Los scripts de carga por lotes
  (`sincronizar-d1.ts`) no necesitan hacer nada, porque el ledger cambia la
  versión de `deporte`. Para los rankings y el calendario cargados a mano, hay
  que ejecutar en remoto `INSERT INTO cache_epoch …`, la misma sentencia que
  `SQL_INVALIDAR`.
- **Pruebas**: `tests/cache-compartida.test.ts` (22 casos) cubre claves,
  serialización, la guarda de cuenta, que nunca mezcla cuentas, que no guarda
  null ni errores, una sola carga en vuelo, SWR, invalidación por época y por
  ledger, el paso a D1 cuando no hay versión, los almacenes, las épocas con y
  sin tabla, y las sesiones de D1.

**Binding KV (no creado).** Comando:

```powershell
npx wrangler kv namespace create CACHE_DATOS
```

y añadir a `wrangler.jsonc` el id que imprima:

```jsonc
"kv_namespaces": [{ "binding": "CACHE_DATOS", "id": "<id>" }]
```

**Duraciones recomendadas** (ajustables por espacio):

| Espacio | `frescoMs` | `caducaMs` |
|---|---|---|
| Perfil, cara a cara, edición (`deporte`) | 6 h | 7 d |
| Tablas de ranking (`ranking`, `ranking-fie`) | 30 min | 7 d |
| Calendario vigente (`calendario`) | 5 min | 1 d |
| Calendario pasado | 1 d | 30 d |

La versión ya invalida en cuanto hay datos nuevos; `frescoMs` es solo la red
de seguridad.

## 6. Réplicas de lectura de D1 (Sessions API)

- **Encaja con OpenNext.** El binding se resuelve por petición con
  `getCloudflareContext()`, y OpenNext crea un objeto de contexto nuevo por
  petición. `resolveD1Binding` (en `src/db/d1/runtime.ts`) ya crea **una
  sesión por petición** si `D1_SESIONES=replicas`. Está apagado por defecto.
- **Coste:** cero. Las réplicas no se cobran aparte: se paga lo mismo por
  `rows_read` y `rows_written`.
- **Beneficio:** latencia de lectura desde la réplica más cercana, y el
  primario se descarga.
- **Riesgo:** sin bookmark, una petición nueva puede leer una réplica que aún
  no ha visto la escritura de la petición anterior. Por ejemplo: sigues a
  alguien y el feed siguiente no lo muestra durante ~1 s.
- **Para activarlo bien:**
  1. Activar la replicación en el panel (D1 › Settings › Enable Read
     Replication) o por API con `read_replication.mode: "auto"`.
  2. Guardar `session.getBookmark()` en una cookie `d1b` después de las
     acciones que escriben, y abrir la sesión con ese bookmark si existe. Eso
     va en `worker/index.ts` o en un middleware.
  3. Poner `"D1_SESIONES": "replicas"` en `vars`.

  Con la caché delante, el beneficio es menor: lo que queda en D1 es sobre
  todo lo de la cuenta.

**Neon Auth en cada petición** (problema 8): `get-session` con
`disableCookieCache=true` hace una ida por Internet en cada página. La opción
es memorizar en el isolate, durante 30-60 s, la sesión validada, con clave
SHA-256 del token y nunca en una caché compartida, y mantener en D1 la
comprobación de revocación (`invite_status`). Contrapartida: un cierre de
sesión tardaría ≤60 s en ese isolate. Hay que decidirlo; no se ha hecho.

## 7. Límites del Worker y ajustes en `src/db`, `real.ts` y `contexto.ts`

- **CPU**: el plan de pago da 30 s por defecto y el uso real está muy lejos.
  Lo caro es la serialización del RSC (680 KB en /ranking, 400 KB en el
  perfil) y el JSON de la caché.
  - Hecho: memorizar Drizzle por binding (unos 20 ms de CPU menos por perfil).
  - Pendiente: recortar lo que se envía al cliente (apartado 8).
- **Subrequests**: cada consulta a D1 cuenta. En el plan de pago son 10.000
  por petición, y el peor caso es el perfil con 54. Hay margen, pero cada
  consulta en serie es latencia: el perfil hace 11 idas en serie, y a ~10-30 ms
  cada una eso son 0,1-0,3 s esperando a D1. KV y la Cache API cuentan como
  conexiones (6 a la vez esperando cabeceras): la cascada lee en serie.
- **Respuesta**: no hay límite, pero 680 KB de datos en /ranking y 470-650 KB
  en el calendario son lo que más retrasa el primer pintado en un móvil.
- **`ContextoExplorador` y `real.ts`** (propuestas, no aplicadas, porque tocan
  los cargadores de las pantallas):
  1. `export const contextoReal = cache(() => ({ … }))` (React `cache`), para
     que la página y sus cargadores compartan un único contexto por petición.
     Hoy cada página llama a `contextoReal()` 3 o 4 veces.
  2. Añadir a `ContextoExplorador` un `persona(id)` memorizado por contexto.
     Con eso, `resolverPersona` se hace una vez por petición, no 5 (son 10
     consultas y 2-4 idas en serie menos en el perfil).
  3. Añadir `contextoPublico(db)`, sin `perfil` ni `propietario`, para los
     cargadores cacheados: si un cargador cacheado intenta leer la sesión,
     falla.
- **Detector de pruebas conjuntas**: `conjunta-edicion.ts` crea
  `crearDetectorConjuntas(db)` como parámetro por defecto, así que se crea uno
  nuevo en cada llamada y nunca recuerda nada. Hay que hacerlo de módulo,
  como `esquemaDeportivo`: son 256 filas menos por edición.
- **Resumen mundial** (`leerResumenMundial`): sustituir la consulta por

  ```sql
  WITH ids AS MATERIALIZED (
    SELECT DISTINCT CAST(x.value AS INTEGER) AS fie FROM sport_external_id x
    WHERE x.scheme = 'fie_addr_id' AND x.link_status = 'CONFIRMADO'
      AND x.person_id IN (SELECT value FROM json_each(?)))
  SELECT f.weapon AS arma, f.gender AS genero, f.category AS categoria, f.position AS puesto,
         CAST(f.season AS TEXT) AS temporada, f.fie_id AS "fieId"
  FROM ids CROSS JOIN fie_clasificacion f
    ON f.fie_id = ids.fie AND f.season = (SELECT max(season) FROM fie_clasificacion)
  WHERE f.format = 'INDIVIDUAL' AND f.position IS NOT NULL
  ```

  Medido con el índice 4: 11.719 → 18 filas, mismo resultado.
- **`depsEvidenciaDb.externos`**: si se añade `scheme IN ('rfee_license',
  'fie_addr_id')`, la consulta usa `sport_external_id_lookup_idx` y se puede
  retirar el índice 5.

## 8. Sin esqueletos: arquitectura y cambios por pantalla

Principio: **cada pantalla pinta completa en la primera respuesta**. Para eso:

1. Lo común sale de la caché compartida, que responde en microsegundos desde
   memoria o en milisegundos desde KV, y solo espera a D1 la primera vez tras
   cada ingesta.
2. Lo de la cuenta son pocas consultas y en paralelo (≤1 ida).
3. El primer render lleva solo lo visible.
4. Lo que se abre después (otra pestaña, otro grupo de ranking, otra prueba)
   se **precarga** cuando el usuario muestra intención (pasa el ratón, toca o
   enfoca el enlace), en vez de pintar un esqueleto.

Cómo se hace en este Next (`node_modules/next/dist/docs/01-app/02-guides/prefetching.md`):

- Sin `loading.js`, una ruta dinámica **no se precarga** y la navegación
  espera, pero mantiene visible la pantalla anterior (no hay esqueleto). Con
  `loading.js`, se precarga hasta ese límite y se pinta el esqueleto.
- `prefetch={true}` precarga la ruta entera, también la dinámica, y la guarda
  en la caché del cliente durante `staleTimes.static` (5 min por defecto).
- Para no precargar 900 enlaces de una tabla, conviene un enlace de
  «intención»: `prefetch={activo ? true : false}`, con `activo` puesto en
  `onPointerEnter`, `onTouchStart` y `onFocus`. Es el patrón «Hover-triggered
  prefetch» de la guía, con `true` en vez de `null`.
- `experimental.staleTimes: { dynamic: 30 }` en `next.config.ts` hace que
  volver atrás y adelante no repita la petición en 30 s. Es global: las
  acciones que escriben tienen que seguir llamando a `revalidatePath` o a
  `router.refresh()`. Hay que decidirlo; no se ha aplicado.
- Indicador de navegación sin esqueleto: `useLinkStatus` (guía
  `use-link-status.md`), una barra fina o un punto en el enlace pulsado.

**Cambios por pantalla** (para las sesiones que llevan cada una, o para una
pasada final):

| Pantalla | Cambios |
|---|---|
| Todas | Quitar los `loading.tsx` de `explorar/`, `explorar/[personaId]/`, `(perfil)/`, `cara-a-cara/`, `buscar/`, `ediciones/`, `favoritos/`, `siguiendo/`, `ranking/` y `estado/`, y los `fallback` de esqueleto. Sustituir `<Link prefetch={false}>` en listas por el enlace de intención. Pasar `invalidarTrasIngesta` en la ruta de cron. |
| Layout `(app)/layout.tsx` | `getDataFreshness` y `getCurrentSeason` a la caché compartida (`calendario`, fresco 5 min). Valorar la memorización de la sesión de Neon (apartado 6). |
| Calendario `(app)/page.tsx` | `listEvents(…)` y `cargarTramoPasado(…)` cacheados por `scope`, temporada y tramo (`calendario`). `getManagedAthletes` e inscripciones, aparte. Recortar `EventView` a lo que pinta la vista (470-650 KB ahora). Precargar el tramo anterior y el siguiente al pasar por las flechas. |
| Buscar y feed | Cachear los destacados de `leerPropuestasParaSeguir` sin `seguida` y filtrar las seguidas en la petición. Las búsquedas por texto ya son baratas (873 filas); se pueden cachear por `q` normalizada si hay mucho tráfico repetido. Sugerencias: esperar 150-200 ms desde la última tecla. El feed es personal: sin caché compartida (se puede cachear por persona seguida y componer). |
| Perfil `explorar/[personaId]` | Un `perfilPublico(personaId)` cacheado (`deporte`, fresco 6 h, caduca 7 d) con ficha, historial, extras, rendimiento, rivales, curiosidades, europeo, relevos y olímpica. Fuera de la caché: `cargarEstadoFavorito` y la propiedad («es mío»). Sin `Suspense` ni «Cargando…» en las pestañas: con la caché caliente todo llega en la primera respuesta. Para que la primera vista tras una ingesta también llegue completa, precargar los perfiles al pasar por los enlaces. `criterios` (ranking, formato, cursor) como partes de la clave. Aplicar la reescritura del resumen mundial y memorizar `resolverPersona`. |
| Edición y prueba | `cargarEdicion(edicionId, prueba)` cacheado (`deporte`). Las otras pruebas de la edición, precargadas al pasar por el selector. Memorizar el detector de conjuntas. |
| Cara a cara | Lista de rivales por persona cacheada (`deporte`). El enfrentamiento `(yo, rival, filtros)` cacheado (`deporte`). Relevos, en la misma entrada que el enfrentamiento, no en un `Suspense` aparte. |
| /ranking | Tablas RFEE por temporada y grupo cacheadas (`ranking`). Tabla FIE por grupo cacheada (`ranking-fie`) **sin `athleteIdsPropios`**; «mis tiradores» se marcan después. `personasOficiales` y `listGruposClasificacionFie` cacheados. En la primera respuesta, solo el grupo inicial de cada lado (ahora viajan los 18 grupos RFEE y la tabla FIE entera: 680 KB). Los demás grupos se precargan al pasar por el selector, con la acción `cargarClasificacionFie` contra la caché. |
| Notificaciones y olímpica | La clasificación olímpica (`getAnotacionesOlimpicas`) es común: cacheada con `ranking-fie`. Las notificaciones son personales: sin caché compartida. |

## 9. Comandos que tiene que ejecutar el usuario

Nada de esto se ha ejecutado contra remoto. Primero, un marcador de Time
Travel, como en cada lote:

```powershell
npx wrangler d1 time-travel info calendario-fie-fede-db --env-file NUL
npx wrangler d1 execute calendario-fie-fede-db --remote --env-file NUL --file drizzle-d1/0015_indices_rendimiento.sql
npx wrangler d1 execute calendario-fie-fede-db --remote --env-file NUL --file drizzle-d1/0016_cache_epoca.sql
# Opcional, caché global: crear KV y añadirlo a wrangler.jsonc (apartado 5)
npx wrangler kv namespace create CACHE_DATOS
# Opcional, con dominio propio: "CACHE_API_COMPARTIDA": "true" en vars
# Opcional, réplicas: activar en el panel y, con la cookie de bookmark hecha, "D1_SESIONES": "replicas"
# Medir HTML/RSC reales tras desplegar:
#   $env:PERF_URL="https://calendario-fie-fede.excalofrio.workers.dev"; $env:PERF_COOKIE="…"; npx tsx tests/perf/rutas.mts --http
```

## 10. Fase 2: calendario, edición, prueba y cara a cara

### Medidas (copia `nuevo10` con 0015 y 0016, `PERF_HOY=2026-10-08`)

El arnés mide ahora cada ruta dos veces en el mismo proceso: **fría** (primera
carga, caché compartida vacía) y **caliente** (segunda). Para que la fría de una
ruta no herede lo que dejó otra, se lanza un proceso por ruta con el filtro
(`npx tsx tests/perf/rutas.mts salida.json "^calendario, mes actual"`).
Consultas / filas leídas / idas en serie:

| Pantalla | Antes, fría | Antes, caliente | Después, fría | Después, caliente | KB datos |
|---|---:|---:|---:|---:|---:|
| Calendario, mes actual | 27 / 8.510 / 7 | 26 / 8.162 / 6 | 28 / 8.512 / 7 | **6 / 24 / 3** | 470 → 413 |
| Calendario, marzo 2019 | 18 / 6.904 / 5 | 17 / 6.556 / 5 | 19 / 6.906 / 5 | **6 / 24 / 3** | 653 → 595 |
| Calendario, trimestre anterior (acción) | 12 / 4.732 / 6 | 11 / 4.384 / 5 | 13 / 4.734 / 7 | **0 / 0 / 0** | 126 → 109 |
| Ficha de torneo (al abrirla) | 16 / 16.190 / 5 | 14 / 15.494 / 5 | 17 / 15.848 / 6 | **2 / 6 / 2** | ver nota |
| Edición Mundial 2026 (FIE) | 9 / 11.456 / 8 | 8 / 11.108 / 7 | 10 / 11.458 / 9 | **0 / 0 / 0** | 137 |
| Edición Mundial 2026, otra prueba | 9 / 5.974 / 8 | 8 / 5.626 / 7 | 10 / 5.976 / 9 | **0 / 0 / 0** | 17 |
| Edición TNR 3-10-2026 (Skermo) | 9 / 3.522 / 8 | 8 / 3.174 / 7 | 10 / 3.524 / 9 | **0 / 0 / 0** | 62 |
| Catálogo de ediciones sin filtros | 5 / 73.446 / 2 | 3 / 72.750 / 1 | 6 / 73.448 / 3 | **0 / 0 / 0** | 18 |
| Cara a cara, elegir rival | 7 / 24.046 / 4 | 6 / 23.698 / 3 | 8 / 24.048 / 5 | **0 / 0 / 0** | 3,4 |
| Cara a cara, duelo con relevos | 20 / 5.715 / 5 | 17 / 4.671 / 4 | 21 / 5.717 / 6 | **0 / 0 / 0** | 96 |
| Resumen mundial (la consulta sola) | 11.738 filas | | 15 filas, mismo resultado | | |

- La fría lleva una consulta más: la versión de la caché (2-5 filas), que se lee
  como mucho cada 30 s por isolate. En la caliente no aparece porque está
  memorizada.
- Calendario caliente, 6 consultas y 24 filas: la temporada vigente, sus
  categorías y la frescura (que en la petición real ya ha leído el layout:
  React `cache` las deduplica) y los tiradores de la cuenta con sus armas.
- Ficha: antes eran **tres acciones de servidor**, y Next las despacha **de una
  en una**: detalle, quién va y podios iban en serie. Ahora es una
  (`fichaDelEvento`), en paralelo por dentro. Lo que queda en caliente son los
  tiradores de la cuenta (para «es mío»). La medida «antes» sumaba la banda de
  resultados por evento y la lista unida en bruto, así que su KB no es
  comparable.
- `resolverPersona` memorizado por petición (React `cache`) no se ve en el
  arnés: React sólo memoriza dentro de un render de servidor. En el perfil son
  hasta 10 consultas menos por vista.
- La copia no tiene las tablas de relevos (`sport_relay*`): el coste de los
  relevos del cara a cara no está medido.

### Qué se ha hecho

- **Caché compartida** (memoria del isolate; Cache API y KV cuando estén):
  - `src/lib/queries/calendario-cache-modelo.ts` (+ `calendario-cache.ts`, la
    instancia real): temporada de la rejilla (`calendario`, 5 min / 1 d, clave
    con el día), tramos pasados (`calendario` + `deporte`; recientes 5 min,
    antiguos 1 d / 30 d y sin el día en la clave), detalle de la ficha
    (5 min), lista oficial de inscritos sin evidencias ni procedencia (2 min) y
    podios (`deporte`, 6 h).
  - `src/lib/sport/explorar/cache-pantallas.ts` (+ `cache-real.ts`): edición
    con su prueba, catálogo (primera página) y series, «elegir rival» por
    persona (y búsqueda), y el duelo con sus relevos en la misma entrada. Todo
    con la dependencia `deporte` (6 h / 7 d). Con cursor, directo a D1.
  - Los cargadores calculan con `contextoPublico(hoy)`
    (`contexto-publico.ts`): un lector sin identidad y todo lo de la cuenta
    vetado. La sesión se comprueba antes, con el contexto real. «Es mío», las
    inscripciones solicitadas y los tiradores de la cuenta se leen y aplican
    después (`quien-va.ts`, `calendario-pantalla.ts`).
  - Sólo se guardan lecturas completas: un fallo parcial (asaltos, rivales,
    rendimiento) se sirve una vez y se vuelve a pedir.
- **Recorte de la temporada** (`recortarParaRejilla`): fuera
  `linkedEvents`, `imageSource`, `circuitFie`, `regionalFederation`, `notes` y
  la frase y el próximo hito de `status` (la rejilla sólo usa `state`,
  `closed` y `daysLeft`). Entre −12 % y −13 % del JSON. Lo que sólo pinta la
  ficha se queda (ver «Pendiente»).
- **Menos idas**: la pantalla del calendario lee todo en una tanda (las
  inscripciones de la cuenta se encadenan a sus tiradores sin esperar al
  resto); quién va lee los tiradores y la lista en paralelo.
- **Sin esperas visibles**:
  - fuera `ediciones/loading.tsx` y `cara-a-cara/loading.tsx`;
  - el cara a cara pinta los relevos con el duelo, sin `Suspense`;
  - en el calendario no hay «Cargando…»: un tramo pasado que aún no ha llegado
    no se pinta a medias; la vista sigue enseñando el anterior hasta tenerlo
    (cursor de espera y `aria-busy` en las flechas);
  - la ficha no pinta esqueletos: la banda «¿Estás dentro?» y la de
    resultados aparecen cuando hay datos.
- **Precarga por intención**:
  - `src/components/enlace-intencion.tsx`: `prefetch={true}` al entrar el
    puntero, tocar o enfocar. Se usa en el selector de prueba, la edición, el
    cara a cara y los enlaces del calendario a ediciones y personas.
  - Calendario: el tramo de al lado (y el de hoy) se pide al pasar por las
    flechas; la ficha de un torneo (`ficha/precarga.ts`, un minuto en el
    navegador) al pararse el puntero 120 ms en su tarjeta, al tocarla o al
    enfocarla. Al abrirla se usa lo ya recibido.
- **Transversal**: `resolverPersona` memorizado por petición; detector de
  pruebas conjuntas uno por base (`detectorConjuntasDe`); consulta del
  resumen mundial reescrita (sin el CTE `g`).
- **Pruebas**: `tests/cache-pantallas-fase2.test.ts` y
  `tests/cache-calendario-fase2.test.ts` (privacidad de la caché con dos
  cuentas, guardas de sesión, qué no se guarda, recorte, claves, detector,
  resumen mundial contra la consulta anterior en SQLite, `resolverPersona`
  memorizado, sin `loading.tsx`, esqueletos ni «Cargando…»).

### Pendiente para la pasada final

Cosas que caen en ficheros de otras sesiones o que no se han podido
comprobar aquí:

1. **`explorar/loading.tsx`** (armazón de Explorar) sigue envolviendo ediciones
   y cara a cara: al llegar desde fuera de `/explorar` sin precarga, Next pinta
   ese esqueleto. Con `EnlaceIntencion` la ruta entera ya está precargada al
   pulsar, pero hay que quitarlo para cumplir «sin esqueletos» del todo.
2. **Invalidación del calendario**: la ruta de cron de ingesta tiene que llamar
   a `invalidarTrasIngesta(source)` (apartado 5). Sin ella, la temporada y el
   detalle de la ficha se renuevan por tiempo (5 min) y la lista de inscritos
   cada 2 min. Las acciones de administración que cambian el calendario, la
   normativa de plazos (`deadline_rule`) o lo extraído de los PDFs deberían
   llamar a `invalidarCache(['calendario'])`.
3. **Layout**: `getDataFreshness` y `getCurrentSeason` a la caché compartida
   (`calendario`, 5 min). Son 4 de las 6 consultas que quedan en el calendario
   caliente.
4. **KV** `CACHE_DATOS` en `wrangler.jsonc`: hoy sólo funciona la memoria del
   isolate, así que cada isolate paga su primera carga (la columna «fría»).
5. **Ficha, frío**: `cargarDatosExtraidos` (`calendar.ts`) barre
   `extraccion_propuesta` (~12.800 filas de 15.800) por el `OR` con el
   `LEFT JOIN`. Partirla en dos ramas por índice (`evento_id` y documento por
   URL) dejaría la ficha fría en unos cientos.
6. **Cara a cara, frío**: «elegir rival» lee 23.700 filas con un índice
   automático (`rival_id`). La caché lo amortiza; a medio plazo, un precálculo
   por persona al ingerir.
7. **Catálogo, frío**: el conteo total recorre todas las ediciones (73.000
   filas). Está cacheado; se podría precalcular al ingerir.
8. **Podios**: `cargarPodiosEvento` lee con `leerEdicion` la clasificación y
   los asaltos enteros de cada edición para quedarse con sus pruebas. Está
   cacheado; una lectura de pruebas sin clasificación sería mucho más barata.
9. **Más recorte de la temporada**: lo que sólo pinta la ficha (documentos,
   fuentes, horarios, cuota, enlaces, `sourceUrl` de cada prueba: ~175 KB de
   433) podría salir de la rejilla si la ficha se abre con el detalle. Ahora
   que la ficha se precarga con la intención es viable, pero cambia lo que
   enseña la ficha durante una fracción de segundo y no se ha podido
   comprobar sin `next dev` ni `next build`.
10. **`contextoReal()` memorizado por petición** (`real.ts`, apartado 7): lo
    usa el perfil, que es de otra sesión.
11. **Comprobación visual**: las pantallas no se han abierto en un navegador
    (prohibidos `next dev` y `next build`). Hay que revisar en `cf:preview` el
    paso de trimestre (sigue el anterior hasta que llega el nuevo), la ficha
    abierta tras pasar el puntero y el cara a cara con relevos.
