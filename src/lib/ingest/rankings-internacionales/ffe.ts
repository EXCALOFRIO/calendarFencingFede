import { desescaparXml } from './xlsx';
import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Classement national individuel de la Fédération Française d'Escrime en
 * `ffescrime.fr` (robots.txt vacío). El buscador `/classements/?saison&niveau=N`
 * lista las fichas de una temporada (`saison` = año en que acaba; publica las
 * cinco últimas) y cada ficha `/fiche-classements/<id>/` trae la lista entera
 * en HTML: rango, apellido, nombre, club, puntos y el id de tirador FFE
 * (`data-tir`). Sin fecha de nacimiento ni id FIE: el vínculo es por nombre.
 */

export const FFE_BASE = 'https://www.ffescrime.fr';
export const urlListadoFfe = (saison: number) => `${FFE_BASE}/classements/?categorie=&saison=${saison}&niveau=N`;
export const urlFichaFfe = (id: string) => `${FFE_BASE}/fiche-classements/${id}/`;

const limpiar = (s: string) => desescaparXml(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const ARMA: Record<string, Arma> = { E: 'ESPADA', F: 'FLORETE', S: 'SABLE' };
const CATEGORIA: Record<string, Categoria> = { SENIOR: 'ABS', M20: 'M20', M17: 'M17', M15: 'M15' };

export type FichaFfe = { id: string; titulo: string; arma: Arma; genero: Genero; categoria: Categoria; categoriaRaw: string };

/** Fichas nacionales individuales de las categorías que se cargan (absoluta, M20, M17, M15). */
export function parseListadoFfe(html: string): FichaFfe[] {
  const salida: FichaFfe[] = [];
  for (const m of html.matchAll(/<div class="section__table-row">([\s\S]*?)<\/div><!-- \/\.section__table-row -->/g)) {
    const id = /fiche-classements\/(\d+)/.exec(m[1])?.[1];
    const celdas = [...m[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((c) => limpiar(c[1]));
    if (!id || celdas.length < 5) continue;
    const [titulo, nivel, armaGenero, categoriaRaw, tipo] = celdas;
    if (nivel !== 'National' || tipo !== 'Individuelle' || !/^Classement National Individuel/i.test(titulo)) continue;
    const ag = /^([EFS])\s*\/\s*(Hommes|Femmes)$/.exec(armaGenero);
    const categoria = CATEGORIA[categoriaRaw];
    if (!ag || !categoria) continue;
    salida.push({ id, titulo, arma: ARMA[ag[1]], genero: ag[2] === 'Hommes' ? 'M' : 'F', categoria, categoriaRaw });
  }
  return salida;
}

export type FilaFfe = { tir: string; puesto: number | null; apellido: string; nombre: string; puntos: string | null };

export function parseFichaFfe(html: string): { filas: FilaFfe[]; actualizado: string | null; titulo: string | null } {
  const filas: FilaFfe[] = [];
  for (const m of html.matchAll(/<ul data-cla="\d+" data-tir="(\d+)"[^>]*>([\s\S]*?)<\/ul>/g)) {
    const campos = new Map<string, string>();
    for (const li of m[2].matchAll(/<span class="mobile-libelle-detail-classement">([^<:]+?)\s*:<\/span>([\s\S]*?)<\/li>/g)) {
      campos.set(limpiar(li[1]).toLowerCase(), limpiar(li[2]));
    }
    const puesto = Number(campos.get('rang'));
    const puntos = campos.get('points') ?? '';
    filas.push({
      tir: m[1],
      puesto: Number.isInteger(puesto) && puesto > 0 ? puesto : null,
      apellido: campos.get('nom') ?? '',
      nombre: campos.get('prénom') ?? campos.get('prenom') ?? '',
      puntos: puntos === '' ? null : puntos,
    });
  }
  const f = /Dernière mise à jour le (\d{2})\/(\d{2})\/(\d{4})/.exec(html);
  const titulo = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1];
  return { filas, actualizado: f ? `${f[3]}-${f[2]}-${f[1]}` : null, titulo: titulo ? limpiar(titulo) : null };
}

export function listaFfe(saison: number, ficha: FichaFfe, html: string, hoy: string): ListaInternacional {
  const { filas, actualizado } = parseFichaFfe(html);
  const convertidas: FilaInternacional[] = filas.map((f) => ({
    ref: `ffe:${f.tir}`,
    nombre: `${f.apellido} ${f.nombre}`.trim(),
    // Un extranjero con licencia en Francia figura en la lista: el país del tirador no se publica.
    pais: null,
    puesto: f.puesto,
    puntos: f.puntos,
  }));
  return {
    fuente: 'ffe_classement',
    temporada: `${saison - 1}-${saison}`,
    arma: ficha.arma,
    genero: ficha.genero,
    categoria: ficha.categoria,
    categoriaRaw: ficha.categoriaRaw,
    publicadoEl: actualizado ?? hoy,
    baseFecha: actualizado ? 'source' : 'observed',
    url: urlFichaFfe(ficha.id),
    total: filas.length,
    filas: convertidas,
  };
}
