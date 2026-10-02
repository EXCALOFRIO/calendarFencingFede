import fs from 'node:fs';
import { crearAlmacenFichero } from '../src/lib/ingest/backfill/piloto-ia-almacen';
import { construirInformePiloto, medirPdfLocal } from '../src/lib/ingest/backfill/piloto-ia-informe';
import { crearAlmacenMemoria, estimarCoste, procesarDocumentoPiloto, type DocumentoPiloto } from '../src/lib/ingest/backfill/piloto-ia';

/**
 * Informe local del piloto de IA sobre PDF (hasta 10 documentos y 1 € en total):
 *
 *   npm run piloto-ia -- --archivo a.pdf [--archivo b.pdf ...]
 *   npm run piloto-ia -- --archivo a.pdf --simular
 *
 * Mide páginas, bytes y texto en memoria e imprime estimaciones previas de
 * coste; no imprime texto ni nombres. Este comando NO tiene modo de envío: la
 * ejecución real está bloqueada mientras no haya una vía de IA verificada, y
 * `--simular` usa un cliente falso sobre un libro aparte, sin consumo alguno.
 */

const args = process.argv.slice(2);
const archivos = args.flatMap((a, i) => (a === '--archivo' && args[i + 1] ? [args[i + 1]] : []));
const simular = args.includes('--simular');

if (archivos.length === 0) {
  console.error('Uso: npm run piloto-ia -- --archivo <ruta.pdf> [--archivo ...] [--simular]');
  process.exit(1);
}

const medidas: DocumentoPiloto[] = [];
for (const archivo of archivos) {
  const { items: _items, ...medida } = await medirPdfLocal(new Uint8Array(fs.readFileSync(archivo)));
  medidas.push(medida);
}

if (simular) {
  const almacen = crearAlmacenMemoria('simulacion');
  for (const doc of medidas) {
    const estimacion = estimarCoste(doc);
    await procesarDocumentoPiloto(
      { almacen, invocar: async () => ({ costeMicroEur: estimacion?.escenarios.base.costeMicroEur ?? 0 }) },
      doc,
    );
  }
  const informe = construirInformePiloto(medidas, { modo: 'simulacion' });
  console.log(JSON.stringify({ SIMULACION: 'sin llamadas ni consumo real; costes de un cliente falso', informe, libroSimulado: almacen.leer() }, null, 2));
} else {
  const libro = crearAlmacenFichero('real').leer();
  console.log(JSON.stringify(construirInformePiloto(medidas, { modo: 'real', libro }), null, 2));
}
