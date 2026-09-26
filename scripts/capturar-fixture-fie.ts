import 'dotenv/config';
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import {
  fieCensoUrl,
  fieDetailedRankingUrl,
  fieFichaApiUrl,
} from '../src/lib/ingest/sources/fie-tiradores';
import { fetchJson } from '../src/lib/ingest/fetcher';

/**
 * Captura el fixture real de las fichas de tirador de la FIE.
 *
 *   npx tsx scripts/capturar-fixture-fie.ts
 *
 * Guarda `tests/fixtures/fie-tiradores.json.gz` con las respuestas LITERALES
 * de la FIE, y a propósito MUY recortadas:
 *
 *  - Del censo se piden solo dos nombres (`&name=`) en vez de los 403 del país.
 *    El fixture tiene que probar el parser, no ser una copia de su base de
 *    datos: ver la nota legal de `src/db/schema/fie.ts`.
 *  - De las fichas se BORRAN antes de guardar `biography`,
 *    `graceNoteBiography`, `fencerBiography`, `medals`, `futureCompetitions` e
 *    `introUrl`. Son prosa con autoría de terceros y su base de resultados;
 *    la ingestión no los lee, así que tampoco entran en el repositorio.
 *  - De `detailed-ranking` (250 KB por combinación) se guardan solo las dos
 *    filas de los tiradores que nos interesan.
 *
 * Los dos tiradores son los dos internacionales reales que hay de alta en la
 * aplicación, así que el fixture cubre el camino completo: censo -> candidato
 * -> ficha -> licencia -> puesto mundial.
 */

const OBJETIVOS = [
  { nombre: 'LLAVADOR', fieId: 21966, weapon: 'F', gender: 'M', category: 'S' },
  { nombre: 'MARINO', fieId: 24463, weapon: 'F', gender: 'F', category: 'S' },
];

const SEASON = 2027;

/** Campos que NO se guardan nunca. Ver la cabecera. */
const A_BORRAR = [
  'biography',
  'graceNoteBiography',
  'fencerBiography',
  'medals',
  'futureCompetitions',
  'introUrl',
  'olympicMedals',
  'olympicTeamMedals',
  'worldChampionshipMedals',
  'worldChampionshipTeamMedals',
  'weaponRanking',
  'fencerRanks',
] as const;

const capturado: Record<string, unknown> = {};

for (const objetivo of OBJETIVOS) {
  const urlCenso = `${fieCensoUrl('ESP', 1, 100)}&name=${objetivo.nombre}`;
  capturado[urlCenso] = await fetchJson<unknown>(urlCenso, { timeoutMs: 60_000 });
  console.log('censo', objetivo.nombre, 'ok');

  const urlFicha = fieFichaApiUrl(objetivo.fieId);
  const ficha = (await fetchJson<Record<string, unknown>>(urlFicha, {
    timeoutMs: 60_000,
  })) as Record<string, unknown>;
  for (const campo of A_BORRAR) delete ficha[campo];
  capturado[urlFicha] = ficha;
  console.log('ficha', objetivo.fieId, 'ok');

  const urlDetallado = fieDetailedRankingUrl({
    season: SEASON,
    weapon: objetivo.weapon,
    gender: objetivo.gender,
    category: objetivo.category,
  });
  const detallado = await fetchJson<{
    fencers?: { addrId?: number }[];
    competitions?: unknown[];
  }>(urlDetallado, { timeoutMs: 90_000 });
  capturado[urlDetallado] = {
    ...detallado,
    // Solo la fila que nos interesa, y sin el catálogo de competiciones.
    competitions: [],
    fencers: (detallado.fencers ?? []).filter((f) => f.addrId === objetivo.fieId),
  };
  console.log('detailed-ranking', objetivo.nombre, 'ok');
}

const destino = new URL('../tests/fixtures/fie-tiradores.json.gz', import.meta.url);
writeFileSync(destino, gzipSync(Buffer.from(JSON.stringify(capturado, null, 1))));
console.log('\nescrito', destino.pathname, Object.keys(capturado).length, 'respuestas');
