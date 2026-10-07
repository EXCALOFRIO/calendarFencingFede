/**
 * Aplica en una COPIA de trabajo las correcciones de cuadro de `lote12-pdf-auditar.ts`
 * (`hechos/lote12-correccion-pdf/_correcciones.json`). Mismo lugar en el lote que
 * `lote11-pdf-sustituir.ts`: después de unificar y vincular, antes de `sincronizar-d1.ts`.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote12-pdf-sustituir.ts --db <copia.sqlite> \
 *     [--correcciones <_correcciones.json>] [--simular] [--informe <json>]
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote12-pdf-sustituir.ts --ensayo <base.sqlite> [--informe <json>]
 *
 * `--ensayo` abre la base en sólo lectura, copia a memoria las pruebas afectadas (competición,
 * asaltos y cobertura) y aplica allí, con la comprobación posterior y una segunda pasada: no
 * escribe nada en disco salvo el informe. Las copias exactas de producción (`nuevo12.sqlite`...)
 * no se aceptan con `--db`.
 *
 * Por fase (una ronda del cuadro de una prueba), todo o nada; si algún asalto ya no está como lo
 * vio la auditoría, la fase se salta como `obsoleta`. Lo ya aplicado cuenta como tal (idempotente):
 *  - `marcador`: el asalto (prueba, ronda, refs) con el marcador antiguo pasa al del PDF; sube
 *    `revision` y `revised_at` para que la sincronización lo lleve a D1;
 *  - `baja`: se borra el asalto guardado con ese marcador;
 *  - `alta`: se inserta el cruce del PDF con las refs, nombres y personas que esos tiradores ya
 *    tienen en la competición, y la fecha y URL de otro asalto del mismo cuadro.
 * Cobertura `rfee_pdf` de cuadro (`tableau`):
 *  - `completo`: vuelve a `completo` la que bajaron los lotes 10-12 (motivo `loteNN:`) y, con
 *    `pdfEntero`, también la que quedó parcial en la carga; nunca toca `conflicto` ni `error`;
 *  - `parcial`: baja de `completo` con su motivo, o actualiza el motivo de los lotes 10-12.
 * Nunca toca D1.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ahora, argumento, bandera, jsonCanonico, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia, sha256, uuid } from './comun';
import { auditarCuadro } from './lote10-pdf-auditar';
import type { Correcciones11 } from './lote11-pdf-auditar';
import { copiaEnMemoria } from './lote11-pdf-sustituir';
import { CARPETA_CORRECCION_12, type Correcciones12 } from './lote12-pdf-auditar';

const BASES_PROTEGIDAS = new Set(['base.sqlite', 'remoto.sqlite', 'nuevo10.sqlite', 'nuevo11.sqlite', 'nuevo12.sqlite']);
const FUENTE = 'rfee_pdf';
const PREVIOS = /^lote1[012]:/;

export type InformeSustitucion12 = {
  fases: number;
  aplicadas: number;
  yaAplicadas: number;
  obsoletas: { prueba: string; ronda: string; motivo: string }[];
  noEncontradas: string[];
  cambios: Record<string, number>;
  cobertura: { aParcial: number; motivoActualizado: number; restaurada: number; sinCambio: number; sinCobertura: number };
};

const hashAsalto = (competitionKey: string, b: { phase: string; roundKey: string; aRef: string; bRef: string; aName: string; bName: string; scoreA: number; scoreB: number }) =>
  sha256(jsonCanonico({ source: FUENTE, competitionKey, fact: { ...b, winner: null } }));

export function aplicarCorrecciones12(db: DatabaseSync, c: Correcciones12): InformeSustitucion12 {
  const inf: InformeSustitucion12 = { fases: c.fases.length, aplicadas: 0, yaAplicadas: 0, obsoletas: [], noEncontradas: [], cambios: {},
    cobertura: { aParcial: 0, motivoActualizado: 0, restaurada: 0, sinCambio: 0, sinCobertura: 0 } };
  const comp = db.prepare(`SELECT id, competition_key k FROM sport_competition WHERE source=? AND season=? AND competition_key=?`);
  const asalto = db.prepare(`SELECT id, fencer_a_name a_name, fencer_b_name b_name, score_a sa, score_b sb FROM sport_bout
    WHERE competition_id=? AND source=? AND phase='TABLEAU' AND round_key=? AND fencer_a_ref=? AND fencer_b_ref=?`);
  // Fecha y URL de los asaltos del mismo cuadro (misma URL sin fragmento).
  const delCuadro = db.prepare(`SELECT occurred_on, source_url FROM sport_bout WHERE competition_id=? AND source=? AND phase='TABLEAU'
    AND (source_url=? OR source_url LIKE ? ESCAPE '\\') ORDER BY round_key, id LIMIT 1`);
  const actualizar = db.prepare(`UPDATE sport_bout SET score_a=?, score_b=?, content_hash=?, revision=revision+1, revised_at=? WHERE id=?`);
  const insertar = db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_person_id,
      fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, occurred_on, source_url, content_hash, revision, first_seen_at, revised_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`);
  const borrar = db.prepare(`DELETE FROM sport_bout WHERE id=?`);
  const t = ahora();
  type Fila = { id: string; a_name: string; b_name: string; sa: number; sb: number };

  for (const f of c.fases) {
    const p = comp.get(f.competicion.source, f.competicion.season, f.competicion.competitionKey) as { id: string; k: string } | undefined;
    if (!p) { inf.noEncontradas.push(`${f.competicion.competitionKey} ${f.fase} ${f.ronda}`); continue; }
    const fila = (a: string, b: string) => asalto.get(p.id, FUENTE, f.ronda, a, b) as Fila | undefined;
    const like = `${f.url.replace(/[\\%_]/g, (m) => `\\${m}`)}#%`;
    const ref = delCuadro.get(p.id, FUENTE, f.url, like) as { occurred_on: string | null; source_url: string | null } | undefined;
    let pendientes = 0;
    let motivo: string | null = null;
    for (const x of f.cambios) {
      const g = fila(x.aRef, x.bRef);
      if (x.tipo === 'marcador') {
        if (g && g.sa === x.antes[0] && g.sb === x.antes[1]) pendientes += 1;
        else if (!(g && g.sa === x.despues[0] && g.sb === x.despues[1])) motivo ??= g ? `marcador_cambiado:${g.sa}-${g.sb}` : 'asalto_desaparecido';
      } else if (x.tipo === 'baja') {
        if (g && g.sa === x.antes[0] && g.sb === x.antes[1]) pendientes += 1;
        else if (g) motivo ??= `baja_cambiada:${g.sa}-${g.sb}`;
      } else if (!g) {
        if (!(x.aRef < x.bRef)) motivo ??= 'alta_sin_orden_canonico';
        else if (!ref) motivo ??= 'cuadro_sin_asaltos_de_referencia';
        else pendientes += 1;
      } else if (!(g.sa === x.despues[0] && g.sb === x.despues[1])) motivo ??= `alta_ya_existe:${g.sa}-${g.sb}`;
    }
    if (motivo) { inf.obsoletas.push({ prueba: f.competicion.competitionKey, ronda: f.ronda, motivo }); continue; }
    if (pendientes === 0) { inf.yaAplicadas += 1; continue; }
    // Bajas antes que altas: una sustitución libera al tirador en la ronda.
    const orden = [...f.cambios].sort((a, b) => Number(a.tipo === 'alta') - Number(b.tipo === 'alta'));
    for (const x of orden) {
      const g = fila(x.aRef, x.bRef);
      if (x.tipo === 'marcador' && g && g.sa === x.antes[0] && g.sb === x.antes[1]) {
        actualizar.run(x.despues[0], x.despues[1], hashAsalto(p.k, { phase: 'TABLEAU', roundKey: f.ronda, aRef: x.aRef, bRef: x.bRef,
          aName: g.a_name, bName: g.b_name, scoreA: x.despues[0], scoreB: x.despues[1] }), t, g.id);
      } else if (x.tipo === 'baja' && g && g.sa === x.antes[0] && g.sb === x.antes[1]) borrar.run(g.id);
      else if (x.tipo === 'alta' && !g && ref) {
        insertar.run(uuid(), p.id, FUENTE, 'TABLEAU', f.ronda, x.aRef, x.bRef, x.aPersona, x.bPersona, x.aNombre, x.bNombre, x.despues[0], x.despues[1],
          ref.occurred_on, ref.source_url, hashAsalto(p.k, { phase: 'TABLEAU', roundKey: f.ronda, aRef: x.aRef, bRef: x.bRef, aName: x.aNombre,
            bName: x.bNombre, scoreA: x.despues[0], scoreB: x.despues[1] }), t, t);
      } else continue;
      inf.cambios[`TABLEAU:${x.tipo}`] = (inf.cambios[`TABLEAU:${x.tipo}`] ?? 0) + 1;
    }
    inf.aplicadas += 1;
  }

  const cobertura = db.prepare(`SELECT id, status, last_error FROM sport_import_coverage WHERE source=? AND fact_kind=? AND competition_id=?`);
  const poner = db.prepare(`UPDATE sport_import_coverage SET status=?, last_error=?, updated_at=? WHERE id=?`);
  for (const a of c.cobertura ?? []) {
    const p = comp.get(a.competicion.source, a.competicion.season, a.competicion.competitionKey) as { id: string } | undefined;
    const filas = p ? (cobertura.all(FUENTE, a.kind, p.id) as { id: string; status: string; last_error: string | null }[]) : [];
    if (filas.length === 0) { inf.cobertura.sinCobertura += 1; continue; }
    for (const r of filas) {
      const deLotes = r.status === 'parcial' && PREVIOS.test(r.last_error ?? '');
      if (a.estado === 'parcial' && r.status === 'completo') { poner.run('parcial', a.motivo, t, r.id); inf.cobertura.aParcial += 1; }
      else if (a.estado === 'parcial' && deLotes && r.last_error !== a.motivo) { poner.run('parcial', a.motivo, t, r.id); inf.cobertura.motivoActualizado += 1; }
      else if (a.estado === 'completo' && r.status === 'parcial' && (deLotes || a.pdfEntero === true)) { poner.run('completo', null, t, r.id); inf.cobertura.restaurada += 1; }
      else inf.cobertura.sinCambio += 1;
    }
  }
  return inf;
}

/** Cuadros tocados: incoherencias internas (sin clasificación) tras aplicar, por prueba. */
export function comprobarCuadros(db: DatabaseSync, c: Correcciones12): { cuadros: number; incoherentes: { prueba: string; asaltos: number; problemas: unknown }[] } {
  const comp = db.prepare(`SELECT id FROM sport_competition WHERE source=? AND season=? AND competition_key=?`);
  const q = db.prepare(`SELECT round_key ronda, fencer_a_ref aRef, fencer_b_ref bRef, score_a sa, score_b sb FROM sport_bout
    WHERE competition_id=? AND source=? AND phase='TABLEAU' AND (source_url=? OR source_url LIKE ?)`);
  const vistos = new Set<string>();
  const incoherentes: { prueba: string; asaltos: number; problemas: unknown }[] = [];
  for (const f of c.fases) {
    const p = comp.get(f.competicion.source, f.competicion.season, f.competicion.competitionKey) as { id: string } | undefined;
    if (!p || vistos.has(`${p.id}|${f.url}`)) continue;
    vistos.add(`${p.id}|${f.url}`);
    const bs = q.all(p.id, FUENTE, f.url, `${f.url}#%`) as { ronda: string; aRef: string; bRef: string; sa: number; sb: number }[];
    for (const fam of ['A', 'B']) {
      const g = bs.filter((b) => (fam === 'B') === b.ronda.startsWith('B')).map((b) => ({ ...b, ronda: fam === 'B' ? `A${b.ronda.slice(1)}` : b.ronda }));
      if (g.length === 0) continue;
      const a = auditarCuadro(g, () => undefined);
      if (a.incoherentes.size > 0) incoherentes.push({ prueba: f.competicion.competitionKey, asaltos: a.incoherentes.size, problemas: a.problemas });
    }
  }
  return { cuadros: vistos.size, incoherentes };
}

function main(): void {
  const c = JSON.parse(readFileSync(argumento('correcciones', join(CARPETA_CORRECCION_12, '_correcciones.json')), 'utf8')) as Correcciones12;
  const salida = argumento('informe', '');
  const ensayo = argumento('ensayo', '');
  if (ensayo) {
    if (!existsSync(ensayo)) throw new Error(`No existe ${ensayo}`);
    const db = copiaEnMemoria(ensayo, c as unknown as Correcciones11);
    const contar = () => (db.prepare(`SELECT count(*) n FROM sport_bout`).get() as { n: number }).n;
    const antes = contar();
    const previa = comprobarCuadros(db, c);
    db.exec('BEGIN');
    const inf = aplicarCorrecciones12(db, c);
    db.exec('COMMIT');
    const despues = contar();
    const comprobacion = comprobarCuadros(db, c);
    const otra = aplicarCorrecciones12(db, c);
    db.close();
    const r = { ensayo, asaltos: { antes, despues }, ...inf, comprobacion: { antes: previa, despues: comprobacion },
      segundaPasada: { aplicadas: otra.aplicadas, yaAplicadas: otra.yaAplicadas, obsoletas: otra.obsoletas.length, cobertura: otra.cobertura } };
    if (salida) writeFileSync(salida, JSON.stringify(r, null, 2));
    console.log(JSON.stringify({ ...r, obsoletas: r.obsoletas.slice(0, 20) }, null, 2));
    console.log('(ensayo en memoria: nada guardado)');
    return;
  }
  const rutaDb = argumento('db', '');
  if (!rutaDb || !existsSync(rutaDb)) throw new Error('Uso: --db <copia de trabajo .sqlite> (obligatorio; nunca el remoto) o --ensayo <base.sqlite>');
  const simular = bandera('simular');
  // También en simulación: retirar y reponer la guardia ya escribe en la base.
  if (BASES_PROTEGIDAS.has(basename(rutaDb).toLowerCase())) throw new Error(`${basename(rutaDb)} es de sólo lectura (usa --ensayo)`);
  const db = new DatabaseSync(rutaDb);
  let inf: InformeSustitucion12;
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  try {
    db.exec('BEGIN');
    try {
      inf = aplicarCorrecciones12(db, c);
      db.exec(simular ? 'ROLLBACK' : 'COMMIT');
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    restaurarGuardia(db);
    db.close();
  }
  if (salida) writeFileSync(salida, JSON.stringify(inf, null, 2));
  console.log(JSON.stringify({ ...inf, obsoletas: inf.obsoletas.slice(0, 20), totalObsoletas: inf.obsoletas.length, noEncontradas: inf.noEncontradas.slice(0, 20) }, null, 2));
  if (simular) console.log('(simulación: nada guardado)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
