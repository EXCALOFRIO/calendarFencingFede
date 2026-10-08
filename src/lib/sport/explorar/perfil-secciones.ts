import { rutaFicha } from './url';

/**
 * Secciones del perfil de Explorar. Cada una es su propia ruta bajo
 * `/explorar/[personaId]` (Resultados es la raíz): la sección queda en la
 * URL, se puede compartir y sólo se leen sus datos al abrirla.
 *
 * Curiosidades ya no es una sección: es el último bloque de Estadísticas
 * (`#curiosidades`). Su ruta antigua redirige ahí.
 */
export type SeccionPerfil = 'resultados' | 'estadisticas' | 'rivales' | 'ranking';

export const SECCIONES_PERFIL: readonly { clave: SeccionPerfil; rotulo: string }[] = [
  { clave: 'resultados', rotulo: 'Resultados' },
  { clave: 'estadisticas', rotulo: 'Estadísticas' },
  { clave: 'rivales', rotulo: 'Rivales' },
  { clave: 'ranking', rotulo: 'Ranking' },
];

/** Ancla del bloque de curiosidades dentro de Estadísticas. */
export const ANCLA_CURIOSIDADES = 'curiosidades';

/** El segmento de la URL de una sección; Resultados no lleva ninguno. */
export function segmentoSeccion(s: SeccionPerfil): string | null {
  return s === 'resultados' ? null : s;
}

/** Sección a partir del segmento activo (`useSelectedLayoutSegment`); lo desconocido es Resultados. */
export function seccionDeSegmento(segmento: string | null | undefined): SeccionPerfil {
  if (segmento === ANCLA_CURIOSIDADES) return 'estadisticas';
  return SECCIONES_PERFIL.find((s) => s.clave === segmento && s.clave !== 'resultados')?.clave ?? 'resultados';
}

export function rutaSeccionPerfil(personaId: string, s: SeccionPerfil): string {
  const segmento = segmentoSeccion(s);
  return segmento ? `${rutaFicha(personaId)}/${segmento}` : rutaFicha(personaId);
}

/** Donde vive ahora lo que era la sección Curiosidades. */
export function rutaCuriosidades(personaId: string): string {
  return `${rutaSeccionPerfil(personaId, 'estadisticas')}#${ANCLA_CURIOSIDADES}`;
}
