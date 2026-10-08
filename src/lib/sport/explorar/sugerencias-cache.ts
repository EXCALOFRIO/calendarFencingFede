import type { Cacheado, DefinicionCache } from '@/lib/cache/cache';
import type { ParteClave } from '@/lib/cache/claves';
import type { ContextoExplorador } from './contexto';
import { leerSugerenciasPublicas, type SugerenciasPublicas } from './sugerencias';

/**
 * Sugerencias del buscador en la caché compartida, por consulta normalizada
 * y día. Sólo la parte pública (`leerSugerenciasPublicas`): el cargador lee
 * con el contexto público, sin sesión, y la clave son la consulta ya
 * normalizada por `consultaSugerencias` y la fecha. Lo de la cuenta («la
 * sigues», tus seguidas homónimas) lo añade `sugerirPersonas` en la petición.
 *
 * Sin `anteriorMientrasRevalida`: una escritura en `sport_*` cambia la versión
 * y, como hay muchas consultas distintas, guardar además el alias «última» de
 * cada una sería el doble de escrituras en KV para entradas que casi nunca se
 * vuelven a pedir tras la ingesta.
 */

const MINUTO = 60_000;

type Definidor = {
  definir<P extends readonly ParteClave[], T>(def: DefinicionCache<P, T>): Cacheado<P, T>;
};

export function crearSugerenciasCompartidas({
  cache,
  publico,
  frescoMs = 10 * MINUTO,
  caducaMs = 24 * 60 * MINUTO,
}: {
  cache: Definidor;
  publico: (hoy: string) => ContextoExplorador;
  frescoMs?: number;
  caducaMs?: number;
}): (q: string, hoy: string) => Promise<SugerenciasPublicas> {
  return cache.definir({
    espacio: 'sugerencias-personas',
    depende: ['deporte'],
    frescoMs,
    caducaMs,
    anteriorMientrasRevalida: false,
    cargar: (q: string, hoy: string) => leerSugerenciasPublicas(publico(hoy), q),
  });
}
