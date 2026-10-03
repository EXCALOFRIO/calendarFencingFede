/** Structural subset shared by Cloudflare D1 and explicit local test adapters. */
export interface D1QueryMeta {
  duration: number;
  changes: number;
  last_row_id: number;
  changed_db: boolean;
  size_after: number;
  rows_read: number;
  rows_written: number;
}

export interface D1QueryResult<T = Record<string, unknown>> {
  success: boolean;
  results: T[];
  meta: D1QueryMeta;
  error?: string;
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1QueryResult<T>>;
  run<T = Record<string, unknown>>(): Promise<D1QueryResult<T>>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
}

export interface D1Binding {
  prepare(query: string): D1Statement;
  batch<T = Record<string, unknown>>(statements: D1Statement[]): Promise<D1QueryResult<T>[]>;
}

export const D1_MAX_PARAMETERS = 100;
/** Conservative bounded request size. This is a policy, not a SQLite limit. */
export const D1_MAX_BATCH_STATEMENTS = 100;

export function assertD1Parameters(values: readonly unknown[]) {
  if (values.length > D1_MAX_PARAMETERS) {
    throw new RangeError(`D1 statements support at most ${D1_MAX_PARAMETERS} bound parameters. Use parameterBatches before constructing the query.`);
  }
  for (const value of values) {
    if (value === null || typeof value === 'string'
      || (typeof value === 'number' && Number.isFinite(value))
      || value instanceof ArrayBuffer || ArrayBuffer.isView(value)
      || (Array.isArray(value) && value.every((v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255))) continue;
    throw new TypeError('Unsupported D1 parameter. Raw SQL requires milliseconds, integer booleans and JSON strings, not Date, boolean or object values.');
  }
}

const statementOrigin = Symbol('d1StatementOrigin');
interface WrappedStatement extends D1Statement {
  readonly [statementOrigin]: { readonly binding: D1Binding; readonly statement: D1Statement };
}

/**
 * Ownership travels with each statement, never in global connection state.
 * The lazy application proxy creates separate builders for one binding, so
 * batches accept sibling wrappers of that binding, not only this wrapper.
 */
export function boundedD1Binding(binding: D1Binding): D1Binding {
  const wrap = (statement: D1Statement): D1Statement => {
    const wrapped: WrappedStatement = {
      [statementOrigin]: { binding, statement },
      bind(...values) {
        assertD1Parameters(values);
        return wrap(statement.bind(...values));
      },
      all: <T>() => statement.all<T>(),
      run: <T>() => statement.run<T>(),
      raw: <T>(options?: { columnNames?: false }) => statement.raw<T>(options),
      first: <T>(column?: string) => statement.first<T>(column),
    };
    return wrapped;
  };
  return {
    prepare: (query) => wrap(binding.prepare(query)),
    batch<T>(statements: D1Statement[]) {
      if (!statements.length || statements.length > D1_MAX_BATCH_STATEMENTS) {
        throw new RangeError(`Atomic D1 batches require 1..${D1_MAX_BATCH_STATEMENTS} statements. Use boundedBatch only for independently committable work.`);
      }
      return binding.batch<T>(statements.map((statement) => {
        const origin = (statement as Partial<WrappedStatement>)[statementOrigin];
        if (!origin || origin.binding !== binding) {
          throw new Error('D1 batch statements must belong to the same database binding.');
        }
        return origin.statement;
      }));
    },
  };
}
