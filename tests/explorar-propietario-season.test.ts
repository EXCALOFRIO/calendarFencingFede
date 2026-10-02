import { describe, expect, it } from 'vitest';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import { resolverPersonaPropia } from '@/lib/sport/explorar/propietario';
import { ABIERTO, UUID_A, UUID_B, crearContexto, personaSimple } from './helpers/explorar';

/**
 * Propiedad del perfil con evidencia RFEE/FIE tal como la guardan las fuentes:
 * la licencia RFEE lleva la temporada «YYYY-YYYY» de su prueba (Skermo) y los
 * IDs FIE no la acotan. «Hoy» del contexto controlado es 2026-10-02, es decir
 * temporada RFEE 2026-2027 y FIE 2027. Contexto controlado: sin SQL ni sesión
 * reales.
 */

const atleta = (extra: Record<string, unknown> = {}) => ({
  id: 'ath-1',
  rfeeLicense: 'ES-123456',
  rfeeValidUntil: null,
  fieLicense: null,
  fieValidUntil: null,
  ...extra,
});

const licenciaRfee = (personId: string, extra: Partial<ExternalIdRow> = {}): ExternalIdRow => ({
  personId,
  scheme: 'rfee_license',
  value: 'ES123456',
  scopeSource: 'skermo_rfee',
  scopeFederation: 'RFEE',
  scopeSeason: '2026-2027',
  scopeWeapon: '',
  validFrom: '1900-01-01',
  validTo: null,
  linkStatus: 'CONFIRMADO',
  ...extra,
});

const idFie = (personId: string): ExternalIdRow => ({
  personId,
  scheme: 'fie_addr_id',
  value: '987',
  scopeSource: 'fie',
  scopeFederation: '',
  scopeSeason: '',
  scopeWeapon: '',
  validFrom: '1900-01-01',
  validTo: null,
  linkStatus: 'CONFIRMADO',
});

function caso(opciones: {
  externos: ExternalIdRow[];
  personas: Record<string, string | null>;
  directas?: { personId: string; athleteId: string }[];
  atleta?: ReturnType<typeof atleta>;
  fichasFie?: { fieId: number; fieLicense: string | null }[];
}) {
  return crearContexto({
    propietario: {
      atletasDeCuenta: async () => [opciones.atleta ?? atleta()],
      personasEnlazadas: async () => opciones.directas ?? [],
      fichasFiePorAtleta: async () => opciones.fichasFie ?? [],
      evidencia: {
        esquema: async () => ABIERTO,
        atletasPorLicencia: async () => [],
        fichasFie: async () => [],
        externos: async () => opciones.externos,
        personas: async () =>
          new Map(
            Object.entries(opciones.personas).map(([id, athleteId]) => [
              id,
              { athleteId, mergedIntoPersonId: null },
            ]),
          ),
      },
    },
    respuestas: [
      { cuando: /WITH RECURSIVE cadena/, filas: (s) => [{ id: String(s.params[0]) }] },
      ...personaSimple(UUID_A).slice(1),
    ],
  });
}

describe('propietario con licencia RFEE acotada por temporada', () => {
  it('RFEE 2026-2027 confirmada, sin enlace directo, atribuye la persona (no se sustituye por FIE 2027)', async () => {
    const { ctx } = caso({
      externos: [licenciaRfee(UUID_A)],
      personas: { [UUID_A]: 'ath-1' },
    });
    expect(await resolverPersonaPropia(ctx, 'perfil')).toEqual({
      estado: 'confirmada',
      personaId: UUID_A,
    });
  });

  it('la misma licencia con ID FIE de la misma persona sigue confirmando', async () => {
    const { ctx } = caso({
      externos: [licenciaRfee(UUID_A), idFie(UUID_A)],
      personas: { [UUID_A]: 'ath-1' },
      fichasFie: [{ fieId: 987, fieLicense: null }],
    });
    expect(await resolverPersonaPropia(ctx, 'perfil')).toEqual({
      estado: 'confirmada',
      personaId: UUID_A,
    });
  });

  it('RFEE de otra temporada o fuera de vigencia no establece propiedad', async () => {
    const otraTemporada = caso({
      externos: [licenciaRfee(UUID_A, { scopeSeason: '2025-2026' })],
      personas: { [UUID_A]: 'ath-1' },
    });
    expect((await resolverPersonaPropia(otraTemporada.ctx, 'p')).estado).toBe('sin_vinculo');

    const caducada = caso({
      externos: [licenciaRfee(UUID_A, { validFrom: '2025-09-01', validTo: '2026-06-30' })],
      personas: { [UUID_A]: 'ath-1' },
    });
    expect((await resolverPersonaPropia(caducada.ctx, 'p')).estado).toBe('sin_vinculo');
  });

  it('RFEE que apunta a otra persona que el enlace directo es conflicto, no se ignora', async () => {
    const { ctx } = caso({
      externos: [licenciaRfee(UUID_B)],
      personas: { [UUID_A]: 'ath-1', [UUID_B]: null },
      directas: [{ personId: UUID_A, athleteId: 'ath-1' }],
    });
    expect((await resolverPersonaPropia(ctx, 'p')).estado).toBe('conflicto');
  });

  it('RFEE y FIE confirmadas para personas distintas son conflicto conjunto', async () => {
    const { ctx } = caso({
      externos: [licenciaRfee(UUID_A), idFie(UUID_B)],
      personas: { [UUID_A]: 'ath-1', [UUID_B]: 'ath-1' },
      fichasFie: [{ fieId: 987, fieLicense: null }],
    });
    expect((await resolverPersonaPropia(ctx, 'p')).estado).toBe('conflicto');
  });

  it('un nombre igual o la licencia sin ID confirmado no atribuyen nada', async () => {
    const { ctx } = caso({
      externos: [licenciaRfee(UUID_A, { linkStatus: 'PROPUESTO' })],
      personas: { [UUID_A]: 'ath-1' },
    });
    expect((await resolverPersonaPropia(ctx, 'p')).estado).toBe('sin_vinculo');
  });
});
