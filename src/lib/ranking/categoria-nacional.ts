import { categoriaVisible } from '@/lib/sport/explorar/presentacion';

/**
 * Rótulo de la categoría de una lista del ranking nacional. Los veteranos
 * tienen una lista por tramo de edad («VET40»), así que ahí manda el literal.
 */
export function categoriaRanking(categoria: string, categoriaRaw: string): string {
  const tramo = /^VET\s*(\d{2})$/i.exec(categoriaRaw.trim());
  if (tramo) return `Vet ${tramo[1]}`;
  return categoriaVisible(categoria);
}
