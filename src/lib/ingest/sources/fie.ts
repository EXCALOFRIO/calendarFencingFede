import { fetchJson, fixDoubleEncodedUtf8 } from '../fetcher';
import {
  esUbicacionDesconocida,
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
import { sha256 } from '../../utils';

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
 *   `prizesInfo`, `sponsors` ni descripciones.
 * Un índice de referencias con enlace a la fuente es una cosa muy distinta de
 * una copia de su base de datos.
 *
 * De la imagen del torneo se guarda la DIRECCIÓN, no el archivo: el navegador
 * del usuario la pide a `static.fie.org` igual que la pediría visitando su
 * web. No se rehospeda, no se cachea y no se transforma. Si la FIE la retira,
 * desaparece también aquí, que es el comportamiento correcto.
 *
 * -------------------------------------------------------------------------
 * LA INVITACIÓN: MISMO CRITERIO QUE LA IMAGEN, Y NO SOLO EN PDF
 * -------------------------------------------------------------------------
 * `invitationUrl` es el dossier del torneo, y es el documento que de verdad
 * contesta a lo que nadie publica en el calendario: el pabellón con su
 * dirección, por qué puerta se entra, el horario día por día, las cuotas por
 * categoría, el cupo por federación y la obligación de árbitros.
 *
 * Se guarda la URL en `event_document`, NUNCA el fichero: igual que el cartel,
 * el documento se abre contra `static.fie.org`. Lo único que acaba en nuestra
 * base de datos es la dirección y —tras pasar por la extracción— frases
 * sueltas citadas con su origen, que es lo que hace cualquiera al resumir un
 * documento público. Si la FIE lo retira, aquí se queda un enlace roto y el
 * dato extraído con su cita, no una copia.
 *
 * EL DOSSIER NO SIEMPRE ES UN PDF, y rechazar lo que no lo fuera costaba
 * documentos de verdad. Medido el 27/09/2026 sobre las 23 copas del mundo de
 * los próximos 60 días: de las 96 pruebas con invitación, **74 apuntan a un
 * PDF y 22 a un `.docx`**. Entre esas 22 está la de Orán, que es la más rica
 * que hemos visto (pabellón, aforo, número de pistas, aire acondicionado,
 * código de Google Maps y el horario de los cinco días). Con el filtro
 * anterior —«solo `.pdf`»— ese documento no llegaba ni a guardarse.
 *
 * Así que lo que se filtra ahora es «esto es un DOCUMENTO», no «esto es un
 * PDF»: ver `EXTENSIONES_DOCUMENTO`. Que el extractor sepa o no leer el
 * formato es otra decisión y se toma en `src/lib/ai/extract.ts`; guardar el
 * enlace es útil igualmente, porque una persona sí puede abrirlo.
 *
 * En paralelo conviene pedirles por escrito el permiso del que hablan sus
 * propios términos. Con un "sí" el riesgo desaparece.
 *
 * -------------------------------------------------------------------------
 * EL LISTADO DE PRUEBAS SE CORTA EN HOY. LOS TORNEOS FUTUROS, NO
 * -------------------------------------------------------------------------
 * Comprobado en vivo el 27/09/2026: `/api/fie/competitions?season=2027`
 * devuelve 71 pruebas y **la más tardía empieza el 2026-09-27**, es decir hoy.
 * Ni una sola futura. Por eso los eventos FIE de la base eran todos pasados y
 * la Copa del Mundo de Orán (15-18 de octubre) no existía como evento de la
 * FIE: solo estaba la fila de Skermo, que no publica el dossier ni el cartel.
 * Resultado en la ficha: «esta fuente no publica convocatoria», que era falso.
 *
 * El calendario futuro sí está publicado, pero por otra puerta y en dos
 * saltos:
 *
 *   1. `/api/fie/tournaments?season=…`  — el índice, que YA se descarga aquí.
 *      83 torneos, 67 con fecha de fin en el futuro, y **todos con cartel**
 *      (`coverUrl` relleno 67/67).
 *   2. `/api/fie/tournaments/<id>`      — sus pruebas, con `competitionId`.
 *   3. `/api/fie/competition/<temporada>/<competitionId>` — la invitación.
 *
 * El paso 3 hace falta porque `invitationUrl` NO viene en el índice de
 * torneos ni en su detalle: solo en la ficha de la prueba.
 *
 * Coste medido con la ventana de `DIAS_VENTANA_FUTURO`: 23 torneos, 114
 * pruebas, **138 peticiones** (1 índice + 23 detalles + 114 fichas de prueba).
 * Se piden de seis en seis y es una vez al día.
 *
 * -------------------------------------------------------------------------
 * LA LISTA DE INSCRITOS: SOLO LOS ESPAÑOLES, Y SOLO TRES CAMPOS
 * -------------------------------------------------------------------------
 * `GET /api/fie/competition/<temporada>/<competitionId>/entries` SÍ publica la
 * lista nominal, y es lo que arregla el agujero que tenía la aplicación: de
 * 2.046 filas de listas oficiales, **ninguna traía licencia**, y sin licencia
 * `upsertRegistrations` no puede decirle a nadie «estás dentro».
 *
 * Cada elemento trae `fencer` con dieciocho campos. De ellos se guardan TRES,
 * y solo de los tiradores `ESP`:
 *
 *      nombre  ·  licencia  ·  día de inscripción
 *
 * Se descarta sin escribirse: `date` (fecha de nacimiento), `age`, `height`,
 * `image` (foto), puntos, puestos y **cualquier fila que no sea española**.
 *
 * Y el filtro está AQUÍ, en `inscritosEspanolesDeLaFie`, no en la capa que
 * guarda. La diferencia no es de estilo: así lo que no se debe guardar no
 * llega a existir más allá del parseo de la respuesta, y no hay ninguna capa
 * intermedia en la que alguien pueda decidir otra cosa. Es el mismo criterio
 * del filtro del alojamiento: *un modelo se salta una instrucción, un `if` no*.
 * El caso que lo demuestra está en `tests/inscritos-fie.test.ts`: se le da una
 * respuesta con un menor de otra federación y se comprueba que ni su fecha de
 * nacimiento ni su foto aparecen en la salida.
 *
 * DOS COSAS QUE HAY QUE SABER DE ESTA RESPUESTA, las dos comprobadas en vivo:
 *
 *  1. EL `id` DE LA PRUEBA NO ES EL DE ESTA RUTA. Lo que el índice de torneos
 *     llama `id` (16776 para el sable masculino de Orán) devuelve **404** aquí;
 *     la ruta quiere `competitionId` (1410). Por eso `entriesUrl` se construye
 *     con `competitionId` y la URL que se guardaba antes estaba rota.
 *  2. EN LAS PRUEBAS POR EQUIPOS, `fencer.name` ES EL NOMBRE DEL EQUIPO
 *     ("Spain") y el tirador está en `lastName`/`firstName`. Así que el nombre
 *     se compone siempre de apellido + nombre —que es como lo publica la FIE en
 *     las individuales— y `name` se usa como EQUIPO solo cuando dice otra cosa.
 *     Usar `name` a secas metería cuatro filas llamadas "Spain" en la lista.
 *
 * COSTE Y CADENCIA. Es 1 petición por prueba, así que la ventana importa.
 * Medido el 27/09/2026 sobre las 102 pruebas futuras de la FIE: de D+31 a D+90
 * hay **0 españoles en 48 pruebas** y las listas van de 0 a 26 inscritos (a
 * medias), mientras que de hoy a D+30 hay 70 españoles en 54 pruebas. La
 * inscripción de la FIE cierra a D-7, o sea que antes de un mes no hay nada
 * que leer. De ahí `DIAS_VENTANA_INSCRITOS = 30`: 54 peticiones en vez de 102
 * sin perder ni un inscrito. Lo demás lo decide `tocaLeerInscritos`.
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
  /**
   * Dossier de invitación del torneo, alojado en `static.fie.org`. Puede ser
   * un PDF o un documento de Word: ver la nota de la cabecera.
   *
   * Llega con los espacios ya codificados (`%20`) en el JSON, pero la página
   * del torneo los sirve a veces sin codificar, así que `urlDeInvitacion` lo
   * normaliza antes de guardarlo: una URL con un espacio literal no se puede
   * pedir y rompería la descarga del extractor.
   */
  invitationUrl: string | null;
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
  /** "A", "B"… la letra de categoría del circuito. */
  competitionCategory?: string | null;
  startDate: string | null;
  endDate: string | null;
  thumbnailUrl: string | null;
  coverUrl: string | null;
};

/**
 * Una prueba tal como la lista `/api/fie/tournaments/<id>`.
 *
 * Trae MENOS campos que la ficha de la prueba —no hay `invitationUrl`, ni
 * `flag`, ni `timezone`— pero trae el `competitionId`, que es la llave para
 * pedir esa ficha. Lo demás sale del torneo, que ya se tiene en la mano.
 */
type FieTournamentEvent = {
  id: number;
  competitionId: number;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  country: string | null;
  weapon: string | null;
  gender: string | null;
  category: string | null;
  isTeam: boolean | null;
  season: number;
};

type FieTournamentDetail = FieTournament & { events?: FieTournamentEvent[] };

/**
 * Cuántos días hacia delante se miran los torneos futuros.
 *
 * No es una cifra redonda puesta a ojo: es lo que cuesta la ventana. Con 60
 * días son 23 torneos y 138 peticiones (medido el 27/09/2026); con la
 * temporada entera serían 67 torneos y unas 400. Y 60 días es además el
 * horizonte con el que se planifica un viaje: más allá no hay nada que decidir
 * y el dossier casi nunca está publicado todavía.
 */
const DIAS_VENTANA_FUTURO = 60;

/** Peticiones en vuelo a la vez. La FIE no documenta límite; se es prudente. */
const PETICIONES_EN_PARALELO = 6;

/**
 * Hasta cuántos días por delante se piden las LISTAS DE INSCRITOS.
 *
 * No es la misma ventana que `DIAS_VENTANA_FUTURO`, y por eso es otra
 * constante: el dossier de un torneo se publica meses antes y merece la pena
 * ir a buscarlo a 60 días, pero la lista de inscritos no existe hasta que se
 * acerca el cierre. La FIE cierra a D-7.
 *
 * Medido contra su API el 27/09/2026, prueba por prueba:
 *
 *   hoy → D+30   54 pruebas   51 con lista   **70 españoles**
 *   D+31 → D+60  36 pruebas   28 con lista   **0 españoles**
 *   D+61 → D+90  12 pruebas    6 con lista   **0 españoles**
 *
 * O sea: con 30 días se capturan los 70 inscritos españoles que hay, y se
 * ahorran 48 peticiones diarias que hoy no devuelven ni un español.
 */
export const DIAS_VENTANA_INSCRITOS = 30;

/**
 * Dentro de la ventana, a partir de cuántos días de la prueba se mira TODOS
 * los días.
 *
 * Diez, porque el cierre es a D-7 y es justo entonces cuando la lista se llena
 * y cuando se cae alguien. Antes de eso la lista se mueve poco y se mira cada
 * `DIAS_ENTRE_LECTURAS`.
 */
export const DIAS_ZONA_CALIENTE = 10;

/** Cada cuántos días se mira una lista que todavía está lejos. */
export const DIAS_ENTRE_LECTURAS = 3;

/**
 * Tope de inscritos que se piden por prueba.
 *
 * La lista más grande medida son 150 (espada masculina de Casablanca), así que
 * con 200 entra de una vez y no hace falta paginar. Si algún día una prueba
 * pasara de 200 se perderían los últimos, y por eso `fetchInscritosFie`
 * devuelve también el total publicado: si no cuadra con lo recibido, se dice
 * en la nota de la ejecución en vez de quedarse tan ancho.
 */
const TOPE_INSCRITOS = 200;

/** La nacionalidad que se guarda. Lo demás se descarta sin escribirse. */
const PAIS_PROPIO = 'ESP';

/**
 * Extensiones que se aceptan como DOCUMENTO del torneo.
 *
 * Lo que se busca con esta lista es dejar fuera lo que no es un documento —una
 * web, una imagen, un vídeo—, no imponer un formato. Los `.doc` y `.odt` se
 * guardan aunque el extractor de hoy no sepa leerlos: el enlace sirve igual
 * para quien abra la ficha, y el día que se sepa leerlos el dato ya está.
 */
const EXTENSIONES_DOCUMENTO = ['.pdf', '.docx', '.doc', '.odt', '.rtf', '.txt'];

/** La temporada FIE va de septiembre a agosto y se etiqueta con el año final. */
export function currentFieSeason(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  // Septiembre (mes 8 en base 0) o después ya es la temporada siguiente.
  return now.getUTCMonth() >= 8 ? year + 1 : year;
}

/**
 * Ciudad publicada por la FIE, o `null` si lo que publica es un "todavía no se
 * sabe".
 *
 * Comprobado en vivo el 25/09/2026 sobre `/api/fie/competitions?season=2027`:
 * de 61 pruebas, **35 traen `location: "TBD"`, `locationName: "TBD"`,
 * `country: "FIE"` y `flag: "FF"`**. No es un fallo de lectura: es como la FIE
 * dice "sede por adjudicar". Guardarlo literalmente dejaba 34 torneos con la
 * ciudad "TBD" y un botón «Cómo llegar» que buscaba "TBD" en Google Maps.
 */
function ciudadPublicada(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpio = fixDoubleEncodedUtf8(valor).replace(/\s+/g, ' ').trim();
  if (!limpio || esUbicacionDesconocida(limpio)) return null;
  return limpio;
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

/**
 * La lista de inscritos de una prueba, en fie.org y en su API.
 *
 * Se construye con `competitionId`, NO con el `id` del índice de torneos, y
 * esto costó un rato de depuración porque el fallo no da error: con el `id`
 * (16776) la API devuelve **404** y la página pública devuelve **200 con la
 * lista vacía** («Entries 16776», 20 KB de armazón). Con `competitionId`
 * (1410) la misma página son 92 KB y se titula «Entries Coupe du Monde».
 * Un 200 no dice nada, otra vez.
 */
export function fieEntriesUrl(season: number, competitionId: number): string {
  return `https://fie.org/competition/${season}/${competitionId}/entries`;
}

export function fieEntriesApiUrl(season: number, competitionId: number): string {
  return `${FIE_API}/competition/${season}/${competitionId}/entries?pageSize=${TOPE_INSCRITOS}`;
}

/**
 * Saca temporada y `competitionId` de la clave del evento (`fie-2027-1410`).
 *
 * El `competitionId` no se guarda en ninguna columna propia: es la clave con la
 * que se agrupa el evento, así que vive en `event.source_id`. Leerlo de ahí es
 * preferible a añadir una columna que diría lo mismo dos veces, pero hay que
 * hacerlo con una expresión regular y devolver `null` si no encaja: el día que
 * cambie el formato de la clave, esto deja de leer listas en vez de pedir URLs
 * inventadas.
 */
export function pruebaFieDeSourceId(
  sourceId: string | null | undefined,
): { season: number; competitionId: number } | null {
  const m = /^fie-(\d{4})-(\d+)$/.exec(sourceId ?? '');
  if (!m) return null;
  return { season: Number(m[1]), competitionId: Number(m[2]) };
}

/**
 * La URL del dossier de invitación, lista para pedirla, o `null` si no hay.
 *
 * Dos arreglos, y los dos vienen de mirar las URL reales:
 *
 *  1. ESPACIOS SIN CODIFICAR. La API los devuelve como `%20`, pero el HTML de
 *     la página del torneo los sirve tal cual («…Invitation Cadet and Junior
 *     Foil Worldcup Lima 2026_updated.pdf»). Una URL con un espacio literal no
 *     se puede pasar a `fetch`, así que se codifica lo que haga falta. Se
 *     codifica SOLO el espacio, no la URL entera: pasarla por
 *     `encodeURI`/`encodeURIComponent` volvería a escapar los `%20` que ya
 *     están bien y daría `%2520`, que es un 404.
 *  2. SOLO HTTPS Y SOLO DOCUMENTOS. Si ese campo trae una web, una imagen o
 *     una cadena vacía, no se guarda: `event_document` es para documentos.
 *     PERO «documento» NO quiere decir «PDF». Esta función rechazaba todo lo
 *     que no acabara en `.pdf` y con eso se perdían 22 de las 96 invitaciones
 *     de los próximos 60 días, la de Orán entre ellas. Ver la nota de la
 *     cabecera y `EXTENSIONES_DOCUMENTO`.
 */
export function urlDeInvitacion(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpio = valor.trim();
  if (!limpio.startsWith('https://')) return null;
  const codificado = limpio.replace(/ /g, '%20');
  // La comprobación va sobre la ruta, no sobre la cadena entera: una URL con
  // `?` detrás del `.docx` sigue siendo un documento.
  let ruta: string;
  try {
    ruta = new URL(codificado).pathname.toLowerCase();
  } catch {
    return null;
  }
  return EXTENSIONES_DOCUMENTO.some((ext) => ruta.endsWith(ext)) ? codificado : null;
}

/**
 * Título del documento, en castellano y sin inventarse nada.
 *
 * La FIE no publica un título para el PDF: publica el enlace. Se compone con
 * el nombre del torneo, que es lo que permite reconocerlo en la pantalla de
 * revisión y en la ficha («Invitación · Lima World Cup 2026»). No se usa el
 * nombre del fichero: viene con el número de subida delante
 * («205601-Invitation Cadet and Junior…»), que no es para leerlo.
 */
function tituloDeInvitacion(nombreTorneo: string | null): string {
  const nombre = nombreTorneo?.replace(/\s+/g, ' ').trim();
  return nombre ? `Invitación · ${nombre}` : 'Invitación del torneo (FIE)';
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

/** Recorre una lista con un tope de peticiones simultáneas. */
async function enLotes<T, R>(
  items: T[],
  tamano: number,
  tarea: (item: T) => Promise<R>,
): Promise<R[]> {
  const salida: R[] = [];
  for (let i = 0; i < items.length; i += tamano) {
    salida.push(...(await Promise.all(items.slice(i, i + tamano).map(tarea))));
  }
  return salida;
}

/**
 * Torneos del índice que todavía no han acabado y caen dentro de la ventana.
 *
 * Se filtra por `endDate` y no por `startDate` para que un torneo que empezó
 * ayer y acaba mañana siga contando: sigue habiendo plazos vivos y el dossier
 * sigue sirviendo.
 */
export function torneosEnVentana(
  torneos: FieTournament[],
  hoy: Date = new Date(),
  dias: number = DIAS_VENTANA_FUTURO,
): FieTournament[] {
  const desde = hoy.toISOString().slice(0, 10);
  const hasta = new Date(hoy.getTime() + dias * 86_400_000).toISOString().slice(0, 10);
  return torneos.filter((t) => {
    const fin = t.endDate ?? t.startDate;
    const inicio = t.startDate ?? t.endDate;
    return !!fin && !!inicio && fin >= desde && inicio <= hasta;
  });
}

/**
 * Las pruebas de los torneos futuros, con la misma forma que las del listado.
 *
 * Existe porque el listado de pruebas se corta en hoy (ver la cabecera). Lo
 * que se compone aquí es un `FieCompetition` por prueba, cogiendo de donde de
 * verdad está cada cosa:
 *
 *  · del ÍNDICE DE TORNEOS: ciudad, país (`flag`), letra de categoría y el
 *    cartel. Los tres vienen rellenos en el 100 % de los torneos futuros.
 *  · del DETALLE DEL TORNEO: la lista de pruebas con su `competitionId`.
 *  · de la FICHA DE LA PRUEBA: solo `invitationUrl`, que es el único dato que
 *    no está en ninguno de los dos anteriores. `image`, `scheduleInfo`,
 *    `locationName` y `locationAddress` vienen vacíos en las 114 pruebas
 *    medidas, así que la ficha de la prueba NO aporta pabellón ni horario ni
 *    foto: eso sigue saliendo del dossier y del cartel del torneo.
 *
 * Un fallo en un torneo no tumba la pasada: se registra como cero pruebas de
 * ese torneo y los demás siguen. Un dossier que se pierde es un dossier; una
 * excepción aquí dejaría el calendario futuro entero sin ingerir.
 */
async function fetchPruebasDeTorneosFuturos(
  season: number,
  torneos: FieTournament[],
): Promise<{ competitions: FieCompetition[]; torneosMirados: number; peticiones: number }> {
  const ventana = torneosEnVentana(torneos);
  let peticiones = 0;

  const porTorneo = await enLotes(ventana, PETICIONES_EN_PARALELO, async (torneo) => {
    peticiones += 1;
    const detalle = await fetchJson<FieTournamentDetail>(
      `${FIE_API}/tournaments/${torneo.id}`,
    ).catch(() => null);
    const pruebas = detalle?.events ?? [];
    if (pruebas.length === 0) return [] as FieCompetition[];

    return enLotes(pruebas, PETICIONES_EN_PARALELO, async (prueba) => {
      peticiones += 1;
      const ficha = await fetchJson<Partial<FieCompetition>>(
        `${FIE_API}/competition/${prueba.season ?? season}/${prueba.competitionId}`,
      ).catch(() => null);

      return {
        id: prueba.id,
        competitionId: prueba.competitionId,
        season: prueba.season ?? season,
        name: prueba.name,
        // `isTeam` es lo que el detalle del torneo dice en vez de "I"/"E".
        type: prueba.isTeam ? 'E' : 'I',
        category: prueba.category,
        competitionCategory: torneo.competitionCategory ?? null,
        location: prueba.city ?? torneo.city,
        federation: prueba.country ?? torneo.country,
        startDate: prueba.startDate,
        endDate: prueba.endDate ?? prueba.startDate,
        weapon: prueba.weapon,
        gender: prueba.gender,
        /**
         * A null a propósito, aunque la ficha de la prueba traiga algo: es la
         * CIUDAD, no el pabellón, y `venue` ya se protege de eso más abajo.
         * Medido: `locationName` viene relleno 71/71 en el listado y las 71
         * veces es la ciudad.
         */
        locationName: null,
        locationAddress: ficha?.locationAddress ?? null,
        startTime: ficha?.startTime ?? null,
        timezone: null,
        officialSite: ficha?.officialSite ?? null,
        flag: torneo.flag ?? prueba.country ?? null,
        livestreamLink: ficha?.livestreamLink ?? null,
        livestreamResultsLink: ficha?.livestreamResultsLink ?? null,
        invitationUrl: ficha?.invitationUrl ?? null,
      } satisfies FieCompetition;
    });
  });

  return {
    competitions: porTorneo.flat(),
    torneosMirados: ventana.length,
    peticiones,
  };
}

/**
 * Trae y normaliza el calendario de una temporada FIE.
 *
 * Devuelve candidatos sin validar: `validateEvents` decide qué entra y qué va
 * a cuarentena, igual que con Skermo.
 */
export async function fetchFieSeason(
  season: number = currentFieSeason(),
): Promise<{
  candidates: unknown[];
  rowsSeen: number;
  /** Para la nota de la ejecución: cuánto ha costado el calendario futuro. */
  futuro: { torneos: number; pruebas: number; peticiones: number };
}> {
  const [competitionsPasadas, tournaments] = await Promise.all([
    fetchAllCompetitions(season),
    fetchTournamentIndex(season).catch(() => new Map<number, FieTournament>()),
  ]);

  /**
   * Y ahora lo que el listado no da: las pruebas de los torneos que todavía no
   * se han celebrado. Si esto falla se sigue con lo que hay: perder el
   * calendario futuro es malo, perder también el pasado sería peor.
   */
  const futuro = await fetchPruebasDeTorneosFuturos(season, [
    ...tournaments.values(),
  ]).catch(() => ({ competitions: [] as FieCompetition[], torneosMirados: 0, peticiones: 0 }));

  /**
   * Se unen por `competitionId`, que es la clave con la que se agrupa más
   * abajo. Manda el LISTADO cuando una prueba está en los dos sitios: es la
   * respuesta oficial de la API para esa prueba y no una composición nuestra.
   */
  const porId = new Map<number, FieCompetition>();
  for (const c of futuro.competitions) porId.set(c.competitionId, c);
  for (const c of competitionsPasadas) porId.set(c.competitionId, c);
  const competitions = [...porId.values()];

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
    // Un torneo con la sede sin adjudicar NO entra en el índice: si entrase,
    // su clave sería "tbd|fecha" y absorbería cualquier otra prueba de ese día
    // que tampoco tuviera sede. Peor todavía, el cruce inverso le colgaría a
    // una prueba con sede real el nombre y la ciudad del torneo sin sede.
    const ciudad = ciudadPublicada(t.city);
    if (!ciudad || !t.startDate) continue;
    porSedeYFecha.set(claveSede(ciudad, t.startDate), t);
  }

  const buscarTorneo = (c: FieCompetition): FieTournament | undefined => {
    /**
     * `competitionId` NO es el id del torneo (para Samsun la prueba trae 47 y
     * el torneo es el 108), así que esta búsqueda directa acierta por
     * casualidad y falla en silencio: en la base había una prueba de Barcelona
     * a la que le había tocado un torneo "TBD" por esta vía, y se quedó con
     * ciudad "TBD" y sede "Barcelone". Solo se acepta si la ciudad coincide.
     */
    const directo = tournaments.get(c.competitionId);
    const ciudadPrueba = ciudadPublicada(c.locationName ?? c.location);
    if (directo) {
      const ciudadTorneo = ciudadPublicada(directo.city);
      const coinciden =
        ciudadPrueba && ciudadTorneo
          ? claveSede(ciudadPrueba, '') === claveSede(ciudadTorneo, '')
          : !ciudadPrueba && !ciudadTorneo;
      if (coinciden) return directo;
    }

    const ciudad = ciudadPrueba;
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
      /**
       * A `null` AQUÍ, y sí se leen en otra pasada.
       *
       * La lista nominal existe —`/competition/<temporada>/<competitionId>/entries`—
       * pero es **una petición por prueba**, así que no puede colgar del
       * calendario: se leería la lista de las 554 pruebas internacionales cada
       * noche. Se lee aparte, solo de las futuras y dentro de la ventana, en
       * `ingestInscritosFie` (ver `runner.ts`).
       *
       * Y `null` no es `[]`: con `null` no se toca nada, con `[]` se darían de
       * baja los inscritos que hubiera. Si esto devolviera `[]` en la pasada
       * del calendario, borraría cada noche lo que la pasada de inscritos
       * acaba de escribir.
       */
      registrations: null,
      // La FIE no publica la cuota en esta API: null, nunca un importe supuesto.
      feeEur: null,
      sourceId: String(c.id),
      /**
       * La lista de inscritos, con `competitionId` y no con `id`: ver
       * `fieEntriesUrl`. Con `id` la página respondía 200 y salía vacía.
       */
      sourceUrl: fieEntriesUrl(season, c.competitionId),
      // Su cierre (D-7) se calcula con `deadline_rule`, no viene en la API.
      registrationCloseDate: null,
    } as unknown as NormalizedCompetition;

    /**
     * El PDF de invitación del torneo. Se resuelve antes de agrupar porque
     * cada prueba lo trae por separado y una misma agrupación puede recibir
     * varias: se deduplica por URL para no meter la misma fila dos veces.
     */
    const invitacion = urlDeInvitacion(c.invitationUrl);

    const existing = grouped.get(key);
    if (existing) {
      if (c.startDate && c.startDate < existing.startDate) {
        existing.startDate = c.startDate;
      }
      if (c.endDate && c.endDate > existing.endDate) existing.endDate = c.endDate;
      existing.competitions.push(competition);
      if (invitacion && !existing.documents.some((d) => d.url === invitacion)) {
        existing.documents.push({
          title: tituloDeInvitacion(existing.name),
          url: invitacion,
          kind: 'invitacion',
        });
      }
      continue;
    }

    const circuit = mapFieCircuit(tournament?.type ?? c.competitionCategory, category);
    const city = ciudadPublicada(tournament?.city) ?? ciudadPublicada(c.location);

    /**
     * LA FIE NO PUBLICA LA SEDE. Comprobado campo a campo sobre las 61 pruebas
     * de 2026-2027 y las 414 de 2025-2026: `locationAddress` viene a null en
     * el 100 % de los casos, y `locationName` es **la misma ciudad** que
     * `location` (0 diferencias en 100 pruebas muestreadas). Tampoco la hay en
     * `/api/fie/tournaments/<id>`, que solo añade nº de tiradores y naciones.
     *
     * Por eso `venue` solo se rellena si `locationName` dice algo DISTINTO de
     * la ciudad. Copiar la ciudad en la sede no aporta un dato: hace que la
     * ficha repita "San Salvador" dos veces y que el botón prometa un pabellón
     * que nadie ha publicado.
     */
    const nombreSede = ciudadPublicada(c.locationName);
    const venue =
      nombreSede && (!city || claveSede(nombreSede, '') !== claveSede(city, ''))
        ? nombreSede
        : null;

    grouped.set(key, {
      source: 'fie',
      sourceId: key,
      sourceUrl,
      /** Se usa el nombre del torneo, no el genérico "Coupe du Monde". */
      name: tournament?.name ?? c.name ?? `Torneo FIE ${tournamentId}`,
      startDate: c.startDate ?? '',
      /**
       * SI LA FIE PUBLICA UN FIN ANTERIOR AL INICIO, MANDA EL INICIO.
       *
       * No es hipotético: «Championnats asiatiques cadets par equipes» viene
       * con 2026-02-26 → 2026-02-09 desde que existe, y por eso el torneo
       * entero se quedaba en cuarentena —«la fecha de fin no puede ser anterior
       * a la de inicio»— y volvía a quedarse **cada noche**: 19 filas del mismo
       * evento en la bandeja.
       *
       * Qué se hace con eso. No se invierten las fechas, porque suponer un
       * dedazo es suponer; y no se tira el torneo, porque entonces no existe
       * para nadie. Se usa el inicio como fin, que es lo que ya hace la línea
       * de arriba cuando la FIE no publica fin, y además es la forma en la que
       * la FIE publica las pruebas por equipos: un día.
       *
       * El dato malo no se esconde: el `endDate` de origen sigue en el
       * `raw_payload` del registro de ingestión.
       */
      endDate:
        c.endDate && c.startDate && c.endDate < c.startDate
          ? c.startDate
          : (c.endDate ?? c.startDate ?? ''),
      venue,
      venueAddress: c.locationAddress?.trim() || null,
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
      /**
       * El dossier del torneo, ENLAZADO a `static.fie.org` y nunca copiado.
       * Ver la nota «LA INVITACIÓN EN PDF» de la cabecera: es el documento que
       * lleva el pabellón, la puerta de entrada, el horario por días y las
       * cuotas, y es lo que después lee la extracción con su cita.
       */
      documents: invitacion
        ? [
            {
              title: tituloDeInvitacion(tournament?.name ?? c.name),
              url: invitacion,
              kind: 'invitacion',
            },
          ]
        : [],
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

  return {
    candidates: [...grouped.values()],
    rowsSeen: competitions.length,
    futuro: {
      torneos: futuro.torneosMirados,
      pruebas: futuro.competitions.length,
      peticiones: futuro.peticiones,
    },
  };
}

// ===========================================================================
// LISTAS DE INSCRITOS
// ===========================================================================

/**
 * Un inscrito español, con los tres campos que se guardan y ni uno más.
 *
 * Este tipo ES el filtro: lo que no está aquí no existe aguas abajo, así que
 * no hay forma de guardar una fecha de nacimiento ni una foto por descuido.
 */
export type InscritoFie = {
  /** "LLAVADOR Carlos", compuesto de apellido + nombre tal y como los publica. */
  nombre: string;
  /**
   * Nombre del equipo en las pruebas por equipos ("Spain"); cadena vacía en
   * las individuales, que es lo que espera la clave única de la tabla.
   */
  equipo: string;
  /**
   * El `licenseNumber` de la FIE. Ojo: es DDMMAAAA + 3 dígitos, o sea que
   * **lleva dentro la fecha de nacimiento**. Se guarda porque es la llave del
   * emparejado, pero quien lo lea tiene que saber qué está leyendo.
   */
  licencia: string | null;
  /** `registeredAt`: el día en que la FIE registró la inscripción. */
  inscritoEl: string | null;
  /**
   * `fencer.id` de la FIE. No se guarda en la inscripción, sino como
   * referencia con ámbito (`sport_registration_ref`) si la migración 0018
   * está aplicada. Sirve para emparejar contra `fie_fencer.fie_id`, que es un
   * enlace confirmado por una persona y por tanto mejor prueba de identidad
   * que cualquier licencia.
   */
  fieId: number | null;
};

/** Solo los campos que se leen de la respuesta. El resto ni se nombra. */
type FieEntryFencer = {
  id?: unknown;
  name?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  countryCode?: unknown;
  licenseNumber?: unknown;
};

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = fixDoubleEncodedUtf8(valor).replace(/\s+/g, ' ').trim();
  return limpio || null;
}

/** "2026-09-08" y nada más: una fecha que no lo sea se descarta. */
function diaPublicado(valor: unknown): string | null {
  const limpio = texto(valor);
  return limpio && /^\d{4}-\d{2}-\d{2}$/.test(limpio) ? limpio : null;
}

/**
 * EL FILTRO. Convierte la respuesta de `/entries` en la lista de españoles.
 *
 * Tres cosas pasan aquí y ninguna puede pasar en otro sitio:
 *
 *  1. **Se tiran los que no son `ESP`.** No es una preferencia: es la decisión
 *     que tomó el usuario, literal — *«Solo españoles, sin datos de menores»*.
 *     Y el país se mira en `countryCode`, que viene en ISO-3166 alfa-3 y
 *     relleno en las 54 listas medidas; `flag` ("ES") y `country` ("SPAIN")
 *     son respaldos porque son el mismo dato escrito de otra forma, no una
 *     segunda opinión.
 *  2. **Se tiran los campos que no se guardan.** `date` (fecha de nacimiento),
 *     `age`, `height`, `image`, los puntos y los puestos no se copian a la
 *     salida, así que no llegan a la capa que escribe. Que sea IMPOSIBLE
 *     guardarlos vale más que confiar en que nadie lo haga.
 *  3. **El nombre se compone de apellido + nombre.** En las pruebas por
 *     equipos `name` es el nombre del EQUIPO ("Spain") y el tirador está en
 *     `lastName`/`firstName`; usar `name` metería cuatro filas llamadas
 *     "Spain". Cuando `name` dice algo distinto del nombre compuesto, es el
 *     equipo, y ahí va.
 *
 * Nunca lanza: una respuesta con otra forma devuelve lista vacía. Perder una
 * lista es perder una lista; una excepción aquí se llevaría por delante la
 * ingestión de las otras 53.
 */
export function inscritosEspanolesDeLaFie(payload: unknown): InscritoFie[] {
  const items =
    payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items)
      ? ((payload as { items: unknown[] }).items as unknown[])
      : [];

  const salida: InscritoFie[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const fila = item as { fencer?: unknown; registeredAt?: unknown };
    if (!fila.fencer || typeof fila.fencer !== 'object') continue;
    const f = fila.fencer as FieEntryFencer;

    /** Punto 1: la nacionalidad. Lo que no sea ESP se va sin escribirse. */
    const pais = (texto(f.countryCode) ?? '').toUpperCase();
    const bandera = (texto((f as { flag?: unknown }).flag) ?? '').toUpperCase();
    const esEspanol = pais ? pais === PAIS_PROPIO : bandera === 'ES';
    if (!esEspanol) continue;

    /** Punto 3: el nombre, compuesto; y el equipo, si `name` dice otra cosa. */
    const apellido = texto(f.lastName);
    const nombrePropio = texto(f.firstName);
    const publicado = texto(f.name);
    const compuesto =
      apellido && nombrePropio
        ? `${apellido} ${nombrePropio}`
        : (apellido ?? nombrePropio ?? publicado);
    if (!compuesto || compuesto.length < 2) continue;

    const equipo = publicado && publicado !== compuesto ? publicado : '';

    /** Punto 2: y de todo lo demás, estos tres campos. */
    salida.push({
      nombre: compuesto,
      equipo,
      licencia: texto(f.licenseNumber),
      inscritoEl: diaPublicado(fila.registeredAt),
      fieId: typeof f.id === 'number' && Number.isInteger(f.id) ? f.id : null,
    });
  }

  return salida;
}

/**
 * Pide la lista de una prueba y devuelve ya solo a los españoles.
 *
 * `totalPublicados` es el total de la FIE —todas las nacionalidades— y se
 * devuelve **solo para poder contarlo en la nota de la ejecución**: es el
 * número que permite decir «de 70 inscritos, 9 españoles» y detectar el día
 * que una lista pase de `TOPE_INSCRITOS`. No se guarda en ninguna fila.
 */
export async function fetchInscritosFie(
  season: number,
  competitionId: number,
): Promise<{ inscritos: InscritoFie[]; totalPublicados: number; recibidos: number }> {
  const payload = await fetchJson<unknown>(fieEntriesApiUrl(season, competitionId));
  const total =
    payload && typeof payload === 'object'
      ? Number((payload as { totalFound?: unknown }).totalFound ?? 0)
      : 0;
  const recibidos =
    payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items.length
      : 0;

  return {
    inscritos: inscritosEspanolesDeLaFie(payload),
    totalPublicados: Number.isFinite(total) ? total : 0,
    recibidos,
  };
}

export type DecisionInscritos =
  | { leer: true; motivo: 'primera_vez' | 'cierre_cerca' | 'revision'; explicacion: string }
  | { leer: false; explicacion: string };

/**
 * ¿Toca pedir la lista de inscritos de esta prueba?
 *
 * Función pura y con sus casos en `tests/inscritos-fie.test.ts`, por el mismo
 * motivo que `tocaLeerRanking`: los fallos de calendario —el día justo, el
 * cambio de mes, la prueba de hoy— no se encuentran razonando, se encuentran
 * con casos.
 *
 * Las cuatro reglas, y cada una con su número detrás:
 *
 *  1. **Pasada la prueba, nunca más.** La lista se queda como quedó, que es el
 *     dato histórico correcto.
 *  2. **Más allá de `DIAS_VENTANA_INSCRITOS`, tampoco.** 0 españoles en las 48
 *     pruebas medidas entre D+31 y D+90.
 *  3. **Si no se ha leído nunca, se lee.** Cubre el primer despliegue y el
 *     torneo que acaba de entrar en la ventana.
 *  4. **Dentro de la ventana:** todos los días si el cierre está encima
 *     (`DIAS_ZONA_CALIENTE`), y cada `DIAS_ENTRE_LECTURAS` si todavía queda.
 *
 * Y de ahí sale el número que importa: **una segunda pasada el mismo día
 * cuesta 0 peticiones**, porque todo lo de la ventana se leyó hoy.
 */
export function tocaLeerInscritos(
  ahora: Date,
  fechaPrueba: string | null,
  ultimaLectura: Date | null,
): DecisionInscritos {
  if (!fechaPrueba) {
    return {
      leer: false,
      explicacion: 'La prueba no tiene día publicado, así que no se sabe si la lista está viva.',
    };
  }

  const hoy = ahora.toISOString().slice(0, 10);
  const dia = fechaPrueba.slice(0, 10);

  if (dia < hoy) {
    return { leer: false, explicacion: `La prueba se disputó el ${dia}; su lista ya no cambia.` };
  }

  const diasHasta = Math.round(
    (new Date(`${dia}T12:00:00Z`).getTime() - new Date(`${hoy}T12:00:00Z`).getTime()) / 86_400_000,
  );

  if (diasHasta > DIAS_VENTANA_INSCRITOS) {
    return {
      leer: false,
      explicacion:
        `Faltan ${diasHasta} días y la inscripción de la FIE cierra a D-7: ` +
        `fuera de la ventana de ${DIAS_VENTANA_INSCRITOS} días la lista está vacía o a medias.`,
    };
  }

  if (!ultimaLectura) {
    return {
      leer: true,
      motivo: 'primera_vez',
      explicacion: 'No se ha leído nunca la lista de esta prueba.',
    };
  }

  const diasDesde = Math.floor((ahora.getTime() - ultimaLectura.getTime()) / 86_400_000);

  if (diasHasta <= DIAS_ZONA_CALIENTE) {
    if (diasDesde >= 1) {
      return {
        leer: true,
        motivo: 'cierre_cerca',
        explicacion:
          `Faltan ${diasHasta} días: el cierre está encima y la lista se mira ` +
          `todos los días.`,
      };
    }
    return { leer: false, explicacion: 'La lista ya se ha leído hoy.' };
  }

  if (diasDesde >= DIAS_ENTRE_LECTURAS) {
    return {
      leer: true,
      motivo: 'revision',
      explicacion:
        `Faltan ${diasHasta} días y la lista se leyó hace ${diasDesde}: ` +
        `toca la revisión de cada ${DIAS_ENTRE_LECTURAS} días.`,
    };
  }

  return {
    leer: false,
    explicacion:
      `Faltan ${diasHasta} días y la lista se leyó hace ${diasDesde}; ` +
      `se vuelve a mirar a los ${DIAS_ENTRE_LECTURAS}.`,
  };
}

/**
 * Huella de una lista de inscritos, para no reescribir lo que no ha cambiado.
 *
 * Entra lo que se guarda: nombre, equipo, licencia, día de inscripción y el ID
 * de la FIE, ordenados para que el orden en que la FIE los devuelva no cuente
 * como un cambio. El ID entra porque una lista con los mismos nombres pero un
 * ID nuevo hay que reescribirla para retener la referencia.
 *
 * `conReferencias` dice si la tabla de referencias existe. Entra para que el
 * día que se aplique la migración la huella cambie y cada lista se reescriba
 * una vez con sus IDs, en vez de quedarse «sin cambios» para siempre sin ellos.
 *
 * Y entra también `destino`, que es la prueba en la que la lista se escribe.
 * Parece de más y no lo es: si esa prueba cambia —pasa cuando el torneo
 * español empieza a publicar su propia lista y hay que retirar la nuestra— la
 * lista tiene que volver a escribirse en su sitio nuevo aunque los nombres
 * sean exactamente los de ayer. Sin el destino dentro, la huella coincidiría,
 * no se escribiría nada y la lista se quedaría sin sitio.
 */
export async function huellaDeInscritos(
  inscritos: InscritoFie[],
  destino: string,
  conReferencias = false,
): Promise<string> {
  const filas = inscritos
    .map((i) =>
      [i.nombre, i.equipo, i.licencia ?? '', i.inscritoEl ?? '', i.fieId ?? ''].join('|'),
    )
    .sort();
  return sha256(JSON.stringify([destino, conReferencias, filas]));
}
