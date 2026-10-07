import { cacheCompartida } from '@/lib/cache';
import { crearCachesExplorar } from './cache-pantallas';
import { contextoPublico } from './contexto-publico';

/** Edición, cara a cara, catálogo y Buscar vacío con la caché compartida y D1 reales (ver `cache-pantallas.ts`). */
export const {
  cargarEdicionCompartida,
  cargarCaraACaraCompartida,
  cargarCatalogoCompartido,
  cargarBuscarVacioCompartido,
} = crearCachesExplorar({
  cache: cacheCompartida,
  publico: (hoy) => contextoPublico(hoy),
});
