import { rutaFicha } from './url';

/**
 * Secciones del perfil de Explorar. Cada una es su propia ruta bajo
 * `/explorar/[personaId]` (Resultados es la raíz): la sección queda en la
 * URL, se puede compartir y sólo se leen sus datos al abrirla.
 */
export type SeccionPerfil = 'resultados' | 'estadisticas' | 'rivales' | 'curiosidades' | 'ranking';

export const SECCIONES_PERFIL: readonly { clave: SeccionPerfil; rotulo: string }[] = [
  { clave: 'resultados', rotulo: 'Resultados' },
  { clave: 'estadisticas', rotulo: 'Estadísticas' },
  { clave: 'rivales', rotulo: 'Rivales' },
  { clave: 'curiosidades', rotulo: 'Curiosidades' },
  { clave: 'ranking', rotulo: 'Ranking' },
];

/** El segmento de la URL de una sección; Resultados no lleva ninguno. */
export function segmentoSeccion(s: SeccionPerfil): string | null {
  return s === 'resultados' ? null : s;
}

/** Sección a partir del segmento activo (`useSelectedLayoutSegment`); lo desconocido es Resultados. */
export function seccionDeSegmento(segmento: string | null | undefined): SeccionPerfil {
  return SECCIONES_PERFIL.find((s) => s.clave === segmento && s.clave !== 'resultados')?.clave ?? 'resultados';
}

export function rutaSeccionPerfil(personaId: string, s: SeccionPerfil): string {
  const segmento = segmentoSeccion(s);
  return segmento ? `${rutaFicha(personaId)}/${segmento}` : rutaFicha(personaId);
}
