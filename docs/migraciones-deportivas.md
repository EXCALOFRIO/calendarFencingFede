# Migraciones deportivas 0017 → 0018 → 0019

Comando: `node node_modules/tsx/dist/cli.mjs scripts/aplicar-migraciones-deportivas.ts [--aplicar]`.

**Estado vigente: las tres migraciones ya están aplicadas (ver «Registro de la
aplicación real»). No se reaplican.** El preflight de sólo lectura devuelve
ahora el código 2 (esperado, porque las pendientes ya figuran en el ledger) y
no es un motivo para reintentar `--aplicar`.

Aplica **sólo** las tres migraciones aditivas, en ese orden, con sus filas del
ledger de Drizzle (`drizzle.__drizzle_migrations`) en **una única transacción**
(`SET LOCAL lock_timeout = 10s`, `statement_timeout = 120s`). No invoca el
migrador general ni `db:push`, que aplicarían cualquier otra pendiente.

Sin `--aplicar` hace el preflight de sólo lectura y no escribe. El preflight
para (código de salida 2) si:

* el ledger no tiene exactamente las filas previas, con el `hash` (sha256 del
  SQL con saltos de línea LF, como el índice de git) y el `created_at` del journal;
* alguna de las tres pendientes ya figura en el ledger, o ya existen tablas
  `sport_*`, enums `sport_*`, `M10` o `M12`;
* falta una tabla o enum previo del que dependen las claves ajenas, o el
  servidor es anterior a PostgreSQL 12 (`ADD VALUE` dentro de transacción);
* los límites de la transacción no se reflejan en `pg_settings`.

Un hash distinto no se «corrige»: se escala.

## Recuperación

* **Antes del commit:** la transacción se revierte entera, ledger incluido.
* **Después del commit:** sólo se revierte el **código**. Las tablas, los enums,
  los datos y el ledger se dejan como están; no hay SQL de bajada automático ni
  se borran enums, tablas o hechos.
* No hay copia ni restore point de Neon acreditados para esta operación. Esa
  recuperación no deshace Neon ni repara daños anteriores.

## Registro de la aplicación real (02/10/2026)

* Preflight: ledger 16 filas con hash y `created_at` coincidentes con los SQL
  revisados, 0 tablas `sport_*`, servidor PostgreSQL 18, límites verificados.
* Transacción: 70 sentencias (incluidas 3 filas de ledger), 701 ms, confirmada.
  Después: ledger 19 filas, 13 tablas `sport_*`, 2 enums, `M10`/`M12` presentes.
* Un segundo preflight sobre el estado nuevo para sin escribir (idempotencia).

## Límites que conviene no olvidar

* El hash de `0016` se calcula sobre el contenido con saltos de línea LF
  (`src/lib/db/migracion-aditiva.ts`), igual que el índice de git y el ledger,
  para que `core.autocrlf` en Windows no produzca un falso desfase. El ledger no
  se modificó.
* La `0018` añade referencias de inscripción y fuerza **una** reescritura por lista
  en la próxima lectura FIE elegible (acotada a 60 por pasada y a la guarda de
  capacidad). No es una hidratación exhaustiva inmediata ni una ingesta ilimitada.
* Después del commit, volver a una versión anterior del Worker deja objetos, datos
  y ledger como están; no se escribió ni se debe ejecutar SQL de bajada ni borrar
  enums. No hay respaldo ni punto de restauración de Neon acreditados.
* Esta integración no demuestra que el incidente operativo del 02/10/2026 (suites
  de pruebas con acceso de escritura a la base existente) no tuviera consecuencias
  históricas, ni las descarta: los conteos legacy iguales antes y después del
  piloto no prueban igualdad de valores, y `notification` tiene 3 filas sin
  atribución. No se investigó ni se limpió nada.