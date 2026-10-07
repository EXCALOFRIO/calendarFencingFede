/**
 * Aplica en una COPIA de trabajo las correcciones de `lote10-pdf-auditar.ts`
 * (`hechos/lote10-correccion-pdf/_correcciones.json`): asaltos `rfee_pdf` releídos del PDF con
 * una matriz de poule completa y cuadrada, o con el cuadro del lector coherente. Va al final del
 * lote, después de `unificar-personas.ts` y `vincular-asaltos.ts` (los asaltos ya están en su
 * prueba definitiva, a veces la de Skermo) y antes de `sincronizar-d1.ts`:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-pdf-sustituir.ts --db <copia.sqlite> \
 *     [--correcciones <_correcciones.json>] [--simular] [--informe <json>]
 *
 * Por fase (una poule, o una ronda del cuadro), todo o nada:
 *  - `marcador`: el asalto con esa clave (prueba, fase, ronda, refs) y el marcador antiguo pasa al
 *    del PDF; sube `revision` y `revised_at` para que la sincronización lo lleve a D1;
 *  - `alta`: el asalto que la lectura antigua perdió, con las refs, nombres, personas, fecha y URL
 *    que esos dos tiradores ya tienen en la misma poule;
 *  - `baja`: el asalto guardado que el PDF no publica.
 * Si algún asalto ya no está como lo vio la auditoría (la carga lo cambió), la fase entera se salta
 * y se lista como `obsoleta`: hay que volver a auditar. Lo ya aplicado cuenta como tal (idempotente).
 * `parciales`: la cobertura `rfee_pdf` de esas fases (pools/tableau) baja de `completo` a `parcial`,
 * con el motivo en `last_error`. Nunca toca D1.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ahora, argumento, bandera, jsonCanonico, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia, sha256, uuid } from './comun';
import { CARPETA_CORRECCION, type CorreccionFase, type Parcial } from './lote10-pdf-auditar';

const BASES_PROTEGIDAS = new Set(['base.sqlite', 'remoto.sqlite', 'nuevo10.sqlite']);
const FUENTE = 'rfee_pdf';

export type Correcciones = { generado: string; base: string; fases: CorreccionFase[]; parciales: Parcial[] };

export type InformeSustitucion = {
  fases: number;
  aplicadas: number;
  yaAplicadas: number;
  obsoletas: { prueba: string; fase: string; ronda: string; motivo: string }[];
  noEncontradas: string[];
  cambios: Record<string, number>;
  parciales: { marcadas: number; yaParciales: number; sinCobertura: number };
};

type Fila = { id: string; a_name: string; b_name: string; sa: number; sb: number; ap: string | null; bp: string | null; occurred_on: string | null; source_url: string | null };

const hashAsalto = (competitionKey: string, b: { phase: string; roundKey: string; aRef: string; bRef: string; aName: string; bName: string; scoreA: number; scoreB: number }) =>
  sha256(jsonCanonico({ source: FUENTE, competitionKey, fact: { ...b, winner: null } }));

export function aplicarCorrecciones(db: DatabaseSync, c: Correcciones): InformeSustitucion {
  const inf: InformeSustitucion = { fases: c.fases.length, aplicadas: 0, yaAplicadas: 0, obsoletas: [], noEncontradas: [], cambios: {},
    parciales: { marcadas: 0, yaParciales: 0, sinCobertura: 0 } };
  const comp = db.prepare(`SELECT id, competition_key k FROM sport_competition WHERE source=? AND season=? AND competition_key=?`);
  const asalto = db.prepare(`SELECT id, fencer_a_name a_name, fencer_b_name b_name, score_a sa, score_b sb, fencer_a_person_id ap, fencer_b_person_id bp,
      occurred_on, source_url FROM sport_bout WHERE competition_id=? AND source=? AND phase=? AND round_key=? AND fencer_a_ref=? AND fencer_b_ref=?`);
  const ladoDe = db.prepare(`SELECT CASE WHEN fencer_a_ref=? THEN fencer_a_name ELSE fencer_b_name END n,
      CASE WHEN fencer_a_ref=? THEN fencer_a_person_id ELSE fencer_b_person_id END p, occurred_on, source_url
    FROM sport_bout WHERE competition_id=? AND source=? AND phase=? AND round_key=? AND (fencer_a_ref=? OR fencer_b_ref=?) LIMIT 1`);
  const actualizar = db.prepare(`UPDATE sport_bout SET score_a=?, score_b=?, content_hash=?, revision=revision+1, revised_at=? WHERE id=?`);
  const insertar = db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_person_id,
      fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, occurred_on, source_url, content_hash, revision, first_seen_at, revised_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`);
  const borrar = db.prepare(`DELETE FROM sport_bout WHERE id=?`);
  const t = ahora();

  for (const f of c.fases) {
    const p = comp.get(f.competicion.source, f.competicion.season, f.competicion.competitionKey) as { id: string; k: string } | undefined;
    if (!p) { inf.noEncontradas.push(`${f.competicion.competitionKey} ${f.fase} ${f.ronda}`); continue; }
    const fila = (a: string, b: string) => asalto.get(p.id, FUENTE, f.fase, f.ronda, a, b) as Fila | undefined;
    // Comprobación previa: todo como lo vio la auditoría o todo ya aplicado.
    let pendientes = 0;
    let hechas = 0;
    let motivo: string | null = null;
    for (const x of f.cambios) {
      const g = fila(x.aRef, x.bRef);
      if (x.tipo === 'marcador') {
        if (g && g.sa === x.antes[0] && g.sb === x.antes[1]) pendientes += 1;
        else if (g && g.sa === x.despues[0] && g.sb === x.despues[1]) hechas += 1;
        else motivo ??= g ? `marcador_cambiado:${g.sa}-${g.sb}` : 'asalto_desaparecido';
      } else if (x.tipo === 'alta') {
        if (!g) {
          const ra = ladoDe.get(x.aRef, x.aRef, p.id, FUENTE, f.fase, f.ronda, x.aRef, x.aRef);
          const rb = ladoDe.get(x.bRef, x.bRef, p.id, FUENTE, f.fase, f.ronda, x.bRef, x.bRef);
          if (ra && rb) pendientes += 1;
          else motivo ??= 'tirador_sin_asaltos_en_la_poule';
        } else if (g.sa === x.despues[0] && g.sb === x.despues[1]) hechas += 1;
        else motivo ??= `alta_ya_existe:${g.sa}-${g.sb}`;
      } else {
        if (g && g.sa === x.antes[0] && g.sb === x.antes[1]) pendientes += 1;
        else if (!g) hechas += 1;
        else motivo ??= `baja_cambiada:${g.sa}-${g.sb}`;
      }
    }
    if (motivo) { inf.obsoletas.push({ prueba: f.competicion.competitionKey, fase: f.fase, ronda: f.ronda, motivo }); continue; }
    if (pendientes === 0) { inf.yaAplicadas += 1; continue; }
    for (const x of f.cambios) {
      const g = fila(x.aRef, x.bRef);
      if (x.tipo === 'marcador' && g && g.sa === x.antes[0] && g.sb === x.antes[1]) {
        actualizar.run(x.despues[0], x.despues[1], hashAsalto(p.k, { phase: f.fase, roundKey: f.ronda, aRef: x.aRef, bRef: x.bRef, aName: g.a_name, bName: g.b_name,
          scoreA: x.despues[0], scoreB: x.despues[1] }), t, g.id);
      } else if (x.tipo === 'alta' && !g) {
        const ra = ladoDe.get(x.aRef, x.aRef, p.id, FUENTE, f.fase, f.ronda, x.aRef, x.aRef) as { n: string; p: string | null; occurred_on: string | null; source_url: string | null };
        const rb = ladoDe.get(x.bRef, x.bRef, p.id, FUENTE, f.fase, f.ronda, x.bRef, x.bRef) as { n: string; p: string | null };
        const pb = rb.p !== null && rb.p === ra.p ? null : rb.p;
        insertar.run(uuid(), p.id, FUENTE, f.fase, f.ronda, x.aRef, x.bRef, ra.p, pb, ra.n, rb.n, x.despues[0], x.despues[1], ra.occurred_on, ra.source_url,
          hashAsalto(p.k, { phase: f.fase, roundKey: f.ronda, aRef: x.aRef, bRef: x.bRef, aName: ra.n, bName: rb.n, scoreA: x.despues[0], scoreB: x.despues[1] }), t, t);
      } else if (x.tipo === 'baja' && g && g.sa === x.antes[0] && g.sb === x.antes[1]) borrar.run(g.id);
      else continue;
      inf.cambios[`${f.fase}:${x.tipo}`] = (inf.cambios[`${f.fase}:${x.tipo}`] ?? 0) + 1;
    }
    inf.aplicadas += 1;
  }

  const cobertura = db.prepare(`SELECT id, status FROM sport_import_coverage WHERE source=? AND fact_kind=? AND competition_id=?`);
  const bajar = db.prepare(`UPDATE sport_import_coverage SET status='parcial', last_error=?, updated_at=? WHERE id=?`);
  for (const x of c.parciales ?? []) {
    const p = comp.get(x.competicion.source, x.competicion.season, x.competicion.competitionKey) as { id: string } | undefined;
    const filas = p ? (cobertura.all(FUENTE, x.kind, p.id) as { id: string; status: string }[]) : [];
    if (filas.length === 0) { inf.parciales.sinCobertura += 1; continue; }
    for (const r of filas) {
      if (r.status !== 'completo') { inf.parciales.yaParciales += 1; continue; }
      bajar.run(`lote10: relectura del PDF sin evidencia completa (${x.detalle.slice(0, 12).join(', ')})`.slice(0, 500), t, r.id);
      inf.parciales.marcadas += 1;
    }
  }
  return inf;
}

function main(): void {
  const rutaDb = argumento('db', '');
  if (!rutaDb || !existsSync(rutaDb)) throw new Error('Uso: --db <copia de trabajo .sqlite> (obligatorio; nunca el remoto)');
  const simular = bandera('simular');
  // También en simulación: retirar y reponer la guardia ya escribe en la base.
  if (BASES_PROTEGIDAS.has(basename(rutaDb).toLowerCase())) throw new Error(`${basename(rutaDb)} es de sólo lectura`);
  const c = JSON.parse(readFileSync(argumento('correcciones', join(CARPETA_CORRECCION, '_correcciones.json')), 'utf8')) as Correcciones;
  const db = new DatabaseSync(rutaDb);
  let inf: InformeSustitucion;
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  try {
    db.exec('BEGIN');
    try {
      inf = aplicarCorrecciones(db, c);
      db.exec(simular ? 'ROLLBACK' : 'COMMIT');
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    restaurarGuardia(db);
    db.close();
  }
  const salida = argumento('informe', '');
  if (salida) writeFileSync(salida, JSON.stringify(inf, null, 2));
  console.log(JSON.stringify({ ...inf, obsoletas: inf.obsoletas.slice(0, 20), totalObsoletas: inf.obsoletas.length, noEncontradas: inf.noEncontradas.slice(0, 20) }, null, 2));
  if (simular) console.log('(simulación: nada guardado)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
