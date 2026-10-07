import * as cheerio from 'cheerio';
import { normalizeSportName } from '../../src/lib/identity/resolver';

/**
 * Cuadro de las exportaciones HTML de Engarde anteriores a 2010 (las que la
 * FIE colgó en live.fie.ch y fie.ch/External_Data), que no traen títulos de
 * columna: cada `table.tableau` lleva en `summary` (o en el `<h3>` previo)
 * «Tableau de N», la ronda de la primera columna de cruces.
 *
 * La tabla es un árbol en rejilla: las filas de entrada llevan el número de
 * cabeza de serie, el nombre y la nación; cada ronda posterior es una columna
 * en la que el ganador aparece (celda `HBD`) entre las dos filas de sus
 * rivales de la columna anterior, y el marcador («15/11», el del ganador
 * primero) en la celda de debajo, en la misma columna.
 */

export type CruceArbol = { ronda: string; nombreA: string; paisA: string | null; puntosA: number; nombreB: string; paisB: string | null; puntosB: number };
export type CuadroArbol = {
  estado: 'leido' | 'sin_cuadro';
  cruces: CruceArbol[];
  /** Cruces con dos tiradores que la rejilla implica (sin exentos). */
  esperados: number;
  excluidos: Record<string, number>;
  /** Hay un único ganador en la última columna de la tabla con la final. */
  completo: boolean;
};

const limpio = (s: string) => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const sumar = (m: Record<string, number>, k: string, n = 1) => (m[k] = (m[k] ?? 0) + n);

type Entrada = { fila: number; nombre: string; pais: string | null };

/**
 * Tamaño de la ronda inicial de la tabla: «Tableau de 128», «Tableau
 * préliminaire de 256», «Table of 64», «Tabla de 32», «Quarts de finale»...
 */
export function rondaInicial(texto: string): number | null {
  const t = texto.replace(/\u00a0/g, ' ').trim();
  const m = /(?:tableau|table|tabla)\b[^0-9]{0,20}?\b(?:de|of)\s+(\d{1,3})\b/i.exec(t);
  if (m) return Number(m[1]);
  if (/^(quarts? de finale|quarter-?finals?|cuartos de final)/i.test(t)) return 8;
  if (/^(demi-?finales?|semi-?finals?|semifinales?)/i.test(t)) return 4;
  if (/^(finale?|final)$/i.test(t)) return 2;
  return null;
}

export function parsearCuadroArbol(html: string): CuadroArbol {
  const $ = cheerio.load(html);
  const res: CuadroArbol = { estado: 'sin_cuadro', cruces: [], esperados: 0, excluidos: {}, completo: false };
  const tablas = $('table.tableau');
  tablas.each((_, t) => {
    const tabla = $(t);
    const titulo = tabla.attr('summary') ?? limpio(tabla.prevAll('h3').first().text());
    const n0 = rondaInicial(titulo);
    if (!n0 || (n0 & (n0 - 1)) !== 0) {
      sumar(res.excluidos, 'tabla_sin_ronda');
      return;
    }
    const filas = tabla.find('tr').toArray().map((tr) => $(tr).children('td').toArray().map((td) => ({
      texto: limpio($(td).text()), hbd: ($(td).attr('class') ?? '').split(/\s+/).some((c) => c === 'HBD' || c === 'HGBD'),
    })));
    // Columna de nombre y de nación: las de las filas que empiezan por un número de cabeza de serie.
    let colNombre = -1;
    for (const f of filas) {
      if (f.length >= 3 && /^\d{1,3}$/.test(f[0].texto) && f[1].hbd) {
        colNombre = 1;
        break;
      }
    }
    if (colNombre < 0) {
      sumar(res.excluidos, 'tabla_sin_entradas');
      return;
    }
    const conNacion = filas.some((f) => /^\d{1,3}$/.test(f[0]?.texto ?? '') && /^[A-Z]{3}$/.test(f[2]?.texto ?? ''));
    const base = conNacion ? colNombre + 1 : colNombre;
    const paisDe = new Map<string, string | null>();
    const columnas = new Map<number, Entrada[]>();
    const anadir = (c: number, e: Entrada) => (columnas.get(c) ?? columnas.set(c, []).get(c)!).push(e);
    filas.forEach((f, i) => {
      if (/^\d{1,3}$/.test(f[0]?.texto ?? '') && f[colNombre]?.hbd) {
        const nombre = f[colNombre].texto;
        const pais = conNacion && /^[A-Z]{3}$/.test(f[colNombre + 1]?.texto ?? '') ? f[colNombre + 1].texto : null;
        anadir(0, { fila: i, nombre, pais });
        if (nombre) paisDe.set(normalizeSportName(nombre), pais);
        return;
      }
      f.forEach((c, j) => {
        if (j > base && c.hbd) anadir(j - base, { fila: i, nombre: c.texto, pais: null });
      });
    });
    const rondas = [...columnas.keys()].sort((a, b) => a - b);
    const ultima = rondas[rondas.length - 1];
    for (const r of rondas) {
      if (r === 0) continue;
      const tam = n0 / 2 ** (r - 1);
      if (tam < 2) {
        sumar(res.excluidos, 'columna_de_mas');
        continue;
      }
      const previa = columnas.get(r - 1) ?? [];
      for (const g of columnas.get(r) ?? []) {
        const arriba = [...previa].reverse().find((x) => x.fila < g.fila);
        const abajo = previa.find((x) => x.fila > g.fila);
        if (!arriba || !abajo) {
          sumar(res.excluidos, 'sin_rivales');
          continue;
        }
        if (!arriba.nombre || !abajo.nombre) continue;
        res.esperados += 1;
        if (!g.nombre) {
          sumar(res.excluidos, 'sin_ganador');
          continue;
        }
        const texto = filas[g.fila + 1]?.[r + base]?.texto ?? '';
        const m = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(texto);
        if (!m) {
          sumar(res.excluidos, 'sin_marcador');
          continue;
        }
        const ng = normalizeSportName(g.nombre);
        const ganaArriba = ng === normalizeSportName(arriba.nombre);
        const ganaAbajo = ng === normalizeSportName(abajo.nombre);
        const [pg, pp] = [Number(m[1]), Number(m[2])];
        if (ganaArriba === ganaAbajo || pg < pp) {
          sumar(res.excluidos, 'incoherente');
          continue;
        }
        const pais = (x: Entrada) => x.pais ?? paisDe.get(normalizeSportName(x.nombre)) ?? null;
        res.cruces.push({
          ronda: `A${tam}`,
          nombreA: arriba.nombre, paisA: pais(arriba), puntosA: ganaArriba ? pg : pp,
          nombreB: abajo.nombre, paisB: pais(abajo), puntosB: ganaArriba ? pp : pg,
        });
      }
    }
    if (n0 / 2 ** (ultima - 1) === 2 && (columnas.get(ultima) ?? []).length === 1) res.completo = true;
    res.estado = 'leido';
  });
  return res;
}
