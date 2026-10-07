import { beforeEach, describe, expect, it, vi } from 'vitest';
import { almacenMemoria } from '@/lib/cache/almacenes';
import { crearCache } from '@/lib/cache/cache';
import { buscarDatoDeCuenta } from '@/lib/cache/privacidad';
import { versionDe, type Dependencia } from '@/lib/cache/versiones';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { crearContexto, perfil, UUID_A, UUID_B } from './helpers/explorar';

/*
  Los cargadores de verdad se sustituyen por otros que apuntan con qué cuenta
  se ejecutaron: si lo cacheado llevara la cuenta de quien lo pidió primero,
  se vería aquí.
*/
const llamadas = vi.hoisted(() => ({
  ficha: 0, extras: 0, rivales: 0, relevos: 0, rendimiento: 0, quien: [] as (string | null)[],
  historial: 'ok' as 'ok' | 'error', propia: null as string | null, anio: 2010 as number | null,
}));

vi.mock('@/lib/sport/explorar/ficha-pantalla', () => ({
  cargarFichaPantalla: async (ctx: ContextoExplorador, personaId: string) => {
    llamadas.ficha++;
    llamadas.quien.push((await ctx.perfil())?.profileId ?? null);
    return {
      tipo: 'ok',
      // Lo que da la ficha pública de un posible menor: sin año y sin marcar como propia.
      ficha: { id: personaId, nombre: 'X', esPropia: false, anioNacimiento: null, esMenor: true },
      historial: llamadas.historial === 'ok' ? { tipo: 'ok', items: [], siguiente: null, sinResultados: true } : { tipo: 'error' },
    };
  },
}));
vi.mock('@/lib/sport/explorar/perfil-extra', () => ({
  EXTRAS_VACIOS: { datos: null, rendimiento: null },
  cargarExtrasPerfil: async () => {
    llamadas.extras++;
    return { datos: null, rendimiento: null, rankingNacional: { temporadas: [] } };
  },
}));
vi.mock('@/lib/sport/explorar/perfil-diferido', () => ({
  cargarRendimientoPerfil: async () => {
    llamadas.rendimiento++;
    return { vistas: {} };
  },
  cargarRivalesPerfil: async (_ctx: unknown, personaId: string) => {
    llamadas.rivales++;
    // UUID_B: la lista de sugeridos falla.
    return { nombre: 'X', enfrentados: { todos: {} }, sugeridos: personaId === UUID_B ? null : [] };
  },
  cargarRelevosPerfil: async () => {
    llamadas.relevos++;
    return null;
  },
  cargarCuriosidadesPerfil: async () => null,
  cargarEuropeoPerfil: async () => null,
}));
vi.mock('@/lib/sport/explorar/propietario', () => ({
  resolverPersonaPropia: async (ctx: ContextoExplorador) => {
    const quien = (await ctx.perfil())?.profileId;
    return llamadas.propia && quien === 'cuenta-a' ? { estado: 'confirmada', personaId: llamadas.propia } : { estado: 'sin_ficha' };
  },
}));
vi.mock('@/lib/sport/explorar/personas', async (original) => ({
  ...(await original<typeof import('@/lib/sport/explorar/personas')>()),
  leerCabeceras: async (_db: unknown, ids: string[]) => new Map(ids.map((id) => [id, { id, anioNacimiento: llamadas.anio }])),
}));

const { crearCachesPerfil } = await import('@/lib/sport/explorar/perfil-cache');
const { contextoPerfilPublico } = await import('@/lib/sport/explorar/perfil-cache-real');

function entorno() {
  const memoria = almacenMemoria();
  const cache = crearCache({
    almacen: () => memoria,
    versiones: { de: async (deps: readonly Dependencia[]) => versionDe({ ledger: 7 }, deps), olvidar() {} },
    esperar: () => {},
  });
  return crearCachesPerfil({ cache, publico: (hoy) => ({ ...contextoPerfilPublico(hoy), db: crearContexto().ctx.db }) });
}

const cuenta = (profileId: string) => crearContexto({ perfil: perfil({ profileId, email: `${profileId}@example.test` }) }).ctx;

beforeEach(() => {
  Object.assign(llamadas, { ficha: 0, extras: 0, rivales: 0, relevos: 0, rendimiento: 0, quien: [], historial: 'ok', propia: null, anio: 2010 });
});

describe('perfil público en la caché compartida', () => {
  it('la cabecera se calcula una vez, sin la cuenta de nadie, y la sirve a otra cuenta', async () => {
    const c = entorno();
    const a = await c.cargarCabeceraPerfil(cuenta('cuenta-a'), UUID_A);
    const b = await c.cargarCabeceraPerfil(cuenta('cuenta-b'), UUID_A);
    expect(llamadas.ficha).toBe(1);
    expect(llamadas.extras).toBe(1);
    // El cargador corre con el lector público, sin identidad.
    expect(llamadas.quien).toEqual(['']);
    expect(b).toEqual(a);
    expect(buscarDatoDeCuenta(b)).toBeNull();
    expect(JSON.stringify(b)).not.toMatch(/cuenta-a|cuenta-b|example\.test/);
  });

  it('sin sesión no lee nada', async () => {
    const c = entorno();
    const r = await c.cargarCabeceraPerfil(crearContexto({ perfil: null }).ctx, UUID_A);
    expect(r.vista.tipo).toBe('sin_sesion');
    expect(llamadas.ficha).toBe(0);
    expect(await c.cargarRivalesCompartidos(crearContexto({ perfil: null }).ctx, UUID_A)).toMatchObject({ datos: { nombre: null } });
    expect(llamadas.rivales).toBe(0);
  });

  it('un identificador que no es persona no entra en la caché', async () => {
    const r = await entorno().cargarCabeceraPerfil(cuenta('cuenta-a'), 'no-es-un-uuid');
    expect(r.vista.tipo).toBe('entrada_invalida');
    expect(llamadas.ficha).toBe(0);
  });

  it('la ficha propia se marca en la petición y recupera el año; la guardada sigue siendo la de todos', async () => {
    llamadas.propia = UUID_A;
    const c = entorno();
    const mia = await c.cargarCabeceraPerfil(cuenta('cuenta-a'), UUID_A);
    expect(mia.vista).toMatchObject({ tipo: 'ok', ficha: { esPropia: true, anioNacimiento: 2010 } });
    const ajena = await c.cargarCabeceraPerfil(cuenta('cuenta-b'), UUID_A);
    expect(ajena.vista).toMatchObject({ tipo: 'ok', ficha: { esPropia: false, anioNacimiento: null } });
    expect(llamadas.ficha).toBe(1);
  });

  it('una cabecera con el historial fallido se sirve, pero no se guarda', async () => {
    llamadas.historial = 'error';
    const c = entorno();
    await c.cargarCabeceraPerfil(cuenta('cuenta-a'), UUID_A);
    await c.cargarCabeceraPerfil(cuenta('cuenta-a'), UUID_A);
    expect(llamadas.ficha).toBe(2);
  });

  it('rivales y relevos van en la misma entrada; una lista fallida no se guarda', async () => {
    const c = entorno();
    await c.cargarRivalesCompartidos(cuenta('cuenta-a'), UUID_A);
    await c.cargarRivalesCompartidos(cuenta('cuenta-b'), UUID_A);
    expect(llamadas.rivales).toBe(1);
    expect(llamadas.relevos).toBe(1);
    await c.cargarRivalesCompartidos(cuenta('cuenta-a'), UUID_B);
    await c.cargarRivalesCompartidos(cuenta('cuenta-a'), UUID_B);
    expect(llamadas.rivales).toBe(3);
  });

  it('cada sección tiene su entrada: abrir Estadísticas no calcula Rivales', async () => {
    const c = entorno();
    await c.cargarRendimientoCompartido(cuenta('cuenta-a'), UUID_A);
    await c.cargarRendimientoCompartido(cuenta('cuenta-b'), UUID_A);
    expect(llamadas.rendimiento).toBe(1);
    expect(llamadas.rivales).toBe(0);
  });
});
