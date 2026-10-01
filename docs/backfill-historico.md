# Backfill histórico acotado

Comando: `npm run backfill`. Importa de forma gradual y reanudable resultados
históricos (FIE, Skermo, PDF de la RFEE, y Engarde/FWW como complemento).

## Cómo se usa

| Comando | Qué hace |
| --- | --- |
| `npm run backfill` | **Simulación.** Lee la base con `SELECT`, planifica, mide la ocupación y proyecta el crecimiento. No hace ninguna petición a proveedores y no escribe. |
| `npm run backfill -- --aplicar` | Ejecuta **un lote acotado** y escribe. Exige la migración 0017 aplicada por el propietario. Primero recorre los índices FIE/Skermo (como mucho la mitad de `--max-peticiones`) y luego lee las unidades. |
| `npm run backfill -- --aplicar --sin-descubrir` | Igual, pero sin recorrer índices: sólo retoma lo ya conocido. |

Opciones útiles: `--fuentes`, `--temporadas`, `--max-tareas`, `--max-peticiones`,
`--max-minutos`, `--releer`, `--releer-temporadas`, `--max-releer`,
`--unidad fuente:temporada:clave`, `--sin-descubrir` y `--plan-neon`. No hay `--help`: un
argumento no válido imprime el uso. Los límites tienen tope
(200 tareas, 2000 peticiones, 30 minutos, 50 relecturas): no hay un modo
«todo el corpus».

Nada lo lanza solo. No hay cron ni trigger asociado; cada ejecución es una
decisión de una persona.

## Qué se planifica

La planificación sale de lo ya persistido (`sport_import_coverage`), de las
unidades que se indiquen con `--unidad` y, con `--aplicar`, del inventario que
descubren los índices públicos (pruebas FIE, filas Skermo con sus enlaces HTML y
PDF). El inventario no depende de que ya exista cobertura de resultados: una
prueba descubierta y nunca leída entra como `nunca_leido`. Cada fila Skermo con
resultados HTML genera una unidad; cada PDF enlazado, una unidad por documento
con su URL, el índice de la fila y la referencia original de esa fila. La
simulación **no descubre por red**: sólo informa del inventario ya guardado.
El resumen por serie (`Serie X: descubiertas=N importadas=M`) distingue lo que
el índice nombra de lo que tiene puestos importados. Una tarea por clave de
prueba o documento, con el motivo más urgente:

1. `continuar`: la lectura FIE quedó con un cursor (fuente, temporada,
   `competitionId`, tamaño de página y página siguiente). El tope de 100
   páginas por lectura avanza a la 101; un fallo reintenta **su** página, no
   vuelve a la primera. Cerrar un lote no marca el corpus como completo.
2. `reintento_error`: 429, 5xx o fallo de red anteriores, incluido un error de
   metadata FIE (`competitions`), que se retoma sin repetir `--unidad`. Se
   reintentan hasta `--max-intentos`, también si conservan cursor; agotados
   quedan señalados para revisión y su cursor se conserva para un reintento
   explícito. Los parciales exitosos con cursor siguen avanzando.
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

## Presupuesto de peticiones y tiempo

`--max-peticiones` y `--max-minutos` son un único presupuesto compartido por el
descubrimiento, las lecturas y los reintentos. Cada petición HTTP real (FIE
metadata, ranking, poules y cuadro; índices FIE/Skermo; HTML Skermo; PDF;
Engarde; FWW) reserva una unidad **antes** de salir, y cada espera entre
lecturas o reintentos se niega si ya no cabe en el tiempo. Con
`--max-peticiones 1` sólo sale una petición, no las 4 o 100 que haría un torneo
o una prueba paginada. Una unidad cortada por el presupuesto queda `pendiente`:
no se persiste como error, no gasta un intento y conserva su cursor.

Un `429` conserva el `Retry-After` real (segundos o fecha, tope de 10 minutos) y
el orquestador espera eso, acotado por `esperaMaxMs`, el presupuesto y el
límite de tiempo. Un 403 u otro fallo no técnico no se reintenta y deja la
cobertura en `error`.

Las fuentes complementarias agregan cada hecho intentado: un tableau parcial,
diferido, en revisión o con error impide que la unidad salga `completo`. Un
parcial con 429/5xx conserva lo válido y sube la señal técnica para el backoff.
Los candidatos en revisión, conflicto o diferidos dejan URL, motivo y estado en
la cobertura, sin escribir hechos, y reemplazan un `completo` anterior.

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

Cada documento recibe su URL y la referencia original de la fila del índice. El
título de esa fila sólo se aplica a documentos con una única prueba. La
edición (nombre y rango de fechas) se decide una vez por documento, con el
rango de fechas de todas sus pruebas, y cada prueba conserva su cabecera: un
documento con pruebas de dos fechas no queda bajo la última cabecera. El hash de
un asalto incluye la fecha publicada (una corrección sólo de fecha cambia el
hash), y los asaltos aceptados guardan página, región y marcador
(`explicito` o `derivado_de_totales`) en su URL de origen.

Cuando cambia el SHA se reconcilian los hechos del documento: tras escribir la
versión nueva se borran los puestos y asaltos de ese documento que ya no
aparecen (una fila movida no se duplica y un asalto ahora conflictivo no queda
vigente). Un error técnico conserva el último dato válido. Si la corrección no
se puede aplicar con seguridad, el documento queda en `conflicto` con
`correccion_pendiente_revision` y el SHA no se acepta como leído. Limitación: la
reconciliación borra filas, no hay columna de «vigente», y no se ha probado
contra SQL real.

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
- La estimación del plan (por ejemplo 150 puestos por prueba) sólo ordena el
  lote. Justo antes de escribir, cada unidad FIE, Skermo o PDF vuelve a pasar la
  guarda con los puestos y asaltos realmente leídos (una prueba de 2400
  puestos o un torneo entero pesan más que la estimación). Si deniega o no puede
  medir, esa unidad no escribe nada, queda `pendiente` y el lote se detiene por
  capacidad. Es una proyección con tasas conservadoras, no un crecimiento
  medido ni facturado.
- El SELECT de ocupación mide el esquema público (17,84 MiB en la última
  medición); no equivale a los 27,71 MiB de la base completa ni al
  almacenamiento facturado.

## Referencias de inscripción (migración 0018)

Tras la 0018 la huella de cada lista de inscritos FIE cambia aunque sus
inscritos no. La primera lectura elegible fuerza **una** reescritura, acotada a
60 por pasada y contada aparte de los cambios reales. Las inscripciones
históricas aún sin referencia se informan por separado: no hay hidratación
automática exhaustiva, porque la cadencia sólo relee pruebas próximas. La
reescritura forzada del runner también pasa por la guarda de capacidad, con el
tamaño de las listas leídas, además del tope de 60 y la cadencia. Si la guarda
la deniega, o no puede medir, esas listas no se reescriben: conservan su huella
y su marca de lectura, no parecen hidratadas y siguen siendo elegibles. Las
listas con contenido nuevo no se retienen.

## Pendiente del propietario

Aplicar las migraciones 0017–0019 y confirmar el plan de Neon. Hasta entonces
nada de esto está probado contra SQL real, ni la reconciliación de PDF después
de la carga, ni la autenticación, ni la IA, ni un despliegue.

## Códigos de salida

`0` correcto · `1` argumentos no válidos · `2` esquema 0017 no aplicado ·
`3` parada por capacidad · `4` límite remoto (429 persistente).
