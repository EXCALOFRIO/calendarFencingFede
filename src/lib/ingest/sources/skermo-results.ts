import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { z } from 'zod';
import {
  eventCompetition as eventCompetitionTable,
  event as eventTable,
  athlete as athleteTable,
  ingestQuarantine,
  result as resultTable,
} from '@/db/schema';
import { sha256 } from '../../utils';
import { fetchText } from '../fetcher';
import {
  mapCategory,
  mapFormat,
  mapGender,
  mapWeapon,
  normalizeLabel,
  parseLocation,
  parseSpanishDate,
} from '../mappers';
import { formatZodIssues } from '../types';
import { SKERMO_BASE_URL } from './skermo';

/**
 * Parser de RESULTADOS y de RANKING NACIONAL de Skermo.
 *
 * Escrito contra el marcado real, descargado y leído el 25/09/2026. Skermo
 * publica esto en tres pantallas encadenadas, todas HTML de servidor
 * (Laravel/Blade + Bootstrap 3), sin AJAX y sin API:
 *
 * 1. `/calendar/public/<FED>/results`
 *    Índice de pruebas con resultados. Una fila por prueba, con fecha, nombre,
 *    arma, género, categoría, modalidad y población. En la última celda,
 *    cuando existen, el PDF de la clasificación y —solo en las pruebas
 *    INDIVIDUALES— un enlace a la clasificación en HTML. Comprobado sobre la
 *    temporada 2025-2026 completa: 764 filas, 228 con clasificación HTML, y
 *    **ninguna prueba por equipos la tiene**. Los equipos solo publican PDF.
 *
 * 2. `/ranking/public/<FED>/competition/<id>`
 *    La clasificación de una prueba: puesto, CÓDIGO DE LICENCIA, nombre,
 *    apellidos, club, fecha de nacimiento y puntuación. Es la única pantalla
 *    de toda la fuente que publica la licencia, y por eso es la que alimenta
 *    el emparejado con nuestros tiradores.
 *
 * 3. `/ranking-rfee/public/<FED>?season&weapon&category&gender`
 *    El ranking nacional. Sin los cuatro parámetros el `<tbody>` viene VACÍO:
 *    la página se carga, responde 200 y no trae ni una fila. Y su tabla **no
 *    publica la licencia**, solo nombre, apellidos, fecha de nacimiento, club
 *    y puntuación. La licencia está una pantalla más adentro, en la ficha
 *    `/ranking-rfee/public/<FED>/<idSkermo>`, a una petición por tirador.
 *
 * Tres particularidades del marcado condicionan el código de abajo:
 *
 * - Hay celdas que **solo se ven en móvil** (`class="hidden-lg hidden-md
 *   hidden-sm"`). En el índice de resultados eso significa 9 `<td>` contra 8
 *   `<th>`: emparejar por posición da todas las columnas corridas una a la
 *   derecha. Se descartan esas celdas antes de emparejar, y también los
 *   `<span class="hidden-lg hidden-md">3. </span>` que Skermo mete DENTRO de
 *   la celda del nombre.
 * - Las columnas se leen por la ETIQUETA de su `<th>`, no por su posición, que
 *   es lo mismo que hace el parser del calendario y por el mismo motivo: el
 *   juego de columnas varía entre pantallas y entre federaciones.
 * - Todo viene con entidades HTML (`G&Oacute;MEZ`) y espacios dobles. Cheerio
 *   decodifica; los espacios se normalizan aquí.
 */

// ------------------------------------------------------------------ URLs ---

/** Índice de pruebas con resultados publicados. */
export function skermoResultsUrl(
  code: string,
  options: { season?: string | number; includePrevious?: boolean } = {},
): string {
  const params = new URLSearchParams({ setLang: 'es' });
  // `owa=1` es la casilla "otras webs / pruebas ajenas" del formulario; sin
  // ella el índice se queda solo con las pruebas propias de la federación.
  if (options.includePrevious ?? true) params.set('owa', '1');
  if (options.season) params.set('season', String(options.season));
  return `${SKERMO_BASE_URL}/calendar/public/${code}/results?${params.toString()}`;
}

/** Clasificación en HTML de una prueba concreta. */
export function skermoCompetitionResultsUrl(code: string, competitionId: string): string {
  return `${SKERMO_BASE_URL}/ranking/public/${code}/competition/${competitionId}?setLang=es`;
}

/**
 * Ranking nacional. Los cuatro parámetros son obligatorios en la práctica:
 * sin ellos la tabla llega vacía (comprobado en vivo).
 */
export function skermoNationalRankingUrl(
  code: string,
  params: {
    season: string | number;
    /** Código de arma de Skermo: E, F o S. */
    weapon: 'E' | 'F' | 'S';
    /** Código de categoría de Skermo (numérico, sale del propio formulario). */
    category: string | number;
    /** Skermo usa W para femenino y M para masculino. */
    gender: 'W' | 'M';
  },
): string {
  const qs = new URLSearchParams({
    setLang: 'es',
    season: String(params.season),
    weapon: params.weapon,
    category: String(params.category),
    gender: params.gender,
  });
  return `${SKERMO_BASE_URL}/ranking-rfee/public/${code}?${qs.toString()}`;
}

/** Ficha de un tirador en el ranking nacional. Es donde sí sale la licencia. */
export function skermoRankingAthleteUrl(code: string, skermoAthleteId: string): string {
  return `${SKERMO_BASE_URL}/ranking-rfee/public/${code}/${skermoAthleteId}?setLang=es`;
}

export const SKERMO_WEAPON_CODE = { ESPADA: 'E', FLORETE: 'F', SABLE: 'S' } as const;
export const SKERMO_GENDER_CODE = { M: 'M', F: 'W' } as const;

// -------------------------------------------------- Lectura de la tabla ---

/**
 * Celda que Skermo pinta SOLO en móvil. Bootstrap 3 la marca ocultándola en
 * los tres tamaños grandes a la vez; ese trío es la firma inequívoca.
 * Ojo: `hidden-xs` a secas es lo contrario (solo escritorio) y sí se conserva,
 * porque su `<th>` también existe.
 */
function isMobileOnly(className: string | undefined): boolean {
  return /\bhidden-lg\b/.test(className ?? '');
}

/** Texto de una celda, sin los adornos que Skermo solo enseña en móvil. */
function cellText($: cheerio.CheerioAPI, el: Element): string {
  const clone = $(el).clone();
  clone.find('[class*="hidden-lg"]').remove();
  return clone.text().replace(/\s+/g, ' ').trim();
}

type LabeledRow = {
  /** Etiqueta normalizada de la columna -> celda. */
  cells: Map<string, Element>;
  /** La fila entera, para sacar enlaces sin depender de en qué columna caen. */
  row: Element;
};

/**
 * Convierte una `<table>` en filas indexadas por la etiqueta de su cabecera.
 *
 * Devuelve también `mismatches`: filas cuyo número de celdas no cuadra con el
 * de cabeceras. No se descartan en silencio —se cuentan y se devuelven— porque
 * un descuadre es exactamente la señal de que Skermo ha cambiado el marcado, y
 * eso tiene que verse, no taparse.
 */
function readLabeledTable(
  $: cheerio.CheerioAPI,
  table: cheerio.Cheerio<AnyNode>,
): { headers: string[]; rows: LabeledRow[]; mismatches: number } {
  const headers: string[] = [];
  table
    .find('thead th')
    .toArray()
    .forEach((th) => {
      const el = th as Element;
      if (isMobileOnly($(el).attr('class'))) return;
      headers.push(normalizeLabel(cellText($, el)).replace(/:$/, ''));
    });

  const rows: LabeledRow[] = [];
  let mismatches = 0;

  table
    .find('tbody tr')
    .toArray()
    .forEach((tr) => {
      const rowEl = tr as Element;
      const tds = $(rowEl)
        .children('td')
        .toArray()
        .map((td) => td as Element)
        .filter((td) => !isMobileOnly($(td).attr('class')));

      if (tds.length !== headers.length) {
        mismatches += 1;
        return;
      }

      const cells = new Map<string, Element>();
      headers.forEach((h, i) => {
        if (h && !cells.has(h)) cells.set(h, tds[i]);
      });
      rows.push({ cells, row: rowEl });
    });

  return { headers, rows, mismatches };
}

function pickCell(
  $: cheerio.CheerioAPI,
  row: LabeledRow,
  ...labels: string[]
): string | null {
  for (const label of labels) {
    const cell = row.cells.get(normalizeLabel(label).replace(/:$/, ''));
    if (cell) {
      const text = cellText($, cell);
      if (text) return text;
    }
  }
  return null;
}

/**
 * Número publicado por Skermo -> cadena decimal con punto.
 *
 * Las dos pantallas usan formatos distintos, comprobado en vivo: la
 * clasificación de una prueba da "2065.56" (punto decimal, sin miles) y el
 * ranking nacional da "3.530,79" (punto de miles, coma decimal). La regla que
 * los distingue sin ambigüedad: si hay coma, la coma es el decimal y los
 * puntos son miles; si no hay coma, el punto es el decimal.
 *
 * Devuelve null si no hay número: "no publicado" nunca se convierte en 0.
 */
export function parseSkermoNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.replace(/\s+/g, '').replace(/\*/g, '');
  if (!text || !/\d/.test(text)) return null;

  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;

  const value = Number.parseFloat(normalized);
  if (Number.isNaN(value)) return null;
  return String(value);
}

/**
 * Género tal y como lo escribe Skermo en los resultados.
 *
 * `mapGender` no reconoce "MIxta" (busca "MIXTO"), y en la temporada
 * 2025-2026 hay 8 pruebas así, todas concentraciones del PFCAR. Se normaliza
 * aquí en vez de tocar el mapper compartido, que es de otra fuente.
 */
function mapSkermoGender(raw: string | null): 'M' | 'F' | 'MIXTO' | null {
  if (!raw) return null;
  const v = normalizeLabel(raw);
  if (v.startsWith('MIXT')) return 'MIXTO';
  return mapGender(raw);
}

// ----------------------------------------------- Temporadas del selector ---

export type SkermoSeasonOption = {
  /** Valor interno de Skermo ("17"). No es el año: es su id de temporada. */
  value: string;
  /** Etiqueta publicada ("2026-2027"), que es la que casa con `season.label`. */
  label: string;
  selected: boolean;
};

/**
 * Temporadas del desplegable, leídas de la propia página.
 *
 * Los ids de temporada de Skermo (2, 3, 10, 11…) no siguen ninguna regla
 * deducible y no se escriben en el código: se leen de la página cada vez. El
 * día que añadan la 2027-2028 no hay que tocar nada.
 */
export function parseSkermoSeasons(html: string): SkermoSeasonOption[] {
  const $ = cheerio.load(html);
  return $('select[name="season"] option')
    .toArray()
    .map((el) => ({
      value: ($(el).attr('value') ?? '').trim(),
      label: $(el).text().replace(/\s+/g, ' ').trim(),
      selected: $(el).attr('selected') !== undefined,
    }))
    .filter((o) => o.value && o.label);
}

// ----------------------------------------------- Índice de resultados ---

export type SkermoResultsIndexRow = {
  /** Id de Skermo de la clasificación HTML. Null si solo hay PDF. */
  competitionId: string | null;
  resultsUrl: string | null;
  /** Fecha de la prueba en ISO. */
  date: string | null;
  name: string;
  weapon: 'FLORETE' | 'ESPADA' | 'SABLE' | null;
  gender: 'M' | 'F' | 'MIXTO' | null;
  category: string | null;
  /** Texto exacto de la categoría ("VET40"), que la nuestra colapsa a VET. */
  categoryRaw: string | null;
  format: 'INDIVIDUAL' | 'EQUIPOS' | null;
  city: string | null;
  country: string | null;
  documents: { title: string; url: string }[];
};

/**
 * Lee el índice `/calendar/public/<FED>/results`.
 *
 * No valida ni descarta: devuelve lo que hay, incluidas las filas sin
 * clasificación HTML, para que quien llame decida. `mismatches` cuenta las
 * filas cuyo nº de celdas no cuadra con la cabecera, que es la alarma de
 * "han cambiado el marcado".
 */
export function parseSkermoResultsIndex(
  html: string,
  options: { federationCode: string },
): { rows: SkermoResultsIndexRow[]; rowsSeen: number; mismatches: number } {
  const $ = cheerio.load(html);
  const table = $('table.table').first();
  const { rows, mismatches } = readLabeledTable($, table);

  const parsed = rows.map<SkermoResultsIndexRow>((row) => {
    const categoryRaw = pickCell($, row, 'Categoría');
    /**
     * El enlace a la clasificación se busca por su ruta COMPLETA, no por
     * "/competition/" a secas: hay filas que además enlazan el directo de
     * Engarde (`engarde-service.com/competition/rfee/mc/ema_1f`), que contiene
     * la misma palabra y colaba primero, dejando esa prueba sin clasificación.
     */
    let competitionId: string | null = null;
    $(row.row)
      .find('a[href]')
      .each((_, a) => {
        if (competitionId) return;
        const href = $(a).attr('href') ?? '';
        const match = href.match(/\/ranking\/public\/[^/]+\/competition\/(\d+)/);
        if (match) competitionId = match[1];
      });

    const documents: { title: string; url: string }[] = [];
    $(row.row)
      .find('a[href*="/client/"]')
      .each((_, a) => {
        const url = $(a).attr('href');
        if (!url) return;
        documents.push({
          title: $(a).text().replace(/\s+/g, ' ').trim() || 'Clasificación (PDF)',
          url: url.startsWith('http') ? url : `${SKERMO_BASE_URL}${url}`,
        });
      });

    const { city, country } = parseLocation(pickCell($, row, 'Población'), {
      // Misma convención que el calendario: lo extranjero viene marcado con el
      // código de país entre paréntesis, así que lo no marcado es español.
      assumeCountry: 'ES',
    });

    return {
      competitionId,
      resultsUrl: competitionId
        ? skermoCompetitionResultsUrl(options.federationCode, competitionId)
        : null,
      date: parseSpanishDate(pickCell($, row, 'Fecha')),
      name: pickCell($, row, 'Nombre') ?? '',
      weapon: mapWeapon(pickCell($, row, 'Arma')),
      gender: mapSkermoGender(pickCell($, row, 'Género')),
      category: mapCategory(categoryRaw),
      categoryRaw,
      format: mapFormat(pickCell($, row, 'Modalidad')),
      city,
      country,
      documents,
    };
  });

  return { rows: parsed, rowsSeen: rows.length, mismatches };
}

// ------------------------------------------ Clasificación de una prueba ---

export type SkermoCompetitionMeta = {
  competitionId: string;
  /** Título tal cual lo publica Skermo, sin recortar. */
  rawTitle: string;
  /** Nombre de la prueba, ya sin el prefijo ni la temporada. */
  name: string;
  seasonLabel: string | null;
  date: string | null;
  weapon: 'FLORETE' | 'ESPADA' | 'SABLE' | null;
  gender: 'M' | 'F' | 'MIXTO' | null;
  category: string | null;
  categoryRaw: string | null;
  format: 'INDIVIDUAL' | 'EQUIPOS' | null;
  city: string | null;
  sourceUrl: string;
};

export type SkermoResultRow = {
  position: number | null;
  /** Número de licencia RFEE. La ÚNICA clave de emparejado admitida. */
  sourceLicense: string | null;
  sourceAthleteName: string;
  sourceFirstName: string | null;
  sourceLastName: string | null;
  sourceClub: string | null;
  /** Fecha de nacimiento publicada, en ISO. Sirve para revisar el emparejado. */
  sourceBirthDate: string | null;
  /** Puntuación publicada, como cadena decimal. Nunca 0 por defecto. */
  officialPoints: string | null;
};

/**
 * Lee la clasificación de una prueba.
 *
 * La cabecera de la página (arma, género, categoría, modalidad, fecha) viene
 * en una fila de `<h3>` sin etiqueta que diga cuál es cuál. En vez de leerlos
 * por posición —que es justo lo que se rompe cuando la fuente reordena—, cada
 * `<h3>` se pasa por los mapeadores y se queda donde encaje. Un `<h3>` que no
 * encaje en ninguno no estorba.
 */
export function parseSkermoCompetitionResults(
  html: string,
  options: { federationCode: string; competitionId: string },
): { meta: SkermoCompetitionMeta; rows: SkermoResultRow[]; rowsSeen: number; mismatches: number } {
  const $ = cheerio.load(html);

  let weapon: SkermoCompetitionMeta['weapon'] = null;
  let gender: SkermoCompetitionMeta['gender'] = null;
  let category: string | null = null;
  let categoryRaw: string | null = null;
  let format: SkermoCompetitionMeta['format'] = null;
  let date: string | null = null;

  $('div.row.hidden-xs h3, div.row.hidden-xs h5').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (!weapon && mapWeapon(text)) weapon = mapWeapon(text);
    else if (!gender && mapSkermoGender(text)) gender = mapSkermoGender(text);
    else if (!category && mapCategory(text)) {
      category = mapCategory(text);
      categoryRaw = text;
    } else if (!format && mapFormat(text)) format = mapFormat(text);
    else if (!date && parseSpanishDate(text)) date = parseSpanishDate(text);
  });

  const rawTitle = $('.panel-heading h3').first().text().replace(/\s+/g, ' ').trim();
  const city =
    $('.panel-heading .text-right h3').first().text().replace(/\s+/g, ' ').trim() || null;

  // "Resultado Competición TNR M20 2026-2027" -> nombre "TNR M20".
  const seasonLabel = rawTitle.match(/(\d{4}-\d{4})\s*$/)?.[1] ?? null;
  let name = rawTitle;
  if (seasonLabel) name = name.slice(0, name.length - seasonLabel.length).trim();
  const prefix = name.match(/^(.*?competici[oó]n)\s+/i)?.[1];
  if (prefix) name = name.slice(prefix.length).trim();

  const table = $('table').first();
  const { rows: labeled, mismatches } = readLabeledTable($, table);

  const rows = labeled.map<SkermoResultRow>((row) => {
    const firstName = pickCell($, row, 'Nombre');
    const lastName = pickCell($, row, 'Apellidos');
    const positionText = pickCell($, row, 'Posición');
    const position = positionText ? Number.parseInt(positionText, 10) : null;

    return {
      position: position !== null && Number.isFinite(position) ? position : null,
      sourceLicense: pickCell($, row, 'Licencia', 'Código Licencia'),
      sourceAthleteName: [firstName, lastName].filter(Boolean).join(' ').trim(),
      sourceFirstName: firstName,
      sourceLastName: lastName,
      sourceClub: pickCell($, row, 'Club'),
      sourceBirthDate: parseSpanishDate(pickCell($, row, 'Fecha Nacimiento')),
      officialPoints: parseSkermoNumber(pickCell($, row, 'Puntuación')),
    };
  });

  return {
    meta: {
      competitionId: options.competitionId,
      rawTitle,
      name,
      seasonLabel,
      date,
      weapon,
      gender,
      category,
      categoryRaw,
      format,
      city,
      sourceUrl: skermoCompetitionResultsUrl(
        options.federationCode,
        options.competitionId,
      ),
    },
    rows,
    rowsSeen: labeled.length,
    mismatches,
  };
}

// ------------------------------------------------- Ranking nacional ---

export type SkermoNationalRankingRow = {
  position: number | null;
  /**
   * Id interno de Skermo del tirador, sacado del enlace de la fila. NO es la
   * licencia: es su clave interna. Se guarda solo para poder ir a su ficha,
   * nunca para emparejar.
   */
  skermoAthleteId: string | null;
  athleteUrl: string | null;
  sourceAthleteName: string;
  sourceFirstName: string | null;
  sourceLastName: string | null;
  sourceClub: string | null;
  sourceBirthDate: string | null;
  totalPoints: string | null;
};

/**
 * Lee el ranking nacional publicado por la RFEE en Skermo.
 *
 * AVISO IMPORTANTE, y por eso no alimenta el emparejado: esta tabla **no
 * publica el número de licencia**. Sus columnas son puesto, nombre, apellidos,
 * fecha de nacimiento, club y puntuación. La licencia solo aparece una
 * pantalla más adentro (`parseSkermoRankingAthlete`), a una petición por
 * tirador. Por eso este ranking se usa como CONTRASTE del nuestro, no como
 * fuente de resultados emparejados.
 */
export function parseSkermoNationalRanking(
  html: string,
  options: { federationCode: string },
): { rows: SkermoNationalRankingRow[]; rowsSeen: number; mismatches: number } {
  const $ = cheerio.load(html);
  const table = $('table.table').first();
  const { rows: labeled, mismatches } = readLabeledTable($, table);

  const rows = labeled.map<SkermoNationalRankingRow>((row) => {
    const firstName = pickCell($, row, 'Nombre');
    const lastName = pickCell($, row, 'Apellidos');
    const href = $(row.row).find('a[href*="/ranking-rfee/public/"]').attr('href') ?? null;
    const skermoAthleteId = href?.match(/\/public\/[^/]+\/(\d+)/)?.[1] ?? null;
    const positionText = pickCell($, row, 'Posición');
    const position = positionText ? Number.parseInt(positionText, 10) : null;

    return {
      position: position !== null && Number.isFinite(position) ? position : null,
      skermoAthleteId,
      athleteUrl: skermoAthleteId
        ? skermoRankingAthleteUrl(options.federationCode, skermoAthleteId)
        : null,
      sourceAthleteName: [firstName, lastName].filter(Boolean).join(' ').trim(),
      sourceFirstName: firstName,
      sourceLastName: lastName,
      sourceClub: pickCell($, row, 'Club'),
      sourceBirthDate: parseSpanishDate(pickCell($, row, 'Fecha nacimiento')),
      totalPoints: parseSkermoNumber(pickCell($, row, 'Puntuación')),
    };
  });

  return { rows, rowsSeen: labeled.length, mismatches };
}

/**
 * Ficha de un tirador dentro del ranking nacional: es la única pantalla que
 * une su id de Skermo con su número de licencia RFEE. Sirve para que el admin
 * resuelva un emparejado dudoso mirando el dato, no adivinando.
 */
export function parseSkermoRankingAthlete(html: string): {
  sourceLicense: string | null;
  sourceAthleteName: string;
  sourceClub: string | null;
  sourceBirthDate: string | null;
  categoryRaw: string | null;
} | null {
  const $ = cheerio.load(html);
  const { rows } = readLabeledTable($, $('table.table').first());
  const row = rows[0];
  if (!row) return null;

  const firstName = pickCell($, row, 'Nombre');
  const lastName = pickCell($, row, 'Apellidos');

  return {
    sourceLicense: pickCell($, row, 'Código Licencia', 'Licencia'),
    sourceAthleteName: [firstName, lastName].filter(Boolean).join(' ').trim(),
    sourceClub: pickCell($, row, 'Club'),
    sourceBirthDate: parseSpanishDate(pickCell($, row, 'Fecha Nacimiento')),
    categoryRaw: pickCell($, row, 'Categoría'),
  };
}

// ----------------------------------------------------------- Validación ---

/**
 * Validación en el borde. Lo que no pase de aquí NO entra en `result` ni,
 * por tanto, en el ranking: va a `ingest_quarantine` y sale en el panel de
 * admin. Un resultado dudoso visible es infinitamente mejor que un resultado
 * malo contando puntos.
 */
export const skermoResultRowSchema = z.object({
  position: z
    .number()
    .int()
    .positive('El puesto tiene que ser un entero positivo'),
  sourceAthleteName: z.string().min(2, 'Un resultado sin nombre no sirve de nada'),
  sourceLicense: z.string().min(3).nullable(),
  sourceFirstName: z.string().nullable(),
  sourceLastName: z.string().nullable(),
  sourceClub: z.string().nullable(),
  sourceBirthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha de nacimiento debe venir como YYYY-MM-DD')
    .nullable(),
  officialPoints: z.string().nullable(),
});

export const skermoCompetitionMetaSchema = z.object({
  competitionId: z.string().min(1),
  name: z.string().min(2, 'La prueba tiene que tener nombre'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La prueba tiene que tener fecha'),
  weapon: z.enum(['FLORETE', 'ESPADA', 'SABLE']),
  gender: z.enum(['M', 'F', 'MIXTO']),
  category: z.enum([
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
  ]),
  format: z.enum(['INDIVIDUAL', 'EQUIPOS']),
});

export type QuarantinedResult = {
  sourceId: string | null;
  raw: unknown;
  errors: { path: string; message: string }[];
};

export function validateResultRows(
  rows: SkermoResultRow[],
  context: { competitionId: string },
): { valid: z.infer<typeof skermoResultRowSchema>[]; quarantined: QuarantinedResult[] } {
  const valid: z.infer<typeof skermoResultRowSchema>[] = [];
  const quarantined: QuarantinedResult[] = [];

  for (const row of rows) {
    const parsed = skermoResultRowSchema.safeParse(row);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      quarantined.push({
        sourceId: `${context.competitionId}:${row.sourceLicense ?? row.sourceAthleteName}`,
        raw: row,
        errors: formatZodIssues(parsed.error),
      });
    }
  }

  return { valid, quarantined };
}

// ------------------------------------------------------- Idempotencia ---

/**
 * Hash del contenido de una fila de resultado, igual que en `upsert.ts`: si
 * una segunda pasada lee lo mismo, la fila no se toca y `updated` sale a 0.
 * Se incluye solo lo que, si cambia, cambia el resultado deportivo; la fecha
 * de ingestión queda fuera a propósito.
 */
export async function resultContentHash(row: {
  competitionId: string;
  position: number;
  sourceAthleteName: string;
  sourceLicense: string | null;
  sourceClub: string | null;
  officialPoints: string | null;
}): Promise<string> {
  return sha256(
    JSON.stringify([
      row.competitionId,
      row.position,
      row.sourceAthleteName,
      row.sourceLicense,
      row.sourceClub,
      row.officialPoints,
    ]),
  );
}

// ------------------------------------------------------------ Ingestión ---

export type SkermoResultsIngestStats = {
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsQuarantined: number;
  /** Filas guardadas sin `athleteId`: cola de "por emparejar" del admin. */
  unmatchedAthletes: number;
  competitionsFetched: number;
  competitionsUnmatched: number;
  note: string | null;
};

export type SkermoResultsIngestOptions = {
  federationCode?: string;
  /** Etiqueta de temporada ("2026-2027"). Por defecto, la que Skermo marque. */
  seasonLabel?: string;
  /**
   * Tope de clasificaciones que se descargan en una pasada. Cada una es una
   * petición HTTP y una función de Vercel muere a los 300 s, así que hay
   * tope: lo que no entre hoy entra mañana, porque lo ya ingerido se salta.
   */
  maxCompetitions?: number;
  /** Vuelve a descargar también las pruebas que ya tienen resultados. */
  force?: boolean;
  /** Milisegundos de espera entre peticiones. Cortesía con la fuente. */
  delayMs?: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Clave con la que se busca la prueba equivalente en nuestro calendario. */
function competitionMatchKey(parts: {
  date: string;
  weapon: string;
  gender: string;
  category: string;
  format: string;
}): string {
  return `${parts.date}|${parts.weapon}|${parts.gender}|${parts.category}|${parts.format}`;
}

/** `date` de Drizzle puede venir como Date o como cadena según el driver. */
function toIsoDate(value: string | Date | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  // Se formatea en hora de Madrid: la fecha de una prueba es un día natural
  // español, y pasarla por UTC la retrasa un día media temporada.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

/**
 * Ingiere los resultados publicados por Skermo.
 *
 * REGLA DE ORO DEL EMPAREJADO, que es lo delicado de todo esto: un resultado
 * se asocia a un tirador nuestro SOLO por número de licencia RFEE. Si la
 * fuente no publica licencia, o la licencia no está en nuestra base, la fila
 * se guarda igual con `athlete_id = null` y queda en la cola de "por
 * emparejar" que el admin resuelve con un clic.
 *
 * NUNCA se empareja por nombre automáticamente. Hay homónimos (dos "Lucía
 * García Martínez" en la misma categoría no es hipotético) y los acentos van
 * a su aire entre fuentes ("GARCIA" / "GARCÍA", "PEREZ" / "PÉREZ"). Un
 * emparejado por nombre acierta casi siempre, y ese "casi" significa puntos de
 * ranking en la persona equivocada: exactamente el error que nadie detecta
 * hasta que alguien se queda fuera de una convocatoria. Por eso se guardan
 * siempre `source_athlete_name`, `source_license` y `source_club` tal cual los
 * publica la fuente: para que el emparejado se pueda auditar después.
 *
 * No se importa de aquí `@/db` en el nivel del módulo a propósito: ese módulo
 * lanza si falta `DATABASE_URL`, y eso dejaría los tests del parser sin poder
 * importar este fichero. Se carga dentro, solo cuando de verdad hace falta.
 */
export async function ingestSkermoResults(
  runId: string,
  options: SkermoResultsIngestOptions = {},
): Promise<SkermoResultsIngestStats> {
  const {
    federationCode = 'RFEE',
    maxCompetitions = 40,
    force = false,
    delayMs = 250,
  } = options;

  const { db } = await import('@/db');
  const { eq, inArray, isNotNull, sql } = await import('drizzle-orm');

  const stats: SkermoResultsIngestStats = {
    itemsSeen: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    itemsQuarantined: 0,
    unmatchedAthletes: 0,
    competitionsFetched: 0,
    competitionsUnmatched: 0,
    note: null,
  };

  // --- 1. Índice de resultados, en la temporada que toque ---
  let indexHtml = (await fetchText(skermoResultsUrl(federationCode), { timeoutMs: 120_000 }))
    .body;
  const seasons = parseSkermoSeasons(indexHtml);

  if (options.seasonLabel) {
    const wanted = seasons.find((s) => s.label === options.seasonLabel);
    if (!wanted) {
      throw new Error(
        `Skermo no publica la temporada "${options.seasonLabel}". Publica: ` +
          seasons.map((s) => s.label).join(', '),
      );
    }
    if (!wanted.selected) {
      indexHtml = (
        await fetchText(skermoResultsUrl(federationCode, { season: wanted.value }), {
          timeoutMs: 120_000,
        })
      ).body;
    }
  }

  const index = parseSkermoResultsIndex(indexHtml, { federationCode });
  stats.itemsSeen = index.rowsSeen;

  if (index.rowsSeen === 0) {
    // Cero filas no es "todo bien, no hay resultados": o no hay nada publicado
    // todavía, o el marcado ha cambiado. Se dice, no se calla.
    stats.note =
      'El índice de resultados de Skermo no ha devuelto ninguna fila. Puede que ' +
      'aún no haya resultados publicados en esta temporada, o que haya cambiado ' +
      'el marcado de la fuente.';
    return stats;
  }

  if (index.mismatches > 0) {
    stats.note =
      `${index.mismatches} filas del índice de resultados no cuadran con su ` +
      'cabecera: revisa si Skermo ha cambiado las columnas.';
  }

  /** Solo las pruebas individuales publican clasificación en HTML. */
  const withResults = index.rows.filter((r) => r.competitionId && r.date);

  // --- 2. Lo ya ingerido se salta: el cron de mañana sigue donde este lo dejó ---
  const alreadyIngested = new Set<string>();
  if (!force) {
    const rows = await db
      .selectDistinct({ sourceUrl: resultTable.sourceUrl })
      .from(resultTable)
      .where(isNotNull(resultTable.sourceUrl));
    for (const row of rows) {
      const id = row.sourceUrl?.match(/\/competition\/(\d+)/)?.[1];
      if (id) alreadyIngested.add(id);
    }
  }

  const pending = withResults
    .filter((r) => force || !alreadyIngested.has(r.competitionId as string))
    // De la más reciente a la más antigua: si hay tope, que entre lo de ahora.
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, maxCompetitions);

  if (pending.length === 0) {
    stats.note = [stats.note, 'No hay clasificaciones nuevas que descargar.']
      .filter(Boolean)
      .join(' ');
    return stats;
  }

  // --- 3. Precarga: pruebas del calendario y licencias, en dos consultas ---
  const dates = [...new Set(pending.map((r) => r.date as string))];
  const calendarRows = await db
    .select({
      competitionId: eventCompetitionTable.id,
      eventId: eventCompetitionTable.eventId,
      weapon: eventCompetitionTable.weapon,
      gender: eventCompetitionTable.gender,
      category: eventCompetitionTable.category,
      format: eventCompetitionTable.format,
      competitionDate: eventCompetitionTable.competitionDate,
      startDate: eventTable.startDate,
      eventName: eventTable.name,
      city: eventTable.city,
    })
    .from(eventCompetitionTable)
    .innerJoin(eventTable, eq(eventTable.id, eventCompetitionTable.eventId))
    .where(
      // Se busca por la fecha de la prueba o, si no la hay, por la de inicio
      // del evento: Skermo no siempre rellena la fecha de cada prueba. Se
      // compara en texto para no depender de cómo case Postgres date/text.
      sql`to_char(coalesce(${eventCompetitionTable.competitionDate}, ${eventTable.startDate}), 'YYYY-MM-DD') in (${sql.join(
        dates.map((d) => sql`${d}`),
        sql`, `,
      )})`,
    );

  const byKey = new Map<string, typeof calendarRows>();
  for (const row of calendarRows) {
    const date = toIsoDate(row.competitionDate) ?? toIsoDate(row.startDate);
    if (!date) continue;
    const key = competitionMatchKey({
      date,
      weapon: row.weapon,
      gender: row.gender,
      category: row.category,
      format: row.format,
    });
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const licenseRows = await db
    .select({ id: athleteTable.id, rfeeLicense: athleteTable.rfeeLicense })
    .from(athleteTable)
    .where(isNotNull(athleteTable.rfeeLicense));
  const athleteByLicense = new Map<string, string>();
  for (const row of licenseRows) {
    if (row.rfeeLicense) athleteByLicense.set(normalizeLicense(row.rfeeLicense), row.id);
  }

  // --- 4. Una petición por clasificación ---
  const quarantine: QuarantinedResult[] = [];
  const toUpsert: (typeof resultTable.$inferInsert)[] = [];
  /** Hash de lo que ya hay guardado, para no reescribir lo que no cambió. */
  const existingHashes = new Map<string, string>();
  const resolvedCompetitionIds = new Set<string>();

  for (const row of pending) {
    const competitionId = row.competitionId as string;

    let html: string;
    try {
      html = (
        await fetchText(skermoCompetitionResultsUrl(federationCode, competitionId), {
          timeoutMs: 60_000,
        })
      ).body;
    } catch (error) {
      quarantine.push({
        sourceId: competitionId,
        raw: { competitionId, url: row.resultsUrl },
        errors: [
          {
            path: '(descarga)',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
      continue;
    }

    stats.competitionsFetched += 1;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    const parsed = parseSkermoCompetitionResults(html, {
      federationCode,
      competitionId,
    });

    /**
     * La cabecera de la clasificación manda, pero si falta algún dato se
     * completa con lo que decía el índice. Son la misma prueba vista desde
     * dos pantallas, y el índice trae siempre las seis columnas.
     */
    const meta = {
      competitionId,
      name: parsed.meta.name || row.name,
      date: parsed.meta.date ?? row.date,
      weapon: parsed.meta.weapon ?? row.weapon,
      gender: parsed.meta.gender ?? row.gender,
      category: parsed.meta.category ?? row.category,
      format: parsed.meta.format ?? row.format,
    };

    const metaCheck = skermoCompetitionMetaSchema.safeParse(meta);
    if (!metaCheck.success) {
      quarantine.push({
        sourceId: competitionId,
        raw: { meta, indexRow: row },
        errors: formatZodIssues(metaCheck.error),
      });
      continue;
    }

    // Emparejado con nuestro calendario. Si sale más de un candidato se
    // desempata por el nombre del evento; si sigue habiendo dudas, cuarentena.
    const candidates =
      byKey.get(
        competitionMatchKey({
          date: metaCheck.data.date,
          weapon: metaCheck.data.weapon,
          gender: metaCheck.data.gender,
          category: metaCheck.data.category,
          format: metaCheck.data.format,
        }),
      ) ?? [];

    let match = candidates.length === 1 ? candidates[0] : undefined;
    if (!match && candidates.length > 1) {
      const wanted = normalizeLabel(metaCheck.data.name);
      match = candidates.find((c) => normalizeLabel(c.eventName) === wanted);
    }

    if (!match) {
      stats.competitionsUnmatched += 1;
      quarantine.push({
        sourceId: competitionId,
        raw: { meta: metaCheck.data, candidatos: candidates.length, indexRow: row },
        errors: [
          {
            path: 'eventCompetitionId',
            message:
              candidates.length === 0
                ? 'Ninguna prueba del calendario coincide en fecha, arma, género, ' +
                  'categoría y modalidad. Los resultados no se guardan hasta que la ' +
                  'prueba exista o alguien la empareje a mano.'
                : `Hay ${candidates.length} pruebas del calendario que encajan y ` +
                  'ninguna tiene el mismo nombre. Se deja sin emparejar en vez de ' +
                  'elegir una al azar.',
          },
        ],
      });
      continue;
    }

    resolvedCompetitionIds.add(match.competitionId);

    const validated = validateResultRows(parsed.rows, { competitionId });
    quarantine.push(...validated.quarantined);

    for (const item of validated.valid) {
      const license = item.sourceLicense ? normalizeLicense(item.sourceLicense) : null;
      const athleteId = license ? (athleteByLicense.get(license) ?? null) : null;
      if (!athleteId) stats.unmatchedAthletes += 1;

      toUpsert.push({
        eventCompetitionId: match.competitionId,
        eventId: match.eventId,
        athleteId,
        sourceAthleteName: item.sourceAthleteName,
        sourceLicense: item.sourceLicense,
        sourceClub: item.sourceClub,
        position: item.position,
        officialPoints: item.officialPoints,
        weapon: metaCheck.data.weapon,
        gender: metaCheck.data.gender === 'MIXTO' ? null : metaCheck.data.gender,
        category: metaCheck.data.category,
        sourceUrl: parsed.meta.sourceUrl,
        contentHash: await resultContentHash({
          competitionId,
          position: item.position,
          sourceAthleteName: item.sourceAthleteName,
          sourceLicense: item.sourceLicense,
          sourceClub: item.sourceClub,
          officialPoints: item.officialPoints,
        }),
      });
    }
  }

  // --- 5. Escritura idempotente ---
  if (resolvedCompetitionIds.size > 0) {
    for (const batch of chunk([...resolvedCompetitionIds], 200)) {
      const rows = await db
        .select({
          eventCompetitionId: resultTable.eventCompetitionId,
          sourceAthleteName: resultTable.sourceAthleteName,
          position: resultTable.position,
          contentHash: resultTable.contentHash,
        })
        .from(resultTable)
        .where(inArray(resultTable.eventCompetitionId, batch));
      for (const row of rows) {
        existingHashes.set(
          `${row.eventCompetitionId}|${row.sourceAthleteName}|${row.position}`,
          row.contentHash,
        );
      }
    }
  }

  const changed = toUpsert.filter((r) => {
    const key = `${r.eventCompetitionId}|${r.sourceAthleteName}|${r.position}`;
    const previous = existingHashes.get(key);
    if (previous === undefined) {
      stats.itemsCreated += 1;
      return true;
    }
    if (previous === r.contentHash) {
      stats.itemsUnchanged += 1;
      return false;
    }
    stats.itemsUpdated += 1;
    return true;
  });

  for (const batch of chunk(changed, 150)) {
    await db
      .insert(resultTable)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          resultTable.eventCompetitionId,
          resultTable.sourceAthleteName,
          resultTable.position,
        ],
        set: {
          athleteId: sql`excluded."athlete_id"`,
          sourceLicense: sql`excluded."source_license"`,
          sourceClub: sql`excluded."source_club"`,
          officialPoints: sql`excluded."official_points"`,
          contentHash: sql`excluded."content_hash"`,
          ingestedAt: new Date(),
        },
      });
  }

  // --- 6. Cuarentena ---
  for (const item of quarantine) {
    await db.insert(ingestQuarantine).values({
      ingestRunId: runId,
      // `event_source` no tiene todavía un valor propio para los resultados;
      // se usa el de la fuente de la que salen. Ver informe.
      source: 'skermo_rfee',
      sourceId: item.sourceId,
      rawPayload: item.raw as never,
      validationErrors: item.errors as never,
    });
  }
  stats.itemsQuarantined = quarantine.length;

  const pendientes = withResults.length - alreadyIngested.size - pending.length;
  stats.note = [
    stats.note,
    `${stats.competitionsFetched} clasificaciones leídas de ${withResults.length} ` +
      'con resultados publicados',
    pendientes > 0 ? `${pendientes} quedan para la próxima pasada` : null,
    stats.unmatchedAthletes > 0
      ? `${stats.unmatchedAthletes} resultados sin tirador emparejado (licencia ` +
        'desconocida o no publicada): están en la cola de emparejado'
      : null,
    stats.competitionsUnmatched > 0
      ? `${stats.competitionsUnmatched} pruebas no se han podido casar con el calendario`
      : null,
  ]
    .filter(Boolean)
    .join('. ');

  return stats;
}

/**
 * Licencias en forma canónica antes de comparar: Skermo las escribe en
 * mayúsculas y sin espacios ("SGL00510"), pero un alta manual puede traer
 * " sgl00510 ". Comparar en crudo dejaría sin emparejar a gente por un espacio.
 */
export function normalizeLicense(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/**
 * Descarga y parsea un ranking nacional concreto. Se expone suelto —sin
 * escribir nada— porque sirve para CONTRASTAR nuestro ranking con el oficial:
 * si los dos ordenan distinto, hay algo que mirar antes de que lo mire un
 * padre. No alimenta `result` porque esa tabla no publica la licencia.
 */
export async function fetchSkermoNationalRanking(params: {
  federationCode?: string;
  season: string | number;
  weapon: 'E' | 'F' | 'S';
  category: string | number;
  gender: 'W' | 'M';
}): Promise<{ rows: SkermoNationalRankingRow[]; rowsSeen: number; sourceUrl: string }> {
  const federationCode = params.federationCode ?? 'RFEE';
  const url = skermoNationalRankingUrl(federationCode, params);
  const { body } = await fetchText(url, { timeoutMs: 60_000 });
  const parsed = parseSkermoNationalRanking(body, { federationCode });
  return { rows: parsed.rows, rowsSeen: parsed.rowsSeen, sourceUrl: url };
}
