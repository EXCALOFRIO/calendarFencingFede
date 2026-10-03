import { sql, type SQL } from 'drizzle-orm';
import { filas, exigirPerfil, type ContextoExplorador } from './contexto';
import { codificarCursor, decodificarCursor, UUID_RE } from './cursor';
import {
  esquemaBusqueda,
  filtrosBusqueda,
  LIMITE_POR_DEFECTO,
  tieneCriterioDePrueba,
} from './entrada';
import {
  condicionesPrueba,
  FECHA_RESULTADO,
  listaUuid,
  unionesPrueba,
  y,
} from './filtros-sql';
import { SALTOS, sqlGrupoDe } from './personas';
import type { Arma, DeportistaResumen, FiltrosBusqueda, Genero } from './tipos';

const CLASE = 'busqueda';

export type ResultadoBusqueda =
  | {
      estado: 'ok';
      filtros: FiltrosBusqueda;
      items: DeportistaResumen[];
      /** Cursor de la página siguiente, o `null` si ésta es la última. */
      siguiente: string | null;
      /** `true` = la consulta se hizo y no encontró a nadie (no es un fallo). */
      sinResultados: boolean;
    }
  | { estado: 'sin_criterio' }
  | { estado: 'entrada_invalida' }
  | { estado: 'cursor_invalido' }
  /** El esquema deportivo (migración 0017) no está aplicado: no es «sin resultados». */
  | { estado: 'no_disponible' };

/**
 * Alias y hechos pueden seguir colgando de una persona fundida: se buscan en
 * todo el grupo de la persona `p` (la que prevalece), igual que ficha e
 * histórico, y la fila devuelta sigue siendo la de `p`.
 */
const grupoP = sqlGrupoDe(sql`p.id`);

function palabrasCoinciden(columna: SQL, palabras: readonly string[]): SQL {
  return y(
    palabras.map(
      (w) => sql`(${columna} LIKE ${`${w}%`} OR ${columna} LIKE ${`% ${w}%`})`,
    ),
  );
}

function condicionNombre(q: string): { nombre: SQL; alias: SQL } {
  const palabras = q.split(' ');
  return {
    nombre: palabrasCoinciden(sql`p.name_normalized`, palabras),
    alias: palabrasCoinciden(sql`a.name_normalized`, palabras),
  };
}

/**
 * Nacionalidad documentada: la que publica la persona o la que consta en sus
 * resultados y rankings oficiales. Para ESP también cuenta una licencia RFEE
 * confirmada, porque la expide la federación española. Sin ninguna de esas
 * pruebas la persona no se considera de ese país.
 */
function condicionNacionalidad(codigo: string): SQL {
  const licenciaRfee =
    codigo === 'ESP'
      ? sql`OR EXISTS (
          SELECT 1 FROM sport_external_id x
          WHERE x.person_id IN ${grupoP} AND x.scheme = 'rfee_license' AND x.link_status = 'CONFIRMADO')`
      : sql``;
  return sql`(
    p.country_code = ${codigo}
    OR EXISTS (SELECT 1 FROM sport_result rn WHERE rn.person_id IN ${grupoP} AND rn.source_country_code = ${codigo})
    OR EXISTS (SELECT 1 FROM sport_ranking_entry en WHERE en.person_id IN ${grupoP} AND en.country_code = ${codigo})
    ${licenciaRfee}
  )`;
}

/**
 * Persona con participación documentada que cumple TODOS los filtros de
 * prueba en un mismo hecho. El ranking oficial sólo documenta arma, género,
 * categoría, formato y temporada; con torneo, fechas o ámbito sólo valen los
 * resultados de torneo, que son los que tienen esos datos.
 */
function condicionPrueba(f: FiltrosBusqueda): SQL | null {
  const condiciones = condicionesPrueba(f, FECHA_RESULTADO);
  if (condiciones.length === 0) return null;

  const porResultado = sql`EXISTS (
    SELECT 1 FROM sport_result r
    ${unionesPrueba('r')}
    WHERE r.person_id IN ${grupoP} AND ${y(condiciones)}
  )`;

  const soloTorneo = f.torneo || f.edicionId || f.desde || f.hasta || f.ambito;
  if (soloTorneo) return porResultado;

  const rankingCond: SQL[] = [];
  if (f.temporada) rankingCond.push(sql`pub.season = ${f.temporada}`);
  if (f.arma) rankingCond.push(sql`pub.weapon = ${f.arma}`);
  if (f.genero) rankingCond.push(sql`pub.gender = ${f.genero}`);
  if (f.categoria) rankingCond.push(sql`pub.category = ${f.categoria}`);
  if (f.categoriaRaw) rankingCond.push(sql`pub.category_raw = ${f.categoriaRaw}`);
  if (f.formato) rankingCond.push(sql`pub.format = ${f.formato}`);

  return sql`(${porResultado} OR EXISTS (
    SELECT 1 FROM sport_ranking_entry en2
    JOIN sport_ranking_publication pub ON pub.id = en2.publication_id
    WHERE en2.person_id IN ${grupoP} AND ${y(rankingCond)}
  ))`;
}

type FilaBusqueda = {
  id: string;
  nombre: string;
  claveNombre: string;
  alias: string | null;
  pais: string | null;
  genero: Genero | null;
  anioNacimiento: number | null;
};

export function sqlBusqueda(
  f: FiltrosBusqueda,
  limite: number,
  clave: readonly (string | number)[] | null,
): SQL {
  const condiciones: SQL[] = [sql`p.merged_into_person_id IS NULL`];
  let aliasSql: SQL = sql`NULL`;

  if (f.q) {
    const { nombre, alias } = condicionNombre(f.q);
    const porAlias = sql`EXISTS (SELECT 1 FROM sport_person_alias a WHERE a.person_id IN ${grupoP} AND ${alias})`;
    condiciones.push(sql`(${nombre} OR ${porAlias})`);
    aliasSql = sql`CASE WHEN ${nombre} THEN NULL ELSE (
      SELECT a.name_original FROM sport_person_alias a
      WHERE a.person_id IN ${grupoP} AND ${alias}
      ORDER BY a.name_normalized, a.id LIMIT 1) END`;
  }
  if (f.nacionalidad) condiciones.push(condicionNacionalidad(f.nacionalidad));
  const prueba = condicionPrueba(f);
  if (prueba) condiciones.push(prueba);
  if (clave) {
    condiciones.push(sql`(p.name_normalized, p.id) > (${String(clave[0])}, ${String(clave[1])})`);
  }

  return sql`
    SELECT p.id AS id, p.display_name AS nombre, p.name_normalized AS "claveNombre",
           ${aliasSql} AS alias, p.country_code AS pais, p.gender AS genero,
           p.birth_year AS "anioNacimiento"
    FROM sport_person p
    WHERE ${y(condiciones)}
    ORDER BY p.name_normalized ASC, p.id ASC
    LIMIT ${limite + 1}`;
}

export async function complementos(
  db: ContextoExplorador['db'],
  ids: readonly string[],
  claves: readonly string[],
) {
  const [conteos, nombres] = await Promise.all([
    ids.length === 0
      ? []
      : db.execute(sql`
          WITH RECURSIVE miembros_grupo(canonica, id, salto) AS (
            SELECT id, id, 0 FROM sport_person WHERE id IN (${listaUuid(ids)})
            UNION ALL
            SELECT mg.canonica, mp.id, mg.salto + 1
            FROM sport_person mp JOIN miembros_grupo mg ON mp.merged_into_person_id = mg.id
            WHERE mg.salto < ${SALTOS}
          )
          SELECT g.canonica AS id, count(*) AS resultados,
                 group_concat(DISTINCT c.weapon) AS armas
          FROM miembros_grupo g
          JOIN sport_result r ON r.person_id = g.id
          JOIN sport_competition c ON c.id = r.competition_id
          GROUP BY g.canonica`),
    claves.length === 0
      ? []
      : db.execute(sql`
          SELECT name_normalized AS clave, count(*) AS personas
          FROM sport_person
          WHERE merged_into_person_id IS NULL
            AND name_normalized IN (SELECT value FROM json_each(${JSON.stringify(claves)}))
          GROUP BY name_normalized`),
  ]);
  return {
    conteos: filas<{ id: string; resultados: number; armas: string | null }>(conteos),
    nombres: filas<{ clave: string; personas: number }>(nombres),
  };
}

/**
 * Búsqueda de deportistas globales, paginada por clave `(nombre normalizado,
 * id)`. Guarda de sesión antes de cualquier SQL. No lee `athlete` ni ninguna
 * tabla de cuenta: incluye personas sin cuenta, con ficha inactiva o con sólo
 * un alias coincidente, y excluye las fundidas en otra: se llega a ellas por
 * la persona que prevalece, a través de los alias y hechos de todo su grupo.
 * Nunca dispara una lectura de fuentes externas.
 */
export async function buscarDeportistas(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoBusqueda> {
  await exigirPerfil(ctx);

  const analizada = esquemaBusqueda.safeParse(entrada);
  if (!analizada.success) return { estado: 'entrada_invalida' };

  const filtros = filtrosBusqueda(analizada.data);
  if (!filtros.q && !filtros.nacionalidad && !tieneCriterioDePrueba(filtros)) {
    return { estado: 'sin_criterio' };
  }

  let clave: readonly (string | number)[] | null = null;
  if (analizada.data.cursor) {
    clave = decodificarCursor(CLASE, filtros, analizada.data.cursor, 2);
    if (!clave || typeof clave[0] !== 'string' || !UUID_RE.test(String(clave[1]))) {
      return { estado: 'cursor_invalido' };
    }
  }

  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };

  const limite = analizada.data.limite ?? LIMITE_POR_DEFECTO;
  const encontradas = filas<FilaBusqueda>(await ctx.db.execute(sqlBusqueda(filtros, limite, clave)));
  const hayMas = encontradas.length > limite;
  const pagina = encontradas.slice(0, limite);

  const { conteos, nombres } = await complementos(
    ctx.db,
    pagina.map((p) => p.id),
    [...new Set(pagina.map((p) => p.claveNombre))],
  );
  const porId = new Map(conteos.map((c) => [c.id, c]));
  const porClave = new Map(nombres.map((n) => [n.clave, Number(n.personas)]));

  const items = pagina.map<DeportistaResumen>((p) => {
    const c = porId.get(p.id);
    return {
      id: p.id,
      nombre: p.nombre,
      alias: p.alias,
      pais: p.pais,
      genero: p.genero,
      anioNacimiento: p.anioNacimiento === null ? null : Number(p.anioNacimiento),
      resultadosImportados: c ? Number(c.resultados) : 0,
      armas: c?.armas ? (c.armas.split(',').sort() as Arma[]) : [],
      mismoNombre: porClave.get(p.claveNombre) ?? 1,
    };
  });

  const ultima = pagina[pagina.length - 1];
  return {
    estado: 'ok',
    filtros,
    items,
    siguiente:
      hayMas && ultima ? codificarCursor(CLASE, filtros, [ultima.claveNombre, ultima.id]) : null,
    sinResultados: items.length === 0,
  };
}
