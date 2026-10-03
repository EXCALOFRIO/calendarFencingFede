import { and, eq, gt, inArray } from 'drizzle-orm';
import type { Db } from '@/db';
import { lotesDeInsercion } from '@/lib/sqlite';
import { sportImportCoverage } from '@/db/schema';
import type { DepsPersistenciaDescubrimiento } from './backfill/descubrimiento-persist';
import { escribirCobertura } from './fie-resultados-db';
import {
  claveImportacion,
  type EstadoUnidad,
  type FuenteHistorica,
  type UnidadInventario,
} from './sources/historico-indice';

/**
 * Persistencia del inventario de fuentes: una fila de cobertura `index` por
 * fuente, temporada y federación (`index:FED`; en la FIE, `index:FIE`). Es lo
 * único que se escribe del inventario: el catálogo de pruebas y documentos se
 * vuelve a derivar del índice en cada lectura, y sólo `results` (puestos
 * importados) cuenta como «importado».
 *
 * `pendiente` y `no_verificado` no se guardan: no hay nada que registrar y
 * escribirlas como cobertura sugeriría una lectura que no ocurrió.
 */

const ESTADO_COBERTURA: Partial<
  Record<EstadoUnidad, 'completo' | 'parcial' | 'sin_resultados' | 'error'>
> = {
  leido: 'completo',
  parcial: 'parcial',
  sin_filas: 'sin_resultados',
  error: 'error',
  inaccesible: 'error',
};

export async function guardarInventario(
  db: Db,
  unidades: readonly UnidadInventario[],
): Promise<{ guardadas: number; omitidas: number }> {
  let guardadas = 0;
  let omitidas = 0;
  for (const u of unidades) {
    const status = ESTADO_COBERTURA[u.estado];
    // Una unidad de federación (sin temporada) no es coberturable: sólo explica un fallo.
    if (!status || !u.temporada) {
      omitidas += 1;
      continue;
    }
    const lectura = status === 'error' ? {} : { publishedTotal: u.publicado, importedTotal: u.filas };
    await escribirCobertura(db, u.fuente, {
      season: u.temporada,
      factKind: 'index',
      competitionKey: `index:${u.federacion}`,
      competitionId: null,
      status,
      ...lectura,
      sourceUrl: u.url,
      lastError: u.error,
    });
    guardadas += 1;
  }
  return { guardadas, omitidas };
}

/**
 * Persistencia del progreso del descubrimiento del backfill: checkpoint del índice con las reglas
 * de `escribirCobertura` y pruebas descubiertas como cobertura `pendiente` sin intentos, con
 * `ON CONFLICT DO NOTHING` para no pisar nunca una lectura ya hecha.
 */
export function crearDepsPersistenciaDescubrimientoDb(db: Db): DepsPersistenciaDescubrimiento {
  return {
    escribirCobertura: (source, fila) => escribirCobertura(db, source, fila),
    async sembrar(filas) {
      const semillas = filas.map(({ source, fila }) => ({
        source,
        season: fila.season,
        factKind: fila.factKind,
        competitionKey: fila.competitionKey,
        status: 'pendiente' as const,
        attempts: 0,
        sourceUrl: fila.sourceUrl,
        cursor: fila.cursor,
      }));
      for (const lote of lotesDeInsercion(semillas, sportImportCoverage)) {
        await db
          .insert(sportImportCoverage)
          .values(lote)
          .onConflictDoNothing({
            target: [
              sportImportCoverage.source,
              sportImportCoverage.season,
              sportImportCoverage.factKind,
              sportImportCoverage.competitionKey,
            ],
          });
      }
    },
    async leerIndices() {
      const filas = await db
        .select({
          source: sportImportCoverage.source,
          season: sportImportCoverage.season,
          competitionKey: sportImportCoverage.competitionKey,
          status: sportImportCoverage.status,
          publishedTotal: sportImportCoverage.publishedTotal,
          importedTotal: sportImportCoverage.importedTotal,
          cursor: sportImportCoverage.cursor,
          sourceUrl: sportImportCoverage.sourceUrl,
          lastError: sportImportCoverage.lastError,
        })
        .from(sportImportCoverage)
        .where(eq(sportImportCoverage.factKind, 'index'));
      return filas;
    },
  };
}

/**
 * Claves de pruebas con puestos YA importados (cobertura `results`/`ranking`
 * con filas), para marcar el catálogo como `importada`. Descubrir un índice no
 * suma aquí.
 */
export async function clavesImportadas(
  db: Db,
  fuentes: readonly FuenteHistorica[] = ['fie', 'skermo_rfee', 'skermo_regional'],
): Promise<Set<string>> {
  const filas = await db
    .select({
      source: sportImportCoverage.source,
      season: sportImportCoverage.season,
      competitionKey: sportImportCoverage.competitionKey,
    })
    .from(sportImportCoverage)
    .where(
      and(
        inArray(sportImportCoverage.source, [...fuentes]),
        inArray(sportImportCoverage.factKind, ['ranking', 'results']),
        gt(sportImportCoverage.importedTotal, 0),
      ),
    );
  return new Set(
    filas.map((f) => claveImportacion(f.source as FuenteHistorica, f.season, f.competitionKey)),
  );
}
