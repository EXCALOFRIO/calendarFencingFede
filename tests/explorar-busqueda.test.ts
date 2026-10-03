import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarDeportistas, sqlBusqueda } from '@/lib/sport/explorar/busqueda';
import { codificarCursor } from '@/lib/sport/explorar/cursor';
import {
  CLAVES_PRIVADAS,
  UUID_A,
  UUID_B,
  UUID_C,
  clavesDe,
  crearContexto,
  perfil,
} from './helpers/explorar';

/**
 * Búsqueda de deportistas con contexto controlado: SQL registrado y filas
 * fijadas por el caso. No prueba el resultado de ejecutar el SQL en D1 ni
 * una sesión real; sí guardas previas, forma de las consultas, cursores y DTO.
 */

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

afterEach(() => vi.unstubAllGlobals());

describe('guardas previas a la consulta', () => {
  it('sin sesión o con acceso revocado no ejecuta ninguna sentencia', async () => {
    // getSessionProfile devuelve null para ambos casos: sin cookie y inviteStatus revocada.
    const { ctx, sentencias } = crearContexto({ perfil: null });
    await expect(buscarDeportistas(ctx, { q: 'garcia' })).rejects.toThrow('NO_AUTENTICADO');
    expect(sentencias).toHaveLength(0);
  });

  it('rechaza entradas con claves ajenas, límites excesivos o vocabulario inválido antes de consultar', async () => {
    const { ctx, sentencias } = crearContexto();
    for (const entrada of [
      { q: 'garcia', athleteId: UUID_A },
      { q: 'garcia', limite: 500 },
      { arma: 'LASER' },
      { categoria: 'M99' },
      { desde: '2025-13-40' },
      { desde: '2026-02-01', hasta: '2026-01-01' },
      { nacionalidad: 'ES' },
      'garcia',
    ]) {
      expect(await buscarDeportistas(ctx, entrada)).toEqual({ estado: 'entrada_invalida' });
    }
    expect(sentencias).toHaveLength(0);
  });

  it('una consulta vacía o de una letra no es criterio y no recorre el censo', async () => {
    const { ctx, sentencias } = crearContexto();
    expect(await buscarDeportistas(ctx, {})).toEqual({ estado: 'sin_criterio' });
    expect(await buscarDeportistas(ctx, { q: 'a' })).toEqual({ estado: 'sin_criterio' });
    expect(sentencias).toHaveLength(0);
  });

  it('sin el esquema deportivo devuelve no_disponible, distinto de sin resultados', async () => {
    const { ctx, sentencias } = crearContexto({ esquema: { identidad: false, referencias: false } });
    expect(await buscarDeportistas(ctx, { q: 'garcia' })).toEqual({ estado: 'no_disponible' });
    expect(sentencias).toHaveLength(0);
  });
});

describe('lectura y forma del DTO', () => {
  it('incluye personas sin cuenta, inactivas y por alias, sin leer tablas de cuenta ni ranking interno', async () => {
    const fetchEspia = vi.fn();
    vi.stubGlobal('fetch', fetchEspia);
    const { ctx, texto } = crearContexto({
      respuestas: [
        {
          cuando: consultaPrincipal,
          filas: [
            fila(UUID_A, 'Lucia Garcia', { alias: 'GARCIA PEREZ Lucia' }),
            fila(UUID_B, 'Ana Garcia', { pais: null }),
          ],
        },
        { cuando: conteos, filas: [{ id: UUID_A, resultados: 7, armas: 'SABLE,ESPADA' }] },
        { cuando: homonimos, filas: [{ clave: 'garcia lucia', personas: 2 }] },
      ],
    });

    const r = await buscarDeportistas(ctx, { q: 'García' });
    if (r.estado !== 'ok') throw new Error(r.estado);

    expect(r.items.map((i) => i.id)).toEqual([UUID_A, UUID_B]);
    expect(r.items[0]).toMatchObject({
      alias: 'GARCIA PEREZ Lucia',
      resultadosImportados: 7,
      armas: ['ESPADA', 'SABLE'],
      mismoNombre: 2,
    });
    // Sin resultados importados no se afirma «cero participaciones»: el campo lo dice.
    expect(r.items[1]).toMatchObject({ resultadosImportados: 0, armas: [], pais: null });
    expect(r.sinResultados).toBe(false);

    const sql = texto();
    expect(sql).not.toMatch(/\bathlete\b|user_profile|ranking_snapshot|ranking_point|competition_registration/);
    expect(sql).toMatch(/merged_into_person_id IS NULL/);
    expect(sql).toMatch(/sport_person_alias/);
    expect(fetchEspia).not.toHaveBeenCalled();

    const claves = clavesDe(r.items);
    for (const privada of CLAVES_PRIVADAS) expect(claves.has(privada)).toBe(false);
    expect([...clavesDe(r.items[0])].sort()).toEqual(
      ['alias', 'anioNacimiento', 'armas', 'genero', 'id', 'mismoNombre', 'nombre', 'pais', 'resultadosImportados'],
    );
  });

  it('cero resultados es un estado propio, no un error', async () => {
    const { ctx } = crearContexto({ respuestas: [{ cuando: consultaPrincipal, filas: [] }] });
    const r = await buscarDeportistas(ctx, { q: 'inexistente' });
    expect(r).toMatchObject({ estado: 'ok', items: [], siguiente: null, sinResultados: true });
  });

  it('normaliza el texto: acentos, mayúsculas y orden de palabras no cambian la consulta', async () => {
    const a = crearContexto();
    const b = crearContexto();
    await buscarDeportistas(a.ctx, { q: '  GARCÍA   López ' });
    await buscarDeportistas(b.ctx, { q: 'garcia lopez' });
    expect(a.sentencias[0].params).toEqual(b.sentencias[0].params);
    expect(a.sentencias[0].params).toEqual(expect.arrayContaining(['garcia%', '% garcia%', 'lopez%', '% lopez%']));
  });

  it('conserva M10/M12 y la categoría publicada como filtros exactos', async () => {
    const { ctx, sentencias } = crearContexto();
    const r = await buscarDeportistas(ctx, { categoria: 'M10', categoriaRaw: 'M-10', arma: 'ESPADA' });
    expect(r.estado).toBe('ok');
    const main = sentencias[0];
    expect(main.text).toMatch(/c\.category = \?/);
    expect(main.text).toMatch(/c\.category_raw = \?/);
    expect(main.params).toEqual(expect.arrayContaining(['M10', 'M-10', 'ESPADA']));
    // Sin torneo ni fechas, el ranking oficial también documenta la participación.
    expect(main.text).toMatch(/sport_ranking_entry en2/);
  });
});

describe('filtros combinados sobre el mismo hecho', () => {
  it('torneo, temporada y fechas se evalúan en UN solo EXISTS de resultados (otro año no contamina)', async () => {
    const { ctx, sentencias } = crearContexto();
    await buscarDeportistas(ctx, {
      torneo: 'Open Madrid',
      temporada: '2025-2026',
      desde: '2025-10-01',
      hasta: '2026-05-31',
    });
    const { text, params } = sentencias[0];
    expect(text.match(/\bEXISTS\s*\(/g)).toHaveLength(1);
    const existe = text.match(/EXISTS \(\s*SELECT 1 FROM sport_result r[\s\S]*\n {2}\)/);
    expect(existe).not.toBeNull();
    const bloque = existe![0];
    expect(bloque).toMatch(/c\.season = /);
    expect(bloque).toMatch(/LIKE/);
    expect(bloque).toMatch(/>= \?/);
    expect(bloque).toMatch(/<= \?/);
    expect(params).toEqual(expect.arrayContaining(['2025-2026', '%open madrid%', '2025-10-01', '2026-05-31']));
    // Con torneo/fechas el ranking oficial no sustituye a un resultado de torneo.
    expect(text).not.toMatch(/sport_ranking_entry en2/);
  });

  it('edicionId identifica una edición concreta, no todas las del mismo nombre', async () => {
    const { ctx, sentencias } = crearContexto();
    await buscarDeportistas(ctx, { edicionId: UUID_C });
    expect(sentencias[0].text).toMatch(/e\.id = \?/);
    expect(sentencias[0].params).toContain(UUID_C);
  });

  it('el ámbito usa el evento vinculado y trata FIE sin vínculo como internacional', async () => {
    const { ctx, sentencias } = crearContexto();
    await buscarDeportistas(ctx, { ambito: 'NACIONAL' });
    expect(sentencias[0].text).toMatch(/coalesce\(ev0\.scope, CASE WHEN e\.source = 'fie' THEN 'INTERNACIONAL' END\)/);
  });
});

describe('España para el seleccionador, sin privilegio sobre el ranking interno', () => {
  it('un coach de florete filtrando espada recibe el mismo DTO y no se toca ranking interno', async () => {
    const coach = perfil({ role: 'coach', weapons: ['FLORETE'] });
    const { ctx, texto } = crearContexto({
      perfil: coach,
      respuestas: [
        { cuando: consultaPrincipal, filas: [fila(UUID_A, 'Retirada Sin Cuenta')] },
        { cuando: conteos, filas: [{ id: UUID_A, resultados: 3, armas: 'ESPADA' }] },
      ],
    });
    const r = await buscarDeportistas(ctx, { nacionalidad: 'esp', arma: 'ESPADA', categoria: 'ABS' });
    if (r.estado !== 'ok') throw new Error(r.estado);

    expect(r.items).toHaveLength(1);
    const sql = texto();
    expect(sql).not.toMatch(/ranking_snapshot|ranking_point|profile_weapon/);
    // Español documentado: país declarado, hechos con país o licencia RFEE confirmada.
    expect(sql).toMatch(/p\.country_code = \?/);
    expect(sql).toMatch(/rn\.source_country_code/);
    expect(sql).toMatch(/scheme = 'rfee_license'/);
    for (const privada of CLAVES_PRIVADAS) expect(clavesDe(r).has(privada)).toBe(false);
  });

  it('una nacionalidad distinta de ESP no usa la licencia RFEE como prueba', () => {
    const dialecto = new SQLiteSyncDialect();
    const fra = dialecto.sqlToQuery(sqlBusqueda({ nacionalidad: 'FRA' }, 25, null));
    const esp = dialecto.sqlToQuery(sqlBusqueda({ nacionalidad: 'ESP' }, 25, null));
    expect(fra.sql).not.toMatch(/rfee_license/);
    expect(esp.sql).toMatch(/rfee_license/);
  });
});

describe('paginación estable', () => {
  it('pide limite+1, ordena por (nombre normalizado, id) y emite cursor sólo si hay más', async () => {
    const filas = [fila(UUID_A, 'Ana Aa'), fila(UUID_B, 'Ana Bb'), fila(UUID_C, 'Ana Cc')];
    const { ctx, sentencias } = crearContexto({
      respuestas: [{ cuando: consultaPrincipal, filas }],
    });
    const r = await buscarDeportistas(ctx, { q: 'ana', limite: 2 });
    if (r.estado !== 'ok') throw new Error(r.estado);

    expect(sentencias[0].text).toMatch(/ORDER BY p\.name_normalized ASC, p\.id ASC\s+LIMIT \?/);
    expect(sentencias[0].params.at(-1)).toBe(3);
    expect(r.items.map((i) => i.id)).toEqual([UUID_A, UUID_B]);
    expect(r.siguiente).toBeTypeOf('string');

    const ultima = crearContexto({ respuestas: [{ cuando: consultaPrincipal, filas: filas.slice(0, 2) }] });
    const final = await buscarDeportistas(ultima.ctx, { q: 'ana', limite: 2 });
    expect(final).toMatchObject({ estado: 'ok', siguiente: null });
  });

  it('el cursor reanuda tras la última clave con los mismos filtros', async () => {
    const filas = [fila(UUID_A, 'Ana Aa'), fila(UUID_B, 'Ana Bb'), fila(UUID_C, 'Ana Cc')];
    const primera = crearContexto({ respuestas: [{ cuando: consultaPrincipal, filas }] });
    const p1 = await buscarDeportistas(primera.ctx, { q: 'ana', limite: 2 });
    if (p1.estado !== 'ok' || !p1.siguiente) throw new Error('sin cursor');

    const segunda = crearContexto({ respuestas: [{ cuando: consultaPrincipal, filas: [filas[2]] }] });
    const p2 = await buscarDeportistas(segunda.ctx, { q: 'ana', limite: 2, cursor: p1.siguiente });
    expect(p2).toMatchObject({ estado: 'ok', siguiente: null });
    const s = segunda.sentencias[0];
    expect(s.text).toMatch(/\(p\.name_normalized, p\.id\) > \(\?, \?\)/);
    expect(s.params).toEqual(expect.arrayContaining(['ana bb', UUID_B]));
  });

  it('un cursor emitido con otros filtros (o manipulado) se rechaza sin consultar', async () => {
    const { ctx, sentencias } = crearContexto();
    const deOtraBusqueda = codificarCursor('busqueda', { q: 'ana' }, ['ana aa', UUID_A]);
    expect(await buscarDeportistas(ctx, { q: 'ana', nacionalidad: 'ESP', cursor: deOtraBusqueda })).toEqual({
      estado: 'cursor_invalido',
    });
    expect(await buscarDeportistas(ctx, { q: 'ana', cursor: 'no-es-un-cursor' })).toEqual({
      estado: 'cursor_invalido',
    });
    const claveInvalida = codificarCursor('busqueda', { q: 'ana' }, ['ana', "x'; DROP TABLE sport_person;--"]);
    expect(await buscarDeportistas(ctx, { q: 'ana', cursor: claveInvalida })).toEqual({
      estado: 'cursor_invalido',
    });
    expect(sentencias).toHaveLength(0);
  });
});
