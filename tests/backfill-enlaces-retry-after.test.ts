import { describe, expect, it } from 'vitest';
import { crearEjecutor } from '@/lib/ingest/backfill/ejecutores';
import { ejecutarLote, type Tarea } from '@/lib/ingest/backfill/orquestador';
import { descubrirEnlacesFie } from '@/lib/ingest/enlaces-resultados';

/** El Retry-After de la ficha JSON de la FIE llega hasta el resultado técnico y la espera del reintento. */

const tarea: Tarea = {
  clave: 'enlaces_fie|2024|1',
  tipo: 'enlaces_fie',
  fuente: 'enlaces_fie',
  season: '2024',
  competitionKey: '1',
  motivo: 'nunca_leido',
  releer: false,
  estimacion: { puestos: 0, asaltos: 0, documentos: 0, unidades: 1 },
};

const respuesta = (status: number, retryAfterMs: number | null = null) => ({ status, body: '', retryAfterMs });

function ejecutorCon(get: (url: string) => Promise<{ status: number; body: string; retryAfterMs?: number | null }>) {
  return crearEjecutor({
    fie: {} as never,
    enlaces: {
      descubrir: (season, competitionId) => descubrirEnlacesFie({ get, post: async () => respuesta(200) }, season, competitionId),
      persistencia: { esquema: async () => ({ identidad: true, referencias: true }), upsertCobertura: async () => {} },
    },
  });
}

describe('enlaces FIE: Retry-After de la ficha JSON', () => {
  it('un 429 con Retry-After sube como fallo técnico con esa espera y la deja en el mensaje', async () => {
    const ejecutar = ejecutorCon(async (url) => (url.includes('/api/fie/') ? respuesta(429, 45_000) : respuesta(500)));
    const r = await ejecutar(tarea);
    expect(r.estado).toBe('error');
    expect(r.tecnico).toEqual({ status: 429, retryAfterMs: 45_000 });
    expect(r.mensaje).toMatch(/429/);
    expect(r.mensaje).toMatch(/Retry-After: 45s/);
  });

  it('un 503 sin Retry-After conserva status y deja la espera en null (sin inventar una por defecto)', async () => {
    const ejecutar = ejecutorCon(async (url) => (url.includes('/api/fie/') ? respuesta(503) : respuesta(200)));
    const r = await ejecutar(tarea);
    expect(r.tecnico).toEqual({ status: 503, retryAfterMs: null });
  });

  it('el reintento del lote espera lo que dijo la fuente, no la espera exponencial por defecto', async () => {
    let llamadas = 0;
    const ejecutar = ejecutorCon(async (url) => {
      if (!url.includes('/api/fie/')) return respuesta(200);
      llamadas += 1;
      return llamadas === 1 ? respuesta(429, 7_000) : respuesta(404);
    });
    const dormidas: number[] = [];
    await ejecutarLote({
      tareas: [tarea],
      ejecutar: ejecutar,
      limites: { maxTareas: 5, maxPeticiones: 100, maxMs: 60_000, maxReintentos: 2, esperaBaseMs: 100, esperaMaxMs: 30_000 },
      aplicar: true,
      ahora: () => 0,
      dormir: async (ms) => {
        dormidas.push(ms);
      },
    });
    expect(dormidas).toEqual([7_000]);
  });
});
