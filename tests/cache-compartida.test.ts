import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { almacenCacheApi, almacenKv, almacenMemoria, enCascada, type Entrada, type KvLike } from '../src/lib/cache/almacenes';
import { crearCache, type EventoCache } from '../src/lib/cache/cache';
import { claveCache, resumen64 } from '../src/lib/cache/claves';
import { DEPENDENCIAS_POR_FUENTE, SQL_INVALIDAR, dependenciasDeFuente, invalidarCache } from '../src/lib/cache/invalidar';
import { buscarDatoDeCuenta } from '../src/lib/cache/privacidad';
import { deserializar, serializar } from '../src/lib/cache/serializar';
import { crearVersiones, fuenteEpocasD1, versionDe, type Dependencia, type Ejecutar, type Versiones } from '../src/lib/cache/versiones';
import { resolveD1Binding } from '../src/db/d1/runtime';
import type { D1Binding } from '../src/db/d1/binding';

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }));

/** Entorno controlado: reloj manual, épocas manuales y el trabajo en segundo plano a la vista. */
function entorno() {
  let t = 1_000_000;
  const epocas: Record<string, number> = { ledger: 10 };
  const pendientes: Promise<unknown>[] = [];
  const eventos: EventoCache[] = [];
  const memoria = almacenMemoria({ ahora: () => t });
  let versionRota = false;
  const versiones: Versiones = {
    de: async (deps: readonly Dependencia[]) => {
      if (versionRota) throw new Error('D1 caída');
      return versionDe(epocas, deps);
    },
    olvidar: () => {},
  };
  const cache = crearCache({
    almacen: () => memoria,
    versiones,
    esperar: (p) => { pendientes.push(p); },
    ahora: () => t,
    registrar: (e) => eventos.push(e),
  });
  return {
    cache, memoria, epocas, eventos,
    avanzar: (ms: number) => { t += ms; },
    romperVersion: () => { versionRota = true; },
    async drenar() { while (pendientes.length) await pendientes.shift(); },
  };
}

describe('claves de caché', () => {
  it('cambian con el espacio, la versión y cada parámetro, y son estables', () => {
    const a = claveCache('perfil', 'd10.0', ['x', 1, true, null]);
    expect(claveCache('perfil', 'd10.0', ['x', 1, true, null])).toEqual(a);
    expect(claveCache('perfil', 'd11.0', ['x', 1, true, null]).completa).not.toBe(a.completa);
    expect(claveCache('ranking', 'd10.0', ['x', 1, true, null]).completa).not.toBe(a.completa);
    expect(claveCache('perfil', 'd10.0', ['y', 1, true, null]).completa).not.toBe(a.completa);
    // Sin ambigüedad entre tipos: '1' no es 1 ni true.
    expect(new Set([['1'], [1], [true]].map((p) => claveCache('perfil', 'v', p).completa)).size).toBe(3);
  });

  it('acorta las claves largas sin perder la completa, y rechaza lo que no es escalar', () => {
    const larga = claveCache('perfil', 'v1', ['a'.repeat(250), 'b'.repeat(250)]);
    expect(larga.id.length).toBeLessThanOrEqual(400);
    expect(larga.completa.length).toBeGreaterThan(400);
    expect(larga.id).toContain(resumen64(larga.completa));
    expect(() => claveCache('Perfil Raro', 'v', [])).toThrow(RangeError);
    expect(() => claveCache('perfil', 'v', [{} as never])).toThrow(TypeError);
    expect(() => claveCache('perfil', 'v', [Number.NaN])).toThrow(RangeError);
  });
});

describe('serialización', () => {
  it('conserva Map, Set y Date y devuelve objetos nuevos', () => {
    const valor = { m: new Map([['a', { d: new Date(5) }]]), s: new Set([1, 2]), n: null };
    const texto = serializar(valor);
    const vuelta = deserializar<typeof valor>(texto);
    expect(vuelta.m.get('a')?.d).toEqual(new Date(5));
    expect([...vuelta.s]).toEqual([1, 2]);
    expect(deserializar(texto)).not.toBe(vuelta);
  });
});

describe('guarda de datos de cuenta', () => {
  it('encuentra claves de cuenta a cualquier profundidad, también en Map', () => {
    expect(buscarDatoDeCuenta({ a: [{ b: { profileId: 'x' } }] })).toBe('$.a[0].b.profileId');
    expect(buscarDatoDeCuenta({ m: new Map([['seguida', true]]) })).toBe('$.m.seguida');
    expect(buscarDatoDeCuenta({ items: [{ id: 'p', seguida: false }] })).toBe('$.items[0].seguida');
    // `mios` en cara a cara son los tocados de la persona de la ficha, no de la cuenta.
    expect(buscarDatoDeCuenta({ marcador: { mios: 5, rival: 3 } })).toBeNull();
  });
});

describe('caché compartida', () => {
  it('calcula una vez y sirve copias independientes', async () => {
    const e = entorno();
    const cargar = vi.fn(async (id: string) => ({ id, puntos: [1, 2, 3] }));
    const leer = e.cache.definir({ espacio: 'perfil', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    const primera = await leer('p1');
    await e.drenar();
    primera.puntos.push(99); // una petición que modifica su copia
    const segunda = await leer('p1');
    expect(cargar).toHaveBeenCalledTimes(1);
    expect(segunda).toEqual({ id: 'p1', puntos: [1, 2, 3] });
    expect(await leer('p2')).toEqual({ id: 'p2', puntos: [1, 2, 3] });
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  it('nunca mezcla cuentas: el cargador no recibe sesión y lo personal se añade fuera', async () => {
    const e = entorno();
    const cargar = vi.fn(async (...args: unknown[]) => {
      // Sólo recibe los parámetros públicos de la clave.
      expect(args).toEqual(['persona-1']);
      return { nombre: 'ZABALA Juan', resultados: 72 };
    });
    const ficha = e.cache.definir({ espacio: 'ficha', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    const paraCuenta = async (cuenta: { profileId: string; sigue: Set<string> }, persona: string) => ({
      ...(await ficha(persona)),
      siguiendo: cuenta.sigue.has(persona),
    });
    const ana = await paraCuenta({ profileId: 'ana', sigue: new Set(['persona-1']) }, 'persona-1');
    await e.drenar();
    const luis = await paraCuenta({ profileId: 'luis', sigue: new Set() }, 'persona-1');
    expect(ana.siguiendo).toBe(true);
    expect(luis.siguiendo).toBe(false);
    expect(cargar).toHaveBeenCalledTimes(1);
    // Lo guardado no lleva nada de ninguna de las dos cuentas.
    const guardado = await e.memoria.leer(claveCache('ficha', versionDe(e.epocas, ['deporte']), ['persona-1']).id);
    expect(guardado?.v).not.toMatch(/siguiendo|ana|luis|profileId/);
  });

  it('no guarda un valor con datos de cuenta y avisa', async () => {
    const e = entorno();
    const cargar = vi.fn(async () => ({ items: [{ id: 'p', seguida: true }] }));
    const lista = e.cache.definir({ espacio: 'lista', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    await lista();
    await e.drenar();
    await lista();
    expect(cargar).toHaveBeenCalledTimes(2);
    expect(e.eventos).toContainEqual({ tipo: 'privado', espacio: 'lista', ruta: '$.items[0].seguida' });
  });

  it('no guarda null (un cargador que falló) y recalcula la vez siguiente', async () => {
    const e = entorno();
    const cargar = vi.fn(async () => null);
    const leer = e.cache.definir({ espacio: 'nulo', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    await leer();
    await e.drenar();
    await leer();
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  it('un error del cargador no se guarda y se propaga', async () => {
    const e = entorno();
    const cargar = vi.fn().mockRejectedValueOnce(new Error('D1')).mockResolvedValue({ ok: 1 });
    const leer = e.cache.definir({ espacio: 'error', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    await expect(leer()).rejects.toThrow('D1');
    expect(await leer()).toEqual({ ok: 1 });
  });

  it('una sola carga en vuelo por clave', async () => {
    const e = entorno();
    let soltar!: () => void;
    const cargar = vi.fn(() => new Promise<{ n: number }>((r) => { soltar = () => r({ n: 1 }); }));
    const leer = e.cache.definir({ espacio: 'vuelo', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    const varias = Promise.all([leer(), leer(), leer(), leer()]);
    await vi.waitFor(() => expect(cargar).toHaveBeenCalled());
    soltar();
    expect(await varias).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }, { n: 1 }]);
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  it('stale-while-revalidate: pasada la frescura sirve lo viejo y recalcula una vez en segundo plano', async () => {
    const e = entorno();
    let n = 0;
    const cargar = vi.fn(async () => ({ n: ++n }));
    const leer = e.cache.definir({ espacio: 'swr', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    expect(await leer()).toEqual({ n: 1 });
    await e.drenar();
    e.avanzar(1500);
    expect(await Promise.all([leer(), leer()])).toEqual([{ n: 1 }, { n: 1 }]);
    await e.drenar();
    expect(cargar).toHaveBeenCalledTimes(2);
    expect(await leer()).toEqual({ n: 2 });
    e.avanzar(20_000); // más allá de caducaMs: ya no se sirve lo viejo
    expect(await leer()).toEqual({ n: 3 });
  });

  it('invalidar cambia la clave: sirve la anterior mientras recalcula, y luego la nueva', async () => {
    const e = entorno();
    let dato = 'antes';
    const cargar = vi.fn(async () => ({ dato }));
    const leer = e.cache.definir({ espacio: 'inv', depende: ['ranking'], frescoMs: 60_000, caducaMs: 600_000, cargar });
    expect(await leer()).toEqual({ dato: 'antes' });
    await e.drenar();
    dato = 'despues';
    e.epocas.ranking = 1; // lo que hace invalidarCache(['ranking'])
    expect(await leer()).toEqual({ dato: 'antes' });
    await e.drenar();
    expect(await leer()).toEqual({ dato: 'despues' });
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  it('una escritura deportiva (ledger) invalida lo que depende de deporte y no lo demás', async () => {
    const e = entorno();
    const deporte = vi.fn(async () => ({ a: 1 }));
    const calendario = vi.fn(async () => ({ b: 1 }));
    const leerD = e.cache.definir({ espacio: 'dep', depende: ['deporte'], frescoMs: 60_000, caducaMs: 600_000, cargar: deporte, anteriorMientrasRevalida: false });
    const leerC = e.cache.definir({ espacio: 'cal', depende: ['calendario'], frescoMs: 60_000, caducaMs: 600_000, cargar: calendario, anteriorMientrasRevalida: false });
    await leerD(); await leerC(); await e.drenar();
    e.epocas.ledger = 11;
    await leerD(); await leerC(); await e.drenar();
    expect(deporte).toHaveBeenCalledTimes(2);
    expect(calendario).toHaveBeenCalledTimes(1);
  });

  it('sin versión (D1 caída) lee directamente y no guarda', async () => {
    const e = entorno();
    const cargar = vi.fn(async () => ({ x: 1 }));
    const leer = e.cache.definir({ espacio: 'sinver', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    e.romperVersion();
    expect(await leer()).toEqual({ x: 1 });
    expect(await leer()).toEqual({ x: 1 });
    expect(cargar).toHaveBeenCalledTimes(2);
    expect(e.memoria.bytes).toBe(0);
  });

  it('valida la definición al crearla', () => {
    const e = entorno();
    expect(() => e.cache.definir({ espacio: 'Mal', depende: [], frescoMs: 1, caducaMs: 1, cargar: async () => 1 })).toThrow(RangeError);
    expect(() => e.cache.definir({ espacio: 'bien', depende: [], frescoMs: 10, caducaMs: 5, cargar: async () => 1 })).toThrow(RangeError);
  });
});

describe('almacenes', () => {
  const entrada = (k: string, v: string, caduca = 10_000): Entrada => ({ k, v, creado: 0, frescoHasta: 5_000, caduca });

  it('memoria: LRU por bytes y caducidad', async () => {
    let t = 0;
    const m = almacenMemoria({ maxBytes: 100, ahora: () => t });
    await m.escribir('a', entrada('a', 'x'.repeat(20)));
    await m.escribir('b', entrada('b', 'x'.repeat(20)));
    await m.leer('a'); // «a» pasa a ser la más reciente
    await m.escribir('c', entrada('c', 'x'.repeat(20)));
    expect(await m.leer('b')).toBeNull();
    expect(await m.leer('a')).not.toBeNull();
    t = 20_000;
    expect(await m.leer('a')).toBeNull();
  });

  it('cascada: rellena las capas cercanas desde la lejana', async () => {
    const cerca = almacenMemoria({ ahora: () => 0 });
    const lejos = almacenMemoria({ ahora: () => 0 });
    await lejos.escribir('k', entrada('k', '"v"'));
    const c = enCascada([cerca, lejos]);
    expect((await c.leer('k'))?.v).toBe('"v"');
    expect((await cerca.leer('k'))?.v).toBe('"v"');
  });

  it('KV y Cache API: guardan con caducidad y un fallo es «no está»', async () => {
    const datos = new Map<string, { v: string; ttl?: number }>();
    const kv: KvLike = {
      get: async (k) => datos.get(k)?.v ?? null,
      put: async (k, v, o) => { datos.set(k, { v, ttl: o?.expirationTtl }); },
    };
    const a = almacenKv(kv, () => 0);
    await a.escribir('k', entrada('k', '1', 30_000));
    expect(datos.get('k')?.ttl).toBe(60); // mínimo de KV
    expect((await a.leer('k'))?.v).toBe('1');
    const roto = almacenKv({ get: async () => { throw new Error('KV'); }, put: async () => { throw new Error('KV'); } });
    expect(await roto.leer('k')).toBeNull();
    await expect(roto.escribir('k', entrada('k', '1'))).resolves.toBeUndefined();

    const respuestas = new Map<string, Response>();
    const api = almacenCacheApi(async () => ({
      match: async (r) => respuestas.get(String(r))?.clone(),
      put: async (r, res) => { respuestas.set(String(r), res); },
    }), () => 0);
    await api.escribir('perfil/x', entrada('perfil/x', '2', 7_000));
    const guardada = [...respuestas.values()][0];
    expect(guardada.headers.get('cache-control')).toBe('max-age=7');
    expect((await api.leer('perfil/x'))?.v).toBe('2');
  });
});

describe('versiones e invalidación', () => {
  function baseLocal() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec("CREATE TABLE sport_capacity_ledger (key TEXT PRIMARY KEY, accounted_bytes INTEGER NOT NULL, blocked INTEGER NOT NULL); INSERT INTO sport_capacity_ledger VALUES ('global', 500, 0);");
    const ejecutar: Ejecutar = async (texto, params = []) =>
      sqlite.prepare(texto).all(...(params as SQLInputValue[])) as Record<string, unknown>[];
    return { sqlite, ejecutar };
  }

  it('sin la tabla cache_epoch usa el ledger, y con ella las épocas', async () => {
    const { sqlite, ejecutar } = baseLocal();
    let t = 0;
    const fuente = fuenteEpocasD1(ejecutar, () => t);
    expect(await fuente()).toEqual({ ledger: 500 });
    sqlite.exec(readFileSync(new URL('../drizzle-d1/0016_cache_epoca.sql', import.meta.url), 'utf8'));
    await invalidarCache(['ranking', 'calendario'], { ejecutar, ahora: () => 7 });
    await invalidarCache(['ranking'], { ejecutar, ahora: () => 8 });
    // La ausencia de la tabla se recuerda un minuto: no se pregunta en cada lectura.
    expect(await fuente()).toEqual({ ledger: 500 });
    t = 61_000;
    expect(await fuente()).toEqual({ ledger: 500, ranking: 2, calendario: 1 });
    expect(versionDe({ ledger: 500, ranking: 2 }, ['ranking', 'deporte'])).toBe('d500.0-r2');
  });

  it('memoriza las épocas por isolate y olvidar fuerza la relectura', async () => {
    let t = 0;
    let lecturas = 0;
    const v = crearVersiones({ fuente: async () => ({ ledger: ++lecturas }), ttlMs: 30_000, ahora: () => t });
    expect(await v.de(['deporte'])).toBe('d1.0');
    expect(await v.de(['deporte'])).toBe('d1.0');
    t = 31_000;
    expect(await v.de(['deporte'])).toBe('d2.0');
    v.olvidar();
    expect(await v.de(['deporte'])).toBe('d3.0');
  });

  it('el SQL de invalidar sólo admite dependencias conocidas y cada fuente tiene las suyas', async () => {
    const llamadas: unknown[][] = [];
    await invalidarCache(['ranking', 'inventada' as Dependencia], { ejecutar: async (_s, p = []) => { llamadas.push(p); return []; }, ahora: () => 1 });
    expect(llamadas).toEqual([[1, '["ranking"]']]);
    expect(SQL_INVALIDAR).toContain('ON CONFLICT');
    expect(dependenciasDeFuente('skermo_ranking')).toEqual(DEPENDENCIAS_POR_FUENTE.skermo_ranking);
    expect(dependenciasDeFuente('desconocida')).toEqual(['deporte', 'calendario', 'ranking', 'ranking-fie']);
  });
});

describe('D1 Sessions (réplicas de lectura), opcional', () => {
  beforeEach(() => { vi.mocked(getCloudflareContext).mockReset(); });

  it('sin D1_SESIONES usa el binding tal cual; con «replicas», una sesión por petición', () => {
    const sesiones: string[] = [];
    const db = {
      prepare: vi.fn(), batch: vi.fn(),
      withSession: (c: string) => { sesiones.push(c); return { prepare: vi.fn(), batch: vi.fn() } as unknown as D1Binding; },
    };
    const peticion1 = { env: { DB: db } };
    vi.mocked(getCloudflareContext).mockReturnValue(peticion1 as never);
    expect(resolveD1Binding()).toBe(db);

    const conReplicas1 = { env: { DB: db, D1_SESIONES: 'replicas' } };
    const conReplicas2 = { env: { DB: db, D1_SESIONES: 'replicas' } };
    vi.mocked(getCloudflareContext).mockReturnValue(conReplicas1 as never);
    const a = resolveD1Binding();
    expect(resolveD1Binding()).toBe(a);
    vi.mocked(getCloudflareContext).mockReturnValue(conReplicas2 as never);
    expect(resolveD1Binding()).not.toBe(a);
    expect(sesiones).toEqual(['first-unconstrained', 'first-unconstrained']);
  });
});
