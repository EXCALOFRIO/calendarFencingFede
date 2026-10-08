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

const { ChipsActivos, EstadoSinCoincidencias, EstadoSinLista, ListaDeportistas, anadirSinRepetir } = await import(
  '@/components/explorar/resultados'
);
const { FormularioFiltros, HojaTirador } = await import('@/components/explorar/formulario-filtros');

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
  const lista = (items: React.ComponentProps<typeof ListaDeportistas>['items'], extra: Record<string, unknown> = {}) =>
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
    expect(html).toContain(`href="/explorar/${UUID_A}?volver=%2Fexplorar%2Fbuscar%3Fq%3Dgarcia"`);
    expect(html).toContain(`href="/explorar/${UUID_B}?volver=%2Fexplorar%2Fbuscar%3Fq%3Dgarcia"`);
    expect(html).toContain('2 personas con este nombre');
    expect(html).toContain('n. 2001');
    expect(html).toContain('n. 1994');
  });

  it('cada fila lleva lo que el buscador guarda en Recientes al abrirla, dentro de su contenedor', () => {
    const fila = resumen({ id: UUID_A, nombre: 'ZABALA Juan', pais: 'ESP' });
    const html = lista([fila, resumen({ id: UUID_B, nombre: 'Sin País', pais: null })]);
    expect(html).toMatch(new RegExp(`<li [^>]*data-fila-perfil=""[^>]*data-persona="${UUID_A}"[^>]*data-nombre="ZABALA Juan"[^>]*data-pais="ESP"`));
    expect(html).toMatch(new RegExp(`data-persona="${UUID_B}"[^>]*data-pais=""`));
    const c = criterios({ q: 'zabala' });
    const pagina = renderToStaticMarkup(React.createElement(FormularioFiltros, {
      criterios: c, temporadas: opcionesTemporada('2026-10-02', 2), atajoEspana: false, profileId: 'cuenta-1',
    }, React.createElement(ListaDeportistas, { items: [fila], siguiente: null, cursorActual: undefined, criterios: c })));
    // El clic se recoge por delegación en #explorar-perfiles (BuscadorSocial), como en el desplegable.
    expect(pagina.indexOf('id="explorar-perfiles"')).toBeGreaterThan(-1);
    expect(pagina.indexOf(`data-persona="${UUID_A}"`)).toBeGreaterThan(pagina.indexOf('id="explorar-perfiles"'));
  });

  it('no muestra el año de nacimiento si el nombre es único', () => {
    expect(lista([resumen({ anioNacimiento: 2001, mismoNombre: 1 })])).not.toContain('2001');
  });

  it('indica el alias coincidente y que no hay resultados importados, sin líneas vacías', () => {
    const html = lista([
      resumen({ alias: 'GARCIA PEREZ Lucia', resultadosImportados: 0, armas: [], pais: null, genero: null }),
    ]);
    expect(html).toContain('También como </span><span aria-hidden="true">«</span>GARCIA PEREZ Lucia');
    expect(html).not.toContain('Sin competiciones importadas');
    expect(html).not.toContain('País no publicado');
  });

  it('la fila no lleva ranking, puntos ni puestos, ni frases de actividad', () => {
    const html = lista([resumen()]);
    expect(html).not.toMatch(/ranking oficial|puntos|puesto|cálculo/i);
    expect(html).not.toContain('competiciones');
  });

  it('las medallas van con su número y su metal escrito, no sólo con el color', () => {
    const html = lista([{ ...resumen(), trayectoria: { ultima: null, mejorPuesto: 1, oros: 2, platas: 0, bronces: 1 } }]);
    expect(html).toMatch(/>2<span class="sr-only"> oros<\/span>/);
    expect(html).toMatch(/>1<span class="sr-only"> bronce<\/span>/);
    expect(html).not.toContain('platas');
  });

  it('«Seguir» sólo aparece si se sabe si la cuenta ya sigue a la persona', () => {
    expect(lista([{ ...resumen(), seguida: true }])).toContain('data-estado="favorito"');
    expect(lista([{ ...resumen(), seguida: false }])).toContain('data-estado="sin-guardar"');
    expect(lista([resumen()])).not.toContain('data-estado');
  });

  it('«Ver más» añade sin repetir a nadie y sin reordenar lo ya pintado', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const c = { id: 'c' };
    expect(anadirSinRepetir([a, b], [b, c]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(anadirSinRepetir([a], []).map((x) => x.id)).toEqual(['a']);
  });

  it('enlaza la página siguiente con cursor y la primera página al continuar', () => {
    const html = lista([resumen()], { siguiente: 'tok-2', cursorActual: 'tok-1' });
    // «Ver más» añade la página siguiente sin navegar; «Ir a los primeros» sustituye la entrada del historial.
    expect(html).toContain('data-slot="sistema-ver-mas"');
    expect(html).toContain('href="/explorar/buscar?q=garcia"');
    expect(html).toContain('Ver más');
    expect(lista([resumen()])).not.toContain('Ver más');
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
    // Sólo con el nombre no hay filtros que quitar; con filtros, se quitan y el nombre se queda.
    expect(sin).not.toContain('Quitar filtros');
    const conFiltros = renderToStaticMarkup(React.createElement(EstadoSinCoincidencias, { criterios: criterios({ q: 'zz', arma: 'SABLE' }) }));
    expect(conFiltros).toContain('Quitar filtros');
    expect(conFiltros).toContain('href="/explorar/buscar?q=zz"');
  });

  it('los filtros activos son enlaces que quitan uno solo', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChipsActivos, { criterios: criterios({ arma: 'FLORETE', nacionalidad: 'ESP' }) }),
    );
    expect(html).toContain('aria-label="Quitar filtro Arma: Florete"');
    expect(html).toContain('href="/explorar/buscar?nacionalidad=ESP"');
    expect(html).toContain('href="/explorar/buscar?arma=FLORETE"');
  });
});

describe('formulario de filtros', () => {
  const formulario = (atajoEspana: boolean, c: CriteriosExplorar = CRITERIOS_VACIOS) =>
    renderToStaticMarkup(
      React.createElement(FormularioFiltros, { criterios: c, temporadas: opcionesTemporada('2026-10-02', 2), atajoEspana }),
    );
  const hoja = (atajoEspana: boolean, c: CriteriosExplorar = CRITERIOS_VACIOS) =>
    renderToStaticMarkup(React.createElement(HojaTirador, { borrador: c, poner: () => {}, atajoEspana }));

  it('el atajo España sólo existe cuando la pantalla lo habilita para el rol, y refleja el estado', () => {
    expect(hoja(true)).toContain('Solo España');
    expect(hoja(false)).not.toContain('Solo España');
    expect(hoja(true, criterios({ nacionalidad: 'ESP' }))).toMatch(/aria-pressed="true"[^>]*>(?:<[^>]+>)*Solo España</);
  });

  it('un solo botón «Filtros» abre una sola hoja; los puestos son chips que se quitan y el campo tiene etiqueta', () => {
    const html = formulario(true, criterios({ nacionalidad: 'ESP', arma: 'ESPADA' }));
    expect(html).toContain('for="explorar-q"');
    expect(html).toContain('role="search"');
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-haspopup="dialog"[^>]*>(?:<[^>]+>)*Filtros</);
    expect(html).toContain('aria-label="Quitar Espada"');
    expect(html).toContain('aria-label="Quitar España"');
    expect(html).toContain('Quitar todos');
    // El selector de ámbitos va con el buscador, encima de los filtros.
    expect(html.indexOf('data-slot="sistema-segmentado"')).toBeLessThan(html.indexOf('data-slot="barra-filtros"'));
  });

  it('la hoja: arma y género segmentados, categoría en chips y país con buscador', () => {
    const html = hoja(false, criterios({ arma: 'ESPADA' }));
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>(?:<[^>]+>)*Espada</);
    expect(html.match(/data-slot="sistema-segmentado"/g)).toHaveLength(2);
    for (const t of ['Arma', 'Género', 'Categoría', 'País']) expect(html).toContain(`>${t}<`);
    expect(html).toContain('aria-label="Buscar país"');
  });

  it('filtros de tirador: arma, género, categoría y país; sin año, temporada, fechas ni torneo', () => {
    const conFiltro = formulario(false, criterios({ temporada: '2025-2026', arma: 'ESPADA' }));
    // Un filtro de un enlace antiguo se ve con su nombre y se puede quitar.
    expect(conFiltro).toContain('Quitar Temporada: 2025-2026');
    const vacio = formulario(false);
    expect(vacio).toContain('Buscar tiradores');
    expect(vacio).not.toContain('Aplicar filtros');
    expect(vacio).not.toContain('Quitar todos');
    const enHoja = hoja(false);
    for (const id of ['explorar-temporada', 'explorar-desde', 'explorar-hasta', 'explorar-torneo', 'explorar-ambito', 'explorar-organizador']) {
      expect(vacio + enHoja).not.toContain(`id="${id}"`);
    }
    expect(vacio + enHoja).not.toMatch(/>(Temporada|Fechas|Torneo|Ámbito|Organizador)</);
    expect(vacio + enHoja).not.toContain('<select');
  });
});