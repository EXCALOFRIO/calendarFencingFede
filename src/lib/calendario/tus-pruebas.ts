import type { EntryStatus } from '@/lib/entries/state-machine';
import type { CompetitionView, EventView } from '@/lib/queries/calendar';
import { rotuloPrueba } from '@/lib/sport/rotulos';

/**
 * ===========================================================================
 * «TUS PRUEBAS»: QUÉ LE TOCA A ESTA CUENTA
 * ===========================================================================
 *
 * La franja que va encima del listado del calendario y responde «¿qué me toca
 * a mí?» sin hacer una consulta nueva: trabaja sobre lo que la pantalla ya
 * cargó —los eventos de la temporada, los tiradores vinculados y sus
 * solicitudes—, así que es una función pura y se prueba sin navegador
 * (`tests/tus-pruebas.test.ts`).
 *
 * Tres clases de fila:
 *
 *  - `inscrito`: competición donde un tirador de la cuenta ya pidió estar,
 *    con el estado de su solicitud («Enviada / confirmada»…);
 *  - `plazo`:   prueba que le toca a alguno y cuya inscripción cierra pronto;
 *  - `proxima`: cuando no hay solicitudes en absoluto, las próximas pruebas
 *    de su arma y categoría, por fecha.
 */

/** Lo que hace falta de un tirador de la cuenta para decidir lo suyo. */
export type TiradorDeCuenta = {
  id: string;
  fullName: string;
  gender: 'M' | 'F' | 'MIXTO';
  weapons: readonly string[];
  eligibleCategories: readonly string[];
};

/** Una solicitud de inscripción ya hecha (`entry`), con su estado. */
export type SolicitudDeCuenta = {
  competitionId: string;
  athleteId: string;
  status: EntryStatus;
};

export type FilaTusPruebas = {
  clave: string;
  tipo: 'inscrito' | 'plazo' | 'proxima';
  /** `/?evento=<id>`: el toque abre la ficha del torneo en el calendario. */
  eventId: string;
  eventName: string;
  startDate: string;
  endDate: string;
  city: string | null;
  country: string | null;
  /** «Espada Fem. M17»: la prueba concreta dentro del torneo. */
  prueba: string;
  athleteName: string;
  /** Estado crudo de la solicitud; sólo en `inscrito`. */
  solicitud: EntryStatus | null;
  /** Días que quedan de plazo; `null` cuando no hay cierre que contar. */
  diasCierre: number | null;
};

/**
 * Cuatro como mucho: es el sumario encima del calendario, no un segundo
 * calendario. Al resto se llega por el listado o por «Mi estado».
 */
export const TOPE_FILAS_TUS_PRUEBAS = 4;

/**
 * «Cierra pronto» es un mes. Los cierres que publica la RFEE suelen caer
 * unas dos semanas antes del torneo; con treinta días la sección avisa con
 * margen para tramitarla sin llenarse de plazos de dentro de un trimestre.
 */
export const CIERRE_PRONTO_DIAS = 30;

export function filasDeTusPruebas({
  eventos,
  tiradores,
  solicitudes,
}: {
  eventos: EventView[];
  tiradores: TiradorDeCuenta[];
  solicitudes: SolicitudDeCuenta[];
}): FilaTusPruebas[] {
  if (tiradores.length === 0) return [];

  const porPrueba = new Map<string, { evento: EventView; prueba: CompetitionView }>();
  for (const evento of eventos) {
    for (const prueba of evento.competitions) porPrueba.set(prueba.id, { evento, prueba });
  }
  const porId = new Map(tiradores.map((t) => [t.id, t]));

  /**
   * En qué ha pedido estar cada uno: la prueba pedida no se repite después
   * como «plazo que cierra». Se anota por tirador: que el hermano mayor ya
   * la haya solicitado no calla el plazo del pequeño.
   */
  const pedidas = new Map<string, Set<string>>();
  const inscritos: FilaTusPruebas[] = [];
  for (const s of solicitudes) {
    const tirador = porId.get(s.athleteId);
    const par = porPrueba.get(s.competitionId);
    if (!tirador || !par) continue;
    let del = pedidas.get(s.athleteId);
    if (!del) pedidas.set(s.athleteId, (del = new Set()));
    del.add(s.competitionId);
    inscritos.push(
      fila('inscrito', par.evento, par.prueba, tirador, `${s.athleteId}|${s.competitionId}`, {
        solicitud: s.status,
        // El cierre también informa aquí: «Pendiente de tu club» con
        // «cierra en 2 días» es justo lo que hay que empujar primero.
        diasCierre: diasDeCierre(par.prueba),
      }),
    );
  }
  inscritos.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      a.athleteName.localeCompare(b.athleteName, 'es'),
  );

  /**
   * Lo que le toca a cada tirador: su arma, su género y las categorías en
   * las que puede tirar, en pruebas individuales —a una por equipos no se
   * apunta uno solo— y con la inscripción aún abierta. Es la misma regla
   * que aplican la ficha del torneo y «Mi estado», y por el mismo motivo:
   * una prueba cerrada en la que no está no le deja decisión que tomar.
   */
  const candidatas: { evento: EventView; prueba: CompetitionView; tirador: TiradorDeCuenta }[] = [];
  for (const evento of eventos) {
    for (const prueba of evento.competitions) {
      if (prueba.format !== 'INDIVIDUAL' || prueba.status.closed) continue;
      for (const tirador of tiradores) {
        if (!tirador.weapons.includes(prueba.weapon)) continue;
        if (prueba.gender !== 'MIXTO' && prueba.gender !== tirador.gender) continue;
        if (!tirador.eligibleCategories.includes(prueba.category)) continue;
        candidatas.push({ evento, prueba, tirador });
      }
    }
  }

  if (inscritos.length === 0) {
    /**
     * Sin solicitudes: las próximas que le tocan, por el día en que se
     * tiran —el de la prueba si la fuente lo publica, el del torneo si no.
     */
    return candidatas
      .sort(
        (a, b) =>
          diaDe(a).localeCompare(diaDe(b)) ||
          a.evento.name.localeCompare(b.evento.name, 'es') ||
          a.tirador.fullName.localeCompare(b.tirador.fullName, 'es'),
      )
      .slice(0, TOPE_FILAS_TUS_PRUEBAS)
      .map((c) =>
        fila('proxima', c.evento, c.prueba, c.tirador, `${c.tirador.id}|${c.prueba.id}`, {
          diasCierre: diasDeCierre(c.prueba),
        }),
      );
  }

  const filas = inscritos.slice(0, TOPE_FILAS_TUS_PRUEBAS);
  const plazos = candidatas
    .filter(
      (c) =>
        c.prueba.status.daysLeft !== null &&
        c.prueba.status.daysLeft >= 0 &&
        c.prueba.status.daysLeft <= CIERRE_PRONTO_DIAS &&
        !pedidas.get(c.tirador.id)?.has(c.prueba.id),
    )
    .sort(
      (a, b) =>
        (a.prueba.status.daysLeft ?? 0) - (b.prueba.status.daysLeft ?? 0) ||
        diaDe(a).localeCompare(diaDe(b)) ||
        a.tirador.fullName.localeCompare(b.tirador.fullName, 'es'),
    )
    .slice(0, TOPE_FILAS_TUS_PRUEBAS - filas.length)
    .map((c) =>
      fila('plazo', c.evento, c.prueba, c.tirador, `${c.tirador.id}|${c.prueba.id}`, {
        diasCierre: c.prueba.status.daysLeft,
      }),
    );

  return [...filas, ...plazos];
}

/** El día de la prueba si la fuente lo publica; si no, el inicio del torneo. */
function diaDe(c: { evento: EventView; prueba: CompetitionView }): string {
  return c.prueba.competitionDate ?? c.evento.startDate;
}

/** Días de plazo cuando aún queda algo que contar; si no, `null` y la pastilla no sale. */
function diasDeCierre(prueba: CompetitionView): number | null {
  const d = prueba.status.daysLeft;
  return d !== null && d >= 0 ? d : null;
}

function fila(
  tipo: FilaTusPruebas['tipo'],
  evento: EventView,
  prueba: CompetitionView,
  tirador: TiradorDeCuenta,
  clave: string,
  extra: { solicitud?: EntryStatus; diasCierre?: number | null },
): FilaTusPruebas {
  return {
    clave,
    tipo,
    eventId: evento.id,
    eventName: evento.name,
    startDate: evento.startDate,
    endDate: evento.endDate,
    city: evento.city,
    country: evento.country,
    prueba: rotuloPrueba(
      {
        arma: prueba.weapon,
        genero: prueba.gender,
        categoria: prueba.category,
        formato: prueba.format,
      },
      { variante: 'corto', categoria: 'siempre' },
    ),
    athleteName: tirador.fullName,
    solicitud: extra.solicitud ?? null,
    diasCierre: extra.diasCierre ?? null,
  };
}
