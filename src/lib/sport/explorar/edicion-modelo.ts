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
};

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
};
