# Extracción histórica con Factory

Este carril es independiente: no importa candidatos, no abre DB, no sube R2,
no modifica cachés, catálogos, Git ni despliegues. Usa sesiones nuevas de
`droid exec`, modelo `gpt-6-sol`, una por PDF oficial o competición FIE.
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

- Concurrencia 1–2; `--max-sesiones` obligatorio (el ejemplo acota a 5).
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
Máximos: 250/paso, concurrencia 2, 600s/proceso, 3600s/paso, 48h globales.
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
todos los artefactos existentes, no se acepta ni reintenta. Los siblings ya
iniciados/cancelados se tratan igual; los aún no iniciados pueden avanzar.
Starts ambiguos con evidencia de hook válida se separan para revisión manual.
Audit ausente/ilegible, tool/path no autorizado, drift, errores desconocidos de
seguridad o fallo de teardown abortan **todo**; no se saltan para continuar.
También abortan globalmente un código de salida no cero (incluidas cuota o
autenticación), un envelope inválido, un arranque fallido y una salida con
codificación o estado de cierre inválidos, aunque haya lecturas auditadas.
Con concurrencia dos, un fallo fatal de una sesión prevalece sobre el fallo de
calidad o la cancelación de la otra. Se esperan ambos cierres antes de devolver
el error; un cierre o drenaje fallido impide iniciar el siguiente paso.
No borrar/reparar starts, outputs, receipts ni locks abandonados para forzar
una repetición. Tampoco crear portfolios nuevos para esquivar la reconciliación:
no existe un ledger global fuera de estas carpetas.

Resume revalida evidencia aceptada y fallida antes de nuevos intentos. Un
receipt válido representa candidato, no certeza deportiva: las filas de hechos
no son combates deduplicados. `successful` incluye candidatos vacíos/no publicados;
`partial`, `unreadable`, `failed` y `not_started` se contabilizan separadamente.
No se certifica cobertura deportiva ni se importa nada.

`progress.jsonl` es append-only y contiene solo códigos/conteos/IDs de invocación.
Los locks de portfolio forman un ledger exclusivo inmutable: una invocación
nueva solo abre el siguiente slot tras validar el receipt final del anterior.
Nunca se borran/reescriben/reclaman locks de portfolio; un slot huérfano bloquea
hasta reconciliación manual. Máximo 10000 invocaciones, sin polling de procesos.
Se conserva la gestión transitoria de locks propios del runner normal existente;
jamás se elimina un lock abandonado de campaña para desbloquear trabajo.
Cada invocación produce un receipt nuevo e inmutable con hashes de fuentes/planes,
session UUIDs, consumo disponible, rowfacts y resumen. Ante aborto de seguridad
los estados son los **últimos validados**, identificados explícitamente; no se
presentan trabajos inseguros como aceptados. Los logs de consola no contienen
nombres, URLs, texto bruto ni secretos.
