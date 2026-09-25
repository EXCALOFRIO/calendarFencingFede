import { and, inArray, isNotNull, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { event, eventCompetition, eventLink } from '@/db/schema';
import { claveCiudad } from './ciudades';

/**
 * Emparejado de los dos registros del MISMO torneo internacional.
 *
 * El calendario recibe la misma competición dos veces: una por Skermo (el
 * calendario de la RFEE) y otra por la FIE, con nombres, idiomas y granularidad
 * distintos:
 *
 *   Skermo: «TORNEO SATÉLITE» · «GANTE»    · 2026-09-12 → 2026-09-13
 *   FIE:    «Gand Satellite Tournament»    · «Gand»     · 2026-09-12 → 2026-09-13
 *
 * Además la FIE publica una fila por prueba (espada femenina y sable masculino
 * son dos eventos suyos) mientras que Skermo publica una fila por torneo. Por
 * eso el enlace es de N filas de la FIE a 1 de Skermo, no 1 a 1.
 *
 * Resultado para el usuario: una sola tarjeta, con el nombre y las pruebas de
 * Skermo (que es lo que le vale a un español), el cartel, la sede y el huso de
 * la FIE, y los enlaces a las DOS fuentes.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ES TAN ESTRICTO
 *
 * Fundir dos torneos distintos es mucho peor que enseñar un duplicado. Un
 * duplicado se ve y molesta; una fusión equivocada enseña el cartel de Bogotá
 * en el torneo de Samsun y nadie se entera hasta que alguien coge un avión.
 *
 * Por eso hacen falta TRES coincidencias a la vez, y no vale cualquier par de
 * ellas:
 *
 *   1. Misma clave canónica de ciudad (ver `ciudades.ts`). Sin ciudad, o con
 *      la sede a «TBD», no se empareja nada.
 *   2. Las fechas se solapan.
 *   3. Las pruebas de la fila de la FIE están CONTENIDAS en las de la fila de
 *      Skermo (mismo arma, género, categoría y formato).
 *
 * La tercera es la que de verdad decide. En Samsun, el 24 de septiembre de
 * 2026, Skermo publica dos torneos a la vez en la misma ciudad y las mismas
 * fechas —la Copa del Mundo cadete y la júnior—; la ciudad y las fechas no los
 * distinguen, pero las pruebas sí: la fila FIE de florete masculino M17 solo
 * cabe en la cadete.
 *
 * Y si aun así quedan varios candidatos posibles, NO se une nada: la pareja se
 * guarda como `DUDOSO` para que la revise una persona.
 * ---------------------------------------------------------------------------
 */

/** La fuente que se absorbe. La que manda es siempre la española. */
const FUENTE_SECUNDARIA = 'fie';

export type ParEnlazado = {
  canonicalEventId: string;
  linkedEventId: string;
  cityKey: string;
  rule: string;
  /** Solo para el informe: no se guarda, se recalcula. */
  canonicalLabel: string;
  linkedLabel: string;
  /** El enlace hace que el evento principal gane un cartel que no tenía. */
  aportaCartel: boolean;
};

export type ParDudoso = {
  canonicalEventId: string;
  linkedEventId: string;
  cityKey: string;
  note: string;
  canonicalLabel: string;
  linkedLabel: string;
};

export type ResumenEnlaces = {
  /** Filas de la FIE absorbidas por un evento de Skermo. */
  enlazados: number;
  /** Eventos principales que quedan (tarjetas únicas con dos fuentes). */
  gruposConEnlace: number;
  /** Eventos que ganan cartel gracias al enlace. */
  cartelesHeredados: number;
  /** Candidatos que NO se han unido porque había más de una lectura posible. */
  dudosos: number;
  pares: ParEnlazado[];
  dudas: ParDudoso[];
  /** Decisiones que ha tomado una persona y el automatismo respeta. */
  confirmadosAMano: number;
  rechazadosAMano: number;
};

type FilaEvento = {
  id: string;
  source: string;
  name: string;
  city: string | null;
  country: string | null;
  startDate: string;
  endDate: string;
  imageUrl: string | null;
  cancelled: boolean;
};

/** «ESPADA-F-ABS-INDIVIDUAL». Es la identidad de una prueba entre fuentes. */
function clavePrueba(c: {
  weapon: string;
  gender: string;
  category: string;
  format: string;
}): string {
  return `${c.weapon}-${c.gender}-${c.category}-${c.format}`;
}

function etiqueta(e: FilaEvento): string {
  return `${e.name} · ${e.city ?? 'sin sede'} · ${e.startDate}→${e.endDate} [${e.source}]`;
}

/** ¿Se pisan los dos rangos de fechas, aunque sea un solo día? */
function solapan(a: FilaEvento, b: FilaEvento): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/**
 * Recalcula TODOS los enlaces desde cero y deja la base consistente.
 *
 * Es idempotente a propósito: se llama al final de cada ingestión y volver a
 * llamarla dos veces seguidas no cambia nada. No hay estado incremental que
 * se pueda desincronizar, y un dato corregido en la fuente deshace el enlace
 * solo en la siguiente pasada.
 *
 * Coste: tres lecturas y como mucho cuatro escrituras, todas en lote. El
 * driver de Neon es HTTP y cada consulta es una ida y vuelta, así que no hay
 * ni un SELECT por evento.
 */
export async function recalcularEnlaces(): Promise<ResumenEnlaces> {
  const ahora = new Date();

  const [eventos, pruebas, enlacesPrevios] = await Promise.all([
    db
      .select({
        id: event.id,
        source: event.source,
        name: event.name,
        city: event.city,
        country: event.country,
        startDate: event.startDate,
        endDate: event.endDate,
        imageUrl: event.imageUrl,
        cancelled: event.cancelled,
      })
      .from(event)
      .where(isNull(event.disappearedAt)),
    db
      .select({
        eventId: eventCompetition.eventId,
        weapon: eventCompetition.weapon,
        gender: eventCompetition.gender,
        category: eventCompetition.category,
        format: eventCompetition.format,
      })
      .from(eventCompetition),
    db
      .select({
        canonicalEventId: eventLink.canonicalEventId,
        linkedEventId: eventLink.linkedEventId,
        status: eventLink.status,
      })
      .from(eventLink),
  ]);

  const pruebasPorEvento = new Map<string, Set<string>>();
  for (const p of pruebas) {
    let set = pruebasPorEvento.get(p.eventId);
    if (!set) {
      set = new Set<string>();
      pruebasPorEvento.set(p.eventId, set);
    }
    set.add(clavePrueba(p));
  }

  /**
   * Lo que ha decidido una persona no se toca. `RECHAZADO` veta el par para
   * siempre; `CONFIRMADO` lo impone aunque el automatismo no llegue a él.
   */
  const vetados = new Set<string>();
  const impuestos = new Map<string, string>();
  let confirmadosAMano = 0;
  let rechazadosAMano = 0;
  for (const l of enlacesPrevios) {
    const par = `${l.canonicalEventId}|${l.linkedEventId}`;
    if (l.status === 'RECHAZADO') {
      vetados.add(par);
      rechazadosAMano += 1;
    } else if (l.status === 'CONFIRMADO') {
      impuestos.set(l.linkedEventId, l.canonicalEventId);
      confirmadosAMano += 1;
    }
  }

  const porId = new Map(eventos.map((e) => [e.id, e]));
  const secundarios = eventos.filter((e) => e.source === FUENTE_SECUNDARIA);
  const principales = eventos.filter((e) => e.source !== FUENTE_SECUNDARIA);

  /** Índice por clave de ciudad: sin esto esto sería 214 × 60 comparaciones. */
  const principalesPorCiudad = new Map<string, FilaEvento[]>();
  for (const p of principales) {
    const clave = claveCiudad(p.city);
    if (!clave) continue;
    const lista = principalesPorCiudad.get(clave) ?? [];
    lista.push(p);
    principalesPorCiudad.set(clave, lista);
  }

  const pares: ParEnlazado[] = [];
  const dudas: ParDudoso[] = [];

  for (const f of secundarios) {
    const clave = claveCiudad(f.city);
    // Sin sede publicada no hay nada que casar. La FIE tiene hoy 35 eventos
    // con la ciudad a «TBD»: tratarlos como una sede los fundiría entre sí.
    if (!clave) continue;

    const pruebasF = pruebasPorEvento.get(f.id);
    if (!pruebasF || pruebasF.size === 0) continue;

    const impuesto = impuestos.get(f.id);
    if (impuesto) {
      const p = porId.get(impuesto);
      if (p) {
        pares.push({
          canonicalEventId: p.id,
          linkedEventId: f.id,
          cityKey: clave,
          rule: 'confirmado a mano por un administrador',
          canonicalLabel: etiqueta(p),
          linkedLabel: etiqueta(f),
          aportaCartel: !p.imageUrl && !!f.imageUrl,
        });
      }
      continue;
    }

    let candidatos = (principalesPorCiudad.get(clave) ?? []).filter((p) => {
      if (vetados.has(`${p.id}|${f.id}`)) return false;
      if (!solapan(p, f)) return false;
      /**
       * Si las dos fuentes dan país y NO coinciden, no se une. Prefiero
       * perder un enlace legítimo por una errata de origen que fundir dos
       * ciudades homónimas de países distintos.
       */
      if (p.country && f.country && p.country !== f.country) return false;

      const pruebasP = pruebasPorEvento.get(p.id);
      if (!pruebasP || pruebasP.size === 0) return false;
      for (const prueba of pruebasF) if (!pruebasP.has(prueba)) return false;
      return true;
    });

    if (candidatos.length === 0) continue;

    let regla = 'ciudad canónica + solape de fechas + pruebas contenidas';

    /**
     * Desempate: si varios encajan, gana el que además cuadra en fechas
     * EXACTAS. Pasa en Šamorín el 19/09/2026, donde el satélite de la FIE
     * cabe tanto en el satélite de Skermo (mismo día) como en la Eurofence
     * League del fin de semana entero.
     */
    if (candidatos.length > 1) {
      const exactos = candidatos.filter(
        (p) => p.startDate === f.startDate && p.endDate === f.endDate,
      );
      if (exactos.length === 1) {
        candidatos = exactos;
        regla += ' + fechas exactas (desempate)';
      }
    }

    if (candidatos.length > 1) {
      // Ante la duda, no se une NADA. Se deja constancia para que lo mire una
      // persona, que es la única que puede resolverlo sin inventar.
      for (const p of candidatos) {
        dudas.push({
          canonicalEventId: p.id,
          linkedEventId: f.id,
          cityKey: clave,
          note: `${candidatos.length} eventos de Skermo encajan con la misma fila de la FIE; no se une ninguno`,
          canonicalLabel: etiqueta(p),
          linkedLabel: etiqueta(f),
        });
      }
      continue;
    }

    const p = candidatos[0];
    pares.push({
      canonicalEventId: p.id,
      linkedEventId: f.id,
      cityKey: clave,
      rule: regla,
      canonicalLabel: etiqueta(p),
      linkedLabel: etiqueta(f),
      aportaCartel: !p.imageUrl && !!f.imageUrl,
    });
  }

  await guardarEnlaces(pares, dudas, ahora);

  const principalesConCartelHeredado = new Set(
    pares.filter((p) => p.aportaCartel).map((p) => p.canonicalEventId),
  );

  return {
    enlazados: pares.length,
    gruposConEnlace: new Set(pares.map((p) => p.canonicalEventId)).size,
    cartelesHeredados: principalesConCartelHeredado.size,
    dudosos: dudas.length,
    pares,
    dudas,
    confirmadosAMano,
    rechazadosAMano,
  };
}

/** Trocea para escribir en lote: un INSERT gigante tampoco es buena idea. */
function trocear<T>(items: T[], tam: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += tam) out.push(items.slice(i, i + tam));
  return out;
}

async function guardarEnlaces(
  pares: ParEnlazado[],
  dudas: ParDudoso[],
  ahora: Date,
): Promise<void> {
  const filas = [
    ...pares.map((p) => ({
      canonicalEventId: p.canonicalEventId,
      linkedEventId: p.linkedEventId,
      status: 'AUTOMATICO' as const,
      cityKey: p.cityKey,
      rule: p.rule,
      note: null,
      updatedAt: ahora,
    })),
    ...dudas.map((d) => ({
      canonicalEventId: d.canonicalEventId,
      linkedEventId: d.linkedEventId,
      status: 'DUDOSO' as const,
      cityKey: d.cityKey,
      rule: 'candidato ambiguo, sin unir',
      note: d.note,
      updatedAt: ahora,
    })),
  ];

  for (const lote of trocear(filas, 100)) {
    await db
      .insert(eventLink)
      .values(lote)
      .onConflictDoUpdate({
        target: [eventLink.canonicalEventId, eventLink.linkedEventId],
        /**
         * Una fila decidida a mano no se pisa: si el admin confirmó o rechazó
         * el par, su palabra sobrevive a la siguiente ingestión.
         */
        setWhere: sql`${eventLink.status} in ('AUTOMATICO','DUDOSO')`,
        set: {
          status: sql`excluded."status"`,
          cityKey: sql`excluded."city_key"`,
          rule: sql`excluded."rule"`,
          note: sql`excluded."note"`,
          updatedAt: sql`excluded."updated_at"`,
        },
      });
  }

  /**
   * Lo que el emparejador proponía antes y ya no propone se borra. Así un
   * torneo que cambia de sede en la fuente deja de estar unido solo, sin que
   * nadie tenga que acordarse de limpiarlo.
   */
  await db
    .delete(eventLink)
    .where(
      and(
        inArray(eventLink.status, ['AUTOMATICO', 'DUDOSO']),
        lt(eventLink.updatedAt, ahora),
      ),
    );

  // --- Y ahora la columna denormalizada que consulta el calendario ---------

  const idsEnlazados = pares.map((p) => p.linkedEventId);

  /**
   * Un solo UPDATE con la lista de pares como tabla de valores. La
   * alternativa (un UPDATE por evento) serían decenas de viajes de red a Neon
   * dentro de una función que muere a los 300 s.
   */
  for (const lote of trocear(pares, 200)) {
    const valores = sql.join(
      lote.map((p) => sql`(${p.linkedEventId}::uuid, ${p.canonicalEventId}::uuid)`),
      sql`, `,
    );
    await db.execute(sql`
      update ${event} as e
      set canonical_event_id = v.canon
      from (values ${valores}) as v(linked, canon)
      where e.id = v.linked
        and e.canonical_event_id is distinct from v.canon
    `);
  }

  await db
    .update(event)
    .set({ canonicalEventId: null })
    .where(
      idsEnlazados.length > 0
        ? and(
            isNotNull(event.canonicalEventId),
            notInArray(event.id, idsEnlazados),
          )
        : isNotNull(event.canonicalEventId),
    );
}

/**
 * Los enlaces tal y como están guardados, para el panel de admin.
 *
 * Trae las dos filas del par ya resueltas: sin esto la pantalla de revisión
 * tendría que pedir cada evento por separado, que con el driver HTTP son dos
 * viajes de red por fila.
 */
export async function listarEnlaces(
  estados?: ('AUTOMATICO' | 'DUDOSO' | 'CONFIRMADO' | 'RECHAZADO')[],
) {
  const condiciones = estados?.length
    ? inArray(eventLink.status, estados)
    : inArray(eventLink.status, ['AUTOMATICO', 'DUDOSO']);

  const filas = await db
    .select({
      id: eventLink.id,
      status: eventLink.status,
      cityKey: eventLink.cityKey,
      rule: eventLink.rule,
      note: eventLink.note,
      updatedAt: eventLink.updatedAt,
      canonicalEventId: eventLink.canonicalEventId,
      linkedEventId: eventLink.linkedEventId,
    })
    .from(eventLink)
    .where(condiciones);

  if (filas.length === 0) return [];

  const ids = [
    ...new Set(filas.flatMap((f) => [f.canonicalEventId, f.linkedEventId])),
  ];

  const eventos = await db
    .select({
      id: event.id,
      source: event.source,
      name: event.name,
      city: event.city,
      startDate: event.startDate,
      endDate: event.endDate,
      imageUrl: event.imageUrl,
      sourceUrl: event.sourceUrl,
    })
    .from(event)
    .where(inArray(event.id, ids));

  const porId = new Map(eventos.map((e) => [e.id, e]));

  return filas.map((f) => ({
    ...f,
    canonical: porId.get(f.canonicalEventId) ?? null,
    linked: porId.get(f.linkedEventId) ?? null,
  }));
}
