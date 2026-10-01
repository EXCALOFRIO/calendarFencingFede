import { describe, expect, it } from 'vitest';
import { leerResultadosPdf } from '@/lib/ingest/sources/rfee-pdf/resultados';
import { cabecera, paginaClasificacion, paginaCuadro, paginaPoules, type FilaPoule, type Tirador } from './fixtures/rfee-pdf/sintetico';

const CTX = { url: 'https://app.skermo.org/client/1/prueba.pdf', docId: 'prueba' };
const ESPADA = cabecera('ESPADA MASCULINA INDIVIDUAL');

const NOMBRES: Tirador[] = [
  { puesto: '1', nombre: 'ALFA UNO', club: 'AAA-1' },
  { puesto: '2', nombre: 'BRAVO DOS', club: 'BBB-2' },
  { puesto: '3', nombre: 'CHARLIE TRES', club: 'CCC-3' },
  { puesto: '4', nombre: 'DELTA CUATRO', club: 'DDD-4' },
];

/**
 * Matriz de poule a partir de los tocados reales de cada cruce. `sinNumero`
 * lista las celdas ganadoras que el PDF publica como «V» a secas.
 */
function poule(tocados: number[][], sinNumero: [number, number][] = []): FilaPoule[] {
  const n = tocados.length;
  return tocados.map((fila, i) => {
    const celdas: string[] = [];
    let victorias = 0;
    let td = 0;
    let recibidos = 0;
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      td += fila[j];
      recibidos += tocados[j][i];
      if (fila[j] > tocados[j][i]) {
        victorias += 1;
        celdas.push(sinNumero.some(([a, b]) => a === i && b === j) ? 'V' : `V${fila[j]}`);
      } else celdas.push(String(fila[j]));
    }
    return {
      nombre: NOMBRES[i].nombre,
      club: NOMBRES[i].club,
      celdas,
      vm: (victorias / (n - 1)).toFixed(3),
      ind: td - recibidos,
      td,
      cl: i + 1,
    };
  });
}

const leer = (poules: FilaPoule[][], tiradores = NOMBRES) =>
  leerResultadosPdf([paginaPoules(1, ESPADA, poules), paginaClasificacion(2, ESPADA, tiradores)], CTX).pruebas[0];

describe('V sin número: incógnita por celda resuelta por los totales publicados', () => {
  // A→C=5, A→D=5, B→C=5, B→D=5 con cruces A-B y C-D explícitos.
  const BASE = [
    [0, 5, 5, 5],
    [3, 0, 5, 5],
    [2, 4, 0, 5],
    [3, 1, 2, 0],
  ];

  it('una única incógnita en su fila se resuelve, se marca derivada y conserva los marcadores explícitos', () => {
    const p = leer([poule(BASE, [[0, 2]])]);
    expect(p.asaltos).toHaveLength(6);
    const ac = p.asaltos.find((a) => a.refA === 'p0001' && a.refB === 'p0003');
    expect(ac).toMatchObject({ puntosA: 5, puntosB: 2, marcador: 'derivado_de_totales' });
    const explicitos = p.asaltos.filter((a) => a.marcador === 'explicito');
    expect(explicitos).toHaveLength(5);
    expect(p.estado).toBe('completo');
  });

  it('dos incógnitas con valores distintos se resuelven celda a celda sin suponer un valor común', () => {
    // A→C=4 y B→D=6: valores distintos, sólo deducibles celda a celda.
    const tocados = [
      [0, 5, 4, 5],
      [3, 0, 5, 6],
      [2, 4, 0, 5],
      [3, 1, 2, 0],
    ];
    const p = leer([poule(tocados, [[0, 2], [1, 3]])]);
    expect(p.asaltos).toHaveLength(6);
    expect(p.asaltos.find((a) => a.refA === 'p0001' && a.refB === 'p0003')).toMatchObject({ puntosA: 4, puntosB: 2, marcador: 'derivado_de_totales' });
    expect(p.asaltos.find((a) => a.refA === 'p0002' && a.refB === 'p0004')).toMatchObject({ puntosA: 6, puntosB: 1, marcador: 'derivado_de_totales' });
    expect(p.estado).toBe('completo');
  });

  it('un ciclo de cuatro V cuyos totales admiten varias soluciones no se completa: parcial, sin tanteo inventado', () => {
    const p = leer([poule(BASE, [[0, 2], [0, 3], [1, 2], [1, 3]])]);
    // Sólo los dos cruces con tanteo explícito.
    expect(p.asaltos.map((a) => [a.refA, a.refB, a.marcador])).toEqual(
      expect.arrayContaining([
        ['p0001', 'p0002', 'explicito'],
        ['p0003', 'p0004', 'explicito'],
      ]),
    );
    expect(p.asaltos).toHaveLength(2);
    expect(p.asaltos.some((a) => a.marcador === 'derivado_de_totales')).toBe(false);
    expect(p.excluidos.sinMarcador).toBe(4);
    const r = p.rechazos.find((x) => x.seccion === 'poules');
    expect(r).toBeDefined();
    expect(r?.region).toMatchObject({ pagina: 1 });
    expect(p.cobertura.poules).toMatchObject({ estado: 'parcial', publicado: 6, importado: 2 });
    expect(p.estado).toBe('parcial');
  });

  it('un total que contradice las celdas rechaza la poule entera', () => {
    const filas = poule(BASE, [[0, 2]]).map((f, i) => (i === 0 ? { ...f, td: f.td + 1 } : f));
    const p = leer([filas]);
    expect(p.asaltos).toHaveLength(0);
    expect(p.cobertura.poules.estado).toBe('parcial');
  });
});

describe('secciones reconocidas que no se pueden leer no quedan completas como vacías', () => {
  const DOS: Tirador[] = NOMBRES.slice(0, 2);

  it('matriz de dos filas con tanteos numéricos y V/M=0: sin ganador, no es un duelo ni cobertura completa', () => {
    const filas: FilaPoule[] = [
      { nombre: 'ALFA UNO', club: 'AAA-1', celdas: ['4'], vm: '0.000', ind: 1, td: 4, cl: 1 },
      { nombre: 'BRAVO DOS', club: 'BBB-2', celdas: ['3'], vm: '0.000', ind: -1, td: 3, cl: 2 },
    ];
    const p = leer([filas], DOS);
    expect(p.asaltos).toHaveLength(0);
    expect(p.excluidos.sinGanador).toBe(1);
    expect(p.rechazos.some((r) => r.seccion === 'poules' && r.region?.pagina === 1)).toBe(true);
    expect(p.cobertura.poules).toMatchObject({ estado: 'parcial', publicado: 1, importado: 0 });
    expect(p.estado).toBe('parcial');
  });

  it('sección de poules sin ninguna poule reconocible: rechazo con página y parcial', () => {
    const p = leer([], DOS);
    expect(p.asaltos).toHaveLength(0);
    const r = p.rechazos.find((x) => x.seccion === 'poules');
    expect(r?.region?.pagina).toBe(1);
    expect(p.cobertura.poules.estado).toBe('parcial');
    expect(p.estado).toBe('parcial');
  });

  it('cuadro sin columna de ganadores: rechazo con página y parcial', () => {
    const semillas = NOMBRES.map((t, i) => ({ semilla: i + 1, nombre: t.nombre, club: t.club }));
    const l = leerResultadosPdf(
      [paginaCuadro(1, ESPADA, ['Semi-finales', 'Final'], semillas, []), paginaClasificacion(2, ESPADA, NOMBRES)],
      CTX,
    );
    const p = l.pruebas[0];
    expect(p.asaltos).toHaveLength(0);
    expect(p.rechazos.some((r) => r.seccion === 'cuadro' && r.region?.pagina === 1)).toBe(true);
    expect(p.cobertura.cuadro.estado).toBe('parcial');
    expect(l.estado).toBe('parcial');
  });

  it('una pareja del cuadro sin ganador en la columna siguiente se rechaza y deja la prueba parcial', () => {
    const semillas = NOMBRES.map((t, i) => ({ semilla: i + 1, nombre: t.nombre, club: t.club }));
    const l = leerResultadosPdf(
      [
        paginaCuadro(1, ESPADA, ['Semi-finales'], semillas, [{ x: 297, y: 690, nombre: 'ALFA UN', marcador: '15/10' }]),
        paginaClasificacion(2, ESPADA, NOMBRES),
      ],
      CTX,
    );
    const p = l.pruebas[0];
    expect(p.rechazos.some((r) => r.seccion === 'cuadro' && r.region?.pagina === 1)).toBe(true);
    expect(p.cobertura.cuadro.estado).toBe('parcial');
    expect(p.estado).toBe('parcial');
  });

  it('el BYE demostrado y la clasificación sola siguen completos, sin rechazos inventados', () => {
    const semillas = [
      { semilla: 1, nombre: 'ALFA UNO', club: 'AAA-1' },
      { semilla: 4, nombre: '---------', club: '' },
      { semilla: 3, nombre: 'CHARLIE TRES', club: 'CCC-3' },
      { semilla: 2, nombre: 'BRAVO DOS', club: 'BBB-2' },
    ];
    const conBye = leerResultadosPdf(
      [
        paginaCuadro(1, ESPADA, ['Semi-finales', 'Final'], semillas, [
          { x: 297, y: 690, nombre: 'ALFA UN' },
          { x: 297, y: 650, nombre: 'BRAVO D', marcador: '15/12' },
          { x: 469, y: 670, nombre: 'ALFA UNO', marcador: '15/9' },
        ]),
        paginaClasificacion(2, ESPADA, NOMBRES.slice(0, 3)),
      ],
      CTX,
    ).pruebas[0];
    expect(conBye.rechazos).toHaveLength(0);
    expect(conBye.estado).toBe('completo');

    const sola = leerResultadosPdf([paginaClasificacion(1, ESPADA, NOMBRES)], CTX).pruebas[0];
    expect(sola.rechazos).toHaveLength(0);
    expect(sola.estado).toBe('completo');
  });
});
