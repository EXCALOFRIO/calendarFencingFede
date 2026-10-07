import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { cargarHechos, type EntradaHechos } from '../scripts/indexado/cargar-hechos';
import { claveRegistro, registrosNuevo7 } from '../scripts/indexado/cobertura';
import { quitarGuardia, restaurarGuardia } from '../scripts/indexado/comun';
import { emparejarPuestos, planificar, recuperar, registrosConPlan, type Lectura } from '../scripts/indexado/lote9-rfee-engarde-recuperar';
import { depurarSolapesEngarde } from '../scripts/indexado/medir-solapes';
import { hechosPrueba, type HechosPrueba } from '../src/lib/ingest/hechos/formato';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  return db;
}

const ESP = ['GARCIA Ana', 'LOPEZ Eva', 'PEREZ Luz', 'RUIZ Sara', 'DIAZ Marta'];
const FUERA = ['ROSSI Giulia', 'MULLER Anna', 'DUPONT Claire', 'SMITH Kate', 'NOVAK Petra', 'KOWALSKA Ola', 'IVANOVA Mila'];
const ref = (n: string) => `engarde:${n.toLowerCase()}|`;

type Opciones = {
  source: HechosPrueba['source'];
  clave: string;
  fecha: string;
  nombres: string[];
  puestos?: (number | null)[];
  gender?: 'F' | 'M' | 'MIXTO';
  poules?: boolean;
  cuadro?: boolean;
  category?: 'ABS' | 'M11';
};

function hechos(o: Opciones): HechosPrueba {
  const ns = o.nombres;
  const bouts = [] as Record<string, unknown>[];
  if (o.poules) {
    for (let i = 0; i < ns.length; i += 1) {
      for (let j = i + 1; j < ns.length; j += 1) {
        bouts.push({ phase: 'POULE', roundKey: 'P1', aRef: ref(ns[i]), bRef: ref(ns[j]), aName: ns[i], bName: ns[j], scoreA: 5, scoreB: j - i });
      }
    }
  }
  if (o.cuadro) {
    // Cuadro de 4: semifinales 1-4 y 2-3, final 1-2.
    bouts.push({ phase: 'TABLEAU', roundKey: 'T4', aRef: ref(ns[0]), bRef: ref(ns[3]), aName: ns[0], bName: ns[3], scoreA: 15, scoreB: 6 });
    bouts.push({ phase: 'TABLEAU', roundKey: 'T4', aRef: ref(ns[1]), bRef: ref(ns[2]), aName: ns[1], bName: ns[2], scoreA: 15, scoreB: 9 });
    bouts.push({ phase: 'TABLEAU', roundKey: 'T2', aRef: ref(ns[0]), bRef: ref(ns[1]), aName: ns[0], bName: ns[1], scoreA: 15, scoreB: 12 });
  }
  const tk = o.clave.split('/').slice(0, -1).join('/') || `t:${o.clave}`;
  return hechosPrueba.parse({
    version: 1, source: o.source, extractor: `lector_${o.source}`,
    sourceUrl: `https://ejemplo.test/${o.clave}`, sourceSha256: 'a'.repeat(64),
    edition: { season: '2024-2025', tournamentKey: tk, name: `Prueba ${o.clave}`, startDate: o.fecha, endDate: o.fecha, city: null, countryCode: null },
    competition: { competitionKey: o.clave, weapon: 'FLORETE', gender: o.gender ?? 'F', category: o.category ?? 'ABS', categoryRaw: null, format: 'INDIVIDUAL', date: o.fecha },
    status: { results: 'completo', pools: 'completo', tableau: 'completo', publishedParticipants: ns.length, notes: [] },
    results: ns.map((n, i) => ({
      factKey: o.source === 'fie' ? String(1000 + i) : `${o.source}:${n.toLowerCase()}`, name: n,
      position: o.puestos ? o.puestos[i] : i + 1, countryCode: FUERA.includes(n) ? 'ITA' : 'ESP',
    })),
    bouts,
  });
}

let n = 0;
const entrada = (h: HechosPrueba): EntradaHechos => ({ ruta: `f${(n += 1)}.json`, carpeta: 'prueba', leer: () => h });
const lectura = (h: HechosPrueba): Lectura => ({ ruta: `hechos/${h.competition.competitionKey}.json`, hechos: h });
const cuenta = (db: DatabaseSync, sql: string, ...p: string[]) => Number((db.prepare(sql).get(...p) as { n: number }).n);

// TNR del domingo: 5 españoles en Skermo; Engarde trae además 2 extranjeros. El satélite FIE del sábado,
// en la misma sede, tiene a los 5 españoles y 7 extranjeros (menos de la mitad de los suyos en el TNR).
const skermoTnr = hechos({ source: 'skermo_rfee', clave: 'RFEE:1', fecha: '2024-10-26', nombres: ESP });
const satelite = hechos({ source: 'fie', clave: '1391', fecha: '2024-10-26', nombres: [...ESP, ...FUERA], poules: true });
const engardeTnr = hechos({ source: 'engarde', clave: 'engarde:rfee/tnr/ff', fecha: '2024-10-27', nombres: [...ESP, 'ROSSI Giulia', 'MULLER Anna'], poules: true, cuadro: true });

function base(...hs: HechosPrueba[]): DatabaseSync {
  const db = crearBase();
  quitarGuardia(db);
  cargarHechos(db, hs.map(entrada));
  return db;
}

describe('lote9-rfee-engarde-recuperar', () => {
  it('la depuración de solapes tira el TNR de Engarde emparejado con el satélite FIE', () => {
    const db = base(skermoTnr, satelite, engardeTnr);
    const inf = depurarSolapesEngarde(db);
    expect(inf.gruposConFie).toBe(1);
    expect(cuenta(db, `SELECT count(*) n FROM sport_competition WHERE source='engarde'`)).toBe(0);
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE source='engarde'`)).toBe(0);
    expect(cuenta(db, `SELECT count(*) n FROM sport_import_coverage WHERE source='engarde'`)).toBe(0);
  });

  it('recupera poules y cuadro en la prueba Skermo sin asaltos, con personas e idempotente', () => {
    const db = base(skermoTnr, satelite, engardeTnr);
    depurarSolapesEngarde(db);
    const comp = (db.prepare(`SELECT id FROM sport_competition WHERE source='skermo_rfee'`).get() as { id: string }).id;
    db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized) VALUES ('p-ana', 'GARCIA Ana', 'ana garcia')`).run();
    db.prepare(`UPDATE sport_result SET person_id='p-ana' WHERE competition_id=? AND source_name='GARCIA Ana'`).run(comp);
    restaurarGuardia(db);
    const disparadores = cuenta(db, `SELECT count(*) n FROM sqlite_master WHERE type='trigger'`);

    const ensayo = recuperar(db, [lectura(engardeTnr)], { simular: true });
    expect(ensayo.recuperaciones[0]).toMatchObject({
      estado: 'descartada', destino: { source: 'skermo_rfee', key: 'RFEE:1', nombres: 5, comunes: 5 },
      fases: [{ fase: 'POULE', asaltos: 21 }, { fase: 'TABLEAU', asaltos: 3 }],
    });
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE competition_id=?`, comp)).toBe(0);

    const inf = recuperar(db, [lectura(engardeTnr)]);
    expect(inf.asaltosInsertados).toBe(24);
    expect(cuenta(db, `SELECT count(*) n FROM sqlite_master WHERE type='trigger'`)).toBe(disparadores);
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE competition_id=? AND source='engarde' AND phase='POULE'`, comp)).toBe(21);
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE competition_id=? AND phase='TABLEAU'`, comp)).toBe(3);
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE fencer_a_ref >= fencer_b_ref`)).toBe(0);
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE 'p-ana' IN (fencer_a_person_id, fencer_b_person_id)`)).toBe(6 + 2);
    expect(db.prepare(`SELECT fact_kind, status, imported_total FROM sport_import_coverage WHERE source='engarde' ORDER BY fact_kind`).all())
      .toEqual([{ fact_kind: 'pools', status: 'completo', imported_total: 21 }, { fact_kind: 'tableau', status: 'completo', imported_total: 3 }]);
    // El satélite no se toca.
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE source='fie'`)).toBe(66);

    const otra = recuperar(db, [lectura(engardeTnr)]);
    expect(otra.recuperaciones[0].estado).toBe('fundida');
    expect(otra.asaltosInsertados).toBe(0);
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE competition_id=?`, comp)).toBe(24);
  });

  it('no toca una lectura que es la propia prueba FIE ni una fase que la destino ya tiene', () => {
    const fie = hechos({ source: 'fie', clave: '1391', fecha: '2024-10-26', nombres: [...ESP, 'ROSSI Giulia'], poules: true });
    const db1 = base(skermoTnr, fie);
    expect(planificar(db1, [lectura(engardeTnr)])[0].estado).toBe('es_fie');

    const conPoules = hechos({ source: 'skermo_rfee', clave: 'RFEE:1', fecha: '2024-10-26', nombres: ESP, poules: true });
    const db2 = base(conPoules);
    const p = planificar(db2, [lectura(engardeTnr)])[0];
    expect(p).toMatchObject({ estado: 'descartada', fases: [{ fase: 'TABLEAU', asaltos: 3 }], fasesOmitidas: [{ fase: 'POULE', motivo: 'destino_con_asaltos' }] });

    // Ya cargada: la prueba de Engarde está en la base y la lleva el flujo normal.
    const db3 = base(skermoTnr, engardeTnr);
    expect(planificar(db3, [lectura(engardeTnr)])[0].estado).toBe('en_base');

    // Sin prueba nacional con la mayoría de sus nombres en Engarde, no hay destino.
    const otra = hechos({ source: 'skermo_rfee', clave: 'RFEE:2', fecha: '2024-10-26', nombres: ['ROSSI Giulia', ...FUERA.slice(2, 6)] });
    expect(planificar(base(otra), [lectura(engardeTnr)])[0].estado).toBe('sin_destino');
  });

  it('con --puestos rellena una destino sin puestos sólo si todos sus tiradores casan', () => {
    const pdf = hechos({ source: 'rfee_pdf', clave: 'pdf:x:M11', fecha: '2024-06-05', nombres: ESP.slice(0, 4), puestos: [null, null, null, null], category: 'M11' });
    const completa = hechos({ source: 'engarde', clave: 'engarde:rfee/crit/f11', fecha: '2024-06-05', nombres: ESP, category: 'M11', poules: true });
    const db = base(pdf, completa);
    depurarSolapesEngarde(db);
    restaurarGuardia(db);
    expect(cuenta(db, `SELECT count(*) n FROM sport_competition WHERE source='engarde'`)).toBe(0);
    const sinPuestos = planificar(db, [lectura(completa)])[0];
    expect(sinPuestos).toMatchObject({ estado: 'fundida', puestos: 0, fases: [] });
    const plan = planificar(db, [lectura(completa)], { puestos: true })[0];
    expect(plan).toMatchObject({ estado: 'fundida', puestos: 4, puestosMotivo: null });
    const inf = recuperar(db, [lectura(completa)], { puestos: true });
    expect(inf.puestosRellenados).toBe(4);
    expect((db.prepare(`SELECT source_name, position FROM sport_result WHERE source='rfee_pdf' ORDER BY position`).all()).map((r) => r.position)).toEqual([1, 2, 3, 4]);
    expect(recuperar(db, [lectura(completa)], { puestos: true }).recuperaciones[0].puestosMotivo).toBe('destino_con_puestos');

    // Engarde sin el podio (puestos desde el 5): los tiradores del podio no casan y no se toca nada.
    const sinPodio = hechos({ source: 'engarde', clave: 'engarde:rfee/crit/f11', fecha: '2024-06-05', nombres: ESP.slice(2), puestos: [5, 6, 7], category: 'M11' });
    expect(emparejarPuestos(ESP.slice(0, 4), sinPodio)).toBeNull();
  });

  it('mide en memoria lo que añadiría el plan', () => {
    const db = base(skermoTnr, satelite, engardeTnr);
    depurarSolapesEngarde(db);
    const plan = planificar(db, [lectura(engardeTnr)]);
    const antes = registrosNuevo7(db);
    const despues = registrosConPlan(antes, plan, new Map([[lectura(engardeTnr).ruta, engardeTnr]]));
    const k = 'skermo_rfee|2024-2025|RFEE:1';
    expect(antes.find((r) => claveRegistro(r) === k)).toMatchObject({ pb: 0, tb: 0 });
    expect(despues.find((r) => claveRegistro(r) === k)).toMatchObject({ pb: 21, tb: 3, poulesRondas: 1, poulesTiradores: 7 });
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE source='engarde'`)).toBe(0);
  });
});
