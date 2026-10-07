import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { almacenKv, almacenMemoria, enCascada, type Almacen, type Entrada, type KvLike } from '../src/lib/cache/almacenes';
import { crearCache, type EventoCache } from '../src/lib/cache/cache';
import { claveCache } from '../src/lib/cache/claves';
import { invalidarCache } from '../src/lib/cache/invalidar';
import { buscarDatoDeCuenta, CLAVES_DE_CUENTA } from '../src/lib/cache/privacidad';
import { deserializar, serializar } from '../src/lib/cache/serializar';
import { crearVersiones, fuenteEpocasD1, versionDe, type Dependencia, type Ejecutar, type Versiones } from '../src/lib/cache/versiones';
import type { D1Binding } from '../src/db/d1/binding';

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }));
const d1 = vi.hoisted(() => ({ binding: null as unknown }));
vi.mock('@/db/d1/runtime', () => ({ resolveD1Binding: () => d1.binding }));

/** Reloj, épocas y trabajo en segundo plano bajo control del test. */
function entorno(opciones: { almacen?: () => Almacen } = {}) {
  let t = 5_000_000;
  const epocas: Record<string, number> = { ledger: 100 };
  const pendientes: Promise<unknown>[] = [];
  const eventos: EventoCache[] = [];
  const memoria = almacenMemoria({ ahora: () => t });
  const versiones: Versiones = { de: async (deps: readonly Dependencia[]) => versionDe(epocas, deps), olvidar: () => {} };
  const cache = crearCache({
    almacen: opciones.almacen ?? (() => memoria),
    versiones,
    esperar: (p) => { pendientes.push(p); },
    ahora: () => t,
    registrar: (e) => eventos.push(e),
  });
  return {
    cache, memoria, epocas, eventos, pendientes,
    avanzar: (ms: number) => { t += ms; },
    drenar: async () => { while (pendientes.length) await pendientes.shift(); },
    tipos: () => eventos.map((e) => e.tipo),
  };
}

/** Promesa que el test resuelve cuando quiere: simula una consulta a D1 lenta. */
function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => { resolver = res; rechazar = rej; });
  return { promesa, resolver, rechazar };
}

describe('caché compartida: estampida', () => {
  it('cien peticiones simultáneas a la misma clave hacen UNA carga y reciben copias independientes', async () => {
    const e = entorno();
    const lenta = diferida<{ lista: number[] }>();
    const cargar = vi.fn(() => lenta.promesa);
    const leer = e.cache.definir({ espacio: 'estampida', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    const peticiones = Array.from({ length: 100 }, () => leer());
    lenta.resolver({ lista: [1, 2, 3] });
    const valores = await Promise.all(peticiones);
    expect(cargar).toHaveBeenCalledTimes(1);
    expect(new Set(valores.map((v) => JSON.stringify(v)))).toEqual(new Set(['{"lista":[1,2,3]}']));
    await e.drenar();
    const a = await leer();
    const b = await leer();
    a.lista.push(99);
    expect(b.lista).toEqual([1, 2, 3]);
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  it('claves distintas no se bloquean entre sí: una carga por clave', async () => {
    const e = entorno();
    const cargar = vi.fn(async (id: string) => ({ id }));
    const leer = e.cache.definir({ espacio: 'por-clave', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    const r = await Promise.all(['a', 'b', 'a', 'c', 'b', 'a'].map((id) => leer(id)));
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'a', 'c', 'b', 'a']);
    expect(cargar.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b', 'c']);
  });

  it('si la carga compartida falla, todas las que esperaban fallan y la siguiente lo vuelve a intentar', async () => {
    const e = entorno();
    const lenta = diferida<{ ok: boolean }>();
    const cargar = vi.fn(() => lenta.promesa);
    const leer = e.cache.definir({ espacio: 'estampida-fallo', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    const peticiones = Array.from({ length: 10 }, () => leer());
    lenta.rechazar(new Error('D1 caída'));
    const r = await Promise.allSettled(peticiones);
    expect(r.every((x) => x.status === 'rejected')).toBe(true);
    expect(cargar).toHaveBeenCalledTimes(1);
    cargar.mockImplementation(async () => ({ ok: true }));
    expect(await leer()).toEqual({ ok: true });
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  it('el mismo número y el mismo texto («1» y 1 y true) son claves distintas', () => {
    const ids = new Set([claveCache('x', 'v', [1]).completa, claveCache('x', 'v', ['1']).completa, claveCache('x', 'v', [true]).completa,
      claveCache('x', 'v', [null]).completa, claveCache('x', 'v', ['~']).completa]);
    expect(ids.size).toBe(5);
  });
});

describe('caché compartida: servir lo viejo mientras se recalcula', () => {
  it('pasada la frescura, varias peticiones a la vez sirven lo viejo y lanzan UNA sola revalidación', async () => {
    const e = entorno();
    let version = 1;
    const cargar = vi.fn(async () => ({ version: version }));
    const leer = e.cache.definir({ espacio: 'swr-una', depende: ['deporte'], frescoMs: 1000, caducaMs: 60_000, cargar });
    await leer();
    await e.drenar();
    version = 2;
    e.avanzar(1500);
    const lenta = diferida<{ version: number }>();
    cargar.mockImplementationOnce(() => lenta.promesa);
    const viejas = await Promise.all(Array.from({ length: 20 }, () => leer()));
    expect(viejas.every((v) => v.version === 1)).toBe(true);
    expect(cargar).toHaveBeenCalledTimes(2);
    lenta.resolver({ version: 2 });
    await e.drenar();
    expect(await leer()).toEqual({ version: 2 });
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  it('un fallo al revalidar se registra y lo viejo se sigue sirviendo', async () => {
    const e = entorno();
    const cargar = vi.fn(async () => ({ n: 1 }));
    const leer = e.cache.definir({ espacio: 'swr-fallo', depende: ['deporte'], frescoMs: 1000, caducaMs: 60_000, cargar });
    await leer();
    await e.drenar();
    e.avanzar(2000);
    cargar.mockRejectedValueOnce(new Error('consulta lenta cortada'));
    expect(await leer()).toEqual({ n: 1 });
    await e.drenar();
    expect(e.eventos.some((x) => x.tipo === 'error' && x.fase === 'revalidar')).toBe(true);
    expect(await leer()).toEqual({ n: 1 });
  });

  it('pasada la caducidad no se sirve nunca: espera a la carga', async () => {
    const e = entorno();
    let n = 1;
    const cargar = vi.fn(async () => ({ n }));
    const leer = e.cache.definir({ espacio: 'swr-caduca', depende: ['deporte'], frescoMs: 1000, caducaMs: 5000, cargar });
    await leer();
    await e.drenar();
    n = 2;
    e.avanzar(5000);
    expect(await leer()).toEqual({ n: 2 });
  });

  it('con anteriorMientrasRevalida = false, tras invalidar se espera a la carga nueva', async () => {
    const e = entorno();
    let n = 1;
    const cargar = vi.fn(async () => ({ n }));
    const leer = e.cache.definir({
      espacio: 'sin-anterior', depende: ['calendario'], frescoMs: 1000, caducaMs: 60_000, cargar, anteriorMientrasRevalida: false,
    });
    await leer();
    await e.drenar();
    n = 2;
    e.epocas.calendario = 1;
    expect(await leer()).toEqual({ n: 2 });
    expect(e.tipos()).not.toContain('anterior');
  });
});

describe('versiones: ledger y época', () => {
  it('el ledger sólo cambia lo que depende de deporte; la época sólo lo suyo; el orden no importa', () => {
    const base = { ledger: 10, deporte: 0, calendario: 3 };
    const v = (ep: typeof base, deps: Dependencia[]) => versionDe(ep, deps);
    expect(v(base, ['deporte', 'calendario'])).toBe(v(base, ['calendario', 'deporte', 'calendario']));
    expect(v({ ...base, ledger: 11 }, ['calendario'])).toBe(v(base, ['calendario']));
    expect(v({ ...base, ledger: 11 }, ['deporte'])).not.toBe(v(base, ['deporte']));
    expect(v({ ...base, deporte: 1 }, ['deporte'])).not.toBe(v(base, ['deporte']));
    expect(v({ ...base, calendario: 4 }, ['ranking'])).toBe(v(base, ['ranking']));
    expect(versionDe(base, [])).toBe('fija');
  });

  it('una versión con un ledger de varios GiB sigue siendo una clave válida', () => {
    const ep = { ledger: 8 * 1024 ** 3 - 1, deporte: 12, calendario: 99_999, ranking: 7, 'ranking-fie': 3 };
    const version = versionDe(ep, ['deporte', 'calendario', 'ranking', 'ranking-fie']);
    expect(() => claveCache('ficha', version, ['x'])).not.toThrow();
    expect(version).toBe('c99999-d8589934591.12-r7-f3');
  });

  it('sobre SQLite: una escritura deportiva (ledger) y una invalidación (época) cambian la versión', async () => {
    const s = new DatabaseSync(':memory:');
    s.exec(`CREATE TABLE sport_capacity_ledger (key TEXT PRIMARY KEY, accounted_bytes INTEGER NOT NULL)`);
    s.exec(`INSERT INTO sport_capacity_ledger VALUES ('global', 1000)`);
    s.exec(readFileSync(new URL('../drizzle-d1/0016_cache_epoca.sql', import.meta.url), 'utf8'));
    const ejecutar: Ejecutar = async (texto, params = []) =>
      s.prepare(texto).all(...(params as SQLInputValue[])) as Record<string, unknown>[];
    let t = 0;
    const versiones = crearVersiones({ fuente: fuenteEpocasD1(ejecutar, () => t), ttlMs: 30_000, ahora: () => t });
    const v0 = await versiones.de(['deporte', 'calendario']);
    s.exec(`UPDATE sport_capacity_ledger SET accounted_bytes = 2000`);
    // Memorizada durante ttlMs: el cambio no se ve hasta que caduca.
    expect(await versiones.de(['deporte', 'calendario'])).toBe(v0);
    t += 30_000;
    const v1 = await versiones.de(['deporte', 'calendario']);
    expect(v1).not.toBe(v0);
    expect(await versiones.de(['calendario'])).toBe('c0');
    await invalidarCache(['calendario', 'calendario', 'inventada' as Dependencia], { ejecutar, versiones, ahora: () => 7 });
    expect(await versiones.de(['calendario'])).toBe('c1');
    await invalidarCache(['calendario'], { ejecutar, versiones, ahora: () => 8 });
    expect(await versiones.de(['calendario'])).toBe('c2');
    expect(s.prepare(`SELECT namespace, epoch FROM cache_epoch`).all()).toEqual([{ namespace: 'calendario', epoch: 2 }]);
    s.close();
  });

  it('un fallo al leer las épocas no se memoriza: la siguiente petición vuelve a la base', async () => {
    let fallar = true;
    const fuente = vi.fn(async () => {
      if (fallar) throw new Error('D1 caída');
      return { ledger: 5 };
    });
    const versiones = crearVersiones({ fuente, ttlMs: 60_000, ahora: () => 0 });
    await expect(versiones.de(['deporte'])).rejects.toThrow('D1 caída');
    fallar = false;
    expect(await versiones.de(['deporte'])).toBe('d5.0');
    expect(fuente).toHaveBeenCalledTimes(2);
  });

  it('valores raros en la tabla (texto, decimales, espacios desconocidos) no entran en la versión', async () => {
    const ejecutar: Ejecutar = async () => [
      { n: 'ledger', e: '42' }, { n: 'calendario', e: 1.5 }, { n: 'otra', e: 9 }, { n: 'ranking', e: null },
    ];
    const ep = await fuenteEpocasD1(ejecutar)();
    expect(ep).toEqual({ ledger: 42, ranking: 0 });
  });
});

describe('privacidad: nunca se guarda un valor con datos de cuenta', () => {
  it('detecta la clave dentro de un Set de objetos, un array de Map o tras una referencia circular', () => {
    expect(buscarDatoDeCuenta({ filas: new Set([{ a: 1 }, { esFavorito: true }]) })).toBe('$.filas[1].esFavorito');
    expect(buscarDatoDeCuenta([new Map([['x', { email: 'a@b.c' }]])])).toBe('$[0].x.email');
    const ciclo: Record<string, unknown> = { nombre: 'x' };
    ciclo.yo = ciclo;
    expect(buscarDatoDeCuenta(ciclo)).toBeNull();
    ciclo.otro = { siguiendo: [] };
    expect(buscarDatoDeCuenta(ciclo)).toBe('$.otro.siguiendo');
  });

  it('«mios» (tocados de la persona de la ficha) sí se puede guardar; una lista propia del espacio amplía las prohibidas', async () => {
    expect(buscarDatoDeCuenta({ mios: [1, 2] })).toBeNull();
    expect(CLAVES_DE_CUENTA).not.toContain('mios');
    const e = entorno();
    const cargar = vi.fn(async () => ({ total: 3, notaPrivada: 'x' }));
    const leer = e.cache.definir({
      espacio: 'prohibidas-propias', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar,
      clavesProhibidas: [...CLAVES_DE_CUENTA, 'notaPrivada'],
    });
    expect(await leer()).toEqual({ total: 3, notaPrivada: 'x' });
    await leer();
    expect(cargar).toHaveBeenCalledTimes(2);
    expect(e.eventos.filter((x) => x.tipo === 'privado')).toHaveLength(2);
  });

  it('el valor con datos de cuenta no llega a ningún almacén, ni siquiera al alias «ultima»', async () => {
    const escritos: string[] = [];
    const espia: Almacen = { nombre: 'espia', leer: async () => null, escribir: async (id) => { escritos.push(id); } };
    const e = entorno({ almacen: () => espia });
    const leer = e.cache.definir({
      espacio: 'privado-alias', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000,
      cargar: async (id: string) => ({ id, filas: [{ token: 'secreto' }] }),
    });
    await leer('p1');
    await e.drenar();
    expect(escritos).toEqual([]);
  });

  it('guardarSi permite no guardar un resultado vacío sin que deje de devolverse', async () => {
    const e = entorno();
    const cargar = vi.fn(async () => [] as number[]);
    const leer = e.cache.definir({
      espacio: 'guardar-si', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar, guardarSi: (v) => v.length > 0,
    });
    expect(await leer()).toEqual([]);
    expect(await leer()).toEqual([]);
    expect(cargar).toHaveBeenCalledTimes(2);
  });
});

describe('falla en cerrado: si la caché cae, se lee de D1', () => {
  const kvRoto = (): KvLike => ({
    get: async () => { throw new Error('KV 503'); },
    put: async () => { throw new Error('KV 503'); },
  });

  it('con KV caído en la cascada, la petición va al cargador y responde', async () => {
    let t = 1_000;
    const memoria = almacenMemoria({ ahora: () => t });
    const cascada = enCascada([memoria, almacenKv(kvRoto(), () => t)]);
    const e = entorno({ almacen: () => cascada });
    const cargar = vi.fn(async () => ({ desde: 'd1' }));
    const leer = e.cache.definir({ espacio: 'kv-caido', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    expect(await leer()).toEqual({ desde: 'd1' });
    await expect(e.drenar()).resolves.toBeUndefined();
    t += 1;
    expect(await leer()).toEqual({ desde: 'd1' });
    // La memoria del isolate sí guardó: la segunda no vuelve a D1.
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  it('un almacén que rechaza al leer cuenta como «no está»', async () => {
    const roto: Almacen = { nombre: 'roto', leer: async () => { throw new Error('caído'); }, escribir: async () => {} };
    const e = entorno({ almacen: () => roto });
    const cargar = vi.fn(async () => 7);
    const leer = e.cache.definir({ espacio: 'leer-roto', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar });
    expect(await leer()).toBe(7);
    expect(await leer()).toBe(7);
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  it('si ni siquiera se puede abrir el almacén, se lee de D1 y se registra', async () => {
    const e = entorno({ almacen: () => { throw new Error('sin binding'); } });
    const leer = e.cache.definir({ espacio: 'sin-almacen', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar: async () => 'ok' });
    expect(await leer()).toBe('ok');
    expect(e.eventos).toContainEqual(expect.objectContaining({ tipo: 'error', fase: 'leer' }));
  });

  it('KV con una entrada corrupta, de otro formato o con la clave completa de otra persona no se sirve', async () => {
    const t = 1_000;
    const id = claveCache('kv-corrupto', 'd100.0', ['ana']);
    const valores: string[] = [
      '{no es json',
      JSON.stringify({ k: id.completa, v: 1, frescoHasta: t + 10, caduca: t + 10 }),
      JSON.stringify({ k: claveCache('kv-corrupto', 'd100.0', ['otra']).completa, v: '"ajeno"', creado: 0, frescoHasta: t + 9e6, caduca: t + 9e6 }),
    ];
    for (const texto of valores) {
      const kv: KvLike = { get: async () => texto, put: async () => {} };
      const e = entorno({ almacen: () => almacenKv(kv, () => t) });
      const leer = e.cache.definir({ espacio: 'kv-corrupto', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar: async (_n: string) => 'propio' });
      expect(await leer('ana')).toBe('propio');
    }
  });

  it('KV exige 60 s de caducidad mínima aunque la entrada caduque antes', async () => {
    const put = vi.fn(async () => {});
    const kv = almacenKv({ get: async () => null, put }, () => 0);
    const entrada: Entrada = { k: 'k', v: '1', creado: 0, frescoHasta: 1000, caduca: 5000 };
    await kv.escribir('id', entrada);
    expect(put).toHaveBeenCalledWith('id', JSON.stringify(entrada), { expirationTtl: 60 });
  });
});

describe('serialización de fechas y números grandes', () => {
  it('BigInt, Date dentro de Map y Set, y enteros en el límite seguro hacen el viaje de ida y vuelta', () => {
    const valor = {
      grande: 2n ** 70n,
      limite: Number.MAX_SAFE_INTEGER,
      negativo: -Number.MAX_SAFE_INTEGER,
      fechas: new Map([['alta', new Date('2026-03-29T01:30:00.000Z')]]),
      dias: new Set([new Date('2024-02-29T00:00:00.000Z')]),
      lista: [new Date(0), { anidada: new Date('1999-12-31T23:59:59.999Z') }],
    };
    const vuelta = deserializar<typeof valor>(serializar(valor));
    expect(vuelta.grande).toBe(2n ** 70n);
    expect(vuelta.limite).toBe(Number.MAX_SAFE_INTEGER);
    expect(vuelta.negativo).toBe(-Number.MAX_SAFE_INTEGER);
    expect(vuelta.fechas.get('alta')).toEqual(new Date('2026-03-29T01:30:00.000Z'));
    expect([...vuelta.dias][0]).toEqual(new Date('2024-02-29T00:00:00.000Z'));
    expect(vuelta.lista[0]).toEqual(new Date(0));
    expect((vuelta.lista[1] as { anidada: Date }).anidada.toISOString()).toBe('1999-12-31T23:59:59.999Z');
  });

  it('una fecha en texto ISO sigue siendo texto, y un número no se convierte en BigInt', () => {
    const vuelta = deserializar<{ f: unknown; n: unknown }>(serializar({ f: '2026-01-01T00:00:00.000Z', n: 9_007_199_254_740_993 }));
    expect(typeof vuelta.f).toBe('string');
    expect(typeof vuelta.n).toBe('number');
  });

  it('un Date y un BigInt sirven igual desde la caché que recién calculados', async () => {
    const e = entorno();
    const valor = { cuando: new Date('2026-10-07T10:20:00Z'), bytes: 8n * 1024n ** 3n };
    const leer = e.cache.definir({ espacio: 'serial-cache', depende: ['deporte'], frescoMs: 1000, caducaMs: 10_000, cargar: async () => valor });
    const primera = await leer();
    await e.drenar();
    const segunda = await leer();
    expect(segunda).toEqual(primera);
    expect(segunda.cuando).toBeInstanceOf(Date);
    expect(typeof segunda.bytes).toBe('bigint');
  });

  it('una fecha inválida no se convierte en el 1 de enero de 1970 al salir de la caché', () => {
    const vuelta = deserializar<{ d: Date }>(serializar({ d: new Date('no es una fecha') }));
    expect(Number.isNaN(vuelta.d.getTime())).toBe(true);
  });
});

describe('cacheCompartida (index): fuera de un Worker y con la base local', () => {
  let s: DatabaseSync;

  beforeEach(() => {
    vi.resetModules();
    s = new DatabaseSync(':memory:');
    s.exec(`CREATE TABLE sport_capacity_ledger (key TEXT PRIMARY KEY, accounted_bytes INTEGER NOT NULL)`);
    s.exec(`INSERT INTO sport_capacity_ledger VALUES ('global', 10)`);
    const binding = {
      prepare: (texto: string) => {
        const st = (params: unknown[]) => ({
          bind: (...p: unknown[]) => st(p),
          all: async () => ({ results: s.prepare(texto).all(...(params as SQLInputValue[])), success: true, meta: {} }),
          run: async () => ({ results: [], success: true, meta: {} }),
          raw: async () => [],
          first: async () => null,
        });
        return st([]);
      },
      batch: async () => [],
    } as unknown as D1Binding;
    d1.binding = binding;
    vi.mocked(getCloudflareContext).mockImplementation(() => { throw new Error('fuera de un Worker'); });
  });
  afterEach(() => {
    s.close();
    vi.restoreAllMocks();
  });

  it('sin Worker ni KV funciona con la memoria del isolate y no lanza al esperar', async () => {
    const { cacheCompartida } = await import('../src/lib/cache/index');
    const cargar = vi.fn(async (id: string) => ({ id }));
    const leer = cacheCompartida.definir({ espacio: 'index-memoria', depende: ['deporte'], frescoMs: 60_000, caducaMs: 120_000, cargar });
    expect(await leer('a')).toEqual({ id: 'a' });
    expect(await leer('a')).toEqual({ id: 'a' });
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  it('con un KV caído en el entorno, la pantalla sigue saliendo', async () => {
    const waitUntil = vi.fn();
    vi.mocked(getCloudflareContext).mockReturnValue({
      env: { CACHE_DATOS: { get: async () => { throw new Error('KV caído'); }, put: async () => { throw new Error('KV caído'); } } },
      ctx: { waitUntil },
    } as never);
    const { cacheCompartida } = await import('../src/lib/cache/index');
    const leer = cacheCompartida.definir({
      espacio: 'index-kv-caido', depende: ['deporte'], frescoMs: 60_000, caducaMs: 120_000, cargar: async () => ({ ok: 1 }),
    });
    expect(await leer()).toEqual({ ok: 1 });
    expect(waitUntil).toHaveBeenCalled();
    await Promise.all(waitUntil.mock.calls.map((c) => c[0]));
  });

  it('invalidarTrasIngesta e invalidarCacheSinFallar nunca lanzan y no registran el SQL', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { invalidarTrasIngesta, invalidarCacheSinFallar } = await import('../src/lib/cache/index');
    await expect(invalidarTrasIngesta('fie')).resolves.toBeUndefined();
    await expect(invalidarCacheSinFallar(['calendario'], 'prueba')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
    for (const llamada of error.mock.calls) expect(JSON.stringify(llamada)).not.toMatch(/INSERT|json_each/);
    // La de administración sólo registra el tipo de error, nunca su mensaje.
    expect(JSON.stringify(error.mock.calls[1])).not.toContain('no such table');
  });

  it('con la tabla, una ingesta FIE sube calendario y deporte y no toca los rankings', async () => {
    s.exec(readFileSync(new URL('../drizzle-d1/0016_cache_epoca.sql', import.meta.url), 'utf8'));
    const { invalidarTrasIngesta } = await import('../src/lib/cache/index');
    // `run` del binding falso no escribe: el SQL de invalidar se ejecuta por `all`.
    await invalidarTrasIngesta('fie');
    expect(s.prepare(`SELECT namespace, epoch FROM cache_epoch ORDER BY namespace`).all())
      .toEqual([{ namespace: 'calendario', epoch: 1 }, { namespace: 'deporte', epoch: 1 }]);
  });
});
