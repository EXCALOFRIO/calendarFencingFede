import { describe, expect, it } from 'vitest';
import { leerClasificacion } from '@/lib/ingest/sources/rfee-pdf/clasificacion';
import { analizarPagina } from '@/lib/ingest/sources/rfee-pdf/paginas';
import { cabecera, fila, pagina, type Celda } from './fixtures/rfee-pdf/sintetico';

const ESPADA = cabecera('ESPADA MASCULINA INDIVIDUAL');

/** Clasificación final de una página: título, cabecera de la tabla y una fila de datos cada 14 puntos. */
function leer(titulo: string, columnas: Celda[], filas: Celda[][]) {
  return leerClasificacion([
    analizarPagina(pagina(1, [...ESPADA, fila(740, [43, titulo]), fila(727, ...columnas), ...filas.map((c, i) => fila(711 - i * 14, ...c))])),
  ]);
}

const tabla = (l: ReturnType<typeof leer>) => l.puestos.map((p) => [p.posicion ?? p.posicionRaw, p.nombre, p.club, p.pais ?? null]);
const motivos = (l: ReturnType<typeof leer>) => l.rechazos.map((r) => r.motivo);

describe('clasificación guiada por la cabecera de la tabla', () => {
  it('catalán «Pos | Cognom nom | Club | Estatus»: la condición no entra en el club y, sin puesto, es el literal publicado', () => {
    const l = leer('Classificació general (ordre per lloc - 4 tiradors)', [[40, 'Pos'], [70, 'Cognom nom'], [260, 'Club'], [400, 'Estatus']], [
      [[44, '1'], [70, 'ALFA UNO'], [260, 'CLUB-1']],
      [[44, '2'], [70, 'BRAVO DOS'], [260, 'CLUB-2']],
      [[44, '3'], [70, 'CHARLIE TRES'], [260, 'CLUB-3'], [400, 'Abandonament']],
      [[70, 'DELTA CUATRO'], [260, 'CLUB-4'], [400, 'DNS']],
    ]);
    expect(motivos(l)).toEqual([]);
    expect(l).toMatchObject({ publicado: 4, unidad: 'INDIVIDUAL' });
    expect(tabla(l)).toEqual([
      [1, 'ALFA UNO', 'CLUB-1', null],
      [2, 'BRAVO DOS', 'CLUB-2', null],
      [3, 'CHARLIE TRES', 'CLUB-3', null],
      ['DNS', 'DELTA CUATRO', 'CLUB-4', null],
    ]);
    expect(l.puestos[3]).toMatchObject({ posicion: null, posicionRaw: 'DNS' });
  });

  it('inglés «Rank | Name and first name | Flag | Club | Status»: la bandera no publica texto y el DNF de un clasificado no es su club', () => {
    const l = leer('Overall ranking (sorted by rank - 3 fencers)', [[30, 'Rank'], [60, 'Name and first name'], [250, 'Flag'], [290, 'Club'], [420, 'Status']], [
      [[34, '1'], [60, 'ALFA UNO'], [290, 'CLUB-1']],
      [[34, '2'], [60, 'BRAVO DOS'], [290, 'CLUB-2'], [420, 'DNF']],
      [[34, '3'], [60, 'CHARLIE TRES'], [290, 'CLUB-3']],
    ]);
    expect(motivos(l)).toEqual([]);
    expect(tabla(l)).toEqual([
      [1, 'ALFA UNO', 'CLUB-1', null],
      [2, 'BRAVO DOS', 'CLUB-2', null],
      [3, 'CHARLIE TRES', 'CLUB-3', null],
    ]);
  });

  it('«Nación» con un código de tres letras es el país; con un código de club, el club', () => {
    const l = leer(
      'Clasificación general final (orden por lugar - 3 tiradores)',
      [[56, 'CL.'], [90, 'APELLIDO-NOM'], [226, 'NOMBRE'], [323, 'NACION']],
      [
        [[76, '1'], [90, 'ALFA'], [226, 'Uno'], [320, 'ESP']],
        [[76, '2'], [90, 'BRAVO'], [226, 'Dos'], [320, 'CCC-M']],
        [[76, '3'], [90, 'CHARLIE'], [226, 'Tres'], [320, 'FRA']],
      ],
    );
    expect(motivos(l)).toEqual([]);
    expect(tabla(l)).toEqual([
      [1, 'ALFA Uno', null, 'ESP'],
      [2, 'BRAVO Dos', 'CCC-M', null],
      [3, 'CHARLIE Tres', null, 'FRA'],
    ]);
    expect(l.puestos[1]).not.toHaveProperty('pais');
  });

  it('sin total declarado, la tabla de personas es individual; con el club vacío, los datos van a la etiqueta de su izquierda', () => {
    const l = leer('Clasificación general final', [[14, 'cl.'], [40, 'apellido nombre'], [230, 'club'], [330, 'nacion']], [
      [[19, '1'], [40, 'ALFA UNO'], [332, 'ESP']],
      [[19, '2'], [40, 'BRAVO DOS'], [332, 'ITA']],
    ]);
    expect(motivos(l)).toEqual([]);
    expect(l).toMatchObject({ publicado: null, unidad: 'INDIVIDUAL' });
    expect(tabla(l)).toEqual([
      [1, 'ALFA UNO', null, 'ESP'],
      [2, 'BRAVO DOS', null, 'ITA'],
    ]);
  });

  it('puesto y nombre en un solo texto bajo «CL. APELLIDO-NOM | BAND CLUB | CONDICION»', () => {
    const l = leer('Clasificación general final (orden por lugar - 3 tiradores)', [[56, 'CL. APELLIDO-NOM'], [300, 'BAND CLUB'], [420, 'CONDICION']], [
      [[60, '1 ALFA UNO'], [330, 'CLUB-1']],
      [[60, '2 BRAVO DOS'], [330, 'CLUB-2'], [420, 'DNF']],
      [[60, '10 CHARLIE TRES'], [330, 'CLUB-3']],
    ]);
    expect(motivos(l)).toEqual([]);
    expect(tabla(l)).toEqual([
      [1, 'ALFA UNO', 'CLUB-1', null],
      [2, 'BRAVO DOS', 'CLUB-2', null],
      [10, 'CHARLIE TRES', 'CLUB-3', null],
    ]);
  });

  it('por equipos, las líneas de integrantes bajo cada equipo no son puestos ni rechazos', () => {
    const l = leer('Clasificación general final (orden por lugar - 2 equipos)', [[56, 'CL. APELLIDO-NOM'], [300, 'BAND CLUB'], [420, 'CONDICION']], [
      [[60, '1 EQUIPO UNO'], [330, 'CLUB-1']],
      [[80, 'ALFA UNO']],
      [[80, 'BRAVO DOS']],
      [[60, '2 EQUIPO DOS'], [330, 'CLUB-2']],
      [[80, 'CHARLIE TRES']],
    ]);
    expect(motivos(l)).toEqual([]);
    expect(l.unidad).toBe('EQUIPOS');
    expect(l.puestos.map((p) => [p.ref, p.posicion, p.nombre, p.club])).toEqual([
      ['t0001', 1, 'EQUIPO UNO', 'CLUB-1'],
      ['t0002', 2, 'EQUIPO DOS', 'CLUB-2'],
    ]);
  });

  it('más columnas de datos que las declaradas: no se adivina cuál es cada una', () => {
    const l = leer('Clasificación general final (orden por lugar - 2 tiradores)', [[14, 'cl.'], [40, 'apellido nombre'], [230, 'club']], [
      [[19, '1'], [40, 'ALFA'], [130, 'UNO'], [230, 'CLUB-1']],
      [[19, '2'], [40, 'BRAVO'], [130, 'DOS'], [230, 'CLUB-2']],
    ]);
    expect(l.puestos).toEqual([]);
    expect(motivos(l)).toEqual(Array(2).fill('Maquetación de columnas no reconocida (3)'));
  });

  it('un nombre que es una condición («DNF») no se atribuye a nadie', () => {
    const l = leer(
      'Clasificación general final (orden por lugar - 2 tiradores)',
      [[14, 'cl.'], [40, 'apellido nombre'], [230, 'club'], [330, 'condicion']],
      [
        [[19, '1'], [40, 'ALFA UNO'], [230, 'CLUB-1']],
        [[19, '2'], [40, 'DNF'], [230, 'CLUB-2']],
      ],
    );
    expect(tabla(l)).toEqual([[1, 'ALFA UNO', 'CLUB-1', null]]);
    expect(motivos(l)).toEqual(['Fila de clasificación no atribuible a nombre y club']);
  });
});
