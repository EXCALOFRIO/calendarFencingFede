/**
 * Rutas y utilidades comunes del lote 7, pruebas que faltan enteras (o sin hechos en
 * ninguna fuente). Los hechos van todos a `hechos/lote7-faltan/`, con el prefijo de cada
 * extractor en el nombre del informe (`_informe-<extractor>.json`), que el cargador ignora.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ficheroHechos, hechosPrueba, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { CARPETA_CACHES, CARPETA_TRABAJO } from './comun';

export const NUEVO7 = join(CARPETA_TRABAJO, 'nuevo7.sqlite');
export const SALIDA_LOTE7 = join(CARPETA_TRABAJO, 'hechos', 'lote7-faltan');
export const INVENTARIO_NACIONAL = join(CARPETA_CACHES, 'history-national', 'national-inventory.json');

export function abrirNuevo7(ruta = NUEVO7): DatabaseSync {
  return new DatabaseSync(ruta, { readOnly: true });
}

export const dia = (f: string): number => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);
export const fechaDeDia = (d: number): string => new Date(d * 86_400_000).toISOString().slice(0, 10);

/**
 * Escribe los hechos de un extractor en la carpeta del lote. Cada extractor firma sus
 * ficheros con un prefijo propio en `extractor`, así que sólo borra los suyos de
 * ejecuciones anteriores que ya no produce.
 */
export class EscritorHechos {
  private readonly escritos = new Set<string>();

  constructor(readonly extractor: string, readonly carpeta = SALIDA_LOTE7) {
    mkdirSync(carpeta, { recursive: true });
  }

  escribir(h: HechosPrueba): string {
    const valido = hechosPrueba.parse(h);
    const fichero = ficheroHechos(valido);
    if (this.escritos.has(fichero)) throw new Error(`Fichero de hechos repetido: ${fichero}`);
    writeFileSync(join(this.carpeta, fichero), `${JSON.stringify(valido, null, 1)}\n`);
    this.escritos.add(fichero);
    return fichero;
  }

  get total(): number {
    return this.escritos.size;
  }

  /**
   * Borra los ficheros que este extractor (mismo campo `extractor`) escribió en una
   * ejecución anterior y ahora no ha vuelto a escribir. Los de otros extractores del lote
   * comparten carpeta y prefijo de fuente, así que no se miran por nombre.
   */
  limpiarAntiguos(): number {
    if (!existsSync(this.carpeta)) return 0;
    let n = 0;
    for (const f of readdirSync(this.carpeta)) {
      if (!f.endsWith('.json') || f.startsWith('_') || this.escritos.has(f)) continue;
      const ruta = join(this.carpeta, f);
      let extractor: unknown = null;
      try {
        extractor = (JSON.parse(readFileSync(ruta, 'utf8')) as { extractor?: unknown }).extractor;
      } catch {
        continue;
      }
      if (extractor !== this.extractor) continue;
      rmSync(ruta);
      n += 1;
    }
    return n;
  }

  informe(nombre: string, datos: unknown): void {
    writeFileSync(join(this.carpeta, `_informe-${nombre}.json`), `${JSON.stringify(datos, null, 1)}\n`);
  }
}
