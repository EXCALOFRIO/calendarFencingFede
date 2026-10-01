import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { crearDetectorEsquema } from './esquema';

export const esquemaDeportivo = crearDetectorEsquema(async () => {
  const [fila] = await db
    .select({
      identidad: sql<boolean>`(to_regclass('public.sport_person') is not null and to_regclass('public.sport_external_id') is not null)`,
      referencias: sql<boolean>`to_regclass('public.sport_registration_ref') is not null`,
    })
    .from(sql`(select 1) as catalogo`);
  return { identidad: Boolean(fila?.identidad), referencias: Boolean(fila?.referencias) };
});
