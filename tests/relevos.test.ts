import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { componerChunk, proyeccion } from '../scripts/indexado/sincronizar-d1';
import { COLUMNAS_RELEVOS, sportRelay, sportTeamMatch } from '@/db/schema/sport-relevos';
import {
  enlazarPrueba,
  enlazarTirador,
  idEncuentro,
  mismoClubOPais,
  paisDeEquipo,
  sentenciasPrueba,
  temporadasVecinas,
  unaPorCompeticion,
  type CandidatoRelevo,
  type ContextoEnlace,
  type PruebaRelevosJson,
} from '@/lib/ingest/relevos';
import { cargarRelevosCaraACara, leerRelevosPerfilDe } from '@/lib/sport/explorar/relevos';
import { rotuloRondaRelevo } from '@/components/explorar/relevos';
import { crearContexto } from './helpers/explorar';
import { fixtureDeportivaD1 } from './helpers/d1-deporte';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const P_FUNDIDA = '44444444-4444-4444-8444-444444444444';
const C_EQ = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const cand = (personId: string, nombre: string, club: string | null, pais: string | null = null): CandidatoRelevo => ({
  personId, nombres: [nombre], clubes: club ? [club] : [], paises: pais ? [pais] : [],
});

const ctxEnlace = (torneo: CandidatoRelevo[], componentes: CandidatoRelevo[] = []): ContextoEnlace => ({
  equiposPorRef: new Map(), componentes, torneo,
});

const sinEquipo = (nombre: string) => ({ nombre, club: null, pais: null });

describe('enlace de tiradores', () => {
  it('club del equipo: clave contenida, código con sufijo e iniciales', () => {
    expect(mismoClubOPais(sinEquipo('SAE-M'), cand(P1, 'x', 'SAE'))).toBe(true);
    expect(mismoClubOPais(sinEquipo('SAESBU ORO'), cand(P1, 'x', 'SAES-BU'))).toBe(true);
    expect(mismoClubOPais(sinEquipo('SAM-1'), cand(P1, 'x', 'SAM-B'))).toBe(true);
    expect(mismoClubOPais(sinEquipo('ET-2'), cand(P1, 'x', 'ET'))).toBe(true);
    expect(mismoClubOPais(sinEquipo('GUARDIA CIVIL 2'), cand(P1, 'x', 'GC'))).toBe(true);
    expect(mismoClubOPais(sinEquipo('GUARDIA CIVIL'), cand(P1, 'x', 'GUARDIA REAL'))).toBe(false);
    expect(mismoClubOPais(sinEquipo('CEC-C'), cand(P1, 'x', 'CEB-M'))).toBe(false);
    expect(mismoClubOPais(sinEquipo('ITA 2'), cand(P1, 'x', null, 'ITA'))).toBe(true);
    expect(mismoClubOPais(sinEquipo('GERMANY 1'), cand(P1, 'x', null, 'GER'))).toBe(true);
    expect(mismoClubOPais(sinEquipo('SAP'), cand(P1, 'x', null))).toBeNull();
  });

  it('sólo con un candidato del torneo del mismo club; nunca sin poder comprobarlo', () => {
    const torneo = [cand(P1, 'GARCIA Ana', 'SAM-B'), cand(P2, 'GARCIA Ana', 'CEB-M'), cand(P3, 'LOPEZ Eva', null)];
    expect(enlazarTirador('GARCIA Ana', sinEquipo('SAM-1'), ctxEnlace(torneo))).toEqual({ personId: P1, via: 'club', nivel: 'torneo' });
    expect(enlazarTirador('GARCIA Ana', sinEquipo('CREA-M'), ctxEnlace(torneo))).toEqual({ personId: null, motivo: 'club_distinto' });
    expect(enlazarTirador('LOPEZ Eva', sinEquipo('SAM-1'), ctxEnlace(torneo))).toEqual({ personId: null, motivo: 'sin_club_ni_pais' });
    expect(enlazarTirador('PEREZ Luis', sinEquipo('SAM-1'), ctxEnlace(torneo))).toEqual({ personId: null, motivo: 'sin_candidato' });
    expect(enlazarTirador(null, sinEquipo('SAM-1'), ctxEnlace(torneo))).toEqual({ personId: null, motivo: 'sin_nombre' });
    const dos = [cand(P1, 'GARCIA Ana', 'SAM-B'), cand(P2, 'GARCIA Ana', 'SAM-A')];
    expect(enlazarTirador('GARCIA Ana', sinEquipo('SAM-1'), ctxEnlace(dos))).toEqual({ personId: null, motivo: 'ambiguo' });
  });

  it('nombre incompleto en un lado, componentes guardados primero', () => {
    const torneo = [cand(P1, 'ANDREU ALMASA Marc', 'SEA')];
    expect(enlazarTirador('ANDREU Marc', sinEquipo('SEA2'), ctxEnlace(torneo))).toEqual({ personId: P1, via: 'club', nivel: 'torneo' });
    expect(enlazarTirador('ANDREU', sinEquipo('SEA2'), ctxEnlace(torneo)).personId).toBeNull();
    expect(enlazarTirador('ANDREU Marc', sinEquipo('OTRO'), ctxEnlace([], [cand(P2, 'Marc Andreu', null)]))).toEqual({ personId: P2, via: 'componente', nivel: 'componente' });
  });

  it('una persona para dos tiradores o para los dos lados de un relevo no se enlaza', () => {
    const relevo = (a: string, b: string, n = 1) => ({
      n, fencerA: { name: a, team: 'SAM-1' }, fencerB: { name: b, team: 'CEB-M' },
      before: { a: 0, b: 0 }, after: { a: 5, b: 3 }, touches: { a: 5, b: 3 }, consistent: true,
    });
    const encuentro = (relays: ReturnType<typeof relevo>[]) => ({
      phase: 'TABLEAU' as const, anchor: 'a2-1', roundKey: 'T2', roundLabel: 'Final',
      teamA: { name: 'SAM-1', ref: null }, teamB: { name: 'CEB-M', ref: null }, finalScore: { a: 5, b: 3 }, relays, consistent: true, sourceUrl: null,
    });
    const torneo = [cand(P1, 'GARCIA Ana', 'SAM-B'), cand(P1, 'GARCIA LOPEZ Ana', 'SAM-B'), cand(P2, 'RUIZ Eva', 'CEB-M')];
    const [[r1, r2]] = enlazarPrueba({ matches: [encuentro([relevo('GARCIA Ana', 'RUIZ Eva'), relevo('GARCIA LOPEZ Ana', 'RUIZ Eva', 2)])] }, ctxEnlace(torneo));
    expect(r1.a).toEqual({ personId: null, motivo: 'persona_repetida' });
    expect(r2.a).toEqual({ personId: null, motivo: 'persona_repetida' });
    expect(r1.b).toEqual({ personId: P2, via: 'club', nivel: 'torneo' });
    const mismo = [cand(P1, 'GARCIA Ana', 'SAM-B CEB-M')];
    const [[r]] = enlazarPrueba({ matches: [encuentro([relevo('GARCIA Ana', 'GARCIA Ana')])] }, ctxEnlace(mismo));
    expect(r.a.personId).toBeNull();
  });
});

describe('segundo nivel: la temporada', () => {
  const conTemporada = (temporada: CandidatoRelevo[], torneo: CandidatoRelevo[] = []): ContextoEnlace => ({
    equiposPorRef: new Map(), componentes: [], torneo, temporada,
  });

  it('temporadas vecinas en los dos formatos', () => {
    expect(temporadasVecinas('2016-2017')).toEqual(['2016-2017', '2015-2016', '2017', '2016']);
    expect(temporadasVecinas('2017')).toEqual(['2016-2017', '2015-2016', '2017', '2016']);
  });

  it('selección por el nombre o por un código de país real, nunca por el club guardado como país', () => {
    expect(paisDeEquipo(sinEquipo('GERMANY 1'))).toBe('GER');
    expect(paisDeEquipo(sinEquipo('JAPAN A'))).toBe('JPN');
    expect(paisDeEquipo(sinEquipo('ITA 2'))).toBe('ITA');
    expect(paisDeEquipo({ nombre: 'PUERTO RICO', club: null, pais: 'PUR' })).toBe('PUR');
    expect(paisDeEquipo({ nombre: 'SAM2', club: null, pais: 'SAM' })).toBeNull();
    expect(paisDeEquipo(sinEquipo('SAM-1'))).toBeNull();
  });

  it('mismo club y nombre completo idéntico, con un único candidato', () => {
    const pool = [cand(P1, 'GARCIA Ana', 'SAM-B'), cand(P2, 'GARCIA Ana', 'CEB-M'), cand(P3, 'RUIZ Eva', null)];
    expect(enlazarTirador('GARCIA Ana', sinEquipo('SAM-1'), conTemporada(pool))).toEqual({ personId: P1, via: 'club', nivel: 'temporada' });
    expect(enlazarTirador('GARCIA Ana', sinEquipo('CREA-M'), conTemporada(pool)).personId).toBeNull();
    // Sin club publicado no hay forma de comprobarlo fuera del torneo.
    expect(enlazarTirador('RUIZ Eva', sinEquipo('SAM-1'), conTemporada(pool))).toEqual({ personId: null, motivo: 'sin_candidato' });
    const dos = [cand(P1, 'GARCIA Ana', 'SAM-B'), cand(P2, 'GARCIA Ana', 'SAM-A')];
    expect(enlazarTirador('GARCIA Ana', sinEquipo('SAM-1'), conTemporada(dos))).toEqual({ personId: null, motivo: 'ambiguo' });
  });

  it('sólo si el torneo no da candidato', () => {
    const torneo = [cand(P2, 'GARCIA Ana', 'CEB-M')];
    const pool = [cand(P1, 'GARCIA Ana', 'SAM-B')];
    expect(enlazarTirador('GARCIA Ana', sinEquipo('SAM-1'), conTemporada(pool, torneo))).toEqual({ personId: null, motivo: 'club_distinto' });
  });

  it('hermanos del mismo club con el mismo apellido: sólo con el nombre idéntico', () => {
    const pool = [cand(P1, 'GARCIA LOPEZ Ana Maria', 'SAM-B'), cand(P2, 'GARCIA LOPEZ Luis', 'SAM-B')];
    expect(enlazarTirador('GARCIA LOPEZ Ana', sinEquipo('SAM-1'), conTemporada(pool))).toEqual({ personId: null, motivo: 'apellido_repetido' });
    expect(enlazarTirador('GARCIA Luis', sinEquipo('SAM-1'), conTemporada(pool))).toEqual({ personId: null, motivo: 'apellido_repetido' });
    expect(enlazarTirador('GARCIA LOPEZ Luis', sinEquipo('SAM-1'), conTemporada(pool))).toEqual({ personId: P2, via: 'club', nivel: 'temporada' });
  });

  it('nombre incompleto con apellidos únicos en el club', () => {
    const pool = [cand(P3, 'DOCAVO Antonio', 'CEB-M'), cand(P1, 'GARCIA Ana', 'CEB-M'), cand(P2, 'DOCAVO Pedro', 'SAM-B')];
    expect(enlazarTirador('DOCAVO GARCIA Antonio', sinEquipo('CEB-M 2'), conTemporada(pool))).toEqual({ personId: P3, via: 'club', nivel: 'temporada' });
    // Sin apellidos distinguibles (todo en mayúsculas) no se arriesga.
    expect(enlazarTirador('DOCAVO GARCIA ANTONIO', sinEquipo('CEB-M 2'), conTemporada(pool)).personId).toBeNull();
  });

  it('selecciones: el país del equipo sirve en el torneo aunque la persona no lo publique; en la temporada tiene que casar', () => {
    expect(enlazarTirador('DUENGER Karl', sinEquipo('GERMANY 1'), ctxEnlace([cand(P1, 'DUENGER Karl', null)]))).toEqual({ personId: P1, via: 'pais', nivel: 'torneo' });
    expect(enlazarTirador('DUENGER Karl', sinEquipo('GERMANY 1'), ctxEnlace([cand(P1, 'DUENGER Karl', null, 'AUT')])).personId).toBeNull();
    expect(enlazarTirador('BENEA Bianca', sinEquipo('RUMANIA'), conTemporada([cand(P2, 'BENEA Bianca', null, 'ROU')]))).toEqual({ personId: P2, via: 'pais', nivel: 'temporada' });
    expect(enlazarTirador('BENEA Bianca', sinEquipo('RUMANIA'), conTemporada([cand(P2, 'BENEA Bianca', null)])).personId).toBeNull();
  });

  it('las exclusiones también valen en la temporada', () => {
    const pool = [cand(P3, 'DOCAVO GARCIA Antonio', 'CEB-M')];
    const relevo = (a: string, n: number) => ({
      n, fencerA: { name: a, team: 'CEB-M 2' }, fencerB: { name: 'X Y', team: 'SAM-1' },
      before: { a: 0, b: 0 }, after: { a: 5, b: 3 }, touches: { a: 5, b: 3 }, consistent: true,
    });
    const [[r1, r2]] = enlazarPrueba({ matches: [{
      phase: 'TABLEAU', anchor: 'a2-1', roundKey: 'T2', roundLabel: 'Final',
      teamA: { name: 'CEB-M 2', ref: null }, teamB: { name: 'SAM-1', ref: null }, finalScore: { a: 10, b: 6 },
      relays: [relevo('DOCAVO GARCIA Antonio', 1), relevo('DOCAVO Antonio', 2)], consistent: true, sourceUrl: null,
    }] }, conTemporada(pool));
    expect([r1.a, r2.a]).toEqual([{ personId: null, motivo: 'persona_repetida' }, { personId: null, motivo: 'persona_repetida' }]);
  });
});

// --------------------------------------------------------------- SQL y lecturas

const PRUEBA: PruebaRelevosJson = {
  schemaVersion: 1, source: 'engarde', season: '2016-2017', competitionKey: 'engarde:rfee/x/efe', tournamentKey: 'engarde:rfee/x',
  matches: [{
    phase: 'TABLEAU', anchor: 'a2-1', roundKey: 'T2', roundLabel: 'Final',
    teamA: { name: 'SAM-1', ref: null }, teamB: { name: "CEB-M; 'x'", ref: 'engarde:team:ceb' }, finalScore: { a: 45, b: 40 }, consistent: true,
    sourceUrl: 'https://example.invalid/t', relays: [
      { n: 1, fencerA: { name: 'GARCIA Ana', team: 'SAM-1' }, fencerB: { name: 'RUIZ Eva', team: 'CEB-M' }, before: { a: 0, b: 0 }, after: { a: 5, b: 3 }, touches: { a: 5, b: 3 }, consistent: true },
      { n: 2, fencerA: { name: 'SOLA Mar', team: 'SAM-1' }, fencerB: { name: 'RUIZ Eva', team: 'CEB-M' }, before: { a: 5, b: 3 }, after: { a: 10, b: 9 }, touches: { a: 5, b: 6 }, consistent: true },
      { n: 3, fencerA: { name: 'GARCIA Ana', team: 'SAM-1' }, fencerB: { name: 'PAZ Lia', team: 'CEB-M' }, before: { a: 10, b: 9 }, after: { a: 15, b: 12 }, touches: { a: 5, b: 3 }, consistent: true },
    ],
  }],
};

function base() {
  const local = fixtureDeportivaD1();
  const ejecutar = (sentencias: string[], cargo: number) =>
    local.sqlite.exec(componerChunk(sentencias.map((s) => `${s};\n`).join(''), { owner: randomUUID(), medidoBytes: 1, proyectadoBytes: proyeccion(cargo) }));
  local.sqlite.exec(readFileSync(new URL('../drizzle-d1/0010_relevos.sql', import.meta.url), 'utf8'));
  ejecutar([
    `INSERT INTO sport_person(id,display_name,name_normalized,gender) VALUES('${P1}','GARCIA Ana','ana garcia','F'),('${P2}','RUIZ Eva','eva ruiz','F'),('${P3}','SOLA Mar','mar sola','F')`,
    `INSERT INTO sport_person(id,display_name,name_normalized,gender,merged_into_person_id) VALUES('${P_FUNDIDA}','GARCIA A.','a garcia','F','${P1}')`,
    `INSERT INTO sport_edition(id,source,season,tournament_key,name,start_date) VALUES('${ED}','engarde','2016-2017','engarde:rfee/x','Campeonato de España M-14','2017-06-18')`,
    `INSERT INTO sport_competition(id,edition_id,source,season,competition_key,weapon,gender,category,format) VALUES('${C_EQ}','${ED}','engarde','2016-2017','engarde:rfee/x/efe','ESPADA','F','M14','EQUIPOS')`,
  ], 400_000);
  const cuenta = (tabla: string) => Number((local.sqlite.prepare(`SELECT count(*) AS n FROM ${tabla}`).get() as { n: number }).n);
  const ledger = () => Number((local.sqlite.prepare(`SELECT accounted_bytes AS a FROM sport_capacity_ledger`).get() as { a: number }).a);
  return { ...local, ejecutar, cuenta, ledger };
}

const enlaces = (a: (string | null)[], b: (string | null)[]) => [a.map((pa, i) => ({
  a: pa ? { personId: pa, via: 'club' as const, nivel: 'torneo' as const } : { personId: null, motivo: 'sin_candidato' as const },
  b: b[i] ? { personId: b[i]!, via: 'club' as const, nivel: 'torneo' as const } : { personId: null, motivo: 'sin_candidato' as const },
}))];

describe('migración 0010 y carga SQL', () => {
  it('el esquema drizzle coincide con las columnas de la migración', () => {
    const local = base();
    try {
      for (const [tabla, def] of [['sport_team_match', sportTeamMatch], ['sport_relay', sportRelay]] as const) {
        const fisicas = (local.sqlite.prepare(`PRAGMA table_info('${tabla}')`).all() as { name: string }[]).map((c) => c.name);
        expect(fisicas).toEqual([...COLUMNAS_RELEVOS[tabla]]);
        expect(getTableConfig(def).columns.map((c) => c.name)).toEqual(fisicas);
      }
      const indices = (local.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sport_relay' AND sql IS NOT NULL`).all() as { name: string }[]).map((r) => r.name);
      expect(indices.sort()).toEqual(['sport_relay_a_idx', 'sport_relay_b_idx', 'sport_relay_key']);
    } finally {
      local.close();
    }
  });

  it('sin lease no se escribe; con él carga, es idempotente y una nueva generación sólo cambia lo distinto', () => {
    const local = base();
    try {
      expect(() => local.sqlite.exec(`INSERT INTO sport_team_match(id,competition_id,source,source_key,phase,team_a_name,team_b_name,score_a,score_b,consistent) VALUES('x','${C_EQ}','x','x','TABLEAU','a','b',0,0,1)`))
        .toThrow(/sport_write_lease_required/);
      const primera = sentenciasPrueba(PRUEBA, C_EQ, enlaces([P1, P3, null], [P2, P2, null]));
      local.ejecutar(primera.sentencias, primera.cargo);
      expect([local.cuenta('sport_team_match'), local.cuenta('sport_relay')]).toEqual([1, 3]);
      const nombre = local.sqlite.prepare(`SELECT team_b_name AS n, team_b_ref AS r FROM sport_team_match`).get() as { n: string; r: string };
      expect(nombre).toEqual({ n: "CEB-M; 'x'", r: 'engarde:team:ceb' });

      const antes = local.ledger();
      local.ejecutar(primera.sentencias, primera.cargo);
      const sinCambios = local.ledger() - antes;
      expect([local.cuenta('sport_team_match'), local.cuenta('sport_relay')]).toEqual([1, 3]);

      const segunda = sentenciasPrueba(PRUEBA, C_EQ, enlaces([P1, P3, P1], [P2, P2, null]));
      const l0 = local.ledger();
      local.ejecutar(segunda.sentencias, segunda.cargo);
      const conCambio = local.ledger() - l0;
      expect(conCambio).toBeGreaterThan(sinCambios);
      expect(conCambio - sinCambios).toBeLessThan(2 * 1024 + 4 * 36 + 1);
      const r3 = local.sqlite.prepare(`SELECT fencer_a_person_id AS a FROM sport_relay WHERE relay_number = 3`).get() as { a: string };
      expect(r3.a).toBe(P1);
      expect(local.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      local.close();
    }
  });

  it('una prueba que ya no existe no carga nada', () => {
    const local = base();
    try {
      const sql = sentenciasPrueba(PRUEBA, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', enlaces([null, null, null], [null, null, null]));
      local.ejecutar(sql.sentencias, sql.cargo);
      expect(local.cuenta('sport_relay')).toBe(0);
    } finally {
      local.close();
    }
  });

  it('dos JSON de la misma prueba: chocarían en el índice único; se carga uno, determinista', () => {
    const local = base();
    try {
      const otra: PruebaRelevosJson = { ...PRUEBA, competitionKey: 'engarde:rfee/x/efe-bis' };
      const a = sentenciasPrueba(PRUEBA, C_EQ, enlaces([null, null, null], [null, null, null]));
      const b = sentenciasPrueba(otra, C_EQ, enlaces([null, null, null], [null, null, null]));
      local.ejecutar(a.sentencias, a.cargo);
      expect(() => local.ejecutar(b.sentencias, b.cargo)).toThrow(/UNIQUE constraint failed: sport_team_match/);
    } finally {
      local.close();
    }
    const p = (fichero: string, competitionKey: string, competitionId: string, relevos: number) => ({ fichero, competitionKey, competitionId, relevos });
    const { elegidas, descartadas } = unaPorCompeticion([
      p('f1', 'k-b', C_EQ, 9), p('f2', 'k-a', C_EQ, 9), p('f3', 'k-c', C_EQ, 12), p('f4', 'k-z', ED, 3),
      p('f5', 'k-b', ED, 3), p('f6', 'k-a', ED, 3),
    ]);
    expect([...elegidas].sort()).toEqual(['f3', 'f6']);
    expect(Object.fromEntries([...descartadas].map(([f, en]) => [f, en.fichero]))).toEqual({ f1: 'f3', f2: 'f3', f4: 'f6', f5: 'f6' });
  });

  it('ids deterministas por fuente, temporada, prueba y ancla', () => {
    expect(idEncuentro(PRUEBA, 'a2-1')).toBe(idEncuentro({ ...PRUEBA }, 'a2-1'));
    expect(idEncuentro(PRUEBA, 'a2-1')).not.toBe(idEncuentro(PRUEBA, 'a4-1'));
  });
});

describe('lecturas de relevos', () => {
  function cargada() {
    const local = base();
    // Relevo 3 con la persona fundida: se lee por el grupo de la canónica.
    const sql = sentenciasPrueba(PRUEBA, C_EQ, enlaces([P1, P3, P_FUNDIDA], [P2, P2, null]));
    local.ejecutar(sql.sentencias, sql.cargo);
    return local;
  }

  it('cara a cara: sólo los relevos entre las dos, orientados y con su ronda', async () => {
    const local = cargada();
    try {
      const ctx = { ...crearContexto().ctx, db: local.db };
      const r = await cargarRelevosCaraACara(ctx, P2, P1);
      expect(r?.items.map((x) => [x.numero, x.mios, x.rival, x.miEquipo, x.final])).toEqual([[1, 3, 5, "CEB-M; 'x'", { mios: 40, rival: 45 }]]);
      expect(r?.resumen).toEqual({ relevos: 1, tocadosFavor: 3, tocadosContra: 5 });
      expect(rotuloRondaRelevo(r!.items[0])).toBe('Final');
      expect((await cargarRelevosCaraACara(ctx, P2, P3))?.items.map((x) => x.numero)).toEqual([2]);
      expect((await cargarRelevosCaraACara(ctx, P2, P1, { arma: 'SABLE' }))?.items).toEqual([]);
      expect((await cargarRelevosCaraACara(ctx, P2, P1, { temporada: '2016-2017', fase: 'TABLEAU' }))?.items).toHaveLength(1);
    } finally {
      local.close();
    }
  });

  it('perfil: totales, índice y una fila por prueba, por todo el grupo de fusión', async () => {
    const local = cargada();
    try {
      const p = await leerRelevosPerfilDe(local.db, [P1, P_FUNDIDA]);
      expect(p).toMatchObject({ relevos: 2, encuentros: 1, dados: 10, recibidos: 6, indice: 4, truncado: false });
      expect(p?.pruebas.map((x) => [x.pruebaId, x.equipo, x.relevos, x.fecha])).toEqual([[C_EQ, 'SAM-1', 2, '2017-06-18']]);
      expect(await leerRelevosPerfilDe(local.db, ['99999999-9999-4999-8999-999999999999'])).toBeNull();
    } finally {
      local.close();
    }
  });

  it('sin la 0010 aplicada no falla: no hay sección', async () => {
    const local = fixtureDeportivaD1();
    try {
      expect(await leerRelevosPerfilDe(local.db, [P1])).toBeNull();
      const ctx = { ...crearContexto().ctx, db: local.db };
      expect(await cargarRelevosCaraACara(ctx, P1, P2)).toBeNull();
    } finally {
      local.close();
    }
  });

  it('sin sesión no se lee nada', async () => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    expect(await cargarRelevosCaraACara(ctx, P1, P2)).toBeNull();
    expect(sentencias).toHaveLength(0);
  });
});
