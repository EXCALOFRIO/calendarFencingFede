/**
 * Lote 13, punto 5: pruebas de Engarde ya cargadas cuyo género contradice el código de la clave
 * (`genero-clave.ts`, la misma regla que aplica ahora `cargar-hechos.ts` al cargar).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote13-genero.ts [--db <nuevo13.sqlite>] [--informe <json>]
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote13-genero.ts --db <copia.sqlite> --aplicar [--informe <json>]
 *
 * Ensayo por defecto (sólo lectura). Con `--aplicar` (nunca en las bases protegidas) sólo se
 * cambia el género de las `corregido` (`sport_competition.gender` y `updated_at`); las `dudoso` y
 * `desmentido` quedan en el informe para revisión. Idempotente: una prueba ya corregida coincide
 * con su código y no vuelve a salir. Después de aplicar alguna, `separar-genero.ts` revisa las
 * personas creadas con el género equivocado.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ahora, argumento, bandera } from './comun';
import { decidirGeneroClave, diccionarioGeneroDeBase, type DecisionGeneroClave } from './genero-clave';
import { asegurarCarpetaInformes, conBase, corto, NUEVO13 } from './lote13-comun';
import type { Genero } from './separar-genero';

export type CasoGenero = {
  id: string; competitionKey: string; season: string; weapon: string; category: string; puestos: number; decision: DecisionGeneroClave;
};
export type InformeGenero13 = {
  pruebas: number;
  porAccion: Record<string, number>;
  casos: CasoGenero[];
  aplicadas: number;
};

export function auditarGeneroClave(db: DatabaseSync, dic: ReadonlyMap<string, Genero>): CasoGenero[] {
  const comps = db.prepare(
    `SELECT id, competition_key k, season s, weapon w, gender g, category c FROM sport_competition WHERE source = 'engarde' AND format = 'INDIVIDUAL'`,
  ).all() as { id: string; k: string; s: string; w: string; g: string; c: string }[];
  const nombres = db.prepare(`SELECT source_name n FROM sport_result WHERE competition_id = ?`);
  const casos: CasoGenero[] = [];
  for (const c of comps) {
    const ns = (nombres.all(c.id) as { n: string | null }[]).map((r) => r.n ?? '').filter(Boolean);
    const decision = decidirGeneroClave({ competitionKey: c.k, weapon: c.w, gender: c.g, nombres: ns }, dic);
    casos.push({ id: c.id, competitionKey: c.k, season: c.s, weapon: c.w, category: c.c, puestos: ns.length, decision });
  }
  return casos;
}

export function aplicarGeneroClave(db: DatabaseSync, casos: readonly CasoGenero[]): number {
  const poner = db.prepare(`UPDATE sport_competition SET gender = ?, updated_at = ? WHERE id = ? AND gender = ?`);
  let n = 0;
  for (const c of casos) {
    if (c.decision.accion !== 'corregido') continue;
    n += Number(poner.run(c.decision.genero, ahora(), c.id, c.decision.fichero).changes);
  }
  return n;
}

function main(): void {
  const rutaDb = argumento('db', NUEVO13);
  const aplicar = bandera('aplicar');
  const carpeta = asegurarCarpetaInformes();
  const inf = conBase(rutaDb, aplicar, (db): InformeGenero13 => {
    const casos = auditarGeneroClave(db, diccionarioGeneroDeBase(db));
    const porAccion = casos.reduce<Record<string, number>>((o, c) => ({ ...o, [c.decision.accion]: (o[c.decision.accion] ?? 0) + 1 }), {});
    const relevantes = casos.filter((c) => !['sin_codigo', 'coincide', 'mixta'].includes(c.decision.accion));
    return { pruebas: casos.length, porAccion, casos: relevantes, aplicadas: aplicar ? aplicarGeneroClave(db, relevantes) : 0 };
  });
  const salida = argumento('informe', join(carpeta, aplicar ? 'genero-aplicado.json' : 'genero-ensayo.json'));
  writeFileSync(salida, JSON.stringify(inf, null, 2));
  console.log(JSON.stringify({ pruebas: inf.pruebas, porAccion: inf.porAccion, aplicadas: inf.aplicadas }, null, 2));
  for (const c of inf.casos) {
    const v = c.decision.votos;
    console.log(`${c.decision.accion} ${corto(c.id)} ${c.competitionKey} ${c.weapon} fichero=${c.decision.fichero} codigo=${c.decision.codigo?.codigo} M=${v.M} F=${v.F} de ${v.total}`);
  }
  if (!aplicar) console.log('Ensayo: nada guardado (--aplicar para escribir en una copia de trabajo).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
