import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { cargarHechos, lecturaUnica, nombresCompatibles, type EntradaHechos } from '../scripts/indexado/cargar-hechos';
import { quitarGuardia } from '../scripts/indexado/comun';
import { consistenciaCuadro, pesoCuadro, tamanoRonda, type AsaltoCuadro } from '../scripts/indexado/cuadro-consistencia';
import { fechasCatalogo, indiceFechas } from '../scripts/indexado/fechas-catalogo';

const c = (roundKey: string, aRef: string, bRef: string, scoreA: number, scoreB: number): AsaltoCuadro =>
  ({ roundKey, aRef, bRef, scoreA, scoreB });

describe('coherencia del cuadro', () => {
  it('reconoce el tamaño de las rondas A/T y descarta las que no lo tienen', () => {
    expect(tamanoRonda('A32')).toBe(32);
    expect(tamanoRonda('T2')).toBe(2);
    expect(tamanoRonda('T12')).toBeNull();
    expect(tamanoRonda('C2')).toBeNull();
    expect(tamanoRonda('T2-3')).toBeNull();
    expect(tamanoRonda('P1')).toBeNull();
  });

  it('un cuadro bien leído es coherente y confirma a los ganadores en la ronda siguiente', () => {
    const r = consistenciaCuadro([c('A4', 'uno', 'dos', 15, 9), c('A4', 'tres', 'cuatro', 12, 15), c('A2', 'uno', 'cuatro', 15, 14), c('T2-3', 'dos', 'tres', 15, 3)]);
    expect(r).toMatchObject({ evaluados: 3, confirmados: 2, motivos: {} });
    expect(r.incoherentes.size).toBe(0);
  });

  it('marca el tirador repetido en una ronda, la pareja repetida y el perdedor que sigue', () => {
    expect(consistenciaCuadro([c('A8', 'uno', 'dos', 15, 9), c('A8', 'uno', 'tres', 15, 4)]).motivos)
      .toEqual({ tirador_repetido_en_ronda: 2 });
    // El droid copió la semifinal como final con el ganador cambiado.
    const r = consistenciaCuadro([c('T4', 'uno', 'dos', 15, 9), c('T2', 'uno', 'dos', 9, 15)]);
    expect(r.motivos).toEqual({ pareja_repetida: 2 });
    expect([...r.incoherentes].sort()).toEqual([0, 1]);
    // Quien perdió en T8 no puede tirar en T4.
    const s = consistenciaCuadro([c('T8', 'uno', 'dos', 15, 9), c('T4', 'dos', 'tres', 15, 2)]);
    expect(s.motivos).toEqual({ perdedor_sigue: 2 });
  });

  it('pesa más la lectura con más asaltos coherentes, aunque tenga menos filas', () => {
    const buena = [c('A4', 'uno', 'dos', 15, 9), c('A4', 'tres', 'cuatro', 15, 12), c('A2', 'uno', 'tres', 15, 14)];
    const mala = [c('T4', 'uno', 'dos', 15, 9), c('T4', 'tres', 'cuatro', 15, 12), c('T2', 'uno', 'dos', 15, 9), c('T2', 'tres', 'uno', 15, 14)];
    expect(pesoCuadro(buena)).toEqual([3, 2]);
    expect(pesoCuadro(mala)[0]).toBeLessThan(pesoCuadro(buena)[0]);
  });
});

describe('fechas del catálogo nacional', () => {
  const url = 'https://app.skermo.org/client/1/abc.pdf';
  const fila = (claveCatalogo: string, fecha: string | null, arma: string, genero = 'M', temporada = '2020-2021') =>
    ({ claveCatalogo, temporada, fecha, arma, genero, categoria: 'ABS', formato: 'INDIVIDUAL' });
  const indice = indiceFechas({
    ownRfeeCatalog: [fila('k1', '2020-11-07', 'FLORETE'), fila('k2', '2020-11-08', 'ESPADA'), fila('k3', null, 'SABLE'),
      fila('k4', '2019-01-01', 'SABLE', 'M', '2018-2019')],
    readingUnits: [
      { sourceUrl: `${url}#page=1`, datos: { refOriginal: 'k1' } },
      { sourceUrl: url, datos: { refOriginal: 'k2' } },
      { sourceUrl: url, datos: { refOriginal: 'k3' } },
      { sourceUrl: url, datos: { refOriginal: 'k4' } },
    ],
    ownRfeeReadingUnits: [{ sourceUrl: url, datos: { refOriginal: 'k1' } }],
  });

  it('da inicio y fin de la edición y la fecha de cada prueba sin adivinar', () => {
    const prueba = (weapon: string) => ({ weapon, gender: 'M', category: 'ABS', format: 'INDIVIDUAL' });
    expect(fechasCatalogo(indice, '2020-2021', url)).toEqual({ inicio: '2020-11-07', fin: '2020-11-08', prueba: null });
    expect(fechasCatalogo(indice, '2020-2021', url, prueba('ESPADA')).prueba).toBe('2020-11-08');
    expect(fechasCatalogo(indice, '2020-2021', url, prueba('SABLE')).prueba).toBeNull();
    // La fila de otra temporada no fecha el PDF; sin índice no hay fecha.
    expect(fechasCatalogo(indice, '2018-2019', url)).toEqual({ inicio: '2019-01-01', fin: '2019-01-01', prueba: '2019-01-01' });
    expect(fechasCatalogo(indice, '2021-2022', url).inicio).toBeNull();
    expect(fechasCatalogo(null, '2020-2021', url).inicio).toBeNull();
    expect(indice.get(`2020-2021|${url}`)).toHaveLength(2);
  });
});

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

const K = 'pdf:abc123:ESPADA:F';
function hechos(p: { source?: 'fie' | 'rfee_pdf'; extractor: string; tableau: string; bouts: unknown[]; key?: string }) {
  const source = p.source ?? 'rfee_pdf';
  return {
    version: 1, source, extractor: p.extractor,
    sourceUrl: source === 'fie' ? 'https://fie.org/competition/2016/176' : 'https://app.skermo.org/client/1/abc123.pdf',
    sourceSha256: 'a'.repeat(64),
    edition: {
      season: '2024', tournamentKey: source === 'fie' ? 'competition:176' : 'pdf:abc123', name: 'Copa',
      startDate: '2024-01-10', endDate: null, city: null, countryCode: null,
    },
    competition: {
      competitionKey: p.key ?? (source === 'fie' ? '176' : K), weapon: 'ESPADA', gender: 'F', category: 'ABS', categoryRaw: null,
      format: 'INDIVIDUAL', date: '2024-01-11',
    },
    status: { results: 'sin_resultados', pools: 'sin_resultados', tableau: p.tableau, publishedParticipants: null, notes: [] },
    results: [],
    bouts: p.bouts,
  };
}
const t = (roundKey: string, aRef: string, bRef: string, scoreA: number, scoreB: number) =>
  ({ phase: 'TABLEAU', roundKey, aRef, bRef, aName: `N ${aRef}`, bName: `N ${bRef}`, scoreA, scoreB });
let n = 0;
const entrada = (obj: unknown, carpeta: string): EntradaHechos => ({ ruta: `f${(n += 1)}.json`, carpeta, leer: () => obj });
const rondas = (db: DatabaseSync) =>
  (db.prepare(`SELECT round_key r, fencer_a_ref a, fencer_b_ref b FROM sport_bout ORDER BY round_key DESC, a`).all() as
    { r: string; a: string; b: string }[]).map((x) => `${x.r} ${x.a}-${x.b}`);

const lector = [t('A4', 'pdf:1', 'pdf:2', 15, 9), t('A4', 'pdf:3', 'pdf:4', 15, 12), t('A2', 'pdf:1', 'pdf:3', 15, 14)];
// El droid repite la semifinal como final y saca a un perdedor en la final.
const droid = [
  t('T4', 'd:pdfd:1', 'd:pdfd:2', 15, 9), t('T4', 'd:pdfd:3', 'd:pdfd:4', 15, 12),
  t('T2', 'd:pdfd:1', 'd:pdfd:2', 15, 9), t('T2', 'd:pdfd:4', 'd:pdfd:1', 15, 14),
];

describe('cuadro rfee_pdf de una sola lectura', () => {
  it('lecturaUnica distingue una lectura de una mezcla de rondas o referencias', () => {
    const f = (round_key: string, fencer_a_ref: string, fencer_b_ref: string) => ({ round_key, fencer_a_ref, fencer_b_ref });
    expect(lecturaUnica([f('A4', 'pdf:1', 'pdf:2'), f('A2', 'pdf:1', 'pdf:3')])).toBe(true);
    expect(lecturaUnica([f('A4', 'pdf:1', 'pdf:2'), f('T2', 'pdf:1', 'pdf:3')])).toBe(false);
    expect(lecturaUnica([f('T4', 'pdf:1', 'pdf:2'), f('T2', 'd:pdfd:1', 'd:pdfd:3')])).toBe(false);
    expect(lecturaUnica([])).toBe(true);
  });

  it('elige la lectura coherente aunque el droid tenga más filas y mejor estado', () => {
    const db = crearBase();
    const i = cargarHechos(db, [
      entrada(hechos({ extractor: 'droid:opus', tableau: 'completo', bouts: droid }), 'pdf-droid'),
      entrada(hechos({ extractor: 'lector_pdf', tableau: 'parcial', bouts: lector }), 'pdf-lector'),
    ]);
    expect(i.secciones.tableau.rfee_pdf['extractor:lector_pdf']).toBe(1);
    expect(rondas(db)).toEqual(['A4 pdf:1-pdf:2', 'A4 pdf:3-pdf:4', 'A2 pdf:1-pdf:3']);
  });

  it('una lectura nueva sustituye la mezcla guardada entera; lo incoherente no entra', () => {
    const db = crearBase();
    cargarHechos(db, [entrada(hechos({ extractor: 'lector_pdf', tableau: 'parcial', bouts: lector }), 'pdf-lector')]);
    db.exec(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name,
      fencer_b_name, score_a, score_b, content_hash) SELECT 'mezcla', id, 'rfee_pdf', 'TABLEAU', 'T8', 'd:pdfd:7', 'd:pdfd:8',
      'N 7', 'N 8', 15, 3, 'h' FROM sport_competition`);
    const i = cargarHechos(db, [entrada(hechos({
      extractor: 'lector_pdf', tableau: 'parcial',
      bouts: [...lector.slice(0, 2), t('A8', 'pdf:2', 'pdf:5', 15, 1), t('A8', 'pdf:2', 'pdf:6', 15, 2)],
    }), 'pdf-lector')]);
    expect(i.secciones.tableau.rfee_pdf.reemplazo).toBe(1);
    expect(i.tablas.sport_bout.rfee_pdf).toMatchObject({ incoherentesDescartadas: 2, borradas: 2, sinCambios: 2 });
    expect(rondas(db)).toEqual(['A4 pdf:1-pdf:2', 'A4 pdf:3-pdf:4']);
  });

  it('conserva una lectura guardada más coherente que la nueva', () => {
    const db = crearBase();
    cargarHechos(db, [entrada(hechos({ extractor: 'lector_pdf', tableau: 'completo', bouts: lector }), 'pdf-lector')]);
    const i = cargarHechos(db, [entrada(hechos({ extractor: 'droid:opus', tableau: 'completo', bouts: droid }), 'pdf-droid')]);
    expect(i.secciones.tableau.rfee_pdf.conservado).toBe(1);
    expect(i.tablas.sport_bout.rfee_pdf).toMatchObject({ repetidasEntreRondas: 1, incoherentesDescartadas: 2, conservadas: 3, descartadas: 1 });
    expect(rondas(db)).toEqual(['A4 pdf:1-pdf:2', 'A4 pdf:3-pdf:4', 'A2 pdf:1-pdf:3']);
  });

  it('al conservar lo guardado borra sus asaltos incoherentes de cargas anteriores', () => {
    const db = crearBase();
    cargarHechos(db, [entrada(hechos({ extractor: 'lector_pdf', tableau: 'completo', bouts: lector }), 'pdf-lector')]);
    db.exec(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name,
      fencer_b_name, score_a, score_b, content_hash)
      SELECT 'v1', id, 'rfee_pdf', 'TABLEAU', 'A16', 'pdf:5', 'pdf:6', 'N 5', 'N 6', 15, 2, 'h' FROM sport_competition UNION ALL
      SELECT 'v2', id, 'rfee_pdf', 'TABLEAU', 'A32', 'pdf:5', 'pdf:6', 'N 5', 'N 6', 2, 15, 'h' FROM sport_competition`);
    const i = cargarHechos(db, [entrada(hechos({ extractor: 'droid:opus', tableau: 'completo', bouts: droid }), 'pdf-droid')]);
    expect(i.secciones.tableau.rfee_pdf.conservado).toBe(1);
    expect(i.tablas.sport_bout.rfee_pdf).toMatchObject({ incoherentesGuardadasBorradas: 2, conservadas: 3 });
    expect(rondas(db)).toEqual(['A4 pdf:1-pdf:2', 'A4 pdf:3-pdf:4', 'A2 pdf:1-pdf:3']);
  });
});

describe('poules rfee_pdf leídas por dos extractores', () => {
  it('nombresCompatibles admite el orden de palabras y el recorte de columna, no otro nombre', () => {
    expect(nombresCompatibles('LETE MUÑOZ-REPISO Mateo', 'LETE MUÑOZ-REPISO')).toBe(true);
    expect(nombresCompatibles('GARCIA RODRIGUEZ', 'RODRIGUEZ GARCIA')).toBe(true);
    expect(nombresCompatibles('GARCIA RODRIGUEZ', 'GARCIA LOPEZ')).toBe(false);
    expect(nombresCompatibles('RUIZ', 'RUIZ SOLA')).toBe(false);
  });

  it('con menos asaltos nuevos quita los de la otra lectura aunque discrepen en el ganador', () => {
    const db = crearBase();
    const p = (aRef: string, bRef: string, aName: string, bName: string, scoreA: number, scoreB: number) =>
      ({ phase: 'POULE', roundKey: 'P4', aRef, bRef, aName, bName, scoreA, scoreB });
    const poules = (extractor: string, bouts: unknown[]) => ({
      ...hechos({ extractor, tableau: 'sin_resultados', bouts }),
      status: { results: 'sin_resultados', pools: 'parcial', tableau: 'sin_resultados', publishedParticipants: null, notes: [] },
    });
    cargarHechos(db, [entrada(poules('lector_pdf', [
      p('pdf:1', 'pdf:2', 'LETE MUÑOZ-REPISO Mateo', 'VALE Afonso', 2, 5),
      p('pdf:3', 'pdf:4', 'BOLAÑOS Tiago', 'TOLEDO RUIZ Arturo', 3, 5),
      p('pdf:1', 'pdf:4', 'LETE MUÑOZ-REPISO Mateo', 'TOLEDO RUIZ Arturo', 5, 4),
    ]), 'pdf-lector')]);
    const i = cargarHechos(db, [entrada(poules('droid:opus', [
      p('d:pdfd:20', 'd:pdfd:n:LETE', 'VALE Afonso', 'LETE MUÑOZ-REPISO', 5, 2),
      p('d:pdfd:24', 'd:pdfd:21', 'BOLAÑOS Tiago', 'TOLEDO RUIZ Arturo', 5, 3),
    ]), 'pdf-droid')]);
    expect(i.secciones.pools.rfee_pdf.deduplicado).toBe(1);
    expect(i.tablas.sport_bout.rfee_pdf).toMatchObject({ insertadas: 2, otraLecturaBorradas: 2, conservadas: 1 });
    expect(db.prepare(`SELECT count(*) n FROM sport_bout`).get()).toEqual({ n: 3 });
  });
});

describe('cuadro FIE publicado dos veces', () => {
  it('al recargar sin la copia se borra la guardada en la otra ronda', () => {
    const db = crearBase();
    const a16 = [t('A16', '1', '2', 15, 9), t('A16', '3', '4', 15, 7)];
    cargarHechos(db, [entrada(hechos({ source: 'fie', extractor: 'lector_fie', tableau: 'completo', bouts: [...a16, t('F16', '1', '2', 15, 9)] }), 'fie')]);
    expect(rondas(db)).toHaveLength(3);
    const i = cargarHechos(db, [entrada(hechos({ source: 'fie', extractor: 'lector_fie', tableau: 'completo', bouts: a16 }), 'fie')]);
    expect(i.secciones.tableau.fie.fusion).toBe(1);
    expect(i.tablas.sport_bout.fie).toMatchObject({ repetidasOtraRondaBorradas: 1, sinCambios: 2 });
    expect(rondas(db)).toEqual(['A16 1-2', 'A16 3-4']);
  });
});
