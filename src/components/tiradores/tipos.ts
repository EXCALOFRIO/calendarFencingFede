import type { PuestoRanking } from '@/app/(app)/tiradores/consultas';
import type { AthleteOverview } from '@/lib/queries/coach';

/**
 * Lo que ve la pantalla de un tirador.
 *
 * Es `AthleteOverview` —que ya trae armas, categoría, inscripciones vivas,
 * resultados y próximas competiciones— más las dos cosas que no están allí:
 * su puesto en el último ranking y lo que sigue esperando al club.
 *
 * El tipo vive en su propio módulo, sin tocar la base de datos, para que el
 * componente de cliente pueda importarlo sin arrastrar la conexión a Neon al
 * navegador.
 */
export type TiradorVista = AthleteOverview & {
  ranking: PuestoRanking[];
  /** Competiciones futuras solicitadas y todavía sin validar por el club. */
  enClub: AthleteOverview['upcoming'];
};
