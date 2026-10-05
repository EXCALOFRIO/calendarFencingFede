import { sql } from 'drizzle-orm';
import { filas, type ContextoExplorador } from './contexto';
import { listaUuid } from './filtros-sql';
import { SALTOS } from './personas';
import { TRAYECTORIA_VACIA, type TrayectoriaPersona } from './tipos-busqueda';

/**
 * Trayectoria de una página de personas en UNA consulta: última clasificación,
 * mejor puesto individual y medallas. Se agrupa por la persona que prevalece
 * con los resultados de todo su grupo de fusión (los hechos conservan el ID
 * con el que se guardaron), y sólo recorre los resultados de esas personas
 * por `sport_result_person_date_idx`.
 */
export function sqlTrayectorias(ids: readonly string[]) {
  return sql`
    WITH RECURSIVE miembros_grupo(canonica, id, salto) AS (
      SELECT id, id, 0 FROM sport_person WHERE id IN (${listaUuid(ids)})
      UNION ALL
      SELECT mg.canonica, mp.id, mg.salto + 1
      FROM sport_person mp JOIN miembros_grupo mg ON mp.merged_into_person_id = mg.id
      WHERE mg.salto < ${SALTOS}
    ),
    hechos AS (
      SELECT g.canonica AS canonica, r.position AS puesto, c.format AS formato,
             e.id AS edicion, e.name AS torneo,
             coalesce(r.occurred_on, c.competition_date, e.start_date) AS fecha
      FROM miembros_grupo g
      -- CROSS JOIN: sin él SQLite recorre todo sport_result y busca en el CTE.
      CROSS JOIN sport_result r ON r.person_id = g.id
      JOIN sport_competition c ON c.id = r.competition_id
      JOIN sport_edition e ON e.id = c.edition_id
    ),
    recientes AS (
      SELECT canonica, edicion, torneo, fecha,
             row_number() OVER (
               PARTITION BY canonica
               ORDER BY coalesce(fecha, '0001-01-01') DESC, edicion DESC
             ) AS orden
      FROM hechos
    )
    SELECT h.canonica AS id,
           min(CASE WHEN h.formato = 'INDIVIDUAL' THEN h.puesto END) AS "mejorPuesto",
           count(*) FILTER (WHERE h.formato = 'INDIVIDUAL' AND h.puesto = 1) AS oros,
           count(*) FILTER (WHERE h.formato = 'INDIVIDUAL' AND h.puesto = 2) AS platas,
           count(*) FILTER (WHERE h.formato = 'INDIVIDUAL' AND h.puesto = 3) AS bronces,
           u.edicion AS "ultimaEdicion", u.torneo AS "ultimoTorneo", u.fecha AS "ultimaFecha"
    FROM hechos h
    LEFT JOIN recientes u ON u.canonica = h.canonica AND u.orden = 1
    GROUP BY h.canonica, u.edicion, u.torneo, u.fecha`;
}

type FilaTrayectoria = {
  id: string;
  mejorPuesto: number | null;
  oros: number;
  platas: number;
  bronces: number;
  ultimaEdicion: string | null;
  ultimoTorneo: string | null;
  ultimaFecha: string | null;
};

/** Una entrada por ID pedido; sin resultados importados devuelve la trayectoria vacía. */
export async function leerTrayectorias(
  db: ContextoExplorador['db'],
  ids: readonly string[],
): Promise<Map<string, TrayectoriaPersona>> {
  const mapa = new Map<string, TrayectoriaPersona>();
  if (ids.length === 0) return mapa;
  const rows = filas<FilaTrayectoria>(await db.execute(sqlTrayectorias(ids)));
  for (const r of rows) {
    mapa.set(r.id, {
      ultima:
        r.ultimaEdicion && r.ultimoTorneo
          ? { edicionId: r.ultimaEdicion, torneo: r.ultimoTorneo, fecha: r.ultimaFecha }
          : null,
      mejorPuesto: r.mejorPuesto === null ? null : Number(r.mejorPuesto),
      oros: Number(r.oros ?? 0),
      platas: Number(r.platas ?? 0),
      bronces: Number(r.bronces ?? 0),
    });
  }
  for (const id of ids) if (!mapa.has(id)) mapa.set(id, TRAYECTORIA_VACIA);
  return mapa;
}
