# Tareas programadas

Qué se ejecuta solo, cuánto pide a las fuentes, cuánto escribe en D1 y cómo
forzar una relectura.

## Calendario de crons

Las expresiones viven en dos sitios que deben coincidir literalmente:
`TAREAS_CRON` en `src/lib/cron/programado.ts` y `triggers.crons` en
`wrangler.jsonc`. `tests/cron-programado.test.ts` falla si se separan. Esta
optimización no cambia ninguna franja: todo el ahorro está dentro de cada
tarea.

| UTC   | Ruta                              | Qué hace |
|-------|-----------------------------------|----------|
| 03:00 | `/api/cron/ingest/skermo_rfee`    | Calendario nacional, resultados de Skermo y enlaces de directo de Engarde |
| 03:30 | `/api/cron/ingest/fie`            | Temporada FIE, torneos futuros e inscritos FIE |
| 04:00 | `/api/cron/ingest/efc`            | Circuito EFC (el dominio no responde, HTTP 530) |
| 04:30 | `/api/cron/ingest/skermo_regional`| Calendarios de 11 federaciones autonómicas |
| 05:00 | `/api/cron/ingest/rfee_wp`        | Circulares de esgrima.es |
| 05:30 | `/api/cron/ingest/skermo_ranking` | Ranking nacional (con cadencia propia en `cadencia-ranking.ts`) |
| 06:00 | `/api/cron/extraer`               | Extracción de hasta 5 PDF nuevos al día (idempotente) |
| 06:45 | `/api/cron/ingest/fie_tiradores`  | Fichas FIE de nuestros tiradores y clasificación mundial |
| 07:00 | `/api/cron/notify`                | Envío de avisos; no pide nada a fuentes externas |
| —     | `/api/cron/sport`                 | **Obsoleto, sin franja.** El incremento antiguo del corpus deportivo; los resultados los mantiene `/api/cron/resultados`. Solo queda como ejecución manual (y apagada, `SPORT_INCREMENTAL_ENABLED`) de las clasificaciones históricas de ranking, que la ingesta automática no cubre. No activarlo a la vez que `/api/cron/resultados` |
| :20 (00–02 y 08–23) | `/api/cron/resultados` | Resultados automáticos (clasificación, poules y cuadro) en `sport_*`. Desactivado por defecto y fuera de `wrangler.jsonc`; ver [Resultados automáticos](#resultados-automáticos) |

Cada disparo escribe dos filas de reserva (reclamar y cerrar) para no
ejecutarse dos veces.

## Antes y después

Las cifras de «antes» son medias de `ingest_run` de los últimos 30 días. Las de
«después» salen de simular los niveles nuevos sobre `nuevo7.sqlite`: los 98
torneos FIE de marzo a octubre de 2026 y la temporada 2026/27 de Skermo.

| Tarea | Peticiones/día antes | Peticiones/día después | Filas D1 escritas/día antes | Filas D1 escritas/día después |
|---|---|---|---|---|
| `fie` · torneos futuros (detalle + ficha de cada prueba) | ~124 | ~44 (−64 %; simulado 54,4 → 19,3) | eventos y pruebas FIE de la ventana, `last_seen_at` incluido | solo los torneos leídos ese día |
| `fie` · listado de la temporada e inscritos | sin cambios (~48 inscritos con su propia cadencia) | igual | igual | igual |
| `fie_tiradores` · clasificación mundial | 48 (~2,8 MB) | ~8,6 (≈1,3 lecturas por semana) | solo filas que cambian (por hash) | igual, con menos lecturas |
| `fie_tiradores` · fichas | ~43 | igual | igual | igual |
| `efc` | 1 (falla siempre) | 1 por semana | 1 (`ingest_run`) | 1 por semana más 1 en `refresco_programado` |
| `rfee_wp` | ≤9 | ≤9 | ~279 (reescribía todas las circulares) | solo nuevas o con cambios (normalmente 0–3) |
| `skermo_rfee` · `last_seen_at` de eventos sin cambios | 1 calendario + resultados + Engarde | igual | 218 eventos y 436 pruebas | octubre ~200/~411 → enero ~101/~224 → abril ~48/~121 |
| `skermo_regional` · ídem | 11 calendarios | igual | 90 eventos y 177 pruebas | octubre ~85/~172 → enero ~33/~94 → abril ~22/~59 |
| `skermo_ranking` | 60 combinaciones + fichas, solo cuando toca | igual (ya tenía cadencia) | igual | igual |
| `extraer`, `notify` | ≤5 PDF / 0 | igual | igual | igual |

Las cifras de Skermo para «después» son las filas que siguen marcándose cada
noche (eventos que vienen o que acabaron hace 14 días o menos) más la séptima
parte del resto, que se renueva una vez por semana. El ahorro crece según
avanza la temporada.

## Niveles de refresco de un torneo

Implementados en `src/lib/cron/niveles.ts`, funciones puras probadas con un
reloj fijo en `tests/tareas-programadas.test.ts`.

| Situación del torneo | Nivel | Frecuencia |
|---|---|---|
| Del día −7 al +14 | `diario` | cada noche |
| Del día +15 al +60 | `semanal` | cada 7 días |
| Más allá del +60 | `quincenal` | cada 15 días |
| Acabado hace 8–13 días | `espera` | nada |
| Acabado hace 14–35 días | `final` | una sola pasada final, la primera noche en que toque |
| Acabado hace más de 35 días | `congelado` | ninguna petición |

Los periodos llevan media jornada de margen: un cron que corre a las 03:31 no
pierde frente a una lectura de las 03:30 de hace siete días. La pasada final
tiene una ventana de tres semanas para que un cron caído no la pierda.

Dónde se aplica:

- **FIE, torneos futuros.** La ventana de siempre (−3..+60 días) sigue igual;
  dentro de ella cada torneo se pide según su nivel. La última lectura de cada
  torneo se guarda en `refresco_programado` con `tarea = 'fie_torneo'` y
  `clave = id del torneo`. Los torneos que no tocan ese día conservan lo que ya
  hay en D1. El listado de la temporada (lo que ya se ha tirado) y los
  inscritos no cambian: los inscritos ya tenían su cadencia en
  `tocaLeerInscritos`.
- **Clasificación mundial FIE** (`tocaClasificacionFie`): se lee cada dos días
  durante los cuatro días posteriores al fin de una prueba FIE y, el resto del
  tiempo, una vez por semana. Las fichas de nuestros tiradores se siguen
  leyendo cada día. Estado: `tarea = 'fie_clasificacion'`, `clave = 'mundial'`.
- **EFC**: una comprobación semanal (`tarea = 'efc'`, `clave = 'calendario'`)
  mientras el dominio siga caído.
- **Ranking nacional**: sin cambios; ya seguía la cadencia de la fuente en
  `tocaLeerRanking` (los tres días siguientes a una prueba y una revisión
  semanal).
- **Enlaces de directo (Engarde)**: siguen siendo diarios dentro de
  `skermo_rfee`; la pasada ya se limita a los torneos en curso o próximos.
- **Skermo (nacional y autonómico)**: el calendario de cada federación es una
  sola página, así que no hay peticiones que ahorrar. El ahorro está en D1:
  `hayQueMarcarVisto` deja de reescribir `last_seen_at` en los eventos y
  pruebas sin cambios que acabaron hace más de 14 días, salvo una vez por
  semana. La frescura del calendario usa el máximo de `last_seen_at`, que
  mantienen los eventos próximos, y la detección de desaparecidos usa los ids
  vistos, no la fecha. Un evento que había desaparecido y vuelve se marca
  siempre.
- **Circulares (`rfee_wp`)**: solo se escriben las nuevas o las que cambian de
  título, URL o fecha.

## Meses pasados del calendario

Los meses pasados no necesitan ninguna tarea programada. Se componen al vuelo
desde el corpus deportivo (`cargarTramoPasado` en
`src/lib/queries/calendario-pasado.ts`) con dos o tres consultas indexadas por
mes, de 7 a 50 ms, sin escrituras. Un torneo acabado no vuelve a pedirse a
ninguna fuente.

## Estado y migración

`drizzle-d1/0012_refresco_programado.sql` crea
`refresco_programado(tarea, clave, ultima_lectura)` (`WITHOUT ROWID`, solo
aditiva). Queda fuera del esquema de Drizzle a propósito, porque ese esquema
tiene que seguir igual al de Postgres (`tests/d1-schema.test.ts`).

Sin la migración aplicada, el código funciona como antes: todo cuenta como
«nunca leído», así que se lee todo y no se guarda nada. Aplicarla es lo que
activa el ahorro de peticiones FIE, EFC y clasificación. El ahorro de
escrituras de Skermo y `rfee_wp` no depende de ella.

## Forzar una relectura

- **Cron a mano**: `GET /api/cron/ingest/<fuente>?forzar=1` con
  `Authorization: Bearer $CRON_SECRET`. Se registra en `ingest_run` con
  `triggered_by = 'cron:forzado'`.
- **Panel de administración** (`POST /api/admin/ingest`): siempre fuerza. Quien
  lanza una ingestión a mano quiere datos frescos ya.
- **Línea de órdenes**: `npm run ingest -- fie --forzar`.
- **Un torneo concreto** en la próxima pasada nocturna, sin forzar el resto:

  ```sql
  DELETE FROM refresco_programado WHERE tarea = 'fie_torneo' AND clave = '<id del torneo FIE>';
  ```

  Con `tarea = 'fie_clasificacion'` o `tarea = 'efc'` se reinicia la
  clasificación mundial o la comprobación de la EFC.

Forzar solo salta los niveles. Las cadencias propias de cada fuente siguen
aplicándose: la del ranking nacional y la de los inscritos FIE.

Forzar también salta la huella de página de Skermo (ver abajo). Para que la
próxima pasada programada procese las páginas enteras sin forzar nada más:

```sql
DELETE FROM refresco_programado WHERE tarea IN ('huella_pagina', 'huella_pagina_leida');
```

## Escrituras y caché de la cadena nocturna

Detalle y cifras en `docs/ingesta-optimizacion-2026-10-08.md`.

- **Inscritos**: solo se escriben filas nuevas o con algún dato cambiado. Las
  bajas salen de comparar lo guardado con lo leído en la pasada (por prueba y
  fuente leída), no de `last_seen_at`. Esa fecha («leída el …» en la ficha) se
  renueva a diario en las pruebas del día −1 al +14 y una vez por semana en las
  demás (`hayQueMarcarListaVista`).
- **Plazos publicados**: solo se escriben si el cierre se mueve. Un fallo al
  guardarlos deja la pasada en `parcial` con la nota «plazos sin guardar», sin
  tumbar el calendario.
- **Huella de página de Skermo**: cada calendario se resume en
  `refresco_programado` (`huella_pagina` y `huella_pagina_leida`, clave
  `<fuente>:<federación>`). Una página idéntica a la de su última lectura
  completa no se parsea ni se cruza con la base; solo se renueva la fecha de
  lectura de lo que se tira ya. Una vez por semana se procesa entera igualmente.
  `VERSION_LECTURA_SKERMO` (en `runner.ts`) se sube cuando cambia el parseo o
  el guardado, para invalidar todas las huellas.
- **Emparejado FIE↔Skermo**: por cron, una vez por noche tras
  `skermo_regional` (aunque falle); a mano, tras cada fuente de calendario.
  Solo escribe los pares que cambian.
- **Snapshot del HTML de la RFEE**: se sube a R2 solo si cambia; la URL y el
  SHA-256 quedan en `ingest_run.snapshot_url` y `snapshot_hash`.
- **Caché**: cada fuente dice si cambió algo visible (`sinCambios`). Por la
  franja del cron, la familia que cambió queda pendiente
  (`refresco_programado`, tarea `cache_pendiente`) y la invalida una sola vez
  la última fuente de la cadena que la toca: `calendario` en `rfee_wp`,
  `ranking` en `skermo_ranking`, `ranking-fie` y `deporte` en `fie_tiradores`
  (`CIERRE_NOCTURNO` en `tras-ingesta.ts`). Si esa fuente no llega a correr,
  la siguiente pasada de la cadena invalida lo pendiente con más de 12 h. Con
  `?forzar=1`, el panel o la CLI se invalida en el acto.
- **Resultados automáticos**: una pasada sin nada vencido hace una sola
  lectura indexada y no toma el lease (`status: 'sin_pendientes'`).

## Resultados automáticos

`/api/cron/resultados` (`src/lib/ingest/resultados-auto/`) lleva al corpus
deportivo (`sport_*`) la clasificación, las poules y el cuadro de las pruebas
acabadas, unas horas después de que la fuente los publique. Usa los MISMOS
conversores que el lote manual (`src/lib/ingest/hechos/*`, que los scripts de
`scripts/indexado/` reexportan) y la misma lógica de carga que
`cargar-hechos.ts` (claves naturales, `content_hash`, modos de sección y
cobertura), así que lo que escribe es lo que habría escrito el lote.

### Qué lee

| Fuente | Descubrimiento | Hechos |
|---|---|---|
| FIE | Catálogo de la temporada (`/api/fie/competitions`, 100 por página; una página por pasada, en bucle) | Clasificación, poules y cuadro de `fie.org/api/fie/competition/<temporada>/<id>` (pruebas por equipos: sólo clasificación) |
| Skermo (RFEE) | Índice de resultados de la temporada, como mucho cada 3 h | Clasificación de Skermo; es la prueba de destino |
| Engarde | Enlaces del índice de Skermo, de las filas hermanas (misma ciudad o nombre, ±1 día) y de `live_source` | Poules y cuadro de la prueba que case con la de Skermo (arma, género, ±1 día y ≥80 % de nombres) |
| PDF RFEE | Documentos de `app.skermo.org` del índice | Lector determinista (`sources/rfee-pdf`); la IA sólo si la lectura no es completa |

Los asaltos de Engarde o del PDF se cuelgan de la prueba de Skermo, como en
`dedupe-pruebas.ts`: la clasificación de Skermo manda. EFC no está cubierta:
su dominio sigue caído.

### Reglas que protegen lo que ya hay

- Una prueba cuyos asaltos ya cargó otra lectura (un lote manual) no se vuelve
  a leer ni a reescribir; sólo se completan los asaltos que esta misma unidad
  escribió (`resultado_auto_unidad.escrito`). Un PDF que un lote ya cargó
  (`sport_import_coverage`, `doc:<fichero>`) tampoco se toca.
- Antes de escribir una lectura determinista se sanean los asaltos
  (`sanearAsaltos`): fuera la poule con parejas repetidas o más asaltos de los
  posibles (y, en un PDF que se declara completo, la de alguien sin sus n−1
  asaltos), fuera los asaltos incoherentes del cuadro. La sección queda
  `parcial`. Mejor sin asaltos que con asaltos duplicados.
- Una cobertura en `conflicto` (marca de revisión humana) no se limpia nunca.
- Personas, de más a menos fuerte: ID FIE o licencia RFEE de la temporada;
  misma licencia en otra temporada con el mismo nombre; nombre idéntico con
  contexto (país en la FIE, club en los tres últimos años en las nacionales)
  y un único candidato. Un identificador nunca enlaza con una persona de otro
  género o con un año de nacimiento incompatible. Con ID publicado y sin
  ningún homónimo se crea la persona; con homónimos el puesto queda sin
  persona y los homónimos quedan como `sport_link_candidate` `PROPUESTO`
  (`source = 'resultados_auto'`). Nunca se une ni se crea por la duda.

### Cuándo vuelve a mirar

Una unidad (prueba FIE, fila de Skermo, PDF) entra en cola 20 h después de su
fecha. Si la fuente no está completa: cada hora los dos primeros días, cada
6 h hasta el día 7 y diaria hasta el día 21. Completa: una revisión de
correcciones a los dos días si es reciente. Una fuente igual a la ya escrita
(misma huella) no escribe nada; si cambia, la carga compara fila a fila y sólo
escribe lo que cambió.

### Presupuesto

Todo se puede cambiar con variables del Worker (`config.ts`), sin desplegar:

| Tope | Por defecto | Variable |
|---|---|---|
| Reloj por pasada | 45 s | `RESULTADOS_AUTO_MAX_MS` |
| Peticiones a fuentes por pasada | 40 (pausa de 0,4 s; un 429 o 5xx para la pasada) | `RESULTADOS_AUTO_MAX_PETICIONES` |
| Filas `sport_*` por pasada / día | 1.500 / 6.000 (una prueba nunca se parte) | `RESULTADOS_AUTO_MAX_FILAS_PASADA`, `_DIA` |
| Libro de capacidad por día | 48 MiB | `RESULTADOS_AUTO_MAX_BYTES_DIA` |
| Margen mínimo del libro (8 GiB menos lo contabilizado) | 512 MiB | `RESULTADOS_AUTO_MARGEN_MIN_BYTES` |
| Unidades por pasada | 6 | `RESULTADOS_AUTO_MAX_UNIDADES` |
| IA por día | 4 llamadas, 6.000 neuronas estimadas (peor caso ≈650 por llamada) | `RESULTADOS_AUTO_IA_MAX_LLAMADAS_DIA`, `_NEURONAS_DIA` |
| PDF | 4 MiB, 100 páginas | — |

Escribe sólo dentro del lease global de `sport_*` (el del incremento y el del
lote remoto, `dbConSportLease`) y cada lote paga en el libro de capacidad. Con
poco margen no escribe, responde `ok:false, status:'ledger_bajo'` (el cron
queda como fallido) y abre una revisión. Medido en la simulación sobre la copia
de `nuevo9`: cargar las cuatro pruebas del TNR de octubre (324 puestos y 741
asaltos) costó ≈1.400 filas y ≈3,4 MB de libro; un día normal sin pruebas
nuevas son 0 filas y entre 1 y 25 peticiones por pasada.

### Activar

1. `npx wrangler d1 execute calendario-fie-fede-db --remote --file drizzle-d1/0017_resultados_automaticos.sql`
   (sólo crea cuatro tablas `resultado_auto_*`, fuera de `sport_*`: no paga en
   el libro ni las copia `sincronizar-d1.ts`).
2. Añadir `"20 0-2,8-23 * * *"` a `triggers.crons` en `wrangler.jsonc`.
3. `RESULTADOS_AUTO_ENABLED = "true"`. La IA aparte:
   `RESULTADOS_AUTO_IA_ENABLED = "true"` (usa el binding `AI` existente).

Sin la migración el cron responde `migracion_pendiente` y no escribe nada.

### Cola de revisión

Nada de lo que está en `resultado_auto_revision` se escribió en `sport_*`
(salvo que `datos.escrito` sea `true`, p. ej. una prueba cargada con un PDF
parcial).

```sql
SELECT id, clave, motivo, datos, datetime(creada_en/1000, 'unixepoch') FROM resultado_auto_revision
 WHERE estado = 'abierta' ORDER BY creada_en DESC;
-- Motivos: ledger_bajo, pdf_parcial, pdf_no_atribuible, pdf_sin_texto (escaneado),
-- ia_no_valida (con los fallos de la validación estricta), errores_repetidos,
-- conflicto / prueba_partida_por_lector_antiguo.
UPDATE resultado_auto_revision SET estado = 'resuelta', resuelta_en = unixepoch()*1000 WHERE id = ?;
-- Volver a leer una unidad en la siguiente pasada:
UPDATE resultado_auto_unidad SET estado = 'pendiente', proxima = 0, intentos = 0 WHERE clave = 'skermo|2026-2027|10351';
-- Estado de las unidades y consumo del día:
SELECT clave, estado, detalle, intentos, datetime(proxima/1000,'unixepoch') FROM resultado_auto_unidad ORDER BY proxima;
SELECT * FROM resultado_auto_consumo WHERE dia = date('now');
```

### Eventos para las notificaciones

`leerEventosResultados(db, { desdeId, limite, tipos, personas })` y
`eventosDisponibles(db)` en `src/lib/ingest/resultados-auto/eventos.ts`.
Tipos: `prueba_publicada` (primera clasificación de una prueba),
`fases_publicadas` (primeras poules o cuadro) y `resultado_persona` (puesto
nuevo, o recién enlazado, de una persona). Cada evento se escribe una sola vez;
el consumidor guarda su cursor (último `id`). Compara con `personaCanonica`,
no con `personId`: un lote posterior puede fusionar personas. Se purgan a los
120 días.

Al acabar cada pasada que escribió filas o eventos, `despuesDePasada`
(`runtime.ts`) llama a `trasIngesta('resultados_auto')`
(`src/lib/ingest/tras-ingesta.ts`): sube la época `deporte` de la caché
compartida y llama a `notificarResultadosNuevos(db)`, que lee estos eventos con
su cursor, genera los avisos de la campana y los empuja al móvil. Las rutas de
`runIngest` (cron y botón del panel) hacen lo mismo con su fuente. Ningún fallo
de estos dos pasos rompe la ingesta: el resumen lleva `tras` con su estado y,
si los avisos no salen, los recoge el cron de las 07:00.

### Perfil y Explorar

Tras cada prueba se recalculan `perfil_deportista` de las personas tocadas
(si la tabla existe) y se marca su peso en el índice de Explorar (si existe).
Es incremental y parcial: el recálculo completo sigue siendo el del lote.

### Ensayo local

```
npx tsx scripts/resultados-auto-simular.ts --d1-local <copia.sqlite> --casete <dir> [--grabar] \
  [--ahora 2026-10-07T01:20:00Z] [--pasadas 8] [--forzar] [--sin-huella]
```

Nunca sobre una exportación de producción (`nuevoN.sqlite`): copia antes.
`--grabar` pide a las fuentes reales y guarda cada respuesta en el casete; sin
él reproduce el casete sin red.
