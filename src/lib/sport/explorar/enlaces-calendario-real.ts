import { db } from '@/db';
import { cacheCompartida } from '@/lib/cache';
import { edicionesExplorarDeEvento } from '@/lib/queries/calendario-pasado';
import { esquemaDeportivo } from '@/lib/sport/esquema-db';
import { crearEnlacesCalendario, leerEventoDeEdicion } from './enlaces-calendario';

/** Calendario ↔ resultados con la caché compartida y D1 reales (ver `enlaces-calendario.ts`). */
export const { resultadosDeEvento: resultadosDeEventoCompartido, eventoDeEdicion: eventoDeEdicionCompartido } =
  crearEnlacesCalendario({
    cache: cacheCompartida,
    fuentes: {
      edicionesDeEvento: edicionesExplorarDeEvento,
      eventoDeEdicion: async (edicionId) => ((await esquemaDeportivo()).identidad ? leerEventoDeEdicion(db, edicionId) : null),
    },
  });
