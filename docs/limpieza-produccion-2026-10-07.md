# Auditoría de limpieza de producción (2026-10-07)

Auditoría de sólo lectura de D1 (`calendario-fie-fede-db`), R2
(`calendario-esgrima-archivos`) y KV (`CACHE_DATOS`). No se ha borrado ni
escrito nada. Los SQL propuestos están en
`C:\Users\alejandro.c.ramirez\calendario-datos\calendario-trabajo\limpieza\plan.sql`,
separados por bloques con su riesgo y cómo deshacerlos.

Marcador de Time Travel tomado durante la auditoría:
`00000098-00000000-000050fd-9ce189fec1672f881391e14d08e196d7`.

## Conclusión

La migración desde Neon no dejó basura apreciable. No hay tablas antiguas
con datos que nadie use: las 83 tablas tienen código de producción que las
lee o escribe, salvo `extraction_proposal`, que está vacía. Casi todo el
espacio son datos deportivos reales: `sport_bout` ocupa cerca de dos
tercios de la base y `sport_result` otro 15 %.

Lo que se puede borrar sin perder nada libera muy poco, unos 3 MB entre D1
y R2. La única reducción notable, unos 100 MB, es quitar un índice
duplicado de `sport_bout`, y eso exige un cambio de código. El 75 % que
marca el libro de capacidad no mide la ocupación: es un contador
conservador de escrituras que nunca baja. La ocupación real de D1 es el
21 % de 10 GB.

## Resumen

| Propuesta | Qué se borraría | Libera | Riesgo | Deshacer |
|---|---|---:|---|---|
| D1 · Bloque 1 | Cuarentena ya resuelta de más de 30 días (`ingest_quarantine`) | 0 hoy; ≈1,1 MB si se usan 7 días | Bajo | Time Travel |
| D1 · Bloque 2 | `ingest_run` de más de 90 días, sin cuarentena pendiente y sin tocar la última de cada fuente | 0 hoy (todas son de después del 25/9) | Bajo | Time Travel |
| D1 · Bloque 3 | Índice duplicado `sport_bout_competition_idx` (opcional también `sport_external_id_person_idx`) | ≈100 MB (±20 %) + ≈3 MB | Medio; requiere cambio de esquema en `src/` | `CREATE INDEX` |
| D1 · Bloque 4 | `DROP TABLE extraction_proposal` (vacía) | ≈8 KB | No recomendado sin cambio de código | Time Travel |
| D1 · Bloque 5 | Nada: recalibra el libro de capacidad a 2,25 GiB | 0 bytes; el libro pasa del 75,1 % al 28,1 % | Alto | Time Travel o el mismo patrón a la inversa |
| R2-A | 18 snapshots de depuración `ingest/skermo_rfee/` (se conservan los 5 últimos), o una regla de ciclo de vida de 14 días | 2,08 MB | Bajo, pero irreversible | No se puede (R2 sin versionado) |
| R2-B/C/D | `historico-interno/`, `fotos/`, `convocatorias/` | — | No se tocan | — |
| KV | Nada: 216 claves, todas con TTL | — | — | — |

## Porcentajes de ocupación

| Recurso | Ahora | Tras bloques 1, 2 y R2-A | Tras añadir el bloque 3 |
|---|---:|---:|---:|
| D1 (2.102.996.992 B frente a 10 GB) | **21,03 %** | 21,02 % | ≈ **20,0 %** |
| D1 frente a los 5 GB incluidos en el plan de pago | 42,1 % | 42,0 % | ≈ 40 % |
| R2 (501,8 MB frente a 10 GB gratuitos) | **5,02 %** | **5,00 %** | 5,00 % |
| KV (216 claves frente a 1 GB) | < 1 % (ver §4) | sin cambio | sin cambio |
| Libro de capacidad (6.450.944.980 B frente a 8 GiB) | **75,1 %** | 75,1 % (no baja) | 75,1 % (no baja) |
| Libro tras recalibrar (bloque 5) | — | **28,1 %** | 28,1 % |

Notas:

- 10 GB se cuenta como 10⁹ × 10 bytes, la misma unidad que usa
  `wrangler d1 info`.
- D1 reaprovecha las páginas que deja libres un `DELETE`, pero no hay
  `VACUUM` en D1, así que `database_size` puede no bajar enseguida tras los
  bloques 1 y 2. Un `DROP INDEX` sí libera las páginas del índice.

## 1. Tablas de producción

Hay 83 tablas de la aplicación (contando `d1_migrations`), más `_cf_KV` (interna de Cloudflare) y
`sqlite_sequence`, y 100 triggers (`sport_fence_*` y `sport_charge_*` en 15 tablas `sport_*`, más `sport_charge_claim/update/delete`,
`sport_context_*`, `sport_ledger_*`). D1 no permite `dbstat` ni
`pragma_table_info` como tabla. Por eso el tamaño se estima sumando
`length(CAST(col AS BLOB))` de todas las columnas, más las columnas de cada
índice con 8 bytes de rowid. La suma de todas las tablas da 1,614 GB
(0,925 GB de datos y 0,689 GB de índices). El tamaño real es 2,103 GB, así
que las páginas y cabeceras de SQLite añaden alrededor de un 30 %.

El uso en código se ha comprobado buscando, en `src/**`, `worker/**`,
`scripts/**` y `drizzle-d1/**`, el nombre SQL de cada tabla y su
identificador Drizzle de `src/db/d1/schema.ts` dentro de
`.insert/.update/.delete/.from/join`. Todas las tablas salvo
`extraction_proposal` tienen escrituras y lecturas en código de producción
(`src/`), no sólo en scripts. Los datos más antiguos son del 2026-09-25 (la
carga inicial) y la base se creó el 2026-10-03. La columna «Última
escritura» sólo se rellena para los logs, que son donde importa.

| Tabla | Filas | Tamaño estimado (datos + índices) | Última escritura | Uso en código | Clasificación |
|---|---:|---:|---|---|---|
| `sport_bout` | 1.561.004 | 1079,0 MB | – | lee y escribe | en uso · guarda sport_* |
| `sport_result` | 683.988 | 310,1 MB | – | lee y escribe | en uso · guarda sport_* |
| `sport_ranking_entry` | 318.070 | 102,8 MB | – | lee y escribe | en uso · guarda sport_* |
| `sport_external_id` | 51.984 | 21,9 MB | – | lee y escribe | en uso · guarda sport_* |
| `sport_import_coverage` | 41.036 | 20,2 MB | – | lee y escribe | histórico/log que crece · guarda sport_* |
| `sport_person_alias` | 70.815 | 15,1 MB | – | lee y escribe | en uso · guarda sport_* |
| `sport_person` | 70.808 | 10,5 MB | – | lee y escribe | en uso · guarda sport_* |
| `perfil_deportista` | 63.313 | 9,9 MB | – | lee y escribe | en uso |
| `explorar_persona` | 63.313 | 7,4 MB | – | lee y escribe | en uso |
| `sport_link_candidate` | 16.551 | 6,0 MB | – | lee y escribe | histórico/log que crece · guarda sport_* |
| `explorar_variante` | 383.639 | 5,4 MB | – | lee y escribe | en uso |
| `sport_competition` | 13.229 | 4,4 MB | – | lee y escribe | en uso · guarda sport_* |
| `fie_clasificacion` | 11.654 | 4,3 MB | – | lee y escribe | en uso |
| `sport_relay` | 9236 | 3,5 MB | – | lee y escribe | en uso · guarda sport_* |
| `sport_edition` | 10.986 | 2,7 MB | – | lee y escribe | en uso · guarda sport_* |
| `extraccion_propuesta` | 2544 | 2,3 MB | – | lee y escribe | histórico/log que crece |
| `explorar_token` | 149.649 | 1,6 MB | – | lee y escribe | en uso |
| `ingest_quarantine` | 388 | 1,4 MB | 2026-10-03 | lee y escribe | histórico/log que crece |
| `competition_registration` | 2992 | 1,0 MB | – | lee y escribe | en uso |
| `extraccion_documento` | 293 | 822 KB | – | lee y escribe | histórico/log que crece |
| `sport_ranking_publication` | 2367 | 697 KB | – | lee y escribe | en uso · guarda sport_* |
| `official_ranking_entry` | 1382 | 545 KB | – | lee y escribe | en uso |
| `result` | 829 | 337 KB | – | lee y escribe | en uso |
| `event_competition` | 805 | 287 KB | – | lee y escribe | en uso |
| `sport_team_match` | 1029 | 278 KB | – | lee y escribe | en uso · guarda sport_* |
| `ingest_run` | 202 | 272 KB | 2026-10-07 | lee y escribe | histórico/log que crece |
| `event` | 496 | 251 KB | – | lee y escribe | en uso |
| `event_deadline` | 590 | 217 KB | – | lee y escribe | en uso |
| `fie_world_ranking` | 730 | 165 KB | – | lee y escribe | en uso |
| `fie_fencer` | 344 | 115 KB | – | lee y escribe | en uso |
| `official_document` | 279 | 94 KB | – | lee y escribe | en uso |
| `documento_vigencia` | 279 | 78 KB | – | lee y escribe | en uso |
| `event_document` | 185 | 76 KB | – | lee y escribe | en uso |
| `event_link` | 137 | 50 KB | – | lee y escribe | en uso |
| `sport_registration_ref` | 328 | 36 KB | – | lee y escribe | en uso |
| `live_source` | 47 | 20 KB | – | lee y escribe | en uso |
| `sport_competition_combined` | 85 | 18 KB | – | lee y escribe | en uso · guarda sport_* |
| `notificacion` | 19 | 12 KB | – | lee y escribe | histórico/log que crece |
| `fie_clasificacion_lectura` | 41 | 5 KB | 2026-10-07 | lee y escribe | histórico/log que crece |
| `notification` | 3 | 3 KB | – | lee y escribe | histórico/log que crece |
| `deadline_rule` | 9 | 2 KB | – | lee y escribe | en uso |
| `cron_execution` | 33 | 2 KB | 2026-10-07 | escribe | histórico/log que crece |
| `user_profile` | 4 | 1 KB | – | lee y escribe | en uso |
| `season_category` | 8 | 1 KB | – | lee y escribe | en uso |
| `athlete` | 2 | 1 KB | – | lee y escribe | en uso |
| `refresco_programado` | 24 | 635 B | – | lee y escribe | en uso |
| `sport_favorite` | 2 | 372 B | – | lee y escribe | en uso |
| `club` | 5 | 317 B | – | lee y escribe | en uso |
| `cloudflare_data_migration` | 1 | 222 B | – | lee y escribe | histórico/log que crece |
| `auth_throttle` | 1 | 112 B | – | lee y escribe | histórico/log que crece |
| `athlete_weapon` | 2 | 88 B | – | lee y escribe | en uso |
| `season` | 1 | 83 B | – | lee y escribe | en uso |
| `cache_epoch` | 3 | 70 B | – | lee y escribe | en uso |
| `sport_write_lease` | 1 | 58 B | – | lee y escribe | en uso |
| `profile_weapon` | 1 | 43 B | – | lee y escribe | en uso |
| `notificacion_cursor` | 1 | 35 B | – | lee y escribe | en uso |
| `explorar_indice_estado` | 1 | 30 B | – | lee y escribe | en uso |
| `sport_capacity_ledger` | 1 | 17 B | – | lee y escribe | en uso |
| `athlete_link_request` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |
| `auth_otp_challenge` | 0 | 0 | – | lee y escribe | histórico/log que crece |
| `call_up` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |
| `call_up_athlete` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |
| `club_skermo_settings` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |
| `config_change_log` | 0 | 0 | – | lee y escribe | histórico/log que crece |
| `d1_migrations` | 0 | 0 | – | – | interna D1 (0 filas; la app no usa wrangler migrations) |
| `entry` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |
| `entry_event_log` | 0 | 0 | – | escribe | histórico/log que crece |
| `extraction_proposal` | 0 | 0 | – | sólo esquema | legado sin uso (0 filas; ningún código de producción) |
| `notificacion_evento` | 0 | 0 | – | lee y escribe | histórico/log que crece |
| `notificacion_lectura` | 0 | 0 | – | lee y escribe | histórico/log que crece |
| `notificacion_preferencia` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |
| `notificacion_suscripcion` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |
| `ranking_point` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |
| `ranking_rule` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |
| `ranking_snapshot` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |
| `resultado_auto_consumo` | 0 | 0 | – | lee y escribe | histórico/log que crece |
| `resultado_auto_evento` | 0 | 0 | – | lee y escribe | histórico/log que crece |
| `resultado_auto_revision` | 0 | 0 | – | lee y escribe | histórico/log que crece |
| `resultado_auto_unidad` | 0 | 0 | – | lee y escribe | histórico/log que crece |
| `sport_incremental_task` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) · guarda sport_* |
| `sport_write_charge` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |
| `sport_write_context` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |
| `sqlite_sequence` | 0 | – | – | – | interna SQLite |
| `submission` | 0 | 0 | – | lee y escribe | en uso (función sin datos aún) |

### Detalle de los históricos

| Tabla | Situación | Retención razonable |
|---|---|---|
| `ingest_run` | 202 filas, 2026-09-25 → 2026-10-07; `snapshot_url` a NULL en todas | 90 días (bloque 2); hoy no borra nada |
| `ingest_quarantine` | 388 filas (380 resueltas, 8 pendientes), 1,4 MB, casi todo en `raw_payload` | 30 días para las resueltas (bloque 1). Las resueltas se ven en `/admin/cuarentena` y se pueden reabrir: borrarlas quita ese rastro |
| `extraccion_propuesta` | 2.544 filas, **todas en estado `pendiente`** (≈2,3 MB) | Ninguna: no hay descartadas que borrar. Son la cola de revisión |
| `extraccion_documento` | 293 filas (257 ok, 26 bloqueadas por datos personales, 6 error, 4 sin texto) | Ninguna: la app usa el hash para no repetir extracciones de IA |
| `cron_execution` | 34 filas desde el 2026-10-05 | Pequeña; vigilar más adelante |
| `notificacion*`, `resultado_auto_*` | Vacías o casi vacías (19 notificaciones) | — |
| `sport_link_candidate` | 16.551 filas (16.096 CONFIRMADO, 432 PROPUESTO, 23 RECHAZADO), 6 MB | No tocar: está bajo guarda `sport_*` y forma parte de la identidad |
| `sport_import_coverage` | 41.036 filas, 20 MB | No tocar: es el cursor de cobertura y está bajo guarda `sport_*` |
| `auth_throttle` | 1 fila caducada | Ya la limpia `src/lib/auth/mantenimiento.ts` |

### Tablas vacías

`call_up`, `call_up_athlete`, `club_skermo_settings`, `config_change_log`,
`entry`, `entry_event_log`, `ranking_point`, `ranking_rule`,
`ranking_snapshot`, `submission`, `athlete_link_request`,
`auth_otp_challenge`, `sport_incremental_task` y casi todas las
`notificacion_*` y `resultado_auto_*` están vacías, pero son funciones
vivas: convocatorias, inscripciones, ranking interno, avisos y resultados
automáticos. Ocupan unos 4 KB por tabla y por índice. Borrarlas no aporta
nada y rompería el código.

`d1_migrations` está vacía porque las migraciones de `drizzle-d1/` no se
aplicaron con `wrangler d1 migrations`. No se debe borrar: si alguien lanza
ese comando, la volvería a crear.

`cloudflare_data_migration` (1 fila) es el registro del traspaso desde Neon.
La lee `src/lib/migracion-cloudflare/importer.ts`; conviene conservarla
como trazabilidad.

### Índices

Hay 144 índices propios. Al comparar prefijos se encontraron dos
redundantes:

- `sport_bout_competition_idx (competition_id, phase, round_key)`: su
  primera columna ya la cubre `sport_bout_key (competition_id, source,
  phase, …)`. `EXPLAIN QUERY PLAN` muestra que hoy sólo lo elige
  `count(*) … WHERE competition_id = ?` (`ediciones.ts`), como índice
  cubriente, y la clave única sirve igual de cubriente. Las consultas de
  asaltos de una prueba (`ediciones-asaltos.ts`) ya usan `sport_bout_key`.
  Claves medidas: 81,3 MB; con páginas, unos 100 MB.
- `sport_external_id_person_idx (person_id)`: es prefijo de
  `sport_external_id_person_key`. Unos 3 MB.

`DROP INDEX` es una orden DDL: no dispara los triggers de guarda ni de
cobro, no cambia el libro y `verificarEsquemaD1` no comprueba índices. Aun
así, ambos índices están declarados en `src/db/d1/schema.ts` y
`src/db/schema/sport.ts`. Hay que quitarlos allí y crear una migración
propia, para que el esquema declarado no se separe del real, y antes probar
los planes de consulta en una copia (`nuevoNN`). Ese cambio queda fuera de
esta auditoría.

No se analizaron uno a uno los índices de las tablas pequeñas: aunque
alguno sobrara, liberaría kilobytes.

## 2. Propuesta de limpieza en D1

El SQL exacto está en `plan.sql`. Este es el orden recomendado:

1. **Bloque 0 (lectura).** Confirmar que no hay contexto ni cargo abiertos
   y que no hay ningún lease vigente. Durante la auditoría había un lease
   vigente hasta las 18:33 UTC: la ingesta estaba en marcha.
2. **Bloques 1 y 2.** Retención de logs. Hoy no liberan casi nada, pero
   dejan fijada la política para el futuro. Se pueden convertir en un paso
   del cron de mantenimiento (`src/lib/auth/mantenimiento.ts` ya hace algo
   parecido con `auth_*`). Ojo: `ingest_quarantine.ingest_run_id` tiene
   `ON DELETE CASCADE`. El bloque 2 excluye las ejecuciones con cuarentena
   pendiente.
3. **Bloque 3.** Quitar el índice duplicado de `sport_bout`, sólo junto con
   el cambio de esquema en el repositorio.
4. **Bloque 4.** No hacerlo por separado: `extraction_proposal` sigue
   declarada en `src/db/d1/schema.ts`, en
   `src/lib/migracion-cloudflare/schema.ts` y en
   `drizzle-d1/serialization.json`.

No se propone ningún `DELETE` en tablas `sport_*`. Están protegidas por los
triggers de `0002_guardia_deportiva.sql`: sin un contexto de escritura
autorizado, cualquier escritura falla con `sport_write_lease_required`, y
con él cada borrado suma 1.024 bytes al libro en lugar de restar. Además no
hay filas obsoletas que borrar: las 432 candidatas `PROPUESTO` y las 23
`RECHAZADO` de `sport_link_candidate` son la cola de revisión de
identidades.

## 3. R2

`wrangler 4.140` no trae `r2 object list`. El listado se hizo con la API
REST de Cloudflare (`GET /accounts/…/r2/buckets/…/objects`, sólo lectura)
usando la sesión OAuth de wrangler, sin imprimir el token. `r2 bucket info`
coincide: 13.281 objetos y 502 MB.

| Prefijo | Objetos | Tamaño | Fechas | Uso en la app | Decisión |
|---|---:|---:|---|---|---|
| `historico-interno/v1/blobs/` | 11.724 | 489,62 MB | 2026-10-03 | Copia verificada por sha256 de las páginas y PDF de FIE y Skermo para reprocesar (`src/lib/ingest/archivo-r2.ts`, `archivo-campana-r2.ts`, `scripts/archivar-*-r2.ts`) | **Conservar** |
| `historico-interno/v1/manifiestos/fie` y `/rfee` | 5 + 2 | 9,23 MB | 2026-10-03 | Índice de los blobs | **Conservar** |
| `ingest/skermo_rfee/` | 23 | 2,71 MB | 2026-09-27 → 2026-10-07 | Snapshot HTML de depuración que escribe `runner.ts` con `storeIngestSnapshot`. Nadie lo lee y `ingest_run.snapshot_url` está a NULL | **Borrar los antiguos** (R2-A) |
| `fotos/fie/` | 1.527 | 0,22 MB | 2026-10-05 → 2026-10-07 | Caché de la dirección de la foto (`fotos/cache.ts`) | Conservar |
| `convocatorias/` | 0 | — | — | PDF con ACL (`/api/archivos/[...ruta]`) | No se tocan; hoy no hay ninguno |

- Se descargaron los 7 manifiestos (sólo lectura) y se cruzaron con los
  blobs: 11.723 de 11.724 están referenciados. El que no lo está ocupa
  menos de 1 KB. No merece la pena tocarlo.
- Propuesta R2-A: una regla de ciclo de vida
  `ingest-snapshots-14d` sobre `ingest/` con caducidad de 14 días, o el
  borrado manual de los 18 más antiguos conservando los 5 últimos (2,08 MB).
  Los comandos están en `plan.sql`. El cubo no tiene versionado: lo que se
  borra no se recupera. La alternativa de raíz es fijar
  `INGEST_SNAPSHOT_HTML=false`, que ya está contemplado en `storage.ts`.
- La única regla de ciclo de vida actual es la predeterminada, que aborta
  las subidas multiparte incompletas a los 7 días.

## 4. KV (`CACHE_DATOS`)

Hay 216 claves en 25 prefijos, todos con época `e1` y **todos con TTL**.
Las de calendario caducan el 2026-10-08 y el resto el 2026-10-14. No hay
claves sin caducidad ni prefijos que el código ya no use, así que no hay
basura: se renueva sola.

Por prefijo: `cara-a-cara-duelo` 32, `calendario-detalle` 30,
`calendario-inscritos` 30, `edicion-pantalla` 28, `perfil-cabecera` 19,
`calendario-podios` 12, `perfil-rendimiento` 8, `perfil-rivales` 8,
`perfil-curiosidades` 6, `perfil-europeo` 6, `ranking-efc-tabla` 4. Los
otros catorce prefijos (`ranking-*`, `buscar-destacados`,
`calendario-tramo-reciente`, `calendario-eventos`, `calendario-frescura`,
`cara-a-cara-elegir`, `temporada-actual`) tienen entre 2 y 3 claves cada
uno.

El tamaño en bytes no se pudo medir sin leer los valores, y eso estaba
prohibido. GraphQL (`kvStorageAdaptiveGroups`) aún no devuelve datos para
este namespace. Con 216 claves de caché JSON, la ocupación está muy por
debajo del 1 % de 1 GB.

## 5. El libro de capacidad frente al tamaño real

| Medida | Valor |
|---|---:|
| `sport_capacity_ledger.accounted_bytes` | 6.450.944.980 B (6,01 GiB) |
| Asignación (`CAPACITY_MAX_BUDGET_BYTES`, `D1_STORAGE_BUDGET_BYTES`) | 8.589.934.592 B (8 GiB) |
| Libro / asignación | **75,1 %** |
| Tamaño real de D1 (`wrangler d1 info`) | 2.102.996.992 B (1,96 GiB) |
| Libro / real | ≈ **3,07 ×** |
| Margen hasta la parada de ingesta (asignación − 512 MiB − libro) | 1.602.118.700 B (≈ 1,49 GiB de libro, unos 0,5 GB reales) |

### Por qué marca el 75 %

Los triggers `sport_charge_*` (de `0002_guardia_deportiva.sql`) no miden
páginas. Suman un cargo por cada escritura:

- `INSERT`: 1.024 + 4 × (bytes de todas las columnas).
- `UPDATE`: 1.024 + 4 × (bytes de las columnas que cambian). Reescribir
  una fila vuelve a cobrarla.
- `DELETE`: +1.024. Borrar **suma**, no resta.
- Cada lote suma además 16.384 bytes y arranca desde
  `max(libro, tamaño medido)`.

El trigger `sport_ledger_update` impide que el valor baje. Por eso la carga
inicial, las recargas y los reprocesos (más de 2,3 millones de filas
`sport_*`, muchas escritas más de una vez) dejaron un libro de unas tres
veces el tamaño real. Es intencionado: es un tope conservador para que la
ingesta automática nunca pueda llenar D1. No es una medida de ocupación, y
por eso borrar filas no lo reduce.

### Recalibrar (bloque 5)

Recalibrar consiste en quitar `sport_ledger_update`, fijar
`accounted_bytes` en 2,25 GiB (2.415.919.104 B, el tamaño real más un 15 %
de margen) y volver a crear el trigger con el texto exacto de
`CAPACITY_DEFINITIONS`. El libro bajaría del 75,1 % al 28,1 %. Con el ritmo
actual de unos 3 bytes de libro por byte real, la ingesta se pararía cuando
D1 rondase los 4 GB reales. Sigue por debajo de los 5 GB incluidos y lejos
del límite de 10 GB.

Riesgos y condiciones:

- **Valor por debajo del real.** Tras cada lote, `lease.ts` comprueba que
  el tamaño real no supere al libro. Si lo supera, bloquea el libro para
  siempre (`blocked=1`), y desbloquearlo exige otra intervención manual.
  Hay que medir justo antes y dejar margen.
- **Texto del trigger distinto.** Si el trigger recreado no coincide con
  `CAPACITY_DEFINITIONS`, `verificarEsquemaD1` lanza
  `sport_migration_required` y la ingesta se detiene. Es un fallo seguro,
  pero deja la ingesta parada hasta corregirlo.
- **Escritura en curso.** No se debe hacer con un lease vigente ni con
  `sport_write_context` o `sport_write_charge` abiertos. Hay que parar los
  crons durante la operación.
- **Pérdida del histórico.** Se pierde el total acumulado de escrituras.
  Si se quiere conservar, hay que anotar el valor antiguo (6.450.944.980)
  en `docs/`.
- **Deshacer.** Time Travel revierte toda la base, incluida la ingesta
  posterior. Para volver sólo al valor antiguo hay que repetir el patrón
  `DROP`/`UPDATE`/`CREATE` con ese valor.
- **Otra opción sin tocar la guarda.** El documento
  `docs/capacidad-costes-2026-10-07.md` ya recoge esta decisión como
  pendiente. Mientras el margen de 1,49 GiB alcance, se puede no hacer
  nada. Subir la asignación no es posible: el `CHECK` de
  `sport_write_context` ya está en su máximo de 8 GiB.

Recomendación: hacerlo como migración propia del repositorio, con prueba
previa en una copia `nuevoNN` y una ventana sin crons, y no a mano desde la
consola.

## Método y límites

- Todas las consultas a D1 han sido `SELECT` o `EXPLAIN QUERY PLAN`,
  lanzadas con `wrangler d1 execute --remote --json`. La lista de columnas
  se sacó del SQL de `sqlite_master`, porque `pragma_table_info` en `JOIN`
  devuelve `SQLITE_AUTH`.
- R2: `r2 bucket info`, `r2 bucket lifecycle list` y la API REST de listado
  y lectura (manifiestos). KV: `kv key list`, del que sólo se agregaron
  prefijos y caducidades. No se imprimieron claves completas ni valores.
- No se ha tocado `src/`, ni git, ni se ha desplegado nada.
