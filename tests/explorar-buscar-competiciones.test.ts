import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { buscarDatoDeCuenta } from '@/lib/cache/privacidad';
import { deserializar, serializar } from '@/lib/cache/serializar';
import { leerCatalogoEdiciones, LIMITE_CATALOGO } from '@/lib/sport/explorar/catalogo';
import { codificarCursor } from '@/lib/sport/explorar/cursor';
import {
  buscarEnIndice,
  compactarEdiciones,
  construirIndiceEdiciones,
  leerDatosIndiceEdiciones,
  resumenDeIndice,
  type IndiceEdiciones,
} from '@/lib/sport/explorar/indice-ediciones';
import { buscarPaises, paisPorCodigo, rutaPais } from '@/lib/sport/explorar/paises';
import { distanciaEdicion, palabrasConsulta, plegarTexto } from '@/lib/sport/explorar/texto-difuso';
import { crearContexto } from './helpers/explorar';

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => { throw new Error('Sin red en el test'); },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/explorar/buscar',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { CabeceraExplorar } = await import('@/components/explorar/cabecera-explorar');
const { BuscadorPaises } = await import('@/components/explorar/buscador-paises');
const { BuscadorSocial } = await import('@/components/explorar/buscador-social');
const { rotuloAnios, atajosAnios } = await import('@/components/explorar/buscador-filtros');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Edicion = {
  n: number; nombre: string; ciudad?: string | null; pais?: string | null; inicio?: string | null; fin?: string | null;
  fuente?: string; temporada?: string; pruebas?: { arma: string; genero: string; categoria: string; formato?: string }[];
};

/** Nombres y sedes tal y como los publica la FIE (en francés) o la RFEE. */
const EDICIONES: Edicion[] = [
  { n: 1, nombre: 'Championnats du Monde', ciudad: 'Milan', pais: 'ITA', inicio: '2023-07-22', fin: '2023-07-30', pruebas: [{ arma: 'ESPADA', genero: 'F', categoria: 'ABS' }] },
  { n: 2, nombre: 'World Championships', ciudad: 'Hong Kong', pais: 'HKG', inicio: '2026-07-30', pruebas: [{ arma: 'SABLE', genero: 'M', categoria: 'ABS' }] },
  { n: 3, nombre: 'Coupe du Monde', ciudad: 'Bogota', pais: 'COL', inicio: '2026-09-25', pruebas: [{ arma: 'ESPADA', genero: 'M', categoria: 'M20' }] },
  { n: 4, nombre: 'Coupe du Monde par équipes', ciudad: 'Berne', pais: 'SUI', inicio: '2026-05-24', pruebas: [{ arma: 'ESPADA', genero: 'M', categoria: 'ABS', formato: 'EQUIPOS' }] },
  { n: 5, nombre: 'Grand Prix', ciudad: 'Turin', pais: 'ITA', inicio: '2024-02-09', pruebas: [{ arma: 'FLORETE', genero: 'M', categoria: 'ABS' }] },
  { n: 6, nombre: 'Tournoi Satellite', ciudad: 'Turku', pais: 'FIN', inicio: '2025-09-27', pruebas: [{ arma: 'SABLE', genero: 'M', categoria: 'ABS' }] },
  { n: 7, nombre: "Championnats d'Europe", ciudad: 'Antony', pais: 'FRA', inicio: '2026-06-20', pruebas: [{ arma: 'FLORETE', genero: 'F', categoria: 'ABS' }] },
  { n: 8, nombre: 'Copa del Mundo Burgos', ciudad: null, pais: null, inicio: '2019-12-14', fuente: 'rfee_pdf', temporada: '2019-2020', pruebas: [{ arma: 'ESPADA', genero: 'M', categoria: 'M20' }] },
  { n: 9, nombre: 'Grand Prix', ciudad: 'Budapest', pais: 'HUN', inicio: '2025-03-21', pruebas: [{ arma: 'ESPADA', genero: 'F', categoria: 'ABS' }] },
  { n: 10, nombre: 'Coupe du Monde', ciudad: 'Bucarest', pais: 'ROU', inicio: '2022-11-12', pruebas: [{ arma: 'SABLE', genero: 'F', categoria: 'ABS' }] },
  { n: 11, nombre: 'Cadet Circuit Warszawa', ciudad: 'Warszawa', pais: 'POL', inicio: '2024-09-28', fuente: 'efc', temporada: '2024-2025', pruebas: [{ arma: 'ESPADA', genero: 'M', categoria: 'M17' }] },
  { n: 12, nombre: 'CAMPEONATO DE ESPAÑA M-15', ciudad: 'Valladolid', pais: null, inicio: '2025-06-14', fuente: 'skermo_rfee', temporada: '2024-2025', pruebas: [{ arma: 'SABLE', genero: 'F', categoria: 'M15' }] },
  { n: 13, nombre: 'Copa Ciudad de Madrid', ciudad: 'Madrid', pais: 'ESP', inicio: '2015-01-10', fuente: 'skermo_rfee', temporada: '2014-2015', pruebas: [{ arma: 'FLORETE', genero: 'M', categoria: 'M13' }] },
  { n: 14, nombre: 'Copacabana Open', ciudad: 'Rio de Janeiro', pais: 'BRA', inicio: '2025-01-10', pruebas: [{ arma: 'FLORETE', genero: 'M', categoria: 'ABS' }] },
  { n: 15, nombre: 'Tournoi sans date', ciudad: 'Paris', pais: 'FRA', inicio: null, pruebas: [] },
];

function filasDe(ediciones: Edicion[]) {
  return ediciones.map((e) => ({
    id: id(e.n), nombre: e.nombre, temporada: e.temporada ?? (e.inicio ?? '2026').slice(0, 4), fuente: e.fuente ?? 'fie',
    ciudad: e.ciudad ?? null, pais: e.pais ?? null, inicio: e.inicio ?? null, fin: e.fin ?? e.inicio ?? null,
    pruebas: e.pruebas?.length ?? 0,
    armas: [...new Set(e.pruebas?.map((p) => p.arma))].join(',') || null,
    formatos: [...new Set(e.pruebas?.map((p) => p.formato ?? 'INDIVIDUAL'))].join(',') || null,
    generos: [...new Set(e.pruebas?.map((p) => p.genero))].join(',') || null,
    categorias: [...new Set(e.pruebas?.map((p) => p.categoria))].join(',') || null,
  }));
}

/** Como en producción: compactado, serializado por la caché, deserializado y construido. */
const indice: IndiceEdiciones = construirIndiceEdiciones(deserializar(serializar(compactarEdiciones(filasDe(EDICIONES)))));
const buscar = (q: string, filtros: Record<string, string> = {}) =>
  buscarEnIndice(indice, { q, ...filtros }).posiciones.map((p) => resumenDeIndice(indice, p));
const numeros = (q: string, filtros: Record<string, string> = {}) =>
  buscar(q, filtros).map((e) => Number(e.id.slice(-12)));

describe('texto tolerante', () => {
  it('pliega tildes, mayúsculas, signos y categorías escritas de varias formas', () => {
    expect(plegarTexto('  CAMPEONATO DE ESPAÑA M-15 ')).toBe('campeonato de espana m15');
    expect(plegarTexto("Championnats d’Europe Sub 20")).toBe('championnats d europe m20');
    expect(plegarTexto('Сhampionnats')).toBe('championnats');
  });

  it('Damerau-Levenshtein: trasposición cuenta uno y corta al pasar el tope', () => {
    expect(distanciaEdicion('mndial', 'mundial', 2)).toBe(1);
    expect(distanciaEdicion('cpoa', 'copa', 1)).toBe(1);
    expect(distanciaEdicion('turin', 'turku', 1)).toBe(2);
    expect(distanciaEdicion('budapest', 'bucarest', 1)).toBe(2);
    expect(distanciaEdicion('a', 'abcdef', 2)).toBe(3);
  });

  it('las palabras vacías se ignoran salvo que no haya otra cosa, y los sinónimos se resuelven', () => {
    expect(palabrasConsulta('copa del mun').map((p) => p.canonica)).toEqual(['copa', 'mun']);
    expect(palabrasConsulta('World Cup').map((p) => p.canonica)).toEqual(['mundo', 'copa']);
    expect(palabrasConsulta('Grand Prix de Turín').map((p) => p.canonica)).toEqual(['gp', 'turin']);
    expect(palabrasConsulta('de la').map((p) => p.cruda)).toEqual(['de', 'la']);
  });
});

describe('búsqueda difusa de competiciones', () => {
  it('«mndial» encuentra los Campeonatos del Mundo (en francés e inglés) y no las Copas del Mundo', () => {
    expect(numeros('mndial')).toEqual([2, 1]);
    expect(numeros('mundial')).toEqual([2, 1]);
    expect(numeros('campeonato del mundo')).toEqual([2, 1]);
    expect(numeros('world championships')).toEqual([2, 1]);
  });

  it('«copa del mun» encuentra las Copas del Mundo en cualquier idioma, no el Mundial', () => {
    expect(numeros('copa del mun')).toEqual([3, 4, 10, 8]);
    expect(numeros('world cup')).toEqual([3, 4, 10, 8]);
    expect(numeros('coupe du monde')).toEqual([3, 4, 10, 8]);
    expect(numeros('copa del mun')).not.toContain(1);
  });

  it('«turin» encuentra el Gran Premio de Turín (también «Torino», «Turín» y «GP»), no Turku', () => {
    for (const q of ['turin', 'Turín', 'torino', 'grand prix turin', 'gp turin', 'gran premio de turin']) expect(numeros(q)).toEqual([5]);
    expect(numeros('turku')).toEqual([6]);
    expect(numeros('gp')).toEqual([9, 5]);
  });

  it('una palabra que existe no trae parecidas: «budapest» no es «bucarest»; las ciudades valen en otros idiomas', () => {
    expect(numeros('budapest')).toEqual([9]);
    expect(numeros('bucarest')).toEqual([10]);
    expect(numeros('varsovia')).toEqual([11]);
    expect(numeros('warsaw')).toEqual([11]);
  });

  it('Europeo ↔ Campeonato de Europa; país, arma, categoría y año también casan', () => {
    expect(numeros('europeo')).toEqual([7]);
    expect(numeros('campeonato de europa')).toEqual([7]);
    expect(numeros('italia')).toEqual([5, 1]);
    expect(numeros('copa del mundo espada m20')).toEqual([3, 8]);
    expect(numeros('copa del mundo junior 2019')).toEqual([8]);
    expect(numeros('campeonato españa m15')).toEqual([12]);
  });

  it('lo que no se parece no sale', () => {
    for (const q of ['zzzz', 'qwerty', 'mundial turin', 'copa del mundo turku']) expect(numeros(q)).toEqual([]);
  });

  it('primero las coincidencias exactas y, dentro de cada grupo, de la más reciente a la más antigua', () => {
    // «Copa» exacta (2015, 2019…) antes que «Copacabana» (prefijo), aunque ésta sea más reciente.
    const copa = numeros('copa');
    expect(copa.indexOf(14)).toBe(copa.length - 1);
    expect(copa.slice(0, -1)).toEqual([3, 4, 10, 8, 13]);
    // Sin texto: todas, de la más reciente a la más antigua, y la que no tiene fecha al final.
    const todas = numeros('');
    expect(todas).toHaveLength(EDICIONES.length);
    expect(todas[0]).toBe(3);
    expect(todas.at(-1)).toBe(15);
    const fechas = buscar('').map((e) => e.inicio).filter(Boolean) as string[];
    expect([...fechas].sort().reverse()).toEqual(fechas);
  });

  it('filtros de arma, categoría, fechas, organizador y temporada', () => {
    expect(numeros('', { arma: 'FLORETE' })).toEqual([7, 14, 5, 13]);
    expect(numeros('', { categoria: 'M20' })).toEqual([3, 8]);
    expect(numeros('copa del mundo', { categoria: 'ABS' })).toEqual([4, 10]);
    expect(numeros('', { desde: '2026', hasta: '2026' })).toEqual([3, 2, 7, 4]);
    expect(numeros('', { hasta: '2019' })).toEqual([8, 13]);
    expect(numeros('', { fuente: 'efc' })).toEqual([11]);
    expect(numeros('', { temporada: '2024-2025' })).toEqual([12, 11]);
    expect(numeros('', { fuente: 'otra' })).toEqual([]);
  });

  it('el resumen de cada fila es el de siempre (UUID con guiones, armas, formatos y fechas)', () => {
    const [mundial] = buscar('mndial', { desde: '2023', hasta: '2023' });
    expect(mundial).toMatchObject({
      id: id(1), nombre: 'Championnats du Monde', ciudad: 'Milan', pais: 'ITA', fuente: 'fie',
      inicio: '2023-07-22', fin: '2023-07-30', pruebas: 1, armas: ['ESPADA'], formatos: ['INDIVIDUAL'],
    });
  });

  it('el índice compactado no lleva datos de cuenta y cabe de sobra en la memoria del isolate', () => {
    const muchas = Array.from({ length: 12_000 }, (_, i) => ({ ...EDICIONES[i % EDICIONES.length]!, n: 1000 + i }));
    const datos = compactarEdiciones(filasDe(muchas));
    expect(buscarDatoDeCuenta(datos)).toBeNull();
    // `almacenMemoria` no guarda entradas de más de 2 MB (2 bytes por carácter).
    expect(serializar(datos).length).toBeLessThan(1_000_000);
    const grande = construirIndiceEdiciones(datos);
    const t = performance.now();
    for (const q of ['m', 'mn', 'mnd', 'mndi', 'mndia', 'mndial']) buscarEnIndice(grande, { q });
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('catálogo con el índice: sin D1 por tecla', () => {
  const cierres: (() => void)[] = [];
  afterEach(() => cierres.splice(0).forEach((c) => c()));

  async function entorno() {
    const local = localD1();
    cierres.push(local.close);
    const ctx = { ...crearContexto().ctx, db: createD1Database(local.binding) };
    const ed = local.sqlite.prepare(`INSERT INTO sport_edition
      (id,source,season,tournament_key,name,city,country_code,start_date,end_date) VALUES (?,?,?,?,?,?,?,?,?)`);
    const pr = local.sqlite.prepare(`INSERT INTO sport_competition
      (id,edition_id,source,season,competition_key,weapon,gender,category,format) VALUES (?,?,?,?,?,?,?,?,?)`);
    for (let n = 1; n <= 40; n++) {
      // Una semana y un día entre una y otra: ninguna se encadena con la anterior del mismo nombre (son eventos distintos).
      ed.run(id(n), 'fie', '2026', `ed-${n}`, n % 2 ? 'Coupe du Monde' : 'Championnats du Monde', n % 2 ? 'Turin' : 'Torino', 'ITA',
        new Date(Date.UTC(2026, 0, 1) + n * 8 * 86_400_000).toISOString().slice(0, 10), null);
      pr.run(id(n + 1000), id(n), 'fie', '2026', `pr-${n}`, n % 3 ? 'ESPADA' : 'SABLE', 'F', 'ABS', 'INDIVIDUAL');
    }
    const datos = await leerDatosIndiceEdiciones(ctx);
    if (!datos) throw new Error('sin índice');
    const construido = construirIndiceEdiciones(datos);
    return { ...local, ctx, indice: async () => construido };
  }

  it('busca con erratas, pagina por el índice y no vuelve a leer la base', async () => {
    const t = await entorno();
    const lecturas = t.calls.length;
    const primera = await leerCatalogoEdiciones(t.ctx, { q: 'mndial' }, { indice: t.indice });
    if (primera.estado !== 'ok') throw new Error(primera.estado);
    expect(primera.total).toBe(20);
    expect(primera.ediciones).toHaveLength(20);
    expect(primera.ediciones.every((e) => e.nombre === 'Championnats du Monde')).toBe(true);
    const copas = await leerCatalogoEdiciones(t.ctx, { q: 'copa del mun', arma: 'ESPADA' }, { indice: t.indice });
    if (copas.estado !== 'ok') throw new Error(copas.estado);
    expect(copas.ediciones.every((e) => e.nombre === 'Coupe du Monde' && e.armas.includes('ESPADA'))).toBe(true);
    const todas = await leerCatalogoEdiciones(t.ctx, { q: 'turin' }, { indice: t.indice });
    if (todas.estado !== 'ok') throw new Error(todas.estado);
    expect(todas.total).toBe(40);
    expect(todas.ediciones).toHaveLength(LIMITE_CATALOGO);
    const segunda = await leerCatalogoEdiciones(t.ctx, { q: 'Turín', cursor: todas.siguiente! }, { indice: t.indice });
    if (segunda.estado !== 'ok') throw new Error(segunda.estado);
    expect(segunda.ediciones).toHaveLength(15);
    expect(new Set([...todas.ediciones, ...segunda.ediciones].map((e) => e.id)).size).toBe(40);
    expect(segunda.siguiente).toBeNull();
    expect(t.calls.length).toBe(lecturas);
  });

  it('el cursor del índice vale sólo para su búsqueda y sus filtros', async () => {
    const t = await entorno();
    const r = await leerCatalogoEdiciones(t.ctx, { q: 'turin' }, { indice: t.indice });
    if (r.estado !== 'ok') throw new Error(r.estado);
    for (const otro of [{ q: 'milan' }, { q: 'turin', arma: 'SABLE' }, { q: 'turin', desde: '2020' }]) {
      expect(await leerCatalogoEdiciones(t.ctx, { ...otro, cursor: r.siguiente! }, { indice: t.indice })).toEqual({ estado: 'cursor_invalido' });
    }
    const negativo = codificarCursor('catalogo-indice', { q: 'turin', fuente: '', temporada: '' }, [-5]);
    expect(await leerCatalogoEdiciones(t.ctx, { q: 'turin', cursor: negativo }, { indice: t.indice })).toEqual({ estado: 'cursor_invalido' });
  });

  it('valida los filtros nuevos y, sin índice, los aplica también en D1', async () => {
    const t = await entorno();
    for (const malo of [{ arma: 'LANZA' }, { categoria: 'JUNIOR' }, { desde: '26' }, { desde: '2026', hasta: '2020' }]) {
      expect(await leerCatalogoEdiciones(t.ctx, malo, { indice: t.indice })).toEqual({ estado: 'entrada_invalida' });
    }
    const d1 = await leerCatalogoEdiciones(t.ctx, { arma: 'SABLE', categoria: 'ABS', desde: '2026', hasta: '2026' });
    const mem = await leerCatalogoEdiciones(t.ctx, { arma: 'SABLE', categoria: 'ABS', desde: '2026', hasta: '2026' }, { indice: t.indice });
    if (d1.estado !== 'ok' || mem.estado !== 'ok') throw new Error('estado');
    expect(d1.total).toBe(13);
    expect(mem.total).toBe(13);
    expect(mem.ediciones.map((e) => e.id)).toEqual(d1.ediciones.map((e) => e.id));
  });
});

describe('países', () => {
  it('por nombre en castellano, por código del COI, por otro idioma, con prefijo o con errata', () => {
    expect(buscarPaises('España')[0]?.codigo).toBe('ESP');
    expect(buscarPaises('ESP')[0]?.codigo).toBe('ESP');
    expect(buscarPaises('ita')[0]?.codigo).toBe('ITA');
    expect(buscarPaises('itlia')[0]?.codigo).toBe('ITA');
    expect(buscarPaises('holanda')[0]?.codigo).toBe('NED');
    expect(buscarPaises('germany')[0]?.codigo).toBe('GER');
    expect(buscarPaises('estados unidos')[0]?.codigo).toBe('USA');
    expect(buscarPaises('zzz')).toEqual([]);
    expect(buscarPaises('turin')).toEqual([]);
    expect(paisPorCodigo('esp')?.nombre).toBe('España');
    expect(rutaPais('esp')).toBe('/explorar/pais/ESP');
  });

  it('la pestaña Países lista con bandera y enlaza a la pantalla del país, sin filtros', () => {
    const html = renderToStaticMarkup(React.createElement(BuscadorPaises, { qInicial: 'ital' }));
    expect(html).toContain('href="/explorar/pais/ITA"');
    expect(html).toContain('Italia');
    expect(html).not.toContain('href="/explorar/pais/ESP"');
    expect(html).not.toContain('sistema-chip');
    const todas = renderToStaticMarkup(React.createElement(BuscadorPaises, {}));
    expect(todas.match(/href="\/explorar\/pais\//g)!.length).toBeGreaterThan(100);
    const cabecera = renderToStaticMarkup(React.createElement(CabeceraExplorar, { activa: 'paises' }));
    expect(cabecera).toMatch(/<a[^>]*href="\/explorar\/buscar\?ver=paises"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/explorar\/buscar\?ver=paises"/);
  });

  it('el buscador de tiradores enseña los países que casan antes de los perfiles', () => {
    const html = renderToStaticMarkup(React.createElement(BuscadorSocial, {
      valor: 'italia', onChange: () => {}, qUrl: '', volverDe: (q: string) => `/explorar?q=${q}`,
    }));
    expect(html).toContain('>Países</h2>');
    expect(html).toContain('href="/explorar/pais/ITA"');
    expect(html.indexOf('/explorar/pais/ITA')).toBeLessThan(html.indexOf('Ver todos los resultados'));
    const sinPais = renderToStaticMarkup(React.createElement(BuscadorSocial, {
      valor: 'zabala', onChange: () => {}, qUrl: '', volverDe: (q: string) => `/explorar?q=${q}`,
    }));
    expect(sinPais).not.toContain('/explorar/pais/');
  });
});

describe('chip de fechas', () => {
  it('rótulo corto y atajos desde el año en curso', () => {
    expect(rotuloAnios({ desde: '', hasta: '' })).toBe('Fechas');
    expect(rotuloAnios({ desde: '2018', hasta: '2024' })).toBe('2018–2024');
    expect(rotuloAnios({ desde: '2024', hasta: '2024' })).toBe('2024');
    expect(rotuloAnios({ desde: '2018', hasta: '' })).toBe('Desde 2018');
    expect(atajosAnios(2026).map((a) => a.anios)).toEqual([
      { desde: '2026', hasta: '2026' }, { desde: '2024', hasta: '2026' }, { desde: '2017', hasta: '2026' }, { desde: '', hasta: '2016' },
    ]);
  });
});
