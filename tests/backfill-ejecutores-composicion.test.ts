import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearEjecutor } from '@/lib/ingest/backfill/ejecutores';
import { PresupuestoHttp, conPresupuesto } from '@/lib/ingest/backfill/presupuesto-http';
import { crearGuardaCapacidad } from '@/lib/ingest/backfill/guarda-capacidad';
import { TASAS_CONSERVADORAS, UMBRAL_CONSERVADOR_BYTES, proyectarCrecimiento, type DecisionCapacidad } from '@/lib/ingest/backfill/capacidad';
import type { Tarea } from '@/lib/ingest/backfill/orquestador';
import type { DepsEvidencia } from '@/lib/entries/evidencia';
import type { DepsPersistenciaFie, FilaCobertura } from '@/lib/ingest/fie-resultados-persist';
import { conflictosDeConfirmacion, type DepsGuardConfirmacion } from '@/lib/sport/id-guard';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import { TAMANO_PAGINA_RANKING, type DepsLecturaFie } from '@/lib/ingest/sources/fie-resultados';
import type { LecturaPdf } from '@/lib/ingest/sources/rfee-pdf/tipos';

const persistirPdf = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ingest/backfill/pdf-persist', () => ({ persistirLecturaPdf: persistirPdf }));

const URL_DOC = 'https://app.skermo.org/client/1/abc123.pdf';

const pdfLeido = (extra: Partial<LecturaPdf> = {}): LecturaPdf =>
  ({
    url: URL_DOC,
    docId: 'abc123',
    sha256: 'a'.repeat(64),
    perfil: { bytes: 1000, paginas: 2, items: 50, ms: 10, heapMb: 1 },
    paginas: [],
    pruebas: [],
    rechazos: [],
    ocr: { necesario: false, paginas: [], ejecutado: false, motivo: null },
    estado: 'completo',
    error: null,
    ...extra,
  }) as LecturaPdf;

const tareaPdf = (datos: Record<string, unknown>): Tarea => ({
  clave: 'rfee|2018-2019|doc:abc123',
  tipo: 'pdf_documento',
  fuente: 'rfee',
  season: '2018-2019',
  competitionKey: 'doc:abc123',
  motivo: 'nunca_leido',
  releer: false,
  estimacion: { puestos: 150, asaltos: 0, documentos: 1, unidades: 1 },
  datos,
});

const resumenPdf = {
  estado: 'aplicado',
  motivo: null,
  documento: 'completo',
  competiciones: [],
  puestos: { nuevos: 1, revisados: 0, sinCambios: 0 },
  asaltos: { nuevos: 0, revisados: 0, sinCambios: 0 },
};

const decision = (continuar: boolean): DecisionCapacidad =>
  ({ continuar, mensaje: continuar ? 'ok' : 'Capacidad insuficiente', umbralBytes: 0 }) as unknown as DecisionCapacidad;

beforeEach(() => persistirPdf.mockReset());

describe('PDF: el ejecutor entrega URL y referencia original de la fila', () => {
  it('pasa sourceUrl, índice, refOriginal y título al persistidor', async () => {
    persistirPdf.mockResolvedValue(resumenPdf);
    const ejecutar = crearEjecutor({
      fie: {} as never,
      pdf: { leer: async () => pdfLeido(), persistencia: {} as never },
    });
    const r = await ejecutar(
      tareaPdf({ sourceUrl: URL_DOC, indice: 4, refOriginal: 'skermo|2018-2019|fed:77', titulo: 'Copa de España M15' }),
    );
    expect(r.estado).toBe('completo');
    expect(persistirPdf).toHaveBeenCalledTimes(1);
    expect(persistirPdf.mock.calls[0][2]).toEqual({
      season: '2018-2019',
      sourceUrl: URL_DOC,
      indice: 4,
      refOriginal: 'skermo|2018-2019|fed:77',
      titulo: 'Copa de España M15',
    });
  });

  it('sin datos de fila no inventa referencia ni título', async () => {
    persistirPdf.mockResolvedValue(resumenPdf);
    const ejecutar = crearEjecutor({ fie: {} as never, pdf: { leer: async () => pdfLeido(), persistencia: {} as never } });
    await ejecutar(tareaPdf({ sourceUrl: URL_DOC }));
    expect(persistirPdf.mock.calls[0][2]).toMatchObject({ indice: null, refOriginal: null, titulo: null });
  });

  it('una lectura cortada por presupuesto queda pendiente sin persistir ni gastar un intento', async () => {
    const ejecutar = crearEjecutor({
      fie: {} as never,
      pdf: {
        leer: async () => pdfLeido({ estado: 'error', sha256: null, error: 'Presupuesto del lote agotado (limite_peticiones): no se hace la petición' }),
        persistencia: {} as never,
      },
    });
    const r = await ejecutar(tareaPdf({ sourceUrl: URL_DOC }));
    expect(r.estado).toBe('pendiente');
    expect(persistirPdf).not.toHaveBeenCalled();
  });

  it('la guarda de capacidad se evalúa con el tamaño real leído y, si deniega, nada se escribe', async () => {
    const lotes: unknown[] = [];
    const puestos = Array.from({ length: 2400 }, () => ({})) as never[];
    const ejecutar = crearEjecutor({
      fie: {} as never,
      capacidad: async (lote) => {
        lotes.push(lote);
        return decision(false);
      },
      pdf: { leer: async () => pdfLeido({ pruebas: [{ puestos, asaltos: [] } as never] }), persistencia: {} as never },
    });
    const r = await ejecutar(tareaPdf({ sourceUrl: URL_DOC }));
    expect(lotes).toEqual([{ puestos: 2400, asaltos: 0, documentos: 1, unidades: 1 }]);
    expect(r.estado).toBe('pendiente');
    expect(r.capacidad?.continuar).toBe(false);
    expect(persistirPdf).not.toHaveBeenCalled();
  });
});

const TOTAL = 2400;

function fuenteFie(contador: { n: number }) {
  const deps: DepsLecturaFie = {
    async fetchJson(url) {
      contador.n += 1;
      if (url.endsWith('/competition/2027/99')) {
        return { competitionId: 99, season: 2027, name: 'Prueba', type: 'I', category: 'C', location: 'X', federation: 'COL', startDate: '2026-09-25', endDate: '2026-09-25', weapon: 'S', gender: 'F', tournamentId: 5 };
      }
      if (/results\/(pools|tableau)/.test(url)) return { pools: [], tableau: [] };
      const pagina = Number(new URL(url).searchParams.get('page'));
      const desde = (pagina - 1) * TAMANO_PAGINA_RANKING;
      return {
        totalFound: TOTAL,
        page: pagina,
        pageSize: TAMANO_PAGINA_RANKING,
        items: Array.from({ length: Math.max(0, Math.min(TAMANO_PAGINA_RANKING, TOTAL - desde)) }, (_, i) => ({
          rank: desde + i + 1,
          points: null,
          fencer: { id: 10_000 + desde + i, name: `SIM ${desde + i}`, countryCode: 'ESP', gender: 'F' },
        })),
      };
    },
  };
  return deps;
}

const tareaFie: Tarea = {
  clave: 'fie|2027|99',
  tipo: 'fie_prueba',
  fuente: 'fie',
  season: '2027',
  competitionKey: '99',
  motivo: 'nunca_leido',
  releer: false,
  estimacion: { puestos: 150, asaltos: 0, documentos: 0, unidades: 3 },
};

/** Persistencia FIE cuyo menor uso falla la prueba: lo que se comprueba es que NO se llega a escribir. */
const persistenciaProhibida = new Proxy({} as DepsPersistenciaFie, {
  get: (_t, prop) => {
    throw new Error(`Se intentó escribir (${String(prop)}) con la capacidad denegada o el presupuesto agotado`);
  },
});

describe('FIE: presupuesto y capacidad evaluados sobre lo realmente leído', () => {
  it('--max-peticiones 1: la metadata entra, el ranking no, y nada se escribe ni se registra como intento', async () => {
    const contador = { n: 0 };
    const presupuesto = new PresupuestoHttp({ maxPeticiones: 1, maxMs: 60_000, ahora: () => 0 });
    const ejecutar = crearEjecutor({
      fie: {
        lectura: { fetchJson: conPresupuesto(presupuesto, fuenteFie(contador).fetchJson) },
        persistencia: persistenciaProhibida,
        cursorActual: async () => null,
      },
    });
    const r = await ejecutar(tareaFie);
    expect(contador.n).toBe(1);
    expect(presupuesto.usadas).toBe(1);
    expect(r.estado).toBe('pendiente');
    expect(r.mensaje).toMatch(/Presupuesto del lote agotado/);
  });

  it('la estimación de 150 puestos cabe, pero la prueba leída de 2400 no: la guarda deniega antes de escribir', async () => {
    const contador = { n: 0 };
    // Hueco que admite la estimación del plan (150 puestos) pero no los 2400 realmente leídos.
    const estimado = proyectarCrecimiento(TASAS_CONSERVADORAS, tareaFie.estimacion);
    const real = proyectarCrecimiento(TASAS_CONSERVADORAS, { puestos: TOTAL, asaltos: 0, documentos: 0, unidades: 3 });
    expect(real).toBeGreaterThan(estimado);
    const ocupadoCasiLleno = UMBRAL_CONSERVADOR_BYTES - Math.round((estimado + real) / 2);
    const guarda = crearGuardaCapacidad({
      plan: { tipo: 'free' },
      medir: async () => ({ medidoEn: 'x', logicoBytes: ocupadoCasiLleno, baseDatosBytes: null, tablas: [], conteos: {} }) as never,
    });
    const lotes: unknown[] = [];
    const ejecutar = crearEjecutor({
      capacidad: async (lote) => {
        lotes.push(lote);
        return guarda(lote);
      },
      fie: { lectura: fuenteFie(contador), persistencia: persistenciaProhibida, cursorActual: async () => null },
    });
    const r = await ejecutar(tareaFie);
    expect(lotes).toHaveLength(1);
    expect((lotes[0] as { puestos: number }).puestos).toBe(TOTAL);
    expect((await guarda(tareaFie.estimacion)).continuar).toBe(true);
    expect(r.estado).toBe('pendiente');
    expect(r.capacidad?.continuar).toBe(false);
  });

  it('si la medición falla la guarda no autoriza la escritura', async () => {
    const guarda = crearGuardaCapacidad({
      plan: { tipo: 'free' },
      medir: async () => {
        throw new Error('sin conexión');
      },
    });
    const d = await guarda({ puestos: 10, asaltos: 0, documentos: 0, unidades: 1 });
    expect(d.continuar).toBe(false);
  });
});

describe('FIE: una fase cortada por el presupuesto no deja la unidad como completa', () => {
  it('ranking leído y poules cortadas: lo leído se guarda, la unidad queda pendiente y su cobertura no figura completa', async () => {
    const externos: ExternalIdRow[] = [];
    const cobertura = new Map<string, FilaCobertura>();
    const resultados = new Map<string, unknown>();
    const evidencia: DepsEvidencia = {
      esquema: async () => ({ identidad: true, referencias: true }),
      atletasPorLicencia: async () => [],
      fichasFie: async () => [],
      externos: async (valores) => externos.filter((e) => valores.includes(e.value)),
      personas: async (ids) => new Map(ids.map((id) => [id, { athleteId: null, mergedIntoPersonId: null }])),
    };
    const guard: DepsGuardConfirmacion = {
      confirmar: async (c) => {
        if (conflictosDeConfirmacion(externos, c).length > 0) return false;
        externos.push({ ...c, linkStatus: 'CONFIRMADO' });
        return true;
      },
      conflictos: async (c) => conflictosDeConfirmacion(externos, c),
    };
    let n = 0;
    const persistencia: DepsPersistenciaFie = {
      esquema: async () => ({ identidad: true, referencias: true }),
      evidencia,
      guard,
      nuevoId: () => `persona-${(n += 1)}`,
      upsertPrueba: async () => 'comp-1',
      upsertResultados: async (_c, filas) => {
        for (const f of filas) resultados.set(f.sourceFactKey, f);
        return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
      },
      upsertAsaltos: async () => ({ nuevos: 0, revisados: 0, sinCambios: 0 }),
      upsertCobertura: async (f) => {
        cobertura.set(`${f.factKind}|${f.competitionKey}`, { ...cobertura.get(`${f.factKind}|${f.competitionKey}`), ...f });
      },
      contarResultados: async () => ({ total: resultados.size, sinPersona: 0 }),
    };
    const contador = { n: 0 };
    // Metadata + una página de ranking caben; las poules ya no.
    const presupuesto = new PresupuestoHttp({ maxPeticiones: 2, maxMs: 60_000, ahora: () => 0 });
    const fuente = fuenteFie(contador);
    const ejecutar = crearEjecutor({
      fie: {
        lectura: {
          fetchJson: conPresupuesto(presupuesto, async (url) => {
            const r = (await fuente.fetchJson(url)) as { totalFound?: number; items?: unknown[] };
            return r.items ? { ...r, totalFound: r.items.length } : r;
          }),
        },
        persistencia,
        cursorActual: async () => null,
      },
    });
    const r = await ejecutar({ ...tareaFie, estimacion: { puestos: 100, asaltos: 0, documentos: 0, unidades: 3 } });
    expect(presupuesto.usadas).toBe(2);
    expect(r.estado).toBe('pendiente');
    expect(r.mensaje).toMatch(/Presupuesto del lote agotado/);
    expect(resultados.size).toBeGreaterThan(0);
    expect(cobertura.get('pools|99')?.status).not.toBe('completo');
  });
});