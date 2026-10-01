import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  competitionRegistration,
  event,
  eventCompetition,
  ingestQuarantine,
  ingestRun,
  notification,
  officialDocument,
} from '@/db/schema';
import { recalcularVigencia } from '../documentos/recalcular';
import { tocaLeerRanking } from './cadencia-ranking';
import { esquemaDeportivo } from '@/lib/sport/esquema-db';
import { sha256 } from '../utils';
import {
  MAX_REESCRITURAS_POR_REFERENCIAS,
  clasificarHuellaInscritos,
  repartirReescriturasConGuarda,
  type ClaseHuella,
} from './backfill/referencias';
import { crearGuardaCapacidad } from './backfill/guarda-capacidad';
import { recalcularEnlaces } from './enlazar';
import { fetchText } from './fetcher';
import { fetchEfcCalendar } from './sources/efc';
import {
  DIAS_VENTANA_INSCRITOS,
  currentFieSeason,
  fetchFieSeason,
  fetchInscritosFie,
  fieEntriesUrl,
  huellaDeInscritos,
  pruebaFieDeSourceId,
  tocaLeerInscritos,
} from './sources/fie';
import { ingestFieTiradores } from './sources/fie-tiradores';
import { ingestRankingRfee } from './sources/ranking-rfee';
import { fetchOfficialDocuments } from './sources/rfee-wp';
import { parseSkermoCalendar, skermoCalendarUrl } from './sources/skermo';
import { ingestSkermoResults } from './sources/skermo-results';
import { markMissingEvents, upsertEvents, upsertListasDeInscritos } from './upsert';
import { validateEvents } from './types';
import { storeIngestSnapshot } from '../storage';

export const INGEST_SOURCES = [
  'skermo_rfee',
  'skermo_regional',
  'fie',
  'efc',
  'rfee_wp',
  'skermo_ranking',
  'fie_tiradores',
] as const;

export type IngestSource = (typeof INGEST_SOURCES)[number];

export function isIngestSource(value: string): value is IngestSource {
  return (INGEST_SOURCES as readonly string[]).includes(value);
}

/** Trocea para escribir en lote: un INSERT gigante tampoco es buena idea. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const SOURCE_DESCRIPTION: Record<IngestSource, string> = {
  skermo_rfee: 'Calendario nacional de la RFEE en Skermo',
  skermo_regional: 'Calendarios de las federaciones autonómicas en Skermo',
  fie: 'Calendario internacional de la FIE (API JSON pública)',
  efc: 'Circuito europeo de la EFC',
  rfee_wp: 'Circulares oficiales de esgrima.es',
  skermo_ranking: 'Ranking nacional oficial de la RFEE en Skermo',
  fie_tiradores: 'Fichas de tirador de la FIE (foto enlazada y puesto mundial)',
};

/**
 * Federaciones autonómicas que se ingieren en la pasada `skermo_regional`.
 * Los códigos están verificados: uno inválido devuelve HTTP 500 en Skermo.
 */
export const REGIONAL_FEDERATIONS: { code: string; name: string }[] = [
  { code: 'FCE', name: 'Federació Catalana d’Esgrima' },
  { code: 'FME', name: 'Federación de Madrid' },
  { code: 'FECYL', name: 'Federación de Castilla y León' },
  { code: 'FAE', name: 'Federación FAE' },
  { code: 'FVE', name: 'Federación FVE' },
  { code: 'FGE', name: 'Federación Galega' },
  { code: 'FNE', name: 'Federación Navarra' },
  { code: 'FEXE', name: 'Federación de Extremadura' },
  { code: 'FRE', name: 'Federación FRE' },
  { code: 'FCANE', name: 'Federación Canaria' },
  { code: 'FEESCLM', name: 'Federación de Castilla-La Mancha' },
];

export type IngestResult = {
  runId: string;
  source: IngestSource;
  status: 'ok' | 'parcial' | 'error';
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsQuarantined: number;
  notificationsQueued: number;
  durationMs: number;
  error: string | null;
  note: string | null;
};

/**
 * Ejecuta la ingestión de una fuente y deja constancia en `ingest_run`.
 *
 * Nunca lanza: un fallo se registra y se devuelve. Si esto lanzara, la ruta de
 * cron devolvería 500 y nos quedaríamos sin saber qué pasó, que es exactamente
 * el escenario que queremos evitar (un scraper roto pasando desapercibido
 * durante semanas).
 */
export async function runIngest(
  source: IngestSource,
  options: { triggeredBy?: string } = {},
): Promise<IngestResult> {
  const startedAt = new Date();

  const [run] = await db
    .insert(ingestRun)
    .values({
      source,
      startedAt,
      triggeredBy: options.triggeredBy ?? 'cron',
    })
    .returning({ id: ingestRun.id });

  const base: IngestResult = {
    runId: run.id,
    source,
    status: 'ok',
    itemsSeen: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    itemsQuarantined: 0,
    notificationsQueued: 0,
    durationMs: 0,
    error: null,
    note: null,
  };

  try {
    const result = await dispatch(source, run.id);
    Object.assign(base, result);

    /**
     * DUPLICADOS ENTRE FUENTES. El mismo torneo internacional entra dos veces,
     * una por Skermo y otra por la FIE, con nombres distintos. Después de
     * tocar el calendario se recalcula qué pares son el mismo torneo, para que
     * se pinte una sola tarjeta y el evento de Skermo herede el cartel de la
     * FIE.
     *
     * Se recalcula ENTERO en cada pasada, no incrementalmente: así una sede
     * corregida en la fuente deshace el enlace sola, y volver a lanzar la
     * ingestión no cambia nada. Cuesta tres lecturas en lote.
     *
     * Si falla, la ingestión NO falla: el calendario con duplicados sigue
     * siendo un calendario correcto; se anota y ya está.
     */
    if (
      source !== 'rfee_wp' &&
      source !== 'skermo_ranking' &&
      source !== 'fie_tiradores'
    ) {
      try {
        const enlaces = await recalcularEnlaces();
        const partes = [
          `${enlaces.enlazados} registros de la FIE unidos a su torneo de Skermo`,
          `${enlaces.cartelesHeredados} eventos heredan cartel`,
        ];
        if (enlaces.dudosos > 0) {
          partes.push(`${enlaces.dudosos} emparejamientos dudosos sin unir, a revisar`);
        }
        base.note = [base.note, partes.join(', ')].filter(Boolean).join(' | ');
      } catch (error) {
        base.note = [
          base.note,
          `el emparejado con la FIE no se pudo recalcular: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ]
          .filter(Boolean)
          .join(' | ');
      }
    }
  } catch (error) {
    base.status = 'error';
    base.error = error instanceof Error ? error.message : String(error);
  }

  base.durationMs = Date.now() - startedAt.getTime();

  await db
    .update(ingestRun)
    .set({
      finishedAt: new Date(),
      durationMs: base.durationMs,
      status: base.status,
      itemsSeen: base.itemsSeen,
      itemsCreated: base.itemsCreated,
      itemsUpdated: base.itemsUpdated,
      itemsQuarantined: base.itemsQuarantined,
      notificationsQueued: base.notificationsQueued,
      error: base.error ?? base.note,
    })
    .where(eq(ingestRun.id, run.id));

  if (base.status === 'error') await maybeAlertAdmin(source, base.error);

  return base;
}

type Dispatched = Partial<IngestResult> & { note?: string | null };

async function dispatch(source: IngestSource, runId: string): Promise<Dispatched> {
  switch (source) {
    case 'skermo_rfee': {
      // Los resultados van DESPUÉS del calendario a propósito: necesitan que
      // las pruebas ya existan para poder emparejarse con ellas.
      const calendario = await ingestSkermo(runId, source, [
        { code: 'RFEE', name: 'Real Federación Española de Esgrima' },
      ]);
      const resultados = await ingestSkermoResults(runId);
      return {
        ...calendario,
        itemsSeen: (calendario.itemsSeen ?? 0) + resultados.itemsSeen,
        itemsCreated: (calendario.itemsCreated ?? 0) + resultados.itemsCreated,
        itemsUpdated: (calendario.itemsUpdated ?? 0) + resultados.itemsUpdated,
        itemsQuarantined:
          (calendario.itemsQuarantined ?? 0) + resultados.itemsQuarantined,
        note: [calendario.note, resultados.note].filter(Boolean).join(' | ') || null,
      };
    }
    case 'skermo_regional':
      return ingestSkermo(runId, source, REGIONAL_FEDERATIONS);
    case 'fie':
      return ingestFie(runId);
    case 'efc':
      return ingestEfc();
    case 'rfee_wp':
      return ingestOfficialDocuments();
    case 'skermo_ranking': {
      /**
       * El ranking no se lee todas las noches, aunque el cron se levante.
       *
       * Solo cambia cuando se disputa algo que puntúa, y en una temporada eso
       * son unas treinta veces. La cadencia la decide `tocaLeerRanking`, que
       * es una función pura con sus casos en `tests/cadencia-ranking.test.ts`:
       * los tres días siguientes a cada prueba, y una revisión semanal el
       * resto del tiempo.
       *
       * Cuando no toca se devuelve una ejecución `ok` con su explicación, no
       * un fallo: no haber hecho nada porque no había nada que hacer es el
       * resultado correcto, y así el panel de salud no se llena de rojos que
       * no significan nada.
       */
      const decision = await decidirCadenciaRanking();
      if (!decision.leer) {
        return {
          status: 'ok',
          itemsSeen: 0,
          itemsCreated: 0,
          itemsUpdated: 0,
          itemsUnchanged: 0,
          itemsQuarantined: 0,
          note: `No toca leer el ranking. ${decision.explicacion}`,
        };
      }
      const resultado = await ingestRanking(runId);
      return {
        ...resultado,
        note: [decision.explicacion, resultado.note].filter(Boolean).join(' | '),
      };
    }
    case 'fie_tiradores':
      return ingestFichasFie(runId);
  }
}

async function ingestSkermo(
  runId: string,
  source: 'skermo_rfee' | 'skermo_regional',
  federations: { code: string; name: string }[],
): Promise<Dispatched> {
  let itemsSeen = 0;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let quarantined = 0;
  let notifications = 0;
  const failures: string[] = [];
  /** Se acumulan de todas las federaciones: marcar desaparecidos mirando solo
   *  una federación borraría del mapa las de las otras diez. */
  const seenSourceIds: string[] = [];

  for (const federation of federations) {
    const url = skermoCalendarUrl(federation.code);

    try {
      const { body } = await fetchText(url, { timeoutMs: 120_000 });

      // Snapshot del HTML crudo: depurar un parseo roto sin volver a pedir la
      // página vale mucho más de lo que cuesta guardarlo comprimido.
      if (source === 'skermo_rfee') {
        await storeIngestSnapshot(source, runId, body).catch(() => null);
      }

      const { candidates, rowsSeen } = parseSkermoCalendar(body, {
        source,
        federationCode: federation.code,
        regionalFederation: source === 'skermo_regional' ? federation.name : null,
      });

      itemsSeen += rowsSeen;

      const validated = validateEvents(candidates);
      quarantined += await saveQuarantine(runId, source, validated.quarantined);
      await resolverCuarentena(source, validated.events);

      for (const e of validated.events) seenSourceIds.push(e.sourceId);

      const stats = await upsertEvents(validated.events);
      created += stats.created;
      updated += stats.updated;
      unchanged += stats.unchanged;
      notifications += stats.notificationsQueued;
    } catch (error) {
      // Una federación caída no debe tumbar las otras diez.
      failures.push(
        `${federation.code}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length === federations.length) {
    throw new Error(`Ninguna federación respondió. ${failures.join(' | ')}`);
  }

  /**
   * Los eventos que ya no aparecen se marcan como desaparecidos (normalmente
   * significa "anulado"). Solo se hace si NO hubo fallos: si media fuente no
   * respondió, marcaríamos como desaparecido lo que simplemente no pudimos
   * leer, y eso sí que sería un dato falso.
   */
  let disappeared = 0;
  if (failures.length === 0 && seenSourceIds.length > 0) {
    disappeared = await markMissingEvents(source, seenSourceIds, new Date());
  }

  return {
    status: failures.length > 0 ? 'parcial' : 'ok',
    itemsSeen,
    itemsCreated: created,
    itemsUpdated: updated,
    itemsUnchanged: unchanged,
    itemsQuarantined: quarantined,
    notificationsQueued: notifications,
    note:
      failures.length > 0
        ? `No respondieron ${failures.length} federaciones: ${failures.join(' | ')}`
        : disappeared > 0
          ? `${disappeared} eventos han desaparecido del calendario oficial`
          : null,
  };
}

async function ingestFie(runId: string): Promise<Dispatched> {
  const season = currentFieSeason();
  const { candidates, rowsSeen, futuro } = await fetchFieSeason(season);

  const validated = validateEvents(candidates);
  const quarantined = await saveQuarantine(runId, 'fie', validated.quarantined);
  await resolverCuarentena('fie', validated.events);
  const stats = await upsertEvents(validated.events);

  /**
   * Y después del calendario, las listas de inscritos.
   *
   * Va DESPUÉS a propósito: necesita que las pruebas existan con su día para
   * poder decidir cuáles están en la ventana. Y si falla, la ingestión del
   * calendario NO falla: un calendario sin listas sigue siendo un calendario,
   * y perder las dos por un 500 en una lista sería mucho peor. Mismo criterio
   * que `recalcularEnlaces()`.
   */
  let notaInscritos = '';
  try {
    const listas = await ingestInscritosFie();
    notaInscritos =
      ` | inscritos: ${listas.peticiones} peticiones (de ${listas.enVentana} pruebas ` +
      `en ventana, ${listas.saltadas} sin tocar por cadencia), ${listas.listasLeidas} listas, ` +
      `${listas.espanoles} inscritos españoles de ${listas.publicados} publicados, ` +
      `${listas.escritas} filas escritas, ${listas.sinCambios} listas sin cambios, ` +
      `${listas.emparejadas} emparejadas, ${listas.bajas} bajas` +
      (listas.colisiones > 0
        ? `, ${listas.colisiones} listas se quedan en la fila de la FIE porque la prueba ya ` +
          `tiene lista de otro publicador`
        : '') +
      (listas.sinEquivalente > 0
        ? `, ${listas.sinEquivalente} de equipos sin prueba equivalente en el torneo español`
        : '') +
      (listas.reescrituraReferencias > 0
        ? `, ${listas.reescrituraReferencias} reescritas una vez por la migración 0018`
        : '') +
      (listas.reescrituraCapacidad
        ? `, reescritura por 0018 retenida por capacidad (${listas.reescrituraCapacidad})`
        : '') +
      (listas.reescrituraDiferida > 0
        ? `, ${listas.reescrituraDiferida} reescrituras por 0018 diferidas a otra lectura`
        : '') +
      (listas.fallos > 0 ? `, ${listas.fallos} listas no respondieron` : '');
  } catch (error) {
    notaInscritos = ` | inscritos: no se pudieron leer (${
      error instanceof Error ? error.message : 'error'
    })`;
  }

  return {
    status: 'ok',
    itemsSeen: rowsSeen,
    itemsCreated: stats.created,
    itemsUpdated: stats.updated,
    itemsUnchanged: stats.unchanged,
    itemsQuarantined: quarantined,
    notificationsQueued: stats.notificationsQueued,
    /**
     * Se dice lo que ha costado el calendario futuro, porque es la parte cara
     * y la que puede degradarse sin avisar: si un día `torneos` baja a 0, el
     * listado de la FIE habrá dejado de publicar el índice y los dossieres de
     * los torneos que vienen desaparecerán en silencio.
     */
    note:
      `Temporada FIE ${season} · futuro: ${futuro.torneos} torneos, ` +
      `${futuro.pruebas} pruebas, ${futuro.peticiones} peticiones` +
      notaInscritos,
  };
}

export type ResumenInscritosFie = {
  /** Pruebas futuras dentro de la ventana de `DIAS_VENTANA_INSCRITOS`. */
  enVentana: number;
  /** De esas, las que la cadencia ha decidido no pedir hoy. */
  saltadas: number;
  peticiones: number;
  listasLeidas: number;
  fallos: number;
  /** Inscritos totales que publica la FIE en las listas leídas. */
  publicados: number;
  /** De esos, los españoles, que son los únicos que salen del adaptador. */
  espanoles: number;
  escritas: number;
  sinCambios: number;
  emparejadas: number;
  bajas: number;
  colisiones: number;
  sinEquivalente: number;
  /** Listas reescritas una vez porque la migración 0018 cambió su huella, con el mismo contenido. */
  reescrituraReferencias: number;
  /** Listas que esperan a otra lectura elegible por el tope de reescrituras por ejecución. */
  reescrituraDiferida: number;
  /** Motivo por el que la guarda de capacidad retuvo la reescritura forzada por 0018 (null = no se retuvo). */
  reescrituraCapacidad: string | null;
  /** Listas cuyo contenido cambió de verdad (no cuenta la reescritura forzada por 0018). */
  contenidoCambiado: number;
};

/**
 * ===========================================================================
 * LAS LISTAS DE INSCRITOS DE LA FIE
 * ===========================================================================
 *
 * Es lo que arregla el agujero que tenía la aplicación: de 2.046 filas de
 * listas oficiales **ninguna traía licencia**, y sin licencia no se puede
 * decirle a nadie «estás dentro», que es media aplicación.
 *
 * QUÉ SE GUARDA. Solo de los españoles, y solo nombre, licencia y día de
 * inscripción. El filtro está en el adaptador
 * (`inscritosEspanolesDeLaFie`), no aquí, y tiene su test con un menor de
 * otra federación: así lo que no se debe guardar no llega a existir en esta
 * función y no hay forma de escribirlo por descuido.
 *
 * EL COSTE. Una petición por prueba. Con la ventana de 30 días son **54
 * peticiones en la primera pasada** y **0 en una segunda pasada el mismo
 * día**, porque la cadencia mira `registrations_checked_at`. Los números y el
 * porqué de la ventana están en `DIAS_VENTANA_INSCRITOS`.
 *
 * ---------------------------------------------------------------------------
 * DÓNDE SE ESCRIBE LA LISTA, que es la parte que tiene truco
 * ---------------------------------------------------------------------------
 * Los 102 registros futuros de la FIE están ABSORBIDOS por el torneo español
 * que publica Skermo (`event.canonical_event_id`), y la tarjeta que se ve en
 * el calendario —y la ficha que se abre— es la española. Si la lista se
 * colgara de la prueba de la FIE, nadie la vería nunca: la ficha lee las
 * pruebas del evento canónico.
 *
 * Así que la lista va a la prueba EQUIVALENTE del torneo español (mismo arma,
 * género, categoría y formato), que es la misma prueba de verdad publicada dos
 * veces. Es la misma herencia que ya se hace con el cartel y con el dossier.
 *
 * Y con un guardarraíl, porque hay un caso en el que eso mentiría: **si esa
 * prueba ya tiene lista de otro publicador, no se mezcla**. Skermo publica su
 * propia lista de inscritos de la Copa del Mundo de Orán (6 nombres, la gente
 * que la RFEE ha apuntado) y la FIE publica la suya (9 españoles). Son las
 * mismas personas escritas de otra forma —«JORGE CASAUS PIELAGO» y «CASAUS
 * PIELAGO Jorge»— así que juntarlas daría 15 filas para 11 personas, un
 * marcador de 15 y un pie que dice «Lista publicada por Skermo · RFEE» para
 * dos listas. Tres mentiras en pantalla.
 *
 * En ese caso la lista se queda en la prueba de la FIE: guardada, emparejada y
 * comprobable, pero sin pisar la que se enseña. Es el mismo criterio que
 * `recalcularEnlaces` con los pares ambiguos: **ante la duda no se une nada y
 * se deja constancia** en la nota de la ejecución, porque decidir quién manda
 * en la lista de una prueba internacional —la organizadora o la federación
 * española— es una decisión de producto, no de ingestión.
 *
 * Y es estable en las dos direcciones: si Skermo empieza a publicar la lista
 * de una prueba en la que ya habíamos escrito la de la FIE, la colisión
 * aparece y las filas de la FIE se retiran de la prueba española en la misma
 * pasada. Sin eso, la mezcla habría llegado sola una semana después.
 */
export async function ingestInscritosFie(
  ahora: Date = new Date(),
): Promise<ResumenInscritosFie> {
  const resumen: ResumenInscritosFie = {
    enVentana: 0,
    saltadas: 0,
    peticiones: 0,
    listasLeidas: 0,
    fallos: 0,
    publicados: 0,
    espanoles: 0,
    escritas: 0,
    sinCambios: 0,
    emparejadas: 0,
    bajas: 0,
    colisiones: 0,
    sinEquivalente: 0,
    reescrituraReferencias: 0,
    reescrituraDiferida: 0,
    reescrituraCapacidad: null,
    contenidoCambiado: 0,
  };

  const hoy = ahora.toISOString().slice(0, 10);
  const hasta = new Date(ahora.getTime() + DIAS_VENTANA_INSCRITOS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  /**
   * Las candidatas, en una consulta. Se piden ya solo las de la ventana: traer
   * las 554 pruebas internacionales para descartar 500 en memoria sería pagar
   * un viaje de red enorme por nada.
   */
  const candidatas = await db
    .select({
      pruebaFieId: eventCompetition.id,
      competitionDate: eventCompetition.competitionDate,
      registrationsHash: eventCompetition.registrationsHash,
      registrationsCheckedAt: eventCompetition.registrationsCheckedAt,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      format: eventCompetition.format,
      eventSourceId: event.sourceId,
      canonicalEventId: event.canonicalEventId,
    })
    .from(eventCompetition)
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(
      and(
        eq(event.source, 'fie'),
        isNull(event.disappearedAt),
        eq(event.cancelled, false),
        sql`${eventCompetition.competitionDate} between ${hoy} and ${hasta}`,
      ),
    );

  resumen.enVentana = candidatas.length;
  if (candidatas.length === 0) return resumen;

  /**
   * La prueba equivalente del torneo español, y si ya tiene lista de otro
   * publicador. Dos consultas para todas las pruebas de golpe.
   */
  const idsCanonicos = [
    ...new Set(candidatas.map((c) => c.canonicalEventId).filter((v): v is string => !!v)),
  ];
  const equivalentes = new Map<string, string>();
  if (idsCanonicos.length > 0) {
    for (const lote of chunk(idsCanonicos, 200)) {
      const filas = await db
        .select({
          id: eventCompetition.id,
          eventId: eventCompetition.eventId,
          weapon: eventCompetition.weapon,
          gender: eventCompetition.gender,
          category: eventCompetition.category,
          format: eventCompetition.format,
        })
        .from(eventCompetition)
        .where(inArray(eventCompetition.eventId, lote));
      for (const f of filas) {
        equivalentes.set(
          `${f.eventId}|${f.weapon}|${f.gender}|${f.category}|${f.format}`,
          f.id,
        );
      }
    }
  }

  /** Pruebas que ya tienen lista de un publicador que NO es la FIE. */
  const conListaAjena = new Set<string>();
  const idsDestinoPosibles = [...new Set(equivalentes.values())];
  if (idsDestinoPosibles.length > 0) {
    for (const lote of chunk(idsDestinoPosibles, 300)) {
      const filas = await db
        .selectDistinct({ id: competitionRegistration.eventCompetitionId })
        .from(competitionRegistration)
        .where(
          and(
            inArray(competitionRegistration.eventCompetitionId, lote),
            sql`${competitionRegistration.source} <> 'fie'`,
          ),
        );
      for (const f of filas) conListaAjena.add(f.id);
    }
  }

  /** A qué prueba va cada lista, y por qué. */
  type Destino = {
    pruebaFieId: string;
    /** La prueba equivalente del torneo español, si la hay. */
    equivalenteId: string | null;
    destinoId: string;
    /** Si la lista se queda en la fila de la FIE, y el motivo. */
    retenida: null | 'colision' | 'sin_equivalente';
    season: number;
    competitionId: number;
    hashGuardado: string | null;
    /** Día de la prueba (YYYY-MM-DD), para ámbitos y vigencias de los IDs. */
    dia: string | null;
  };

  const aLeer: Destino[] = [];

  for (const c of candidatas) {
    const ref = pruebaFieDeSourceId(c.eventSourceId);
    if (!ref) continue;

    const decision = tocaLeerInscritos(ahora, c.competitionDate, c.registrationsCheckedAt);
    if (!decision.leer) {
      resumen.saltadas += 1;
      continue;
    }

    const equivalente = c.canonicalEventId
      ? equivalentes.get(
          `${c.canonicalEventId}|${c.weapon}|${c.gender}|${c.category}|${c.format}`,
        )
      : c.pruebaFieId;

    let destinoId = equivalente ?? c.pruebaFieId;
    let retenida: Destino['retenida'] = null;
    if (!equivalente) {
      retenida = 'sin_equivalente';
      resumen.sinEquivalente += 1;
    } else if (conListaAjena.has(equivalente)) {
      destinoId = c.pruebaFieId;
      retenida = 'colision';
      resumen.colisiones += 1;
    }

    aLeer.push({
      pruebaFieId: c.pruebaFieId,
      equivalenteId: equivalente ?? null,
      destinoId,
      retenida,
      season: ref.season,
      competitionId: ref.competitionId,
      hashGuardado: c.registrationsHash,
      dia: c.competitionDate ? c.competitionDate.slice(0, 10) : null,
    });
  }

  if (aLeer.length === 0) return resumen;

  const conReferencias = (await esquemaDeportivo()).referencias;

  /** De seis en seis, igual que el resto del adaptador de la FIE. */
  const leidas: {
    destino: Destino;
    inscritos: Awaited<ReturnType<typeof fetchInscritosFie>>['inscritos'];
    huella: string;
    clase: ClaseHuella;
    publicados: number;
  }[] = [];

  for (let i = 0; i < aLeer.length; i += 6) {
    const lote = aLeer.slice(i, i + 6);
    const resultados = await Promise.all(
      lote.map(async (destino) => {
        resumen.peticiones += 1;
        try {
          const r = await fetchInscritosFie(destino.season, destino.competitionId);
          return { destino, ...r };
        } catch {
          resumen.fallos += 1;
          return null;
        }
      }),
    );
    for (const r of resultados) {
      if (!r) continue;
      resumen.listasLeidas += 1;
      resumen.publicados += r.totalPublicados;
      resumen.espanoles += r.inscritos.length;
      const huella = await huellaDeInscritos(r.inscritos, r.destino.destinoId, conReferencias);
      leidas.push({
        destino: r.destino,
        inscritos: r.inscritos,
        huella,
        clase: clasificarHuellaInscritos({
          guardada: r.destino.hashGuardado,
          sinRef: await huellaDeInscritos(r.inscritos, r.destino.destinoId, false),
          conRef: huella,
          conReferencias,
        }),
        publicados: r.totalPublicados,
      });
    }
  }

  /**
   * Y ahora lo que de verdad se escribe: solo las listas cuya huella ha
   * cambiado. Una lista igual a la de ayer no reescribe ni una fila; se le
   * refresca `last_seen_at` en una sola sentencia, que es lo mismo que hace
   * `upsertEvents` con los eventos sin cambios, y así la pantalla puede seguir
   * diciendo con verdad cuándo se leyó.
   */
  /**
   * Tras la migración 0018 la huella de cada lista cambia aunque sus inscritos
   * no. Esa reescritura única se acota por ejecución y se cuenta aparte de los
   * cambios reales; la que no cabe no se escribe ni refresca su marca de
   * lectura, así que vuelve a ser elegible en la siguiente pasada.
   */
  // La reescritura forzada se autoriza con el tamaño de las listas ya leídas, no con un supuesto por lista.
  const guarda = crearGuardaCapacidad({
    plan: { tipo: 'desconocido' },
    medir: async () => {
      const { consultaSqlDb, medirOcupacion } = await import('./backfill/capacidad-db');
      return medirOcupacion(consultaSqlDb(db));
    },
  });
  const reparto = await repartirReescriturasConGuarda(leidas, MAX_REESCRITURAS_POR_REFERENCIAS, guarda);
  if (reparto.capacidad && !reparto.capacidad.continuar) resumen.reescrituraCapacidad = reparto.capacidad.motivo;
  resumen.reescrituraReferencias = reparto.reescritas;
  resumen.reescrituraDiferida = reparto.diferidas.length;
  resumen.contenidoCambiado = reparto.escribir.filter((l) => l.clase === 'contenido_cambiado').length;
  const aEscribir = reparto.escribir;
  const cambiadas = aEscribir.filter((l) => l.huella !== l.destino.hashGuardado);
  const iguales = aEscribir.filter((l) => l.huella === l.destino.hashGuardado);
  resumen.sinCambios = iguales.length;

  /**
   * LA COLISIÓN QUE APARECE DESPUÉS, y por qué aquí hay un `delete`.
   *
   * Si una prueba española empieza a publicar su propia lista después de que
   * nosotros hubiéramos escrito allí la de la FIE, la mezcla aparecería sola
   * en la siguiente pasada. Así que las filas de la FIE se retiran de esa
   * prueba —y solo esas: `source = 'fie'`, que son exactamente las que escribe
   * esta función— y se vuelven a escribir en la fila de la FIE justo debajo.
   *
   * Se borra en vez de marcar `withdrawn_at` porque no es una baja: el tirador
   * sigue inscrito. Lo que ha cambiado es DÓNDE se guarda la fila, y una baja
   * falsa se le contaría a alguien como «te han quitado de la lista».
   */
  // Una lista diferida no se reescribe en esta pasada: retirar sus filas ahora las dejaría sin destino.
  const diferidas = new Set(reparto.diferidas.map((l) => l.destino.destinoId));
  const aRetirar = [
    ...new Set(
      aLeer
        .filter((d) => d.retenida === 'colision' && d.equivalenteId && !diferidas.has(d.destinoId))
        .map((d) => d.equivalenteId as string),
    ),
  ];
  for (const lote of chunk(aRetirar, 300)) {
    if (lote.length === 0) continue;
    await db
      .delete(competitionRegistration)
      .where(
        and(
          inArray(competitionRegistration.eventCompetitionId, lote),
          eq(competitionRegistration.source, 'fie'),
        ),
      );
  }

  if (cambiadas.length > 0) {
    const stats = await upsertListasDeInscritos(
      cambiadas.map((l) => ({
        eventCompetitionId: l.destino.destinoId,
        source: 'fie' as const,
        sourceUrl: fieEntriesUrl(l.destino.season, l.destino.competitionId),
        dia: l.destino.dia,
        rows: l.inscritos.map((i) => ({
          sourceAthleteName: i.nombre,
          sourceTeam: i.equipo,
          sourceLicense: i.licencia,
          sourceRegisteredAt: i.inscritoEl,
          sourceFieId: i.fieId,
          // La FIE no publica el club del tirador en la lista de inscritos.
          sourceClub: null,
        })),
      })),
      ahora,
    );
    resumen.escritas = stats.seen;
    resumen.emparejadas = stats.matched;
    resumen.bajas = stats.withdrawn;
  }

  /** Las que no han cambiado: un solo UPDATE por lote, no uno por fila. */
  for (const lote of chunk(
    iguales.map((l) => l.destino.destinoId),
    300,
  )) {
    if (lote.length === 0) continue;
    await db
      .update(competitionRegistration)
      .set({ lastSeenAt: ahora })
      .where(
        and(
          inArray(competitionRegistration.eventCompetitionId, lote),
          eq(competitionRegistration.source, 'fie'),
        ),
      );
  }

  /**
   * La huella y la marca de lectura, SIEMPRE en la fila de la FIE, aunque las
   * filas se hayan escrito en la prueba española: la huella describe la lista
   * que publica la FIE de SU prueba, y así sigue valiendo el día que la
   * decisión de dónde escribir cambie.
   */
  for (const lote of chunk(aEscribir, 100)) {
    const valores = sql.join(
      lote.map((l) => sql`(${l.destino.pruebaFieId}::uuid, ${l.huella}::text)`),
      sql`, `,
    );
    await db.execute(sql`
      update ${eventCompetition} as ec
      set registrations_hash = v.huella,
          registrations_checked_at = ${ahora}
      from (values ${valores}) as v(id, huella)
      where ec.id = v.id
    `);
  }

  /**
   * Y una reparación, de paso y en una sola sentencia: la URL de la lista de
   * las pruebas de la FIE se guardaba con el `id` del índice de torneos en vez
   * del `competitionId`, y con ese id la página responde **200 con la lista
   * vacía** (ver `fieEntriesUrl`). Un enlace roto que no da error es peor que
   * uno que lo dé, y es el enlace que la ficha ofrece cuando no sabe
   * emparejarte. `is distinct from` la hace idempotente: la segunda pasada no
   * toca ni una fila.
   */
  await db.execute(sql`
    update event_competition as ec
    set source_url = 'https://fie.org/competition/'
      || split_part(e.source_id, '-', 2) || '/'
      || split_part(e.source_id, '-', 3) || '/entries'
    from event as e
    where e.id = ec.event_id
      and e.source = 'fie'
      and e.source_id ~ '^fie-[0-9]{4}-[0-9]+$'
      and ec.source_url is distinct from (
        'https://fie.org/competition/'
        || split_part(e.source_id, '-', 2) || '/'
        || split_part(e.source_id, '-', 3) || '/entries'
      )
  `);

  return resumen;
}

async function ingestEfc(): Promise<Dispatched> {
  const outcome = await fetchEfcCalendar();
  return {
    // "parcial", no "error": no hay nada roto por nuestra parte, la fuente no
    // existe. Marcarlo como error haría saltar la alerta de scraper averiado
    // todos los días y acabaríamos ignorando las alertas de verdad.
    status: 'parcial',
    itemsSeen: outcome.rowsSeen,
    note: outcome.unavailableReason,
  };
}

/**
 * Ranking nacional oficial de la RFEE.
 *
 * Fuente propia y no un apéndice de `skermo_rfee` por dos motivos: son 60
 * peticiones (una por arma × género × categoría) más las fichas de tirador, y
 * si Skermo va lento no puede arrastrar consigo al calendario, que es la
 * pantalla principal de la aplicación.
 *
 * No recalcula enlaces de eventos —no toca el calendario—, así que el runner
 * se salta ese paso para esta fuente.
 */
async function ingestRanking(runId: string): Promise<Dispatched> {
  const stats = await ingestRankingRfee(runId);
  return {
    status: stats.itemsSeen > 0 ? 'ok' : 'parcial',
    itemsSeen: stats.itemsSeen,
    itemsCreated: stats.itemsCreated,
    itemsUpdated: stats.itemsUpdated,
    itemsUnchanged: stats.itemsUnchanged,
    itemsQuarantined: stats.itemsQuarantined,
    note: stats.note,
  };
}

/**
 * Fichas de tirador de la FIE: foto enlazada y puesto mundial.
 *
 * Fuente propia y no un apéndice de `fie`, que ya trae el calendario, por dos
 * motivos. Uno: no produce eventos, así que el recálculo de duplicados entre
 * fuentes no tiene nada que hacer aquí (el runner se lo salta). Y dos: su
 * coste no depende de la FIE sino de NUESTROS tiradores —una petición para el
 * censo del país y una por tirador con ficha—, así que su presupuesto y su
 * horario de cron son distintos de los del calendario.
 */
async function ingestFichasFie(runId: string): Promise<Dispatched> {
  const stats = await ingestFieTiradores(runId);
  return {
    /**
     * "parcial" si no se enlazó a nadie: no hay nada roto —el censo se leyó—
     * pero tampoco hay nada que enseñar, y eso tiene que verse en el panel en
     * vez de pasar por un "ok" tranquilizador.
     */
    status: stats.enlazados > 0 ? 'ok' : 'parcial',
    itemsSeen: stats.itemsSeen,
    itemsCreated: stats.itemsCreated,
    itemsUpdated: stats.itemsUpdated,
    itemsUnchanged: stats.itemsUnchanged,
    itemsQuarantined: stats.itemsQuarantined,
    note: stats.note,
  };
}

async function ingestOfficialDocuments(): Promise<Dispatched> {
  const { candidates, rowsSeen } = await fetchOfficialDocuments();

  let created = 0;
  let updated = 0;
  let feeAlerts = 0;

  /**
   * RENDIMIENTO: esto era un bucle con un SELECT y un INSERT/UPDATE por
   * documento. Con los 278 documentos que hay hoy en la base son 556 viajes de
   * red a Neon (~60 ms cada uno medidos en local) = unos 33 s de pura espera
   * dentro de una función que muere a los 300 s, y creciendo con cada circular
   * que publique la RFEE. Ahora: una consulta para saber cuáles existen ya y
   * dos escrituras en lote.
   */
  if (candidates.length === 0) {
    return { status: 'ok', itemsSeen: rowsSeen, note: '0 documentos únicos' };
  }

  const yaExisten = new Set(
    (
      await db
        .select({ wpMediaId: officialDocument.wpMediaId })
        .from(officialDocument)
        .where(
          inArray(
            officialDocument.wpMediaId,
            candidates.map((d) => d.wpMediaId),
          ),
        )
    ).map((r) => r.wpMediaId),
  );

  const nuevos = candidates.filter((d) => !yaExisten.has(d.wpMediaId));

  for (const lote of chunk(candidates, 100)) {
    /**
     * `wp_media_id` es único, así que un solo INSERT ... ON CONFLICT hace de
     * alta y de actualización a la vez. Solo se refrescan título, URL y fecha:
     * `reviewedAt` y lo que haya marcado una persona no se pisa.
     */
    await db
      .insert(officialDocument)
      .values(
        lote.map((doc) => ({
          wpMediaId: doc.wpMediaId,
          title: doc.title,
          pdfUrl: doc.pdfUrl,
          publishedAt: doc.publishedAt,
          circularNumber: doc.circularNumber,
          seasonLabel: doc.seasonLabel,
          mentionsFees: doc.mentionsFees,
        })),
      )
      .onConflictDoUpdate({
        target: officialDocument.wpMediaId,
        set: {
          title: sql`excluded."title"`,
          pdfUrl: sql`excluded."pdf_url"`,
          publishedAt: sql`excluded."published_at"`,
        },
      });
  }

  created = nuevos.length;
  updated = candidates.length - nuevos.length;

  /**
   * Circular nueva que menciona recargos, plazos o categorías: se avisa al
   * admin para que revise si cambian los importes. No se actualiza nada solo
   * a escondidas; avisa, y decide una persona.
   */
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  const conRecargos = nuevos.filter((d) => d.mentionsFees);
  if (adminEmail && conRecargos.length > 0) {
    const queued = await db
      .insert(notification)
      .values(
        conRecargos.map((doc) => ({
          dedupeKey: `circular-fees:${doc.wpMediaId}`,
          toEmail: adminEmail,
          kind: 'circular_normativa',
          subject: `Circular nueva: ${doc.title}`,
          body:
            `Se ha publicado un documento oficial que menciona plazos, ` +
            `recargos o categorías:\n\n` +
            `${doc.title}\n${doc.pdfUrl}\n` +
            `Publicado el ${doc.publishedAt.toISOString().slice(0, 10)}.\n\n` +
            'Revisa si hay que actualizar las tablas de normativa ' +
            '(plazos y recargos, categorías de la temporada, coeficientes ' +
            'de ranking). La app no cambia ningún importe por su cuenta.\n',
        })),
      )
      .onConflictDoNothing({ target: notification.dedupeKey })
      .returning({ id: notification.id });
    feeAlerts = queued.length;
  }

  /**
   * VIGENCIA: qué circular manda y cuáles han quedado atrás.
   *
   * Va aquí y no en un cron aparte porque depende solo de los títulos y las
   * fechas que se acaban de escribir, así que es el único momento en que se
   * sabe que hace falta. Y no cuesta casi nada: es una lectura de las 278
   * filas, el cálculo entero en memoria (función pura, sin IA y sin descargas)
   * y dos escrituras en lote. Medido: 4 consultas y menos de un segundo.
   *
   * Si falla, la ingestión NO falla: las circulares ya están guardadas, que es
   * lo importante, y la pantalla sabe enseñarlas sin marcar mientras el
   * cálculo no esté. Mismo criterio que `recalcularEnlaces()`.
   */
  let notaVigencia = '';
  try {
    const v = await recalcularVigencia();
    notaVigencia =
      `, vigencia: ${v.vigentes} en vigor, ${v.superadas} superadas, ` +
      `${v.canceladas} canceladas, ${v.duplicadas} duplicadas en ${v.familias} familias`;
  } catch (error) {
    notaVigencia = `, vigencia sin recalcular (${
      error instanceof Error ? error.message : 'error'
    })`;
  }

  return {
    status: 'ok',
    itemsSeen: rowsSeen,
    itemsCreated: created,
    itemsUpdated: updated,
    notificationsQueued: feeAlerts,
    note: `${candidates.length} documentos únicos${notaVigencia}`,
  };
}

async function saveQuarantine(
  runId: string,
  source: IngestSource,
  items: { sourceId: string | null; raw: unknown; errors: unknown }[],
): Promise<number> {
  /**
   * RENDIMIENTO: en lote, no una fila por viaje de red. Cuando una fuente
   * cambia de formato la cuarentena no recibe dos filas, recibe TODAS las del
   * día (cientos), y es justo el día en que la función no se puede permitir
   * gastar un viaje a Neon por cada una.
   */
  /**
   * ===========================================================================
   * LO MISMO NO SE ENCUARENTENA DOS VECES
   * ===========================================================================
   *
   * Sin esto, cada pasada nocturna vuelve a meter las MISMAS filas, porque el
   * dato de origen sigue igual de mal. Resultado medido en la bandeja: 139
   * pendientes de las que 19 eran **el mismo torneo** —«Championnats
   * asiatiques cadets par equipes», con la fecha de fin anterior a la de
   * inicio— repetido una vez por noche, y otras treinta con dos y tres copias.
   *
   * Con la bandeja así no se revisa: hay que bajar veinte tarjetas idénticas
   * para llegar a la siguiente causa distinta, y el contador de pendientes
   * mide noches en vez de problemas.
   *
   * La clave es `source` + `source_id`, y se salta si ya hay una **sin
   * resolver**. Que no sea el error exacto es a propósito: si el mismo torneo
   * falla hoy por la fecha y mañana por la categoría, sigue siendo un torneo
   * que hay que mirar una vez. Y si alguien la marca revisada y la fila vuelve
   * a fallar, entra de nuevo, que es lo que se quiere: eso sí es información
   * nueva.
   */
  const yaPendientes = new Set(
    (
      await db
        .select({ sourceId: ingestQuarantine.sourceId })
        .from(ingestQuarantine)
        .where(
          and(eq(ingestQuarantine.source, source), isNull(ingestQuarantine.resolvedAt)),
        )
    ).map((f) => f.sourceId ?? ''),
  );

  const nuevos = items.filter((item) => !yaPendientes.has(item.sourceId ?? ''));
  if (nuevos.length === 0) return 0;

  for (const lote of chunk(nuevos, 100)) {
    await db.insert(ingestQuarantine).values(
      lote.map((item) => ({
        ingestRunId: runId,
        source,
        sourceId: item.sourceId,
        rawPayload: item.raw as never,
        validationErrors: item.errors as never,
      })),
    );
  }
  return nuevos.length;
}

/**
 * ===========================================================================
 * LO QUE YA ENTRA BIEN SE CAE DE LA CUARENTENA
 * ===========================================================================
 *
 * Esto faltaba, y era la otra mitad de `saveQuarantine`. Aquella evita meter
 * dos veces lo mismo; esta saca lo que ya está arreglado.
 *
 * El caso que lo destapó es real y es propio: la «1a Lliga Catalana Master»
 * se encuarentenó porque su categoría venía como `+30` y el mapeo no
 * entendía ese formato. Se arregló el mapeo, y desde entonces el torneo
 * **entra bien todas las noches**… con su ficha vieja de cuarentena todavía
 * sin resolver al lado. O sea: la bandeja de «esto no se ha podido leer»
 * enseñaba un torneo que sí está en el calendario, y la prueba que vigila
 * justo eso —que nada pendiente esté publicado— se puso roja.
 *
 * Y el daño no es la prueba: es que el contador de pendientes deja de
 * significar nada. Si la bandeja acumula problemas ya resueltos, nadie la
 * mira, y el día que entre uno de verdad se pierde entre los viejos. Es el
 * mismo motivo por el que se quitaron los duplicados.
 *
 * Se marca `resolvedAt`, no se borra la fila: queda el rastro de que aquello
 * falló, cuándo y por qué, que es lo que permite entender después por qué un
 * torneo apareció tarde.
 */
async function resolverCuarentena(
  source: IngestSource,
  eventos: { sourceId: string }[],
): Promise<void> {
  if (eventos.length === 0) return;

  const ids = [...new Set(eventos.map((e) => e.sourceId))];

  // En lotes, por el mismo motivo que el guardado: una fuente puede traer
  // cientos y no se gasta un viaje a Neon por cada una.
  for (const lote of chunk(ids, 200)) {
    await db
      .update(ingestQuarantine)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(ingestQuarantine.source, source),
          isNull(ingestQuarantine.resolvedAt),
          inArray(ingestQuarantine.sourceId, lote),
        ),
      );
  }
}

/**
 * Avisa al admin si la fuente falla DOS días seguidos.
 *
 * Un solo fallo puede ser un timeout tonto; dos seguidos es un scraper roto.
 * Avisar al primero enseña a la gente a ignorar los avisos.
 */
async function maybeAlertAdmin(source: IngestSource, error: string | null) {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail) return;

  const recent = await db
    .select({ status: ingestRun.status, startedAt: ingestRun.startedAt })
    .from(ingestRun)
    .where(eq(ingestRun.source, source))
    .orderBy(desc(ingestRun.startedAt))
    .limit(2);

  const consecutiveFailures = recent.filter((r) => r.status === 'error').length;
  if (consecutiveFailures < 2) return;

  const day = new Date().toISOString().slice(0, 10);
  await db
    .insert(notification)
    .values({
      dedupeKey: `ingest-failure:${source}:${day}`,
      toEmail: adminEmail,
      kind: 'scraper_roto',
      subject: `La ingestión de ${source} falla dos días seguidos`,
      body:
        `${SOURCE_DESCRIPTION[source]} ha fallado en las dos últimas ` +
        `ejecuciones.\n\nÚltimo error:\n${error ?? 'sin detalle'}\n\n` +
        'Mientras no se arregle, el calendario de esa fuente se queda con los ' +
        'datos del último día que funcionó, y la app lo avisa en pantalla.\n',
    })
    .onConflictDoNothing({ target: notification.dedupeKey });
}

/**
 * Estado de salud de las fuentes, para el panel de admin y para el aviso en la
 * interfaz cuando los datos tienen más de 48 horas. El silencio es el peor
 * fallo posible: si el calendario no se ha podido actualizar, se dice.
 */
export async function sourceHealth() {
  const rows = await db
    .select({
      source: ingestRun.source,
      status: ingestRun.status,
      startedAt: ingestRun.startedAt,
      finishedAt: ingestRun.finishedAt,
      itemsSeen: ingestRun.itemsSeen,
      itemsCreated: ingestRun.itemsCreated,
      itemsUpdated: ingestRun.itemsUpdated,
      itemsQuarantined: ingestRun.itemsQuarantined,
      error: ingestRun.error,
    })
    .from(ingestRun)
    .orderBy(desc(ingestRun.startedAt))
    .limit(200);

  const latestBySource = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestBySource.has(row.source)) latestBySource.set(row.source, row);
  }

  const now = Date.now();

  return INGEST_SOURCES.map((source) => {
    const latest = latestBySource.get(source);
    const ageHours = latest
      ? Math.floor((now - latest.startedAt.getTime()) / 3_600_000)
      : null;

    return {
      source,
      description: SOURCE_DESCRIPTION[source],
      latest: latest ?? null,
      ageHours,
      stale: ageHours === null || ageHours > 48,
    };
  });
}

/** Nº de filas en cuarentena sin resolver, por fuente. */
export async function openQuarantineCount() {
  return db
    .select({
      source: ingestQuarantine.source,
      count: sql<number>`count(*)::int`,
    })
    .from(ingestQuarantine)
    .where(isNull(ingestQuarantine.resolvedAt))
    .groupBy(ingestQuarantine.source);
}

/**
 * Contraste contra la fuente: compara cuántas competiciones tenemos en una
 * semana con las que publica el calendario oficial. Si no cuadra, es que el
 * parseo se está dejando filas, y eso hay que verlo antes que los usuarios.
 */
export async function countEventsBetween(from: string, to: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(event)
    .where(and(sql`${event.startDate} >= ${from}`, sql`${event.startDate} <= ${to}`));
  return row?.count ?? 0;
}

/**
 * Reúne de la base lo que necesita `tocaLeerRanking` y decide.
 *
 * Dos consultas y nada más, que con el driver HTTP de Neon cada una es un
 * viaje de red:
 *
 *  1. Cuándo se leyó el ranking con éxito por última vez.
 *  2. Las pruebas NACIONALES que han terminado hace poco.
 *
 * Solo cuentan las nacionales, y no es un atajo: el ranking de la RFEE lo
 * mueven las competiciones de la RFEE. Una Copa del Mundo en Takamatsu no
 * cambia el ranking nacional, así que despertar por ella sería descargar mil
 * doscientas filas para nada — y de internacionales hay 246 de los 274
 * eventos.
 *
 * Si algo de esto falla, **se lee**: quedarse con el ranking viejo por un
 * error de consulta sería el fallo peor, porque no se vería.
 */
async function decidirCadenciaRanking() {
  try {
    const [ultima] = await db
      .select({ finishedAt: ingestRun.finishedAt })
      .from(ingestRun)
      .where(
        and(
          eq(ingestRun.source, 'skermo_ranking'),
          eq(ingestRun.status, 'ok'),
          /**
           * Y que haya TERMINADO. Sin esto la cadencia no funcionaba nunca, y
           * de la forma más silenciosa posible: la fila de la ejecución en
           * curso se inserta con `finished_at` a null y con el estado `ok` por
           * defecto, y **Postgres ordena los nulos PRIMERO en un `DESC`**, así
           * que la consulta se encontraba a sí misma, leía `null` y decidía
           * «nunca se ha leído el ranking» → descargar. O sea, se seguía
           * descargando todas las noches y el registro decía que era la
           * primera vez. Visto ejecutando el cron dos veces seguidas.
           */
          isNotNull(ingestRun.finishedAt),
        ),
      )
      .orderBy(desc(ingestRun.finishedAt))
      .limit(1);

    const ventana = new Date(Date.now() - 8 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const fines = await db
      .select({ endDate: event.endDate })
      .from(event)
      .where(and(eq(event.scope, 'NACIONAL'), sql`${event.endDate} >= ${ventana}`));

    return tocaLeerRanking(
      new Date(),
      ultima?.finishedAt ?? null,
      fines.map((f) => new Date(`${f.endDate}T23:59:59Z`)),
    );
  } catch (error) {
    return {
      leer: true as const,
      motivo: 'primera_vez' as const,
      explicacion:
        'No se pudo comprobar la cadencia (' +
        (error instanceof Error ? error.message : 'error desconocido') +
        '), así que se lee: más vale gastar una descarga que dejar el ranking viejo.',
    };
  }
}
