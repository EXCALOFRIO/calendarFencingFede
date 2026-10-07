import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { perfil } from './helpers/explorar';

vi.mock('lucide-react', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('lucide-react');
});
vi.mock('next/navigation', () => ({
  usePathname: () => '/explorar/yo',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, back() {}, refresh() {}, prefetch() {} }),
}));

const control = vi.hoisted(() => ({ contexto: vi.fn(), propia: vi.fn() }));
vi.mock('@/lib/sport/explorar/real', () => ({ contextoReal: control.contexto }));
vi.mock('@/lib/sport/explorar/propietario', () => ({ resolverPersonaPropia: control.propia }));

const { DESTINOS_APP } = await import('@/components/navegacion-app');
const { BarraInferior } = await import('@/components/sistema/barra-inferior');
const { NavMovil } = await import('@/components/nav');
const { GET } = await import('@/app/api/explorar/yo/retrato/route');

const h = React.createElement;
const PERSONA = '11111111-2222-4333-8444-555555555555';

describe('pestaña «Tú» con la foto propia', () => {
  it('con retrato pinta la foto oculta sobre el icono hasta que carga', () => {
    const destinos = DESTINOS_APP.map((d) => (d.clave === 'tu' ? { ...d, retrato: 'https://fie.test/r.jpg' } : d));
    const html = renderToStaticMarkup(h(BarraInferior, { destinos, activa: 'tu' }));
    const tu = html.slice(html.indexOf('data-pestana="tu"'));
    expect(tu).toMatch(/<img[^>]*data-retrato=""/);
    expect(tu).toMatch(/<img[^>]*class="[^"]*opacity-0/);
    expect(tu).toContain('<svg');
    expect(html.match(/<img/g)).toHaveLength(1);
  });

  it('el HTML del servidor no lleva datos de la cuenta: la foto se pide en el cliente', () => {
    const html = renderToStaticMarkup(h(NavMovil, { cuenta: 'cuenta-1' }));
    expect(html).not.toContain('cuenta-1');
    expect(html).not.toContain('<img');
  });

  it('la barra fija no anima transform y el documento no rebota', () => {
    const html = renderToStaticMarkup(h(BarraInferior, { destinos: DESTINOS_APP }));
    const nav = html.slice(0, html.indexOf('>'));
    expect(nav).toContain('fixed');
    expect(nav).not.toMatch(/transition-(all|transform)|duration-/);
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).toMatch(/html,\s*body\s*\{\s*overscroll-behavior-y:\s*none;/);
  });
});

describe('GET /api/explorar/yo/retrato', () => {
  beforeEach(() => {
    control.contexto.mockReset();
    control.propia.mockReset();
    control.contexto.mockReturnValue({ perfil: async () => perfil() });
  });
  const pedir = (cuenta: string) => GET(new Request(`https://aplicacion.test/api/explorar/yo/retrato?cuenta=${cuenta}`));

  it('devuelve la persona propia con caché privada', async () => {
    control.propia.mockResolvedValue({ estado: 'confirmada', personaId: PERSONA });
    const r = await pedir(perfil().profileId);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: 'ok', personaId: PERSONA });
    expect(r.headers.get('Cache-Control')).toMatch(/^private, max-age=3600/);
    expect(r.headers.get('Vary')).toBe('Cookie');
  });

  it('sin ficha vinculada devuelve null', async () => {
    control.propia.mockResolvedValue({ estado: 'sin_vinculo' });
    expect(await (await pedir(perfil().profileId)).json()).toEqual({ estado: 'ok', personaId: null });
  });

  it('rechaza otra cuenta y la falta de sesión sin resolver nada', async () => {
    expect((await pedir('otra-cuenta')).status).toBe(400);
    control.contexto.mockReturnValue({ perfil: async () => null });
    expect((await pedir(perfil().profileId)).status).toBe(401);
    expect(control.propia).not.toHaveBeenCalled();
  });
});
