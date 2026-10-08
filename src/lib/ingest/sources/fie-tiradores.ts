import { z } from 'zod';
import { AHORA_SQL, enLista as inArray, lotesDeInsercion } from '@/lib/sqlite';
import { mapCategory, mapGender, mapWeapon } from '../mappers';
import { formatZodIssues } from '../types';
import { fetchJson } from '../fetcher';
import { currentFieSeason } from './fie';

/**
 * FICHAS DE TIRADOR DE LA FIE: foto, puesto mundial y poco más.
 *
 * =========================================================================
 * QUÉ PUBLICA LA FIE POR TIRADOR, COMPROBADO EN VIVO EL 26/09/2026
 * =========================================================================
 * `robots.txt` de `fie.org` dice `User-agent: * / Disallow:` — sin
 * restricciones de rastreo. Y no hace falta scraping: hay API JSON pública,
 * la misma que ya usa el calendario en `fie.ts`.
 *
 * Adivinar rutas no sirve (`/athletes`, `/fencers`, `/athlete/<id>`... todas
 * 404). Los dos endpoints que existen se encontraron leyendo los 58 trozos de
 * JavaScript de su Nuxt y buscando `api/fie/`:
 *
 * 1. `GET /api/fie/fencers/ranking?country=ESP&page=1&pageSize=1000`
 *    EL HALLAZGO IMPORTANTE. Una sola petición devuelve el censo español
 *    entero —403 filas, 343 tiradores distintos— y cada fila YA TRAE LA FOTO
 *    y la fecha de nacimiento:
 *      id, name ("LLAVADOR Carlos"), firstName, lastName, country,
 *      countryCode, weapon (F/E/S), gender, points, date (nacimiento),
 *      category (S/J/C/V), ageBand, hand (L/R), height, rank (puesto
 *      MUNDIAL), flag, image (URL en static.fie.org).
 *    Filtros útiles descubiertos probándolos: `country` (alfa-3) y `name`.
 *    `search` y `countryCode` se ignoran en silencio. Sin `country` devuelve
 *    los 11.465 del mundo, así que filtrar por país no es una optimización:
 *    es no descargarse su base de datos.
 *    Su paginación es floja: declara `totalFound: 415` y entrega 403 filas
 *    únicas (la página 1 devuelve 88 en vez de 100). Por eso se para cuando
 *    una página viene vacía, no cuando se alcanza `totalFound`.
 *
 * 2. `GET /api/fie/fencer/<id>`  (singular; el plural da 404)
 *    La ficha completa. De aquí interesan `licenseNumber`, `licenseStatus` y
 *    el array `ranking`, que publica el puesto mundial de CADA temporada
 *    desde 2009 (19 entradas en el caso de Llavador).
 *
 * 3. `GET /api/fie/fencers/detailed-ranking?season&weapon&gender&category&type=I`
 *    Da `competitionPoints` por tirador, de donde sale el nº de pruebas que
 *    le puntúan en la temporada. Pesa ~250 KB por combinación, así que solo
 *    se pide para las combinaciones donde hay alguien YA enlazado.
 *
 * QUÉ **NO** PUBLICA, y por tanto aquí no aparece:
 *  - Ningún identificador común con la RFEE. Su `licenseNumber` es la fecha
 *    de nacimiento en DDMMAAAA más tres dígitos ("26041992000" para alguien
 *    nacido el 26/04/1992), no la licencia española ("CLF01835").
 *  - El club: viene a `null` en las dos fichas reales que tenemos.
 *  - La altura: `null`.
 *  - No hay buscador de tiradores por nombre libre (`/api/fie/fencer/search`
 *    responde 400 pidiendo un `id` numérico) ni endpoint de resultados por
 *    tirador (`/api/fie/fencer/<id>/results` → 404).
 *
 * =========================================================================
 * LÍMITE LEGAL
 * =========================================================================
 * Se guarda el mínimo (ver `src/db/schema/fie.ts`), la foto se ENLAZA a
 * `static.fie.org` y no se copia a R2, y se enlaza siempre a la ficha
 * original.
 *
 * **Del censo español sí se guarda el puesto mundial, y antes no.** Aquí se
 * persistían solo los tiradores con ficha en esta aplicación o candidatos de
 * uno —2 de 403— con el argumento de que un índice de referencias no es una
 * copia de su base de datos. Cambió con una autorización expresa del usuario:
 * *«ok todo y pido los permisos… me han dado el ok para mostrarlo, o sea es
 * interno y no público»*.
 *
 * PROCEDENCIA DEL PERMISO, para que esto sea auditable y no una decisión sin
 * dueño: el usuario dice tenerlo por escrito en un hilo de correo con un cargo
 * directivo de la FIE que además lo es de la federación española. El correo no
 * está en este repositorio y aquí no se nombra a nadie; si alguna vez hay que
 * justificarlo, lo aporta el usuario. **Es verbal para este código**, y por eso
 * el alcance se deja estrecho a propósito y la vuelta atrás es de una línea.
 *
 * Después el usuario amplió el alcance a todo el contenido de la FIE: *«todos
 * tenemos todo esto y los permisos para todo»*. Por eso se guardan enteras la
 * clasificación mundial y su histórico desde 2003
 * (`scripts/rankings-internacionales.ts`).
 *
 * La aplicación entera está detrás de sesión y de cada tirador se guarda poco:
 *
 *  - **censo solo de España**, porque se pide por país. De los demás solo hay
 *    nombre, país, puesto y puntos de las clasificaciones.
 *  - **ni fecha de nacimiento, ni foto, ni mano, ni licencia** de quien no es
 *    uno de los nuestros: hay menores en ese censo. Queda el nombre, el arma,
 *    la categoría, el puesto, los puntos y el enlace a su ficha.
 *  - **el enlace al original siempre**, que es lo que distingue citar de
 *    copiar.
 *
 * Si el permiso se deniega, se vuelve atrás cambiando un conjunto por otro:
 * ver `censoEspanol` frente a `fieIdsDeInteres`.
 *
 * =========================================================================
 * COSTE EN PETICIONES
 * =========================================================================
 * 1 (censo español) + 1 por candidato (hoy 2) + 1 por combinación con alguien
 * enlazado (hoy 2) = 4, más **48 de la clasificación mundial** (24 individuales
 * y 24 de selecciones) = **~52 peticiones al día y 2,8 MB**, medido el
 * 28/09/2026.
 *
 * Las 4 primeras no crecen con la FIE, crecen con nuestros tiradores. Las 48
 * son fijas: son todas las combinaciones de arma × género × categoría que
 * existen, y la clasificación entera no sirve a medias —una tabla con cuatro
 * armas de seis es peor que no tenerla—. Van de una en una, con espera entre
 * medias, contra un servidor que no nos debe nada.
 *
 * El presupuesto está topado por `maxFichas`, `maxCombosPruebas` y
 * `maxCombosClasificacion` para que una carga inicial no se convierta en un
 * martilleo.
 */

const FIE_API = 'https://fie.org/api/fie';

/** Anfitrión de las fotos. Se valida para no guardar una URL de cualquier sitio. */
const FOTO_HOST = 'static.fie.org';

export const FIE_COUNTRY_ESP = 'ESP';

export function fieCensoUrl(
  country: string,
  page: number,
  pageSize: number,
): string {
  return `${FIE_API}/fencers/ranking?country=${encodeURIComponent(country)}&page=${page}&pageSize=${pageSize}`;
}

export function fieFichaApiUrl(fieId: number): string {
  // Singular a propósito: `/api/fie/fencers/<id>` devuelve 404.
  return `${FIE_API}/fencer/${fieId}`;
}

/** La ficha pública, que es a donde se enlaza siempre desde la interfaz. */
export function fieFichaPublicaUrl(fieId: number): string {
  return `https://fie.org/athletes/${fieId}`;
}

/**
 * La misma foto de la FIE, pero al ancho que hace falta, redimensionada POR
 * LA FIE.
 *
 * Las fotos originales son enormes: la de Carlos Llavador pesa **944 KB** y la
 * de María Mariño 588 KB (medido el 26/09/2026). Poner eso en un avatar de 32
 * píxeles al lado de un nombre, en la lista de inscritos y desde el móvil, es
 * inaceptable.
 *
 * Y no se puede arreglar por nuestra cuenta: pasarla por el optimizador de
 * imágenes de Next significaría descargarla, transformarla y servirla desde
 * nuestro dominio, es decir REHOSPEDARLA, que es exactamente lo que los
 * términos de la FIE prohíben. Por eso esto no es una optimización: es la
 * condición para poder enseñar la foto.
 *
 * La salida es usar el redimensionador que la propia FIE tiene delante de su
 * sitio. `fie.org/cdn-cgi/image/...` es el Cloudflare Images de ellos, el
 * mismo que usan para su logotipo (se ve en el HTML de fie.org). La
 * transformación ocurre en SU infraestructura y con SU dominio; nosotros
 * seguimos teniendo solo un enlace.
 *
 * Medido en vivo sobre la foto de Llavador: 944 KB -> **2,9 KB** a 96 px,
 * 7,3 KB a 192, 16 KB a 320 y 52 KB a 640. Funciona igual con los nombres de
 * archivo acentuados de la FIE (`%C3%91`), que era el riesgo evidente.
 *
 * AVISO PARA LA INTERFAZ: hay que pintarlas con `<img>` o con
 * `<Image unoptimized>`. Si las optimiza Next, se vuelven a copiar a nuestro
 * dominio y se rompe la promesa.
 */
export function fotoFieAncho(
  fotoUrl: string | null,
  ancho: number,
): string | null {
  if (!fotoUrl) return null;
  return `https://fie.org/cdn-cgi/image/width=${ancho},quality=80,format=auto/${fotoUrl}`;
}

/**
 * `type` de la FIE: individual o por equipos (selecciones).
 *
 * Los dos valores válidos los dijo su propia API al rechazar `type=T`:
 * «Invalid option: expected one of "I"|"E" at type». `E` es de «équipes».
 */
export type TipoRankingFie = 'I' | 'E';

export function fieDetailedRankingUrl(params: {
  season: number;
  weapon: string;
  gender: string;
  category: string;
  tipo?: TipoRankingFie;
}): string {
  const { season, weapon, gender, category, tipo = 'I' } = params;
  return `${FIE_API}/fencers/detailed-ranking?season=${season}&weapon=${weapon}&gender=${gender}&category=${category}&type=${tipo}`;
}

/**
 * Las 24 combinaciones de la clasificación mundial, medidas en vivo.
 *
 * Armas × géneros × las cuatro categorías que publica la FIE. No todas
 * existen: comprobado el 28/09/2026, **la FIE no publica ranking de equipos
 * cadete** (las seis combinaciones `C` de `type=E` vienen vacías) y tampoco
 * espada femenina veterana. Se piden igual y se registra que vinieron vacías,
 * que es distinto de no haberlas pedido.
 */
export const COMBINACIONES_FIE: { weapon: string; gender: string; category: string }[] =
  ['F', 'E', 'S'].flatMap((weapon) =>
    ['M', 'F'].flatMap((gender) =>
      ['S', 'J', 'C', 'V'].map((category) => ({ weapon, gender, category })),
    ),
  );

/** Una fila de la clasificación, como la publica la FIE. */
export type FilaClasificacionFie = {
  rank: number | null;
  addrId: number;
  name: string | null;
  country: string | null;
  countryCode: string | null;
  points: string | null;
  eventCount: number | null;
};

/**
 * La clasificación de UNA combinación, individual o por selecciones.
 *
 * Pesa entre 2 kB (veteranos por equipos) y 324 kB (espada masculina absoluta
 * individual), así que se pide de una en una y con espera entre medias: son 48
 * peticiones al día contra un servidor que no nos debe nada.
 */
export async function fetchClasificacionFie(params: {
  season: number;
  weapon: string;
  gender: string;
  category: string;
  tipo: TipoRankingFie;
}): Promise<FilaClasificacionFie[]> {
  const data = await fetchJson<{
    fencers?: {
      rank?: number | null;
      addrId?: number;
      name?: string | null;
      country?: string | null;
      countryCode?: string | null;
      points?: string | null;
      competitionPoints?: Record<string, string> | null;
    }[];
  }>(fieDetailedRankingUrl(params), { timeoutMs: 90_000, retries: 0 });

  const out: FilaClasificacionFie[] = [];
  for (const f of data.fencers ?? []) {
    if (typeof f.addrId !== 'number') continue;
    const nombre = (f.name ?? '').trim();
    out.push({
      rank: typeof f.rank === 'number' ? f.rank : null,
      addrId: f.addrId,
      // En selecciones la FIE manda `" "`: un nombre en blanco no es un nombre.
      name: nombre === '' ? null : nombre,
      country: f.country?.trim() || null,
      countryCode: f.countryCode?.trim() || null,
      points: f.points ?? null,
      eventCount: f.competitionPoints
        ? Object.keys(f.competitionPoints).length
        : null,
    });
  }
  return out;
}

// ------------------------------------------------------------ Validación ---

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe venir como YYYY-MM-DD');

/**
 * Una URL de foto solo se acepta si apunta a `static.fie.org`.
 *
 * No es paranoia: es la garantía técnica de que la promesa de "se enlaza, no
 * se copia" se cumple. Si mañana la FIE devolviese una ruta relativa o un
 * dominio raro, la fila se va a cuarentena en vez de acabar en un `<img>`
 * apuntando a cualquier parte.
 */
const fotoFie = z
  .string()
  .url('La foto tiene que ser una URL absoluta')
  .refine((u) => {
    try {
      return new URL(u).host === FOTO_HOST;
    } catch {
      return false;
    }
  }, `La foto tiene que estar en ${FOTO_HOST}: no se rehospeda ni se copia`)
  .nullable();

/**
 * Fila del censo. Lo que no valide NO entra: a `ingest_quarantine` y al panel
 * de admin. Una foto o un puesto mal leídos se los cuelga la aplicación a una
 * persona con nombre y apellidos, así que el borde se valida entero.
 */
export const fieCensoRowSchema = z.object({
  id: z.number().int().positive('Sin id de la FIE no hay ficha que enlazar'),
  name: z.string().min(2, 'Una fila sin nombre no sirve'),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  countryCode: z.string().min(2).nullable(),
  weapon: z.string().min(1),
  gender: z.string().min(1),
  points: z.string().nullable(),
  /** Fecha de nacimiento. Es la única evidencia objetiva del emparejado. */
  date: isoDate.nullable(),
  category: z.string().min(1),
  ageBand: z.string().nullable(),
  hand: z.string().nullable(),
  rank: z.number().int().positive().nullable(),
  image: fotoFie,
});

export type FieCensoRow = z.infer<typeof fieCensoRowSchema>;

/** Una temporada del histórico de puestos que publica la ficha. */
export const fieHistoricoRowSchema = z.object({
  rank: z.number().int().positive().nullable(),
  point: z.string().nullable(),
  weapon: z.string().min(1),
  season: z.number().int().positive(),
  category: z.string().min(1),
});

export const fieFichaSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(2),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  countryCode: z.string().min(2).nullable(),
  gender: z.string().min(1),
  date: isoDate.nullable(),
  hand: z.string().nullable(),
  image: fotoFie,
  /**
   * El número de licencia de la FIE. Se valida el FORMATO (DDMMAAAA + 3
   * dígitos) porque es lo que permite comprobarlo contra la fecha de
   * nacimiento; si algún día cambia de forma, preferimos enterarnos por la
   * cuarentena que emparejar a ciegas.
   */
  licenseNumber: z.string().nullable(),
  licenseStatus: z.string().nullable(),
  ranking: z.array(fieHistoricoRowSchema).default([]),
});

export type FieFicha = z.infer<typeof fieFichaSchema>;

export type FieCuarentena = {
  sourceId: string | null;
  raw: unknown;
  errors: { path: string; message: string }[];
};

export function validarCenso(filas: unknown[]): {
  valid: FieCensoRow[];
  quarantined: FieCuarentena[];
} {
  const valid: FieCensoRow[] = [];
  const quarantined: FieCuarentena[] = [];

  for (const fila of filas) {
    const parsed = fieCensoRowSchema.safeParse(fila);
    if (parsed.success) {
      valid.push(parsed.data);
      continue;
    }
    const id =
      fila && typeof fila === 'object' && 'id' in fila
        ? String((fila as { id: unknown }).id)
        : null;
    quarantined.push({
      sourceId: id,
      raw: fila,
      errors: formatZodIssues(parsed.error),
    });
  }

  return { valid, quarantined };
}

// -------------------------------------------------------- Identificadores ---

/**
 * La fecha de nacimiento escondida en el número de licencia de la FIE.
 *
 * "26041992000" -> "1992-04-26". Es DDMMAAAA más tres dígitos de desempate,
 * comprobado con las dos fichas reales de la aplicación (Llavador
 * "26041992000" nacido el 26/04/1992; Mariño "31011993000" nacida el
 * 31/01/1993).
 *
 * Sirve para una cosa muy concreta y muy útil: **comprobar** que la licencia
 * FIE que nos dan es coherente con la fecha de nacimiento que tenemos. No
 * sirve para adivinar la licencia de nadie —los tres últimos dígitos no son
 * deducibles— y no se usa para eso.
 */
export function fechaNacimientoDeLicenciaFie(
  licencia: string | null | undefined,
): string | null {
  if (!licencia) return null;
  const limpia = licencia.replace(/\D/g, '');
  if (limpia.length < 8) return null;
  const dia = limpia.slice(0, 2);
  const mes = limpia.slice(2, 4);
  const anyo = limpia.slice(4, 8);
  const fecha = `${anyo}-${mes}-${dia}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  // Una fecha imposible (mes 13, día 32) significa que el formato no es el que
  // creemos, y entonces mejor no afirmar nada.
  const d = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== fecha) return null;
  return fecha;
}

/** Normaliza una licencia para compararla: sin espacios, guiones ni mayúsculas. */
export function normalizarLicenciaFie(valor: string | null | undefined): string {
  return (valor ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

// ------------------------------------------------------------ Emparejado ---

/**
 * Trozos comparables de un nombre: sin acentos, en mayúsculas y sin partículas.
 *
 * La FIE escribe "LLAVADOR Carlos" —apellido primero, en mayúsculas y sin
 * acentos ("MARINO" por "Mariño")— y encima suele traer UN solo apellido
 * donde la RFEE trae dos. Por eso se comparan conjuntos de palabras y no
 * cadenas: "MARINO" contra "Mariño Blanco" tiene que poder reconocerse, y
 * "Mariño Blanco" contra "MARINO LASSO" tiene que poder rechazarse.
 */
export function trozosDeNombre(valor: string | null | undefined): string[] {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !PARTICULAS.has(t));
}

/** Partículas que no identifican a nadie y varían entre fuentes. */
const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'DA', 'DO']);

export type TiradorNuestro = {
  id: string;
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD. */
  birthDate: string;
  gender: string;
  /** `athlete.fie_license`, si alguien la ha rellenado. */
  fieLicense: string | null;
};

export type Candidato = {
  fieId: number;
  athleteId: string;
  /** La fila del censo que lo propone (la de mejor puesto, si hay varias). */
  fila: FieCensoRow;
  /** La fecha de nacimiento coincide al día. */
  fechaExacta: boolean;
  /** Frase para que una persona decida sin abrir la consola. */
  evidencia: string;
};

/**
 * Propone candidatos. **No empareja nada.**
 *
 * El criterio, y el motivo de cada condición:
 *
 *  1. Mismo género. Trivial, y corta la mitad del censo.
 *  2. Al menos un nombre de pila en común. La FIE trae "Carlos" y nosotros
 *     "Carlos"; con nombres compuestos basta con que uno coincida.
 *  3. TODOS los apellidos de la FIE tienen que estar entre los nuestros. Así
 *     "LLAVADOR" ⊆ {LLAVADOR, FERNANDEZ} pasa, y "MARINO LASSO" ⊄ {MARINO,
 *     BLANCO} no pasa. La dirección importa: la FIE abrevia, nosotros no, y
 *     al revés la regla dejaría entrar a cualquier homónimo parcial.
 *  4. Mismo AÑO de nacimiento como mínimo. Sin esta condición, un nombre
 *     frecuente propondría a un cadete para la ficha de un absoluto. Se
 *     acepta el año y no solo el día exacto a propósito: si una de las dos
 *     fuentes tiene un dedazo en el día, queremos verlo en la cola, no
 *     perderlo en silencio.
 *
 * Lo que sale de aquí es una PROPUESTA con su evidencia escrita. Quien decide
 * es una persona, o la coincidencia del número de licencia FIE. Medido contra
 * los 403 del censo español y los 12 tiradores de la base: 2 propuestas, las
 * dos correctas, y cero propuestas para los 10 de demostración.
 */
export function proponerCandidatos(
  nuestros: TiradorNuestro[],
  censo: FieCensoRow[],
): Candidato[] {
  const propuestas: Candidato[] = [];

  for (const tirador of nuestros) {
    const nombres = new Set(trozosDeNombre(tirador.firstName));
    const apellidos = new Set(trozosDeNombre(tirador.lastName));
    if (nombres.size === 0 || apellidos.size === 0) continue;

    /** fieId -> mejor fila de ese tirador en la FIE. */
    const porFieId = new Map<number, FieCensoRow>();

    for (const fila of censo) {
      if (mapGender(fila.gender) !== mapGender(tirador.gender)) continue;
      if (!fila.date) continue;
      if (fila.date.slice(0, 4) !== tirador.birthDate.slice(0, 4)) continue;

      const suNombre = trozosDeNombre(fila.firstName ?? fila.name);
      const suApellido = trozosDeNombre(fila.lastName);
      if (suApellido.length === 0) continue;
      if (!suNombre.some((t) => nombres.has(t))) continue;
      if (!suApellido.every((t) => apellidos.has(t))) continue;

      const previa = porFieId.get(fila.id);
      // Se queda la fila de mejor puesto: es la que mejor describe al tirador.
      if (!previa || (fila.rank ?? 9e9) < (previa.rank ?? 9e9)) {
        porFieId.set(fila.id, fila);
      }
    }

    for (const fila of porFieId.values()) {
      const fechaExacta = fila.date === tirador.birthDate;
      const evidencia = [
        `la FIE lo publica como «${fila.name}»`,
        fechaExacta
          ? `misma fecha de nacimiento (${fila.date})`
          : `mismo año de nacimiento, pero la FIE dice ${fila.date} y nosotros ${tirador.birthDate}`,
        `${porFieId.size === 1 ? 'candidato único' : `${porFieId.size} candidatos para el mismo tirador`}`,
      ].join('; ');

      propuestas.push({
        fieId: fila.id,
        athleteId: tirador.id,
        fila,
        fechaExacta,
        evidencia,
      });
    }
  }

  return propuestas;
}

// ----------------------------------------------------------- Descarga ---

type CensoRespuesta = {
  totalFound?: number;
  page?: number;
  pageSize?: number;
  items?: unknown[];
};

/**
 * El censo de un país, paginado hasta que se acaba.
 *
 * NO se usa `totalFound` como condición de parada: la FIE declara 415 y
 * entrega 403 filas únicas (su página 1 devuelve 88 en vez de las 100
 * pedidas). Confiar en su contador dejaría un bucle esperando 12 filas que no
 * van a llegar. Se para cuando una página viene vacía, y hay tope de páginas.
 */
export async function fetchCensoFie(
  country = FIE_COUNTRY_ESP,
  options: { pageSize?: number; maxPaginas?: number } = {},
): Promise<{ filas: unknown[]; peticiones: number; totalDeclarado: number | null }> {
  const { pageSize = 1000, maxPaginas = 10 } = options;
  const filas: unknown[] = [];
  const vistos = new Set<string>();
  let peticiones = 0;
  let totalDeclarado: number | null = null;

  for (let page = 1; page <= maxPaginas; page += 1) {
    const data = await fetchJson<CensoRespuesta>(
      fieCensoUrl(country, page, pageSize),
      { timeoutMs: 60_000 },
    );
    peticiones += 1;
    totalDeclarado = data.totalFound ?? totalDeclarado;

    const items = data.items ?? [];
    if (items.length === 0) break;

    for (const item of items) {
      /**
       * La misma persona sale una vez por arma y categoría, y la paginación de
       * la FIE repite filas entre páginas. Se desduplica por la clave natural
       * de la fila, no por tirador: sus dos rankings son dos hechos distintos.
       */
      const clave = claveFilaCenso(item);
      if (clave && vistos.has(clave)) continue;
      if (clave) vistos.add(clave);
      filas.push(item);
    }

    if (items.length < pageSize) break;
  }

  return { filas, peticiones, totalDeclarado };
}

function claveFilaCenso(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  if (typeof o.id !== 'number') return null;
  return `${o.id}|${o.weapon}|${o.gender}|${o.category}|${o.ageBand ?? ''}`;
}

export async function fetchFichaFie(fieId: number): Promise<unknown> {
  return fetchJson<unknown>(fieFichaApiUrl(fieId), {
    timeoutMs: 30_000,
    retries: 0,
  });
}

/**
 * Nº de pruebas que le puntúan a cada tirador en una combinación.
 *
 * Se lee de `competitionPoints`, que la FIE publica por tirador: es contar sus
 * claves, no calcular una métrica nueva. Los valores entre paréntesis
 * ("(4.000)") son los que la FIE marca como no computables; se cuentan igual,
 * porque la pregunta que responde el dato es "en cuántas pruebas ha competido
 * con puntuación", y eso incluye las que no le suman.
 */
export async function fetchPruebasPorTirador(params: {
  season: number;
  weapon: string;
  gender: string;
  category: string;
}): Promise<Map<number, number>> {
  const data = await fetchJson<{
    fencers?: { addrId?: number; competitionPoints?: Record<string, string> }[];
  }>(fieDetailedRankingUrl(params), { timeoutMs: 90_000, retries: 0 });

  const out = new Map<number, number>();
  for (const f of data.fencers ?? []) {
    if (typeof f.addrId !== 'number') continue;
    out.set(f.addrId, Object.keys(f.competitionPoints ?? {}).length);
  }
  return out;
}

// ------------------------------------------------------- Hash de contenido ---

/** Lo que, si cambia, cambia la ficha. La fecha de ingestión queda fuera. */
export async function fieFencerContentHash(row: {
  sourceName: string;
  sourceBirthDate: string | null;
  photoUrl: string | null;
  hand: string | null;
  fieLicense: string | null;
  fieLicenseStatus: string | null;
}): Promise<string> {
  const { sha256 } = await import('../../utils');
  return sha256(
    JSON.stringify([
      row.sourceName,
      row.sourceBirthDate,
      row.photoUrl,
      row.hand,
      row.fieLicense,
      row.fieLicenseStatus,
    ]),
  );
}

export async function fieRankingContentHash(row: {
  position: number | null;
  points: string | null;
  eventCount: number | null;
  ageBand: string | null;
}): Promise<string> {
  const { sha256 } = await import('../../utils');
  return sha256(
    JSON.stringify([row.position, row.points, row.eventCount, row.ageBand]),
  );
}

// -------------------------------------------------------------- Ingestión ---

export type FieTiradoresOptions = {
  country?: string;
  season?: number;
  /** Tope de fichas por pasada. Cada una es una petición a la FIE. */
  maxFichas?: number;
  /** Tope de combinaciones de `detailed-ranking` (pesan ~250 KB). */
  maxCombosPruebas?: number;
  /**
   * Tope de combinaciones de la clasificación mundial por pasada.
   *
   * Son 24 individuales + 24 de selecciones = 48 peticiones y 2,8 MB, medido.
   * El tope está en 48 —o sea, todas— porque la clasificación entera no sirve
   * a medias: una tabla con cuatro armas de seis es peor que no tenerla. Se
   * deja como opción para poder bajarlo si algún día la FIE se queja del
   * ritmo.
   */
  maxCombosClasificacion?: number;
  delayMs?: number;
};

export type FieTiradoresStats = {
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsQuarantined: number;
  /** Peticiones hechas a la FIE. Va al informe de la ejecución. */
  peticiones: number;
  /** Tiradores nuestros con ficha FIE enlazada y confirmada. */
  enlazados: number;
  /** Enlaces nuevos resueltos por coincidencia de número de licencia FIE. */
  porLicencia: number;
  /** Propuestas esperando que las mire una persona. */
  propuestos: number;
  /** Combinaciones de la clasificación mundial pedidas en esta pasada. */
  clasificacionPedidas: number;
  /** De las pedidas, las que respondieron. Si no son todas, no cuenta como leída. */
  clasificacionRespondidas: number;
  /** Filas de la clasificación mundial escritas o retiradas. Sin el dato, el runner no puede decir «sin cambios». */
  clasificacionCambios?: number;
  note: string | null;
};

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Trae de la FIE la foto y el puesto mundial de nuestros tiradores.
 *
 * Idempotente: si el hash de la fila no cambió, no se reescribe. Volver a
 * lanzarla dos veces seguidas deja `itemsUpdated = 0` la segunda.
 *
 * `@/db` se importa dentro y no arriba, igual que en `ranking-rfee.ts`: ese
 * módulo lanza si falta `DATABASE_URL`, y eso dejaría los tests de las
 * funciones puras sin poder importar este fichero.
 */
export async function ingestFieTiradores(
  runId: string,
  options: FieTiradoresOptions = {},
): Promise<FieTiradoresStats> {
  const {
    country = FIE_COUNTRY_ESP,
    season = currentFieSeason(),
    maxFichas = 40,
    maxCombosPruebas = 8,
    maxCombosClasificacion = 48,
    delayMs = 300,
  } = options;

  const { db } = await import('@/db');
  const { athlete, fieFencer, fieWorldRanking, ingestQuarantine } = await import(
    '@/db/schema'
  );
  const { eq, sql } = await import('drizzle-orm');

  const stats: FieTiradoresStats = {
    itemsSeen: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    itemsQuarantined: 0,
    peticiones: 0,
    enlazados: 0,
    porLicencia: 0,
    propuestos: 0,
    clasificacionPedidas: 0,
    clasificacionRespondidas: 0,
    clasificacionCambios: 0,
    note: null,
  };

  const cuarentena: FieCuarentena[] = [];

  // --- 1. Nuestros tiradores. Es lo que acota TODO lo que se pide a la FIE ---
  const nuestros: TiradorNuestro[] = (
    await db
      .select({
        id: athlete.id,
        firstName: athlete.firstName,
        lastName: athlete.lastName,
        birthDate: athlete.birthDate,
        gender: athlete.gender,
        fieLicense: athlete.fieLicense,
      })
      .from(athlete)
      .where(eq(athlete.active, true))
  ).map((a) => ({ ...a, birthDate: String(a.birthDate).slice(0, 10) }));

  if (nuestros.length === 0) {
    return { ...stats, note: 'No hay ningún tirador de alta: no se pide nada a la FIE.' };
  }

  // --- 2. El censo del país. UNA petición ---
  const censoCrudo = await fetchCensoFie(country, { pageSize: 1000 });
  stats.peticiones += censoCrudo.peticiones;
  stats.itemsSeen = censoCrudo.filas.length;

  const { valid: censo, quarantined } = validarCenso(censoCrudo.filas);
  cuarentena.push(...quarantined);

  // --- 3. Lo que ya está enlazado o rechazado. Se respeta siempre ---
  const yaEnBase = await db
    .select({
      fieId: fieFencer.fieId,
      athleteId: fieFencer.athleteId,
      linkStatus: fieFencer.linkStatus,
      contentHash: fieFencer.contentHash,
      fieLicense: fieFencer.fieLicense,
      fieLicenseStatus: fieFencer.fieLicenseStatus,
    })
    .from(fieFencer);

  const enBasePorFieId = new Map(yaEnBase.map((f) => [f.fieId, f]));
  const rechazados = new Set(
    yaEnBase.filter((f) => f.linkStatus === 'RECHAZADO').map((f) => f.fieId),
  );

  // --- 4. Candidatos. Propuestas, nunca enlaces ---
  const propuestas = proponerCandidatos(nuestros, censo).filter(
    (c) => !rechazados.has(c.fieId),
  );

  /**
   * ===========================================================================
   * DOS CONJUNTOS, Y LA DIFERENCIA IMPORTA
   * ===========================================================================
   *
   * `fieIdsDeInteres` son los tiradores de los que se pide la FICHA a la FIE:
   * los propuestos hoy y los que ya estaban en la base. Es una petición HTTP
   * por cabeza, así que esta lista sigue siendo corta a propósito.
   *
   * `censoEspanol` son **todos** los del censo del país, que llegan en una
   * sola petición. De estos se guarda el puesto mundial y la identidad mínima
   * para poder enseñar la clasificación.
   *
   * ---------------------------------------------------------------------------
   * POR QUÉ AHORA SÍ SE GUARDA EL CENSO
   * ---------------------------------------------------------------------------
   * Aquí antes se tiraba todo lo que no fuera de interés, con este motivo
   * escrito: «es la diferencia entre un índice de referencias y una copia de
   * su base de datos», porque las condiciones de la FIE piden permiso escrito
   * para almacenar su contenido.
   *
   * Cambia porque el usuario lo ha autorizado expresamente y ha dicho en qué
   * condiciones: *«ok todo y pido los permisos… me han dado el ok para
   * mostrarlo, o sea es interno y no público»*. La aplicación está entera
   * detrás de sesión, no la indexa nadie, y el permiso se está pidiendo por
   * escrito.
   *
   * Lo que se guarda sigue siendo lo mínimo, y esto NO es una concesión de
   * estilo:
   *
   *  - **solo España.** El censo se pide por país (`country=ESP`); de los
   *    demás solo se guardan las clasificaciones (ver la cabecera).
   *  - **ni fecha de nacimiento, ni foto, ni mano, ni licencia** de quien no
   *    es uno de los nuestros. Es la regla que el usuario puso para las listas
   *    de inscritos —*«solo los españoles, y de los demás se descarta la fecha
   *    de nacimiento»*— y aquí hay menores. Se guarda nombre, arma, categoría,
   *    puesto, puntos y el enlace a su ficha en fie.org, que es lo que hace
   *    falta para una clasificación.
   *  - **siempre con enlace al original**, que es lo que distingue citar de
   *    copiar.
   */
  const fieIdsDeInteres = new Set<number>([
    ...propuestas.map((p) => p.fieId),
    ...yaEnBase.filter((f) => f.linkStatus !== 'RECHAZADO').map((f) => f.fieId),
  ]);

  /** Mejor fila del censo por fieId. */
  const filaPorFieId = new Map<number, FieCensoRow>();
  /** Todas las filas de ranking de la temporada en curso, por fieId. */
  const rankingsPorFieId = new Map<number, FieCensoRow[]>();
  for (const fila of censo) {
    if (rechazados.has(fila.id)) continue;
    const previa = filaPorFieId.get(fila.id);
    if (!previa || (fila.rank ?? 9e9) < (previa.rank ?? 9e9)) {
      filaPorFieId.set(fila.id, fila);
    }
    const lista = rankingsPorFieId.get(fila.id) ?? [];
    lista.push(fila);
    rankingsPorFieId.set(fila.id, lista);
  }

  /** Todos los del censo más los que ya estaban en la base. */
  const censoEspanol = new Set<number>([
    ...filaPorFieId.keys(),
    ...fieIdsDeInteres,
  ]);

  // --- 5. Las fichas: una petición por tirador de interés, y topado ---
  const fichas = new Map<number, FieFicha>();
  const porPedir = [...fieIdsDeInteres].slice(0, maxFichas);

  for (const fieId of porPedir) {
    try {
      const crudo = await fetchFichaFie(fieId);
      stats.peticiones += 1;
      const parsed = fieFichaSchema.safeParse(crudo);
      if (parsed.success) {
        fichas.set(fieId, parsed.data);
      } else {
        cuarentena.push({
          sourceId: String(fieId),
          raw: crudo,
          errors: formatZodIssues(parsed.error),
        });
      }
    } catch {
      /**
       * Una ficha que no responde no rompe la ingestión: el puesto y la foto
       * ya venían en el censo. Lo único que se queda sin resolver es el número
       * de licencia, y eso se reintenta mañana.
       */
    }
    await espera(delayMs);
  }

  // --- 6. Emparejado por LICENCIA FIE. La única vía automática ---
  const athleteIdPorLicenciaFie = new Map<string, string>();
  for (const t of nuestros) {
    const lic = normalizarLicenciaFie(t.fieLicense);
    if (lic) athleteIdPorLicenciaFie.set(lic, t.id);
  }

  const propuestaPorFieId = new Map<number, Candidato>();
  for (const p of propuestas) {
    // Si un mismo fieId se propone para dos tiradores nuestros, no se elige:
    // se deja constancia de la ambigüedad y decide una persona.
    const previa = propuestaPorFieId.get(p.fieId);
    if (previa && previa.athleteId !== p.athleteId) {
      previa.evidencia = `AMBIGUO: la misma ficha de la FIE encaja con más de un tirador nuestro. ${previa.evidencia}`;
      continue;
    }
    propuestaPorFieId.set(p.fieId, p);
  }

  // --- 7. Escritura de las fichas ---
  const filasFencer: (typeof fieFencer.$inferInsert)[] = [];

  for (const fieId of censoEspanol) {
    const fila = filaPorFieId.get(fieId);
    const ficha = fichas.get(fieId);
    const previa = enBasePorFieId.get(fieId);
    const propuesta = propuestaPorFieId.get(fieId);
    /**
     * De quien no es uno de los nuestros se guarda la identidad mínima: ni
     * fecha de nacimiento, ni foto, ni mano. Ver la cabecera de `censoEspanol`.
     */
    const esDeLosNuestros = fieIdsDeInteres.has(fieId);

    // Sin fila del censo ni ficha no hay nada nuevo que escribir de este
    // tirador: puede haberse quedado sin ranking esta temporada. Se deja como
    // está en lugar de borrarle la foto.
    if (!fila && !ficha) {
      stats.itemsUnchanged += 1;
      continue;
    }

    const sourceName = ficha?.name ?? fila?.name ?? `FIE ${fieId}`;
    const fieLicense = ficha?.licenseNumber ?? previa?.fieLicense ?? null;
    const fieLicenseStatus =
      ficha?.licenseStatus ?? previa?.fieLicenseStatus ?? null;

    /**
     * EL ÚNICO EMPAREJADO AUTOMÁTICO: que el número de licencia FIE que
     * publica la FIE coincida con el que alguien haya puesto en la ficha del
     * tirador. No es por nombre, así que no hay homónimo que lo confunda.
     */
    const porLicencia = fieLicense
      ? (athleteIdPorLicenciaFie.get(normalizarLicenciaFie(fieLicense)) ?? null)
      : null;

    let athleteId: string | null = null;
    let linkStatus: 'PROPUESTO' | 'CONFIRMADO' | 'RECHAZADO' = 'PROPUESTO';
    let linkedVia: string | null = null;
    let evidencia: string | null = propuesta?.evidencia ?? null;

    if (previa?.linkStatus === 'RECHAZADO') {
      linkStatus = 'RECHAZADO';
    } else if (porLicencia) {
      athleteId = porLicencia;
      linkStatus = 'CONFIRMADO';
      linkedVia = 'licencia_fie';
      evidencia = `coincide el número de licencia FIE (${fieLicense})`;
      if (previa?.linkStatus !== 'CONFIRMADO') stats.porLicencia += 1;
    } else if (previa?.linkStatus === 'CONFIRMADO' && previa.athleteId) {
      // Lo confirmó una persona: la ingestión no lo toca.
      athleteId = previa.athleteId;
      linkStatus = 'CONFIRMADO';
      linkedVia = 'persona';
      evidencia = null;
    }

    if (linkStatus === 'CONFIRMADO') stats.enlazados += 1;
    else if (linkStatus === 'PROPUESTO' && propuesta) stats.propuestos += 1;

    const photoUrl = esDeLosNuestros ? (ficha?.image ?? fila?.image ?? null) : null;
    const sourceBirthDate = esDeLosNuestros
      ? (ficha?.date ?? fila?.date ?? null)
      : null;
    const hand = esDeLosNuestros ? (ficha?.hand ?? fila?.hand ?? null) : null;

    const contentHash = await fieFencerContentHash({
      sourceName,
      sourceBirthDate,
      photoUrl,
      hand,
      fieLicense,
      fieLicenseStatus,
    });

    if (previa?.contentHash === contentHash && previa.linkStatus === linkStatus) {
      stats.itemsUnchanged += 1;
      continue;
    }
    if (previa) stats.itemsUpdated += 1;
    else stats.itemsCreated += 1;

    filasFencer.push({
      fieId,
      athleteId,
      proposedAthleteId: propuesta?.athleteId ?? null,
      linkStatus,
      linkedVia,
      linkedAt: linkStatus === 'CONFIRMADO' ? new Date() : null,
      matchEvidence: evidencia,
      sourceName,
      sourceFirstName: ficha?.firstName ?? fila?.firstName ?? null,
      sourceLastName: ficha?.lastName ?? fila?.lastName ?? null,
      countryCode: ficha?.countryCode ?? fila?.countryCode ?? null,
      sourceBirthDate,
      hand,
      photoUrl,
      profileUrl: fieFichaPublicaUrl(fieId),
      fieLicense,
      fieLicenseStatus,
      contentHash,
      updatedAt: new Date(),
    });
  }

  for (const lote of lotesDeInsercion(filasFencer, fieFencer)) {
    await db
      .insert(fieFencer)
      .values(lote)
      .onConflictDoUpdate({
        target: fieFencer.fieId,
        set: {
          /**
           * `athlete_id` y `link_status` NO se pisan a ciegas: si una persona
           * ya confirmó o rechazó este enlace, su decisión gana sobre lo que
           * traiga la ingestión de hoy. Solo se sube de PROPUESTO a algo, y
           * nunca se baja de CONFIRMADO.
           */
          athleteId: sql`coalesce("fie_fencer"."athlete_id", excluded."athlete_id")`,
          proposedAthleteId: sql`excluded."proposed_athlete_id"`,
          linkStatus: sql`case
            when "fie_fencer"."link_status" = 'RECHAZADO' then "fie_fencer"."link_status"
            when "fie_fencer"."link_status" = 'CONFIRMADO' then "fie_fencer"."link_status"
            else excluded."link_status" end`,
          linkedVia: sql`coalesce("fie_fencer"."linked_via", excluded."linked_via")`,
          linkedAt: sql`coalesce("fie_fencer"."linked_at", excluded."linked_at")`,
          matchEvidence: sql`excluded."match_evidence"`,
          sourceName: sql`excluded."source_name"`,
          sourceFirstName: sql`excluded."source_first_name"`,
          sourceLastName: sql`excluded."source_last_name"`,
          countryCode: sql`excluded."country_code"`,
          sourceBirthDate: sql`excluded."source_birth_date"`,
          hand: sql`excluded."hand"`,
          photoUrl: sql`excluded."photo_url"`,
          profileUrl: sql`excluded."profile_url"`,
          // La licencia solo se añade, nunca se borra: la ficha puede fallar
          // un día y no queremos perder lo que ya sabíamos.
          fieLicense: sql`coalesce(excluded."fie_license", "fie_fencer"."fie_license")`,
          fieLicenseStatus: sql`coalesce(excluded."fie_license_status", "fie_fencer"."fie_license_status")`,
          contentHash: sql`excluded."content_hash"`,
          updatedAt: new Date(),
        },
      });
  }

  // --- 8. Nº de pruebas: solo de los YA enlazados, y topado ---
  const enlazadosFieIds = new Set(
    [
      ...yaEnBase.filter((f) => f.linkStatus === 'CONFIRMADO').map((f) => f.fieId),
      ...filasFencer.filter((f) => f.linkStatus === 'CONFIRMADO').map((f) => f.fieId),
    ].filter((id) => fieIdsDeInteres.has(id)),
  );

  /** clave de combinación -> nº de pruebas por fieId. */
  const pruebasPorCombo = new Map<string, Map<number, number>>();
  const combos = new Set<string>();
  for (const fieId of enlazadosFieIds) {
    for (const fila of rankingsPorFieId.get(fieId) ?? []) {
      combos.add(`${fila.weapon}|${fila.gender}|${fila.category}`);
    }
  }

  for (const combo of [...combos].slice(0, maxCombosPruebas)) {
    const [weapon, gender, category] = combo.split('|');
    try {
      const mapa = await fetchPruebasPorTirador({
        season,
        weapon,
        gender,
        category,
      });
      stats.peticiones += 1;
      pruebasPorCombo.set(combo, mapa);
    } catch {
      // Sin este dato el puesto y la foto siguen estando. No es un fallo.
    }
    await espera(delayMs);
  }

  // --- 9. Ranking mundial: temporada en curso + histórico de la ficha ---
  const hashesRanking = new Map<string, string>();
  if (censoEspanol.size > 0) {
    for (const lote of trocear([...censoEspanol], 300)) {
      const existentes = await db
        .select({
          fieId: fieWorldRanking.fieId,
          season: fieWorldRanking.season,
          weapon: fieWorldRanking.weapon,
          gender: fieWorldRanking.gender,
          categoryRaw: fieWorldRanking.categoryRaw,
          contentHash: fieWorldRanking.contentHash,
        })
        .from(fieWorldRanking)
        .where(inArray(fieWorldRanking.fieId, lote));
      for (const e of existentes) {
        hashesRanking.set(
          `${e.fieId}|${e.season}|${e.weapon}|${e.gender}|${e.categoryRaw}`,
          e.contentHash,
        );
      }
    }
  }

  const filasRanking: (typeof fieWorldRanking.$inferInsert)[] = [];

  const anyadirRanking = async (fila: {
    fieId: number;
    season: number;
    weaponRaw: string;
    genderRaw: string;
    categoryRaw: string;
    ageBand: string | null;
    position: number | null;
    points: string | null;
    eventCount: number | null;
    sourceUrl: string;
    raw: unknown;
  }) => {
    const weapon = mapWeapon(fila.weaponRaw);
    const gender = mapGender(fila.genderRaw);
    const category = mapCategory(fila.categoryRaw);

    /**
     * Si no se sabe traducir arma, género o categoría, la fila NO entra: va a
     * cuarentena. Meterla con un valor por defecto pondría el puesto de
     * veteranos dentro del absoluto, y nadie lo notaría hasta que alguien
     * mirase su ficha y viese un número que no es el suyo.
     */
    if (!weapon || !gender || !category) {
      cuarentena.push({
        sourceId: `${fila.fieId}|${fila.season}|${fila.weaponRaw}|${fila.genderRaw}|${fila.categoryRaw}`,
        raw: fila.raw,
        errors: [
          {
            path: 'weapon/gender/category',
            message:
              `No se sabe traducir arma "${fila.weaponRaw}", género ` +
              `"${fila.genderRaw}" o categoría "${fila.categoryRaw}" de la FIE. ` +
              'La fila no entra para no colocar el puesto en la clasificación ' +
              'equivocada.',
          },
        ],
      });
      return;
    }

    const contentHash = await fieRankingContentHash({
      position: fila.position,
      points: fila.points,
      eventCount: fila.eventCount,
      ageBand: fila.ageBand,
    });
    const clave = `${fila.fieId}|${fila.season}|${weapon}|${gender}|${fila.categoryRaw}`;
    if (hashesRanking.get(clave) === contentHash) {
      stats.itemsUnchanged += 1;
      return;
    }
    if (hashesRanking.has(clave)) stats.itemsUpdated += 1;
    else stats.itemsCreated += 1;

    filasRanking.push({
      fieId: fila.fieId,
      season: fila.season,
      weapon,
      gender,
      category,
      categoryRaw: fila.categoryRaw,
      ageBand: fila.ageBand,
      position: fila.position,
      points: fila.points,
      eventCount: fila.eventCount,
      sourceUrl: fila.sourceUrl,
      contentHash,
      updatedAt: new Date(),
    });
  };

  for (const fieId of censoEspanol) {
    // Temporada en curso, del censo.
    for (const fila of rankingsPorFieId.get(fieId) ?? []) {
      const combo = `${fila.weapon}|${fila.gender}|${fila.category}`;
      await anyadirRanking({
        fieId,
        season,
        weaponRaw: fila.weapon,
        genderRaw: fila.gender,
        categoryRaw: fila.category,
        ageBand: fila.ageBand,
        position: fila.rank,
        points: fila.points,
        eventCount: pruebasPorCombo.get(combo)?.get(fieId) ?? null,
        sourceUrl: fieFichaPublicaUrl(fieId),
        raw: fila,
      });
    }

    // Histórico, de la ficha. El género lo hereda del tirador: su array
    // `ranking` no lo trae por fila.
    const ficha = fichas.get(fieId);
    if (!ficha) continue;
    for (const h of ficha.ranking) {
      if (h.season === season) continue; // ya está, y con nº de pruebas
      await anyadirRanking({
        fieId,
        season: h.season,
        weaponRaw: h.weapon,
        genderRaw: ficha.gender,
        categoryRaw: h.category,
        ageBand: null,
        position: h.rank,
        points: h.point,
        eventCount: null,
        sourceUrl: fieFichaPublicaUrl(fieId),
        raw: h,
      });
    }
  }

  const vistas = new Set<string>();
  const rankingSinDuplicados = filasRanking.filter((r) => {
    const k = `${r.fieId}|${r.season}|${r.weapon}|${r.gender}|${r.categoryRaw}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });

  for (const lote of lotesDeInsercion(rankingSinDuplicados, fieWorldRanking)) {
    await db
      .insert(fieWorldRanking)
      .values(lote)
      .onConflictDoUpdate({
        target: [
          fieWorldRanking.fieId,
          fieWorldRanking.season,
          fieWorldRanking.weapon,
          fieWorldRanking.gender,
          fieWorldRanking.categoryRaw,
        ],
        set: {
          category: sql`excluded."category"`,
          ageBand: sql`excluded."age_band"`,
          position: sql`excluded."position"`,
          points: sql`excluded."points"`,
          // El nº de pruebas solo se pide de los enlazados: si hoy no se pidió,
          // se conserva el de ayer en vez de borrarlo.
          eventCount: sql`coalesce(excluded."event_count", "fie_world_ranking"."event_count")`,
          sourceUrl: sql`excluded."source_url"`,
          contentHash: sql`excluded."content_hash"`,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * --- 9 bis. LA CLASIFICACIÓN MUNDIAL COMPLETA ---
   *
   * Individual (todos los países) y por selecciones. Va aquí, dentro de esta
   * fuente, y no como fuente nueva: comparte el endpoint, el `user-agent` y la
   * temporada, y una fuente nueva significaría un valor más en el enum de
   * `event_source`, otra franja de cron y otro sitio donde mirar cuando algo
   * falle. Lo que sí tiene es su propio tope y su propio informe.
   */
  const clasificacion = await guardarClasificacionMundial({
    season,
    maxCombos: maxCombosClasificacion,
    delayMs,
  });
  stats.peticiones += clasificacion.peticiones;
  stats.clasificacionPedidas = clasificacion.pedidas;
  stats.clasificacionRespondidas = clasificacion.combos;
  stats.clasificacionCambios = clasificacion.escritas + clasificacion.retiradas;

  // --- 10. Cuarentena ---
  for (const lote of lotesDeInsercion(cuarentena, ingestQuarantine)) {
    if (lote.length === 0) continue;
    await db.insert(ingestQuarantine).values(
      lote.map((item) => ({
        ingestRunId: runId,
        source: 'fie_tiradores' as const,
        sourceId: item.sourceId,
        rawPayload: item.raw as never,
        validationErrors: item.errors as never,
      })),
    );
  }
  stats.itemsQuarantined = cuarentena.length;

  const partes = [
    `Temporada FIE ${season}`,
    `${censoCrudo.filas.length} filas del censo ${country} en ${censoCrudo.peticiones} petición(es)`,
    `${stats.enlazados} tiradores con ficha FIE enlazada`,
    `${stats.propuestos} propuestas a revisar`,
    `${stats.peticiones} peticiones a la FIE en total`,
  ];
  if (stats.porLicencia > 0) {
    partes.push(`${stats.porLicencia} enlazados por número de licencia FIE`);
  }
  if (porPedir.length < fieIdsDeInteres.size) {
    partes.push(
      `${fieIdsDeInteres.size - porPedir.length} fichas quedan para la próxima pasada`,
    );
  }
  if (combos.size > maxCombosPruebas) {
    partes.push(
      `${combos.size - maxCombosPruebas} combinaciones sin nº de pruebas (tope por pasada)`,
    );
  }
  partes.push(
    `clasificación mundial: ${clasificacion.filas} filas ` +
      `(${clasificacion.individuales} individuales, ${clasificacion.selecciones} selecciones) ` +
      `en ${clasificacion.combos} combinaciones` +
      (clasificacion.vacias > 0 ? `, ${clasificacion.vacias} vacías en la FIE` : '') +
      (clasificacion.retiradas > 0 ? `, ${clasificacion.retiradas} retiradas` : ''),
  );
  stats.note = partes.join(' | ');

  return stats;
}

function trocear<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * ===========================================================================
 * LA CLASIFICACIÓN MUNDIAL, GUARDADA
 * ===========================================================================
 *
 * Recorre las 24 combinaciones de arma × género × categoría pidiendo las dos
 * clasificaciones —individual y por selecciones— y las escribe en
 * `fie_clasificacion`.
 *
 * POR QUÉ SE GUARDA EL MUNDO ENTERO Y NO SOLO ESPAÑA
 * --------------------------------------------------
 * Porque el usuario lo pidió con el caso delante: *«no veo botón en el ranking
 * para poner el ranking con tiradores también no españoles»* y *«tampoco veo
 * para ver el ranking de países»*. Un conmutador «solo España / todos» que por
 * debajo solo tiene españoles no es un conmutador, es un adorno.
 *
 * El alcance y el permiso están en la cabecera de este fichero. Lo que importa
 * repetir aquí es qué se guarda: **nombre, país, puesto y puntos**. No hay
 * fecha de nacimiento ni foto, y no es una decisión nuestra: la FIE no las
 * publica en este endpoint. Comprobado en florete femenino cadete, que es la
 * categoría con más menores.
 *
 * IDEMPOTENCIA
 * ------------
 * Por hash de (puesto, puntos, nº de pruebas, nombre, país). Una segunda
 * pasada el mismo día no reescribe ni una fila: solo se tocan las que de
 * verdad han cambiado de puesto. Eso importa con 11.500 filas y una base con
 * presupuesto de cómputo.
 */
async function guardarClasificacionMundial(opciones: {
  season: number;
  maxCombos: number;
  delayMs: number;
}): Promise<{
  peticiones: number;
  /** Combinaciones que se intentaron pedir. */
  pedidas: number;
  /** Combinaciones que respondieron. */
  combos: number;
  filas: number;
  individuales: number;
  selecciones: number;
  vacias: number;
  retiradas: number;
  /** Filas nuevas o cambiadas que se han escrito. */
  escritas: number;
}> {
  const { fieClasificacion } = await import('@/db/schema');
  const { db } = await import('@/db');
  const { and, eq, sql } = await import('drizzle-orm');
  const { sha256 } = await import('@/lib/utils');
  const { cerrarLecturaGrupo, escritorLecturaD1 } = await import('./fie-clasificacion-lectura');
  const escritorLectura = escritorLecturaD1(db, fieClasificacion);

  const resumen = {
    peticiones: 0,
    pedidas: 0,
    combos: 0,
    filas: 0,
    individuales: 0,
    selecciones: 0,
    vacias: 0,
    /** Filas que ya no estaban en la lista de la FIE y se han retirado. */
    retiradas: 0,
    escritas: 0,
  };

  /** Las dos clasificaciones de cada combinación, individual primero. */
  const tareas = (['I', 'E'] as const).flatMap((tipo) =>
    COMBINACIONES_FIE.map((c) => ({ ...c, tipo })),
  );

  for (const tarea of tareas.slice(0, opciones.maxCombos)) {
    const weapon = mapWeapon(tarea.weapon);
    const gender = mapGender(tarea.gender);
    const category = mapCategory(tarea.category);
    /*
      Si no se sabe traducir, la combinación NO se pide. Guardarla con un
      valor por defecto pondría el ranking de veteranos dentro del absoluto y
      nadie lo notaría hasta que alguien mirase su puesto y viese un número
      que no es el suyo.
    */
    if (!weapon || !gender || !category) continue;

    let filas: FilaClasificacionFie[];
    resumen.pedidas += 1;
    try {
      filas = await fetchClasificacionFie({ season: opciones.season, ...tarea });
      resumen.peticiones += 1;
      resumen.combos += 1;
    } catch {
      // Una combinación que no responde no tumba la ingestión: se queda con
      // lo que ya había guardado, que es mejor que una tabla a medias.
      continue;
    }
    await espera(opciones.delayMs);

    if (filas.length === 0) {
      resumen.vacias += 1;
      continue;
    }

    const format = tarea.tipo === 'E' ? ('EQUIPOS' as const) : ('INDIVIDUAL' as const);

    /** Los hashes que ya hay, para no reescribir lo que no ha cambiado. */
    const previos = new Map<number, string>();
    for (const lote of trocear(
      filas.map((f) => f.addrId),
      500,
    )) {
      const existentes = await db
        .select({
          fieId: fieClasificacion.fieId,
          contentHash: fieClasificacion.contentHash,
        })
        .from(fieClasificacion)
        .where(
          and(
            eq(fieClasificacion.season, opciones.season),
            eq(fieClasificacion.format, format),
            eq(fieClasificacion.weapon, weapon),
            eq(fieClasificacion.gender, gender),
            eq(fieClasificacion.categoryRaw, tarea.category),
            inArray(fieClasificacion.fieId, lote),
          ),
        );
      for (const e of existentes) previos.set(e.fieId, e.contentHash);
    }

    const sourceUrl = fieDetailedRankingUrl({
      season: opciones.season,
      ...tarea,
    });

    const porEscribir: (typeof fieClasificacion.$inferInsert)[] = [];
    for (const f of filas) {
      const contentHash = await sha256(
        [f.rank, f.points, f.eventCount, f.name, f.countryCode].join('|'),
      );
      if (previos.get(f.addrId) === contentHash) continue;
      porEscribir.push({
        season: opciones.season,
        weapon,
        gender,
        category,
        categoryRaw: tarea.category,
        format,
        fieId: f.addrId,
        position: f.rank,
        points: f.points,
        sourceName: f.name,
        countryCode: f.countryCode,
        countryName: f.country,
        eventCount: f.eventCount,
        sourceUrl,
        contentHash,
        updatedAt: new Date(),
      });
    }

    resumen.filas += filas.length;
    resumen.escritas += porEscribir.length;
    if (format === 'INDIVIDUAL') resumen.individuales += filas.length;
    else resumen.selecciones += filas.length;

    for (const lote of lotesDeInsercion(porEscribir, fieClasificacion)) {
      await db
        .insert(fieClasificacion)
        .values(lote)
        .onConflictDoUpdate({
          target: [
            fieClasificacion.season,
            fieClasificacion.weapon,
            fieClasificacion.gender,
            fieClasificacion.categoryRaw,
            fieClasificacion.format,
            fieClasificacion.fieId,
          ],
          set: {
            position: sql`excluded."position"`,
            points: sql`excluded."points"`,
            sourceName: sql`excluded."source_name"`,
            countryCode: sql`excluded."country_code"`,
            countryName: sql`excluded."country_name"`,
            eventCount: sql`excluded."event_count"`,
            sourceUrl: sql`excluded."source_url"`,
            contentHash: sql`excluded."content_hash"`,
            updatedAt: AHORA_SQL,
          },
        });
    }

    // Después del upsert: si este fallara, se sale antes y no se borra nada.
    const cierre = await cerrarLecturaGrupo(
      escritorLectura,
      { season: opciones.season, format, weapon, gender, categoryRaw: tarea.category },
      { ok: true, fieIds: filas.map((f) => f.addrId), sourceUrl, yaGuardadas: previos.size },
    );
    resumen.retiradas += cierre.borradas;
  }

  return resumen;
}
