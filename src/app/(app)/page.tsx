import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { entry } from '@/db/schema';
import { VistaCalendario, type TiradorOpcion } from '@/components/calendario/vista';
import { getManagedAthletes, requireProfile } from '@/lib/auth/session';
import { leerContextoCalendario } from '@/lib/calendario/contexto-url';
import { deriveCategoriesFromBirthDate } from '@/lib/categories';
import { requestEntry } from '@/lib/entries/actions';
import { inscritosDelEvento } from './inscritos';
import { ENTRY_STATUS_LABEL, type EntryStatus } from '@/lib/entries/state-machine';
import { getCurrentSeason, getDataFreshness, listEvents } from '@/lib/queries/calendar';
import { cargarTramoPasado } from '@/lib/queries/calendario-pasado';
import { tramoDeMeses, tramoPasadoDe } from '@/lib/queries/calendario-pasado-tramo';
import { hoyMadrid } from '@/lib/callups/fechas';
import { pasadoDelTramo } from './calendario-pasado';

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
export default async function CalendarioPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const perfil = await requireProfile();
  // Periodo y filtros con los que se vuelve desde una edición o una persona.
  const inicial = leerContextoCalendario((await searchParams) ?? {});

  /**
   * LO YA CELEBRADO DEL TRAMO CON EL QUE SE ABRE, Y SOLO ESO.
   *
   * El resto del pasado lo pide la vista al navegar hacia atrás. Se adelanta
   * aquí el del tramo de arranque porque casi siempre lo hay —el día 5, los
   * cuatro primeros días del mes ya pasaron, y con ellos el fin de semana del
   * 3 y 4 de octubre con cinco competiciones— y porque al volver desde una
   * edición de 2019 el calendario tiene que abrirse ya pintado, no vacío
   * esperando a la red. Un fallo aquí no tumba la pantalla: la vista lo vuelve
   * a pedir.
   */
  const hoy = hoyMadrid();
  const [anioInicial, mesInicial] = (inicial.mes ?? hoy.slice(0, 7)).split('-').map(Number);
  const arranque = tramoDeMeses(
    anioInicial,
    mesInicial - 1,
    (inicial.vista ?? 'trimestre') === 'mes' ? 1 : 3,
  );
  const tramoInicial = tramoPasadoDe(arranque.desde, arranque.hasta, hoy);

  const [eventos, atletas, temporada, frescura, pasadoInicial] = await Promise.all([
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
    tramoInicial
      ? cargarTramoPasado({ ...tramoInicial, hoy, scope: ['NACIONAL', 'INTERNACIONAL'] }).catch(
          () => null,
        )
      : null,
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
        <h1 className="text-3xl sm:text-4xl">Calendario pendiente de carga</h1>
        <p className="medida text-sm text-muted-foreground">
          Todavía no se han cargado competiciones de las fuentes oficiales.
          Pide a dirección técnica que revise la carga.
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
    atletas.length === 0 && perfil.role === 'athlete';

  return (
    <VistaCalendario
      inicial={inicial}
      eventos={eventos}
      /**
       * Papel y armas, que es lo que decide con qué filtros se abre la
       * pantalla: un seleccionador de florete entra en florete con los dos
       * géneros y en absoluto; la dirección técnica, en todo.
       */
      perfil={{ role: perfil.role, weapons: perfil.weapons }}
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
      pasadoInicial={pasadoInicial}
      cargarPasado={pasadoDelTramo}
    />
  );
}
