import { cacheCompartida } from '@/lib/cache';
import { contextoPublico } from './contexto-publico';
import { crearSugerenciasCompartidas } from './sugerencias-cache';

/** Parte pública de las sugerencias con la caché compartida y D1 reales (ver `sugerencias-cache.ts`). */
export const sugerenciasPublicasCompartidas = crearSugerenciasCompartidas({
  cache: cacheCompartida,
  publico: (hoy) => contextoPublico(hoy),
});
