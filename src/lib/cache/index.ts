/**
 * Caché compartida de la aplicación (ver `cache.ts` para las reglas y
 * docs/rendimiento.md para qué se cachea y dónde).
 *
 *   import { cacheCompartida } from '@/lib/cache';
 *   export const tablaFie = cacheCompartida.definir({
 *     espacio: 'ranking-fie-tabla', depende: ['ranking-fie'],
 *     frescoMs: 10 * MINUTO, caducaMs: 7 * DIA,
 *     cargar: (arma: string, genero: string, categoria: string) => leerTablaFiePublica(db, arma, genero, categoria),
 *   });
 *
 * Almacenes: memoria del isolate siempre; Cache API sólo con
 * `CACHE_API_COMPARTIDA=true` (necesita dominio propio: en workers.dev no
 * guarda); KV si existe el binding `CACHE_DATOS`.
 */
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { boundedD1Binding } from '@/db/d1/binding';
import { resolveD1Binding } from '@/db/d1/runtime';
import { almacenCacheApi, almacenKv, almacenMemoria, enCascada, type Almacen, type KvLike } from './almacenes';
import { crearCache } from './cache';
import { dependenciasDeFuente, invalidarCache as invalidarCon } from './invalidar';
import { crearVersiones, fuenteEpocasD1, type Dependencia, type Ejecutar } from './versiones';

export { crearCache, type DefinicionCache, type EntornoCache, type EventoCache } from './cache';
export { claveCache, type ParteClave } from './claves';
export { CLAVES_DE_CUENTA, buscarDatoDeCuenta } from './privacidad';
export { DEPENDENCIAS, type Dependencia } from './versiones';

export const SEGUNDO = 1000;
export const MINUTO = 60 * SEGUNDO;
export const HORA = 60 * MINUTO;
export const DIA = 24 * HORA;

const ejecutar: Ejecutar = async (texto, params = []) =>
  (await boundedD1Binding(resolveD1Binding()).prepare(texto).bind(...params).all<Record<string, unknown>>()).results;

// Estado del isolate: sólo datos públicos, compartidos por diseño entre cuentas.
const memoria = almacenMemoria();
const cacheApi = almacenCacheApi(async () => (typeof caches === 'undefined' ? null : caches.open('datos-compartidos')));
const versiones = crearVersiones({ fuente: fuenteEpocasD1(ejecutar) });

function entornoCf(): Record<string, unknown> {
  try {
    return getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

function almacen(): Almacen {
  const env = entornoCf();
  const capas: Almacen[] = [memoria];
  if (env.CACHE_API_COMPARTIDA === 'true' || process.env.CACHE_API_COMPARTIDA === 'true') capas.push(cacheApi);
  const kv = env.CACHE_DATOS as KvLike | undefined;
  if (kv && typeof kv.get === 'function') capas.push(almacenKv(kv));
  return capas.length === 1 ? memoria : enCascada(capas);
}

function esperar(trabajo: Promise<unknown>) {
  const segura = trabajo.catch(() => {});
  try {
    getCloudflareContext().ctx.waitUntil(segura);
  } catch {
    /* fuera de un Worker (pruebas, scripts): la promesa sigue sola */
  }
}

export const cacheCompartida = crearCache({
  almacen,
  versiones,
  esperar,
  registrar: (e) => {
    if (e.tipo === 'privado') console.error(`[cache] ${e.espacio}: no se guarda, lleva datos de cuenta en ${e.ruta}`);
    else if (e.tipo === 'error') console.error(`[cache] ${e.espacio}: fallo en ${e.fase}`);
  },
});

/** Sube la época de esas dependencias: las entradas dejan de servirse en ≤30 s en todos los isolates. */
export function invalidarCache(deps: readonly Dependencia[]): Promise<void> {
  return invalidarCon(deps, { ejecutar, versiones });
}

/**
 * Para la ingesta automática: llamar al terminar `runIngest(fuente)` (con o
 * sin error: una carga a medias también cambia datos). Nunca lanza.
 */
export async function invalidarTrasIngesta(fuente: string): Promise<void> {
  try {
    await invalidarCache(dependenciasDeFuente(fuente));
  } catch (error) {
    console.error(`[cache] no se pudo invalidar tras ${fuente}:`, error instanceof Error ? error.message : 'desconocido');
  }
}

/**
 * Para las acciones de administración: el cambio ya está guardado y no debe
 * deshacerse ni mostrarse como fallido porque la caché no se pueda invalidar
 * (caduca sola por tiempo). Nunca lanza.
 */
export async function invalidarCacheSinFallar(deps: readonly Dependencia[], motivo: string): Promise<void> {
  try {
    await invalidarCache(deps);
  } catch (error) {
    console.error(`[cache] no se pudo invalidar tras ${motivo}:`, error instanceof Error ? error.name : 'desconocido');
  }
}
