import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { crearDetectorCondicion, crearDetectorEsquema } from './esquema';

export const esquemaDeportivo = crearDetectorEsquema(async () => {
  const { rows } = await db.execute<{ name: string }>(sql`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('sport_person', 'sport_external_id', 'sport_registration_ref')`);
  const tablas = new Set(rows.map((r) => r.name));
  return {
    identidad: tablas.has('sport_person') && tablas.has('sport_external_id'),
    referencias: tablas.has('sport_registration_ref'),
  };
});

/** En SQLite las categorías admitidas se documentan en el CHECK del catálogo. */
export const categoriasHistoricasAplicadas = crearDetectorCondicion(async () => {
  const { rows } = await db.execute<{ sql: string }>(sql`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sport_competition'`);
  return Boolean(rows[0]?.sql.includes("'M10'") && rows[0]?.sql.includes("'M12'"));
});
