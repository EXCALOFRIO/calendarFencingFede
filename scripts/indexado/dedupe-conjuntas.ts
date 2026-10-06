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
export type PruebaConjunta = {
  conjunta: PruebaNacional;
  partes: { prueba: PruebaNacional; comunes: number }[];
  grupos: number;
  regla: ReglaConjunta;
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
  ejemplos: { conjunta: string; regla: ReglaConjunta; partes: string[] }[];
};

export function desvincularPuestosConjuntas(db: DatabaseSync): number {
  if (!hayTablaConjuntas(db)) return 0;
  return Number(db.prepare(
    `UPDATE sport_result SET person_id = NULL
      WHERE person_id IS NOT NULL AND competition_id IN (SELECT combined_competition_id FROM ${TABLA_CONJUNTAS})`,
  ).run().changes);
}

export function aplicarConjuntas(db: DatabaseSync, det: DeteccionConjuntas, simular = false): InformeConjuntas {
  const inf: InformeConjuntas = {
    conjuntas: det.conjuntas.length, partes: det.conjuntas.reduce((s, c) => s + c.partes.length, 0), porRegla: {},
    ambiguas: det.ambiguas.length, filasInsertadas: 0, filasActualizadas: 0, filasBorradas: 0, puestosDesvinculados: 0,
    asaltosParteRepetidos: 0, lecturasRepetidasBorradas: 0, ejemplos: [],
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
    for (const c of det.conjuntas) {
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
  const det = detectarConjuntas(cargarPruebasNacionales(db), previas);
  const informe = aplicarConjuntas(db, det, simular || !hayTablaConjuntas(db));
  return { informe, ids: new Set(det.conjuntas.map((c) => c.conjunta.id)) };
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
      const cands = partes.flatMap((p) => (puestos.all(p) as { n: string; persona: string }[])
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
