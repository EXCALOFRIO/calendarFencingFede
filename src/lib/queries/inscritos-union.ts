import { asc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  athlete,
  club,
  competitionRegistration,
  event,
  eventCompetition,
} from '@/db/schema';
import {
  aListaVisible,
  contarPorPrueba,
  reencajar,
  unirObservaciones,
  type FilaUnida,
  type InscritoPublicado,
  type ObservacionCruda,
} from '@/lib/entries/union';
import { estadoDeLista, type EstadoLista } from '@/lib/entries/lectura';

export type { InscritoPublicado } from '@/lib/entries/union';

/**
 * Qué prueba es, sin depender de su id: arma + género + categoría + formato.
 *
 * Es la clave con la que se reconoce «el mismo florete femenino individual»
 * en la fila de Skermo y en la de la FIE, que son dos filas de
 * `event_competition`. Se calcula en Postgres para no traer cuatro columnas
 * más por cada inscrito.
 */
export function clavePrueba(t: typeof eventCompetition) {
  return sql<string>`concat_ws('|', ${t.weapon}::text, ${t.gender}::text, ${t.category}::text, ${t.format}::text)`;
}

/** Tarjeta a la que pertenece una prueba: el torneo canónico o él mismo. */
const tarjetaSql = sql<string>`coalesce(${event.canonicalEventId}, ${event.id})`;

export type ListaUnida = {
  filas: FilaUnida[];
  /** Por prueba de la tarjeta: sin consultar, vacía o con datos. */
  estados: Record<string, EstadoLista>;
};

/**
 * Observaciones de inscritos de varios torneos, unidas por identidad.
 *
 * Un torneo internacional está dos veces en la base: la fila de Skermo, que es
 * la que se enseña, y la de la FIE, absorbida (`canonical_event_id`). Se leen
 * los dos registros y cada observación se cuelga de la prueba de la tarjeta que
 * tenga su misma arma/género/categoría/formato. Si sólo la publica la FIE (las
 * pruebas por equipos de las Copas del Mundo), se queda en su propia fila.
 *
 * Una sola consulta para todos los torneos: el driver de Neon habla por HTTP y
 * cada viaje cuenta.
 */
export async function inscritosUnidosDeTorneos(
  eventIds: string[],
  opciones: { incluirRetirados?: boolean } = {},
): Promise<ListaUnida> {
  if (eventIds.length === 0) return { filas: [], estados: {} };

  const delTorneoYSuPar = or(
    inArray(event.id, eventIds),
    inArray(event.canonicalEventId, eventIds),
  );

  const [crudas, pruebas] = await Promise.all([
    db
      .select({
        competitionId: competitionRegistration.eventCompetitionId,
        prueba: clavePrueba(eventCompetition),
        tarjeta: tarjetaSql,
        nombre: competitionRegistration.sourceAthleteName,
        equipo: competitionRegistration.sourceTeam,
        clubPublicado: competitionRegistration.sourceClub,
        athleteId: competitionRegistration.athleteId,
        retiradoEn: competitionRegistration.withdrawnAt,
        fuente: competitionRegistration.source,
        sourceUrl: competitionRegistration.sourceUrl,
        leidoEl: competitionRegistration.lastSeenAt,
        clubNombre: club.name,
      })
      .from(competitionRegistration)
      .innerJoin(
        eventCompetition,
        eq(competitionRegistration.eventCompetitionId, eventCompetition.id),
      )
      .innerJoin(event, eq(event.id, eventCompetition.eventId))
      .leftJoin(athlete, eq(competitionRegistration.athleteId, athlete.id))
      .leftJoin(club, eq(athlete.clubId, club.id))
      .where(delTorneoYSuPar)
      .orderBy(asc(competitionRegistration.sourceAthleteName)),
    db
      .select({
        id: eventCompetition.id,
        prueba: clavePrueba(eventCompetition),
        tarjeta: tarjetaSql,
        propia: sql<boolean>`${event.canonicalEventId} is null`,
        consultada: sql<boolean>`(${eventCompetition.registrationsCheckedAt} is not null or ${eventCompetition.registrationCount} is not null)`,
      })
      .from(eventCompetition)
      .innerJoin(event, eq(event.id, eventCompetition.eventId))
      .where(delTorneoYSuPar),
  ]);

  /** La prueba española es el destino cuando existe; si no, la de la FIE. */
  const destinoPorPrueba = new Map<string, string>();
  for (const p of [...pruebas].sort((a, b) => Number(b.propia) - Number(a.propia))) {
    const clave = `${p.tarjeta}|${p.prueba}`;
    if (!destinoPorPrueba.has(clave)) destinoPorPrueba.set(clave, p.id);
  }

  const observaciones = reencajar(
    crudas.map<ObservacionCruda>((f) => ({
      competitionId: f.competitionId,
      prueba: f.prueba,
      tarjeta: f.tarjeta,
      nombre: f.nombre,
      equipo: f.equipo,
      club: f.clubPublicado ?? f.clubNombre ?? null,
      athleteId: f.athleteId,
      retiradoEn: f.retiradoEn,
      fuente: f.fuente,
      sourceUrl: f.sourceUrl,
      leidoEl: f.leidoEl,
    })),
    destinoPorPrueba,
  );

  const filas = unirObservaciones(observaciones, opciones);
  const visibles = contarPorPrueba(filas);

  const estados: Record<string, EstadoLista> = {};
  for (const [clave, destino] of destinoPorPrueba) {
    const consultada = pruebas.some(
      (p) => `${p.tarjeta}|${p.prueba}` === clave && p.consultada,
    );
    estados[destino] = estadoDeLista({ consultada, filas: visibles[destino] ?? 0 });
  }

  return { filas, estados };
}

/**
 * Lista visible de un torneo: una fila por identidad, sin fuente ni URL ni
 * ficha ajena. `athleteIdsPropios` sólo sirve para marcar las tuyas.
 */
export async function inscritosPublicados(
  eventId: string,
  opciones: { athleteIdsPropios?: string[]; incluirRetirados?: boolean } = {},
): Promise<InscritoPublicado[]> {
  const { filas } = await inscritosUnidosDeTorneos([eventId], opciones);
  return aListaVisible(filas, new Set(opciones.athleteIdsPropios ?? []));
}

/** Filas visibles por prueba; es exactamente lo que enseña `inscritosPublicados`. */
export async function contarInscritosPublicados(
  eventId: string,
): Promise<Record<string, number>> {
  return contarPorPrueba(await inscritosPublicados(eventId));
}
