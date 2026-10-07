import { describe, expect, it } from 'vitest';
import {
  aEncuentros,
  estadoAsaltosPrueba,
  leerCaraACara,
  leerMarcadores,
  listarRivales,
  resumirCobertura,
  type PruebaComun,
} from '@/lib/sport/explorar/cara-a-cara';
import { codificarCursor } from '@/lib/sport/explorar/cursor';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
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
    expect(sql).toMatch(/c\.format = 'INDIVIDUAL'/);
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
    expect(resumen.text).toMatch(/b\.phase = \?/);
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
            { id: UUID_B, clave: 'marta ruiz', nombre: 'Marta Ruiz', pais: 'FRA', asaltos: 3, victorias: 2, derrotas: 1 },
            { id: UUID_C, clave: 'nora diaz', nombre: 'Nora Diaz', pais: null, asaltos: 1 },
          ],
        },
      ],
    });
    const r = await listarRivales(ctx, { personaId: UUID_A, limite: 1 });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.items).toEqual([{ id: UUID_B, nombre: 'Marta Ruiz', pais: 'FRA', asaltos: 3, victorias: 2, derrotas: 1 }]);
    expect(r.siguiente).toBeTruthy();
    expect(texto()).toMatch(/c\.format = 'INDIVIDUAL'/);
    for (const k of clavesDe(r)) expect(CLAVES_PRIVADAS).not.toContain(k);

    expect(await listarRivales(ctx, { personaId: UUID_A, limite: 1, q: 'otra', cursor: r.siguiente! })).toEqual({
      estado: 'cursor_invalido',
    });
    expect(
      await listarRivales(ctx, { personaId: UUID_A, limite: 1, temporada: '2024-2025', cursor: r.siguiente! }),
    ).toEqual({ estado: 'cursor_invalido' });

    // De más a menos asaltos; el cursor lleva (asaltos, nombre, id) y se compara tras contar.
    const siguiente = await listarRivales(ctx, { personaId: UUID_A, limite: 1, cursor: r.siguiente! });
    if (siguiente.estado !== 'ok') throw new Error(siguiente.estado);
    expect(siguiente.items.map((x) => x.id)).toEqual([UUID_C]);
    expect(siguiente.siguiente).toBeNull();
    // Mismos marcadores que el cara a cara: sólo asaltos individuales.
    expect(sentencias.some((s) => /max\(b\.score_a, b\.score_b\) <= \d+/.test(s.text))).toBe(true);
  });

  it('un cursor de la ordenación alfabética anterior ya no vale', async () => {
    const { ctx } = crearContexto({ respuestas: sinFusiones });
    const antiguo = codificarCursor('rivales', { personaId: UUID_A, q: undefined }, ['marta ruiz', UUID_B]);
    expect(await listarRivales(ctx, { personaId: UUID_A, cursor: antiguo })).toEqual({ estado: 'cursor_invalido' });
  });

  it('sin rivales informa sinResultados', async () => {
    const { ctx } = crearContexto({ respuestas: sinFusiones });
    const r = await listarRivales(ctx, { personaId: UUID_A });
    expect(r).toMatchObject({ estado: 'ok', items: [], sinResultados: true, siguiente: null });
  });
});

describe('pruebas comunes repetidas por dos fuentes', () => {
  const S = '\u001f';
  const R = '\u001e';
  const fila = (extra: Record<string, unknown>) => ({
    id: 'x', fuente: 'skermo_rfee', torneo: 'TNR ABS', arma: 'FLORETE' as const, genero: 'M' as const,
    categoria: 'ABS', categoriaRaw: null, formato: 'INDIVIDUAL' as const, temporada: '2023-2024',
    lecturas: '', equivalencia: null, edicionId: 'ed', fecha: '2024-03-03', asaltos: 0,
    ...extra,
  });

  it('el mismo TNR con dos nombres y los mismos puestos cuenta una vez, con los asaltos de cualquiera', () => {
    const { encuentros, resumen } = aEncuentros([
      fila({ id: 'pdf', fuente: 'rfee_pdf', torneo: 'TNR ABS', puestoYo: 15, puestoRival: 19, asaltos: 1, directaV: 1, marcadores: `TABLEAU${S}A32${S}15${S}13` }),
      fila({ id: 'skermo', torneo: 'TNR ABS (3/3)', puestoYo: 15, puestoRival: 19 }),
    ], false);
    expect(encuentros).toHaveLength(1);
    expect(encuentros[0]).toMatchObject({
      pruebaId: 'pdf', equivalentes: ['skermo'], delante: 'yo',
      puestos: { yo: 15, rival: 19 },
      marcadores: [{ fase: 'TABLEAU', ronda: 'A32', mios: 15, rival: 13 }],
    });
    expect(resumen).toMatchObject({ competiciones: 1, conAmbosPuestos: 1, delanteYo: 1, directa: { victorias: 1, derrotas: 0 } });
  });

  it('una lectura con la clasificación y otra «sin puesto» con la poule se funden: puestos de una, asaltos de la otra', () => {
    const { encuentros } = aEncuentros([
      fila({ id: 'clasif', torneo: 'CAMPEONATO DE ESPAÑA ABSOLUTO', fecha: '2024-06-08', puestoYo: 8, puestoRival: 11 }),
      fila({
        id: 'poule', fuente: 'rfee_pdf', torneo: 'CAMPEONATO DE ESPAÑA ABSOLUTO', fecha: '2024-06-09',
        asaltos: 1, pouleD: 1, marcadores: `POULE${S}P3${S}1${S}5`,
      }),
    ], false);
    expect(encuentros).toHaveLength(1);
    expect(encuentros[0]).toMatchObject({
      pruebaId: 'clasif', fecha: '2024-06-08', puestos: { yo: 8, rival: 11 }, delante: 'yo',
      asaltos: { total: 1, poule: { victorias: 0, derrotas: 1 } },
      marcadores: [{ fase: 'POULE', ronda: 'P3', mios: 1, rival: 5 }],
    });
  });

  it('no funde pruebas distintas: otro día, otra categoría, otra arma, puestos que se contradicen o sin puestos en ninguna', () => {
    const { encuentros } = aEncuentros([
      fila({ id: 'base', puestoYo: 15, puestoRival: 19 }),
      fila({ id: 'dos-dias', fecha: '2024-03-05', puestoYo: 15, puestoRival: 19 }),
      fila({ id: 'm23', categoria: 'M23', puestoYo: 15, puestoRival: 19 }),
      fila({ id: 'espada', arma: 'ESPADA', puestoYo: 15, puestoRival: 19 }),
      fila({ id: 'satelite', fecha: '2024-03-02', puestoYo: 32, puestoRival: 48 }),
      fila({ id: 'medio', fecha: '2024-03-02', puestoYo: 15, puestoRival: 20 }),
      fila({ id: 'sin-a', fecha: '2025-01-01', asaltos: 1 }),
      fila({ id: 'sin-b', fecha: '2025-01-01', asaltos: 1 }),
    ], false);
    expect(encuentros.map((e) => e.pruebaId)).toEqual(['base', 'dos-dias', 'm23', 'espada', 'satelite', 'medio', 'sin-a', 'sin-b']);
  });

  it('a un día y con un solo puesto en común también es la misma prueba, y el puesto que falta se completa', () => {
    const { encuentros } = aEncuentros([
      fila({ id: 'a', fecha: '2024-03-04', puestoYo: 15, puestoRival: null }),
      fila({ id: 'b', fecha: '2024-03-03', puestoYo: 15, puestoRival: 19 }),
    ], false);
    expect(encuentros.map((e) => [e.pruebaId, e.puestos.yo, e.puestos.rival, e.delante])).toEqual([['b', 15, 19, 'yo']]);
  });

  it('los marcadores se leen en orden de torneo y el filtro de fase los limita', () => {
    const texto = [`TABLEAU${S}A2${S}15${S}14`, `POULE${S}P1${S}5${S}2`, `TABLEAU${S}A16${S}15${S}9`, 'roto'].join(R);
    expect(leerMarcadores(texto).map((m) => m.ronda)).toEqual(['P1', 'A16', 'A2']);
    expect(leerMarcadores(null)).toEqual([]);
    const { encuentros } = aEncuentros([fila({ asaltos: 3, puestoYo: 1, puestoRival: 2, marcadores: texto })], false, 'POULE');
    expect(encuentros[0].marcadores.map((m) => m.ronda)).toEqual(['P1']);
  });

  it('descarta las lecturas repetidas salvo la que aporta los asaltos, aunque no sea la base', () => {
    const misma = aEncuentros([
      fila({ id: 'pdf', fuente: 'rfee_pdf', puestoYo: 15, puestoRival: 19, asaltos: 1, directaV: 1 }),
      fila({ id: 'skermo', torneo: 'TNR ABS (3/3)', puestoYo: 15, puestoRival: 19, asaltos: 1, directaV: 1 }),
      fila({ id: 'sola', fecha: '2025-01-01', puestoYo: 3, puestoRival: 5, asaltos: 1 }),
    ], false);
    expect(misma.encuentros.map((e) => e.pruebaId)).toEqual(['pdf', 'sola']);
    expect(misma.descartadas).toEqual(['skermo']);

    const repartida = aEncuentros([
      fila({ id: 'clasif', puestoYo: 8, puestoRival: 11 }),
      fila({ id: 'poule', fuente: 'rfee_pdf', asaltos: 1, pouleD: 1 }),
    ], false);
    expect(repartida.encuentros[0].pruebaId).toBe('clasif');
    expect(repartida.descartadas).toEqual(['clasif']);
    expect(aEncuentros([fila({ id: 'sola', puestoYo: 1, puestoRival: 2 })], false).descartadas).toEqual([]);
  });

  it('el resumen y la lista de asaltos excluyen las lecturas descartadas; sin repetidas no hay exclusión', async () => {
    const repetidas = [
      comun({ id: 'pdf', fuente: 'rfee_pdf', formato: 'INDIVIDUAL', fecha: '2024-03-03', puestoYo: 15, puestoRival: 19, asaltos: 1 }),
      comun({ id: 'skermo', fuente: 'skermo_rfee', formato: 'INDIVIDUAL', fecha: '2024-03-04', puestoYo: 15, puestoRival: 19, asaltos: 1 }),
    ];
    const { ctx, sentencias } = crearContexto({ respuestas: respuestasH2h({ comunes: repetidas }) });
    const r = await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.encuentros).toHaveLength(1);
    const deAsaltos = sentencias.filter((s) => /count\(\*\) FILTER|ORDER BY coalesce\(b\.occurred_on/.test(s.text));
    expect(deAsaltos).toHaveLength(2);
    for (const s of deAsaltos) {
      expect(s.text).toMatch(/b\.competition_id NOT IN \(SELECT value FROM json_each/);
      expect(s.params).toContain(JSON.stringify(['skermo']));
    }

    const unica = crearContexto({ respuestas: respuestasH2h({ comunes: [comun()] }) });
    await leerCaraACara(unica.ctx, { personaId: UUID_A, rivalId: UUID_B });
    expect(unica.texto()).not.toMatch(/NOT IN/);
  });

  it('un relevo publicado dentro de una prueba individual no cuenta como asalto en ninguna consulta', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: respuestasH2h({}) });
    await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B });
    const consultas = sentencias.filter((s) => /count\(\*\) FILTER|ORDER BY coalesce\(b\.occurred_on|WITH comunes/.test(s.text));
    expect(consultas).toHaveLength(3);
    for (const s of consultas) expect(s.text).toContain('max(b.score_a, b.score_b) <= 15');
    const comunes = consultas.find((s) => /WITH comunes/.test(s.text))!;
    expect(comunes.text).toMatch(/duelos AS MATERIALIZED \([\s\S]*max\(b\.score_a, b\.score_b\) <= 15[\s\S]*GROUP BY b\.competition_id/);
  });

  it('la consulta de pruebas comunes trae los marcadores orientados y el formato', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: respuestasH2h({}) });
    await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B });
    const comunes = sentencias.find((s) => /WITH comunes/.test(s.text))!;
    expect(comunes.text).toMatch(/group_concat\(b\.phase \|\| char\(31\)/);
    expect(comunes.text).toMatch(/c\.format AS formato/);
  });
});
describe('cara a cara contra SQLite real: repetidas y relevos', () => {
  it('el mismo duelo publicado por dos fuentes cuenta una vez y un relevo no cuenta', async () => {
    const local = localD1();
    try {
      const s = local.sqlite;
      const ctx = { ...crearContexto().ctx, db: createD1Database(local.binding) };
      for (const [id, nombre] of [[UUID_A, 'Lucia Garcia'], [UUID_B, 'Marta Ruiz']]) {
        s.prepare(`INSERT INTO sport_person (id,display_name,name_normalized,country_code,gender,birth_year)
          VALUES (?,?,?,'ESP','F',2000)`).run(id, nombre, nombre.toLowerCase());
      }
      const prueba = (id: string, fuente: string, nombre: string, fecha: string) => {
        s.prepare(`INSERT INTO sport_edition (id,source,season,tournament_key,name,start_date)
          VALUES (?,?,'2023-2024',?,?,?)`).run(`ed-${id}`, fuente, `ed-${id}`, nombre, fecha);
        s.prepare(`INSERT INTO sport_competition (id,edition_id,source,season,competition_key,weapon,gender,category,format,competition_date)
          VALUES (?,?,?,'2023-2024',?,'FLORETE','F','ABS','INDIVIDUAL',?)`).run(id, `ed-${id}`, fuente, id, fecha);
      };
      const puesto = (prueba: string, fuente: string, persona: string, n: number) => {
        s.prepare(`INSERT INTO sport_result (id,competition_id,source,source_fact_key,person_id,source_name,source_country_code,position,content_hash)
          VALUES (?,?,?,?,?,'Nombre','ESP',?,'hash')`).run(`${prueba}-${persona}`, prueba, fuente, `${prueba}-${persona}`, persona, n);
      };
      const asalto = s.prepare(`INSERT INTO sport_bout
        (id,competition_id,source,phase,round_key,fencer_a_ref,fencer_b_ref,fencer_a_person_id,fencer_b_person_id,
        fencer_a_name,fencer_b_name,score_a,score_b,content_hash)
        VALUES (?,?,?,?,?,'a','b',?,?,'A','B',?,?,'hash')`);
      prueba('pdf', 'rfee_pdf', 'TNR ABS', '2024-03-03');
      prueba('skermo', 'skermo_rfee', 'TNR ABS (3/3)', '2024-03-04');
      for (const [p, f] of [['pdf', 'rfee_pdf'], ['skermo', 'skermo_rfee']]) {
        puesto(p, f, UUID_A, 15);
        puesto(p, f, UUID_B, 19);
        asalto.run(`${p}-poule`, p, f, 'POULE', 'P3', UUID_A, UUID_B, 5, 3);
        asalto.run(`${p}-directa`, p, f, 'TABLEAU', 'A32', UUID_B, UUID_A, 15, 13);
      }
      asalto.run('pdf-relevo', 'pdf', 'rfee_pdf', 'TABLEAU', 'A16', UUID_A, UUID_B, 45, 40);

      const r = await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B });
      if (r.estado !== 'ok') throw new Error(r.estado);
      expect(r.encuentros).toHaveLength(1);
      expect(r.encuentros![0]).toMatchObject({
        asaltos: { total: 2, poule: { victorias: 1, derrotas: 0 }, directa: { victorias: 0, derrotas: 1 } },
      });
      expect(r.encuentros![0].marcadores).toHaveLength(2);
      expect(r.resumen).toEqual({ asaltos: 2, victorias: 1, derrotas: 1, sinDecidir: 0, tantosFavor: 18, tantosContra: 18 });
      expect(r.items.map((a) => a.marcador)).toHaveLength(2);
      expect(new Set(r.items.map((a) => a.prueba.id)).size).toBe(1);
    } finally {
      local.close();
    }
  });
});

describe('cara a cara por ámbito', () => {
  function cargar() {
    const local = localD1();
    const s = local.sqlite;
    for (const [id, nombre] of [[UUID_A, 'Lucia Garcia'], [UUID_B, 'Marta Ruiz']]) {
      s.prepare(`INSERT INTO sport_person (id,display_name,name_normalized,country_code,gender,birth_year)
        VALUES (?,?,?,'ESP','F',2000)`).run(id, nombre, nombre.toLowerCase());
    }
    const prueba = (id: string, fuente: string, nombre: string, fecha: string, pais: string | null) => {
      s.prepare(`INSERT INTO sport_edition (id,source,season,tournament_key,name,start_date,country_code)
        VALUES (?,?,'2023-2024',?,?,?,?)`).run(`ed-${id}`, fuente, `ed-${id}`, nombre, fecha, pais);
      s.prepare(`INSERT INTO sport_competition (id,edition_id,source,season,competition_key,weapon,gender,category,format,competition_date)
        VALUES (?,?,?,'2023-2024',?,'FLORETE','F','ABS','INDIVIDUAL',?)`).run(id, `ed-${id}`, fuente, id, fecha);
    };
    const asalto = s.prepare(`INSERT INTO sport_bout
      (id,competition_id,source,phase,round_key,fencer_a_ref,fencer_b_ref,fencer_a_person_id,fencer_b_person_id,
      fencer_a_name,fencer_b_name,score_a,score_b,content_hash)
      VALUES (?,?,?,?,?,'a','b',?,?,'A','B',?,?,'hash')`);
    prueba('tnr', 'rfee_pdf', 'TNR ABS', '2024-03-03', 'ESP');
    prueba('copa', 'fie', 'Coupe du Monde', '2024-01-20', 'FRA');
    prueba('efc', 'efc', 'European Cup', '2023-11-12', 'ITA');
    asalto.run('tnr-p', 'tnr', 'rfee_pdf', 'POULE', 'P1', UUID_A, UUID_B, 5, 3);
    asalto.run('tnr-d', 'tnr', 'rfee_pdf', 'TABLEAU', 'A16', UUID_B, UUID_A, 15, 10);
    asalto.run('copa-p', 'copa', 'fie', 'POULE', 'P2', UUID_A, UUID_B, 5, 4);
    asalto.run('efc-d', 'efc', 'efc', 'TABLEAU', 'A32', UUID_A, UUID_B, 15, 12);
    return { local, ctx: { ...crearContexto().ctx, db: createD1Database(local.binding) } };
  }

  it('cada ámbito da su recuento en balance, asaltos y pruebas; un asalto EFC es internacional', async () => {
    const { local, ctx } = cargar();
    try {
      const leer = async (ambito?: string) => {
        const r = await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B, ...(ambito ? { ambito } : {}) });
        if (r.estado !== 'ok') throw new Error(r.estado);
        return r;
      };
      const todos = await leer();
      const nacional = await leer('nacional');
      const internacional = await leer('internacional');
      expect(todos.resumen).toMatchObject({ asaltos: 4, victorias: 3, derrotas: 1 });
      expect(nacional.resumen).toMatchObject({ asaltos: 2, victorias: 1, derrotas: 1 });
      expect(internacional.resumen).toMatchObject({ asaltos: 2, victorias: 2, derrotas: 0 });
      expect(nacional.items.map((a) => a.id).sort()).toEqual(['tnr-d', 'tnr-p']);
      expect(internacional.items.map((a) => a.id)).toEqual(['copa-p', 'efc-d']);
      expect(internacional.encuentros!.map((e) => e.pruebaId)).toEqual(['copa', 'efc']);
      expect(nacional.encuentros!.map((e) => e.pruebaId)).toEqual(['tnr']);
      expect(internacional.cobertura.pruebasComunes).toBe(2);
      expect(internacional.resumenEncuentros!.directa).toEqual({ victorias: 1, derrotas: 0 });
    } finally {
      local.close();
    }
  });

  it('filtra en las mismas consultas, valida el valor y liga el cursor al ámbito', async () => {
    const sin = crearContexto({ respuestas: respuestasH2h({ comunes: [comun()] }) });
    await leerCaraACara(sin.ctx, { personaId: UUID_A, rivalId: UUID_B });
    const con = crearContexto({ respuestas: respuestasH2h({ comunes: [comun()] }) });
    await leerCaraACara(con.ctx, { personaId: UUID_A, rivalId: UUID_B, ambito: 'internacional' });
    expect(con.sentencias).toHaveLength(sin.sentencias.length);
    const deAsaltos = con.sentencias.filter((s) => /count\(\*\) FILTER|ORDER BY coalesce\(b\.occurred_on/.test(s.text));
    for (const s of deAsaltos) expect(s.params).toContain(JSON.stringify(['c1']));
    expect(sin.texto()).not.toMatch(/b\.competition_id IN \(SELECT value/);

    const { ctx } = crearContexto();
    expect(await leerCaraACara(ctx, { personaId: UUID_A, rivalId: UUID_B, ambito: 'AUTONOMICO' })).toEqual({ estado: 'entrada_invalida' });
    const huella = { personaId: UUID_A, rivalId: UUID_B };
    const cursor = codificarCursor('h2h', huella, ['2024-01-01', BOUT1]);
    expect(await leerCaraACara(ctx, { ...huella, ambito: 'nacional', cursor })).toEqual({ estado: 'cursor_invalido' });
  });
});
