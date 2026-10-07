/**
 * Clasificación pública de Skermo (RFEE) como hechos `skermo_rfee`, con las
 * mismas claves que la ingesta de Skermo (`RFEE:<id>` y `competition:RFEE:<id>`).
 * La usan el lote manual (`scripts/indexado/rfee-tnr-2026-10.ts`) y la ingesta
 * automática. Skermo publica la clasificación con licencia, no los asaltos.
 */
import { parseSkermoCompetitionResults } from '../sources/skermo-results';
import { hechosPrueba, type HechosPrueba, type ResultadoHecho } from './formato';

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
