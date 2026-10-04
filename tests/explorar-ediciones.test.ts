import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { leerEdicion, leerEdicionesDeEvento, leerSeries } from '@/lib/sport/explorar/ediciones';
import { cargarEdicion, cargarResultadosEvento, cargarSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { construirUrlEdicion } from '@/lib/sport/explorar/edicion-url';
import { CLAVES_PRIVADAS, UUID_A, UUID_B, UUID_C, clavesDe, crearContexto } from './helpers/explorar';

const {
  ClasificacionDePrueba,
  EdicionCompleta,
  EnlaceEdiciones,
  EstadoEdicion,
  EstadoSeries,
  ListaSeries,
  PruebasDeEdicion,
} = await import('@/components/explorar/ediciones');
const { EnlacesResultados, EstadoResultadosPrueba } = await import('@/components/explorar/prueba-resultados');

/**
 * Lecturas y pantallas de ediciones con contexto controlado: SQL registrado y
 * filas fijadas por el caso. No hay PostgreSQL, Neon Auth ni red.
 */

const ED_JO = '0000000a-0000-4000-8000-000000000001';
const ED_JM = '0000000a-0000-4000-8000-000000000002';
const ED_CM = '0000000a-0000-4000-8000-000000000003';
const PRUEBA = '0000000b-0000-4000-8000-000000000001';
const GUID = '0a1b2c3d-1111-4222-8333-444455556666';

const edicion = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  temporada: '2024',
  fuente: 'fie',
  ciudad: null,
  pais: null,
  inicio: '2024-07-27',
  fin: '2024-08-04',
  pruebas: 2,
  armas: 'ESPADA,FLORETE',
  formatos: 'EQUIPOS,INDIVIDUAL',
  ...extra,
});

const FILAS_SERIES = [
  edicion(ED_JO, 'Jeux Olympiques Paris 2024'),
  edicion(ED_JM, 'Juegos Mediterráneos Taranto 2026', { temporada: '2026', fuente: 'engarde' }),
  edicion(ED_CM, 'Campeonato del Mediterráneo La Nucía 2024', { fuente: 'engarde' }),
  edicion('0000000a-0000-4000-8000-000000000009', 'Copa del Mediterráneo'),
];

const respuestaPruebas = (extra: Record<string, unknown> = {}) => ({
  cuando: /c\.format AS formato/,
  filas: [
    {
      id: PRUEBA,
      edicionId: ED_JO,
      arma: 'ESPADA',
      genero: 'F',
      categoria: 'ABS',
      categoriaRaw: 'Senior',
      formato: 'INDIVIDUAL',
      fecha: '2024-07-28',
      fuente: 'fie',
      pruebaCalendarioId: null,
      importados: 3,
      ...extra,
    },
  ],
});

describe('leerSeries', () => {
  it('sin sesión no consulta nada', async () => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    await expect(leerSeries(ctx)).rejects.toThrow('NO_AUTENTICADO');
    expect(sentencias).toHaveLength(0);
  });

  it('con el esquema deportivo apagado dice «no disponible» sin consultar', async () => {
    const { ctx, sentencias } = crearContexto({ esquema: { identidad: false, referencias: false } });
    expect(await leerSeries(ctx)).toEqual({ estado: 'no_disponible' });
    expect(sentencias).toHaveLength(0);
  });

  it('devuelve las tres series reales y omite lo que no reconoce, sin inventar pruebas', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [{ cuando: /FROM sport_edition e\s+WHERE/, filas: FILAS_SERIES }],
    });
    const r = await leerSeries(ctx);
    if (r.estado !== 'ok') throw new Error('se esperaba ok');
    expect(r.series.map((s) => s.serie)).toEqual([
      'juegos_olimpicos',
      'juegos_mediterraneos',
      'campeonato_mediterraneo',
    ]);
    expect(r.series.map((s) => s.ediciones.map((e) => e.id))).toEqual([[ED_JO], [ED_JM], [ED_CM]]);
    expect(r.series.flatMap((s) => s.ediciones).map((e) => e.pruebas)).toEqual([2, 2, 2]);
    expect(sentencias).toHaveLength(1);
    expect(sentencias[0]?.text).toMatch(/LIKE '%olymp%'/);
    expect(sentencias[0]?.text).toMatch(/LIKE '%olimp%'/);
    expect(sentencias[0]?.text).toMatch(/LIKE '%mediterr%'/);
  });

  it('una serie sin ediciones importadas se devuelve vacía en lugar de desaparecer', async () => {
    const { ctx } = crearContexto({
      respuestas: [{ cuando: /FROM sport_edition e\s+WHERE/, filas: [FILAS_SERIES[0]] }],
    });
    const r = await leerSeries(ctx);
    if (r.estado !== 'ok') throw new Error('se esperaba ok');
    expect(r.series.map((s) => s.ediciones.length)).toEqual([1, 0, 0]);
  });
});

describe('cargarSeries', () => {
  it('distingue sin sesión, error de lectura y ok', async () => {
    expect(await cargarSeries(crearContexto({ perfil: null }).ctx)).toEqual({ tipo: 'sin_sesion' });
    const roto = crearContexto();
    roto.ctx.db = { execute: () => Promise.reject(new Error('boom')) } as never;
    expect(await cargarSeries(roto.ctx)).toEqual({ tipo: 'error' });
    expect((await cargarSeries(crearContexto().ctx)).tipo).toBe('ok');
  });
});

describe('leerEdicionesDeEvento', () => {
  it('sin sesión o con entrada inválida no consulta nada', async () => {
    const sinSesion = crearContexto({ perfil: null });
    await expect(leerEdicionesDeEvento(sinSesion.ctx, { eventoId: UUID_A })).rejects.toThrow('NO_AUTENTICADO');
    expect(sinSesion.sentencias).toHaveLength(0);

    const { ctx, sentencias } = crearContexto();
    for (const mala of [null, {}, { eventoId: 'x' }, { eventoId: UUID_A, extra: 1 }, 'x']) {
      expect(await leerEdicionesDeEvento(ctx, mala)).toEqual({ estado: 'entrada_invalida' });
    }
    expect(sentencias).toHaveLength(0);
  });

  it('un torneo sin edición vinculada devuelve lista vacía, y el estado de la lectura no la confunde con error', async () => {
    const { ctx, sentencias } = crearContexto();
    expect(await leerEdicionesDeEvento(ctx, { eventoId: UUID_A })).toEqual({ estado: 'ok', ediciones: [] });
    expect(sentencias).toHaveLength(1);
    expect(await cargarResultadosEvento(crearContexto({ perfil: null }).ctx, UUID_A)).toEqual({ tipo: 'sin_sesion' });
    expect(await cargarResultadosEvento(ctx, 'no-es-uuid')).toEqual({ tipo: 'entrada_invalida' });
  });

  it('une el torneo y su par absorbido y entrega pruebas con estado y enlaces comprobados', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [
        { cuando: /JOIN event ev ON ev\.id = e\.event_id/, filas: [edicion(ED_JO, 'Jeux Olympiques Paris 2024')] },
        respuestaPruebas(),
        {
          cuando: /FROM sport_import_coverage cov/,
          filas: [
            { pruebaId: PRUEBA, hecho: 'results', fuente: 'fie', estado: 'completo', cursor: null, url: null },
            {
              pruebaId: PRUEBA,
              hecho: 'link',
              fuente: 'enlace:ftl',
              estado: 'completo',
              cursor: 'solo_enlace',
              url: `https://www.fencingtimelive.com/events/results/${GUID}`,
            },
            {
              pruebaId: PRUEBA,
              hecho: 'link',
              fuente: 'enlace:engarde',
              estado: 'pendiente',
              cursor: 'no_publicado',
              url: 'https://www.engarde-service.com/competition/a/b/c',
            },
          ],
        },
      ],
    });
    const r = await leerEdicionesDeEvento(ctx, { eventoId: UUID_A });
    if (r.estado !== 'ok') throw new Error('se esperaba ok');
    expect(sentencias[0]?.text).toMatch(/ev\.canonical_event_id/);
    const prueba = r.ediciones[0]?.pruebasDetalle[0];
    expect(prueba?.resultados).toEqual({ estado: 'completo', importados: 3 });
    expect(prueba?.enlaces.map((e) => `${e.proveedor}:${e.tipo}`)).toEqual(['engarde:sin_enlace', 'ftl:solo_enlace']);
    expect(JSON.stringify(prueba)).not.toContain('engarde-service');
    expect(r.ediciones[0]?.serie).toBe('juegos_olimpicos');
  });
});

describe('cobertura de resultados por fuente', () => {
  const fila = (hecho: string, fuente: string, estado: string) => ({
    pruebaId: PRUEBA,
    hecho,
    fuente,
    estado,
    cursor: null,
    url: null,
  });

  async function estadoDe(importados: number, cobertura: ReturnType<typeof fila>[]) {
    const { ctx, sentencias } = crearContexto({
      respuestas: [
        { cuando: /JOIN event ev ON ev\.id = e\.event_id/, filas: [edicion(ED_JO, 'Jeux Olympiques Paris 2024')] },
        respuestaPruebas({ importados }),
        { cuando: /FROM sport_import_coverage cov/, filas: cobertura },
      ],
    });
    const r = await leerEdicionesDeEvento(ctx, { eventoId: UUID_A });
    if (r.estado !== 'ok') throw new Error('se esperaba ok');
    return { resultados: r.ediciones[0]?.pruebasDetalle[0]?.resultados, sentencias };
  }

  it('FIE guarda los puestos como «ranking»: una lectura completa de 34 puestos se muestra completa', async () => {
    const { resultados, sentencias } = await estadoDe(34, [fila('ranking', 'fie', 'completo')]);
    expect(resultados).toEqual({ estado: 'completo', importados: 34 });
    const consulta = sentencias.map((s) => s.text).join('\n');
    expect(consulta).toMatch(/cov\.fact_kind = 'ranking' AND cov\.source = \?/);
    expect(sentencias.some((s) => s.params.includes('fie'))).toBe(true);
    expect(consulta).not.toMatch(/'pools'|'tableau'/);
  });

  it('Skermo y el resto de fuentes siguen guardando «results»', async () => {
    expect((await estadoDe(12, [fila('results', 'skermo_rfee', 'completo')])).resultados).toEqual({
      estado: 'completo',
      importados: 12,
    });
  });

  it('el ranking de FIE refleja parcial, error, vacío y pendiente sin disfrazarlos', async () => {
    expect((await estadoDe(20, [fila('ranking', 'fie', 'parcial')])).resultados?.estado).toBe('parcial');
    expect((await estadoDe(0, [fila('ranking', 'fie', 'error')])).resultados?.estado).toBe('error');
    expect((await estadoDe(0, [fila('ranking', 'fie', 'sin_resultados')])).resultados?.estado).toBe('sin_resultados');
    expect((await estadoDe(0, [fila('ranking', 'fie', 'conflicto')])).resultados?.estado).toBe('conflicto');
    expect((await estadoDe(0, [])).resultados?.estado).toBe('pendiente');
  });

  it('poules, cuadro y rankings de otra fuente no dan por cerrada la clasificación final', async () => {
    const { resultados } = await estadoDe(34, [
      fila('pools', 'fie', 'completo'),
      fila('tableau', 'fie', 'completo'),
      fila('ranking', 'rfee', 'completo'),
    ]);
    expect(resultados).toEqual({ estado: 'parcial', importados: 34 });
  });

  it('el estado llega a la pantalla: la prueba FIE completa dice «Clasificación importada»', async () => {
    const { ctx } = crearContexto({
      respuestas: [
        { cuando: /JOIN event ev ON ev\.id = e\.event_id/, filas: [edicion(ED_JO, 'Jeux Olympiques Paris 2024')] },
        respuestaPruebas({ importados: 34 }),
        { cuando: /FROM sport_import_coverage cov/, filas: [fila('ranking', 'fie', 'completo')] },
      ],
    });
    const r = await leerEdicionesDeEvento(ctx, { eventoId: UUID_A });
    if (r.estado !== 'ok' || !r.ediciones[0]) throw new Error('se esperaba ok');
    const marcado = html(
      React.createElement(PruebasDeEdicion, {
        edicion: { ...r.ediciones[0], pruebaDesconocida: false, clasificacion: null },
        seleccionada: '',
      }),
    );
    expect(marcado).toContain('Clasificación importada');
    expect(marcado).not.toContain('Clasificación parcial');
  });
});

describe('leerEdicion', () => {
  it('guarda antes de validar y valida antes de consultar', async () => {
    const sinSesion = crearContexto({ perfil: null });
    await expect(leerEdicion(sinSesion.ctx, { edicionId: UUID_A })).rejects.toThrow('NO_AUTENTICADO');
    expect(sinSesion.sentencias).toHaveLength(0);

    const { ctx, sentencias } = crearContexto();
    for (const mala of [{}, { edicionId: 'x' }, { edicionId: UUID_A, prueba: 'x' }, { edicionId: UUID_A, personaId: UUID_B }]) {
      expect(await leerEdicion(ctx, mala)).toEqual({ estado: 'entrada_invalida' });
    }
    expect(await leerEdicion(ctx, { edicionId: UUID_A, cursor: 'basura' })).toEqual({ estado: 'cursor_invalido' });
    expect(sentencias).toHaveLength(0);
  });

  it('una edición que no existe es «no encontrada», no un error', async () => {
    const { ctx } = crearContexto();
    expect(await leerEdicion(ctx, { edicionId: UUID_A })).toEqual({ estado: 'no_encontrada' });
  });

  const respuestasEdicion = (filasPuestos: unknown[], otras = [{ fuente: 'fie', n: 3 }]) => [
    { cuando: /WHERE e\.id = /, filas: [edicion(ED_JO, 'Jeux Olympiques Paris 2024')] },
    respuestaPruebas(),
    { cuando: /GROUP BY r\.source/, filas: otras },
    { cuando: /FROM sport_result r\s+WHERE r\.competition_id/, filas: filasPuestos },
  ];

  const puesto = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `0000000c-0000-4000-8000-00000000000${n}`,
    puesto: n,
    puestoPublicado: null,
    nombre: `Deportista ${n}`,
    pais: 'ESP',
    club: null,
    personaId: null,
    ...extra,
  });

  it('la clasificación sólo lleva personaId cuando la fila está vinculada y no expone claves privadas', async () => {
    const { ctx } = crearContexto({
      respuestas: respuestasEdicion([puesto(1, { personaId: UUID_C }), puesto(2)]),
    });
    const r = await leerEdicion(ctx, { edicionId: ED_JO, prueba: PRUEBA });
    if (r.estado !== 'ok') throw new Error('se esperaba ok');
    const filasClasificacion = r.edicion.clasificacion?.filas ?? [];
    expect(filasClasificacion.map((f) => f.personaId)).toEqual([UUID_C, null]);
    expect(r.edicion.pruebaDesconocida).toBe(false);
    const claves = clavesDe(r);
    for (const privada of CLAVES_PRIVADAS) expect(claves.has(privada)).toBe(false);
  });

  it('pagina por posición con un cursor ligado a la edición y a la prueba', async () => {
    const filas = [puesto(1), puesto(2), puesto(3)];
    const { ctx, sentencias } = crearContexto({ respuestas: respuestasEdicion(filas) });
    const primera = await leerEdicion(ctx, { edicionId: ED_JO, prueba: PRUEBA, limite: 2 });
    if (primera.estado !== 'ok') throw new Error('se esperaba ok');
    const siguiente = primera.edicion.clasificacion?.siguiente;
    expect(primera.edicion.clasificacion?.filas).toHaveLength(2);
    expect(siguiente).toBeTruthy();

    const segunda = await leerEdicion(ctx, { edicionId: ED_JO, prueba: PRUEBA, cursor: siguiente ?? '', limite: 2 });
    expect(segunda.estado).toBe('ok');
    const ultima = sentencias.at(-1);
    expect(ultima?.text).toMatch(/> \(\?, \?, \?\)/);

    // Cambiar de prueba o de edición invalida el cursor.
    expect(await leerEdicion(ctx, { edicionId: ED_JO, cursor: siguiente })).toEqual({ estado: 'cursor_invalido' });
    expect(await leerEdicion(ctx, { edicionId: ED_JM, prueba: PRUEBA, cursor: siguiente })).toEqual({
      estado: 'cursor_invalido',
    });
  });

  it('una prueba ajena a la edición se avisa y no lee clasificación', async () => {
    const { ctx } = crearContexto({ respuestas: respuestasEdicion([puesto(1)]) });
    const r = await leerEdicion(ctx, { edicionId: ED_JO, prueba: '0000000b-0000-4000-8000-0000000000ff' });
    if (r.estado !== 'ok') throw new Error('se esperaba ok');
    expect(r.edicion.pruebaDesconocida).toBe(true);
    expect(r.edicion.clasificacion).toBeNull();
  });

  it('con varias fuentes no las mezcla: lee la de más puestos y avisa de las otras', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: respuestasEdicion([puesto(1)], [
        { fuente: 'fie', n: 8 },
        { fuente: 'engarde', n: 5 },
      ]),
    });
    const r = await leerEdicion(ctx, { edicionId: ED_JO, prueba: PRUEBA });
    if (r.estado !== 'ok') throw new Error('se esperaba ok');
    expect(r.edicion.clasificacion?.fuente).toBe('fie');
    expect(r.edicion.clasificacion?.otrasFuentes).toEqual([{ fuente: 'engarde', filas: 5 }]);
    expect(sentencias.at(-1)?.params).toContain('fie');
  });

  it('cargarEdicion traduce error y sin sesión a vistas distintas', async () => {
    expect(await cargarEdicion(crearContexto({ perfil: null }).ctx, ED_JO, { prueba: '', cursor: '' })).toEqual({
      tipo: 'sin_sesion',
    });
    const roto = crearContexto();
    roto.ctx.db = { execute: () => Promise.reject(new Error('boom')) } as never;
    expect(await cargarEdicion(roto.ctx, ED_JO, { prueba: '', cursor: '' })).toEqual({ tipo: 'error' });
  });
});

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);

const resumen = (id: string, nombre: string, serie: 'juegos_olimpicos' | 'juegos_mediterraneos' | 'campeonato_mediterraneo') => ({
  id,
  nombre,
  temporada: '2024',
  fuente: 'fie',
  ciudad: 'Paris',
  pais: 'FRA',
  inicio: '2024-07-27',
  fin: '2024-08-04',
  pruebas: 12,
  armas: ['ESPADA' as const],
  formatos: ['INDIVIDUAL' as const],
  serie,
});

const pruebaDto = (extra: Record<string, unknown> = {}) => ({
  id: PRUEBA,
  arma: 'ESPADA' as const,
  genero: 'F' as const,
  categoria: { codigo: 'ABS', raw: 'Senior' },
  formato: 'INDIVIDUAL' as const,
  fecha: '2024-07-28',
  fuente: 'fie',
  pruebaCalendarioId: null,
  resultados: { estado: 'completo' as const, importados: 2 },
  enlaces: [],
  ...extra,
});

describe('pantallas de ediciones', () => {
  it('las tres series son alcanzables y las vacías lo dicen sin inventar pruebas', () => {
    const marcado = html(
      React.createElement(ListaSeries, {
        series: [
          { serie: 'juegos_olimpicos', ediciones: [resumen(ED_JO, 'Jeux Olympiques Paris 2024', 'juegos_olimpicos')] },
          { serie: 'juegos_mediterraneos', ediciones: [] },
          {
            serie: 'campeonato_mediterraneo',
            ediciones: [resumen(ED_CM, 'Campeonato del Mediterráneo La Nucía 2024', 'campeonato_mediterraneo')],
          },
        ],
      }),
    );
    for (const titulo of ['Juegos Olímpicos', 'Juegos Mediterráneos', 'Campeonato del Mediterráneo']) {
      expect(marcado).toContain(titulo);
    }
    expect(marcado).toContain(`href="/explorar/ediciones/${ED_JO}"`);
    expect(marcado).toContain(`href="/explorar/ediciones/${ED_CM}"`);
    expect(marcado).toMatch(/Ninguna edición de esta serie está importada todavía/);
    expect(marcado).not.toContain('/perfil');
  });

  it('la entrada desde Explorar apunta al índice de ediciones', () => {
    expect(html(React.createElement(EnlaceEdiciones))).toContain('href="/explorar/ediciones"');
  });

  it('el estado de series distingue «no activas» de «error», que ofrece reintentar', () => {
    const noDisponible = html(React.createElement(EstadoSeries, { vista: { tipo: 'no_disponible' } }));
    expect(noDisponible).toMatch(/aún no están activas/);
    const error = html(React.createElement(EstadoSeries, { vista: { tipo: 'error' } }));
    expect(error).toMatch(/No se han podido leer/);
    expect(error).toContain('Reintentar');
  });

  it('cada prueba enlaza a su clasificación y a Explorar con edición, formato y categoría', () => {
    const edicionDetalle = {
      ...resumen(ED_JO, 'Jeux Olympiques Paris 2024', 'juegos_olimpicos'),
      pruebasDetalle: [pruebaDto(), pruebaDto({ id: UUID_B, resultados: { estado: 'pendiente', importados: 0 }, formato: 'EQUIPOS' })],
      pruebaDesconocida: false,
      clasificacion: null,
    };
    const marcado = html(React.createElement(PruebasDeEdicion, { edicion: edicionDetalle, seleccionada: '' }));
    expect(marcado).toContain(`href="${construirUrlEdicion(ED_JO, { prueba: PRUEBA })}"`.replace(/&/g, '&amp;'));
    expect(marcado).toContain('edicionId=' + ED_JO);
    expect(marcado).toContain('formato=INDIVIDUAL');
    expect(marcado).toContain('formato=EQUIPOS');
    expect(marcado).toContain('categoriaRaw=Senior');
    expect(marcado).toContain('Individuales');
    expect(marcado).toContain('Por equipos');
    // La prueba sin puestos importados no ofrece una clasificación vacía.
    expect(marcado.match(/>Ver la clasificación</g)).toHaveLength(1);
  });

  it('una edición sin pruebas dice que no se inventan', () => {
    const marcado = html(
      React.createElement(PruebasDeEdicion, {
        edicion: {
          ...resumen(ED_JM, 'Juegos Mediterráneos Taranto 2026', 'juegos_mediterraneos'),
          pruebasDetalle: [],
          pruebaDesconocida: false,
          clasificacion: null,
        },
        seleccionada: '',
      }),
    );
    expect(marcado).toMatch(/No se inventan pruebas/);
  });

  const clasificacion = (filas: unknown[], extra: Record<string, unknown> = {}) => ({
    pruebaId: PRUEBA,
    fuente: 'fie',
    siguiente: null,
    otrasFuentes: [],
    filas,
    ...extra,
  });

  it('la fila vinculada abre la ficha deportiva con retorno y no /perfil; la no vinculada no es un enlace', () => {
    const volver = construirUrlEdicion(ED_JO, { prueba: PRUEBA });
    const marcado = html(
      React.createElement(ClasificacionDePrueba, {
        edicion: resumen(ED_JO, 'Jeux Olympiques Paris 2024', 'juegos_olimpicos'),
        prueba: pruebaDto(),
        criterios: { prueba: PRUEBA, cursor: '' },
        clasificacion: clasificacion([
          { id: 'r1', puesto: 1, puestoPublicado: null, nombre: 'Ana Vinculada', pais: 'ESP', club: null, personaId: UUID_C },
          { id: 'r2', puesto: 2, puestoPublicado: null, nombre: 'Bea Suelta', pais: 'ESP', club: null, personaId: null },
        ]) as never,
      }),
    );
    expect(marcado).toContain(`href="/explorar/${UUID_C}?volver=${encodeURIComponent(volver).replace(/&/g, '&amp;')}"`);
    expect(marcado).not.toContain('/perfil');
    expect(marcado.match(/<a /g)).toHaveLength(1);
    expect(marcado).toContain('Sin ficha deportiva vinculada');
    expect(marcado).toContain('<span class="sr-only">Puesto </span>');
    expect(marcado).not.toContain('aria-label="Puesto');
  });

  it('la página siguiente conserva edición y prueba, y la última dice que no hay más', () => {
    const marcado = html(
      React.createElement(ClasificacionDePrueba, {
        edicion: resumen(ED_JO, 'Jeux Olympiques Paris 2024', 'juegos_olimpicos'),
        prueba: pruebaDto(),
        criterios: { prueba: PRUEBA, cursor: 'c0' },
        clasificacion: clasificacion(
          [{ id: 'r1', puesto: 1, puestoPublicado: null, nombre: 'Ana', pais: null, club: null, personaId: null }],
          { siguiente: 'c2' },
        ) as never,
      }),
    );
    expect(marcado).toContain(`prueba=${PRUEBA}&amp;cursor=c2`);
    expect(marcado).toContain('Volver al principio');
  });

  it('EdicionCompleta enseña la serie y avisa de una prueba que no es de la edición', () => {
    const marcado = html(
      React.createElement(EdicionCompleta, {
        edicion: {
          ...resumen(ED_JM, 'Juegos Mediterráneos Taranto 2026', 'juegos_mediterraneos'),
          pruebasDetalle: [pruebaDto()],
          pruebaDesconocida: true,
          clasificacion: null,
        },
        criterios: { prueba: '', cursor: '' },
      }),
    );
    expect(marcado).toContain('Juegos Mediterráneos');
    expect(marcado).toMatch(/no pertenece a esta edición/);
    expect(marcado).toContain('Volver a las ediciones');
  });

  it('cada estado de error de edición tiene su propio mensaje', () => {
    const textos = (['no_encontrada', 'entrada_invalida', 'cursor_invalido', 'no_disponible', 'error'] as const).map((tipo) =>
      html(React.createElement(EstadoEdicion, { vista: { tipo } })),
    );
    expect(new Set(textos).size).toBe(5);
    expect(textos[4]).toMatch(/no es que no haya resultados/);
  });
});

describe('estados de resultados y enlaces en pantalla', () => {
  it('«completo» sólo se dice con el estado completo y el resto no usa esas palabras', () => {
    const estados = ['parcial', 'sin_resultados', 'pendiente', 'error', 'conflicto'] as const;
    for (const estado of estados) {
      expect(html(React.createElement(EstadoResultadosPrueba, { estado, importados: 0 }))).not.toContain(
        'Clasificación importada',
      );
    }
    expect(html(React.createElement(EstadoResultadosPrueba, { estado: 'completo', importados: 2 }))).toContain(
      'Clasificación importada',
    );
  });

  it('Fencing Time Live sólo enlaza el torneo, exige cuenta y dice que no hay resultados importados', () => {
    const url = `https://www.fencingtimelive.com/events/results/${GUID}`;
    const marcado = html(
      React.createElement(EnlacesResultados, { enlaces: [{ proveedor: 'ftl', tipo: 'solo_enlace', url }] }),
    );
    expect(marcado).toContain('Seguir el torneo en Fencing Time Live');
    expect(marcado).not.toContain('Resultados en Fencing Time Live');
    expect(marcado).toMatch(/exige cuenta/);
    expect(marcado).toMatch(/resultados no están importados/);
    expect(marcado).toContain('rel="noopener noreferrer"');
  });

  it('no publicado, en revisión y error no pintan enlace y lo explican', () => {
    const marcado = html(
      React.createElement(EnlacesResultados, {
        enlaces: [
          { proveedor: 'engarde', tipo: 'sin_enlace', motivo: 'no_publicado' },
          { proveedor: 'fww', tipo: 'sin_enlace', motivo: 'en_revision' },
          { proveedor: 'ftl', tipo: 'sin_enlace', motivo: 'error' },
        ],
      }),
    );
    expect(marcado).not.toContain('<a ');
    expect(marcado).toContain('sin enlace publicado');
    expect(marcado).toContain('en revisión');
    expect(marcado).toContain('no se pudo comprobar');
  });

  it('sin enlaces dice que no es lo mismo que sin resultados', () => {
    expect(html(React.createElement(EnlacesResultados, { enlaces: [] }))).toMatch(/No significa que la prueba no tenga resultados/);
  });
});
