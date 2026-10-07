import { afterEach, describe, expect, it, vi } from 'vitest';

const vacio = {
  ok: true, status: 'deshabilitado', filas: 0, bytesLedger: 0, peticiones: 0, eventos: 0,
  unidades: { procesadas: 0, escritas: 0, sinCambios: 0, esperando: 0, revision: 0, errores: 0, descubiertas: 0 },
  ia: { llamadas: 0, neuronas: 0, aceptadas: 0 }, detalle: [],
};
const run = vi.hoisted(() => vi.fn(async () => vacio));
vi.mock('@/lib/ingest/resultados-auto/runtime', () => ({ runResultadosAuto: run }));
import { GET, maxDuration } from '@/app/api/cron/resultados/route';
import { runResultadosAuto } from '../src/lib/ingest/resultados-auto/runtime';

afterEach(() => { vi.unstubAllEnvs(); run.mockClear(); });

describe('ruta del cron de resultados automáticos', () => {
  it('sin secreto no ejecuta nada', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(new Request('https://example.test/api/cron/resultados'))).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });
  it('rechaza una autorización ausente o equivocada', async () => {
    vi.stubEnv('CRON_SECRET', 'secreto-de-prueba');
    const r = await GET(new Request('https://example.test/api/cron/resultados', { headers: { authorization: 'Bearer otro' } }));
    expect(r.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  it('devuelve el resumen y cabe en el límite del Worker', async () => {
    vi.stubEnv('CRON_SECRET', 'secreto-de-prueba');
    const r = await GET(new Request('https://example.test/api/cron/resultados', { headers: { authorization: 'Bearer secreto-de-prueba' } }));
    expect(await r.json()).toEqual(vacio);
    expect(run).toHaveBeenCalledOnce();
    expect(maxDuration).toBe(60);
  });
});

describe('arranque', () => {
  it('apagado por defecto: no importa la base ni pide nada', async () => {
    const { runResultadosAuto: real } = await vi.importActual<typeof import('../src/lib/ingest/resultados-auto/runtime')>(
      '../src/lib/ingest/resultados-auto/runtime');
    vi.stubEnv('RESULTADOS_AUTO_ENABLED', '');
    expect(await real()).toMatchObject({ ok: true, status: 'deshabilitado' });
    expect(runResultadosAuto).toBe(run);
  });
});
