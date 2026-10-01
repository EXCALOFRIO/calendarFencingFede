import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '@/db';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import {
  ambitoCompatible,
  confirmarIdExterno,
  conflictosDeConfirmacion,
  filaConfirmadaPropia,
  validarCandidato,
  vigenciasSolapan,
  type DepsGuardConfirmacion,
  type IdExternoCandidato,
  type PersonaNuevaConId,
} from '@/lib/sport/id-guard';
import { crearGuardDb } from '@/lib/sport/id-guard-db';

const fila = (over: Partial<ExternalIdRow>): ExternalIdRow => ({
  personId: 'a',
  scheme: 'fie_addr_id',
  value: '100',
  scopeSource: 'fie',
  scopeFederation: '',
  scopeSeason: '',
  scopeWeapon: '',
  validFrom: '1900-01-01',
  validTo: null,
  linkStatus: 'CONFIRMADO',
  ...over,
});

const candidato = (over: Partial<IdExternoCandidato> = {}): IdExternoCandidato => ({
  personId: 'b',
  scheme: 'fie_addr_id',
  value: '100',
  scopeSource: 'fie',
  scopeFederation: '',
  scopeSeason: '',
  scopeWeapon: '',
  validFrom: '1900-01-01',
  validTo: null,
  linkedVia: 'test',
  evidence: 'test',
  ...over,
});

describe('reglas puras del guard de IDs externos', () => {
  it('las vigencias inclusivas se solapan en el extremo y el fin abierto no acaba', () => {
    const a = { validFrom: '2018-09-01', validTo: '2020-08-31' };
    expect(vigenciasSolapan(a, { validFrom: '2020-08-31', validTo: null })).toBe(true);
    expect(vigenciasSolapan(a, { validFrom: '2020-09-01', validTo: null })).toBe(false);
    expect(vigenciasSolapan(a, { validFrom: '1900-01-01', validTo: '2018-09-01' })).toBe(true);
    expect(vigenciasSolapan(a, { validFrom: '1900-01-01', validTo: '2018-08-31' })).toBe(false);
    expect(
      vigenciasSolapan({ validFrom: '2021-01-01', validTo: null }, { validFrom: '2050-01-01', validTo: null }),
    ).toBe(true);
  });

  it('el ámbito vacío es comodín en ambos lados, y dos valores distintos no casan', () => {
    expect(ambitoCompatible('', 'RFEE')).toBe(true);
    expect(ambitoCompatible('RFEE', '')).toBe(true);
    expect(ambitoCompatible('', '')).toBe(true);
    expect(ambitoCompatible('RFEE', 'FMES')).toBe(false);
  });

  it('rechaza otra persona con el mismo ID aunque el inicio de vigencia sea distinto', () => {
    const existentes = [fila({ personId: 'a', validFrom: '2018-09-01', validTo: null })];
    // La clave única exacta lo dejaría pasar (valid_from distinto); el guard no.
    expect(conflictosDeConfirmacion(existentes, candidato({ validFrom: '2020-01-01' }))).toHaveLength(1);
  });

  it('un ID sin ámbito choca con el mismo ID con ámbito de federación', () => {
    const existentes = [fila({ scheme: 'rfee_license', scopeSource: 'skermo_rfee', scopeFederation: 'RFEE' })];
    const c = candidato({ scheme: 'rfee_license', scopeSource: 'skermo_rfee', scopeFederation: '' });
    expect(conflictosDeConfirmacion(existentes, c)).toHaveLength(1);
    expect(conflictosDeConfirmacion(existentes, { ...c, scopeFederation: 'FMES' })).toHaveLength(0);
  });

  it('ámbitos de temporada o arma distintos y concretos no chocan; si uno está vacío, sí', () => {
    const existentes = [fila({ scopeSeason: '2026-2027', scopeWeapon: 'SABLE' })];
    expect(
      conflictosDeConfirmacion(existentes, candidato({ scopeSeason: '2025-2026', scopeWeapon: 'SABLE' })),
    ).toHaveLength(0);
    expect(
      conflictosDeConfirmacion(existentes, candidato({ scopeSeason: '2026-2027', scopeWeapon: 'ESPADA' })),
    ).toHaveLength(0);
    expect(conflictosDeConfirmacion(existentes, candidato({ scopeSeason: '', scopeWeapon: '' }))).toHaveLength(1);
  });

  it('no mezcla fuentes, esquemas ni valores distintos, ni cuenta propuestos o rechazados', () => {
    const c = candidato();
    expect(conflictosDeConfirmacion([fila({ scopeSource: 'skermo_rfee' })], c)).toHaveLength(0);
    expect(conflictosDeConfirmacion([fila({ scheme: 'fie_license' })], c)).toHaveLength(0);
    expect(conflictosDeConfirmacion([fila({ value: '101' })], c)).toHaveLength(0);
    expect(conflictosDeConfirmacion([fila({ linkStatus: 'PROPUESTO' })], c)).toHaveLength(0);
    expect(conflictosDeConfirmacion([fila({ linkStatus: 'RECHAZADO' })], c)).toHaveLength(0);
  });

  it('repetir la confirmación para la misma persona, o para su fusión, no es choque', () => {
    expect(conflictosDeConfirmacion([fila({ personId: 'b' })], candidato())).toHaveLength(0);
    const canonica = (id: string) => (id === 'a' ? 'b' : id);
    expect(conflictosDeConfirmacion([fila({ personId: 'a' })], candidato(), canonica)).toHaveLength(0);
  });

  it('un candidato con vigencia invertida o sin ID no se compara siquiera', () => {
    expect(validarCandidato(candidato())).toBeNull();
    expect(validarCandidato(candidato({ validFrom: '2021-01-01', validTo: '2020-01-01' }))).toMatch(/vigencia/);
    expect(validarCandidato(candidato({ value: '  ' }))).toMatch(/vac/);
    expect(validarCandidato(candidato({ validFrom: 'ayer' }))).toMatch(/fecha/);
  });
});

/** Almacén en memoria con la semántica del contrato; simulación, no Neon. */
function almacenSimulado(fusiones: Record<string, string> = {}) {
  const filas: ExternalIdRow[] = [];
  const personas: string[] = [];
  const canonica = (id: string) => fusiones[id] ?? id;
  let cola: Promise<unknown> = Promise.resolve();
  const deps: DepsGuardConfirmacion = {
    confirmar(c, persona?: PersonaNuevaConId) {
      // El contrato exige comprobar+escribir como una unidad: se serializa.
      const turno = cola.then(async () => {
        await Promise.resolve();
        if (conflictosDeConfirmacion(filas, c, canonica).length > 0) return false;
        const propia = filaConfirmadaPropia(filas, c, canonica);
        if (propia) {
          Object.assign(propia, { validTo: c.validTo });
          return true;
        }
        // Como `sport_external_id_confirmed_key`: la clave exacta no mira person_id.
        const duplicada = filas.some(
          (f) =>
            f.linkStatus === 'CONFIRMADO' &&
            f.scheme === c.scheme &&
            f.value === c.value.trim() &&
            f.scopeSource === c.scopeSource &&
            f.scopeFederation === c.scopeFederation &&
            f.scopeSeason === c.scopeSeason &&
            f.scopeWeapon === c.scopeWeapon &&
            f.validFrom === c.validFrom,
        );
        if (duplicada) throw new Error('23505 sport_external_id_confirmed_key');
        if (persona) personas.push(persona.id);
        filas.push({ ...c, linkStatus: 'CONFIRMADO' });
        return true;
      });
      cola = turno.catch(() => undefined);
      return turno;
    },
    async conflictos(c) {
      return conflictosDeConfirmacion(filas, c, canonica);
    },
  };
  return { deps, filas, personas };
}

describe('confirmarIdExterno', () => {
  it('confirma, y rechaza con las personas en conflicto sin escribir nada', async () => {
    const { deps, filas } = almacenSimulado();
    expect(await confirmarIdExterno(deps, candidato({ personId: 'a' }))).toEqual({ ok: true });
    const res = await confirmarIdExterno(deps, candidato({ personId: 'b', validFrom: '2024-01-01' }));
    expect(res).toEqual({ ok: false, motivo: 'conflicto', personIds: ['a'] });
    expect(filas).toHaveLength(1);
  });

  it('dos confirmaciones concurrentes del mismo ID: sólo gana una', async () => {
    const { deps, filas } = almacenSimulado();
    const resultados = await Promise.all([
      confirmarIdExterno(deps, candidato({ personId: 'a', validFrom: '2020-01-01' })),
      confirmarIdExterno(deps, candidato({ personId: 'b', validFrom: '2021-01-01' })),
      confirmarIdExterno(deps, candidato({ personId: 'c', validFrom: '2022-01-01' })),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(filas).toHaveLength(1);
  });

  it('reconfirmar el ID exacto de A fusionada en B es idempotente pidiendo A o B', async () => {
    const { deps, filas } = almacenSimulado({ a: 'b' });
    // Fila confirmada cuando A todavía era independiente.
    filas.push({ ...candidato({ personId: 'a', validFrom: '2020-01-01' }), linkStatus: 'CONFIRMADO' });
    expect(
      await confirmarIdExterno(deps, candidato({ personId: 'b', validFrom: '2020-01-01', validTo: '2021-06-30' })),
    ).toEqual({ ok: true });
    expect(
      await confirmarIdExterno(deps, candidato({ personId: 'a', validFrom: '2020-01-01', validTo: '2021-06-30' })),
    ).toEqual({ ok: true });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ personId: 'a', validTo: '2021-06-30' });
  });

  it('con A fusionada en B sigue rechazando a una tercera persona y no oculta duplicados ajenos', async () => {
    const { deps, filas } = almacenSimulado({ a: 'b' });
    filas.push({ ...candidato({ personId: 'a', validFrom: '2020-01-01' }), linkStatus: 'CONFIRMADO' });
    expect(await confirmarIdExterno(deps, candidato({ personId: 'c', validFrom: '2020-01-01' }))).toEqual({
      ok: false,
      motivo: 'conflicto',
      personIds: ['a'],
    });
    // Otro inicio de vigencia para B (misma persona canónica) con solape: se permite insertar una fila nueva.
    expect(await confirmarIdExterno(deps, candidato({ personId: 'b', validFrom: '2022-01-01' }))).toEqual({ ok: true });
    expect(filas).toHaveLength(2);
  });

  it('encuentra la fila exacta propia sólo si coincide toda la clave y la persona canónica', () => {
    const canonica = (id: string) => (id === 'a' ? 'b' : id);
    const existentes = [fila({ personId: 'a', validFrom: '2020-01-01', scopeFederation: 'RFEE' })];
    const c = candidato({ personId: 'b', validFrom: '2020-01-01', scopeFederation: 'RFEE' });
    expect(filaConfirmadaPropia(existentes, c, canonica)).toBe(existentes[0]);
    expect(filaConfirmadaPropia(existentes, c)).toBeNull();
    expect(filaConfirmadaPropia(existentes, { ...c, validFrom: '2020-01-02' }, canonica)).toBeNull();
    expect(filaConfirmadaPropia(existentes, { ...c, scopeFederation: '' }, canonica)).toBeNull();
    expect(filaConfirmadaPropia([fila({ personId: 'a', linkStatus: 'PROPUESTO' })], c, canonica)).toBeNull();
  });

  it('un rechazo no deja una persona nueva huérfana', async () => {
    const { deps, personas } = almacenSimulado();
    await confirmarIdExterno(deps, candidato({ personId: 'a' }));
    const persona: PersonaNuevaConId = {
      id: 'n1',
      displayName: 'X',
      nameNormalized: 'x',
      gender: null,
      countryCode: null,
      aliasSource: 'fie',
    };
    const res = await confirmarIdExterno(deps, candidato({ personId: 'n1' }), persona);
    expect(res.ok).toBe(false);
    expect(personas).toEqual([]);
  });

  it('un candidato inválido no llega a la persistencia', async () => {
    let llamadas = 0;
    const deps: DepsGuardConfirmacion = {
      confirmar: async () => {
        llamadas += 1;
        return true;
      },
      conflictos: async () => [],
    };
    const res = await confirmarIdExterno(deps, candidato({ validFrom: '2021-01-01', validTo: '2020-01-01' }));
    expect(res).toMatchObject({ ok: false, motivo: 'invalido' });
    expect(llamadas).toBe(0);
  });
});

describe('guard sobre Postgres: forma de la unidad atómica (SQL generado, sin base)', () => {
  const dialect = new PgDialect();
  const texto = (s: SQL) => dialect.sqlToQuery(s);

  function dbFalsa(resultadoEscritura: unknown) {
    const ejecutadas: SQL[] = [];
    let lote: SQL[] = [];
    const db = {
      execute: (s: SQL) => {
        ejecutadas.push(s);
        return s as never;
      },
      batch: async (items: SQL[]) => {
        lote = items;
        return [[{ pg_advisory_xact_lock: '' }], resultadoEscritura];
      },
    } as unknown as Pick<Db, 'batch' | 'execute'>;
    return { db, ejecutadas, lote: () => lote };
  }

  it('toma el cerrojo por ID ANTES del insert condicionado, en el mismo batch', async () => {
    const { db, lote } = dbFalsa([{ id: 'x' }]);
    const ok = await crearGuardDb(db).confirmar(candidato({ personId: '00000000-0000-4000-8000-000000000001' }));
    expect(ok).toBe(true);
    const [cerrojo, escritura] = lote().map(texto);
    expect(cerrojo.sql).toMatch(/pg_advisory_xact_lock/);
    expect(cerrojo.params).toContain('sport_external_id|fie_addr_id|100|fie');
    expect(escritura.sql).toMatch(/INSERT INTO sport_external_id/);
    expect(escritura.sql).toMatch(/WHERE NOT\s+EXISTS/);
  });

  it('el choque es inclusivo, con fin abierto, comodín de ámbito y persona distinta', async () => {
    const { db, lote } = dbFalsa([]);
    await crearGuardDb(db).confirmar(candidato({ personId: '00000000-0000-4000-8000-000000000001' }));
    const { sql } = texto(lote()[1]);
    expect(sql).toMatch(/e\.scope_federation = '' OR \$\d+ = '' OR e\.scope_federation = \$\d+/);
    expect(sql).toMatch(/e\.scope_season = '' OR/);
    expect(sql).toMatch(/e\.scope_weapon = '' OR/);
    expect(sql).toMatch(/e\.valid_from <= coalesce\(\$\d+::date, 'infinity'::date\)/);
    expect(sql).toMatch(/\$\d+::date <= coalesce\(e\.valid_to, 'infinity'::date\)/);
    expect(sql).toMatch(/e\.link_status = 'CONFIRMADO'/);
    expect(sql).toMatch(/coalesce\(ep\.merged_into_person_id, e\.person_id\) <> coalesce\(/);
  });

  it('canoniza candidato y existente, y reutiliza la fila exacta propia antes de insertar', async () => {
    const { db, lote } = dbFalsa([{ id: 'x' }]);
    const id = '00000000-0000-4000-8000-000000000002';
    await crearGuardDb(db).confirmar(candidato({ personId: id, validFrom: '2020-01-01' }));
    const { sql, params } = texto(lote()[1]);
    // El candidato se sustituye por su persona canónica en el choque y en la fila propia.
    expect(sql).toMatch(/coalesce\(ep\.merged_into_person_id, e\.person_id\) <> coalesce\(\(SELECT cp\.merged_into_person_id FROM sport_person cp WHERE cp\.id = \$\d+::uuid\), \$\d+::uuid\)/);
    expect(sql).toMatch(/WITH propia AS \(\s+UPDATE sport_external_id e/);
    expect(sql).toMatch(/e\.valid_from = \$\d+::date/);
    expect(sql).toMatch(/e\.scope_federation = \$\d+\s+AND e\.scope_season = \$\d+\s+AND e\.scope_weapon = \$\d+/);
    expect(sql).toMatch(/coalesce\(\(SELECT ep\.merged_into_person_id FROM sport_person ep WHERE ep\.id = e\.person_id\), e\.person_id\) = coalesce\(/);
    expect(sql).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM propia\)\s+AND NOT\s+EXISTS/);
    expect(sql).toMatch(/ON CONFLICT ON CONSTRAINT sport_external_id_person_key/);
    expect(sql).toMatch(/SELECT id FROM propia\s+UNION ALL\s+SELECT id FROM nueva/);
    expect(params).toContain(id);
  });

  it('con una fila propia actualizada devuelve true aunque no haya insert', async () => {
    const { db } = dbFalsa({ rows: [{ id: 'fila-existente' }] });
    expect(await crearGuardDb(db).confirmar(candidato({ personId: '00000000-0000-4000-8000-000000000002' }))).toBe(true);
  });

  it('devuelve false cuando la escritura condicionada no insertó nada', async () => {
    const { db } = dbFalsa([]);
    expect(await crearGuardDb(db).confirmar(candidato({ personId: '00000000-0000-4000-8000-000000000001' }))).toBe(false);
  });

  it('con persona nueva crea persona, alias e ID en una sola sentencia condicionada', async () => {
    const { db, lote } = dbFalsa({ rows: [{ id: 'x' }] });
    const persona: PersonaNuevaConId = {
      id: '00000000-0000-4000-8000-000000000001',
      displayName: 'FIE 100',
      nameNormalized: '100 fie',
      gender: 'F',
      countryCode: 'ESP',
      aliasSource: 'fie',
    };
    expect(await crearGuardDb(db).confirmar(candidato({ personId: persona.id }), persona)).toBe(true);
    const { sql } = texto(lote()[1]);
    expect(sql).toMatch(/INSERT INTO sport_person \(/);
    expect(sql).toMatch(/INSERT INTO sport_person_alias/);
    expect(sql).toMatch(/INSERT INTO sport_external_id/);
    expect(sql.match(/NOT\s+EXISTS/g)).toHaveLength(1);
  });
});
