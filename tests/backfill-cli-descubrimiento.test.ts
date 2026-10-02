import { describe, expect, it, vi } from 'vitest';
import { MIB, type Ocupacion } from '@/lib/ingest/backfill/capacidad';
import { ejecutarBackfillCli, parsearArgsBackfill, type DepsBackfillCli, type OpcionesCli } from '@/lib/ingest/backfill/cli';
import type { FilaPlan } from '@/lib/ingest/backfill/plan';
import type { ResultadoTarea, Tarea } from '@/lib/ingest/backfill/orquestador';
import { filaCatalogoFie, type FilaCatalogo } from '@/lib/ingest/sources/historico-indice';

const ocupacion = (): Ocupacion => ({
  medidoEn: '2026-12-01T00:00:00.000Z',
  logicoBytes: 30 * MIB,
  baseDatosBytes: null,
  tablas: [],
  conteos: { personas: 0, pruebas: 0, puestos: 0, asaltos: 0, documentos: 0, coberturas: 0 },
});

const prueba = (id: number, nombre = 'Gran Prix'): FilaCatalogo =>
  filaCatalogoFie({
    competitionId: id,
    season: 2027,
    name: nombre,
    type: 'I',
    category: 'S',
    federation: 'FIE',
    startDate: '2026-12-01',
    weapon: 'F',
    gender: 'M',
  })!;

function opciones(extra: string[] = []): OpcionesCli {
  const r = parsearArgsBackfill(extra);
  if (!r.ok) throw new Error(r.error);
  return r.opciones;
}

function montar(extra: Partial<DepsBackfillCli> = {}, filas: FilaPlan[] = []) {
  const ejecutadas: Tarea[] = [];
  const crearEjecutor = vi.fn(async () => async (t: Tarea): Promise<ResultadoTarea> => {
    ejecutadas.push(t);
    return { estado: 'completo', peticiones: 1, hechos: { puestos: 10 } };
  });
  const descubrir = vi.fn(async () => ({ catalogo: [prueba(1), prueba(2, 'Otro Gran Prix')], peticiones: 3, pendientes: 0, errores: [] }));
  const base: DepsBackfillCli = {
    leerFilas: async () => ({ filas, truncado: false }),
    leerAgregada: async () => [],
    leerReferencias: async () => ({ tablaDisponible: true, inscripcionesFie: 0, inscripcionesFieHistoricas: 0, conReferencia: 0, historicasSinReferencia: 0 }),
    esquema: async () => ({ identidad: true }),
    categoriasAmpliadas: async () => false,
    medir: async () => ocupacion(),
    crearEjecutor,
    descubrir,
    ahora: () => new Date('2026-12-02T00:00:00Z'),
    dormir: async () => {},
    ...extra,
  };
  return { base, ejecutadas, crearEjecutor, descubrir };
}

describe('CLI: el inventario genera unidades sin depender de cobertura de resultados', () => {
  it('la simulación no descubre por red ni construye ejecutor', async () => {
    const { base, descubrir, crearEjecutor } = montar();
    const r = await ejecutarBackfillCli(base, opciones());
    expect(descubrir).not.toHaveBeenCalled();
    expect(crearEjecutor).not.toHaveBeenCalled();
    expect(r.lineas.join('\n')).toMatch(/Descubrimiento del inventario: sólo con --aplicar/);
  });

  it('con --aplicar descubre, planifica unidades nunca leídas y las ejecuta aunque la cobertura esté vacía', async () => {
    const { base, ejecutadas, descubrir } = montar();
    const r = await ejecutarBackfillCli(base, opciones(['--aplicar', '--max-peticiones', '40']));
    expect(descubrir).toHaveBeenCalledTimes(1);
    // El descubrimiento sólo puede gastar la mitad del lote.
    expect((descubrir.mock.calls[0] as unknown as [{ maxPeticiones: number }])[0].maxPeticiones).toBe(20);
    expect(ejecutadas.map((t) => [t.clave, t.motivo])).toEqual([
      ['fie|2027|1', 'nunca_leido'],
      ['fie|2027|2', 'nunca_leido'],
    ]);
    expect(r.lineas.join('\n')).toMatch(/Descubrimiento: peticiones=3 pruebas=2 unidades_candidatas=2/);
  });

  it('el resumen de series distingue lo descubierto de lo importado', async () => {
    const importada: FilaPlan = {
      source: 'fie',
      season: '2027',
      factKind: 'ranking',
      competitionKey: '1',
      status: 'completo',
      publishedTotal: 10,
      importedTotal: 10,
      attempts: 1,
      cursor: null,
      lastCheckedAt: new Date('2026-12-01T00:00:00Z'),
      lastError: null,
      sourceUrl: null,
      competitionDate: '2026-12-01',
    };
    const { base } = montar({}, [importada]);
    const r = await ejecutarBackfillCli(base, opciones(['--aplicar']));
    const serie = r.lineas.filter((l) => /^Serie /.test(l));
    expect(serie.length).toBeGreaterThan(0);
    expect(serie.join('\n')).toMatch(/descubiertas=2 importadas=1/);
  });

  it('--sin-descubrir no recorre índices y sólo retoma lo ya conocido', async () => {
    const { base, descubrir, ejecutadas } = montar();
    const r = await ejecutarBackfillCli(base, opciones(['--aplicar', '--sin-descubrir']));
    expect(descubrir).not.toHaveBeenCalled();
    expect(ejecutadas).toEqual([]);
    expect(r.lineas.join('\n')).toMatch(/--sin-descubrir/);
  });

  it('un fallo del descubrimiento no tumba el lote ni se da por inventario vacío', async () => {
    const { base, ejecutadas } = montar({
      descubrir: async () => {
        throw new Error('HTTP 503 en el índice');
      },
    });
    const r = await ejecutarBackfillCli(base, opciones(['--aplicar']));
    expect(r.lineas.join('\n')).toMatch(/Descubrimiento fallido: HTTP 503/);
    expect(ejecutadas).toEqual([]);
    expect(r.codigo).toBe(0);
  });

  it('un 429 del descubrimiento detiene el lote con el código de límite remoto y muestra el Retry-After', async () => {
    const { base, ejecutadas, crearEjecutor } = montar({
      descubrir: async () => ({
        catalogo: [prueba(1)],
        peticiones: 3,
        pendientes: 2,
        errores: ['HTTP 429 al pedir la página'],
        tecnico: { status: 429, retryAfterMs: 45_000 },
      }),
    });
    const r = await ejecutarBackfillCli(base, opciones(['--aplicar']));
    const texto = r.lineas.join('\n');
    expect(r.codigo).toBe(4);
    expect(texto).toMatch(/HTTP 429, Retry-After 45 s/);
    expect(texto).toMatch(/el progreso del índice y las pruebas ya descubiertas quedan guardados/);
    expect(ejecutadas).toEqual([]);
    expect(crearEjecutor).not.toHaveBeenCalled();
  });

  it('un 5xx del descubrimiento se informa pero el lote sigue con lo ya conocido', async () => {
    const { base, ejecutadas } = montar({
      descubrir: async () => ({
        catalogo: [prueba(1)],
        peticiones: 2,
        pendientes: 1,
        errores: [],
        tecnico: { status: 503, retryAfterMs: null },
      }),
    });
    const r = await ejecutarBackfillCli(base, opciones(['--aplicar']));
    expect(r.lineas.join('\n')).toMatch(/HTTP 503, sin Retry-After/);
    expect(r.codigo).toBe(0);
    expect(ejecutadas.map((t) => t.clave)).toEqual(['fie|2027|1']);
  });

  it('el presupuesto del lote se entrega al ejecutor y al descubrimiento: es uno solo', async () => {
    let delDescubrimiento: unknown;
    let delEjecutor: unknown;
    const { base } = montar({
      descubrir: async (e) => {
        delDescubrimiento = e.presupuesto;
        return { catalogo: [], peticiones: 0, pendientes: 0, errores: [] };
      },
      crearEjecutor: async (p) => {
        delEjecutor = p;
        return async () => ({ estado: 'completo', peticiones: 1 });
      },
    });
    await ejecutarBackfillCli(base, opciones(['--aplicar']));
    expect(delDescubrimiento).toBeDefined();
    expect(delEjecutor).toBe(delDescubrimiento);
  });
});
