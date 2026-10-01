import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AcumuladorAsaltos } from '@/lib/ingest/asaltos-complementarios';
import type { DepsEngarde, PruebaEngarde } from '@/lib/ingest/sources/engarde';
import { parsearPaginaEngarde } from '@/lib/ingest/sources/engarde';
import {
  claveRondaCuadro,
  leerCuadroEngarde,
  parsearCuadroEngarde,
  urlsCuadroDePrueba,
} from '@/lib/ingest/sources/engarde-cuadro';
import {
  agregarLecturasFww,
  leerDestinoFww,
  parsearDirectaFww,
  parsearPoulesFww,
} from '@/lib/ingest/sources/fww-asaltos';

const fixture = (n: string) => readFileSync(`tests/fixtures/complementarios/${n}`, 'utf8');
const CUADRO = fixture('engarde-ctomadabs19-emabsind-cuadro.html');
const CUADRO_EQUIPOS = fixture('engarde-ctomadabs19-fmabseq-cuadro-equipos.html');
const POOLS = fixture('fww-basel-u17-pools1.html');
const DIRECTA = fixture('fww-basel-u17-direct2.html');

const depsCon = (r: Record<string, { status: number; body: string } | Error>): Pick<DepsEngarde, 'get'> & { pedidas: string[] } => {
  const pedidas: string[] = [];
  return {
    pedidas,
    get: async (u) => {
      pedidas.push(u);
      const x = r[u];
      if (!x) return { status: 404, body: '' };
      if (x instanceof Error) throw x;
      return x;
    },
  };
};

describe('cuadro Engarde (Campeonato de Madrid ABS 2019, individual)', () => {
  it('lee los 15 cruces del cuadro de 16 con ronda, ganador primero y marcador', () => {
    const c = parsearCuadroEngarde(CUADRO, { individual: true });
    expect(c.estado).toBe('leido');
    expect(c.rondas).toEqual(['T16', 'T8', 'SF', 'F']);
    expect(c.publicado).toBe(15);
    expect(c.importado).toBe(15);
    expect(c.completo).toBe(true);
    const porRonda = (r: string) => c.asaltos.filter((a) => a.ronda === r).length;
    expect([porRonda('T16'), porRonda('T8'), porRonda('SF'), porRonda('F')]).toEqual([8, 4, 2, 1]);
    expect(c.asaltos.every((a) => a.fase === 'TABLEAU' && a.refA < a.refB)).toBe(true);
  });

  it('atribuye marcador, rival y fase al cruce correcto: 15/1 en T16 y la final 15/11', () => {
    const c = parsearCuadroEngarde(CUADRO, { individual: true });
    const t16 = c.asaltos.find((a) => a.ronda === 'T16' && [a.nombreA, a.nombreB].includes('APELLIDO2 Nombre2'))!;
    const puntosDe = (a: typeof t16, nombre: string) => (a.nombreA === nombre ? a.puntosA : a.puntosB);
    expect(puntosDe(t16, 'APELLIDO1 Nombre1')).toBe(15);
    expect(puntosDe(t16, 'APELLIDO2 Nombre2')).toBe(1);
    const final = c.asaltos.find((a) => a.ronda === 'F')!;
    expect([final.nombreA, final.nombreB].sort()).toEqual(['APELLIDO5 Nombre5', 'APELLIDO9 Nombre9']);
    expect(puntosDe(final, 'APELLIDO9 Nombre9')).toBe(15);
    expect(puntosDe(final, 'APELLIDO5 Nombre5')).toBe(11);
  });

  it('la referencia es nombre + nación de la primera ronda y no es una persona', () => {
    const c = parsearCuadroEngarde(CUADRO, { individual: true });
    const refs = new Set(c.asaltos.flatMap((a) => [a.refA, a.refB]));
    expect(refs.size).toBe(16);
    expect([...refs].every((r) => /^engarde:[a-z0-9 ]+\|[A-Z-]+$/.test(r))).toBe(true);
  });

  it('un cuadro de equipos, o de modalidad no verificada, no genera H2H', () => {
    for (const individual of [false, null]) {
      const c = parsearCuadroEngarde(CUADRO, { individual });
      expect(c).toMatchObject({ estado: 'equipos', asaltos: [], importado: 0, completo: false });
    }
    expect(parsearCuadroEngarde(CUADRO_EQUIPOS, { individual: false }).asaltos).toEqual([]);
  });

  it('una página sin cuadro no es un cuadro vacío', () => {
    expect(parsearCuadroEngarde('<html><body><h1>Nada</h1></body></html>', { individual: true }).estado).toBe('sin_cuadro');
  });

  it('un marcador dudoso (empate, texto, ganador con menos) se excluye y la lectura queda parcial', () => {
    for (const malo of ['15/15', '15/ab', '3/15']) {
      const c = parsearCuadroEngarde(CUADRO.replace('15/1<', `${malo}<`), { individual: true });
      expect(c.importado).toBe(14);
      expect(c.publicado).toBe(15);
      expect(c.excluidos.sinMarcador).toBe(1);
      expect(c.completo).toBe(false);
    }
  });

  it('un ganador que no es ninguno de los dos contendientes es incoherente, no se adivina', () => {
    const roto = CUADRO.replace(
      /(<td class="HBD fencer quarter1">) APELLIDO1 Nombre1 (<\/td>\s*<\/tr>\s*<tr>\s*<td class="D placeNumber quarter1">16 )/,
      '$1 APELLIDO99 Nombre99 $2',
    );
    expect(roto).not.toBe(CUADRO);
    const c = parsearCuadroEngarde(roto, { individual: true });
    expect(c.excluidos.incoherente).toBeGreaterThanOrEqual(1);
    expect(c.completo).toBe(false);
    expect(c.asaltos.some((a) => [a.nombreA, a.nombreB].includes('APELLIDO99 Nombre99'))).toBe(false);
  });

  it('un nombre repetido en la primera ronda es ambiguo y no genera asaltos para él', () => {
    const c = parsearCuadroEngarde(CUADRO.replaceAll('APELLIDO16 Nombre16', 'APELLIDO15 Nombre15'), { individual: true });
    expect(c.asaltos.some((a) => [a.nombreA, a.nombreB].includes('APELLIDO15 Nombre15'))).toBe(false);
    expect(c.completo).toBe(false);
    expect(c.excluidos.sinParticipante).toBeGreaterThan(0);
  });

  it('una columna de tercer lugar tras la final impide ubicar al ganador de la final: queda excluida', () => {
    const conBronce = CUADRO.replace('<td class="tableTitle">  Final</td>', '<td class="tableTitle">  Final</td><td class="tableTitle">  Tercer lugar</td>');
    const c = parsearCuadroEngarde(conBronce, { individual: true });
    expect(c.asaltos.some((a) => a.ronda === 'F')).toBe(false);
    expect(c.excluidos.rondaDesconocida).toBeGreaterThan(0);
    expect(c.completo).toBe(false);
  });

  it('claveRondaCuadro reconoce rondas regulares en varios idiomas y no el tercer lugar', () => {
    expect(['Tableau of 16', 'Tableau de 8', 'Table of 32', 'Semi-finales', 'Semi-Final', 'Final', 'Finale'].map(claveRondaCuadro)).toEqual([
      'T16',
      'T8',
      'T32',
      'SF',
      'SF',
      'F',
      'F',
    ]);
    expect(claveRondaCuadro('Tercer lugar')).toBeNull();
  });
});

describe('lectura del cuadro Engarde por red', () => {
  const prueba = (extra: Partial<PruebaEngarde> = {}): PruebaEngarde => ({
    org: 'fme',
    evt: 'ctomadabs19',
    compe: 'emabsind',
    url: 'https://engarde-service.com/competition/fme/ctomadabs19/emabsind',
    titulo: 'Espada Masculina Individual',
    arma: 'ESPADA',
    genero: 'M',
    categoria: 'ABS',
    categoriaOriginal: 'senior',
    categoriaContradictoria: false,
    individual: true,
    fecha: '2019-09-28',
    ciudad: 'Rivas Vaci.',
    pais: 'ESP',
    estado: 'completed',
    ...extra,
  });
  const url = 'https://engarde-service.com/competition/fme/ctomadabs19/emabsind/tableau16.htm';

  it('los enlaces de cuadro sólo valen si cuelgan de la propia prueba', () => {
    const pagina = parsearPaginaEngarde(
      `<div id="reloadable"><h1>x</h1>
        <a href="/competition/fme/ctomadabs19/emabsind/tableau16.htm">c</a>
        <a href="/competition/fme/ctomadabs19/emabsind/tableau128-32.htm">c</a>
        <a href="/competition/fme/ctomadabs19/otra/tableau16.htm">otra prueba</a>
        <a href="/competition/fme/ctomadabs19/emabsind/poules1.htm">poules</a></div>`,
    );
    expect(pagina.cuadros).toHaveLength(3);
    expect(urlsCuadroDePrueba(prueba(), pagina)).toEqual([
      'https://engarde-service.com/competition/fme/ctomadabs19/emabsind/tableau16.htm',
      'https://engarde-service.com/competition/fme/ctomadabs19/emabsind/tableau128-32.htm',
    ]);
  });

  it('el menú de cuadros de la prueba real queda fuera de #reloadable y también se descubre', () => {
    const pagina = parsearPaginaEngarde(
      `<nav><a href="/competition/fme/ctomadabs19/emabsind/tableau16.htm">Tableau</a></nav><div id="reloadable"><h1>x</h1></div>`,
    );
    expect(urlsCuadroDePrueba(prueba(), pagina)).toEqual([
      'https://engarde-service.com/competition/fme/ctomadabs19/emabsind/tableau16.htm',
    ]);
  });

  it('lee el cuadro publicado y devuelve su cabecera para cotejar fecha y edición', async () => {
    const r = await leerCuadroEngarde(prueba(), [url], depsCon({ [url]: { status: 200, body: CUADRO } }));
    expect(r).toMatchObject({ estado: 'completo', parte: { importado: 15, publicado: 15 } });
    expect(r.pagina).toMatchObject({ tipo: 'cuadro', fecha: '2019-09-28' });
  });

  it('404 = no publicado; 5xx/red = error; sin enlace de cuadro = no publicado, no cero', async () => {
    expect((await leerCuadroEngarde(prueba(), [url], depsCon({ [url]: { status: 404, body: '' } }))).estado).toBe('no_publicado');
    expect((await leerCuadroEngarde(prueba(), [url], depsCon({ [url]: { status: 503, body: '' } }))).estado).toBe('error');
    expect((await leerCuadroEngarde(prueba(), [url], depsCon({ [url]: new Error('ECONNRESET') }))).estado).toBe('error');
    expect((await leerCuadroEngarde(prueba(), [], depsCon({}))).estado).toBe('no_publicado');
  });

  it('si una página de cuadro falla y otra se lee, lo leído se conserva como parcial', async () => {
    const otra = 'https://engarde-service.com/competition/fme/ctomadabs19/emabsind/tableau128-32.htm';
    const r = await leerCuadroEngarde(prueba(), [url, otra], depsCon({ [url]: { status: 200, body: CUADRO }, [otra]: { status: 500, body: '' } }));
    expect(r.estado).toBe('parcial');
    expect(r.parte?.importado).toBe(15);
  });

  it('una prueba por equipos o sin modalidad verificada no se pide', async () => {
    const deps = depsCon({});
    for (const individual of [false, null]) {
      const r = await leerCuadroEngarde(prueba({ individual }), [url], deps);
      expect(r.estado).toBe('no_publicado');
    }
    expect(deps.pedidas).toEqual([]);
  });
});

describe('poules FWW (pools/1)', () => {
  it('un asalto por pareja aunque la matriz publique las dos perspectivas', () => {
    const p = parsearPoulesFww(POOLS, 1);
    expect(p.publicado).toBe(p.importado);
    expect(p.completo).toBe(true);
    const rondas = new Set(p.asaltos.map((a) => a.ronda));
    expect([...rondas].sort()).toEqual(['R1P1', 'R1P2']);
    const pool1 = p.asaltos.filter((a) => a.ronda === 'R1P1');
    expect(pool1).toHaveLength(21);
    expect(new Set(pool1.map((a) => `${a.refA}|${a.refB}`)).size).toBe(21);
    expect(pool1.every((a) => a.fase === 'POULE' && a.refA < a.refB)).toBe(true);
  });

  it('el marcador sale de V/D de cada perspectiva y se orienta al participante de cada referencia', () => {
    const p = parsearPoulesFww(POOLS, 1);
    const a = p.asaltos.find((x) => x.ronda === 'R1P1' && x.refA === 'fww:athlete:90101' && x.refB === 'fww:athlete:90104')!;
    expect([a.puntosA, a.puntosB]).toEqual([5, 3]);
    const b = p.asaltos.find((x) => x.ronda === 'R1P1' && x.refA === 'fww:athlete:90101' && x.refB === 'fww:athlete:90102')!;
    expect([b.puntosA, b.puntosB]).toEqual([1, 5]);
  });

  it('el número de ronda forma parte de la clave: pools/2 no pisa a pools/1', () => {
    expect(parsearPoulesFww(POOLS, 2).asaltos.every((a) => a.ronda.startsWith('R2P'))).toBe(true);
  });

  it('una sola perspectiva, dos V o un V sin tanteo no producen asalto y dejan la lectura parcial', () => {
    const base = parsearPoulesFww(POOLS, 1);
    const filaUno = /(<td class="center[^>]*>1<\/td>\s*)<td style="background: black;"\s*>\s*<\/td>(\s*<td[^>]*>\s*)D1(\s*<\/td>)/;
    expect(POOLS).toMatch(filaUno);
    const sinPerspectiva = parsearPoulesFww(POOLS.replace(filaUno, '$1<td style="background: black;"></td>$2$3'), 1);
    expect(sinPerspectiva.importado).toBe(base.importado - 1);
    expect(sinPerspectiva.excluidos.noReciproco).toBe(1);
    expect(sinPerspectiva.completo).toBe(false);

    const dosV = parsearPoulesFww(POOLS.replace(filaUno, '$1<td style="background: black;"></td>$2V5$3'), 1);
    expect(dosV.excluidos.incoherente).toBe(1);
    expect(dosV.completo).toBe(false);

    const sinTanteo = parsearPoulesFww(POOLS.replace(filaUno, '$1<td style="background: black;"></td>$2D$3'), 1);
    expect(sinTanteo.excluidos.sinMarcador).toBe(1);
  });

  it('un participante sin ID FWW no genera asaltos con nombre como identidad', () => {
    const sinId = POOLS.replace(/<a href="\/athlete\/90101\/"[^>]*>APELLIDO1 Nombre1<\/a>/, 'APELLIDO1 Nombre1');
    expect(sinId).not.toBe(POOLS);
    const p = parsearPoulesFww(sinId, 1);
    expect(p.asaltos.some((a) => [a.nombreA, a.nombreB].includes('APELLIDO1 Nombre1') && a.ronda === 'R1P1')).toBe(false);
    expect(p.excluidos.sinParticipante).toBeGreaterThan(0);
  });
});

describe('cuadro directo FWW (direct/2)', () => {
  it('lee cruces con ronda, ganador y marcador; el BYE no es un asalto', () => {
    const d = parsearDirectaFww(DIRECTA);
    expect(d.excluidos.bye).toBe(1);
    expect(d.importado).toBe(9);
    expect(d.publicado).toBe(9);
    expect(d.completo).toBe(true);
    const porRonda = (r: string) => d.asaltos.filter((a) => a.ronda === r).length;
    expect([porRonda('T32'), porRonda('T16'), porRonda('T8'), porRonda('SF'), porRonda('F')]).toEqual([2, 2, 2, 2, 1]);
    expect(d.asaltos.every((a) => a.fase === 'TABLEAU' && a.refA < a.refB)).toBe(true);
  });

  it('el primer cruce jugado de la tabla de 32 se atribuye a sus dos atletas con 15/14', () => {
    const d = parsearDirectaFww(DIRECTA);
    const t32 = d.asaltos.filter((a) => a.ronda === 'T32');
    expect(t32.some((a) => [a.puntosA, a.puntosB].sort().join() === '14,15')).toBe(true);
    expect(t32.every((a) => a.refA.startsWith('fww:athlete:9'))).toBe(true);
  });

  it('un cruce con los dos V, sin marcador numérico o de ronda desconocida se excluye', () => {
    const dosV = DIRECTA.replace(/(\s*)D(\s*<\/div>\s*<div class="col-1 p-0  text-end align-middle">\s*14)/, '$1V$2');
    expect(dosV).not.toBe(DIRECTA);
    expect(parsearDirectaFww(dosV).excluidos.incoherente).toBe(1);

    const sinNumero = DIRECTA.replace(/(\s)14(\s*<\/div>)/, '$1  $2');
    expect(parsearDirectaFww(sinNumero).excluidos.sinMarcador).toBe(1);

    const desconocida = DIRECTA.replaceAll('Table of 16: ', 'Repechage: ');
    const d = parsearDirectaFww(desconocida);
    expect(d.excluidos.rondaDesconocida).toBe(2);
    expect(d.completo).toBe(false);
  });
});

describe('lectura exacta del destino FWW', () => {
  const base = 'https://www.fencingworldwide.com/en/926885-2025';

  it('pools/1 se pide como tal (sin pasar a results/) y devuelve contexto y asaltos', async () => {
    const deps = depsCon({ [`${base}/pools/1`]: { status: 200, body: POOLS } });
    const r = await leerDestinoFww(`${base}/pools/1`, deps);
    expect(deps.pedidas).toEqual([`${base}/pools/1`]);
    expect(r).toMatchObject({ estado: 'ok', destino: { tipo: 'pools', numero: 1 } });
    expect(r.pagina).toMatchObject({ torneo: 'World Cup of Switzerland', formato: 'INDIVIDUAL', fecha: '2026-01-02' });
    expect(r.parte?.importado).toBeGreaterThan(0);
  });

  it('una ronda inexistente responde 200 sin contenido: no es un destino publicado', async () => {
    const vacia = POOLS.replace(/<p><a name="pool-1">[\s\S]*<\/table>\s*$/m, '').replace(/<table class="[^"]*pool"[\s\S]*?<\/table>/g, '');
    const r = await leerDestinoFww(`${base}/pools/2`, depsCon({ [`${base}/pools/2`]: { status: 200, body: vacia } }));
    expect(r).toMatchObject({ estado: 'no_publicado', httpStatus: 200 });
  });

  it('404 = no publicado, 500 y red = error, URL de otro host = error sin pedir', async () => {
    expect((await leerDestinoFww(`${base}/direct/2`, depsCon({ [`${base}/direct/2`]: { status: 404, body: '' } }))).estado).toBe('no_publicado');
    expect((await leerDestinoFww(`${base}/direct/2`, depsCon({ [`${base}/direct/2`]: { status: 500, body: '' } }))).estado).toBe('error');
    expect((await leerDestinoFww(`${base}/direct/2`, depsCon({ [`${base}/direct/2`]: new Error('ETIMEDOUT') }))).estado).toBe('error');
    const deps = depsCon({});
    expect((await leerDestinoFww('https://evil.example/en/926885-2025/pools/1', deps)).estado).toBe('error');
    expect(deps.pedidas).toEqual([]);
  });

  it('agrega varias rondas: una caída deja parcial lo leído y nada leído mantiene el estado', async () => {
    const ok = await leerDestinoFww(`${base}/pools/1`, depsCon({ [`${base}/pools/1`]: { status: 200, body: POOLS } }));
    const caida = await leerDestinoFww(`${base}/pools/2`, depsCon({ [`${base}/pools/2`]: { status: 500, body: '' } }));
    expect(agregarLecturasFww('POULE', [ok]).estado).toBe('completo');
    expect(agregarLecturasFww('POULE', [ok, caida])).toMatchObject({ estado: 'parcial' });
    expect(agregarLecturasFww('POULE', [caida]).estado).toBe('error');
    expect(agregarLecturasFww('POULE', []).estado).toBe('no_publicado');
  });
});

describe('acumulador de asaltos', () => {
  const entrada = (a: number, b: number) => ({
    fase: 'POULE' as const,
    ronda: 'R1P1',
    a: { ref: 'x:2', nombre: 'Dos', puntos: a },
    b: { ref: 'x:1', nombre: 'Uno', puntos: b },
  });

  it('un duelo repetido y coherente cuenta una vez; contradictorio se retira', () => {
    const acc = new AcumuladorAsaltos();
    acc.anadir(entrada(5, 3));
    acc.anadir({ ...entrada(3, 5), a: { ref: 'x:1', nombre: 'Uno', puntos: 3 }, b: { ref: 'x:2', nombre: 'Dos', puntos: 5 } });
    expect(acc.resumen(true)).toMatchObject({ importado: 1, publicado: 1, completo: true });
    acc.anadir(entrada(5, 4));
    expect(acc.resumen(true)).toMatchObject({ importado: 0, completo: false });
    expect(acc.excluidos.incoherente).toBe(1);
  });

  it('el mismo participante contra sí mismo no es un asalto', () => {
    const acc = new AcumuladorAsaltos();
    acc.anadir({ ...entrada(5, 3), b: { ref: 'x:2', nombre: 'Dos', puntos: 3 } });
    expect(acc.resumen(true).importado).toBe(0);
  });
});
