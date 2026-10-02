import { describe, expect, it, vi } from 'vitest';
import { ejecutarEngardeTorneo, ejecutarFwwPrueba, type DepsComplementosJob } from '@/lib/ingest/backfill/complementarios-job';
import type { GuardaCapacidad } from '@/lib/ingest/backfill/guarda-capacidad';
import type { CanonicaConPrimarios, ResultadoPruebaEngarde } from '@/lib/ingest/conciliar-torneo-engarde';
import type { LecturaTorneoEngarde, PruebaEngarde } from '@/lib/ingest/sources/engarde';
import type { LecturaResultadosFww, PaginaFww } from '@/lib/ingest/sources/fww';
import { crearEjecutor } from '@/lib/ingest/backfill/ejecutores';
import type { Tarea } from '@/lib/ingest/backfill/orquestador';
import { AlmacenCobertura } from './helpers/almacen-cobertura';

/**
 * Residuales de los complementarios: candidatos sin canónica persistidos, errores de la fuente
 * FWW persistidos sin perder lo válido, y capacidad evaluada sobre el lote real antes de escribir.
 * El almacén de cobertura replica el upsert real; no es SQL.
 */

const prueba = (compe: string): PruebaEngarde => ({ compe, fecha: '2024-03-10' }) as unknown as PruebaEngarde;
const torneo = (): LecturaTorneoEngarde => ({
  org: 'org',
  evt: 'evt',
  url: 'https://engarde-service.com/x',
  estado: 'ok',
  nombre: 'Juegos Mediterráneos 2022',
  pruebas: [prueba('a'), prueba('b')],
  publicado: 2,
  error: null,
});
const canonica = (): CanonicaConPrimarios => ({
  competitionId: 'c1',
  prueba: { fuente: 'fie', season: '2024', clave: '1', serie: null, nombreEdicion: 'x', ciudad: null, fecha: '2024-03-10', arma: 'ESPADA', genero: 'M', categoria: 'ABS', formato: 'INDIVIDUAL' },
  primarios: { estado: 'pendiente' },
});
const cand = (clave: string, url = `https://engarde-service.com/${clave}`) =>
  ({ proveedor: 'engarde', url, clave, nombreTorneo: null, ciudad: null, fecha: '2024-03-10', fechaPagina: null, arma: 'ESPADA', genero: 'M', categoria: 'ABS', formato: 'INDIVIDUAL' }) as unknown as ResultadoPruebaEngarde['candidato'];
const puestoDe = (i: number) => ({ clave: `k${i}`, posicion: i, posicionRaw: null, nombre: `N${i}`, pais: 'ESP', club: null, equipo: null });
const asaltoDe = (i: number) => ({ fase: 'TABLEAU', ronda: 'T16', refA: `a${i}`, refB: `b${i}`, nombreA: 'A', nombreB: 'B', puntosA: 15, puntosB: 9, url: null });

function montar(over: Partial<DepsComplementosJob> = {}) {
  const almacen = new AlmacenCobertura();
  const resultados: unknown[] = [];
  const asaltos: unknown[] = [];
  const persistencia: DepsComplementosJob['persistencia'] = {
    esquema: async () => ({ identidad: true, referencias: true }),
    upsertResultados: async (_c, _s, filas) => {
      resultados.push(...filas);
      return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
    },
    upsertAsaltos: async (_c, _s, filas) => {
      asaltos.push(...filas);
      return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
    },
    upsertCobertura: async (source, fila) => almacen.escribir(source, fila),
  };
  const d: DepsComplementosJob = {
    engarde: { get: async () => ({ status: 200, body: '' }), post: async () => ({ status: 200, body: '' }) },
    persistencia,
    cargarCanonicas: async () => [canonica()],
    leerTorneo: async () => torneo(),
    ...over,
  };
  return { d, almacen, resultados, asaltos };
}

const escribir = (clave: string, puestos: number, asaltos = 0): ResultadoPruebaEngarde =>
  ({
    prueba: prueba(clave),
    candidato: cand(clave),
    canonica: canonica(),
    lectura: null,
    plan: { accion: 'escribir', cobertura: 'completo', puestos: Array.from({ length: puestos }, (_, i) => puestoDe(i + 1)) },
    ...(asaltos > 0
      ? {
          cuadro: {
            lectura: { estado: 'completo' },
            plan: { accion: 'escribir', fase: 'TABLEAU', cobertura: 'completo', publicado: asaltos, asaltos: Array.from({ length: asaltos }, (_, i) => asaltoDe(i)) },
          },
        }
      : {}),
  }) as unknown as ResultadoPruebaEngarde;

const guardaQue = (continuar: boolean): GuardaCapacidad =>
  vi.fn(async () => ({
    continuar,
    mensaje: continuar ? 'cabe' : 'Capacidad: el lote leído no cabe en el margen',
    margenBytes: 0,
  })) as unknown as GuardaCapacidad;

describe('Engarde: candidato sin canónica compatible', () => {
  it('persiste pendiente con la URL y los motivos reales, sin competencia, y retira el completo viejo', async () => {
    const { d, almacen, resultados } = montar({
      conciliar: async () => [
        {
          prueba: prueba('a'),
          candidato: cand('a'),
          canonica: null,
          lectura: null,
          plan: { accion: 'sin_canonica', motivos: ['edicion_no_verificable', 'fecha_distinta'] },
        } as unknown as ResultadoPruebaEngarde,
      ],
    });
    almacen.escribir('engarde', { season: '2024', factKind: 'results', competitionKey: 'a', competitionId: 'c1', status: 'completo', publishedTotal: 8, importedTotal: 8 });

    const r = await ejecutarEngardeTorneo(d, 'org', 'evt', '2024');

    const fila = almacen.obtener('engarde', 'results', 'a', '2024');
    expect(fila).toMatchObject({ status: 'pendiente', cursor: 'sin_canonica', sourceUrl: 'https://engarde-service.com/a' });
    expect(fila?.lastError).toBe('sin_canonica: edicion_no_verificable,fecha_distinta');
    // No inventa que la prueba no se publicó: las cifras de la lectura anterior no se tocan.
    expect(fila).toMatchObject({ publishedTotal: 8, importedTotal: 8 });
    expect(resultados).toEqual([]);
    expect(r.estado).toBe('parcial');
  });

  it('un candidato nuevo sin canónica queda registrado sin asignar competencia', async () => {
    const { d, almacen } = montar({
      conciliar: async () => [
        { prueba: prueba('z'), candidato: cand('z'), canonica: null, lectura: null, plan: { accion: 'sin_canonica', motivos: [] } } as unknown as ResultadoPruebaEngarde,
      ],
    });
    await ejecutarEngardeTorneo(d, 'org', 'evt', '2024');
    expect(almacen.obtener('engarde', 'results', 'z', '2024')).toMatchObject({ status: 'pendiente', competitionId: null, cursor: 'sin_canonica' });
  });
});

describe('Engarde/FWW: la capacidad se evalúa sobre el lote real antes de persistir', () => {
  it('Engarde: un torneo con más puestos y asaltos de los estimados se mide completo y, denegado, no escribe nada', async () => {
    const guarda = guardaQue(false);
    const { d, almacen, resultados, asaltos } = montar({
      conciliar: async () => [escribir('a', 400, 30), escribir('b', 700, 20)],
    });
    const r = await ejecutarEngardeTorneo(d, 'org', 'evt', '2024', guarda);
    expect(guarda).toHaveBeenCalledTimes(1);
    expect((guarda as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toMatchObject({ puestos: 1100, asaltos: 50, documentos: 0 });
    expect(r.estado).toBe('pendiente');
    expect(r.capacidad?.continuar).toBe(false);
    expect(resultados).toEqual([]);
    expect(asaltos).toEqual([]);
    expect(almacen.escrituras).toBe(0);
  });

  it('Engarde: con capacidad suficiente escribe como siempre', async () => {
    const guarda = guardaQue(true);
    const { d, resultados } = montar({ conciliar: async () => [escribir('a', 3)] });
    const r = await ejecutarEngardeTorneo(d, 'org', 'evt', '2024', guarda);
    expect(guarda).toHaveBeenCalledTimes(1);
    expect(resultados).toHaveLength(3);
    expect(r.estado).toBe('completo');
  });

  const URL_RES = 'https://www.fencingworldwide.com/en/123-2024/results/';
  const pagina = (): PaginaFww =>
    ({ torneo: 'T', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaOriginal: null, formato: 'INDIVIDUAL', ciudad: null, pais: null, fecha: '2024-03-10', hayTabla: true, filas: [], anomalias: 0 }) as unknown as PaginaFww;
  const lectura = (extra: Partial<LecturaResultadosFww> = {}): LecturaResultadosFww => ({
    url: URL_RES,
    estado: 'completo',
    httpStatus: 200,
    pagina: pagina(),
    publicado: 1,
    importado: 1,
    motivo: null,
    ...extra,
  });

  it('FWW: finales y poules leídos se miden juntos antes de escribir y, denegado, no persiste nada', async () => {
    const guarda = guardaQue(false);
    const poules = {
      lectura: { estado: 'completo' },
      candidato: cand('pools'),
      plan: { accion: 'escribir', fase: 'POULE', cobertura: 'completo', publicado: 40, asaltos: Array.from({ length: 40 }, (_, i) => ({ ...asaltoDe(i), fase: 'POULE', ronda: 'P1' })) },
    };
    const { d, almacen, resultados, asaltos } = montar({
      leerResultadosFww: async () => lectura(),
      conciliarAsaltosFww: async () =>
        ({ poules, cuadro: { lectura: { estado: 'completo' }, candidato: null, plan: { accion: 'sin_hechos', estado: 'no_publicado', motivo: null } } }) as never,
    });
    const r = await ejecutarFwwPrueba(
      d,
      { canonica: canonica(), resultadosUrl: URL_RES, urls: { poules: ['https://www.fencingworldwide.com/en/123-2024/pools/1'], cuadro: [] } },
      guarda,
    );
    expect(guarda).toHaveBeenCalledTimes(1);
    expect((guarda as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toMatchObject({ asaltos: 40, documentos: 0 });
    expect(r.estado).toBe('pendiente');
    expect(r.capacidad?.continuar).toBe(false);
    expect(resultados).toEqual([]);
    expect(asaltos).toEqual([]);
    expect(almacen.escrituras).toBe(0);
  });
});

describe('FWW: los fallos de la fuente se persisten sin perder lo válido', () => {
  const URL_RES = 'https://www.fencingworldwide.com/en/123-2024/results/';
  const sinFases = async () =>
    ({
      poules: { lectura: { estado: 'completo' }, candidato: null, plan: { accion: 'sin_hechos', estado: 'no_publicado', motivo: null } },
      cuadro: { lectura: { estado: 'completo' }, candidato: null, plan: { accion: 'sin_hechos', estado: 'no_publicado', motivo: null } },
    }) as never;
  const error403 = (motivo = 'HTTP 403 al pedir la prueba'): LecturaResultadosFww => ({
    url: URL_RES,
    estado: 'error',
    httpStatus: 403,
    pagina: null,
    publicado: null,
    importado: 0,
    motivo,
  });

  it('un 403 en la clasificación marca error la unidad conocida y conserva las cifras válidas anteriores', async () => {
    const { d, almacen } = montar({ leerResultadosFww: async () => error403(), conciliarAsaltosFww: sinFases });
    almacen.escribir('fww', { season: '2024', factKind: 'results', competitionKey: '123-2024', competitionId: 'c1', status: 'completo', publishedTotal: 12, importedTotal: 12 });

    const r = await ejecutarFwwPrueba(d, { canonica: canonica(), resultadosUrl: URL_RES, urls: { poules: [], cuadro: [] } });

    expect(r.estado).toBe('error');
    expect(almacen.obtener('fww', 'results', '123-2024', '2024')).toMatchObject({
      status: 'error',
      sourceUrl: URL_RES,
      publishedTotal: 12,
      importedTotal: 12,
      competitionId: 'c1',
    });
    expect(almacen.obtener('fww', 'results', '123-2024', '2024')?.lastError).toContain('HTTP 403');
  });

  it('todas las páginas de una fase fallidas dejan error en esa fase y no tocan la clasificación completa', async () => {
    const { d, almacen } = montar({
      leerResultadosFww: async () => lectura(),
      conciliarAsaltosFww: async () =>
        ({
          poules: { lectura: { estado: 'error', motivo: 'HTTP 403 en pools/1' }, candidato: null, plan: { accion: 'sin_hechos', estado: 'error', motivo: 'HTTP 403 en pools/1' } },
          cuadro: { lectura: { estado: 'completo' }, candidato: null, plan: { accion: 'sin_hechos', estado: 'no_publicado', motivo: null } },
        }) as never,
    });
    const urlPools = 'https://www.fencingworldwide.com/en/123-2024/pools/1';
    function lectura(): LecturaResultadosFww {
      return { url: URL_RES, estado: 'completo', httpStatus: 200, pagina: { torneo: 'T', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaOriginal: null, formato: 'INDIVIDUAL', ciudad: null, pais: null, fecha: '2024-03-10', hayTabla: true, filas: [], anomalias: 0 } as unknown as PaginaFww, publicado: 0, importado: 0, motivo: null };
    }
    almacen.escribir('fww', { season: '2024', factKind: 'pools', competitionKey: '123-2024', competitionId: 'c1', status: 'completo', publishedTotal: 30, importedTotal: 30 });

    const r = await ejecutarFwwPrueba(d, { canonica: canonica(), resultadosUrl: URL_RES, urls: { poules: [urlPools], cuadro: [] } });

    expect(r.estado).toBe('error');
    expect(almacen.obtener('fww', 'pools', '123-2024', '2024')).toMatchObject({ status: 'error', sourceUrl: urlPools, publishedTotal: 30, importedTotal: 30 });
  });

  it('una denegación del presupuesto sigue pendiente y no se escribe como error de la fuente', async () => {
    const { d, almacen } = montar({
      leerResultadosFww: async () => error403('Presupuesto del lote agotado (limite_peticiones): no se hace la petición'),
      conciliarAsaltosFww: sinFases,
    });
    almacen.escribir('fww', { season: '2024', factKind: 'results', competitionKey: '123-2024', competitionId: 'c1', status: 'completo', publishedTotal: 12, importedTotal: 12 });
    const antes = almacen.escrituras;

    const r = await ejecutarFwwPrueba(d, { canonica: canonica(), resultadosUrl: URL_RES, urls: { poules: [], cuadro: [] } });

    expect(r.estado).toBe('pendiente');
    expect(almacen.escrituras).toBe(antes);
    expect(almacen.obtener('fww', 'results', '123-2024', '2024')?.status).toBe('completo');
  });
});



describe('crearEjecutor: la guarda compartida llega a Engarde y FWW', () => {
  const tarea = (tipo: Tarea['tipo'], extra: Partial<Tarea> = {}): Tarea => ({
    clave: 'x',
    tipo,
    fuente: tipo === 'engarde_torneo' ? 'engarde' : 'fww',
    season: '2024',
    competitionKey: 'org/evt',
    motivo: 'nunca_leido',
    releer: false,
    estimacion: { puestos: 60, asaltos: 120, documentos: 0, unidades: 2 },
    ...extra,
  });

  it('una tarea Engarde cuyo torneo leído no cabe queda pendiente por capacidad sin escribir', async () => {
    const guarda = guardaQue(false);
    const { d, almacen, resultados } = montar({ conciliar: async () => [escribir('a', 900)] });
    const ejecutar = crearEjecutor({
      capacidad: guarda,
      fie: {} as never,
      complementarios: { ...d, cargarCanonicaPorId: async () => canonica() },
    });
    const r = await ejecutar(tarea('engarde_torneo'));
    expect(guarda).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ estado: 'pendiente', capacidad: { continuar: false } });
    expect(resultados).toEqual([]);
    expect(almacen.escrituras).toBe(0);
  });

  it('una tarea FWW cuya lectura no cabe queda pendiente por capacidad sin escribir', async () => {
    const guarda = guardaQue(false);
    const { d, almacen, resultados } = montar({
      leerResultadosFww: async () => ({
        url: 'https://www.fencingworldwide.com/en/123-2024/results/',
        estado: 'completo',
        httpStatus: 200,
        pagina: { torneo: 'T', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaOriginal: null, formato: 'INDIVIDUAL', ciudad: null, pais: null, fecha: '2024-03-10', hayTabla: true, filas: [], anomalias: 0 } as unknown as PaginaFww,
        publicado: 0,
        importado: 0,
        motivo: null,
      }),
    });
    const ejecutar = crearEjecutor({
      capacidad: guarda,
      fie: {} as never,
      complementarios: { ...d, cargarCanonicaPorId: async () => canonica() },
    });
    const r = await ejecutar(
      tarea('fww_prueba', { datos: { competitionId: 'c1', sourceUrl: 'https://www.fencingworldwide.com/en/123-2024/results/', poules: [], cuadro: [] } }),
    );
    expect(guarda).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ estado: 'pendiente', capacidad: { continuar: false } });
    expect(resultados).toEqual([]);
    expect(almacen.escrituras).toBe(0);
  });
});