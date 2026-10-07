/**
 * Muestra del desglose por categoría: cuántas filas salen sin mejor puesto o
 * sin asaltos, y cuántos perfiles no enseñan la sección.
 *
 *   $env:PERF_DB=<copia> ; npx tsx tests/ui/_categorias-muestra.mts [n]
 */
import { DatabaseSync } from 'node:sqlite';
import { leerRendimientoDe } from '@/lib/sport/explorar/rendimiento';
import { resolverPersona } from '@/lib/sport/explorar/personas';
import { d1DeLectura } from './d1-lectura.mts';

const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const sqlite = new DatabaseSync(BASE, { readOnly: true });
const db = d1DeLectura(sqlite);
const n = Number(process.argv[2] ?? 150);
const ids = (sqlite.prepare(`SELECT r.person_id AS id FROM sport_result r JOIN sport_person p ON p.id = r.person_id
  WHERE p.merged_into_person_id IS NULL AND p.country_code = 'ESP' GROUP BY r.person_id HAVING count(*) >= 8 ORDER BY random() LIMIT ?`).all(n) as { id: string }[]).map((x) => x.id);
const c = { perfiles: 0, sinRendimiento: 0, unaCategoria: 0, filas: 0, sinMejor: 0, sinAsaltos: 0, sinPoule: 0 };
const ejemplos: string[] = [];
for (const id of ids) {
  const p = await resolverPersona(db, id);
  if (!p) continue;
  c.perfiles += 1;
  const r = await leerRendimientoDe(db, p.ids);
  if (!r || r.vistas.todo.total.competiciones === 0) { c.sinRendimiento += 1; continue; }
  for (const amb of ['todo', 'internacional', 'nacional'] as const) {
    const cats = r.vistas[amb].porCategoria;
    if (amb === 'todo' && cats.length <= 1) c.unaCategoria += 1;
    for (const f of cats) {
      c.filas += 1;
      if (f.mejor === null) c.sinMejor += 1;
      if (f.asaltos.asaltos === 0) c.sinAsaltos += 1;
      if (f.poule.asaltos === 0) c.sinPoule += 1;
      if ((f.mejor === null || f.poule.asaltos === 0) && ejemplos.length < 15) ejemplos.push(`${id} ${amb} ${f.clave}: comp=${f.competiciones} mejor=${f.mejor} asaltos=${f.asaltos.asaltos} poule=${f.poule.asaltos}`);
    }
  }
}
console.log(c);
console.log(ejemplos.join('\n'));
sqlite.close();
