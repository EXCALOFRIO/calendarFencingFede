# Entrega: registro de la publicación y guía del propietario

Fecha: 02/10/2026. Este documento dice qué se publicó, qué se comprobó y qué
**no** se comprobó. La revisión privada (con cuenta real) es del propietario y
queda **pendiente**.

## Trabajo posterior del 03/10/2026, corte en mantenimiento

### Actualización del 04/10: catálogo, lotes y presentación

- El catálogo completo conserva búsqueda literal, fuente, temporada y página
  al abrir una edición, su clasificación y una ficha deportiva. No requiere
  vínculos al calendario y no muestra datos de cuenta.
- Se mejoraron la jerarquía de filtros, los recuentos, las tarjetas de edición,
  los estados vacíos, las cabeceras de clasificación y los controles móviles.
  Los puestos usan texto accesible en lugar de `aria-label` sobre un span genérico.
- El gate offline pasó **2.876 pruebas en 174 archivos**, código 0, 343,37 s,
  dos workers, límites de pruebas/hooks de 30 s y las cinco exclusiones
  habituales de acceso vivo. Después, la última corrección ARIA pasó las
  **91 pruebas** focalizadas de catálogo, ediciones, modelo y acceso anónimo.
  TypeScript sin incremental pasó antes de esa corrección; el build canónico
  posterior también pasó su control TypeScript y terminó con código 0.
- Las fixtures sintéticas con CSS compilado no desbordan a 320/393/768/1440 px
  y no tienen controles menores de 44 px, con tolerancia de redondeo de 0,1 px.
  Axe no encontró violaciones; queda contraste manual sobre la textura.
  La captura de escritorio repite regiones, pese a existir una sola instancia
  en el DOM. Tab no avanza en el pane integrado. No son QA visual completa,
  verificación de teclado ni acceso autenticado real.
- El coordinador Factory fija todo el inventario, conserva semillas validadas
  y procesa pasos finitos de diez unidades con concurrencia dos. La preparación
  completa se inició offline; la campaña masiva aún no se acredita. Cuota/auth,
  código de salida no cero, envelope inválido y errores de seguridad abortan
  globalmente. Ningún candidato se acepta como hecho deportivo ni se mezcla
  con el manifiesto congelado.
- Producción continúa en mantenimiento. La observación remota de solo lectura
  confirmó `importing` y 163.200 combates, cero filas escritas. Esa observación
  no acredita el final de la importación, sus hashes, las guardias posteriores
  ni el despliegue del nuevo runtime.

El código se confirmó en `97458b6` y se subió a `main`. Migra datos y
almacenamiento a D1/R2, conservando Neon Auth gestionado solo para cuentas,
sesiones y códigos. Producción está en mantenimiento
`64805183-87b1-421a-8c17-dbdcf7b62a74`, publicado a las 20:57 UTC.
El runtime D1 sigue pendiente y la importación remota está en curso. Neon y la versión
`b0da2841` se conservan para recuperación.

- Se aplicó únicamente la guarda PostgreSQL `0020` (ledger 19 → 20) y se
  desactivaron escritores antiguos. El corte independiente ahora congela el Worker.
  No se aplica `0021` a Neon; su CLI está retirado antes de cualquier I/O.
- Se creó una D1 UE independiente y se confirmó su acceso de solo lectura:
  inicialmente `_cf_KV`, 12.288 bytes. Se instaló solo `0000` después del
  snapshot/ensayo final. El marcador remoto está en `importing`, no `complete`;
  faltan la verificación remota y las guardias posteriores.
- El snapshot consistente de 199.027 filas se ensayó y verificó dos veces
  localmente. La exportación final congelada nueva también terminó, código 0,
  con 199.027 filas de 54 tablas; la composición pasó sin deriva de los hechos
  o identidades protegidas.
- R2 conserva verificados 9.614 blobs FIE, tres particiones e índice
  (216.577.918 bytes con metadatos), y 2.109 blobs nacionales y manifiesto
  (278.467.814 bytes). La relectura de índice/particiones/manifiesto FIE
  pasó, código 0. Archivar originales no importa sus hechos.
- Las campañas offline reales FIE, HTML y PDF terminaron. La copia histórica
  verificada contiene 5.256 competiciones, 248.694 resultados y 668.128 asaltos:
  3.671/198.212/635.173 más que el base. Los 31.151 puestos HTML ya existían;
  los PDF añadieron 2.194 puestos y 1.599 asaltos, no todos los hechos leídos.
  FKs/procedencia/cierre de contexto e integridad pasan, sin altas de personas
  o fusiones. Staging local no es D1 remoto ni el snapshot de corte.
- Quedan parciales y revisión documental, tres respuestas nacionales malformadas,
  identidades aplazadas y 6.063 coberturas FIE antiguas pendientes.
- El traslado local incorpora solo cinco tablas de hechos, conserva el
  snapshot actual de perfiles/AuthIDs/permisos/demás datos y aborta ante deriva
  de identidades o hechos. Requiere fuente cerrada en DELETE, hashes explícitos
  y el mismo importador estricto; no carga el SQLite de staging a ciegas.
- La composición previa al corte produjo 1.045.210 filas de 54 tablas,
  618.963.920 bytes JSONL. Su importación y doble verificación local pasaron,
  código 0 en 717,99 s; SQLite ocupa 631.074.816 bytes. Usó el base también
  como snapshot actual y no sustituye la exportación final congelada.
- La composición **del corte** también produjo 1.045.210 filas/54 tablas.
  Se importó y verificó dos veces en SQLite privado, código 0,
  631.074.816 bytes. SHA del manifiesto:
  `4e0fa7df665bccf2ccb2305a75da533c49d3a90b868290841817d71093056944`.
  El ensayo tardó 6.181,84 s de reloj; la causa de esa demora no se ha
  verificado y no se presenta como tiempo típico de importación.
- El Worker independiente de mantenimiento tiene dry-run y 13 casos probados,
  sin código de aplicación, assets, bindings o crons. El corte desplegado pasó
  16 comprobaciones HTTP: 503, privado/no-store, Retry-After y HEAD vacío,
  incluidas rutas de auth, archivos, cron y recursos. Los nueve nombres de
  secretos se conservan. La lectura Neon encontró cero escritores activos
  y cero transacciones ajenas abiertas; no se hizo ninguna escritura Neon.
- El diseño pasó 92 pruebas focalizadas, con 36 renders sintéticos a 320,
  393, 768 y 1440 px. No son QA autenticada de producción ni métricas reales
  de rendimiento.
- El gate offline **anterior a las correcciones de auditoría** pasó: **2.555 pruebas en 159 archivos**, código 0,
  325,03 s, con un máximo de dos trabajadores. Se excluyeron explícitamente
  `datos`, `enlaces`, `seguridad`, `fie-resultados-vivo` y `rfee-pdf-vivo`;
  no acredita acceso real ni proveedores vivos.
- El chequeo semántico completo de TypeScript pasó, código 0, sin incremental
  (123,18 s). Antes falló con 18 errores y después con dos; esos errores se
  corrigieron sin desactivar comprobaciones.
- Los 36 renders responsive y la limpieza del navegador propio pasaron en
  una ejecución focalizada de 88 pruebas y después en el gate completo.
  Una ejecución anterior tuvo 218 pruebas aprobadas pero falló la limpieza:
  no se cuenta como gate aprobado.
- La compilación D1 anterior a las correcciones pasó, código 0, fijando el
  dominio de producción y sin incrustar secretos. El primer build se detuvo
  al detectar un origen local distinto. Ninguno acredita el paquete final
  posterior a la auditoría, que debe compilarse y escanearse de nuevo.
- La auditoría estándar de todo el repositorio identificó cuatro hallazgos
  bloqueantes: propiedad por nombre, carrera de propietarios, fórmulas CSV
  y descompresión sin presupuesto de salida. Se corrigieron localmente:
  solicitudes revisadas por admin, CAS y batch atómico, celdas seguras y
  lectura incremental de descarga/XML. No se han desplegado las correcciones.
  Pasaron 181 pruebas focalizadas en siete archivos, seguidas de 101 en
  cinco archivos tras los últimos ajustes de propiedad y checkpoint.
- El control semántico posterior a las correcciones pasó, código 0, en
  164,18 s. La regresión de propiedad ampliada pasó 36 pruebas, incluidas
  restricciones SQL de evidencia/fechas y rechazo a menores de 14.
  [Informe de seguridad y límites](./auditoria-seguridad-2026-10-03.md).
- El primer gate completo posterior tuvo **2.711 pruebas aprobadas**, pero
  salió con código 1 por el cierre de Chromium en Windows. No cuenta como
  gate aprobado. Se corrigió la carrera entre la salida del sistema y la
  observación de Node, sin ocultar procesos vivos; 54 pruebas responsive/de
  cierre aprobaron después. Las repeticiones posteriores se registran abajo.
- El paquete final posterior pasó `cf:build`, código 0, en 646,03 s, incluido
  TypeScript y con el origen canónico. El dry-run de Wrangler pasó en 39,33 s.
  Cero coincidencias con nueve valores sensibles/componentes en 2.228 archivos
  del paquete y tres del dry-run; cero `.env`, `next-env.mjs` vacío. No se ha
  publicado ni cambiado producción.
- El segundo gate completo tuvo **2.721 pruebas aprobadas en 165 archivos**,
  pero salió con código 1 al esperar el evento `close` del navegador.
  La prueba posterior con CDP sin pipes no logró conectar y se retiró.
  Ese gate permaneció fallido, pero queda superado por la pasada completa
  final indicada abajo. No se ocultaron sus timeouts.
- La descarga nacional terminó con 2.350/2.353 originales válidos. La segunda
  vuelta FIE terminó con 3.154 evaluadas: 3.137 cerradas, 11 parciales y seis
  errores, sin pending en ese inventario. No se reabrieron aprobaciones.
- El control semántico final de todo el working tree volvió a pasar, código 0,
  en 319,09 s. Una repetición focalizada de nueve suites agotó el timeout
  externo de 240 s después de seis suites aprobadas, sin contarla como gate.
  Las tres suites restantes (CSV, reemplazo local y cierre propio) pasaron
  después: 56 pruebas, código 0. Es evidencia anterior, no el gate actual.
- El acceso usa el proveedor y secreto Neon Auth existentes, sin conexión SQL
  de aplicación a Neon. Se han retirado las tablas de sesiones/OTP locales.
  El snapshot final debe conservar los IDs del proveedor, a diferencia del
  ensayo previo. Falta validar acceso real antes de publicar. No hay acceso
  de respaldo por contraseña ni concesión técnica QA activada.
- Las seis suites que fallaban por supuestos PostgreSQL o cierre de navegador
  se corrigieron: 121 pruebas focalizadas aprobadas. El gate completo, tipos
  y compilación deben acreditarse otra vez si cambia el código durante la
  auditoría. Los metadatos de registro npm no se obtuvieron por un timeout;
  su ausencia no prueba que una dependencia sea segura o insegura.
- El PDF se detuvo primero por un cursor retenido cobrado otra vez. Se
  reprodujo y corrigió, preservando original/recibos y 4 GiB. La revisión
  independiente detectó además dos bloqueos de integridad en correcciones:
  ambos se reprodujeron en D1 nativo y se corrigieron antes de repetir toda
  la campaña nacional desde una copia anterior, código 0 y sin flag incompleto.
- La revisión final de namespace/capacidad/mantenimiento y composición no
  confirmó nuevas vulnerabilidades ni bloqueos prácticos restantes. No
  inspeccionó datos privados ni acreditó QA de producción.
- **Gate offline final: 2.812 pruebas en 170 archivos, código 0, 235,80 s**,
  dos workers y las mismas cinco exclusiones. El cierre responsive pasó.
  TypeScript final sin incremental pasó, código 0, 100,24 s.
- La compilación canónica del paquete actual pasó, código 0, en 181,94 s,
  seguida del dry-run actual, código 0, en 12,28 s. El escaneo actual verificó
  nueve valores sensibles/componentes: cero coincidencias en 2.228 archivos
  del paquete y tres del dry-run, cero `.env` y tres exports de entorno vacíos.
  El primer chequeo de esos exports usó un patrón incorrecto y salió con 1;
  la comprobación corregida verificó su formato real y salió con 0. No hubo
  coincidencias sensibles ni cambios del paquete entre ambos chequeos.
- La lectura real de ediciones/clasificaciones sobre la copia histórica pasó
  para FIE, PDF y HTML: dos páginas de 20 filas por fuente, sin duplicados;
  sin sesión se denegó antes de consultar. Fueron 30 consultas de solo lectura
  con un perfil sintético de test, no acceso autenticado de producción.
  [Tabla de cobertura y acceso](./cobertura-historica-2026-10-03.md).

### Continuación del 04/10: catálogo y sesiones Factory

El catálogo paginado nuevo pasó 91 pruebas focalizadas y lectura real de la
copia histórica: 4.407 ediciones/5.256 pruebas, 16 consultas de solo lectura,
sin duplicados ni cambio de hash. Conserva filtros y página en los retornos.
Las mediciones de DOM sintético cubrieron cuatro anchos CSS efectivos; la
comprobación de contraste del degradado quedó incompleta y las capturas del
panel repetían regiones. No se cuenta como QA autenticada ni prueba visual
completa. Tab no avanzó el foco en ese panel, así que la comprobación por
teclado también queda pendiente. El nuevo gate completo, build y despliegue
siguen pendientes.

Se verificaron controles reales de lectura de `droid exec`, con CLI 0.230.0
y `gpt-6-sol`, antes de leer PDF/JSON oficiales. Los pilotos de fuente
produjeron candidatos, sin OCR, API propia ni escrituras deportivas. Las 26
citas PDF pasaron el contraste; dos de 28 citas FIE no coinciden con la
fuente y quedan en revisión. Validar sesión/esquema no acepta hechos.
El propietario autorizó todo el inventario en lotes finitos; esa campaña
queda independiente del corte actual.

La comprobación D1 del 04/10 a las 00:04:41 UTC observó `importing` y
`insert:sport_bout:44400`: todas las competiciones/resultados esperados,
pero solo 44.400 asaltos. Cero escrituras de la comprobación. No se aplicaron
las guardias posteriores, no se publicó el runtime y no se reabrió la web.

Orden de corte, importación, capacidad y recuperación:
[`migracion-cloudflare.md`](migracion-cloudflare.md).

Hubo **dos** publicaciones el 02/10 en el mismo Worker. La **última de ese día** fue la
versión `b0da2841-1b10-4ba7-8d7b-ee9401fbbd7b` (sección siguiente); la primera,
`3fb282b6`, se conserva más abajo como registro histórico y **no** es la
de recuperación elegida. El mantenimiento del 03/10 sustituye ambas.

## Última aplicación Neon: `b0da2841` (anterior al corte)

| Dato | Valor |
|---|---|
| Worker | `calendario-fie-fede` (solo ese) |
| Cuenta | `52d39cf14bc17b94754729436036124d` |
| Origen | https://calendario-fie-fede.excalofrio.workers.dev |
| Versión nueva (100 %) | `b0da2841-1b10-4ba7-8d7b-ee9401fbbd7b` (19:43 UTC) |
| Versión anterior (para volver el código) | `3fb282b6-2800-433a-b7da-d8be528ed193` (18:16 UTC), que **no** tiene la guarda de `/api/archivos/*` |
| Código | HEAD `e25ffcd` (guarda de sesión + `private, no-store` en el handler) |
| Compilación | `npm run cf:build` nuevo para este commit, con `NEXT_PUBLIC_APP_URL` fijada al origen y **sin** `CF_ENV_EMBEBIDO` |
| Publicación | `opennextjs-cloudflare deploy --env-file NUL` sobre ese `.open-next` ya comprobado: el registro muestra la subida de assets y del Worker, sin fase de compilación; autenticado con el OAuth de Wrangler y sin `CLOUDFLARE_API_TOKEN` |

Se conservaron los bindings (`ARCHIVOS` en R2, `IMAGES`, `AI`, `ASSETS`), las
variables de `wrangler.jsonc` y los **nueve crons** (la salida del despliegue
los lista). Los nueve nombres de secretos siguen en el almacén (solo nombres,
ningún valor). No se tocaron otros Workers, cuotas, planes, dominios, cuentas de
Neon Auth ni compras, no se purgó ninguna caché ni se borró ningún fichero, no se
hizo más SQL ni ingesta y no se hizo `git push`.

### Comprobaciones antes de publicar (esta publicación)

Una detrás de otra:

| Comprobación | Resultado |
|---|---|
| Vitest seguro del manifiesto, exacto y sin tiempo de espera ampliado | **Aprobado a la primera:** 1798 aprobados, 7 omitidos, 110 ficheros aprobados y 2 omitidos (155 s). No hubo reintento. |
| `npm run typecheck -- --incremental false` | Aprobado (código 0) |
| `git diff --check` | Aprobado (código 0) |
| `npm run cf:build` | Aprobado (código 0). Incluye `next build` y el empaquetado OpenNext. |
| Espacio libre en C: | 13,38 GiB antes del build y 13,20 GiB después (umbral 5 GiB; no se liberó nada). La lectura de 4,61 GiB de una sesión anterior quedó superada por esta medida. |
| Secretos en el paquete | 15 valores sensibles de `.env` buscados en memoria en los 2160 ficheros de `.open-next`: **0 coincidencias y 0 ficheros `.env`**; `next-env.mjs` quedó vacío. Solo se imprimieron nombres y recuentos. |
| El paquete contiene la guarda | El `handler.mjs` empaquetado incluye el handler de `/api/archivos` con `Cache-Control: private, no-store`. |
| Revisión final focalizada **previa** a publicar (subagente independiente, solo lectura) | `VERDICT: PROCEED`: sin defectos en guardas, privacidad (por muestreo), migración actual, últimos arreglos, ausencia de secretos del paquete ni destino/bindings/crons. Fue anterior al despliegue y no una revisión posterior presentada como previa. No fue una auditoría amplia; no verificó a fondo el test de la guarda ni las excepciones públicas por búsqueda. |

El gate del commit `e25ffcd` **falló**: 1796 aprobados y 7 omitidos, con dos
tiempos agotados (`inscritos-limites` y `skermo`, idempotencia del parseo), y el
código de salida del `pipeline` que se anotó fue 0 pese al fallo; ese 0 no
cuenta como aprobado. Los dos ficheros pasaron aislados (40/40)
y el diagnóstico de `tests/acceso-anonimo-matriz.test.ts` con
`--testTimeout=180000` (14/14) **no es un gate aprobado** ni demuestra que la
causa fuese la carga. El gate de esta publicación, con el comando exacto, sin
ampliar tiempos y con el código de salida leído sin filtrar, pasó a la primera
(código 0); eso no borra el fallo anterior ni explica su causa.

### Comprobaciones después de publicar (solo lectura, sin sesión)

Peticiones HTTP `GET` de lectura. **No se invocó ningún cron ni endpoint de
ingesta.**

- `/entrar`: `200`, título «Entrar · CalendarFencing», sin referencias a
  `localhost`. (Una primera petición del lote dio un error SSL transitorio del
  cliente; la repetición dio `200`.)
- Sin sesión, `307` a `/entrar` en `/`, `/estado`, `/ranking`, `/perfil`,
  `/convocatorias`, `/documentos`, `/tiradores`, `/alta`, `/admin`, `/explorar`,
  `/explorar/ediciones`, `/explorar/ediciones/<id>`, `/explorar/favoritos`,
  `/explorar/<personaId>` y `/explorar/<personaId>/cara-a-cara` (UUID
  inexistentes).
- Con `RSC: 1` y siguiendo la redirección `?_rsc`: `200` con `NEXT_REDIRECT` y
  sin `sport_`, `nombre` ni `apellido` (`/`, `/explorar`, `/explorar/favoritos`,
  `/ranking` y una ficha).
- `/api/archivos/<clave inexistente y sanitizada>` sin sesión: **`401`**,
  `Cache-Control: private, no-store` y cuerpo `{"ok":false,...}`. No se pidió
  ningún documento real.
- Feed iCal con token inexistente: `404`; una ruta inexistente: `404`.
- Recursos: dos `/_next/static/chunks/*.js` responden `200` con
  `text/javascript` y `/manifest.webmanifest` responde `200`.
- `agent-browser` **se colgó otra vez** (la apertura de `/explorar` no terminó en
  75 s); la sesión se cerró. No hay captura ni comprobación de navegador, solo
  HTTP.

**Qué demuestra y qué no.** La guarda responde `401` a una petición anónima; eso
no prueba que una sesión válida lea bien un fichero ni que no existan copias
antiguas cacheadas o descargadas con la política de `3fb282b6`, que esta guarda
no recupera. Un `R2_PUBLIC_BASE_URL` externo, si se usara, queda fuera de la
guarda. No se probó inicio de sesión, roles, datos por arma, favoritos, cara a
cara con datos, correos, rendimiento ni los cuatro anchos: es la QA privada
manual del propietario.

### Volver el código a la versión anterior

Revierte **solo el código** y **reabre** `/api/archivos/*` sin sesión (la
versión `3fb282b6` no lo protege), por lo que solo conviene si la nueva
versión falla por otra razón:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '52d39cf14bc17b94754729436036124d'
node node_modules/wrangler/bin/wrangler.js rollback 3fb282b6-2800-433a-b7da-d8be528ed193 --name calendario-fie-fede --env-file NUL
```

Neon **no** se revierte: tablas `sport_*`, enums, datos y ledger (19 filas) se
quedan, y no hay SQL de bajada ni respaldo o punto de restauración acreditados.

## Primera publicación del 02/10/2026: `3fb282b6` (histórica)

Registro de la publicación anterior, sustituida después por `b0da2841`.

### Qué se publicó

| Dato | Valor |
|---|---|
| Worker | `calendario-fie-fede` (solo ese) |
| Cuenta | `52d39cf14bc17b94754729436036124d` |
| Origen | https://calendario-fie-fede.excalofrio.workers.dev |
| Versión nueva (100 %) | `3fb282b6-2800-433a-b7da-d8be528ed193` (18:16 UTC) |
| Versión anterior | `39b7900c-2a6c-4b82-87e2-ca6bc482a67e` (29/09/2026) |
| Código | HEAD `6b969ba` más cambios solo de comentario y documentación (ninguno de configuración) |
| Compilación | `npm run cf:build` con `NEXT_PUBLIC_APP_URL` fijada al origen publicado y **sin** `CF_ENV_EMBEBIDO` |
| Publicación | `opennextjs-cloudflare deploy --env-file NUL` (publica `.open-next` ya comprobado, no recompila) con el inicio de sesión OAuth de Wrangler |

Se conservaron los bindings (`ARCHIVOS` en R2, `IMAGES`, `AI`, `ASSETS`), las
variables de `wrangler.jsonc` y los **nueve crons** (la salida del despliegue los
lista: 03:00, 03:30, 04:00, 04:30, 05:00, 05:30, 06:00, 06:45 y 07:00 UTC). Los
nueve nombres de secretos siguen en el almacén (`AWS_ACCESS_KEY_ID`,
`AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_SECRET_ACCESS_KEY`,
`CREDENTIAL_ENCRYPTION_KEY`, `CRON_SECRET`, `DATABASE_URL`,
`NEON_AUTH_COOKIE_SECRET`, `NEON_AUTH_URL`); no se leyó ni subió ningún valor. No se
tocaron otros Workers, cuotas, planes, dominios, cuentas de Neon Auth ni
compras. No se hizo `git push`.

### Comprobaciones antes de publicar (primera publicación)

Se ejecutaron una detrás de otra:

| Comprobación | Resultado |
|---|---|
| Vitest seguro del manifiesto (`--maxWorkers=3`, sin `datos`, `enlaces` ni `seguridad`) | **Primera pasada: falló 1 test** (`tests/skermo.test.ts`, «idempotencia del parseo»: tiempo agotado a 60 s en una pasada de 220 s con 1787 aprobados). El fichero solo, con un trabajador, **pasó** (29 tests, el test lento tardó 39 s). **Segunda pasada completa: 1788 aprobados, 7 omitidos, 109 ficheros aprobados y 2 omitidos.** El fallo era de tiempo y no se reprodujo; no se ha demostrado su causa. |
| `npm run typecheck -- --incremental false` | Aprobado |
| `git diff --check` | Aprobado |
| `npm run cf:build` | Aprobado. No se ejecutó además `npm run build` por separado: `cf:build` ya lo contiene. |
| Espacio libre en C: | 6,59 GiB al empezar, 7,07 GiB antes del build y 6,95 GiB después (umbral 5 GiB; no se liberó nada). Una lectura anterior de 4,61 GiB estaba por debajo y se repitió antes de compilar. |
| Secretos en el paquete | Se buscaron 14 valores sensibles de `.env` (incluidas la contraseña y el usuario de `DATABASE_URL`) en los 2157 ficheros de `.open-next`: **0 coincidencias y 0 ficheros `.env`**. `next-env.mjs` quedó vacío. El resultado del `wrangler deploy --dry-run` (3 ficheros) tampoco tuvo coincidencias. Solo se imprimieron nombres y recuentos. Los valores no secretos `AI_PROVIDER` y `AI_MODEL` se excluyeron del escaneo porque aparecen en el código y en `wrangler.jsonc`. |
| Revisión final independiente (antes de publicar) | `VERDICT: PROCEED`, sin defectos bloqueantes en guardas, privacidad, estado de migraciones, últimos arreglos, secretos del paquete y destino/bindings/crons. Dos notas no bloqueantes se resolvieron: el comentario de `wrangler.jsonc` ahora dice 9 crons y se anotó que `/api/archivos/*` era una excepción abierta; esa anotación se retiró después porque la excepción no estaba aprobada (véase «Estado de los datos y límites de la evidencia» y la guarda de sesión posterior a `3fb282b6`). |

`npm run lint` no sirve en Next 16 y no se ejecutó.

### Comprobaciones después de publicar (primera publicación)

Hechas con peticiones HTTP `GET` de lectura. **No se invocó ningún cron ni
endpoint de ingesta.**

- `/entrar`: 200, título «Entrar · CalendarFencing», formulario de correo
  presente, sin referencias a `localhost`.
- Sin sesión, `307` a `/entrar` en `/`, `/estado`, `/ranking`, `/perfil`,
  `/convocatorias`, `/documentos`, `/tiradores`, `/alta`, `/admin`, `/explorar`,
  `/explorar/ediciones`, `/explorar/ediciones/<id>`, `/explorar/favoritos`,
  `/explorar/<personaId>` y `/explorar/<personaId>/cara-a-cara` (con UUID
  inexistentes: la guarda actúa antes de leer).
- Con la cabecera `RSC: 1` Next añade `?_rsc` y, tras seguir esa redirección,
  responde con una carga de redirección (`NEXT_REDIRECT`) sin datos deportivos
  (se buscaron `sport_`, `nombre` y `apellido`, sin coincidencias). Las pruebas
  se hicieron con `/explorar`, `/explorar/favoritos`, `/ranking` y una ficha.
- Feed iCal con tokens inexistentes: `404`. Un `GET` de ruta inexistente: `404`.
- Recursos: dos `/_next/static/chunks/*.js` responden `200` con
  `text/javascript`, y `/manifest.webmanifest` responde `200`. `/favicon.ico`,
  `/manifest.json` y `/icon-192.png` dan `404` (no se asume que existan).
- `agent-browser` **no funcionó** en esta sesión: los comandos de apertura
  quedaron colgados hasta el tiempo límite y la sesión se cerró. Por eso no hay
  captura ni comprobación de navegador; solo HTTP.

**No comprobado por el agente:** inicio de sesión real, cualquier página con
datos, roles, arma propia o ajena, favoritos, cara a cara con datos, correos,
rendimiento (Core Web Vitals) y los cuatro anchos.

## Qué hacer después: QA privada manual

La hace el propietario con su cuenta, **sin** cuentas temporales ni cookies
copiadas:

1. [`matriz-qa-manual-responsive.md`](matriz-qa-manual-responsive.md): atleta,
   seleccionador de su arma, seleccionador de otra arma y admin, a 320, 393, 768 y
   1440 px, con teclado, zoom y movimiento reducido.
2. [`favoritos-guia-manual.md`](favoritos-guia-manual.md).
3. Comprobar que el origen publicado figura en Neon Auth (Domains) y que el
   código de acceso llega por correo. Si el inicio de sesión responde
   `403 INVALID_ORIGIN`, falta añadirlo ahí.

## Cómo volver atrás (solo la primera publicación, histórico)

Para la publicación vigente, ver «Volver el código a la versión anterior»
arriba. Lo siguiente describía el regreso de `3fb282b6` a `39b7900c` y ya no es
la vía recomendada, porque `3fb282b6` ya no es la versión en producción.

Revierte **solo el código**:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '52d39cf14bc17b94754729436036124d'
node node_modules/wrangler/bin/wrangler.js rollback 39b7900c-2a6c-4b82-87e2-ca6bc482a67e --name calendario-fie-fede --env-file NUL
```

Neon **no** se revierte: las tablas `sport_*`, los enums, los datos y el ledger
(19 filas) se quedan. No hay SQL de bajada autorizado ni copia o punto de
restauración de Neon acreditados. Con la versión anterior en producción, las
pantallas nuevas de Explorar dejan de existir, pero sus tablas siguen en la base.

## Estado de los datos y límites de la evidencia

- Migraciones 0017 → 0018 → 0019 aplicadas en una transacción (ledger 16 → 19, 13
  tablas deportivas, categorías M10/M12). No se reaplican ni se hizo más ingesta
  en esta entrega. El preflight del comando devuelve 2 por estar ya aplicadas.
- **El corpus histórico no está completo.** Solo hay el piloto acotado descrito
  en el `README.md`. La primera relectura FIE elegible reescribirá una lista por
  la 0018, acotada, sin lote ilimitado.
- Contabilidad del piloto: 21 peticiones HTTP conocidas **más** una invocación
  mal entrecomillada cuyo número de peticiones es desconocido. No es un total
  exhaustivo y no demuestra el cumplimiento de 40 peticiones/300 s para todo el
  conjunto.
- Los conteos de tablas antiguas fueron iguales antes y después del piloto, pero
  eso **no prueba igualdad de valores**. `notification` tiene 3 filas frente a 0
  en la auditoría previa, sin atribución. **No se investigó ni limpió nada**, y
  las consecuencias históricas del incidente de pruebas del 02/10/2026 ni se
  han demostrado ni se descartan.
- Tamaños: base completa 29,35 → 30,17 MiB y `public` 18,64 → 19,46 MiB tras el
  piloto; son métricas lógicas y no el consumo facturado. El plan de Neon sigue
  sin verificar.
- Piloto de IA (hasta 10 PDF y 1 €, aprobado por el usuario): **no se envió
  ningún PDF** ni hay gasto. Siguen sin verificar la vía de inferencia, el coste
  y la cuota de la cuenta, el modelo y la privacidad de listados nominales; no se
  gastó nada nuevo.
- La proyección de «Mi estado» (9.600 → 400 filas) es **sintética**, con datos
  inventados; no hay Core Web Vitals reales.
- `/api/archivos/*` servía PDF y snapshots de R2 sin sesión y con caché pública
  de un año en la versión `3fb282b6`. Eso no fue una excepción aprobada, sino un
  defecto: la versión vigente `b0da2841` exige `getSessionProfile` antes de leer
  R2 (anónimo o revocado: `401` sin lectura del cubo) y responde
  `private, no-store`. Tras publicar, una petición anónima con una clave
  inexistente dio `401`. La guarda no puede recuperar copias antiguas cacheadas
  o descargadas mientras estuvo `3fb282b6` ni cubre un `R2_PUBLIC_BASE_URL`
  externo; no se purgó ninguna caché ni se borró ningún fichero.
- La publicación `b0da2841` no hizo escrituras en Neon ni ingesta. Los límites
  anteriores (piloto acotado, 21 peticiones conocidas más una desconocida,
  conteos iguales sin prueba de valores iguales, 3 `notification` sin
  atribución) se mantienen y no hay investigación nueva del incidente ni
  limpieza.
