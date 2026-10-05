import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { normalizeSportName as normalizarNombre } from '@/lib/identity/resolver';
import { buscarDeportistas } from '@/lib/sport/explorar/busqueda';
import { leerTrayectorias } from '@/lib/sport/explorar/busqueda-trayectoria';
import { leerCatalogoEdiciones } from '@/lib/sport/explorar/catalogo';
import { etiquetaRonda, leerAsaltosDePrueba } from '@/lib/sport/explorar/ediciones-asaltos';
import { sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { TRAYECTORIA_VACIA } from '@/lib/sport/explorar/tipos-busqueda';
import { CLAVES_PRIVADAS, UUID_A as A, UUID_B as B, UUID_C as C, clavesDe, crearContexto } from './helpers/explorar';

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => { throw new Error('El test no puede acceder a Cloudflare'); },
}));

const D = '44444444-4444-4444-8444-444444444444';
const ED1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ED2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const PR1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const PR2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const PR_EQ = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';

const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((cerrar) => cerrar()));

function entorno() {
  const local = localD1();
  cierres.push(local.close);
  const db = createD1Database(local.binding);
  const ctx = { ...crearContexto().ctx, db };
  const s = local.sqlite;
  const persona = (id: string, nombre: string, destino: string | null = null, pais = 'ESP') =>
    s.prepare(`INSERT INTO sport_person (id,display_name,name_normalized,merged_into_person_id,country_code,gender,birth_year)
      VALUES (?,?,?,?,?,'M',1998)`).run(id, nombre, normalizarNombre(nombre), destino, pais);
  const edicion = (id: string, nombre: string, fecha: string, fuente = 'fie') =>
    s.prepare(`INSERT INTO sport_edition (id,source,season,tournament_key,name,city,country_code,start_date)
      VALUES (?,?,'2026',?,?,'Córdoba','ESP',?)`).run(id, fuente, id, nombre, fecha);
  const prueba = (id: string, edicionId: string, fecha: string, formato = 'INDIVIDUAL') =>
    s.prepare(`INSERT INTO sport_competition (id,edition_id,source,season,competition_key,weapon,gender,category,category_raw,format,competition_date)
      VALUES (?,?,'fie','2026',?,'ESPADA','M','ABS','Senior',?,?)`).run(id, edicionId, id, formato, fecha);
  let n = 0;
  const resultado = (pruebaId: string, personaId: string | null, puesto: number | null, pais = 'ESP') =>
    s.prepare(`INSERT INTO sport_result (id,competition_id,source,source_fact_key,person_id,source_name,source_country_code,position,content_hash)
      VALUES (?,?,'fie',?,?,'Nombre publicado',?,?,'hash')`).run(`r-${++n}`, pruebaId, `k-${n}`, personaId, pais, puesto);
  const asalto = (
    pruebaId: string, fase: 'POULE' | 'TABLEAU', ronda: string,
    a: [string, string | null, string, number], b: [string, string | null, string, number], fuente = 'fie',
  ) => {
    const [x, y] = a[0] < b[0] ? [a, b] : [b, a];
    s.prepare(`INSERT INTO sport_bout (id,competition_id,source,phase,round_key,fencer_a_ref,fencer_b_ref,fencer_a_person_id,fencer_b_person_id,
      fencer_a_name,fencer_b_name,score_a,score_b,content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'h')`)
      .run(`b-${++n}`, pruebaId, fuente, fase, ronda, x[0], y[0], x[1], y[1], x[2], y[2], x[3], y[3]);
  };
  return { ...local, db, ctx, persona, edicion, prueba, resultado, asalto };
}

describe('trayectoria de la búsqueda, en una sola consulta acotada', () => {
  it('suma medallas individuales de todo el grupo de fusión, ignora equipos y elige la última competición', async () => {
    const t = entorno();
    t.persona(C, 'Carlos Llavador');
    t.persona(B, 'LLAVADOR Carlos', C);
    t.persona(A, 'Llavador C.', B);
    t.edicion(ED1, 'Copa del Mundo Antigua', '2025-01-10');
    t.edicion(ED2, 'Gran Premio Reciente', '2026-03-01');
    t.prueba(PR1, ED1, '2025-01-10');
    t.prueba(PR2, ED2, '2026-03-01');
    t.prueba(PR_EQ, ED2, '2026-03-02', 'EQUIPOS');
    t.resultado(PR1, A, 1);
    t.resultado(PR2, C, 3);
    t.resultado(PR_EQ, B, 1);

    const antes = t.calls.length;
    const mapa = await leerTrayectorias(t.db, [C, D]);
    expect(t.calls.length - antes).toBe(1);
    expect(mapa.get(C)).toEqual({
      ultima: { edicionId: ED2, torneo: 'Gran Premio Reciente', fecha: '2026-03-02' },
      mejorPuesto: 1,
      oros: 1,
      platas: 0,
      bronces: 1,
    });
    expect(mapa.get(D)).toEqual(TRAYECTORIA_VACIA);
  });

  it('la búsqueda devuelve la trayectoria sin datos privados', async () => {
    const t = entorno();
    t.persona(C, 'Carlos Llavador');
    t.edicion(ED1, 'Copa del Mundo', '2026-01-10');
    t.prueba(PR1, ED1, '2026-01-10');
    t.resultado(PR1, C, 2);
    const r = await buscarDeportistas(t.ctx, { q: 'llavador' });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.items[0].trayectoria).toMatchObject({ mejorPuesto: 2, platas: 1, ultima: { edicionId: ED1 } });
    expect(CLAVES_PRIVADAS.filter((k) => clavesDe(r).has(k))).toEqual([]);
  });
});

describe('sugerencias tolerantes al orden de palabras', () => {
  it('«juan perez» encuentra «PEREZ GARCIA Juan» y lleva su resumen de resultados y armas', async () => {
    const t = entorno();
    t.persona(A, 'PEREZ GARCIA Juan');
    t.persona(B, 'Juana Martín');
    t.edicion(ED1, 'Copa', '2026-01-10');
    t.prueba(PR1, ED1, '2026-01-10');
    t.resultado(PR1, A, 5);
    for (const q of ['juan perez', 'Pérez García Juan', 'GARCIA juan']) {
      const r = await sugerirPersonas(t.ctx, { q });
      if (r.estado !== 'ok') throw new Error(r.estado);
      expect(r.items.map((p) => p.id)).toContain(A);
      const juan = r.items.find((p) => p.id === A);
      expect(juan).toMatchObject({ resultados: 1, armas: ['ESPADA'] });
    }
    expect(t.calls.every((c) => c.parameters <= 100)).toBe(true);
  });
});

describe('poules y cuadro de una prueba', () => {
  it('calcula la matriz de poule y ordena el cuadro desde la final, con una sola fuente', async () => {
    const t = entorno();
    for (const [id, nombre] of [[A, 'Ana'], [B, 'Bea'], [C, 'Carla'], [D, 'Dora']] as const) t.persona(id, nombre);
    t.edicion(ED1, 'Copa', '2026-01-10');
    t.prueba(PR1, ED1, '2026-01-10');
    t.resultado(PR1, A, 1, 'ITA');
    // Poule de tres: Ana gana las dos, Bea una.
    t.asalto(PR1, 'POULE', 'P1', ['ra', A, 'ANA', 5], ['rb', B, 'BEA', 2]);
    t.asalto(PR1, 'POULE', 'P1', ['ra', A, 'ANA', 5], ['rc', C, 'CARLA', 4]);
    t.asalto(PR1, 'POULE', 'P1', ['rb', B, 'BEA', 5], ['rc', C, 'CARLA', 1]);
    // Semifinales y final: Ana gana a Dora y luego a Bea.
    t.asalto(PR1, 'TABLEAU', 'A4', ['rb', B, 'BEA', 15], ['rc', C, 'CARLA', 9]);
    t.asalto(PR1, 'TABLEAU', 'A4', ['ra', A, 'ANA', 15], ['rd', D, 'DORA', 10]);
    t.asalto(PR1, 'TABLEAU', 'A2', ['ra', A, 'ANA', 15], ['rb', B, 'BEA', 12]);
    // Otra fuente con menos asaltos: no se mezcla.
    t.asalto(PR1, 'TABLEAU', 'A2', ['xa', null, 'OTRA', 1], ['xb', null, 'FUENTE', 0], 'skermo_rfee');

    const r = await leerAsaltosDePrueba(t.ctx, PR1);
    if (!r) throw new Error('sin asaltos');
    expect(r.fuente).toBe('fie');
    expect(r.truncado).toBe(false);
    const [p1] = r.poules;
    expect(p1.etiqueta).toBe('Poule 1');
    expect(p1.filas.map((f) => [f.nombre, f.victorias, f.tocados, f.recibidos])).toEqual([
      ['ANA', 2, 10, 6], ['BEA', 1, 7, 6], ['CARLA', 0, 5, 10],
    ]);
    expect(p1.filas[0].pais).toBe('ITA');
    expect(p1.filas[0].celdas).toEqual([null, { tantos: 5, victoria: true }, { tantos: 5, victoria: true }]);
    expect(r.cuadro.map((x) => x.etiqueta)).toEqual(['Semifinales', 'Final']);
    // La semifinal de la finalista A (Ana) va primero, como se dibuja el cuadro.
    expect(r.cuadro[0].asaltos.map((x) => [x.a.nombre, x.b.nombre])).toEqual([['ANA', 'DORA'], ['BEA', 'CARLA']]);
    expect(JSON.stringify(r)).not.toMatch(/"ref|skermo/);
    expect(await leerAsaltosDePrueba(t.ctx, PR2)).toBeNull();
  });

  it('etiqueta las claves de ronda publicadas en palabras', () => {
    expect(etiquetaRonda('TABLEAU', 'A64')).toBe('Tabla de 64');
    expect(etiquetaRonda('TABLEAU', 'A2')).toBe('Final');
    expect(etiquetaRonda('TABLEAU', 'C2')).toBe('Tercer puesto');
    expect(etiquetaRonda('POULE', 'V2P3')).toBe('Vuelta 2, poule 3');
    expect(etiquetaRonda('POULE', 'P4')).toBe('Poule 4');
  });
});

describe('catálogo', () => {
  it('cuenta las filas de clasificación de cada edición sin leerlas', async () => {
    const t = entorno();
    t.persona(A, 'Ana');
    t.persona(B, 'Bea');
    t.edicion(ED1, 'Copa con resultados', '2026-01-10');
    t.edicion(ED2, 'Copa vacía', '2026-02-10');
    t.prueba(PR1, ED1, '2026-01-10');
    t.prueba(PR_EQ, ED1, '2026-01-11', 'EQUIPOS');
    t.resultado(PR1, A, 1);
    t.resultado(PR1, B, 2);
    t.resultado(PR_EQ, null, 1);
    const r = await leerCatalogoEdiciones(t.ctx, {});
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.ediciones.map((e) => [e.id, e.clasificados])).toEqual([[ED2, 0], [ED1, 3]]);
  });
});
