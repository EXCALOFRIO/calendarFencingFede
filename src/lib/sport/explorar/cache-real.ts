import { cacheCompartida } from '@/lib/cache';
import { crearCachesExplorar } from './cache-pantallas';
import { contextoPublico } from './contexto-publico';

/** Edición, cara a cara, catálogo y propuestas para seguir con la caché compartida y D1 reales (ver `cache-pantallas.ts`). */
export const {
  cargarEdicionCompartida,
  cargarCaraACaraCompartida,
  cargarCatalogoCompartido,
  cargarBuscarVacioCompartido,
  fuentesPropuestasCompartidas,
} = crearCachesExplorar({
  cache: cacheCompartida,
  publico: (hoy) => contextoPublico(hoy),
});
