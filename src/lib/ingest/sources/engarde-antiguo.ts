import * as cheerio from 'cheerio';
import type { ARMAS, CATEGORIAS, GENEROS } from '../hechos/formato';

/**
 * Exportaciones HTML estáticas del programa Engarde (2009-2018).
 *
 * Son las páginas que el programa de escritorio genera y que se publican tal
 * cual: en engarde-service.com bajo `/files/{org}/{evt}/{compe}/` (los torneos
 * anteriores a la plataforma actual, cuya página `/competition/...` dice «This
 * competition currently has no data») y en webs de federaciones archivadas en
 * la Wayback Machine. Comprobado el 2026-10-06 con fce/ccatm15florets (2014),
 * cccm/tcc2018, esgrimacyl.es (2013-2016) y fecv.es (2010-2011):
 *  - `menu.html` enlaza los documentos de la prueba (`clasfinal.htm`,
 *    `poulesN.htm`, `tableau_aN.htm`...).
 *  - La clasificación y las poules usan ya `table.liste` y `table.poule`, como
 *    la plataforma actual, pero en ISO-8859-1.
 *  - El cuadro es `table.tableau` sin las clases `tableTitle`/`fencer`/`score`:
 *    la geometría es la misma y aquí se le añaden esas clases.
 *  - Las versiones de 2009-2011 publican la clasificación en una tabla sin
 *    clase, con la cabecera en `td` («Rg», «Nom», «Prénom», «Nation», «Club»)
 *    y el título en párrafos `p.TresGros`.
 *
 * En los torneos migrados del sistema antiguo el índice XML trae `sexe="m"`,
 * `arme="e"` y `date="0000 00 00"` en todas las pruebas (valores por defecto,
 * no publicados): las armas y géneros salen entonces del título.
 */

type Arma = (typeof ARMAS)[number];
type Genero = (typeof GENEROS)[number];
type Categoria = (typeof CATEGORIAS)[number];

// ---------------------------------------------------------------------------
// Codificación
// ---------------------------------------------------------------------------

/** Texto de una página según su charset (cabecera HTTP o `<meta>`); Engarde exporta en ISO-8859-1. */
export function decodificarHtml(bytes: Uint8Array, contentType: string | null = null): string {
  const declarado = (contentType ?? '').match(/charset=([\w-]+)/i)?.[1];
  const cabeza = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
  const meta = cabeza.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  const charset = (meta ?? declarado ?? '').toLowerCase();
  if (/^(iso-8859-1|latin1|windows-1252|cp1252)$/.test(charset)) return new TextDecoder('windows-1252').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// ---------------------------------------------------------------------------
// Documentos de una prueba
// ---------------------------------------------------------------------------

export type TipoDocumento = 'clasificacion' | 'poules' | 'cuadro';

/** Tipo de documento por su nombre de fichero; `null` = lista de tiradores, fórmula, clasificación tras poules… */
export function tipoDocumentoEngarde(fichero: string): TipoDocumento | null {
  const f = decodeURIComponent(fichero).toLowerCase().replace(/\s+/g, '');
  if (!/\.html?$/.test(f)) return null;
  const base = f.replace(/\.html?$/, '');
  if (/^(clasfinal|clasgeneral|classfinal|classementfinal|classement|clasificacion(final|general)?)$/.test(base)) return 'clasificacion';
  if (/^poules?\d{0,2}$/.test(base)) return 'poules';
  if (/^(tableau[\w-]*|tablade\d+|cuadrode\d+|semi-?finales|cuartosdefinal|final)$/.test(base)) return 'cuadro';
  return null;
}

/**
 * Cuadro principal (`tableau_a64.htm`, `tableau16.htm`). Los `tableau_b8`,
 * `tableau_c4`… son cuadros de clasificación de puestos, con rondas que
 * repiten las claves del principal.
 */
export function esCuadroPrincipal(fichero: string): boolean {
  const f = fichero.toLowerCase();
  return !f.startsWith('tableau') || /^tableau(_a)?\d+\.html?$/.test(f);
}

/** Documentos enlazados desde `menu.html`, sin repetir y en el orden publicado. */
export function documentosDelMenu(html: string): { fichero: string; tipo: TipoDocumento }[] {
  const vistos = new Set<string>();
  const out: { fichero: string; tipo: TipoDocumento }[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']?([^"' >]+)/gi)) {
    const fichero = m[1].split(/[?#]/)[0];
    if (fichero.includes('/') || fichero.includes(':')) continue;
    const tipo = tipoDocumentoEngarde(fichero);
    if (!tipo || vistos.has(fichero.toLowerCase())) continue;
    vistos.add(fichero.toLowerCase());
    out.push({ fichero, tipo });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cuadro antiguo
// ---------------------------------------------------------------------------

const MARCADOR = /^\d{1,3}\s*\/\s*\d{1,3}$/;
const limpio = (t: string) => t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Añade al cuadro antiguo las clases del cuadro actual (`tableTitle` en los
 * títulos de ronda de la primera fila, `fencer` en los nombres, `nation` en la
 * columna que sigue a la primera ronda y `score` en los marcadores) para leerlo
 * con `parsearCuadroEngarde`. No toca un cuadro que ya las tiene.
 */
export function normalizarCuadroAntiguo(html: string): string {
  const $ = cheerio.load(html);
  const tablas = $('table.tableau');
  if (tablas.length === 0) return html;
  // «Tabla preliminar de 256» / «Tableau préliminaire de 128»: el lector sólo admite el adjetivo delante.
  const preliminar = /^(tabla|tableau|table)\s+(preliminar|preliminaire|préliminaire|preliminary)\s+(de|of|d)\s+(\d{1,3})$/i;
  const retitular = () =>
    tablas.find('td.tableTitle').each((_, td) => {
      const m = limpio($(td).text()).match(preliminar);
      if (m) $(td).text(`Tabla de ${m[4]}`);
    });
  if (tablas.find('td.tableTitle').length > 0) {
    retitular();
    return $.html();
  }
  tablas.each((_, t) => {
    const filas = $(t).children('tbody').length ? $(t).children('tbody').children('tr') : $(t).children('tr');
    const cabecera = filas.first().children('td');
    let primera = -1;
    cabecera.each((i, td) => {
      if (limpio($(td).text()) === '') return;
      $(td).addClass('tableTitle');
      if (primera < 0) primera = i;
    });
    filas.slice(1).each((_, tr) => {
      $(tr)
        .children('td')
        .each((i, td) => {
          const c = $(td);
          const texto = limpio(c.text());
          if (texto === '') return;
          if (MARCADOR.test(texto)) c.addClass('score');
          else if (i === primera + 1) c.addClass('nation');
          else if (i >= primera && (c.hasClass('HBD') || c.attr('bgcolor'))) c.addClass('fencer');
        });
    });
  });
  retitular();
  return $.html();
}

// ---------------------------------------------------------------------------
// Clasificación antigua
// ---------------------------------------------------------------------------

const CABECERA_PUESTO = /^(rg|cl\.?|clas\.?|class\.?|pos\.?|puesto|rang|rank)$/i;

/**
 * Convierte la clasificación de las exportaciones antiguas a la forma actual
 * (`h1` con título y líneas en `small`, `h3` con el encabezado y `table.liste`
 * con cabecera en `th`). La cabecera catalana «Cognom/Nom» se renombra a
 * «Apellido/Nombre», porque «Nom» es el nombre de pila sólo cuando le precede
 * «Cognom» (en francés «Nom» es el apellido). Devuelve el HTML sin cambios si
 * ya tiene la forma actual o si no hay ninguna tabla con cabecera de puesto.
 */
export function normalizarClasificacionAntigua(html: string): string {
  const $ = cheerio.load(html);
  const liste = $('table.liste').first();
  if (liste.length > 0) {
    const ths = liste.find('th');
    const textos = ths.map((_, th) => limpio($(th).text()).toLowerCase()).get();
    const iCognom = textos.findIndex((t) => /^cognoms?$/.test(t));
    if (iCognom < 0) return html;
    ths.each((i, th) => {
      if (i === iCognom) $(th).text('Apellido');
      else if (i > iCognom && textos[i] === 'nom') $(th).text('Nombre');
    });
    return $.html();
  }
  const tabla = $('table')
    .filter((_, t) => {
      const primera = $(t).find('tr').first().children('td,th');
      return primera.length >= 2 && CABECERA_PUESTO.test(limpio(primera.first().text()));
    })
    .first();
  if (tabla.length === 0) return html;
  const titulos = $('p.TresGros, p.tresgros')
    .map((_, p) => limpio($(p).text()))
    .get()
    .filter(Boolean);
  const encabezado =
    $('p.gros, p.Gros')
      .map((_, p) => limpio($(p).text()))
      .get()
      .find(Boolean) ?? limpio($('title').text());
  const filas = tabla.find('tr').toArray();
  const cabecera = $(filas[0])
    .children('td,th')
    .map((_, c) => limpio($(c).text()))
    .get();
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const iCognom = cabecera.findIndex((t) => /^cognoms?$/i.test(t));
  const th = cabecera
    .map((t, i) => (i === iCognom ? 'Apellido' : iCognom >= 0 && i > iCognom && /^nom$/i.test(t) ? 'Nombre' : t))
    .map((t) => `<th>${esc(t)}</th>`);
  const cuerpo = filas
    .slice(1)
    .map((tr) => `<tr>${$(tr).children('td').toArray().map((td) => `<td>${$(td).html() ?? ''}</td>`).join('')}</tr>`)
    .join('\n');
  const [primero, ...resto] = titulos.length ? titulos : [limpio($('title').text())];
  return `<html><body><h1>${esc(primero ?? '')}<br><small>${resto.map(esc).join('<br>')}</small></h1>
<h3>${esc(encabezado)}</h3>
<table class="liste"><tr>${th.join('')}</tr>
${cuerpo}</table></body></html>`;
}

/** Título y líneas de la cabecera de un documento (`<title>`, `h1` y sus `small`, o `p.TresGros`). */
export function cabeceraDocumento(html: string): { titulo: string | null; lineas: string[] } {
  const $ = cheerio.load(html);
  const h1 = $('h1').first();
  if (h1.length > 0) {
    const partes = (h1.html() ?? '')
      .split(/<br\s*\/?>/i)
      .map((l) => limpio(cheerio.load(`<div>${l}</div>`)('div').text()))
      .filter(Boolean);
    return { titulo: partes[0] ?? (limpio($('title').text()) || null), lineas: partes.slice(1) };
  }
  const ps = $('p.TresGros, p.tresgros')
    .map((_, p) => limpio($(p).text()))
    .get()
    .filter(Boolean);
  if (ps.length > 0) return { titulo: ps[0], lineas: ps.slice(1) };
  return { titulo: limpio($('title').text()) || null, lineas: [] };
}

// ---------------------------------------------------------------------------
// Atributos a partir de títulos (castellano, catalán, valenciano, francés, inglés)
// ---------------------------------------------------------------------------

function plano(t: string): string {
  return t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[_]/g, ' ');
}

function unica<T>(halladas: (T | null)[]): T | null {
  const s = new Set(halladas.filter((x): x is T => x !== null));
  return s.size === 1 ? [...s][0] : null;
}

const ARMAS_TITULO: [RegExp, Arma][] = [
  [/\b(florete?s?|floret|fleurets?|foil)\b/, 'FLORETE'],
  [/\b(espadas?|espases|espasa|epees?)\b/, 'ESPADA'],
  [/\b(sables?|sabre)\b/, 'SABLE'],
];

/** Arma que nombra un título; `null` si no nombra ninguna o nombra varias. */
export function armaDeTitulo(titulo: string): Arma | null {
  const t = plano(titulo);
  return unica(ARMAS_TITULO.map(([re, a]) => (re.test(t) ? a : null)));
}

/** Género que nombra un título; `null` si no nombra ninguno o nombra los dos sin decir «mixto». */
export function generoDeTitulo(titulo: string): Genero | null {
  const t = plano(titulo);
  if (/\b(mixt[oae]?s?|mixed)\b/.test(t)) return 'MIXTO';
  const f = /\b(femenin[oa]s?|femeni|femenines|feminin[oe]?s?|femmes?|dames|women|ladies|fem|chicas|noies|dones)\b/.test(t);
  // «Mas» sólo cuenta pegado al arma («Epee mas cadet»): suelto es un adverbio.
  const m =
    /\b(masculin[oa]s?|masculi|masculins|masculines|hommes?|homes|hombres|men|masc|chicos|nois)\b/.test(t) ||
    /\b(epee|espada|espasa|sabre|sable|fleurete?|florete?|floret)\s+mas\b/.test(t);
  return f === m ? null : f ? 'F' : 'M';
}

const CATEGORIAS_TITULO: [RegExp, Categoria][] = [
  [/\b(veteran[oa]?s?|veterans?|vet)\b|(^|\s)\+\s?\d{2}\b/, 'VET'],
  [/\b(absolut[oa]?s?|absolute|senior|seniors|abs)\b/, 'ABS'],
  [/\b(sub|m|u)\s?-?\s?23\b/, 'M23'],
  [/\b(junior|juniors|juveniles?)\b|\b(sub|m|u)\s?-?\s?20\b/, 'M20'],
  [/\b(cadet[ea]?s?)\b|\b(sub|m|u)\s?-?\s?17\b/, 'M17'],
  [/\b(infantil(es)?|minimes?)\b|\b(sub|m|u)\s?-?\s?15\b/, 'M15'],
  [/\b(sub|m|u)\s?-?\s?14\b/, 'M14'],
  [/\b(alevin(es)?|benjamin(es)?)\b|\b(sub|m|u)\s?-?\s?13\b/, 'M13'],
  [/\b(sub|m|u)\s?-?\s?12\b/, 'M12'],
  [/\b(sub|m|u)\s?-?\s?11\b/, 'M11'],
  [/\b(sub|m|u)\s?-?\s?10\b/, 'M10'],
  [/\b(sub|m|u)\s?-?\s?9\b/, 'M9'],
  [/\b(sub|m|u)\s?-?\s?7\b/, 'M7'],
];

/** Categorías que nombra un título (todas). «M-17-20» y «M15-17» nombran las dos. */
export function categoriasDeTitulo(titulo: string): Categoria[] {
  const t = plano(titulo).replace(
    /\b(?:m|sub|u)\s?-?\s?(\d{1,2})((?:[-/](?:m|sub|u)?-?\d{1,2}\b)+)/g,
    (_, n: string, resto: string) => [n, ...(resto.match(/\d{1,2}/g) ?? [])].map((x) => `m${x}`).join(' '),
  );
  return CATEGORIAS_TITULO.filter(([re]) => re.test(t)).map(([, c]) => c);
}

/** Torneos de prueba o de cursos de árbitros y directores técnicos («CURS DE DT», «dt»): no son competiciones. */
export function esTorneoDePrueba(titulo: string): boolean {
  return /^(dt\d*|tests?)$|\b(curs|curso|cursos|simulacro|demo|tests?)\b/.test(plano(titulo).trim());
}

/** Categoría del `<categorie>` del índice o de un código suelto («m15», «M-20», «Absolut», «Veterans»). */
export function categoriaDeCodigo(raw: string | null | undefined): Categoria | null {
  if (!raw || !raw.trim()) return null;
  const halladas = categoriasDeTitulo(raw);
  if (halladas.length === 1) return halladas[0];
  const t = plano(raw).replace(/[\s.-]/g, '');
  if (t === 'j') return 'M20';
  if (t === 'c') return 'M17';
  if (t === 's') return 'ABS';
  if (t === 'v') return 'VET';
  return null;
}

/** El título dice que es por equipos. */
export function esEquiposDeTitulo(titulo: string): boolean {
  return /\b(equip(o|os|s|es)?|teams?|par equipes)\b/.test(plano(titulo));
}

// ---------------------------------------------------------------------------
// Fechas en títulos y en nombres de carpeta
// ---------------------------------------------------------------------------

function iso(a: number, m: number, d: number): string | null {
  if (a < 100) a += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2000 || a > 2100) return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}

/**
 * Primer día que publica el título de un torneo («2015.02.22 Lliga…»,
 * «27 -28/09/2014 TNR…», «10-11/01/2015…», «17.01.2015…»,
 * «2014.04.12/13 Campionat…»). `null` si no trae una fecha completa.
 */
export function fechaDeTituloTorneo(titulo: string): string | null {
  const t = titulo.replace(/\s+/g, ' ');
  let m = t.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/\b(\d{1,2})\s?-\s?\d{1,2}\s?[./]\s?(\d{1,2})\s?[./]\s?(20\d{2})\b/);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = t.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** El índice de Engarde publica «0000 00 00» (o nada) cuando no tiene fecha; la lista de torneos, «2012-01-01». */
export function esFechaFicticiaEngarde(f: string | null | undefined): boolean {
  return !f || /^0000/.test(f.trim()) || f.trim() === '2012-01-01';
}
