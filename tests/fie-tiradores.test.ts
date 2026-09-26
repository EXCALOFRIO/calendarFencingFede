import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  type FieCensoRow,
  type TiradorNuestro,
  fieCensoUrl,
  fieDetailedRankingUrl,
  fieFichaApiUrl,
  fieFichaPublicaUrl,
  fieFencerContentHash,
  fieFichaSchema,
  fieRankingContentHash,
  fechaNacimientoDeLicenciaFie,
  fotoFieAncho,
  normalizarLicenciaFie,
  proponerCandidatos,
  trozosDeNombre,
  validarCenso,
} from '@/lib/ingest/sources/fie-tiradores';
import { mapCategory, mapGender, mapWeapon } from '@/lib/ingest/mappers';

/**
 * Tests de las fichas de tirador de la FIE contra respuestas JSON REALES.
 *
 * `tests/fixtures/fie-tiradores.json.gz` son las respuestas literales de la
 * API pública de la FIE capturadas el 26/09/2026 con
 * `npx tsx scripts/capturar-fixture-fie.ts`, recortadas a los dos tiradores
 * internacionales reales que hay de alta en la aplicación y sin la prosa que
 * no se ingiere (ver la cabecera del script).
 *
 * Que esto pase en verde demuestra las tres cosas que importan de esta fuente:
 *
 *  1. Que el censo trae la foto y la fecha de nacimiento en UNA petición, sin
 *     scraping.
 *  2. Que el número de licencia de la FIE **no es** el de la RFEE, y que sin
 *     embargo se puede COMPROBAR contra la fecha de nacimiento.
 *  3. Que el emparejado propone exactamente a los dos que tiene que proponer y
 *     a nadie más: los diez tiradores de demostración no reciben ninguna
 *     propuesta, que es la prueba de que no hay falsos positivos.
 */

type Capturado = Record<string, unknown>;

const capturado: Capturado = JSON.parse(
  gunzipSync(
    readFileSync(new URL('./fixtures/fie-tiradores.json.gz', import.meta.url)),
  ).toString('utf8'),
);

function respuesta<T>(url: string): T {
  const valor = capturado[url];
  if (valor === undefined) {
    throw new Error(
      `El fixture no tiene la respuesta de ${url}. Claves: ${Object.keys(capturado).join(', ')}`,
    );
  }
  return valor as T;
}

const CENSO_LLAVADOR = `${fieCensoUrl('ESP', 1, 100)}&name=LLAVADOR`;
const CENSO_MARINO = `${fieCensoUrl('ESP', 1, 100)}&name=MARINO`;

function censo(url: string): FieCensoRow[] {
  const { items } = respuesta<{ items: unknown[] }>(url);
  const { valid, quarantined } = validarCenso(items);
  expect(quarantined).toEqual([]);
  return valid;
}

/** Los dos tiradores reales, tal y como están en la base. */
const LLAVADOR: TiradorNuestro = {
  id: 'athlete-llavador',
  firstName: 'Carlos',
  lastName: 'Llavador Fernandez',
  birthDate: '1992-04-26',
  gender: 'M',
  fieLicense: null,
};

const MARINO: TiradorNuestro = {
  id: 'athlete-marino',
  firstName: 'Maria',
  lastName: 'Mariño Blanco',
  birthDate: '1993-01-31',
  gender: 'F',
  fieLicense: null,
};

/** Los diez de demostración. Ninguno debe recibir propuesta. */
const DEMO: TiradorNuestro[] = [
  ['Nerea', 'Costa Belmonte', '2011-05-09', 'F'],
  ['Ainhoa', 'Etxebarria Lasa', '2006-07-21', 'F'],
  ['Lucía', 'Fernández Lacalle', '2009-03-14', 'F'],
  ['Marcos', 'Fernández Lacalle', '2013-11-02', 'M'],
  ['Sara', 'Fernández Lacalle', '2008-02-17', 'F'],
  ['Hugo', 'Ibáñez Moreda', '2010-09-18', 'M'],
  ['Carla', 'Ordóñez Rivas', '1999-04-11', 'F'],
  ['Irene', 'Salas Cardeñosa', '2010-10-12', 'F'],
  ['Pablo', 'Serrano Quiroga', '2004-01-30', 'M'],
  ['Marta', 'Vilanova Sedano', '2009-06-05', 'F'],
].map(([firstName, lastName, birthDate, gender], i) => ({
  id: `demo-${i}`,
  firstName,
  lastName,
  birthDate,
  gender,
  fieLicense: null,
}));

describe('censo de la FIE', () => {
  it('trae la foto y la fecha de nacimiento en la propia fila del ranking', () => {
    const [carlos] = censo(CENSO_LLAVADOR);

    expect(carlos.id).toBe(21966);
    expect(carlos.name).toBe('LLAVADOR Carlos');
    // La foto viene de static.fie.org: se ENLAZA, no se copia.
    expect(carlos.image).toMatch(/^https:\/\/static\.fie\.org\/uploads\//);
    expect(carlos.date).toBe('1992-04-26');
    expect(carlos.rank).toBe(25);
    expect(carlos.hand).toBe('L');
  });

  it('traduce los códigos de la FIE con los mapeadores que ya había', () => {
    const [maria] = censo(CENSO_MARINO);
    expect(mapWeapon(maria.weapon)).toBe('FLORETE');
    expect(mapGender(maria.gender)).toBe('F');
    expect(mapCategory(maria.category)).toBe('ABS');
    expect(maria.rank).toBe(30);
  });

  it('manda a cuarentena la fila cuya foto no está en static.fie.org', () => {
    const [carlos] = respuesta<{ items: Record<string, unknown>[] }>(
      CENSO_LLAVADOR,
    ).items;

    const { valid, quarantined } = validarCenso([
      { ...carlos, image: 'https://ejemplo.invalido/foto.jpg' },
    ]);

    expect(valid).toHaveLength(0);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].sourceId).toBe('21966');
    expect(quarantined[0].errors[0].message).toContain('static.fie.org');
  });

  it('acepta que no haya foto: null no es un error', () => {
    const [carlos] = respuesta<{ items: Record<string, unknown>[] }>(
      CENSO_LLAVADOR,
    ).items;
    const { valid, quarantined } = validarCenso([{ ...carlos, image: null }]);
    expect(quarantined).toEqual([]);
    expect(valid[0].image).toBeNull();
  });

  it('manda a cuarentena una fila sin id: sin él no hay ficha que enlazar', () => {
    const { quarantined } = validarCenso([{ name: 'ALGUIEN Alguno' }]);
    expect(quarantined).toHaveLength(1);
  });
});

describe('ficha de la FIE', () => {
  it('publica un número de licencia que NO es el de la RFEE', () => {
    const ficha = fieFichaSchema.parse(respuesta(fieFichaApiUrl(21966)));

    // La licencia de Carlos en la RFEE es "CLF01835". La de la FIE, esto:
    expect(ficha.licenseNumber).toBe('26041992000');
    expect(ficha.licenseNumber).not.toBe('CLF01835');
    expect(ficha.licenseStatus).toBe('Valid');
  });

  it('la licencia de la FIE lleva dentro la fecha de nacimiento', () => {
    // Es lo que permite COMPROBAR una licencia sin fiarse del nombre.
    expect(fechaNacimientoDeLicenciaFie('26041992000')).toBe('1992-04-26');
    expect(fechaNacimientoDeLicenciaFie('31011993000')).toBe('1993-01-31');

    const carlos = fieFichaSchema.parse(respuesta(fieFichaApiUrl(21966)));
    const maria = fieFichaSchema.parse(respuesta(fieFichaApiUrl(24463)));
    expect(fechaNacimientoDeLicenciaFie(carlos.licenseNumber)).toBe(carlos.date);
    expect(fechaNacimientoDeLicenciaFie(maria.licenseNumber)).toBe(maria.date);
  });

  it('no afirma una fecha si la licencia no tiene el formato esperado', () => {
    expect(fechaNacimientoDeLicenciaFie(null)).toBeNull();
    expect(fechaNacimientoDeLicenciaFie('CLF01835')).toBeNull();
    expect(fechaNacimientoDeLicenciaFie('123')).toBeNull();
    // 32 de enero no existe: el formato no es el que creemos, así que null.
    expect(fechaNacimientoDeLicenciaFie('32011993000')).toBeNull();
    // Mes 13 tampoco.
    expect(fechaNacimientoDeLicenciaFie('01131993000')).toBeNull();
  });

  it('publica el puesto mundial de cada temporada desde 2009', () => {
    const ficha = fieFichaSchema.parse(respuesta(fieFichaApiUrl(21966)));

    expect(ficha.ranking.length).toBeGreaterThan(15);
    const temporadas = ficha.ranking.map((r) => r.season);
    expect(temporadas).toContain(2009);
    expect(temporadas).toContain(2027);

    // Su mejor puesto histórico es el 11.º de 2025. Es un HECHO publicado,
    // no una media ni un cálculo nuestro.
    const mejor = ficha.ranking.reduce((a, b) =>
      (a.rank ?? 9e9) <= (b.rank ?? 9e9) ? a : b,
    );
    expect(mejor.rank).toBe(11);
    expect(mejor.season).toBe(2025);
  });

  it('la ficha pública es la URL a la que se enlaza siempre', () => {
    expect(fieFichaPublicaUrl(21966)).toBe('https://fie.org/athletes/21966');
    // La de la API es otra, y es singular: el plural da 404.
    expect(fieFichaApiUrl(21966)).toBe('https://fie.org/api/fie/fencer/21966');
  });

  it('normaliza licencias para poder compararlas', () => {
    expect(normalizarLicenciaFie(' 2604-1992 000 ')).toBe('26041992000');
    expect(normalizarLicenciaFie('clf01835')).toBe('CLF01835');
    expect(normalizarLicenciaFie(null)).toBe('');
  });
});

describe('nº de pruebas de la temporada', () => {
  it('cuenta las claves de competitionPoints que publica la FIE', () => {
    const url = fieDetailedRankingUrl({
      season: 2027,
      weapon: 'F',
      gender: 'M',
      category: 'S',
    });
    const { fencers } = respuesta<{
      fencers: { addrId: number; competitionPoints: Record<string, string> }[];
    }>(url);

    const carlos = fencers.find((f) => f.addrId === 21966);
    expect(carlos).toBeDefined();
    // 11 pruebas con puntuación esta temporada. Es contar lo que publican.
    expect(Object.keys(carlos!.competitionPoints)).toHaveLength(11);
  });
});

describe('emparejado: propone, nunca decide', () => {
  const todoElCenso = [...censo(CENSO_LLAVADOR), ...censo(CENSO_MARINO)];

  it('propone a Carlos aunque la FIE traiga un solo apellido y sin acentos', () => {
    const propuestas = proponerCandidatos([LLAVADOR], todoElCenso);

    expect(propuestas).toHaveLength(1);
    expect(propuestas[0].fieId).toBe(21966);
    expect(propuestas[0].athleteId).toBe('athlete-llavador');
    expect(propuestas[0].fechaExacta).toBe(true);
    expect(propuestas[0].evidencia).toContain('LLAVADOR Carlos');
    expect(propuestas[0].evidencia).toContain('1992-04-26');
  });

  it('propone a María: "MARINO" tiene que reconocerse como "Mariño"', () => {
    const propuestas = proponerCandidatos([MARINO], todoElCenso);

    expect(propuestas).toHaveLength(1);
    expect(propuestas[0].fieId).toBe(24463);
    expect(propuestas[0].fechaExacta).toBe(true);
  });

  it('NO propone nada para los diez tiradores de demostración', () => {
    // Es la prueba de que no hay falsos positivos: mismo censo, cero propuestas.
    expect(proponerCandidatos(DEMO, todoElCenso)).toEqual([]);
  });

  it('no confunde a "Mariño Blanco" con "MARINO LASSO"', () => {
    /**
     * Caso real del censo español: Ana Mariño Lasso (FIE 57091) comparte el
     * primer apellido con María Mariño Blanco. La regla exige que TODOS los
     * apellidos de la FIE estén entre los nuestros, así que "MARINO LASSO" no
     * encaja en {MARINO, BLANCO}. Y el año de nacimiento tampoco.
     */
    const anaLasso: FieCensoRow = {
      id: 57091,
      name: 'MARINO LASSO Ana',
      firstName: 'Ana',
      lastName: 'MARINO LASSO',
      countryCode: 'ESP',
      weapon: 'F',
      gender: 'F',
      points: '0.250',
      date: '2008-09-12',
      category: 'J',
      ageBand: null,
      hand: 'R',
      rank: 312,
      image: 'https://static.fie.org/uploads/39/195689-MARI%C3%91O_LASSO_ANA.jpg',
    };

    expect(proponerCandidatos([MARINO], [anaLasso])).toEqual([]);
  });

  it('no propone a alguien con el mismo nombre y otro año de nacimiento', () => {
    const homonimo: FieCensoRow = {
      ...censo(CENSO_LLAVADOR)[0],
      id: 999999,
      date: '2005-04-26',
    };
    expect(proponerCandidatos([LLAVADOR], [homonimo])).toEqual([]);
  });

  it('no propone a alguien del otro género', () => {
    const otroGenero: FieCensoRow = { ...censo(CENSO_LLAVADOR)[0], gender: 'F' };
    expect(proponerCandidatos([LLAVADOR], [otroGenero])).toEqual([]);
  });

  it('si el día no cuadra pero el año sí, propone y lo dice', () => {
    /**
     * Un dedazo en la fecha tiene que acabar en la cola, no perderse. Se
     * propone, `fechaExacta` es false y la evidencia enseña las dos fechas
     * para que quien revise vea la diferencia.
     */
    const conDedazo = { ...LLAVADOR, birthDate: '1992-04-25' };
    const propuestas = proponerCandidatos([conDedazo], todoElCenso);

    expect(propuestas).toHaveLength(1);
    expect(propuestas[0].fechaExacta).toBe(false);
    expect(propuestas[0].evidencia).toContain('1992-04-26');
    expect(propuestas[0].evidencia).toContain('1992-04-25');
  });
});

describe('trozos de nombre', () => {
  it('quita acentos, mayúsculas y partículas', () => {
    expect(trozosDeNombre('Mariño Blanco')).toEqual(['MARINO', 'BLANCO']);
    expect(trozosDeNombre('de la Fuente Ruiz')).toEqual(['FUENTE', 'RUIZ']);
    expect(trozosDeNombre('Ibáñez Moreda')).toEqual(['IBANEZ', 'MOREDA']);
    expect(trozosDeNombre(null)).toEqual([]);
  });
});

describe('idempotencia', () => {
  it('el hash de la ficha no cambia si no cambia la ficha', async () => {
    const fila = {
      sourceName: 'LLAVADOR Carlos',
      sourceBirthDate: '1992-04-26',
      photoUrl: 'https://static.fie.org/uploads/33/165113-x.jpg',
      hand: 'L',
      fieLicense: '26041992000',
      fieLicenseStatus: 'Valid',
    };
    expect(await fieFencerContentHash(fila)).toBe(
      await fieFencerContentHash({ ...fila }),
    );
    // Una foto nueva sí tiene que cambiarlo.
    expect(await fieFencerContentHash(fila)).not.toBe(
      await fieFencerContentHash({ ...fila, photoUrl: null }),
    );
  });

  it('el hash del puesto cambia si cambia el puesto', async () => {
    const base = { position: 25, points: '68.500', eventCount: 11, ageBand: null };
    expect(await fieRankingContentHash(base)).toBe(
      await fieRankingContentHash({ ...base }),
    );
    expect(await fieRankingContentHash(base)).not.toBe(
      await fieRankingContentHash({ ...base, position: 24 }),
    );
  });
});

describe('la foto: se enlaza y la redimensiona la FIE', () => {
  it('usa el redimensionador de la FIE, no el nuestro', () => {
    /**
     * La original de Carlos pesa 944 KB. Para un avatar hay que pedirla más
     * pequeña, y la única forma de hacerlo SIN rehospedarla es el
     * `cdn-cgi/image` de la propia FIE, que es su Cloudflare Images.
     * Comprobado en vivo: 944 KB -> 2,9 KB a 96 px.
     */
    const original =
      'https://static.fie.org/uploads/33/165113-LLAVADOR_FERNANDEZ_CARLOS_PAM478161.jpg';

    expect(fotoFieAncho(original, 96)).toBe(
      `https://fie.org/cdn-cgi/image/width=96,quality=80,format=auto/${original}`,
    );
    // Sigue siendo un dominio de la FIE: no pasa por el nuestro en ningún caso.
    expect(new URL(fotoFieAncho(original, 320)!).host).toBe('fie.org');
  });

  it('sin foto no inventa una URL', () => {
    expect(fotoFieAncho(null, 96)).toBeNull();
  });

  it('respeta los nombres de archivo acentuados de la FIE', () => {
    // El de María viene con la ñ y la í codificadas; no se toca la cadena.
    const conAcentos =
      'https://static.fie.org/uploads/33/165422-MARI%C3%91O_BLANCO_MAR%C3%8DA_PAI472178.jpg';
    expect(fotoFieAncho(conAcentos, 96)).toContain('%C3%91O_BLANCO_MAR%C3%8DA');
  });
});

describe('las URL de la FIE', () => {
  it('filtra por país para no descargarse su base de datos entera', () => {
    // Sin `country` la API devuelve los 11.465 tiradores del mundo.
    expect(fieCensoUrl('ESP', 1, 1000)).toBe(
      'https://fie.org/api/fie/fencers/ranking?country=ESP&page=1&pageSize=1000',
    );
  });

  it('pide el ranking detallado individual', () => {
    expect(
      fieDetailedRankingUrl({
        season: 2027,
        weapon: 'F',
        gender: 'F',
        category: 'S',
      }),
    ).toBe(
      'https://fie.org/api/fie/fencers/detailed-ranking?season=2027&weapon=F&gender=F&category=S&type=I',
    );
  });
});
