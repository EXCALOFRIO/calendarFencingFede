import { sql, type SQL } from 'drizzle-orm';
import { filas, type ContextoExplorador } from './contexto';
import { rondaCuadro } from './ediciones-asaltos';
import { CATEGORIAS_PAIS, modalidadAgregado, type FiltrosDuelo, type FiltrosPais } from './pais-url';

/**
 * Lecturas de las fichas de país sobre los agregados de la 0018
 * (`pais-indice-sql.ts`). Ninguna recorre `sport_bout`: el resumen es una
 * búsqueda por clave, los podios y la lista de pruebas leen la página que se
 * enseña, y los asaltos de esa página se leen por su id.
 *
 * Sólo hechos deportivos publicados: nombre de la persona y su país. Nada de
 * foto, edad, club ni enlace FIE (pueden ser menores).
 */

type Db = ContextoExplorador['db'];

export type EstadoPaises = { version: number; construidoEn: number };

const n = (v: unknown) => (v == null ? 0 : Number(v));
const nn = (v: unknown) => (v == null ? null : Number(v));

/** ¿Falta la 0018? Entonces la pantalla dice que aún no hay datos. */
export function esTablaAusente(error: unknown): boolean {
  return /no such table: explorar_pais_/.test(error instanceof Error ? error.message : String(error));
}

const MEMO_ESTADO_MS = 60_000;
const estados = new WeakMap<object, { hasta: number; valor: Promise<EstadoPaises | null> }>();

/**
 * Marca de la última reconstrucción (una fila), recordada un minuto por base:
 * va en la clave de la caché, así que una reconstrucción se ve al minuto sin
 * esperar a que la caché caduque. `null` sin la 0018 o antes de la primera.
 */
export function leerEstadoPaises(db: Db, ahora = Date.now()): Promise<EstadoPaises | null> {
  const memo = estados.get(db);
  if (memo && memo.hasta > ahora) return memo.valor;
  const valor = (async () => {
    try {
      const [f] = filas<{ version: number; construido: number }>(await db.execute(sql`
        SELECT version, construido_en AS construido FROM explorar_pais_estado WHERE key = 'global'`));
      return f ? { version: n(f.version), construidoEn: n(f.construido) } : null;
    } catch (error) {
      if (esTablaAusente(error)) return null;
      throw error;
    }
  })();
  const entrada = { hasta: ahora + MEMO_ESTADO_MS, valor };
  estados.set(db, entrada);
  valor.catch(() => { if (estados.get(db) === entrada) estados.delete(db); });
  return valor;
}

// ---------------------------------------------------------------- ficha del país

export type CifrasPais = {
  pruebas: number;
  resultados: number;
  tiradores: number;
  oros: number;
  platas: number;
  bronces: number;
  finales: number;
  mejor: number | null;
};

/** Sin tiradores: las personas distintas de una temporada con todos los filtros no se guardan. */
export type TemporadaPais = Omit<CifrasPais, 'tiradores'> & { temporada: string };

export type PodioPais = {
  resultadoId: string;
  fecha: string | null;
  puesto: 1 | 2 | 3;
  torneo: string;
  fuente: string;
  edicionId: string;
  pruebaId: string;
  arma: string;
  genero: string;
  categoria: string;
  modalidad: 'I' | 'E';
  /** La persona (la que prevalece); `null` en equipos. */
  persona: { id: string; nombre: string } | null;
};

export type RivalPais = {
  codigo: string;
  asaltos: number;
  victorias: number;
  derrotas: number;
  encuentros: number;
  ganados: number;
  perdidos: number;
};

export type FichaPais = {
  codigo: string;
  total: CifrasPais | null;
  /** Más antigua primero. */
  temporadas: TemporadaPais[];
  /** Categorías con pruebas con los demás filtros puestos (para el filtro). */
  categorias: string[];
  podios: PodioPais[];
  /** Los rivales con más cruces primero. */
  rivales: RivalPais[];
};

const MAX_PODIOS = 8;
const MAX_RIVALES = 200;
const CATEGORIAS_FILTRO: readonly string[] = CATEGORIAS_PAIS;

type FilaResumen = {
  categoria: string; temporada: string; pruebas: number; resultados: number;
  oros: number; platas: number; bronces: number; finales: number; mejor: number | null;
};

/**
 * Las filas finas del país con su arma, género y modalidad, sumadas por
 * categoría y temporada: la categoría se filtra al leerlas, así que de la
 * misma lectura salen también las categorías que ofrece el filtro.
 */
export function sqlResumenPais(codigo: string, f: FiltrosPais): SQL {
  const c: SQL[] = [sql`pais = ${codigo}`];
  if (f.arma) c.push(sql`arma = ${f.arma}`);
  if (f.genero) c.push(sql`genero = ${f.genero}`);
  const mod = modalidadAgregado(f.modalidad);
  if (mod) c.push(sql`modalidad = ${mod}`);
  return sql`SELECT categoria, temporada, sum(pruebas) AS pruebas, sum(resultados) AS resultados, sum(oros) AS oros,
      sum(platas) AS platas, sum(bronces) AS bronces, sum(finales) AS finales, min(mejor) AS mejor
    FROM explorar_pais_resumen WHERE ${sql.join(c, sql` AND `)}
    GROUP BY categoria, temporada`;
}

/** Personas distintas con resultados individuales con esos filtros (una fila). */
export function sqlTiradoresPais(codigo: string, f: FiltrosPais): SQL {
  return sql`SELECT tiradores FROM explorar_pais_tiradores
    WHERE pais = ${codigo} AND arma = ${f.arma} AND genero = ${f.genero} AND categoria = ${f.categoria}`;
}

export function aResumen(rows: readonly FilaResumen[], categoria: string, tiradores: number): Pick<FichaPais, 'total' | 'temporadas' | 'categorias'> {
  const categorias = new Set<string>();
  const porTemporada = new Map<string, TemporadaPais>();
  for (const r of rows) {
    if (CATEGORIAS_FILTRO.includes(r.categoria) && n(r.pruebas) > 0) categorias.add(r.categoria);
    if (categoria && r.categoria !== categoria) continue;
    const t = porTemporada.get(r.temporada)
      ?? { temporada: r.temporada, pruebas: 0, resultados: 0, oros: 0, platas: 0, bronces: 0, finales: 0, mejor: null };
    t.pruebas += n(r.pruebas);
    t.resultados += n(r.resultados);
    t.oros += n(r.oros);
    t.platas += n(r.platas);
    t.bronces += n(r.bronces);
    t.finales += n(r.finales);
    const mejor = nn(r.mejor);
    if (mejor !== null && (t.mejor === null || mejor < t.mejor)) t.mejor = mejor;
    porTemporada.set(r.temporada, t);
  }
  const temporadas = [...porTemporada.values()].sort((a, b) => a.temporada.localeCompare(b.temporada));
  const total = temporadas.length === 0 ? null : temporadas.reduce<CifrasPais>((s, t) => ({
    pruebas: s.pruebas + t.pruebas,
    resultados: s.resultados + t.resultados,
    tiradores,
    oros: s.oros + t.oros,
    platas: s.platas + t.platas,
    bronces: s.bronces + t.bronces,
    finales: s.finales + t.finales,
    mejor: t.mejor === null ? s.mejor : s.mejor === null ? t.mejor : Math.min(s.mejor, t.mejor),
  }), { pruebas: 0, resultados: 0, tiradores, oros: 0, platas: 0, bronces: 0, finales: 0, mejor: null });
  return {
    total,
    temporadas,
    categorias: [...categorias].sort((a, b) => CATEGORIAS_FILTRO.indexOf(a) - CATEGORIAS_FILTRO.indexOf(b)),
  };
}
function filtrosMedalla(f: FiltrosPais): SQL[] {
  const c: SQL[] = [];
  if (f.arma) c.push(sql`m.arma = ${f.arma}`);
  if (f.genero) c.push(sql`m.genero = ${f.genero}`);
  if (f.categoria) c.push(sql`m.categoria = ${f.categoria}`);
  const mod = modalidadAgregado(f.modalidad);
  if (mod) c.push(sql`m.modalidad = ${mod}`);
  return c;
}

export function sqlPodiosPais(codigo: string, f: FiltrosPais, limite = MAX_PODIOS): SQL {
  const extra = filtrosMedalla(f);
  return sql`SELECT m.resultado_id AS "resultadoId", nullif(m.fecha, '') AS fecha, m.puesto, m.arma, m.genero, m.categoria,
      m.modalidad, m.competition_id AS "pruebaId", e.id AS "edicionId", e.name AS torneo, c.source AS fuente,
      p.id AS "personaId", p.display_name AS nombre
    FROM explorar_pais_medalla m
    CROSS JOIN sport_competition c ON c.id = m.competition_id
    CROSS JOIN sport_edition e ON e.id = c.edition_id
    LEFT JOIN sport_person p ON p.id = m.persona_id
    WHERE m.pais = ${codigo}${extra.length ? sql` AND ${sql.join(extra, sql` AND `)}` : sql``}
    ORDER BY m.fecha DESC, m.puesto, m.resultado_id
    LIMIT ${limite}`;
}

export function sqlRivalesPais(codigo: string): SQL {
  return sql`SELECT pais_b AS codigo, asaltos, victorias, derrotas, encuentros, ganados, perdidos
    FROM explorar_pais_rival WHERE pais_a = ${codigo}
    ORDER BY asaltos + encuentros DESC, pais_b
    LIMIT ${MAX_RIVALES}`;
}

type FilaPodio = Omit<PodioPais, 'persona' | 'puesto' | 'modalidad'> & {
  puesto: number;
  modalidad: string;
  personaId: string | null;
  nombre: string | null;
};

export function aPodio(f: FilaPodio): PodioPais {
  return {
    resultadoId: f.resultadoId,
    fecha: f.fecha ?? null,
    puesto: (Number(f.puesto) as 1 | 2 | 3),
    torneo: f.torneo,
    fuente: f.fuente,
    edicionId: f.edicionId,
    pruebaId: f.pruebaId,
    arma: f.arma,
    genero: f.genero,
    categoria: f.categoria,
    modalidad: f.modalidad === 'E' ? 'E' : 'I',
    persona: f.personaId ? { id: f.personaId, nombre: f.nombre ?? '' } : null,
  };
}

export async function leerFichaPais(db: Db, codigo: string, f: FiltrosPais): Promise<FichaPais> {
  const sinPersonas = f.modalidad === 'equipos';
  const [resumen, tiradores, podios, rivales] = await Promise.all([
    db.execute(sqlResumenPais(codigo, f)),
    sinPersonas ? Promise.resolve(null) : db.execute(sqlTiradoresPais(codigo, f)),
    db.execute(sqlPodiosPais(codigo, f)),
    db.execute(sqlRivalesPais(codigo)),
  ]);
  const personas = tiradores ? n(filas<{ tiradores: number }>(tiradores)[0]?.tiradores) : 0;
  return {
    codigo,
    ...aResumen(filas<FilaResumen>(resumen), f.categoria, personas),
    podios: filas<FilaPodio>(podios).map(aPodio),
    rivales: filas<Record<string, unknown>>(rivales).map((r) => ({
      codigo: String(r.codigo),
      asaltos: n(r.asaltos),
      victorias: n(r.victorias),
      derrotas: n(r.derrotas),
      encuentros: n(r.encuentros),
      ganados: n(r.ganados),
      perdidos: n(r.perdidos),
    })),
  };
}
// ---------------------------------------------------------------- cara a cara de selecciones

export type BalanceDuelo = {
  pruebas: number;
  asaltos: number;
  victorias: number;
  derrotas: number;
  tocadosFavor: number;
  tocadosContra: number;
};

export type TemporadaDuelo = {
  temporada: string;
  individual: { victorias: number; derrotas: number };
  equipos: { victorias: number; derrotas: number };
};

export type LadoCruce = {
  /** La persona que prevalece; `null` si la fuente no la identificó. */
  personaId: string | null;
  nombre: string;
};

export type RelevoDuelo = {
  numero: number;
  nuestro: LadoCruce | null;
  suyo: LadoCruce | null;
  tocadosNuestros: number;
  tocadosSuyos: number;
  /** Marcador del encuentro al acabar el relevo. */
  marcadorNuestro: number;
  marcadorSuyo: number;
};

export type CruceDuelo = {
  id: string;
  fase: 'POULE' | 'TABLEAU';
  ronda: string | null;
  nuestro: LadoCruce;
  suyo: LadoCruce;
  tocadosNuestros: number;
  tocadosSuyos: number;
  /** Sólo en equipos y si la fuente publica los relevos. */
  relevos: RelevoDuelo[] | null;
};

export type PruebaDuelo = {
  pruebaId: string;
  edicionId: string;
  torneo: string;
  fuente: string;
  fecha: string | null;
  arma: string;
  genero: string;
  categoria: string;
  modalidad: 'I' | 'E';
  temporada: string;
  asaltos: number;
  victorias: number;
  derrotas: number;
  cruces: CruceDuelo[];
};

export type DueloPaises = {
  codigo: string;
  rival: string;
  individual: BalanceDuelo;
  equipos: BalanceDuelo;
  /** Más antigua primero; sin el filtro de temporada. */
  temporadas: TemporadaDuelo[];
  /** Categorías con cruces con los demás filtros (para el filtro). */
  categorias: string[];
  pruebas: PruebaDuelo[];
  /** Cursor de la página siguiente (`fecha~prueba`), o `null`. */
  siguiente: string | null;
};

export const PRUEBAS_POR_PAGINA = 10;

const BALANCE_VACIO: BalanceDuelo = { pruebas: 0, asaltos: 0, victorias: 0, derrotas: 0, tocadosFavor: 0, tocadosContra: 0 };

/**
 * Balance de la pareja: la suma de sus filas por prueba, por modalidad,
 * categoría y temporada, ya orientada desde `codigo`. Sin la categoría: las
 * demás categorías con cruces salen de las mismas filas (para el filtro). Con
 * arma, el índice de filtros lee sólo las filas de esa arma.
 */
export function sqlDuelo(codigo: string, rival: string, f: FiltrosDuelo): SQL {
  const { a, b, invertida } = parejaOrdenada(codigo, rival);
  const c: SQL[] = [sql`pais_a = ${a}`, sql`pais_b = ${b}`];
  const mod = modalidadAgregado(f.modalidad);
  if (mod) c.push(sql`modalidad = ${mod}`);
  if (f.arma) c.push(sql`arma = ${f.arma}`);
  if (f.genero) c.push(sql`genero = ${f.genero}`);
  const [nuestro, suyo] = invertida ? ['b', 'a'] : ['a', 'b'];
  const indice = f.arma ? sql.raw('INDEXED BY explorar_pais_prueba_filtro_idx') : sql.raw('');
  return sql`SELECT modalidad, categoria, temporada, count(*) AS pruebas, sum(asaltos) AS asaltos,
      ${sql.raw(`sum(victorias_${nuestro}) AS victorias, sum(victorias_${suyo}) AS derrotas, sum(tocados_${nuestro}) AS favor, sum(tocados_${suyo}) AS contra`)}
    FROM explorar_pais_prueba ${indice} WHERE ${sql.join(c, sql` AND `)}
    GROUP BY modalidad, categoria, temporada`;
}
/** Las filas de la pareja se guardan una vez, con el país menor en `pais_a`. */
export function parejaOrdenada(codigo: string, rival: string): { a: string; b: string; invertida: boolean } {
  return codigo < rival ? { a: codigo, b: rival, invertida: false } : { a: rival, b: codigo, invertida: true };
}

export function sqlPruebasDuelo(codigo: string, rival: string, f: FiltrosDuelo, desde: string): SQL {
  const { a, b } = parejaOrdenada(codigo, rival);
  const c: SQL[] = [sql`x.pais_a = ${a}`, sql`x.pais_b = ${b}`];
  const mod = modalidadAgregado(f.modalidad);
  if (mod) c.push(sql`x.modalidad = ${mod}`);
  if (f.arma) c.push(sql`x.arma = ${f.arma}`);
  if (f.genero) c.push(sql`x.genero = ${f.genero}`);
  if (f.categoria) c.push(sql`x.categoria = ${f.categoria}`);
  if (f.temporada) c.push(sql`x.temporada = ${f.temporada}`);
  if (desde) {
    const [fecha, prueba] = desde.split('~');
    c.push(sql`(x.fecha, x.competition_id) < (${fecha}, ${prueba})`);
  }
  // Con arma, género y categoría el índice de filtros da la página en orden; si
  // falta alguno, la clave por fecha llega antes a las filas que cumplen. Sin
  // estadísticas (D1 no tiene sqlite_stat1) SQLite no sabe elegir solo.
  const indice = f.arma && f.genero && f.categoria ? sql.raw('INDEXED BY explorar_pais_prueba_filtro_idx') : sql.raw('');
  return sql`SELECT x.competition_id AS "pruebaId", x.fecha, x.arma, x.genero, x.categoria, x.modalidad, x.temporada,
      x.asaltos, x.victorias_a AS va, x.victorias_b AS vb, x.asaltos_ids AS ids,
      e.id AS "edicionId", e.name AS torneo, c.source AS fuente
    FROM explorar_pais_prueba x ${indice}
    CROSS JOIN sport_competition c ON c.id = x.competition_id
    CROSS JOIN sport_edition e ON e.id = c.edition_id
    WHERE ${sql.join(c, sql` AND `)}
    ORDER BY x.fecha DESC, x.competition_id DESC
    LIMIT ${PRUEBAS_POR_PAGINA + 1}`;
}

/**
 * Los asaltos de la página, por id, con la persona que prevalece de cada lado
 * y su nombre (el de la ficha o, si la fuente no la identificó, el publicado).
 * El lado de cada país ya viene en la lista de ids (`~`): no se vuelve a buscar.
 */
export function sqlCrucesDuelo(ids: readonly string[]): SQL {
  const lado = (l: 'a' | 'b') => sql.raw(`coalesce(q${l}.id, p${l}.id) AS persona_${l},
      coalesce(q${l}.display_name, p${l}.display_name, b.fencer_${l}_name) AS nombre_${l}`);
  return sql`SELECT b.id, b.competition_id AS prueba, b.phase AS fase, b.round_key AS ronda, b.score_a, b.score_b,
      b.fencer_a_ref AS ref_a, b.fencer_b_ref AS ref_b, ${lado('a')}, ${lado('b')}
    FROM json_each(${JSON.stringify(ids)}) j
    CROSS JOIN sport_bout b ON b.id = j.value
    LEFT JOIN sport_person pa ON pa.id = b.fencer_a_person_id
    LEFT JOIN sport_person qa ON qa.id = pa.merged_into_person_id
    LEFT JOIN sport_person pb ON pb.id = b.fencer_b_person_id
    LEFT JOIN sport_person qb ON qb.id = pb.merged_into_person_id`;
}
/**
 * Relevos de los encuentros por equipos de la página (0010, sólo Engarde los
 * publica). El encuentro se reconoce por la prueba, la ronda y las filas de
 * equipo de los dos lados.
 */
export function sqlRelevosDuelo(pruebas: readonly string[], refs: readonly string[]): SQL {
  return sql`SELECT m.competition_id AS prueba, m.round_key AS ronda, m.team_a_ref AS ref_a, m.team_b_ref AS ref_b,
      rl.relay_number AS numero, rl.touches_a AS ta, rl.touches_b AS tb, rl.after_a AS da, rl.after_b AS db,
      coalesce(qa.id, pa.id) AS persona_a, coalesce(qa.display_name, pa.display_name, rl.fencer_a_name) AS nombre_a,
      coalesce(qb.id, pb.id) AS persona_b, coalesce(qb.display_name, pb.display_name, rl.fencer_b_name) AS nombre_b
    FROM json_each(${JSON.stringify(pruebas)}) j
    CROSS JOIN sport_team_match m ON m.competition_id = j.value
    CROSS JOIN sport_relay rl ON rl.match_id = m.id
    LEFT JOIN sport_person pa ON pa.id = rl.fencer_a_person_id
    LEFT JOIN sport_person qa ON qa.id = pa.merged_into_person_id
    LEFT JOIN sport_person pb ON pb.id = rl.fencer_b_person_id
    LEFT JOIN sport_person qb ON qb.id = pb.merged_into_person_id
    WHERE m.team_a_ref IN (SELECT value FROM json_each(${JSON.stringify(refs)}))
      AND m.team_b_ref IN (SELECT value FROM json_each(${JSON.stringify(refs)}))
    ORDER BY m.id, rl.relay_number`;
}

type FilaCruce = {
  id: string; prueba: string; fase: string; ronda: string | null; score_a: number; score_b: number;
  ref_a: string; ref_b: string;
  persona_a: string | null; nombre_a: string | null;
  persona_b: string | null; nombre_b: string | null;
};

type FilaRelevo = {
  prueba: string; ronda: string | null; ref_a: string; ref_b: string; numero: number;
  ta: number; tb: number; da: number; db: number;
  persona_a: string | null; nombre_a: string | null; persona_b: string | null; nombre_b: string | null;
};

const lado = (persona: string | null, nombre: string | null): LadoCruce => ({ personaId: persona ?? null, nombre: nombre ?? '' });

function aRelevos(filasRelevo: readonly FilaRelevo[], cruce: FilaCruce, nuestroEsA: boolean): RelevoDuelo[] | null {
  const propios = filasRelevo.filter((r) => r.prueba === cruce.prueba && (r.ronda ?? null) === (cruce.ronda ?? null)
    && ((r.ref_a === cruce.ref_a && r.ref_b === cruce.ref_b) || (r.ref_a === cruce.ref_b && r.ref_b === cruce.ref_a)));
  if (propios.length === 0) return null;
  return propios.map((r) => {
    // El encuentro puede estar guardado con los equipos al revés que el asalto.
    const relevoNuestroEsA = (r.ref_a === cruce.ref_a) === nuestroEsA;
    const a = lado(r.persona_a, r.nombre_a);
    const b = lado(r.persona_b, r.nombre_b);
    return {
      numero: n(r.numero),
      nuestro: relevoNuestroEsA ? a : b,
      suyo: relevoNuestroEsA ? b : a,
      tocadosNuestros: n(relevoNuestroEsA ? r.ta : r.tb),
      tocadosSuyos: n(relevoNuestroEsA ? r.tb : r.ta),
      marcadorNuestro: n(relevoNuestroEsA ? r.da : r.db),
      marcadorSuyo: n(relevoNuestroEsA ? r.db : r.da),
    };
  });
}

const ORDEN_FASE: Record<string, number> = { TABLEAU: 0, POULE: 1 };

/** Ronda de cuadro → número de tiradores (A8 → 8): las finales primero. */
const ordenRonda = (ronda: string | null) => rondaCuadro(ronda ?? '').tamano ?? 9999;

/** `nuestroEsA`: id del asalto → ¿el lado A es el país de la ruta? Lo que no está, no es de la pareja. */
export function aCruces(rows: readonly FilaCruce[], relevos: readonly FilaRelevo[], nuestroEsADe: ReadonlyMap<string, boolean>): Map<string, CruceDuelo[]> {
  const porPrueba = new Map<string, CruceDuelo[]>();
  for (const r of rows) {
    const nuestroEsA = nuestroEsADe.get(r.id);
    if (nuestroEsA === undefined) continue;
    const a = lado(r.persona_a, r.nombre_a);
    const b = lado(r.persona_b, r.nombre_b);
    const cruce: CruceDuelo = {
      id: r.id,
      fase: r.fase === 'POULE' ? 'POULE' : 'TABLEAU',
      ronda: r.ronda ?? null,
      nuestro: nuestroEsA ? a : b,
      suyo: nuestroEsA ? b : a,
      tocadosNuestros: n(nuestroEsA ? r.score_a : r.score_b),
      tocadosSuyos: n(nuestroEsA ? r.score_b : r.score_a),
      relevos: relevos.length ? aRelevos(relevos, r, nuestroEsA) : null,
    };
    const lista = porPrueba.get(r.prueba) ?? [];
    lista.push(cruce);
    porPrueba.set(r.prueba, lista);
  }
  for (const lista of porPrueba.values()) {
    lista.sort((x, y) => ORDEN_FASE[x.fase] - ORDEN_FASE[y.fase] || ordenRonda(x.ronda) - ordenRonda(y.ronda)
      || x.nuestro.nombre.localeCompare(y.nuestro.nombre, 'es') || x.id.localeCompare(y.id));
  }
  return porPrueba;
}

type FilaDuelo = {
  modalidad: string; categoria: string; temporada: string;
  pruebas: number; asaltos: number; victorias: number; derrotas: number; favor: number; contra: number;
};

export function aBalances(
  rows: readonly FilaDuelo[],
  { temporada, categoria }: { temporada: string; categoria: string },
): Pick<DueloPaises, 'individual' | 'equipos' | 'temporadas' | 'categorias'> {
  const individual = { ...BALANCE_VACIO };
  const equipos = { ...BALANCE_VACIO };
  const porTemporada = new Map<string, TemporadaDuelo>();
  const categorias = new Set<string>();
  for (const r of rows) {
    if (CATEGORIAS_FILTRO.includes(r.categoria)) categorias.add(r.categoria);
    if (categoria && r.categoria !== categoria) continue;
    const t = porTemporada.get(r.temporada) ?? {
      temporada: r.temporada, individual: { victorias: 0, derrotas: 0 }, equipos: { victorias: 0, derrotas: 0 },
    };
    const lado = r.modalidad === 'E' ? t.equipos : t.individual;
    lado.victorias += n(r.victorias);
    lado.derrotas += n(r.derrotas);
    porTemporada.set(r.temporada, t);
    if (temporada && r.temporada !== temporada) continue;
    const b = r.modalidad === 'E' ? equipos : individual;
    b.pruebas += n(r.pruebas);
    b.asaltos += n(r.asaltos);
    b.victorias += n(r.victorias);
    b.derrotas += n(r.derrotas);
    b.tocadosFavor += n(r.favor);
    b.tocadosContra += n(r.contra);
  }
  return {
    individual,
    equipos,
    temporadas: [...porTemporada.values()].sort((a, b) => a.temporada.localeCompare(b.temporada)),
    categorias: [...categorias].sort((a, b) => CATEGORIAS_FILTRO.indexOf(a) - CATEGORIAS_FILTRO.indexOf(b)),
  };
}

type FilaPruebaDuelo = {
  pruebaId: string; fecha: string; arma: string; genero: string; categoria: string; modalidad: string; temporada: string;
  asaltos: number; va: number; vb: number; ids: string; edicionId: string; torneo: string; fuente: string;
};

function idsDe(texto: string): string[] {
  try {
    const v: unknown = JSON.parse(texto);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function leerDueloPaises(db: Db, codigo: string, rival: string, f: FiltrosDuelo, desde = ''): Promise<DueloPaises> {
  const { invertida } = parejaOrdenada(codigo, rival);
  const [duelo, pagina] = await Promise.all([
    desde ? Promise.resolve(null) : db.execute(sqlDuelo(codigo, rival, f)),
    db.execute(sqlPruebasDuelo(codigo, rival, f, desde)),
  ]);
  const filasPagina = filas<FilaPruebaDuelo>(pagina);
  const visibles = filasPagina.slice(0, PRUEBAS_POR_PAGINA);
  // `~id`: el lado A del asalto es el país mayor de la pareja.
  const nuestroEsADe = new Map(visibles.flatMap((p) => idsDe(p.ids)).map((crudo) => {
    const alReves = crudo.startsWith('~');
    return [alReves ? crudo.slice(1) : crudo, alReves === invertida] as const;
  }));
  const ids = [...nuestroEsADe.keys()];
  const cruces = ids.length ? filas<FilaCruce>(await db.execute(sqlCrucesDuelo(ids))) : [];

  const equipos = cruces.filter((c) => visibles.find((p) => p.pruebaId === c.prueba)?.modalidad === 'E');
  let relevos: FilaRelevo[] = [];
  if (equipos.length) {
    try {
      relevos = filas<FilaRelevo>(await db.execute(sqlRelevosDuelo(
        [...new Set(equipos.map((c) => c.prueba))],
        [...new Set(equipos.flatMap((c) => [c.ref_a, c.ref_b]))],
      )));
    } catch (error) {
      // Sin la 0010 no hay relevos: el encuentro se enseña con su marcador.
      if (!/no such table: sport_(relay|team_match)/.test(error instanceof Error ? error.message : '')) throw error;
    }
  }
  const porPrueba = aCruces(cruces, relevos, nuestroEsADe);
  const ultima = filasPagina.length > PRUEBAS_POR_PAGINA ? visibles[visibles.length - 1] : null;
  const balances = duelo ? aBalances(filas<FilaDuelo>(duelo), f)
    : { individual: { ...BALANCE_VACIO }, equipos: { ...BALANCE_VACIO }, temporadas: [], categorias: [] };
  return {
    codigo,
    rival,
    ...balances,
    pruebas: visibles.map((p) => ({
      pruebaId: p.pruebaId,
      edicionId: p.edicionId,
      torneo: p.torneo,
      fuente: p.fuente,
      fecha: p.fecha || null,
      arma: p.arma,
      genero: p.genero,
      categoria: p.categoria,
      modalidad: p.modalidad === 'E' ? 'E' : 'I',
      temporada: p.temporada,
      asaltos: n(p.asaltos),
      victorias: n(invertida ? p.vb : p.va),
      derrotas: n(invertida ? p.va : p.vb),
      cruces: porPrueba.get(p.pruebaId) ?? [],
    })),
    siguiente: ultima ? `${ultima.fecha}~${ultima.pruebaId}` : null,
  };
}
