/**
 * Compara cada fichero de `hechos/lote7-clubes*` con las pruebas nacionales de `nuevo7.sqlite`
 * (sólo lectura) de igual arma, sexo, categoría y formato a ±2 días: nombres en común y fases
 * que ya tiene la base. Sirve para comprobar que `unificar-personas` fundirá la copia.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-clubes-comparar.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { normalizarNombre } from './comun';
import { HECHOS_CLUBES, HECHOS_CLUBES_EQUIPOS } from './lote7-clubes-red';
import { NUEVO7 } from './lote7-pdf-comun';

const db = new DatabaseSync(NUEVO7, { readOnly: true });
const dia = (f: string) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);
for (const carpeta of [HECHOS_CLUBES, HECHOS_CLUBES_EQUIPOS]) {
  if (!existsSync(carpeta)) continue;
  for (const f of readdirSync(carpeta).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    const h = JSON.parse(readFileSync(join(carpeta, f), 'utf8')) as HechosPrueba;
    const c = h.competition;
    const propios = new Set(h.results.map((r) => normalizarNombre(r.name)));
    const candidatas = db.prepare(
      `SELECT id, source, competition_key k, competition_date d FROM sport_competition
        WHERE weapon=? AND gender=? AND category=? AND format=? AND competition_date IS NOT NULL`,
    ).all(c.weapon, c.gender, c.category, c.format) as { id: string; source: string; k: string; d: string }[];
    const filas = candidatas.filter((x) => c.date && Math.abs(dia(x.d) - dia(c.date)) <= 2).map((x) => {
      const nombres = (db.prepare('SELECT source_name name FROM sport_result WHERE competition_id=?').all(x.id) as { name: string }[]).map((r) => normalizarNombre(r.name));
      const fases = db.prepare('SELECT phase, count(*) n FROM sport_bout WHERE competition_id=? GROUP BY phase').all(x.id) as { phase: string; n: number }[];
      return { source: x.source, key: x.k.slice(0, 60), fecha: x.d, resultados: nombres.length, comunes: nombres.filter((n) => propios.has(n)).length, fases: Object.fromEntries(fases.map((y) => [y.phase, y.n])) };
    });
    console.log(JSON.stringify({ fichero: f.slice(0, 80), fecha: c.date, resultados: h.results.length, poule: h.bouts.filter((b) => b.phase === 'POULE').length, cuadro: h.bouts.filter((b) => b.phase === 'TABLEAU').length, base: filas }));
  }
}
db.close();
