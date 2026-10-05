import { distanciaEdicion, fonetico, palabrasNombre, parecidoNombre } from '@/lib/nombres';

export const MAX_CONSULTA_SUGERENCIAS = 80;
export const MAX_SUGERENCIAS = 8;
/** Lista del buscador social de Explorar; el desplegable sigue con ocho. */
export const MAX_SUGERENCIAS_SOCIAL = 20;
export const MAX_CANDIDATOS_SUGERENCIAS = 216;

/** Sólo datos deportivos públicos. El parecido NO acredita identidad. */
export type SugerenciaPersona = {
  id: string;
  nombre: string;
  alias: string | null;
  pais: string | null;
  genero: 'M' | 'F' | 'MIXTO' | null;
  anioNacimiento: number | null;
};

/**
 * `peso` (popularidad del grupo según el índice de Explorar: resultados, más
 * los recientes) y `seguida` (la cuenta sigue a la persona) sólo ordenan
 * sugerencias del mismo nivel de parecido: sin índice el peso no llega y el
 * orden dentro del nivel es por nombre.
 */
export type CandidatoSugerencia = SugerenciaPersona & {
  nombreComparado: string;
  peso?: number | null;
  seguida?: number | boolean | null;
};

export function consultaSugerencias(texto: string): string | null {
  if (texto.length > MAX_CONSULTA_SUGERENCIAS) return null;
  const palabras = palabrasNombre(texto);
  if (palabras.length > 8 || !palabras.some((p) => p.length >= 3)) return null;
  return palabras.join(' ');
}

export function puntuarSugerencia(q: string, nombre: string): number {
  const escritas = palabrasNombre(q);
  const publicadas = palabrasNombre(nombre);
  if (!escritas.length || !publicadas.length || nombre.length > 160) return 0;
  const usadas = new Set<number>();
  let total = 0;
  for (const p of escritas) {
    let mejor = 0;
    let indice = -1;
    for (let i = 0; i < publicadas.length; i++) {
      if (usadas.has(i)) continue;
      const n = publicadas[i];
      const fp = fonetico(p);
      const fn = fonetico(n);
      const nota = p === n ? 1
        : p.length >= 3 && n.startsWith(p) ? 0.94
        : p.length >= 4 && fp === fn ? 0.92
        : p.length >= 4 && distanciaEdicion(fp, fn, 1) <= 1 ? 0.75
        : 0;
      if (nota > mejor) { mejor = nota; indice = i; }
    }
    if (!mejor) return parecidoNombre(q, nombre)?.puntos ?? 0;
    usadas.add(indice);
    total += mejor;
  }
  return total / escritas.length;
}

/**
 * Niveles de parecido: 0 = cada palabra es exacta, el inicio de una palabra o
 * suena igual; 1 = alguna errata; 2 = parecido más flojo. Dentro de un nivel
 * manda la popularidad, como en el buscador de una red social: «alejandro»
 * lista a todos los Alejandros del más activo al menos.
 */
export function nivelParecido(puntos: number): 0 | 1 | 2 {
  return puntos >= 0.9 ? 0 : puntos >= 0.7 ? 1 : 2;
}

/**
 * Popularidad dentro del nivel. Una coincidencia exacta de todas las palabras
 * cuenta doble: «lim» pone a los Lim delante de los Lima igual de activos, pero
 * mientras se escribe «carl» un Carl con dos resultados no adelanta a Carlos
 * con cientos.
 */
export function relevanciaSugerencia(peso: number, puntos: number): number {
  return peso * (puntos >= 1 ? 2 : 1);
}

export function ordenarSugerencias(
  q: string,
  candidatos: readonly CandidatoSugerencia[],
  limite: number = MAX_SUGERENCIAS,
): SugerenciaPersona[] {
  const grupos = new Map<string, { candidato: CandidatoSugerencia; puntos: number }>();
  for (const candidato of candidatos.slice(0, MAX_CANDIDATOS_SUGERENCIAS)) {
    const puntos = puntuarSugerencia(q, candidato.nombreComparado);
    if (!puntos || puntos <= (grupos.get(candidato.id)?.puntos ?? 0)) continue;
    grupos.set(candidato.id, { candidato, puntos });
  }
  const clave = (g: { candidato: CandidatoSugerencia; puntos: number }) => ({
    nivel: nivelParecido(g.puntos),
    seguida: g.candidato.seguida ? 1 : 0,
    relevancia: relevanciaSugerencia(Number(g.candidato.peso ?? 0) || 0, g.puntos),
  });
  return [...grupos.values()]
    .map((g) => ({ ...g, orden: clave(g) }))
    .sort((a, b) => a.orden.nivel - b.orden.nivel
      || b.orden.seguida - a.orden.seguida
      || b.orden.relevancia - a.orden.relevancia
      || b.puntos - a.puntos
      || a.candidato.nombre.localeCompare(b.candidato.nombre, 'es') || a.candidato.id.localeCompare(b.candidato.id))
    .slice(0, Math.max(1, Math.min(limite, MAX_SUGERENCIAS_SOCIAL)))
    .map(({ candidato: c }) => ({
      id: c.id, nombre: c.nombre, alias: c.alias, pais: c.pais,
      genero: c.genero, anioNacimiento: c.anioNacimiento,
    }));
}
