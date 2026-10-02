import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  cargarCaraACaraPantalla,
  type DatosCaraACara,
  type VistaCaraACara,
} from '@/lib/sport/explorar/cara-a-cara-pantalla';
import {
  CRITERIOS_CARA_A_CARA_VACIOS,
  aEntradaCaraACara,
  aEntradaRivales,
  chipsCaraACara,
  construirUrlCaraACara,
  leerCriteriosCaraACara,
  urlVistaDelRival,
  type CriteriosCaraACara,
} from '@/lib/sport/explorar/cara-a-cara-url';
import { opcionesTemporada } from '@/lib/sport/explorar/url';
import { CLAVES_PRIVADAS, UUID_A, UUID_B, UUID_C, clavesDe, crearContexto } from './helpers/explorar';

const {
  AsaltosCaraACara,
  BalanceCaraACara,
  CabeceraCaraACara,
  CaraACaraCompleto,
  CoberturaCaraACaraVista,
  ElegirRival,
  EstadoCaraACara,
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

  it('sólo cuenta individuales con marcador: las tres consultas excluyen equipos y marcadores empatados del listado', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: respuestasH2h({
        resumen: { asaltos: 1, victorias: 1, derrotas: 0, sinDecidir: 0, tantosFavor: 5, tantosContra: 3 },
        asaltos: [asalto('b1')],
        comunes: [comun()],
      }),
    });
    await datosDe(cargarCaraACaraPantalla(ctx, UUID_A, criterios()));
    const lecturas = sentencias.filter((s) => /sport_bout|WITH comunes/.test(s.text) && !/RECURSIVE/.test(s.text));
    expect(lecturas).toHaveLength(3);
    for (const s of lecturas) {
      expect(s.text).toMatch(/c\.format::text = 'INDIVIDUAL'/);
      expect(s.text).not.toMatch(/internal_ranking|ranking_snapshot|user_profile|email/i);
    }
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

    const a = html(React.createElement(AsaltosCaraACara, { datos: desdeA, criterios: criterios() }));
    const b = html(
      React.createElement(AsaltosCaraACara, { datos: desdeB, criterios: criterios({ rival: UUID_A }) }),
    );
    expect(a).toMatch(/>5<\/span><span[^>]*>frente a<\/span><span[^>]*>3</);
    expect(b).toMatch(/>3<\/span><span[^>]*>frente a<\/span><span[^>]*>5</);
    expect(a).toContain('Victoria');
    expect(b).toContain('Derrota');
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
    expect(resumen.params).toContain(UUID_B);
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
    expect(bPasada).toContain(UUID_B);
    expect(bPasada).toContain('2025');
    expect(bPasada).not.toContain(UUID_C);
    expect(cActual).toContain(UUID_C);
    expect(cActual).toContain('2026');
    expect(cActual).not.toContain('2025');
  });
});

describe('cargarCaraACaraPantalla: elegir rival', () => {
  const rivalesFila = [
    { id: UUID_B, clave: 'marta ruiz', nombre: 'Marta Ruiz', pais: 'FRA', asaltos: 3 },
    { id: UUID_C, clave: 'nora diaz', nombre: 'Nora Diaz', pais: 'ITA', asaltos: 1 },
  ];
  const respuestasElegir = (extra: { cuando: RegExp; filas: unknown[] }[] = []) => [
    ...sinFusiones,
    cabeceras,
    ...extra,
    { cuando: /FROM sport_bout b/, filas: rivalesFila },
  ];

  it('lista los rivales con asaltos y cabecera de la persona, sin ofrecer el cara a cara de nadie sin rival', async () => {
    const { ctx } = crearContexto({ respuestas: respuestasElegir() });
    const v = await cargarCaraACaraPantalla(ctx, UUID_A, { ...CRITERIOS_CARA_A_CARA_VACIOS, temporada: '2026-2027' });
    if (v.tipo !== 'elegir') throw new Error(v.tipo);
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

  it('los rivales enlazan al cara a cara por ID, con la temporada elegida, y paginan con cursor', () => {
    const marcado = html(
      React.createElement(ElegirRival, {
        persona: { id: UUID_A, nombre: 'Lucia Garcia', pais: 'ESP' },
        rivales: {
          tipo: 'ok',
          items: [{ id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA', asaltos: 3 }],
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
    expect(marcado).toContain(`href="/explorar/${UUID_A}/cara-a-cara?rival=${UUID_B}&amp;temporada=2027"`);
    expect(marcado).toContain(`href="/explorar/${UUID_A}/cara-a-cara?rival=${UUID_C}&amp;temporada=2027"`);
    expect(marcado).toContain('2 personas con este nombre');
    // La propia persona no se ofrece como su rival.
    expect(marcado).not.toContain(`rival=${UUID_A}`);
    expect(marcado).toContain('cursor=sig');
    expect(marcado).toContain('Aún no tienen asaltos confirmados');
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
    expect(marcado).toContain('Puede faltar por importar');
    expect(marcado).not.toMatch(/nunca|Nadie/i);
  });
});

describe('cara a cara: detalle de cada asalto', () => {
  const datosBase = (extra: Partial<DatosCaraACara> = {}): DatosCaraACara => ({
    estado: 'ok',
    personas: {
      yo: { id: UUID_A, nombre: 'Lucia Garcia', pais: 'ESP' },
      rival: { id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA' },
    },
    resumen: { asaltos: 1, victorias: 1, derrotas: 0, sinDecidir: 0, tantosFavor: 5, tantosContra: 3 },
    cobertura: {
      estado: 'verificado',
      exhaustivo: false,
      pruebasComunes: 1,
      pruebasConAsaltos: 1,
      pruebasSinAsaltosPublicados: 0,
      pruebasSinVerificar: 0,
      pendientes: [],
      pendientesTruncado: false,
    },
    items: [
      {
        id: 'b1',
        marcador: { mios: 5, rival: 3 },
        resultado: 'victoria',
        torneo: { id: 'e1', nombre: 'GRAND PRIX DE PARIS' },
        prueba: {
          id: 'c1',
          arma: 'ESPADA',
          genero: 'F',
          categoria: { codigo: 'ABS', raw: 'Senior' },
          formato: 'INDIVIDUAL',
        },
        temporada: '2026',
        fecha: '2026-03-02',
        fase: 'TABLEAU',
        rondaPublicada: 'A32',
        enlace: 'https://fie.example.test/bout/1',
      },
    ],
    siguiente: null,
    ...extra,
  });

  it('cada fila informa marcador, torneo, prueba, fecha, temporada, fase, ronda publicada y enlace', () => {
    const marcado = html(React.createElement(AsaltosCaraACara, { datos: datosBase(), criterios: criterios() }));
    expect(marcado).toContain('Grand Prix de Paris');
    expect(marcado).toContain('Espada femenino');
    expect(marcado).toContain('Senior');
    expect(marcado).toContain('FIE 2026');
    expect(marcado).toContain('Eliminación directa');
    expect(marcado).toContain('Ronda publicada: «A32»');
    expect(marcado).toContain('href="https://fie.example.test/bout/1"');
    expect(marcado).toContain('Victoria');
  });

  it('un campo ausente se dice ausente: sin fecha, sin ronda y sin enlace no se inventa nada', () => {
    const datos = datosBase();
    datos.items = [{ ...datos.items[0], fecha: null, rondaPublicada: '', enlace: null }];
    const marcado = html(React.createElement(AsaltosCaraACara, { datos, criterios: criterios() }));
    expect(marcado).toContain('Fecha no publicada');
    expect(marcado).toContain('Ronda no publicada');
    expect(marcado).not.toContain('href="http');
  });

  it('un enlace con esquema no web no se vuelve clicable', () => {
    const datos = datosBase();
    datos.items = [{ ...datos.items[0], enlace: 'javascript:alert(1)' }];
    const marcado = html(React.createElement(AsaltosCaraACara, { datos, criterios: criterios() }));
    expect(marcado).not.toContain('javascript:');
  });

  it('la poule se rotula como poule y la clave de la fuente se muestra tal cual', () => {
    const datos = datosBase();
    datos.items = [{ ...datos.items[0], fase: 'POULE', rondaPublicada: 'P2' }];
    const marcado = html(React.createElement(AsaltosCaraACara, { datos, criterios: criterios() }));
    expect(marcado).toContain('Poule');
    expect(marcado).toContain('Ronda publicada: «P2»');
  });

  it('la paginación conserva rival y filtros, cambia sólo el cursor y vuelve a la primera página', () => {
    const c = criterios({ temporada: '2027', cursor: 'actual' });
    const marcado = html(
      React.createElement(AsaltosCaraACara, { datos: datosBase({ siguiente: 'sig' }), criterios: c }),
    );
    expect(marcado).toContain(`rival=${UUID_B}&amp;temporada=2027&amp;cursor=sig#h2h-asaltos`);
    expect(marcado).toContain(`href="/explorar/${UUID_A}/cara-a-cara?rival=${UUID_B}&amp;temporada=2027#h2h-asaltos"`);
  });

  it('si todos los asaltos terminaron igualados no hay ganador que listar, pero se cuentan', () => {
    const datos = datosBase({
      items: [],
      resumen: { asaltos: 2, victorias: 0, derrotas: 0, sinDecidir: 2, tantosFavor: 8, tantosContra: 8 },
    });
    const marcado = html(React.createElement(AsaltosCaraACara, { datos, criterios: criterios() }));
    expect(marcado).toContain('marcador igualado');
    const balance = html(React.createElement(BalanceCaraACara, { datos }));
    expect(balance).toContain('Marcador igualado, sin ganador');
  });

  it('el balance explica el alcance y el DTO no lleva datos privados', () => {
    const datos = datosBase();
    const marcado = html(React.createElement(BalanceCaraACara, { datos }));
    expect(marcado).toContain('Victorias de Lucia Garcia');
    expect(marcado).toContain('Victorias de Marta Ruiz');
    expect(marcado).toContain('No es el balance de toda su carrera');
    expect(marcado).toContain('una sola vez');
    for (const k of clavesDe(datos)) expect(CLAVES_PRIVADAS).not.toContain(k);
    expect(clavesDe(datos).has('ranking')).toBe(false);
  });
});

describe('cara a cara: cobertura parcial no es cero', () => {
  const cobertura = (extra: Partial<DatosCaraACara['cobertura']>): DatosCaraACara['cobertura'] => ({
    estado: 'sin_pruebas_comunes',
    exhaustivo: false,
    pruebasComunes: 0,
    pruebasConAsaltos: 0,
    pruebasSinAsaltosPublicados: 0,
    pruebasSinVerificar: 0,
    pendientes: [],
    pendientesTruncado: false,
    ...extra,
  });
  const vacio = { asaltos: 0, victorias: 0, derrotas: 0, sinDecidir: 0, tantosFavor: 0, tantosContra: 0 };
  const personas = {
    yo: { id: UUID_A, nombre: 'Lucia Garcia', pais: 'ESP' },
    rival: { id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA' },
  };
  const completo = (c: DatosCaraACara['cobertura']) =>
    html(
      React.createElement(CaraACaraCompleto, {
        datos: { estado: 'ok', personas, resumen: vacio, cobertura: c, items: [], siguiente: null },
        criterios: criterios(),
      }),
    );

  const PROHIBIDO = /nunca se enfrent|jamás|\b0\s*[-–a]\s*0\b|0 victorias/i;

  it('sin pruebas comunes importadas: no hay balance ni «nunca se enfrentaron»', () => {
    const marcado = completo(cobertura({}));
    expect(marcado).toContain('Sin pruebas comunes importadas');
    expect(marcado).toContain('no significa que no se hayan enfrentado');
    expect(marcado).not.toMatch(PROHIBIDO);
    expect(marcado).not.toContain('Victorias de');
    expect(marcado).not.toContain('Pruebas comunes importadas</dt>');
  });

  it('final sin asaltos publicados (caso París sin poules): dice que la fuente no publica asaltos', () => {
    const marcado = completo(
      cobertura({ estado: 'verificado', pruebasComunes: 1, pruebasSinAsaltosPublicados: 1 }),
    );
    expect(marcado).toContain('la fuente sólo da la clasificación final');
    expect(marcado).toContain('Sin asaltos publicados por la fuente');
    expect(marcado).not.toMatch(PROHIBIDO);
    expect(marcado).not.toContain('Victorias de');
  });

  it('prueba común sin leer: pendiente, con el torneo y el motivo', () => {
    const marcado = completo(
      cobertura({
        estado: 'pendiente',
        pruebasComunes: 1,
        pruebasSinVerificar: 1,
        pendientes: [
          {
            id: 'c9',
            fuente: 'fie',
            torneo: 'COPA DEL MUNDO',
            arma: 'ESPADA',
            genero: 'F',
            categoria: 'ABS',
            categoriaRaw: null,
            temporada: '2026',
            asaltos: 0,
            estado: 'pendiente',
          },
        ],
      }),
    );
    expect(marcado).toContain('Asaltos pendientes de leer');
    expect(marcado).toContain('Copa del Mundo');
    expect(marcado).toContain('Asaltos sin leer todavía');
    expect(marcado).toContain('tampoco ausencia');
    expect(marcado).not.toMatch(PROHIBIDO);
  });

  it('cobertura parcial con asaltos: muestra el balance y avisa de que puede estar incompleto', () => {
    const datos: DatosCaraACara = {
      estado: 'ok',
      personas,
      resumen: { asaltos: 2, victorias: 1, derrotas: 1, sinDecidir: 0, tantosFavor: 9, tantosContra: 9 },
      cobertura: cobertura({ estado: 'parcial', pruebasComunes: 3, pruebasConAsaltos: 1, pruebasSinVerificar: 2 }),
      items: [],
      siguiente: null,
    };
    const marcado = html(React.createElement(CaraACaraCompleto, { datos, criterios: criterios() }));
    expect(marcado).toContain('Cobertura parcial');
    expect(marcado).toContain('El balance puede estar incompleto');
    expect(marcado).toContain('Victorias de Lucia Garcia');
  });

  it('un conjunto verificado sólo promete lo importado, no la carrera', () => {
    const marcado = html(
      React.createElement(CoberturaCaraACaraVista, {
        cobertura: cobertura({ estado: 'verificado', pruebasComunes: 2, pruebasConAsaltos: 2 }),
        hayAsaltos: true,
      }),
    );
    expect(marcado).toContain('no promete que estén todas las temporadas');
    expect(marcado).not.toMatch(/\bcompleto\b.*carrera/i);
  });

  it('cada estado de fallo se distingue de «sin asaltos»', () => {
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
    expect(marcado).toContain(`href="/explorar/${UUID_A}/cara-a-cara?temporada=2027&amp;fase=POULE"`);
  });

  it('toda ficha, propia o ajena, ofrece elegir rival y avisa de que sólo cuenta lo individual', () => {
    const ficha = { id: UUID_A, nombre: 'Lucia Garcia' } as never;
    const marcado = html(React.createElement(EntradaCaraACara, { ficha, nivel: 'seccion' }));
    expect(marcado).toContain(`href="/explorar/${UUID_A}/cara-a-cara"`);
    expect(marcado).toContain('Elegir un rival');
    expect(marcado).toContain('Los encuentros por equipos, los BYE y las finales sin marcador no cuentan');
    expect(typeof FichaCompleta).toBe('function');
  });
});
