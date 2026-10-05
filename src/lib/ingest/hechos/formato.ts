import { z } from 'zod';

/**
 * Formato intermedio común de hechos deportivos: un fichero JSON por prueba.
 *
 * Lo producen todos los extractores (lector FIE, lector local de PDF RFEE,
 * extracción con droids) y lo consume un único cargador, que escribe en el
 * SQLite de trabajo por claves naturales. Así los extractores pueden correr en
 * paralelo sin tocar la base.
 */

export const ARMAS = ['FLORETE', 'ESPADA', 'SABLE'] as const;
export const GENEROS = ['M', 'F', 'MIXTO'] as const;
export const CATEGORIAS = ['M7', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23', 'ABS', 'VET'] as const;
export const FORMATOS = ['INDIVIDUAL', 'EQUIPOS'] as const;

const texto = z.string().trim().min(1);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const resultadoHecho = z.object({
  /** Clave estable del participante en la fuente: ID FIE, `lic:<licencia>` o `pdf:<pagina>:<fila>`. */
  factKey: texto,
  name: texto,
  countryCode: z.string().regex(/^[A-Z]{3}$/).nullable().default(null),
  club: z.string().trim().min(1).nullable().default(null),
  /** null = sin puesto numérico publicado (DNS, DNF, excluido...). */
  position: z.number().int().positive().nullable(),
  positionRaw: z.string().nullable().default(null),
  points: z.string().regex(/^-?\d+(\.\d+)?$/).nullable().default(null),
  /** Identificadores publicados por la fuente; nunca inferidos por nombre. */
  fieId: z.string().regex(/^\d+$/).nullable().default(null),
  license: z.string().trim().min(1).nullable().default(null),
  birthYear: z.number().int().min(1900).max(2030).nullable().default(null),
});

export const asaltoHecho = z.object({
  phase: z.enum(['POULE', 'TABLEAU']),
  /** Poule `P3`, ronda de cuadro `T64`, `T8`, `T2` final, `T2-3` bronce... */
  roundKey: texto,
  /** Referencias de participante: deben coincidir con un `factKey` de `results` cuando exista. */
  aRef: texto,
  bRef: texto,
  aName: texto,
  bName: texto,
  scoreA: z.number().int().min(0).max(45),
  scoreB: z.number().int().min(0).max(45),
  /** Ganador explícito (victoria por prioridad con marcador igualado). */
  winner: z.enum(['A', 'B']).nullable().default(null),
});

export const estadoExtraccion = z.enum(['completo', 'parcial', 'sin_resultados', 'ilegible']);

export const hechosPrueba = z.object({
  version: z.literal(1),
  /** fie | rfee_pdf | skermo_rfee | engarde */
  source: z.enum(['fie', 'rfee_pdf', 'skermo_rfee', 'engarde']),
  /** lector_fie | lector_pdf | droid:<modelo> */
  extractor: texto,
  /** URL completa del original y SHA-256 del fichero leído. */
  sourceUrl: z.string().url(),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  edition: z.object({
    season: texto,
    tournamentKey: texto,
    name: texto,
    startDate: fecha.nullable(),
    endDate: fecha.nullable(),
    city: z.string().trim().min(1).nullable(),
    countryCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  }),
  competition: z.object({
    competitionKey: texto,
    weapon: z.enum(ARMAS),
    gender: z.enum(GENEROS),
    category: z.enum(CATEGORIAS),
    categoryRaw: z.string().nullable(),
    format: z.enum(FORMATOS),
    date: fecha.nullable(),
  }),
  status: z.object({
    results: estadoExtraccion,
    pools: estadoExtraccion,
    tableau: estadoExtraccion,
    /** Nº de participantes que la fuente declara, si lo declara. */
    publishedParticipants: z.number().int().nonnegative().nullable().default(null),
    notes: z.array(z.string()).default([]),
  }),
  results: z.array(resultadoHecho),
  bouts: z.array(asaltoHecho),
});

export type HechosPrueba = z.infer<typeof hechosPrueba>;
export type ResultadoHecho = z.infer<typeof resultadoHecho>;
export type AsaltoHecho = z.infer<typeof asaltoHecho>;

/** Nombre de fichero estable para una prueba: `<source>__<season>__<competitionKey saneada>.json`. */
export function ficheroHechos(h: Pick<HechosPrueba, 'source' | 'edition' | 'competition'>): string {
  const limpio = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 150);
  return `${h.source}__${limpio(h.edition.season)}__${limpio(h.competition.competitionKey)}.json`;
}
