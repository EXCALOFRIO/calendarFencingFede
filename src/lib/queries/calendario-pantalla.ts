import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { entry } from '@/db/schema';
import { getManagedAthletes } from '@/lib/auth/session';
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
  profileId,
  hoy,
  mes,
  meses,
}: {
  profileId: string;
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

  const [eventos, [atletas, inscripciones], temporada, frescura, pasadoInicial] = await Promise.all([
    calendarioCompartido.eventosDelCalendario(),
    getManagedAthletes(profileId).then(async (atletas) => [atletas, await inscripcionesDe(atletas)] as const),
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
  return { eventos, atletas, inscripciones, temporada, frescura, pasadoInicial };
}

/**
 * Inscripciones ya solicitadas, para no ofrecer "solicitar" en algo que ya
 * se pidió. Una consulta para todas, no una por prueba.
 */
async function inscripcionesDe(atletas: readonly { id: string }[]): Promise<Record<string, string>> {
  const inscripciones: Record<string, string> = {};
  if (atletas.length === 0) return inscripciones;
  const filas = await db
    .select({ competitionId: entry.eventCompetitionId, status: entry.status })
    .from(entry)
    .where(inArray(entry.athleteId, atletas.map((a) => a.id)));
  for (const f of filas) {
    if (f.status === 'withdrawn' || f.status === 'rejected') continue;
    inscripciones[f.competitionId] = ENTRY_STATUS_LABEL[f.status as EntryStatus];
  }
  return inscripciones;
}
