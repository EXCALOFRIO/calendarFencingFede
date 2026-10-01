import { readFileSync } from 'node:fs';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  candidatesByName,
  checkBout,
  fieCompetitionKey,
  normalizeSportName,
  resolveByExternalId,
  resultFactKey,
  type ExternalIdRow,
} from '@/lib/identity/resolver';

const fila = (over: Partial<ExternalIdRow>): ExternalIdRow => ({
  personId: 'p1',
  scheme: 'rfee_license',
  value: 'CLF01835',
  scopeSource: 'skermo_rfee',
  scopeFederation: 'RFEE',
  scopeSeason: '',
  scopeWeapon: '',
  validFrom: '1900-01-01',
  validTo: null,
  linkStatus: 'CONFIRMADO',
  ...over,
});

describe('resolución por ID externo', () => {
  it('resuelve un alias confirmado por ID FIE aunque el nombre difiera', () => {
    const rows = [fila({ scheme: 'fie_addr_id', value: '12345', scopeSource: 'fie', scopeFederation: '' })];
    expect(
      resolveByExternalId(rows, { scheme: 'fie_addr_id', value: '12345', source: 'fie' }),
    ).toEqual({ kind: 'confirmed', personId: 'p1' });
  });

  it('no confirma una licencia fuera de su ámbito de federación', () => {
    const res = resolveByExternalId([fila({})], {
      scheme: 'rfee_license',
      value: 'CLF01835',
      source: 'skermo_rfee',
      federation: 'FMES',
    });
    expect(res).toEqual({ kind: 'none' });
  });

  it('no confirma una licencia fuera de su vigencia ni sin fecha', () => {
    const rows = [fila({ validFrom: '2018-09-01', validTo: '2020-08-31' })];
    const q = { scheme: 'rfee_license', value: 'CLF01835', source: 'skermo_rfee', federation: 'RFEE' };
    expect(resolveByExternalId(rows, { ...q, on: '2019-03-01' }).kind).toBe('confirmed');
    expect(resolveByExternalId(rows, { ...q, on: '2023-03-01' }).kind).toBe('none');
    expect(resolveByExternalId(rows, q).kind).toBe('none');
  });

  it('la misma licencia reutilizada en vigencias distintas apunta a personas distintas', () => {
    const rows = [
      fila({ personId: 'a', validFrom: '2018-09-01', validTo: '2020-08-31' }),
      fila({ personId: 'b', validFrom: '2021-09-01' }),
    ];
    const q = { scheme: 'rfee_license', value: 'CLF01835', source: 'skermo_rfee', federation: 'RFEE' };
    expect(resolveByExternalId(rows, { ...q, on: '2019-01-01' })).toEqual({ kind: 'confirmed', personId: 'a' });
    expect(resolveByExternalId(rows, { ...q, on: '2022-01-01' })).toEqual({ kind: 'confirmed', personId: 'b' });
  });

  it('un candidato sólo propuesto o dos confirmados nunca se resuelven en silencio', () => {
    const q = { scheme: 'rfee_license', value: 'CLF01835', source: 'skermo_rfee', federation: 'RFEE' };
    expect(resolveByExternalId([fila({ linkStatus: 'PROPUESTO' })], q)).toEqual({ kind: 'review', personIds: ['p1'] });
    expect(resolveByExternalId([fila({}), fila({ personId: 'p2' })], q).kind).toBe('conflict');
    expect(resolveByExternalId([fila({ linkStatus: 'RECHAZADO' })], q).kind).toBe('none');
  });
});

describe('homónimos', () => {
  const gente = [
    { personId: 'a', nameNormalized: normalizeSportName('GARCIA LOPEZ Ana') },
    { personId: 'b', nameNormalized: normalizeSportName('Ana García López') },
  ];

  it('el mismo nombre normalizado produce candidatos a revisión, nunca una persona', () => {
    const res = candidatesByName(gente, 'ANA GARCIA LOPEZ');
    expect(res).toEqual({ kind: 'review', personIds: ['a', 'b'] });
  });

  it('un nombre único tampoco se confirma por nombre', () => {
    const res = candidatesByName(gente.slice(0, 1), 'Ana Garcia Lopez');
    expect(res.kind).toBe('review');
  });
});

describe('claves de prueba y hechos', () => {
  it('la prueba FIE lleva season y competitionId, distintos del torneo', () => {
    expect(fieCompetitionKey(2027, 1478)).toEqual({ source: 'fie', season: '2027', competitionKey: '1478' });
    expect(fieCompetitionKey(2027, 1478)).not.toEqual(fieCompetitionKey(2026, 1478));
  });

  it('la clave del hecho no incluye el puesto: una corrección conserva la identidad', () => {
    expect(resultFactKey(' 9876 ')).toBe('9876');
  });
});

describe('asaltos individuales', () => {
  const base = { individual: true, fencerARef: '20', fencerBRef: '10', scoreA: 5, scoreB: 3 };

  it('ordena canónicamente para guardar una poule una sola vez', () => {
    const ab = checkBout(base);
    const ba = checkBout({ ...base, fencerARef: '10', fencerBRef: '20', scoreA: 3, scoreB: 5 });
    expect(ab).toMatchObject({ ok: true, fencerARef: '10', fencerBRef: '20', swapped: true });
    expect(ba).toMatchObject({ ok: true, fencerARef: '10', fencerBRef: '20', swapped: false });
  });

  it.each([
    [{ individual: false }, 'team'],
    [{ isBye: true }, 'bye'],
    [{ fencerBRef: null }, 'missing_fencer'],
    [{ fencerBRef: '20' }, 'same_fencer'],
    [{ scoreB: null }, 'no_score'],
  ])('rechaza %j como asalto', (over, reason) => {
    expect(checkBout({ ...base, ...over })).toEqual({ ok: false, reason });
  });
});

const sql = readFileSync('drizzle/0017_identidad_deportiva.sql', 'utf8');
const tablas: PgTable[] = [
  schema.sportPerson, schema.sportPersonAlias, schema.sportExternalId, schema.sportLinkCandidate,
  schema.sportEdition, schema.sportCompetition, schema.sportResult, schema.sportBout,
  schema.sportRankingPublication, schema.sportRankingEntry, schema.sportFavorite, schema.sportImportCoverage,
];
const deportivas = tablas.map(getTableConfig).filter((c) => c.name.startsWith('sport_'));

describe('esquema y migración 0017', () => {
  it('define las tablas esperadas y la migración las crea todas', () => {
    expect(deportivas.map((c) => c.name).sort()).toEqual(
      [
        'sport_bout', 'sport_competition', 'sport_edition', 'sport_external_id',
        'sport_favorite', 'sport_import_coverage', 'sport_link_candidate', 'sport_person',
        'sport_person_alias', 'sport_ranking_entry', 'sport_ranking_publication', 'sport_result',
      ].sort(),
    );
    for (const c of deportivas) expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${c.name}"`);
  });

  it('todo índice y restricción única del esquema aparece en el SQL', () => {
    for (const c of deportivas) {
      for (const i of c.indexes) expect(sql, i.config.name).toContain(`"${i.config.name}"`);
      for (const u of c.uniqueConstraints) expect(sql, u.name).toContain(`"${u.name}"`);
      for (const k of c.checks) expect(sql, k.name).toContain(`"${k.name}"`);
    }
  });

  it('es aditiva: no borra, renombra ni altera columnas existentes', () => {
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM|RENAME)\b/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+"(?!sport_)/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
  });

  it('el rollback sólo toca objetos sport_', () => {
    const down = readFileSync('drizzle/manual/0017_identidad_deportiva.down.sql', 'utf8');
    const drops = down.split('\n').filter((l) => /^DROP /.test(l));
    expect(drops.length).toBeGreaterThan(0);
    for (const l of drops) expect(l).toMatch(/"sport_/);
  });

  it('el journal incluye 0017 con una marca posterior a la anterior', () => {
    const j = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
      entries: { tag: string; when: number }[];
    };
    const i = j.entries.findIndex((e) => e.tag === '0017_identidad_deportiva');
    expect(i).toBeGreaterThan(0);
    expect(j.entries[i]!.when).toBeGreaterThan(j.entries[i - 1]!.when);
    // Las migraciones posteriores siguen el orden del journal.
    for (let k = i + 1; k < j.entries.length; k++) {
      expect(j.entries[k]!.when).toBeGreaterThan(j.entries[k - 1]!.when);
    }
  });

  it('la posición no forma parte de la identidad del hecho ni la prueba FIE se confunde con el torneo', () => {
    const cfg = (n: string) => deportivas.find((c) => c.name === n)!;
    const cols = (u: { columns: { name: string }[] }) => u.columns.map((c) => c.name);
    const result = cfg('sport_result').uniqueConstraints.find((u) => u.name === 'sport_result_key')!;
    expect(cols(result)).not.toContain('position');
    const comp = cfg('sport_competition').uniqueConstraints.find((u) => u.name === 'sport_competition_key')!;
    expect(cols(comp)).toEqual(['source', 'season', 'competition_key']);
    const ed = cfg('sport_edition').uniqueConstraints.find((u) => u.name === 'sport_edition_key')!;
    expect(cols(ed)).toEqual(['source', 'season', 'tournament_key']);
  });

  it('hay índices para atleta+fecha, H2H en ambos sentidos y favoritos', () => {
    const idx = (n: string) => deportivas.find((c) => c.name === n)!.indexes.map((i) => i.config.name);
    expect(idx('sport_result')).toContain('sport_result_person_date_idx');
    expect(idx('sport_bout')).toEqual(expect.arrayContaining(['sport_bout_a_idx', 'sport_bout_b_idx']));
    expect(idx('sport_favorite')).toContain('sport_favorite_profile_idx');
  });
});
