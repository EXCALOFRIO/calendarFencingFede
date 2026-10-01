import { describe, expect, it } from 'vitest';
import { MIB, UMBRAL_CONSERVADOR_BYTES, type Ocupacion } from '@/lib/ingest/backfill/capacidad';
import {
  ErrorTecnico,
  clasificarFalloTecnico,
  ejecutarLote,
  esperaDeReintento,
  planificarLote,
  type EntradaLote,
  type ResultadoTarea,
  type Tarea,
} from '@/lib/ingest/backfill/orquestador';

const tarea = (n: number, extra: Partial<Tarea> = {}): Tarea => ({
  clave: `fie|2024|${n}`,
  tipo: 'fie_prueba',
  fuente: 'fie',
  season: '2024',
  competitionKey: String(n),
  motivo: 'nunca_leido',
  releer: false,
  estimacion: { puestos: 100, asaltos: 0, documentos: 0, unidades: 1 },
  ...extra,
});

const ocupacion = (logicoBytes: number): Ocupacion => ({
  medidoEn: '2025-01-01T00:00:00.000Z',
  logicoBytes,
  baseDatosBytes: null,
  tablas: [{ tabla: 'sport_result', tablaBytes: logicoBytes / 2, indicesBytes: logicoBytes / 2, totalBytes: logicoBytes, filas: 10 }],
  conteos: { personas: 0, pruebas: 0, puestos: 10, asaltos: 0, documentos: 0, coberturas: 0 },
});

const ok = (extra: Partial<ResultadoTarea> = {}): ResultadoTarea => ({ estado: 'completo', peticiones: 1, ...extra });

function entrada(over: Partial<EntradaLote> & Pick<EntradaLote, 'tareas' | 'ejecutar'>): EntradaLote {
  const dormidas: number[] = [];
  return {
    limites: { maxTareas: 50, maxPeticiones: 500, maxMs: 60_000, maxReintentos: 2, esperaBaseMs: 100, esperaMaxMs: 10_000 },
    aplicar: true,
    ahora: () => 0,
    dormir: async (ms) => {
      dormidas.push(ms);
    },
    ...over,
    // expuesto para las aserciones
    ...({ dormidas } as object),
  } as EntradaLote;
}

describe('planificarLote: una sola tarea por clave', () => {
  it('descarta duplicados de la misma clave y los informa', () => {
    const r = planificarLote([tarea(1), tarea(2), tarea(1, { motivo: 'releer', releer: true })]);
    expect(r.tareas.map((t) => t.clave)).toEqual(['fie|2024|1', 'fie|2024|2']);
    expect(r.duplicadas).toEqual(['fie|2024|1']);
  });

  it('conserva la tarea más específica al repetir clave: continuar gana a releer', () => {
    const r = planificarLote([tarea(1, { motivo: 'releer', releer: true }), tarea(1, { motivo: 'continuar' })]);
    expect(r.tareas).toHaveLength(1);
    expect(r.tareas[0].motivo).toBe('continuar');
  });
});

describe('ejecutarLote: secuencia y límites', () => {
  it('ejecuta de una en una: nunca dos tareas a la vez', async () => {
    let activas = 0;
    let maxActivas = 0;
    const r = await ejecutarLote(
      entrada({
        tareas: [tarea(1), tarea(2), tarea(3)],
        ejecutar: async () => {
          activas += 1;
          maxActivas = Math.max(maxActivas, activas);
          await new Promise((res) => setTimeout(res, 2));
          activas -= 1;
          return ok();
        },
      }),
    );
    expect(maxActivas).toBe(1);
    expect(r.ejecutadas).toHaveLength(3);
    expect(r.parada).toBeNull();
  });

  it('respeta maxTareas y deja el resto pendiente, sin descartarlo', async () => {
    const r = await ejecutarLote(
      entrada({
        tareas: [tarea(1), tarea(2), tarea(3)],
        limites: { maxTareas: 2, maxPeticiones: 100, maxMs: 1000, maxReintentos: 1, esperaBaseMs: 1, esperaMaxMs: 10 },
        ejecutar: async () => ok(),
      }),
    );
    expect(r.ejecutadas.map((e) => e.tarea.clave)).toEqual(['fie|2024|1', 'fie|2024|2']);
    expect(r.pendientes.map((t) => t.clave)).toEqual(['fie|2024|3']);
    expect(r.parada).toBe('limite_tareas');
  });

  it('respeta maxPeticiones: no empieza una tarea con el presupuesto agotado', async () => {
    const r = await ejecutarLote(
      entrada({
        tareas: [tarea(1), tarea(2), tarea(3)],
        limites: { maxTareas: 10, maxPeticiones: 5, maxMs: 1000, maxReintentos: 1, esperaBaseMs: 1, esperaMaxMs: 10 },
        ejecutar: async () => ok({ peticiones: 3 }),
      }),
    );
    expect(r.ejecutadas).toHaveLength(2);
    expect(r.peticiones).toBe(6);
    expect(r.pendientes).toHaveLength(1);
    expect(r.parada).toBe('limite_peticiones');
  });

  it('respeta maxMs con el reloj inyectado', async () => {
    let t = 0;
    const r = await ejecutarLote(
      entrada({
        tareas: [tarea(1), tarea(2)],
        ahora: () => t,
        limites: { maxTareas: 10, maxPeticiones: 100, maxMs: 1000, maxReintentos: 1, esperaBaseMs: 1, esperaMaxMs: 10 },
        ejecutar: async () => {
          t += 1500;
          return ok();
        },
      }),
    );
    expect(r.ejecutadas).toHaveLength(1);
    expect(r.parada).toBe('limite_tiempo');
    expect(r.pendientes).toHaveLength(1);
  });

  it('simulación (aplicar=false): no ejecuta nada, informa el plan y la decisión de capacidad', async () => {
    let llamadas = 0;
    const r = await ejecutarLote(
      entrada({
        aplicar: false,
        tareas: [tarea(1), tarea(2)],
        capacidad: { plan: { tipo: 'desconocido' }, medir: async () => ocupacion(30 * MIB) },
        ejecutar: async () => {
          llamadas += 1;
          return ok();
        },
      }),
    );
    expect(llamadas).toBe(0);
    expect(r.modo).toBe('simulacion');
    expect(r.ejecutadas).toHaveLength(0);
    expect(r.pendientes).toHaveLength(2);
    expect(r.capacidad?.decision.continuar).toBe(true);
    expect(r.capacidad?.decision.planConfirmado).toBe(false);
    expect(r.proyectadoBytes).toBeGreaterThan(0);
  });
});

describe('ejecutarLote: reintentos técnicos', () => {
  it('429 y luego éxito: espera con Retry-After, cuenta las peticiones y no pierde la tarea', async () => {
    let intentos = 0;
    const e = entrada({
      tareas: [tarea(1)],
      ejecutar: async () => {
        intentos += 1;
        if (intentos === 1) throw new ErrorTecnico('límite', 429, 2500);
        return ok({ peticiones: 2 });
      },
    });
    const r = await ejecutarLote(e);
    expect((e as unknown as { dormidas: number[] }).dormidas).toEqual([2500]);
    expect(r.ejecutadas[0].resultado.estado).toBe('completo');
    expect(r.ejecutadas[0].reintentos).toBe(1);
    expect(r.parada).toBeNull();
  });

  it('429 persistente: error reanudable, el lote se detiene y el resto queda pendiente', async () => {
    const r = await ejecutarLote(
      entrada({
        tareas: [tarea(1), tarea(2), tarea(3)],
        ejecutar: async () => {
          throw new ErrorTecnico('límite', 429, null);
        },
      }),
    );
    expect(r.ejecutadas).toHaveLength(1);
    expect(r.ejecutadas[0].resultado.estado).toBe('error');
    expect(r.ejecutadas[0].resultado.tecnico?.status).toBe(429);
    expect(r.ejecutadas[0].reintentos).toBe(2);
    expect(r.parada).toBe('limite_remoto');
    expect(r.pendientes.map((t) => t.clave)).toEqual(['fie|2024|2', 'fie|2024|3']);
  });

  it('5xx persistente: la tarea queda en error (no vacía) y el lote sigue hasta tres fallos seguidos', async () => {
    const r = await ejecutarLote(
      entrada({
        tareas: [tarea(1), tarea(2), tarea(3), tarea(4)],
        ejecutar: async () => {
          throw new ErrorTecnico('caído', 503, null);
        },
      }),
    );
    expect(r.ejecutadas).toHaveLength(3);
    expect(r.ejecutadas.every((e) => e.resultado.estado === 'error')).toBe(true);
    expect(r.ejecutadas.some((e) => e.resultado.estado === ('sin_resultados' as string))).toBe(false);
    expect(r.parada).toBe('fallos_seguidos');
    expect(r.pendientes).toHaveLength(1);
  });

  it('un error no técnico se anota en esa tarea y el lote continúa', async () => {
    let n = 0;
    const r = await ejecutarLote(
      entrada({
        tareas: [tarea(1), tarea(2)],
        ejecutar: async () => {
          n += 1;
          if (n === 1) throw new Error('JSON inválido');
          return ok();
        },
      }),
    );
    expect(r.ejecutadas[0].resultado.estado).toBe('error');
    expect(r.ejecutadas[0].resultado.mensaje).toContain('JSON inválido');
    expect(r.ejecutadas[1].resultado.estado).toBe('completo');
  });

  it('esquema_no_aplicado detiene el lote entero sin tocar más tareas', async () => {
    const r = await ejecutarLote(
      entrada({
        tareas: [tarea(1), tarea(2)],
        ejecutar: async () => ({ estado: 'esquema_no_aplicado', peticiones: 0 }),
      }),
    );
    expect(r.parada).toBe('esquema_no_aplicado');
    expect(r.ejecutadas).toHaveLength(1);
    expect(r.pendientes).toHaveLength(1);
  });

  it('clasifica fallos: 429/5xx y red son técnicos, 404 o 400 no', () => {
    expect(clasificarFalloTecnico(new ErrorTecnico('x', 429, null))).toEqual({ status: 429, retryAfterMs: null });
    expect(clasificarFalloTecnico(new Error('HTTP 503 al pedir la FIE'))?.status).toBe(503);
    expect(clasificarFalloTecnico(new Error('fetch failed'))?.status).toBeNull();
    expect(clasificarFalloTecnico(new Error('HTTP 404 al pedir'))).toBeNull();
    expect(clasificarFalloTecnico(new Error('JSON inválido'))).toBeNull();
  });

  it('espera exponencial acotada, y Retry-After manda sin pasar del máximo', () => {
    const l = { esperaBaseMs: 100, esperaMaxMs: 1000 };
    expect(esperaDeReintento(0, null, l)).toBe(100);
    expect(esperaDeReintento(1, null, l)).toBe(200);
    expect(esperaDeReintento(5, null, l)).toBe(1000);
    expect(esperaDeReintento(0, 400, l)).toBe(400);
    expect(esperaDeReintento(0, 99_999, l)).toBe(1000);
  });
});

describe('ejecutarLote: capacidad', () => {
  it('mide antes y después y devuelve la diferencia por tabla', async () => {
    const medidas = [ocupacion(30 * MIB), ocupacion(31 * MIB)];
    const r = await ejecutarLote(
      entrada({
        tareas: [tarea(1)],
        capacidad: { plan: { tipo: 'desconocido' }, medir: async () => medidas.shift() as Ocupacion },
        ejecutar: async () => ok(),
      }),
    );
    expect(r.capacidad?.antes?.logicoBytes).toBe(30 * MIB);
    expect(r.capacidad?.despues?.logicoBytes).toBe(31 * MIB);
    expect(r.capacidad?.diferencia?.logicoDeltaBytes).toBe(MIB);
  });

  it('se detiene ANTES de la tarea cuyo crecimiento proyectado rebasa el umbral conservador', async () => {
    const casiLleno = UMBRAL_CONSERVADOR_BYTES - 50_000;
    let llamadas = 0;
    const r = await ejecutarLote(
      entrada({
        tareas: [tarea(1, { estimacion: { puestos: 1000, asaltos: 0, documentos: 0, unidades: 1 } }), tarea(2)],
        capacidad: { plan: { tipo: 'desconocido' }, medir: async () => ocupacion(casiLleno) },
        ejecutar: async () => {
          llamadas += 1;
          return ok();
        },
      }),
    );
    expect(llamadas).toBe(0);
    expect(r.parada).toBe('capacidad');
    expect(r.pendientes).toHaveLength(2);
    expect(r.capacidad?.decision.continuar).toBe(false);
    expect(r.capacidad?.decision.motivo).toBe('lote_rebasa_umbral');
    expect(r.capacidad?.decision.planConfirmado).toBe(false);
    expect(r.capacidad?.decision.mensaje).toContain('No se ha contratado ni migrado nada');
  });

  it('remide entre tareas: si la primera deja la base junto al umbral, la segunda no empieza', async () => {
    const medidas = [ocupacion(UMBRAL_CONSERVADOR_BYTES - 10 * MIB), ocupacion(UMBRAL_CONSERVADOR_BYTES - 1000), ocupacion(UMBRAL_CONSERVADOR_BYTES - 1000)];
    let llamadas = 0;
    const r = await ejecutarLote(
      entrada({
        tareas: [tarea(1), tarea(2)],
        capacidad: { plan: { tipo: 'desconocido' }, medir: async () => medidas.shift() ?? ocupacion(UMBRAL_CONSERVADOR_BYTES - 1000) },
        ejecutar: async () => {
          llamadas += 1;
          return ok();
        },
      }),
    );
    expect(llamadas).toBe(1);
    expect(r.parada).toBe('capacidad');
    expect(r.pendientes.map((t) => t.clave)).toEqual(['fie|2024|2']);
  });

  it('sin medición posible no continúa ni aplica', async () => {
    const r = await ejecutarLote(
      entrada({
        tareas: [tarea(1)],
        capacidad: {
          plan: { tipo: 'desconocido' },
          medir: async () => {
            throw new Error('sin conexión');
          },
        },
        ejecutar: async () => ok(),
      }),
    );
    expect(r.parada).toBe('capacidad');
    expect(r.ejecutadas).toHaveLength(0);
    expect(r.capacidad?.decision.motivo).toBe('sin_medicion');
  });
});

describe('reanudación tras una interrupción', () => {
  it('dos ejecuciones cubren todas las tareas exactamente una vez, sin saltar ni repetir', async () => {
    const hechas = new Map<string, number>();
    const todas = [1, 2, 3, 4, 5].map((n) => tarea(n));
    const ejecutar = async (t: Tarea) => {
      hechas.set(t.clave, (hechas.get(t.clave) ?? 0) + 1);
      return ok();
    };
    const limites = { maxTareas: 3, maxPeticiones: 100, maxMs: 1000, maxReintentos: 1, esperaBaseMs: 1, esperaMaxMs: 10 };
    const primera = await ejecutarLote(entrada({ tareas: todas, ejecutar, limites }));
    expect(primera.pendientes).toHaveLength(2);
    const segunda = await ejecutarLote(entrada({ tareas: primera.pendientes, ejecutar, limites }));
    expect(segunda.pendientes).toHaveLength(0);
    expect([...hechas.keys()].sort()).toEqual(todas.map((t) => t.clave).sort());
    expect([...hechas.values()].every((n) => n === 1)).toBe(true);
  });
});
