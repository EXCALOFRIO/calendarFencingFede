/**
 * VIGENCIA DE LAS CIRCULARES
 *
 * QUÉ RESUELVE
 * ------------
 * `/documentos` lista 278 circulares de la RFEE y hasta ahora las presentaba
 * TODAS como igual de válidas. Pero conviven varias versiones de lo mismo:
 * «NORMATIVA COMPETICIONES EQUIPOS 2026-2027_V1» y «…_V3» están las dos en la
 * lista; el «PROTOCOLO EQUIPAJE RFEE-ADIF» sigue publicado como si valiera
 * aunque hay una circular que lo CANCELA; y «NORMATIVA PARA RANKINGS
 * NACIONALES 2021-2022» aparece cinco veces. Alguien puede abrir y seguir una
 * norma derogada, que es justo lo contrario de la regla de este proyecto.
 *
 * POR QUÉ ESTO NO LLEVA IA
 * ------------------------
 * La familia y la versión están EN EL TÍTULO y en la fecha: `_V1`/`_V3`, `bis`,
 * `actualizada`, `MODIFICACIÓN`, `SUBSANACIÓN`, `CANCELACIÓN`, `COMPLETA`,
 * `CIRCULAR nn-aa`. Sale con expresiones regulares, que es determinista,
 * gratis y comprobable con tests. Mandar 278 PDFs a un modelo para averiguar
 * lo que dice el nombre del fichero sería caro y además peor: un modelo puede
 * equivocarse al decir qué deroga a qué, y una norma marcada como derogada por
 * error es tan grave como una derogada que se sigue enseñando.
 *
 * LA REGLA CONSERVADORA (lo más importante de este fichero)
 * --------------------------------------------------------
 * Agrupar por «asunto» a secas NO funciona, y está medido: las quince
 * circulares de ELECCIONES 2024 (18-24, 19-24, 21-24, 22-24, 23-24, 27-24 …
 * 34-24) comparten asunto y NO son versiones unas de otras, son anuncios
 * distintos de un mismo proceso. Marcar catorce como «superadas» sería
 * esconder información válida.
 *
 * Así que un documento solo se marca como superado cuando hay un hermano más
 * nuevo Y ADEMÁS se cumple una de estas tres cosas:
 *
 *   a) MISMO NÚMERO DE CIRCULAR (`12-23` cinco veces, `13-25` y `13-25bis`,
 *      `09-24` y `09-24bis`). Dos ficheros con el mismo número son el mismo
 *      documento republicado, no dos normas.
 *   b) EL MÁS NUEVO LLEVA MARCA EXPLÍCITA de versión o de efecto (`_V3`,
 *      `bis`, `actualizada`, `MODIFICACIÓN`, `SUBSANACIÓN`, `CANCELACIÓN`,
 *      `COMPLETA`) y los asuntos coinciden.
 *   c) MISMO `file_hash`: es byte a byte el mismo fichero en otra URL.
 *
 * Todo lo demás se queda VIGENTE. Preferimos dejar de marcar algo que de
 * verdad está superado antes que apagar una circular que manda.
 *
 * LA CANCELACIÓN CRUZA TEMPORADAS, LA SUPERACIÓN NO
 * -------------------------------------------------
 * «CIRCULAR 01-26 CANCELACIÓN PROTOCOLO EQUIPAJE RFEE-ADIF» (temporada 26)
 * cancela «CIRCULAR 04-25 PROTOCOLO EQUIPAJE RFEE-ADIF» (temporada 25): son
 * números y temporadas distintos, así que la cancelación se busca por asunto
 * SIN temporada. La superación, en cambio, se mira dentro de la temporada: si
 * no, la circular del Campeonato de España Cadete de 2019 saldría «superada»
 * por la de 2023, que es cierto en un sentido inútil y llenaría la lista de
 * ruido.
 */

/** Marcas que el título lleva pegadas y que dicen qué clase de versión es. */
export type MarcasTitulo = {
  /** Número de `_V1`, `_V3`, `_V6`… `null` si no lo lleva. */
  version: number | null;
  /** Lleva `bis` pegado al número o al asunto. */
  bis: boolean;
  /** «actualizada», «actualizado», con o sin fecha detrás. */
  actualizada: boolean;
  /** «COMPLETA»: la RFEE la usa para la refundición del documento entero. */
  completa: boolean;
  /** «MODIFICACIÓN» de algo anterior. */
  modificacion: boolean;
  /** «SUBSANACIÓN» de un error anterior. */
  subsanacion: boolean;
  /** «CANCELACIÓN»: deroga expresamente otro documento. */
  cancelacion: boolean;
  /** Sufijo `(1)` que pone WordPress al subir el mismo nombre dos veces. */
  copiaWordpress: boolean;
  /** Sufijo `_signed`: la misma circular ya firmada. */
  firmada: boolean;
  /** Sufijo `-2`, `-3`, `-4` en el título. */
  secuencia: number | null;
};

export type AnalisisTitulo = {
  /** Número de circular normalizado, «12-23». `null` si el título no lo trae. */
  numeroCircular: string | null;
  /** Temporada en cuatro cifras, «2023-2024». `null` si no se puede saber. */
  temporada: string | null;
  /** `true` si la temporada se ha deducido de la fecha y no del título. */
  temporadaInferida: boolean;
  /** El asunto normalizado: sin número, sin temporada y sin marcas. */
  asunto: string;
  marcas: MarcasTitulo;
  /** Cómo se nombra la versión en pantalla: «V3», «bis», «actualizada»… */
  etiquetaVersion: string | null;
  /**
   * Orden de versión dentro de la familia. Más alto = manda más. Se usa como
   * primer criterio, antes que la fecha, porque «_V6» publicado en mayo manda
   * sobre «_V4» publicado en septiembre del año anterior y la fecha sola no lo
   * diría.
   */
  ordenVersion: number;
};

/**
 * Marcas diacríticas combinantes que deja `normalize('NFD')`.
 *
 * Se construye por punto de código y no se escribe literal, por el mismo
 * motivo que en `src/lib/ai/extract.ts`: escritas tal cual son invisibles en
 * el editor y cualquiera las borraría sin darse cuenta.
 */
const RE_DIACRITICOS = new RegExp(
  `[${String.fromCodePoint(0x0300)}-${String.fromCodePoint(0x036f)}]`,
  'gu',
);

/** Quita tildes y pasa a mayúsculas, que es como se comparan los títulos. */
function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(RE_DIACRITICOS, '').toUpperCase();
}

/**
 * Deja el título en palabras separadas por un espacio.
 *
 * Los ficheros de la RFEE llegan con `_`, con `-` y con mezcla de los dos para
 * lo mismo («CIRCULAR 02-24 CTO EUROPA CAD-JUN 24-bis» y
 * «CIRCULAR_02-24_CTO_EUROPA_CAD-JUN_24bis»). Los guiones ENTRE CIFRAS se
 * conservan porque son datos («11-26», «26-27»); los demás son separadores.
 */
function aPalabras(titulo: string): string {
  return sinTildes(titulo)
    .replace(/\.(PDF|DOCX?|XLSX?)$/i, '')
    .replace(/_/g, ' ')
    .replace(/(?<=[A-Z])-(?=[A-Z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Temporada deportiva de una fecha, con el corte en septiembre.
 *
 * La temporada de la RFEE va de septiembre a agosto, así que una circular del
 * 1 de octubre de 2025 es de la 2025-2026 y una del 15 de marzo de 2026
 * también. Esto NO es adivinar el contenido: es el calendario de la
 * federación, y solo se usa para agrupar cuando el título no dice la
 * temporada. Cuando se usa, queda marcado con `temporadaInferida`.
 */
export function temporadaDeFecha(fecha: Date): string {
  const anio = Number.parseInt(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric' }).format(fecha),
    10,
  );
  const mes = Number.parseInt(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', month: '2-digit' }).format(fecha),
    10,
  );
  const inicio = mes >= 9 ? anio : anio - 1;
  return `${inicio}-${inicio + 1}`;
}

/** «26-27» -> «2026-2027»; «2021-2022» se queda igual. */
function temporadaCompleta(a: string, b: string): string {
  const cuatro = (v: string) => (v.length === 4 ? v : `20${v}`);
  return `${cuatro(a)}-${cuatro(b)}`;
}

/**
 * Temporada escrita en el título, si está.
 *
 * Acepta las cuatro formas que de hecho aparecen: «2026-2027», «26-27»,
 * «18 19» (con espacio, en los ficheros de 2018) y «23-24».
 */
function temporadaDelTitulo(palabras: string): string | null {
  const cuatroCuatro = palabras.match(/\b(\d{4})\s*[-/]\s*(\d{4})\b/);
  if (cuatroCuatro) return temporadaCompleta(cuatroCuatro[1], cuatroCuatro[2]);

  const dosDos = palabras.match(/\b(\d{2})\s*[-/]\s*(\d{2})\b(?!\s*[-/]\s*\d)/g);
  if (dosDos) {
    // Se coge la ÚLTIMA: el número de circular va delante («CIRCULAR 11-26
    // COMPETICIONES POR EQUIPOS 26-27») y la temporada detrás.
    const ultima = dosDos[dosDos.length - 1].match(/(\d{2})\s*[-/]\s*(\d{2})/);
    if (ultima) {
      const a = Number.parseInt(ultima[1], 10);
      const b = Number.parseInt(ultima[2], 10);
      // Solo si son dos años consecutivos: «CAD-JUN» no es una temporada y
      // «BRONCE-4» tampoco.
      if (b === a + 1) return temporadaCompleta(ultima[1], ultima[2]);
    }
  }

  const conEspacio = palabras.match(/\b(\d{2})\s+(\d{2})\b\s*$/);
  if (conEspacio) {
    const a = Number.parseInt(conEspacio[1], 10);
    const b = Number.parseInt(conEspacio[2], 10);
    if (b === a + 1) return temporadaCompleta(conEspacio[1], conEspacio[2]);
  }

  return null;
}

/**
 * Número de circular normalizado a «nn-aa».
 *
 * Los títulos lo escriben de cinco maneras: «CIRCULAR 12-26», «CIRCULAR_19_25»,
 * «CIRCULAR_13 19», «CIRCULAR 09-24bis» y hasta «CIRCULA R23bis 23» (con la
 * errata de la federación). Se aceptan todas menos la última, que no tiene
 * arreglo determinista y se queda sin número.
 */
export function numeroCircularDe(palabras: string): string | null {
  /**
   * El cierre es `(?!\d)` y no `\b` a propósito: «CIRCULAR 09-24bis» no tiene
   * frontera de palabra entre el «24» y la «b», así que con `\b` el número se
   * perdía y la circular acababa en la familia de otra temporada. Pasó con
   * «CIRCULAR 11-24bis CLASIFICADOS CTO ESPAÑA SENIOR 24», que cayó junto a la
   * 14-23 y la marcó como superada sin serlo.
   */
  const m = palabras.match(/\bCIRCULAR\s+(\d{1,3})\s*(?:-|\s)\s*(\d{2})(?!\d)/);
  if (!m) return null;
  return `${Number.parseInt(m[1], 10)}-${m[2]}`;
}

/** Lee todas las marcas de versión y de efecto que lleve el título. */
export function marcasDe(palabras: string): MarcasTitulo {
  const version = palabras.match(/\bV(\d{1,2})\b/);
  const secuencia = palabras.match(/\b(\d{4})\s*-\s*([2-9])\b/);

  return {
    version: version ? Number.parseInt(version[1], 10) : null,
    // `bis` aparece pegado («24bis», «12-21BIS») y separado («24-bis», «5bis»).
    bis: /BIS\b/.test(palabras),
    actualizada: /\bACTUALIZAD[AO]/.test(palabras),
    completa: /\bCOMPLETA\b/.test(palabras),
    modificacion: /\bMODIFICACION\b/.test(palabras),
    subsanacion: /\bSUBSANACION\b/.test(palabras),
    cancelacion: /\bCANCELACION\b/.test(palabras),
    copiaWordpress: /\(\d+\)\s*$/.test(palabras),
    firmada: /\bSIGNED\b/.test(palabras),
    secuencia: secuencia ? Number.parseInt(secuencia[2], 10) : null,
  };
}

/** Palabras que son marca y no asunto: se quitan para poder comparar asuntos. */
const RE_MARCAS_FUERA = [
  /\bV\d{1,2}\b/g,
  // `bis` llega pegado («24bis»), con guion («24-bis») y suelto («5bis»). El
  // número que lo precede es el año, no parte del asunto, así que se va con él.
  /\d*\s*-?\s*BIS\b/g,
  /**
   * Sin `\b` al cierre y comiéndose lo que venga pegado detrás: el título real
   * es «…EQUIPOS actualizadaSept25», todo junto, así que con `\bACTUALIZADA\b`
   * no casaba nada y el asunto se quedaba con «ACTUALIZADASEPT25» dentro. No
   * se lleva por delante «ACTUALIZACIÓN» («CURSO ACTUALIZACION ARBITRAJE»),
   * que lleva C donde esta lleva D.
   */
  /\bACTUALIZAD[AO][A-Z]*\d*/g,
  /\bCOMPLETA\b/g,
  /\bMODIFICACION\b/g,
  /\bSUBSANACION\b/g,
  /\bCANCELACION\b/g,
  /\bCLARIFICACION\b/g,
  /\bSIGNED\b/g,
  /\(\d+\)/g,
  // Meses y estaciones que acompañan a «actualizada»: «actualizadaSept25»,
  // «_actualizado_marzo_19», «_actualizada_sept_2025».
  /\b(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPT|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\b/g,
];

/**
 * El ASUNTO: de qué habla el documento, sin número, sin temporada y sin marcas.
 *
 * Es la clave con la que se reconoce que dos ficheros son el mismo documento.
 * «CIRCULAR 02-24 CTO EUROPA CAD-JUN 24-bis» y «CIRCULAR_02-24_CTO_EUROPA_CAD-JUN_24»
 * dan los dos «CTO EUROPA CAD JUN».
 */
export function asuntoDe(titulo: string): string {
  let t = aPalabras(titulo);

  // Fuera el encabezado «CIRCULAR nn-aa» y el «NORMATIVA» inicial se conserva
  // (forma parte del asunto: distingue la normativa de rankings de la de equipos).
  t = t.replace(/^CIRCULAR\s+\d{1,3}\s*(?:-|\s)\s*\d{2}\b/, ' ');
  t = t.replace(/^CIRCULAR\b/, ' ');
  // «CIRCULA R23bis 23»: la errata se limpia aparte.
  t = t.replace(/^CIRCULA\s+R\d{1,3}\s*BIS\s*\d{2}\b/, ' ');

  for (const re of RE_MARCAS_FUERA) t = t.replace(re, ' ');

  // Fuera las temporadas y los años sueltos: la temporada se guarda aparte y
  // dejarla dentro rompería el emparejado entre «… 2025» y «… 25».
  t = t.replace(/\b\d{4}\s*[-/]\s*\d{4}\b/g, ' ');
  t = t.replace(/\b\d{2}\s*[-/]\s*\d{2}\b/g, ' ');
  t = t.replace(/\b(19|20)\d{2}\b/g, ' ');
  /**
   * Cifras sueltas de una o dos posiciones.
   *
   * Son SIEMPRE años abreviados o restos de una marca: «…_actualizado_marzo_19»
   * deja un 19, «24-bis» deja un 24 y «ELECCIONES 2024-2» deja un 2. Sin esto,
   * «NORMATIVA … 2018-19_actualizado_marzo_19» y «NORMATIVA … 2019-20» caían en
   * familias distintas por un «19» de más.
   *
   * No se lleva por delante nada que importe porque las categorías van pegadas
   * a su letra («M17», «U23», «SUB23») y `\b` no parte una palabra por dentro.
   */
  t = t.replace(/\b\d{1,2}\b/g, ' ');

  // «DE», «DEL», «PARA», «POR», «A», «LA», «LOS»: sobran para comparar y son
  // la diferencia entre «NORMATIVA COMPETICIONES EQUIPOS» y «NORMATIVA
  // COMPETICIÓN DE EQUIPOS», que son el mismo documento.
  t = t.replace(/\b(DE|DEL|PARA|POR|LA|LAS|LOS|EL|Y|EN|A)\b/g, ' ');

  // Singular/plural de las palabras que la RFEE alterna sin criterio.
  t = t
    .replace(/\bCOMPETICIONES\b/g, 'COMPETICION')
    .replace(/\bRANKINGS\b/g, 'RANKING')
    .replace(/\bNORMATIVAS\b/g, 'NORMATIVA')
    .replace(/\bNACIONALES\b/g, 'NACIONAL')
    .replace(/\bEQUIPO\b/g, 'EQUIPOS')
    .replace(/\bESPANA\b/g, 'ESPANA')
    .replace(/\bCTO\b/g, 'CAMPEONATO')
    .replace(/\bCAMPEONATOS\b/g, 'CAMPEONATO');

  return t.replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Cómo se llama la versión en pantalla, y cuánto manda.
 *
 * El orden importa: una `_V3` manda sobre una `bis`, y una `bis` sobre el
 * documento a secas. `COMPLETA` y `actualizada` van por encima del original
 * pero por debajo de una versión numerada, porque la RFEE las usa para
 * refundir y luego sigue numerando.
 */
function versionDe(marcas: MarcasTitulo): { etiqueta: string | null; orden: number } {
  if (marcas.version !== null) {
    return { etiqueta: `V${marcas.version}`, orden: 1000 + marcas.version };
  }
  if (marcas.subsanacion) return { etiqueta: 'subsanación', orden: 900 };
  if (marcas.cancelacion) return { etiqueta: 'cancelación', orden: 890 };
  if (marcas.modificacion) return { etiqueta: 'modificación', orden: 880 };
  if (marcas.completa) return { etiqueta: 'completa', orden: 700 };
  if (marcas.actualizada) return { etiqueta: 'actualizada', orden: 600 };
  if (marcas.bis) return { etiqueta: 'bis', orden: 500 };
  if (marcas.firmada) return { etiqueta: 'firmada', orden: 400 };
  if (marcas.secuencia !== null) {
    return { etiqueta: `${marcas.secuencia}.ª`, orden: 300 + marcas.secuencia };
  }
  if (marcas.copiaWordpress) return { etiqueta: 'copia', orden: 50 };
  return { etiqueta: null, orden: 100 };
}

/**
 * ¿La marca dice que este documento sustituye a OTRA circular distinta?
 *
 * Aquí está la distinción que decide si la pantalla acierta o esconde normas
 * válidas, y salió de mirar los 278 títulos reales. Hay dos clases de marca y
 * NO valen lo mismo:
 *
 *  · Marcas del MISMO documento: `_V3`, `bis`, `actualizada`, `COMPLETA`,
 *    `_signed`, `(1)`. Todas dicen «esta es otra versión de ESTE documento».
 *    «CIRCULAR 09-24bis» es la 09-24 otra vez, y «CIRCULAR_04-23_…_COMPLETA»
 *    es la 04-23 refundida. No dicen nada de la 05-23 ni de la 06-23.
 *  · Marcas de EFECTO SOBRE OTRA: `MODIFICACIÓN`, `SUBSANACIÓN`,
 *    `CANCELACIÓN`. Estas sí nombran el acto de corregir o derogar un
 *    documento anterior, y son las únicas que justifican cruzar de un número
 *    de circular a otro.
 *
 * La primera versión de este fichero no separaba las dos y el resultado fue
 * medible: `CIRCULAR_21-24_ELECCIONES_2024-3_signed` marcaba como superadas
 * las TRECE circulares de elecciones restantes, que son anuncios distintos de
 * un mismo proceso electoral. Trece normas válidas apagadas por un `_signed`.
 */
export function marcaSobreOtroDocumento(marcas: MarcasTitulo): boolean {
  return marcas.modificacion || marcas.subsanacion || marcas.cancelacion;
}

/**
 * Aquí había un `tieneMarcaExplicita()` que devolvía `true` para CUALQUIERA de
 * las marcas, de las dos clases. Se ha borrado a propósito y no por limpieza:
 * era justo la función que provocaba el fallo de las trece circulares de
 * elecciones, y dejarla exportada invitaba a volver a usarla para decidir
 * quién sustituye a quién. La única pregunta válida para eso es la de arriba.
 */

/** Analiza un título (y su fecha, para la temporada) sin tocar la base. */
export function analizarTitulo(titulo: string, publicadoEl: Date): AnalisisTitulo {
  const palabras = aPalabras(titulo);
  const marcas = marcasDe(palabras);
  const numeroCircular = numeroCircularDe(palabras);

  const delTitulo = temporadaDelTitulo(palabras);
  /**
   * Si el título no dice la temporada pero el número de circular sí trae el
   * año («12-26» = la doce de la temporada 26), ese año manda sobre la fecha
   * de publicación: es un dato del documento, no una deducción nuestra.
   */
  const delNumero = numeroCircular
    ? (() => {
        const aa = Number.parseInt(numeroCircular.split('-')[1], 10);
        const inicio = 2000 + aa;
        return `${inicio}-${inicio + 1}`;
      })()
    : null;

  const temporada = delTitulo ?? delNumero ?? temporadaDeFecha(publicadoEl);
  const { etiqueta, orden } = versionDe(marcas);

  return {
    numeroCircular,
    temporada,
    temporadaInferida: delTitulo === null && delNumero === null,
    asunto: asuntoDe(titulo),
    marcas,
    etiquetaVersion: etiqueta,
    ordenVersion: orden,
  };
}

// ---------------------------------------------------------------------------
// Familias: qué sustituye a qué
// ---------------------------------------------------------------------------

export type DocumentoParaVigencia = {
  id: string;
  title: string;
  publishedAt: Date;
  /** SHA-256 del PDF. `null` mientras no se haya descargado. */
  fileHash: string | null;
  /** Id del adjunto en WordPress: sube con cada subida, así que desempata. */
  wpMediaId: number;
};

export type EstadoVigencia =
  /** Es la versión que manda de su familia. */
  | 'vigente'
  /** Hay una versión posterior de lo mismo. */
  | 'superada'
  /** Otro documento la deroga expresamente. */
  | 'cancelada'
  /** Es byte a byte el mismo fichero que otra entrada. */
  | 'duplicada';

export type VigenciaCalculada = {
  documentoId: string;
  /** Clave de familia: asunto + temporada. Estable y legible al depurar. */
  familia: string;
  asunto: string;
  temporada: string | null;
  temporadaInferida: boolean;
  numeroCircular: string | null;
  etiquetaVersion: string | null;
  ordenVersion: number;
  estado: EstadoVigencia;
  /** La versión que manda, cuando este documento no es la que manda. */
  sustituidaPorId: string | null;
  /** La entrada que se queda, cuando este documento es un duplicado exacto. */
  duplicadoDeId: string | null;
  /** Por qué, en castellano y para leerlo en pantalla tal cual. */
  motivo: string | null;
  /** Cuántas versiones tiene la familia, contando esta. */
  versionesEnFamilia: number;
};

/** Clave de familia. El asunto vacío se aísla para que no agrupe con nada. */
function claveFamilia(a: AnalisisTitulo, id: string): string {
  if (a.asunto === '') return `sin-asunto:${id}`;
  return `${a.asunto}|${a.temporada ?? 'sin-temporada'}`;
}

/**
 * Ordena de «manda más» a «manda menos» dentro de una familia.
 *
 * Primero la versión declarada, luego la fecha, y al final el id de WordPress,
 * que sube con cada subida. El último desempate hace falta de verdad: las
 * cuatro copias de «CIRCULAR 03-23 CTO MUNDO CAD-JUN» tienen la MISMA fecha, y
 * sin él el orden dependería del orden en que Postgres devolviera las filas, o
 * sea que la pantalla cambiaría de un refresco a otro.
 */
function mandaMas(
  a: { analisis: AnalisisTitulo; doc: DocumentoParaVigencia },
  b: { analisis: AnalisisTitulo; doc: DocumentoParaVigencia },
): number {
  return (
    b.analisis.ordenVersion - a.analisis.ordenVersion ||
    b.doc.publishedAt.getTime() - a.doc.publishedAt.getTime() ||
    b.doc.wpMediaId - a.doc.wpMediaId
  );
}

/**
 * Calcula el estado de vigencia de una lista de documentos.
 *
 * Función PURA: recibe las 278 filas y devuelve las 278 decisiones. No toca la
 * base, no descarga nada y no llama a ningún modelo, así que se puede probar
 * entera con casos reales feos.
 */
export function calcularVigencia(
  documentos: DocumentoParaVigencia[],
): VigenciaCalculada[] {
  const analizados = documentos.map((doc) => ({
    doc,
    analisis: analizarTitulo(doc.title, doc.publishedAt),
  }));

  // --- 1. Duplicados exactos: mismo SHA-256 del fichero ---
  const porHash = new Map<string, typeof analizados>();
  for (const item of analizados) {
    if (!item.doc.fileHash) continue;
    const lista = porHash.get(item.doc.fileHash) ?? [];
    lista.push(item);
    porHash.set(item.doc.fileHash, lista);
  }

  /** documentoId -> id de la entrada que se queda. */
  const duplicadoDe = new Map<string, string>();
  for (const lista of porHash.values()) {
    if (lista.length < 2) continue;
    const ordenada = [...lista].sort(mandaMas);
    const seQueda = ordenada[0];
    for (const item of ordenada.slice(1)) {
      duplicadoDe.set(item.doc.id, seQueda.doc.id);
    }
  }

  // --- 2. Familias por asunto + temporada ---
  const familias = new Map<string, typeof analizados>();
  for (const item of analizados) {
    const clave = claveFamilia(item.analisis, item.doc.id);
    const lista = familias.get(clave) ?? [];
    lista.push(item);
    familias.set(clave, lista);
  }

  // --- 3. Cancelaciones, que cruzan temporadas: se indexan por asunto solo ---
  const porAsunto = new Map<string, typeof analizados>();
  for (const item of analizados) {
    if (item.analisis.asunto === '') continue;
    const lista = porAsunto.get(item.analisis.asunto) ?? [];
    lista.push(item);
    porAsunto.set(item.analisis.asunto, lista);
  }

  /** documentoId -> el documento que lo deroga. */
  const canceladoPor = new Map<string, DocumentoParaVigencia>();
  for (const item of analizados) {
    if (!item.analisis.marcas.cancelacion) continue;
    const hermanos = porAsunto.get(item.analisis.asunto) ?? [];
    for (const otro of hermanos) {
      if (otro.doc.id === item.doc.id) continue;
      if (otro.analisis.marcas.cancelacion) continue;
      // Solo se cancela lo ANTERIOR: una circular no deroga el futuro.
      if (otro.doc.publishedAt.getTime() > item.doc.publishedAt.getTime()) continue;
      canceladoPor.set(otro.doc.id, item.doc);
    }
  }

  // --- 4. Decisión por documento ---
  const porId = new Map(analizados.map((i) => [i.doc.id, i]));
  const salida: VigenciaCalculada[] = [];

  for (const [clave, lista] of familias) {
    const ordenada = [...lista].sort(mandaMas);
    const queManda = ordenada[0];

    /**
     * El que manda DE CADA NÚMERO DE CIRCULAR, que no es el mismo que el de la
     * familia. En «CTO EUROPA CAD-JUN» de la temporada 25 conviven tres copias
     * de la 01-25 y una 03-25: las dos copias viejas de la 01-25 las sustituye
     * la 01-25 buena, no la 03-25, que es otra circular distinta.
     */
    const mandaDelNumero = new Map<string, (typeof ordenada)[number]>();
    for (const item of ordenada) {
      const n = item.analisis.numeroCircular;
      if (n && !mandaDelNumero.has(n)) mandaDelNumero.set(n, item);
    }

    /**
     * Una familia en la que NINGÚN documento trae número de circular son las
     * normativas («NORMATIVA PARA RANKINGS NACIONALES 23-24»). Ahí el asunto y
     * la temporada identifican el documento por sí solos: hay una normativa de
     * rankings por temporada, no varias, así que la más nueva sustituye a las
     * anteriores aunque ninguna lleve marca. En las circulares no se puede
     * suponer eso, y por eso la regla está acotada a este caso.
     */
    const familiaSinNumeros = ordenada.every((i) => i.analisis.numeroCircular === null);

    for (const item of ordenada) {
      const { doc, analisis } = item;
      const base = {
        documentoId: doc.id,
        familia: clave,
        asunto: analisis.asunto,
        temporada: analisis.temporada,
        temporadaInferida: analisis.temporadaInferida,
        numeroCircular: analisis.numeroCircular,
        etiquetaVersion: analisis.etiquetaVersion,
        ordenVersion: analisis.ordenVersion,
        versionesEnFamilia: ordenada.length,
      };

      // 4a. Duplicado exacto: manda la regla más fuerte, porque no hay nada
      // que decidir. Es el mismo fichero.
      const dupDe = duplicadoDe.get(doc.id);
      if (dupDe) {
        const original = porId.get(dupDe);
        salida.push({
          ...base,
          estado: 'duplicada',
          sustituidaPorId: null,
          duplicadoDeId: dupDe,
          motivo:
            'Es exactamente el mismo fichero que otra entrada de la lista ' +
            `(mismo hash SHA-256)${original ? `: «${original.doc.title}»` : ''}.`,
        });
        continue;
      }

      // 4b. Cancelada expresamente por otra circular.
      const cancel = canceladoPor.get(doc.id);
      if (cancel) {
        salida.push({
          ...base,
          estado: 'cancelada',
          sustituidaPorId: cancel.id,
          duplicadoDeId: null,
          motivo: `Cancelada por «${cancel.title}».`,
        });
        continue;
      }

      // 4c. Superada, pero solo con la regla conservadora de la cabecera.
      const sustituye = (() => {
        // (a) Mismo número de circular: manda la copia más nueva de ESE número.
        const n = analisis.numeroCircular;
        if (n) {
          const jefe = mandaDelNumero.get(n);
          if (jefe && jefe.doc.id !== doc.id) return jefe;
        }

        // (d) Familia de normativas (ningún miembro trae número de circular):
        // hay una normativa por temporada, así que la más nueva manda.
        if (familiaSinNumeros) {
          return doc.id === queManda.doc.id ? null : queManda;
        }

        /**
         * (b) Una circular POSTERIOR que dice expresamente que modifica o
         * subsana. Se exige que sea posterior por fecha, no solo que tenga más
         * orden de versión: si no, una «COMPLETA» del 27 de marzo saldría
         * mandando sobre circulares del 5 y el 10 de abril, que es lo que
         * pasaba con la 04-23 frente a la 05-23 y la 06-23.
         */
        const posteriores = ordenada.filter(
          (otro) =>
            otro.doc.id !== doc.id &&
            marcaSobreOtroDocumento(otro.analisis.marcas) &&
            otro.doc.publishedAt.getTime() > doc.publishedAt.getTime(),
        );
        return posteriores.length > 0 ? posteriores[0] : null;
      })();

      if (sustituye) {
        const etiqueta = sustituye.analisis.etiquetaVersion;
        salida.push({
          ...base,
          estado: 'superada',
          sustituidaPorId: sustituye.doc.id,
          duplicadoDeId: null,
          motivo:
            `Sustituida por «${sustituye.doc.title}»` +
            (etiqueta ? ` (${etiqueta})` : '') +
            '.',
        });
        continue;
      }

      // 4d. Todo lo demás manda por sí mismo.
      salida.push({
        ...base,
        estado: 'vigente',
        sustituidaPorId: null,
        duplicadoDeId: null,
        motivo: null,
      });
    }
  }

  return salida;
}

/** Recuento para el informe del panel y para los tests. */
export function resumirVigencia(filas: VigenciaCalculada[]): {
  total: number;
  familias: number;
  vigentes: number;
  superadas: number;
  canceladas: number;
  duplicadas: number;
  familiasConVarias: number;
} {
  const familias = new Set(filas.map((f) => f.familia));
  const conVarias = new Set(
    filas.filter((f) => f.versionesEnFamilia > 1).map((f) => f.familia),
  );
  return {
    total: filas.length,
    familias: familias.size,
    vigentes: filas.filter((f) => f.estado === 'vigente').length,
    superadas: filas.filter((f) => f.estado === 'superada').length,
    canceladas: filas.filter((f) => f.estado === 'cancelada').length,
    duplicadas: filas.filter((f) => f.estado === 'duplicada').length,
    familiasConVarias: conVarias.size,
  };
}
