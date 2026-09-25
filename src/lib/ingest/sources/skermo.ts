import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import {
  inferScope,
  mapCategory,
  mapCircuit,
  mapFormat,
  mapGender,
  mapWeapon,
  normalizeLabel,
  parseLocation,
  parseSpanishDate,
  parseSpanishDateRange,
  parseSpanishDateTime,
  refineCircuitByName,
  timezoneForCountry,
} from '../mappers';
import type { NormalizedCompetition, NormalizedEvent } from '../types';

/**
 * Parser del calendario público de Skermo.
 *
 * Todo lo que hay aquí está escrito contra el marcado real de
 * `app.skermo.org/calendar/public/<FED>`, comprobado en vivo. Cuatro cosas de
 * ese HTML condicionan el código:
 *
 * 1. Es Laravel/Blade renderizado en servidor: los datos vienen en el HTML
 *    inicial, no hay AJAX. Una sola petición por federación lo trae TODO,
 *    incluidos los detalles y los PDFs, que viajan en modales de Bootstrap
 *    ocultos. No hay que seguir enlaces.
 * 2. No existe una URL de detalle por competición: el nombre enlaza a un
 *    ancla local (`#detail10249`). El número de ese ancla es el ID real de
 *    Skermo, y es la clave estable que usamos.
 * 3. Las filas de la tabla tienen dos `<td>` de más que solo se ven en móvil,
 *    así que emparejar `thead th` con `tbody td` por posición da datos
 *    corridos. Se lee todo del modal, por ETIQUETA y no por posición, porque
 *    además las etiquetas varían entre federaciones (FECYL no publica
 *    "Lugar"/"Dirección"; solo FECYL y FCE publican "Coeficiente").
 * 4. Hay tablas anidadas dentro de cada modal (inscritos, documentos) y el
 *    atributo `id="resultsInner"` está duplicado. Ni `table.table tbody tr`
 *    ni ese id sirven como selector.
 *
 * Lo que Skermo NO publica, comprobado enumerando todas las etiquetas del DOM:
 * cuotas, precios, recargos ni plazos escalonados. Solo hay UNA fecha,
 * "Fin inscripciones". Por eso los recargos van en tablas de normativa
 * editables y no se sacan de aquí: no están.
 */

export const SKERMO_BASE_URL = 'https://app.skermo.org';

/** Códigos de federación verificados (los inválidos devuelven HTTP 500). */
export const SKERMO_FEDERATIONS = {
  RFEE: 'Real Federación Española de Esgrima',
  FCE: 'Federació Catalana d’Esgrima',
  FME: 'Federación de Madrid',
  FECYL: 'Federación de Castilla y León',
  FAE: 'Federación FAE',
  FVE: 'Federación FVE',
  FGE: 'Federación Galega',
  FNE: 'Federación Navarra',
  FEXE: 'Federación de Extremadura',
  FRE: 'Federación FRE',
  FCANE: 'Federación Canaria',
  FEESCLM: 'Federación de Castilla-La Mancha',
} as const;

export type SkermoFederationCode = keyof typeof SKERMO_FEDERATIONS;

/**
 * URL del calendario, con los tres parámetros que importan:
 *
 * - `setLang=es` fija el idioma, y con él los nombres de las etiquetas que
 *   parseamos (en catalán o inglés cambian y el parseo por etiqueta falla).
 * - `showPrevious=1` incluye las competiciones ya celebradas, que hacen falta
 *   para resultados y ranking.
 * - `showExt=1` es el importante: **sin él la página devuelve 36
 *   competiciones; con él, 425** (comprobado en vivo el 25/09/2026). Incluye
 *   las pruebas externas e internacionales del calendario federativo. Sin este
 *   parámetro nos dejaríamos fuera el 90 % del calendario.
 *
 * Todo viene en una sola petición: no hay paginación en `/calendar` (sí en
 * `/planner`, que además mezcla federaciones y por eso no se usa).
 */
export function skermoCalendarUrl(
  code: string,
  options: {
    showPrevious?: boolean;
    showExternal?: boolean;
    season?: string | number;
  } = {},
): string {
  const params = new URLSearchParams({ setLang: 'es' });
  if (options.showPrevious ?? true) params.set('showPrevious', '1');
  if (options.showExternal ?? true) params.set('showExt', '1');
  if (options.season) params.set('season', String(options.season));
  return `${SKERMO_BASE_URL}/calendar/public/${code}?${params.toString()}`;
}

type LabelMap = Map<string, string>;

/**
 * Construye un mapa etiqueta -> valor recorriendo los `<label>` del contenedor
 * y acumulando los nodos siguientes hasta el próximo `<br>`, `<label>` o
 * cabecera. Es la única forma robusta de leer estos modales, porque el juego
 * de etiquetas cambia de una federación a otra.
 */
function labelMap($: cheerio.CheerioAPI, container: cheerio.Cheerio<AnyNode>): LabelMap {
  const map: LabelMap = new Map();

  container.find('label').each((_, labelEl) => {
    const key = normalizeLabel($(labelEl).text()).replace(/:$/, '').trim();
    if (!key) return;

    const parts: string[] = [];
    let node: AnyNode | null = labelEl.nextSibling;

    while (node) {
      if (node.type === 'text') {
        parts.push(node.data ?? '');
      } else if (node.type === 'tag') {
        const tag = (node as Element).tagName?.toLowerCase();
        if (tag === 'br' || tag === 'label' || tag === 'h4' || tag === 'table') break;
        parts.push($(node).text());
      }
      node = node.nextSibling;
    }

    const value = parts.join(' ').replace(/\s+/g, ' ').trim();
    // Si una etiqueta se repite, gana la primera aparición: los modales
    // reutilizan nombres de campo entre pestañas.
    if (value && !map.has(key)) map.set(key, value);
  });

  return map;
}

function pick(map: LabelMap, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = map.get(normalizeLabel(k).replace(/:$/, '').trim());
    if (v) return v;
  }
  return null;
}

/** Clave de agrupación: varias filas de Skermo son pruebas del mismo torneo. */
function eventKey(name: string, city: string | null, startDate: string): string {
  const slug = (s: string) =>
    normalizeLabel(s)
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
  return `${slug(name)}|${slug(city ?? 'sin-sede')}|${startDate}`;
}

type RawRow = {
  skermoId: string;
  name: string;
  general: LabelMap;
  location: LabelMap;
  documents: { title: string; url: string; kind: string | null }[];
  registrationCount: number | null;
  registrations: { sourceAthleteName: string; sourceTeam: string }[];
  notes: string | null;
};

/**
 * Lee la lista NOMINAL de inscritos de la pestaña "Inscritos" del modal.
 *
 * Marcado real, comprobado sobre las 425 competiciones del calendario de la
 * RFEE 2026-2027:
 *
 * - Individuales (407 pruebas): una sola columna, `<th>Nombre <b>(12)</b></th>`.
 *   El número entre paréntesis es el total, y es de donde ya salía
 *   `registrationCount`.
 * - Equipos (18 pruebas): dos columnas, `Nombre` y `Equipos`, y **sin número
 *   en la cabecera**. De ahí que 18 pruebas se quedaran sin nº de inscritos:
 *   no es que no lo publique, es que hay que contar las filas.
 *
 * La tabla anidada tiene `id="resultsInner"` DUPLICADO en todo el documento,
 * así que no vale como selector: se busca dentro del contenedor del modal.
 */
function readRegistrations(
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<AnyNode>,
): { sourceAthleteName: string; sourceTeam: string; sourceClub: string | null }[] {
  const table = container.find('table').first();
  if (table.length === 0) return [];

  /** Índice de la columna "Equipos", si la prueba es por equipos. */
  const headers = table
    .find('thead th')
    .toArray()
    .map((th) => normalizeLabel($(th).text()));
  const teamColumn = headers.findIndex((h) => h.startsWith('EQUIPO'));

  const out: {
    sourceAthleteName: string;
    sourceTeam: string;
    sourceClub: string | null;
  }[] = [];
  const vistos = new Set<string>();

  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').toArray();
    if (cells.length === 0) return;

    /**
     * El estado vacío de Skermo es UNA FILA MÁS de la tabla:
     * `<tr><td colspan="2" class="text-center">No se han encontrado
     * inscripciones</td></tr>`. Sin este filtro, las 407 pruebas sin
     * inscritos "tenían" un inscrito llamado "No se han encontrado
     * inscripciones" —lo cazó el test que compara la lista con el número de
     * la cabecera—. Se detecta por el `colspan`, que es estructural, y no por
     * el texto, que cambia con el idioma de la página.
     */
    if (cells.some((td) => $(td).attr('colspan'))) return;

    // Skermo mete la numeración de la vista móvil DENTRO de la celda del
    // nombre (`<span class="hidden-lg hidden-md">3. </span>`): fuera.
    const nameCell = $(cells[0]).clone();
    nameCell.find('[class*="hidden-lg"]').remove();
    let sourceAthleteName = nameCell.text().replace(/\s+/g, ' ').trim();
    if (!sourceAthleteName) return;

    const sourceTeam =
      teamColumn > 0 && cells[teamColumn]
        ? $(cells[teamColumn]).text().replace(/\s+/g, ' ').trim()
        : '';

    /**
     * Fila de TOTALES al pie de las tablas por equipos:
     * `<tr><td><b>7</b></td><td><b>(2)</b></td></tr>` — 7 tiradores en 2
     * equipos. No lleva `colspan`, así que el filtro anterior no la caza, y
     * sin esto entraba un "inscrito" llamado "7".
     */
    if (/^\d+$/.test(sourceAthleteName) || /^\(\d+\)$/.test(sourceTeam)) return;

    /**
     * Tiradores EXTERNOS. Skermo los agrupa bajo una cabecera
     * "EXTERNAS / EXTERNOS" y les pone detrás del nombre el código de su
     * federación: `DARIA STANCIULESCU | ROU`. Si no se separa, el nombre
     * guardado lleva pegado un " | ROU" y ya no se parece al de nadie.
     *
     * Este es también el motivo de que el número de la cabecera y la lista no
     * cuadren: `(80)` cuenta solo a los españoles y la lista trae 82.
     */
    let sourceClub: string | null = null;
    const externo = sourceAthleteName.match(/^(.*?)\s*\|\s*([A-Za-z]{2,3})$/);
    if (externo && externo[1].trim().length >= 2) {
      sourceAthleteName = externo[1].trim();
      sourceClub = externo[2].toUpperCase();
    }

    // La clave única de la base es (prueba, nombre, equipo): si la fuente
    // repite la pareja, se queda una. Dos filas idénticas no son dos personas.
    const clave = `${sourceAthleteName}|${sourceTeam}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);

    out.push({ sourceAthleteName, sourceTeam, sourceClub });
  });

  return out;
}

function readRows($: cheerio.CheerioAPI): RawRow[] {
  const seen = new Set<string>();
  const rows: RawRow[] = [];

  // Se itera por los enlaces que abren un modal de detalle en vez de por las
  // filas de una tabla concreta: así da igual cuántas tablas haya anidadas.
  $('a[data-target^="#detail"]').each((_, anchor) => {
    const target = $(anchor).attr('data-target') ?? '';
    const match = target.match(/^#detail(\d+)$/);
    if (!match) return;

    const skermoId = match[1];
    if (seen.has(skermoId)) return;
    seen.add(skermoId);

    const name = $(anchor).text().replace(/\s+/g, ' ').trim();
    const general = $(`#general${skermoId}`);
    const location = $(`#location${skermoId}`);
    const registrations = $(`#registrations${skermoId}`);

    const documents: RawRow['documents'] = [];
    general.find('a[href*="/client/"]').each((__, link) => {
      const url = $(link).attr('href');
      if (!url) return;
      const title = $(link).text().replace(/\s+/g, ' ').trim() || 'Documento';
      documents.push({
        title,
        url: url.startsWith('http') ? url : `${SKERMO_BASE_URL}${url}`,
        kind: /convocatoria|informacion|dossier/i.test(title) ? 'convocatoria' : null,
      });
    });

    // El total de inscritos viene entre paréntesis en el <th>.
    const countText = registrations.find('thead th').text();
    const countMatch = countText.match(/\((\d+)\)/);
    const listaInscritos = readRegistrations($, registrations);

    // "Observaciones" es texto libre; se coge lo que haya tras esa cabecera.
    let notes: string | null = null;
    general.find('h4').each((__, h) => {
      if (normalizeLabel($(h).text()).startsWith('OBSERVACIONES')) {
        const parts: string[] = [];
        let node: AnyNode | null = h.nextSibling;
        while (node) {
          if (node.type === 'tag') {
            const tag = (node as Element).tagName?.toLowerCase();
            if (tag === 'h4') break;
            parts.push($(node).text());
          } else if (node.type === 'text') {
            parts.push(node.data ?? '');
          }
          node = node.nextSibling;
        }
        const text = parts.join(' ').replace(/\s+/g, ' ').trim();
        if (text) notes = text;
      }
    });

    rows.push({
      skermoId,
      name,
      general: labelMap($, general),
      location: labelMap($, location),
      documents,
      /**
       * Si la cabecera no trae el número —le pasa a las 18 pruebas por
       * equipos— se cuenta la lista. No es inventar un dato: es contar el que
       * la fuente publica nombre a nombre en la misma pantalla.
       */
      registrationCount: countMatch
        ? Number.parseInt(countMatch[1], 10)
        : listaInscritos.length > 0
          ? listaInscritos.length
          : null,
      registrations: listaInscritos,
      notes,
    });
  });

  return rows;
}

export type SkermoParseOptions = {
  source: 'skermo_rfee' | 'skermo_regional';
  federationCode: string;
  regionalFederation?: string | null;
};

/**
 * Convierte el HTML del calendario en candidatos a evento normalizado.
 *
 * No valida: devuelve objetos tal cual para que `validateEvents` decida qué
 * entra y qué va a cuarentena. Así la validación vive en un solo sitio.
 */
export function parseSkermoCalendar(
  html: string,
  options: SkermoParseOptions,
): { candidates: unknown[]; rowsSeen: number } {
  const $ = cheerio.load(html);
  const rows = readRows($);
  const calendarUrl = skermoCalendarUrl(options.federationCode);

  /** torneo -> evento en construcción */
  const grouped = new Map<
    string,
    {
      event: Omit<NormalizedEvent, 'competitions'> & {
        competitions: NormalizedCompetition[];
      };
    }
  >();

  for (const row of rows) {
    const { general, location } = row;

    const dateRange =
      parseSpanishDateRange(pick(general, 'Fecha')) ??
      // Respaldo: algunas federaciones solo publican una fecha suelta.
      (() => {
        const single = parseSpanishDate(pick(general, 'Fecha'));
        return single ? { startDate: single, endDate: single } : null;
      })();

    // La pestaña "Ubicación" es más precisa cuando existe (solo la publican
    // algunas federaciones); si no, se usa la población del detalle general.
    const populationText =
      pick(location, 'Población') ?? pick(general, 'Población') ?? null;

    /**
     * `assumeCountry: 'ES'` no es una suposición gratuita: el calendario marca
     * explícitamente lo extranjero con el código del país entre paréntesis
     * ("BUDAPEST (HUN)"), así que una población sin marcar es española por la
     * propia convención de la fuente.
     */
    const { city, country } = parseLocation(populationText, { assumeCountry: 'ES' });
    /**
     * El "Tipo" de Skermo mete 105 competiciones bajo la misma etiqueta
     * ("Circuito FIE"). El NOMBRE sí distingue Copa del Mundo de Gran Premio
     * o satélite, así que se afina con él. Si el nombre no dice nada, se
     * queda el Tipo tal cual.
     */
    const circuit = refineCircuitByName(row.name, mapCircuit(pick(general, 'Tipo')));
    const categoryRaw = pick(general, 'Categoría');

    const competition = {
      weapon: mapWeapon(pick(general, 'Arma')),
      gender: mapGender(pick(general, 'Género')),
      category: mapCategory(categoryRaw),
      categoryRaw,
      format: mapFormat(pick(general, 'Modalidad')),
      competitionDate: dateRange?.startDate ?? null,
      installationOpen: pick(general, 'Apertura Instalación'),
      callTime: pick(general, 'LLamada', 'Llamada'),
      scratchTime: pick(general, 'Scratch'),
      startTime: pick(general, 'Hora inicio'),
      registrationCount: row.registrationCount,
      /**
       * La lista nominal. Viene en el mismo HTML, así que no cuesta ni una
       * petición más: 2.176 nombres en la pasada del calendario de la RFEE.
       */
      registrations: row.registrations,
      // Skermo no publica cuotas en ninguna parte: null, no un importe supuesto.
      feeEur: null,
      sourceId: row.skermoId,
      sourceUrl: `${calendarUrl}#detail${row.skermoId}`,
      registrationCloseDate: parseSpanishDate(pick(general, 'Fin inscripciones')),
    };

    if (!dateRange) {
      // Sin fecha no hay nada que calendarizar: se emite como candidato
      // inválido para que quede registrado en cuarentena, no se descarta.
      grouped.set(`invalido-${row.skermoId}`, {
        event: {
          source: options.source,
          sourceId: `skermo-${options.federationCode}-${row.skermoId}`,
          sourceUrl: calendarUrl,
          name: row.name,
          startDate: '',
          endDate: '',
          venue: null,
          venueAddress: null,
          city,
          country,
          timezone: null,
          officialSite: null,
          imageUrl: null,
          circuit,
          scope: 'NACIONAL',
          regionalFederation: options.regionalFederation ?? null,
          sourceModifiedAt: null,
          notes: row.notes,
          documents: row.documents,
          liveLinks: [],
          competitions: [competition as unknown as NormalizedCompetition],
        },
      });
      continue;
    }

    const key = eventKey(row.name, city, dateRange.startDate);
    const existing = grouped.get(key);
    const officialSiteRaw = pick(location, 'Enlace');
    const officialSite = officialSiteRaw?.startsWith('http') ? officialSiteRaw : null;
    const venue = pick(location, 'Lugar');
    const venueAddress = pick(location, 'Dirección');

    if (existing) {
      // Un torneo con varias pruebas: se amplía el rango de fechas al conjunto.
      if (dateRange.startDate < existing.event.startDate) {
        existing.event.startDate = dateRange.startDate;
      }
      if (dateRange.endDate > existing.event.endDate) {
        existing.event.endDate = dateRange.endDate;
      }
      /**
       * Los datos de sede se RELLENAN, no se pisan.
       *
       * La pestaña "Ubicación" la cumplimenta el organizador prueba a prueba,
       * así que dentro del mismo torneo unas filas la traen y otras no. Quedarse
       * con lo que dijera la primera fila significaba tirar el pabellón entero
       * si esa fila no lo tenía. Hoy no pasa en el calendario de la RFEE
       * (comprobado: 0 torneos lo perderían), pero es un accidente de cómo
       * vienen ordenadas las filas, no una garantía de la fuente.
       */
      existing.event.venue ??= venue;
      existing.event.venueAddress ??= venueAddress;
      existing.event.city ??= city;
      existing.event.country ??= country;
      existing.event.timezone ??= timezoneForCountry(country);
      existing.event.officialSite ??= officialSite;
      existing.event.notes ??= row.notes;
      existing.event.competitions.push(competition as unknown as NormalizedCompetition);
      for (const doc of row.documents) {
        if (!existing.event.documents.some((d) => d.url === doc.url)) {
          existing.event.documents.push(doc);
        }
      }
      continue;
    }

    grouped.set(key, {
      event: {
        source: options.source,
        sourceId: `skermo-${options.federationCode}-${key}`,
        sourceUrl: calendarUrl,
        name: row.name,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        venue,
        venueAddress,
        city,
        country,
        timezone: timezoneForCountry(country),
        officialSite,
        // Skermo no publica imágenes de los torneos.
        imageUrl: null,
        circuit,
        scope: inferScope(
          circuit,
          options.source === 'skermo_regional' ? 'AUTONOMICO' : 'NACIONAL',
        ),
        regionalFederation: options.regionalFederation ?? null,
        sourceModifiedAt: parseSpanishDateTime(pick(general, 'Últ. modificación')),
        notes: row.notes,
        documents: row.documents,
        liveLinks: [],
        competitions: [competition as unknown as NormalizedCompetition],
      },
    });
  }

  return {
    candidates: [...grouped.values()].map((g) => g.event),
    rowsSeen: rows.length,
  };
}
