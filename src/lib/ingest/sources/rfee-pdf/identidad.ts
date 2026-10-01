import { compatibles } from './geometria';

/**
 * Identidad DENTRO de un documento. Un PDF de Engarde no publica licencia ni
 * ID: sólo nombre y club, y cada sección los trunca a su ancho de columna. Un
 * texto de poule o de cuadro se atribuye a una fila de la clasificación final
 * sólo si es compatible con UNA; si encaja con varias o con ninguna, queda sin
 * atribuir. Es una referencia local del documento, no una persona: confirmar a
 * qué persona deportiva corresponde sigue exigiendo un ID con ámbito.
 */

export type Participante = { ref: string; nombre: string; club: string | null };

export type Atribucion =
  | { ok: true; ref: string; nombre: string }
  | { ok: false; motivo: 'desconocido' | 'ambiguo' };

export function resolverParticipante(
  registro: readonly Participante[],
  nombre: string,
  club: string | null,
): Atribucion {
  const candidatos = registro.filter(
    (p) =>
      compatibles(nombre, p.nombre) &&
      (!club || !p.club || compatibles(club, p.club, 1)),
  );
  if (candidatos.length === 1) return { ok: true, ref: candidatos[0].ref, nombre: candidatos[0].nombre };
  return { ok: false, motivo: candidatos.length === 0 ? 'desconocido' : 'ambiguo' };
}
