import { fetchJson, fixDoubleEncodedUtf8 } from '../fetcher';
import {
  fieCountryToIso2,
  inferScope,
  mapCategory,
  mapFieCircuit,
  mapFormat,
  mapGender,
  mapWeapon,
  timezoneForCountry,
} from '../mappers';
import type { NormalizedCompetition, NormalizedEvent } from '../types';

/**
 * Adaptador de la FIE.
 *
 * Buena noticia comprobada en vivo: `fie.org` tiene una API JSON pública y sin
 * autenticación en `https://fie.org/api/fie/`, así que aquí NO hay scraping.
 * Es más estable y más ligero que parsear su HTML de Nuxt.
 *
 * Aviso: no está documentada ni versionada, así que puede cambiar sin avisar.
 * Por eso la validación de Zod y `ingest_run` importan tanto en esta fuente.
 *
 * -------------------------------------------------------------------------
 * LÍMITE LEGAL, y es el motivo de que este adaptador guarde tan poco
 * -------------------------------------------------------------------------
 * Los términos de la FIE dicen expresamente que ninguna parte del sitio puede
 * reproducirse ni "almacenarse en un sistema de recuperación" sin permiso
 * escrito. Los HECHOS no tienen copyright (que el florete junior sea el 25/09
 * en Samsun es un dato), pero en la UE existe el derecho *sui generis* de base
 * de datos, que protege la extracción de una parte sustancial.
 *
 * Mitigación, que además es buena ingeniería: se guarda SOLO lo indispensable
 * —identificador, fechas, arma, género, categoría, sede y la URL de origen— y
 * se enlaza siempre a fie.org. En particular NO se copian:
 *   `registrationInfo`, `accommodationInfo`, `visaInfo`, `scheduleInfo`,
 *   `prizesInfo`, `sponsors`, descripciones ni documentos.
 * Un índice de referencias con enlace a la fuente es una cosa muy distinta de
 * una copia de su base de datos.
 *
 * De la imagen del torneo se guarda la DIRECCIÓN, no el archivo: el navegador
 * del usuario la pide a `static.fie.org` igual que la pediría visitando su
 * web. No se rehospeda, no se cachea y no se transforma. Si la FIE la retira,
 * desaparece también aquí, que es el comportamiento correcto.
 *
 * En paralelo conviene pedirles por escrito el permiso del que hablan sus
 * propios términos. Con un "sí" el riesgo desaparece.
 */

const FIE_API = 'https://fie.org/api/fie';

/** Lo que devuelve `/api/fie/competitions`. Solo los campos que usamos. */
type FieCompetition = {
  id: number;
  competitionId: number;
  season: number;
  name: string | null;
  /** "I" individual, "E" equipos. */
  type: string | null;
  /** "S" senior, "J" junior, "C" cadete, "V" veteranos. */
  category: string | null;
  competitionCategory: string | null;
  location: string | null;
  federation: string | null;
  startDate: string | null;
  endDate: string | null;
  weapon: string | null;
  gender: string | null;
  locationName: string | null;
  locationAddress: string | null;
  startTime: string | null;
  timezone: string | null;
  officialSite: string | null;
  flag: string | null;
  livestreamLink: string | null;
  livestreamResultsLink: string | null;
};

type FieCompetitionsPage = {
  totalFound: number;
  page: number;
  pageSize: number;
  items: FieCompetition[];
};

/** Lo que devuelve `/api/fie/tournaments`: el tipo legible del torneo. */
type FieTournament = {
  id: number;
  name: string;
  city: string | null;
  country: string | null;
  flag: string | null;
  type: string | null;
  startDate: string | null;
  endDate: string | null;
  thumbnailUrl: string | null;
  coverUrl: string | null;
};

/** La temporada FIE va de septiembre a agosto y se etiqueta con el año final. */
export function currentFieSeason(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  // Septiembre (mes 8 en base 0) o después ya es la temporada siguiente.
  return now.getUTCMonth() >= 8 ? year + 1 : year;
}

/** Clave "ciudad|fecha" normalizada, para cruzar pruebas con torneos. */
function claveSede(ciudad: string, fechaIso: string): string {
  const limpia = ciudad
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return `${limpia}|${fechaIso.slice(0, 10)}`;
}

export function fieTournamentUrl(season: number, tournamentId: number): string {
  return `https://fie.org/tournaments/${season}/${tournamentId}`;
}

async function fetchAllCompetitions(season: number): Promise<FieCompetition[]> {
  const pageSize = 100; // La API tope es 100 por página.
  const items: FieCompetition[] = [];
  let page = 1;

  for (;;) {
    const data = await fetchJson<FieCompetitionsPage>(
      `${FIE_API}/competitions?season=${season}&page=${page}&pageSize=${pageSize}`,
    );
    items.push(...(data.items ?? []));

    const total = data.totalFound ?? items.length;
    if (items.length >= total || (data.items ?? []).length === 0) break;

    page += 1;
    // Salvaguarda: si la API cambia la semántica de la paginación, no queremos
    // un bucle infinito consumiendo la cuota de la función.
    if (page > 50) break;
  }

  return items;
}

/** Los nombres legibles de torneo ("Samsun World Cup 2026") y su tipo. */
async function fetchTournamentIndex(
  season: number,
): Promise<Map<number, FieTournament>> {
  const index = new Map<number, FieTournament>();
  let offset = 0;

  for (;;) {
    const data = await fetchJson<{ items: FieTournament[]; total: number }>(
      `${FIE_API}/tournaments?season=${season}&limit=100&offset=${offset}&sort=dateAsc`,
    );
    const items = data.items ?? [];
    for (const t of items) index.set(t.id, t);

    offset += items.length;
    if (items.length === 0 || offset >= (data.total ?? offset)) break;
    if (offset > 5_000) break;
  }

  return index;
}

/**
 * Trae y normaliza el calendario de una temporada FIE.
 *
 * Devuelve candidatos sin validar: `validateEvents` decide qué entra y qué va
 * a cuarentena, igual que con Skermo.
 */
export async function fetchFieSeason(
  season: number = currentFieSeason(),
): Promise<{ candidates: unknown[]; rowsSeen: number }> {
  const [competitions, tournaments] = await Promise.all([
    fetchAllCompetitions(season),
    fetchTournamentIndex(season).catch(() => new Map<number, FieTournament>()),
  ]);

  /** clave de torneo -> evento en construcción */
  const grouped = new Map<
    string,
    Omit<NormalizedEvent, 'competitions'> & { competitions: NormalizedCompetition[] }
  >();

  /**
   * Índice auxiliar por sede y fecha.
   *
   * `competition.competitionId` NO es el id del torneo: para Samsun, la prueba
   * trae `competitionId: 47` y el torneo es el 108. Comprobado en vivo. Sin
   * este cruce, 60 de las 61 pruebas se quedaban sin nombre de torneo y sin
   * imagen, porque la búsqueda directa por id fallaba casi siempre.
   *
   * Se cruza por ciudad normalizada y solape de fechas, que es lo que de
   * verdad identifica un torneo: no hay dos torneos FIE en la misma ciudad el
   * mismo fin de semana.
   */
  const porSedeYFecha = new Map<string, FieTournament>();
  for (const t of tournaments.values()) {
    if (!t.city || !t.startDate) continue;
    porSedeYFecha.set(claveSede(t.city, t.startDate), t);
  }

  const buscarTorneo = (c: FieCompetition): FieTournament | undefined => {
    const directo = tournaments.get(c.competitionId);
    if (directo) return directo;

    const ciudad = c.locationName ?? c.location;
    if (!ciudad || !c.startDate) return undefined;

    // La prueba puede caer en cualquier día del torneo: se prueban los tres
    // días anteriores y los tres siguientes.
    for (let d = -3; d <= 3; d += 1) {
      const fecha = new Date(`${c.startDate}T12:00:00Z`);
      fecha.setUTCDate(fecha.getUTCDate() + d);
      const encontrado = porSedeYFecha.get(
        claveSede(ciudad, fecha.toISOString().slice(0, 10)),
      );
      if (encontrado) return encontrado;
    }
    return undefined;
  };

  for (const c of competitions) {
    const tournament = buscarTorneo(c);
    const category = mapCategory(c.category);
    const weapon = mapWeapon(c.weapon);
    const gender = mapGender(c.gender);

    /**
     * El país: se prefiere `flag`, que la API ya da en ISO-3166 alfa-2, y la
     * tabla de códigos FIE es el respaldo. El campo `country` viene a veces
     * con UTF-8 doble-codificado ("TÃ¼rkiye"), así que no se usa como clave.
     */
    const country = fieCountryToIso2(c.flag ?? c.federation);

    /**
     * El huso horario de la FIE NO es de fiar: para Samsun (Turquía) devuelve
     * "Asia/Riyadh", y ese mismo valor aparece como relleno en las 34 pruebas
     * que todavía tienen la sede sin decidir, en Reikiavik y en San Salvador.
     * No es un huso: es su valor por defecto, y encima llega con la barra
     * escapada ("Asia\/Riyadh").
     *
     * Así que NO se usa ni como respaldo. El huso sale del país, que sí
     * sabemos leer bien, y si el país no está en la tabla se queda a null y la
     * app no enseña el aviso de diferencia horaria. Un huso mal puesto hace
     * que ese aviso diga una mentira, y eso es peor que no decir nada.
     */
    const timezone = timezoneForCountry(country);

    const tournamentId = c.competitionId;
    const key = `fie-${season}-${tournamentId}`;
    const sourceUrl = fieTournamentUrl(season, tournamentId);

    const competition = {
      weapon,
      gender,
      category,
      categoryRaw: c.category,
      format: mapFormat(c.type),
      competitionDate: c.startDate,
      installationOpen: null,
      callTime: null,
      scratchTime: null,
      startTime: c.startTime,
      registrationCount: null,
      // La FIE no publica la cuota en esta API: null, nunca un importe supuesto.
      feeEur: null,
      sourceId: String(c.id),
      sourceUrl: `https://fie.org/competition/${season}/${c.id}/entries`,
      // Su cierre (D-7) se calcula con `deadline_rule`, no viene en la API.
      registrationCloseDate: null,
    } as unknown as NormalizedCompetition;

    const existing = grouped.get(key);
    if (existing) {
      if (c.startDate && c.startDate < existing.startDate) {
        existing.startDate = c.startDate;
      }
      if (c.endDate && c.endDate > existing.endDate) existing.endDate = c.endDate;
      existing.competitions.push(competition);
      continue;
    }

    const circuit = mapFieCircuit(tournament?.type ?? c.competitionCategory, category);
    const city = tournament?.city
      ? fixDoubleEncodedUtf8(tournament.city)
      : (c.location ?? null);

    grouped.set(key, {
      source: 'fie',
      sourceId: key,
      sourceUrl,
      /** Se usa el nombre del torneo, no el genérico "Coupe du Monde". */
      name: tournament?.name ?? c.name ?? `Torneo FIE ${tournamentId}`,
      startDate: c.startDate ?? '',
      endDate: c.endDate ?? c.startDate ?? '',
      venue: c.locationName ?? null,
      venueAddress: c.locationAddress ?? null,
      city,
      country,
      timezone,
      officialSite: c.officialSite?.startsWith('http') ? c.officialSite : null,
      /**
       * Imagen del torneo, enlazada a `static.fie.org`. Solo se guarda la
       * dirección; la imagen nunca se copia ni se rehospeda, que es lo que
       * piden sus términos.
       */
      imageUrl:
        tournament?.coverUrl?.startsWith('http')
          ? tournament.coverUrl
          : tournament?.thumbnailUrl?.startsWith('http')
            ? tournament.thumbnailUrl
            : null,
      circuit,
      scope: inferScope(circuit, 'INTERNACIONAL'),
      regionalFederation: null,
      sourceModifiedAt: null,
      // Nada de texto libre de la FIE: ver la nota legal de la cabecera.
      notes: null,
      documents: [],
      liveLinks: [
        ...(c.livestreamResultsLink?.startsWith('http')
          ? [
              {
                platform: 'fie',
                kind: 'resultados',
                url: c.livestreamResultsLink,
                label: 'Resultados en vivo (FIE)',
              },
            ]
          : []),
        ...(c.livestreamLink?.startsWith('http')
          ? [
              {
                platform: 'fie',
                kind: 'en_vivo',
                url: c.livestreamLink,
                label: 'Retransmisión',
              },
            ]
          : []),
      ],
      competitions: [competition],
    });
  }

  return { candidates: [...grouped.values()], rowsSeen: competitions.length };
}
