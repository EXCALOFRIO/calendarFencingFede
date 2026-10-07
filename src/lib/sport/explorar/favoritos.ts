import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { complementos } from './busqueda';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { codificarCursor, decodificarCursor, UUID_RE } from './cursor';
import { LIMITE_MAXIMO, LIMITE_POR_DEFECTO } from './entrada';
import { listaUuid } from './filtros-sql';
import { resolverPersona, SALTOS } from './personas';
import { anioNacimientoPublico } from './anio-publico';
import type { Arma, DeportistaResumen } from './tipos';
import { exigirEscritura } from '@/lib/auth/read-only';
import { AHORA_SQL } from '@/lib/sqlite';

/**
 * Favoritos: relación `(cuenta, persona deportiva)` guardada para volver a una
 * ficha. No es una alerta ni un permiso: no envía nada, no cambia qué ve la
 * cuenta de la persona favorita y no abre su ranking interno ni sus datos.
 *
 * Toda operación toma la cuenta de la sesión vigente (`exigirPerfil`, que
 * excluye accesos revocados) y nunca de la entrada, que sólo admite el ID de
 * la persona. Así una cuenta no puede leer ni modificar la relación de otra
 * manipulando identificadores. Guardar y quitar son idempotentes.
 */

const CLASE = 'favoritos';

const uuid = z.string().regex(UUID_RE);
const esquemaPersona = z.object({ personaId: uuid }).strict();
const esquemaLista = z
  .object({
    cursor: z.string().min(1).max(600).optional(),
    limite: z.number().int().min(1).max(LIMITE_MAXIMO).optional(),
  })
  .strict();

/** Marca pública de orden, formateada desde los milisegundos SQLite. */
const MARCA_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:\d{2})?)?$/;

function milisegundosMarca(marca: string): number {
  const iso = marca.replace(' ', 'T');
  return Date.parse(/[+-]\d{2}(:\d{2})?$/.test(iso)
    ? iso.replace(/([+-]\d{2})$/, '$1:00')
    : `${iso}Z`);
}

/** Tope por cuenta: una lista de acceso rápido, no una copia del índice. */
export const MAX_FAVORITOS = 500;

export type ResultadoFavorito =
  | { estado: 'ok'; personaId: string; favorito: boolean }
  | { estado: 'entrada_invalida' }
  | { estado: 'no_encontrada' }
  | { estado: 'limite_alcanzado' }
  /** El esquema deportivo (migración 0017) no está aplicado. */
  | { estado: 'no_disponible' };

export type FavoritoResumen = DeportistaResumen & {
  /** Cuándo se guardó, tal y como lo devuelve la base; sólo para ordenar. */
  guardadoEl: string;
};

export type ResultadoListaFavoritos =
  | {
      estado: 'ok';
      items: FavoritoResumen[];
      siguiente: string | null;
      sinResultados: boolean;
    }
  | { estado: 'entrada_invalida' }
  | { estado: 'cursor_invalido' }
  | { estado: 'no_disponible' };

type Preparada =
  | { estado: 'ok'; profileId: string; canonicaId: string; ids: string[] }
  | { estado: 'entrada_invalida' | 'no_encontrada' | 'no_disponible' };

async function prepararPersona(ctx: ContextoExplorador, entrada: unknown): Promise<Preparada> {
  const perfil = await exigirPerfil(ctx);
  const analizada = esquemaPersona.safeParse(entrada);
  if (!analizada.success) return { estado: 'entrada_invalida' };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };

  const persona = await resolverPersona(ctx.db, analizada.data.personaId);
  if (!persona) return { estado: 'no_encontrada' };
  return {
    estado: 'ok',
    profileId: perfil.profileId,
    canonicaId: persona.canonicaId,
    ids: persona.ids,
  };
}

/**
 * Guarda a la persona que prevalece tras las fusiones; una relación previa con
 * un miembro fundido se sustituye por ella, de modo que sigue habiendo una.
 *
 * La lista ordena cada grupo por su `created_at` más reciente. La fila
 * canónica hereda esa fecha antes de retirar a los miembros (también si ya
 * existía), de modo que consolidar ni mueve la posición ni repite a la persona
 * al seguir un cursor anterior. Sin filas previas se usa la fecha del servidor;
 * guardar de nuevo nunca retrocede ni adelanta una fecha ya vigente. Si el
 * lote falla, D1 revierte también la herencia: no queda una consolidación parcial.
 */
export async function guardarFavorito(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoFavorito> {
  exigirEscritura(await exigirPerfil(ctx));
  const p = await prepararPersona(ctx, entrada);
  if (p.estado !== 'ok') return { estado: p.estado };

  // Volver a guardar (o consolidar) a quien ya está no cuenta contra el tope.
  const [cupo] = filas<{ total: number; ya: number }>(await ctx.db.execute(sql`
    SELECT (SELECT count(*) FROM sport_favorite WHERE profile_id = ${p.profileId}) AS total,
           EXISTS (SELECT 1 FROM sport_favorite
                   WHERE profile_id = ${p.profileId} AND person_id IN (${listaUuid(p.ids)})) AS ya`));
  if (cupo && !Number(cupo.ya) && Number(cupo.total) >= MAX_FAVORITOS) return { estado: 'limite_alcanzado' };

  // El tope se repite dentro de la misma sentencia para que dos altas a la vez
  // no lo pasen; en esa carrera la segunda no escribe.
  const guardar = sql`
    INSERT INTO sport_favorite (profile_id, person_id, created_at)
    SELECT ${p.profileId}, ${p.canonicaId}, COALESCE(previo.creado, ${AHORA_SQL})
    FROM (
      SELECT max(f.created_at) AS creado, count(f.person_id) AS filas
      FROM sport_favorite f
      WHERE f.profile_id = ${p.profileId} AND f.person_id IN (${listaUuid(p.ids)})
    ) previo
    WHERE previo.filas > 0
      OR (SELECT count(*) FROM sport_favorite t WHERE t.profile_id = ${p.profileId}) < ${MAX_FAVORITOS}
    ON CONFLICT (profile_id, person_id)
    DO UPDATE SET created_at = EXCLUDED.created_at
    WHERE sport_favorite.created_at < EXCLUDED.created_at`;

  const fundidas = p.ids.filter((id) => id !== p.canonicaId);
  if (fundidas.length > 0) {
    // D1 serializa la unidad entera: quitar no puede entrar entre heredar la
    // fecha y retirar miembros. No hay transacción PostgreSQL ni fallback.
    if (!ctx.db.batch) throw new Error('FAVORITOS_REQUIEREN_BATCH_ATOMICO');
    await ctx.db.batch([ctx.db.execute(guardar), ctx.db.execute(sql`
      DELETE FROM sport_favorite
      WHERE profile_id = ${p.profileId} AND person_id IN (${listaUuid(fundidas)})`)]);
  } else await ctx.db.execute(guardar);
  return { estado: 'ok', personaId: p.canonicaId, favorito: true };
}

export async function quitarFavorito(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoFavorito> {
  exigirEscritura(await exigirPerfil(ctx));
  const p = await prepararPersona(ctx, entrada);
  if (p.estado !== 'ok') return { estado: p.estado };

  await ctx.db.execute(sql`
    DELETE FROM sport_favorite
    WHERE profile_id = ${p.profileId} AND person_id IN (${listaUuid(p.ids)})`);
  return { estado: 'ok', personaId: p.canonicaId, favorito: false };
}

export async function consultarFavorito(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoFavorito> {
  const p = await prepararPersona(ctx, entrada);
  if (p.estado !== 'ok') return { estado: p.estado };

  const [fila] = filas<{ n: number }>(
    await ctx.db.execute(sql`
      SELECT 1 AS n FROM sport_favorite
      WHERE profile_id = ${p.profileId} AND person_id IN (${listaUuid(p.ids)})
      LIMIT 1`),
  );
  return { estado: 'ok', personaId: p.canonicaId, favorito: Boolean(fila) };
}

type FilaFavorito = {
  id: string;
  nombre: string;
  claveNombre: string;
  pais: string | null;
  genero: DeportistaResumen['genero'];
  anioNacimiento: number | null;
  guardadoEl: string;
  mismoNombre: number;
};

/**
 * Cada favorito se presenta como la persona que prevalece (una fusión posterior
 * no lo duplica ni lo pierde) y se ordena del más reciente al más antiguo con
 * desempate por ID.
 */
export function sqlListaFavoritos(
  profileId: string,
  limite: number,
  clave: readonly (string | number)[] | null,
) {
  const posicion = clave
    ? sql`WHERE (g.creado, g.canonica) < (${milisegundosMarca(String(clave[0]))}, ${String(clave[1])})`
    : sql``;
  return sql`
    SELECT p.id AS id, p.display_name AS nombre, p.name_normalized AS "claveNombre",
           p.country_code AS pais, p.gender AS genero, p.birth_year AS "anioNacimiento",
           strftime('%Y-%m-%d %H:%M:%f', g.creado / 1000.0, 'unixepoch') AS "guardadoEl",
           (SELECT count(*) FROM sport_person q
             WHERE q.merged_into_person_id IS NULL AND q.name_normalized = p.name_normalized) AS "mismoNombre"
    FROM (
      SELECT canonica, max(creado) AS creado FROM (
        SELECT f.created_at AS creado, (
          WITH RECURSIVE ruta_fusion(id, destino, salto) AS (
            SELECT sp.id, sp.merged_into_person_id, 0 FROM sport_person sp WHERE sp.id = f.person_id
            UNION ALL
            SELECT n.id, n.merged_into_person_id, r.salto + 1
            FROM sport_person n JOIN ruta_fusion r ON n.id = r.destino
            WHERE r.salto < ${SALTOS}
          )
          SELECT id FROM ruta_fusion WHERE destino IS NULL LIMIT 1
        ) AS canonica
        FROM sport_favorite f
        WHERE f.profile_id = ${profileId}
      ) crudos
      WHERE canonica IS NOT NULL
      GROUP BY canonica
    ) g
    JOIN sport_person p ON p.id = g.canonica
    ${posicion}
    ORDER BY g.creado DESC, g.canonica DESC
    LIMIT ${limite + 1}`;
}

export async function listarFavoritos(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoListaFavoritos> {
  const perfil = await exigirPerfil(ctx);
  const analizada = esquemaLista.safeParse(entrada ?? {});
  if (!analizada.success) return { estado: 'entrada_invalida' };

  // La huella incluye la cuenta: un cursor copiado de otra no se reutiliza.
  const filtros = { cuenta: perfil.profileId };
  let clave: readonly (string | number)[] | null = null;
  if (analizada.data.cursor) {
    clave = decodificarCursor(CLASE, filtros, analizada.data.cursor, 2);
    if (!clave || !MARCA_RE.test(String(clave[0])) || !Number.isFinite(milisegundosMarca(String(clave[0])))
      || !UUID_RE.test(String(clave[1]))) {
      return { estado: 'cursor_invalido' };
    }
  }

  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };

  const limite = analizada.data.limite ?? LIMITE_POR_DEFECTO;
  const encontradas = filas<FilaFavorito>(
    await ctx.db.execute(sqlListaFavoritos(perfil.profileId, limite, clave)),
  );
  const hayMas = encontradas.length > limite;
  const pagina = encontradas.slice(0, limite);

  const { conteos } = await complementos(
    ctx.db,
    pagina.map((f) => f.id),
    [],
  );
  const porId = new Map(conteos.map((c) => [c.id, c]));

  const items = pagina.map<FavoritoResumen>((f) => {
    const c = porId.get(f.id);
    return {
      id: f.id,
      nombre: f.nombre,
      alias: null,
      pais: f.pais,
      genero: f.genero,
      anioNacimiento: anioNacimientoPublico(f.anioNacimiento, ctx.hoy()),
      resultadosImportados: c ? Number(c.resultados) : 0,
      armas: c?.armas ? (c.armas.split(',').sort() as Arma[]) : [],
      mismoNombre: Number(f.mismoNombre),
      guardadoEl: f.guardadoEl,
    };
  });

  const ultima = pagina[pagina.length - 1];
  return {
    estado: 'ok',
    items,
    siguiente: hayMas && ultima ? codificarCursor(CLASE, filtros, [ultima.guardadoEl, ultima.id]) : null,
    sinResultados: items.length === 0,
  };
}
