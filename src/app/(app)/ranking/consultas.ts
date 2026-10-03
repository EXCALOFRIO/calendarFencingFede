import { and, eq } from 'drizzle-orm';
import { enLista as inArray } from '@/lib/sqlite';
import { db } from '@/db';
import { fieFencer } from '@/db/schema';
import { getManagedAthletes, requireProfile } from '@/lib/auth/session';
import {
  type FormatoClasificacion,
  type TablaClasificacionFie,
  getClasificacionFie,
} from '@/lib/queries/ranking';
import type { Gender, RankingCategory, Weapon } from '@/lib/ranking/compute';

/**
 * Lo que le falta a `src/lib/queries/ranking.ts` para esta pantalla.
 *
 * Es el mismo patrón que `src/app/(app)/tiradores/consultas.ts`: un módulo de
 * lecturas propio de la pantalla, sin `'use server'`, para lo que la consulta
 * compartida no devuelve.
 *
 * Aquí es **una sola columna**: `fie_fencer.country_code`. La ficha de tirador
 * de la referencia lleva la nacionalidad en una pastilla junto al nombre, el
 * dato está en la base desde que se ingirieron las fichas de la FIE, y
 * `getFichasFie` no lo selecciona. Como ese fichero es de otro agente, se lee
 * desde aquí en vez de tocarlo; si algún día lo añade allí, esta función
 * sobra y se borra.
 *
 * Y se lee en lugar de deducirse. La tentación era poner «España» a todo el
 * mundo, total es la selección española: eso es exactamente la clase de dato
 * inventado que el proyecto no admite, y además sería falso para un tirador
 * con doble nacionalidad federativa.
 */

/**
 * El país de cada tirador según la FIE, por `athleteId`.
 *
 * Viene en **ISO-3166 alfa-3** («ESP»), que es como lo publica la FIE y como
 * lo guarda el esquema. `BanderaPais` lo acepta tal cual y lo pinta en la
 * pastilla; lo que no hace con un alfa-3 es sacar el nombre largo, así que la
 * pastilla va sin nombre al lado.
 *
 * Solo enlaces `CONFIRMADO`, igual que `getFichasFie`: una propuesta sin
 * revisar no pinta nada en pantalla.
 */
export async function paisesFie(
  athleteIds: string[],
): Promise<Map<string, string>> {
  if (athleteIds.length === 0) return new Map();

  const filas = await db
    .select({
      athleteId: fieFencer.athleteId,
      countryCode: fieFencer.countryCode,
    })
    .from(fieFencer)
    .where(
      and(
        inArray(fieFencer.athleteId, athleteIds),
        eq(fieFencer.linkStatus, 'CONFIRMADO'),
      ),
    );

  const out = new Map<string, string>();
  for (const f of filas) {
    if (!f.athleteId || !f.countryCode?.trim()) continue;
    out.set(f.athleteId, f.countryCode.trim().toUpperCase());
  }
  return out;
}

/**
 * La clasificación mundial de UN grupo, pedida desde el navegador.
 *
 * Es una acción de servidor y no una ruta de API: la comprueba la sesión con
 * `requireProfile`, devuelve el objeto ya tipado y no añade una URL pública
 * más. La pantalla pide un grupo cuando se toca el selector, y así el
 * navegador no se traga las 11.561 filas de la clasificación completa para
 * enseñar cincuenta.
 *
 * Los tiradores propios se resuelven AQUÍ, en el servidor, con la sesión: si
 * llegaran por parámetro, cualquiera podría pedir que le marcasen los de otra
 * cuenta.
 */
export async function cargarClasificacionFie(params: {
  format: FormatoClasificacion;
  weapon: Weapon;
  gender: Gender;
  category: RankingCategory;
}): Promise<TablaClasificacionFie | null> {
  'use server';

  const perfil = await requireProfile();
  const mios = await getManagedAthletes(perfil.profileId);

  return getClasificacionFie({
    ...params,
    athleteIdsPropios: mios.map((a) => a.id),
  });
}
