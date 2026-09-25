import * as cheerio from 'cheerio';
import { z } from 'zod';
import { mapCategory } from '../mappers';
import { formatZodIssues } from '../types';
import {
  SKERMO_GENDER_CODE,
  SKERMO_WEAPON_CODE,
  type SkermoNationalRankingRow,
  normalizeLicense,
  parseSkermoNationalRanking,
  parseSkermoRankingAthlete,
  parseSkermoSeasons,
  skermoNationalRankingUrl,
  skermoRankingAthleteUrl,
} from './skermo-results';
import { SKERMO_BASE_URL } from './skermo';
import { fetchText } from '../fetcher';

/**
 * RANKING NACIONAL OFICIAL DE LA RFEE.
 *
 * -------------------------------------------------------------------------
 * ¿ES INGERIBLE? Sí. Comprobado en vivo el 25/09/2026, petición a petición
 * -------------------------------------------------------------------------
 * 1. `robots.txt` de `app.skermo.org` dice `User-agent: * / Disallow:` — sin
 *    restricciones.
 * 2. La página viene RENDERIZADA EN SERVIDOR (Laravel/Blade + Bootstrap 3).
 *    No hay AJAX, no hay JSON detrás: `fetch` + cheerio basta, igual que con
 *    el calendario. Se verificó pidiendo la página con curl y encontrando las
 *    80 filas ya en el HTML.
 * 3. **Sin los cuatro parámetros el `<tbody>` llega VACÍO**: la página
 *    responde 200 y no trae ni una fila. Por eso se recorre el producto
 *    cartesiano del formulario en vez de pedir "el ranking" a secas.
 * 4. No hay paginación: un ranking completo cabe en una respuesta (80 filas,
 *    66 KB en espada M20 femenino).
 *
 * -------------------------------------------------------------------------
 * EL PROBLEMA DEL EMPAREJADO, que es lo que condiciona todo el diseño
 * -------------------------------------------------------------------------
 * La tabla del ranking **no publica el número de licencia**. Sus columnas son
 * puesto, nombre, apellidos, fecha de nacimiento, club y puntuación. La
 * licencia está una pantalla más adentro, en la ficha del tirador
 * (`/ranking-rfee/public/RFEE/<id>`), que sí trae "Código Licencia"
 * (comprobado: el 366 es SGL00510).
 *
 * Y emparejar por nombre está PROHIBIDO en este proyecto, con razón: hay
 * homónimos y los acentos varían entre fuentes. Así que:
 *
 * - El ranking se ingiere entero y siempre, con `athlete_id = null`.
 * - La licencia se resuelve pidiendo la ficha, UNA VEZ POR TIRADOR EN LA
 *   VIDA: en cuanto se conoce, queda guardada en todas sus filas y no se
 *   vuelve a pedir. Con presupuesto por ejecución, porque son cientos de
 *   tiradores y una función serverless muere a los 300 s. Lo que no entra
 *   hoy entra mañana.
 * - Lo que aun así no empareje se queda en la cola para una persona.
 */

export const RANKING_FEDERATION = 'RFEE';

/** Página del ranking sin filtros: sirve para leer los selectores. */
export function skermoRankingFormUrl(code = RANKING_FEDERATION): string {
  return `${SKERMO_BASE_URL}/ranking-rfee/public/${code}?setLang=es`;
}

export type SkermoCategoryOption = {
  /** Id interno de Skermo ("6"). No es deducible: se lee del formulario. */
  value: string;
  /** Etiqueta publicada ("M20", "VET50"). */
  label: string;
};

/**
 * Categorías del desplegable del ranking, leídas de la propia página.
 *
 * No se escriben en el código por el mismo motivo que las temporadas: sus ids
 * (12, 4, 5, 6, 7, 13, 14, 17, 18, 19) no siguen ninguna regla y la RFEE
 * podría añadir o quitar alguna. El día que lo hagan, esto se entera solo.
 *
 * Ojo: el ranking ofrece MENOS categorías que el calendario (no hay M9, M11
 * ni M14), y desglosa veteranos en VET30…VET70. Por eso se guarda tanto la
 * categoría normalizada como el literal.
 */
export function parseSkermoRankingCategories(html: string): SkermoCategoryOption[] {
  const $ = cheerio.load(html);
  return $('select[name="category"] option')
    .toArray()
    .map((el) => ({
      value: ($(el).attr('value') ?? '').trim(),
      label: $(el).text().replace(/\s+/g, ' ').trim(),
    }))
    .filter((o) => o.value && o.label);
}

/** Temporadas del desplegable. Reexportado para que el runner no bucee. */
export { parseSkermoSeasons };

// ----------------------------------------------------------- Validación ---

/**
 * Validación en el borde. Lo que no pase de aquí NO entra en el ranking
 * oficial: va a `ingest_quarantine` y sale en el panel de admin.
 *
 * Un ranking con una fila mal leída es peor que un ranking con una fila
 * menos: la posición es un número con el que la gente discute.
 */
/**
 * Puesto "9999" = NO CLASIFICADO.
 *
 * Lo descubrió la primera ejecución contra Skermo: 59 de los 259 tiradores de
 * espada masculina absoluta comparten el puesto 9999, todos con 0 puntos. Es
 * su forma de decir "todavía no puntúa", no un puesto. Se traduce a `null`.
 */
export const PUESTO_SIN_CLASIFICAR = 9999;

export function puestoPublicado(position: number | null): number | null {
  if (position === null || position >= PUESTO_SIN_CLASIFICAR) return null;
  return position;
}

export const rankingRowSchema = z.object({
  position: z
    .number()
    .int()
    .positive('El puesto tiene que ser un entero positivo')
    .nullable(),
  sourceAthleteName: z.string().min(2, 'Una fila de ranking sin nombre no sirve'),
  sourceFirstName: z.string().nullable(),
  sourceLastName: z.string().nullable(),
  sourceClub: z.string().nullable(),
  sourceBirthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha de nacimiento debe venir como YYYY-MM-DD')
    .nullable(),
  /**
   * La puntuación puede faltar (Skermo deja la celda vacía en quien todavía
   * no ha puntuado). `null` es "no publicado", que NO es cero: confundirlos
   * pondría a alguien con 0 puntos en un ranking donde simplemente no consta.
   */
  totalPoints: z.string().nullable(),
  /** Clave interna de Skermo. Sin ella no se puede resolver la licencia. */
  skermoAthleteId: z.string().min(1, 'Sin id de Skermo no se puede ir a su ficha'),
  /** El enlace a su ficha, tal y como lo publica la fila. Ver el aviso de
   *  `skermoRankingAthleteUrl`: reconstruirlo a mano no funciona. */
  athleteUrl: z.string().url().nullable(),
});

export type RankingRowValida = z.infer<typeof rankingRowSchema>;

export type RankingQuarantine = {
  sourceId: string | null;
  raw: unknown;
  errors: { path: string; message: string }[];
};

export function validateRankingRows(
  rows: SkermoNationalRankingRow[],
  contexto: { clave: string },
): { valid: RankingRowValida[]; quarantined: RankingQuarantine[] } {
  const valid: RankingRowValida[] = [];
  const quarantined: RankingQuarantine[] = [];

  for (const row of rows) {
    const parsed = rankingRowSchema.safeParse(row);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      quarantined.push({
        sourceId: `${contexto.clave}:${row.position ?? '?'}`,
        raw: row,
        errors: formatZodIssues(parsed.error),
      });
    }
  }

  return { valid, quarantined };
}

// -------------------------------------------------- Combinaciones a pedir ---

export type RankingCombo = {
  weapon: 'FLORETE' | 'ESPADA' | 'SABLE';
  gender: 'M' | 'F';
  /** Id de Skermo de la categoría. */
  categoryValue: string;
  /** Literal publicado: "M20", "VET50". */
  categoryRaw: string;
};

/**
 * Producto cartesiano de los tres selectores.
 *
 * Son 3 armas × 2 géneros × 10 categorías = 60 peticiones por temporada. Es
 * mucho para una sola pantalla, pero es UNA VEZ AL DÍA y con espera entre
 * peticiones. No hay forma de pedir menos: sin los cuatro parámetros la
 * página devuelve la tabla vacía.
 */
export function rankingCombos(categorias: SkermoCategoryOption[]): RankingCombo[] {
  const combos: RankingCombo[] = [];
  for (const weapon of ['ESPADA', 'FLORETE', 'SABLE'] as const) {
    for (const gender of ['M', 'F'] as const) {
      for (const categoria of categorias) {
        combos.push({
          weapon,
          gender,
          categoryValue: categoria.value,
          categoryRaw: categoria.label,
        });
      }
    }
  }
  return combos;
}

// ------------------------------------------------------- Hash de contenido ---

/**
 * Hash de lo que, si cambia, cambia el ranking. La fecha de ingestión queda
 * fuera a propósito: si no, la segunda pasada "actualizaría" las 4.000 filas.
 */
export async function rankingContentHash(row: {
  position: number | null;
  sourceAthleteName: string;
  sourceClub: string | null;
  totalPoints: string | null;
  skermoAthleteId: string | null;
}): Promise<string> {
  const { sha256 } = await import('../../utils');
  return sha256(
    JSON.stringify([
      row.position,
      row.sourceAthleteName,
      row.sourceClub,
      row.totalPoints,
      row.skermoAthleteId,
    ]),
  );
}

// ------------------------------------------------------------- Ingestión ---

export type RankingIngestOptions = {
  federationCode?: string;
  /** Etiqueta de temporada ("2026-2027"). Por defecto, la que Skermo marque. */
  seasonLabel?: string;
  /** Tope de combinaciones por pasada. 60 es el total de una temporada. */
  maxCombos?: number;
  /**
   * Tope de fichas de tirador que se piden para resolver su licencia. Cada
   * una es una petición. Con 150 al día, el ranking entero queda emparejado
   * en pocos días y luego solo se piden los que entran nuevos.
   */
  maxLicenseLookups?: number;
  /** Espera entre peticiones. Cortesía con la fuente. */
  delayMs?: number;
};

export type RankingIngestStats = {
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsQuarantined: number;
  /** Combinaciones arma/género/categoría que devolvieron alguna fila. */
  combosConDatos: number;
  combosVacios: number;
  /** Licencias nuevas resueltas pidiendo la ficha del tirador. */
  licenciasResueltas: number;
  /** Filas emparejadas con un tirador nuestro, por licencia. */
  emparejadas: number;
  /** Filas que se quedan en la cola para que las resuelva una persona. */
  sinEmparejar: number;
  note: string | null;
};

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Descarga, valida y guarda el ranking nacional de una temporada.
 *
 * Idempotente: la clave única es (temporada, arma, género, categoría, puesto),
 * y si el hash de la fila no cambió no se reescribe. Volver a lanzarla dos
 * veces seguidas deja `itemsUpdated = 0` la segunda.
 *
 * `@/db` se importa dentro y no arriba, igual que en `skermo-results.ts`: ese
 * módulo lanza si falta `DATABASE_URL` y eso dejaría los tests del parser sin
 * poder importar este fichero.
 */
export async function ingestRankingRfee(
  runId: string,
  options: RankingIngestOptions = {},
): Promise<RankingIngestStats> {
  const {
    federationCode = RANKING_FEDERATION,
    maxCombos = 60,
    /**
     * Presupuesto de fichas por pasada. 150 caben de sobra en los 300 s de
     * una función, y como cada licencia se resuelve UNA VEZ EN LA VIDA, el
     * ranking entero queda cubierto en menos de una semana de crones. Se
     * puede subir con `INGEST_RANKING_LICENSE_BUDGET` para una carga inicial
     * desde la línea de órdenes, donde no hay límite de tiempo.
     */
    maxLicenseLookups = Number.parseInt(
      process.env.INGEST_RANKING_LICENSE_BUDGET ?? '150',
      10,
    ) || 150,
    delayMs = 250,
  } = options;

  const { db } = await import('@/db');
  const { athlete, ingestQuarantine, officialRankingEntry } = await import(
    '@/db/schema'
  );
  const { and, eq, inArray, sql } = await import('drizzle-orm');

  const stats: RankingIngestStats = {
    itemsSeen: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    itemsQuarantined: 0,
    combosConDatos: 0,
    combosVacios: 0,
    licenciasResueltas: 0,
    emparejadas: 0,
    sinEmparejar: 0,
    note: null,
  };

  // --- 1. Los selectores, leídos de la propia página ---
  const { body: formHtml } = await fetchText(skermoRankingFormUrl(federationCode), {
    timeoutMs: 60_000,
  });
  const temporadas = parseSkermoSeasons(formHtml);
  const categorias = parseSkermoRankingCategories(formHtml);

  if (categorias.length === 0) {
    throw new Error(
      'El formulario del ranking no trae ninguna categoría. O Skermo ha ' +
        'cambiado el marcado, o la página no ha cargado bien.',
    );
  }

  const temporada =
    (options.seasonLabel
      ? temporadas.find((t) => t.label === options.seasonLabel)
      : temporadas.find((t) => t.selected)) ?? temporadas[temporadas.length - 1];

  if (!temporada) {
    throw new Error('El formulario del ranking no trae ninguna temporada.');
  }

  // --- 2. Una petición por combinación ---
  const combos = rankingCombos(categorias).slice(0, maxCombos);
  const leidas: {
    combo: RankingCombo;
    url: string;
    filas: RankingRowValida[];
  }[] = [];
  const cuarentena: RankingQuarantine[] = [];
  const fallos: string[] = [];

  for (const combo of combos) {
    const url = skermoNationalRankingUrl(federationCode, {
      season: temporada.value,
      weapon: SKERMO_WEAPON_CODE[combo.weapon],
      category: combo.categoryValue,
      gender: SKERMO_GENDER_CODE[combo.gender],
    });

    try {
      const { body } = await fetchText(url, { timeoutMs: 60_000 });
      const { rows, rowsSeen } = parseSkermoNationalRanking(body, { federationCode });
      stats.itemsSeen += rowsSeen;

      if (rowsSeen === 0) {
        stats.combosVacios += 1;
      } else {
        stats.combosConDatos += 1;
      }

      const clave = `${temporada.label}|${combo.weapon}|${combo.gender}|${combo.categoryRaw}`;
      const { valid, quarantined } = validateRankingRows(rows, { clave });
      cuarentena.push(...quarantined);
      leidas.push({ combo, url, filas: valid });
    } catch (error) {
      // Una combinación caída no puede tumbar las otras 59.
      fallos.push(
        `${combo.weapon}/${combo.gender}/${combo.categoryRaw}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    await espera(delayMs);
  }

  if (fallos.length === combos.length) {
    throw new Error(`Ninguna combinación respondió. ${fallos.slice(0, 3).join(' | ')}`);
  }

  // --- 3. Licencias: lo que ya sabemos, y lo que hay que ir a buscar ---
  const idsEnRanking = [
    ...new Set(leidas.flatMap((l) => l.filas.map((f) => f.skermoAthleteId))),
  ];

  /** skermoAthleteId -> licencia, de lo que ya resolvimos en pasadas previas. */
  const licenciaPorSkermoId = new Map<string, string>();
  for (const lote of trocear(idsEnRanking, 300)) {
    if (lote.length === 0) continue;
    const filas = await db
      .selectDistinct({
        skermoAthleteId: officialRankingEntry.skermoAthleteId,
        sourceLicense: officialRankingEntry.sourceLicense,
      })
      .from(officialRankingEntry)
      .where(
        and(
          inArray(officialRankingEntry.skermoAthleteId, lote),
          sql`${officialRankingEntry.sourceLicense} is not null`,
        ),
      );
    for (const f of filas) {
      if (f.skermoAthleteId && f.sourceLicense) {
        licenciaPorSkermoId.set(f.skermoAthleteId, f.sourceLicense);
      }
    }
  }

  /**
   * La URL de la ficha se toma del enlace que publica la propia fila: la
   * construida a mano devuelve 302 (ver `skermoRankingAthleteUrl`).
   */
  const urlFichaPorId = new Map<string, string>();
  for (const l of leidas) {
    for (const f of l.filas) {
      if (f.athleteUrl && !urlFichaPorId.has(f.skermoAthleteId)) {
        urlFichaPorId.set(f.skermoAthleteId, f.athleteUrl);
      }
    }
  }

  const porResolver = idsEnRanking.filter((id) => !licenciaPorSkermoId.has(id));
  for (const skermoId of porResolver.slice(0, maxLicenseLookups)) {
    try {
      const { body } = await fetchText(
        urlFichaPorId.get(skermoId) ??
          skermoRankingAthleteUrl(federationCode, skermoId),
        { timeoutMs: 30_000, retries: 0 },
      );
      const ficha = parseSkermoRankingAthlete(body);
      if (ficha?.sourceLicense) {
        licenciaPorSkermoId.set(skermoId, ficha.sourceLicense);
        stats.licenciasResueltas += 1;
      }
    } catch {
      // Una ficha que no responde no es un error de la ingestión: se
      // reintenta mañana. El puesto del ranking ya está guardado.
    }
    await espera(delayMs);
  }

  // --- 4. Nuestros tiradores, por licencia. Nunca por nombre ---
  const athleteIdPorLicencia = new Map<string, string>();
  const nuestros = await db
    .select({ id: athlete.id, rfeeLicense: athlete.rfeeLicense })
    .from(athlete)
    .where(sql`${athlete.rfeeLicense} is not null`);
  for (const a of nuestros) {
    if (a.rfeeLicense) athleteIdPorLicencia.set(normalizeLicense(a.rfeeLicense), a.id);
  }

  // --- 5. Lo que ya está guardado, para no reescribir lo que no cambió ---
  const hashesGuardados = new Map<string, string>();
  const existentes = await db
    .select({
      weapon: officialRankingEntry.weapon,
      gender: officialRankingEntry.gender,
      categoryRaw: officialRankingEntry.categoryRaw,
      skermoAthleteId: officialRankingEntry.skermoAthleteId,
      contentHash: officialRankingEntry.contentHash,
    })
    .from(officialRankingEntry)
    .where(eq(officialRankingEntry.skermoSeasonId, temporada.value));
  for (const e of existentes) {
    hashesGuardados.set(
      `${e.weapon}|${e.gender}|${e.categoryRaw}|${e.skermoAthleteId}`,
      e.contentHash,
    );
  }

  // --- 6. Escritura, en lote ---
  const aEscribir: (typeof officialRankingEntry.$inferInsert)[] = [];

  for (const { combo, url, filas } of leidas) {
    /**
     * Si la etiqueta de la categoría no se sabe normalizar, la combinación
     * ENTERA va a cuarentena. La alternativa —meterle una categoría por
     * defecto— pondría el ranking de veteranos dentro del absoluto, y nadie
     * lo notaría hasta que alguien mirase su puesto.
     */
    const category = mapCategory(combo.categoryRaw);
    if (!category) {
      cuarentena.push({
        sourceId: `${temporada.label}|${combo.weapon}|${combo.gender}|${combo.categoryRaw}`,
        raw: { combo, filas: filas.length },
        errors: [
          {
            path: 'categoryRaw',
            message:
              `La categoría "${combo.categoryRaw}" no está en el mapeo. ` +
              'Las filas de esa combinación no entran para no colocarlas en ' +
              'la categoría equivocada.',
          },
        ],
      });
      continue;
    }

    for (const fila of filas) {
      const licencia = licenciaPorSkermoId.get(fila.skermoAthleteId) ?? null;
      const athleteId = licencia
        ? (athleteIdPorLicencia.get(normalizeLicense(licencia)) ?? null)
        : null;
      if (athleteId) stats.emparejadas += 1;
      else stats.sinEmparejar += 1;

      const contentHash = await rankingContentHash(fila);
      const clave = `${combo.weapon}|${combo.gender}|${combo.categoryRaw}|${fila.skermoAthleteId}`;
      const anterior = hashesGuardados.get(clave);

      if (anterior === contentHash) {
        stats.itemsUnchanged += 1;
        // Aun así puede haber aparecido la licencia hoy: si es así, se
        // escribe igual para que el emparejado quede guardado.
        if (!licencia) continue;
      } else if (anterior === undefined) {
        stats.itemsCreated += 1;
      } else {
        stats.itemsUpdated += 1;
      }

      aEscribir.push({
        seasonLabel: temporada.label,
        skermoSeasonId: temporada.value,
        weapon: combo.weapon,
        gender: combo.gender,
        category,
        categoryRaw: combo.categoryRaw,
        position: puestoPublicado(fila.position),
        totalPoints: fila.totalPoints,
        athleteId,
        skermoAthleteId: fila.skermoAthleteId,
        sourceLicense: licencia,
        sourceAthleteName: fila.sourceAthleteName,
        sourceFirstName: fila.sourceFirstName,
        sourceLastName: fila.sourceLastName,
        sourceClub: fila.sourceClub,
        sourceBirthDate: fila.sourceBirthDate,
        sourceUrl: url,
        contentHash,
        updatedAt: new Date(),
      });
    }
  }

  /**
   * Postgres aborta un `ON CONFLICT DO UPDATE` si la misma sentencia trae dos
   * filas con la misma clave. No debería pasar —un tirador sale una vez por
   * ranking— pero si Skermo duplicase una fila preferimos guardar una que
   * tumbar la ingestión entera.
   */
  const vistas = new Set<string>();
  const sinDuplicados = aEscribir.filter((r) => {
    const k = `${r.skermoSeasonId}|${r.weapon}|${r.gender}|${r.categoryRaw}|${r.skermoAthleteId}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });

  for (const lote of trocear(sinDuplicados, 300)) {
    await db
      .insert(officialRankingEntry)
      .values(lote)
      .onConflictDoUpdate({
        target: [
          officialRankingEntry.skermoSeasonId,
          officialRankingEntry.weapon,
          officialRankingEntry.gender,
          officialRankingEntry.categoryRaw,
          officialRankingEntry.skermoAthleteId,
        ],
        set: {
          seasonLabel: sql`excluded."season_label"`,
          category: sql`excluded."category"`,
          position: sql`excluded."position"`,
          totalPoints: sql`excluded."total_points"`,
          athleteId: sql`excluded."athlete_id"`,
          skermoAthleteId: sql`excluded."skermo_athlete_id"`,
          sourceLicense: sql`coalesce(excluded."source_license", "official_ranking_entry"."source_license")`,
          sourceAthleteName: sql`excluded."source_athlete_name"`,
          sourceFirstName: sql`excluded."source_first_name"`,
          sourceLastName: sql`excluded."source_last_name"`,
          sourceClub: sql`excluded."source_club"`,
          sourceBirthDate: sql`excluded."source_birth_date"`,
          sourceUrl: sql`excluded."source_url"`,
          contentHash: sql`excluded."content_hash"`,
          updatedAt: new Date(),
        },
      });
  }

  // --- 7. Cuarentena ---
  for (const lote of trocear(cuarentena, 100)) {
    if (lote.length === 0) continue;
    await db.insert(ingestQuarantine).values(
      lote.map((item) => ({
        ingestRunId: runId,
        source: 'skermo_ranking' as const,
        sourceId: item.sourceId,
        rawPayload: item.raw as never,
        validationErrors: item.errors as never,
      })),
    );
  }
  stats.itemsQuarantined = cuarentena.length;

  const pendientes = Math.max(0, porResolver.length - maxLicenseLookups);
  const partes = [
    `Temporada ${temporada.label}`,
    `${stats.combosConDatos} de ${combos.length} combinaciones con datos`,
    `${stats.licenciasResueltas} licencias nuevas resueltas`,
    `${stats.emparejadas} filas emparejadas por licencia`,
    `${stats.sinEmparejar} a la cola de emparejar`,
  ];
  if (pendientes > 0) {
    partes.push(
      `${pendientes} licencias quedan por resolver (se piden en próximas pasadas)`,
    );
  }
  if (fallos.length > 0) {
    partes.push(`${fallos.length} combinaciones fallaron: ${fallos.slice(0, 3).join(' | ')}`);
  }
  stats.note = partes.join(' | ');

  return stats;
}

function trocear<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
