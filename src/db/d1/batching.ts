import type { BatchItem, BatchResponse } from 'drizzle-orm/batch';
import { D1_MAX_BATCH_STATEMENTS, D1_MAX_PARAMETERS } from './binding';

/**
 * Slice BEFORE creating SQL. parametersPerItem must include every bound insert
 * column, INCLUDING omitted scalar defaults (e.g. active=true or status text).
 * UUID/time SQL expression defaults and SQL NULL are NOT bound parameters.
 * Count a representative builder's .toSQL().params to verify the budget.
 * reservedParameters includes conflict-update/filter constants.
 */
export function parameterBatches<T>(
  items: readonly T[],
  parametersPerItem: number,
  reservedParameters = 0,
): T[][] {
  if (!Number.isSafeInteger(parametersPerItem) || parametersPerItem < 1
    || !Number.isSafeInteger(reservedParameters) || reservedParameters < 0
    || parametersPerItem + reservedParameters > D1_MAX_PARAMETERS) {
    throw new RangeError('Invalid D1 parameter budget.');
  }
  const size = Math.floor((D1_MAX_PARAMETERS - reservedParameters) / parametersPerItem);
  const batches: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    batches.push(items.slice(offset, offset + size));
  }
  return batches;
}

interface BatchDatabase {
  batch<U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(queries: T): Promise<BatchResponse<T>>;
}

/**
 * Bounded sequential driver batches. Each chunk is atomic, the WHOLE operation
 * is NOT. Never use for a ranking replacement or a lease-fenced transaction
 * which requires all statements to commit together. Oversized individual SQL
 * is intentionally rejected rather than parsed/re-written.
 */
export async function boundedBatch<T extends BatchItem<'sqlite'>>(
  database: BatchDatabase,
  queries: readonly T[],
  size = D1_MAX_BATCH_STATEMENTS,
): Promise<T['_']['result'][]> {
  if (!Number.isSafeInteger(size) || size < 1 || size > D1_MAX_BATCH_STATEMENTS) {
    throw new RangeError('Invalid D1 statement batch size.');
  }
  const results: T['_']['result'][] = [];
  for (let offset = 0; offset < queries.length; offset += size) {
    const chunk = queries.slice(offset, offset + size);
    results.push(...await database.batch(chunk as [T, ...T[]]));
  }
  return results;
}
