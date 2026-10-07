import { describe, expect, it } from 'vitest';
import { buscarDatoDeCuenta } from '@/lib/cache';
import { grupoMasParecido } from '@/components/ranking/formato';

const { conMios } = await import('@/app/(app)/ranking/compartido');
const { armarDatosNacional, grupoNacionalAEnviar } = await import('@/app/(app)/ranking/consultas');

const fila = (fieId: number, athleteId: string | null) => ({
  fieId, position: fieId, nombre: `T${fieId}`, pais: 'ESP', paisNombre: 'España', points: 10,
  eventCount: 1, fichaUrl: null, athleteId,
});
const publica = {
  group: { weapon: 'FLORETE', gender: 'M', category: 'ABS' },
  format: 'INDIVIDUAL',
  season: 2027,
  rows: [fila(1, 'a1'), fila(2, null), fila(3, 'a3')],
  espanoles: 3,
  actualizadoEl: null,
  sourceUrl: null,
  olimpica: null,
  personas: {},
} as const;

describe('caché compartida de /ranking: lo de la cuenta va aparte', () => {
  it('la tabla FIE que se guarda no lleva nada de la cuenta', () => {
    expect(buscarDatoDeCuenta(publica)).toBeNull();
  });

  it('«es mío» se pone en la petición, con los tiradores de quien mira', () => {
    const t = conMios(publica as never, ['a3']);
    expect(t?.rows.map((r) => r.esMio)).toEqual([false, false, true]);
    expect(conMios(publica as never, [])?.rows.every((r) => !r.esMio)).toBe(true);
    expect(conMios(null, ['a1'])).toBeNull();
  });

  it('la tabla nacional viaja de un grupo en un grupo, con sólo el cálculo interno de ese grupo', () => {
    const grupos = [
      { weapon: 'FLORETE', gender: 'M', category: 'ABS', tiradores: 2 },
      { weapon: 'ESPADA', gender: 'F', category: 'M17', tiradores: 1 },
    ] as never;
    const grupo = grupoNacionalAEnviar(grupos, { weapon: 'ESPADA', gender: 'F', category: 'ABS' } as never);
    expect(grupo).toEqual({ weapon: 'ESPADA', gender: 'F', category: 'M17' });
    expect(grupoNacionalAEnviar(grupos, { weapon: 1 } as never)).toEqual({ weapon: 'FLORETE', gender: 'M', category: 'ABS' });
    const tabla = { tabla: { rows: [] }, cortes: { x: {} }, personas: { f1: 'p1' } } as never;
    const interno = {
      groups: [], cutoffs: {},
      tables: { 'ESPADA|F|M17': { rows: [{ athleteId: 'a1' }] }, 'FLORETE|M|ABS': { rows: [{ athleteId: 'a2' }] } },
      breakdowns: { 'ESPADA|F|M17|a1': [], 'FLORETE|M|ABS|a2': [] },
    } as never;
    const datos = armarDatosNacional({ grupos, grupo, tabla, interno, mios: ['a1'], armas: ['ESPADA'] });
    expect(Object.keys(datos.tablas)).toEqual(['ESPADA|F|M17']);
    expect(datos.grupoCargado).toBe('ESPADA|F|M17');
    expect(Object.keys(datos.internos)).toEqual(['ESPADA|F|M17|a1']);
    expect(Object.keys(datos.desgloses)).toEqual(['ESPADA|F|M17|a1']);
    expect(datos.personas).toEqual({ f1: 'p1' });
  });

  it('servidor y tabla eligen el mismo grupo parecido', () => {
    const g = [{ weapon: 'SABLE', gender: 'M', category: 'M20' }, { weapon: 'SABLE', gender: 'F', category: 'ABS' }];
    expect(grupoMasParecido(g, { weapon: 'SABLE', gender: 'F', category: 'M20' })).toBe(g[1]);
    expect(grupoMasParecido(g, { weapon: 'ESPADA', gender: 'F', category: 'M20' })).toBeNull();
  });
});
