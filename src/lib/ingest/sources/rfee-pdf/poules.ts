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
 * recibidos.
 *
 * Una `V` sin número es una incógnita por celda, no un valor común a la
 * poule: unos totales compatibles con un valor no demuestran que sea el
 * único. Sólo se fija cuando la fila (`TD` menos lo conocido) o la columna
 * (`TD − ind.` menos lo conocido) deja exactamente una incógnita; lo que
 * queda sin determinar no recibe tanteo y se rechaza como parcial.
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

type Celda = { gana: boolean; puntos: number | null; derivada: boolean };
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
  if (t.startsWith('V')) return { gana: true, puntos: t.length > 1 ? Number(t.slice(1)) : null, derivada: false };
  return { gana: false, puntos: Number(t), derivada: false };
}

type Matriz = { celdas: Celda[][]; sinResolver: number };

/** Valida la matriz y fija cada `V` sin número que los totales publicados determinan. Devuelve el motivo si no se sostiene. */
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
    for (let j = 0; j < n; j += 1) fila.push(j === i ? { gana: false, puntos: null, derivada: false } : aCelda(t[c++]));
    return fila;
  });
  if (celdas.some((fila) => fila.some((c) => c.puntos !== null && !Number.isFinite(c.puntos)))) return 'Celda de matriz ilegible';

  for (let i = 0; i < n; i += 1) {
    const victorias = celdas[i].filter((c, j) => j !== i && c.gana).length;
    if (Math.abs(victorias / (n - 1) - filas[i].vm) > 0.0015) return 'El total V/M no coincide con las victorias de la fila';
    for (let j = i + 1; j < n; j += 1) {
      if (celdas[i][j].gana && celdas[j][i].gana) return 'Dos ganadores en el mismo cruce';
    }
  }

  const indices = Array.from({ length: n }, (_, i) => i);
  const incognita = (i: number, j: number): boolean => i !== j && celdas[i][j].gana && celdas[i][j].puntos === null;
  // El ganador necesita más tocados que el perdedor, cuya celda es siempre un número.
  const minimo = (i: number, j: number): number => (celdas[j][i].puntos ?? 0) + 1;
  const conocido = (celda: Celda): number => celda.puntos ?? 0;

  const fijar = (i: number, j: number, valor: number): string | null => {
    if (!Number.isInteger(valor) || valor < minimo(i, j)) return 'Los totales publicados dan a una victoria un tanteo imposible';
    celdas[i][j] = { gana: true, puntos: valor, derivada: true };
    return null;
  };

  // Eliminación conservadora: una fila o columna con una única incógnita la determina; nada más.
  let avanza = true;
  while (avanza) {
    avanza = false;
    for (const i of indices) {
      const libres = indices.filter((j) => incognita(i, j));
      if (libres.length !== 1) continue;
      const dados = indices.reduce((s, j) => (j === i ? s : s + conocido(celdas[i][j])), 0);
      const error = fijar(i, libres[0], filas[i].td - dados);
      if (error) return error;
      avanza = true;
    }
    for (const j of indices) {
      const libres = indices.filter((i) => incognita(i, j));
      if (libres.length !== 1) continue;
      const recibidos = indices.reduce((s, i) => (i === j ? s : s + conocido(celdas[i][j])), 0);
      const error = fijar(libres[0], j, filas[j].td - filas[j].ind - recibidos);
      if (error) return error;
      avanza = true;
    }
  }

  let sinResolver = 0;
  for (const i of indices) {
    const enFila = indices.filter((j) => incognita(i, j));
    const enColumna = indices.filter((j) => incognita(j, i));
    sinResolver += enFila.length;
    const dados = indices.reduce((s, j) => (j === i ? s : s + conocido(celdas[i][j])), 0);
    const recibidos = indices.reduce((s, j) => (j === i ? s : s + conocido(celdas[j][i])), 0);
    const restoDados = filas[i].td - dados;
    const restoRecibidos = filas[i].td - filas[i].ind - recibidos;
    if (enFila.length === 0 ? restoDados !== 0 : restoDados < enFila.reduce((s, j) => s + minimo(i, j), 0)) {
      return 'Los tocados dados no suman el total TD de la fila';
    }
    if (enColumna.length === 0 ? restoRecibidos !== 0 : restoRecibidos < enColumna.reduce((s, j) => s + minimo(j, i), 0)) {
      return 'El índice no coincide con los tocados dados y recibidos';
    }
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = celdas[i][j];
      const b = celdas[j][i];
      if (a.gana === b.gana) continue;
      const ganadora = a.gana ? a : b;
      const perdedora = a.gana ? b : a;
      if (ganadora.puntos !== null && ganadora.puntos <= (perdedora.puntos ?? 0)) return 'El ganador no tiene más tocados que el perdedor';
    }
  }
  return { celdas, sinResolver };
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

    if (indices.length === 0) {
      rechazos.push({
        seccion: 'poules',
        region: { pagina: pg.numero, yMax: pg.alto, yMin: 0 },
        motivo: 'Sección de poules sin ninguna poule reconocible: la página no se lee',
      });
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
      let sinGanador = 0;
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          const a = matriz.celdas[i][j];
          const c = matriz.celdas[j][i];
          if (a.gana === c.gana) {
            excluidos.sinGanador += 1;
            sinGanador += 1;
            continue;
          }
          const ganadora = a.gana ? a : c;
          const perdedora = a.gana ? c : a;
          if (ganadora.puntos === null || perdedora.puntos === null) {
            excluidos.sinMarcador += 1;
            continue;
          }
          const vi = validas[i];
          const vj = validas[j];
          if (!vi || !vj) {
            excluidos.identidadNoConfirmada += 1;
            continue;
          }
          const ganaI = a.gana;
          acumulador.agregar({
            fase: 'POULE',
            ronda,
            rondaOriginal,
            marcador: ganadora.derivada ? 'derivado_de_totales' : 'explicito',
            region: reg,
            ganador: { ref: ganaI ? vi.ref : vj.ref, nombre: ganaI ? vi.nombre : vj.nombre, puntos: ganadora.puntos },
            perdedor: { ref: ganaI ? vj.ref : vi.ref, nombre: ganaI ? vj.nombre : vi.nombre, puntos: perdedora.puntos },
          });
        }
      }
      if (matriz.sinResolver > 0) {
        rechazar(`${matriz.sinResolver} victorias sin tanteo que los totales publicados no determinan: no se les atribuye ninguno`);
      }
      if (sinGanador > 0) rechazar(`${sinGanador} cruces sin ningún ganador marcado: no son un duelo con resultado`);
    }
  }

  return { asaltos: acumulador.asaltos, excluidos, rechazos, grupos, publicado };
}
