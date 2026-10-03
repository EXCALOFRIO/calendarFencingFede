/** Explicit, source-only adapter. Importing it does not open a connection. */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

export { schema };

export function createLegacyPostgresDb(connectionString: string) {
  if (!connectionString) throw new Error('PostgreSQL export requires an explicit source URL.');
  return drizzle(neon(connectionString), { schema });
}
