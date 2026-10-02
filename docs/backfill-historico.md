# Backfill histórico acotado

Comando: `npm run backfill`. Importa de forma gradual y reanudable resultados
históricos (FIE, Skermo, PDF de la RFEE, y Engarde/FWW como complemento).

## Cómo se usa

| Comando | Qué hace |
| --- | --- |
| `npm run backfill` | **Simulación.** Lee la base con `SELECT`, planifica, mide la ocupación y proyecta el crecimiento. No hace ninguna petición a proveedores y no escribe. |
| `npm run backfill -- --aplicar` | Ejecuta **un lote acotado** y escribe. Exige la migración 0017, que ya está aplicada (ver «Estado real tras la integración»). Primero recorre los índices FIE/Skermo (como mucho la mitad de `--max-peticiones`) y luego lee las unidades. |
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
el índice nombra de lo que tiene puestos importados.

**Progreso del descubrimiento.** Cada unidad que el índice cierra se siembra en
cobertura como `pendiente` (FIE → ranking, Skermo → resultados, PDF → documento
con su origen) **antes** de avanzar el checkpoint del índice, y el checkpoint
guarda la página siguiente. Los lotes siguientes retoman esa página o
temporada en lugar de releer el mismo prefijo, y las unidades sembradas
siguen en el plan aunque aún no se hayan ejecutado. La siembra nunca pisa una
cobertura existente. Un `429` o `5xx` del índice detiene la enumeración
posterior y conserva el checkpoint; el `429` devuelve su `Retry-After` y el
comando termina con código 4 sin ejecutar el lote, mientras que un `5xx` se
informa y el lote sigue con lo ya conocido. El dry-run no usa red.

**Filtros de ejecución frente a descubrimiento.** `--fuentes` y `--temporadas`
limitan qué se **ejecuta**: el plan sólo lee la cobertura de esas fuentes y
sus temporadas. No recortan lo que un índice completo siembra. Un índice
global (`index:RFEE`) sólo se guarda como `completo` después de sembrar todas
sus salidas (pruebas HTML y PDF), de modo que `--fuentes skermo_rfee` deja
pendientes sus `rfee_pdf` y una pasada posterior con `rfee_pdf` o sin filtro
los planifica sin releer el índice. A la inversa, `--fuentes rfee_pdf` necesita
los índices Skermo de los que salen los PDF: los recorre (dentro del mismo
presupuesto) y siembra los documentos desconocidos, pero el lote sólo ejecuta
`rfee_pdf`; las pruebas HTML descubiertas quedan pendientes sin ejecutarse. Los
índices padres no se buscan por búsqueda de interfaz: son los mismos índices
públicos del inventario.

Una tarea por clave de
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
la cobertura, sin escribir hechos, y reemplazan un `completo` anterior. Un
torneo Engarde sin prueba canónica correspondiente queda `pendiente` con
cursor `sin_canonica`, su URL y los motivos reales de la comparación; no se
asigna competición ni se infiere ausencia primaria, y un `completo` anterior
deja de figurar como vigente. Un error de fuente FWW (por ejemplo 403 en las
finales, o todas las páginas de una fase fallidas) se guarda como `error` de esa
unidad con su URL, sin borrar hechos ni denominadores anteriores; si es 429/5xx
no gasta intento, y una denegación del presupuesto sigue siendo `pendiente`,
distinta del error de la fuente.

**Fases FIE diferidas.** Con un presupuesto pequeño, una fase (poules o cuadro)
que no cabe queda `pendiente` de forma durable, sin intento ni error remoto, y
la tarea no desaparece. Si el ranking ya está completo no se vuelve a pedir en
cada lote: las ejecuciones siguientes avanzan las fases pendientes.

Los enlaces FIE conservan el `Retry-After` del JSON oficial (o de la ficha web)
hasta el resultado técnico; no se sustituye por un valor por defecto. La
metadata JSON se pide una sola vez (la del sondeo de la ficha), de modo que no
hay una segunda respuesta cuyo estado quede sin comprobar. Si el presupuesto
compartido niega una petición del camino de enlaces (sondeo o verificación de
un enlace publicado), la unidad queda `pendiente` sin intento: no se convierte
en «sin prueba oficial legible» ni en un enlace «no comprobable» guardado.

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
(`explicito` o `derivado_de_totales`) en su URL de origen. Al releer un
documento (`--releer`, o desde cobertura) sin la fila del inventario, el índice,
la referencia original y el título ya verificados del checkpoint se conservan,
de modo que la edición no cambia por faltar el contexto. El checkpoint que
siembra el descubrimiento aporta ese origen y no cuenta como una corrección.

Cuando cambia el SHA se reconcilian los hechos del documento: tras escribir la
versión nueva se borran los puestos y asaltos de ese documento que ya no
aparecen (una fila movida no se duplica y un asalto ahora conflictivo no queda
vigente). Un error técnico conserva el último dato válido. Si la corrección no
se puede aplicar con seguridad, el documento queda en `conflicto` con
`correccion_pendiente_revision` y el SHA no se acepta como leído. Antes de mutar
hechos en una corrección con lectura fiable, el documento pasa a `pendiente` con
checkpoint incompleto (sin SHA aceptado, `correccion_en_curso`); si una escritura,
la reconciliación o el checkpoint final fallan, queda `error` (o, si tampoco se
puede escribir eso, el marcador incompleto) y la ejecución siguiente la repite.
Sólo se marca `completo` con el SHA nuevo al terminar. Limitación: no hay
transacción global ni columna de «vigente», la reconciliación borra filas, y
los fallos tardíos sólo se han probado con un almacén simulado, no con SQL real.

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
- La base lógica histórica (antes de la integración) fue de 27,71 MiB. Tras el
  piloto real se midió la base completa en 29,35 → 30,17 MiB; ninguna es
  consumo facturado y no acreditan un plan.
- Un plan verificado se indica con `--neon-umbral-gib N --neon-verificado-en AAAA-MM-DD`.
- No se compra, migra ni amplía nada, y no hay ningún corte oculto.
- La estimación del plan (por ejemplo 150 puestos por prueba) sólo ordena el
  lote. Justo antes de escribir, cada unidad FIE, Skermo, PDF, Engarde o FWW vuelve a pasar la
  guarda con los puestos y asaltos realmente leídos (una prueba de 2400
  puestos o un torneo entero pesan más que la estimación). Si deniega o no puede
  medir, esa unidad no escribe nada, queda `pendiente` y el lote se detiene por
  capacidad. Es una proyección con tasas conservadoras, no un crecimiento
  medido ni facturado.
- El SELECT de ocupación mide el esquema público. La medición de simulación
  anterior a la integración dio 17,84 MiB; la del piloto real dio 18,64 MiB
  antes y 19,46 MiB después (+0,82 MiB, con un tope de piloto de 16 MiB). No
  equivale a los 29,35 → 30,17 MiB de la base completa ni al almacenamiento
  facturado, y las cifras no son comparables entre sí como una serie.

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

## Piloto de IA sobre PDF (límite 10 documentos y 1 €)

**Estado: sin inferencia real.** El usuario aprobó un piloto de **hasta diez PDF
y 1 € en total**; esa autorización existe y el limitador la respeta como tope.
Aun así **no se ha enviado ningún PDF a ningún modelo ni existe consumo
observado**, porque lo que sigue sin verificarse es la vía, no el permiso:

- **Acceso y modelo.** El binding `AI` existe, pero el token del proyecto no
  tiene permiso de Workers AI (la vía REST responde 401) y no hay una inferencia
  aceptada por esta cuenta ni el modelo `@cf/zai-org/glm-5.3-flash` confirmado
  para ella.
- **Coste y cuota de la cuenta.** Cloudflare publica la tarifa (0,15 US$ por
  millón de tokens de entrada y 0,50 US$ de salida, consultada el 02/10/2026),
  pero eso no acredita el plan, la cuota ni el precio efectivo de **esta** cuenta.
- **Privacidad.** Cloudflare declara que no entrena con el contenido del cliente,
  pero un PDF de resultados es un listado nominal (posibles menores) y no se
  envía a un modelo sin acreditar su tratamiento.

No hay proveedor alternativo, compra ni gasto nuevo. La bandera
`aprobacionExplicita` del código se mantiene a `false` mientras la vía no esté
verificada (conservador): el visto bueno de presupuesto no equivale al de enviar
un documento concreto. El commit `6b969ba` añadió las guardas y un informe local
sin inferencia real; nada de ello es una lectura de IA ni un resultado
extraído.
`src/lib/ingest/backfill/piloto-ia.ts` es el limitador, probado con un cliente
falso (`tests/piloto-ia.test.ts`):

- Bloquea el documento 11, un documento ya intentado (no hay reintentos, ni
  tras un fallo) y toda llamada cuya **estimación conservadora** (1 token por
  carácter, prompt fijo de 20.000 tokens, salida al tope de 8.192 y margen 1,25)
  sumada a lo ya comprometido supere 1 €. Importes en micro-euros enteros.
- Reserva antes de llamar. Un fallo conserva la estimación como gasto posible.
- Exige vía verificada (acceso, modelo, plan/cuota, condiciones de datos y
  aprobación explícita) y privacidad `sin_datos_personales`; si falta algo no se
  invoca al cliente.
- Libros separados por modo (`.piloto-ia/libro-real.json` y
  `libro-simulacion.json`, ignorados por git): una simulación no gasta
  presupuesto real y un libro ilegible falla en vez de reiniciar el contador.
- Una extracción de IA es siempre `pendiente_revision_humana`; la ambigua, la sin
  citas verificadas y la simulada se descartan.

`npm run piloto-ia -- --archivo a.pdf [--archivo b.pdf] [--simular]` mide
páginas, bytes y caracteres en memoria y muestra tres escenarios de coste
(bajo, base, conservador) marcados como estimación previa, no factura. No tiene
modo de envío y no imprime texto. El coste simulado nunca se presenta como
consumo observado.

## Estado real tras la integración (02/10/2026)

Las migraciones 0017–0019 **ya están aplicadas** en Neon (PostgreSQL 18.0.6),
con sus tres filas de ledger (de 16 a 19) en una sola transacción de 70
sentencias; las 13 tablas `sport_*` y las categorías M10/M12 existen. No hay
más SQL ni ingesta pendientes para esa integración, y no se reaplican (ver
`docs/migraciones-deportivas.md`).

El piloto real fue acotado y **no es un corpus completo**: dos pruebas FIE de
París 2024 (una edición), una de Bogotá 2027, un PDF de la RFEE 2018-2019
(cobertura parcial: poules 16/84, 4 regiones sin atribución segura) y un ranking
oficial FIE 2024 (903 entradas). Ninguno de los puestos del PDF ni de las
entradas del ranking quedó enlazado a una persona. Las relecturas del ranking y
del PDF devolvieron `sin_cambios`. Se usaron `SELECT` mínimos y las funciones de
lectura existentes; no se probaron las lecturas autenticadas de la interfaz.

Límites de esa evidencia: 21 peticiones HTTP conocidas más una invocación mal
entrecomillada de la que no se conoce el número de peticiones; por tanto no se
afirma un total exhaustivo ni que se cumplieran los límites de 40 peticiones y
300 s para todo el conjunto. La igualdad de conteos legacy antes y después del
piloto no prueba igualdad de valores, y `notification` tiene 3 filas sin
atribución confirmada.

## Pendiente del propietario

Las migraciones y el piloto acotado ya están hechos (ver arriba); no queda SQL
pendiente. Lo que sigue pendiente es:

- Confirmar el plan de Neon (el umbral conservador de 0,4 GiB sigue vigente
  mientras no se verifique).
- Decidir si el backfill sigue por lotes acotados (`--aplicar`), fuente por
  fuente. Nada lo lanza solo y no existe un lote «todo el corpus».
- Piloto de IA: el permiso de presupuesto (hasta diez PDF y 1 €) **ya lo dio el
  usuario**; no falta permiso. Lo que no está verificado es la vía de
  inferencia, el coste y la cuota de esta cuenta, el modelo y el tratamiento de
  datos de menores. Hasta acreditarlo no se envía ningún PDF ni se gasta nada.
- La reconciliación de PDF tras la carga real y la autenticación con sesión
  propia se comprueban con la QA privada manual posterior a publicar
  (`docs/matriz-qa-manual-responsive.md`); el agente no las ejecutó. El Worker
  ya está publicado (ver `docs/entrega-release.md`).

## Códigos de salida

`0` correcto · `1` argumentos no válidos · `2` esquema 0017 no aplicado (hoy ya
está aplicado; el código 2 del preflight de `aplicar-migraciones-deportivas.ts`
es otro comando y significa «ya aplicado») · `3` parada por capacidad · `4`
límite remoto (429 persistente).
