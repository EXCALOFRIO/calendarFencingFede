import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { entry } from '@/db/schema';
import {
  getManagedAthletes,
  type AthleteSummary,
  type SessionProfile,
} from '@/lib/auth/session';
import type { CategoriaDeCalendario } from '@/lib/ambito';
import type { SolicitudDeCuenta } from '@/lib/calendario/tus-pruebas';
import { ENTRY_STATUS_LABEL, type EntryStatus } from '@/lib/entries/state-machine';
import { getCurrentSeason, getDataFreshness, type EventView } from './calendar';
import { calendarioCompartido } from './calendario-cache';
import type { TramoPasado } from './calendario-pasado-modelo';
import { tramoDeMeses, tramoPasadoDe } from './calendario-pasado-tramo';

/**
 * El armazón de la portada: lo barato con lo que se pintan la cabecera, la
 * barra y los filtros —sin esperar al listado—.
 *
 * Todo aquí es una caché (la compartida o la de petición de `cache()`): lo
 * único de verdad que se espera es la sesión y sus tiradores, que el layout
 * ya pidió en paralelo. Con eso la página enseña su estructura en cuanto el
 * armazón común está, como `/ranking`.
 */
export type BaseDelCalendario = {
  perfil: SessionProfile;
  atletas: AthleteSummary[];
  temporada: Awaited<ReturnType<typeof getCurrentSeason>>;
  frescura: Awaited<ReturnType<typeof getDataFreshness>>;
  /**
   * Las categorías con prueba en el calendario, con su ámbito: con ellas se
   * arman los filtros antes de que llegue el listado (`categoriasDeEventos`
   * es la misma cuenta sobre los eventos).
   */
  categorias: CategoriaDeCalendario[];
};

/**
 * El listado: lo pesado. La temporada entera de eventos de hoy en adelante —
 * la consulta cara de la ruta— y las inscripciones de la cuenta. Viaja como
 * promesa hasta la vista, que la resuelve con `use()` dentro de sus
 * `<Suspense>`: la estructura se ve ya y el listado entra por el stream.
 */
export type ListadoDelCalendario = {
  eventos: EventView[];
  /** competitionId -> estado legible de la inscripción de esta cuenta. */
  inscripciones: Record<string, string>;
  /**
   * Las solicitudes de la cuenta (`entry`), con su tirador. El calendario no
   * las pinta: las usa «Tus pruebas», que las espera en el servidor sobre la
   * misma promesa —sin una segunda lectura—.
   */
  solicitudes: SolicitudDeCuenta[];
};

/**
 * Lo que lee la pantalla principal (el calendario), en TRES promesas, no en
 * un solo `await`:
 *
 * - `base`: lo que hace falta para el armazón —la sesión y los tiradores de
 *   la cuenta, la temporada, la frescura y el catálogo de categorías de los
 *   filtros. La página la espera y pinta la estructura.
 * - `listado`: la temporada entera y las inscripciones. NO se espera aquí:
 *   viaja como promesa hasta la vista y entra por el stream cuando se
 *   resuelve («Streaming data to the client» en la guía de Next).
 * - `pasadoInicial`: lo ya celebrado del tramo con el que se abre, igual que
 *   `listado`: arranca a la vez y entra por el stream.
 *
 * Si la sesión falla, `base` y `listado` rechazan igual que antes
 * (`NO_AUTENTICADO` lo recoge la frontera de error).
 */
export function cargarPantallaCalendario({
  perfil,
  hoy,
  mes,
  meses,
}: {
  /**
   * La sesión en curso, como promesa (la página la pasa sin esperar). Lo que
   * no depende de la cuenta —la temporada, la frescura, las categorías, el
   * pasado del tramo— arranca ya, en paralelo con la sesión, en vez de
   * detrás de ella.
   */
  perfil: Promise<SessionProfile>;
  /** Día en Madrid (`hoyMadrid`). */
  hoy: string;
  /** `AAAA-MM` con el que se abre, o `null` para el de hoy. */
  mes: string | null;
  /** Uno (vista de mes) o tres (trimestre). */
  meses: number;
}): {
  base: Promise<BaseDelCalendario>;
  listado: Promise<ListadoDelCalendario>;
  pasadoInicial: Promise<TramoPasado | null> | null;
} {
  const [anio, numeroMes] = (mes ?? hoy.slice(0, 7)).split('-').map(Number);
  const arranque = tramoDeMeses(anio, numeroMes - 1, meses);
  const tramoInicial = tramoPasadoDe(arranque.desde, arranque.hasta, hoy);

  /*
    Lo de la cuenta cuelga de la sesión y nada más: una sola promesa de
    `getManagedAthletes` —que está memoizada con `cache()`, así que el
    layout y esta página la leen una vez— y, a su rueda, las inscripciones.
    Así `base` no espera a `entry` y `listado` no espera a la sesión.
  */
  const cuenta = perfil.then(async (p) => ({
    perfil: p,
    atletas: await getManagedAthletes(p.profileId),
  }));
  const inscripciones = cuenta.then(({ atletas }) => inscripcionesDe(atletas));

  /*
    El armazón: sesión + tiradores + temporada + frescura + el catálogo de
    categorías. Todo lo demás está en la caché compartida o en la de la
    petición, así que en la práctica `base` vale lo que vale la sesión.
  */
  const base = Promise.all([
    cuenta,
    getCurrentSeason(),
    getDataFreshness(),
    calendarioCompartido.categoriasDelCalendario(),
  ]).then(([{ perfil: sesion, atletas }, temporada, frescura, categorias]) => ({
    perfil: sesion,
    atletas,
    temporada,
    frescura,
    categorias,
  }));

  /*
    El listado: la temporada desde hoy (la cara) y las inscripciones, que
    sueltan en cuanto los tiradores estén, sin esperar a los eventos.
  */
  const listado = Promise.all([
    calendarioCompartido.eventosDelCalendario(),
    inscripciones,
  ]).then(([eventos, { mapa, filas }]) => ({
    eventos,
    inscripciones: mapa,
    solicitudes: filas,
  }));

  /*
    Un fallo del tramo no tumba la pantalla: la vista lo vuelve a pedir. Se
    adelanta el del tramo de arranque porque casi siempre lo hay (el día 5,
    los cuatro primeros días del mes ya pasaron) y porque al volver desde una
    edición de 2019 el calendario tiene que abrirse ya pintado.
  */
  const pasadoInicial = tramoInicial
    ? calendarioCompartido.tramoPasado({ ...tramoInicial, hoy }).catch(() => null)
    : null;

  return { base, listado, pasadoInicial };
}

/**
 * Inscripciones ya solicitadas, para no ofrecer "solicitar" en algo que ya
 * se pidió. Una consulta para todas, no una por prueba.
 *
 * Devuelve dos vistas de las mismas filas: el mapa `competitionId -> estado`
 * que marcan las tarjetas, y la lista con su `athleteId`, que es la que
 * permite a «Tus pruebas» decir de QUIÉN es cada inscripción (una cuenta de
 * tutor lleva a dos hijos y el mapa los aplana).
 */
async function inscripcionesDe(atletas: readonly { id: string }[]) {
  const mapa: Record<string, string> = {};
  const filas: { competitionId: string; athleteId: string; status: EntryStatus }[] = [];
  if (atletas.length === 0) return { mapa, filas };
  const crudas = await db
    .select({
      competitionId: entry.eventCompetitionId,
      athleteId: entry.athleteId,
      status: entry.status,
    })
    .from(entry)
    .where(inArray(entry.athleteId, atletas.map((a) => a.id)));
  for (const f of crudas) {
    if (f.status === 'withdrawn' || f.status === 'rejected') continue;
    const status = f.status as EntryStatus;
    mapa[f.competitionId] = ENTRY_STATUS_LABEL[status];
    filas.push({ competitionId: f.competitionId, athleteId: f.athleteId, status });
  }
  return { mapa, filas };
}
