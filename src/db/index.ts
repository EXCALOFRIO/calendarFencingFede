import { createLazyD1Database } from './d1/runtime';
import * as schema from './schema';

/** Import-safe, request-local D1 query builder. No Neon runtime fallback. */
export const db = createLazyD1Database();
export { schema };
export type { Db } from './d1/runtime';
export { createD1Database, createLazyD1Database } from './d1/runtime';
export { parameterBatches, boundedBatch } from './d1/batching';
