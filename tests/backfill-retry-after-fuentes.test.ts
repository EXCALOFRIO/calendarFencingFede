import { afterEach, describe, expect, it, vi } from 'vitest';
import { clasificarFalloTecnico } from '@/lib/ingest/backfill/orquestador';
import { fetchText } from '@/lib/ingest/fetcher';
import { leerTorneoEngarde, type DepsEngarde } from '@/lib/ingest/sources/engarde';
import { leerResultadosFww } from '@/lib/ingest/sources/fww';

afterEach(() => vi.unstubAllGlobals());

describe('Retry-After real hasta el clasificador del orquestador', () => {
  it('fetchText conserva el Retry-After de un 429 en el mensaje que se persiste', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '7' } })),
    );
    const error = await fetchText('https://fie.org/api/x', { retries: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(clasificarFalloTecnico(error)).toEqual({ status: 429, retryAfterMs: 7000 });
  });

  it('un Retry-After desmesurado se acota; una fecha pasada vale cero', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503, headers: { 'retry-after': '86400' } })));
    const largo = await fetchText('https://fie.org/api/x', { retries: 0 }).catch((e: unknown) => e);
    expect(clasificarFalloTecnico(largo)?.retryAfterMs).toBe(10 * 60_000);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT' } })),
    );
    const pasado = await fetchText('https://fie.org/api/x', { retries: 0 }).catch((e: unknown) => e);
    expect(clasificarFalloTecnico(pasado)).toEqual({ status: 429, retryAfterMs: 0 });
  });

  it('sin cabecera no inventa una espera', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    const e = await fetchText('https://fie.org/api/x', { retries: 0 }).catch((x: unknown) => x);
    expect(clasificarFalloTecnico(e)).toEqual({ status: 429, retryAfterMs: null });
  });

  it('el índice de Engarde con 429 expone el Retry-After de la respuesta', async () => {
    const deps: DepsEngarde = {
      get: async () => ({ status: 200, body: '' }),
      post: async () => ({ status: 429, body: '', retryAfterMs: 12_000 }),
    };
    const t = await leerTorneoEngarde('org', 'evt', deps);
    expect(t.estado).toBe('error');
    expect(clasificarFalloTecnico(new Error(t.error ?? ''))).toEqual({ status: 429, retryAfterMs: 12_000 });
  });

  it('FWW con 429 conserva el Retry-After y con 403 no es un fallo técnico', async () => {
    const url = 'https://www.fencingworldwide.com/en/123-2024/results/';
    const con = (status: number, retryAfterMs: number | null): DepsEngarde => ({
      get: async () => ({ status, body: '', retryAfterMs }),
      post: async () => ({ status: 200, body: '' }),
    });
    const r429 = await leerResultadosFww(url, con(429, 4000));
    expect(r429.estado).toBe('error');
    expect(clasificarFalloTecnico(new Error(r429.motivo ?? ''))).toEqual({ status: 429, retryAfterMs: 4000 });
    const r403 = await leerResultadosFww(url, con(403, null));
    expect(r403.estado).toBe('error');
    expect(clasificarFalloTecnico(new Error(r403.motivo ?? ''))).toBeNull();
  });
});
