import type { SerieComplementaria } from '@/lib/ingest/series-complementarias';
import type { Arma, CategoriaPublicada, Formato, Genero } from './tipos';

/**
 * Modelo de las páginas de edición: qué se sabe de los resultados de una
 * prueba y qué enlaces se pueden ofrecer. Todo es puro y sin base de datos.
 *
 * Reglas que mandan sobre este fichero:
 *  - «Importado» es lo que hay en `sport_result`; el estado de la lectura viene
 *    de la cobertura. Ausencia de filas NO es «sin resultados»: sólo la fuente
 *    que respondió vacío lo es.
 *  - Un enlace se ofrece sólo si su estado lo permite y su URL es específica del
 *    proveedor (nunca una portada). Fencing Time Live requiere cuenta: su
 *    enlace sigue el torneo y no implica resultados importados.
 */

export type EstadoResultados =
  | 'completo'
  | 'parcial'
  | 'sin_resultados'
  | 'pendiente'
  | 'error'
  | 'conflicto';

/**
 * Estado de los puestos finales de una prueba a partir de las filas importadas
 * y de la cobertura `results` de cada fuente. «Completo» exige filas y que
 * ninguna lectura esté parcial, en error o en conflicto.
 */
export function estadoResultados(
  importados: number,
  lecturas: readonly { estado: string }[],
): EstadoResultados {
  const estados = new Set(lecturas.map((l) => l.estado));
  if (importados > 0) {
    const limpio = !estados.has('parcial') && !estados.has('error') && !estados.has('conflicto');
    return estados.has('completo') && limpio ? 'completo' : 'parcial';
  }
  if (estados.has('conflicto')) return 'conflicto';
  if (estados.has('error')) return 'error';
  if (estados.has('sin_resultados')) return 'sin_resultados';
  return 'pendiente';
}

/** Fuente de la FIE en `sport_import_coverage`. */
export const FUENTE_FIE = 'fie';

/**
 * Las lecturas de cobertura que hablan de los puestos finales de una prueba.
 * El resto de fuentes (Skermo, Engarde, PDF) los guardan como `results`; la FIE
 * los guarda como `ranking` porque su API de resultados es un ranking de la
 * prueba. Poules y cuadro (`pools`/`tableau`) nunca cierran la clasificación,
 * ni un `ranking` de otra fuente: el ranking oficial por temporada no es de una prueba.
 */
export function lecturasDePuestos<T extends { hecho: string; fuente: string }>(lecturas: readonly T[]): T[] {
  return lecturas.filter(
    (l) => l.hecho === 'results' || (l.hecho === 'ranking' && l.fuente === FUENTE_FIE),
  );
}

export const TEXTO_ESTADO_RESULTADOS: Record<EstadoResultados, { titulo: string; ayuda: string }> = {
  completo: {
    titulo: 'Clasificación importada',
    ayuda: 'La fuente se leyó entera para esta prueba.',
  },
  parcial: {
    titulo: 'Clasificación parcial',
    ayuda: 'Hay puestos importados, pero la lectura no está confirmada como completa: pueden faltar filas.',
  },
  sin_resultados: {
    titulo: 'Sin resultados publicados',
    ayuda: 'La fuente respondió sin clasificación para esta prueba.',
  },
  pendiente: {
    titulo: 'Pendiente de importar',
    ayuda: 'Todavía no se ha leído: no hay datos, pero tampoco ausencia.',
  },
  error: {
    titulo: 'Error al leer',
    ayuda: 'La lectura falló, así que no se sabe si hay resultados.',
  },
  conflicto: {
    titulo: 'Datos en conflicto',
    ayuda: 'Las fuentes se contradicen y está pendiente de revisión.',
  },
};

export type ProveedorEnlace = 'engarde' | 'fww' | 'ftl';

export const ETIQUETA_PROVEEDOR: Record<ProveedorEnlace, string> = {
  engarde: 'Engarde',
  fww: 'Fencing Worldwide',
  ftl: 'Fencing Time Live',
};

export type MotivoSinEnlace = 'no_publicado' | 'en_revision' | 'error' | 'no_comprobable';

export type EnlaceDto =
  | { proveedor: ProveedorEnlace; tipo: 'verificado'; url: string }
  /** Enlace específico que sigue el torneo; no implica resultados importados. */
  | { proveedor: ProveedorEnlace; tipo: 'solo_enlace'; url: string }
  | { proveedor: ProveedorEnlace; tipo: 'sin_enlace'; motivo: MotivoSinEnlace };

const GUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SEGMENTO_ENGARDE = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * URL de resultados que se puede ofrecer, o `null`. Es específica del
 * proveedor (prueba o torneo concretos): una portada, otro host o un esquema
 * distinto de web no se ofrecen. Se descartan fragmento y parámetros.
 */
export function urlResultadosSegura(proveedor: ProveedorEnlace, entrada: string | null): string | null {
  if (!entrada) return null;
  let u: URL;
  try {
    u = new URL(entrada.trim());
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const tramos = u.pathname.split('/').filter(Boolean);
  const limpia = `${u.protocol}//${u.hostname}${u.pathname}`;

  switch (proveedor) {
    case 'engarde': {
      if (host !== 'engarde-service.com') return null;
      const [tipo, ...resto] = tramos;
      const ok =
        (tipo === 'competition' && resto.length >= 3 && resto.slice(0, 3).every((t) => SEGMENTO_ENGARDE.test(t))) ||
        (tipo === 'tournament' && resto.length >= 2 && resto.slice(0, 2).every((t) => SEGMENTO_ENGARDE.test(t)));
      return ok ? limpia : null;
    }
    case 'fww':
      if (host !== 'fencingworldwide.com') return null;
      return /^\/[a-z]{2}\/\d+-\d{4}(\/|$)/i.test(u.pathname) ? limpia : null;
    case 'ftl': {
      if (host !== 'fencingtimelive.com') return null;
      const [a, b, c] = tramos;
      const ok =
        c !== undefined &&
        GUID.test(c) &&
        ((a === 'tournaments' && b === 'eventSchedule') ||
          (a === 'events' && b === 'results') ||
          ((a === 'pools' || a === 'tableaus') && b === 'scores'));
      return ok ? limpia : null;
    }
  }
}

export type FilaEnlace = {
  /** `enlace:engarde`, `enlace:fww` o `enlace:ftl`. */
  fuente: string;
  /** Estado exacto del enlace, guardado en el cursor de la cobertura. */
  cursor: string | null;
  url: string | null;
};

const PROVEEDORES: readonly ProveedorEnlace[] = ['engarde', 'fww', 'ftl'];

/**
 * Enlace presentable de una fila de cobertura `link`. `null` si la fila no es
 * de un proveedor conocido. Sólo `verificado` y `solo_enlace` con URL segura
 * ofrecen un enlace; cualquier otro estado (no publicado, revisión, error,
 * rechazado, referencia) explica por qué no hay y nunca fabrica uno.
 */
export function enlaceDeCobertura(fila: FilaEnlace): EnlaceDto | null {
  const proveedor = PROVEEDORES.find((p) => fila.fuente === `enlace:${p}`);
  if (!proveedor) return null;
  const url = urlResultadosSegura(proveedor, fila.url);
  if (fila.cursor === 'verificado' && url) return { proveedor, tipo: 'verificado', url };
  if (fila.cursor === 'solo_enlace' && url) return { proveedor, tipo: 'solo_enlace', url };
  if (fila.cursor === 'error') return { proveedor, tipo: 'sin_enlace', motivo: 'error' };
  if (fila.cursor === 'revision' || fila.cursor === 'rechazado') {
    return { proveedor, tipo: 'sin_enlace', motivo: 'en_revision' };
  }
  if (fila.cursor === 'no_publicado' || fila.cursor === 'solo_referencia') {
    return { proveedor, tipo: 'sin_enlace', motivo: 'no_publicado' };
  }
  // Estado de enlace sin URL específica comprobable: no se ofrece nada.
  return { proveedor, tipo: 'sin_enlace', motivo: 'no_comprobable' };
}

/** Un enlace por proveedor, en orden estable, a partir de las filas de cobertura. */
export function enlacesDePrueba(filas: readonly FilaEnlace[]): EnlaceDto[] {
  const porProveedor = new Map<ProveedorEnlace, EnlaceDto>();
  for (const fila of filas) {
    const enlace = enlaceDeCobertura(fila);
    if (enlace) porProveedor.set(enlace.proveedor, enlace);
  }
  return PROVEEDORES.flatMap((p) => {
    const e = porProveedor.get(p);
    return e ? [e] : [];
  });
}

export const TEXTO_SIN_ENLACE: Record<MotivoSinEnlace, string> = {
  no_publicado: 'sin enlace publicado',
  en_revision: 'enlace en revisión, no se ofrece',
  error: 'no se pudo comprobar el enlace',
  no_comprobable: 'enlace no comprobable, no se ofrece',
};

/* ------------------------------------------------------------------ DTO */

export type PruebaDeEdicion = {
  id: string;
  arma: Arma;
  genero: Genero;
  categoria: CategoriaPublicada;
  formato: Formato;
  fecha: string | null;
  fuente: string;
  /** Prueba del calendario equivalente, si se vinculó. */
  pruebaCalendarioId: string | null;
  resultados: { estado: EstadoResultados; importados: number };
  enlaces: EnlaceDto[];
  /** Asaltos importados (poules y directas) de la prueba; sin el dato se toma 0. */
  asaltos?: number;
  /**
   * Pruebas de la misma edición que publican la misma prueba por partes (un
   * PDF con la clasificación y otro con las poules, por ejemplo). Incluye la
   * propia; sin agrupar, sólo está ella.
   */
  miembros?: string[];
};

/* ------------------------------------------------------- pruebas agrupadas */

type ClavePrueba = Pick<PruebaDeEdicion, 'arma' | 'genero' | 'categoria' | 'formato' | 'fecha'>;

function claveDePrueba(p: ClavePrueba): string {
  return [p.arma, p.genero, p.categoria.codigo, p.categoria.raw ?? '', p.formato, p.fecha ?? ''].join('|');
}

/**
 * Une las pruebas que son la misma prueba publicada por trozos. Las fuentes en
 * PDF parten a veces una prueba en varias filas (clasificación, poules y
 * cuadro sueltos) con el mismo arma, género, categoría, formato y día. Dos
 * filas con puestos importados son pruebas distintas (grupos por año de
 * nacimiento, por ejemplo) y nunca se unen; las que no tienen puestos se
 * suman a la única con puestos o, si no hay ninguna, a la de más asaltos.
 * Si hay varias con puestos, las sueltas no se pueden atribuir y se quedan
 * como están. El orden de la lista se respeta.
 */
export function agruparPruebas(pruebas: readonly PruebaDeEdicion[]): PruebaDeEdicion[] {
  const porClave = new Map<string, PruebaDeEdicion[]>();
  for (const p of pruebas) {
    const k = claveDePrueba(p);
    porClave.set(k, [...(porClave.get(k) ?? []), p]);
  }
  const absorbidas = new Map<string, string[]>();
  const fuera = new Set<string>();
  for (const grupo of porClave.values()) {
    if (grupo.length < 2) continue;
    const conPuestos = grupo.filter((p) => p.resultados.importados > 0);
    if (conPuestos.length > 1) continue;
    const cabeza =
      conPuestos[0] ??
      [...grupo].sort((x, y) => (y.asaltos ?? 0) - (x.asaltos ?? 0))[0];
    absorbidas.set(cabeza.id, [cabeza.id, ...grupo.filter((p) => p.id !== cabeza.id).map((p) => p.id)]);
    for (const p of grupo) if (p.id !== cabeza.id) fuera.add(p.id);
  }
  return pruebas
    .filter((p) => !fuera.has(p.id))
    .map((p) => {
      const miembros = absorbidas.get(p.id) ?? [p.id];
      const asaltos = pruebas.filter((o) => miembros.includes(o.id)).reduce((n, o) => n + (o.asaltos ?? 0), 0);
      return { ...p, miembros, asaltos };
    });
}

/** La prueba agrupada que contiene a `id` (sea la cabeza o una parte), o `undefined`. */
export function pruebaDeId(pruebas: readonly PruebaDeEdicion[], id: string): PruebaDeEdicion | undefined {
  return pruebas.find((p) => p.id === id) ?? pruebas.find((p) => p.miembros?.includes(id));
}

export type DimensionPrueba = 'formato' | 'arma' | 'genero' | 'categoria';

export type OpcionSelector = { valor: string; pruebaId: string; activa: boolean };

export type FilaSelector =
  | { dimension: DimensionPrueba; opciones: OpcionSelector[] }
  /** Varias pruebas con el mismo arma, género, categoría y formato (días o grupos distintos). */
  | { dimension: 'variante'; opciones: (OpcionSelector & { prueba: PruebaDeEdicion })[] };

const DIMENSIONES: readonly DimensionPrueba[] = ['formato', 'arma', 'genero', 'categoria'];
/** Al cambiar una dimensión se busca la prueba que conserve más de las otras, por este peso. */
const PESO_DIMENSION: Record<DimensionPrueba, number> = { formato: 8, arma: 4, genero: 2, categoria: 1 };
const ORDEN_VALOR: Partial<Record<DimensionPrueba, readonly string[]>> = {
  formato: ['INDIVIDUAL', 'EQUIPOS'],
  arma: ['ESPADA', 'FLORETE', 'SABLE'],
  genero: ['M', 'F', 'MIXTO'],
};

export function valorDimension(p: Pick<PruebaDeEdicion, 'arma' | 'genero' | 'categoria' | 'formato'>, d: DimensionPrueba): string {
  return d === 'categoria' ? p.categoria.codigo : p[d];
}

/**
 * Filas del selector de pruebas: una por dimensión con más de un valor en la
 * edición, y cada opción apunta a una prueba real. Cambiar una dimensión lleva
 * a la prueba que más se parece a la elegida en las demás; nunca se ofrece una
 * combinación que la edición no tiene. `ordenCategoria` ordena las categorías.
 */
export function selectorDePruebas(
  pruebas: readonly PruebaDeEdicion[],
  elegida: PruebaDeEdicion,
  ordenCategoria: (codigo: string) => number = () => 0,
): FilaSelector[] {
  const filasSelector: FilaSelector[] = [];
  for (const d of DIMENSIONES) {
    const valores = [...new Set(pruebas.map((p) => valorDimension(p, d)))];
    if (valores.length < 2) continue;
    const orden = ORDEN_VALOR[d];
    valores.sort((x, y) =>
      orden
        ? orden.indexOf(x) - orden.indexOf(y)
        : ordenCategoria(x) - ordenCategoria(y) || x.localeCompare(y),
    );
    const propio = valorDimension(elegida, d);
    filasSelector.push({
      dimension: d,
      opciones: valores.map((valor) => {
        if (valor === propio) return { valor, pruebaId: elegida.id, activa: true };
        let mejor: PruebaDeEdicion | undefined;
        let puntos = -1;
        for (const p of pruebas) {
          if (valorDimension(p, d) !== valor) continue;
          const parecido = DIMENSIONES.reduce(
            (n, o) => n + (o !== d && valorDimension(p, o) === valorDimension(elegida, o) ? PESO_DIMENSION[o] : 0),
            0,
          );
          if (parecido > puntos) {
            mejor = p;
            puntos = parecido;
          }
        }
        return { valor, pruebaId: mejor?.id ?? elegida.id, activa: false };
      }),
    });
  }
  const gemelas = pruebas.filter((p) => DIMENSIONES.every((d) => valorDimension(p, d) === valorDimension(elegida, d)));
  if (gemelas.length > 1) {
    filasSelector.push({
      dimension: 'variante',
      opciones: gemelas.map((p) => ({ valor: p.id, pruebaId: p.id, activa: p.id === elegida.id, prueba: p })),
    });
  }
  return filasSelector;
}

/** Con qué prueba se abre la edición: la primera con puestos y, si no hay, la primera con asaltos. */
export function pruebaPorDefecto(pruebas: readonly PruebaDeEdicion[]): PruebaDeEdicion | undefined {
  return (
    pruebas.find((p) => p.resultados.importados > 0) ??
    pruebas.find((p) => (p.asaltos ?? 0) > 0) ??
    pruebas[0]
  );
}

export type EdicionResumen = {
  id: string;
  nombre: string;
  temporada: string;
  fuente: string;
  ciudad: string | null;
  pais: string | null;
  inicio: string | null;
  fin: string | null;
  pruebas: number;
  armas: Arma[];
  formatos: Formato[];
  serie: SerieComplementaria | null;
  /** Géneros de sus pruebas (sólo lo rellena el índice del buscador). */
  generos?: Genero[];
  /**
   * Ediciones del mismo evento que resume esta fila (ver `agruparEdiciones`);
   * ausente o 1 = la edición sola. Fechas, armas, formatos, géneros y pruebas
   * son entonces los del evento entero.
   */
  ediciones?: number;
};

/* ------------------------------------------------- ediciones de un evento */

/**
 * Una edición vista para agruparla con las de su evento. La FIE publica sin
 * torneo muchas pruebas sueltas y Skermo una edición por prueba: un Mundial
 * llega como doce ediciones con el mismo nombre, sede y fechas seguidas.
 */
export type EdicionAgrupable = {
  fuente: string;
  temporada: string;
  nombre: string;
  ciudad: string | null;
  pais: string | null;
  /** Días desde 1970 (-1 sin fecha). */
  inicio: number;
  /** Días desde 1970 (-1 sin fin). */
  fin: number;
  /** Torneo canónico del calendario (`event.canonical_event_id` o `event_id`). */
  evento: string | null;
  /** Categorías de sus pruebas; sin ellas, una edición nacional no se une con las de otra fuente por nombre. */
  categorias?: readonly string[];
};

/**
 * Fuentes que publican los campeonatos de la RFEE: el mismo campeonato puede
 * llegar de Skermo, de un PDF y de Engarde, cada una con sus pruebas.
 */
export const FUENTES_NACIONALES: ReadonlySet<string> = new Set(['skermo_rfee', 'rfee_pdf', 'engarde']);
const familiaDe = (fuente: string) => (FUENTES_NACIONALES.has(fuente) ? 'nacional' : fuente);

/** Dos pruebas de un mismo evento empiezan, como mucho, este número de días después de la anterior. */
export const DIAS_ENTRE_PRUEBAS = 4;
/** Ni encadenando fechas un evento dura más que esto desde su primera prueba. */
export const DIAS_MAXIMOS_EVENTO = 16;

const PALABRAS_DE_PRUEBA = new Set([
  // armas
  'epee', 'epees', 'espada', 'espadas', 'foil', 'foils', 'fleuret', 'fleurets', 'florete', 'floretes',
  'sabre', 'sabres', 'saber', 'sabers', 'sable', 'sables',
  // géneros
  'men', 'mens', 'women', 'womens', 'hommes', 'homme', 'dames', 'dame', 'masculino', 'masculina', 'masculinos',
  'masculinas', 'femenino', 'femenina', 'femeninos', 'femeninas', 'masc', 'fem', 'mixed', 'mixto', 'mixta', 'mixtos',
  // modalidad
  'individual', 'individuales', 'individuel', 'individuels', 'individuelle', 'team', 'teams', 'equipe', 'equipes',
  'equipo', 'equipos',
  // enlaces
  'par', 'por', 'y', 'e', 'et', 'and', 'de', 'del', 'la', 'las', 'los', 'el', 'du', 'des', 'd', 'of', 'the', 's',
]);

/**
 * Lo que comparten los nombres de las ediciones de un evento: sin tildes, sin
 * año y sin las palabras de arma, género o modalidad («TNR Espada Masculina
 * Sabadell» y «TNR Espada Femenina Sabadell» dan «tnr sabadell»). La
 * categoría se queda: los PDF de la RFEE no traen sede y, sin ella, el
 * Campeonato de España M13 y el M15 se encadenarían por fechas. Sólo se
 * igualan sus formas («M-15», «U15», «Sub 15» → «m15») y «Grand Veterans»
 * con «Veterans», que la FIE publica como un mismo campeonato. Los Mundiales
 * de veteranos llegan como una edición por franja («Vétérans 60-69», «70+»):
 * la franja se quita para que salgan juntos, y el selector la ofrece como
 * «Grupo». Singular y plural («Championnat(s) du monde») son el mismo nombre.
 */
export function nombreBaseEdicion(nombre: string): string {
  const plegado = nombre.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const sinFranja = /\bveterans?\b|\bveteranos?\b/.test(plegado)
    ? plegado.replace(/\b\d{2}\s*(?:-|–|a)\s*\d{2}\b/g, ' ').replace(/\b\d{2}\s*\+|\+\s*\d{2}\b/g, ' ')
    : plegado;
  return sinFranja
    .replace(/\bgrands?[\s-]+(?=veterans?\b)/g, '')
    .replace(/\b(championnat|championship|championat|campeonato|campionato|campionat)s\b/g, '$1')
    .replace(/\b(?:m|u|sub)[\s-]?(\d{1,2})\b/g, 'm$1')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((p) => p && !PALABRAS_DE_PRUEBA.has(p))
    .join(' ');
}

const sedeBase = (texto: string | null) =>
  (texto ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Días desde 1970 de una fecha ISO (-1 si no es una fecha). */
export function diaDeIso(iso: string | null | undefined): number {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return -1;
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? Math.round(t / 86_400_000) : -1;
}

/**
 * El evento de cada edición, como un número de grupo (0, 1, 2… por orden de
 * primera aparición). Van juntas:
 *  - las de un mismo torneo del calendario y la misma fuente (o las tres
 *    nacionales, `FUENTES_NACIONALES`, entre sí),
 *  - las de la misma fuente, temporada, `nombreBaseEdicion`, ciudad y país
 *    cuyas fechas se encadenan (cada una empieza a no más de
 *    `DIAS_ENTRE_PRUEBAS` días del final de las anteriores y a no más de
 *    `DIAS_MAXIMOS_EVENTO` del inicio de la primera), y
 *  - los grupos así formados de fuentes nacionales DISTINTAS con la misma
 *    temporada y `nombreBaseEdicion` y fechas encadenadas, si las categorías
 *    de uno están todas en el otro. La sede no cuenta aquí: los PDF no la
 *    traen y Skermo y Engarde la escriben distinto. Dos grupos de la misma
 *    fuente nunca se unen por este paso (los separó su sede).
 * La FIE y la EFC nunca se juntan con otra fuente, ni una edición sin fecha
 * con otra salvo por el calendario. No cambia la ingesta: es sólo cómo se
 * presentan.
 */
export function agruparEdiciones(ediciones: readonly EdicionAgrupable[]): Int32Array {
  const n = ediciones.length;
  const padre = Int32Array.from({ length: n }, (_, i) => i);
  const raiz = (i: number): number => {
    while (padre[i] !== i) {
      padre[i] = padre[padre[i]!]!;
      i = padre[i]!;
    }
    return i;
  };
  const unir = (a: number, b: number) => {
    const x = raiz(a);
    const y = raiz(b);
    if (x !== y) padre[Math.max(x, y)] = Math.min(x, y);
  };

  const porClave = new Map<string, number[]>();
  const porEvento = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const e = ediciones[i]!;
    if (e.evento) {
      const k = `${familiaDe(e.fuente)}\u0000${e.evento}`;
      const otra = porEvento.get(k);
      if (otra === undefined) porEvento.set(k, i);
      else unir(otra, i);
    }
    if (e.inicio < 0) continue;
    const k = [e.fuente, e.temporada, nombreBaseEdicion(e.nombre), sedeBase(e.ciudad), sedeBase(e.pais)].join('\u0000');
    const lista = porClave.get(k);
    if (lista) lista.push(i);
    else porClave.set(k, [i]);
  }
  for (const lista of porClave.values()) {
    if (lista.length < 2) continue;
    lista.sort((a, b) => ediciones[a]!.inicio - ediciones[b]!.inicio || a - b);
    let hasta = -Infinity;
    let desde = 0;
    let anterior = -1;
    for (const i of lista) {
      const e = ediciones[i]!;
      if (anterior >= 0 && e.inicio <= hasta + DIAS_ENTRE_PRUEBAS && e.inicio - desde <= DIAS_MAXIMOS_EVENTO) {
        unir(anterior, i);
      } else {
        hasta = -Infinity;
        desde = e.inicio;
      }
      hasta = Math.max(hasta, e.inicio, e.fin);
      anterior = i;
    }
  }
  unirNacionales(ediciones, raiz, unir);

  const numero = new Map<number, number>();
  const grupos = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = raiz(i);
    let g = numero.get(r);
    if (g === undefined) {
      g = numero.size;
      numero.set(r, g);
    }
    grupos[i] = g;
  }
  return grupos;
}

type GrupoNacional = {
  raiz: number;
  temporada: string;
  nombre: string;
  inicio: number;
  fin: number;
  fuentes: Set<string>;
  categorias: Set<string>;
};

const contenidas = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].every((c) => b.has(c));

/** El tercer paso de `agruparEdiciones`: el mismo campeonato de la RFEE leído de varias fuentes. */
function unirNacionales(
  ediciones: readonly EdicionAgrupable[],
  raiz: (i: number) => number,
  unir: (a: number, b: number) => void,
) {
  const porRaiz = new Map<number, GrupoNacional>();
  for (let i = 0; i < ediciones.length; i++) {
    const e = ediciones[i]!;
    if (!FUENTES_NACIONALES.has(e.fuente) || e.inicio < 0) continue;
    const r = raiz(i);
    let g = porRaiz.get(r);
    if (!g) {
      g = { raiz: r, temporada: e.temporada, nombre: nombreBaseEdicion(e.nombre), inicio: e.inicio, fin: e.inicio,
        fuentes: new Set(), categorias: new Set() };
      porRaiz.set(r, g);
    }
    g.inicio = Math.min(g.inicio, e.inicio);
    g.fin = Math.max(g.fin, e.inicio, e.fin);
    g.fuentes.add(e.fuente);
    for (const c of e.categorias ?? []) g.categorias.add(c);
  }
  const porClave = new Map<string, GrupoNacional[]>();
  for (const g of porRaiz.values()) {
    if (g.categorias.size === 0) continue;
    const k = `${g.temporada}\u0000${g.nombre}`;
    const lista = porClave.get(k);
    if (lista) lista.push(g);
    else porClave.set(k, [g]);
  }
  for (const lista of porClave.values()) {
    if (lista.length < 2) continue;
    lista.sort((a, b) => a.inicio - b.inicio || a.raiz - b.raiz);
    const cadenas: GrupoNacional[] = [];
    for (const g of lista) {
      const cadena = cadenas.find((c) =>
        g.inicio <= c.fin + DIAS_ENTRE_PRUEBAS && g.inicio - c.inicio <= DIAS_MAXIMOS_EVENTO
        && ![...g.fuentes].some((f) => c.fuentes.has(f))
        && (contenidas(g.categorias, c.categorias) || contenidas(c.categorias, g.categorias)));
      if (!cadena) {
        cadenas.push({ ...g, fuentes: new Set(g.fuentes), categorias: new Set(g.categorias) });
        continue;
      }
      unir(cadena.raiz, g.raiz);
      cadena.fin = Math.max(cadena.fin, g.fin);
      g.fuentes.forEach((f) => cadena.fuentes.add(f));
      g.categorias.forEach((c) => cadena.categorias.add(c));
    }
  }
}

/**
 * Una prueba de una edición del mismo evento, con lo justo para el selector:
 * su edición (para el enlace), su arma, género, categoría y modalidad, su
 * fuente y cuánto trae (`riquezaDe`).
 */
export type PruebaHermana = Pick<PruebaDeEdicion, 'id' | 'arma' | 'genero' | 'categoria' | 'formato' | 'fecha' | 'fuente'> & {
  edicionId: string;
  /** 2 con asaltos (poules o cuadro), 1 con clasificación, 0 sin nada importado. */
  riqueza: number;
};

export function riquezaDe(p: Pick<PruebaDeEdicion, 'asaltos' | 'resultados'>): number {
  return (p.asaltos ?? 0) > 0 ? 2 : p.resultados.importados > 0 ? 1 : 0;
}

/** Nombre corto de una fuente para la fila «Fuente» del selector. */
export const ETIQUETA_FUENTE: Record<string, string> = {
  fie: 'FIE', efc: 'EFC', skermo_rfee: 'Skermo', rfee_pdf: 'PDF', engarde: 'Engarde',
};

const dimensionesDe = (p: Pick<PruebaHermana, 'arma' | 'genero' | 'formato' | 'categoria'>) =>
  `${p.arma}|${p.genero}|${p.formato}|${p.categoria.codigo}`;

export type EleccionEvento = {
  actual: PruebaHermana;
  /** Una prueba por combinación de arma, género, modalidad y categoría: la de la fuente más rica (o la actual). */
  principales: PruebaHermana[];
  /** Las de la misma combinación y fuente que la actual (grupos de edad, días), si hay más de una. */
  grupos: PruebaHermana[];
  /** Una por fuente con la misma combinación que la actual, si hay más de una fuente. */
  fuentes: PruebaHermana[];
};

/**
 * Lo que enseña el selector de un evento. La misma prueba publicada por dos
 * fuentes (Skermo y el PDF de un mismo campeonato) es UNA opción en las filas
 * de arma, género, modalidad y categoría: la de la fuente con más datos
 * (asaltos > clasificación > nada). La otra sólo se alcanza desde la fila
 * «Fuente», que sale únicamente cuando la prueba actual está repetida.
 */
export function eleccionDelEvento(hermanas: readonly PruebaHermana[], actualId: string): EleccionEvento | null {
  const actual = hermanas.find((h) => h.id === actualId) ?? hermanas[0];
  if (!actual) return null;
  const propia = dimensionesDe(actual);
  const porDimensiones = new Map<string, PruebaHermana[]>();
  for (const h of hermanas) {
    const k = dimensionesDe(h);
    const lista = porDimensiones.get(k);
    if (lista) lista.push(h);
    else porDimensiones.set(k, [h]);
  }
  const principales: PruebaHermana[] = [];
  for (const [k, lista] of porDimensiones) {
    // Estable: entre iguales, la primera en el orden de lectura.
    principales.push(k === propia ? actual : lista.reduce((m, h) => (h.riqueza > m.riqueza ? h : m)));
  }
  const gemelas = porDimensiones.get(propia) ?? [actual];
  const grupos = gemelas.filter((h) => h.fuente === actual.fuente);
  const otrasFuentes = [...new Set(gemelas.map((h) => h.fuente))].filter((f) => f !== actual.fuente);
  const raw = (h: PruebaHermana) => (h.categoria.raw ?? '').trim().toLowerCase();
  const fuentes = otrasFuentes.length === 0 ? [] : [
    actual,
    ...otrasFuentes.map((f) => {
      const de = gemelas.filter((h) => h.fuente === f);
      return de.find((h) => raw(h) && raw(h) === raw(actual))
        ?? de.find((h) => h.fecha && h.fecha === actual.fecha)
        ?? de.reduce((m, h) => (h.riqueza > m.riqueza ? h : m));
    }),
  ];
  return { actual, principales, grupos: grupos.length > 1 ? grupos : [], fuentes };
}

const ORDEN_ARMA_CANONICO: readonly string[] = ['FLORETE', 'ESPADA', 'SABLE'];
const ORDEN_GENERO_CANONICO: readonly string[] = ['M', 'F', 'MIXTO'];

/**
 * La prueba con la que se abre una edición para quien tira o selecciona unas
 * armas (y, si se sabe, un género): entre las que tienen algo importado (o
 * todas, si ninguna), la de su arma y su género y, a igualdad, individual,
 * en el orden de los rótulos y con más datos. `undefined` sin preferencias o
 * si ninguna prueba es de sus armas: entonces manda `pruebaPorDefecto`.
 */
export function pruebaPreferida<P extends Pick<PruebaDeEdicion, 'arma' | 'genero' | 'formato' | 'categoria' | 'asaltos' | 'resultados'>>(
  pruebas: readonly P[],
  preferencias: { armas?: readonly string[]; generos?: readonly string[] },
): P | undefined {
  const armas = preferencias.armas ?? [];
  if (armas.length === 0) return undefined;
  const conDatos = pruebas.filter((p) => riquezaDe(p) > 0);
  const candidatas = (conDatos.length ? conDatos : pruebas).filter((p) => armas.includes(p.arma));
  if (candidatas.length === 0) return undefined;
  const generos = preferencias.generos ?? [];
  const puesto = (p: P) => [
    generos.length && !generos.includes(p.genero) ? 1 : 0,
    p.formato === 'INDIVIDUAL' ? 0 : 1,
    ORDEN_ARMA_CANONICO.indexOf(p.arma),
    ORDEN_GENERO_CANONICO.indexOf(p.genero),
    p.categoria.codigo === 'ABS' ? 0 : 1,
    -riquezaDe(p),
  ];
  return [...candidatas].sort((x, y) => {
    const a = puesto(x);
    const b = puesto(y);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return 0;
  })[0];
}

export type FilaClasificacion = {
  id: string;
  puesto: number | null;
  puestoPublicado: string | null;
  nombre: string;
  pais: string | null;
  club: string | null;
  /** Persona deportiva vinculada con evidencia; `null` = sin ficha, nunca por nombre. */
  personaId: string | null;
};

export type Clasificacion = {
  pruebaId: string;
  fuente: string;
  filas: FilaClasificacion[];
  siguiente: string | null;
  /** Otras fuentes con puestos de la misma prueba, que no se mezclan en la lista. */
  otrasFuentes: { fuente: string; filas: number }[];
};

export type EdicionDetalle = EdicionResumen & {
  pruebasDetalle: PruebaDeEdicion[];
  /** La prueba pedida no pertenece a la edición. */
  pruebaDesconocida: boolean;
  clasificacion: Clasificacion | null;
  /**
   * Prueba (agrupada) que se enseña: la pedida o, sin pedir ninguna, la
   * primera con puestos. `null` o ausente = ninguna.
   */
  pruebaElegida?: string | null;
  /**
   * Todas las pruebas del evento (esta edición y las demás de su grupo, ver
   * `agruparEdiciones`), para elegir arma, género, modalidad y categoría entre
   * ediciones. Ausente o sin pruebas de otra edición = sólo las de ésta.
   */
  hermanas?: PruebaHermana[];
};
