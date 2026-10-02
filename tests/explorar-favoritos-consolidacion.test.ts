import { describe, expect, it } from 'vitest';
import { UUID_A, UUID_B, UUID_C, crearContexto, type Sentencia } from './helpers/explorar';
import { guardarFavorito, listarFavoritos, quitarFavorito } from '@/lib/sport/explorar/favoritos';

/**
 * Almacén controlado: aplica a una tabla en memoria la semántica que tienen las
 * sentencias de favoritos en PostgreSQL (INSERT ... SELECT max ... ON CONFLICT,
 * DELETE por grupo, agrupación por persona vigente, cursor por (fecha, ID)).
 * Sirve para comprobar el efecto de guardar → consolidar → listar/paginar sobre
 * las fechas; no demuestra que el SQL real se ejecute en Neon.
 */

const PERFIL = '00000000-0000-4000-8000-0000000000a1';
const OTRO = '00000000-0000-4000-8000-0000000000b2';

const T1 = '2026-09-28 08:00:00.000000+00';
const T2 = '2026-09-29 09:00:00.500000+00';
const T3 = '2026-09-30 10:00:00.123456+00';
const AHORA = '2026-10-02 12:00:00.000000+00';

const UUID_RE_TEXTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MARCA_TEXTO = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

function almacen(opciones: {
  filas: [perfil: string, persona: string, creado: string][];
  fusiones: Record<string, string>;
  nombres?: Record<string, string>;
}) {
  const favoritos = new Map<string, string>(opciones.filas.map(([p, q, t]) => [`${p}|${q}`, t]));
  const destinoDe = (id: string) => opciones.fusiones[id] ?? null;
  const canonicaDe = (id: string): string => {
    let actual = id;
    while (destinoDe(actual)) actual = destinoDe(actual)!;
    return actual;
  };
  const grupoDe = (canonica: string) => [
    canonica,
    ...Object.keys(opciones.fusiones).filter((id) => canonicaDe(id) === canonica),
  ];

  const respuestas = [
    { cuando: /WITH RECURSIVE cadena/, filas: (s: Sentencia) => [{ id: canonicaDe(String(s.params[0])) }] },
    {
      cuando: /WITH RECURSIVE grupo/,
      filas: (s: Sentencia) => grupoDe(String(s.params[0])).map((id) => ({ id })),
    },
    {
      cuando: /^\s*INSERT INTO sport_favorite/,
      filas: (s: Sentencia) => {
        const [perfil, canonica] = s.params.map(String);
        const consolida = /max\(/i.test(s.text);
        // Parámetros del grupo: perfil, canónica, perfil y, tras ellos, los IDs.
        const grupo = consolida ? s.params.slice(3).map(String) : [];
        const previas = grupo
          .map((id) => favoritos.get(`${perfil}|${id}`))
          .filter((t): t is string => t !== undefined)
          .sort();
        const efectiva = previas.length > 0 ? previas[previas.length - 1] : AHORA;
        const clave = `${perfil}|${canonica}`;
        const existente = favoritos.get(clave);
        if (existente === undefined) favoritos.set(clave, consolida ? efectiva : AHORA);
        else if (consolida && /DO UPDATE/i.test(s.text) && existente < efectiva) favoritos.set(clave, efectiva);
        return [];
      },
    },
    {
      cuando: /^\s*DELETE FROM sport_favorite/,
      filas: (s: Sentencia) => {
        const [perfil, ...ids] = s.params.map(String);
        for (const id of ids) favoritos.delete(`${perfil}|${id}`);
        return [];
      },
    },
    {
      cuando: /FROM sport_favorite f\b[\s\S]*ORDER BY g\.creado DESC/,
      filas: (s: Sentencia) => {
        const textos = s.params.map(String);
        const perfil = textos.find((p) => p === PERFIL || p === OTRO)!;
        const marca = textos.find((p) => MARCA_TEXTO.test(p));
        const personaCursor = marca ? textos.filter((p) => UUID_RE_TEXTO.test(p)).at(-1) : undefined;
        const limite = Number(s.params[s.params.length - 1]);

        const grupos = new Map<string, string>();
        for (const [clave, creado] of favoritos) {
          const [dueno, persona] = clave.split('|');
          if (dueno !== perfil) continue;
          const canonica = canonicaDe(persona);
          const previo = grupos.get(canonica);
          if (!previo || previo < creado) grupos.set(canonica, creado);
        }
        return [...grupos]
          .map(([id, creado]) => ({ id, creado }))
          .filter((g) => !marca || g.creado < marca || (g.creado === marca && g.id < personaCursor!))
          .sort((a, b) => (a.creado === b.creado ? (a.id < b.id ? 1 : -1) : a.creado < b.creado ? 1 : -1))
          .slice(0, limite)
          .map((g) => ({
            id: g.id,
            nombre: opciones.nombres?.[g.id] ?? g.id,
            claveNombre: g.id,
            pais: 'ESP',
            genero: 'F',
            anioNacimiento: 1999,
            guardadoEl: g.creado,
            mismoNombre: 1,
          }));
      },
    },
    { cuando: /WITH RECURSIVE miembros_grupo/, filas: [] },
  ];

  const { ctx, sentencias } = crearContexto({ respuestas });
  const de = (perfil: string) => [...favoritos].filter(([k]) => k.startsWith(`${perfil}|`));
  return { ctx, sentencias, favoritos, de };
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
    const { ctx, favoritos } = almacen({
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
    expect(primera.items[0].guardadoEl).toBe(T3);

    expect(await guardarFavorito(ctx, { personaId: UUID_B })).toEqual({
      estado: 'ok',
      personaId: UUID_B,
      favorito: true,
    });
    expect(favoritos.get(`${PERFIL}|${UUID_B}`)).toBe(T3);
    expect(favoritos.has(`${PERFIL}|${UUID_A}`)).toBe(false);

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
    const { ctx, favoritos } = almacen({ filas: [[PERFIL, UUID_C, T2]], fusiones: {} });
    await guardarFavorito(ctx, { personaId: UUID_B });
    expect(favoritos.get(`${PERFIL}|${UUID_B}`)).toBe(AHORA);
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
});
