import { puntosPdf, type Celda } from './pdf-celdas';
import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Klasmanlar de la Türkiye Eskrim Federasyonu (`eskrim.org.tr`, robots.txt
 * sin exclusiones para `/resim/`). La página enlaza un PDF por categoría,
 * género y arma de la temporada en curso; el nombre del fichero lo dice todo
 * (`B_E_E.pdf`: Büyükler, Erkek, Epe) y la ruta lleva la temporada y el día de
 * publicación (`Klasmanlar/26 - 27/eylul/29/`). Columnas: `S.NO`, `SOYAD`,
 * `AD`, `KULÜBÜ`, `DOĞUM TARİH` (dd.mm.aaaa), puntos por torneo y total al
 * final. Se leen Büyükler, Gençler, U17 y U14; U10, U12 y veteranos no.
 */

export const TEF_PAGINA = 'https://www.eskrim.org.tr/klasmanlar-20.html';

const CATEGORIAS: Record<string, { categoria: Categoria; raw: string }> = {
  B: { categoria: 'ABS', raw: 'Büyükler' },
  G: { categoria: 'M20', raw: 'Gençler' },
  U17: { categoria: 'M17', raw: 'U17' },
  U14: { categoria: 'M14', raw: 'U14' },
};
const GENEROS: Record<string, Genero> = { E: 'M', K: 'F' };
const ARMAS: Record<string, Arma> = { E: 'ESPADA', F: 'FLORETE', K: 'SABLE' };
const MESES: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
};

export type DocumentoTef = {
  url: string;
  temporada: string;
  /** Día de publicación sacado de la ruta; `null` si la ruta no lo dice. */
  dia: string | null;
  arma: Arma;
  genero: Genero;
  categoria: Categoria;
  categoriaRaw: string;
};

/** Minúsculas sin marcas y con la «ı» sin punto como «i», que NFD no descompone. */
const plano = (s: string) => s.replace(/ı/g, 'i').replace(/İ/g, 'I').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export const archivoTef = (d: DocumentoTef) => `${d.dia ?? 'sin-dia'}-${d.categoriaRaw.replace(/\W+/g, '')}-${d.genero}-${d.arma}.pdf`;

export function documentosTef(html: string): DocumentoTef[] {
  const salida: DocumentoTef[] = [];
  for (const m of html.matchAll(/href="([^"]*\/Klasmanlar\/[^"]+\.pdf)"/gi)) {
    const url = new URL(m[1].replace(/ /g, '%20'), TEF_PAGINA).toString();
    const ruta = decodeURIComponent(new URL(url).pathname);
    const f = /\/(B|G|U17|U14)_(E|K)_(E|F|K)_?\.pdf$/i.exec(ruta);
    const t = /\/Klasmanlar\/(\d{2})\s*-\s*(\d{2})\//i.exec(ruta);
    if (!f || !t || (Number(t[1]) + 1) % 100 !== Number(t[2])) continue;
    const ini = 2000 + Number(t[1]);
    let dia: string | null = null;
    const p = /\/([^/]+)\/(\d{1,2})(?:-[^/]*)?\/[^/]+$/.exec(ruta);
    const mes = p && MESES[plano(p[1])];
    if (p && mes) dia = `${mes >= 8 ? ini : ini + 1}-${String(mes).padStart(2, '0')}-${p[2].padStart(2, '0')}`;
    const c = CATEGORIAS[f[1].toUpperCase()];
    const d: DocumentoTef = {
      url, temporada: `${ini}-${ini + 1}`, dia, arma: ARMAS[f[3].toUpperCase()], genero: GENEROS[f[2].toUpperCase()], categoria: c.categoria, categoriaRaw: c.raw,
    };
    if (!salida.some((x) => x.categoriaRaw === d.categoriaRaw && x.genero === d.genero && x.arma === d.arma)) salida.push(d);
  }
  return salida;
}

const FECHA = /^(\d{2})\.(\d{2})\.((?:19|20)\d\d)$/;
/**
 * «İ» → «I» e «ı» → «i» antes de cambiar de caja: con las reglas turcas «YALGIN»
 * pasaría a «yalgın», y la «ı» no se quita al normalizar el nombre para el vínculo.
 */
const sinPuntoTurco = (s: string) => s.replace(/İ/g, 'I').replace(/ı/g, 'i');
const nombrePropio = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

export function listaTef(d: DocumentoTef, paginas: readonly (readonly Celda[][])[], diaLectura: string): ListaInternacional | null {
  const filas: FilaInternacional[] = [];
  const refs = new Set<string>();
  for (const pagina of paginas) {
    for (const [n, f] of pagina.entries()) {
      if (f.length < 4 || !/^\d+$/.test(f[0].s)) continue;
      const iFecha = f.findIndex((c, i) => i >= 2 && FECHA.test(c.s));
      if (iFecha < 3) continue;
      const apellido = f[1].s.trim();
      const nombre = f[2].s.trim();
      if (!/\p{L}/u.test(apellido) || !/\p{L}/u.test(nombre)) continue;
      const anio = Number(FECHA.exec(f[iFecha].s)![3]);
      // Algunas listas escriben los puntos unos puntos más abajo que el nombre: quedan en la línea siguiente.
      const siguiente = pagina[n + 1];
      const puntosAbajo = f.length - 1 === iFecha && siguiente?.length && siguiente[0].x > f[iFecha].x && siguiente.every((c) => puntosPdf(c.s) !== null);
      const total = f.length - 1 > iFecha ? puntosPdf(f[f.length - 1].s) : puntosAbajo ? puntosPdf(siguiente[siguiente.length - 1].s) : null;
      const puesto = Number(f[0].s);
      const visible = `${sinPuntoTurco(apellido).toUpperCase()} ${nombrePropio(sinPuntoTurco(nombre))}`;
      let ref = `tef:${plano(apellido)}_${plano(nombre)}_${f[iFecha].s}`.replace(/\s+/g, '_');
      if (refs.has(ref)) ref = `${ref}#${puesto}`;
      refs.add(ref);
      filas.push({ ref, nombre: visible, pais: null, puesto: puesto > 0 ? puesto : null, puntos: total, anioNacimiento: anio });
    }
  }
  if (!filas.length) return null;
  return {
    fuente: 'tef_klasman', temporada: d.temporada, arma: d.arma, genero: d.genero, categoria: d.categoria, categoriaRaw: d.categoriaRaw,
    publicadoEl: d.dia ?? diaLectura, baseFecha: d.dia ? 'source' : 'observed', url: d.url, total: filas.length, filas,
  };
}
