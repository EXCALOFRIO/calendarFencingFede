/**
 * Pruebas conjuntas: una lectura de Engarde (poules y cuadro) de un evento que el PDF de la RFEE
 * o Skermo publican partido en varias clasificaciones (veteranos de dos franjas que tiran juntos,
 * Criterium que se tira mixto o con dos años y se clasifica por sexo y año).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/dedupe-conjuntas.ts --db <copia.sqlite> [--simular] [--informe <json>]
 *
 * Se ejecuta dentro de `unificar-personas.ts`, antes de `depurarSolapesEngarde` y de
 * `fundirDuplicados`, que sin esto meterían todos los asaltos de la conjunta en UNA de las
 * partes (con tiradores que no son de esa clasificación) y trasladarían a esa parte los
 * puestos de los demás.
 *
 * Detección (`detectarConjuntas`, sólo nombres, sin personas): una prueba `engarde` individual
 * C de veteranos o Criterium (`CATEGORIAS_CONJUNTAS`) y las pruebas `rfee_pdf`/`skermo_rfee` X del mismo arma y categoría, fecha a ±1 día, otra
 * edición y género compatible (C mixta, o el mismo) tales que
 *  - X cabe en C: al menos 3 nombres y el 80 % de los de X están en C;
 *  - X sola no cubre C: menos del 80 % de los nombres de C están en X.
 * Las X que comparten la mitad de los nombres son copias de la misma clasificación (un grupo).
 * C es conjunta si tiene dos o más grupos disjuntos (regla `partes`) o un solo grupo que
 * `mismoEvento` no casa con C (regla `contenida`: el duplicado normal no la fundiría y quedaría
 * como prueba aparte con los puestos repetidos). Las partes juntas cubren al menos el 40 % de
 * C. Una parte ya registrada en la tabla basta con que tenga la mitad de sus nombres en C (al
 * borrar sus asaltos repetidos pierde los nombres recortados de las poules del PDF). Si dos grupos se solapan a medias, o dos lecturas de Engarde reclaman las mismas partes y
 * no son la misma lectura, no se toca (se cuenta como ambigua).
 *
 * Partes sueltas (`detectarPartesSueltas`, también regla `partes`): si la lectura de Engarde ya se
 * fundió con uno de los tramos (los demás tenían menos de 3 tiradores), la conjunta es ese tramo
 * anfitrión, que guarda todos los asaltos, y los tramos sin asaltos cuyos tiradores salen en
 * ellos son sus partes. La anfitriona conserva sus puestos con persona.
 *
 * Al registrar (`aplicarConjuntas`):
 *  - `sport_competition_combined` (migración 0013) guarda parte → conjunta; queda igual a la
 *    detección (se borran las filas que ya no se detectan);
 *  - la conjunta es una prueba propia con sus poules y cuadro; sus puestos se publican tal cual
 *    pero sin persona (`person_id` NULL): los puestos oficiales son los de cada parte, y con
 *    persona saldrían dos veces en la ficha del tirador;
 *  - los asaltos de una parte con la misma firma que uno de la conjunta se borran (repetidos);
 *  - de dos lecturas de Engarde de la misma conjunta se queda la de más asaltos y la otra se
 *    borra entera.
 * `vincularAsaltosConjuntas` vincula los lados de los asaltos de la conjunta con la persona del
 * puesto de su nombre en las partes (exacto único, si no compatible único, por persona raíz).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ahora, argumento, bandera, NUEVO_POR_DEFECTO, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia, uuid } from './comun';
import {
  cargarPruebasNacionales,
  firmaLaxa,
  mismoEvento,
  nombresCompatiblesRecorte,
  nombresEnComun,
  prepararNombre,
  type NombrePreparado,
  type PruebaNacional,
} from './dedupe-pruebas';

export const TABLA_CONJUNTAS = 'sport_competition_combined';
/**
 * Sólo veteranos y Criterium (M9-M13) se tiran juntos y se clasifican partidos. En las demás
 * categorías una clasificación nacional dentro de una lectura mayor es el mismo evento con
 * extranjeros (un TNR dentro de un satélite) y lo resuelve el duplicado normal.
 */
export const CATEGORIAS_CONJUNTAS: ReadonlySet<string> = new Set(['VET', 'M9', 'M11', 'M13']);
export const MIGRACION_CONJUNTAS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle-d1', '0013_pruebas_conjuntas.sql');

export type ReglaConjunta = 'partes' | 'contenida';
/**
 * Conjunta nacional de `detectarPartesSueltas` (sin campo: lectura de Engarde). `tramo`: una
 * clasificación de Skermo de un tramo que se quedó con los asaltos de la lectura de Engarde;
 * `clasificacion_conjunta`: un PDF de la RFEE que clasifica juntos varios tramos.
 */
export type TipoAnfitriona = 'tramo' | 'clasificacion_conjunta';
export type PruebaConjunta = {
  conjunta: PruebaNacional;
  partes: { prueba: PruebaNacional; comunes: number }[];
  grupos: number;
  regla: ReglaConjunta;
  anfitriona?: TipoAnfitriona;
};

export type DeteccionConjuntas = {
  conjuntas: PruebaConjunta[];
  /** Lecturas de Engarde con partes que se solapan a medias, o que reclaman partes de otra conjunta. */
  ambiguas: string[];
  /** Lecturas de Engarde repetidas de una conjunta que se queda: se borran. */
  repetidas: { borrar: PruebaNacional; queda: PruebaNacional }[];
};

const dia = (f: string) => Math.round(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) / 86_400_000);
const solape = (a: readonly NombrePreparado[], b: readonly NombrePreparado[]) => {
  const [menor, mayor] = a.length <= b.length ? [a, b] : [b, a];
  return menor.length === 0 ? 0 : nombresEnComun(menor, mayor) / menor.length;
};

type Candidata = { prueba: PruebaNacional; comunes: number; fijada: boolean };

function candidatas(
  c: PruebaNacional, porArma: ReadonlyMap<string, PruebaNacional[]>, previas: ReadonlyMap<string, string>,
): Candidata[] {
  const out: Candidata[] = [];
  for (const x of porArma.get(`${c.weapon}|${c.category}`) ?? []) {
    if (x.source === 'engarde' || x.edition_id === c.edition_id) continue;
    if (Math.abs(dia(x.fecha) - dia(c.fecha)) > 1) continue;
    if (c.gender !== 'MIXTO' && x.gender !== c.gender) continue;
    if (x.nombres.length < 3) continue;
    // Una parte ya registrada pierde nombres al borrarse sus asaltos repetidos en la conjunta
    // (los nombres recortados de las poules del PDF): se mantiene con la mitad.
    const fijada = previas.get(x.id) === c.id;
    const comunes = nombresEnComun(x.nombres, c.nombres);
    if (comunes < 3 || comunes < (fijada ? 0.5 : 0.8) * x.nombres.length) continue;
    if (nombresEnComun(c.nombres, x.nombres) >= 0.8 * c.nombres.length) continue;
    out.push({ prueba: x, comunes, fijada });
  }
  return out;
}

/** `previas`: parte → conjunta ya registradas (la tabla), para que la detección no oscile entre pasadas. */
export function detectarConjuntas(pruebas: readonly PruebaNacional[], previas: ReadonlyMap<string, string> = new Map()): DeteccionConjuntas {
  const porArma = new Map<string, PruebaNacional[]>();
  for (const p of pruebas) {
    if (p.source === 'engarde') continue;
    const k = `${p.weapon}|${p.category}`;
    (porArma.get(k) ?? porArma.set(k, []).get(k)!).push(p);
  }
  const ambiguas: string[] = [];
  const halladas: PruebaConjunta[] = [];
  const engarde = pruebas.filter((p) => p.source === 'engarde' && p.nombres.length >= 4 && CATEGORIAS_CONJUNTAS.has(p.category))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const c of engarde) {
    const cands = candidatas(c, porArma, previas);
    if (cands.length === 0) continue;
    // Grupos: copias de la misma clasificación (la mitad de los nombres en común).
    const grupo = cands.map((_, i) => i);
    const raiz = (i: number): number => (grupo[i] === i ? i : (grupo[i] = raiz(grupo[i])));
    let dudosa = false;
    for (let i = 0; i < cands.length; i += 1) {
      for (let j = i + 1; j < cands.length; j += 1) {
        const s = solape(cands[i].prueba.nombres, cands[j].prueba.nombres);
        if (s >= 0.5) grupo[raiz(i)] = raiz(j);
        else if (s > 0.2) dudosa = true;
      }
    }
    if (dudosa) {
      ambiguas.push(c.id);
      continue;
    }
    const grupos = new Set(cands.map((_, i) => raiz(i))).size;
    const union = cands.flatMap((x) => x.prueba.nombres);
    if (nombresEnComun(c.nombres, union) < 0.4 * c.nombres.length) continue;
    if (grupos === 1 && !cands.every((x) => x.fijada) && cands.some((x) => mismoEvento(x.prueba, c) > 0)) continue;
    halladas.push({
      conjunta: c, partes: cands.map(({ prueba, comunes }) => ({ prueba, comunes })), grupos, regla: grupos >= 2 ? 'partes' : 'contenida',
    });
  }
  // Dos lecturas de Engarde con las mismas partes: si son la misma lectura (casi los mismos
  // nombres) se queda la de más asaltos; si no, ninguna se toca.
  const porParte = new Map<string, PruebaConjunta[]>();
  for (const h of halladas) for (const x of h.partes) (porParte.get(x.prueba.id) ?? porParte.set(x.prueba.id, []).get(x.prueba.id)!).push(h);
  const fuera = new Set<string>();
  const repetidas: DeteccionConjuntas['repetidas'] = [];
  const peso = (p: PruebaNacional) => [p.asaltos.POULE + p.asaltos.TABLEAU, p.resultados];
  for (const lista of porParte.values()) {
    if (lista.length < 2) continue;
    const orden = [...lista].sort((a, b) => {
      const [x, y] = [peso(a.conjunta), peso(b.conjunta)];
      return y[0] - x[0] || y[1] - x[1] || (a.conjunta.id < b.conjunta.id ? -1 : 1);
    });
    const queda = orden[0];
    for (const otra of orden.slice(1)) {
      if (fuera.has(otra.conjunta.id)) continue;
      fuera.add(otra.conjunta.id);
      if (solape(otra.conjunta.nombres, queda.conjunta.nombres) >= 0.8) repetidas.push({ borrar: otra.conjunta, queda: queda.conjunta });
      else {
        ambiguas.push(otra.conjunta.id);
        if (!fuera.has(queda.conjunta.id)) ambiguas.push(queda.conjunta.id);
        fuera.add(queda.conjunta.id);
      }
    }
  }
  return { conjuntas: halladas.filter((h) => !fuera.has(h.conjunta.id)), ambiguas: [...new Set(ambiguas)], repetidas };
}

// ------------------------------------------------------------------ partes sueltas

export type PartesSueltas = { conjuntas: PruebaConjunta[]; ambiguas: string[] };
/**
 * Sólo veteranos: en Criterium los `~2` de un mismo PDF (otra tabla de la misma prueba) y las
 * copias repetidas de un PDF parecen tramos sueltos y no lo son.
 */
export const CATEGORIAS_SUELTAS: ReadonlySet<string> = new Set(['VET']);

/**
 * Regla «partes» cuando la lectura de Engarde ya se fundió con uno de los tramos. Varios tramos de
 * veteranos se tiran en una sola prueba de Engarde; si los demás tramos tienen menos de 3
 * tiradores, `detectarConjuntas` no los ve como partes, la lectura cuenta como copia del tramo
 * mayor y `fundirDuplicados` le pasa todos los asaltos (y, como «puestos que sólo publica la otra
 * lectura», los puestos de los otros tramos). Queda la prueba anfitriona H (rfee_pdf o
 * skermo_rfee) con asaltos de tiradores que no están en su clasificación propia, y los otros
 * tramos sin asaltos ni enlace.
 *
 * `puestosDe`: nombres de los puestos propios de cada prueba (de su misma fuente; los trasladados
 * de otra lectura no cuentan). Se enlaza cada tramo suelto X con H como conjunta (sin mover ni
 * copiar asaltos) si:
 *  - H y X son nacionales (no Engarde), de veteranos, de la misma arma y género, a ±1 día, de
 *    ediciones distintas y no están ya en otra conjunta;
 *  - X no tiene asaltos y H sí;
 *  - H de Skermo (`tramo`, la que absorbió la lectura de Engarde): los nombres de X están en los
 *    asaltos de H y no en su clasificación propia (con 1-4 tiradores todos, con más el 80 %; como
 *    mucho un 20 % de X en la clasificación de H), y las partes explican al menos la mitad de
 *    los nombres de los asaltos de H que no están en su clasificación;
 *  - H de un PDF (`clasificacion_conjunta`, el PDF clasifica juntos los tramos que Skermo
 *    parte): los nombres de X están en la clasificación y en los asaltos de H (misma exigencia),
 *    ninguna X sola cubre el 80 % de H, hay al menos dos partes y entre todas cubren la mitad de H;
 *  - los tramos enlazados no comparten tiradores entre sí;
 *  - X casa así con una sola H (si casa con dos, ninguna se toca).
 * H sigue entrando en la fusión de duplicados (es una clasificación publicada). Una H `tramo`
 * conserva la persona de sus puestos propios y pierde los trasladados de sus partes
 * (`puestosRepetidosAnfitriona`, se borran al registrar); una H `clasificacion_conjunta` pierde la
 * persona en los puestos de quien la tiene en una parte (`desvincularPuestosConjuntas`).
 */
export function detectarPartesSueltas(
  pruebas: readonly PruebaNacional[],
  puestosDe: ReadonlyMap<string, readonly NombrePreparado[]>,
  asaltosDe: ReadonlyMap<string, readonly NombrePreparado[]>,
  ocupadas: ReadonlySet<string> = new Set(),
): PartesSueltas {
  const nacionales = pruebas.filter((p) => p.source !== 'engarde' && CATEGORIAS_SUELTAS.has(p.category) && !ocupadas.has(p.id));
  const porClave = new Map<string, PruebaNacional[]>();
  for (const p of nacionales) {
    const k = `${p.weapon}|${p.category}|${p.gender}`;
    (porClave.get(k) ?? porClave.set(k, []).get(k)!).push(p);
  }
  const asaltos = (p: PruebaNacional) => p.asaltos.POULE + p.asaltos.TABLEAU;
  const propuestas = new Map<string, { anfitriona: PruebaNacional; partes: { prueba: PruebaNacional; comunes: number }[]; tipo: TipoAnfitriona }>();
  const reclamadas = new Map<string, string[]>();
  const ambiguas = new Set<string>();
  for (const h of [...nacionales].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (asaltos(h) === 0) continue;
    const propios = puestosDe.get(h.id) ?? [];
    const ajenos = (asaltosDe.get(h.id) ?? []).filter((n) => nombresEnComun([n], propios) === 0);
    const enAsaltos = asaltosDe.get(h.id) ?? [];
    const tipo: TipoAnfitriona = h.source === 'skermo_rfee' ? 'tramo' : 'clasificacion_conjunta';
    if (tipo === 'tramo' && ajenos.length === 0) continue;
    const partes: { prueba: PruebaNacional; comunes: number }[] = [];
    for (const x of porClave.get(`${h.weapon}|${h.category}|${h.gender}`) ?? []) {
      if (x.id === h.id || x.edition_id === h.edition_id || asaltos(x) > 0 || Math.abs(dia(x.fecha) - dia(h.fecha)) > 1) continue;
      const nx = puestosDe.get(x.id) ?? [];
      if (nx.length === 0) continue;
      const exigidos = nx.length <= 4 ? nx.length : Math.ceil(0.8 * nx.length);
      const enPropios = nombresEnComun(nx, propios);
      if (tipo === 'tramo') {
        const comunes = nombresEnComun(nx, ajenos);
        if (comunes < exigidos || enPropios > 0.2 * nx.length) continue;
        partes.push({ prueba: x, comunes });
      } else {
        // Una parte sola no cubre la clasificación conjunta (si la cubre es una copia: duplicado).
        if (enPropios < exigidos || nombresEnComun(nx, enAsaltos) < exigidos) continue;
        if (nombresEnComun(propios, nx) >= 0.8 * propios.length) continue;
        partes.push({ prueba: x, comunes: enPropios });
      }
    }
    if (partes.length === 0 || (tipo === 'clasificacion_conjunta' && partes.length < 2)) continue;
    // Dos tramos con tiradores en común son copias (o el mismo tramo dos veces): no se sabe cuál.
    const solapadas = partes.some((x, i) => partes.slice(i + 1).some((y) =>
      nombresEnComun(puestosDe.get(x.prueba.id) ?? [], puestosDe.get(y.prueba.id) ?? []) > 0));
    if (solapadas) {
      ambiguas.add(h.id);
      continue;
    }
    const deLasPartes = partes.flatMap((x) => puestosDe.get(x.prueba.id) ?? []);
    const [explicados, total] = tipo === 'tramo' ? [nombresEnComun(ajenos, deLasPartes), ajenos.length] : [nombresEnComun(propios, deLasPartes), propios.length];
    if (explicados < 0.5 * total) continue;
    propuestas.set(h.id, { anfitriona: h, partes, tipo });
    for (const x of partes) (reclamadas.get(x.prueba.id) ?? reclamadas.set(x.prueba.id, []).get(x.prueba.id)!).push(h.id);
  }
  for (const hs of reclamadas.values()) if (hs.length > 1) for (const h of hs) ambiguas.add(h);
  // Una anfitriona que es a su vez tramo suelto de otra: la cadena no se sabe leer.
  for (const h of propuestas.keys()) if (reclamadas.has(h)) { ambiguas.add(h); for (const o of reclamadas.get(h)!) ambiguas.add(o); }
  const conjuntas: PruebaConjunta[] = [];
  for (const { anfitriona, partes, tipo } of propuestas.values()) {
    if (ambiguas.has(anfitriona.id)) continue;
    conjuntas.push({ conjunta: anfitriona, partes, grupos: partes.length + (tipo === 'tramo' ? 1 : 0), regla: 'partes', anfitriona: tipo });
  }
  return { conjuntas, ambiguas: [...ambiguas] };
}

/**
 * Nombres de los puestos propios (de la misma fuente que la prueba: los trasladados por
 * `fundirDuplicados` desde otra lectura no cuentan) y de los asaltos de las pruebas nacionales
 * de veteranos.
 */
export function nombresConjuntables(db: DatabaseSync): { puestos: Map<string, NombrePreparado[]>; asaltos: Map<string, NombrePreparado[]> } {
  const cats = [...CATEGORIAS_SUELTAS].map((c) => `'${c}'`).join(',');
  const filtro = `c.source IN ('rfee_pdf','skermo_rfee') AND c.format = 'INDIVIDUAL' AND c.category IN (${cats})`;
  const llenar = (sql: string) => {
    const out = new Map<string, NombrePreparado[]>();
    const vistos = new Map<string, Set<string>>();
    for (const r of db.prepare(sql).iterate() as Iterable<{ c: string; n: string | null }>) {
      if (!r.n) continue;
      const n = prepararNombre(r.n);
      if (!n.norm) continue;
      const v = vistos.get(r.c) ?? vistos.set(r.c, new Set()).get(r.c)!;
      if (v.has(n.norm)) continue;
      v.add(n.norm);
      (out.get(r.c) ?? out.set(r.c, []).get(r.c)!).push(n);
    }
    return out;
  };
  return {
    puestos: llenar(`SELECT r.competition_id c, r.source_name n FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id
      WHERE ${filtro} AND r.source = c.source`),
    asaltos: llenar(`SELECT b.competition_id c, b.fencer_a_name n FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id WHERE ${filtro}
      UNION ALL SELECT b.competition_id c, b.fencer_b_name n FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id WHERE ${filtro}`),
  };
}

/** Las sueltas que no chocan con la detección normal (que manda), añadidas a ella. */
export function sumarPartesSueltas(det: DeteccionConjuntas, sueltas: PartesSueltas): DeteccionConjuntas {
  const ocupadas = new Set<string>();
  for (const c of det.conjuntas) { ocupadas.add(c.conjunta.id); for (const x of c.partes) ocupadas.add(x.prueba.id); }
  for (const r of det.repetidas) { ocupadas.add(r.borrar.id); ocupadas.add(r.queda.id); }
  const validas = sueltas.conjuntas.filter((c) => !ocupadas.has(c.conjunta.id) && c.partes.every((x) => !ocupadas.has(x.prueba.id)));
  return { ...det, conjuntas: [...det.conjuntas, ...validas], ambiguas: [...new Set([...det.ambiguas, ...sueltas.ambiguas])] };
}

// ------------------------------------------------------------------ base

export function hayTablaConjuntas(db: DatabaseSync): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(TABLA_CONJUNTAS));
}

/**
 * Crea la tabla en una copia de trabajo que no la tiene (la misma migración 0013 que se aplica
 * en D1). Las guardas que trae se guardan con las demás para `restaurarGuardia`, porque el
 * paso que llama ya las ha quitado.
 */
export function asegurarTablaConjuntas(db: DatabaseSync): boolean {
  if (hayTablaConjuntas(db)) return false;
  const existe = (tipo: string, nombre: string) =>
    Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type=? AND name=?`).get(tipo, nombre));
  db.exec(readFileSync(MIGRACION_CONJUNTAS, 'utf8'));
  if (existe('table', '_indexado_guardia')) quitarGuardia(db);
  else if (!existe('view', 'sport_write_authorized')) {
    // Base sin guardia (pruebas): las guardas nuevas fallarían por la vista que no existe.
    for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?`).all(TABLA_CONJUNTAS) as { name: string }[]) {
      db.exec(`DROP TRIGGER "${name}"`);
    }
  }
  return true;
}

/** Ids de las pruebas conjuntas registradas. */
export function idsConjuntas(db: DatabaseSync): Set<string> {
  if (!hayTablaConjuntas(db)) return new Set();
  return new Set((db.prepare(`SELECT DISTINCT combined_competition_id id FROM ${TABLA_CONJUNTAS}`).all() as { id: string }[]).map((r) => r.id));
}

export type InformeConjuntas = {
  conjuntas: number;
  partes: number;
  porRegla: Partial<Record<ReglaConjunta, number>>;
  ambiguas: number;
  filasInsertadas: number;
  filasActualizadas: number;
  filasBorradas: number;
  /** Puestos de las conjuntas que tenían persona: se dejan sin ella. */
  puestosDesvinculados: number;
  /** Asaltos de una parte repetidos en su conjunta. */
  asaltosParteRepetidos: number;
  lecturasRepetidasBorradas: number;
  /** Conjuntas de `detectarPartesSueltas` (anfitriona nacional con tramos sin asaltos). */
  partesSueltas: number;
  /** Puestos trasladados a una anfitriona que repetían el de un tirador de sus partes (`puestosRepetidosAnfitriona`). */
  puestosAnfitrionaBorrados: number;
  ejemplos: { conjunta: string; regla: ReglaConjunta; partes: string[] }[];
};

/**
 * Conjunta de Engarde: todos sus puestos sin persona. Anfitriona de partes sueltas
 * (`detectarPartesSueltas`): la de Skermo (`tramo`) es la clasificación oficial de su tramo y no
 * se toca; la de un PDF (`clasificacion_conjunta`) pierde la persona sólo en los puestos de quien
 * tiene puesto (la misma persona raíz) en una de sus partes: los demás son su único resultado.
 */
export function desvincularPuestosConjuntas(db: DatabaseSync): number {
  if (!hayTablaConjuntas(db)) return 0;
  const engarde = Number(db.prepare(
    `UPDATE sport_result SET person_id = NULL
      WHERE person_id IS NOT NULL AND competition_id IN (
        SELECT k.combined_competition_id FROM ${TABLA_CONJUNTAS} k JOIN sport_competition c ON c.id = k.combined_competition_id
         WHERE c.source = 'engarde')`,
  ).run().changes);
  const pdf = Number(db.prepare(
    `UPDATE sport_result SET person_id = NULL
      WHERE person_id IS NOT NULL
        AND competition_id IN (
          SELECT k.combined_competition_id FROM ${TABLA_CONJUNTAS} k JOIN sport_competition c ON c.id = k.combined_competition_id
           WHERE c.source = 'rfee_pdf')
        AND EXISTS (
          SELECT 1 FROM ${TABLA_CONJUNTAS} k
            JOIN sport_result r2 ON r2.competition_id = k.part_competition_id
            JOIN sport_person p2 ON p2.id = r2.person_id
            JOIN sport_person p1 ON p1.id = sport_result.person_id
           WHERE k.combined_competition_id = sport_result.competition_id
             AND coalesce(p2.merged_into_person_id, p2.id) = coalesce(p1.merged_into_person_id, p1.id))`,
  ).run().changes);
  return engarde + pdf;
}

/**
 * Puestos de una anfitriona nacional (partes sueltas) que `fundirDuplicados` trasladó desde la
 * lectura conjunta (otra fuente) y son de tiradores de sus partes: repiten el puesto oficial que
 * ya tienen en su tramo.
 */
export function puestosRepetidosAnfitriona(db: DatabaseSync, c: PruebaConjunta): { id: string; nombre: string }[] {
  if (c.anfitriona !== 'tramo') return [];
  const nombresPartes = c.partes.flatMap((x) => (db.prepare(`SELECT source_name n FROM sport_result WHERE competition_id = ?`).all(x.prueba.id) as { n: string }[])
    .map((r) => prepararNombre(r.n)));
  return (db.prepare(`SELECT id, source_name n FROM sport_result WHERE competition_id = ? AND source <> ?`).all(c.conjunta.id, c.conjunta.source) as { id: string; n: string }[])
    .filter((r) => nombresEnComun([prepararNombre(r.n)], nombresPartes) > 0)
    .map((r) => ({ id: r.id, nombre: r.n }));
}

export function aplicarConjuntas(db: DatabaseSync, det: DeteccionConjuntas, simular = false): InformeConjuntas {
  const inf: InformeConjuntas = {
    conjuntas: det.conjuntas.length, partes: det.conjuntas.reduce((s, c) => s + c.partes.length, 0), porRegla: {},
    ambiguas: det.ambiguas.length, filasInsertadas: 0, filasActualizadas: 0, filasBorradas: 0, puestosDesvinculados: 0,
    asaltosParteRepetidos: 0, lecturasRepetidasBorradas: 0, partesSueltas: 0, puestosAnfitrionaBorrados: 0, ejemplos: [],
  };
  for (const c of det.conjuntas) {
    inf.porRegla[c.regla] = (inf.porRegla[c.regla] ?? 0) + 1;
    if (inf.ejemplos.length < 40) {
      inf.ejemplos.push({
        conjunta: `${c.conjunta.competition_key} ${c.conjunta.gender} ${c.conjunta.category} ${c.conjunta.fecha}`, regla: c.regla,
        partes: c.partes.map((x) => `${x.prueba.source}:${x.prueba.id} ${x.prueba.gender} ${x.comunes}/${x.prueba.nombres.length}`),
      });
    }
  }
  if (simular) return inf;
  const insertar = db.prepare(
    `INSERT INTO ${TABLA_CONJUNTAS} (id, part_competition_id, combined_competition_id, rule, shared_names, created_at) VALUES (?,?,?,?,?,?)`,
  );
  const actualizar = db.prepare(`UPDATE ${TABLA_CONJUNTAS} SET combined_competition_id=?, rule=?, shared_names=? WHERE id=?`);
  const borrarFila = db.prepare(`DELETE FROM ${TABLA_CONJUNTAS} WHERE id=?`);
  const asaltosFase = db.prepare(`SELECT id, fencer_a_name a, score_a sa, fencer_b_name b, score_b sb FROM sport_bout WHERE competition_id=? AND phase=?`);
  const borrarAsalto = db.prepare(`DELETE FROM sport_bout WHERE id=?`);
  db.exec('BEGIN');
  try {
    for (const r of det.repetidas) {
      // Una lectura repetida de Engarde: fuera entera (la vuelve a crear el cargador y vuelve a salir aquí).
      db.prepare(`DELETE FROM ${TABLA_CONJUNTAS} WHERE combined_competition_id=?1 OR part_competition_id=?1`).run(r.borrar.id);
      for (const t of ['sport_bout', 'sport_result', 'sport_import_coverage']) db.prepare(`DELETE FROM ${t} WHERE competition_id=?`).run(r.borrar.id);
      db.prepare(`DELETE FROM sport_competition WHERE id=?`).run(r.borrar.id);
      db.prepare(`DELETE FROM sport_edition WHERE id=? AND NOT EXISTS (SELECT 1 FROM sport_competition WHERE edition_id=?)`)
        .run(r.borrar.edition_id, r.borrar.edition_id);
      inf.lecturasRepetidasBorradas += 1;
    }
    // Después de borrar las repetidas: sus filas ya se fueron en cascada.
    const previas = new Map((db.prepare(
      `SELECT id, part_competition_id p, combined_competition_id c, rule r, shared_names s FROM ${TABLA_CONJUNTAS}`,
    ).all() as { id: string; p: string; c: string; r: string; s: number }[]).map((f) => [f.p, f]));
    const vistas = new Set<string>();
    const borrarPuesto = db.prepare(`DELETE FROM sport_result WHERE id = ?`);
    for (const c of det.conjuntas) {
      for (const r of puestosRepetidosAnfitriona(db, c)) inf.puestosAnfitrionaBorrados += Number(borrarPuesto.run(r.id).changes);
      const firmasConjunta = new Map<string, Map<string, number>>();
      for (const fase of ['POULE', 'TABLEAU'] as const) {
        const m = new Map<string, number>();
        for (const b of asaltosFase.all(c.conjunta.id, fase) as { a: string; sa: number; b: string; sb: number }[]) {
          const f = firmaLaxa(b.a, b.sa, b.b, b.sb);
          m.set(f, (m.get(f) ?? 0) + 1);
        }
        firmasConjunta.set(fase, m);
      }
      for (const x of c.partes) {
        vistas.add(x.prueba.id);
        const previa = previas.get(x.prueba.id);
        if (!previa) {
          insertar.run(uuid(), x.prueba.id, c.conjunta.id, c.regla, x.comunes, ahora());
          inf.filasInsertadas += 1;
        } else if (previa.c !== c.conjunta.id || previa.r !== c.regla || Number(previa.s) !== x.comunes) {
          actualizar.run(c.conjunta.id, c.regla, x.comunes, previa.id);
          inf.filasActualizadas += 1;
        }
        for (const fase of ['POULE', 'TABLEAU'] as const) {
          const resto = new Map(firmasConjunta.get(fase)!);
          if (resto.size === 0) continue;
          for (const b of asaltosFase.all(x.prueba.id, fase) as { id: string; a: string; sa: number; b: string; sb: number }[]) {
            const f = firmaLaxa(b.a, b.sa, b.b, b.sb);
            const n = resto.get(f) ?? 0;
            if (n === 0) continue;
            resto.set(f, n - 1);
            borrarAsalto.run(b.id);
            inf.asaltosParteRepetidos += 1;
          }
        }
      }
    }
    for (const [p, f] of previas) {
      if (vistas.has(p)) continue;
      borrarFila.run(f.id);
      inf.filasBorradas += 1;
    }
    inf.puestosDesvinculados = desvincularPuestosConjuntas(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return inf;
}

/** Detecta y registra las conjuntas. Devuelve los ids de las conjuntas (para excluirlas de los duplicados). */
export function registrarConjuntas(db: DatabaseSync, simular = false): { informe: InformeConjuntas; ids: Set<string> } {
  if (!simular) asegurarTablaConjuntas(db);
  const previas = hayTablaConjuntas(db)
    ? new Map((db.prepare(`SELECT part_competition_id p, combined_competition_id c FROM ${TABLA_CONJUNTAS}`).all() as { p: string; c: string }[])
      .map((f) => [f.p, f.c]))
    : new Map<string, string>();
  const pruebas = cargarPruebasNacionales(db);
  const normal = detectarConjuntas(pruebas, previas);
  const { puestos, asaltos } = nombresConjuntables(db);
  const ocupadas = new Set(normal.conjuntas.flatMap((c) => [c.conjunta.id, ...c.partes.map((x) => x.prueba.id)]));
  const det = sumarPartesSueltas(normal, detectarPartesSueltas(pruebas, puestos, asaltos, ocupadas));
  const informe = aplicarConjuntas(db, det, simular || !hayTablaConjuntas(db));
  informe.partesSueltas = det.conjuntas.length - normal.conjuntas.length;
  // Sólo las lecturas de Engarde quedan fuera de la fusión de duplicados: la anfitriona de unas
  // partes sueltas es una clasificación oficial y sigue fundiéndose con sus copias.
  return { informe, ids: new Set(normal.conjuntas.map((c) => c.conjunta.id)) };
}

// ------------------------------------------------------------------ asaltos

export type InformeAsaltosConjuntas = { pruebas: number; ladosVinculados: number; sinPuesto: number; ambiguos: number };

/**
 * Lados sin persona de los asaltos de cada conjunta: la persona (raíz) del puesto de su
 * nombre en las partes, si sólo una casa (exacto; si no, compatible por recorte). Nunca la
 * misma persona en los dos lados.
 */
export function vincularAsaltosConjuntas(db: DatabaseSync): InformeAsaltosConjuntas {
  const inf: InformeAsaltosConjuntas = { pruebas: 0, ladosVinculados: 0, sinPuesto: 0, ambiguos: 0 };
  if (!hayTablaConjuntas(db)) return inf;
  const mapa = new Map<string, string[]>();
  for (const f of db.prepare(`SELECT part_competition_id p, combined_competition_id c FROM ${TABLA_CONJUNTAS}`).all() as { p: string; c: string }[]) {
    (mapa.get(f.c) ?? mapa.set(f.c, []).get(f.c)!).push(f.p);
  }
  const puestos = db.prepare(
    `SELECT r.source_name n, coalesce(p.merged_into_person_id, p.id) persona FROM sport_result r
       JOIN sport_person p ON p.id = r.person_id WHERE r.competition_id = ?`,
  );
  const asaltos = db.prepare(
    `SELECT id, fencer_a_name an, fencer_b_name bn, fencer_a_person_id ap, fencer_b_person_id bp FROM sport_bout
      WHERE competition_id = ? AND (fencer_a_person_id IS NULL OR fencer_b_person_id IS NULL)`,
  );
  const raiz = db.prepare(`SELECT coalesce(merged_into_person_id, id) r FROM sport_person WHERE id = ?`);
  const poner = db.prepare(
    `UPDATE sport_bout SET fencer_a_person_id = coalesce(fencer_a_person_id, ?), fencer_b_person_id = coalesce(fencer_b_person_id, ?) WHERE id = ?`,
  );
  db.exec('BEGIN');
  try {
    for (const [c, partes] of mapa) {
      // Con la conjunta: una anfitriona nacional (partes sueltas) tiene sus propios puestos con
      // persona, y un nombre recortado de los suyos no debe ir a un tirador de las partes.
      const cands = [...partes, c].flatMap((p) => (puestos.all(p) as { n: string; persona: string }[])
        .map((r) => ({ nombre: prepararNombre(r.n), persona: r.persona })));
      if (cands.length === 0) continue;
      const resolver = (nombre: string): string | null | 'ambiguo' => {
        const n = prepararNombre(nombre);
        let personas = new Set(cands.filter((x) => x.nombre.norm === n.norm).map((x) => x.persona));
        if (personas.size === 0) personas = new Set(cands.filter((x) => nombresCompatiblesRecorte(n, x.nombre)).map((x) => x.persona));
        if (personas.size > 1) return 'ambiguo';
        return personas.size === 1 ? [...personas][0] : null;
      };
      const cache = new Map<string, string | null | 'ambiguo'>();
      const de = (nombre: string) => {
        if (!cache.has(nombre)) cache.set(nombre, resolver(nombre));
        return cache.get(nombre)!;
      };
      let tocada = false;
      for (const b of asaltos.all(c) as { id: string; an: string; bn: string; ap: string | null; bp: string | null }[]) {
        const lado = (actual: string | null, nombre: string): string | null => {
          if (actual) return null;
          const r = de(nombre);
          if (r === 'ambiguo') { inf.ambiguos += 1; return null; }
          if (r === null) inf.sinPuesto += 1;
          return r;
        };
        let a = lado(b.ap, b.an);
        let bb = lado(b.bp, b.bn);
        const ra = a ?? (b.ap ? (raiz.get(b.ap) as { r: string } | undefined)?.r ?? b.ap : null);
        const rb = bb ?? (b.bp ? (raiz.get(b.bp) as { r: string } | undefined)?.r ?? b.bp : null);
        if (ra && rb && ra === rb) { a = null; bb = null; }
        if (!a && !bb) continue;
        poner.run(a, bb, b.id);
        inf.ladosVinculados += (a ? 1 : 0) + (bb ? 1 : 0);
        tocada = true;
      }
      if (tocada) inf.pruebas += 1;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return inf;
}

function main(): void {
  const db = new DatabaseSync(argumento('db', NUEVO_POR_DEFECTO));
  const simular = bandera('simular');
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  if (!simular) quitarGuardia(db);
  let informe: { conjuntas: InformeConjuntas; asaltos: InformeAsaltosConjuntas | null };
  try {
    const { informe: inf } = registrarConjuntas(db, simular);
    informe = { conjuntas: inf, asaltos: simular ? null : vincularAsaltosConjuntas(db) };
  } finally {
    restaurarGuardia(db);
    db.close();
  }
  const salida = argumento('informe', '');
  if (salida) writeFileSync(salida, JSON.stringify(informe, null, 2));
  console.log(JSON.stringify(informe, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
