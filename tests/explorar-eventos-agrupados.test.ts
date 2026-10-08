import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { deserializar, serializar } from '@/lib/cache/serializar';
import { leerCatalogoEdiciones } from '@/lib/sport/explorar/catalogo';
import {
  CRITERIOS_CATALOGO_VACIOS,
  cuantosFiltrosCatalogo,
  leerCriteriosCatalogo,
  sanitizarRetornoCatalogo,
  urlCatalogo,
} from '@/lib/sport/explorar/catalogo-url';
import {
  agruparEdiciones,
  diaDeIso,
  eleccionDelEvento,
  nombreBaseEdicion,
  pruebaPreferida,
  type EdicionAgrupable,
  type PruebaDeEdicion,
  type PruebaHermana,
} from '@/lib/sport/explorar/edicion-modelo';
import { construirUrlEdicion } from '@/lib/sport/explorar/edicion-url';
import { leerEdicion, leerEdicionesDeEvento } from '@/lib/sport/explorar/ediciones';
import {
  buscarEnIndice,
  compactarEdiciones,
  construirIndiceEdiciones,
  leerDatosIndiceEdiciones,
  resumenDeIndice,
} from '@/lib/sport/explorar/indice-ediciones';
import { almacenMemoria } from '@/lib/cache/almacenes';
import { crearCache } from '@/lib/cache/cache';
import { versionDe, type Dependencia } from '@/lib/cache/versiones';
import type { SessionProfile } from '@/lib/auth/session';
import { crearCachesExplorar, criteriosCatalogoCacheables } from '@/lib/sport/explorar/cache-pantallas';
import { contextoPublico } from '@/lib/sport/explorar/contexto-publico';
import { crearContexto, perfil } from './helpers/explorar';

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => { throw new Error('Sin red en el test'); },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/explorar/ediciones',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { PruebasDeEdicion } = await import('@/components/explorar/ediciones');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ev = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

const ed = (sobre: Partial<Omit<EdicionAgrupable, 'inicio' | 'fin'>> & { inicio?: string | null; fin?: string | null } = {}): EdicionAgrupable => ({
  fuente: 'fie', temporada: '2025', nombre: 'World Championships', ciudad: 'Tbilisi', pais: 'GEO', evento: null,
  ...sobre,
  inicio: diaDeIso(sobre.inicio === undefined ? '2025-07-22' : sobre.inicio),
  fin: diaDeIso(sobre.fin === undefined ? null : sobre.fin),
});
const grupos = (lista: EdicionAgrupable[]) => [...agruparEdiciones(lista)];

describe('clave de evento', () => {
  it('quita arma, género, modalidad, año y enlaces; iguala las formas de la categoría y deja la categoría', () => {
    expect(nombreBaseEdicion('TNR ESPADA MASCULINA SABADELL')).toBe(nombreBaseEdicion('TNR Espada Femenina Sabadell'));
    expect(nombreBaseEdicion('TNR FLORETE MASCULINO y FEMENINO ABS SABADELL')).toBe('tnr abs sabadell');
    expect(nombreBaseEdicion('Coupe du Monde par équipes')).toBe(nombreBaseEdicion('Coupe du Monde'));
    expect(nombreBaseEdicion("Men's Sabre Team World Cup")).toBe(nombreBaseEdicion("Women's Epee World Cup"));
    expect(nombreBaseEdicion('Championnats du monde Grand Veterans par equipes')).toBe(nombreBaseEdicion('Championnats du monde Veterans par equipes'));
    expect(nombreBaseEdicion('Campeonato de España de Veteranos 2026')).toBe(nombreBaseEdicion('CAMPEONATO DE ESPAÑA VETERANOS'));
    expect(nombreBaseEdicion('CAMPEONATO DE ESPAÑA M-15')).toBe(nombreBaseEdicion('Campeonato de España Sub 15'));
    expect(nombreBaseEdicion('CAMPEONATO DE ESPAÑA M13')).not.toBe(nombreBaseEdicion('CAMPEONATO DE ESPAÑA M15'));
    expect(nombreBaseEdicion('Championnats du monde juniors-cadets')).not.toBe(nombreBaseEdicion('Championnats du monde Veterans'));
    // Los Mundiales de veteranos llegan por franja de edad; la franja no separa el evento.
    for (const franja of ['Championnats du monde Vétérans 60-69', 'Championnats du monde Vétérans 70+', 'Championnats du monde vétérans 50-59']) {
      expect(nombreBaseEdicion(franja)).toBe(nombreBaseEdicion('Championnats du monde Vétérans par équipes'));
    }
    expect(nombreBaseEdicion('Championnat du monde')).toBe(nombreBaseEdicion('Championnats du monde'));
  });

  it('un Mundial publicado prueba a prueba es un evento; otra fuente, sede o semana, no', () => {
    const tbilisi = ['2025-07-22', '2025-07-22', '2025-07-24', '2025-07-26', '2025-07-27', '2025-07-29'].map((d) => ed({ inicio: d, fin: d }));
    expect(new Set(grupos(tbilisi)).size).toBe(1);
    // La misma semana en la EFC (otra fuente) o en otra sede: aparte.
    expect(grupos([ed(), ed({ fuente: 'efc' })])).toEqual([0, 1]);
    expect(grupos([ed(), ed({ ciudad: 'Busan', pais: 'KOR' })])).toEqual([0, 1]);
    // Cinco días después del final de la anterior ya es otro evento.
    expect(grupos([ed({ inicio: '2025-07-22', fin: '2025-07-23' }), ed({ inicio: '2025-07-28' })])).toEqual([0, 1]);
    expect(grupos([ed({ inicio: '2025-07-22', fin: '2025-07-23' }), ed({ inicio: '2025-07-27' })])).toEqual([0, 0]);
    // Encadenar no estira un evento sin fin.
    const cadena = Array.from({ length: 10 }, (_, i) => ed({ inicio: new Date(Date.UTC(2025, 0, 1 + i * 3)).toISOString().slice(0, 10) }));
    expect(new Set(grupos(cadena)).size).toBeGreaterThan(1);
    // Otra temporada, aparte.
    expect(grupos([ed(), ed({ temporada: '2026' })])).toEqual([0, 1]);
  });

  it('júnior y cadete con el mismo nombre van juntos; veteranos no; sin sede no se mezclan categorías', () => {
    const jc = (inicio: string) => ed({ nombre: 'Championnats du monde juniors-cadets', ciudad: 'Wuxi', pais: 'CHN', inicio });
    const vet = ed({ nombre: 'Championnats du monde Veterans', ciudad: 'Wuxi', pais: 'CHN', inicio: '2025-04-10' });
    expect(grupos([jc('2025-04-07'), jc('2025-04-11'), jc('2025-04-15'), vet])).toEqual([0, 0, 0, 1]);
    const pdf = (nombre: string, inicio: string) => ed({ fuente: 'rfee_pdf', temporada: '2025-2026', ciudad: null, pais: null, nombre, inicio });
    expect(grupos([pdf('CAMPEONATO DE ESPAÑA M13', '2026-04-11'), pdf('CAMPEONATO DE ESPAÑA M13', '2026-04-12'),
      pdf('CAMPEONATO DE ESPAÑA M15', '2026-04-13')])).toEqual([0, 0, 1]);
  });

  it('el torneo del calendario une ediciones de su fuente aunque el nombre cambie; sin fecha, sólo por el torneo', () => {
    expect(grupos([ed({ evento: ev(1) }), ed({ nombre: 'Otro nombre', inicio: '2025-09-01', evento: ev(1) }), ed({ evento: ev(1), inicio: null })]))
      .toEqual([0, 0, 0]);
    expect(grupos([ed({ evento: ev(1) }), ed({ fuente: 'efc', evento: ev(1) })])).toEqual([0, 1]);
    expect(grupos([ed({ inicio: null }), ed({ inicio: null })])).toEqual([0, 1]);
  });
});

type Fila = Parameters<typeof compactarEdiciones>[0][number];
const fila = (n: number, sobre: Partial<Fila> = {}): Fila => ({
  id: id(n), nombre: 'World Championships', temporada: '2025', fuente: 'fie', ciudad: 'Tbilisi', pais: 'GEO',
  inicio: '2025-07-22', fin: '2025-07-23', pruebas: 1, armas: 'ESPADA', formatos: 'INDIVIDUAL', generos: 'M', categorias: 'ABS',
  ...sobre,
});

/** Tbilisi 2025 (seis ediciones sueltas), una Copa del Mundo y el Mundial EFC inventado de la misma semana. */
const FILAS: Fila[] = [
  fila(1, { armas: 'FLORETE', generos: 'M' }),
  fila(2, { armas: 'ESPADA', generos: 'F' }),
  fila(3, { armas: 'SABLE', generos: 'M', inicio: '2025-07-24', fin: '2025-07-25' }),
  fila(4, { armas: 'SABLE', generos: 'F', formatos: 'EQUIPOS', inicio: '2025-07-29', fin: '2025-07-30' }),
  fila(5, { armas: 'FLORETE', generos: 'F', formatos: 'EQUIPOS', inicio: '2025-07-27', fin: '2025-07-28' }),
  fila(6, { armas: 'ESPADA', generos: 'M', formatos: 'EQUIPOS', inicio: '2025-07-29', fin: '2025-07-30' }),
  fila(7, { nombre: 'Coupe du Monde', ciudad: 'Berne', pais: 'SUI', inicio: '2025-05-10', fin: '2025-05-11', pruebas: 2 }),
  fila(8, { fuente: 'efc', nombre: 'World Championships', inicio: '2025-07-22' }),
];
const indice = construirIndiceEdiciones(deserializar(serializar(compactarEdiciones(FILAS))));
const numeros = (posiciones: number[]) => posiciones.map((p) => Number(resumenDeIndice(indice, p).id.slice(-12)));

describe('índice con eventos', () => {
  it('versión 4 con la columna de eventos; una fila por evento y el total cuenta eventos', () => {
    const datos = compactarEdiciones(FILAS);
    expect(datos.v).toBe(4);
    expect(datos.r.split(',')).toHaveLength(FILAS.length);
    expect(indice.grupos).toBe(3);
    const todo = buscarEnIndice(indice, { q: '' });
    expect(todo.posiciones).toHaveLength(3);
    expect(todo.pruebas).toBe(9);
    const mundial = buscarEnIndice(indice, { q: 'mundial' });
    expect(mundial.posiciones).toHaveLength(2);
    expect(new Set(mundial.posiciones.map((p) => resumenDeIndice(indice, p).fuente))).toEqual(new Set(['fie', 'efc']));
  });

  it('la fila resume el evento: fechas de la primera a la última prueba, todas las armas, géneros y equipos', () => {
    const [p] = buscarEnIndice(indice, { q: 'tbilisi', fuente: 'fie' }).posiciones;
    expect(resumenDeIndice(indice, p!)).toMatchObject({
      inicio: '2025-07-22', fin: '2025-07-30', pruebas: 6, ediciones: 6,
      armas: ['ESPADA', 'FLORETE', 'SABLE'], formatos: ['EQUIPOS', 'INDIVIDUAL'], generos: ['M', 'F'],
    });
    const [copa] = buscarEnIndice(indice, { q: 'berna' }).posiciones;
    expect(resumenDeIndice(indice, copa!)).toMatchObject({ inicio: '2025-05-10', fin: '2025-05-11', ediciones: 1, pruebas: 2 });
  });

  it('abre la edición del arma de quien busca o, si no, la primera individual en el orden de los rótulos', () => {
    const abre = (filtros: Parameters<typeof buscarEnIndice>[1]) => numeros(buscarEnIndice(indice, filtros).posiciones)[0];
    expect(abre({ q: 'tbilisi', fuente: 'fie' })).toBe(1);
    expect(abre({ q: 'tbilisi', fuente: 'fie', armasPreferidas: ['SABLE'] })).toBe(3);
    expect(abre({ q: 'tbilisi', fuente: 'fie', arma: 'SABLE', formato: 'EQUIPOS' })).toBe(4);
    expect(abre({ q: 'tbilisi', fuente: 'fie', genero: 'F' })).toBe(2);
    // La preferencia no filtra: un evento sin esa arma sale igual.
    expect(buscarEnIndice(indice, { q: '', armasPreferidas: ['SABLE'] }).posiciones).toHaveLength(3);
  });

  it('género y modalidad filtran por las ediciones que los tienen', () => {
    expect(buscarEnIndice(indice, { q: '', formato: 'EQUIPOS' }).posiciones).toHaveLength(1);
    expect(buscarEnIndice(indice, { q: '', genero: 'F' }).posiciones).toHaveLength(1);
    expect(buscarEnIndice(indice, { q: '', genero: 'X' }).posiciones).toHaveLength(0);
  });

  it('datos de la versión anterior (sin `r`) se leen como una edición por evento', () => {
    const { r: _r, ...viejos } = compactarEdiciones(FILAS);
    const suelto = construirIndiceEdiciones({ ...viejos, r: '' } as never);
    expect(buscarEnIndice(suelto, { q: '' }).posiciones).toHaveLength(FILAS.length);
  });
});

describe('catálogo y edición sobre D1 local', () => {
  const cierres: (() => void)[] = [];
  afterEach(() => cierres.splice(0).forEach((c) => c()));

  function entorno() {
    const local = localD1();
    cierres.push(local.close);
    const ctx = { ...crearContexto().ctx, db: createD1Database(local.binding) };
    const edicion = local.sqlite.prepare(`INSERT INTO sport_edition
      (id,source,season,tournament_key,name,city,country_code,start_date,end_date,event_id) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const prueba = local.sqlite.prepare(`INSERT INTO sport_competition
      (id,edition_id,source,season,competition_key,weapon,gender,category,format,competition_date) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const armas = [['FLORETE', 'M'], ['ESPADA', 'F'], ['SABLE', 'M'], ['FLORETE', 'F'], ['ESPADA', 'M'], ['SABLE', 'F']] as const;
    // Doce ediciones sueltas del Mundial de Tbilisi (seis individuales y seis por equipos).
    for (let n = 1; n <= 12; n++) {
      const [arma, genero] = armas[(n - 1) % 6]!;
      const dia = `2025-07-${String(21 + Math.ceil(n / 2)).padStart(2, '0')}`;
      edicion.run(id(n), 'fie', '2025', `competition:${n}`, 'World Championships', 'Tbilisi', 'GEO', dia, dia, null);
      prueba.run(id(100 + n), id(n), 'fie', '2025', `c-${n}`, arma, genero, 'ABS', n > 6 ? 'EQUIPOS' : 'INDIVIDUAL', dia);
    }
    // Otra competición de la misma semana y fuente, en otra sede.
    edicion.run(id(50), 'fie', '2025', 'competition:50', 'Coupe du Monde', 'Busan', 'KOR', '2025-07-23', '2025-07-23', null);
    prueba.run(id(150), id(50), 'fie', '2025', 'c-50', 'SABLE', 'M', 'ABS', 'INDIVIDUAL', '2025-07-23');
    return { ...local, ctx, edicion, prueba };
  }

  it('el catálogo con el índice cuenta competiciones, no ediciones; las pruebas siguen siendo todas', async () => {
    const t = entorno();
    const datos = await leerDatosIndiceEdiciones(t.ctx);
    const construido = construirIndiceEdiciones(datos!);
    const r = await leerCatalogoEdiciones(t.ctx, { q: 'world championships' }, { indice: async () => construido, armasPreferidas: ['SABLE'] });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.total).toBe(1);
    expect(r.pruebas).toBe(12);
    expect(r.ediciones[0]).toMatchObject({ inicio: '2025-07-22', fin: '2025-07-27', ediciones: 12, armas: ['ESPADA', 'FLORETE', 'SABLE'] });
    expect([id(3), id(6)]).toContain(r.ediciones[0]!.id);
    const filtrado = await leerCatalogoEdiciones(t.ctx, { genero: 'F', formato: 'EQUIPOS' }, { indice: async () => construido });
    if (filtrado.estado !== 'ok') throw new Error(filtrado.estado);
    expect(filtrado.total).toBe(1);
    expect(await leerCatalogoEdiciones(t.ctx, { genero: 'X' })).toEqual({ estado: 'entrada_invalida' });
    // Sin índice (D1) se filtra igual, edición a edición.
    const d1 = await leerCatalogoEdiciones(t.ctx, { genero: 'F', formato: 'EQUIPOS' });
    if (d1.estado !== 'ok') throw new Error(d1.estado);
    expect(d1.total).toBe(3);
  });

  it('la edición trae las pruebas de todo su evento y el selector va de una edición a otra', async () => {
    const t = entorno();
    const r = await leerEdicion(t.ctx, { edicionId: id(1) });
    if (r.estado !== 'ok') throw new Error(r.estado);
    const hermanas = r.edicion.hermanas ?? [];
    expect(hermanas).toHaveLength(12);
    expect(new Set(hermanas.map((h) => h.edicionId)).size).toBe(12);
    expect(hermanas.map((h) => h.id)).not.toContain(id(150));
    expect(hermanas[0]).toMatchObject({ id: id(101), edicionId: id(1), arma: 'FLORETE', genero: 'M', formato: 'INDIVIDUAL' });

    const marcado = renderToStaticMarkup(React.createElement(PruebasDeEdicion, {
      edicion: r.edicion, seleccionada: r.edicion.pruebaElegida ?? '', catalogo: '/explorar/ediciones?q=mundial',
    }));
    for (const fila of ['Arma', 'Género', 'Modalidad']) expect(marcado).toContain(`aria-label="${fila}"`);
    expect(marcado).not.toContain('aria-label="Categoría"');
    // Desde florete masculino individual: cada opción cambia sólo su fila y abre la prueba en su edición, con el catálogo.
    const amp = (s: string) => s.replace(/&/g, '&amp;');
    const catalogo = '/explorar/ediciones?q=mundial';
    expect(marcado).toContain(amp(construirUrlEdicion(id(5), { prueba: id(105), catalogo })));
    expect(marcado).toContain(amp(construirUrlEdicion(id(4), { prueba: id(104), catalogo })));
    expect(marcado).toContain(amp(construirUrlEdicion(id(7), { prueba: id(107), catalogo })));
    expect(marcado).toMatch(/aria-current="page"[^>]*>(?:<[^>]+>)*Florete/);
    expect(marcado).not.toMatch(/FLO M|>FLO<|ESP F/);

    // Sólo pruebas: la banda del calendario no paga las ediciones del evento.
    const solo = await leerEdicion(t.ctx, { edicionId: id(1) }, { soloPruebas: true });
    if (solo.estado !== 'ok') throw new Error(solo.estado);
    expect(solo.edicion.hermanas).toBeUndefined();
  });

  it('una edición sola no trae hermanas y sigue con su selector de siempre', async () => {
    const t = entorno();
    const r = await leerEdicion(t.ctx, { edicionId: id(50) });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.edicion.hermanas).toBeUndefined();
  });

  it('sin prueba en la dirección, la caché común sirve la edición y la cuenta de sable abre sable', async () => {
    const t = entorno();
    t.edicion.run(id(60), 'fie', '2026', '86', 'World Championships', 'Hong Kong', 'HKG', '2026-07-30', '2026-07-30', null);
    t.prueba.run(id(160), id(60), 'fie', '2026', 'c-160', 'ESPADA', 'M', 'ABS', 'INDIVIDUAL', '2026-07-30');
    t.prueba.run(id(161), id(60), 'fie', '2026', 'c-161', 'SABLE', 'F', 'ABS', 'INDIVIDUAL', '2026-07-30');
    const resultado = t.sqlite.prepare(`INSERT INTO sport_result
      (id,competition_id,source,source_fact_key,source_name,position,content_hash) VALUES (?,?,'fie',?,'X',1,'h')`);
    resultado.run(id(260), id(160), 'r-160');
    resultado.run(id(261), id(161), 'r-161');
    const memoria = almacenMemoria();
    const cache = crearCache({
      almacen: () => memoria,
      versiones: { de: async (deps: readonly Dependencia[]) => versionDe({ ledger: 1 }, deps), olvidar() {} },
      esperar: () => {},
    });
    const caches = crearCachesExplorar({ cache, publico: (hoy) => contextoPublico(hoy, { db: t.ctx.db, esquema: t.ctx.esquema }) });
    const criterios = { prueba: '', cursor: '' };
    const cuenta = (weapons: SessionProfile['weapons']) => ({ ...crearContexto({ perfil: perfil({ weapons }) }).ctx, db: t.ctx.db });
    const comun = await caches.cargarEdicionCompartida(cuenta([]), id(60), criterios);
    const sable = await caches.cargarEdicionCompartida(cuenta(['SABLE']), id(60), criterios);
    if (comun.tipo !== 'ok' || sable.tipo !== 'ok') throw new Error('se esperaba ok');
    expect(comun.edicion.pruebaElegida).toBe(id(160));
    expect(sable.edicion.pruebaElegida).toBe(id(161));
    expect(sable.edicion.clasificacion?.pruebaId).toBe(id(161));
    expect(JSON.stringify(sable)).not.toContain('cuenta@example.test');
  });

  it('un torneo del calendario con doce ediciones las devuelve todas (antes se cortaba en seis)', async () => {
    const t = entorno();
    t.sqlite.prepare(`INSERT INTO event (id,source,source_id,name,start_date,end_date,scope,content_hash)
      VALUES (?,'fie','x','Mundial','2025-07-22','2025-07-30','INTERNACIONAL','h')`).run(ev(1));
    t.sqlite.prepare('UPDATE sport_edition SET event_id = ? WHERE id <> ?').run(ev(1), id(50));
    const r = await leerEdicionesDeEvento(t.ctx, { eventoId: ev(1) });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.ediciones).toHaveLength(12);
  });
});

describe('campeonatos nacionales leídos de varias fuentes', () => {
  const nac = (fuente: string, sobre: Partial<Parameters<typeof ed>[0]> = {}) => ed({
    fuente, temporada: '2025-2026', nombre: 'CAMPEONATO DE ESPAÑA VETERANOS', ciudad: 'SANT CUGAT', pais: null,
    inicio: '2026-06-27', categorias: ['VET'], ...sobre,
  });

  it('Skermo, el PDF y Engarde del mismo campeonato son un evento aunque escriban la sede distinto', () => {
    expect(grupos([
      nac('skermo_rfee'), nac('skermo_rfee'),
      nac('engarde', { nombre: 'Campeonato de España de Veteranos 2026', ciudad: 'Sant Cugat', pais: 'ESP' }),
      nac('rfee_pdf', { ciudad: null, inicio: '2026-06-28' }),
    ])).toEqual([0, 0, 0, 0]);
  });

  it('nunca con la FIE o la EFC, ni con otra categoría, ni dos sedes de la misma fuente, ni sin categorías', () => {
    expect(grupos([nac('skermo_rfee'), nac('fie', { ciudad: null })])).toEqual([0, 1]);
    expect(grupos([nac('skermo_rfee', { categorias: ['M15'] }), nac('rfee_pdf', { ciudad: null, categorias: ['M17'] })])).toEqual([0, 1]);
    expect(grupos([nac('skermo_rfee'), nac('skermo_rfee', { ciudad: 'MADRID' }), nac('rfee_pdf', { ciudad: null })]))
      .toEqual([0, 1, 0]);
    expect(grupos([nac('skermo_rfee'), nac('rfee_pdf', { ciudad: null, categorias: [] })])).toEqual([0, 1]);
    // Otro fin de semana, aparte.
    expect(grupos([nac('skermo_rfee'), nac('rfee_pdf', { ciudad: null, inicio: '2026-07-10' })])).toEqual([0, 1]);
  });

  it('el torneo del calendario une cualquier fuente nacional', () => {
    expect(grupos([nac('skermo_rfee', { evento: ev(9) }), nac('engarde', { nombre: 'Otro', evento: ev(9), categorias: [] })])).toEqual([0, 0]);
  });
});

const hermana = (n: number, sobre: Partial<PruebaHermana> = {}): PruebaHermana => ({
  id: id(n), edicionId: id(500 + n), arma: 'ESPADA', genero: 'F', categoria: { codigo: 'VET', raw: null },
  formato: 'INDIVIDUAL', fecha: '2026-06-27', fuente: 'skermo_rfee', riqueza: 1, ...sobre,
});

describe('selector del evento con fuentes repetidas', () => {
  it('una opción por prueba, la de la fuente más rica; «Fuente» sólo cuando la actual está repetida', () => {
    const lista = [
      hermana(1),
      hermana(2, { fuente: 'engarde', riqueza: 2 }),
      hermana(3, { arma: 'SABLE', riqueza: 1 }),
      hermana(4, { arma: 'SABLE', fuente: 'rfee_pdf', riqueza: 0 }),
    ];
    const desdeSable = eleccionDelEvento(lista, id(3))!;
    expect(desdeSable.principales.map((h) => h.id)).toEqual([id(2), id(3)]);
    expect(desdeSable.fuentes.map((h) => h.fuente)).toEqual(['skermo_rfee', 'rfee_pdf']);
    expect(desdeSable.grupos).toEqual([]);
    const sinRepetir = eleccionDelEvento([hermana(1), hermana(3, { arma: 'SABLE' })], id(1))!;
    expect(sinRepetir.fuentes).toEqual([]);
  });

  it('los grupos de edad de una fuente van en «Grupo»; la otra fuente lleva al mismo grupo', () => {
    const lista = [
      hermana(1, { categoria: { codigo: 'VET', raw: '+40' } }),
      hermana(2, { categoria: { codigo: 'VET', raw: '+50' } }),
      hermana(3, { fuente: 'engarde', categoria: { codigo: 'VET', raw: '+50' } }),
    ];
    const e = eleccionDelEvento(lista, id(2))!;
    expect(e.grupos.map((h) => h.id)).toEqual([id(1), id(2)]);
    expect(e.fuentes.map((h) => h.id)).toEqual([id(2), id(3)]);
  });

  it('la pantalla pinta la fila «Fuente» sólo con duplicados y sin popover', () => {
    const p = { ...hermana(1), resultados: { estado: 'completo' as const, importados: 3 }, enlaces: [], pruebaCalendarioId: null, asaltos: 0 };
    const edicion = {
      id: id(501), nombre: 'CAMPEONATO DE ESPAÑA VETERANOS', temporada: '2025-2026', fuente: 'skermo_rfee', ciudad: null, pais: null,
      inicio: '2026-06-27', fin: null, pruebas: 1, armas: ['ESPADA' as const], formatos: ['INDIVIDUAL' as const], serie: null,
      pruebasDetalle: [p], pruebaDesconocida: false, clasificacion: null, pruebaElegida: id(1),
    };
    const con = renderToStaticMarkup(React.createElement(PruebasDeEdicion, {
      edicion: { ...edicion, hermanas: [hermana(1), hermana(2, { fuente: 'engarde', riqueza: 2 }), hermana(3, { arma: 'SABLE' })] },
      seleccionada: id(1),
    }));
    expect(con).toContain('aria-label="Fuente"');
    expect(con).toContain('>Engarde<');
    expect(con).not.toContain('aria-haspopup');
    const sin = renderToStaticMarkup(React.createElement(PruebasDeEdicion, {
      edicion: { ...edicion, hermanas: [hermana(1), hermana(3, { arma: 'SABLE' })] }, seleccionada: id(1),
    }));
    expect(sin).not.toContain('aria-label="Fuente"');
  });
});

describe('una edición con muchas pruebas usa el mismo selector', () => {
  const prueba = (n: number, arma: string, genero: string, formato: string, importados = 1) => ({
    id: id(n), arma, genero, categoria: { codigo: 'ABS', raw: null }, formato, fecha: '2026-07-30', fuente: 'fie',
    pruebaCalendarioId: null, resultados: { estado: 'completo' as const, importados }, enlaces: [], asaltos: 0,
  });
  const pruebas = [
    prueba(1, 'ESPADA', 'M', 'INDIVIDUAL'), prueba(2, 'ESPADA', 'F', 'INDIVIDUAL'), prueba(3, 'SABLE', 'M', 'INDIVIDUAL'),
    prueba(4, 'SABLE', 'F', 'EQUIPOS'), prueba(5, 'FLORETE', 'M', 'EQUIPOS', 0),
  ] as never as PruebaDeEdicion[];

  it('filas de arma, género y modalidad con enlaces ?prueba= de la propia edición y lo fijo en una línea', () => {
    const marcado = renderToStaticMarkup(React.createElement(PruebasDeEdicion, {
      edicion: {
        id: id(900), nombre: 'World Championships', temporada: '2026', fuente: 'fie', ciudad: 'Hong Kong', pais: 'HKG',
        inicio: '2026-07-30', fin: null, pruebas: 5, armas: ['ESPADA', 'FLORETE', 'SABLE'], formatos: ['EQUIPOS', 'INDIVIDUAL'], serie: null,
        pruebasDetalle: pruebas as never, pruebaDesconocida: false, clasificacion: null, pruebaElegida: id(1),
      },
      seleccionada: id(1),
    }));
    for (const fila of ['Arma', 'Género', 'Modalidad']) expect(marcado).toContain(`aria-label="${fila}"`);
    expect(marcado).toContain(`href="${construirUrlEdicion(id(900), { prueba: id(3) })}"`);
    expect(marcado).toContain('>Absoluto<');
    expect(marcado).not.toContain('aria-haspopup');
  });

  it('sin prueba en la dirección abre la del arma de la cuenta; sin armas, la de siempre', () => {
    expect(pruebaPreferida(pruebas, { armas: ['SABLE'] })?.id).toBe(id(3));
    expect(pruebaPreferida(pruebas, { armas: ['SABLE'], generos: ['F'] })?.id).toBe(id(4));
    expect(pruebaPreferida(pruebas, { armas: ['FLORETE'] })).toBeUndefined();
    expect(pruebaPreferida(pruebas, { armas: [] })).toBeUndefined();
  });
});

describe('URL del catálogo: género y modalidad', () => {
  it('se leen en mayúsculas, van al final de la dirección y se validan al volver', () => {
    const { criterios } = leerCriteriosCatalogo({ q: 'mundial', arma: 'sable', genero: 'f', formato: 'equipos' });
    expect(criterios).toEqual({ ...CRITERIOS_CATALOGO_VACIOS, q: 'mundial', arma: 'SABLE', genero: 'F', formato: 'EQUIPOS' });
    const url = urlCatalogo(criterios);
    expect(url).toBe('/explorar/ediciones?q=mundial&arma=SABLE&genero=F&formato=EQUIPOS');
    expect(sanitizarRetornoCatalogo(url)).toBe(url);
    expect(sanitizarRetornoCatalogo('/explorar/ediciones?genero=Z')).toBe('');
    expect(sanitizarRetornoCatalogo('/explorar/ediciones?formato=PAREJAS')).toBe('');
    // Las direcciones de antes no cambian.
    expect(urlCatalogo({ ...CRITERIOS_CATALOGO_VACIOS, fuente: 'fie', temporada: '2025' })).toBe('/explorar/ediciones?fuente=fie&temporada=2025');
  });

  it('el botón cuenta un filtro por apartado (las fechas, uno) y la caché sólo acepta valores conocidos', () => {
    expect(cuantosFiltrosCatalogo({ ...CRITERIOS_CATALOGO_VACIOS, q: 'x' })).toBe(0);
    expect(cuantosFiltrosCatalogo({ ...CRITERIOS_CATALOGO_VACIOS, arma: 'SABLE', genero: 'F', desde: '2020', hasta: '2024' })).toBe(3);
    expect(criteriosCatalogoCacheables({ q: '', fuente: '', temporada: '', genero: 'F', formato: 'EQUIPOS' }))
      .toMatchObject({ genero: 'F', formato: 'EQUIPOS' });
    expect(criteriosCatalogoCacheables({ q: '', fuente: '', temporada: '', genero: 'Z' })).toBeNull();
  });
});
