import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AcumuladorAsaltos, exclusionesVacias } from '@/lib/ingest/sources/rfee-pdf/asaltos';
import { dividirPaginaPorPruebas } from '@/lib/ingest/sources/rfee-pdf/bloques';
import { leerResultadosPdf } from '@/lib/ingest/sources/rfee-pdf/resultados';
import type { PaginaTexto } from '@/lib/ingest/sources/rfee-pdf/tipos';
import {
  bloqueCriterium,
  cabecera,
  fila,
  pagina,
  paginaClasificacion,
  paginaCuadro,
  paginaPoules,
  type FilaPoule,
  type Tirador,
} from './fixtures/rfee-pdf/sintetico';

const CTX = { url: 'https://app.skermo.org/client/1/prueba.pdf', docId: 'prueba' };

const TRES: Tirador[] = [
  { puesto: '1', nombre: 'ALFA UNO', club: 'AAA-1' },
  { puesto: '2', nombre: 'BRAVO DOS', club: 'BBB-2' },
  { puesto: '3', nombre: 'CHARLIE TRES', club: 'CCC-3' },
];
const CUATRO: Tirador[] = [...TRES, { puesto: '4', nombre: 'DELTA CUATRO', club: 'DDD-4' }];

const POULE_DE_TRES: FilaPoule[] = [
  { nombre: 'ALFA UNO', club: 'AAA-1', celdas: ['V5', 'V5'], vm: '1.000', ind: 3, td: 10, cl: 1 },
  { nombre: 'BRAVO DOS', club: 'BBB-2', celdas: ['3', 'V5'], vm: '0.500', ind: 1, td: 8, cl: 2 },
  { nombre: 'CHARLIE TRES', club: 'CCC-3', celdas: ['4', '2'], vm: '0.000', ind: -4, td: 6, cl: 3 },
];

const ESPADA = cabecera('ESPADA MASCULINA INDIVIDUAL');

const fixture = (nombre: string): { fuente: { url: string }; paginas: PaginaTexto[] } =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/rfee-pdf/${nombre}`, import.meta.url), 'utf8'));

describe('PDF de una prueba individual con poules y cuadro (maquetación Engarde)', () => {
  const semillas = [
    { semilla: 1, nombre: 'ALFA UNO', club: 'AAA-1' },
    { semilla: 4, nombre: 'DELTA CUATRO', club: 'DDD-4' },
    { semilla: 3, nombre: 'CHARLIE TRES', club: 'CCC-3' },
    { semilla: 2, nombre: 'BRAVO DOS', club: 'BBB-2' },
  ];
  const cuadro = (pagina_: number, semis: string, final: string) =>
    paginaCuadro(pagina_, ESPADA, ['Semi-finales', 'Final'], semillas, [
      { x: 297, y: 690, nombre: 'ALFA UN', marcador: semis },
      { x: 297, y: 650, nombre: 'BRAVO D', marcador: '15/12' },
      { x: 469, y: 670, nombre: 'ALFA UNO', marcador: final },
    ]);

  it('lee puestos, un asalto por pareja de la poule y los cruces del cuadro, con página y región', () => {
    const l = leerResultadosPdf(
      [paginaPoules(1, ESPADA, [POULE_DE_TRES]), cuadro(2, '15/10', '15/9'), paginaClasificacion(3, ESPADA, CUATRO)],
      CTX,
    );
    expect(l.pruebas).toHaveLength(1);
    const p = l.pruebas[0];
    expect(p).toMatchObject({ arma: 'ESPADA', genero: 'M', formato: 'INDIVIDUAL', categoria: 'ABS', fecha: '2019-06-08' });
    expect(p.puestos.map((x) => [x.posicion, x.nombre])).toEqual([
      [1, 'ALFA UNO'],
      [2, 'BRAVO DOS'],
      [3, 'CHARLIE TRES'],
      [4, 'DELTA CUATRO'],
    ]);

    const poules = p.asaltos.filter((a) => a.fase === 'POULE');
    expect(poules).toHaveLength(3);
    const alfaBravo = poules.find((a) => a.refA === 'p0001' && a.refB === 'p0002');
    expect(alfaBravo).toMatchObject({ puntosA: 5, puntosB: 3, ronda: 'P1', marcador: 'explicito' });
    expect(poules.find((a) => a.refA === 'p0002' && a.refB === 'p0003')).toMatchObject({ puntosA: 5, puntosB: 2 });

    const tableau = p.asaltos.filter((a) => a.fase === 'TABLEAU');
    expect(tableau.map((a) => [a.ronda, a.nombreA, a.puntosA, a.nombreB, a.puntosB])).toEqual(
      expect.arrayContaining([
        ['A4', 'ALFA UNO', 15, 'DELTA CUATRO', 10],
        ['A4', 'BRAVO DOS', 15, 'CHARLIE TRES', 12],
        ['A2', 'ALFA UNO', 15, 'BRAVO DOS', 9],
      ]),
    );
    expect(tableau).toHaveLength(3);
    expect(tableau.every((a) => a.region.pagina === 2)).toBe(true);
    expect(poules.every((a) => a.region.pagina === 1 && a.region.yMax > a.region.yMin)).toBe(true);
    expect(p.estado).toBe('completo');
    expect(l.estado).toBe('completo');
  });

  it('una V sin número se resuelve con los totales y se marca como derivada', () => {
    const sinNumero: FilaPoule[] = [
      { nombre: 'ALFA UNO', club: 'AAA-1', celdas: ['V', 'V'], vm: '1.000', ind: 3, td: 10, cl: 1 },
      { nombre: 'BRAVO DOS', club: 'BBB-2', celdas: ['3', 'V'], vm: '0.500', ind: 1, td: 8, cl: 2 },
      { nombre: 'CHARLIE TRES', club: 'CCC-3', celdas: ['4', '2'], vm: '0.000', ind: -4, td: 6, cl: 3 },
    ];
    const p = leerResultadosPdf([paginaPoules(1, ESPADA, [sinNumero]), paginaClasificacion(2, ESPADA, TRES)], CTX).pruebas[0];
    expect(p.asaltos).toHaveLength(3);
    expect(p.asaltos.every((a) => a.marcador === 'derivado_de_totales')).toBe(true);
    expect(p.asaltos.find((a) => a.refA === 'p0001' && a.refB === 'p0003')).toMatchObject({ puntosA: 5, puntosB: 4 });
  });

  it('una poule que no cuadra (V/M contradice las celdas) no produce asaltos y queda en revisión', () => {
    const rota = POULE_DE_TRES.map((f, i) => (i === 1 ? { ...f, vm: '1.000' } : f));
    const l = leerResultadosPdf([paginaPoules(1, ESPADA, [rota]), paginaClasificacion(2, ESPADA, TRES)], CTX);
    const p = l.pruebas[0];
    expect(p.asaltos).toHaveLength(0);
    expect(p.rechazos.some((r) => r.seccion === 'poules' && /V\/M/.test(r.motivo))).toBe(true);
    expect(p.cobertura.poules.estado).toBe('parcial');
    expect(p.estado).toBe('parcial');
  });

  it('no atribuye un nombre que encaja con dos tiradores de la clasificación', () => {
    const gemelos: Tirador[] = [
      { puesto: '1', nombre: 'GOMEZ LUIS', club: 'EEE-5' },
      { puesto: '2', nombre: 'GOMEZ LUISA', club: 'EEE-5' },
      { puesto: '3', nombre: 'CHARLIE TRES', club: 'CCC-3' },
    ];
    const poule: FilaPoule[] = [
      { nombre: 'GOMEZ LUIS', club: 'EEE-5', celdas: ['V5', 'V5'], vm: '1.000', ind: 3, td: 10, cl: 1 },
      { nombre: 'GOMEZ LUISA', club: 'EEE-5', celdas: ['3', 'V5'], vm: '0.500', ind: 1, td: 8, cl: 2 },
      { nombre: 'CHARLIE TRES', club: 'CCC-3', celdas: ['4', '2'], vm: '0.000', ind: -4, td: 6, cl: 3 },
    ];
    const p = leerResultadosPdf([paginaPoules(1, ESPADA, [poule]), paginaClasificacion(2, ESPADA, gemelos)], CTX).pruebas[0];
    expect(p.asaltos).toHaveLength(0);
    expect(p.excluidos.identidadNoConfirmada).toBe(3);
    expect(p.estado).toBe('parcial');
  });

  it('un participante sin pareja (guiones) avanza sin asalto y no inventa marcador', () => {
    const conBye = [
      semillas[0],
      { semilla: 4, nombre: '---------', club: '' },
      semillas[2],
      semillas[3],
    ];
    const l = leerResultadosPdf(
      [
        paginaCuadro(1, ESPADA, ['Semi-finales', 'Final'], conBye, [
          { x: 297, y: 690, nombre: 'ALFA UN' },
          { x: 297, y: 650, nombre: 'BRAVO D', marcador: '15/12' },
          { x: 469, y: 670, nombre: 'ALFA UNO', marcador: '15/9' },
        ]),
        paginaClasificacion(2, ESPADA, TRES),
      ],
      CTX,
    );
    const p = l.pruebas[0];
    expect(p.excluidos.bye).toBe(1);
    expect(p.asaltos.map((a) => a.ronda).sort()).toEqual(['A2', 'A4']);
    expect(p.estado).toBe('completo');
  });

  it('un cruce repetido en dos páginas cuenta una vez y un marcador contradictorio retira ambos', () => {
    const iguales = leerResultadosPdf(
      [cuadro(1, '15/10', '15/9'), cuadro(2, '15/10', '15/9'), paginaClasificacion(3, ESPADA, CUATRO)],
      CTX,
    ).pruebas[0];
    expect(iguales.asaltos).toHaveLength(3);
    expect(iguales.excluidos.duplicado).toBe(3);

    const distintos = leerResultadosPdf(
      [cuadro(1, '15/10', '15/9'), cuadro(2, '15/10', '15/7'), paginaClasificacion(3, ESPADA, CUATRO)],
      CTX,
    ).pruebas[0];
    expect(distintos.asaltos.filter((a) => a.ronda === 'A2')).toHaveLength(0);
    expect(distintos.excluidos.conflicto).toBe(2);
    expect(distintos.cobertura.cuadro.estado).toBe('conflicto');
    expect(distintos.estado).toBe('conflicto');
  });

  it('el ganador que no coincide con ninguno de los dos participantes se rechaza', () => {
    const l = leerResultadosPdf(
      [
        paginaCuadro(1, ESPADA, ['Semi-finales', 'Final'], semillas, [
          { x: 297, y: 690, nombre: 'ZULU OTRO', marcador: '15/10' },
          { x: 297, y: 650, nombre: 'BRAVO D', marcador: '15/12' },
        ]),
        paginaClasificacion(2, ESPADA, CUATRO),
      ],
      CTX,
    );
    const p = l.pruebas[0];
    expect(p.asaltos).toHaveLength(1);
    expect(p.rechazos.some((r) => /no coincide/.test(r.motivo))).toBe(true);
    expect(p.estado).toBe('parcial');
  });
});

describe('clasificación sola y pruebas por equipos', () => {
  it('un PDF sólo con clasificación da puestos y cero asaltos, sin pedir poules ni cuadro', () => {
    const l = leerResultadosPdf([paginaClasificacion(1, ESPADA, TRES)], CTX);
    const p = l.pruebas[0];
    expect(p.puestos).toHaveLength(3);
    expect(p.asaltos).toHaveLength(0);
    expect(p.cobertura.poules.estado).toBe('sin_resultados');
    expect(p.cobertura.cuadro.estado).toBe('sin_resultados');
    expect(p.estado).toBe('completo');
  });

  it('una prueba por equipos cuenta sus poules y cuadros como no individuales y no genera asaltos', () => {
    const cab = cabecera('FLORETE MASCULINO EQUIPOS');
    const equipos: Tirador[] = [
      { puesto: '1', nombre: 'CLUB ALFA', club: '' },
      { puesto: '2', nombre: 'CLUB BRAVO', club: '' },
      { puesto: '3', nombre: 'CLUB CHARLIE', club: '' },
    ];
    const l = leerResultadosPdf(
      [
        paginaPoules(1, cab, [POULE_DE_TRES]),
        paginaCuadro(2, cab, ['Semi-finales', 'Final'], [{ semilla: 1, nombre: 'CLUB ALFA', club: '' }], []),
        paginaClasificacion(3, cab, equipos, 'equipos'),
      ],
      CTX,
    );
    const p = l.pruebas[0];
    expect(p.formato).toBe('EQUIPOS');
    expect(p.puestos).toHaveLength(3);
    expect(p.asaltos).toHaveLength(0);
    expect(p.excluidos.equipo).toBe(2);
    expect(p.cobertura.poules.estado).toBe('sin_resultados');
  });
});

describe('varias pruebas en un mismo PDF', () => {
  it('reparte las filas a la cabecera de su página, no al primer título', () => {
    const florete = cabecera('FLORETE FEMENINA INDIVIDUAL', '9 JUNIO 2019');
    const otras: Tirador[] = [
      { puesto: '1', nombre: 'ECO CINCO', club: 'EEE-5' },
      { puesto: '2', nombre: 'FOXTROT SEIS', club: 'FFF-6' },
    ];
    const l = leerResultadosPdf([paginaClasificacion(1, ESPADA, TRES), paginaClasificacion(2, florete, otras)], CTX);
    expect(l.pruebas).toHaveLength(2);
    const [e, f] = l.pruebas;
    expect([e.arma, e.genero, e.puestos.length]).toEqual(['ESPADA', 'M', 3]);
    expect([f.arma, f.genero, f.puestos.length]).toEqual(['FLORETE', 'F', 2]);
    expect(f.puestos.map((x) => x.nombre)).toEqual(['ECO CINCO', 'FOXTROT SEIS']);
    expect(new Set(l.pruebas.map((p) => p.clave)).size).toBe(2);
    expect(f.fecha).toBe('2019-06-09');
  });

  it('el contador «página 1/3» de una sección no crea otra prueba', () => {
    const participantes = pagina(1, [
      fila(822, [270, 'página 1/3']),
      ...ESPADA,
      fila(740, [11, 'Tiradores (presentes - 3)']),
      fila(726, [20, 'ALFA UNO'], [150, 'AAA-1']),
    ]);
    const l = leerResultadosPdf([participantes, paginaClasificacion(2, ESPADA, TRES)], CTX);
    expect(l.pruebas).toHaveLength(1);
    expect(l.pruebas[0].paginas).toEqual([1, 2]);
  });

  it('parte una página de Criterium con tres pruebas, conserva M-10/M-12 y deja sin categoría la que no la declara', () => {
    const filasA = [
      { cl: 'Ganadora', apellidos: 'ALFA UNO', nombre: 'ANA', club: 'CLUB A' },
      { cl: 'Finalista', apellidos: 'BRAVO DOS', nombre: 'BEA', club: 'CLUB B' },
      { cl: '3', apellidos: 'DE LA CRUZ', nombre: 'CARLA', club: 'CLUB C' },
      { cl: '3', apellidos: 'DELTA CUATRO', nombre: 'DANA', club: 'CLUB D' },
      { cl: '5', apellidos: 'ECO CINCO', nombre: 'EVA', club: 'CLUB E' },
    ];
    const unica = pagina(1, [
      ...bloqueCriterium(764, 'CRITERIUM NACIONAL M-10', 'ESPADA FEMENINA 2009', filasA),
      ...bloqueCriterium(640, 'CRITERIUM NACIONAL M-12', 'FLORETE MASCULINO 2007', [
        { cl: 'Ganador', apellidos: 'FOXTROT SEIS', nombre: 'FER', club: 'CLUB F' },
        { cl: 'Finalista', apellidos: 'GOLF SIETE', nombre: 'GIL', club: 'CLUB G' },
      ]),
      ...bloqueCriterium(520, 'CRITERIUM NACIONAL', 'SABLE FEMENINA 2011', [{ cl: 'Ganadora', apellidos: 'HOTEL OCHO', nombre: 'HIA', club: 'CLUB H' }]),
    ]);

    expect(dividirPaginaPorPruebas(unica)).toHaveLength(3);

    const l = leerResultadosPdf([unica], CTX);
    expect(l.pruebas).toHaveLength(3);
    const [m10, m12, sinCategoria] = l.pruebas;
    expect([m10.categoria, m10.categoriaOriginal, m10.cohorte, m10.formato, m10.fecha]).toEqual(['M10', 'M10', '2009', 'INDIVIDUAL', '2019-06-16']);
    expect([m12.categoria, m12.cohorte, m12.arma, m12.genero]).toEqual(['M12', '2007', 'FLORETE', 'M']);
    expect(m10.puestos).toHaveLength(5);
    expect(m12.puestos).toHaveLength(2);

    // Empates sin renumerar y literales de puesto sin inventar números.
    expect(m10.puestos.map((x) => [x.posicion, x.posicionRaw])).toEqual([
      [null, 'Ganadora'],
      [null, 'Finalista'],
      [3, null],
      [3, null],
      [5, null],
    ]);
    expect(m10.puestos[2].nombre).toBe('DE LA CRUZ CARLA');
    expect(m10.estado).toBe('completo');

    // No se aproxima M-10/M-12 por el año de nacimiento.
    expect(sinCategoria.categoria).toBeNull();
    expect(sinCategoria.cohorte).toBe('2011');
    expect(sinCategoria.estado).toBe('parcial');
    expect(l.estado).toBe('parcial');
  });

  it('abandonos y retiradas conservan el literal publicado sin inventar el puesto', () => {
    const l = leerResultadosPdf(
      [
        paginaClasificacion(1, ESPADA, [
          { puesto: '1', nombre: 'ALFA UNO', club: 'AAA-1' },
          { puesto: '2', nombre: 'BRAVO DOS', club: 'BBB-2' },
          { puesto: '2', nombre: 'CHARLIE TRES', club: 'CCC-3' },
          { puesto: '4', nombre: 'DELTA CUATRO', club: 'DDD-4' },
          { puesto: 'Abandono', nombre: 'ECO CINCO', club: 'EEE-5' },
        ]),
      ],
      CTX,
    );
    const p = l.pruebas[0];
    expect(p.puestos.map((x) => x.posicion)).toEqual([1, 2, 2, 4, null]);
    expect(p.puestos[4].posicionRaw).toBe('Abandono');
    expect(new Set(p.puestos.map((x) => x.ref)).size).toBe(5);
  });
});

describe('páginas sin texto o ilegibles', () => {
  it('una página sin texto se marca para OCR/revisión, sin ejecutarlo y sin dar el documento por completo', () => {
    const l = leerResultadosPdf([paginaClasificacion(1, ESPADA, TRES), pagina(2, [fila(500, [10, '1/1'])])], CTX);
    expect(l.ocr).toMatchObject({ necesario: true, paginas: [2], ejecutado: false });
    expect(l.paginas.find((p) => p.pagina === 2)).toMatchObject({ tipo: 'sin_texto', prueba: null });
    expect(l.estado).toBe('parcial');
  });

  it('un PDF escaneado entero queda pendiente, sin pruebas inventadas', () => {
    const l = leerResultadosPdf([pagina(1, []), pagina(2, [])], CTX);
    expect(l.pruebas).toHaveLength(0);
    expect(l.ocr).toMatchObject({ necesario: true, paginas: [1, 2], ejecutado: false });
    expect(l.estado).toBe('pendiente');
  });

  it('texto con caracteres perdidos se trata como ilegible', () => {
    const roto = pagina(1, [fila(700, [20, '\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD'], [100, '\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD'])]);
    const l = leerResultadosPdf([roto], CTX);
    expect(l.paginas[0].tipo).toBe('ilegible');
    expect(l.ocr.paginas).toEqual([1]);
    expect(l.estado).toBe('pendiente');
  });

  it('una prueba sin arma o género declarados queda pendiente y sus puestos no se asignan', () => {
    const l = leerResultadosPdf([paginaClasificacion(1, [fila(810, [200, 'TORNEO SIN DATOS'])], TRES)], CTX);
    expect(l.pruebas[0].puestos).toHaveLength(0);
    expect(l.pruebas[0].estado).toBe('pendiente');
    expect(l.estado).toBe('pendiente');
  });
});

describe('AcumuladorAsaltos', () => {
  const base = {
    fase: 'TABLEAU' as const,
    ronda: 'A2',
    rondaOriginal: 'Final',
    marcador: 'explicito' as const,
    region: { pagina: 1, yMax: 10, yMin: 0 },
  };
  it('orienta el marcador a refA < refB y trata el mismo cruce a la inversa como el mismo asalto', () => {
    const ex = exclusionesVacias();
    const acu = new AcumuladorAsaltos(ex);
    acu.agregar({ ...base, ganador: { ref: 'p0002', nombre: 'B', puntos: 15 }, perdedor: { ref: 'p0001', nombre: 'A', puntos: 9 } });
    acu.agregar({ ...base, ganador: { ref: 'p0002', nombre: 'B', puntos: 15 }, perdedor: { ref: 'p0001', nombre: 'A', puntos: 9 } });
    expect(acu.asaltos).toHaveLength(1);
    expect(acu.asaltos[0]).toMatchObject({ refA: 'p0001', puntosA: 9, refB: 'p0002', puntosB: 15 });
    expect(ex.duplicado).toBe(1);
  });
});

describe('fixtures reales minimizados (PDF públicos RFEE 2018-19, nombres cifrados)', () => {
  it('espada masculina absoluta: 28 puestos, 84 duelos de poule y 15 de cuadro; las V sin número salen del tope que demuestra la vuelta', () => {
    const f = fixture('abs-individual-espada-2019.json');
    expect(f.fuente.url).toMatch(/^https:\/\/app\.skermo\.org\/client\/1\/[0-9a-f]{32}\.pdf$/);
    const l = leerResultadosPdf(f.paginas, { url: f.fuente.url, docId: 'abs' });
    const p = l.pruebas[0];
    expect(p).toMatchObject({ arma: 'ESPADA', genero: 'M', formato: 'INDIVIDUAL', categoria: 'ABS', fecha: '2019-06-08' });
    expect(p.puestos).toHaveLength(28);
    expect(p.cobertura.puestos).toMatchObject({ estado: 'completo', publicado: 28, importado: 28 });
    expect(p.cobertura.cuadro).toMatchObject({ estado: 'completo', publicado: 15, importado: 15 });

    // Las 9 V que la aritmética obliga valen 5 y ningún tanteo publicado pasa de 5: las otras 68 V se fijan con ese tope.
    const poules = p.asaltos.filter((a) => a.fase === 'POULE');
    expect(p.cobertura.poules).toMatchObject({ estado: 'completo', publicado: 84, importado: 84 });
    expect(poules.filter((a) => a.marcador === 'derivado_de_totales')).toHaveLength(9);
    expect(poules.filter((a) => a.marcador === 'derivado_de_limite')).toHaveLength(68);
    expect(poules.filter((a) => a.marcador !== 'explicito').every((a) => Math.max(a.puntosA, a.puntosB) === 5)).toBe(true);
    expect(poules.every((a) => Math.max(a.puntosA, a.puntosB) <= 5)).toBe(true);
    expect(p.excluidos).toMatchObject({ sinMarcador: 0, identidadNoConfirmada: 0, incoherente: 0, conflicto: 0, sinGanador: 0 });
    expect(p.rechazos).toEqual([]);
    expect(p.estado).toBe('completo');
    expect(l.estado).toBe('completo');

    expect(p.asaltos.filter((a) => a.fase === 'TABLEAU')).toHaveLength(15);
    const claves = new Set(p.asaltos.map((a) => `${a.fase}|${a.ronda}|${a.refA}|${a.refB}`));
    expect(claves.size).toBe(p.asaltos.length);
    expect(p.asaltos.every((a) => a.puntosA !== a.puntosB && a.refA < a.refB)).toBe(true);
    expect(new Set(p.asaltos.filter((a) => a.fase === 'TABLEAU').map((a) => a.ronda))).toEqual(new Set(['A16', 'A8', 'A4', 'A2']));
  });
  it('florete por equipos: cuatro puestos y cero asaltos individuales aunque haya cuadro', () => {
    const f = fixture('abs-equipos-florete-2019.json');
    const l = leerResultadosPdf(f.paginas, { url: f.fuente.url, docId: 'eq' });
    const p = l.pruebas[0];
    expect(p).toMatchObject({ formato: 'EQUIPOS', arma: 'FLORETE', genero: 'M' });
    expect(p.puestos).toHaveLength(4);
    expect(p.asaltos).toHaveLength(0);
    expect(p.excluidos.equipo).toBe(2);
    expect(l.estado).toBe('completo');
  });

  it('Criterium M-10/M-12: una prueba por bloque, categoría publicada y la prueba sin categoría en revisión', () => {
    const f = fixture('criterium-m10-m12-2019.json');
    const l = leerResultadosPdf(f.paginas, { url: f.fuente.url, docId: 'crit' });
    expect(l.pruebas).toHaveLength(7);
    const porCategoria = (c: string | null) => l.pruebas.filter((p) => p.categoria === c);
    expect(porCategoria('M10')).toHaveLength(4);
    expect(porCategoria('M12')).toHaveLength(2);
    expect(porCategoria(null)).toHaveLength(1);
    expect(porCategoria(null)[0]).toMatchObject({ cohorte: '2011', estado: 'parcial' });
    expect(l.pruebas.every((p) => p.formato === 'INDIVIDUAL' && p.asaltos.length === 0)).toBe(true);
    expect(l.pruebas.every((p) => p.puestos.every((x) => x.posicion !== null || x.posicionRaw !== null))).toBe(true);
    expect(new Set(l.pruebas.map((p) => p.clave)).size).toBe(7);
    expect(l.estado).toBe('parcial');
  });
});
