/**
 * Rellena los tres literales de drizzle-d1/0019_recalibrar_libro.sql justo antes de aplicarla.
 * No se conecta a nada: el tamaño real lo mide quien opera (docs/guia-administracion.md §5).
 *
 *   --medido <bytes>    tamaño real de D1 medido ahora (meta.size_after o database_size)
 *   [--libro <bytes>]   valor del libro; por defecto el recomendado (medido + 15 %, a 64 MiB)
 *   [--minutos 60]      validez de la medida; pasado ese plazo la migración aborta
 *   [--escribir]        reescribe drizzle-d1/0019_recalibrar_libro.sql (si no, sólo lo muestra)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argumento, bandera } from './comun';

const MIB = 1024 * 1024;
export const PASO_LIBRO = 64 * MIB;
export const MARGEN_RECOMENDADO = 0.15;
/** Igual que los CHECK de _parametros_0019. */
export const PARADA_INGESTA = 8 * 1024 * MIB - 512 * MIB;
export const MIGRACION_0019 = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle-d1', '0019_recalibrar_libro.sql');

export interface ParametrosRecalibrado {
  medido: number;
  libro: number;
  validoHasta: number;
}

function entero(nombre: string, valor: number): number {
  if (!Number.isSafeInteger(valor) || valor <= 0) throw new Error(`${nombre}_invalido`);
  return valor;
}

export function libroRecomendado(medido: number): number {
  entero('medido', medido);
  return Math.ceil((medido * (1 + MARGEN_RECOMENDADO)) / PASO_LIBRO) * PASO_LIBRO;
}

/** Las mismas condiciones que la migración, para fallar aquí y no en producción. */
export function validarParametros(p: ParametrosRecalibrado): ParametrosRecalibrado {
  entero('medido', p.medido);
  entero('libro', p.libro);
  entero('valido_hasta', p.validoHasta);
  if (p.libro < p.medido + Math.floor(p.medido / 10)) throw new Error('libro_por_debajo_del_margen_minimo');
  if (p.libro > PARADA_INGESTA) throw new Error('libro_por_encima_de_la_parada');
  return p;
}

const MARCAS = { medido: 'medido_bytes', libro: 'libro_bytes', validoHasta: 'valido_hasta_ms' } as const;

export function rellenarRecalibrado(texto: string, p: ParametrosRecalibrado): string {
  validarParametros(p);
  let salida = texto;
  for (const [clave, marca] of Object.entries(MARCAS) as [keyof typeof MARCAS, string][]) {
    const patron = new RegExp(`^([ \\t]*)\\d+(\\)?[,;]?) -- ${marca}(?=\\r?$)`, 'm');
    if (!patron.test(salida)) throw new Error(`marca_ausente:${marca}`);
    salida = salida.replace(patron, `$1${p[clave]}$2 -- ${marca}`);
  }
  return salida;
}

function main() {
  const medido = Number(argumento('medido', ''));
  const libroArg = argumento('libro', '');
  const minutos = Number(argumento('minutos', '60'));
  if (!Number.isSafeInteger(minutos) || minutos < 1 || minutos > 24 * 60) throw new Error('minutos_invalidos');
  const libro = libroArg ? Number(libroArg) : libroRecomendado(medido);
  const p = validarParametros({ medido, libro, validoHasta: Date.now() + minutos * 60_000 });
  const texto = rellenarRecalibrado(readFileSync(MIGRACION_0019, 'utf8'), p);
  console.log(`medido ${p.medido} B, libro ${p.libro} B (${(p.libro / 1024 ** 3).toFixed(3)} GiB, ` +
    `margen ${(((p.libro / p.medido) - 1) * 100).toFixed(1)} %), válido hasta ${new Date(p.validoHasta).toISOString()}`);
  if (bandera('escribir')) {
    writeFileSync(MIGRACION_0019, texto);
    console.log(`Escrito ${MIGRACION_0019}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
