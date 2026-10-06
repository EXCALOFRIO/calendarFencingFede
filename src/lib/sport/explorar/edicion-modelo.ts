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
};

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
};
