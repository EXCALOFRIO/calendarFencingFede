import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { hechosPrueba, type AsaltoHecho } from '@/lib/ingest/hechos/formato';
import { parsearCuadroEngarde } from '@/lib/ingest/sources/engarde-cuadro';
import { cargarHechos, type EntradaHechos } from '../scripts/indexado/cargar-hechos';
import { quitarGuardia } from '../scripts/indexado/comun';
import {
  hechosDePrueba, incoherentesCuadroEquipos, motivoEncuentro, pruebasEquipos, raizClave, tercerPuestoComoRonda,
  type PruebaEquipos,
} from '../scripts/indexado/lote7-equipos-comun';
import { encuentrosEngarde, podioDe, prepararCuadroEquipos, refsEquipos } from '../scripts/indexado/lote7-equipos-engarde';
import {
  asignar, faltas, filaCuadra, hechoVacio, prepararLineas, quePublica, sinPaginacion, validarEquipos,
} from '../scripts/indexado/lote7-equipos-pdf';
import {
  comprobarPouleImpresa, decidir, filaImpresa, firmaPoules, type PouleLeida,
} from '../scripts/indexado/lote7-equipos-correccion-pdf';
import { corregirPoules, leerCorrecciones } from '../scripts/indexado/lote7-equipos-corregir';
import { relevosDePagina } from '../scripts/indexado/lote7-equipos-relevos-engarde';

const K = 'pdf:ae19:ae19:SABLE:M:EQUIPOS:M15:';
const URL_PDF = 'https://app.skermo.org/client/1/ae19.pdf';

const prueba = (extra: Partial<PruebaEquipos> = {}): PruebaEquipos => ({
  id: 'c1', source: 'rfee_pdf', season: '2023-2024', competitionKey: K, weapon: 'SABLE', gender: 'M', category: 'M15',
  categoryRaw: 'M15', date: '2024-06-01', sourceUrl: URL_PDF,
  edition: {
    id: 'e1', tournamentKey: 'pdf:ae19', name: 'CAMPEONATO DE ESPAÑA M15', startDate: '2024-06-01', endDate: null,
    city: null, countryCode: null, sourceUrl: URL_PDF,
  },
  resultados: [], poules: 0, cuadro: 0, cobertura: {}, ...extra,
});

const enc = (roundKey: string, aName: string, bName: string, scoreA: number, scoreB: number, phase: 'POULE' | 'TABLEAU' = 'TABLEAU'): AsaltoHecho =>
  ({ phase, roundKey, aRef: aName, bRef: bName, aName, bName, scoreA, scoreB, winner: null });

// Texto de un PDF de Engarde (Cto. de España M15, sable masculino por equipos), como lo da unpdf.
const PAGINAS = [
  'CAMPEONATO DE ESPAÑA M15\nSABLE MASCULINO EQUIPOS\n01.06.2024\nVALLADOLID\nFórmula de la competencia\npágina 1/1\nEliminación directa : 8 equipos',
  'CAMPEONATO DE ESPAÑA M15\nSABLE MASCULINO EQUIPOS\npágina 1/1\n1 SAMA-M1\nTabla de 8\n8 CEHE-PO1 45/26\n5 ECC-BU1\n4 CEB-M2 45/25\n3 SAMA-M2\n6 SASLE-M1 45/32\n7 SHM-B1\n2 CEB-M1 45/28\nSAMA-M1\nSemi-finales\nECC-BU1 45/30\nSASLE-M1\nCEB-M1 45/22\nSAMA-M1\nFinal\nCEB-M1\n45/44\nSAMA-M1',
  'CAMPEONATO DE ESPAÑA M15\npágina 1/1\n1 ECC-BU1\nTercer lugar\n2 SASLE-M1 45/34\nECC-BU1',
  'CAMPEONATO DE ESPAÑA M15\nClasificación general final (orden por lugar - 8 equipos)\npágina 1/1\ncl. apellido-nom band club condición\n1 SAMA-M1\nBELTRAN GIL Pablo\n2 CEB-M1\n3 ECC-BU1\n4 SASLE-M1\n5 SAMA-M2\n6 CEB-M2\n7 SHM-B1\n8 CEHE-PO1',
];
const EQUIPOS = ['SAMA-M1', 'CEB-M1', 'ECC-BU1', 'SASLE-M1', 'SAMA-M2', 'CEB-M2', 'SHM-B1', 'CEHE-PO1'];

const cruda = (extra: Record<string, unknown> = {}) => ({
  headerLines: ['CAMPEONATO DE ESPAÑA M15', 'SABLE MASCULINO EQUIPOS', '01.06.2024'],
  weapon: 'SABLE', gender: 'M', category: 'M15', publishedTeams: 8, finalRankingHeading: 'Clasificación general final',
  status: { results: 'completo', pools: 'sin_resultados', tableau: 'completo' },
  results: EQUIPOS.map((name, i) => ({ position: i + 1, positionRaw: null, name })),
  pools: [],
  tableau: [
    { round: 'T8', aName: 'SAMA-M1', bName: 'CEHE-PO1', scoreA: 45, scoreB: 26, winner: 'A' },
    { round: 'T8', aName: 'ECC-BU1', bName: 'CEB-M2', scoreA: 45, scoreB: 25, winner: 'A' },
    { round: 'T8', aName: 'SAMA-M2', bName: 'SASLE-M1', scoreA: 32, scoreB: 45, winner: 'B' },
    { round: 'T8', aName: 'SHM-B1', bName: 'CEB-M1', scoreA: 28, scoreB: 45, winner: 'B' },
    { round: 'T4', aName: 'SAMA-M1', bName: 'ECC-BU1', scoreA: 45, scoreB: 30, winner: 'A' },
    { round: 'T4', aName: 'SASLE-M1', bName: 'CEB-M1', scoreA: 22, scoreB: 45, winner: 'B' },
    { round: 'T2', aName: 'SAMA-M1', bName: 'CEB-M1', scoreA: 45, scoreB: 44, winner: 'A' },
    { round: 'T2-3', aName: 'ECC-BU1', bName: 'SASLE-M1', scoreA: 45, scoreB: 34, winner: 'A' },
  ],
  relayBoutsWithFencerNames: false,
  ...extra,
});

const ctx = (objetivos: PruebaEquipos[], paginas = PAGINAS) => ({
  url: URL_PDF, sha256: 'b'.repeat(64), paginas, extractor: 'droid:gpt-6-luna', objetivos,
});

describe('lote7 equipos: reglas comunes', () => {
  it('valida encuentros de relevos a 45', () => {
    expect(motivoEncuentro(enc('T8', 'A', 'B', 45, 38))).toBeNull();
    expect(motivoEncuentro(enc('T8', 'A', 'B', 46, 38))).toBe('marcador_fuera_de_rango');
    expect(motivoEncuentro(enc('T8', 'A', 'B', 40, 40))).toBe('empate_sin_ganador');
    expect(motivoEncuentro({ ...enc('T8', 'A', 'B', 40, 40), winner: 'B' })).toBeNull();
    expect(motivoEncuentro({ ...enc('T8', 'A', 'B', 45, 40), winner: 'B' })).toBe('ganador_incoherente');
  });

  it('el tercer puesto leído como ronda pasa a T2-3 y el cuadro se comprueba contra el podio', () => {
    const cuadro = [enc('T4', 'A', 'B', 45, 30), enc('T4', 'C', 'D', 45, 40), enc('T2', 'B', 'D', 44, 42), enc('T2', 'A', 'C', 45, 41)];
    const r = tercerPuestoComoRonda(cuadro);
    expect(r.map((b) => b.roundKey)).toEqual(['T4', 'T4', 'T2-3', 'T2']);
    expect(incoherentesCuadroEquipos(r, { primero: 'A', segundo: 'C' }).size).toBe(0);
    // Sin reparar, el encuentro por el bronce choca con los perdedores de semifinales.
    expect([...incoherentesCuadroEquipos(cuadro)]).toEqual([2]);
    // Final con el ganador cambiado: no casa con la clasificación.
    expect([...incoherentesCuadroEquipos([enc('T2', 'A', 'C', 41, 45)], { primero: 'A', segundo: 'C' })]).toEqual([0]);
  });

  it('copia edición y prueba de la base y la raíz de una parte ~n', () => {
    const h = hechosDePrueba(prueba(), {
      extractor: 'droid:x', sourceUrl: URL_PDF, sourceSha256: 'c'.repeat(64), results: [], bouts: [enc('T2', 'A', 'B', 45, 1)],
      status: { results: 'sin_resultados', pools: 'sin_resultados', tableau: 'completo', publishedParticipants: null, notes: [] },
    });
    expect(h.competition).toMatchObject({ competitionKey: K, format: 'EQUIPOS', category: 'M15' });
    expect(h.edition.tournamentKey).toBe('pdf:ae19');
    expect(raizClave(`${K}~3`)).toBe(K);
  });
});

describe('lote7 equipos: Engarde', () => {
  const HTML = `<table class="tableau">
<tr><td></td><td class="tableTitle">Tercer lugar</td><td></td><td class="tableTitle">Semi-finales</td><td class="tableTitle">Final</td><td></td></tr>
<tr><td></td><td></td><td></td><td class="fencer">CREA-M</td><td></td><td></td></tr>
<tr><td></td><td></td><td></td><td></td><td class="fencer">CREA-M</td><td></td></tr>
<tr><td></td><td></td><td></td><td class="fencer">CEM</td><td class="score"><a>45/30 &gt;&gt;</a></td><td></td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td class="fencer">CREA-M</td></tr>
<tr><td></td><td></td><td></td><td class="fencer">CEB-M</td><td></td><td class="score"><a>45/43 &gt;&gt;</a></td></tr>
<tr><td></td><td></td><td></td><td></td><td class="fencer">CEB-M</td><td></td></tr>
<tr><td></td><td></td><td></td><td class="fencer">SAESBU</td><td class="score"><a>42/41 &gt;&gt;</a></td><td></td></tr>
</table>`;

  it('quita el «>>» del marcador y la columna de puestos dibujada a la izquierda', () => {
    expect(parsearCuadroEngarde(HTML, { individual: true }).asaltos).toHaveLength(0);
    const p = prepararCuadroEquipos(HTML);
    expect(p.sinPuestos).toBe(true);
    const c = parsearCuadroEngarde(p.html, { individual: true });
    expect(c.asaltos.map((a) => [a.ronda, ...[`${a.nombreA}:${a.puntosA}`, `${a.nombreB}:${a.puntosB}`].sort()]).sort()).toEqual([
      ['F', 'CEB-M:43', 'CREA-M:45'], ['SF', 'CEB-M:42', 'SAESBU:41'], ['SF', 'CEM:30', 'CREA-M:45'],
    ]);
  });

  it('referencia cada equipo con el factKey de su puesto guardado y deja el cuadro parcial sin el bronce', () => {
    const guardados = [
      { factKey: 'engarde:crea m|CREA-M', name: 'CREA-M', position: 1 }, { factKey: 'engarde:ceb m|CEB-M', name: 'CEB-M', position: 2 },
    ];
    const l = encuentrosEngarde([{ url: 'https://engarde-service.com/x/tableau_a4.htm', html: HTML, tipo: 'cuadro', pagina: 1, antiguo: false }], [],
      refsEquipos(guardados), podioDe(guardados));
    expect(l.tableau).toBe('parcial');
    expect(l.bouts.map((b) => b.roundKey)).toEqual(['T4', 'T4', 'T2']);
    const final = l.bouts.find((b) => b.roundKey === 'T2')!;
    expect([final.aRef, final.bRef].sort()).toEqual(['engarde:ceb m|CEB-M', 'engarde:crea m|CREA-M']);
    expect(l.bouts.find((b) => b.aName === 'CEM')?.aRef).toBe('engarde:cem|');
  });
});

describe('lote7 equipos: PDF', () => {
  it('ve qué publica el documento sin confundir la paginación con marcadores', () => {
    expect(sinPaginacion('página 1/3 45/26')).not.toMatch(/1\/3/);
    expect(quePublica(PAGINAS)).toMatchObject({ clasificacion: true, cuadro: true, poules: false });
    expect(quePublica(['TNR EQUIPOS POULE\npágina 1/1\nTableau of 8 Semi-finales Final\n'.repeat(5)]).cuadro).toBe(false);
    const pub = quePublica(PAGINAS);
    expect(faltas(prueba({ resultados: [{ factKey: 'x', name: 'SAMA-M1', position: 1 }], cobertura: { results: 'completo' } }), pub)).toEqual(['tableau']);
    expect(faltas(prueba({ cuadro: 8, resultados: [{ factKey: 'x', name: 'A', position: 1 }], cobertura: { results: 'completo', tableau: 'completo' } }), pub)).toEqual([]);
  });

  it('asigna las pruebas del modelo a las guardadas por arma, género y orden (~n)', () => {
    const objetivos = [prueba({ competitionKey: `${K}~2` }), prueba(), prueba({ competitionKey: 'otra', weapon: 'ESPADA' })];
    const a = asignar([cruda(), cruda({ headerLines: ['X', 'SABLE MASCULINO EQUIPOS'] })], objetivos);
    expect([...a.asignadas]).toEqual([[0, 1], [1, 0]]);
    const b = asignar([cruda(), cruda(), cruda()], objetivos.slice(0, 2));
    expect(b.asignadas.size).toBe(0);
    expect(b.sinAsignar.map((s) => s.motivo)).toEqual(['asignacion_ambigua', 'asignacion_ambigua', 'asignacion_ambigua']);
    expect(asignar([cruda({ headerLines: ['SABLE MASCULINO INDIVIDUAL'] })], objetivos).sinAsignar[0].motivo).toBe('cabecera_individual');
  });

  it('comprueba cada fila de poule con los tocados impresos', () => {
    const l = prepararLineas(['SAMA-M1 SAMA-M1 V V V 0.600 98 135', 'CEB-M1 CEB-M1 8 17 18 0.000 -92 43']);
    expect(filaCuadra(l, 'SAMA-M1', 135, 37)).toBe(true);
    expect(filaCuadra(l, 'CEB-M1', 43, 135)).toBe(true);
    expect(filaCuadra(l, 'CEB-M1', 45, 135)).toBe(false);
    expect(filaCuadra(l, 'OTRO', 1, 1)).toBeNull();
  });

  it('acepta el cuadro impreso, no reenvía una clasificación completa y descarta una final al revés', () => {
    const guardada = prueba({ resultados: EQUIPOS.map((name, i) => ({ factKey: `${K}:pdf:p4:y${i}`, name, position: i + 1 })), cobertura: { results: 'completo' } });
    const v = validarEquipos({ competitions: [cruda()] }, ctx([guardada]));
    expect(v.hechos).toHaveLength(1);
    const h = v.hechos[0];
    expect(hechosPrueba.parse(h).competition.competitionKey).toBe(K);
    // La clasificación guardada viaja tal cual (mismas claves), para no rebajar la cobertura del documento.
    expect(h.results.map((r) => r.factKey)).toEqual(guardada.resultados.map((r) => r.factKey));
    expect(h.status).toMatchObject({ results: 'completo', tableau: 'completo' });
    expect(h.bouts).toHaveLength(8);
    expect(h.bouts.find((b) => b.roundKey === 'T2')?.aRef).toBe(`${K}:pdf:p4:y0`);

    const alReves = cruda();
    (alReves.tableau as Record<string, unknown>[])[6] = { round: 'T2', aName: 'SAMA-M1', bName: 'CEB-M1', scoreA: 44, scoreB: 45, winner: 'B' };
    const w = validarEquipos({ competitions: [alReves] }, ctx([guardada]));
    expect(w.descartes.cuadro_incoherente).toBe(1);
    expect(w.hechos[0].bouts.some((b) => b.roundKey === 'T2')).toBe(false);
    expect(w.hechos[0].status.tableau).toBe('parcial');

    const inventado = cruda();
    (inventado.tableau as Record<string, unknown>[])[0] = { round: 'T8', aName: 'SAMA-M1', bName: 'CEHE-PO1', scoreA: 45, scoreB: 27, winner: 'A' };
    expect(validarEquipos({ competitions: [inventado] }, ctx([guardada])).descartes.cuadro_marcador_no_impreso).toBe(1);
  });

  it('envía la clasificación cuando falta y no la acepta de un documento sin clasificación final', () => {
    const v = validarEquipos({ competitions: [cruda()] }, ctx([prueba()]));
    expect(v.hechos[0].results.map((r) => [r.factKey, r.position])[0]).toEqual([`${K}:pdfd:1`, 1]);
    expect(v.hechos[0].status.results).toBe('completo');
    const sinFinal = PAGINAS.slice(0, 3);
    const w = validarEquipos({ competitions: [cruda()] }, ctx([prueba()], sinFinal));
    expect(w.hechos[0].results).toHaveLength(0);
    expect(w.descartes.resultado_sin_clasificacion_final).toBe(8);
  });

  it('una poule cuya fila no cuadra se descarta entera', () => {
    const paginas = ['LIGA ORO ABS\nFLORETE MASCULINO EQUIPOS\nPoule No 1\nV/M ind. TD cl.\nAAA-M1 AAA-M1 V V 1.000 30 90\nBBB-M1 BBB-M1 30 V 0.500 5 75\nCCC-M1 CCC-M1 30 25 0.000 -35 55\n'];
    const poule = (b: number) => cruda({
      results: [], finalRankingHeading: null, tableau: [], status: { results: 'sin_resultados', pools: 'completo', tableau: 'sin_resultados' },
      pools: [{ pool: 1, teams: ['AAA-M1', 'BBB-M1', 'CCC-M1'], bouts: [
        { aName: 'AAA-M1', bName: 'BBB-M1', scoreA: 45, scoreB: 30, winner: 'A' },
        { aName: 'AAA-M1', bName: 'CCC-M1', scoreA: 45, scoreB: 30, winner: 'A' },
        { aName: 'BBB-M1', bName: 'CCC-M1', scoreA: 45, scoreB: b, winner: 'A' },
      ] }],
    });
    const objetivo = prueba({ weapon: 'FLORETE' });
    const ok = validarEquipos({ competitions: [{ ...poule(25), headerLines: ['LIGA ORO ABS', 'FLORETE MASCULINO EQUIPOS'] }] }, ctx([objetivo], paginas));
    expect(ok.hechos[0].bouts.map((b) => b.roundKey)).toEqual(['P1', 'P1', 'P1']);
    expect(ok.hechos[0].status.pools).toBe('completo');
    const mal = validarEquipos({ competitions: [{ ...poule(20), headerLines: ['LIGA ORO ABS', 'FLORETE MASCULINO EQUIPOS'] }] }, ctx([objetivo], paginas));
    expect(mal.descartes.poule_fila_no_cuadra).toBe(3);
    expect(mal.hechos).toHaveLength(0);
  });
});

describe('lote7 equipos: carga sobre una prueba existente', () => {
  function crearBase(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
      db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
    }
    quitarGuardia(db);
    return db;
  }
  let n = 0;
  const entrada = (obj: unknown, carpeta: string): EntradaHechos => ({ ruta: `${carpeta}/f${(n += 1)}.json`, carpeta, leer: () => obj });
  const base = (p: PruebaEquipos, results: { factKey: string; name: string; position: number }[], bouts: AsaltoHecho[]) =>
    hechosDePrueba(p, {
      extractor: 'lector_pdf', sourceUrl: URL_PDF, sourceSha256: 'a'.repeat(64),
      results: results.map((r) => ({ ...r, countryCode: null, club: null, positionRaw: null, points: null, fieId: null, license: null, birthYear: null })),
      bouts,
      status: { results: results.length ? 'completo' : 'sin_resultados', pools: bouts.length ? 'completo' : 'sin_resultados', tableau: 'sin_resultados', publishedParticipants: null, notes: [] },
    });

  it('añade el cuadro sin tocar la clasificación y la parte ~2 no se absorbe', () => {
    const db = crearBase();
    const raiz = prueba();
    const parte = prueba({ competitionKey: `${K}~2` });
    const guardados = EQUIPOS.map((name, i) => ({ factKey: `${K}:pdf:p4:y${i}`, name, position: i + 1 }));
    cargarHechos(db, [
      entrada(base(raiz, guardados, []), 'pdf-lector'),
      entrada(base(parte, [], [{ ...enc('P1', 'X1', 'X2', 45, 40, 'POULE'), aRef: `${K}~2:pdfd:n:X1`, bRef: `${K}~2:pdfd:n:X2` }]), 'pdf-droid'),
    ]);
    const leida = pruebasEquipos(db, 'rfee_pdf');
    const objetivo = leida.find((p) => p.competitionKey === K)!;
    const v = validarEquipos({ competitions: [cruda()] }, ctx([objetivo]));
    const i = cargarHechos(db, [
      entrada(v.hechos[0], 'lote7-equipos'),
      entrada(hechoVacio(leida.find((p) => p.competitionKey === `${K}~2`)!, URL_PDF, '0'.repeat(64)), 'lote7-equipos'),
    ]);
    expect(i.ficheros.rechazados).toBe(0);
    expect(i.tablas.sport_result.rfee_pdf).not.toHaveProperty('borradas');
    expect(i.tablas.sport_result.rfee_pdf).not.toHaveProperty('insertadas');
    const doc = db.prepare(`SELECT status FROM sport_import_coverage WHERE fact_kind='pdf'`).all() as { status: string }[];
    expect(doc.every((d) => d.status !== 'sin_resultados')).toBe(true);
    const tras = pruebasEquipos(db, 'rfee_pdf');
    const r = tras.find((p) => p.competitionKey === K)!;
    expect(r.resultados.map((x) => x.factKey)).toEqual(guardados.map((g) => g.factKey));
    expect(r.cuadro).toBe(8);
    expect(r.cobertura).toMatchObject({ results: 'completo', tableau: 'completo' });
    expect(tras.find((p) => p.competitionKey === `${K}~2`)?.poules).toBe(1);
    expect((db.prepare(`SELECT count(*) n FROM sport_bout b JOIN sport_result r ON r.source_fact_key = b.fencer_a_ref`).get() as { n: number }).n).toBe(8);
  });
});

describe('lote7 equipos: corrección estricta de poules', () => {
  const ENGARDE = ['Poule No 1', 'SEAT 2 SEA- 41 32 0.000 -16 73 3', 'VCE-VA 2 VCE- V45 28 0.500 -13 73 2', 'SAES-BU SAES V44 V45 1.000 29 89 1'];
  const pouleEngarde = (sa = 41): PouleLeida => ({
    numero: 1, equipos: ['SEAT 2', 'VCE-VA 2', 'SAES-BU'],
    bouts: [{ a: 'SEAT 2', b: 'VCE-VA 2', sa, sb: 45, w: null }, { a: 'SEAT 2', b: 'SAES-BU', sa: 32, sb: 44, w: null }, { a: 'VCE-VA 2', b: 'SAES-BU', sa: 28, sb: 45, w: null }],
  });
  const LIGA = ['EQUIPO CLUB 1 2 3 V D V/A TD TR COEF. CLASIF.', 'AAA AAA 1 45 45 2 0 1 90 60 30 1', 'BBB BBB 2 30 45 1 1 0,5 75 75 0 2', 'CCC CCC 3 30 30 0 2 0 60 90 -30 3'];
  const pouleLiga = (orden = true): PouleLeida => ({
    numero: 1, equipos: ['AAA', 'BBB', 'CCC'],
    bouts: [{ a: 'AAA', b: 'BBB', sa: 45, sb: 30, w: null }, { a: 'AAA', b: 'CCC', sa: 45, sb: 30, w: null }, { a: orden ? 'BBB' : 'CCC', b: orden ? 'CCC' : 'BBB', sa: 45, sb: 30, w: null }],
  });

  it('cada fila cuadra en victorias, tocados, índice y puesto (Engarde y liga)', () => {
    expect(filaImpresa(ENGARDE, { nombre: 'SEAT 2', v: 0, d: 2, dados: 73, recibidos: 89 }, 3)).toEqual({ puesto: 3, formato: 'engarde' });
    expect(comprobarPouleImpresa(ENGARDE, pouleEngarde())).toBeNull();
    expect(comprobarPouleImpresa(ENGARDE, pouleEngarde(40))).toBe('fila_no_cuadra_con_lo_impreso');
    expect(comprobarPouleImpresa(LIGA, pouleLiga())).toBeNull();
    expect(comprobarPouleImpresa(LIGA, pouleLiga(false))).toBe('fila_no_cuadra_con_lo_impreso');
    // Totales iguales pero puesto impreso distinto del que dan los encuentros.
    expect(comprobarPouleImpresa(['SEAT 2 SEA- 41 32 0.000 -16 73 1', ...ENGARDE.slice(2)], pouleEngarde())).toBe('clasificacion_de_poule_no_coincide');
  });

  it('exige dos lecturas idénticas y no perder equipos', () => {
    const l = (p: PouleLeida) => ({ poules: [p], problemas: [] });
    expect(decidir([l(pouleEngarde()), l(pouleEngarde())], ENGARDE, 3)).toMatchObject({ ok: true });
    expect(decidir([l(pouleEngarde()), l(pouleEngarde(40))], ENGARDE, 3)).toEqual({ ok: false, motivo: 'las_dos_lecturas_difieren' });
    expect(decidir([l(pouleEngarde()), undefined], ENGARDE, 3)).toEqual({ ok: false, motivo: 'falta_una_de_las_dos_lecturas' });
    expect(decidir([l(pouleEngarde()), l(pouleEngarde())], ENGARDE, 4)).toEqual({ ok: false, motivo: 'menos_equipos_que_lo_guardado' });
    const otraOrientacion: PouleLeida = { ...pouleEngarde(), bouts: pouleEngarde().bouts.map((b) => ({ a: b.b, b: b.a, sa: b.sb, sb: b.sa, w: null })) };
    expect(firmaPoules([otraOrientacion])).toBe(firmaPoules([pouleEngarde()]));
  });

  it('sustituye sólo las poules de esa prueba, deja el cuadro y es idempotente', () => {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
      db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
    }
    quitarGuardia(db);
    const p = prepruebaCorreccion();
    const st = { results: 'sin_resultados' as const, pools: 'completo' as const, tableau: 'completo' as const, publishedParticipants: null, notes: [] };
    const mal = hechosDePrueba(p, {
      extractor: 'droid:x', sourceUrl: URL_PDF, sourceSha256: 'a'.repeat(64), results: [], status: st,
      bouts: [enc('P1', 'SEAT 2', 'VCE-VA 2', 41, 30, 'POULE'), enc('T2', 'SAES-BU', 'VCE-VA 2', 45, 40)],
    });
    const otra = hechosDePrueba({ ...p, competitionKey: `${K}~2` }, {
      extractor: 'droid:x', sourceUrl: URL_PDF, sourceSha256: 'a'.repeat(64), results: [], status: st, bouts: [enc('P1', 'X', 'Y', 45, 1, 'POULE')],
    });
    cargarHechos(db, [{ ruta: 'a.json', carpeta: 'x', leer: () => mal }, { ruta: 'b.json', carpeta: 'x', leer: () => otra }]);
    const bien = hechosDePrueba(p, {
      extractor: 'droid:gpt-6-luna+gpt-6-sol', sourceUrl: URL_PDF, sourceSha256: 'b'.repeat(64), results: [], status: { ...st, tableau: 'sin_resultados' },
      bouts: pouleEngarde().bouts.map((b) => enc('P1', b.a, b.b, b.sa, b.sb, 'POULE')),
    });
    const sim = corregirPoules(db, [bien], true);
    expect(sim.sustituidas).toEqual([{ prueba: K, borrados: 1, insertados: 3 }]);
    expect((db.prepare(`SELECT count(*) n FROM sport_bout WHERE phase='POULE'`).get() as { n: number }).n).toBe(2);
    const r = corregirPoules(db, [bien]);
    expect(r.sustituidas).toHaveLength(1);
    const filas = db.prepare(`SELECT c.competition_key k, b.phase, b.round_key r, b.fencer_a_name a, b.score_a sa, b.score_b sb FROM sport_bout b
      JOIN sport_competition c ON c.id=b.competition_id ORDER BY k, phase, a`).all() as { k: string; phase: string }[];
    expect(filas.filter((f) => f.k === K && f.phase === 'POULE')).toHaveLength(3);
    expect(filas.filter((f) => f.k === K && f.phase === 'TABLEAU')).toHaveLength(1);
    expect(filas.filter((f) => f.k === `${K}~2`)).toHaveLength(1);
    expect(db.prepare(`SELECT status, imported_total FROM sport_import_coverage WHERE fact_kind='pools' AND competition_key=?`).get(K))
      .toEqual({ status: 'completo', imported_total: 3 });
    expect(corregirPoules(db, [bien]).yaCorrectas).toEqual([K]);
    expect(corregirPoules(db, [{ ...bien, competition: { ...bien.competition, competitionKey: 'no-existe' } }], true).noEncontradas).toEqual(['no-existe']);
    expect(leerCorrecciones('Z:/no/existe').hechos).toEqual([]);
  });
});

function prepruebaCorreccion(): PruebaEquipos {
  return prueba({ weapon: 'ESPADA', category: 'M20' });
}

describe('lote7 equipos: relevos de Engarde', () => {
  const HTML = `<table class="tableau"></table>
<p><a name="a8-1"></a></p><h3>Tabla de 8 : SAV-V1  9/10  CREA-M1      <a href="#top">^</a></h3>
<table class="liste"><tr><th>SAV-V1</th><th>Toques</th><th>Score</th><th>Score</th><th>Toques</th><th>CREA-M1</th></tr>
<tr><td>LÓPEZ PERIS Andrea</td><td>3</td><td>3</td><td>5</td><td>5</td><td>ZALIZNA Alisa</td></tr>
<tr><td>ORTEGA LÓPEZ Maria</td><td>6</td><td>9</td><td>10</td><td>5</td><td>BERMEJO BERTET Angela</td></tr></table>
<p><a name="b2-1"/>&nbsp;<h3>Tercer lugar : AAA  -  BBB<a href="#top">^</a></p></h3><table class="liste"><tr><th>AAA</th><th>Toques</th><th>Score</th><th>Score</th><th>Toques</th><th>BBB</th></tr>
<tr><td>X Uno</td><td>5</td><td>5</td><td>2</td><td>2</td><td>Y Dos</td></tr><tr><td>X Tres</td><td>4</td><td>8</td><td>4</td><td>2</td><td></td></tr></table>`;

  it('lee cada relevo con tiradores, acumulados y tocados, y marca lo incoherente', () => {
    const e = relevosDePagina(HTML, 'https://engarde-service.com/x/tableau8.htm', 'TABLEAU');
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({
      anchor: 'a8-1', tableId: 'A8', matchNumber: 1, roundKey: 'T8', roundLabel: 'Tabla de 8',
      teamA: { name: 'SAV-V1' }, teamB: { name: 'CREA-M1' }, finalScore: { a: 9, b: 10 }, finalScoreSource: 'title', consistent: true,
    });
    expect(e[0].relays[1]).toEqual({
      n: 2, fencerA: { name: 'ORTEGA LÓPEZ Maria', team: 'SAV-V1' }, fencerB: { name: 'BERMEJO BERTET Angela', team: 'CREA-M1' },
      before: { a: 3, b: 5 }, after: { a: 9, b: 10 }, touches: { a: 6, b: 5 }, consistent: true,
    });
    expect(e[1]).toMatchObject({ roundKey: 'T2-3', finalScoreSource: 'last_relay', finalScore: { a: 8, b: 4 }, consistent: false });
    expect(e[1].relays[1]).toMatchObject({ fencerB: { name: null }, consistent: false });
  });
});
