import { describe, expect, it } from 'vitest';
import {
  estadoAsaltosPrueba,
  leerCaraACara,
  listarRivales,
  resumirCobertura,
  type PruebaComun,
} from '@/lib/sport/explorar/cara-a-cara';
import {
  CLAVES_PRIVADAS,
  UUID_A,
  UUID_B,
  UUID_C,
  clavesDe,
  crearContexto,
} from './helpers/explorar';

/**
 * Cara a cara individual con contexto controlado: SQL registrado y filas
 * fijadas. Prueba guardas, filtros del SQL, cobertura y forma del DTO; no
 * ejecuta el SQL contra PostgreSQL.
 */

const sinFusiones = [
  { cuando: /WITH RECURSIVE cadena/, filas: (s: { params: unknown[] }) => [{ id: s.params[0] }] },
  { cuando: /WITH RECURSIVE grupo/, filas: (s: { params: unknown[] }) => [{ id: s.params[0] }] },
];

const cabeceras = {
  cuando: /display_name AS nombre, country_code AS pais/,
  filas: [
    { id: UUID_A, nombre: 'Lucia Garcia', pais: 'ESP', genero: 'F', anioNacimiento: 2008 },
    { id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA', genero: 'F', anioNacimiento: 2007 },
  ],
};

const BOUT1 = '44444444-4444-4444-8444-444444444441';
const BOUT2 = '44444444-4444-4444-8444-444444444442';
const BOUT3 = '44444444-4444-4444-8444-444444444443';

const asalto = (id: string, fecha: string, mios: number, rival: number) => ({
  id,
  mios,
  rival,
  torneoId: 'e1',
  torneo: 'Copa',
  pruebaId: 'c1',
  arma: 'ESPADA',
  genero: 'F',
  categoria: 'M10',
  categoriaRaw: 'M-10',
  formato: 'INDIVIDUAL',
  temporada: '2025-2026',
  fecha,
  fechaOrden: fecha,
  fase: 'POULE',
  ronda: 'poule-1',
  enlace: null,
});

const comun = (extra: Record<string, unknown> = {}) => ({
  id: 'c1',
  fuente: 'fie',
  torneo: 'Copa',
  arma: 'ESPADA',
  genero: 'F',
  categoria: 'M10',
  categoriaRaw: null,
  temporada: '2025-2026',
  asaltos: 3,
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
        opciones.resumen ?? {
          asaltos: 0,
          victorias: 0,
          derrotas: 0,
          sinDecidir: 0,
          tantosFavor: 0,
          tantosContra: 0,
        },
      ],
    },
    { cuando: /ORDER BY coalesce\(b\.occurred_on/, filas: opciones.asaltos ?? [] },
    { cuando: /WITH comunes/, filas: opciones.comunes ?? [] },
  ];
}

describe('guardas del cara a cara', () => {
  it('sin sesión o con acceso revocado no consulta nada', async () => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    await expect(leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B })).rejects.toThrow(
      'NO_AUTENTICADO',
    );
    await expect(listarRivales(ctx, { personaId: UUID_A })).rejects.toThrow('NO_AUTENTICADO');
    expect(sentencias).toHaveLength(0);
  });

  it('entrada inválida y cursor ajeno se rechazan antes de consultar', async () => {
    const { ctx, sentencias } = crearContexto();
    expect(await leerCaraACara(ctx, { personaId: 'x', rivalId: UUID_B })).toEqual({
      estado: 'entrada_invalida',
    });
    expect(await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B, cursor: 'zz' })).toEqual({
      estado: 'cursor_invalido',
    });
    expect(sentencias).toHaveLength(0);
  });

  it('sin esquema de identidad aplicado devuelve no_disponible sin SQL', async () => {
    const { ctx, sentencias } = crearContexto({ esquema: { identidad: false, referencias: false } });
    expect(await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B })).toEqual({
      estado: 'no_disponible',
    });
    expect(sentencias).toHaveLength(0);
  });

  it('la misma persona (también tras fusionar) no tiene cara a cara consigo misma', async () => {
    const { ctx } = crearContexto({
      respuestas: [
        { cuando: /WITH RECURSIVE cadena/, filas: [{ id: UUID_A }] },
        { cuando: /WITH RECURSIVE grupo/, filas: [{ id: UUID_A }, { id: UUID_B }] },
      ],
    });
    expect(await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B })).toEqual({
      estado: 'misma_persona',
    });
  });

  it('una persona inexistente es no_encontrada', async () => {
    const { ctx } = crearContexto({ respuestas: [{ cuando: /WITH RECURSIVE cadena/, filas: [] }] });
    expect(await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B })).toEqual({
      estado: 'no_encontrada',
    });
  });
});

describe('lectura del cara a cara', () => {
  it('orienta el marcador, separa empates y no expone datos privados', async () => {
    const { ctx, texto } = crearContexto({
      respuestas: respuestasH2h({
        resumen: { asaltos: 3, victorias: 1, derrotas: 1, sinDecidir: 1, tantosFavor: 14, tantosContra: 13 },
        asaltos: [asalto(BOUT2, '2026-03-02', 5, 3), asalto(BOUT1, '2026-01-02', 2, 5)],
        comunes: [comun()],
      }),
    });
    const r = await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B });
    if (r.estado !== 'ok') throw new Error(r.estado);

    expect(r.resumen).toEqual({
      asaltos: 3,
      victorias: 1,
      derrotas: 1,
      sinDecidir: 1,
      tantosFavor: 14,
      tantosContra: 13,
    });
    expect(r.items.map((a) => [a.id, a.resultado])).toEqual([
      [BOUT2, 'victoria'],
      [BOUT1, 'derrota'],
    ]);
    expect(r.items[0].prueba.categoria).toEqual({ codigo: 'M10', raw: 'M-10' });
    expect(r.personas.rival).toEqual({ id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA' });
    expect(r.cobertura.exhaustivo).toBe(false);
    expect(r.cobertura.estado).toBe('verificado');

    const sql = texto();
    expect(sql).toMatch(/c\.format::text = 'INDIVIDUAL'/);
    expect(sql).toMatch(/b\.score_a <> b\.score_b/);
    expect(sql).not.toMatch(/user_profile|ranking_interno|internal_ranking|email/i);
    for (const k of clavesDe(r)) expect(CLAVES_PRIVADAS).not.toContain(k);
  });

  it('la pareja se busca en ambos órdenes: un asalto de poule se cuenta una sola vez', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: respuestasH2h({}) });
    await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B });
    const resumen = sentencias.find((s) => /count\(\*\) FILTER/.test(s.text));
    if (!resumen) throw new Error('sin resumen');
    expect(resumen.text).toMatch(/fencer_a_person_id IN .* AND b\.fencer_b_person_id IN .*OR/s);
    expect(resumen.text).not.toMatch(/UNION ALL/);
    expect(resumen.text.match(/FROM sport_bout b/g)).toHaveLength(1);
  });

  it('sin pruebas comunes no afirma que nunca se enfrentaran ni muestra ceros como historia', async () => {
    const { ctx } = crearContexto({ respuestas: respuestasH2h({}) });
    const r = await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.cobertura.estado).toBe('sin_pruebas_comunes');
    expect(r.cobertura.exhaustivo).toBe(false);
    expect(r.items).toEqual([]);
  });

  it('prueba común sin lecturas de asaltos queda pendiente, no a cero', async () => {
    const { ctx } = crearContexto({
      respuestas: respuestasH2h({ comunes: [comun({ asaltos: 0, lecturas: '' })] }),
    });
    const r = await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.cobertura.estado).toBe('pendiente');
    expect(r.cobertura.pendientes[0].estado).toBe('pendiente');
    expect(r.resumen.asaltos).toBe(0);
  });

  it('pagina con cursor ligado a pareja y filtros', async () => {
    const filasPagina = [
      asalto(BOUT3, '2026-03-02', 5, 3),
      asalto(BOUT2, '2026-02-02', 5, 4),
      asalto(BOUT1, '2026-01-02', 2, 5),
    ];
    const { ctx, sentencias } = crearContexto({
      respuestas: respuestasH2h({ asaltos: filasPagina, comunes: [comun()] }),
    });
    const primera = await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B, limite: 2 });
    if (primera.estado !== 'ok') throw new Error(primera.estado);
    expect(primera.items).toHaveLength(2);
    expect(primera.siguiente).toBeTruthy();

    const segunda = await leerCaraACara(ctx, {
      personaId: UUID_A,
      rivalId: UUID_B,
      limite: 2,
      cursor: primera.siguiente!,
    });
    expect(segunda.estado).toBe('ok');
    const ultima = sentencias.filter((s) => /ORDER BY coalesce\(b\.occurred_on/.test(s.text)).at(-1)!;
    expect(ultima.params).toContain('2026-02-02');
    expect(ultima.params).toContain(BOUT2);

    for (const otra of [
      { personaId: UUID_A, rivalId: UUID_C },
      { personaId: UUID_B, rivalId: UUID_A },
      { personaId: UUID_A, rivalId: UUID_B, temporada: '2024-2025' },
      { personaId: UUID_A, rivalId: UUID_B, fase: 'TABLEAU' },
    ]) {
      expect(
        await leerCaraACara(ctx, { ...otra, limite: 2, cursor: primera.siguiente! }),
      ).toEqual({ estado: 'cursor_invalido' });
    }
  });

  it('aplica el filtro de fase y de temporada en el SQL', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: respuestasH2h({}) });
    await leerCaraACara(ctx, {
      personaId: UUID_A,
      rivalId: UUID_B,
      fase: 'TABLEAU',
      temporada: '2025-2026',
    });
    const resumen = sentencias.find((s) => /count\(\*\) FILTER/.test(s.text))!;
    expect(resumen.text).toMatch(/b\.phase = \$/);
    expect(resumen.params).toContain('TABLEAU');
    expect(resumen.params).toContain('2025-2026');
  });
});

describe('cobertura de asaltos por prueba', () => {
  it('sin lecturas: pendiente, o parcial si ya hay asaltos', () => {
    expect(estadoAsaltosPrueba('fie', [], 0)).toBe('pendiente');
    expect(estadoAsaltosPrueba('fie', [], 2)).toBe('parcial');
  });

  it('error, conflicto o parcial impiden verificar', () => {
    for (const estado of ['error', 'conflicto', 'parcial']) {
      expect(
        estadoAsaltosPrueba(
          'fie',
          [
            { hecho: 'pools', estado: 'ok' },
            { hecho: 'tableau', estado },
          ],
          1,
        ),
      ).toBe('parcial');
    }
  });

  it('falta un hecho esperado o hay uno pendiente: no verificado', () => {
    expect(estadoAsaltosPrueba('fie', [{ hecho: 'pools', estado: 'ok' }], 0)).toBe('pendiente');
    expect(
      estadoAsaltosPrueba(
        'fie',
        [
          { hecho: 'pools', estado: 'ok' },
          { hecho: 'tableau', estado: 'pendiente' },
        ],
        4,
      ),
    ).toBe('parcial');
  });

  it('solo todo «sin_resultados» significa que no hay asaltos publicados', () => {
    const lecturas = [
      { hecho: 'pools', estado: 'sin_resultados' },
      { hecho: 'tableau', estado: 'sin_resultados' },
    ];
    expect(estadoAsaltosPrueba('fie', lecturas, 0)).toBe('sin_asaltos_publicados');
    expect(estadoAsaltosPrueba('rfee_pdf', [{ hecho: 'pdf', estado: 'ok' }], 0)).toBe('verificado');
  });

  it('resumirCobertura nunca declara exhaustivo y trunca pendientes', () => {
    const prueba = (n: number, estado: PruebaComun['estado']): PruebaComun => ({
      id: `c${n}`,
      fuente: 'fie',
      torneo: 'Copa',
      arma: 'ESPADA',
      genero: 'F',
      categoria: 'M10',
      categoriaRaw: null,
      temporada: '2025-2026',
      asaltos: 0,
      estado,
    });
    expect(resumirCobertura([], false).estado).toBe('sin_pruebas_comunes');
    expect(resumirCobertura([prueba(1, 'verificado')], false).estado).toBe('verificado');
    expect(resumirCobertura([prueba(1, 'verificado'), prueba(2, 'pendiente')], false).estado).toBe('parcial');
    expect(resumirCobertura([prueba(1, 'verificado')], true).estado).toBe('parcial');
    const muchas = Array.from({ length: 25 }, (_, i) => prueba(i, 'pendiente'));
    const c = resumirCobertura(muchas, false);
    expect(c.estado).toBe('pendiente');
    expect(c.pendientes).toHaveLength(20);
    expect(c.pendientesTruncado).toBe(true);
    expect(c.exhaustivo).toBe(false);
  });
});

describe('rivales', () => {
  it('lista rivales confirmados con asaltos y cursor ligado a la consulta', async () => {
    const { ctx, texto, sentencias } = crearContexto({
      respuestas: [
        ...sinFusiones,
        {
          cuando: /FROM sport_bout b/,
          filas: [
            { id: UUID_B, clave: 'marta ruiz', nombre: 'Marta Ruiz', pais: 'FRA', asaltos: 3 },
            { id: UUID_C, clave: 'nora diaz', nombre: 'Nora Diaz', pais: null, asaltos: 1 },
          ],
        },
      ],
    });
    const r = await listarRivales(ctx, { personaId: UUID_A, limite: 1 });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.items).toEqual([{ id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA', asaltos: 3 }]);
    expect(r.siguiente).toBeTruthy();
    expect(texto()).toMatch(/c\.format::text = 'INDIVIDUAL'/);
    for (const k of clavesDe(r)) expect(CLAVES_PRIVADAS).not.toContain(k);

    expect(await listarRivales(ctx, { personaId: UUID_A, limite: 1, q: 'otra', cursor: r.siguiente! })).toEqual({
      estado: 'cursor_invalido',
    });
    expect(
      await listarRivales(ctx, { personaId: UUID_A, limite: 1, temporada: '2024-2025', cursor: r.siguiente! }),
    ).toEqual({ estado: 'cursor_invalido' });

    const siguiente = await listarRivales(ctx, { personaId: UUID_A, limite: 1, cursor: r.siguiente! });
    expect(siguiente.estado).toBe('ok');
    const ultima = sentencias.filter((s) => /ORDER BY cp\.name_normalized/.test(s.text)).at(-1)!;
    expect(ultima.params).toContain('marta ruiz');
  });

  it('sin rivales informa sinResultados', async () => {
    const { ctx } = crearContexto({ respuestas: sinFusiones });
    const r = await listarRivales(ctx, { personaId: UUID_A });
    expect(r).toMatchObject({ estado: 'ok', items: [], sinResultados: true, siguiente: null });
  });
});
