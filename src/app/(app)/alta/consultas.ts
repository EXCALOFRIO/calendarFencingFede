import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { athlete, athleteWeapon, club } from '@/db/schema';
import type { Arma, ClasificacionOficial } from '@/lib/altas/desde-ranking';
import { deriveCategoriesFromBirthDate } from '@/lib/categories';
import { getCurrentSeason } from '@/lib/queries/calendar';
import { getPuestosOficiales } from '@/lib/queries/ranking';
import { yearFromIsoDate } from '@/lib/utils';

/**
 * Lo que se le enseña a alguien cuando su ficha ya está vinculada.
 *
 * Es la parte que pidió el usuario con estas palabras: *«todo eso debería salir
 * por ahí para que se sepa que está bien»*. Un «listo» verde no vale, porque no
 * demuestra nada. Lo que demuestra que ha funcionado es ver su propio puesto
 * oficial, sus puntos y su categoría, que son datos que nadie ha tecleado.
 *
 * Se lee de la base, no se arrastra desde la acción: así la misma pantalla
 * sirve para la confirmación del momento y para volver a mirarla mañana.
 */

export type ClasificacionVista = ClasificacionOficial & {
  /** Cuántos hay en esa clasificación: un 3.º de 88 no es un 3.º de 3. */
  deCuantos: number;
};

export type ResumenFicha = {
  atletaId: string;
  nombre: string;
  licencia: string | null;
  club: string | null;
  anioNacimiento: number;
  armas: Arma[];
  temporada: string | null;
  /** La categoría que le toca por edad, derivada de la tabla de la temporada. */
  categoriaPropia: string | null;
  /** Todas en las que puede competir: se sube de categoría, no se baja. */
  categoriasElegibles: string[];
  /** Explicación literal de la derivación, para poder enseñarla. */
  explicacionCategoria: string;
  clasificaciones: ClasificacionVista[];
  actualizadoEl: Date | null;
  urlFuente: string | null;
};

/** La ficha de un tirador con sus clasificaciones oficiales y su categoría. */
export async function getResumenFicha(atletaId: string): Promise<ResumenFicha | null> {
  const [ficha] = await db
    .select({
      id: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      birthDate: athlete.birthDate,
      rfeeLicense: athlete.rfeeLicense,
      clubName: club.name,
    })
    .from(athlete)
    .leftJoin(club, eq(athlete.clubId, club.id))
    .where(eq(athlete.id, atletaId))
    .limit(1);

  if (!ficha) return null;

  const [armas, puestos, temporada] = await Promise.all([
    db
      .select({ weapon: athleteWeapon.weapon })
      .from(athleteWeapon)
      .where(eq(athleteWeapon.athleteId, atletaId)),
    getPuestosOficiales([atletaId]),
    getCurrentSeason(),
  ]);

  const derivadas = temporada
    ? deriveCategoriesFromBirthDate(ficha.birthDate, temporada.categories)
    : {
        own: null,
        eligible: [],
        explanation:
          'Todavía no hay temporada configurada, así que no se puede derivar ' +
          'la categoría. Lo arregla la dirección técnica.',
      };

  return {
    atletaId: ficha.id,
    nombre: `${ficha.firstName} ${ficha.lastName}`.trim(),
    licencia: ficha.rfeeLicense,
    club: ficha.clubName,
    anioNacimiento: yearFromIsoDate(ficha.birthDate),
    armas: armas.map((a) => a.weapon),
    temporada: puestos[0]?.seasonLabel ?? temporada?.label ?? null,
    categoriaPropia: derivadas.own,
    categoriasElegibles: derivadas.eligible,
    explicacionCategoria: derivadas.explanation,
    clasificaciones: puestos.map((p) => ({
      temporada: p.seasonLabel,
      arma: p.weapon,
      genero: p.gender,
      categoria: p.category,
      categoriaOriginal: p.categoryRaw,
      puesto: p.position,
      puntos: p.totalPoints,
      urlFuente: p.sourceUrl,
      deCuantos: p.deCuantos,
    })),
    actualizadoEl: puestos[0]?.actualizadoEl ?? null,
    urlFuente: puestos[0]?.sourceUrl ?? null,
  };
}
