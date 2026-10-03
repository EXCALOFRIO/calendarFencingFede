import { afterEach, describe, expect, it } from 'vitest';
import { UUID_A, UUID_B, UUID_C } from './helpers/explorar';
import { favoritosNative } from './helpers/favoritos-native';
import { guardarFavorito, listarFavoritos, quitarFavorito } from '@/lib/sport/explorar/favoritos';

/**
 * SQL real sobre SQLite sintético y lotes D1 atómicos: guardar → consolidar →
 * listar/paginar conserva las fechas sin interpretar SQL con expresiones regulares.
 */

const PERFIL = '00000000-0000-4000-8000-0000000000a1';
const OTRO = '00000000-0000-4000-8000-0000000000b2';

const T1 = Date.parse('2026-09-28T08:00:00.000Z');
const T2 = Date.parse('2026-09-29T09:00:00.500Z');
const T3 = Date.parse('2026-09-30T10:00:00.123Z');
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((close) => close()); });

function almacen(opciones: {
  filas: [perfil: string, persona: string, creado: number][];
  fusiones: Record<string, string>;
  nombres?: Record<string, string>;
}) {
  const local = favoritosNative({
    ...opciones,
    personas: [UUID_A, UUID_B, UUID_C].map((id) => ({ id, nombre: opciones.nombres?.[id] })),
  });
  cleanups.push(local.close);
  return local;
}

const ids = (r: Awaited<ReturnType<typeof listarFavoritos>>) => {
  if (r.estado !== 'ok') throw new Error(r.estado);
  return r.items.map((i) => i.id);
};

/** Recorre toda la lista con páginas de un elemento, conservando el orden visto. */
async function recorrer(ctx: Parameters<typeof listarFavoritos>[0], primera?: string) {
  const vistos: string[] = [];
  let cursor = primera;
  for (let i = 0; i < 10; i++) {
    const r = await listarFavoritos(ctx, { limite: 1, ...(cursor ? { cursor } : {}) });
    if (r.estado !== 'ok') throw new Error(r.estado);
    vistos.push(...r.items.map((x) => x.id));
    if (!r.siguiente) break;
    cursor = r.siguiente;
  }
  return vistos;
}

describe('favoritos: consolidar tras una fusión conserva la fecha efectiva del grupo', () => {
  it('con fila canónica previa (conflicto): guardar no mueve la posición ni repite a la persona', async () => {
    // B t1, C t2, A t3 y después A se fusiona en B: el grupo B vale t3.
    const { ctx, favoritos, marca, lotes } = almacen({
      filas: [
        [PERFIL, UUID_B, T1],
        [PERFIL, UUID_C, T2],
        [PERFIL, UUID_A, T3],
      ],
      fusiones: { [UUID_A]: UUID_B },
    });

    const primera = await listarFavoritos(ctx, { limite: 1 });
    expect(ids(primera)).toEqual([UUID_B]);
    if (primera.estado !== 'ok') throw new Error('estado');
    expect(primera.items[0].guardadoEl).toBe(marca(T3));

    expect(await guardarFavorito(ctx, { personaId: UUID_B })).toEqual({
      estado: 'ok',
      personaId: UUID_B,
      favorito: true,
    });
    expect(favoritos.get(`${PERFIL}|${UUID_B}`)).toBe(T3);
    expect(favoritos.has(`${PERFIL}|${UUID_A}`)).toBe(false);
    expect(lotes).toEqual([2]);

    const resto = await listarFavoritos(ctx, { limite: 1, cursor: primera.siguiente! });
    expect(ids(resto)).toEqual([UUID_C]);
    expect(await recorrer(ctx, primera.siguiente!)).toEqual([UUID_C]);
    expect(await recorrer(ctx)).toEqual([UUID_B, UUID_C]);
  });

  it('sólo con el miembro fundido guardado: la canónica hereda su fecha', async () => {
    const { ctx, favoritos } = almacen({
      filas: [
        [PERFIL, UUID_A, T3],
        [PERFIL, UUID_C, T2],
      ],
      fusiones: { [UUID_A]: UUID_B },
    });

    const primera = await listarFavoritos(ctx, { limite: 1 });
    expect(ids(primera)).toEqual([UUID_B]);
    if (primera.estado !== 'ok') throw new Error('estado');

    // Se puede guardar tanto por la canónica como por el miembro fundido.
    await guardarFavorito(ctx, { personaId: UUID_A });
    expect(favoritos.get(`${PERFIL}|${UUID_B}`)).toBe(T3);
    expect(favoritos.has(`${PERFIL}|${UUID_A}`)).toBe(false);

    expect(await recorrer(ctx, primera.siguiente!)).toEqual([UUID_C]);
    expect(await recorrer(ctx)).toEqual([UUID_B, UUID_C]);
  });

  it('guardar de nuevo un favorito existente no inventa fecha ni lo mueve', async () => {
    const { ctx, favoritos } = almacen({
      filas: [
        [PERFIL, UUID_B, T1],
        [PERFIL, UUID_C, T2],
      ],
      fusiones: {},
    });
    const antes = await recorrer(ctx);
    await guardarFavorito(ctx, { personaId: UUID_B });
    await guardarFavorito(ctx, { personaId: UUID_B });
    expect(favoritos.get(`${PERFIL}|${UUID_B}`)).toBe(T1);
    expect(await recorrer(ctx)).toEqual(antes);
    expect(antes).toEqual([UUID_C, UUID_B]);
  });

  it('un favorito nuevo recibe la fecha del servidor y encabeza la lista', async () => {
    const { ctx, favoritos, reloj } = almacen({ filas: [[PERFIL, UUID_C, T2]], fusiones: {} });
    const antes = reloj();
    await guardarFavorito(ctx, { personaId: UUID_B });
    const creado = favoritos.get(`${PERFIL}|${UUID_B}`);
    expect(Number.isSafeInteger(creado)).toBe(true);
    expect(creado).toBeGreaterThanOrEqual(antes);
    expect(creado).toBeLessThanOrEqual(reloj());
    expect(await recorrer(ctx)).toEqual([UUID_B, UUID_C]);
  });

  it('la canónica con fecha más reciente que el miembro fundido no retrocede', async () => {
    const { ctx, favoritos } = almacen({
      filas: [
        [PERFIL, UUID_B, T3],
        [PERFIL, UUID_A, T1],
      ],
      fusiones: { [UUID_A]: UUID_B },
    });
    await guardarFavorito(ctx, { personaId: UUID_B });
    expect(favoritos.get(`${PERFIL}|${UUID_B}`)).toBe(T3);
    expect(favoritos.has(`${PERFIL}|${UUID_A}`)).toBe(false);
  });

  it('consolida sólo las filas de la cuenta de la sesión', async () => {
    const { ctx, favoritos, de } = almacen({
      filas: [
        [PERFIL, UUID_A, T3],
        [OTRO, UUID_A, T2],
        [OTRO, UUID_C, T1],
      ],
      fusiones: { [UUID_A]: UUID_B },
    });
    const ajenas = de(OTRO);
    await guardarFavorito(ctx, { personaId: UUID_B });
    expect(de(OTRO)).toEqual(ajenas);
    expect(favoritos.get(`${PERFIL}|${UUID_B}`)).toBe(T3);
  });

  it('quitar tras consolidar elimina a la persona del grupo sin dejar restos', async () => {
    const { ctx, de } = almacen({
      filas: [
        [PERFIL, UUID_A, T3],
        [PERFIL, UUID_C, T2],
      ],
      fusiones: { [UUID_A]: UUID_B },
    });
    await guardarFavorito(ctx, { personaId: UUID_B });
    await quitarFavorito(ctx, { personaId: UUID_B });
    expect(de(PERFIL).map(([k]) => k)).toEqual([`${PERFIL}|${UUID_C}`]);
    expect(await recorrer(ctx)).toEqual([UUID_C]);
  });

  it('desempata fechas iguales por ID sin omisiones ni repeticiones', async () => {
    const { ctx } = almacen({
      filas: [[PERFIL, UUID_A, T3], [PERFIL, UUID_B, T3], [PERFIL, UUID_C, T3]],
      fusiones: {},
    });
    expect(await recorrer(ctx)).toEqual([UUID_C, UUID_B, UUID_A]);
  });

  it('una cadena de fusiones conserva el máximo del grupo sin duplicados', async () => {
    const { ctx, favoritos, lotes } = almacen({
      filas: [[PERFIL, UUID_A, T3], [PERFIL, UUID_B, T1], [PERFIL, UUID_C, T2]],
      fusiones: { [UUID_A]: UUID_B, [UUID_B]: UUID_C },
    });
    expect(await recorrer(ctx)).toEqual([UUID_C]);
    await guardarFavorito(ctx, { personaId: UUID_A });
    expect(favoritos.get(`${PERFIL}|${UUID_C}`)).toBe(T3);
    expect(favoritos.has(`${PERFIL}|${UUID_A}`)).toBe(false);
    expect(favoritos.has(`${PERFIL}|${UUID_B}`)).toBe(false);
    expect(lotes).toEqual([2]);
    expect(await recorrer(ctx)).toEqual([UUID_C]);
  });

  it('revierte también la herencia si falla el borrado del lote atómico', async () => {
    const { ctx, sqlite, de, lotes } = almacen({
      filas: [[PERFIL, UUID_B, T1], [PERFIL, UUID_A, T3], [OTRO, UUID_A, T2]],
      fusiones: { [UUID_A]: UUID_B },
    });
    const propias = de(PERFIL);
    const ajenas = de(OTRO);
    sqlite.exec(`CREATE TRIGGER fallo_consolidacion BEFORE DELETE ON sport_favorite
      BEGIN SELECT RAISE(ABORT, 'synthetic batch failure'); END;`);
    await expect(guardarFavorito(ctx, { personaId: UUID_A })).rejects.toThrow();
    expect(lotes).toEqual([2]);
    expect(de(PERFIL)).toEqual(propias);
    expect(de(OTRO)).toEqual(ajenas);
  });
});
