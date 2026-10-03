import { and, desc, eq, gt, isNotNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { ingestRun } from '@/db/schema';

/** Un salto nocturno con cero filas no es una descarga exitosa del ranking. */
export function consultaUltimaLecturaRanking(db: Pick<Db, 'select'>) {
  return db.select({ finishedAt: ingestRun.finishedAt }).from(ingestRun)
    .where(and(
      eq(ingestRun.source, 'skermo_ranking'),
      eq(ingestRun.status, 'ok'),
      isNotNull(ingestRun.finishedAt),
      gt(ingestRun.itemsSeen, 0),
    ))
    .orderBy(desc(ingestRun.finishedAt))
    .limit(1);
}
