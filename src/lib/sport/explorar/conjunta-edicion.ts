import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { GENDER_LABEL, WEAPON_LABEL } from '@/lib/utils';
import { filas } from './contexto';
import { listaUuid } from './filtros-sql';
import { categoriaVisible } from './presentacion';
import { crearDetectorConjuntas, pruebaConjuntaDe } from './pruebas-conjuntas';

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
};

/** «Espada masculina V40»: arma y género sólo si las partes no los comparten. */
export function etiquetasDePartes(pruebas: readonly FilaPrueba[]): Map<string, string> {
  const variasArmas = new Set(pruebas.map((p) => p.arma)).size > 1;
  const variosGeneros = new Set(pruebas.map((p) => p.genero)).size > 1;
  const salida = new Map<string, string>();
  for (const p of pruebas) {
    const partes = [
      variasArmas ? WEAPON_LABEL[p.arma] : null,
      variosGeneros ? GENDER_LABEL[p.genero] : null,
      p.categoriaRaw?.trim() || categoriaVisible(p.categoria),
    ].filter(Boolean);
    salida.set(p.id, partes.join(' '));
  }
  return salida;
}

export async function leerConjuntaDePrueba(
  db: Ejecutor,
  pruebaId: string,
  hayTabla: () => Promise<boolean> = crearDetectorConjuntas(db),
): Promise<VistaConjunta | null> {
  try {
    const enlace = await pruebaConjuntaDe(db, pruebaId, hayTabla);
    if (!enlace) return null;
    const ids = [enlace.conjuntaId, ...enlace.partes];
    const pruebas = filas<FilaPrueba>(await db.execute(sql`
      SELECT c.id, c.edition_id AS edicion, c.weapon AS arma, c.gender AS genero,
             c.category AS categoria, c.category_raw AS "categoriaRaw"
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
      partes: partes.filter((p) => esConjunta || p.id !== pruebaId).map((p) => aEnlace(p, etiquetas.get(p.id) ?? '')),
    };
  } catch {
    return null;
  }
}
