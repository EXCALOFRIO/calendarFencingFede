/**
 * Prepara una copia de trabajo para recargar las seis pruebas individuales de
 * `engarde:rfee/cespm15/*` (Campeonato de España M-15 2014) desde
 * `hechos/lote8-engarde-cespm15/`, ya leídas con la codificación buena. Va justo ANTES de
 * `cargar-hechos.ts --carpetas lote8-engarde-cespm15`:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote8-engarde-cespm15-sustituir.ts --db <copia.sqlite> \
 *     [--hechos <carpeta>] [--simular] [--informe <json>]
 *
 * Por qué hace falta: la lectura rota puso «\uFFFD» en nombres, `factKey` y referencias de
 * asaltos. Al recargar, `cargar-hechos` sustituye resultados y cuadro, pero en las poules con
 * estado `parcial` conserva lo guardado y descarta lo nuevo, de modo que los asaltos rotos se
 * quedan. Además, el resultado sustituido sólo hereda la persona si el nombre normalizado
 * coincide, y con «\uFFFD» no coincide.
 *
 * Qué hace, por prueba ya existente en la base (misma fuente, temporada y clave):
 *  - a cada resultado guardado que es el mismo participante (mismo puesto y nombre y club
 *    iguales salvo los huecos «\uFFFD») le pone la `factKey` nueva, para que `cargar-hechos`
 *    lo actualice en su sitio y conserve `person_id`;
 *  - borra los asaltos de esa fuente en la prueba si no son ya exactamente los nuevos, para
 *    que `cargar-hechos` los inserte como prueba nueva (con la persona sacada de la referencia).
 * No toca otras pruebas, fuentes ni la cobertura (la reescribe `cargar-hechos`). Idempotente.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { hechosPrueba, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { letrasDeVariante } from '../../src/lib/sport/nombres/reparar-caracteres';
import { argumento, bandera, CARPETA_TRABAJO, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia } from './comun';
import { ordenado } from './lote7-equipos-corregir';

export const CARPETA_CESPM15 = join(CARPETA_TRABAJO, 'hechos', 'lote8-engarde-cespm15');
const BASES_PROTEGIDAS = new Set(['base.sqlite', 'remoto.sqlite']);

export type InformeSustituir = {
  ficheros: number;
  pruebas: {
    prueba: string;
    resultadosMismaClave: number;
    resultadosReclavados: number;
    /** Guardados sin pareja en la lectura nueva: `cargar-hechos` los borrará al sustituir. */
    resultadosSinPareja: string[];
    asaltosBorrados: number;
    asaltosYaCorrectos: boolean;
  }[];
  noEncontradas: string[];
  rechazados: { ruta: string; error: string }[];
};

/** Mismo texto salvo los huecos «\uFFFD» de cualquiera de los dos (y sin mirar acentos ni orden). */
export function mismoTexto(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return letrasDeVariante(a, b, true) !== null || letrasDeVariante(b, a, true) !== null;
}

export function leerCespm15(carpeta: string): { hechos: HechosPrueba[]; rechazados: InformeSustituir['rechazados'] } {
  const hechos: HechosPrueba[] = [];
  const rechazados: InformeSustituir['rechazados'] = [];
  if (!existsSync(carpeta)) return { hechos, rechazados };
  for (const f of readdirSync(carpeta).sort()) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const r = hechosPrueba.safeParse(JSON.parse(readFileSync(join(carpeta, f), 'utf8')));
    if (!r.success) rechazados.push({ ruta: f, error: r.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    else hechos.push(r.data);
  }
  return { hechos, rechazados };
}

type Guardado = { id: string; source_fact_key: string; source_name: string; source_club: string | null; position: number | null };
const firma = (x: { round: string; a: string; b: string; an: string | null; bn: string | null; sa: number; sb: number; fase: string }) =>
  `${x.fase}|${x.round}|${x.a}|${x.b}|${x.an}|${x.bn}|${x.sa}|${x.sb}`;

export function prepararSustitucion(db: DatabaseSync, hechos: readonly HechosPrueba[], simular = false): InformeSustituir {
  const inf: InformeSustituir = { ficheros: hechos.length, pruebas: [], noEncontradas: [], rechazados: [] };
  const comp = db.prepare(`SELECT id FROM sport_competition WHERE source=? AND season=? AND competition_key=?`);
  const resultados = db.prepare(`SELECT id, source_fact_key, source_name, source_club, position FROM sport_result WHERE competition_id=? AND source=?`);
  const reclavar = db.prepare(`UPDATE sport_result SET source_fact_key=? WHERE id=?`);
  const asaltos = db.prepare(`SELECT phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name, fencer_b_name, score_a, score_b
    FROM sport_bout WHERE competition_id=? AND source=?`);
  const borrarAsaltos = db.prepare(`DELETE FROM sport_bout WHERE competition_id=? AND source=?`);
  if (!simular) db.exec('BEGIN');
  try {
    for (const h of hechos) {
      const c = comp.get(h.source, h.edition.season, h.competition.competitionKey) as { id: string } | undefined;
      if (!c) {
        inf.noEncontradas.push(h.competition.competitionKey);
        continue;
      }
      const guardados = resultados.all(c.id, h.source) as Guardado[];
      const libres = new Map(guardados.map((g) => [g.id, g]));
      const claves = new Set(guardados.map((g) => g.source_fact_key));
      let mismaClave = 0;
      let reclavados = 0;
      for (const g of guardados) {
        if (h.results.some((r) => r.factKey === g.source_fact_key)) {
          libres.delete(g.id);
          mismaClave += 1;
        }
      }
      for (const r of h.results) {
        if (claves.has(r.factKey)) continue;
        const parejas = [...libres.values()].filter((g) => g.position === r.position && mismoTexto(g.source_name, r.name) && mismoTexto(g.source_club, r.club ?? null));
        if (parejas.length !== 1) continue;
        libres.delete(parejas[0].id);
        claves.add(r.factKey);
        if (!simular) reclavar.run(r.factKey, parejas[0].id);
        reclavados += 1;
      }
      const previos = (asaltos.all(c.id, h.source) as { phase: string; round_key: string; fencer_a_ref: string; fencer_b_ref: string;
        fencer_a_name: string | null; fencer_b_name: string | null; score_a: number; score_b: number }[])
        .map((p) => firma({ fase: p.phase, round: p.round_key, a: p.fencer_a_ref, b: p.fencer_b_ref, an: p.fencer_a_name, bn: p.fencer_b_name, sa: p.score_a, sb: p.score_b }))
        .sort().join('\n');
      const nuevos = h.bouts.filter((b) => b.aRef !== b.bRef).map(ordenado)
        .map((b) => firma({ fase: b.phase, round: b.roundKey, a: b.aRef, b: b.bRef, an: b.aName, bn: b.bName, sa: b.scoreA, sb: b.scoreB }))
        .sort().join('\n');
      const yaCorrectos = previos === nuevos;
      let borrados = 0;
      if (!yaCorrectos && previos !== '') {
        borrados = previos.split('\n').length;
        if (!simular) borrarAsaltos.run(c.id, h.source);
      }
      inf.pruebas.push({
        prueba: h.competition.competitionKey, resultadosMismaClave: mismaClave, resultadosReclavados: reclavados,
        resultadosSinPareja: [...libres.values()].map((g) => g.source_name), asaltosBorrados: borrados, asaltosYaCorrectos: yaCorrectos,
      });
    }
    if (!simular) db.exec('COMMIT');
  } catch (e) {
    if (!simular) db.exec('ROLLBACK');
    throw e;
  }
  return inf;
}

/** Ensayo (`simular`) o escritura con la guardia retirada y repuesta, como los demás scripts de indexado. */
export function sustituir(db: DatabaseSync, hechos: readonly HechosPrueba[], simular: boolean): InformeSustituir {
  if (simular) return prepararSustitucion(db, hechos, true);
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  try {
    return prepararSustitucion(db, hechos, false);
  } finally {
    restaurarGuardia(db);
  }
}

function main(): void {
  const rutaDb = argumento('db', '');
  if (!rutaDb || !existsSync(rutaDb)) throw new Error('Uso: --db <copia de trabajo .sqlite> (obligatorio; nunca el remoto)');
  const simular = bandera('simular');
  if (!simular && BASES_PROTEGIDAS.has(basename(rutaDb).toLowerCase())) throw new Error(`${basename(rutaDb)} es de sólo lectura`);
  const { hechos, rechazados } = leerCespm15(argumento('hechos', CARPETA_CESPM15));
  const db = new DatabaseSync(rutaDb, simular ? { readOnly: true } : {});
  const inf = sustituir(db, hechos, simular);
  db.close();
  inf.rechazados = rechazados;
  const salida = argumento('informe', '');
  if (salida) writeFileSync(salida, JSON.stringify(inf, null, 2));
  console.log(JSON.stringify(inf, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
