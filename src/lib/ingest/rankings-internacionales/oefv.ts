import { puntosPdf, type Celda } from './pdf-celdas';
import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Ranglisten del Österreichischer Fechtverband (`oefv.com`, robots.txt sólo
 * excluye `/login/`). El «Ranglisten Archiv» enlaza, por temporada cerrada,
 * un PDF por arma, género y categoría con la lista final: `Rang`,
 * `OEFV-Lizenznummer` (`OEFV` + fecha de nacimiento + orden, partida en dos
 * líneas), `Nachname`, `Vorname`, `Club`, `Punkte` y el desglose por torneo.
 * Se leen Allgemeine Klasse, Junioren y Kadetten; las de Jugend B/C no tienen
 * equivalente en nuestras categorías. Algunas temporadas vienen sin texto
 * (fuentes Type3 o imagen) o con la tabla girada: esas no se leen.
 */

export const OEFV_ARCHIVO = 'https://www.oefv.com/de/intern:13/ranglisten-archiv';

const CATEGORIAS: Record<string, { categoria: Categoria; raw: string }> = {
  'allgemeine klasse': { categoria: 'ABS', raw: 'Allgemeine Klasse' },
  junioren: { categoria: 'M20', raw: 'Junioren' },
  kadetten: { categoria: 'M17', raw: 'Kadetten' },
};
const ARMAS: Record<string, Arma> = { florett: 'FLORETE', degen: 'ESPADA', 'säbel': 'SABLE' };
const GENEROS: Record<string, Genero> = { herren: 'M', damen: 'F' };

export type DocumentoOefv = {
  temporada: string;
  url: string;
  arma: Arma;
  genero: Genero;
  categoria: Categoria;
  categoriaRaw: string;
};

const decodificar = (s: string) =>
  s.replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export const archivoOefv = (d: DocumentoOefv) => `${d.temporada}-${d.categoriaRaw.replace(/\s+/g, '')}-${d.genero}-${d.arma}.pdf`;

/** PDFs del archivo: «Saison 2025/26» → temporada `2025-2026`. */
export function documentosOefv(html: string): DocumentoOefv[] {
  const salida: DocumentoOefv[] = [];
  const secciones = html.split(/<h2[^>]*>/i).slice(1);
  for (const sec of secciones) {
    const t = /^\s*Saison\s+(\d{4})\s*\/\s*(\d{2})\s*</i.exec(sec);
    if (!t) continue;
    const ini = Number(t[1]);
    if ((ini + 1) % 100 !== Number(t[2])) continue;
    const temporada = `${ini}-${ini + 1}`;
    for (const m of sec.matchAll(/<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const etiqueta = decodificar(m[2]).toLowerCase();
      const e = /^(allgemeine klasse|junioren|kadetten) (herren|damen) (florett|degen|säbel)$/.exec(etiqueta);
      if (!e) continue;
      const c = CATEGORIAS[e[1]];
      const d: DocumentoOefv = { temporada, url: new URL(m[1], OEFV_ARCHIVO).toString(), arma: ARMAS[e[3]], genero: GENEROS[e[2]], categoria: c.categoria, categoriaRaw: c.raw };
      if (!salida.some((x) => archivoOefv(x) === archivoOefv(d))) salida.push(d);
    }
  }
  return salida;
}

/**
 * Posición de las cabeceras «Nachname» y «Punkte» en una misma línea. Según la
 * temporada la cabecera junta «OEFV-Lizenznummer Nachname», «Nachname Vorname»
 * o «Vorname Club», y los datos a veces juntan licencia y apellido o nombre y
 * club en un solo trozo; por eso no se separan columnas por posición: se toma
 * todo lo que hay entre el puesto y los puntos y se parte por su forma.
 */
type Columnas = { nachname: number; punkte: number };

function columnas(filas: readonly Celda[][]): Columnas | null {
  for (const f of filas) {
    // En 2010-11 la «N» sale como un carácter de control («\u0010achname»).
    const nachname = f.find((c) => /(?:\bN|[\u0000-\u001f])achname\b/i.test(c.s))?.x;
    const punkte = f.find((c) => /^(Punkte|Gesamt)\b/i.test(c.s))?.x;
    if (nachname !== undefined && punkte !== undefined && nachname < punkte) return { nachname, punkte };
  }
  return null;
}

/** Año de nacimiento de la licencia «OEFV20080720001» (fecha aaaammdd tras «OEFV»). */
export function anioLicenciaOefv(s: string): number | null {
  const m = /^OEFV(\d{4})/.exec(s.replace(/\s+/g, ''));
  if (!m) return null;
  const a = Number(m[1]);
  return a >= 1920 && a <= 2030 ? a : null;
}

/** Siglas de club: mayúsculas y cifras, como «FUM», «AFCS» u «OOELFK». */
const CLUB = /^[A-ZÄÖÜ0-9]{2,8}$/;

/**
 * «OEFV19960602001 Schmidl Paula OOELFK» → licencia, apellido y nombre (el club
 * es la última palabra si son siglas). Si el nombre de pila salta a la línea
 * siguiente queda sólo el apellido y la fila no se lee: un apellido suelto no
 * identifica a nadie.
 */
export function partirFilaOefv(texto: string): { licencia: string | null; apellido: string; nombre: string } | null {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const licencia = palabras[0] && /^OEFV\d+$/.test(palabras[0]) ? palabras.shift()! : null;
  if (palabras.length >= 2 && CLUB.test(palabras[palabras.length - 1])) palabras.pop();
  if (palabras.length < 2 || !palabras.every((p) => /\p{L}/u.test(p))) return null;
  return { licencia, apellido: palabras[0], nombre: palabras.slice(1).join(' ') };
}

export function listaOefv(d: DocumentoOefv, paginas: readonly (readonly Celda[][])[], publicadoEl: string): ListaInternacional | null {
  const cols = columnas(paginas[0] ?? []);
  if (!cols) return null;
  const filas: FilaInternacional[] = [];
  const refs = new Set<string>();
  for (const pagina of paginas) {
    const c = columnas(pagina) ?? cols;
    for (const f of pagina) {
      if (!f.length || !/^\d+$/.test(f[0].s) || f[0].x + 6 >= c.nachname) continue;
      const iPuntos = f.findIndex((x, i) => i > 0 && x.x + 6 >= c.punkte);
      if (iPuntos < 2) continue;
      const partes = partirFilaOefv(f.slice(1, iPuntos).map((x) => x.s).join(' '));
      if (!partes) continue;
      const anio = partes.licencia ? anioLicenciaOefv(partes.licencia) : null;
      const puesto = Number(f[0].s);
      let ref = `oefv:${partes.apellido}_${partes.nombre}${anio ? `_${anio}` : ''}`.replace(/\s+/g, '_');
      if (refs.has(ref)) ref = `${ref}#${puesto}`;
      refs.add(ref);
      filas.push({
        ref, nombre: `${partes.apellido.toUpperCase()} ${partes.nombre}`.trim(), pais: null, puesto: puesto > 0 ? puesto : null,
        puntos: puntosPdf(f[iPuntos].s), anioNacimiento: anio,
      });
    }
  }
  if (!filas.length) return null;
  return {
    fuente: 'oefv_rangliste', temporada: d.temporada, arma: d.arma, genero: d.genero, categoria: d.categoria, categoriaRaw: d.categoriaRaw,
    publicadoEl, baseFecha: 'observed', url: d.url, total: filas.length, filas,
  };
}

