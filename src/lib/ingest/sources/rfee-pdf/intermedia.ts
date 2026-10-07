import { compatibles, normalizar, textoFila } from './geometria';
import type { PaginaAnalizada } from './paginas';

/**
 * «Clasificación después de poules» de Engarde: puesto, nombre (truncado) y club, V/M, índice,
 * TD y si el tirador sigue («calificada») o queda eliminado. No es un resultado en sí: sirve para
 * saber qué fila de poule es de qué tirador cuando dos de la clasificación final tienen el mismo
 * nombre truncado y el mismo club (hermanos), porque los totales de la fila de poule la señalan.
 */
export type FilaIntermedia = {
  posicion: number;
  /** Nombre y club tal como se leen, juntos: el PDF los pega cuando el nombre llena su columna. */
  texto: string;
  vm: number;
  ind: number;
  td: number;
  /** `true` eliminado tras las poules, `false` sigue, `null` si no lo dice. */
  eliminado: boolean | null;
};

const RE_FILA = /^(\d{1,4})\s+(.+?)\s+(\d[.,]\d{2,3})\s+([+-]?\d+)\s+(\d+)(?:\s+(.*))?$/;

function estado(resto: string | undefined): boolean | null {
  const t = normalizar(resto ?? '');
  if (/ELIMINAD|ELIMINAT|ELIMINE/.test(t)) return true;
  if (/CALIFICAD|CLASSIFICAD|QUALIFI/.test(t)) return false;
  return null;
}

export function leerClasificacionIntermedia(paginas: readonly PaginaAnalizada[]): FilaIntermedia[] {
  const out: FilaIntermedia[] = [];
  for (const pg of paginas) {
    for (const f of pg.filas) {
      const m = RE_FILA.exec(textoFila(f));
      if (!m) continue;
      out.push({
        posicion: Number(m[1]),
        texto: m[2],
        vm: Number(m[3].replace(',', '.')),
        ind: Number(m[4]),
        td: Number(m[5]),
        eliminado: estado(m[6]),
      });
    }
  }
  return out;
}

/**
 * ¿El nombre es el principio del texto (nombre + club) de la fila intermedia? Con dos palabras al
 * menos: un apellido solo («GARCIA») casa con media clasificación.
 */
export function nombreEnIntermedia(nombre: string, fila: FilaIntermedia): boolean {
  const palabras = fila.texto.trim().split(/\s+/);
  for (let k = palabras.length; k >= 2; k -= 1) {
    if (compatibles(nombre, palabras.slice(0, k).join(' '), 6)) return true;
  }
  return false;
}
