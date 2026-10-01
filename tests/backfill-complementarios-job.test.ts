import { describe, expect, it } from 'vitest';
import { ejecutarEngardeTorneo, ejecutarFwwPrueba, type DepsComplementosJob } from '@/lib/ingest/backfill/complementarios-job';
import type { CanonicaConPrimarios, ResultadoPruebaEngarde } from '@/lib/ingest/conciliar-torneo-engarde';
import type { LecturaTorneoEngarde, PruebaEngarde } from '@/lib/ingest/sources/engarde';
import type { LecturaResultadosFww, PaginaFww } from '@/lib/ingest/sources/fww';

const prueba = (compe: string, fecha: string | null = '2024-03-10'): PruebaEngarde => ({ compe, fecha }) as unknown as PruebaEngarde;

const torneo = (extra: Partial<LecturaTorneoEngarde> = {}): LecturaTorneoEngarde => ({
  org: 'org',
  evt: 'evt',
  url: 'https://engarde-service.com/x',
  estado: 'ok',
  nombre: 'Juegos Mediterráneos 2022',
  pruebas: [prueba('a'), prueba('b')],
  publicado: 2,
  error: null,
  ...extra,
});

const canonica = (id = 'c1'): CanonicaConPrimarios => ({
  competitionId: id,
  prueba: { fuente: 'fie', season: '2024', clave: '1', serie: null, nombreEdicion: 'x', ciudad: null, fecha: '2024-03-10', arma: 'ESPADA', genero: 'M', categoria: 'ABS', formato: 'INDIVIDUAL' },
  primarios: { estado: 'pendiente' },
});

function deps(over: Partial<DepsComplementosJob> = {}) {
  const orden: string[] = [];
  const cob: { source: string; fila: Record<string, unknown> }[] = [];
  const d: DepsComplementosJob = {
    engarde: { get: async () => ({ status: 200, body: '' }), post: async () => ({ status: 200, body: '' }) },
    persistencia: {
      esquema: async () => ({ identidad: true, referencias: true }),
      upsertResultados: async (_c, _s, filas) => {
        orden.push('resultados');
        return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
      },
      upsertAsaltos: async (_c, _s, filas) => {
        orden.push('asaltos');
        return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
      },
      upsertCobertura: async (source, fila) => {
        orden.push('cobertura');
        cob.push({ source, fila: fila as unknown as Record<string, unknown> });
      },
    },
    cargarCanonicas: async () => {
      orden.push('cargar_canonicas');
      return [canonica()];
    },
    leerTorneo: async () => {
      orden.push('leer_torneo');
      return torneo();
    },
    ...over,
  };
  return { d, orden, cob };
}

const candidato = { proveedor: 'engarde', url: 'https://engarde-service.com/x', clave: 'org/evt/a', nombreTorneo: null, ciudad: null, fecha: '2024-03-10', fechaPagina: null, arma: 'ESPADA', genero: 'M', categoria: 'ABS', formato: 'INDIVIDUAL' } as unknown as ResultadoPruebaEngarde['candidato'];

const resultado = (extra: Partial<ResultadoPruebaEngarde>): ResultadoPruebaEngarde => ({
  prueba: prueba('a'),
  candidato,
  canonica: canonica(),
  lectura: null,
  plan: { accion: 'sin_cambios', motivo: 'ya_canonico' },
  ...extra,
});

describe('ejecutarEngardeTorneo', () => {
  it('carga la canónica antes de conciliar y persistir, y no escribe pruebas sin canónica', async () => {
    const { d, orden } = deps({
      conciliar: async () => {
        orden.push('conciliar');
        return [
          resultado({ canonica: null, plan: { accion: 'sin_canonica', motivos: [] } }),
          resultado({
            plan: { accion: 'escribir', cobertura: 'completo', puestos: [{ clave: 'k', posicion: 1, posicionRaw: null, nombre: 'N', pais: 'ESP', club: null, equipo: null }] } as never,
          }),
        ];
      },
    });
    const r = await ejecutarEngardeTorneo(d, 'org', 'evt');
    expect(orden.slice(0, 3)).toEqual(['leer_torneo', 'cargar_canonicas', 'conciliar']);
    expect(orden.indexOf('cargar_canonicas')).toBeLessThan(orden.indexOf('resultados'));
    expect(r.estado).toBe('parcial');
    expect(r.mensaje).toContain('1 sin cerrar');
    expect(r.hechos?.puestos).toBe(1);
  });

  it('ausencia de inventario o canónica no se convierte en sin_resultados', async () => {
    const { d, cob } = deps({
      cargarCanonicas: async () => [],
      conciliar: async () => [resultado({ canonica: null, plan: { accion: 'sin_canonica', motivos: [] } })],
    });
    const r = await ejecutarEngardeTorneo(d, 'org', 'evt');
    expect(cob).toEqual([]);
    expect(r.estado).toBe('parcial');
  });

  it('429 al leer el índice: error técnico reintentable, sin escribir ni marcar vacío', async () => {
    const { d, orden } = deps({ leerTorneo: async () => torneo({ estado: 'error', pruebas: [], error: 'HTTP 429 al pedir el índice' }) });
    const r = await ejecutarEngardeTorneo(d, 'org', 'evt');
    expect(r.estado).toBe('error');
    expect(r.tecnico?.status).toBe(429);
    expect(orden).not.toContain('cobertura');
  });

  it('índice con 0 pruebas: sin cambios, no infiere cobertura', async () => {
    const { d, orden } = deps({ leerTorneo: async () => torneo({ estado: 'sin_pruebas', pruebas: [] }) });
    const r = await ejecutarEngardeTorneo(d, 'org', 'evt');
    expect(r.estado).toBe('sin_cambios');
    expect(orden).not.toContain('cargar_canonicas');
  });

  it('una lectura de clasificación con error 503 se devuelve como fallo técnico tras persistir su cobertura de error', async () => {
    const { d, cob } = deps({
      conciliar: async () => [resultado({ plan: { accion: 'sin_hechos', estado: 'error', motivo: 'HTTP 503 al pedir la clasificación' } })],
    });
    const r = await ejecutarEngardeTorneo(d, 'org', 'evt');
    expect(cob[0].fila).toMatchObject({ status: 'error', cursor: 'error' });
    expect(r.estado).toBe('error');
    expect(r.tecnico?.status).toBe(503);
  });

  it('esquema 0017 sin aplicar detiene el paso', async () => {
    const { d } = deps({
      conciliar: async () => [resultado({ plan: { accion: 'sin_hechos', estado: 'no_publicado', motivo: null } })],
    });
    d.persistencia.esquema = async () => ({ identidad: false, referencias: false });
    const r = await ejecutarEngardeTorneo(d, 'org', 'evt');
    expect(r.estado).toBe('esquema_no_aplicado');
  });
});

const paginaFww = (): PaginaFww =>
  ({ torneo: 'T', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaOriginal: null, formato: 'INDIVIDUAL', ciudad: null, pais: null, fecha: '2024-03-10', hayTabla: true, filas: [{ puestoRaw: '1', puesto: 1, nombre: 'N', nacion: 'ESP', fwwId: null, equipo: false }], anomalias: 0 }) as PaginaFww;

const URL_RES = 'https://www.fencingworldwide.com/en/123-2024/results/';

const lecturaFww = (extra: Partial<LecturaResultadosFww> = {}): LecturaResultadosFww => ({
  url: URL_RES,
  estado: 'completo',
  httpStatus: 200,
  pagina: paginaFww(),
  publicado: 1,
  importado: 1,
  motivo: null,
  ...extra,
});

describe('ejecutarFwwPrueba', () => {
  it('conecta finales y asaltos FWW: persiste ambos con la canónica ya cargada', async () => {
    const { d, orden, cob } = deps({
      leerResultadosFww: async () => lecturaFww(),
      conciliarAsaltosFww: async () => ({
        poules: { lectura: {} as never, candidato: candidato, plan: { accion: 'escribir', fase: 'POULE', cobertura: 'completo', publicado: 1, asaltos: [{ fase: 'POULE', ronda: 'P1', refA: 'a', refB: 'b', nombreA: 'A', nombreB: 'B', puntosA: 5, puntosB: 2, url: null }] } as never },
        cuadro: { lectura: {} as never, candidato: null, plan: { accion: 'sin_hechos', estado: 'no_publicado', motivo: 'sin cuadro' } },
      }),
    });
    const r = await ejecutarFwwPrueba(d, {
      canonica: canonica(),
      resultadosUrl: URL_RES,
      urls: { poules: ['https://www.fencingworldwide.com/en/123-2024/pools/1'], cuadro: ['https://www.fencingworldwide.com/en/123-2024/direct/2'] },
    });
    expect(orden).toContain('asaltos');
    expect(cob.length).toBeGreaterThan(0);
    // el cuadro sin documento leído no registra cobertura ni se da por cerrado
    expect(r.estado).toBe('parcial');
    expect(r.hechos?.asaltos).toBe(1);
  });

  it('429 en la clasificación FWW: error técnico, sin cobertura vacía', async () => {
    const { d, cob } = deps({
      leerResultadosFww: async () => lecturaFww({ estado: 'error', pagina: null, httpStatus: 429, motivo: 'HTTP 429 al pedir la prueba' }),
    });
    const r = await ejecutarFwwPrueba(d, { canonica: canonica(), resultadosUrl: URL_RES, urls: { poules: [], cuadro: [] } });
    expect(r.estado).toBe('error');
    expect(r.tecnico?.status).toBe(429);
    expect(cob).toEqual([]);
  });
});
