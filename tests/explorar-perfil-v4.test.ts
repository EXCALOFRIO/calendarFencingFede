import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQLInputValue } from 'node:sqlite';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { EncuentrosCaraACara, ResumenEncuentrosVista } from '@/components/explorar/cara-a-cara';
import { CompararPerfil } from '@/components/explorar/perfil/comparar-perfil';
import { ResultadosPerfilVista } from '@/components/explorar/perfil/resultados-perfil';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { aEncuentros, leerCaraACara, listarRivales, sqlPruebasComunes } from '@/lib/sport/explorar/cara-a-cara';
import type { DatosCaraACara } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import {
  CRITERIOS_FICHA_VACIOS,
  construirUrlFicha,
  leerCriteriosFicha,
} from '@/lib/sport/explorar/ficha-url';
import {
  aResultadosPerfil,
  ambitosConResultados,
  cuantosVer,
  filtrarPorAmbito,
  mejoresCompeticiones,
} from '@/lib/sport/explorar/resultados-perfil';
import { sqlPruebasAmbito, type FilaPruebaAmbito } from '@/lib/sport/explorar/stats-ambito';
import { importanciaCompeticion } from '@/lib/sport/explorar/tipo-competicion';
import { crearContexto, perfil } from './helpers/explorar';

/**
 * Perfil v4: resultados por ámbito y «mejores competiciones» sacados de la
 * misma lectura por prueba, rivales por número de asaltos y la lista de
 * cruces del cara a cara. Las consultas se ejecutan sobre el esquema D1 real.
 */

const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((c) => c()));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const YO = uuid(1);
const RIVAL = uuid(3);
const OTRO = uuid(5);
const TERCERO = uuid(6);

function fixture() {
  const local = localD1();
  cierres.push(() => local.close());
  const database = createD1Database(local.binding);
  const dialecto = new SQLiteSyncDialect();
  const db = local.sqlite;
  let n = 0;
  const persona = (id: string, nombre: string, pais = 'ESP') =>
    db.prepare('INSERT INTO sport_person(id, display_name, name_normalized, country_code) VALUES (?,?,?,?)')
      .run(id, nombre, nombre.toLowerCase(), pais);
  const prueba = (id: string, o: { fuente?: string; nombre?: string; fecha?: string; pais?: string | null; ciudad?: string } = {}) => {
    const fuente = o.fuente ?? 'fie';
    db.prepare('INSERT INTO sport_edition(id, source, season, tournament_key, name, start_date, country_code, city) VALUES (?,?,?,?,?,?,?,?)')
      .run(`ed-${id}`, fuente, '2026', id, o.nombre ?? 'Coupe du Monde', o.fecha ?? '2026-01-10', o.pais ?? null, o.ciudad ?? null);
    db.prepare(`INSERT INTO sport_competition(id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date, source_url)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, `ed-${id}`, fuente, '2026', id, 'ESPADA', 'M', 'ABS', 'INDIVIDUAL',
      o.fecha ?? '2026-01-10', `https://fuente.example.test/${id}`);
  };
  const asalto = (competicion: string, a: string, b: string, sa: number, sb: number, fase: 'POULE' | 'TABLEAU' = 'POULE') => {
    n += 1;
    db.prepare(`INSERT INTO sport_bout(id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref,
      fencer_a_person_id, fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, content_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`00000000-0000-4000-a000-${String(n).padStart(12, '0')}`, competicion, 'fie', fase,
      `r${n}`, `a-${n}`, `b-${n}`, a, b, 'A', 'B', sa, sb, `h${n}`);
  };
  const resultado = (competicion: string, personaId: string, puesto: number | null, fuente = 'fie') => {
    n += 1;
    const id = `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
    db.prepare(`INSERT INTO sport_result(id, competition_id, source, source_fact_key, person_id, source_name, position, position_raw, content_hash)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, competicion, fuente, `f${n}`, personaId, 'X', puesto, puesto === null ? null : String(puesto), `h${n}`);
    return id;
  };
  function ejecutar<T>(consulta: SQL): T[] {
    const q = dialecto.sqlToQuery(consulta);
    expect(q.params.length).toBeLessThanOrEqual(100);
    return db.prepare(q.sql).all(...(q.params as SQLInputValue[])) as T[];
  }
  function plan(consulta: SQL): string {
    const q = dialecto.sqlToQuery(consulta);
    return (db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...(q.params as SQLInputValue[])) as { detail: string }[])
      .map((f) => f.detail).join('\n');
  }
  function contexto(): ContextoExplorador {
    return {
      ...crearContexto({ perfil: perfil({ profileId: '00000000-0000-4000-8000-0000000000a1' }) }).ctx,
      db: { execute: (q: SQL) => database.execute(q) } as ContextoExplorador['db'],
    };
  }
  return { persona, prueba, asalto, resultado, ejecutar, plan, contexto };
}

/** Una carrera pequeña con pruebas de cada tipo. */
function carrera() {
  const f = fixture();
  f.persona(YO, 'YO'); f.persona(RIVAL, 'RIVAL', 'FRA'); f.persona(OTRO, 'OTRO'); f.persona(TERCERO, 'TERCERO');
  f.prueba('mundial', { nombre: 'Championnats du Monde', fecha: '2025-07-20', pais: 'ITA', ciudad: 'Milano' });
  f.prueba('cm', { nombre: 'Coupe du Monde', fecha: '2026-01-10', pais: 'FRA', ciudad: 'Paris' });
  f.prueba('tnr', { fuente: 'rfee_pdf', nombre: 'TNR ABS Madrid', fecha: '2026-02-01', ciudad: 'Madrid' });
  f.prueba('cto', { fuente: 'skermo_rfee', nombre: 'CAMPEONATO DE ESPAÑA ABS', fecha: '2026-03-01' });
  f.prueba('solo-asaltos', { nombre: 'Coupe du Monde Doha', fecha: '2026-03-15', pais: 'QAT' });
  f.prueba('abandono', { nombre: 'Grand Prix Doha', fecha: '2025-11-01', pais: 'QAT' });
  f.resultado('mundial', YO, 5);
  f.resultado('cm', YO, 1);
  f.resultado('tnr', YO, 3, 'rfee_pdf');
  f.resultado('cto', YO, 17, 'skermo_rfee');
  f.resultado('abandono', YO, 9999);
  f.resultado('mundial', RIVAL, 2);
  f.resultado('cm', RIVAL, 8);
  f.resultado('abandono', RIVAL, 40);
  f.asalto('mundial', YO, RIVAL, 3, 5);
  f.asalto('mundial', RIVAL, YO, 15, 12, 'TABLEAU');
  f.asalto('cm', YO, RIVAL, 5, 4);
  f.asalto('cm', RIVAL, YO, 3, 5);
  f.asalto('cm', YO, RIVAL, 15, 9, 'TABLEAU');
  f.asalto('solo-asaltos', YO, RIVAL, 4, 4);
  f.asalto('cm', YO, OTRO, 5, 1);
  f.asalto('tnr', YO, TERCERO, 5, 0);
  f.asalto('tnr', TERCERO, YO, 2, 5);
  f.asalto('cto', OTRO, YO, 5, 3);
  return f;
}

describe('resultados del perfil desde la lectura por prueba', () => {
  it('trae la fila de resultado que se enseña, por clave primaria, sin recorrer tablas', () => {
    const f = carrera();
    const filas = f.ejecutar<FilaPruebaAmbito>(sqlPruebasAmbito([YO]));
    const cm = filas.find((r) => r.torneo === 'Coupe du Monde')!;
    expect(cm).toMatchObject({ puesto: 1, puestoResultado: 1, ciudad: 'Paris', arma: 'ESPADA', fecha: '2026-01-10' });
    expect(cm.resultadoId).toMatch(/^00000000-0000-4000-9000-/);
    expect(cm.enlace).toBe('https://fuente.example.test/cm');
    // La prueba con sólo asaltos sigue en las cifras, pero sin resultado que enseñar.
    expect(filas.find((r) => r.torneo === 'Coupe du Monde Doha')).toMatchObject({ resultadoId: null, asaltos: 1 });
    const plan = f.plan(sqlPruebasAmbito([YO]));
    expect(plan).not.toMatch(/SCAN (r|rr|b|c|e|sport_result|sport_bout|sport_competition)\b/);
    expect(plan).toMatch(/SEARCH rr USING INDEX sqlite_autoindex_sport_result_1 \(id=\?\)/);
  });

  it('ordena por fecha, separa ámbitos, no lista pruebas sin clasificación y no enseña 9999 como puesto', () => {
    const f = carrera();
    const r = aResultadosPerfil(f.ejecutar<FilaPruebaAmbito>(sqlPruebasAmbito([YO])));
    expect(r.items.map((i) => i.torneo.nombre)).toEqual([
      'CAMPEONATO DE ESPAÑA ABS', 'TNR ABS Madrid', 'Coupe du Monde', 'Grand Prix Doha', 'Championnats du Monde',
    ]);
    expect(r.porAmbito).toEqual({ internacional: 3, nacional: 2 });
    expect(ambitosConResultados(r)).toEqual(['internacional', 'nacional']);
    expect(filtrarPorAmbito(r.items, 'nacional').map((i) => i.clasificacion.tipo)).toEqual(['CTO_ESPANA', 'TNR']);
    const abandono = r.items.find((i) => i.torneo.nombre === 'Grand Prix Doha')!;
    expect(abandono).toMatchObject({ puesto: null, puestoPublicado: 'Sin puesto final', puestoFiable: null });
    expect(r.items.find((i) => i.torneo.nombre === 'Coupe du Monde')!.asaltos).toEqual({ victorias: 4, derrotas: 0 });
  });

  it('mejores competiciones: medallas primero, luego importancia y luego puesto', () => {
    const f = carrera();
    const r = aResultadosPerfil(f.ejecutar<FilaPruebaAmbito>(sqlPruebasAmbito([YO])));
    expect(mejoresCompeticiones(r.items).map((i) => [i.clasificacion.tipo, i.puesto])).toEqual([
      ['COPA_MUNDO', 1], ['TNR', 3], ['CTO_MUNDO', 5], ['CTO_ESPANA', 17],
    ]);
    expect(importanciaCompeticion('JUEGOS_OLIMPICOS')).toBeLessThan(importanciaCompeticion('CTO_MUNDO'));
    expect(importanciaCompeticion('SATELITE')).toBeLessThan(importanciaCompeticion('CTO_ESPANA'));
  });

  it('el «Ver más» crece de veinte en veinte sin pasarse del total', () => {
    expect(cuantosVer(0, 55)).toBe(20);
    expect(cuantosVer(40, 55)).toBe(40);
    expect(cuantosVer(33, 55)).toBe(40);
    expect(cuantosVer(80, 55)).toBe(55);
    expect(cuantosVer(-3, 7)).toBe(7);
  });
});

describe('URL de la pestaña Resultados', () => {
  it('lee ámbito y «ver» sin fiarse del navegador y los vuelve a escribir', () => {
    expect(leerCriteriosFicha({ ambito: 'Internacional', ver: '40' })).toMatchObject({ ambito: 'internacional', ver: 40 });
    expect(leerCriteriosFicha({ ambito: 'autonomico', ver: '-1' })).toEqual(CRITERIOS_FICHA_VACIOS);
    expect(leerCriteriosFicha({ ver: '99999' })).toEqual(CRITERIOS_FICHA_VACIOS);
    expect(construirUrlFicha('/explorar/x', { ambito: 'nacional', ver: 40 }, 'historial'))
      .toBe('/explorar/x?ambito=nacional&ver=40#historial');
  });
});

describe('vista de resultados', () => {
  const vista = (f: ReturnType<typeof fixture>, criterios = CRITERIOS_FICHA_VACIOS) =>
    renderToStaticMarkup(React.createElement(ResultadosPerfilVista, {
      resultados: aResultadosPerfil(f.ejecutar<FilaPruebaAmbito>(sqlPruebasAmbito([YO]))),
      base: `/explorar/${YO}`,
      criterios,
      nivel: 'pagina',
      personaId: YO,
    }));

  it('con los dos ámbitos ofrece el selector (la URL fija el inicial) y filtra la lista', () => {
    const f = carrera();
    const todo = vista(f);
    expect(todo).toContain('role="radiogroup" aria-label="Ámbito de los resultados"');
    for (const r of ['Todo', 'Internacional', 'Nacional']) expect(todo).toMatch(new RegExp(`role="radio"[^>]*>(?:<span[^>]*></span>)?<span[^>]*>${r}</span>`));
    expect(todo).toContain('Mejores competiciones');
    expect(todo).toContain('data-medalla="1"');
    expect(todo).toContain('rel="noopener noreferrer"');
    const nacional = vista(f, { ...CRITERIOS_FICHA_VACIOS, ambito: 'nacional' });
    expect(nacional).toMatch(/tnr abs madrid/i);
    expect(nacional).not.toMatch(/copa del mundo|coupe du monde/i);
    expect(nacional).toMatch(/aria-checked="true"[^>]*>(?:<span[^>]*><\/span>)?<span[^>]*>Nacional<\/span>/);
  });

  it('con un solo ámbito no hay selector y un ámbito vacío en la URL no deja la pestaña en blanco', () => {
    const f = fixture();
    f.persona(YO, 'YO');
    f.prueba('cm', { nombre: 'Coupe du Monde' });
    f.resultado('cm', YO, 4);
    const salida = vista(f, { ...CRITERIOS_FICHA_VACIOS, ambito: 'nacional' });
    expect(salida).not.toContain('Ámbito de los resultados');
    expect(salida).toMatch(/copa del mundo/i);
  });
});

describe('cara a cara: rivales y cruces', () => {
  it('los rivales van de más a menos asaltos y el cursor recorre todos sin repetir', async () => {
    const f = carrera();
    const ctx = f.contexto();
    const vistos: [string, number][] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const r = await listarRivales(ctx, { personaId: YO, limite: 1, ...(cursor ? { cursor } : {}) });
      if (r.estado !== 'ok') throw new Error(r.estado);
      vistos.push(...r.items.map((x) => [x.nombre, x.asaltos] as [string, number]));
      if (!r.siguiente) break;
      cursor = r.siguiente;
    }
    expect(vistos).toEqual([['RIVAL', 6], ['OTRO', 2], ['TERCERO', 2]]);
  });

  it('la lista de rivales cuenta como el cara a cara: sin lecturas repetidas ni relevos', async () => {
    const DOBLE = uuid(7);
    const f = carrera();
    f.persona(DOBLE, 'DOBLE');
    // El mismo TNR publicado por dos fuentes, con los mismos asaltos y puestos.
    for (const [id, fuente] of [['tnr-pdf', 'rfee_pdf'], ['tnr-sk', 'skermo_rfee']] as const) {
      f.prueba(id, { fuente, nombre: id === 'tnr-pdf' ? 'TNR ABS' : 'TNR ABS (3/3)', fecha: '2026-04-12' });
      f.resultado(id, YO, 3, fuente);
      f.resultado(id, DOBLE, 5, fuente);
      f.asalto(id, YO, DOBLE, 5, 3);
      f.asalto(id, DOBLE, YO, 15, 10, 'TABLEAU');
    }
    // Un relevo de equipos colado en una prueba individual no es un asalto.
    f.prueba('relevo', { fecha: '2026-05-01' });
    f.asalto('relevo', YO, DOBLE, 45, 40, 'TABLEAU');

    const ctx = f.contexto();
    const lista = await listarRivales(ctx, { personaId: YO });
    if (lista.estado !== 'ok') throw new Error(lista.estado);
    const duelo = await leerCaraACara(ctx, { personaId: YO, rivalId: DOBLE });
    if (duelo.estado !== 'ok') throw new Error(duelo.estado);
    // Antes la lista daba 5 asaltos (2 + 2 repetidos + el relevo) frente a 2 del cara a cara.
    expect(duelo.resumen).toMatchObject({ asaltos: 2, victorias: 1, derrotas: 1 });
    expect(lista.items.find((r) => r.id === DOBLE)).toMatchObject({ asaltos: 2, victorias: 1, derrotas: 1 });
    // Y para todos los demás rivales, las mismas cifras.
    for (const r of lista.items) {
      const d = await leerCaraACara(ctx, { personaId: YO, rivalId: r.id });
      if (d.estado !== 'ok') throw new Error(d.estado);
      expect([r.asaltos, r.victorias, r.derrotas]).toEqual([d.resumen.asaltos, d.resumen.victorias, d.resumen.derrotas]);
    }
  });

  it('lista todas las pruebas comunes con los dos puestos, quién quedó delante y los asaltos por fase', async () => {
    const f = carrera();
    const r = await leerCaraACara(f.contexto(), { personaId: YO, rivalId: RIVAL });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.encuentros!.map((e) => [e.torneo, e.puestos.yo, e.puestos.rival, e.delante])).toEqual([
      ['Coupe du Monde Doha', null, null, null],
      ['Coupe du Monde', 1, 8, 'yo'],
      ['Grand Prix Doha', null, 40, null],
      ['Championnats du Monde', 5, 2, 'rival'],
    ]);
    const cm = r.encuentros!.find((e) => e.torneo === 'Coupe du Monde')!;
    expect(cm.asaltos).toEqual({ total: 3, poule: { victorias: 2, derrotas: 0 }, directa: { victorias: 1, derrotas: 0 } });
    expect(r.resumenEncuentros).toMatchObject({
      competiciones: 4, conAmbosPuestos: 2, delanteYo: 1, delanteRival: 1, empates: 0,
      poule: { victorias: 2, derrotas: 1 }, directa: { victorias: 1, derrotas: 1 },
    });
    expect(r.resumenEncuentros!.ultimo?.torneo).toBe('Coupe du Monde Doha');
    // Los mismos asaltos que el balance (el igualado no es victoria ni derrota).
    expect(r.resumen).toMatchObject({ asaltos: 6, victorias: 3, derrotas: 2, sinDecidir: 1 });
  });

  it('visto desde el rival todo se invierte', async () => {
    const f = carrera();
    const ctx = f.contexto();
    const a = await leerCaraACara(ctx, { personaId: YO, rivalId: RIVAL });
    const b = await leerCaraACara(ctx, { personaId: RIVAL, rivalId: YO });
    if (a.estado !== 'ok' || b.estado !== 'ok') throw new Error('lectura');
    const ra = a.resumenEncuentros!, rb = b.resumenEncuentros!;
    expect([rb.delanteYo, rb.delanteRival]).toEqual([ra.delanteRival, ra.delanteYo]);
    expect(rb.poule).toEqual({ victorias: ra.poule.derrotas, derrotas: ra.poule.victorias });
    expect(rb.directa).toEqual({ victorias: ra.directa.derrotas, derrotas: ra.directa.victorias });
    expect(b.encuentros!.map((e) => [e.pruebaId, e.puestos.yo, e.puestos.rival]))
      .toEqual(a.encuentros!.map((e) => [e.pruebaId, e.puestos.rival, e.puestos.yo]));
  });

  it('las pruebas comunes entran por los índices de persona y de pareja', () => {
    const f = carrera();
    const plan = f.plan(sqlPruebasComunes([YO], [RIVAL], {}));
    expect(plan).toMatch(/sport_result_person_date_idx/);
    expect(plan).toMatch(/sport_bout_[ab]_idx/);
    expect(plan).not.toMatch(/SCAN (r|ra|rb|b|sport_result|sport_bout)\b/);
  });

  it('dos fuentes de la misma prueba cuentan una vez, quedándose la que tiene los dos puestos', () => {
    const base = {
      fuente: 'fie', torneo: 'Copa', arma: 'ESPADA' as const, genero: 'M' as const, categoria: 'ABS', categoriaRaw: null,
      temporada: '2026', lecturas: '', equivalencia: 'ev-1',
    };
    const { encuentros, resumen } = aEncuentros([
      { ...base, id: 'a', asaltos: 2, puestoYo: 3, puestoRival: null, pouleV: 1, pouleD: 1 },
      { ...base, id: 'b', asaltos: 1, puestoYo: 3, puestoRival: 9, pouleV: 1, pouleD: 0 },
      { ...base, id: 'c', equivalencia: null, asaltos: 0, puestoYo: 999, puestoRival: 2 },
    ], false);
    expect(encuentros.map((e) => [e.pruebaId, e.delante])).toEqual([['b', 'yo'], ['c', null]]);
    expect(resumen).toMatchObject({ competiciones: 2, conAmbosPuestos: 1, delanteYo: 1, poule: { victorias: 1, derrotas: 0 } });
  });

  it('dos copias sin enlace de calendario con el mismo día, prueba y puestos se funden', () => {
    const base = {
      torneo: 'TNR ABS (3/3)', arma: 'FLORETE' as const, genero: 'M' as const, categoria: 'ABS', categoriaRaw: null,
      temporada: '2025-2026', lecturas: '', equivalencia: null, fecha: '2026-03-14', puestoYo: 2, puestoRival: 13,
    };
    const { encuentros } = aEncuentros([
      { ...base, id: 'pdf', fuente: 'rfee_pdf', asaltos: 0 },
      { ...base, id: 'skermo', fuente: 'skermo_rfee', torneo: 'TNR ABS (3/3) ', asaltos: 1, directaV: 1 },
      { ...base, id: 'otro-dia', fuente: 'rfee_pdf', fecha: '2024-03-03', asaltos: 0 },
      { ...base, id: 'otros-puestos', fuente: 'rfee_pdf', puestoRival: 14, asaltos: 0 },
    ], false);
    expect(encuentros.map((e) => e.pruebaId)).toEqual(['skermo', 'otro-dia', 'otros-puestos']);
  });

  it('pinta el resumen y la lista de cruces', async () => {
    const f = carrera();
    const r = await leerCaraACara(f.contexto(), { personaId: YO, rivalId: RIVAL });
    if (r.estado !== 'ok') throw new Error(r.estado);
    const datos = r as DatosCaraACara;
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(ResumenEncuentrosVista, { datos, resumen: datos.resumenEncuentros! }),
      React.createElement(EncuentrosCaraACara, { datos, encuentros: datos.encuentros! }),
    ));
    expect(html).toContain('id="h2h-cruces"');
    expect(html).toContain('aria-label="Por delante: Yo 1, Rival 1, de 2"');
    // «Grand Prix Doha» es común pero sin asalto entre las dos.
    expect(html).toContain('3 con asaltos');
    expect(html).toContain('>15–9<');
    expect(html).toContain(`href="/explorar/ediciones/ed-cm?prueba=cm&amp;persona=${YO}"`);
  });
});

describe('Comparar', () => {
  it('ofrece los rivales habituales y las sugerencias como enlaces al cara a cara, nunca la propia persona', () => {
    const html = renderToStaticMarkup(React.createElement(CompararPerfil, {
      personaId: YO,
      nombre: 'YO',
      rapidos: [{ id: RIVAL, nombre: 'RIVAL', pais: 'FRA', asaltos: 6, victorias: 3, derrotas: 2 }],
      inicial: {
        texto: 'riv',
        items: [
          { id: YO, nombre: 'YO', alias: null, pais: 'ESP', genero: 'M', anioNacimiento: null, resultados: 5, armas: ['ESPADA'] },
          { id: OTRO, nombre: 'OTRO', alias: null, pais: 'ESP', genero: 'M', anioNacimiento: null, resultados: 2, armas: [] },
        ],
      },
    }));
    expect(html).toContain(`href="/explorar/${YO}/cara-a-cara?rival=${RIVAL}"`);
    expect(html).toContain(`action="/explorar/${YO}/cara-a-cara"`);
    expect(html).not.toContain(`rival=${YO}`);
  });
});
