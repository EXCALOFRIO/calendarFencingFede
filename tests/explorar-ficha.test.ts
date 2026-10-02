import { describe, expect, it } from 'vitest';
import { codificarCursor } from '@/lib/sport/explorar/cursor';
import {
  aEntradaRanking,
  aEstadisticas,
  fechaRanking,
  leerFicha,
  leerHistorial,
} from '@/lib/sport/explorar/ficha';
import { resolverPersonaPropia } from '@/lib/sport/explorar/propietario';
import {
  ABIERTO,
  CLAVES_PRIVADAS,
  UUID_A,
  UUID_B,
  UUID_C,
  clavesDe,
  crearContexto,
  personaSimple,
} from './helpers/explorar';

/**
 * Ficha deportiva e historial con contexto controlado (SQL registrado, filas
 * fijadas por el caso). No hay sesión Neon Auth real ni PostgreSQL: se prueban
 * las guardas, qué se consulta, la atribución de identidad y la forma del DTO.
 */

const atleta = (id = 'ath-1') => ({
  id,
  rfeeLicense: null,
  rfeeValidUntil: null,
  fieLicense: null,
  fieValidUntil: null,
});

const cabecera = (id: string, nombre = 'Lucia Garcia') => ({
  cuando: /display_name AS nombre/,
  filas: [{ id, nombre, pais: 'ESP', genero: 'F', anioNacimiento: 1990 }],
});

const resumenVacio = [
  { cuando: /una_por_prueba/, filas: [] },
  { cuando: /count\(DISTINCT c\.edition_id\)/, filas: [{ resultados: 0, pruebas: 0, ediciones: 0 }] },
  { cuando: /FROM sport_import_coverage cov/, filas: [] },
  { cuando: /GROUP BY p\.season/, filas: [] },
  { cuando: /FROM sport_person_alias/, filas: [] },
];

const filaRanking = (
  temporada: string,
  puesto: number | null,
  extra: Record<string, unknown> = {},
) => ({
  id: `pub-${temporada}`,
  source: 'skermo_ranking',
  season: temporada,
  weapon: 'ESPADA',
  gender: 'F',
  category: 'M10',
  categoryRaw: 'M-10',
  format: 'INDIVIDUAL',
  publishedOn: '2026-05-10',
  publishedTotal: 120,
  sourceUrl: 'https://example.test/ranking',
  sourceRef: 'skermo:1',
  position: puesto,
  points: puesto === null ? null : '12.500',
  ...extra,
});

describe('guardas y propiedad de la ficha', () => {
  it('sin sesión, o con acceso revocado, no consulta nada', async () => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    await expect(leerFicha(ctx, { personaId: UUID_A })).rejects.toThrow('NO_AUTENTICADO');
    await expect(leerHistorial(ctx, { personaId: UUID_A })).rejects.toThrow('NO_AUTENTICADO');
    expect(sentencias).toHaveLength(0);
  });

  it('«mi perfil» sin persona confirmada no adjudica un homónimo y no lee hechos', async () => {
    const { ctx, texto } = crearContexto({
      propietario: { atletasDeCuenta: async () => [atleta()] },
      respuestas: [cabecera(UUID_B, 'Lucia Garcia')],
    });
    const r = await leerFicha(ctx, {});
    expect(r).toEqual({ estado: 'propia_no_confirmada', motivo: 'sin_vinculo' });
    expect(texto()).not.toMatch(/sport_result|sport_bout|sport_ranking/);
  });

  it('una cuenta sin ficha de tirador distingue «sin ficha» de «sin vínculo»', async () => {
    const { ctx } = crearContexto();
    expect(await leerFicha(ctx, {})).toEqual({ estado: 'propia_no_confirmada', motivo: 'sin_ficha' });
  });

  it('el enlace directo ficha→persona confirma la propia y marca esPropia', async () => {
    const { ctx } = crearContexto({
      propietario: {
        atletasDeCuenta: async () => [atleta()],
        personasEnlazadas: async () => [{ personId: UUID_A, athleteId: 'ath-1' }],
      },
      respuestas: [...personaSimple(UUID_A), cabecera(UUID_A), ...resumenVacio],
    });
    const r = await leerFicha(ctx, {});
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.ficha).toMatchObject({ id: UUID_A, esPropia: true });
  });

  it('la evidencia ID FIE confirmada con ida y vuelta establece la propiedad', async () => {
    const { ctx } = crearContexto({
      propietario: {
        atletasDeCuenta: async () => [atleta()],
        fichasFiePorAtleta: async () => [{ fieId: 123, fieLicense: null }],
        evidencia: {
          esquema: async () => ABIERTO,
          atletasPorLicencia: async () => [],
          fichasFie: async () => [],
          externos: async () => [
            {
              personId: UUID_A,
              scheme: 'fie_addr_id',
              value: '123',
              scopeSource: 'fie',
              scopeFederation: '',
              scopeSeason: '',
              scopeWeapon: '',
              validFrom: '1900-01-01',
              validTo: null,
              linkStatus: 'CONFIRMADO',
            },
          ],
          personas: async () => new Map([[UUID_A, { athleteId: 'ath-1', mergedIntoPersonId: null }]]),
        },
      },
      respuestas: personaSimple(UUID_A),
    });
    expect(await resolverPersonaPropia(ctx, 'perfil')).toEqual({ estado: 'confirmada', personaId: UUID_A });
  });

  it('una persona enlazada a OTRA ficha, o un conflicto de IDs, no establecen propiedad', async () => {
    const externo = (personId: string) => ({
      personId,
      scheme: 'fie_addr_id',
      value: '123',
      scopeSource: 'fie',
      scopeFederation: '',
      scopeSeason: '',
      scopeWeapon: '',
      validFrom: '1900-01-01',
      validTo: null,
      linkStatus: 'CONFIRMADO' as const,
    });
    const base = {
      atletasDeCuenta: async () => [atleta()],
      fichasFiePorAtleta: async () => [{ fieId: 123, fieLicense: null }],
    };

    const deOtraFicha = crearContexto({
      propietario: {
        ...base,
        evidencia: {
          esquema: async () => ABIERTO,
          atletasPorLicencia: async () => [],
          fichasFie: async () => [],
          externos: async () => [externo(UUID_A)],
          personas: async () => new Map([[UUID_A, { athleteId: 'ath-2', mergedIntoPersonId: null }]]),
        },
      },
      respuestas: personaSimple(UUID_A),
    });
    expect((await resolverPersonaPropia(deOtraFicha.ctx, 'p')).estado).toBe('sin_vinculo');

    const conflicto = crearContexto({
      propietario: {
        ...base,
        personasEnlazadas: async () => [{ personId: UUID_A, athleteId: 'ath-1' }],
        evidencia: {
          esquema: async () => ABIERTO,
          atletasPorLicencia: async () => [],
          fichasFie: async () => [],
          externos: async () => [externo(UUID_A), externo(UUID_B)],
          personas: async () =>
            new Map([
              [UUID_A, { athleteId: 'ath-1', mergedIntoPersonId: null }],
              [UUID_B, { athleteId: null, mergedIntoPersonId: null }],
            ]),
        },
      },
      respuestas: personaSimple(UUID_A),
    });
    expect((await resolverPersonaPropia(conflicto.ctx, 'p')).estado).toBe('conflicto');
  });

  it('dos personas candidatas distintas dejan la cuenta ambigua, sin elegir la primera', async () => {
    const { ctx } = crearContexto({
      propietario: {
        atletasDeCuenta: async () => [atleta('ath-1'), atleta('ath-2')],
        personasEnlazadas: async () => [
          { personId: UUID_A, athleteId: 'ath-1' },
          { personId: UUID_B, athleteId: 'ath-2' },
        ],
      },
      respuestas: [
        {
          cuando: /WITH RECURSIVE cadena/,
          filas: (s) => [{ id: String(s.params[0]) }],
        },
        ...personaSimple(UUID_A).slice(1),
      ],
    });
    expect((await resolverPersonaPropia(ctx, 'p')).estado).toBe('ambigua');
  });
});

describe('ficha ajena: sólo hechos deportivos', () => {
  it('no incluye datos de cuenta, ranking interno ni lee tablas privadas', async () => {
    const { ctx, texto } = crearContexto({
      respuestas: [
        ...personaSimple(UUID_A),
        cabecera(UUID_A, 'Retirada Sin Cuenta'),
        { cuando: /FROM sport_person_alias/, filas: [{ nombre: 'Retirada Sin Cuenta' }, { nombre: 'GARCIA Lucia' }] },
        { cuando: /una_por_prueba/, filas: [] },
        { cuando: /count\(DISTINCT c\.edition_id\)/, filas: [{ resultados: 4, pruebas: 4, ediciones: 3 }] },
        { cuando: /FROM sport_import_coverage cov/, filas: [{ hecho: 'ranking', estado: 'completo', pruebas: 3 }] },
        { cuando: /GROUP BY p\.season/, filas: [] },
      ],
    });
    const r = await leerFicha(ctx, { personaId: UUID_A });
    if (r.estado !== 'ok') throw new Error(r.estado);

    expect(r.ficha).toMatchObject({ esPropia: false, alias: ['GARCIA Lucia'], anioNacimiento: 1990 });
    expect(r.ficha.cobertura).toEqual({
      resultadosImportados: 4,
      pruebasConResultado: 4,
      ediciones: 3,
      lecturas: [{ hecho: 'ranking', estado: 'completo', pruebas: 3 }],
      historiaCompleta: false,
    });
    const claves = clavesDe(r);
    for (const privada of CLAVES_PRIVADAS) expect(claves.has(privada)).toBe(false);
    expect(texto()).not.toMatch(
      /user_profile|\bathlete\b|competition_registration|ranking_snapshot|ranking_point|consent|guardian/,
    );
  });

  it('un id inexistente es no_encontrada y no consulta hechos', async () => {
    const { ctx, texto } = crearContexto();
    expect(await leerFicha(ctx, { personaId: UUID_C })).toEqual({ estado: 'no_encontrada' });
    expect(texto()).not.toMatch(/sport_result|sport_bout/);
  });

  it('lee todos los IDs de una persona fusionada, no sólo el pedido', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [...personaSimple(UUID_B, [UUID_B, UUID_C]), cabecera(UUID_B), ...resumenVacio],
    });
    const r = await leerFicha(ctx, { personaId: UUID_C });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.ficha.id).toBe(UUID_B);
    const stats = sentencias.find((s) => /una_por_prueba/.test(s.text))!;
    expect(stats.params).toEqual(expect.arrayContaining([UUID_B, UUID_C]));
  });
});

describe('estadísticas por tipo documentado', () => {
  it('agrupa por tipo, deja los no documentados aparte y no cuenta puestos ausentes como derrotas', () => {
    const r = aEstadisticas([
      { tipo: null, clasificaciones: 2, mejorPuesto: 9, podios: 0, victorias: 0, sinPuesto: 1 },
      { tipo: 'SEN_WC', clasificaciones: 3, mejorPuesto: 1, podios: 2, victorias: 1, sinPuesto: 0 },
      { tipo: 'CTO_EUROPA', clasificaciones: 1, mejorPuesto: 5, podios: 0, victorias: 0, sinPuesto: 0 },
    ]);
    expect(r.map((x) => x.tipo)).toEqual(['CTO_EUROPA', 'SEN_WC', null]);
    expect(r[2]).toMatchObject({ clasificaciones: 2, sinPuestoNumerico: 1 });
  });

  it('la consulta usa sólo clasificaciones individuales, una por prueba, sin inscripciones y sin deducir tipo por el título', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [
        ...personaSimple(UUID_A),
        cabecera(UUID_A),
        ...resumenVacio.filter((x) => !/una_por_prueba/.test(String(x.cuando))),
        {
          cuando: /una_por_prueba/,
          filas: [
            { tipo: 'SEN_WC', clasificaciones: 2, mejorPuesto: 3, podios: 1, victorias: 0, sinPuesto: 0 },
            { tipo: null, clasificaciones: 1, mejorPuesto: 12, podios: 0, victorias: 0, sinPuesto: 1 },
          ],
        },
      ],
    });
    const r = await leerFicha(ctx, { personaId: UUID_A });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.ficha.estadisticas.conjunto).toBe('clasificaciones_individuales');
    expect(r.ficha.estadisticas.porTipo).toHaveLength(2);

    const sql = sentencias.find((s) => /una_por_prueba/.test(s.text))!.text;
    expect(sql).toMatch(/DISTINCT ON \(r\.competition_id\)/);
    expect(sql).toMatch(/c\.format::text = 'INDIVIDUAL'/);
    expect(sql).not.toMatch(/competition_registration|e\.name|ILIKE|LIKE/);
    // Sólo el circuito del calendario vinculado documenta el tipo.
    expect(sql).toMatch(/NOT IN \('FIE_CIRCUITO', 'OTRO'\)/);
  });
});

describe('ranking oficial con temporada y modalidad explícitas', () => {
  it('distingue dos temporadas, conserva null y presenta la fecha como base de lectura', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [
        ...personaSimple(UUID_A),
        cabecera(UUID_A),
        ...resumenVacio.filter((x) => !/GROUP BY p\\\.season/.test(String(x.cuando))),
        { cuando: /GROUP BY p\.season/, filas: [{ temporada: '2025-2026' }, { temporada: '2024-2025' }] },
        {
          cuando: /WITH elegidas/,
          filas: (s) =>
            s.params.includes('2024-2025')
              ? [filaRanking('2024-2025', 9)]
              : [filaRanking('2025-2026', null)],
        },
      ],
    });

    const actual = await leerFicha(ctx, { personaId: UUID_A });
    const anterior = await leerFicha(ctx, { personaId: UUID_A, temporadaRanking: '2024-2025' });
    if (actual.estado !== 'ok' || anterior.estado !== 'ok') throw new Error('sin ficha');

    expect(actual.ficha.rankingOficial).toMatchObject({
      temporada: '2025-2026',
      formato: 'INDIVIDUAL',
      temporadasDisponibles: ['2025-2026', '2024-2025'],
    });
    expect(actual.ficha.rankingOficial.entradas[0]).toMatchObject({ puesto: null, puntos: null });
    expect(anterior.ficha.rankingOficial.entradas[0]).toMatchObject({ temporada: '2024-2025', puesto: 9 });

    const lecturas = sentencias.filter((s) => /WITH elegidas/.test(s.text));
    expect(lecturas).toHaveLength(2);
    expect(lecturas[0].params).toEqual(expect.arrayContaining(['2025-2026', 'INDIVIDUAL']));
    expect(lecturas[1].params).toEqual(expect.arrayContaining(['2024-2025', 'INDIVIDUAL']));
    // Una sola sentencia por snapshot, con la misma elección que el lector de listas.
    expect(lecturas[0].text).toMatch(/ORDER BY p\.source, p\.weapon, p\.gender, p\.category_raw, p\.format,\s+p\.published_on DESC, p\.fetched_at DESC, p\.id DESC/);
    expect(sentencias.map((s) => s.text).join('\n')).not.toMatch(/ranking_snapshot|ranking_point/);
  });

  it('la fecha de RFEE/FIE es observada: sourcePublishedOn desconocida, nunca una fecha histórica inventada', () => {
    expect(fechaRanking('2026-05-10')).toEqual({
      sourcePublishedOn: null,
      observedOn: '2026-05-10',
      baseLectura: true,
    });
    const entrada = aEntradaRanking({
      publicacion: {
        id: 'p',
        source: 'fie_tiradores',
        season: '2024',
        weapon: 'SABLE',
        gender: 'M',
        category: 'ABS',
        categoryRaw: 'Senior',
        format: 'INDIVIDUAL',
        publishedOn: '2026-05-10',
        publishedTotal: null,
        sourceUrl: null,
      },
      sourceRef: 'fie:1',
      position: 4,
      points: '10.000',
    });
    expect(entrada.fecha.sourcePublishedOn).toBeNull();
    expect(entrada.categoria).toEqual({ codigo: 'ABS', raw: 'Senior' });
  });

  it('sin ranking no se inventa temporada: devuelve lista vacía y no lanza la lectura de snapshot', async () => {
    const { ctx, sentencias } = crearContexto({
      respuestas: [...personaSimple(UUID_A), cabecera(UUID_A), ...resumenVacio],
    });
    const r = await leerFicha(ctx, { personaId: UUID_A });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.ficha.rankingOficial).toMatchObject({ temporada: null, entradas: [] });
    expect(sentencias.some((s) => /WITH elegidas/.test(s.text))).toBe(false);
  });
});

describe('historial paginado', () => {
  const filaHistorial = (id: string, fecha: string | null, extra: Record<string, unknown> = {}) => ({
    id,
    puesto: 3,
    puestoPublicado: null,
    puntos: null,
    fuente: 'skermo',
    enlace: null,
    torneoId: 'ed-1',
    torneo: 'Open Madrid',
    ciudad: 'Madrid',
    paisTorneo: 'ESP',
    tipo: null,
    pruebaId: 'c-1',
    arma: 'ESPADA',
    genero: 'F',
    categoria: 'M12',
    categoriaRaw: 'M-12',
    formato: 'INDIVIDUAL',
    temporada: '2025-2026',
    fecha,
    fechaOrden: fecha ?? '0001-01-01',
    ...extra,
  });

  it('conserva M12 y category_raw, puestos sin numerar y fecha desconocida', async () => {
    const { ctx } = crearContexto({
      respuestas: [
        ...personaSimple(UUID_A),
        {
          cuando: /FROM sport_result r/,
          filas: [
            filaHistorial('00000000-0000-4000-8000-000000000001', '2026-03-01'),
            filaHistorial('00000000-0000-4000-8000-000000000002', null, {
              puesto: null,
              puestoPublicado: 'Abandono',
              tipo: 'CTO_EUROPA',
            }),
          ],
        },
      ],
    });
    const r = await leerHistorial(ctx, { personaId: UUID_A });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.items[0].prueba.categoria).toEqual({ codigo: 'M12', raw: 'M-12' });
    expect(r.items[1]).toMatchObject({
      puesto: null,
      puestoPublicado: 'Abandono',
      fecha: null,
      tipoDocumentado: 'CTO_EUROPA',
    });
    for (const privada of CLAVES_PRIVADAS) expect(clavesDe(r).has(privada)).toBe(false);
  });

  it('mismo torneo en otro año: temporada y torneo se filtran sobre la misma fila', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: personaSimple(UUID_A) });
    await leerHistorial(ctx, { personaId: UUID_A, torneo: 'Open Madrid', temporada: '2025-2026' });
    const s = sentencias.find((x) => /FROM sport_result r/.test(x.text))!;
    expect(s.text).toMatch(/c\.season = \$\d+/);
    expect(s.text).toMatch(/LIKE \$\d+/);
    expect(s.params).toEqual(expect.arrayContaining(['2025-2026', '%open madrid%']));
    expect(s.text).not.toMatch(/competition_registration/);
  });

  it('pagina por (fecha, id) y rechaza el cursor de otra persona o de otros filtros', async () => {
    const filas = [
      filaHistorial('00000000-0000-4000-8000-000000000003', '2026-03-01'),
      filaHistorial('00000000-0000-4000-8000-000000000002', '2026-02-01'),
      filaHistorial('00000000-0000-4000-8000-000000000001', '2026-01-01'),
    ];
    const primera = crearContexto({
      respuestas: [...personaSimple(UUID_A), { cuando: /FROM sport_result r/, filas }],
    });
    const p1 = await leerHistorial(primera.ctx, { personaId: UUID_A, limite: 2 });
    if (p1.estado !== 'ok' || !p1.siguiente) throw new Error('sin cursor');
    expect(p1.items).toHaveLength(2);

    const siguiente = crearContexto({
      respuestas: [...personaSimple(UUID_A), { cuando: /FROM sport_result r/, filas: [filas[2]] }],
    });
    const p2 = await leerHistorial(siguiente.ctx, { personaId: UUID_A, limite: 2, cursor: p1.siguiente });
    expect(p2).toMatchObject({ estado: 'ok', siguiente: null });
    const s = siguiente.sentencias.find((x) => /FROM sport_result r/.test(x.text))!;
    expect(s.text).toMatch(/\(coalesce\(r\.occurred_on.*\), r\.id\) < \(\$\d+::date, \$\d+::uuid\)/s);
    expect(s.params).toEqual(
      expect.arrayContaining(['2026-02-01', '00000000-0000-4000-8000-000000000002']),
    );

    const ajeno = crearContexto();
    expect(await leerHistorial(ajeno.ctx, { personaId: UUID_B, limite: 2, cursor: p1.siguiente })).toEqual({
      estado: 'cursor_invalido',
    });
    expect(
      await leerHistorial(ajeno.ctx, { personaId: UUID_A, limite: 2, temporada: '2024-2025', cursor: p1.siguiente }),
    ).toEqual({ estado: 'cursor_invalido' });
    expect(ajeno.sentencias).toHaveLength(0);
  });

  it('un cursor con clave no válida no llega a la consulta', async () => {
    const { ctx, sentencias } = crearContexto();
    const malo = codificarCursor('historial', { personaId: UUID_A }, ["2026-01-01'; --", UUID_A]);
    expect(await leerHistorial(ctx, { personaId: UUID_A, cursor: malo })).toEqual({ estado: 'cursor_invalido' });
    expect(sentencias).toHaveLength(0);
  });
});
