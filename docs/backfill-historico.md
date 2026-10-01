# Backfill histórico acotado

Comando: `npm run backfill`. Importa de forma gradual y reanudable resultados
históricos (FIE, Skermo, PDF de la RFEE, y Engarde/FWW como complemento).

## Cómo se usa

| Comando | Qué hace |
| --- | --- |
| `npm run backfill` | **Simulación.** Lee la base con `SELECT`, planifica, mide la ocupación y proyecta el crecimiento. No hace ninguna petición a proveedores y no escribe. |
| `npm run backfill -- --aplicar` | Ejecuta **un lote acotado** y escribe. Exige la migración 0017 aplicada por el propietario. |

Opciones útiles: `--fuentes`, `--temporadas`, `--max-tareas`, `--max-peticiones`,
`--max-minutos`, `--releer`, `--releer-temporadas`, `--max-releer`,
`--unidad fuente:temporada:clave` y `--plan-neon`. No hay `--help`: un
argumento no válido imprime el uso. Los límites tienen tope
(200 tareas, 2000 peticiones, 30 minutos, 50 relecturas): no hay un modo
«todo el corpus».

Nada lo lanza solo. No hay cron ni trigger asociado; cada ejecución es una
decisión de una persona.

## Qué se planifica

La planificación sale de lo ya persistido (`sport_import_coverage`) más las
unidades que se indiquen con `--unidad`. Una tarea por clave de prueba o
documento, con el motivo más urgente:

1. `continuar`: la lectura FIE quedó con un cursor (fuente, temporada,
   `competitionId`, tamaño de página y página siguiente). El tope de 100
   páginas por lectura avanza a la 101; un fallo reintenta **su** página, no
   vuelve a la primera. Cerrar un lote no marca el corpus como completo.
2. `reintento_error`: 429, 5xx o fallo de red anteriores. Se reintentan hasta
   `--max-intentos`; agotados quedan señalados para revisión.
3. `categorias_ampliadas`: unidades que esperaban M10/M12; se releen una sola
   vez, y sólo cuando la migración 0019 está aplicada.
4. `nunca_leido`, `cadencia_reciente` (pruebas de los últimos días, como mucho
   cada 12 horas) y `releer` (explícito y acotado).

«Completo» no acredita frescura ni repara nada: sólo se vuelve a leer por
cadencia, por `--releer` o porque su cursor dice que no terminó. Un contenido
idéntico no crea revisiones ni snapshots diarios. Los conflictos van a revisión
humana y no se reintentan solos.

Las fuentes primarias (FIE, Skermo, PDF) se leen y persisten antes que las
complementarias (Engarde, FWW), que cotejan contra la prueba canónica ya
guardada. Sin canónica no se escribe nada, y la ausencia de inventario nunca se
convierte en `sin_resultados` para forzar una importación.

## Qué significa cada estado

`pendiente`, `parcial`, `no_publicado`, `error`, `conflicto` y `completo`. Un
`completo` sólo habla de **lo publicado** por esa fuente y exige un denominador
conocido. `no_publicado` y `sin_resultados` sólo se registran cuando una lectura
lo acredita; un fallo técnico (429/5xx) deja la unidad en `error` con el
progreso conservado, y la ausencia de lectura sigue siendo «sin datos». El
índice de una serie (Copa de España, Circuito, etc.) no demuestra que sus
resultados estén importados.

## PDF

Los PDF se leen en memoria y **no se guardan en Neon**: sólo URL, SHA-256,
páginas, regiones y motivo de revisión. Las referencias locales (`p0001`) se
namespacean por documento y prueba y nunca se promueven a una identidad global
por prefijo o nombre. Documentos de más de 25 MiB o 400 páginas, hosts no
admitidos o bloqueados quedan en `error`/`pendiente` reanudable, nunca se
truncan en silencio. No se ejecuta OCR ni IA.

## Un solo importador por clave

Dentro de una ejecución, lectura, comparación, escritura y checkpoint de una
misma clave de ranking van en secuencia y no se planifican duplicados. Entre
ejecuciones no hay locks distribuidos ni CAS: el límite operativo es **un solo
importador por clave a la vez**. No lances dos `--aplicar` solapados.

## Capacidad

Antes de cada tarea se mide la ocupación lógica (tablas + índices, sólo
`SELECT` sobre el catálogo) y se proyecta el crecimiento con tasas
conservadoras. Si `actual + proyectado` no queda por debajo del umbral, el
lote se detiene, conserva lo pendiente y pide una decisión al propietario (código
de salida 3). Sin medición tampoco se continúa. El informe incluye la medición
antes y después, y la diferencia por tabla e índices.

- Umbral por defecto: **0,4 GiB** mientras el plan de Neon no esté verificado.
- La base lógica observada al empezar fue de 27,71 MiB; no es el consumo
  facturado.
- Un plan verificado se indica con `--neon-umbral-gib N --neon-verificado-en AAAA-MM-DD`.
- No se compra, migra ni amplía nada, y no hay ningún corte oculto.

## Referencias de inscripción (migración 0018)

Tras la 0018 la huella de cada lista de inscritos FIE cambia aunque sus
inscritos no. La primera lectura elegible fuerza **una** reescritura, acotada a
60 por pasada y contada aparte de los cambios reales. Las inscripciones
históricas aún sin referencia se informan por separado: no hay hidratación
automática exhaustiva, porque la cadencia sólo relee pruebas próximas.

## Códigos de salida

`0` correcto · `1` argumentos no válidos · `2` esquema 0017 no aplicado ·
`3` parada por capacidad · `4` límite remoto (429 persistente).
