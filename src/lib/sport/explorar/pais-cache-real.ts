import { cacheCompartida } from '@/lib/cache';
import { contextoPublico } from './contexto-publico';
import { crearCachesPais } from './pais-cache';

/** Fichas de país con la caché compartida y D1 reales (ver `pais-cache.ts`). */
export const { cargarFichaPaisCompartida, cargarDueloPaisesCompartido } = crearCachesPais({
  cache: cacheCompartida,
  publico: (hoy) => contextoPublico(hoy),
});
