import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UUID_A, UUID_B, crearContexto } from './helpers/explorar';

/**
 * Las acciones de servidor son endpoints invocables por cualquiera. Se sustituye
 * `contextoReal` por un contexto controlado (sin Neon ni sesión real) para
 * comprobar que cada acción delega en una lectura guardada antes de tocar datos.
 */

const actual = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock('@/lib/sport/explorar/real', () => ({ contextoReal: () => actual.ctx }));

import {
  buscarDeportistasAccion,
  leerCaraACaraAccion,
  leerFichaAccion,
  leerHistorialAccion,
  listarRivalesAccion,
} from '@/app/(app)/explorar/acciones';

const acciones: [string, (e: unknown) => Promise<unknown>, unknown][] = [
  ['buscarDeportistasAccion', buscarDeportistasAccion, { q: 'lucia' }],
  ['leerFichaAccion', leerFichaAccion, {}],
  ['leerHistorialAccion', leerHistorialAccion, { personaId: UUID_A }],
  ['leerCaraACaraAccion', leerCaraACaraAccion, { personaId: UUID_A, rivalId: UUID_B }],
  ['listarRivalesAccion', listarRivalesAccion, { personaId: UUID_A }],
];

describe('acciones del explorador', () => {
  beforeEach(() => {
    actual.ctx = null;
  });

  it.each(acciones)('%s sin sesión o con acceso revocado no consulta nada', async (_n, accion, entrada) => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    actual.ctx = ctx;
    await expect(accion(entrada)).rejects.toThrow('NO_AUTENTICADO');
    expect(sentencias).toHaveLength(0);
  });

  it.each(acciones)('%s trata una entrada desconocida sin lanzar ni consultar', async (_n, accion) => {
    const { ctx, sentencias } = crearContexto();
    actual.ctx = ctx;
    const r = (await accion({ personaId: 42, __proto__: { admin: true }, cualquiera: 'x' })) as {
      estado: string;
    };
    expect(['entrada_invalida', 'sin_criterio']).toContain(r.estado);
    expect(sentencias).toHaveLength(0);
  });
});
