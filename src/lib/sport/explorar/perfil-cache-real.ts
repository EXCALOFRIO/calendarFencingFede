import { cacheCompartida } from '@/lib/cache';
import type { ContextoExplorador } from './contexto';
import { contextoPublico } from './contexto-publico';
import { crearCachesPerfil } from './perfil-cache';
import type { DepsPropietario } from './propietario';

const ERROR_CUENTA = 'PERFIL_PUBLICO_SIN_CUENTA';

async function vetado(): Promise<never> {
  throw new Error(ERROR_CUENTA);
}

/**
 * La ficha pregunta si es la de la cuenta (`resolverPersonaPropia`): aquí no
 * hay cuenta, así que no tiene tiradores y la respuesta es «no». El resto de
 * lo de la cuenta sigue vetado, como en `contextoPublico`.
 */
const SIN_TIRADORES: DepsPropietario = {
  atletasDeCuenta: async () => [],
  personasEnlazadas: vetado,
  fichasFiePorAtleta: vetado,
  evidencia: new Proxy({} as DepsPropietario['evidencia'], { get: () => vetado }),
};

export function contextoPerfilPublico(hoy: string): ContextoExplorador {
  return { ...contextoPublico(hoy), propietario: SIN_TIRADORES };
}

/** Perfil público con la caché compartida y D1 reales (ver `perfil-cache.ts`). */
export const {
  cargarCabeceraPerfil,
  cargarRendimientoCompartido,
  cargarRivalesCompartidos,
  cargarCuriosidadesCompartidas,
  cargarEuropeoCompartido,
} = crearCachesPerfil({ cache: cacheCompartida, publico: contextoPerfilPublico });
