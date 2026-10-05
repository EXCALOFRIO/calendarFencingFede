import { describe, expect, it } from 'vitest';
import { hechosPrueba } from '@/lib/ingest/hechos/formato';
import {
  claveCompeticion, compacto, docIdDeUrl, extraerJson, fusionarTramos, necesitaEscalar, slugCohorte, tramos, validarExtraccion,
  type ContextoValidacion,
} from '../scripts/indexado/pdf-droids';

const URL_PDF = 'https://app.skermo.org/client/1/00c572da173a6c264cc9e3d88ac356fc.pdf';
const SHA = 'a'.repeat(64);

const ctx = (paginas: string[], extra: Partial<ContextoValidacion> = {}): ContextoValidacion => ({
  url: URL_PDF, sha256: SHA, docId: '00c572da173a6c264cc9e3d88ac356fc', season: '2018-2019',
  editionName: 'TNR SENIOR MADRID', paginas, extractor: 'droid:gpt-6-luna', ...extra,
});

const TEXTO = [
  'TNR SENIOR MADRID FLORETE MASCULINO ABSOLUTO INDIVIDUAL 25 MAYO 2019 Clasificación final',
  '1 GARCÍA LÓPEZ, Juan CE MADRID 2 PÉREZ RUIZ, Pedro SALA VALENCIA 3 MARTÍN SOTO, Luis 3 ROMERO GIL, Ana',
  'Poule 1 GARCÍA LÓPEZ, Juan PÉREZ RUIZ, Pedro MARTÍN SOTO, Luis Tablón T4 Final',
].concat('relleno '.repeat(20));

const prueba = (extra: Record<string, unknown> = {}) => ({
  headerLines: ['TNR SENIOR MADRID', 'FLORETE MASCULINO', '25 MAYO 2019'],
  weapon: 'FLORETE', gender: 'M', category: 'ABS', categoryRaw: 'ABSOLUTO', format: 'INDIVIDUAL', date: '2019-05-25',
  publishedParticipants: null,
  status: { results: 'completo', pools: 'completo', tableau: 'completo' },
  results: [
    { position: 1, name: 'GARCÍA LÓPEZ, Juan', club: 'CE MADRID', country: 'ESP' },
    { position: 2, name: 'PÉREZ RUIZ, Pedro', club: 'SALA VALENCIA', country: null },
    { position: 3, name: 'MARTÍN SOTO, Luis', club: null, country: null },
    { position: 3, name: 'ROMERO GIL, Ana', club: null, country: null },
  ],
  pools: [{
    pool: 1, fencers: ['GARCÍA LÓPEZ, Juan', 'PÉREZ RUIZ, Pedro', 'MARTÍN SOTO, Luis'],
    bouts: [
      { aName: 'GARCÍA LÓPEZ, Juan', bName: 'PÉREZ RUIZ, Pedro', scoreA: 5, scoreB: 3, winner: 'A' },
      { aName: 'GARCÍA LÓPEZ, Juan', bName: 'MARTÍN SOTO, Luis', scoreA: 5, scoreB: 4, winner: 'A' },
      { aName: 'PÉREZ RUIZ, Pedro', bName: 'MARTÍN SOTO, Luis', scoreA: 2, scoreB: 5, winner: 'B' },
    ],
  }],
  tableau: [
    { round: 'T2', aName: 'GARCÍA LÓPEZ, Juan', bName: 'PÉREZ RUIZ, Pedro', scoreA: 15, scoreB: 12, winner: 'A' },
  ],
  ...extra,
});

describe('claves deterministas', () => {
  it('docIdDeUrl coincide con el del lector (sha256 de la URL sin fragmento)', () => {
    expect(docIdDeUrl(`${URL_PDF}#page=3`)).toBe(docIdDeUrl(URL_PDF));
    expect(docIdDeUrl(URL_PDF)).toMatch(/^url-[0-9a-f]{64}$/);
  });

  it('construye la clave de prueba como el lector local, con cohorte y sufijo de repetición', () => {
    const vistos = new Set<string>();
    const base = { weapon: 'ESPADA', gender: 'F', format: 'INDIVIDUAL', category: 'VET', cohorte: 'Categoría 1' };
    expect(claveCompeticion('doc1', base, vistos)).toBe('pdf:doc1:doc1:ESPADA:F:INDIVIDUAL:VET:CATEGORIA1');
    expect(claveCompeticion('doc1', base, vistos)).toBe('pdf:doc1:doc1:ESPADA:F:INDIVIDUAL:VET:CATEGORIA1~2');
    expect(claveCompeticion('doc1', { ...base, cohorte: null }, vistos)).toBe('pdf:doc1:doc1:ESPADA:F:INDIVIDUAL:VET:');
    expect(slugCohorte('Nacidos en 2005-2006 y anteriores')).toHaveLength(24);
  });
});

describe('validarExtraccion', () => {
  it('acepta una prueba coherente, calcula claves y referencias y pasa el esquema', () => {
    const v = validarExtraccion({ competitions: [prueba()] }, ctx(TEXTO));
    expect(v.hechos).toHaveLength(1);
    const h = hechosPrueba.parse(v.hechos[0]);
    expect(h.competition.competitionKey).toBe('pdf:00c572da173a6c264cc9e3d88ac356fc:00c572da173a6c264cc9e3d88ac356fc:FLORETE:M:INDIVIDUAL:ABS:');
    expect(h.edition.tournamentKey).toBe('pdf:00c572da173a6c264cc9e3d88ac356fc');
    expect(h.results.map((r) => r.factKey.split(':pdfd:')[1])).toEqual(['1', '2', '3-1', '3-2']);
    expect(h.bouts).toHaveLength(4);
    expect(h.bouts[0].aRef).toBe(h.results[0].factKey);
    expect(h.bouts[0].roundKey).toBe('P1');
    expect(h.bouts[0].winner).toBeNull();
    expect(h.status).toMatchObject({ results: 'completo', pools: 'completo', tableau: 'completo' });
    expect(v.descartes).toEqual({});
  });

  it('descarta nombres que no aparecen en el PDF y baja el estado a parcial', () => {
    const p = prueba();
    (p.results as unknown[]).push({ position: 5, name: 'INVENTADO NADIE', club: null, country: null });
    (p.tableau as unknown[]).push({ round: 'T4', aName: 'INVENTADO NADIE', bName: 'ROMERO GIL, Ana', scoreA: 15, scoreB: 3, winner: 'A' });
    const v = validarExtraccion({ competitions: [p] }, ctx(TEXTO));
    const h = v.hechos[0];
    expect(h.results).toHaveLength(4);
    expect(h.status.results).toBe('parcial');
    expect(h.status.tableau).toBe('parcial');
    expect(v.descartes.resultado_nombre_no_en_pdf).toBe(1);
    expect(v.descartes.cuadro_asalto_nombre_no_en_pdf).toBe(1);
  });

  it('descarta los asaltos de un cuadro individual incoherente (semifinal copiada como final con otro ganador)', () => {
    const p = prueba({
      tableau: [
        { round: 'T4', aName: 'GARCÍA LÓPEZ, Juan', bName: 'MARTÍN SOTO, Luis', scoreA: 15, scoreB: 8, winner: 'A' },
        { round: 'T4', aName: 'PÉREZ RUIZ, Pedro', bName: 'ROMERO GIL, Ana', scoreA: 15, scoreB: 10, winner: 'A' },
        { round: 'T2', aName: 'MARTÍN SOTO, Luis', bName: 'GARCÍA LÓPEZ, Juan', scoreA: 15, scoreB: 8, winner: 'A' },
      ],
    });
    const v = validarExtraccion({ competitions: [p] }, ctx(TEXTO));
    const h = v.hechos[0];
    expect(h.bouts.filter((b) => b.phase === 'TABLEAU').map((b) => b.roundKey)).toEqual(['T4']);
    expect(v.descartes).toMatchObject({ cuadro_pareja_repetida: 2 });
    expect(h.status.tableau).toBe('parcial');

    // En equipos los puestos se tiran y quien pierde sigue: no se toca.
    const equipos = validarExtraccion({ competitions: [{ ...p, format: 'EQUIPOS', pools: [] }] }, ctx(TEXTO));
    expect(equipos.descartes.cuadro_pareja_repetida).toBeUndefined();
  });

  it('no inventa puestos para las listas de ganadores y finalistas de un criterium', () => {
    const paginas = [
      'TNR SENIOR MADRID FLORETE MASCULINO ABSOLUTO INDIVIDUAL 25 MAYO 2019 Poule 1 Tablón T4 '.concat('relleno '.repeat(20)),
      'GANADORES Apellido Nombre Club GARCÍA LÓPEZ Juan CE MADRID PÉREZ RUIZ Pedro SALA VALENCIA ' +
        'FINALISTAS Apellido Nombre Club MARTÍN SOTO Luis ROMERO GIL Ana',
    ];
    const v = validarExtraccion({ competitions: [prueba()] }, ctx(paginas));
    const h = v.hechos[0];
    expect(h.results.map((r) => [r.position, r.positionRaw])).toEqual([
      [null, 'Ganador'], [null, 'Ganador'], [null, 'Finalista'], [null, 'Finalista'],
    ]);
    expect(h.status.notes).toContain('puestos_no_publicados_lista_ganadores_finalistas:4');
    expect(h.bouts.filter((b) => b.phase === 'TABLEAU')).toHaveLength(1);
    // Sin las dos listas, los puestos de la clasificación se conservan.
    expect(validarExtraccion({ competitions: [prueba()] }, ctx(TEXTO)).hechos[0].results[0].position).toBe(1);
  });

  it('sin fecha en el modelo ni en la cabecera toma la del catálogo nacional', () => {
    const p = prueba({ date: null, headerLines: ['TNR SENIOR MADRID', 'FLORETE MASCULINO'] });
    const v = validarExtraccion({ competitions: [p] }, ctx(TEXTO, {
      fechaCatalogo: (f) => (f.weapon === 'FLORETE' && f.gender === 'M' ? '2019-05-26' : null),
    }));
    expect(v.hechos[0].competition.date).toBe('2019-05-26');
  });

  it('rechaza marcadores fuera de rango, ganadores incoherentes y empates sin ganador', () => {
    const p = prueba({
      tableau: [
        { round: 'T2', aName: 'GARCÍA LÓPEZ, Juan', bName: 'PÉREZ RUIZ, Pedro', scoreA: 16, scoreB: 2, winner: 'A' },
        { round: 'T4', aName: 'GARCÍA LÓPEZ, Juan', bName: 'MARTÍN SOTO, Luis', scoreA: 15, scoreB: 10, winner: 'B' },
        { round: 'T4', aName: 'PÉREZ RUIZ, Pedro', bName: 'ROMERO GIL, Ana', scoreA: 9, scoreB: 9, winner: null },
        { round: 'T3', aName: 'PÉREZ RUIZ, Pedro', bName: 'ROMERO GIL, Ana', scoreA: 9, scoreB: 4, winner: 'A' },
      ],
    });
    const v = validarExtraccion({ competitions: [p] }, ctx(TEXTO));
    expect(v.hechos[0].bouts.filter((b) => b.phase === 'TABLEAU')).toHaveLength(0);
    expect(v.hechos[0].status.tableau).toBe('ilegible');
    expect(v.descartes).toMatchObject({
      cuadro_asalto_marcador_fuera_de_rango: 1,
      cuadro_asalto_ganador_incoherente: 1,
      cuadro_asalto_empate_sin_ganador: 1,
      cuadro_ronda_invalida: 1,
    });
  });

  it('conserva el ganador explícito sólo con marcador igualado', () => {
    const p = prueba({
      tableau: [{ round: 'T2', aName: 'GARCÍA LÓPEZ, Juan', bName: 'PÉREZ RUIZ, Pedro', scoreA: 14, scoreB: 14, winner: 'B' }],
    });
    const b = validarExtraccion({ competitions: [p] }, ctx(TEXTO)).hechos[0].bouts.at(-1);
    expect(b).toMatchObject({ scoreA: 14, scoreB: 14, winner: 'B' });
  });

  it('controla las poules: tiradores de la poule, duplicados y máximo n(n-1)/2', () => {
    const p = prueba({
      pools: [{
        pool: 1, fencers: ['GARCÍA LÓPEZ, Juan', 'PÉREZ RUIZ, Pedro'],
        bouts: [
          { aName: 'GARCÍA LÓPEZ, Juan', bName: 'PÉREZ RUIZ, Pedro', scoreA: 5, scoreB: 3, winner: 'A' },
          { aName: 'PÉREZ RUIZ, Pedro', bName: 'GARCÍA LÓPEZ, Juan', scoreA: 3, scoreB: 5, winner: 'B' },
          { aName: 'GARCÍA LÓPEZ, Juan', bName: 'MARTÍN SOTO, Luis', scoreA: 5, scoreB: 1, winner: 'A' },
        ],
      }, {
        pool: 2, fencers: [],
        bouts: [
          { aName: 'MARTÍN SOTO, Luis', bName: 'ROMERO GIL, Ana', scoreA: 5, scoreB: 1, winner: 'A' },
        ],
      }],
    });
    const v = validarExtraccion({ competitions: [p] }, ctx(TEXTO));
    const poules = v.hechos[0].bouts.filter((b) => b.phase === 'POULE');
    expect(poules.map((b) => b.roundKey)).toEqual(['P1', 'P2']);
    expect(v.descartes).toMatchObject({ poule_asalto_duplicado: 1, poule_tirador_fuera_de_poule: 1 });
    expect(v.hechos[0].status.pools).toBe('parcial');
  });

  it('usa una referencia por nombre normalizado cuando el tirador no está en la clasificación', () => {
    const p = prueba({ results: [] });
    const h = validarExtraccion({ competitions: [p] }, ctx(TEXTO)).hechos[0];
    expect(h.bouts[0].aRef).toBe(`${h.competition.competitionKey}:pdfd:n:GARCIA-LOPEZ-JUAN`);
    expect(h.status.results).toBe('sin_resultados');
  });

  it('descarta posiciones no monótonas y toda la clasificación si casi nada es contigua', () => {
    const p = prueba({
      results: [
        { position: 1, name: 'GARCÍA LÓPEZ, Juan' },
        { position: 3, name: 'PÉREZ RUIZ, Pedro' },
        { position: 2, name: 'MARTÍN SOTO, Luis' },
      ],
    });
    const v = validarExtraccion({ competitions: [p] }, ctx(TEXTO));
    expect(v.descartes.resultado_posicion_no_monotona).toBe(1);
    const q = prueba({
      results: [
        { position: 1, name: 'GARCÍA LÓPEZ, Juan' },
        { position: 7, name: 'PÉREZ RUIZ, Pedro' },
        { position: 9, name: 'MARTÍN SOTO, Luis' },
      ],
    });
    const w = validarExtraccion({ competitions: [q] }, ctx(TEXTO));
    expect(w.hechos[0].results).toHaveLength(0);
    expect(w.hechos[0].status.results).toBe('ilegible');
  });

  it('un nombre repetido descarta ambas filas sin desplazar las posiciones siguientes', () => {
    const p = prueba({
      results: [
        { position: 1, name: 'GARCÍA LÓPEZ, Juan' },
        { position: 2, name: 'PÉREZ RUIZ, Pedro' },
        { position: 3, name: 'PÉREZ RUIZ, Pedro' },
        { position: 4, name: 'MARTÍN SOTO, Luis' },
        { position: 5, name: 'ROMERO GIL, Ana' },
      ],
    });
    const v = validarExtraccion({ competitions: [p] }, ctx(TEXTO));
    expect(v.descartes.resultado_duplicado).toBe(2);
    expect(v.hechos[0].results.map((r) => r.position)).toEqual([1, 4, 5]);
    expect(v.hechos[0].status.notes.some((n) => n.startsWith('posiciones_con_huecos'))).toBe(false);
    expect(v.hechos[0].status.results).toBe('parcial');
  });

  it('la cabecera leída manda sobre el modelo para la clave', () => {
    const p = prueba({ category: 'M20' });
    const h = validarExtraccion({ competitions: [p] }, ctx(TEXTO)).hechos[0];
    expect(h.competition.category).toBe('ABS');
    expect(h.status.notes).toContain('conflicto_categoria_cabecera_modelo');
  });

  it('sin capa de texto nada se acepta y no se escala', () => {
    const v = validarExtraccion({ competitions: [prueba()] }, ctx(['']));
    expect(v.sinTexto).toBe(true);
    expect(v.hechos[0].results).toHaveLength(0);
    expect(v.hechos[0].status.results).toBe('ilegible');
    expect(necesitaEscalar(v)).toBe(false);
  });

  it('pide escalar si se descarta más del 15 %', () => {
    const p = prueba({ results: [{ position: 1, name: 'NADIE' }, { position: 2, name: 'NINGUNO' }] });
    expect(necesitaEscalar(validarExtraccion({ competitions: [p] }, ctx(TEXTO)))).toBe(true);
    expect(necesitaEscalar(validarExtraccion({ competitions: [prueba()] }, ctx(TEXTO)))).toBe(false);
    expect(necesitaEscalar(null)).toBe(true);
  });

  it('trocea por páginas y une la clasificación con los asaltos de cada tramo', () => {
    expect(tramos(19, 8)).toEqual([[1, 8], [9, 16], [17, 19]]);
    const p = prueba();
    const soloRes = { ...p, pools: [], tableau: [], status: { results: 'completo', pools: 'sin_resultados', tableau: 'sin_resultados' } };
    const cab = { headerLines: p.headerLines, weapon: 'FLORETE', gender: 'M', category: 'ABS', format: 'INDIVIDUAL', results: [] };
    const t1 = { competitions: [{ ...cab, status: { pools: 'completo', tableau: 'sin_resultados' },
      pools: [{ pool: 1, fencers: p.pools[0].fencers.slice(0, 2), bouts: p.pools[0].bouts.slice(0, 1) }], tableau: [] }] };
    const t2 = { competitions: [{ ...cab, status: { pools: 'completo', tableau: 'completo' },
      pools: [{ pool: 1, fencers: p.pools[0].fencers, bouts: p.pools[0].bouts }], tableau: p.tableau }] };
    const unido = fusionarTramos({ competitions: [soloRes] }, [t1, t2]);
    const v = validarExtraccion(unido, ctx(TEXTO));
    expect(v.hechos).toHaveLength(1);
    expect(v.hechos[0].results).toHaveLength(4);
    expect(v.hechos[0].bouts.filter((b) => b.phase === 'POULE')).toHaveLength(3);
    expect(v.hechos[0].bouts.filter((b) => b.phase === 'TABLEAU')).toHaveLength(1);
    expect(v.hechos[0].status).toMatchObject({ results: 'completo', pools: 'completo', tableau: 'completo' });
    expect(v.descartes).toEqual({});
  });

  it('extrae JSON aunque venga con vallas markdown', () => {
    expect(extraerJson('```json\n{"competitions": []}\n```')).toEqual({ competitions: [] });
    expect(extraerJson('{"competitions":[{"notes":["a}"]}]}]}')).toEqual({ competitions: [{ notes: ['a}'] }] });
    expect(() => extraerJson('{"competitions":[]}], "results": [1]}')).toThrow('respuesta_con_texto_tras_json');
    expect(compacto('de Núñez-Pérez, José')).toBe('DENUNEZPEREZJOSE');
  });
});
