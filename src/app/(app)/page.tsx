import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { entry } from '@/db/schema';
import { VistaCalendario, type TiradorOpcion } from '@/components/calendario/vista';
import { getManagedAthletes, requireProfile } from '@/lib/auth/session';
import { deriveCategoriesFromBirthDate } from '@/lib/categories';
import { requestEntry } from '@/lib/entries/actions';
import { inscritosDelEvento } from './inscritos';
import { ENTRY_STATUS_LABEL, type EntryStatus } from '@/lib/entries/state-machine';
import { getCurrentSeason, getDataFreshness, listEvents } from '@/lib/queries/calendar';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Calendario' };

/**
 * La pantalla principal ES el calendario.
 *
 * Se carga la temporada entera de una vez y el filtrado ocurre en el
 * cliente: son unos cientos de eventos, cabe de sobra, y así cambiar de mes
 * o de filtro es instantáneo. En un pabellón con mala cobertura, esperar a
 * la red en cada toque es la diferencia entre usarlo y no usarlo.
 */
export default async function CalendarioPage() {
  const perfil = await requireProfile();

  const [eventos, atletas, temporada, frescura] = await Promise.all([
    /**
     * Solo nacional e internacional.
     *
     * El calendario autonómico (Madrid, Cataluña…) no es el objeto de esta
     * aplicación: esto es para tiradores de ámbito nacional y para la
     * selección española. Mezclarlo llenaba el mes de pruebas que no le
     * tocan a nadie de los que la van a usar.
     */
    listEvents({ limit: 500, scope: ['NACIONAL', 'INTERNACIONAL'] }),
    getManagedAthletes(perfil.profileId),
    getCurrentSeason(),
    getDataFreshness(),
  ]);

  const tiradores: TiradorOpcion[] = atletas.map((a) => ({
    id: a.id,
    fullName: a.fullName,
    gender: a.gender,
    weapons: a.weapons,
    eligibleCategories: temporada
      ? deriveCategoriesFromBirthDate(a.birthDate, temporada.categories).eligible
      : [],
  }));

  /**
   * Inscripciones ya solicitadas, para no ofrecer "solicitar" en algo que ya
   * se pidió. Una consulta para todas, no una por prueba.
   */
  const inscripciones: Record<string, string> = {};
  if (atletas.length > 0) {
    const filas = await db
      .select({ competitionId: entry.eventCompetitionId, status: entry.status })
      .from(entry)
      .where(
        inArray(
          entry.athleteId,
          atletas.map((a) => a.id),
        ),
      );

    for (const f of filas) {
      if (f.status === 'withdrawn' || f.status === 'rejected') continue;
      inscripciones[f.competitionId] = ENTRY_STATUS_LABEL[f.status as EntryStatus];
    }
  }

  if (eventos.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-2">
        <h1 className="text-2xl">Todavía no hay competiciones</h1>
        <p className="medida text-sm text-muted-foreground">
          El calendario se alimenta solo una vez al día de las fuentes
          oficiales. Pide a un administrador que lance la primera carga.
        </p>
      </div>
    );
  }

  /**
   * ¿Esta cuenta se ha quedado sin ficha de tirador?
   *
   * Solo se pregunta para tiradores y tutores: un seleccionador o la
   * dirección técnica tampoco tienen ficha y no les hace falta, así que
   * invitarles a vincularse sería un aviso que no les toca.
   */
  const sinFicha =
    atletas.length === 0 && (perfil.role === 'athlete' || perfil.role === 'guardian');

  return (
    <VistaCalendario
      eventos={eventos}
      sinFicha={sinFicha}
      tiradores={tiradores}
      inscripciones={inscripciones}
      temporada={temporada?.label ?? null}
      actualizado={
        frescura.lastSeenAt
          ? new Intl.DateTimeFormat('es-ES', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Europe/Madrid',
            }).format(frescura.lastSeenAt)
          : null
      }
      solicitarInscripcion={requestEntry}
      cargarInscritos={inscritosDelEvento}
    />
  );
}
