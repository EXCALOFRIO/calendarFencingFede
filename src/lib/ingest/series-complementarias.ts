import { z } from 'zod';
import { fixDoubleEncodedUtf8 } from './fetcher';
import { mapCategory, mapFormat, mapGender, mapWeapon } from './mappers';

/**
 * Series complementarias: Juegos Olímpicos, Juegos Mediterráneos y Campeonato
 * del Mediterráneo. Son tres series distintas aunque compartan sede, ciudad o
 * `competitionId` (la FIE reutiliza 1139-1144 en 2018, 2022 y 2026).
 *
 * Esta capa es pura y sólo agrupa lo que una fuente PUBLICÓ. No hay lista de
 * pruebas «esperadas» ni categorías por defecto: una edición tiene las pruebas
 * que su índice trae, y un campo no publicado queda `null`, no se rellena.
 */

export const SERIES_COMPLEMENTARIAS = [
  'juegos_olimpicos',
  'juegos_mediterraneos',
  'campeonato_mediterraneo',
] as const;
export type SerieComplementaria = (typeof SERIES_COMPLEMENTARIAS)[number];

export const ETIQUETA_SERIE: Record<SerieComplementaria, string> = {
  juegos_olimpicos: 'Juegos Olímpicos',
  juegos_mediterraneos: 'Juegos Mediterráneos',
  campeonato_mediterraneo: 'Campeonato del Mediterráneo',
};

function plano(texto: string): string {
  return fixDoubleEncodedUtf8(texto)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const OLIMPICO = /\b(jeux olympiques|olympic games|juegos olimpicos|giochi olimpici|olympische spiele)\b/;
const JUVENIL_OLIMPICO = /\b(youth|jeunesse|juvenil|jeux olympiques de la jeunesse|jojs?)\b/;
const MEDITERRANEO = /mediterran/;
const JUEGOS = /\b(jeux|games|juegos|giochi|jocs|spiele)\b/;
const CAMPEONATO = /\b(championship|championships|championnat|championnats|campeonato|campionato|campionati)\b/;

/**
 * Serie de una competición a partir de su nombre publicado y, si la FIE lo
 * trae, su `competitionCategory` (`JO` = Juegos Olímpicos). Un nombre ambiguo
 * devuelve `null`: ni un Campeonato Mediterráneo es «Juegos» ni al revés, y los
 * Juegos Olímpicos de la Juventud no son los Juegos Olímpicos.
 */
export function clasificarSerie(entrada: {
  nombre?: string | null;
  categoriaCompeticion?: string | null;
}): SerieComplementaria | null {
  const nombre = plano(entrada.nombre ?? '');
  if (JUVENIL_OLIMPICO.test(nombre)) return null;
  if (entrada.categoriaCompeticion?.trim().toUpperCase() === 'JO' || OLIMPICO.test(nombre)) {
    return 'juegos_olimpicos';
  }
  if (MEDITERRANEO.test(nombre)) {
    const campeonato = CAMPEONATO.test(nombre);
    const juegos = JUEGOS.test(nombre);
    if (campeonato && !juegos) return 'campeonato_mediterraneo';
    if (juegos && !campeonato) return 'juegos_mediterraneos';
  }
  return null;
}

export type FuenteSerie = 'fie' | 'engarde';

/** Estado de los resultados de una prueba, sin confundir ausencia con cero. */
export type ResultadosDePrueba =
  | 'pendiente'
  | 'publicados'
  | 'sin_publicar'
  | 'sin_resultados'
  | 'error';

export type PruebaDeSerie = {
  serie: SerieComplementaria;
  fuente: FuenteSerie;
  /** FIE: temporada declarada. Engarde: temporada septiembre-agosto de la fecha. */
  season: string;
  /** Torneo/edición dentro de `(fuente, season)`. */
  claveEdicion: string;
  /** FIE: `competitionId`. Engarde: `org/evt/compe`. Sólo único con la temporada. */
  clavePrueba: string;
  nombreEdicion: string | null;
  ciudad: string | null;
  pais: string | null;
  fecha: string | null;
  arma: ReturnType<typeof mapWeapon>;
  genero: ReturnType<typeof mapGender>;
  categoria: ReturnType<typeof mapCategory>;
  categoriaOriginal: string | null;
  formato: ReturnType<typeof mapFormat>;
  resultados: ResultadosDePrueba;
};

const texto = z.string().nullable().optional();
const filaFieSchema = z.object({
  competitionId: z.number().int(),
  season: z.number().int(),
  name: texto,
  type: texto,
  category: texto,
  competitionCategory: texto,
  location: texto,
  country: texto,
  federation: texto,
  startDate: texto,
  weapon: texto,
  gender: texto,
  tournamentId: z.number().int().nullable().optional(),
});

/** Una fila FIE (lista o metadata) como prueba de serie, o `null` si no es de ninguna serie. */
export function pruebaDeSerieFie(entrada: unknown): PruebaDeSerie | null {
  const r = filaFieSchema.safeParse(entrada);
  if (!r.success) return null;
  const f = r.data;
  const serie = clasificarSerie({ nombre: f.name, categoriaCompeticion: f.competitionCategory });
  if (!serie) return null;
  const ciudad = f.location ? fixDoubleEncodedUtf8(f.location).trim() || null : null;
  const nombre = f.name ? fixDoubleEncodedUtf8(f.name).trim() || null : null;
  return {
    serie,
    fuente: 'fie',
    season: String(f.season),
    // Los Juegos Olímpicos traen `tournamentId` null: la edición es su ciudad en esa temporada.
    claveEdicion: f.tournamentId != null ? `t${f.tournamentId}` : `c:${plano(ciudad ?? nombre ?? '')}`,
    clavePrueba: String(f.competitionId),
    nombreEdicion: nombre,
    ciudad,
    pais: f.federation?.trim() || f.country?.trim() || null,
    fecha: f.startDate ?? null,
    arma: mapWeapon(f.weapon),
    genero: mapGender(f.gender),
    categoria: mapCategory(f.category),
    categoriaOriginal: f.category?.trim() || null,
    formato: mapFormat(f.type),
    resultados: 'pendiente',
  };
}

export type EdicionDeSerie = {
  serie: SerieComplementaria;
  fuente: FuenteSerie;
  season: string;
  claveEdicion: string;
  nombre: string | null;
  ciudad: string | null;
  inicio: string | null;
  fin: string | null;
  pruebas: PruebaDeSerie[];
};

export type ResumenEdicion = {
  claveEdicion: string;
  season: string;
  fuente: FuenteSerie;
  ciudad: string | null;
  inicio: string | null;
  fin: string | null;
  pruebas: number;
  /** Sólo lo observado: nunca una lista fija de armas o categorías. */
  armas: string[];
  categorias: string[];
  formatos: string[];
  resultados: Record<ResultadosDePrueba, number>;
};

export type ResumenSerie = {
  serie: SerieComplementaria;
  etiqueta: string;
  ediciones: ResumenEdicion[];
};

function minimo(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a <= b ? a : b;
}
function maximo(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

/**
 * Agrupa pruebas en ediciones. La serie, la fuente y la temporada forman parte
 * de la clave: los Juegos Mediterráneos 2022 y 2026 comparten `competitionId`
 * y ciudad de pruebas, y el Campeonato del Mediterráneo no se une a ellos aunque
 * coincida la ciudad. Una prueba repetida (misma clave) no suma dos veces.
 */
export function agruparEdiciones(pruebas: readonly PruebaDeSerie[]): EdicionDeSerie[] {
  const porEdicion = new Map<string, EdicionDeSerie>();
  const vistas = new Set<string>();
  for (const p of pruebas) {
    const claveEdicion = `${p.serie}|${p.fuente}|${p.season}|${p.claveEdicion}`;
    const clavePrueba = `${claveEdicion}|${p.clavePrueba}`;
    if (vistas.has(clavePrueba)) continue;
    vistas.add(clavePrueba);
    const e = porEdicion.get(claveEdicion);
    if (!e) {
      porEdicion.set(claveEdicion, {
        serie: p.serie,
        fuente: p.fuente,
        season: p.season,
        claveEdicion: p.claveEdicion,
        nombre: p.nombreEdicion,
        ciudad: p.ciudad,
        inicio: p.fecha,
        fin: p.fecha,
        pruebas: [p],
      });
      continue;
    }
    e.pruebas.push(p);
    e.inicio = minimo(e.inicio, p.fecha);
    e.fin = maximo(e.fin, p.fecha);
    e.ciudad ??= p.ciudad;
    e.nombre ??= p.nombreEdicion;
  }
  return [...porEdicion.values()];
}

const ESTADOS: ResultadosDePrueba[] = [
  'pendiente',
  'publicados',
  'sin_publicar',
  'sin_resultados',
  'error',
];

function unicos(valores: (string | null)[]): string[] {
  return [...new Set(valores.filter((v): v is string => v !== null))].sort();
}

export function resumirSeries(pruebas: readonly PruebaDeSerie[]): ResumenSerie[] {
  const ediciones = agruparEdiciones(pruebas);
  return SERIES_COMPLEMENTARIAS.map((serie) => ({
    serie,
    etiqueta: ETIQUETA_SERIE[serie],
    ediciones: ediciones
      .filter((e) => e.serie === serie)
      .sort((a, b) => (a.inicio ?? '').localeCompare(b.inicio ?? ''))
      .map((e) => ({
        claveEdicion: e.claveEdicion,
        season: e.season,
        fuente: e.fuente,
        ciudad: e.ciudad,
        inicio: e.inicio,
        fin: e.fin,
        pruebas: e.pruebas.length,
        armas: unicos(e.pruebas.map((p) => p.arma)),
        categorias: unicos(e.pruebas.map((p) => p.categoriaOriginal ?? p.categoria)),
        formatos: unicos(e.pruebas.map((p) => p.formato)),
        resultados: Object.fromEntries(
          ESTADOS.map((s) => [s, e.pruebas.filter((p) => p.resultados === s).length]),
        ) as Record<ResultadosDePrueba, number>,
      })),
  }));
}
