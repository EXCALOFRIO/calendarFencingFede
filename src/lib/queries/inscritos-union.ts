import { and, asc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { enLista as inArray } from '@/lib/sqlite';
import { db } from '@/db';
import {
  athlete,
  club,
  competitionRegistration,
  event,
  eventCompetition,
  sportExternalId,
  sportPerson,
  sportRegistrationRef,
} from '@/db/schema';
import { requireProfile } from '@/lib/auth/session';
import { depsEvidenciaDb } from '@/lib/entries/evidencia-db';
import { normalizarLicencia, type RefPublicada } from '@/lib/entries/identidad';
import { sinDuplicadosEnPantalla } from '@/lib/entries/duplicados-pantalla';
import { aListaVisible, contarPorPrueba, type InscritoPublicado } from '@/lib/entries/union';
import { esquemaDeportivo } from '@/lib/sport/esquema-db';
import {
  descubrirTarjetas,
  leerListaUnida,
  type DepsDescubrimiento,
  type DepsLector,
  type ListaUnida,
} from './inscritos-lector';
import { clavePrueba } from './clave-prueba';

export type { InscritoPublicado } from '@/lib/entries/union';
export type { ListaUnida } from './inscritos-lector';

/** Tarjeta a la que pertenece una prueba: el torneo canónico o él mismo. */
const tarjetaSql = sql<string>`coalesce(${event.canonicalEventId}, ${event.id})`;

const LOTE = 300;

function lotes<T>(items: readonly T[]): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < items.length; i += LOTE) salida.push(items.slice(i, i + LOTE));
  return salida;
}

const depsDb: DepsLector = {
  async observaciones(eventIds) {
    const delTorneoYSuPar = or(
      inArray(event.id, eventIds),
      inArray(event.canonicalEventId, eventIds),
    );

    const [crudas, pruebas] = await Promise.all([
      db
        .select({
          registrationId: competitionRegistration.id,
          competitionId: competitionRegistration.eventCompetitionId,
          prueba: clavePrueba(eventCompetition),
          tarjeta: tarjetaSql,
          arma: eventCompetition.weapon,
          dia: sql<string | null>`coalesce(${eventCompetition.competitionDate}, ${event.startDate})`,
          nombre: competitionRegistration.sourceAthleteName,
          equipo: competitionRegistration.sourceTeam,
          clubPublicado: competitionRegistration.sourceClub,
          licencia: competitionRegistration.sourceLicense,
          athleteIdGuardado: competitionRegistration.athleteId,
          retiradoEn: competitionRegistration.withdrawnAt,
          fuente: competitionRegistration.source,
          sourceUrl: competitionRegistration.sourceUrl,
          leidoEl: competitionRegistration.lastSeenAt,
        })
        .from(competitionRegistration)
        .innerJoin(
          eventCompetition,
          eq(competitionRegistration.eventCompetitionId, eventCompetition.id),
        )
        .innerJoin(event, eq(event.id, eventCompetition.eventId))
        .where(delTorneoYSuPar)
        .orderBy(asc(competitionRegistration.sourceAthleteName)),
      db
        .select({
          id: eventCompetition.id,
          prueba: clavePrueba(eventCompetition),
          tarjeta: tarjetaSql,
          propia: sql<boolean>`${event.canonicalEventId} is null`.mapWith(Boolean),
          consultada: sql<boolean>`(${eventCompetition.registrationsCheckedAt} is not null or ${eventCompetition.registrationCount} is not null)`.mapWith(Boolean),
        })
        .from(eventCompetition)
        .innerJoin(event, eq(event.id, eventCompetition.eventId))
        .where(delTorneoYSuPar),
    ]);

    return { crudas, pruebas };
  },

  async referencias(registrationIds) {
    const salida = new Map<string, RefPublicada[]>();
    for (const lote of lotes(registrationIds)) {
      const filas = await db
        .select()
        .from(sportRegistrationRef)
        .where(inArray(sportRegistrationRef.registrationId, lote));
      for (const f of filas) {
        const lista = salida.get(f.registrationId) ?? [];
        lista.push({
          scheme: f.scheme,
          value: f.value,
          scopeSource: f.scopeSource,
          scopeFederation: f.scopeFederation,
          scopeSeason: f.scopeSeason,
          scopeWeapon: f.scopeWeapon,
          observadoEl: f.observedOn,
        });
        salida.set(f.registrationId, lista);
      }
    }
    return salida;
  },

  async clubesDe(athleteIds) {
    const salida = new Map<string, string | null>();
    for (const lote of lotes(athleteIds)) {
      const filas = await db
        .select({ id: athlete.id, club: club.name })
        .from(athlete)
        .leftJoin(club, eq(athlete.clubId, club.id))
        .where(inArray(athlete.id, lote));
      for (const f of filas) salida.set(f.id, f.club);
    }
    return salida;
  },

  evidencia: depsEvidenciaDb,
};

const depsDescubrimientoDb: DepsDescubrimiento = {
  esquema: esquemaDeportivo,

  async pistas(athleteIds) {
    const licencias = new Set<string>();
    const fieIds = new Set<number>();
    const valores = new Set<string>();

    const [atletas, fichas] = await Promise.all([
      db
        .select({ rfee: athlete.rfeeLicense, fie: athlete.fieLicense })
        .from(athlete)
        .where(inArray(athlete.id, athleteIds)),
      depsEvidenciaDb.fichasFiePorAtleta(athleteIds),
    ]);
    for (const a of atletas) {
      if (a.rfee) licencias.add(normalizarLicencia(a.rfee));
      if (a.fie) licencias.add(normalizarLicencia(a.fie));
    }
    for (const f of fichas) {
      fieIds.add(f.fieId);
      if (f.fieLicense) licencias.add(normalizarLicencia(f.fieLicense));
    }

    if ((await esquemaDeportivo()).identidad) {
      const personas = await db
        .select({ id: sportPerson.id })
        .from(sportPerson)
        .where(and(inArray(sportPerson.athleteId, athleteIds), isNull(sportPerson.mergedIntoPersonId)));
      const ids = personas.map((p) => p.id);
      for (const lote of lotes(ids)) {
        const externos = await db
          .select({ value: sportExternalId.value })
          .from(sportExternalId)
          .where(
            and(
              inArray(sportExternalId.personId, lote),
              eq(sportExternalId.linkStatus, 'CONFIRMADO'),
            ),
          );
        for (const e of externos) valores.add(e.value);
      }
    }

    for (const id of fieIds) valores.add(String(id));
    for (const l of licencias) valores.add(l);
    return { licencias: [...licencias], fieIds: [...fieIds], valores: [...valores] };
  },

  async tarjetas({ athleteIds, pistas, conReferencias, hoy }) {
    const licenciaNormalizada = sql`upper(replace(replace(${competitionRegistration.sourceLicense}, ' ', ''), '-', ''))`;
    const condiciones = [inArray(competitionRegistration.athleteId, athleteIds)];
    if (pistas.licencias.length > 0) {
      condiciones.push(inArray(licenciaNormalizada, pistas.licencias));
    }
    if (conReferencias && pistas.valores.length > 0) {
      condiciones.push(
        inArray(
          competitionRegistration.id,
          db
            .select({ id: sportRegistrationRef.registrationId })
            .from(sportRegistrationRef)
            .where(inArray(sportRegistrationRef.value, pistas.valores)),
        ),
      );
    }

    const filas = await db
      .selectDistinct({ tarjeta: tarjetaSql })
      .from(competitionRegistration)
      .innerJoin(
        eventCompetition,
        eq(competitionRegistration.eventCompetitionId, eventCompetition.id),
      )
      .innerJoin(event, eq(eventCompetition.eventId, event.id))
      .where(
        and(
          or(...condiciones),
          isNull(competitionRegistration.withdrawnAt),
          gte(event.endDate, hoy),
        ),
      );
    return filas.map((f) => f.tarjeta);
  },
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
 * **Límite privado de lectura:** exige sesión antes de consultar nada, porque
 * este lector devuelve procedencia, URL y fichas internas y no debe quedar al
 * alcance de ninguna entrada que olvide autenticar.
 */
export async function inscritosUnidosDeTorneos(
  eventIds: string[],
  opciones: { incluirRetirados?: boolean } = {},
): Promise<ListaUnida> {
  await requireProfile();
  return leerListaUnidaTrasGuarda(eventIds, opciones);
}

/**
 * La misma lectura sin pedir la sesión, para la caché compartida de la ficha
 * del calendario (`calendario-cache.ts`), que comprueba la sesión ANTES de
 * llegar aquí y no puede leerla dentro (el recálculo en segundo plano corre
 * fuera de la petición). Quien la llame responde de esa guarda.
 */
export function leerListaUnidaTrasGuarda(
  eventIds: string[],
  opciones: { incluirRetirados?: boolean } = {},
): Promise<ListaUnida> {
  return leerListaUnida(depsDb, eventIds, opciones);
}

/** Torneos con una inscripción vigente de alguno de estos tiradores (filtro previo). */
export async function tarjetasConAtletas(athleteIds: string[], hoy: string): Promise<string[]> {
  await requireProfile();
  return descubrirTarjetas(depsDescubrimientoDb, athleteIds, hoy);
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

/**
 * Filas visibles por prueba: lo que enseña la ficha, sin la copia de Skermo
 * de quien ya está enlazado por la FIE (`sinDuplicadosEnPantalla`).
 */
export async function contarInscritosPublicados(
  eventId: string,
): Promise<Record<string, number>> {
  return contarPorPrueba(sinDuplicadosEnPantalla(await inscritosPublicados(eventId)));
}
