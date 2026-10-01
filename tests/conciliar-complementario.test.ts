import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  candidatoDeEngarde,
  candidatoDeFww,
  ciudadesCompatibles,
  cotejar,
  planificarComplemento,
  type CandidatoComplementario,
  type LecturaComplementaria,
  type PruebaCanonica,
  type ResultadosPrimarios,
} from '@/lib/ingest/conciliar-complementario';
import { conciliarTorneoEngarde, type CanonicaConPrimarios } from '@/lib/ingest/conciliar-torneo-engarde';
import {
  parsearIndiceEngarde,
  parsearPaginaEngarde,
  puestosDeEngarde,
  type DepsEngarde,
  type LecturaTorneoEngarde,
} from '@/lib/ingest/sources/engarde';
import { parsearResultadosFww } from '@/lib/ingest/sources/fww';

const fixture = (n: string) => readFileSync(`tests/fixtures/complementarios/${n}`, 'utf8');

const canonica = (extra: Partial<PruebaCanonica> = {}): PruebaCanonica => ({
  fuente: 'skermo_rfee',
  season: '2024',
  clave: 'x1',
  serie: 'campeonato_mediterraneo',
  nombreEdicion: 'Campeonato del Mediterráneo',
  ciudad: 'La Nucía',
  fecha: '2024-02-03',
  arma: 'ESPADA',
  genero: 'M',
  categoria: 'M17',
  formato: 'INDIVIDUAL',
  ...extra,
});

const candidato = (extra: Partial<CandidatoComplementario> = {}): CandidatoComplementario => ({
  proveedor: 'engarde',
  url: 'https://engarde-service.com/competition/rfee/med2024/em17',
  clave: 'rfee/med2024/em17',
  nombreTorneo: 'MEDITERRANEAN CHAMPIONSHIP 2024',
  ciudad: 'LA NUCIA',
  fecha: '2024-02-03',
  fechaPagina: '2024-02-03',
  arma: 'ESPADA',
  genero: 'M',
  categoria: 'M17',
  formato: 'INDIVIDUAL',
  formatoPagina: 'INDIVIDUAL',
  serie: 'campeonato_mediterraneo',
  ...extra,
});

describe('cotejar', () => {
  it('acepta la misma prueba de la misma edición (ciudad sin tildes y mayúsculas)', () => {
    expect(cotejar(canonica(), candidato())).toEqual({ decision: 'aceptado', motivos: [] });
  });

  it('rechaza otra arma, género, categoría, modalidad o serie', () => {
    expect(cotejar(canonica(), candidato({ arma: 'FLORETE' })).motivos).toContain('arma_distinta');
    expect(cotejar(canonica(), candidato({ genero: 'F' })).motivos).toContain('genero_distinto');
    expect(cotejar(canonica(), candidato({ categoria: 'M15' })).motivos).toContain('categoria_distinta');
    expect(cotejar(canonica(), candidato({ formato: 'EQUIPOS', formatoPagina: 'EQUIPOS' })).motivos).toContain(
      'formato_distinto',
    );
    expect(cotejar(canonica(), candidato({ serie: 'juegos_mediterraneos' })).decision).toBe('rechazado');
  });

  it('un homónimo de otra edición (otro año o otra sede) se rechaza', () => {
    expect(cotejar(canonica(), candidato({ fecha: '2022-02-03', fechaPagina: '2022-02-03' })).motivos).toContain('otra_edicion');
    expect(cotejar(canonica(), candidato({ ciudad: 'Orán' })).motivos).toContain('otra_sede');
  });

  it('la fecha un día distinta se acepta; a dos días o más va a revisión', () => {
    expect(cotejar(canonica(), candidato({ fecha: '2024-02-04', fechaPagina: '2024-02-04' })).decision).toBe('aceptado');
    const c = cotejar(canonica(), candidato({ fecha: '2024-02-10', fechaPagina: '2024-02-10' }));
    expect(c).toEqual({ decision: 'revision', motivos: ['fecha_difiere'] });
  });

  it('un dato ausente en cualquier lado va a revisión, nunca se completa', () => {
    expect(cotejar(canonica({ categoria: null }), candidato()).motivos).toContain('dato_ausente:categoria');
    expect(cotejar(canonica(), candidato({ arma: null })).decision).toBe('revision');
    expect(cotejar(canonica({ ciudad: null }), candidato()).motivos).toContain('sede_no_verificable');
    expect(cotejar(canonica(), candidato({ serie: null })).motivos).toContain('serie_no_verificable');
  });

  it('la página de un equipo bajo un índice individual es contradictoria', () => {
    expect(cotejar(canonica(), candidato({ formatoPagina: 'EQUIPOS' })).motivos).toContain('formato_contradictorio');
  });

  it('las ciudades abreviadas por Engarde coinciden por prefijo de al menos cuatro letras', () => {
    expect(ciudadesCompatibles('Rivas Vaci.', 'Rivas-Vaciamadrid')).toBe(true);
    expect(ciudadesCompatibles('Rio', 'Rivas')).toBe(false);
    expect(ciudadesCompatibles('Bari', 'Paris')).toBe(false);
  });
});

describe('candidatos desde el HTML real', () => {
  it('Engarde Mediterráneo 2024: el candidato hereda serie del torneo y cuadra con la canónica', () => {
    const indice = parsearIndiceEngarde(fixture('engarde-indice-med2024.xml'));
    if (!indice.ok) throw new Error(indice.error);
    const em17 = indice.pruebas.find((p) => p.compe === 'em17')!;
    const pagina = parsearPaginaEngarde(fixture('engarde-med2024-em17-clasificacion.html'));
    const c = candidatoDeEngarde(em17, { nombreTorneo: 'MEDITERRANEAN CHAMPIONSHIP 2024', pagina });
    expect(c.serie).toBe('campeonato_mediterraneo');
    expect(c.formato).toBe('INDIVIDUAL');
    expect(c.formatoPagina).toBe('INDIVIDUAL');
    expect(cotejar(canonica(), c).decision).toBe('aceptado');
  });

  it('FWW Basel: cuadra con su prueba y se rechaza contra la de otra arma o edición', () => {
    const pagina = parsearResultadosFww(fixture('fww-basel-u17-resultados.html'));
    const c = candidatoDeFww('https://www.fencingworldwide.com/en/926885-2025/results/', '926885-2025', pagina);
    const base = canonica({ serie: null, ciudad: 'Basel', fecha: '2026-01-02' });
    expect(cotejar(base, c).decision).toBe('aceptado');
    expect(cotejar({ ...base, arma: 'SABLE' }, c).decision).toBe('rechazado');
    expect(cotejar({ ...base, fecha: '2025-01-02' }, c).motivos).toContain('otra_edicion');
  });
});

describe('planificarComplemento', () => {
  const pagina = parsearPaginaEngarde(fixture('engarde-med2024-em17-clasificacion.html'));
  const puestos = puestosDeEngarde(pagina);
  const lectura: LecturaComplementaria = { estado: 'completo', puestos, motivo: null };
  const plan = (extra: {
    cand?: Partial<CandidatoComplementario>;
    lec?: Partial<LecturaComplementaria>;
    primarios: ResultadosPrimarios;
  }) =>
    planificarComplemento({
      prueba: canonica(),
      candidato: candidato(extra.cand),
      lectura: { ...lectura, ...extra.lec },
      primarios: extra.primarios,
    });

  it('escribe los puestos cuando la fuente prioritaria sabe que no publica la prueba', () => {
    for (const primarios of [{ estado: 'sin_prueba' }, { estado: 'sin_resultados' }, { estado: 'no_publicado' }] as ResultadosPrimarios[]) {
      const r = plan({ primarios });
      expect(r).toMatchObject({ accion: 'escribir', cobertura: 'completo', asaltos: 'no_importados' });
      if (r.accion === 'escribir') expect(r.puestos).toHaveLength(29);
    }
  });

  it('no duplica lo que la fuente prioritaria ya publica con los mismos puestos', () => {
    const primarios: ResultadosPrimarios = {
      estado: 'publicados',
      completo: true,
      puestos: puestos.map((p) => ({ posicion: p.posicion, pais: p.pais })),
    };
    expect(plan({ primarios })).toEqual({ accion: 'sin_cambios', motivo: 'ya_canonico' });
  });

  it('puestos distintos entre fuentes es un conflicto, no una sobreescritura', () => {
    const r = plan({ primarios: { estado: 'publicados', completo: true, puestos: [{ posicion: 1, pais: 'FRA' }] } });
    expect(r.accion).toBe('conflicto');
  });

  it('difiere mientras la fuente prioritaria está pendiente, parcial o con error', () => {
    expect(plan({ primarios: { estado: 'pendiente' } })).toEqual({ accion: 'diferir', motivo: 'primaria_pendiente' });
    expect(plan({ primarios: { estado: 'error' } })).toEqual({ accion: 'diferir', motivo: 'primaria_con_error' });
    expect(plan({ primarios: { estado: 'publicados', completo: false, puestos: [] } })).toEqual({
      accion: 'diferir',
      motivo: 'primaria_parcial',
    });
  });

  it('no mezcla un cuadro de equipos con un H2H: puestos de equipo bajo prueba individual van a revisión', () => {
    const equipos = puestosDeEngarde(parsearPaginaEngarde(fixture('engarde-med2024-mt-equipos.html')));
    const r = plan({ primarios: { estado: 'sin_resultados' }, lec: { puestos: equipos } });
    expect(r).toEqual({ accion: 'revision', motivos: ['formato_contradictorio'] });
  });

  it('rechaza o manda a revisión antes de mirar los resultados', () => {
    expect(plan({ cand: { fecha: '2022-02-03', fechaPagina: '2022-02-03' }, primarios: { estado: 'sin_resultados' } }).accion).toBe('rechazar');
    expect(plan({ cand: { categoria: null }, primarios: { estado: 'sin_resultados' } }).accion).toBe('revision');
  });

  it('error, no publicado y cero publicado son salidas distintas y no escriben hechos', () => {
    const base = { primarios: { estado: 'sin_resultados' } as ResultadosPrimarios };
    expect(plan({ ...base, lec: { estado: 'error', puestos: [], motivo: 'HTTP 503' } })).toMatchObject({ accion: 'sin_hechos', estado: 'error' });
    expect(plan({ ...base, lec: { estado: 'no_publicado', puestos: [], motivo: 'HTTP 404' } })).toMatchObject({ accion: 'sin_hechos', estado: 'no_publicado' });
    expect(plan({ ...base, lec: { estado: 'sin_resultados', puestos: [], motivo: null } })).toMatchObject({ accion: 'sin_hechos', estado: 'sin_resultados' });
  });

  it('una lectura parcial escribe con cobertura parcial', () => {
    expect(plan({ primarios: { estado: 'sin_resultados' }, lec: { estado: 'parcial' } })).toMatchObject({ accion: 'escribir', cobertura: 'parcial' });
  });
});

describe('conciliarTorneoEngarde', () => {
  const indice = parsearIndiceEngarde(fixture('engarde-indice-med2024.xml'));
  if (!indice.ok) throw new Error(indice.error);
  const torneo: LecturaTorneoEngarde = {
    org: 'rfee',
    evt: 'med2024',
    url: 'https://engarde-service.com/tournament/rfee/med2024',
    estado: 'ok',
    nombre: 'MEDITERRANEAN CHAMPIONSHIP 2024',
    pruebas: indice.pruebas,
    publicado: 14,
    error: null,
  };
  const pedidas: string[] = [];
  const deps: DepsEngarde = {
    get: async (url) => {
      pedidas.push(url);
      return url.endsWith('/em17')
        ? { status: 200, body: fixture('engarde-med2024-em17-clasificacion.html') }
        : { status: 404, body: '' };
    },
    post: async () => ({ status: 500, body: '' }),
  };
  const conPrimarios = (extra: Partial<PruebaCanonica>, primarios: ResultadosPrimarios): CanonicaConPrimarios => ({
    competitionId: 'c-1',
    prueba: canonica(extra),
    primarios,
  });

  it('sólo lee y escribe la prueba que tiene UNA canónica compatible; el resto queda sin canónica', async () => {
    pedidas.length = 0;
    const r = await conciliarTorneoEngarde(torneo, [conPrimarios({}, { estado: 'sin_resultados' })], deps);
    expect(r).toHaveLength(14);
    expect(pedidas).toEqual(['https://engarde-service.com/competition/rfee/med2024/em17']);
    expect(r.find((x) => x.prueba.compe === 'em17')!.plan.accion).toBe('escribir');
    expect(r.filter((x) => x.plan.accion === 'sin_canonica')).toHaveLength(13);
  });

  it('dos canónicas compatibles son ambiguas: revisión, sin lectura', async () => {
    pedidas.length = 0;
    const r = await conciliarTorneoEngarde(
      torneo,
      [conPrimarios({ clave: 'a' }, { estado: 'sin_resultados' }), conPrimarios({ clave: 'b' }, { estado: 'sin_resultados' })],
      deps,
    );
    const em17 = r.find((x) => x.prueba.compe === 'em17')!;
    expect(em17.plan).toEqual({ accion: 'revision', motivos: ['canonica_ambigua'] });
    expect(pedidas).toEqual([]);
  });

  it('una canónica de otra edición no se une aunque coincida el resto', async () => {
    pedidas.length = 0;
    const r = await conciliarTorneoEngarde(
      torneo,
      [conPrimarios({ fecha: '2022-06-26', season: '2022', ciudad: 'Orán', serie: 'juegos_mediterraneos' }, { estado: 'sin_resultados' })],
      deps,
    );
    expect(r.every((x) => x.canonica === null && x.plan.accion === 'sin_canonica')).toBe(true);
    expect(pedidas).toEqual([]);
  });
});
