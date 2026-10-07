import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Ranglista de la Българска федерация по фехтовка (`bulfencing.com`). La
 * página `/sastezania/ranglista.html` incrusta una hoja de Google publicada
 * por arma (`docs.google.com/spreadsheets/d/e/<id>/pubhtml`; robots.txt de
 * docs.google.com permite `/spreadsheet*` y pide `Crawl-delay: 1`). El título
 * de la hoja da arma y temporada («EPEE-(2025-2026)»), cada pestaña es una
 * categoría («мъже», «Кадетки», «U23-жени»...) y se lee en
 * `pubhtml/sheet?headers=false&gid=<gid>`: puesto, `ФАМИЛИЯ`, `ИМЕ`, `КЛУБ`,
 * `Год.` (año de nacimiento) y `Точки`.
 *
 * Los nombres van en cirílico y la base los tiene en latino (FIE): se
 * transliteran con el sistema oficial búlgaro (ley de 2009, el de los
 * pasaportes), y el año de nacimiento acota el vínculo. No se publica el día
 * de la lista: vale el de lectura.
 */

export const BFF_PAGINA = 'https://bulfencing.com/sastezania/ranglista.html';

const PESTANAS: readonly { re: RegExp; genero: Genero; categoria: Categoria; raw: string }[] = [
  { re: /^мъже$/, genero: 'M', categoria: 'ABS', raw: 'мъже' },
  { re: /^жени$/, genero: 'F', categoria: 'ABS', raw: 'жени' },
  { re: /^u23\s*-\s*мъже$/, genero: 'M', categoria: 'M23', raw: 'U23-мъже' },
  { re: /^u23\s*-\s*жени$/, genero: 'F', categoria: 'M23', raw: 'U23-жени' },
  { re: /^младежи$/, genero: 'M', categoria: 'M20', raw: 'Младежи' },
  { re: /^девойки$/, genero: 'F', categoria: 'M20', raw: 'Девойки' },
  { re: /^кадети( u17)?$/, genero: 'M', categoria: 'M17', raw: 'Кадети' },
  { re: /^кадетки( u17)?$/, genero: 'F', categoria: 'M17', raw: 'Кадетки' },
  // Шпага agrupa a los niños hasta 10, 12 y 14 años; сабя y рапира hasta 11, 13 y 15.
  { re: /^момчета (до )?15\b/, genero: 'M', categoria: 'M15', raw: 'Момчета до 15 г.' },
  { re: /^момичета (до )?15\b/, genero: 'F', categoria: 'M15', raw: 'Момичета до 15 г.' },
  { re: /^момчета (до )?14\b/, genero: 'M', categoria: 'M14', raw: 'Момчета до 14 г.' },
  { re: /^момичета (до )?14\b/, genero: 'F', categoria: 'M14', raw: 'Момичета до 14 г.' },
];
const ARMAS: Record<string, Arma> = { EPEE: 'ESPADA', FOIL: 'FLORETE', RAPIRA: 'FLORETE', SABRE: 'SABLE', SABER: 'SABLE' };

export type HojaBff = { id: string; url: string };
export type PestanaBff = { hoja: string; gid: string; url: string; genero: Genero; categoria: Categoria; categoriaRaw: string };

const entidades = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
const texto = (html: string) => entidades(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function hojasBff(html: string): HojaBff[] {
  const salida: HojaBff[] = [];
  for (const m of html.matchAll(/https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/([\w-]+)\/pubhtml/g)) {
    if (!salida.some((h) => h.id === m[1])) salida.push({ id: m[1], url: `https://docs.google.com/spreadsheets/d/e/${m[1]}/pubhtml?widget=true&headers=false` });
  }
  return salida;
}

/** Arma y temporada del título de la hoja («EPEE-(2025-2026) - Google Drive»). */
export function tituloBff(html: string): { arma: Arma; temporada: string } | null {
  const t = /<title>([^<]*)<\/title>/.exec(html);
  const m = t && /\b(EPEE|FOIL|RAPIRA|SABRE|SABER)\b\W*\(?\s*(\d{4})\s*-\s*(\d{4})/i.exec(entidades(t[1]));
  if (!m || Number(m[3]) !== Number(m[2]) + 1) return null;
  return { arma: ARMAS[m[1].toUpperCase()], temporada: `${m[2]}-${m[3]}` };
}

export function pestanasBff(hoja: HojaBff, html: string): PestanaBff[] {
  const salida: PestanaBff[] = [];
  for (const m of html.matchAll(/items\.push\(\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*", gid: "(\d+)"/g)) {
    const nombre = JSON.parse(`"${m[1]}"`) as string;
    const p = PESTANAS.find((x) => x.re.test(nombre.trim().toLowerCase().replace(/\s+/g, ' ')));
    if (!p || salida.some((s) => s.gid === m[2])) continue;
    salida.push({
      hoja: hoja.id, gid: m[2], url: `https://docs.google.com/spreadsheets/d/e/${hoja.id}/pubhtml/sheet?headers=false&gid=${m[2]}`,
      genero: p.genero, categoria: p.categoria, categoriaRaw: p.raw,
    });
  }
  return salida;
}

const LETRAS: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

/** Transliteración oficial búlgara; «-ия» final se escribe «-ia» («Мария» → «Maria»). */
export function latinoBff(s: string): string {
  return s
    .replace(/(\p{L}+)/gu, (palabra) => {
      const minus = palabra.toLowerCase();
      let salida = '';
      for (let i = 0; i < minus.length; i += 1) {
        const c = minus[i];
        if (c === 'и' && minus[i + 1] === 'я' && i + 2 === minus.length) {
          salida += 'ia';
          i += 1;
          continue;
        }
        salida += LETRAS[c] ?? c;
      }
      return palabra === palabra.toUpperCase() && palabra.length > 1 ? salida.toUpperCase() : salida.charAt(0).toUpperCase() + salida.slice(1);
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function listaBff(p: PestanaBff, titulo: { arma: Arma; temporada: string }, html: string, diaLectura: string): ListaInternacional | null {
  const filas: FilaInternacional[] = [];
  const refs = new Set<string>();
  let columnas: { apellido: number; nombre: number; anio: number; puntos: number } | null = null;
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const celdas = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => texto(c[1]));
    if (!columnas) {
      const apellido = celdas.findIndex((c) => c.toUpperCase() === 'ФАМИЛИЯ');
      if (apellido > 0 && celdas[apellido + 1]?.toUpperCase() === 'ИМЕ') {
        columnas = { apellido, nombre: apellido + 1, anio: celdas.findIndex((c) => /^год/i.test(c)), puntos: celdas.findIndex((c) => /^точки$/i.test(c)) };
      }
      continue;
    }
    // El puesto va en una de las columnas anteriores al apellido; en рапира hay una vacía en medio.
    const puestoTxt = celdas.slice(0, columnas.apellido).find((c) => c !== '') ?? '';
    const apellido = celdas[columnas.apellido] ?? '';
    const nombre = celdas[columnas.nombre] ?? '';
    if (!/^\d+$/.test(puestoTxt) || !/\p{L}/u.test(apellido) || !/\p{L}/u.test(nombre)) continue;
    const anioTxt = columnas.anio >= 0 ? celdas[columnas.anio] ?? '' : '';
    const anio = /^(19|20)\d\d$/.test(anioTxt) ? Number(anioTxt) : null;
    const puntosTxt = columnas.puntos >= 0 ? (celdas[columnas.puntos] ?? '').replace(',', '.') : '';
    const visible = `${latinoBff(apellido).toUpperCase()} ${latinoBff(nombre)}`;
    let ref = `bff:${visible.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${anio ?? ''}`;
    if (refs.has(ref)) ref = `${ref}#${puestoTxt}`;
    refs.add(ref);
    filas.push({
      ref, nombre: visible, pais: null, puesto: Number(puestoTxt) > 0 ? Number(puestoTxt) : null,
      puntos: /^\d+(\.\d+)?$/.test(puntosTxt) ? String(Math.round(Number(puntosTxt) * 100) / 100) : null, anioNacimiento: anio,
    });
  }
  if (!filas.length) return null;
  return {
    fuente: 'bff_ranglista', temporada: titulo.temporada, arma: titulo.arma, genero: p.genero, categoria: p.categoria, categoriaRaw: p.categoriaRaw,
    publicadoEl: diaLectura, baseFecha: 'observed', url: BFF_PAGINA, total: filas.length, filas,
  };
}
