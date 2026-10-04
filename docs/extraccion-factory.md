# Extracción histórica con Factory

Este carril es independiente: no importa candidatos, no abre DB, no sube R2,
no modifica cachés, catálogos, Git ni despliegues. Usa sesiones nuevas de
`droid exec`, modelo `gpt-6-sol` por defecto, una por PDF oficial o competición FIE.
No usa HTTP personalizado ni OCR. CLI revisado: `0.230.0`.

## Preparar y revisar sin red

Ejecutar desde la raíz con `npx --no-install tsx scripts/extraer-historico-factory.ts --help`.
No hay modelo ni red por defecto. Seleccionar explícitamente hasta 250 unidades:

```json
[{"tipo":"fie","season":2025,"competitionId":123}]
```

O PDF: `[{"tipo":"pdf","id":"pdf-<64 caracteres hex>"}]`.
El hash es el del **manifest original**, no el de un blob. Rutas absolutas.

```powershell
npx --no-install tsx scripts/extraer-historico-factory.ts --preparar --fuente fie --cache C:\cache-publica --seleccion C:\seleccion.json --manifiesto-sha256 <SHA256>
npx --no-install tsx scripts/extraer-historico-factory.ts --plan <CARPETA_PRIVADA> --plan-sha256 <SHA256_PLAN>
```

La preparación valida el archivo local y copia únicamente los blobs públicos
seleccionados a una carpeta nueva privada temporal fuera del repositorio.
Conserva el manifiesto seleccionado, su vínculo SHA256 al manifest original,
un plan fijado por hash, inputs, prompts y controles exclusivos por trabajo.
En Windows usa ACL privada mediante el helper existente. Revisar el plan y
los prompts antes de autorizar. No se envían perfiles, exportaciones ni DB.

## Piloto obligatorio y ejecución

La ruta de Droid debe ser la del ejecutable real absoluto (`.exe` en Windows),
no un alias/script. En instalaciones npm, el shim `bin/droid` resuelve el
ejecutable de `@factory/cli-win32-x64`; no se pasa `node.exe` como Droid.
El ejecutable se verifica por hash con un límite de 384 MiB.
El piloto real no se ha ejecutado durante las pruebas offline.

```powershell
npx --no-install tsx scripts/extraer-historico-factory.ts --plan <CARPETA> --plan-sha256 <HASH> --droid <EXE> --piloto-capacidad --ejecutar --max-sesiones 1
npx --no-install tsx scripts/extraer-historico-factory.ts --plan <CARPETA> --plan-sha256 <HASH> --droid <EXE> --ejecutar --max-sesiones 5 --concurrencia 2 --timeout-segundos 300 --pared-segundos 900
```

El piloto intenta leer un sentinel benigno fuera de los inputs (debe ser
denegado) y después un input permitido. Se valida el envelope JSON de Droid,
el resultado JSON y el audit real del hook con el mismo session UUID. Solo así
se crea `capability-receipt.json`, vinculado a plan, hashes de Node/Droid,
versión, modelo, hook, settings, envelope y audit. Sin ese receipt válido no
arrancan PDFs/FIE. La prueba debe fallar si políticas organizativas ignoran
hooks locales o el CLI no ejecuta el hook. No se rebajan estas políticas.

Cada trabajo permite únicamente `Read`, sin skills integrados, autonomía off.
La configuración por proceso usa `cloudSessionSync:false`, `hooksDisabled:false`
y Droid Shield activo. El entorno del hijo usa allowlist de variables de sistema
y login normal de Factory; elimina variables de apps/DB/despliegue, precargas
Node, browser y credenciales cloud. No copia ni imprime credenciales.
Los comandos usan flags del CLI instalado: `--only-tools Read`, `--file`,
`--settings`, `--cwd`, `--output-format json`. No `-p`, unsafe, auto,
session-id, fork, Task, Execute, Fetch ni selección MCP.

## Límites y recuperación

- Concurrencia 1–8; `--max-sesiones` obligatorio (el ejemplo acota a 5).
- Hasta 600 segundos por proceso, 3600 por campaña; defaults 300/900.
- Hasta 4 MiB combinados stdout/stderr por sesión; 3 MiB por input,
  16 MiB por trabajo, 250 trabajos por plan.
- Lock exclusivo de campaña y archivos `wx`: nunca sobrescribe planes,
  inputs, inicios, outputs ni receipts. Fin de campaña/error/señal aborta
  y drena los hijos propios; Windows usa `taskkill /PID <propio> /T /F`,
  nunca nombres de proceso, búsquedas o procesos de migración ajenos.
- Un receipt permite resume solo tras revalidar plan, fuente, modelo,
  prompt, resultado, envelope y audit. Un inicio sin receipt es ambiguo:
  parar y reconciliar manualmente consumo/sesión/outputs. No borrar marcadores
  ni relanzar a ciegas. Un lock dejado por caída también exige revisión manual.

## Esquema y aceptación

`candidate.json` es schema v1 estricto: metadata nullable, fuentes/páginas o
endpoints revisados, facts de clasificación/poule/tableau, nombres/posiciones/
scores originales y evidencia con hash, página/región o JSON pointer y excerpt.
No IDs inferidos ni fusión de personas por nombre. Texto de fórmulas permanece
texto, jamás se evalúa. Hay estados `candidate`, `partial`, `unreadable`, `empty`
y `not_published`; nunca `complete` por éxito del proceso o validez del JSON.
Todo resultado lleva `acceptance:"requires_source_reconciliation"`.
Los punteros/excerpts y exhaustividad deben reconciliarse con la fuente antes
de aceptar hechos; esta CLI no es un importador y no certifica cobertura.

Prompts, resultados, stderr, audit y receipts quedan privados fuera de Git.
Los logs resumen solo códigos, hashes, conteos y la carpeta operativa.
No se imprimen nombres ni contenido de fuentes.

## Frontera de seguridad y pendientes

El hook Node revisado bloquea **todos** los tools salvo Read de archivos exactos
fijados, rechaza traversal/symlinks, comprueba archivo regular/size/hash de nuevo,
sale 2 ante input inválido y emite deny JSON. Reads permitidos salen 0 sin
`permissionDecision:allow` (no bypass de permisos). Audit no contiene rutas
ni contenido bruto. Hashes se verifican antes y después de cada sesión.

Esto es contención a nivel tool, **no un sandbox OS**. No evita las lecturas
internas de configuración/login del CLI, la carga de integraciones globales,
hooks/plugins organizativos ni escrituras internas de transcripts en el home
normal de Factory (fuera de Git). Tampoco protege frente a un operador local
malicioso que altere archivos/audits/receipts o una carrera hash/Read. No se
deshabilitan controles globales/org; políticas incompatibles bloquean el piloto.
Los archivos `wx` no son WORM ni están firmados.

El responsable ya verificó pilotos reales de contención, PDF nativo y FIE
pequeña; sus planes/receipts pueden reutilizarse como semillas validadas, nunca
relanzarse a ciegas. Los planes nuevos conservan su gate capability independiente.
Sigue pendiente el contraste manual de cada candidato con sus fuentes/evidencias.
La capacidad de lectura PDF no se infiere del piloto de texto. Si el lector
falla para otra fuente, producir unreadable, no añadir OCR.
No ejecutar durante la congelación productiva sin coordinación del responsable.

## Todo el inventario público, en lotes

`scripts/lotes-historico-factory.ts` coordina ambos inventarios locales completos.
Preparar/preflight no llaman a Droid ni al modelo. No descargan ni modifican
las cachés. La preparación fija los dos hashes de manifests originales, copias
íntegras privadas y un `inventory.json` inmutable. Excluye HTML y auxiliares FIE;
PDF inválido, JSON inválido, sin inputs útiles y límites incompatibles quedan
como gaps explícitos. Hashes/rutas alterados son un bloqueo, no un gap inventado.

Cada plan contiene una sola fuente, hasta 250 unidades, hasta 256 MiB de blobs
referenciados y hasta 3000 referencias. Una competición nunca se divide.
El número real de planes puede aumentar por límites de bytes/referencias.
Hay un piloto capability por **plan**, no por documento.

Los pilotos fuente ya completados pueden conservarse como semillas:
`--semillas` recibe JSON con `directory` y `planSha256`. Se comprueban con el
validador normal de plan/controles/fuente/receipt/audit/capability, se contrastan
contra el inventario completo actual y se omiten de nuevos planes. No hay
skipping por ID/hash suelto ni receipts falsos para desbloquear campañas.

```powershell
# JSON de semillas: usar un fichero privado ABS; no publicarlo ni versionarlo.
# [{"directory":"ABS_PLAN_RFEE","planSha256":"HASH"},{"directory":"ABS_PLAN_FIE","planSha256":"HASH"}]
npx --no-install tsx scripts/lotes-historico-factory.ts --preparar --cache-rfee <ABS_CACHE_RFEE> --cache-fie <ABS_CACHE_FIE> --semillas <ABS_JSON_SEMILLAS>
npx --no-install tsx scripts/lotes-historico-factory.ts --portfolio <ABS_CARPETA> --portfolio-sha256 <HASH>
npx --no-install tsx scripts/lotes-historico-factory.ts --portfolio <ABS_CARPETA> --portfolio-sha256 <HASH> --ejecutar --droid <ABS_EXE_NATIVO> --max-sesiones-total <N_ELEGIBLES> --trabajos-paso 10 --concurrencia 2 --timeout-segundos 300 --pared-paso-segundos 900 --pared-total-segundos 43200
```

`--max-sesiones-total` es obligatorio y limita **intentos fuente nuevos por
invocación**, no receipts revalidados ni pilotos capability (estos se cuentan
aparte: máximo uno por plan). Nunca puede superar el inventario elegible.
Defaults: pasos de 10, concurrencia 2, 300s/proceso, 900s/paso, 12h globales.
Máximos: 250/paso, concurrencia 8, 600s/proceso, 3600s/paso, 48h globales.
El default sigue siendo 2. Aumentarlo exige elegirlo explícitamente en una nueva
invocación, tras verificar el cierre seguro de la anterior. No se inicia otro
coordinador sobre sesiones en curso. Las pruebas de ocho workers usan transporte
simulado: no prueban cuotas, memoria del CLI real ni una mejora concreta de velocidad.
La cancelación global se propaga al runner normal; el drenaje/teardown propio
puede añadir hasta 12 segundos al plazo. No hay watcher infinito.

Se mantienen caps de 4 MiB stdout+stderr, 256 KiB/audit, 32 MiB/progress y 64 GiB
de artefactos privados por portfolio; cada paso exige espacio disponible más
la reserva de 512 MiB del helper existente. Timeout/cancelación/salida inválida
conservan el prefijo de salida capturado, sin imprimirlo. No se inspeccionan ni
terminan procesos de importación ajenos.

Cada unidad tiene como máximo un intento fuente dentro de este portfolio.
Un fracaso ordinario con audit válido queda en `portfolio-failure.json`,
`acceptance:"requires_reconciliation"`: se fija la identidad y los hashes de
todos los artefactos existentes, no se acepta ni reintenta. Ese worker termina,
pero los siblings independientes no se cancelan por un fallo de calidad.
Cancelar antes de su primer Read puede dejar un start sin audit y provocar
un aborto global. Los fallos fatales y los plazos globales sí cancelan y drenan
las sesiones propias. Los aún no iniciados pueden avanzar.
Starts ambiguos con evidencia de hook válida se separan para revisión manual.
Audit ausente/ilegible, tool/path no autorizado, drift, errores desconocidos de
seguridad o fallo de teardown abortan **todo**; no se saltan para continuar.
También abortan globalmente un código de salida no cero (incluidas cuota o
autenticación), un envelope inválido, un arranque fallido y una salida con
codificación o estado de cierre inválidos, aunque haya lecturas auditadas.
Con hasta ocho sesiones, un fallo fatal prevalece sobre los fallos de
calidad o cancelaciones de las demás. Se esperan todos los cierres antes de devolver
el error; un cierre o drenaje fallido impide iniciar el siguiente paso.
No borrar/reparar starts, outputs, receipts ni locks abandonados para forzar
una repetición. Tampoco crear portfolios nuevos para esquivar la reconciliación:
no existe un ledger global fuera de estas carpetas.

Resume revalida evidencia aceptada y fallida antes de nuevos intentos. Un
receipt válido representa candidato, no certeza deportiva: las filas de hechos
no son combates deduplicados. `successful` incluye candidatos vacíos/no publicados;
`partial`, `unreadable`, `failed` y `not_started` se contabilizan separadamente.
No se certifica cobertura deportiva ni se importa nada.

## Diagnóstico y alternativa local, 4 de octubre de 2026

El último handoff Sol terminó `aborted`, con 63 intentos iniciados y conteos
finales marcados como últimos validados (38 candidatos y 16 fallos). Una
inspección posterior de solo lectura revalidó 39 candidatos y 23 estados
fallidos; el start restante carece de `audit.jsonl` y queda en cuarentena.
No se reescribe el terminal ni se reintenta ese trabajo. La ausencia de audit
ahora produce el código `factory_hook_evidence_missing`, no un ENOENT bruto.
Se reprodujo y corrigió la cancelación de siblings por errores ordinarios,
incluido el caso anterior al primer Read. Esto no convierte el start histórico
sin audit en seguro ni demuestra por sí solo toda la secuencia del incidente.

Una muestra offline de 32 PDF (cuatro de la comparación de modelos y 28
posiciones espaciadas del inventario ordenado por hash) mostró marca Engarde
en 30 documentos y 44 esquemas de sección. No es una muestra estadística:
marca común no significa columnas, cabeceras o atribución idénticas.
`perfilarEstructuraPdf` devuelve solo indicios estructurales sin nombres ni
texto bruto; no certifica extracción, exhaustividad ni aceptación deportiva.

Se corrigieron filas con puesto y nombre unidos en un mismo bloque de texto.
Solo se separan bajo una cabecera explícita compatible; se conservan empates,
geometría original, clubes ausentes y rechazos de prefijos ambiguos. En los tres
primeros documentos de comparación, la clasificación local pasó de cero
filas a 8, 42 y 12, respectivamente. Las filas de clasificación intermedia de
los modelos y los combates deduplicados del lector no son métricas equivalentes.

Repetir la lectura/análisis de los 32 PDF tras la corrección tardó 2,281 segundos,
sin red, OCR, llamadas a modelos ni escrituras en bases de datos. Se extrajeron
940 puestos; el lector declaró un documento completo, 20 parciales y 11
pendientes. Incluso 19 de los 20 documentos con todas sus secciones reconocidas
no resultaron completos. Es un microbenchmark local, no velocidad sostenida
de Luna ni una garantía de 50 PDF por minuto.

La nueva prioridad solicitada es reducir consumo y usar Luna para la IA,
después de validar calidad. La comparación anterior sigue mostrando omisiones
y citas que no coinciden: no se ha superado ese gate ni iniciado una campaña
masiva Luna. El lector local puede reducir trabajo repetido, pero no se
descartan secciones ni se acepta su cobertura automáticamente para ahorrar.
Los ledgers abortados, hashes, starts y artefactos originales permanecen intactos.

`progress.jsonl` es append-only y contiene solo códigos/conteos/IDs de invocación.
Los locks de portfolio forman un ledger exclusivo inmutable: una invocación
nueva solo abre el siguiente slot tras validar el receipt final del anterior.
Solo permiten avance los cierres `finished/finished` y
`stopped/factory_campaign_stopped`. Un receipt `aborted`, aunque exista y tenga
audit válido, bloquea una nueva invocación hasta reconciliación manual. No hay
un flag para ignorarlo, y no se reescribe el receipt para habilitar el avance.
Nunca se borran/reescriben/reclaman locks de portfolio; un slot huérfano bloquea
hasta reconciliación manual. Máximo 10000 invocaciones, sin polling de procesos.
Se conserva la gestión transitoria de locks propios del runner normal existente;
jamás se elimina un lock abandonado de campaña para desbloquear trabajo.
Cada invocación produce un receipt nuevo e inmutable con hashes de fuentes/planes,
session UUIDs, consumo disponible, rowfacts y resumen. Ante aborto de seguridad
los estados son los **últimos validados**, identificados explícitamente; no se
presentan trabajos inseguros como aceptados. Los logs de consola no contienen
nombres, URLs, texto bruto ni secretos.

El preflight inicial de portfolio y el preflight normal siguen revisando todos
los inputs y controles. Cada paso con IDs explícitos revisa solo los trabajos
seleccionados y el piloto capability, además del plan completo fijado por hash,
su esquema, identidades, runtime y manifest. Conserva las comprobaciones de
fuente y controles antes y después de cada sesión. La revisión de citas de un
candidato usa el mismo alcance acotado; no acepta hechos ni certifica exhaustividad.
No se cachean hashes entre pasos. Estos cambios no actualizan un coordinador
ya cargado ni modifican los prompts fijados de sus planes.

## Comparación de modelos y protección de recursos

La preparación de una campaña admite `--modelo gpt-6-sol`, `gpt-6-luna` o
`gpt-5.6-luna`. El modelo queda fijado en el plan, IDs, prompts, settings y
receipts. No se puede cambiar al ejecutar un plan existente ni reutilizar un
receipt de otro modelo. Sol conserva sus controles originales. Los portfolios
completos siguen siendo Sol; las comparaciones Luna son campañas independientes
explícitas, nunca semillas para disfrazar outputs Luna como Sol.

La lista estática de `exec --help` puede diferir del selector interactivo.
El piloto real del 4 de octubre de 2026 confirmó que `gpt-6-luna` se acepta en
`droid exec` y ejecuta los hooks permitidos/denegados.

Las CLI reales comprueban recursos antes del trabajo. Reservan 4 GiB de RAM
libre y 2 GiB de disco, y estiman 768 MiB por worker para reducir la concurrencia
solicitada si hace falta. Se vuelve a comprobar la reserva antes de iniciar
cada fuente. Esto no limita la memoria del proceso a nivel OS: es una estimación
de admisión. Presión de recursos bloquea la campaña; no borra archivos,
no cierra aplicaciones ajenas y no permite reanudar un aborto a ciegas.

En cuatro PDF iguales, Luna registró 13.986 `factory_credits` frente a 290.416
de Sol, un ahorro aproximado del 95,2 %. No se comprobó una factura ni se
convirtió la métrica a dinero. Luna produjo 162 rowfacts frente a 217 de Sol;
en dos PDF devolvió menos filas y en otro devolvió más. El contraste de citas
contra texto PDF encontró seis discrepancias Luna y cuatro Sol. Estas cifras
no certifican interpretación ni exhaustividad y no autorizan un cambio automático
de modelo para todo el inventario. Los candidatos y la comparación permanecen
privados, separados de cualquier importación deportiva.

## Lectores locales antes que modelos (4 de octubre de 2026)

Medición offline de solo lectura, sin red, OCR, modelos ni escrituras, sobre
todo el inventario en caché. Los recuentos son de hechos leídos, no aceptación
deportiva ni exhaustividad.

RFEE (1.164 PDF únicos, 1.408 unidades): documentos completos 116 → 459,
pendientes 432 → 201 y asaltos sin marcador 66.951 → 410. Puestos 37.367,
asaltos de poule 90.200 y de cuadro 22.363 en unos 64 segundos. Cambios del
lector: cabeceras en castellano, catalán e inglés; clasificación guiada por la
cabecera de la tabla (condición DNF/DNS y nación fuera del club); identidad con
club unido y país como afiliación; pie de Engarde reconocido por su texto, con
la leyenda de abreviaturas, en lugar de un corte por altura que perdía la última
fila de las páginas llenas. Cada cambio se comparó documento a documento. Las
únicas pérdidas son cinco PDF donde la fila recuperada es un hermano con los
mismos apellidos y club: antes sus asaltos se atribuían al otro. Ahora quedan
sin atribuir.

FIE (3.154 competiciones JSON): completas 2.086 → 2.472 y parciales 650 → 264,
sin perder hechos. Un 0-0 sin victoria de quien no tiró ninguna celda de su poule
y un cruce de cuadro con el mismo marcador y perdedor en abandono, baja médica,
exclusión o incomparecencia cuentan como `retirado`, no como asaltos publicados.
Lo que queda son sobre todo victorias por prioridad publicadas con el mismo
marcador (337 asaltos): el modelo de asalto deduce el ganador del marcador, así
que importarlas exige un campo de ganador explícito.

Residuo para Luna: 58 PDF con páginas sin cabecera reconocible o sin texto. Los
472 parciales restantes y los pendientes son fail-closed por diseño: nombres
truncados ambiguos, cabeceras sin modalidad o categoría y PDF de equipos solo con
poules. Un modelo no puede resolverlos sin inventar. Con las medias del piloto de
cuatro PDF, que no son representativas (Luna unos 3.500 `factory_credits` por
PDF y Sol unos 72.600), el residuo costaría unos 0,2 millones frente a 84,5
millones con Sol o 4,1 millones con Luna para todo el inventario. El gate de
calidad de Luna sigue sin superarse.

La campaña Sol anterior cerró con `factory_tree_drain_failed`, no con un cierre
seguro. Su receipt `aborted` bloquea el relevo. Los dos starts sin receipt final
se conservan para reconciliación; no se sustituyen por receipts de éxito y no
se relanza el inventario en otro portfolio para saltar el bloqueo.

Un relevo posterior exige autorización y reconciliación explícitas, no solo
volver a ejecutar el comando. La revisión conserva el receipt de aborto y
comprueba que no hay clientes locales de sus planes activos. Los starts ambiguos
quedan en cuarentena permanente sin reintento. Solo las selecciones demostradas
como `not_started` pueden asignarse a campañas nuevas del mismo modelo, con
vínculo por hash al receipt anterior, mapa de fuentes y un claim exclusivo del
relevo. No se modifica el ledger antiguo ni se crean receipts de éxito falsos.
El relevo aprobado para PDF usa Sol, prueba fases de 4 y 8, y continúa en pasos
finitos con controles de recursos, límite de intentos y pared global de 12 horas.
FIE no forma parte de ese relevo PDF. Un nuevo error de seguridad vuelve a
bloquear el carril; el claim no se borra para relanzar una segunda copia.
