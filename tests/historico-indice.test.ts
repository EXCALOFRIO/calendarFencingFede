import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  filaCatalogoFie,
  inventariarFie,
  inventariarSkermo,
  normalizarTemporadasFie,
  resumirInventario,
  temporadaFieDeFecha,
  temporadasSkermoDesde,
  urlPruebasFie,
  type DepsInventarioFie,
  type DepsInventarioSkermo,
  type UnidadInventario,
} from '@/lib/ingest/sources/historico-indice';
import {
  parseSkermoResultsIndex,
  parseSkermoSeasons,
} from '@/lib/ingest/sources/skermo-results';

/**
 * Fixtures reales de lectura pública (app.skermo.org y fie.org, 01/10/2026),
 * minimizadas a selector, cabecera y unas filas. Los recuentos que se afirman
 * salen de ellas, no de un mock que los invente. Las páginas FIE paginadas se
 * sintetizan clonando una prueba real, y el test lo dice.
 */

const ruta = (nombre: string) => fileURLToPath(new URL(`./fixtures/${nombre}`, import.meta.url));
const html = (nombre: string) => gunzipSync(readFileSync(ruta(nombre))).toString('utf8');
const json = (nombre: string) => JSON.parse(readFileSync(ruta(nombre), 'utf8'));

const RFEE_BASE = html('skermo-resultados-rfee-2025-2026.html.gz'); // 764 filas, 2025-2026 marcada
const RFEE_2018 = html('historico/skermo-rfee-2018-2019-resultados.html.gz'); // 11 filas
const RFEE_2017 = html('historico/skermo-rfee-2017-2018-resultados.html.gz'); // índice vacío
const FNE = html('historico/skermo-fne-resultados.html.gz');

const SELECTOR_RFEE = parseSkermoSeasons(RFEE_BASE);
const idDe = (label: string) => SELECTOR_RFEE.find((s) => s.label === label)!.value;

function depsSkermo(paginas: Record<string, string>, fallan: string[] = []) {
  const pedidas: string[] = [];
  const deps: DepsInventarioSkermo = {
    async indice(federacion, temporadaId) {
      const clave = `${federacion}|${temporadaId ?? ''}`;
      pedidas.push(clave);
      if (fallan.includes(federacion)) throw new Error('HTTP 503 simulado');
      if (!(clave in paginas)) throw new Error(`HTTP 500 sin fixture para ${clave}`);
      return paginas[clave];
    },
    temporadas: parseSkermoSeasons,
    parsear: (h, federacion) => parseSkermoResultsIndex(h, { federationCode: federacion }),
    esperar: async () => undefined,
  };
  return { deps, pedidas };
}

const PAGINAS_RFEE = {
  'RFEE|': RFEE_BASE,
  [`RFEE|${idDe('2017-2018')}`]: RFEE_2017,
  [`RFEE|${idDe('2018-2019')}`]: RFEE_2018,
};

describe('temporadas del selector de Skermo', () => {
  it('RFEE enumera desde 2017-18 hasta la última publicada, sin límite superior', () => {
    const etiquetas = temporadasSkermoDesde(SELECTOR_RFEE).map((s) => s.label);
    expect(etiquetas[0]).toBe('2017-2018');
    expect(etiquetas).toContain('2026-2027');
    expect(etiquetas).toHaveLength(10);
    // Orden cronológico, sin duplicados.
    expect([...etiquetas].sort()).toEqual(etiquetas);
  });

  it('descarta lo anterior al inicio pedido pero conserva una etiqueta que no entiende', () => {
    const opciones = [
      { value: '1', label: '2015-2016', selected: false },
      { value: '2', label: '2017-2018', selected: false },
      { value: '9', label: 'Histórico', selected: false },
    ];
    expect(temporadasSkermoDesde(opciones).map((o) => o.label)).toEqual(['2017-2018', 'Histórico']);
  });

  it('una federación autonómica sólo ofrece las temporadas de su propio selector', () => {
    expect(parseSkermoSeasons(FNE).map((s) => s.label)).toEqual(['2021-2022', '2024-2025']);
  });
});

describe('inventario Skermo sobre índices reales', () => {
  it('recorre varias temporadas, con filas/enlaces por tipo y ausencias explícitas', async () => {
    const { deps } = depsSkermo(PAGINAS_RFEE);
    const r = await inventariarSkermo(deps, [{ codigo: 'RFEE', verificada: true }], { maxPeticiones: 3 });
    const porTemporada = new Map(r.unidades.map((u) => [u.temporada, u]));

    // 2017-18: el índice se publica vacío. Es un hecho de la fuente, no un fallo.
    expect(porTemporada.get('2017-2018')).toMatchObject({ estado: 'sin_filas', filas: 0, publicado: 0 });

    const u18 = porTemporada.get('2018-2019')!;
    expect(u18).toMatchObject({ estado: 'leido', filas: 11, descuadradas: 0 });
    // Documentos distintos por tipo, contados por fila y no sólo HTML.
    expect(u18.enlaces.pdf).toBeGreaterThan(0);
    expect(u18.enlaces.externo).toBeGreaterThan(0);
    expect(u18.enlaces.html).toBe(0);
    expect(u18.sinDocumento).toBe(2);

    const base = porTemporada.get('2025-2026')!;
    expect(base).toMatchObject({ estado: 'leido', filas: 764 });
    expect(base.enlaces.html).toBe(228);
    expect(base.enlaces.pdf).toBe(217);
  });

  it('la categoría que no se reconoce se conserva literal y se marca, sin inventar una', async () => {
    const { deps } = depsSkermo(PAGINAS_RFEE);
    const r = await inventariarSkermo(deps, [{ codigo: 'RFEE', verificada: true }], { maxPeticiones: 3 });
    const sinMapa = r.catalogo.filter((f) => f.huecos.includes('categoria_no_reconocida'));
    expect(sinMapa.map((f) => f.categoriaOriginal).sort()).toEqual(['M10', 'M12']);
    expect(sinMapa.every((f) => f.categoria === null)).toBe(true);
    const veterano = r.catalogo.find((f) => f.categoriaOriginal === 'VET40');
    expect(veterano?.categoria).toBe('VET');
  });

  it('un tope de peticiones aplaza: lo no leído queda pendiente, nunca vacío', async () => {
    const { deps, pedidas } = depsSkermo(PAGINAS_RFEE);
    const r = await inventariarSkermo(deps, [{ codigo: 'RFEE', verificada: true }], { maxPeticiones: 3 });
    // Base + 2017-18 + 2018-19; 2025-26 viene marcada en la base y no cuesta petición.
    expect(pedidas).toEqual(['RFEE|', `RFEE|${idDe('2017-2018')}`, `RFEE|${idDe('2018-2019')}`]);
    expect(r.peticiones).toBe(3);
    const pendientes = r.pendientes.map((u) => u.temporada);
    expect(pendientes).toEqual([
      '2019-2020',
      '2020-2021',
      '2021-2022',
      '2022-2023',
      '2023-2024',
      '2024-2025',
      '2026-2027',
    ]);
    expect(r.pendientes.every((u) => u.estado === 'pendiente' && u.filas === 0)).toBe(true);
  });

  it('reanuda desde las unidades previas sin repetir lo leído', async () => {
    const { deps } = depsSkermo(PAGINAS_RFEE);
    const primera = await inventariarSkermo(deps, [{ codigo: 'RFEE', verificada: true }], { maxPeticiones: 3 });
    const segunda = depsSkermo({
      ...PAGINAS_RFEE,
      [`RFEE|${idDe('2019-2020')}`]: RFEE_2018,
    });
    const r = await inventariarSkermo(segunda.deps, [{ codigo: 'RFEE', verificada: true }], {
      maxPeticiones: 2,
      previas: primera.unidades,
    });
    // Base + 2019-20; 2017-18, 2018-19 y 2025-26 se reutilizan de la ejecución previa.
    expect(segunda.pedidas).toEqual(['RFEE|', `RFEE|${idDe('2019-2020')}`]);
    expect(r.unidades.find((u) => u.temporada === '2018-2019')).toBe(
      primera.unidades.find((u) => u.temporada === '2018-2019'),
    );
    expect(r.unidades.find((u) => u.temporada === '2019-2020')?.estado).toBe('leido');
  });

  it('una federación que no responde es inaccesible y otra sin verificar no se pide', async () => {
    const { deps, pedidas } = depsSkermo({ ...PAGINAS_RFEE, 'FNE|': FNE }, ['FCE']);
    const r = await inventariarSkermo(
      deps,
      [
        { codigo: 'FCE', verificada: true },
        { codigo: 'FNE', verificada: true },
        { codigo: 'XYZ', verificada: false },
      ],
      { maxPeticiones: 10 },
    );
    expect(r.unidades.find((u) => u.federacion === 'FCE')).toMatchObject({
      estado: 'inaccesible',
      temporada: '',
      error: expect.stringContaining('503'),
    });
    expect(r.unidades.find((u) => u.federacion === 'XYZ')).toMatchObject({ estado: 'no_verificado' });
    expect(pedidas.some((p) => p.startsWith('XYZ'))).toBe(false);
    // FNE: índice vacío publicado en su temporada marcada, y la otra todavía sin leer.
    const fne = r.unidades.filter((u) => u.federacion === 'FNE');
    expect(fne.map((u) => [u.temporada, u.estado])).toEqual([
      ['2021-2022', 'sin_filas'],
      ['2024-2025', 'error'],
    ]);
    expect(r.pendientes.map((u) => u.federacion)).toEqual(['FCE', 'FNE']);
  });

  it('distingue lo descubierto de lo ya importado', async () => {
    const { deps } = depsSkermo(PAGINAS_RFEE);
    const sinMarcar = await inventariarSkermo(deps, [{ codigo: 'RFEE', verificada: true }], { maxPeticiones: 1 });
    const clasificacion = sinMarcar.catalogo.find((f) => f.clavePrueba !== null)!;
    expect(clasificacion.clavePrueba).toMatch(/^RFEE:\d+$/);
    expect(clasificacion.claveCatalogo).toBe(`skermo_rfee|2025-2026|${clasificacion.clavePrueba}`);
    expect(clasificacion.estado).toBe('descubierta');

    const marcado = await inventariarSkermo(depsSkermo(PAGINAS_RFEE).deps, [{ codigo: 'RFEE', verificada: true }], {
      maxPeticiones: 1,
      importadas: new Set([clasificacion.claveCatalogo]),
    });
    const resumen = resumirInventario(marcado);
    expect(resumen.importadas).toBe(1);
    expect(resumen.descubiertas).toBe(763);
    // Una prueba con PDF pero sin clave de clasificación jamás cuenta como importada.
    expect(marcado.catalogo.filter((f) => f.clavePrueba === null).every((f) => f.estado === 'descubierta')).toBe(true);
  });
});

describe('temporadas FIE declaradas', () => {
  const declaradas = json('historico/fie-temporadas.json');

  it('lee todas las temporadas que anuncia la fuente, la más reciente primero', () => {
    const t = normalizarTemporadasFie(declaradas);
    expect(t.completa).toBe(true);
    expect(t.temporadas).toHaveLength(75);
    expect(t.temporadas[0]).toBe(2027);
    expect(t.temporadas.at(-1)).toBe(1953);
  });

  it('si el total publicado no coincide con lo recibido lo marca incompleto', () => {
    const t = normalizarTemporadasFie({ totalFound: 76, items: declaradas.items });
    expect(t.completa).toBe(false);
  });

  it('la temporada deportiva no es el año civil: Bogotá de septiembre de 2026 es la 2027', () => {
    expect(temporadaFieDeFecha('2026-09-25')).toBe(2027);
    expect(temporadaFieDeFecha('2026-08-31')).toBe(2026);
    const bogota = filaCatalogoFie(json('historico/fie-pruebas-2027.json').items[0])!;
    expect(bogota.temporada).toBe('2027');
    expect(bogota.fecha).toBe('2026-09-25');
    expect(bogota).toMatchObject({ arma: 'SABLE', genero: 'F', categoria: 'M17', formato: 'INDIVIDUAL' });
  });

  it('la clave es la temporada que declara la fuente aunque la fecha apunte a otra', () => {
    // Un mundial de veteranos de octubre de 2018 figura en la temporada 2018 de la FIE.
    const fila = filaCatalogoFie(json('historico/fie-pruebas-2018.json').items[0])!;
    expect(fila.fecha).toBe('2018-10-14');
    expect(temporadaFieDeFecha(fila.fecha!)).toBe(2019);
    expect(fila.temporada).toBe('2018');
    expect(fila.claveCatalogo).toBe('fie|2018|1386');
  });

  it('separa API de resultados, invitación PDF y la ausencia declarada sin afirmar que falten', () => {
    const fila = filaCatalogoFie(json('historico/fie-pruebas-2018.json').items[0])!;
    expect(fila.enlaces.map((e) => e.tipo)).toEqual(['api', 'pdf']);
    expect(fila.enlaces[0].url).toBe('https://fie.org/api/fie/competition/2018/1386/results/ranking');
    expect(fila.formato).toBe('EQUIPOS');
    expect(fila.categoria).toBe('VET');
    expect(fila.huecos).toContain('sin_resultados_declarados');
  });
});

describe('inventario FIE paginado', () => {
  const plantilla = json('historico/fie-pruebas-2018.json').items[0];
  const declaradas = json('historico/fie-temporadas.json');

  /** Páginas SINTÉTICAS: clonan una prueba real con otro competitionId. */
  function depsFie(totales: Record<number, number>, fallos: string[] = []) {
    const pedidas: string[] = [];
    const deps: DepsInventarioFie = {
      async json(url) {
        pedidas.push(url);
        if (fallos.includes(url)) throw new Error('HTTP 429 simulado');
        if (url.endsWith('/competitions/seasons')) return declaradas;
        const m = url.match(/season=(\d+)&page=(\d+)&pageSize=100/)!;
        const season = Number(m[1]);
        const pagina = Number(m[2]);
        const total = totales[season] ?? 0;
        const desde = (pagina - 1) * 100;
        const n = Math.max(0, Math.min(100, total - desde));
        return {
          totalFound: total,
          items: Array.from({ length: n }, (_, i) => ({
            ...plantilla,
            season,
            competitionId: season * 1000 + desde + i,
          })),
        };
      },
      esperar: async () => undefined,
    };
    return { deps, pedidas };
  }

  it('pagina hasta el total publicado y sólo da la temporada por leída entonces', async () => {
    const { deps } = depsFie({ 2018: 250 });
    const r = await inventariarFie(deps, { temporadas: [2018] });
    expect(r.unidades[0]).toMatchObject({ estado: 'leido', filas: 250, publicado: 250, siguientePagina: null });
    expect(r.catalogo).toHaveLength(250);
    expect(new Set(r.catalogo.map((f) => f.claveCatalogo)).size).toBe(250);
  });

  it('un tope deja la temporada parcial con su cursor y la siguiente ejecución la completa', async () => {
    const { deps } = depsFie({ 2018: 250 });
    const primera = await inventariarFie(deps, { temporadas: [2018], maxPeticiones: 2 });
    expect(primera.unidades[0]).toMatchObject({ estado: 'parcial', filas: 200, publicado: 250, siguientePagina: 3 });
    expect(primera.pendientes).toHaveLength(1);

    const segunda = depsFie({ 2018: 250 });
    const r = await inventariarFie(segunda.deps, { temporadas: [2018], previas: primera.unidades });
    expect(segunda.pedidas).toEqual([urlPruebasFie(2018, 3)]);
    expect(r.unidades[0]).toMatchObject({ estado: 'leido', filas: 250, siguientePagina: null });
    expect(r.pendientes).toHaveLength(0);
  });

  it('un fallo a mitad no pierde lo leído ni da la temporada por completa', async () => {
    const { deps } = depsFie({ 2018: 250 }, [urlPruebasFie(2018, 2)]);
    const r = await inventariarFie(deps, { temporadas: [2018] });
    expect(r.unidades[0]).toMatchObject({ estado: 'error', filas: 100, siguientePagina: 2, error: expect.stringContaining('429') });
    expect(r.catalogo).toHaveLength(100);
  });

  it('recorre todas las temporadas declaradas sin recortar, aplazando las que no caben', async () => {
    const { deps, pedidas } = depsFie({ 2027: 71, 2026: 10 });
    const r = await inventariarFie(deps, { maxPeticiones: 3 });
    expect(r.temporadasCompletas).toBe(true);
    expect(r.unidades).toHaveLength(75);
    expect(pedidas[0].endsWith('/competitions/seasons')).toBe(true);
    expect(r.unidades.slice(0, 2).map((u) => [u.temporada, u.estado])).toEqual([
      ['2027', 'leido'],
      ['2026', 'leido'],
    ]);
    expect(r.unidades[2]).toMatchObject({ temporada: '2025', estado: 'pendiente' });
    expect(r.pendientes).toHaveLength(73);
  });

  it('una temporada con totalFound 0 es índice vacío publicado, no un fallo', async () => {
    const { deps } = depsFie({});
    const r = await inventariarFie(deps, { temporadas: [1953] });
    expect(r.unidades[0]).toMatchObject({ estado: 'sin_filas', filas: 0, publicado: 0 });
  });

  it('las pruebas FIE ya importadas se marcan por temporada declarada y competitionId', async () => {
    const { deps } = depsFie({ 2018: 3 });
    const r = await inventariarFie(deps, { temporadas: [2018], importadas: new Set(['fie|2018|2018001']) });
    expect(r.catalogo.map((f) => f.estado)).toEqual(['descubierta', 'importada', 'descubierta']);
  });
});

describe('resumen del inventario', () => {
  it('cuenta estados y enlaces y lista lo pendiente sin nombres de personas', () => {
    const unidad = (over: Partial<UnidadInventario>): UnidadInventario => ({
      fuente: 'skermo_regional',
      federacion: 'FCE',
      temporada: '2024-2025',
      estado: 'leido',
      filas: 4,
      publicado: 4,
      enlaces: { html: 1, pdf: 2, api: 0, externo: 1 },
      sinDocumento: 1,
      descuadradas: 0,
      siguientePagina: null,
      url: 'skermo:FCE:2024-2025',
      error: null,
      ...over,
    });
    const r = resumirInventario({
      unidades: [unidad({}), unidad({ temporada: '2023-2024', estado: 'pendiente', enlaces: { html: 0, pdf: 0, api: 0, externo: 0 }, sinDocumento: 0 })],
      catalogo: [],
    });
    expect(r.porEstado).toEqual({ leido: 1, pendiente: 1 });
    expect(r.enlaces).toEqual({ html: 1, pdf: 2, api: 0, externo: 1 });
    expect(r.pendientes).toEqual(['skermo_regional/FCE/2023-2024:pendiente']);
  });
});
