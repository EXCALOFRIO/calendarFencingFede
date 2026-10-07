/**
 * Dónde viven las entradas. Se encadenan de más cerca a más lejos:
 *
 *   1. Memoria del isolate: gratis y sin ida y vuelta; dura lo que el isolate.
 *   2. Cache API (`caches.open`): por centro de datos, gratis. OJO: en
 *      `*.workers.dev` no guarda nada; sólo funciona con dominio propio.
 *   3. KV (binding `CACHE_DATOS`, si existe): global, ~60 s de propagación,
 *      0,50 $ por millón de lecturas y 5 $ por millón de escrituras.
 *
 * Un fallo de cualquier almacén se trata como «no está»: la caché nunca tumba
 * una pantalla, como mucho la hace ir a D1.
 */

export type Entrada = {
  /** Clave completa (ver `claves.ts`): se compara al leer. */
  k: string;
  /** Valor serializado (`serializar.ts`). */
  v: string;
  creado: number;
  /** Hasta aquí se sirve sin revalidar. */
  frescoHasta: number;
  /** Después de esto no se sirve nunca. */
  caduca: number;
};

export interface Almacen {
  readonly nombre: string;
  leer(id: string): Promise<Entrada | null>;
  escribir(id: string, entrada: Entrada): Promise<void>;
}

const esEntrada = (x: unknown): x is Entrada =>
  !!x && typeof x === 'object'
  && typeof (x as Entrada).k === 'string' && typeof (x as Entrada).v === 'string'
  && typeof (x as Entrada).frescoHasta === 'number' && typeof (x as Entrada).caduca === 'number';

/** LRU por bytes. El tamaño se estima como 2 bytes por carácter del valor. */
export function almacenMemoria({ maxBytes = 16 << 20, maxEntrada = 2 << 20, ahora = Date.now } = {}): Almacen & { vaciar(): void; readonly bytes: number } {
  const mapa = new Map<string, Entrada>();
  let bytes = 0;
  const peso = (e: Entrada) => (e.v.length + e.k.length) * 2;
  const quitar = (id: string) => {
    const e = mapa.get(id);
    if (e) { bytes -= peso(e); mapa.delete(id); }
  };
  return {
    nombre: 'memoria',
    get bytes() { return bytes; },
    vaciar() { mapa.clear(); bytes = 0; },
    async leer(id) {
      const e = mapa.get(id);
      if (!e) return null;
      if (e.caduca <= ahora()) { quitar(id); return null; }
      // Al final del Map: lo último usado es lo último en salir.
      mapa.delete(id);
      mapa.set(id, e);
      return e;
    },
    async escribir(id, e) {
      quitar(id);
      if (peso(e) > maxEntrada) return;
      mapa.set(id, e);
      bytes += peso(e);
      for (const viejo of mapa.keys()) {
        if (bytes <= maxBytes) break;
        quitar(viejo);
      }
    },
  };
}

type CacheLike = { match(req: Request | string): Promise<Response | undefined>; put(req: Request | string, res: Response): Promise<void> };
const ORIGEN = 'https://cache.calendario.interno/';

export function almacenCacheApi(abrir: () => Promise<CacheLike | null>, ahora = Date.now): Almacen {
  let cache: Promise<CacheLike | null> | null = null;
  const obtener = () => (cache ??= abrir().catch(() => null));
  return {
    nombre: 'cache-api',
    async leer(id) {
      try {
        const c = await obtener();
        const r = await c?.match(ORIGEN + id);
        if (!r) return null;
        const e: unknown = await r.json();
        return esEntrada(e) && e.caduca > ahora() ? e : null;
      } catch {
        return null;
      }
    },
    async escribir(id, e) {
      try {
        const c = await obtener();
        const segundos = Math.max(1, Math.floor((e.caduca - ahora()) / 1000));
        await c?.put(ORIGEN + id, new Response(JSON.stringify(e), {
          headers: { 'content-type': 'application/json', 'cache-control': `max-age=${segundos}` },
        }));
      } catch {
        /* sin caché: la próxima vez se lee de D1 */
      }
    },
  };
}

export type KvLike = {
  get(clave: string, tipo: 'text'): Promise<string | null>;
  put(clave: string, valor: string, opciones?: { expirationTtl?: number }): Promise<void>;
};

export function almacenKv(kv: KvLike, ahora = Date.now): Almacen {
  return {
    nombre: 'kv',
    async leer(id) {
      try {
        const t = await kv.get(id, 'text');
        if (!t) return null;
        const e: unknown = JSON.parse(t);
        return esEntrada(e) && e.caduca > ahora() ? e : null;
      } catch {
        return null;
      }
    },
    async escribir(id, e) {
      try {
        // KV exige al menos 60 s de caducidad.
        const segundos = Math.max(60, Math.floor((e.caduca - ahora()) / 1000));
        await kv.put(id, JSON.stringify(e), { expirationTtl: segundos });
      } catch {
        /* KV limita a una escritura por segundo y clave: perderla no importa */
      }
    },
  };
}

/** Lee del primero que tenga la entrada y la copia en los anteriores; escribe en todos. */
export function enCascada(almacenes: readonly Almacen[]): Almacen {
  return {
    nombre: almacenes.map((a) => a.nombre).join('>'),
    async leer(id) {
      for (let i = 0; i < almacenes.length; i++) {
        const e = await almacenes[i].leer(id);
        if (e) {
          await Promise.all(almacenes.slice(0, i).map((a) => a.escribir(id, e)));
          return e;
        }
      }
      return null;
    },
    async escribir(id, e) {
      await Promise.all(almacenes.map((a) => a.escribir(id, e)));
    },
  };
}
