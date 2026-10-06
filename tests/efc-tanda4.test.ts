import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { ciudadCanonica } from '@/lib/calendario/ciudades';
import type { CompetitionView, EventView } from '@/lib/queries/calendar';
import { aPruebaPasada, componerTramo, type FilaPruebaImportada } from '@/lib/queries/calendario-pasado-modelo';
import { pruebasVisibles } from '@/components/calendario/pasado/resultados-pasados';
import { leerConjuntaDePrueba } from '@/lib/sport/explorar/conjunta-edicion';
import { condicionesPrueba, y } from '@/lib/sport/explorar/filtros-sql';
import { nombreEdicionEfc } from '@/lib/sport/explorar/nombre-efc';
import { organizadorDe } from '@/lib/sport/explorar/organizador';
import { nombrePrueba } from '@/lib/sport/explorar/presentacion';
import { clasificarCompeticion, esFuenteInternacional, nivelMedalla } from '@/lib/sport/explorar/tipo-competicion';

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => { throw new Error('El test no puede acceder a Cloudflare'); },
}));

const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((cerrar) => cerrar()));

function base() {
  const local = localD1();
  cierres.push(local.close);
  return { s: local.sqlite, db: createD1Database(local.binding) };
}

describe('EFC: tipo, organizador y nombre', () => {
  it('el circuito cadete es Circuito europeo de la EFC, internacional', () => {
    for (const nombre of ['Cadet Circuit Antalya', 'XVI EUROPEAN EFC CIRCUIT SOFIA', 'ECC foil Moedling', 'Kneipp Cup']) {
      const c = clasificarCompeticion({ nombre, fuente: 'efc' });
      expect(c.tipo, nombre).toBe('CIRCUITO_EUROPEO');
      expect(c.corta).toBe('Circuito europeo');
      expect(c.ambito).toBe('internacional');
      expect(organizadorDe(c, 'efc')).toBe('EFC');
    }
    expect(esFuenteInternacional('efc')).toBe(true);
  });

  it('un Campeonato de Europa es de la EFC aunque llegue por la FIE, con un solo tipo', () => {
    const efc = clasificarCompeticion({ nombre: 'European Cadet Championships', fuente: 'efc' });
    const fie = clasificarCompeticion({ nombre: 'Championnats d\u2019Europe Cadets', fuente: 'fie' });
    expect(efc.tipo).toBe('CTO_EUROPA');
    expect(fie.tipo).toBe('CTO_EUROPA');
    expect(organizadorDe(efc, 'efc')).toBe('EFC');
    expect(organizadorDe(fie, 'fie')).toBe('EFC');
    const copa = clasificarCompeticion({ nombre: 'Coupe du Monde', fuente: 'fie' });
    expect(organizadorDe(copa, 'fie')).toBe('FIE');
    const tnr = clasificarCompeticion({ nombre: 'TNR ABS', fuente: 'skermo_rfee' });
    expect(organizadorDe(tnr, 'skermo_rfee')).toBe('RFEE');
  });

  it('el orden de medallas pone el Europeo sobre el circuito y éste sobre lo nacional', () => {
    expect(nivelMedalla('CTO_EUROPA')).toBeLessThan(nivelMedalla('CIRCUITO_EUROPEO'));
    expect(nivelMedalla('CIRCUITO_EUROPEO')).toBeLessThan(nivelMedalla('CTO_ESPANA'));
  });

  it('nombra la edición en castellano sin arma, género, formato ni fechas', () => {
    expect(nombreEdicionEfc('Cadet Circuit Antalya')).toBe('Circuito europeo cadete Antalya');
    expect(nombreEdicionEfc('EFC Cadet Circuit Thessaloniki - Men\u2019s Epee Individual')).toBe(
      'Circuito europeo cadete Thessaloniki',
    );
    expect(nombreEdicionEfc('ECC foil Moedling')).toBe('Circuito europeo cadete Moedling');
    expect(nombreEdicionEfc('European Cadet Championships Tallinn')).toBe('Campeonato de Europa cadete Tallinn');
    expect(nombrePrueba({ nombre: 'Cadet Circuit Segovia', formato: 'INDIVIDUAL', fuente: 'efc' })).toContain(
      'Circuito europeo cadete Segovia',
    );
  });
});

describe('EFC: filtros de Buscar', () => {
  function ediciones() {
    const { s, db } = base();
    s.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name, country_code) VALUES
      ('efc1', 'efc', '2025-2026', 't1', 'Cadet Circuit Segovia', 'ESP'),
      ('fie1', 'fie', '2026', 't2', 'Coupe du Monde', 'FRA'),
      ('fie2', 'fie', '2026', 't3', 'Championnats d''Europe', 'TUR'),
      ('sk1', 'skermo_rfee', '2025-2026', 't4', 'TNR ABS', 'ESP')`);
    return db;
  }
  async function ids(db: ReturnType<typeof ediciones>, filtros: Parameters<typeof condicionesPrueba>[0]) {
    const r = await db.all<{ id: string }>(sql`SELECT e.id FROM sport_edition e LEFT JOIN event ev0 ON ev0.id = e.event_id
      WHERE ${y(condicionesPrueba(filtros, sql`e.start_date`))} ORDER BY e.id`);
    return r.map((f) => f.id);
  }

  it('Organizador separa FIE, EFC y RFEE; el Europeo de la FIE cuenta como EFC', async () => {
    const db = ediciones();
    expect(await ids(db, { organizador: 'EFC' })).toEqual(['efc1', 'fie2']);
    expect(await ids(db, { organizador: 'FIE' })).toEqual(['fie1']);
    expect(await ids(db, { organizador: 'RFEE' })).toEqual(['sk1']);
  });

  it('Internacional incluye la EFC aunque su sede sea española', async () => {
    const db = ediciones();
    expect(await ids(db, { ambito: 'INTERNACIONAL' })).toEqual(['efc1', 'fie1', 'fie2']);
  });
});

describe('EFC en el calendario ya celebrado', () => {
  const ESTADO: CompetitionView['status'] = {
    state: 'cerrado', label: 'Inscripción cerrada', next: null, daysLeft: null,
    currentSurchargeEur: null, nextSurchargeEur: null, closed: true, hasEstimates: false,
  };
  const prueba = (sobre: Partial<CompetitionView>): CompetitionView => ({
    id: 'ec', weapon: 'ESPADA', gender: 'M', category: 'M17', categoryRaw: null, format: 'INDIVIDUAL',
    competitionDate: '2026-10-03', installationOpen: null, callTime: null, scratchTime: null, startTime: null,
    registrationCount: null, feeEur: null, sourceUrl: null, deadlines: [], status: ESTADO, datosExtraidos: [], ...sobre,
  });
  const tesalonica: EventView = {
    id: 'ev-tes', source: 'skermo_rfee', sourceUrl: null, name: 'CIRCUITO EUROPEO CADETE', startDate: '2026-10-03',
    endDate: '2026-10-04', venue: null, venueAddress: null, city: 'TESALÓNICA', country: 'GR', geoLat: null, geoLon: null,
    timezone: null, officialSite: null, imageUrl: null, circuit: 'ECC', scope: 'INTERNACIONAL', regionalFederation: null,
    notes: null, lastSeenAt: new Date(0), disappearedAt: null,
    competitions: [prueba({ id: 'ec-m' }), prueba({ id: 'ec-f', gender: 'F' })],
    documents: [], liveLinks: [], linkedEvents: [], sources: [], imageSource: null, circuitFie: null, datosExtraidos: [],
  };
  const fila = (sobre: Partial<FilaPruebaImportada>): FilaPruebaImportada => ({
    id: 'x', edicionId: 'se-em', fuente: 'efc', temporada: '2026-2027', arma: 'ESPADA', genero: 'M', categoria: 'M17',
    formato: 'INDIVIDUAL', fecha: '2026-10-03', url: null, edicion: 'Cadet Circuit Thessaloniki', inicio: '2026-10-03',
    fin: '2026-10-05', ciudad: 'Thessaloniki', pais: 'GRE', urlEdicion: null, conResultados: 1, ganador: 'PAPADOPOULOS Nikos\u001fGRE',
    ...sobre,
  });

  it('la sede en inglés es la misma que en castellano', () => {
    expect(ciudadCanonica('thessaloniki')).toBe('tesalonica');
    expect(ciudadCanonica('tesalonica')).toBe('tesalonica');
    expect(ciudadCanonica('segovia')).toBe('segovia');
  });

  it('ata la prueba EFC al torneo del calendario y suma las de equipos de su edición', () => {
    const t = componerTramo({
      desde: '2026-10-01', hasta: '2026-10-31', calendario: [tesalonica], cruces: [],
      importadas: [
        fila({ id: 'em' }),
        fila({ id: 'em-eq', formato: 'EQUIPOS', fecha: '2026-10-05' }),
        fila({ id: 'otra', edicionId: 'se-otra', ciudad: 'Budapest', fecha: '2026-10-17', edicion: 'Cadet Circuit Budapest' }),
      ],
    });
    expect(t.resultados['ev-tes'].map((p) => p.id).sort()).toEqual(['em', 'em-eq']);
    expect(t.importados).toHaveLength(1);
    const suelto = t.eventos.find((e) => e.id === t.importados[0])!;
    expect(suelto.city).toBe('Budapest');
    expect(t.resultados[suelto.id][0].fuente).toBe('efc');
  });

  it('ata la edición aunque el calendario feche el individual otro día del torneo', () => {
    const t = componerTramo({
      desde: '2026-10-01', hasta: '2026-10-31', calendario: [tesalonica], cruces: [],
      importadas: [
        fila({ id: 'em', fecha: '2026-10-04' }),
        fila({ id: 'em-eq', formato: 'EQUIPOS', fecha: '2026-10-03' }),
        fila({ id: 'sable', edicionId: 'se-sable', arma: 'SABLE', fecha: '2026-10-04' }),
      ],
    });
    expect(t.resultados['ev-tes'].map((p) => p.id).sort()).toEqual(['em', 'em-eq']);
    // Otra arma en la misma sede no es este torneo: sale suelta.
    expect(t.importados).toHaveLength(1);
  });

  it('la hoja de resultados enseña también el equipo, que el calendario no publica', () => {
    const pruebas = [fila({ id: 'em' }), fila({ id: 'em-eq', formato: 'EQUIPOS' }), fila({ id: 'sable', arma: 'SABLE' })].map(aPruebaPasada);
    expect(pruebasVisibles(tesalonica, pruebas).map((p) => p.id)).toEqual(['em', 'em-eq']);
  });

  it('no suma pruebas de su edición que caen fuera de las fechas del torneo', () => {
    const t = componerTramo({
      desde: '2026-10-01', hasta: '2026-10-31', calendario: [tesalonica], cruces: [],
      importadas: [fila({ id: 'em' }), fila({ id: 'lejos', formato: 'EQUIPOS', fecha: '2026-10-20' })],
    });
    expect(t.resultados['ev-tes'].map((p) => p.id)).toEqual(['em']);
    expect(t.importados).toHaveLength(1);
  });
});

describe('Prueba conjunta en la página de la prueba', () => {
  const CONJ = '11111111-1111-4111-8111-111111111111';
  const V40 = '22222222-2222-4222-8222-222222222222';
  const V50 = '33333333-3333-4333-8333-333333333333';

  function entorno() {
    const { s, db } = base();
    const migracion = readFileSync(new URL('../drizzle-d1/0013_pruebas_conjuntas.sql', import.meta.url), 'utf8');
    s.exec(migracion.slice(0, migracion.indexOf('CREATE TRIGGER')));
    s.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES
      ('e-eng', 'engarde', '2022', 't1', 'Torneo VET'), ('e-sk', 'skermo_rfee', '2022-2023', 't2', 'TLM VET')`);
    const insertar = s.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, category_raw)
      VALUES (?, ?, ?, '2022', ?, 'FLORETE', 'F', 'VET', ?)`);
    insertar.run(CONJ, 'e-eng', 'engarde', CONJ, null);
    insertar.run(V40, 'e-sk', 'skermo_rfee', V40, '+40');
    insertar.run(V50, 'e-sk', 'skermo_rfee', V50, '+50');
    s.exec(`INSERT INTO sport_competition_combined (id, part_competition_id, combined_competition_id, rule, shared_names, created_at) VALUES
      ('k1', '${V40}', '${CONJ}', 'partes', 6, 1), ('k2', '${V50}', '${CONJ}', 'partes', 6, 1)`);
    return db;
  }

  it('desde una parte enlaza la conjunta y las demás partes', async () => {
    const v = await leerConjuntaDePrueba(entorno(), V40);
    expect(v?.esConjunta).toBe(false);
    expect(v?.conjunta).toMatchObject({ pruebaId: CONJ, edicionId: 'e-eng' });
    expect(v?.partes).toEqual([{ pruebaId: V50, edicionId: 'e-sk', etiqueta: '+50' }]);
  });

  it('desde la conjunta lista todas las clasificaciones oficiales', async () => {
    const v = await leerConjuntaDePrueba(entorno(), CONJ);
    expect(v?.esConjunta).toBe(true);
    expect(v?.partes.map((p) => p.etiqueta).sort()).toEqual(['+40', '+50']);
  });

  it('sin la tabla de conjuntas no enlaza nada', async () => {
    const { db } = base();
    expect(await leerConjuntaDePrueba(db, V40)).toBeNull();
  });
});
