import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localD1 } from '@/db/d1/testing';
const h = vi.hoisted(() => ({ binding: undefined as unknown, allowed: true }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => ({ env: { DB: h.binding } }) }));
vi.mock('@/lib/auth/session', () => ({
  requireProfile: async () => { if (!h.allowed) throw new Error('NO_AUTENTICADO'); return { profileId: 'synthetic-profile' }; },
}));
vi.mock('@/lib/entries/evidencia-db', () => ({
  depsEvidenciaDb: { esquema: async () => ({ identidad: false, referencias: false }) },
}));
import { inscritosUnidosDeTorneos } from '@/lib/queries/inscritos-union';
let local: ReturnType<typeof localD1>;
beforeEach(() => {
  local = localD1(); h.binding = local.binding; h.allowed = true;
  local.sqlite.exec(`
    INSERT INTO event (id,source,source_id,name,start_date,end_date,scope,circuit,content_hash)
      VALUES ('torneo','skermo_rfee','fixture','Fixture','2026-01-01','2026-01-01','NACIONAL','TNR','fixture'),
             ('pareja','fie','fixture','Fixture','2026-01-01','2026-01-01','INTERNACIONAL','SEN_WC','fixture');
    UPDATE event SET canonical_event_id='torneo' WHERE id='pareja';
  `);
});
afterEach(() => { h.binding = undefined; local.close(); });
function prueba(id: string, torneo: string, checked: number | null, count: number | null) {
  local.sqlite.prepare(`INSERT INTO event_competition
    (id,event_id,weapon,gender,category,format,registrations_checked_at,registration_count,content_hash)
    VALUES (?,?,'FLORETE','M','ABS','INDIVIDUAL',?,?,'fixture')`).run(id, torneo, checked, count);
}
describe('SQLite boolean decoding in published registration lists', () => {
  it.each([[null, null, 'sin_consultar'], [1, null, 'vacia'], [null, 0, 'vacia']] as const)(
    'distinguishes a never-read list from a confirmed empty one: %s/%s', async (checked, count, state) => {
      prueba('prueba', 'torneo', checked, count);
      expect(await inscritosUnidosDeTorneos(['torneo'])).toEqual({ filas: [], estados: { prueba: state } });
    },
  );
  it('uses the canonical own test while retaining the paired source read checkpoint', async () => {
    prueba('externa', 'pareja', 1, 0); prueba('propia', 'torneo', null, null);
    expect(await inscritosUnidosDeTorneos(['torneo'])).toEqual({ filas: [], estados: { propia: 'vacia' } });
  });
  it('does not query SQLite before authentication', async () => {
    h.allowed = false;
    await expect(inscritosUnidosDeTorneos(['torneo'])).rejects.toThrow('NO_AUTENTICADO');
    expect(local.calls).toEqual([]);
  });
});
