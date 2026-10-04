import { compatibles } from './geometria';

/**
 * Identidad DENTRO de un documento. Un PDF de Engarde no publica licencia ni
 * ID: sólo nombre y club, y cada sección los trunca a su ancho de columna. Un
 * texto de poule o de cuadro se atribuye a una fila de la clasificación final
 * sólo si es compatible con UNA; si encaja con varias o con ninguna, queda sin
 * atribuir. Es una referencia local del documento, no una persona: confirmar a
 * qué persona deportiva corresponde sigue exigiendo un ID con ámbito.
 */

/** `pais`: código de la columna «Nación»; poules y cuadro pueden mostrar el club o la nación. */
export type Participante = { ref: string; nombre: string; club: string | null; pais?: string | null };

export type Atribucion =
  | { ok: true; ref: string; nombre: string }
  | { ok: false; motivo: 'desconocido' | 'ambiguo' };

const afiliaciones = (p: Participante): string[] => [p.club, p.pais].filter((a): a is string => !!a);

export function resolverParticipante(
  registro: readonly Participante[],
  nombre: string,
  club: string | null,
): Atribucion {
  const candidatos = registro.filter((p) => {
    if (!compatibles(nombre, p.nombre)) return false;
    const propias = afiliaciones(p);
    return !club || propias.length === 0 || propias.some((a) => compatibles(club, a, 1));
  });
  if (candidatos.length === 0 && club === null) {
    const unidos = conClubUnido(registro, nombre);
    if (unidos.length === 1) return { ok: true, ref: unidos[0].ref, nombre: unidos[0].nombre };
    if (unidos.length > 1) return { ok: false, motivo: 'ambiguo' };
  }
  if (candidatos.length === 1) return { ok: true, ref: candidatos[0].ref, nombre: candidatos[0].nombre };
  return { ok: false, motivo: candidatos.length === 0 ? 'desconocido' : 'ambiguo' };
}

/**
 * Cuando el nombre truncado llena su columna, PDF.js entrega nombre y club en
 * un solo texto («APELLIDO APELLIDO NO CLUB ESGR»). Vale la misma prueba que
 * con dos textos: partiendo por algún espacio, la izquierda es compatible con
 * el nombre y la derecha con el club (3 caracteres o más) de UNA sola fila,
 * sumando todos los cortes posibles.
 */
function conClubUnido(registro: readonly Participante[], texto: string): Participante[] {
  const partes = texto.trim().split(/\s+/);
  const encajan = new Set<Participante>();
  for (let k = 1; k < partes.length; k += 1) {
    const nombre = partes.slice(0, k).join(' ');
    const club = partes.slice(k).join(' ');
    for (const p of registro) {
      if (compatibles(nombre, p.nombre) && afiliaciones(p).some((a) => compatibles(club, a, 3))) encajan.add(p);
    }
  }
  return [...encajan];
}
