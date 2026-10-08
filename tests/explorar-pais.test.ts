import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { buscarDatoDeCuenta } from '@/lib/cache/privacidad';
import {
  VERSION_DUELO_COMPLETO, leerDueloPaises, leerEstadoPaises, leerFichaPais, sqlDuelo, sqlTiradoresDuelo,
} from '@/lib/sport/explorar/pais';
import { crearCachesPais } from '@/lib/sport/explorar/pais-cache';
import { codigoPaisDeRuta, esCodigoPais, nombrePaisFie } from '@/lib/sport/explorar/pais-codigos';
import { cifra, contexto, frasesDuelo, frasesPais } from '@/lib/sport/explorar/pais-frases';
import {
  INDICES_PRUEBA, SENTENCIAS_PAISES, TABLA_PRUEBA, TABLA_TIRADOR, TRAMOS_TIRADOR, TROZOS, VERSION_PAISES,
  sqlPruebasDeTrozo, sqlTiradoresDeTrozo, sqlTiradoresTodas, sqlTipoCompeticion, tramosTirador,
  SENTENCIAS_TIPO_EDICION,
} from '@/lib/sport/explorar/pais-indice-sql';
import { clasificarCompeticion } from '@/lib/sport/explorar/tipo-competicion';
import { serieTemporadas } from '@/components/explorar/pais/graficos-duelo';
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
const MIGRACION_V2 = readFileSync(new URL('0021_explorar_selecciones.sql', raiz), 'utf8');
const DESHACER_V2 = readFileSync(new URL('manual/0021_explorar_selecciones.deshacer.sql', raiz), 'utf8');
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
  s.exec(MIGRACION_V2);
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
  // 0–0 sin publicar: no cuenta en nada (ni asaltos, ni victorias, ni la lista de cruces).
  asalto(C.m20, 'fie', 'POULE', 'P3', 'bea', 'ilaria', P.beaCopia, P.ilaria, 0, 0);
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
  return { s, db, reconstruir, local, asalto, resultado };
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

  it('repartir las temporadas en trozos da lo mismo que una sola pasada', () => {
    const { s, reconstruir } = entorno();
    reconstruir();
    const consultas = ['SELECT * FROM explorar_pais_prueba ORDER BY 1, 2, 3, 4', 'SELECT * FROM explorar_pais_tirador ORDER BY 1, 2, 3, 4, 5, 6, 7, 8'];
    const trozos = consultas.map((q) => s.prepare(q).all());
    const trozosPruebas = new Set(Array.from({ length: TROZOS }, (_, i) => sqlPruebasDeTrozo(i)));
    const trozosTiradores = new Set(Array.from({ length: TROZOS }, (_, i) => sqlTiradoresDeTrozo(i)));
    const tramos = new Set(tramosTirador().map(([d, h]) => sqlTiradoresTodas(d, h)));
    const unaPasada = SENTENCIAS_PAISES.flatMap((x) => {
      if (x === sqlPruebasDeTrozo(0)) return [sqlPruebasDeTrozo(0, 1)];
      if (x === sqlTiradoresDeTrozo(0)) return [sqlTiradoresDeTrozo(0, 1)];
      if (x === sqlTiradoresTodas(null, TRAMOS_TIRADOR[0])) return [sqlTiradoresTodas(null, null)];
      return trozosPruebas.has(x) || trozosTiradores.has(x) || tramos.has(x) ? [] : [x];
    });
    expect(unaPasada.length).toBe(SENTENCIAS_PAISES.length - 2 * (TROZOS - 1) - TRAMOS_TIRADOR.length);
    reconstruir(unaPasada);
    expect(consultas.map((q) => s.prepare(q).all())).toEqual(trozos);
  });

  it('las tablas que la reconstrucción vuelve a crear son las de la 0018 más la 0021', () => {
    const plano = (x: string) => x.replace(/\s+/g, ' ').trim();
    for (const indice of INDICES_PRUEBA) expect(plano(MIGRACION)).toContain(plano(indice));
    expect(plano(MIGRACION_V2)).toContain(plano(TABLA_TIRADOR));
    const columnas = (preparar: (s: DatabaseSync) => void) => {
      const s = new DatabaseSync(':memory:');
      preparar(s);
      const info = s.prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('explorar_pais_prueba')`).all();
      s.close();
      return info;
    };
    // La 0018 con los ALTER de la 0021 deja la misma tabla que la reconstrucción.
    expect(columnas((s) => { s.exec(MIGRACION); s.exec(MIGRACION_V2); })).toEqual(columnas((s) => s.exec(TABLA_PRUEBA)));
  });

  it('la 0021 se deshace y se vuelve a aplicar', () => {
    const s = new DatabaseSync(':memory:');
    s.exec(MIGRACION);
    const antes = s.prepare(`SELECT name FROM pragma_table_info('explorar_pais_prueba')`).all();
    s.exec(MIGRACION_V2);
    s.exec(DESHACER_V2);
    expect(s.prepare(`SELECT name FROM pragma_table_info('explorar_pais_prueba')`).all()).toEqual(antes);
    expect(s.prepare(`SELECT count(*) n FROM sqlite_master WHERE name = 'explorar_pais_tirador'`).get()).toMatchObject({ n: 0 });
    s.exec(MIGRACION_V2);
    s.close();
  });

  it('fases, tipo de competición y asaltos con ganador', () => {
    const { s, reconstruir } = entorno();
    reconstruir();
    const m20 = fila(s, `SELECT * FROM explorar_pais_prueba WHERE pais_a='ESP' AND pais_b='ITA' AND competition_id=?`, C.m20);
    // Poule: Ana gana, Bea e Iris pierden; directa: Ana gana. El 0–0 de Bea no está.
    expect(m20).toMatchObject({ asaltos: 4, poule_va: 1, poule_vb: 2, directa_va: 1, directa_vb: 0, tipo: 'INTERNACIONAL_OTRO' });
    expect(JSON.parse(String(m20?.asaltos_ids))).toHaveLength(4);
    for (const q of [
      'SELECT count(*) n FROM explorar_pais_prueba WHERE asaltos <> victorias_a + victorias_b',
      'SELECT count(*) n FROM explorar_pais_prueba WHERE poule_va + poule_vb + directa_va + directa_vb <> asaltos',
      'SELECT count(*) n FROM explorar_pais_tirador WHERE asaltos <> victorias + derrotas',
      'SELECT count(*) n FROM explorar_pais_tirador WHERE poule_v + poule_d + directa_v + directa_d <> asaltos',
      'SELECT count(*) n FROM explorar_pais_rival WHERE asaltos <> victorias + derrotas OR encuentros <> ganados + perdidos',
    ]) expect(fila(s, q)?.n).toBe(0);
    expect(fila(s, `SELECT version FROM explorar_pais_estado`)?.version).toBe(VERSION_PAISES);
  });

  it('ninguna sentencia de la reconstrucción se acerca al límite de profundidad de D1 (100)', () => {
    // `a OR b OR c` en un mismo nivel: SQLite anida un nivel por término.
    const orSeguidos = (texto: string) => {
      const niveles = [0];
      let maximo = 0;
      for (const m of texto.matchAll(/\(|\)|\bOR\b/gi)) {
        if (m[0] === '(') niveles.push(0);
        else if (m[0] === ')') niveles.pop();
        else maximo = Math.max(maximo, ++niveles[niveles.length - 1]);
      }
      return maximo;
    };
    for (const sentencia of SENTENCIAS_PAISES) {
      expect(orSeguidos(sentencia)).toBeLessThanOrEqual(20);
      // Paréntesis abiertos que son un replace(: con el pliegue entero dentro de un LIKE pasaba de 90.
      const pila: boolean[] = [];
      let maximo = 0;
      for (const m of sentencia.matchAll(/replace\(|\(|\)/gi)) {
        if (m[0] === ')') pila.pop();
        else pila.push(m[0] !== '(');
        maximo = Math.max(maximo, pila.filter(Boolean).length);
      }
      expect(maximo).toBeLessThanOrEqual(70);
    }
  });

  it('el tipo de competición en SQL es el de clasificarCompeticion', () => {
    const { s } = entorno();
    const tipoSql = (cid: string) => fila(s, `SELECT ${sqlTipoCompeticion()} AS tipo FROM sport_competition c
      CROSS JOIN sport_edition e ON e.id = c.edition_id LEFT JOIN event ev ON ev.id = e.event_id WHERE c.id = ?`, cid)?.tipo;
    const casos: [string, string, string, string | null][] = [
      [C.m20, ED.fie, 'Coupe du Monde Junior', 'ITA'],
      [C.m20, ED.fie, 'Championnats du Monde Cadets-Juniors', 'ITA'],
      [C.m20, ED.fie, 'Grand Prix FIE', 'ITA'],
      [C.m20, ED.fie, 'Torneo cualquiera', 'ITA'],
      [C.parte, ED.efc, 'European Championships', 'HUN'],
      [C.parte, ED.efc, 'Grand Prix Cadets', 'HUN'],
      [C.nacional, ED.nacional, 'Trofeo de Budapest', 'HUN'],
      [C.nacional, ED.nacional, 'TNR Madrid', null],
    ];
    for (const [cid, eid, nombre, pais] of casos) {
      s.prepare('UPDATE sport_edition SET name = ?, country_code = ? WHERE id = ?').run(nombre, pais, eid);
      for (const sentencia of SENTENCIAS_TIPO_EDICION) s.exec(sentencia);
      const fuente = String(fila(s, 'SELECT source FROM sport_competition WHERE id = ?', cid)?.source);
      expect([nombre, tipoSql(cid)]).toEqual([nombre, clasificarCompeticion({ nombre, fuente, pais }).tipo]);
    }
  });

  it('tiradores por persona que prevalece, rival y temporada, en las dos orientaciones; sólo individual', () => {
    const { s, reconstruir } = entorno();
    reconstruir();
    const filasDe = (pais: string, rival: string, todas = false) => s.prepare(`SELECT persona_id, temporada, genero, arma, categoria, modalidad,
        asaltos, victorias, derrotas, tf, tc, poule_v, poule_d, directa_v, directa_d, ultima
      FROM explorar_pais_tirador WHERE pais = ? AND rival = ? AND (temporada = '') = ? ORDER BY persona_id`).all(pais, rival, todas ? 1 : 0);
    expect(filasDe('ESP', 'ITA')).toEqual([
      { persona_id: P.ana, temporada: '2024-2025', genero: 'F', arma: 'ESPADA', categoria: 'M20', modalidad: 'I',
        asaltos: 2, victorias: 2, derrotas: 0, tf: 20, tc: 13, poule_v: 1, poule_d: 0, directa_v: 1, directa_d: 0, ultima: '2025-02-01' },
      // La copia fundida cuenta para la persona que prevalece; el 0–0 no cuenta.
      expect.objectContaining({ persona_id: P.bea, asaltos: 1, victorias: 0, derrotas: 1, tf: 2, tc: 5 }),
      // Ficha italiana, pero tiró por España en esa prueba.
      expect.objectContaining({ persona_id: P.iris, asaltos: 1, derrotas: 1 }),
    ]);
    expect(filasDe('ITA', 'ESP')).toEqual([expect.objectContaining({ persona_id: P.ilaria, asaltos: 4, victorias: 2, derrotas: 2, tf: 23, tc: 26 })]);
    expect(filasDe('FRA', 'ESP')).toEqual([expect.objectContaining({ persona_id: P.fanny, asaltos: 1, victorias: 0, directa_d: 1 })]);
    // Una sola temporada en los datos: la fila de todas las temporadas es la misma con temporada ''.
    expect(filasDe('ESP', 'ITA', true)).toEqual(filasDe('ESP', 'ITA').map((f) => ({ ...f, temporada: '' })));
    expect(fila(s, `SELECT count(*) n FROM explorar_pais_tirador`)?.n).toBe(12);
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

  it('cifras, fases, tipos y tiradores del cara a cara', async () => {
    const { s, db, reconstruir, asalto, resultado } = entorno();
    // Una Copa del Mundo más con seis asaltos de poule entre Ana e Ilaria: ya pasan del mínimo de cinco.
    s.prepare(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date, country_code)
      VALUES (?, 'fie', '2026', 'cdm', 'Coupe du Monde Junior', '2026-01-10', 'POL')`).run(id(23));
    s.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, category_raw, format, competition_date)
      VALUES (?, ?, 'fie', '2026', 'cdm', 'ESPADA', 'F', 'M20', 'Junior', 'INDIVIDUAL', '2026-01-10')`).run(id(35), id(23));
    resultado(id(35), 'fie', 'ana', P.ana, 'ESP', 4);
    resultado(id(35), 'fie', 'ilaria', P.ilaria, 'ITA', 6);
    for (const [i, [a, b]] of [[5, 1], [5, 2], [5, 3], [5, 4], [1, 5], [2, 5]].entries()) {
      asalto(id(35), 'fie', 'POULE', `P${i + 1}`, 'ana', 'ilaria', P.ana, P.ilaria, a, b);
    }
    reconstruir();
    const d = await leerDueloPaises(db, 'ESP', 'ITA', FILTROS_DUELO_VACIOS);
    expect(d.completo).toBe(true);
    expect(d.individual).toMatchObject({
      pruebas: 2, asaltos: 10, victorias: 6, derrotas: 4,
      poule: { victorias: 5, derrotas: 4 }, directa: { victorias: 1, derrotas: 0 },
    });
    expect(d.niveles.map((nv) => [nv.tipo, nv.individual.victorias, nv.individual.derrotas])).toEqual([
      ['COPA_MUNDO', 4, 2], ['INTERNACIONAL_OTRO', 2, 2],
    ]);
    expect(d.tiradores?.nuestros.map((t) => [t.personaId, t.asaltos, t.victorias, t.derrotas])).toEqual([[P.ana, 8, 6, 2]]);
    expect(d.tiradores?.suyos.map((t) => [t.nombre, t.asaltos, t.victorias])).toEqual([['BIANCHI Ilaria', 10, 4]]);
    expect(d.tiradores?.bestias.map((t) => t.personaId)).toEqual([P.ilaria]);
    // Con la temporada, sólo cuentan sus filas: Ana tiene dos asaltos en 2024-2025.
    const temporada = await leerDueloPaises(db, 'ESP', 'ITA', { ...FILTROS_DUELO_VACIOS, temporada: '2024-2025' });
    expect(temporada.tiradores?.nuestros).toEqual([]);
    expect(temporada.temporadas.map((t) => t.temporada)).toEqual(['2024-2025', '2025-2026']);
    // Por equipos no hay tiradores.
    expect((await leerDueloPaises(db, 'ESP', 'ITA', { ...FILTROS_DUELO_VACIOS, modalidad: 'equipos' })).tiradores).toBeNull();
    // Desde Italia, las listas se invierten.
    const desdeItalia = await leerDueloPaises(db, 'ITA', 'ESP', { ...FILTROS_DUELO_VACIOS, genero: 'F', arma: 'ESPADA', categoria: 'M20' });
    expect(desdeItalia.individual).toMatchObject({ victorias: 4, derrotas: 6, poule: { victorias: 4, derrotas: 5 } });
    expect(desdeItalia.tiradores?.nuestros.map((t) => t.personaId)).toEqual([P.ilaria]);
    expect(desdeItalia.tiradores?.bestias.map((t) => t.personaId)).toEqual([P.ana]);
  });

  it('con los agregados de la versión 1 (o sin la 0021) no nombra lo nuevo', async () => {
    const { s, db, reconstruir } = entorno();
    reconstruir();
    s.exec(`UPDATE explorar_pais_estado SET version = 1`);
    s.exec(DESHACER_V2);
    const d = await leerDueloPaises(db, 'ESP', 'ITA', FILTROS_DUELO_VACIOS);
    expect(d).toMatchObject({ completo: false, tiradores: null, niveles: [] });
    expect(d.individual).toMatchObject({ asaltos: 4, victorias: 2, derrotas: 2, poule: { victorias: 0, derrotas: 0 } });
  });

  it('las lecturas del cara a cara van por clave y sólo leen la pareja', () => {
    const { s } = entorno();
    const dialecto = new SQLiteSyncDialect();
    const plan = (q: ReturnType<typeof sqlDuelo>) => {
      const { sql: texto, params } = dialecto.sqlToQuery(q);
      return (s.prepare(`EXPLAIN QUERY PLAN ${texto}`).all(...(params as string[])) as { detail: string }[]).map((r) => r.detail).join('\n');
    };
    const f = { ...FILTROS_DUELO_VACIOS, genero: 'M', arma: 'ESPADA' };
    for (const filtros of [f, FILTROS_DUELO_VACIOS, { ...FILTROS_DUELO_VACIOS, temporada: '2024-2025', categoria: 'ABS' }]) {
      const p = plan(sqlTiradoresDuelo('ITA', 'FRA', filtros, true));
      expect(p).toMatch(/SEARCH explorar_pais_tirador USING PRIMARY KEY \(pais=\? AND rival=\? AND temporada=\?\)/);
      // Agrupa por persona en el orden de la clave: D1 contaría las filas de la ordenación como leídas.
      expect(p).not.toMatch(/TEMP B-TREE FOR GROUP BY/);
    }
    expect(plan(sqlDuelo('ITA', 'FRA', f))).toMatch(/SEARCH explorar_pais_prueba USING INDEX explorar_pais_prueba_filtro_idx \(pais_a=\? AND pais_b=\? AND arma=\? AND genero=\?\)/);
    expect(plan(sqlDuelo('ITA', 'FRA', FILTROS_DUELO_VACIOS))).toMatch(/SEARCH explorar_pais_prueba USING INDEX explorar_pais_prueba_\w+_idx \(pais_a=\? AND pais_b=\?\)/);
    expect(plan(sqlDuelo('ITA', 'FRA', FILTROS_DUELO_VACIOS))).not.toMatch(/SCAN explorar_pais_prueba\b/);
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
    // La versión de los agregados va en la clave: el DTO cambia de forma con ella.
    expect(cache.cargas.find((c) => c.startsWith('pais-duelo/'))).toMatch(new RegExp(`^pais-duelo/\\["ESP","ITA","","","","","",\\d+,${VERSION_PAISES}\\]$`));
  });
});

describe('versión y series del cara a cara', () => {
  it('la página sabe leer la versión que escribe la reconstrucción', () => {
    expect(VERSION_DUELO_COMPLETO).toBeLessThanOrEqual(VERSION_PAISES);
  });

  it('balance acumulado y porcentaje por temporada, sin las temporadas vacías', () => {
    const t = (temporada: string, v: number, d: number, ev = 0, ed = 0) =>
      ({ temporada, individual: { victorias: v, derrotas: d }, equipos: { victorias: ev, derrotas: ed } });
    const serie = serieTemporadas([t('2021-2022', 3, 1), t('2022-2023', 0, 0, 1, 0), t('2023-2024', 1, 4)], false);
    expect(serie.map((p) => [p.temporada, p.balance, p.porcentaje])).toEqual([['2021-2022', 2, 75], ['2023-2024', -1, 20]]);
    expect(serieTemporadas([t('2022-2023', 0, 0, 1, 0)], true)).toEqual([
      { temporada: '2022-2023', victorias: 1, derrotas: 0, balance: 1, porcentaje: 100 },
    ]);
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
    expect(cabeceraDeRuta('/explorar/pais/ESP', false)).toMatchObject({ variante: 'subpantalla', titulo: 'País', volverA: '/explorar/buscar?ver=paises' });
    expect(cabeceraDeRuta('/explorar/pais/ESP/contra/ITA', false)).toMatchObject({ variante: 'subpantalla', titulo: 'Selecciones', volverA: '/explorar/pais/ESP' });
  });
});
