/**
 * Lote 13, punto 1: tramos de veteranos (y años de Criterium) que se tiraron juntos en una prueba
 * de Engarde ya fundida con otro tramo (`detectarPartesSueltas` de `dedupe-conjuntas.ts`).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote13-conjuntas.ts [--db <nuevo13.sqlite>] [--informe <json>]
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote13-conjuntas.ts --db <copia.sqlite> --aplicar [--informe <json>]
 *
 * Ensayo por defecto (sólo lectura): lista las filas de `sport_competition_combined` que se
 * añadirían, cambiarían o quitarían, con nombres. Con `--aplicar` (nunca en las bases protegidas)
 * ejecuta `registrarConjuntas` (la misma detección que `unificar-personas.ts`, ahora con las partes
 * sueltas) y `vincularAsaltosConjuntas`. No mueve ni copia asaltos. Idempotente: la segunda pasada
 * no cambia filas.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { argumento, bandera } from './comun';
import {
  detectarConjuntas,
  detectarPartesSueltas,
  hayTablaConjuntas,
  nombresConjuntables,
  puestosRepetidosAnfitriona,
  registrarConjuntas,
  sumarPartesSueltas,
  TABLA_CONJUNTAS,
  vincularAsaltosConjuntas,
  type PruebaConjunta,
} from './dedupe-conjuntas';
import { cargarPruebasNacionales, type PruebaNacional } from './dedupe-pruebas';
import { asegurarCarpetaInformes, conBase, corto, NUEVO13 } from './lote13-comun';

export type FilaPlan = { parte: string; conjunta: string; regla: string; comunes: number };
export type PlanConjuntas13 = {
  sueltas: { anfitriona: string; partes: string[]; nombresAjenos: string[]; puestosRepetidos: string[] }[];
  /** Puestos trasladados a las anfitrionas que repiten el de un tirador de sus partes: se borran. */
  puestosBorrar: number;
  ambiguas: string[];
  insertar: FilaPlan[];
  cambiar: (FilaPlan & { antes: string })[];
  quitar: { parte: string; conjunta: string }[];
  /** Asaltos de las anfitrionas con un lado de un tirador de las partes y sin persona. */
  ladosSinPersona: number;
};

const describir = (p: PruebaNacional, nombres?: readonly string[]) =>
  `${p.source}:${corto(p.id)} ${p.competition_key} ${p.weapon} ${p.gender} ${p.category} ${p.fecha}${nombres ? ` [${nombres.join('; ')}]` : ''}`;

export function planConjuntas13(db: DatabaseSync): PlanConjuntas13 {
  const previas = hayTablaConjuntas(db)
    ? new Map((db.prepare(`SELECT part_competition_id p, combined_competition_id c FROM ${TABLA_CONJUNTAS}`).all() as { p: string; c: string }[])
      .map((f) => [f.p, f.c]))
    : new Map<string, string>();
  const pruebas = cargarPruebasNacionales(db);
  const normal = detectarConjuntas(pruebas, previas);
  const { puestos, asaltos } = nombresConjuntables(db);
  const ocupadas = new Set(normal.conjuntas.flatMap((c) => [c.conjunta.id, ...c.partes.map((x) => x.prueba.id)]));
  const sueltas = detectarPartesSueltas(pruebas, puestos, asaltos, ocupadas);
  const det = sumarPartesSueltas(normal, sueltas);
  const nombresDe = db.prepare(`SELECT source_name n FROM sport_result WHERE competition_id = ? ORDER BY position`);
  const nombres = (id: string) => (nombresDe.all(id) as { n: string }[]).map((r) => r.n);
  const propias = new Set(det.conjuntas.slice(normal.conjuntas.length).map((c) => c.conjunta.id));
  const plan: PlanConjuntas13 = { sueltas: [], puestosBorrar: 0, ambiguas: det.ambiguas, insertar: [], cambiar: [], quitar: [], ladosSinPersona: 0 };
  const sinPersona = db.prepare(
    `SELECT count(*) n FROM sport_bout WHERE competition_id = ? AND (fencer_a_person_id IS NULL OR fencer_b_person_id IS NULL)`,
  );
  const vistas = new Set<string>();
  for (const c of det.conjuntas as PruebaConjunta[]) {
    if (propias.has(c.conjunta.id)) {
      const propios = puestos.get(c.conjunta.id) ?? [];
      const ajenos = (asaltos.get(c.conjunta.id) ?? []).filter((n) => !propios.some((m) => m.norm === n.norm)).map((n) => n.palabras.join(' '));
      const repetidos = puestosRepetidosAnfitriona(db, c);
      plan.puestosBorrar += repetidos.length;
      plan.sueltas.push({ anfitriona: describir(c.conjunta, nombres(c.conjunta.id)), partes: c.partes.map((x) => describir(x.prueba, nombres(x.prueba.id))),
        nombresAjenos: ajenos, puestosRepetidos: repetidos.map((r) => `${corto(r.id)} ${r.nombre}`) });
      plan.ladosSinPersona += Number((sinPersona.get(c.conjunta.id) as { n: number }).n);
    }
    for (const x of c.partes) {
      vistas.add(x.prueba.id);
      const antes = previas.get(x.prueba.id);
      const fila = { parte: x.prueba.id, conjunta: c.conjunta.id, regla: c.regla, comunes: x.comunes };
      if (!antes) plan.insertar.push(fila);
      else if (antes !== c.conjunta.id) plan.cambiar.push({ ...fila, antes });
    }
  }
  for (const [p, c] of previas) if (!vistas.has(p)) plan.quitar.push({ parte: p, conjunta: c });
  return plan;
}

function main(): void {
  const rutaDb = argumento('db', NUEVO13);
  const aplicar = bandera('aplicar');
  const carpeta = asegurarCarpetaInformes();
  const salida = argumento('informe', join(carpeta, aplicar ? 'conjuntas-aplicado.json' : 'conjuntas-ensayo.json'));
  const inf = conBase(rutaDb, aplicar, (db) => {
    const plan = planConjuntas13(db);
    if (!aplicar) return { plan };
    const registro = registrarConjuntas(db, false).informe;
    const asaltos = vincularAsaltosConjuntas(db);
    return { plan, registro, asaltos };
  }, { transaccion: false });
  writeFileSync(salida, JSON.stringify(inf, null, 2));
  const p = inf.plan;
  console.log(JSON.stringify({ anfitrionas: p.sueltas.length, partes: p.insertar.length, puestosBorrar: p.puestosBorrar, cambiar: p.cambiar.length, quitar: p.quitar.length,
    ambiguas: p.ambiguas.length, ladosSinPersona: p.ladosSinPersona, ...('registro' in inf ? { registro: inf.registro, asaltos: inf.asaltos } : {}) }, null, 2));
  for (const s of p.sueltas.slice(0, 12)) console.log(`${s.anfitriona}\n   <- ${s.partes.join('\n   <- ')}`);
  if (!aplicar) console.log(`Ensayo: nada guardado. Informe: ${salida}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
