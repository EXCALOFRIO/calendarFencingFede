import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { buscarDatoDeCuenta } from '@/lib/cache/privacidad';
import { leerDueloPaises, leerEstadoPaises, leerFichaPais } from '@/lib/sport/explorar/pais';
import { crearCachesPais } from '@/lib/sport/explorar/pais-cache';
import { codigoPaisDeRuta, esCodigoPais, nombrePaisFie } from '@/lib/sport/explorar/pais-codigos';
import { cifra, contexto, frasesDuelo, frasesPais } from '@/lib/sport/explorar/pais-frases';
import { INDICES_PRUEBA, SENTENCIAS_PAISES, TABLA_PRUEBA, sqlPruebasDeTrozo } from '@/lib/sport/explorar/pais-indice-sql';
import { cabeceraDeRuta } from '@/components/navegacion-app';
import {
  FILTROS_DUELO_VACIOS,
  FILTROS_PAIS_VACIOS,
  leerCursorDuelo,
  leerFiltrosDuelo,
  leerFiltrosPais,
  urlDuelo,
  urlPais,
} from '@/lib/sport/explorar/pais-url';
import { crearContexto } from './helpers/explorar';

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => { throw new Error('El test no puede acceder a Cloudflare'); },
}));

const raiz = new URL('../drizzle-d1/', import.meta.url);
const MIGRACION = readFileSync(new URL('0018_explorar_paises.sql', raiz), 'utf8');
/** Sólo tablas e índices de la 0010 y la 0013: sus disparadores piden el lease de escritura. */
const tablas = (fichero: string) => [...readFileSync(new URL(fichero, raiz), 'utf8')
  .matchAll(/^CREATE (?:UNIQUE )?(?:TABLE|INDEX)[\s\S]*?;(?=\r?$)/gm)].map((m) => m[0]).join('\n');

const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((c) => c()));

const id = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const P = {
  ana: id(1), bea: id(2), beaCopia: id(3), iris: id(4), ilaria: id(5), fanny: id(6), sinPais: id(7),
};
const ED = { fie: id(20), nacional: id(21), efc: id(22) };
const C = { m20: id(30), nacional: id(31), equipos: id(32), conjunta: id(33), parte: id(34) };

function entorno() {
  const local = localD1();
  cierres.push(local.close);
  const s = local.sqlite;
  s.exec(tablas('0010_relevos.sql'));
  s.exec(tablas('0013_pruebas_conjuntas.sql'));
  s.exec(MIGRACION);
  const persona = (pid: string, nombre: string, pais: string | null, fundidaEn: string | null = null, anio = 2008) =>
    s.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, merged_into_person_id, country_code, gender, birth_year)
      VALUES (?, ?, ?, ?, ?, 'F', ?)`).run(pid, nombre, nombre.toLowerCase(), fundidaEn, pais, anio);
  persona(P.ana, 'GARCIA Ana', 'ESP');
  persona(P.bea, 'LOPEZ Bea', 'ESP');
  persona(P.beaCopia, 'LOPEZ B.', null, P.bea);
  // Ficha italiana, pero en la prueba compite por España: manda la prueba.
  persona(P.iris, 'ROSSI Iris', 'ITA');
  persona(P.ilaria, 'BIANCHI Ilaria', 'ITA');
  persona(P.fanny, 'MARTIN Fanny', 'FRA');
  persona(P.sinPais, 'SIN Pais', null);

  const edicion = (eid: string, fuente: string, pais: string | null) =>
    s.prepare(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date, country_code)
      VALUES (?, ?, '2025', ?, ?, '2025-02-01', ?)`).run(eid, fuente, eid, `Copa ${fuente}`, pais);
  edicion(ED.fie, 'fie', 'ITA');
  edicion(ED.nacional, 'skermo_rfee', null);
  edicion(ED.efc, 'efc', 'HUN');
  const prueba = (cid: string, eid: string, fuente: string, formato: string, temporada: string, fecha: string) =>
    s.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, category_raw, format, competition_date)
      VALUES (?, ?, ?, ?, ?, 'ESPADA', 'F', 'M20', 'Junior', ?, ?)`).run(cid, eid, fuente, temporada, cid, formato, fecha);
  prueba(C.m20, ED.fie, 'fie', 'INDIVIDUAL', '2025', '2025-02-01');
  prueba(C.nacional, ED.nacional, 'skermo_rfee', 'INDIVIDUAL', '2024-2025', '2025-03-01');
  prueba(C.equipos, ED.fie, 'fie', 'EQUIPOS', '2025', '2025-02-02');
  prueba(C.conjunta, ED.efc, 'efc', 'INDIVIDUAL', '2023-2024', '2024-01-10');
  prueba(C.parte, ED.efc, 'efc', 'INDIVIDUAL', '2023-2024', '2024-01-10');
  s.prepare(`INSERT INTO sport_competition_combined (id, part_competition_id, combined_competition_id, rule, shared_names, created_at)
    VALUES ('cc1', ?, ?, 'partes', 3, 0)`).run(C.parte, C.conjunta);

  let n = 0;
  const resultado = (cid: string, fuente: string, clave: string, pid: string | null, pais: string | null, puesto: number, nombre = 'Publicado') =>
    s.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, source_country_code, source_club, position, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'CLUB SECRETO', ?, 'h')`).run(`r${++n}`, cid, fuente, clave, pid, nombre, pais, puesto);
  resultado(C.m20, 'fie', 'ana', P.ana, 'ESP', 1);
  resultado(C.m20, 'fie', 'bea', P.beaCopia, 'ESP', 3);
  resultado(C.m20, 'fie', 'iris', P.iris, 'ESP', 9);
  resultado(C.m20, 'fie', 'ilaria', P.ilaria, 'ITA', 2);
  resultado(C.m20, 'fie', 'fanny', P.fanny, 'FRA', 3);
  // Un código de club en la columna del país, sin país en la ficha: no cuenta para nadie.
  resultado(C.m20, 'fie', 'sinpais', P.sinPais, 'CET', 5);
  resultado(C.nacional, 'skermo_rfee', 'ana', P.ana, null, 1);
  resultado(C.nacional, 'skermo_rfee', 'ilaria', P.ilaria, null, 2);
  resultado(C.equipos, 'fie', 'team:ESP', null, 'ESP', 1, 'Spain');
  resultado(C.equipos, 'fie', 'team:ITA', null, 'ITA', 2, 'Italy');
  resultado(C.conjunta, 'efc', 'ana', null, 'ESP', 1);
  resultado(C.parte, 'efc', 'ana', P.ana, 'ESP', 2);

  let b = 0;
  const asalto = (cid: string, fuente: string, fase: string, ronda: string, ra: string, rb: string, pa: string | null, pb: string | null, sa: number, sb: number) => {
    // La base exige refs ordenadas: se intercambian los lados si hace falta.
    const [x, y] = ra < rb ? [[ra, pa, sa], [rb, pb, sb]] as const : [[rb, pb, sb], [ra, pa, sa]] as const;
    s.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_person_id, fencer_b_person_id,
        fencer_a_name, fencer_b_name, score_a, score_b, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'h')`).run(id(100 + ++b), cid, fuente, fase, ronda, x[0], y[0], x[1], y[1], String(x[0]), String(y[0]), x[2], y[2]);
  };
  asalto(C.m20, 'fie', 'POULE', 'P1', 'ana', 'ilaria', P.ana, P.ilaria, 5, 3);
  asalto(C.m20, 'fie', 'POULE', 'P1', 'bea', 'ilaria', P.beaCopia, P.ilaria, 2, 5);
  asalto(C.m20, 'fie', 'TABLEAU', 'A2', 'ana', 'ilaria', P.ana, P.ilaria, 15, 10);
  asalto(C.m20, 'fie', 'TABLEAU', 'A4', 'ana', 'fanny', P.ana, P.fanny, 15, 14);
  // Mismo país: no es un cruce entre selecciones.
  asalto(C.m20, 'fie', 'POULE', 'P1', 'ana', 'bea', P.ana, P.beaCopia, 5, 1);
  // Iris compite por España: su asalto con Ilaria es España contra Italia.
  asalto(C.m20, 'fie', 'POULE', 'P2', 'iris', 'ilaria', P.iris, P.ilaria, 4, 5);
  asalto(C.nacional, 'skermo_rfee', 'POULE', 'P1', 'ana', 'ilaria', P.ana, P.ilaria, 5, 0);
  asalto(C.equipos, 'fie', 'TABLEAU', 'A2', 'team:ESP', 'team:ITA', null, null, 45, 40);

  // El encuentro guardado con los equipos al revés que el asalto.
  s.prepare(`INSERT INTO sport_team_match (id, competition_id, source, source_key, phase, round_key, team_a_name, team_b_name, team_a_ref, team_b_ref, score_a, score_b, consistent)
    VALUES ('m1', ?, 'fie', 'a2-1', 'TABLEAU', 'A2', 'Italy', 'Spain', 'team:ITA', 'team:ESP', 40, 45, 1)`).run(C.equipos);
  const relevo = (num: number, pi: string, pe: string, ti: number, te: number, di: number, de: number) =>
    s.prepare(`INSERT INTO sport_relay (id, match_id, relay_number, fencer_a_name, fencer_b_name, fencer_a_person_id, fencer_b_person_id,
        touches_a, touches_b, before_a, before_b, after_a, after_b, consistent)
      VALUES (?, 'm1', ?, 'x', 'y', ?, ?, ?, ?, 0, 0, ?, ?, 1)`).run(`rl${num}`, num, pi, pe, ti, te, di, de);
  relevo(1, P.ilaria, P.ana, 5, 3, 5, 3);
  relevo(2, P.ilaria, P.beaCopia, 2, 7, 7, 10);

  const reconstruir = (sentencias: readonly string[] = SENTENCIAS_PAISES) => {
    s.exec('BEGIN');
    for (const x of sentencias) s.exec(x);
    s.exec('COMMIT');
  };
  const db = createD1Database(local.binding);
  return { s, db, reconstruir, local };
}

const fila = (s: ReturnType<typeof entorno>['s'], sqlTexto: string, ...p: string[]) => s.prepare(sqlTexto).get(...p) as Record<string, unknown> | undefined;

describe('agregados por país (0018)', () => {
  it('resumen con medallas, tiradores y pruebas, sólo internacionales y sin la conjunta', () => {
    const { s, reconstruir } = entorno();
    reconstruir();
    const total = fila(s, `SELECT sum(pruebas) pruebas, sum(resultados) resultados, sum(oros) oros, sum(platas) platas,
      sum(bronces) bronces, sum(finales) finales, min(mejor) mejor FROM explorar_pais_resumen WHERE pais='ESP'`);
    // M20 individual y equipos, más la parte de la EFC; ni la nacional ni la conjunta.
    expect(total).toMatchObject({ pruebas: 3, resultados: 5, oros: 2, platas: 1, bronces: 1, finales: 4, mejor: 1 });
    const individual = fila(s, `SELECT * FROM explorar_pais_resumen WHERE pais='ESP' AND arma='ESPADA' AND genero='F' AND categoria='M20' AND modalidad='I' AND temporada='2024-2025'`);
    expect(individual).toMatchObject({ pruebas: 1, resultados: 3, tiradores: 3, oros: 1, bronces: 1 });
    const equipos = fila(s, `SELECT * FROM explorar_pais_resumen WHERE pais='ESP' AND modalidad='E'`);
    expect(equipos).toMatchObject({ pruebas: 1, tiradores: 0, oros: 1 });
    // Personas distintas: Ana está en dos pruebas y Bea con su copia fundida cuenta una vez.
    expect(fila(s, `SELECT tiradores FROM explorar_pais_tiradores WHERE pais='ESP' AND arma='' AND genero='' AND categoria=''`)?.tiradores).toBe(3);
    expect(fila(s, `SELECT tiradores FROM explorar_pais_tiradores WHERE pais='ESP' AND arma='ESPADA' AND genero='F' AND categoria='M20'`)?.tiradores).toBe(3);
    expect(fila(s, `SELECT count(*) n FROM explorar_pais_tiradores WHERE pais='ESP'`)?.n).toBe(8);
    // La FIE guarda «2025»: es la temporada 2024-2025.
    expect(fila(s, `SELECT count(*) AS n FROM explorar_pais_resumen WHERE temporada = '2025'`)?.n).toBe(0);
    // El código de club no es un país.
    expect(fila(s, `SELECT count(*) AS n FROM explorar_pais_resumen WHERE pais = 'CET'`)?.n).toBe(0);
    expect(fila(s, `SELECT count(*) AS n FROM explorar_pais_medalla WHERE pais = 'ESP'`)?.n).toBe(4);
  });

  it('cruces por prueba y pareja, y totales por rival en las dos orientaciones', () => {
    const { s, reconstruir } = entorno();
    reconstruir();
    const esp = fila(s, `SELECT sum(asaltos) a, sum(victorias_a) v, sum(victorias_b) d, sum(tocados_a) f, sum(tocados_b) c
      FROM explorar_pais_prueba WHERE pais_a='ESP' AND pais_b='ITA' AND modalidad='I'`);
    expect(esp).toMatchObject({ a: 4, v: 2, d: 2, f: 26, c: 23 });
    expect(fila(s, `SELECT * FROM explorar_pais_rival WHERE pais_a='ESP' AND pais_b='ITA'`))
      .toMatchObject({ asaltos: 4, victorias: 2, derrotas: 2, encuentros: 1, ganados: 1, perdidos: 0, ultima: '2024-2025' });
    expect(fila(s, `SELECT * FROM explorar_pais_rival WHERE pais_a='ITA' AND pais_b='ESP'`))
      .toMatchObject({ asaltos: 4, victorias: 2, derrotas: 2, encuentros: 1, ganados: 0, perdidos: 1 });
    expect(fila(s, `SELECT * FROM explorar_pais_rival WHERE pais_a='FRA' AND pais_b='ESP'`)).toMatchObject({ asaltos: 1, victorias: 0, derrotas: 1 });
    const pruebaFila = fila(s, `SELECT * FROM explorar_pais_prueba WHERE pais_a='ESP' AND pais_b='ITA' AND competition_id=?`, C.m20);
    expect(pruebaFila).toMatchObject({ asaltos: 4, victorias_a: 2, victorias_b: 2 });
    // El asalto de Iris con Ilaria tiene a Ilaria en el lado A: va marcado con «~».
    expect(JSON.parse(String(pruebaFila?.asaltos_ids)).filter((x: string) => x.startsWith('~'))).toHaveLength(1);
    // Ni el asalto de la prueba nacional ni el de dos españolas.
    expect(fila(s, `SELECT count(*) n FROM explorar_pais_prueba`)?.n).toBe(3);
  });

  it('repartir las pruebas en trozos da lo mismo que una sola pasada', () => {
    const { s, reconstruir } = entorno();
    reconstruir();
    const consulta = 'SELECT * FROM explorar_pais_prueba ORDER BY 1, 2, 3, 4';
    const trozos = s.prepare(consulta).all();
    const sinPruebas = SENTENCIAS_PAISES.filter((x) => !x.startsWith('INSERT INTO explorar_pais_prueba'));
    const i = sinPruebas.findIndex((x) => x.startsWith('INSERT INTO explorar_pais_codigo'));
    reconstruir([...sinPruebas.slice(0, i + 1), sqlPruebasDeTrozo(0, 1), ...sinPruebas.slice(i + 1)]);
    expect(s.prepare(consulta).all()).toEqual(trozos);
  });
  it('la tabla que la reconstrucción vuelve a crear es la de la 0018', () => {
    const plano = (x: string) => x.replace(/\s+/g, ' ').trim();
    expect(plano(MIGRACION)).toContain(plano(TABLA_PRUEBA));
    for (const indice of INDICES_PRUEBA) expect(plano(MIGRACION)).toContain(plano(indice));
  });

  it('reconstruir dos veces deja lo mismo', () => {
    const { s, reconstruir } = entorno();
    reconstruir();
    const antes = s.prepare('SELECT * FROM explorar_pais_resumen ORDER BY 1, 2, 3, 4, 5, 6').all();
    reconstruir();
    expect(s.prepare('SELECT * FROM explorar_pais_resumen ORDER BY 1, 2, 3, 4, 5, 6').all()).toEqual(antes);
    expect(fila(s, `SELECT count(*) n FROM explorar_pais_estado`)?.n).toBe(1);
  });
});

describe('lecturas de las pantallas', () => {
  it('ficha del país con filtros, podios y rivales', async () => {
    const { db, reconstruir } = entorno();
    reconstruir();
    const ficha = await leerFichaPais(db, 'ESP', { ...FILTROS_PAIS_VACIOS, modalidad: 'individual' });
    expect(ficha.total).toMatchObject({ oros: 1, platas: 1, bronces: 1, tiradores: 3 });
    expect(ficha.temporadas.map((t) => t.temporada)).toEqual(['2023-2024', '2024-2025']);
    expect(ficha.categorias).toEqual(['M20']);
    expect(ficha.podios.map((p) => p.persona?.id)).toEqual([P.ana, P.bea, P.ana]);
    expect(ficha.rivales.map((r) => r.codigo)).toEqual(['ITA', 'FRA']);
    const conEquipos = await leerFichaPais(db, 'ESP', FILTROS_PAIS_VACIOS);
    expect(conEquipos.podios.find((p) => p.modalidad === 'E')?.persona).toBeNull();
    const sinNada = await leerFichaPais(db, 'ESP', { ...FILTROS_PAIS_VACIOS, arma: 'SABLE' });
    expect(sinNada.total).toBeNull();
  });

  it('cara a cara orientado desde el país de la ruta, con cruces, personas que prevalecen y relevos', async () => {
    const { db, reconstruir } = entorno();
    reconstruir();
    const d = await leerDueloPaises(db, 'ESP', 'ITA', FILTROS_DUELO_VACIOS);
    expect(d.individual).toMatchObject({ asaltos: 4, victorias: 2, derrotas: 2 });
    expect(d.equipos).toMatchObject({ asaltos: 1, victorias: 1, derrotas: 0 });
    expect(d.categorias).toEqual(['M20']);
    const individual = d.pruebas.find((p) => p.modalidad === 'I')!;
    expect(individual.cruces.map((c) => [c.nuestro.nombre, c.tocadosNuestros, c.tocadosSuyos, c.suyo.nombre])).toEqual([
      ['GARCIA Ana', 15, 10, 'BIANCHI Ilaria'],
      ['GARCIA Ana', 5, 3, 'BIANCHI Ilaria'],
      ['LOPEZ Bea', 2, 5, 'BIANCHI Ilaria'],
      ['ROSSI Iris', 4, 5, 'BIANCHI Ilaria'],
    ]);
    // La copia fundida se enseña como la persona que prevalece.
    expect(individual.cruces[2].nuestro.personaId).toBe(P.bea);
    const equipos = d.pruebas.find((p) => p.modalidad === 'E')!;
    const encuentro = equipos.cruces[0];
    expect([encuentro.tocadosNuestros, encuentro.tocadosSuyos]).toEqual([45, 40]);
    expect(encuentro.relevos?.map((r) => [r.nuestro?.personaId, r.tocadosNuestros, r.tocadosSuyos, r.marcadorNuestro, r.marcadorSuyo]))
      .toEqual([[P.ana, 3, 5, 3, 5], [P.bea, 7, 2, 10, 7]]);

    const desdeItalia = await leerDueloPaises(db, 'ITA', 'ESP', FILTROS_DUELO_VACIOS);
    expect(desdeItalia.pruebas.find((p) => p.modalidad === 'I')).toMatchObject({ victorias: 2, derrotas: 2 });
    expect(desdeItalia.pruebas.find((p) => p.modalidad === 'E')?.cruces[0].relevos?.[0]).toMatchObject({ tocadosNuestros: 5, tocadosSuyos: 3 });

    const soloTemporada = await leerDueloPaises(db, 'ESP', 'ITA', { ...FILTROS_DUELO_VACIOS, temporada: '2023-2024' });
    expect(soloTemporada.individual.asaltos).toBe(0);
    expect(soloTemporada.temporadas.length).toBe(1);
  });

  it('pagina la lista de pruebas con un cursor', async () => {
    const { db, reconstruir } = entorno();
    reconstruir();
    const primera = await leerDueloPaises(db, 'ESP', 'ITA', FILTROS_DUELO_VACIOS);
    expect(primera.siguiente).toBeNull();
    const despues = await leerDueloPaises(db, 'ESP', 'ITA', FILTROS_DUELO_VACIOS, `2025-02-02~${C.equipos}`);
    expect(despues.pruebas.map((p) => p.pruebaId)).toEqual([C.m20]);
    expect(despues.individual.asaltos).toBe(0);
  });

  it('nada de clubes, años de nacimiento ni datos de cuenta en los DTO', async () => {
    const { db, reconstruir } = entorno();
    reconstruir();
    const textos = JSON.stringify([
      await leerFichaPais(db, 'ESP', FILTROS_PAIS_VACIOS),
      await leerDueloPaises(db, 'ESP', 'ITA', FILTROS_DUELO_VACIOS),
    ]);
    expect(textos).not.toMatch(/CLUB SECRETO|2008|birth|club|foto|fie_id|anio/i);
    expect(buscarDatoDeCuenta(JSON.parse(textos))).toBeNull();
  });

  it('sin la 0018 el estado es nulo y la ficha dice que no hay datos', async () => {
    const local = localD1();
    cierres.push(local.close);
    const db = createD1Database(local.binding);
    await expect(leerEstadoPaises(db)).resolves.toBeNull();
    const caches = crearCachesPais({ cache: cacheDePrueba() as never, publico: () => ({ ...crearContexto().ctx, db }) });
    const ctx = { ...crearContexto().ctx, db };
    await expect(caches.cargarFichaPaisCompartida(ctx, 'ESP', FILTROS_PAIS_VACIOS)).resolves.toEqual({ tipo: 'sin_datos' });
  });
});

/** Caché en memoria con la misma forma que la compartida: cuenta las cargas por clave. */
function cacheDePrueba() {
  const guardado = new Map<string, unknown>();
  const cargas: string[] = [];
  return {
    cargas,
    definir<P extends readonly (string | number | boolean | null)[], T>(def: { espacio: string; cargar: (...p: P) => Promise<T>; guardarSi?: (v: T) => boolean }) {
      const f = async (...p: P) => {
        const clave = `${def.espacio}/${JSON.stringify(p)}`;
        if (guardado.has(clave)) return guardado.get(clave) as T;
        cargas.push(clave);
        const v = await def.cargar(...p);
        if (!def.guardarSi || def.guardarSi(v)) guardado.set(clave, v);
        return v;
      };
      return Object.assign(f, { espacio: def.espacio });
    },
  };
}

describe('caché compartida de las fichas de país', () => {
  it('guarda de sesión antes de la caché, país inválido sin leer y carga con el contexto público', async () => {
    const { db, reconstruir } = entorno();
    reconstruir();
    const cache = cacheDePrueba();
    const publicoDb = { ...db };
    let publicos = 0;
    const caches = crearCachesPais({
      cache: cache as never,
      publico: () => { publicos += 1; return { ...crearContexto().ctx, db: publicoDb }; },
    });
    const sinSesion = { ...crearContexto({ perfil: null }).ctx, db };
    await expect(caches.cargarFichaPaisCompartida(sinSesion, 'ESP', FILTROS_PAIS_VACIOS)).resolves.toEqual({ tipo: 'sin_sesion' });
    expect(cache.cargas).toEqual([]);

    const ctx = { ...crearContexto().ctx, db };
    await expect(caches.cargarFichaPaisCompartida(ctx, 'XYZ', FILTROS_PAIS_VACIOS)).resolves.toEqual({ tipo: 'no_existe' });
    await expect(caches.cargarDueloPaisesCompartido(ctx, 'ESP', 'ESP', FILTROS_DUELO_VACIOS, '')).resolves.toEqual({ tipo: 'no_existe' });

    const a = await caches.cargarFichaPaisCompartida(ctx, 'ESP', FILTROS_PAIS_VACIOS);
    const b = await caches.cargarFichaPaisCompartida(ctx, 'ESP', FILTROS_PAIS_VACIOS);
    expect(a.tipo).toBe('ok');
    expect(b).toBe(a);
    expect(cache.cargas).toHaveLength(1);
    expect(publicos).toBe(1);
    // La clave lleva el país, los filtros y la marca de la reconstrucción; nada de la cuenta.
    expect(cache.cargas[0]).toMatch(/^pais-ficha\/\["ESP","","","","",\d+\]$/);

    await caches.cargarDueloPaisesCompartido(ctx, 'ESP', 'ITA', FILTROS_DUELO_VACIOS, '');
    await caches.cargarDueloPaisesCompartido(ctx, 'ESP', 'ITA', FILTROS_DUELO_VACIOS, `2025-02-02~${C.equipos}`);
    // La página con cursor va directa a D1.
    expect(cache.cargas.filter((c) => c.startsWith('pais-duelo/'))).toHaveLength(1);
  });
});

describe('direcciones, filtros y frases', () => {
  it('códigos de país de la ruta', () => {
    expect(codigoPaisDeRuta('ESP')).toBe('ESP');
    expect(codigoPaisDeRuta('esp')).toBe('ESP');
    expect(codigoPaisDeRuta('CET')).toBeNull();
    expect(codigoPaisDeRuta('FIE')).toBeNull();
    expect(codigoPaisDeRuta('%E0')).toBeNull();
    expect(esCodigoPais('URS')).toBe(true);
    expect(nombrePaisFie('ESP')).toBe('España');
    expect(nombrePaisFie('URS')).toBe('Unión Soviética');
  });

  it('filtros desconocidos se ignoran y las URL son estables', () => {
    expect(leerFiltrosPais({ arma: 'espada', genero: 'x', categoria: 'm20', modalidad: 'EQUIPOS' }))
      .toEqual({ arma: 'ESPADA', genero: '', categoria: 'M20', modalidad: 'equipos' });
    expect(leerFiltrosDuelo({ temporada: '2024-2025' }).temporada).toBe('2024-2025');
    expect(leerFiltrosDuelo({ temporada: '2024-2026' }).temporada).toBe('');
    expect(leerFiltrosDuelo({ temporada: "2024'--" }).temporada).toBe('');
    expect(leerCursorDuelo({ desde: `2025-02-02~${C.m20}` })).toBe(`2025-02-02~${C.m20}`);
    expect(leerCursorDuelo({ desde: 'x~y' })).toBe('');
    expect(urlPais('ESP', { arma: 'ESPADA', categoria: 'M20' })).toBe('/explorar/pais/ESP?arma=ESPADA&categoria=M20');
    expect(urlDuelo('ESP', 'ITA', { arma: 'ESPADA', genero: 'M', categoria: 'M20', modalidad: '', temporada: '' }))
      .toBe('/explorar/pais/ESP/contra/ITA?arma=ESPADA&genero=M&categoria=M20');
  });

  it('frases en lenguaje sencillo, con concordancia y cifras en español', async () => {
    expect(cifra(1562)).toBe('1.562');
    expect(cifra(12)).toBe('12');
    expect(contexto({ arma: 'ESPADA', genero: 'M', categoria: 'M20' })).toBe(' en M20 espada masculina');
    expect(contexto({ arma: 'FLORETE', genero: 'F', categoria: 'ABS' })).toBe(' en florete femenino absoluto');
    expect(contexto({ categoria: 'VET', modalidad: 'equipos' })).toBe(' en veteranos por equipos');
    const { db, reconstruir } = entorno();
    reconstruir();
    const f = { ...FILTROS_PAIS_VACIOS, arma: 'ESPADA', categoria: 'M20' };
    const ficha = await leerFichaPais(db, 'ESP', f);
    expect(frasesPais('España', ficha, f)[0]).toBe('España ganó 4 medallas en M20 espada desde 2024, 2 de oro.');
    const d = await leerDueloPaises(db, 'ESP', 'ITA', FILTROS_DUELO_VACIOS);
    expect(frasesDuelo('España', 'Italia', d, FILTROS_DUELO_VACIOS)).toEqual([
      'España ganó 2 de 4 asaltos contra Italia (50 %).',
      'Por equipos: 1 victoria y 0 derrotas en 1 encuentro.',
    ]);
  });
});

describe('cabecera de las fichas de país', () => {
  it('subpantallas que vuelven a Buscar y a la ficha del país', () => {
    expect(cabeceraDeRuta('/explorar/pais/ESP', false)).toMatchObject({ variante: 'subpantalla', titulo: 'País', volverA: '/explorar/buscar' });
    expect(cabeceraDeRuta('/explorar/pais/ESP/contra/ITA', false)).toMatchObject({ variante: 'subpantalla', titulo: 'Selecciones', volverA: '/explorar/pais/ESP' });
  });
});
