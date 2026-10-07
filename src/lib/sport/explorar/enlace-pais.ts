import { codigoPais } from '@/components/bandera';
import { rutaDuelo, rutaPais } from './pais-url';

/**
 * De lo que guarda la base (ISO de dos letras o código de la FIE) a la ficha
 * del país (`pais-url.ts`). Para las banderas de cualquier pantalla: si no hay
 * un país al que ir, `null` y la bandera se pinta sin enlace.
 */

/** Lo que publica la FIE para quien compite sin bandera nacional: no son países. */
const SIN_PAIS: ReadonlySet<string> = new Set(['FIE', 'AIN', 'IOA', 'ANA', 'RPT', 'EOR', 'IFR']);

/** «es», «ESP» → «ESP»; `null` si no es un país al que se pueda ir. */
export function codigoPaisRuta(pais: string | null | undefined): string | null {
  if (!pais?.trim()) return null;
  const codigo = codigoPais(pais);
  return /^[A-Z]{3}$/.test(codigo) && !SIN_PAIS.has(codigo) ? codigo : null;
}

export function rutaPaisDe(pais: string | null | undefined): string | null {
  const codigo = codigoPaisRuta(pais);
  return codigo ? rutaPais(codigo) : null;
}

/** Un país contra otro; `null` si falta alguno o son el mismo. */
export function rutaPaisContraDe(pais: string | null | undefined, rival: string | null | undefined): string | null {
  const a = codigoPaisRuta(pais);
  const b = codigoPaisRuta(rival);
  return a && b && a !== b ? rutaDuelo(a, b) : null;
}
