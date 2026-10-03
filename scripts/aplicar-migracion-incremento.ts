/**
 * Retired PostgreSQL writer. 0021 must never be applied to Neon.
 * No imports, dotenv, credentials, preflight connection or flag can enable it.
 * D1 guards are installed separately after the verified application import.
 */
console.error('Comando retirado: no se aplica 0021 a Neon. Consulte docs/migracion-cloudflare.md para el corte D1.');
process.exitCode = 2;
