import { describe, expect, it, vi } from 'vitest';
import {
  ampliarBordeDerecho,
  descargarPdf,
  docIdDeUrl,
  extraerPaginas,
  HOSTS_PDF_PERMITIDOS,
  leerBytesPdf,
  leerPdfRfee,
  PdfNoLeible,
} from '@/lib/ingest/sources/rfee-pdf/lectura';

/** PDF mínimo escrito a mano (xref reconstruible por PDF.js): una página por contenido dado. */
function pdfMinimo(contenidos: string[]): Uint8Array {
  const objetos: string[] = [];
  const kids = contenidos.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objetos.push('<</Type/Catalog/Pages 2 0 R>>');
  objetos.push(`<</Type/Pages/Kids[${kids}]/Count ${contenidos.length}>>`);
  contenidos.forEach((c, i) => {
    objetos.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents ${4 + i * 2} 0 R/Resources<</Font<</F1 ${3 + contenidos.length * 2} 0 R>>>>>>`);
    objetos.push(`<</Length ${c.length}>>\nstream\n${c}\nendstream`);
  });
  objetos.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');
  let salida = '%PDF-1.4\n';
  objetos.forEach((o, i) => {
    salida += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  salida += `trailer\n<</Root 1 0 R/Size ${objetos.length + 1}>>\n%%EOF\n`;
  return new TextEncoder().encode(salida);
}

const texto = (x: number, y: number, s: string) => `BT /F1 10 Tf ${x} ${y} Td (${s}) Tj ET`;

describe('extracción de texto posicionado con unpdf/PDF.js', () => {
  it('conserva x/y de cada texto y distingue columnas que un texto aplanado fundiría', async () => {
    const bytes = pdfMinimo([`${texto(100, 700, 'Columna A')}\n${texto(300, 700, 'Columna B')}\n${texto(100, 680, 'Fila dos')}`]);
    const { paginas, perfil } = await extraerPaginas(bytes);
    expect(paginas).toHaveLength(1);
    expect(paginas[0]).toMatchObject({ numero: 1, ancho: 595, alto: 842 });
    const a = paginas[0].items.find((i) => i.s.includes('Columna A'));
    const b = paginas[0].items.find((i) => i.s.includes('Columna B'));
    expect(a && b && Math.abs(a.y - b.y) < 0.5 && b.x - a.x > 150).toBe(true);
    expect(perfil).toMatchObject({ bytes: bytes.length, paginas: 1, items: 3 });
    expect(perfil.ms).toBeGreaterThanOrEqual(0);
  });

  it('lee el texto que se sale por el borde derecho de la página sin cambiar sus medidas', async () => {
    const bytes = pdfMinimo([`${texto(560, 700, 'RAMIREZ LARENA Alejandro')}\n${texto(570, 680, '15/13')}`]);
    const { paginas } = await extraerPaginas(bytes);
    expect(paginas[0]).toMatchObject({ ancho: 595, alto: 842 });
    const todo = paginas[0].items.map((i) => i.s).join(' ');
    expect(todo).toContain('RAMIREZ LARENA Alejandro');
    expect(todo).toContain('15/13');
  });

  it('amplía el borde derecho de MediaBox y CropBox sin mover un byte', () => {
    const pdf = '%PDF-1.4\n<</MediaBox[0 0 612 792]/CropBox [ 0 0 612.0 792 ]>>';
    const bytes = new TextEncoder().encode(pdf);
    const r = ampliarBordeDerecho(bytes)!;
    expect(r).not.toBeNull();
    expect(r.length).toBe(bytes.length);
    expect(new TextDecoder('latin1').decode(r)).toBe('%PDF-1.4\n<</MediaBox[0 0 999 792]/CropBox [0 0 999999 792 ]>>');
    // Sin hueco para un borde mayor, o sin cajas, no hay nada que reescribir.
    expect(ampliarBordeDerecho(new TextEncoder().encode('<</MediaBox[0 0 9999 792]>>'))).toBeNull();
    expect(ampliarBordeDerecho(new TextEncoder().encode('%PDF-1.4 sin cajas'))).toBeNull();
  });

  it('rechaza lo que no es un PDF y lo que supera los límites de bytes o páginas', async () => {
    await expect(extraerPaginas(new TextEncoder().encode('<html>no soy un pdf</html>'))).rejects.toThrow(PdfNoLeible);
    const dos = pdfMinimo([texto(10, 10, 'uno'), texto(10, 10, 'dos')]);
    await expect(extraerPaginas(dos, { maxBytes: 50 })).rejects.toThrow(/límite/);
    await expect(extraerPaginas(dos, { maxPaginas: 1 })).rejects.toThrow(/páginas/);
  });

  it('una página sin texto extraíble va a revisión/OCR sin ejecutar ningún OCR y el documento queda pendiente', async () => {
    const l = await leerBytesPdf(pdfMinimo(['']), { url: 'https://app.skermo.org/client/1/x.pdf', docId: 'x' });
    expect(l.ocr).toMatchObject({ necesario: true, paginas: [1], ejecutado: false });
    expect(l.pruebas).toHaveLength(0);
    expect(l.estado).toBe('pendiente');
    expect(l.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(l.perfil).toMatchObject({ paginas: 1 });
  });
});

describe('descarga en memoria', () => {
  it('sólo admite https y hosts de la lista', async () => {
    expect(HOSTS_PDF_PERMITIDOS).toContain('app.skermo.org');
    const espia = vi.spyOn(globalThis, 'fetch');
    await expect(descargarPdf('http://app.skermo.org/client/1/x.pdf')).rejects.toThrow(/no permitido/);
    await expect(descargarPdf('https://example.com/x.pdf')).rejects.toThrow(/no permitido/);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it('corta una respuesta que declara o supera el tope de bytes', async () => {
    const espia = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('x'.repeat(10), { headers: { 'content-length': '5000' } }))
      .mockResolvedValueOnce(new Response(new Blob(['x'.repeat(5000)]).stream()));
    await expect(descargarPdf('https://app.skermo.org/client/1/a.pdf', { maxBytes: 100 })).rejects.toThrow(/declara/);
    await expect(descargarPdf('https://app.skermo.org/client/1/b.pdf', { maxBytes: 100 })).rejects.toThrow(/supera/);
    espia.mockRestore();
  });
});

describe('leerPdfRfee', () => {
  it('devuelve estado error con el motivo cuando falla la descarga, no una lectura parcial', async () => {
    const l = await leerPdfRfee('https://app.skermo.org/client/1/abc123.pdf', {
      bytes: async () => {
        throw new PdfNoLeible('HTTP 500 al pedir el PDF');
      },
    });
    expect(l).toMatchObject({ estado: 'error', docId: docIdDeUrl(l.url), error: 'HTTP 500 al pedir el PDF', pruebas: [], sha256: null });
    expect(l.ocr.ejecutado).toBe(false);
  });

  it('lee los bytes que entrega la dependencia y conserva la URL y la huella', async () => {
    const bytes = pdfMinimo([texto(100, 700, 'Documento sin resultados reconocibles')]);
    const l = await leerPdfRfee('https://app.skermo.org/client/1/def456.pdf', { bytes: async () => bytes });
    expect(l).toMatchObject({ url: 'https://app.skermo.org/client/1/def456.pdf', docId: docIdDeUrl(l.url) });
    expect(l.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(l.estado).toBe('pendiente');
    expect(l.pruebas).toHaveLength(0);
  });

  it('docIdDeUrl identifica la URL completa y no confunde nombres ni prefijos iguales', () => {
    const url = 'https://app.skermo.org/client/1/results.pdf';
    expect(docIdDeUrl(url)).toMatch(/^url-[a-f0-9]{64}$/);
    expect(docIdDeUrl(url)).not.toBe(docIdDeUrl('https://app.skermo.org/client/2/results.pdf'));
    expect(docIdDeUrl(url)).toBe(docIdDeUrl(`${url}#page=2`));
    const prefix = 'a'.repeat(40);
    expect(docIdDeUrl(`https://app.skermo.org/client/1/${prefix}A.pdf`)).not.toBe(docIdDeUrl(`https://app.skermo.org/client/1/${prefix}B.pdf`));
    expect(() => docIdDeUrl('no es url')).toThrow();
  });
});
