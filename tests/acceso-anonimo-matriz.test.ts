import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UUID_A, UUID_B } from './helpers/explorar';

/**
 * VAL-SEC-001. Matriz destino → guarda → denegación sin sesión.
 *
 * La identidad es la REAL de la aplicación (`getSessionProfile`), alimentada
 * por un proveedor de sesión que no devuelve usuario; la base es un registrador
 * que cuenta cualquier acceso. Demuestra que, sin sesión, cada destino redirige
 * o deniega y no llega a leer datos. No hay inicio de sesión real ni base real:
 * no sustituye al recorrido autenticado del propietario.
 */

const bd = vi.hoisted(() => ({ accesos: 0 }));

vi.mock('@/db', () => {
  const cadena: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          bd.accesos += 1;
          return (ok: (v: unknown) => unknown) => ok([]);
        }
        return () => cadena;
      },
    },
  );
  return {
    db: {
      select: () => cadena,
      selectDistinct: () => cadena,
      execute: async () => {
        bd.accesos += 1;
        return { rows: [] };
      },
    },
    schema: {},
  };
});
vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({ api: { getSession: async () => null } }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
}));
// Esta matriz comprueba las guardas reales, no renderiza paneles. Evita cargar
// gráficos y controles cliente antes de comprobar una redirección anónima.
vi.mock('@/components/ranking/panel-ranking', () => ({ PanelRanking: () => null }));
vi.mock('@/components/ranking/tabla-oficial', () => ({ TablaRankingOficial: () => null }));

const raiz = path.resolve(__dirname, '..');
const leer = (relativa: string) => readFileSync(path.join(raiz, relativa), 'utf8');

beforeEach(() => {
  bd.accesos = 0;
});

const redirigeAEntrar = { digest: expect.stringMatching(/NEXT_REDIRECT.*\/entrar/) };
const sinConsulta = Promise.resolve({});

describe('páginas sin sesión', () => {
  const rutaPersona = Promise.resolve({ personaId: UUID_A });

  const paginas: [string, string, () => Promise<unknown>][] = [
    ['/ranking', '@/app/(app)/ranking/page', async () => (await import('@/app/(app)/ranking/page')).default()],
    [
      '/explorar',
      '@/app/(app)/explorar/page',
      async () => (await import('@/app/(app)/explorar/page')).default({ searchParams: sinConsulta }),
    ],
    [
      '/explorar/ediciones',
      '@/app/(app)/explorar/ediciones/page',
      async () => (await import('@/app/(app)/explorar/ediciones/page')).default({ searchParams: sinConsulta }),
    ],
    [
      '/explorar/ediciones/[edicionId]',
      '@/app/(app)/explorar/ediciones/[edicionId]/page',
      async () =>
        (await import('@/app/(app)/explorar/ediciones/[edicionId]/page')).default({
          params: Promise.resolve({ edicionId: UUID_A }),
          searchParams: Promise.resolve({ prueba: UUID_B }),
        }),
    ],
    [
      '/explorar/[personaId]',
      '@/app/(app)/explorar/[personaId]/page',
      async () =>
        (await import('@/app/(app)/explorar/[personaId]/page')).default({
          params: rutaPersona,
          searchParams: sinConsulta,
        }),
    ],
    [
      '/explorar/[personaId]/cara-a-cara',
      '@/app/(app)/explorar/[personaId]/cara-a-cara/page',
      async () =>
        (await import('@/app/(app)/explorar/[personaId]/cara-a-cara/page')).default({
          params: rutaPersona,
          searchParams: Promise.resolve({ rival: UUID_B }),
        }),
    ],
    [
      '/explorar/favoritos',
      '@/app/(app)/explorar/favoritos/page',
      async () => (await import('@/app/(app)/explorar/favoritos/page')).default({ searchParams: sinConsulta }),
    ],
  ];

  it.each(paginas)('%s redirige a /entrar sin leer datos', async (_ruta, _modulo, abrir) => {
    await expect(abrir()).rejects.toMatchObject(redirigeAEntrar);
    expect(bd.accesos).toBe(0);
  }, 30_000);

  it('/ y /perfil niegan en su página y el diseño común redirige a /entrar antes de cargar datos', async () => {
    const { default: Calendario } = await import('@/app/(app)/page');
    await expect(Calendario()).rejects.toThrow('NO_AUTENTICADO');
    // El contexto de retorno viaja en la URL: leerlo no abre la ruta sin sesión.
    await expect(
      Calendario({ searchParams: Promise.resolve({ mes: '2026-11', armas: 'ESPADA', q: 'mundial' }) }),
    ).rejects.toThrow('NO_AUTENTICADO');
    const { default: Perfil } = await import('@/app/(app)/perfil/page');
    await expect(Perfil({ searchParams: sinConsulta } as never)).rejects.toThrow('NO_AUTENTICADO');

    const { default: Diseno } = await import('@/app/(app)/layout');
    await expect(Diseno({ children: null })).rejects.toMatchObject(redirigeAEntrar);
    expect(bd.accesos).toBe(0);
  }, 30_000);
});

describe('acciones de servidor sin sesión', () => {
  it('las acciones del explorador, favoritos y resultados de torneo deniegan sin consultar', async () => {
    const explorar = await import('@/app/(app)/explorar/acciones');
    const favoritos = await import('@/app/(app)/explorar/favoritos-acciones');
    const { resultadosDelEvento } = await import('@/app/(app)/explorar/resultados-evento');

    const denegadas: [string, (e: unknown) => Promise<unknown>, unknown][] = [
      ['buscarDeportistasAccion', explorar.buscarDeportistasAccion, { q: 'lucia' }],
      ['leerFichaAccion', explorar.leerFichaAccion, { personaId: UUID_A }],
      ['leerHistorialAccion', explorar.leerHistorialAccion, { personaId: UUID_A }],
      ['leerCaraACaraAccion', explorar.leerCaraACaraAccion, { personaId: UUID_A, rivalId: UUID_B }],
      ['listarRivalesAccion', explorar.listarRivalesAccion, { personaId: UUID_A }],
      ['guardarFavoritoAccion', favoritos.guardarFavoritoAccion, { personaId: UUID_A }],
      ['quitarFavoritoAccion', favoritos.quitarFavoritoAccion, { personaId: UUID_A }],
      ['consultarFavoritoAccion', favoritos.consultarFavoritoAccion, { personaId: UUID_A }],
      ['listarFavoritosAccion', favoritos.listarFavoritosAccion, {}],
    ];
    for (const [nombre, accion, entrada] of denegadas) {
      await expect(accion(entrada), nombre).rejects.toThrow('NO_AUTENTICADO');
    }
    expect(await resultadosDelEvento(UUID_A)).toEqual({ tipo: 'sin_sesion' });
    expect(bd.accesos).toBe(0);
  });

  it('el detalle y los inscritos del calendario deniegan sin consultar', async () => {
    const { detalleDelEvento } = await import('@/app/(app)/detalle-evento');
    const { inscritosDelEvento } = await import('@/app/(app)/inscritos');
    await expect(detalleDelEvento(UUID_A)).rejects.toThrow('NO_AUTENTICADO');
    await expect(inscritosDelEvento(UUID_A)).rejects.toThrow('NO_AUTENTICADO');
    expect(bd.accesos).toBe(0);
  });
});

describe('excepciones existentes', () => {
  it('/entrar y los recursos estáticos no dependen de la guarda de la aplicación', () => {
    expect(readFileSync(path.join(raiz, 'src/app/entrar/page.tsx'), 'utf8')).toContain('getSessionProfile');
    const layout = leer('src/app/(app)/layout.tsx');
    expect(layout).toContain("redirect('/entrar')");
    // /entrar vive fuera del grupo (app): la redirección del diseño común no lo alcanza.
    expect(() => readFileSync(path.join(raiz, 'src/app/(app)/entrar/page.tsx'))).toThrow();
  });

  it('el feed iCal conserva su credencial propia (token revocable) y no pide sesión', () => {
    const feed = leer('src/app/api/calendario/[token]/route.ts');
    expect(feed).toContain('ical_token');
    expect(feed).not.toContain('requireProfile');
    expect(feed).not.toContain('getSessionProfile');
    expect(feed).toContain("export const dynamic = 'force-dynamic'");
  });

  it('no existe un proxy o middleware que cambie el reparto de guardas sin que esta matriz lo vea', () => {
    for (const f of ['src/proxy.ts', 'src/middleware.ts', 'proxy.ts', 'middleware.ts']) {
      expect(() => readFileSync(path.join(raiz, f))).toThrow();
    }
  });

  it('las nuevas páginas y la acción de resultados guardan antes de leer, en el propio archivo', () => {
    for (const f of [
      'src/app/(app)/explorar/ediciones/page.tsx',
      'src/app/(app)/explorar/ediciones/[edicionId]/page.tsx',
    ]) {
      const fuente = leer(f);
      expect(fuente.indexOf('getSessionProfile()')).toBeGreaterThan(-1);
      expect(fuente.indexOf('getSessionProfile()')).toBeLessThan(fuente.indexOf('contextoReal()'));
    }
    expect(leer('src/lib/sport/explorar/ediciones.ts').match(/await exigirPerfil\(ctx\)/g)).toHaveLength(3);
  });
});
