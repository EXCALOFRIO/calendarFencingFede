import { medallaDe, type Medalla } from './presentacion';
import { nivelMedalla, ordenCategoria } from './tipo-competicion';
import type { ResultadoPerfil } from './tipos-perfil';
import type { AmbitoCompeticion, TipoCompeticion } from './tipos-social';

/**
 * La medalla más valiosa de una persona (de todas, o de un ámbito), para
 * destacarla en la tarjeta de cifras. Orden, de más a menos:
 *
 *   1. nivel de la competición: JJOO > Cto. del Mundo > Cto. de Europa >
 *      Copa del Mundo / Gran Premio / Satélite > circuito europeo > resto
 *      internacional > Cto. de España > resto nacional (`nivelMedalla`);
 *   2. categoría: absoluto > sub-23 > júnior > cadete > infantil…;
 *   3. metal: oro > plata > bronce;
 *   4. individual antes que equipos;
 *   5. la más reciente.
 */

export type MedallaPerfil = {
  medalla: Medalla;
  tipo: TipoCompeticion;
  /** «Campeonato de Europa». */
  etiquetaTipo: string;
  ambito: AmbitoCompeticion;
  categoria: string;
  formato: 'INDIVIDUAL' | 'EQUIPOS';
  torneo: string;
  temporada: string;
  fecha: string | null;
  resultadoId: string;
};

const ORDEN_METAL: Record<Medalla, number> = { oro: 0, plata: 1, bronce: 2 };

export function compararMedallas(a: MedallaPerfil, b: MedallaPerfil): number {
  return nivelMedalla(a.tipo) - nivelMedalla(b.tipo)
    || ordenCategoria(a.categoria) - ordenCategoria(b.categoria)
    || ORDEN_METAL[a.medalla] - ORDEN_METAL[b.medalla]
    || (a.formato === b.formato ? 0 : a.formato === 'INDIVIDUAL' ? -1 : 1)
    || (b.fecha ?? '').localeCompare(a.fecha ?? '')
    || a.resultadoId.localeCompare(b.resultadoId);
}

export function medallasDe(items: readonly ResultadoPerfil[], ambito?: AmbitoCompeticion): MedallaPerfil[] {
  const salida: MedallaPerfil[] = [];
  for (const r of items) {
    const medalla = medallaDe(r.puestoFiable);
    if (!medalla || (ambito && r.clasificacion.ambito !== ambito)) continue;
    salida.push({
      medalla,
      tipo: r.clasificacion.tipo,
      etiquetaTipo: r.clasificacion.etiqueta,
      ambito: r.clasificacion.ambito,
      categoria: r.prueba.categoria.codigo,
      formato: r.prueba.formato,
      torneo: r.torneo.nombre,
      temporada: r.temporada,
      fecha: r.fecha,
      resultadoId: r.id,
    });
  }
  return salida.sort(compararMedallas);
}

export function medallaMasValiosa(items: readonly ResultadoPerfil[], ambito?: AmbitoCompeticion): MedallaPerfil | null {
  return medallasDe(items, ambito)[0] ?? null;
}
