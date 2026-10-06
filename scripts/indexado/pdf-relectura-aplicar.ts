/**
 * Aplica `hechos/pdf-relectura/_correcciones.json` en una COPIA de trabajo (nunca en D1).
 * Va después de `cargar-hechos.ts --carpetas pdf-relectura` y antes de `unificar-personas.ts`:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/pdf-relectura-aplicar.ts --db <copia.sqlite> \
 *     [--correcciones <_correcciones.json>] [--hechos <carpeta>] [--simular] [--informe <json>]
 *
 *  - `sustituidas`: lecturas partidas de un PDF en dos fases. Se borran (asaltos, puestos,
 *    coberturas y la edición si queda vacía) sólo si la prueba unida que las sustituye ya
 *    está cargada en la copia; un puesto borrado deja su vínculo de persona al puesto del
 *    mismo nombre de la unida si allí falta.
 *  - `atributos`: arma o fecha mal indexadas en otra fuente (Engarde). Se corrigen en la
 *    prueba y en la fecha de sus filas, para que la fusión de `dedupe-pruebas.ts` la una
 *    con su copia RFEE.
 *  - `catalogo`: informativo, no cambia nada.
 *  - dobles: fase de una prueba releída con asaltos de rfee_pdf y de Engarde a la vez; queda
 *    una sola lectura (ver `quitarLecturasDobles`).
 *  - reanclaje: asaltos guardados que la carga dejó con referencias y nombres de otra lectura
 *    pasan a los puestos de la relectura (ver `reanclarAsaltosAntiguos`).
 *  - traslados: la fase (poules o cuadro) de una prueba releída que su prueba de Skermo no
 *    tiene pasa a la de Skermo (ver `trasladarFasesSinSkermo`).
 * Idempotente: lo ya borrado o ya corregido se cuenta como tal y no se repite.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { argumento, bandera, CARPETA_TRABAJO, normalizarNombre, palabrasNombre, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia } from './comun';
import { casarUnico, prepararNombre } from './dedupe-pruebas';
import type { Correcciones } from './pdf-relectura';

export type Traslado = { de: string; a: string; fase: 'POULE' | 'TABLEAU'; asaltos: number; coincidencia: number; rondas: 'todas' | 'segunda' };

export type InformeAplicar = {
  sustituidas: { borradas: number; yaNoEstaban: number; sinSustituta: string[]; asaltos: number; puestos: number; coberturas: number; ediciones: number; personasHeredadas: number };
  atributos: { corregidas: number; yaCorrectas: number; noEncontradas: string[] };
  dobles: DobleLectura[];
  reanclaje: InformeReanclaje;
  traslados: Traslado[];
};

const COLUMNAS = new Set(['weapon', 'gender', 'category', 'competition_date']);
const KIND = { POULE: 'pools', TABLEAU: 'tableau' } as const;

/**
 * El nombre del PDF («SURNAME SURNAME Nom», a veces recortado) es de esa persona de Skermo
 * («Nombre SURNAME SURNAME»): todas sus palabras están allí y la última puede ser un prefijo.
 */
export function mismoTirador(pdf: string, skermo: ReadonlySet<string>): boolean {
  const p = palabrasNombre(pdf);
  if (p.length < 2) return false;
  const ultima = p[p.length - 1];
  return p.slice(0, -1).every((w) => skermo.has(w)) && (skermo.has(ultima) || [...skermo].some((w) => w.startsWith(ultima)));
}

/**
 * `depurarSolapes` (unificar-personas) quita de la prueba PDF emparejada con una de Skermo
 * los asaltos cuyos dos tiradores están en Skermo en cuanto la de Skermo tiene algún asalto,
 * sin mirar la fase: el cuadro de la PDF se pierde si Skermo sólo trae las poules (de Engarde),
 * y la 2ª fase si sólo trae la 1ª. Antes de unificar, lo que la prueba de Skermo no tiene
 * (la fase entera o la 2ª vuelta de poules / el 2º cuadro) se pasa a ella; `dedupe-pruebas`
 * ya no la toca (sólo hay una lectura) y `revincularAsaltosPorPuesto` liga los tiradores
 * con los puestos de Skermo.
 */
export function trasladarFasesSinSkermo(db: DatabaseSync, claves: ReadonlySet<string>, simular = false): Traslado[] {
  const out: Traslado[] = [];
  if (claves.size === 0) return out;
  const pdfs = (db.prepare(
    `SELECT id, competition_key k, weapon, gender, category, format, competition_date f FROM sport_competition
      WHERE source='rfee_pdf' AND competition_date IS NOT NULL`,
  ).all() as { id: string; k: string; weapon: string; gender: string; category: string; format: string; f: string }[])
    .filter((c) => claves.has(c.k));
  const candidatas = db.prepare(
    `SELECT id FROM sport_competition WHERE source='skermo_rfee' AND weapon=? AND gender=? AND category=? AND format=?
        AND abs(julianday(competition_date) - julianday(?)) <= 1`,
  );
  const nombres = db.prepare('SELECT source_name n FROM sport_result WHERE competition_id=?');
  const porFase = db.prepare('SELECT phase, count(*) n FROM sport_bout WHERE competition_id=? GROUP BY phase');
  const fases = (id: string) => new Map((porFase.all(id) as { phase: string; n: number }[]).map((r) => [r.phase, Number(r.n)]));
  for (const c of pdfs) {
    const suyos = (nombres.all(c.id) as { n: string }[]).map((r) => r.n);
    if (suyos.length === 0) continue;
    let mejor: { id: string; coincidencia: number } | null = null;
    for (const { id } of candidatas.all(c.weapon, c.gender, c.category, c.format, c.f) as { id: string }[]) {
      const skermo = (nombres.all(id) as { n: string }[]).map((r) => new Set(palabrasNombre(r.n)));
      if (skermo.length === 0) continue;
      const comunes = suyos.filter((n) => skermo.some((s) => mismoTirador(n, s))).length;
      const coincidencia = comunes / Math.min(suyos.length, skermo.length);
      if (coincidencia >= 0.5 && (!mejor || coincidencia > mejor.coincidencia)) mejor = { id, coincidencia };
    }
    if (!mejor) continue;
    const enSkermo = fases(mejor.id);
    if (enSkermo.size === 0) continue;
    const coincidencia = Math.round(mejor.coincidencia * 1000) / 1000;
    for (const [fase, asaltos] of fases(c.id)) {
      if (fase !== 'POULE' && fase !== 'TABLEAU') continue;
      const suyos = enSkermo.get(fase) ?? 0;
      if (suyos === 0) {
        out.push({ de: c.id, a: mejor.id, fase, asaltos, coincidencia, rondas: 'todas' });
        if (simular) continue;
        db.prepare('UPDATE sport_bout SET competition_id=? WHERE competition_id=? AND phase=?').run(mejor.id, c.id, fase);
        db.prepare('UPDATE sport_import_coverage SET competition_id=?, updated_at=? WHERE competition_id=? AND fact_kind=?')
          .run(mejor.id, Date.now(), c.id, KIND[fase]);
        continue;
      }
      // Skermo con sólo la 1ª fase (Engarde publica cada fase aparte y a veces sólo una): la 2ª
      // de la prueba unida (V2P*, B*) pasa si lo de Skermo se parece más a la 1ª releída que al
      // total (la 1ª releída puede venir corta: poules que el lector no lee).
      const segunda = fase === 'POULE' ? 'V_P%' : 'B%';
      const n = (id: string, patron: string) => Number((db.prepare(
        'SELECT count(*) n FROM sport_bout WHERE competition_id=? AND phase=? AND round_key LIKE ?',
      ).get(id, fase, patron) as { n: number }).n);
      const nSegunda = n(c.id, segunda);
      if (nSegunda === 0 || n(mejor.id, segunda) > 0 || suyos >= asaltos - nSegunda / 2) continue;
      out.push({ de: c.id, a: mejor.id, fase, asaltos: nSegunda, coincidencia, rondas: 'segunda' });
      if (simular) continue;
      db.prepare('UPDATE sport_bout SET competition_id=? WHERE competition_id=? AND phase=? AND round_key LIKE ?').run(mejor.id, c.id, fase, segunda);
    }
  }
  return out;
}

export type DobleLectura = { competicion: string; fase: 'POULE' | 'TABLEAU'; queda: string; quitada: string; asaltos: number };

/**
 * `depurarSolapesEngarde` ya pasó a algunas pruebas PDF los asaltos de su copia de Engarde
 * (cuando traían más). `cargar-hechos` sólo sustituye los de rfee_pdf, así que la relectura
 * los duplica en esa fase. Queda la lectura con más asaltos (a igualdad, la que ya estaba);
 * de la otra se quitan los asaltos y su cobertura de esa fase.
 */
export function quitarLecturasDobles(db: DatabaseSync, claves: ReadonlySet<string>, simular = false): DobleLectura[] {
  const out: DobleLectura[] = [];
  if (claves.size === 0) return out;
  const comps = (db.prepare(`SELECT id, competition_key k FROM sport_competition WHERE source='rfee_pdf'`).all() as { id: string; k: string }[])
    .filter((c) => claves.has(c.k));
  const porFuente = db.prepare('SELECT phase, source, count(*) n FROM sport_bout WHERE competition_id=? GROUP BY phase, source');
  for (const c of comps) {
    const filas = porFuente.all(c.id) as { phase: string; source: string; n: number }[];
    for (const fase of ['POULE', 'TABLEAU'] as const) {
      const pdf = Number(filas.find((f) => f.phase === fase && f.source === 'rfee_pdf')?.n ?? 0);
      const otras = filas.filter((f) => f.phase === fase && f.source !== 'rfee_pdf');
      if (pdf === 0 || otras.length !== 1) continue;
      const otra = otras[0];
      const quitada = pdf > Number(otra.n) ? otra.source : 'rfee_pdf';
      const queda = quitada === 'rfee_pdf' ? otra.source : 'rfee_pdf';
      out.push({ competicion: c.id, fase, queda, quitada, asaltos: quitada === 'rfee_pdf' ? pdf : Number(otra.n) });
      if (simular) continue;
      db.prepare('DELETE FROM sport_bout WHERE competition_id=? AND phase=? AND source=?').run(c.id, fase, quitada);
      db.prepare('DELETE FROM sport_import_coverage WHERE competition_id=? AND fact_kind=? AND source=?').run(c.id, KIND[fase], quitada);
    }
  }
  return out;
}

export type InformeReanclaje = { pruebas: number; reanclados: number; unLado: number; duplicadosBorrados: number; sinCasar: number };

/**
 * Con menos poules nuevas que guardadas, `cargar-hechos` deja los asaltos guardados que la
 * relectura no trae con sus referencias y nombres antiguos (otra lectura, otro recorte del
 * nombre): el mismo tirador sale con dos nombres en la prueba. Cada lado se lleva al puesto
 * de la relectura con el que casa (exacto o recortado y único); si la pareja ya está en esa
 * poule (o en el cuadro) con la lectura nueva, el asalto antiguo sobra: manda la relectura.
 */
export function reanclarAsaltosAntiguos(db: DatabaseSync, claves: ReadonlySet<string>, simular = false): InformeReanclaje {
  const inf: InformeReanclaje = { pruebas: 0, reanclados: 0, unLado: 0, duplicadosBorrados: 0, sinCasar: 0 };
  if (claves.size === 0) return inf;
  const comps = (db.prepare(`SELECT id, competition_key k FROM sport_competition WHERE source='rfee_pdf'`).all() as { id: string; k: string }[])
    .filter((c) => claves.has(c.k));
  const puestos = db.prepare('SELECT source_fact_key k, source_name n FROM sport_result WHERE competition_id=? AND source_fact_key IS NOT NULL');
  const asaltos = db.prepare(
    `SELECT id, phase, round_key r, fencer_a_ref ar, fencer_b_ref br, fencer_a_name an, fencer_b_name bn FROM sport_bout
      WHERE competition_id=? AND source='rfee_pdf'`,
  );
  const mover = db.prepare('UPDATE sport_bout SET fencer_a_ref=?, fencer_a_name=?, fencer_b_ref=?, fencer_b_name=? WHERE id=?');
  // `sport_bout_canonical_order` exige fencer_a_ref < fencer_b_ref: con las referencias nuevas
  // puede tocar dar la vuelta al asalto entero.
  const girar = db.prepare(
    `UPDATE sport_bout SET fencer_a_ref=?, fencer_a_name=?, fencer_b_ref=?, fencer_b_name=?,
       score_a=score_b, score_b=score_a, fencer_a_person_id=fencer_b_person_id, fencer_b_person_id=fencer_a_person_id WHERE id=?`,
  );
  const borrar = db.prepare('DELETE FROM sport_bout WHERE id=?');
  for (const c of comps) {
    const lista = puestos.all(c.id) as { k: string; n: string }[];
    const refs = new Set(lista.map((p) => p.k));
    const prep = lista.map((p) => prepararNombre(p.n));
    const filas = asaltos.all(c.id) as { id: string; phase: string; r: string; ar: string; br: string; an: string; bn: string }[];
    const viejas = filas.filter((b) => !refs.has(b.ar) || !refs.has(b.br));
    if (viejas.length === 0) continue;
    inf.pruebas += 1;
    // En el cuadro la pareja es única por tramo (A/T de la 1ª fase o único, B de la final).
    const pareja = (fase: string, ronda: string, a: string, b: string) =>
      `${fase === 'POULE' ? `POULE:${ronda}` : `TABLEAU:${ronda.charAt(0) === 'B' ? 'B' : 'A'}`}|${[a, b].sort().join('|')}`;
    const parejas = new Set(filas.filter((b) => refs.has(b.ar) && refs.has(b.br)).map((b) => pareja(b.phase, b.r, b.ar, b.br)));
    // El nombre que ya usan los asaltos de la relectura para ese puesto (puede ser más largo que el del puesto).
    const enAsaltos = new Map<string, string>();
    for (const b of filas) {
      if (refs.has(b.ar)) enAsaltos.set(b.ar, b.an);
      if (refs.has(b.br)) enAsaltos.set(b.br, b.bn);
    }
    const usados = [...enAsaltos];
    const prepUsados = usados.map(([, n]) => prepararNombre(n));
    const lado = (ref: string, nombre: string): { ref: string; nombre: string } | null => {
      if (refs.has(ref)) return { ref, nombre };
      const n = prepararNombre(nombre);
      const i = casarUnico(n, prep);
      if (i !== null) return { ref: lista[i].k, nombre: enAsaltos.get(lista[i].k) ?? lista[i].n };
      // Dos puestos recortados iguales: el nombre largo de los asaltos nuevos aún los distingue.
      const j = casarUnico(n, prepUsados);
      return j === null ? null : { ref: usados[j][0], nombre: usados[j][1] };
    };
    /** Pone las referencias nuevas; false si chocan con otro asalto (misma ronda y pareja). */
    const poner = (id: string, a: { ref: string; nombre: string }, o: { ref: string; nombre: string }): boolean => {
      if (simular) return true;
      try {
        if (a.ref < o.ref) mover.run(a.ref, a.nombre, o.ref, o.nombre, id);
        else girar.run(o.ref, o.nombre, a.ref, a.nombre, id);
        return true;
      } catch (e) {
        if (e instanceof Error && /UNIQUE|constraint/i.test(e.message)) return false;
        throw e;
      }
    };
    for (const b of viejas) {
      const ca = lado(b.ar, b.an);
      const co = lado(b.br, b.bn);
      if ((!ca && !co) || (ca && co && ca.ref === co.ref)) {
        inf.sinCasar += 1;
        continue;
      }
      if (!ca || !co) {
        // Un lado ambiguo (puestos recortados iguales: hermanos, «SANTAMARIA G» dos veces) se
        // queda como estaba; el otro toma el nombre y la referencia de la relectura.
        inf.sinCasar += 1;
        const a = ca ?? { ref: b.ar, nombre: b.an };
        const o = co ?? { ref: b.br, nombre: b.bn };
        if (a.ref !== o.ref && (a.ref !== b.ar || o.ref !== b.br) && poner(b.id, a, o)) inf.unLado += 1;
        continue;
      }
      const k = pareja(b.phase, b.r, ca.ref, co.ref);
      if (parejas.has(k)) {
        inf.duplicadosBorrados += 1;
        if (!simular) borrar.run(b.id);
        continue;
      }
      parejas.add(k);
      if (poner(b.id, ca, co)) inf.reanclados += 1;
      else inf.sinCasar += 1;
    }
  }
  return inf;
}

/** Claves de prueba de los hechos de la relectura (todo `*.json` salvo los `_*.json`). */
export function clavesDeHechos(carpeta: string): Set<string> {
  const out = new Set<string>();
  if (!existsSync(carpeta)) return out;
  for (const f of readdirSync(carpeta)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const k = (JSON.parse(readFileSync(join(carpeta, f), 'utf8')) as { competition?: { competitionKey?: string } }).competition?.competitionKey;
    if (k) out.add(k);
  }
  return out;
}

export function aplicarCorrecciones(db: DatabaseSync, c: Correcciones, simular = false, claves: ReadonlySet<string> = new Set()): InformeAplicar {
  const inf: InformeAplicar = {
    sustituidas: { borradas: 0, yaNoEstaban: 0, sinSustituta: [], asaltos: 0, puestos: 0, coberturas: 0, ediciones: 0, personasHeredadas: 0 },
    atributos: { corregidas: 0, yaCorrectas: 0, noEncontradas: [] },
    dobles: [],
    reanclaje: { pruebas: 0, reanclados: 0, unLado: 0, duplicadosBorrados: 0, sinCasar: 0 },
    traslados: [],
  };
  const comp = db.prepare('SELECT id, edition_id FROM sport_competition WHERE source=? AND season=? AND competition_key=?');
  const n = (sql: string, ...p: (string | number | null)[]) => Number((db.prepare(sql).get(...p) as { n: number }).n);
  if (!simular) db.exec('BEGIN');
  try {
    for (const s of c.sustituidas) {
      const vieja = comp.get(s.source, s.season, s.competitionKey) as { id: string; edition_id: string } | undefined;
      if (!vieja) {
        inf.sustituidas.yaNoEstaban += 1;
        continue;
      }
      const nueva = comp.get('rfee_pdf', s.season, s.porCompetitionKey) as { id: string } | undefined;
      if (!nueva) {
        inf.sustituidas.sinSustituta.push(s.competitionKey);
        continue;
      }
      inf.sustituidas.asaltos += n('SELECT count(*) n FROM sport_bout WHERE competition_id=?', vieja.id);
      inf.sustituidas.puestos += n('SELECT count(*) n FROM sport_result WHERE competition_id=?', vieja.id);
      inf.sustituidas.coberturas += n('SELECT count(*) n FROM sport_import_coverage WHERE competition_id=? OR (source=? AND season=? AND competition_key=?)', vieja.id, s.source, s.season, s.competitionKey);
      inf.sustituidas.borradas += 1;
      if (simular) continue;
      const unidos = new Map<string, { id: string; person_id: string | null } | null>();
      for (const r of db.prepare('SELECT id, source_name, person_id FROM sport_result WHERE competition_id=?').all(nueva.id) as { id: string; source_name: string; person_id: string | null }[]) {
        const k = normalizarNombre(r.source_name);
        unidos.set(k, unidos.has(k) ? null : { id: r.id, person_id: r.person_id });
      }
      for (const r of db.prepare('SELECT source_name, person_id FROM sport_result WHERE competition_id=? AND person_id IS NOT NULL').all(vieja.id) as { source_name: string; person_id: string }[]) {
        const d = unidos.get(normalizarNombre(r.source_name));
        if (!d || d.person_id) continue;
        db.prepare('UPDATE sport_result SET person_id=? WHERE id=? AND person_id IS NULL').run(r.person_id, d.id);
        d.person_id = r.person_id;
        inf.sustituidas.personasHeredadas += 1;
      }
      db.prepare('DELETE FROM sport_bout WHERE competition_id=?').run(vieja.id);
      db.prepare('DELETE FROM sport_result WHERE competition_id=?').run(vieja.id);
      db.prepare('DELETE FROM sport_import_coverage WHERE competition_id=? OR (source=? AND season=? AND competition_key=?)').run(vieja.id, s.source, s.season, s.competitionKey);
      db.prepare('DELETE FROM sport_competition WHERE id=?').run(vieja.id);
      inf.sustituidas.ediciones += Number(db.prepare('DELETE FROM sport_edition WHERE id=?1 AND NOT EXISTS (SELECT 1 FROM sport_competition WHERE edition_id=?1)').run(vieja.edition_id).changes);
    }
    for (const a of c.atributos) {
      const fila = db.prepare('SELECT id, weapon, gender, category, competition_date FROM sport_competition WHERE source=? AND season=? AND competition_key=?')
        .get(a.source, a.season, a.competitionKey) as Record<string, string | null> | undefined;
      if (!fila) {
        inf.atributos.noEncontradas.push(a.competitionKey);
        continue;
      }
      const cambios = Object.entries(a.cambios).filter(([k, v]) => COLUMNAS.has(k) && fila[k] !== v);
      if (cambios.length === 0) {
        inf.atributos.yaCorrectas += 1;
        continue;
      }
      inf.atributos.corregidas += 1;
      if (simular) continue;
      db.prepare(`UPDATE sport_competition SET ${cambios.map(([k]) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`)
        .run(...cambios.map(([, v]) => v), Date.now(), fila.id as string);
      const fecha = a.cambios.competition_date;
      if (fecha) {
        db.prepare('UPDATE sport_result SET occurred_on=? WHERE competition_id=?').run(fecha, fila.id as string);
        db.prepare('UPDATE sport_bout SET occurred_on=? WHERE competition_id=?').run(fecha, fila.id as string);
      }
    }
    inf.dobles = quitarLecturasDobles(db, claves, simular);
    inf.reanclaje = reanclarAsaltosAntiguos(db, claves, simular);
    inf.traslados = trasladarFasesSinSkermo(db, claves, simular);
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
  const ruta = argumento('correcciones', join(CARPETA_TRABAJO, 'hechos', 'pdf-relectura', '_correcciones.json'));
  const c = JSON.parse(readFileSync(ruta, 'utf8')) as Correcciones;
  const claves = clavesDeHechos(argumento('hechos', dirname(ruta)));
  const simular = bandera('simular');
  const db = new DatabaseSync(rutaDb, simular ? { readOnly: true } : {});
  let inf: InformeAplicar;
  if (simular) inf = aplicarCorrecciones(db, c, true, claves);
  else {
    prepararCopiaTrabajo(db);
    restaurarGuardia(db);
    quitarGuardia(db);
    try {
      inf = aplicarCorrecciones(db, c, false, claves);
    } finally {
      restaurarGuardia(db);
    }
  }
  db.close();
  const salida = argumento('informe', '');
  if (salida) writeFileSync(salida, JSON.stringify(inf, null, 2));
  console.log(JSON.stringify(inf, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
