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
import {
  coincide, COLUMNAS_RESUMEN, CTE_INDEXADAS, CTE_MARCAS, ctePalabras, ctesDelta, ctesResumenPagina,
  UNIONES_RESUMEN, vigente,
} from './busqueda-indice';
import { leerTrayectorias } from './busqueda-trayectoria';
import { SALTOS, sqlGrupoDe } from './personas';
import type { Arma, FiltrosBusqueda, Genero } from './tipos';
import { TRAYECTORIA_VACIA, type DeportistaBuscado } from './tipos-busqueda';

const CLASE = 'busqueda';

export type ResultadoBusqueda =
  | {
      estado: 'ok';
      filtros: FiltrosBusqueda;
      items: DeportistaBuscado[];
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

  const ranking = condicionRanking(f);
  if (!ranking) return porResultado;

  return sql`(${porResultado} OR EXISTS (
    SELECT 1 FROM sport_ranking_entry en2
    JOIN sport_ranking_publication pub ON pub.id = en2.publication_id
    WHERE en2.person_id IN ${grupoP} AND ${ranking}
  ))`;
}

/** Condición sobre `pub`, o `null` si algún filtro no lo documenta el ranking. */
function condicionRanking(f: FiltrosBusqueda): SQL | null {
  const soloTorneo = f.torneo || f.edicionId || f.desde || f.hasta || f.ambito;
  if (soloTorneo) return null;

  const rankingCond: SQL[] = [];
  if (f.temporada) rankingCond.push(sql`pub.season = ${f.temporada}`);
  if (f.arma) rankingCond.push(sql`pub.weapon = ${f.arma}`);
  if (f.genero) rankingCond.push(sql`pub.gender = ${f.genero}`);
  if (f.categoria) rankingCond.push(sql`pub.category = ${f.categoria}`);
  if (f.categoriaRaw) rankingCond.push(sql`pub.category_raw = ${f.categoriaRaw}`);
  if (f.formato) rankingCond.push(sql`pub.format = ${f.formato}`);
  return y(rankingCond);
}

/** Umbral de `hechos_prueba`: una temporada y arma ronda 10-15 mil resultados. */
const MAX_HECHOS_POR_ROWID = 20000;

/**
 * La misma condición que `condicionPrueba` para la búsqueda por nombre. Las
 * pruebas y publicaciones que cumplen los filtros se calculan una vez
 * (`pruebas_ok`, `pubs_ok`) en vez de unir prueba y edición a cada resultado
 * de cada candidata. Si las pruebas válidas suman pocos resultados
 * (`hechos_prueba`), el cruce es por rowid y se resuelve en
 * sport_result_person_date_idx sin leer la tabla de resultados; con muchos,
 * construir esa lista cuesta más que leer los resultados de las candidatas
 * hasta llenar la página. El CTE recursivo del grupo sólo se evalúa para las
 * candidatas con alguna persona fundida en ellas (`con_fundidas`); el resto es
 * un grupo de una sola persona. Las CTE se añaden tras `ordenadas`; la
 * condición se evalúa sobre `p`. Las fechas dependen del resultado
 * (`r.occurred_on`): con `desde`/`hasta` devuelve `null` y se usa
 * `condicionPrueba`.
 */
function pruebaPorConjuntos(f: FiltrosBusqueda): { ctes: SQL; condicion: SQL } | null {
  if (f.desde || f.hasta) return null;
  const condiciones = condicionesPrueba(f, FECHA_RESULTADO);
  if (condiciones.length === 0) return null;
  const ranking = condicionRanking(f);

  // `+`: sin él SQLite recorre los resultados de cada prueba válida (o cada
  // rowid) por cada candidata en vez de los pocos resultados de la candidata.
  const cumple = (personas: SQL) => sql`(CASE WHEN (SELECT pocos FROM modo_prueba)
      THEN EXISTS (
        SELECT 1 FROM sport_result r
        WHERE r.person_id IN ${personas} AND +r.rowid IN hechos_prueba)
      ELSE EXISTS (
        SELECT 1 FROM sport_result r
        WHERE r.person_id IN ${personas} AND +r.competition_id IN pruebas_ok) END${
    ranking
      ? sql` OR EXISTS (
      SELECT 1 FROM sport_ranking_entry en2
      WHERE en2.person_id IN ${personas} AND en2.publication_id IN pubs_ok)`
      : sql``
  })`;

  return {
    ctes: sql`,
    pruebas_ok(id) AS MATERIALIZED (
      SELECT c.id FROM sport_competition c
      CROSS JOIN sport_edition e ON e.id = c.edition_id
      LEFT JOIN event ev0 ON ev0.id = e.event_id
      WHERE ${y(condiciones)}
    ),
    hechos_prueba(rid) AS MATERIALIZED (
      SELECT r.rowid FROM sport_result r
      WHERE r.competition_id IN pruebas_ok
      LIMIT ${sql.raw(String(MAX_HECHOS_POR_ROWID + 1))}
    ),
    modo_prueba(pocos) AS MATERIALIZED (
      SELECT count(*) <= ${sql.raw(String(MAX_HECHOS_POR_ROWID))} FROM hechos_prueba
    ),${
      ranking
        ? sql`
    pubs_ok(id) AS MATERIALIZED (
      SELECT pub.id FROM sport_ranking_publication pub WHERE ${ranking}
    ),`
        : sql``
    }
    con_fundidas(id) AS MATERIALIZED (
      SELECT DISTINCT m.merged_into_person_id FROM sport_person m
      WHERE m.merged_into_person_id IN (SELECT o.id FROM ordenadas o)
    )`,
    condicion: sql`CASE WHEN p.id IN con_fundidas
      THEN ${cumple(grupoP)}
      ELSE ${cumple(sql`(p.id)`)} END`,
  };
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
  if (f.q) return sqlBusquedaPorNombre(f, f.q, limite, clave);

  // Sin nombre, casi todas las personas cumplen los filtros de prueba: el `+`
  // impide usar sport_person_merged_idx (casi todas tienen NULL) y deja a SQLite
  // recorrer sport_person_name_idx en el orden pedido, parando al llenar la
  // página en vez de evaluar y ordenar a todas.
  const condiciones: SQL[] = [sql`+p.merged_into_person_id IS NULL`];
  if (f.nacionalidad) condiciones.push(condicionNacionalidad(f.nacionalidad));
  const prueba = condicionPrueba(f);
  if (prueba) condiciones.push(prueba);
  if (clave) {
    condiciones.push(sql`(p.name_normalized, p.id) > (${String(clave[0])}, ${String(clave[1])})`);
  }

  return sql`
    SELECT p.id AS id, p.display_name AS nombre, p.name_normalized AS "claveNombre",
           NULL AS alias, p.country_code AS pais, p.gender AS genero,
           p.birth_year AS "anioNacimiento"
    FROM sport_person p
    WHERE ${y(condiciones)}
    ORDER BY p.name_normalized ASC, p.id ASC
    LIMIT ${limite + 1}`;
}

/**
 * Con nombre, la coincidencia de texto se resuelve primero en bloque: un
 * recorrido del índice de nombres y otro del de alias, en vez de un CTE
 * recursivo por persona. Un alias de una persona fundida sube por
 * `merged_into_person_id` (hasta `SALTOS`) hasta la que prevalece: es el mismo
 * grupo que `sqlGrupoDe` recorre hacia abajo. Las candidatas se ordenan antes
 * de los filtros de prueba y nacionalidad para que SQLite los evalúe en ese
 * orden y pare al llenar la página. Alias mostrado y columnas de la ficha se
 * leen después del LIMIT, sólo para la página.
 */
function sqlBusquedaPorNombre(
  f: FiltrosBusqueda,
  q: string,
  limite: number,
  clave: readonly (string | number)[] | null,
): SQL {
  const nombreDe = (columna: SQL) => palabrasCoinciden(columna, q.split(' '));

  const condiciones: SQL[] = [];
  const porConjuntos = pruebaPorConjuntos(f);
  const prueba = porConjuntos ? porConjuntos.condicion : condicionPrueba(f);
  if (prueba) condiciones.push(prueba);
  if (f.nacionalidad) condiciones.push(condicionNacionalidad(f.nacionalidad));
  const filtros = condiciones.length > 0 ? sql`WHERE ${y(condiciones)}` : sql``;
  const tras = clave
    ? sql`WHERE (p.name_normalized, p.id) > (${String(clave[0])}, ${String(clave[1])})`
    : sql``;

  // `rowid IN (...)` recorre sport_person_name_idx como índice de cobertura,
  // mucho más estrecho que la tabla, y sólo lee las filas que coinciden.
  // Casi todos los alias repiten el nombre de su persona: la subida parte de
  // `nombres` cuando la persona ya está ahí y sólo busca por ID las demás.
  return sql`
    WITH RECURSIVE
    nombres(id, name_normalized, merged_into_person_id, country_code) AS MATERIALIZED (
      SELECT p.id, p.name_normalized, p.merged_into_person_id, p.country_code
      FROM sport_person p
      WHERE p.rowid IN (
        SELECT i.rowid FROM sport_person i WHERE ${nombreDe(sql`i.name_normalized`)})
    ),
    por_alias(id) AS MATERIALIZED (
      SELECT DISTINCT a.person_id FROM sport_person_alias a
      WHERE ${nombreDe(sql`a.name_normalized`)}
    ),
    subida(id, name_normalized, merged_into_person_id, country_code, salto) AS (
      SELECT * FROM (
        SELECT n.id, n.name_normalized, n.merged_into_person_id, n.country_code, 0
        FROM nombres n WHERE n.id IN por_alias
        UNION ALL
        SELECT sp.id, sp.name_normalized, sp.merged_into_person_id, sp.country_code, 0
        FROM por_alias x CROSS JOIN sport_person sp ON sp.id = x.id
        WHERE x.id NOT IN (SELECT id FROM nombres)
      )
      UNION ALL
      SELECT sp.id, sp.name_normalized, sp.merged_into_person_id, sp.country_code, s.salto + 1
      FROM subida s JOIN sport_person sp ON sp.id = s.merged_into_person_id
      WHERE s.salto < ${SALTOS}
    ),
    candidatas(id, name_normalized, country_code) AS MATERIALIZED (
      SELECT p.id, p.name_normalized, p.country_code FROM nombres p
      WHERE p.merged_into_person_id IS NULL
      UNION
      SELECT s.id, s.name_normalized, s.country_code FROM subida s
      WHERE s.merged_into_person_id IS NULL
    ),
    ordenadas(id, name_normalized, country_code) AS MATERIALIZED (
      SELECT p.id, p.name_normalized, p.country_code FROM candidatas p ${tras}
      ORDER BY p.name_normalized, p.id
    )${porConjuntos ? porConjuntos.ctes : sql``}
    SELECT p.id AS id, sp.display_name AS nombre, p.name_normalized AS "claveNombre",
           CASE WHEN ${nombreDe(sql`p.name_normalized`)} THEN NULL ELSE (
             SELECT a.name_original FROM sport_person_alias a
             WHERE a.person_id IN ${grupoP} AND ${nombreDe(sql`a.name_normalized`)}
             ORDER BY a.name_normalized, a.id LIMIT 1) END AS alias,
           p.country_code AS pais, sp.gender AS genero, sp.birth_year AS "anioNacimiento"
    FROM (
      SELECT p.id, p.name_normalized, p.country_code
      FROM ordenadas p
      ${filtros}
      ORDER BY p.name_normalized ASC, p.id ASC
      LIMIT ${limite + 1}
    ) p
    CROSS JOIN sport_person sp ON sp.id = p.id
    ORDER BY p.name_normalized ASC, p.id ASC`;
}

/**
 * La búsqueda por nombre con el índice de palabras, en UNA sentencia.
 *
 * - `indexadas`/`orden_indice`: las personas del índice con todas las
 *   palabras, ya en orden de página (`n`), sin leer sport_person.
 * - `pagina_indice` las recorre en ese orden y, para cada una, comprueba en
 *   vivo lo mismo que `sqlBusquedaPorNombre` (sigue prevaleciendo, su nombre o
 *   un alias de su grupo coincide) y los filtros; para al llenar la página, así
 *   que una consulta frecuente («ma») no lee miles de personas.
 * - `delta_raices`/`pagina_delta`: altas posteriores a la reconstrucción.
 * - Recuentos, armas, trayectoria y homónimos de la página van en la misma
 *   sentencia en lugar de dos lecturas más (D1 ejecuta una sentencia tras otra).
 *
 * El orden de `n` es el de (name_normalized, id) al reconstruir; coincide con
 * el vivo mientras no cambie el nombre de una persona ya indexada.
 */
export function sqlBusquedaIndexada(
  f: FiltrosBusqueda & { q: string },
  limite: number,
  clave: readonly (string | number)[] | null,
): SQL {
  const filtros: SQL[] = [];
  const porConjuntos = pruebaPorConjuntos(f);
  const prueba = porConjuntos ? porConjuntos.condicion : condicionPrueba(f);
  if (prueba) filtros.push(prueba);
  if (f.nacionalidad) filtros.push(condicionNacionalidad(f.nacionalidad));
  const cursor = clave ? [String(clave[0]), String(clave[1])] as const : null;
  if (cursor) filtros.push(sql`(p.name_normalized, p.id) > (${cursor[0]}, ${cursor[1]})`);
  const desde = cursor
    ? sql`(SELECT coalesce((
        SELECT o.n FROM explorar_persona o
        WHERE (o.name_normalized, o.id) <= (${cursor[0]}, ${cursor[1]})
        ORDER BY o.name_normalized DESC, o.id DESC LIMIT 1), 0))`
    : sql`0`;

  return sql`
    WITH RECURSIVE
    ${ctePalabras(f.q.split(' '))},
    ${CTE_MARCAS},
    ${CTE_INDEXADAS},
    ${ctesDelta()},
    orden_indice(n, id) AS MATERIALIZED (
      SELECT i.n, ep.id FROM indexadas i CROSS JOIN explorar_persona ep ON ep.n = i.n
      WHERE i.n > ${desde}
      ORDER BY i.n
    )${porConjuntos ? sql`,
    ordenadas(id) AS MATERIALIZED (
      SELECT id FROM orden_indice UNION SELECT id FROM delta_raices
    )${porConjuntos.ctes}` : sql``},
    pagina_indice(id, name_normalized, country_code) AS MATERIALIZED (
      SELECT p.id, p.name_normalized, p.country_code
      FROM orden_indice o CROSS JOIN sport_person p ON p.id = o.id
      WHERE ${y([vigente(), ...filtros])}
      ORDER BY o.n
      LIMIT ${limite + 1}
    ),
    pagina_delta(id, name_normalized, country_code) AS MATERIALIZED (
      SELECT p.id, p.name_normalized, p.country_code
      FROM delta_raices d CROSS JOIN sport_person p ON p.id = d.id
      WHERE ${y(filtros)}
    ),
    pagina(id, name_normalized, country_code) AS MATERIALIZED (
      SELECT id, name_normalized, country_code FROM pagina_indice
      UNION
      SELECT id, name_normalized, country_code FROM pagina_delta
      ORDER BY 2, 1
      LIMIT ${limite + 1}
    )${ctesResumenPagina(limite)}
    SELECT p.id AS id, sp.display_name AS nombre, p.name_normalized AS "claveNombre",
           CASE WHEN ${coincide(sql`p.name_normalized`)} THEN NULL ELSE (
             SELECT a.name_original FROM sport_person_alias a
             WHERE a.person_id IN ${grupoP} AND ${coincide(sql`a.name_normalized`)}
             ORDER BY a.name_normalized, a.id LIMIT 1) END AS alias,
           p.country_code AS pais, sp.gender AS genero, sp.birth_year AS "anioNacimiento",
           ${COLUMNAS_RESUMEN}
    FROM pagina p
    CROSS JOIN sport_person sp ON sp.id = p.id
    ${UNIONES_RESUMEN}
    ORDER BY p.name_normalized ASC, p.id ASC`;
}

type FilaIndexada = FilaBusqueda & {
  resultados: number;
  armas: string | null;
  mejorPuesto: number | null;
  oros: number;
  platas: number;
  bronces: number;
  ultimaEdicion: string | null;
  ultimoTorneo: string | null;
  ultimaFecha: string | null;
  mismoNombre: number;
};

function deportistaIndexado(p: FilaIndexada): DeportistaBuscado {
  const resultados = Number(p.resultados ?? 0);
  return {
    id: p.id,
    nombre: p.nombre,
    alias: p.alias,
    pais: p.pais,
    genero: p.genero,
    anioNacimiento: p.anioNacimiento === null ? null : Number(p.anioNacimiento),
    resultadosImportados: resultados,
    armas: p.armas ? (p.armas.split(',').sort() as Arma[]) : [],
    mismoNombre: Number(p.mismoNombre ?? 1) || 1,
    trayectoria: resultados === 0 ? TRAYECTORIA_VACIA : {
      ultima: p.ultimaEdicion && p.ultimoTorneo
        ? { edicionId: p.ultimaEdicion, torneo: p.ultimoTorneo, fecha: p.ultimaFecha }
        : null,
      mejorPuesto: p.mejorPuesto === null ? null : Number(p.mejorPuesto),
      oros: Number(p.oros ?? 0),
      platas: Number(p.platas ?? 0),
      bronces: Number(p.bronces ?? 0),
    },
  };
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
          -- CROSS JOIN: sin él SQLite recorre todo sport_result y busca en el CTE.
          CROSS JOIN sport_result r ON r.person_id = g.id
          JOIN sport_competition c ON c.id = r.competition_id
          GROUP BY g.canonica`),
    claves.length === 0
      ? []
      : db.execute(sql`
          SELECT name_normalized AS clave, count(*) AS personas
          FROM sport_person
          -- '+': sin él SQLite recorre todas las personas no fundidas por merged_idx.
          WHERE +merged_into_person_id IS NULL
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

  if (filtros.q && ctx.indiceExplorar && (await ctx.indiceExplorar())) {
    const q = filtros.q;
    const encontradas = filas<FilaIndexada>(
      await ctx.db.execute(sqlBusquedaIndexada({ ...filtros, q }, limite, clave)),
    );
    const pagina = encontradas.slice(0, limite);
    const ultima = pagina[pagina.length - 1];
    return {
      estado: 'ok',
      filtros,
      items: pagina.map(deportistaIndexado),
      siguiente: encontradas.length > limite && ultima
        ? codificarCursor(CLASE, filtros, [ultima.claveNombre, ultima.id])
        : null,
      sinResultados: pagina.length === 0,
    };
  }

  const encontradas = filas<FilaBusqueda>(await ctx.db.execute(sqlBusqueda(filtros, limite, clave)));
  const hayMas = encontradas.length > limite;
  const pagina = encontradas.slice(0, limite);

  const ids = pagina.map((p) => p.id);
  const [{ conteos, nombres }, trayectorias] = await Promise.all([
    complementos(ctx.db, ids, [...new Set(pagina.map((p) => p.claveNombre))]),
    leerTrayectorias(ctx.db, ids),
  ]);
  const porId = new Map(conteos.map((c) => [c.id, c]));
  const porClave = new Map(nombres.map((n) => [n.clave, Number(n.personas)]));

  const items = pagina.map<DeportistaBuscado>((p) => {
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
      trayectoria: trayectorias.get(p.id) ?? TRAYECTORIA_VACIA,
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
