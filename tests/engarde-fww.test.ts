import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  leerClasificacionEngarde,
  leerTorneoEngarde,
  parsearFechaTexto,
  parsearIndiceEngarde,
  parsearPaginaEngarde,
  puestosDeEngarde,
  type DepsEngarde,
  type PruebaEngarde,
} from '@/lib/ingest/sources/engarde';
import {
  leerResultadosFww,
  parsearResultadosFww,
  parsearUrlFww,
  puestosDeFww,
} from '@/lib/ingest/sources/fww';

const fixture = (n: string) => readFileSync(`tests/fixtures/complementarios/${n}`, 'utf8');

const prueba = (extra: Partial<PruebaEngarde> = {}): PruebaEngarde => ({
  org: 'rfee',
  evt: 'med2024',
  compe: 'em17',
  url: 'https://engarde-service.com/competition/rfee/med2024/em17',
  titulo: 'MEN EPEE U17',
  arma: 'ESPADA',
  genero: 'M',
  categoria: 'M17',
  categoriaOriginal: 'cadet',
  categoriaContradictoria: false,
  individual: true,
  fecha: '2024-02-03',
  ciudad: 'LA NUCIA',
  pais: 'ESP',
  estado: 'completed',
  ...extra,
});

const depsCon = (respuestas: Record<string, { status: number; body: string } | Error>): DepsEngarde => ({
  get: async (url) => {
    const r = respuestas[url];
    if (!r) return { status: 404, body: '' };
    if (r instanceof Error) throw r;
    return r;
  },
  post: async (url) => {
    const r = respuestas[`POST ${url}`];
    if (!r) return { status: 404, body: '' };
    if (r instanceof Error) throw r;
    return r;
  },
});

describe('parsearFechaTexto', () => {
  it.each([
    ['3 FEB 2024', '2024-02-03'],
    ['28 DE SEPTIEMBRE DE 2019', '2019-09-28'],
    ['January 2, 2026', '2026-01-02'],
    ['2024 02 03', '2024-02-03'],
    ['02.01.2026', '2026-01-02'],
  ])('%s → %s', (texto, esperado) => {
    expect(parsearFechaTexto(texto)).toBe(esperado);
  });

  it('no completa fechas ambiguas o imposibles', () => {
    expect(parsearFechaTexto('FEB 2024')).toBeNull();
    expect(parsearFechaTexto('31 FEB 2024')).toBeNull();
    expect(parsearFechaTexto('MEN EPEE U17')).toBeNull();
    expect(parsearFechaTexto(null)).toBeNull();
  });
});

describe('índice XML de Engarde', () => {
  it('Mediterráneo 2024: 14 pruebas con categoría, individual/equipos y fecha propias', () => {
    const r = parsearIndiceEngarde(fixture('engarde-indice-med2024.xml'));
    if (!r.ok) throw new Error(r.error);
    expect(r.pruebas).toHaveLength(14);
    expect(r.publicado).toBe(14);
    const em17 = r.pruebas.find((p) => p.compe === 'em17')!;
    expect(em17).toMatchObject({ arma: 'ESPADA', genero: 'M', categoria: 'M17', individual: true, fecha: '2024-02-03' });
    const equipos = r.pruebas.filter((p) => p.individual === false);
    expect(equipos).toHaveLength(2);
    // El arma «-» de una prueba por equipos no es un arma: queda null, no ESPADA.
    expect(equipos.every((p) => p.arma === null)).toBe(true);
  });

  it('Campeonato de Madrid 2019: 12 pruebas, categoría ABS y ciudad abreviada tal como se publica', () => {
    const r = parsearIndiceEngarde(fixture('engarde-indice-ctomadabs19.xml'));
    if (!r.ok) throw new Error(r.error);
    expect(r.pruebas).toHaveLength(12);
    expect(new Set(r.pruebas.map((p) => p.categoria))).toEqual(new Set(['ABS']));
    expect(r.pruebas.find((p) => p.compe === 'ffabseq')!.estado).toBe('list');
    expect(r.pruebas.every((p) => p.ciudad === 'Rivas Vaci.')).toBe(true);
  });

  it('una respuesta HTML no es un índice y las claves inválidas no se aceptan', () => {
    expect(parsearIndiceEngarde('<html><body>Error</body></html>').ok).toBe(false);
    const r = parsearIndiceEngarde(
      '<comps><comp org="../x" evt="e" compe="c"/><comp org="a" evt="e" compe="c" date="1 FEB 2024"/><pagination nbpages="1" nbresultats="2"/></comps>',
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.pruebas).toHaveLength(1);
    expect(r.invalidas).toBe(1);
  });

  it('marca como contradictoria una categoría que choca con el título en vez de elegir una', () => {
    const r = parsearIndiceEngarde(
      '<comps><comp org="a" evt="e" compe="c" date="3 FEB 2024"><categorie>M15</categorie><titre>MEN EPEE U17</titre></comp></comps>',
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.pruebas[0].categoriaContradictoria).toBe(true);
    expect(r.pruebas[0].categoria).toBeNull();
  });
});

describe('página de prueba de Engarde', () => {
  it('Mediterráneo 2024 U17: 29 filas con empates, nación y total declarado', () => {
    const p = parsearPaginaEngarde(fixture('engarde-med2024-em17-clasificacion.html'));
    expect(p.tipo).toBe('clasificacion');
    expect(p.publicado).toBe(29);
    expect(p.filas).toHaveLength(29);
    expect(p.equipos).toBe(false);
    expect(p.fecha).toBe('2024-02-03');
    expect(p.filas.slice(0, 5).map((f) => f.puesto)).toEqual([1, 2, 3, 3, 5]);
    expect(p.filas[0]).toMatchObject({ nacion: 'ESP', club: null });
    // Dos filas con el mismo puesto no se pisan: la clave es el participante, no el puesto.
    expect(new Set(puestosDeEngarde(p).map((x) => x.clave)).size).toBe(29);
  });

  it('Campeonato de Madrid 2019: columna Club en vez de Nación, 59 filas', () => {
    const p = parsearPaginaEngarde(fixture('engarde-ctomadabs19-emabsind-clasificacion.html'));
    expect(p.tipo).toBe('clasificacion');
    expect(p.filas).toHaveLength(59);
    expect(p.filas[0].club).toBe('CEP-M');
    expect(p.filas[0].nacion).toBeNull();
    expect(p.fecha).toBe('2019-09-28');
  });

  it('una prueba por equipos se reconoce como equipos y no como individual', () => {
    const m = parsearPaginaEngarde(fixture('engarde-med2024-mt-equipos.html'));
    expect(m.equipos).toBe(true);
    expect(m.filas.every((f) => f.equipo)).toBe(true);
    const c = parsearPaginaEngarde(fixture('engarde-ctomadabs19-fmabseq-equipos.html'));
    expect(c.equipos).toBe(true);
    expect(puestosDeEngarde(c).every((p) => p.equipo && p.clave.startsWith('engarde:team:'))).toBe(true);
  });

  it('un cuadro (individual o de equipos) no es una clasificación ni produce filas', () => {
    for (const n of ['engarde-ctomadabs19-fmabseq-cuadro-equipos.html', 'engarde-ctomadabs19-emabsind-cuadro.html']) {
      const p = parsearPaginaEngarde(fixture(n));
      expect(p.tipo).toBe('cuadro');
      expect(p.filas).toEqual([]);
    }
  });

  it('una página sin tabla es desconocida', () => {
    expect(parsearPaginaEngarde('<html><body><h1>Nada</h1></body></html>').tipo).toBe('desconocida');
  });
});

describe('lectura de red de Engarde: error, no publicado y cero son estados distintos', () => {
  const url = prueba().url;
  const html = fixture('engarde-med2024-em17-clasificacion.html');

  it('completo cuando las filas leídas igualan el total declarado', async () => {
    const r = await leerClasificacionEngarde(prueba(), depsCon({ [url]: { status: 200, body: html } }));
    expect(r).toMatchObject({ estado: 'completo', publicado: 29, importado: 29, motivo: null });
  });

  it('parcial cuando faltan filas respecto al total declarado', async () => {
    const recortada = html.replace('(29 tiradores)', '(31 tiradores)');
    const r = await leerClasificacionEngarde(prueba(), depsCon({ [url]: { status: 200, body: recortada } }));
    expect(r).toMatchObject({ estado: 'parcial', publicado: 31, importado: 29 });
  });

  it('404 es no publicado, no cero resultados', async () => {
    const r = await leerClasificacionEngarde(prueba(), depsCon({ [url]: { status: 404, body: '' } }));
    expect(r.estado).toBe('no_publicado');
    expect(r.importado).toBe(0);
  });

  it('5xx y fallo de red son error, no cero ni no publicado', async () => {
    expect((await leerClasificacionEngarde(prueba(), depsCon({ [url]: { status: 503, body: '' } }))).estado).toBe('error');
    expect((await leerClasificacionEngarde(prueba(), depsCon({ [url]: new Error('ECONNRESET') }))).estado).toBe('error');
  });

  it('una clasificación final vacía publicada es cero resultados', async () => {
    const vacia = html.replace(/<tbody[\s\S]*<\/tbody>/, '<tbody></tbody>').replace('(29 tiradores)', '(0 tiradores)');
    const r = await leerClasificacionEngarde(prueba(), depsCon({ [url]: { status: 200, body: vacia } }));
    expect(r).toMatchObject({ estado: 'sin_resultados', publicado: 0, importado: 0 });
  });

  it('un cuadro o una clasificación provisional no cuentan como clasificación final', async () => {
    const cuadro = fixture('engarde-ctomadabs19-emabsind-cuadro.html');
    const r = await leerClasificacionEngarde(prueba(), depsCon({ [url]: { status: 200, body: cuadro } }));
    expect(r.estado).toBe('no_publicado');
    const provisional = html.replace('Clasificación general final', 'Clasificación provisional');
    const p = await leerClasificacionEngarde(prueba(), depsCon({ [url]: { status: 200, body: provisional } }));
    expect(p.estado).toBe('no_publicado');
    expect(p.motivo).toMatch(/provisional/);
  });
});

describe('lectura del torneo de Engarde', () => {
  const indice = fixture('engarde-indice-med2024.xml');
  const post = 'POST https://engarde-service.com/prog/getCompeForDisplay.php';

  it('lee el índice y el nombre del torneo desde su página', async () => {
    const r = await leerTorneoEngarde(
      'rfee',
      'med2024',
      depsCon({
        [post]: { status: 200, body: indice },
        'https://engarde-service.com/tournament/rfee/med2024': {
          status: 200,
          body: '<div class="tounament-title">MEDITERRANEAN CHAMPIONSHIP 2024</div>',
        },
      }),
    );
    expect(r.estado).toBe('ok');
    expect(r.pruebas).toHaveLength(14);
    expect(r.nombre).toBe('MEDITERRANEAN CHAMPIONSHIP 2024');
  });

  it('un índice vacío es un hecho (sin_pruebas); un 500 es error', async () => {
    const vacio = await leerTorneoEngarde(
      'rfee',
      'nada',
      depsCon({ [post]: { status: 200, body: '<comps><pagination nbpages="1" nbresultats="0"/></comps>' } }),
    );
    expect(vacio.estado).toBe('sin_pruebas');
    const roto = await leerTorneoEngarde('rfee', 'med2024', depsCon({ [post]: { status: 500, body: '' } }));
    expect(roto.estado).toBe('error');
  });

  it('rechaza segmentos con caracteres no válidos sin hacer peticiones', async () => {
    let llamadas = 0;
    const deps: DepsEngarde = { get: async () => (llamadas++, { status: 200, body: '' }), post: async () => (llamadas++, { status: 200, body: '' }) };
    const r = await leerTorneoEngarde('../etc', 'x', deps);
    expect(r.estado).toBe('error');
    expect(llamadas).toBe(0);
  });
});

describe('Fencing Worldwide', () => {
  const html = fixture('fww-basel-u17-resultados.html');

  it('interpreta la miga de pan (etiquetas en alemán bajo /en/) y la lista de resultados', () => {
    const p = parsearResultadosFww(html);
    expect(p).toMatchObject({
      torneo: 'World Cup of Switzerland',
      arma: 'ESPADA',
      genero: 'M',
      categoria: 'M17',
      formato: 'INDIVIDUAL',
      ciudad: 'Basel',
      pais: 'SUI',
      fecha: '2026-01-02',
      hayTabla: true,
    });
    expect(p.filas).toHaveLength(35);
  });

  it('«T3.» es un empate en el puesto 3 y cada atleta lleva su ID FWW como clave', () => {
    const p = parsearResultadosFww(html);
    const empatado = p.filas.find((f) => f.puestoRaw === 'T3.')!;
    expect(empatado.puesto).toBe(3);
    const claves = puestosDeFww(p).map((x) => x.clave);
    expect(new Set(claves).size).toBe(35);
    expect(claves[0]).toBe('fww:athlete:90001');
  });

  it('sólo acepta URLs de Fencing Worldwide y distingue la temporada del año de la fecha', () => {
    expect(parsearUrlFww('https://www.fencingworldwide.com/en/926885-2025/results/')).toEqual({
      idioma: 'en',
      id: '926885',
      temporada: '2025',
      seccion: 'results',
      ruta: 'results',
    });
    expect(parsearUrlFww('https://www.fencingworldwide.com/en/926885-2025/pools/1')).toMatchObject({ seccion: 'pools', ruta: 'pools/1' });
    expect(parsearUrlFww('https://www.fencingworldwide.com/en/926885-2025/direct/2/?x=1#y')).toMatchObject({ seccion: 'direct', ruta: 'direct/2' });
    expect(parsearUrlFww('https://www.fencingworldwide.com/en/926885-2025/')).toMatchObject({ seccion: null, ruta: '' });
    expect(parsearUrlFww('https://www.fencingworldwide.com/en/926885-2025/pools/1/../../x.php')).toBeNull();
    expect(parsearUrlFww('https://evil.example/en/926885-2025/results/')).toBeNull();
    expect(parsearUrlFww('ftp://www.fencingworldwide.com/en/1-2025/')).toBeNull();
    expect(parsearUrlFww('https://www.fencingworldwide.com/en/')).toBeNull();
  });

  it('404 = no publicado, 500 = error, página sin tabla = no publicado', async () => {
    const url = 'https://www.fencingworldwide.com/en/926885-2025/results/';
    const entrada = 'https://www.fencingworldwide.com/en/926885-2025/';
    expect((await leerResultadosFww(entrada, depsCon({ [url]: { status: 404, body: '' } }))).estado).toBe('no_publicado');
    expect((await leerResultadosFww(entrada, depsCon({ [url]: { status: 500, body: '' } }))).estado).toBe('error');
    expect((await leerResultadosFww(entrada, depsCon({ [url]: { status: 200, body: '<html></html>' } }))).estado).toBe('no_publicado');
    expect((await leerResultadosFww(entrada, depsCon({ [url]: { status: 200, body: html } }))).estado).toBe('completo');
  });
});
