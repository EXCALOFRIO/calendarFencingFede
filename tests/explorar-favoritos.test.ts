import { describe, expect, it } from 'vitest';
import {
  CLAVES_PRIVADAS,
  UUID_A,
  UUID_B,
  UUID_C,
  clavesDe,
  crearContexto,
  perfil,
  personaSimple,
} from './helpers/explorar';
import { codificarCursor } from '@/lib/sport/explorar/cursor';
import {
  consultarFavorito,
  guardarFavorito,
  listarFavoritos,
  quitarFavorito,
} from '@/lib/sport/explorar/favoritos';

/**
 * Contexto controlado: sin Neon ni sesión real. Prueba guardas, parámetros y
 * forma de las sentencias; que el SQL de escritura funcione en PostgreSQL no se
 * demuestra aquí.
 */

const PERFIL_A = '00000000-0000-4000-8000-0000000000a1';
const PERFIL_B = '00000000-0000-4000-8000-0000000000b2';

const escrituras = <T extends { text: string }>(sentencias: T[]) =>
  sentencias.filter((s) => /^\s*(INSERT|DELETE|UPDATE)/i.test(s.text));

const acciones: [string, (c: never, e: unknown) => Promise<unknown>][] = [
  ['guardarFavorito', guardarFavorito as never],
  ['quitarFavorito', quitarFavorito as never],
  ['consultarFavorito', consultarFavorito as never],
  ['listarFavoritos', listarFavoritos as never],
];

describe('favoritos: guardas de sesión', () => {
  it.each(acciones)('%s sin sesión o con acceso revocado no consulta ni escribe', async (_n, accion) => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    await expect(accion(ctx as never, { personaId: UUID_A })).rejects.toThrow('NO_AUTENTICADO');
    expect(sentencias).toHaveLength(0);
  });

  it.each(acciones)('%s rechaza entradas desconocidas sin consultar', async (nombre, accion) => {
    const { ctx, sentencias } = crearContexto();
    // Una lista sin entrada equivale a la primera página.
    for (const entrada of [
      ...(nombre === 'listarFavoritos' ? [] : [null]),
      'texto',
      { personaId: 42 },
      { personaId: 'no-uuid' },
      { personaId: UUID_A, profileId: PERFIL_B },
      { personaId: UUID_A, perfil: PERFIL_B, __proto__: { admin: true } },
    ]) {
      const r = (await accion(ctx as never, entrada)) as { estado: string };
      expect(r.estado).toBe('entrada_invalida');
    }
    expect(sentencias).toHaveLength(0);
  });

  it('no_disponible sin migración 0017 y sin tocar tablas', async () => {
    const { ctx, sentencias } = crearContexto({ esquema: { identidad: false, referencias: false } });
    expect(await guardarFavorito(ctx, { personaId: UUID_A })).toEqual({ estado: 'no_disponible' });
    expect(await quitarFavorito(ctx, { personaId: UUID_A })).toEqual({ estado: 'no_disponible' });
    expect(await listarFavoritos(ctx, {})).toEqual({ estado: 'no_disponible' });
    expect(sentencias).toHaveLength(0);
  });
});

describe('favoritos: guardar', () => {
  it('guarda sólo con el perfil de la sesión y sin más escrituras que la relación propia', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: personaSimple(UUID_A) });
    const r = await guardarFavorito(ctx, { personaId: UUID_A });
    expect(r).toEqual({ estado: 'ok', personaId: UUID_A, favorito: true });

    const w = escrituras(sentencias);
    expect(w.length).toBeGreaterThan(0);
    for (const s of w) {
      expect(s.text).toMatch(/sport_favorite/);
      expect(s.params).toContain(perfil().profileId);
      expect(s.text).not.toMatch(/user_profile|athlete|notif|email|sport_person\s+SET|sport_result/i);
    }
    expect(w[0].text).toMatch(/ON CONFLICT .*DO UPDATE .*created_at < EXCLUDED\.created_at/is);
    expect(w[0].params).toEqual([perfil().profileId, UUID_A, perfil().profileId, UUID_A]);
  });

  it('guardar dos veces emite la misma sentencia idempotente, sin error', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: personaSimple(UUID_A) });
    const a = await guardarFavorito(ctx, { personaId: UUID_A });
    const b = await guardarFavorito(ctx, { personaId: UUID_A });
    expect(b).toEqual(a);
    const inserts = sentencias.filter((s) => /^\s*INSERT/i.test(s.text));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].text).toBe(inserts[1].text);
    expect(inserts[0].params).toEqual(inserts[1].params);
  });

  it('guarda la persona que prevalece si el ID pedido fue fundido en otra', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [
        { cuando: /WITH RECURSIVE cadena/, filas: [{ id: UUID_B }] },
        { cuando: /WITH RECURSIVE grupo/, filas: [{ id: UUID_B }, { id: UUID_A }] },
      ],
    });
    const r = await guardarFavorito(ctx, { personaId: UUID_A });
    expect(r).toEqual({ estado: 'ok', personaId: UUID_B, favorito: true });
    const insert = sentencias.find((s) => /^\s*INSERT/i.test(s.text));
    expect(insert?.params).toEqual([perfil().profileId, UUID_B, perfil().profileId, UUID_B, UUID_A]);
    // Consolida una relación previa con el miembro fundido sin tocar otras cuentas.
    const borrado = sentencias.find((s) => /^\s*DELETE/i.test(s.text));
    expect(borrado?.text).toMatch(/profile_id = \$/);
    expect(borrado?.params).toContain(perfil().profileId);
    expect(borrado?.params).toContain(UUID_A);
    expect(borrado?.params).not.toContain(UUID_B);
  });

  it('persona inexistente: no_encontrada y ninguna escritura', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: [] });
    expect(await guardarFavorito(ctx, { personaId: UUID_C })).toEqual({ estado: 'no_encontrada' });
    expect(escrituras(sentencias)).toHaveLength(0);
  });

  it('no depende de que la persona tenga cuenta, licencia ni ficha activa', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: personaSimple(UUID_A) });
    await guardarFavorito(ctx, { personaId: UUID_A });
    expect(sentencias.map((s) => s.text).join('\n')).not.toMatch(
      /\bathlete\b|user_profile|rfee_license|active/i,
    );
  });

  it('cualquier rol puede guardar: no se añade ningún permiso', async () => {
    for (const role of ['athlete', 'coach', 'admin'] as const) {
      const { ctx, sentencias } = crearContexto({
        perfil: perfil({ role }),
        respuestas: personaSimple(UUID_A),
      });
      const r = await guardarFavorito(ctx, { personaId: UUID_A });
      expect(r).toMatchObject({ estado: 'ok' });
      expect(escrituras(sentencias).length).toBeGreaterThan(0);
    }
  });
});

describe('favoritos: quitar', () => {
  it('borra sólo filas del perfil de la sesión para ese grupo de personas', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: personaSimple(UUID_A, [UUID_A, UUID_B]) });
    const r = await quitarFavorito(ctx, { personaId: UUID_A });
    expect(r).toEqual({ estado: 'ok', personaId: UUID_A, favorito: false });
    const w = escrituras(sentencias);
    expect(w).toHaveLength(1);
    expect(w[0].text).toMatch(/^\s*DELETE FROM sport_favorite/i);
    expect(w[0].text).toMatch(/profile_id = \$1/);
    expect(w[0].params[0]).toBe(perfil().profileId);
    expect(w[0].params).toEqual(expect.arrayContaining([UUID_A, UUID_B]));
  });

  it('quitar dos veces o sin haber guardado es estable', async () => {
    const { ctx } = crearContexto({ respuestas: personaSimple(UUID_A) });
    const a = await quitarFavorito(ctx, { personaId: UUID_A });
    const b = await quitarFavorito(ctx, { personaId: UUID_A });
    expect(a).toEqual({ estado: 'ok', personaId: UUID_A, favorito: false });
    expect(b).toEqual(a);
  });

  it('un ID inexistente no borra nada de nadie', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: [] });
    expect(await quitarFavorito(ctx, { personaId: UUID_C })).toEqual({ estado: 'no_encontrada' });
    expect(escrituras(sentencias)).toHaveLength(0);
  });

  it('manipular el perfil en la entrada no cambia a quién se borra', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: personaSimple(UUID_A) });
    const r = await quitarFavorito(ctx, { personaId: UUID_A, profileId: PERFIL_B } as never);
    expect(r).toEqual({ estado: 'entrada_invalida' });
    expect(sentencias).toHaveLength(0);
  });

  it('cada cuenta escribe con su propio perfil', async () => {
    const a = crearContexto({ perfil: perfil({ profileId: PERFIL_A }), respuestas: personaSimple(UUID_A) });
    const b = crearContexto({ perfil: perfil({ profileId: PERFIL_B }), respuestas: personaSimple(UUID_A) });
    await quitarFavorito(a.ctx, { personaId: UUID_A });
    await quitarFavorito(b.ctx, { personaId: UUID_A });
    const delA = escrituras(a.sentencias)[0];
    const delB = escrituras(b.sentencias)[0];
    expect(delA.params[0]).toBe(PERFIL_A);
    expect(delB.params[0]).toBe(PERFIL_B);
    expect(delA.params).not.toContain(PERFIL_B);
    expect(delB.params).not.toContain(PERFIL_A);
  });
});

describe('favoritos: consultar uno', () => {
  it('responde sólo según la relación del perfil de la sesión', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [...personaSimple(UUID_A), { cuando: /FROM sport_favorite/, filas: [{ n: 1 }] }],
    });
    expect(await consultarFavorito(ctx, { personaId: UUID_A })).toEqual({
      estado: 'ok',
      personaId: UUID_A,
      favorito: true,
    });
    const lectura = sentencias.find((s) => /FROM sport_favorite/.test(s.text));
    expect(lectura?.text).toMatch(/profile_id = \$1/);
    expect(lectura?.params[0]).toBe(perfil().profileId);
    expect(escrituras(sentencias)).toHaveLength(0);
  });

  it('sin relación devuelve favorito=false', async () => {
    const { ctx } = crearContexto({ respuestas: personaSimple(UUID_A) });
    expect(await consultarFavorito(ctx, { personaId: UUID_A })).toMatchObject({ favorito: false });
  });
});

const FILA = (id: string, nombre: string, creado: string) => ({
  id,
  nombre,
  claveNombre: nombre.toLowerCase(),
  pais: 'ESP',
  genero: 'F',
  anioNacimiento: 1999,
  guardadoEl: creado,
  mismoNombre: 1,
});

describe('favoritos: lista paginada', () => {
  const T1 = '2026-09-30 10:00:00.123456+00';
  const T2 = '2026-09-29 09:00:00.5+00';
  const T3 = '2026-09-28 08:00:00+00';

  it('filtra por el perfil de la sesión y devuelve un DTO acotado', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [
        {
          cuando: /FROM sport_favorite/,
          filas: [FILA(UUID_A, 'Ana', T1), FILA(UUID_B, 'Berta', T2)],
        },
        { cuando: /WITH RECURSIVE miembros_grupo/, filas: [{ id: UUID_A, resultados: 3, armas: 'ESPADA' }] },
      ],
    });
    const r = await listarFavoritos(ctx, {});
    expect(r).toMatchObject({ estado: 'ok', siguiente: null, sinResultados: false });
    if (r.estado !== 'ok') throw new Error('estado');
    expect(r.items.map((i) => i.id)).toEqual([UUID_A, UUID_B]);
    expect(r.items[0]).toMatchObject({ nombre: 'Ana', resultadosImportados: 3, armas: ['ESPADA'] });
    expect(r.items[1]).toMatchObject({ resultadosImportados: 0, armas: [] });

    const principal = sentencias.find((s) => /FROM sport_favorite/.test(s.text));
    expect(principal?.params).toContain(perfil().profileId);
    expect(principal?.text).toMatch(/profile_id = \$/);
    expect(escrituras(sentencias)).toHaveLength(0);

    const prohibidas = new Set(CLAVES_PRIVADAS);
    expect([...clavesDe(r)].filter((k) => prohibidas.has(k))).toEqual([]);
    expect(JSON.stringify(r)).not.toContain(perfil().profileId);
  });

  it('pagina por clave estable y el cursor sirve para la misma cuenta', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [
        {
          cuando: /FROM sport_favorite/,
          filas: [FILA(UUID_A, 'Ana', T1), FILA(UUID_B, 'Berta', T2), FILA(UUID_C, 'Carla', T3)],
        },
      ],
    });
    const primera = await listarFavoritos(ctx, { limite: 2 });
    if (primera.estado !== 'ok') throw new Error('estado');
    expect(primera.items).toHaveLength(2);
    expect(primera.siguiente).toEqual(expect.any(String));
    const sentenciaPrimera = sentencias.find((s) => /FROM sport_favorite/.test(s.text));
    expect(sentenciaPrimera?.params).toContain(3);

    const segunda = await listarFavoritos(ctx, { limite: 2, cursor: primera.siguiente! });
    expect(segunda.estado).toBe('ok');
    const sentenciaSegunda = sentencias.filter((s) => /FROM sport_favorite/.test(s.text))[1];
    expect(sentenciaSegunda.params).toContain(T2);
    expect(sentenciaSegunda.params).toContain(UUID_B);
  });

  it('un cursor de otra lista, de otra cuenta o manipulado se rechaza sin consultar', async () => {
    const { ctx, sentencias } = crearContexto();
    const mia = { cuenta: perfil().profileId };
    const cursores = [
      codificarCursor('busqueda', mia, [T2, UUID_B]),
      codificarCursor('favoritos', { cuenta: PERFIL_B }, [T2, UUID_B]),
      'basura',
      codificarCursor('favoritos', mia, ['no-fecha', UUID_B]),
      codificarCursor('favoritos', mia, [T2, 'no-uuid']),
      codificarCursor('favoritos', mia, [T2]),
    ];
    for (const cursor of cursores) {
      expect(await listarFavoritos(ctx, { cursor })).toEqual({ estado: 'cursor_invalido' });
    }
    expect(sentencias).toHaveLength(0);
  });

  it('lista vacía no es un error', async () => {
    const { ctx } = crearContexto({ respuestas: [] });
    expect(await listarFavoritos(ctx, {})).toMatchObject({ estado: 'ok', items: [], sinResultados: true });
  });

  it('el límite máximo se aplica en el borde', async () => {
    const { ctx, sentencias } = crearContexto();
    expect(await listarFavoritos(ctx, { limite: 51 })).toEqual({ estado: 'entrada_invalida' });
    expect(sentencias).toHaveLength(0);
  });
});

describe('favoritos: sin efectos laterales', () => {
  it('ninguna operación toca notificaciones, ranking interno ni cuenta del favorito', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [...personaSimple(UUID_A), { cuando: /FROM sport_favorite/, filas: [] }],
    });
    await guardarFavorito(ctx, { personaId: UUID_A });
    await consultarFavorito(ctx, { personaId: UUID_A });
    await listarFavoritos(ctx, {});
    await quitarFavorito(ctx, { personaId: UUID_A });
    const todo = sentencias.map((s) => s.text).join('\n');
    expect(todo).not.toMatch(
      /notification|push|ranking_snapshot|internal|user_profile|\bathlete\b|ical|email/i,
    );
  });
});
