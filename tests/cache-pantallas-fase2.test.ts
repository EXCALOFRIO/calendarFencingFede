import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { almacenMemoria } from '@/lib/cache/almacenes';
import { crearCache } from '@/lib/cache/cache';
import { buscarDatoDeCuenta } from '@/lib/cache/privacidad';
import { versionDe, type Dependencia } from '@/lib/cache/versiones';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { CRITERIOS_CARA_A_CARA_VACIOS } from '@/lib/sport/explorar/cara-a-cara-url';
import { CLAVES_PRIVADAS, clavesDe, crearContexto, perfil, UUID_A, UUID_B } from './helpers/explorar';

/*
  Las pantallas de verdad se sustituyen por cargadores que dicen con qué
  cuenta se ejecutaron: si un valor cacheado llevara la cuenta de quien lo
  pidió primero, se vería aquí.
*/
const llamadas = vi.hoisted(() => ({ edicion: 0, pantalla: 0, relevos: 0, series: 0, catalogo: 0, rendimiento: true as boolean }));

vi.mock('@/lib/sport/explorar/ediciones-pantalla', () => ({
  cargarEdicion: async (ctx: ContextoExplorador, edicionId: string, criterios: { prueba: string; cursor: string }) => {
    llamadas.edicion++;
    const quien = (await ctx.perfil())?.profileId ?? null;
    return {
      tipo: 'ok',
      edicion: { id: edicionId, pruebaElegida: criterios.prueba || null, asaltos: edicionId === UUID_B ? 'error' : null, quien, cursor: criterios.cursor },
      conjunta: null,
    };
  },
  cargarSeries: async (ctx: ContextoExplorador) => {
    llamadas.series++;
    return { tipo: 'ok', series: [], quien: (await ctx.perfil())?.profileId };
  },
}));
vi.mock('@/lib/sport/explorar/catalogo', () => ({
  cargarCatalogoEdiciones: async (ctx: ContextoExplorador, entrada: Record<string, string>, opciones?: { indice?: () => Promise<unknown> }) => {
    llamadas.catalogo++;
    const indice = opciones?.indice ? Boolean(await opciones.indice()) : false;
    return { estado: 'ok', ediciones: [], total: 0, pruebas: 0, siguiente: null, entrada, indice, quien: (await ctx.perfil())?.profileId };
  },
}));
vi.mock('@/lib/sport/explorar/cara-a-cara-pantalla', () => ({
  cargarCaraACaraPantalla: async (ctx: ContextoExplorador, personaId: string, criterios: { rival: string; q: string; temporada: string }) => {
    llamadas.pantalla++;
    const quien = (await ctx.perfil())?.profileId ?? null;
    if (!criterios.rival) {
      return { tipo: 'elegir', persona: { id: personaId, nombre: 'X', pais: null }, rivales: { tipo: 'ok', items: [], siguiente: null, sinResultados: true }, otros: null, quien, hoy: ctx.hoy(), q: criterios.q };
    }
    return {
      tipo: 'ok',
      datos: { estado: 'ok', personas: { yo: { id: personaId }, rival: { id: criterios.rival } }, quien },
      rendimiento: criterios.temporada ? null : llamadas.rendimiento ? { puntos: [] } : null,
    };
  },
}));
vi.mock('@/lib/sport/explorar/relevos', () => ({
  cargarRelevosCaraACara: async (_ctx: unknown, personaId: string) => {
    llamadas.relevos++;
    // Sin tablas de relevos (o sin relevos) la lectura es `null`.
    return personaId === UUID_B ? null : { items: [], resumen: { relevos: 0, tocadosFavor: 0, tocadosContra: 0 } };
  },
}));

const propuestas = vi.hoisted(() => ({ destacados: 0, sugeridos: 0, quien: [] as (string | null)[] }));
vi.mock('@/lib/sport/explorar/siguiendo-pantalla', async (original) => {
  const real = await original<typeof import('@/lib/sport/explorar/siguiendo-pantalla')>();
  return {
    ...real,
    leerDestacadosParaSeguir: async (ctx: ContextoExplorador) => {
      propuestas.destacados++;
      propuestas.quien.push((await ctx.perfil())?.profileId ?? null);
      return [
        { id: UUID_A, nombre: 'A', pais: 'ESP', motivo: '1º internacional' },
        { id: UUID_B, nombre: 'B', pais: 'ESP', motivo: '2º internacional' },
      ];
    },
    leerSugeridosDePersona: async () => {
      propuestas.sugeridos++;
      return null;
    },
  };
});

const { crearCachesExplorar } = await import('@/lib/sport/explorar/cache-pantallas');
const { contextoPublico, LECTOR_PUBLICO } = await import('@/lib/sport/explorar/contexto-publico');

function entorno({ sinIndice = false }: { sinIndice?: boolean } = {}) {
  const memoria = almacenMemoria();
  const cache = crearCache({
    almacen: () => memoria,
    versiones: { de: async (deps: readonly Dependencia[]) => versionDe({ ledger: 7 }, deps), olvidar() {} },
    esperar: () => {},
  });
  // Sin la identidad deportiva no hay índice de ediciones y el catálogo vuelve a la caché por búsqueda.
  const base = crearContexto(sinIndice ? { esquema: { identidad: false, referencias: false } } : {});
  const publicos: ContextoExplorador[] = [];
  const caches = crearCachesExplorar({
    cache,
    publico: (hoy) => {
      const c = contextoPublico(hoy, { db: base.ctx.db, esquema: base.ctx.esquema });
      publicos.push(c);
      return c;
    },
  });
  return { caches, publicos, memoria, sentencias: base.sentencias };
}

const cuentaA = () => crearContexto({ perfil: perfil({ profileId: 'cuenta-a', email: 'a@example.test' }) }).ctx;
const cuentaB = () => crearContexto({ perfil: perfil({ profileId: 'cuenta-b', email: 'b@example.test' }) }).ctx;

beforeEach(() => {
  Object.assign(llamadas, { edicion: 0, pantalla: 0, relevos: 0, series: 0, catalogo: 0, rendimiento: true });
});

describe('contexto público de los cargadores cacheados', () => {
  it('no lleva identidad y veta todo lo de la cuenta', async () => {
    const c = contextoPublico('2026-10-08', crearContexto().ctx);
    const yo = await c.perfil();
    expect(yo).toBe(LECTOR_PUBLICO);
    expect(yo?.profileId).toBe('');
    expect(yo?.email).toBe('');
    expect(c.hoy()).toBe('2026-10-08');
    await expect(c.propietario.atletasDeCuenta('x')).rejects.toThrow();
    await expect(c.propietario.personasEnlazadas(['x'])).rejects.toThrow();
    await expect(c.propietario.evidencia.externos([])).rejects.toThrow();
  });
});

describe('edición compartida', () => {
  it('dos cuentas leen la misma entrada, calculada sin ninguna de las dos', async () => {
    const { caches } = entorno();
    const a = await caches.cargarEdicionCompartida(cuentaA(), UUID_A, { prueba: '', cursor: '' });
    const b = await caches.cargarEdicionCompartida(cuentaB(), UUID_A, { prueba: '', cursor: '' });
    expect(llamadas.edicion).toBe(1);
    expect(b).toEqual(a);
    expect(a).toMatchObject({ tipo: 'ok', edicion: { quien: '' } });
    const texto = JSON.stringify(a);
    expect(texto).not.toContain('cuenta-a');
    expect(texto).not.toContain('a@example.test');
  });

  it('cada prueba es su propia entrada', async () => {
    const { caches } = entorno();
    await caches.cargarEdicionCompartida(cuentaA(), UUID_A, { prueba: '', cursor: '' });
    const otra = await caches.cargarEdicionCompartida(cuentaA(), UUID_A, { prueba: UUID_B, cursor: '' });
    expect(llamadas.edicion).toBe(2);
    expect(otra).toMatchObject({ edicion: { pruebaElegida: UUID_B } });
  });

  it('sin sesión no entra en la caché ni calcula nada', async () => {
    const { caches, publicos } = entorno();
    const sin = crearContexto({ perfil: null }).ctx;
    expect(await caches.cargarEdicionCompartida(sin, UUID_A, { prueba: '', cursor: '' })).toEqual({ tipo: 'sin_sesion' });
    expect(llamadas.edicion).toBe(0);
    expect(publicos).toHaveLength(0);
  });

  it('con cursor va directo con la petición y no guarda nada', async () => {
    const { caches, publicos } = entorno();
    const r = await caches.cargarEdicionCompartida(cuentaA(), UUID_A, { prueba: UUID_B, cursor: 'c'.repeat(500) });
    expect(r).toMatchObject({ edicion: { quien: 'cuenta-a' } });
    expect(publicos).toHaveLength(0);
  });

  it('una lectura incompleta (asaltos con error) no se guarda', async () => {
    const { caches } = entorno();
    await caches.cargarEdicionCompartida(cuentaA(), UUID_B, { prueba: '', cursor: '' });
    await caches.cargarEdicionCompartida(cuentaA(), UUID_B, { prueba: '', cursor: '' });
    expect(llamadas.edicion).toBe(2);
  });

  it('catálogo con índice: el índice se lee una vez, sin cuenta, y cada búsqueda se resuelve en la petición', async () => {
    const { caches, sentencias } = entorno();
    const vacio = { q: '', fuente: '', temporada: '' };
    const a = await caches.cargarCatalogoCompartido(cuentaA(), vacio, undefined);
    const b = await caches.cargarCatalogoCompartido(cuentaB(), { ...vacio, q: 'mndial' }, undefined);
    const pagina = await caches.cargarCatalogoCompartido(cuentaA(), vacio, 'cursor-x');
    expect(llamadas.series).toBe(1);
    expect(llamadas.catalogo).toBe(3);
    expect(sentencias.filter((s) => /LEFT JOIN sport_competition c ON c.edition_id = e.id/.test(s.text))).toHaveLength(1);
    expect(a.catalogo).toMatchObject({ indice: true, quien: 'cuenta-a' });
    expect(b.catalogo).toMatchObject({ indice: true, quien: 'cuenta-b', entrada: { q: 'mndial' } });
    expect(pagina.catalogo).toMatchObject({ indice: true, entrada: { cursor: 'cursor-x' } });
    expect(JSON.stringify(a.series)).not.toContain('cuenta-a');
  });

  it('catálogo sin índice: primera página compartida; con cursor, directo', async () => {
    const { caches } = entorno({ sinIndice: true });
    const vacio = { q: '', fuente: '', temporada: '' };
    const a = await caches.cargarCatalogoCompartido(cuentaA(), vacio, undefined);
    const b = await caches.cargarCatalogoCompartido(cuentaB(), vacio, undefined);
    expect([llamadas.series, llamadas.catalogo]).toEqual([1, 1]);
    expect(b).toEqual(a);
    expect(JSON.stringify(a)).not.toContain('cuenta-a');
    const pagina = await caches.cargarCatalogoCompartido(cuentaA(), vacio, 'cursor-x');
    expect(llamadas.catalogo).toBe(2);
    expect(pagina.catalogo).toMatchObject({ quien: 'cuenta-a', entrada: { cursor: 'cursor-x' } });
  });

  it('catálogo sin índice: el texto se normaliza para la clave; uno largo o un filtro desconocido van directos', async () => {
    const { caches } = entorno({ sinIndice: true });
    await caches.cargarCatalogoCompartido(cuentaA(), { q: 'Copa  ESPAÑA', fuente: 'fie', temporada: '2025-2026' }, undefined);
    const igual = await caches.cargarCatalogoCompartido(cuentaB(), { q: 'copa espana', fuente: 'fie', temporada: '2025-2026' }, undefined);
    expect(llamadas.catalogo).toBe(1);
    expect(igual.catalogo).toMatchObject({ quien: '', entrada: { q: 'copa espana' } });
    for (const malo of [
      { q: 'x'.repeat(41), fuente: '', temporada: '' },
      { q: '', fuente: 'otra', temporada: '' },
      { q: '', fuente: '', temporada: 'ayer' },
    ]) {
      const r = await caches.cargarCatalogoCompartido(cuentaA(), malo, undefined);
      expect(r.catalogo).toMatchObject({ quien: 'cuenta-a' });
    }
    expect(llamadas.catalogo).toBe(4);
  });

  it('una edición o una prueba que no son UUID van directas, sin clave en la caché', async () => {
    const { caches, publicos } = entorno();
    const r = await caches.cargarEdicionCompartida(cuentaA(), 'no-es-uuid', { prueba: '', cursor: '' });
    await caches.cargarEdicionCompartida(cuentaA(), UUID_A, { prueba: 'x'.repeat(30), cursor: '' });
    expect(r).toMatchObject({ edicion: { quien: 'cuenta-a' } });
    expect(publicos).toHaveLength(0);
  });
});

describe('cara a cara compartido', () => {
  const elegir = { ...CRITERIOS_CARA_A_CARA_VACIOS };
  const duelo = { ...CRITERIOS_CARA_A_CARA_VACIOS, rival: UUID_B };

  it('elegir rival: una entrada por persona, común a todas las cuentas', async () => {
    const { caches } = entorno();
    const a = await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, elegir);
    const b = await caches.cargarCaraACaraCompartida(cuentaB(), UUID_A, elegir);
    expect(llamadas.pantalla).toBe(1);
    expect(b).toEqual(a);
    expect(a.vista).toMatchObject({ tipo: 'elegir', quien: '' });
    await caches.cargarCaraACaraCompartida(cuentaA(), UUID_B, elegir);
    expect(llamadas.pantalla).toBe(2);
  });

  it('la búsqueda de rival por nombre (texto libre) va directa y no entra en la caché', async () => {
    const { caches, publicos, memoria } = entorno();
    const r = await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, { ...elegir, q: 'zabala' });
    expect(r.vista).toMatchObject({ q: 'zabala', hoy: '2026-10-02', quien: 'cuenta-a' });
    await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, { ...elegir, q: 'zabala' });
    expect(llamadas.pantalla).toBe(2);
    expect(publicos).toHaveLength(0);
    expect(memoria.bytes).toBe(0);
  });

  it('un duelo con filtros fuera de los valores admitidos va directo', async () => {
    const { caches, publicos } = entorno();
    for (const malo of [{ temporada: 'x'.repeat(12) }, { arma: 'LANZA' }, { fase: 'FINAL' }, { ambito: 'galactico' }]) {
      await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, { ...duelo, ...malo });
    }
    expect(llamadas.pantalla).toBe(4);
    expect(publicos).toHaveLength(0);
    await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, { ...duelo, temporada: '2025-2026', arma: 'SABLE', fase: 'POULE', ambito: 'nacional' });
    expect(publicos).toHaveLength(1);
  });

  it('el duelo guarda los relevos en la misma entrada', async () => {
    const { caches } = entorno();
    const a = await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, duelo);
    const b = await caches.cargarCaraACaraCompartida(cuentaB(), UUID_A, duelo);
    expect([llamadas.pantalla, llamadas.relevos]).toEqual([1, 1]);
    expect(b).toEqual(a);
    expect(a.relevos).toMatchObject({ items: [] });
    expect(JSON.stringify(a)).not.toContain('cuenta-a');
    // Sin relevos (o sin sus tablas) el duelo se guarda igual.
    const sinRelevos = { ...duelo, rival: UUID_A };
    await caches.cargarCaraACaraCompartida(cuentaA(), UUID_B, sinRelevos);
    const otra = await caches.cargarCaraACaraCompartida(cuentaB(), UUID_B, sinRelevos);
    expect(otra.relevos).toBeNull();
    expect(llamadas.pantalla).toBe(2);
  });

  it('sin filtros y sin rendimiento es una lectura incompleta: no se guarda; con filtros sí', async () => {
    const { caches } = entorno();
    llamadas.rendimiento = false;
    await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, duelo);
    await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, duelo);
    expect(llamadas.pantalla).toBe(2);
    const filtrado = { ...duelo, temporada: '2025' };
    await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, filtrado);
    await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, filtrado);
    expect(llamadas.pantalla).toBe(3);
  });

  it('entradas no válidas y sin sesión no llegan a la caché', async () => {
    const { caches, publicos } = entorno();
    expect((await caches.cargarCaraACaraCompartida(cuentaA(), 'no-es-uuid', elegir)).vista).toEqual({ tipo: 'entrada_invalida' });
    expect((await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, { ...duelo, rival: 'x' })).vista).toEqual({ tipo: 'entrada_invalida' });
    expect((await caches.cargarCaraACaraCompartida(crearContexto({ perfil: null }).ctx, UUID_A, duelo)).vista).toEqual({ tipo: 'sin_sesion' });
    expect(publicos).toHaveLength(0);
  });

  it('lo guardado no lleva claves de cuenta', async () => {
    const { caches, memoria } = entorno();
    await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, duelo);
    await caches.cargarEdicionCompartida(cuentaA(), UUID_A, { prueba: '', cursor: '' });
    expect(memoria.bytes).toBeGreaterThan(0);
    const a = await caches.cargarCaraACaraCompartida(cuentaA(), UUID_A, duelo);
    expect(buscarDatoDeCuenta(a)).toBeNull();
    const claves = clavesDe(a);
    for (const c of CLAVES_PRIVADAS.filter((x) => x !== 'profileId')) expect(claves.has(c)).toBe(false);
  });
});

describe('Buscar vacío compartido', () => {
  const sigue = (profileId: string, seguidas: string[]) => crearContexto({
    perfil: perfil({ profileId, email: `${profileId}@example.test` }),
    respuestas: [{ cuando: /FROM sport_favorite f CROSS JOIN sport_person/, filas: seguidas.map((id) => ({ id })) }],
  }).ctx;

  beforeEach(() => Object.assign(propuestas, { destacados: 0, sugeridos: 0, quien: [] }));

  it('la lista común se lee una vez sin cuenta y a quién sigue cada cuenta se quita al vuelo', async () => {
    const { caches } = entorno();
    const a = await caches.cargarBuscarVacioCompartido(sigue('cuenta-a', [UUID_A]));
    const b = await caches.cargarBuscarVacioCompartido(sigue('cuenta-b', []));
    expect(propuestas.destacados).toBe(1);
    expect(propuestas.quien).toEqual(['']);
    expect(a?.map((p) => p.id)).toEqual([UUID_B]);
    expect(b?.map((p) => p.id)).toEqual([UUID_A, UUID_B]);
    // Sin ficha propia confirmada no se piden sugeridos de nadie.
    expect(propuestas.sugeridos).toBe(0);
  });

  it('sin sesión no llega a la caché', async () => {
    const { caches } = entorno();
    await expect(caches.cargarBuscarVacioCompartido(crearContexto({ perfil: null }).ctx)).rejects.toThrow();
    expect(propuestas.destacados).toBe(0);
  });
});

describe('detector de pruebas conjuntas memorizado', () => {
  it('una base, un detector: el barrido de sqlite_master se hace una vez', async () => {
    const { detectorConjuntasDe } = await import('@/lib/sport/explorar/pruebas-conjuntas');
    const { leerConjuntaDePrueba } = await import('@/lib/sport/explorar/conjunta-edicion');
    const { ctx, sentencias } = crearContexto({
      respuestas: [{ cuando: /sqlite_master/, filas: [{ ok: 1 }] }],
    });
    expect(detectorConjuntasDe(ctx.db)).toBe(detectorConjuntasDe(ctx.db));
    expect(detectorConjuntasDe(crearContexto().ctx.db)).not.toBe(detectorConjuntasDe(ctx.db));
    await leerConjuntaDePrueba(ctx.db, UUID_A);
    await leerConjuntaDePrueba(ctx.db, UUID_B);
    expect(sentencias.filter((s) => /sqlite_master/.test(s.text))).toHaveLength(1);
  });
});

describe('resumen mundial: la consulta reescrita da lo mismo', () => {
  it('sin el CTE de grupos, el mismo resultado que la consulta anterior', async () => {
    const { sqlClasificacionFieDePersonas } = await import('@/lib/sport/explorar/ranking-nacional');
    const { SQLiteSyncDialect } = await import('drizzle-orm/sqlite-core');
    const s = new DatabaseSync(':memory:');
    s.exec(`CREATE TABLE sport_external_id (person_id TEXT, scheme TEXT, value TEXT, link_status TEXT);
      CREATE TABLE fie_clasificacion (season INTEGER, weapon TEXT, gender TEXT, category TEXT, category_raw TEXT,
        format TEXT, fie_id INTEGER, position INTEGER);
      CREATE INDEX fie_clasificacion_fie_idx ON fie_clasificacion (fie_id, season);`);
    s.exec(`INSERT INTO sport_external_id VALUES ('${UUID_A}', 'fie_addr_id', '101', 'CONFIRMADO'),
      ('${UUID_A}', 'fie_addr_id', '102', 'PROPUESTO'), ('${UUID_B}', 'fie_addr_id', '103', 'CONFIRMADO')`);
    s.exec(`INSERT INTO fie_clasificacion VALUES
      (2026, 'FLORETE', 'M', 'ABS', 'Senior', 'INDIVIDUAL', 101, 4),
      (2026, 'FLORETE', 'M', 'JUN', 'Junior', 'INDIVIDUAL', 101, 1),
      (2026, 'FLORETE', 'M', 'ABS', 'Senior', 'EQUIPOS', 101, 2),
      (2025, 'FLORETE', 'M', 'ABS', 'Senior', 'INDIVIDUAL', 101, 9),
      (2026, 'FLORETE', 'M', 'ABS', 'Senior', 'INDIVIDUAL', 102, 7),
      (2026, 'ESPADA', 'F', 'ABS', 'Senior', 'INDIVIDUAL', 103, NULL),
      (2026, 'ESPADA', 'F', 'ABS', 'Senior', 'INDIVIDUAL', 103, 30)`);
    const anterior = `
      WITH ids AS MATERIALIZED (
        SELECT DISTINCT CAST(x.value AS INTEGER) AS fie FROM sport_external_id x
        WHERE x.scheme = 'fie_addr_id' AND x.link_status = 'CONFIRMADO' AND x.person_id IN (SELECT value FROM json_each(?))
      ), g AS MATERIALIZED (
        SELECT DISTINCT season, weapon, gender, category_raw FROM fie_clasificacion
        WHERE season = (SELECT max(season) FROM fie_clasificacion)
      )
      SELECT f.weapon AS arma, f.gender AS genero, f.category AS categoria, f.position AS puesto,
             CAST(f.season AS TEXT) AS temporada, f.fie_id AS "fieId"
      FROM g CROSS JOIN ids CROSS JOIN fie_clasificacion f
        ON f.season = g.season AND f.weapon = g.weapon AND f.gender = g.gender
       AND f.category_raw = g.category_raw AND f.format = 'INDIVIDUAL' AND f.fie_id = ids.fie
      WHERE f.position IS NOT NULL`;
    const ids = [UUID_A, UUID_B];
    const nueva = new SQLiteSyncDialect().sqlToQuery(sqlClasificacionFieDePersonas(ids));
    expect(nueva.sql).not.toMatch(/\bg AS MATERIALIZED/);
    const orden = (f: Record<string, unknown>[]) => f.map((x) => JSON.stringify(x)).sort();
    const antes = s.prepare(anterior).all(JSON.stringify(ids));
    const ahora = s.prepare(nueva.sql).all(...(nueva.params as string[]));
    expect(antes.length).toBe(3);
    expect(orden(ahora)).toEqual(orden(antes));
    const plan = s.prepare(`EXPLAIN QUERY PLAN ${nueva.sql}`).all(...(nueva.params as string[])) as { detail: string }[];
    expect(plan.some((p) => /fie_clasificacion_fie_idx/.test(p.detail))).toBe(true);
  });
});

describe('resolverPersona memorizada por petición', () => {
  it('va envuelta en React `cache`: con una caché activa, la misma persona se resuelve una vez', async () => {
    vi.resetModules();
    vi.doMock('react', async () => {
      const real = await vi.importActual<typeof import('react')>('react');
      return {
        ...real,
        cache: <A extends unknown[], R>(fn: (...a: A) => R) => {
          const memo = new Map<string, R>();
          return (...a: A) => {
            const k = a.map((x) => (typeof x === 'string' ? x : 'db')).join('|');
            if (!memo.has(k)) memo.set(k, fn(...a));
            return memo.get(k)!;
          };
        },
      };
    });
    const { resolverPersona } = await import('@/lib/sport/explorar/personas');
    const { ctx, sentencias } = crearContexto({
      respuestas: [
        { cuando: /WITH RECURSIVE cadena/, filas: [{ id: UUID_A }] },
        { cuando: /WITH RECURSIVE grupo/, filas: [{ id: UUID_A }] },
      ],
    });
    const [a, b] = await Promise.all([resolverPersona(ctx.db, UUID_A), resolverPersona(ctx.db, UUID_A)]);
    expect(a).toEqual({ canonicaId: UUID_A, ids: [UUID_A] });
    expect(b).toBe(a);
    expect(sentencias).toHaveLength(2);
    vi.doUnmock('react');
    vi.resetModules();
  });
});

describe('sin esqueletos ni «Cargando…» en calendario, edición y cara a cara', () => {
  const raiz = join(import.meta.dirname, '..');
  it('no hay loading.tsx en ediciones ni en cara a cara', () => {
    expect(existsSync(join(raiz, 'src/app/(app)/explorar/ediciones/loading.tsx'))).toBe(false);
    expect(existsSync(join(raiz, 'src/app/(app)/explorar/[personaId]/cara-a-cara/loading.tsx'))).toBe(false);
    expect(existsSync(join(raiz, 'src/app/(app)/loading.tsx'))).toBe(false);
  });

  it('los componentes del calendario no pintan esqueletos ni «Cargando…»', () => {
    const dir = join(raiz, 'src/components/calendario');
    const ficheros = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith('.tsx'))
      .map((f) => join(f.parentPath, f.name));
    expect(ficheros.length).toBeGreaterThan(5);
    for (const f of ficheros) {
      const texto = readFileSync(f, 'utf8');
      expect(texto, f).not.toMatch(/<Skeleton|Loader2|Cargando…/);
    }
  });

  it('la página de cara a cara pinta los relevos con el duelo, sin Suspense', () => {
    const texto = readFileSync(join(raiz, 'src/app/(app)/explorar/[personaId]/cara-a-cara/page.tsx'), 'utf8');
    expect(texto).not.toMatch(/Suspense|fallback=/);
    expect(texto).toContain('cargarCaraACaraCompartida');
  });
});
