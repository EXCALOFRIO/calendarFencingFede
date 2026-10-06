/**
 * Fixtures EFC para pruebas y capturas, sin `cargar-hechos` (lo lleva otra
 * sesión): pasa unos pocos ficheros reales de `W\hechos\lote7-efc` a filas de
 * `sport_edition`, `sport_competition`, `sport_result` y `sport_bout`.
 *
 *   npx tsx tests/ui/fixture-efc.mts <base> <destino> <fichero.json>...
 *
 * Copia la base (que sólo se lee), aplica la 0013 si falta, carga los
 * ficheros con lease y añade un evento de calendario de la RFEE (el del
 * circuito con sede en castellano) y una fila de `sport_competition_combined`
 * si se pasan por entorno (`CALENDARIO_EFC=1`, `CONJUNTA=<conjunta>:<parte>`).
 * La copia se borra con `borrarCopia` de `copia-trabajo.mts`.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { componerChunk, proyeccion } from '../../scripts/indexado/sincronizar-d1';

export type HechoEfc = {
  source: 'efc';
  sourceUrl: string | null;
  edition: { season: string; tournamentKey: string; name: string; startDate: string; endDate: string; city: string | null; countryCode: string | null };
  competition: { competitionKey: string; weapon: string; gender: string; category: string; categoryRaw: string | null; format: string; date: string };
  results: { factKey: string; name: string; countryCode: string | null; club: string | null; position: number | null; positionRaw: string | null }[];
  bouts?: { phase: string; roundKey: string; aRef: string; bRef: string; aName: string; bName: string; scoreA: number; scoreB: number }[];
};

const lit = (v: string | number | null | undefined) =>
  v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`;

/**
 * Sentencias de una carga EFC. `persona(ref, nombre, pais)` da la persona de
 * cada tirador o `null`. Devuelve también los ids de edición y de prueba.
 */
export function sentenciasEfc(
  hechos: readonly HechoEfc[],
  persona: (ref: string, nombre: string, pais: string | null) => string | null = () => null,
  ahora = Date.now(),
): { sentencias: string[]; ediciones: Map<string, string>; pruebas: Map<string, string> } {
  const ediciones = new Map<string, string>();
  const pruebas = new Map<string, string>();
  const sentencias: string[] = [];
  for (const h of hechos) {
    const ed = h.edition;
    let edicionId = ediciones.get(ed.tournamentKey);
    if (!edicionId) {
      edicionId = randomUUID();
      ediciones.set(ed.tournamentKey, edicionId);
      sentencias.push(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date, end_date, city, country_code, source_url, updated_at)
        VALUES (${[edicionId, 'efc', ed.season, ed.tournamentKey, ed.name, ed.startDate, ed.endDate, ed.city, ed.countryCode, h.sourceUrl].map(lit).join(', ')}, ${ahora})`);
    }
    const c = h.competition;
    const pruebaId = randomUUID();
    pruebas.set(c.competitionKey, pruebaId);
    sentencias.push(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, category_raw, format, competition_date, source_url, updated_at)
      VALUES (${[pruebaId, edicionId, 'efc', ed.season, c.competitionKey, c.weapon, c.gender, c.category, c.categoryRaw, c.format, c.date, h.sourceUrl].map(lit).join(', ')}, ${ahora})`);
    const personas = new Map<string, string | null>();
    for (const r of h.results) {
      const p = c.format === 'INDIVIDUAL' ? persona(r.factKey, r.name, r.countryCode) : null;
      personas.set(r.factKey, p);
      sentencias.push(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, source_country_code, source_club, position, position_raw, occurred_on, source_url, content_hash, revision, first_seen_at, revised_at)
        VALUES (${[randomUUID(), pruebaId, 'efc', r.factKey, p, r.name, r.countryCode, r.club, r.position, r.positionRaw, c.date, h.sourceUrl, `efc:${r.factKey}`].map(lit).join(', ')}, 1, ${ahora}, ${ahora})`);
    }
    for (const b of h.bouts ?? []) {
      // `fencer_a_ref < fencer_b_ref` es una restricción de la tabla: se ordena el par.
      const [a, sa, na, bb, sb, nb] = b.aRef < b.bRef
        ? [b.aRef, b.scoreA, b.aName, b.bRef, b.scoreB, b.bName]
        : [b.bRef, b.scoreB, b.bName, b.aRef, b.scoreA, b.aName];
      if (a === bb) continue;
      const pa = personas.get(a) ?? null;
      const pb = personas.get(bb) ?? null;
      sentencias.push(`INSERT OR IGNORE INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_person_id, fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, occurred_on, source_url, content_hash, revision, first_seen_at, revised_at)
        VALUES (${[randomUUID(), pruebaId, 'efc', b.phase, b.roundKey, a, bb, pa, pa && pa === pb ? null : pb, na, nb, sa, sb, c.date, h.sourceUrl, `efc:${b.phase}:${b.roundKey}:${a}:${bb}`].map(lit).join(', ')}, 1, ${ahora}, ${ahora})`);
    }
  }
  return { sentencias, ediciones, pruebas };
}

/** Persona de la copia por nombre exacto plegado, sólo para fixtures de españoles. */
function personaPorNombre(db: DatabaseSync) {
  const consulta = db.prepare(`SELECT id FROM sport_person WHERE name_normalized = ? AND merged_into_person_id IS NULL
    ORDER BY (SELECT count(*) FROM sport_result r WHERE r.person_id = sport_person.id) DESC LIMIT 1`);
  const plegar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return (_ref: string, nombre: string, pais: string | null) =>
    pais === 'ESP' ? ((consulta.get(plegar(nombre)) as { id: string } | undefined)?.id ?? null) : null;
}

function conLease(db: DatabaseSync, sentencias: readonly string[]) {
  const cuerpo = sentencias.map((s) => `${s};\n`).join('');
  db.exec(componerChunk(cuerpo, { owner: randomUUID(), medidoBytes: 1, proyectadoBytes: proyeccion(cuerpo.length * 8) }));
}

if (process.argv[1]?.endsWith('fixture-efc.mts')) {
  const [base, destino, ...ficheros] = process.argv.slice(2);
  if (!base || !destino || ficheros.length === 0) throw new Error('uso: <base> <destino> <fichero.json>...');
  if (resolve(base) === resolve(destino)) throw new Error('el destino no puede ser la base');
  if (existsSync(destino)) rmSync(destino);
  copyFileSync(base, destino);
  const db = new DatabaseSync(destino);
  try {
    const hayConjuntas = db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'sport_competition_combined'`).get();
    if (!hayConjuntas) db.exec(readFileSync(new URL('../../drizzle-d1/0013_pruebas_conjuntas.sql', import.meta.url), 'utf8'));
    const hechos = ficheros.map((f) => JSON.parse(readFileSync(f, 'utf8')) as HechoEfc);
    const { sentencias, ediciones, pruebas } = sentenciasEfc(hechos, personaPorNombre(db));
    if (process.env.CONJUNTA) {
      const [conjunta, ...partes] = process.env.CONJUNTA.split(':');
      for (const parte of partes) {
        sentencias.push(`INSERT INTO sport_competition_combined (id, part_competition_id, combined_competition_id, rule, shared_names, created_at)
          VALUES (${lit(randomUUID())}, ${lit(parte)}, ${lit(conjunta)}, '${partes.length > 1 ? 'partes' : 'contenida'}', 1, ${Date.now()})`);
      }
    }
    conLease(db, sentencias);
    const enlazadas = db.prepare(`SELECT count(*) AS n FROM sport_result WHERE source = 'efc' AND person_id IS NOT NULL`).get() as { n: number };
    console.log(`${ediciones.size} ediciones, ${pruebas.size} pruebas, ${enlazadas.n} puestos con persona`);
    for (const [k, id] of pruebas) console.log(`  ${k} -> ${id}`);
  } finally {
    db.close();
  }
}
