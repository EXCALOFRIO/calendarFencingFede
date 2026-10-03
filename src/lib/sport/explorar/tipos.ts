/**
 * DTO del explorador deportivo.
 *
 * Todo lo que sale de aquí hacia el navegador se construye campo a campo (nunca
 * con un spread de la fila de la base), de modo que una columna nueva en
 * `sport_*` no llega a la pantalla sin decidirlo aquí. Ninguno lleva correo,
 * consentimiento, tutor, licencia, fecha de nacimiento completa, identificador
 * de ficha/cuenta ni ranking interno.
 */

export type Arma = 'FLORETE' | 'ESPADA' | 'SABLE';
export type Genero = 'M' | 'F' | 'MIXTO';
export type Formato = 'INDIVIDUAL' | 'EQUIPOS';
export type Ambito = 'NACIONAL' | 'INTERNACIONAL' | 'AUTONOMICO';

/**
 * Categoría tal y como la publica la fuente. `codigo` es el vocabulario de la
 * aplicación (incluye M10/M12) y `raw` el literal de la fuente; ninguno de los
 * dos implica una escalera de elegibilidad.
 */
export type CategoriaPublicada = { codigo: string; raw: string | null };

export type FiltrosPrueba = {
  temporada?: string;
  desde?: string;
  hasta?: string;
  torneo?: string;
  edicionId?: string;
  arma?: Arma;
  genero?: Genero;
  categoria?: string;
  categoriaRaw?: string;
  formato?: Formato;
  ambito?: Ambito;
};

export type FiltrosBusqueda = FiltrosPrueba & {
  /** Palabras normalizadas (sin acentos, minúsculas) de la búsqueda por nombre/alias. */
  q?: string;
  /** ISO-3166 alfa-3 en mayúsculas. */
  nacionalidad?: string;
};

export type DeportistaResumen = {
  id: string;
  nombre: string;
  /** Alias publicado que coincidió, sólo si el nombre principal no coincide. */
  alias: string | null;
  pais: string | null;
  genero: Genero | null;
  anioNacimiento: number | null;
  /** Resultados finales importados: 0 significa «ninguno importado», no «nunca compitió». */
  resultadosImportados: number;
  armas: Arma[];
  /** Personas distintas con el mismo nombre normalizado, para desambiguar. */
  mismoNombre: number;
};

/** Fecha de un ranking oficial: las fuentes actuales no publican la suya. */
export type FechaRanking = {
  sourcePublishedOn: string | null;
  observedOn: string;
  baseLectura: boolean;
};

export type EntradaRankingOficial = {
  fuente: string;
  temporada: string;
  arma: Arma;
  genero: Genero;
  categoria: CategoriaPublicada;
  formato: Formato;
  /** `null` = la fuente no clasifica la fila; nunca 0. */
  puesto: number | null;
  puntos: string | null;
  totalPublicado: number | null;
  fecha: FechaRanking;
  enlace: string | null;
};

export type ResultadoHistorial = {
  id: string;
  puesto: number | null;
  /** Literal publicado cuando no hay puesto numérico (Abandono, Ganadora…). */
  puestoPublicado: string | null;
  puntosOficiales: string | null;
  fuente: string;
  enlace: string | null;
  torneo: { id: string; nombre: string; ciudad: string | null; pais: string | null };
  /** Tipo sólo si el calendario lo documenta; nunca deducido del título. */
  tipoDocumentado: string | null;
  prueba: {
    id: string;
    arma: Arma;
    genero: Genero;
    categoria: CategoriaPublicada;
    formato: Formato;
  };
  temporada: string;
  fecha: string | null;
};

export type EstadisticaPorTipo = {
  /** `null` agrupa los torneos sin tipo documentado. */
  tipo: string | null;
  clasificaciones: number;
  mejorPuesto: number | null;
  podios: number;
  victorias: number;
  sinPuestoNumerico: number;
};

export type ResumenEstadistico = {
  pruebas: number;
  conPuesto: number;
  sinPuesto: number;
  podios: number;
  victorias: number;
  mejorPuesto: number | null;
  /** Pruebas con clasificaciones diferentes: no se escoge una fuente como ganadora. */
  conflictos: number;
  sinFecha: number;
  desde: string | null;
  hasta: string | null;
};

export type EstadisticasDeportista = {
  resumen: ResumenEstadistico;
  porCategoria: (ResumenEstadistico & {
    tipo: string | null;
    categoria: CategoriaPublicada;
    arma: Arma;
    genero: Genero;
  })[];
  porTemporada: (ResumenEstadistico & { temporada: string })[];
  categoriasRecortadas: boolean;
  temporadasRecortadas: boolean;
  /** Los controles actuales sólo eligen el ranking, no filtran las estadísticas. */
  alcance: 'historial_individual_importado';
};

export type EstadoCoberturaDto =
  | 'pendiente'
  | 'completo'
  | 'parcial'
  | 'sin_resultados'
  | 'error'
  | 'conflicto';

export type CoberturaFicha = {
  resultadosImportados: number;
  pruebasConResultado: number;
  ediciones: number;
  /** Por tipo de hecho y estado de lectura de las pruebas de la persona. */
  lecturas: { hecho: string; estado: EstadoCoberturaDto; pruebas: number }[];
  /** «Completo» es por fuente y hecho; nunca garantiza el histórico entero. */
  historiaCompleta: false;
};

export type FichaDeportiva = {
  id: string;
  nombre: string;
  alias: string[];
  pais: string | null;
  genero: Genero | null;
  /** `null` también cuando es una persona posiblemente menor que no es la propia. */
  anioNacimiento: number | null;
  /** Posible menor (sólo se conoce el año de nacimiento): la pantalla minimiza lo que enseña. */
  esMenor: boolean;
  esPropia: boolean;
  estadisticas: {
    conjunto: 'clasificaciones_individuales';
    porTipo: EstadisticaPorTipo[];
    /** Presente en el lector actual; opcional para consumidores anteriores del DTO. */
    detalle?: EstadisticasDeportista;
  };
  cobertura: CoberturaFicha;
  rankingOficial: {
    temporada: string | null;
    formato: Formato;
    temporadasDisponibles: string[];
    entradas: EntradaRankingOficial[];
  };
};

export type EstadoAsaltos =
  | 'verificado'
  | 'sin_asaltos_publicados'
  | 'parcial'
  | 'pendiente';

export type AsaltoDto = {
  id: string;
  marcador: { mios: number; rival: number };
  resultado: 'victoria' | 'derrota';
  torneo: { id: string; nombre: string };
  prueba: {
    id: string;
    arma: Arma;
    genero: Genero;
    categoria: CategoriaPublicada;
    formato: Formato;
  };
  temporada: string;
  fecha: string | null;
  fase: 'POULE' | 'TABLEAU';
  /** Poule o `tableId` tal y como lo publica la fuente. */
  rondaPublicada: string;
  enlace: string | null;
};

export type RivalResumen = {
  id: string;
  nombre: string;
  pais: string | null;
  asaltos: number;
};
