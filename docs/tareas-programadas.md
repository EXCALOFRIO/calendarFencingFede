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
| :15   | `/api/cron/sport`                 | Mantenimiento del corpus deportivo. Desactivado por defecto y fuera de `wrangler.jsonc` |

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
