import { cacheCompartida } from '@/lib/cache';
import { hoyMadrid } from '@/lib/callups/fechas';
import { contextoPublico } from '@/lib/sport/explorar/contexto-publico';
import { getEvent, listEvents } from './calendar';
import { crearCachesCalendario } from './calendario-cache-modelo';
import { cargarTramoPasado, edicionesExplorarDeEvento } from './calendario-pasado';
import { cargarPodiosEvento } from './evento-resultados';
import { leerListaUnidaTrasGuarda } from './inscritos-union';

/**
 * Sólo nacional e internacional: el calendario autonómico no es el objeto de
 * esta aplicación (ver la página principal).
 */
export const AMBITOS_CALENDARIO = ['NACIONAL', 'INTERNACIONAL'] as const;

/** Las lecturas del calendario con la caché compartida y D1 reales (ver `calendario-cache-modelo.ts`). */
export const calendarioCompartido = crearCachesCalendario({
  cache: cacheCompartida,
  leer: {
    eventos: () => listEvents({ limit: 500, scope: [...AMBITOS_CALENDARIO] }),
    tramo: (t) => cargarTramoPasado({ ...t, scope: [...AMBITOS_CALENDARIO] }),
    detalle: (eventId) => getEvent(eventId),
    inscritos: (eventId) => leerListaUnidaTrasGuarda([eventId]),
    podios: (eventId) =>
      cargarPodiosEvento(contextoPublico(hoyMadrid()), eventId, async (id) =>
        (await edicionesExplorarDeEvento(id)).map((e) => e.edicionId),
      ),
    hoy: hoyMadrid,
  },
});
