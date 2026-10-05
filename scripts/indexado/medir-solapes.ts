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
import { argumento, NUEVO_POR_DEFECTO } from './comun';

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
    paresSinAsaltosSkermo: 0, competicionesBorradas: 0, coberturasBorradas: 0,
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
    const comp = db.prepare(`SELECT source, season, competition_key k FROM sport_competition WHERE id=?`);
    const borrarCob = db.prepare(
      `DELETE FROM sport_import_coverage WHERE competition_id=? OR (source=? AND season=? AND competition_key=?)`,
    );
    const borrarComp = db.prepare(`DELETE FROM sport_competition WHERE id=?`);
    for (const id of pdfTocadas) {
      if (Number((quedan.get(id, id) as { n: number }).n) > 0) continue;
      const c = comp.get(id) as { source: string; season: string; k: string };
      inf.coberturasBorradas += Number(borrarCob.run(id, c.source, c.season, c.k).changes);
      borrarComp.run(id);
      inf.competicionesBorradas += 1;
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
