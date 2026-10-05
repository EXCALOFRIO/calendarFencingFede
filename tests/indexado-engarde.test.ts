import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { quitarGuardia } from '../scripts/indexado/comun';
import {
  esGeneralDePruebaTerminada,
  generoEngarde,
  marcarFilasSinPuesto,
  referencias,
  temporadaRfee,
} from '../scripts/indexado/engarde-a-hechos';
import { enlaceEngarde, paginasDePrueba } from '../scripts/indexado/engarde-descargar';
import { depurarSolapesEngarde } from '../scripts/indexado/medir-solapes';
import { unificarPersonas } from '../scripts/indexado/unificar-personas';
import { parsearPaginaEngarde } from '../src/lib/ingest/sources/engarde';
import { claveRondaCuadro } from '../src/lib/ingest/sources/engarde-cuadro';
import { parsearPoulesEngarde, prefijoRondaPoules } from '../src/lib/ingest/sources/engarde-poules';

describe('enlaces de Engarde', () => {
  it('reconoce todas las formas publicadas en el catálogo', () => {
    expect(enlaceEngarde('https://www.engarde-service.com/files/rfee/cto2019/')).toEqual({ tipo: 'torneo', org: 'rfee', evt: 'cto2019', compe: null });
    expect(enlaceEngarde('https://engarde-service.com/files/RFEE/cto2019/sm_ind/')).toEqual({ tipo: 'torneo', org: 'rfee', evt: 'cto2019', compe: 'sm_ind' });
    expect(enlaceEngarde('https://engarde-service.com/tournament/fce/tic2020')).toEqual({ tipo: 'torneo', org: 'fce', evt: 'tic2020', compe: null });
    expect(enlaceEngarde('https://engarde-service.com/competition/rfee/vm19/vm_ind')).toEqual({ tipo: 'torneo', org: 'rfee', evt: 'vm19', compe: 'vm_ind' });
    expect(enlaceEngarde('https://engarde-service.com/siteTemplate.php?Organisme=fecyl&Event=cesp')).toEqual({ tipo: 'torneo', org: 'fecyl', evt: 'cesp', compe: null });
    expect(enlaceEngarde('https://engarde-service.com/index.php?lng=es&Org=rfee&Tour=tnr1')).toEqual({ tipo: 'torneo', org: 'rfee', evt: 'tnr1', compe: null });
    expect(enlaceEngarde('https://engarde-service.com/app.php?id=abc123')).toEqual({ tipo: 'smart', id: 'abc123' });
    expect(enlaceEngarde('https://example.com/files/rfee/x/')).toEqual({ tipo: 'otro' });
    expect(enlaceEngarde('no es una url')).toEqual({ tipo: 'otro' });
  });

  it('sólo sigue las páginas de la propia prueba', () => {
    const html = `<a href="/competition/rfee/vm19/vm_ind/clasfinal.htm">c</a>
      <a href="https://engarde-service.com/competition/rfee/vm19/vm_ind/poules1.htm?x=1">p</a>
      <a href="//www.engarde-service.com/competition/rfee/vm19/vm_ind/tableau64.htm">t</a>
      <a href="/competition/rfee/vm19/vm_ind/tireurs.htm">tireurs</a>
      <a href="/competition/rfee/vm19/vf_ind/poules1.htm">otra prueba</a>`;
    expect(paginasDePrueba(html, 'rfee', 'vm19', 'vm_ind')).toEqual(['clasfinal.htm', 'poules1.htm', 'tableau64.htm']);
  });
});

describe('rondas de cuadro y poule', () => {
  it('normaliza los títulos de ronda', () => {
    expect(claveRondaCuadro('Tableau of 64')).toBe('T64');
    expect(claveRondaCuadro('Main tableau of 16')).toBe('T16');
    expect(claveRondaCuadro('Preliminary tableau of 256')).toBe('T256');
    expect(claveRondaCuadro('Tabla de 8')).toBe('T8');
    expect(claveRondaCuadro('Demi-finales')).toBe('SF');
    expect(claveRondaCuadro('Semi-finals')).toBe('SF');
    expect(claveRondaCuadro('Final')).toBe('F');
    expect(claveRondaCuadro('Tercer lugar')).toBeNull();
    expect(claveRondaCuadro('Tableau 5-8 of 4')).toBeNull();
    expect(prefijoRondaPoules(1)).toBe('P');
    expect(prefijoRondaPoules(2)).toBe('V2P');
  });
});

function poule(filas: string[][]): string {
  const cab = ['Poule No 2 - 09:10 - Pista No 9', 'Club', '', '1', '2', '3', 'V/M', 'TD-TR', 'TD'];
  const celda = (t: string) => (t.startsWith('V') ? `<td><div class="victory-cell">${t}</div></td>` : `<td>${t}</td>`);
  return `<table class="poule"><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr>
    ${filas.map((f) => `<tr>${f.map(celda).join('')}</tr>`).join('\n')}</table>`;
}

describe('parsearPoulesEngarde', () => {
  it('deduce los tocados de las victorias sin número y numera la poule por su cabecera', () => {
    const r = parsearPoulesEngarde(
      poule([
        ['ALFA Uno', 'CLUB A', '', '', 'V', 'V', '1.00', '5', '10'],
        ['BETA Dos', 'CLUB B', '', '3', '', 'V', '0.50', '-1', '8'],
        ['GAMMA Tres', 'CLUB C', '', '2', '4', '', '0.00', '-4', '6'],
      ]),
      { pagina: 1 },
    );
    expect(r.estado).toBe('leido');
    expect(r.esperados).toBe(3);
    expect(r.asaltos.map((a) => [a.ronda, a.a.nombre, a.a.tocados, a.b.nombre, a.b.tocados])).toEqual([
      ['P2', 'ALFA Uno', 5, 'BETA Dos', 3],
      ['P2', 'ALFA Uno', 5, 'GAMMA Tres', 2],
      ['P2', 'BETA Dos', 5, 'GAMMA Tres', 4],
    ]);
  });

  it('no inventa marcadores cuando la columna TD no los fija', () => {
    const r = parsearPoulesEngarde(
      poule([
        ['ALFA Uno', 'CLUB A', '', '', 'V', 'V', '1.00', '4', '9'],
        ['BETA Dos', 'CLUB B', '', '3', '', 'V', '0.50', '-1', '8'],
        ['GAMMA Tres', 'CLUB C', '', '2', '4', '', '0.00', '-4', '6'],
      ]),
      { pagina: 2 },
    );
    expect(r.excluidos.ambiguo).toBe(2);
    expect(r.asaltos.map((a) => [a.ronda, a.a.nombre, a.b.nombre])).toEqual([['V2P2', 'BETA Dos', 'GAMMA Tres']]);
  });

  it('descuenta los asaltos no disputados', () => {
    const r = parsearPoulesEngarde(
      poule([
        ['ALFA Uno', 'CLUB A', '', '', 'V', '', '1.00', '2', '5'],
        ['BETA Dos', 'CLUB B', '', '3', '', '', '0.00', '-2', '3'],
        ['GAMMA Tres', 'CLUB C', '', '', '', '', '0.00', '0', '0'],
      ]),
    );
    expect(r.esperados).toBe(1);
    expect(r.asaltos).toHaveLength(1);
  });
});

describe('clasificación de Engarde', () => {
  const pagina = `<html><body><div id="reloadable"><h1>Cto <small>Espada masculina<br>sábado 12 enero 2019</small></h1>
    <h3>Clasificación general final</h3>
    <table class="liste"><tr><th>Puesto</th><th>Apellido</th><th>Nombre</th><th>Nación</th><th></th></tr>
    <tr><td>&nbsp;1&nbsp;</td><td>&nbsp;ALFA&nbsp;</td><td>&nbsp;Uno&nbsp;</td><td><span translate="no">ESP</span></td><td>&nbsp;&nbsp;</td></tr>
    <tr><td>&nbsp;2&nbsp;</td><td>&nbsp;BETA&nbsp;</td><td>&nbsp;Dos&nbsp;</td><td><span translate="no">POR</span></td><td>&nbsp;&nbsp;</td></tr>
    <tr><td>&nbsp;&nbsp;</td><td>&nbsp;GAMMA&nbsp;</td><td>&nbsp;Tres&nbsp;</td><td><span translate="no">ESP</span></td><td>&nbsp;DNS&nbsp;</td></tr>
    <tr><td>&nbsp;&nbsp;</td><td>&nbsp;DELTA&nbsp;</td><td>&nbsp;Cuatro&nbsp;</td><td><span translate="no">ESP</span></td><td>&nbsp;Abandono&nbsp;</td></tr>
    </table></div></body></html>`;

  it('lee como puesto nulo a quien no compite o abandona', () => {
    expect(parsearPaginaEngarde(pagina).anomalias).toBe(2);
    const p = parsearPaginaEngarde(marcarFilasSinPuesto(pagina));
    expect(p.tipo).toBe('clasificacion');
    expect(p.anomalias).toBe(0);
    expect(p.filas.map((f) => [f.puestoRaw, f.puesto, f.nombre])).toEqual([
      ['1', 1, 'ALFA Uno'],
      ['2', 2, 'BETA Dos'],
      ['dns', null, 'GAMMA Tres'],
      ['abandono', null, 'DELTA Cuatro'],
    ]);
  });

  it('deja intacta una página sin filas sin puesto', () => {
    const sin = pagina.replace(/<tr><td>&nbsp;&nbsp;<\/td>.*?<\/tr>/gs, '');
    expect(marcarFilasSinPuesto(sin)).toBe(sin);
  });

  it('acepta «Classificació general» sólo en pruebas terminadas', () => {
    expect(esGeneralDePruebaTerminada('Classificació general', 'completed')).toBe(true);
    expect(esGeneralDePruebaTerminada('Overall ranking', 'completed')).toBe(true);
    expect(esGeneralDePruebaTerminada('Classificació general', 'running')).toBe(false);
    expect(esGeneralDePruebaTerminada('Classificació general després de les poules', 'completed')).toBe(false);
    expect(esGeneralDePruebaTerminada(null, 'completed')).toBe(false);
  });

  it('referencia a los tiradores por nombre único', () => {
    const refs = referencias([
      { clave: 'engarde:uno alfa|ESP', nombre: 'ALFA Uno' },
      { clave: 'engarde:dos beta|X', nombre: 'BETA Dos' },
      { clave: 'engarde:dos beta|Y', nombre: 'BETA Dos' },
    ]);
    expect(refs.deNombre('alfa uno')).toBe('engarde:uno alfa|ESP');
    expect(refs.deNombre('BETA Dos')).toBeNull();
    expect(refs.deNombre('OMEGA Cinco')).toMatch(/^engarde:.+\|$/);
    expect(refs.deNombre('')).toBeNull();
  });

  it('temporada y género', () => {
    expect(temporadaRfee('2019-01-12')).toBe('2018-2019');
    expect(temporadaRfee('2019-09-01')).toBe('2019-2020');
    expect(generoEngarde({ genero: null }, 'n')).toBe('MIXTO');
    expect(generoEngarde({ genero: 'F' }, 'n')).toBe('F');
    expect(generoEngarde({ genero: null }, '')).toBeNull();
  });
});

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

let k = 0;
const res = (db: DatabaseSync, comp: string, source: string, nombre: string, pais: string | null = 'ESP') =>
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, source_name, source_country_code,
    occurred_on, content_hash) VALUES (?,?,?,?,?,?, '2025-01-12', 'h')`)
    .run(`r${(k += 1)}`, comp, source, `${source}:${nombre}|${pais ?? ''}`, nombre, pais);
const asalto = (db: DatabaseSync, comp: string, source: string, a: string, b: string, fase = 'POULE') =>
  db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref,
    fencer_a_name, fencer_b_name, score_a, score_b, content_hash) VALUES (?,?,?,?, 'P1', ?,?,?,?, 5, 3, 'h')`)
    .run(`b${(k += 1)}`, comp, source, fase, `${source}:${a}|ESP`, `${source}:${b}|ESP`, a, b);
const cuenta = (db: DatabaseSync, sql: string, ...p: string[]) => Number((db.prepare(sql).get(...p) as { n: number }).n);

const NOMBRES = ['ALFA Uno', 'BETA Dos', 'GAMMA Tres'];

/** Carga de una prueba Engarde tal como la deja el cargador. */
function pruebaEngarde(db: DatabaseSync, id: string, edicion: string, arma: string, nombres = NOMBRES) {
  db.prepare(`INSERT OR IGNORE INTO sport_edition (id, source, season, tournament_key, name, start_date)
    VALUES (?, 'engarde', '2024-2025', ?, 'Engarde', '2025-01-12')`).run(edicion, `engarde:${edicion}`);
  db.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date)
    VALUES (?, ?, 'engarde', '2024-2025', ?, ?, 'M', 'ABS', 'INDIVIDUAL', '2025-01-12')`).run(id, edicion, `engarde:${id}`, arma);
  for (const n of nombres) res(db, id, 'engarde', n);
  asalto(db, id, 'engarde', nombres[0], nombres[1]);
  asalto(db, id, 'engarde', nombres[0], nombres[2]);
  asalto(db, id, 'engarde', nombres[1], nombres[2]);
  for (const kind of ['results', 'pools']) {
    db.prepare(`INSERT INTO sport_import_coverage (source, season, fact_kind, competition_key, competition_id, status)
      VALUES ('engarde', '2024-2025', ?, ?, ?, 'completo')
      ON CONFLICT (source, season, fact_kind, competition_key) DO UPDATE SET competition_id=excluded.competition_id`)
      .run(kind, `engarde:${id}`, id);
  }
}

/** ep: PDF con un solo asalto de poule. ef: FIE con tres asaltos. ee/ef2/eo: Engarde. */
function fixtureSolapes(): DatabaseSync {
  const db = crearBase();
  db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date) VALUES
      ('dp', 'rfee_pdf', '2024-2025', 'pdf:x', 'PDF', '2025-01-11'),
      ('df', 'fie', '2025', 'competition:9', 'FIE', '2025-01-12');
    INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date) VALUES
      ('cp', 'dp', 'rfee_pdf', '2024-2025', 'pdf:x:1', 'ESPADA', 'M', 'ABS', 'INDIVIDUAL', '2025-01-11'),
      ('cf', 'df', 'fie', '2025', '9', 'SABLE', 'M', 'ABS', 'INDIVIDUAL', '2025-01-12');
    INSERT INTO sport_import_coverage (source, season, fact_kind, competition_key, competition_id, status) VALUES
      ('rfee_pdf', '2024-2025', 'pools', 'pdf:x:1', 'cp', 'parcial');`);
  for (const n of NOMBRES) res(db, 'cp', 'rfee_pdf', n, null);
  asalto(db, 'cp', 'rfee_pdf', NOMBRES[0], NOMBRES[1]);
  for (const n of NOMBRES) res(db, 'cf', 'fie', n);
  asalto(db, 'cf', 'fie', NOMBRES[0], NOMBRES[1]);
  pruebaEngarde(db, 'ee', 'de', 'ESPADA');
  pruebaEngarde(db, 'es', 'de', 'SABLE');
  pruebaEngarde(db, 'eo', 'do', 'FLORETE', ['OTRO Alfa', 'OTRO Beta', 'OTRO Gamma']);
  return db;
}

describe('depurarSolapesEngarde', () => {
  it('retira los puestos repetidos y sustituye los asaltos sólo si Engarde trae más', () => {
    const db = fixtureSolapes();
    const inf = depurarSolapesEngarde(db);
    expect(inf).toMatchObject({
      pruebasEngarde: 3, emparejadas: 2, soloEngarde: 1, paresPorFuente: { rfee_pdf: 1, fie: 1 }, grupos: 2, gruposConFie: 1,
      fasesSustituidas: 1, fasesDescartadas: 1, asaltosMovidos: 3, asaltosPreviosBorrados: 1, resultadosEngardeBorrados: 6,
      nombresSoloEnEngarde: 0, competicionesBorradas: 2, edicionesBorradas: 1,
    });
    // PDF: conserva sus puestos y recibe los tres asaltos de Engarde con su cobertura.
    expect(cuenta(db, `SELECT count(*) n FROM sport_result WHERE competition_id='cp' AND source='rfee_pdf'`)).toBe(3);
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE competition_id='cp' AND source='engarde'`)).toBe(3);
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE competition_id='cp' AND source='rfee_pdf'`)).toBe(0);
    expect(db.prepare(`SELECT source, fact_kind, competition_id FROM sport_import_coverage ORDER BY source, fact_kind`).all()
      .map((r) => ({ ...r }))).toEqual([
      { source: 'engarde', fact_kind: 'pools', competition_id: 'cp' },
      { source: 'engarde', fact_kind: 'pools', competition_id: 'eo' },
      { source: 'engarde', fact_kind: 'results', competition_id: 'eo' },
    ]);
    // FIE intacta.
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE competition_id='cf'`)).toBe(1);
    expect(cuenta(db, `SELECT count(*) n FROM sport_result WHERE competition_id='cf'`)).toBe(3);
    // La prueba sólo de Engarde queda entera.
    expect(cuenta(db, `SELECT count(*) n FROM sport_competition WHERE source='engarde'`)).toBe(1);
    expect(cuenta(db, `SELECT count(*) n FROM sport_result WHERE competition_id='eo'`)).toBe(3);
    expect(cuenta(db, `SELECT count(*) n FROM sport_edition WHERE source='engarde'`)).toBe(1);
  });

  it('es idempotente aunque el cargador vuelva a crear las pruebas', () => {
    const db = fixtureSolapes();
    depurarSolapesEngarde(db);
    pruebaEngarde(db, 'ee', 'de', 'ESPADA');
    pruebaEngarde(db, 'es', 'de', 'SABLE');
    const inf = depurarSolapesEngarde(db);
    expect(inf).toMatchObject({ fasesSustituidas: 0, asaltosMovidos: 0, asaltosPreviosBorrados: 0, competicionesBorradas: 2, edicionesBorradas: 1 });
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE competition_id='cp'`)).toBe(3);
    expect(cuenta(db, `SELECT count(*) n FROM sport_import_coverage WHERE competition_id='cp' AND source='engarde'`)).toBe(1);
    expect(cuenta(db, `SELECT count(*) n FROM sport_competition WHERE source='engarde'`)).toBe(1);
    expect(depurarSolapesEngarde(db)).toMatchObject({ emparejadas: 0, soloEngarde: 1, competicionesBorradas: 0 });
  });
});

describe('unificar-personas con Engarde', () => {
  it('vincula por nombre sólo a tiradores españoles y los asaltos heredan la persona del puesto', () => {
    const db = crearBase();
    db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date) VALUES
        ('de', 'engarde', '2024-2025', 'engarde:x/y', 'Engarde', '2025-01-12');
      INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date) VALUES
        ('ce', 'de', 'engarde', '2024-2025', 'engarde:x/y/z', 'ESPADA', 'M', 'ABS', 'INDIVIDUAL', '2025-01-12');`);
    res(db, 'ce', 'engarde', 'ALFA Uno', 'ESP');
    res(db, 'ce', 'engarde', 'BETA Dos', 'POR');
    asalto(db, 'ce', 'engarde', 'ALFA Uno', 'BETA Dos');
    db.prepare(`UPDATE sport_bout SET fencer_a_ref=?, fencer_b_ref=?`).run('engarde:ALFA Uno|ESP', 'engarde:BETA Dos|POR');
    unificarPersonas(db);
    const alfa = db.prepare(`SELECT person_id p FROM sport_result WHERE source_name='ALFA Uno'`).get() as { p: string | null };
    expect(alfa.p).toBeTruthy();
    expect(db.prepare(`SELECT person_id p FROM sport_result WHERE source_name='BETA Dos'`).get()).toEqual({ p: null });
    expect(db.prepare(`SELECT fencer_a_person_id a, fencer_b_person_id b FROM sport_bout`).get()).toEqual({ a: alfa.p, b: null });
  });
});
