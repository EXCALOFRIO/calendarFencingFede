import { fetchJson } from '../fetcher';

/**
 * Circulares oficiales de la RFEE desde `esgrima.es`.
 *
 * `esgrima.es` es WordPress con la REST API abierta, así que esto NO es
 * scraping: es una API JSON de verdad, con fecha, título y URL del PDF.
 *
 *   GET /wp-json/wp/v2/media?search=circular&mime_type=application/pdf
 *
 * El muro de documentos oficiales se alimenta solo, lo que ya por sí solo es
 * mejor que buscar entre PDFs sueltos en la web de la federación.
 */

const WP_API = 'https://esgrima.es/wp-json/wp/v2';

type WpMedia = {
  id: number;
  date_gmt: string;
  title: { rendered: string };
  source_url: string;
  media_type: string;
  mime_type: string;
};

export type OfficialDocumentCandidate = {
  wpMediaId: number;
  title: string;
  pdfUrl: string;
  publishedAt: Date;
  circularNumber: string | null;
  seasonLabel: string | null;
  mentionsFees: boolean;
};

/** Decodifica entidades HTML de los títulos de WordPress. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ordf;/g, 'ª')
    .replace(/&ordm;/g, 'º')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Del nombre "CIRCULAR 12-26 GESTIÓN ADMINISTRATIVA 26-27" saca el número
 * ("12-26") y la temporada ("2026-2027"). Si no encaja el patrón devuelve
 * null: se muestra el título tal cual antes que inventar una numeración.
 */
export function parseCircularName(title: string): {
  circularNumber: string | null;
  seasonLabel: string | null;
} {
  const clean = decodeEntities(title);

  const numberMatch = clean.match(/CIRCULAR[\s_-]*(\d{1,3})[\s_-]*(\d{2})/i);
  const circularNumber = numberMatch ? `${numberMatch[1]}-${numberMatch[2]}` : null;

  // Temporada escrita como "26-27" o "2026-2027".
  const seasonMatch =
    clean.match(/(\d{4})\s*[-/]\s*(\d{4})/) ?? clean.match(/(\d{2})\s*[-/]\s*(\d{2})\s*$/);
  let seasonLabel: string | null = null;
  if (seasonMatch) {
    const [, a, b] = seasonMatch;
    seasonLabel =
      a.length === 4 ? `${a}-${b}` : `20${a}-20${b}`;
  }

  return { circularNumber, seasonLabel };
}

/**
 * Palabras que hacen que salte un aviso al admin: "circular nueva del 14/07,
 * revisa si cambian los importes". No se actualiza nada solo a escondidas;
 * avisa y decide una persona.
 */
const FEE_KEYWORDS = [
  'recargo',
  'inscripcion',
  'inscripción',
  'plazo',
  'cuota',
  'tarifa',
  'precio',
  'economic',
  'derechos',
  'categoria',
  'categoría',
  'ranking',
  'normativa',
  'administrativa',
  'competiciones',
];

export function mentionsFees(title: string): boolean {
  const normalized = decodeEntities(title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return FEE_KEYWORDS.some((k) =>
    normalized.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()),
  );
}

export function mapWpMedia(item: WpMedia): OfficialDocumentCandidate | null {
  if (item.mime_type !== 'application/pdf') return null;

  const title = decodeEntities(item.title?.rendered ?? '');
  if (!title || !item.source_url) return null;

  const publishedAt = new Date(`${item.date_gmt}Z`);
  if (Number.isNaN(publishedAt.getTime())) return null;

  const { circularNumber, seasonLabel } = parseCircularName(title);

  return {
    wpMediaId: item.id,
    title,
    pdfUrl: item.source_url,
    publishedAt,
    circularNumber,
    seasonLabel,
    // Se mira el título Y el nombre del fichero: los títulos de WordPress son
    // cortos y a veces la pista está solo en la URL del PDF.
    mentionsFees: mentionsFees(`${title} ${item.source_url}`),
  };
}

/**
 * Descarga las circulares. Se paginan de 100 en 100, que es el tope de la API
 * de WordPress, y se recorren varias búsquedas porque no todos los documentos
 * llevan la palabra "circular" en el título.
 */
export async function fetchOfficialDocuments(
  options: { searches?: string[]; maxPages?: number } = {},
): Promise<{ candidates: OfficialDocumentCandidate[]; rowsSeen: number }> {
  const searches = options.searches ?? ['circular', 'convocatoria', 'normativa'];
  const maxPages = options.maxPages ?? 3;

  const byId = new Map<number, OfficialDocumentCandidate>();
  let rowsSeen = 0;

  for (const search of searches) {
    for (let page = 1; page <= maxPages; page += 1) {
      let items: WpMedia[];
      try {
        items = await fetchJson<WpMedia[]>(
          `${WP_API}/media?search=${encodeURIComponent(search)}` +
            `&mime_type=application/pdf&per_page=100&page=${page}&orderby=date&order=desc`,
        );
      } catch {
        // WordPress devuelve 400 cuando se pide una página que no existe.
        // No es un fallo de la fuente: simplemente se han acabado.
        break;
      }

      if (!Array.isArray(items) || items.length === 0) break;
      rowsSeen += items.length;

      for (const item of items) {
        const mapped = mapWpMedia(item);
        if (mapped && !byId.has(mapped.wpMediaId)) byId.set(mapped.wpMediaId, mapped);
      }

      if (items.length < 100) break;
    }
  }

  const candidates = [...byId.values()].sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
  );

  return { candidates, rowsSeen };
}
