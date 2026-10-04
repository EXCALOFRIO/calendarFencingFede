import type { ItemTexto, PaginaTexto } from '@/lib/ingest/sources/rfee-pdf/tipos';

/**
 * Constructores de texto posicionado con la maquetación de Engarde, para
 * probar el lector sin PDF ni personas reales. Los nombres son inventados.
 */

export type Celda = [x: number, texto: string];
export type FilaSintetica = { y: number; celdas: Celda[] };

export const fila = (y: number, ...celdas: Celda[]): FilaSintetica => ({ y, celdas });

export function pagina(numero: number, filas: FilaSintetica[]): PaginaTexto {
  const items: ItemTexto[] = filas.flatMap((f) =>
    f.celdas.map(([x, s]) => ({ s, x, y: f.y, w: s.length * 3.6, h: 8 })),
  );
  return { numero, ancho: 595, alto: 842, items };
}

/** Cabecera de prueba de Engarde: título, línea de arma, fecha. */
export function cabecera(arma: string, fecha = '8 JUNIO 2019', titulo = 'CTO ESPAÑA ABSOLUTO 2019'): FilaSintetica[] {
  return [fila(810, [200, titulo]), fila(796, [215, arma]), fila(782, [215, fecha])];
}

export type Tirador = { puesto: string; nombre: string; club: string };

/** «Clasificación general final» con total declarado y columna «apellido nombre». */
export function paginaClasificacion(numero: number, cab: FilaSintetica[], tiradores: Tirador[], unidad = 'tiradores'): PaginaTexto {
  return pagina(numero, [
    ...cab,
    fila(740, [43, `Clasificación general final (orden por lugar - ${tiradores.length} ${unidad})`]),
    fila(727, [55, 'clas'], [81, 'apellido nombre'], [277, 'club']),
    ...tiradores.map((t, i) => fila(711 - i * 14, [55, t.puesto], [81, t.nombre], [277, t.club])),
  ]);
}

export type FilaPoule = { nombre: string; club: string; celdas: string[]; vm: string; ind: number; td: number; cl: number };

/**
 * Filas de poule a partir de los tocados reales, como las escribe Engarde: la
 * victoria que llega a `tope` sale como «V» a secas y la que no, como «V3».
 * `coma` publica V/M con coma decimal, como los equipos en catalán.
 */
export function filasPoule(tocados: number[][], tiradores: readonly Tirador[], { tope = 5, coma = false } = {}): FilaPoule[] {
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
        celdas.push(fila[j] === tope ? 'V' : `V${fila[j]}`);
      } else celdas.push(String(fila[j]));
    }
    const vm = (victorias / (n - 1)).toFixed(3);
    const t = tiradores[i];
    return { nombre: t.nombre, club: t.club, celdas, vm: coma ? vm.replace('.', ',') : vm, ind: td - recibidos, td, cl: i + 1 };
  });
}

export function paginaPoules(numero: number, cab: FilaSintetica[], poules: FilaPoule[][], vuelta = 1): PaginaTexto {
  const filas: FilaSintetica[] = [...cab, fila(770, [11, `Poules, vuelta No ${vuelta}`])];
  let y = 740;
  poules.forEach((p, k) => {
    filas.push(fila(y, [11, `Poule No ${k + 1}`]));
    filas.push(fila(y - 12, [11, 'Arbitro: ARBITRO UNO']));
    filas.push(fila(y - 24, [301, 'V/M'], [342, 'ind.'], [376, 'TD'], [407, 'cl.']));
    p.forEach((r, i) => {
      filas.push(
        fila(
          y - 36 - i * 12,
          [17, r.nombre],
          [125, r.club],
          ...r.celdas.map((c, j): Celda => [197 + j * 13, c]),
          [301, r.vm],
          [350, String(r.ind)],
          [380, String(r.td)],
          [412, String(r.cl)],
        ),
      );
    });
    y -= 36 + p.length * 12 + 20;
  });
  return pagina(numero, filas);
}

export type SemillaCuadro = { semilla: number; nombre: string; club: string };
export type GanadorCuadro = { x: number; y: number; nombre: string; marcador?: string };

/** Cuadro de eliminación: columna de tiradores y columnas de ganadores a media altura. */
export function paginaCuadro(
  numero: number,
  cab: FilaSintetica[],
  rondas: string[],
  semillas: SemillaCuadro[],
  ganadores: GanadorCuadro[],
): PaginaTexto {
  const base = pagina(numero, [
    ...cab,
    fila(770, ...rondas.map((r, k): Celda => [k === 0 ? 18 : 297 + (k - 1) * 172, r])),
    ...semillas.map((s, i) => fila(700 - i * 20, [18, String(s.semilla)], [42, s.nombre], [214, s.club])),
  ]);
  const extra: ItemTexto[] = ganadores.flatMap((g) => {
    const lista: ItemTexto[] = [{ s: g.nombre, x: g.x, y: g.y, w: g.nombre.length * 3.6, h: 8 }];
    if (g.marcador) lista.push({ s: g.marcador, x: g.x + 2, y: g.y - 10, w: 20, h: 8 });
    return lista;
  });
  return { ...base, items: [...base.items, ...extra] };
}

/** Bloque de Criterium: varias pruebas por página, nombre en dos columnas y literales de puesto. */
export function bloqueCriterium(yTope: number, titulo: string, arma: string, filas: { cl: string; apellidos: string; nombre: string; club: string }[]): FilaSintetica[] {
  return [
    fila(yTope, [171, titulo]),
    fila(yTope - 9, [176, arma]),
    fila(yTope - 18, [200, 'SEDE UNO']),
    fila(yTope - 27, [201, '16-jun-19']),
    fila(yTope - 43, [174, 'Clasificación general final']),
    fila(yTope - 60, [86, 'Cl.'], [150, 'Apellidos'], [249, 'Nombre'], [320, 'Club']),
    ...filas.map((f, i) => fila(yTope - 69 - i * 9, [f.cl.length > 2 ? 72 : 100, f.cl], [112, f.apellidos], [231, f.nombre], [297, f.club])),
  ];
}
