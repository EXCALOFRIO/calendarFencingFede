import { describe, expect, it } from 'vitest';
import {
  ErrorPresupuestoAgotado,
  PresupuestoHttp,
  conPresupuesto,
  esPresupuestoAgotado,
  motivoDePresupuesto,
} from '@/lib/ingest/backfill/presupuesto-http';
import { crearRedPresupuestada, type BaseRedBackfill } from '@/lib/ingest/backfill/red-presupuestada';
import {
  clasificarFalloTecnico,
  ejecutarLote,
  type EntradaLote,
  type ResultadoTarea,
  type Tarea,
} from '@/lib/ingest/backfill/orquestador';
import { ErrorHttp, parsearRetryAfter, retryAfterDeTexto, RETRY_AFTER_MAX_MS } from '@/lib/ingest/http-retry';

const tarea = (n: number): Tarea => ({
  clave: `fie|2024|${n}`,
  tipo: 'fie_prueba',
  fuente: 'fie',
  season: '2024',
  competitionKey: String(n),
  motivo: 'nunca_leido',
  releer: false,
  estimacion: { puestos: 100, asaltos: 0, documentos: 0, unidades: 1 },
});

function reloj(inicio = 0) {
  let t = inicio;
  return { ahora: () => t, avanzar: (ms: number) => void (t += ms) };
}

describe('PresupuestoHttp: reserva antes de cada petición real', () => {
  it('con máximo 1 deja pasar una petición y niega la segunda sin contarla', () => {
    const r = reloj();
    const p = new PresupuestoHttp({ maxPeticiones: 1, maxMs: 60_000, ahora: r.ahora });
    p.reservar();
    expect(() => p.reservar()).toThrow(ErrorPresupuestoAgotado);
    expect(p.usadas).toBe(1);
    expect(p.negado).toBe('limite_peticiones');
  });

  it('niega por tiempo cuando el reloj alcanza el límite', () => {
    const r = reloj();
    const p = new PresupuestoHttp({ maxPeticiones: 100, maxMs: 1000, ahora: r.ahora });
    r.avanzar(1000);
    expect(() => p.reservar()).toThrow(/limite_tiempo/);
    expect(p.usadas).toBe(0);
  });

  it('no duerme una espera que no cabe en el tiempo restante', async () => {
    const r = reloj();
    const p = new PresupuestoHttp({ maxPeticiones: 100, maxMs: 1000, ahora: r.ahora });
    const dormidas: number[] = [];
    await p.esperar(200, async (ms) => void dormidas.push(ms));
    expect(dormidas).toEqual([200]);
    await expect(p.esperar(1500, async (ms) => void dormidas.push(ms))).rejects.toBeInstanceOf(ErrorPresupuestoAgotado);
    expect(dormidas).toEqual([200]);
  });

  it('reconoce el motivo en el texto de un error persistido', () => {
    const e = new ErrorPresupuestoAgotado('limite_peticiones');
    expect(esPresupuestoAgotado(e)).toBe(true);
    expect(motivoDePresupuesto(e.message)).toBe('limite_peticiones');
    expect(motivoDePresupuesto('HTTP 500')).toBeNull();
  });

  it('conPresupuesto no llama a la función cuando no hay margen', async () => {
    const p = new PresupuestoHttp({ maxPeticiones: 1, maxMs: 1000, ahora: () => 0 });
    let llamadas = 0;
    const f = conPresupuesto(p, async () => ++llamadas);
    await f();
    await expect(f()).rejects.toBeInstanceOf(ErrorPresupuestoAgotado);
    expect(llamadas).toBe(1);
  });
});

describe('crearRedPresupuestada: todos los puntos de entrada comparten un solo presupuesto', () => {
  function base(contador: { n: number }): BaseRedBackfill {
    const hit = async <T>(v: T) => {
      contador.n += 1;
      return v;
    };
    return {
      fetchJson: () => hit({}),
      skermoIndice: () => hit('<html/>') as never,
      skermoTemporadas: (async () => []) as never,
      skermoParsear: (() => []) as never,
      skermoHtml: () => hit('<html/>'),
      engarde: { get: () => hit('') as never, post: () => hit('') as never },
      bytesPdf: () => hit(new Uint8Array()),
    };
  }

  it('--max-peticiones 1: una petición pasa y metadata, ranking, pools, índice, Engarde y PDF quedan cortados', async () => {
    const contador = { n: 0 };
    const p = new PresupuestoHttp({ maxPeticiones: 1, maxMs: 60_000, ahora: () => 0 });
    const red = crearRedPresupuestada(p, async () => {}, base(contador));

    await red.fie.fetchJson('https://fie/metadata');
    const cortadas = [
      () => red.fie.fetchJson('https://fie/ranking'),
      () => red.fie.fetchJson('https://fie/pools'),
      () => red.inventarioFie.json('https://fie/competitions'),
      () => red.inventarioSkermo.indice('https://skermo/idx' as never),
      () => red.lecturaSkermo.html('https://skermo/torneo'),
      () => red.engarde.get('https://engarde/x'),
      () => red.engarde.post('https://engarde/x', {}),
      () => red.pdf.bytes('https://rfee/doc.pdf'),
    ];
    for (const llamar of cortadas) await expect(llamar()).rejects.toBeInstanceOf(ErrorPresupuestoAgotado);
    expect(contador.n).toBe(1);
    expect(p.usadas).toBe(1);
  });

  it('la espera entre lecturas del índice y de Engarde se niega si ya no cabe en el tiempo', async () => {
    const r = reloj();
    const p = new PresupuestoHttp({ maxPeticiones: 50, maxMs: 1000, ahora: r.ahora });
    const dormidas: number[] = [];
    const red = crearRedPresupuestada(p, async (ms) => void dormidas.push(ms), base({ n: 0 }));
    await expect(red.inventarioFie.esperar?.(5000)).rejects.toBeInstanceOf(ErrorPresupuestoAgotado);
    await expect(red.engarde.esperar?.(5000)).rejects.toBeInstanceOf(ErrorPresupuestoAgotado);
    expect(dormidas).toEqual([]);
  });
});

describe('Retry-After real y acotado', () => {
  it('lee segundos y fecha HTTP, y acota a un tope', () => {
    expect(parsearRetryAfter('12')).toBe(12_000);
    expect(parsearRetryAfter('99999')).toBe(RETRY_AFTER_MAX_MS);
    expect(parsearRetryAfter('basura')).toBeNull();
    expect(parsearRetryAfter(new Date(10_000).toUTCString(), 4000)).toBe(6000);
  });

  it('el valor viaja en el mensaje y el clasificador lo recupera', () => {
    expect(retryAfterDeTexto('HTTP 429 (Retry-After: 7s)')).toBe(7000);
    expect(clasificarFalloTecnico(new Error('HTTP 429 (Retry-After: 7s)'))).toEqual({ status: 429, retryAfterMs: 7000 });
    expect(clasificarFalloTecnico(new Error('HTTP 503'))).toEqual({ status: 503, retryAfterMs: null });
    expect(clasificarFalloTecnico(new Error('HTTP 403'))).toBeNull();
  });

  it('ErrorHttp conserva status y Retry-After para el orquestador', () => {
    const e = new ErrorHttp('HTTP 429', 429, 3000);
    expect(clasificarFalloTecnico(e)).toEqual({ status: 429, retryAfterMs: 3000 });
  });
});

function entrada(over: Partial<EntradaLote> & Pick<EntradaLote, 'tareas' | 'ejecutar'>) {
  const dormidas: number[] = [];
  const e: EntradaLote = {
    limites: { maxTareas: 50, maxPeticiones: 500, maxMs: 60_000, maxReintentos: 3, esperaBaseMs: 100, esperaMaxMs: 10_000 },
    aplicar: true,
    ahora: () => 0,
    dormir: async (ms) => void dormidas.push(ms),
    ...over,
  };
  return { e, dormidas };
}

describe('ejecutarLote con presupuesto compartido', () => {
  it('espera el Retry-After real (acotado por esperaMaxMs) en lugar del backoff fijo', async () => {
    const intentos: number[] = [];
    const { e, dormidas } = entrada({
      tareas: [tarea(1)],
      limites: { maxTareas: 5, maxPeticiones: 500, maxMs: 600_000, maxReintentos: 2, esperaBaseMs: 100, esperaMaxMs: 5000 },
      ejecutar: async () => {
        intentos.push(1);
        if (intentos.length === 1) return { estado: 'error', peticiones: 1, mensaje: 'HTTP 429', tecnico: { status: 429, retryAfterMs: 4000 } };
        if (intentos.length === 2) return { estado: 'error', peticiones: 1, mensaje: 'HTTP 429', tecnico: { status: 429, retryAfterMs: 90_000 } };
        return { estado: 'completo', peticiones: 1 };
      },
    });
    const informe = await ejecutarLote(e);
    expect(dormidas).toEqual([100 * 0 + 4000, 5000]);
    expect(informe.ejecutadas[0].resultado.estado).toBe('completo');
  });

  it('no duerme ni reintenta si la espera pedida por la fuente no cabe en el tiempo del lote', async () => {
    const r = reloj();
    const presupuesto = new PresupuestoHttp({ maxPeticiones: 100, maxMs: 2000, ahora: r.ahora });
    let llamadas = 0;
    const { e, dormidas } = entrada({
      tareas: [tarea(1), tarea(2)],
      ahora: r.ahora,
      presupuesto,
      limites: { maxTareas: 5, maxPeticiones: 100, maxMs: 2000, maxReintentos: 2, esperaBaseMs: 100, esperaMaxMs: 30_000 },
      ejecutar: async () => {
        llamadas += 1;
        presupuesto.reservar();
        return { estado: 'error', peticiones: 1, mensaje: 'HTTP 429', tecnico: { status: 429, retryAfterMs: 20_000 } };
      },
    });
    const informe = await ejecutarLote(e);
    expect(dormidas).toEqual([]);
    expect(llamadas).toBe(1);
    expect(informe.parada).toBe('limite_tiempo');
    expect(informe.pendientes.map((t) => t.clave)).toEqual(['fie|2024|2']);
    expect(informe.ejecutadas[0].resultado.mensaje).toMatch(/reintento omitido/);
  });

  it('una tarea cortada a mitad por el presupuesto queda pendiente y detiene el lote con su motivo', async () => {
    const presupuesto = new PresupuestoHttp({ maxPeticiones: 1, maxMs: 60_000, ahora: () => 0 });
    const { e } = entrada({
      tareas: [tarea(1), tarea(2)],
      presupuesto,
      ejecutar: async (t): Promise<ResultadoTarea> => {
        presupuesto.reservar();
        presupuesto.reservar(); // la segunda GET del torneo ya no cabe
        return { estado: 'completo', peticiones: 2, mensaje: t.clave };
      },
    });
    const informe = await ejecutarLote(e);
    expect(informe.parada).toBe('limite_peticiones');
    expect(informe.peticiones).toBe(1);
    expect(informe.ejecutadas[0].resultado.estado).toBe('pendiente');
    expect(informe.porEstado.completo).toBeUndefined();
  });

  it('el límite de peticiones cuenta las reservadas de verdad, no las que informa la tarea', async () => {
    const presupuesto = new PresupuestoHttp({ maxPeticiones: 3, maxMs: 60_000, ahora: () => 0 });
    const { e } = entrada({
      tareas: [tarea(1), tarea(2), tarea(3)],
      presupuesto,
      limites: { maxTareas: 10, maxPeticiones: 3, maxMs: 60_000, maxReintentos: 0, esperaBaseMs: 1, esperaMaxMs: 1 },
      ejecutar: async () => {
        presupuesto.reservar();
        presupuesto.reservar();
        return { estado: 'completo', peticiones: 0 };
      },
    });
    const informe = await ejecutarLote(e);
    expect(informe.peticiones).toBeLessThanOrEqual(3);
    expect(informe.pendientes.length).toBeGreaterThan(0);
  });
});
