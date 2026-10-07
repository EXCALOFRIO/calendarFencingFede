import { readFileSync } from 'node:fs';
import type { SQL } from 'drizzle-orm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { codificarCursor } from '@/lib/sport/explorar/cursor';
import { construirUrlInicio, RUTA_YO } from '@/lib/sport/explorar/inicio-url';
import { cargarInicio, cargarListaSiguiendo } from '@/lib/sport/explorar/inicio-pantalla';
import { leerListaSiguiendo } from '@/lib/sport/explorar/siguiendo-lista';
import { CRITERIOS_VACIOS, construirUrl, esBusqueda } from '@/lib/sport/explorar/url';
import { crearContexto, perfil } from './helpers/explorar';

/**
 * Explorar dentro de la única barra de la aplicación: Explorar como feed,
 * Buscar como pestaña propia, Siguiendo como lista de personas (en Tú) con
 * «Siguiendo» para dejar de seguir, y sin clubes.
 */

const ruta = { pathname: '/explorar', busqueda: '' };
vi.mock('next/navigation', () => ({
  usePathname: () => ruta.pathname,
  useSearchParams: () => new URLSearchParams(ruta.busqueda),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }),
}));
vi.mock('@/app/(app)/explorar/favoritos-acciones', () => ({
  guardarFavoritoAccion: async () => ({ estado: 'ok', favorito: true }),
  quitarFavoritoAccion: async () => ({ estado: 'ok', favorito: false }),
}));
vi.mock('@/app/(app)/explorar/acciones', () => ({
  masFeedAccion: async () => ({ estado: 'ok', items: [], siguiente: null, sinResultados: true }),
  masSiguiendoAccion: async () => ({ estado: 'ok', items: [], siguiente: null, sinResultados: true }),
  masDeportistasAccion: async () => ({ tipo: 'ok', items: [], siguiente: null }),
}));

const { NavEscritorio, NavMovil } = await import('@/components/nav');
const { DESTINOS_APP, cabeceraDeRuta, pestanaDeRuta } = await import('@/components/navegacion-app');
const { PantallaListaSiguiendo } = await import('@/components/explorar/pantalla-siguiendo');
const { CabeceraExplorar } = await import('@/components/explorar/cabecera-explorar');

const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((c) => c()));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CUENTA = '00000000-0000-4000-8000-0000000000a1';
const OTRA = '00000000-0000-4000-8000-0000000000b2';

function fixture() {
  const local = localD1();
  cierres.push(() => local.close());
  const database = createD1Database(local.binding);
  const db = local.sqlite;
  const persona = (id: string, nombre: string, pais: string | null = 'ESP', fundidaEn: string | null = null) =>
    db.prepare('INSERT INTO sport_person(id, display_name, name_normalized, country_code, merged_into_person_id) VALUES (?,?,?,?,?)')
      .run(id, nombre, nombre.toLowerCase(), pais, fundidaEn);
  for (const id of [CUENTA, OTRA]) {
    db.prepare('INSERT INTO user_profile(id, email, full_name, ical_token) VALUES (?,?,?,?)')
      .run(id, `${id}@example.test`, 'Cuenta sintética', `token-${id}`);
  }
  const seguir = (personaId: string, creado: number, cuenta = CUENTA) =>
    db.prepare('INSERT INTO sport_favorite(profile_id, person_id, created_at) VALUES (?,?,?)').run(cuenta, personaId, creado);
  const sentencias: string[] = [];
  function contexto(cuenta = CUENTA, sesion = true): ContextoExplorador {
    const base = crearContexto({ perfil: sesion ? perfil({ profileId: cuenta }) : null }).ctx;
    return {
      ...base,
      db: { execute: (q: SQL) => { sentencias.push('q'); return database.execute(q); } } as ContextoExplorador['db'],
    };
  }
  return { persona, seguir, contexto, sentencias };
}

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);

describe('una sola app: la barra es la misma dentro y fuera de Explorar', () => {
  it('cinco destinos: Calendario, Explorar, Buscar, Ranking y Tú', () => {
    expect(DESTINOS_APP.map((d) => d.href)).toEqual(['/', '/explorar', '/explorar/buscar', '/ranking', RUTA_YO]);
  });

  it('marca la pestaña por la ruta y por la búsqueda de la URL', () => {
    expect(pestanaDeRuta('/explorar', false)).toBe('explorar');
    expect(pestanaDeRuta('/explorar', true)).toBe('buscar');
    expect(pestanaDeRuta('/explorar/buscar', false)).toBe('buscar');
    expect(pestanaDeRuta('/explorar/ediciones/x', false)).toBe('buscar');
    expect(pestanaDeRuta('/explorar/siguiendo', false)).toBe('tu');
    expect(pestanaDeRuta(`/explorar/${uuid(1)}`, false)).toBe('explorar');
  });

  it('en Explorar y en el calendario es la misma barra de iconos, sin rótulos y sin «Volver al calendario»', () => {
    ruta.pathname = '/explorar';
    ruta.busqueda = 'q=garcia';
    const movil = html(React.createElement(NavMovil, { role: 'coach' }));
    expect(movil).toContain('data-barra="app"');
    expect(movil).not.toContain('Volver al calendario');
    expect(movil).toMatch(/<a(?=[^>]*aria-label="Buscar")(?=[^>]*aria-current="page")/);
    expect(movil).not.toMatch(/<a(?=[^>]*aria-label="Explorar")(?=[^>]*aria-current)/);
    expect(movil).toContain('size-[22px]');
    expect(movil).not.toMatch(/<span[^>]*>Explorar<\/span>/);
    const escritorio = html(React.createElement(NavEscritorio, { role: 'coach' }));
    expect(escritorio).toContain('>Explorar<');
    expect(escritorio).toContain('>Calendario<');

    ruta.pathname = '/';
    ruta.busqueda = '';
    const calendario = html(React.createElement(NavMovil, { role: 'coach' }));
    expect(calendario).toContain('data-barra="app"');
    expect(calendario).toContain('href="/ranking"');
  });

  it('las raíces de pestaña no llevan flecha de volver; Siguiendo y una ficha sí', () => {
    expect(cabeceraDeRuta('/explorar/buscar', false)?.variante).toBe('raiz');
    expect(cabeceraDeRuta('/explorar/ediciones', false)?.variante).toBe('raiz');
    expect(cabeceraDeRuta('/explorar/siguiendo', false)).toMatchObject({ variante: 'subpantalla', volverA: RUTA_YO });
    expect(cabeceraDeRuta(`/explorar/${uuid(1)}`, false)).toMatchObject({ variante: 'subpantalla', volverA: '/explorar' });
  });

  it('el hueco de la barra es uno solo, en px: ya no hay regla para la barra de Explorar', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).not.toContain("nav[data-barra='explorar']");
    expect(css).toContain('padding-bottom: calc(50px + env(safe-area-inset-bottom));');
  });
});

describe('URL: Inicio, Buscar y la búsqueda de siempre', () => {
  it('`/explorar` sin criterios es Inicio; con cualquier criterio (aunque vacío) es Buscar', () => {
    expect(esBusqueda({})).toBe(false);
    expect(esBusqueda({ medallas: '1', cursor: 'x' })).toBe(false);
    expect(esBusqueda({ q: '' })).toBe(true);
    expect(esBusqueda({ arma: 'ESPADA' })).toBe(true);
    expect(construirUrl(CRITERIOS_VACIOS)).toBe('/explorar/buscar');
    expect(construirUrl({ ...CRITERIOS_VACIOS, q: 'ana' })).toBe('/explorar?q=ana');
    expect(construirUrlInicio({ soloMedallas: true, cursor: 'c' })).toBe('/explorar?medallas=1&cursor=c');
  });

  it('Buscar tiene dos pestañas: tiradores y competiciones', () => {
    const marcado = html(React.createElement(CabeceraExplorar, {}));
    expect(marcado).toMatch(/<a[^>]*aria-current="page"[^>]*>Tiradores</);
    expect(marcado).toContain('href="/explorar/ediciones"');
  });
});

describe('Siguiendo = lista de personas', () => {
  it('una sola consulta, de la más reciente a la más antigua, con la persona raíz y sin repetir', async () => {
    const f = fixture();
    f.persona(uuid(1), 'ANA Uno');
    f.persona(uuid(2), 'BEA Dos', 'FRA');
    f.persona(uuid(3), 'CRIS Tres');
    f.persona(uuid(4), 'CRIS Tres copia', 'ESP', uuid(3));
    f.seguir(uuid(1), 100);
    f.seguir(uuid(2), 300);
    f.seguir(uuid(4), 200);
    f.seguir(uuid(3), 150);
    f.seguir(uuid(1), 999, OTRA);
    const r = await leerListaSiguiendo(f.contexto(), {});
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.items).toEqual([
      { id: uuid(2), nombre: 'BEA Dos', pais: 'FRA' },
      { id: uuid(3), nombre: 'CRIS Tres', pais: 'ESP' },
      { id: uuid(1), nombre: 'ANA Uno', pais: 'ESP' },
    ]);
    expect(f.sentencias).toHaveLength(1);
    expect(r.siguiente).toBeNull();
  });

  it('pagina por cursor ligado a la cuenta; un cursor de otra cuenta no vale', async () => {
    const f = fixture();
    for (let i = 1; i <= 5; i++) { f.persona(uuid(i), `P ${i}`); f.seguir(uuid(i), i * 10); }
    const p1 = await leerListaSiguiendo(f.contexto(), { limite: 2 });
    if (p1.estado !== 'ok' || !p1.siguiente) throw new Error('sin página');
    expect(p1.items.map((x) => x.id)).toEqual([uuid(5), uuid(4)]);
    const p2 = await leerListaSiguiendo(f.contexto(), { limite: 2, cursor: p1.siguiente });
    if (p2.estado !== 'ok') throw new Error(p2.estado);
    expect(p2.items.map((x) => x.id)).toEqual([uuid(3), uuid(2)]);
    expect(await leerListaSiguiendo(f.contexto(OTRA), { cursor: p1.siguiente })).toEqual({ estado: 'cursor_invalido' });
    const ajeno = codificarCursor('siguiendo-lista', { cuenta: CUENTA }, ['no-numero', uuid(1)]);
    expect(await leerListaSiguiendo(f.contexto(), { cursor: ajeno })).toEqual({ estado: 'cursor_invalido' });
    expect(await leerListaSiguiendo(f.contexto(), { cuenta: OTRA })).toEqual({ estado: 'entrada_invalida' });
    await expect(leerListaSiguiendo(f.contexto(CUENTA, false), {})).rejects.toThrow('NO_AUTENTICADO');
  });

  it('con una sola página el total es la longitud de la lista (sin conteo aparte)', async () => {
    const f = fixture();
    f.persona(uuid(1), 'ANA Uno'); f.persona(uuid(2), 'BEA Dos');
    f.seguir(uuid(1), 1); f.seguir(uuid(2), 2);
    const vista = await cargarListaSiguiendo(f.contexto(), undefined);
    expect(vista).toMatchObject({ tipo: 'ok', total: 2, siguiente: null });
    expect(f.sentencias).toHaveLength(1);
    expect(await cargarListaSiguiendo(f.contexto(CUENTA, false), undefined)).toEqual({ tipo: 'sin_sesion' });
  });

  it('cada fila: retrato, nombre, bandera y «Siguiendo» para dejar de seguir; nada de clubes', async () => {
    const f = fixture();
    f.persona(uuid(1), 'MARTIN RUIZ Ana'); f.seguir(uuid(1), 1);
    const vista = await cargarListaSiguiendo(f.contexto(), undefined);
    if (vista.tipo === 'sin_sesion') throw new Error('sin sesión');
    const salida = html(React.createElement(PantallaListaSiguiendo, { vista }));
    expect(salida).toContain('>Siguiendo<');
    expect(salida).toContain(`href="/explorar/${uuid(1)}"`);
    expect(salida).toContain('data-slot="avatar"');
    expect(salida).toMatch(/aria-label="Siguiendo: toca para dejar de seguir a [^"]*Ana[^"]*"/);
    expect(salida).toContain('data-estado="favorito"');
    expect(salida).not.toMatch(/club/i);
    expect(salida).toMatch(/<strong[^>]*>1<\/strong> persona/);
  });

  it('sin nadie seguido: una línea, el acceso a Buscar y sugerencias', async () => {
    const f = fixture();
    const vista = await cargarListaSiguiendo(f.contexto(), undefined);
    if (vista.tipo === 'sin_sesion') throw new Error('sin sesión');
    const salida = html(React.createElement(PantallaListaSiguiendo, { vista }));
    expect(salida).toContain('Aún no sigues a nadie');
    expect(salida).toContain('href="/explorar/buscar"');
  });
});

describe('Inicio = feed', () => {
  it('el conteo sólo se pide si la primera página sale vacía', async () => {
    const f = fixture();
    const vacia = await cargarInicio(f.contexto(), {});
    expect(vacia.vista).toMatchObject({ tipo: 'ok', sinResultados: true });
    expect(vacia.siguiendo).toBe(0);
    expect(await cargarInicio(f.contexto(CUENTA, false), {})).toEqual({ vista: { tipo: 'sin_sesion' }, siguiendo: null });
  });

  it('las sugerencias no dicen «Tu club»: en Explorar no se enseñan clubes', () => {
    const fuente = readFileSync('src/lib/sport/explorar/siguiendo-pantalla.ts', 'utf8');
    expect(fuente).not.toContain("'Tu club'");
  });
});
