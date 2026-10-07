import * as React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  cargarEstadoFavorito,
  cargarFavoritos,
  type EstadoFavoritoVista,
  type VistaFavoritos,
} from '@/lib/sport/explorar/favoritos-pantalla';
import {
  RUTA_FAVORITOS,
  construirUrlFavoritos,
  leerCursorFavoritos,
} from '@/lib/sport/explorar/favoritos-url';
import { codificarCursor } from '@/lib/sport/explorar/cursor';
import { leerCriteriosFicha, rutaFichaConRetorno, sanitizarRetorno } from '@/lib/sport/explorar/ficha-url';
import type { FavoritoResumen } from '@/lib/sport/explorar/favoritos';
import { UUID_A, UUID_B, crearContexto, perfil, personaSimple } from './helpers/explorar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/explorar/favoritos',
}));
vi.mock('@/app/(app)/explorar/favoritos-acciones', () => ({
  guardarFavoritoAccion: vi.fn(),
  quitarFavoritoAccion: vi.fn(),
}));

const { BotonFavorito } = await import('@/components/explorar/boton-favorito');
const { ControlFavoritoFicha, EnlaceFavoritos, EstadoFavoritos, ListaFavoritos } = await import(
  '@/components/explorar/favoritos'
);
const { VolverAExplorar } = await import('@/components/explorar/ficha-deportiva');
const { DESTINOS_APP, pestanaDeRuta } = await import('@/components/navegacion-app');

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);
const sinEscapar = (s: string) => s.replaceAll('&amp;', '&');

const favorito = (parcial: Partial<FavoritoResumen> = {}): FavoritoResumen => ({
  id: UUID_A,
  nombre: 'Lucía García',
  alias: null,
  pais: 'ESP',
  genero: 'F',
  anioNacimiento: 2001,
  resultadosImportados: 3,
  armas: ['FLORETE'],
  mismoNombre: 1,
  guardadoEl: '2026-09-30 10:00:00.123456+00',
  ...parcial,
});

const FILA = (id: string, nombre: string, creado: string) => ({
  id,
  nombre,
  claveNombre: nombre.toLowerCase(),
  pais: null,
  genero: null,
  anioNacimiento: null,
  guardadoEl: creado,
  mismoNombre: 1,
});

describe('retorno a la lista de favoritos', () => {
  it('acepta sólo la ruta de favoritos con su cursor y descarta lo demás', () => {
    expect(sanitizarRetorno('/explorar/favoritos')).toBe('/explorar/favoritos');
    expect(sanitizarRetorno('/explorar/favoritos?cursor=abc%2B1')).toBe('/explorar/favoritos?cursor=abc%2B1');
    expect(sanitizarRetorno('/explorar/favoritos?cursor=abc&profileId=ajena&x=1')).toBe(
      '/explorar/favoritos?cursor=abc',
    );
    for (const malo of [
      '/explorar/favoritos/otra',
      '/explorar/favoritosx',
      '/explorar/favoritos#x',
      '//malicioso.example/explorar/favoritos',
      'https://malicioso.example/explorar/favoritos',
      '/explorar/favoritos\\..\\x',
      `/explorar/favoritos?cursor=${'a'.repeat(700)}`,
    ]) {
      expect(sanitizarRetorno(malo)).toBe('');
    }
  });

  it('la ficha abierta desde la lista vuelve a la misma página de la lista', () => {
    const volver = construirUrlFavoritos('tok-2');
    const href = rutaFichaConRetorno(UUID_A, volver);
    expect(href.startsWith(`/explorar/${UUID_A}?volver=`)).toBe(true);
    const leidos = leerCriteriosFicha(Object.fromEntries(new URL(href, 'http://x.test').searchParams));
    expect(leidos.volver).toBe(volver);

    const enlace = html(React.createElement(VolverAExplorar, { volver: leidos.volver }));
    expect(enlace).toContain(`href="${volver}"`);
    expect(enlace).toContain('Volver a Favoritos');
    expect(enlace).not.toContain('Volver a Explorar');
  });

  it('primera página y entrada directa conservan el destino correcto', () => {
    expect(rutaFichaConRetorno(UUID_A, RUTA_FAVORITOS)).toContain('volver=%2Fexplorar%2Ffavoritos');
    expect(html(React.createElement(VolverAExplorar, { volver: '' }))).toContain('Volver a Explorar');
  });

  it('el cursor es el único criterio de la URL y nada ajeno se lee', () => {
    expect(leerCursorFavoritos({ cursor: ' tok ', profileId: 'ajena', personaId: UUID_B })).toBe('tok');
    expect(leerCursorFavoritos({ cursor: ['a', 'b'] })).toBe('a');
    expect(leerCursorFavoritos({})).toBe('');
    expect(construirUrlFavoritos()).toBe('/explorar/favoritos');
  });
});

describe('lista de favoritos: vista', () => {
  const lista = (items: FavoritoResumen[], cursorActual?: string, siguiente: string | null = null) =>
    html(React.createElement(ListaFavoritos, { items, siguiente, cursorActual }));

  it('cada fila abre la ficha por ID y vuelve a la página de la lista', () => {
    const salida = lista([favorito()], 'tok-1', 'tok-2');
    const href = sinEscapar(/href="(\/explorar\/[0-9a-f-]{36}\?[^"]+)"/.exec(salida)?.[1] ?? '');
    expect(href).toContain(`/explorar/${UUID_A}?volver=`);
    const leidos = leerCriteriosFicha(Object.fromEntries(new URL(href, 'http://x.test').searchParams));
    expect(leidos.volver).toBe('/explorar/favoritos?cursor=tok-1');
    expect(sinEscapar(salida)).toContain('href="/explorar/favoritos?cursor=tok-2"');
    expect(salida).toContain('Primera página');
  });

  it('una persona retirada o sin cuenta ni resultados se puede abrir igual', () => {
    const salida = lista([
      favorito({ pais: null, genero: null, anioNacimiento: null, armas: [], resultadosImportados: 0 }),
    ]);
    expect(salida).toContain(`href="/explorar/${UUID_A}`);
    expect(salida).not.toMatch(/no publicado|importad/i);
  });

  it('un homónimo se distingue y cada fila lleva su propio control, ya como Favorito', () => {
    const salida = lista([
      favorito({ mismoNombre: 2, anioNacimiento: 1999 }),
      favorito({ id: UUID_B, nombre: 'Otra Persona' }),
    ]);
    expect(salida).toContain('2 personas con este nombre');
    expect(salida).toContain('n. 1999');
    expect(salida.match(/data-estado="favorito"/g)).toHaveLength(2);
    expect(salida).toContain('aria-label="Quitar de favoritos: Lucía García"');
    expect(salida).toContain('aria-label="Quitar de favoritos: Otra Persona"');
  });

  it('no filtra la fecha interna, la cuenta ni ranking interno al HTML', () => {
    const salida = lista([favorito()]);
    expect(salida).not.toContain('2026-09-30');
    expect(salida).not.toContain(perfil().profileId);
    expect(salida).not.toMatch(/ranking interno|snapshot|email|correo/i);
  });

  it('no promete notificaciones', () => {
    const salida = lista([favorito()]);
    expect(salida).not.toMatch(/te avisaremos|recibirás|activar (las )?alertas|notificaciones? (de|cuando)/i);
  });

  it('la paginación sin más páginas lo dice y no ofrece «ver más»', () => {
    const salida = lista([favorito()]);
    expect(salida).not.toContain('Ver más');
  });
});

describe('lista de favoritos: estados distintos', () => {
  const estado = (vista: Exclude<VistaFavoritos, { tipo: 'sin_sesion' }>, cursorActual?: string) =>
    html(React.createElement(EstadoFavoritos, { vista, cursorActual }));
  const OK_VACIO: Exclude<VistaFavoritos, { tipo: 'sin_sesion' }> = { tipo: 'ok', items: [], siguiente: null, sinResultados: true };

  it('vacía invita a guardar desde una ficha y no es un error', () => {
    const salida = estado(OK_VACIO);
    expect(salida).toContain('Aún no has guardado a nadie');
    expect(salida).toContain('role="status"');
    expect(salida).not.toContain('role="alert"');
    expect(salida).toContain('href="/explorar"');
  });

  it('una página vacía con cursor (se quitó a quien había) lleva a la primera, no dice «sin favoritos»', () => {
    const salida = estado(OK_VACIO, 'tok');
    expect(salida).toContain('Página vacía');
    expect(salida).not.toContain('Aún no has guardado a nadie');
    expect(salida).toContain('href="/explorar/favoritos"');
  });

  it('el fallo de lectura es una alerta con reintento que conserva la página y no dice «vacía»', () => {
    const salida = estado({ tipo: 'error' }, 'tok-9');
    expect(salida).toContain('role="alert"');
    expect(sinEscapar(salida)).toContain('href="/explorar/favoritos?cursor=tok-9"');
    expect(salida).toContain('Reintentar');
    expect(salida).not.toContain('Aún no has guardado a nadie');
  });

  it.each([['cursor_invalido' as const], ['no_disponible' as const], ['entrada_invalida' as const]])(
    '%s se explica como alerta y nunca como lista vacía',
    (tipo) => {
      const salida = estado({ tipo });
      expect(salida).toContain('role="alert"');
      expect(salida).not.toContain('Aún no has guardado a nadie');
    },
  );
});

describe('estrella minimalista de favoritos', () => {
  const boton = (inicial: boolean, variante?: 'ficha' | 'lista') =>
    html(React.createElement(BotonFavorito, { personaId: UUID_A, nombre: 'Lucía García', inicial, lectura: {}, variante }));

  it('favorito: estrella rellena, estado pulsado y nombre accesible, sin botón rotulado', () => {
    const salida = boton(true);
    expect(salida).toContain('data-estado="favorito"');
    expect(salida).toContain('fill-current');
    expect(salida).toContain('aria-pressed="true"');
    expect(salida).not.toContain('>Favorito<');
    expect(salida).not.toContain('>Quitar de favoritos<');
    expect(salida).toContain('aria-label="Quitar de favoritos: Lucía García"');
    expect(salida).toContain('aria-disabled="false"');
  });

  it('sin guardar: estrella vacía y estado no pulsado, sin etiquetas duplicadas', () => {
    const salida = boton(false);
    expect(salida).toContain('data-estado="sin-guardar"');
    expect(salida).toContain('aria-pressed="false"');
    expect(salida).not.toContain('fill-current');
    expect(salida).not.toContain('>Sin guardar<');
    expect(salida).not.toContain('>Guardar en favoritos<');
    expect(salida).toContain('aria-label="Guardar en favoritos: Lucía García"');
  });

  it('tiene región de estado siempre presente, objetivo táctil de 44 px y ninguna promesa de avisos', () => {
    const salida = boton(false);
    expect(salida).toContain('role="status"');
    expect(salida).toContain('min-h-11');
    expect(salida).toContain('min-w-11');
    expect(salida).toContain('aria-busy="false"');
    expect(salida).not.toMatch(/te avisaremos|recibirás|alerta|suscri|seguir|siguiendo/i);
  });

  it('en la lista el mensaje de estado sólo se anuncia a lectores de pantalla y no repite la nota', () => {
    const salida = boton(true, 'lista');
    expect(salida).toMatch(/role="status"[^>]*class="[^"]*sr-only/);
    expect(salida).not.toContain('No envía avisos');
  });

  it('la ficha tampoco ocupa espacio con la nota o una insignia redundante', () => {
    const salida = boton(false);
    expect(salida).toMatch(/role="status"[^>]*class="sr-only"/);
    expect(salida).not.toContain('Acceso rápido privado');
    const control = /<button\b[^>]*>[\s\S]*?<\/button>/.exec(salida)?.[0] ?? '';
    const clases = /class="([^"]+)"/.exec(control)?.[1].split(/\s+/) ?? [];
    expect(clases).not.toContain('border');
    expect(clases).not.toContain('bg-marcado');
    expect(clases).not.toContain('bg-primary');
    expect(control).toContain('data-variant="ghost"');
    expect(control).toContain('focus-visible:ring');
    expect(control).toContain('motion-reduce:transition-none');
    expect(control.match(/<svg\b/g)).toHaveLength(1);
  });

  it('el componente sólo conoce las acciones de guardar y quitar, y no pide permisos del navegador', () => {
    const fuente = readFileSync('src/components/explorar/boton-favorito.tsx', 'utf8');
    expect(fuente).toContain('guardarFavoritoAccion');
    expect(fuente).toContain('quitarFavoritoAccion');
    expect(fuente).not.toMatch(/Notification|requestPermission|serviceWorker|pushManager|navigator\./);
    expect(fuente).toContain('aria-disabled');
  });
});

describe('control en la ficha', () => {
  const control = (estado: EstadoFavoritoVista) =>
    html(React.createElement(ControlFavoritoFicha, { estado, nombre: 'Lucía García', reintentar: '/explorar/x?volver=%2Fexplorar' }));

  it('con estado conocido enseña el control con ese estado', () => {
    expect(control({ tipo: 'ok', favorito: true, personaId: UUID_A })).toContain('data-estado="favorito"');
    expect(control({ tipo: 'ok', favorito: false, personaId: UUID_A })).toContain('data-estado="sin-guardar"');
  });

  it('si no se pudo comprobar no inventa «Sin guardar»: avisa y ofrece reintentar', () => {
    const salida = control({ tipo: 'error' });
    expect(salida).toContain('role="alert"');
    expect(salida).toContain('No se ha podido comprobar');
    expect(salida).toContain('Reintentar');
    expect(salida).not.toContain('data-estado');
    expect(salida).not.toContain('Guardar en favoritos');
  });

  it('sin la migración deportiva lo dice y no ofrece guardar; persona inexistente no pinta nada', () => {
    const salida = control({ tipo: 'no_disponible' });
    expect(salida).toContain('aún no está activo');
    expect(salida).not.toContain('Guardar en favoritos');
    expect(control({ tipo: 'no_encontrada' })).toBe('');
  });
});

describe('Favoritos alcanzable sin otro destino principal', () => {
  it('la barra de navegación no gana ningún destino: Favoritos es Tú › Siguiendo', () => {
    const hrefs = DESTINOS_APP.map((d) => d.href);
    expect(hrefs).not.toContain('/explorar/favoritos');
    expect(hrefs).toEqual(['/', '/explorar', '/explorar/buscar', '/ranking', '/explorar/yo']);
    expect(pestanaDeRuta('/explorar/favoritos', false)).toBe('tu');
  });

  it('el enlace lleva a la lista y no precarga datos privados', () => {
    const salida = html(React.createElement(EnlaceFavoritos));
    expect(salida).toContain('href="/explorar/favoritos"');
    expect(salida).toContain('Mis favoritos');
    expect(salida).toContain('min-h-[44px]');
  });

  it('Explorar (por su barra) y el perfil incluyen el enlace', () => {
    expect(readFileSync('src/components/explorar/vista-buscar.tsx', 'utf8')).toContain('<CabeceraExplorar');
    expect(readFileSync('src/app/(app)/perfil/page.tsx', 'utf8')).toContain('<EnlaceFavoritos');
  });

  it('la ruta vieja de favoritos lleva a Siguiendo sin leer nada', () => {
    const fuente = readFileSync('src/app/(app)/explorar/favoritos/page.tsx', 'utf8');
    expect(fuente).toContain('redirect(RUTA_SIGUIENDO)');
    expect(fuente).not.toMatch(/cargarFavoritos|searchParams|profileId/);
  });

  it('la ficha lee el estado de favorito junto a la ficha y exige sesión antes', () => {
    const datos = readFileSync('src/app/(app)/explorar/[personaId]/(perfil)/datos.ts', 'utf8');
    expect(datos).toContain('cargarEstadoFavorito(contextoReal(), personaId)');
    expect(datos.indexOf("redirect('/entrar')")).toBeLessThan(datos.indexOf('cargarEstadoFavorito(contextoReal'));
    const layout = readFileSync('src/app/(app)/explorar/[personaId]/(perfil)/layout.tsx', 'utf8');
    expect(layout.indexOf('await exigirSesion()')).toBeLessThan(layout.indexOf('favoritoPerfil(personaId)'));
    expect(layout).toContain('<ControlFavoritoFicha');
  });
});

describe('carga de la lista y del estado con la cuenta de la sesión', () => {
  it('lista sólo con el perfil de la sesión: ni la URL ni el cursor ajeno cambian de cuenta', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [{ cuando: /FROM sport_favorite/, filas: [FILA(UUID_A, 'Ana', '2026-09-30 10:00:00+00')] }],
    });
    const vista = await cargarFavoritos(ctx, undefined);
    expect(vista).toMatchObject({ tipo: 'ok', sinResultados: false });
    const consulta = sentencias.find((s) => /FROM sport_favorite/.test(s.text));
    expect(consulta?.params).toContain(perfil().profileId);
    expect(sentencias.every((s) => !/INSERT|DELETE|UPDATE/i.test(s.text))).toBe(true);

    const ajeno = codificarCursor(
      'favoritos',
      { cuenta: '00000000-0000-4000-8000-0000000000b2' },
      ['2026-09-29 09:00:00+00', UUID_B],
    );
    const antes = sentencias.length;
    expect(await cargarFavoritos(ctx, ajeno)).toEqual({ tipo: 'cursor_invalido' });
    expect(sentencias).toHaveLength(antes);
  });

  it('lista vacía es ok+sinResultados; un fallo inesperado es error, no vacía', async () => {
    const { ctx } = crearContexto();
    expect(await cargarFavoritos(ctx, undefined)).toMatchObject({ tipo: 'ok', items: [], sinResultados: true });

    const roto = crearContexto().ctx;
    roto.db = { execute: () => Promise.reject(new Error('neon caído')) } as never;
    const registro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await cargarFavoritos(roto, undefined)).toEqual({ tipo: 'error' });
    expect(registro.mock.calls.flat().join(' ')).not.toContain('neon caído');
    registro.mockRestore();
  });

  it('sin sesión o con acceso revocado no lee nada y pide entrar', async () => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    expect(await cargarFavoritos(ctx, undefined)).toEqual({ tipo: 'sin_sesion' });
    expect(await cargarEstadoFavorito(ctx, UUID_A)).toEqual({ tipo: 'sin_sesion' });
    expect(sentencias).toHaveLength(0);
  });

  it('sin la migración deportiva se dice no_disponible', async () => {
    const { ctx } = crearContexto({ esquema: { identidad: false, referencias: false } });
    expect(await cargarFavoritos(ctx, undefined)).toEqual({ tipo: 'no_disponible' });
    expect(await cargarEstadoFavorito(ctx, UUID_A)).toEqual({ tipo: 'no_disponible' });
  });

  it('el estado de una ficha usa el perfil de la sesión, sea ajena o propia la persona', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [...personaSimple(UUID_A), { cuando: /FROM sport_favorite/, filas: [{ n: 1 }] }],
    });
    expect(await cargarEstadoFavorito(ctx, UUID_A)).toEqual({ tipo: 'ok', favorito: true, personaId: UUID_A });
    const consulta = sentencias.find((s) => /FROM sport_favorite/.test(s.text));
    expect(consulta?.params).toContain(perfil().profileId);

    const sin = crearContexto({ respuestas: personaSimple(UUID_A) });
    expect(await cargarEstadoFavorito(sin.ctx, UUID_A)).toEqual({ tipo: 'ok', favorito: false, personaId: UUID_A });
  });

  it('persona inexistente es no_encontrada y un ID mal formado es error recuperable', async () => {
    const { ctx } = crearContexto({ respuestas: [] });
    expect(await cargarEstadoFavorito(ctx, UUID_B)).toEqual({ tipo: 'no_encontrada' });
    expect(await cargarEstadoFavorito(ctx, 'no-uuid')).toEqual({ tipo: 'error' });
  });
});
