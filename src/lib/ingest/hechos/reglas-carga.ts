/**
 * Reglas puras del cargador de hechos: cuándo una lectura sustituye, se funde o se
 * descarta frente a lo guardado, firmas de asalto y estados de cobertura. Las comparten
 * el cargador del lote manual (`scripts/indexado/cargar-hechos.ts`, SQLite síncrono) y el
 * de la ingesta automática (`src/lib/ingest/resultados-auto/cargar.ts`, D1 asíncrono),
 * para que los dos escriban exactamente lo mismo.
 */
import { createHash } from 'node:crypto';
import { palabrasNombre } from '@/lib/nombres';
import type { HechosPrueba } from './formato';

export type Seccion = 'results' | 'pools' | 'tableau';
export const SECCIONES: readonly Seccion[] = ['results', 'pools', 'tableau'];
export type Estado = HechosPrueba['status']['results'];
export type Modo = 'nuevo' | 'reemplazo' | 'fusion' | 'deduplicado' | 'conservado' | 'vacio';

export function sha256Texto(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

/** JSON con claves ordenadas: el mismo hecho produce siempre el mismo hash. */
export function jsonCanonico(valor: unknown): string {
  if (valor === undefined) return 'null';
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(obj[k])}`)
    .join(',')}}`;
}

/** Igual que `normalizeSportName` de `src/lib/identity/resolver.ts`: palabras sin acentos, ordenadas. */
export function normalizarNombre(nombre: string): string {
  return palabrasNombre(nombre).sort().join(' ');
}

/** `content_hash` de un puesto o asalto, igual en los dos cargadores. */
export function hashHecho(source: string, competitionKey: string, fact: unknown): string {
  return sha256Texto(jsonCanonico({ source, competitionKey, fact }));
}

/** Mismo asalto aunque cambien referencias, ronda u orden: nombres normalizados y tocados. */
export function firmaAsalto(nombreA: string, tocadosA: number, nombreB: string, tocadosB: number): string {
  return [`${normalizarNombre(nombreA)}:${tocadosA}`, `${normalizarNombre(nombreB)}:${tocadosB}`].sort().join('|');
}

/** Mismo nombre con las palabras en otro orden o recortado por la columna («LETE MUÑOZ-REPISO» de «LETE MUÑOZ-REPISO Mateo»). */
export function nombresCompatibles(x: string, y: string): boolean {
  if (normalizarNombre(x) === normalizarNombre(y)) return true;
  const a = palabrasNombre(x).join('').toLowerCase();
  const b = palabrasNombre(y).join('').toLowerCase();
  return a.length >= 6 && b.length >= 6 && (a.startsWith(b) || b.startsWith(a));
}

/**
 * El mismo asalto de poule leído por otro extractor: nombres compatibles y el mismo par de
 * tocados, aunque las lecturas discrepen en quién ganó. La nueva lectura sustituye a la otra.
 */
export function mismoAsaltoOtraLectura(
  p: { fencer_a_name: string; fencer_b_name: string; score_a: number; score_b: number },
  b: { aName: string; bName: string; scoreA: number; scoreB: number },
): boolean {
  if (Math.min(p.score_a, p.score_b) !== Math.min(b.scoreA, b.scoreB) || Math.max(p.score_a, p.score_b) !== Math.max(b.scoreA, b.scoreB)) {
    return false;
  }
  return (nombresCompatibles(p.fencer_a_name, b.aName) && nombresCompatibles(p.fencer_b_name, b.bName)) ||
    (nombresCompatibles(p.fencer_a_name, b.bName) && nombresCompatibles(p.fencer_b_name, b.aName));
}

/**
 * Ámbito en el que un mismo emparejamiento con el mismo marcador sólo puede aparecer una vez.
 * Con dos vueltas de poules (P*, V2P*) la misma pareja puede repetir 5-0 legítimamente,
 * así que en POULE cuenta la ronda. En TABLEAU no: el formato antiguo nombra las rondas
 * A64..A2 y el nuevo T64..T2, y una pareja no se cruza dos veces en el mismo cuadro.
 */
export function ambitoFirma(fase: string, ronda: string): string {
  return fase === 'POULE' ? `POULE:${ronda}` : fase;
}

type AsaltoRonda = { roundKey: string; aName: string; bName: string; scoreA: number; scoreB: number };

/**
 * El lector de PDF a veces emite el mismo asalto de cuadro en dos rondas (A4 y A2).
 * Se queda la copia de la ronda más grande (la anterior) salvo que alguno de los dos
 * tiradores ya tenga otro asalto en esa ronda: nadie tira dos veces en la misma
 * ronda, así que entonces la copia buena es la de la ronda siguiente.
 * Devuelve los asaltos que sobran.
 */
export function repetidosEntreRondas<T extends AsaltoRonda>(asaltos: readonly T[]): T[] {
  const tamano = (r: string) => {
    const m = /(\d+)$/.exec(r);
    return m ? Number(m[1]) : null;
  };
  const tiradoresPorRonda = new Map<string, Map<string, number>>();
  const grupos = new Map<string, T[]>();
  for (const b of asaltos) {
    const t = tiradoresPorRonda.get(b.roundKey) ?? new Map<string, number>();
    for (const n of [normalizarNombre(b.aName), normalizarNombre(b.bName)]) t.set(n, (t.get(n) ?? 0) + 1);
    tiradoresPorRonda.set(b.roundKey, t);
    if (tamano(b.roundKey) === null) continue;
    const f = firmaAsalto(b.aName, b.scoreA, b.bName, b.scoreB);
    (grupos.get(f) ?? grupos.set(f, []).get(f)!).push(b);
  }
  const sobran: T[] = [];
  for (const grupo of grupos.values()) {
    if (new Set(grupo.map((b) => b.roundKey)).size < 2) continue;
    const orden = [...grupo].sort((x, y) => tamano(y.roundKey)! - tamano(x.roundKey)! || (x.roundKey < y.roundKey ? -1 : 1));
    const posible = (b: T) => {
      const t = tiradoresPorRonda.get(b.roundKey)!;
      return [b.aName, b.bName].every((n) => (t.get(normalizarNombre(n)) ?? 0) <= 1);
    };
    const queda = orden.find(posible) ?? orden[0];
    for (const b of orden) if (b !== queda) sobran.push(b);
  }
  return sobran;
}

/** Fuentes cuyas claves de prueba no cambian entre extracciones: nunca se busca la prueba por atributos. */
export const CLAVES_FIJAS: ReadonlySet<HechosPrueba['source']> = new Set(['fie', 'engarde', 'efc']);

const CLAVE_ESTABLE = /^(\d+|team:.+|lic:.+)$/;

export function clavesEstables(claves: Iterable<string>): boolean {
  for (const k of claves) if (!CLAVE_ESTABLE.test(k)) return false;
  return true;
}

/** «30.000» y «30» son el mismo dato: reescribirlo sólo generaría revisiones vacías. */
export function mismosPuntos(previo: string | null, nuevo: string | null): boolean {
  return previo !== null && nuevo !== null && Number(previo) === Number(nuevo);
}

export function estadoCobertura(e: Estado): string {
  return e === 'ilegible' ? 'error' : e;
}

const RANGO_COBERTURA: Record<string, number> = { completo: 3, parcial: 2, sin_resultados: 1 };
export function mejorEstado(a: string | null, b: string): string {
  if (a === null) return b;
  return (RANGO_COBERTURA[b] ?? 0) > (RANGO_COBERTURA[a] ?? 0) ? b : a;
}

/**
 * Estado del documento a partir del estado `results` de cada prueba de su edición (null: la
 * prueba no tiene cobertura todavía): completo si todas lo están, sin_resultados si ninguna
 * tiene resultados, y si no parcial.
 */
export function estadosDocumento(estados: readonly (string | null)[]): string {
  if (estados.length > 0 && estados.every((e) => e === 'completo')) return 'completo';
  if (estados.length > 0 && estados.every((e) => e === 'sin_resultados')) return 'sin_resultados';
  return 'parcial';
}

/** Las filas guardadas son una sola lectura: un estilo de ronda (A* o T*) y un estilo de referencia. */
export function lecturaUnica(filas: readonly { round_key: string; fencer_a_ref: string; fencer_b_ref: string }[]): boolean {
  const rondas = new Set(filas.map((f) => f.round_key[0]));
  const refs = new Set(filas.flatMap((f) => [f.fencer_a_ref, f.fencer_b_ref]).map((r) => r.includes(':pdfd:')));
  return rondas.size <= 1 && refs.size <= 1;
}

export function decidirModo(estado: Estado, existentes: number, nuevas: number, estables: boolean): Modo {
  if (nuevas === 0) return 'vacio';
  if (existentes === 0) return 'nuevo';
  if (estado === 'completo' && nuevas >= existentes) return 'reemplazo';
  return estables ? 'fusion' : 'conservado';
}

/** Estado de cobertura que deja una sección según el modo con el que se aplicó. */
export function estadoTrasModo(modo: Modo, declarado: Estado, previo: string | null): string {
  const nuevo = estadoCobertura(declarado);
  if (modo === 'nuevo' || modo === 'reemplazo') return nuevo;
  if (modo === 'fusion' || modo === 'deduplicado') return mejorEstado(previo, nuevo);
  if (previo !== null) return previo;
  return modo === 'vacio' && declarado === 'sin_resultados' ? 'sin_resultados' : 'parcial';
}

export function filasSeccion(h: HechosPrueba, s: Seccion): number {
  if (s === 'results') return h.results.length;
  const fase = s === 'pools' ? 'POULE' : 'TABLEAU';
  return h.bouts.filter((b) => b.phase === fase).length;
}
