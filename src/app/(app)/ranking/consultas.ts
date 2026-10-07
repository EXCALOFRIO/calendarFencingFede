import { and, eq } from 'drizzle-orm';
import { enLista as inArray } from '@/lib/sqlite';
import { db } from '@/db';
import { fieFencer } from '@/db/schema';
import { getManagedAthletes, requireProfile } from '@/lib/auth/session';
import { grupoMasParecido } from '@/components/ranking/formato';
import type { DatosTablaOficial } from '@/components/ranking/tabla-oficial';
import type { TablaEuropea } from '@/components/ranking/tipos-europeo';
import {
  type FormatoClasificacion,
  type RankingGroupKey,
  type RankingRowView,
  type TablaClasificacionFie,
  getRankingScreenData,
  groupKey,
} from '@/lib/queries/ranking';
import { personasDeAtletas, type GruposOficialesVigentes, type TablaOficialVigente } from '@/lib/queries/ranking-temporadas';
import { armasInternas } from '@/lib/ranking/acceso-interno';
import type { Gender, RankingCategory, Weapon } from '@/lib/ranking/compute';
import { getAnotacionesOlimpicas } from '@/lib/queries/olimpica';
import { personasPorFieId } from '@/lib/queries/personas-ranking';
import type { TablaFieCompleta } from '@/lib/ranking/tabla-fie-completa';
import {
  conMios,
  gruposEuropeosCompartidos,
  gruposNacionalesVigentes,
  hoyRanking,
  tablaEuropeaDe,
  tablaFieCompartida,
  tablaNacionalVigente,
} from './compartido';

/**
 * Lo que le falta a `src/lib/queries/ranking.ts` para esta pantalla, y las
 * acciones de servidor con las que el navegador pide la tabla de otro grupo o
 * de otro ámbito.
 *
 * Es el mismo patrón que `src/app/(app)/tiradores/consultas.ts`: un módulo de
 * lecturas propio de la pantalla, sin `'use server'` de fichero; cada acción
 * lo lleva dentro. Las acciones comprueban la sesión con `requireProfile` y
 * resuelven AQUÍ los tiradores de la cuenta: si llegaran por parámetro,
 * cualquiera podría pedir que le marcasen los de otra cuenta.
 */

/**
 * El país de cada tirador según la FIE, por `athleteId`, en ISO-3166 alfa-3
 * («ESP»), como lo publica la FIE. Solo enlaces `CONFIRMADO`, igual que
 * `getFichasFie`: una propuesta sin revisar no pinta nada en pantalla.
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

/** La tabla FIE de un grupo, de la caché compartida y con lo de la cuenta encima. */
export async function tablaFieParaCuenta(
  g: { format: FormatoClasificacion; weapon: Weapon; gender: Gender; category: RankingCategory },
  mios: readonly string[],
): Promise<TablaFieCompleta | null> {
  return conMios(await tablaFieCompartida(g.format, g.weapon, g.gender, g.category, hoyRanking()), mios);
}

/**
 * La clasificación internacional de UN grupo, pedida desde el navegador al
 * tocar el selector: así no se trae las 11.561 filas de la clasificación
 * completa para enseñar cincuenta.
 */
export async function cargarClasificacionFie(params: {
  format: FormatoClasificacion;
  weapon: Weapon;
  gender: Gender;
  category: RankingCategory;
}): Promise<TablaFieCompleta | null> {
  'use server';

  const perfil = await requireProfile();
  const [mios, tabla] = await Promise.all([
    getManagedAthletes(perfil.profileId),
    tablaFieCompartida(params.format, params.weapon, params.gender, params.category, hoyRanking()),
  ]);
  return conMios(tabla, mios.map((a) => a.id));
}

/** El grupo que se manda: el pedido si tiene clasificación, o el más parecido. */
export function grupoNacionalAEnviar(
  grupos: GruposOficialesVigentes['groups'],
  pedido: Partial<RankingGroupKey> | null | undefined,
): RankingGroupKey | null {
  const valido = pedido && typeof pedido.weapon === 'string' && typeof pedido.gender === 'string' && typeof pedido.category === 'string';
  const g = (valido ? grupoMasParecido(grupos, pedido as RankingGroupKey) : null) ?? grupos[0] ?? null;
  return g ? { weapon: g.weapon, gender: g.gender, category: g.category } : null;
}

/**
 * La tabla nacional de UN grupo con lo que le añade la pantalla. Lo usan la
 * primera carga (`cargarPantallaRanking`) y la acción que trae otro grupo,
 * para que las dos devuelvan exactamente lo mismo. Del cálculo interno sólo
 * va lo del grupo, y sólo si la cuenta puede verlo (`armas`).
 */
export function armarDatosNacional({
  grupos,
  grupo,
  tabla,
  interno,
  mios,
  armas,
}: {
  grupos: GruposOficialesVigentes['groups'];
  grupo: RankingGroupKey | null;
  tabla: TablaOficialVigente | null;
  interno: Awaited<ReturnType<typeof getRankingScreenData>>;
  mios: string[];
  armas: ReturnType<typeof armasInternas>;
}): DatosTablaOficial {
  const k = grupo ? groupKey(grupo) : null;
  const internos: Record<string, RankingRowView> = {};
  const desgloses: DatosTablaOficial['desgloses'] = {};
  if (k) {
    for (const fila of interno.tables[k]?.rows ?? []) internos[`${k}|${fila.athleteId}`] = fila;
    for (const [clave, d] of Object.entries(interno.breakdowns)) if (clave.startsWith(`${k}|`)) desgloses[clave] = d;
  }
  return {
    grupos,
    grupoCargado: tabla ? k : null,
    tablas: k && tabla ? { [k]: tabla.tabla } : {},
    cortes: k && tabla ? { [k]: tabla.cortes } : {},
    desgloses,
    internos,
    mios,
    armasAutorizadas: armas,
    personas: tabla?.personas ?? {},
  };
}

/** La lista de grupos y la tabla de UN grupo, de la caché compartida. */
export async function leerNacionalDeGrupo(pedido: Partial<RankingGroupKey> | null | undefined) {
  const vigentes = await gruposNacionalesVigentes();
  const grupo = grupoNacionalAEnviar(vigentes.groups, pedido);
  const tabla = grupo && vigentes.seasonLabel
    ? await tablaNacionalVigente(vigentes.seasonLabel, grupo.weapon, grupo.gender, grupo.category, hoyRanking())
    : null;
  return { vigentes, grupo, tabla };
}

/**
 * La clasificación nacional de UN grupo, pedida al pasar a Nacional cuando la
 * pantalla abrió en otro ámbito, o al elegir otro grupo. La sesión se
 * comprueba aquí y el cálculo interno se autoriza con ella, igual que en la
 * primera carga: nada llega por parámetro salvo el grupo.
 */
export async function cargarRankingNacional(grupo?: RankingGroupKey | null): Promise<DatosTablaOficial> {
  'use server';

  const perfil = await requireProfile();
  const armas = armasInternas(perfil);
  const [{ vigentes, grupo: elegido, tabla }, atletas, interno] = await Promise.all([
    leerNacionalDeGrupo(grupo),
    getManagedAthletes(perfil.profileId),
    getRankingScreenData(armas),
  ]);
  return armarDatosNacional({ grupos: vigentes.groups, grupo: elegido, tabla, interno, mios: atletas.map((a) => a.id), armas });
}

/** La tabla europea de UN grupo, pedida desde el navegador. */
export async function cargarRankingEuropeo(grupo: RankingGroupKey): Promise<TablaEuropea | null> {
  'use server';

  await requireProfile();
  const grupos = await gruposEuropeosCompartidos();
  const valido = grupo && typeof grupo.weapon === 'string' && typeof grupo.gender === 'string' && typeof grupo.category === 'string';
  return tablaEuropeaDe(grupos, (valido ? grupoMasParecido(grupos, grupo) : null) ?? undefined);
}

/** Personas de Explorar de los tiradores de la cuenta, para marcar «Tú» en la europea. */
export const personasDeCuenta = (athleteIds: string[]) => personasDeAtletas(db, athleteIds).catch(() => [] as string[]);

/**
 * La tabla FIE con lo que le añade esta pantalla: la persona de cada fila
 * (retrato y enlace a su ficha) y, sólo en las seis pruebas olímpicas
 * (absoluto, masculino o femenino), las marcas de la clasificación de LA 2028.
 * Cualquier fallo deja la parte vacía: la tabla se pinta igual. La pantalla
 * usa la versión de la caché (`tablaFieCompartida`); esta queda para las
 * medidas y las capturas.
 */
export async function completarTablaFie(
  tabla: TablaClasificacionFie | null,
): Promise<TablaFieCompleta | null> {
  if (!tabla) return null;
  const { weapon, gender, category } = tabla.group;
  const olimpica =
    category === 'ABS' && (gender === 'M' || gender === 'F')
      ? getAnotacionesOlimpicas(weapon, gender).catch(() => null)
      : Promise.resolve(null);
  const personas =
    tabla.format === 'INDIVIDUAL'
      ? personasPorFieId(db, tabla.rows.map((r) => r.fieId))
      : Promise.resolve({});
  return { ...tabla, olimpica: await olimpica, personas: await personas };
}
