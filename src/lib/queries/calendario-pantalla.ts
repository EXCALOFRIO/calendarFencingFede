import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { entry } from '@/db/schema';
import { getManagedAthletes, type SessionProfile } from '@/lib/auth/session';
import { ENTRY_STATUS_LABEL, type EntryStatus } from '@/lib/entries/state-machine';
import { getCurrentSeason, getDataFreshness } from './calendar';
import { calendarioCompartido } from './calendario-cache';
import { tramoDeMeses, tramoPasadoDe } from './calendario-pasado-tramo';

/**
 * Lo que lee la pantalla principal (el calendario), en UNA tanda paralela:
 *
 * - común, de la caché compartida: la temporada de hoy en adelante y lo ya
 *   celebrado del tramo con el que se abre;
 * - de la cuenta, en la petición: sus tiradores y, encadenadas a ellos sin
 *   esperar al resto, sus inscripciones solicitadas;
 * - del armazón (`getCurrentSeason`, `getDataFreshness`): memorizadas por
 *   petición con React `cache`, así que el layout y esta página las leen una
 *   sola vez.
 */
export async function cargarPantallaCalendario({
  perfil,
  hoy,
  mes,
  meses,
}: {
  /**
   * La sesión en curso, como promesa (la página la pasa sin esperar). Lo que
   * no depende de la cuenta —la temporada, la frescura, el pasado del tramo—
   * arranca ya, en paralelo con la sesión, en vez de detrás de ella.
   */
  perfil: Promise<SessionProfile>;
  /** Día en Madrid (`hoyMadrid`). */
  hoy: string;
  /** `AAAA-MM` con el que se abre, o `null` para el de hoy. */
  mes: string | null;
  /** Uno (vista de mes) o tres (trimestre). */
  meses: number;
}) {
  const [anio, numeroMes] = (mes ?? hoy.slice(0, 7)).split('-').map(Number);
  const arranque = tramoDeMeses(anio, numeroMes - 1, meses);
  const tramoInicial = tramoPasadoDe(arranque.desde, arranque.hasta, hoy);

  /*
    Lo de la cuenta cuelga de la sesión y nada más: sus tiradores y, a la
    vez, sus inscripciones pedidas. Si la sesión falla, la tanda entera
    rechaza igual que antes (`NO_AUTENTICADO` lo recoge la frontera de error).
  */
  const cuenta = perfil.then(async (p) => {
    const atletas = await getManagedAthletes(p.profileId);
    const { mapa, filas } = await inscripcionesDe(atletas);
    return { perfil: p, atletas, inscripciones: mapa, solicitudes: filas };
  });

  const [eventos, { perfil: sesion, atletas, inscripciones, solicitudes }, temporada, frescura, pasadoInicial] = await Promise.all([
    calendarioCompartido.eventosDelCalendario(),
    cuenta,
    getCurrentSeason(),
    getDataFreshness(),
    /*
      Un fallo aquí no tumba la pantalla: la vista lo vuelve a pedir. Se
      adelanta el del tramo de arranque porque casi siempre lo hay (el día 5,
      los cuatro primeros días del mes ya pasaron) y porque al volver desde una
      edición de 2019 el calendario tiene que abrirse ya pintado.
    */
    tramoInicial ? calendarioCompartido.tramoPasado({ ...tramoInicial, hoy }).catch(() => null) : null,
  ]);
  return { perfil: sesion, eventos, atletas, inscripciones, solicitudes, temporada, frescura, pasadoInicial };
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
