import { describe, expect, it } from 'vitest';
import { crearEjecutor } from '@/lib/ingest/backfill/ejecutores';
import { ejecutarLote, type Tarea } from '@/lib/ingest/backfill/orquestador';
import { conPresupuesto, ErrorPresupuestoAgotado, PresupuestoHttp } from '@/lib/ingest/backfill/presupuesto-http';
import { descubrirEnlacesFie } from '@/lib/ingest/enlaces-resultados';

/**
 * Camino de enlaces FIE: la metadata JSON se pide una vez (la del probe) y la denegación del
 * presupuesto compartido sube como pendiente, no como «sin prueba oficial legible».
 */

const GUID = '0123456789abcdef0123456789abcdef';
const URL_META = 'https://fie.org/api/fie/competition/2024/1';
const URL_HTML = 'https://fie.org/competitions/2024/1';

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

type Respuesta = { status: number; body: string; retryAfterMs?: number | null };

const meta = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    competitionId: 1,
    season: 2024,
    name: 'Copa Prueba',
    type: 'I',
    category: 'S',
    location: 'Madrid',
    startDate: '2024-05-10',
    weapon: 'F',
    gender: 'M',
    ...extra,
  });

function ejecutorCon(get: (url: string) => Promise<Respuesta>) {
  return crearEjecutor({
    fie: {} as never,
    enlaces: {
      descubrir: (season, competitionId) =>
        descubrirEnlacesFie({ get, post: async () => ({ status: 200, body: '' }) }, season, competitionId),
      persistencia: { esquema: async () => ({ identidad: true, referencias: true }), upsertCobertura: async () => {} },
    },
  });
}

describe('enlaces FIE: la metadata JSON no se pide dos veces', () => {
  it('probe 200 seguido de 429 con Retry-After en una segunda lectura no se convierte en «sin cambios»', async () => {
    const pedidas: string[] = [];
    const ejecutar = ejecutorCon(async (url) => {
      pedidas.push(url);
      if (url === URL_META) {
        return pedidas.filter((u) => u === URL_META).length === 1
          ? { status: 200, body: meta({ livestreamResultsLink: `https://www.fencingtimelive.com/tournaments/eventSchedule/${GUID}` }) }
          : { status: 429, body: '', retryAfterMs: 45_000 };
      }
      return { status: 200, body: '' };
    });

    const r = await ejecutar(tarea);

    expect(pedidas.filter((u) => u === URL_META)).toHaveLength(1);
    expect(r.estado).toBe('completo');
    expect(r.estado).not.toBe('sin_cambios');
  });

  it('probe 200 seguido de 503 tampoco devuelve el estado anterior', async () => {
    let metadata = 0;
    const ejecutar = ejecutorCon(async (url) => {
      if (url === URL_HTML) return { status: 200, body: '' };
      metadata += 1;
      return metadata === 1 ? { status: 200, body: meta() } : { status: 503, body: '', retryAfterMs: 9_000 };
    });
    const r = await ejecutar(tarea);
    expect(metadata).toBe(1);
    expect(r.estado).toBe('completo');
  });

  it('un cuerpo 200 ilegible sigue siendo «sin prueba oficial legible», no un fallo técnico', async () => {
    const ejecutar = ejecutorCon(async (url) => (url === URL_META ? { status: 200, body: '<html>' } : { status: 200, body: '' }));
    const r = await ejecutar(tarea);
    expect(r.estado).toBe('sin_cambios');
    expect(r.tecnico).toBeUndefined();
  });
});

describe('enlaces FIE: presupuesto agotado en el lector', () => {
  const presupuestoDe = (maxPeticiones: number) => new PresupuestoHttp({ maxPeticiones, maxMs: 60_000, ahora: () => 0 });

  it('sin margen para la ficha HTML la denegación se propaga y el lote deja la unidad pendiente sin intento falso', async () => {
    const presupuesto = presupuestoDe(1);
    const get = conPresupuesto(presupuesto, async (url: string): Promise<Respuesta> =>
      url === URL_META ? { status: 200, body: meta() } : { status: 200, body: '' },
    );
    const ejecutar = ejecutorCon(get);

    await expect(ejecutar(tarea)).rejects.toBeInstanceOf(ErrorPresupuestoAgotado);

    const informe = await ejecutarLote({
      tareas: [tarea],
      ejecutar: ejecutorCon(conPresupuesto(presupuestoDe(1), async (url: string) => (url === URL_META ? { status: 200, body: meta() } : { status: 200, body: '' }))),
      limites: { maxTareas: 5, maxPeticiones: 100, maxMs: 60_000, maxReintentos: 2, esperaBaseMs: 100, esperaMaxMs: 30_000 },
      aplicar: true,
      ahora: () => 0,
      dormir: async () => {},
    });
    expect(informe.ejecutadas[0].resultado.estado).toBe('pendiente');
    expect(informe.ejecutadas[0].resultado.mensaje).toMatch(/Presupuesto del lote agotado/);
  });

  it('si se agota al verificar un enlace publicado no se guarda el enlace como «no comprobable» ni la unidad como completa', async () => {
    const presupuesto = presupuestoDe(2);
    const persistidas: unknown[] = [];
    const get = conPresupuesto(presupuesto, async (url: string): Promise<Respuesta> =>
      url === URL_META
        ? { status: 200, body: meta({ livestreamResultsLink: 'https://www.engarde-service.com/competition/org/evt/compe1' }) }
        : { status: 200, body: '' },
    );
    // El índice de Engarde se pide por POST: también pasa por el presupuesto compartido.
    const post = conPresupuesto(presupuesto, async (): Promise<Respuesta> => ({ status: 200, body: '' }));
    const ejecutar = crearEjecutor({
      fie: {} as never,
      enlaces: {
        descubrir: (season, competitionId) => descubrirEnlacesFie({ get, post }, season, competitionId),
        persistencia: {
          esquema: async () => ({ identidad: true, referencias: true }),
          upsertCobertura: async (f: unknown) => {
            persistidas.push(f);
          },
        },
      },
    });

    await expect(ejecutar(tarea)).rejects.toBeInstanceOf(ErrorPresupuestoAgotado);
    expect(persistidas).toHaveLength(0);
  });
});
