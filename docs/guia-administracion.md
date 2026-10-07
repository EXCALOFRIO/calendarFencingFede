# Guía de administración

Resumen práctico para quien administra la aplicación. Los detalles técnicos
están en `docs/tareas-programadas.md`, `docs/indexado-2026-10-05.md`,
`docs/rendimiento.md` y el runbook del lote (`W\lote8-runbook.md`).

`W` es `%USERPROFILE%\calendario-datos\calendario-trabajo`. La base de
producción es D1 `calendario-fie-fede-db` (binding `DB`) del Worker
`calendario-fie-fede`.

## 1. Tareas programadas

Todas las horas son UTC. Las franjas están en `triggers.crons` de
`wrangler.jsonc` y en `TAREAS_CRON` (`src/lib/cron/programado.ts`), que deben
coincidir (un test lo comprueba).

| UTC | Tarea |
|---|---|
| 03:00 | Calendario nacional y resultados de Skermo; enlaces de directo de Engarde |
| 03:30 | Temporada FIE, torneos futuros e inscritos |
| 04:00 | Circuito EFC (su dominio no responde ahora) |
| 04:30 | Calendarios de 11 federaciones autonómicas |
| 05:00 | Circulares de esgrima.es |
| 05:30 | Ranking nacional (con su propia cadencia) |
| 06:00 | Extracción de hasta 5 PDF nuevos al día |
| 06:45 | Fichas FIE de nuestros tiradores y ranking mundial |
| 07:00 | Envío de avisos (no consulta fuentes) |
| :20 de 00–02 y 08–23 | Resultados automáticos (si están activados) |

`/api/cron/sport` está obsoleto y sin franja: no activarlo junto con los
resultados automáticos. Para forzar una relectura:
`GET /api/cron/ingest/<fuente>?forzar=1` con `Authorization: Bearer` y el
secreto de cron, o desde el panel **Gestión** (siempre fuerza). Cada ejecución
queda en la tabla `ingest_run`.

## 2. Ingesta automática de resultados

Lleva a `sport_*` la clasificación, las poules y el cuadro de las pruebas
acabadas (FIE, Skermo, Engarde y PDF de la RFEE), con los mismos conversores
que el lote manual. Nunca pisa lo que cargó un lote manual ni une personas
por la duda.

### Ver su estado

- Panel **Gestión → Salud** (`/admin/salud`) y la tabla `ingest_run`.
- Unidades (cada prueba o PDF) y consumo del día:

```sql
SELECT clave, estado, detalle, intentos, datetime(proxima/1000,'unixepoch')
  FROM resultado_auto_unidad ORDER BY proxima;
SELECT * FROM resultado_auto_consumo WHERE dia = date('now');
```

Respuestas especiales del cron: `migracion_pendiente` (falta
`0017_resultados_automaticos.sql`; no escribe nada) y `ledger_bajo` (no queda
margen; no escribe y abre una revisión).

### Cola de revisión (`resultado_auto_revision`)

Lo que está en la cola **no** se escribió, salvo que `datos.escrito` sea
`true` (por ejemplo, un PDF parcial).

```sql
SELECT id, clave, motivo, datos, datetime(creada_en/1000,'unixepoch')
  FROM resultado_auto_revision WHERE estado = 'abierta' ORDER BY creada_en DESC;
```

| Motivo | Qué hacer |
|---|---|
| `ledger_bajo` | Ver la sección 5. No reintentar hasta tener margen. |
| `pdf_parcial` | Comprobar el PDF; si faltan asaltos, cargarlos en el próximo lote manual. |
| `pdf_no_atribuible` | El PDF no casa con ninguna prueba: identificarla a mano y cargarlo en un lote. |
| `pdf_sin_texto` | PDF escaneado: lectura manual o con IA en un lote. |
| `ia_no_valida` | La lectura de IA no pasó la validación; mirar los fallos en `datos` y decidir en un lote. |
| `errores_repetidos` | Mirar la fuente (caída, formato nuevo). Cuando esté bien, volver a encolar. |
| `conflicto`, `prueba_partida_por_lector_antiguo` | Revisión humana de esa prueba; nunca se limpia sola. |

Para cerrar un caso y para volver a leer una unidad en la siguiente pasada:

```sql
UPDATE resultado_auto_revision SET estado = 'resuelta', resuelta_en = unixepoch()*1000 WHERE id = ?;
UPDATE resultado_auto_unidad SET estado = 'pendiente', proxima = 0, intentos = 0 WHERE clave = ?;
```

Estas órdenes escriben en producción: ejecutarlas con
`npx wrangler d1 execute calendario-fie-fede-db --remote --command "..."`
solo cuando se haya decidido el caso.

### Topes

Son variables del Worker. Se pueden cambiar en el panel de Cloudflare sin
desplegar código, pero el siguiente despliegue las vuelve a fijar con los
valores de `wrangler.jsonc`: cualquier cambio hay que llevarlo también allí.

| Tope | Por defecto | Variable |
|---|---|---|
| Tiempo por pasada | 45 s | `RESULTADOS_AUTO_MAX_MS` |
| Peticiones por pasada | 40 | `RESULTADOS_AUTO_MAX_PETICIONES` |
| Filas por pasada / día | 1.500 / 6.000 | `RESULTADOS_AUTO_MAX_FILAS_PASADA`, `RESULTADOS_AUTO_MAX_FILAS_DIA` |
| Bytes de ledger por día | 48 MiB | `RESULTADOS_AUTO_MAX_BYTES_DIA` |
| Margen mínimo del ledger | 512 MiB | `RESULTADOS_AUTO_MARGEN_MIN_BYTES` |
| Unidades por pasada | 6 | `RESULTADOS_AUTO_MAX_UNIDADES` |
| IA por día | 4 llamadas, 6.000 neuronas | `RESULTADOS_AUTO_IA_MAX_LLAMADAS_DIA`, `RESULTADOS_AUTO_IA_MAX_NEURONAS_DIA` |

### Pausarla unas horas (sin desplegar)

Reservar el lease global de escritura: el cron lo encuentra ocupado, responde
`ocupado` y no escribe nada. Caduca solo al cabo de las horas pedidas (máximo 12).

```powershell
node node_modules/tsx/dist/cli.mjs scripts/indexado/pausa-ingesta.ts --reservar --horas 6
node node_modules/tsx/dist/cli.mjs scripts/indexado/pausa-ingesta.ts --estado
node node_modules/tsx/dist/cli.mjs scripts/indexado/pausa-ingesta.ts --liberar
```

Mientras dure tampoco se pueden hacer uniones de personas desde el panel ni
aplicar rankings o relevos (todos necesitan el mismo lease). Seguir a
deportistas y el resto de la aplicación funcionan con normalidad.

### Apagarla

Poner `RESULTADOS_AUTO_ENABLED` a `"false"` (o quitarla). Solo la IA:
`RESULTADOS_AUTO_IA_ENABLED = "false"`. Para que ni se dispare, quitar
`"20 0-2,8-23 * * *"` de `triggers.crons` (esto sí exige desplegar).

## 3. Lote manual de datos

Resumen de `W\lote8-runbook.md` y `docs/indexado-2026-10-05.md`. Todo se
prepara sobre una copia SQLite local; producción solo se toca en el paso 5.

1. **Antes de nada**: pausar la ingesta automática
   (`pausa-ingesta.ts --reservar`, sección 2) para que nadie escriba en
   `sport_*` mientras se prepara el lote. Tomar y apuntar un marcador de Time
   Travel (`npx wrangler d1 time-travel info calendario-fie-fede-db --env-file NUL`)
   y añadirlo a la lista de `docs/indexado-2026-10-05.md` § Recuperación.
   Comprobar que la base del diff es la copia exacta de producción tras el
   lote anterior (por ejemplo `nuevoN.sqlite`). Si la ingesta automática ha
   escrito desde ese lote, la copia ya no es exacta y `--verificar-base`
   fallará: hay que traer antes esas filas de producción a la copia.
2. **Cargar los hechos** nuevos en la copia (`cargar-hechos.ts`), las
   correcciones de equipos y la reparación de caracteres
   (`reparar-caracteres.ts`, primero ensayo y luego `--aplicar`).
3. **Unificar personas**: separar uniones no permitidas
   (`separar-uniones.ts`), y repetir `unificar-personas.ts` y
   `vincular-asaltos.ts` hasta que no cambien (unos 2 ciclos).
4. **Fechas de PDF y perfiles**: `corregir-fechas-pdf.ts`, luego
   `perfiles-nacional.ts` y `aplicar-perfiles.ts --sql-salida`.
5. **Producción**, con `scripts/indexado/sincronizar-d1.ts`, en este orden:
   - `--diff --chunk-mb 5` (trozos de 5 MB; los de 20 MB fallan);
   - `--comprobar`: reproduce la copia con las guardas activas;
   - `--verificar-base`: confirma que producción es igual a la base. **Si
     falla, parar**: alguien ha escrito desde el lote anterior;
   - `pausa-ingesta.ts --liberar` justo antes de aplicar (cada trozo toma el
     lease por su cuenta). Hacerlo pasado el minuto :20, cuando ya ha corrido
     la pasada del cron, para que la aplicación acabe antes de la siguiente;
   - `--aplicar --confirmar <id>`: atómico por trozo, con el lease deportivo y
     cargo en el ledger. Si un trozo falla, se vuelve a lanzar y continúa;
   - `--verificar-final`: confirma que producción es igual a la copia nueva.
6. Aplicar los SQL de perfiles (`d1 execute --remote --file`) y regenerar el
   índice de búsqueda si toca. La copia nueva pasa a ser la base del siguiente
   lote.

Nunca se desactivan las guardas ni los triggers del ledger. Si el ledger no
deja margen suficiente para el lote, no se aplica; la única forma de bajarlo es
el recalibrado de la sección 5, nunca a mano.

## 4. Restaurar

- **Time Travel** (lo normal; últimos 30 días):
  `npx wrangler d1 time-travel restore calendario-fie-fede-db --bookmark=<marcador> --env-file NUL`.
  Los marcadores están en `docs/indexado-2026-10-05.md` § Recuperación.
  Ojo: deshace **todo** lo escrito después, incluidos usuarios, seguidos y
  calendario. Tomar antes un marcador del momento actual para poder volver.
- **Copia local** (`W\backup\produccion-2026-10-07.zip`, export SQL completo
  tras el lote 9, 1,73 GB): para cuando Time Travel ya no llegue. Descomprimir
  y cargar en una base D1 **nueva**, comprobarla y solo entonces cambiar el
  binding `DB`. Todo lo posterior al 7 de octubre de 2026 se pierde y hay que
  volver a cargarlo con lotes.

## 5. Presupuesto de escritura (ledger) y mantenimiento de D1

**Qué es.** Un contador propio, `sport_capacity_ledger.accounted_bytes`, que
suben los triggers en cada escritura sobre `sport_*`: 1.024 bytes por fila más
4 veces los bytes que cambian, y 16.384 por lote. Borrar también suma. El
trigger `sport_ledger_update` impide que baje; sólo la migración 0019 lo baja
(ver más abajo). El tope es `D1_STORAGE_BUDGET_BYTES` = 8 GiB, una asignación
propia por debajo del límite de 10 GB por base de D1 (no es un tope de gasto).
Es también el máximo del `CHECK` de `sport_write_context`, así que no se puede
subir sin otra migración. La ingesta automática se para cuando quedan
512 MiB.

**Cómo se mira.**

```powershell
node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --json --env-file NUL --file drizzle-d1/manual/0019_recalibrar_libro.comprobar.sql
```

Devuelve el libro, si está bloqueado, si hay un contexto o un lease vigente y
el texto del trigger. `meta.size_after` de la respuesta es el tamaño real de la
base en ese momento (lo mismo que `database_size` de
`wrangler d1 info calendario-fie-fede-db --json`).

Valores de referencia del 7 de octubre de 2026: libro 6.450.944.980 B (75,1 %
de 8 GiB) frente a 2.102.996.992 B reales. El libro marca unas tres veces el
tamaño real porque cuenta escrituras (carga inicial, recargas y reprocesos),
no ocupación. Ese valor queda anotado aquí porque recalibrar lo pierde.

### Recalibrar el libro (`drizzle-d1/0019_recalibrar_libro.sql`)

La migración quita `sport_ledger_update`, baja el libro al valor que lleva
escrito y vuelve a crear el trigger con el texto exacto de
`CAPACITY_DEFINITIONS` (`src/lib/ingest/sport-incremental/capacity.ts`), que
es lo que compara `verificarEsquemaD1`. Todo va en una sola importación
atómica: si falla una comprobación, no cambia nada. Aborta si:

- hay un contexto o un cargo abiertos (`recalibrado_contexto_abierto`);
- hay un lease vigente (`recalibrado_lease_vigente`), incluida la pausa de
  `pausa-ingesta.ts`;
- el libro está bloqueado (`recalibrado_libro_bloqueado`);
- la medida ha caducado (`recalibrado_medida_caducada`). El fichero del
  repositorio lleva `valido_hasta_ms = 0`, así que tal cual nunca baja el libro;
- el valor queda por debajo del tamaño medido más un 10 %
  (`recalibrado_margen_minimo`) o por encima de la parada (8 GiB − 512 MiB).

Nunca sube el libro. Si ya está por debajo del valor, no hace nada: sólo vuelve
a crear el trigger con el mismo texto. Por eso se puede encadenar con las demás
migraciones en una base nueva.

Pasos:

1. Fuera de la franja 03:00–07:59 UTC y pasado el minuto :20 (cuando ya ha
   corrido la pasada de resultados). Si la ingesta está pausada con
   `pausa-ingesta.ts --reservar`, liberarla (`--liberar`).
2. Tomar un marcador de Time Travel y apuntarlo
   (`node node_modules/wrangler/bin/wrangler.js d1 time-travel info calendario-fie-fede-db --json --env-file NUL`).
3. Ejecutar la comprobación de arriba. Debe dar `abiertos = 0`,
   `lease_vigente = 0` y `bloqueado = 0`. Apuntar `libro_bytes` (el valor
   anterior) y `meta.size_after` (el tamaño medido).
4. Escribir los literales con el tamaño recién medido:

   ```powershell
   node node_modules/tsx/dist/cli.mjs scripts/indexado/recalibrar-libro.ts --medido <size_after> --escribir
   ```

   Por defecto el libro es el tamaño medido más un 15 %, redondeado hacia
   arriba a 64 MiB. Con 2.102.996.992 B da 2.483.027.968 B (2,31 GiB, el
   28,9 % de 8 GiB). Con `--libro <bytes>` se fija otro valor, por ejemplo
   2.415.919.104 (2,25 GiB), siempre que supere el tamaño medido en un 10 % como
   mínimo. La medida vale 60 minutos (`--minutos` para cambiarlo).
5. Aplicar:
   `node node_modules/wrangler/bin/wrangler.js d1 execute calendario-fie-fede-db --remote --env-file NUL --file drizzle-d1/0019_recalibrar_libro.sql`.
6. Repetir la comprobación: `libro_bytes` es el valor nuevo y mayor que
   `meta.size_after`, `guardas = 0`, `triggers_ledger = 3`, y el texto del
   trigger es el de `CAPACITY_DEFINITIONS.sport_ledger_update`. La siguiente
   pasada de `/api/cron/resultados` no debe responder `esquema_deportivo`.
7. Guardar en el repositorio el fichero con los literales que se aplicaron.

Por qué basta con un 15 %: antes de cada lote, `sport_context_reserve` sube el
libro a `max(libro, tamaño medido) + 16.384`, y cada fila cobra al menos lo que
ocupa. El margen sólo cubre lo que crece la base sin pasar por el libro (tablas
que no son `sport_*`, como el índice de Explorar o los avisos) entre la medida y
el siguiente lote. Tras cada lote, `dbConSportLease` y `sincronizar-d1.ts`
bloquean el libro para siempre si el tamaño real lo supera. Con unos 3 bytes de
libro por byte real, la ingesta se pararía cuando D1 rondase los 4 GB reales,
todavía por debajo de los 5 GB incluidos en el plan y lejos de los 10 GB.

Deshacer: `drizzle-d1/manual/0019_recalibrar_libro.deshacer.sql` (poner antes el
valor anotado en el paso 3; deja `max(actual, anterior)` con el mismo trigger)
o Time Travel al marcador del paso 2, que deshace también lo escrito después.

### Índices duplicados (`drizzle-d1/0020_quitar_indices_duplicados.sql`)

Quita `sport_bout_competition_idx` y `sport_external_id_person_idx`. Cada uno es
un prefijo de la clave única de su tabla (`sport_bout_key` y
`sport_external_id_person_key`). Ya no están declarados en
`src/db/d1/schema.ts` ni en `src/db/schema/sport.ts`. `0000_aplicacion.sql` los
sigue creando; 0020 los quita después. Es DDL: no cobra en el libro ni toca las
guardas. En la copia de producción liberó 24.720 páginas (101 MB), que D1
reutiliza para lo que se escriba después.

`EXPLAIN QUERY PLAN` en la copia (antes → después), todas siguen siendo
`SEARCH`, ninguna `SCAN`:

| Consulta | Antes | Después |
|---|---|---|
| `ediciones.ts` (asaltos por prueba) | COVERING `sport_bout_competition_idx` 3,0 ms | COVERING `sport_bout_key` 1,7 ms |
| `ediciones-asaltos.ts` (asaltos de una prueba) | `sport_bout_key` 13,7 ms | igual, 14,1 ms |
| `ediciones-asaltos.ts` (conteo por fase de un grupo) | COVERING `sport_bout_competition_idx` 1,0 ms | COVERING `sport_bout_key` + B-tree temporal 2,7 ms |
| `complementarios-db.ts` (conteo por fase sin fuentes complementarias) | `sport_bout_competition_idx` (lee filas) 221 ms | COVERING `sport_bout_key` 3,9 ms |
| `resultados-auto/cargar.ts`, `backfill/pdf-db.ts` | `sport_bout_key` | sin cambios |
| `sport_external_id` por persona (perfil, búsqueda, ranking, inscritos) | `sport_external_id_person_key` | sin cambios (el índice quitado no lo elegía nadie) |

Las claves ajenas que apuntan a `sport_competition` y `sport_person` siguen
teniendo un índice cuya primera columna es la suya. Las copias locales
(`nuevoNN.sqlite`) también deben llevar 0020 (tarda menos de un segundo).
`sincronizar-d1.ts` sólo compara índices únicos, así que no lo exige. Para
comprobar en remoto: `drizzle-d1/manual/0020_quitar_indices_duplicados.comprobar.sql`.
Para deshacer: `drizzle-d1/manual/0020_quitar_indices_duplicados.deshacer.sql`.

Orden: 0019 y luego 0020. 0020 no cambia el libro, y el tamaño real sólo puede
bajar, así que el libro calculado antes sigue siendo válido.

### Retención automática de registros de ingesta

Cada día, a las 07:00 UTC, `/api/cron/notify` (cuando ya han acabado las
ingestas) llama a `limpiarRegistrosIngesta` (`src/lib/ingest/retencion.ts`):

- `ingest_quarantine` resuelta hace más de 30 días. Las pendientes no se tocan
  nunca. Las resueltas antiguas dejan de verse en `/admin/cuarentena` y ya no se
  pueden reabrir.
- `ingest_run` de hace más de 90 días sin ninguna cuarentena, para que el
  `ON DELETE CASCADE` no arrastre nada. Se conservan la última ejecución de
  cada fuente y la última `ok` con elementos, que usan las alertas y la
  cadencia del ranking.

Como máximo borra 500 filas por tabla y pasada; lo que quede se borra al día
siguiente. No toca `sport_*` ni el libro. El resultado sale en la respuesta del
cron como `registrosIngestaEliminados` (`null` si falló; un fallo no impide los
avisos). `cron_execution` no se limpia: es pequeña y sirve para no repetir
franjas.

### `PRAGMA optimize` (no automatizado)

D1 lo admite. Ejecuta `ANALYZE` con un límite de tiempo y crea `sqlite_stat1`,
con lo que el planificador empieza a usar estadísticas en todas las consultas.
No se lanza desde `sincronizar-d1.ts` por tres motivos:

- cambia los planes de toda la aplicación de golpe, y las copias locales con las
  que se miden (`docs/rendimiento.md`) no tienen estadísticas;
- en la copia de producción, `ANALYZE` tardó 23 s;
- con los planes actuales todas las consultas medidas ya usan índice.

En la copia, con estadísticas sólo cambió el plan de 1 de las 13 consultas, y a
mejor. Si se quiere probar, hacerlo una sola vez y a mano, tras 0020:

1. Comprobar primero si ya existe:
   `SELECT name FROM sqlite_master WHERE name LIKE 'sqlite_stat%'`.
2. Tomar un marcador y lanzar
   `wrangler d1 execute calendario-fie-fede-db --remote --env-file NUL --command "PRAGMA optimize"`.
3. Repetir los `EXPLAIN QUERY PLAN` de `docs/rendimiento.md` y de
   `drizzle-d1/manual/0020_quitar_indices_duplicados.comprobar.sql`.

Para volver atrás, Time Travel al marcador.

### R2: caducidad de los snapshots de depuración

`runner.ts` guarda el HTML de cada ingesta en `ingest/<fuente>/<día>/` del cubo
`calendario-esgrima-archivos`. Nadie lo lee (`ingest_run.snapshot_url` está a
NULL). Recomendación, **no aplicada**: una regla de caducidad de 14 días.

```powershell
node node_modules/wrangler/bin/wrangler.js r2 bucket lifecycle add calendario-esgrima-archivos ingest-snapshots-14d ingest/ --expire-days 14
node node_modules/wrangler/bin/wrangler.js r2 bucket lifecycle list calendario-esgrima-archivos
```

El prefijo `ingest/` sólo tiene esos snapshots (hoy, sólo de `skermo_rfee`). Para
limitarlo a esa fuente, usar `ingest/skermo_rfee/`. El cubo no tiene versionado:
lo que caduca no se recupera. La alternativa es no guardarlos:
`INGEST_SNAPSHOT_HTML = "false"`.

### Cuando el libro se acerque a 8 GiB

1. Con menos de ~1 GiB de margen, no hacer más lotes grandes; dejar sólo la
   ingesta automática (que se para sola a 512 MiB).
2. Medir el tamaño real. Si sigue lejos de 10 GB, recalibrar con el mismo
   procedimiento de 0019 (poniendo los literales de nuevo).
3. Si el tamaño real se acerca a la asignación, no hay recalibrado que valga:
   hay que liberar datos o planificar otra base.

## 6. Secretos y configuración

Solo nombres. Los valores están en Cloudflare y en `W\secretos`; nunca en Git,
capturas ni URLs.

- **Secretos**: `CRON_SECRET`, `NEON_AUTH_URL`, `NEON_AUTH_COOKIE_SECRET`,
  `CREDENTIAL_ENCRYPTION_KEY`, `RESEND_API_KEY`, `AI_API_KEY`,
  `VAPID_PRIVATE_KEY`,
  `ACCESO_QA_CONCESION` (solo puntual, se revoca tras la QA),
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (solo para desplegar).
- **Configuración**: `NEXT_PUBLIC_APP_URL` (se fija al compilar, no al
  ejecutar), `D1_STORAGE_BUDGET_BYTES`, `AUTH_OTP_DAILY_LIMIT`,
  `RESEND_DAILY_LIMIT`, `EMAIL_FROM`, `ADMIN_ALERT_EMAIL`,
  `INGEST_USER_AGENT`, `INGEST_SNAPSHOT_HTML`,
  `INGEST_RANKING_LICENSE_BUDGET`, `SKERMO_BASE_URL`,
  `SKERMO_SUBMIT_ENABLED`, `SKERMO_SUBMIT_DRY_RUN`, `AI_PROVIDER`,
  `AI_MODEL`, `AI_PAID_TIER`, `AI_EXTRACTION_ENABLED`,
  `SPORT_INCREMENTAL_ENABLED`, `RESULTADOS_AUTO_*`, `VAPID_PUBLIC_KEY`
  (pública, va en `vars`) y `VAPID_SUBJECT` (opcional; si falta se usa
  `NEXT_PUBLIC_APP_URL`).
- **Bindings** (`wrangler.jsonc`): `DB`, `ARCHIVOS` (R2), `CACHE_DATOS`,
  `AI`, `IMAGES`, `ASSETS` y los limitadores `LIMITE_*`.
- Solo para migración local, nunca en el Worker: `NEON_SOURCE_DATABASE_URL`.

## 7. Dominio propio (recomendación)

Hoy se sirve desde `calendario-fie-fede.excalofrio.workers.dev`. Se recomienda
un dominio propio en Cloudflare cuanto antes, porque:

- **Correo**: Resend solo envía a terceros desde un dominio verificado.
- **Instalación y avisos**: la app instalada y sus suscripciones push van
  ligadas al dominio. Cambiarlo más tarde obliga a reinstalar y reactivar los
  avisos en cada móvil; cuanto antes, menos usuarios afectados.
- **Seguridad y rendimiento**: `workers.dev` no es una zona, así que no admite
  reglas de WAF, caché de zona ni transformación de imágenes por
  `/cdn-cgi/image`.
- **Confianza**: un dominio reconocible para familias y federación.

Al cambiarlo hay que recompilar con el nuevo `NEXT_PUBLIC_APP_URL` y
actualizar `INGEST_USER_AGENT` y `EMAIL_FROM`.

## 8. Revisión manual de personas dudosas

El sistema nunca une dos personas por la duda: las deja propuestas. Dónde
mirar:

- **Gestión → Emparejar** (`/admin/emparejar`): propuestas de unión y de
  vínculo cuenta–ficha.
- **Gestión → Cuarentena** (`/admin/cuarentena`): datos retenidos para
  revisión.
- Tabla `sport_link_candidate` con estado `PROPUESTO` (las de la ingesta
  automática llevan `source = 'resultados_auto'`).
- Informes del lote en `W\lote8-informes`, `W\lote9-informes`,
  `W\lote10-informes` y `W\auditoria-cruces`, y el informe de uniones
  (`scripts/indexado/informe-uniones.ts`, solo lectura).

Casos típicos que piden ojo humano (ver `W\lote8-runbook.md` § 10): apellidos
en orden cruzado (`ROMERO ORTIN` / `ORTIN ROMERO`), hermanos o primos con
nombres parecidos, un apellido en la FIE frente a tres palabras en Skermo, y
licencias EFC sin año de nacimiento. Ante la duda, no unir: separar una unión
mala cuesta más que dejar dos fichas.
