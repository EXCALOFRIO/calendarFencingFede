import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { AsaltoHecho, HechosPrueba } from '../src/lib/ingest/hechos/formato';
import type { AsaltoPdf, PruebaPdf } from '../src/lib/ingest/sources/rfee-pdf/tipos';
import {
  combinarFases, completarConGuardado, contenido, faseDeClave, fasesDelDocumento, faseSegunTiradores, rondaFaseFinal, validarHechos,
} from '../scripts/indexado/pdf-relectura';
import { palabrasNombre } from '../scripts/indexado/comun';
import { aplicarCorrecciones, mismoTirador, quitarLecturasDobles, reanclarAsaltosAntiguos, trasladarFasesSinSkermo } from '../scripts/indexado/pdf-relectura-aplicar';
import { medirCuadro, medirPoules, rondaConTramo, tiradoresDeclarados } from '../scripts/indexado/pdf-relectura-comun';
import {
  estadisticaFila, gruposConfundibles, ordenarPorEliminacion, puestosCuadranConRondas, representante, resolverApariciones,
  sanear, siembrasDeCasilla, type Aparicion,
} from '../scripts/indexado/pdf-relectura-lector';

const b = (phase: 'POULE' | 'TABLEAU', roundKey: string, aName: string, scoreA: number, bName: string, scoreB: number) =>
  ({ phase, roundKey, aName, bName, scoreA, scoreB });

/** Cuadro completo de `n` tiradores (t1 el mejor sembrado): gana siempre el de mejor siembra. */
function cuadro(n: number, prefijo = 'A') {
  const primera = 2 ** Math.ceil(Math.log2(n));
  let vivos = Array.from({ length: primera }, (_, i) => (i < n ? `t${i + 1}` : null));
  const out: ReturnType<typeof b>[] = [];
  for (let s = primera; s >= 2; s /= 2) {
    const sig: (string | null)[] = [];
    for (let k = 0; k < s / 2; k += 1) {
      const [x, y] = [vivos[k], vivos[s - 1 - k]];
      if (x && y) out.push(b('TABLEAU', `${prefijo}${s}`, x, 15, y, 10));
      sig.push(x ?? y);
    }
    vivos = sig;
  }
  return out;
}

describe('medidas de completitud', () => {
  it('poules: n·(n−1)/2 por poule', () => {
    const p = [b('POULE', 'P1', 'A', 5, 'B', 1), b('POULE', 'P1', 'A', 5, 'C', 2), b('POULE', 'P1', 'B', 5, 'C', 3), b('POULE', 'P2', 'D', 5, 'E', 0)];
    expect(medirPoules(p)).toMatchObject({ poules: 2, asaltos: 4, esperados: 4, completo: true });
    expect(medirPoules(p.slice(1))).toMatchObject({ esperados: 4, asaltos: 3, completo: false, incompletas: ['P1'] });
  });

  it('cuadro de 32 con 30 tiradores: 14 + 8 + 4 + 2 + 1', () => {
    const c = cuadro(30);
    expect(c.length).toBe(29);
    const m = medirCuadro(c);
    expect(m.tramos[0].porRonda['32']).toEqual({ asaltos: 14, esperados: 14 });
    expect(m).toMatchObject({ asaltos: 29, esperados: 29, completo: true });
    // Falta un cruce de la tabla de 16: incompleto.
    expect(medirCuadro(c.filter((x, i) => !(x.roundKey === 'A16' && i === 20))).completo).toBe(false);
  });

  it('con los tiradores declarados, la primera ronda se mide entera aunque falten cruces', () => {
    const c = cuadro(24).filter((x) => x.roundKey !== 'A32' || !x.aName.endsWith('9'));
    expect(medirCuadro(c).completo).toBe(true);
    expect(medirCuadro(c, { tiradoresCuadro: { A: 24 } }).completo).toBe(false);
  });

  it('sin la ronda inicial y con muchos más puestos, el cuadro queda dudoso', () => {
    const c = cuadro(16);
    expect(medirCuadro(c, { resultados: 31, conPoules: true })).toMatchObject({ rondaInicialDudosa: true, completo: false });
    expect(medirCuadro(c, { resultados: 20, conPoules: true }).completo).toBe(true);
  });

  it('dos fases: el tramo previo A termina en la ronda que clasifica y el principal B en la final', () => {
    const previa = cuadro(40).filter((x) => ['A64', 'A32'].includes(x.roundKey));
    const principal = cuadro(16, 'B');
    const m = medirCuadro([...previa, ...principal]);
    expect(m.tramos.map((t) => [t.tramo, t.completo, t.conFinal])).toEqual([['A', true, false], ['B', true, true]]);
    expect(rondaConTramo('B64')).toEqual({ tramo: 'B', tamano: 64 });
    expect(rondaConTramo('T2-3')).toBeNull();
  });

  it('lee los tiradores del cuadro que declara el documento', () => {
    expect(tiradoresDeclarados('Fórmula 31 tiradores Eliminación directa : 24 tiradores Direct tableau')).toBe(24);
    expect(tiradoresDeclarados('Clasificación después de poules (orden por lugar - 24 tiradores)')).toBe(24);
    expect(tiradoresDeclarados('Clasificación general final')).toBeNull();
  });
});

const pdf = (fase: 'POULE' | 'TABLEAU', ronda: string, refA: string, puntosA: number, refB: string, puntosB: number, pagina = 1, y = 500): AsaltoPdf => ({
  fase, ronda, rondaOriginal: ronda, refA, refB, nombreA: refA, nombreB: refB, puntosA, puntosB, marcador: 'explicito',
  region: { pagina, yMax: y + 8, yMin: y - 24 },
});

describe('nombres confundibles', () => {
  it('agrupa los nombres con un prefijo común largo y representa el grupo por él', () => {
    const reg = [
      { ref: 'p1', nombre: 'FERNÀNDEZ HERNÀNDEZ Erik', club: 'CESJV-B' },
      { ref: 'p2', nombre: 'FERNÀNDEZ HERNÀNDEZ Alan', club: 'CESJV-B' },
      { ref: 'p3', nombre: 'MARCOS PERAL Enrique', club: 'CCC-M' },
      { ref: 'p4', nombre: 'MARTIN DJEMAI Selyan', club: 'SAMA-M' },
    ];
    const g = gruposConfundibles(reg);
    expect(g.map((x) => x.map((p) => p.ref))).toEqual([['p1', 'p2']]);
    expect(representante(g[0], 'grupo:0')).toEqual({ ref: 'grupo:0', nombre: 'FERNANDEZ HERNANDEZ', club: 'CESJV-B' });
  });

  it('siembras de una casilla en rondas posteriores del cuadro', () => {
    expect(siembrasDeCasilla(16, 16, 32).sort((a, b) => a - b)).toEqual([16, 17]);
    expect(siembrasDeCasilla(4, 8, 32).sort((a, b) => a - b)).toEqual([4, 13, 20, 29]);
    expect(siembrasDeCasilla(5, 32, 32)).toEqual([5]);
  });

  it('el puesto final decide quién pierde en cada ronda', () => {
    const miembros = new Map([[0, ['erik', 'alan']]]);
    const puesto = new Map<string, number | null>([['erik', 6], ['alan', 14]]);
    const x: Aparicion[] = [
      { asalto: pdf('TABLEAU', 'A16', 'grupo:0', 9, 'otro', 15), lado: 'A', grupo: 0, ref: null },
      { asalto: pdf('TABLEAU', 'A8', 'grupo:0', 11, 'otro2', 15), lado: 'A', grupo: 0, ref: null },
    ];
    resolverApariciones(x, miembros, [], puesto);
    expect(x.map((a) => a.ref)).toEqual(['alan', 'erik']);
  });

  it('una primera fase numera tras los exentos: sólo vale el orden de eliminación', () => {
    const previos = [pdf('TABLEAU', 'A128', 'x1', 15, 'x2', 3), pdf('TABLEAU', 'A64', 'x1', 15, 'x3', 3)];
    expect(puestosCuadranConRondas(previos, new Map([['x1', 20], ['x2', 150], ['x3', 90]]))).toBe(false);
    const miembros = new Map([[0, ['marc', 'eric']]]);
    const puesto = new Map<string, number | null>([['marc', 80], ['eric', 133]]);
    const x: Aparicion[] = [
      { asalto: pdf('TABLEAU', 'A128', 'grupo:0', 11, 'rival', 15), lado: 'A', grupo: 0, ref: null },
      { asalto: pdf('TABLEAU', 'A64', 'grupo:0', 12, 'rival2', 15), lado: 'A', grupo: 0, ref: null },
    ];
    ordenarPorEliminacion(x, miembros, previos, puesto, () => null);
    expect(x.map((a) => a.ref)).toEqual(['eric', 'marc']);
  });

  it('deshace a un tirador asignado dos veces a la misma ronda', () => {
    const x: Aparicion[] = [
      { asalto: pdf('TABLEAU', 'A16', 'grupo:0', 9, 'r1', 15), lado: 'A', grupo: 0, ref: 'erik' },
      { asalto: pdf('TABLEAU', 'A16', 'grupo:0', 9, 'r2', 15), lado: 'A', grupo: 0, ref: 'erik' },
      { asalto: pdf('POULE', 'P1', 'grupo:0', 5, 'r3', 1), lado: 'A', grupo: 0, ref: 'alan' },
    ];
    sanear(x, [pdf('POULE', 'P2', 'alan', 5, 'r4', 2)]);
    expect(x.map((a) => a.ref)).toEqual([null, null, null]);
  });

  it('estadística de una fila de poule para casarla con la clasificación tras poules', () => {
    const e = estadisticaFila([
      { a: pdf('POULE', 'P3', 'g', 2, 'x', 5), lado: 'A' }, { a: pdf('POULE', 'P3', 'x', 5, 'g', 3), lado: 'B' },
      { a: pdf('POULE', 'P3', 'g', 1, 'y', 5), lado: 'A' }, { a: pdf('POULE', 'P3', 'g', 5, 'z', 1), lado: 'A' },
      { a: pdf('POULE', 'P3', 'g', 5, 'w', 0), lado: 'A' },
    ]);
    expect(e).toEqual({ vm: '0.400', ind: 0, td: 16 });
  });
});

const hechos = (clave: string, results: { factKey: string; name: string; position: number | null }[], bouts: Partial<AsaltoHecho>[]): HechosPrueba => ({
  version: 1, source: 'rfee_pdf', extractor: 'lector_pdf', sourceUrl: 'https://app.skermo.org/client/1/abc.pdf', sourceSha256: 'a'.repeat(64),
  edition: { season: '2024-2025', tournamentKey: 'pdf:abc', name: 'TNR ABS', startDate: '2024-12-06', endDate: '2024-12-07', city: null, countryCode: null },
  competition: { competitionKey: `pdf:abc:${clave}`, weapon: 'ESPADA', gender: 'M', category: 'ABS', categoryRaw: null, format: 'INDIVIDUAL', date: '2024-12-06' },
  status: { results: 'completo', pools: 'completo', tableau: 'completo', publishedParticipants: null, notes: [] },
  results: results.map((r) => ({ ...r, countryCode: null, club: null, positionRaw: null, points: null, fieId: null, license: null, birthYear: null })),
  bouts: bouts.map((x) => ({ phase: 'POULE', roundKey: 'P1', aRef: '', bRef: '', aName: '', bName: '', scoreA: 0, scoreB: 0, winner: null, ...x }) as AsaltoHecho),
});

describe('pruebas en dos fases', () => {
  const h1 = hechos('abc:ESPADA:M:INDIVIDUAL:ABS:~2', [
    { factKey: 'f1:1', name: 'GARCIA LOPEZ Juan', position: 1 }, { factKey: 'f1:2', name: 'PEREZ RUIZ Ana', position: 2 },
    { factKey: 'f1:3', name: 'SOTO MAS Luis', position: 3 },
  ], [
    { roundKey: 'P1', aRef: 'f1:1', bRef: 'f1:3', aName: 'GARCIA LOPEZ Juan', bName: 'SOTO MAS Luis', scoreA: 5, scoreB: 2 },
    { phase: 'TABLEAU', roundKey: 'A64', aRef: 'f1:1', bRef: 'f1:2', aName: 'GARCIA LOPEZ Juan', bName: 'PEREZ RUIZ Ana', scoreA: 15, scoreB: 9 },
  ]);
  const h2 = hechos('abc:ESPADA:M:INDIVIDUAL:ABS:', [
    { factKey: 'f2:1', name: 'EXENTO UNO Pablo', position: 1 }, { factKey: 'f2:2', name: 'GARCIA LOPEZ Juan', position: 2 },
  ], [
    { roundKey: 'P2', aRef: 'f2:1', bRef: 'f2:2', aName: 'EXENTO UNO Pablo', bName: 'GARCIA LOPEZ Juan', scoreA: 5, scoreB: 4 },
    { phase: 'TABLEAU', roundKey: 'A2', aRef: 'f2:1', bRef: 'f2:2', aName: 'EXENTO UNO Pablo', bName: 'GARCIA LOPEZ Juan', scoreA: 15, scoreB: 14 },
  ]);

  it('reconoce la 1ª fase y la fase final por su cabecera', () => {
    const p = (cabecera: string, puestos: number): PruebaPdf => ({
      clave: cabecera, cabecera: [cabecera], arma: 'ESPADA', genero: 'M', formato: 'INDIVIDUAL', categoria: 'ABS', categoriaOriginal: null,
      cohorte: null, categoriaPublicada: null, fecha: null, paginas: [], puestos: Array.from({ length: puestos }) as PruebaPdf['puestos'],
      asaltos: [pdf('POULE', 'P1', 'a', 5, 'b', 1)], excluidos: {} as PruebaPdf['excluidos'], rechazos: [],
      cobertura: {} as PruebaPdf['cobertura'], estado: 'completo',
    });
    const r = fasesDelDocumento([p('TNR ABS 2ª FASE', 96), p('TNR ABS 1ª FASE', 228)]);
    expect(r.map((x) => [x.primera.clave, x.final.clave])).toEqual([['TNR ABS 1ª FASE', 'TNR ABS 2ª FASE']]);
    expect(fasesDelDocumento([p('TNR ABS', 209), p('TNR ABS FASE FINAL', 96)])).toHaveLength(1);
    expect(fasesDelDocumento([p('CTO ESPAÑA M20', 40), p('CTO ESPAÑA M23', 31)])).toHaveLength(0);
  });

  it('une las fases: poules de la final en la vuelta 2, cuadro principal B, puestos de la final', () => {
    const h = combinarFases(h1, h2, 'abc');
    expect(h.competition.competitionKey).toBe('pdf:abc:abc:ESPADA:M:INDIVIDUAL:ABS:FASES');
    expect(h.bouts.map((x) => `${x.roundKey}:${x.aRef}-${x.bRef}`)).toEqual(['P1:f2:2-f1:3', 'A64:f2:2-f1:2', 'V2P2:f2:1-f2:2', 'B2:f2:1-f2:2']);
    expect(h.results.map((r) => r.factKey)).toEqual(['f2:1', 'f2:2']);
    // Sin Skermo, los eliminados en la 1ª fase van detrás, en su orden.
    const sin = combinarFases(h1, h2, 'abc', false);
    expect(sin.results.map((r) => [r.name, r.position, r.positionRaw])).toEqual([
      ['EXENTO UNO Pablo', 1, null], ['GARCIA LOPEZ Juan', 2, null], ['PEREZ RUIZ Ana', 3, '1ª fase: 2'], ['SOTO MAS Luis', 4, '1ª fase: 3'],
    ]);
    expect(rondaFaseFinal('POULE', 'V2P3', 1)).toBe('V3P3');
    expect(rondaFaseFinal('TABLEAU', 'T16', 1)).toBe('B16');
  });

  it('decide la fase de un asalto guardado por sus tiradores', () => {
    const fase = faseSegunTiradores(h1.results, h2.results);
    expect(fase(b('POULE', 'P1', 'PEREZ RUIZ Ana', 5, 'SOTO MAS Luis', 1))).toBe(1);
    expect(fase(b('POULE', 'P4', 'EXENTO UNO Pablo', 5, 'GARCIA LOPEZ Juan', 1))).toBe(2);
    expect(fase(b('POULE', 'P4', 'EXENTO UNO Pablo', 5, 'SOTO MAS Luis', 1))).toBeNull();
  });
});

describe('validación y unión con lo guardado', () => {
  const base = hechos('abc:FLORETE:M:INDIVIDUAL:M23:', [
    { factKey: 'r1', name: 'UNO PRIMERO Ana', position: 1 }, { factKey: 'r2', name: 'DOS SEGUNDO Bea', position: 2 },
    { factKey: 'r3', name: 'TRES TERCERO Cris', position: 3 }, { factKey: 'r4', name: 'CUATRO CUARTO Dani', position: 4 },
  ], [
    { roundKey: 'P1', aRef: 'r1', bRef: 'r2', aName: 'UNO PRIMERO Ana', bName: 'DOS SEGUNDO Bea', scoreA: 5, scoreB: 3 },
    { phase: 'TABLEAU', roundKey: 'A2', aRef: 'r1', bRef: 'r2', aName: 'UNO PRIMERO Ana', bName: 'DOS SEGUNDO Bea', scoreA: 15, scoreB: 12 },
  ]);

  it('quita marcadores imposibles, parejas repetidas y cruces incoherentes', () => {
    const malo = { ...base, bouts: [
      ...base.bouts,
      { ...base.bouts[0], scoreA: 4 },
      { ...base.bouts[0], roundKey: 'P1', aRef: 'r3', bRef: 'r4', aName: 'TRES TERCERO Cris', bName: 'CUATRO CUARTO Dani', scoreA: 9, scoreB: 2 },
      { ...base.bouts[1], roundKey: 'A4', bRef: 'r3', bName: 'TRES TERCERO Cris', scoreA: 3, scoreB: 15 },
    ] };
    const v = validarHechos(malo);
    expect(v.problemas).toMatchObject({ poule_pareja_repetida: 1, poule_marcador_invalido: 1, cuadro_incoherente: 2 });
    expect(v.hechos.bouts).toHaveLength(1);
  });

  it('añade lo guardado que la relectura no trae, sin repetir ni romper poules', () => {
    const guardados = [
      b('POULE', 'P1', 'UNO PRIMERO A', 5, 'DOS SEGUNDO B', 3),
      b('POULE', 'P2', 'TRES TERCERO C', 5, 'CUATRO CUARTO D', 1),
      b('POULE', 'P2', 'UNO PRIMERO A', 5, 'TRES TERCERO C', 1),
      b('POULE', 'P2', 'DESCONOCIDO X', 5, 'TRES TERCERO C', 1),
      b('TABLEAU', 'T4', 'UNO PRIMERO Ana', 15, 'TRES TERCERO Cris', 2),
      b('TABLEAU', 'T4', 'UNO PRIMERO Ana', 15, 'CUATRO CUARTO Dani', 2),
    ];
    const r = completarConGuardado(base, guardados);
    expect(r.añadidos).toEqual({ poules: 1, cuadro: 1 });
    expect(r.descartados).toBe(3);
    expect(r.hechos.bouts.slice(2).map((x) => `${x.roundKey}:${x.aRef}-${x.bRef}`)).toEqual(['P2:r3-r4', 'A4:r1-r3']);
  });

  it('toma de lo guardado el nombre más largo del mismo tirador, en todos sus asaltos', () => {
    const corto = hechos('abc:SABLE:M:INDIVIDUAL:M20:', [
      { factKey: 'r1', name: 'SANTAMARIA G', position: 1 }, { factKey: 'r2', name: 'SANTAMARIA G', position: 2 },
      { factKey: 'r3', name: 'LILLO ROVIRA', position: 3 },
    ], [
      { phase: 'TABLEAU', roundKey: 'A2', aRef: 'r1', bRef: 'r2', aName: 'SANTAMARIA G', bName: 'SANTAMARIA G', scoreA: 15, scoreB: 11 },
      { phase: 'TABLEAU', roundKey: 'A4', aRef: 'r1', bRef: 'r3', aName: 'SANTAMARIA G', bName: 'LILLO ROVIRA', scoreA: 15, scoreB: 3 },
    ]);
    const r = completarConGuardado(corto, [b('TABLEAU', 'T2', 'SANTAMARIA GUIL', 15, 'SANTAMARIA GAR', 11)]);
    expect(r.hechos.bouts.map((x) => [x.aName, x.bName])).toEqual([
      ['SANTAMARIA GUIL', 'SANTAMARIA GAR'],
      ['SANTAMARIA GUIL', 'LILLO ROVIRA'],
    ]);
  });

  it('contenido de una lectura en otra, como multiconjunto', () => {
    expect(contenido(['a', 'a', 'b'], ['a', 'b', 'c'])).toBeCloseTo(2 / 3);
    expect(contenido([], ['a'])).toBe(1);
  });
});

describe('aplicar correcciones en la copia', () => {
  it('borra lo sustituido sólo si la sustituta está cargada y corrige atributos de Engarde', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE sport_edition (id TEXT PRIMARY KEY);
      CREATE TABLE sport_competition (id TEXT PRIMARY KEY, edition_id TEXT, source TEXT, season TEXT, competition_key TEXT,
        weapon TEXT, gender TEXT, category TEXT, competition_date TEXT, updated_at INTEGER);
      CREATE TABLE sport_result (id TEXT PRIMARY KEY, competition_id TEXT, source_name TEXT, person_id TEXT, occurred_on TEXT);
      CREATE TABLE sport_bout (id TEXT PRIMARY KEY, competition_id TEXT, occurred_on TEXT);
      CREATE TABLE sport_import_coverage (id TEXT PRIMARY KEY, competition_id TEXT, source TEXT, season TEXT, competition_key TEXT);
      INSERT INTO sport_edition VALUES ('e1'), ('e2');
      INSERT INTO sport_competition VALUES ('vieja', 'e1', 'rfee_pdf', 's', 'k~2', 'ESPADA', 'M', 'ABS', '2024-12-06', 0),
        ('unida', 'e1', 'rfee_pdf', 's', 'k:FASES', 'ESPADA', 'M', 'ABS', '2024-12-06', 0),
        ('sola', 'e2', 'rfee_pdf', 's', 'otra~2', 'ESPADA', 'M', 'ABS', '2024-12-06', 0),
        ('eng', 'e2', 'engarde', '2019-2020', 'engarde:x/fmind', 'ESPADA', 'M', 'M20', '2020-12-08', 0);
      INSERT INTO sport_result VALUES ('r1', 'vieja', 'GARCIA Juan', 'persona1', NULL), ('r2', 'unida', 'GARCIA Juan', NULL, NULL), ('r3', 'eng', 'X', NULL, '2020-12-08');
      INSERT INTO sport_bout VALUES ('b1', 'vieja', NULL), ('b2', 'eng', '2020-12-08');
      INSERT INTO sport_import_coverage VALUES ('c1', 'vieja', 'rfee_pdf', 's', 'k~2');
    `);
    const inf = aplicarCorrecciones(db, {
      generadoEn: '',
      sustituidas: [
        { source: 'rfee_pdf', season: 's', competitionKey: 'k~2', id: 'vieja', motivo: '', porCompetitionKey: 'k:FASES' },
        { source: 'rfee_pdf', season: 's', competitionKey: 'otra~2', id: 'sola', motivo: '', porCompetitionKey: 'otra:FASES' },
      ],
      atributos: [{ source: 'engarde', season: '2019-2020', competitionKey: 'engarde:x/fmind', id: 'eng', cambios: { weapon: 'FLORETE', competition_date: '2020-12-05' }, motivo: '' }],
      catalogo: [],
    });
    expect(inf.sustituidas).toMatchObject({ borradas: 1, sinSustituta: ['otra~2'], asaltos: 1, puestos: 1, coberturas: 1, personasHeredadas: 1 });
    expect(inf.atributos).toMatchObject({ corregidas: 1 });
    expect(db.prepare(`SELECT id FROM sport_competition ORDER BY id`).all().map((r) => (r as { id: string }).id)).toEqual(['eng', 'sola', 'unida']);
    expect(db.prepare(`SELECT person_id p FROM sport_result WHERE id='r2'`).get()).toEqual({ p: 'persona1' });
    expect(db.prepare(`SELECT weapon, competition_date d FROM sport_competition WHERE id='eng'`).get()).toEqual({ weapon: 'FLORETE', d: '2020-12-05' });
    expect(db.prepare(`SELECT occurred_on o FROM sport_bout WHERE id='b2'`).get()).toEqual({ o: '2020-12-05' });
    // Idempotente.
    const otra = aplicarCorrecciones(db, { generadoEn: '', sustituidas: [{ source: 'rfee_pdf', season: 's', competitionKey: 'k~2', id: 'vieja', motivo: '', porCompetitionKey: 'k:FASES' }], atributos: [{ source: 'engarde', season: '2019-2020', competitionKey: 'engarde:x/fmind', id: 'eng', cambios: { weapon: 'FLORETE' }, motivo: '' }], catalogo: [] });
    expect(otra.sustituidas.yaNoEstaban).toBe(1);
    expect(otra.atributos.yaCorrectas).toBe(1);
    db.close();
  });

  it('lleva los asaltos que la carga dejó con otra lectura a los puestos de la relectura', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE sport_competition (id TEXT PRIMARY KEY, source TEXT, competition_key TEXT);
      CREATE TABLE sport_result (id TEXT PRIMARY KEY, competition_id TEXT, source_fact_key TEXT, source_name TEXT);
      CREATE TABLE sport_bout (id TEXT PRIMARY KEY, competition_id TEXT, source TEXT, phase TEXT, round_key TEXT,
        fencer_a_ref TEXT, fencer_b_ref TEXT, fencer_a_name TEXT, fencer_b_name TEXT, score_a INTEGER, score_b INTEGER,
        fencer_a_person_id TEXT, fencer_b_person_id TEXT, CHECK (fencer_a_ref < fencer_b_ref));
      INSERT INTO sport_competition VALUES ('c', 'rfee_pdf', 'k');
      INSERT INTO sport_result VALUES ('r1', 'c', 'n1', 'LILLO ROVIRA'), ('r2', 'c', 'n2', 'SANCHEZ MARC'), ('r3', 'c', 'n3', 'FERNANDEZ YU');
      INSERT INTO sport_bout VALUES
        ('nuevo', 'c', 'rfee_pdf', 'POULE', 'P1', 'n1', 'n2', 'LILLO ROVIRA', 'SANCHEZ MARC', 5, 2, NULL, NULL),
        ('viejo', 'c', 'rfee_pdf', 'POULE', 'P1', 'pdf:x1', 'pdf:x3', 'LILLO ROVIRA Gerar', 'FERNANDEZ YUSTE', 5, 1, NULL, NULL),
        ('repe', 'c', 'rfee_pdf', 'POULE', 'P1', 'pdf:x1', 'pdf:x2', 'LILLO ROVIRA Gerar', 'SANCHEZ MARCOS', 5, 3, NULL, NULL),
        ('girado', 'c', 'rfee_pdf', 'POULE', 'P1', 'pdf:x0', 'pdf:x2', 'FERNANDEZ YUSTE', 'SANCHEZ MARCOS', 5, 4, 'pF', 'pS'),
        ('suelto', 'c', 'rfee_pdf', 'POULE', 'P1', 'pdf:x1', 'pdf:x9', 'LILLO ROVIRA Gerar', 'OTRO NOMBRE', 5, 0, NULL, NULL);
    `);
    expect(reanclarAsaltosAntiguos(db, new Set(['k']))).toEqual({ pruebas: 1, reanclados: 2, unLado: 1, duplicadosBorrados: 1, sinCasar: 1 });
    expect(db.prepare(`SELECT id, fencer_a_ref a, fencer_b_ref b, fencer_a_name an, score_a sa, score_b sb, fencer_a_person_id pa FROM sport_bout ORDER BY id`).all()).toEqual([
      { id: 'girado', a: 'n2', b: 'n3', an: 'SANCHEZ MARC', sa: 4, sb: 5, pa: 'pS' },
      { id: 'nuevo', a: 'n1', b: 'n2', an: 'LILLO ROVIRA', sa: 5, sb: 2, pa: null },
      { id: 'suelto', a: 'n1', b: 'pdf:x9', an: 'LILLO ROVIRA', sa: 5, sb: 0, pa: null },
      { id: 'viejo', a: 'n1', b: 'n3', an: 'LILLO ROVIRA', sa: 5, sb: 1, pa: null },
    ]);
    db.close();
  });

  it('lee la fase de la clave de una lectura partida', () => {
    expect(faseDeClave('pdf:x:x:ESPADA:M:INDIVIDUAL:ABS:TNRABSPRIMERAFASE')).toBe(1);
    expect(faseDeClave('pdf:x:x:ESPADA:M:INDIVIDUAL:ABS:TNRABS13ABSFASEFINAL')).toBe(2);
    expect(faseDeClave('pdf:x:x:ESPADA:M:INDIVIDUAL:ABS:~3')).toBeNull();
    expect(faseDeClave('pdf:x:x:ESPADA:M:INDIVIDUAL:ABS:TNRABS13ABSFASE')).toBeNull();
  });

  it('casa el nombre recortado del PDF con el de Skermo en otro orden', () => {
    const s = new Set(palabrasNombre('GERARD GONELL TOMÁS'));
    expect(mismoTirador('GONELL TOMAS Gerard', s)).toBe(true);
    expect(mismoTirador('GONELL TOMAS Ge', s)).toBe(true);
    expect(mismoTirador('GONELL TOMA', s)).toBe(true);
    expect(mismoTirador('GONELL RUIZ', s)).toBe(false);
    expect(mismoTirador('GONELL', s)).toBe(false);
  });

  it('pasa a Skermo la fase que no tiene y la 2ª vuelta cuando sólo tiene la 1ª', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE sport_competition (id TEXT PRIMARY KEY, source TEXT, competition_key TEXT, weapon TEXT, gender TEXT,
        category TEXT, format TEXT, competition_date TEXT);
      CREATE TABLE sport_result (id TEXT PRIMARY KEY, competition_id TEXT, source_name TEXT);
      CREATE TABLE sport_bout (id TEXT PRIMARY KEY, competition_id TEXT, phase TEXT, round_key TEXT);
      CREATE TABLE sport_import_coverage (id TEXT PRIMARY KEY, competition_id TEXT, fact_kind TEXT, updated_at INTEGER);
      INSERT INTO sport_competition VALUES
        ('pdf', 'rfee_pdf', 'k:FASES', 'ESPADA', 'M', 'ABS', 'INDIVIDUAL', '2023-01-22'),
        ('sk', 'skermo_rfee', 'RFEE:1', 'ESPADA', 'M', 'ABS', 'INDIVIDUAL', '2023-01-21'),
        ('otra', 'skermo_rfee', 'RFEE:2', 'ESPADA', 'F', 'ABS', 'INDIVIDUAL', '2023-01-21');
      INSERT INTO sport_result VALUES ('r1', 'pdf', 'GONELL TOMAS Ge'), ('r2', 'pdf', 'LUGONES RUGGERI'),
        ('r3', 'sk', 'GERARD GONELL TOMAS'), ('r4', 'sk', 'JESUS ANDRES LUGONES RUGGERI'), ('r5', 'otra', 'GERARD GONELL TOMAS');
      INSERT INTO sport_import_coverage VALUES ('c1', 'pdf', 'tableau', 0), ('c2', 'pdf', 'pools', 0);
    `);
    const ins = db.prepare('INSERT INTO sport_bout VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 6; i += 1) ins.run(`p${i}`, 'pdf', 'POULE', 'P1');
    for (let i = 0; i < 4; i += 1) ins.run(`v${i}`, 'pdf', 'POULE', 'V2P1');
    for (let i = 0; i < 3; i += 1) ins.run(`t${i}`, 'pdf', 'TABLEAU', i === 0 ? 'A2' : 'B4');
    for (let i = 0; i < 7; i += 1) ins.run(`e${i}`, 'sk', 'POULE', 'P1');
    const sim = trasladarFasesSinSkermo(db, new Set(['k:FASES']), true);
    expect(sim.map((t) => [t.fase, t.rondas, t.asaltos, t.a])).toEqual([['POULE', 'segunda', 4, 'sk'], ['TABLEAU', 'todas', 3, 'sk']]);
    expect(db.prepare(`SELECT count(*) n FROM sport_bout WHERE competition_id='sk'`).get()).toEqual({ n: 7 });
    trasladarFasesSinSkermo(db, new Set(['k:FASES']));
    const por = (c: string) => db.prepare(`SELECT phase, count(*) n FROM sport_bout WHERE competition_id=? GROUP BY phase ORDER BY phase`).all(c);
    expect(por('sk')).toEqual([{ phase: 'POULE', n: 11 }, { phase: 'TABLEAU', n: 3 }]);
    expect(por('pdf')).toEqual([{ phase: 'POULE', n: 6 }]);
    expect(db.prepare(`SELECT competition_id c FROM sport_import_coverage WHERE id='c1'`).get()).toEqual({ c: 'sk' });
    expect(db.prepare(`SELECT competition_id c FROM sport_import_coverage WHERE id='c2'`).get()).toEqual({ c: 'pdf' });
    // Asaltos de Engarde ya trasladados a la prueba PDF: la relectura no los duplica.
    db.exec(`INSERT INTO sport_bout VALUES ('g1', 'pdf', 'TABLEAU', 'T2'), ('g2', 'pdf', 'TABLEAU', 'T4');
      INSERT INTO sport_import_coverage VALUES ('c3', 'pdf', 'tableau', 0);`);
    db.exec(`ALTER TABLE sport_bout ADD COLUMN source TEXT; ALTER TABLE sport_import_coverage ADD COLUMN source TEXT;
      UPDATE sport_bout SET source = CASE WHEN id LIKE 'g%' THEN 'engarde' ELSE 'rfee_pdf' END;
      UPDATE sport_import_coverage SET source = CASE WHEN id='c3' THEN 'engarde' ELSE 'rfee_pdf' END;
      INSERT INTO sport_bout VALUES ('q1', 'pdf', 'TABLEAU', 'A2', 'rfee_pdf'), ('q2', 'pdf', 'TABLEAU', 'A4', 'rfee_pdf');`);
    expect(quitarLecturasDobles(db, new Set(['k:FASES']))).toEqual([
      { competicion: 'pdf', fase: 'TABLEAU', queda: 'engarde', quitada: 'rfee_pdf', asaltos: 2 },
    ]);
    expect(db.prepare(`SELECT group_concat(id) ids FROM sport_bout WHERE competition_id='pdf' AND phase='TABLEAU'`).get()).toEqual({ ids: 'g1,g2' });
    // Con las dos vueltas ya en Skermo no se mueve nada más.
    expect(trasladarFasesSinSkermo(db, new Set(['k:FASES']), true)).toEqual([]);
    db.close();
  });
});
