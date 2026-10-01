import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { crearDetectorCondicion, crearDetectorEsquema } from './esquema';

export const esquemaDeportivo = crearDetectorEsquema(async () => {
  const [fila] = await db
    .select({
      identidad: sql<boolean>`(to_regclass('public.sport_person') is not null and to_regclass('public.sport_external_id') is not null)`,
      referencias: sql<boolean>`to_regclass('public.sport_registration_ref') is not null`,
    })
    .from(sql`(select 1) as catalogo`);
  return { identidad: Boolean(fila?.identidad), referencias: Boolean(fila?.referencias) };
});

/** Migración 0019: `category_code` ya admite M10 y M12. */
export const categoriasHistoricasAplicadas = crearDetectorCondicion(async () => {
  const [fila] = await db
    .select({
      aplicada: sql<boolean>`(
        select count(*) = 2 from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'category_code' and e.enumlabel in ('M10', 'M12')
      )`,
    })
    .from(sql`(select 1) as catalogo`);
  return Boolean(fila?.aplicada);
});
