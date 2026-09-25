import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db';
import {
  athlete,
  club,
  competitionRegistration,
  deadlineRule,
  event,
  eventCompetition,
  eventDeadline,
  eventDocument,
  liveSource,
  season,
  seasonCategory,
} from '@/db/schema';
import type { CategoryCode, SeasonCategoryRow } from '../categories';
import {
  type ComputedDeadline,
  type DeadlineRuleRow,
  computeDeadlines,
  deadlineStatus,
  mergeDeadlines,
} from '../deadlines';

export type Weapon = 'FLORETE' | 'ESPADA' | 'SABLE';
export type Gender = 'M' | 'F' | 'MIXTO';
export type Scope = 'NACIONAL' | 'INTERNACIONAL' | 'AUTONOMICO';

export type CompetitionView = {
  id: string;
  weapon: Weapon;
  gender: Gender;
  category: CategoryCode;
  categoryRaw: string | null;
  format: 'INDIVIDUAL' | 'EQUIPOS';
  competitionDate: string | null;
  installationOpen: string | null;
  callTime: string | null;
  scratchTime: string | null;
  startTime: string | null;
  registrationCount: number | null;
  feeEur: string | null;
  sourceUrl: string | null;
  deadlines: ComputedDeadline[];
  status: ReturnType<typeof deadlineStatus>;
};

/**
 * El otro registro del MISMO torneo, el que viene de la FIE.
 *
 * Se devuelve entero, no fundido a la fuerza, para que la ficha pueda enseñar
 * de dónde sale cada dato y enlazar a las DOS fuentes. Un dato prestado con su
 * procedencia es honesto; el mismo dato sin decir de dónde viene, no.
 */
export type LinkedEventView = {
  id: string;
  source: string;
  sourceId: string;
  sourceUrl: string | null;
  name: string;
  startDate: string;
  endDate: string;
  city: string | null;
  venue: string | null;
  timezone: string | null;
  imageUrl: string | null;
  circuit: string;
};

export type EventView = {
  id: string;
  source: string;
  sourceUrl: string | null;
  name: string;
  startDate: string;
  endDate: string;
  venue: string | null;
  venueAddress: string | null;
  city: string | null;
  country: string | null;
  geoLat: string | null;
  geoLon: string | null;
  timezone: string | null;
  officialSite: string | null;
  imageUrl: string | null;
  circuit: string;
  scope: Scope;
  regionalFederation: string | null;
  notes: string | null;
  lastSeenAt: Date;
  disappearedAt: Date | null;
  competitions: CompetitionView[];
  documents: { id: string; title: string; url: string; kind: string | null }[];
  liveLinks: { id: string; platform: string; kind: string; url: string; label: string | null }[];
  /**
   * Los registros de la FIE que son ESTE MISMO torneo y se han colapsado en
   * esta tarjeta. Vacío en la inmensa mayoría de eventos.
   */
  linkedEvents: LinkedEventView[];
  /**
   * Las fuentes que hablan de este torneo, con su enlace. Siempre al menos
   * una. Cuando hay dos, la ficha puede ofrecer las dos, que es lo que pide
   * cualquiera que quiera comprobar un dato en el original.
   */
  sources: { source: string; name: string; url: string | null }[];
  /**
   * De dónde sale el cartel que se está enseñando, cuando no es de este mismo
   * registro. La imagen SIEMPRE se enlaza a `static.fie.org`; no se copia ni
   * se rehospeda, que es justo lo que exigen sus términos.
   */
  imageSource: { source: string; sourceUrl: string | null } | null;
  /**
   * `circuit` se conserva tal cual lo publica la fuente principal para no
   * cambiarle el color ni el filtro a nadie. Cuando la FIE da un tipo más
   * preciso (satélite, Copa del Mundo, Gran Premio), viene aquí.
   */
  circuitFie: string | null;
};

export type CalendarFilters = {
  /** Eventos concretos por id. Lo usa `getEvent`, que necesita solo uno. */
  ids?: string[];
  scope?: Scope[];
  weapons?: Weapon[];
  genders?: Gender[];
  categories?: CategoryCode[];
  formats?: ('INDIVIDUAL' | 'EQUIPOS')[];
  from?: string;
  to?: string;
  search?: string;
  /** Incluir lo ya celebrado. Por defecto no: a nadie le interesa el pasado. */
  includePast?: boolean;
  limit?: number;
  /**
   * Enseñar también las filas de la FIE que ya están colapsadas dentro de su
   * pareja de Skermo. Por defecto NO: ese colapso es justo lo que quita los
   * torneos duplicados del calendario. Se activa solo para auditar.
   */
  includeLinked?: boolean;
};

/** Temporada marcada como actual, con sus categorías. */
export const getCurrentSeason = cache(async () => {
  const [row] = await db
    .select()
    .from(season)
    .where(eq(season.current, true))
    .limit(1);

  if (!row) return null;

  const categories = await db
    .select()
    .from(seasonCategory)
    .where(eq(seasonCategory.seasonId, row.id))
    .orderBy(asc(seasonCategory.rank));

  return {
    ...row,
    categories: categories.map<SeasonCategoryRow>((c) => ({
      code: c.code as CategoryCode,
      birthYearMin: c.birthYearMin,
      birthYearMax: c.birthYearMax,
      rank: c.rank,
      laddered: c.laddered,
    })),
    categoryRows: categories,
  };
});

/** Reglas de plazos vigentes de la temporada actual. */
export const getDeadlineRules = cache(async (): Promise<DeadlineRuleRow[]> => {
  const current = await getCurrentSeason();
  if (!current) return [];

  const rows = await db
    .select()
    .from(deadlineRule)
    .where(
      and(eq(deadlineRule.seasonId, current.id), eq(deadlineRule.active, true)),
    );

  return rows.map((r) => ({
    id: r.id,
    scope: r.scope as Scope,
    circuit: r.circuit,
    category: r.category as CategoryCode | null,
    type: r.type,
    label: r.label,
    daysBefore: r.daysBefore,
    surchargeEur: r.surchargeEur,
    blocking: r.blocking,
    sourceDocument: r.sourceDocument,
    sourceUrl: r.sourceUrl,
  }));
});

/**
 * Lista de eventos con todo lo que la ficha necesita.
 *
 * Se hacen cinco consultas y se cose en memoria, en lugar de un JOIN gigante:
 * con un JOIN, un evento con 8 pruebas y 3 documentos devuelve 24 filas
 * duplicadas por la red, y aquí la red es lo caro (Neon por HTTP).
 */
export async function listEvents(filters: CalendarFilters = {}): Promise<EventView[]> {
  const today = new Date().toISOString().slice(0, 10);
  const conditions = [isNull(event.disappearedAt)];

  if (filters.ids) {
    if (filters.ids.length === 0) return [];
    conditions.push(inArray(event.id, filters.ids));
  } else if (!filters.includeLinked) {
    /**
     * DUPLICADOS: el mismo torneo internacional entra dos veces, una por
     * Skermo y otra por la FIE («TORNEO SATÉLITE · DUBLÍN» y «Dublin
     * Satellite Tournament 2026 · Dublin» son el mismo fin de semana en el
     * mismo pabellón). Cuando el emparejador los ha reconocido, la fila de la
     * FIE apunta a la de Skermo y aquí desaparece: se pinta UNA tarjeta.
     *
     * Solo se aplica al listado. Si alguien pide un evento por id —una ficha,
     * un enlace guardado, el correo de un aviso—, se le devuelve, esté
     * colapsado o no: un enlace que un día funcionó no puede dar 404.
     */
    conditions.push(isNull(event.canonicalEventId));
  }

  if (!filters.includePast) {
    conditions.push(gte(event.endDate, filters.from ?? today));
  } else if (filters.from) {
    conditions.push(gte(event.endDate, filters.from));
  }
  if (filters.to) conditions.push(lte(event.startDate, filters.to));
  if (filters.scope?.length) conditions.push(inArray(event.scope, filters.scope));
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(ilike(event.name, term), ilike(event.city, term)) ?? sql`true`,
    );
  }

  const eventRows = await db
    .select()
    .from(event)
    .where(and(...conditions))
    .orderBy(asc(event.startDate), asc(event.name))
    .limit(filters.limit ?? 400);

  if (eventRows.length === 0) return [];

  const eventIds = eventRows.map((e) => e.id);

  const competitionConditions = [inArray(eventCompetition.eventId, eventIds)];
  if (filters.weapons?.length) {
    competitionConditions.push(inArray(eventCompetition.weapon, filters.weapons));
  }
  if (filters.genders?.length) {
    competitionConditions.push(inArray(eventCompetition.gender, filters.genders));
  }
  if (filters.categories?.length) {
    competitionConditions.push(inArray(eventCompetition.category, filters.categories));
  }
  if (filters.formats?.length) {
    competitionConditions.push(inArray(eventCompetition.format, filters.formats));
  }

  /**
   * La sexta consulta trae de golpe los registros de la FIE emparejados con
   * estos eventos. Va dentro del mismo `Promise.all` a propósito: con el
   * driver HTTP de Neon lo caro es el viaje de ida y vuelta, y así son seis
   * en paralelo en lugar de uno por evento. Sin esto, la ficha de cada
   * torneo tendría que ir a buscar su cartel por separado.
   */
  const [competitionRows, deadlineRows, documentRows, liveRows, linkedRows, rules] =
    await Promise.all([
      db
        .select()
        .from(eventCompetition)
        .where(and(...competitionConditions))
        .orderBy(asc(eventCompetition.competitionDate)),
      db.select().from(eventDeadline).where(inArray(eventDeadline.eventId, eventIds)),
      db.select().from(eventDocument).where(inArray(eventDocument.eventId, eventIds)),
      db.select().from(liveSource).where(inArray(liveSource.eventId, eventIds)),
      db
        .select({
          id: event.id,
          canonicalEventId: event.canonicalEventId,
          source: event.source,
          sourceId: event.sourceId,
          sourceUrl: event.sourceUrl,
          name: event.name,
          startDate: event.startDate,
          endDate: event.endDate,
          city: event.city,
          country: event.country,
          venue: event.venue,
          venueAddress: event.venueAddress,
          geoLat: event.geoLat,
          geoLon: event.geoLon,
          timezone: event.timezone,
          officialSite: event.officialSite,
          imageUrl: event.imageUrl,
          circuit: event.circuit,
        })
        .from(event)
        .where(inArray(event.canonicalEventId, eventIds)),
      getDeadlineRules(),
    ]);

  const competitionsByEvent = new Map<string, typeof competitionRows>();
  for (const c of competitionRows) {
    const list = competitionsByEvent.get(c.eventId) ?? [];
    list.push(c);
    competitionsByEvent.set(c.eventId, list);
  }

  const deadlinesByCompetition = new Map<string, typeof deadlineRows>();
  const deadlinesByEvent = new Map<string, typeof deadlineRows>();
  for (const d of deadlineRows) {
    if (d.eventCompetitionId) {
      const list = deadlinesByCompetition.get(d.eventCompetitionId) ?? [];
      list.push(d);
      deadlinesByCompetition.set(d.eventCompetitionId, list);
    } else {
      const list = deadlinesByEvent.get(d.eventId) ?? [];
      list.push(d);
      deadlinesByEvent.set(d.eventId, list);
    }
  }

  const documentsByEvent = new Map<string, typeof documentRows>();
  for (const d of documentRows) {
    const list = documentsByEvent.get(d.eventId) ?? [];
    list.push(d);
    documentsByEvent.set(d.eventId, list);
  }

  const liveByEvent = new Map<string, typeof liveRows>();
  for (const l of liveRows) {
    const list = liveByEvent.get(l.eventId) ?? [];
    list.push(l);
    liveByEvent.set(l.eventId, list);
  }

  const linkedByEvent = new Map<string, typeof linkedRows>();
  for (const l of linkedRows) {
    if (!l.canonicalEventId) continue;
    const list = linkedByEvent.get(l.canonicalEventId) ?? [];
    list.push(l);
    linkedByEvent.set(l.canonicalEventId, list);
  }

  const now = new Date();
  const views: EventView[] = [];

  for (const e of eventRows) {
    const competitions = competitionsByEvent.get(e.id) ?? [];
    // Si había filtro de arma/género/categoría y este evento se queda sin
    // ninguna prueba que encaje, el evento entero no interesa.
    if (competitions.length === 0) continue;

    const eventLevelDeadlines = deadlinesByEvent.get(e.id) ?? [];
    const linked = linkedByEvent.get(e.id) ?? [];

    /**
     * El par de la FIE que aporta cada hueco. Se busca uno a uno porque no
     * tiene por qué ser el mismo: puede haber dos filas de la FIE (espada
     * femenina y sable masculino del mismo satélite) y solo una traer sede.
     */
    const conCartel = linked.find((l) => l.imageUrl);

    /**
     * HERENCIA DEL CARTEL. Skermo no publica imágenes (0 de sus 214 eventos
     * tienen una) y la FIE sí (26 de 60). Cuando son el mismo torneo, la
     * tarjeta enseña el cartel de la FIE.
     *
     * Se enlaza, no se copia: `imageUrl` apunta a `static.fie.org` y el
     * navegador la pide directamente a ellos. Si la FIE la retira, desaparece,
     * que es el comportamiento correcto. No se rehospeda nada.
     */
    const imageUrl = e.imageUrl ?? conCartel?.imageUrl ?? null;

    views.push({
      id: e.id,
      source: e.source,
      sourceUrl: e.sourceUrl,
      name: e.name,
      startDate: e.startDate,
      endDate: e.endDate,
      /**
       * La sede y el huso los publica la FIE con más detalle que Skermo. Se
       * heredan SOLO cuando aquí no hay nada: un hueco se rellena con un dato
       * real de la otra fuente, nunca se pisa un dato publicado.
       *
       * La ciudad y el país no se heredan a propósito: son lo que lee el
       * usuario para reconocer el torneo y los quiere en español, tal y como
       * los publica la RFEE.
       */
      venue: e.venue ?? linked.find((l) => l.venue)?.venue ?? null,
      venueAddress:
        e.venueAddress ?? linked.find((l) => l.venueAddress)?.venueAddress ?? null,
      city: e.city,
      country: e.country,
      geoLat: e.geoLat ?? linked.find((l) => l.geoLat)?.geoLat ?? null,
      geoLon: e.geoLon ?? linked.find((l) => l.geoLon)?.geoLon ?? null,
      timezone: e.timezone ?? linked.map((l) => l.timezone).find(esHusoCreible) ?? null,
      officialSite:
        e.officialSite ?? linked.find((l) => l.officialSite)?.officialSite ?? null,
      imageUrl,
      imageSource:
        !e.imageUrl && conCartel
          ? { source: conCartel.source, sourceUrl: conCartel.sourceUrl }
          : null,
      circuit: e.circuit,
      circuitFie: linked.find((l) => l.source === 'fie')?.circuit ?? null,
      linkedEvents: linked.map((l) => ({
        id: l.id,
        source: l.source,
        sourceId: l.sourceId,
        sourceUrl: l.sourceUrl,
        name: l.name,
        startDate: l.startDate,
        endDate: l.endDate,
        city: l.city,
        venue: l.venue,
        timezone: l.timezone,
        imageUrl: l.imageUrl,
        circuit: l.circuit,
      })),
      /**
       * Los enlaces a las DOS fuentes. Se deduplican por URL porque la FIE
       * publica una fila por prueba y varias comparten la misma página.
       */
      sources: dedupeSources([
        { source: e.source, name: e.name, url: e.sourceUrl },
        ...linked.map((l) => ({ source: l.source, name: l.name, url: l.sourceUrl })),
      ]),
      scope: e.scope as Scope,
      regionalFederation: e.regionalFederation,
      notes: e.notes,
      lastSeenAt: e.lastSeenAt,
      disappearedAt: e.disappearedAt,
      documents: (documentsByEvent.get(e.id) ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        url: d.url,
        kind: d.kind,
      })),
      liveLinks: (liveByEvent.get(e.id) ?? []).map((l) => ({
        id: l.id,
        platform: l.platform,
        kind: l.kind,
        url: l.url,
        label: l.label,
      })),
      competitions: competitions.map((c) => {
        const published = [
          ...(deadlinesByCompetition.get(c.id) ?? []),
          ...eventLevelDeadlines,
        ]
          .filter((d) => d.origin === 'PUBLICADO')
          .map(toComputedDeadline);

        /**
         * Los plazos calculados salen de la tabla de normativa. Siempre se
         * marcan como estimados: un plazo deducido no se presenta nunca igual
         * que uno publicado por la fuente.
         */
        const calculated = computeDeadlines(e.startDate, rules, {
          scope: e.scope as Scope,
          circuit: e.circuit,
          category: c.category as CategoryCode,
        });

        const merged = mergeDeadlines(published, calculated);

        return {
          id: c.id,
          weapon: c.weapon as Weapon,
          gender: c.gender as Gender,
          category: c.category as CategoryCode,
          categoryRaw: c.categoryRaw,
          format: c.format,
          competitionDate: c.competitionDate,
          installationOpen: c.installationOpen,
          callTime: c.callTime,
          scratchTime: c.scratchTime,
          startTime: c.startTime,
          registrationCount: c.registrationCount,
          feeEur: c.feeEur,
          sourceUrl: c.sourceUrl,
          deadlines: merged,
          status: deadlineStatus(merged, now),
        };
      }),
    });
  }

  return views;
}

/**
 * ¿Esto se parece a un huso IANA de verdad?
 *
 * Hace falta porque hay husos heredados de la FIE ya guardados en la base con
 * la barra escapada ("Asia\\/Riyadh"), que además es su valor de relleno
 * cuando no sabe dónde se tira el torneo. Heredar eso pondría un huso falso en
 * una tarjeta donde antes no había ninguno, y el aviso de diferencia horaria
 * diría una mentira. Mejor no enseñar huso que enseñar el equivocado.
 */
function esHusoCreible(valor: string | null): valor is string {
  return valor !== null && /^[A-Za-z]+\/[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)?$/.test(valor);
}

/**
 * Una entrada por fuente y URL distintas. La FIE publica una fila por prueba
 * y todas apuntan a la misma página del torneo: sin esto la ficha enseñaría
 * el mismo enlace tres veces.
 */
function dedupeSources(
  items: { source: string; name: string; url: string | null }[],
): { source: string; name: string; url: string | null }[] {
  const seen = new Set<string>();
  const out: { source: string; name: string; url: string | null }[] = [];
  for (const item of items) {
    const key = `${item.source}|${item.url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function toComputedDeadline(d: typeof eventDeadline.$inferSelect): ComputedDeadline {
  return {
    type: d.type,
    label:
      d.type === 'L1'
        ? 'Cierre de inscripción'
        : d.type === 'FIE_D7'
          ? 'Cierre FIE'
          : `Plazo ${d.type}`,
    deadlineAt: d.deadlineAt,
    surchargeEur: d.surchargeEur,
    blocking: d.blocking,
    origin: d.origin,
    sourceDocument: d.sourceDocument,
    sourceUrl: d.sourceUrl,
  };
}

/** Un evento concreto con todo el detalle, para la ficha lateral. */
export async function getEvent(eventId: string): Promise<EventView | null> {
  /**
   * RENDIMIENTO: antes se cargaba el calendario ENTERO (`limit: 1000`, con sus
   * pruebas, plazos, documentos y enlaces) para quedarse con un solo evento.
   * Medido contra la base real (248 eventos, 458 pruebas): 324 ms y cinco
   * consultas que traen todo por la red, para devolver una ficha. Filtrando
   * por id se trae solo lo de ese evento y el coste deja de crecer con el
   * tamaño del calendario.
   */
  const [vista] = await listEvents({ ids: [eventId], includePast: true, limit: 1 });
  return vista ?? null;
}

/** Clubes activos, para los desplegables de alta. */
export const listClubs = cache(async () =>
  db.select().from(club).where(eq(club.active, true)).orderBy(asc(club.name)),
);

/**
 * Fecha del dato más reciente. Alimenta el aviso "el calendario no se ha
 * podido actualizar desde el ...". El silencio es el peor fallo posible.
 */
export const getDataFreshness = cache(async () => {
  const [row] = await db
    .select({ lastSeenAt: event.lastSeenAt })
    .from(event)
    .orderBy(desc(event.lastSeenAt))
    .limit(1);

  if (!row) return { lastSeenAt: null, ageHours: null, stale: true };

  const ageHours = Math.floor((Date.now() - row.lastSeenAt.getTime()) / 3_600_000);
  return { lastSeenAt: row.lastSeenAt, ageHours, stale: ageHours > 48 };
});

/**
 * Cuántas pruebas hay en el calendario, de hoy en adelante.
 *
 * Es el único dato que enseña la pantalla de acceso, y es real: sale de
 * contar la tabla, no de un número escrito a mano que envejece. Cuenta
 * pruebas y no torneos porque una prueba es a lo que uno se inscribe.
 */
export const contarPruebas = cache(async (): Promise<number> => {
  const hoy = new Date().toISOString().slice(0, 10);
  const [fila] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(eventCompetition)
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(
      and(
        isNull(event.disappearedAt),
        isNull(event.canonicalEventId),
        gte(event.endDate, hoy),
      ),
    );
  return fila?.n ?? 0;
});

/**
 * Una fila de la lista de inscritos que PUBLICA la fuente oficial.
 *
 * Es información distinta de `inscritosDelEvento`, que son las inscripciones
 * tramitadas por esta aplicación. Las dos tienen que verse por separado y
 * etiquetadas, porque responden a preguntas distintas: «lo he pedido yo aquí»
 * frente a «ya figuro en la lista oficial de Skermo, me haya apuntado quien
 * me haya apuntado». Justo el caso que pide el usuario: al tirador lo apunta
 * su club y él no se entera.
 */
export type InscritoPublicado = {
  competitionId: string;
  /** El nombre tal cual lo publica la fuente. No se retoca ni se acentúa. */
  nombre: string;
  /** Código de equipo en pruebas por equipos ("CCC-M 1"); null si individual. */
  equipo: string | null;
  club: string | null;
  /**
   * Id de nuestro tirador cuando la fila está emparejada. Hoy Skermo no
   * publica la licencia en esta pantalla, así que casi siempre es `null` y lo
   * resuelve el admin. Nunca se empareja por nombre.
   */
  athleteId: string | null;
  /** `true` si es uno de los tiradores que gestiona quien está mirando. */
  esMio: boolean;
  /** Fecha en la que dejó de figurar en la lista oficial, si ha dejado. */
  retiradoEn: Date | null;
  /** Fuente que lo publica, para poder decirlo en pantalla. */
  fuente: string;
  sourceUrl: string | null;
};

/**
 * Lista de inscritos publicada por la fuente oficial, para todas las pruebas
 * de un torneo.
 *
 * Una sola consulta para el torneo entero: el driver de Neon habla por HTTP y
 * una consulta por prueba serían ocho viajes de red para abrir una ficha.
 *
 * `athleteIdsPropios` es opcional y sirve solo para marcar cuáles son tuyos
 * sin tener que cruzar nada en el cliente. Va como parámetro y no se deduce de
 * la sesión aquí para que esta función siga siendo una consulta pura.
 */
export async function inscritosPublicados(
  eventId: string,
  opciones: { athleteIdsPropios?: string[]; incluirRetirados?: boolean } = {},
): Promise<InscritoPublicado[]> {
  const propios = new Set(opciones.athleteIdsPropios ?? []);

  const filas = await db
    .select({
      competitionId: competitionRegistration.eventCompetitionId,
      nombre: competitionRegistration.sourceAthleteName,
      equipo: competitionRegistration.sourceTeam,
      clubPublicado: competitionRegistration.sourceClub,
      athleteId: competitionRegistration.athleteId,
      retiradoEn: competitionRegistration.withdrawnAt,
      fuente: competitionRegistration.source,
      sourceUrl: competitionRegistration.sourceUrl,
      clubNombre: club.name,
    })
    .from(competitionRegistration)
    .innerJoin(
      eventCompetition,
      eq(competitionRegistration.eventCompetitionId, eventCompetition.id),
    )
    .leftJoin(athlete, eq(competitionRegistration.athleteId, athlete.id))
    .leftJoin(club, eq(athlete.clubId, club.id))
    .where(
      opciones.incluirRetirados
        ? eq(eventCompetition.eventId, eventId)
        : and(
            eq(eventCompetition.eventId, eventId),
            isNull(competitionRegistration.withdrawnAt),
          ),
    )
    .orderBy(asc(competitionRegistration.sourceAthleteName));

  return filas.map((f) => ({
    competitionId: f.competitionId,
    nombre: f.nombre,
    equipo: f.equipo === '' ? null : f.equipo,
    club: f.clubPublicado ?? f.clubNombre ?? null,
    athleteId: f.athleteId,
    esMio: f.athleteId !== null && propios.has(f.athleteId),
    retiradoEn: f.retiradoEn,
    fuente: f.fuente,
    sourceUrl: f.sourceUrl,
  }));
}

/**
 * Cuántos inscritos publica la fuente en cada prueba de un torneo.
 *
 * Sirve para pintar el contador sin traerse los nombres, que es lo que
 * interesa en la rejilla del calendario.
 */
export async function contarInscritosPublicados(
  eventId: string,
): Promise<Record<string, number>> {
  const filas = await db
    .select({
      competitionId: competitionRegistration.eventCompetitionId,
      n: sql<number>`count(*)::int`,
    })
    .from(competitionRegistration)
    .innerJoin(
      eventCompetition,
      eq(competitionRegistration.eventCompetitionId, eventCompetition.id),
    )
    .where(
      and(
        eq(eventCompetition.eventId, eventId),
        isNull(competitionRegistration.withdrawnAt),
      ),
    )
    .groupBy(competitionRegistration.eventCompetitionId);

  return Object.fromEntries(filas.map((f) => [f.competitionId, f.n]));
}
