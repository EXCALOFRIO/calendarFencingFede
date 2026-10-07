import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { codificarCursor, decodificarCursor, FECHA_RE, UUID_RE } from './cursor';
import { aResumen, COLUMNAS_EDICION } from './ediciones';
import type { EdicionResumen } from './edicion-modelo';
import { plegarSql, y } from './filtros-sql';
import { ARMAS_INDICE, buscarEnIndice, CATEGORIAS_INDICE, resumenDeIndice, type IndiceEdiciones } from './indice-ediciones';

export const LIMITE_CATALOGO = 25;
const CLASE = 'catalogo-ediciones';
const CLASE_INDICE = 'catalogo-indice';
const ANIO = z.string().regex(/^(19|20)\d{2}$/);
const esquema = z.object({
  q: z.string().max(100).optional(),
  fuente: z.enum(['fie', 'efc', 'skermo_rfee', 'rfee_pdf', 'engarde']).optional(),
  temporada: z.string().regex(/^\d{4}(?:-\d{4})?$/).optional(),
  arma: z.enum(ARMAS_INDICE).optional(),
  categoria: z.enum(CATEGORIAS_INDICE as [string, ...string[]]).optional(),
  desde: ANIO.optional(),
  hasta: ANIO.optional(),
  cursor: z.string().min(1).max(600).optional(),
}).strict().refine((e) => !e.desde || !e.hasta || e.desde <= e.hasta);

type FilaCatalogo = Parameters<typeof aResumen>[0] & { clasificados?: number | null };
/** `clasificados` cuenta filas de clasificación de todas sus pruebas, no personas distintas. */
export type EdicionDeCatalogo = EdicionResumen & { clasificados?: number };
export type ResultadoCatalogo =
  | { estado: 'ok'; ediciones: EdicionDeCatalogo[]; total: number; pruebas: number; siguiente: string | null }
  | { estado: 'entrada_invalida' | 'cursor_invalido' | 'no_disponible' };
export type VistaCatalogo = ResultadoCatalogo | { estado: 'sin_sesion' | 'error' };

export type OpcionesCatalogo = {
  /**
   * Índice en memoria de las ediciones (`indice-ediciones.ts`). Con él la
   * búsqueda tolera erratas y sinónimos y no lee D1; si falta o devuelve
   * `null`, se busca en D1 por subcadena del nombre o la ciudad.
   */
  indice?: () => Promise<IndiceEdiciones | null>;
};

/** Normalización de `q` común a la clave de caché, al cursor y a la consulta. */
export function normalizarQCatalogo(q: string): string {
  return q.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-,./]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Toda edición es consultable, aunque no tenga vínculos a calendario o personas. */
export async function leerCatalogoEdiciones(
  ctx: ContextoExplorador,
  entrada: unknown,
  opciones: OpcionesCatalogo = {},
): Promise<ResultadoCatalogo> {
  await exigirPerfil(ctx);
  const pedido = esquema.safeParse(entrada);
  if (!pedido.success) return { estado: 'entrada_invalida' };
  const p = pedido.data;
  const q = normalizarQCatalogo(p.q ?? '');
  const extra = {
    ...(p.arma ? { arma: p.arma } : {}), ...(p.categoria ? { categoria: p.categoria } : {}),
    ...(p.desde ? { desde: p.desde } : {}), ...(p.hasta ? { hasta: p.hasta } : {}),
  };
  const filtros = { q, fuente: p.fuente ?? '', temporada: p.temporada ?? '', ...extra };

  const indice = opciones.indice ? await opciones.indice().catch(() => null) : null;
  if (indice) {
    const clave = p.cursor ? decodificarCursor(CLASE_INDICE, filtros, p.cursor, 1) : null;
    if (p.cursor && (!clave || typeof clave[0] !== 'number' || !Number.isInteger(clave[0]) || clave[0] < 0)) {
      return { estado: 'cursor_invalido' };
    }
    const desde = (clave?.[0] as number | undefined) ?? 0;
    const { posiciones, pruebas } = buscarEnIndice(indice, { ...filtros, q: p.q ?? '' });
    const pagina = posiciones.slice(desde, desde + LIMITE_CATALOGO);
    const siguiente = desde + LIMITE_CATALOGO;
    return {
      estado: 'ok',
      ediciones: pagina.map((e) => resumenDeIndice(indice, e)),
      total: posiciones.length,
      pruebas,
      siguiente: posiciones.length > siguiente ? codificarCursor(CLASE_INDICE, filtros, [siguiente]) : null,
    };
  }

  const clave = p.cursor ? decodificarCursor(CLASE, filtros, p.cursor, 2) : null;
  if (p.cursor && (!clave || typeof clave[0] !== 'string' || !FECHA_RE.test(clave[0]) ||
    typeof clave[1] !== 'string' || !UUID_RE.test(clave[1]))) return { estado: 'cursor_invalido' };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };

  const condiciones: SQL[] = [];
  if (q) condiciones.push(sql`(instr(${plegarSql(sql`e.name`)}, ${q}) > 0 OR instr(${plegarSql(sql`e.city`)}, ${q}) > 0)`);
  if (filtros.fuente) condiciones.push(sql`e.source = ${filtros.fuente}`);
  if (filtros.temporada) condiciones.push(sql`e.season = ${filtros.temporada}`);
  if (p.arma) condiciones.push(sql`EXISTS (SELECT 1 FROM sport_competition c WHERE c.edition_id = e.id AND c.weapon = ${p.arma})`);
  if (p.categoria) condiciones.push(sql`EXISTS (SELECT 1 FROM sport_competition c WHERE c.edition_id = e.id AND c.category = ${p.categoria})`);
  if (p.desde) condiciones.push(sql`coalesce(e.end_date, e.start_date) >= ${`${p.desde}-01-01`}`);
  if (p.hasta) condiciones.push(sql`e.start_date <= ${`${p.hasta}-12-31`}`);
  const pagina = [...condiciones];
  // Un filtro que no usa índice, a propósito: el recorrido lo marca el ORDER BY de abajo.
  if (clave) pagina.push(sql`(coalesce(e.start_date, '0000-01-01'), e.id) < (${clave[0]}, ${clave[1]})`);

  // Sólo metadatos y agregados. Nunca descarga todos los hechos ni una lista de personas.
  const [conteo, lista] = await Promise.all([
    // Sin filtros, dos recuentos sobre índices cubrientes; con filtros, por edición.
    ctx.db.execute(condiciones.length === 0
      ? sql`
      SELECT (SELECT count(*) FROM sport_edition) AS total,
        (SELECT count(*) FROM sport_competition c WHERE c.edition_id IS NOT NULL) AS pruebas`
      : sql`
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
        -- En SQLite un NULL va el último en DESC, como el '0000-01-01' de fuera; así
        -- recorre sport_edition_dates_idx y para en la página en vez de ordenar todas.
        ORDER BY e.start_date DESC, e.id DESC
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

export async function cargarCatalogoEdiciones(
  ctx: ContextoExplorador,
  entrada: unknown,
  opciones: OpcionesCatalogo = {},
): Promise<VistaCatalogo> {
  try { return await leerCatalogoEdiciones(ctx, entrada, opciones); }
  catch (error) {
    if (error instanceof Error && error.message === 'NO_AUTENTICADO') return { estado: 'sin_sesion' };
    console.error('[explorar] el catálogo no se pudo leer:', error instanceof Error ? error.name : 'desconocido');
    return { estado: 'error' };
  }
}
