import * as cheerio from 'cheerio';
import { fixDoubleEncodedUtf8 } from '../fetcher';

/**
 * Asaltos de poule de Engarde (`/competition/{org}/{evt}/{compe}/poulesN.htm`).
 *
 * Layout comprobado el 2026-10-05 (Cto. de España de Veteranos 2019 y otras
 * pruebas de 2018-2019): una `table.poule` por poule, cabecera «Poule No N» y
 * columnas `V/M`, `TD-TR` y `TD` al final. Cada fila es un tirador: nombre,
 * club o nación, una celda vacía y una celda por rival en el orden de las filas
 * (la diagonal en blanco). Una derrota publica los tocados del tirador; una
 * victoria se publica como `<div class="victory-cell">V</div>`, casi siempre SIN
 * los tocados del ganador (a veces `V4`).
 *
 * Los tocados de una victoria sin número se deducen de la columna TD (tocados
 * dados) sin suponer nada que la página no fije:
 *  - `objetivo` = 5, o la media de tocados por victoria más alta de la poule si
 *    pasa de 5 (poules a 10). Ninguna victoria supera el objetivo, así que en una
 *    fila cuya media es el objetivo todas valen el objetivo.
 *  - Con una sola victoria sin número, vale lo que falta para llegar a TD.
 *  - En cualquier otro caso la fila es ambigua y sus victorias no generan asalto.
 * Después se comprueba la columna de tocados recibidos (TD - (TD-TR)); una
 * fila que no cuadra invalida sus asaltos.
 */

export type AsaltoPoule = {
  /** `P3` en la primera vuelta, `V2P3` en la segunda. */
  ronda: string;
  a: { nombre: string; club: string | null; tocados: number };
  b: { nombre: string; club: string | null; tocados: number };
  /** Ganador cuando el marcador está igualado (victoria por prioridad). */
  ganador: 'A' | 'B' | null;
};

export type MotivoExclusionPoule = 'ambiguo' | 'incoherente' | 'sinMarcador' | 'tdNoCuadra';

export type PoulesEngarde = {
  estado: 'leido' | 'sin_poules' | 'layout_no_reconocido';
  poules: number;
  tiradores: { nombre: string; club: string | null }[];
  asaltos: AsaltoPoule[];
  /** Asaltos que la geometría de las poules implica (n·(n-1)/2 por poule). */
  esperados: number;
  excluidos: Record<MotivoExclusionPoule, number>;
};

type Celda = { victoria: boolean; tocados: number | null; vacia: boolean };

function limpio(t: string): string {
  return fixDoubleEncodedUtf8(t).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function celdaPoule(texto: string): Celda | null {
  if (texto === '') return { victoria: false, tocados: null, vacia: true };
  const v = texto.match(/^V\s*(\d{1,2})?$/i);
  if (v) return { victoria: true, tocados: v[1] !== undefined ? Number(v[1]) : null, vacia: false };
  if (/^\d{1,2}$/.test(texto)) return { victoria: false, tocados: Number(texto), vacia: false };
  return null;
}

function entero(t: string): number | null {
  return /^[-+]?\d{1,3}$/.test(t) ? Number(t) : null;
}

/** Prefijo de ronda por número de página: `poules1.htm` → `P`, `poules2.htm` → `V2P`. */
export function prefijoRondaPoules(pagina: number): string {
  return pagina <= 1 ? 'P' : `V${pagina}P`;
}

export function parsearPoulesEngarde(html: string, opciones: { pagina?: number } = {}): PoulesEngarde {
  const prefijo = prefijoRondaPoules(opciones.pagina ?? 1);
  const $ = cheerio.load(html);
  const tablas = $('table.poule');
  const res: PoulesEngarde = {
    estado: 'leido',
    poules: 0,
    tiradores: [],
    asaltos: [],
    esperados: 0,
    excluidos: { ambiguo: 0, incoherente: 0, sinMarcador: 0, tdNoCuadra: 0 },
  };
  if (tablas.length === 0) return { ...res, estado: 'sin_poules' };

  let reconocidas = 0;
  tablas.each((k, tabla) => {
    const t = $(tabla);
    const cabecera = t.find('tr').first().children('th').map((_, th) => limpio($(th).text())).get();
    // La cabecera puede seguir con hora y pista («Poule No 1 - 09:10 - Pista No 9»).
    const numeroPoule = /poule\s*(?:no|n°|nº|n\.)?\s*(\d{1,3})/i;
    const numero =
      (cabecera[0] ?? '').match(numeroPoule)?.[1] ?? (t.attr('summary') ?? '').match(numeroPoule)?.[1] ?? String(k + 1);
    // Las tres últimas columnas son V/M, índice y tocados dados; sus títulos cambian con
    // el idioma («TD-TR»/«Índex»/«Indicator», «TD»/«HS»), su posición no.
    const ultima = cabecera.length - 1;
    const columnasFinales = ultima >= 3 && /^v\s*\/\s*m$/i.test(cabecera[ultima - 2]) && cabecera[ultima - 1] !== '' && cabecera[ultima] !== '';
    const iTd = columnasFinales ? ultima : -1;
    const iInd = columnasFinales ? ultima - 1 : -1;
    const filas = t
      .find('tr')
      .slice(1)
      .map((_, tr) => [$(tr).children('td').map((__, td) => limpio($(td).text())).get()])
      .get() as string[][];
    const n = filas.length;
    if (n < 2 || iTd < 0 || iInd < 0 || filas.some((f) => f.length !== cabecera.length || f.length < 3 + n + 3)) {
      return;
    }
    reconocidas += 1;
    res.poules += 1;
    res.esperados += (n * (n - 1)) / 2;
    const ronda = `${prefijo}${Number(numero)}`;

    const tiradores = filas.map((f) => ({ nombre: f[0], club: f[1] || null }));
    for (const x of tiradores) res.tiradores.push(x);
    const celdas: (Celda | null)[][] = filas.map((f) => Array.from({ length: n }, (_, j) => celdaPoule(f[3 + j])));
    const td = filas.map((f) => entero(f[iTd]));
    const ind = filas.map((f) => entero(f[iInd]));

    // Tocados de cada victoria sin número, por fila.
    const medias: (number | null)[] = filas.map((_, i) => {
      if (td[i] === null) return null;
      let conocidos = 0;
      let sinNumero = 0;
      for (let j = 0; j < n; j += 1) {
        const c = celdas[i][j];
        if (j === i || !c || c.vacia) continue;
        if (c.victoria && c.tocados === null) sinNumero += 1;
        else conocidos += c.tocados ?? 0;
      }
      return sinNumero === 0 ? null : (td[i]! - conocidos) / sinNumero;
    });
    const maxMedia = Math.max(0, ...medias.filter((m): m is number => m !== null));
    const objetivo = maxMedia > 5 && Number.isInteger(maxMedia) ? maxMedia : 5;
    const tocadosVictoria: (number | null)[] = filas.map((_, i) => {
      const m = medias[i];
      if (m === null) return null;
      const sinNumero = celdas[i].filter((c, j) => j !== i && c?.victoria && c.tocados === null).length;
      if (m === objetivo) return objetivo;
      if (sinNumero === 1 && Number.isInteger(m) && m >= 0 && m <= objetivo) return m;
      return null;
    });
    const tocados = (i: number, j: number): number | null => {
      const c = celdas[i][j];
      if (!c || c.vacia) return null;
      if (c.victoria && c.tocados === null) return tocadosVictoria[i];
      return c.tocados;
    };

    // Comprobación de tocados dados y recibidos con los valores deducidos.
    const filaValida = filas.map((_, i) => {
      if (td[i] === null || ind[i] === null) return false;
      let dados = 0;
      let recibidos = 0;
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue;
        const d = tocados(i, j);
        const r = tocados(j, i);
        if (celdas[i][j]?.vacia && celdas[j][i]?.vacia) continue;
        if (d === null || r === null) return null;
        dados += d;
        recibidos += r;
      }
      return dados === td[i] && dados - recibidos === ind[i];
    });

    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const ci = celdas[i][j];
        const cj = celdas[j][i];
        if (!ci || !cj) {
          res.excluidos.sinMarcador += 1;
          continue;
        }
        if (ci.vacia && cj.vacia) {
          // Asalto no disputado (abandono o retirada antes de tirarlo): no se esperaba.
          res.esperados -= 1;
          continue;
        }
        if (ci.vacia || cj.vacia || ci.victoria === cj.victoria) {
          res.excluidos.incoherente += 1;
          continue;
        }
        const si = tocados(i, j);
        const sj = tocados(j, i);
        if (si === null || sj === null) {
          res.excluidos.ambiguo += 1;
          continue;
        }
        if (filaValida[i] === false || filaValida[j] === false) {
          res.excluidos.tdNoCuadra += 1;
          continue;
        }
        const ganaI = ci.victoria;
        if ((ganaI && si < sj) || (!ganaI && sj < si)) {
          res.excluidos.incoherente += 1;
          continue;
        }
        res.asaltos.push({
          ronda,
          a: { nombre: tiradores[i].nombre, club: tiradores[i].club, tocados: si },
          b: { nombre: tiradores[j].nombre, club: tiradores[j].club, tocados: sj },
          ganador: si === sj ? (ganaI ? 'A' : 'B') : null,
        });
      }
    }
  });
  if (reconocidas === 0) return { ...res, estado: 'layout_no_reconocido' };
  return res;
}
