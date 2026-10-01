import fs from 'node:fs';
import path from 'node:path';
import { leerBytesPdf, leerPdfRfee } from '../src/lib/ingest/sources/rfee-pdf/lectura';
import type { LecturaPdf } from '../src/lib/ingest/sources/rfee-pdf/tipos';

/**
 * Lectura en seco de un PDF oficial de resultados de la RFEE (Engarde):
 *
 *   npm run rfee-pdf -- https://app.skermo.org/client/1/<hash>.pdf
 *   npm run rfee-pdf -- --archivo ruta/local.pdf
 *
 * Sólo lee en memoria e imprime recuentos y cobertura: ni nombres, ni
 * escritura en la base, ni OCR ni modelos. Persistir pruebas, puestos y
 * asaltos es cosa del backfill, que decide qué se aplica.
 */

const args = process.argv.slice(2);
const iArchivo = args.indexOf('--archivo');
const archivo = iArchivo >= 0 ? args[iArchivo + 1] : null;
const url = args.find((a) => /^https?:\/\//.test(a)) ?? null;

if (!archivo && !url) {
  console.error('Uso: npm run rfee-pdf -- <url https del PDF> | --archivo <ruta.pdf>');
  process.exit(1);
}

const lectura: LecturaPdf = archivo
  ? await leerBytesPdf(new Uint8Array(fs.readFileSync(archivo)), { url: `file:${path.basename(archivo)}`, docId: path.basename(archivo, '.pdf') })
  : await leerPdfRfee(url as string);

console.log(`PDF ${lectura.docId} estado=${lectura.estado}${lectura.error ? ` error=${lectura.error}` : ''}`);
if (lectura.perfil) {
  const p = lectura.perfil;
  console.log(`  perfil: ${p.bytes} bytes, ${p.paginas} páginas, ${p.items} textos, ${p.ms} ms, heap ${p.heapMb ?? '-'} MB`);
  console.log(`  sha256=${lectura.sha256}`);
}
console.log(`  pruebas=${lectura.pruebas.length} rechazos_documento=${lectura.rechazos.length}`);
if (lectura.ocr.necesario) console.log(`  OCR necesario (no ejecutado) en páginas: ${lectura.ocr.paginas.join(',')}`);

for (const p of lectura.pruebas) {
  const excluidos = Object.entries(p.excluidos)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join(' ');
  const poules = p.asaltos.filter((a) => a.fase === 'POULE').length;
  const cuadro = p.asaltos.length - poules;
  console.log(
    `  [${p.estado}] ${p.arma ?? '?'} ${p.genero ?? '?'} ${p.formato ?? '?'} ${p.categoriaPublicada ?? 'sin categoría'} ` +
      `páginas=${p.paginas.join(',')} puestos=${p.puestos.length}(${p.cobertura.puestos.estado}) ` +
      `poules=${poules}(${p.cobertura.poules.estado}) cuadro=${cuadro}(${p.cobertura.cuadro.estado})` +
      `${excluidos ? ` excluidos[${excluidos}]` : ''}${p.rechazos.length ? ` rechazos=${p.rechazos.length}` : ''}`,
  );
}
console.log('Modo lectura: no se ha escrito nada.');
