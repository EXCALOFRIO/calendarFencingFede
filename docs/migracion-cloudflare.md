# Migración de la aplicación a Cloudflare

Arquitectura elegida por el propietario: **Neon Auth gestionado para cuentas,
sesiones y códigos; Workers/D1/R2 para toda la aplicación, perfiles, permisos,
resultados y archivos**. Neon Auth sigue almacenando sus tablas en Neon.
El runtime no utiliza una conexión SQL a Neon ni un fallback PostgreSQL.

Estas herramientas no crean bases, no aplican el esquema y no cambian bindings.
No eliminan ni modifican Neon. La migración de documentos a R2 es un proceso
independiente; exportar filas con referencias a archivos no mueve sus objetos.

## Estado comprobado el 03/10/2026

- Código `97458b6` subido a `main`. Producción está en mantenimiento independiente
  `64805183-87b1-421a-8c17-dbdcf7b62a74`, con 16 verificaciones HTTP aprobadas
  y secretos conservados. No se ha publicado el runtime D1; Neon y `b0da2841`
  se conservan para recuperación.
- Destino dedicado: `calendario-fie-fede-db`,
  `e1c28f19-278c-4d8f-9c7c-9b9d1c45653e`, creado en la UE. Primero solo
  contenía `_cf_KV`, 12.288 bytes. Después del corte/ensayo se instaló solo
  `0000`; la carga remota está en curso, marcador `importing`. No se aplican
  `0001`/`0002`/`0003` ni se sirve la aplicación antes de verificar el import.
- Snapshot de ensayo: 199.027 filas de 54 tablas, exportado en una transacción
  consistente el 03/10 a las 11:06:41 UTC. Se importó y verificó dos veces en
  SQLite privado (107.950.080 bytes). No acredita los cambios de producción
  posteriores a ese instante: el corte exige una exportación final nueva.
- Originales locales archivados y verificados en R2 privado: 1.855 blobs FIE,
  1.138 nacionales y sus dos manifiestos, 221.884.776 bytes en total.
  Ese primer archivo quedó superado por los siguientes, no es el total actual.
- La caché nacional ampliada quedó archivada y verificada por separado en R2:
  2.109 blobs y 278.467.814 bytes (incluido manifiesto), 971 blobs nuevos y
  1.138 reutilizados, código 0 en 992,17 s.
- La segunda vuelta FIE terminó: 3.154 unidades evaluadas, 3.137 cerradas,
  11 parciales y seis errores. R2 privado verifica 9.614 blobs, tres particiones
  y un índice, 216.577.918 bytes con metadatos. La relectura del índice,
  particiones y manifiesto original pasó, código 0, sin escrituras.
- La importación histórica local real, desde el snapshot base preservado,
  contiene 5.256 competiciones, 248.694 resultados y 668.128 asaltos.
  Pasan FKs, integridad y procedencia, sin nuevas personas ni merges.
  Es staging previo al corte, no un D1 remoto ni un snapshot final.
- El ensayo de composición previo al corte pasó: 1.045.210 filas de 54 tablas,
  618.963.920 bytes JSONL, importados y verificados dos veces, código 0.
  SQLite ocupa 631.074.816 bytes. Usar el base dos veces no acredita un corte.
- El snapshot congelado final terminó y la composición no encontró deriva en
  hechos/identidades protegidas. El ensayo final de 1.045.210 filas/54 tablas
  importó y verificó dos veces, código 0, 631.074.816 bytes de SQLite.
  Manifiesto `4e0fa7df665bccf2ccb2305a75da533c49d3a90b868290841817d71093056944`.
  Se conserva el export base, el final crudo y la copia histórica original.
- El acceso conserva `NEON_AUTH_URL` y `NEON_AUTH_COOKIE_SECRET`, cuyos nombres
  ya constan en producción. Debe verificarse el proveedor antes de reabrir.
  No requiere Resend ni un remitente nuevo para enviar códigos. No hay
  contraseña alternativa ni cambio silencioso de proveedor.
- Se comprobó la tarifa de Cloudflare Email Service: Workers Paid incluye
  3.000 envíos mensuales por cuenta, después 0,35 US$/1.000. Sigue en beta y
  exige dominio con DNS en Cloudflare; su preparación no se verificó con los
  permisos disponibles. El propietario eligió conservar Neon Auth.

## Preparación

1. Detener todos los escritores históricos y mantener Neon como rollback.
   La pausa de esos procesos no congela las acciones ni los crons del Worker.
   Antes del snapshot final, activar y verificar un corte de mantenimiento
   en el despliegue que aún usa Neon.
2. Confirmar el ID exacto de la base D1 de destino y que ningún runtime escriba
   en ella durante la importación.
3. Aplicar **solo** `drizzle-d1/0000_aplicacion.sql` al destino vacío. Se admite
   también `0001_auth.sql` si todas sus tablas están vacías. **No aplicar
   `0002_guardia_deportiva.sql` ni `0003_vinculos_revisados.sql` antes de
   terminar la importación verificada.**
4. Ejecutar con Node 22.20 o superior, dependencias instaladas y espacio local.
   El exportador reserva 512 MiB libres, comprueba capacidad por tabla y por
   chunk y crea una carpeta nueva fuera del repositorio. En Windows restringe
   su ACL al usuario actual y SYSTEM; en otros sistemas usa permisos 0700/0600.

### Corte y recuperación

Para congelar el runtime Neon existe `worker/mantenimiento-corte.ts`, con
configuración independiente `wrangler.mantenimiento.jsonc`: mismo Worker/cuenta,
sin aplicación, assets, bindings o crons. Todas las peticiones devuelven 503,
`private, no-store` y `Retry-After: 120`; ninguna variable puede reabrirlo.
Se conserva el almacén de variables/secretos (`keep_vars`). El dry-run no es
un corte: solo publicar y verificar HTTP congela producción.

El wrapper nuevo dispone además de `MIGRATION_MAINTENANCE`, apagado por defecto.
Al activarlo bloquea las peticiones de aplicación con `503`, `no-store` y
`Retry-After: 120`, y no ejecuta tareas programadas. Cualquier valor presente
distinto de `false` mantiene el bloqueo. Preparar ese código o editar la
variable local **no** congela producción: hay que publicar y verificar la
versión de mantenimiento sin sustituir prematuramente el runtime Neon.

Con el corte confirmado: obtener el snapshot final, aplicar `0000` al D1
vacío, importar y verificar, aplicar `0001` de controles de abuso y solo después
`0002` de guardia deportiva y `0003` de solicitudes de vinculación revisadas.
Probar el acceso OTP y las consultas con incremental desactivado antes de
reabrir tráfico. No usar `wrangler d1 migrations apply`
indiscriminadamente: podría instalar la guardia antes del import.

Antes de publicar, registrar la versión Neon vigente. Un rollback de código
no sincroniza las escrituras nuevas de D1 hacia Neon. Si ya se abrió D1 a
escrituras, volver primero a mantenimiento y decidir cómo preservar esas
escrituras; nunca cambiar a Neon en caliente ni borrar ninguna de las bases.
La migración PostgreSQL `0021_incremento_deportivo.sql` no se aplica a Neon.
Su CLI y los comandos `db:migrate`, `db:push` y `db:studio` están retirados
permanentemente: salida 2 antes de dotenv, credenciales, conexión o flags.

`0003` añade una tabla de autorización de aplicación, no identidades ni
sesiones del proveedor. No modifica las 54 tablas del snapshot ni se aplica
a Neon. Hay que instalarla después de la verificación estricta del import y
antes de servir `/alta` o `/admin/usuarios` con el runtime nuevo.

La búsqueda por nombre o licencia solo guarda una solicitud pendiente.
Una sesión administradora escribible debe verificar la identidad por una
vía independiente y registrar evidencia antes de aprobar. El CAS comprueba
ambos propietarios vacíos, cuenta y solicitud vigentes; ficha, armas,
fuentes y aprobación se escriben en un solo batch. Los vínculos antiguos se
conservan, pero `linked_via='persona'` no acredita esta revisión nueva:
revisarlos manualmente, sin revocación o fusión masiva.

## Exportación local

Desde la raíz del proyecto, con `NEON_SOURCE_DATABASE_URL` o el `DATABASE_URL`
de Neon en `.env`:

```powershell
npx tsx scripts/exportar-neon-d1.ts --exportar
```

Sin `--exportar` solo muestra ayuda. Usa un `Pool` aislado, un único cliente
WebSocket y una transacción `REPEATABLE READ READ ONLY`, comprobada dentro de
la transacción. Los cursores, catálogos y conteos pertenecen al mismo snapshot.
Finaliza con `ROLLBACK`, incluso ante errores. No importa el índice SQLite de
la aplicación ni consulta tablas fuera de la lista fija `public`.

La salida indica únicamente carpeta temporal, ID de migración, tablas, filas
y bytes. No abrir ni copiar los archivos JSONL a logs, tickets, capturas, Git,
respuestas de chat o endpoints distintos del D1 confirmado. Contienen datos
privados de aplicación autorizados para este traslado. Conservar la carpeta
privada hasta verificar el destino; su eliminación posterior es una decisión
explícita del operador.

`manifest.json` aparece solamente al concluir toda la exportación y contiene
metadatos de esquema, conteos, tamaños y hashes, nunca registros. El SHA-256 del
esquema fija el archivo SQL completo: columnas, índices, defaults y constraints.
El ID de migración fija los hashes ordenados de todas las tablas.

## Validación sin escrituras

```powershell
npx tsx scripts/importar-d1.ts --manifest '<carpeta-temporal>\manifest.json'
```

Sin destino no hace red. Comprueba inventario de 54 tablas, 681 columnas del
esquema objetivo, metadatos, nombres locales de chunks, hashes de bytes, claves
ordenadas sin duplicados, tipos, políticas de credenciales, conteos, hash de
cada tabla y límites de cada INSERT/UPDATE. Devuelve `manifestSha256`.

Con `CLOUDFLARE_API_TOKEN` en el entorno y los dos identificadores:

```powershell
npx tsx scripts/importar-d1.ts --manifest '<carpeta-temporal>\manifest.json' --account-id '<account-id>' --database-id '<database-uuid>'
```

Continúa siendo solo lectura. Rechaza esquemas modificados, tablas ajenas,
tablas de auth con datos, y datos existentes sin marcador de esta migración.
Para reanudar exige el mismo ID de migración, SHA-256 del manifiesto, ID de
base y que cada fila existente sea exactamente una fila del export, en su
estado temporal permitido o su estado final.

Si el token del proyecto no autoriza D1, puede usarse una sesión OAuth de
Wrangler ya autorizada, sin extraer ni guardar su token:

```powershell
npx tsx scripts/importar-d1.ts --manifest '<carpeta-temporal>\manifest.json' --account-id '<account-id>' --database-id '<database-uuid>' --wrangler-oauth
```

La herramienta valida todos los archivos antes de abrir un binding remoto,
genera una configuración privada temporal y excluye `.env` de ese proxy.
No añade `jurisdiction` al binding, porque Wrangler no admite ese campo.
Un destino sin `0000` devuelve `destination_application_schema_mismatch`:
demuestra acceso al transporte, no que se haya importado nada.

## Incorporar el histórico sin reemplazar datos actuales

`scripts/componer-historico-d1.ts` genera un export privado local nuevo.
No abre Neon ni un binding remoto. Requiere un export base, un export nuevo
y una copia histórica **cerrada, en modo DELETE**, con sus tres hashes explícitos:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/componer-historico-d1.ts --preparar --base-manifest '<base>\manifest.json' --manifest '<final>\manifest.json' --d1-local '<copia-cerrada>\historico.sqlite' --base-sha256 '<hash-base>' --manifest-sha256 '<hash-final>' --source-sha256 '<hash-sqlite>'
```

El export nuevo debe venir del corte verificado; usar el base dos veces solo
acredita un ensayo previo al corte. La herramienta:

- valida ambos exports íntegros y fija el esquema de 54 tablas;
- rechaza cualquier deriva de personas, IDs externos, eventos, competiciones
  de calendario y las cinco tablas de hechos entre base y export nuevo;
- lee staging en transacción de solo lectura, bajo su lock exclusivo, con
  guardias exactas, lease inactivo, FKs y `quick_check`, y vuelve a hash-ear
  todo el fichero antes de publicar;
- exige que **todas** las tablas de aplicación de staging, salvo los cinco
  hechos y el lease operativo, coincidan exactamente con el base;
- incorpora solo `sport_edition`, `sport_competition`, `sport_result`,
  `sport_bout` y `sport_import_coverage` de staging. Perfiles, IDs Neon Auth,
  permisos, favoritos, registros, eventos y demás vienen del export nuevo;
- limita fuente a 4 GiB, salida a 1 GiB/1.500.000 filas y chunks a 4 MiB,
  comprobando los límites del importador por fila. Publica el manifiesto al final.

Una deriva aborta antes de escribir chunks: exige nuevo replay/revisión, no
un merge de UUIDs ni sobrescritura de producción. La copia histórica y el export
anterior se conservan. Si staging usa WAL, crear y verificar una copia nueva
cerrada en DELETE; nunca borrar el WAL de la original.

El manifiesto añade procedencia `postgresql+verified-history`, con hashes
de base/export nuevo/SQLite y una lista fija de las cinco tablas. El importador
mantiene sus comprobaciones exactas de columnas, credenciales, hashes, destino
y FKs; no acepta guardias `0002`/`0003` en el destino de import.

## Importación autorizada y verificación

La siguiente orden **escribe en D1**; revisar el ID de destino y el hash
obtenido antes de ejecutarla:

```powershell
npx tsx scripts/importar-d1.ts --manifest '<carpeta-temporal>\manifest.json' --account-id '<account-id>' --database-id '<database-uuid>' --aplicar --confirmar-database-id '<mismo-database-uuid>' --manifest-sha256 '<sha256-del-manifiesto-validado>'
```

Añadir `--wrangler-oauth` usa ese mismo transporte autorizado para importar o
verificar. Los dos identificadores y el hash de confirmación siguen siendo
obligatorios para escribir.

No hay DROP, TRUNCATE, DELETE ni sobrescritura de filas ajenas. INSERT usa
conflicto exclusivamente sobre la PK y solo después de verificar filas
existentes; los UPDATE restauran referencias autorizadas, no datos arbitrarios.
Cada sentencia tiene ≤100 binds y ≤100 KiB de SQL; cada petición tiene
≤900 KiB. Los lotes locales tienen ≤100 filas y ≤900 KiB antes de dividirse.
Los JSONL son chunks de ≤4 MiB; una fila >880 KiB falla antes de importar.
La lectura del destino adapta sus páginas al mayor tamaño real de fila.

El orden respeta FKs obligatorias. Las referencias nullable a la misma tabla
o a tablas posteriores se insertan temporalmente como NULL y se restauran en
una segunda pasada. Esto permite enlaces cíclicos sin desactivar FKs. El
destino no debe servir tráfico durante este estado intermedio.

Cada checkpoint se escribe únicamente después de aceptar los INSERT del
lote. Ante pérdida de conexión se vuelve a verificar todo el subconjunto
existente; el checkpoint nunca es prueba suficiente. Solo se reintentan
lecturas y operaciones idempotentes; DDL no tiene retry automático.

La herramienta no marca `complete` hasta que coincidan conteos, bytes y hashes
ordenados de **todas** las tablas, `foreign_key_check` no devuelva errores y
`quick_check` sea `ok`. Verificación posterior sin escritura:

```powershell
npx tsx scripts/importar-d1.ts --manifest '<carpeta-temporal>\manifest.json' --account-id '<account-id>' --database-id '<database-uuid>' --verificar
```

## Conversiones y accesos

| PostgreSQL | D1 |
|---|---|
| UUID, enums, texto | TEXT sin cambiar el valor |
| timestamp | INTEGER UTC en milisegundos; se descarta precisión submilisegundo |
| date | TEXT ISO `YYYY-MM-DD`, sin conversión de zona |
| boolean | INTEGER 0/1 |
| JSON/JSONB | TEXT JSON, sin redondear enteros JSON grandes |
| arrays | JSON TEXT; la aplicación actual no declara arrays |
| numeric/decimal | TEXT, sin convertir a Number |
| integer | INTEGER seguro; valores fuera del rango seguro fallan |
| NULL | NULL, no reemplazado por defaults |

Únicamente `sport_ranking_publication.date_basis='observed'` y `revision=1`
tienen backfill si el origen anterior a 0021 no dispone de esas columnas.
Tablas posteriores opcionales inexistentes se representan como vacías.

No se exporta `neon_auth`, sesiones, contraseñas, cookies, OTPs ni tokens del
proveedor. **Se conserva `user_profile.auth_user_id`**, referencia al mismo
Neon Auth gestionado, no credencial. Nunca se lee el viejo `ical_token`: se genera un token nuevo de 256 bits
localmente. En `club_skermo_settings` elimina la contraseña cifrada y la
fecha de credencial, y desactiva `direct_submit_enabled`.

Se conservan IDs, perfiles, emails, roles y relaciones de aplicación. Cada
sesión exige identidad gestionada verificada, ID y email coincidentes, y
perfil activo en D1. Leer sesiones no enlaza invitaciones. Un OTP recién
verificado puede reclamar solo un perfil único sin ID; nunca reemplaza un
enlace existente distinto. Revocación y roles se comprueban en cada petición.
El cierre de sesión confirma la revocación del token original en el proveedor
antes de borrar cookies. Las vistas privadas usan el secreto ya existente.

El snapshot de ensayo anterior dejaba `auth_user_id=NULL`: **no es el snapshot
de corte**. La exportación final debe hacerse con la nueva política y volver
a verificarse. Los enlaces iCal antiguos deberán renovarse y las credenciales
Skermo deberán reconfigurarse. Las sesiones Neon pueden mantenerse si se
conservan el origen, proveedor, IDs y secreto, pero no se afirma sin QA real.

## Pruebas acotadas

```powershell
npx vitest run tests/d1-migracion.test.ts
```

Fixtures SQLite locales y fetch simulado: conversiones, comillas y saltos de
línea, enteros JSON grandes, decimales, filas grandes, límites, snapshot,
rollback, exclusión de secretos, backfills, FKs cíclicas, checksums, corrupción,
destino ajeno, confirmación explícita y reanudación idempotente. No se ejecuta
ninguna escritura remota ni se utiliza un navegador o una cuenta real.

## Archivo privado de originales

`scripts/archivar-historico-r2.ts` comprueba todos los blobs y referencias de
las cachés locales antes de hacer red. Sin `--aplicar` solo hace preflight.
Para subir exige el identificador de cuenta y
`--confirmar-cubo calendario-esgrima-archivos`. Usa el OAuth existente de
Wrangler, como máximo 512 MiB y 30 minutos por ejecución, sin GETs a FIE o
Skermo. No crea un cubo, cambia su acceso público ni compra almacenamiento.

Los blobs se guardan por SHA-256 bajo `historico-interno/v1`. Cada objeto nuevo
o reutilizado se lee y verifica; un contenido distinto en una clave existente
bloquea el proceso en vez de sobrescribirlo. El manifiesto de cada fuente se
publica solo después de comprobar todos sus blobs. Las subidas interrumpidas
pueden retomarse sin duplicar objetos; no reinician las campañas de descarga.
Los recibos privados contienen hashes, conteos y bytes, nunca cuerpos.

La ruta normal `/api/archivos/*` deniega ese prefijo incluso con sesión. El
lector interno exige hash, tamaño y URL exacta, y no vuelve a la fuente si
falta un objeto. La extracción e importación de hechos es otra fase: los
parciales, los denominadores desconocidos y los conflictos se conservan.

## Capacidad D1 y costes

La asignación propia máxima es 8 GiB (`D1_STORAGE_BUDGET_BYTES`, techo del
CHECK de `sport_write_context` desde `0005_presupuesto_8gib.sql`; `0002` lo
instaló con 4 GiB). No es la cuota gratuita de esta aplicación ni un límite de
gasto; D1 admite hasta 10 GB por base en el plan de pago. D1 rechaza los PRAGMAs de
tamaño: el runtime usa `meta.size_after` de un `SELECT 1` y conteos de solo
lectura. No afirma tamaños por tabla que D1 no publica.

Los escritores deportivos reservan crecimiento conservador en un ledger
atómico junto al contexto de propietario. La admisión usa
`max(ledger, tamaño medido) + proyección < presupuesto`. El ledger conserva
overhead de lote/fila y los bytes completos insertados o de columnas cambiadas
en UPDATE; no vuelve a cargar un cursor grande retenido ni devuelve créditos
por DELETE. La proyección incluye SQL y parámetros; la reserva por filas
detiene amplificación SQL y actualizaciones masivas. Conserva el bloqueo si
una comprobación posterior falla.
Esto **no es un tope físico perfecto**: el tamaño definitivo llega después
del commit; escrituras ajenas o crecimiento subestimado pueden producir un
error poscommit y un bloqueo durable, no una reversión retroactiva.
El incremental sigue desactivado y exige validación en el runtime D1 real.

Las cuotas incluidas de D1, Workers y R2 se comparten en la cuenta. El plan de
5 US$ indicado por el propietario no se ha podido verificar por las lecturas
de facturación disponibles; estos conteos no son una factura ni una garantía
de coste cero. No se ha modificado ningún plan.
