import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { codificarCursor, decodificarCursor, FECHA_RE, UUID_RE } from './cursor';
import { aResumen, COLUMNAS_EDICION } from './ediciones';
import type { EdicionResumen } from './edicion-modelo';
import { plegarSql, y } from './filtros-sql';

export const LIMITE_CATALOGO = 25;
const CLASE = 'catalogo-ediciones';
const esquema = z.object({
  q: z.string().max(100).optional(),
  fuente: z.enum(['fie', 'efc', 'skermo_rfee', 'rfee_pdf', 'engarde']).optional(),
  temporada: z.string().regex(/^\d{4}(?:-\d{4})?$/).optional(),
  cursor: z.string().min(1).max(600).optional(),
}).strict();

type FilaCatalogo = Parameters<typeof aResumen>[0] & { clasificados?: number | null };
/** `clasificados` cuenta filas de clasificación de todas sus pruebas, no personas distintas. */
export type EdicionDeCatalogo = EdicionResumen & { clasificados?: number };
export type ResultadoCatalogo =
  | { estado: 'ok'; ediciones: EdicionDeCatalogo[]; total: number; pruebas: number; siguiente: string | null }
  | { estado: 'entrada_invalida' | 'cursor_invalido' | 'no_disponible' };
export type VistaCatalogo = ResultadoCatalogo | { estado: 'sin_sesion' | 'error' };

/** Toda edición es consultable, aunque no tenga vínculos a calendario o personas. */
export async function leerCatalogoEdiciones(ctx: ContextoExplorador, entrada: unknown): Promise<ResultadoCatalogo> {
  await exigirPerfil(ctx);
  const pedido = esquema.safeParse(entrada);
  if (!pedido.success) return { estado: 'entrada_invalida' };
  const q = (pedido.data.q ?? '').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[-,./]/g, ' ').replace(/\s+/g, ' ').trim();
  const filtros = { q, fuente: pedido.data.fuente ?? '', temporada: pedido.data.temporada ?? '' };
  const clave = pedido.data.cursor ? decodificarCursor(CLASE, filtros, pedido.data.cursor, 2) : null;
  if (pedido.data.cursor && (!clave || typeof clave[0] !== 'string' || !FECHA_RE.test(clave[0]) ||
    typeof clave[1] !== 'string' || !UUID_RE.test(clave[1]))) return { estado: 'cursor_invalido' };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };

  const condiciones: SQL[] = [];
  if (q) condiciones.push(sql`(instr(${plegarSql(sql`e.name`)}, ${q}) > 0 OR instr(${plegarSql(sql`e.city`)}, ${q}) > 0)`);
  if (filtros.fuente) condiciones.push(sql`e.source = ${filtros.fuente}`);
  if (filtros.temporada) condiciones.push(sql`e.season = ${filtros.temporada}`);
  const pagina = [...condiciones];
  if (clave) pagina.push(sql`(coalesce(e.start_date, '0000-01-01'), e.id) < (${clave[0]}, ${clave[1]})`);

  // Sólo metadatos y agregados. Nunca descarga todos los hechos ni una lista de personas.
  const [conteo, lista] = await Promise.all([
    ctx.db.execute(sql`
      SELECT count(*) AS total,
        coalesce(sum((SELECT count(*) FROM sport_competition c WHERE c.edition_id=e.id)), 0) AS pruebas
      FROM sport_edition e WHERE ${y(condiciones)}`),
    // La página se elige antes de calcular los agregados: SQLite evalúa las
    // subconsultas de las columnas antes de ordenar, y así contaba los
    // resultados de todas las ediciones filtradas, no sólo de las visibles.
    ctx.db.execute(sql`
      SELECT ${COLUMNAS_EDICION},
        (SELECT count(*) FROM sport_competition c JOIN sport_result cr ON cr.competition_id = c.id
          WHERE c.edition_id = e.id) AS clasificados
      FROM (
        SELECT e.* FROM sport_edition e WHERE ${y(pagina)}
        ORDER BY coalesce(e.start_date, '0000-01-01') DESC, e.id DESC
        LIMIT ${LIMITE_CATALOGO + 1}
      ) e
      ORDER BY coalesce(e.start_date, '0000-01-01') DESC, e.id DESC`),
  ]);
  const [total] = filas<{ total: number; pruebas: number }>(conteo);
  const rows = filas<FilaCatalogo>(lista);
  const visibles = rows.slice(0, LIMITE_CATALOGO);
  const ultima = visibles.at(-1);
  return {
    estado: 'ok',
    ediciones: visibles.map((f) => ({ ...aResumen(f), clasificados: Number(f.clasificados ?? 0) })),
    total: Number(total?.total ?? 0),
    pruebas: Number(total?.pruebas ?? 0),
    siguiente: rows.length > LIMITE_CATALOGO && ultima
      ? codificarCursor(CLASE, filtros, [ultima.inicio ?? '0000-01-01', ultima.id]) : null,
  };
}

export async function cargarCatalogoEdiciones(ctx: ContextoExplorador, entrada: unknown): Promise<VistaCatalogo> {
  try { return await leerCatalogoEdiciones(ctx, entrada); }
  catch (error) {
    if (error instanceof Error && error.message === 'NO_AUTENTICADO') return { estado: 'sin_sesion' };
    console.error('[explorar] el catálogo no se pudo leer:', error instanceof Error ? error.name : 'desconocido');
    return { estado: 'error' };
  }
}
