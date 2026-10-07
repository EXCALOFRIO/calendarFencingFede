/**
 * Caché compartida de datos que NO dependen de quién mira: ficha deportiva de
 * una persona, tablas de ranking, pruebas, calendario pasado.
 *
 * Reglas:
 *
 * - El cargador recibe sólo los parámetros de la clave (escalares públicos),
 *   nunca la sesión. Lo personal (favorito, «mis tiradores», «siguiendo») se
 *   lee aparte en la petición y se añade después.
 * - Claves versionadas por las épocas de datos (`versiones.ts`): la ingesta
 *   cambia la versión y la entrada vieja deja de usarse en todas partes.
 * - Stale-while-revalidate: dentro de `frescoMs` se sirve sin más; pasado, se
 *   sirve lo que hay y se recalcula en segundo plano (`waitUntil`). Tras una
 *   ingesta se sirve la última versión conocida mientras se recalcula, así que
 *   una pantalla cacheada nunca espera a D1 salvo la primera vez.
 * - Una sola carga en vuelo por clave e isolate (sin estampidas).
 * - No se guarda `null`/`undefined` (los cargadores devuelven `null` cuando
 *   fallan) ni nada que contenga datos de cuenta (`privacidad.ts`).
 * - Si la caché falla, se lee de D1: nunca tumba una pantalla.
 */
import { claveCache, type Clave, type ParteClave } from './claves';
import type { Almacen, Entrada } from './almacenes';
import { buscarDatoDeCuenta, CLAVES_DE_CUENTA } from './privacidad';
import { deserializar, serializar } from './serializar';
import type { Dependencia, Versiones } from './versiones';

export type EventoCache =
  | { tipo: 'fresca' | 'vieja' | 'anterior' | 'fallo' | 'calculada' | 'sin-version'; espacio: string }
  | { tipo: 'privado'; espacio: string; ruta: string }
  | { tipo: 'error'; espacio: string; fase: 'version' | 'leer' | 'revalidar'; error: unknown };

export type EntornoCache = {
  almacen: () => Almacen;
  versiones: Versiones;
  /** `ctx.waitUntil` de la petición: el trabajo en segundo plano no se corta al responder. */
  esperar: (trabajo: Promise<unknown>) => void;
  ahora?: () => number;
  registrar?: (evento: EventoCache) => void;
};

export type DefinicionCache<P extends readonly ParteClave[], T> = {
  /** Nombre corto y estable (`perfil-rendimiento`, `ranking-fie-tabla`...). Cámbialo si cambia la forma del valor. */
  espacio: string;
  depende: readonly Dependencia[];
  /** Se sirve sin revalidar hasta esta edad. */
  frescoMs: number;
  /** Edad máxima servible (vieja, mientras se revalida). */
  caducaMs: number;
  cargar: (...parametros: P) => Promise<T>;
  /** Por defecto, todo menos `null`/`undefined`. */
  guardarSi?: (valor: T) => boolean;
  /** Tras una ingesta, servir la versión anterior mientras se recalcula (por defecto, sí). */
  anteriorMientrasRevalida?: boolean;
  /** Claves extra prohibidas, o la lista entera si el espacio necesita otra. */
  clavesProhibidas?: readonly string[];
};

export type Cacheado<P extends readonly ParteClave[], T> = ((...parametros: P) => Promise<T>) & {
  readonly espacio: string;
};

export function crearCache(entorno: EntornoCache) {
  const ahora = entorno.ahora ?? Date.now;
  const registrar = entorno.registrar ?? (() => {});
  const enVuelo = new Map<string, Promise<unknown>>();
  // Deduplicar sólo el cálculo no basta: una ráfaga fría hacía N lecturas KV de
  // cada clave antes de llegar al mismo cálculo. No se retienen valores.
  const lecturas = new Map<string, Promise<Entrada | null>>();
  async function leer(almacen: Almacen, id: string): Promise<Entrada | null> {
    let trabajo = lecturas.get(id);
    if (!trabajo) {
      trabajo = almacen.leer(id).catch(() => null);
      lecturas.set(id, trabajo);
    }
    try { return await trabajo; }
    finally { if (lecturas.get(id) === trabajo) lecturas.delete(id); }
  }

  function definir<P extends readonly ParteClave[], T>(def: DefinicionCache<P, T>): Cacheado<P, T> {
    claveCache(def.espacio, 'v', []); // valida el espacio al definir, no en la primera petición
    if (!(def.frescoMs > 0) || !(def.caducaMs >= def.frescoMs)) throw new RangeError('frescoMs > 0 y caducaMs >= frescoMs');
    const guardarSi = def.guardarSi ?? ((v: T) => v !== null && v !== undefined);
    const prohibidas = def.clavesProhibidas ?? CLAVES_DE_CUENTA;

    async function calcular(almacen: Almacen, clave: Clave, alias: Clave, parametros: P): Promise<T> {
      const ya = enVuelo.get(clave.completa) as Promise<T> | undefined;
      if (ya) return ya;
      const trabajo = (async () => {
        const valor = await def.cargar(...parametros);
        if (!guardarSi(valor)) return valor;
        const ruta = buscarDatoDeCuenta(valor, prohibidas);
        if (ruta) {
          registrar({ tipo: 'privado', espacio: def.espacio, ruta });
          return valor;
        }
        const t = ahora();
        const v = serializar(valor);
        const entrada: Entrada = { k: clave.completa, v, creado: t, frescoHasta: t + def.frescoMs, caduca: t + def.caducaMs };
        entorno.esperar(Promise.all([
          almacen.escribir(clave.id, entrada),
          ...(def.anteriorMientrasRevalida === false ? [] : [almacen.escribir(alias.id, { ...entrada, k: alias.completa })]),
        ]));
        registrar({ tipo: 'calculada', espacio: def.espacio });
        return valor;
      })();
      enVuelo.set(clave.completa, trabajo);
      try {
        return await trabajo;
      } finally {
        enVuelo.delete(clave.completa);
      }
    }

    function revalidar(almacen: Almacen, clave: Clave, alias: Clave, parametros: P) {
      if (enVuelo.has(clave.completa)) return;
      entorno.esperar(calcular(almacen, clave, alias, parametros).catch((error) => {
        registrar({ tipo: 'error', espacio: def.espacio, fase: 'revalidar', error });
      }));
    }

    const cacheado = async (...parametros: P): Promise<T> => {
      let version: string;
      try {
        version = await entorno.versiones.de(def.depende);
      } catch (error) {
        // Sin versión no se sabe qué entrada es buena: se lee de D1.
        registrar({ tipo: 'error', espacio: def.espacio, fase: 'version', error });
        registrar({ tipo: 'sin-version', espacio: def.espacio });
        return def.cargar(...parametros);
      }
      const clave = claveCache(def.espacio, version, parametros);
      const alias = claveCache(def.espacio, 'ultima', parametros);
      let almacen: Almacen;
      try {
        almacen = entorno.almacen();
      } catch (error) {
        registrar({ tipo: 'error', espacio: def.espacio, fase: 'leer', error });
        return def.cargar(...parametros);
      }
      const t = ahora();

      const entrada = await leer(almacen, clave.id);
      if (entrada && entrada.k === clave.completa && entrada.caduca > t) {
        const fresca = entrada.frescoHasta > t;
        if (!fresca) revalidar(almacen, clave, alias, parametros);
        registrar({ tipo: fresca ? 'fresca' : 'vieja', espacio: def.espacio });
        return deserializar<T>(entrada.v);
      }

      if (def.anteriorMientrasRevalida !== false) {
        const anterior = await leer(almacen, alias.id);
        if (anterior && anterior.k === alias.completa && anterior.caduca > t) {
          revalidar(almacen, clave, alias, parametros);
          registrar({ tipo: 'anterior', espacio: def.espacio });
          return deserializar<T>(anterior.v);
        }
      }

      registrar({ tipo: 'fallo', espacio: def.espacio });
      return calcular(almacen, clave, alias, parametros);
    };
    return Object.assign(cacheado, { espacio: def.espacio });
  }

  return { definir };
}
