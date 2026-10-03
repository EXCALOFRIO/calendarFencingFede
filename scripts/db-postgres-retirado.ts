/**
 * Application data now belongs to D1. Keep former npm entry points fail-closed
 * without loading credentials or opening a PostgreSQL connection.
 */
console.error('Comando PostgreSQL retirado: no se migra, modifica ni abre un editor de Neon. Consulte docs/migracion-cloudflare.md.');
process.exitCode = 2;
