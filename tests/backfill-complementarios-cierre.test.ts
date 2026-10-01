import { describe, expect, it } from 'vitest';
import { ejecutarEngardeTorneo, ejecutarFwwPrueba, type DepsComplementosJob } from '@/lib/ingest/backfill/complementarios-job';
import type { CanonicaConPrimarios, ResultadoPruebaEngarde } from '@/lib/ingest/conciliar-torneo-engarde';
import type { LecturaTorneoEngarde, PruebaEngarde } from '@/lib/ingest/sources/engarde';
import type { LecturaResultadosFww, PaginaFww } from '@/lib/ingest/sources/fww';
import type { FilaCoberturaGenerica } from '@/lib/ingest/fie-resultados-db';

const prueba = (compe: string): PruebaEngarde => ({ compe, fecha: '2024-03-10' }) as unknown as PruebaEngarde;

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

const cand = (clave: string, url = `https://engarde-service.com/${clave}`) =>
  ({ proveedor: 'engarde', url, clave, nombreTorneo: null, ciudad: null, fecha: '2024-03-10', fechaPagina: null, arma: 'ESPADA', genero: 'M', categoria: 'ABS', formato: 'INDIVIDUAL' }) as unknown as ResultadoPruebaEngarde['candidato'];

const puesto = { clave: 'k', posicion: 1, posicionRaw: null, nombre: 'N', pais: 'ESP', club: null, equipo: null };
const asalto = { fase: 'TABLEAU', ronda: 'T16', refA: 'a', refB: 'b', nombreA: 'A', nombreB: 'B', puntosA: 15, puntosB: 9, url: null };

/** Almacén que acumula como un upsert real: la última cobertura por clave es la vigente. */
function almacen() {
  const coberturas = new Map<string, FilaCoberturaGenerica>();
  const resultados = new Map<string, unknown>();
  const asaltos = new Map<string, unknown>();
  const persistencia: DepsComplementosJob['persistencia'] = {
    esquema: async () => ({ identidad: true, referencias: true }),
    upsertResultados: async (c, _s, filas) => {
      for (const f of filas) resultados.set(`${c}|${f.sourceFactKey}`, f);
      return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
    },
    upsertAsaltos: async (c, _s, filas) => {
      for (const f of filas) asaltos.set(`${c}|${f.phase}|${f.roundKey}|${f.fencerARef}|${f.fencerBRef}`, f);
      return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
    },
    upsertCobertura: async (source, fila) => {
      coberturas.set(`${source}|${fila.season}|${fila.factKind}|${fila.competitionKey}`, fila);
    },
  };
  return { persistencia, coberturas, resultados, asaltos };
}

function deps(over: Partial<DepsComplementosJob> = {}) {
  const a = almacen();
  const d: DepsComplementosJob = {
    engarde: { get: async () => ({ status: 200, body: '' }), post: async () => ({ status: 200, body: '' }) },
    persistencia: a.persistencia,
    cargarCanonicas: async () => [canonica()],
    leerTorneo: async () => torneo(),
    ...over,
  };
  return { d, ...a };
}

const escribir = (clave: string, extra: Record<string, unknown> = {}): ResultadoPruebaEngarde =>
  ({
    prueba: prueba(clave),
    candidato: cand(clave),
    canonica: canonica(),
    lectura: null,
    plan: { accion: 'escribir', cobertura: 'completo', puestos: [puesto] },
    ...extra,
  }) as unknown as ResultadoPruebaEngarde;

describe('Engarde: el cierre agrega cada hecho intentado', () => {
  it('un tableau parcial con 429 conserva lo escrito, anota la señal técnica y no queda completo', async () => {
    const { d, asaltos, resultados } = deps({
      conciliar: async () => [
        escribir('a', {
          cuadro: {
            lectura: { estado: 'parcial', motivo: 'HTTP 429 al pedir el cuadro (Retry-After: 9s)' },
            plan: { accion: 'escribir', fase: 'TABLEAU', cobertura: 'parcial', publicado: 3, asaltos: [asalto] },
          },
        }),
      ],
    });
    const r = await ejecutarEngardeTorneo(d, 'org', 'evt', '2024');
    expect(asaltos.size).toBe(1);
    expect(resultados.size).toBe(1);
    expect(r.estado).toBe('error');
    expect(r.tecnico).toEqual({ status: 429, retryAfterMs: 9000 });
    expect(r.hechos).toEqual({ puestos: 1, asaltos: 1 });
  });

  it('un tableau diferido o en revisión impide cerrar aunque los finales estén completos', async () => {
    for (const plan of [
      { accion: 'diferir', motivo: 'sin_finales' },
      { accion: 'revision', motivos: ['cuadro_no_coincide'] },
    ]) {
      const { d, coberturas } = deps({
        conciliar: async () => [escribir('a', { cuadro: { lectura: { estado: 'completo' }, plan } })],
      });
      const r = await ejecutarEngardeTorneo(d, 'org', 'evt', '2024');
      expect(r.estado, JSON.stringify(plan)).toBe('parcial');
      const fila = coberturas.get('engarde|2024|tableau|a');
      expect(fila?.cursor).toMatch(/diferido|revision/);
    }
  });

  it('una prueba con 403 no se tapa con otra completa: la unidad queda en error, no completa', async () => {
    const { d, coberturas } = deps({
      conciliar: async () => [
        escribir('a'),
        escribir('b', { plan: { accion: 'sin_hechos', estado: 'error', motivo: 'HTTP 403 al pedir la clasificación' } }),
      ],
    });
    const r = await ejecutarEngardeTorneo(d, 'org', 'evt', '2024');
    expect(r.estado).toBe('error');
    expect(r.tecnico).toBeUndefined();
    expect(coberturas.get('engarde|2024|results|b')?.status).toBe('error');
    expect(coberturas.get('engarde|2024|results|a')?.status).toBe('completo');
  });

  it('índice del torneo parcial por 5xx conserva lo válido y devuelve la señal técnica', async () => {
    const { d, resultados } = deps({
      leerTorneo: async () => torneo({ estado: 'parcial', error: 'HTTP 503 en una página del índice' }),
      conciliar: async () => [escribir('a')],
    });
    const r = await ejecutarEngardeTorneo(d, 'org', 'evt', '2024');
    expect(resultados.size).toBe(1);
    expect(r.estado).toBe('error');
    expect(r.tecnico?.status).toBe(503);
  });

  it('un candidato ambiguo en revisión persiste URL, motivo y estado, y reemplaza el completo viejo', async () => {
    const { d, coberturas, resultados } = deps({
      conciliar: async () => [
        escribir('a', {
          canonica: null,
          plan: { accion: 'revision', motivos: ['dos_canonicas', 'fecha_distinta'] },
        }),
      ],
    });
    coberturas.set('engarde|2024|results|a', { season: '2024', factKind: 'results', competitionKey: 'a', competitionId: 'c1', status: 'completo' } as FilaCoberturaGenerica);
    const r = await ejecutarEngardeTorneo(d, 'org', 'evt', '2024');
    const fila = coberturas.get('engarde|2024|results|a');
    expect(fila).toMatchObject({
      status: 'conflicto',
      sourceUrl: 'https://engarde-service.com/a',
      cursor: 'revision',
      competitionId: null,
    });
    expect(fila?.lastError).toContain('dos_canonicas');
    expect(resultados.size).toBe(0);
    expect(r.estado).toBe('parcial');
  });

  it('todo cerrado de verdad sí es completo', async () => {
    const { d } = deps({
      conciliar: async () => [
        escribir('a', { cuadro: { lectura: { estado: 'completo' }, plan: { accion: 'escribir', fase: 'TABLEAU', cobertura: 'completo', publicado: 1, asaltos: [asalto] } } }),
        escribir('b', { plan: { accion: 'sin_cambios', motivo: 'ya_canonico' } }),
      ],
    });
    expect((await ejecutarEngardeTorneo(d, 'org', 'evt', '2024')).estado).toBe('completo');
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

describe('FWW: parciales con señal técnica y fallos no técnicos', () => {
  const urls = { poules: ['https://www.fencingworldwide.com/en/123-2024/pools/1'], cuadro: [] as string[] };
  const fasesCon = (poules: unknown) => async () =>
    ({ poules, cuadro: { lectura: { estado: 'completo' }, candidato: null, plan: { accion: 'sin_hechos', estado: 'no_publicado', motivo: 'sin cuadro' } } }) as never;

  it('poules parciales por 429 conservan lo escrito y suben la señal técnica con su Retry-After', async () => {
    const { d, asaltos } = deps({
      leerResultadosFww: async () => lecturaFww(),
      conciliarAsaltosFww: fasesCon({
        lectura: { estado: 'parcial', motivo: 'HTTP 429 en pools/2 (Retry-After: 5s)' },
        candidato: cand('pools'),
        plan: { accion: 'escribir', fase: 'POULE', cobertura: 'parcial', publicado: 4, asaltos: [{ ...asalto, fase: 'POULE', ronda: 'P1' }] },
      }),
    });
    const r = await ejecutarFwwPrueba(d, { canonica: canonica(), resultadosUrl: URL_RES, urls });
    expect(asaltos.size).toBe(1);
    expect(r.estado).toBe('error');
    expect(r.tecnico).toEqual({ status: 429, retryAfterMs: 5000 });
  });

  it('un 403 en la clasificación deja cobertura error y la unidad en error, nunca completa por «sin cerrar 0»', async () => {
    const { d } = deps({
      leerResultadosFww: async () => lecturaFww({ estado: 'error', pagina: null, httpStatus: 403, motivo: 'HTTP 403 al pedir la prueba' }),
    });
    const r = await ejecutarFwwPrueba(d, { canonica: canonica(), resultadosUrl: URL_RES, urls: { poules: [], cuadro: [] } });
    expect(r.estado).toBe('error');
    expect(r.estado).not.toBe('completo');
    expect(r.tecnico).toBeUndefined();
  });

  it('un 403 en un cuadro con finales completos no cierra la unidad', async () => {
    const { d } = deps({
      leerResultadosFww: async () => lecturaFww(),
      conciliarAsaltosFww: async () =>
        ({
          poules: { lectura: { estado: 'completo' }, candidato: null, plan: { accion: 'sin_hechos', estado: 'sin_resultados', motivo: null } },
          cuadro: { lectura: { estado: 'error' }, candidato: cand('cuadro'), plan: { accion: 'sin_hechos', estado: 'error', motivo: 'HTTP 403 en direct/2' } },
        }) as never,
    });
    const r = await ejecutarFwwPrueba(d, { canonica: canonica(), resultadosUrl: URL_RES, urls: { poules: urls.poules, cuadro: ['https://www.fencingworldwide.com/en/123-2024/direct/2'] } });
    expect(r.estado).toBe('error');
  });
});
