import * as React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { cargarFichaPantalla, type HistorialVista } from '@/lib/sport/explorar/ficha-pantalla';
import {
  CRITERIOS_FICHA_VACIOS,
  aEntradaFicha,
  construirUrlFicha,
  leerCriteriosFicha,
  personaDeRuta,
  type CriteriosFicha,
} from '@/lib/sport/explorar/ficha-url';
import { posibleMenor } from '@/lib/sport/explorar/ficha';
import type { EntradaRankingOficial, FichaDeportiva } from '@/lib/sport/explorar/tipos';
import { CLAVES_PRIVADAS, UUID_A, UUID_B, UUID_C, clavesDe, crearContexto, personaSimple } from './helpers/explorar';

const {
  CabeceraFicha,
  EstadoFicha,
  FichaCompleta,
  HistorialFicha,
  RankingCompacto,
} = await import('@/components/explorar/ficha-deportiva');

/**
 * Pantalla de ficha deportiva y su historial propio. Contexto controlado: SQL
 * registrado y filas fijadas por el caso, render estático. No hay sesión Neon
 * Auth real, PostgreSQL ni navegador autenticado.
 */

const atleta = (id = 'ath-1') => ({
  id,
  rfeeLicense: null,
  rfeeValidUntil: null,
  fieLicense: null,
  fieValidUntil: null,
});

const cabecera = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  cuando: /display_name AS nombre/,
  filas: [{ id, nombre, pais: 'ESP', genero: 'F', anioNacimiento: 1990, ...extra }],
});

const base = [
  { cuando: /FROM sport_person_alias/, filas: [] },
  { cuando: /una_por_prueba/, filas: [] },
  { cuando: /count\(DISTINCT c\.edition_id\)/, filas: [{ resultados: 0, pruebas: 0, ediciones: 0 }] },
  { cuando: /FROM sport_import_coverage cov/, filas: [] },
  { cuando: /GROUP BY p\.season/, filas: [] },
];

const reemplazar = (cuando: RegExp, filas: unknown[] | ((s: never) => unknown[])) => ({ cuando, filas }) as never;

const filaHistorial = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  puesto: 2,
  puestoPublicado: null,
  puntos: null,
  fuente: 'fie',
  enlace: 'https://fie.example.test/r/1',
  torneoId: 'ed-1',
  torneo: 'COPA DEL MUNDO MADRID',
  ciudad: 'Madrid',
  paisTorneo: 'ESP',
  tipo: 'SEN_WC',
  pruebaId: 'c-1',
  arma: 'ESPADA',
  genero: 'F',
  categoria: 'ABS',
  categoriaRaw: 'Senior',
  formato: 'INDIVIDUAL',
  temporada: '2026',
  fecha: '2026-03-01',
  fechaOrden: '2026-03-01',
  ...extra,
});

const filaRanking = (temporada: string, puesto: number | null, fuente = 'fie_tiradores') => ({
  id: `pub-${temporada}`,
  source: fuente,
  season: temporada,
  weapon: 'ESPADA',
  gender: 'F',
  category: 'ABS',
  categoryRaw: 'Senior',
  format: 'INDIVIDUAL',
  publishedOn: '2026-05-10',
  publishedTotal: 300,
  sourceUrl: 'https://fie.example.test/ranking',
  sourceRef: 'fie:1',
  position: puesto,
  points: puesto === null ? null : '12.500',
});

describe('cargarFichaPantalla: historial propio por defecto', () => {
  it('con vínculo confirmado abre la persona de la cuenta con su historial, sin pedir un ID al navegador', async () => {
    const { ctx, sentencias } = crearContexto({
      propietario: {
        atletasDeCuenta: async () => [atleta()],
        personasEnlazadas: async () => [{ personId: UUID_A, athleteId: 'ath-1' }],
      },
      respuestas: [
        ...personaSimple(UUID_A),
        cabecera(UUID_A, 'Lucia Garcia'),
        { cuando: /r\.id DESC\s+LIMIT/, filas: [filaHistorial('00000000-0000-4000-8000-000000000001')] },
        ...base,
      ],
    });
    const vista = await cargarFichaPantalla(ctx, undefined, CRITERIOS_FICHA_VACIOS);
    if (vista.tipo !== 'ok') throw new Error(vista.tipo);
    expect(vista.ficha).toMatchObject({ id: UUID_A, esPropia: true });
    expect(vista.historial.tipo).toBe('ok');
    if (vista.historial.tipo === 'ok') expect(vista.historial.items).toHaveLength(1);
    // El historial se pide por la persona que resolvió el servidor.
    const historial = sentencias.find((s) => /r\.id DESC\s+LIMIT/.test(s.text))!;
    expect(historial.params).toContain(JSON.stringify([UUID_A]));
  });

  it('con homónimo y sin vínculo no adjudica nada, explica el motivo y no lee hechos', async () => {
    const { ctx, texto } = crearContexto({
      propietario: { atletasDeCuenta: async () => [atleta()] },
      respuestas: [cabecera(UUID_B, 'Lucia Garcia')],
    });
    expect(await cargarFichaPantalla(ctx, undefined, CRITERIOS_FICHA_VACIOS)).toEqual({
      tipo: 'propia_no_confirmada',
      motivo: 'sin_vinculo',
    });
    expect(texto()).not.toMatch(/sport_result|sport_bout|sport_ranking/);
  });

  it('cada motivo de falta de vínculo tiene su explicación y ofrece Explorar', () => {
    for (const motivo of ['sin_ficha', 'sin_vinculo', 'ambigua', 'conflicto'] as const) {
      const html = renderToStaticMarkup(
        React.createElement(EstadoFicha, { vista: { tipo: 'propia_no_confirmada', motivo }, incrustado: true }),
      );
      expect(html).toContain('<h3');
      expect(html).toContain('href="/explorar"');
      expect(html).not.toMatch(/Nadie|Sin resultados/);
    }
    const sinVinculo = renderToStaticMarkup(
      React.createElement(EstadoFicha, { vista: { tipo: 'propia_no_confirmada', motivo: 'sin_vinculo' } }),
    );
    expect(sinVinculo).toContain('No se asigna por parecido de nombre');
  });
});

describe('cargarFichaPantalla: ficha de otra persona', () => {
  it('abre exactamente el ID elegido: dos homónimos tienen fichas distintas', async () => {
    const abrir = async (id: string, pais: string) => {
      const { ctx } = crearContexto({
        respuestas: [...personaSimple(id), cabecera(id, 'Ana Perez', { pais }), ...base],
      });
      const v = await cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS);
      if (v.tipo !== 'ok') throw new Error(v.tipo);
      return v.ficha;
    };
    const [a, b] = [await abrir(UUID_A, 'ESP'), await abrir(UUID_B, 'FRA')];
    expect(a).toMatchObject({ id: UUID_A, pais: 'ESP', esPropia: false });
    expect(b).toMatchObject({ id: UUID_B, pais: 'FRA', esPropia: false });
  });

  it('una persona retirada, extranjera y sin cuenta se consulta y no expone actividad ni datos de cuenta', async () => {
    const { ctx, texto } = crearContexto({
      respuestas: [
        ...personaSimple(UUID_A),
        cabecera(UUID_A, 'Retirado Extranjero', { pais: 'ITA', genero: 'M' }),
        { cuando: /r\.id DESC\s+LIMIT/, filas: [filaHistorial('00000000-0000-4000-8000-000000000002')] },
        ...base,
      ],
    });
    const vista = await cargarFichaPantalla(ctx, UUID_A, CRITERIOS_FICHA_VACIOS);
    if (vista.tipo !== 'ok') throw new Error(vista.tipo);
    const claves = clavesDe(vista);
    for (const privada of CLAVES_PRIVADAS) expect(claves.has(privada)).toBe(false);
    for (const actividad of ['active', 'activo', 'retirado', 'retired']) expect(claves.has(actividad)).toBe(false);
    expect(texto()).not.toMatch(/\bactive\b|user_profile|\bathlete\b|competition_registration|consent|guardian/);

    const html = renderToStaticMarkup(
      React.createElement(FichaCompleta, {
        ficha: vista.ficha,
        historial: vista.historial,
        base: '/explorar/x',
        criterios: CRITERIOS_FICHA_VACIOS,
        nivel: 'pagina',
      }),
    );
    expect(html).toContain('Retirado Extranjero');
    expect(html).not.toMatch(/ha dejado de competir|jubilad|retirad[oa] de la competición/i);
  });

  it('sin sesión, o con acceso revocado, no consulta nada', async () => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    expect(await cargarFichaPantalla(ctx, UUID_A, CRITERIOS_FICHA_VACIOS)).toEqual({ tipo: 'sin_sesion' });
    expect(await cargarFichaPantalla(ctx, undefined, CRITERIOS_FICHA_VACIOS)).toEqual({ tipo: 'sin_sesion' });
    expect(sentencias).toHaveLength(0);
  });

  it('inexistente, entrada inválida y esquema sin migrar son estados distintos', async () => {
    const vacio = crearContexto();
    expect(await cargarFichaPantalla(vacio.ctx, UUID_C, CRITERIOS_FICHA_VACIOS)).toEqual({ tipo: 'no_encontrada' });
    expect(
      await cargarFichaPantalla(vacio.ctx, UUID_C, { ...CRITERIOS_FICHA_VACIOS, ranking: 'abc' }),
    ).toEqual({ tipo: 'entrada_invalida' });
    const sinEsquema = crearContexto({ esquema: { identidad: false, referencias: false } });
    expect(await cargarFichaPantalla(sinEsquema.ctx, UUID_A, CRITERIOS_FICHA_VACIOS)).toEqual({
      tipo: 'no_disponible',
    });
  });

  it('un fallo del historial no borra la ficha y no se presenta como historial vacío', async () => {
    const { ctx } = crearContexto({
      respuestas: [
        ...personaSimple(UUID_A),
        cabecera(UUID_A, 'Ana Perez'),
        {
          cuando: /r\.id DESC\s+LIMIT/,
          filas: () => {
            throw new Error('caída');
          },
        },
        ...base,
      ],
    });
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const vista = await cargarFichaPantalla(ctx, UUID_A, CRITERIOS_FICHA_VACIOS);
    expect(vista.tipo).toBe('ok');
    if (vista.tipo === 'ok') {
      expect(vista.historial).toEqual({ tipo: 'error' });
      const html = renderToStaticMarkup(
        React.createElement(HistorialFicha, {
          historial: vista.historial,
          base: '/explorar/x',
          criterios: CRITERIOS_FICHA_VACIOS,
          nivel: 'pagina',
        }),
      );
      expect(html).toContain('role="alert"');
      expect(html).not.toContain('No hay puestos finales importados');
    }
    expect(JSON.stringify(espia.mock.calls)).not.toMatch(/caída|Ana/);
    espia.mockRestore();
  });
});

describe('menores y ausencia honesta', () => {
  it('posibleMenor trata como menor a quien puede serlo con sólo el año', () => {
    expect(posibleMenor(2012, '2026-10-02')).toBe(true);
    expect(posibleMenor(2008, '2026-10-02')).toBe(true);
    expect(posibleMenor(2007, '2026-10-02')).toBe(false);
    expect(posibleMenor(null, '2026-10-02')).toBe(false);
  });

  it('la ficha ajena de un menor omite incluso el año de nacimiento y no trae otros datos personales', async () => {
    const { ctx, texto } = crearContexto({
      respuestas: [...personaSimple(UUID_A), cabecera(UUID_A, 'Menor Sinnombre', { anioNacimiento: 2013 }), ...base],
    });
    const vista = await cargarFichaPantalla(ctx, UUID_A, CRITERIOS_FICHA_VACIOS);
    if (vista.tipo !== 'ok') throw new Error(vista.tipo);
    expect(vista.ficha).toMatchObject({ esMenor: true, anioNacimiento: null, esPropia: false });
    for (const privada of CLAVES_PRIVADAS) expect(clavesDe(vista).has(privada)).toBe(false);
    expect(texto()).not.toMatch(/birth_date|photo|foto|email|consent|guardian|tutor/i);
    const html = renderToStaticMarkup(React.createElement(CabeceraFicha, { ficha: vista.ficha }));
    expect(html).not.toContain('Posible menor de edad');
    expect(html).not.toContain('2013');
  });

  it('la propia ficha de un menor conserva el año; un adulto ajeno también', async () => {
    const propia = crearContexto({
      propietario: {
        atletasDeCuenta: async () => [atleta()],
        personasEnlazadas: async () => [{ personId: UUID_A, athleteId: 'ath-1' }],
      },
      respuestas: [...personaSimple(UUID_A), cabecera(UUID_A, 'Menor Propia', { anioNacimiento: 2013 }), ...base],
    });
    const p = await cargarFichaPantalla(propia.ctx, undefined, CRITERIOS_FICHA_VACIOS);
    if (p.tipo !== 'ok') throw new Error(p.tipo);
    expect(p.ficha).toMatchObject({ esMenor: true, esPropia: true, anioNacimiento: 2013 });

    const adulto = crearContexto({
      respuestas: [...personaSimple(UUID_B), cabecera(UUID_B, 'Adulto Ajeno', { anioNacimiento: 1985 }), ...base],
    });
    const a = await cargarFichaPantalla(adulto.ctx, UUID_B, CRITERIOS_FICHA_VACIOS);
    if (a.tipo !== 'ok') throw new Error(a.tipo);
    expect(a.ficha).toMatchObject({ esMenor: false, anioNacimiento: 1985 });
  });

  it('un dato pendiente o sin importar se dice como ausencia, no como cero participaciones ni derrotas', async () => {
    const { ctx } = crearContexto({
      respuestas: [...personaSimple(UUID_A), cabecera(UUID_A, 'Ana Perez'), ...base],
    });
    const vista = await cargarFichaPantalla(ctx, UUID_A, CRITERIOS_FICHA_VACIOS);
    if (vista.tipo !== 'ok') throw new Error(vista.tipo);
    const html = renderToStaticMarkup(
      React.createElement(FichaCompleta, {
        ficha: vista.ficha,
        historial: vista.historial,
        base: '/explorar/x',
        criterios: CRITERIOS_FICHA_VACIOS,
        nivel: 'pagina',
      }),
    );
    expect(html).toContain('No hay puestos finales importados');
    // Sin pruebas no se pintan cifras ni medallas a cero.
    expect(html).not.toContain('aria-label="Medallas y hitos"');
    expect(html).not.toContain('aria-label="En cifras"');
    expect(html).not.toMatch(/0 derrotas|0 victorias/);
  });
});

const ficha = (extra: Partial<FichaDeportiva> = {}): FichaDeportiva => ({
  id: UUID_A,
  nombre: 'ANA PEREZ',
  alias: [],
  pais: 'ESP',
  genero: 'F',
  anioNacimiento: 1990,
  esMenor: false,
  esPropia: false,
  estadisticas: { conjunto: 'clasificaciones_individuales', porTipo: [] },
  cobertura: { resultadosImportados: 0, pruebasConResultado: 0, ediciones: 0, lecturas: [], historiaCompleta: false },
  rankingOficial: { temporada: null, formato: 'INDIVIDUAL', temporadasDisponibles: [], entradas: [] },
  ...extra,
});

const entrada = (temporada: string, puesto: number | null, fuente = 'fie_tiradores'): EntradaRankingOficial => ({
  fuente,
  temporada,
  arma: 'ESPADA',
  genero: 'F',
  categoria: { codigo: 'ABS', raw: 'Senior' },
  formato: 'INDIVIDUAL',
  puesto,
  puntos: puesto === null ? null : '12.500',
  totalPublicado: 300,
  fecha: { sourcePublishedOn: null, observedOn: '2026-05-10', baseLectura: true },
  enlace: 'https://fie.example.test/ranking',
});

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);

describe('ranking oficial en la ficha', () => {
  const ranking = (entradas: EntradaRankingOficial[], temporada: string | null) =>
    html(
      React.createElement(RankingCompacto, {
        nivel: 'pagina',
        ficha: ficha({ rankingOficial: { temporada, formato: 'INDIVIDUAL', temporadasDisponibles: [], entradas } }),
      }),
    );

  it('atribuye el puesto a su temporada y fuente, con el total y los puntos publicados', () => {
    const salida = ranking([entrada('2026', 14)], '2026');
    expect(salida).toContain('id="ficha-ranking"');
    expect(salida).toMatch(/>14(<!-- -->)?º</);
    expect(salida).toContain('FIE 2026');
    expect(salida).toContain('de 300');
    expect(salida).toContain('12.500 puntos');
  });

  it('un puesto null no se pinta como cero y sin puestos no hay bloque', () => {
    expect(ranking([entrada('2025', null)], '2025')).toBe('');
    expect(ranking([], null)).toBe('');
  });
});

describe('historial en la ficha', () => {
  const historial = (extra: Partial<Extract<HistorialVista, { tipo: 'ok' }>> = {}): HistorialVista => ({
    tipo: 'ok',
    items: [],
    siguiente: null,
    sinResultados: false,
    ...extra,
  });
  const item = (extra: Record<string, unknown> = {}) => ({
    id: '00000000-0000-4000-8000-000000000001',
    puesto: 2,
    puestoPublicado: null,
    puntosOficiales: null,
    fuente: 'fie',
    enlace: 'https://fie.example.test/r/1',
    torneo: { id: 'e1', nombre: 'COPA DEL MUNDO MADRID', ciudad: 'Madrid', pais: 'ESP' },
    tipoDocumentado: 'SEN_WC',
    prueba: {
      id: 'c1',
      arma: 'ESPADA' as const,
      genero: 'F' as const,
      categoria: { codigo: 'ABS', raw: 'Senior' },
      formato: 'INDIVIDUAL' as const,
    },
    temporada: '2026',
    fecha: '2026-03-01' as string | null,
    ...extra,
  });
  const render = (h: HistorialVista, criterios: Partial<CriteriosFicha> = {}) =>
    html(
      React.createElement(HistorialFicha, {
        historial: h,
        base: '/perfil',
        criterios: { ...CRITERIOS_FICHA_VACIOS, ...criterios },
        nivel: 'seccion',
      }),
    );

  it('cada fila lleva prueba, fecha, temporada, puesto y fuente; el literal sin número no se convierte en puesto', () => {
    const salida = render(
      historial({
        items: [
          item(),
          item({ id: 'b', puesto: null, puestoPublicado: 'Abandono', fecha: null, tipoDocumentado: null, temporada: '2025-2026', fuente: 'skermo' }),
        ],
      }),
    );
    expect(salida).toContain('Copa del Mundo Madrid');
    expect(salida).toContain('Abandono');
    // La fila abre la prueba dentro de su edición.
    expect(salida).toMatch(/href="[^"]*e1[^"]*prueba=c1[^"]*"/);
    expect(salida).not.toContain('Tipo de torneo sin documentar');
    expect(salida).toContain('<h3');
  });

  it('un enlace de fuente que no es web no se vuelve clicable', () => {
    const salida = render(historial({ items: [item({ enlace: 'javascript:alert(1)' })] }));
    expect(salida).not.toContain('javascript:');
    expect(salida).not.toContain('Abrir en la fuente');
    expect(render(historial({ items: [item()] }))).toContain('rel="noopener noreferrer"');
  });

  it('pagina con cursor en la URL conservando el ranking elegido y vuelve a la primera', () => {
    const salida = render(historial({ items: [item()], siguiente: 'tok-2' }), {
      cursor: 'tok-1',
      ranking: '2025',
    });
    expect(salida).toContain('href="/perfil?ranking=2025&amp;cursor=tok-2#historial"');
    expect(salida).toContain('href="/perfil?ranking=2025#historial"');
    expect(render(historial({ items: [item()] }))).not.toContain('rel="next"');
  });

  it('sin resultados y cursor inválido son estados distintos', () => {
    const vacio = render(historial({ sinResultados: true }));
    expect(vacio).toContain('No hay puestos finales importados');
    const invalido = render({ tipo: 'cursor_invalido' });
    expect(invalido).toContain('role="alert"');
    expect(invalido).not.toContain('No hay puestos finales importados');
  });
});

describe('URL de la ficha', () => {
  it('lee ranking, modalidad y cursor sin fiarse del navegador', () => {
    expect(leerCriteriosFicha({ ranking: '2025-2026', formato: 'equipos', cursor: 'abc' })).toEqual({
      ranking: '2025-2026',
      formato: 'EQUIPOS',
      cursor: 'abc',
      volver: '',
    });
    expect(leerCriteriosFicha({ formato: 'LASER' }).formato).toBe('');
    expect(leerCriteriosFicha({ ranking: ['2024', '2025'] }).ranking).toBe('2024');
  });

  it('construye URLs estables, con ancla, y la entrada de lectura sólo lleva lo rellenado', () => {
    expect(construirUrlFicha('/perfil', {})).toBe('/perfil');
    expect(construirUrlFicha('/explorar/x', { ranking: '2025', formato: 'EQUIPOS' }, 'ficha-ranking')).toBe(
      '/explorar/x?ranking=2025&formato=EQUIPOS#ficha-ranking',
    );
    expect(aEntradaFicha(undefined, CRITERIOS_FICHA_VACIOS)).toEqual({});
    expect(aEntradaFicha(UUID_A, { ...CRITERIOS_FICHA_VACIOS, ranking: '2025' })).toEqual({
      personaId: UUID_A,
      temporadaRanking: '2025',
    });
  });

  it('el segmento de la ruta sólo vale si es un identificador', () => {
    expect(personaDeRuta(UUID_A.toUpperCase())).toBe(UUID_A);
    expect(personaDeRuta('1; DROP TABLE')).toBeNull();
    expect(personaDeRuta('perfil')).toBeNull();
  });
});

describe('rutas y perfil', () => {
  const leer = (ruta: string) => readFileSync(ruta, 'utf8');

  it('la ficha comprueba la sesión antes de leer parámetros o datos', () => {
    const fuente = leer('src/app/(app)/explorar/[personaId]/page.tsx');
    expect(fuente.indexOf('getSessionProfile()')).toBeGreaterThan(-1);
    expect(fuente.indexOf("redirect('/entrar')")).toBeLessThan(fuente.indexOf('cargarFichaPantalla(contextoReal'));
    expect(fuente.indexOf('getSessionProfile()')).toBeLessThan(fuente.indexOf('Promise.all([params'));
    expect(fuente).not.toMatch(/getManagedAthletes|user_profile|icalToken|email/);
  });

  it('/perfil pinta el historial propio por defecto, no sólo un enlace, y conserva las secciones de cuenta', () => {
    const fuente = leer('src/app/(app)/perfil/page.tsx');
    expect(fuente).toContain('<HistorialPropio');
    expect(fuente).toContain('Tu cuenta');
    expect(fuente).toContain('El calendario en tu móvil');
    const propio = leer('src/components/perfil/historial-propio.tsx');
    expect(propio).toContain('cargarFichaPantalla(contextoReal(), undefined');
    expect(propio).not.toMatch(/email|icalToken|consent|guardian|getManagedAthletes/);
  });

  it('un perfil con vínculo pinta historial y estadísticas en la sección, con la cuenta fuera del DTO', async () => {
    const { ctx } = crearContexto({
      propietario: {
        atletasDeCuenta: async () => [atleta()],
        personasEnlazadas: async () => [{ personId: UUID_A, athleteId: 'ath-1' }],
      },
      respuestas: [
        ...personaSimple(UUID_A),
        cabecera(UUID_A, 'Lucia Garcia'),
        { cuando: /r\.id DESC\s+LIMIT/, filas: [filaHistorial('00000000-0000-4000-8000-000000000001')] },
        reemplazar(/una_por_prueba/, [
          { clase: 'total', tipo: null, pruebas: 1, clasificaciones: 1, mejorPuesto: 2, podios: 1, victorias: 0, sinPuesto: 0, conflictos: 0, sinFecha: 0, desde: '2026-03-01', hasta: '2026-03-01' },
          { clase: 'tipo', tipo: 'SEN_WC', pruebas: 1, clasificaciones: 1, mejorPuesto: 2, podios: 1, victorias: 0, sinPuesto: 0 },
          { clase: 'categoria', tipo: 'SEN_WC', categoria: 'ABS', categoriaRaw: 'Senior', arma: 'ESPADA', genero: 'F', pruebas: 1, clasificaciones: 1, mejorPuesto: 2, podios: 1, victorias: 0, sinPuesto: 0 },
          { clase: 'temporada', temporada: '2026', pruebas: 1, clasificaciones: 1, mejorPuesto: 2, podios: 1, victorias: 0, sinPuesto: 0 },
        ]),
        { cuando: /GROUP BY p\.season/, filas: [{ temporada: '2026' }, { temporada: '2025' }] },
        { cuando: /WITH ordenadas/, filas: [filaRanking('2026', 14)] },
        ...base.filter((b) => !/una_por_prueba|GROUP BY p\\.season/.test(String(b.cuando))),
      ],
    });
    const vista = await cargarFichaPantalla(ctx, undefined, CRITERIOS_FICHA_VACIOS);
    if (vista.tipo !== 'ok') throw new Error(vista.tipo);
    const salida = html(
      React.createElement(FichaCompleta, {
        ficha: vista.ficha,
        historial: vista.historial,
        base: '/perfil',
        criterios: CRITERIOS_FICHA_VACIOS,
        nivel: 'seccion',
        conTitulo: false,
      }),
    );
    expect(salida).toContain('Tu ficha');
    expect(salida).toContain('Copa del Mundo Madrid');
    // Cabecera tipo perfil y marcador: el nombre formateado, el año a año y el mano a mano.
    expect(salida).toContain('Lucia Garcia');
    expect(salida).toContain('Año a año');
    expect(salida).toContain('Mano a mano');
    expect(salida).toContain('Sin asaltos importados');
    expect(salida).toContain(`href="/explorar/${UUID_A}/cara-a-cara"`);
    expect(salida).toContain('FIE 2026');
    expect(salida).toMatch(/>14(<!-- -->)?º</);
    expect(salida).not.toContain('<h1');
    expect(salida).not.toMatch(/cuenta@example|token-privado/);
  });
});
