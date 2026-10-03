import { distanciaEdicion, fonetico, palabrasNombre, parecidoNombre } from '@/lib/nombres';

export const MAX_CONSULTA_SUGERENCIAS = 80;
export const MAX_SUGERENCIAS = 8;
export const MAX_CANDIDATOS_SUGERENCIAS = 192;

/** Sólo datos deportivos públicos. El parecido NO acredita identidad. */
export type SugerenciaPersona = {
  id: string;
  nombre: string;
  alias: string | null;
  pais: string | null;
  genero: 'M' | 'F' | 'MIXTO' | null;
  anioNacimiento: number | null;
};

export type CandidatoSugerencia = SugerenciaPersona & { nombreComparado: string };

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

export function ordenarSugerencias(q: string, candidatos: readonly CandidatoSugerencia[]): SugerenciaPersona[] {
  const grupos = new Map<string, { candidato: CandidatoSugerencia; puntos: number }>();
  for (const candidato of candidatos.slice(0, MAX_CANDIDATOS_SUGERENCIAS)) {
    const puntos = puntuarSugerencia(q, candidato.nombreComparado);
    if (!puntos || puntos <= (grupos.get(candidato.id)?.puntos ?? 0)) continue;
    grupos.set(candidato.id, { candidato, puntos });
  }
  return [...grupos.values()]
    .sort((a, b) => b.puntos - a.puntos || a.candidato.nombre.localeCompare(b.candidato.nombre, 'es') || a.candidato.id.localeCompare(b.candidato.id))
    .slice(0, MAX_SUGERENCIAS)
    .map(({ candidato: c }) => ({
      id: c.id, nombre: c.nombre, alias: c.alias, pais: c.pais,
      genero: c.genero, anioNacimiento: c.anioNacimiento,
    }));
}
