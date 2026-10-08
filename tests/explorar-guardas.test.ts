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
const { default: PaginaBuscar } = await import('@/app/(app)/explorar/buscar/page');
const { DESTINOS_APP } = await import('@/components/navegacion-app');
const { seccionesDeTu } = await import('@/components/tu/filas');

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
    await expect(PaginaBuscar({ searchParams: Promise.resolve({ q: 'garcia' }) })).rejects.toMatchObject({
      digest: expect.stringContaining('/entrar'),
    });
  });

  it('con sesión, una búsqueda en `/explorar` (enlace antiguo) redirige a Tiradores sin leer nada', async () => {
    sesion.perfil = perfil({ role: 'athlete' });
    await expect(Pagina({ searchParams: Promise.resolve({ q: 'garcia', arma: 'espada', cursor: 'c1' }) })).rejects.toMatchObject({
      digest: expect.stringContaining('/explorar/buscar?q=garcia&arma=ESPADA&cursor=c1'),
    });
    expect(lecturas.contexto).not.toHaveBeenCalled();
  });
});

describe('navegación por rol', () => {
  const hrefs = (role: 'admin' | 'coach' | 'athlete') =>
    seccionesDeTu({ role, fichaPropia: null, convocatorias: 0 }).flatMap((s) => s.filas.map((f) => f.href));

  it('la barra es la misma para todos: Calendario, Explorar, Ranking y Tú', () => {
    expect(DESTINOS_APP.map((d) => d.href)).toEqual(['/', '/explorar', '/ranking', '/explorar/yo']);
  });

  it('lo que depende del papel va en Tú: ni la administración ni Mi estado a quien no le toca', () => {
    expect(hrefs('athlete')).toContain('/estado');
    expect(hrefs('athlete')).not.toContain('/admin');
    expect(hrefs('coach')).not.toContain('/admin');
    expect(hrefs('coach')).not.toContain('/estado');
    expect(hrefs('admin')).toContain('/admin');
  });
});
