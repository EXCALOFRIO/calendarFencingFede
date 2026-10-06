import type { HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import type { PaginaTexto, ItemTexto } from '../../src/lib/ingest/sources/rfee-pdf/tipos';

/**
 * Lector de la documentación PDF que Ophardt Online genera para cada prueba
 * (`/cdn/documents/documentation/<n>-<año>.pdf` y `legacy-documentation/<id>.pdf`).
 * El documento es una sucesión de secciones que empiezan con la cabecera
 * «RESULTS: LIST OF RESULTS» y la fila Competition / Place / Date / Category /
 * Weapon / Gender / Event / Type; cada sección es la clasificación final, las
 * poules (matriz «V/5», «D/3»), la clasificación tras poules o el cuadro
 * (columnas «Tabla de 64» … «Final» con el marcador de cada cruce en la ronda).
 *
 * La lectura usa el texto posicionado de PDF.js: en las matrices la columna de
 * cada celda sale de su x; en el cuadro, la ronda de cada entrada sale de la x
 * de la cabecera de columna de la última página con cabeceras.
 */

type Arma = HechosPrueba['competition']['weapon'];
type Genero = HechosPrueba['competition']['gender'];

export type Tirador = { nombre: string; pais: string | null };
export type BoutLeido = { phase: 'POULE' | 'TABLEAU'; roundKey: string; a: Tirador; b: Tirador; scoreA: number; scoreB: number; winner: 'A' | 'B' | null };

export type CabeceraDoc = { categoria: string; arma: Arma | null; genero: Genero | null; evento: string; fecha: string | null };

export type LecturaDoc = {
  cabeceras: CabeceraDoc[];
  puestos: { t: Tirador; puesto: number }[];
  poules: { bouts: BoutLeido[]; esperados: number; descartados: Record<string, number> } | null;
  cuadro: { bouts: BoutLeido[]; esperados: number; completo: boolean; descartados: Record<string, number> } | null;
  /** Páginas con texto; 0 = PDF escaneado. */
  paginasConTexto: number;
};

const sumar = (m: Record<string, number>, k: string, n = 1) => (m[k] = (m[k] ?? 0) + n);
const PAIS = /^[A-Z]{3}$/;
const CELDA = /^([VD])\/(\d{1,2})$|^(\d{1,2}) ?([VD])$/;

/** Celda de poule o marcador de cuadro: «V/5», «D/3» (Ophardt) o «5V», «15 V» (formato anterior). */
export function celdaDe(s: string): { v: boolean; n: number } | null {
  const m = CELDA.exec(s.trim());
  if (!m) return null;
  return m[1] ? { v: m[1] === 'V', n: Number(m[2]) } : { v: m[4] === 'V', n: Number(m[3]) };
}

/** Nación sola («HUN») o pegada al marcador («HUN 15 V»). */
function paisYMarca(s: string): { pais: string; marca: { v: boolean; n: number } | null } | null {
  const m = /^([A-Z]{3})(?:\s+(\S.*))?$/.exec(s.trim());
  if (!m || /^BYE$/i.test(m[1])) return null;
  if (!m[2]) return { pais: m[1], marca: null };
  const marca = celdaDe(m[2]);
  return marca ? { pais: m[1], marca } : null;
}

type Linea = { y: number; items: ItemTexto[] };

/** Agrupa los textos de una página en líneas (misma y con tolerancia), de arriba abajo. */
export function lineas(p: PaginaTexto, tolerancia = 1.5): Linea[] {
  const orden = [...p.items].filter((i) => i.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const out: Linea[] = [];
  for (const it of orden) {
    const l = out[out.length - 1];
    if (l && Math.abs(l.y - it.y) <= tolerancia) l.items.push(it);
    else out.push({ y: it.y, items: [it] });
  }
  for (const l of out) l.items.sort((a, b) => a.x - b.x);
  return out;
}

const txt = (i: ItemTexto) => i.s.replace(/\s+/g, ' ').trim();

function armaDe(letra: string): Arma | null {
  return letra === 'E' ? 'ESPADA' : letra === 'F' ? 'FLORETE' : letra === 'S' ? 'SABLE' : null;
}

/** Fila de valores bajo «Competition Place Date Category Weapon Gender Event Type». */
function cabeceraDe(ls: Linea[]): CabeceraDoc | null {
  const i = ls.findIndex((l) => l.items.some((x) => txt(x) === 'Category') && l.items.some((x) => txt(x) === 'Weapon'));
  if (i < 0) return null;
  const cab = ls[i].items;
  const col = (n: string) => cab.find((x) => txt(x) === n);
  const valor = (n: string) => {
    const c = col(n);
    if (!c) return null;
    const centro = c.x + c.w / 2;
    for (const l of ls.slice(i + 1, i + 3)) {
      const v = l.items.find((x) => Math.abs(x.x + x.w / 2 - centro) <= Math.max(12, c.w));
      if (v) return txt(v);
    }
    return null;
  };
  const fecha = ls.slice(i + 1, i + 3).flatMap((l) => l.items).map(txt).find((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)) ?? null;
  const genero = valor('Gender');
  return {
    categoria: valor('Category') ?? '', arma: armaDe(valor('Weapon') ?? ''),
    genero: genero === 'M' ? 'M' : genero === 'F' ? 'F' : null, evento: valor('Event') ?? '', fecha,
  };
}

type TipoSeccion = 'clasificacion' | 'poules' | 'ranking_poules' | 'cuadro' | 'otra';

function tipoPagina(ls: Linea[]): TipoSeccion | null {
  const textos = ls.flatMap((l) => l.items.map(txt));
  if (ls.some((l) => numeroPoule(l.items) !== null)) return 'poules';
  // Listas de árbitros con columnas por ronda: no son el cuadro.
  if (textos.slice(0, 40).some((s) => /Kampfrichter|Referees? (list|activity)|Activit. des arbitres|Actividad de (los )?.rbitros|Einsätze/i.test(s))) return 'otra';
  // Clasificaciones (final, tras poules, eliminados) del formato anterior y de Engarde.
  const arriba = textos.slice(0, 40);
  if (arriba.some((s) => /^(Classement G[ée]n[ée]ral|Overall ranking|Final (ranking|standings|results)|Clasificaci.n (general|final)|Endergebnis|Gesamtergebnis|Classifica (generale|finale))/i.test(s))) return 'clasificacion';
  if (arriba.some((s) => /^(Classement des (Qualifi|Elimin)|Ranking (after|at the end of|of) (the )?(poules|pools|round)|Clasificaci.n (de|despu.s de) (las )?poules|Von der Vorrunde befreite|Exempt)/i.test(s))) return 'ranking_poules';
  if (textos.some((s) => rondaDeCabecera(s) !== null)) return 'cuadro';
  const i = textos.indexOf('Rank');
  if (i >= 0 && textos.includes('Points')) return 'clasificacion';
  if (textos.includes('Place') && textos.includes('V') && textos.includes('M')) return 'ranking_poules';
  return null;
}

/** Tamaño de la ronda de una cabecera de columna del cuadro. */
export function rondaDeCabecera(s: string): number | null {
  const t = s.trim();
  const m = /^(?:Tabla de|Table of|Tableau de|Tableau of|Tabelle|Tabellone|Tableau|Table)\s*(\d{1,3})(?:\s*[-/]\s*\d{1,3})?$/i.exec(t);
  if (m) return Number(m[1]);
  if (/^(Qua[rd]t?s? de finale?s?|Cuartos de final|Quarter-?finals?|Viertelfinale|Quarti di finale)$/i.test(t)) return 8;
  if (/^(Semi-?finales?|Semi-?finals?|Demi-?finales?|Halbfinale|Semifinali)$/i.test(t)) return 4;
  if (/^(Final|Finale|Finals|Finales)$/i.test(t)) return 2;
  return null;
}

// ---------------------------------------------------------------------------
// Poules
// ---------------------------------------------------------------------------

type FilaPoule = { t: Tirador; celdas: { x: number; v: boolean; n: number }[]; stats: number[]; tokens?: string[] };

/** Celda de una matriz de Engarde: «V» (victoria a 5), «V4» (victoria con 4), «3» (derrota con 3), «X» la diagonal. */
function celdaEngarde(s: string): { v: boolean; n: number } | 'X' | null {
  if (s === 'X') return 'X';
  if (s === 'V') return { v: true, n: 5 };
  const m = /^V(\d)$/.exec(s);
  if (m) return { v: true, n: Number(m[1]) };
  return /^\d$/.test(s) ? { v: false, n: Number(s) } : null;
}

/**
 * Fila de poule de Engarde a partir de sus palabras (los textos vienen pegados de forma
 * irregular): nombre, nación, n celdas con la «X» en la propia columna, victorias/asaltos,
 * indicador y tocados dados. Devuelve null si la fila no tiene esa forma.
 */
export function filaEngarde(tokens: readonly string[], n: number, propia: number):
  { t: Tirador; celdas: ({ v: boolean; n: number } | null)[]; hs: number | null } | null {
  const iVm = tokens.findIndex((s) => /^\d{1,2}\/\d{1,2}$/.test(s));
  // La diagonal sale como «X» o en blanco según la versión de Engarde.
  const conX = iVm >= n + 1 && tokens[iVm - n + propia] === 'X';
  const ancho = conX ? n : n - 1;
  if (iVm < ancho + 1) return null;
  const celdas = tokens.slice(iVm - ancho, iVm).map(celdaEngarde);
  if (!conX) celdas.splice(propia, 0, 'X');
  if (celdas[propia] !== 'X' || celdas.some((c, j) => j !== propia && (c === 'X' || c === null))) return null;
  const antes = tokens.slice(0, iVm - ancho);
  const pais = antes.length > 1 && PAIS.test(antes[antes.length - 1]) ? antes[antes.length - 1] : null;
  const nombre = (pais ? antes.slice(0, -1) : antes).filter((s) => /\p{L}/u.test(s)).join(' ');
  if (!nombre) return null;
  const [v, m] = tokens[iVm].split('/').map(Number);
  const vic = celdas.filter((c) => c && c !== 'X' && c.v).length;
  if (m === n - 1 && v !== vic && celdas.every((c) => c !== null)) return null;
  const numeros = tokens.slice(iVm + 1).filter((s) => /^-?\d+$/.test(s)).map(Number);
  return { t: { nombre, pais }, celdas: celdas.map((c) => (c === 'X' ? null : c)), hs: numeros.length >= 2 ? numeros[1] : null };
}

/** Número de poule de una línea de cabecera («Pool 6 Piste 6 09:00», «Poule No: 1», «Poule n° 3»); null si no lo es. */
export function numeroPoule(items: readonly ItemTexto[]): number | null {
  for (let i = 0; i < items.length; i += 1) {
    const m = /^(?:Pool|Poule|Grupo|Gruppe|Girone)\s*(?:No\.?|Nr\.?|n°|nº|#)?\s*:?\s*(\d+)?(?:\s|$)/i.exec(txt(items[i]));
    if (!m || /round|tour|vuelta|runde/i.test(txt(items[i]))) continue;
    if (m[1]) return Number(m[1]);
    const sig = items[i + 1] ? txt(items[i + 1]) : '';
    if (/^\d{1,3}$/.test(sig)) return Number(sig);
  }
  return null;
}

function poulesDePaginas(paginas: Linea[][]): NonNullable<LecturaDoc['poules']> {
  const res: NonNullable<LecturaDoc['poules']> = { bouts: [], esperados: 0, descartados: {} };
  type Bloque = { numero: number; filas: FilaPoule[] };
  const bloques: Bloque[] = [];
  for (const ls of paginas) {
    let actual: Bloque | null = null;
    let xNombre: number | null = null;
    for (const l of ls) {
      const numero = numeroPoule(l.items);
      if (numero !== null) {
        actual = { numero, filas: [] };
        bloques.push(actual);
        xNombre = null;
        continue;
      }
      if (!actual) continue;
      const items = l.items;
      // Fila de Engarde: celdas pegadas en textos irregulares y «victorias/asaltos» tras ellas (los
      // formatos de Ophardt no publican esa fracción); se lee por palabras, no por columnas.
      const tokens = items.map(txt).join(' ').split(/\s+/).filter(Boolean);
      if (tokens.some((s) => /^\d{1,2}\/\d{1,2}$/.test(s)) && tokens.filter((s) => celdaEngarde(s) !== null).length >= 2) {
        actual.filas.push({ t: { nombre: '', pais: null }, celdas: [], stats: [], tokens });
        continue;
      }
      const celdas = items.filter((x) => celdaDe(txt(x)) !== null);
      const primeraCelda = celdas[0]?.x ?? Infinity;
      // Nación antes del nombre (Ophardt) o después (formato anterior, con el número de tirador delante).
      const pais = items.find((x) => x.x < primeraCelda && PAIS.test(txt(x)));
      if (pais && celdas.length > 0) {
        const nombreItems = items.filter((x) => x !== pais && x.x < primeraCelda && /\p{L}/u.test(txt(x)) && txt(x) !== '---');
        xNombre = nombreItems[0]?.x ?? null;
        const ultimaCelda = Math.max(...celdas.map((c) => c.x));
        const stats = items.filter((x) => x.x > ultimaCelda && /^-?\d+([.,]\d+)?$/.test(txt(x))).map((x) => Number(txt(x).replace(',', '.')));
        actual.filas.push({
          t: { nombre: nombreItems.map(txt).join(' '), pais: txt(pais) },
          celdas: celdas.map((c) => ({ x: c.x, ...celdaDe(txt(c))! })),
          stats,
        });
        continue;
      }

      // Continuación del nombre en la línea siguiente (nombres largos partidos por la columna).
      const fila = actual.filas[actual.filas.length - 1];
      if (fila && xNombre !== null && items.length === 1 && Math.abs(items[0].x - xNombre) < 2 && !CELDA.test(txt(items[0]))) {
        fila.t.nombre = `${fila.t.nombre} ${txt(items[0])}`;
      }
    }
  }
  // Una segunda vuelta de poules vuelve a numerar desde 1.
  let vuelta = 1;
  const vistos = new Set<number>();
  for (const b of bloques) {
    if (vistos.has(b.numero)) {
      vuelta += 1;
      vistos.clear();
    }
    vistos.add(b.numero);
    const clave = vuelta === 1 ? `P${b.numero}` : `V${vuelta}P${b.numero}`;
    const n = b.filas.length;
    if (n < 2) {
      sumar(res.descartados, 'poule_sin_filas');
      continue;
    }
    res.esperados += (n * (n - 1)) / 2;
    if (b.filas.every((f) => f.tokens)) {
      emitirEngarde(b.filas, n, clave, res);
      continue;
    }
    // Columnas de la matriz: x de todas las celdas de la poule agrupadas.
    const xs = [...new Set(b.filas.flatMap((f) => f.celdas.map((c) => Math.round(c.x))))].sort((a, z) => a - z);
    const cols: number[] = [];
    for (const x of xs) if (!cols.length || x - cols[cols.length - 1] > 6) cols.push(x);
    if (cols.length !== n) {
      sumar(res.descartados, 'matriz_ilegible', (n * (n - 1)) / 2);
      continue;
    }
    const col = (x: number) => cols.findIndex((c) => Math.abs(c - x) <= 6);
    const matriz = b.filas.map((f) => {
      const m = new Map<number, { v: boolean; n: number }>();
      for (const c of f.celdas) m.set(col(c.x), c);
      return m;
    });
    const filaValida = b.filas.map((f, i) => {
      if (matriz[i].has(i) || matriz[i].size !== n - 1) return false;
      let ts = 0;
      let tr = 0;
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue;
        const o = matriz[j].get(i);
        if (!o) return false;
        ts += matriz[i].get(j)!.n;
        tr += o.n;
      }
      // Estadísticas publicadas (V/M, TD, TR, diferencia…): los tocados dados y recibidos deben aparecer seguidos.
      if (f.stats.length < 2) return true;
      return f.stats.some((s, k) => s === ts && f.stats[k + 1] === tr);
    });
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const c = matriz[i].get(j);
        const o = matriz[j].get(i);
        if (!c || !o) {
          sumar(res.descartados, 'sin_marcador');
          continue;
        }
        if (c.v === o.v || (c.v && c.n < o.n) || (o.v && o.n < c.n) || c.n > 5 || o.n > 5) {
          sumar(res.descartados, 'incoherente');
          continue;
        }
        if (!filaValida[i] || !filaValida[j]) {
          sumar(res.descartados, 'totales_no_cuadran');
          continue;
        }
        res.bouts.push({
          phase: 'POULE', roundKey: clave, a: b.filas[i].t, b: b.filas[j].t, scoreA: c.n, scoreB: o.n,
          winner: c.n === o.n ? (c.v ? 'A' : 'B') : null,
        });
      }
    }
  }
  return res;
}

/** Asaltos de una poule de Engarde: recíprocos y con los tocados dados de cada fila iguales a los publicados. */
function emitirEngarde(filas: FilaPoule[], n: number, clave: string, res: NonNullable<LecturaDoc['poules']>): void {
  const leidas = filas.map((f, i) => filaEngarde(f.tokens!, n, i));
  const valida = leidas.map((l) => {
    if (!l || l.celdas.some((c, j) => c === null && j !== leidas.indexOf(l))) return false;
    const hs = l.celdas.reduce((s, c) => s + (c?.n ?? 0), 0);
    return l.hs === null || l.hs === hs;
  });
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = leidas[i];
      const b = leidas[j];
      const c = a?.celdas[j];
      const o = b?.celdas[i];
      if (!a || !b || !c || !o) {
        sumar(res.descartados, a && b ? 'sin_marcador' : 'fila_ilegible');
        continue;
      }
      if (c.v === o.v || (c.v && c.n < o.n) || (o.v && o.n < c.n) || c.n > 5 || o.n > 5) {
        sumar(res.descartados, 'incoherente');
        continue;
      }
      if (!valida[i] || !valida[j]) {
        sumar(res.descartados, 'totales_no_cuadran');
        continue;
      }
      res.bouts.push({
        phase: 'POULE', roundKey: clave, a: a.t, b: b.t, scoreA: c.n, scoreB: o.n,
        winner: c.n === o.n ? (c.v ? 'A' : 'B') : null,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Cuadro
// ---------------------------------------------------------------------------

type Entrada = { x: number; y: number; pagina: number; t: Tirador & { truncado?: boolean }; bye: boolean; v: boolean | null; n: number | null };

function cuadroDePaginas(paginas: Linea[][]): NonNullable<LecturaDoc['cuadro']> {
  const res: NonNullable<LecturaDoc['cuadro']> = { bouts: [], esperados: 0, completo: true, descartados: {} };
  let columnas: { x: number; y: number; ronda: number }[] = [];
  // Entradas por ronda, en orden de lectura (página y altura).
  const porRonda = new Map<string, Entrada[]>();
  let secuencia = 0;
  let ultimaRonda = Infinity;
  paginas.forEach((ls, ip) => {
    const cabeceras = ls.flatMap((l) => l.items).filter((x) => rondaDeCabecera(txt(x)) !== null)
      .map((x) => ({ x: x.x, y: x.y, ronda: rondaDeCabecera(txt(x))! })).sort((a, b) => a.x - b.x);
    // Cada página con cabeceras redefine las columnas; las rondas no se repiten entre el cuadro
    // preliminar y el principal, y un cruce repetido en otra página se cuenta una vez.
    if (cabeceras.length) columnas = cabeceras;
    if (!columnas.length) return;
    for (const l of ls) {
      const items = l.items;
      for (let k = 0; k < items.length; k += 1) {
        const s = txt(items[k]);
        const bye = /^BYE$/i.test(s) || /^(\*\s*){3,}$/.test(s);
        if (rondaDeCabecera(s) !== null || paisYMarca(s) !== null || celdaDe(s) !== null) continue;
        if (!bye && !/\p{L}{2}/u.test(s)) continue;
        // Una entrada es nombre + nación (+ marcador) en la misma línea, a la derecha del nombre.
        const derecha = items.slice(k + 1).filter((x) => x.x - items[k].x < 160);
        const iPais = bye ? undefined : derecha.find((x) => paisYMarca(txt(x)) !== null);
        if (!bye && !iPais) continue;
        // Otro nombre entre éste y la nación: la nación es de la entrada siguiente.
        if (iPais && derecha.some((x) => x.x < iPais.x && /\p{L}{2}/u.test(txt(x)) && paisYMarca(txt(x)) === null)) continue;
        const pm = iPais ? paisYMarca(txt(iPais))! : null;
        const iMarca = iPais && !pm?.marca ? items.slice(k + 1).find((x) => celdaDe(txt(x)) !== null && x.x > iPais.x && x.x - iPais.x < 60) : undefined;
        // Marcador partido en dos textos: «V» y «15».
        const iLetra = iPais && !pm?.marca && !iMarca ? items.find((x) => /^[VD]$/.test(txt(x)) && x.x > iPais.x && x.x - iPais.x < 60) : undefined;
        const iNum = iLetra ? items.find((x) => /^\d{1,2}$/.test(txt(x)) && x.x > iLetra.x && x.x - iLetra.x < 20) : undefined;
        const marcaLeida = pm?.marca ?? (iMarca ? celdaDe(txt(iMarca)) : null) ??
          (iLetra && iNum ? { v: txt(iLetra) === 'V', n: Number(txt(iNum)) } : null);
        const pais = pm ? { s: pm.pais } : null;
        // Columna: la cabecera más cercana en x; si varias comparten x (subcuadros), la más próxima por encima.
        const xMin = Math.min(...columnas.map((col) => Math.abs(col.x - items[k].x)));
        if (xMin > 30) continue;
        const enX = columnas.filter((col) => Math.abs(col.x - items[k].x) <= xMin + 3);
        const encima = enX.filter((col) => col.y >= l.y);
        const c = (encima.length ? encima : enX).reduce((best, col) => (Math.abs(col.y - l.y) < Math.abs(best.y - l.y) ? col : best));
        const m = marcaLeida ? [null, marcaLeida.v ? 'V' : 'D', String(marcaLeida.n)] : null;
        const clave = `${secuencia}|${c.ronda}`;
        (porRonda.get(clave) ?? porRonda.set(clave, []).get(clave)!).push({
          x: items[k].x, y: l.y, pagina: ip, bye, t: { nombre: s.replace(/(…|\.\.\.)$/, '').trim(), pais: pais ? pais.s : null, truncado: true },
          v: m ? m[1] === 'V' : null, n: m ? Number(m[2]) : null,
        });
      }
    }
  });
  const secuencias = new Set([...porRonda.keys()].map((k) => Number(k.split('|')[0])));
  const ultimaSec = Math.max(...secuencias);
  // El mismo cruce sale repetido cuando una ronda es la última columna de un bloque y la primera del siguiente.
  const unicos = new Map<string, Map<string, { bout: BoutLeido | null; motivo: string | null }>>();
  const claveNombres = (a: Tirador, b: Tirador) => [a, b].map((t) => `${t.nombre.toLowerCase()}|${t.pais ?? ''}`).sort().join('#');
  for (const [clave, todas] of porRonda) {
    const [sec, ronda] = clave.split('|').map(Number);
    if (ronda < 2) continue;
    // Las rondas del cuadro preliminar (160, 96…) no son potencias de dos.
    const prefijo = (ronda & (ronda - 1)) === 0 ? 'A' : 'B';
    const roundKey = `${prefijo}${ronda}`;
    const deRonda = unicos.get(roundKey) ?? unicos.set(roundKey, new Map()).get(roundKey)!;
    const grupos = new Map<number, Entrada[]>();
    for (const e of todas) (grupos.get(e.pagina) ?? grupos.set(e.pagina, []).get(e.pagina)!).push(e);
    for (const entradas of grupos.values()) {
      entradas.sort((a, b) => b.y - a.y);
      // Los dos tiradores de un cruce están más cerca entre sí que de los cruces vecinos.
      const huecos = entradas.slice(1).map((e, i) => entradas[i].y - e.y);
      const minimo = Math.min(...huecos);
      const usados = new Set<number>();
      for (let i = 0; i + 1 < entradas.length; i += 1) {
        if (usados.has(i) || huecos[i] > minimo * 1.35 + 1) continue;
        usados.add(i);
        usados.add(i + 1);
        const a = entradas[i];
        const b = entradas[i + 1];
        if (a.bye || b.bye) continue;
        const k = claveNombres(a.t, b.t);
        const previo = deRonda.get(k);
        if (previo?.bout) continue;
        if (a.v === null || b.v === null || a.n === null || b.n === null) {
          if (process.env.DEPURAR) console.log('sin marcador', roundKey, a.pagina, a.x.toFixed(0), a.y.toFixed(0), a.t.nombre, a.n, '|', b.t.nombre, b.n);
          if (!previo) deRonda.set(k, { bout: null, motivo: 'sin_marcador' });
          continue;
        }
        if (a.v === b.v || (a.v && a.n < b.n) || (b.v && b.n < a.n)) {
          deRonda.set(k, { bout: null, motivo: 'incoherente' });
          continue;
        }
        deRonda.set(k, {
          motivo: null,
          bout: { phase: 'TABLEAU', roundKey, a: a.t, b: b.t, scoreA: a.n, scoreB: b.n, winner: a.n === b.n ? (a.v ? 'A' : 'B') : null },
        });
      }
      const sueltas = entradas.filter((_, i) => !usados.has(i) && !entradas[i].bye).length;
      if (sueltas) sumar(res.descartados, 'entrada_sin_pareja', sueltas);
      if (sueltas && process.env.DEPURAR) console.log(roundKey, entradas.map((e, i) => `${usados.has(i) ? '' : '*'}${e.pagina}:${e.y.toFixed(0)}:${e.bye ? 'BYE' : e.t.nombre}`).join(' | '));
    }
  }
  for (const deRonda of unicos.values()) {
    for (const x of deRonda.values()) {
      res.esperados += 1;
      if (x.bout) res.bouts.push(x.bout);
      else {
        sumar(res.descartados, x.motivo ?? 'sin_marcador');
        res.completo = false;
      }
    }
  }
  if (res.descartados.entrada_sin_pareja) res.completo = false;
  if (!porRonda.size) res.completo = false;
  return res;
}

// ---------------------------------------------------------------------------
// Clasificación final
// ---------------------------------------------------------------------------

function puestosDePaginas(paginas: Linea[][]): LecturaDoc['puestos'] {
  const out: LecturaDoc['puestos'] = [];
  for (const ls of paginas) {
    for (const l of ls) {
      const s = l.items.map(txt);
      if (s.length < 3 || !/^\d+$/.test(s[0])) continue;
      const pais = s.find((x, i) => i > 1 && PAIS.test(x));
      const nombre = s.slice(1).find((x) => /\p{L}{2}/u.test(x) && !PAIS.test(x));
      if (!nombre) continue;
      out.push({ t: { nombre, pais: pais ?? null }, puesto: Number(s[0]) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

export type SeccionDoc = { cabecera: CabeceraDoc | null; tipo: TipoSeccion; paginas: Linea[][] };

export function seccionesDoc(paginas: PaginaTexto[]): SeccionDoc[] {
  const out: SeccionDoc[] = [];
  for (const p of paginas) {
    const ls = lineas(p);
    if (!ls.length) continue;
    const nueva = ls.some((l) => l.items.some((x) => /RESULTS:\s*LIST OF RESULTS/i.test(txt(x))));
    const tipo = tipoPagina(ls);
    const previa = out[out.length - 1];
    // Sin la cabecera «RESULTS» de Ophardt, cada cambio de tipo de página abre otra sección.
    const cambio = !!previa && !!tipo && previa.tipo !== 'otra' && previa.tipo !== tipo;
    if (nueva || !previa || cambio) out.push({ cabecera: cabeceraDe(ls) ?? (nueva ? null : previa?.cabecera ?? null), tipo: tipo ?? 'otra', paginas: [ls] });
    else {
      if (previa.tipo === 'otra' && tipo) previa.tipo = tipo;
      previa.paginas.push(ls);
    }
  }
  return out;
}

const CATEGORIA: Record<string, string> = { S: 'ABS', J: 'M20', C: 'M17', V: 'VET' };

/** Las secciones del documento que son de la prueba (categoría, arma, género, individual). */
export function leerDocumento(paginas: PaginaTexto[], prueba?: { weapon: Arma; gender: Genero; category: string }): LecturaDoc {
  const conTexto = paginas.filter((p) => p.items.some((i) => i.s.trim())).length;
  const todas = seccionesDoc(paginas);
  const cabeceras = todas.map((s) => s.cabecera).filter((c): c is CabeceraDoc => c !== null);
  const propias = todas.filter((s) => !prueba || !s.cabecera || (
    s.cabecera.arma === prueba.weapon && s.cabecera.genero === prueba.gender &&
    (CATEGORIA[s.cabecera.categoria] ?? s.cabecera.categoria) === prueba.category && /^I/i.test(s.cabecera.evento)));
  const de = (t: TipoSeccion) => propias.filter((s) => s.tipo === t).flatMap((s) => s.paginas);
  const pp = de('poules');
  const pc = de('cuadro');
  const puestos = puestosDePaginas(de('clasificacion'));
  const poules = pp.length ? poulesDePaginas(pp) : null;
  const cuadro = pc.length ? cuadroDePaginas(pc) : null;
  if (cuadro) {
    const completos = [
      ...puestos.map((p) => p.t),
      ...(poules?.bouts ?? []).flatMap((b) => [b.a, b.b]),
      ...de('ranking_poules').flatMap((ls) => ls.flatMap((l) => {
        const s = l.items.map(txt);
        const pais = s.find((x) => PAIS.test(x));
        return /^\d+$/.test(s[0] ?? '') && s[1] ? [{ nombre: s[1], pais: pais ?? null }] : [];
      })),
    ];
    for (const b of cuadro.bouts) {
      b.a = completarNombre(b.a, completos);
      b.b = completarNombre(b.b, completos);
    }
  }
  return { cabeceras, puestos, poules, cuadro, paginasConTexto: conTexto };
}

const plegar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * El cuadro recorta los nombres largos («ROSATELLI Dam…», «MIKOLAJCZAK Krzysz»): un nombre que no está entero en la
 * clasificación o las poules se completa con el único nombre de la misma nación que empieza igual.
 */
export function completarNombre(t: Tirador & { truncado?: boolean }, completos: readonly Tirador[]): Tirador {
  if (!t.truncado) return { nombre: t.nombre, pais: t.pais };
  const prefijo = plegar(t.nombre);
  if (completos.some((x) => plegar(x.nombre) === prefijo && (!t.pais || x.pais === t.pais))) return { nombre: t.nombre, pais: t.pais };
  const c = new Set(completos.filter((x) => (!t.pais || x.pais === t.pais) && plegar(x.nombre).startsWith(prefijo) && plegar(x.nombre) !== prefijo)
    .map((x) => x.nombre));
  return { nombre: c.size === 1 ? [...c][0] : t.nombre, pais: t.pais };
}

const palabras = (s: string) => plegar(s).replace(/[^a-z ]+/g, ' ').split(' ').filter((p) => p.length >= 2);

/** Todas las palabras del nombre corto son prefijo de alguna palabra distinta del largo, empezando por el apellido. */
function contenido(corto: string[], largo: string[]): boolean {
  if (corto.length < 2 || !largo.length || corto[0] !== largo[0]) return false;
  const usadas = new Set<number>();
  return corto.every((p) => {
    const i = largo.findIndex((q, k) => !usadas.has(k) && (q.startsWith(p) || (p.length >= 4 && p.startsWith(q))));
    if (i < 0) return false;
    usadas.add(i);
    return true;
  });
}

/**
 * Nombres del documento que no coinciden con la clasificación de la prueba por variantes de
 * escritura («CANA Kelvin» / «CANA INFANTE Kelvin», «KELSEY Weston Seth» / «KELSEY Seth»,
 * «MADRIGAL SARDINAS Guiller» recortado): se reescriben con el nombre de la clasificación
 * cuando, en la misma nación, hay un único candidato cuyo nombre contiene al otro palabra a
 * palabra, y ningún otro tirador del documento reclama ese mismo nombre.
 */
export function alinearNombres(lectura: Pick<LecturaDoc, 'poules' | 'cuadro'>, clasificacion: readonly Tirador[]): number {
  const bouts = [...(lectura.poules?.bouts ?? []), ...(lectura.cuadro?.bouts ?? [])];
  const exactos = new Set(clasificacion.map((t) => `${plegar(t.nombre)}|${t.pais ?? ''}`));
  const clave = (t: Tirador) => `${plegar(t.nombre)}|${t.pais ?? ''}`;
  const propuestas = new Map<string, string>();
  const reclamados = new Map<string, number>();
  const reclamantes = new Map<string, string[]>();
  const distintos = [...new Map(bouts.flatMap((b) => [b.a, b.b]).map((t) => [clave(t), t])).values()];
  // Un nombre de la clasificación que ya aparece tal cual en el documento no puede ser variante de otro.
  for (const t of distintos) {
    const c = clasificacion.find((x) => clave(x) === clave(t));
    if (c) reclamados.set(c.nombre, 1);
  }
  for (const t of distintos) {
    if (exactos.has(clave(t))) continue;
    const pt = palabras(t.nombre);
    const cands = clasificacion
      .filter((c) => !t.pais || !c.pais || c.pais === t.pais)
      .filter((c) => {
        const pc = palabras(c.nombre);
        return contenido(pt, pc) || contenido(pc, pt);
      });
    const unicos = new Set(cands.map((c) => c.nombre));
    if (unicos.size !== 1) continue;
    const nombre = [...unicos][0];
    propuestas.set(clave(t), nombre);
    // El mismo tirador recortado de dos formas («Ruben Da», «Ruben Dario») cuenta como un solo reclamante.
    const previos = reclamantes.get(nombre) ?? [];
    if (!previos.some((p) => plegar(p).startsWith(plegar(t.nombre)) || plegar(t.nombre).startsWith(plegar(p)))) {
      reclamados.set(nombre, (reclamados.get(nombre) ?? 0) + 1);
    }
    reclamantes.set(nombre, [...previos, t.nombre]);
  }
  let n = 0;
  const reescribir = (t: Tirador): Tirador => {
    const nombre = propuestas.get(clave(t));
    if (!nombre || (reclamados.get(nombre) ?? 0) > 1) return t;
    n += 1;
    return { nombre, pais: t.pais };
  };
  for (const b of bouts) {
    b.a = reescribir(b.a);
    b.b = reescribir(b.b);
  }
  return n;
}
