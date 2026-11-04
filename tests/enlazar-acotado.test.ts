import { describe, expect, it, vi } from 'vitest';
import { localD1 } from '@/db/d1/testing';

const h = vi.hoisted(() => ({ binding: undefined as unknown }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => ({ env: { DB: h.binding } }) }));

const EV = 'aaaaaaaa-0000-4000-8000-00000000000';
const MUERTE = 1735689600000;

describe('recalcularEnlaces con lecturas acotadas (sanidad local)', () => {
  it('excluye desaparecidos sin canonical y sus pruebas; limpia canonical de desaparecidos', async () => {
    const local = localD1();
    h.binding = local.binding;
    const ins = local.sqlite.prepare(
      `INSERT INTO event (id, source, source_id, name, start_date, end_date, city, country, scope, content_hash, canonical_event_id, disappeared_at)
       VALUES (?, ?, ?, ?, '2026-10-10', '2026-10-11', ?, ?, 'INTERNACIONAL', 'h', ?, ?)`,
    );
    const vivo = `${EV}1`, absorbido = `${EV}2`, muerto = `${EV}3`, muertoCanon = `${EV}4`;
    ins.run(vivo, 'skermo_rfee', 's-1', 'TORNEO VIVO', 'Gante', 'BEL', null, null);
    ins.run(absorbido, 'fie', 'f-1', 'Ghent Trophy', 'Gand', 'BEL', vivo, null);
    ins.run(muerto, 'fie', 'f-2', 'DEAD NO CANON', 'Lima', 'PER', null, MUERTE);
    ins.run(muertoCanon, 'fie', 'f-3', 'DEAD WITH CANON', 'Quito', 'ECU', vivo, MUERTE);
    const insC = local.sqlite.prepare(
      `INSERT INTO event_competition (id, event_id, weapon, gender, category, format, content_hash)
       VALUES (lower(hex(randomblob(16))), ?, 'ESPADA', 'F', 'ABS', 'INDIVIDUAL', 'x')`,
    );
    for (const id of [vivo, absorbido, muerto, muertoCanon]) insC.run(id);

    const { recalcularEnlaces } = await import('@/lib/ingest/enlazar');
    await recalcularEnlaces();

    const leidas = local.calls.filter((c) => c.sql.startsWith('select'));
    const deEventos = leidas.find((c) => c.sql.includes('"disappeared_at"'))!;
    const dePruebas = leidas.find((c) => c.sql.includes('event_competition'))!;
    expect(deEventos.sql).toContain('"disappeared_at" is null');
    expect(deEventos.sql).toContain('"canonical_event_id" is not null');
    // Las pruebas se leen por subconsulta de eventos vivos.
    expect(dePruebas.sql).toContain('in (select');
    expect(dePruebas.sql).toContain('"disappeared_at" is null');

    const estado = local.sqlite.prepare('SELECT id, canonical_event_id AS canon FROM event').all() as { id: string; canon: string | null }[];
    const porId = new Map(estado.map((e) => [e.id, e.canon]));
    // El vivo re-propone el par (misma ciudad canónica Gante/Gand, fechas que
    // se solapan, prueba contenida): conserva su canonical.
    expect(porId.get(absorbido)).toBe(vivo);
    // El desaparecido ya no se propone: el canonical se limpia (lectura
    // conservada justamente por este UPDATE).
    expect(porId.get(muertoCanon)).toBeNull();
    // Y se creó la fila de decisión automática del par re-propuesto.
    const enlaces = local.sqlite.prepare("SELECT status FROM event_link").all() as { status: string }[];
    expect(enlaces.some((l) => l.status === 'AUTOMATICO')).toBe(true);
    local.close();
  });
});
