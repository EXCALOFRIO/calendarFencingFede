import type { AsaltoComplementario } from './asaltos-complementarios';
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
  | 'edicion_no_verificable'
  | 'participantes_no_verificables'
  | 'sin_asaltos_equipos'
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

/** Palabras que nombran el tipo de torneo, la categoría o el año, no la edición concreta. */
const PALABRAS_GENERICAS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'of', 'the', 'and', 'y', 'e', 'et', 'di', 'du', 'des', 'in', 'a', 'en',
  'copa', 'campeonato', 'campeonatos', 'trofeo', 'torneo', 'gran', 'premio', 'grand', 'prix', 'world', 'cup',
  'championship', 'championships', 'open', 'international', 'internacional', 'nacional', 'national',
  'absoluta', 'absoluto', 'abs', 'senior', 'seniors', 'junior', 'juniors', 'cadet', 'cadets', 'cadete', 'cadetes',
  'juvenil', 'infantil', 'veteranos', 'masters', 'epee', 'espada', 'foil', 'florete', 'sabre', 'sable',
  'men', 'women', 'hombres', 'mujeres', 'masculino', 'femenino',
]);

function palabrasEdicion(nombre: string): string[] {
  return fixDoubleEncodedUtf8(nombre)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 0 && !/^\d{4}$/.test(p) && !/^[um]\d{1,2}$/.test(p));
}

/**
 * Dos nombres de edición son compatibles si comparten TODAS las palabras
 * significativas de la más corta (sin términos genéricos, años ni categorías).
 * Sin palabras significativas en ninguno sólo vale el nombre genérico idéntico;
 * con significativas en un solo lado no hay evidencia.
 */
export function nombresEdicionCompatibles(a: string, b: string): boolean {
  const pa = palabrasEdicion(a);
  const pb = palabrasEdicion(b);
  const sa = new Set(pa.filter((p) => !PALABRAS_GENERICAS.has(p)));
  const sb = new Set(pb.filter((p) => !PALABRAS_GENERICAS.has(p)));
  if (sa.size === 0 && sb.size === 0) {
    const ta = [...new Set(pa)].filter((p) => !['de', 'del', 'of', 'the'].includes(p)).sort().join(' ');
    const tb = [...new Set(pb)].filter((p) => !['de', 'del', 'of', 'the'].includes(p)).sort().join(' ');
    return ta.length > 0 && ta === tb;
  }
  if (sa.size === 0 || sb.size === 0) return false;
  const [corta, larga] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  return [...corta].every((p) => larga.has(p));
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

  // Misma sede, fecha, arma, género, categoría y formato no prueban la misma edición:
  // hace falta una serie común o nombres de edición compatibles.
  const mismaSerie = prueba.serie !== null && prueba.serie === candidato.serie;
  if (!mismaSerie && (prueba.serie === null || candidato.serie === null)) {
    const nombresOk =
      prueba.nombreEdicion !== null &&
      candidato.nombreTorneo !== null &&
      nombresEdicionCompatibles(prueba.nombreEdicion, candidato.nombreTorneo);
    if (!nombresOk) dudas.push('edicion_no_verificable');
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
      puestos: PuestoPrimario[];
    };

/** `nombre` es el que publica la primaria: sin él no hay correspondencia de participantes. */
export type PuestoPrimario = { posicion: number | null; pais: string | null; nombre?: string | null };

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
    };

function firma(p: { posicion: number | null; pais: string | null }): string {
  return `${p.posicion ?? '-'}|${(p.pais ?? '').toUpperCase()}`;
}

/** Palabras del nombre sin tildes, signos ni orden: «GARCIA, Ana» y «Ana GARCIA» coinciden. */
function claveNombre(nombre: string): string {
  return palabrasEdicion(nombre).sort().join(' ');
}

function igualMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const cuenta = new Map<string, number>();
  for (const x of a) cuenta.set(x, (cuenta.get(x) ?? 0) + 1);
  for (const y of b) {
    const n = cuenta.get(y);
    if (!n) return false;
    cuenta.set(y, n - 1);
  }
  return true;
}

type ComparacionPuestos = 'iguales' | 'distintos' | 'participantes_no_verificables';

/**
 * Misma lista de (puesto, país) NO basta: dos españoles que intercambian el 1
 * y el 2 la cumplen. La equivalencia exige además que cada participante ocupe
 * el mismo puesto en las dos fuentes, comparado por nombre publicado.
 */
function compararPuestos(
  primarios: readonly PuestoPrimario[],
  candidatos: readonly { posicion: number | null; pais: string | null; nombre: string }[],
): ComparacionPuestos {
  if (!igualMultiset(primarios.map(firma), candidatos.map(firma))) return 'distintos';
  if (primarios.some((p) => !p.nombre || claveNombre(p.nombre) === '')) return 'participantes_no_verificables';
  const porParticipante = (p: { posicion: number | null; pais: string | null; nombre?: string | null }) =>
    `${firma(p)}|${claveNombre(p.nombre ?? '')}`;
  return igualMultiset(primarios.map(porParticipante), candidatos.map(porParticipante)) ? 'iguales' : 'distintos';
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
    const comparacion = compararPuestos(primarios.puestos, puestos);
    if (comparacion === 'participantes_no_verificables') {
      return { accion: 'revision', motivos: ['participantes_no_verificables'] };
    }
    return comparacion === 'iguales'
      ? { accion: 'sin_cambios', motivo: 'ya_canonico' }
      : { accion: 'conflicto', motivo: 'La fuente prioritaria y la complementaria publican puestos o participantes distintos' };
  }

  return { accion: 'escribir', cobertura: lectura.estado, puestos };
}

// ---------------------------------------------------------------------------
// Asaltos (poules / cuadro): cobertura propia, independiente de los finales
// ---------------------------------------------------------------------------

/**
 * Lo que la fuente prioritaria sabe de UN tipo de hecho (poules o cuadro) de la
 * prueba. `desconocido` (nunca consultado) no es ausencia: se difiere.
 */
export type EstadoAsaltosPrimarios =
  | 'desconocido'
  | 'pendiente'
  | 'error'
  | 'publicado_parcial'
  | 'publicado_completo'
  | 'no_publicado'
  | 'sin_resultados';

export type CoberturaPrimaria = {
  status: 'pendiente' | 'completo' | 'parcial' | 'sin_resultados' | 'error' | 'conflicto';
  publishedTotal: number | null;
  cursor: string | null;
};

/**
 * Estado primario de poules o cuadro a partir de lo guardado: asaltos de la
 * primaria y su cobertura de ESE hecho. Sin ninguno es `desconocido` (nunca se
 * deduce «no publica»); `no_publicado` sólo si la primaria lo registró.
 */
export function estadoAsaltosPrimarios(
  asaltos: number,
  coberturas: readonly CoberturaPrimaria[],
): EstadoAsaltosPrimarios {
  const estados = coberturas.map((c) => c.status);
  if (asaltos > 0) {
    return estados.includes('completo') && !estados.includes('parcial') ? 'publicado_completo' : 'publicado_parcial';
  }
  if (coberturas.some((c) => c.cursor === 'no_publicado')) return 'no_publicado';
  if (estados.includes('sin_resultados') || coberturas.some((c) => c.status === 'completo' && c.publishedTotal === 0)) {
    return 'sin_resultados';
  }
  if (estados.includes('error')) return 'error';
  if (estados.includes('parcial')) return 'publicado_parcial';
  return coberturas.length > 0 ? 'pendiente' : 'desconocido';
}

export type LecturaAsaltosComplementaria = {
  estado: 'completo' | 'parcial' | 'sin_resultados' | 'no_publicado' | 'error';
  asaltos: AsaltoComplementario[];
  /** Cruces publicados con resultado (denominador de la cobertura). */
  publicado: number;
  motivo: string | null;
};

export type PlanAsaltos =
  | { accion: 'rechazar'; motivos: MotivoCotejo[] }
  | { accion: 'revision'; motivos: MotivoCotejo[] }
  | { accion: 'sin_hechos'; estado: 'sin_resultados' | 'no_publicado' | 'error'; motivo: string | null }
  | { accion: 'diferir'; motivo: 'primaria_pendiente' | 'primaria_con_error' | 'primaria_parcial' }
  | { accion: 'sin_cambios'; motivo: 'primaria_publica' }
  | {
      accion: 'escribir';
      fase: AsaltoComplementario['fase'];
      cobertura: 'completo' | 'parcial';
      publicado: number;
      asaltos: AsaltoComplementario[];
    };

/**
 * Decide si se escriben los asaltos de una fase. Los finales de la primaria no
 * dicen nada del cuadro ni de las poules: cada fase se compara con su propio
 * estado primario, y sólo `no_publicado`/`sin_resultados` permiten rellenar.
 */
export function planificarAsaltos(entrada: {
  prueba: PruebaCanonica;
  candidato: CandidatoComplementario;
  fase: AsaltoComplementario['fase'];
  lectura: LecturaAsaltosComplementaria;
  primario: EstadoAsaltosPrimarios;
}): PlanAsaltos {
  const { prueba, candidato, fase, lectura, primario } = entrada;
  const cotejo = cotejar(prueba, candidato);
  if (cotejo.decision === 'rechazado') return { accion: 'rechazar', motivos: cotejo.motivos };
  if (cotejo.decision === 'revision') return { accion: 'revision', motivos: cotejo.motivos };
  if (prueba.formato !== 'INDIVIDUAL' || candidato.formato !== 'INDIVIDUAL') {
    return { accion: 'rechazar', motivos: ['sin_asaltos_equipos'] };
  }

  if (lectura.estado === 'sin_resultados' || lectura.estado === 'no_publicado' || lectura.estado === 'error') {
    return { accion: 'sin_hechos', estado: lectura.estado, motivo: lectura.motivo };
  }

  if (primario === 'desconocido' || primario === 'pendiente') return { accion: 'diferir', motivo: 'primaria_pendiente' };
  if (primario === 'error') return { accion: 'diferir', motivo: 'primaria_con_error' };
  if (primario === 'publicado_parcial') return { accion: 'diferir', motivo: 'primaria_parcial' };
  if (primario === 'publicado_completo') return { accion: 'sin_cambios', motivo: 'primaria_publica' };

  return { accion: 'escribir', fase, cobertura: lectura.estado, publicado: lectura.publicado, asaltos: lectura.asaltos };
}
