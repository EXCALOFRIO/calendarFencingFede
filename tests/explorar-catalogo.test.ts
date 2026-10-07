import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { cargarCatalogoEdiciones, leerCatalogoEdiciones, LIMITE_CATALOGO } from '@/lib/sport/explorar/catalogo';
import { leerCriteriosCatalogo, sanitizarRetornoCatalogo, urlCatalogo } from '@/lib/sport/explorar/catalogo-url';
import { construirUrlEdicion, leerCriteriosEdicion, sanitizarRetornoEdicion } from '@/lib/sport/explorar/edicion-url';
import { codificarCursor } from '@/lib/sport/explorar/cursor';
import { leerEdicion } from '@/lib/sport/explorar/ediciones';
import { CLAVES_PRIVADAS, UUID_A, clavesDe, crearContexto } from './helpers/explorar';

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => { throw new Error('Sin red en el test'); },
}));

const { CatalogoEdiciones } = await import('@/components/explorar/catalogo-ediciones');
const VACIOS = { q: '', fuente: '', temporada: '' };
const cierres: (() => void)[] = [];
afterEach(() => {
  cierres.splice(0).forEach((cerrar) => cerrar());
  vi.restoreAllMocks();
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function entorno() {
  const local = localD1();
  cierres.push(local.close);
  const db = createD1Database(local.binding);
  const ctx = { ...crearContexto().ctx, db };
  const insertar = local.sqlite.prepare(`INSERT INTO sport_edition
    (id,source,season,tournament_key,name,city,start_date) VALUES (?,?,?,?,?,?,?)`);
  function edicion(n: number, fuente = 'fie', temporada = '2026', fecha: string | null = '2026-05-03',
    nombre = `Copa sintética ${n}`, ciudad: string | null = 'Córdoba') {
    insertar.run(id(n), fuente, temporada, `ed-${n}`, nombre, ciudad, fecha);
    local.sqlite.prepare(`INSERT INTO sport_competition
      (id,edition_id,source,season,competition_key,weapon,gender,category,format)
      VALUES (?,?,?,?,?,'ESPADA','F','ABS','INDIVIDUAL')`).run(id(n + 1000), id(n), fuente, temporada, `pr-${n}`);
  }
  return { ...local, ctx, edicion };
}

describe('catálogo: guardas, límites y errores', () => {
  it('exige sesión incluso antes de validar entradas y no consulta el esquema', async () => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    ctx.esquema = vi.fn(ctx.esquema);
    for (const entrada of [null, {}, { cursor: 'invalido' }]) {
      await expect(leerCatalogoEdiciones(ctx, entrada)).rejects.toThrow('NO_AUTENTICADO');
    }
    expect(sentencias).toHaveLength(0);
    expect(ctx.esquema).not.toHaveBeenCalled();
  });

  it('rechaza fuente, temporada, cursor y texto inválidos sin consultas', async () => {
    const { ctx, sentencias } = crearContexto();
    for (const entrada of [null, [], { q: 1 }, { q: 'a'.repeat(101) }, { fuente: 'otra' },
      { temporada: '26' }, { temporada: '2026-27' }, { cursor: '' }, { cursor: 'x'.repeat(601) }, { limite: 1000 }]) {
      expect(await leerCatalogoEdiciones(ctx, entrada)).toEqual({ estado: 'entrada_invalida' });
    }
    expect(await leerCatalogoEdiciones(ctx, { cursor: 'no-base64-json' })).toEqual({ estado: 'cursor_invalido' });
    expect(sentencias).toHaveLength(0);
  });

  it.each([
    [12, UUID_A], ['2026-05-03', 12], ['fecha', UUID_A], ['2026-05-03', 'no-uuid'],
  ])('valida tipos y formato de las dos claves (%s, %s)', async (fecha, uuid) => {
    const { ctx, sentencias } = crearContexto();
    const cursor = codificarCursor('catalogo-ediciones', VACIOS, [fecha, uuid]);
    expect(await leerCatalogoEdiciones(ctx, { cursor })).toEqual({ estado: 'cursor_invalido' });
    expect(sentencias).toHaveLength(0);
  });

  it('esquema ausente y error de lectura no se convierten en lista vacía', async () => {
    const apagado = crearContexto({ esquema: { identidad: false, referencias: false } });
    expect(await cargarCatalogoEdiciones(apagado.ctx, {})).toEqual({ estado: 'no_disponible' });
    expect(apagado.sentencias).toHaveLength(0);
    expect(await cargarCatalogoEdiciones(crearContexto({ perfil: null }).ctx, {})).toEqual({ estado: 'sin_sesion' });
    const roto = crearContexto();
    roto.ctx.db = { execute: () => Promise.reject(new Error('detalle-privado-no-publicable')) } as never;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await cargarCatalogoEdiciones(roto.ctx, {})).toEqual({ estado: 'error' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('detalle-privado');
  });
});

describe('catálogo: SQL D1 nativo y hechos sin calendario o identidad', () => {
  it('pagina todas las fuentes, fechas empatadas y fechas desconocidas sin repetir ni perder ediciones', async () => {
    const t = entorno();
    for (let n = 1; n <= 61; n++) {
      t.edicion(n, ['fie', 'skermo_rfee', 'rfee_pdf'][n % 3], n % 3 ? '2025-2026' : '2026',
        n > 36 ? null : '2026-05-03');
    }
    const vistos: string[] = [];
    const fuentes = new Set<string>();
    let cursor: string | undefined;
    for (let pagina = 0; pagina < 3; pagina++) {
      const r = await leerCatalogoEdiciones(t.ctx, cursor ? { cursor } : {});
      if (r.estado !== 'ok') throw new Error(r.estado);
      expect(r.total).toBe(61);
      expect(r.pruebas).toBe(61);
      expect(r.ediciones).toHaveLength(pagina === 2 ? 11 : LIMITE_CATALOGO);
      r.ediciones.forEach((e) => { vistos.push(e.id); fuentes.add(e.fuente); });
      expect(CLAVES_PRIVADAS.filter((k) => clavesDe(r).has(k))).toEqual([]);
      cursor = r.siguiente ?? undefined;
    }
    expect(cursor).toBeUndefined();
    expect(vistos).toEqual([
      ...Array.from({ length: 36 }, (_, n) => id(36 - n)),
      ...Array.from({ length: 25 }, (_, n) => id(61 - n)),
    ]);
    expect(new Set(vistos).size).toBe(61);
    expect(fuentes.size).toBe(3);
    expect(t.calls.every((c) => c.parameters <= 100)).toBe(true);
    expect(t.calls.every((c) => /^\s*SELECT/.test(c.sql))).toBe(true);
  });

  it('combina nombre o ciudad, fuente y temporada; mantiene los totales al paginar', async () => {
    const t = entorno();
    for (let n = 1; n <= 28; n++) t.edicion(n, 'rfee_pdf', '2025-2026', null, `Copa ${n}`);
    t.edicion(29, 'skermo_rfee', '2025-2026');
    t.edicion(30, 'rfee_pdf', '2024-2025');
    t.edicion(31, 'rfee_pdf', '2025-2026', null, 'Otra copa', 'Madrid');
    const filtros = { q: 'CÓRDOBA', fuente: 'rfee_pdf', temporada: '2025-2026' };
    const primera = await leerCatalogoEdiciones(t.ctx, filtros);
    if (primera.estado !== 'ok') throw new Error(primera.estado);
    expect(primera.total).toBe(28);
    expect(primera.pruebas).toBe(28);
    expect(primera.ediciones).toHaveLength(25);
    const segunda = await leerCatalogoEdiciones(t.ctx, { ...filtros, q: 'cordoba', cursor: primera.siguiente! });
    if (segunda.estado !== 'ok') throw new Error(segunda.estado);
    expect(segunda.total).toBe(28);
    expect(segunda.ediciones).toHaveLength(3);
    expect(segunda.siguiente).toBeNull();
    const antes = t.calls.length;
    for (const otro of [{ q: 'Madrid' }, { fuente: 'fie' }, { temporada: '2024-2025' }]) {
      expect(await leerCatalogoEdiciones(t.ctx, { ...filtros, ...otro, cursor: primera.siguiente! }))
        .toEqual({ estado: 'cursor_invalido' });
    }
    expect(t.calls).toHaveLength(antes);
  });

  it('busca signos literalmente, parametriza texto hostil y no borra tablas', async () => {
    const t = entorno();
    t.edicion(1, 'fie', '2026', null, 'Copa 100%');
    t.edicion(2, 'fie', '2026', null, 'Copa A_B');
    t.edicion(3, 'fie', '2026', null, 'Copa normal');
    for (const [q, esperado] of [['%', id(1)], ['_', id(2)]]) {
      const r = await leerCatalogoEdiciones(t.ctx, { q });
      if (r.estado !== 'ok') throw new Error(r.estado);
      expect(r.ediciones.map((e) => e.id)).toEqual([esperado]);
    }
    const peligro = "' OR 1=1; DROP TABLE sport_edition;--";
    expect(await leerCatalogoEdiciones(t.ctx, { q: peligro })).toMatchObject({ estado: 'ok', total: 0, ediciones: [] });
    expect(t.calls.at(-1)?.sql).not.toContain('DROP TABLE');
    expect(t.sqlite.prepare('SELECT count(*) AS n FROM sport_edition').get()?.n).toBe(3);
  });

  it.each(['fie', 'skermo_rfee', 'rfee_pdf'])('%s permite abrir resultados sin vínculos a personas ni al calendario', async (fuente) => {
    const t = entorno();
    t.edicion(1, fuente, fuente === 'fie' ? '2026' : '2025-2026');
    t.sqlite.prepare(`INSERT INTO sport_result
      (id,competition_id,source,source_fact_key,source_name,position,content_hash)
      VALUES (?,?,?,?,'Nombre deportivo sintético',1,'hash')`).run(id(2001), id(1001), fuente, 'hecho');
    const r = await leerCatalogoEdiciones(t.ctx, { fuente });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.total).toBe(1);
    const detalle = await leerEdicion(t.ctx, { edicionId: r.ediciones[0].id, prueba: id(1001) });
    if (detalle.estado !== 'ok') throw new Error(detalle.estado);
    expect(detalle.edicion.clasificacion?.filas).toHaveLength(1);
    expect(detalle.edicion.clasificacion?.filas[0].personaId).toBeNull();
    expect(t.sqlite.prepare('SELECT event_id FROM sport_edition').get()?.event_id).toBeNull();
    expect(CLAVES_PRIVADAS.filter((k) => clavesDe(detalle).has(k))).toEqual([]);
  });
});

describe('catálogo: URL y pantalla de servidor', () => {
  it('conserva los filtros conocidos, elimina extras y admite parámetros repetidos', () => {
    const c = leerCriteriosCatalogo({ q: [' Córdoba ', 'otro'], fuente: 'rfee_pdf', temporada: '2025-2026', cursor: 'abc', secreto: 'no' });
    expect(c).toEqual({ criterios: { q: 'Córdoba', fuente: 'rfee_pdf', temporada: '2025-2026' }, cursor: 'abc' });
    expect(urlCatalogo(c.criterios, c.cursor)).toBe('/explorar/ediciones?q=C%C3%B3rdoba&fuente=rfee_pdf&temporada=2025-2026&cursor=abc');
    expect(urlCatalogo(VACIOS)).toBe('/explorar/ediciones');
    expect(urlCatalogo(c.criterios)).not.toContain('cursor');
    const grandes = leerCriteriosCatalogo({ q: 'q'.repeat(5000), cursor: 'x'.repeat(5000), temporada: '2'.repeat(5000) });
    expect(grandes.criterios.q).toHaveLength(101);
    expect(grandes.cursor).toHaveLength(601);
    expect(grandes.criterios.temporada).toHaveLength(10);
  });

  it('muestra etiquetas visibles, GET, fuente, enlaces y advertencia de completitud sin datos de cuenta', () => {
    const html = renderToStaticMarkup(React.createElement(CatalogoEdiciones, {
      criterios: { q: 'Córdoba', fuente: 'rfee_pdf', temporada: '2025-2026' },
      cursor: 'previo',
      vista: { estado: 'ok', total: 2, pruebas: 3, siguiente: 'siguiente', ediciones: [{
        id: UUID_A, nombre: 'Copa sintética', temporada: '2025-2026', fuente: 'rfee_pdf',
        ciudad: null, pais: null, inicio: null, fin: null, pruebas: 1, armas: ['ESPADA'], formatos: ['INDIVIDUAL'], serie: null,
      }] },
    }));
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/explorar/ediciones"');
    for (const campo of ['q', 'fuente', 'temporada']) {
      expect(html).toContain(`for="catalogo-${campo}"`);
      expect(html).toContain(`id="catalogo-${campo}"`);
    }
    expect(html).toContain('role="search"');
    expect(html).toContain('aria-label="Páginas del catálogo"');
    expect(html).toContain('RFEE PDF');
    expect(html).toContain(`/explorar/ediciones/${UUID_A}`);
    expect(html).toContain('catalogo=%2Fexplorar%2Fediciones%3Fq%3DC%25C3%25B3rdoba');
    expect(html).toContain('cursor=siguiente');
    expect(html).toContain('>Primeras<');
    expect(html).not.toContain('name="cursor"');
    expect(html).not.toContain('cuenta@example.test');
    expect(html).not.toContain('token-privado');
  });

  it('conserva búsqueda y página en edición, clasificación y retorno de ficha, sin destinos externos', () => {
    const catalogo = urlCatalogo({ q: 'Córdoba', fuente: 'rfee_pdf', temporada: '2025-2026' }, 'pagina');
    expect(sanitizarRetornoCatalogo(`${catalogo}&desconocido=descartar`)).toBe(catalogo);
    expect(sanitizarRetornoEdicion(catalogo)).toBe(catalogo);
    const edicion = construirUrlEdicion(UUID_A, { catalogo });
    expect(new URL(edicion, 'https://example.test').searchParams.get('catalogo')).toBe(catalogo);
    expect(leerCriteriosEdicion({ catalogo })).toMatchObject({ catalogo });
    expect(sanitizarRetornoEdicion(`${edicion}&extra=no`)).toBe(edicion);
    for (const malo of ['https://evil.example/explorar/ediciones', '//evil.example/explorar/ediciones',
      '/explorar/ediciones/../../perfil', '/explorar/ediciones#otra', '/explorar/ediciones?fuente=otra',
      '/explorar/ediciones?temporada=26', `/explorar/ediciones?q=${'x'.repeat(101)}`,
      `/explorar/ediciones?cursor=${'x'.repeat(601)}`]) {
      expect(sanitizarRetornoCatalogo(malo)).toBe('');
      expect(construirUrlEdicion(UUID_A, { catalogo: malo })).toBe(`/explorar/ediciones/${UUID_A}`);
      expect(leerCriteriosEdicion({ catalogo: malo }).catalogo).toBeUndefined();
    }
  });

  it('distingue vacío, error, esquema ausente y enlace inválido y escapa texto', () => {
    const vacio = renderToStaticMarkup(React.createElement(CatalogoEdiciones, {
      criterios: VACIOS, vista: { estado: 'ok', total: 0, pruebas: 0, ediciones: [], siguiente: null },
    }));
    expect(vacio).toContain('Sin ediciones con estos filtros');
    for (const estado of ['error', 'no_disponible', 'entrada_invalida', 'cursor_invalido'] as const) {
      const html = renderToStaticMarkup(React.createElement(CatalogoEdiciones, {
        criterios: { ...VACIOS, q: '<script>peligro</script>' }, vista: { estado },
      }));
      expect(html).toContain('role="alert"');
      expect(html).not.toContain('Sin ediciones con estos filtros');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    }
  });
});
