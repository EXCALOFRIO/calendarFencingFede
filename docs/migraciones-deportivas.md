# Migraciones deportivas 0017 → 0018 → 0019

Comando: `node node_modules/tsx/dist/cli.mjs scripts/aplicar-migraciones-deportivas.ts [--aplicar]`.

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
