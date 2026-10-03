import { describe, expect, it } from 'vitest';
import { buscarDeportistas } from '@/lib/sport/explorar/busqueda';
import { UUID_A, UUID_B, UUID_C, crearContexto } from './helpers/explorar';

/**
 * Búsqueda tras una fusión A→B: los alias y hechos pueden seguir colgando de A
 * (se conservan, no se migran) y la ficha/histórico los leen por el grupo. Aquí
 * se comprueba, con el contexto controlado (SQL registrado, sin PostgreSQL ni
 * sesión reales), que la búsqueda consulta ese mismo grupo y devuelve una sola
 * fila de la persona que prevalece con su cursor.
 */

const consultaPrincipal = /FROM sport_person p\s+WHERE/;
const conteos = /GROUP BY g\.canonica/;

const fila = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  claveNombre: nombre.toLowerCase().split(' ').sort().join(' '),
  alias: null,
  pais: 'ESP',
  genero: 'F',
  anioNacimiento: 2001,
  ...extra,
});

/** Subconsulta del grupo (superviviente y fundidas) con la profundidad de `resolverPersona`. */
const GRUPO = /IN \(\(?WITH RECURSIVE miembros_grupo/;

function sinGrupo(sql: string, tabla: string, columna: string): boolean {
  const solos = new RegExp(`${tabla}\\.${columna} = p\\.id`);
  return !solos.test(sql);
}

describe('alias retenido en una persona fundida', () => {
  it('un alias de A fundida en B devuelve B una sola vez, con ese alias', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [
        { cuando: consultaPrincipal, filas: [fila(UUID_B, 'Lucia Garcia', { alias: 'PEREZ Lucia' })] },
        { cuando: conteos, filas: [{ id: UUID_B, resultados: 4, armas: 'ESPADA' }] },
      ],
    });
    const r = await buscarDeportistas(ctx, { q: 'perez' });
    if (r.estado !== 'ok') throw new Error(r.estado);

    expect(r.items.map((i) => i.id)).toEqual([UUID_B]);
    expect(r.items[0]).toMatchObject({ alias: 'PEREZ Lucia', resultadosImportados: 4, armas: ['ESPADA'] });

    const { text } = sentencias[0];
    // Sólo la canónica es candidata, y sus alias son los de todo el grupo.
    expect(text).toMatch(/p\.merged_into_person_id IS NULL/);
    expect(text).toMatch(
      /FROM sport_person_alias a\s+WHERE a\.person_id IN \(\(?WITH RECURSIVE miembros_grupo/,
    );
    expect(sinGrupo(text, 'a', 'person_id')).toBe(true);
    // La fila sale de `sport_person` sin unirse a alias ni hechos: no hay fan-out.
    expect(text).not.toMatch(/\bJOIN sport_person_alias\b/);
    expect(text.match(/FROM sport_person p\s+WHERE/g)).toHaveLength(1);
  });

  it('el alias mostrado se elige del grupo de forma determinista', async () => {
    const { ctx, sentencias } = crearContexto();
    await buscarDeportistas(ctx, { q: 'perez' });
    const { text } = sentencias[0];
    expect(text).toMatch(
      /SELECT a\.name_original FROM sport_person_alias a\s+WHERE a\.person_id IN \(\(?WITH RECURSIVE miembros_grupo[\s\S]*?ORDER BY a\.name_normalized, a\.id LIMIT 1/,
    );
  });
});

describe('hechos que permanecen en la persona fundida', () => {
  it('los filtros de prueba, torneo, temporada y arma leen resultados y ranking de todo el grupo', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [{ cuando: consultaPrincipal, filas: [fila(UUID_B, 'Lucia Garcia')] }],
    });
    const prueba = await buscarDeportistas(ctx, { temporada: '2025-2026', arma: 'ESPADA' });
    if (prueba.estado !== 'ok') throw new Error(prueba.estado);
    expect(prueba.items.map((i) => i.id)).toEqual([UUID_B]);

    const { text } = sentencias[0];
    expect(text).toMatch(/FROM sport_result r[\s\S]*?WHERE r\.person_id IN \(\(?WITH RECURSIVE miembros_grupo/);
    expect(text).toMatch(/WHERE en2\.person_id IN \(\(?WITH RECURSIVE miembros_grupo/);
    expect(sinGrupo(text, 'r', 'person_id')).toBe(true);
    expect(sinGrupo(text, 'en2', 'person_id')).toBe(true);
    expect(text).toMatch(/c\.season = \?/);
    expect(text).toMatch(/c\.weapon = \?/);
  });

  it('torneo y fechas siguen exigiendo un resultado del grupo en la misma prueba', async () => {
    const { ctx, sentencias } = crearContexto();
    await buscarDeportistas(ctx, { torneo: 'Open Madrid', desde: '2025-10-01' });
    const { text } = sentencias[0];
    expect(text).toMatch(/WHERE r\.person_id IN \(\(?WITH RECURSIVE miembros_grupo/);
    expect(text).not.toMatch(/sport_ranking_entry en2/);
  });

  it('la nacionalidad documentada también usa los hechos y licencias del grupo', async () => {
    const { ctx, sentencias } = crearContexto();
    await buscarDeportistas(ctx, { nacionalidad: 'ESP' });
    const { text } = sentencias[0];
    expect(text).toMatch(/WHERE rn\.person_id IN \(\(?WITH RECURSIVE miembros_grupo/);
    expect(text).toMatch(/WHERE en\.person_id IN \(\(?WITH RECURSIVE miembros_grupo/);
    expect(text).toMatch(/x\.person_id IN \(\(?WITH RECURSIVE miembros_grupo/);
    expect(sinGrupo(text, 'rn', 'person_id')).toBe(true);
    expect(sinGrupo(text, 'x', 'person_id')).toBe(true);
  });

  it('el grupo se limita a las mismas fusiones encadenadas que ficha e histórico', async () => {
    const { ctx, sentencias } = crearContexto();
    await buscarDeportistas(ctx, { temporada: '2025-2026' });
    // 3 es SALTOS de resolverPersona (A→B→C→D).
    expect(sentencias[0].params).toContain(3);
  });

  it('el recuento de resultados del superviviente suma los hechos que quedaron en A', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [
        { cuando: consultaPrincipal, filas: [fila(UUID_B, 'Lucia Garcia')] },
        { cuando: conteos, filas: [{ id: UUID_B, resultados: 9, armas: 'ESPADA,FLORETE' }] },
      ],
    });
    const r = await buscarDeportistas(ctx, { temporada: '2025-2026' });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.items[0]).toMatchObject({ id: UUID_B, resultadosImportados: 9, armas: ['ESPADA', 'FLORETE'] });

    const complemento = sentencias.find((s) => conteos.test(s.text));
    expect(complemento?.text).toMatch(/WITH RECURSIVE miembros_grupo/);
    expect(complemento?.text).toMatch(/JOIN sport_result r ON r\.person_id = g\.id/);
    expect(complemento?.text).toContain('json_each');
    expect(complemento?.params).toContain(JSON.stringify([UUID_B]));
  });
});

describe('paginación con varias evidencias en el grupo', () => {
  it('el cursor se liga a la clave del superviviente y a los filtros, no a A', async () => {
    const filas = [fila(UUID_B, 'Ana Aa'), fila(UUID_C, 'Ana Bb'), fila(UUID_A, 'Ana Cc')];
    const primera = crearContexto({ respuestas: [{ cuando: consultaPrincipal, filas }] });
    const p1 = await buscarDeportistas(primera.ctx, { q: 'ana', limite: 2 });
    if (p1.estado !== 'ok' || !p1.siguiente) throw new Error('sin cursor');
    expect(p1.items.map((i) => i.id)).toEqual([UUID_B, UUID_C]);

    const segunda = crearContexto({ respuestas: [{ cuando: consultaPrincipal, filas: [filas[2]] }] });
    const p2 = await buscarDeportistas(segunda.ctx, { q: 'ana', limite: 2, cursor: p1.siguiente });
    expect(p2).toMatchObject({ estado: 'ok', siguiente: null });
    expect(segunda.sentencias[0].params).toEqual(expect.arrayContaining(['ana bb', UUID_C]));
    expect(segunda.sentencias[0].text).toMatch(/\(p\.name_normalized, p\.id\) > \(\?, \?\)/);

    const otrosFiltros = crearContexto();
    expect(await buscarDeportistas(otrosFiltros.ctx, { q: 'ana', arma: 'ESPADA', cursor: p1.siguiente })).toEqual({
      estado: 'cursor_invalido',
    });
    expect(otrosFiltros.sentencias).toHaveLength(0);
  });
});
