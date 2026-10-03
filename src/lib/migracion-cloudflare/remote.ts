import { boundedQuery, type D1Executor, type MigrationQuery } from './importer';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function remoteD1(accountId: string, databaseId: string, token: string, allowWrites = false): D1Executor {
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('cloudflare_account_id_invalid');
  if (!UUID.test(databaseId)) throw new Error('cloudflare_database_id_invalid');
  if (!token) throw new Error('cloudflare_api_token_required');
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  return {
    databaseId,
    async execute(query: MigrationQuery) {
      boundedQuery(query.sql, query.params);
      const read = /^(SELECT\b|PRAGMA\s+(foreign_key_check|quick_check)\b)/i.test(query.sql);
      if (!read && !allowWrites) throw new Error('remote_readonly_operation_required');
      // Retry only reads and exact idempotent migration operations, never DDL.
      const idempotent = read || /^INSERT INTO ".+" .* ON CONFLICT \(.+\) DO NOTHING$/s.test(query.sql) ||
        /^UPDATE (?:cloudflare_data_migration|"[a-z][a-z0-9_]*") SET /.test(query.sql);
      const attempts = idempotent ? 4 : 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(query), signal: AbortSignal.timeout(60_000), redirect: 'error',
          });
        } catch {
          if (attempt + 1 === attempts) throw new Error('d1_network_failure');
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); continue;
        }
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt + 1 < attempts) {
          await response.body?.cancel();
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); continue;
        }
        if (!response.ok) { await response.body?.cancel(); throw new Error(`d1_http_${response.status}`); }
        let body: { success?: boolean; result?: { success?: boolean; results?: Record<string, unknown>[] }[] };
        try { body = await response.json(); } catch { throw new Error('d1_response_invalid'); }
        if (!body.success || !Array.isArray(body.result) || body.result.length !== 1 ||
          !body.result[0]?.success || !Array.isArray(body.result[0].results)) throw new Error('d1_query_rejected');
        return body.result[0].results;
      }
      throw new Error('d1_retry_exhausted');
    },
  };
}
