import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PruebaCanonica } from '@/lib/ingest/conciliar-complementario';
import {
  canonicaDeFie,
  clasificarEnlace,
  descubrirEnlacesFie,
  enlaceDeOtroAnio,
  enlacesPublicadosFie,
  enlacesPublicadosSkermo,
  evaluarEnlacesOficiales,
  evaluarFichaFie,
  vistaEnlace,
} from '@/lib/ingest/enlaces-resultados';
import type { DepsEngarde } from '@/lib/ingest/sources/engarde';

const fixture = (n: string) => readFileSync(`tests/fixtures/complementarios/${n}`, 'utf8');
const GUID = '4f6c2a1e8d3b4c5f9a0b1c2d3e4f5a6b';
const POST = 'POST https://engarde-service.com/prog/getCompeForDisplay.php';

const bari: PruebaCanonica = {
  fuente: 'fie',
  season: '2027',
  clave: '1387',
  serie: null,
  nombreEdicion: 'Bari Grand Prix',
  ciudad: 'Bari',
  fecha: '2026-10-09',
  arma: 'ESPADA',
  genero: 'M',
  categoria: 'ABS',
  formato: 'INDIVIDUAL',
};
const med2024: PruebaCanonica = {
  ...bari,
  fuente: 'skermo_rfee',
  season: '2024',
  clave: 'm1',
  serie: 'campeonato_mediterraneo',
  ciudad: 'La Nucía',
  fecha: '2024-02-03',
  categoria: 'M17',
};

const depsCon = (r: Record<string, { status: number; body: string } | Error>): DepsEngarde & { pedidas: string[] } => {
  const pedidas: string[] = [];
  const resp = async (clave: string, url: string) => {
    pedidas.push(url);
    const x = r[clave];
    if (!x) return { status: 404, body: '' };
    if (x instanceof Error) throw x;
    return x;
  };
  return { pedidas, get: (u) => resp(u, u), post: (u) => resp(`POST ${u}`, u) };
};

describe('clasificarEnlace', () => {
  it('reconoce enlaces específicos y los distingue de portadas', () => {
    expect(clasificarEnlace('https://engarde-service.com/competition/rfee/med2024/em17')).toMatchObject({
      proveedor: 'engarde',
      alcance: 'prueba',
      engarde: { org: 'rfee', evt: 'med2024', compe: 'em17' },
    });
    expect(clasificarEnlace('https://engarde-service.com/tournament/rfee/med2024')).toMatchObject({ alcance: 'torneo' });
    expect(clasificarEnlace('https://engarde-service.com/')).toMatchObject({ alcance: 'generico' });
    expect(clasificarEnlace('https://www.fencingtimelive.com/')).toMatchObject({ proveedor: 'ftl', alcance: 'generico' });
    expect(clasificarEnlace(`https://www.fencingtimelive.com/tournaments/eventSchedule/${GUID}#today`)).toMatchObject({
      proveedor: 'ftl',
      alcance: 'torneo',
      url: `https://www.fencingtimelive.com/tournaments/eventSchedule/${GUID}`,
    });
    expect(clasificarEnlace('https://www.los-deportes.info/esgrima')).toMatchObject({ proveedor: 'los_deportes' });
  });

  it('descarta esquemas no http y texto que no es URL', () => {
    expect(clasificarEnlace('javascript:alert(1)')).toBeNull();
    expect(clasificarEnlace('no es una url')).toBeNull();
  });

  it('el año que declara la URL se compara con la fecha de la prueba', () => {
    const viejo = clasificarEnlace('https://engarde-service.com/competition/rfee/med2022/em17')!;
    expect(enlaceDeOtroAnio(viejo, '2024-02-03')).toBe(true);
    const mismo = clasificarEnlace('https://engarde-service.com/competition/rfee/med2024/em17')!;
    expect(enlaceDeOtroAnio(mismo, '2024-02-03')).toBe(false);
    expect(enlaceDeOtroAnio(mismo, null)).toBe(false);
  });
});

describe('enlaces publicados por las fuentes oficiales', () => {
  it('la FIE publica livestreamResultsLink, livestreamLink y officialSite', () => {
    const l = enlacesPublicadosFie({
      livestreamResultsLink: `https://www.fencingtimelive.com/tournaments/eventSchedule/${GUID}#today`,
      livestreamLink: '',
      officialSite: null,
      extra: 1,
    });
    expect(l).toEqual([{ url: `https://www.fencingtimelive.com/tournaments/eventSchedule/${GUID}#today`, origen: 'fie' }]);
    expect(enlacesPublicadosFie('basura')).toEqual([]);
  });

  it('Skermo aporta enlaces externos y de directo', () => {
    expect(enlacesPublicadosSkermo({ externalUrls: ['https://a.example/x'], liveLinks: [{ url: 'https://b.example/y' }] }).map((x) => x.origen)).toEqual(['skermo', 'skermo']);
  });
});

describe('evaluarEnlacesOficiales', () => {
  it('FTL específico queda sólo como enlace: no implica resultados importados ni se consulta', async () => {
    const deps = depsCon({});
    const r = await evaluarEnlacesOficiales(
      bari,
      [{ url: `https://www.fencingtimelive.com/tournaments/eventSchedule/${GUID}#today`, origen: 'fie' }],
      deps,
    );
    expect(r.ftl).toMatchObject({ estado: 'solo_enlace', resultadosImportados: false });
    expect(r.ftl.url).toBe(`https://www.fencingtimelive.com/tournaments/eventSchedule/${GUID}`);
    expect(vistaEnlace(r.ftl).texto).toMatch(/requiere cuenta/);
    expect(r.engarde.estado).toBe('no_publicado');
    expect(r.fww.estado).toBe('no_publicado');
    expect(deps.pedidas).toEqual([]);
  });

  it('una portada de FTL o de Engarde se rechaza y no se ofrece como resultados', async () => {
    const r = await evaluarEnlacesOficiales(
      bari,
      [
        { url: 'https://www.fencingtimelive.com/', origen: 'fie' },
        { url: 'https://engarde-service.com/', origen: 'organizador' },
      ],
      depsCon({}),
    );
    expect(r.ftl).toMatchObject({ estado: 'rechazado', url: null, motivos: ['portada_generica'] });
    expect(r.engarde).toMatchObject({ estado: 'rechazado', url: null });
    expect(vistaEnlace(r.ftl).href).toBeNull();
  });

  it('sin enlace publicado es «aún no publicado», no cero resultados ni error', async () => {
    const r = await evaluarEnlacesOficiales(bari, [], depsCon({}));
    for (const p of ['engarde', 'fww', 'ftl'] as const) {
      expect(r[p]).toMatchObject({ estado: 'no_publicado', url: null, resultadosImportados: false });
      expect(vistaEnlace(r[p])).toEqual({ href: null, texto: 'Enlace aún no publicado' });
    }
  });

  it('Engarde se verifica contra el índice público: edición, sede, arma, categoría y modalidad', async () => {
    const deps = depsCon({ [POST]: { status: 200, body: fixture('engarde-indice-med2024.xml') }, 'https://engarde-service.com/tournament/rfee/med2024': { status: 200, body: '<div class="tounament-title">MEDITERRANEAN CHAMPIONSHIP 2024</div>' } });
    const r = await evaluarEnlacesOficiales(
      med2024,
      [{ url: 'https://engarde-service.com/competition/rfee/med2024/em17', origen: 'organizador' }],
      deps,
    );
    expect(r.engarde).toMatchObject({
      estado: 'verificado',
      url: 'https://engarde-service.com/competition/rfee/med2024/em17',
      resultadosImportados: false,
    });
  });

  it('un enlace Engarde de otra prueba o categoría no se verifica (homónimo)', async () => {
    const deps = depsCon({ [POST]: { status: 200, body: fixture('engarde-indice-med2024.xml') }, 'https://engarde-service.com/tournament/rfee/med2024': { status: 200, body: '<div class="tounament-title">MEDITERRANEAN CHAMPIONSHIP 2024</div>' } });
    const r = await evaluarEnlacesOficiales(
      med2024,
      [{ url: 'https://engarde-service.com/competition/rfee/med2024/em15', origen: 'organizador' }],
      deps,
    );
    expect(r.engarde.estado).toBe('rechazado');
    expect(r.engarde.url).toBeNull();
  });

  it('un enlace de otro año se rechaza sin pedir nada', async () => {
    const deps = depsCon({});
    const r = await evaluarEnlacesOficiales(
      med2024,
      [{ url: 'https://engarde-service.com/competition/rfee/med2019/em17', origen: 'organizador' }],
      deps,
    );
    expect(r.engarde).toMatchObject({ estado: 'rechazado', motivos: ['otro_anio'] });
    expect(deps.pedidas).toEqual([]);
  });

  it('el fallo de red de Engarde es error, no «no publicado»', async () => {
    const r = await evaluarEnlacesOficiales(
      med2024,
      [{ url: 'https://engarde-service.com/competition/rfee/med2024/em17', origen: 'organizador' }],
      depsCon({ [POST]: new Error('ECONNRESET') }),
    );
    expect(r.engarde).toMatchObject({ estado: 'error', motivos: ['no_comprobable'] });
  });

  it('FWW se verifica contra la miga de pan de la propia prueba', async () => {
    const fww = 'https://www.fencingworldwide.com/en/926885-2025/results/';
    const basel: PruebaCanonica = { ...bari, fuente: 'fie', season: '2026', clave: 'b', ciudad: 'Basel', fecha: '2026-01-02', categoria: 'M17' };
    const ok = await evaluarEnlacesOficiales(basel, [{ url: fww, origen: 'fie' }], depsCon({ [fww]: { status: 200, body: fixture('fww-basel-u17-resultados.html') } }));
    expect(ok.fww).toMatchObject({ estado: 'verificado', url: fww });
    const otra = await evaluarEnlacesOficiales({ ...basel, arma: 'SABLE' }, [{ url: fww, origen: 'fie' }], depsCon({ [fww]: { status: 200, body: fixture('fww-basel-u17-resultados.html') } }));
    expect(otra.fww.estado).toBe('rechazado');
  });
});

describe('ficha FIE: HTML 500 con JSON 200 (Bari)', () => {
  const urlHtml = 'https://fie.org/competitions/2027/1387';

  it('mantiene los datos del JSON y no presenta como funcional el enlace roto ni inventa otro', () => {
    const e = evaluarFichaFie({ jsonStatus: 200, htmlStatus: 500, urlHtml });
    expect(e.datos).toBe('json');
    expect(e.enlaceFicha).toBeNull();
    expect(e.aviso).toMatch(/HTTP 500.*JSON oficial/);
  });

  it('una alternativa ya verificada sí puede ofrecerse; con HTML 200 se ofrece la ficha', () => {
    expect(evaluarFichaFie({ jsonStatus: 200, htmlStatus: 500, urlHtml, alternativaVerificada: 'https://x.example/ok' }).enlaceFicha).toBe('https://x.example/ok');
    expect(evaluarFichaFie({ jsonStatus: 200, htmlStatus: 200, urlHtml })).toMatchObject({ enlaceFicha: urlHtml, aviso: null });
  });

  it('sin JSON no hay datos: 404 es «no publicada» y no un fallo', () => {
    expect(evaluarFichaFie({ jsonStatus: 404, htmlStatus: 404, urlHtml })).toMatchObject({ datos: 'ninguno' });
    expect(evaluarFichaFie({ jsonStatus: 404, htmlStatus: 404, urlHtml }).aviso).toMatch(/no publica/);
  });

  it('descubrirEnlacesFie: JSON 200 con HTML 500 evalúa los enlaces del JSON sin invalidarlo', async () => {
    const meta = {
      competitionId: 1387,
      season: 2027,
      name: 'Bari Grand Prix',
      type: 'I',
      category: 'Senior',
      location: 'Bari',
      startDate: '2026-10-09',
      weapon: 'E',
      gender: 'M',
      livestreamResultsLink: `https://www.fencingtimelive.com/tournaments/eventSchedule/${GUID}#today`,
    };
    const deps = depsCon({
      'https://fie.org/api/fie/competition/2027/1387': { status: 200, body: JSON.stringify(meta) },
      [urlHtml]: { status: 500, body: '' },
    });
    const d = await descubrirEnlacesFie(deps, 2027, 1387);
    expect(d.ficha).toMatchObject({ datos: 'json', htmlStatus: 500, enlaceFicha: null });
    expect(d.prueba).toMatchObject({ arma: 'ESPADA', genero: 'M', clave: '1387' });
    expect(d.enlaces?.ftl.estado).toBe('solo_enlace');
    expect(d.enlaces?.ftl.resultadosImportados).toBe(false);
  });

  it('descubrirEnlacesFie: si ni el JSON responde no se evalúa nada (distinto de «aún no publicado»)', async () => {
    const d = await descubrirEnlacesFie(depsCon({ [urlHtml]: { status: 500, body: '' } }), 2027, 1387);
    expect(d.enlaces).toBeNull();
    expect(d.prueba).toBeNull();
  });

  it('canonicaDeFie rechaza una metadata que no es de la prueba pedida', () => {
    expect(canonicaDeFie({ competitionId: 1, season: 2027, weapon: 'E' }, 2027, 2)).toBeNull();
    expect(canonicaDeFie({ competitionId: 1, season: 2027, name: 'Paris', competitionCategory: 'JO' }, 2027, 1)).toMatchObject({
      serie: 'juegos_olimpicos',
      arma: null,
      categoria: null,
    });
  });
});
