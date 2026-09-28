import { describe, expect, it } from 'vitest';
import {
  FormatoNoLeible,
  entradaZipComoTexto,
  formatoDeDocumento,
  indiceZip,
  textoDeDocumento,
  textoDeDocumentoOdf,
  textoDeDocumentoOoxml,
} from '@/lib/ai/documento';

/**
 * ===========================================================================
 * LEER UN DOCUMENTO QUE NO ES UN PDF
 * ===========================================================================
 *
 * De las 96 invitaciones que la FIE publica para los próximos 60 días, 22 son
 * documentos de Word. La de la Copa del Mundo de Orán es una de ellas, y es el
 * dossier más completo que hemos visto. Hasta ahora se tiraban a la basura dos
 * veces: `urlDeInvitacion` no guardaba el enlace y `extraerDeDossierPdf` habría
 * llamado a `unpdf` sobre un ZIP.
 *
 * LOS FIXTURES SE CONSTRUYEN AQUÍ, NO SE COPIAN
 * ---------------------------------------------
 * No hay ni un byte de un documento de la FIE en este fichero, y es a
 * propósito: sus términos exigen permiso escrito para almacenar su contenido,
 * y la regla del proyecto es que el documento se ENLAZA y no se rehospeda. Un
 * fixture es una copia. Así que el `.docx` de las pruebas se fabrica byte a
 * byte con `docxDePrueba`, y lo que se copia de Orán es la FORMA del problema
 * —el horario en una tabla de dos columnas— con texto inventado.
 *
 * LO QUE DE VERDAD SE PRUEBA AQUÍ
 * -------------------------------
 * Que las FILAS DE TABLA no se parten. Es el único detalle del que depende que
 * la extracción funcione sobre estos documentos: en OOXML una tabla es
 * `<w:tbl>/<w:tr>/<w:tc>/<w:p>`, así que leer solo los `<w:p>` —que es lo
 * obvio— deja la hora en una línea y el hito en la siguiente. Con eso, la cita
 * «14:00 - 19:30 Control de armas» no existe en el texto, no se verifica, y el
 * horario entero se descarta sin que nada falle.
 */

// ---------------------------------------------------------------------------
// Un ZIP de verdad, construido a mano
// ---------------------------------------------------------------------------

/** CRC-32, para que el ZIP que se fabrica lo pueda abrir cualquier programa. */
function crc32(datos: Uint8Array): number {
  let tabla = (crc32 as { tabla?: number[] }).tabla;
  if (!tabla) {
    tabla = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabla[n] = c >>> 0;
    }
    (crc32 as { tabla?: number[] }).tabla = tabla;
  }
  let crc = 0xffffffff;
  for (const b of datos) crc = tabla[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateCrudo(datos: Uint8Array): Promise<Uint8Array> {
  const flujo = new Blob([datos as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/**
 * Un ZIP con las entradas que se le pasen.
 *
 * `comprimir` decide el método: `false` = almacenado (método 0), `true` =
 * deflate (método 8). Se prueban LOS DOS porque los dos existen en la
 * naturaleza —Word comprime, pero el `mimetype` de un ODF va siempre
 * almacenado por norma— y porque el método 8 es el que necesita
 * `DecompressionStream`, que es la única parte de esto que depende de la
 * plataforma.
 */
async function zipDePrueba(
  entradas: { nombre: string; contenido: string }[],
  comprimir = true,
): Promise<Uint8Array> {
  const codificador = new TextEncoder();
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let desplazamiento = 0;

  for (const entrada of entradas) {
    const nombre = codificador.encode(entrada.nombre);
    const crudo = codificador.encode(entrada.contenido);
    const datos = comprimir ? await deflateCrudo(crudo) : crudo;
    const metodo = comprimir ? 8 : 0;
    const suma = crc32(crudo);

    const local = new Uint8Array(30 + nombre.length + datos.length);
    const vl = new DataView(local.buffer);
    vl.setUint32(0, 0x04034b50, true);
    vl.setUint16(4, 20, true);
    vl.setUint16(8, metodo, true);
    vl.setUint32(14, suma, true);
    vl.setUint32(18, datos.length, true);
    vl.setUint32(22, crudo.length, true);
    vl.setUint16(26, nombre.length, true);
    local.set(nombre, 30);
    local.set(datos, 30 + nombre.length);
    locales.push(local);

    const central = new Uint8Array(46 + nombre.length);
    const vc = new DataView(central.buffer);
    vc.setUint32(0, 0x02014b50, true);
    vc.setUint16(4, 20, true);
    vc.setUint16(6, 20, true);
    vc.setUint16(10, metodo, true);
    vc.setUint32(16, suma, true);
    vc.setUint32(20, datos.length, true);
    vc.setUint32(24, crudo.length, true);
    vc.setUint16(28, nombre.length, true);
    vc.setUint32(42, desplazamiento, true);
    central.set(nombre, 46);
    centrales.push(central);

    desplazamiento += local.length;
  }

  const largoCentral = centrales.reduce((n, c) => n + c.length, 0);
  const fin = new Uint8Array(22);
  const vf = new DataView(fin.buffer);
  vf.setUint32(0, 0x06054b50, true);
  vf.setUint16(8, entradas.length, true);
  vf.setUint16(10, entradas.length, true);
  vf.setUint32(12, largoCentral, true);
  vf.setUint32(16, desplazamiento, true);

  const partes = [...locales, ...centrales, fin];
  const total = partes.reduce((n, p) => n + p.length, 0);
  const salida = new Uint8Array(total);
  let i = 0;
  for (const parte of partes) {
    salida.set(parte, i);
    i += parte.length;
  }
  return salida;
}

/**
 * El `word/document.xml` de un dossier inventado, con la MISMA forma que el de
 * Orán: párrafos sueltos para los datos del pabellón y una TABLA de dos
 * columnas para el horario.
 */
const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
  <w:p><w:r><w:t>INVITACIÓN — COPA DEL MUNDO DE PRUEBA</w:t></w:r></w:p>
  <w:p><w:r><w:t xml:space="preserve">Nombre del pabellón: </w:t></w:r><w:r><w:t>Palacio Municipal de Deportes</w:t></w:r></w:p>
  <w:p><w:r><w:t>Aforo: 7.000 localidades</w:t></w:r></w:p>
  <w:p><w:r><w:t>Pistas: Sala 1: 8 pistas + pista de podio / Sala 2: 8 pistas</w:t></w:r></w:p>
  <w:p><w:r><w:t>Ubicación en Google Maps: PFH3+W7 Palacio Municipal, Ciudad</w:t></w:r></w:p>
  <w:p/>
  <w:p><w:r><w:t>HORARIO</w:t></w:r></w:p>
  <w:tbl>
    <w:tr>
      <w:tc><w:p><w:r><w:t>MIÉRCOLES 14 DE OCTUBRE</w:t></w:r></w:p></w:tc>
      <w:tc><w:p/></w:tc>
    </w:tr>
    <w:tr>
      <w:tc><w:p><w:r><w:t>14:00 - 19:30</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>Control de armas de sable masculino</w:t></w:r></w:p></w:tc>
    </w:tr>
    <w:tr>
      <w:tc><w:p><w:r><w:t>09:00</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>Apertura del pabellón</w:t></w:r></w:p></w:tc>
    </w:tr>
  </w:tbl>
  <w:p><w:r><w:t>Cuotas: 80 € individual y 400 € por equipos &amp; sin IVA</w:t></w:r></w:p>
  <w:p><w:r><w:t xml:space="preserve">Se paga en efectivo</w:t></w:r><w:br/><w:r><w:t>o por transferencia.</w:t></w:r></w:p>
</w:body>
</w:document>`;

const CONTENT_XML_ODF = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oo" xmlns:text="urn:t" xmlns:table="urn:tb">
<office:body><office:text>
  <text:h>HORARIO</text:h>
  <table:table>
    <table:table-row>
      <table:table-cell><text:p>14:00 - 19:30</text:p></table:table-cell>
      <table:table-cell><text:p>Control de armas</text:p></table:table-cell>
    </table:table-row>
  </table:table>
  <text:p>Aforo: 7.000 localidades</text:p>
</office:text></office:body>
</office:document-content>`;

async function docxDePrueba(comprimir = true): Promise<Uint8Array> {
  return zipDePrueba(
    [
      { nombre: '[Content_Types].xml', contenido: '<Types/>' },
      { nombre: 'word/document.xml', contenido: DOCUMENT_XML },
    ],
    comprimir,
  );
}

// ---------------------------------------------------------------------------
// 1. Reconocer el formato
// ---------------------------------------------------------------------------

describe('el formato se reconoce por los bytes, no por la extensión', () => {
  const conFirma = (bytes: number[], resto = 300) =>
    new Uint8Array([...bytes, ...new Array(resto).fill(0x41)]);

  it('un PDF es un PDF aunque la URL diga otra cosa', () => {
    const pdf = conFirma([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(formatoDeDocumento(pdf, 'https://x/y.docx')).toBe('pdf');
  });

  it('un ZIP es .docx salvo que la URL diga .odt', async () => {
    const zip = await docxDePrueba();
    expect(formatoDeDocumento(zip, 'https://x/y.docx')).toBe('docx');
    expect(formatoDeDocumento(zip, 'https://x/y.odt')).toBe('odt');
    // Sin pista: se supone Word, que es lo que publica la FIE.
    expect(formatoDeDocumento(zip)).toBe('docx');
  });

  it('el .doc binario de 1997 se reconoce, para poder decir que no se lee', () => {
    expect(formatoDeDocumento(conFirma([0xd0, 0xcf, 0x11, 0xe0]), 'x.doc')).toBe('doc');
  });

  it('un RTF se reconoce por su llave', () => {
    expect(formatoDeDocumento(conFirma([0x7b, 0x5c, 0x72, 0x74, 0x66]))).toBe('rtf');
  });

  it('texto plano es «texto» y un binario cualquiera es «desconocido»', () => {
    expect(formatoDeDocumento(new TextEncoder().encode('Cuota: 80 EUR\n'))).toBe('texto');
    // Un byte nulo descarta el texto: es lo que distingue una cadena de un
    // binario sin firma conocida.
    expect(formatoDeDocumento(new Uint8Array([0x41, 0x00, 0x42, 0x43]))).toBe('desconocido');
    expect(formatoDeDocumento(new Uint8Array())).toBe('desconocido');
  });
});

// ---------------------------------------------------------------------------
// 2. El ZIP
// ---------------------------------------------------------------------------

describe('el ZIP se lee por su directorio central', () => {
  it('lista las entradas y saca la que se le pide, comprimida o no', async () => {
    for (const comprimir of [true, false]) {
      const zip = await docxDePrueba(comprimir);
      expect([...indiceZip(zip).keys()]).toEqual([
        '[Content_Types].xml',
        'word/document.xml',
      ]);
      const xml = await entradaZipComoTexto(zip, 'word/document.xml');
      expect(xml).toBe(DOCUMENT_XML);
    }
  });

  it('una entrada que no existe es null, no una excepción', async () => {
    const zip = await docxDePrueba();
    expect(await entradaZipComoTexto(zip, 'word/no-existe.xml')).toBeNull();
  });

  it('lo que no es un ZIP se dice con un mensaje que se entiende', () => {
    expect(() => indiceZip(new TextEncoder().encode('esto no es un zip'))).toThrow(
      /no es un ZIP/i,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. OOXML -> texto: LAS FILAS DE TABLA
// ---------------------------------------------------------------------------

describe('el texto de un Word conserva las filas de tabla', () => {
  const texto = textoDeDocumentoOoxml(DOCUMENT_XML);

  it('la hora y el hito quedan en LA MISMA línea', () => {
    /**
     * Esta es la prueba que justifica todo el fichero. Si las celdas cayeran en
     * líneas distintas, esta cita no existiría en el texto, el modelo no podría
     * copiarla y `verificarPropuestas` descartaría el horario entero.
     */
    expect(texto).toContain('14:00 - 19:30  Control de armas de sable masculino');
    expect(texto).toContain('09:00  Apertura del pabellón');
  });

  it('el día de la tabla sale como su propia línea, encima de sus horas', () => {
    const lineas = texto.split('\n');
    const dia = lineas.indexOf('MIÉRCOLES 14 DE OCTUBRE');
    expect(dia).toBeGreaterThan(-1);
    expect(lineas[dia + 1]).toBe('14:00 - 19:30  Control de armas de sable masculino');
  });

  it('los trozos de un mismo párrafo se juntan sin costura', () => {
    // «Nombre del pabellón: » y «Palacio Municipal de Deportes» son dos `<w:r>`
    // del mismo párrafo. Word los parte por cualquier cambio de formato.
    expect(texto).toContain('Nombre del pabellón: Palacio Municipal de Deportes');
  });

  it('un salto de línea dentro del párrafo no parte la frase', () => {
    expect(texto).toContain('Se paga en efectivo o por transferencia.');
  });

  it('las entidades XML se deshacen, y el «&amp;» el último', () => {
    expect(texto).toContain('80 € individual y 400 € por equipos & sin IVA');
  });

  it('un párrafo vacío separa apartados pero no deja huecos de tres líneas', () => {
    expect(texto).not.toMatch(/\n\n\n/);
    // Y la separación existe: el bloque del horario no se pega al del pabellón.
    expect(texto).toContain('\n\nHORARIO');
  });

  it('el mismo criterio vale para un OpenDocument', () => {
    const odf = textoDeDocumentoOdf(CONTENT_XML_ODF);
    expect(odf).toContain('14:00 - 19:30  Control de armas');
    expect(odf).toContain('Aforo: 7.000 localidades');
  });
});

// ---------------------------------------------------------------------------
// 4. La puerta de entrada
// ---------------------------------------------------------------------------

describe('textoDeDocumento decide por el formato', () => {
  it('lee un Word y NO se inventa un número de páginas', async () => {
    const leido = await textoDeDocumento(await docxDePrueba(), { url: 'https://x/y.docx' });
    expect(leido.formato).toBe('docx');
    expect(leido.tieneTexto).toBe(true);
    /**
     * Un `.docx` no tiene páginas: las tiene la impresión, y dependen de la
     * fuente y del margen. Decir «18 páginas» de un Word sería un número
     * inventado en una columna que alguien podría creerse.
     */
    expect(leido.paginas).toBeNull();
    expect(leido.texto).toContain('Palacio Municipal de Deportes');
  });

  it('lee texto plano tal cual', async () => {
    const plano = new TextEncoder().encode('Cuota: 80 EUR\nPabellón: el de siempre\n');
    const leido = await textoDeDocumento(plano);
    expect(leido.formato).toBe('texto');
    expect(leido.texto).toContain('Cuota: 80 EUR');
  });

  it('un Word con poco texto se marca como sin texto, no como error', async () => {
    const casiVacio = await zipDePrueba([
      { nombre: 'word/document.xml', contenido: '<w:document><w:body/></w:document>' },
    ]);
    const leido = await textoDeDocumento(casiVacio, { url: 'x.docx' });
    expect(leido.tieneTexto).toBe(false);
    expect(leido.texto).toBe('');
  });

  it('un .doc binario se rechaza con un motivo en castellano, no con un fallo', async () => {
    const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, ...new Array(400).fill(0x41)]);
    await expect(textoDeDocumento(doc, { url: 'x.doc' })).rejects.toThrow(FormatoNoLeible);
    await expect(textoDeDocumento(doc, { url: 'x.doc' })).rejects.toThrow(
      /Word antiguo.*El enlace al documento se guarda igual/s,
    );
  });

  it('un ZIP que no es un Word se distingue de un Word roto', async () => {
    const zip = await zipDePrueba([{ nombre: 'hojas/1.xml', contenido: '<x/>' }]);
    await expect(textoDeDocumento(zip, { url: 'x.docx' })).rejects.toThrow(
      /no lleva .word\/document\.xml./,
    );
  });
});
