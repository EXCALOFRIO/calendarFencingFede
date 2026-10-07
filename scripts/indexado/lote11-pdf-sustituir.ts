/**
 * Aplica en una COPIA de trabajo las correcciones de `lote11-pdf-auditar.ts`
 * (`hechos/lote11-correccion-pdf/_correcciones.json`). Mismo lugar en el lote que
 * `lote10-pdf-sustituir.ts`: después de unificar y vincular, antes de `sincronizar-d1.ts`.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote11-pdf-sustituir.ts --db <copia.sqlite> \
 *     [--correcciones <_correcciones.json>] [--simular] [--informe <json>]
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote11-pdf-sustituir.ts --ensayo <base.sqlite> [--informe <json>]
 *
 * `--ensayo` abre la base en sólo lectura, copia a memoria las pruebas afectadas (competición,
 * asaltos y cobertura) y aplica allí, con la comprobación posterior: no escribe nada en disco
 * salvo el informe.
 *
 * Por fase, todo o nada:
 *  - `marcador`, `alta`, `baja`: como en el lote 10 (`aplicarCorrecciones`);
 *  - `traslado`: el asalto guardado en la ronda `desde` (una poule de la primera vuelta que
 *    reunía la de otra vuelta) pasa a la ronda de la fase con el marcador del PDF; mismo `id`,
 *    sube `revision` y `revised_at`. Va antes que las altas de la fase, que necesitan a sus
 *    tiradores ya en la ronda.
 * Cobertura `rfee_pdf` (pools/tableau) de cada prueba:
 *  - `parcial`: baja de `completo` con su motivo; si ya era parcial por el lote 10, sólo
 *    actualiza el motivo; otra causa de parcial no se toca;
 *  - `completo`: vuelve a `completo` sólo la que bajó el lote 10 (motivo `lote10:`) y ya no
 *    tiene nada pendiente.
 * Nunca toca D1.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ahora, argumento, bandera, jsonCanonico, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia, sha256 } from './comun';
import { auditarPoule } from './lote10-pdf-auditar';
import { aplicarCorrecciones, type InformeSustitucion } from './lote10-pdf-sustituir';
import { CARPETA_CORRECCION_11, type CambioTraslado, type Correcciones11, type CorreccionFase11 } from './lote11-pdf-auditar';

const BASES_PROTEGIDAS = new Set(['base.sqlite', 'remoto.sqlite', 'nuevo10.sqlite', 'nuevo11.sqlite']);
const FUENTE = 'rfee_pdf';
const PREVIO = 'lote10:';

export type InformeSustitucion11 = InformeSustitucion & {
  cobertura: { aParcial: number; motivoActualizado: number; restaurada: number; sinCambio: number; sinCobertura: number };
};

const hashAsalto = (competitionKey: string, b: { phase: string; roundKey: string; aRef: string; bRef: string; aName: string; bName: string; scoreA: number; scoreB: number }) =>
  sha256(jsonCanonico({ source: FUENTE, competitionKey, fact: { ...b, winner: null } }));

const sumar = (a: Record<string, number>, b: Record<string, number>) => {
  for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v;
};

export function aplicarCorrecciones11(db: DatabaseSync, c: Correcciones11): InformeSustitucion11 {
  const inf: InformeSustitucion11 = { fases: c.fases.length, aplicadas: 0, yaAplicadas: 0, obsoletas: [], noEncontradas: [], cambios: {},
    parciales: { marcadas: 0, yaParciales: 0, sinCobertura: 0 },
    cobertura: { aParcial: 0, motivoActualizado: 0, restaurada: 0, sinCambio: 0, sinCobertura: 0 } };
  const comp = db.prepare(`SELECT id, competition_key k FROM sport_competition WHERE source=? AND season=? AND competition_key=?`);
  const asalto = db.prepare(`SELECT id, fencer_a_name a_name, fencer_b_name b_name, score_a sa, score_b sb FROM sport_bout
    WHERE competition_id=? AND source=? AND phase='POULE' AND round_key=? AND fencer_a_ref=? AND fencer_b_ref=?`);
  const trasladar = db.prepare(`UPDATE sport_bout SET round_key=?, score_a=?, score_b=?, content_hash=?, revision=revision+1, revised_at=? WHERE id=?`);
  const t = ahora();

  for (const f of c.fases) {
    const traslados = f.cambios.filter((x): x is CambioTraslado => x.tipo === 'traslado');
    const resto = { ...f, cambios: f.cambios.filter((x) => x.tipo !== 'traslado') } as Parameters<typeof aplicarCorrecciones>[1]['fases'][number];
    if (traslados.length === 0) {
      const r = aplicarCorrecciones(db, { generado: '', base: '', fases: [resto], parciales: [] });
      inf.aplicadas += r.aplicadas;
      inf.yaAplicadas += r.yaAplicadas;
      inf.obsoletas.push(...r.obsoletas);
      inf.noEncontradas.push(...r.noEncontradas);
      sumar(inf.cambios, r.cambios);
      continue;
    }
    const p = comp.get(f.competicion.source, f.competicion.season, f.competicion.competitionKey) as { id: string; k: string } | undefined;
    if (!p) { inf.noEncontradas.push(`${f.competicion.competitionKey} ${f.fase} ${f.ronda}`); continue; }
    type Fila = { id: string; a_name: string; b_name: string; sa: number; sb: number };
    let pendientes = 0;
    let motivo: string | null = null;
    for (const x of traslados) {
      const origen = asalto.get(p.id, FUENTE, x.desde, x.aRef, x.bRef) as Fila | undefined;
      const destino = asalto.get(p.id, FUENTE, f.ronda, x.aRef, x.bRef) as Fila | undefined;
      if (origen && !destino && origen.sa === x.antes[0] && origen.sb === x.antes[1]) pendientes += 1;
      else if (!origen && destino && destino.sa === x.despues[0] && destino.sb === x.despues[1]) continue;
      else motivo ??= destino ? 'destino_ocupado' : origen ? `marcador_cambiado:${origen.sa}-${origen.sb}` : 'asalto_desaparecido';
    }
    if (motivo) { inf.obsoletas.push({ prueba: f.competicion.competitionKey, fase: f.fase, ronda: f.ronda, motivo }); continue; }
    db.exec('SAVEPOINT traslado');
    const hechos: Record<string, number> = {};
    for (const x of traslados) {
      const origen = asalto.get(p.id, FUENTE, x.desde, x.aRef, x.bRef) as Fila | undefined;
      if (!origen) continue;
      trasladar.run(f.ronda, x.despues[0], x.despues[1], hashAsalto(p.k, { phase: 'POULE', roundKey: f.ronda, aRef: x.aRef, bRef: x.bRef,
        aName: origen.a_name, bName: origen.b_name, scoreA: x.despues[0], scoreB: x.despues[1] }), t, origen.id);
      hechos['POULE:traslado'] = (hechos['POULE:traslado'] ?? 0) + 1;
    }
    const r = resto.cambios.length > 0 ? aplicarCorrecciones(db, { generado: '', base: '', fases: [resto], parciales: [] }) : null;
    if (r && (r.obsoletas.length > 0 || r.noEncontradas.length > 0)) {
      db.exec('ROLLBACK TO traslado');
      db.exec('RELEASE traslado');
      inf.obsoletas.push(...(r.obsoletas.length ? r.obsoletas : [{ prueba: f.competicion.competitionKey, fase: f.fase, ronda: f.ronda, motivo: 'no_encontrada' }]));
      continue;
    }
    db.exec('RELEASE traslado');
    if (r) sumar(hechos, r.cambios);
    sumar(inf.cambios, hechos);
    if (pendientes > 0 || (r?.aplicadas ?? 0) > 0) inf.aplicadas += 1;
    else inf.yaAplicadas += 1;
  }

  const cobertura = db.prepare(`SELECT id, status, last_error FROM sport_import_coverage WHERE source=? AND fact_kind=? AND competition_id=?`);
  const poner = db.prepare(`UPDATE sport_import_coverage SET status=?, last_error=?, updated_at=? WHERE id=?`);
  for (const a of c.cobertura ?? []) {
    const p = comp.get(a.competicion.source, a.competicion.season, a.competicion.competitionKey) as { id: string } | undefined;
    const filas = p ? (cobertura.all(FUENTE, a.kind, p.id) as { id: string; status: string; last_error: string | null }[]) : [];
    if (filas.length === 0) { inf.cobertura.sinCobertura += 1; continue; }
    for (const r of filas) {
      const delPrevio = r.status === 'parcial' && (r.last_error ?? '').startsWith(PREVIO);
      if (a.estado === 'parcial' && r.status === 'completo') { poner.run('parcial', a.motivo, t, r.id); inf.cobertura.aParcial += 1; }
      else if (a.estado === 'parcial' && delPrevio && r.last_error !== a.motivo) { poner.run('parcial', a.motivo, t, r.id); inf.cobertura.motivoActualizado += 1; }
      else if (a.estado === 'completo' && delPrevio) { poner.run('completo', null, t, r.id); inf.cobertura.restaurada += 1; }
      else inf.cobertura.sinCambio += 1;
    }
  }
  return inf;
}

/** Poules tocadas por las fases que, tras aplicar, no quedan todos contra todos y sin empates. */
export function comprobarPoules(db: DatabaseSync, fases: readonly CorreccionFase11[]): { poules: number; malas: { prueba: string; ronda: string; problemas: unknown }[] } {
  const comp = db.prepare(`SELECT id FROM sport_competition WHERE source=? AND season=? AND competition_key=?`);
  const ronda = db.prepare(`SELECT fencer_a_ref aRef, fencer_b_ref bRef, score_a sa, score_b sb FROM sport_bout
    WHERE competition_id=? AND source=? AND phase='POULE' AND round_key=?`);
  const vistas = new Set<string>();
  const malas: { prueba: string; ronda: string; problemas: unknown }[] = [];
  for (const f of fases.filter((x) => x.fase === 'POULE')) {
    const p = comp.get(f.competicion.source, f.competicion.season, f.competicion.competitionKey) as { id: string } | undefined;
    if (!p) continue;
    const rondas = [f.ronda, ...f.cambios.flatMap((x) => (x.tipo === 'traslado' ? [x.desde] : []))];
    for (const r of rondas) {
      const k = `${p.id}|${r}`;
      if (vistas.has(k)) continue;
      vistas.add(k);
      const a = auditarPoule(ronda.all(p.id, FUENTE, r) as { aRef: string; bRef: string; sa: number; sb: number }[], Number.POSITIVE_INFINITY);
      const problemas = Object.fromEntries(Object.entries(a.problemas).filter(([x]) => x !== 'ganador_sobre_tope'));
      if (Object.keys(problemas).length > 0) malas.push({ prueba: f.competicion.competitionKey, ronda: r, problemas });
    }
  }
  return { poules: vistas.size, malas };
}

const TABLAS = ['sport_competition', 'sport_bout', 'sport_import_coverage'] as const;

/** Copia en memoria de las pruebas que tocan las correcciones, con el esquema de la base (sin disparadores). */
export function copiaEnMemoria(rutaDb: string, c: Correcciones11): DatabaseSync {
  const src = new DatabaseSync(rutaDb, { readOnly: true });
  const mem = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  try {
    for (const t of TABLAS) {
      for (const { sql } of src.prepare(`SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('table','index') AND sql IS NOT NULL ORDER BY type DESC`).all(t) as { sql: string }[]) mem.exec(sql);
    }
    const claves = [...new Map([...c.fases.map((f) => f.competicion), ...c.cobertura.map((x) => x.competicion)]
      .map((x) => [`${x.source}|${x.season}|${x.competitionKey}`, x])).values()];
    const ids: string[] = [];
    const buscar = src.prepare(`SELECT * FROM sport_competition WHERE source=? AND season=? AND competition_key=?`);
    const copiar = (t: string, filas: Record<string, unknown>[]) => {
      if (filas.length === 0) return;
      const cols = Object.keys(filas[0]);
      const ins = mem.prepare(`INSERT INTO ${t} (${cols.map((x) => `"${x}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const f of filas) ins.run(...(cols.map((x) => f[x]) as never[]));
    };
    for (const k of claves) {
      const filas = buscar.all(k.source, k.season, k.competitionKey) as Record<string, unknown>[];
      copiar('sport_competition', filas);
      ids.push(...filas.map((f) => String(f.id)));
    }
    const porComp = (t: string) => src.prepare(`SELECT * FROM ${t} WHERE competition_id=?`);
    const b = porComp('sport_bout');
    const cov = porComp('sport_import_coverage');
    for (const id of ids) {
      copiar('sport_bout', b.all(id) as Record<string, unknown>[]);
      copiar('sport_import_coverage', cov.all(id) as Record<string, unknown>[]);
    }
  } finally {
    src.close();
  }
  return mem;
}

function main(): void {
  const c = JSON.parse(readFileSync(argumento('correcciones', join(CARPETA_CORRECCION_11, '_correcciones.json')), 'utf8')) as Correcciones11;
  const salida = argumento('informe', '');
  const ensayo = argumento('ensayo', '');
  if (ensayo) {
    if (!existsSync(ensayo)) throw new Error(`No existe ${ensayo}`);
    const db = copiaEnMemoria(ensayo, c);
    const antes = (db.prepare(`SELECT count(*) n FROM sport_bout`).get() as { n: number }).n;
    db.exec('BEGIN');
    const inf = aplicarCorrecciones11(db, c);
    db.exec('COMMIT');
    const despues = (db.prepare(`SELECT count(*) n FROM sport_bout`).get() as { n: number }).n;
    const comprobacion = comprobarPoules(db, c.fases);
    const otra = aplicarCorrecciones11(db, c);
    db.close();
    const r = { ensayo: ensayo, asaltos: { antes, despues }, ...inf, comprobacion, segundaPasada: { aplicadas: otra.aplicadas, yaAplicadas: otra.yaAplicadas, obsoletas: otra.obsoletas.length } };
    if (salida) writeFileSync(salida, JSON.stringify(r, null, 2));
    console.log(JSON.stringify({ ...r, obsoletas: r.obsoletas.slice(0, 20), comprobacion: { poules: comprobacion.poules, malas: comprobacion.malas.slice(0, 20) } }, null, 2));
    console.log('(ensayo en memoria: nada guardado)');
    return;
  }
  const rutaDb = argumento('db', '');
  if (!rutaDb || !existsSync(rutaDb)) throw new Error('Uso: --db <copia de trabajo .sqlite> (obligatorio; nunca el remoto) o --ensayo <base.sqlite>');
  const simular = bandera('simular');
  // También en simulación: retirar y reponer la guardia ya escribe en la base.
  if (BASES_PROTEGIDAS.has(basename(rutaDb).toLowerCase())) throw new Error(`${basename(rutaDb)} es de sólo lectura (usa --ensayo)`);
  const db = new DatabaseSync(rutaDb);
  let inf: InformeSustitucion11;
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  try {
    db.exec('BEGIN');
    try {
      inf = aplicarCorrecciones11(db, c);
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
