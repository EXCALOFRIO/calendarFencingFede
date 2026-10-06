/**
 * Clasificaciones de Skermo (RFEE) de pruebas del catálogo nacional que se
 * publicaron después de la última sincronización, como hechos `skermo_rfee`
 * con las mismas claves que usa la ingesta de Skermo (`RFEE:<id>` y
 * `competition:RFEE:<id>`), para que el cargador rellene esa prueba y no cree otra.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/rfee-tnr-2026-10.ts \
 *     [--ids 10348,10351,10349] [--salida <calendario-trabajo/hechos/rfee-tnr-2026-10>] [--refrescar]
 *
 * Cada página queda en `cache-huecos-2026/skermo/` y se reutiliza salvo con
 * `--refrescar`. Skermo publica la clasificación con licencia, no los asaltos.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type HechosPrueba, type ResultadoHecho } from '../../src/lib/ingest/hechos/formato';
import { parseSkermoCompetitionResults } from '../../src/lib/ingest/sources/skermo-results';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import { sha256, USER_AGENT } from './fie-huecos-comun';

const CACHE = join(CARPETA_TRABAJO, 'cache-huecos-2026', 'skermo');
const SALIDA = join(CARPETA_TRABAJO, 'hechos', 'rfee-tnr-2026-10');
const urlPrueba = (id: string) => `https://app.skermo.org/ranking/public/RFEE/competition/${id}?setLang=es`;

async function pagina(id: string, refrescar: boolean): Promise<Uint8Array> {
  const ruta = join(CACHE, `${id}.html`);
  if (!refrescar && existsSync(ruta)) return new Uint8Array(readFileSync(ruta));
  const res = await fetch(urlPrueba(id), { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (res.status !== 200) throw new Error(`Skermo HTTP ${res.status} ${urlPrueba(id)}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(ruta, bytes);
  await new Promise((r) => setTimeout(r, 700));
  return bytes;
}

export function hechosSkermo(id: string, html: string, huella: string): HechosPrueba | null {
  const { meta, rows } = parseSkermoCompetitionResults(html, { federationCode: 'RFEE', competitionId: id });
  if (rows.length === 0) return null;
  if (!meta.weapon || !meta.gender || !meta.format || !meta.seasonLabel) {
    throw new Error(`Cabecera de Skermo incompleta en ${id}: ${JSON.stringify(meta)}`);
  }
  const usados = new Set<string>();
  const results: ResultadoHecho[] = rows.map((r, i) => {
    const base = r.sourceLicense ? `lic:${r.sourceLicense}` : `skermo:${id}:${i + 1}`;
    let k = base;
    for (let n = 2; usados.has(k); n += 1) k = `${base}~${n}`;
    usados.add(k);
    const anio = r.sourceBirthDate ? Number(r.sourceBirthDate.slice(0, 4)) : null;
    return {
      factKey: k, name: r.sourceAthleteName, countryCode: null, club: r.sourceClub,
      position: r.position && r.position > 0 ? r.position : null, positionRaw: r.positionRaw,
      points: r.officialPoints, fieId: null, license: r.sourceLicense, birthYear: anio,
    };
  });
  const ultimo = Math.max(0, ...results.map((r) => r.position ?? 0));
  const completo = ultimo <= results.length;
  return hechosPrueba.parse({
    version: 1,
    source: 'skermo_rfee',
    extractor: 'skermo_resultados',
    sourceUrl: meta.sourceUrl,
    sourceSha256: huella,
    edition: {
      season: meta.seasonLabel, tournamentKey: `competition:RFEE:${id}`, name: meta.name,
      startDate: meta.date, endDate: meta.date, city: meta.city, countryCode: null,
    },
    competition: {
      competitionKey: `RFEE:${id}`, weapon: meta.weapon, gender: meta.gender,
      category: meta.category ?? 'ABS', categoryRaw: meta.categoryRaw, format: meta.format, date: meta.date,
    },
    status: {
      results: completo ? 'completo' : 'parcial', pools: 'sin_resultados', tableau: 'sin_resultados',
      publishedParticipants: results.length,
      notes: [
        'Clasificación publicada en Skermo (ranking público RFEE); Skermo no publica poules ni cuadro',
        ...(completo ? [] : [`Clasificación incompleta: último puesto ${ultimo} con ${results.length} filas`]),
      ],
    },
    results,
    bouts: [],
  });
}

async function main() {
  const ids = argumento('ids', '10348,10351,10349').split(',').map((s) => s.trim()).filter(Boolean);
  const salida = argumento('salida', SALIDA);
  const refrescar = bandera('refrescar');
  mkdirSync(salida, { recursive: true });
  for (const id of ids) {
    const bytes = await pagina(id, refrescar);
    const h = hechosSkermo(id, new TextDecoder('utf-8').decode(bytes), sha256(bytes));
    if (!h) {
      console.log(`${id}: sin clasificación publicada`);
      continue;
    }
    writeFileSync(join(salida, ficheroHechos(h)), `${JSON.stringify(h, null, 1)}\n`);
    const conLicencia = h.results.filter((r) => r.license).length;
    console.log(`${id}: ${h.edition.name} ${h.competition.weapon} ${h.competition.gender} ${h.competition.category} ${h.competition.date} ${h.edition.city}: ${h.results.length} puestos (${conLicencia} con licencia), ${h.status.results}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
