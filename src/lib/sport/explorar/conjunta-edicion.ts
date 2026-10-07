import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { GENDER_LABEL, WEAPON_LABEL } from '@/lib/utils';
import { filas } from './contexto';
import { listaUuid } from './filtros-sql';
import { categoriaVisible } from './presentacion';
import { detectorConjuntasDe, pruebaConjuntaDe } from './pruebas-conjuntas';

/**
 * Lo que la página de una prueba enseña de su prueba conjunta: desde una parte,
 * el enlace a las poules y el cuadro de la conjunta; desde la conjunta, las
 * clasificaciones oficiales a las que corresponde. Los datos los da
 * `pruebas-conjuntas.ts`; aquí sólo se resuelven edición y rótulo de cada prueba.
 */

export type PruebaEnlazada = { pruebaId: string; edicionId: string; etiqueta: string };

export type VistaConjunta = {
  /** La prueba consultada es la conjunta (si no, es una de las partes). */
  esConjunta: boolean;
  conjunta: PruebaEnlazada;
  /** Clasificaciones oficiales, sin la consultada si es una parte. */
  partes: PruebaEnlazada[];
};

type Ejecutor = Pick<Db, 'execute'>;

type FilaPrueba = {
  id: string;
  edicion: string;
  arma: keyof typeof WEAPON_LABEL;
  genero: keyof typeof GENDER_LABEL;
  categoria: string;
  categoriaRaw: string | null;
  /** Puestos publicados; distingue dos partes con el mismo rótulo. */
  puestos?: number | null;
};

/**
 * El literal de la fuente si es corto («VET40», «+50»). Uno largo del
 * Criterium («2013 21.06.2025 COLMENAR VIEJO») se queda en su año; otro largo,
 * en la categoría de la aplicación.
 */
function rotuloDeFuente(p: Pick<FilaPrueba, 'categoria' | 'categoriaRaw'>): string {
  const raw = p.categoriaRaw?.trim() ?? '';
  if (raw && raw.length <= 12) return raw;
  const anio = /^(\d{4})\b/.exec(raw)?.[1];
  return anio ?? categoriaVisible(p.categoria);
}

/**
 * «Espada masculina V40»: arma y género sólo si las partes no los comparten.
 * Dos partes con el mismo rótulo (la RFEE publica a veces dos listas de la
 * misma franja) se distinguen por sus puestos («VET40 · 7») o, si también
 * coinciden, por su orden.
 */
export function etiquetasDePartes(pruebas: readonly FilaPrueba[]): Map<string, string> {
  const variasArmas = new Set(pruebas.map((p) => p.arma)).size > 1;
  const variosGeneros = new Set(pruebas.map((p) => p.genero)).size > 1;
  const base = new Map<string, string>();
  for (const p of pruebas) {
    const partes = [
      variasArmas ? WEAPON_LABEL[p.arma] : null,
      variosGeneros ? GENDER_LABEL[p.genero] : null,
      rotuloDeFuente(p),
    ].filter(Boolean);
    base.set(p.id, partes.join(' '));
  }
  const salida = new Map<string, string>();
  const porRotulo = new Map<string, FilaPrueba[]>();
  for (const p of pruebas) porRotulo.set(base.get(p.id)!, [...(porRotulo.get(base.get(p.id)!) ?? []), p]);
  for (const [rotulo, grupo] of porRotulo) {
    if (grupo.length === 1) {
      salida.set(grupo[0].id, rotulo);
      continue;
    }
    const conPuestos = new Set(grupo.map((p) => p.puestos ?? null)).size === grupo.length && grupo.every((p) => p.puestos);
    grupo.forEach((p, i) => salida.set(p.id, `${rotulo} · ${conPuestos ? p.puestos : i + 1}`));
  }
  return salida;
}

/** Las partes en orden de rótulo («VET30» antes que «VET40»), con los números en su orden natural. */
export function ordenarPartes<T extends { etiqueta: string }>(partes: readonly T[]): T[] {
  return [...partes].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }));
}

export async function leerConjuntaDePrueba(
  db: Ejecutor,
  pruebaId: string,
  hayTabla: () => Promise<boolean> = detectorConjuntasDe(db),
): Promise<VistaConjunta | null> {
  try {
    const enlace = await pruebaConjuntaDe(db, pruebaId, hayTabla);
    if (!enlace) return null;
    const ids = [enlace.conjuntaId, ...enlace.partes];
    const pruebas = filas<FilaPrueba>(await db.execute(sql`
      SELECT c.id, c.edition_id AS edicion, c.weapon AS arma, c.gender AS genero,
             c.category AS categoria, c.category_raw AS "categoriaRaw",
             (SELECT count(*) FROM sport_result r WHERE r.competition_id = c.id) AS puestos
      FROM sport_competition c WHERE c.id IN (${listaUuid(ids)})`));
    const porId = new Map(pruebas.map((p) => [p.id, p]));
    const conjunta = porId.get(enlace.conjuntaId);
    if (!conjunta) return null;
    const partes = enlace.partes.map((id) => porId.get(id)).filter((p): p is FilaPrueba => Boolean(p));
    const etiquetas = etiquetasDePartes(partes);
    const aEnlace = (p: FilaPrueba, etiqueta: string): PruebaEnlazada => ({ pruebaId: p.id, edicionId: p.edicion, etiqueta });
    const esConjunta = pruebaId === enlace.conjuntaId;
    return {
      esConjunta,
      conjunta: aEnlace(conjunta, categoriaVisible(conjunta.categoria)),
      partes: ordenarPartes(partes.filter((p) => esConjunta || p.id !== pruebaId).map((p) => aEnlace(p, etiquetas.get(p.id) ?? ''))),
    };
  } catch {
    return null;
  }
}
