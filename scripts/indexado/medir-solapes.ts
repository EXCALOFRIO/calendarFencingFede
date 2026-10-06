/**
 * Mide pruebas que existen a la vez en dos fuentes (skermo_rfee/fie frente a
 * rfee_pdf): mismo arma, género, categoría y formato, fecha a ±1 día y al menos
 * la mitad de las personas vinculadas en común (sobre la prueba más pequeña).
 * Sólo lee.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/medir-solapes.ts --db <copia.sqlite> [--informe <json>]
 */
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { argumento, normalizarNombre, NUEVO_POR_DEFECTO } from './comun';

type Comp = {
  id: string; source: string; season: string; weapon: string; gender: string; category: string;
  category_raw: string | null; format: string; fecha: string | null; event_competition_id: string | null;
};

export type InformeSolapes = Record<string, {
  pares: number;
  pruebasA: number;
  pruebasPdf: number;
  personasRepetidas: number;
  mismaTemporada: number;
  mismaCategoriaRaw: number;
  mismoEventCompetition: number;
  conEventCompetition: number;
  pdfConVariosPares: number;
  ejemplos: { a: string; pdf: string; comunes: number; menor: number }[];
}>;

const dia = (f: string) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);

export type Par = { a: Comp; pdf: Comp; comunes: number; menor: number };

export type Emparejado = {
  raiz: (id: string) => string;
  /** competition_id → personas raíz con resultado vinculado. */
  personas: Map<string, Set<string>>;
  pares: Record<string, Par[]>;
};

export function raices(db: DatabaseSync): (id: string) => string {
  const fusion = new Map<string, string>();
  for (const p of db.prepare(`SELECT id, merged_into_person_id m FROM sport_person WHERE merged_into_person_id IS NOT NULL`)
    .all() as { id: string; m: string }[]) fusion.set(p.id, p.m);
  return (id: string) => {
    let a = id;
    for (let i = 0; i < 4 && fusion.has(a); i += 1) a = fusion.get(a)!;
    return a;
  };
}

/** Pares (prueba de `fuentes`, prueba rfee_pdf) que son el mismo evento según la regla de la cabecera. */
export function emparejar(db: DatabaseSync, fuentes: readonly string[] = ['skermo_rfee', 'fie'], umbral = 0.5): Emparejado {
  const raiz = raices(db);
  const comps = db.prepare(
    `SELECT c.id, c.source, c.season, c.weapon, c.gender, c.category, c.category_raw, c.format,
            coalesce(c.competition_date, e.start_date) fecha, c.event_competition_id
       FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id`,
  ).all() as Comp[];
  const personas = new Map<string, Set<string>>();
  for (const r of db.prepare(`SELECT competition_id c, person_id p FROM sport_result WHERE person_id IS NOT NULL`)
    .iterate() as unknown as Iterable<{ c: string; p: string }>) {
    const s = personas.get(r.c) ?? new Set<string>();
    s.add(raiz(r.p));
    personas.set(r.c, s);
  }
  const clave = (c: Comp, d: number) => `${c.weapon}|${c.gender}|${c.category}|${c.format}|${d}`;
  const pdfPor = new Map<string, Comp[]>();
  for (const c of comps) {
    if (c.source !== 'rfee_pdf' || !c.fecha || !personas.has(c.id)) continue;
    const k = clave(c, dia(c.fecha));
    (pdfPor.get(k) ?? pdfPor.set(k, []).get(k)!).push(c);
  }
  const pares: Record<string, Par[]> = {};
  for (const fuente of fuentes) {
    const lista: Par[] = [];
    for (const a of comps) {
      if (a.source !== fuente || !a.fecha) continue;
      const pa = personas.get(a.id);
      if (!pa) continue;
      for (const d of [-1, 0, 1]) {
        for (const b of pdfPor.get(clave(a, dia(a.fecha) + d)) ?? []) {
          const pb = personas.get(b.id)!;
          let comunes = 0;
          for (const p of pa) if (pb.has(p)) comunes += 1;
          const menor = Math.min(pa.size, pb.size);
          if (comunes === 0 || comunes / menor < umbral) continue;
          lista.push({ a, pdf: b, comunes, menor });
        }
      }
    }
    pares[fuente] = lista;
  }
  return { raiz, personas, pares };
}

export function medirSolapes(db: DatabaseSync, umbral = 0.5): InformeSolapes {
  const { pares } = emparejar(db, ['skermo_rfee', 'fie'], umbral);
  const informe: InformeSolapes = {};
  for (const [fuente, lista] of Object.entries(pares)) {
    const res = {
      pares: lista.length, pruebasA: new Set(lista.map((p) => p.a.id)).size, pruebasPdf: 0, personasRepetidas: 0,
      mismaTemporada: 0, mismaCategoriaRaw: 0, mismoEventCompetition: 0, conEventCompetition: 0, pdfConVariosPares: 0,
      ejemplos: [] as InformeSolapes[string]['ejemplos'],
    };
    const pdfVistos = new Map<string, number>();
    for (const { a, pdf: b, comunes, menor } of lista) {
      res.personasRepetidas += comunes;
      if (a.season === b.season) res.mismaTemporada += 1;
      if (a.category_raw === b.category_raw) res.mismaCategoriaRaw += 1;
      if (a.event_competition_id || b.event_competition_id) res.conEventCompetition += 1;
      if (a.event_competition_id && a.event_competition_id === b.event_competition_id) res.mismoEventCompetition += 1;
      pdfVistos.set(b.id, (pdfVistos.get(b.id) ?? 0) + 1);
      if (res.ejemplos.length < 8) res.ejemplos.push({ a: a.id, pdf: b.id, comunes, menor });
    }
    res.pruebasPdf = pdfVistos.size;
    res.pdfConVariosPares = [...pdfVistos.values()].filter((n) => n > 1).length;
    informe[fuente] = res;
  }
  return informe;
}

export type InformeDepuracion = {
  pares: number;
  paresAplicados: number;
  paresOmitidosPdfMayor: number;
  resultadosBorrados: number;
  asaltosBorrados: number;
  paresSinAsaltosSkermo: number;
  competicionesBorradas: number;
  edicionesBorradas: number;
  coberturasBorradas: number;
};

/**
 * Quita de cada prueba rfee_pdf emparejada con una skermo_rfee lo que ya está en
 * skermo: los puestos de personas que también están allí y, si skermo trae
 * asaltos, los asaltos con ambos tiradores allí. Sólo cuando la prueba skermo
 * tiene al menos tantos puestos vinculados como la PDF. Idempotente: tras borrar,
 * la PDF ya no comparte personas con skermo y deja de emparejarse.
 */
export function depurarSolapes(db: DatabaseSync, umbral = 0.5): InformeDepuracion {
  const { raiz, personas, pares } = emparejar(db, ['skermo_rfee'], umbral);
  const lista = pares.skermo_rfee ?? [];
  const inf: InformeDepuracion = {
    pares: lista.length, paresAplicados: 0, paresOmitidosPdfMayor: 0, resultadosBorrados: 0, asaltosBorrados: 0,
    paresSinAsaltosSkermo: 0, competicionesBorradas: 0, edicionesBorradas: 0, coberturasBorradas: 0,
  };
  if (lista.length === 0) return inf;
  const vinculados = db.prepare(`SELECT count(*) n FROM sport_result WHERE competition_id=? AND person_id IS NOT NULL`);
  const asaltosDe = db.prepare(`SELECT count(*) n FROM sport_bout WHERE competition_id=?`);
  const puestos = db.prepare(`SELECT id, person_id FROM sport_result WHERE competition_id=? AND source='rfee_pdf' AND person_id IS NOT NULL`);
  const asaltos = db.prepare(
    `SELECT id, fencer_a_person_id a, fencer_b_person_id b FROM sport_bout
      WHERE competition_id=? AND source='rfee_pdf' AND fencer_a_person_id IS NOT NULL AND fencer_b_person_id IS NOT NULL`,
  );
  const borrarPuesto = db.prepare(`DELETE FROM sport_result WHERE id=?`);
  const borrarAsalto = db.prepare(`DELETE FROM sport_bout WHERE id=?`);
  const n = (st: ReturnType<DatabaseSync['prepare']>, id: string) => Number((st.get(id) as { n: number }).n);
  const pdfTocadas = new Set<string>();
  db.exec('BEGIN');
  try {
    for (const { a, pdf } of lista) {
      if (n(vinculados, a.id) < n(vinculados, pdf.id)) {
        inf.paresOmitidosPdfMayor += 1;
        continue;
      }
      inf.paresAplicados += 1;
      pdfTocadas.add(pdf.id);
      const enSkermo = personas.get(a.id)!;
      for (const r of puestos.all(pdf.id) as { id: string; person_id: string }[]) {
        if (!enSkermo.has(raiz(r.person_id))) continue;
        borrarPuesto.run(r.id);
        inf.resultadosBorrados += 1;
      }
      if (n(asaltosDe, a.id) === 0) {
        inf.paresSinAsaltosSkermo += 1;
        continue;
      }
      for (const b of asaltos.all(pdf.id) as { id: string; a: string; b: string }[]) {
        if (!enSkermo.has(raiz(b.a)) || !enSkermo.has(raiz(b.b))) continue;
        borrarAsalto.run(b.id);
        inf.asaltosBorrados += 1;
      }
    }
    const quedan = db.prepare(
      `SELECT (SELECT count(*) FROM sport_result WHERE competition_id=?) + (SELECT count(*) FROM sport_bout WHERE competition_id=?) n`,
    );
    const comp = db.prepare(`SELECT source, season, competition_key k, edition_id e FROM sport_competition WHERE id=?`);
    const borrarCob = db.prepare(
      `DELETE FROM sport_import_coverage WHERE competition_id=? OR (source=? AND season=? AND competition_key=?)`,
    );
    const borrarComp = db.prepare(`DELETE FROM sport_competition WHERE id=?`);
    const borrarEdicion = db.prepare(
      `DELETE FROM sport_edition WHERE id=?1 AND NOT EXISTS (SELECT 1 FROM sport_competition WHERE edition_id=?1)`,
    );
    for (const id of pdfTocadas) {
      if (Number((quedan.get(id, id) as { n: number }).n) > 0) continue;
      const c = comp.get(id) as { source: string; season: string; k: string; e: string };
      inf.coberturasBorradas += Number(borrarCob.run(id, c.source, c.season, c.k).changes);
      borrarComp.run(id);
      inf.competicionesBorradas += 1;
      inf.edicionesBorradas += Number(borrarEdicion.run(c.e).changes);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return inf;
}

// ---------------------------------------------------------------------------
// Engarde frente a las pruebas ya publicadas (skermo_rfee, rfee_pdf, fie)
// ---------------------------------------------------------------------------

type CompEngarde = Comp & { key: string; edition_id: string };

export type ParEngarde = { e: CompEngarde; x: CompEngarde; comunes: number; menor: number };

const FUENTES_PREVIAS = ['skermo_rfee', 'rfee_pdf', 'fie'] as const;
const PREFERENCIA_DESTINO: Record<string, number> = { skermo_rfee: 0, rfee_pdf: 1, fie: 2 };

/**
 * Pares (prueba engarde, prueba de otra fuente) del mismo evento: arma, categoría y
 * formato iguales, género igual (o mixto en alguna de las dos), fecha a ±1 día y al
 * menos la mitad de los participantes de la prueba menor en común. Se comparan
 * nombres normalizados: se ejecuta antes de vincular los puestos de Engarde a
 * personas, para no crear personas de pruebas que se van a retirar. Un nombre sin
 * puesto (prueba sólo con asaltos) cuenta por sus asaltos.
 */
export function emparejarEngarde(db: DatabaseSync, umbral = 0.5): { pares: ParEngarde[]; nombres: Map<string, Set<string>> } {
  const comps = db.prepare(
    `SELECT c.id, c.source, c.season, c.weapon, c.gender, c.category, c.category_raw, c.format, c.edition_id,
            c.competition_key key, coalesce(c.competition_date, e.start_date) fecha, c.event_competition_id
       FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
      WHERE c.source IN ('engarde', ${FUENTES_PREVIAS.map((f) => `'${f}'`).join(', ')})`,
  ).all() as CompEngarde[];
  const engarde = comps.filter((c) => c.source === 'engarde' && c.fecha);
  if (engarde.length === 0) return { pares: [], nombres: new Map() };
  const clave = (c: Comp, d: number) => `${c.weapon}|${c.category}|${c.format}|${d}`;
  const previasPor = new Map<string, CompEngarde[]>();
  for (const c of comps) {
    if (c.source === 'engarde' || !c.fecha) continue;
    const k = clave(c, dia(c.fecha));
    (previasPor.get(k) ?? previasPor.set(k, []).get(k)!).push(c);
  }
  const candidatos: [CompEngarde, CompEngarde][] = [];
  for (const e of engarde) {
    for (const d of [-1, 0, 1]) {
      for (const x of previasPor.get(clave(e, dia(e.fecha!) + d)) ?? []) {
        if (e.gender !== x.gender && e.gender !== 'MIXTO' && x.gender !== 'MIXTO') continue;
        candidatos.push([e, x]);
      }
    }
  }
  if (candidatos.length === 0) return { pares: [], nombres: new Map() };

  const ids = new Set(candidatos.flatMap(([e, x]) => [e.id, x.id]));
  db.exec('DROP TABLE IF EXISTS temp._solape_engarde');
  db.exec('CREATE TEMP TABLE _solape_engarde (id TEXT PRIMARY KEY)');
  const ins = db.prepare('INSERT INTO temp._solape_engarde (id) VALUES (?)');
  for (const id of ids) ins.run(id);
  const nombres = new Map<string, Set<string>>();
  const anotar = (c: string, n: string) => {
    const norm = normalizarNombre(n);
    if (!norm) return;
    (nombres.get(c) ?? nombres.set(c, new Set()).get(c)!).add(norm);
  };
  for (const r of db.prepare(
    `SELECT competition_id c, source_name n FROM sport_result WHERE competition_id IN (SELECT id FROM temp._solape_engarde)`,
  ).iterate() as unknown as Iterable<{ c: string; n: string }>) anotar(r.c, r.n);
  for (const b of db.prepare(
    `SELECT competition_id c, fencer_a_name a, fencer_b_name b FROM sport_bout
      WHERE competition_id IN (SELECT id FROM temp._solape_engarde)
        AND competition_id NOT IN (SELECT DISTINCT competition_id FROM sport_result
                                    WHERE competition_id IN (SELECT id FROM temp._solape_engarde))`,
  ).iterate() as unknown as Iterable<{ c: string; a: string; b: string }>) {
    anotar(b.c, b.a);
    anotar(b.c, b.b);
  }
  db.exec('DROP TABLE temp._solape_engarde');

  const pares: ParEngarde[] = [];
  for (const [e, x] of candidatos) {
    const ne = nombres.get(e.id);
    const nx = nombres.get(x.id);
    if (!ne || !nx) continue;
    let comunes = 0;
    for (const n of ne) if (nx.has(n)) comunes += 1;
    const menor = Math.min(ne.size, nx.size);
    if (comunes === 0 || comunes / menor < umbral) continue;
    pares.push({ e, x, comunes, menor });
  }
  return { pares, nombres };
}

export type InformeSolapesEngarde = {
  pruebasEngarde: number;
  emparejadas: number;
  soloEngarde: number;
  pares: number;
  paresPorFuente: Record<string, number>;
  grupos: number;
  gruposConFie: number;
  /** Fases (POULE/TABLEAU) de un grupo en las que Engarde trae más asaltos y sustituye a los previos. */
  fasesSustituidas: number;
  fasesDescartadas: number;
  asaltosMovidos: number;
  asaltosEngardeBorrados: number;
  asaltosPreviosBorrados: number;
  resultadosEngardeBorrados: number;
  /** Nombres de una prueba Engarde emparejada que no aparecen en ninguna de sus pruebas previas (se pierden). */
  nombresSoloEnEngarde: number;
  competicionesBorradas: number;
  edicionesBorradas: number;
  coberturasMovidas: number;
  coberturasBorradas: number;
};

/**
 * Una prueba de Engarde que ya existe en otra fuente no aporta puestos (los de la
 * otra fuente mandan y contarlos dos veces duplicaría historial y estadísticas).
 * Por fase (poule, cuadro), si Engarde trae MÁS asaltos que todas las pruebas
 * emparejadas juntas, sus asaltos sustituyen a los previos (rfee_pdf) y pasan a
 * la prueba emparejada (skermo_rfee antes que rfee_pdf, luego la de más nombres
 * en común); si no, se descartan. Si el grupo incluye una prueba FIE no se toca
 * nada de la FIE y Engarde se descarta entera. La prueba Engarde queda vacía y
 * se borra con su cobertura.
 *
 * Idempotente: tras aplicarse no quedan pruebas engarde emparejadas; si el
 * cargador las vuelve a crear, la prueba destino ya tiene esos asaltos (no
 * menos) y Engarde se descarta.
 */
export function depurarSolapesEngarde(db: DatabaseSync, umbral = 0.5): InformeSolapesEngarde {
  const { pares, nombres } = emparejarEngarde(db, umbral);
  const total = Number((db.prepare(`SELECT count(*) n FROM sport_competition WHERE source='engarde'`).get() as { n: number }).n);
  const inf: InformeSolapesEngarde = {
    pruebasEngarde: total, emparejadas: 0, soloEngarde: 0, pares: pares.length, paresPorFuente: {}, grupos: 0,
    gruposConFie: 0, fasesSustituidas: 0, fasesDescartadas: 0, asaltosMovidos: 0, asaltosEngardeBorrados: 0,
    asaltosPreviosBorrados: 0, resultadosEngardeBorrados: 0, nombresSoloEnEngarde: 0, competicionesBorradas: 0, edicionesBorradas: 0,
    coberturasMovidas: 0, coberturasBorradas: 0,
  };
  for (const p of pares) inf.paresPorFuente[p.x.source] = (inf.paresPorFuente[p.x.source] ?? 0) + 1;
  const emparejadas = new Set(pares.map((p) => p.e.id));
  inf.emparejadas = emparejadas.size;
  inf.soloEngarde = total - emparejadas.size;
  if (pares.length === 0) return inf;

  // Grupos conexos (varias pruebas Engarde de veteranos frente a una sola PDF, etc.).
  const padre = new Map<string, string>();
  const raizDe = (id: string): string => {
    let r = id;
    while (padre.get(r) !== undefined && padre.get(r) !== r) r = padre.get(r)!;
    padre.set(id, r);
    return r;
  };
  for (const { e, x } of pares) {
    if (!padre.has(e.id)) padre.set(e.id, e.id);
    if (!padre.has(x.id)) padre.set(x.id, x.id);
    const a = raizDe(e.id);
    const b = raizDe(x.id);
    if (a !== b) padre.set(a, b);
  }
  const grupos = new Map<string, { es: Map<string, CompEngarde>; xs: Map<string, CompEngarde>; pares: ParEngarde[] }>();
  for (const p of pares) {
    const r = raizDe(p.e.id);
    const g = grupos.get(r) ?? { es: new Map(), xs: new Map(), pares: [] as ParEngarde[] };
    g.es.set(p.e.id, p.e);
    g.xs.set(p.x.id, p.x);
    g.pares.push(p);
    grupos.set(r, g);
  }
  inf.grupos = grupos.size;

  const contar = db.prepare(`SELECT count(*) n FROM sport_bout WHERE competition_id=? AND phase=?`);
  const contarFuente = db.prepare(`SELECT count(*) n FROM sport_bout WHERE competition_id=? AND phase=? AND source=?`);
  const n = (st: ReturnType<DatabaseSync['prepare']>, ...a: string[]) => Number((st.get(...a) as { n: number }).n);
  const borrarAsaltosPrevios = db.prepare(`DELETE FROM sport_bout WHERE competition_id=? AND phase=?`);
  const borrarAsaltosEngarde = db.prepare(`DELETE FROM sport_bout WHERE competition_id=? AND phase=? AND source='engarde'`);
  const mover = db.prepare(`UPDATE OR IGNORE sport_bout SET competition_id=? WHERE competition_id=? AND phase=? AND source='engarde'`);
  const kind = (fase: string) => (fase === 'POULE' ? 'pools' : 'tableau');
  const moverCobertura = db.prepare(
    `UPDATE sport_import_coverage SET competition_id=? WHERE competition_id=? AND source='engarde' AND fact_kind=?`,
  );
  const borrarCoberturaPrevia = db.prepare(
    `DELETE FROM sport_import_coverage WHERE competition_id=? AND source='rfee_pdf' AND fact_kind=?`,
  );
  const borrarResultados = db.prepare(`DELETE FROM sport_result WHERE competition_id=? AND source='engarde'`);
  const borrarCoberturas = db.prepare(`DELETE FROM sport_import_coverage WHERE competition_id=? AND source='engarde'`);
  const borrarAsaltosRestantes = db.prepare(`DELETE FROM sport_bout WHERE competition_id=?`);
  const borrarComp = db.prepare(`DELETE FROM sport_competition WHERE id=?`);
  const borrarEdicion = db.prepare(
    `DELETE FROM sport_edition WHERE id=? AND source='engarde' AND NOT EXISTS (SELECT 1 FROM sport_competition WHERE edition_id=?)`,
  );

  db.exec('BEGIN');
  try {
    for (const g of grupos.values()) {
      const conFie = [...g.xs.values()].some((x) => x.source === 'fie');
      if (conFie) inf.gruposConFie += 1;
      // Destino de cada prueba Engarde: skermo antes que PDF, luego más nombres en común.
      const destino = new Map<string, string>();
      for (const e of g.es.keys()) {
        const mejor = g.pares
          .filter((p) => p.e.id === e && p.x.source !== 'fie')
          .sort((a, b) => PREFERENCIA_DESTINO[a.x.source] - PREFERENCIA_DESTINO[b.x.source] || b.comunes - a.comunes ||
            (a.x.id < b.x.id ? -1 : 1))[0];
        if (mejor) destino.set(e, mejor.x.id);
      }
      for (const fase of ['POULE', 'TABLEAU'] as const) {
        const eN = [...g.es.keys()].reduce((s, id) => s + n(contarFuente, id, fase, 'engarde'), 0);
        if (eN === 0) continue;
        const xN = [...g.xs.keys()].reduce((s, id) => s + n(contar, id, fase), 0);
        if (!conFie && eN > xN) {
          inf.fasesSustituidas += 1;
          for (const x of g.xs.keys()) {
            inf.asaltosPreviosBorrados += Number(borrarAsaltosPrevios.run(x, fase).changes);
            inf.coberturasBorradas += Number(borrarCoberturaPrevia.run(x, kind(fase)).changes);
          }
          for (const [e, x] of destino) {
            inf.asaltosMovidos += Number(mover.run(x, e, fase).changes);
            inf.asaltosEngardeBorrados += Number(borrarAsaltosEngarde.run(e, fase).changes);
            inf.coberturasMovidas += Number(moverCobertura.run(x, e, kind(fase)).changes);
          }
          continue;
        }
        inf.fasesDescartadas += 1;
        for (const e of g.es.keys()) {
          inf.asaltosEngardeBorrados += Number(borrarAsaltosEngarde.run(e, fase).changes);
          // Si una carga anterior ya los puso en la prueba destino, la lectura sigue describiéndolos.
          const x = destino.get(e);
          if (x && n(contarFuente, x, fase, 'engarde') > 0) {
            inf.coberturasMovidas += Number(moverCobertura.run(x, e, kind(fase)).changes);
          }
        }
      }
      const enPrevias = new Set([...g.xs.keys()].flatMap((x) => [...(nombres.get(x) ?? [])]));
      for (const e of g.es.values()) {
        for (const nombre of nombres.get(e.id) ?? []) if (!enPrevias.has(nombre)) inf.nombresSoloEnEngarde += 1;
        inf.resultadosEngardeBorrados += Number(borrarResultados.run(e.id).changes);
        inf.coberturasBorradas += Number(borrarCoberturas.run(e.id).changes);
        inf.asaltosEngardeBorrados += Number(borrarAsaltosRestantes.run(e.id).changes);
        borrarComp.run(e.id);
        inf.competicionesBorradas += 1;
        inf.edicionesBorradas += Number(borrarEdicion.run(e.edition_id, e.edition_id).changes);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return inf;
}

function main(): void {
  const db = new DatabaseSync(argumento('db', NUEVO_POR_DEFECTO), { readOnly: true });
  const informe = medirSolapes(db);
  db.close();
  const salida = argumento('informe', '');
  if (salida) writeFileSync(salida, JSON.stringify(informe, null, 2));
  console.log(JSON.stringify(informe, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
