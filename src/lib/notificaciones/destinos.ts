import { construirUrlCalendario } from '@/lib/calendario/contexto-url';
import { construirUrlEdicion } from '@/lib/sport/explorar/edicion-url';
import { rutaSeccionPerfil } from '@/lib/sport/explorar/perfil-secciones';
import { esRutaInterna } from './tipos';

/**
 * Adónde lleva cada aviso al tocarlo (en la campana y en el móvil). Siempre
 * a la pantalla exacta de lo que cuenta:
 *
 *  - resultados: la prueba de la edición, con la persona resaltada si el
 *    aviso es de una sola;
 *  - perfil (ranking y estado olímpico): la sección Ranking de esa persona;
 *  - calendario (competición nueva, cierre de inscripción): el calendario en
 *    el mes del torneo, filtrado por su nombre y con su ficha (`evento=`).
 *
 * Puro y sin imports de servidor: lo usan los generadores, la bandeja y las
 * pruebas.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function destinoResultados(p: { edicionId: string; pruebaId: string; personaId?: string | null }): string {
  return construirUrlEdicion(p.edicionId, {
    prueba: p.pruebaId,
    ...(p.personaId ? { persona: p.personaId } : {}),
  });
}

/** Todos los cambios de perfil que se avisan son de ranking o de plaza olímpica: se abre su sección. */
export function destinoPerfil(personaId: string): string {
  return rutaSeccionPerfil(personaId, 'ranking');
}

export function destinoEvento(e: { id: string; name: string; startDate: string }): string {
  const base = construirUrlCalendario({ mes: e.startDate.slice(0, 7), busqueda: e.name });
  if (!UUID_RE.test(e.id)) return base;
  return `${base}${base.includes('?') ? '&' : '?'}evento=${e.id.toLowerCase()}`;
}

/**
 * La dirección de un aviso ya guardado, al día: los avisos de calendario de
 * antes de `evento=` abren el mismo torneo y los de perfil, su sección
 * Ranking. Lo demás (y lo que no sea una ruta interna) se queda como estaba o
 * va a la bandeja.
 */
export function destinoDeAviso(a: { url: string; grupo: string }): string {
  if (!esRutaInterna(a.url)) return '/notificaciones';
  const [tipo, id] = a.grupo.split(':');
  if (tipo === 'evento' && id && UUID_RE.test(id) && (a.url === '/' || a.url.startsWith('/?')) && !/[?&]evento=/.test(a.url)) {
    return `${a.url}${a.url.includes('?') ? '&' : '?'}evento=${id.toLowerCase()}`;
  }
  if (tipo === 'persona' && id && UUID_RE.test(id) && a.url === `/explorar/${id}`) return destinoPerfil(id);
  return a.url;
}
