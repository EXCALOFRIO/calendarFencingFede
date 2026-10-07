import { describe, expect, it } from 'vitest';
import { aDatosPersonales, cargarExtrasPerfil, leerDatosPersonales } from '@/lib/sport/explorar/perfil-extra';
import { enlacePruebaPerfil, nombreListaPerfil } from '@/lib/sport/explorar/resultados-perfil';
import { fundirPruebasRepetidas, type FilaPruebaAmbito } from '@/lib/sport/explorar/stats-ambito';
import { clasificarCompeticion, subtipoCompeticion, tipoPorNombre } from '@/lib/sport/explorar/tipo-competicion';
import { UUID_A, crearContexto } from './helpers/explorar';

const fila = (extra: Partial<FilaPruebaAmbito> = {}): FilaPruebaAmbito => ({
  fuente: 'skermo_rfee',
  fuenteResultado: 'skermo_rfee',
  torneo: 'TNR Absoluto Madrid',
  categoria: 'ABS',
  pais: 'ESP',
  ambitoEvento: null,
  circuitoEvento: null,
  fuenteEvento: null,
  fecha: '2026-02-10',
  arma: 'ESPADA',
  genero: 'M',
  puesto: 5,
  puestoResultado: 5,
  asaltos: 6,
  victorias: 4,
  derrotas: 2,
  dados: 25,
  recibidos: 20,
  ...extra,
} as FilaPruebaAmbito);

describe('tipo de competición', () => {
  it('el Campeonato de España se reconoce también abreviado', () => {
    expect(tipoPorNombre('CTO ESP JUNIOR')).toBe('CTO_ESPANA');
    expect(tipoPorNombre('Campeonato de España Absoluto')).toBe('CTO_ESPANA');
    expect(tipoPorNombre('Torneo de Navidad')).toBeNull();
  });

  it('el Campeonato y los Juegos del Mediterráneo tienen nombre propio sin cambiar el tipo', () => {
    const cto = clasificarCompeticion({ nombre: 'Championnats de la Méditerranée', fuente: 'fie' });
    expect(cto).toMatchObject({ tipo: 'CTO_CONTINENTAL', etiqueta: 'Campeonato del Mediterráneo', corta: 'Mediterráneo' });
    const juegos = clasificarCompeticion({ nombre: 'Juegos Mediterráneos Tarragona', fuente: 'fie' });
    expect(juegos).toMatchObject({ tipo: 'JUEGOS_MULTIDEPORTE', etiqueta: 'Juegos Mediterráneos' });
    expect(subtipoCompeticion('CTO_CONTINENTAL', 'Asian Championships')).toBeNull();
    expect(clasificarCompeticion({ nombre: 'Asian Championships', fuente: 'fie' }).corta).toBe('Continental');
  });

  it('Engarde sin sede extranjera es nacional', () => {
    expect(clasificarCompeticion({ nombre: 'Open de Getafe', fuente: 'engarde' }).ambito).toBe('nacional');
    expect(clasificarCompeticion({ nombre: 'Open de Paris', fuente: 'engarde', pais: 'FRA' }).ambito).toBe('internacional');
  });
});

describe('pruebas repetidas entre fuentes', () => {
  it('funde la misma prueba de Skermo y del PDF, con el puesto y los asaltos de la copia más completa', () => {
    const r = fundirPruebasRepetidas([
      fila({ fuente: 'skermo_rfee', fuenteResultado: 'skermo_rfee', asaltos: 9, victorias: 6, derrotas: 3 }),
      fila({ fuente: 'rfee_pdf', fuenteResultado: 'rfee_pdf', asaltos: 0, victorias: 0, derrotas: 0 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ puesto: 5, asaltos: 9, victorias: 6 });
  });

  it('dos puestos distintos dejan la prueba sin puesto y otro día no se funde', () => {
    const contradicen = fundirPruebasRepetidas([
      fila({ fuente: 'skermo_rfee', fuenteResultado: 'skermo_rfee', puesto: 5, puestoResultado: 5 }),
      fila({ fuente: 'rfee_pdf', fuenteResultado: 'rfee_pdf', puesto: 7, puestoResultado: 7 }),
    ]);
    expect(contradicen).toHaveLength(1);
    expect(contradicen[0].puesto).toBeNull();
    const distintas = fundirPruebasRepetidas([fila(), fila({ fuente: 'rfee_pdf', fuenteResultado: 'rfee_pdf', fecha: '2026-02-11' })]);
    expect(distintas).toHaveLength(2);
  });

  it('la misma fuente dos veces el mismo día no se funde', () => {
    expect(fundirPruebasRepetidas([fila(), fila()])).toHaveLength(2);
  });
});

describe('fila del historial', () => {
  it('abre la prueba en su edición con la persona resaltada', () => {
    const href = enlacePruebaPerfil('ed-1', 'c-1', UUID_A);
    expect(href).toMatch(/ed-1/);
    expect(href).toContain('prueba=c-1');
    expect(href).toContain(`persona=${UUID_A}`);
  });

  it('el nombre de una prueba individual no arrastra el «par équipes» de la edición', () => {
    expect(nombreListaPerfil('Coupe du Monde par équipes', 'INDIVIDUAL', 'fie')).not.toMatch(/quipes/i);
    expect(nombreListaPerfil('Championnats d’Europe juniors', 'INDIVIDUAL', 'fie')).not.toContain('’');
  });
});

describe('datos personales del perfil', () => {
  it('edad por año para cualquiera, mano, altura y club; lo vacío no sale', () => {
    expect(aDatosPersonales({
      nombreCompleto: ' Carlos Llavador Fernández ', anio: 1996, mano: 'L', altura: 183, clubNombre: null, clubCodigo: 'SAMA-M',
    }, '2026-10-06')).toEqual({
      nombreCompleto: 'Carlos Llavador Fernández', edad: 30, mano: 'L', alturaCm: 183, club: { nombre: null, codigo: 'SAMA-M' },
    });
    expect(aDatosPersonales({ nombreCompleto: null, anio: 2013, mano: null, altura: null, clubNombre: 'CE Madrid', clubCodigo: 'X' }, '2026-10-06'))
      .toEqual({ nombreCompleto: null, edad: null, mano: null, alturaCm: null, club: { nombre: 'CE Madrid', codigo: null }, edadVetada: true });
    expect(aDatosPersonales({ nombreCompleto: '', anio: null, mano: 'X', altura: null, clubNombre: null, clubCodigo: null }, '2026-10-06')).toBeNull();
    expect(aDatosPersonales(undefined, '2026-10-06')).toBeNull();
  });

  it('sin la tabla perfil_deportista no falla: sólo no hay datos', async () => {
    const { ctx } = crearContexto({
      respuestas: [{ cuando: /FROM perfil_deportista/, filas: () => { throw new Error('no such table: perfil_deportista'); } }],
    });
    expect(await leerDatosPersonales(ctx.db, UUID_A, '2026-10-06')).toBeNull();
  });

  it('una entrada que no es un identificador no consulta nada', async () => {
    const { ctx, sentencias } = crearContexto();
    expect(await cargarExtrasPerfil(ctx, 'nada')).toEqual({ datos: null, rendimiento: null });
    expect(sentencias).toHaveLength(0);
  });
});
