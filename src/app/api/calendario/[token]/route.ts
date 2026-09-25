import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { callUp, callUpAthlete, userProfile } from '@/db/schema';
import { getManagedAthletes } from '@/lib/auth/session';
import { deriveCategoriesFromBirthDate, type CategoryCode } from '@/lib/categories';
import {
  FEED_META,
  type FeedType,
  buildIcalFeed,
  isFeedType,
} from '@/lib/ical';
import type { Gender, Scope, Weapon } from '@/lib/queries/calendar';
import { getCurrentSeason, listEvents } from '@/lib/queries/calendar';

/**
 * Feed iCal personal.
 *
 * La credencial es el token del perfil (`user_profile.ical_token`), que va en
 * la URL porque es la única forma de que Google Calendar y Apple Calendar
 * puedan suscribirse: esos clientes no envían cabeceras de autenticación ni
 * mantienen sesión. Por eso el token es revocable desde el perfil: si alguien
 * comparte la URL sin darse cuenta, se genera uno nuevo y la anterior muere.
 *
 * El feed NO se sirve desde caché de página: es distinto para cada persona.
 */
export const dynamic = 'force-dynamic';

/** Horizonte del feed. Más allá de un año los datos son puro ruido. */
const HORIZONTE_DIAS = 400;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: tokenCrudo } = await params;

  /**
   * La URL que se ofrece en "Mi perfil" termina en `.ics` (hay clientes de
   * escritorio que solo se suscriben si la ruta acaba así). Sin quitar la
   * extensión, la búsqueda por token exacto fallaba y el feed devolvía 404:
   * la suscripción que copiaba el usuario no funcionaba nunca.
   */
  const token = tokenCrudo?.replace(/\.ics$/i, '');

  // Un token corto no puede ser válido: se corta antes de tocar la base.
  if (!token || token.length < 16) return noEncontrado();

  const url = new URL(request.url);
  const tipoParam = url.searchParams.get('tipo') ?? 'todo';
  const tipo: FeedType = isFeedType(tipoParam) ? tipoParam : 'todo';

  const [perfil] = await db
    .select({ id: userProfile.id })
    .from(userProfile)
    .where(eq(userProfile.icalToken, token))
    .limit(1);

  /**
   * Token desconocido: 404 seco, sin decir si el token existió alguna vez ni
   * devolver un calendario vacío. Un calendario vacío confirmaría que la ruta
   * es válida y dejaría al cliente suscrito a algo que no es suyo.
   */
  if (!perfil) return noEncontrado();

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? url.origin;

  const [atletas, temporada] = await Promise.all([
    getManagedAthletes(perfil.id),
    getCurrentSeason(),
  ]);

  const hasta = new Date(Date.now() + HORIZONTE_DIAS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const meta = FEED_META[tipo];

  if (tipo === 'convocatorias') {
    const ics = await feedConvocatorias(atletas, baseUrl, hasta);
    return respuestaIcal(ics, tipo);
  }

  /**
   * Filtro de elegibilidad: armas del tirador y categorías que le tocan por
   * año de nacimiento en la temporada en curso (`deriveCategoriesFromBirthDate`
   * aplica la regla de la escalera: se sube de categoría, no se baja).
   *
   * Si la cuenta gestiona a varios tiradores —un padre con dos hijos es el caso
   * normal— se hace la UNIÓN de todos, porque el calendario familiar es uno
   * solo. Y si no se sabe algo (cuenta sin tiradores, temporada sin categorías
   * configuradas, tirador sin armas registradas) no se filtra por ese criterio:
   * es mejor un feed con de más que uno que se deje una prueba.
   */
  const weapons = new Set<Weapon>();
  const genders = new Set<Gender>();
  const categories = new Set<CategoryCode>();

  for (const atleta of atletas) {
    for (const w of atleta.weapons) weapons.add(w);
    genders.add(atleta.gender);
    if (temporada) {
      const { eligible } = deriveCategoriesFromBirthDate(
        atleta.birthDate,
        temporada.categories,
      );
      for (const c of eligible) categories.add(c);
    }
  }
  // Las pruebas mixtas (por equipos, sobre todo) valen para cualquiera.
  if (genders.size > 0) genders.add('MIXTO');

  const events = await listEvents({
    scope: (meta.scopes as Scope[] | null) ?? undefined,
    weapons: weapons.size > 0 ? [...weapons] : undefined,
    genders: genders.size > 0 ? [...genders] : undefined,
    categories: categories.size > 0 ? [...categories] : undefined,
    to: hasta,
    limit: 500,
  });

  const ics = buildIcalFeed({ type: tipo, events, baseUrl });
  return respuestaIcal(ics, tipo);
}

/**
 * Feed de convocatorias: aquí no manda la elegibilidad sino el hecho de estar
 * convocado. Solo entran convocatorias PUBLICADAS; un borrador del
 * seleccionador no puede aparecer en el móvil de nadie.
 */
async function feedConvocatorias(
  atletas: { id: string }[],
  baseUrl: string,
  hasta: string,
): Promise<string> {
  if (atletas.length === 0) {
    return buildIcalFeed({ type: 'convocatorias', events: [], baseUrl });
  }

  const filas = await db
    .select({
      eventId: callUp.eventId,
      competitionId: callUpAthlete.eventCompetitionId,
    })
    .from(callUpAthlete)
    .innerJoin(callUp, eq(callUpAthlete.callUpId, callUp.id))
    .where(
      and(
        inArray(
          callUpAthlete.athleteId,
          atletas.map((a) => a.id),
        ),
        eq(callUp.published, true),
      ),
    );

  if (filas.length === 0) {
    return buildIcalFeed({ type: 'convocatorias', events: [], baseUrl });
  }

  const eventIds = new Set(filas.map((f) => f.eventId));
  const competitionIds = new Set(
    filas.map((f) => f.competitionId).filter((id): id is string => Boolean(id)),
  );

  /**
   * Se piden POR ID, no medio calendario para descartar luego.
   *
   * Dos motivos. Uno, coste: traer 500 eventos por la red para quedarse con
   * dos es tirar el presupuesto de consultas de Neon. Y dos, corrección: el
   * listado normal **colapsa** los torneos que están duplicados entre Skermo
   * y la FIE y esconde la fila absorbida. Si una convocatoria apunta
   * justamente a esa fila, filtrando después el evento no aparecía y la
   * convocatoria se caía del calendario del móvil sin que nadie se enterara.
   * Pedido por id se devuelve igual, colapsado o no.
   */
  const events = await listEvents({
    ids: [...eventIds],
    to: hasta,
    limit: eventIds.size,
  });

  return buildIcalFeed({
    type: 'convocatorias',
    events,
    baseUrl,
    // Si la convocatoria no concreta la prueba, se emiten todas las del evento.
    onlyCompetitionIds: competitionIds.size > 0 ? competitionIds : null,
  });
}

function respuestaIcal(ics: string, tipo: FeedType): Response {
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="esgrima-${tipo}.ics"`,
      /**
       * Caché corta y privada. Google refresca los calendarios suscritos cuando
       * le parece (a veces cada varias horas), así que no ganamos nada dándole
       * una caché larga, y en cambio un plazo que cambia tiene que llegar hoy.
       * `private` evita que una caché compartida guarde el feed de una persona.
       */
      'Cache-Control': 'private, max-age=900, must-revalidate',
      // La URL lleva la credencial dentro: que no acabe en ningún índice.
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function noEncontrado(): Response {
  return new Response('Calendario no encontrado.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
