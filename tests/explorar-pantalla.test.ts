import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { cargarExplorar } from '@/lib/sport/explorar/pantalla';
import { codificarCursor } from '@/lib/sport/explorar/cursor';
import { filtrosBusqueda } from '@/lib/sport/explorar/entrada';
import type { DeportistaResumen } from '@/lib/sport/explorar/tipos';
import {
  CRITERIOS_VACIOS,
  construirUrl,
  opcionesTemporada,
  type CriteriosExplorar,
} from '@/lib/sport/explorar/url';
import { UUID_A, UUID_B, UUID_C, crearContexto, perfil } from './helpers/explorar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/explorar',
}));

const { ChipsActivos, EstadoSinCoincidencias, EstadoSinLista, ListaDeportistas } = await import(
  '@/components/explorar/resultados'
);
const { FormularioFiltros } = await import('@/components/explorar/formulario-filtros');

const criterios = (parcial: Partial<CriteriosExplorar>): CriteriosExplorar => ({
  ...CRITERIOS_VACIOS,
  ...parcial,
});

const fila = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  claveNombre: nombre.toLowerCase().split(' ').sort().join(' '),
  alias: null,
  pais: 'ESP',
  genero: 'F',
  anioNacimiento: 2001,
  ...extra,
});

const consultaPrincipal = /FROM sport_person p\s+WHERE/;
const conteos = /GROUP BY g\.canonica/;
const homonimos = /GROUP BY name_normalized/;

const resumen = (extra: Partial<DeportistaResumen> = {}): DeportistaResumen => ({
  id: UUID_A,
  nombre: 'Lucía García',
  alias: null,
  pais: 'ESP',
  genero: 'F',
  anioNacimiento: 2001,
  resultadosImportados: 3,
  armas: ['FLORETE'],
  mismoNombre: 1,
  ...extra,
});

describe('cargarExplorar: estados distintos', () => {
  it('sin criterio no consulta el censo', async () => {
    const { ctx, sentencias } = crearContexto();
    expect(await cargarExplorar(ctx, CRITERIOS_VACIOS, undefined)).toEqual({ tipo: 'sin_criterio' });
    expect(sentencias).toHaveLength(0);
  });

  it('sin sesión devuelve sin_sesion y no ejecuta SQL', async () => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    expect(await cargarExplorar(ctx, criterios({ q: 'garcia' }), undefined)).toEqual({
      tipo: 'sin_sesion',
    });
    expect(sentencias).toHaveLength(0);
  });

  it('un filtro con vocabulario desconocido es entrada_invalida, no una lista vacía', async () => {
    const { ctx } = crearContexto();
    expect(await cargarExplorar(ctx, criterios({ arma: 'LASER' }), undefined)).toEqual({
      tipo: 'entrada_invalida',
    });
    expect(
      await cargarExplorar(ctx, criterios({ desde: '2026-05-01', hasta: '2026-01-01' }), undefined),
    ).toEqual({ tipo: 'entrada_invalida' });
  });

  it('un fallo de base de datos es error, nunca sinResultados', async () => {
    const { ctx } = crearContexto();
    ctx.db = { execute: (() => Promise.reject(new Error('conexión caída'))) as never };
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const vista = await cargarExplorar(ctx, criterios({ q: 'garcia' }), undefined);
    expect(vista).toEqual({ tipo: 'error' });
    // El registro lleva el tipo de error, no el mensaje ni datos de la búsqueda.
    expect(JSON.stringify(espia.mock.calls)).not.toMatch(/garcia|conexión/i);
    espia.mockRestore();
  });

  it('esquema sin migrar es no_disponible', async () => {
    const { ctx } = crearContexto({ esquema: { identidad: false, referencias: false } });
    expect(await cargarExplorar(ctx, criterios({ q: 'garcia' }), undefined)).toEqual({
      tipo: 'no_disponible',
    });
  });

  it('cero, uno y varios resultados se distinguen y los homónimos conservan su identificador', async () => {
    const vacio = crearContexto({ respuestas: [{ cuando: consultaPrincipal, filas: [] }] });
    expect(await cargarExplorar(vacio.ctx, criterios({ q: 'zzzz' }), undefined)).toMatchObject({
      tipo: 'ok',
      sinResultados: true,
      items: [],
    });

    const varios = crearContexto({
      respuestas: [
        {
          cuando: consultaPrincipal,
          filas: [fila(UUID_A, 'Ana Perez'), fila(UUID_B, 'Ana Perez', { pais: 'FRA' }), fila(UUID_C, 'Luis Perez')],
        },
        { cuando: conteos, filas: [{ id: UUID_A, resultados: 2, armas: 'SABLE' }] },
        { cuando: homonimos, filas: [{ clave: 'ana perez', personas: 2 }] },
      ],
    });
    const vista = await cargarExplorar(varios.ctx, criterios({ q: 'perez' }), undefined);
    if (vista.tipo !== 'ok') throw new Error(vista.tipo);
    expect(vista.items.map((i) => i.id)).toEqual([UUID_A, UUID_B, UUID_C]);
    expect(vista.items.filter((i) => i.mismoNombre > 1).map((i) => i.id)).toEqual([UUID_A, UUID_B]);
    expect(new Set(vista.items.map((i) => i.id)).size).toBe(3);
  });
});

describe('filtros combinados y cursor', () => {
  it('torneo, temporada y arma se evalúan en el mismo hecho, sin leer cuentas ni ranking interno', async () => {
    const { ctx, texto, sentencias } = crearContexto({
      respuestas: [{ cuando: consultaPrincipal, filas: [fila(UUID_A, 'Ana Perez')] }],
    });
    await cargarExplorar(
      ctx,
      criterios({ torneo: 'Copa del Mundo', temporada: '2025-2026', arma: 'SABLE', ambito: 'INTERNACIONAL' }),
      undefined,
    );
    const principal = sentencias[0];
    expect(principal.params).toEqual(expect.arrayContaining(['2025-2026', 'SABLE', 'INTERNACIONAL']));
    expect(texto()).not.toMatch(/\bathlete\b|user_profile|ranking_snapshot|ranking_point/);
    // Con torneo o ámbito sólo valen resultados de torneo: no se cruza con filas de ranking oficial.
    expect(principal.text).not.toMatch(/sport_ranking_entry en2/);
  });

  it('el filtro España incluye a quien no tiene cuenta, está retirado o no está convocado', async () => {
    const { ctx, texto, sentencias } = crearContexto({
      perfil: perfil({ role: 'coach', weapons: ['FLORETE'] }),
      respuestas: [
        {
          cuando: consultaPrincipal,
          filas: [fila(UUID_A, 'Retirada Sincuenta'), fila(UUID_B, 'Activa Convocada')],
        },
      ],
    });
    const vista = await cargarExplorar(ctx, criterios({ nacionalidad: 'ESP', arma: 'ESPADA' }), undefined);
    if (vista.tipo !== 'ok') throw new Error(vista.tipo);
    expect(vista.items).toHaveLength(2);
    const principal = sentencias[0].text;
    expect(principal).toMatch(/rfee_license/);
    expect(principal).toMatch(/source_country_code/);
    expect(texto()).not.toMatch(/\bathlete\b|user_profile|callup|call_up|convoc|ranking_snapshot|ranking_point/i);
  });

  it('un cursor emitido con otros filtros se rechaza y obliga a empezar de nuevo', async () => {
    const { ctx, sentencias } = crearContexto();
    const filtrosA = filtrosBusqueda({ q: 'perez', arma: 'SABLE' });
    const cursorA = codificarCursor('busqueda', filtrosA, ['perez ana', UUID_A]);

    const otroFiltro = await cargarExplorar(ctx, criterios({ q: 'perez', arma: 'ESPADA' }), cursorA);
    expect(otroFiltro).toEqual({ tipo: 'cursor_invalido' });
    expect(sentencias).toHaveLength(0);

    const mismo = crearContexto({
      respuestas: [{ cuando: consultaPrincipal, filas: [fila(UUID_B, 'Ana Perez')] }],
    });
    const igual = await cargarExplorar(mismo.ctx, criterios({ q: 'perez', arma: 'SABLE' }), cursorA);
    expect(igual.tipo).toBe('ok');
    expect(mismo.sentencias[0].params).toEqual(expect.arrayContaining(['perez ana', UUID_A]));
  });

  it('la página siguiente se enlaza con el cursor y cualquier otro cambio vuelve a la primera', async () => {
    const filas = Array.from({ length: 26 }, (_, i) =>
      fila(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`, `Persona ${String(i).padStart(2, '0')}`),
    );
    const { ctx } = crearContexto({ respuestas: [{ cuando: consultaPrincipal, filas }] });
    const c = criterios({ q: 'persona', arma: 'SABLE' });
    const vista = await cargarExplorar(ctx, c, undefined);
    if (vista.tipo !== 'ok') throw new Error(vista.tipo);
    expect(vista.items).toHaveLength(25);
    expect(vista.siguiente).toBeTruthy();
    expect(construirUrl(c, vista.siguiente ?? undefined)).toContain(`cursor=${vista.siguiente}`);
    expect(construirUrl({ ...c, arma: 'ESPADA' })).not.toContain('cursor');
  });
});

describe('vista de resultados', () => {
  const lista = (items: DeportistaResumen[], extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      React.createElement(ListaDeportistas, {
        items,
        siguiente: null,
        cursorActual: undefined,
        criterios: criterios({ q: 'garcia' }),
        ...extra,
      }),
    );

  it('cada fila enlaza a la ficha por identificador y los homónimos se pueden distinguir', () => {
    const html = lista([
      resumen({ id: UUID_A, nombre: 'Ana Perez', mismoNombre: 2, pais: 'ESP', anioNacimiento: 2001 }),
      resumen({ id: UUID_B, nombre: 'Ana Perez', mismoNombre: 2, pais: 'FRA', anioNacimiento: 1994 }),
    ]);
    // Cada fila lleva además la búsqueda a la que volver desde la ficha.
    expect(html).toContain(`href="/explorar/${UUID_A}?volver=%2Fexplorar%3Fq%3Dgarcia"`);
    expect(html).toContain(`href="/explorar/${UUID_B}?volver=%2Fexplorar%3Fq%3Dgarcia"`);
    expect(html).toContain('2 personas con este nombre');
    expect(html).toContain('nacimiento 2001');
    expect(html).toContain('nacimiento 1994');
  });

  it('no muestra el año de nacimiento si el nombre es único', () => {
    expect(lista([resumen({ anioNacimiento: 2001, mismoNombre: 1 })])).not.toContain('2001');
  });

  it('indica alias coincidente, sin resultados importados y país o género no publicados', () => {
    const html = lista([
      resumen({ alias: 'GARCIA PEREZ Lucia', resultadosImportados: 0, armas: [], pais: null, genero: null }),
    ]);
    expect(html).toContain('Coincide con el alias');
    expect(html).toContain('Ninguno importado');
    expect(html).toContain('Sin pruebas importadas');
    expect(html).toContain('País no publicado');
    expect(html).toContain('Género no publicado');
  });

  it('la fila no lleva ranking, puntos ni puestos, sólo clasificaciones importadas', () => {
    const html = lista([resumen()]);
    expect(html).not.toMatch(/ranking oficial|puntos|puesto|cálculo/i);
    expect(html).toContain('clasificaciones');
  });

  it('enlaza la página siguiente con cursor y la primera página al continuar', () => {
    const html = lista([resumen()], { siguiente: 'tok-2', cursorActual: 'tok-1' });
    expect(html).toContain('/explorar?q=garcia&amp;cursor=tok-2');
    expect(html).toContain('href="/explorar?q=garcia"');
    expect(html).not.toContain('No hay más resultados');
    expect(lista([resumen()])).toContain('No hay más resultados');
  });

  it('error, filtro inválido y no disponible no dicen que no haya coincidencias', () => {
    for (const tipo of ['error', 'entrada_invalida', 'cursor_invalido', 'no_disponible'] as const) {
      const html = renderToStaticMarkup(
        React.createElement(EstadoSinLista, { vista: { tipo }, criterios: criterios({ q: 'x1' }) }),
      );
      expect(html).toContain('role="alert"');
      expect(html).not.toContain('Nadie coincide');
    }
    const sin = renderToStaticMarkup(React.createElement(EstadoSinCoincidencias, { criterios: criterios({ q: 'zz' }) }));
    expect(sin).toContain('Nadie coincide');
    expect(sin).toContain('Quitar todos los filtros');
  });

  it('los filtros activos son enlaces que quitan uno solo', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChipsActivos, { criterios: criterios({ arma: 'FLORETE', nacionalidad: 'ESP' }) }),
    );
    expect(html).toContain('aria-label="Quitar filtro Arma: Florete"');
    expect(html).toContain('href="/explorar?nacionalidad=ESP"');
    expect(html).toContain('href="/explorar?arma=FLORETE"');
  });
});

describe('formulario de filtros', () => {
  const formulario = (atajoEspana: boolean, c: CriteriosExplorar = CRITERIOS_VACIOS) =>
    renderToStaticMarkup(
      React.createElement(FormularioFiltros, { criterios: c, temporadas: opcionesTemporada('2026-10-02', 2), atajoEspana }),
    );

  it('el atajo España sólo existe cuando la pantalla lo habilita para el rol', () => {
    expect(formulario(true)).toContain('Solo España');
    expect(formulario(false)).not.toContain('Solo España');
  });

  it('el atajo refleja el estado activo y todos los controles tienen etiqueta visible', () => {
    const html = formulario(true, criterios({ nacionalidad: 'ESP' }));
    expect(html).toContain('aria-pressed="true"');
    for (const id of ['explorar-q', 'explorar-arma', 'explorar-genero']) {
      expect(html).toContain(`for="${id}"`);
    }
    expect(html).toContain('role="search"');
  });

  it('abre los filtros avanzados cuando alguno está activo', () => {
    expect(formulario(false, criterios({ temporada: '2025-2026' }))).toContain('Más filtros (1 activos)');
    expect(formulario(false)).toContain('Más filtros');
    expect(formulario(false)).not.toContain('activos)');
  });
});
