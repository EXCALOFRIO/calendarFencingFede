import { sql } from 'drizzle-orm';
import { clasificarSerie, type SerieComplementaria } from '@/lib/ingest/series-complementarias';
import { CATEGORY_LABEL } from '@/lib/utils';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { FECHA_RE, UUID_RE } from './cursor';
import type { EdicionResumen } from './edicion-modelo';
import { PAISES } from './paises';
import type { Arma, Formato } from './tipos';
import {
  anadirConceptos,
  casarPalabra,
  palabrasConsulta,
  terminosIndice,
  type PalabraConsulta,
} from './texto-difuso';

/**
 * Índice en memoria de todas las ediciones para el buscador de competiciones.
 *
 * Se lee de D1 una vez por versión de datos (`DatosIndiceEdiciones`, compacto
 * y serializable, va a la caché compartida) y cada isolate lo convierte en un
 * `IndiceEdiciones` que responde en milisegundos sin volver a D1: búsqueda
 * tolerante (sinónimos, prefijos y erratas), filtros, recuento y página. Sólo
 * lleva metadatos públicos de la edición; nada de personas ni de cuentas.
 */

export const ARMAS_INDICE = ['FLORETE', 'ESPADA', 'SABLE'] as const;
const FORMATOS = ['INDIVIDUAL', 'EQUIPOS'] as const;
const GENEROS = ['M', 'F', 'MIXTO'] as const;
export const CATEGORIAS_INDICE = Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[];

/** Separador de los diccionarios de texto: no aparece en nombres publicados. */
const SEP = '\u001f';

/**
 * Lo que se guarda en la caché: cada columna es UN texto (valores separados
 * por comas, o por `SEP` los diccionarios). Así deserializarlo es un
 * `JSON.parse` de una docena de cadenas y no de 130.000 valores sueltos, que
 * con el reviver de la caché costaba 25 veces más. Cambia `v` si cambia la forma.
 */
export type DatosIndiceEdiciones = {
  v: 2;
  nombres: string;
  ciudades: string;
  temporadas: string;
  fuentes: string;
  /** Identificadores; los UUID van sin guiones. */
  id: string;
  /** Posición del nombre en `nombres`. */
  n: string;
  /** Ciudad (-1 sin ciudad). */
  c: string;
  t: string;
  f: string;
  /** País tal y como lo guarda la base (vacío sin país). */
  p: string;
  /** Inicio en días desde 1970 (-1 sin fecha). */
  i: string;
  /** Días de `inicio` a `fin` (-1 sin fin). */
  d: string;
  /** Pruebas. */
  k: string;
  /** Bits: 0-2 armas, 3-4 formatos, 5-7 géneros. */
  a: string;
  /** Bits de categorías, en el orden de `CATEGORIAS_INDICE`. */
  g: string;
};

type FilaIndice = {
  id: string;
  nombre: string;
  temporada: string;
  fuente: string;
  ciudad: string | null;
  pais: string | null;
  inicio: string | null;
  fin: string | null;
  pruebas: number;
  armas: string | null;
  formatos: string | null;
  generos: string | null;
  categorias: string | null;
};

const DIA = 86_400_000;

function aDias(iso: string | null): number {
  if (!iso || !FECHA_RE.test(iso.slice(0, 10))) return -1;
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? Math.round(t / DIA) : -1;
}

function deDias(dias: number): string | null {
  return dias < 0 ? null : new Date(dias * DIA).toISOString().slice(0, 10);
}

/** Año civil de un día desde 1970, sin crear fechas (algoritmo de H. Hinnant). */
function anioDeDias(dias: number): number {
  const z = dias + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  return yoe + era * 400 + (mp >= 10 ? 1 : 0);
}

function bits(lista: string | null, valores: readonly string[], desde = 0): number {
  let b = 0;
  for (const v of (lista ?? '').split(',')) {
    const i = valores.indexOf(v);
    if (i >= 0) b |= 1 << (i + desde);
  }
  return b;
}

const comprimirId = (id: string) => (UUID_RE.test(id) ? id.replace(/-/g, '').toLowerCase() : id);
const expandirId = (id: string) => (/^[0-9a-f]{32}$/.test(id)
  ? `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
  : id);
const limpiar = (texto: string) => texto.replaceAll(SEP, ' ');

/** Convierte las filas de D1 en el formato compacto. Separado de la lectura para probarlo sin base. */
export function compactarEdiciones(rows: readonly FilaIndice[]): DatosIndiceEdiciones {
  const dic = () => {
    const lista: string[] = [];
    const pos = new Map<string, number>();
    return {
      lista,
      de(v: string) {
        let i = pos.get(v);
        if (i === undefined) { i = lista.length; lista.push(limpiar(v)); pos.set(v, i); }
        return i;
      },
    };
  };
  const nombres = dic(); const ciudades = dic(); const temporadas = dic(); const fuentes = dic();
  const col = { id: [] as string[], n: [] as number[], c: [] as number[], t: [] as number[], f: [] as number[], p: [] as string[],
    i: [] as number[], d: [] as number[], k: [] as number[], a: [] as number[], g: [] as number[] };
  for (const r of rows) {
    // Una coma partiría la columna: un identificador así no se indexa (no es de esta base).
    const id = comprimirId(String(r.id));
    if (id.includes(',')) continue;
    const inicio = aDias(r.inicio);
    const fin = aDias(r.fin);
    col.id.push(id);
    col.n.push(nombres.de(String(r.nombre ?? '')));
    col.c.push(r.ciudad ? ciudades.de(r.ciudad) : -1);
    col.t.push(temporadas.de(String(r.temporada ?? '')));
    col.f.push(fuentes.de(String(r.fuente ?? '')));
    col.p.push((r.pais ?? '').replace(/,/g, ''));
    col.i.push(inicio);
    col.d.push(inicio >= 0 && fin >= inicio ? fin - inicio : -1);
    col.k.push(Number(r.pruebas ?? 0));
    col.a.push(bits(r.armas, ARMAS_INDICE) | bits(r.formatos, FORMATOS, 3) | bits(r.generos, GENEROS, 5));
    col.g.push(bits(r.categorias, CATEGORIAS_INDICE));
  }
  return {
    v: 2,
    nombres: nombres.lista.join(SEP), ciudades: ciudades.lista.join(SEP),
    temporadas: temporadas.lista.join(SEP), fuentes: fuentes.lista.join(SEP),
    id: col.id.join(','), n: col.n.join(','), c: col.c.join(','), t: col.t.join(','), f: col.f.join(','),
    p: col.p.join(','), i: col.i.join(','), d: col.d.join(','), k: col.k.join(','), a: col.a.join(','), g: col.g.join(','),
  };
}

/**
 * Lee todas las ediciones con el resumen de sus pruebas: una sentencia que
 * recorre `sport_edition` y `sport_competition` una vez (≈ 24.000 filas con
 * la base de 2026). Se llama una vez por versión de datos, nunca por tecla.
 */
export async function leerDatosIndiceEdiciones(ctx: ContextoExplorador): Promise<DatosIndiceEdiciones | null> {
  await exigirPerfil(ctx);
  if (!(await ctx.esquema()).identidad) return null;
  const rows = filas<FilaIndice>(await ctx.db.execute(sql`
    SELECT e.id AS id, e.name AS nombre, e.season AS temporada, e.source AS fuente,
      e.city AS ciudad, e.country_code AS pais, e.start_date AS inicio, e.end_date AS fin,
      count(c.id) AS pruebas,
      group_concat(DISTINCT c.weapon) AS armas,
      group_concat(DISTINCT c.format) AS formatos,
      group_concat(DISTINCT c.gender) AS generos,
      group_concat(DISTINCT c.category) AS categorias
    FROM sport_edition e
    LEFT JOIN sport_competition c ON c.edition_id = e.id
    GROUP BY e.id`));
  return compactarEdiciones(rows);
}

/* ------------------------------------------------------------ índice */

/** Términos de las armas, géneros y categorías de las pruebas de una edición. */
const TERMINOS_ARMA = ARMAS_INDICE.map((a) => [...terminosIndice(a)]);
const TERMINOS_GENERO = [['masculino'], ['femenino'], ['mixto']];
const TERMINOS_CATEGORIA = CATEGORIAS_INDICE.map((c) => [...new Set([c.toLowerCase(), ...terminosIndice(CATEGORY_LABEL[c])])]);

const NOMBRE_PAIS = new Map(PAISES.map((p) => [p.codigo, p]));

type Columnas = {
  nombres: string[];
  ciudades: string[];
  temporadas: string[];
  fuentes: string[];
  id: string[];
  p: string[];
  n: Int32Array; c: Int32Array; t: Int32Array; f: Int32Array;
  i: Int32Array; d: Int32Array; k: Int32Array; a: Int32Array; g: Int32Array;
};

export type IndiceEdiciones = {
  col: Columnas;
  total: number;
  /** Posiciones de las ediciones de la más reciente a la más antigua (sin fecha al final). */
  orden: Int32Array;
  terminosNombre: string[][];
  terminosCiudad: string[][];
  terminosPais: Map<string, string[]>;
  vocabulario: string[];
  series: (SerieComplementaria | null)[];
  /** Año de inicio y de fin (0 sin fecha). */
  anioInicio: Int16Array;
  anioFin: Int16Array;
};

const textos = (s: string) => s.split(SEP);
const numeros = (s: string) => Int32Array.from(s === '' ? [] : s.split(','), Number);

export function construirIndiceEdiciones(datos: DatosIndiceEdiciones): IndiceEdiciones {
  const ids = datos.id === '' ? [] : datos.id.split(',');
  const col: Columnas = {
    nombres: textos(datos.nombres), ciudades: textos(datos.ciudades),
    temporadas: textos(datos.temporadas), fuentes: textos(datos.fuentes),
    id: ids, p: ids.length ? datos.p.split(',') : [],
    n: numeros(datos.n), c: numeros(datos.c), t: numeros(datos.t), f: numeros(datos.f),
    i: numeros(datos.i), d: numeros(datos.d), k: numeros(datos.k), a: numeros(datos.a), g: numeros(datos.g),
  };
  const total = ids.length;
  const vocab = new Set<string>();
  const terminosNombre = col.nombres.map((nombre) => {
    const t = terminosIndice(nombre);
    anadirConceptos(t);
    t.forEach((x) => vocab.add(x));
    return [...t];
  });
  const terminosCiudad = col.ciudades.map((ciudad) => {
    const t = terminosIndice(ciudad);
    t.forEach((x) => vocab.add(x));
    return [...t];
  });
  const terminosPais = new Map<string, string[]>();
  for (const codigo of new Set(col.p)) {
    if (!codigo) continue;
    const pais = NOMBRE_PAIS.get(codigo.toUpperCase());
    const t = new Set<string>([codigo.toLowerCase()]);
    if (pais) for (const nombre of [pais.nombre, ...(pais.otros ?? [])]) terminosIndice(nombre).forEach((x) => t.add(x));
    t.forEach((x) => vocab.add(x));
    terminosPais.set(codigo, [...t]);
  }
  for (const grupo of [TERMINOS_ARMA, TERMINOS_GENERO, TERMINOS_CATEGORIA]) for (const ts of grupo) ts.forEach((x) => vocab.add(x));

  const anioInicio = new Int16Array(total);
  const anioFin = new Int16Array(total);
  for (let e = 0; e < total; e++) {
    const ini = col.i[e]!;
    if (ini < 0) continue;
    anioInicio[e] = anioDeDias(ini);
    anioFin[e] = anioDeDias(ini + Math.max(0, col.d[e]!));
  }
  const orden = Int32Array.from({ length: total }, (_, e) => e).sort((x, y) =>
    (col.i[y]! - col.i[x]!) || (ids[y]! < ids[x]! ? -1 : ids[y]! > ids[x]! ? 1 : 0));
  return {
    col,
    total,
    orden,
    terminosNombre,
    terminosCiudad,
    terminosPais,
    vocabulario: [...vocab],
    series: col.nombres.map((nombre) => clasificarSerie({ nombre })),
    anioInicio,
    anioFin,
  };
}

export type FiltrosIndice = {
  q: string;
  fuente?: string;
  temporada?: string;
  arma?: string;
  categoria?: string;
  /** Años (AAAA): la edición tiene que tocar ese intervalo. */
  desde?: string;
  hasta?: string;
};

type Casada = {
  nombre: Uint8Array;
  ciudad: Uint8Array;
  pais: Map<string, number>;
  /** Calidad por bit de arma, género y categoría. */
  arma: number[];
  genero: number[];
  categoria: number[];
  anio: number | null;
};

function mejor(terminos: readonly string[], casados: Map<string, number>): number {
  let m = 0;
  for (const t of terminos) {
    const v = casados.get(t);
    if (v !== undefined && v > m) m = v;
  }
  return m;
}

function casar(indice: IndiceEdiciones, palabra: PalabraConsulta): Casada {
  const casados = casarPalabra(palabra, indice.vocabulario);
  const anio = /^(19|20)\d{2}$/.test(palabra.cruda) ? Number(palabra.cruda) : null;
  return {
    nombre: Uint8Array.from(indice.terminosNombre, (ts) => mejor(ts, casados)),
    ciudad: Uint8Array.from(indice.terminosCiudad, (ts) => mejor(ts, casados)),
    pais: new Map([...indice.terminosPais].map(([codigo, ts]) => [codigo, mejor(ts, casados)])),
    arma: TERMINOS_ARMA.map((ts) => mejor(ts, casados)),
    genero: TERMINOS_GENERO.map((ts) => mejor(ts, casados)),
    categoria: TERMINOS_CATEGORIA.map((ts) => mejor(ts, casados)),
    anio,
  };
}

function calidadEn(indice: IndiceEdiciones, c: Casada, e: number): number {
  const d = indice.col;
  let q = c.nombre[d.n[e]!]!;
  const ciudad = d.c[e]!;
  if (ciudad >= 0 && c.ciudad[ciudad]! > q) q = c.ciudad[ciudad]!;
  const pais = d.p[e] ? (c.pais.get(d.p[e]!) ?? 0) : 0;
  if (pais > q) q = pais;
  if (q === 3) return q;
  const a = d.a[e]!;
  for (let b = 0; b < 3; b++) {
    if (a & (1 << b) && c.arma[b]! > q) q = c.arma[b]!;
    if (a & (1 << (b + 5)) && c.genero[b]! > q) q = c.genero[b]!;
  }
  const g = d.g[e]!;
  for (let b = 0; b < c.categoria.length; b++) if (g & (1 << b) && c.categoria[b]! > q) q = c.categoria[b]!;
  if (c.anio !== null && q < 3) {
    const temporada = d.temporadas[d.t[e]!] ?? '';
    if (indice.anioInicio[e] === c.anio || temporada.split('-').includes(String(c.anio))) q = 3;
  }
  return q;
}

export type ResultadoIndice = { posiciones: number[]; pruebas: number };

/**
 * Ediciones que cumplen los filtros y casan con todas las palabras de `q`
 * (cada una en el nombre, la ciudad, el país, las armas, los géneros, las
 * categorías o el año). Orden: primero las que casan todas exactas, luego con
 * algún prefijo y luego con alguna errata; dentro de cada grupo, de la más
 * reciente a la más antigua.
 */
export function buscarEnIndice(indice: IndiceEdiciones, filtros: FiltrosIndice): ResultadoIndice {
  const d = indice.col;
  const palabras = palabrasConsulta(filtros.q).slice(0, 8);
  const casadas = palabras.map((p) => casar(indice, p));
  const fuente = filtros.fuente ? d.fuentes.indexOf(filtros.fuente) : -2;
  const temporada = filtros.temporada ? d.temporadas.indexOf(filtros.temporada) : -2;
  const arma = filtros.arma ? ARMAS_INDICE.indexOf(filtros.arma as Arma) : -2;
  const categoria = filtros.categoria ? CATEGORIAS_INDICE.indexOf(filtros.categoria as keyof typeof CATEGORY_LABEL) : -2;
  const desde = filtros.desde ? Number(filtros.desde) : 0;
  const hasta = filtros.hasta ? Number(filtros.hasta) : 0;
  if (fuente === -1 || temporada === -1 || arma === -1 || categoria === -1) return { posiciones: [], pruebas: 0 };

  const grupos: number[][] = [[], [], []];
  let pruebas = 0;
  for (const e of indice.orden) {
    if (fuente >= 0 && d.f[e] !== fuente) continue;
    if (temporada >= 0 && d.t[e] !== temporada) continue;
    if (arma >= 0 && !(d.a[e]! & (1 << arma))) continue;
    if (categoria >= 0 && !(d.g[e]! & (1 << categoria))) continue;
    if ((desde || hasta) && (indice.anioInicio[e] === 0
      || (desde && indice.anioFin[e]! < desde) || (hasta && indice.anioInicio[e]! > hasta))) continue;
    let peor = 3;
    for (const c of casadas) {
      const q = calidadEn(indice, c, e);
      if (q < peor) peor = q;
      if (peor === 0) break;
    }
    if (peor === 0) continue;
    grupos[3 - peor]!.push(e);
    pruebas += d.k[e]!;
  }
  return { posiciones: grupos.flat(), pruebas };
}

export function resumenDeIndice(indice: IndiceEdiciones, e: number): EdicionResumen {
  const d = indice.col;
  const a = d.a[e]!;
  return {
    id: expandirId(d.id[e]!),
    nombre: d.nombres[d.n[e]!] ?? '',
    temporada: d.temporadas[d.t[e]!] ?? '',
    fuente: d.fuentes[d.f[e]!] ?? '',
    ciudad: d.c[e]! >= 0 ? (d.ciudades[d.c[e]!] ?? null) : null,
    pais: d.p[e] || null,
    inicio: deDias(d.i[e]!),
    fin: d.d[e]! >= 0 ? deDias(d.i[e]! + d.d[e]!) : null,
    pruebas: d.k[e]!,
    armas: ARMAS_INDICE.filter((_, b) => a & (1 << b)).sort() as Arma[],
    formatos: FORMATOS.filter((_, b) => a & (1 << (b + 3))).sort() as Formato[],
    serie: indice.series[d.n[e]!] ?? null,
  };
}
