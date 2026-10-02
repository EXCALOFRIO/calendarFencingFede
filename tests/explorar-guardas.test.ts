import { beforeEach, describe, expect, it, vi } from 'vitest';
import { perfil } from './helpers/explorar';

const sesion = vi.hoisted(() => ({ perfil: null as unknown }));
const lecturas = vi.hoisted(() => ({ contexto: vi.fn() }));

vi.mock('@/lib/auth/session', () => ({
  getSessionProfile: async () => sesion.perfil,
  getManagedAthletes: async () => [],
}));
vi.mock('@/lib/sport/explorar/real', () => ({ contextoReal: lecturas.contexto }));

const { default: Pagina } = await import('@/app/(app)/explorar/page');
const { visibles } = await import('@/components/nav');

beforeEach(() => {
  sesion.perfil = null;
  lecturas.contexto.mockReset();
});

describe('guarda directa de /explorar', () => {
  it('sin sesión redirige a /entrar antes de construir contexto o leer parámetros con datos', async () => {
    const llamada = Pagina({ searchParams: Promise.resolve({ q: 'garcia', nacionalidad: 'ESP' }) });
    await expect(llamada).rejects.toMatchObject({ digest: expect.stringContaining('/entrar') });
    expect(lecturas.contexto).not.toHaveBeenCalled();
  });

  it('con acceso revocado (perfil nulo) tampoco entrega la pantalla', async () => {
    sesion.perfil = null;
    await expect(Pagina({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    });
    expect(lecturas.contexto).not.toHaveBeenCalled();
  });

  it('si la sesión caduca durante la lectura también redirige', async () => {
    sesion.perfil = perfil({ role: 'athlete' });
    lecturas.contexto.mockReturnValue({
      perfil: async () => null,
      esquema: async () => ({ identidad: true, referencias: true }),
      db: { execute: vi.fn() },
      hoy: () => '2026-10-02',
      propietario: {},
    });
    await expect(Pagina({ searchParams: Promise.resolve({ q: 'garcia' }) })).rejects.toMatchObject({
      digest: expect.stringContaining('/entrar'),
    });
  });
});

describe('navegación por rol', () => {
  const destinos = (role: 'admin' | 'coach' | 'athlete') => visibles(role).map((d) => d.href);

  it('Explorar y el calendario están en la navegación de todos los roles', () => {
    for (const role of ['admin', 'coach', 'athlete'] as const) {
      expect(destinos(role)).toContain('/explorar');
      expect(destinos(role)[0]).toBe('/');
    }
  });

  it('no mezcla la administración ni Mi estado con roles que no les corresponden', () => {
    expect(destinos('coach')).toEqual(['/', '/explorar', '/ranking']);
    expect(destinos('athlete')).toEqual(['/', '/estado', '/explorar', '/ranking']);
    expect(destinos('athlete')).not.toContain('/admin');
    expect(destinos('coach')).not.toContain('/admin');
    expect(destinos('admin')).toContain('/admin');
  });

  it('la barra del móvil no pasa de cuatro destinos con Explorar', () => {
    for (const role of ['admin', 'coach', 'athlete'] as const) {
      expect(destinos(role).length).toBeLessThanOrEqual(4);
    }
  });
});
