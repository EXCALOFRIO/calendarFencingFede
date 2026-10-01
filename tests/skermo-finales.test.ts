import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  leerFinalSkermo,
  type DepsLecturaSkermo,
} from '@/lib/ingest/sources/skermo-finales';
import type { SkermoResultsIndexRow } from '@/lib/ingest/sources/skermo-results';

/**
 * Clasificación REAL de un campeonato de España absoluto (Skermo, temporada
 * 2021-2022, prueba 4612), minimizada a sus 12 primeras filas y con nombres,
 * licencias, clubes y fechas de nacimiento sustituidos. Se conservan los
 * puestos y puntos publicados: hay un empate en el 3.º y por eso el 4.º no existe.
 */
const CLASIFICACION = gunzipSync(
  readFileSync(fileURLToPath(new URL('./fixtures/historico/skermo-clasificacion-4612-anonimizada.html.gz', import.meta.url))),
).toString('utf8');

const filaIndice = (over: Partial<SkermoResultsIndexRow> = {}): SkermoResultsIndexRow => ({
  competitionId: '4612',
  resultsUrl: 'https://app.skermo.org/ranking/public/RFEE/competition/4612?setLang=es',
  date: '2022-06-25',
  name: 'CAMPEONATO DE ESPAÑA SENIOR',
  weapon: 'FLORETE',
  gender: 'M',
  category: 'ABS',
  categoryRaw: 'ABS',
  format: 'INDIVIDUAL',
  city: 'Valencia',
  country: 'ES',
  documents: [],
  liveLinks: [],
  externalUrls: [],
  ...over,
});

const deps = (cuerpo: string = CLASIFICACION): DepsLecturaSkermo & { urls: string[] } => {
  const urls: string[] = [];
  return {
    urls,
    async html(url) {
      urls.push(url);
      return cuerpo;
    },
  };
};

describe('puestos finales de Skermo en una temporada que no es la vigente', () => {
  it('usa la temporada del selector y lee prueba, categoría y puestos de la propia clasificación', async () => {
    const d = deps();
    const l = await leerFinalSkermo(filaIndice(), { federacion: 'RFEE', season: '2021-2022' }, d);
    expect(d.urls).toEqual(['https://app.skermo.org/ranking/public/RFEE/competition/4612?setLang=es']);
    expect(l.competitionKey).toBe('RFEE:4612');
    expect(l.prueba).toMatchObject({
      fuente: 'skermo_rfee',
      season: '2021-2022',
      fecha: '2022-06-25',
      arma: 'FLORETE',
      genero: 'M',
      categoria: 'ABS',
      categoriaOriginal: 'ABS',
      formato: 'INDIVIDUAL',
    });
    expect(l.cobertura).toEqual({ estado: 'completo', publicado: 12, importado: 12, error: null });
  });

  it('conserva empates y huecos de puesto tal como se publican, sin renumerar', async () => {
    const l = await leerFinalSkermo(filaIndice(), { federacion: 'RFEE', season: '2021-2022' }, deps());
    expect(l.puestos.map((p) => p.posicion)).toEqual([1, 2, 3, 3, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(l.puestos.map((p) => p.posicionRaw)).toEqual(['1', '2', '3', '3', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(l.puestos[2].puntos).toBe(l.puestos[3].puntos);
    expect(l.puestos.every((p) => p.puntos !== null)).toBe(true);
  });

  it('la identidad de cada puesto es su licencia y nunca el nombre ni el puesto', async () => {
    const l = await leerFinalSkermo(filaIndice(), { federacion: 'RFEE', season: '2021-2022' }, deps());
    expect(l.puestos[0]).toMatchObject({ sourceFactKey: 'lic:TST00001', licencia: 'TST00001' });
    expect(new Set(l.puestos.map((p) => p.sourceFactKey)).size).toBe(12);
    // Los dos terceros son personas distintas con claves distintas.
    expect(l.puestos[2].sourceFactKey).not.toBe(l.puestos[3].sourceFactKey);
  });

  it('una federación autonómica usa su propia fuente y la clave lleva la federación', async () => {
    const l = await leerFinalSkermo(filaIndice(), { federacion: 'FCE', season: '2021-2022' }, deps());
    expect(l.prueba?.fuente).toBe('skermo_regional');
    expect(l.competitionKey).toBe('FCE:4612');
  });

  it('si el título declara otra temporada que el índice, es conflicto y no se importa nada', async () => {
    const l = await leerFinalSkermo(filaIndice(), { federacion: 'RFEE', season: '2022-2023' }, deps());
    expect(l.prueba).toBeNull();
    expect(l.puestos).toEqual([]);
    expect(l.cobertura.estado).toBe('conflicto');
    expect(l.cobertura.error).toMatch(/2021-2022.*2022-2023/);
  });

  it('una categoría sin equivalencia no se aproxima: error con el literal de la fuente', async () => {
    const sinMapa = CLASIFICACION.replace('<h3>ABS</h3>', '<h3>M10</h3>');
    const l = await leerFinalSkermo(
      filaIndice({ category: null, categoryRaw: 'M10' }),
      { federacion: 'RFEE', season: '2021-2022' },
      deps(sinMapa),
    );
    expect(l.cobertura.estado).toBe('error');
    expect(l.cobertura.error).toContain('M10');
    expect(l.prueba).toBeNull();
    expect(l.puestos).toEqual([]);
  });

  it('M7 existe como categoría y llega a la prueba, que el esquema Zod antiguo omitía', async () => {
    const l = await leerFinalSkermo(
      filaIndice({ category: 'M7', categoryRaw: 'M7' }),
      { federacion: 'RFEE', season: '2021-2022' },
      deps(CLASIFICACION.replace('<h3>ABS</h3>', '<h3>M7</h3>')),
    );
    expect(l.prueba?.categoria).toBe('M7');
    expect(l.prueba?.categoriaOriginal).toBe('M7');
  });

  it('un equipo se guarda como clasificación de equipo: sin licencia ni identidad de persona', async () => {
    const l = await leerFinalSkermo(
      filaIndice({ format: 'EQUIPOS' }),
      { federacion: 'RFEE', season: '2021-2022' },
      deps(CLASIFICACION.replace('<h3>Individual</h3>', '<h3>Equipos</h3>')),
    );
    expect(l.prueba?.formato).toBe('EQUIPOS');
    expect(l.puestos).toHaveLength(12);
    expect(l.puestos.every((p) => p.licencia === null && p.sourceFactKey.startsWith('team:'))).toBe(true);
  });

  it('una licencia repetida en la misma clasificación queda sin identidad y como conflicto', async () => {
    const repetida = CLASIFICACION.replace('TST00002', 'TST00001');
    const l = await leerFinalSkermo(filaIndice(), { federacion: 'RFEE', season: '2021-2022' }, deps(repetida));
    expect(l.puestos).toHaveLength(12);
    expect(l.puestos[0].licencia).toBeNull();
    expect(l.puestos[1].licencia).toBeNull();
    expect(l.puestos[1].sourceFactKey).toBe('lic:TST00001#2');
    expect(l.excluidas.licenciaRepetida).toBe(1);
    expect(l.cobertura.estado).toBe('conflicto');
  });

  it('una fila del índice sin clasificación HTML sigue pendiente, no vacía ni leída', async () => {
    const d = deps();
    const l = await leerFinalSkermo(
      filaIndice({ competitionId: null, resultsUrl: null, documents: [{ title: 'PDF', url: 'https://app.skermo.org/client/x.pdf' }] }),
      { federacion: 'RFEE', season: '2021-2022' },
      d,
    );
    expect(l.cobertura.estado).toBe('pendiente');
    expect(d.urls).toEqual([]);
  });

  it('un fallo de descarga es error y no un resultado vacío', async () => {
    const l = await leerFinalSkermo(
      filaIndice(),
      { federacion: 'RFEE', season: '2021-2022' },
      {
        async html() {
          throw new Error('HTTP 429 al pedir la clasificación');
        },
      },
    );
    expect(l.cobertura).toMatchObject({ estado: 'error', publicado: null, importado: 0 });
    expect(l.puestos).toEqual([]);
  });

  it('una clasificación publicada sin filas es sin_resultados, no completa', async () => {
    const vacia = CLASIFICACION.replace(/<tbody>[\s\S]*<\/tbody>/, '<tbody></tbody>');
    const l = await leerFinalSkermo(filaIndice(), { federacion: 'RFEE', season: '2021-2022' }, deps(vacia));
    expect(l.cobertura).toMatchObject({ estado: 'sin_resultados', publicado: 0, importado: 0 });
  });
});
