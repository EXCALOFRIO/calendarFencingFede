import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  candidatoDeEngarde,
  candidatoDeFww,
  ciudadesCompatibles,
  cotejar,
  nombresEdicionCompatibles,
  planificarAsaltos,
  planificarComplemento,
  type EstadoAsaltosPrimarios,
  type LecturaAsaltosComplementaria,
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
import { parsearCuadroEngarde } from '@/lib/ingest/sources/engarde-cuadro';
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
    const base = canonica({ serie: null, nombreEdicion: 'World Cup of Switzerland', ciudad: 'Basel', fecha: '2026-01-02' });
    expect(cotejar(base, c).decision).toBe('aceptado');
    expect(cotejar({ ...base, arma: 'SABLE' }, c).decision).toBe('rechazado');
    expect(cotejar({ ...base, fecha: '2025-01-02' }, c).motivos).toContain('otra_edicion');
  });

  it('copiar la tupla deportiva (sede, fecha, arma, género, categoría, formato) no prueba la misma edición', () => {
    const pagina = parsearResultadosFww(fixture('fww-basel-u17-resultados.html'));
    const c = candidatoDeFww('https://www.fencingworldwide.com/en/926885-2025/results/', '926885-2025', pagina);
    const copiada = canonica({ serie: null, nombreEdicion: 'Bari Grand Prix', ciudad: 'Basel', fecha: '2026-01-02' });
    expect(cotejar(copiada, c)).toEqual({ decision: 'revision', motivos: ['edicion_no_verificable'] });
  });

  it('sin nombre de edición en algún lado y sin serie, la correspondencia no se puede verificar', () => {
    const pagina = parsearResultadosFww(fixture('fww-basel-u17-resultados.html'));
    const c = candidatoDeFww('https://www.fencingworldwide.com/en/926885-2025/results/', '926885-2025', pagina);
    const base = canonica({ serie: null, ciudad: 'Basel', fecha: '2026-01-02' });
    expect(cotejar({ ...base, nombreEdicion: null }, c).motivos).toContain('edicion_no_verificable');
    expect(cotejar({ ...base, nombreEdicion: 'World Cup of Switzerland' }, { ...c, nombreTorneo: null }).motivos).toContain('edicion_no_verificable');
  });

  it('el nombre de la edición coincide por palabras significativas, no por términos genéricos ni años', () => {
    expect(nombresEdicionCompatibles('Bari Grand Prix 2026', 'Grand Prix of BARI')).toBe(true);
    expect(nombresEdicionCompatibles('Copa de España Absoluta', 'Campeonato de Espana')).toBe(true);
    expect(nombresEdicionCompatibles('Bari Grand Prix', 'World Cup of Switzerland')).toBe(false);
    expect(nombresEdicionCompatibles('World Cup', 'World Cup 2026')).toBe(true);
    expect(nombresEdicionCompatibles('World Cup Bari', 'World Cup Basel')).toBe(false);
  });

  it('una serie conocida (Mediterráneo, JO) es la correspondencia de edición y no exige el nombre', () => {
    expect(cotejar(canonica({ nombreEdicion: null }), candidato({ nombreTorneo: null })).decision).toBe('aceptado');
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
      expect(r).toMatchObject({ accion: 'escribir', cobertura: 'completo' });
      if (r.accion === 'escribir') expect(r.puestos).toHaveLength(29);
    }
  });

  it('no duplica lo que la fuente prioritaria ya publica con los mismos participantes y puestos', () => {
    const primarios: ResultadosPrimarios = {
      estado: 'publicados',
      completo: true,
      puestos: puestos.map((p) => ({ posicion: p.posicion, pais: p.pais, nombre: p.nombre })),
    };
    expect(plan({ primarios })).toEqual({ accion: 'sin_cambios', motivo: 'ya_canonico' });
  });

  it('los nombres se comparan como palabras sin tildes ni orden (Skermo «APELLIDO, Nombre» frente a Engarde)', () => {
    const primarios: ResultadosPrimarios = {
      estado: 'publicados',
      completo: true,
      puestos: puestos.map((p) => ({ posicion: p.posicion, pais: p.pais, nombre: p.nombre.split(' ').reverse().join(', ') })),
    };
    expect(plan({ primarios })).toEqual({ accion: 'sin_cambios', motivo: 'ya_canonico' });
  });

  it('dos ESP que intercambian el 1 y el 2 no son ya canónicos: misma lista (puesto, país), otros participantes', () => {
    const dosEsp = [
      { clave: 'engarde:a|ESP', nombre: 'GARCIA Ana', pais: 'ESP', club: null, posicion: 1, posicionRaw: '1', equipo: false },
      { clave: 'engarde:b|ESP', nombre: 'LOPEZ Beatriz', pais: 'ESP', club: null, posicion: 2, posicionRaw: '2', equipo: false },
    ];
    const primarios: ResultadosPrimarios = {
      estado: 'publicados',
      completo: true,
      puestos: [
        { posicion: 1, pais: 'ESP', nombre: 'LOPEZ Beatriz' },
        { posicion: 2, pais: 'ESP', nombre: 'GARCIA Ana' },
      ],
    };
    const r = plan({ primarios, lec: { puestos: dosEsp } });
    expect(r.accion).toBe('conflicto');
    expect(r).not.toMatchObject({ accion: 'sin_cambios' });
  });

  it('sin nombre en la primaria no hay correspondencia verificable: revisión, nunca ya_canonico', () => {
    const primarios: ResultadosPrimarios = {
      estado: 'publicados',
      completo: true,
      puestos: puestos.map((p) => ({ posicion: p.posicion, pais: p.pais })),
    };
    expect(plan({ primarios })).toEqual({ accion: 'revision', motivos: ['participantes_no_verificables'] });
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

describe('asaltos complementarios: cobertura primaria por tipo de hecho', () => {
  const madrid = canonica({
    fuente: 'skermo_rfee',
    season: '2019',
    clave: 'mad1',
    serie: null,
    nombreEdicion: 'Campeonato de Madrid ABS 2019',
    ciudad: 'Rivas-Vaciamadrid',
    fecha: '2019-09-28',
    categoria: 'ABS',
  });
  const cand = (extra: Partial<CandidatoComplementario> = {}): CandidatoComplementario =>
    candidato({
      url: 'https://engarde-service.com/competition/fme/ctomadabs19/emabsind',
      clave: 'fme/ctomadabs19/emabsind',
      nombreTorneo: 'Campeonato de Madrid ABS 2019',
      ciudad: 'Rivas Vaci.',
      fecha: '2019-09-28',
      fechaPagina: '2019-09-28',
      categoria: 'ABS',
      serie: null,
      ...extra,
    });
  const asaltos = parsearCuadroEngarde(fixture('engarde-ctomadabs19-emabsind-cuadro.html'), { individual: true }).asaltos;
  const lecturaAsaltos: LecturaAsaltosComplementaria = { estado: 'completo', asaltos, publicado: 15, motivo: null };
  const plan = (primario: EstadoAsaltosPrimarios, extra: { lec?: Partial<LecturaAsaltosComplementaria>; cand?: Partial<CandidatoComplementario> } = {}) =>
    planificarAsaltos({
      prueba: madrid,
      candidato: cand(extra.cand),
      fase: 'TABLEAU',
      lectura: { ...lecturaAsaltos, ...extra.lec },
      primario,
    });

  it('finales completos de la primaria no bloquean un cuadro que la primaria no publica', () => {
    const clasif = puestosDeEngarde(parsearPaginaEngarde(fixture('engarde-ctomadabs19-emabsind-clasificacion.html')));
    const finalesCompletos: ResultadosPrimarios = {
      estado: 'publicados',
      completo: true,
      puestos: clasif.map((p) => ({ posicion: p.posicion, pais: p.pais, nombre: p.nombre })),
    };
    const finales = planificarComplemento({
      prueba: madrid,
      candidato: cand(),
      lectura: { estado: 'completo', puestos: clasif, motivo: null },
      primarios: finalesCompletos,
    });
    expect(finales).toEqual({ accion: 'sin_cambios', motivo: 'ya_canonico' });
    expect(plan('no_publicado')).toMatchObject({ accion: 'escribir', fase: 'TABLEAU', cobertura: 'completo', publicado: 15 });
  });

  it('cada hecho tiene su propia cobertura: cuadro publicado por la primaria no impide escribir poules', () => {
    expect(plan('publicado_completo')).toEqual({ accion: 'sin_cambios', motivo: 'primaria_publica' });
    const poules = planificarAsaltos({
      prueba: madrid,
      candidato: cand(),
      fase: 'POULE',
      lectura: { estado: 'completo', asaltos: [], publicado: 0, motivo: null },
      primario: 'sin_resultados',
    });
    expect(poules).toMatchObject({ accion: 'escribir', fase: 'POULE' });
  });

  it('desconocido, pendiente, error o parcial del mismo hecho se difiere sin inventar su ausencia', () => {
    expect(plan('desconocido')).toEqual({ accion: 'diferir', motivo: 'primaria_pendiente' });
    expect(plan('pendiente')).toEqual({ accion: 'diferir', motivo: 'primaria_pendiente' });
    expect(plan('error')).toEqual({ accion: 'diferir', motivo: 'primaria_con_error' });
    expect(plan('publicado_parcial')).toEqual({ accion: 'diferir', motivo: 'primaria_parcial' });
  });

  it('sólo escribe con la primaria sabiendo que no publica (no publicado o cero publicado)', () => {
    for (const p of ['no_publicado', 'sin_resultados'] as EstadoAsaltosPrimarios[]) {
      expect(plan(p).accion).toBe('escribir');
    }
  });

  it('error, no publicado y cero publicado de la fuente complementaria no escriben asaltos', () => {
    expect(plan('no_publicado', { lec: { estado: 'error', asaltos: [], motivo: 'HTTP 503' } })).toMatchObject({ accion: 'sin_hechos', estado: 'error' });
    expect(plan('no_publicado', { lec: { estado: 'no_publicado', asaltos: [], motivo: 'HTTP 404' } })).toMatchObject({ accion: 'sin_hechos', estado: 'no_publicado' });
    expect(plan('no_publicado', { lec: { estado: 'sin_resultados', asaltos: [], motivo: null } })).toMatchObject({ accion: 'sin_hechos', estado: 'sin_resultados' });
  });

  it('una lectura parcial escribe con cobertura parcial y el total publicado', () => {
    expect(plan('no_publicado', { lec: { estado: 'parcial', publicado: 18 } })).toMatchObject({ accion: 'escribir', cobertura: 'parcial', publicado: 18 });
  });

  it('equipos y relevos no producen H2H aunque la edición y la prueba cuadren', () => {
    const equipos = planificarAsaltos({
      prueba: { ...madrid, formato: 'EQUIPOS' },
      candidato: cand({ formato: 'EQUIPOS', formatoPagina: null }),
      fase: 'TABLEAU',
      lectura: lecturaAsaltos,
      primario: 'no_publicado',
    });
    expect(equipos).toEqual({ accion: 'rechazar', motivos: ['sin_asaltos_equipos'] });
  });

  it('otra edición se rechaza y una edición no verificable va a revisión antes de leer asaltos', () => {
    expect(plan('no_publicado', { cand: { fecha: '2018-09-28', fechaPagina: '2018-09-28' } }).accion).toBe('rechazar');
    expect(plan('no_publicado', { cand: { nombreTorneo: 'Gran Premio de Valencia' } })).toEqual({ accion: 'revision', motivos: ['edicion_no_verificable'] });
  });
});

describe('conciliarTorneoEngarde con cuadro individual', () => {
  const indice = parsearIndiceEngarde(fixture('engarde-indice-ctomadabs19.xml'));
  if (!indice.ok) throw new Error(indice.error);
  const torneo: LecturaTorneoEngarde = {
    org: 'fme',
    evt: 'ctomadabs19',
    url: 'https://engarde-service.com/tournament/fme/ctomadabs19',
    estado: 'ok',
    nombre: 'Campeonato de Madrid ABS 2019',
    pruebas: indice.pruebas,
    publicado: indice.pruebas.length,
    error: null,
  };
  const prueba = 'https://engarde-service.com/competition/fme/ctomadabs19/emabsind';
  const cuadroUrl = `${prueba}/tableau16.htm`;
  const clasificacion = fixture('engarde-ctomadabs19-emabsind-clasificacion.html').replace(
    '<div id="reloadable"',
    `<div id="reloadable"><a href="/competition/fme/ctomadabs19/emabsind/tableau16.htm">Tableau</a>`,
  );
  const depsMadrid = (cuadro: { status: number; body: string }): DepsEngarde & { pedidas: string[] } => {
    const pedidas: string[] = [];
    return {
      pedidas,
      get: async (url) => {
        pedidas.push(url);
        if (url === prueba) return { status: 200, body: clasificacion };
        if (url === cuadroUrl) return cuadro;
        return { status: 404, body: '' };
      },
      post: async () => ({ status: 500, body: '' }),
    };
  };
  const madrid = (primarios: ResultadosPrimarios, primariosAsaltos?: CanonicaConPrimarios['primariosAsaltos']): CanonicaConPrimarios => ({
    competitionId: 'c-mad',
    prueba: canonica({
      fuente: 'skermo_rfee',
      season: '2019',
      clave: 'mad1',
      serie: null,
      nombreEdicion: 'Campeonato de Madrid ABS 2019',
      ciudad: 'Rivas-Vaciamadrid',
      fecha: '2019-09-28',
      categoria: 'ABS',
    }),
    primarios,
    primariosAsaltos,
  });
  const CUADRO = fixture('engarde-ctomadabs19-emabsind-cuadro.html');
  const sinFinales: ResultadosPrimarios = { estado: 'sin_resultados' };

  it('lee el cuadro de la prueba cotejada y escribe sus 15 cruces si la primaria no lo publica', async () => {
    const deps = depsMadrid({ status: 200, body: CUADRO });
    const r = await conciliarTorneoEngarde(torneo, [madrid(sinFinales, { poules: 'pendiente', cuadro: 'no_publicado' })], deps);
    const x = r.find((e) => e.prueba.compe === 'emabsind')!;
    expect(x.plan.accion).toBe('escribir');
    expect(x.cuadro?.plan).toMatchObject({ accion: 'escribir', fase: 'TABLEAU', cobertura: 'completo', publicado: 15 });
    expect(deps.pedidas).toEqual([prueba, cuadroUrl]);
    if (x.cuadro?.plan.accion === 'escribir') {
      expect(x.cuadro.plan.asaltos.every((a) => a.url === cuadroUrl)).toBe(true);
    }
  });

  it('finales completos de la primaria no impiden escribir el cuadro; el cuadro desconocido se difiere', async () => {
    const clasif = puestosDeEngarde(parsearPaginaEngarde(clasificacion));
    const completos: ResultadosPrimarios = {
      estado: 'publicados',
      completo: true,
      puestos: clasif.map((p) => ({ posicion: p.posicion, pais: p.pais, nombre: p.nombre })),
    };
    const escribe = await conciliarTorneoEngarde(torneo, [madrid(completos, { poules: 'pendiente', cuadro: 'no_publicado' })], depsMadrid({ status: 200, body: CUADRO }));
    const a = escribe.find((e) => e.prueba.compe === 'emabsind')!;
    expect(a.plan).toEqual({ accion: 'sin_cambios', motivo: 'ya_canonico' });
    expect(a.cuadro?.plan.accion).toBe('escribir');

    const difiere = await conciliarTorneoEngarde(torneo, [madrid(completos)], depsMadrid({ status: 200, body: CUADRO }));
    expect(difiere.find((e) => e.prueba.compe === 'emabsind')!.cuadro?.plan).toEqual({ accion: 'diferir', motivo: 'primaria_pendiente' });
  });

  it('el contexto del cuadro leído se coteja: una fecha de otro año lo rechaza sin escribir', async () => {
    const otroAnio = CUADRO.replace('28 DE SEPTIEMBRE DE 2019', '28 DE SEPTIEMBRE DE 2018');
    const r = await conciliarTorneoEngarde(torneo, [madrid(sinFinales, { poules: 'pendiente', cuadro: 'no_publicado' })], depsMadrid({ status: 200, body: otroAnio }));
    expect(r.find((e) => e.prueba.compe === 'emabsind')!.cuadro?.plan.accion).toBe('rechazar');
  });

  it('cuadro 404 es no publicado y 500 error; ninguno escribe asaltos', async () => {
    const p404 = await conciliarTorneoEngarde(torneo, [madrid(sinFinales, { poules: 'pendiente', cuadro: 'no_publicado' })], depsMadrid({ status: 404, body: '' }));
    expect(p404.find((e) => e.prueba.compe === 'emabsind')!.cuadro?.plan).toMatchObject({ accion: 'sin_hechos', estado: 'no_publicado' });
    const p500 = await conciliarTorneoEngarde(torneo, [madrid(sinFinales, { poules: 'pendiente', cuadro: 'no_publicado' })], depsMadrid({ status: 500, body: '' }));
    expect(p500.find((e) => e.prueba.compe === 'emabsind')!.cuadro?.plan).toMatchObject({ accion: 'sin_hechos', estado: 'error' });
  });

  it('el mismo cruce con 15/1 y 15/2 en dos páginas ofrecidas no se escribe y la cobertura queda parcial', async () => {
    const otraUrl = `${prueba}/tableau128-32.htm`;
    const dosCuadros = clasificacion.replace('<div id="reloadable">', `<div id="reloadable"><a href="/competition/fme/ctomadabs19/emabsind/tableau128-32.htm">Tableau</a>`);
    const deps: DepsEngarde = {
      get: async (u) => {
        if (u === prueba) return { status: 200, body: dosCuadros };
        if (u === cuadroUrl) return { status: 200, body: CUADRO };
        if (u === otraUrl) return { status: 200, body: CUADRO.replace('15/1<', '15/2<') };
        return { status: 404, body: '' };
      },
      post: async () => ({ status: 500, body: '' }),
    };
    const r = await conciliarTorneoEngarde(torneo, [madrid(sinFinales, { poules: 'pendiente', cuadro: 'no_publicado' })], deps);
    const plan = r.find((e) => e.prueba.compe === 'emabsind')!.cuadro?.plan;
    expect(plan).toMatchObject({ accion: 'escribir', fase: 'TABLEAU', cobertura: 'parcial', publicado: 15 });
    if (plan?.accion === 'escribir') {
      expect(plan.asaltos).toHaveLength(14);
      expect(plan.asaltos.some((a) => a.ronda === 'T16' && [a.nombreA, a.nombreB].includes('APELLIDO2 Nombre2'))).toBe(false);
    }
  });

  it('una prueba por equipos de ese torneo nunca pide su cuadro', async () => {
    const deps = depsMadrid({ status: 200, body: CUADRO });
    await conciliarTorneoEngarde(
      torneo,
      [{ ...madrid(sinFinales, { poules: 'pendiente', cuadro: 'no_publicado' }), prueba: canonica({ season: '2019', clave: 'eq', serie: null, nombreEdicion: 'Campeonato de Madrid ABS 2019', ciudad: 'Rivas-Vaciamadrid', fecha: '2019-10-12', categoria: 'ABS', arma: 'FLORETE', formato: 'EQUIPOS' }) }],
      deps,
    );
    expect(deps.pedidas.some((u) => u.endsWith('tableau16.htm'))).toBe(false);
  });
});
