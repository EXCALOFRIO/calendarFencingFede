/**
 * Sustituye las poules por equipos que no cuadraban con su PDF por la relectura validada de
 * `hechos/lote7-equipos-correccion/` (`lote7-equipos-correccion-pdf.ts`). Sólo en una COPIA de
 * trabajo, después de `cargar-hechos.ts` del lote 7 y antes de `unificar-personas.ts`:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-equipos-corregir.ts --db <copia.sqlite> \
 *     [--hechos <carpeta>] [--simular] [--informe <json>]
 *
 * Por cada fichero: la prueba (fuente, temporada, clave) debe existir; se borran sus asaltos de
 * fase POULE de esa fuente y se insertan los de la relectura, con la cobertura `pools` a
 * `completo`. Ninguna otra fase ni prueba se toca. Idempotente: si lo guardado ya es exactamente
 * la relectura, no se escribe nada.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { hechosPrueba, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import {
  ahora, argumento, bandera, CARPETA_TRABAJO, jsonCanonico, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia, sha256, uuid,
} from './comun';

export type InformeCorregir = {
  ficheros: number;
  sustituidas: { prueba: string; borrados: number; insertados: number }[];
  yaCorrectas: string[];
  noEncontradas: string[];
  /** Asaltos POULE de otra fuente en esas pruebas: no se tocan, se cuentan. */
  otrasFuentesIntactas: number;
  rechazados: { ruta: string; error: string }[];
};

/** Asalto con el par ordenado como lo guarda `cargar-hechos` (`fencer_a_ref < fencer_b_ref`). */
export function ordenado(b: AsaltoHecho): AsaltoHecho {
  if (b.aRef < b.bRef) return b;
  return {
    ...b, aRef: b.bRef, bRef: b.aRef, aName: b.bName, bName: b.aName, scoreA: b.scoreB, scoreB: b.scoreA,
    winner: b.winner === null ? null : b.winner === 'A' ? 'B' : 'A',
  };
}

const firma = (r: { round_key: string; fencer_a_ref: string; fencer_b_ref: string; score_a: number; score_b: number }) =>
  `${r.round_key}|${r.fencer_a_ref}|${r.fencer_b_ref}|${r.score_a}|${r.score_b}`;

export function leerCorrecciones(carpeta: string): { hechos: HechosPrueba[]; rechazados: InformeCorregir['rechazados'] } {
  const hechos: HechosPrueba[] = [];
  const rechazados: InformeCorregir['rechazados'] = [];
  if (!existsSync(carpeta)) return { hechos, rechazados };
  for (const f of readdirSync(carpeta).sort()) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const r = hechosPrueba.safeParse(JSON.parse(readFileSync(join(carpeta, f), 'utf8')));
    if (!r.success) rechazados.push({ ruta: f, error: r.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    else if (r.data.bouts.some((b) => b.phase !== 'POULE')) rechazados.push({ ruta: f, error: 'trae asaltos que no son de poule' });
    else hechos.push(r.data);
  }
  return { hechos, rechazados };
}

export function corregirPoules(db: DatabaseSync, hechos: readonly HechosPrueba[], simular = false): InformeCorregir {
  const inf: InformeCorregir = { ficheros: hechos.length, sustituidas: [], yaCorrectas: [], noEncontradas: [], otrasFuentesIntactas: 0, rechazados: [] };
  const comp = db.prepare(
    `SELECT c.id, c.competition_key, c.competition_date, e.start_date FROM sport_competition c JOIN sport_edition e ON e.id=c.edition_id
      WHERE c.source=? AND c.season=? AND c.competition_key=?`,
  );
  const guardados = db.prepare(`SELECT id, round_key, fencer_a_ref, fencer_b_ref, score_a, score_b FROM sport_bout
    WHERE competition_id=? AND source=? AND phase='POULE'`);
  const otras = db.prepare(`SELECT count(*) n FROM sport_bout WHERE competition_id=? AND source<>? AND phase='POULE'`);
  const borrar = db.prepare(`DELETE FROM sport_bout WHERE competition_id=? AND source=? AND phase='POULE'`);
  const insertar = db.prepare(
    `INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_person_id,
       fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, occurred_on, source_url, content_hash, revision,
       first_seen_at, revised_at) VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,?,1,?,?)`,
  );
  const cobertura = db.prepare(`SELECT id FROM sport_import_coverage WHERE source=? AND season=? AND fact_kind='pools' AND competition_key=?`);
  const actualizarCob = db.prepare(`UPDATE sport_import_coverage SET status='completo', imported_total=?, competition_id=?, attempts=max(attempts,1),
    last_checked_at=?, updated_at=?, last_error=NULL, source_url=coalesce(source_url, ?) WHERE id=?`);
  const insertarCob = db.prepare(`INSERT INTO sport_import_coverage (id, source, season, fact_kind, competition_key, competition_id, status,
    published_total, imported_total, attempts, source_url, last_checked_at, updated_at) VALUES (?,?,?,'pools',?,?,'completo',NULL,?,1,?,?,?)`);
  if (!simular) db.exec('BEGIN');
  try {
    for (const h of hechos) {
      const c = comp.get(h.source, h.edition.season, h.competition.competitionKey) as
        | { id: string; competition_key: string; competition_date: string | null; start_date: string | null } | undefined;
      if (!c) {
        inf.noEncontradas.push(h.competition.competitionKey);
        continue;
      }
      inf.otrasFuentesIntactas += Number((otras.get(c.id, h.source) as { n: number }).n);
      const nuevos = h.bouts.map(ordenado);
      const previos = guardados.all(c.id, h.source) as { id: string; round_key: string; fencer_a_ref: string; fencer_b_ref: string; score_a: number; score_b: number }[];
      const a = previos.map(firma).sort().join('\n');
      const b = nuevos.map((x) => firma({ round_key: x.roundKey, fencer_a_ref: x.aRef, fencer_b_ref: x.bRef, score_a: x.scoreA, score_b: x.scoreB })).sort().join('\n');
      if (a === b) {
        inf.yaCorrectas.push(c.competition_key);
        continue;
      }
      inf.sustituidas.push({ prueba: c.competition_key, borrados: previos.length, insertados: nuevos.length });
      if (simular) continue;
      borrar.run(c.id, h.source);
      const t = ahora();
      const fecha = h.competition.date ?? c.competition_date ?? c.start_date ?? h.edition.startDate;
      for (const x of nuevos) {
        const hash = sha256(jsonCanonico({ source: h.source, competitionKey: c.competition_key, fact: x }));
        insertar.run(uuid(), c.id, h.source, 'POULE', x.roundKey, x.aRef, x.bRef, x.aName, x.bName, x.scoreA, x.scoreB, fecha, h.sourceUrl, hash, t, t);
      }
      const cob = cobertura.get(h.source, h.edition.season, c.competition_key) as { id: string } | undefined;
      if (cob) actualizarCob.run(nuevos.length, c.id, t, t, h.sourceUrl, cob.id);
      else insertarCob.run(uuid(), h.source, h.edition.season, c.competition_key, c.id, nuevos.length, h.sourceUrl, t, t);
    }
    if (!simular) db.exec('COMMIT');
  } catch (e) {
    if (!simular) db.exec('ROLLBACK');
    throw e;
  }
  return inf;
}

function main(): void {
  const rutaDb = argumento('db', '');
  if (!rutaDb || !existsSync(rutaDb)) throw new Error('Uso: --db <copia de trabajo .sqlite> (obligatorio; nunca el remoto)');
  const carpeta = argumento('hechos', join(CARPETA_TRABAJO, 'hechos', 'lote7-equipos-correccion'));
  const simular = bandera('simular');
  const { hechos, rechazados } = leerCorrecciones(carpeta);
  const db = new DatabaseSync(rutaDb, simular ? { readOnly: true } : {});
  let inf: InformeCorregir;
  if (simular) inf = corregirPoules(db, hechos, true);
  else {
    prepararCopiaTrabajo(db);
    restaurarGuardia(db);
    quitarGuardia(db);
    try {
      inf = corregirPoules(db, hechos, false);
    } finally {
      restaurarGuardia(db);
    }
  }
  db.close();
  inf.rechazados = rechazados;
  const salida = argumento('informe', '');
  if (salida) writeFileSync(salida, JSON.stringify(inf, null, 2));
  console.log(JSON.stringify({ ...inf, sustituidas: inf.sustituidas.length, detalle: inf.sustituidas }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
