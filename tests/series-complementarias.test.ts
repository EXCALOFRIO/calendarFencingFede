import { describe, expect, it } from 'vitest';
import {
  agruparEdiciones,
  clasificarSerie,
  pruebaDeSerieFie,
  resumirSeries,
} from '@/lib/ingest/series-complementarias';

const fie = (extra: Record<string, unknown>) => ({
  competitionId: 1139,
  season: 2022,
  name: 'Jeux méditerranéens',
  type: 'I',
  category: 'Senior',
  competitionCategory: 'A',
  location: 'Orán',
  country: 'ALG',
  federation: 'Algérie',
  startDate: '2022-06-26',
  weapon: 'E',
  gender: 'M',
  tournamentId: null,
  ...extra,
});

describe('clasificarSerie', () => {
  it('separa Juegos Olímpicos, Juegos Mediterráneos y Campeonato del Mediterráneo', () => {
    expect(clasificarSerie({ nombre: 'Paris 2024', categoriaCompeticion: 'JO' })).toBe('juegos_olimpicos');
    expect(clasificarSerie({ nombre: 'Jeux Olympiques Tokyo' })).toBe('juegos_olimpicos');
    expect(clasificarSerie({ nombre: 'Jeux méditerranéens' })).toBe('juegos_mediterraneos');
    expect(clasificarSerie({ nombre: 'Mediterranean Games Taranto 2026' })).toBe('juegos_mediterraneos');
    expect(clasificarSerie({ nombre: 'Mediterranean Fencing Championship U20,U17,U15' })).toBe(
      'campeonato_mediterraneo',
    );
    expect(clasificarSerie({ nombre: 'MEDITERRANEAN CHAMPIONSHIP 2024' })).toBe('campeonato_mediterraneo');
  });

  it('no adivina: nombre ambiguo, sin relación o Juegos Olímpicos de la Juventud dan null', () => {
    expect(clasificarSerie({ nombre: 'Mediterranean Games Championship' })).toBeNull();
    expect(clasificarSerie({ nombre: 'Copa del Mediterráneo' })).toBeNull();
    expect(clasificarSerie({ nombre: 'Campeonato de Madrid ABS 2019' })).toBeNull();
    expect(clasificarSerie({ nombre: 'Youth Olympic Games', categoriaCompeticion: 'JO' })).toBeNull();
    expect(clasificarSerie({})).toBeNull();
  });
});

describe('pruebaDeSerieFie y agrupación', () => {
  it('conserva sólo lo publicado: sin categorías ni modalidades supuestas', () => {
    const p = pruebaDeSerieFie(fie({ category: null, type: null, weapon: null }))!;
    expect(p.serie).toBe('juegos_mediterraneos');
    expect(p.categoria).toBeNull();
    expect(p.formato).toBeNull();
    expect(p.arma).toBeNull();
    expect(p.resultados).toBe('pendiente');
  });

  it('descarta filas que no son de ninguna serie o que no tienen la forma esperada', () => {
    expect(pruebaDeSerieFie(fie({ name: 'Grand Prix Doha', competitionCategory: 'GP' }))).toBeNull();
    expect(pruebaDeSerieFie({ name: 'x' })).toBeNull();
  });

  it('no mezcla ediciones que reutilizan competitionId entre temporadas', () => {
    const pruebas = [
      pruebaDeSerieFie(fie({ season: 2018, location: 'Tarragona', startDate: '2018-06-24' })),
      pruebaDeSerieFie(fie({ season: 2022 })),
      pruebaDeSerieFie(fie({ season: 2026, location: 'Taranto', tournamentId: 88, startDate: '2026-08-22' })),
      pruebaDeSerieFie(fie({ season: 2022, competitionId: 1140, weapon: 'F' })),
    ].filter((p) => p !== null);
    const ediciones = agruparEdiciones(pruebas);
    expect(ediciones).toHaveLength(3);
    const e2022 = ediciones.find((e) => e.season === '2022')!;
    expect(e2022.pruebas.map((p) => p.clavePrueba)).toEqual(['1139', '1140']);
    expect(e2022.inicio).toBe('2022-06-26');
  });

  it('una prueba repetida no suma dos veces', () => {
    const p = pruebaDeSerieFie(fie({}))!;
    expect(agruparEdiciones([p, p])[0].pruebas).toHaveLength(1);
  });

  it('los Juegos Olímpicos (tournamentId null) de Tokio y París son ediciones distintas con el mismo competitionId', () => {
    const jo = (season: number, ciudad: string) =>
      pruebaDeSerieFie(
        fie({ competitionId: 246, season, name: ciudad, competitionCategory: 'JO', location: ciudad }),
      )!;
    const ediciones = agruparEdiciones([jo(2021, 'Tokyo'), jo(2024, 'Paris')]);
    expect(ediciones).toHaveLength(2);
    expect(new Set(ediciones.map((e) => e.serie))).toEqual(new Set(['juegos_olimpicos']));
  });

  it('resumirSeries devuelve las tres series siempre distintas y sólo lo observado', () => {
    const resumen = resumirSeries([
      pruebaDeSerieFie(fie({}))!,
      pruebaDeSerieFie(fie({ competitionId: 246, season: 2024, name: 'Paris', competitionCategory: 'JO', location: 'Paris' }))!,
    ]);
    expect(resumen.map((s) => s.serie)).toEqual([
      'juegos_olimpicos',
      'juegos_mediterraneos',
      'campeonato_mediterraneo',
    ]);
    const med = resumen.find((s) => s.serie === 'juegos_mediterraneos')!;
    expect(med.ediciones[0].armas).toEqual(['ESPADA']);
    expect(med.ediciones[0].resultados.pendiente).toBe(1);
    expect(resumen.find((s) => s.serie === 'campeonato_mediterraneo')!.ediciones).toEqual([]);
  });
});
