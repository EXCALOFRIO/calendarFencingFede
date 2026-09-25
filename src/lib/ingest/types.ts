import { z } from 'zod';

/**
 * Objeto normalizado común a todas las fuentes.
 *
 * Aislar la normalización en un único tipo es lo que hace que cambiar un
 * scraper por una API oficial sea trivial el día que la RFEE o la FIE la den:
 * solo se reescribe el adaptador, no el resto de la app.
 */

export const WEAPONS = ['FLORETE', 'ESPADA', 'SABLE'] as const;
export const GENDERS = ['M', 'F', 'MIXTO'] as const;
export const CATEGORIES = [
  'M9',
  'M11',
  'M13',
  'M14',
  'M15',
  'M17',
  'M20',
  'M23',
  'ABS',
  'VET',
] as const;
export const CIRCUITS = [
  'TNR',
  'LIGA_ORO',
  'LIGA_PLATA',
  'LIGA_IBERDROLA',
  'LIGA_BRONCE',
  'LIGA_CLUBES',
  'CTO_ESPANA',
  'CONCENTRACION',
  'SATELITE',
  'FIE_CIRCUITO',
  'ECC',
  'EUR_CLUBES',
  'U14_EFC',
  'SUB23_EFC',
  'EFC_LEAGUE',
  'EUV',
  'CAD_WC',
  'JUN_WC',
  'SEN_WC',
  'SEN_GP',
  'CTO_EUROPA',
  'CTO_MUNDO',
  'TLM',
  'OTRO',
] as const;
export const SOURCES = [
  'skermo_rfee',
  'skermo_regional',
  'fie',
  'efc',
  'rfee_wp',
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe venir como YYYY-MM-DD');

/**
 * Validación en el borde del scraper. Lo que no valida NO entra: va a
 * cuarentena y sale en el panel de admin. Un dato dudoso visible es
 * infinitamente mejor que un dato malo publicado.
 */
export const normalizedCompetitionSchema = z.object({
  weapon: z.enum(WEAPONS),
  gender: z.enum(GENDERS),
  category: z.enum(CATEGORIES),
  categoryRaw: z.string().nullable(),
  format: z.enum(['INDIVIDUAL', 'EQUIPOS']),
  competitionDate: isoDate.nullable(),
  installationOpen: z.string().nullable(),
  callTime: z.string().nullable(),
  scratchTime: z.string().nullable(),
  startTime: z.string().nullable(),
  registrationCount: z.number().int().nonnegative().nullable(),
  /**
   * Lista NOMINAL de inscritos, cuando la fuente la publica.
   *
   * `null` = **la fuente no publica la lista** (la FIE). `[]` = la publica y
   * no hay nadie inscrito todavía. La diferencia no es una sutileza: con
   * `null` no se toca nada, y con `[]` se dan de baja los que hubiera, que es
   * lo correcto cuando la prueba se ha quedado sin inscritos.
   *
   * Nunca lleva licencia desde Skermo: su pantalla de inscritos solo da
   * nombre y, en equipos, el código del equipo. El campo existe porque el
   * emparejado automático depende de él y alguna fuente futura sí podría
   * traerlo.
   */
  registrations: z
    .array(
      z.object({
        sourceAthleteName: z.string().min(2, 'Un inscrito sin nombre no sirve'),
        sourceTeam: z.string(),
        sourceLicense: z.string().nullable().optional(),
        sourceClub: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .default(null),
  /** Nunca se inventa: si la fuente no lo publica, va a null. */
  feeEur: z.string().nullable(),
  sourceId: z.string().nullable(),
  sourceUrl: z.string().url().nullable(),
  /**
   * Cierre de inscripción publicado por la fuente. Se convierte en un
   * `event_deadline` de origen PUBLICADO, que gana sobre cualquier estimación.
   */
  registrationCloseDate: isoDate.nullable(),
});

export const normalizedEventSchema = z
  .object({
    source: z.enum(SOURCES),
    sourceId: z.string().min(1),
    sourceUrl: z.string().url().nullable(),
    name: z.string().min(2, 'El nombre no puede estar vacío'),
    startDate: isoDate,
    endDate: isoDate,
    venue: z.string().nullable(),
    venueAddress: z.string().nullable(),
    city: z.string().nullable(),
    country: z
      .string()
      .length(2, 'El país debe ser ISO-3166 alfa-2')
      .nullable(),
    timezone: z.string().nullable(),
    officialSite: z.string().url().nullable(),
    imageUrl: z.string().url().nullable(),
    circuit: z.enum(CIRCUITS),
    scope: z.enum(['NACIONAL', 'INTERNACIONAL', 'AUTONOMICO']),
    regionalFederation: z.string().nullable(),
    sourceModifiedAt: z.date().nullable(),
    notes: z.string().nullable(),
    documents: z.array(
      z.object({
        title: z.string().min(1),
        url: z.string().url(),
        kind: z.string().nullable(),
      }),
    ),
    liveLinks: z.array(
      z.object({
        platform: z.string(),
        kind: z.string(),
        url: z.string().url(),
        label: z.string().nullable(),
      }),
    ),
    competitions: z
      .array(normalizedCompetitionSchema)
      .min(1, 'Un evento sin ninguna prueba no sirve de nada'),
  })
  .refine((e) => e.endDate >= e.startDate, {
    message: 'La fecha de fin no puede ser anterior a la de inicio',
    path: ['endDate'],
  });

export type NormalizedCompetition = z.infer<typeof normalizedCompetitionSchema>;
export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;

/** Evento que no pasó la validación, con sus errores ya formateados. */
export type QuarantinedItem = {
  sourceId: string | null;
  raw: unknown;
  errors: { path: string; message: string }[];
};

export type ParseOutcome = {
  events: NormalizedEvent[];
  quarantined: QuarantinedItem[];
  /** Nº de filas encontradas en la fuente, antes de validar. */
  rowsSeen: number;
};

/** Da los errores de Zod en una forma legible para el panel de admin. */
export function formatZodIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({
    path: i.path.join('.') || '(raíz)',
    message: i.message,
  }));
}

/**
 * Valida una tanda de candidatos y los separa en válidos y cuarentena.
 * Nunca lanza: un evento mal leído no puede tumbar la ingestión de los otros.
 */
export function validateEvents(candidates: unknown[]): ParseOutcome {
  const events: NormalizedEvent[] = [];
  const quarantined: QuarantinedItem[] = [];

  for (const candidate of candidates) {
    const parsed = normalizedEventSchema.safeParse(candidate);
    if (parsed.success) {
      events.push(parsed.data);
    } else {
      const sourceId =
        candidate && typeof candidate === 'object' && 'sourceId' in candidate
          ? String((candidate as { sourceId: unknown }).sourceId)
          : null;
      quarantined.push({
        sourceId,
        raw: candidate,
        errors: formatZodIssues(parsed.error),
      });
    }
  }

  return { events, quarantined, rowsSeen: candidates.length };
}
