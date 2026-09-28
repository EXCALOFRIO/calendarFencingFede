/**
 * De un fichero a texto, sea del formato que sea.
 *
 * POR QUÉ EXISTE ESTE FICHERO
 * --------------------------
 * La extracción entera se escribió suponiendo que un dossier es un PDF, y esa
 * suposición estaba dentro del código en dos sitios: `urlDeInvitacion` tiraba
 * a la basura cualquier URL que no acabara en `.pdf`, y `extraerDeDossierPdf`
 * llamaba a `unpdf` sin preguntar.
 *
 * Medido contra la API de la FIE el 27/09/2026, sobre las 23 copas del mundo
 * de los próximos 60 días: de las 96 pruebas con invitación publicada, **74
 * apuntan a un PDF y 22 a un documento de Word**. Es decir, casi una de cada
 * cuatro. Y entre esas 22 está la invitación de la Copa del Mundo de Orán, que
 * es el dossier más completo que hemos visto: pabellón con nombre propio,
 * aforo, número de pistas por sala, aire acondicionado, código de Google Maps
 * y el horario de los cinco días hora por hora.
 *
 * Así que el formato pasa a ser un dato del documento, no una suposición.
 *
 * POR QUÉ SE DETECTA POR LOS BYTES Y NO POR LA EXTENSIÓN
 * -----------------------------------------------------
 * La extensión es una pista, no un hecho: `static.fie.org` sirve ficheros con
 * el nombre que les puso quien los subió. Los formatos de este fichero se
 * reconocen por su firma, que es lo que hace `file(1)` desde 1973:
 *
 *   %PDF        -> PDF
 *   PK\x03\x04  -> ZIP, y por tanto OOXML (.docx) u ODF (.odt)
 *   D0CF11E0    -> OLE2, el .doc y el .xls de antes de 2007
 *   {\rtf       -> RTF
 *
 * La extensión solo se usa como desempate cuando los bytes no dicen nada
 * (texto plano), y para distinguir `.docx` de `.odt`, que son los dos ZIP.
 *
 * POR QUÉ NO SE USA `mammoth`
 * ---------------------------
 * `mammoth` es la biblioteca obvia para esto y se valoró en serio, porque
 * convierte a HTML y conserva las tablas —y el horario de estos dossieres
 * VIENE en tablas, así que conservar las filas no es un lujo—. Se descartó por
 * tres motivos, en este orden:
 *
 *  1. LO QUE HACE FALTA ES TEXTO, NO HTML. La cita se verifica carácter a
 *     carácter contra el mismo texto que se le manda al modelo
 *     (`extraerDeTexto`). Con `mammoth` habría que convertir su HTML a texto
 *     después, así que la parte de la que depende la verificación —qué
 *     caracteres acaban en la cadena y en qué orden— la seguiríamos escribiendo
 *     nosotros. La dependencia no nos ahorraría la parte delicada.
 *  2. LAS FILAS SE CONSERVAN IGUAL, y es el único motivo por el que se habría
 *     traído. `textoDeDocumentoOoxml` recorre `<w:tbl>/<w:tr>/<w:tc>` y junta
 *     las celdas de una fila en una línea. Comprobado contra el `.docx` real de
 *     Orán: «14:00 - 19:30  Weapon's Control for Men's Sabre Competition» sale
 *     en UNA línea, debajo de «WEDNESDAY OCTOBER 14th». Si cada celda cayera en
 *     su propia línea —que es lo que pasa si se leen los `<w:p>` a secas— la
 *     hora y el hito quedarían separados y ninguna cita del horario casaría.
 *  3. ESTO SE DESPLIEGA EN UN WORKER. `mammoth` arrastra `jszip`, `underscore`
 *     y `bluebird`, y `DecompressionStream('deflate-raw')` —que es todo lo que
 *     hace falta para un ZIP— ya está en la plataforma, en Node 22 y en
 *     Cloudflare Workers.
 *
 * Lo que sí se pierde frente a `mammoth`: los estilos y la distinción entre un
 * encabezado y un párrafo. No se usan para nada aquí.
 *
 * LOS `.doc` DE VERDAD NO SE LEEN, Y SE DICE
 * -----------------------------------------
 * El `.doc` binario (OLE2) es un formato de 1997 que necesitaría una
 * biblioteca entera. Se detecta y se devuelve `formatoNoLeible`, que acaba en
 * el libro de registro como 'sin_texto' con su motivo en castellano. El enlace
 * se guarda igual y una persona puede abrirlo: decir «no sé leer esto» es un
 * resultado, y es mejor que un error de red disfrazado.
 */

/** Los formatos que se saben distinguir. */
export type FormatoDocumento = 'pdf' | 'docx' | 'odt' | 'doc' | 'rtf' | 'texto' | 'desconocido';

/** Cuánto se lee de un fichero. Un `.docx` con fotos son 11 MB de fotos. */
export const MAX_BYTES_DOCUMENTO = 40 * 1024 * 1024;

const FIRMAS: [number[], FormatoDocumento][] = [
  [[0x25, 0x50, 0x44, 0x46], 'pdf'], // %PDF
  [[0x50, 0x4b, 0x03, 0x04], 'docx'], // PK.. -> ZIP; se afina con la extensión
  [[0x50, 0x4b, 0x05, 0x06], 'docx'], // ZIP vacío
  [[0xd0, 0xcf, 0x11, 0xe0], 'doc'], // OLE2
  [[0x7b, 0x5c, 0x72, 0x74], 'rtf'], // {\rt
];

/** ¿Los primeros bytes son estos? */
function empiezaPor(bytes: Uint8Array, firma: number[]): boolean {
  if (bytes.length < firma.length) return false;
  return firma.every((b, i) => bytes[i] === b);
}

/**
 * Qué formato es, mirando los bytes y usando la URL solo para desempatar.
 *
 * El desempate importa en un caso real: `.docx` y `.odt` son los dos un ZIP y
 * su firma es idéntica. Se distinguen por el nombre del fichero, y si no hay
 * pista se supone `docx`, que es lo que publica la FIE.
 */
export function formatoDeDocumento(bytes: Uint8Array, url = ''): FormatoDocumento {
  for (const [firma, formato] of FIRMAS) {
    if (!empiezaPor(bytes, firma)) continue;
    if (formato !== 'docx') return formato;
    const ruta = rutaDe(url);
    if (ruta.endsWith('.odt') || ruta.endsWith('.ods') || ruta.endsWith('.odp')) return 'odt';
    return 'docx';
  }

  /**
   * Sin firma reconocible: puede ser texto plano. Se comprueba que los
   * primeros bytes sean legibles antes de decirlo, porque «no tiene firma» y
   * «es texto» no son lo mismo: un binario cualquiera tampoco tiene firma.
   */
  return pareceTextoPlano(bytes) ? 'texto' : 'desconocido';
}

function rutaDe(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * ¿Los primeros 1.024 bytes son texto?
 *
 * Se mira que no haya bytes de control (salvo tabulador, salto de línea y
 * retorno de carro) y que haya al menos un carácter imprimible. Un PDF
 * escaneado, un ZIP o una imagen fallan en la primera línea.
 */
function pareceTextoPlano(bytes: Uint8Array): boolean {
  const muestra = bytes.subarray(0, 1024);
  if (muestra.length === 0) return false;
  let imprimibles = 0;
  for (const b of muestra) {
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b < 0x20) return false;
    imprimibles += 1;
  }
  return imprimibles > 0;
}

// ---------------------------------------------------------------------------
// ZIP: solo lo que hace falta para sacar UNA entrada
// ---------------------------------------------------------------------------

const FIRMA_FIN_CENTRAL = 0x06054b50;
const FIRMA_ENTRADA_CENTRAL = 0x02014b50;
/** El comentario final de un ZIP cabe en 64 KB; el registro final son 22 bytes. */
const MAX_BUSQUEDA_FIN = 22 + 65_535;

type EntradaZip = { metodo: number; comprimido: number; desplazamiento: number };

/**
 * Índice de un ZIP leído por su DIRECTORIO CENTRAL, que es el final del
 * fichero.
 *
 * Se lee por ahí y no recorriendo las cabeceras locales desde el principio a
 * propósito: la cabecera local puede traer el tamaño a cero cuando el fichero
 * se escribió en «streaming» (el dato real va detrás, en un descriptor), y con
 * eso la entrada se leería vacía sin que nada fallara. El directorio central
 * siempre tiene los tamaños de verdad.
 */
export function indiceZip(bytes: Uint8Array): Map<string, EntradaZip> {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fin = -1;
  const tope = Math.max(0, bytes.length - MAX_BUSQUEDA_FIN);
  for (let i = bytes.length - 22; i >= tope; i -= 1) {
    if (vista.getUint32(i, true) === FIRMA_FIN_CENTRAL) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error('el fichero no es un ZIP válido: falta el registro final');

  const cuantas = vista.getUint16(fin + 10, true);
  let p = vista.getUint32(fin + 16, true);
  const entradas = new Map<string, EntradaZip>();
  const nombres = new TextDecoder('utf-8');

  for (let k = 0; k < cuantas; k += 1) {
    if (p + 46 > bytes.length || vista.getUint32(p, true) !== FIRMA_ENTRADA_CENTRAL) {
      throw new Error('el directorio central del ZIP está corrupto');
    }
    const metodo = vista.getUint16(p + 10, true);
    const comprimido = vista.getUint32(p + 20, true);
    const largoNombre = vista.getUint16(p + 28, true);
    const largoExtra = vista.getUint16(p + 30, true);
    const largoComentario = vista.getUint16(p + 32, true);
    const desplazamiento = vista.getUint32(p + 42, true);
    const nombre = nombres.decode(bytes.subarray(p + 46, p + 46 + largoNombre));
    entradas.set(nombre, { metodo, comprimido, desplazamiento });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }

  return entradas;
}

/**
 * El contenido de UNA entrada del ZIP, como texto.
 *
 * Se descomprime solo la que se pide, y eso no es una micro-optimización: el
 * `.docx` de Orán son 11,5 MB, de los que 11,4 son las once imágenes del
 * membrete. El XML del texto son 138 KB. Inflar el ZIP entero sería mover
 * cincuenta veces más memoria en un Worker para tirarla acto seguido.
 */
export async function entradaZipComoTexto(
  bytes: Uint8Array,
  nombre: string,
): Promise<string | null> {
  const entradas = indiceZip(bytes);
  const entrada = entradas.get(nombre);
  if (!entrada) return null;

  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const largoNombre = vista.getUint16(entrada.desplazamiento + 26, true);
  const largoExtra = vista.getUint16(entrada.desplazamiento + 28, true);
  const inicio = entrada.desplazamiento + 30 + largoNombre + largoExtra;
  const crudo = bytes.subarray(inicio, inicio + entrada.comprimido);

  if (entrada.metodo === 0) return new TextDecoder('utf-8').decode(crudo);
  if (entrada.metodo !== 8) {
    throw new Error(`el ZIP usa el método de compresión ${entrada.metodo}, que no se lee`);
  }

  /**
   * `deflate-raw` y no `deflate`: dentro de un ZIP el flujo va SIN la cabecera
   * de zlib. Con `deflate` esto falla con un error de checksum que no dice
   * nada, y es el fallo clásico al leer un ZIP a mano.
   */
  const descomprimido = new Blob([crudo as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(descomprimido).arrayBuffer();
  return new TextDecoder('utf-8').decode(buffer);
}

// ---------------------------------------------------------------------------
// OOXML (.docx) y ODF (.odt) -> texto
// ---------------------------------------------------------------------------

/** Entidades XML, las cinco predefinidas más las numéricas. */
function desescaparXml(valor: string): string {
  return valor
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    // El `&amp;` va el ÚLTIMO o «&amp;lt;» se convertiría en «<».
    .replace(/&amp;/g, '&');
}

/**
 * Todas las marcas que importan de `word/document.xml`, en el orden en que
 * aparecen.
 *
 * Es UNA expresión y un solo recorrido porque el XML de un dossier son 138 KB
 * y hacer cinco pasadas con cinco expresiones costaría cinco veces lo mismo
 * para reconstruir después el orden, que es justo lo que no se puede perder.
 */
const RE_MARCAS_OOXML =
  /<w:tbl[\s>]|<\/w:tbl>|<w:tr[\s>]|<\/w:tr>|<w:tc[\s>]|<\/w:tc>|<w:p(?:\s[^>]*?)?\s*\/>|<w:p[\s>]|<\/w:p>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/?>|<w:tab\s*\/?>/g;

/**
 * El texto de un `word/document.xml`, con las FILAS DE TABLA enteras.
 *
 * La estructura de OOXML es `<w:tbl>` → `<w:tr>` (fila) → `<w:tc>` (celda) →
 * `<w:p>` (párrafo) → `<w:t>` (texto). Leer solo los `<w:p>`, que es lo obvio,
 * parte cada fila en tantas líneas como celdas, y con eso el horario se
 * destroza: la hora queda en una línea y el hito en la siguiente.
 *
 * Aquí las celdas de una fila se unen con dos espacios en UNA línea. Dos
 * espacios y no un tabulador porque el texto acaba en una cita que se enseña
 * en pantalla, y un tabulador en medio de una frase se ve como un hueco raro.
 */
export function textoDeDocumentoOoxml(xml: string): string {
  const lineas: string[] = [];
  let parrafo: string[] = [];
  let celda: string[] = [];
  let fila: string[] = [];
  let profundidadTabla = 0;

  const cerrarParrafo = () => {
    const texto = parrafo.join('').replace(/[ \t]+/g, ' ').trim();
    parrafo = [];
    if (profundidadTabla > 0) {
      if (texto) celda.push(texto);
      return;
    }
    if (texto) lineas.push(texto);
    // Un párrafo vacío separa apartados, y eso lo necesita
    // `rangoDeAlojamiento`, que delimita por líneas. Pero uno solo: tres
    // párrafos vacíos seguidos no son tres separaciones.
    else if (lineas.length > 0 && lineas[lineas.length - 1] !== '') lineas.push('');
  };

  for (const coincidencia of xml.matchAll(RE_MARCAS_OOXML)) {
    const marca = coincidencia[0];
    if (marca.startsWith('<w:t>') || marca.startsWith('<w:t ')) {
      parrafo.push(desescaparXml(coincidencia[1] ?? ''));
    } else if (marca.startsWith('<w:br')) {
      parrafo.push(' ');
    } else if (marca.startsWith('<w:tab')) {
      parrafo.push(' ');
    } else if (marca.startsWith('<w:tbl')) {
      cerrarParrafo();
      profundidadTabla += 1;
    } else if (marca === '</w:tbl>') {
      profundidadTabla = Math.max(0, profundidadTabla - 1);
    } else if (marca.startsWith('<w:tr')) {
      fila = [];
    } else if (marca === '</w:tr>') {
      const unida = fila.filter(Boolean).join('  ').trim();
      if (unida) lineas.push(unida);
      fila = [];
    } else if (marca.startsWith('<w:tc')) {
      celda = [];
    } else if (marca === '</w:tc>') {
      fila.push(celda.join(' ').trim());
      celda = [];
    } else if (marca === '</w:p>' || marca.endsWith('/>')) {
      /**
       * `</w:p>` cierra un párrafo, y `<w:p/>` es un párrafo vacío que se abre
       * y se cierra de golpe: Word lo usa para una línea en blanco. Tratarlo
       * como una apertura sin cierre —que es lo que pasaba— dejaba el párrafo
       * abierto y pegaba el apartado siguiente al anterior. Eso se lleva por
       * delante `rangoDeAlojamiento`, que delimita los apartados por líneas: si
       * el encabezado «ACCOMMODATION» se pega a la línea de antes, deja de ser
       * una línea corta y deja de reconocerse como encabezado.
       *
       * La condición `endsWith('/>')` solo puede ser un `<w:p/>` aquí: los
       * `<w:br/>` y `<w:tab/>` ya se han tratado más arriba y salen del bucle
       * antes de llegar a esta rama.
       */
      cerrarParrafo();
    }
    // `<w:p …>` de apertura no hace nada: el párrafo se cierra al cerrarse.
  }
  cerrarParrafo();

  return lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * El texto de un `content.xml` de OpenDocument.
 *
 * Mismo problema y misma solución con otros nombres de etiqueta: `table:table`
 * → `table:table-row` → `table:table-cell` → `text:p`. Va aquí porque son
 * veinte líneas y porque el día que la FIE publique un `.odt` —ya publica
 * `.docx`, así que no es descartable— no hay que volver a pensarlo.
 */
const RE_MARCAS_ODF =
  /<table:table[\s>]|<\/table:table>|<table:table-row[\s>]|<\/table:table-row>|<table:table-cell[\s>]|<\/table:table-cell>|<text:[ph](?:\s[^>]*)?\/?>|<\/text:[ph]>|<text:tab\s*\/?>|<text:line-break\s*\/?>|<text:s(?:\s[^>]*)?\/?>|<[^>]+>|([^<]+)/g;

export function textoDeDocumentoOdf(xml: string): string {
  const lineas: string[] = [];
  let parrafo: string[] = [];
  let celda: string[] = [];
  let fila: string[] = [];
  let profundidadTabla = 0;

  const cerrarParrafo = () => {
    const texto = parrafo.join('').replace(/[ \t]+/g, ' ').trim();
    parrafo = [];
    if (profundidadTabla > 0) {
      if (texto) celda.push(texto);
      return;
    }
    if (texto) lineas.push(texto);
    else if (lineas.length > 0 && lineas[lineas.length - 1] !== '') lineas.push('');
  };

  for (const coincidencia of xml.matchAll(RE_MARCAS_ODF)) {
    const marca = coincidencia[0];
    if (coincidencia[1] !== undefined) {
      parrafo.push(desescaparXml(coincidencia[1]));
    } else if (marca.startsWith('<text:tab') || marca.startsWith('<text:line-break')) {
      parrafo.push(' ');
    } else if (marca.startsWith('<table:table-row')) {
      fila = [];
    } else if (marca === '</table:table-row>') {
      const unida = fila.filter(Boolean).join('  ').trim();
      if (unida) lineas.push(unida);
      fila = [];
    } else if (marca.startsWith('<table:table-cell')) {
      celda = [];
    } else if (marca === '</table:table-cell>') {
      fila.push(celda.join(' ').trim());
      celda = [];
    } else if (marca.startsWith('<table:table')) {
      cerrarParrafo();
      profundidadTabla += 1;
    } else if (marca === '</table:table>') {
      profundidadTabla = Math.max(0, profundidadTabla - 1);
    } else if (marca.startsWith('</text:p') || marca.startsWith('</text:h')) {
      cerrarParrafo();
    }
  }
  cerrarParrafo();

  return lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Lo que se sabe de un fichero después de leerlo: su texto y su formato.
 *
 * `paginas` es `null` cuando el formato no tiene páginas. Un `.docx` NO tiene
 * páginas —las tiene la impresión, y depende de la fuente y del margen—, así
 * que decir «18 páginas» de un Word sería inventarse un número. Se deja a null
 * y la pantalla enseña el número de caracteres, que sí es un hecho.
 */
export type TextoDeDocumento = {
  texto: string;
  formato: FormatoDocumento;
  paginas: number | null;
  /** `false` = no hay nada que cotejar: escaneado, vacío o ilegible. */
  tieneTexto: boolean;
};

/** Por qué no se ha podido leer, en castellano y para la pantalla. */
export class FormatoNoLeible extends Error {
  readonly formato: FormatoDocumento;
  constructor(formato: FormatoDocumento, motivo: string) {
    super(motivo);
    this.name = 'FormatoNoLeible';
    this.formato = formato;
  }
}

const MOTIVOS_NO_LEIBLE: Partial<Record<FormatoDocumento, string>> = {
  doc: 'El documento es un Word antiguo (.doc binario, formato OLE2 de 1997), que no se ' +
    'sabe leer. El enlace al documento se guarda igual: se puede abrir a mano.',
  desconocido:
    'No se reconoce el formato del fichero: no es un PDF, ni un Word, ni un ' +
    'OpenDocument, ni texto. El enlace se guarda igual.',
  rtf: 'El documento está en RTF, que no se sabe leer. El enlace se guarda igual.',
};

/**
 * De bytes a texto, decidiendo por el formato.
 *
 * NO llama a ningún modelo y NO hace red: es una función de bytes a cadena,
 * probable sin nada delante. El PDF escaneado —que sí necesita un modelo— se
 * detecta aquí (`tieneTexto: false`) y lo resuelve quien llama.
 */
export async function textoDeDocumento(
  bytes: Uint8Array,
  opciones: { url?: string; minCaracteres?: number } = {},
): Promise<TextoDeDocumento> {
  const minimo = opciones.minCaracteres ?? 200;
  const formato = formatoDeDocumento(bytes, opciones.url ?? '');
  const conTexto = (texto: string, paginas: number | null): TextoDeDocumento => ({
    texto,
    formato,
    paginas,
    tieneTexto: texto.replace(/\s+/g, '').length >= minimo,
  });

  if (formato === 'pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const documento = await getDocumentProxy(bytes);
    // `mergePages: true` devuelve el documento entero como una sola cadena,
    // que es justo lo que hace falta para cotejar citas que cruzan de página.
    const { text, totalPages } = await extractText(documento, { mergePages: true });
    return conTexto(text, totalPages);
  }

  if (formato === 'docx') {
    const xml = await entradaZipComoTexto(bytes, 'word/document.xml');
    if (xml === null) {
      throw new FormatoNoLeible(
        'docx',
        'El fichero es un ZIP pero no lleva `word/document.xml`: no es un documento ' +
          'de Word. El enlace se guarda igual.',
      );
    }
    return conTexto(textoDeDocumentoOoxml(xml), null);
  }

  if (formato === 'odt') {
    const xml = await entradaZipComoTexto(bytes, 'content.xml');
    if (xml === null) {
      throw new FormatoNoLeible(
        'odt',
        'El fichero es un ZIP pero no lleva `content.xml`: no es un OpenDocument.',
      );
    }
    return conTexto(textoDeDocumentoOdf(xml), null);
  }

  if (formato === 'texto') {
    return conTexto(new TextDecoder('utf-8').decode(bytes), null);
  }

  throw new FormatoNoLeible(formato, MOTIVOS_NO_LEIBLE[formato] ?? 'Formato no legible.');
}
