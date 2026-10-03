# Histórico, tamaño y lecturas de Neon

Consulta de solo lectura: **03/10/2026, 08:15–08:18 UTC**. Recuentos reales,
sin ingesta, backfill ni datos personales. SQL y planes limitados a 15 segundos
en transacciones `READ ONLY`.

## Respuesta corta

**No está almacenado todo el histórico de FIE ni de las competiciones
nacionales.** Hay un piloto de resultados antiguos, rankings de temporada
actuales y evolución anual de algunos deportistas. No son el mismo conjunto.

Tampoco hay un inventario exhaustivo de las fuentes que permita calcular
cuántas competiciones faltan o un porcentaje de cobertura universal.

## Resultados finales importados, por año y arma

| Año natural | Fuente y conjunto | Arma/formato | Pruebas | Puestos finales | Asaltos |
|---|---|---|---:|---:|---:|
| 2019 | RFEE PDF, `sport_*` | Espada | 1 | 28 | 31 |
| 2024 | FIE, `sport_*` | Florete, equipos | 1 | 8 | 0 |
| 2024 | FIE, `sport_*` | Sable, individual | 1 | 34 | 34 |
| 2026 | FIE, `sport_*` | Sable, individual | 1 | 28 | 105 |
| 2026 | Skermo RFEE, `result` anterior | Espada | 2 | 334 | No almacenados aquí |
| 2026 | Skermo RFEE, `result` anterior | Sable | 2 | 171 | No almacenados aquí |

- **FIE:** 3 pruebas y 70 puestos, del 27/07/2024 al 25/09/2026.
- **RFEE PDF:** una prueba del 08/06/2019. Clasificación final 28/28, pero el
  documento sigue parcial: poules 16/84 y cuadro 15/15.
- **Nacionales anteriores:** 4 pruebas y 505 puestos, del 20 al 27/09/2026.
  Los cuatro eventos tienen ámbito nacional, no autonómico.
- Los cuatro grupos de `sport_*` tienen 98 puestos y 170 asaltos. No están
  enlazados a pruebas del calendario anterior: no se presume conciliación.
- Hay 62 personas deportivas: los 62 resultados individuales FIE están
  enlazados; 8 puestos FIE de equipos y los 28 PDF no están enlazados a persona.
- Los 505 resultados anteriores no están enlazados a atleta local. Hay 2
  atletas locales, un concepto diferente de las personas deportivas importadas.

Otros años/armas tienen **cero puestos importados en estas tablas**, no cero
competiciones celebradas.

## Ranking oficial de temporada

Una clasificación mundial o nacional por temporada **no es la clasificación
final de un torneo**.

| Conjunto mutable | Temporada | Espada | Florete | Sable | Entradas |
|---|---|---:|---:|---:|---:|
| FIE mundial individual | 2027 | 4.317 | 3.499 | 3.086 | 10.902 |
| FIE selecciones | 2027 | 290 | 236 | 227 | 753 |
| RFEE oficial | 2026-2027 | 737 | 307 | 306 | 1.350 |

**2027 es la temporada FIE 2026-2027**, no competiciones futuras ya celebradas.

FIE tiene 41 grupos no vacíos, 24 individuales y 17 de equipos. Los
individuales tienen 8.850 identificadores distintos; los equipos, 104
federaciones. RFEE tiene 18 grupos (ABS/M17/M20, ambos géneros y las tres
armas) y 863 identificadores Skermo. Las entradas de distintos grupos no son
personas distintas.

Estas tablas conservan el estado por temporada y participante, **no cada
versión histórica por fecha**. Las últimas escrituras fueron 01/10/2026
06:46 UTC en FIE y 03/10/2026 05:31 UTC en RFEE; no acreditan fecha oficial
de publicación ni descarga de cada grupo.

### Snapshots deportivos

Solo hay **un snapshot** en `sport_ranking_*`: FIE, temporada 2024, florete
masculino absoluto individual, con 903 entradas. Fue observado el
02/10/2026; esa fecha almacenada no acredita publicación oficial ese día.
No hay snapshots RFEE en estas tablas. Las 903 entradas no tienen enlace a
persona deportiva.

### Evolución anual de algunos deportistas FIE

`fie_world_ranking` contiene 625 filas: 220 anteriores a 2027 para 54
identificadores y 405 de 2027 para 344 identificadores. **No son puestos de
torneos ni todos los participantes históricos.**

| Temporada FIE | Espada | Florete | Sable | Filas |
|---|---:|---:|---:|---:|
| 2003 | 0 | 0 | 1 | 1 |
| 2004 | 0 | 0 | 0 | 0 |
| 2005 | 0 | 0 | 2 | 2 |
| 2006 | 0 | 0 | 2 | 2 |
| 2007 | 0 | 0 | 2 | 2 |
| 2008 | 0 | 0 | 3 | 3 |
| 2009 | 0 | 1 | 3 | 4 |
| 2010 | 0 | 1 | 3 | 4 |
| 2011 | 0 | 1 | 3 | 4 |
| 2012 | 0 | 1 | 3 | 4 |
| 2013 | 0 | 1 | 3 | 4 |
| 2014 | 0 | 2 | 2 | 4 |
| 2015 | 2 | 2 | 3 | 7 |
| 2016 | 1 | 2 | 2 | 5 |
| 2017 | 3 | 2 | 3 | 8 |
| 2018 | 2 | 3 | 2 | 7 |
| 2019 | 2 | 2 | 3 | 7 |
| 2020 | 4 | 3 | 2 | 9 |
| 2021 | 4 | 3 | 2 | 9 |
| 2022 | 4 | 2 | 3 | 9 |
| 2023 | 6 | 4 | 3 | 13 |
| 2024 | 9 | 8 | 10 | 27 |
| 2025 | 11 | 11 | 13 | 35 |
| 2026 | 19 | 18 | 13 | 50 |
| 2027 | 227 | 124 | 54 | 405 |

## Cobertura: conocido no significa completo

`sport_import_coverage` tiene 12 registros: 9 completos, 2 parciales y uno
sin resultados. Un estado completo acredita **esa unidad y esa lectura**,
no todo el histórico de una fuente.

No hay registros de tipo `index`: falta el denominador global. Tampoco hay
histórico importado de Skermo regional, Engarde o FWW en estas tablas.

El calendario tiene 486 registros de fuente, 794 pruebas y 355 eventos
principales tras enlaces canónicos. Sus pruebas son 45 nacionales, 184
autonómicas y 565 internacionales. **Calendario no equivale a resultados**,
y las republicaciones entre Skermo y FIE no son competiciones distintas.

## Tamaño real

| Medida | MB decimales | MiB |
|---|---:|---:|
| Base completa (`pg_database_size`) | **31,74** | **30,27** |
| Tablas e índices de `public` | 20,48 | 19,53 |
| Tablas, incluyendo TOAST | 13,71 | 13,08 |
| Índices | 6,77 | 6,45 |
| TOAST, ya incluido en tablas | 0,77 | 0,73 |
| Todas las tablas `sport_*`, con índices | 1,37 | 1,30 |

Principales tablas con sus índices: `fie_clasificacion` 5,70 MiB,
`extraccion_propuesta` 2,38 MiB, `competition_registration` 1,74 MiB,
`official_ranking_entry` 1,59 MiB e `ingest_quarantine` 0,88 MiB.

Es espacio lógico asignado, incluyendo páginas libres y filas antiguas.
**No es cuota ni facturación de Neon**. No incluye otras ramas, historial
retenido de restauración, R2, assets ni cómputo. No hay evidencia suficiente
para estimar cuánto ocuparía todo el histórico aún no descubierto.

## Rapidez y eficiencia

Seis muestras por consulta desde este equipo mediante HTTP Neon. La mediana y
el rango excluyen la primera de esas seis muestras.

| Lectura | Filas | Primera muestra | Mediana posterior | Rango posterior | SQL servidor |
|---|---:|---:|---:|---:|---:|
| Ranking RFEE completo | 1.350 | 244,5 ms | 74,7 ms | 54,8–82,2 ms | 2,465 ms |
| FIE espada masculina ABS individual | 1.253 | 109,7 ms | 42,8 ms | 41,9–70,2 ms | 1,004 ms |
| Snapshot oficial, página | 100 | 42,0 ms | 37,1 ms | 35,0–62,6 ms | 0,625 ms |
| Resultados de una prueba | 28 | 41,7 ms | 35,2 ms | 33,5–62,9 ms | 0,081 ms |
| Cobertura de una persona, agregado | 1 | 35,3 ms | 33,6 ms | 33,3–64,0 ms | 0,092 ms |

La primera petición de un proceso nuevo tardó 698,7 ms. **No demuestra un
cold start de Neon**: la base ya estaba activa. Esto no mide la pantalla
completa, autenticación, teléfono, concurrencia ni latencia desde Cloudflare.

Los planes utilizan índices de grupo FIE, publicación de ranking y posición
de snapshot. Leer todo RFEE hace un escaneo y ordenación de sus 1.350 filas,
razonable a este tamaño. Las tablas de 98 resultados son tan pequeñas que
algunos escaneos secuenciales son más baratos que usar sus índices.

La muestra acredita lecturas ligeras del conjunto actual, **no escalabilidad
demostrada a todo el histórico**. Los casts de enums y ordenaciones por
expresiones requieren volver a medir si crece mucho.

## Cómo se recuperan novedades

- La UI consulta Neon; no descarga las fuentes al navegar.
- Los crons revisan calendarios, clasificaciones recientes Skermo, ranking
  RFEE, fichas/clasificaciones FIE y circulares.
- Claves estables y hashes evitan duplicados o revisiones idénticas. Se
  actualizan frescura y registros de ejecución aunque no haya novedades:
  **sin novedades no significa cero peticiones ni cero escrituras**.
- Skermo lee el índice y hasta 40 clasificaciones desconocidas. Las pruebas
  con resultados previos se saltan salvo relectura forzada.
- RFEE intenta leer tras una competición nacional durante tres días y,
  fuera de esa ventana, semanalmente.
- La clasificación FIE solicita hasta 48 grupos de la temporada actual y
  solo cambia filas cuya huella varió.
- El histórico antiguo usa backfill manual acotado: por defecto 20 tareas,
  200 peticiones y 4 minutos. Límites máximos: 200 tareas, 2.000 peticiones
  y 30 minutos. No se ha ejecutado como parte de esta auditoría.
- El descubrimiento persiste pendientes antes de avanzar checkpoints. Los
  cursores permiten reanudar y los errores técnicos se reintentan con
  backoff y `Retry-After`. Un fallo de fuente no significa ausencia de datos.
- Conflictos y PDF parciales requieren revisión o relectura explícita.

## Límites y defectos observados

1. **Cadencia semanal RFEE:** la consulta de última ejecución exitosa también
   cuenta ejecuciones que no descargaron nada. Un salto nocturno puede
   reiniciar el intervalo semanal e impedir la descarga de mantenimiento.
   Este hallazgo no fue corregido durante la auditoría de solo lectura.
   Posteriormente el propietario autorizó corregirlo: el código preparado
   exige una ejecución terminada, exitosa y con `items_seen > 0`. Los saltos
   no reinician la semana; una descarga sin cambios sí cuenta.
2. Skermo no relee automáticamente correcciones de pruebas ya importadas;
   su clave anterior de nombre y puesto tampoco reconcilia bajas.
3. FIE conserva los datos antiguos cuando falla un grupo y no retira
   participantes ausentes de una lectura posterior. Tener 41 grupos no
   acredita frescura ni completitud de los 48 solicitados.
4. El contador WordPress incluye documentos conocidos como actualizados:
   no debe interpretarse como número de cambios de contenido.
5. La frase antigua «una petición diaria por fuente» no describe el coste
   real de rankings, regionales y detalles FIE.

Referencias: `docs/backfill-historico.md`, `src/db/schema/sport.ts`,
`src/lib/ingest/backfill/descubrimiento.ts`,
`src/lib/ingest/sources/skermo-results.ts`,
`src/lib/ingest/sources/fie-tiradores.ts` y `src/lib/ingest/runner.ts`.
