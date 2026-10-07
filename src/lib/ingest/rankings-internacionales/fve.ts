import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Clasificación nacional de la Federación Venezolana de Esgrima
 * (`fencingven.com`, robots.txt sin exclusiones para estas páginas). Una
 * página por categoría con el título «Clasificación Nacional Adulto 2025 -
 * 2026» y una tabla wpDataTables por arma y género («Ranking Adulto Espada
 * Femenina», con el orden de palabras cambiante) cuyas filas vienen ya en el
 * HTML: `Licencia`, `Atleta` («Asis Escalona Lizze Carolina»: apellidos y
 * nombres sin separar), `Entidad`, puntos por torneo, `Total` y `Rank`.
 *
 * La licencia es el número de cédula de identidad: no se guarda; la referencia
 * sale del nombre. No se publica el día de la lista: vale el de lectura.
 * Infantil y pre-cadete no dicen a qué edades corresponden y no se leen.
 */

export const FVE_BASE = 'https://fencingven.com/clasificaciones';

export type PaginaFve = { ruta: string; categoria: Categoria; raw: string };

export const PAGINAS_FVE: readonly PaginaFve[] = [
  { ruta: 'rankin-adulto', categoria: 'ABS', raw: 'Adulto' },
  { ruta: 'rankin-juvenil', categoria: 'M20', raw: 'Juvenil' },
  { ruta: 'rankin-cadete', categoria: 'M17', raw: 'Cadete' },
];

export const urlFve = (p: PaginaFve) => `${FVE_BASE}/${p.ruta}/`;

const texto = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

const plano = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function armaGenero(titulo: string): { arma: Arma; genero: Genero } | null {
  const t = plano(titulo);
  const arma: Arma | null = /\bespada\b/.test(t) ? 'ESPADA' : /\bflorete\b/.test(t) ? 'FLORETE' : /\bsable\b/.test(t) ? 'SABLE' : null;
  const genero: Genero | null = /\bfemenin[oa]\b/.test(t) ? 'F' : /\bmasculin[oa]\b/.test(t) ? 'M' : null;
  return arma && genero ? { arma, genero } : null;
}

export function listasFve(p: PaginaFve, html: string, diaLectura: string): ListaInternacional[] {
  const t = /Clasificaci[oó]n Nacional [^<]*?(\d{4})\s*-\s*(\d{4})/.exec(html);
  if (!t || Number(t[2]) !== Number(t[1]) + 1) return [];
  const temporada = `${t[1]}-${t[2]}`;
  const salida: ListaInternacional[] = [];
  for (const m of html.matchAll(/<h2 class="wpdt-c" id="wdt-table-title-(\d+)">([^<]*)<\/h2>/g)) {
    const ag = armaGenero(texto(m[2]));
    if (!ag) continue;
    const id = m[1];
    const inicio = html.indexOf(`data-wpdatatable_id="${id}"`);
    if (inicio < 0) continue;
    const tabla = html.slice(inicio, html.indexOf('</table>', inicio));
    const cabecera = /<thead>[\s\S]*?<tr>([\s\S]*?)<\/tr>/.exec(tabla);
    if (!cabecera) continue;
    const columnas = [...cabecera[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((c) => plano(texto(c[1])));
    const iAtleta = columnas.indexOf('atleta');
    const iTotal = columnas.indexOf('total');
    const iRank = columnas.indexOf('rank');
    if (iAtleta < 0 || iTotal < 0 || iRank < 0) continue;
    const filas: FilaInternacional[] = [];
    const refs = new Set<string>();
    for (const tr of tabla.matchAll(/<tr id="table_\d+_row_\d+"[^>]*>([\s\S]*?)<\/tr>/g)) {
      const celdas = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => texto(c[1]));
      const nombre = celdas[iAtleta] ?? '';
      if (!/\p{L}/u.test(nombre)) continue;
      const rango = celdas[iRank] ?? '';
      const total = (celdas[iTotal] ?? '').replace(',', '.');
      const puesto = /^\d+$/.test(rango) && Number(rango) > 0 ? Number(rango) : null;
      let ref = `fve:${plano(nombre).replace(/[^a-z0-9]+/g, '_')}`;
      if (refs.has(ref)) ref = `${ref}#${puesto ?? filas.length + 1}`;
      refs.add(ref);
      filas.push({ ref, nombre, pais: null, puesto, puntos: /^\d+(\.\d+)?$/.test(total) ? String(Math.round(Number(total) * 100) / 100) : null });
    }
    if (!filas.length) continue;
    salida.push({
      fuente: 'fve_clasificacion', temporada, arma: ag.arma, genero: ag.genero, categoria: p.categoria, categoriaRaw: p.raw,
      publicadoEl: diaLectura, baseFecha: 'observed', url: urlFve(p), total: filas.length, filas,
    });
  }
  return salida;
}
