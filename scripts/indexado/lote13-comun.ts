/**
 * Lote 13: lo común a sus scripts de aplicación (`lote13-*.ts`).
 *
 * Todos ensayan por defecto: abren la base en sólo lectura y escriben sólo el informe. Con
 * `--aplicar` escriben en una COPIA de trabajo, en una transacción, y nunca en las copias exactas
 * de producción ni en las bases de referencia (`BASES_PROTEGIDAS_13`).
 */
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CARPETA_TRABAJO, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia } from './comun';

export const BASES_PROTEGIDAS_13: ReadonlySet<string> = new Set([
  'base.sqlite', 'remoto.sqlite', 'nuevo11.sqlite', 'nuevo12.sqlite', 'nuevo13.sqlite', 'nuevo14.sqlite',
]);
export const CARPETA_INFORMES_13 = join(CARPETA_TRABAJO, 'lote13-informes');
export const NUEVO13 = join(CARPETA_TRABAJO, 'nuevo13.sqlite');

export const corto = (id: string | null | undefined): string => (id ? id.slice(0, 8) : '∅');

export function esProtegida(ruta: string): boolean {
  return BASES_PROTEGIDAS_13.has(basename(ruta).toLowerCase());
}

/** Lanza si se pide escribir en una base protegida. */
export function comprobarDestino(ruta: string, aplicar: boolean): void {
  if (aplicar && esProtegida(ruta)) {
    throw new Error(`${basename(ruta)} es una base protegida (copia exacta de producción o de referencia): sólo se puede ensayar sobre ella`);
  }
}

export function asegurarCarpetaInformes(carpeta = CARPETA_INFORMES_13): string {
  mkdirSync(carpeta, { recursive: true });
  return carpeta;
}

/**
 * Ensayo: abre en sólo lectura y llama a `fn`. Aplicación: copia de trabajo sin la guardia de
 * escritura (se repone al final, también si falla) y `fn` dentro de una transacción
 * (`transaccion: false` cuando `fn` abre las suyas, como `registrarConjuntas`).
 */
export function conBase<T>(ruta: string, aplicar: boolean, fn: (db: DatabaseSync) => T, opciones: { transaccion?: boolean } = {}): T {
  comprobarDestino(ruta, aplicar);
  const db = new DatabaseSync(ruta, aplicar ? {} : { readOnly: true });
  try {
    if (!aplicar) return fn(db);
    prepararCopiaTrabajo(db);
    restaurarGuardia(db);
    quitarGuardia(db);
    try {
      if (opciones.transaccion === false) return fn(db);
      db.exec('BEGIN');
      try {
        const r = fn(db);
        db.exec('COMMIT');
        return r;
      } catch (e) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw e;
      }
    } finally {
      restaurarGuardia(db);
    }
  } finally {
    db.close();
  }
}
