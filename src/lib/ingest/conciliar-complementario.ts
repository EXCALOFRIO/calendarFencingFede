import { fixDoubleEncodedUtf8 } from './fetcher';
import type { mapCategory, mapGender, mapWeapon } from './mappers';
import type { SerieComplementaria } from './series-complementarias';
import { clasificarSerie } from './series-complementarias';
import type { PaginaEngarde, PruebaEngarde, PuestoComplementario } from './sources/engarde';
import type { PaginaFww } from './sources/fww';

/**
 * Conciliación estricta de una fuente complementaria (Engarde, Fencing
 * Worldwide) con una prueba que una fuente prioritaria ya verificó.
 *
 * Un candidato sólo vale si es LA MISMA prueba de LA MISMA edición: misma
 * serie, sede, fecha, arma, género, categoría y modalidad. Coincidir en el
 * nombre del torneo, ser una página de equipos o una portada no basta. Todo
 * dato que falte en un lado manda el candidato a revisión: no se completa.
 */

export type Arma = NonNullable<ReturnType<typeof mapWeapon>>;
export type Genero = NonNullable<ReturnType<typeof mapGender>>;
/** La base admite categorías (M7…M13) que el mapeador de texto no produce: se compara el valor, no el tipo. */
export type Categoria = string;
export type Formato = 'INDIVIDUAL' | 'EQUIPOS';

export type PruebaCanonica = {
  /** Fuente que la verificó: `fie`, `skermo_rfee`… */
  fuente: string;
  season: string;
  clave: string;
  serie: SerieComplementaria | null;
  nombreEdicion: string | null;
  ciudad: string | null;
  fecha: string | null;
  arma: Arma | null;
  genero: Genero | null;
  categoria: Categoria | null;
  formato: Formato | null;
};

export type ProveedorComplementario = 'engarde' | 'fww';

export type CandidatoComplementario = {
  proveedor: ProveedorComplementario;
  url: string;
  clave: string;
  nombreTorneo: string | null;
  ciudad: string | null;
  /** Fecha estructurada de la prueba (índice Engarde / miga de pan FWW). */
  fecha: string | null;
  /** Fecha que repite la propia página, si es distinta fuente que `fecha`. */
  fechaPagina: string | null;
  arma: Arma | null;
  genero: Genero | null;
  categoria: Categoria | null;
  formato: Formato | null;
  formatoPagina: Formato | null;
  serie: SerieComplementaria | null;
};

export function candidatoDeEngarde(
  prueba: PruebaEngarde,
  contexto: { nombreTorneo: string | null; pagina?: PaginaEngarde | null },
): CandidatoComplementario {
  const formato: Formato | null =
    prueba.individual === null ? null : prueba.individual ? 'INDIVIDUAL' : 'EQUIPOS';
  const pagina = contexto.pagina ?? null;
  const formatoPagina: Formato | null =
    pagina && pagina.tipo === 'clasificacion' && pagina.filas.length > 0
      ? pagina.equipos
        ? 'EQUIPOS'
        : 'INDIVIDUAL'
      : null;
  return {
    proveedor: 'engarde',
    url: prueba.url,
    clave: `${prueba.org}/${prueba.evt}/${prueba.compe}`,
    nombreTorneo: contexto.nombreTorneo,
    ciudad: prueba.ciudad,
    fecha: prueba.fecha,
    fechaPagina: pagina?.fecha ?? null,
    arma: prueba.arma,
    genero: prueba.genero,
    categoria: prueba.categoria,
    formato,
    formatoPagina,
    serie: clasificarSerie({ nombre: contexto.nombreTorneo }),
  };
}

export function candidatoDeFww(url: string, clave: string, pagina: PaginaFww): CandidatoComplementario {
  return {
    proveedor: 'fww',
    url,
    clave,
    nombreTorneo: pagina.torneo,
    ciudad: pagina.ciudad,
    fecha: pagina.fecha,
    fechaPagina: null,
    arma: pagina.arma,
    genero: pagina.genero,
    categoria: pagina.categoria,
    formato: pagina.formato,
    formatoPagina: null,
    serie: clasificarSerie({ nombre: pagina.torneo }),
  };
}

export type MotivoCotejo =
  | 'formato_distinto'
  | 'arma_distinta'
  | 'genero_distinto'
  | 'categoria_distinta'
  | 'serie_distinta'
  | 'otra_edicion'
  | 'otra_sede'
  | 'fecha_difiere'
  | 'sede_no_verificable'
  | 'serie_no_verificable'
  | 'formato_contradictorio'
  | 'canonica_ambigua'
  | `dato_ausente:${'arma' | 'genero' | 'categoria' | 'formato' | 'fecha'}`;

export type Cotejo = {
  decision: 'aceptado' | 'rechazado' | 'revision';
  motivos: MotivoCotejo[];
};

/** Dos días de diferencia entre fuentes ya no es la misma jornada. */
const DIAS_MISMA_JORNADA = 1;
/** Más de un mes de diferencia es otra edición, no una errata. */
const DIAS_OTRA_EDICION = 31;

function dias(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

function claveCiudad(c: string): string {
  return fixDoubleEncodedUtf8(c)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Igual, o una es abreviatura de la otra («Rivas Vaci.»): mínimo cuatro letras. */
export function ciudadesCompatibles(a: string, b: string): boolean {
  const x = claveCiudad(a);
  const y = claveCiudad(b);
  if (x.length === 0 || y.length === 0) return false;
  if (x === y) return true;
  const [corta, larga] = x.length <= y.length ? [x, y] : [y, x];
  return corta.length >= 4 && larga.startsWith(corta);
}

export function cotejar(prueba: PruebaCanonica, candidato: CandidatoComplementario): Cotejo {
  const rechazos: MotivoCotejo[] = [];
  const dudas: MotivoCotejo[] = [];

  const comparar = <T>(
    campo: 'arma' | 'genero' | 'categoria' | 'formato',
    a: T | null,
    b: T | null,
    distinto: MotivoCotejo,
  ) => {
    if (a === null || b === null) dudas.push(`dato_ausente:${campo}`);
    else if (a !== b) rechazos.push(distinto);
  };
  comparar('formato', prueba.formato, candidato.formato, 'formato_distinto');
  comparar('arma', prueba.arma, candidato.arma, 'arma_distinta');
  comparar('genero', prueba.genero, candidato.genero, 'genero_distinto');
  comparar('categoria', prueba.categoria, candidato.categoria, 'categoria_distinta');

  if (candidato.formato && candidato.formatoPagina && candidato.formato !== candidato.formatoPagina) {
    dudas.push('formato_contradictorio');
  }

  if (prueba.serie !== null) {
    if (candidato.serie === null) dudas.push('serie_no_verificable');
    else if (candidato.serie !== prueba.serie) rechazos.push('serie_distinta');
  }

  if (prueba.fecha === null || candidato.fecha === null) {
    dudas.push('dato_ausente:fecha');
  } else {
    const d = dias(prueba.fecha, candidato.fecha);
    if (d > DIAS_OTRA_EDICION) rechazos.push('otra_edicion');
    else if (d > DIAS_MISMA_JORNADA) dudas.push('fecha_difiere');
  }
  if (
    candidato.fecha !== null &&
    candidato.fechaPagina !== null &&
    dias(candidato.fecha, candidato.fechaPagina) > DIAS_MISMA_JORNADA
  ) {
    dudas.push('fecha_difiere');
  }

  if (prueba.ciudad === null || candidato.ciudad === null) {
    dudas.push('sede_no_verificable');
  } else if (!ciudadesCompatibles(prueba.ciudad, candidato.ciudad)) {
    rechazos.push('otra_sede');
  }

  const motivos = [...new Set([...rechazos, ...dudas])];
  if (rechazos.length > 0) return { decision: 'rechazado', motivos };
  if (dudas.length > 0) return { decision: 'revision', motivos };
  return { decision: 'aceptado', motivos };
}

/** Lo que la fuente prioritaria sabe de la prueba. */
export type ResultadosPrimarios =
  | { estado: 'sin_prueba' }
  | { estado: 'sin_resultados' }
  | { estado: 'no_publicado' }
  | { estado: 'pendiente' }
  | { estado: 'error' }
  | {
      estado: 'publicados';
      /** `false` si la lectura prioritaria quedó parcial. */
      completo: boolean;
      puestos: { posicion: number | null; pais: string | null }[];
    };

export type LecturaComplementaria = {
  estado: 'completo' | 'parcial' | 'sin_resultados' | 'no_publicado' | 'error';
  puestos: PuestoComplementario[];
  motivo: string | null;
};

export type PlanComplementario =
  | { accion: 'rechazar'; motivos: MotivoCotejo[] }
  | { accion: 'revision'; motivos: MotivoCotejo[] }
  | { accion: 'sin_hechos'; estado: 'sin_resultados' | 'no_publicado' | 'error'; motivo: string | null }
  | { accion: 'diferir'; motivo: 'primaria_pendiente' | 'primaria_con_error' | 'primaria_parcial' }
  | { accion: 'sin_cambios'; motivo: 'ya_canonico' }
  | { accion: 'conflicto'; motivo: string }
  | {
      accion: 'escribir';
      cobertura: 'completo' | 'parcial';
      puestos: PuestoComplementario[];
      /** Las poules y cuadros de una fuente complementaria no se leen: no son «cero». */
      asaltos: 'no_importados';
    };

function firma(p: { posicion: number | null; pais: string | null }): string {
  return `${p.posicion ?? '-'}|${(p.pais ?? '').toUpperCase()}`;
}

/** Misma lista de (puesto, país), sin comparar nombres entre fuentes. */
function mismosPuestos(
  primarios: readonly { posicion: number | null; pais: string | null }[],
  candidatos: readonly { posicion: number | null; pais: string | null }[],
): boolean {
  if (primarios.length !== candidatos.length) return false;
  const cuenta = new Map<string, number>();
  for (const p of primarios) cuenta.set(firma(p), (cuenta.get(firma(p)) ?? 0) + 1);
  for (const c of candidatos) {
    const n = cuenta.get(firma(c));
    if (!n) return false;
    cuenta.set(firma(c), n - 1);
  }
  return true;
}

/**
 * Decide qué se escribe de una fuente complementaria para una prueba. Nunca
 * duplica lo que la fuente prioritaria ya publica, nunca mezcla individuales
 * con equipos y sólo rellena cuando la prioritaria SABE que no lo publica.
 */
export function planificarComplemento(entrada: {
  prueba: PruebaCanonica;
  candidato: CandidatoComplementario;
  lectura: LecturaComplementaria;
  primarios: ResultadosPrimarios;
}): PlanComplementario {
  const { prueba, candidato, lectura, primarios } = entrada;
  const cotejo = cotejar(prueba, candidato);
  if (cotejo.decision === 'rechazado') return { accion: 'rechazar', motivos: cotejo.motivos };
  if (cotejo.decision === 'revision') return { accion: 'revision', motivos: cotejo.motivos };

  if (lectura.estado === 'sin_resultados' || lectura.estado === 'no_publicado' || lectura.estado === 'error') {
    return { accion: 'sin_hechos', estado: lectura.estado, motivo: lectura.motivo };
  }

  const individual = candidato.formato === 'INDIVIDUAL';
  const puestos = lectura.puestos.filter((p) => p.equipo === !individual);
  if (puestos.length !== lectura.puestos.length) {
    return { accion: 'revision', motivos: ['formato_contradictorio'] };
  }

  if (primarios.estado === 'pendiente') return { accion: 'diferir', motivo: 'primaria_pendiente' };
  if (primarios.estado === 'error') return { accion: 'diferir', motivo: 'primaria_con_error' };
  if (primarios.estado === 'publicados') {
    if (!primarios.completo) return { accion: 'diferir', motivo: 'primaria_parcial' };
    const candidatos = puestos.map((p) => ({ posicion: p.posicion, pais: p.pais }));
    return mismosPuestos(primarios.puestos, candidatos)
      ? { accion: 'sin_cambios', motivo: 'ya_canonico' }
      : { accion: 'conflicto', motivo: 'La fuente prioritaria y la complementaria publican puestos distintos' };
  }

  return {
    accion: 'escribir',
    cobertura: lectura.estado,
    puestos,
    asaltos: 'no_importados',
  };
}
