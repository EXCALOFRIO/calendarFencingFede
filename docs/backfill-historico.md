# Backfill histórico acotado

Comando: `npm run backfill`. Importa de forma gradual y reanudable resultados
históricos (FIE, Skermo, PDF de la RFEE, y Engarde/FWW como complemento).

El runtime se está migrando a D1. Los apartados que identifican explícitamente
Neon o el piloto del 02/10 son evidencia histórica, no instrucciones para
escribir ahora en esa base. El destino remoto D1 aún no tiene el esquema ni
las filas de aplicación. Ver [`migracion-cloudflare.md`](migracion-cloudflare.md).

## Estado acumulado verificado el 03/10/2026

El snapshot base privado contiene 1.585 competiciones, 50.482 resultados,
32.955 asaltos y 107 publicaciones de ranking con 36.126 entradas.
Después de la importación real FIE/RFEE, la copia local verificada contiene
**5.256 competiciones, 248.694 resultados y 668.128 asaltos**:
3.671, 198.212 y 635.173 más, respectivamente. Conserva 13.299 registros
de persona/ID externo, sin altas ni fusiones por nombre. Pasan FKs,
`quick_check`, procedencia y cierre de contexto/lease; el ledger está
desbloqueado, 2.687.373.604 bytes, y SQLite ocupa 637.751.296 bytes.
No es un tope físico perfecto ni una medida de gasto.

Producción todavía utiliza Neon y D1 remoto sigue sin aplicación. El
histórico local es staging previo al corte, no un sustituto del export final.

El propietario autorizó una segunda vuelta finita de fuentes:

- FIE: 3.154 unidades evaluadas, 3.137 cerradas, 11 parciales y seis errores.
  La nueva ventana terminó en `inventory_exhausted`, con 212 reservas GET
  adicionales. Los fallos Windows de ventanas anteriores se conservan
  como evidencia; no se atribuye retrospectivamente su operación concreta.
- RFEE: **2.350 de 2.353 documentos guardados** (99,9 %): 942 HTML y 1.408
  PDF. Tres respuestas HTTP 200 no contienen el tipo publicado y quedan
  como `invalid_payload`, no como resultados vacíos o descargados válidos.
  No quedan documentos `pending` en ese inventario; la ejecución terminó.
- La primera reanudación nacional se detuvo tras 15 documentos por `EPERM`.
  Se amplió únicamente el retry de reemplazo **local** del checkpoint
  (máximo 4,55 s, sin borrar el anterior ni repetir GETs). La continuación
  posterior conservó contadores, campaña anterior, blobs y cooldown.
- RFEE: 2.362 reservas GET acumuladas y 276.122.872 bytes de payload local.
  Estos bytes no representan almacenamiento R2 ni filas importadas.

Los porcentajes solo describen esos inventarios 2018/2019+, no todo el
histórico disponible ni el porcentaje importado. No hay escrituras deportivas
nuevas en Neon. Las aprobaciones anteriores no se reabren ni reinician.

La campaña FIE procesó 3.154 unidades, con 205.443 puestos y 662.963 asaltos
leídos, 364.323 sentencias reservadas y sin flag de escritura incompleta.
Los seis errores y 650 unidades con fuente parcial se conservan. «Persistida»
en el resumen puede significar cobertura, no competición válida.

La campaña HTML terminó con 942 unidades, código 0: releyó 31.151 puestos
que ya existían. La campaña PDF final procesó 1.411 entradas, código 0:
1.408 con persistencia, tres malformadas, 15.443 puestos/5.850 asaltos leídos
y 20.487 sentencias reservadas, sin escritura incompleta. Añadió realmente
2.194 resultados y 1.599 asaltos; no todos los hechos leídos son aceptados.
La cobertura documental final es: 13 completos, 836 parciales, 553 pendientes,
dos conflictos, un error y seis sin resultados. OCR/revisión no se ejecutó.

El primer lote PDF se detuvo por una reserva agotada al volver a cargar el
cursor antiguo no modificado. Se preservaron base y recibos, se reprodujo en
SQLite nativo y se corrigió la carga UPDATE por columnas cambiadas completas.
Se mantienen 4 GiB, admisión atómica, overhead por fila, control de amplificación
SQL y bloqueo durable poscommit. Una revisión posterior detectó correcciones
con asaltos contradictorios y una importación inicial sin marcador previo:
ambas se corrigieron y se repitió todo el PDF desde una copia anterior preservada.

La caché nacional ampliada quedó **archivada y verificada**: 2.109 blobs y
su manifiesto, 278.467.814 bytes; 971 blobs nuevos y 1.138 reutilizados,
código 0 en 992,17 s. Son bytes de originales y evidencia, no resultados
deportivos. FIE quedó archivado y verificado con 9.614 blobs, tres particiones,
7.759 nuevos/1.855 reutilizados y 216.577.918 bytes incluyendo metadatos.
El índice, sus tres particiones y el manifiesto original se releen y verifican
por hash, código 0. La partición mantiene ≤3.500 blobs y ≤4 MiB por manifiesto;
el replay selecciona ≤10 unidades/64 MiB. No se elevan a ciegas esos límites.

El inventario anterior conserva 6.063 coberturas FIE pendientes,
mayoritariamente 1958–2017. Un inventario agotado no equivale a histórico completo.

**Identidad nacional/internacional pendiente:** el mismo snapshot contiene
4.474 personas con ID FIE confirmado y 8.825 con licencia RFEE confirmada,
sin fusiones aplicadas. No se presentan como 13.299 deportistas globalmente
distintos ni como fichas ya unificadas. Los IDs/licencias con ámbito y
vigencia permiten confirmar enlaces; el nombre solo propone candidatos.
La conciliación masiva requiere evidencia y revisión antes de escribir.

## Cómo se usa

### Campaña offline con caché verificada

```powershell
node node_modules/tsx/dist/cli.mjs scripts/importar-campana-historica-local.ts --d1-local 'C:\datos\historico.sqlite' --fuente pdf --cache-nacional 'C:\datos\cache-rfee' --aplicar --solo-hechos --offset 0 --max-unidades 1411 --max-segundos 1800 --max-sentencias 500000
```

El destino es un SQLite existente con `0002` exactamente verificado y sin
`DATABASE_URL` en ese proceso. La campaña fija el SHA de origen en cada unidad,
crea un lock exclusivo y recibos privados, nunca descarga ni escribe remoto.
Máximo 6.000 unidades/30 minutos/500.000 sentencias, cada unidad ≤300 s/1.000
sentencias. Un fallo de escritura detiene y conserva el posible estado parcial;
un parcial de fuente continúa como cobertura honesta. Al reanudar se incluye
la unidad fallida, no se presume rollback ni se borra el ledger.

Los PDF usan SHA-256 de URL completa como namespace. Un namespace de filename
antiguo solo se adopta tras comprobar URL exacta de edición, competición y
checkpoint. Toda importación marca incompleto antes de hechos; una corrección
con poules/cuadro parcial o contradictorio no retira hechos previos.

### Continuación de descargas, sin base de datos

`scripts/continuar-descargas-acotadas.ts` requiere una aprobación explícita
con UUID y una duración finita. Sin `--apply` solo lee recuentos locales;
no hace red ni escribe. Un mismo UUID reanuda **su** plazo y límites
originales. Una aprobación terminada no se reabre. Cada ventana tiene
≤2.000 GETs, ≤30 minutos y ≤512 MiB de crecimiento, con ≥350 ms entre
inicios, una petición simultánea por fuente y ≥5 GiB libres. Los dos
procesos de fuente pueden trabajar en paralelo con raíces y locks distintos.

No se reinician contadores, no se borra la campaña anterior y no se saltan
robots o cooldown. La autorización completa se conserva en registros
inmutables separados; el programa no renueva ventanas tras errores de
fuente, integridad, disco o señales. El reemplazo local bloqueado temporalmente
puede reintentarse de forma acotada, no la petición HTTP.

```powershell
# Sustituir raíz e inventario por rutas absolutas de la caché ya existente.
# Ejecutar con --apply solo después de autorizar esa continuación acotada.
node --import tsx scripts/continuar-descargas-acotadas.ts --source fie --root C:\datos\cache-fie --approval '<UUID-v4>' --minutes 180
node --import tsx scripts/continuar-descargas-acotadas.ts --source rfee --root C:\datos\cache-rfee --inventory C:\datos\national-inventory.json --approval '<UUID-v4>' --minutes 60
```

Las 83 pruebas focalizadas de caché, ventanas y reemplazo pasaron offline.
La continuación descarga originales, no extrae PDF, no usa OCR/IA, no sube
R2 y no crea hechos deportivos o enlaces de identidad.

### Ingesta deportiva acotada

| Comando | Qué hace |
| --- | --- |
| `npm run backfill -- --d1-local C:\datos\app.sqlite` | **Simulación.** Lee un SQLite existente, planifica, mide y proyecta. No pide datos a proveedores ni escribe. |
| `npm run backfill -- --d1-local C:\datos\app.sqlite --aplicar` | Escribe **un lote local acotado**. Exige `0000` y `0002` ya verificados, lease global y proceso sin `DATABASE_URL`. Descubrimiento y lectura comparten el presupuesto. |
| `npm run backfill -- --d1-local C:\datos\app.sqlite --aplicar --sin-descubrir` | Igual, sin recorrer índices: retoma unidades conocidas, pero sus lectores sí pueden hacer GETs. No es un modo offline de caché. |

Sin `--d1-local` el comando se niega antes de abrir la base. No acepta destinos
remotos ni parámetros de Neon y no aplica migraciones. Instalar `0002` solo
después del import verificado. Los cuatro CLI antiguos de resultados,
inventario y complementos deniegan `--aplicar` antes de cualquier I/O.
Una campaña agotada no se reinicia por ejecutar otra vez el comando: hace
falta aprobar otra ventana acotada de fuentes.

Opciones útiles: `--fuentes`, `--temporadas`, `--max-tareas`, `--max-peticiones`,
`--max-minutos`, `--releer`, `--releer-temporadas`, `--max-releer`,
`--unidad fuente:temporada:clave` y `--sin-descubrir`. No hay `--help`: un
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

## Un solo propietario deportivo D1

Dentro de una ejecución, lectura, comparación, escritura y checkpoint de una
misma clave de ranking van en secuencia y no se planifican duplicados. Entre
ejecuciones D1 usa un lease global de 120 segundos, CAS con reloj de la base
y una versión creciente al reclamar. Cada mutación comprueba propietario y
versión dentro del mismo batch atómico, con contexto efímero vacío al terminar
o revertir. No lances dos `--aplicar` solapados.

## Capacidad D1 actual

El runtime mide almacenamiento total con `meta.size_after` de un `SELECT 1`
y cuenta hechos sin leer sus cuerpos. No usa PRAGMAs de tamaño, que el D1
remoto deniega, ni inventa tamaños de tablas o índices. La asignación propia
máxima es 8 GiB (desde `0005_presupuesto_8gib.sql`; antes 4 GiB); puede
reducirse con `D1_STORAGE_BUDGET_BYTES`. No es un límite de gasto ni una cuota
exclusiva de esta aplicación; D1 admite hasta 10 GB por base en el plan de pago.

Antes de cada escritura se reserva crecimiento conservador en un ledger
atómico. Si falta medición, esquema o margen, no se inicia ese batch.
El tamaño definitivo se comprueba después del commit: un crecimiento mayor
del previsto o una escritura ajena puede dejar un error poscommit y bloqueo
durable, no rollback retroactivo. El incremental sigue apagado y aún requiere
validación sobre el runtime D1 remoto.

### Mediciones y política de Neon del piloto, solo como historial

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

El piloto y las migraciones PostgreSQL descritos arriba ya están hechos.
Eso no significa que el corte D1 esté terminado. Sigue pendiente:

- Validar Neon Auth gestionado y el secreto existente, coordinar mantenimiento y snapshot final,
  importar D1, verificar y publicar. No borrar Neon ni aplicar allí 0021.
- Verificar las cuotas compartidas y la facturación Cloudflare antes de
  ampliar almacenamiento o activar extracción incremental.
- La continuación de descargas locales ya está autorizada y se reanudó.
  La extracción/importación sigue separada y requiere un destino validado
  y lotes acotados; no existe un lote ilimitado «todo el corpus».
- Piloto de IA: el permiso de presupuesto (hasta diez PDF y 1 €) **ya lo dio el
  usuario**; no falta permiso. Lo que no está verificado es la vía de
  inferencia, el coste y la cuota de esta cuenta, el modelo y el tratamiento de
  datos de menores. Hasta acreditarlo no se envía ningún PDF ni se gasta nada.
- La reconciliación de PDF tras la carga real y la autenticación con sesión
  propia se comprueban con la QA privada manual posterior a publicar
  (`docs/matriz-qa-manual-responsive.md`); el agente no las ejecutó. El Worker
  ya está publicado (ver `docs/entrega-release.md`).

## Códigos de salida

### Replay estricto de originales locales

`scripts/replay-historico-d1.ts` lee exclusivamente las cachés verificadas.
No hace descubrimiento, HTTP, fallback a fuentes ni OCR. Exige un destino
SQLite local absoluto y selecciones explícitas: `--fie <año>:<id>`,
`--html <id-cache>` o `--pdf <id-cache>`. Por defecto simula; `--aplicar`
requiere un entorno sin `DATABASE_URL` y las guardias D1 ya aplicadas.

Comprueba todos los hashes antes de abrir el destino. Máximo diez unidades,
300 segundos cooperativos y 1.000 sentencias de contexto/aplicación; cada
unidad admite como máximo 1.056 puestos y 2.000 asaltos. Las unidades con
contexto ambiguo se rechazan. Los parciales siguen siendo parciales. Una
parada puede dejar unidades anteriores comprometidas: no es una transacción
del corpus y el resumen lo indica. La pasada tiene 41 pruebas offline;
todavía no se ha ejecutado con los históricos reales.

Este comando usa `0` si terminó sin incidencias y `2` para una selección,
destino, esquema, límite o lectura incompleta. No comparte los códigos del
planificador descrito a continuación.

### Planificador

`0` correcto · `1` argumentos no válidos · `2` destino local o esquema D1
ausente/inválido · `3` parada por capacidad · `4` límite remoto (429 persistente).
El código 2 del preflight antiguo de migraciones PostgreSQL es de otro
comando y significa «ya aplicado».
