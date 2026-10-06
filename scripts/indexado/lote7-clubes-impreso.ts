/**
 * Lector de las páginas HTML de Engarde impresas desde el navegador («Imprimir a PDF»), el formato
 * que publican muchos clubes organizadores: clasificación general, poules (matriz con «V», «V4»,
 * tocados, V/M, índice y TD) y cuadro en árbol («Tabla de 64» con el ganador de cada cruce en la
 * columna siguiente y el marcador «15/12» debajo). No es la maquetación de los PDF nativos de
 * Engarde que lee `src/lib/ingest/sources/rfee-pdf`.
 *
 * Todo es geometría del texto de PDF.js (`extraerPaginas`); nada se infiere por nombre salvo el
 * emparejamiento con la clasificación, y cada lectura se valida (matriz de poule contra V/M y TD,
 * cada ganador del cuadro es uno de los dos tiradores del cruce).
 */
import type { ItemTexto, PaginaTexto } from '../../src/lib/ingest/sources/rfee-pdf/tipos';
import { normalizarNombre, palabrasNombre } from './comun';

export type Item = ItemTexto & { pagina: number };
type Linea = { pagina: number; y: number; items: Item[] };

const MARGEN_SUP = 810;
const MARGEN_INF = 25;

const limpio = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Ítems útiles: fuera de cabecera y pie de página repetidos, sin «Document Engarde» ni su fecha. */
export function itemsUtiles(paginas: readonly PaginaTexto[]): Item[] {
  const out: Item[] = [];
  for (const p of paginas) {
    for (const it of p.items) {
      const s = limpio(it.s);
      if (s === '' || it.y > MARGEN_SUP || it.y < MARGEN_INF) continue;
      if (/^Document Engarde$/i.test(s) || /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(s) || /^file:\/\//i.test(s)) continue;
      out.push({ ...it, s, pagina: p.numero });
    }
  }
  return out;
}

export function agruparLineas(items: readonly Item[], tolerancia = 1.5): Linea[] {
  const orden = [...items].sort((a, b) => a.pagina - b.pagina || b.y - a.y || a.x - b.x);
  const lineas: Linea[] = [];
  for (const it of orden) {
    const ultima = lineas.at(-1);
    if (ultima && ultima.pagina === it.pagina && Math.abs(ultima.y - it.y) <= tolerancia) ultima.items.push(it);
    else lineas.push({ pagina: it.pagina, y: it.y, items: [it] });
  }
  for (const l of lineas) l.items.sort((a, b) => a.x - b.x);
  return lineas;
}

export const claveNombreTirador = (s: string) => normalizarNombre(s);

/** Nombre del cuadro o de la poule frente al de la clasificación: iguales o uno recorta al otro. */
export function nombresCasan(x: string, y: string): boolean {
  if (normalizarNombre(x) === normalizarNombre(y)) return true;
  const a = palabrasNombre(x).join('').toLowerCase();
  const b = palabrasNombre(y).join('').toLowerCase();
  return a.length >= 6 && b.length >= 6 && (a.startsWith(b) || b.startsWith(a));
}

// ------------------------------------------------------------------ clasificación

export type FilaClasificacion = {
  pagina: number;
  y: number;
  posicion: number | null;
  posicionRaw: string | null;
  nombre: string;
  pais: string | null;
  club: string | null;
};

/**
 * «Clasificación general final»: columnas «Cl.», «Apellido nom», [«Nombre»], [«Nación»], «Club».
 * Los datos van alineados a la izquierda y la cabecera centrada: una columna empieza 20 pt antes
 * que su título.
 */
export function leerClasificacion(paginas: readonly PaginaTexto[]): { filas: FilaClasificacion[]; avisos: string[] } {
  const lineas = agruparLineas(itemsUtiles(paginas));
  const avisos: string[] = [];
  const iCab = lineas.findIndex((l) => l.items.some((i) => i.s === 'Cl.') && l.items.some((i) => /^Apellido/i.test(i.s)));
  if (iCab < 0) return { filas: [], avisos: ['sin_cabecera_clasificacion'] };
  const cab = lineas[iCab].items;
  const col = (re: RegExp) => cab.find((i) => re.test(i.s)) ?? null;
  const cl = col(/^Cl\.$/)!;
  const ape = col(/^Apellido/i)!;
  const nom = col(/^Nombre$/i);
  const nac = col(/^Naci[oó]n$/i);
  const club = col(/^Club$/i);
  const inicioPos = cl.x + cl.w + 12;
  const cortes = [
    { k: 'apellido', x: inicioPos },
    ...(nom ? [{ k: 'nombre', x: nom.x - 20 }] : []),
    ...(nac ? [{ k: 'pais', x: nac.x - 20 }] : []),
    ...(club ? [{ k: 'club', x: club.x - 20 }] : []),
  ].sort((a, b) => a.x - b.x);
  const columna = (x: number) => (x < inicioPos ? 'pos' : [...cortes].reverse().find((c) => x >= c.x)!.k);
  const filas: FilaClasificacion[] = [];
  for (const l of lineas.slice(iCab + 1)) {
    const partes: Record<string, string[]> = {};
    for (const it of l.items) (partes[columna(it.x)] ??= []).push(it.s);
    const pos = partes.pos?.join(' ') ?? null;
    const apellido = partes.apellido?.join(' ') ?? '';
    if (pos === null) {
      // Línea partida: sólo se acepta como continuación del nombre o del club de la fila anterior.
      const previa = filas.at(-1);
      if (previa && previa.pagina === l.pagina && previa.y - l.y < 14 && (apellido || partes.nombre || partes.club)) {
        previa.nombre = limpio(`${previa.nombre} ${apellido} ${partes.nombre?.join(' ') ?? ''}`);
        if (partes.club) previa.club = limpio(`${previa.club ?? ''} ${partes.club.join(' ')}`);
        avisos.push(`linea_continuada:p${l.pagina}`);
      }
      continue;
    }
    if (apellido === '' && !partes.nombre) continue;
    const n = /^\d+$/.test(pos) ? Number(pos) : null;
    const pais = partes.pais?.join('') ?? null;
    filas.push({
      pagina: l.pagina,
      y: l.y,
      posicion: n !== null && n > 0 ? n : null,
      posicionRaw: n !== null && n > 0 ? null : pos,
      nombre: limpio(`${apellido} ${partes.nombre?.join(' ') ?? ''}`),
      pais: pais && /^[A-Z]{3}$/.test(pais) ? pais : null,
      club: partes.club ? limpio(partes.club.join(' ')) : null,
    });
  }
  return { filas, avisos };
}

// ------------------------------------------------------------------ poules

export type FilaPoule = { nombre: string; club: string | null; celdas: (string | null)[]; vm: string; td: number | null; indice: number | null };
export type Poule = { numero: number; vuelta: number; pagina: number; filas: FilaPoule[] };
export type AsaltoPoule = { vuelta: number; poule: number; a: string; b: string; ta: number; tb: number; ganador: 'A' | 'B' | null };

const CELDA = /^(V\d*|\d+)$/;

/** Agrupa posiciones x (ya ordenadas o no) con una tolerancia. */
export function grupos(xs: readonly number[], tolerancia = 4): number[] {
  const orden = [...xs].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const x of orden) {
    const g = out.at(-1);
    if (g && x - g.at(-1)! <= tolerancia) g.push(x);
    else out.push([x]);
  }
  return out.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
}

export function leerPoules(paginas: readonly PaginaTexto[]): { poules: Poule[]; avisos: string[] } {
  const items = itemsUtiles(paginas);
  const lineas = agruparLineas(items);
  const avisos: string[] = [];
  const poules: Poule[] = [];
  let vuelta = 1;
  type Bruto = { numero: number; vuelta: number; pagina: number; filas: { linea: Linea; vmIdx: number }[] };
  const brutos: Bruto[] = [];
  let actual: Bruto | null = null;
  for (const l of lineas) {
    const texto = l.items.map((i) => i.s).join(' ');
    const v = /vuelta\s*n[oº°]?\s*(\d+)/i.exec(texto);
    if (v) vuelta = Number(v[1]);
    const m = /^Poule\s*n[oº°]?\s*(\d+)/i.exec(l.items[0]?.s ?? '');
    if (m) {
      actual = { numero: Number(m[1]), vuelta, pagina: l.pagina, filas: [] };
      brutos.push(actual);
      continue;
    }
    const vmIdx = l.items.findIndex((i) => /^\d+\/\d+$/.test(i.s));
    if (actual && vmIdx > 0) actual.filas.push({ linea: l, vmIdx });
  }
  for (const b of brutos) {
    const n = b.filas.length;
    // Las celdas son los n grupos de x más a la derecha antes de la columna V/M.
    const xs: number[] = [];
    for (const f of b.filas) for (const it of f.linea.items.slice(0, f.vmIdx)) if (CELDA.test(it.s)) xs.push(it.x);
    const cols = grupos(xs).slice(-n);
    if (cols.length !== n) {
      avisos.push(`poule_${b.vuelta}_${b.numero}:columnas_${cols.length}_de_${n}`);
      continue;
    }
    const primera = cols[0] - 4;
    const xNombre = Math.min(...b.filas.map((f) => f.linea.items[0].x));
    const filas: FilaPoule[] = [];
    for (const f of b.filas) {
      const l = f.linea;
      // El nombre largo se parte en dos líneas por encima y por debajo de la fila.
      const nombre = items
        .filter((i) => i.pagina === l.pagina && Math.abs(i.x - xNombre) < 3 && Math.abs(i.y - l.y) <= 7.5)
        .sort((a, c) => c.y - a.y)
        .map((i) => i.s)
        .join(' ');
      const club = l.items.filter((i) => i.x > xNombre + 3 && i.x < primera).map((i) => i.s).join(' ') || null;
      const celdas: (string | null)[] = Array(n).fill(null);
      for (const it of l.items.slice(0, f.vmIdx)) {
        if (it.x < primera || !CELDA.test(it.s)) continue;
        const j = cols.findIndex((c) => Math.abs(c - it.x) <= 4);
        if (j < 0 || celdas[j] !== null) { avisos.push(`poule_${b.vuelta}_${b.numero}:celda_fuera_de_columna`); continue; }
        celdas[j] = it.s;
      }
      const tras = l.items.slice(f.vmIdx + 1).map((i) => i.s);
      const num = (s: string | undefined) => (s !== undefined && /^-?\d+$/.test(s) ? Number(s) : null);
      filas.push({ nombre: limpio(nombre), club, celdas, vm: l.items[f.vmIdx].s, indice: tras.length >= 2 ? num(tras[0]) : null, td: num(tras.at(-1)) });
    }
    poules.push({ numero: b.numero, vuelta: b.vuelta, pagina: b.pagina, filas });
  }
  return { poules, avisos };
}

/**
 * Asaltos de una poule con validación completa de la matriz: una sola victoria por pareja, el
 * perdedor con menos tocados, V/M y TD de cada fila, e índice en valor absoluto (el signo se
 * pierde en la impresión). «V» vale `max` tocados.
 */
export function asaltosDePoule(p: Poule, max = 5): { asaltos: AsaltoPoule[]; errores: string[] } {
  const n = p.filas.length;
  const errores: string[] = [];
  const asaltos: AsaltoPoule[] = [];
  const valor = (s: string) => {
    const m = /^V(\d*)$/.exec(s);
    return m ? { v: true, t: m[1] === '' ? max : Number(m[1]) } : { v: false, t: Number(s) };
  };
  const td = Array(n).fill(0);
  const tr = Array(n).fill(0);
  const vic = Array(n).fill(0);
  const jugados = Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    if (p.filas[i].celdas[i] !== null) errores.push(`diagonal_${i + 1}`);
    for (let j = i + 1; j < n; j += 1) {
      const a = p.filas[i].celdas[j];
      const b = p.filas[j].celdas[i];
      if (a === null || b === null) { errores.push(`sin_celda_${i + 1}_${j + 1}`); continue; }
      const x = valor(a);
      const y = valor(b);
      // «V2» frente a «2»: victoria por prioridad con el marcador igualado.
      if (x.v === y.v || x.t > max || y.t > max || (x.v && x.t < y.t) || (y.v && y.t < x.t)) {
        errores.push(`incoherente_${i + 1}_${j + 1}:${a}/${b}`);
        continue;
      }
      asaltos.push({
        vuelta: p.vuelta, poule: p.numero, a: p.filas[i].nombre, b: p.filas[j].nombre, ta: x.t, tb: y.t,
        ganador: x.t === y.t ? (x.v ? 'A' : 'B') : null,
      });
      td[i] += x.t; tr[i] += y.t; td[j] += y.t; tr[j] += x.t;
      jugados[i] += 1; jugados[j] += 1;
      if (x.v) vic[i] += 1; else vic[j] += 1;
    }
  }
  if (errores.length === 0) {
    for (let i = 0; i < n; i += 1) {
      const f = p.filas[i];
      const vm = /^(\d+)\/(\d+)$/.exec(f.vm);
      if (!vm || Number(vm[1]) !== vic[i] || Number(vm[2]) !== jugados[i]) errores.push(`vm_${i + 1}:${f.vm}!=${vic[i]}/${jugados[i]}`);
      if (f.td !== td[i]) errores.push(`td_${i + 1}:${f.td}!=${td[i]}`);
      if (f.indice !== null && Math.abs(f.indice) !== Math.abs(td[i] - tr[i])) errores.push(`indice_${i + 1}:${f.indice}!=${td[i] - tr[i]}`);
    }
  }
  return { asaltos: errores.length === 0 ? asaltos : [], errores };
}

// ------------------------------------------------------------------ cuadro

export type Bloque = { orden: number; pagina: number; yMax: number; yMin: number; nombre: string; marcador: string | null };
export type CruceCuadro = { ronda: string; a: string; b: string; ganador: 'A' | 'B'; ta: number; tb: number };
export type LecturaCuadro = { tamano: number; cruces: CruceCuadro[]; byes: number; errores: string[]; avisos: string[] };

const MARCADOR = /^\d{1,2}\/\d{1,2}$/;
/** Lo que Engarde imprime bajo el ganador cuando no hubo asalto completo. */
const SIN_ASALTO = /^(por )?(abandono|exclusi[oó]n|no presentad[oa]|forfait|retirad[oa])$/i;

type Seccion = { tipo: 'tabla' | 'tercero'; tamano: number; items: Item[] };

/** Partes del cuadro: «Tabla de N» (puede ocupar varias páginas) y «Tercer lugar» (dos huecos). */
function secciones(paginas: readonly PaginaTexto[]): Seccion[] {
  const items = itemsUtiles(paginas).sort((a, b) => a.pagina - b.pagina || b.y - a.y || a.x - b.x);
  const out: Seccion[] = [];
  let actual: Seccion | null = null;
  for (const it of items) {
    const t = /^Tabla de (\d+)$/i.exec(it.s);
    if (t) { actual = { tipo: 'tabla', tamano: Number(t[1]), items: [] }; out.push(actual); continue; }
    if (/^Tercer (lugar|puesto)$/i.test(it.s)) { actual = { tipo: 'tercero', tamano: 2, items: [] }; out.push(actual); continue; }
    if (actual) actual.items.push(it);
  }
  return out;
}

const orden = (it: Item) => it.pagina * 10_000 - it.y;

function leerSeccion(s: Seccion, ronda: (k: number) => string): LecturaCuadro {
  const errores: string[] = [];
  const avisos: string[] = [];
  const columnas = Math.round(Math.log2(s.tamano)) + 1;
  if (2 ** (columnas - 1) !== s.tamano) return { tamano: s.tamano, cruces: [], byes: 0, errores: [`tamano_no_potencia_de_2:${s.tamano}`], avisos };
  const marcadores = s.items.filter((i) => MARCADOR.test(i.s) || SIN_ASALTO.test(i.s));
  const xMin = Math.min(...s.items.filter((i) => !/^\d+$/.test(i.s)).map((i) => i.x));
  const semillas = s.items.filter((i) => /^\d+$/.test(i.s) && i.x < xMin - 2);
  const textos = s.items.filter((i) => !marcadores.includes(i) && !semillas.includes(i));
  const xs = grupos(textos.map((i) => i.x), 5);
  // Columna 0 = la de más a la izquierda; rondas siguientes = las columnas-1 de más a la derecha;
  // lo que queda entre ambas es el club (que puede venir partido: «Utb» «Z»).
  if (xs.length < columnas) return { tamano: s.tamano, cruces: [], byes: 0, errores: [`columnas_${xs.length}_esperadas_${columnas}:${xs.map((x) => x.toFixed(0)).join(',')}`], avisos };
  const cols = columnas === 1 ? [xs[0]] : [xs[0], ...xs.slice(-(columnas - 1))];
  const esClub = (x: number) => cols.length > 1 && x > cols[0] + 5 && x < cols[1] - 5;
  const colDe = (x: number) => cols.findIndex((c) => Math.abs(c - x) <= 5);

  const bloques: Bloque[][] = cols.map(() => []);
  for (const it of [...textos].sort((a, b) => orden(a) - orden(b))) {
    if (esClub(it.x)) continue;
    const k = colDe(it.x);
    if (k < 0) { errores.push(`texto_fuera_de_columna:${it.pagina}`); continue; }
    const ultimo = bloques[k].at(-1);
    if (ultimo && ultimo.pagina === it.pagina && ultimo.yMin - it.y <= 13.5) {
      ultimo.nombre = limpio(`${ultimo.nombre} ${it.s}`);
      ultimo.yMin = it.y;
    } else bloques[k].push({ orden: orden(it), pagina: it.pagina, yMax: it.y, yMin: it.y, nombre: it.s, marcador: null });
  }
  // El navegador corta el HTML en páginas sin partir líneas: un nombre puede seguir arriba de la
  // página siguiente. En la columna 0 la parte sin número de cabeza de serie es la continuación;
  // en las demás se unen tantas como sobren respecto al tamaño de la columna.
  const corte = (a: Bloque, b: Bloque) => b.pagina === a.pagina + 1 && a.yMin < 50 && b.yMax > 790;
  const unir = (lista: Bloque[], i: number) => {
    lista[i - 1].nombre = limpio(`${lista[i - 1].nombre} ${lista[i].nombre}`);
    lista[i - 1].yMin = -1;
    lista.splice(i, 1);
  };
  const conSemilla = (b: Bloque) => semillas.some((sm) => sm.pagina === b.pagina && sm.y <= b.yMax + 7 && sm.y >= b.yMin - 7);
  for (let i = bloques[0].length - 1; i > 0; i -= 1) {
    if (corte(bloques[0][i - 1], bloques[0][i]) && !conSemilla(bloques[0][i])) { unir(bloques[0], i); avisos.push('nombre_partido_entre_paginas'); }
  }
  for (let k = 1; k < cols.length; k += 1) {
    const sobran = bloques[k].length - s.tamano / 2 ** k;
    const candidatos = bloques[k].map((b, i) => i).filter((i) => i > 0 && corte(bloques[k][i - 1], bloques[k][i]));
    if (sobran > 0 && candidatos.length === sobran) {
      for (const i of candidatos.reverse()) unir(bloques[k], i);
      avisos.push('nombre_partido_entre_paginas');
    }
  }
  for (const m of marcadores) {
    // El marcador va bajo el ganador, un poco a la derecha del inicio de su columna.
    const k = cols.reduce((mejor, c, i) => (c <= m.x + 1 && (mejor < 0 || c > cols[mejor]) ? i : mejor), -1);
    const previo = k >= 0 ? bloques[k].filter((b) => b.orden < orden(m)).at(-1) : undefined;
    if (!previo || previo.marcador !== null) { errores.push(`marcador_sin_ganador:${m.s}`); continue; }
    previo.marcador = m.s;
  }
  // Columna 0: un hueco por número de cabeza de serie; el tirador es el bloque que lo abarca.
  const huecos: (Bloque | null)[] = semillas.sort((a, b) => orden(a) - orden(b)).map((sm) => {
    const b = bloques[0].find((x) => x.pagina === sm.pagina && sm.y <= x.yMax + 7 && sm.y >= x.yMin - 7);
    if (b || sm.y >= 50) return b ?? null;
    // Número al pie de una página y nombre arriba de la siguiente.
    const siguiente = bloques[0].find((x) => x.pagina === sm.pagina + 1 && x.yMax > 790 && !conSemilla(x));
    if (siguiente) avisos.push('semilla_y_nombre_en_paginas_distintas');
    return siguiente ?? null;
  });
  const usados = new Set(huecos.filter((b): b is Bloque => b !== null));
  if (huecos.length !== s.tamano) errores.push(`huecos_${huecos.length}_de_${s.tamano}`);
  if (usados.size !== bloques[0].length || usados.size !== huecos.filter((b) => b !== null).length) {
    const sueltos = bloques[0].filter((b) => !usados.has(b)).map((b) => `${b.pagina}/${b.yMax.toFixed(0)}`);
    errores.push(`tiradores_sin_hueco:${sueltos.join(',')}:${usados.size}/${huecos.filter((b) => b !== null).length}`);
  }
  for (let k = 1; k < cols.length; k += 1) {
    if (bloques[k].length !== s.tamano / 2 ** k) errores.push(`columna_${k}:${bloques[k].length}_de_${s.tamano / 2 ** k}`);
  }
  if (errores.length > 0) {
    if (process.env.LOTE7_CLUBES_DEPURAR) for (const [k, bs] of bloques.entries()) console.error(k, bs.map((b) => `${b.pagina}/${b.yMax.toFixed(0)}:${b.nombre}${b.marcador ? ` [${b.marcador}]` : ''}`).join(' | '));
    return { tamano: s.tamano, cruces: [], byes: 0, errores, avisos };
  }

  const cruces: CruceCuadro[] = [];
  let byes = 0;
  let previa: (Bloque | null)[] = huecos;
  for (let k = 1; k < cols.length; k += 1) {
    const actual = bloques[k];
    for (let m = 0; m < actual.length; m += 1) {
      const a = previa[2 * m];
      const b = previa[2 * m + 1];
      const g = actual[m];
      const esA = a !== null && nombresCasan(a.nombre, g.nombre);
      const esB = b !== null && nombresCasan(b.nombre, g.nombre);
      if (esA === esB) { errores.push(`ganador_no_casa:${ronda(k)}:${m + 1}`); continue; }
      if (a === null || b === null) {
        byes += 1;
        if (g.marcador !== null) errores.push(`marcador_en_bye:${ronda(k)}:${m + 1}`);
        continue;
      }
      if (g.marcador === null) { errores.push(`sin_marcador:${ronda(k)}:${m + 1}`); continue; }
      if (SIN_ASALTO.test(g.marcador)) { avisos.push(`sin_asalto:${ronda(k)}:${g.marcador}`); continue; }
      const [w, l] = g.marcador.split('/').map(Number);
      if (w < l) { errores.push(`marcador_invertido:${ronda(k)}:${m + 1}:${g.marcador}`); continue; }
      cruces.push({ ronda: ronda(k), a: a.nombre, b: b.nombre, ganador: esA ? 'A' : 'B', ta: esA ? w : l, tb: esA ? l : w });
    }
    previa = actual;
  }
  return { tamano: s.tamano, cruces, byes, errores, avisos };
}

/** Cuadro completo: rondas `T<N>` del cuadro principal y `T2-3` para el tercer puesto. */
export function leerCuadro(paginas: readonly PaginaTexto[]): LecturaCuadro {
  const partes = secciones(paginas);
  const tabla = partes.filter((p) => p.tipo === 'tabla');
  if (tabla.length !== 1) return { tamano: 0, cruces: [], byes: 0, errores: [`tablas_${tabla.length}`], avisos: [] };
  const principal = leerSeccion(tabla[0], (k) => `T${tabla[0].tamano / 2 ** (k - 1)}`);
  for (const t of partes.filter((p) => p.tipo === 'tercero')) {
    const r = leerSeccion(t, () => 'T2-3');
    principal.cruces.push(...r.cruces);
    principal.errores.push(...r.errores.map((e) => `tercero:${e}`));
    principal.avisos.push(...r.avisos.map((e) => `tercero:${e}`));
  }
  return principal;
}
