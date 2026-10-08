# Ingesta automática: menos escrituras, menos resets de caché (2026-10-08)

Base de las cifras: `wrangler d1 insights` de producción, ventana 10-05..10-07
(noche: 1.524 sentencias, 164.841 filas leídas, 14.362 escritas; pasada horaria
vacía de resultados: ~28 sentencias, ~3.800 filas leídas, ~4 escritas, 10–14 s),
y la copia local `nuevo15.sqlite` (solo lectura) para los tamaños: 2.609
inscritos de Skermo (726 en pruebas del día −1 al +14), 585 plazos publicados,
137 enlaces FIE↔Skermo, 492 eventos, 800 pruebas, 11.655 filas de clasificación
FIE, 345 objetos en `sqlite_master`.

Las cifras de «después» son estimaciones; no incluyen las mejoras ya
desplegadas en `8c3e8aee` (cadencia del ranking, `documento_vigencia`, torneos
FIE, EFC semanal, clasificación mundial), que no se tocan.

## Qué cambia

| # | Cambio | Dónde |
|---|--------|-------|
| 1 | Inscritos: se leen los guardados de las pruebas leídas y solo se escriben filas nuevas o con algún dato cambiado. Las bajas salen de comparar con el conjunto leído en la pasada (por prueba y fuente), no de `last_seen_at < now`. `last_seen_at` («leída el …») se renueva a diario en pruebas del día −1 al +14 y semanalmente en las demás. La ruta de inscritos FIE aplica la misma regla a las listas iguales. | `upsert.ts` (`upsertListasDeInscritos`, `filaInscritaCambia`), `niveles.ts` (`hayQueMarcarListaVista`), `runner.ts` |
| 2 | «Sin cambios» real en todas las fuentes (`cambiosVisibles`, inscritos FIE, emparejado, EFC, fichas FIE con la clasificación mundial). Por cron, cada familia de caché se invalida una vez, tras la última fuente de la cadena que la toca; lo pendiente vive en `refresco_programado` (`cache_pendiente`). | `tras-ingesta.ts` (`planInvalidacion`, `CIERRE_NOCTURNO`), `api/cron/ingest/[source]/route.ts` |
| 3 | Plazos publicados: solo si el cierre se mueve; una fecha inválida no se intenta guardar; un fallo al guardar plazos deja la pasada en `parcial` con nota en vez de abortar la fuente (el fallo del 10-06). | `upsert.ts` |
| 4 | Emparejado FIE↔Skermo: por cron una vez por noche, tras `skermo_regional` (aunque falle); a mano tras cada fuente de calendario. Escribe solo los pares que cambian y borra por id lo que ya no se propone. | `enlazar.ts` (`planificarEnlaces`), `runner.ts` (`tocaEmparejar`) |
| 5 | Resultados automáticos: antes del lease, una lectura indexada (`hayTrabajoPendiente`) decide si hay algo vencido; si no, `status: 'sin_pendientes'`. Las comprobaciones de `sqlite_master` se recuerdan por isolate (solo el «sí»). | `resultados-auto/estado.ts`, `ejecutar.ts`, `sql.ts` |
| 6 | Huella de página de Skermo (52 bits de SHA-256 en `refresco_programado`, sin migración): una página igual a la de su última lectura completa no se parsea ni se cruza con la base; se renuevan solo las fechas de lectura que se ven. Lectura completa forzada cada 7 días y con `?forzar=1`. Las desaparecidas se marcan por federación leída entera. | `cron/huellas.ts`, `runner.ts`, `upsert.ts` (`renovarVistosSinCambios`, `markMissingEvents(…, prefijo)`) |
| 7 | Snapshot del HTML de la RFEE: solo se sube a R2 si cambia; `ingest_run.snapshot_url` y `snapshot_hash` se rellenan (antes se descartaba el resultado). Sin borrado por ciclo de vida. | `runner.ts` (`guardarSnapshot`) |
| 8 | Clasificación mundial FIE: el recuento sale de `fie_clasificacion_lectura.row_count` (ahora «filas que quedan guardadas») más las nuevas, en vez de `count(*)`; el `DELETE … NOT IN` se omite si no sobra ninguna fila. `count(*)` sigue como respaldo (sin fila o con más de 30 días). | `sources/fie-clasificacion-lectura.ts`, `sources/fie-tiradores.ts` |
| 9 | `previaVacia` recibe los valores (sin claves duplicadas). Fechas de la edición FIE con `tournamentId`: se amplían con min/max en vez de quedarse con las de la última prueba importada (bug confirmado: `inicio`/`fin` son de la prueba). | `resultados-auto/cargar.ts`, `fie-resultados-db.ts` |
| 10 | Push: el resultado de los envíos se apunta al final en lote (`UPDATE … FROM json_each` + `DELETE … IN`, 200 ids por sentencia). Los fallos se cuentan en memoria desde `Suscripcion.fallos`; la cola sigue parándose al llegar a `MAX_FALLOS`. Topes por perfil y por pasada sin cambios. | `notificaciones/suscripciones.ts` |
| 11 | Campana: sondeo cada 5 min mientras se ve; consulta inmediata con push, al volver tras ≥60 s oculta y al recuperar la red. | `contador-cliente.ts`, `campana-cliente.tsx` |

## Antes y después (estimación)

Filas escritas (W), leídas (R) y sentencias (S). «Noche» = cadena 03:00–07:00;
«día» = 19 pasadas horarias de resultados; mes = 30 días.

| Partida | Antes / noche | Después / noche | Ahorro / noche | Ahorro / mes |
|---|---|---|---|---|
| `competition_registration` (W) | 5.289 W, 407 S | ~2.100 W (726 diarias + 1.883/7 semanales + cambios), ~160 S | −3.200 W, −250 S | −96.000 W |
| `event_deadline` (W) | 1.336 W | ~0–20 W | −1.320 W | −39.600 W |
| `event_link` (W) | 464 W (4 pasadas) | ~0–10 W (1 pasada) | −460 W | −13.800 W |
| Emparejado (R) | 4 × ~1.430 R | 1 × ~1.440 R | −4.300 R | −129.000 R |
| Precarga de inscritos y plazos (R, nueva) | 0 | +3.200 R | +3.200 R | +96.000 R |
| `refresco_programado` (W) | 226 W | ~260 W (+24 huellas, ≤8 pendientes) | +34 W | +1.000 W |
| Clasificación FIE `count(*)` + `DELETE` (R) | 42.753 + ~42.000 R por día de lectura (~3/semana) | ~48 R + solo los `DELETE` con ausentes | ~−36.000 R de media | −1,1 M R |
| Página Skermo igual (R, si no cambia) | RFEE ~2.900 R, autonómicas ~650 R | 2 UPDATE por página | hasta −3.500 R | según noches iguales |
| Snapshot R2 | 1 PUT (~105 KB) | 0 si la página es igual | ≤1 PUT | ≤30 PUT, ≤3 MB |
| Resets de caché | 6–8 (calendario, deporte, ranking-fie siempre) | ≤4, 0 por familia sin cambios | ≥3 resets | ≥90 resets |
| **Total escrituras propias** | **~7.300 W** de las 14.362 | **~2.400 W** | **≈ −4.950 W (−34 % de la noche)** | **≈ −148.000 W** |

| Partida diurna | Antes / día | Después / día | Ahorro / mes |
|---|---|---|---|
| Pasadas de resultados vacías (~11 de 19; las otras 8 leen un índice) | 11 × (28 S, 3.800 R, ~4 W) | 11 × (1 S, ~3 R, 0 W) | −8.900 S, −1,25 M R, −1.300 W |
| Pasadas activas: `sqlite_master` | ~4 S y ~1.400 R por pasada | 0 con el isolate reutilizado | hasta −42.000 R por cada pasada diaria reutilizada |
| Push, pasada de 500 envíos | ≥500 S (≥50 % del límite de 1.000 por invocación) | 3–6 S | — (filas escritas iguales: una por suscripción) |
| Campana, por usuario y hora visible | 60 consultas (sesión + `count(*)`) | 12 | −80 % de esas lecturas; con 500 usuarios × 1 h/día: −24.000 consultas/día, −720.000/mes |

Sobre los resets: cada uno hace que el siguiente visitante lea en frío (un
perfil frío ≈ 108.000 filas). Varios resets nocturnos sin visitas entre medias
cuestan lo mismo que uno; lo que de verdad ahorra es no invalidar una familia
que no cambió (antes `fie`, `skermo_*` y `fie_tiradores` invalidaban siempre:
calendario, deporte y ranking-fie se vaciaban cada mañana). `deporte` sigue
moviéndose con cada escritura `sport_*` por el libro de capacidad
(`versiones.ts`, fuera de este cambio): para tener exactamente una subida por
pasada, `versionDe` tendría que dejar de usar `ledger` y apoyarse solo en la
época que sube `trasIngesta`.

## Correos (Resend), sin cambios

`RESEND_DAILY_LIMIT` = 100 correos al día (`src/lib/email/resend.ts`). Con 500
usuarios, un aviso que genere un correo por persona tarda al menos 5 días en
salir entero; lo que pasa del tope se queda en `notification` y sale los días
siguientes, en orden. La campana y el push no dependen de ese tope.

## Despliegue en producción

No hay migración nueva ni interruptor nuevo. Todo usa tablas que ya existen:

1. Comprobar (solo lectura) que están las tablas de las que depende cada
   ahorro; sin ellas el código hace lo de antes:

   ```sql
   SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
     ('refresco_programado', 'fie_clasificacion_lectura', 'notificacion_suscripcion',
      'cache_epoch', 'resultado_auto_unidad');
   ```

   `refresco_programado` (0012) es imprescindible para la huella de página y
   para aplazar invalidaciones; si faltara, `trasIngesta` invalida en el acto
   como antes.
2. Desplegar el Worker como siempre. Los crons y `wrangler.jsonc` no cambian.
3. Primera noche, comprobar:
   - `ingest_run` de `skermo_rfee`: `snapshot_url` y `snapshot_hash` rellenos;
     notas sin «plazos sin guardar»; la segunda noche, si la página no cambió,
     «páginas iguales a su última lectura completa».
   - `SELECT tarea, count(*) FROM refresco_programado GROUP BY 1`: aparecen
     `huella_pagina` y `huella_pagina_leida` (12 claves) y, después de las 06:45,
     ninguna fila `cache_pendiente`.
   - `SELECT namespace, epoch, datetime(updated_at/1000,'unixepoch') FROM cache_epoch`:
     `calendario` a las 05:00 como pronto, `ranking` a las 05:30 solo si el
     ranking cambió, `ranking-fie`/`deporte` a las 06:45.
   - `/api/cron/resultados` en horas sin nada vencido: `status: 'sin_pendientes'`.
4. Vuelta atrás: redesplegar la versión anterior. Los datos son compatibles;
   las filas nuevas de `refresco_programado` se pueden dejar o borrar:
   `DELETE FROM refresco_programado WHERE tarea IN ('cache_pendiente','huella_pagina','huella_pagina_leida');`

## Riesgos y cambios de conducta

- **Calendario nocturno**: lo que cambie a las 03:00 se invalida a las 05:00
  (la caché se sigue revalidando sola por `frescoMs`). Los registros FIE nuevos
  de las 03:30 salen como tarjeta aparte hasta el emparejado de las 04:30.
- **Desaparecidos por federación**: una federación autonómica leída entera
  marca sus desaparecidos aunque otra no respondiera (antes no se marcaba
  ninguno). Una federación que no responde sigue sin marcar nada.
- **«Leída el …»** de una lista lejana (más de 14 días o ya disputada) puede
  tener hasta 7 días aunque se haya comprobado hoy.
- **Huella de Skermo**: si cambia el parseo o el guardado, hay que subir
  `VERSION_LECTURA_SKERMO` o forzar; si no, el cambio llega en la lectura
  completa semanal.
- **`row_count`** pasa a significar «filas que quedan guardadas tras la
  lectura». La primera lectura tras el despliegue usa el valor antiguo (filas
  leídas); solo difiere si la anterior fue una respuesta cortada, y a los 30
  días se vuelve a contar.
- **Push**: dos pasadas simultáneas sobre la misma suscripción pueden perder un
  incremento de `fallos` (se apunta al final); como mucho retrasa un borrado.
- **Pendientes que no se cierran**: si la fuente que cierra una familia no
  corre, la invalidación llega con la siguiente pasada de la cadena (>12 h) o
  al día siguiente.
