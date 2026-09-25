import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  parseSkermoRankingCategories,
  rankingCombos,
  rankingContentHash,
  puestoPublicado,
  skermoRankingFormUrl,
  validateRankingRows,
} from '@/lib/ingest/sources/ranking-rfee';
import {
  parseSkermoNationalRanking,
  parseSkermoRankingAthlete,
  parseSkermoSeasons,
  skermoNationalRankingUrl,
} from '@/lib/ingest/sources/skermo-results';

/**
 * Tests del ranking nacional oficial de la RFEE contra HTML REAL guardado.
 *
 * Los dos fixtures son respuestas literales del 25/09/2026:
 *
 * - `skermo-ranking-rfee-espada-m20-f.html.gz`
 *   `…/ranking-rfee/public/RFEE?setLang=es&season=17&weapon=E&category=6&gender=W`
 *   80 puestos de espada M20 femenino.
 * - `skermo-ranking-atleta-366.html.gz`
 *   `…/ranking-rfee/public/RFEE/366?setLang=es&…`
 *   La ficha de la número 1. Es la ÚNICA pantalla que publica la licencia.
 *
 * Que esto pase en verde es la demostración de que el ranking es ingerible:
 * viene renderizado en servidor, se lee con cheerio y trae todo lo que hace
 * falta salvo la licencia, que está a una pantalla de distancia.
 */

function fixture(name: string): string {
  return gunzipSync(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url)),
  ).toString('utf8');
}

const RANKING = fixture('skermo-ranking-rfee-espada-m20-f.html.gz');
const FICHA = fixture('skermo-ranking-atleta-366.html.gz');

describe('la página del ranking viene renderizada en servidor', () => {
  it('trae las 80 filas ya en el HTML, sin AJAX ni JSON', () => {
    const { rows, rowsSeen, mismatches } = parseSkermoNationalRanking(RANKING, {
      federationCode: 'RFEE',
    });
    expect(rowsSeen).toBe(80);
    expect(rows).toHaveLength(80);
    // Cero descuadres entre `<th>` y `<td>`: las columnas se leen por
    // etiqueta, no por posición, y aquí se comprueba que siguen cuadrando.
    expect(mismatches).toBe(0);
  });

  it('no tiene paginación: el ranking entero cabe en una respuesta', () => {
    expect(RANKING).not.toContain('?page=2');
  });
});

describe('los selectores se leen de la página, no se escriben en el código', () => {
  it('saca las diez temporadas con su id interno', () => {
    const temporadas = parseSkermoSeasons(RANKING);
    expect(temporadas.length).toBeGreaterThanOrEqual(10);
    const actual = temporadas.find((t) => t.selected);
    expect(actual?.label).toBe('2026-2027');
    // El id de temporada de Skermo no es el año: es su clave interna.
    expect(actual?.value).toBe('17');
  });

  it('saca las categorías del ranking, que NO son las del calendario', () => {
    const categorias = parseSkermoRankingCategories(RANKING);
    const etiquetas = categorias.map((c) => c.label);
    expect(etiquetas).toEqual([
      'M13',
      'M15',
      'M17',
      'M20',
      'ABS',
      'VET30',
      'VET40',
      'VET50',
      'VET60',
      'VET70',
    ]);
    // Aquí no hay M9, M11 ni M14, aunque el calendario sí las ofrezca.
    expect(etiquetas).not.toContain('M14');
    expect(categorias.find((c) => c.label === 'M20')?.value).toBe('6');
  });

  it('el producto cartesiano son 60 peticiones por temporada', () => {
    const combos = rankingCombos(parseSkermoRankingCategories(RANKING));
    expect(combos).toHaveLength(60);
    expect(new Set(combos.map((c) => c.weapon)).size).toBe(3);
    expect(new Set(combos.map((c) => c.gender)).size).toBe(2);
  });
});

describe('la URL lleva SIEMPRE los cuatro filtros', () => {
  it('sin ellos la tabla llega vacía, así que no son opcionales', () => {
    const url = skermoNationalRankingUrl('RFEE', {
      season: '17',
      weapon: 'E',
      category: '6',
      gender: 'W',
    });
    expect(url).toContain('season=17');
    expect(url).toContain('weapon=E');
    expect(url).toContain('category=6');
    expect(url).toContain('gender=W');
    expect(url).toContain('setLang=es');
  });

  it('la página del formulario apunta a la federación pedida', () => {
    expect(skermoRankingFormUrl('RFEE')).toBe(
      'https://app.skermo.org/ranking-rfee/public/RFEE?setLang=es',
    );
  });
});

describe('lectura de una fila', () => {
  const { rows } = parseSkermoNationalRanking(RANKING, { federationCode: 'RFEE' });

  it('lee puesto, nombre, club, fecha y puntuación en formato español', () => {
    expect(rows[0].position).toBe(1);
    expect(rows[0].sourceAthleteName).toBe('SILVIA GÓMEZ LÓPEZ');
    // "3.530,79" -> "3530.79": punto de millar y coma decimal españoles.
    expect(rows[0].totalPoints).toBe('3530.79');
    expect(rows[0].sourceBirthDate).toBe('2007-04-11');
    expect(rows[0].sourceClub).toBe('CELC-M');
  });

  it('los puestos van del 1 al 80 sin saltos ni repetidos', () => {
    const puestos = rows.map((r) => r.position);
    expect(puestos).toEqual(Array.from({ length: 80 }, (_, i) => i + 1));
  });

  it('guarda el id de Skermo, que es lo que permite ir a su ficha', () => {
    expect(rows[0].skermoAthleteId).toBe('366');
    expect(rows[0].athleteUrl).toContain('/ranking-rfee/public/RFEE/366');
    expect(rows.every((r) => r.skermoAthleteId)).toBe(true);
  });
});

describe('validación y cuarentena', () => {
  const { rows } = parseSkermoNationalRanking(RANKING, { federationCode: 'RFEE' });

  it('las 80 filas reales pasan la validación', () => {
    const { valid, quarantined } = validateRankingRows(rows, { clave: 'prueba' });
    expect(valid).toHaveLength(80);
    expect(quarantined).toEqual([]);
  });

  it('una fila sin nombre o sin id NO entra en el ranking: va a cuarentena', () => {
    const rotas = [
      { ...rows[0], position: -3 },
      { ...rows[1], sourceAthleteName: '' },
      { ...rows[2], skermoAthleteId: null },
    ];
    const { valid, quarantined } = validateRankingRows(rotas, { clave: 'prueba' });
    expect(valid).toHaveLength(0);
    expect(quarantined).toHaveLength(3);
    expect(quarantined[0].errors.length).toBeGreaterThan(0);
  });

  it('"sin clasificar" (el puesto 9999 de Skermo) SÍ es una fila válida', () => {
    /**
     * 292 de las 1.235 filas del ranking real están así: el tirador consta,
     * con 0 puntos y sin puesto. Mandarlas a cuarentena sería perder a un
     * cuarto del ranking; guardarles el 9999 sería inventarles un puesto.
     */
    const { valid } = validateRankingRows([{ ...rows[0], position: null }], {
      clave: 'prueba',
    });
    expect(valid).toHaveLength(1);
    expect(puestoPublicado(9999)).toBeNull();
    expect(puestoPublicado(12)).toBe(12);
  });

  it('"sin puntuación" no se convierte en cero', () => {
    const sinPuntos = { ...rows[0], totalPoints: null };
    const { valid } = validateRankingRows([sinPuntos], { clave: 'prueba' });
    expect(valid[0].totalPoints).toBeNull();
  });
});

describe('idempotencia', () => {
  it('el hash no cambia si la fila no cambia', async () => {
    const fila = {
      position: 1,
      sourceAthleteName: 'SILVIA GÓMEZ LÓPEZ',
      sourceClub: 'CELC-M',
      totalPoints: '3530.79',
      skermoAthleteId: '366',
    };
    expect(await rankingContentHash(fila)).toBe(await rankingContentHash(fila));
  });

  it('el hash SÍ cambia si cambian los puntos', async () => {
    const base = {
      position: 1,
      sourceAthleteName: 'SILVIA GÓMEZ LÓPEZ',
      sourceClub: 'CELC-M',
      totalPoints: '3530.79',
      skermoAthleteId: '366',
    };
    expect(await rankingContentHash(base)).not.toBe(
      await rankingContentHash({ ...base, totalPoints: '3600.00' }),
    );
  });
});

/**
 * Este bloque es el que justifica todo el diseño del emparejado: la tabla del
 * ranking NO trae licencia y la ficha SÍ. Por eso hay una segunda petición
 * por tirador, con presupuesto, y por eso no se empareja por nombre.
 */
describe('la licencia: dónde está y dónde no', () => {
  it('la tabla del ranking no publica la licencia', () => {
    const { rows } = parseSkermoNationalRanking(RANKING, { federationCode: 'RFEE' });
    expect(rows[0]).not.toHaveProperty('sourceLicense');
  });

  it('la ficha del tirador sí la publica, y es la clave del emparejado', () => {
    const ficha = parseSkermoRankingAthlete(FICHA);
    expect(ficha?.sourceLicense).toBe('SGL00510');
    expect(ficha?.sourceAthleteName).toBe('SILVIA GÓMEZ LÓPEZ');
    expect(ficha?.sourceClub).toBe('CELC-M');
    expect(ficha?.sourceBirthDate).toBe('2007-04-11');
    expect(ficha?.categoryRaw).toBe('M20');
  });

  it('la ficha corresponde a la número 1 de la tabla: el cruce es correcto', () => {
    const { rows } = parseSkermoNationalRanking(RANKING, { federationCode: 'RFEE' });
    const ficha = parseSkermoRankingAthlete(FICHA);
    expect(ficha?.sourceAthleteName).toBe(rows[0].sourceAthleteName);
    expect(ficha?.sourceBirthDate).toBe(rows[0].sourceBirthDate);
  });
});

/**
 * Regresión de un fallo que costó una ejecución entera: 150 fichas pedidas y
 * 0 licencias resueltas. La URL de la ficha se estaba reconstruyendo a mano y
 * Skermo responde 302 si le falta el contexto del ranking.
 */
describe('el enlace a la ficha del tirador', () => {
  const { rows } = parseSkermoNationalRanking(RANKING, { federationCode: 'RFEE' });

  it('se toma tal cual lo publica la fila, con todo el contexto', () => {
    const url = new URL(rows[0].athleteUrl ?? '');
    expect(url.pathname).toBe('/ranking-rfee/public/RFEE/366');
    // Sin estos cuatro parámetros la página redirige y no trae la licencia.
    expect(url.searchParams.get('seasonId')).toBe('17');
    expect(url.searchParams.get('weapon')).toBe('E');
    expect(url.searchParams.get('category')).toBe('6');
    expect(url.searchParams.get('gender')).toBe('W');
  });

  it('todas las filas traen su enlace: ninguna se queda sin poder resolverse', () => {
    expect(rows.every((r) => r.athleteUrl?.includes('seasonId='))).toBe(true);
  });
});
