import { sql } from 'drizzle-orm';
import { clasificarSerie, type SerieComplementaria } from '@/lib/ingest/series-complementarias';
import { CATEGORY_LABEL } from '@/lib/utils';
import { ORDEN_ARMA, ordenCategoria } from '@/lib/sport/rotulos';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { FECHA_RE, UUID_RE } from './cursor';
import { agruparEdiciones, type EdicionResumen } from './edicion-modelo';
import { PAISES } from './paises';
import type { Arma, Formato, Genero } from './tipos';
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
export const FORMATOS_INDICE = ['INDIVIDUAL', 'EQUIPOS'] as const;
export const GENEROS_INDICE = ['M', 'F', 'MIXTO'] as const;
const FORMATOS = FORMATOS_INDICE;
const GENEROS = GENEROS_INDICE;
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
  v: 4;
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
  /** Evento de cada edición (`agruparEdiciones`): número de grupo. */
  r: string;
};

type FilaIndice = {
  /** Torneo canónico del calendario, si la edición está vinculada. */
  evento?: string | null;
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
  const agrupables: Parameters<typeof agruparEdiciones>[0][number][] = [];
  for (const r of rows) {
    // Una coma partiría la columna: un identificador así no se indexa (no es de esta base).
    const id = comprimirId(String(r.id));
    if (id.includes(',')) continue;
    const inicio = aDias(r.inicio);
    const fin = aDias(r.fin);
    agrupables.push({
      fuente: String(r.fuente ?? ''), temporada: String(r.temporada ?? ''), nombre: String(r.nombre ?? ''),
      ciudad: r.ciudad, pais: r.pais, inicio, fin, evento: r.evento ?? null,
      categorias: (r.categorias ?? '').split(',').filter(Boolean),
    });
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
    v: 4,
    nombres: nombres.lista.join(SEP), ciudades: ciudades.lista.join(SEP),
    temporadas: temporadas.lista.join(SEP), fuentes: fuentes.lista.join(SEP),
    id: col.id.join(','), n: col.n.join(','), c: col.c.join(','), t: col.t.join(','), f: col.f.join(','),
    p: col.p.join(','), i: col.i.join(','), d: col.d.join(','), k: col.k.join(','), a: col.a.join(','), g: col.g.join(','),
    r: agruparEdiciones(agrupables).join(','),
  };
}

/**
 * Lee todas las ediciones con el resumen de sus pruebas: una sentencia que
 * recorre `sport_edition` y `sport_competition` una vez (≈ 24.000 filas con
 * la base de 2026), más el torneo del calendario de las vinculadas (una
 * búsqueda por clave primaria cada una). Se llama una vez por versión de
 * datos, nunca por tecla.
 */
export async function leerDatosIndiceEdiciones(ctx: ContextoExplorador): Promise<DatosIndiceEdiciones | null> {
  await exigirPerfil(ctx);
  if (!(await ctx.esquema()).identidad) return null;
  const rows = filas<FilaIndice>(await ctx.db.execute(sql`
    SELECT e.id AS id, e.name AS nombre, e.season AS temporada, e.source AS fuente,
      e.city AS ciudad, e.country_code AS pais, e.start_date AS inicio, e.end_date AS fin,
      coalesce(ev.canonical_event_id, e.event_id) AS evento,
      count(c.id) AS pruebas,
      group_concat(DISTINCT c.weapon) AS armas,
      group_concat(DISTINCT c.format) AS formatos,
      group_concat(DISTINCT c.gender) AS generos,
      group_concat(DISTINCT c.category) AS categorias
    FROM sport_edition e
    LEFT JOIN event ev ON ev.id = e.event_id
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
  i: Int32Array; d: Int32Array; k: Int32Array; a: Int32Array; g: Int32Array; r: Int32Array;
};

export type IndiceEdiciones = {
  col: Columnas;
  total: number;
  /** Eventos (grupos de `col.r`). Las ediciones del grupo `g` son `miembros[miembrosDesde[g] .. miembrosDesde[g + 1])`. */
  grupos: number;
  miembrosDesde: Int32Array;
  miembros: Int32Array;
  /** Cuál de las ediciones de un evento abre su fila sin preferencias (menor primero). */
  rango: Int32Array;
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

/** Bit de cada arma en `a`, en el orden de presentación (florete, espada, sable). */
const BIT_ARMA_ORDENADO = ORDEN_ARMA.map((arma) => ARMAS_INDICE.indexOf(arma));
const ORDEN_BIT_CATEGORIA = CATEGORIAS_INDICE.map((c) => Math.min(ordenCategoria(c), 255));

/**
 * Qué edición de un evento abre su fila: individual antes que equipos, luego
 * el arma, el género y la categoría en el orden de los rótulos.
 */
function rangoEdicion(a: number, g: number): number {
  const individual = a & (1 << 3) ? 0 : 1;
  let arma = 3;
  for (let x = 0; x < BIT_ARMA_ORDENADO.length; x++) if (a & (1 << BIT_ARMA_ORDENADO[x]!)) { arma = x; break; }
  let genero = 3;
  for (let b = 0; b < 3; b++) if (a & (1 << (b + 5))) { genero = b; break; }
  let categoria = 255;
  for (let b = 0; b < ORDEN_BIT_CATEGORIA.length; b++) {
    if (g & (1 << b) && ORDEN_BIT_CATEGORIA[b]! < categoria) categoria = ORDEN_BIT_CATEGORIA[b]!;
  }
  return (individual << 16) | (arma << 12) | (genero << 8) | categoria;
}

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
    r: numeros(datos.r ?? ''),
  };
  const total = ids.length;
  // Sin la columna (datos de otra versión) cada edición es su propio evento.
  if (col.r.length !== total) col.r = Int32Array.from({ length: total }, (_, e) => e);
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

  let grupos = 0;
  for (let e = 0; e < total; e++) if (col.r[e]! >= grupos) grupos = col.r[e]! + 1;
  const miembrosDesde = new Int32Array(grupos + 1);
  for (let e = 0; e < total; e++) miembrosDesde[col.r[e]! + 1]!++;
  for (let g = 0; g < grupos; g++) miembrosDesde[g + 1]! += miembrosDesde[g]!;
  const miembros = new Int32Array(total);
  const lleno = miembrosDesde.slice(0, grupos);
  // Del más antiguo al más reciente: `orden` va al revés.
  for (let x = total - 1; x >= 0; x--) {
    const e = orden[x]!;
    miembros[lleno[col.r[e]!]!++] = e;
  }
  const rango = Int32Array.from({ length: total }, (_, e) => rangoEdicion(col.a[e]!, col.g[e]!));

  return {
    col,
    total,
    grupos,
    miembrosDesde,
    miembros,
    rango,
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
  genero?: string;
  formato?: string;
  /** Años (AAAA): la edición tiene que tocar ese intervalo. */
  desde?: string;
  hasta?: string;
  /**
   * Armas de quien busca: la fila de un evento abre, si puede, una edición de
   * una de ellas. No filtra ni cambia el orden.
   */
  armasPreferidas?: readonly string[];
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

export type ResultadoIndice = {
  /** Una posición por evento: la edición que abre su fila. */
  posiciones: number[];
  /** Pruebas de las ediciones que casan. */
  pruebas: number;
};

/**
 * Eventos con alguna edición que cumple los filtros y casa con todas las
 * palabras de `q` (cada una en el nombre, la ciudad, el país, las armas, los
 * géneros, las categorías o el año). Un evento sale una vez (ver
 * `agruparEdiciones`), en el puesto de su mejor edición: primero las que casan
 * todas exactas, luego con algún prefijo y luego con alguna errata; dentro de
 * cada grupo, de la más reciente a la más antigua. La edición que abre la fila
 * es, entre las que casan, la de un arma preferida o la primera por `rango`.
 */
export function buscarEnIndice(indice: IndiceEdiciones, filtros: FiltrosIndice): ResultadoIndice {
  const d = indice.col;
  const palabras = palabrasConsulta(filtros.q).slice(0, 8);
  const casadas = palabras.map((p) => casar(indice, p));
  const fuente = filtros.fuente ? d.fuentes.indexOf(filtros.fuente) : -2;
  const temporada = filtros.temporada ? d.temporadas.indexOf(filtros.temporada) : -2;
  const arma = filtros.arma ? ARMAS_INDICE.indexOf(filtros.arma as Arma) : -2;
  const categoria = filtros.categoria ? CATEGORIAS_INDICE.indexOf(filtros.categoria as keyof typeof CATEGORY_LABEL) : -2;
  const genero = filtros.genero ? GENEROS.indexOf(filtros.genero as Genero) : -2;
  const formato = filtros.formato ? FORMATOS.indexOf(filtros.formato as Formato) : -2;
  const desde = filtros.desde ? Number(filtros.desde) : 0;
  const hasta = filtros.hasta ? Number(filtros.hasta) : 0;
  if (fuente === -1 || temporada === -1 || arma === -1 || categoria === -1 || genero === -1 || formato === -1) {
    return { posiciones: [], pruebas: 0 };
  }
  let preferidas = 0;
  for (const a of filtros.armasPreferidas ?? []) {
    const b = ARMAS_INDICE.indexOf(a as Arma);
    if (b >= 0) preferidas |= 1 << b;
  }

  const grupos: number[][] = [[], [], []];
  let pruebas = 0;
  for (const e of indice.orden) {
    if (fuente >= 0 && d.f[e] !== fuente) continue;
    if (temporada >= 0 && d.t[e] !== temporada) continue;
    if (arma >= 0 && !(d.a[e]! & (1 << arma))) continue;
    if (genero >= 0 && !(d.a[e]! & (1 << (genero + 5)))) continue;
    if (formato >= 0 && !(d.a[e]! & (1 << (formato + 3)))) continue;
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

  const puesto = (e: number) => (preferidas && !(d.a[e]! & preferidas) ? 1 << 20 : 0) + indice.rango[e]!;
  const elegida = new Int32Array(indice.grupos).fill(-1);
  const eventos: number[] = [];
  for (const lista of grupos) {
    for (const e of lista) {
      const g = d.r[e]!;
      const actual = elegida[g]!;
      if (actual < 0) {
        elegida[g] = e;
        eventos.push(g);
      } else if (puesto(e) < puesto(actual)) {
        elegida[g] = e;
      }
    }
  }
  return { posiciones: eventos.map((g) => elegida[g]!), pruebas };
}

/** Las ediciones del evento de `e`, de la más antigua a la más reciente. */
export function edicionesDelEvento(indice: IndiceEdiciones, e: number): Int32Array {
  const g = indice.col.r[e]!;
  return indice.miembros.subarray(indice.miembrosDesde[g]!, indice.miembrosDesde[g + 1]!);
}

/**
 * La fila de `e` en el buscador: nombre, sede y temporada de esa edición, y
 * fechas, armas, formatos, géneros y pruebas de todo su evento.
 */
export function resumenDeIndice(indice: IndiceEdiciones, e: number): EdicionResumen {
  const d = indice.col;
  const miembros = edicionesDelEvento(indice, e);
  let a = 0;
  let pruebas = 0;
  let inicio = -1;
  let fin = -1;
  let conFin = false;
  for (const m of miembros) {
    a |= d.a[m]!;
    pruebas += d.k[m]!;
    const ini = d.i[m]!;
    if (ini < 0) continue;
    if (inicio < 0 || ini < inicio) inicio = ini;
    if (d.d[m]! >= 0) conFin = true;
    fin = Math.max(fin, ini + Math.max(0, d.d[m]!));
  }
  if (!conFin && fin <= inicio) fin = -1;
  return {
    id: expandirId(d.id[e]!),
    nombre: d.nombres[d.n[e]!] ?? '',
    temporada: d.temporadas[d.t[e]!] ?? '',
    fuente: d.fuentes[d.f[e]!] ?? '',
    ciudad: d.c[e]! >= 0 ? (d.ciudades[d.c[e]!] ?? null) : null,
    pais: d.p[e] || null,
    inicio: deDias(inicio),
    fin: fin >= 0 ? deDias(fin) : null,
    pruebas,
    armas: ARMAS_INDICE.filter((_, b) => a & (1 << b)).sort() as Arma[],
    formatos: FORMATOS.filter((_, b) => a & (1 << (b + 3))).sort() as Formato[],
    generos: GENEROS.filter((_, b) => a & (1 << (b + 5))) as Genero[],
    serie: indice.series[d.n[e]!] ?? null,
    ediciones: miembros.length,
  };
}
