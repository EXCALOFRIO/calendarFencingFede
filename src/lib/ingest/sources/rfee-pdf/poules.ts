import { AcumuladorAsaltos, exclusionesVacias } from './asaltos';
import { normalizar, redondear, textoFila, type Fila } from './geometria';
import { candidatosParticipante, resolverParticipante, type Atribucion, type Participante } from './identidad';
import { nombreEnIntermedia, type FilaIntermedia } from './intermedia';
import { RE_POULE_N, type PaginaAnalizada } from './paginas';
import type { AsaltoPdf, ExclusionesPdf, OrigenMarcador, Rechazo, Region } from './tipos';

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
 * único. Se fija cuando la fila (`TD` menos lo conocido) o la columna
 * (`TD − ind.` menos lo conocido) la obliga: deja una sola incógnita, o un
 * resto que sólo admite el mínimo de cada una (un tocado más que el rival).
 *
 * Engarde escribe `V` a secas cuando el ganador llega al tope de tocados.
 * Si todas las `V` que la aritmética obliga en una vuelta valen lo mismo y
 * ningún tanteo publicado de esa vuelta lo supera, ese valor es el tope de
 * la vuelta: ninguna victoria puede pasar de él, así que un resto igual a
 * incógnitas × tope obliga a que todas lo valgan. Esas celdas salen como
 * `derivado_de_limite`; si el tope contradice algún total de la poule, no se
 * usa en ella. Lo que sigue sin determinar no recibe tanteo y queda parcial.
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

export type Celda = { gana: boolean; puntos: number | null; origen: OrigenMarcador };
export type FilaMatriz = {
  y: number;
  nombre: string;
  club: string | null;
  celdas: string[];
  vm: number;
  ind: number;
  td: number;
};

// «Vuelta No 1», «Volta núm. 1», «Round No 1».
const RE_VUELTA = /(?:VUELTA|VOLTA|ROUND)\s*(?:N\.?[^\d\s]{0,2}\.?)?\s*(\d+)/;
const RE_CELDAS = /^(V\d*|\d+|X)(\s+(V\d*|\d+|X))*$/;
// Engarde publica V/M con punto o con coma decimal según el idioma del equipo («0.667», «0,667»).
const RE_DECIMAL = /^\d[.,]\d{2,3}$/;
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
    vm: Number(f.items[iDec].s.replace(',', '.')),
    ind: Number(despues[0]),
    td: Number(despues[1]),
  };
}

function aCelda(t: string): Celda {
  if (t.startsWith('V')) return { gana: true, puntos: t.length > 1 ? Number(t.slice(1)) : null, origen: 'explicito' };
  return { gana: false, puntos: Number(t), origen: 'explicito' };
}

export type Matriz = { celdas: Celda[][]; sinResolver: number };

/**
 * Valida la matriz y fija cada `V` sin número que los totales publicados
 * obligan. `limite` es el tope de tocados demostrado para la vuelta; sólo se
 * usa para lo que la aritmética sola no determina. Devuelve el motivo si no
 * se sostiene.
 */
function validarMatriz(filas: FilaMatriz[], limite: number | null = null): Matriz | string {
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
    for (let j = 0; j < n; j += 1) fila.push(j === i ? { gana: false, puntos: null, origen: 'explicito' } : aCelda(t[c++]));
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

  const fijar = (i: number, j: number, valor: number, origen: OrigenMarcador): string | null => {
    if (!Number.isInteger(valor) || valor < minimo(i, j) || (limite !== null && valor > limite)) {
      return 'Los totales publicados dan a una victoria un tanteo imposible';
    }
    celdas[i][j] = { gana: true, puntos: valor, origen };
    return null;
  };

  // Incógnitas de una fila o columna y lo que les falta para su total: o el total las obliga, o no se tocan.
  const resolverGrupo = (libres: [number, number][], resto: number, origen: OrigenMarcador): string | boolean => {
    if (libres.length === 0) return false;
    const minimos = libres.map(([i, j]) => minimo(i, j));
    const valores =
      libres.length === 1
        ? [resto]
        : resto === minimos.reduce((s, v) => s + v, 0)
          ? minimos
          : origen === 'derivado_de_limite' && limite !== null && resto === libres.length * limite
            ? libres.map(() => limite)
            : null;
    if (!valores) return false;
    for (let k = 0; k < libres.length; k += 1) {
      const error = fijar(libres[k][0], libres[k][1], valores[k], origen);
      if (error) return error;
    }
    return true;
  };

  const eliminar = (origen: OrigenMarcador): string | null => {
    let avanza = true;
    while (avanza) {
      avanza = false;
      for (const i of indices) {
        const libres = indices.filter((j) => incognita(i, j)).map((j): [number, number] => [i, j]);
        const dados = indices.reduce((s, j) => (j === i ? s : s + conocido(celdas[i][j])), 0);
        const r = resolverGrupo(libres, filas[i].td - dados, origen);
        if (typeof r === 'string') return r;
        avanza ||= r;
      }
      for (const j of indices) {
        const libres = indices.filter((i) => incognita(i, j)).map((i): [number, number] => [i, j]);
        const recibidos = indices.reduce((s, i) => (i === j ? s : s + conocido(celdas[i][j])), 0);
        const r = resolverGrupo(libres, filas[j].td - filas[j].ind - recibidos, origen);
        if (typeof r === 'string') return r;
        avanza ||= r;
      }
    }
    return null;
  };

  const error = eliminar('derivado_de_totales') ?? (limite !== null ? eliminar('derivado_de_limite') : null);
  if (error) return error;

  const tope = (incognitas: number): number => (limite === null ? Number.POSITIVE_INFINITY : incognitas * limite);
  let sinResolver = 0;
  for (const i of indices) {
    const enFila = indices.filter((j) => incognita(i, j));
    const enColumna = indices.filter((j) => incognita(j, i));
    sinResolver += enFila.length;
    const dados = indices.reduce((s, j) => (j === i ? s : s + conocido(celdas[i][j])), 0);
    const recibidos = indices.reduce((s, j) => (j === i ? s : s + conocido(celdas[j][i])), 0);
    const restoDados = filas[i].td - dados;
    const restoRecibidos = filas[i].td - filas[i].ind - recibidos;
    if (
      enFila.length === 0
        ? restoDados !== 0
        : restoDados < enFila.reduce((s, j) => s + minimo(i, j), 0) || restoDados > tope(enFila.length)
    ) {
      return 'Los tocados dados no suman el total TD de la fila';
    }
    if (
      enColumna.length === 0
        ? restoRecibidos !== 0
        : restoRecibidos < enColumna.reduce((s, j) => s + minimo(j, i), 0) || restoRecibidos > tope(enColumna.length)
    ) {
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

type Evidencia = { obligados: Set<number>; maximoPublicado: number };

/** Tope de la vuelta: el único valor que la aritmética da a sus `V` sin número, si ningún tanteo publicado lo supera. */
function limiteDeVuelta(e: Evidencia | undefined): number | null {
  if (!e || e.obligados.size !== 1) return null;
  const [valor] = e.obligados;
  return valor >= e.maximoPublicado ? valor : null;
}

export type PouleLeida = {
  reg: Region;
  vuelta: number;
  ronda: string;
  rondaOriginal: string;
  filas: FilaMatriz[];
  matriz: Matriz;
};

export type PouleRechazada = Rechazo & { filas?: FilaMatriz[] };

export type MatricesPoules = {
  /** En orden de documento: cada poule leída o el rechazo de su región (con sus filas si se llegaron a leer). */
  lecturas: (PouleLeida | PouleRechazada)[];
  grupos: number;
  publicado: number;
};

/**
 * Matrices de poule validadas contra sus propios totales, sin atribuir todavía los
 * tiradores a la clasificación. Con el tope de la vuelta ya aplicado donde no contradice.
 */
export function leerMatricesPoules(paginas: readonly PaginaAnalizada[]): MatricesPoules {
  // En orden de página: el tope de una vuelta se decide con todas sus poules antes de emitir ninguna.
  const lecturas: (PouleLeida | PouleRechazada)[] = [];
  const evidencia = new Map<number, Evidencia>();
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
      if (RE_POULE_N.test(t)) indices.push(i);
      else if (/^POULES?, /.test(t)) {
        const v = t.match(RE_VUELTA);
        vuelta = v ? Number(v[1]) : null;
        tituloVuelta = textoFila(f);
      }
    }

    if (indices.length === 0) {
      lecturas.push({
        seccion: 'poules',
        region: { pagina: pg.numero, yMax: pg.alto, yMin: 0 },
        motivo: 'Sección de poules sin ninguna poule reconocible: la página no se lee',
      });
    }

    for (let b = 0; b < indices.length; b += 1) {
      const inicio = indices[b];
      const fin = b + 1 < indices.length ? indices[b + 1] : pg.filas.length;
      const cabeza = pg.filas[inicio];
      const numero = Number(normalizar(textoFila(cabeza)).match(RE_POULE_N)?.[1]);
      const cuerpo = pg.filas.slice(inicio + 1, fin);
      const ultima = cuerpo.length > 0 ? cuerpo[cuerpo.length - 1].y : cabeza.y;
      const reg = regionBloque(pg.numero, cabeza.y, ultima);
      grupos += 1;

      const rechazar = (motivo: string) => lecturas.push({ seccion: 'poules', region: reg, motivo });

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
        lecturas.push({ seccion: 'poules', region: reg, motivo: matriz, filas });
        continue;
      }

      const e = evidencia.get(vuelta) ?? { obligados: new Set<number>(), maximoPublicado: 0 };
      for (const c of matriz.celdas.flat()) {
        if (c.puntos === null) continue;
        if (c.origen === 'derivado_de_totales') e.obligados.add(c.puntos);
        else e.maximoPublicado = Math.max(e.maximoPublicado, c.puntos);
      }
      evidencia.set(vuelta, e);
      lecturas.push({
        reg,
        vuelta,
        ronda: vuelta === 1 ? `P${numero}` : `V${vuelta}P${numero}`,
        rondaOriginal: `${tituloVuelta} / ${textoFila(cabeza)}`,
        filas,
        matriz,
      });
    }
  }

  for (const lectura of lecturas) {
    if (!('matriz' in lectura) || lectura.matriz.sinResolver === 0) continue;
    const limite = limiteDeVuelta(evidencia.get(lectura.vuelta));
    if (limite === null) continue;
    // Si el tope contradice algún total de esta poule, se queda la lectura aritmética.
    const conLimite = validarMatriz(lectura.filas, limite);
    if (typeof conLimite !== 'string') lectura.matriz = conLimite;
  }
  return { lecturas, grupos, publicado };
}

/**
 * Hermanos con el mismo nombre truncado y el mismo club: sus filas de poule encajan con las
 * dos filas de la clasificación final y quedarían sin atribuir. Lo resuelve la clasificación
 * después de poules, que repite V/M, índice y TD de cada fila: si esos totales señalan una
 * sola fila intermedia, y ésta es de un eliminado tras las poules, su puesto es el final y
 * señala a uno solo de los candidatos. El que queda, dentro de la misma vuelta, es del otro.
 */
export function desempatarHomonimos(
  filas: readonly (readonly { nombre: string; club: string | null; vm: number; ind: number; td: number; vuelta: number }[])[],
  atribuciones: Atribucion[][],
  registro: readonly Participante[],
  intermedia: readonly FilaIntermedia[],
): number {
  type Duda = { p: number; i: number; vuelta: number; candidatos: Participante[] };
  const dudas: Duda[] = [];
  for (const [p, fs] of filas.entries()) {
    for (const [i, f] of fs.entries()) {
      const a = atribuciones[p][i];
      if (a.ok || a.motivo !== 'ambiguo') continue;
      dudas.push({ p, i, vuelta: f.vuelta, candidatos: candidatosParticipante(registro, f.nombre, f.club) });
    }
  }
  if (dudas.length === 0) return 0;
  let resueltas = 0;
  const asignar = (d: Duda, x: Participante) => {
    atribuciones[d.p][d.i] = { ok: true, ref: x.ref, nombre: x.nombre };
    resueltas += 1;
  };
  for (const d of dudas) {
    const f = filas[d.p][d.i];
    const enIntermedia = intermedia.filter((x) => Math.abs(x.vm - f.vm) <= 0.0015 && x.ind === f.ind && x.td === f.td && nombreEnIntermedia(f.nombre, x));
    if (enIntermedia.length !== 1 || enIntermedia[0].eliminado !== true) continue;
    const porPuesto = d.candidatos.filter((c) => c.posicion === enIntermedia[0].posicion);
    if (porPuesto.length === 1) asignar(d, porPuesto[0]);
  }
  // Por exclusión: mismas candidatas, misma vuelta, una sola fila y una sola candidata libres.
  const grupos = new Map<string, Duda[]>();
  for (const d of dudas) {
    const k = `${d.vuelta}|${d.candidatos.map((c) => c.ref).sort().join(',')}`;
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(d);
  }
  for (const g of grupos.values()) {
    const usadas = new Set(g.flatMap((d) => { const a = atribuciones[d.p][d.i]; return a.ok ? [a.ref] : []; }));
    const libres = g.filter((d) => !atribuciones[d.p][d.i].ok);
    const candidatas = g[0].candidatos.filter((c) => !usadas.has(c.ref));
    if (libres.length === 1 && candidatas.length === 1 && g.length === g[0].candidatos.length) asignar(libres[0], candidatas[0]);
  }
  return resueltas;
}

export function leerPoules(
  paginas: readonly PaginaAnalizada[],
  registro: readonly Participante[],
  intermedia: readonly FilaIntermedia[] = [],
): LecturaPoules {
  const excluidos = exclusionesVacias();
  const rechazos: Rechazo[] = [];
  const acumulador = new AcumuladorAsaltos(excluidos);
  const { lecturas, grupos, publicado } = leerMatricesPoules(paginas);
  const leidas = lecturas.filter((l): l is PouleLeida => 'matriz' in l);
  const atribucionesDe = leidas.map((l) => l.filas.map((f) => resolverParticipante(registro, f.nombre, f.club)));
  desempatarHomonimos(leidas.map((l) => l.filas.map((f) => ({ ...f, vuelta: l.vuelta }))), atribucionesDe, registro, intermedia);
  const atribucionDe = new Map(leidas.map((l, k) => [l, atribucionesDe[k]]));

  for (const lectura of lecturas) {
    if (!('matriz' in lectura)) {
      rechazos.push({ seccion: lectura.seccion, region: lectura.region, motivo: lectura.motivo });
      continue;
    }
    const { reg, ronda, rondaOriginal, filas, matriz } = lectura;
    const rechazar = (motivo: string) => rechazos.push({ seccion: 'poules', region: reg, motivo });

    const atribuciones: Atribucion[] = atribucionDe.get(lectura)!;
    const usadas = new Map<string, number>();
    for (const a of atribuciones) if (a.ok) usadas.set(a.ref, (usadas.get(a.ref) ?? 0) + 1);
    const validas = atribuciones.map((a) => (a.ok && usadas.get(a.ref) === 1 ? a : null));

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
          marcador: ganadora.origen,
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

  return { asaltos: acumulador.asaltos, excluidos, rechazos, grupos, publicado };
}
