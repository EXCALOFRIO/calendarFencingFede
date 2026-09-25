import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

/**
 * Conexión a Neon por HTTP.
 *
 * El driver @neondatabase/serverless habla por HTTP, así que no hay pool de
 * conexiones que agotar en serverless: cada invocación de función abre y cierra
 * su petición. Es la razón de elegirlo frente a `pg`.
 *
 * Neon Free suspende el compute a los 5 minutos de inactividad. Eso se nota
 * como ~0,5 s extra en la primera consulta tras un rato parado, no como un
 * error. Con 20 usuarios es irrelevante.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'Falta DATABASE_URL. Copia .env.example a .env y pon la cadena de Neon.',
  );
}

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });
export { schema };
export type Db = typeof db;
