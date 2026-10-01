import { AcumuladorAsaltos, exclusionesVacias } from './asaltos';
import { normalizar, redondear, textoFila, type Fila } from './geometria';
import { resolverParticipante, type Atribucion, type Participante } from './identidad';
import type { PaginaAnalizada } from './paginas';
import type { AsaltoPdf, ExclusionesPdf, Rechazo, Region } from './tipos';

/**
 * Matrices de poule de un PDF de Engarde.
 *
 * Cada fila es un tirador: nombre, club, una celda por rival (la diagonal va
 * vacía) y los totales `V/M`, `ind.`, `TD`, `cl.`. La celda es `V` (victoria),
 * `V4` (victoria con 4 tocados) o los tocados del que perdió. La matriz se
 * lee por orden dentro de la fila, no por posición horizontal, porque
 * PDF.js une celdas contiguas en un solo texto («V4 3»).
 *
 * Un asalto sólo sale si la matriz entera se sostiene sola: cada fila tiene
 * tantas celdas como rivales, `V/M` cuadra con las victorias leídas, los
 * tocados de cada fila suman su `TD` y `ind.` es `TD` menos los tocados
 * recibidos. Una `V` sin número vale lo que resuelvan esos totales (el mismo
 * valor en toda la poule); si no resuelven, la poule queda sin asaltos.
 */

export type LecturaPoules = {
  asaltos: AsaltoPdf[];
  excluidos: ExclusionesPdf;
  rechazos: Rechazo[];
  /** Poules encontradas en el documento. */
  grupos: number;
  /** Cruces que las matrices legibles publican (n·(n−1)/2 por poule). */
  publicado: number;
};

type Celda = { gana: boolean; puntos: number | null };
type FilaMatriz = {
  y: number;
  nombre: string;
  club: string | null;
  celdas: string[];
  vm: number;
  ind: number;
  td: number;
};

const RE_POULE = /^POULE\s*N[^\d\s]?\s*(\d+)/;
const RE_VUELTA = /(?:VUELTA|VOLTA)\s*N?[^\d\s]?\s*(\d+)/;
const RE_CELDAS = /^(V\d*|\d+|X)(\s+(V\d*|\d+|X))*$/;
const RE_DECIMAL = /^\d\.\d{2,3}$/;
const RE_ENTERO = /^[+-]?\d+$/;

const regionBloque = (pagina: number, desde: number, hasta: number): Region => ({
  pagina,
  yMax: redondear(desde + 8),
  yMin: redondear(hasta - 4),
});

function leerFila(f: Fila): FilaMatriz | string {
  const iDec = f.items.findIndex((i) => RE_DECIMAL.test(i.s));
  if (iDec < 1) return 'Fila de poule sin el total V/M';
  const despues = f.items.slice(iDec + 1).map((i) => i.s);
  if (despues.length !== 3 || !despues.every((s) => RE_ENTERO.test(s))) return 'Totales ind./TD/cl. ilegibles';

  const antes = f.items.slice(0, iDec);
  let k = 0;
  const texto: string[] = [];
  while (k < antes.length && !RE_CELDAS.test(antes[k].s)) {
    texto.push(antes[k].s);
    k += 1;
  }
  if (texto.length === 0 || texto.length > 2) return 'Nombre y club de la fila no reconocibles';
  const celdas: string[] = [];
  for (const it of antes.slice(k)) {
    if (!RE_CELDAS.test(it.s)) return 'Celda de matriz ilegible';
    celdas.push(...it.s.split(' '));
  }
  return {
    y: f.y,
    nombre: texto[0],
    club: texto[1] ?? null,
    celdas,
    vm: Number(f.items[iDec].s),
    ind: Number(despues[0]),
    td: Number(despues[1]),
  };
}

function aCelda(t: string): Celda {
  if (t.startsWith('V')) return { gana: true, puntos: t.length > 1 ? Number(t.slice(1)) : null };
  return { gana: false, puntos: Number(t) };
}

type Matriz = { celdas: Celda[][]; k: number | null };

/** Valida la matriz y resuelve el valor de la `V` sin número. Devuelve el motivo si no se sostiene. */
function validarMatriz(filas: FilaMatriz[]): Matriz | string {
  const n = filas.length;
  const crudas: string[][] = [];
  for (let i = 0; i < n; i += 1) {
    let t = filas[i].celdas;
    if (t.length === n && t[i] === 'X') t = t.filter((_, j) => j !== i);
    if (t.length !== n - 1) return 'Matriz incompleta o dividida entre páginas';
    crudas.push(t);
  }
  const celdas: Celda[][] = crudas.map((t, i) => {
    const fila: Celda[] = [];
    let c = 0;
    for (let j = 0; j < n; j += 1) fila.push(j === i ? { gana: false, puntos: null } : aCelda(t[c++]));
    return fila;
  });

  for (let i = 0; i < n; i += 1) {
    const victorias = celdas[i].filter((c, j) => j !== i && c.gana).length;
    if (Math.abs(victorias / (n - 1) - filas[i].vm) > 0.0015) return 'El total V/M no coincide con las victorias de la fila';
    for (let j = i + 1; j < n; j += 1) {
      if (celdas[i][j].gana && celdas[j][i].gana) return 'Dos ganadores en el mismo cruce';
    }
  }

  let k: number | null = null;
  for (let i = 0; i < n; i += 1) {
    const fila = celdas[i].filter((_, j) => j !== i);
    const simples = fila.filter((c) => c.gana && c.puntos === null).length;
    if (simples === 0) continue;
    const conocidos = fila.reduce((s, c) => s + (c.puntos ?? 0), 0);
    const ki = (filas[i].td - conocidos) / simples;
    if (!Number.isInteger(ki) || ki < 1) return 'Los tocados de la fila no resuelven el valor de la victoria';
    if (k !== null && ki !== k) return 'El valor de la victoria difiere entre filas de la poule';
    k = ki;
  }

  const valor = (c: Celda): number => c.puntos ?? k ?? 0;
  for (let i = 0; i < n; i += 1) {
    let dados = 0;
    let recibidos = 0;
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      dados += valor(celdas[i][j]);
      recibidos += valor(celdas[j][i]);
    }
    if (dados !== filas[i].td) return 'Los tocados dados no suman el total TD de la fila';
    if (dados - recibidos !== filas[i].ind) return 'El índice no coincide con los tocados dados y recibidos';
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = celdas[i][j];
      const b = celdas[j][i];
      if (a.gana !== b.gana && valor(a.gana ? a : b) <= valor(a.gana ? b : a)) return 'El ganador no tiene más tocados que el perdedor';
    }
  }
  return { celdas, k };
}

export function leerPoules(paginas: readonly PaginaAnalizada[], registro: readonly Participante[]): LecturaPoules {
  const excluidos = exclusionesVacias();
  const rechazos: Rechazo[] = [];
  const acumulador = new AcumuladorAsaltos(excluidos);
  let grupos = 0;
  let publicado = 0;
  let vuelta: number | null = null;
  let tituloVuelta = '';

  for (const pg of paginas) {
    const indices: number[] = [];
    for (let i = 0; i < pg.filas.length; i += 1) {
      const f = pg.filas[i];
      const t = normalizar(textoFila(f));
      if (f.items[0].x >= 45) continue;
      if (RE_POULE.test(t)) indices.push(i);
      else if (/^POULES?, /.test(t)) {
        const v = t.match(RE_VUELTA);
        vuelta = v ? Number(v[1]) : null;
        tituloVuelta = textoFila(f);
      }
    }

    for (let b = 0; b < indices.length; b += 1) {
      const inicio = indices[b];
      const fin = b + 1 < indices.length ? indices[b + 1] : pg.filas.length;
      const cabeza = pg.filas[inicio];
      const numero = Number(normalizar(textoFila(cabeza)).match(RE_POULE)?.[1]);
      const cuerpo = pg.filas.slice(inicio + 1, fin);
      const ultima = cuerpo.length > 0 ? cuerpo[cuerpo.length - 1].y : cabeza.y;
      const reg = regionBloque(pg.numero, cabeza.y, ultima);
      grupos += 1;

      const rechazar = (motivo: string) => rechazos.push({ seccion: 'poules', region: reg, motivo });

      if (vuelta === null) {
        rechazar('La vuelta de poules no está declarada en el documento');
        continue;
      }
      const iCab = cuerpo.findIndex((f) => f.items.some((i) => i.s.trim() === 'V/M'));
      if (iCab < 0) {
        rechazar('Poule sin fila de cabecera V/M');
        continue;
      }
      const leidas = cuerpo.slice(iCab + 1).map(leerFila);
      const mala = leidas.find((r): r is string => typeof r === 'string');
      if (mala !== undefined || leidas.length < 2) {
        rechazar(mala ?? 'Poule con menos de dos tiradores');
        continue;
      }
      const filas = leidas as FilaMatriz[];
      publicado += (filas.length * (filas.length - 1)) / 2;

      const matriz = validarMatriz(filas);
      if (typeof matriz === 'string') {
        rechazar(matriz);
        continue;
      }

      const atribuciones: Atribucion[] = filas.map((f) => resolverParticipante(registro, f.nombre, f.club));
      const usadas = new Map<string, number>();
      for (const a of atribuciones) if (a.ok) usadas.set(a.ref, (usadas.get(a.ref) ?? 0) + 1);
      const validas = atribuciones.map((a) => (a.ok && usadas.get(a.ref) === 1 ? a : null));

      const ronda = vuelta === 1 ? `P${numero}` : `V${vuelta}P${numero}`;
      const rondaOriginal = `${tituloVuelta} / ${textoFila(cabeza)}`;
      const n = filas.length;
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          const a = matriz.celdas[i][j];
          const c = matriz.celdas[j][i];
          if (a.gana === c.gana) {
            excluidos.sinGanador += 1;
            continue;
          }
          const vi = validas[i];
          const vj = validas[j];
          if (!vi || !vj) {
            excluidos.identidadNoConfirmada += 1;
            continue;
          }
          const valor = (x: Celda): number => x.puntos ?? matriz.k ?? 0;
          const ganaI = a.gana;
          const origen = (ganaI ? a : c).puntos === null ? 'derivado_de_totales' : 'explicito';
          acumulador.agregar({
            fase: 'POULE',
            ronda,
            rondaOriginal,
            marcador: origen,
            region: reg,
            ganador: { ref: ganaI ? vi.ref : vj.ref, nombre: ganaI ? vi.nombre : vj.nombre, puntos: valor(ganaI ? a : c) },
            perdedor: { ref: ganaI ? vj.ref : vi.ref, nombre: ganaI ? vj.nombre : vi.nombre, puntos: valor(ganaI ? c : a) },
          });
        }
      }
    }
  }

  return { asaltos: acumulador.asaltos, excluidos, rechazos, grupos, publicado };
}
