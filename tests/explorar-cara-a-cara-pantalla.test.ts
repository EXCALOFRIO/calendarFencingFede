import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  cargarCaraACaraPantalla,
  type DatosCaraACara,
  type RivalesVista,
  type VistaCaraACara,
} from '@/lib/sport/explorar/cara-a-cara-pantalla';
import {
  CRITERIOS_CARA_A_CARA_VACIOS,
  aEntradaCaraACara,
  aEntradaRivales,
  chipsCaraACara,
  construirUrlCaraACara,
  leerCriteriosCaraACara,
  urlElegirRival,
  urlVistaDelRival,
  type CriteriosCaraACara,
} from '@/lib/sport/explorar/cara-a-cara-url';
import type { EncuentroCaraACara } from '@/lib/sport/explorar/cara-a-cara';
import { opcionesTemporada } from '@/lib/sport/explorar/url';
import { CLAVES_PRIVADAS, UUID_A, UUID_B, UUID_C, clavesDe, crearContexto } from './helpers/explorar';

const {
  CabeceraCaraACara,
  CaraACaraCompleto,
  ElegirRival,
  EstadoCaraACara,
  rotuloMarcador,
} = await import('@/components/explorar/cara-a-cara');
const { EntradaCaraACara, FichaCompleta } = await import('@/components/explorar/ficha-deportiva');

/**
 * Pantalla del cara a cara: contexto controlado (SQL registrado y filas
 * fijadas) y render estático. No hay PostgreSQL, sesión Neon Auth ni
 * navegador autenticado: el SQL no se ejecuta, se comprueba su forma.
 */

const criterios = (extra: Partial<CriteriosCaraACara> = {}): CriteriosCaraACara => ({
  ...CRITERIOS_CARA_A_CARA_VACIOS,
  rival: UUID_B,
  ...extra,
});

const sinFusiones = [
  { cuando: /WITH RECURSIVE cadena/, filas: (s: { params: unknown[] }) => [{ id: s.params[0] }] },
  { cuando: /WITH RECURSIVE grupo/, filas: (s: { params: unknown[] }) => [{ id: s.params[0] }] },
];

const cabeceras = {
  cuando: /display_name AS nombre, country_code AS pais/,
  filas: [
    { id: UUID_A, nombre: 'Lucia Garcia', pais: 'ESP', genero: 'F', anioNacimiento: 2008 },
    { id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA', genero: 'F', anioNacimiento: 2007 },
    { id: UUID_C, nombre: 'Nora Diaz', pais: 'ITA', genero: 'F', anioNacimiento: 2006 },
  ],
};

const asalto = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  mios: 5,
  rival: 3,
  torneoId: 'e1',
  torneo: 'GRAND PRIX DE PARIS',
  pruebaId: 'c1',
  arma: 'ESPADA',
  genero: 'F',
  categoria: 'ABS',
  categoriaRaw: 'Senior',
  formato: 'INDIVIDUAL',
  temporada: '2026',
  fecha: '2026-03-02',
  fechaOrden: '2026-03-02',
  fase: 'TABLEAU',
  ronda: 'A32',
  enlace: 'https://fie.example.test/bout/1',
  ...extra,
});

const comun = (extra: Record<string, unknown> = {}) => ({
  id: 'c1',
  fuente: 'fie',
  torneo: 'GRAND PRIX DE PARIS',
  arma: 'ESPADA',
  genero: 'F',
  categoria: 'ABS',
  categoriaRaw: 'Senior',
  temporada: '2026',
  asaltos: 1,
  lecturas: 'pools:ok,tableau:ok',
  ...extra,
});

function respuestasH2h(opciones: {
  resumen?: Record<string, number>;
  asaltos?: unknown[];
  comunes?: unknown[];
}) {
  return [
    ...sinFusiones,
    cabeceras,
    {
      cuando: /count\(\*\) FILTER/,
      filas: [
        opciones.resumen ?? { asaltos: 0, victorias: 0, derrotas: 0, sinDecidir: 0, tantosFavor: 0, tantosContra: 0 },
      ],
    },
    { cuando: /ORDER BY coalesce\(b\.occurred_on/, filas: opciones.asaltos ?? [] },
    { cuando: /WITH comunes/, filas: opciones.comunes ?? [] },
  ];
}

async function datosDe(vista: Promise<VistaCaraACara>): Promise<DatosCaraACara> {
  const v = await vista;
  if (v.tipo !== 'ok') throw new Error(v.tipo);
  return v.datos;
}

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('URL del cara a cara', () => {
  it('lee y reconstruye persona, rival y filtros sin perder la temporada de cada fuente', () => {
    for (const temporada of ['2027', '2026-2027']) {
      const leidos = leerCriteriosCaraACara({
        rival: UUID_B.toUpperCase(),
        temporada,
        arma: 'espada',
        fase: 'tableau',
      });
      expect(leidos).toMatchObject({ rival: UUID_B, temporada, arma: 'ESPADA', fase: 'TABLEAU' });
      const url = construirUrlCaraACara(UUID_A, leidos);
      expect(url).toBe(
        `/explorar/${UUID_A}/cara-a-cara?rival=${UUID_B}&temporada=${temporada}&arma=ESPADA&fase=TABLEAU`,
      );
      const { searchParams } = new URL(url, 'https://x.test');
      expect(leerCriteriosCaraACara(Object.fromEntries(searchParams))).toEqual(leidos);
    }
  });

  it('cambiar rival o filtro nunca arrastra el cursor; con rival la búsqueda por nombre no aplica', () => {
    const base = criterios({ cursor: 'abc', temporada: '2026', q: 'ruiz' });
    expect(construirUrlCaraACara(UUID_A, { ...base, cursor: '' })).not.toContain('cursor');
    expect(construirUrlCaraACara(UUID_A, base)).not.toContain('q=');
    expect(construirUrlCaraACara(UUID_A, { q: 'ruiz', temporada: '2026' })).toContain('q=ruiz');
    for (const chip of chipsCaraACara(UUID_A, base)) expect(chip.quitar).not.toContain('cursor');
  });

  it('ver desde el rival intercambia personas y conserva filtros, sin cursor', () => {
    const url = urlVistaDelRival(UUID_A, UUID_B, criterios({ temporada: '2027', cursor: 'abc' }));
    expect(url).toBe(`/explorar/${UUID_B}/cara-a-cara?rival=${UUID_A}&temporada=2027`);
  });

  it('las entradas a las lecturas sólo llevan lo rellenado', () => {
    expect(aEntradaCaraACara(UUID_A, criterios())).toEqual({ personaId: UUID_A, rivalId: UUID_B });
    expect(aEntradaCaraACara(UUID_A, criterios({ temporada: '2027', fase: 'POULE', cursor: 'c' }))).toEqual({
      personaId: UUID_A,
      rivalId: UUID_B,
      temporada: '2027',
      fase: 'POULE',
      cursor: 'c',
    });
    expect(aEntradaRivales(UUID_A, { ...CRITERIOS_CARA_A_CARA_VACIOS, q: 'ru' })).toEqual({ personaId: UUID_A, q: 'ru' });
    // La elección de rival sólo busca por nombre: la temporada de un enlace antiguo se ignora.
    expect(aEntradaRivales(UUID_A, { ...CRITERIOS_CARA_A_CARA_VACIOS, temporada: '2027', arma: 'ESPADA', q: 'ru' })).toEqual({
      personaId: UUID_A,
      q: 'ru',
    });
  });

  it('las temporadas ofrecidas se conservan tal y como se guardan', () => {
    const claves = opcionesTemporada('2026-10-02').map((t) => t.valor);
    expect(claves).toContain('2027');
    expect(claves).toContain('2026-2027');
  });
});

describe('cargarCaraACaraPantalla: cara a cara', () => {
  it('sin sesión o con acceso revocado no consulta nada', async () => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    expect(await cargarCaraACaraPantalla(ctx, UUID_A, criterios())).toEqual({ tipo: 'sin_sesion' });
    expect(await cargarCaraACaraPantalla(ctx, UUID_A, CRITERIOS_CARA_A_CARA_VACIOS)).toEqual({ tipo: 'sin_sesion' });
    expect(sentencias).toHaveLength(0);
  });

  it('un identificador que no es persona se rechaza antes de consultar', async () => {
    const { ctx, sentencias } = crearContexto();
    expect(await cargarCaraACaraPantalla(ctx, 'x', criterios())).toEqual({ tipo: 'entrada_invalida' });
    expect(await cargarCaraACaraPantalla(ctx, UUID_A, criterios({ rival: 'no-es-uuid' }))).toEqual({
      tipo: 'entrada_invalida',
    });
    expect(await cargarCaraACaraPantalla(ctx, UUID_A, criterios({ temporada: '2026/27' }))).toEqual({
      tipo: 'entrada_invalida',
    });
    expect(sentencias).toHaveLength(0);
  });

  it('la misma persona y la persona inexistente tienen su estado, distinto de «sin asaltos»', async () => {
    const igual = crearContexto({
      respuestas: [
        { cuando: /WITH RECURSIVE cadena/, filas: [{ id: UUID_A }] },
        { cuando: /WITH RECURSIVE grupo/, filas: [{ id: UUID_A }, { id: UUID_B }] },
      ],
    });
    expect(await cargarCaraACaraPantalla(igual.ctx, UUID_A, criterios())).toEqual({ tipo: 'misma_persona' });
    const nadie = crearContexto({ respuestas: [{ cuando: /WITH RECURSIVE cadena/, filas: [] }] });
    expect(await cargarCaraACaraPantalla(nadie.ctx, UUID_A, criterios())).toEqual({ tipo: 'no_encontrada' });
  });

  it('un fallo de consulta es error, no una lista vacía', async () => {
    const { ctx } = crearContexto();
    const roto = { ...ctx, db: { execute: () => Promise.reject(new Error('boom')) } } as never;
    expect(await cargarCaraACaraPantalla(roto, UUID_A, criterios())).toEqual({ tipo: 'error' });
  });

  it('sólo cuenta individuales con marcador: las consultas (también la de los gráficos) excluyen equipos', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: respuestasH2h({
        resumen: { asaltos: 1, victorias: 1, derrotas: 0, sinDecidir: 0, tantosFavor: 5, tantosContra: 3 },
        asaltos: [asalto('b1')],
        comunes: [comun()],
      }),
    });
    await datosDe(cargarCaraACaraPantalla(ctx, UUID_A, criterios()));
    const lecturas = sentencias.filter((s) => /sport_bout|WITH comunes/.test(s.text) && !/RECURSIVE/.test(s.text));
    // Resumen, asaltos y pruebas comunes, más la lectura de los gráficos del duelo.
    expect(lecturas).toHaveLength(4);
    for (const s of lecturas) {
      expect(s.text).toMatch(/c\.format = 'INDIVIDUAL'/);
      expect(s.text).not.toMatch(/internal_ranking|ranking_snapshot|user_profile|email/i);
    }
  });

  it('con un filtro activo no se piden los gráficos, que cubren toda la historia', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: respuestasH2h({ comunes: [comun()] }) });
    const vista = await cargarCaraACaraPantalla(ctx, UUID_A, criterios({ fase: 'POULE' }));
    expect(vista).toMatchObject({ tipo: 'ok', rendimiento: null });
    const lecturas = sentencias.filter((s) => /sport_bout|WITH comunes/.test(s.text) && !/RECURSIVE/.test(s.text));
    expect(lecturas).toHaveLength(3);
  });

  it('un asalto de poule guardado una vez se orienta a quien se consulta: el mismo duelo se invierte desde el rival', async () => {
    // Una sola fila en sport_bout; el SQL la devuelve con el marcador del consultado primero.
    const desdeA = await datosDe(
      cargarCaraACaraPantalla(
        crearContexto({
          respuestas: respuestasH2h({
            resumen: { asaltos: 1, victorias: 1, derrotas: 0, sinDecidir: 0, tantosFavor: 5, tantosContra: 3 },
            asaltos: [asalto('poule-1', { fase: 'POULE', ronda: 'P2', mios: 5, rival: 3 })],
            comunes: [comun()],
          }),
        }).ctx,
        UUID_A,
        criterios(),
      ),
    );
    const desdeB = await datosDe(
      cargarCaraACaraPantalla(
        crearContexto({
          respuestas: respuestasH2h({
            resumen: { asaltos: 1, victorias: 0, derrotas: 1, sinDecidir: 0, tantosFavor: 3, tantosContra: 5 },
            asaltos: [asalto('poule-1', { fase: 'POULE', ronda: 'P2', mios: 3, rival: 5 })],
            comunes: [comun()],
          }),
        }).ctx,
        UUID_B,
        criterios({ rival: UUID_A }),
      ),
    );

    expect(desdeA.items).toHaveLength(1);
    expect(desdeA.items[0]).toMatchObject({ id: 'poule-1', resultado: 'victoria', marcador: { mios: 5, rival: 3 } });
    expect(desdeB.items[0]).toMatchObject({ id: 'poule-1', resultado: 'derrota', marcador: { mios: 3, rival: 5 } });
    // Un duelo, no dos: ni el balance ni el listado lo duplican.
    expect(desdeA.resumen.asaltos).toBe(1);
    expect(desdeB.resumen.asaltos).toBe(1);
    expect(desdeA.items).toHaveLength(desdeB.items.length);

    const a = html(React.createElement(CabeceraCaraACara, { datos: desdeA, criterios: criterios() }));
    const b = html(React.createElement(CabeceraCaraACara, { datos: desdeB, criterios: criterios({ rival: UUID_A }) }));
    expect(a).toContain('aria-label="1 victoria y 0 derrotas de Lucia Garcia"');
    expect(b).toContain('aria-label="0 victorias y 1 derrota de Marta Ruiz"');
    expect(a).toContain('del más reciente: victoria"');
    expect(b).toContain('del más reciente: derrota"');
  });

  it('la temporada y el rival de la URL viajan a la consulta', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: respuestasH2h({
        resumen: { asaltos: 1, victorias: 1, derrotas: 0, sinDecidir: 0, tantosFavor: 5, tantosContra: 3 },
        asaltos: [asalto('b1')],
        comunes: [comun()],
      }),
    });
    const datos = await datosDe(cargarCaraACaraPantalla(ctx, UUID_A, criterios({ temporada: '2026' })));
    expect(datos.siguiente).toBeNull();
    const resumen = sentencias.find((s) => /count\(\*\) FILTER/.test(s.text))!;
    expect(resumen.params).toContain('2026');
    expect(resumen.text).toContain('json_each');
    expect(resumen.params).toContain(JSON.stringify([UUID_B]));
  });

  it('el cursor emitido en una consulta se rechaza en otra temporada o con otro rival', async () => {
    const filas = Array.from({ length: 30 }, (_, i) =>
      asalto(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, { fechaOrden: '2026-03-02' }),
    );
    const { ctx } = crearContexto({
      respuestas: respuestasH2h({
        resumen: { asaltos: 30, victorias: 30, derrotas: 0, sinDecidir: 0, tantosFavor: 150, tantosContra: 90 },
        asaltos: filas,
        comunes: [comun({ asaltos: 30 })],
      }),
    });
    const primera = await datosDe(cargarCaraACaraPantalla(ctx, UUID_A, criterios({ temporada: '2026' })));
    expect(primera.siguiente).toBeTruthy();
    const cursor = primera.siguiente!;

    expect(await cargarCaraACaraPantalla(ctx, UUID_A, criterios({ temporada: '2026', cursor }))).toMatchObject({ tipo: 'ok' });
    for (const otra of [
      criterios({ temporada: '2025', cursor }),
      criterios({ temporada: '2026', rival: UUID_C, cursor }),
      criterios({ temporada: '2026', fase: 'POULE', cursor }),
    ]) {
      expect(await cargarCaraACaraPantalla(ctx, UUID_A, otra)).toEqual({ tipo: 'cursor_invalido' });
    }
    expect(await cargarCaraACaraPantalla(ctx, UUID_B, criterios({ rival: UUID_A, temporada: '2026', cursor }))).toEqual({
      tipo: 'cursor_invalido',
    });
  });

  it('dos rivales y dos temporadas: cada intersección lee sólo la suya y no expone datos privados', async () => {
    const lectura = async (rival: string, temporada: string) => {
      const { ctx, sentencias } = crearContexto({ respuestas: respuestasH2h({}) });
      const datos = await datosDe(cargarCaraACaraPantalla(ctx, UUID_A, criterios({ rival, temporada })));
      for (const k of clavesDe(datos)) expect(CLAVES_PRIVADAS).not.toContain(k);
      return sentencias.find((s) => /count\(\*\) FILTER/.test(s.text))!.params;
    };
    const [bPasada, cActual] = [await lectura(UUID_B, '2025'), await lectura(UUID_C, '2026')];
    expect(bPasada).toContain(JSON.stringify([UUID_B]));
    expect(bPasada).toContain('2025');
    expect(bPasada).not.toContain(JSON.stringify([UUID_C]));
    expect(cActual).toContain(JSON.stringify([UUID_C]));
    expect(cActual).toContain('2026');
    expect(cActual).not.toContain(JSON.stringify([UUID_B]));
    expect(cActual).not.toContain('2025');
  });
});

describe('cargarCaraACaraPantalla: elegir rival', () => {
  const rivalesFila = [
    { id: UUID_B, clave: 'marta ruiz', nombre: 'Marta Ruiz', pais: 'FRA', asaltos: 3, victorias: 2, derrotas: 1 },
    { id: UUID_C, clave: 'nora diaz', nombre: 'Nora Diaz', pais: 'ITA', asaltos: 1 },
  ];
  const respuestasElegir = (extra: { cuando: RegExp; filas: unknown[] }[] = []) => [
    ...sinFusiones,
    cabeceras,
    ...extra,
    { cuando: /FROM sport_bout b/, filas: rivalesFila },
  ];

  it('lista los rivales con asaltos y cabecera de la persona, sin ofrecer el cara a cara de nadie sin rival', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: respuestasElegir() });
    // Un enlace antiguo con temporada sigue abriendo la lista, entera.
    const v = await cargarCaraACaraPantalla(ctx, UUID_A, { ...CRITERIOS_CARA_A_CARA_VACIOS, temporada: '2026-2027' });
    if (v.tipo !== 'elegir') throw new Error(v.tipo);
    expect(sentencias.some((s) => s.params.includes('2026-2027'))).toBe(false);
    expect(v.persona).toEqual({ id: UUID_A, nombre: 'Lucia Garcia', pais: 'ESP' });
    expect(v.rivales).toMatchObject({ tipo: 'ok', sinResultados: false });
    expect(v.rivales.tipo === 'ok' && v.rivales.items.map((r) => r.id)).toEqual([UUID_B, UUID_C]);
    expect(v.otros).toBeNull();
  });

  it('con nombre busca también a otras personas indexadas, y sólo en la primera página', async () => {
    const busqueda = {
      cuando: /name_normalized/,
      filas: [],
    };
    const { ctx, sentencias } = crearContexto({ respuestas: respuestasElegir([busqueda]) });
    const v = await cargarCaraACaraPantalla(ctx, UUID_A, { ...CRITERIOS_CARA_A_CARA_VACIOS, q: 'ruiz' });
    if (v.tipo !== 'elegir') throw new Error(v.tipo);
    expect(v.otros).toEqual({ tipo: 'ok', items: [] });
    expect(sentencias.some((s) => s.params.includes('ruiz%'))).toBe(true);

    const sinOtros = crearContexto({ respuestas: respuestasElegir() });
    const pagina = await cargarCaraACaraPantalla(sinOtros.ctx, UUID_A, {
      ...CRITERIOS_CARA_A_CARA_VACIOS,
      q: 'ruiz',
      cursor: 'zz',
    });
    expect(pagina).toMatchObject({ tipo: 'elegir', otros: null, rivales: { tipo: 'cursor_invalido' } });
  });

  it('si la lista de rivales falla, la pantalla lo dice y no la muestra vacía', async () => {
    const { ctx } = crearContexto({ respuestas: respuestasElegir() });
    const original = ctx.db.execute.bind(ctx.db);
    const parcial = {
      ...ctx,
      db: {
        execute: ((c: never) => {
          const texto = JSON.stringify(c);
          return /cp\.name_normalized/.test(texto) ? Promise.reject(new Error('boom')) : original(c);
        }) as never,
      },
    };
    const v = await cargarCaraACaraPantalla(parcial, UUID_A, CRITERIOS_CARA_A_CARA_VACIOS);
    if (v.tipo !== 'elegir') throw new Error(v.tipo);
    expect(v.rivales).toEqual({ tipo: 'error' });
    const marcado = html(
      React.createElement(ElegirRival, {
        persona: v.persona,
        rivales: v.rivales,
        otros: v.otros,
        criterios: CRITERIOS_CARA_A_CARA_VACIOS,
      }),
    );
    expect(marcado).toContain('role="alert"');
    expect(marcado).toContain('no es que no haya rivales');
  });

  it('los rivales enlazan al cara a cara por ID sin filtros (una temporada antigua se ignora) y paginan con cursor', () => {
    const marcado = html(
      React.createElement(ElegirRival, {
        persona: { id: UUID_A, nombre: 'Lucia Garcia', pais: 'ESP' },
        rivales: {
          tipo: 'ok',
          items: [{ id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA', asaltos: 3, victorias: 2, derrotas: 1 }],
          siguiente: 'sig',
          sinResultados: false,
        },
        otros: {
          tipo: 'ok',
          items: [
            {
              id: UUID_C,
              nombre: 'Nora Diaz',
              alias: null,
              pais: 'ITA',
              genero: 'F',
              anioNacimiento: 2006,
              resultadosImportados: 0,
              armas: [],
              mismoNombre: 2,
            },
            {
              id: UUID_A,
              nombre: 'Lucia Garcia',
              alias: null,
              pais: 'ESP',
              genero: 'F',
              anioNacimiento: 2008,
              resultadosImportados: 0,
              armas: [],
              mismoNombre: 1,
            },
          ],
        },
        criterios: { ...CRITERIOS_CARA_A_CARA_VACIOS, temporada: '2027', q: 'ruiz' },
      }),
    );
    expect(marcado).toContain(`href="/explorar/${UUID_A}/cara-a-cara?rival=${UUID_B}"`);
    expect(marcado).toContain(`href="/explorar/${UUID_A}/cara-a-cara?rival=${UUID_C}"`);
    expect(marcado).not.toContain('temporada=');
    expect(marcado).toContain('2 personas con este nombre');
    // La propia persona no se ofrece como su rival.
    expect(marcado).not.toContain(`rival=${UUID_A}`);
    expect(marcado).toContain('cursor=sig');
    expect(marcado).toContain('>Otras personas<');
    // Sin párrafos explicativos (UI.md §2 bis): título corto y la lista.
    expect(marcado).not.toMatch(/Personas con las que|Son personas indexadas|al abrirlo|de más a menos asaltos\./);
    expect(marcado).toContain('aria-label="Rivales, de más a menos asaltos"');
    expect(marcado).not.toContain('Aún no tienen asaltos confirmados');
  });

  it('sin rivales no afirma que nunca compitiera y propone buscar por nombre', () => {
    const marcado = html(
      React.createElement(ElegirRival, {
        persona: { id: UUID_A, nombre: 'Lucia Garcia', pais: 'ESP' },
        rivales: { tipo: 'ok', items: [], siguiente: null, sinResultados: true },
        otros: null,
        criterios: CRITERIOS_CARA_A_CARA_VACIOS,
      }),
    );
    expect(marcado).toContain('role="status"');
    expect(marcado).toContain('Sin rivales con asaltos.');
    expect(marcado).not.toMatch(/nunca|Nadie|Puede faltar/i);
  });
});

describe('elegir rival: sólo por nombre', () => {
  const todos = { temporada: '2027', arma: 'ESPADA', fase: 'POULE' } as const;
  const persona = { id: UUID_A, nombre: 'Lucia Garcia', pais: 'ESP' };
  const coincidente = {
    id: UUID_C,
    nombre: 'Nora Diaz',
    alias: null,
    pais: 'ITA',
    genero: 'F' as const,
    anioNacimiento: 2006,
    resultadosImportados: 0,
    armas: [],
    mismoNombre: 1,
  };

  it('urlElegirRival fija sólo el rival', () => {
    expect(urlElegirRival(UUID_A, UUID_B)).toBe(
      `/explorar/${UUID_A}/cara-a-cara?rival=${UUID_B}`,
    );
  });

  it('con filtros de un enlace antiguo, los enlaces de las dos listas abren el duelo sin ellos', () => {
    const marcado = html(
      React.createElement(ElegirRival, {
        persona,
        rivales: {
          tipo: 'ok',
          items: [{ id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA', asaltos: 3, victorias: 2, derrotas: 1 }],
          siguiente: null,
          sinResultados: false,
        },
        otros: { tipo: 'ok', items: [coincidente] },
        criterios: { ...CRITERIOS_CARA_A_CARA_VACIOS, ...todos, q: 'diaz' },
      }),
    );
    expect(marcado).toContain(`href="/explorar/${UUID_A}/cara-a-cara?rival=${UUID_B}"`);
    expect(marcado).toContain(`href="/explorar/${UUID_A}/cara-a-cara?rival=${UUID_C}"`);
    expect(marcado).not.toMatch(/arma=|fase=|temporada=/);
  });

  it('Cambiar de rival abre la elección sin filtros', () => {
    const datos = {
      personas: { yo: persona, rival: { id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA' } },
    } as unknown as DatosCaraACara;
    const cabecera = html(
      React.createElement(CabeceraCaraACara, { datos, criterios: criterios({ ...todos, cursor: 'zz' }) }),
    );
    expect(cabecera).toContain(`href="/explorar/${UUID_A}/cara-a-cara"`);
    expect(urlElegirRival(UUID_A, UUID_C)).toBe(`/explorar/${UUID_A}/cara-a-cara?rival=${UUID_C}`);
  });

  it('con la lista de rivales caída y la búsqueda correcta, no afirma que falten asaltos', async () => {
    const { ctx } = crearContexto({
      respuestas: [
        ...sinFusiones,
        cabeceras,
        {
          cuando: /FROM sport_person p\s+WHERE/,
          filas: [
            { id: UUID_C, nombre: 'Nora Diaz', claveNombre: 'nora diaz', alias: null, pais: 'ITA', genero: 'F', anioNacimiento: 2006 },
          ],
        },
      ],
    });
    const original = ctx.db.execute.bind(ctx.db);
    const parcial = {
      ...ctx,
      db: {
        execute: ((c: never) =>
          /sport_bout/.test(JSON.stringify(c)) ? Promise.reject(new Error('boom')) : original(c)) as never,
      },
    };
    const entrada = { ...CRITERIOS_CARA_A_CARA_VACIOS, ...todos, q: 'diaz' };
    const v = await cargarCaraACaraPantalla(parcial, UUID_A, entrada);
    if (v.tipo !== 'elegir') throw new Error(v.tipo);
    expect(v.rivales).toEqual({ tipo: 'error' });
    if (v.otros?.tipo !== 'ok') throw new Error('la búsqueda debía ir bien');
    expect(v.otros.items.map((d) => d.id)).toEqual([UUID_C]);

    const marcado = html(
      React.createElement(ElegirRival, { persona: v.persona, rivales: v.rivales, otros: v.otros, criterios: entrada }),
    );
    expect(marcado).toContain('Ha fallado la consulta; no es que no haya rivales');
    expect(marcado).toContain('Nora Diaz');
    expect(marcado).toContain('>Otras personas<');
    expect(marcado).not.toContain('Aún no tienen asaltos confirmados');
    expect(marcado).not.toMatch(/sin asaltos|no tienen asaltos/i);
    expect(marcado).toContain(`cara-a-cara?rival=${UUID_C}"`);
  });

  it('cualquier lista de rivales no leída (no sólo error) usa el texto neutro', () => {
    for (const rivales of [
      { tipo: 'no_disponible' },
      { tipo: 'entrada_invalida' },
      { tipo: 'cursor_invalido' },
    ] as const) {
      const marcado = html(
        React.createElement(ElegirRival, {
          persona,
          rivales,
          otros: { tipo: 'ok', items: [coincidente] },
          criterios: CRITERIOS_CARA_A_CARA_VACIOS,
        }),
      );
      expect(marcado).toContain('>Otras personas<');
      expect(marcado).not.toContain('Aún no tienen asaltos confirmados');
    }
  });

  it('con la lista leída tampoco promete ausencia de asaltos: la búsqueda suplementaria usa siempre el texto neutro', () => {
    const listas: RivalesVista[] = [
      { tipo: 'ok', items: [], siguiente: null, sinResultados: true },
      { tipo: 'ok', items: [{ id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA', asaltos: 3, victorias: 2, derrotas: 1 }], siguiente: 'sig', sinResultados: false },
    ];
    for (const rivales of listas) {
      const marcado = html(
        React.createElement(ElegirRival, {
          persona,
          rivales,
          otros: { tipo: 'ok', items: [coincidente] },
          criterios: CRITERIOS_CARA_A_CARA_VACIOS,
        }),
      );
      expect(marcado).toContain('>Otras personas<');
      expect(marcado).not.toContain('personas indexadas');
      expect(marcado).not.toMatch(/Aún no tienen|no tienen asaltos|sin asaltos/i);
    }
  });

  it('un rival con duelos hallado sólo por alias no se presenta como persona sin asaltos', async () => {
    // listarRivales (por nombre canónico) lo omite; buscarDeportistas lo encuentra por un alias.
    const { ctx } = crearContexto({
      respuestas: [
        ...sinFusiones,
        cabeceras,
        { cuando: /FROM sport_bout b/, filas: [] },
        {
          cuando: /FROM sport_person p\s+WHERE/,
          filas: [
            {
              id: UUID_C,
              nombre: 'Nora Diaz',
              claveNombre: 'nora diaz',
              alias: 'N. Diaz-Pons',
              pais: 'ITA',
              genero: 'F',
              anioNacimiento: 2006,
            },
          ],
        },
      ],
    });
    const entrada = { ...CRITERIOS_CARA_A_CARA_VACIOS, ...todos, q: 'pons' };
    const v = await cargarCaraACaraPantalla(ctx, UUID_A, entrada);
    if (v.tipo !== 'elegir') throw new Error(v.tipo);
    expect(v.rivales).toMatchObject({ tipo: 'ok', sinResultados: true });
    if (v.otros?.tipo !== 'ok') throw new Error('la búsqueda debía ir bien');
    expect(v.otros.items.map((d) => d.id)).toEqual([UUID_C]);

    const marcado = html(
      React.createElement(ElegirRival, { persona: v.persona, rivales: v.rivales, otros: v.otros, criterios: entrada }),
    );
    expect(marcado).toContain('Alias «N. Diaz-Pons»');
    expect(marcado).toContain('>Otras personas<');
    expect(marcado).not.toMatch(/Aún no tienen|no tienen asaltos|sin asaltos/i);
    expect(marcado).toContain(`cara-a-cara?rival=${UUID_C}"`);
  });

  it('el error de la búsqueda suplementaria es un aviso propio y neutro, con la lista confirmada intacta', () => {
    const marcado = html(
      React.createElement(ElegirRival, {
        persona,
        rivales: {
          tipo: 'ok',
          items: [{ id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA', asaltos: 3, victorias: 2, derrotas: 1 }],
          siguiente: null,
          sinResultados: false,
        },
        otros: { tipo: 'error' },
        criterios: { ...CRITERIOS_CARA_A_CARA_VACIOS, q: 'ruiz' },
      }),
    );
    expect(marcado).toContain('Marta Ruiz');
    expect(marcado).toContain('otras personas indexadas');
    expect(marcado).toContain('no es que no haya coincidencias');
    expect(marcado).toContain('role="alert"');
  });
});

describe('cara a cara: cifras y cruces', () => {
  const personas = {
    yo: { id: UUID_A, nombre: 'GARCIA Lucia', pais: 'ESP' },
    rival: { id: UUID_B, nombre: 'RUIZ Marta', pais: 'FRA' },
  };
  const cobertura: DatosCaraACara['cobertura'] = {
    estado: 'parcial',
    exhaustivo: false,
    pruebasComunes: 2,
    pruebasConAsaltos: 1,
    pruebasSinAsaltosPublicados: 0,
    pruebasSinVerificar: 1,
    pendientes: [],
    pendientesTruncado: false,
  };
  const encuentro = (extra: Partial<EncuentroCaraACara> = {}): EncuentroCaraACara => ({
    pruebaId: 'c1',
    edicionId: 'ed1',
    torneo: 'Coupe du Monde par équipes',
    fecha: '2026-03-02',
    ciudad: 'PARIS',
    pais: 'FRA',
    arma: 'ESPADA',
    genero: 'F',
    categoria: 'ABS',
    categoriaRaw: 'Senior',
    formato: 'INDIVIDUAL',
    temporada: '2026',
    fuente: 'fie',
    clasificacion: { tipo: 'COPA_MUNDO', etiqueta: 'Copa del Mundo', corta: 'Copa del Mundo', tono: 'org-fie' } as never,
    puestos: { yo: 1, rival: 8, yoPublicado: null, rivalPublicado: null },
    delante: 'yo',
    asaltos: { total: 2, poule: { victorias: 1, derrotas: 0 }, directa: { victorias: 0, derrotas: 1 } },
    marcadores: [
      { fase: 'POULE', ronda: 'P3', mios: 5, rival: 3 },
      { fase: 'TABLEAU', ronda: 'A8', mios: 12, rival: 15 },
    ],
    equivalentes: [],
    ...extra,
  });
  const datos = (extra: Partial<DatosCaraACara> = {}): DatosCaraACara => ({
    estado: 'ok',
    personas,
    resumen: { asaltos: 2, victorias: 1, derrotas: 1, sinDecidir: 0, tantosFavor: 17, tantosContra: 18 },
    cobertura,
    items: [],
    siguiente: null,
    encuentros: [
      encuentro(),
      encuentro({
        pruebaId: 'c2', edicionId: 'ed2', torneo: 'TNR ABS', fuente: 'rfee_pdf', fecha: '2025-11-02', ciudad: null,
        puestos: { yo: null, rival: 3, yoPublicado: 'ABANDONO', rivalPublicado: null }, delante: null,
        asaltos: { total: 0, poule: { victorias: 0, derrotas: 0 }, directa: { victorias: 0, derrotas: 0 } },
        marcadores: [],
      }),
    ],
    resumenEncuentros: {
      competiciones: 2, conAmbosPuestos: 1, delanteYo: 1, delanteRival: 0, empates: 0,
      poule: { victorias: 1, derrotas: 0 }, directa: { victorias: 0, derrotas: 1 }, ultimo: null, truncado: false,
    },
    ...extra,
  });

  const SUPERFLUO = [
    'Ronda publicada', 'Abrir en la fuente', 'Sin asalto entre las dos', 'Qué cubre', 'Qué se incluye',
    'Cobertura parcial', 'asaltos importados', 'Últimos asaltos, del más reciente:', 'Aplicar', '«',
  ];

  it('cada cruce enlaza a su prueba con nombre, categoría y rondas legibles, y los dos puestos', () => {
    const marcado = html(React.createElement(CaraACaraCompleto, { datos: datos(), criterios: criterios() }));
    expect(marcado).toContain('Copa del Mundo');
    expect(marcado).not.toContain('par équipes');
    expect(marcado).toContain('Absoluto');
    expect(marcado).not.toContain('Senior');
    expect(marcado).toContain('Poule');
    expect(marcado).toContain('Cuartos');
    expect(marcado).not.toMatch(/>P3<|>A8</);
    expect(marcado).toContain(`href="/explorar/ediciones/ed1?prueba=c1&amp;persona=${UUID_A}"`);
    expect(marcado).toContain(`href="/explorar/ediciones/ed2?prueba=c2&amp;persona=${UUID_A}"`);
    expect(marcado).toContain('Lucia Garcia 1º, Marta Ruiz 8º');
    expect(marcado).toContain('Lucia Garcia sin puesto, Marta Ruiz 3º');
    expect(marcado).toContain('bg-amber-100');
    expect(marcado).toContain('Asaltos disponibles en 1 de 2 pruebas comunes');
    for (const texto of SUPERFLUO) expect(marcado).not.toContain(texto);
    expect(marcado).not.toContain('GARCIA Lucia');
  });

  it('las cifras comparan clasificación, tocados, media y fases sin repetir el balance', () => {
    const marcado = html(React.createElement(CaraACaraCompleto, { datos: datos(), criterios: criterios() }));
    expect(marcado).toContain('Por delante');
    expect(marcado).toContain('>Tocados<');
    expect(marcado).toContain('>Media<');
    expect(marcado).not.toMatch(/uppercase|tracking-/);
    expect(marcado).toContain('8,5');
    expect(marcado).toContain('9,0');
    expect(marcado).toContain('>Poule<');
    expect(marcado).toContain('>Directa<');
    const soloPoule = html(React.createElement(CaraACaraCompleto, { datos: datos(), criterios: criterios({ fase: 'POULE' }) }));
    expect(soloPoule).not.toContain('>Directa<');
  });

  it('las rondas se nombran en palabras, nunca con la clave de la fuente', () => {
    const rotulo = (fase: 'POULE' | 'TABLEAU', ronda: string) => rotuloMarcador({ fase, ronda });
    expect(rotulo('POULE', 'P3')).toBe('Poule');
    expect(rotulo('POULE', 'V2P1')).toBe('Poule');
    expect(rotulo('TABLEAU', 'A32')).toBe('Tabla de 32');
    expect(rotulo('TABLEAU', 'A8')).toBe('Cuartos');
    expect(rotulo('TABLEAU', 'A4')).toBe('Semifinal');
    expect(rotulo('TABLEAU', 'A2')).toBe('Final');
    expect(rotulo('TABLEAU', 'F')).toBe('Final');
    expect(rotulo('TABLEAU', 'X?')).toBe('Directa');
    expect(rotulo('TABLEAU', '')).toBe('Directa');
  });

  it('la cabecera da el balance, el reparto y los últimos resultados sin texto de relleno', () => {
    const items = [
      { id: 'b1', resultado: 'victoria' },
      { id: 'b2', resultado: 'derrota' },
    ] as DatosCaraACara['items'];
    const marcado = html(React.createElement(CabeceraCaraACara, { datos: datos({ items }), criterios: criterios() }));
    expect(marcado).toContain('aria-label="1 victoria y 1 derrota de Lucia Garcia"');
    expect(marcado).toContain('aria-label="Lucia Garcia gana el 50 % de los asaltos decididos"');
    expect(marcado).toContain('aria-label="Últimos asaltos, del más reciente: victoria, derrota"');
    expect(marcado).not.toContain('Volver');
    expect(marcado).toMatch(/<h1 class="[^"]*">Cara a cara<\/h1>/);
    expect(marcado).toContain('<span class="text-xs text-muted-foreground">Últimos</span>');
    expect(marcado).not.toMatch(/tracking-\[/);
    expect(marcado).toContain('>Lucia Garcia<');
    expect(marcado).toContain('>Marta Ruiz<');
    expect(marcado).not.toContain('sr-only');
    // Países distintos: se pinta la bandera de cada una.
    expect(marcado).toContain('ESP');
    expect(marcado).toContain('FRA');
  });

  it('sin pruebas comunes ni asaltos no hay cifras, ni balance, ni «nunca se enfrentaron»', () => {
    const PROHIBIDO = /nunca se enfrent|jamás|\b0\s*[-–a]\s*0\b|0 victorias/i;
    const vacio = datos({
      resumen: { asaltos: 0, victorias: 0, derrotas: 0, sinDecidir: 0, tantosFavor: 0, tantosContra: 0 },
      encuentros: [],
      resumenEncuentros: undefined,
    });
    const marcado = html(React.createElement(CaraACaraCompleto, { datos: vacio, criterios: criterios() }));
    expect(marcado).toContain('Sin pruebas comunes importadas con estos filtros.');
    expect(marcado).not.toContain('>Tocados<');
    expect(marcado).not.toMatch(PROHIBIDO);
    const cabecera = html(React.createElement(CabeceraCaraACara, { datos: vacio, criterios: criterios() }));
    expect(cabecera).toContain('>vs<');
    expect(cabecera).not.toMatch(PROHIBIDO);
  });

  it('cada estado de fallo se distingue de «sin asaltos»', () => {
    const PROHIBIDO = /nunca se enfrent|jamás|\b0\s*[-–a]\s*0\b|0 victorias/i;
    for (const tipo of ['error', 'no_disponible', 'entrada_invalida', 'cursor_invalido', 'no_encontrada', 'misma_persona'] as const) {
      const marcado = html(
        React.createElement(EstadoCaraACara, { vista: { tipo }, personaId: UUID_A, criterios: criterios() }),
      );
      expect(marcado).toMatch(/role="(alert|status)"/);
      expect(marcado).not.toMatch(PROHIBIDO);
    }
    const error = html(
      React.createElement(EstadoCaraACara, { vista: { tipo: 'error' }, personaId: UUID_A, criterios: criterios() }),
    );
    expect(error).toContain('no es que no haya asaltos');
  });

  it('el DTO no lleva datos privados', () => {
    const d = datos();
    for (const k of clavesDe(d)) expect(CLAVES_PRIVADAS).not.toContain(k);
    expect(clavesDe(d).has('ranking')).toBe(false);
  });
});

describe('cabecera y entradas al cara a cara', () => {
  it('la cabecera enlaza ambas fichas, la vista del rival y el cambio de rival conservando filtros', () => {
    const datos: DatosCaraACara = {
      estado: 'ok',
      personas: {
        yo: { id: UUID_A, nombre: 'Lucia Garcia', pais: 'ESP' },
        rival: { id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA' },
      },
      resumen: { asaltos: 0, victorias: 0, derrotas: 0, sinDecidir: 0, tantosFavor: 0, tantosContra: 0 },
      cobertura: {
        estado: 'sin_pruebas_comunes',
        exhaustivo: false,
        pruebasComunes: 0,
        pruebasConAsaltos: 0,
        pruebasSinAsaltosPublicados: 0,
        pruebasSinVerificar: 0,
        pendientes: [],
        pendientesTruncado: false,
      },
      items: [],
      siguiente: null,
    };
    const marcado = html(
      React.createElement(CabeceraCaraACara, { datos, criterios: criterios({ temporada: '2027', fase: 'POULE' }) }),
    );
    expect(marcado).toContain('<h1');
    expect(marcado).toContain(`href="/explorar/${UUID_A}"`);
    expect(marcado).toContain(`href="/explorar/${UUID_B}"`);
    expect(marcado).toContain(`href="/explorar/${UUID_B}/cara-a-cara?rival=${UUID_A}&amp;temporada=2027&amp;fase=POULE"`);
    expect(marcado).toContain(`href="/explorar/${UUID_A}/cara-a-cara"`);
  });

  it('toda ficha, propia o ajena, ofrece elegir rival y avisa de que sólo cuenta lo individual', () => {
    const ficha = { id: UUID_A, nombre: 'Lucia Garcia' } as never;
    const marcado = html(React.createElement(EntradaCaraACara, { ficha, nivel: 'seccion' }));
    expect(marcado).toContain(`href="/explorar/${UUID_A}/cara-a-cara"`);
    expect(marcado).toContain('Elegir un rival');
    expect(marcado).toContain('asaltos individuales');
    expect(typeof FichaCompleta).toBe('function');
  });
});
