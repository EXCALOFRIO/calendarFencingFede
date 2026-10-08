/**
 * Falla si zod aparece en algún chunk del navegador.
 *
 *   npx tsx tests/perf/sin-zod-cliente.mts            # .next/static/chunks
 *   npx tsx tests/perf/sin-zod-cliente.mts <carpeta>  # p. ej. .open-next/assets/_next/static/chunks
 *
 * Ejecutar después de un build. Las firmas son nombres que zod conserva tras
 * minificar (clases de error/tipo y la propiedad interna `_zod`).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const carpeta = path.resolve(root, process.argv[2] ?? '.next/static/chunks');

const FIRMAS: { nombre: string; re: RegExp; minimo: number }[] = [
  { nombre: '$ZodType', re: /\$ZodType/g, minimo: 1 },
  { nombre: 'ZodError', re: /ZodError/g, minimo: 1 },
  { nombre: '._zod', re: /\._zod\b/g, minimo: 5 },
];

async function listar(dir: string): Promise<string[]> {
  const salida: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...(await listar(p)));
    else if (e.name.endsWith('.js')) salida.push(p);
  }
  return salida;
}

try {
  if (!(await stat(carpeta)).isDirectory()) throw new Error();
} catch {
  console.error(`No existe ${carpeta}. Ejecuta un build antes.`);
  process.exit(2);
}

const archivos = await listar(carpeta);
const culpables: string[] = [];
for (const archivo of archivos) {
  const texto = await readFile(archivo, 'utf8');
  const hallado = FIRMAS
    .map((f) => ({ ...f, n: texto.match(f.re)?.length ?? 0 }))
    .filter((f) => f.n >= f.minimo);
  if (hallado.length) {
    const kb = (Buffer.byteLength(texto) / 1024).toFixed(0);
    culpables.push(`${path.relative(root, archivo)} (${kb} KB): ${hallado.map((f) => `${f.nombre}×${f.n}`).join(', ')}`);
  }
}

if (archivos.length === 0) {
  console.error(`Sin chunks .js en ${carpeta}.`);
  process.exit(2);
}
if (culpables.length) {
  console.error(`zod en ${culpables.length} chunk(s) del cliente:\n  ${culpables.join('\n  ')}`);
  process.exit(1);
}
console.log(`OK: ${archivos.length} chunks sin zod en ${path.relative(root, carpeta) || carpeta}.`);
