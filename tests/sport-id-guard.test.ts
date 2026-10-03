import { afterEach, describe, expect, it } from 'vitest';
import { createD1Database } from '@/db';
import { localD1 } from '@/db/d1/testing';
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

describe('guard nativo D1: confirmación atómica en SQLite real', () => {
  const abiertos: ReturnType<typeof localD1>[] = [];
  afterEach(() => { abiertos.splice(0).forEach((local) => local.close()); });
  function fixture() {
    const local = localD1();
    abiertos.push(local);
    local.sqlite.exec("INSERT INTO sport_person(id,display_name,name_normalized) VALUES ('a','Fixture A','a'),('b','Fixture B','b'),('c','Fixture C','c')");
    return { ...local, guard: crearGuardDb(createD1Database(local.binding)) };
  }

  it('confirma el ID condicionado en una unidad serializada y no duplica al repetir', async () => {
    const local = fixture();
    expect(await local.guard.confirmar(candidato())).toBe(true);
    expect(await local.guard.confirmar(candidato())).toBe(true);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_external_id').get()!.n).toBe(1);
    expect(local.calls.every((c) => c.parameters <= 100)).toBe(true);
    expect(local.calls.some((c) => /pg_advisory|::date|::uuid/.test(c.sql))).toBe(false);
  });

  it('rechaza otra persona en vigencias inclusivas y con ámbitos comodín', async () => {
    const local = fixture();
    expect(await local.guard.confirmar(candidato({ personId: 'a', validFrom: '2018-01-01', validTo: '2020-01-01' }))).toBe(true);
    expect(await local.guard.confirmar(candidato({ validFrom: '2020-01-01', scopeFederation: 'RFEE' }))).toBe(false);
    expect(await local.guard.confirmar(candidato({ validFrom: '2020-01-02', scopeFederation: 'RFEE' }))).toBe(true);
  });

  it('canoniza una persona fusionada y reutiliza su fila exacta propia', async () => {
    const local = fixture();
    expect(await local.guard.confirmar(candidato({ personId: 'a' }))).toBe(true);
    local.sqlite.exec("UPDATE sport_person SET merged_into_person_id='b' WHERE id='a'");
    expect(await local.guard.confirmar(candidato({ evidence: 'actualizado' }))).toBe(true);
    expect(local.sqlite.prepare('SELECT person_id,evidence FROM sport_external_id').all())
      .toEqual([{ person_id: 'a', evidence: 'actualizado' }]);
    expect(await local.guard.confirmar(candidato({ personId: 'c' }))).toBe(false);
  });

  it('devuelve true al actualizar una fila propia sin insertar otra', async () => {
    const local = fixture();
    await local.guard.confirmar(candidato());
    expect(await local.guard.confirmar(candidato({ validTo: '2027-01-01' }))).toBe(true);
    expect(local.sqlite.prepare('SELECT valid_to FROM sport_external_id').all())
      .toEqual([{ valid_to: '2027-01-01' }]);
  });

  it('un choque no inserta la persona, su alias ni su ID', async () => {
    const local = fixture();
    await local.guard.confirmar(candidato({ personId: 'a' }));
    const persona: PersonaNuevaConId = { id: 'nueva', displayName: 'Fixture nueva', nameNormalized: 'fixture nueva', gender: 'F', countryCode: 'ESP', aliasSource: 'fie' };
    expect(await local.guard.confirmar(candidato({ personId: persona.id }), persona)).toBe(false);
    expect(local.sqlite.prepare("SELECT id FROM sport_person WHERE id='nueva'").all()).toEqual([]);
    expect(local.sqlite.prepare('SELECT person_id FROM sport_person_alias').all()).toEqual([]);
  });

  it('crea persona, alias e ID juntos y revierte todo ante un fallo de constraint', async () => {
    const local = fixture();
    const persona: PersonaNuevaConId = { id: 'nueva', displayName: 'Fixture nueva', nameNormalized: 'fixture nueva', gender: 'F', countryCode: 'ESP', aliasSource: 'fie' };
    expect(await local.guard.confirmar(candidato({ personId: persona.id }), persona)).toBe(true);
    expect(local.sqlite.prepare('SELECT person_id FROM sport_person_alias').all()).toEqual([{ person_id: 'nueva' }]);
    const invalid = { ...persona, id: 'fallo' };
    local.sqlite.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON sport_external_id WHEN NEW.value='200' BEGIN SELECT RAISE(ABORT,'fixture_failure'); END");
    await expect(local.guard.confirmar(candidato({ personId: invalid.id, value: '200' }), invalid)).rejects.toThrow();
    expect(local.sqlite.prepare("SELECT id FROM sport_person WHERE id='fallo'").all()).toEqual([]);
    expect(local.sqlite.prepare("SELECT person_id FROM sport_person_alias WHERE person_id='fallo'").all()).toEqual([]);
  });
});
