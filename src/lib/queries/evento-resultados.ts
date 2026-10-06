import { sql } from 'drizzle-orm';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { filas } from '@/lib/sport/explorar/contexto';
import {
  cargarResultadosEvento,
  type VistaResultadosEvento,
} from '@/lib/sport/explorar/ediciones-pantalla';
import { leerEdicion } from '@/lib/sport/explorar/ediciones';
import { listaUuid } from '@/lib/sport/explorar/filtros-sql';

/**
 * ===========================================================================
 * EL PODIO DE UN TORNEO DEL CALENDARIO
 * ===========================================================================
 *
 * Un torneo del calendario (`event`) se une a sus resultados por
 * `sport_edition.event_id` —también la edición vinculada al par absorbido,
 * `event.canonical_event_id`—, y de ahí a `sport_competition` y
 * `sport_result`. Esa parte ya la lee `cargarResultadosEvento`, con su guarda
 * de sesión y sus estados («sin sesión», «no disponible», «sin edición»);
 * aquí solo se le añade el podio de cada prueba.
 *
 * Hoy `event_id` está vacío en todas las ediciones. Mientras tanto,
 * `cargarPodiosEvento` acepta un segundo camino (`EdicionesPorClave`) que
 * casa el torneo con sus ediciones por clave exacta; solo se usa cuando el
 * vínculo guardado no da nada.
 *
 * El podio sale de UNA fuente por prueba, la que más puestos tiene, igual que
 * la clasificación de la página de edición: mezclar dos lecturas de la misma
 * prueba pondría dos oros. En esgrima hay dos bronces, así que el tercer puesto
 * puede venir dos veces y por eso el corte es por puesto y no por número de
 * filas.
 */

export type PuestoPodio = {
  puesto: 1 | 2 | 3;
  nombre: string;
  /** Código de país tal y como lo publica la fuente (ISO o FIE). */
  pais: string | null;
  club: string | null;
  /** Solo si el resultado está vinculado a una persona deportiva. */
  personaId: string | null;
};

export type VistaPodiosEvento =
  | Exclude<VistaResultadosEvento, { tipo: 'ok' }>
  | (Extract<VistaResultadosEvento, { tipo: 'ok' }> & {
      /** Por prueba de la edición; una prueba sin puestos importados no está. */
      podios: Record<string, PuestoPodio[]>;
    });

type FilaPodio = {
  pruebaId: string;
  puesto: number;
  nombre: string;
  pais: string | null;
  club: string | null;
  personaId: string | null;
};

/** Cuatro filas por prueba: oro, plata y los dos bronces. */
const MAXIMO_POR_PRUEBA = 4;

export async function leerPodios(
  ctx: ContextoExplorador,
  pruebaIds: readonly string[],
): Promise<Record<string, PuestoPodio[]>> {
  const podios: Record<string, PuestoPodio[]> = {};
  if (pruebaIds.length === 0) return podios;

  const ids = listaUuid(pruebaIds);
  const rows = filas<FilaPodio>(
    await ctx.db.execute(sql`
      WITH fuentes AS (
        SELECT r.competition_id AS prueba, r.source AS fuente,
               row_number() OVER (
                 PARTITION BY r.competition_id ORDER BY count(*) DESC, r.source
               ) AS orden
        FROM sport_result r
        WHERE r.competition_id IN (${ids})
        GROUP BY r.competition_id, r.source
      )
      SELECT r.competition_id AS "pruebaId", r.position AS puesto,
             r.source_name AS nombre, r.source_country_code AS pais,
             r.source_club AS club, r.person_id AS "personaId"
      FROM sport_result r
      JOIN fuentes f ON f.prueba = r.competition_id AND f.fuente = r.source AND f.orden = 1
      WHERE r.position BETWEEN 1 AND 3
      ORDER BY r.competition_id, r.position, r.id`),
  );

  for (const f of rows) {
    const lista = (podios[f.pruebaId] ??= []);
    if (lista.length >= MAXIMO_POR_PRUEBA) continue;
    lista.push({
      puesto: Number(f.puesto) as 1 | 2 | 3,
      nombre: f.nombre,
      pais: f.pais,
      club: f.club,
      personaId: f.personaId,
    });
  }
  return podios;
}

/**
 * Las ediciones del torneo con sus pruebas, enlaces oficiales y podios.
 *
 * La guarda de sesión es la de `cargarResultadosEvento` y va antes de leer
 * nada: sin sesión no se llega a pedir el podio. Si el podio falla, se
 * devuelve lo demás sin él —el enlace a la clasificación sigue valiendo— y
 * no se hace pasar el fallo por «no hay resultados».
 */
/**
 * Ediciones de Explorar que son este torneo por clave exacta (la de la FIE,
 * la de Skermo…), para cuando `sport_edition.event_id` todavía no está
 * relleno. Devuelve ids de edición; vacío si no casa ninguna.
 */
export type EdicionesPorClave = (eventoId: string) => Promise<string[]>;

const MAXIMO_EDICIONES = 6;

export async function cargarPodiosEvento(
  ctx: ContextoExplorador,
  eventoId: unknown,
  porClave?: EdicionesPorClave,
): Promise<VistaPodiosEvento> {
  let vista = await cargarResultadosEvento(ctx, eventoId);
  if (vista.tipo !== 'ok') return vista;

  /*
    El vínculo guardado manda. Solo si no hay ninguno se prueba la clave
    exacta, y cada edición se lee con `leerEdicion`, que repite la guarda de
    sesión y devuelve las pruebas con sus enlaces igual que el otro camino.
  */
  if (vista.ediciones.length === 0 && porClave && typeof eventoId === 'string') {
    try {
      const ids = [...new Set(await porClave(eventoId))].slice(0, MAXIMO_EDICIONES);
      const leidas = await Promise.all(ids.map((edicionId) => leerEdicion(ctx, { edicionId })));
      const ediciones = leidas.flatMap((r) => {
        if (r.estado !== 'ok') return [];
        const { clasificacion: _c, asaltos: _a, pruebaDesconocida: _p, ...edicion } = r.edicion;
        return [edicion];
      });
      vista = { tipo: 'ok', ediciones };
    } catch (error) {
      // Un camino de más que falla no tumba el que sí respondió (vacío).
      console.error(
        '[calendario] las ediciones por clave no se pudieron leer:',
        error instanceof Error ? error.name : 'desconocido',
      );
    }
  }

  const pruebaIds = vista.ediciones.flatMap((e) =>
    e.pruebasDetalle.filter((p) => p.resultados.importados > 0).map((p) => p.id),
  );
  try {
    return { ...vista, podios: await leerPodios(ctx, pruebaIds) };
  } catch (error) {
    console.error(
      '[calendario] el podio del torneo no se pudo leer:',
      error instanceof Error ? error.name : 'desconocido',
    );
    return { ...vista, podios: {} };
  }
}
