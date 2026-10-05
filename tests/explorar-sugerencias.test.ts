import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consultaSugerencias, ordenarSugerencias, puntuarSugerencia, type CandidatoSugerencia,
} from '@/lib/sport/explorar/sugerencias-modelo';
import { crearSolicitanteSugerencias, siguienteOpcion } from '@/lib/sport/explorar/sugerencias-cliente';
import { sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { crearContexto, perfil, UUID_A as A } from './helpers/explorar';
import { ERROR_VISTA_CADUCADA } from '@/lib/auth/read-only';

const dependencias = vi.hoisted(() => ({ contexto: vi.fn() }));
vi.mock('@/lib/sport/explorar/real', () => ({ contextoReal: dependencias.contexto }));
import { GET } from '@/app/api/explorar/sugerencias/route';

const candidato = (id = A, nombre = 'Carlos Llavador Fernández'): CandidatoSugerencia => ({
  id, nombre, nombreComparado: nombre, alias: null, pais: 'ESP', genero: 'M', anioNacimiento: 1998,
});
const respuesta = (items = [candidato()]) => Response.json({ estado: 'ok', items });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('sugerencias: normalización y navegación, nunca fusión', () => {
  it('normaliza guiones, acentos y signos sin admitir consultas triviales o enormes', () => {
    expect(consultaSugerencias('  LLÁVADOR, Cárlos-fernández ')).toBe('llavador carlos fernandez');
    expect(consultaSugerencias('a b')).toBeNull();
    expect(consultaSugerencias('---')).toBeNull();
    expect(consultaSugerencias('x'.repeat(81))).toBeNull();
    expect(consultaSugerencias('carlos a b c d e f g h')).toBeNull();
  });

  it('acepta nombres reordenados, prefijos y pequeñas erratas, pero no apellidos incompatibles', () => {
    for (const q of ['llavador carlos', 'carlos llavdor', 'yavador carlos', 'carl llav']) {
      expect(puntuarSugerencia(q, 'Carlos Llavador Fernández')).toBeGreaterThan(0.6);
    }
    expect(puntuarSugerencia('carlos martinez', 'Carlos Llavador Fernández')).toBe(0);
    expect(puntuarSugerencia('carlos carlos', 'Carlos Llavador Fernández')).toBe(0);
  });

  it('alias del mismo ID se deduplican, los homónimos de otros IDs no se fusionan y el DTO excluye privados', () => {
    const privado = { ...candidato(), email: 'privado@example.test', licencia: 'no-visible' };
    const r = ordenarSugerencias('carlos yavador', [
      privado,
      { ...candidato(), alias: 'Carlos Yavador', nombreComparado: 'Carlos Yavador' },
      { ...candidato('homonimo'), pais: 'FRA', anioNacimiento: 2001 },
    ]);
    expect(r).toHaveLength(2);
    expect(r.find((p) => p.id === A)?.alias).toBe('Carlos Yavador');
    expect(Object.keys(r[0]).sort()).toEqual(['id', 'nombre', 'alias', 'pais', 'genero', 'anioNacimiento'].sort());
    expect(ordenarSugerencias('carlos', Array.from({ length: 250 }, (_, i) => candidato(`id-${i}`)))).toHaveLength(8);
  });

  it('dentro del mismo parecido manda la popularidad; un nombre mucho más parecido sigue delante', () => {
    const c = (id: string, nombre: string, peso: number, seguida = false): CandidatoSugerencia => ({
      ...candidato(id, nombre), peso, seguida,
    });
    const r = ordenarSugerencias('zabala', [
      c('irene', 'Zabala Gutierrez Irene', 23),
      c('juan', 'Zabala Juan', 238),
      c('nerea', 'Zabalo Echaniz Nerea', 900),
      c('zavala', 'Zavala Svensson Daniel', 100),
      c('ander', 'Ezquerro Zabala Ander', 5),
    ], 20);
    // Zavala (0,92) comparte nivel con los exactos, que cuentan el doble; Zabalo (0,75) va en el nivel siguiente.
    expect(r.map((p) => p.id)).toEqual(['juan', 'zavala', 'irene', 'ander', 'nerea']);

    const seguidas = ordenarSugerencias('jorgensen', [
      c('patrick', 'Jorgensen Patrick', 360),
      c('magnus', 'Jorgensen Magnus', 11, true),
    ]);
    expect(seguidas.map((p) => p.id)).toEqual(['magnus', 'patrick']);
  });

  it('el límite social llega a 20 y nunca lo supera', () => {
    const muchos = Array.from({ length: 250 }, (_, i) => candidato(`id-${i}`));
    expect(ordenarSugerencias('carlos', muchos, 20)).toHaveLength(20);
    expect(ordenarSugerencias('carlos', muchos, 999)).toHaveLength(20);
  });

  it('exige sesión antes incluso de validar o consultar el catálogo', async () => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    await expect(sugerirPersonas(ctx, { q: 'carlos' })).rejects.toThrow('NO_AUTENTICADO');
    expect(sentencias).toEqual([]);
  });

  it('no trata un esquema ausente como una búsqueda sin coincidencias', async () => {
    const { ctx, sentencias } = crearContexto({ esquema: { identidad: false, referencias: false } });
    expect(await sugerirPersonas(ctx, { q: 'carlos' })).toEqual({ estado: 'no_disponible' });
    expect(sentencias).toEqual([]);
  });
});

describe('API de sugerencias: política de sesión y validación', () => {
  beforeEach(() => dependencias.contexto.mockReturnValue(crearContexto().ctx));
  const llamar = (query: string) => GET(new Request(`https://example.test/api/explorar/sugerencias${query}`));

  it('sin sesión o con acceso revocado devuelve 401 antes de validar entrada', async () => {
    const t = crearContexto({ perfil: null });
    dependencias.contexto.mockReturnValue(t.ctx);
    const r = await llamar('?q=abc&cuenta=ajena');
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ estado: 'no_autenticado' });
    expect(t.sentencias).toEqual([]);
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(r.headers.get('Vary')).toBe('Cookie');
  });

  it('vista previa expirada se rechaza y jamás busca otra identidad', async () => {
    const fallback = vi.fn();
    dependencias.contexto.mockReturnValue({
      ...crearContexto().ctx,
      perfil: async () => { throw Object.assign(new Error('caducada'), { digest: ERROR_VISTA_CADUCADA }); },
      fallback,
    });
    expect((await llamar('?q=carlos')).status).toBe(401);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('acepta un límite de 1 a 20 una sola vez', async () => {
    expect((await llamar('?q=carlos&limite=20')).status).toBe(200);
    expect((await llamar('?q=carlos&limite=1')).status).toBe(200);
  });

  it.each([
    '', '?q=carlos&q=otro', '?q=carlos&limite=999', '?q=carlos&limite=21', '?q=carlos&limite=0',
    '?q=carlos&limite=05', '?q=carlos&limite=8&limite=9', '?q=carlos&otro=1', `?q=${'x'.repeat(81)}`,
  ])(
    'rechaza parámetros inválidos sin SQL: %s', async (q) => {
      const t = crearContexto();
      dependencias.contexto.mockReturnValue(t.ctx);
      expect((await llamar(q)).status).toBe(400);
      expect(t.sentencias).toEqual([]);
    },
  );

  it('sesión normal, vista previa vigente y QA vigente pueden leer sin habilitar escrituras', async () => {
    for (const lectura of [{}, { preview: {} }, { qa: {} }]) {
      const sesion = vi.fn(async () => ({ ...perfil(), ...lectura }));
      dependencias.contexto.mockReturnValue({ ...crearContexto().ctx, perfil: sesion });
      const r = await llamar('?q=carlos');
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ estado: 'ok', items: [] });
      expect(sesion).toHaveBeenCalledTimes(1);
    }
  });

  it('un fallo interno devuelve una respuesta discreta y mantiene disponible la búsqueda manual', async () => {
    const ctx = crearContexto().ctx;
    dependencias.contexto.mockReturnValue({
      ...ctx, db: { execute: () => { throw new Error('detalle con nombre privado'); } },
    });
    const r = await llamar('?q=carlos');
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ estado: 'no_disponible' });
  });
});

describe('solicitante cliente: 250 ms, aborto, respuestas antiguas y caché acotada', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });

  it('espera 250 ms, reemplaza el temporizador y no solicita por una entrada insuficiente', async () => {
    const recibir = vi.fn();
    const fetcher = vi.fn(async (..._argumentos: Parameters<typeof fetch>) => respuesta());
    const cliente = crearSolicitanteSugerencias(recibir, fetcher);
    cliente.buscar('ca');
    await vi.advanceTimersByTimeAsync(300);
    expect(fetcher).not.toHaveBeenCalled();
    cliente.buscar('carlos');
    await vi.advanceTimersByTimeAsync(249);
    expect(fetcher).not.toHaveBeenCalled();
    cliente.buscar('llavador carlos');
    await vi.advanceTimersByTimeAsync(250);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/explorar/sugerencias?q=llavador%20carlos');
    expect(recibir.mock.calls.at(-1)?.[0].estado).toBe('ok');
  });

  it('aborta peticiones anteriores e ignora su respuesta aunque fetch no respete AbortSignal', async () => {
    const recibir = vi.fn();
    const pendientes: { resolver: (r: Response) => void; signal: AbortSignal | null | undefined }[] = [];
    const fetcher: typeof fetch = vi.fn((_url, init) => new Promise<Response>((resolver) => {
      pendientes.push({ resolver, signal: init?.signal });
    }));
    const cliente = crearSolicitanteSugerencias(recibir, fetcher);
    cliente.buscar('carlos');
    await vi.advanceTimersByTimeAsync(250);
    cliente.buscar('mateo');
    expect(pendientes[0].signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    pendientes[1].resolver(respuesta([candidato('nuevo', 'Mateo Rival')]));
    await vi.advanceTimersByTimeAsync(0);
    pendientes[0].resolver(respuesta([candidato('viejo')]));
    await vi.advanceTimersByTimeAsync(0);
    expect(recibir.mock.calls.at(-1)?.[0].items[0].id).toBe('nuevo');
    cliente.buscar('tercero');
    await vi.advanceTimersByTimeAsync(250);
    cliente.cancelar();
    const antes = recibir.mock.calls.length;
    pendientes[2].resolver(respuesta());
    await vi.advanceTimersByTimeAsync(0);
    expect(recibir).toHaveBeenCalledTimes(antes);
  });

  it('limita a ocho resultados, reutiliza hasta 60 s y desaloja después de 32 consultas', async () => {
    const recibir = vi.fn();
    const fetcher = vi.fn(async () => respuesta(Array.from({ length: 20 }, (_, i) => candidato(`id-${i}`))));
    const cliente = crearSolicitanteSugerencias(recibir, fetcher);
    cliente.buscar('carlos');
    await vi.advanceTimersByTimeAsync(250);
    expect(recibir.mock.calls.at(-1)?.[0].items).toHaveLength(8);
    cliente.buscar('carlos');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    cliente.buscar('carlos');
    await vi.advanceTimersByTimeAsync(250);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 32; i++) {
      cliente.buscar(`consulta ${i}`);
      await vi.advanceTimersByTimeAsync(250);
    }
    cliente.buscar('carlos');
    await vi.advanceTimersByTimeAsync(250);
    expect(fetcher).toHaveBeenCalledTimes(35);
  });

  it('el buscador social pide 20 perfiles con su propia espera', async () => {
    const recibir = vi.fn();
    const fetcher = vi.fn(async (..._argumentos: Parameters<typeof fetch>) =>
      respuesta(Array.from({ length: 20 }, (_, i) => candidato(`id-${i}`))));
    const cliente = crearSolicitanteSugerencias(recibir, fetcher, { limite: 20, espera: 160 });
    cliente.buscar('zabal');
    await vi.advanceTimersByTimeAsync(159);
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/explorar/sugerencias?q=zabal&limite=20');
    expect(recibir.mock.calls.at(-1)?.[0].items).toHaveLength(20);
  });

  it('un error no se almacena, no impide reintentar ni sustituye el envío manual', async () => {
    const recibir = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(respuesta());
    const cliente = crearSolicitanteSugerencias(recibir, fetcher);
    cliente.buscar('carlos');
    await vi.advanceTimersByTimeAsync(250);
    expect(recibir.mock.calls.at(-1)?.[0]).toEqual({ estado: 'error', items: [] });
    cliente.buscar('carlos');
    await vi.advanceTimersByTimeAsync(250);
    expect(recibir.mock.calls.at(-1)?.[0].estado).toBe('ok');
  });

  it('flechas recorren y envuelven opciones; sin opciones no activan nada', () => {
    expect(siguienteOpcion('ArrowDown', -1, 3)).toBe(0);
    expect(siguienteOpcion('ArrowDown', 2, 3)).toBe(0);
    expect(siguienteOpcion('ArrowUp', -1, 3)).toBe(2);
    expect(siguienteOpcion('ArrowUp', 0, 3)).toBe(2);
    expect(siguienteOpcion('ArrowDown', -1, 0)).toBe(-1);
  });
});
