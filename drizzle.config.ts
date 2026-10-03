import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // Offline legacy schema generation only. Never supply Neon credentials here:
  // migrate/push/studio are retired; the dedicated exporter is read-only.
  schema: './src/db/legacy-postgres/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  verbose: true,
  strict: true,
});
