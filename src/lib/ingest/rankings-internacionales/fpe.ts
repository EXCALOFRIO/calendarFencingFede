import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Ranking nacional de la Federação Portuguesa de Esgrima (`fpe.pt`,
 * `robots.txt` sólo excluye `/wp-admin/`). La página «Ranking» es un buscador
 * GET (arma, escalão, sexo) que devuelve una entrada «Ranking Nacional
 * Seniores de Espada Masculino 2026/2027» con un PDF enlazado; la entrada se
 * reutiliza y el PDF se sustituye, así que sólo existe la lista vigente.
 *
 * Filas del PDF: «Filipe Frazão CAE 2001 32 20 26 78 ... 184 184 1»: nombre,
 * club en mayúsculas, año de nacimiento, puntos por prueba, total y puesto
 * (el último número es el puesto y el anterior el total). No publica el
 * país: todos cuentan como de Portugal. La temporada es la del título.
 */

export const FPE_PAGINA = 'https://www.fpe.pt/competicao/ranking/';

const ARMAS: readonly { valor: string; arma: Arma; titulo: string }[] = [
  { valor: 'espada', arma: 'ESPADA', titulo: 'Espada' },
  { valor: 'florete', arma: 'FLORETE', titulo: 'Florete' },
  { valor: 'sabre', arma: 'SABLE', titulo: 'Sabre' },
];
const ESCALOES: readonly { valor: string; categoria: Categoria; titulo: string }[] = [
  { valor: 'seniores', categoria: 'ABS', titulo: 'Seniores' },
  { valor: 'juniores', categoria: 'M20', titulo: 'Juniores' },
  { valor: 'cadetes', categoria: 'M17', titulo: 'Cadetes' },
];
const SEXOS: readonly { valor: string; genero: Genero; titulo: string }[] = [
  { valor: 'masculino', genero: 'M', titulo: 'Masculino' },
  { valor: 'feminino', genero: 'F', titulo: 'Feminino' },
];

export type ComboFpe = { arma: (typeof ARMAS)[number]; escalao: (typeof ESCALOES)[number]; sexo: (typeof SEXOS)[number] };

export const COMBOS_FPE: readonly ComboFpe[] = ARMAS.flatMap((arma) => ESCALOES.flatMap((escalao) => SEXOS.map((sexo) => ({ arma, escalao, sexo }))));

export const claveFpe = (c: ComboFpe) => `${c.arma.valor}-${c.escalao.valor}-${c.sexo.valor}`;

/** Campo `unonce` del formulario de búsqueda. */
export const nonceFpe = (html: string) => /name="unonce" value="([0-9a-f]+)"/.exec(html)?.[1] ?? null;

export function urlBusquedaFpe(c: ComboFpe, nonce: string): string {
  const q = new URLSearchParams({ unonce: nonce, uformid: '579', s: 'uwpsfsearchtrg' });
  [c.arma.valor, c.escalao.valor, c.sexo.valor].forEach((term, i) => {
    q.set(`taxo[${i}][name]`, 'category');
    q.set(`taxo[${i}][opt]`, '');
    q.set(`taxo[${i}][term]`, term);
  });
  return `https://www.fpe.pt/?${q.toString()}`;
}

/**
 * Entrada de la búsqueda que corresponde al combo, con la temporada del
 * título. Los títulos no son uniformes («Seniores de Espada Masculino»,
 * «Juniores Sabre Feminino», a veces sólo «Cadetes»): el arma, el sexo y el
 * escalão salen de las categorías de la entrada, que han de ser las tres.
 */
export function entradaFpe(c: ComboFpe, html: string): { url: string; temporada: string } | null {
  const re = new RegExp(`^Ranking Nacional (?:de )?${c.escalao.titulo}\\b.*?(\\d{4})/(\\d{4})$`);
  const encontradas: { url: string; temporada: string }[] = [];
  for (const m of html.matchAll(/<article class="([^"]*)">[\s\S]*?<h2 class="entry-title">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)) {
    const clases = m[1].split(/\s+/);
    if (![c.arma.valor, c.escalao.valor, c.sexo.valor].every((v) => clases.includes(`category-${v}`))) continue;
    const t = re.exec(m[3].replace(/\s+/g, ' ').trim());
    if (t && Number(t[2]) === Number(t[1]) + 1) encontradas.push({ url: m[2], temporada: `${t[1]}-${t[2]}` });
  }
  return encontradas.length === 1 ? encontradas[0] : null;
}

/** PDF enlazado en la entrada. */
export function pdfFpe(html: string): string | null {
  const m = /<article[\s\S]*?href="(https?:\/\/www\.fpe\.pt\/wp-content\/uploads\/[^"]+\.pdf)"/i.exec(html);
  return m ? m[1].replace(/^http:/, 'https:') : null;
}

const FILA = /^(.+?)\s+((?:19|20)\d{2})((?:\s+\d+(?:[.,]\d+)?)+)$/;
const esClub = (p: string) => /^[A-Z0-9ÀÁÂÃÇÉÊÍÓÔÕÚÜ.&'/-]{2,}$/.test(p) && !/[a-zà-ÿ]/.test(p);

/** «Diogo Onofre SPORTING CP 2004 ...» → nombre «Diogo Onofre», año 2004, total y puesto. */
export function filaFpe(linea: string): { nombre: string; anio: number; puntos: string; puesto: number } | null {
  const m = FILA.exec(linea.replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const numeros = m[3].trim().split(' ');
  if (numeros.length < 2) return null;
  const palabras = m[1].split(' ');
  while (palabras.length > 1 && esClub(palabras[palabras.length - 1])) palabras.pop();
  if (palabras.length < 2 || palabras.some((p) => !/\p{Ll}/u.test(p))) return null;
  const puesto = numeros[numeros.length - 1];
  if (!/^\d+$/.test(puesto)) return null;
  return { nombre: palabras.join(' '), anio: Number(m[2]), puntos: String(Number(numeros[numeros.length - 2].replace(',', '.'))), puesto: Number(puesto) };
}

export function listaFpe(c: ComboFpe, temporada: string, texto: string, url: string, dia: string): ListaInternacional | null {
  const filas: FilaInternacional[] = [];
  const refs = new Set<string>();
  for (const linea of texto.split('\n')) {
    const f = filaFpe(linea);
    if (!f) continue;
    let ref = `fpe:${f.nombre}_${f.anio}`.replace(/\s+/g, '_');
    if (refs.has(ref)) ref = `${ref}#${f.puesto}`;
    refs.add(ref);
    filas.push({ ref, nombre: f.nombre, pais: null, puesto: f.puesto, puntos: f.puntos, anioNacimiento: f.anio });
  }
  if (!filas.length) return null;
  return {
    fuente: 'fpe_ranking', temporada, arma: c.arma.arma, genero: c.sexo.genero, categoria: c.escalao.categoria, categoriaRaw: c.escalao.titulo,
    publicadoEl: dia, baseFecha: 'observed', url, total: filas.length, filas,
  };
}
