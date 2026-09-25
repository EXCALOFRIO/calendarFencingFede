import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseSkermoCompetitionResults,
  parseSkermoNationalRanking,
  parseSkermoNumber,
  parseSkermoResultsIndex,
  parseSkermoSeasons,
  skermoCompetitionResultsUrl,
  skermoNationalRankingUrl,
  skermoResultsUrl,
  validateResultRows,
  normalizeLicense,
} from '@/lib/ingest/sources/skermo-results';

/**
 * Tests contra el HTML REAL de Skermo, guardado comprimido el 25/09/2026.
 *
 * La gracia de fijar números concretos (764 filas, 228 clasificaciones, 80
 * resultados, la licencia "SGL00510") es que el día que Skermo cambie el
 * marcado estos tests se ponen en rojo. Un parser que se calla y devuelve
 * cero filas es peor que uno que falla: el ranking se queda vacío y nadie se
 * entera hasta que alguien pregunta por sus puntos.
 */

function fixture(name: string): string {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return gunzipSync(readFileSync(path)).toString('utf8');
}

const INDICE = fixture('skermo-resultados-rfee-2025-2026.html.gz');
const CLASIFICACION = fixture('skermo-clasificacion-10158.html.gz');
const RANKING = fixture('skermo-ranking-rfee-espada-m20-f.html.gz');

describe('URLs de Skermo', () => {
  it('construye la URL del índice con idioma y pruebas ajenas', () => {
    const url = skermoResultsUrl('RFEE');
    expect(url).toBe(
      'https://app.skermo.org/calendar/public/RFEE/results?setLang=es&owa=1',
    );
  });

  it('construye la URL de una clasificación concreta', () => {
    expect(skermoCompetitionResultsUrl('RFEE', '10158')).toBe(
      'https://app.skermo.org/ranking/public/RFEE/competition/10158?setLang=es',
    );
  });

  it('el ranking nacional lleva siempre los cuatro filtros', () => {
    // Sin los cuatro, la página responde 200 con el tbody vacío: comprobado.
    const url = skermoNationalRankingUrl('RFEE', {
      season: 17,
      weapon: 'E',
      category: 6,
      gender: 'W',
    });
    expect(url).toContain('season=17');
    expect(url).toContain('weapon=E');
    expect(url).toContain('category=6');
    expect(url).toContain('gender=W');
  });
});

describe('parseSkermoNumber', () => {
  it('lee el punto decimal de la clasificación de una prueba', () => {
    expect(parseSkermoNumber('2065.56')).toBe('2065.56');
    expect(parseSkermoNumber('111')).toBe('111');
  });

  it('lee el formato español del ranking nacional', () => {
    expect(parseSkermoNumber('3.530,79')).toBe('3530.79');
    expect(parseSkermoNumber('1.772,05  *')).toBe('1772.05');
  });

  it('devuelve null en vez de cero cuando no hay número', () => {
    // "No publicado" no es "cero puntos": confundirlos falsea el ranking.
    expect(parseSkermoNumber('')).toBeNull();
    expect(parseSkermoNumber(null)).toBeNull();
    expect(parseSkermoNumber('-')).toBeNull();
  });
});

describe('índice de resultados', () => {
  const { rows, rowsSeen, mismatches } = parseSkermoResultsIndex(INDICE, {
    federationCode: 'RFEE',
  });

  it('lee las 764 pruebas de la temporada 2025-2026 sin descuadres', () => {
    expect(rowsSeen).toBe(764);
    expect(rows).toHaveLength(764);
    // Un descuadre significa que han cambiado las columnas.
    expect(mismatches).toBe(0);
  });

  it('no se corre una columna por la celda que solo se ve en móvil', () => {
    // La fila trae 9 <td> contra 8 <th>: uno es el resumen de móvil
    // ("EF M20, Ind."). Si se colase, "Modalidad" saldría en "Población".
    for (const row of rows) {
      expect(row.city === null || row.city.includes(',')).toBe(false);
    }
    const arma = new Set(rows.map((r) => r.weapon));
    expect([...arma].sort()).toEqual(['ESPADA', 'FLORETE', 'SABLE']);
  });

  it('reconoce el género "MIxta" que usa Skermo en las concentraciones', () => {
    // `mapGender` no lo reconoce (busca "MIXTO"); el parser lo normaliza.
    const mixtas = rows.filter((r) => r.gender === 'MIXTO');
    expect(mixtas).toHaveLength(8);
    expect(rows.filter((r) => r.gender === null)).toHaveLength(0);
  });

  it('colapsa los veteranos a VET pero conserva el texto original', () => {
    const vet = rows.find((r) => r.categoryRaw === 'VET40');
    expect(vet).toBeDefined();
    expect(vet?.category).toBe('VET');
  });

  it('solo las pruebas individuales publican clasificación en HTML', () => {
    const conClasificacion = rows.filter((r) => r.competitionId !== null);
    expect(conClasificacion).toHaveLength(228);
    // Ni una sola prueba por equipos: los equipos solo tienen PDF.
    expect(conClasificacion.every((r) => r.format === 'INDIVIDUAL')).toBe(true);
  });

  it('recoge los PDF de clasificación como documentos', () => {
    const conPdf = rows.filter((r) => r.documents.length > 0);
    expect(conPdf).toHaveLength(217);
    expect(conPdf[0].documents[0].url).toMatch(/^https:\/\/app\.skermo\.org\/client\//);
  });

  it('separa ciudad y país con la convención del calendario', () => {
    const extranjera = rows.find((r) => r.name === 'CPTO MUNDO' && r.city === 'HONG KONG');
    expect(extranjera?.country).toBe('HK');
    const nacional = rows.find((r) => r.city === 'MELGAR DE FERNAMENTAL');
    expect(nacional?.country).toBe('ES');
  });

  it('lee las temporadas del desplegable en vez de tenerlas escritas', () => {
    const seasons = parseSkermoSeasons(INDICE);
    expect(seasons.length).toBeGreaterThanOrEqual(10);
    const actual = seasons.find((s) => s.selected);
    expect(actual?.label).toBe('2025-2026');
    expect(seasons.some((s) => s.label === '2026-2027')).toBe(true);
  });
});

describe('clasificación de una prueba', () => {
  const { meta, rows, rowsSeen, mismatches } = parseSkermoCompetitionResults(
    CLASIFICACION,
    { federationCode: 'RFEE', competitionId: '10158' },
  );

  it('deduce la cabecera sin depender del orden de los <h3>', () => {
    expect(meta.weapon).toBe('ESPADA');
    expect(meta.gender).toBe('F');
    expect(meta.category).toBe('M20');
    expect(meta.format).toBe('INDIVIDUAL');
    expect(meta.date).toBe('2026-09-20');
    expect(meta.city).toBe('BARCELONA');
  });

  it('limpia el título y saca la temporada', () => {
    expect(meta.rawTitle).toBe('Resultado Competición TNR M20 2026-2027');
    expect(meta.name).toBe('TNR M20');
    expect(meta.seasonLabel).toBe('2026-2027');
  });

  it('lee los 80 resultados con su licencia', () => {
    expect(rowsSeen).toBe(80);
    expect(mismatches).toBe(0);
    expect(rows.filter((r) => r.sourceLicense === null)).toHaveLength(0);
  });

  it('quita el "3. " que Skermo mete dentro del nombre solo para móvil', () => {
    const silvia = rows.find((r) => r.sourceLicense === 'SGL00510');
    expect(silvia).toBeDefined();
    expect(silvia?.sourceFirstName).toBe('SILVIA');
    // Sin la limpieza saldría "3. SILVIA".
    expect(silvia?.sourceAthleteName).toBe('SILVIA GÓMEZ LÓPEZ');
    expect(silvia?.position).toBe(3);
    expect(silvia?.sourceClub).toBe('CELC-M');
    expect(silvia?.sourceBirthDate).toBe('2007-04-11');
    expect(silvia?.officialPoints).toBe('1772.05');
  });

  it('decodifica las entidades HTML de los apellidos', () => {
    // El HTML trae "G&Oacute;MEZ L&Oacute;PEZ" y "JUANES CARRE&Ntilde;O".
    expect(rows.some((r) => r.sourceLastName === 'JUANES CARREÑO')).toBe(true);
  });

  it('respeta los puestos que la fuente se salta, sin renumerar', () => {
    // La clasificación de Skermo solo lista a quien puntúa, así que empieza
    // en el 2 y hay huecos. Renumerar sería inventarse resultados.
    const posiciones = rows.map((r) => r.position);
    expect(posiciones[0]).toBe(2);
    expect(posiciones).not.toContain(1);
    expect(Math.max(...(posiciones as number[]))).toBe(84);
  });

  it('todas las filas pasan la validación de Zod', () => {
    const { valid, quarantined } = validateResultRows(rows, {
      competitionId: '10158',
    });
    expect(valid).toHaveLength(80);
    expect(quarantined).toHaveLength(0);
  });

  it('manda a cuarentena lo que no valida, no al ranking', () => {
    const { valid, quarantined } = validateResultRows(
      [
        ...rows.slice(0, 2),
        {
          position: null,
          sourceLicense: null,
          sourceAthleteName: '',
          sourceFirstName: null,
          sourceLastName: null,
          sourceClub: null,
          sourceBirthDate: null,
          officialPoints: null,
        },
      ],
      { competitionId: '10158' },
    );
    expect(valid).toHaveLength(2);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].errors.length).toBeGreaterThan(0);
  });
});

describe('ranking nacional', () => {
  const { rows, rowsSeen, mismatches } = parseSkermoNationalRanking(RANKING, {
    federationCode: 'RFEE',
  });

  it('lee las 80 posiciones de espada M20 femenino', () => {
    expect(rowsSeen).toBe(80);
    expect(mismatches).toBe(0);
  });

  it('lee la puntuación en formato español', () => {
    expect(rows[0].position).toBe(1);
    expect(rows[0].sourceAthleteName).toBe('SILVIA GÓMEZ LÓPEZ');
    expect(rows[0].totalPoints).toBe('3530.79');
    expect(rows[0].sourceBirthDate).toBe('2007-04-11');
    expect(rows[0].sourceClub).toBe('CELC-M');
  });

  it('NO publica la licencia: guarda el id de Skermo solo para ir a su ficha', () => {
    // Es el motivo por el que el ranking nacional no alimenta el emparejado:
    // sin licencia no hay clave fiable, y por nombre no se empareja jamás.
    expect(rows[0]).not.toHaveProperty('sourceLicense');
    expect(rows[0].skermoAthleteId).toBe('366');
    expect(rows[0].athleteUrl).toContain('/ranking-rfee/public/RFEE/366');
  });
});

describe('normalización de licencias', () => {
  it('compara licencias sin que un espacio o una minúscula rompa el emparejado', () => {
    expect(normalizeLicense(' sgl00510 ')).toBe('SGL00510');
    expect(normalizeLicense('SGL 00510')).toBe('SGL00510');
  });
});

/**
 * Documentos y directos del índice de resultados.
 *
 * Estaban parseados y se tiraban: nadie los escribía en la base. Son 217
 * PDFs de clasificación y 34 enlaces a Engarde en la temporada 2025-2026,
 * todos en el HTML que ya se descargaba.
 */
describe('adjuntos del índice de resultados', () => {
  const { rows } = parseSkermoResultsIndex(INDICE, { federationCode: 'RFEE' });

  it('recoge los PDFs de clasificación de las filas que los publican', () => {
    const conPdf = rows.filter((r) => r.documents.length > 0);
    expect(conPdf.length).toBeGreaterThan(150);
    expect(
      rows.flatMap((r) => r.documents).every((d) => d.url.endsWith('.pdf')),
    ).toBe(true);
  });

  it('recoge los directos de Engarde, que antes no se leían', () => {
    const directos = rows.flatMap((r) => r.liveLinks);
    expect(directos.length).toBeGreaterThan(0);
    expect(directos.every((e) => e.url.startsWith('https://'))).toBe(true);
    expect(new Set(directos.map((e) => e.platform))).toContain('engarde');
    // El <a> solo lleva un icono: la etiqueta la ponemos nosotros.
    expect(directos[0].label).toBe('Resultados en Engarde');
  });

  it('no confunde el directo de Engarde con la clasificación de Skermo', () => {
    // Los dos enlaces viven en la misma celda y el de Engarde contiene
    // "/competition/" en algunas variantes: si colara, esa prueba se quedaría
    // sin clasificación.
    for (const r of rows) {
      expect(r.liveLinks.every((e) => !e.url.includes('app.skermo.org'))).toBe(true);
      expect(r.documents.every((d) => d.url.includes('app.skermo.org'))).toBe(true);
    }
  });
});
