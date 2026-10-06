import { sql } from 'drizzle-orm';
import { filas, type ContextoExplorador } from './contexto';
import { listaUuid } from './filtros-sql';
import type {
  AsaltoDePrueba,
  AsaltosDePrueba,
  FilaPoule,
  PouleDePrueba,
  RondaCuadro,
} from './tipos-busqueda';

/**
 * Poules y cuadro de una prueba a partir de `sport_bout`. Todo sale de los
 * asaltos importados de UNA fuente (la que más tiene), igual que la
 * clasificación: dos lecturas de la misma prueba no se mezclan. Las cifras de
 * la matriz (victorias, tocados, índice) se calculan con esos asaltos y nada
 * más; si la lectura es parcial, también lo son.
 */

/** Una prueba de 300 tiradores ronda los 1.500 asaltos; por encima se corta y se avisa. */
export const MAX_ASALTOS_PRUEBA = 2000;

/**
 * `paisesDe` son las pruebas cuyos puestos dan el país de cada tirador: en una
 * prueba publicada por partes, el PDF de poules no trae la clasificación.
 */
export function sqlAsaltosDePrueba(pruebaId: string, paisesDe: readonly string[] = [pruebaId]) {
  const paises =
    paisesDe.length === 1 && paisesDe[0] === pruebaId
      ? sql`pr.competition_id = ${pruebaId}`
      : sql`pr.competition_id IN (${listaUuid(paisesDe)})`;
  return sql`
    WITH fuente AS (
      SELECT b.source AS fuente FROM sport_bout b
      WHERE b.competition_id = ${pruebaId}
      GROUP BY b.source ORDER BY count(*) DESC, b.source LIMIT 1
    ),
    paises AS (
      SELECT pr.person_id AS persona, max(pr.source_country_code) AS pais
      FROM sport_result pr
      WHERE ${paises} AND pr.person_id IS NOT NULL
      GROUP BY pr.person_id
    )
    SELECT b.id AS id, b.source AS fuente, b.phase AS fase, b.round_key AS ronda,
           b.fencer_a_ref AS "refA", b.fencer_b_ref AS "refB",
           b.fencer_a_person_id AS "personaA", b.fencer_b_person_id AS "personaB",
           b.fencer_a_name AS "nombreA", b.fencer_b_name AS "nombreB",
           b.score_a AS "tantosA", b.score_b AS "tantosB",
           pa.pais AS "paisA", pb.pais AS "paisB"
    FROM sport_bout b
    LEFT JOIN paises pa ON pa.persona = b.fencer_a_person_id
    LEFT JOIN paises pb ON pb.persona = b.fencer_b_person_id
    -- Subconsulta escalar, no JOIN: unida, SQLite recalculaba la fuente por cada asalto.
    WHERE b.competition_id = ${pruebaId} AND b.source = (SELECT fuente FROM fuente)
    ORDER BY b.phase, b.round_key, b.id
    LIMIT ${MAX_ASALTOS_PRUEBA + 1}`;
}

export type FilaAsaltoPrueba = {
  id: string;
  fuente: string;
  fase: string;
  ronda: string;
  refA: string;
  refB: string;
  personaA: string | null;
  personaB: string | null;
  nombreA: string;
  nombreB: string;
  tantosA: number;
  tantosB: number;
  paisA: string | null;
  paisB: string | null;
};

/* --------------------------------------------------------------- rondas */

export function etiquetaTamano(n: number): string {
  if (n === 2) return 'Final';
  if (n === 4) return 'Semifinales';
  if (n === 8) return 'Cuartos de final';
  return `Tabla de ${n}`;
}

/**
 * Lo que dice una clave de ronda del cuadro. Las fuentes publican `A64…A2`
 * (FIE y PDF), `T32…T8`, `SF` y `F` (complementarias) y `C2` para el tercer
 * puesto. Una clave que no se reconoce se enseña tal cual, sin tamaño.
 */
export function rondaCuadro(clave: string): { tamano: number | null; etiqueta: string } {
  const k = clave.trim().toUpperCase();
  // La FIE publica `A…` para el cuadro previo y `B…` para el principal cuando
  // la prueba tiene los dos (Copas del Mundo): `B64` es la tabla de 64 de verdad.
  const tabla = /^[ABT](\d{1,3})$/.exec(k);
  if (tabla) {
    const n = Number(tabla[1]);
    return { tamano: n, etiqueta: etiquetaTamano(n) };
  }
  if (k === 'F') return { tamano: 2, etiqueta: 'Final' };
  if (k === 'SF') return { tamano: 4, etiqueta: 'Semifinales' };
  if (k === 'QF' || k === 'CF') return { tamano: 8, etiqueta: 'Cuartos de final' };
  if (k === 'C2') return { tamano: null, etiqueta: 'Tercer puesto' };
  return { tamano: null, etiqueta: `Ronda ${clave}` };
}

/** Rótulo corto de una ronda del cuadro, para la cabecera de cada columna. */
export function etiquetaCortaRonda(r: { tamano: number | null; etiqueta: string }): string {
  if (r.etiqueta.startsWith('Previa')) return r.etiqueta;
  switch (r.tamano) {
    case 2:
      return 'Final';
    case 4:
      return 'Semifinal';
    case 8:
      return 'Cuartos';
    case 16:
      return 'Octavos';
    default:
      return r.etiqueta;
  }
}

/** Clave de ronda publicada en palabras, para listas de asaltos sueltos. */
export function etiquetaRonda(fase: string, clave: string): string {
  if (fase === 'POULE') return poule(clave).etiqueta;
  return rondaCuadro(clave).etiqueta;
}

function poule(clave: string): { vuelta: number; numero: number; etiqueta: string } {
  const m = /^(?:[VR](\d+))?P(\d+)$/i.exec(clave.trim());
  if (!m) return { vuelta: 99, numero: 0, etiqueta: `Poule ${clave}` };
  const vuelta = m[1] ? Number(m[1]) : 1;
  const numero = Number(m[2]);
  return {
    vuelta,
    numero,
    etiqueta: vuelta > 1 ? `Vuelta ${vuelta}, poule ${numero}` : `Poule ${numero}`,
  };
}

/* ---------------------------------------------------------------- modelo */

type Lado = 'A' | 'B';

function tirador(f: FilaAsaltoPrueba, lado: Lado) {
  return lado === 'A'
    ? { ref: f.refA, personaId: f.personaA, nombre: f.nombreA, pais: f.paisA, tantos: Number(f.tantosA) }
    : { ref: f.refB, personaId: f.personaB, nombre: f.nombreB, pais: f.paisB, tantos: Number(f.tantosB) };
}

/** Sin las referencias de la fuente: sólo sirven para emparejar dentro del servidor. */
function aAsalto(f: FilaAsaltoPrueba): AsaltoDePrueba {
  return {
    id: f.id,
    ronda: f.ronda,
    a: { personaId: f.personaA, nombre: f.nombreA, pais: f.paisA, tantos: Number(f.tantosA) },
    b: { personaId: f.personaB, nombre: f.nombreB, pais: f.paisB, tantos: Number(f.tantosB) },
  };
}

function ganador(f: FilaAsaltoPrueba): string | null {
  const a = Number(f.tantosA);
  const b = Number(f.tantosB);
  if (a === b) return null;
  return a > b ? f.refA : f.refB;
}

function esPrincipalFie(ronda: string): boolean {
  return /^B\d{1,3}$/i.test(ronda.trim());
}

/**
 * Ordena cada ronda del cuadro como se dibuja: empezando por la final, los
 * dos asaltos de la ronda anterior que ganaron sus finalistas van en ese
 * orden, y así hacia atrás. Lo que no encaja (un cuadro incompleto) va al
 * final de su ronda, sin inventar emparejamientos.
 */
export function ordenarCuadro(rows: readonly FilaAsaltoPrueba[]): RondaCuadro[] {
  const porRonda = new Map<string, FilaAsaltoPrueba[]>();
  for (const f of rows) {
    const lista = porRonda.get(f.ronda) ?? [];
    lista.push(f);
    porRonda.set(f.ronda, lista);
  }
  // Con cuadro principal (`B…`), el previo (`A…`) va antes que él: la cadena
  // desde la final es B2 … B64, A64 … A256.
  const conPrincipal = [...porRonda.keys()].some(esPrincipalFie);
  const tramo = (ronda: string) => (conPrincipal && esPrincipalFie(ronda) ? 1 : 0);
  const conTamano = [...porRonda.keys()]
    .map((ronda) => {
      const r = rondaCuadro(ronda);
      const previa = conPrincipal && !esPrincipalFie(ronda) && r.tamano !== null;
      return { ronda, tamano: r.tamano, etiqueta: previa ? `Previa · ${r.etiqueta}` : r.etiqueta };
    })
    .filter((r): r is { ronda: string; tamano: number; etiqueta: string } => r.tamano !== null)
    .sort((x, y) => tramo(y.ronda) - tramo(x.ronda) || x.tamano - y.tamano);

  const ordenadas = new Map<string, FilaAsaltoPrueba[]>();
  let siguiente: FilaAsaltoPrueba[] | null = null;
  for (const r of conTamano) {
    const propios = porRonda.get(r.ronda) ?? [];
    if (!siguiente) {
      ordenadas.set(r.ronda, propios);
    } else {
      const usados = new Set<string>();
      const orden: FilaAsaltoPrueba[] = [];
      for (const s of siguiente) {
        for (const ref of [s.refA, s.refB]) {
          const previo = propios.find((p) => !usados.has(p.id) && ganador(p) === ref);
          if (previo) {
            usados.add(previo.id);
            orden.push(previo);
          }
        }
      }
      orden.push(...propios.filter((p) => !usados.has(p.id)));
      ordenadas.set(r.ronda, orden);
    }
    siguiente = ordenadas.get(r.ronda) ?? [];
  }

  const rondas: RondaCuadro[] = [...conTamano]
    .reverse()
    .map((r) => ({
      ronda: r.ronda,
      etiqueta: r.etiqueta,
      tamano: r.tamano,
      asaltos: (ordenadas.get(r.ronda) ?? []).map(aAsalto),
    }));
  // Tercer puesto y claves desconocidas, después de la final y en orden estable.
  const otras = [...porRonda.keys()]
    .filter((ronda) => rondaCuadro(ronda).tamano === null)
    .sort();
  for (const ronda of otras) {
    rondas.push({
      ronda,
      etiqueta: rondaCuadro(ronda).etiqueta,
      tamano: null,
      asaltos: (porRonda.get(ronda) ?? []).map(aAsalto),
    });
  }
  return rondas;
}

/** Matriz de cada poule, con victorias, tocados e índice calculados de los asaltos importados. */
export function matricesPoule(rows: readonly FilaAsaltoPrueba[]): PouleDePrueba[] {
  const porRonda = new Map<string, FilaAsaltoPrueba[]>();
  for (const f of rows) {
    const lista = porRonda.get(f.ronda) ?? [];
    lista.push(f);
    porRonda.set(f.ronda, lista);
  }
  const poules = [...porRonda.entries()].map(([ronda, asaltos]) => {
    const tiradores = new Map<string, Omit<FilaPoule, 'celdas' | 'clave'> & { ref: string }>();
    const marcador = new Map<string, { tantos: number; victoria: boolean }>();
    for (const f of asaltos) {
      const gana = ganador(f);
      for (const lado of ['A', 'B'] as const) {
        const t = tirador(f, lado);
        const rival = tirador(f, lado === 'A' ? 'B' : 'A');
        const fila = tiradores.get(t.ref) ?? {
          ref: t.ref, personaId: t.personaId, nombre: t.nombre, pais: t.pais,
          victorias: 0, asaltos: 0, tocados: 0, recibidos: 0,
        };
        fila.asaltos += 1;
        fila.tocados += t.tantos;
        fila.recibidos += rival.tantos;
        if (gana === t.ref) fila.victorias += 1;
        tiradores.set(t.ref, fila);
        marcador.set(`${t.ref}|${rival.ref}`, { tantos: t.tantos, victoria: gana === t.ref });
      }
    }
    const orden = [...tiradores.values()].sort(
      (x, y) =>
        y.victorias / y.asaltos - x.victorias / x.asaltos ||
        y.tocados - y.recibidos - (x.tocados - x.recibidos) ||
        y.tocados - x.tocados ||
        x.nombre.localeCompare(y.nombre, 'es'),
    );
    const filasPoule: FilaPoule[] = orden.map((t, i) => ({
      clave: `${ronda}-${i}`,
      personaId: t.personaId,
      nombre: t.nombre,
      pais: t.pais,
      victorias: t.victorias,
      asaltos: t.asaltos,
      tocados: t.tocados,
      recibidos: t.recibidos,
      celdas: orden.map((o) => (o.ref === t.ref ? null : marcador.get(`${t.ref}|${o.ref}`) ?? null)),
    }));
    const p = poule(ronda);
    return { ronda, etiqueta: p.etiqueta, filas: filasPoule, vuelta: p.vuelta, numero: p.numero };
  });
  return poules
    .sort((x, y) => x.vuelta - y.vuelta || x.numero - y.numero || x.ronda.localeCompare(y.ronda))
    .map(({ ronda, etiqueta, filas: f }) => ({ ronda, etiqueta, filas: f }));
}

/** Asaltos de una prueba ya validada por quien llama (sesión e ID). `null` si no hay ninguno. */
export async function leerAsaltosDePrueba(
  ctx: ContextoExplorador,
  pruebaId: string,
): Promise<AsaltosDePrueba | null> {
  const rows = filas<FilaAsaltoPrueba>(await ctx.db.execute(sqlAsaltosDePrueba(pruebaId)));
  if (rows.length === 0) return null;
  const truncado = rows.length > MAX_ASALTOS_PRUEBA;
  const visibles = rows.slice(0, MAX_ASALTOS_PRUEBA);
  return {
    fuente: visibles[0].fuente,
    poules: matricesPoule(visibles.filter((f) => f.fase === 'POULE')),
    cuadro: ordenarCuadro(visibles.filter((f) => f.fase === 'TABLEAU')),
    truncado,
  };
}

type ConteoFase = { prueba: string; fase: string; n: number };

/**
 * De qué parte de una prueba agrupada sale cada fase: la que más asaltos tiene
 * de esa fase; a igualdad, la primera de `miembros` (la que da los puestos).
 * Dos partes con la misma fase suelen ser copias del mismo PDF: se toma una.
 */
export function partePorFase(miembros: readonly string[], conteos: readonly ConteoFase[]): Map<string, string> {
  const mejor = new Map<string, { prueba: string; n: number }>();
  for (const id of miembros) {
    for (const c of conteos) {
      if (c.prueba !== id) continue;
      const actual = mejor.get(c.fase);
      if (!actual || Number(c.n) > actual.n) mejor.set(c.fase, { prueba: id, n: Number(c.n) });
    }
  }
  return new Map([...mejor].map(([fase, m]) => [fase, m.prueba]));
}

/**
 * Asaltos de una prueba agrupada (ver `agruparPruebas`): poules de la parte
 * con más poules y cuadro de la parte con más cuadro, con los países que dan
 * los puestos de cualquiera de ellas. Con un solo miembro es `leerAsaltosDePrueba`.
 */
export async function leerAsaltosDeGrupo(
  ctx: ContextoExplorador,
  miembros: readonly string[],
): Promise<AsaltosDePrueba | null> {
  if (miembros.length === 0) return null;
  if (miembros.length === 1) return leerAsaltosDePrueba(ctx, miembros[0]);
  const conteos = filas<ConteoFase>(
    await ctx.db.execute(sql`
      SELECT b.competition_id AS prueba, b.phase AS fase, count(*) AS n
      FROM sport_bout b
      WHERE b.competition_id IN (${listaUuid(miembros)})
      GROUP BY b.competition_id, b.phase`),
  );
  const partes = partePorFase(miembros, conteos);
  if (partes.size === 0) return null;
  const porParte = new Map<string, FilaAsaltoPrueba[]>();
  for (const parte of new Set(partes.values())) {
    porParte.set(parte, filas<FilaAsaltoPrueba>(await ctx.db.execute(sqlAsaltosDePrueba(parte, miembros))));
  }
  const de = (fase: string) => {
    const parte = partes.get(fase);
    return parte ? (porParte.get(parte) ?? []).filter((f) => f.fase === fase) : [];
  };
  const poules = de('POULE');
  const cuadro = de('TABLEAU');
  const todas = [...poules, ...cuadro];
  if (todas.length === 0) return null;
  const truncado = [...porParte.values()].some((rows) => rows.length > MAX_ASALTOS_PRUEBA);
  return {
    fuente: todas[0].fuente,
    poules: matricesPoule(poules.slice(0, MAX_ASALTOS_PRUEBA)),
    cuadro: ordenarCuadro(cuadro.slice(0, MAX_ASALTOS_PRUEBA)),
    truncado,
  };
}
