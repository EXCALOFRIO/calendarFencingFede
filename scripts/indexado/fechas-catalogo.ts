/**
 * Fechas del catálogo nacional para los PDF sin fecha en la cabecera. La lógica vive en
 * `src/lib/ingest/hechos/fechas-catalogo.ts`; aquí sólo se lee el inventario del disco.
 */
import { existsSync, readFileSync } from 'node:fs';
import { indiceFechas, type IndiceFechas, type InventarioNacional } from '../../src/lib/ingest/hechos/fechas-catalogo';

export {
  fechasCatalogo,
  indiceFechas,
  type FilaCatalogo,
  type IndiceFechas,
  type InventarioNacional,
  type PruebaFecha,
} from '../../src/lib/ingest/hechos/fechas-catalogo';

export function cargarIndiceFechas(ruta: string | null | undefined): IndiceFechas | null {
  if (!ruta || !existsSync(ruta)) return null;
  return indiceFechas(JSON.parse(readFileSync(ruta, 'utf8')) as InventarioNacional);
}