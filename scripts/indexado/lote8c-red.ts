/**
 * Red y rutas del lote 8c (huecos RFEE sin fuente): caché en `calendario-trabajo/cache-lote8c`
 * (techo de 1 GB que aplica `Red`), User-Agent de `INGEST_USER_AGENT`, como mucho 2 peticiones
 * en vuelo por anfitrión y ≥600 ms entre dos al mismo anfitrión (1,5 s en archive.org).
 */
import 'dotenv/config';
import { join } from 'node:path';
import { CARPETA_TRABAJO } from './comun';
import { Red } from './lote7-faltan-red';

export const CACHE_LOTE8C = process.env.CACHE_LOTE8C ?? join(CARPETA_TRABAJO, 'cache-lote8c');
export const HECHOS_LOTE8C = (fuente: string) => join(CARPETA_TRABAJO, 'hechos', `lote8c-${fuente}`);
export const HUECOS_LOTE8 = join(CARPETA_TRABAJO, 'cobertura', 'huecos-tras-lote8.json');
export const NUEVO8 = join(CARPETA_TRABAJO, 'nuevo8.sqlite');

/** Una `Red` por familia de anfitriones, cada una con su subcarpeta de caché. */
export function redLote8c(sub: string, pausaMs = 600): Red {
  return new Red(join(CACHE_LOTE8C, sub), pausaMs, 2);
}
