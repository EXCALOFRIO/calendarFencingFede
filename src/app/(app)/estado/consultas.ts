import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  event,
  eventCompetition,
  eventDeadline,
  officialRankingEntry,
  rankingPoint,
  rankingSnapshot,
  season,
} from '@/db/schema';
import type { Weapon } from '@/lib/auth/session';
import type { CategoryCode } from '@/lib/categories';
import {
  type ComputedDeadline,
  type DeadlineStatus,
  computeDeadlines,
  deadlineStatus,
  mergeDeadlines,
} from '@/lib/deadlines';
import { getDeadlineRules } from '@/lib/queries/calendar';
import type { EstadoLista } from '@/lib/entries/lectura';
import {
  type FilaPropia,
  resumirParaMiEstado,
  torneosSinLeer,
  unirResumenes,
} from '@/lib/entries/resumen-mi-estado';
import { inscritosUnidosDeTorneos, tarjetasConAtletas } from '@/lib/queries/inscritos-union';
import { getRankingSeason } from '@/lib/queries/ranking';
import {
  type CutoffStatus,
  cutoffStatus,
  loadRankingRules,
  pickRule,
} from '@/lib/ranking/compute';
import { type EstadoOficial, estadoDeListaOficial } from './oficial';

/**
 * Lee la lista unida de unos torneos y conserva sólo lo que «Mi estado» usa:
 * la unión (con sus observaciones por fila) no sale de esta función.
 */
async function leerResumen(torneos: string[], propios: ReadonlySet<string>) {
  const { filas, estados } = await inscritosUnidosDeTorneos(torneos);
  return { resumen: resumirParaMiEstado(filas, propios), estados };
}

/**
 * ===========================================================================
 * LO QUE «MI ESTADO» PREGUNTA A LA BASE
 * ===========================================================================
 *
 * La pantalla dejó de ser el seguimiento de un trámite y pasa a contestar tres
 * preguntas, y cada consulta de aquí sirve a una:
 *
 *   1. ¿Estoy dentro?   →  `getPruebasPropias`, columna `oficial`
 *   2. ¿Cuánto me queda? →  `getPruebasPropias`, columnas `plazos` y `estado`
 *   3. ¿Cómo voy?        →  `getCortesOficiales` + `getPuestosDeTemporada`
 *
 * La primera es la que cambió de fuente, y ese es el cambio importante: antes
 * se contestaba con NUESTRAS solicitudes (`entry`) y ahora con la **lista que
 * publica la organización** (`competition_registration`). Es lo que pidió el
 * usuario con estas palabras: *«que pueda recuperar si estás o no ya inscrito,
 * porque igual le ha inscrito otra persona»*. Una solicitud esperando a que
 * alguien la valide no es estar dentro, y presentarla como tal es cómo alguien
 * viaja creyendo que compite.
 */

export type PuestoTemporada = {
  athleteId: string;
  weapon: 'FLORETE' | 'ESPADA' | 'SABLE';
  gender: 'M' | 'F' | 'MIXTO';
  category: string;
  position: number;
  totalPoints: number;
  /** Cuántas pruebas se le han contado para ese total. */
  pruebasContadas: number;
  /** Puestos ganados (+) o perdidos (−) desde el cálculo anterior. `null` si
   *  no hay un cálculo anterior con el que comparar, que no es lo mismo que
   *  "no se ha movido". */
  variacion: number | null;
  calculadoEl: Date;
};

/** Puntos que dejó una prueba concreta en el ranking de un tirador. */
export type PuntosDePrueba = {
  position: number;
  finalPoints: number;
  /** Si entra en las mejores N que cuentan para el total de la temporada. */
  cuenta: boolean;
  explicacion: string | null;
};

/** Las dos últimas fechas de cálculo de la temporada en curso. */
async function ultimosCalculos(seasonId: string): Promise<(Date | null)[]> {
  const filas = await db
    .selectDistinct({ computedAt: rankingSnapshot.computedAt })
    .from(rankingSnapshot)
    .where(eq(rankingSnapshot.seasonId, seasonId))
    .orderBy(desc(rankingSnapshot.computedAt))
    .limit(2);
  return [filas[0]?.computedAt ?? null, filas[1]?.computedAt ?? null];
}

/**
 * Puesto y puntos de cada tirador de la cuenta, en cada ranking en el que
 * aparezca (un M17 puede estar en el suyo y en el absoluto).
 */
export async function getPuestosDeTemporada(
  armas: readonly Weapon[],
  athleteIds: string[],
): Promise<PuestoTemporada[]> {
  if (athleteIds.length === 0 || armas.length === 0) return [];

  const [temporada] = await db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.current, true))
    .limit(1);
  if (!temporada) return [];

  const [ultimo, anterior] = await ultimosCalculos(temporada.id);
  if (!ultimo) return [];

  const [actuales, previos] = await Promise.all([
    db
      .select({
        athleteId: rankingSnapshot.athleteId,
        weapon: rankingSnapshot.weapon,
        gender: rankingSnapshot.gender,
        category: rankingSnapshot.category,
        position: rankingSnapshot.position,
        totalPoints: rankingSnapshot.totalPoints,
        countedEventIds: rankingSnapshot.countedEventIds,
      })
      .from(rankingSnapshot)
      .where(
        and(
          eq(rankingSnapshot.seasonId, temporada.id),
          eq(rankingSnapshot.computedAt, ultimo),
          inArray(rankingSnapshot.athleteId, athleteIds),
          inArray(rankingSnapshot.weapon, [...armas]),
        ),
      ),
    anterior
      ? db
          .select({
            athleteId: rankingSnapshot.athleteId,
            weapon: rankingSnapshot.weapon,
            gender: rankingSnapshot.gender,
            category: rankingSnapshot.category,
            position: rankingSnapshot.position,
          })
          .from(rankingSnapshot)
          .where(
            and(
              eq(rankingSnapshot.seasonId, temporada.id),
              eq(rankingSnapshot.computedAt, anterior),
              inArray(rankingSnapshot.athleteId, athleteIds),
              inArray(rankingSnapshot.weapon, [...armas]),
            ),
          )
      : Promise.resolve([]),
  ]);

  const clave = (r: {
    athleteId: string;
    weapon: string;
    gender: string;
    category: string;
  }) => `${r.athleteId}|${r.weapon}|${r.gender}|${r.category}`;

  const antes = new Map(previos.map((p) => [clave(p), p.position]));

  return actuales
    .map((r) => {
      const previa = antes.get(clave(r));
      return {
        athleteId: r.athleteId,
        weapon: r.weapon,
        gender: r.gender,
        category: r.category,
        position: r.position,
        totalPoints: Number.parseFloat(r.totalPoints),
        pruebasContadas: Array.isArray(r.countedEventIds)
          ? r.countedEventIds.length
          : 0,
        // Subir en el ranking es bajar de número: se invierte el signo para
        // que "+2" signifique lo que la gente espera.
        variacion: previa === undefined ? null : previa - r.position,
        calculadoEl: ultimo,
      };
    })
    .sort((a, b) => a.position - b.position);
}

/**
 * Puntos que sacó cada tirador en cada prueba, indexados por
 * `athleteId|eventCompetitionId`. Es lo que permite cerrar el círculo en una
 * competición ya celebrada: qué puesto hizo y qué le dejó en el ranking.
 */
export async function getPuntosPorPrueba(
  armas: readonly Weapon[],
  athleteIds: string[],
): Promise<Record<string, PuntosDePrueba>> {
  if (athleteIds.length === 0 || armas.length === 0) return {};

  const filas = await db
    .select({
      athleteId: rankingPoint.athleteId,
      eventCompetitionId: rankingPoint.eventCompetitionId,
      position: rankingPoint.position,
      finalPoints: rankingPoint.finalPoints,
      counted: rankingPoint.counted,
      explanation: rankingPoint.explanation,
    })
    .from(rankingPoint)
    .innerJoin(
      eventCompetition,
      eq(eventCompetition.id, rankingPoint.eventCompetitionId),
    )
    .where(
      and(
        inArray(rankingPoint.athleteId, athleteIds),
        inArray(eventCompetition.weapon, [...armas]),
      ),
    );

  const salida: Record<string, PuntosDePrueba> = {};
  for (const f of filas) {
    salida[`${f.athleteId}|${f.eventCompetitionId}`] = {
      position: f.position,
      finalPoints: Number.parseFloat(f.finalPoints),
      cuenta: f.counted === '1',
      explicacion: f.explanation,
    };
  }
  return salida;
}

// --------------------------------------------- 1 y 2: ¿estoy dentro y cuánto queda ---

export type { EstadoOficial } from './oficial';

/** Lo que la lista oficial dice de una prueba, con su procedencia. */
export type ListaOficial = {
  estado: EstadoOficial;
  /** Cuántos inscritos publica la fuente en esa prueba. */
  publicados: number;
  /** Código de equipo cuando la prueba es por equipos. */
  equipo: string | null;
  sourceUrl: string | null;
  leidoEl: Date | null;
};

/**
 * Una prueba que le importa a uno de mis tiradores, con su plazo y con lo que
 * dice de él la lista oficial.
 *
 * Es UNA sola lista a propósito. Antes eran dos secciones —«lo que ya has
 * pedido» y «todavía no te has inscrito»— y las dos hablaban del mismo objeto,
 * una competición, con la diferencia de si había un trámite abierto en medio.
 * Sin trámite, la diferencia desaparece y quedan dos preguntas que se contestan
 * en la misma fila: ¿estoy dentro? y ¿cuánto me queda?
 */
export type PruebaPropia = {
  clave: string;
  athleteId: string;
  athleteName: string;
  competitionId: string;
  eventId: string;
  eventName: string;
  startDate: string;
  endDate: string;
  city: string | null;
  country: string | null;
  venue: string | null;
  circuit: string | null;
  weapon: 'FLORETE' | 'ESPADA' | 'SABLE';
  gender: 'M' | 'F' | 'MIXTO';
  category: string;
  format: 'INDIVIDUAL' | 'EQUIPOS';
  feeEur: string | null;
  /** Horarios del día, cuando la organización los publica. */
  installationOpen: string | null;
  callTime: string | null;
  scratchTime: string | null;
  startTime: string | null;
  plazos: ComputedDeadline[];
  estado: DeadlineStatus;
  oficial: ListaOficial;
};

/** Lo que hay que saber de un tirador para decidir qué le corresponde. */
export type TiradorElegibilidad = {
  id: string;
  fullName: string;
  gender: 'M' | 'F' | 'MIXTO';
  weapons: ('FLORETE' | 'ESPADA' | 'SABLE')[];
  eligibleCategories: string[];
};

/**
 * Las pruebas de las que este tirador tiene algo que saber.
 *
 * Entra una prueba si cumple UNA de las dos:
 *
 *  - **Está dentro de la lista oficial.** Manda sobre todo lo demás, y entra
 *    aunque sea por equipos o de una categoría que no le tocaría: si la
 *    organización dice que compite, compite.
 *  - **Le corresponde y el plazo sigue abierto.** Su arma, su género y las
 *    categorías que le derivó `deriveCategories`, o sea exactamente la misma
 *    regla que aplica la ficha del calendario. Individuales solo: a una prueba
 *    por equipos no se apunta uno solo.
 *
 * Y lo que NO entra: una prueba cerrada en la que no está. Ahí ya no hay
 * decisión que tomar y una fila que solo dice «se te pasó» no ayuda a nadie a
 * planificarse.
 */
export async function getPruebasPropias(
  tiradores: TiradorElegibilidad[],
  /**
   * Cuántas devolver.
   *
   * Cinco, y está medido: con ocho, la sección medía sola 2.400 px en un iPhone
   * porque cada fila lleva su barra de tramos. De un vistazo son las que antes
   * cierran, no un segundo calendario; para el resto está el calendario, que
   * es la pantalla principal y tiene un enlace en la cabecera de la sección.
   */
  tope = 5,
): Promise<PruebaPropia[]> {
  if (tiradores.length === 0) return [];

  const ids = tiradores.map((t) => t.id);
  const hoy = new Date().toISOString().slice(0, 10);
  const conArma = tiradores.filter(
    (t) => t.weapons.length > 0 && t.eligibleCategories.length > 0,
  );
  const armas = [...new Set(conArma.flatMap((t) => t.weapons))];
  const categorias = [...new Set(conArma.flatMap((t) => t.eligibleCategories))];

  /**
   * Las filas de la lista oficial que son MÍAS, primero y por separado.
   *
   * Van en su propia consulta porque determinan qué competiciones hay que
   * traer: una prueba en la que figuro entra en la pantalla aunque no cumpla
   * ninguna regla de elegibilidad.
   */
  /**
   * Primero, en qué torneos figura alguno de mis tiradores en cualquiera de las
   * listas; luego se unen las listas de esos torneos. Así una inscripción que
   * sólo publica la FIE, colgada del par absorbido del torneo, también cuenta.
   */
  const tarjetasConMia = await tarjetasConAtletas(ids, hoy);

  const propios = new Set(ids);
  const primera = await leerResumen(tarjetasConMia, propios);
  const mias = primera.resumen.mias;

  const idsConMia = [...new Set(mias.map((m) => m.competitionId))];

  if (conArma.length === 0 && idsConMia.length === 0) return [];

  /**
   * Candidatas: lo elegible con el torneo por delante, más las pruebas en las
   * que ya figuro. `or` en lugar de dos consultas porque el resto del trabajo
   * —plazos, recuentos— se hace sobre el conjunto entero.
   *
   * Las dos mitades se arman con `inArray`/`or` de Drizzle y no con un `sql`
   * en crudo a propósito: una lista de identificadores interpolada a mano en
   * una plantilla es la forma de dejar un agujero de inyección, y además
   * Drizzle ya sabe parametrizar `in`.
   */
  const condiciones = [
    gte(event.startDate, hoy),
    eq(event.cancelled, false),
    isNull(event.disappearedAt),
    // El registro absorbido de la FIE es el MISMO torneo que ya sale por
    // Skermo: contarlo otra vez duplicaría la fila en la lista.
    isNull(event.canonicalEventId),
  ];

  const elegible =
    armas.length > 0 && categorias.length > 0
      ? and(
          eq(eventCompetition.format, 'INDIVIDUAL'),
          inArray(eventCompetition.weapon, armas),
          inArray(eventCompetition.category, categorias as CategoryCode[]),
        )
      : undefined;

  const candidatas = await db
    .select({
      competitionId: eventCompetition.id,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      format: eventCompetition.format,
      feeEur: eventCompetition.feeEur,
      installationOpen: eventCompetition.installationOpen,
      callTime: eventCompetition.callTime,
      scratchTime: eventCompetition.scratchTime,
      startTime: eventCompetition.startTime,
      eventId: event.id,
      eventName: event.name,
      startDate: event.startDate,
      endDate: event.endDate,
      city: event.city,
      country: event.country,
      venue: event.venue,
      circuit: event.circuit,
      scope: event.scope,
    })
    .from(eventCompetition)
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(
      and(
        ...condiciones,
        or(
          elegible,
          idsConMia.length > 0
            ? inArray(eventCompetition.id, idsConMia)
            : undefined,
        ),
      ),
    );

  if (candidatas.length === 0) return [];

  const idsCandidatas = candidatas.map((c) => c.competitionId);

  const [publicados, reglas] = await Promise.all([
    db
      .select()
      .from(eventDeadline)
      .where(inArray(eventDeadline.eventCompetitionId, idsCandidatas)),
    getDeadlineRules(),
  ]);

  const plazosPorPrueba = new Map<string, ComputedDeadline[]>();
  for (const d of publicados) {
    if (!d.eventCompetitionId) continue;
    const lista = plazosPorPrueba.get(d.eventCompetitionId) ?? [];
    lista.push({
      type: d.type,
      label: d.type === 'L1' ? 'Cierre de inscripción' : `Plazo ${d.type}`,
      deadlineAt: d.deadlineAt,
      surchargeEur: d.surchargeEur,
      blocking: d.blocking,
      origin: d.origin,
      sourceDocument: d.sourceDocument,
      sourceUrl: d.sourceUrl,
    });
    plazosPorPrueba.set(d.eventCompetitionId, lista);
  }

  const miaPorClave = new Map(
    mias.map((m) => [`${m.athleteId}|${m.competitionId}`, m]),
  );

  const ahora = new Date();
  const salida: Provisional[] = [];

  for (const c of candidatas) {
    const plazos = mergeDeadlines(
      plazosPorPrueba.get(c.competitionId) ?? [],
      computeDeadlines(c.startDate, reglas, {
        scope: c.scope as 'NACIONAL' | 'INTERNACIONAL' | 'AUTONOMICO',
        circuit: c.circuit,
        category: c.category as CategoryCode,
        format: c.format,
      }),
    );
    const estado = deadlineStatus(plazos, ahora);

    for (const t of tiradores) {
      const mia = miaPorClave.get(`${t.id}|${c.competitionId}`);
      const dentro = Boolean(mia);

      if (!dentro) {
        // Sin estar dentro, la fila solo aporta si todavía se puede decidir.
        if (estado.closed || estado.daysLeft === null) continue;
        if (c.format !== 'INDIVIDUAL') continue;
        if (!t.weapons.includes(c.weapon)) continue;
        if (t.gender !== 'MIXTO' && c.gender !== t.gender) continue;
        if (!t.eligibleCategories.includes(c.category)) continue;
      }

      salida.push({
        clave: `${t.id}|${c.competitionId}`,
        athleteId: t.id,
        athleteName: t.fullName,
        competitionId: c.competitionId,
        eventId: c.eventId,
        eventName: c.eventName,
        startDate: c.startDate,
        endDate: c.endDate,
        city: c.city,
        country: c.country,
        venue: c.venue,
        circuit: c.circuit,
        weapon: c.weapon,
        gender: c.gender,
        category: c.category,
        format: c.format,
        feeEur: c.feeEur,
        installationOpen: c.installationOpen,
        callTime: c.callTime,
        scratchTime: c.scratchTime,
        startTime: c.startTime,
        plazos,
        estado,
        dentro,
        mia,
      });
    }
  }

  /**
   * Orden: primero lo confirmado y por fecha de competición, después lo que
   * antes cierra. Es el único orden que sirve para decidir: lo que ya está
   * cerrado en tu favor se mira por calendario, y lo que no, por urgencia.
   * No depende de los recuentos de la lista, por eso éstos se leen después.
   */
  const elegidas = salida
    .sort((a, b) => {
      const aDentro = a.dentro ? 0 : 1;
      const bDentro = b.dentro ? 0 : 1;
      if (aDentro !== bDentro) return aDentro - bDentro;
      if (aDentro === 0) return a.startDate.localeCompare(b.startDate);
      return (
        (a.estado.daysLeft ?? 9_999) - (b.estado.daysLeft ?? 9_999) ||
        a.startDate.localeCompare(b.startDate) ||
        a.eventName.localeCompare(b.eventName, 'es')
      );
    })
    .slice(0, tope);

  /**
   * Cuántos inscritos publica la fuente en cada prueba que se va a enseñar.
   *
   * Hace falta para distinguir «la fuente no ha publicado la lista» de «la ha
   * publicado y no sabemos emparejarte». Sólo se leen los torneos de las filas
   * que salen (`tope`), no los de todas las candidatas, y los que ya se
   * leyeron arriba para saber quién está dentro no se repiten.
   */
  const pendientesDeLeer = torneosSinLeer(
    elegidas.map((e) => e.eventId),
    new Set(tarjetasConMia),
  );
  const segunda =
    pendientesDeLeer.length > 0
      ? await leerResumen(pendientesDeLeer, propios)
      : { resumen: { mias: [], recuentos: new Map() }, estados: {} };
  const { recuentos } = unirResumenes(primera.resumen, segunda.resumen);
  const estadosDeLista: Record<string, EstadoLista> = {
    ...primera.estados,
    ...segunda.estados,
  };

  return elegidas.map(({ dentro, mia, ...resto }) => {
    const recuento = recuentos.get(resto.competitionId) ?? null;
    const publicados = recuento?.n ?? 0;
    return {
      ...resto,
      oficial: {
        estado: estadoDeListaOficial({
          emparejado: dentro,
          publicados,
          lista: estadosDeLista[resto.competitionId],
        }),
        publicados,
        equipo: mia?.equipo && mia.equipo !== '' ? mia.equipo : null,
        sourceUrl: mia?.sourceUrl ?? recuento?.sourceUrl ?? null,
        leidoEl: mia?.leidoEl ?? recuento?.leidoEl ?? null,
      },
    };
  });
}

/** Una fila ya filtrada y ordenable, a la que aún le falta el recuento de la lista. */
type Provisional = Omit<PruebaPropia, 'oficial'> & {
  dentro: boolean;
  mia: FilaPropia | undefined;
};

// ------------------------------------------------------ 3: ¿a cuánto del corte ---

/** A cuánto del corte de convocatoria está uno de mis tiradores. */
export type CortePropio = {
  athleteId: string;
  weapon: 'FLORETE' | 'ESPADA' | 'SABLE';
  gender: 'M' | 'F' | 'MIXTO';
  category: string;
  corte: CutoffStatus;
};

/**
 * «¿A cuántos puntos estoy del corte?», que es lo que faltaba aquí.
 *
 * El dato existía y se enseñaba en `/ranking`, pero no en «Mi estado», que es
 * donde entra un tirador —o su padre— a ver cómo va. Es de los que más importan
 * porque es el único que convierte un puesto en una decisión: a dos puntos del
 * corte se va al siguiente torneo, a doscientos se planifica la temporada.
 *
 * La regla NO se reescribe: se llama a `cutoffStatus` de `lib/ranking/compute`,
 * la misma función que usa la pantalla de ranking, con las mismas plazas de la
 * misma normativa. Lo único propio de aquí es traerse solo los grupos de MIS
 * tiradores en vez de la clasificación entera: son uno o dos grupos frente a
 * 1.235 filas.
 *
 * Y se mide sobre el ranking OFICIAL, no sobre el cálculo interno: el corte de
 * convocatoria lo decide la clasificación de la federación.
 */
export async function getCortesOficiales(
  athleteIds: string[],
): Promise<CortePropio[]> {
  if (athleteIds.length === 0) return [];

  const mios = await db
    .select({
      athleteId: officialRankingEntry.athleteId,
      seasonLabel: officialRankingEntry.seasonLabel,
      weapon: officialRankingEntry.weapon,
      gender: officialRankingEntry.gender,
      category: officialRankingEntry.category,
      position: officialRankingEntry.position,
    })
    .from(officialRankingEntry)
    .where(inArray(officialRankingEntry.athleteId, athleteIds));

  const clasificados = mios.filter((m) => m.position !== null);
  if (clasificados.length === 0) return [];

  // Solo la temporada más reciente que trae la fuente: mezclar dos pondría a
  // la misma persona dos veces con puestos distintos.
  const vigente = [...new Set(clasificados.map((m) => m.seasonLabel))]
    .sort()
    .at(-1);
  if (!vigente) return [];

  const grupos = [
    ...new Map(
      clasificados
        .filter((m) => m.seasonLabel === vigente)
        .map((m) => [
          `${m.weapon}|${m.gender}|${m.category}`,
          { weapon: m.weapon, gender: m.gender, category: m.category },
        ]),
    ).values(),
  ];

  const temporada = await getRankingSeason();
  const { rules } = temporada
    ? await loadRankingRules(temporada.id)
    : { rules: [] };

  const salida: CortePropio[] = [];

  for (const grupo of grupos) {
    const regla = pickRule(rules, grupo.weapon, grupo.category);
    // Sin normativa cargada no se puede decir dónde está el corte, y una cifra
    // sin norma detrás no vale nada.
    if (!regla) continue;

    const filas = await db
      .select({
        id: officialRankingEntry.id,
        athleteId: officialRankingEntry.athleteId,
        position: officialRankingEntry.position,
        totalPoints: officialRankingEntry.totalPoints,
      })
      .from(officialRankingEntry)
      .where(
        and(
          eq(officialRankingEntry.seasonLabel, vigente),
          eq(officialRankingEntry.weapon, grupo.weapon),
          eq(officialRankingEntry.gender, grupo.gender),
          eq(officialRankingEntry.category, grupo.category),
        ),
      )
      .orderBy(asc(officialRankingEntry.position));

    /**
     * Igual que en `getRankingOficialScreenData`: solo los CLASIFICADOS entran
     * en la comparación, y las filas sin ficha usan su propio id como clave
     * para no perder a nadie del recuento. Un ranking al que le faltan los
     * rivales sin ficha daría una distancia al corte falsamente corta.
     */
    const comparables = filas
      .filter((f) => f.position !== null)
      .map((f) => ({
        athleteId: f.athleteId ?? f.id,
        position: f.position as number,
        totalPoints: f.totalPoints === null ? 0 : Number.parseFloat(f.totalPoints),
      }));

    for (const id of athleteIds) {
      const corte = cutoffStatus(comparables, id, {
        rankingPlaces: regla.rankingPlaces,
        technicalPlaces: regla.technicalPlaces,
        cutoffDate: regla.cutoffDate,
      });
      if (corte) {
        salida.push({
          athleteId: id,
          weapon: grupo.weapon,
          gender: grupo.gender,
          category: grupo.category,
          corte,
        });
      }
    }
  }

  return salida;
}
