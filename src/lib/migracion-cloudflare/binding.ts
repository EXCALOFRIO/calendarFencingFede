import type { D1Binding } from '../../db/d1/binding';
import {
  boundedQuery, type D1Executor, type MigrationQuery,
} from './importer';
import { MAX_QUERY_PAYLOAD_BYTES } from './manifest';

/**
 * Transporte con el binding oficial, también utilizable con Wrangler OAuth.
 * No extrae, copia ni registra el token OAuth. Es de herramientas locales.
 */
export function bindingD1(
  databaseId: string,
  binding: D1Binding,
  allowWrites = false,
): D1Executor {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(databaseId)) {
    throw new Error('cloudflare_database_id_invalid');
  }
  function prepare(query: MigrationQuery) {
    boundedQuery(query.sql, query.params);
    const read = /^(SELECT\b|PRAGMA\s+(foreign_key_check|quick_check)\b)/i.test(query.sql);
    if (!read && !allowWrites) throw new Error('remote_readonly_operation_required');
    return binding.prepare(query.sql).bind(...query.params);
  }
  return {
    databaseId,
    async execute(query) {
      const statement = prepare(query);
      try {
        const result = await statement.all();
        if (!result.success || !Array.isArray(result.results)) throw new Error('d1_query_rejected');
        return result.results;
      } catch {
        // No propagar errores del binding con SQL/valores privados.
        throw new Error('d1_binding_query_failed');
      }
    },
    async executeBatch(queries) {
      if (queries.length < 1 || queries.length > 100) throw new Error('d1_batch_limit');
      if (Buffer.byteLength(JSON.stringify(queries)) > MAX_QUERY_PAYLOAD_BYTES) throw new Error('d1_payload_limit');
      const statements = queries.map(prepare);
      try {
        const results = await binding.batch(statements);
        if (results.length !== queries.length || results.some((r) => !r.success || !Array.isArray(r.results))) {
          throw new Error('d1_query_rejected');
        }
        return results.map((r) => r.results);
      } catch {
        throw new Error('d1_binding_batch_failed');
      }
    },
  };
}
