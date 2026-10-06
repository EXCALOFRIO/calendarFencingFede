import { describe, expect, it } from 'vitest';
import { prepararNombre, type PruebaNacional } from '../scripts/indexado/dedupe-pruebas';
import { claveUrl } from '../scripts/indexado/lote7-skermo-comun';
import {
  asaltoPresente,
  asaltoValido,
  casarConSkermo,
  conCategoriaDeSkermo,
  cubiertoPorHermanas,
  generoPrueba,
  prefiltroNombres,
  validarMarcadores,
} from '../scripts/indexado/lote7-skermo-engarde';
import type { HechosPrueba } from '../src/lib/ingest/hechos/formato';

const nombres = (...n: string[]) => n.map(prepararNombre);

const skermo = (id: string, gender: string, fecha: string, ...n: string[]): PruebaNacional => ({
  id, source: 'skermo_rfee', season: '2024-2025', competition_key: `RFEE:${id}`, edition_id: `ed-${id}`,
  weapon: 'ESPADA', gender, category: 'VET', fecha, url: null, resultados: n.length, conPuesto: n.length,
  asaltos: { POULE: 0, TABLEAU: 0 }, nombres: nombres(...n),
});

describe('lote 7 Skermo: huecos cubiertos por la lectura conjunta de veteranos', () => {
  it('da por cubierto un hueco cuyos tiradores tienen asaltos en otra edad del mismo día', () => {
    const hermana = { POULE: nombres('ANA PEREZ LOPEZ', 'LUIS GARCIA'), TABLEAU: nombres('ANA PEREZ LOPEZ') };
    expect(cubiertoPorHermanas({ nombres: nombres('PEREZ LOPEZ Ana'), faltan: ['POULE', 'TABLEAU'] }, [hermana])).toBe(true);
  });

  it('no lo da por cubierto si falta algún tirador o la fase', () => {
    const hermana = { POULE: nombres('ANA PEREZ LOPEZ'), TABLEAU: [] };
    expect(cubiertoPorHermanas({ nombres: nombres('ANA PEREZ LOPEZ', 'MARTA RUIZ'), faltan: ['POULE'] }, [hermana])).toBe(false);
    expect(cubiertoPorHermanas({ nombres: nombres('ANA PEREZ LOPEZ'), faltan: ['TABLEAU'] }, [hermana])).toBe(false);
    expect(cubiertoPorHermanas({ nombres: nombres('ANA PEREZ LOPEZ'), faltan: ['POULE'] }, [])).toBe(false);
  });
});

describe('lote 7 Skermo: emparejado Engarde-Skermo', () => {
  const v40 = skermo('1', 'M', '2025-04-05', 'JUAN SOLER', 'PEDRO MARIN', 'IVAN ROCA');
  const v50 = skermo('2', 'M', '2025-04-05', 'ANTONIO VIDAL', 'JOSE MORA');
  const otraFecha = skermo('3', 'M', '2025-04-12', 'JUAN SOLER', 'PEDRO MARIN', 'IVAN ROCA');
  const femenina = skermo('4', 'F', '2025-04-05', 'JUAN SOLER', 'PEDRO MARIN', 'IVAN ROCA');

  it('una prueba conjunta casa con todas sus edades', () => {
    const e = { weapon: 'ESPADA', gender: 'M', fecha: '2025-04-05', nombres: nombres('SOLER Juan', 'MARIN Pedro', 'ROCA Ivan', 'VIDAL Antonio', 'MORA Jose') };
    const r = casarConSkermo(e, [v40, v50, otraFecha, femenina]);
    expect(r.casan.map((s) => s.id).sort()).toEqual(['1', '2']);
    expect(r.cobertura).toBe(1);
  });

  it('un torneo regional con pocos tiradores en común no casa', () => {
    const e = { weapon: 'ESPADA', gender: 'M', fecha: '2025-04-05', nombres: nombres('SOLER Juan', 'A B', 'C D', 'E F', 'G H', 'I J') };
    expect(casarConSkermo(e, [v40, v50]).casan).toEqual([]);
  });

  it('el prefiltro busca las palabras del nombre en la página', () => {
    const html = '<table><tr><td>1</td><td>SOLER Juan</td></tr><tr><td>2</td><td>MAR&Iacute;N Pedro</td></tr></table>';
    expect(prefiltroNombres(html, [v40])).toBeCloseTo(2 / 3);
    expect(prefiltroNombres('<p>nada</p>', [v40])).toBe(0);
  });
});

describe('lote 7 Skermo: atributos de la prueba de Engarde', () => {
  it('el título «mixto» manda sobre el sexo del índice', () => {
    expect(generoPrueba({ genero: 'M', titulo: 'Florete mixto 30-40' }, 'M')).toBe('MIXTO');
    expect(generoPrueba({ genero: 'F', titulo: 'Espada femenina V40' }, 'F')).toBe('F');
  });

  it('toma la categoría unánime de Skermo cuando Engarde publica otra', () => {
    const h = {
      version: 1, source: 'engarde', extractor: 'lector_engarde', sourceUrl: 'https://engarde-service.com/competition/rfee/vet/sfv60_70',
      sourceSha256: 'b'.repeat(64),
      edition: { season: '2024-2025', tournamentKey: 'engarde:rfee/vet', name: 'V', startDate: null, endDate: null, city: null, countryCode: null },
      competition: { competitionKey: 'engarde:rfee/vet/sfv60_70', weapon: 'SABLE', gender: 'F', category: 'M17', categoryRaw: 'cadet', format: 'INDIVIDUAL', date: '2025-06-14' },
      status: { results: 'completo', pools: 'completo', tableau: 'completo', publishedParticipants: 0, notes: [] },
      results: [], bouts: [],
    } as HechosPrueba;
    const r = conCategoriaDeSkermo(h, [{ category: 'VET' }, { category: 'VET' }]);
    expect(r.competition.category).toBe('VET');
    expect(r.competition.categoryRaw).toBe('cadet');
    expect(r.status.notes.at(-1)).toMatch(/se toma VET/);
    expect(conCategoriaDeSkermo(h, [{ category: 'VET' }, { category: 'ABS' }]).competition.category).toBe('M17');
  });
});

describe('lote 7 Skermo: validación de marcadores', () => {
  it('acepta y rechaza según fase, ganador y tope de tocados', () => {
    expect(asaltoValido({ phase: 'POULE', scoreA: 5, scoreB: 3, winner: null })).toBe(true);
    expect(asaltoValido({ phase: 'POULE', scoreA: 6, scoreB: 3, winner: null })).toBe(false);
    expect(asaltoValido({ phase: 'POULE', scoreA: 2, scoreB: 2, winner: null })).toBe(false);
    expect(asaltoValido({ phase: 'POULE', scoreA: 2, scoreB: 2, winner: 'B' })).toBe(true);
    expect(asaltoValido({ phase: 'POULE', scoreA: 4, scoreB: 2, winner: 'B' })).toBe(false);
    expect(asaltoValido({ phase: 'TABLEAU', scoreA: 10, scoreB: 8, winner: null })).toBe(true);
    expect(asaltoValido({ phase: 'TABLEAU', scoreA: 16, scoreB: 8, winner: null })).toBe(false);
  });

  it('descarta los asaltos incoherentes y marca la fase como parcial', () => {
    const h: HechosPrueba = {
      version: 1, source: 'engarde', extractor: 'lector_engarde', sourceUrl: 'https://engarde-service.com/competition/rfee/x/y',
      sourceSha256: 'a'.repeat(64),
      edition: { season: '2024-2025', tournamentKey: 'engarde:rfee/x', name: 'X', startDate: null, endDate: null, city: null, countryCode: null },
      competition: { competitionKey: 'engarde:rfee/x/y', weapon: 'ESPADA', gender: 'M', category: 'VET', categoryRaw: null, format: 'INDIVIDUAL', date: '2025-04-05' },
      status: { results: 'completo', pools: 'completo', tableau: 'completo', publishedParticipants: 2, notes: [] },
      results: [],
      bouts: [
        { phase: 'POULE', roundKey: 'P1', aRef: 'a', bRef: 'b', aName: 'A', bName: 'B', scoreA: 5, scoreB: 1, winner: 'A' },
        { phase: 'POULE', roundKey: 'P1', aRef: 'a', bRef: 'c', aName: 'A', bName: 'C', scoreA: 3, scoreB: 3, winner: null },
        { phase: 'TABLEAU', roundKey: 'T2', aRef: 'a', bRef: 'b', aName: 'A', bName: 'B', scoreA: 10, scoreB: 9, winner: null },
      ],
    };
    const { hechos, descartados } = validarMarcadores(h);
    expect(descartados).toEqual({ POULE: 1, TABLEAU: 0 });
    expect(hechos.bouts).toHaveLength(2);
    expect(hechos.status.pools).toBe('parcial');
    expect(hechos.status.tableau).toBe('completo');
  });
});

describe('lote 7 Skermo: verificación de lecturas conjuntas', () => {
  // Así quedan en la base tras `prepararNombre`: primera palabra normalizada.
  const bd = [{ phase: 'POULE' as const, a: 'lenoir', sa: 5, b: 'iglesias', sb: 3 }];
  it('reconoce el asalto aunque el otro nombre venga recortado o en el otro orden', () => {
    expect(asaltoPresente({ phase: 'POULE', aName: 'IGLESIAS PÉREZ Francisco', scoreA: 3, bName: 'LENOIR Alexandre', scoreB: 5 }, bd)).toBe(true);
    expect(asaltoPresente({ phase: 'POULE', aName: 'LENOIR Alex', scoreA: 5, bName: 'IGLESIAS P.', scoreB: 3 }, bd)).toBe(true);
  });
  it('un marcador distinto o la otra fase cuentan como asalto que falta', () => {
    expect(asaltoPresente({ phase: 'POULE', aName: 'IGLESIAS PÉREZ Francisco', scoreA: 5, bName: 'LENOIR Alexandre', scoreB: 3 }, bd)).toBe(false);
    expect(asaltoPresente({ phase: 'TABLEAU', aName: 'LENOIR Alexandre', scoreA: 5, bName: 'IGLESIAS Francisco', scoreB: 3 }, bd)).toBe(false);
  });
});

describe('lote 7 Skermo: caché', () => {
  it('da una clave estable y distinta por URL', () => {
    const a = claveUrl('https://app.skermo.org/calendar/public/RFEE/results?setLang=es&season=3');
    expect(a).toBe(claveUrl('https://app.skermo.org/calendar/public/RFEE/results?setLang=es&season=3'));
    expect(a).not.toBe(claveUrl('https://app.skermo.org/calendar/public/RFEE/results?setLang=es&season=4'));
    expect(a.endsWith('.gz')).toBe(true);
  });
});
