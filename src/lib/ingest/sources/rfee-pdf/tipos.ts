import type { EstadoCobertura } from '../fie-resultados';

/**
 * Tipos del lector de PDFs de resultados de la RFEE (Engarde).
 *
 * La entrada es SIEMPRE texto posicionado por página, no una cadena
 * aplanada: `unpdf` con `mergePages` pierde las columnas de las matrices y el
 * orden de lectura de un cuadro, que es justo lo que no se puede perder.
 */

export type ItemTexto = {
  /** Texto tal como lo da PDF.js (puede traer espacios y varios tokens). */
  s: string;
  /** Origen del texto, en puntos PDF; `y` crece hacia ARRIBA. */
  x: number;
  y: number;
  /** Ancho y alto del texto. */
  w: number;
  h: number;
};

export type PaginaTexto = {
  numero: number;
  ancho: number;
  alto: number;
  items: ItemTexto[];
};

/** Franja vertical de una página de la que sale un hecho. */
export type Region = { pagina: number; yMax: number; yMin: number };

export type TipoPagina =
  | 'sin_texto'
  | 'ilegible'
  | 'clasificacion_final'
  | 'poules'
  | 'cuadro'
  | 'clasificacion_intermedia'
  | 'participantes'
  | 'formula'
  | 'arbitros'
  /** Recuentos de participantes por procedencia: no publica resultados. */
  | 'estadisticas'
  | 'desconocida';

export type Formato = 'INDIVIDUAL' | 'EQUIPOS';
export type Arma = 'FLORETE' | 'ESPADA' | 'SABLE';
export type Genero = 'M' | 'F' | 'MIXTO';

export type Rechazo = {
  seccion: 'documento' | 'pagina' | 'prueba' | 'puestos' | 'poules' | 'cuadro';
  region: Region | null;
  motivo: string;
};

export type PuestoPdf = {
  /** Página + posición vertical de la fila: la identidad del hecho en un PDF. */
  sourceFactKey: string;
  /** Referencia local al documento y a la prueba (`p0001`); NO es un ID de persona. */
  ref: string;
  /** Puesto numérico publicado, repetido en empates y sin renumerar. */
  posicion: number | null;
  /** Literal de la columna de puesto cuando no es un número («Ganador», «Abandono»). */
  posicionRaw: string | null;
  nombre: string;
  club: string | null;
  /** Código de país de la columna «Nación», sólo si publica uno de tres letras. */
  pais?: string;
  region: Region;
};

/**
 * `derivado_de_totales`: los totales de la matriz obligan el valor por sí
 * solos. `derivado_de_limite`: lo obligan los totales junto con el tope de
 * tocados que la propia vuelta demuestra (ver `poules.ts`).
 */
export type OrigenMarcador = 'explicito' | 'derivado_de_totales' | 'derivado_de_limite';

export type AsaltoPdf = {
  fase: 'POULE' | 'TABLEAU';
  /** `P3` (poule 3 de la vuelta 1), `V2P3` (vuelta 2), `A16`…`A2` del cuadro, `C2` el tercer puesto. */
  ronda: string;
  /** Texto de ronda tal como lo publica el documento. */
  rondaOriginal: string;
  /** Orden canónico `refA < refB`, con el marcador orientado a cada uno. */
  refA: string;
  refB: string;
  nombreA: string;
  nombreB: string;
  puntosA: number;
  puntosB: number;
  marcador: OrigenMarcador;
  region: Region;
};

export type ExclusionesPdf = {
  /** Páginas de poule o cuadro de una prueba por equipos: no son asaltos individuales. */
  equipo: number;
  /** Participante sin pareja: avanza sin asalto. */
  bye: number;
  /** El documento no publica marcador del cruce o de la celda. */
  sinMarcador: number;
  /** Ningún ganador marcado (doble derrota o empate). */
  sinGanador: number;
  /** El marcador, el ganador o la matriz se contradicen. */
  incoherente: number;
  /** No se pudo atribuir el participante a uno solo de la clasificación. */
  identidadNoConfirmada: number;
  /** El mismo asalto en dos páginas con distinto marcador. */
  conflicto: number;
  /** El mismo asalto repetido y coincidente (se cuenta una vez). */
  duplicado: number;
};

export type CoberturaPdf = {
  estado: EstadoCobertura;
  /** Hechos que el documento publica, si el propio documento lo declara. */
  publicado: number | null;
  importado: number;
  motivo: string | null;
};

export type PruebaPdf = {
  /** Clave de la prueba dentro del documento (documento + arma/género/formato + categoría + cohorte). */
  clave: string;
  /** Líneas de cabecera tal como se leen, sin tocar. */
  cabecera: string[];
  arma: Arma | null;
  genero: Genero | null;
  formato: Formato | null;
  /** Código de categoría sólo cuando la cabecera la declara de forma inequívoca. */
  categoria: string | null;
  /** Literal de la categoría en la cabecera («M-10», «JUNIOR», «ABSOLUTO»). */
  categoriaOriginal: string | null;
  /** Subdivisión publicada: año de nacimiento («2009») o «Categoría 0-1». */
  cohorte: string | null;
  /** Categoría publicada completa, para `category_raw`. */
  categoriaPublicada: string | null;
  fecha: string | null;
  paginas: number[];
  puestos: PuestoPdf[];
  asaltos: AsaltoPdf[];
  excluidos: ExclusionesPdf;
  rechazos: Rechazo[];
  cobertura: { puestos: CoberturaPdf; poules: CoberturaPdf; cuadro: CoberturaPdf };
  estado: EstadoCobertura;
};

export type PaginaClasificada = {
  pagina: number;
  tipo: TipoPagina;
  /** Prueba a la que se atribuye la página; `null` si no se pudo atribuir. */
  prueba: string | null;
  motivo: string | null;
};

export type PerfilLectura = {
  bytes: number;
  paginas: number;
  items: number;
  ms: number;
  /** Variación del heap durante la extracción, si el entorno lo expone. */
  heapMb: number | null;
};

export type LecturaPdf = {
  url: string;
  docId: string;
  sha256: string | null;
  perfil: PerfilLectura | null;
  paginas: PaginaClasificada[];
  pruebas: PruebaPdf[];
  rechazos: Rechazo[];
  /**
   * Páginas que necesitan OCR o revisión humana. `ejecutado` es siempre
   * `false`: este lector no llama a ningún OCR ni modelo.
   */
  ocr: { necesario: boolean; paginas: number[]; ejecutado: false; motivo: string | null };
  estado: EstadoCobertura;
  error: string | null;
};
