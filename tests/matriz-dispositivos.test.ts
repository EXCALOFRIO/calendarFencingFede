import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
// `.mjs` y no `.mts`: tsc sólo admite la segunda con allowImportingTsExtensions; Vite y tsx resuelven `.mjs` al `.mts`.
import {
  arneses, calcularFallos, DISPOSITIVOS, evaluar, informeMarkdown, nombrePagina, parsearArgumentos, parsearMatriz, peores,
  SIN_ARNES, type Medida, type Registro,
} from './ui/matriz-config.mjs';
import { guionPrevio, medirEnPagina } from './ui/matriz-medir.mjs';

const medidaVacia: Medida = {
  ancho: 393, alto: 800, desborde: 0, culpables: [], cortados: [], solapados: [], tactiles: [], grandes: [],
  textoPequeno: [], textoPequenoTotal: 0, contraste: [], contrasteTotal: 0, truncados: [], imagenes: [], cls: 0, fcp: 300,
};

describe('parsearMatriz', () => {
  it('el modo completo tiene los 11 dispositivos en oscuro y claro y el texto grande en dos móviles', () => {
    const v = parsearMatriz();
    expect(DISPOSITIVOS).toHaveLength(11);
    expect(v).toHaveLength(11 * 2 + 2);
    expect(v.filter((x) => x.texto === 130).map((x) => x.clave)).toEqual(['iphone-se-texto130', 'iphone-15-texto130']);
    expect(v.find((x) => x.clave === 'iphone-se')).toMatchObject({ ancho: 320, alto: 568, movil: true, tactil: true, tema: 'oscuro' });
    expect(v.find((x) => x.clave === 'escritorio-fhd-claro')).toMatchObject({ ancho: 1920, alto: 1080, tactil: false, tema: 'claro' });
    expect(new Set(v.map((x) => x.clave)).size).toBe(v.length);
  });

  it('el modo rápido es un móvil y un escritorio, más el móvil con texto grande', () => {
    expect(parsearMatriz({ rapido: true }).map((x) => x.clave)).toEqual(['iphone-15', 'escritorio', 'iphone-15-texto130']);
    expect(parsearMatriz({ rapido: true, textoGrande: false }).map((x) => x.clave)).toEqual(['iphone-15', 'escritorio']);
  });

  it('filtra dispositivos y temas y rechaza los desconocidos', () => {
    expect(parsearMatriz({ dispositivos: 'ipad-mini, portatil', temas: 'claro' }).map((x) => x.clave)).toEqual(['ipad-mini-claro', 'portatil-claro']);
    expect(() => parsearMatriz({ dispositivos: 'nokia-3310' })).toThrow(/desconocido/);
    expect(() => parsearMatriz({ temas: 'sepia' })).toThrow(/desconocido/);
  });

  it('lee los argumentos de la línea de órdenes', () => {
    expect(parsearArgumentos(['--rapido', '--solo=perfil,ranking', '--paralelo=3', '--sin-texto'])).toMatchObject({
      rapido: true, solo: ['perfil', 'ranking'], paralelo: 3, textoGrande: false, listar: false,
    });
    expect(parsearArgumentos([]).paralelo).toBe(2);
    expect(() => parsearArgumentos(['--paralelo=0'])).toThrow();
  });
});

describe('arneses y nombres', () => {
  it('el calendario pide el mes actual y el anterior', () => {
    const cal = arneses(new Date(2026, 0, 15)).find((a) => a.alias === 'calendario')!;
    expect(cal.env?.MESES).toBe('2026-01,2025-12');
    expect(cal.paginas.test('/2026-01-mes')).toBe(true);
  });

  it('cada arnés tiene un alias único y su fichero existe', () => {
    const a = arneses();
    expect(new Set(a.map((x) => x.alias)).size).toBe(a.length);
    for (const x of a) expect(existsSync(new URL(`./ui/${x.fichero}`, import.meta.url)), x.fichero).toBe(true);
  });

  it('las notificaciones entran en la matriz con sus cinco páginas', () => {
    const n = arneses().find((a) => a.alias === 'notificaciones')!;
    expect(n.fichero).toBe('notificaciones.mts');
    for (const ruta of ['/bandeja', '/bandeja-vacia', '/ajustes', '/ajustes-iphone', '/ajustes-activo']) expect(n.paginas.test(ruta), ruta).toBe(true);
    expect(n.paginas.test('/abrir')).toBe(false);
    expect(nombrePagina('notificaciones', '/bandeja')).toBe('notificaciones-bandeja');
    expect(SIN_ARNES).toEqual([]);
  });

  it('nombra la página con el alias delante, sin repetirlo', () => {
    expect(nombrePagina('perfil', '/llavador-rivales')).toBe('perfil-llavador-rivales');
    expect(nombrePagina('explorar', '/explorar?q=alejandro')).toBe('explorar-q-alejandro');
    expect(nombrePagina('explorar', '/explorar')).toBe('explorar');
    expect(nombrePagina('ranking', '/espanol-cabecera', { '/espanol-cabecera': 'perfil-cabecera' })).toBe('perfil-cabecera');
  });
});

describe('calcularFallos', () => {
  const base = { tactil: true, consola: [] as string[] };

  it('una página limpia no tiene fallos', () => {
    expect(calcularFallos({ ...base, medida: medidaVacia })).toEqual([]);
  });

  it('prioriza el desborde y las páginas que no cargan', () => {
    const f = calcularFallos({ ...base, medida: { ...medidaVacia, desborde: 12, culpables: ['12px div'], textoPequenoTotal: 3, textoPequeno: ['a', 'b', 'c'] } });
    expect(f.map((x) => x.tipo)).toEqual(['desborde', 'texto']);
    expect(f[0]!.ejemplos[0]).toBe('12 px de más');
    expect(calcularFallos({ ...base, error: 'net::ERR' })).toEqual([expect.objectContaining({ tipo: 'error', puntos: 60 })]);
  });

  it('los táctiles sólo cuentan en dispositivos táctiles y los topes limitan los puntos', () => {
    const medida = { ...medidaVacia, tactiles: Array.from({ length: 30 }, (_, i) => `t${i}`) };
    expect(calcularFallos({ tactil: false, consola: [], medida })).toEqual([]);
    expect(calcularFallos({ tactil: true, consola: [], medida })[0]).toMatchObject({ tipo: 'tactil', cuenta: 30, puntos: 30 });
  });

  it('CLS, FCP y consola por encima de sus umbrales', () => {
    const f = calcularFallos({ tactil: false, consola: ['x'], medida: { ...medidaVacia, cls: 0.3, fcp: 2500 } });
    expect(f.map((x) => x.tipo).sort()).toEqual(['cls', 'consola', 'fcp']);
    expect(f.find((x) => x.tipo === 'cls')!.puntos).toBe(30);
  });

  it('peores no deja que una página acapare la lista', () => {
    const filas = [...Array.from({ length: 5 }, (_, i) => ({ pagina: 'a', puntos: 100 - i })), { pagina: 'b', puntos: 10 }, { pagina: 'c', puntos: 0 }];
    expect(peores(filas).map((f) => `${f.pagina}${f.puntos}`)).toEqual(['a100', 'a99', 'a98', 'b10']);
    expect(peores(filas, 2)).toHaveLength(2);
  });

  it('evaluar ordena por puntos y el informe trae las peores', () => {
    const r = (pagina: string, medida: Medida): Registro => ({ alias: 'a', pagina, ruta: `/${pagina}`, variante: 'iphone-se', tactil: true, captura: null, ms: 1, consola: [], medida });
    const filas = evaluar([r('limpia', medidaVacia), r('rota', { ...medidaVacia, desborde: 5 })]);
    expect(filas.map((f) => f.pagina)).toEqual(['rota', 'limpia']);
    const md = informeMarkdown({ generado: 'hoy', modo: 'prueba', variantes: parsearMatriz({ rapido: true }), arneses: [], filas });
    expect(md).toContain('## Peores 20');
    expect(md).toMatch(/1\. \*\*rota\*\* en \*\*iphone-se\*\*/);
    expect(md).not.toMatch(/\*\*limpia\*\*/);
  });
});

const EJEMPLO = `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;background:#000;color:#fff;font:16px sans-serif} .caja{background:#333;border:1px solid #666}</style></head><body>
<button id="mini" class="caja" style="width:24px;height:24px;padding:0">x</button>
<button id="gordo" class="caja" style="height:56px">Guardar</button>
<button id="justo" class="caja" style="height:44px;min-width:44px">Bien</button>
<p style="font-size:10px">Letra diminuta</p>
<p style="color:#333">Poco contraste</p>
<p>Un párrafo con <a href="#">enlace en línea</a> que no cuenta como objetivo táctil.</p>
<div style="position:relative;height:30px"><span style="position:absolute;top:0;left:0">Encima</span><span style="position:absolute;top:2px;left:4px">Debajo</span></div>
<div style="width:60px;overflow:hidden;white-space:nowrap">Un texto que no cabe y se corta</div>
<div style="width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Truncado con elipsis</div>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">
<div style="width:600px;height:10px;background:#111"></div>
</body></html>`;

describe('medirEnPagina con un HTML de ejemplo', () => {
  let navegador: Browser;
  beforeAll(async () => { navegador = await chromium.launch(); }, 60_000);
  afterAll(async () => { await navegador?.close(); }, 60_000);

  async function medir(html: string, contexto: NonNullable<Parameters<Browser['newContext']>[0]>, guion?: string) {
    const ctx = await navegador.newContext(contexto);
    if (guion) await ctx.addInitScript({ content: guion });
    const p = await ctx.newPage();
    // Por una ruta y no con setContent: los guiones previos sólo corren al navegar.
    await p.route('http://matriz.test/', (r) => r.fulfill({ body: html, contentType: 'text/html; charset=utf-8' }));
    await p.goto('http://matriz.test/');
    await p.evaluate('window.__name = window.__name || ((f) => f)');
    const m = await p.evaluate(medirEnPagina, { tactil: 40, grande: 44, texto: 12, contraste: 4.5, ancho: contexto.viewport?.width });
    const raiz = await p.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    await ctx.close();
    return { m, raiz };
  }

  it('detecta cada tipo de fallo en un móvil de 393 px', async () => {
    const { m } = await medir(EJEMPLO, { viewport: { width: 393, height: 800 }, isMobile: true, hasTouch: true });
    // Con isMobile la escala de ajuste puede redondear un píxel.
    expect(m.desborde).toBeGreaterThanOrEqual(600 - 393);
    expect(m.culpables.join()).toMatch(/^20[78]px div/);
    expect(m.tactiles.join('\n')).toMatch(/24x24 button «x»/);
    expect(m.tactiles.join('\n')).not.toMatch(/enlace en línea/);
    expect(m.tactiles.join('\n')).not.toMatch(/Bien/);
    expect(m.grandes).toEqual([expect.stringMatching(/^56px button «Guardar»/)]);
    expect(m.textoPequeno.join()).toMatch(/10px p «Letra diminuta»/);
    expect(m.contraste.join()).toMatch(/Poco contraste/);
    expect(m.solapados.join()).toMatch(/Encima.*Debajo/);
    expect(m.cortados.join()).toMatch(/ancho div «Un texto que no cabe/);
    expect(m.cortados.join()).not.toMatch(/Truncado/);
    expect(m.truncados.join()).toMatch(/Truncado con elipsis/);
    expect(m.imagenes).toEqual([expect.stringMatching(/^sin width\/height/)]);

    const f = calcularFallos({ tactil: true, consola: [], medida: m });
    expect(f[0]!.tipo).toBe('desborde');
    expect(new Set(f.map((x) => x.tipo))).toEqual(new Set(['desborde', 'solapado', 'cortado', 'tactil', 'contraste', 'imagen', 'texto', 'grande']));
  }, 60_000);

  it('una página correcta pasa sin fallos (la cara trasera de una tarjeta y una barra fija no son solapes)', async () => {
    const limpia = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{margin:0;background:#000;color:#fff;font:16px sans-serif}</style></head>
<body><p style="margin-top:40px">Hola</p>
<div style="display:grid;transform-style:preserve-3d"><div style="grid-area:1/1;backface-visibility:hidden">Cara de delante</div><div style="grid-area:1/1;backface-visibility:hidden;transform:rotateY(180deg)">Cara de detrás</div></div>
<div style="position:fixed;top:40px;left:0;right:0;background:#111">Barra fija encima de Hola</div>
<button style="height:44px;width:120px;background:#333;color:#fff;border:0">Seguir</button><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="1" height="1" alt=""></body></html>`;
    const { m } = await medir(limpia, { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    expect(calcularFallos({ tactil: true, consola: [], medida: m })).toEqual([]);
  }, 60_000);

  it('el texto grande multiplica el tamaño raíz de la hoja', async () => {
    const html = '<!doctype html><html><head><style>html{font-size:18px}</style></head><body><p>x</p></body></html>';
    const { raiz } = await medir(html, { viewport: { width: 393, height: 800 } }, guionPrevio({ texto: 130, quitarOscuro: false }));
    expect(parseFloat(raiz)).toBeCloseTo(23.4, 1);
  }, 60_000);
});
